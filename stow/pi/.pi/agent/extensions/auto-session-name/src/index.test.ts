import assert from "node:assert/strict";
import { test } from "node:test";
import autoSessionName from "./index.ts";

function harness(initialName?: string) {
	const handlers = new Map();
	const commands = new Map();
	const branch: any[] = [];
	const requests: any[] = [];
	let name = initialName;
	let nextTitle = "Session Titles";
	let responseGate: Promise<void> | undefined;
	const model = { provider: "test", id: "naming" };
	const ctx = {
		hasUI: true,
		cwd: "/test/project",
		model,
		sessionManager: {
			getBranch: () => branch,
			getSessionDir: () => { throw new Error("No other sessions in test"); },
		},
		modelRegistry: {
			find: () => undefined,
			hasConfiguredAuth: () => true,
			streamSimple: async (_model: unknown, request: unknown) => {
				requests.push(request);
				const title = nextTitle;
				return { result: async () => {
					await responseGate;
					return { stopReason: "stop", content: [{ type: "text", text: title }] };
				} };
			},
		},
		ui: { notify: () => {} },
	};
	const pi = {
		on: (event: string, handler: any) => handlers.set(event, handler),
		registerCommand: (command: string, spec: any) => commands.set(command, spec),
		getSessionName: () => name,
		setSessionName: (value: string) => { name = value; },
		appendEntry: (customType: string, data: unknown) => branch.push({ type: "custom", customType, data }),
	};
	autoSessionName(pi as any);
	return {
		branch, requests,
		name: () => name,
		rename: (value: string) => { name = value; },
		delayResponse: (gate: Promise<void>) => { responseGate = gate; },
		title: (value: string) => { nextTitle = value; },
		message: (role: string, text: string, stopReason = "stop") => branch.push({
			type: "message", message: { role, content: [{ type: "text", text }], stopReason },
		}),
		emit: async (event: string, data = {}) => {
			await handlers.get(event)?.(data, ctx);
			await new Promise((resolve) => setImmediate(resolve));
		},
		retitle: () => commands.get("retitle").handler("", ctx),
	};
}

test("names only after a complete settled answer and includes both sides", async () => {
	const h = harness();
	await h.emit("session_start", { reason: "new" });
	h.message("user", "Change session naming");
	await h.emit("before_agent_start", { messageType: "user", prompt: "Change session naming" });
	assert.equal(h.requests.length, 0);
	h.message("assistant", "I will inspect the extension", "toolUse");
	await h.emit("message_end");
	await h.emit("agent_end");
	assert.equal(h.requests.length, 0);
	h.message("assistant", "The title should wait until the complete answer.");
	await h.emit("agent_settled", { aborted: false });
	assert.equal(h.name(), "Session Titles");
	const prompt = h.requests[0].messages[0].content[0].text;
	assert.match(prompt, /User: Change session naming/);
	assert.match(prompt, /Assistant: The title should wait/);
	await h.emit("agent_settled", { aborted: false });
	assert.equal(h.requests.length, 1);
});

test("waits after aborted, failed, truncated, tool-only or empty answers", async () => {
	for (const [stopReason, text, aborted] of [
		["stop", "Partial answer", true],
		["aborted", "Partial answer", false],
		["error", "Failed answer", false],
		["length", "Truncated answer", false],
		["toolUse", "Checking files", false],
		["stop", "  ", false],
	] as const) {
		const h = harness();
		await h.emit("session_start", { reason: "new" });
		h.message("user", "Misheard dictation");
		h.message("assistant", text, stopReason);
		await h.emit("agent_settled", { aborted });
		assert.equal(h.requests.length, 0, `${stopReason}, aborted=${aborted}`);
		h.message("user", "Corrected request");
		h.message("assistant", "Complete answer to the corrected request");
		await h.emit("agent_settled", { aborted: false });
		assert.equal(h.name(), "Session Titles");
	}
});

test("does not reuse an older answer when the current request has no answer", async () => {
	const h = harness();
	await h.emit("session_start", { reason: "new" });
	h.message("assistant", "An old answer");
	h.message("user", "New request");
	await h.emit("agent_settled", { aborted: false });
	assert.equal(h.requests.length, 0);
});

test("retries after a later answer when there was no identifiable topic", async () => {
	const h = harness();
	await h.emit("session_start", { reason: "new" });
	h.title("NONE");
	h.message("user", "Hi");
	h.message("assistant", "Hello");
	await h.emit("agent_settled", { aborted: false });
	assert.equal(h.name(), undefined);
	h.title("Session Titles");
	h.message("user", "Change session naming");
	h.message("assistant", "Here is the solution");
	await h.emit("agent_settled", { aborted: false });
	assert.equal(h.name(), "Session Titles");
});

test("preserves manual names, while explicit retitle still works", async () => {
	const h = harness("My Manual Name");
	await h.emit("session_start", { reason: "resume" });
	h.message("user", "Change session naming");
	h.message("assistant", "Complete answer");
	await h.emit("agent_settled", { aborted: false });
	assert.equal(h.requests.length, 0);
	assert.equal(h.name(), "My Manual Name");
	await h.retitle();
	assert.equal(h.name(), "Session Titles");
});

