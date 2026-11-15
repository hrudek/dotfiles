# Token efficiency

- Always limit tool output: `| head -n 50`, `tail`, `rg -m`; check size with `wc -l` first when unsure.
- `gh`/APIs: use `--json` with `--jq` for only the needed fields. Filter logs with `rg`, never dump them whole.
- Read large files with `offset`/`limit`; locate the spot with `rg -n` first.
- Builds/tests: print only errors and the summary (`2>&1 | tail -n 40`).
- Don't poll with `sleep`. Use blocking commands (`wait`, `gh run watch`). If unavoidable, use a script that waits until something changes and prints only the result.
- Always bound blocking waits with `timeout` (or the tool's timeout parameter) so nothing hangs forever.
- Use codemode to batch independent calls and to filter/aggregate data in the script. Return only the condensed result, never raw dumps.
- Work targeted: no broad exploration when the path/goal is known.

# Orchestration / subagents

- Keep state in files (e.g. `TASKS.md`), not in context.
- Run each task in its own worker with a fresh context.
- Worker reply max. 10 lines: status, branch/PR, open issues. Details go to `reports/<task>.md`.
