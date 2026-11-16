#!/usr/bin/env bash
# Condense a pi session file into a readable transcript digest for reflect reviewers.
# Keeps user and assistant text in full, shortens thinking, tool calls and tool results.
# Usage: digest.sh <session.jsonl> [max-result-chars] [since-iso-ts]
# Starts with a '# Session <name>' heading; entries before since-iso-ts are skipped.
set -euo pipefail
[[ $# -ge 1 && -f $1 ]] || { echo "usage: digest.sh <session.jsonl> [max-result-chars] [since-iso-ts]" >&2; exit 2; }
max=${2:-400}
since=${3:-}
name=$(jq -r 'select(.type == "session_info") | .name' "$1" | tail -n 1)
base=$(basename "$1" .jsonl)
[[ $base =~ ^[0-9]{4}- ]] || name=$base
printf '# Session %s\n' "${name:-$base}"
jq -r --argjson max "$max" --arg since "$since" '
  select($since == "" or (.timestamp // "") >= $since) |
  def cut($n): if length > $n then .[0:$n] + " …[+\(length - $n)]" else . end;
  def txt: if type == "string" then . else ([.[]? | select(.type == "text") | .text] | join("\n")) end;
  if .type == "message" and .message.role == "user" then
    "\n## USER [\(.id)] \(.timestamp)\n" + (.message.content | txt)
  elif .type == "message" and .message.role == "assistant" then
    "\n## ASSISTANT [\(.id)] \(.message.model // "")\(if .message.errorMessage then " ERROR: " + (.message.errorMessage | cut(200)) else "" end)\n" + ([.message.content[]? |
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
