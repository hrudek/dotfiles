#!/usr/bin/env bash
# Start a new autopilot run in its own herdr tab.
# Usage: start-run.sh <repo-dir> <task-slug> <brief-file> [model]
#   repo-dir: checkout the root works from (e.g. ~/code/typr/main)
#   brief-file: the task text, copied verbatim to <task>/BRIEF.md
# Creates ~/.cache/agent-tasks/<repo>/<slug>/, a tab labelled <slug> in $HERDR_WORKSPACE_ID (no focus),
# starts pi as herdr agent <tag>-root and sends it "/skill:autopilot <task>".
# Prints: task folder, tab id, root pane id.
set -euo pipefail
[[ $# -ge 3 ]] || { sed -n '2,9p' "$0" >&2; exit 2; }
dir=$(cd "$1" && pwd) slug=$2 brief=$3 model=${4:-pi-claude-cli/claude-opus-5-5:medium}
[[ $slug =~ ^[a-z0-9][a-z0-9-]{1,40}$ ]] || { echo "slug: lowercase letters, digits, dashes" >&2; exit 2; }
[[ -n ${HERDR_WORKSPACE_ID:-} ]] || { echo "needs HERDR_WORKSPACE_ID (run inside herdr)" >&2; exit 2; }
top=$(git -C "$dir" rev-parse --path-format=absolute --git-common-dir); top=${top%/.git}; top=${top%/.bare}
task=$HOME/.cache/agent-tasks/$(basename "$top")/$slug
[[ ! -e $task ]] || { echo "task folder exists: $task (pick another slug or forward to that run)" >&2; exit 1; }
tag=$(tr -cd 'a-z0-9' <<<"$slug" | cut -c1-12)
herdr agent get "$tag-root" >/dev/null 2>&1 && { echo "herdr name $tag-root is taken; pick another slug" >&2; exit 1; }

mkdir -p "$task"
cp "$brief" "$task/BRIEF.md"
tab=$(herdr tab create --workspace "$HERDR_WORKSPACE_ID" --cwd "$dir" --label "$slug" --no-focus)
tab_id=$(jq -r '.result.tab.tab_id' <<<"$tab") pane=$(jq -r '.result.root_pane.pane_id' <<<"$tab")
printf 'Status: starting\nTab: %s\nRoot pane: %s\nTag: %s\n' "$tab_id" "$pane" "$tag" >"$task/resume.md"
herdr agent start "$tag-root" --kind pi --pane "$pane" -- --model "$model" >/dev/null
herdr agent prompt "$pane" "/skill:autopilot $task" >/dev/null
printf 'task %s\ntab %s\nroot %s (%s-root)\n' "$task" "$tab_id" "$pane" "$tag"
