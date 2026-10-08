# -*- coding: utf-8 -*-
"""追查 forecast_config +1 与 FTS 连锁变化的归因。"""
import sqlite3, os, json
BASE = "/opt/hergent-erp"
c = sqlite3.connect("file:%s?mode=ro" % os.path.join(BASE, "tenant_1.db"), uri=True)
b = sqlite3.connect("file:%s?mode=ro&immutable=1" % os.path.join(BASE,
    "backups/2026-09-26/tenant_1.db.bak-v279f-sample-20260926-194216"), uri=True)

print("=== forecast_config 结构 ===")
cols = [r[1] for r in c.execute("PRAGMA table_info(forecast_config)").fetchall()]
print("   ", cols)
print("=== 现网全部行 ===")
for r in c.execute("SELECT * FROM forecast_config ORDER BY rowid").fetchall():
    print("   ", dict(zip(cols, r)))
print("=== 备份里的 rowid 集合 ===")
k = "rowid"
if "id" in cols:
    k = "id"
have_b = {r[0] for r in b.execute("SELECT %s FROM forecast_config" % k).fetchall()}
print("   备份 id:", sorted(have_b))
print("   新增的是:", sorted({r[0] for r in c.execute("SELECT %s FROM forecast_config" % k).fetchall()} - have_b))

print()
print("=== product_change_logs 新增 4 行 ===")
lcols = [r[1] for r in c.execute("PRAGMA table_info(product_change_logs)").fetchall()]
print("   cols:", lcols)
q = "SELECT * FROM product_change_logs WHERE product_id=1596 ORDER BY id DESC LIMIT 6"
for r in c.execute(q).fetchall():
    print("   ", dict(zip(lcols, r)))

print()
print("=== FTS 连锁 ===")
print("   products 行数:", c.execute("SELECT COUNT(*) FROM products").fetchone()[0])
for t in ("products_fts", "products_fts_data", "products_fts_idx"):
    try:
        print("   %-20s %s" % (t, c.execute("SELECT COUNT(*) FROM %s" % t).fetchone()[0]))
    except Exception as e:
        print("   %-20s ERR %s" % (t, e))
r = c.execute("SELECT rowid, name FROM products_fts WHERE rowid=1596").fetchone()
print("   FTS 里 1596 的名字:", r)
print("   清单19 里 1596 的登记名:",
      c.execute("SELECT product_name FROM forecast_import_products WHERE period_id=19 AND product_id=1596").fetchone())
c.close(); b.close()
