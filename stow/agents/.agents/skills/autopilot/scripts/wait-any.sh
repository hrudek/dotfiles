#!/usr/bin/env bash
# Block until the FIRST of several targets ends, or until the cap (default 20 min).
# Usage: wait-any.sh [--max <minutes>] <target>...
# Targets:
#   herdr:<agent>        herdr owner reaches idle, done or blocked (herdr defaults); an agent not
#                        yet working gets 15 s to start (prompt just sent), so a settled one returns after 15 s
#   job:<task>/units/<n> job started with launch.sh ends (reads <n>.exit)
#   run:<id>             gh run watch <id> --interval 60 (repo from cwd)
#   sha:<sha>[:<workflow>]  all runs on that commit (right after push/merge, before a run id
#                        exists); "none" if no run appears within 2 min (e.g. path filters)
#   pr:<n> | pr:<n>:required   gh pr checks <n> --watch --interval 60
# Prints one line per ended target: "<target> <class> <detail> after <s>s",
# class one of: done idle blocked ok failed died none; still running ones as "pending".
# Exit 0 when something ended, 124 when the cap hit first, 2 on usage errors.
set -uo pipefail
max=20
[[ ${1:-} == --max ]] && { max=$2; shift 2; }
[[ $max =~ ^[1-9][0-9]*$ ]] || { echo "--max takes whole minutes" >&2; exit 2; }
[[ $# -ge 1 ]] || { sed -n '2,12p' "$0" >&2; exit 2; }
for t in "$@"; do
	[[ $t =~ ^(herdr:.+|job:.+|run:[0-9]+|sha:[0-9a-f]{7,40}(:.+)?|pr:[0-9]+(:required)?)$ ]] || { echo "bad target: $t" >&2; exit 2; }
done

out=$(mktemp -d)
trap 'kill -- $(jobs -p | sed "s/^/-/") 2>/dev/null; rm -rf "$out"' EXIT
set -m # each waiter gets its own process group, so killing it also kills gh/herdr/tail
start=$SECONDS

waiter() { # <index> <target>; writes "<class> <detail>" to $out/<index>
	local i=$1 t=$2 rc st
	case $t in
	herdr:*)
		# Right after a prompt the agent may still show its old settled state: give it 15 s to start working.
		herdr agent wait "${t#herdr:}" --until working --timeout 15000 >/dev/null 2>&1
		herdr agent wait "${t#herdr:}" >/dev/null 2>&1
		st=$(herdr agent get "${t#herdr:}" 2>/dev/null | jq -r '.result.agent.agent_status // empty' 2>/dev/null)
		[[ -n $st ]] && echo "$st herdr-status" >"$out/$i" || echo "died agent-gone" >"$out/$i" ;;
	job:*)
		local b=${t#job:}
		[[ -f $b.pid ]] || { echo "died no-pid-file" >"$out/$i"; return; }
		[[ -f $b.exit ]] || tail --pid="$(<"$b.pid")" -f /dev/null
		if [[ -f $b.exit ]]; then
			read -r rc _ <"$b.exit"
			[[ $rc == 0 ]] && echo "ok exit=0 reply=$b.md" >"$out/$i" || echo "failed exit=$rc reply=$b.md" >"$out/$i"
		else echo "died killed-before-exit reply=$b.md" >"$out/$i"; fi ;;
	run:*)
		gh run watch "${t#run:}" --interval 60 --exit-status >/dev/null 2>&1; rc=$?
		st=$(gh run view "${t#run:}" --json conclusion --jq .conclusion 2>&1 | tail -1)
		[[ $rc == 0 ]] && echo "ok $st" >"$out/$i" || echo "failed $st" >"$out/$i" ;;
	sha:*)
		local s=${t#sha:} wf=() prev='' cur waited=0
		[[ $s == *:* ]] && { wf=(--workflow "${s#*:}"); s=${s%%:*}; }
		s=$(git rev-parse --verify -q "$s^{commit}" 2>/dev/null || echo "$s") # gh matches full SHAs only
		while :; do # done = runs exist, all completed, and the set unchanged since the last poll
			cur=$(gh run list --commit "$s" "${wf[@]}" --limit 50 --json databaseId,workflowName,status,conclusion \
				--jq 'sort_by(.databaseId)|map("\(.workflowName)=\(.status)/\(.conclusion)")|join(" ")' 2>/dev/null)
			if [[ -z $cur ]]; then
				((waited >= 120)) && { echo "none no-run-for-$s after 2 min" >"$out/$i"; return; }
				sleep 15; waited=$((waited + 15)); continue # runs usually appear within seconds
			elif [[ $cur == "$prev" && $cur != *=queued* && $cur != *=in_progress* && $cur != *=waiting* && $cur != *=pending* && $cur != *=requested* ]]; then
				[[ $cur =~ /(failure|cancelled|timed_out|startup_failure|action_required) ]] && echo "failed $cur" >"$out/$i" || echo "ok $cur" >"$out/$i"
				return
			fi
			prev=$cur; sleep 60; waited=$((waited + 60))
		done ;;
	pr:*)
		local n=${t#pr:} req=()
		[[ $n == *:required ]] && { n=${n%:required}; req=(--required); }
		gh pr checks "$n" "${req[@]}" --watch --interval 60 >"$out/$i.log" 2>&1; rc=$?
		[[ $rc == 0 ]] && echo "ok all-passed" >"$out/$i" || echo "failed $(rg -m3 -i 'fail|no checks' "$out/$i.log" | tr '\n' ';' | cut -c1-200)" >"$out/$i" ;;
	esac
}

targets=("$@")
for i in "${!targets[@]}"; do waiter "$i" "${targets[$i]}" & done
( sleep $((max * 60)) ) & cap=$!

while :; do # a waiter that dies without a result must not end the wait early
	wait -n
	compgen -G "$out/[0-9]*" | rg -q '/[0-9]+$' && break
	kill -0 "$cap" 2>/dev/null || break
done
ended=0
for i in "${!targets[@]}"; do
	if [[ -f $out/$i ]]; then
		echo "${targets[$i]} $(<"$out/$i") after $((SECONDS - start))s"; ended=1
	else
		echo "${targets[$i]} pending"
	fi
done
((ended)) && exit 0
echo "cap of ${max} min reached; audit (side effects, herdr agent read --lines 40), then wait again" >&2
exit 124
