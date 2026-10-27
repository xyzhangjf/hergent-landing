#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""`money_balanced` 浮点缺陷的**双算校验**（只读，不动数据）。

## 缺陷是什么

`db/queries/gl.py::gl_post()` 的判据是「借贷合计差 ≤ 0.01 就算平」。写成浮点就是：

    100.00 - 99.99 = 0.010000000000005116
    ⇒ 0.010000000000005116 <= 0.01 为假 ⇒ **拒单**

也就是说「恰好差 1 分」算不算平，取决于这两个金额在二进制里怎么表示 ——
同样的业务事实，有时过、有时不过，**而且看不出来为什么**。

## 为什么必须配这个脚本

修法（改成按整数分比较）会让一部分**过去被拒**的过账开始成功。这是**业务口径变更**，
不是重构：会计上"差 1 分能不能过"必须由人确认。所以在删改判据之前，先拿生产真实凭证明细
跑一遍新老判定，把"会翻案的是哪几张凭证"列清楚。

## 判据

- 老：`abs(dr - cr) <= 0.01`（浮点，受二进制表示影响）
- 新：`abs(to_cents(dr) - to_cents(cr)) <= 1`（整数分，确定性）

## 用法

    python3 dualcheck_money_balanced.py                 # 体检生产三个库
    python3 dualcheck_money_balanced.py --db /path/x.db # 只查一个库
    python3 dualcheck_money_balanced.py --json

退出码：0 = 无翻案；2 = 有凭证会从"拒"变"过"（需要人拍板）。
"""
import argparse
import json
import os
import sqlite3
import sys

APP = "/opt/hergent-erp"
TARGETS = ["erp.db", "tenant_1.db", "tenant_10.db"]


def to_cents(x):
    try:
        return int(round(round(float(x or 0), 2) * 100))
    except (ValueError, TypeError):
        return 0


def old_verdict(dr, cr):
    return abs(float(dr or 0) - float(cr or 0)) <= 0.01


def new_verdict(dr, cr):
    return abs(to_cents(dr) - to_cents(cr)) <= 1


def scan(path):
    """→ (vouchers, disagreements)。凭证粒度：同一次 gl_post 写入的那批行。"""
    out = {"db": os.path.basename(path), "vouchers": 0, "rows": 0,
           "old_ok": 0, "new_ok": 0, "diff": []}
    try:
        c = sqlite3.connect("file:%s?mode=ro" % path, uri=True)
    except Exception as e:
        out["error"] = str(e)[:120]
        return out
    try:
        has = c.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='gl_entries'").fetchone()
        if not has:
            out["error"] = "无 gl_entries 表"
            return out
        rows = c.execute(
            "SELECT ref_type, ref_id, IFNULL(description,'') d, IFNULL(period,'') p,"
            " IFNULL(created_at,'') t, SUM(IFNULL(debit,0)) dr, SUM(IFNULL(credit,0)) cr"
            " FROM gl_entries GROUP BY ref_type, ref_id, d, p, t").fetchall()
        out["rows"] = c.execute("SELECT COUNT(*) FROM gl_entries").fetchone()[0]
    finally:
        c.close()

    out["vouchers"] = len(rows)
    for ref_type, ref_id, desc, period, ts, dr, cr in rows:
        o, n = old_verdict(dr, cr), new_verdict(dr, cr)
        out["old_ok"] += 1 if o else 0
        out["new_ok"] += 1 if n else 0
        if o != n:
            out["diff"].append({
                "ref_type": ref_type, "ref_id": ref_id, "period": period,
                "created_at": ts, "desc": (desc or "")[:40],
                "debit": round(dr, 6), "credit": round(cr, 6),
                "gap": round(float(dr) - float(cr), 12),
                "gap_cents": to_cents(dr) - to_cents(cr),
                "old": "平" if o else "不平", "new": "平" if n else "不平",
            })
    return out


def boundary_cases():
    """判据分界上的样本：钉住"恰好差 1 分"到底怎么判。"""
    cases = [
        (100.00, 99.99), (99.99, 100.00), (0.10 + 0.20, 0.30),
        (1234.56, 1234.55), (1234.56, 1234.54), (0.00, 0.01),
        (2.675, 2.66), (1000000.00, 999999.99),
    ]
    rows = []
    for a, b in cases:
        rows.append({"dr": a, "cr": b,
                     "gap": round(float(a) - float(b), 12),
                     "old": "平" if old_verdict(a, b) else "不平",
                     "new": "平" if new_verdict(a, b) else "不平"})
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", help="只查指定的库文件")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()

    paths = [a.db] if a.db else [os.path.join(APP, f) for f in TARGETS]
    results = [scan(p) for p in paths if os.path.exists(p)]
    cases = boundary_cases()

    if a.json:
        print(json.dumps({"boundary": cases, "dbs": results}, ensure_ascii=False, indent=2))
        return 2 if any(r["diff"] for r in results) else 0

    print("=" * 96)
    print("money_balanced 双算校验（只读）  老: |dr-cr|<=0.01   新: |分差|<=1")
    print("=" * 96)
    print("\n判据分界样本：")
    print("  %-14s %-14s %-16s %-6s %-6s" % ("借", "贷", "差额(浮点原值)", "老", "新"))
    for r in cases:
        mark = "  ← 翻案" if r["old"] != r["new"] else ""
        print("  %-14s %-14s %-16s %-6s %-6s%s"
              % (r["dr"], r["cr"], r["gap"], r["old"], r["new"], mark))

    print("\n生产凭证明细：")
    for r in results:
        if r.get("error"):
            print("  %-14s %s" % (r["db"], r["error"]))
            continue
        print("  %-14s 凭证 %3d 个 / 分录 %3d 行 / 老判平 %3d / 新判平 %3d / 翻案 %d"
              % (r["db"], r["vouchers"], r["rows"], r["old_ok"], r["new_ok"], len(r["diff"])))
        for d in r["diff"]:
            print("      %s#%s %s  借%s 贷%s 差%s(%d分)  %s → %s"
                  % (d["ref_type"], d["ref_id"], d["period"], d["debit"], d["credit"],
                     d["gap"], d["gap_cents"], d["old"], d["new"]))

    bad = any(r["diff"] for r in results)
    print("\n结论：%s" % ("有凭证会从「拒」变「过」—— 属业务口径变更，需人工拍板" if bad
                        else "存量凭证判定**零翻案**；此修复只影响今后「恰好差 1 分」的新过账"))
    return 2 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
