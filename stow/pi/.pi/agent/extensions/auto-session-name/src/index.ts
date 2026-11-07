/**
 * Auto session names: give every pi session a short English title that says
 * what it is about ("OAuth", "Tab Titles"), so terminal tabs and the /resume
 * picker can be told apart at a glance.
 *
 * pi already writes the session name into the terminal title
 * (`π - <name> - <cwd>`), where tab-naming tools such as herdr plugins pick it
 * up. This extension only sets the name; it knows nothing about herdr.
 *
 * - A title is generated as soon as the first prompt is sent, and retried
 *   after the run if the prompt had no identifiable topic yet.
 * - Names you set yourself (/name) are never overwritten.
 * - /new starts unnamed and gets a fresh title; /resume keeps the stored one.
 * - /fork inherits the parent's title and replaces it after the first prompt
 *   in the fork, unless the parent's name was set by hand.
 * - /retitle regenerates the title from the current conversation.
 *
 * The naming model defaults to the first available entry of PREFERRED_MODELS
 * and can be overridden with PI_AUTO_SESSION_NAME_MODEL=provider/model-id.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	buildTranscript,
	buildUserPrompt,
	cleanTitle,
	SYSTEM_PROMPT,
	type TranscriptMessage,
} from "./title.ts";

const ENTRY_TYPE = "auto-session-name";
const MODEL_ENV = "PI_AUTO_SESSION_NAME_MODEL";

/** Cheap, fast models tried in order before falling back to the session model. */
const PREFERRED_MODELS: ReadonlyArray<readonly [provider: string, id: string]> = [
	["openai", "gpt-6-luna"],
	["openai", "gpt-5.4-mini"],
	["pi-claude-cli", "claude-haiku-4-5"],
];

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_TOKENS = 512;
/** Failed requests (not "no topic yet") before automatic naming gives up; /retitle is not limited. */
const MAX_AUTO_FAILURES = 3;

const OTHER_SESSIONS_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const OTHER_SESSIONS_MAX_FILES = 20;
const OTHER_TITLES_MAX = 12;

type Model = NonNullable<ExtensionContext["model"]>;
type Result = { ok: true; title: string } | { ok: false; reason: string };

