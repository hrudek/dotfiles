/** Wait out subscription limits while Pi stays open. No provider/billing changes. */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readRateLimits } from "../codex-usage.ts";
import { readClaudeUsage } from "../claude-usage.ts";
import { exhausted, isBillingError, isCancelKey, isLimitError, nextAttempt, providerFor, resetHint, type Provider, type Window } from "./limits.ts";

const KEY = "auto-resume";
const SETTINGS = "auto-resume-settings";
const STATUS_EVENT = "usage-status:update";

export async function readWindows(provider: Provider, model: string): Promise<Window[]> {
	if (provider === "codex") {
		const snapshot = await readRateLimits({ fresh: true });
		if (snapshot.error) throw new Error(snapshot.error); // Never use stale cached quota for recovery.
		const usage = snapshot.value;
		return [usage?.rateLimits?.primary, usage?.rateLimits?.secondary]
			.filter((window) => typeof window?.usedPercent === "number")
			.map((window) => ({ used: window!.usedPercent!, resetAt: window!.resetsAt == null ? undefined : window!.resetsAt * 1_000 }));
	}
	const snapshot = await readClaudeUsage({ fresh: true });
	if (snapshot.error) throw new Error(snapshot.error);
	const usage = snapshot.value;
	const specific = /opus/i.test(model) ? usage?.seven_day_opus : /sonnet/i.test(model) ? usage?.seven_day_sonnet : undefined;
	return [usage?.five_hour, usage?.seven_day, specific]
		.filter((window) => typeof window?.utilization === "number")
		.map((window) => ({ used: window!.utilization!, resetAt: window!.resets_at ? Date.parse(window!.resets_at) : undefined }));
}

interface Failure {
	provider: string;
	model: string;
	errorMessage: string;
	resetAt?: number; // Unix milliseconds, from pi-claude-cli's rate-limit diagnostic
}
interface Pending {
	ctx: ExtensionContext;
	provider: Provider;
	model: string;
	session: string;
	anchor: string | undefined;
	hint?: number;
	due?: number;
	checking: boolean;
}
interface Dependencies {
	readWindows: typeof readWindows;
	now: () => number;
}

