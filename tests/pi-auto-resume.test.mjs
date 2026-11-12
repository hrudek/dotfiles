import assert from "node:assert/strict";
import { test } from "node:test";
import { setupAutoResume } from "../stow/pi/.pi/agent/extensions/auto-resume/index.ts";
import { BUFFER_MS, isBillingError, isCancelKey, isLimitError, nextAttempt, providerFor, resetHint } from "../stow/pi/.pi/agent/extensions/auto-resume/limits.ts";

const START = Date.parse("2026-11-11T12:00:00Z");
const flush = () => new Promise((resolve) => setImmediate(resolve));

function harness(t, read = async () => []) {
	t.mock.timers.enable({ apis: ["setInterval", "Date"], now: START });
	const handlers = new Map();
	const commands = new Map();
	const sent = [];
	const notices = [];
	const statuses = new Map();
	let terminal;
	let branch = [{ type: "message", id: "error-entry" }];
	let idle = true;
	let queued = false;
	const ctx = {
		hasUI: true, mode: "tui", model: { provider: "openai", id: "codex-model" },
		isIdle: () => idle, hasPendingMessages: () => queued,
		sessionManager: { getBranch: () => branch, getSessionId: () => "session-1" },
		ui: {
			theme: { fg: (_color, text) => text },
			setStatus: (key, value) => statuses.set(key, value), setWidget: () => {},
			notify: (text) => notices.push(text),
			onTerminalInput: (handler) => { terminal = handler; return () => { terminal = undefined; }; },
		},
	};
	const pi = {
		on: (event, handler) => { handlers.set(event, [...(handlers.get(event) ?? []), handler]); },
		registerCommand: (name, spec) => commands.set(name, spec),
		events: { emit: (_name, data) => statuses.set(data.key, data.status) },
		sendMessage: (...args) => sent.push(args),
		appendEntry: (customType, data) => branch.push({ type: "custom", customType, data, id: "settings" }),
	};
	setupAutoResume(pi, { readWindows: read, now: () => Date.now() });
	const emit = async (event, data = {}) => {
		for (const handler of handlers.get(event) ?? []) await handler(data, ctx);
	};
	const fail = async (text = "usage_limit_reached: You've hit your usage limit") => {
		await emit("message_end", { message: { role: "assistant", stopReason: "error", errorMessage: text, provider: ctx.model.provider, model: ctx.model.id } });
		await emit("agent_settled", { aborted: false });
		await flush();
	};
	t.after(async () => { await emit("session_shutdown"); });
	return { ctx, sent, notices, statuses, emit, fail,
		start: () => emit("session_start"),
		command: (args) => commands.get("auto-resume").handler(args, ctx),
		key: (key) => terminal?.(key),
		branch: (value) => { branch = value; }, busy: () => { idle = false; }, queue: () => { queued = true; },
	};
}

test("classifies only retryable limits, not billing, auth, context or prose", () => {
	for (const message of ["usage_limit_reached", "You've hit your limit · resets 5pm", "You have exceeded your weekly limit", "Rate limit reached", "rate_limit_error", "Too many requests", "Subscription limit exceeded"]) assert.equal(isLimitError(message), true, message);
	for (const message of ["insufficient_quota", "billing: rate limit reached", "Claude billing: Anthropic wants usage credits", "third-party apps now draw from your extra usage", "Invalid API key", "maximum context length exceeded", "context limit reached", "Ask your workspace admin: usage limit reached", "Connection timed out", "Here is how a usage limit works"]) assert.equal(isLimitError(message), false, message);
	assert.equal(providerFor({ provider: "pi-claude-cli" }), "claude");
	assert.equal(providerFor({ provider: "openai" }), "codex");
	assert.equal(providerFor({ provider: "openai-codex" }), "codex");
	assert.equal(providerFor({ provider: "anthropic" }), undefined);
});

test("cancels with legacy and Kitty keys, but not key releases or other input", () => {
	for (const key of ["\x1b", "\x03", "\x1b[27u", "\x1b[27;1u", "\x1b[27;1:1u", "\x1b[99;5u", "\x1b[99;5:2u"]) assert.equal(isCancelKey(key), true, JSON.stringify(key));
	for (const key of ["a", "\x1b[A", "\x1b[27;1:3u", "\x1b[99;5:3u", "\x1b[99u"]) assert.equal(isCancelKey(key), false, JSON.stringify(key));
});

test("parses reset hints and waits for ALL exhausted windows, with buffer", () => {
	assert.equal(resetHint(JSON.stringify({ resets_at: START / 1_000 + 3_600 }), {}, START), START + 3_600_000);
	assert.equal(resetHint('{"resets_in_seconds":7200}', {}, START), START + 7_200_000);
	assert.equal(resetHint("Please try again in 2h 15m", {}, START), START + 8_100_000);
	assert.equal(resetHint("Try again in 12.5s", {}, START), START + 12_500);
	assert.equal(resetHint("", { "retry-after": "120" }, START), START + 120_000);
	assert.equal(resetHint("", { "retry-after": "Wed, 11 Nov 2026 13:00:00 GMT" }, START), START + 3_600_000);
	assert.equal(resetHint("resets 5pm (Europe/Berlin)", {}, START), undefined);
	assert.equal(nextAttempt(START, [{ used: 100, resetAt: START + 3_600_000 }, { used: 100, resetAt: START + 604_800_000 }, { used: 25, resetAt: START + 900_000_000 }], undefined, 1), START + 604_800_000 + BUFFER_MS);
	assert.equal(nextAttempt(START, [], undefined, 1), START + 300_000 + BUFFER_MS);
	assert.equal(nextAttempt(START, [], undefined, 9), START + 1_800_000 + BUFFER_MS);
});

