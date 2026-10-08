# -*- coding: utf-8 -*-
"""v322 只读探针②：目标明细 + 租户归属 + 其余「读月锚点」取证。"""
import os
import sqlite3

DB_DIR = os.environ.get("ERP_DB_DIR", "/opt/hergent-erp")


def ro(p):
    return sqlite3.connect("file:%s?mode=ro" % p, uri=True)


def q(con, sql, args=()):
    try:
        cur = con.execute(sql, args)
        cur.row_factory = sqlite3.Row
        return [dict(r) for r in cur.fetchall()]
    except Exception as e:
        return [{"__err__": str(e)}]


p = os.path.join(DB_DIR, "tenant_1.db")
c = ro(p)

print("=" * 78)
print("### tenant_1 目标全表")
print("=" * 78)
for r in q(c, "SELECT id,period_month,product_id,product_name,brand,target_qty,target_unit,"
              "order_count,status,created_by FROM product_targets ORDER BY period_month, id"):
    print("  id=%-4s %s pid=%-6s %-42s %s%s 可报单数=%-4s %s"
          % (r["id"], r["period_month"], r["product_id"], r["product_name"],
             r["target_qty"], r["target_unit"], r["order_count"], r["status"]))

print("\n" + "=" * 78)
print("### 当前 open 期次（id=21）的清单商品 与 目标是否对得上")
print("=" * 78)
rows = q(c, "SELECT COUNT(*) n FROM forecast_submission_items WHERE 1=1")
print("  submission_items 总数:", rows)

print("\n### 当期清单（period_id=21）")
for sql in ["SELECT product_id,COUNT(*) n FROM forecast_submission_items WHERE period_id=21 GROUP BY product_id LIMIT 5",
            "SELECT DISTINCT period_id FROM forecast_submission_items ORDER BY period_id DESC LIMIT 10"]:
    for r in q(c, sql):
        print("   ", r)

print("\n" + "=" * 78)
print("### 员工：找「刘小顶」")
print("=" * 78)
for r in q(c, "SELECT id,name,role,phone,status FROM employees WHERE name LIKE '%刘小顶%'"):
    print("   ", r)
print("   -- 全部员工姓名（前 30）--")
for r in q(c, "SELECT id,name,role FROM employees ORDER BY id LIMIT 30"):
    print("   ", r)

print("\n" + "=" * 78)
print("### 该商品 10 月目标（已存在的那 1 条）")
print("=" * 78)
for r in q(c, "SELECT * FROM product_targets WHERE period_month='2026-10'"):
    print("   ", {k: r[k] for k in ("id", "period_month", "product_id", "product_name",
                                    "target_qty", "target_unit", "order_count", "status")})

print("\n" + "=" * 78)
print("### tenant_1 到货规则明细（蒙牛鲜奶 / 蒙牛低温）")
print("=" * 78)
for r in q(c, "SELECT * FROM rebate_target_rules WHERE dimension='brand' AND is_active=1"):
    print("   ", r)

print("\n" + "=" * 78)
print("### 主库 tenants 表结构（供确认租户归属）")
print("=" * 78)
mc = ro(os.path.join(DB_DIR, "erp.db"))
for r in q(mc, "PRAGMA table_info(tenants)"):
    print("   ", r["name"])
print("   -- 行 --")
for r in q(mc, "SELECT * FROM tenants ORDER BY id LIMIT 12"):
    print("   ", r)

c.close()
mc.close()
print("\nDONE")
