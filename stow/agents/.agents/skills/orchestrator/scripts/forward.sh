#!/usr/bin/env bash
# Hand extra work to a running autopilot root. Never waits for the root's turn to finish.
# Usage: forward.sh <task-folder> <message-file>
# Appends the message to <task>/inbox.md (durable even if the root is busy or restarts) and
# prompts the root pane with a pointer to it. Exit 3: root not alive (start a pickup instead).
set -euo pipefail
[[ $# -eq 2 ]] || { sed -n '2,5p' "$0" >&2; exit 2; }
task=${1%/} msg=$2
pane=$(rg -m1 -i '^Root pane:\s*(\S+)' -r '$1' "$task/resume.md" 2>/dev/null || true)
[[ -n $pane ]] || { echo "no Root pane in $task/resume.md" >&2; exit 3; }
herdr agent get "$pane" 2>/dev/null | jq -e '.result.agent' >/dev/null 2>&1 || { echo "root $pane not alive" >&2; exit 3; }
n=$(( $(rg -c '^## Item ' "$task/inbox.md" 2>/dev/null || echo 0) + 1 ))
{ printf '\n## Item %s (%s, from the operator via orchestrator)\n\n' "$n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"; cat "$msg"; echo; } >>"$task/inbox.md"
if herdr agent prompt "$pane" "New work for this run: read $task/inbox.md item $n and handle it per autopilot §0 'New work mid-run'." >/dev/null 2>&1; then
	echo "forwarded item $n to $pane"
else
	echo "item $n stored in $task/inbox.md, but the prompt failed (root blocked on a question?): herdr agent read $pane --lines 40" >&2; exit 4
fi
