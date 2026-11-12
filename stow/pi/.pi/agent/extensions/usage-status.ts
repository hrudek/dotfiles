/** Combine subscription usage indicators into one footer status. */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const STATUS_KEY = "usage-status";
const STATUS_EVENT = "usage-status:update";

interface StatusUpdate {
	key: string;
	status?: string;
	/** While any exclusive status exists, only exclusive statuses are shown. */
	exclusive?: boolean;
}

export default function (pi: ExtensionAPI) {
	const statuses = new Map<string, string>();
	const exclusive = new Set<string>();
	let currentCtx: ExtensionContext | undefined;

	function render() {
		const status = Array.from(statuses.entries())
			.filter(([key]) => exclusive.size === 0 || exclusive.has(key))
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([, text]) => text)
			.join(" | ");
		currentCtx?.ui.setStatus(STATUS_KEY, status || undefined);
	}

	pi.events.on(STATUS_EVENT, (data) => {
		const update = data as Partial<StatusUpdate>;
		if (typeof update.key !== "string") return;

		if (typeof update.status === "string" && update.status !== "") {
			statuses.set(update.key, update.status);
			if (update.exclusive) exclusive.add(update.key); else exclusive.delete(update.key);
		} else {
			statuses.delete(update.key);
			exclusive.delete(update.key);
		}
		render();
	});

	pi.on("session_start", (_event, ctx) => {
		currentCtx = ctx;
		// Earlier-loaded extensions may already have published cached values.
		// Shutdown clears the old session; do not discard startup updates here.
		render();
	});

	pi.on("session_shutdown", (_event, ctx) => {
		statuses.clear();
		exclusive.clear();
		ctx.ui.setStatus(STATUS_KEY, undefined);
		currentCtx = undefined;
	});
}
