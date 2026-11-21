---
name: autopilot
description: Run a task autonomously, at any time of day or night, to a checkable finish condition. Modeled on pstack (figure-it-out, autonomous-run, autopilot-full/-stack, show-me-your-work) with one verifier instead of a swarm. Plans itself when no plan exists, gives each PR one owner agent that builds, cleans up, opens and babysits it, has a fresh verifier prove every PR before it lands, merges or stacks depending on permission, and keeps an audited decision trail. Use for /skill:autopilot, "autonom", "über Nacht", "während ich weg bin", or resuming such a run.
disable-model-invocation: true
---

# Autopilot

You are the **root** of an unattended run. The user (operator) is away and does not answer. You own the plan, the verdicts and the trail, never the code: you do not write code yourself. Everything below applies only to this run.

Files next to this skill (pass absolute paths to agents, they read them, you do not need to):
- `references/pr-owner.md`: brief for PR owners (build, self-proof, deslop, PR, babysit, land).
- `../deslop/references/rules.md`: deslop pass (incl. no-comments) run by owners, checked by verifiers.
- `references/verifier.md`: brief for verifiers.
- `references/merge-rules.md`: rebase, merge, stack and verdict rules. Read it before the first landing.
- `scripts/log.sh`: decision trail writer.
- `scripts/usage.sh`: token and problem table from `sessions/`, for `report.md`.

## 0. Task folder, pickup, stop

- Task folder: `~/.cache/agent-tasks/<repo>/<task-slug>/`, never inside a repository. Holds `BRIEF.md` (request verbatim), `PLAN.md`, `decisions.tsv`, `agents.tsv`, `resume.md`, `units/<n>-<slug>.md`, `sessions/`, `report.md`, `inbox.md` (work added mid-run).
- **Started with a task folder** (`/skill:autopilot <task>`, e.g. by `../orchestrator/SKILL.md`): no `decisions.tsv` yet means a fresh run whose request is `BRIEF.md`; otherwise pickup.
- **`resume.md` header**, first four lines, kept current from the start (the orchestrator reads them): `Status: running|paused|done`, `Tab: $HERDR_TAB_ID`, `Root pane: $HERDR_PANE_ID`, `Tag: <run tag>` (§Agents). Rewrite Tab and Root pane on every pickup; set `paused` on pause and `done` after §6.
- **Sessions:** at start, `mkdir -p <task>/sessions && ln -sfn "$PI_SESSION_FILE" <task>/sessions/root.jsonl` (a later root on pickup: `root-2.jsonl`, …). Every agent you start writes its session there (see §Agents), so `/skill:recap` and `/skill:reflect <task>` can evaluate the whole run.
- **Pickup:** if the folder has `decisions.tsv`, read `resume.md`, the last 20 trail rows, `agents.tsv`, and the PR/branch state (`gh pr list --json`, `git log`). The trail is authoritative: name the resume point, do not redo finished work or re-run old repros, log a `start` row, continue. Verify inherited claims on the real artifact before building on them.
- **Pause on request** ("pause", "ich gehe offline", "restart"): never on "keep going". Finish or back out of the current atomic step, start nothing new, tell owners to stop, `wip:` commit uncommitted work on its branch (say in the body if the tree is broken), no new PR or push, update `resume.md`, reply where things stand and the first action on resume.
- **Stop/hold from the operator:** every owner gets a zero-writes order, reports where it stands, keeps its brief until released.
- **New work mid-run** (operator message or an `inbox.md` item): if it is a pause, stop or priority change, handle it as above. Otherwise append it verbatim with a timestamp to `BRIEF.md`, add its units to `PLAN.md` (dependencies on running units, same rules as §2), extend Done means (never relax it), log a `scope` row, reply in one line which units and in what order. §6 starts only when these units are done too. Answer from the next wake at the latest; never let it wait behind a long block.

## Run type

