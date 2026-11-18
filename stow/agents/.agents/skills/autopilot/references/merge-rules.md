# Merge rules: rebase, stack, verdicts

Forge: `gh`. A verdict covers one patch; green CI covers one head. Green CI or a bot approval is never a verdict. Which CI is waited for and started depends on the rigor (`../SKILL.md` §Rigor); local checks never shrink.

## Where a unit's branch starts

| Merge permitted | Unit depends on | Branch from | PR base |
|---|---|---|---|
| yes | nothing | current base | base |
| yes | unit k | current base, after k merged | base |
| no | nothing | base | base |
| no | unit k | unit k's branch tip (stacked) | unit k's branch |

With merge permission never stack: units run in parallel off base and each lands on its own. Without it, stack only when a unit builds on another PR.

## When a new verdict is needed

- Full verification once at the code-ready head.
- New behavior, a redesign or a large new diff: full verification again.
- Rebase, conflict resolution or minor fix: one fresh verifier at the new head, limited to the changed parts plus the gates.
- Wording-only change (comments, PR text): none.
- **Patch-id rule:** before trusting an older verdict, compare `git patch-id --stable` of the verdict SHA's diff against its base with the current head's. Same patch-id: the verdict stands (the checks the rigor waits for still have to pass on the new head). Differs only in tests/docs/lint config: gate results stand if the build is the same, but the changed part gets fresh checks and review. Otherwise re-verify.

## Merge (only with permission)

1. Only a `PASS`/`PASS+NOTES` covering the exact head that lands, plus green checks per rigor (`fast`: required only; `normal`/`high`: all that started automatically), authorizes a merge.
2. Right before merging, `git fetch` the base and decide:
   - Rebase and wait for CI (per rigor) only when code that would land was never tested: a conflict, a file both sides changed, or a change to which checks run.
   - Base changed a caller of the patch or something it depends on (called code, dependency version): run the patch's checks on the merge result; merge on pass.
   - Otherwise merge without rebasing. If the base would force a third rebase, hold and report to the root.
3. `gh pr merge <pr> --squash`, then read it back: `gh pr view <pr> --json state,mergedAt,baseRefName` must show merged into the base. Use `--auto` only when the verdict covers the current head.
4. After merging, check base CI: `normal`/`high` wait with `gh run watch` under `timeout`; `fast` does not block, the root checks it on each wake. Red: the fix is the next unit, highest priority (`fast`: revert rule in `../SKILL.md` §Rigor).

## Stacks (no merge permission, or landing a stack later)

- Each child rebases onto its parent's exact tip; the root PR rebases onto the base. A new head on a lower PR restacks those above it; apply the patch-id rule to each.
- After handoff to the operator nobody pushes to the stack without the operator's go.
- Landing a stack (when permitted): land the contiguous verified run from the bottom, one PR at a time, lowest first. After each merge, retarget the next PR to the base (`gh pr edit <pr> --base <base>`), move its patch onto the merge result, `push --force-with-lease`, apply the patch-id rule, merge once checks pass. A base moving to the trunk when its parent merges is expected, not damage. Stop at the first PR without a valid verdict.
