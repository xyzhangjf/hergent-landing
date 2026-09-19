#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""查看 product_change_logs 结构与既有记录约定（只读）—— 为归并补写留痕做准备"""
import sqlite3

DB = "/opt/hergent-erp/tenant_1.db"
c = sqlite3.connect("file:%s?mode=ro" % DB, uri=True)
cur = c.cursor()

print("=== product_change_logs 结构 ===")
for r in cur.execute("PRAGMA table_info(product_change_logs)"):
    print("   cid=%s %-18s %-12s notnull=%s default=%s" % (r[0], r[1], r[2], r[3], r[4]))

print("\n=== 索引 ===")
for r in cur.execute("PRAGMA index_list(product_change_logs)"):
    print("   ", r)
for r in cur.execute("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='product_change_logs'"):
    print("   ", r[0])

print("\n=== 总行数 ===")
print("   ", cur.execute("SELECT COUNT(*) FROM product_change_logs").fetchone()[0])

print("\n=== 最近 8 条（看字段用法与 changed_by 口径）===")
cols = [r[1] for r in cur.execute("PRAGMA table_info(product_change_logs)")]
print("   列:", cols)
for r in cur.execute("SELECT * FROM product_change_logs ORDER BY rowid DESC LIMIT 8"):
    print("   ", dict(zip(cols, r)))

print("\n=== brand 字段的历史记录（全部）===")
q = "SELECT * FROM product_change_logs WHERE field='brand' ORDER BY rowid"
try:
    rows = cur.execute(q).fetchall()
except Exception as e:
    print("   ERR", e)
    rows = []
print("   field='brand' 行数 =", len(rows))
for r in rows[:30]:
    print("   ", dict(zip(cols, r)))

print("\n=== 这 24 条 new_value 命中行的明细 ===")
try:
    rows = cur.execute(
        "SELECT * FROM product_change_logs WHERE CAST(new_value AS TEXT) IN "
        "('蒙牛低温（福宝）','蒙牛低温（恒滋）') ORDER BY rowid").fetchall()
    print("   命中 =", len(rows))
    for r in rows:
        print("   ", dict(zip(cols, r)))
except Exception as e:
    print("   ERR", e)

print("\n=== 后端写这张表的地方（供对照）===")
print("   （见 grep product_change_logs server/）")
c.close()
print("\n[READ-ONLY] done.")