test("replaces an inherited automatic fork title only after the answer", async () => {
	const h = harness("Parent Title");
	h.branch.push({ type: "custom", customType: "auto-session-name", data: { name: "Parent Title" } });
	await h.emit("session_start", { reason: "fork" });
	h.message("user", "New topic");
	await h.emit("before_agent_start", { messageType: "user", prompt: "New topic" });
	assert.equal(h.name(), "Parent Title");
	assert.equal(h.requests.length, 0);
	h.message("assistant", "Answer to the new topic");
	await h.emit("agent_settled", { aborted: false });
	assert.equal(h.name(), "Session Titles");
});

const THREE_MINUTES = 180_000;
const flush = () => new Promise((resolve) => setImmediate(resolve));

async function startLongRun(h: ReturnType<typeof harness>) {
	await h.emit("session_start", { reason: "new" });
	h.message("user", "Analyze the entire project");
	await h.emit("before_agent_start", { messageType: "user", prompt: "Analyze the entire project" });
}

test("creates a provisional title after three minutes and refines it once", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const h = harness();
	await startLongRun(h);
	h.message("assistant", "Inspecting the project", "toolUse");
	t.mock.timers.tick(THREE_MINUTES - 1);
	await flush();
	assert.equal(h.requests.length, 0);
	t.mock.timers.tick(1);
	await flush();
	assert.equal(h.name(), "Session Titles");
	assert.equal(h.branch.at(-1).data.provisional, true);
	assert.match(h.requests[0].messages[0].content[0].text, /Inspecting the project/);
	h.title("Project Analysis");
	h.message("assistant", "Complete project analysis");
	await h.emit("agent_settled", { aborted: false });
	assert.equal(h.name(), "Project Analysis");
	assert.equal(h.branch.at(-1).data.provisional, false);
	await h.emit("agent_settled", { aborted: false });
	t.mock.timers.tick(THREE_MINUTES * 10);
	await flush();
	assert.equal(h.requests.length, 2);
});

test("completion, cancellation, failure and shutdown clear the fallback timer", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	for (const outcome of ["complete", "abort", "error", "shutdown"]) {
		const h = harness();
		await startLongRun(h);
		if (outcome === "shutdown") await h.emit("session_shutdown");
		else {
			h.message("assistant", "Answer", outcome === "error" ? "error" : "stop");
			await h.emit("agent_settled", { aborted: outcome === "abort" });
		}
		t.mock.timers.tick(THREE_MINUTES);
		await flush();
		assert.equal(h.requests.length, outcome === "complete" ? 1 : 0, outcome);
	}
});

test("manual names are protected before and after the fallback", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	for (const renameBeforeFallback of [true, false]) {
		const h = harness();
		await startLongRun(h);
		if (renameBeforeFallback) h.rename("Manual Title");
		t.mock.timers.tick(THREE_MINUTES);
		await flush();
		h.rename("Manual Title");
		h.message("assistant", "Complete answer");
		await h.emit("agent_settled", { aborted: false });
		assert.equal(h.name(), "Manual Title");
		assert.equal(h.requests.length, renameBeforeFallback ? 0 : 1);
	}
});

test("completion waits for an in-flight fallback and then refines it", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const h = harness();
	let release!: () => void;
	h.delayResponse(new Promise<void>((resolve) => { release = resolve; }));
	await startLongRun(h);
	t.mock.timers.tick(THREE_MINUTES);
	await flush();
	assert.equal(h.requests.length, 1);
	h.title("Final Analysis");
	h.message("assistant", "Complete answer");
	const settled = h.emit("agent_settled", { aborted: false });
	release();
	await settled;
	assert.equal(h.name(), "Final Analysis");
	assert.equal(h.requests.length, 2);
});

test("late fallback results cannot rename an aborted, failed or replaced session", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	for (const outcome of ["replace", "abort", "error"]) {
		const h = harness();
		let release!: () => void;
		h.delayResponse(new Promise<void>((resolve) => { release = resolve; }));
		await startLongRun(h);
		t.mock.timers.tick(THREE_MINUTES);
		await flush();
		if (outcome === "replace") {
			await h.emit("session_shutdown");
			h.branch.length = 0;
			await h.emit("session_start", { reason: "new" });
		} else {
			h.message("assistant", "Incomplete answer", outcome === "error" ? "error" : "aborted");
			await h.emit("agent_settled", { aborted: outcome === "abort" });
		}
		release();
		await flush();
		assert.equal(h.name(), undefined);
	}
});

test("a provisional title can still be refined after reload", async () => {
	const h = harness("Provisional Title");
	h.branch.push({ type: "custom", customType: "auto-session-name", data: { name: "Provisional Title", provisional: true } });
	await h.emit("session_start", { reason: "reload" });
	h.message("assistant", "Complete answer");
	await h.emit("agent_settled", { aborted: false });
	assert.equal(h.name(), "Session Titles");
	assert.equal(h.branch.at(-1).data.provisional, false);
});
