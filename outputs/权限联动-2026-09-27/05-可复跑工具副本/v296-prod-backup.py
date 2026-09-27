#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v296 生产备份：一致性快照（`VACUUM INTO`）+ `role_permissions` 精确导出。

🔴 为什么不用 `cp`：生产库可能有 -wal/-journal，`cp` 出来的是**不一致**的文件
   （数据页与 WAL 未合并）⇒ 那份备份在回滚时可能缺最近的事务。
   `VACUUM INTO` 是 SQLite 官方的**一致性快照**做法（3.27+，生产 3.37 ✓）：
   源只读、目标是一个已合并的事务一致副本。
"""
import datetime
import json
import os
import sqlite3
import sys

SRC = sys.argv[1] if len(sys.argv) > 1 else "/opt/hergent-erp"
DBS = ("tenant_1.db", "tenant_10.db", "erp.db")

ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
dst = os.path.join(SRC, "_rollback", "v296-pre-" + ts)
os.makedirs(dst, exist_ok=True)
print("备份目录：%s" % dst)

snap = {}
for f in DBS:
    src = os.path.join(SRC, f)
    if not os.path.exists(src):
        print("  跳过 %s（不存在）" % f)
        continue
    out = os.path.join(dst, f)
    con = sqlite3.connect(src)
    con.execute("VACUUM INTO ?", (out,))
    con.close()
    print("  ✅ %s → %s（%d B）" % (f, out, os.path.getsize(out)))
    ro = sqlite3.connect("file:%s?mode=ro" % out, uri=True)
    rows = ro.execute("SELECT role_name, permissions FROM role_permissions").fetchall()
    ro.close()
    snap[f] = [[r, p] for r, p in rows]
    print("     内含 role_permissions %d 行" % len(rows))

p = os.path.join(dst, "role_permissions.snapshot.json")
with open(p, "w", encoding="utf-8") as fh:
    json.dump(snap, fh, ensure_ascii=False, indent=2)
print("精确快照：%s" % p)
print("\n回滚命令（仅在需要时执行）：")
for f in snap:
    print("  cp %s/%s %s/%s" % (dst, f, SRC, f))
print("  systemctl restart hergent-erp")
