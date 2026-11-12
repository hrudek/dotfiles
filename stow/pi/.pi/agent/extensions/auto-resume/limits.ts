export type Provider = "codex" | "claude";
export interface Window {
	used: number;
	resetAt?: number; // Unix milliseconds
}

export const BUFFER_MS = 30_000;
export const MIN_DELAY_MS = 60_000;

/** Legacy terminal keys and Kitty/CSI-u key-press encodings (not releases). */
export function isCancelKey(data: string): boolean {
	return data === "\u001b" || data === "\u0003" || /^\u001b\[(?:27(?:;1(?::[12])?)?|(?:99|67);5(?::[12])?)u$/.test(data);
}

export function providerFor(model: { provider: string; api?: string } | undefined): Provider | undefined {
	if (model?.provider === "pi-claude-cli") return "claude";
	if (model?.provider === "openai" || model?.provider === "openai-codex" || model?.api === "openai-codex-responses") return "codex";
	return undefined;
}

/**
 * pi-claude-cli blocks calls that Claude wanted to charge to usage credits because a plan
 * window (5h/7d) is used up. It never spends credits, so waiting for the reset is safe.
 */
export function isPlanLimitCreditsBlock(text: string): boolean {
	return /^Claude billing: this request was charged to Claude usage credits instead of your plan limits \(rate limit status rejected, (?:five_hour|seven_day\w*)\)/.test(text);
}

/** Any other billing/credits refusal: surfaced to the user, never retried. */
export function isBillingError(text: string): boolean {
	return !isPlanLimitCreditsBlock(text) && /billing|usage credits|extra usage|insufficient_quota|credit balance/i.test(text);
}

/** Billing/auth/context errors must never turn into unattended retries. */
export function isLimitError(text: string): boolean {
	if (isPlanLimitCreditsBlock(text)) return true;
	if (/billing|usage credits|extra usage|insufficient_quota|payment|credit balance|workspace admin|third.party|unauthori[sz]ed|invalid.api.key|context.{0,30}(limit|length)|maximum context|token.{0,10}expired/i.test(text)) return false;
	return /usage[_ -]limit[_ -]reached|(?:usage|weekly|daily|subscription|plan|rate)[_ -]limit.{0,40}(?:exceed|reach|hit)|(?:hit|reached|exceeded).{0,35}(?:usage |your |plan |weekly |daily |rate )limit|rate[_ -]limit(?:_error|ed)|too many requests/i.test(text);
}

/** Prefer machine-readable reset/retry hints; never guess a locale-specific clock. */
export function resetHint(text: string, headers: Record<string, string>, now: number): number | undefined {
	const hints: number[] = [];
	const retryAfter = headers["retry-after"];
	if (retryAfter) {
		const seconds = Number(retryAfter);
		hints.push(Number.isFinite(seconds) ? now + seconds * 1_000 : Date.parse(retryAfter));
	}
	for (const match of text.matchAll(/["']?(?:resets_at|reset_at|resetsAt)["']?\s*[:=]\s*["']?(\d{10,13}|\d{4}-\d{2}-\d{2}T[\d:.+Z-]+)/g)) {
		const value = match[1];
		hints.push(/^\d+$/.test(value) ? Number(value) * (value.length <= 10 ? 1_000 : 1) : Date.parse(value));
	}
	for (const match of text.matchAll(/["']?(?:resets_in_seconds|retry_after_seconds)["']?\s*[:=]\s*["']?(\d+(?:\.\d+)?)/g)) hints.push(now + Number(match[1]) * 1_000);
	const relative = text.match(/(?:try again|retry|resets?) (?:after |in )((?:\d+(?:\.\d+)?\s*(?:hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\s*)+)/i);
	if (relative) {
		let delay = 0;
		for (const match of relative[1].matchAll(/(\d+(?:\.\d+)?)\s*(h\w*|m\w*|s\w*)/gi)) {
			delay += Number(match[1]) * ({ h: 3_600_000, m: 60_000, s: 1_000 }[match[2][0].toLowerCase()] ?? 0);
		}
		hints.push(now + delay);
	}
	const future = hints.filter((value) => Number.isFinite(value) && value > now);
	return future.length ? Math.max(...future) : undefined;
}

export function exhausted(windows: Window[]): Window[] {
	return windows.filter((window) => Number.isFinite(window.used) && window.used >= 100);
}

export function nextAttempt(now: number, windows: Window[], hint: number | undefined, attempt: number): number {
	const blocked = exhausted(windows);
	const resets = blocked.map((window) => window.resetAt).filter((at): at is number => typeof at === "number" && Number.isFinite(at) && at > now);
	if (hint && Number.isFinite(hint) && hint > now) resets.push(hint);
	// Missing reset on any exhausted window: poll at a conservative interval too.
	if (!resets.length || blocked.some((window) => !window.resetAt || window.resetAt <= now)) {
		resets.push(now + Math.min(30 * 60_000, 5 * 60_000 * 2 ** Math.max(0, Math.min(attempt - 1, 3))));
	}
	return Math.max(now + MIN_DELAY_MS, ...resets) + BUFFER_MS;
}
