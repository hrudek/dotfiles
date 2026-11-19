#!/usr/bin/env bash
# Claude Code status line, a copy of Pi's footer (pi 1.5.2 FooterComponent)
# plus the claude-usage extension status:
#   ~/code/project (branch)
#   $0.123 (sub) 12.3%/1.0M (auto)                    claude-opus-5-5 • medium
#   5h 23% (2h 10m) · 7d 41% (3d 4h)
# Reads the status JSON on stdin; rate_limits is only present for
# subscription logins and after the first API response.
set -euo pipefail
export LC_ALL=C.UTF-8 # count "·" and "•" as one column

input="$(cat)"
now="$(date +%s)"

# Pi's catppuccin-macchiato theme: dim = overlay1, accent = mauve,
# warning = yellow, error = red.
text=$'\e[38;2;202;211;245m'
dim=$'\e[38;2;128;135;162m'
accent=$'\e[1;38;2;198;160;246m'
warning=$'\e[38;2;238;212;159m'
error=$'\e[38;2;237;135;150m'
reset=$'\e[0m'

# Pi's formatTokens.
tokens() {
  awk -v n="$1" 'BEGIN {
    if (n < 1000) printf "%d", n
    else if (n < 1e4) printf "%.1fk", n / 1000
    else if (n < 1e6) printf "%dk", int(n / 1000 + 0.5)
    else if (n < 1e7) printf "%.1fM", n / 1e6
    else printf "%dM", int(n / 1e6 + 0.5)
  }'
}

reset_in() {
  local minutes=$(( ($1 - now) / 60 ))
  ((minutes < 1)) && { printf '<1m'; return; }
  local d=$((minutes / 1440)) h=$((minutes % 1440 / 60)) m=$((minutes % 60))
  if ((d > 0)); then printf '%dd' "$d"; ((h > 0)) && printf ' %dh' "$h"
  elif ((h > 0)); then printf '%dh' "$h"; ((m > 0)) && printf ' %dm' "$m"
  else printf '%dm' "$m"; fi
}

# Visible width of a string containing ANSI color codes.
width() {
  local plain
  plain="$(sed $'s/\e\\[[0-9;]*m//g' <<<"$1")"
  printf '%d' "${#plain}"
}

