import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readdir, readFile, writeFile, stat, rm, utimes } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUsageReader, credentialScope, fileStore, httpError, UsageError } from "../stow/pi/.pi/agent/extensions/usage-support/cache.ts";
import { installUsagePolling } from "../stow/pi/.pi/agent/extensions/usage-support/poller.ts";
import usageStatus from "../stow/pi/.pi/agent/extensions/usage-status.ts";

const START = Date.parse("2026-11-11T12:00:00Z");
const flush = () => new Promise((resolve) => setImmediate(resolve));
function memoryStore() {
	const values = new Map();
	return { read: async (key) => structuredClone(values.get(key)), write: async (key, value) => { values.set(key, structuredClone(value)); }, lock: async () => async () => {} };
}
function readerHarness(fetch, extra = {}) {
	let clock = START;
	const reader = createUsageReader({ fetch, scope: async () => "account-1", store: memoryStore(), now: () => clock, random: () => 0, ...extra });
	return { reader, advance: (ms) => { clock += ms; } };
}

test("single-flight and cache avoid duplicate queries; fresh has a five-second floor", async () => {
	let calls = 0;
	let finish;
	const h = readerHarness(() => { calls++; return new Promise((resolve) => { finish = resolve; }); });
	const a = h.reader.read(); const b = h.reader.read({ fresh: true });
	await flush(); assert.equal(calls, 1);
	finish({ used: 12 });
	assert.equal((await a).value.used, 12); assert.equal((await b).value.used, 12);
	h.advance(4_000); await h.reader.read({ fresh: true }); assert.equal(calls, 1);
	h.advance(2_000);
	const c = h.reader.read({ fresh: true }); await flush(); assert.equal(calls, 2);
	finish({ used: 13 }); await c;
	h.advance(29_000); await h.reader.read(); assert.equal(calls, 2);
});

test("errors retain last success; exponential backoff also applies to forced reads", async () => {
	let failing = false;
	let calls = 0;
	const h = readerHarness(async () => { calls++; if (failing) throw new Error("offline"); return { used: 62 }; });
	await h.reader.read(); h.advance(31_000); failing = true;
	const failed = await h.reader.read();
	assert.equal(failed.value.used, 62); assert.equal(failed.updatedAt, START);
	assert.equal(failed.retryAt - failed.checkedAt, 60_000);
	await h.reader.read({ fresh: true }); assert.equal(calls, 2);
	h.advance(60_000);
	const again = await h.reader.read(); assert.equal(again.retryAt - again.checkedAt, 120_000);
	h.advance(120_000); failing = false;
	const recovered = await h.reader.read();
	assert.equal(recovered.error, undefined); assert.equal(recovered.failures, 0);
});

test("HTTP Retry-After supports seconds and dates and is not bypassed", async () => {
	assert.equal(httpError("API", { status: 429, headers: { get: () => "600" } }, START).retryAfterMs, 600_000);
	assert.equal(httpError("API", { status: 429, headers: { get: () => new Date(START + 900_000).toUTCString() } }, START).retryAfterMs, 900_000);
	assert.equal(httpError("API", { status: 429, headers: { get: () => "invalid" } }, START).retryAfterMs, undefined);
	let calls = 0;
	const h = readerHarness(async () => { calls++; throw new UsageError("429", 900_000); });
	const value = await h.reader.read(); assert.equal(value.retryAt, START + 900_000);
	h.advance(600_000); await h.reader.read({ fresh: true }); assert.equal(calls, 1);
});

test("separate readers share snapshots and error cooldowns", async () => {
	const store = memoryStore();
	let calls = 0;
	const one = readerHarness(async () => { calls++; throw new UsageError("429", 300_000); }, { store });
	const two = readerHarness(async () => { calls++; return { used: 0 }; }, { store });
	await one.reader.read();
	const value = await two.reader.read({ fresh: true });
	assert.equal(calls, 1); assert.equal(value.error, "429");
});

test("account changes do not reuse the previous login's snapshot", async () => {
	let account = "a";
	let calls = 0;
	const h = readerHarness(async () => ({ used: ++calls }), { scope: async () => account });
	assert.equal((await h.reader.read()).value.used, 1);
	account = "b"; assert.equal((await h.reader.read()).value.used, 2);
});

test("broken cache storage falls back to an in-process cache", async () => {
	let calls = 0;
	const bad = async () => { throw new Error("read-only filesystem"); };
	const h = readerHarness(async () => ({ used: ++calls }), { store: { read: bad, write: bad, lock: bad } });
	assert.equal((await h.reader.read()).value.used, 1);
	assert.equal((await h.reader.read()).value.used, 1);
});

