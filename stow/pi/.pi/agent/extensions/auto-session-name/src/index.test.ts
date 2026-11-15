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
				return { result: async () => ({ stopReason: "stop", content: [{ type: "text", text: nextTitle }] }) };
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
