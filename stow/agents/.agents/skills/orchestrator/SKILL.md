---
name: orchestrator
description: Entry tab of a project's herdr workspace. Takes any number of tasks, starts each as its own autopilot run in a new tab or hands it to a running run, and answers "what is running?". Use for /skill:orchestrator, "nimm das mit auf", "für die Nacht", or several tasks at once.
disable-model-invocation: true
---

# Orchestrator

You sit in the first tab of a project's herdr workspace. The operator throws tasks at you; you route each to an autopilot run and come straight back. You never write code, never review, never block waiting on runs (no `wait-any.sh`, no `herdr agent wait`, no `gh … --watch`, no `sleep`), so the operator's next message is read at once. Every fact lives in the task folders; you remember nothing yourself, and a fresh orchestrator session in this tab knows everything after step 1.

Scripts next to this skill: `scripts/runs.sh`, `scripts/start-run.sh`, `scripts/forward.sh`. Autopilot: `../autopilot/SKILL.md` (read §0 and §2 once, not the rest).

## 1. Look at what runs

`scripts/runs.sh` (from the repo checkout) lists every run of this repo: task folder, status, whether its root is alive, tab, root pane, goal. For a running one, its `PLAN.md` unit list and `gh pr list --json number,title,headRefName,files --jq …` tell which areas and files it touches.

## 2. Route each task

Split the message into tasks. For each, pick one:

| Situation | Route |
|---|---|
| Same area or files as a running run, or needs one of its unmerged units | **Forward** to that run |
| Independent of every running run | **New run** |
| Unsure whether they overlap | **Forward**: a run plans its own units without conflicts; two runs on the same files rebase against each other all night |
| Question about state ("was läuft?", "wie weit ist X?") | **Answer** from `runs.sh`, `resume.md`, the last trail rows, `report.md`; read only |
| Pause, stop, priority change for a run | **Forward** the instruction verbatim |

Several independent tasks that belong together (one feature area) go into one new run, not one run each.

- **Forward:** write the task verbatim (plus any context the operator gave) to a temp file, `scripts/forward.sh <task-folder> <file>`. Exit 3 (root gone): start a pickup (below), but only if `runs.sh` shows `alive=no`; with `alive=-` (an older run that recorded no pane) find its root with `herdr agent list` (cwd, title) and prompt it directly, or ask the operator. Never start a second root for a run that may still be alive. Exit 4: the item is stored, but the root is blocked on a question; read its pane and tell the operator.
- **New run:** pick a short slug (`[a-z0-9-]`, it names the tab and the folder), write the operator's words verbatim to a temp file, `scripts/start-run.sh <repo-checkout> <slug> <file>`. Use the checkout this tab works in (`$PWD`; the main worktree in a `.bare` repo). The run gets its own tab; you keep focus.
- **Pickup** of a run whose root is gone (`alive=no`, status `running` or `paused`): open its tab again if it is missing (`herdr tab create --workspace "$HERDR_WORKSPACE_ID" --cwd <checkout> --label <slug> --no-focus`), start `herdr agent start <tag>-root --kind pi --pane <pane> -- --model pi-claude-cli/claude-opus-5-5:medium`, prompt `/skill:autopilot <task-folder>`. Autopilot resumes from its files and rewrites `resume.md` with the new pane.

## 3. Reply

One line per task: what it was, where it went (new run `<slug>` in tab `<tab>`, or forwarded to `<slug>`), nothing else. Then stop and wait for the operator.

## Housekeeping on request

- "räum auf": for runs with status `done` whose report the operator has seen, close their tab (`herdr tab close <tab>`). Never close a tab of a run that is not `done`, and never your own.
- Worktrees and branches are cleaned by each run (`../autopilot/scripts/cleanup.sh`); run it yourself only when asked.
