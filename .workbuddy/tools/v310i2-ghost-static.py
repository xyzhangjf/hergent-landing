# -*- coding: utf-8 -*-
"""v310i2 幽灵符号复核（纯静态，只读，零依赖）
① 求 erp_db.py 模块级**绑定名集合**（import / def / class / assign）
② 全仓 AST 扫 `db.<attr>`（屏蔽连接对象方法名）
③ 差集 = 幽灵符号
"""
import ast
import os

SRV = "/Users/zhangjunfeng/Documents/hergent-erp/server"
CONN = {"execute", "executemany", "commit", "close", "executescript", "fetchone",
        "fetchall", "rollback", "cursor", "fetchmany", "row_factory", "total_changes",
        "name", "id", "type", "amount", "date"}


def module_bound_names(path):
    """模块级被绑定的名字（含 `from X import a,b` 与 `def`/`class`/`=`）"""
    names = set()
    tree = ast.parse(open(path, encoding="utf-8", errors="ignore").read())
    for n in tree.body:
        if isinstance(n, ast.Import):
            for a in n.names:
                names.add((a.asname or a.name).split(".")[0])
        elif isinstance(n, ast.ImportFrom):
            for a in n.names:
                names.add(a.asname or a.name)
        elif isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            names.add(n.name)
        elif isinstance(n, ast.Assign):
            for t in n.targets:
                if isinstance(t, ast.Name):
                    names.add(t.id)
        elif isinstance(n, ast.AnnAssign) and isinstance(n.target, ast.Name):
            names.add(n.target.id)
        elif isinstance(n, (ast.If, ast.Try)):
            # 条件里的 import / def 也算
            for sub in ast.walk(n):
                if isinstance(sub, ast.ImportFrom):
                    for a in sub.names:
                        names.add(a.asname or a.name)
                elif isinstance(sub, ast.Import):
                    for a in sub.names:
                        names.add((a.asname or a.name).split(".")[0])
                elif isinstance(sub, (ast.FunctionDef, ast.ClassDef)):
                    names.add(sub.name)
    return names


erp_path = os.path.join(SRV, "erp_db.py")
bound = module_bound_names(erp_path)
print("erp_db.py 模块级绑定名: %d 个" % len(bound))

# 全仓扫 db.<attr>
used = {}
for root, dirs, files in os.walk(SRV):
    dirs[:] = [d for d in dirs if d not in ("__pycache__", ".git", "backups", "backup")]
    for f in files:
        if not f.endswith(".py"):
            continue
        p = os.path.join(root, f)
        rel = os.path.relpath(p, SRV)
        try:
            tree = ast.parse(open(p, encoding="utf-8", errors="ignore").read())
        except SyntaxError:
            continue
        for n in ast.walk(tree):
            if isinstance(n, ast.Attribute) and isinstance(n.value, ast.Name) \
                    and n.value.id == "db" and n.attr not in CONN:
                used.setdefault(n.attr, set()).add(rel)

ghost = sorted(a for a in used if a not in bound)
print("`db.<attr>` 去重 %d 个；其中 erp_db 未绑定 = %d 个（幽灵符号）" % (len(used), len(ghost)))
print("=" * 78)
TARGET = ["income_order_create", "income_order_list", "expense_order_create",
          "expense_order_list", "purchase_order_create", "bank_statement_create",
          "sale_order_create"]
print("本次关心的名字：")
for t in TARGET:
    print("  %-24s erp_db 有=%-6s 调用点=%s"
          % (t, t in bound, sorted(used.get(t, [])) or "(无调用)"))
print()
print("含 income / expense 的幽灵符号：")
for a in ghost:
    if "income" in a or "expense" in a:
        print("  ✗ %-26s <- %s" % (a, sorted(used[a])))
print()
cnt = {}
for a in ghost:
    for f in used[a]:
        cnt[f] = cnt.get(f, 0) + 1
print("幽灵调用按文件（前 10）：")
for f, c in sorted(cnt.items(), key=lambda x: -x[1])[:10]:
    print("  %-40s %d" % (f, c))
