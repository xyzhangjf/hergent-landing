#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""`_safe_migrate` / `_safe_migrate_script` 存量盘点 + 冻结基线 + 漂移检查。

## 这套机制到底哪里不可靠（不要在报告里含糊过去）

`erp_db.py::_safe_migrate(name, sql)` 的行为是：**按名字**查 `_migrations`，
跑过就 `return`，没跑过就执行。它解决了「重复执行」，但留下三个静默窟窿：

1. **改了历史迁移的 SQL，不会重跑也不会报错**。名字没变 ⇒ 直接 return ⇒
   「改了 SQL 的那台库」与「按新 SQL 建的新库」同时声称 ok，结构却不同。
   这是唯一一类**永远不会出现在任何日志里**的偏差。
2. **没有顺序与版本概念**，无法回答「这台库是几号版本」——这正是 v705 引入
   `schema_patches` 的原因。
3. **调用点在源码里是裸 DDL**，没人能一眼看出「这一版到底改过哪些表」；
   而 400 处调用散落在 20 多个文件里（其中 `erp_db.py` 一个文件 429 处出现）。

## 本工具的定位：**冻结存量、堵住增量**，不重写历史

把这 400 处逐个改写成 `patches/00NN_*.py` 是**负收益**：它们对应的 DDL 早在
生产跑过，改写只会让"哪台库跑过哪一版"这件事重新变得不可判定，却换不来任何
正确性提升。真正要治的是两件事，都能在源码层面机械判定：

  · 存量被**悄悄改动** ⇒ 用内容指纹（sha256）比对，`--check` 直接失败
  · 新增 DDL **绕过版本管理** ⇒ 名字集合比对，新名字进来就失败，提示写成 patch

所以 `legacy_baseline.txt` 是这份清单的**唯一真相源**：
它记录「2026-10-27 收编那一刻，这 400 条迁移各自长什么样」。
此后任何 SQL 改动、任何新增 `_safe_migrate` 调用，`--check` 都会红。

## 用法

    python3 inventory_safe_migrate.py /opt/hergent-erp                  # 盘点（人读）
    python3 inventory_safe_migrate.py /opt/hergent-erp --json           # 机器可读
    python3 inventory_safe_migrate.py /opt/hergent-erp --write-baseline # 生成/更新基线
    python3 inventory_safe_migrate.py /opt/hergent-erp --check          # 验收（CI/cron）

