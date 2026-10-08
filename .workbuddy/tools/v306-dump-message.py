#!/usr/bin/env python3
"""v301：把生产库里那条「带 MEDIA: 的副驾回复」原文导出成 JSON（供真机探针当真实 payload）。
🔴 只读。输出走 stdout，由调用方重定向到本地文件；不在服务器留下任何副本。"""
import json
import sqlite3
import sys

DB = "/opt/hermes-tenants/hergent_t1/state.db"
WANT = int(sys.argv[1]) if len(sys.argv) > 1 else 530

c = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=5)
c.row_factory = sqlite3.Row
r = c.execute("SELECT id, role, content FROM messages WHERE id=?", (WANT,)).fetchone()
if not r:
    print(json.dumps({"error": "not found"}))
    sys.exit(1)
print(json.dumps({"id": r["id"], "role": r["role"], "content": r["content"]},
                 ensure_ascii=False))
c.close()
