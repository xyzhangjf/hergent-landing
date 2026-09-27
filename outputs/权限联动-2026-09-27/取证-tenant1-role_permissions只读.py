"""v292 取证：tenant_1 的 role_permissions 表里到底有几行、哪些与内置默认「内容不同」。

判据要害：如果行数 > 2，就证明「按内容判」在真实数据上确实过滤掉了
「保存权限时逐角色回写」留下的同名行 —— 那正是 `core.custom_roles` 必须按内容判的理由。
只读：`mode=ro`（活库不带 immutable）。
"""
import sqlite3, json, sys

DB = "/opt/hergent-erp/tenant_1.db"
# 内置默认（抄自本地 core.py，仅用于本次取证对照，不参与生产逻辑）
DEFAULT = {
    "admin": ["*"],
    "boss": ["dashboard", "ops-workbench", "data", "sales", "buying", "stock", "accounts",
             "crm", "marketing", "hr", "payroll", "projects", "perf", "goals", "reports",
             "chat", "tasks"],
    "accountant": ["dashboard", "accounts", "reports", "marketing", "chat"],
    "sales": ["dashboard", "ops-workbench", "sales", "buying", "stock", "crm", "data", "chat"],
    "guide": ["dashboard", "ops-workbench", "sales", "buying", "stock", "crm", "chat"],
    "driver": ["dashboard", "stock", "chat"],
    "staff": ["data", "chat", "stock"],
    "supervisor": ["dashboard", "data"],
}


def canon(v):
    if isinstance(v, dict):
        return sorted({str(k) for k in v.keys()})
    if isinstance(v, (list, tuple, set)):
        return sorted({str(x) for x in v})
    return []


con = sqlite3.connect("file:%s?mode=ro" % DB, uri=True)
con.row_factory = sqlite3.Row
rows = con.execute("SELECT id, role_name, permissions, created_at FROM role_permissions ORDER BY id").fetchall()
con.close()

print("表行数 = %d" % len(rows))
print("-" * 72)
diff, same = [], []
for r in rows:
    try:
        p = json.loads(r["permissions"])
    except Exception as e:
        p = "BAD-JSON: %s" % e
    c, d = canon(p), canon(DEFAULT.get(r["role_name"]))
    is_diff = c != d
    (diff if is_diff else same).append(r["role_name"])
    print("%-14s %-7s %s  %s" % (r["role_name"], "差异" if is_diff else "等同默认",
                                 "dict" if isinstance(p, dict) else ("list" if isinstance(p, list) else type(p).__name__),
                                 json.dumps(c, ensure_ascii=False)[:90]))
print("-" * 72)
print("与内置默认**内容不同**（= custom_roles 应返回的）: %s" % json.dumps(sorted(diff), ensure_ascii=False))
print("与内置默认**内容相同**（= 必须被过滤掉的）: %s" % json.dumps(sorted(same), ensure_ascii=False))
print("若按「表里有行」判，custom_roles 会返回 %d 个角色 ⇒ 让位规则会把 v291 收窄整体拆掉" % len(rows))
sys.exit(0)
