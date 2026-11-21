---
name: reflect
description: Spawn three parallel review subagents over the active pi session, a set of recent sessions, or a whole autopilot run, surface durable learnings and recurring patterns, and route each to a concrete edit on an existing skill. Nothing is applied without the user's approval. Use for /skill:reflect, when the user says reflect, or asks to review or evaluate their last sessions.
disable-model-invocation: true
---

# Reflect

Mine sessions for durable learnings, then route them into skill edits. Port of pstack `reflect` for pi (see `../PSTACK.md`).

Skip when the material is trivial, off-topic, or already covered by an existing skill the parent followed correctly. One-offs are not learnings.

## 1. Pick the scope and build the digest

Pick the mode from the request; ask only if it is genuinely ambiguous:

| Request | Mode | Sessions |
|---|---|---|
| plain `reflect`, "this session" | Current | `$PI_SESSION_FILE` |
| names a session file or id | Named | that file only |
| "my last sessions", "last N", "this week", "in project X", "all projects" | Multi | `scripts/sessions.sh` |
| task folder with `sessions/` | Run | see below |

Scripts are relative to this skill's folder. Each digest keeps user and assistant text, shortens thinking, tool calls and tool results, starts with a `# Session <name>` heading and tags entries with their ids. Writing it once saves every reviewer the full tool output.

**Current / Named:** work folder `~/.cache/agent-tasks/reflect/<session-id>/` (outside every repo).

```bash
scripts/digest.sh "$PI_SESSION_FILE" > <work>/digest.md
```

**Multi:** work folder `~/.cache/agent-tasks/reflect/multi-<YYYYMMDD-HHMM>/`. Select sessions first:

```bash
scripts/sessions.sh [-n 10] [--since 2026-11-01] [--cwd <dir> | --match <substr> | --all] > <work>/sessions.tsv
```

Defaults: sessions active since the watermark (`~/.cache/agent-tasks/reflect/reviewed-until`, set in step 6) in the current cwd or below it, newest 10, at least 2 user messages, current session excluded (`--include-current` adds it). Map the request to flags: a count to `-n`, a period to `--since`, a project name to `--match`; `--all-time` only when the user asks to re-review old work. Go across projects (`--all`, or a `--match` outside the cwd) only when the user asks for it; other projects can hold private chats. Show the picked list (start, cwd, title) in one short block, then continue without waiting. Build one digest, sessions oldest first:

```bash
since=$(cat ~/.cache/agent-tasks/reflect/reviewed-until 2>/dev/null)  # or the --since you passed
cut -f1 <work>/sessions.tsv | tac | while read -r f; do echo; scripts/digest.sh "$f" 200 "$since"; done > <work>/digest.md
python3 -I scripts/waits.py --since "$since" $(cut -f1 <work>/sessions.tsv | tac) > <work>/waits.md
```

`waits.md` lists tool calls that blocked ≥ 90 s (own runtime vs. held by parallel siblings) and user messages with the time since the last assistant step. Append to every reviewer prompt: `Timing per tool call and user message: <work>/waits.md; flag waits that outlived what they waited on.`

`<SESSION_PATH>` is the space-separated list of those files. Over ~400 KB: rebuild with tool results at 100 chars; still over ~600 KB: drop the oldest sessions and say so.

If the user only wants an evaluation ("Auswertung", "summary", "what went wrong lately") and no skill changes, run steps 2–3, report the synthesizer's Overview plus its findings, and stop; skip steps 4–5 unless the user asks.

**Run mode** (`/skill:reflect <task-folder>` with a `sessions/` folder): review the run instead of this chat. Work folder `<task>/reflect/`; `<SESSION_PATH>` is `<task>/sessions/*.jsonl`; `<TASK_FOLDER>` is the task folder. Build one digest, usage first, then each session under its own heading:

```bash
since=$(awk -F'\t' 'NR==2{print $1; exit}' <task>/decisions.tsv)
{ ../autopilot/scripts/usage.sh <task>; for f in <task>/sessions/*.jsonl; do
    echo; scripts/digest.sh "$f" 200 "$since"; done; } > <work>/digest.md
```

Over ~400 KB: digest the non-owner sessions with tool results at 100 chars and say so. Reviewers read the run, not the chat that started it; skill changes still go only to skills actually used (autopilot, its references, deslop).

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

Fill `references/synthesizer.md` with each reviewer's full output where marked and set `<MODE>` to `single session`, `multi-session (<N> sessions)` or `autopilot run`, write it to `<work>/synth.prompt.md`, run one `pi -p --no-session --model pi-claude-cli/claude-opus-5-5:medium --tools read,bash` the same way into `<work>/synth.out.md`. It returns an Accepted / Rejected / Backlog list, preceded by an Overview in multi-session mode.

## 4. Structural enforcement check

Move any Accepted item that a lint rule, script, metadata flag, or runtime check would enforce more reliably to Backlog. Skill prose is for what mechanisms cannot enforce.

## 5. Apply

Present the synthesizer's full output (Overview first, if any) and wait for explicit approval before applying any Accepted edit. The user picks the subset and may redirect routings. Skill changes affect every future agent. Do not auto-apply.

Append each Backlog item to `~/.cache/agent-tasks/reflect/backlog.md` (date, pattern, what was hit, suggested mechanism) without waiting. Only the Accepted list waits for approval.

Where to edit: skills under `~/.agents/skills/` are symlinks into `~/dotfiles/stow/agents/.agents/skills/`; edit the source (`realpath`). Never edit a skill outside `~/dotfiles` (pi's install dir, package caches, Omarchy-managed `~/.pi/agent/skills/`); before approval, show that it would need a copy into the dotfiles stow package and ask. Do not commit, open a PR or push; the user commits.

Follow each approved row's Routing exactly:

- Trivial existing-skill edit (a one-line bullet, a tightened sentence, a stale fact corrected): the parent does it directly.
- Substantive existing-skill edit (a new section, a new pattern table, more than ~10 lines): draft it, keep the skill's voice and structure, cut as much as you add, then test it: one fresh `pi -p --no-session` reads the edited skill and the evidence moment from the transcript and answers in ≤5 lines whether an agent would now act differently. Iterate until yes, max 2 rounds.
- `tune description: <skill path>` (the skill exists but didn't trigger when it should have): front-load trigger words the user actually said. For skills with `disable-model-invocation: true` the description never triggers on its own; route instead to the skill or reply that should have pointed the user to it.
- `new skill: <kebab-name>`: follow pi `docs/skills.md` (frontmatter `name` = folder name, `description`, `disable-model-invocation: true` unless it must trigger on its own), create it in the dotfiles stow package, restow with `stow -d ~/dotfiles/stow -t ~ agents`. Do not invent the shape ad hoc.

Validate every touched skill: frontmatter parses, `name` matches its folder, description present, every referenced relative path exists.

## 6. Summarize for the user

Short list, no preamble (multi-session: Overview first):

- Edits applied: `<skill path>`. What changed, one line each.
- New skills created: `<skill path>`. One line each (rare).
- Backlog filed: `<title>`. One line each.
- Dropped: one line per rejected finding + reason from the synthesizer.

Multi mode, after the user has decided on the Accepted list (applied or not): move the watermark, so the next multi run reviews only newer activity and old findings do not come back; a pattern that recurs after it is new evidence.

```bash
date -u +%Y-%m-%dT%H:%M:%SZ > ~/.cache/agent-tasks/reflect/reviewed-until
```
