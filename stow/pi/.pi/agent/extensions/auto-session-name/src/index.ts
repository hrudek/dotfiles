/**
 * Auto session names: give every pi session a short English title that says
 * what it is about ("OAuth", "Tab Titles"), so terminal tabs and the /resume
 * picker can be told apart at a glance.
 *
 * pi already writes the session name into the terminal title
 * (`π - <name> - <cwd>`), where tab-naming tools such as herdr plugins pick it
 * up. This extension only sets the name; it knows nothing about herdr.
 *
 * - A title is generated after the first complete agent answer, and retried
 *   after later answers if there is no identifiable topic yet.
 * - Long runs get a provisional title after three minutes, refined on completion.
 * - Aborted or failed runs cancel the timer and do not trigger final naming.
 * - Names you set yourself (/name) are never overwritten.
 * - /new starts unnamed and gets a fresh title; /resume keeps the stored one.
 * - /fork inherits the parent's title and replaces it after the first complete
 *   answer in the fork, unless the parent's name was set by hand.
 * - /retitle regenerates the title from the current conversation.
 *
 * The naming model defaults to the first available entry of PREFERRED_MODELS
 * and can be overridden with PI_AUTO_SESSION_NAME_MODEL=provider/model-id.
 * If a request fails (usage limit, outage, timeout), the next candidate is
 * tried, ending with a Claude model and the session model. A failed model is
 * moved to the end of the list for a cooldown so later titles do not wait for it.
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

/** How long a failed naming model is tried only after all others. */
const MODEL_COOLDOWN_MS = 15 * 60 * 1000;

