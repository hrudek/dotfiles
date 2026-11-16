---
name: recap
description: Catch the user up on an autopilot or other unattended run (pstack ketchup + show-me-your-work catch-up). Reads the run's task folder, checks claims against git/GitHub, explains what changed in plain words, shows the Attention list, and lays out every call waiting on the user with a pick, evidence and risk. Read-only. Use for /skill:recap, "was hast du gemacht", "Zwischenstand", "catch me up".
disable-model-invocation: true
---

# Recap

The user does not read logs. You read them and catch the user up so they can decide from your reply alone. Read-only: change no files, branches, PRs; start no jobs. Works mid-run (status) and after the run. Cheapest in a fresh session.

## 1. Find the run

- Use the task folder the user names, else the most recently modified `decisions.tsv` under `~/.cache/agent-tasks/*/*/`; say which one.
- Read `PLAN.md` (goal, Done means, assumptions), `report.md` (incl. `## Attention`) and `resume.md` if present, then `decisions.tsv`. Over ~150 rows: header, rows whose result is not `VERIFIED`/`merged`, rows superseded later, last 30 rows; count the rest with `awk`. Open `units/*.md` only for an item you report, bounded.
- Mid-run: is the root still working? Age of the newest trail row, `herdr agent list` if available. Say it plainly.
- Since when: if the user's earlier recap or message time is known, focus on what changed after it.

## 2. Check before you tell

- Each PR the trail mentions: `gh pr view <n> --json state,mergedAt,baseRefName,title,url --jq ...`.
- Base CI: `gh run list -b <base> -L 3 --json conclusion,headSha,displayTitle --jq ...`.
- Evidence SHAs exist (`git cat-file -e`).
- Check each number you will show against its source; say so when you correct one.
- No `## Attention` in `report.md` (run still going or stopped early): build it yourself from the trail: weak or missing evidence, verification claimed without proof, reverts, units with 2+ fix rounds, assumptions, gate loosening, log-vs-reality mismatches.
- Thorough check only if the user asks: one fresh `pi` verifier via `../herdr/SKILL.md` runs the Done means checks, ≤10-line reply.

## 3. Write the reply (in the user's language)

Voice: plain words, short sentences, no jargon, like one person catching up another. Say what changed for the user, not how. "Die Tests laufen durch", not "CI is green". Leave out hashes, paths, commands, build numbers unless the user needs them to act. Name PRs by number and what they do.

1. **First sentence:** what waits on the user, or that nothing does.
2. **What happened** (under 100 words): one bullet per thing the user asked for: what came of it and whether it is done, still running, failed, or not checked. Name bugs found and fixed on the way. Never call something done that still waits on the user. Then at most three lines that change what the user knows or must do.
3. **Achtung:** from `report.md` (`reviewed by <model>` first) or your own list, most important first, one line each. Log-vs-reality mismatches go on top. "Keine" is valid.
4. **Deine Entscheidungen:** every call only the user can make (merge, approval, product choice, irreversible step, missing access, `needs-human` checks like device tests). Per item about 30 words: link/number, what it changes for users, your pick, the evidence behind it, its risk (even when low). Items sharing one call: state call and pick once, then one bullet per item, riskiest first. Unmerged PRs: in merge order, stacked ones marked. A choice between options: each option with what it gets and what it costs. Never invent calls to fill the list; work the run can still do itself is not a call.
5. **Next step:** one line, e.g. the build to test, or the exact `/skill:autopilot <task-folder>` call to resume.

Never cut items to stay short. No pasted log rows or diffs; paths only as optional deeper reading at the end.
