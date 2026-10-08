# -*- coding: utf-8 -*-
"""v322 只读探针③：用**真实算法函数**量化「锚点取报单月 vs 到货月」的差异。

只 import 纯函数域模块（domain/arrival_schedule、domain/product_targets），
不 import server / erp_db ⇒ 不触发建表、不写任何库。
"""
import os
import sys
import json
import sqlite3

sys.path.insert(0, os.environ.get("ERP_SERVER_DIR", "/opt/hergent-erp/server"))

from domain import arrival_schedule as ar          # noqa: E402
from domain import product_targets as pt           # noqa: E402

DB = os.path.join(os.environ.get("ERP_DB_DIR", "/opt/hergent-erp"), "tenant_1.db")
con = sqlite3.connect("file:%s?mode=ro" % DB, uri=True)
con.row_factory = sqlite3.Row

TODAY = "2026-09-29"

print("=" * 84)
print("A. 四个跨月/本月期次 → 锚点对比（报单月 vs 到货月）")
print("=" * 84)
periods = [dict(r) for r in con.execute(
    "SELECT id,name,order_start,order_end,arrival_date,status FROM forecast_periods "
    "ORDER BY order_start DESC, id DESC LIMIT 6")]
rules = {r["scope_key"]: dict(r) for r in con.execute(
    "SELECT * FROM rebate_target_rules WHERE dimension='brand' AND is_active=1")}

for p in periods:
    os_ = str(p["order_start"] or "")
    ar_ = str(p["arrival_date"] or "")
    om, am = os_[:7], ar_[:7]
    print("\n期次 id=%s  %s" % (p["id"], p["name"]))
    print("   报单 %s ~ %s   到货 %s   [%s]" % (os_, p["order_end"], ar_, p["status"]))
    print("   现实现取月 = _month_of(order_start) = %s" % om)
    print("   到货锚点取月 = _month_of(arrival_date) = %s" % am)
    if om != am:
        print("   >>> 分叉：目标月不同（%s vs %s）" % (om, am))

print("\n" + "=" * 84)
print("B. 「蒙牛鲜奶」整月到货日历 + 剩余可报期次（真实算法）")
print("=" * 84)
rule = rules.get("蒙牛鲜奶")
for (y, m) in ((2026, 9), (2026, 10)):
    s = ar.arrival_summary(rule, y, m)
    dates = s["dates"]
    rem, total = pt.remaining_periods(dates, TODAY)
    print("\n  arrival_summary(%d,%d): source=%s count=%d effective_count=%s"
          % (y, m, s["source"], s["count"], s["effective_count"]))
    print("    dates = %s" % dates)
    print("    remaining_periods(today=%s) = %d / total %d" % (TODAY, rem, total))

print("\n" + "=" * 84)
print("C. 复算均单目标（用户点名的那个商品：pid=1596，120 箱）")
print("=" * 84)
tgt = dict(con.execute(
    "SELECT * FROM product_targets WHERE id=3").fetchone())
print("  目标档案: %s  %s%s  月份=%s"
      % (tgt["product_name"], tgt["target_qty"], tgt["target_unit"], tgt["period_month"]))

for label, (y, m) in (("现实现（锚=报单月 2026-09）", (2026, 9)),
                      ("修正后（锚=到货月 2026-10）", (2026, 10))):
    s = ar.arrival_summary(rule, y, m)
    rem, total = pt.remaining_periods(s["dates"], TODAY)
    # 已达成：暂按 0（下面单独查）
    res = pt.prefill_box(float(tgt["target_qty"] or 0), 0.0, rem, 0.0)
    print("\n  %s" % label)
    print("    剩余可报期次 rem=%d（分母）" % rem)
    print("    均单剩余 = %.3f 箱   no_window=%s done=%s"
          % (res["avg"], res["no_window"], res["done"]))

print("\n" + "=" * 84)
print("D. 已达成口径（_achieved_from_sales 用 order_date 月份）")
print("=" * 84)
print("  ⚠️ 月份键 = strftime('%Y-%m', so.order_date)；锚点换了它必须跟着换，")
print("     否则会出现「10 月目标 ÷ 10 月剩余期次 − 9 月已达成」的混月算式。")
for r in con.execute(
        "SELECT id,period_month,product_id,product_name,target_qty FROM product_targets "
        "ORDER BY period_month, id"):
    print("   目标 id=%s %s pid=%s %s %s箱"
          % (r["id"], r["period_month"], r["product_id"], r["product_name"], r["target_qty"]))

print("\n" + "=" * 84)
print("E. 当期清单里到底有哪些商品（能否被 10 月目标命中）")
print("=" * 84)
tbls = [r[0] for r in con.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%forecast%'")]
print("  预报相关表:", tbls)
for t in tbls:
    cols = [r[1] for r in con.execute("PRAGMA table_info(%s)" % t)]
    print("   %-34s cols=%s" % (t, cols))

con.close()
print("\nDONE")
