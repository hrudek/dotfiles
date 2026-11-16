#!/usr/bin/env bash
# Condense a pi session file into a readable transcript digest for reflect reviewers.
# Keeps user and assistant text in full, shortens thinking, tool calls and tool results.
# Usage: digest.sh <session.jsonl> [max-result-chars]
set -euo pipefail
[[ $# -ge 1 && -f $1 ]] || { echo "usage: digest.sh <session.jsonl> [max-result-chars]" >&2; exit 2; }
max=${2:-400}
jq -r --argjson max "$max" '
  def cut($n): if length > $n then .[0:$n] + " …[+\(length - $n)]" else . end;
  def txt: if type == "string" then . else ([.[]? | select(.type == "text") | .text] | join("\n")) end;
  if .type == "message" and .message.role == "user" then
    "\n## USER [\(.id)] \(.timestamp)\n" + (.message.content | txt)
  elif .type == "message" and .message.role == "assistant" then
    "\n## ASSISTANT [\(.id)] \(.message.model // "")\n" + ([.message.content[]? |
      if .type == "text" then .text
      elif .type == "thinking" then "(thinking) " + ((.thinking // "") | cut(600))
      elif .type == "toolCall" then "→ \(.name) " + ((.arguments // {}) | tojson | cut(500))
      else empty end] | join("\n"))
  elif .type == "message" and .message.role == "toolResult" then
    "← \(.message.toolName)\(if .message.isError then " ERROR" else "" end): " + ((.message.content | txt) | cut($max))
  elif .type == "compaction" then "\n## COMPACTION SUMMARY\n" + .summary
  elif .type == "branch_summary" then "\n## ABANDONED BRANCH SUMMARY\n" + .summary
  elif .type == "model_change" then "(model → \(.provider)/\(.modelId))"
  else empty end
' "$1"
