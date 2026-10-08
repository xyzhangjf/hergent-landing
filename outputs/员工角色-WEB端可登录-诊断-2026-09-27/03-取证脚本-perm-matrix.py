#!/usr/bin/env python3
# 只读取证（第二段）：用生产**真代码**算权限矩阵 + 查登录历史（诊断用，零写入）。
# 🔴 全脚本零写入。DB 只读 mode=ro。
# 用法（必须带 .env，core.py:12 在 import 期强制要求 ERP_SECRET）：
#   cd /opt/hergent-erp && set -a && . ./.env && set +a && python3 /tmp/03-取证脚本-perm-matrix.py
import sys, json, ast, sqlite3

sys.path.insert(0, "/opt/hergent-erp")
out = {}

MODS = ["dashboard", "ops-workbench", "data", "sales", "buying", "stock", "accounts",
        "crm", "marketing", "hr", "payroll", "projects", "reports", "chat", "tasks", "settings"]
ROLES = ["admin", "boss", "accountant", "sales", "guide", "driver", "staff", "supervisor"]

# ---------- A. 生产真代码：角色 × 模块 授权矩阵 ----------
try:
    import core
    out["_import"] = "ok"
    t1 = core.perms_for(1)
    out["perms_table_tenant1"] = {k: v for k, v in t1.items()}
    out["perms_table_tenant1_keys"] = sorted(t1.keys())
    matrix = {}
    for role in ROLES:
        u = {"id": 1, "role": role, "roles": ""}
        row = {"modules_from_user_modules": core.user_modules(u, table=t1)}
        row["read_ok"] = [m for m in MODS if core._check_perm(u, m, "read", tenant_id=1)]
        row["read_denied"] = [m for m in MODS if not core._check_perm(u, m, "read", tenant_id=1)]
        row["check_mod_not_in_map"] = core._check_perm(u, "no-such-module", "read", tenant_id=1)
        row["is_admin_style"] = core._check_perm(u, "anything", "read", tenant_id=1)
        matrix[role] = row
    out["matrix"] = matrix
except Exception as e:
    import traceback
    out["_import"] = "FAIL: " + str(e)
    out["_trace"] = traceback.format_exc()[-2000:]

# ---------- B. 从 server.py AST 取 _PATH_MODULE_MAP，算 staff 可访问的接口前缀 ----------
try:
    src = open("/opt/hergent-erp/server.py", encoding="utf-8").read()
    tree = ast.parse(src)
    pmap = None
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            for tgt in node.targets:
                if isinstance(tgt, ast.Name) and tgt.id == "_PATH_MODULE_MAP":
                    pmap = ast.literal_eval(node.value)
    out["_PATH_MODULE_MAP_count"] = len(pmap or {})
    if pmap and "core" in sys.modules:
        staff = {"id": 1, "role": "staff", "roles": ""}
        allowed, denied = [], []
        for prefix, mod in sorted(pmap.items()):
            (allowed if core._check_perm(staff, mod, "read", tenant_id=1) else denied).append(prefix + " -> " + mod)
        out["staff_allowed_prefixes"] = allowed
        out["staff_allowed_count"] = len(allowed)
        out["staff_denied_count"] = len(denied)
except Exception as e:
    out["_pmap_error"] = str(e)

# ---------- C. 登录历史与会话 ----------
def ro(p):
    return sqlite3.connect("file:%s?mode=ro" % p, uri=True)

mc = ro("/opt/hergent-erp/erp.db")
def q(conn, sql, args=()):
    try:
        cur = conn.execute(sql, args)
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]
    except Exception as e:
        return [{"__error__": str(e)}]

out["audit_logs_liu"] = q(
    mc,
    "SELECT id, user_name, action, module, ref_id, detail, created_at FROM audit_logs "
    "WHERE user_name LIKE ? OR ref_id=? ORDER BY id DESC LIMIT 30",
    ("%刘善涛%", "999900"),
)
out["sessions_all_for_999900"] = q(mc, "SELECT COUNT(*) AS n, MIN(created_at) AS first, MAX(created_at) AS last FROM sessions WHERE user_id=999900")
out["sessions_columns"] = [r["name"] for r in q(mc, "PRAGMA table_info(sessions)")]
out["audit_logs_columns"] = [r["name"] for r in q(mc, "PRAGMA table_info(audit_logs)")]
out["audit_recent_auth"] = q(
    mc, "SELECT user_name, action, module, detail, created_at FROM audit_logs WHERE module='auth' ORDER BY id DESC LIMIT 20"
)
mc.close()
print(json.dumps(out, ensure_ascii=False, indent=1, default=str))