export default function autoSessionName(pi: ExtensionAPI): void {
	let active = false;
	let running = false;
	let failures = 0;
	let retitleAfterFork = false;

	function autoName(ctx: ExtensionContext): string | undefined {
		let name: string | undefined;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type === "custom" && entry.customType === ENTRY_TYPE) {
				name = (entry.data as { name?: string } | undefined)?.name;
			}
		}
		return name;
	}

	function isAutoNamed(ctx: ExtensionContext): boolean {
		const name = pi.getSessionName();
		return !!name && name === autoName(ctx);
	}

	function needsTitle(ctx: ExtensionContext): boolean {
		if (!ctx.hasUI || running || failures >= MAX_AUTO_FAILURES) return false;
		if (!pi.getSessionName()) return true;
		return retitleAfterFork && isAutoNamed(ctx);
	}

	async function generate(ctx: ExtensionContext, pendingPrompt?: string, force = false): Promise<Result> {
		if (running) return { ok: false, reason: "a title is already being generated" };
		running = true;
		try {
			const nameBefore = pi.getSessionName();
			const autoBefore = isAutoNamed(ctx);

			const messages = collectMessages(ctx);
			if (pendingPrompt?.trim() && !(messages.at(-1)?.role === "user" && messages.at(-1)?.text === pendingPrompt)) {
				messages.push({ role: "user", text: pendingPrompt });
			}
			const transcript = buildTranscript(messages);
			if (!transcript) return { ok: false, reason: "no conversation yet" };

			const model = resolveModel(ctx);
			if (!model) {
				failures = MAX_AUTO_FAILURES;
				return { ok: false, reason: "no naming model with configured auth" };
			}

			const otherTitles = await recentTitles(ctx);
			const stream = await ctx.modelRegistry.streamSimple(
				model,
				{
					systemPrompt: SYSTEM_PROMPT,
					messages: [
						{
							role: "user",
							content: [
								{
									type: "text",
									text: buildUserPrompt({ transcript, project: basename(ctx.cwd), otherTitles }),
								},
							],
							timestamp: Date.now(),
						},
					],
				},
				{
					reasoning: "minimal",
					maxTokens: MAX_OUTPUT_TOKENS,
					cacheRetention: "none",
					timeoutMs: REQUEST_TIMEOUT_MS,
				},
			);
			const response = await stream.result();

			// The session may have been replaced (/new, /resume, quit) meanwhile.
			if (!active) return { ok: false, reason: "session changed" };
			if (response.stopReason === "error" || response.stopReason === "aborted") {
				failures++;
				return { ok: false, reason: response.errorMessage ?? `request ${response.stopReason}` };
			}

			const text = response.content
				.flatMap((block) => (block.type === "text" ? [block.text] : []))
				.join("\n");
			const title = cleanTitle(text);
			if (!title) return { ok: false, reason: "no identifiable topic yet" };

			// Respect a /name issued while the request was running.
			if (!force && (pi.getSessionName() !== nameBefore || isAutoNamed(ctx) !== autoBefore)) {
				return { ok: false, reason: "renamed meanwhile" };
			}

			failures = 0;
			retitleAfterFork = false;
			if (title !== pi.getSessionName()) pi.setSessionName(title);
			pi.appendEntry(ENTRY_TYPE, { name: title, model: `${model.provider}/${model.id}` });
			return { ok: true, title };
		} catch (error) {
			failures++;
			return { ok: false, reason: error instanceof Error ? error.message : String(error) };
		} finally {
			running = false;
		}
	}

	function resolveModel(ctx: ExtensionContext): Model | undefined {
		const usable = (m: Model | undefined): m is Model => !!m && ctx.modelRegistry.hasConfiguredAuth(m);

		const override = process.env[MODEL_ENV]?.trim();
		if (override) {
			const slash = override.indexOf("/");
			const model =
				slash > 0 ? ctx.modelRegistry.find(override.slice(0, slash), override.slice(slash + 1)) : undefined;
			if (usable(model)) return model;
		}
		for (const [provider, id] of PREFERRED_MODELS) {
			const model = ctx.modelRegistry.find(provider, id);
			if (usable(model)) return model;
		}
		return usable(ctx.model) ? ctx.model : undefined;
	}

	pi.on("session_start", async (event, ctx) => {
		active = true;
		failures = 0;
		running = false;
		retitleAfterFork = event.reason === "fork" && isAutoNamed(ctx);
	});

	pi.on("session_shutdown", async () => {
		active = false;
	});

	// Title from the first prompt right away instead of after a long run.
	pi.on("before_agent_start", async (event, ctx) => {
		if (event.messageType !== "user" || !needsTitle(ctx)) return;
		void generate(ctx, event.prompt);
	});

	// Retry once the run is done, e.g. when the first prompt was just "hi".
	pi.on("agent_settled", async (_event, ctx) => {
		if (!needsTitle(ctx)) return;
		void generate(ctx);
	});

	pi.registerCommand("retitle", {
		description: "Regenerate the short session title from the conversation",
		handler: async (_args, ctx) => {
			const result = await generate(ctx, undefined, true);
			if (result.ok) ctx.ui.notify(`Session titled: ${result.title}`, "info");
			else ctx.ui.notify(`No new title: ${result.reason}`, "warning");
		},
	});
}

function collectMessages(ctx: ExtensionContext): TranscriptMessage[] {
	const messages: TranscriptMessage[] = [];
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "message") continue;
		const { role, content } = entry.message as { role?: string; content?: unknown };
		if (role !== "user" && role !== "assistant") continue;
		const text = textOf(content);
		if (text.trim()) messages.push({ role, text });
	}
	return messages;
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.flatMap((block) =>
			block && typeof block === "object" && block.type === "text" && typeof block.text === "string" ? [block.text] : [],
		)
		.join("\n");
}

/** Names of other recently active sessions in the same project directory. */
async function recentTitles(ctx: ExtensionContext): Promise<string[]> {
	try {
		const dir = ctx.sessionManager.getSessionDir();
		const current = ctx.sessionManager.getSessionFile();
		const now = Date.now();

		const files = await Promise.all(
			(await readdir(dir))
				.filter((file) => file.endsWith(".jsonl"))
				.map((file) => join(dir, file))
				.filter((path) => path !== current)
				.map(async (path) => ({ path, mtime: (await stat(path)).mtimeMs })),
		);
		const recent = files
			.filter((f) => now - f.mtime <= OTHER_SESSIONS_MAX_AGE_MS)
			.sort((a, b) => b.mtime - a.mtime)
			.slice(0, OTHER_SESSIONS_MAX_FILES);

		const titles: string[] = [];
		for (const { path } of recent) {
			const name = lastSessionName(await readFile(path, "utf8"));
			if (name && !titles.includes(name)) titles.push(name);
			if (titles.length >= OTHER_TITLES_MAX) break;
		}
		return titles;
	} catch {
		return [];
	}
}

function lastSessionName(jsonl: string): string | undefined {
	const lines = jsonl.split("\n");
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = lines[i]!;
		if (!line.includes('"session_info"')) continue;
		try {
			const entry = JSON.parse(line) as { type?: string; name?: string };
			if (entry.type === "session_info") return entry.name?.trim() || undefined;
		} catch {
			// Ignore a partially written line.
		}
	}
	return undefined;
}
