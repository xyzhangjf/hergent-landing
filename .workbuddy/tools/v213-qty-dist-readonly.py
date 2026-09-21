#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""只读核查：各租户库预报明细的 quantity 分布 —— 用于决定「统一数量上限」取多少。
   只读（mode=ro），不写任何库。"""
import glob
import os
import sqlite3

print("== forecast_submission_items.quantity 分布（只读） ==")
for f in sorted(glob.glob("/opt/hergent-erp/tenant_*.db")):
    base = os.path.basename(f)
    try:
        con = sqlite3.connect("file:%s?mode=ro" % f, uri=True)
        con.row_factory = sqlite3.Row
        try:
            r = con.execute(
                "SELECT COUNT(*) AS n, MAX(quantity) AS mx, MIN(quantity) AS mn,"
                " SUM(CASE WHEN quantity>10000 THEN 1 ELSE 0 END) AS gt10000,"
                " SUM(CASE WHEN quantity>99999 THEN 1 ELSE 0 END) AS gt99999,"
                " SUM(CASE WHEN quantity>999999 THEN 1 ELSE 0 END) AS gt999999,"
                " SUM(CASE WHEN quantity<0 THEN 1 ELSE 0 END) AS neg,"
                " SUM(CASE WHEN quantity<>CAST(quantity AS INTEGER) THEN 1 ELSE 0 END) AS nonint"
                " FROM forecast_submission_items"
            ).fetchone()
        except sqlite3.OperationalError as e:
            print("  %-16s SKIP %s" % (base, e))
            con.close()
            continue
        if not r["n"]:
            print("  %-16s items=0" % base)
            con.close()
            continue
        print("  %-16s items=%-6d min=%-6s max=%-8s >10000=%-4s >99999=%-4s >999999=%-4s 负数=%-3s 非整数=%s"
              % (base, r["n"], r["mn"], r["mx"], r["gt10000"], r["gt99999"], r["gt999999"], r["neg"], r["nonint"]))
        # 名称缺失情况（save_matrix 会补 商品#id 落库）
        try:
            r2 = con.execute(
                "SELECT SUM(CASE WHEN product_name IS NULL OR TRIM(product_name)='' THEN 1 ELSE 0 END) AS noname,"
                " SUM(CASE WHEN product_name LIKE '商品#%' THEN 1 ELSE 0 END) AS placeholder"
                " FROM forecast_submission_items"
            ).fetchone()
            print("  %-16s 名称为空=%-5s 名称是'商品#id'占位=%-5s" % ("", r2["noname"], r2["placeholder"]))
        except sqlite3.OperationalError as e:
            print("  %-16s 名称核查 SKIP %s" % ("", e))
        con.close()
    except Exception as e:  # noqa: BLE001
        print("  %-16s ERR %s" % (base, e))

print()
print("== forecast_submissions 规模与 status/role 分布 ==")
for f in sorted(glob.glob("/opt/hergent-erp/tenant_*.db")):
    base = os.path.basename(f)
    try:
        con = sqlite3.connect("file:%s?mode=ro" % f, uri=True)
        rows = con.execute("SELECT role, status, COUNT(*) AS n FROM forecast_submissions GROUP BY role, status ORDER BY n DESC").fetchall()
        total = con.execute("SELECT COUNT(*) FROM forecast_submissions").fetchone()[0]
        print("  %-16s submissions=%d  %s" % (base, total, rows))
        con.close()
    except Exception as e:  # noqa: BLE001
        print("  %-16s ERR %s" % (base, e))

print()
print("== periods 上「同一期次被不同 user 写过的痕迹」（并发冲突的现实基础） ==")
for f in sorted(glob.glob("/opt/hergent-erp/tenant_*.db")):
    base = os.path.basename(f)
    try:
        con = sqlite3.connect("file:%s?mode=ro" % f, uri=True)
        rows = con.execute(
            "SELECT period_id, COUNT(DISTINCT user_id) AS users, COUNT(*) AS n,"
            " MIN(created_at) AS first_at, MAX(created_at) AS last_at"
            " FROM forecast_submissions WHERE role='导入' GROUP BY period_id"
            " HAVING COUNT(*)>0 ORDER BY period_id DESC LIMIT 12"
        ).fetchall()
        if rows:
            print("  %s" % base)
            for r in rows:
                print("     period_id=%-5s 不同user=%-3s 行数=%-5s %s → %s" % r)
        con.close()
    except Exception as e:  # noqa: BLE001
        print("  %-16s ERR %s" % (base, e))