test("shared file cache serializes competing readers and redacts persisted errors", async (t) => {
	const dir = await mkdtemp(join(tmpdir(), "pi-usage-")); t.after(() => rm(dir, { recursive: true, force: true }));
	const store = fileStore(dir);
	let calls = 0;
	const fetch = async () => { calls++; await new Promise((resolve) => setTimeout(resolve, 25)); return { used: 28 }; };
	const one = createUsageReader({ fetch, scope: async () => "same-user", store });
	const two = createUsageReader({ fetch, scope: async () => "same-user", store });
	await Promise.all([one.read(), two.read()]);
	assert.equal(calls, 1);
	const files = await readdir(dir); assert.equal(files.filter((f) => f.endsWith("lock")).length, 0);
	const path = join(dir, files.find((f) => f.endsWith("json")));
	assert.equal((await stat(path)).mode & 0o777, 0o600);
	await store.write("error", { checkedAt: Date.now(), failures: 1, error: "secret from stderr" });
	const contents = await Promise.all((await readdir(dir)).map((file) => readFile(join(dir, file), "utf8")));
	assert.equal(contents.join("").includes("secret from stderr"), false);
	await writeFile(path, "{corrupt"); assert.equal(await store.read("same-user"), undefined);
});

test("different OS processes share one underlying quota request", { timeout: 10_000 }, async (t) => {
	const dir = await mkdtemp(join(tmpdir(), "pi-usage-process-")); t.after(() => rm(dir, { recursive: true, force: true }));
	const module = new URL("../stow/pi/.pi/agent/extensions/usage-support/cache.ts", import.meta.url).href;
	const script = `import { createUsageReader, fileStore } from ${JSON.stringify(module)};
		import { appendFile } from 'node:fs/promises';
		const reader = createUsageReader({scope: async () => 'one-account', store: fileStore(process.argv[1]), fetch: async () => {
			await appendFile(process.argv[1] + '/requests', 'request\\n');
			await new Promise(r => setTimeout(r, 100)); return {used: 33};
		}}); console.log(JSON.stringify(await reader.read()));`;
	function run() {
		return new Promise((resolve, reject) => {
			const child = spawn(process.execPath, ["--input-type=module", "-e", script, dir]);
			t.after(() => child.kill());
			let out = "", err = "";
			child.stdout.on("data", (data) => { out += data; }); child.stderr.on("data", (data) => { err += data; });
			child.on("error", reject); child.on("exit", (code) => code === 0 ? resolve(JSON.parse(out)) : reject(new Error(err)));
		});
	}
	const results = await Promise.all([run(), run()]);
	assert.deepEqual(results.map((value) => value.value.used), [33, 33]);
	assert.equal(await readFile(join(dir, "requests"), "utf8"), "request\n");
});

test("dead-process locks recover; old owner cannot release a replacement lock", async (t) => {
	const dir = await mkdtemp(join(tmpdir(), "pi-usage-lock-")); t.after(() => rm(dir, { recursive: true, force: true }));
	const store = fileStore(dir);
	const oldRelease = await store.lock("account");
	const lock = join(dir, (await readdir(dir)).find((name) => name.endsWith(".lock")));
	await writeFile(lock, JSON.stringify({ pid: 2147483647, token: "dead" }));
	const past = new Date(Date.now() - 5_000); await utimes(lock, past, past);
	const newRelease = await store.lock("account");
	await oldRelease(); assert.equal((await readdir(dir)).length, 1);
	await newRelease(); assert.equal((await readdir(dir)).length, 0);
});

test("credential fingerprints isolate files and rotate without storing secrets", async (t) => {
	const dir = await mkdtemp(join(tmpdir(), "pi-usage-auth-")); t.after(() => rm(dir, { recursive: true, force: true }));
	const file = join(dir, "auth.json");
	const missing = await credentialScope("codex", file);
	await writeFile(file, '{"token":"secret-a"}');
	const first = await credentialScope("codex", file);
	await writeFile(file, '{"token":"secret-b"}');
	const second = await credentialScope("codex", file);
	assert.notEqual(first, second); assert.notEqual(missing, first);
	assert.match(first, /^[a-f0-9]{64}$/); assert.equal(first.includes("secret"), false);
});

function pollHarness(t, { reset, customReader } = {}) {
	t.mock.timers.enable({ apis: ["setInterval", "Date"], now: START });
	const handlers = new Map(), commands = new Map();
	const updates = [], notices = [], reads = [];
	const listeners = new Set();
	let next;
	const reader = customReader ?? {
		async read(options) {
			reads.push({ at: Date.now(), options });
			const value = next ?? { value: { used: 62, reset }, checkedAt: Date.now(), updatedAt: Date.now(), failures: 0 };
			for (const listener of listeners) listener(value);
			return value;
		},
		subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
	};
	const ctx = { hasUI: true, model: { provider: "openai", id: "codex-model" }, ui: { theme: { fg: (_color, value) => value }, notify: (message) => notices.push(message) } };
	const pi = {
		on(event, handler) { handlers.set(event, [...(handlers.get(event) ?? []), handler]); },
		registerCommand(name, value) { commands.set(name, value); },
		events: { emit: (_name, value) => updates.push(value) },
	};
	installUsagePolling(pi, { key: "codex-usage", label: "Codex", reader, selected: (model) => model?.provider === "openai", format: (value) => ({ status: `Codex: ${value.used}%`, details: `${value.used}% used` }), missing: "No login", resets: (value) => value.reset ? [value.reset] : [], now: () => Date.now(), random: () => 0 });
	const emit = async (event) => { for (const handler of handlers.get(event) ?? []) await handler({}, ctx); await flush(); };
	t.after(() => emit("session_shutdown"));
	return { ctx, emit, reads, updates, notices, command: () => commands.get("codex-usage").handler("", ctx), setNext: (value) => { next = value; } };
}

