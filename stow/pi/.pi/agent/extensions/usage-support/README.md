# Shared usage queries

`cache.ts` and `poller.ts` serve the Codex, Claude and Copilot displays.
Auto-Resume uses the same Codex/Claude readers.

## When queries happen

All intervals live in `USAGE_TIMING` (`cache.ts`) and `SELECTED_INTERVAL_MS`
(`poller.ts`). They favour slightly stale data over HTTP 429s.

- Session start or `/reload`: reuse the cache if under 5 minutes old, else query.
- Selected provider while an agent run is active: about every **15 minutes**.
- Unselected providers: **no** background polling; refreshed only on session
  start and model switch.
- While **idle** (no agent run): **no** background polling, not even at reset
  times. Stale data is refreshed when the next agent run starts.
- After an agent run finishes: refresh, provided the last query is at least
  5 minutes old.
- After switching the model to a provider: refresh, unless the data is still in
  the 5-minute cache.
- Expected reset: during an agent run, refresh the selected provider from
  **30 seconds after the reset**.
- `/codex-usage`, `/claude-usage`, `/copilot-usage`: request a fresh query.

Regular intervals get up to 10 % random extra delay so parallel sessions do not
query in sync. A 5-second timer redraws the existing countdowns and checks what
is due; it does **not** make a network request every 5 seconds. In print/JSON
mode the displays start no background jobs.

## Cache and concurrency

- Normal queries reuse results up to 5 minutes old.
- Manual queries and Auto-Resume request fresh data; results at most 1 minute old
  may still be reused.
- Error snapshots are reused only until their backoff (`retryAt`) expires.
- Concurrent queries for the same account within one process are merged.
- An account-bound file cache and an exclusive file lock prevent simultaneous
  identical provider queries across multiple Pi processes too.
- Directory: `${XDG_CACHE_HOME:-~/.cache}/pi/usage-v1/`. Files are private
  (`0600`), as is a newly created directory (`0700`).
- Only quota data is stored, **no credentials or HTTP auth headers**. Only a
  SHA-256 fingerprint of the credentials is computed for cache assignment. Login or
  token changes use a new cache key.
- CLI error text is replaced by a generic message in the file cache.
- Dead process locks are detected. On cache filesystem errors an in-process cache
  remains available. A still-running foreign request is not bypassed by an
  unlocked replacement request.

The Codex CLI and Pi must still use the same Codex/ChatGPT account. The cache does
not synchronize different accounts or different machines. Other Pi sessions pick up
new file-cache values on their next query; there is no extra file watcher.

## Errors and status line

Last known quota values stay visible on errors. Only a short **`!`** marks the
failed refresh. There is **no additional age or timestamp display**. Details are
available through the respective usage command.

Errors lead to 1, 2, 4, 8, then at most 15 minutes of backoff with some random
extra delay. HTTP 429 uses 10, 20, 40, then at most 60 minutes. A longer HTTP `Retry-After` is respected. Manual commands and
Auto-Resume do not bypass this block either. Successful queries reset the backoff.

New results from Auto-Resume are published to the display immediately within the
same Pi instance. On a failed usage query, Auto-Resume does **not** treat old cache
values as a fresh go-ahead; its documented fallback to conservative model retries
applies instead.

While Auto-Resume is waiting, its countdown is shown exclusively in the footer and
all usage indicators are hidden (see `usage-status.ts`).
