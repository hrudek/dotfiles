---
name: deslop
description: Remove slop without changing behavior. On your own diff (default) it strips debug leftovers, dead code, needless guards and comments before review. On a path or the whole codebase it finds wrong, stale or useless comments, dead code, obsolete or worthless tests, unused dependencies, stale scripts and docs, each removal backed by evidence, and ships small reviewable PRs, interactively or unattended via autopilot. Use for /skill:deslop, "deslop", "aufräumen", "alte Kommentare entfernen", "tote Tests", "obsoleten Code löschen".
disable-model-invocation: true
---

# Deslop

Subtract, do not add. The product behaves exactly the same afterwards; the code is smaller and every remaining comment and test tells the truth. No refactoring, renaming campaigns, style rewrites or new features. The rules for what counts as slop are in `references/rules.md`.

## Modes

- `/skill:deslop` (no target): **diff mode**. Apply `references/rules.md` to the current branch's diff against its base, re-run checks, commit. Stop here; the rest of this file is codebase mode.
- `/skill:deslop <path or area>`: **codebase mode**. Scan, then ask which findings to apply (interactive).
- `/skill:deslop <path> autopilot` (or the user is away): scan, write the plan, then run it per `../autopilot/SKILL.md` with that plan. Permissions come from the request (default: PRs, no merge).
- `/skill:deslop <path> scan`: findings only, no changes.

Task folder: `~/.cache/agent-tasks/<repo>/deslop-<area>/` (outside the repo). Large repos: delegate the scan per area to fresh `pi` workers (`../herdr/SKILL.md`), each writing `findings-<area>.md`; read only their summaries.

## 1. Baseline

Before touching anything, record: build command and result, full test command with pass/fail/skip counts, coverage if the repo has a tool for it, lint/typecheck result. Pre-existing failures are noted, not fixed here (separate unit if wanted). Done means for the run: same build/lint result, every remaining test passes, no live behavior lost coverage, each removal has evidence.

## 2. Scan (evidence or it stays)

Use the language's tooling first, then `rg`, then judgment. Examples: Swift `periphery`, TS/JS `knip`/`ts-prune`/`depcheck`, Python `vulture`/`ruff`, Go `deadcode`/`staticcheck`, Rust compiler warnings/`cargo machete`. Check what is installed; do not install globally without need.

| Category | Find | Evidence required to remove |
|---|---|---|
| Wrong comments | comments that contradict the code, name things that no longer exist, describe old behavior | the code line it contradicts; `git log -L`/`git blame` showing the code changed after the comment |
| Useless comments | narration, restating code, banners, commented-out code, history notes, resolved or abandoned `TODO`/`FIXME` | the comment rules in `references/rules.md`; for TODOs: done already, or `git log` shows it untouched for a long time and no issue tracks it (then list, don't silently drop real work) |
| Dead code | unused functions, types, files, params, branches, feature flags always on/off, compat shims with no callers | tool output plus `rg` for every name, including dynamic uses: reflection, selectors, string keys, config/plist/manifest/storyboard/xib references, exported public API, scripts, CI |
| Obsolete tests | tests for removed features, permanently skipped/disabled tests, duplicates, tests that pass when the behavior breaks, tests pinned to internals | per test: which feature is gone, or which other test covers the same behavior, or the "break the behavior" edit that still passes |
| Dependencies | packages, pods, imports nobody uses | tool output + build passes without it |
| Repo cruft | stale scripts, configs, docs/README sections describing removed things, generated files committed by mistake | no references (`rg`, CI config), docs contradict code |

**Tests, specifically:** a good test fails when the behavior breaks and survives a refactor that keeps behavior. Delete a test only if it protects nothing (removed feature, exact duplicate, cannot fail). A test that guards live behavior but is pinned to internals or flaky gets **rewritten** against the public behavior, not deleted. Never delete or skip a failing test to get green unless it is proven obsolete. Coverage of live code must not drop.

**Why does it exist?** For anything surprising (odd guard, `do not remove`, weird test), read the record before judging: `git log -S`, `git blame`, the PR/issue that introduced it. Cite it. If the record says it guards a real case, it stays.

**Unsure means it stays** and goes to the "uncertain" list with the open question.

## 3. Findings

`findings.md` in the task folder, grouped by category and area: item (`file:line` or symbol), why it is obsolete, evidence, risk (`low`/`med`/`high`), proposed action (delete / correct comment / rewrite test). Plus "uncertain" and "out of scope" lists. Interactive mode: show counts per category and the risky items, ask which to apply.

## 4. Apply in small PRs

- One PR per category per area (e.g. "remove stale comments in Keyboard/", "delete dead suggestion helpers", "rewrite pinned tests for Autocorrect"). Comments-only PRs separate from code PRs, so they are trivial to review.
- Order: comments → dead code → tests → dependencies → cruft. Removing dead code may make more code dead: rescan the area once afterwards.
- Every PR: build, lint, full tests (not only touched ones) green; test count changes explained in the PR body (`## Verification`: before → after, each removed test named with reason). PR format per `../autopilot/references/pr-owner.md`.
- Wrong comment whose content matters (keep-list category): correct it instead of deleting.
- Review: one fresh verifier per PR (`../autopilot/references/verifier.md`) with the extra question "does any removal change behavior or drop protection of live behavior?" Comments-only PRs: verifier checks only that no code changed and the build passes.

## 5. Report

`report.md`: what was removed per category (counts, lines), PRs, test count before → after with reasons, uncertain items with their open question, follow-ups (e.g. "comment explained a surprise in our code; code could be made obvious"). Use `../recap/SKILL.md` to catch the user up when run unattended.