test("selected provider polls every 5m while running and never while idle", async (t) => {
	const h = pollHarness(t); await h.emit("session_start"); await h.emit("agent_start");
	t.mock.timers.tick(295_000); await flush(); assert.equal(h.reads.length, 1);
	t.mock.timers.tick(5_000); await flush(); assert.equal(h.reads.length, 2);
	await h.emit("agent_settled"); const count = h.reads.length;
	t.mock.timers.tick(3_600_000); await flush(); assert.equal(h.reads.length, count);
	assert.equal(h.updates.at(-1).status, "Codex: 62%"); // No age or timestamp in the statusline.
	await h.emit("agent_start"); t.mock.timers.tick(5_000); await flush(); assert.equal(h.reads.length, count + 1); // Stale data refreshes when work resumes.
});

test("inactive provider polls only every 10m while running; switching models refreshes it", async (t) => {
	const h = pollHarness(t); h.ctx.model.provider = "pi-claude-cli";
	await h.emit("session_start"); await h.emit("agent_start");
	t.mock.timers.tick(595_000); await flush(); assert.equal(h.reads.length, 1);
	t.mock.timers.tick(5_000); await flush(); assert.equal(h.reads.length, 2);
	h.ctx.model.provider = "openai"; await h.emit("model_select"); assert.equal(h.reads.length, 3);
});

test("refreshes just after expected reset, and manual commands request fresh data", async (t) => {
	const h = pollHarness(t, { reset: START + 120_000 }); await h.emit("session_start"); await h.emit("agent_start");
	t.mock.timers.tick(145_000); await flush(); assert.equal(h.reads.length, 1);
	t.mock.timers.tick(5_000); await flush(); assert.equal(h.reads.length, 2);
	assert.equal(h.reads.at(-1).options.fresh, true);
	await h.command(); assert.equal(h.reads.at(-1).options.fresh, true);
});

test("failed refresh keeps last known values with only a compact warning", async (t) => {
	const h = pollHarness(t); await h.emit("session_start");
	h.setNext({ value: { used: 62 }, checkedAt: START, updatedAt: START, failures: 1, error: "429", retryAt: START + 600_000 });
	await h.command();
	assert.equal(h.updates.at(-1).status, "Codex: 62% !");
	const count = h.reads.length;
	t.mock.timers.tick(595_000); await flush(); assert.equal(h.reads.length, count);
});

test("background updates made by Auto-Resume reach the display immediately", async (t) => {
	const real = readerHarness(async () => ({ used: 19 }));
	const h = pollHarness(t, { customReader: real.reader });
	await h.emit("session_start");
	real.advance(10_000);
	await real.reader.read({ fresh: true });
	assert.equal(h.updates.at(-1).status, "Codex: 19%");
});

test("shutdown unsubscribes and prevents late usage results repainting the UI", async (t) => {
	let finish;
	const h = pollHarness(t, { customReader: { read: () => new Promise((resolve) => { finish = resolve; }), subscribe: () => () => {} } });
	await h.emit("session_start"); await h.emit("session_shutdown");
	const count = h.updates.length;
	finish({ value: { used: 77 }, checkedAt: START, failures: 0 }); await flush();
	t.mock.timers.tick(1_000_000); await flush(); assert.equal(h.updates.length, count);
});

test("footer aggregator preserves cached startup events from earlier extensions", async () => {
	const handlers = new Map(); const bus = new Map(); const painted = [];
	usageStatus({ on: (name, handler) => handlers.set(name, handler), events: { on: (name, handler) => bus.set(name, handler) } });
	bus.get("usage-status:update")({ key: "codex-usage", status: "Codex: 12%" });
	handlers.get("session_start")({}, { ui: { setStatus: (_key, value) => painted.push(value) } });
	assert.equal(painted.at(-1), "Codex: 12%");
});

test("exclusive Auto-Resume status hides all other usage indicators until cleared", () => {
	const handlers = new Map(); const bus = new Map(); const painted = [];
	usageStatus({ on: (name, handler) => handlers.set(name, handler), events: { on: (name, handler) => bus.set(name, handler) } });
	handlers.get("session_start")({}, { ui: { setStatus: (_key, value) => painted.push(value) } });
	const emit = (data) => bus.get("usage-status:update")(data);
	emit({ key: "claude-usage", status: "Claude: 5h 99%" }); emit({ key: "codex-usage", status: "Codex: 12%" });
	emit({ key: "auto-resume", status: "Auto-Resume: resuming in 1h", exclusive: true });
	assert.equal(painted.at(-1), "Auto-Resume: resuming in 1h");
	emit({ key: "auto-resume", status: undefined });
	assert.equal(painted.at(-1), "Claude: 5h 99% | Codex: 12%");
});
