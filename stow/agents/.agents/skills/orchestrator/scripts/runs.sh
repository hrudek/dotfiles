#!/usr/bin/env bash
# List autopilot runs of one repo with their live state.
# Usage: runs.sh [repo-name]   (default: the repo of $PWD; for a .bare layout the folder holding .bare)
# TSV: task-folder  status  alive  tab  root-pane  goal
#   status: from resume.md "Status:" (running|paused|done); legacy runs: done if report.md exists, else unknown
#   alive:  yes if the root pane still hosts an agent, no otherwise, - when no pane is recorded
set -uo pipefail
repo=${1:-}
if [[ -z $repo ]]; then
	top=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || { echo "not in a git repo; pass repo-name" >&2; exit 2; }
	top=${top%/.git}; top=${top%/.bare}
	repo=$(basename "$top")
fi
base=$HOME/.cache/agent-tasks/$repo
[[ -d $base ]] || exit 0
field() { rg -m1 -i "^$1:\s*(.*)$" -r '$1' "$2" 2>/dev/null | tr -d '\r'; }
for d in "$base"/*/; do
	d=${d%/}
	[[ -f $d/resume.md || -f $d/PLAN.md || -f $d/BRIEF.md ]] || continue
	st=$(field Status "$d/resume.md" | awk '{print tolower($1)}' | tr -cd 'a-z')
	[[ -n $st ]] || { [[ -f $d/report.md ]] && st="done" || st=unknown; }
	tab=$(field Tab "$d/resume.md"); pane=$(field 'Root pane' "$d/resume.md")
	alive=-
	if [[ -n $pane ]]; then
		herdr agent get "$pane" 2>/dev/null | jq -e '.result.agent' >/dev/null 2>&1 && alive=yes || alive=no
	fi
	goal=$(field Goal "$d/PLAN.md"); [[ -n $goal ]] || goal=$(head -c 120 "$d/BRIEF.md" 2>/dev/null | tr '\n' ' ')
	printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$d" "$st" "$alive" "${tab:--}" "${pane:--}" "${goal:0:120}"
done
