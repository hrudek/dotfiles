/**
 * Show OpenAI Codex rate-limit usage in Pi's footer.
 *
 * Uses the Codex CLI's own login (`codex login`) by asking `codex app-server`
 * for the account rate limits. Codex handles credential storage and refresh.
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { join } from "node:path";
import { createUsageReader, credentialScope, type ReadOptions } from "./usage-support/cache.ts";
import { installUsagePolling, type UsageDisplay } from "./usage-support/poller.ts";

const REQUEST_TIMEOUT_MS = 15_000;
const CODEX_BIN = process.env.CODEX_BIN ?? "codex";

interface RateLimitWindow {
	usedPercent?: number;
	windowDurationMins?: number | null;
	resetsAt?: number | null;
}

interface RateLimitSnapshot {
	primary?: RateLimitWindow | null;
	secondary?: RateLimitWindow | null;
	planType?: string | null;
}

interface CodexUsage {
	rateLimits?: RateLimitSnapshot;
}

class CodexAuthError extends Error {}

function fetchRateLimits(): Promise<CodexUsage> {
	return new Promise((resolve, reject) => {
		const child = spawn(CODEX_BIN, ["app-server"], { stdio: ["pipe", "pipe", "pipe"] });
		let settled = false;
		let stderr = "";

		const finish = (error: Error | undefined, value?: CodexUsage) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			lines.close();
			child.stdin.end();
			child.kill();
			if (error) reject(error);
			else resolve(value as CodexUsage);
		};

		const timer = setTimeout(() => finish(new Error("codex app-server timed out")), REQUEST_TIMEOUT_MS);
		const send = (message: unknown) => child.stdin.write(`${JSON.stringify(message)}\n`);

		child.on("error", (error) => finish(new Error(`cannot start codex: ${error.message}`)));
		child.on("exit", (code) => finish(new Error(`codex app-server exited (${code})${stderr ? `: ${stderr.trim()}` : ""}`)));
		child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-1_000); });
		child.stdin.on("error", () => {});

		const lines = createInterface({ input: child.stdout });
		lines.on("line", (line) => {
			let message: { id?: number; result?: unknown; error?: { message?: string } };
			try {
				message = JSON.parse(line);
			} catch {
				return;
			}
			if (message.id === 1) {
				if (message.error) return finish(new Error(message.error.message ?? "initialize failed"));
				send({ method: "initialized" });
				send({ id: 2, method: "account/rateLimits/read", params: { excludeResetCreditDetails: true } });
			} else if (message.id === 2) {
				if (message.error) {
					const text = message.error.message ?? "rate limit request failed";
					return finish(/auth/i.test(text) ? new CodexAuthError(text) : new Error(text));
				}
				const result = message.result as CodexUsage | undefined;
				if (!result || typeof result !== "object") return finish(new Error("Invalid Codex usage response"));
				const limits = result.rateLimits;
				finish(undefined, { rateLimits: limits ? { primary: limits.primary, secondary: limits.secondary, planType: limits.planType } : undefined });
			}
		});

		send({
			id: 1,
			method: "initialize",
			params: { clientInfo: { name: "pi-codex-usage", title: null, version: "1.0.0" }, capabilities: null },
		});
	});
}

const reader = createUsageReader<CodexUsage>({
	scope: () => credentialScope("codex", join(process.env.CODEX_HOME || join(homedir(), ".codex"), "auth.json"), CODEX_BIN),
	fetch: fetchRateLimits,
});

export function readRateLimits(options: ReadOptions = {}) { return reader.read(options); }

function windowLabel(window: RateLimitWindow, fallback: string): string {
	const minutes = window.windowDurationMins;
	if (typeof minutes !== "number") return fallback;
	if (minutes >= 6 * 24 * 60) return "7d";
	if (minutes % 60 === 0) return `${minutes / 60}h`;
	return fallback;
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

function formatUsage(
	usage: CodexUsage,
	muted: (text: string) => string,
	prominent: (text: string) => string,
): UsageDisplay {
	const primary = usage.rateLimits?.primary;
	const secondary = usage.rateLimits?.secondary;
	const windows = [
		primary && typeof primary.usedPercent === "number"
			? { label: windowLabel(primary, "short"), used: primary.usedPercent, resetAt: primary.resetsAt ?? undefined }
			: undefined,
		secondary && typeof secondary.usedPercent === "number"
			? { label: windowLabel(secondary, "long"), used: secondary.usedPercent, resetAt: secondary.resetsAt ?? undefined }
			: undefined,
	].filter((window): window is { label: string; used: number; resetAt: number | undefined } => window !== undefined);

	if (windows.length === 0) {
		return { status: "Codex: no usage data", details: "No Codex rate-limit usage available" };
	}

	const renderStatus = () => `Codex: ${windows.map((window) => {
		const remaining = resetIn(window.resetAt);
		const reset = remaining ? ` ${muted(`(${remaining})`)}` : "";
		return `${window.label} ${prominent(`${Math.round(window.used)}%`)}${reset}`;
	}).join(" · ")}`;
	const planType = usage.rateLimits?.planType;
	const plan = planType ? ` (${planType})` : "";
	return {
		status: renderStatus(),
		details: `Codex usage${plan}: ${windows.map((window) => `${window.label} ${Math.round(window.used)}% used, ${resetDescription(window.resetAt)}`).join("; ")}`,
		renderStatus,
	};
}

export default function (pi: ExtensionAPI) {
	installUsagePolling(pi, {
		key: "codex-usage", label: "Codex", reader,
		selected: (model) => model?.provider === "openai" || model?.provider === "openai-codex" || model?.api === "openai-codex-responses",
		format: (usage, ctx) => formatUsage(usage, (text) => ctx.ui.theme.fg("dim", text), (text) => ctx.ui.theme.fg("accent", ctx.ui.theme.bold(text))),
		missing: "No Codex CLI usage available; run `codex login`",
		resets: (usage) => [usage.rateLimits?.primary?.resetsAt, usage.rateLimits?.secondary?.resetsAt].filter((at): at is number => typeof at === "number").map((at) => at * 1_000),
	});
}
