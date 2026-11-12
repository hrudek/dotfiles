/** Shared quota snapshots only: never persist credentials or authorization headers. */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Snapshot<T> {
	value?: T;
	updatedAt?: number;
	checkedAt: number;
	failures: number;
	error?: string;
	retryAt?: number;
}
export interface ReadOptions { fresh?: boolean; maxAgeMs?: number }
export interface UsageReader<T> {
	read(options?: ReadOptions): Promise<Snapshot<T>>;
	subscribe(listener: (snapshot: Snapshot<T>) => void): () => void;
}
export class UsageError extends Error {
	retryAfterMs?: number;
	constructor(message: string, retryAfterMs?: number) { super(message); this.retryAfterMs = retryAfterMs; }
}

export function httpError(label: string, response: { status: number; headers: { get(name: string): string | null } }, now = Date.now()): UsageError {
	const header = response.headers.get("retry-after");
	const seconds = header === null ? NaN : Number(header);
	const delay = Number.isFinite(seconds) ? seconds * 1_000 : header ? Date.parse(header) - now : NaN;
	return new UsageError(`${label} returned HTTP ${response.status}`, Number.isFinite(delay) ? Math.max(0, delay) : undefined);
}

/** Auth-file fingerprint prevents sharing quota snapshots across different logins. */
export async function credentialScope(provider: string, path: string, extra = ""): Promise<string> {
	let credential: Buffer | string;
	try { credential = await readFile(path); }
	catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		credential = "not-logged-in";
	}
	return createHash("sha256").update(provider).update("\0").update(path).update("\0").update(extra).update("\0").update(credential).digest("hex");
}

export interface Store {
	read<T>(key: string): Promise<Snapshot<T> | undefined>;
	write<T>(key: string, snapshot: Snapshot<T>): Promise<void>;
	lock(key: string): Promise<() => Promise<void>>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function fileStore(directory = join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "pi", "usage-v1")): Store {
	const pathFor = (key: string, suffix: string) => join(directory, `${createHash("sha256").update(key).digest("hex")}.${suffix}`);
	return {
		async read<T>(key: string) {
			try {
				const value = JSON.parse(await readFile(pathFor(key, "json"), "utf8"));
				if (!value || !Number.isFinite(value.checkedAt) || !Number.isFinite(value.failures) || value.failures < 0 || value.checkedAt > Date.now() + 60_000) return undefined;
				if (value.retryAt !== undefined && !Number.isFinite(value.retryAt) || value.updatedAt !== undefined && !Number.isFinite(value.updatedAt) || value.error !== undefined && typeof value.error !== "string") return undefined;
				return value as Snapshot<T>;
			} catch { return undefined; }
		},
		async write(key, snapshot) {
			await mkdir(directory, { recursive: true, mode: 0o700 });
			const path = pathFor(key, "json");
			const temporary = `${path}.${randomUUID()}.tmp`;
			try {
				// Error text can originate in a CLI's stderr. Persist only a generic error.
				const safe = snapshot.error ? { ...snapshot, error: "Usage query failed" } : snapshot;
				const file = await open(temporary, "wx", 0o600);
				try { await file.writeFile(JSON.stringify(safe)); } finally { await file.close(); }
				await rename(temporary, path);
			} finally { await rm(temporary, { force: true }); }
		},
		async lock(key) {
			await mkdir(directory, { recursive: true, mode: 0o700 });
			const path = pathFor(key, "lock");
			const token = randomUUID();
			const deadline = Date.now() + 65_000;
			while (true) {
				try {
					const file = await open(path, "wx", 0o600);
					try { await file.writeFile(JSON.stringify({ pid: process.pid, token })); } finally { await file.close(); }
					return async () => {
						try { if (JSON.parse(await readFile(path, "utf8")).token === token) await rm(path, { force: true }); } catch { /* Already removed. */ }
					};
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
					try {
						const age = Date.now() - (await stat(path)).mtimeMs;
						// Avoid stealing a newly-created lock before its owner has written it.
						if (age > 2_000) {
							let dead = false;
							try { const owner = JSON.parse(await readFile(path, "utf8")); process.kill(owner.pid, 0); }
							catch (ownerError) { dead = (ownerError as NodeJS.ErrnoException).code === "ESRCH"; }
							if (dead || age > 90_000) { await rm(path, { force: true }); continue; }
						}
					} catch { /* Owner may just have released it. */ }
					if (Date.now() >= deadline) throw new UsageError("Usage query from another session is still running", 60_000);
					await sleep(150 + Math.random() * 100);
				}
			}
		},
	};
}

