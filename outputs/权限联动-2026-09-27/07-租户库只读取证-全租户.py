"""v292 取证（全租户）：`role_permissions` 里到底有几行、哪些与内置默认「内容不同」。

**为什么要跨租户看**：`custom_roles()` 的判据是「内容 ≠ 内置默认」，**不是**「表里有这一行」。
只看一个租户可能看不出差别（若它恰好只配过真差异的角色）。要找到**判别场景**，
就要找一个「**保存过权限页 ⇒ 逐角色全量回写 ⇒ 9 个角色都有行**，但其中若干行内容 == 默认」
的租户 —— 那种租户上，"按行判" 会把所有角色都当"改过"，从而**整体拆掉 v291 的 roles 收窄**。

只读：`mode=ro`（活库不带 immutable）。用法：python3 <本脚本>
"""
import glob
import json
import os
import sqlite3

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
    "supervisor": ["dashboard", "ops-workbench", "sales", "buying", "stock", "crm", "data",
                   "reports", "chat"],
}


def canon(v):
    if isinstance(v, dict):
        return sorted({str(k) for k in v})
    if isinstance(v, (list, tuple, set)):
        return sorted({str(x) for x in v})
    return []


for db in sorted(glob.glob("/opt/hergent-erp/tenant_*.db")):
    print("=" * 72)
    print("库：%s" % os.path.basename(db))
    try:
        con = sqlite3.connect("file:%s?mode=ro" % db, uri=True)
        rows = con.execute("SELECT role_name, permissions FROM role_permissions").fetchall()
        con.close()
    except Exception as e:
        print("  ⚠️ 读不到（%s）⇒ 跳过" % e)
        continue
    diff, same = [], []
    for rn, raw in rows:
        try:
            v = json.loads(raw) if isinstance(raw, str) else raw
        except Exception:
            v = raw
        (diff if canon(v) != canon(DEFAULT.get(rn)) else same).append(str(rn))
    print("  表行数 = %d" % len(rows))
    print("  与内置默认 **内容不同** = %s" % sorted(diff))
    print("  与内置默认 **内容相同**（必须被内容判据过滤掉）= %s" % sorted(same))
    if same:
        print("  ✅ 本租户**能判别**两种判据：按内容判 ⇒ custom_roles=%d 个；按行判 ⇒ %d 个（差 %d）"
              % (len(diff), len(rows), len(rows) - len(diff)))
    else:
        print("  ⚠️ 本租户**不能判别**两种判据（每行都真差异 ⇒ 两种判法同结果）")