const FALLBACK_DELAY_MS = 3 * 60 * 1000;
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
	let provisionalTitle = false;
	let generationEpoch = 0;
	let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
	let fallbackRequest: Promise<Result> | undefined;
	/** provider/id → time until which the model is deprioritized after a failure. */
	const cooldowns = new Map<string, number>();

	function clearFallback(): void {
		if (fallbackTimer !== undefined) clearTimeout(fallbackTimer);
		fallbackTimer = undefined;
	}

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
		return (retitleAfterFork || provisionalTitle) && isAutoNamed(ctx);
	}

	async function generate(ctx: ExtensionContext, force = false, provisional = false): Promise<Result> {
		if (running) return { ok: false, reason: "a title is already being generated" };
		const epoch = generationEpoch;
		running = true;
		try {
			const nameBefore = pi.getSessionName();
			const autoBefore = isAutoNamed(ctx);

			const messages = collectMessages(ctx);
			const transcript = buildTranscript(messages);
			if (!transcript) return { ok: false, reason: "no conversation yet" };

			const models = resolveModels(ctx);
			if (models.length === 0) {
				failures = MAX_AUTO_FAILURES;
				return { ok: false, reason: "no naming model with configured auth" };
			}

			const otherTitles = await recentTitles(ctx);
			const prompt = buildUserPrompt({ transcript, project: basename(ctx.cwd), otherTitles });

			let model: Model | undefined;
			let response: Awaited<ReturnType<typeof requestTitle>> | undefined;
			const errors: string[] = [];
			for (const candidate of models) {
				let reason: string;
				try {
					const attempt = await requestTitle(ctx, candidate, prompt);
					// The session may have been replaced (/new, /resume, quit) meanwhile.
					if (!active || epoch !== generationEpoch) return { ok: false, reason: "session or run changed" };
					if (attempt.stopReason !== "error" && attempt.stopReason !== "aborted") {
						cooldowns.delete(modelKey(candidate));
						model = candidate;
						response = attempt;
						break;
					}
					reason = attempt.errorMessage ?? `request ${attempt.stopReason}`;
				} catch (error) {
					if (!active || epoch !== generationEpoch) return { ok: false, reason: "session or run changed" };
					reason = error instanceof Error ? error.message : String(error);
				}
				cooldowns.set(modelKey(candidate), Date.now() + MODEL_COOLDOWN_MS);
				errors.push(`${modelKey(candidate)}: ${reason}`);
			}
			if (!model || !response) {
				failures++;
				return { ok: false, reason: errors.join("; ") };
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
			provisionalTitle = provisional;
			if (title !== pi.getSessionName()) pi.setSessionName(title);
			pi.appendEntry(ENTRY_TYPE, { name: title, model: `${model.provider}/${model.id}`, provisional });
			return { ok: true, title };
		} catch (error) {
			if (epoch === generationEpoch) failures++;
			return { ok: false, reason: error instanceof Error ? error.message : String(error) };
		} finally {
			if (epoch === generationEpoch) running = false;
		}
	}

	/** All usable naming models in order of preference; recently failed ones last. */
	function resolveModels(ctx: ExtensionContext): Model[] {
		const candidates: Model[] = [];
		const add = (m: Model | undefined) => {
			if (!m || !ctx.modelRegistry.hasConfiguredAuth(m)) return;
			if (candidates.some((c) => modelKey(c) === modelKey(m))) return;
			candidates.push(m);
		};

		const override = process.env[MODEL_ENV]?.trim();
		if (override) {
			const slash = override.indexOf("/");
			if (slash > 0) add(ctx.modelRegistry.find(override.slice(0, slash), override.slice(slash + 1)));
		}
		for (const [provider, id] of PREFERRED_MODELS) add(ctx.modelRegistry.find(provider, id));
		add(ctx.model);

		const now = Date.now();
		const cooling = (m: Model) => (cooldowns.get(modelKey(m)) ?? 0) > now;
		return [...candidates.filter((m) => !cooling(m)), ...candidates.filter(cooling)];
	}

	pi.on("session_start", async (event, ctx) => {
		clearFallback();
		generationEpoch++;
		fallbackRequest = undefined;
		const lastAutoEntry = ctx.sessionManager.getBranch().findLast(
			(entry) => entry.type === "custom" && entry.customType === ENTRY_TYPE,
		);
		provisionalTitle = lastAutoEntry?.type === "custom" &&
			(lastAutoEntry.data as { provisional?: boolean } | undefined)?.provisional === true;
		active = true;
		failures = 0;
		running = false;
		retitleAfterFork = event.reason === "fork" && isAutoNamed(ctx);
	});

	pi.on("session_shutdown", async () => {
		clearFallback();
		generationEpoch++;
		active = false;
		running = false;
		fallbackRequest = undefined;
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (event.messageType !== "user" || !needsTitle(ctx) || provisionalTitle || fallbackTimer !== undefined) return;
		fallbackTimer = setTimeout(() => {
			fallbackTimer = undefined;
			if (active && needsTitle(ctx)) fallbackRequest = generate(ctx, false, true);
		}, FALLBACK_DELAY_MS);
		fallbackTimer.unref();
	});

	// Wait for a complete answer, not an intermediate tool-calling message.
	// Settled also fires after errors and cancellation; neither should name a session.
	pi.on("agent_settled", async (event, ctx) => {
		clearFallback();
		const lastMessage = ctx.sessionManager.getBranch().findLast((entry) => entry.type === "message");
		const message = lastMessage?.type === "message" ? lastMessage.message : undefined;
		if (event.aborted || message?.role !== "assistant" || message.stopReason !== "stop" || !textOf(message.content).trim()) {
			generationEpoch++;
			running = false;
			fallbackRequest = undefined;
			return;
		}
		const epoch = generationEpoch;
		// If completion races the fallback request, refine only after it has finished.
		await fallbackRequest;
		if (!active || epoch !== generationEpoch) return;
		fallbackRequest = undefined;
		if (!needsTitle(ctx)) return;
		void generate(ctx);
	});

	pi.registerCommand("retitle", {
		description: "Regenerate the short session title from the conversation",
		handler: async (_args, ctx) => {
			const result = await generate(ctx, true);
			if (result.ok) ctx.ui.notify(`Session titled: ${result.title}`, "info");
			else ctx.ui.notify(`No new title: ${result.reason}`, "warning");
		},
	});
}

function modelKey(model: Model): string {
	return `${model.provider}/${model.id}`;
}

async function requestTitle(ctx: ExtensionContext, model: Model, prompt: string) {
	const stream = await ctx.modelRegistry.streamSimple(
		model,
		{
			systemPrompt: SYSTEM_PROMPT,
			messages: [{ role: "user", content: [{ type: "text", text: prompt }], timestamp: Date.now() }],
		},
		{
			reasoning: "minimal",
			maxTokens: MAX_OUTPUT_TOKENS,
			cacheRetention: "none",
			timeoutMs: REQUEST_TIMEOUT_MS,
		},
	);
	return stream.result();
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