- Cleanup without behavior change (old comments, dead code, obsolete tests, cruft): read `../deslop/SKILL.md` first; its scan and findings become the plan and units.
- Everything else (feature, fix, migration, parity): the default flow below.

## Size check (ground first as in §1, then decide)

**Light path** only if all hold: one PR, few files, one area; easy to revert (no data migration, no change to stored data or formats, no public API); goal and check are clear without design work. Otherwise the full path. Log the choice with phase `size`.

Light path:
- `PLAN.md` is three lines: Goal, Done means, Assumptions. No unit list, no §2 design.
- §3 for one unit: one owner, then **always** one fresh verifier (it is the only check while the operator is away), max 3 fix rounds, land per `references/merge-rules.md`.
- §4 applies. Skip §6 steps 1–4; write `report.md` (with the usage tables) and reply as in §6 step 5.
- Trail rows only for `start`, `size`, assumptions, verdicts, the end, so `/skill:recap` still works.
- **Escalate** when it grows (second area or PR needed, a risk from the list above appears): the owner stops and reports, you switch to the full path from §1, log a `size` row why.

## Agents

Two kinds, both always with `--model <id>` (§Models), `--session-dir <task>/sessions` and `--name <role>-<unit>` (names below), never `--no-session`:

- **Long-lived, in a herdr pane** (`../herdr/SKILL.md`): owners only. They run for hours, take fix rounds in the same context, and need auto-resume, which works only in interactive pi. `herdr agent start <tag>-owner-<n> --kind pi --pane <id> -- --model <id> --session-dir <task>/sessions --name owner-<n>`. herdr names are unique across every run on this machine, so prefix them with a run tag (`<tag>`: ≤ 12 chars of the task slug, `[a-z0-9]`, written to `resume.md`) and address owners by their pane ID from `agents.tsv`; another run's `owner-1` is not yours.
  - **Panes in your own tab:** the run's tab (`$HERDR_TAB_ID`) holds you and your owners; never create tabs (the orchestrator does that, one per run). New owner: `herdr pane split <your pane or an owner pane> --direction right|down --cwd <its worktree> --no-focus` (direction per `herdr pane layout`: split the largest pane), then `agent start` in `.result.pane.pane_id`. At most 4 owner panes at once; further parallel units wait for a free slot. Close an owner's pane (`herdr pane close <id>`) once its unit landed or was dropped.
- **One-shot, headless:** verifier, design sketch, final verify, attention review, scans. Start each with `scripts/launch.sh <task> <name> -- timeout 1800 pi -p --model <id> --session-dir <task>/sessions --name <name> "<prompt>"`; `units/<name>.md` is its reply, `.pid`/`.exit` record how it ended. Wait with `scripts/wait-any.sh job:<task>/units/<name>` (§4). Never `nohup … &` by hand or find a job later with `pgrep`/`pkill -f`: the pattern matches the waiting shell itself. Auto-resume does not run here: on a limit or other error (non-zero exit, empty or error reply), rerun once on the role's fallback model and log a `model` row; a second failure is a gap.

Names (pi `--name`; herdr adds the run tag): `owner-<n>` (replacement `owner-<n>-b`), `verifier-<n>-r<round>`, `design-<topic>`, `scan-<area>`, `final-verify`, `attention`. The part before the first `-` is the role in the usage table.

## Models

Claude builds, GPT checks, so both subscriptions share the load and every verdict comes from the other family. Always pass the model at start (§Agents). Use only these IDs or ones from `pi --list-models`; never invent one.

