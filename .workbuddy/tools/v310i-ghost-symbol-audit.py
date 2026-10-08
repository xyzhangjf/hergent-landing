# -*- coding: utf-8 -*-
"""v310i 幽灵符号复核（只读）
判据 = AST 扫 `db.<attr>` + hasattr(erp_db, attr)；屏蔽连接对象方法名。
目的：判定 `income_order_create` / `income_order_list` 是否属于 2026-09-15 已登记的「幽灵符号族」。
"""
import ast
import os
import sys
import re

SRV = "/Users/zhangjunfeng/Documents/hergent-erp/server"
os.chdir(SRV)
sys.path.insert(0, SRV)

CONN_METHODS = {
    "execute", "executemany", "commit", "close", "executescript", "fetchone",
    "fetchall", "rollback", "cursor", "fetchmany", "row_factory", "total_changes",
}

import erp_db  # noqa: E402

used = {}          # attr -> set(file)
for root, dirs, files in os.walk(SRV):
    dirs[:] = [d for d in dirs if d not in ("__pycache__", ".git", "backups", "backup")]
    for f in files:
        if not f.endswith(".py"):
            continue
        p = os.path.join(root, f)
        try:
            tree = ast.parse(open(p, encoding="utf-8", errors="ignore").read())
        except SyntaxError:
            continue
        for n in ast.walk(tree):
            if isinstance(n, ast.Attribute) and isinstance(n.value, ast.Name) \
                    and n.value.id == "db" and n.attr not in CONN_METHODS:
                used.setdefault(n.attr, set()).add(os.path.relpath(p, SRV))

ghost = sorted(a for a in used if not hasattr(erp_db, a))
print("=" * 78)
print("扫描结果：`db.<attr>` 去重 %d 个；其中 erp_db 里【不存在】= %d 个（幽灵符号）"
      % (len(used), len(ghost)))
print("=" * 78)

TARGET = ["income_order_create", "income_order_list", "expense_order_create",
          "expense_order_list", "purchase_order_create", "bank_statement_create"]
print("本次关心的 6 个名字：")
for t in TARGET:
    ok = hasattr(erp_db, t)
    files = sorted(used.get(t, []))
    print("  %-24s hasattr=%-5s  调用点=%s" % (t, ok, files or "(无调用)"))

print()
print("含 income/expense 的幽灵符号：")
for a in ghost:
    if "income" in a or "expense" in a:
        print("  ✗ %-24s  <- %s" % (a, sorted(used[a])))

print()
print("按文件统计幽灵调用数（前 12）：")
cnt = {}
for a in ghost:
    for f in used[a]:
        cnt[f] = cnt.get(f, 0) + 1
for f, c in sorted(cnt.items(), key=lambda x: -x[1])[:12]:
    print("  %-42s %d" % (f, c))
