#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v224 只读：**「进价 ≡ 厂价」在真实数据上成立吗？**

用户 2026-09-14（v165）与 2026-09-21（v224）两次定调「进价跟厂价是一个意思」。
但 products 表里是**两列**：`factory_price` 与 `purchase_price`。
若两者量纲不同（一个元/箱、一个元/小单位），那「统一叫进价」的界面就是在说谎。

本探针回答四问（全部只读、零写入）：
  Q1 两列的有值/空值交叉分布（启用商品）
  Q2 **两列都有值**的商品上，`factory_price / purchase_price` 的分布
      ≈ large_ratio ⇒ 不同量纲（一列是元/箱、另一列是元/小单位）
      ≈ 1           ⇒ 同量纲（真的一回事，只是重复存）
  Q3 `factory_price=0` 而 `purchase_price>0`（= 前端 factoryPrice 回退命中）的商品清单
  Q4 期次 0（历史导入批次）的 amount 现状 vs 新口径应有值

用法：python3 v224-price-identity-probe.py /opt/hergent-erp/tenant_1.db
"""
import sqlite3
import sys
from collections import Counter

TDB = sys.argv[1] if len(sys.argv) > 1 else "/opt/hergent-erp/tenant_1.db"
DB = sqlite3.connect("file:" + TDB + "?mode=ro", uri=True)
DB.row_factory = sqlite3.Row


def cols(t):
    return {r[1] for r in DB.execute("PRAGMA table_info(%s)" % t)}


def hr(t):
    print("\n" + "=" * 92)
    print("## " + t)


hr("Q1  两列有值/空值交叉分布（products）")
pc = cols("products")
need = {"factory_price", "purchase_price", "large_ratio", "medium_ratio", "unit",
        "large_unit", "medium_unit", "spec", "name", "id"}
missing = need - pc
if missing:
    print("!! products 缺列:", missing)
rows = DB.execute(
    "SELECT id, name, spec, unit, large_unit, medium_unit, large_ratio, medium_ratio, "
    "       factory_price AS fp, purchase_price AS pp, sale_price AS sp, dist_price AS dp, "
    "       is_active "
    "FROM products"
).fetchall()
print("products 总行数 =", len(rows))
act = [r for r in rows if (r["is_active"] in (1, "1", True))]
print("其中 is_active =", len(act))
print("（下面统计**全部**行，并给出启用子集）")

cnt = Counter()
for r in rows:
    fp = float(r["fp"] or 0)
    pp = float(r["pp"] or 0)
    k = ("fp>0" if fp > 0 else "fp=0") + " / " + ("pp>0" if pp > 0 else "pp=0")
    cnt[k] += 1
for k, v in sorted(cnt.items()):
    print("  %-18s %d" % (k, v))

cnt2 = Counter()
for r in act:
    fp = float(r["fp"] or 0)
    pp = float(r["pp"] or 0)
    k = ("fp>0" if fp > 0 else "fp=0") + " / " + ("pp>0" if pp > 0 else "pp=0")
    cnt2[k] += 1
print("  --- 仅启用 ---")
for k, v in sorted(cnt2.items()):
    print("  %-18s %d" % (k, v))

hr("Q2  两列都有值 ⇒ factory_price / purchase_price 比值分布")
both = [r for r in rows if float(r["fp"] or 0) > 0 and float(r["pp"] or 0) > 0]
print("两列都有值的行数 =", len(both))
buckets = Counter()
detail = []
for r in both:
    fp = float(r["fp"])
    pp = float(r["pp"])
    ratio = fp / pp if pp else 0
    lr = float(r["large_ratio"] or 0)
    if abs(ratio - 1) < 0.02:
        b = "≈1   (同量纲 ⇒ 真是一回事)"
    elif lr > 0 and abs(ratio - lr) / lr < 0.06:
        b = "≈large_ratio=%g (不同量纲)" % lr
    elif abs(ratio - 10) < 0.6:
        b = "≈10"
    elif abs(ratio - 12) < 0.7:
        b = "≈12"
    elif abs(ratio - 24) < 1.5:
        b = "≈24"
    else:
        b = "其他"
    buckets[b] += 1
    detail.append((ratio, r["id"], r["name"], fp, pp, lr, r["unit"], r["large_unit"]))
for k, v in buckets.most_common():
    print("  %-34s %d" % (k, v))
print("  --- 前 15 行样本（ratio, id, name, fp, pp, lr, unit, large_unit）---")
for d in sorted(detail, key=lambda x: -x[0])[:15]:
    print("   %8.3f | id=%-6s %-30s fp=%-9.2f pp=%-9.2f lr=%-5g unit=%-4s lu=%s"
          % (d[0], d[1], str(d[2])[:30], d[3], d[4], d[5], d[6], d[7]))

hr("Q3  仅 purchase_price 有值（= factoryPrice 回退命中）")
fb = [r for r in act if float(r["fp"] or 0) <= 0 and float(r["pp"] or 0) > 0]
print("启用商品中命中数 =", len(fb))
for r in fb:
    print("   id=%-6s %-32s pp=%-9.2f lr=%-5g mr=%-5g unit=%-4s lu=%-4s mu=%-4s spec=%r"
          % (r["id"], str(r["name"])[:32], float(r["pp"]), float(r["large_ratio"] or 0),
             float(r["medium_ratio"] or 0), r["unit"], r["large_unit"], r["medium_unit"], r["spec"]))

hr("Q4  期次 0 的 amount 现状")
tables = {r[0] for r in DB.execute("SELECT name FROM sqlite_master WHERE type='table'")}
print("forecast_submission_items 存在 =", "forecast_submission_items" in tables)
ic = cols("forecast_submission_items")
print("列 =", sorted(ic))
n0 = DB.execute("SELECT COUNT(*) FROM forecast_submission_items WHERE period_id=0").fetchone()[0]
nt = DB.execute("SELECT COUNT(*) FROM forecast_submission_items").fetchone()[0]
print("period_id=0 行数 = %d / 全表 %d" % (n0, nt))
s0 = DB.execute(
    "SELECT COUNT(*) c, SUM(COALESCE(amount,0)) s, SUM(COALESCE(quantity,0)) q "
    "FROM forecast_submission_items WHERE period_id=0"
).fetchone()
print("期次0: 行数=%d  金额合计=%.2f  数量合计=%.2f" % (s0["c"], s0["s"], s0["q"]))
if "product_id" in ic:
    j = DB.execute(
        "SELECT COUNT(*) c FROM forecast_submission_items i WHERE i.period_id=0 "
        "AND i.product_id IS NOT NULL AND i.product_id<>0"
    ).fetchone()[0]
    print("期次0 中 product_id 非空行数 =", j)
else:
    print("!! 无 product_id 列")
print("--- 期次0 前 8 行 ---")
for r in DB.execute("SELECT * FROM forecast_submission_items WHERE period_id=0 LIMIT 8"):
    d = dict(r)
    print("  ", {k: d[k] for k in sorted(d) if k in (
        "id", "period_id", "product_id", "product_name", "spec", "unit",
        "quantity", "price", "amount", "barcode")})
print("--- 期次0 按 unit 分组 ---")
for r in DB.execute(
        "SELECT unit, COUNT(*) c, SUM(COALESCE(amount,0)) s FROM forecast_submission_items "
        "WHERE period_id=0 GROUP BY unit ORDER BY c DESC"):
    print("   unit=%-6r 行=%-5d 金额=%12.2f" % (r["unit"], r["c"], r["s"]))

hr("Q5  各期次金额规模（判断影响面）")
for r in DB.execute(
        "SELECT period_id, COUNT(*) c, SUM(COALESCE(amount,0)) s FROM forecast_submission_items "
        "GROUP BY period_id ORDER BY period_id"):
    print("   period_id=%-5s 行=%-5d 金额=%14.2f" % (r["period_id"], r["c"], r["s"]))
print()
print("只读探针结束，零写入。")