`--check` 退出码：0 = 与基线一致；2 = 有漂移（改了历史迁移 / 新增了裸 DDL）；1 = 运行错误。
"""
import argparse
import ast
import hashlib
import json
import os
import re
import sys

WRAPPERS = {"_safe_migrate", "_safe_migrate_script"}
BASELINE_HEADER = """# `_safe_migrate` 存量基线（收编时间 2026-10-27，v706）
#
# 一行一条：<包装函数> <迁移名> <内容指纹前16位> <所在文件>:<行号>
#
# 这份文件是「历史迁移长什么样」的唯一真相源。**不要手改**：
#   · 要新增 DDL ⇒ 写成 migrations/patches/00NN_*.py，不要往这里加
#   · 确认要改某条历史迁移 ⇒ 先想清楚"已经跑过它的库怎么办"，然后
#     `--write-baseline` 更新基线并在提交说明里写清为什么
#
# 校验：python3 tools/hergent/v706/inventory_safe_migrate.py /opt/hergent-erp --check
"""


def _sha(text):
    norm = (text or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    return hashlib.sha256(norm.encode("utf-8")).hexdigest()[:16]


def _targets(sql):
    """从 DDL 里猜出涉及的表名（只用于人读与分组，不参与判定）。"""
    out = []
    for pat in (r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?\"?(\w+)\"?",
                r"ALTER\s+TABLE\s+\"?(\w+)\"?",
                r"CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?\"?\w+\"?\s+ON\s+\"?(\w+)\"?"):
        for m in re.finditer(pat, sql or "", re.I):
            t = m.group(1)
            if t.lower() not in ("table", "index") and t not in out:
                out.append(t)
    return out


def collect(root):
    """→ [dict]，每个 dict 是一次 `_safe_migrate*` 调用。"""
    rows = []
    for dirpath, dirnames, files in os.walk(root):
        dirnames[:] = [d for d in dirnames
                       if d not in ("__pycache__", "node_modules", "backups")
                       and not d.startswith(".")]
        for fn in sorted(files):
            if not fn.endswith(".py"):
                continue
            path = os.path.join(dirpath, fn)
            try:
                src = open(path, encoding="utf-8", errors="replace").read()
                tree = ast.parse(src)
            except Exception as e:
                rows.append({"file": os.path.relpath(path, root), "line": 0,
                             "wrapper": "?", "name": "?", "error": str(e)[:120]})
                continue
            for node in ast.walk(tree):
                if not isinstance(node, ast.Call):
                    continue
                f = node.func
                fname = f.id if isinstance(f, ast.Name) else (
                    f.attr if isinstance(f, ast.Attribute) else None)
                if fname not in WRAPPERS:
                    continue
                args = node.args
                name = args[0].value if args and isinstance(args[0], ast.Constant) \
                    and isinstance(args[0].value, str) else None
                sql = None
                expr = None
                if len(args) > 1:
                    a = args[1]
                    if isinstance(a, ast.Constant) and isinstance(a.value, str):
                        sql = a.value
                    else:
                        # 拼接 / f-string / 常量引用（如 BRAND_PENDING_DDL）：
                        # 取**表达式源码**做指纹。这样「改了 f-string 里的 SQL 片段」
                        # 仍然能被 --check 抓到（比标成 dynamic 什么都不管要强）；
                        # 唯一漏的是「改的是被引用的常量本身」，那属于改常量、另行 review。
                        try:
                            expr = ast.unparse(a)
                        except Exception:
                            expr = None
                rows.append({
                    "file": os.path.relpath(path, root),
                    "line": node.lineno,
                    "wrapper": fname,
                    "name": name,
                    "checksum": (_sha(sql) if sql is not None
                                 else ("xpr:" + _sha(expr) if expr else "dynamic")),
                    "targets": _targets(sql or expr or ""),
                    "has_literal": sql is not None,
                    # 供 raw_ddl_outside() 从总额里扣除（见该函数注释）
                    "_literal_count": (sql or "").count("CREATE TABLE IF NOT EXISTS"),
                })
    return rows


def _key(r):
    return "%s %s %s %s:%d" % (r["wrapper"], r["name"], r["checksum"], r["file"], r["line"])


def raw_ddl_outside(root, rows):
    """统计**不在 `_safe_migrate` 体系内**的裸 DDL。

    为什么必须单独统计：本工具冻结的是 389 处 `_safe_migrate*` 调用，但仓里还有另一族
    同型的东西 —— 直接写在函数体里的 `CREATE TABLE IF NOT EXISTS ...` + 裸 try/except
    （`db/connection.py::log_migration_warn` 的注释自己承认：「与 erp_db 的 `_safe_migrate`
    是**同一批迁移的两份拷贝**」）。不统计它们，报告就会给人一种"已经收编干净了"的错觉。

    算法：按文件数 `CREATE TABLE IF NOT EXISTS` 的**原文出现次数**，减掉本文件中
    作为 `_safe_migrate` 字面量 SQL 传进去的次数 ⇒ 剩下的就是账外裸 DDL（近似，
    拼接型 SQL 里的可能被算作账外，只会高估不会少报）。
    """
    raw = {}
    for dirpath, dirnames, files in os.walk(root):
        dirnames[:] = [d for d in dirnames
                       if d not in ("__pycache__", "node_modules", "backups")
                       and not d.startswith(".")]
        for fn in files:
            if not fn.endswith(".py"):
                continue
            p = os.path.join(dirpath, fn)
            rel = os.path.relpath(p, root)
            try:
                txt = open(p, encoding="utf-8", errors="replace").read()
            except Exception:
                continue
            n = txt.count("CREATE TABLE IF NOT EXISTS")
            if n:
                raw[rel] = n
    inside = {}
    for r in rows:
        if r.get("name") is None:
            continue
        c = r.get("_literal_count", 0)
        if c:
            inside[r["file"]] = inside.get(r["file"], 0) + c
    out = {}
    for f, n in raw.items():
        left = n - inside.get(f, 0)
        if left > 0:
            out[f] = left
    return out, sum(raw.values()), sum(inside.values())


def report(rows, root=None):
    total = len(rows)
    named = [r for r in rows if r["name"]]
    dyn = [r for r in rows if not r.get("has_literal")]
    no_name = [r for r in rows if not r["name"]]
    by_file = {}
    for r in rows:
        by_file.setdefault(r["file"], 0)
        by_file[r["file"]] += 1
    dup = {}
    for r in named:
        dup.setdefault(r["name"], []).append(r)
    dup_conflict = {k: v for k, v in dup.items() if len({x["checksum"] for x in v}) > 1}
    tables = {}
    for r in named:
        for t in r.get("targets", []):
            tables[t] = tables.get(t, 0) + 1

    print("=" * 92)
    print("`_safe_migrate` 存量盘点  共 %d 处调用" % total)
    print("=" * 92)
    print("  按文件：")
    for f, n in sorted(by_file.items(), key=lambda x: -x[1]):
        print("    %-40s %3d" % (f, n))
    print("\n  SQL 非字面量（拼接/常量引用，静态不可校验）：%d 处" % len(dyn))
    for r in dyn[:15]:
        print("    %-36s L%-6d %s" % (r["file"], r["line"], r["name"]))
    if len(dyn) > 15:
        print("    … 还有 %d 处（见 --json）" % (len(dyn) - 15))
    print("\n  迁移名为空/非字面量：%d 处" % len(no_name))
    for r in no_name[:10]:
        print("    %-36s L%-6d" % (r["file"], r["line"]))
    print("\n  同名不同 SQL（**最危险**：同一个名字在两处被定义，后来者永不执行）：%d 组"
          % len(dup_conflict))
    for k, v in list(dup_conflict.items())[:10]:
        print("    %-42s %d 处：%s" % (k, len(v), ", ".join("%s:%d" % (x["file"], x["line"]) for x in v[:4])))
    print("\n  涉及表的分布（前 12）：")
    for t, n in sorted(tables.items(), key=lambda x: -x[1])[:12]:
        print("    %-36s %3d 条迁移改写它" % (t, n))
    xpr = [r for r in named if str(r["checksum"]).startswith("xpr:")]
    if root:
        out, raw_total, in_mig = raw_ddl_outside(root, rows)
        print("\n  账外裸 DDL（`CREATE TABLE IF NOT EXISTS` 不在 `_safe_migrate` 里）："
              "总 %d 处，其中 %d 处在迁移字面量内，**%d 处账外**"
              % (raw_total, in_mig, sum(out.values())))
        for f, n in sorted(out.items(), key=lambda x: -x[1])[:8]:
            print("    %-40s %3d" % (f, n))

    print("\n  结论：%d 处中 %d 处 SQL 为字面量（内容可逐字校验），%d 处为拼接/常量引用"
          "（指纹落在**表达式**上，能抓到改片段、抓不到改被引用的常量），%d 处名字非字面量"
          "（不入基线，需人工确认）。"
          % (total, len([r for r in named if r.get("has_literal")]), len(xpr), len(no_name)))
    return {"total": total, "dynamic": len(dyn), "xpr": len(xpr), "no_name": len(no_name),
            "dup_conflict": len(dup_conflict), "by_file": by_file}


def write_baseline(rows, path):
    lines = [BASELINE_HEADER]
    for r in sorted(rows, key=lambda x: (x["file"], x["line"])):
        if r["name"] is None:
            continue
        lines.append(_key(r) + "\n")
    with open(path, "w", encoding="utf-8") as f:
        f.writelines(lines)
    print("已写入基线：%s（%d 行）" % (path, len(lines) - 1))


def load_baseline(path):
    ent = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            s = line.strip()
            if not s or s.startswith("#"):
                continue
            parts = s.split()
            if len(parts) < 3:
                continue
            ent.setdefault(parts[1], set()).add(parts[2])   # name -> {checksum}
    return ent


def check(rows, path):
    """→ 退出码。只比「名字 → 指纹」这一层：
        · 名字不在基线 ⇒ 新增了裸 DDL（应当写成 patch）
        · 名字在、指纹变了 ⇒ 改动历史迁移（已跑过的库永远不会拿到新逻辑）
        · 名字在基线、源码里没了 ⇒ 删了历史迁移（信息，不算错，但要报）
    """
    base = load_baseline(path)
    cur, broken = {}, []
    for r in rows:
        if r.get("error") or "checksum" not in r:
            # 源码本身语法坏/AST 解析失败：这是另一种故障（而且是更严重的），
            # 必须报出来，不能让检查器自己 KeyError 崩掉 —— 崩掉的话 CI 里看到的
            # 是"工具坏了"，而不是"有人提交了坏文件"。
            broken.append(r)
            continue
        if r["name"] is None:
            continue
        cur.setdefault(r["name"], set()).add(r["checksum"])
    added = sorted(set(cur) - set(base))
    removed = sorted(set(base) - set(cur))
    changed = sorted(n for n in set(cur) & set(base) if cur[n] != base[n])

    print("=" * 92)
    print("基线校验  基线 %d 条 / 源码 %d 条" % (len(base), len(cur)))
    print("=" * 92)
    bad = False
    if broken:
        bad = True
        print("\n❌ 有 %d 个文件解析失败（语法错误，无法校验其中的迁移）：" % len(broken))
        for r in broken[:10]:
            print("    %-36s L%-6d %s" % (r["file"], r["line"], r.get("error", "")[:80]))
    if added:
        bad = True
        print("\n❌ 新增了 %d 条裸 DDL 迁移（必须改写成 migrations/patches/00NN_*.py）：" % len(added))
        for n in added:
            loc = [("%s:%d" % (r["file"], r["line"])) for r in rows if r["name"] == n]
            print("    %-44s %s" % (n, ", ".join(loc[:3])))
    if changed:
        bad = True
        print("\n❌ 有 %d 条历史迁移的内容被改动（已经跑过它的库**永远不会**拿到新逻辑）：" % len(changed))
        for n in changed:
            loc = [("%s:%d" % (r["file"], r["line"])) for r in rows if r["name"] == n]
            print("    %-44s %s" % (n, ", ".join(loc[:3])))
        print("    改法：新增一个 patch 表达这次变更；或确认无误后用 --write-baseline 重签基线")
    if removed and not broken:
        # 有文件解析失败时，「源码里没有」这个结论不可信（读不到 ≠ 不存在），
        # 报出来就是误导 —— 那时上面已经报了「解析失败」，不再叠加一条假消息。
        print("\n⚠️  基线里有 %d 条在源码中已不存在（仅信息）：%s" % (len(removed), ", ".join(removed[:8])))
    if not bad:
        print("\n✅ 与基线一致：%d 条历史迁移既没有被改动，也没有新增裸 DDL。" % len(cur))
    return 2 if bad else 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("root", help="后端源码目录（生产 /opt/hergent-erp）")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--write-baseline", action="store_true")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--baseline", default=os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),   # tools/hergent
        "v705", "migrations", "legacy_baseline.txt"))
    a = ap.parse_args()
    if not os.path.isdir(a.root):
        print("目录不存在：%s" % a.root, file=sys.stderr)
        return 1
    rows = collect(a.root)
    if a.json:
        print(json.dumps({"rows": rows}, ensure_ascii=False, indent=2))
        return 0
    if a.check:
        if not os.path.exists(a.baseline):
            print("基线不存在：%s（先 --write-baseline）" % a.baseline, file=sys.stderr)
            return 1
        return check(rows, a.baseline)
    if a.write_baseline:
        write_baseline(rows, a.baseline)
        return 0
    report(rows, a.root)
    return 0


if __name__ == "__main__":
    sys.exit(main())
