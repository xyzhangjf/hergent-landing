# -*- coding: utf-8 -*-
"""核查 products_fts 与 products 的 rowid 对应关系（是否有既存的失同步）。"""
import sqlite3, os
c = sqlite3.connect("file:/opt/hergent-erp/tenant_1.db?mode=ro", uri=True)
ddl = c.execute("SELECT sql FROM sqlite_master WHERE name='products_fts'").fetchone()
print("products_fts DDL:", ddl)
for r in c.execute("SELECT name, sql FROM sqlite_master WHERE type='trigger' AND tbl_name='products'").fetchall():
    print("TRIGGER", r[0], ":", (r[1] or '')[:220].replace("\n", " "))
print()
print("products 行数      :", c.execute("SELECT COUNT(*) FROM products").fetchone()[0])
print("products_fts 行数  :", c.execute("SELECT COUNT(*) FROM products_fts").fetchone()[0])
print("rowid 交集行数      :", c.execute("SELECT COUNT(*) FROM products_fts f WHERE EXISTS(SELECT 1 FROM products p WHERE p.id=f.rowid)").fetchone()[0])
print("products 里 id 最大 :", c.execute("SELECT MAX(id) FROM products").fetchone()[0])
print("fts rowid 范围      :", c.execute("SELECT MIN(rowid), MAX(rowid) FROM products_fts").fetchone())
print()
for pid in (1556, 1494, 1596, 1204):
    print("  pid=%-6s in products=%s  fts_rowid=%s" % (
        pid, c.execute("SELECT COUNT(*) FROM products WHERE id=?", (pid,)).fetchone()[0],
        c.execute("SELECT COUNT(*) FROM products_fts WHERE rowid=?", (pid,)).fetchone()[0]))
print()
print("缺失示例（products 有、fts 无）前 10 个:")
for r in c.execute("SELECT p.id, p.name FROM products p WHERE NOT EXISTS(SELECT 1 FROM products_fts f WHERE f.rowid=p.id) LIMIT 10").fetchall():
    print("   ", r)
print("缺失总数:", c.execute("SELECT COUNT(*) FROM products p WHERE NOT EXISTS(SELECT 1 FROM products_fts f WHERE f.rowid=p.id)").fetchone()[0])
print()
print("fts 里有多余行（fts 有、products 无）:", c.execute(
    "SELECT COUNT(*) FROM products_fts f WHERE NOT EXISTS(SELECT 1 FROM products p WHERE p.id=f.rowid)").fetchone()[0])
c.close()
