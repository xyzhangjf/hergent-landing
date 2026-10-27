#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从源码里抽出**全部** DDL 声明的表与列，产出可对账的清单。

为什么需要它：

`migrations/legacy_baseline.txt` 只冻结了 389 处 `_safe_migrate` 调用。仓里还有**第二种
写 DDL 的方式** —— 直接把 `CREATE TABLE IF NOT EXISTS ...` 写在函数体里（`db/queries/*.py`
里那批就是同一批迁移的第二份拷贝）。对这类 DDL，版本系统既不管、体检也看不见：

    doctor 的比对方向是「租户库 vs 主库」——它能发现"主库有、租户库没有"，
    **发现不了"代码里有、哪个库都没有"**。而后者恰恰是 `no such table` 的来源：
    代码以为表在，实际从没在任何一台库上建过。

所以这个脚本只做一件事：把「代码声明了什么」变成结构化清单（JSON），
交给 `check_ddl_parity.py` 去和真实库对账。它**不判断谁对谁错**，也不改任何文件。

抽取口径（宁多报不少报）：
  1. 扫所有 Python 字符串字面量（AST，不用正则，避免把注释里的 SQL 也算进来）
  2. `CREATE TABLE [IF NOT EXISTS] <name>` → 表名 + 列（用真实 sqlite 解析建表语句，
     不自己拆逗号；解析不了的进 unparsed，不静默丢弃）
  3. `ALTER TABLE <name> ADD [COLUMN] <col>` → 列名（正则足够：这句语法极简）
  4. 表名/列名按 SQLite 规则归一：去引号、大小写不敏感

用法：
    python3 tools/hergent/v706/extract_ddl_schema.py .tmp-audit -o /tmp/ddl.json
