#!/usr/bin/env python3
"""v301 取证：打印生产 Hermes 库里含 MEDIA: 的**逐字节原文行**（含不可见字符）。
🔴 只读（`mode=ro`）。存在的意义：判断路径里到底有没有空格 ——
   若有，按 `\\S+` 匹配的正则（Hermes 自己也是 `\\S+`）根本抓不到，卡片方案要改判据。
"""
import sqlite3
import sys

DB = sys.argv[1] if len(sys.argv) > 1 else "/opt/hermes-tenants/hergent_t1/state.db"
c = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=5)
c.row_factory = sqlite3.Row

for r in c.execute("SELECT id, session_id, role, content FROM messages "
                   "WHERE content LIKE '%MEDIA:%' ORDER BY id"):
    print("=" * 78)
    print("id=%s session=%s role=%s" % (r["id"], r["session_id"][:26], r["role"]))
    for ln in (r["content"] or "").split("\n"):
        if "MEDIA:" not in ln:
            continue
        print("  RAW   : %r" % ln)
        print("  空格数: %d   制表符: %d   长度: %d"
              % (ln.count(" "), ln.count("\t"), len(ln)))
        print("  分割  : %s" % [s for s in ln.split()])
c.close()
