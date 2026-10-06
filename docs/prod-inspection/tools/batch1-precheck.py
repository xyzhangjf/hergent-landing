#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
batch1-precheck.py —— 开发计划批次 1 的三项前置核查（**只读**）

对准开发计划《开发计划-侧栏重构与进销存-2026-10-06.md》§三 的三条前置核查：
  未验证项 #2  contacts.delivery_route 生产**是否真有值**（列存在 ≠ 有值）  → 批次 1.1
  未验证项 #3  contacts 里 type='supplier' 的**生产行数**（若 0，1.2 是"新功能"不是"补入口"） → 批次 1.2
  未验证项 #4  「临期预警」是否**已在别处以商品级实现**（本轮未穷举读端） → 批次 1.3

只读纪律：sqlite3 以 `?mode=ro` 打开；本脚本**不含任何写语句**。
不用 sqlite3 CLI（服务器上没有）⇒ 走 python 标准库。

用法（服务器上）：python3 batch1-precheck.py
"""
import json
import os
import sqlite3
import sys

DBS = [
    ("tenant_1",  "/opt/hergent-erp/tenant_1.db"),
    ("tenant_10", "/opt/hergent-erp/tenant_10.db"),
]

# ============ 只读连接 ============
def ro(path):
    uri = "file:%s?mode=ro" % path
    con = sqlite3.connect(uri, uri=True)
    con.row_factory = sqlite3.Row
    return con


def table_exists(con, name):
    r = con.execute(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?", (name,)
    ).fetchone()
    return r[0] > 0


def cols(con, name):
    try:
        return [r[1] for r in con.execute("PRAGMA table_info(%s)" % name).fetchall()]
    except Exception:
        return []


def scalar(con, sql, args=()):
    try:
        r = con.execute(sql, args).fetchone()
        return None if r is None else r[0]
    except Exception as e:
        return "ERR:%s" % e


def main():
    report = {}
    for label, path in DBS:
        if not os.path.exists(path):
            report[label] = {"_missing": True, "path": path}
            continue
        con = ro(path)
        d = {"path": path}
        try:
            # ---------- 1.1 delivery_route ----------
            if not table_exists(con, "contacts"):
                d["1_1"] = {"_no_table": "contacts"}
            else:
                cs = cols(con, "contacts")
                d["1_1"] = {
                    "column_exists": "delivery_route" in cs,
                    "col_type": next((r[2] for r in con.execute("PRAGMA table_info(contacts)").fetchall()
                                      if r[1] == "delivery_route"), None) if "delivery_route" in cs else None,
                    "contacts_total": scalar(con, "SELECT COUNT(*) FROM contacts"),
                    "delivery_route_nonempty":
                        scalar(con, "SELECT COUNT(*) FROM contacts WHERE COALESCE(delivery_route,'')<>''")
                        if "delivery_route" in cs else None,
                    "delivery_route_distinct_nonempty":
                        scalar(con, "SELECT COUNT(DISTINCT delivery_route) FROM contacts "
                                    "WHERE COALESCE(delivery_route,'')<>''")
                        if "delivery_route" in cs else None,
                    "sample_values":
                        [dict(r) for r in con.execute(
                            "SELECT id, name, type, delivery_route FROM contacts "
                            "WHERE COALESCE(delivery_route,'')<>'' LIMIT 8").fetchall()]
                        if "delivery_route" in cs else [],
                }

            # ---------- 1.2 type='supplier' ----------
            if not table_exists(con, "contacts"):
                d["1_2"] = {"_no_table": "contacts"}
            else:
                cs = cols(con, "contacts")
                by_type = [dict(r) for r in con.execute(
                    "SELECT COALESCE(type,'(null)') AS type, COUNT(*) AS n "
                    "FROM contacts GROUP BY COALESCE(type,'(null)') ORDER BY n DESC").fetchall()]
                d["1_2"] = {
                    "columns_present": {c: (c in cs) for c in
                                       ["type", "supplier_category", "bank_name",
                                        "bank_account", "business_license"]},
                    "by_type": by_type,
                    "supplier_and_both":
                        scalar(con, "SELECT COUNT(*) FROM contacts WHERE type IN ('supplier','both')"),
                }

            # ---------- 1.3 临期相关：products 列 ----------
            if not table_exists(con, "products"):
                d["1_3_products"] = {"_no_table": "products"}
            else:
                pcs = cols(con, "products")
                d["1_3_products"] = {
                    "has_expiry_alert_days": "expiry_alert_days" in pcs,
                    "expiry_in_columns": [c for c in pcs if "expir" in c.lower() or "shelf" in c.lower()
                                          or "alert" in c.lower()],
                    "products_total": scalar(con, "SELECT COUNT(*) FROM products"),
                    "sample_shelf_life": [dict(r) for r in con.execute(
                        "SELECT id, name, shelf_life_days FROM products LIMIT 5").fetchall()]
                    if "shelf_life_days" in pcs else [],
                }

            # ---------- 1.3 租户参数里的全局阈值 ----------
            for t in ("tenant_params", "params", "settings", "app_config", "system_config"):
                if table_exists(con, t):
                    tc = cols(con, t)
                    hit = scalar(con, "SELECT COUNT(*) FROM %s WHERE param_key LIKE '%%threshold%%'" % t) \
                        if "param_key" in tc else None
                    d.setdefault("1_3_params", []).append(
                        {"table": t, "columns": tc, "threshold_rows": hit})
        finally:
            con.close()
        report[label] = d

    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("FATAL: %s" % e, file=sys.stderr)
        sys.exit(1)
