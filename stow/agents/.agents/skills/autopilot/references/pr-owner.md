# PR owner brief

You own one unit from build to land. The root owns verdicts; you never land on your own judgment. You were given: unit, acceptance, rigor, Done means, out of scope, permissions, base branch, task folder. Rigor (`../SKILL.md` §Rigor) only changes which cloud CI you wait for or start; it never reduces local checks or live runs.

## Survive being replaced

Assume your session dies. Push your branch soon after starting and after each finished step. Keep `units/<n>-<slug>.md` in the task folder current: what you did, what is verified, current head, next step. Force-push only your own branch with `git push --force-with-lease=<branch>:<sha-you-last-pushed>`; on any push you did not make, stop and report to the root.

## 1. Build

- Light-path unit (the root says so): if it needs a second area or PR, a data migration, a stored-format or public-API change, stop and report to the root before going on.
- Work only in your worktree. Smallest change the evidence justifies. No scope creep; note out-of-scope findings in your report as follow-ups.
- Commit liberally while working; before the PR, rebase into small ordered commits, each landable. Commit bodies do not restate the subject.

## 2. Prove it works

Run the acceptance checks and the repo's checks for the touched paths on the committed head. Show the behavior on the real artifact the way a user would hit it (run the app/CLI/test harness, compare base vs head where measurable). A green unit test alone is not proof of behavior. If this machine cannot run it (e.g. needs another OS or a device), say so in your report; do not start a manually triggered workflow as a substitute unless rigor is `high`.

## 3. Clean up

Run the deslop pass from `../../deslop/references/rules.md` (relative to this file) over your diff, then re-run the checks.

## 4. Open the PR (ready, never draft)

- Title: Conventional Commits `type(scope): subject`, imperative, no trailing period.
- Body, `##` headings in this order, drop empty ones, short plain sentences, under ~40 lines:
  - `## Why`: problem and approach, 1–3 sentences.
  - `## What changed`: 1–3 bullets.
  - `## Scope`: always; what it covers and deliberately leaves out.
  - `## Tradeoffs`: only rejected alternatives a reviewer would ask about.
  - `## Blast Radius`: who/what it touches and why that is safe or risky.
  - `## Verification`: 1–3 bullets, each a real run and its outcome; perf as `before → after` with unit.
  - `## Test`: only when something needs a human (no live run possible here): 1–3 steps the operator does on the deployed build.
- Stacked unit: `gh pr create --base <parent-branch>`.
- Then rebase onto the current base and report **code-ready** to the root: head SHA, PR #, checks run with results, max 10 lines.

## 5. Babysit to green

Order: conflicts, then review threads, then CI. Batch fixes into one push. Answer review threads (fix or reply with reason). A conflict on a stack you do not own: report, do not resolve. Wait under `timeout`, never `sleep`, only for the checks the rigor names: `fast` `../scripts/wait-any.sh pr:<pr>:required` (none required: nothing to wait for), `normal`/`high` `../scripts/wait-any.sh pr:<pr>` (polls every 60 s; exit 124 after 20 min: report progress to the root, then wait again). Start manually triggered workflows only at `high`. Report every new head to the root. When verified, green and threads resolved, report **merge-ready**.

## 6. Fix rounds

On verifier issues: fix all of them, redo the deslop pass on changed lines, re-run checks, push, report the new head and which issues each commit addresses.

## 7. Land (only when the root says so)

Follow `merge-rules.md` exactly. Read the PR back after merging (`gh pr view <pr> --json state,mergedAt,baseRefName`): a queued or auto-merge request is not a merge.

## Reply format to the root

Max 10 lines: status (`code-ready`/`merge-ready`/`blocked`/`merged`), PR #, head SHA, checks run with result, open issues. Details go to your `units/` file.
