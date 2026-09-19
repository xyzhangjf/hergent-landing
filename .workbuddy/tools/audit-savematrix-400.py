#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""只读审计（第二版）：定位「2026-09-18 那次 save-matrix 400」属于哪个租户。

第一版用本地时间 '2026-09-18 19:4%' 查 created_at 命中 0 —— 而 `forecast_submissions.created_at`
的默认值是 `CURRENT_TIMESTAMP`（**UTC**）⇒ 本地 19:41 = UTC 11:41。本版两种口径都打，
并把每个租户的「导入报单时间桶」与「客户名册规模(all_units)」一并列出，便于人工对齐。
"""
import glob
import os
import sqlite3

BASE = "/opt/hergent-erp"
out = []
for path in sorted(glob.glob(os.path.join(BASE, "tenant_*.db"))):
    tid = os.path.basename(path)[len("tenant_"):-len(".db")]
    try:
        c = sqlite3.connect("file:%s?mode=ro" % path, uri=True)
        c.row_factory = sqlite3.Row
        n_all = c.execute("SELECT COUNT(*) FROM forecast_submissions").fetchone()[0]
        if not n_all:
            c.close()
            continue
        all_units = c.execute(
            "SELECT COUNT(DISTINCT store_name) FROM forecast_submissions "
            "WHERE status!='rejected' AND store_name IS NOT NULL AND store_name!=''").fetchone()[0]
        # 2026-09-18 那天写入的『导入』报单，按小时桶
        buckets = c.execute(
            "SELECT substr(created_at,1,13) h, COUNT(*) n FROM forecast_submissions "
            "WHERE role='导入' AND substr(created_at,1,10)='2026-09-18' "
            "GROUP BY h ORDER BY h").fetchall()
        per = c.execute(
            "SELECT period_id, COUNT(DISTINCT store_name) u FROM forecast_submissions "
            "WHERE role='导入' GROUP BY period_id ORDER BY u ASC").fetchall()
        c.close()
        out.append((tid, all_units, [(r["h"], r["n"]) for r in buckets],
                    [(r["period_id"], r["u"]) for r in per]))
    except Exception:
        pass

print("tenant_id | all_units(客户名册) | 09-18 导入报单小时桶(UTC) | 各期次客户列数(period_id,units)")
print("-" * 100)
for tid, au, b, per in out:
    print("tenant_%-5s| all_units=%-4s | %s | %s" % (tid, au, b if b else '(无)', per))
