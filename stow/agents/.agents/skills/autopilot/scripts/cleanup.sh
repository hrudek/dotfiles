#!/usr/bin/env bash
# Remove worktrees and local branches whose work has landed. Loses nothing:
# only clean checkouts whose head equals a merged PR's head (or, detached, is on a remote branch).
# Usage: cleanup.sh <repo-root>   (the folder holding .bare, or a normal repo)
# Prints what it removed and what it kept and why. Safe while other runs work in the same repo:
# it skips worktrees a process sits in and detached checkouts used in the last 2 h (verifiers).
set -uo pipefail
[[ $# -eq 1 ]] || { echo "usage: cleanup.sh <repo-root>" >&2; exit 2; }
root=$(cd "$1" && pwd) || exit 2
git -C "$root" fetch -q --prune origin
cur=$(git rev-parse --show-toplevel 2>/dev/null || true)
landed() { # <branch> <sha>: a merged PR has exactly this head
	local ph
	ph=$(cd "$root" && gh pr list --head "$1" --state merged --limit 1 --json headRefOid --jq '.[0].headRefOid // ""' 2>/dev/null)
	[[ -n $ph && $ph == "$2" ]]
}

while IFS=$'\t' read -r p b; do
	[[ $p == "$cur" || $(basename "$p") == main || $p == */.bare ]] && continue
	h=$(git -C "$p" rev-parse HEAD 2>/dev/null) || { echo "kept $p: unreadable"; continue; }
	busy=$(for c in /proc/[0-9]*/cwd; do l=$(readlink "$c" 2>/dev/null) && [[ $l == "$p" || $l == "$p"/* ]] && echo x && break; done)
	[[ -z $busy ]] || { echo "kept $p: a process is working in it"; continue; }
	gd=$(git -C "$p" rev-parse --absolute-git-dir)
	if [[ $b == - && -n $(find "$gd" -maxdepth 1 \( -name index -o -name HEAD \) -mmin -120 2>/dev/null) ]]; then
		echo "kept $p: detached checkout used in the last 2 h (verifier may be running)"; continue
	fi
	[[ -z $(git -C "$p" status --porcelain) ]] || { echo "kept $p: uncommitted changes"; continue; }
	if [[ $b == - ]]; then
		[[ -n $(git -C "$p" branch -r --contains "$h" 2>/dev/null) ]] || { echo "kept $p: detached head on no remote branch"; continue; }
	else
		landed "$b" "$h" || { echo "kept $p ($b): no merged PR with this head"; continue; }
	fi
	git -C "$root" worktree remove "$p" && echo "removed worktree $p" || { echo "kept $p: worktree remove failed"; continue; }
	[[ $b == - ]] || { git -C "$root" branch -q -D "$b" && echo "deleted branch $b"; }
done < <(git -C "$root" worktree list --porcelain | awk '/^worktree /{p=substr($0,10)} /^branch /{b=$2; sub("refs/heads/","",b); print p"\t"b} /^detached/{print p"\t-"}')
git -C "$root" worktree prune

# Branches without a worktree whose remote is gone after a merge.
while read -r b; do
	git -C "$root" worktree list --porcelain | rg -q "^branch refs/heads/$b\$" && { echo "kept branch $b: checked out"; continue; }
	landed "$b" "$(git -C "$root" rev-parse "$b")" && git -C "$root" branch -q -D "$b" && echo "deleted branch $b" || echo "kept branch $b: no merged PR with this head"
done < <(git -C "$root" for-each-ref refs/heads --format='%(refname:short) %(upstream:track)' | awk '$2=="[gone]"{print $1}')
