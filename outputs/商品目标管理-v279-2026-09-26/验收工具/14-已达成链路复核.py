#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""只读复核 v277 补的「已达成」链路：生产 tenant_1 里，本月有多少商品**真的**能算出一个非 0 的已达成。

复刻 `routers/product_targets.py::_achieved_from_sales` 的 SQL 与 `_achieved_map` 的两个来源：
  ① rebate_achievements.dimension='product'（src=manual，人工填报优先）
  ② 没有人工填报的 ⇒ 销售单明细自动汇总（src=sales）
     · 月份键   strftime('%Y-%m', so.order_date) = 'YYYY-MM'
     · 有效状态 so.status IN ('delivered','signed')
只读打开，不写任何东西。
"""
import sqlite3

ROOT = "/opt/hergent-erp"
MONTH = "2026-09"
c = sqlite3.connect("file:%s/tenant_1.db?mode=ro" % ROOT, uri=True)
c.row_factory = sqlite3.Row

n_prod = c.execute("SELECT COUNT(*) FROM products").fetchone()[0]
print("商品总数 =", n_prod)

# ① 人工填报（rebate_achievements，product 维度）
try:
    n_manual = c.execute(
        "SELECT COUNT(*) FROM rebate_achievements WHERE dimension='product'").fetchone()[0]
    n_manual_m = c.execute(
        "SELECT COUNT(*) FROM rebate_achievements WHERE dimension='product' AND period_month=?",
        (MONTH,)).fetchone()[0]
    print("rebate_achievements product 维度：全库 %d 行 / 本月 %s 为 %d 行" % (n_manual, MONTH, n_manual_m))
except Exception as e:
    print("rebate_achievements 读失败：", e)

# ② 销售单自动汇总（复刻 _achieved_from_sales 的 SQL）
sql = ("SELECT soi.product_id AS pid, SUM(soi.quantity) AS qty, COUNT(*) AS lines "
       "FROM sale_order_items soi JOIN sale_orders so ON so.id = soi.order_id "
       "WHERE strftime('%Y-%m', so.order_date)=? "
       "AND so.status IN ('delivered','signed') "
       "GROUP BY soi.product_id")
rows = c.execute(sql, (MONTH,)).fetchall()
print("销售单汇总口径命中商品数 =", len(rows))
tot = sum(float(r["qty"] or 0) for r in rows)
print("这些商品的明细数量合计 = %.2f（明细行 %d 条）"
      % (tot, sum(int(r["lines"] or 0) for r in rows)))

# 状态分布（看 'delivered'/'signed' 是不是真的在用）
print("-- 本月销售单状态分布（排除已排除的）")
for r in c.execute("SELECT COALESCE(status,'') AS st, COUNT(*) AS n, "
                   "COUNT(*) AS q "
                   "FROM sale_orders WHERE strftime('%Y-%m', order_date)=? "
                   "GROUP BY st ORDER BY n DESC", (MONTH,)):
    print("   status=%-14r 单数=%-6d" % (r["st"], r["n"]))

# 取几个有量的样本，看档案单位/换算能不能折箱（能不能出非 0 已达成）
ids = [int(r["pid"]) for r in rows][:8]
if ids:
    ph = ",".join("?" * len(ids))
    print("-- 样本（前 8 个有量的商品）")
    for r in c.execute(
            "SELECT id, COALESCE(name,''), COALESCE(unit,''), COALESCE(spec,''), "
            "COALESCE(large_unit,''), COALESCE(large_ratio,0) FROM products "
            "WHERE id IN (%s)" % ph, ids):
        print("   id=%-6s unit=%-4r spec=%-4r large_unit=%-4r large_ratio=%s name=%s"
              % (r[0], r[2], r[3], r[4], r[5], r[1]))

# 有目标、且本月有销量的交集（这才是小程序会真正展示均单的行）
tg = c.execute("SELECT DISTINCT product_id FROM product_targets "
               "WHERE period_month=?", (MONTH,)).fetchall()
tids = set(int(r[0]) for r in tg)
print("本月建过目标的商品数 =", len(tids))
hit = tids & set(int(r["pid"]) for r in rows)
print("其中**本月有销售**（能算出非 0 已达成）的 =", len(hit), sorted(hit)[:10])
c.close()
