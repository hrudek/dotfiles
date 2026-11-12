/**
 * Show Claude subscription rate-limit usage in Pi's footer.
 *
 * Mirrors codex-usage.ts: shows the 5-hour and 7-day windows with a reset
 * countdown.
 *
 * Uses the OAuth credential of the already authenticated Claude CLI
 * (`~/.claude/.credentials.json`, or `$CLAUDE_CONFIG_DIR`). When the access
 * token is expired, the CLI itself is invoked (`claude auth status`) so that it
 * performs the refresh and keeps ownership of the rotating refresh token.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createUsageReader, credentialScope, httpError, type ReadOptions } from "./usage-support/cache.ts";
import { installUsagePolling, type UsageDisplay } from "./usage-support/poller.ts";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const REQUEST_TIMEOUT_MS = 8_000;
const API_BASE_URL = "https://api.anthropic.com";
const USAGE_URL = `${API_BASE_URL}/api/oauth/usage`;
const CLI_TIMEOUT_MS = 15_000;
const EXPIRY_MARGIN_MS = 60_000;

interface ClaudeCliCredentials {
	claudeAiOauth?: {
		accessToken?: string;
		expiresAt?: number;
		subscriptionType?: string;
	};
}

function credentialsPath(): string {
	const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
	return join(configDir, ".credentials.json");
}

async function readCliCredentials(): Promise<ClaudeCliCredentials["claudeAiOauth"]> {
	try {
		const raw = await readFile(credentialsPath(), "utf8");
		return (JSON.parse(raw) as ClaudeCliCredentials).claudeAiOauth;
	} catch {
		return undefined;
	}
}

/** Let the Claude CLI refresh its own token (it rewrites the credentials file). */
function refreshViaCli(): Promise<void> {
	return new Promise((resolve) => {
		execFile("claude", ["auth", "status"], { timeout: CLI_TIMEOUT_MS }, () => resolve());
	});
}

function isExpired(expiresAt: number | undefined): boolean {
	return typeof expiresAt === "number" && expiresAt - EXPIRY_MARGIN_MS <= Date.now();
}

async function getCliAccessToken(forceRefresh = false): Promise<string | undefined> {
	let creds = await readCliCredentials();
	if (forceRefresh || !creds?.accessToken || isExpired(creds.expiresAt)) {
		await refreshViaCli();
		creds = await readCliCredentials();
	}
	return creds?.accessToken;
}

interface UsageWindow {
	utilization?: number | null;
	resets_at?: string | null;
}

interface ClaudeUsage {
	five_hour?: UsageWindow | null;
	seven_day?: UsageWindow | null;
	seven_day_opus?: UsageWindow | null;
	seven_day_sonnet?: UsageWindow | null;
}

interface WindowDisplay {
	label: string;
	used: number;
	resetAt: number | undefined;
}

function parseResetAt(value: string | null | undefined): number | undefined {
	if (!value) return undefined;
	const ms = Date.parse(value);
	return Number.isNaN(ms) ? undefined : ms / 1_000;
}

function resetDescription(resetAt: number | undefined): string {
	if (typeof resetAt !== "number") return "unknown reset";
	return `resets ${new Date(resetAt * 1_000).toLocaleString()}`;
}

function resetIn(resetAt: number | undefined): string | undefined {
	if (typeof resetAt !== "number") return undefined;
	const totalMinutes = Math.floor(Math.max(0, resetAt - Date.now() / 1_000) / 60);
	if (totalMinutes < 1) return "<1m";

	const days = Math.floor(totalMinutes / (24 * 60));
	const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
	const minutes = totalMinutes % 60;
	if (days > 0) return `${days}d${hours > 0 ? ` ${hours}h` : ""}`;
	if (hours > 0) return `${hours}h${minutes > 0 ? ` ${minutes}m` : ""}`;
	return `${minutes}m`;
}

function toWindow(window: UsageWindow | null | undefined, label: string): WindowDisplay | undefined {
	if (!window || typeof window.utilization !== "number") return undefined;
	return { label, used: window.utilization, resetAt: parseResetAt(window.resets_at) };
}

function formatUsage(
	usage: ClaudeUsage,
	muted: (text: string) => string,
	prominent: (text: string) => string,
): UsageDisplay {
	const windows = [
		toWindow(usage.five_hour, "5h"),
		toWindow(usage.seven_day, "7d"),
	].filter((window): window is WindowDisplay => window !== undefined);
	const detailWindows = [
		...windows,
		toWindow(usage.seven_day_opus, "7d Opus"),
		toWindow(usage.seven_day_sonnet, "7d Sonnet"),
	].filter((window): window is WindowDisplay => window !== undefined);

	if (windows.length === 0) {
		return { status: "Claude: no usage data", details: "No Claude rate-limit usage available" };
	}

	const renderStatus = () => {
		const parts = windows.map((window) => {
			const remaining = resetIn(window.resetAt);
			const reset = remaining ? ` ${muted(`(${remaining})`)}` : "";
			return `${window.label} ${prominent(`${Math.round(window.used)}%`)}${reset}`;
		});
		return `Claude: ${parts.join(" · ")}`;
	};

	const detailParts = detailWindows.map(
		(window) => `${window.label} ${Math.round(window.used)}% used, ${resetDescription(window.resetAt)}`,
	);
	return {
		status: renderStatus(),
		details: `Claude usage: ${detailParts.join("; ")}`,
		renderStatus,
	};
}

function authHeaders(accessToken: string): Record<string, string> {
	return {
		Accept: "application/json",
		Authorization: `Bearer ${accessToken}`,
		"anthropic-beta": "oauth-2025-04-20",
		"User-Agent": "pi-coding-agent",
	};
}

async function fetchClaudeUsage(): Promise<ClaudeUsage | undefined> {
	let accessToken = await getCliAccessToken();
	if (!accessToken) return undefined;

	let headers = authHeaders(accessToken);
	let usageResponse = await fetch(USAGE_URL, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
	if (usageResponse.status === 401) {
		accessToken = await getCliAccessToken(true);
		if (!accessToken) return undefined;
		headers = authHeaders(accessToken);
		usageResponse = await fetch(USAGE_URL, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
	}
	if (!usageResponse.ok) throw httpError("Anthropic usage API", usageResponse);

	const usage = (await usageResponse.json()) as ClaudeUsage;
	return { five_hour: usage.five_hour, seven_day: usage.seven_day, seven_day_opus: usage.seven_day_opus, seven_day_sonnet: usage.seven_day_sonnet };
}

const reader = createUsageReader<ClaudeUsage>({
	scope: () => credentialScope("claude", credentialsPath()),
	fetch: fetchClaudeUsage,
});

export function readClaudeUsage(options: ReadOptions = {}) { return reader.read(options); }

export default function (pi: ExtensionAPI) {
	installUsagePolling(pi, {
		key: "claude-usage", label: "Claude", reader,
		selected: (model) => model?.provider === "pi-claude-cli",
		format: (usage, ctx) => formatUsage(usage, (text) => ctx.ui.theme.fg("dim", text), (text) => ctx.ui.theme.fg("accent", ctx.ui.theme.bold(text))),
		missing: "No Claude CLI login found or login expired; run `claude auth login`",
		resets: (usage) => [usage.five_hour, usage.seven_day, usage.seven_day_opus, usage.seven_day_sonnet].map((window) => window?.resets_at ? Date.parse(window.resets_at) : NaN),
	});
}
