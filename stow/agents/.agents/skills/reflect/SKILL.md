---
name: reflect
description: Spawn three parallel review subagents over the active pi session, surface durable learnings, and route each to a concrete edit on an existing skill. Nothing is applied without the user's approval. Use for /skill:reflect or when the user says reflect.
disable-model-invocation: true
---

# Reflect

Mine the current conversation for durable learnings, then route them into skill edits. Port of pstack `reflect` for pi (see `../PSTACK.md`).

Skip when the conversation is trivial, off-topic, or already covered by an existing skill the parent followed correctly. One-offs are not learnings.

## 1. Locate the active transcript

Use this conversation's session file: `$PI_SESSION_FILE`. Never glob across `~/.pi/agent/sessions/*/`; that reads private chats from unrelated projects. If the user names another session (e.g. an autopilot owner's), use only that file.

Work folder: `~/.cache/agent-tasks/reflect/<session-id>/` (outside every repo). Write a digest there, so reviewers do not each pay for full tool output:

```bash
scripts/digest.sh "$PI_SESSION_FILE" > <work>/digest.md   # relative to this skill's folder
```

The digest keeps user and assistant text, shortens thinking, tool calls and results, and tags each entry with its id. If the user passed an autopilot task folder, reviewers may also read its `PLAN.md`, `decisions.tsv` and `units/*.md`.

## 2. Spawn three reviewers in parallel

For each lens, copy its template to `<work>/<lens>.prompt.md`, fill in `<DIGEST_PATH>`, `<SESSION_PATH>` and optional `<TASK_FOLDER>`, then run all three at once in one bash call and block until done:

```bash
cd <work> && for l in judgment tooling divergent; do
  timeout 1800 pi -p --no-session --model "<model for $l>" --tools read,bash "$(cat $l.prompt.md)" > $l.out.md 2> $l.err &
done; wait
```

| Lens | Model (default) | Template |
|---|---|---|
| Judgment | `pi-claude-cli/claude-opus-5-5:medium` | `references/judgment-reviewer.md` |
| Tooling | `openai/gpt-6.1-sol:medium` | `references/tooling-reviewer.md` |
| Divergent | `openai/gpt-6.1-sol:medium` | `references/divergent-reviewer.md` |

The other family for two lenses gives real divergence and spreads usage limits. All at medium reasoning; never xhigh. If a model is unavailable or limited, use the other family and say so; pick only IDs from `pi --list-models`, never invent one. An empty or failed output: rerun that lens once, else continue with two and say so.

## 3. Synthesize

Fill `references/synthesizer.md` with each reviewer's full output where marked, write it to `<work>/synth.prompt.md`, run one `pi -p --no-session --model pi-claude-cli/claude-opus-5-5:medium --tools read,bash` the same way into `<work>/synth.out.md`. It returns an Accepted / Rejected / Backlog list.

## 4. Structural enforcement check

Move any Accepted item that a lint rule, script, metadata flag, or runtime check would enforce more reliably to Backlog. Skill prose is for what mechanisms cannot enforce.

## 5. Apply

Present the synthesizer's full Accepted / Rejected / Backlog output and wait for explicit approval before applying any Accepted edit. The user picks the subset and may redirect routings. Skill changes affect every future agent. Do not auto-apply.

Append each Backlog item to `~/.cache/agent-tasks/reflect/backlog.md` (date, pattern, what was hit, suggested mechanism) without waiting. Only the Accepted list waits for approval.

Where to edit: skills under `~/.agents/skills/` are symlinks into `~/dotfiles/stow/agents/.agents/skills/`; edit the source (`realpath`). Never edit a skill outside `~/dotfiles` (pi's install dir, package caches, Omarchy-managed `~/.pi/agent/skills/`); before approval, show that it would need a copy into the dotfiles stow package and ask. Do not commit, open a PR or push; the user commits.

Follow each approved row's Routing exactly:

- Trivial existing-skill edit (a one-line bullet, a tightened sentence, a stale fact corrected): the parent does it directly.
- Substantive existing-skill edit (a new section, a new pattern table, more than ~10 lines): draft it, keep the skill's voice and structure, cut as much as you add, then test it: one fresh `pi -p --no-session` reads the edited skill and the evidence moment from the transcript and answers in ≤5 lines whether an agent would now act differently. Iterate until yes, max 2 rounds.
- `tune description: <skill path>` (the skill exists but didn't trigger when it should have): front-load trigger words the user actually said. For skills with `disable-model-invocation: true` the description never triggers on its own; route instead to the skill or reply that should have pointed the user to it.
- `new skill: <kebab-name>`: follow pi `docs/skills.md` (frontmatter `name` = folder name, `description`, `disable-model-invocation: true` unless it must trigger on its own), create it in the dotfiles stow package, restow with `stow -d ~/dotfiles/stow -t ~ agents`. Do not invent the shape ad hoc.

Validate every touched skill: frontmatter parses, `name` matches its folder, description present, every referenced relative path exists.

## 6. Summarize for the user

Short list, no preamble:

- Edits applied: `<skill path>`. What changed, one line each.
- New skills created: `<skill path>`. One line each (rare).
- Backlog filed: `<title>`. One line each.
- Dropped: one line per rejected finding + reason from the synthesizer.
