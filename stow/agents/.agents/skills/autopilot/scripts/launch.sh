#!/usr/bin/env bash
# Start a one-shot job in the background and record how it ends.
# Usage: launch.sh <task-folder> <name> -- <command...>
# Writes <task>/units/<name>.md (stdout+stderr), <name>.pid at start and
# <name>.exit ("<exit-code> <end-utc>") when the command ends.
# Wait on it with: wait-any.sh job:<task>/units/<name>
set -euo pipefail
[[ $# -ge 4 && $3 == -- ]] || { echo "usage: launch.sh <task-folder> <name> -- <command...>" >&2; exit 2; }
dir=$1/units name=$2; shift 3
mkdir -p "$dir"
base=$dir/$name
rm -f "$base.exit"
nohup setsid bash -c '"$@" >"$0.md" 2>&1; printf "%s %s\n" "$?" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$0.exit"' \
	"$base" "$@" </dev/null >/dev/null 2>&1 &
echo "$!" >"$base.pid"
echo "$name started pid $! -> $base.md"
