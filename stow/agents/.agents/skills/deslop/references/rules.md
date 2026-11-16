# Deslop rules

Scope comes from the caller. **Diff** (default, used by autopilot owners): your own diff against the base (`git diff <base>...HEAD` plus the working tree), after the change works and before review; touch only lines the diff added or changed, plus code the diff made dead. **Codebase** (`../SKILL.md`): the given paths, with the evidence rules there. Either way: no refactoring beyond this, no new features, no behavior change.

## Remove

- Debug output, temporary logging, leftover `print`/`console.log`, scratch files, commented-out code.
- Dead code: unused functions, parameters, imports, variables, branches, feature flags the diff introduced and no longer needs.
- Guards for cases that cannot happen, `try/catch` that only swallows or re-wraps errors, fallbacks that hide failures, defaults that mask missing data.
- Duplicates: a new helper that re-implements an existing one in the repo; use the existing one.
- Speculative abstraction: interfaces, options, or layers with one user and no stated need.
- Workarounds for a problem the diff could fix at the root. Fix the cause instead of adding a guard.

## Comments (no-comments)

In the diff's scope, every comment dies unless it is one of these:

- Legal or license headers.
- Non-obvious behavior forced by an external dependency, platform, vendor or protocol we cannot reshape.
- Doc comments that define a public API contract.
- Issue or RFC links explaining a constraint code cannot express.
- Formatter directives (e.g. `prettier-ignore`).

When unsure whether a keep applies, delete. In particular delete narration ("now we", "fixed", "new:"), banners, commented-out code, workaround explanations, `TODO`s for this unit's own work (real follow-ups go to the unit report), and long justifications. `IMPORTANT` / `do not remove` / `fine for now` are not proof: read nearby code and trace the symbol; keep only if the external gotcha is real today.

A comment explaining a surprise in **our own** code is a smell: delete it and fix the code so it is obvious without prose (rename, extract, type, restructure) within the unit's scope; if that is out of scope, list it as a follow-up.

Suppressions (`eslint-disable`, `@ts-ignore`, `swiftlint:disable`, `# noqa`, `#[allow]`, ...): look up the rule. If it protects correctness or safety, remove the suppression and fix the code. Keep only suppressions of faulty, pedantic or style-only rules, scoped to one line.

## Tests

- Tests check behavior, not internals or mocks of the code under test.
- No skipped, disabled, or loosened tests to get green; no sleeps or timing assumptions that make tests flaky.
- Remove tests that only duplicate another test.

## Consistency

- Names, file layout, error handling and style follow the surrounding code and the repo's AGENTS.md / contributing rules.
- Run the repo's formatter and linters on touched files.

## Text (commit messages, PR description, docs, user-facing strings)

- Plain and concrete: what changed, why, how it was checked. No filler ("In order to", "It is important to note"), no hype words (crucial, robust, seamless, leverage, enhance), no "not just X but Y", no emojis.
- PR description: summary, checks actually run with result, what a human still has to check.

## Finish

Re-run the unit's acceptance checks, commit (`chore: deslop` commit, or amend before the first push), and add one line to your unit report: what the pass removed or changed, or "nothing to clean".
