#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v224c 只读：期次 0 的 `quantity` 到底是「散数」还是「箱数」？

这是唯一决定「942,862 要不要重算」的问题，必须在写库前定案。
判据（三条互相独立）：
  D1 `unit` 是不是散数单位（瓶/杯/组/条/袋/包/盒…）—— 若是，qty 就是散数
  D2 `qty / perCase` 的分布 —— 若大量为 1.000，说明「一家店正好订 1 箱」，可疑；
     若分布分散（0.5/0.75/1/1.5/3/5…），说明是自由填的散数
  D3 同样统计**通过新 UI 录的期次 14/15**（口径已知 = 散数）作对照组
只读，零写入。
"""
import re
import sqlite3
import sys
from collections import Counter

TDB = sys.argv[1] if len(sys.argv) > 1 else "/opt/hergent-erp/tenant_1.db"
DB = sqlite3.connect("file:" + TDB + "?mode=ro", uri=True)
DB.row_factory = sqlite3.Row


def per_case(spec, unit, arc):
    lr = float((arc["large_ratio"] if arc else 0) or 0)
    if lr > 0:
        u0 = str(unit if unit is not None else "").strip()
        lu = str((arc["large_unit"] if arc else "") or "").strip()
        mu = str((arc["medium_unit"] if arc else "") or "").strip()
        mr = float((arc["medium_ratio"] if arc else 0) or 0)
        if u0 and lu and u0 == lu:
            return 1.0
        if u0 and mu and u0 == mu and mr > 0:
            return lr / mr
        return lr
    s = str(spec if spec is not None else "")
    segs = []
    for m in re.finditer(r"(\d+(?:\.\d+)?)\s*([^\d\s*×xX·]*)", s):
        n = float(m.group(1))
        if n > 0:
            segs.append((n, (m.group(2) or "").strip()))
    if not segs:
        return 0.0
    last_n, last_u = segs[-1]
    if not last_u:
        return last_n
    u0 = str(unit if unit is not None else "").strip()
    if not u0 or u0 == last_u:
        return last_n
    for i, (n, u) in enumerate(segs):
        if u == u0 and i < len(segs) - 1:
            p = 1.0
            for n2, _ in segs[i:]:
                p *= n2
            return p
    return last_n


prods = {r["id"]: dict(r) for r in DB.execute(
    "SELECT id, name, spec, unit, large_unit, medium_unit, large_ratio, medium_ratio, "
    "       factory_price, purchase_price FROM products")}

for pid, label in ((0, "期次 0（历史导入）"), (14, "期次 14（新 UI）"), (15, "期次 15（新 UI）"),
                   (9, "期次 9"), (12, "期次 12")):
    rows = DB.execute(
        "SELECT i.* FROM forecast_submission_items i "
        "JOIN forecast_submissions s ON s.id=i.submission_id WHERE s.period_id=? ORDER BY i.id",
        (pid,)).fetchall()
    if not rows:
        continue
    print("\n" + "=" * 96)
    print("## %s   行数=%d" % (label, len(rows)))
    print("--- D1  unit 分布（散数单位 = 瓶/杯/组/条/袋/包/盒/提；箱单位 = 件/箱）---")
    uc = Counter(str(r["unit"]) for r in rows)
    for u, c in uc.most_common():
        tag = "散数单位" if u not in ("件", "箱") else "★箱单位"
        print("     unit=%-6r %-5d  %s" % (u, c, tag))
    print("--- D2  qty / perCase 分布 ---")
    dist = Counter()
    bad = []
    for r in rows:
        p = prods.get(r["product_id"]) or {"spec": r["spec"], "unit": r["unit"],
                                           "large_ratio": 0, "medium_ratio": 0}
        pc = per_case(p["spec"], r["unit"], p)
        q = float(r["quantity"] or 0)
        if not (pc > 0):
            bad.append((r["id"], r["product_name"], q, p["spec"]))
            continue
        d = q / pc
        if abs(d - round(d)) < 1e-9:
            dist["整 %d" % round(d)] += 1
        else:
            dist["%.2f（非整）" % d] += 1
    for k, c in sorted(dist.items(), key=lambda x: (-x[1], x[0]))[:16]:
        print("     qty/pc = %-14s %d 行" % (k, c))
    if bad:
        print("     ⚠️ 换算不出来的行 %d 条（前 6）：" % len(bad))
        for b in bad[:6]:
            print("        item=%s %-28s qty=%g spec=%r" % (b[0], str(b[1])[:28], b[2], b[3]))
    qs = sorted(float(r["quantity"] or 0) for r in rows)
    print("--- qty 值域：min=%g 中位=%g max=%g" % (qs[0], qs[len(qs) // 2], qs[-1]))

print("\n" + "=" * 96)
print("## 关键旁证：period=0 的 price 与档案厂价是否逐字相等")
n_ok = n_tot = 0
for r in DB.execute(
        "SELECT i.product_id, i.price, p.factory_price fp FROM forecast_submission_items i "
        "JOIN forecast_submissions s ON s.id=i.submission_id "
        "JOIN products p ON p.id=i.product_id WHERE s.period_id=0"):
    n_tot += 1
    if abs(float(r["price"] or 0) - float(r["fp"] or 0)) < 0.005:
        n_ok += 1
print("   price == 档案 factory_price 的行数 = %d / %d" % (n_ok, n_tot))
print("   ⇒ 若全中，说明 price 就是「元/箱」的厂价，那 amount = qty × price 只有当 qty 是箱数才成立")
print()
print("只读探针结束，零写入。")
