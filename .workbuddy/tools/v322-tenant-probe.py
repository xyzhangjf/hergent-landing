# -*- coding: utf-8 -*-
"""v322 只读探针④：租户归属 + 小程序可见期次。"""
import os
import sqlite3

D = os.environ.get("ERP_DB_DIR", "/opt/hergent-erp")


def ro(p):
    return sqlite3.connect("file:%s?mode=ro" % p, uri=True)


def q(c, sql, a=()):
    try:
        cur = c.execute(sql, a)
        cur.row_factory = sqlite3.Row
        return [dict(r) for r in cur.fetchall()]
    except Exception as e:
        return [{"__err__": str(e)}]


c = ro(os.path.join(D, "tenant_1.db"))
print("### tenant_1 全部表（找用户表）")
print("  ", [r["name"] for r in q(c, "SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%user%' OR name LIKE '%staff%' OR name LIKE '%employee%')")])

print("\n### 找「刘小顶」")
for t in ("users", "user", "staff", "employees", "forecast_reporters"):
    rows = q(c, "SELECT * FROM %s WHERE name LIKE '%%刘小顶%%' OR username LIKE '%%刘小顶%%'" % t)
    if rows and rows[0].get("__err__"):
        continue
    for r in rows:
        print("   [%s] %s" % (t, r))

print("\n### tenant_1 用户一览（前 25）")
for r in q(c, "SELECT id,username,name,role,status FROM users ORDER BY id LIMIT 25"):
    print("   ", r)

print("\n### 小程序可见期次（status=open 全部）")
for r in q(c, "SELECT id,name,order_start,order_end,arrival_date,status FROM forecast_periods WHERE status='open'"):
    print("   ", r)

print("\n### 本期清单（forecast_import_products，按 period_id 统计）")
for r in q(c, "SELECT period_id,COUNT(*) n, COUNT(DISTINCT product_id) prods FROM forecast_import_products GROUP BY period_id ORDER BY period_id DESC LIMIT 8"):
    print("   ", r)

print("\n### 期次21 清单里的商品（前 20）")
for r in q(c, "SELECT id,period_id,product_id,product_name,order_date FROM forecast_import_products WHERE period_id=21 ORDER BY sort_no, id LIMIT 20"):
    print("   ", r)

print("\n### 期次21 清单里是否有 1596 / 1556 / 1494")
for pid in (1596, 1556, 1494):
    rows = q(c, "SELECT COUNT(*) n FROM forecast_import_products WHERE period_id=21 AND product_id=?", (pid,))
    print("   pid=%-6s 在期次21清单: %s" % (pid, rows))

c.close()
print("\nDONE")
