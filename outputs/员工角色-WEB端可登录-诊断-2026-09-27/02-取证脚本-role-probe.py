#!/usr/bin/env python3
# 只读取证：员工角色 vs 登录端 / 权限（诊断用，零写入）。
# 🔴 全脚本只 SELECT。SQLite 只读：活库 mode=ro（不带 immutable）。
# 用法：scp 到生产 /tmp/，然后
#   cd /opt/hergent-erp && python3 /tmp/02-取证脚本-role-probe.py
import sqlite3, sys, json, os

MASTER = "/opt/hergent-erp/erp.db"
TENANT = "/opt/hergent-erp/tenant_1.db"


def ro(path):
    return sqlite3.connect("file:%s?mode=ro" % path, uri=True)


def q(conn, sql, args=()):
    try:
        cur = conn.execute(sql, args)
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]
    except Exception as e:
        return [{"__error__": str(e)}]


out = {}

# ---------- 1. users 表结构（确认 roles 列是否存在） ----------
mc = ro(MASTER)
out["users_columns"] = [r["name"] for r in q(mc, "PRAGMA table_info(users)")]

# ---------- 2. 找刘善涛 ----------
out["target_user"] = q(
    mc,
    "SELECT id, username, display_name, role, roles, is_active, password_changed "
    "FROM users WHERE display_name LIKE ? OR username LIKE ?",
    ("%刘善涛%", "%刘善涛%"),
)
out["target_user_by_id_fallback"] = q(
    mc, "SELECT id, username, display_name, role, roles FROM users WHERE display_name LIKE ?", ("%善涛%",)
)

# ---------- 3. 全平台 role/roles 分布（看有多少人 role 与 roles 不一致） ----------
out["role_distribution"] = q(
    mc, "SELECT role, IFNULL(roles,'') AS roles, COUNT(*) AS n FROM users GROUP BY role, IFNULL(roles,'') ORDER BY n DESC"
)

# ---------- 4. 该用户的全部角色（若找到） ----------
rows = [r for r in out["target_user"] if "__error__" not in r]
if rows:
    uid = rows[0]["id"]
    out["user_tenants"] = q(mc, "SELECT * FROM user_tenants WHERE user_id=?", (uid,))
    out["active_sessions"] = q(
        mc,
        "SELECT substr(token,1,8) AS tok8, created_at, expires_at, ip_address, user_agent_hash, last_activity "
        "FROM sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 10",
        (uid,),
    )
    out["employee_row"] = q(
        mc,
        "SELECT id, name, is_active, has_account, account_username, account_role, account_roles, account_active "
        "FROM employees WHERE user_id=? OR account_username=?",
        (uid, rows[0].get("username") or ""),
    )
else:
    out["user_tenants"] = []
    out["active_sessions"] = []
    out["employee_row"] = []

# ---------- 5. 租户库 role_permissions 里 staff 有没有被自定义覆盖 ----------
try:
    tc = ro(TENANT)
    out["tenant_role_permissions_columns"] = [r["name"] for r in q(tc, "PRAGMA table_info(role_permissions)")]
    out["tenant_role_permissions_all"] = q(tc, "SELECT * FROM role_permissions")
    tc.close()
except Exception as e:
    out["tenant_role_permissions_all"] = [{"__error__": str(e)}]

# ---------- 6. employees 表里所有账号绑定的角色（看是否有人 role 列没同步） ----------
# employees 可能在主库也可能在租户库 —— 两个库都试（各自的表清单先打印出来定位）。
out["master_tables_sample"] = [r["name"] for r in q(mc, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")][:80]
_EMP_SQL = ("SELECT id, name, account_role, account_roles, account_active, user_id FROM employees "
            "WHERE has_account=1 OR account_username IS NOT NULL ORDER BY id")
out["employees_with_account_master"] = q(mc, _EMP_SQL)
mc.close()

try:
    tc2 = ro(TENANT)
    out["tenant_tables_sample"] = [r["name"] for r in q(tc2, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")][:80]
    out["employees_with_account_tenant"] = q(tc2, _EMP_SQL)
    tc2.close()
except Exception as e:
    out["employees_with_account_tenant"] = [{"__error__": str(e)}]

print(json.dumps(out, ensure_ascii=False, indent=2, default=str))
