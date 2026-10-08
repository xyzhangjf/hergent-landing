#!/usr/bin/env python3
# v381 recon: 只读核对「员工↔个人仓」与仓库档案现状（生产 tenant_1）
# 用法: python3 v381-recon-selfwh.py /opt/hergent-erp/tenant_1.db
import sqlite3, sys

dbp = sys.argv[1] if len(sys.argv) > 1 else '/opt/hergent-erp/tenant_1.db'
con = sqlite3.connect(f'file:{dbp}?mode=ro', uri=True)
con.row_factory = sqlite3.Row

print('== 仓库档案 (warehouses) ==')
for r in con.execute('SELECT id, name, is_active FROM warehouses ORDER BY id'):
    print(f"  #{r['id']:<3} {r['name']:<20} active={r['is_active']}")

print('\n== 员工↔个人仓 (hr_employees.warehouse_id != 0) ==')
q = """SELECT e.id, e.name, e.warehouse_id, w.name AS wh_name, e.is_active
       FROM hr_employees e LEFT JOIN warehouses w ON w.id = e.warehouse_id
       WHERE e.warehouse_id IS NOT NULL AND e.warehouse_id != 0
       ORDER BY e.id"""
rows = list(con.execute(q))
for r in rows:
    flag = '' if r['wh_name'] else '   <-- ⚠️ 悬空（仓库不存在）'
    print(f"  emp#{r['id']:<3} {r['name']:<10} warehouse_id={r['warehouse_id']:<3} -> {r['wh_name'] or '(无)'}{flag}")
print(f'  小计: {len(rows)} 人')

print('\n== 报单配置里的「本人仓」映射 (report_mapping) ==')
q2 = """SELECT m.id, m.employee_id, m.counterparty_id, m.system_name, m.is_active, m.counterparty_type
        FROM report_mapping m LEFT JOIN warehouses w ON w.id = m.counterparty_id
        WHERE m.counterparty_type='self_warehouse' ORDER BY m.id"""
for r in con.execute(q2):
    print(f"  map#{r['id']:<3} emp={r['employee_id']:<3} wh={r['counterparty_id']:<3} name={r['system_name'] or '':<16} active={r['is_active']}")

print('\n== 重复占用检测（同一仓被多人绑） ==')
q3 = """SELECT warehouse_id, COUNT(*) c, GROUP_CONCAT(name) names
        FROM hr_employees WHERE warehouse_id IS NOT NULL AND warehouse_id != 0 AND is_active=1
        GROUP BY warehouse_id HAVING c > 1"""
dup = list(con.execute(q3))
if dup:
    for r in dup:
        print(f"  ⚠️ 仓 #{r['warehouse_id']} 被 {r['c']} 人占用: {r['names']}")
else:
    print('  无重复占用')

con.close()
