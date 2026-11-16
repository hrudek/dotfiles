# pstack mapping

For humans only; no skill references this file. Source: github.com/cursor/plugins `pstack/`, compared at commit `bf0c7cd` (2026-11-14). Use it to diff against a newer pstack or to migrate.

## Files

| Here | pstack | Simplified |
|---|---|---|
| `autopilot/SKILL.md` §0 pickup/pause | playbooks `session-pickup`, `pause-safely` | merged into one section |
| `autopilot/SKILL.md` §Models | `setup-pstack` / `pstack-models.mdc` role lines | fixed table in the skill: Claude builds, GPT verifies, medium reasoning (verifier high, never xhigh), fallback to the other family on limits |
| `autopilot/SKILL.md` §1 Frame, §2 Design | skill `figure-it-out` (Frame, Design the workflow) | no `architect`/`arena`; one owner sketches 2–3 options for one-way doors |
| `autopilot/SKILL.md` §3 loop, §4 root duties | playbooks `autopilot-full`, `autonomous-run` | no `/loop 1h`: audit on every wake; max 2 owners in parallel; herdr panes instead of cloud agents |
| `autopilot/SKILL.md` §5 trail | skill `show-me-your-work` | same TSV columns |
| `autopilot/SKILL.md` §6 hand back | `autopilot-full` final verify + `show-me-your-work` audit and attention review | attention reviewer reads plan/trail/unit files, not transcripts |
| `autopilot/references/pr-owner.md` | playbooks `opening-a-pr`, `babysit` + owner role in `autopilot-full` | one brief |
| `autopilot/references/verifier.md` | skill `swarm` (verifier swarm) | one verifier instead of N workers |
| `autopilot/references/merge-rules.md` | playbooks `shipping`, `autopilot-stack` | same rules, shorter |
| `autopilot/scripts/log.sh` | `show-me-your-work` log helper | |
| `deslop/references/rules.md` | `/deslop` + `/no-comments` + agent `comment-sicko` | no separate comment agent; owner applies, verifier checks |
| `deslop/SKILL.md` codebase mode | no direct equivalent; draws on playbook `refactoring`, principles `subtract-before-you-add`, `test-behavior-not-implementation`, skill `why` | own addition |
| `reflect/` | skill `reflect` (SKILL + 4 reference prompts, near-verbatim) | `pi -p` subagents instead of `Task`; `scripts/digest.sh` condenses the session first; two lenses on GPT; no Cursor `create-skill`: draft + one test run; backlog to a local file |
| `recap/SKILL.md` | skill `ketchup` (+ catch-up part of `show-me-your-work`) | no visuals/video |

## Terms (same meaning as in pstack)

root, operator, owner (PR owner), verifier, verdict (`PASS`/`PASS+NOTES`/`FAIL`), code-ready, merge-ready, countersign, gate, unit, trail, Done means, patch-id rule.

## Not adopted

`orchestrate`, `multi-phase-plan`, `sharpen`, `in-your-own-words`, `architect`, `arena`, `interrogate`, `blast-radius`, `create-verification-skill`, `correct`, `how`, `why` (as own skills), principle skills, `/loop`, cloud agents, Cursor Projects.