interface Options<T> {
	scope: () => Promise<string>;
	fetch: () => Promise<T | undefined>;
	store?: Store;
	now?: () => number;
	random?: () => number;
}

export function createUsageReader<T>(options: Options<T>): UsageReader<T> {
	const store = options.store ?? fileStore();
	const now = options.now ?? Date.now;
	const random = options.random ?? Math.random;
	const states = new Map<string, Snapshot<T>>();
	const requests = new Map<string, Promise<Snapshot<T>>>();
	const listeners = new Set<(snapshot: Snapshot<T>) => void>();
	let activeScope: string | undefined;
	let scopeVersion = 0;

	function publish(key: string, snapshot: Snapshot<T>) {
		states.set(key, snapshot);
		if (states.size > 16) states.delete(states.keys().next().value!);
		if (key === activeScope) for (const listener of listeners) { try { listener(snapshot); } catch { /* UI must not break quota reads. */ } }
		return snapshot;
	}
	function reusable(snapshot: Snapshot<T> | undefined, options: ReadOptions) {
		if (!snapshot) return false;
		if (snapshot.retryAt && snapshot.retryAt > now()) return true;
		return now() >= snapshot.checkedAt && now() - snapshot.checkedAt < (options.fresh ? 5_000 : options.maxAgeMs ?? 30_000);
	}

	async function refresh(key: string, readOptions: ReadOptions): Promise<Snapshot<T>> {
		let release: (() => Promise<void>) | undefined;
		let previous = states.get(key);
		try {
			// Cache I/O failure must not break the agent or skip server backoff.
			try { release = await store.lock(key); }
			catch (error) { if (error instanceof UsageError) throw error; }
			const disk = await store.read<T>(key).catch(() => undefined);
			if (disk && (!previous || disk.checkedAt > previous.checkedAt)) previous = disk;
			if (reusable(previous, readOptions)) return publish(key, previous!);
			try {
				const value = await options.fetch();
				const snapshot: Snapshot<T> = { value, checkedAt: now(), updatedAt: now(), failures: 0 };
				await store.write(key, snapshot).catch(() => {});
				return publish(key, snapshot);
			} catch (error) {
				const failures = Math.min(16, (previous?.failures ?? 0) + 1);
				const backoff = Math.min(15 * 60_000, 60_000 * 2 ** (failures - 1)) * (1 + random() * 0.1);
				const delay = Math.max(backoff, error instanceof UsageError ? error.retryAfterMs ?? 0 : 0);
				const snapshot: Snapshot<T> = { ...previous, checkedAt: now(), failures, error: error instanceof Error ? error.message : "Usage query failed", retryAt: now() + delay };
				await store.write(key, snapshot).catch(() => {});
				return publish(key, snapshot);
			}
		} catch (error) {
			return publish(key, { ...previous, checkedAt: now(), failures: (previous?.failures ?? 0) + 1, error: error instanceof Error ? error.message : "Usage cache unavailable", retryAt: now() + 60_000 });
		} finally { await release?.().catch(() => {}); }
	}

	return {
		async read(readOptions = {}) {
			const version = ++scopeVersion;
			const key = await options.scope();
			if (version === scopeVersion) activeScope = key;
			// Even a forced read joins an existing request rather than racing it.
			const existing = requests.get(key);
			if (existing) return existing;
			const request = refresh(key, readOptions).finally(() => { requests.delete(key); });
			requests.set(key, request);
			return request;
		},
		subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
	};
}