"""
from __future__ import annotations

import argparse
import ast
import json
import os
import re
import sqlite3
import sys

# ── 从字符串里抠语句 ────────────────────────────────────────────────────────────
CREATE_RE = re.compile(
    r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?P<name>[`\"\[\]\w.]+)\s*\(",
    re.I,
)
ALTER_ADD_RE = re.compile(
    r"ALTER\s+TABLE\s+(?P<name>[`\"\[\]\w.]+)\s+ADD\s+(?:COLUMN\s+)?(?P<col>[`\"\[\]\w]+)",
    re.I,
)

# `ADD COLUMN {变量}` 会被上面那条正则**反向回溯**抓成"列名叫 COLUMN"：
#   f"ALTER TABLE pick_wave_items ADD COLUMN {_col} {_typ}"
#   → 字面量片段是 "… ADD COLUMN "，正则跳过可选组后把 COLUMN 当成列名。
# 这不是有列叫 column，是拼出来的列名 —— 必须归到 dynamic，不能当成声明。
SQL_KEYWORDS = {"column", "constraint", "primary", "unique", "foreign",
                "check", "key", "index", "references", "default"}

# 这些名字说明是拼接出来的（f-string / %s / 加减号拼的表名），静态拿不到 → 单独归类
DYNAMIC_HINT = re.compile(r"[%{}]|\.\.\.|\.format\(")


def _norm(name: str) -> str:
    n = name.strip().strip('`"[]')
    if "." in n:                       # main.users / temp.xxx
        n = n.split(".")[-1]
    return n.strip().strip('`"[]').lower()


def _strip_ddl_noise(sql: str) -> str:
    """把 sqlite 不认的 PG/MySQL 残留清掉，只为让建表语句能跑通、好读列名。"""
    return sql


def _columns_via_sqlite(stmt: str):
    """把 CREATE TABLE 丢给 sqlite 自己解析，读回列名。

    比自己拆逗号可靠得多：DEFAULT 里可能有括号、CHECK(...) 里有逗号、
    列名可能带引号。解析失败返回 (None, 原因)。
    """
    stmt = stmt.strip().rstrip(";")
    try:
        c = sqlite3.connect(":memory:")
        try:
            c.execute(stmt)
            tname = _norm(CREATE_RE.match(stmt).group("name"))
            rows = c.execute('PRAGMA table_info("%s")' % tname).fetchall()
            return [(r[1], (r[2] or "").lower()) for r in rows], None
        finally:
            c.close()
    except Exception as e:                                  # noqa: BLE001
        return None, str(e)[:120]


def _find_stmt(sql: str, start: int) -> str:
    """从 `CREATE TABLE ... (` 的 `(` 处起，按括号配平取出完整语句。"""
    depth = 0
    i = sql.index("(", start)
    for j in range(i, len(sql)):
        ch = sql[j]
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                return sql[start:j + 1]
    return sql[start:]


def string_literals(path: str):
    """→ [(行号, 字符串, 所在顶层函数名)]。

    只取代码里的字面量（AST 遍历，注释天然被排除）。**带函数名**是必须的：
    「有没有这张表」本身不说明问题 —— 建表语句如果写在 `_init_qms_tables()` 这类
    按需初始化函数里，那"库里暂时没有"就是**正常**的（第一次用到才建）。
    不带函数名，报告只能一律标红，等于把 24 张正常表误判成故障。
    """
    try:
        tree = ast.parse(open(path, encoding="utf-8", errors="replace").read())
    except SyntaxError:
        return []
    out = []

    def walk(node, func):
        for child in ast.iter_child_nodes(node):
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                walk(child, child.name)
            elif isinstance(child, ast.Constant) and isinstance(child.value, str):
                s = child.value
                u = s.upper()
                if "CREATE TABLE" in u or "ALTER TABLE" in u:
                    out.append((child.lineno, s, func))
            else:
                walk(child, func)

    walk(tree, None)
    return out


def scan(root: str):
    tables = {}      # 表名 → {files, cols: {col: type}}
    columns = {}     # (表, 列) → files
    dynamic = []     # 静态拿不到的表名/列名
    unparsed = []    # 认出来是建表语句但 sqlite 解析不了

    for dirpath, dirnames, files in os.walk(root):
        dirnames[:] = [d for d in dirnames
                       if d not in ("__pycache__", "node_modules", "backups", "migrations")
                       and not d.startswith(".")]
        for fn in sorted(files):
            if not fn.endswith(".py"):
                continue
            p = os.path.join(dirpath, fn)
            rel = os.path.relpath(p, root)
            for lineno, s, fn_name in string_literals(p):
                # —— 表 ——
                for m in CREATE_RE.finditer(s):
                    raw_name = m.group("name")
                    # 判"拼接"只看表名本身。**不能**看 `s[:m.start()]` —— 一个大字符串里
                    # 只要前面出现过 `%`（`execute(sql % params)`），后面所有建表都会被
                    # 误判成动态，而把真表名从清单里抹掉（那样就少报故障，比多报危险）。
                    if DYNAMIC_HINT.search(raw_name):
                        dynamic.append({"file": rel, "line": lineno, "kind": "table",
                                        "text": " ".join(s.split())[:80]})
                        continue
                    name = _norm(raw_name)
                    stmt = _find_stmt(s, m.start())
                    cols, err = _columns_via_sqlite(stmt)
                    if cols is None and err:
                        # 常见原因：语句里还有 %s / 表名带引号但被裁掉 —— 再试一次原样
                        unparsed.append({"file": rel, "line": lineno, "table": name, "err": err,
                                         "text": " ".join(stmt.split())[:160]})
                        cols = []
                    ent = tables.setdefault(name, {"files": set(), "cols": {}, "funcs": set()})
                    ent["files"].add("%s:%d" % (rel, lineno))
                    ent["funcs"].add("%s.%s" % (rel, fn_name or "<module>"))
                    for cname, ctype in cols:
                        ent["cols"][cname.lower()] = ctype

                # —— 列 ——
                for m in ALTER_ADD_RE.finditer(s):
                    raw_name, raw_col = m.group("name"), m.group("col")
                    if (_norm(raw_col) in SQL_KEYWORDS
                            or DYNAMIC_HINT.search(raw_name)
                            or DYNAMIC_HINT.search(raw_col)):
                        dynamic.append({"file": rel, "line": lineno, "kind": "column",
                                        "text": " ".join(s.split())[:80]})
                        continue
                    key = (_norm(raw_name), _norm(raw_col))
                    columns.setdefault(key, set()).add("%s:%d:%s" % (rel, lineno, fn_name or "<module>"))

    return {
        "tables": {k: {"files": sorted(v["files"]), "cols": v["cols"],
                       "funcs": sorted(v["funcs"])}
                   for k, v in sorted(tables.items())},
        "columns": {"%s.%s" % k: sorted(v) for k, v in sorted(columns.items())},
        "dynamic": dynamic,
        "unparsed": unparsed,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("root")
    ap.add_argument("-o", "--out", default="")
    a = ap.parse_args()

    data = scan(a.root)
    n_tab, n_col = len(data["tables"]), len(data["columns"])
    print("=" * 88)
    print("代码里声明过的表 %d 张 / 列 %d 个" % (n_tab, n_col))
    print("  静态拿不到（拼接名）%d 处；建表语句解析失败 %d 处"
          % (len(data["dynamic"]), len(data["unparsed"])))
    print("=" * 88)

    if data["unparsed"]:
        print("\n解析失败（这些必须人看，不能当没有）")
        for u in data["unparsed"][:15]:
            print("  %-28s L%-6d %-24s %s" % (u["file"], u["line"], u["table"], u["err"]))
        if len(data["unparsed"]) > 15:
            print("  ... 还有 %d 处" % (len(data["unparsed"]) - 15))

    if data["dynamic"]:
        print("\n拼接名（静态不可判，列为人工确认项）")
        for d in data["dynamic"][:10]:
            print("  %-28s L%-6d %s | %s" % (d["file"], d["line"], d["kind"], d["text"]))
        if len(data["dynamic"]) > 10:
            print("  ... 还有 %d 处" % (len(data["dynamic"]) - 10))

    # 只在 1 个文件里出现、且列数为 0 的，多半是解析残留或临时表 —— 单独列出来
    empty = [k for k, v in data["tables"].items() if not v["cols"] and k != "sqlite_sequence"]
    if empty:
        print("\n零列（解析没拿到列定义，需人工确认）：%s" % ", ".join(empty[:12]))

    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=1, sort_keys=True)
        print("\n已写出 %s" % a.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
