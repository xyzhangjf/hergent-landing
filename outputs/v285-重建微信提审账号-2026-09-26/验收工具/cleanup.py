#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v285 收尾：核实临时令牌残留 + 清掉登录测试留下的会话 + 最终状态核对"""
import sqlite3

MAIN = "/opt/hergent-erp/erp.db"
T1 = "/opt/hergent-erp/tenant_1.db"


def rw(p):
    c = sqlite3.connect(p)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA busy_timeout=8000")
    return c


def ro(p):
    c = sqlite3.connect("file:%s?mode=ro" % p, uri=True)  # 活库：不加 immutable
    c.row_factory = sqlite3.Row
    return c


m = rw(MAIN)

print("=" * 74)
print("【1】临时令牌残留复核（脚本报「残留 1」，我怀疑就是主令牌自己）")
print("=" * 74)
rows = m.execute("SELECT token, user_id, created_at, expires_at FROM sessions "
                 "WHERE token LIKE 'v285%'").fetchall()
print("   token 以 v285 开头的行数 = %d" % len(rows))
for r in rows:
    print("   ", dict(r))

print()
print("=" * 74)
print("【2】登录测试留下的会话（应删除 —— 我没保存它们的 token，属无主凭证）")
print("=" * 74)
print("   sessions 实际列 = %s" % [r[1] for r in m.execute("PRAGMA table_info(sessions)")])
rows = m.execute("SELECT * FROM sessions WHERE user_id IN (999903, 999904)").fetchall()
print("   行数 = %d" % len(rows))
for r in rows:
    print("    uid=%s token=%s… created=%s" % (
        r["user_id"], str(r["token"])[:16], r["created_at"]))
n = len(rows)
if n:
    m.execute("DELETE FROM sessions WHERE user_id IN (999903, 999904)")
    m.commit()
    print("   ⇒ 已删除 %d 条测试会话" % n)
left = m.execute("SELECT COUNT(*) FROM sessions WHERE user_id IN (999903, 999904)").fetchone()[0]
print("   删除后残留 = %d（期望 0）" % left)

print()
print("=" * 74)
print("【3】最终状态核对")
print("=" * 74)
print("   -- sessions 全表")
for r in m.execute("SELECT user_id,token,created_at FROM sessions ORDER BY user_id"):
    print("      uid=%s token=%s… %s" % (r["user_id"], str(r["token"])[:14], r["created_at"]))
print("   -- sessions 总数 = %d" % m.execute("SELECT COUNT(*) FROM sessions").fetchone()[0])

print("   -- 两个提审账号（users）")
for r in m.execute("SELECT id,username,display_name,role,is_active,employee_id,password_changed,phone "
                   "FROM users WHERE username IN ('mptest','mptestsp')"):
    print("      ", dict(r))

print("   -- 两个提审员工（tenant_1.hr_employees）")
t = ro(T1)
for r in t.execute("SELECT id,name,employee_no,position,is_active FROM hr_employees WHERE id IN (11,12)"):
    print("      ", dict(r))

print("   -- 两条新报单配置（tenant_1.report_mapping）")
for r in t.execute("SELECT id,employee_id,report_alias,system_name,order_template,counterparty_id,"
                   "counterparty_type,is_active FROM report_mapping WHERE id IN (6,7)"):
    print("      ", dict(r))

print()
print("   -- 活跃配置总数（应为 5：原 3 + 新 2）")
print("      ", t.execute("SELECT COUNT(*) FROM report_mapping WHERE is_active=1").fetchone()[0])
print("   -- contacts 门店数（应仍 755）")
print("      ", t.execute("SELECT COUNT(*) FROM contacts").fetchone()[0])
print("   -- forecast_submissions 行数（应仍 39，审核员还没点过提交）")
print("      ", t.execute("SELECT COUNT(*) FROM forecast_submissions").fetchone()[0])
