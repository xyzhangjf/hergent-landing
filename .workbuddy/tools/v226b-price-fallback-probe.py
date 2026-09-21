#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v226b 只读：`purchase_price` 回退的量纲/语义取证 —— 收紧前的定性定案。

背景（v226 已定案的事实）：
  · `factory_price` = 元/箱（厂家结算成本）；`purchase_price` = 元/小单位。
  · 46 个两列都有值的商品上 `purchase_price == dist_price == sale_price` 全等
    ⇒ 该列的**语义**是「卖给门店的价」，不是进货成本。
  · 因此「fp 为空则回退 pp」这一支**量纲错 + 语义错**。
收紧前必须回答：**这一支到底影响多少钱、落到哪几条链**。

Q1 命中清单：启用商品里 fp<=0 且 pp>0 的逐个明细（含 pp/sale/dist/spec/换算字段）
Q2 等值率：全部 pp>0 的启用商品上，pp == sale_price / pp == dist_price 的比例
Q3 金额链落点：`forecast_audit_decisions`（本期需付款的取数表）里命中商品的行数与
   qty 合计 —— 决定 `payments_compute` 的数字会不会变
Q4 渠道链落点：`price_channels.price_source` 分布 —— 决定 `resolve_price`
   的 products_factory 支生产上是否真的在用
只读（`mode=ro`），零写入。
"""
import sqlite3
import sys

TDB = sys.argv[1] if len(sys.argv) > 1 else "/opt/hergent-erp/tenant_1.db"
DB = sqlite3.connect("file:" + TDB + "?mode=ro", uri=True)
DB.row_factory = sqlite3.Row


def q(sql, args=()):
    return DB.execute(sql, args).fetchall()


print("== Q1 命中清单（启用商品 fp<=0 且 pp>0）==")
rows = q("""
    SELECT id, name, spec, unit, large_unit, large_ratio, medium_unit, medium_ratio,
           COALESCE(factory_price,0) AS fp, COALESCE(purchase_price,0) AS pp,
           COALESCE(dist_price,0) AS dp, COALESCE(sale_price,0) AS sp
    FROM products
    WHERE COALESCE(is_active,1)=1
      AND COALESCE(factory_price,0)<=0 AND COALESCE(purchase_price,0)>0
    ORDER BY id
""")
print("命中 %d 个" % len(rows))
print("%-7s %-26s %-14s %-6s %-6s %-8s %-9s %-9s %s"
      % ("id", "name", "spec", "unit", "lr", "fp", "pp", "sale", "pp==sale"))
for r in rows:
    print("%-7s %-26s %-14s %-6s %-6s %-8s %-9s %-9s %s"
          % (r["id"], str(r["name"])[:26], str(r["spec"] or "(空)")[:14],
             r["unit"] or "-", r["large_ratio"] or 0, r["fp"], r["pp"], r["sp"],
             "YES" if abs(r["pp"] - r["sp"]) < 0.005 else "no"))

print()
print("== Q2 等值率（启用 且 pp>0 的全部商品）==")
t = q("""SELECT COUNT(*) n,
                SUM(CASE WHEN ABS(COALESCE(purchase_price,0)-COALESCE(sale_price,0))<0.005
                         THEN 1 ELSE 0 END) eq_sale,
                SUM(CASE WHEN ABS(COALESCE(purchase_price,0)-COALESCE(dist_price,0))<0.005
                         THEN 1 ELSE 0 END) eq_dist
         FROM products WHERE COALESCE(is_active,1)=1 AND COALESCE(purchase_price,0)>0""")[0]
print("  pp>0 的商品 %s 个：pp==sale %s 个 / pp==dist %s 个" % (t["n"], t["eq_sale"], t["eq_dist"]))

print()
print("== Q3 金额链落点：forecast_audit_decisions（本期需付款取数表）==")
try:
    hit_ids = [r["id"] for r in rows]
    if hit_ids:
        ph = ",".join(["?"] * len(hit_ids))
        d = q("""SELECT COUNT(*) n, COALESCE(SUM(final_qty),0) q
                 FROM forecast_audit_decisions WHERE product_id IN (%s)""" % ph, hit_ids)[0]
        print("  命中商品在审定表里出现 %s 行，final_qty(箱)合计 %s" % (d["n"], round(d["q"], 3)))
        for r in q("""SELECT period_start, period_end, product_id, final_qty
                      FROM forecast_audit_decisions WHERE product_id IN (%s)
                      ORDER BY period_start LIMIT 10""" % ph, hit_ids):
            print("    %s~%s pid=%s qty=%s" % (r["period_start"], r["period_end"],
                                               r["product_id"], r["final_qty"]))
    else:
        print("  （无命中商品）")
    tot = q("""SELECT COUNT(*) n, COUNT(DISTINCT product_id) p,
                      SUM(CASE WHEN COALESCE(final_qty,0)>0 THEN 1 ELSE 0 END) nz,
                      COALESCE(SUM(final_qty),0) q FROM forecast_audit_decisions""")[0]
    print("  全表：%s 行 / %s 个商品 / qty>0 的 %s 行 / qty 合计 %s"
          % (tot["n"], tot["p"], tot["nz"], round(tot["q"], 3)))
except Exception as e:
    print("  !! %s" % e)

print()
print("== Q4 渠道链落点：price_channels.price_source 分布 ==")
try:
    for r in q("SELECT id, code, name, kind, price_source, COALESCE(is_active,1) act, "
               "COALESCE(is_default,0) dft FROM price_channels ORDER BY sort, id"):
        print("  id=%-4s code=%-14s kind=%-12s price_source=%-18s active=%s default=%s  %s"
              % (r["id"], r["code"], r["kind"], r["price_source"], r["act"], r["dft"], r["name"]))
except Exception as e:
    print("  !! %s" % e)

print()
print("== Q5 三列价齐备商品的量纲复核（pp / dp / sp 三者关系）==")
r = q("""SELECT COUNT(*) n,
                SUM(CASE WHEN ABS(COALESCE(purchase_price,0)-COALESCE(dist_price,0))<0.005
                         AND ABS(COALESCE(purchase_price,0)-COALESCE(sale_price,0))<0.005
                         THEN 1 ELSE 0 END) all3
         FROM products WHERE COALESCE(factory_price,0)>0
           AND COALESCE(purchase_price,0)>0""")[0]
print("  fp>0 且 pp>0 的 %s 个中，pp==dp==sp 三者全等的 %s 个" % (r["n"], r["all3"]))
