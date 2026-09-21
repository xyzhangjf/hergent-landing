#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v224 生产**只读**勘察：部署前要知道的两件事。

① 存量 `(store_id, period_id)` 是否已经有多行？
   v224 把幂等键改成「一店一期一单」后，`replace` 只会命中 `ORDER BY id DESC LIMIT 1`
   的那一行 —— 若库里**本来就存在**同店同期次的多行（旧键按人判重留下的），
   改完之后那些老行会**留在原地不参与后续更新**，表现为"汇总里这一店有两份"。
   所以必须先数清楚，再决定要不要清理（清理属写操作，需用户显式授权）。

② 目标表当前有没有 `updated_by` / `updated_at` 列？（应为无 —— 部署后由
   `_ensure_forecast_tables` 的 ALTER 补上；这里先记基线。）

🔴 本脚本全程 `mode=ro` 只读连接，不做任何写操作。
"""
import glob
import os
import sqlite3
import sys

ROOT = "/opt/hergent-erp"


def main():
    dbs = sorted(glob.glob(os.path.join(ROOT, "tenant_*.db")))
    print("=== 只读勘察 %d 个租户库 ===" % len(dbs))
    for p in dbs:
        name = os.path.basename(p)
        try:
            con = sqlite3.connect("file:%s?mode=ro" % p, uri=True)
        except Exception as e:
            print("[%s] 打不开：%s" % (name, e))
            continue
        try:
            cols = {r[1] for r in con.execute("PRAGMA table_info(forecast_submissions)")}
            if not cols:
                print("[%s] 无 forecast_submissions 表" % name)
                continue
            tot = con.execute("SELECT COUNT(*) FROM forecast_submissions").fetchone()[0]
            live = con.execute(
                "SELECT COUNT(*) FROM forecast_submissions WHERE store_id>0").fetchone()[0]
            dup = con.execute(
                "SELECT store_id, period_id, COUNT(*) c, GROUP_CONCAT(id) "
                "FROM forecast_submissions WHERE store_id>0 AND period_id>0 "
                "GROUP BY store_id, period_id HAVING c>1 ORDER BY c DESC LIMIT 10").fetchall()
            ndup = con.execute(
                "SELECT COUNT(*) FROM (SELECT 1 FROM forecast_submissions "
                "WHERE store_id>0 AND period_id>0 GROUP BY store_id, period_id HAVING COUNT(*)>1)"
            ).fetchone()[0]
            print("\n[%s] 主表 %d 行（其中 store_id>0 的 %d 行）" % (name, tot, live))
            print("        新列 updated_by/updated_at: %s"
                  % ("有" if {"updated_by", "updated_at"} <= cols else "**无**（部署后补）"))
            print("        同店同期次**多行**的组数：%d" % ndup)
            for r in dup:
                print("          store=%s period=%s 共 %s 行 -> id %s" % (r[0], r[1], r[2], r[3]))
            if ndup == 0:
                print("        ✓ 无存量重复 ⇒ v224 改键后不会出现「两份」")
        finally:
            con.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