test("does not schedule until settled; resumes exactly once after reset", async (t) => {
	let calls = 0;
	const h = harness(t, async () => ++calls === 1 ? [{ used: 100, resetAt: START + 120_000 }] : [{ used: 0 }]);
	await h.start();
	await h.emit("message_end", { message: { role: "assistant", provider: "openai", model: "codex-model", stopReason: "error", errorMessage: "usage_limit_reached" } });
	t.mock.timers.tick(10_000);
	assert.equal(calls, 0);
	await h.emit("agent_settled", { aborted: false });
	await flush();
	t.mock.timers.tick(139_000);
	await flush();
	assert.equal(h.sent.length, 0);
	t.mock.timers.tick(1_000);
	await flush();
	assert.equal(h.sent.length, 1);
	assert.equal(h.sent[0][1].triggerTurn, true);
	t.mock.timers.tick(999_000);
	await flush();
	assert.equal(h.sent.length, 1);
});

test("unknown reset retries conservatively; exhausted usage is checked again", async (t) => {
	let calls = 0;
	const h = harness(t, async () => { calls++; return [{ used: 100 }]; });
	await h.start(); await h.emit("input", { source: "interactive" }); await h.fail();
	t.mock.timers.tick(329_000); await flush(); assert.equal(calls, 1);
	t.mock.timers.tick(1_000); await flush(); assert.equal(calls, 2);
	assert.equal(h.sent.length, 0);
	t.mock.timers.tick(629_000); await flush(); assert.equal(calls, 2);
	t.mock.timers.tick(1_000); await flush(); assert.equal(calls, 3);
});

test("usage reader failure falls back without an unhandled rejection", async (t) => {
	const h = harness(t, async () => { throw new Error("offline"); });
	await h.start(); await h.emit("input"); await h.fail();
	t.mock.timers.tick(330_000); await flush();
	assert.equal(h.sent.length, 1);
});

for (const event of ["model_select", "session_tree", "session_compact", "input", "before_agent_start", "session_shutdown"]) {
	test(`${event} cancels a pending continuation`, async (t) => {
		const h = harness(t);
		await h.start(); await h.fail(); await h.emit(event);
		t.mock.timers.tick(4_000_000); await flush();
		assert.equal(h.sent.length, 0);
	});
}

for (const action of ["cancel", "off", "escape", "ctrl-c", "busy", "queued", "branch"]) {
	test(`${action} prevents stale continuation`, async (t) => {
		const h = harness(t);
		await h.start(); await h.fail();
		if (action === "escape") assert.deepEqual(h.key("\x1b"), { consume: true });
		else if (action === "ctrl-c") h.key("\x03");
		else if (action === "busy") h.busy();
		else if (action === "queued") h.queue();
		else if (action === "branch") h.branch([{ type: "message", id: "different-entry" }]);
		else await h.command(action);
		t.mock.timers.tick(4_000_000); await flush();
		assert.equal(h.sent.length, 0);
	});
}

test("cancellation invalidates an in-flight usage request", async (t) => {
	let finish;
	const h = harness(t, () => new Promise((resolve) => { finish = resolve; }));
	await h.start(); await h.fail();
	await h.command("cancel");
	finish([{ used: 100, resetAt: START + 120_000 }]); await flush();
	t.mock.timers.tick(4_000_000); await flush();
	assert.equal(h.sent.length, 0);
	assert.equal(h.statuses.get("auto-resume"), undefined);
});

test("aborts, successful responses and billing failures never schedule", async (t) => {
	let calls = 0;
	const h = harness(t, async () => { calls++; return []; });
	await h.start();
	await h.fail("Claude billing: usage limit reached");
	await h.emit("message_end", { message: { role: "assistant", provider: "openai", model: "codex-model", stopReason: "error", errorMessage: "usage_limit_reached" } });
	await h.emit("agent_settled", { aborted: true });
	await h.emit("message_end", { message: { role: "assistant", stopReason: "stop" } });
	await h.emit("agent_settled", { aborted: false });
	t.mock.timers.tick(4_000_000); await flush();
	assert.equal(calls, 0); assert.equal(h.sent.length, 0);
});

test("Claude CLI model resumes through the same lifecycle", async (t) => {
	const h = harness(t, async (provider, model) => {
		assert.equal(provider, "claude"); assert.equal(model, "claude-opus-5-5"); return [];
	});
	h.ctx.model = { provider: "pi-claude-cli", id: "claude-opus-5-5" };
	await h.start(); await h.emit("input"); await h.fail("You've hit your limit · resets 5pm (Europe/Berlin)");
	t.mock.timers.tick(330_000); await flush();
	assert.equal(h.sent.length, 1);
});

