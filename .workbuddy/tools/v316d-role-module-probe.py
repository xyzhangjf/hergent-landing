#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v316d 诊断：生产库文件 / 各库客户数 / 各角色模块权限（只读）。

目的：找出「哪个角色能打开 /archive/customers（module=crm）」，
     并弄清 boss 会话为何只看到 9 个客户（另一租户？）。
不打印 username / 客户名。
"""
import glob
import os
import sqlite3

print("=== 1. /opt/hergent-erp 下的 .db 文件 ===")
for f in sorted(glob.glob('/opt/hergent-erp/*.db')):
    print("   %-44s %6d MB" % (os.path.basename(f), os.path.getsize(f) // 1048576))

print("")
print("=== 2. 各 tenant_*.db 的活跃客户数 ===")
for f in sorted(glob.glob('/opt/hergent-erp/tenant_*.db')):
    try:
        c = sqlite3.connect("file:" + f + "?mode=ro", uri=True)
        n = c.execute("SELECT COUNT(*) FROM contacts WHERE is_active=1 AND type IN ('customer','both')").fetchone()[0]
        tot = c.execute("SELECT COUNT(*) FROM contacts").fetchone()[0]
        print("   %-30s 客户=%-5d 全档案=%d" % (os.path.basename(f), n, tot))
        c.close()
    except Exception as e:
        print("   %-30s ERR %s" % (os.path.basename(f), e))

print("")
for db in ['/opt/hergent-erp/tenant_1.db', '/opt/hergent-erp/erp.db']:
    try:
        c = sqlite3.connect("file:" + db + "?mode=ro", uri=True)
        has = c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='role_permissions'").fetchone()
        if not has:
            print("=== 3. %s 无 role_permissions 表 ===" % os.path.basename(db))
            c.close()
            continue
        cols = [r[1] for r in c.execute("PRAGMA table_info(role_permissions)")]
        print("=== 3. %s role_permissions 列 = %s ===" % (os.path.basename(db), cols))
        rows = c.execute("SELECT role_name, permissions FROM role_permissions ORDER BY role_name").fetchall()
        for r in rows:
            role, perms = r[0], str(r[1] or '')
            flags = [k for k in ('crm', 'hr', 'data', 'stock', 'sales', 'payroll', 'bid', 'cron', 'chat')
                     if ("'" + k + "'") in perms or ('"' + k + '"') in perms]
            star = '*' in perms
            print("   role=%-12s 含*=%-5s 模块=%s  (len=%d)"
                  % (role, star, sorted(set(flags)) if not star else 'ALL', len(perms)))
        c.close()
    except Exception as e:
        print("=== 3. %s ERR %s ===" % (os.path.basename(db), e))
