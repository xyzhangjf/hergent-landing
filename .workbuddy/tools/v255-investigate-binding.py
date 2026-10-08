#!/usr/bin/env python3
# READ-ONLY investigation for ① sales-account binding.
# Lists: main-db users + user_tenants(tenant_1); tenant_1 employee/report_mapping state.
import sqlite3, os

ERP = "/opt/hergent-erp/erp.db"
T1 = "/opt/hergent-erp/tenant_1.db"

def q(db, sql, args=()):
    c = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    c.row_factory = sqlite3.Row
    try:
        rows = c.execute(sql, args).fetchall()
        return [dict(r) for r in rows]
    finally:
        c.close()

def tables(db):
    c = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    try:
        return [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")]
    finally:
        c.close()

print("="*70)
print("MAIN DB erp.db : tables matching users/tenant/session/staff/employee")
print("="*70)
for t in tables(ERP):
    if any(k in t.lower() for k in ("user","tenant","session","staff","employee")):
        print("  ", t)

print("\n" + "="*70)
print("users SCHEMA (column names)")
print("="*70)
c = sqlite3.connect(f"file:{ERP}?mode=ro", uri=True)
cols = [r[1] for r in c.execute("PRAGMA table_info(users)")]
print(cols)
c.close()

print("\n" + "="*70)
print("EXISTING USERS (id, username, role, employee_id, employee_code, is_active, display_name)")
print("="*70)
us = q(ERP, "SELECT id, username, role, employee_id, employee_code, is_active, display_name FROM users ORDER BY id")
for u in us:
    print(u)

print("\n" + "="*70)
print("user_tenants for tenant_1 (user_id, tenant_id, role?)")
print("="*70)
ut = q(ERP, "SELECT * FROM user_tenants WHERE tenant_id=1 ORDER BY user_id")
for r in ut:
    print(r)

print("\n" + "="*70)
print("TENANT_1.db : tables matching staff/employee/report/hr")
print("="*70)
for t in tables(T1):
    if any(k in t.lower() for k in ("staff","employee","report","hr_")):
        print("  ", t)

print("\n" + "="*70)
print("tenant_1 report_mapping SCHEMA")
print("="*70)
c = sqlite3.connect(f"file:{T1}?mode=ro", uri=True)
for r in c.execute("PRAGMA table_info(report_mapping)"):
    print("  ", r[1], r[2])
c.close()

print("\n" + "="*70)
print("tenant_1 report_mapping ROWS (id, employee_id, counterparty_type, system_name, report_alias, channel_id, is_active)")
print("="*70)
rm = q(T1, "SELECT id, employee_id, counterparty_type, system_name, report_alias, channel_id, is_active FROM report_mapping ORDER BY id")
for r in rm:
    print(r)

print("\n" + "="*70)
print("tenant_1 employee/staff tables : sample rows")
print("="*70)
for tname in ("hr_employees","staff","employees"):
    if tname in tables(T1):
        print(f"--- table {tname} ---")
        c = sqlite3.connect(f"file:{T1}?mode=ro", uri=True)
        info = [r[1] for r in c.execute(f"PRAGMA table_info({tname})")]
        print("  cols:", info)
        try:
            rows = c.execute(f"SELECT * FROM {tname} ORDER BY id LIMIT 50").fetchall()
            for r in rows:
                print("  ", dict(r))
        except Exception as e:
            print("  err:", e)
        c.close()
print("\nDONE (read-only).")
