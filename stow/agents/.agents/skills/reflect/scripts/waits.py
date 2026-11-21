#!/usr/bin/env python3
"""Timing report for reflect: where sessions spent wall-clock time waiting.

Usage: python3 -I waits.py [--min SECONDS] [--since ISO] <session.jsonl>...

Per session, lists every tool call that
  - ran itself >= MIN seconds ("ran"), from the tool result's durationMs, or
  - returned >= MIN seconds after it finished because a parallel sibling in the
    same assistant turn was still running ("held"),
and every user message with the time since the last assistant step. Entries before --since are skipped. Cite the [id] in findings.
"""
import json, sys
from datetime import datetime, timezone

args = sys.argv[1:]
MIN, SINCE = 90.0, ''
while args and args[0].startswith('--'):
    if args[0] == '--min': MIN = float(args[1])
    elif args[0] == '--since': SINCE = args[1]
    else: sys.exit(__doc__)
    args = args[2:]
if not args: sys.exit(__doc__)

def ts(s): return datetime.fromisoformat(s.replace('Z', '+00:00'))
def dur(s): s = int(s); return f"{s // 60}m{s % 60:02d}s"
def text(c):
    if isinstance(c, str): return c
    return ''.join(x.get('text', '') for x in c or [] if isinstance(x, dict))

for path in args:
    rows = [json.loads(l) for l in open(path) if l.strip()]
    name = next((r.get('name') for r in reversed(rows) if r.get('type') == 'session_info'), None)
    print(f"\n# Session {name or path.rsplit('/', 1)[-1]}\n")
    msgs = [r for r in rows if r.get('type') == 'message']
    calls, turn_end, last_asst = {}, None, None
    total_run = total_held = 0.0
    for r in msgs:
        m, t = r['message'], ts(r['timestamp'])
        skip = SINCE and r['timestamp'] < SINCE
        role = m.get('role')
        if role == 'assistant':
            last_asst = t
            for c in m.get('content', []):
                if c.get('type') == 'toolCall':
                    calls[c['id']] = (t, c['name'], json.dumps(c.get('arguments', {}), ensure_ascii=False))
        elif role == 'toolResult' and m.get('toolCallId') in calls:
            t0, tool, a = calls[m['toolCallId']]
            wall = (t - t0).total_seconds()
            ran = m.get('durationMs', wall * 1000) / 1000
            held = max(0.0, wall - ran)
            if skip: continue
            total_run += ran if ran >= MIN else 0
            total_held += held if held >= MIN else 0
            if ran >= MIN or held >= MIN:
                tag = f"ran {dur(ran)}" + (f", held {dur(held)} by siblings" if held >= MIN else '')
                err = ' ERROR' if m.get('isError') else ''
                out = text(m.get('content')).strip().replace('\n', ' ')
                print(f"- [{r['id']}] {t0:%m-%d %H:%M} {tag} {tool}{err}: {a[:400]}")
                print(f"  → …{out[-300:]}")
        elif role == 'user' and last_asst and not skip:
            gap = (t - last_asst).total_seconds()
            # pi queues messages sent during a running tool, so a long gap here often means the user waited on a block
            print(f"- USER [{r['id']}] {t:%m-%d %H:%M} {dur(gap)} after the last assistant step: {text(m.get('content')).strip()[:300]!r}")
    print(f"\nTotals (calls over {int(MIN)}s): ran {dur(total_run)}, held by siblings {dur(total_held)}")
