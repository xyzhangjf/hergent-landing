#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v279 schema 终态核实 —— 只读。逐库核对 period_id 列 + 新旧索引切换。"""
import sqlite3
import glob
import os

ROOT = "/opt/hergent-erp"
OLD = {"uq_fea_period_prod_emp", "idx_fea_period"}
NEW = {"uq_fea_periodid_prod_emp", "idx_fea_periodid_prod", "idx_fea_emp"}
KEEP = "idx_fea_emp"

dbs = ["erp.db"] + sorted(os.path.basename(p) for p in glob.glob(os.path.join(ROOT, "tenant_*.db")))
bad = []
print("%-16s %-9s %-10s %s" % ("DB", "period_id", "旧索引残留", "索引清单"))
print("-" * 78)
for db in dbs:
    p = os.path.join(ROOT, db)
    try:
        c = sqlite3.connect("file:%s?mode=ro" % p, uri=True)
        has_tbl = c.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='forecast_extra_alloc'"
        ).fetchone()[0]
        if not has_tbl:
            print("%-16s %-9s %-10s %s" % (db, "无表", "-", "(跳过)"))
            c.close()
            continue
        cols = [r[1] for r in c.execute("PRAGMA table_info(forecast_extra_alloc)")]
        idx = sorted(r[1] for r in c.execute("PRAGMA index_list(forecast_extra_alloc)"))
        left = sorted(set(idx) & OLD)
        need = sorted(NEW - set(idx))
        n = c.execute("SELECT COUNT(*) FROM forecast_extra_alloc").fetchone()[0]
        # period_id 是否真的可读（不是只建了列）
        probe = "OK"
        try:
            c.execute("SELECT period_id, COUNT(*) FROM forecast_extra_alloc GROUP BY period_id").fetchall()
        except Exception as e:
            probe = "READ_FAIL: %s" % e
        flag = ""
        if left or need or probe != "OK":
            flag = "  <== 异常"
            bad.append((db, left, need, probe))
        print("%-16s %-9s %-10s %s%s" % (db, "有" if "period_id" in cols else "无",
                                         left or "无", idx, flag))
        print("%-16s rows=%d  probe=%s" % ("", n, probe))
        c.close()
    except Exception as e:
        print("%-16s ERR %s" % (db, e))
        bad.append((db, "ERR", str(e), ""))

print("-" * 78)
if bad:
    print("异常库：")
    for b in bad:
        print("  ", b)
else:
    print("结论：全部库 period_id 列就位、旧窗口索引已清、新 period_id 索引已建、列可读。")
