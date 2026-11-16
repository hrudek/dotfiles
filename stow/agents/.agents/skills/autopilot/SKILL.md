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

## 0. Task folder, pickup, stop

- Task folder: `~/.cache/agent-tasks/<repo>/<task-slug>/`, never inside a repository. Holds `BRIEF.md` (request verbatim), `PLAN.md`, `decisions.tsv`, `agents.tsv`, `resume.md`, `units/<n>-<slug>.md`, `report.md`.
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
- §4 applies. Skip §6 steps 1–4; write `report.md` and reply as in §6 step 5.
- Trail rows only for `start`, `size`, assumptions, verdicts, the end, so `/skill:recap` still works.
- **Escalate** when it grows (second area or PR needed, a risk from the list above appears): the owner stops and reports, you switch to the full path from §1, log a `size` row why.

## 1. Frame (skip parts the user already gave)

Ground first (read the repo's AGENTS.md/README, count the work), then write `PLAN.md`:

```
Goal: <one sentence>
Done means: <falsifiable predicate: commands, tests, merged PRs, metric thresholds; "old vs new" where measurable>
Out of scope: <list>
Permissions: <from the brief. Default: worktrees, branches, PRs. Merge only if the brief says so>
Rigor: <low/normal/high and why: one-way doors and big blast radius get more gates>
Scope: <rough units and effort, blockers found while grounding>
Assumptions: <decisions made instead of asking>
```

A vague goal ("like project X") becomes a concrete predicate first (gap analysis by an owner if needed). Never ask: pick the reasonable option, write it under Assumptions, log it with phase `assume`.

## 2. Design the workflow

Add to `PLAN.md` an ordered unit list. Each unit = one narrow, independently landable PR (prefer five narrow PRs over one large one):
`<n>. <title> | acceptance: <checks + behavior to show> | depends on: <unit or -> | parallel: yes/no`

- Riskiest unknown first. Verification harness and baseline (pre-change measurements) before features.
- Parallelize only across seams (different files/areas), each owner in its own worktree, max 2 owners at once. Fewest possible dependencies.
- One-way-door design decisions: have one owner sketch 2–3 options with tradeoffs in `units/design-<topic>.md`, pick one, log why. Mechanical work skips this.

## 3. Run the loop (per unit)

1. **Spawn the owner.** Fresh `pi` in its own herdr pane (`../herdr/SKILL.md`), in a fresh worktree (`../worktrees/SKILL.md` for `.bare` repos) on the base from `references/merge-rules.md`. Prompt: path to `references/pr-owner.md`, the unit line, Done means, out of scope, permissions, base branch, task folder. Record it in `agents.tsv` (name, pane, unit, branch, started, stuck-after minutes from past units of its kind, default 90).
2. **Code-ready.** The owner builds, proves the change on the real artifact, runs the deslop pass, opens the PR (ready, not draft), and reports the code-ready head SHA.
3. **Verify.** Spawn a **fresh** verifier (prefer a different model family than the owner, if it has capacity) with `references/verifier.md`, unit, acceptance, PR, exact head SHA, base. Verdict: `PASS`, `PASS+NOTES` or `FAIL` with every provable issue. Drop a verdict that does not name the SHA and what it ran; respawn once, then record a gap. A gap is not a pass.
4. **Fix rounds.** `FAIL`: send all issues to the owner, it fixes, redoes the deslop pass on changed lines, reports the new head. Re-verify per `references/merge-rules.md` (one fresh verifier; wording-only change: none). Max 3 rounds, then shrink or discard the unit and log why.
5. **Land** per `references/merge-rules.md`: merge only with permission and only a verdict covering the head that lands; otherwise stop at verified.
6. **Trail row** (see §5) and `resume.md` update after every unit outcome. Close finished panes.

Loop discipline: every unit is an experiment. State the hypothesis, make the smallest change the evidence justifies, verify on the real artifact, keep if it advanced, revert if not. Belt-and-suspenders that "might help" gets reverted. Verify by inspecting the artifact, never a self-report; when something passes too easily, suspect the check first. If a worker games a gate, reset and tighten the brief. If the gate itself is wrong, fix it in its own PR.

## 4. Root duties while it runs

- **Wake on events, not timers.** Block on `herdr agent wait`/`--wait`, `gh pr checks --watch`, `gh run watch`, always under `timeout`. Never `sleep`-poll. Usage limits: auto-resume waits them out; owners on an exhausted model switch to the other family, never invented model IDs.
- **Audit roughly hourly or on every wake:** check each agent by side effects (new commits, pushes, trail rows, pane output via `herdr agent read --lines 40`), not by its status text. Stuck = errors, cannot start turns, or nothing new past its stuck-after time. Replace a stuck agent at once (new pane, same brief, pointing at its branch and `units/` report). An agent waiting on a question is not stuck: answer it.
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

1. One fresh verifier runs the full Done means predicate on the real product: on the base branch if units merged, else on a local never-pushed integration branch merging all stack tips. Failures become new units.
2. **Trail audit:** check this run's rows: each maps to a real action, each evidence pointer resolves (`git cat-file -e`, `gh pr view`). Add superseding rows for wrong ones and rows for unlogged forks or pivots.
3. **Attention review:** spawn one fresh agent on a different model family than the root. It reads `PLAN.md`, `decisions.tsv`, `units/*.md` (bounded) and the PR list, not transcripts, and lists: decisions with weak or no evidence, verification claimed without proof, risky or scope-creeping choices, gaps a skim would miss. Its list goes into `report.md` under `## Attention`, headed `reviewed by <model>` ("No flags" is valid).
4. Encode recurring corrections from this run as a check, lint rule or script in their own PR if cheap, otherwise list them in the report.
5. `report.md`: predicate state per check, PRs with verdict and state (merge order if unmerged), discarded work and why, checks actually run, what still needs a human, Attention. Reply in ≤10 lines and point to `/skill:recap`.
