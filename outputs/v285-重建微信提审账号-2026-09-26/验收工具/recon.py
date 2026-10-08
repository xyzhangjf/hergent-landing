#!/usr/bin/env python3
# v285 勘察（只读）：为「重建微信提审账号」摸清现状
# 只读铁律：活库用 mode=ro，**绝不加 immutable**（加了会跳过 WAL 读到旧值）
import sqlite3, os

MAIN = "/opt/hergent-erp/erp.db"
T1 = "/opt/hergent-erp/tenant_1.db"


def ro(p):
    c = sqlite3.connect("file:%s?mode=ro" % p, uri=True)
    c.row_factory = sqlite3.Row
    return c


def dump(sql, conn, title):
    print("\n-- %s" % title)
    try:
        rows = conn.execute(sql).fetchall()
    except Exception as e:
        print("   !! %s" % e)
        return []
    if not rows:
        print("   (0 行)")
    for r in rows:
        print("   " + " | ".join("%s=%s" % (k, r[k]) for k in r.keys()))
    return rows


print("=" * 74)
print("【A】主库 erp.db —— 账号现状")
print("=" * 74)
m = ro(MAIN)
dump("SELECT id,username,display_name,role,is_active,employee_id,password_changed "
     "FROM users ORDER BY id", m, "users（全部）")
dump("SELECT ut.user_id,ut.tenant_id,ut.role,u.username FROM user_tenants ut "
     "LEFT JOIN users u ON u.id=ut.user_id ORDER BY ut.tenant_id,ut.user_id", m, "user_tenants")
dump("SELECT name,seq FROM sqlite_sequence WHERE name IN ('users','sessions')", m,
     "sqlite_sequence 水位（建号新 id 由此推）")
dump("SELECT COUNT(*) AS n FROM sessions", m, "sessions 行数")

print()
print("=" * 74)
print("【B】租户库 tenant_1.db —— 员工 / 报单配置 / 门店")
print("=" * 74)
t = ro(T1)
dump("SELECT id,name,employee_no,position,is_active,warehouse_id FROM hr_employees ORDER BY id",
     t, "hr_employees（全部）")
dump("SELECT id,employee_id,system_name,report_alias,counterparty_id,counterparty_type,"
     "is_active,created_at FROM report_mapping ORDER BY id", t, "report_mapping（全部）")
dump("SELECT rm.id,rm.report_alias,rm.is_active,c.id AS store_id,c.name AS store_name,"
     "c.type,c.is_active AS store_active "
     "FROM report_mapping rm LEFT JOIN contacts c ON c.id=rm.counterparty_id "
     "WHERE rm.is_active=1 ORDER BY rm.id", t, "★ 活跃报单配置 → 指向的门店")
dump("SELECT COUNT(*) AS n FROM contacts WHERE type IN ('customer','both') AND is_active=1",
     t, "可选门店总数（contacts type in customer/both 且 active）")
dump("SELECT id,name,type,is_active FROM contacts WHERE type IN ('customer','both') "
     "AND is_active=1 ORDER BY id LIMIT 15", t, "门店样本（前 15 个）")
dump("SELECT id,name,order_start,order_end,status FROM forecast_periods "
     "ORDER BY id DESC LIMIT 4", t, "近期次（找 open）")
dump("SELECT COUNT(*) AS n FROM forecast_import_products WHERE period_id="
     "(SELECT MAX(id) FROM forecast_periods WHERE status='open')",
     t, "★ 最新 open 期次的报单清单行数")
dump("SELECT COUNT(*) AS n FROM employee_stores", t, "employee_stores（历史层，应退化）")

print()
print("=" * 74)
print("【C】残留自证：确认 mptest 系确实不在")
print("=" * 74)
r = m.execute("SELECT COUNT(*) FROM users WHERE username LIKE 'mptest%' OR username LIKE '%wxtest%'").fetchone()[0]
print("   users 里 mptest*/wxtest* 行数 = %d（期望 0）" % r)
r2 = t.execute("SELECT COUNT(*) FROM hr_employees WHERE name LIKE '%微信审核%'").fetchone()[0]
print("   hr_employees 里含「微信审核」行数 = %d（期望 0）" % r2)