/** Exported for offline lifecycle tests; the normal factory uses real usage readers. */
export function setupAutoResume(pi: ExtensionAPI, deps: Dependencies = { readWindows, now: Date.now }) {
	let enabled = true;
	let active = false;
	let attempts = 1;
	let failure: Failure | undefined;
	let headers: Record<string, string> = {};
	let pending: Pending | undefined;
	let timer: ReturnType<typeof setInterval> | undefined;
	let removeTerminalInput: (() => void) | undefined;

	function anchor(ctx: ExtensionContext) {
		return ctx.sessionManager.getBranch().findLast((entry) => entry.type === "message" || entry.type === "compaction" || entry.type === "context_edit")?.id;
	}

	function cancel(ctx: ExtensionContext, notify = false) {
		const wasPending = !!pending;
		pending = undefined; // Invalidates in-flight usage reads, including after /reload.
		if (timer) clearInterval(timer);
		timer = undefined;
		pi.events.emit(STATUS_EVENT, { key: KEY, status: undefined });
		ctx.ui.setWidget(KEY, undefined);
		if (notify && wasPending) ctx.ui.notify("Auto-Resume: scheduled resume cancelled.", "info");
	}

	function current(p: Pending) {
		return active && enabled && pending === p && p.ctx.isIdle() && !p.ctx.hasPendingMessages()
			&& p.ctx.sessionManager.getSessionId() === p.session && anchor(p.ctx) === p.anchor;
	}

	function render(p: Pending) {
		const title = p.provider === "codex" ? "Codex" : "Claude";
		const seconds = p.due ? Math.max(0, Math.ceil((p.due - deps.now()) / 1_000)) : 0;
		const countdown = `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m ${seconds % 60}s`;
		const state = p.checking ? "checking usage limit …" : `resuming in ${countdown}`;
		// The aggregator hides all usage indicators while this is shown, keeping the footer short.
		pi.events.emit(STATUS_EVENT, { key: KEY, status: p.ctx.ui.theme.fg("warning", `Auto-Resume · ${title}: ${state}`), exclusive: true });
		p.ctx.ui.setWidget(KEY, [
			`Auto-Resume · ${title}: ${state}${p.due ? ` (${new Date(p.due).toLocaleString()})` : ""}`,
			"Esc or /auto-resume cancel: cancel · /auto-resume off: disable",
		]);
	}

	async function usage(p: Pending): Promise<Window[]> {
		try { return await deps.readWindows(p.provider, p.model); }
		catch { return []; } // Usage endpoint failure: fall back to conservative model retries.
	}

	async function check(p: Pending, initial: boolean) {
		p.checking = true;
		render(p);
		const windows = await usage(p);
		if (!current(p)) {
			if (pending === p) cancel(p.ctx);
			return;
		}
		if (initial || exhausted(windows).length > 0) {
			p.due = nextAttempt(deps.now(), windows, initial ? p.hint : undefined, attempts++);
			p.checking = false;
			render(p);
			if (initial) p.ctx.ui.notify(`Auto-Resume: ${p.provider === "codex" ? "Codex" : "Claude"}limit reached. Next attempt: ${new Date(p.due).toLocaleString()}.`, "warning");
			return;
		}
		cancel(p.ctx);
		failure = undefined;
		// Custom, extension-authored continuation, not a forged human prompt.
		pi.sendMessage({
			customType: KEY,
			content: "The usage limit interrupted the previous request. The wait is over. Continue the unfinished task based on the conversation so far. Check the current state of the work and do not repeat actions that already succeeded. If the task is already done, do not start new work.",
			display: true,
		}, { triggerTurn: true });
	}

	function launch(ctx: ExtensionContext) {
		const provider = providerFor(ctx.model);
		if (!active || !enabled || !ctx.hasUI || !provider || !failure || pending || !ctx.isIdle() || ctx.hasPendingMessages()) return;
		if (failure.provider !== ctx.model?.provider || failure.model !== ctx.model?.id) return;
		if (!isLimitError(failure.errorMessage)) {
			if (isBillingError(failure.errorMessage)) {
				ctx.ui.notify("Auto-Resume will not wait: billing/usage-credit errors are never retried automatically. Please check and continue manually.", "warning");
				failure = undefined;
			}
			return;
		}
		const textHint = resetHint(failure.errorMessage, headers, deps.now());
		const hint = Math.max(textHint ?? 0, failure.resetAt && failure.resetAt > deps.now() ? failure.resetAt : 0) || undefined;
		const p: Pending = { ctx, provider, model: failure.model, session: ctx.sessionManager.getSessionId(), anchor: anchor(ctx), hint, checking: true };
		pending = p;
		// One short timer supports arbitrarily long waits without setTimeout overflow.
		timer = setInterval(() => {
			if (!current(p)) { if (pending === p) cancel(ctx); return; }
			if (p.checking) return;
			if (p.due !== undefined && deps.now() >= p.due) runCheck(p, false);
			else render(p);
		}, 1_000);
		timer.unref();
		runCheck(p, true);
	}

	function runCheck(p: Pending, initial: boolean) {
		void check(p, initial).catch((error) => {
			if (pending !== p) return;
			cancel(p.ctx);
			p.ctx.ui.notify(`Auto-Resume stopped: ${error instanceof Error ? error.message : String(error)}`, "error");
		});
	}

	pi.on("session_start", (_event, ctx) => {
		active = true;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type === "custom" && entry.customType === SETTINGS && typeof (entry.data as { enabled?: unknown })?.enabled === "boolean") enabled = (entry.data as { enabled: boolean }).enabled;
		}
		if (ctx.mode === "tui") removeTerminalInput = ctx.ui.onTerminalInput((data) => {
			// Only intercept Escape/Ctrl+C while waiting, never while the agent runs.
			if (pending && isCancelKey(data)) {
				cancel(ctx, true);
				failure = undefined;
				attempts = 1;
				return { consume: true };
			}
		});
	});
	pi.on("session_shutdown", (_event, ctx) => {
		active = false;
		cancel(ctx);
		removeTerminalInput?.();
		removeTerminalInput = undefined;
	});
	pi.on("input", (_event, ctx) => { cancel(ctx); failure = undefined; attempts = 1; });
	pi.on("before_agent_start", (_event, ctx) => { cancel(ctx); failure = undefined; headers = {}; });
	pi.on("before_provider_request", () => { headers = {}; });
	pi.on("after_provider_response", (event) => { headers = event.status === 429 ? event.headers : {}; });
	pi.on("message_end", (event) => {
		if (event.message.role !== "assistant") return;
		const message = event.message;
		const limit = (message as { diagnostics?: { type?: string; details?: { status?: string; resetsAt?: number } }[] }).diagnostics
			?.find((entry) => entry.type === "pi-claude-cli.rate-limit")?.details;
		failure = message.stopReason === "error" && message.errorMessage
			? { provider: message.provider, model: message.model, errorMessage: message.errorMessage,
				resetAt: limit?.status === "rejected" && typeof limit.resetsAt === "number" ? limit.resetsAt * 1_000 : undefined } : undefined;
		if (message.stopReason !== "error") attempts = 1;
	});
	pi.on("session_compact_failed", (event, ctx) => {
		if (event.reason !== "manual" && !event.aborted && event.errorMessage && ctx.model) {
			failure = { provider: ctx.model.provider, model: ctx.model.id, errorMessage: event.errorMessage };
		}
	});
	pi.on("agent_settled", (event, ctx) => {
		if (event.aborted) { cancel(ctx); failure = undefined; return; }
		launch(ctx);
	});
	for (const event of ["model_select", "session_tree", "session_compact"] as const) pi.on(event, (_event, ctx) => {
		cancel(ctx, true); failure = undefined; attempts = 1;
	});

	pi.registerCommand(KEY, {
		description: "Automatically resume after Codex/Claude usage limits: on | off | status | cancel",
		getArgumentCompletions: (prefix) => ["on", "off", "status", "cancel"].filter((value) => value.startsWith(prefix)).map((value) => ({ value, label: value })),
		handler: async (args, ctx) => {
			const action = args.trim() || "status";
			if (action === "on" || action === "off") {
				enabled = action === "on";
				if (!enabled) cancel(ctx);
				pi.appendEntry(SETTINGS, { enabled });
				ctx.ui.notify(`Auto-Resume ${enabled ? "enabled" : "disabled"} (for this session).`, "info");
				if (enabled) launch(ctx);
			} else if (action === "cancel") {
				cancel(ctx, true); failure = undefined; attempts = 1;
			} else if (action === "status") {
				ctx.ui.notify(`Auto-Resume: ${enabled ? "on" : "off"}.${pending ? pending.due ? ` Resuming no earlier than ${new Date(pending.due).toLocaleString()}.` : " Checking usage limit …" : " No resume scheduled."}`, "info");
			} else ctx.ui.notify("/auto-resume on | off | status | cancel", "warning");
		},
	});
}

export default function (pi: ExtensionAPI) { setupAutoResume(pi); }