| Role | Model | Fallback on limit |
|---|---|---|
| Owner, full path | `pi-claude-cli/claude-opus-5-5:medium` | `openai/gpt-6.1-sol:medium` |
| Owner, light path | `pi-claude-cli/claude-sonnet-5-5:medium` | `openai/gpt-6.1-sol:medium` |
| Mechanical scans (e.g. deslop areas) | `pi-claude-cli/claude-sonnet-5-5:low` | `openai/gpt-6.1-sol:low` |
| Verifier | `openai/gpt-6.1-sol:high` | `pi-claude-cli/claude-opus-5-5:high` |
| Design sketch (2–3 options) | `openai/gpt-6.1-sol:medium` | `pi-claude-cli/claude-opus-5-5:medium` |
| Attention review | the family the root is not on (`$PI_PROVIDER`), its strongest model at `:medium` | the other family |

Reasoning: medium is the default; more thinking tends to over-engineer and burns limits. Only the verifier runs at high, because finding bugs pays for depth and its proof rule (FAIL only for demonstrable issues) keeps over-thinking from blocking. Never xhigh. Lower to low only for mechanical work.

- The verifier is always the other family than that unit's owner; if the owner ran on its fallback, swap the verifier too.
- Limit hit (agent reports it, or auto-resume shows a wait): the running agent waits it out via auto-resume; new agents of that role start on the fallback until the limit resets. Log a `model` row (role, from, to, why).
- Both families limited: pause safely (§0) with the reset times in `resume.md`.
- Root: the model the operator started; not switched. `report.md` lists which model filled each role.

## Rigor

One level per run, in `PLAN.md`. Source, first match wins: the brief ("fast", "schnell", "live testen" → `fast`; "gründlich", "sicher", "careful" → `high`), a merge or testing policy in the repo's AGENTS.md/README (e.g. "merge to main quickly to test live" → `fast`), else `normal`. Log it with phase `rigor`, naming the source.

Rigor only changes cloud CI: what is waited for and what is started. Local checks and live runs (owner proof, verifier gates and live run) are never reduced at any level: whatever can run on this machine runs.

| | `fast` | `normal` | `high` |
|---|---|---|---|
| PR checks to wait for before merge | required only | all that start automatically | all that start automatically |
| Manually triggered workflows (`workflow_dispatch`, e.g. simulator or device runs) | never | never | yes, when they cover the touched paths |
| Base CI after merge | checked on each wake, next unit goes on | wait (`wait-any.sh sha:<merge-sha>`) | wait |

- A unit with a one-way door (data migration, stored data or format change, public API) runs at `high` whatever the run's level. Log a `rigor` row.
- `fast` grants merge permission only when its source asks for quick merges; otherwise it only drops the waits.
- `fast`, base CI: on each wake read `gh run list --branch <base> --json headSha,conclusion --limit 5`. Red: the fix is the next unit, highest priority, and at most one more unit lands on a red base. If the fix does not pass its first round, revert the culprit (a clean `git revert` PR needs no verifier), re-plan its unit, log both.
- `fast`, handing over: the repo's own deploy of the base (e.g. a beta or store build) is the operator's signal; add no notification tools. Every merged PR with `needs-human` items goes into `report.md` under `## Ready to test` (PR, test steps, merged at), updated after each merge.

## 1. Frame (skip parts the user already gave)

