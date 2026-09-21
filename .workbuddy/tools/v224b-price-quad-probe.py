#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v224b 只读：把「厂价 / 进价 / 分销价 / 售价」四列摆在**同一张表**上看清它们的关系。

承接 v224 发现：46 个商品两列都有值且**不相等**，比值恰好 = perCase ÷ 0.9。
本探针回答：
  R1 这 46 行上，`purchase_price` 与 `dist_price` 是不是同一个数？
  R2 厂价 / 进价 / 分销价 的换算关系（逐个商品验算 0.9 这个系数是否恒定）
  R3 没有 large_ratio 的商品，perCase 从规格怎么来（用于验证上面的换算）
  R4 期次 0 金额现状（修正 period_id 不存在 —— 期次经 submission_id 关联）
只读，零写入。
"""
import re
import sqlite3
import sys

TDB = sys.argv[1] if len(sys.argv) > 1 else "/opt/hergent-erp/tenant_1.db"
DB = sqlite3.connect("file:" + TDB + "?mode=ro", uri=True)
DB.row_factory = sqlite3.Row


def per_case_fallback(spec, unit):
    """复刻 Forecast.vue::perCase 的规格回退（无档案换算时）。"""
    s = "" if spec is None else str(spec)
    segs = []
    for m in re.finditer(r"(\d+(?:\.\d+)?)\s*([^\d\s*×xX·]*)", s):
        n = float(m.group(1))
        u = (m.group(2) or "").strip()
        if n > 0:
            segs.append((n, u))
    if not segs:
        return 0.0
    last_n, last_u = segs[-1]
    if not last_u:
        return last_n
    u0 = "" if unit is None else str(unit).strip()
    if not u0 or u0 == last_u:
        return last_n
    for i, (n, u) in enumerate(segs):
        if u == u0 and i < len(segs) - 1:
            p = 1.0
            for n2, _ in segs[i:]:
                p *= n2
            return p
    return last_n


def hr(t):
    print("\n" + "=" * 100)
    print("## " + t)


both = DB.execute(
    "SELECT id, name, spec, unit, large_ratio, medium_ratio, "
    "       factory_price fp, purchase_price pp, dist_price dp, sale_price sp "
    "FROM products WHERE factory_price>0 AND purchase_price>0 ORDER BY id"
).fetchall()

hr("R1+R2  46 个「两列都有值」商品：四价并排 + 换算验算")
print("%-6s %-30s %-8s %-9s %-8s %-8s %-9s %-6s %-9s %-9s %-7s %s"
      % ("id", "name", "spec", "pc(规格)", "厂价", "进价", "分销价", "售价",
         "进价*pc", "进价*pc/厂价", "pp==dp", "unit/lr"))
ok09 = 0
okdp = 0
for r in both:
    pc = per_case_fallback(r["spec"], r["unit"])
    fp = float(r["fp"])
    pp = float(r["pp"])
    dp = float(r["dp"] or 0)
    sp = float(r["sp"] or 0)
    k = (pp * pc / fp) if fp else 0
    same_dp = "是" if dp and abs(pp - dp) < 0.005 else ("否(%.2f)" % dp)
    if abs(k - 0.9) < 0.02:
        ok09 += 1
    if dp and abs(pp - dp) < 0.005:
        okdp += 1
    print("%-6s %-30s %-8s %-9.3f %-8.2f %-8.2f %-9.2f %-6.2f %-9.3f %-9.4f %-7s %s/%s"
          % (r["id"], str(r["name"])[:30], str(r["spec"])[:8], pc, fp, pp, dp, sp,
             pp * pc, k, same_dp, r["unit"], r["large_ratio"]))
print()
print("「进价 × perCase ÷ 厂价 ≈ 0.9」成立的行数 = %d / %d" % (ok09, len(both)))
print("「进价 == 分销价」成立的行数            = %d / %d" % (okdp, len(both)))

hr("R3  仅厂价有值(105 个) / 仅进价有值(10 个)：量纲自检")
for tag, where in (("仅厂价", "factory_price>0 AND (purchase_price IS NULL OR purchase_price<=0)"),
                   ("仅进价", "(factory_price IS NULL OR factory_price<=0) AND purchase_price>0")):
    print("--- %s ---" % tag)
    rs = DB.execute(
        "SELECT id, name, spec, unit, large_ratio, factory_price fp, purchase_price pp "
        "FROM products WHERE " + where + " AND is_active=1 ORDER BY id LIMIT 8"
    ).fetchall()
    for r in rs:
        pc = per_case_fallback(r["spec"], r["unit"])
        fp = float(r["fp"] or 0)
        pp = float(r["pp"] or 0)
        print("   id=%-6s %-30s spec=%-12s unit=%-4s lr=%-4g pc=%-7.3f fp=%-9.2f pp=%-8.2f"
              % (r["id"], str(r["name"])[:30], str(r["spec"])[:12], r["unit"],
                 float(r["large_ratio"] or 0), pc, fp, pp))

hr("R4  期次 0 金额现状（期次经 submission_id 关联）")
tabs = {r[0] for r in DB.execute("SELECT name FROM sqlite_master WHERE type='table'")}
have = "forecast_submissions" in tabs
print("forecast_submissions 存在 =", have)
if have:
    scols = {r[1] for r in DB.execute("PRAGMA table_info(forecast_submissions)")}
    print("列 =", sorted(scols))
print("--- 各期次金额规模（按 submission 关联）---")
q = """
SELECT s.period_id AS pid, COUNT(*) AS c, SUM(COALESCE(i.amount,0)) AS amt,
       SUM(COALESCE(i.quantity,0)) AS qty
FROM forecast_submission_items i JOIN forecast_submissions s ON s.id = i.submission_id
GROUP BY s.period_id ORDER BY s.period_id
"""
tot = 0.0
for r in DB.execute(q):
    tot += r["amt"] or 0
    print("   period_id=%-5s 行=%-5d 数量=%10.2f 金额=%14.2f" % (r["pid"], r["c"], r["qty"], r["amt"]))
print("   合计金额 = %.2f" % tot)

print("--- 期次 0 前 6 行原样 ---")
qb = """
SELECT i.* , s.period_id AS pid FROM forecast_submission_items i
JOIN forecast_submissions s ON s.id = i.submission_id
WHERE s.period_id=0 LIMIT 6
"""
for r in DB.execute(qb):
    d = dict(r)
    print("  ", {k: d[k] for k in sorted(d) if k in (
        "id", "submission_id", "pid", "product_id", "product_name", "spec", "unit",
        "quantity", "price", "amount", "barcode")})
print()
print("只读探针结束，零写入。")
