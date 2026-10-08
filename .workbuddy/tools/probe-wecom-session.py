#!/usr/bin/env python3
"""只读探针：读生产租户 Hermes state.db 里企微会话的对话原文。

纪律：
- 只以 mode=ro 打开，绝不写库。
- 只查，不修改任何东西；跑完不影响网关。
"""
import sqlite3
import sys
import json

DB = "/opt/hermes-tenants/hergent_t1/state.db"
TARGET_SESSION = sys.argv[1] if len(sys.argv) > 1 else "20260911_153316_f57750b7"
DAY = sys.argv[2] if len(sys.argv) > 2 else "2026-09-27"

uri = f"file:{DB}?mode=ro"
con = sqlite3.connect(uri, uri=True)
cur = con.cursor()

print("=== tables ===")
for (name,) in cur.execute(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
):
    try:
        n = cur.execute(f"SELECT COUNT(*) FROM '{name}'").fetchone()[0]
    except Exception as e:
        n = f"ERR {e}"
    print(f"  {name}: {n}")

print()
print("=== columns of likely message tables ===")
for t in ("messages", "message", "session_messages", "chat_messages"):
    try:
        cols = cur.execute(f"PRAGMA table_info('{t}')").fetchall()
    except Exception:
        continue
    if cols:
        print(f"  [{t}]")
        for c in cols:
            print(f"    {c[1]} ({c[2]})")
