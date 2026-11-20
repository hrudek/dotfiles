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

- Task folder: `~/.cache/agent-tasks/<repo>/<task-slug>/`, never inside a repository. Holds `BRIEF.md` (request verbatim), `PLAN.md`, `decisions.tsv`, `agents.tsv`, `resume.md`, `units/<n>-<slug>.md`, `sessions/`, `report.md`.
- **Sessions:** at start, `mkdir -p <task>/sessions && ln -sfn "$PI_SESSION_FILE" <task>/sessions/root.jsonl` (a later root on pickup: `root-2.jsonl`, …). Every agent you start writes its session there (see §Agents), so `/skill:recap` and `/skill:reflect <task>` can evaluate the whole run.
- **Pickup:** if the folder has `resume.md` or `decisions.tsv`, read `resume.md`, the last 20 trail rows, `agents.tsv`, and the PR/branch state (`gh pr list --json`, `git log`). The trail is authoritative: name the resume point, do not redo finished work or re-run old repros, log a `start` row, continue. Verify inherited claims on the real artifact before building on them.
- **Pause on request** ("pause", "ich gehe offline", "restart"): never on "keep going". Finish or back out of the current atomic step, start nothing new, tell owners to stop, `wip:` commit uncommitted work on its branch (say in the body if the tree is broken), no new PR or push, update `resume.md`, reply where things stand and the first action on resume.
- **Stop/hold from the operator:** every owner gets a zero-writes order, reports where it stands, keeps its brief until released.

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

- **Long-lived, in a herdr pane** (`../herdr/SKILL.md`): owners only. They run for hours, take fix rounds in the same context, and need auto-resume, which works only in interactive pi. `herdr agent start owner-<n> --kind pi --pane <id> -- --model <id> --session-dir <task>/sessions --name owner-<n>`.
  - **Worker tab:** all owner panes go in one tab per session, never in your own tab. Before the first owner, if `resume.md` names no worker tab or `herdr tab get <id>` fails, create it once: `herdr tab create --workspace "$HERDR_WORKSPACE_ID" --label autopilot-<task-slug> --no-focus`; record `.result.tab.tab_id` in `resume.md`, use `.result.root_pane.pane_id` for that owner. Later owners and replacements: `herdr pane split <pane in the worker tab> --direction right|down --no-focus` (direction per `herdr pane layout`), then `agent start` in the returned pane. Never create a second worker tab while the first is alive.
- **One-shot, headless:** verifier, design sketch, final verify, attention review, scans. `timeout 1800 pi -p --model <id> --session-dir <task>/sessions --name <name> "<prompt>" > <task>/units/<name>.md 2>&1`; the file is its reply. Several at once: `( cmd1 & cmd2 & wait )`. Auto-resume does not run here: on a limit or other error (non-zero exit, empty or error reply), rerun once on the role's fallback model and log a `model` row; a second failure is a gap.

Names: `owner-<n>` (replacement `owner-<n>-b`), `verifier-<n>-r<round>`, `design-<topic>`, `scan-<area>`, `final-verify`, `attention`. The part before the first `-` is the role in the usage table.

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
| Base CI after merge | checked on each wake, next unit goes on | wait (`gh run watch`) | wait |

- A unit with a one-way door (data migration, stored data or format change, public API) runs at `high` whatever the run's level. Log a `rigor` row.
- `fast` grants merge permission only when its source asks for quick merges; otherwise it only drops the waits.
- `fast`, base CI: on each wake read `gh run list --branch <base> --json headSha,conclusion --limit 5`. Red: the fix is the next unit, highest priority, and at most one more unit lands on a red base. If the fix does not pass its first round, revert the culprit (a clean `git revert` PR needs no verifier), re-plan its unit, log both.
- `fast`, handing over: the repo's own deploy of the base (e.g. a beta or store build) is the operator's signal; add no notification tools. Every merged PR with `needs-human` items goes into `report.md` under `## Ready to test` (PR, test steps, merged at), updated after each merge.

## 1. Frame (skip parts the user already gave)