# \x1f instead of tabs: read collapses runs of whitespace separators, which
# would shift fields after an empty one.
IFS=$'\x1f' read -r cwd session_name cost subscription ctx_size ctx_tokens ctx_pct \
  model effort thinking transcript cache_hit < <(jq -r '
  [ .workspace.current_dir // .cwd // "",
    .session_name // "",
    (.cost.total_cost_usd // 0),
    (.rate_limits != null),
    (.context_window.context_window_size // 0),
    (.context_window.current_usage // {}
      | (.input_tokens // 0) + (.cache_creation_input_tokens // 0) + (.cache_read_input_tokens // 0)),
    (.context_window.used_percentage // ""),
    .model.id // .model.display_name // "no-model",
    .effort.level // "",
    (.thinking.enabled | if . == null then true else . end),
    .transcript_path // "",
    (.context_window.current_usage // {}
      | ((.input_tokens // 0) + (.cache_creation_input_tokens // 0) + (.cache_read_input_tokens // 0)) as $p
      | if $p > 0 then (.cache_read_input_tokens // 0) / $p * 100 else "" end)
  ] | map(tostring) | join("\u001f")' <<<"$input")

# Line 1: working directory, git branch and session name.
pwd_line="$cwd"
[[ "$pwd_line" == "$HOME" || "$pwd_line" == "$HOME"/* ]] && pwd_line="~${pwd_line#"$HOME"}"
if branch="$(git -C "$cwd" --no-optional-locks branch --show-current 2>/dev/null)"; then
  [[ -n "$branch" ]] || branch="detached"
  pwd_line+=" ($branch)"
fi
[[ -n "$session_name" ]] && pwd_line+=" • $session_name"

# Line 2 left: session token totals (↑ input, ↓ output, R cache read,
# W cache write, CH cache hit rate of the latest request), cost and context.
# Totals come from the transcript, including subagent transcripts; Claude Code
# writes one line per content block, so keep the last usage per message id.
stats_parts=()
if [[ -f "$transcript" ]]; then
  read -r t_in t_out t_read t_write < <(
    cat "$transcript" "${transcript%.jsonl}"/subagents/*.jsonl 2>/dev/null \
      | grep -F '"usage"' \
      | jq -c 'select(.type == "assistant" and .message.usage != null)
               | {id: .message.id, u: .message.usage}' \
      | jq -rs 'group_by(.id) | map(.[-1].u)
                | [ (map(.input_tokens // 0) | add // 0),
                    (map(.output_tokens // 0) | add // 0),
                    (map(.cache_read_input_tokens // 0) | add // 0),
                    (map(.cache_creation_input_tokens // 0) | add // 0) ]
                | @tsv') || true
  ((${t_in:-0})) && stats_parts+=("↑$(tokens "$t_in")")
  ((${t_out:-0})) && stats_parts+=("↓$(tokens "$t_out")")
  ((${t_read:-0})) && stats_parts+=("R$(tokens "$t_read")")
  ((${t_write:-0})) && stats_parts+=("W$(tokens "$t_write")")
  if ((${t_read:-0} + ${t_write:-0} > 0)) && [[ -n "$cache_hit" ]]; then
    stats_parts+=("CH$(printf '%.1f' "$cache_hit")%")
  fi
fi
stats_parts+=("$(printf '$%.3f' "$cost")")
stats="${stats_parts[*]}"
[[ "$subscription" == true ]] && stats+=" (sub)"
if ((ctx_size > 0 && ctx_tokens > 0)); then
  ctx_pct="$(awk -v t="$ctx_tokens" -v s="$ctx_size" 'BEGIN { printf "%.1f", t / s * 100 }')"
elif [[ -n "$ctx_pct" ]]; then
  ctx_pct="$(printf '%.1f' "$ctx_pct")"
fi
auto=""
[[ "$(jq -r '.autoCompactEnabled // true' ~/.claude.json 2>/dev/null || echo true)" == true ]] \
  && [[ -z "${DISABLE_AUTO_COMPACT:-}" ]] && auto=" (auto)"
if [[ -n "$ctx_pct" ]]; then ctx="$ctx_pct%"; else ctx="?"; fi
ctx+="/$(tokens "$ctx_size")$auto"
ctx_color="$dim"
if [[ -n "$ctx_pct" ]]; then
  if awk -v p="$ctx_pct" 'BEGIN { exit !(p > 90) }'; then ctx_color="$error"
  elif awk -v p="$ctx_pct" 'BEGIN { exit !(p > 70) }'; then ctx_color="$warning"; fi
fi
left="${dim}${stats} ${reset}${ctx_color}${ctx}${reset}"

# Line 2 right: model and reasoning effort.
right="$model"
if [[ "$thinking" == false ]]; then right+=" • thinking off"
elif [[ -n "$effort" ]]; then right+=" • $effort"; fi
right="${dim}${right}${reset}"

# COLUMNS is the full terminal width, but Claude Code indents and clips the
# status line a few columns short of it; keep a safe margin on the right.
avail=$(( ${COLUMNS:-80} - 6 ))
pad=$(( avail - $(width "$left") - $(width "$right") ))
if ((pad >= 2)); then stats_line="${left}$(printf '%*s' "$pad" '')${right}"
else stats_line="$left"; fi

# Line 3: Claude subscription usage (Pi's claude-usage extension status).
usage=""
while IFS=$'\t' read -r name used resets; do
  [[ -n "$used" ]] || continue
  part="${text}${name}${reset} ${accent}${used}%${reset}"
  [[ -n "$resets" ]] && part+=" ${dim}($(reset_in "$resets"))${reset}"
  usage+="${usage:+ ${text}·${reset} }${part}"
done < <(jq -r '
  [["5h", .rate_limits.five_hour], ["7d", .rate_limits.seven_day]][]
  | select(.[1].used_percentage != null)
  | [.[0], (.[1].used_percentage | round | tostring), (.[1].resets_at // "" | tostring)]
  | @tsv' <<<"$input")

printf '%s\n' "${dim}${pwd_line}${reset}" "$stats_line"
[[ -z "$usage" ]] || printf '%s\n' "$usage"
