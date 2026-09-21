#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""AST 静态扫描：找出「被调用但在本模块内既不定义也不导入」的顶层名字。

用途 —— 定位这类缺陷：
    def period_close_checklist(month=""):
        try:
            r = get_config("last_depreciation_month")   # NameError!
        except Exception as e:
            ...append(status="pending")                 # 被静默吞掉

「调用未定义函数」+「外层 except Exception」= 恒空恒常值且零报错，
即 MEMORY 里那条「静默失效」。手工 grep 很难找，因为要靠「定义集合」做差集。

口径：
  * 定义集合 = 全局 FunctionDef/ClassDef/Assign/AnnAssign/AugAssign/For/With-as/
    Import/ImportFrom 引入的名字 ∪ **任意作用域内**的 import（函数内 import 也可用）
    ∪ 任意作用域内的局部赋值 ∪ builtins
  * 调用集合 = 所有 `Name(...)` 形式（属性调用 obj.fn() 不算，那是运行期决议）
  * 差集即候选；再排除 `_`（gettext 惯例）等。

用法：
    python3 undefined-call-scan.py <file-or-dir> [更多路径...]
    退出码 1 = 有发现（可用于 CI 闸门）

⚠️ 候选 ≠ 缺陷 —— 出结果后**必须逐条过三问**，否则会把死代码算成生产事故：

  问 1「同名实现有几份？」
      若 A 模块的 `get_diagnostic_report()` 未定义某名字，但**调用方 import 的是 B 模块**
      （例：`routers/reports.py` 里是 `import erp_db as db`，而 erp_db 有自己的同名实现），
      那 A 模块那份就是**死代码** ⇒ 优先级降到"清理"，不是"生产缺陷"。
      反例实测：`db/queries/reports.py:330 get_health_score()` 与 `erp_db.py:4307` 同名函数，
      路由走 erp_db 那份 ⇒ 前者死代码。

  问 2「谁调用这个函数？该函数是否被 import？」
      `grep -rn "from db.queries.<mod> import"` 看导出清单里有没有它；
      有同名 `^def` 出现在两个模块 ⇒ 十有八九其中一份是历史遗留。

  问 3「运行时能不能坐实？」
      比静态更硬的是**副作用痕迹**：例如 `_log_push()` 里的
      `CREATE TABLE IF NOT EXISTS notify_logs` 与出错的调用在**同一个 try 内**，
      则该表永远不会被创建 ⇒ 去生产库只读查 `sqlite_master`，表不存在 = 证据坐实。
      同类技巧：查计数行、查 `updated_at` 是否停更、查审计表是否恒空。

另外注意两类"看着像缺陷其实不是"的：
  * `if False else ...` 里的调用（恒假分支）—— 永不执行，仅代码味差。
  * 被 `except Exception` 吞掉但**外层还有兜底分支**的 —— 要读兜底给了什么值，
    若兜底值恰好是"合法业务值"那才是真静默失效；若兜底是"检查失败"这类**显式降级**，
    危害限于"该检查永远不通过"，而不是"给出错误的好数据"。
"""
import ast
import builtins
import os
import sys

BUILTINS = set(dir(builtins)) | {"__file__", "__name__", "__doc__", "__package__", "self", "cls"}


def _bound_names(tree):
    """收集本模块里所有「某个作用域内被绑定过」的名字（宽松，宁可漏报不误报）。"""
    bound = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            bound.add(node.name)
        elif isinstance(node, ast.Name) and isinstance(node.ctx, (ast.Store, ast.Del)):
            bound.add(node.id)
        elif isinstance(node, ast.arg):
            bound.add(node.arg)
        elif isinstance(node, ast.alias):
            # import x as y / from m import x as y
            bound.add((node.asname or node.name).split(".")[0])
        elif isinstance(node, (ast.Global, ast.Nonlocal)):
            bound.update(node.names)
        elif isinstance(node, ast.ExceptHandler) and node.name:
            bound.add(node.name)
        elif isinstance(node, (ast.comprehension,)):
            pass
    return bound


def _called_names(tree):
    """收集所有 `Name(...)` 形式的调用，带行号。"""
    out = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            out.append((node.func.id, node.lineno))
    return out


def _has_handler_above(src_lines, lineno):
    """粗略判断该行往上 15 行内是否有 try:（即异常可能被吞）。"""
    lo = max(0, lineno - 16)
    seg = "\n".join(src_lines[lo:lineno - 1])
    return "try:" in seg or "except" in seg


def scan_file(path):
    with open(path, encoding="utf-8") as f:
        src = f.read()
    try:
        tree = ast.parse(src, filename=path)
    except SyntaxError as e:
        return [("SYNTAX", e.lineno or 0, "语法错误: %s" % e)]

    bound = _bound_names(tree) | BUILTINS | {"_"}
    src_lines = src.splitlines()
    findings = []
    seen = set()
    for name, lineno in _called_names(tree):
        if name in bound:
            continue
        if (name, lineno) in seen:
            continue
        seen.add((name, lineno))
        swallowed = _has_handler_above(src_lines, lineno)
        tag = "SWALLOWED" if swallowed else "UNBOUND"
        findings.append((tag, lineno, "调用未定义/未导入的名字: %s()" % name))
    return sorted(findings, key=lambda t: t[1])


def main(argv):
    targets = argv[1:] or ["."]
    files = []
    for t in targets:
        if os.path.isdir(t):
            for root, _dirs, names in os.walk(t):
                if any(p in root for p in (".git", "__pycache__", "node_modules", ".venv")):
                    continue
                for n in names:
                    if n.endswith(".py"):
                        files.append(os.path.join(root, n))
        else:
            files.append(t)

    total = 0
    swallowed_total = 0
    for fp in sorted(files):
        try:
            res = scan_file(fp)
        except OSError:
            continue
        if not res:
            continue
        rel = os.path.relpath(fp, os.getcwd())
        print("=== %s ===" % rel)
        for tag, lineno, msg in res:
            flag = "  [被 except 吞]" if tag == "SWALLOWED" else "  [未绑定]"
            print("  L%-6d %s%s" % (lineno, msg, flag if tag != "SYNTAX" else ""))
            total += 1
            if tag == "SWALLOWED":
                swallowed_total += 1
    print()
    print("扫描文件数: %d | 发现: %d | 其中位于 try/except 附近（可能静默失效）: %d"
          % (len(files), total, swallowed_total))
    return 1 if total else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
