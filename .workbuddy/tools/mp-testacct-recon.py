#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""提审测试账号修复：生产只读侦察（mode=ro，绝不 import erp_db）。
查：users 关联两列 / user_tenants / hr_employees / report_mapping / employee_stores / 门店池。
"""
import sqlite3, os

MAIN = "/opt/hergent-erp/erp.db"
T1 = "/opt/hergent-erp/tenant_1.db"


def ro(p):
    c = sqlite3.connect("file:%s?mode=ro" % p, uri=True)
    c.row_factory = sqlite3.Row
    return c


def dump(title, conn, sql, params=()):
    print("\n=== %s ===" % title)
    try:
        rows = conn.execute(sql, params).fetchall()
    except Exception as e:
        print("  !! %s" % e)
        return []
    if not rows:
        print("  (空)")
        return []
    cols = rows[0].keys()
    print("  " + " | ".join(cols))
    for r in rows:
        print("  " + " | ".join("" if r[c] is None else str(r[c]) for c in cols))
    print("  共 %d 行" % len(rows))
    return rows


m = ro(MAIN)
t = ro(T1)

print("###### 主库 erp.db ######")
dump("users 全部（含关联两列）", m,
     "SELECT id, username, role, is_active, employee_id, IFNULL(employee_code,'') AS code, "
     "IFNULL(display_name,'') AS dname FROM users ORDER BY id")
dump("user_tenants", m,
     "SELECT ut.user_id, u.username, ut.tenant_id, ut.role FROM user_tenants ut "
     "JOIN users u ON u.id=ut.user_id ORDER BY ut.tenant_id, ut.user_id")
dump("tenants", m, "SELECT id, name FROM tenants ORDER BY id")
dump("sessions（未过期计数）", m,
     "SELECT COUNT(*) AS alive FROM sessions WHERE expires_at > datetime('now','localtime')")

print("\n###### 租户库 tenant_1.db ######")
dump("hr_employees", t,
     "SELECT id, IFNULL(name,'') AS name, IFNULL(employee_no,'') AS emp_no, is_active, "
     "IFNULL(warehouse_id,0) AS wh FROM hr_employees ORDER BY id")
dump("report_mapping 全部", t,
     "SELECT id, employee_id, counterparty_type, counterparty_id, IFNULL(report_alias,'') AS alias, "
     "IFNULL(order_template,'') AS tpl, is_active FROM report_mapping ORDER BY id")
dump("employee_stores 全部", t,
     "SELECT * FROM employee_stores ORDER BY employee_id, store_id")
dump("门店池 contacts(customer/both)", t,
     "SELECT id, IFNULL(name,'') AS name, type, is_active FROM contacts "
     "WHERE type IN ('customer','both') ORDER BY id")
dump("order_template 取值分布", t,
     "SELECT IFNULL(order_template,'') AS tpl, COUNT(*) AS n FROM report_mapping "
     "WHERE is_active=1 GROUP BY order_template")

print("\n###### 交叉：两账号关联解算 ######")
for un in ("mptest", "mptestsp"):
    r = m.execute("SELECT id, username, role, employee_id, IFNULL(employee_code,'') AS code "
                  "FROM users WHERE username=?", (un,)).fetchone()
    print("  %s -> %s" % (un, dict(r) if r else None))
    if r:
        print("     users.employee_id=%s, code=%r" % (r["employee_id"], r["code"]))

m.close()
t.close()
print("\n[DONE]")
