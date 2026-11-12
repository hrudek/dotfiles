# Auto-Resume for Pi

Waits out Codex/ChatGPT and `pi-claude-cli` usage limits and automatically
continues the interrupted task in the same session. Your machine and Pi must stay
open. Enabled by default in TUI and RPC mode; not in print/JSON mode.

## Usage

Run `/reload` once after installing.

- `/auto-resume status`: show the current state (also the default without arguments).
- `/auto-resume off`: disable and discard any scheduled resume.
- `/auto-resume on`: enable; re-schedule a still-known limit error.
- `/auto-resume cancel`: cancel only the current resume; the feature stays on.
- **Escape or Ctrl+C while waiting**: cancel the current resume.

On/off is stored in the session. A pending wait job is deliberately discarded on
`/reload`, exit or session switch and is **not** reconstructed from old error messages.

While waiting, the footer shows only the Auto-Resume countdown; all usage
indicators (Claude, Codex, Copilot) are hidden to keep the line short and come
back when the wait ends or is cancelled.

## Behavior

- Starts only after `agent_settled`, i.e. after Pi's own short retries.
- Reacts to model responses that ended in an error and to automatic-compaction
  failures with a detected usage limit — not to normal reply text, tool errors or
  failed manual compaction.
- Uses the same cached usage readers as `codex-usage.ts` and `claude-usage.ts`.
  Its own queries also update the display. The check requests fresh usage (data at
  most 5 seconds old may be reused); HTTP backoff is not bypassed. Failed queries
  never yield stale cache values as a fresh go-ahead.
  **The Codex CLI must be logged in with the same account as Pi.**
  Polling and cache details are in `../usage-support/README.md`.
- Considers all exhausted windows; for Claude also the Opus/Sonnet weekly limit
  matching the model. With several limits, the latest reset counts.
- Also supports machine-readable reset times, `Retry-After` and relative error
  text such as "try again in 2h 15m". Localized clock times are not guessed; the
  usage data or the fallback is used instead.
- Waits until the reset plus a 30-second buffer, then checks usage again.
- Without a usable reset time: retry after 5, 10, 20, then at most every 30
  minutes, each with a 30-second buffer. If the usage query is unavailable, a
  normal model attempt follows after the wait. There is no fixed number of
  retries; an error no longer recognized as a limit ends the chain.
- Resumes the task with an extension-authored continuation message. Work that was
  already completed successfully should not be repeated. This is not the resumption
  of an aborted operating-system process.
- New input/agent runs, model changes, tree navigation, compaction, manual agent
  abort and session end discard stale wait jobs. Usage queries still in flight must
  not trigger a continuation afterwards.

## Billing and limits

The extension neither switches model or provider nor changes billing or extra-usage
settings. Authentication, context, credit and billing errors are not retried
automatically. This also applies to the explicit `Claude billing:` / usage-credits
blocks from `pi-claude-cli`, since they can also mean a permanent third-party
restriction where a reset does not help. In that case a warning is shown instead
of silently doing nothing.

Exception: if `pi-claude-cli` reports that it would have fallen back to usage
credits because a 5h/7d plan limit is used up (`Claude billing: … instead of your
plan limits (rate limit status rejected, five_hour|seven_day…)`), Auto-Resume treats
it as a normal limit and waits until the reset (`resetsAt` from the rate-limit
diagnostic). Credits are never enabled by this.

Paid extra usage already enabled at the provider is **not** switched off by this.
If you want to use only the subscription, disable it at the provider; Auto-Resume
only acts once a request has actually failed because of a usage limit.

## Files and tests

- `index.ts`: lifecycle, countdown, cancellation, commands and usage adapters.
- `limits.ts`: error detection and wait-time calculation, no Pi dependency.
- `tests/pi-auto-resume.test.mjs` in the repository: offline tests with simulated
  usage data and virtual time, without model requests or consumed tokens.

Run from the repository root with Node.js 22.19+ (TypeScript stripping):

```sh
node --test tests/pi-auto-resume.test.mjs
```
