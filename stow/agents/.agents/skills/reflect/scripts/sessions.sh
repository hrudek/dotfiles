#!/usr/bin/env bash
# List recent pi sessions for multi-session reflect, newest first.
# Usage: sessions.sh [-n N] [--since ISO | --all-time] [--cwd PATH | --match SUBSTR | --all] [--min-user K] [--include-current]
# Default: sessions whose cwd is $PWD (or below it), last 10, at least 2 user messages,
# excluding $PI_SESSION_FILE, active (file modified) after --since. --since defaults to the
# watermark in ~/.cache/agent-tasks/reflect/reviewed-until (set after each multi run), so
# already reviewed work is not reviewed again; --all-time ignores it.
# Output TSV: path, start, cwd, user-msgs, title. Pass the same since to digest.sh.
set -euo pipefail
mark=${REFLECT_WATERMARK:-$HOME/.cache/agent-tasks/reflect/reviewed-until}
since=$(cat "$mark" 2>/dev/null || true)
n=10 scope=cwd cwd=$PWD match="" min=2 current=${PI_SESSION_FILE:-}
while [[ $# -gt 0 ]]; do
  case $1 in
    -n) n=$2; shift 2 ;;
    --since) since=$2; shift 2 ;;
    --all-time) since=""; shift ;;
    --cwd) cwd=$(realpath -m "$2"); shift 2 ;;
    --match) scope=match match=$2; shift 2 ;;
    --all) scope=all; shift ;;
    --min-user) min=$2; shift 2 ;;
    --include-current) current=""; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
root=${PI_SESSIONS_DIR:-$HOME/.pi/agent/sessions}
found=0
while IFS= read -r f; do
  [[ $f == "$current" ]] && continue
  head=$(head -n 1 "$f")
  scwd=$(jq -r '.cwd // ""' <<<"$head" 2>/dev/null) || continue
  start=$(jq -r '.timestamp // ""' <<<"$head")
  [[ -n $since && $(date -u -r "$f" +%Y-%m-%dT%H:%M:%S) < $since ]] && continue
  case $scope in
    cwd) [[ $scwd == "$cwd" || $scwd == "$cwd"/* ]] || continue ;;
    match) [[ $scwd == *"$match"* ]] || continue ;;
  esac
  read -r users title < <(jq -rs '
    ([.[] | select(.type == "message" and .message.role == "user")]) as $u |
    ([.[] | select(.type == "session_info") | .name] | last) as $name |
    ($u[0].message.content | if type == "string" then . else ([.[]? | select(.type == "text") | .text] | join(" ")) end) as $first |
    "\($u | length) \(($name // $first // "") | gsub("\\s+"; " ") | .[0:80])"' "$f")
  (( users >= min )) || continue
  printf '%s\t%s\t%s\t%s\t%s\n' "$f" "$start" "$scwd" "$users" "$title"
  (( ++found >= n )) && break
done < <(ls -t "$root"/*/*.jsonl 2>/dev/null)
(( found > 0 )) || echo "no sessions matched" >&2
