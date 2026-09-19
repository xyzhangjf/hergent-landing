#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""只读：tenant_1 各期次的客户列实际构成 —— 重点是正在被编辑的那几期（9 / 12 / 13 / 0）
以及「永诺旗舰店」在哪几期有报单。用于判断「删一列就 400」是否可能。"""
import sqlite3

path = "/opt/hergent-erp/tenant_1.db"
c = sqlite3.connect("file:%s?mode=ro" % path, uri=True)
c.row_factory = sqlite3.Row

print("=== forecast_periods ===")
for r in c.execute("SELECT id,name,order_start,order_end,status FROM forecast_periods ORDER BY id").fetchall():
    print("  id=%-3s %-16s %s ~ %s  [%s]" % (r["id"], r["name"], r["order_start"], r["order_end"], r["status"]))

print()
print("=== 各期次 × 客户（role / status 分组） ===")
rows = c.execute(
    "SELECT period_id, role, status, store_name, COUNT(*) n FROM forecast_submissions "
    "WHERE store_name IS NOT NULL AND store_name != '' "
    "GROUP BY period_id, role, status, store_name ORDER BY period_id, role, store_name").fetchall()
cur = None
for r in rows:
    k = (r["period_id"], r["role"], r["status"])
    if k != cur:
        cur = k
        print("  period_id=%-4s role=%-6s status=%-10s" % k)
    print("        %-24s %d" % (r["store_name"], r["n"]))

print()
print("=== 「永诺旗舰店」出现在哪几期 ===")
for r in c.execute(
        "SELECT period_id, role, status, order_date, id FROM forecast_submissions "
        "WHERE store_name='永诺旗舰店' ORDER BY id").fetchall():
    print("  sub_id=%-6s period_id=%-4s role=%-6s status=%-10s order_date=%s"
          % (r["id"], r["period_id"], r["role"], r["status"], r["order_date"]))

print()
print("=== 各期次「导入」类报单的客户数（= 编辑网格里实际会有报单的客户） ===")
for r in c.execute(
        "SELECT period_id, COUNT(DISTINCT store_name) u, COUNT(*) n FROM forecast_submissions "
        "WHERE role='导入' AND store_name IS NOT NULL AND store_name!='' "
        "GROUP BY period_id ORDER BY period_id").fetchall():
    print("  period_id=%-4s 导入客户数=%-4d 导入单数=%-4d" % (r["period_id"], r["u"], r["n"]))

print()
print("=== all_units（租户级客户名册，按 MIN(id) 顺序 = 前端列序） ===")
us = c.execute(
    "SELECT store_name, MIN(s.id) mn FROM forecast_submissions s "
    "WHERE s.status != 'rejected' AND s.store_name IS NOT NULL AND s.store_name != '' "
    "GROUP BY s.store_name ORDER BY mn").fetchall()
print("  共 %d 个：" % len(us))
for i, r in enumerate(us):
    print("     [%2d] %-24s MIN(id)=%s" % (i, r["store_name"], r["mn"]))
c.close()
