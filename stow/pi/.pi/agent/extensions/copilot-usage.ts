/**
 * Show GitHub Copilot premium-request usage in Pi's footer.
 *
 * Based on the idea behind pi-copilot-usage, with GitHub Enterprise support.
 * Uses the OAuth credential already stored by `/login github-copilot`.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createUsageReader, credentialScope, httpError } from "./usage-support/cache.ts";
import { installUsagePolling, type UsageDisplay } from "./usage-support/poller.ts";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const REQUEST_TIMEOUT_MS = 8_000;
const CONFIG_DIR = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
const AUTH_PATH = join(CONFIG_DIR, "auth.json");

interface CopilotCredential {
	refresh?: unknown;
	enterpriseUrl?: unknown;
}

interface QuotaSnapshot {
	credits_used?: number;
	entitlement?: number;
	overage_count?: number;
	percent_remaining?: number;
	remaining?: number;
	unlimited?: boolean;
}

interface CopilotUser {
	quota_reset_date?: string;
	quota_snapshots?: {
		premium_interactions?: QuotaSnapshot;
	};
}

function normalizeDomain(value: unknown): string | undefined {
	if (typeof value !== "string" || value.trim() === "") return undefined;

	try {
		const input = value.trim();
		const url = new URL(input.includes("://") ? input : `https://${input}`);
		return url.protocol === "https:" ? url.hostname : undefined;
	} catch {
		return undefined;
	}
}

function userEndpoint(enterpriseUrl: unknown): string {
	const domain = normalizeDomain(enterpriseUrl);
	return domain && domain !== "github.com"
		? `https://api.${domain}/copilot_internal/user`
		: "https://api.github.com/copilot_internal/user";
}

async function readCredential(): Promise<CopilotCredential | undefined> {
	try {
		const auth = JSON.parse(await readFile(AUTH_PATH, "utf8")) as Record<string, unknown>;
		const credential = auth["github-copilot"];
		return credential && typeof credential === "object" ? (credential as CopilotCredential) : undefined;
	} catch {
		return undefined;
	}
}

function compactNumber(value: number): string {
	if (value < 1_000) return Math.round(value).toString();
	const compact = value / 1_000;
	return `${compact >= 10 ? compact.toFixed(0) : compact.toFixed(1).replace(/\.0$/, "")}k`;
}

function formatQuota(quota: QuotaSnapshot, resetDate?: string): UsageDisplay {
	if (quota.unlimited) {
		return { status: "Copilot: unlimited", details: "Copilot premium requests: unlimited" };
	}

	const entitlement = quota.entitlement;
	const remaining = quota.remaining;
	const used = quota.credits_used ??
		(typeof entitlement === "number" && typeof remaining === "number" ? entitlement - remaining : undefined);
	const percentUsed = typeof quota.percent_remaining === "number"
		? Math.max(0, Math.min(100, 100 - quota.percent_remaining))
		: undefined;

	if (typeof used !== "number" || typeof entitlement !== "number") {
		return { status: "Copilot: no quota data", details: "No Copilot premium-request quota available" };
	}

	const percent = percentUsed === undefined ? "" : ` (${Math.round(percentUsed)}%)`;
	const overage = (quota.overage_count ?? 0) > 0 ? ` +${quota.overage_count} over` : "";
	const warning = percentUsed !== undefined && percentUsed >= 90 ? " !" : percentUsed !== undefined && percentUsed >= 75 ? " ~" : "";
	const reset = resetDate ? `; reset ${resetDate}` : "";

	return {
		status: `Copilot: ${compactNumber(used)}/${compactNumber(entitlement)}${percent}${overage}${warning}`,
		details: `Copilot premium requests: ${used}/${entitlement} used${percent}${overage}${reset}`,
	};
}

async function fetchUsage(): Promise<CopilotUser | undefined> {
	const credential = await readCredential();
	if (!credential || typeof credential.refresh !== "string" || credential.refresh === "") {
		return undefined;
	}

	const response = await fetch(userEndpoint(credential.enterpriseUrl), {
		headers: {
			Accept: "application/json",
			Authorization: `Bearer ${credential.refresh}`,
			"User-Agent": "GitHubCopilotChat/0.35.0",
			"Editor-Version": "vscode/1.107.0",
			"Editor-Plugin-Version": "copilot-chat/0.35.0",
			"Copilot-Integration-Id": "vscode-chat",
		},
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});

	if (!response.ok) throw httpError("GitHub API", response);

	const user = (await response.json()) as CopilotUser;
	return { quota_reset_date: user.quota_reset_date, quota_snapshots: { premium_interactions: user.quota_snapshots?.premium_interactions } };
}

const reader = createUsageReader<CopilotUser>({ scope: () => credentialScope("copilot", AUTH_PATH), fetch: fetchUsage });

export default function (pi: ExtensionAPI) {
	installUsagePolling(pi, {
		key: "copilot-usage", label: "Copilot", reader,
		selected: (model) => model?.provider === "github-copilot",
		format: (usage) => usage.quota_snapshots?.premium_interactions
			? formatQuota(usage.quota_snapshots.premium_interactions, usage.quota_reset_date)
			: { status: "Copilot: no quota data", details: "No premium-request quota in GitHub response" },
		missing: "No GitHub Copilot login found; run /login",
		resets: (usage) => usage.quota_reset_date ? [Date.parse(usage.quota_reset_date)] : [],
	});
}