Ground first (read the repo's AGENTS.md/README, count the work, and list other runs of this repo with `../orchestrator/scripts/runs.sh`: for each `running` one read its `PLAN.md` and open PRs; a unit touching the same files depends on their merge, log it as `assume`), then write `PLAN.md`:

```
Goal: <one sentence>
Done means: <falsifiable predicate: commands, tests, merged PRs, metric thresholds; "old vs new" where measurable>
Out of scope: <list>
Permissions: <from the brief. Default: worktrees, branches, PRs. Merge only if the brief says so>
Rigor: <fast/normal/high, its source, and why (§Rigor)>
Scope: <rough units and effort, blockers found while grounding>
Assumptions: <decisions made instead of asking>
```

A vague goal ("like project X") becomes a concrete predicate first (gap analysis by an owner if needed). Never ask: pick the reasonable option, write it under Assumptions, log it with phase `assume`.

## 2. Design the workflow

Add to `PLAN.md` an ordered unit list. Each unit = one narrow, independently landable PR (prefer five narrow PRs over one large one):
`<n>. <title> | acceptance: <checks + behavior to show> | depends on: <unit or -> | parallel: yes/no`

- Riskiest unknown first. Verification harness and baseline (pre-change measurements) before features.
- Parallelize only across seams (different files/areas), each owner in its own worktree. No cap on owners at once: run as many as there are independent units that pay off in parallel; go sequential when units touch the same area, build on each other, or overlap would cause rebase churn. Fewest possible dependencies.
- One-way-door design decisions: have one owner sketch 2–3 options with tradeoffs in `units/design-<topic>.md`, pick one, log why. Mechanical work skips this.

## 3. Run the loop (per unit)

1. **Spawn the owner.** Fresh `pi` on the owner model (§Models) in its own herdr pane in your tab as `owner-<n>` (§Agents), in a fresh worktree (`../worktrees/SKILL.md` for `.bare` repos) on the base from `references/merge-rules.md`. Prompt: path to `references/pr-owner.md`, the unit line, the unit's rigor, Done means, out of scope, permissions, base branch, task folder. Record it in `agents.tsv` (name, pane, unit, branch, started, stuck-after minutes from past units of its kind, default 90).
2. **Code-ready.** The owner builds, proves the change on the real artifact, runs the deslop pass, opens the PR (ready, not draft), and reports the code-ready head SHA.
3. **Verify.** Run a **fresh** headless verifier `verifier-<n>-r<round>` (§Agents) on the verifier model (§Models, other family than the owner) with `references/verifier.md`, unit, acceptance, rigor, PR, exact head SHA, base. Verdict: `PASS`, `PASS+NOTES` or `FAIL` with every provable issue. Drop a verdict that does not name the SHA and what it ran; respawn once, then record a gap. A gap is not a pass.
4. **Fix rounds.** `FAIL`: send all issues to the owner, it fixes, redoes the deslop pass on changed lines, reports the new head. Re-verify per `references/merge-rules.md` (one fresh verifier; wording-only change: none). Max 3 rounds, then shrink or discard the unit and log why.
5. **Land** per `references/merge-rules.md`: merge only with permission and only a verdict covering the head that lands; otherwise stop at verified.
6. **Trail row** (see §5) and `resume.md` update after every unit outcome. Close finished panes; after a merge run `scripts/cleanup.sh <repo-root>` (removes only landed, clean worktrees and branches).

Loop discipline: every unit is an experiment. State the hypothesis, make the smallest change the evidence justifies, verify on the real artifact, keep if it advanced, revert if not. Belt-and-suspenders that "might help" gets reverted. Verify by inspecting the artifact, never a self-report; when something passes too easily, suspect the check first. If a worker games a gate, reset and tighten the brief. If the gate itself is wrong, fix it in its own PR.

## 4. Root duties while it runs

- **Wake on events, not timers.** Send owners work with `herdr agent prompt <pane-id> "…"` (no `--wait`), then block on everything pending in one call: `scripts/wait-any.sh herdr:<pane-id> job:<task>/units/<name> run:<id> pr:<n>[:required]`; right after a push or merge, before a run id exists, `sha:<sha>` (never `sleep` until a run shows up). It returns on the first end, caps at 20 min (exit 124), and kills the other waiters. Handle what ended at once, then call it again with what is still pending. Exit 124: audit (below), then wait again. Before each call, post one line: what you wait on. Never hand-roll waits (`wait` joining all, `herdr agent wait --until`, `tail --pid`, `; echo settled`, `>/dev/null` on the waiter): each variant hid an end for up to 64 min. A run or PR is watched by one agent only: owners their PR checks, the root base CI. Never `sleep`-poll. Usage limits: per §Models.
- **Audit on every wake and every capped wait:** check each agent by side effects (new commits, pushes, trail rows, pane output via `herdr agent read --lines 40`), not by its status text. Stuck = errors, cannot start turns, or nothing new past its stuck-after time. Replace a stuck owner at once (new pane as `owner-<n>-b`, same brief, pointing at its branch and `units/` report). An agent waiting on a question is not stuck: answer it.
- **Fix drift:** unreported heads, unrecorded agents, missing trail rows: have the owner record them.
- **Countersign gate loosening:** anything that weakens a check (raised budget, allowlist entry, skipped/soft-failed test, disabled lint) needs verifier proof and your explicit countersign row in the trail. A disabled or soft-failed check always comes back out. Never bypass branch protection or forge-enforced approvals.
- **Mid-run discoveries are yours:** broken tooling, flaky checks, related bugs, review noise go into their own small unit/PR. Then return to the predicate.
- **Ask only for irreversible actions**, genuine product calls no experiment can settle, or a real dead end. Everything reversible: do it, log it.
- **Plateau is a pivot, not a stop.** Change approach, split the unit. Never relax Done means. Escape hatch: a few hours without the predicate moving, or a blocker only the operator can clear: pause safely (§0), write why in `resume.md`, stop.
- **Context budget:** never read full diffs, logs or transcripts yourself; agents reply in ≤10 lines and write details to `units/`. Bound every command's output.

## 5. Decision trail (show-me-your-work)

`decisions.tsv`, columns `ts phase decision why evidence result`, via `scripts/log.sh <task-folder> <phase> <decision> <why> <evidence> <result>`. One row per decision or checkpoint (fork chosen, unit verified, pivot, revert, blocker, gate fix, countersign), one row per loop iteration, nothing trivial.

- Plain words a teammate understands, no jargon. Evidence is a pointer (SHA, PR #, file:line, artifact path), never prose. Result short: `VERIFIED`, `NOT VERIFIED`, `INCONCLUSIVE`, `reverted`, `merged #123`, `open`, `blocked`, `needs-human`. Inconclusive is not a pass; never hide a negative.
- Always log: assumptions (`assume`), each verdict with round and verifier model, reverts and discarded units, countersigns, things only a human can check (`needs-human`).
- Append-only: a wrong row gets a superseding row, never an edit. A run (new session or replacement root) starts with a `start` row naming the ts range of earlier rows it did not write and its own session.

## 6. Verify the whole and hand back

1. One fresh headless verifier `final-verify` (§Agents) runs the full Done means predicate on the real product: on the base branch if units merged, else on a local never-pushed integration branch merging all stack tips. Failures become new units.
2. **Cleanup and trail audit:** run `scripts/cleanup.sh <repo-root>`; list every `kept` line in `report.md`. Then check this run's rows: each maps to a real action, each evidence pointer resolves (`git cat-file -e`, `gh pr view`). Add superseding rows for wrong ones and rows for unlogged forks or pivots.
3. **Attention review:** one fresh headless agent `attention` (§Agents) on a different model family than the root. It reads `PLAN.md`, `decisions.tsv`, `units/*.md` (bounded) and the PR list, not transcripts, and lists: decisions with weak or no evidence, verification claimed without proof, risky or scope-creeping choices, gaps a skim would miss. Its list goes into `report.md` under `## Attention`, headed `reviewed by <model>` ("No flags" is valid).
4. Encode recurring corrections from this run as a check, lint rule or script in their own PR if cheap, otherwise list them in the report.
5. `report.md`: first carry every factual correction from verifiers into it and the reply, not only the PR text. Then predicate state per check, PRs with verdict and state (merge order if unmerged), discarded work and why, checks actually run, cloud checks not awaited (§Rigor) and their later result, what still needs a human (`## Ready to test` at `fast`), Attention. Append `scripts/usage.sh <task>` output (its `## Usage` tables). Set `Status: done` in `resume.md`. Reply in ≤10 lines and point to `/skill:recap` (catch-up) and `/skill:reflect <task>` (improve the skills from this run).