for (const reason of ["threshold", "overflow", "manual"]) {
	test(`${reason} compaction quota failure: only automatic compaction resumes`, async (t) => {
		const h = harness(t);
		await h.start();
		await h.emit("session_compact_failed", { reason, aborted: false, errorMessage: "usage_limit_reached" });
		await h.emit("agent_settled", { aborted: false }); await flush();
		t.mock.timers.tick(330_000); await flush();
		assert.equal(h.sent.length, reason === "manual" ? 0 : 1);
	});
}

test("a successful built-in retry clears the earlier quota error", async (t) => {
	let calls = 0;
	const h = harness(t, async () => { calls++; return []; });
	await h.start();
	await h.emit("message_end", { message: { role: "assistant", provider: "openai", model: "codex-model", stopReason: "error", errorMessage: "usage_limit_reached" } });
	await h.emit("message_end", { message: { role: "assistant", stopReason: "stop" } });
	await h.emit("agent_settled", { aborted: false });
	await flush();
	assert.equal(calls, 0);
});

test("does not duplicate a job on repeated settled events", async (t) => {
	let calls = 0;
	const h = harness(t, async () => { calls++; return []; });
	await h.start(); await h.fail();
	await h.emit("agent_settled", { aborted: false });
	await flush(); assert.equal(calls, 1);
	t.mock.timers.tick(330_000); await flush(); assert.equal(h.sent.length, 1);
});

for (const mode of ["print", "json"]) {
	test(`${mode} mode never starts a background wait`, async (t) => {
		let calls = 0;
		const h = harness(t, async () => { calls++; return []; });
		h.ctx.hasUI = false; h.ctx.mode = mode;
		await h.start(); await h.fail();
		assert.equal(calls, 0);
	});
}

test("further limit failures after continuation use increasing backoff", async (t) => {
	const h = harness(t);
	await h.start(); await h.fail();
	t.mock.timers.tick(330_000); await flush(); assert.equal(h.sent.length, 1);
	await h.emit("before_agent_start", { messageType: "custom" });
	await h.fail();
	t.mock.timers.tick(629_000); await flush(); assert.equal(h.sent.length, 1);
	t.mock.timers.tick(1_000); await flush(); assert.equal(h.sent.length, 2);
});

test("disabled setting survives reload, without restoring an old pending job", async (t) => {
	const h = harness(t);
	h.branch([{ type: "custom", customType: "auto-resume-settings", data: { enabled: false }, id: "setting" }]);
	await h.start(); await h.fail();
	t.mock.timers.tick(4_000_000); await flush(); assert.equal(h.sent.length, 0);
	await h.command("on"); await flush();
	t.mock.timers.tick(4_000_000); await flush(); assert.equal(h.sent.length, 1);
});

const PLAN_BLOCK = "Claude billing: this request was charged to Claude usage credits instead of your plan limits (rate limit status rejected, five_hour). pi stopped so further requests are not charged.";

test("plan-limit credits block is a limit error; other billing errors are not", () => {
	assert.equal(isLimitError(PLAN_BLOCK), true);
	assert.equal(isBillingError(PLAN_BLOCK), false);
	assert.equal(isLimitError(PLAN_BLOCK.replace("rejected", "allowed")), false);
	assert.equal(isBillingError("Claude billing: Anthropic wants usage credits"), true);
});

test("Claude plan-limit credits block waits for resetsAt from the diagnostic and then resumes", async (t) => {
	let windows = [{ used: 100, resetAt: START + 3_600_000 }];
	const h = harness(t, async () => windows);
	h.ctx.model = { provider: "pi-claude-cli", id: "claude-opus-5-5" };
	await h.start();
	await h.emit("message_end", { message: { role: "assistant", stopReason: "error", errorMessage: PLAN_BLOCK, provider: "pi-claude-cli", model: "claude-opus-5-5",
		diagnostics: [{ type: "pi-claude-cli.rate-limit", details: { status: "rejected", rateLimitType: "five_hour", resetsAt: (START + 3_600_000) / 1_000, isUsingOverage: true } }] } });
	await h.emit("agent_settled", { aborted: false }); await flush();
	assert.match(h.notices.at(-1), /limit reached/);
	windows = [{ used: 2, resetAt: START + 18_000_000 }];
	t.mock.timers.tick(3_600_000 + BUFFER_MS - 1_000); await flush(); assert.equal(h.sent.length, 0);
	t.mock.timers.tick(2_000); await flush(); assert.equal(h.sent.length, 1);
});

test("other billing errors warn instead of silently doing nothing", async (t) => {
	const h = harness(t);
	h.ctx.model = { provider: "pi-claude-cli", id: "claude-opus-5-5" };
	await h.start(); await h.fail("Claude billing: Anthropic wants usage credits");
	assert.match(h.notices.at(-1), /billing/);
	t.mock.timers.tick(4_000_000); await flush(); assert.equal(h.sent.length, 0);
});
