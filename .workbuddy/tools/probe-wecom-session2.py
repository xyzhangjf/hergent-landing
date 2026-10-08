#!/usr/bin/env python3
"""只读探针 2：导出 2026-09-27 晚 企微会话原文（周会 PPT 那一段）。"""
import sqlite3
import sys
import datetime as dt

DB = "/opt/hermes-tenants/hergent_t1/state.db"
SESSION = "20260911_153316_f57750b7"

# 北京时间 2026-09-27 23:40 ~ 2026-09-28 00:10
TZ = dt.timezone(dt.timedelta(hours=8))
t0 = dt.datetime(2026, 9, 27, 23, 40, tzinfo=TZ).timestamp()
t1 = dt.datetime(2026, 9, 28, 0, 20, tzinfo=TZ).timestamp()

con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
cur = con.cursor()

rows = cur.execute(
    """
    SELECT id, role, timestamp, tool_name, content, api_content
    FROM messages
    WHERE session_id = ? AND timestamp >= ? AND timestamp <= ?
    ORDER BY timestamp, id
    """,
    (SESSION, t0, t1),
).fetchall()

print(f"rows={len(rows)}")
print("=" * 100)
for rid, role, ts, tool_name, content, api_content in rows:
    local = dt.datetime.fromtimestamp(ts, TZ).strftime("%H:%M:%S")
    body = content or ""
    if not body.strip() and api_content:
        body = "[api_content] " + str(api_content)
    if tool_name:
        body = f"[tool:{tool_name}] " + body
    print(f"--- #{rid} {local} role={role} len={len(body)}")
    print(body[:3000])
    print()
