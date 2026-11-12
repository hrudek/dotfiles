import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Snapshot, UsageReader } from "./cache.ts";

export interface UsageDisplay {
	status?: string;
	details: string;
	renderStatus?: () => string;
}
interface Options<T> {
	key: string;
	label: string;
	reader: UsageReader<T>;
	selected: (model: ExtensionContext["model"]) => boolean;
	format: (value: T, ctx: ExtensionContext) => UsageDisplay;
	missing: string;
	resets?: (value: T) => number[]; // Unix milliseconds
	now?: () => number;
	random?: () => number;
}

/** UI-independent polling lifecycle, shared by all three quota displays. */
export function installUsagePolling<T>(pi: ExtensionAPI, options: Options<T>) {
	const now = options.now ?? Date.now;
	const random = options.random ?? Math.random;
	let ctx: ExtensionContext | undefined;
	let active = false;
	let running = false;
	let generation = 0;
	let snapshot: Snapshot<T> | undefined;
	let timer: ReturnType<typeof setInterval> | undefined;
	let unsubscribe: (() => void) | undefined;
	let nextAt = 0;
	let request: Promise<Snapshot<T> | undefined> | undefined;

	function interval() {
		// No background polling while idle; agent_settled and session start still refresh once.
		return !running ? Infinity : options.selected(ctx?.model) ? 300_000 : 600_000;
	}
	function display(): UsageDisplay {
		if (!ctx || snapshot?.value === undefined) return { status: snapshot?.error ? `${options.label}: unavailable` : undefined, details: snapshot?.error ?? options.missing };
		try { return options.format(snapshot.value, ctx); }
		catch { return { status: `${options.label}: unavailable`, details: "Invalid usage data; will query again on the next refresh." }; }
	}
	function render() {
		if (!active || !ctx) return;
		const result = display();
		const status = result.renderStatus?.() ?? result.status;
		pi.events.emit("usage-status:update", { key: options.key, status: status && snapshot?.error ? `${status} ${ctx.ui.theme.fg("warning", "!")}` : status });
	}
	function accept(value: Snapshot<T>) {
		if (!active) return;
		snapshot = value;
		// Queries made by Auto-Resume update the UI and the next polling deadline too.
		nextAt = value.error ? value.retryAt ?? now() + 60_000 : value.checkedAt + interval() * (1 + random() * 0.1);
		render();
	}
	function resetDue() {
		if (snapshot?.value === undefined || !options.resets) return Infinity;
		const resets = options.resets(snapshot.value).map((at) => at + 30_000)
			.filter((at) => Number.isFinite(at) && at > snapshot!.checkedAt);
		return resets.length ? Math.min(...resets) : Infinity;
	}
	async function refresh(fresh = false, maxAgeMs = 30_000) {
		if (!active) return undefined;
		if (request) return request;
		const version = generation;
		request = (async () => {
			try {
				const value = await options.reader.read({ fresh, maxAgeMs });
				if (active && generation === version) accept(value);
				return value;
			} catch (error) {
				if (active && generation === version) accept({ ...snapshot, checkedAt: now(), failures: (snapshot?.failures ?? 0) + 1, error: error instanceof Error ? error.message : "Usage query failed", retryAt: now() + 60_000 });
				return undefined;
			} finally { if (generation === version) request = undefined; }
		})();
		return request;
	}

	pi.on("session_start", (_event, context) => {
		if (!context.hasUI) return;
		ctx = context;
		active = true;
		generation++;
		unsubscribe = options.reader.subscribe(accept);
		void refresh();
		timer = setInterval(() => {
			if (!active) return;
			render(); // Countdown changes without making a network request.
			if (!running) return;
			if (snapshot?.retryAt && snapshot.retryAt > now()) return;
			const reset = resetDue();
			if (now() >= Math.min(nextAt, reset)) void refresh(now() >= reset);
		}, 5_000);
		timer.unref();
	});
	pi.on("agent_start", (_event, context) => {
		ctx = context;
		running = true;
		if (snapshot) nextAt = Math.min(nextAt, snapshot.checkedAt + interval());
	});
	pi.on("agent_settled", (_event, context) => {
		ctx = context;
		running = false;
		if (options.selected(ctx.model)) void refresh(false, 15_000);
	});
	pi.on("model_select", (_event, context) => {
		ctx = context;
		if (options.selected(ctx.model)) void refresh();
		else if (snapshot) nextAt = snapshot.checkedAt + interval();
	});
	pi.on("session_shutdown", () => {
		active = false;
		generation++;
		unsubscribe?.();
		unsubscribe = undefined;
		if (timer) clearInterval(timer);
		timer = undefined;
		request = undefined;
		snapshot = undefined;
		ctx = undefined;
		pi.events.emit("usage-status:update", { key: options.key, status: undefined });
	});
	pi.registerCommand(options.key, {
		description: `Refresh and show ${options.label} usage`,
		handler: async (_args, context) => {
			ctx = context;
			await refresh(true);
			const result = display();
			context.ui.notify(`${result.details}${snapshot?.error && snapshot.value !== undefined ? `\nLast query failed: ${snapshot.error}` : ""}`, snapshot?.error ? "warning" : "info");
		},
	});
}
