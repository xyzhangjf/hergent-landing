#!/usr/bin/env python3
"""只读探针 3：导出周会 PPT 对话后半段（23:54:47 之后）。"""
import sqlite3
import datetime as dt

DB = "/opt/hermes-tenants/hergent_t1/state.db"
SESSION = "20260911_153316_f57750b7"

TZ = dt.timezone(dt.timedelta(hours=8))
t0 = dt.datetime(2026, 9, 27, 23, 54, 46, tzinfo=TZ).timestamp()
t1 = dt.datetime(2026, 9, 28, 0, 20, tzinfo=TZ).timestamp()

con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
cur = con.cursor()

rows = cur.execute(
    """
    SELECT id, role, timestamp, tool_name, content
    FROM messages
    WHERE session_id = ? AND timestamp >= ? AND timestamp <= ?
    ORDER BY timestamp, id
    """,
    (SESSION, t0, t1),
).fetchall()

print(f"rows={len(rows)}")
print("=" * 100)
for rid, role, ts, tool_name, content in rows:
    local = dt.datetime.fromtimestamp(ts, TZ).strftime("%H:%M:%S")
    body = content or ""
    if tool_name:
        body = f"[tool:{tool_name}] " + body
    if role == "tool":
        print(f"--- #{rid} {local} role={role} len={len(body)}")
        print(body[:600])
    else:
        print(f"--- #{rid} {local} role={role} len={len(body)}")
        print(body[:4000])
    print()