Ground first (read the repo's AGENTS.md/README, count the work), then write `PLAN.md`:

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

1. **Spawn the owner.** Fresh `pi` on the owner model (§Models) in its own herdr pane in the worker tab as `owner-<n>` (§Agents), in a fresh worktree (`../worktrees/SKILL.md` for `.bare` repos) on the base from `references/merge-rules.md`. Prompt: path to `references/pr-owner.md`, the unit line, the unit's rigor, Done means, out of scope, permissions, base branch, task folder. Record it in `agents.tsv` (name, pane, unit, branch, started, stuck-after minutes from past units of its kind, default 90).
2. **Code-ready.** The owner builds, proves the change on the real artifact, runs the deslop pass, opens the PR (ready, not draft), and reports the code-ready head SHA.
3. **Verify.** Run a **fresh** headless verifier `verifier-<n>-r<round>` (§Agents) on the verifier model (§Models, other family than the owner) with `references/verifier.md`, unit, acceptance, rigor, PR, exact head SHA, base. Verdict: `PASS`, `PASS+NOTES` or `FAIL` with every provable issue. Drop a verdict that does not name the SHA and what it ran; respawn once, then record a gap. A gap is not a pass.
4. **Fix rounds.** `FAIL`: send all issues to the owner, it fixes, redoes the deslop pass on changed lines, reports the new head. Re-verify per `references/merge-rules.md` (one fresh verifier; wording-only change: none). Max 3 rounds, then shrink or discard the unit and log why.
5. **Land** per `references/merge-rules.md`: merge only with permission and only a verdict covering the head that lands; otherwise stop at verified.
6. **Trail row** (see §5) and `resume.md` update after every unit outcome. Close finished panes.

Loop discipline: every unit is an experiment. State the hypothesis, make the smallest change the evidence justifies, verify on the real artifact, keep if it advanced, revert if not. Belt-and-suspenders that "might help" gets reverted. Verify by inspecting the artifact, never a self-report; when something passes too easily, suspect the check first. If a worker games a gate, reset and tighten the brief. If the gate itself is wrong, fix it in its own PR.

## 4. Root duties while it runs

- **Wake on events, not timers.** Prompt owners with `herdr agent prompt <owner> "…" --wait --timeout <ms>`, no `--until` (the defaults include `done`; a hand-written list missed it and idled 85 min). Block on `gh pr checks --watch`, `gh run watch` only where §Rigor waits for CI, always under `timeout`. Never `sleep`-poll. Usage limits: per §Models.
- **Audit roughly hourly or on every wake:** check each agent by side effects (new commits, pushes, trail rows, pane output via `herdr agent read --lines 40`), not by its status text. Stuck = errors, cannot start turns, or nothing new past its stuck-after time. Replace a stuck owner at once (new pane as `owner-<n>-b`, same brief, pointing at its branch and `units/` report). An agent waiting on a question is not stuck: answer it.
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
2. **Trail audit:** check this run's rows: each maps to a real action, each evidence pointer resolves (`git cat-file -e`, `gh pr view`). Add superseding rows for wrong ones and rows for unlogged forks or pivots.
3. **Attention review:** one fresh headless agent `attention` (§Agents) on a different model family than the root. It reads `PLAN.md`, `decisions.tsv`, `units/*.md` (bounded) and the PR list, not transcripts, and lists: decisions with weak or no evidence, verification claimed without proof, risky or scope-creeping choices, gaps a skim would miss. Its list goes into `report.md` under `## Attention`, headed `reviewed by <model>` ("No flags" is valid).
4. Encode recurring corrections from this run as a check, lint rule or script in their own PR if cheap, otherwise list them in the report.
5. `report.md`: first carry every factual correction from verifiers into it and the reply, not only the PR text. Then predicate state per check, PRs with verdict and state (merge order if unmerged), discarded work and why, checks actually run, cloud checks not awaited (§Rigor) and their later result, what still needs a human (`## Ready to test` at `fast`), Attention. Append `scripts/usage.sh <task>` output (its `## Usage` tables). Reply in ≤10 lines and point to `/skill:recap` (catch-up) and `/skill:reflect <task>` (improve the skills from this run).
