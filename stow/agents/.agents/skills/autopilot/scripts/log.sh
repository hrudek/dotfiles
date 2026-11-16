#!/usr/bin/env bash
# Append one row to <task-folder>/decisions.tsv (append-only decision trail).
# Usage: log.sh <task-folder> <phase> <decision> <why> <evidence> <result>
set -euo pipefail
[[ $# -eq 6 ]] || { echo "usage: log.sh <task-folder> <phase> <decision> <why> <evidence> <result>" >&2; exit 2; }
dir=$1; shift
mkdir -p "$dir"
log="$dir/decisions.tsv"
[[ -s $log ]] || printf 'ts\tphase\tdecision\twhy\tevidence\tresult\n' >"$log"
clean() {
	local s=${1//$'\t'/ }
	s=${s//$'\r'/ }
	s=${s//$'\n'/ }
	# Keep spreadsheet apps from treating a cell as a formula.
	[[ $s == [=+@-]* ]] && s="'$s"
	printf '%s' "$s"
}
row=$(date -u +%Y-%m-%dT%H:%M:%SZ)
for cell in "$@"; do row+=$'\t'$(clean "$cell"); done
printf '%s\n' "$row" >>"$log"
