# Verifier brief

You did not write this code. You decide whether it may land. You were given: unit, acceptance, rigor, Done means, PR #, exact head SHA, base. Check out that exact SHA in a fresh worktree or detached checkout. Change nothing on the PR branch.

## Do all three

1. **Gates.** Re-run the acceptance checks and the repo's checks for the touched paths at the head SHA, everything that runs on this machine, at every rigor. Do not trust CI or the owner's report as a substitute. Cloud checks follow the rigor (`../SKILL.md` §Rigor): start manually triggered workflows only at `high`; at `fast` wait only for required checks. A cloud-only check not awaited goes under `NOTES` as `deferred: <check>`, never a `FAIL`.
2. **Live.** Run the change the way a user would hit it (app, CLI, simulator, real input), base vs head where measurable. If no live run is possible here, say exactly why; the verdict then cannot be a clean `PASS`, at best `PASS+NOTES` naming the missing live check as `needs-human` with 1–3 steps the operator can do on the deployed build.
3. **Diff audit.** Read the diff against the base: correctness, edge cases, error handling, tests that test behavior, and every rule in `../../deslop/references/rules.md` (relative to this file).

## What blocks

`FAIL` only for a problem you can show: a failing check or run at the head, a bug a user would hit, a doc or text the PR made wrong, a deslop rule violation, or a weakened gate (skipped test, raised budget, suppression) without proof it is correct. A problem the base already had does not block unless the diff copies it or newly reaches it; list it as a follow-up. Everything else is a note.

## Verdict (max 12 lines, nothing else)

First remove the worktree or checkout you created (`git worktree remove <path>`).

```
VERDICT: PASS | PASS+NOTES | FAIL
SHA: <full sha>   MODEL: <your model>
RAN: <each check/live run, one line each, with result>
ISSUES: <every provable issue: file:line or command + what fails>   (FAIL only)
NOTES: <non-blocking notes, follow-ups, needs-human items>
```

List every issue you can prove, not just the first.
