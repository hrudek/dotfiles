#!/usr/bin/env bash
# Token and problem summary for one autopilot run, from <task-folder>/sessions/*.jsonl.
# Usage: usage.sh <task-folder>
# Counts only entries at or after the first decisions.tsv row (so a root session
# that began before the run does not inflate it). Cost is pi's API-price estimate,
# not subscription usage; use it to compare roles, not as a bill.
# Row name: the file name (root.jsonl -> root); pi's default file names fall back to the session name.
set -euo pipefail
[[ $# -eq 1 ]] || { echo "usage: usage.sh <task-folder>" >&2; exit 2; }
dir=${1%/}
shopt -s nullglob
files=("$dir"/sessions/*.jsonl)
((${#files[@]})) || { echo "no sessions in $dir/sessions" >&2; exit 1; }
since=""
[[ -s $dir/decisions.tsv ]] && since=$(awk -F'\t' 'NR==2{print $1; exit}' "$dir/decisions.tsv")

for f in "${files[@]}"; do
	jq -c --arg file "$(basename "$f" .jsonl)" --arg since "$since" '
		select(.type == "session_info" or (.type == "message" and .message.role == "assistant"))
		| select(.type == "session_info" or $since == "" or .timestamp >= $since)
		| {file: $file, ts: .timestamp, name: .name, m: .message}' "$(readlink -f "$f")"
done | jq -rs '
	def k: if . < 10000 then ((. / 100 | round) / 10 | tostring) + "k" else (. / 1000 | round | tostring) + "k" end;
	def role: sub("-.*$"; "");
	def fam: if test("claude") then "claude" elif test("gpt|openai") then "gpt" else . end;
	def mins(a; b): if a and b then (((b | sub("\\.[0-9]+Z$"; "Z") | fromdate) - (a | sub("\\.[0-9]+Z$"; "Z") | fromdate)) / 60 | floor | tostring) + "m" else "-" end;
	group_by(.file)
	| map(
		(map(select(.name)) | last | .name) as $n
		| map(select(.m)) as $a
		| {
			name: (if (.[0].file | test("^[0-9]{4}-")) then ($n // .[0].file) else .[0].file end),
			models: ($a | map(.m.model) | unique),
			resp: ($a | length),
			inp: ($a | map(.m.usage.input // 0) | add // 0),
			cache: ($a | map((.m.usage.cacheRead // 0) + (.m.usage.cacheWrite // 0)) | add // 0),
			out: ($a | map(.m.usage.output // 0) | add // 0),
			cost: ($a | map(.m.usage.cost.total // 0) | add // 0),
			dur: mins($a[0].ts; $a[-1].ts),
			err: ($a | map(select(.m.stopReason == "error" or .m.stopReason == "aborted")) | length),
			lim: ($a | map(select((.m.errorMessage // "") | test("limit|usage credits"; "i"))) | length)
		})
	| sort_by(.name) as $rows
	| "## Usage\n",
	  "| Session | Models | Responses | Input | Cache | Output | Cost (API est.) | Duration | Errors | Limit hits |",
	  "|---|---|---|---|---|---|---|---|---|---|",
	  ($rows[] | "| \(.name) | \(.models | join(", ")) | \(.resp) | \(.inp | k) | \(.cache | k) | \(.out | k) | $\(.cost * 100 | round / 100) | \(.dur) | \(.err) | \(.lim) |"),
	  "",
	  "| Role | Sessions | Output | Cost (API est.) | Errors | Limit hits |",
	  "|---|---|---|---|---|---|",
	  ($rows | group_by(.name | role)[] | "| \(.[0].name | role) | \(length) | \(map(.out) | add | k) | $\(map(.cost) | add * 100 | round / 100) | \(map(.err) | add) | \(map(.lim) | add) |"),
	  "",
	  "| Family | Output | Cost (API est.) |",
	  "|---|---|---|",
	  ([$rows[] | . as $r | .models[] | {f: fam, out: $r.out, cost: $r.cost}] | group_by(.f)[] | "| \(.[0].f) | \(map(.out) | add | k) | $\(map(.cost) | add * 100 | round / 100) |"),
	  "",
	  (if $since != "" then "Counted from \($since)." else "Counted all entries (no decisions.tsv)." end)
' --arg since "$since"
