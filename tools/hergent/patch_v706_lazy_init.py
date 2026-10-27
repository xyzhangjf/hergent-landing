#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v706：给「读了懒建表、却自己不 ensured」的 9 个函数补一行 ensure。

## 病灶

仓库里有一族表是**懒建**的：DDL 写在 `_init_qms_tables()` / `_init_wms_tables()` /
`_init_bi_tables()` / `_init_recruitment_tables()` / `_init_tax_tables()` /
`_init_gaap_tables()` / `_init_serial_numbers()` / `init_deferred_tables()` 里，
第一次**写**的时候才建表。生产实测这 8 组表里 **24 张在任何库里都不存在**
（QMS 质量、WMS 拣货波次、BI 看板、招聘、税务、GAAP 准则、序列号、递延收入）。

于是有一个只有真去点那个功能才会撞上的坑：

    ncr_disposition()  →  UPDATE non_conformances  ← 表还没建 ⇒ no such table ⇒ 500

写路径都记得调 `_init_*()`，但 **9 个读/改路径忘了**。它们不会在启动时报错、
不会在日志里留痕，只会在用户第一次点进那个页面时变成一个 500。

## 修法（为什么不"提前把表建出来"）

把 24 张表提前建出来会改动三台库的 schema，且必须同步保证 doctor 的 master↔tenant
一致 —— 动静远大于收益，且那 8 个模块目前在生产**从未被使用过**（表一张都没建起来
就是证据）。所以这里用仓库里**已有的写法**（`inspection_plan_create()` 就是这么干的）：
读之前先 ensure。DDL 仍只有代码里那一份，不复制第二份。

幂等：函数里已有 ensure 就跳过。`--revert` 用 `.bak-v706lazy` 回滚。
"""
from __future__ import annotations

import argparse
import os
import re
import sys

# 函数名 → 该调用的 ensure
TARGETS = {
    "ncr_disposition": "_init_qms_tables",
    "ncr_close": "_init_qms_tables",
    "inspection_with_aql": "_init_qms_tables",
    "job_close": "_init_recruitment_tables",
    "application_advance": "_init_recruitment_tables",
    "period_close_checklist": "init_deferred_tables",
    "pick_wave_list": "_init_wms_tables",
    "pick_wave_detail": "_init_wms_tables",
    "wave_complete": "_init_wms_tables",
}

BAK = ".bak-v706lazy"


def _body_indent(line: str, def_line: str) -> str:
    """取函数体的缩进（有的函数用 tab，有的用 4 空格，必须就地跟随）。"""
    m = re.match(r"^(\s*)", def_line)
    base = m.group(1) if m else ""
    if line.startswith("\t"):
        return base + "\t"
    m2 = re.match(r"^(\s+)", line)
    if m2:
        return m2.group(1)
    return base + "    "


def patch_file(path: str, dry: bool):
    src = open(path, encoding="utf-8").read()
    lines = src.split("\n")

    # 倒序插入，保证行号不漂
    edits = []
    for i, line in enumerate(lines):
        m = re.match(r"^def (\w+)\(", line)
        if not m or m.group(1) not in TARGETS:
            continue
        name, ensure = m.group(1), TARGETS[m.group(1)]
        j = i + 1
        while j < len(lines) and not lines[j].strip():
            j += 1
        insert_at = i + 1
        if j < len(lines):
            s = lines[j].strip()
            if s.startswith('"""') or s.startswith("'''"):
                q = s[:3]
                if s.count(q) >= 2 and len(s) > 3:
                    insert_at = j + 1
                else:
                    k = j + 1
                    while k < len(lines) and q not in lines[k]:
                        k += 1
                    insert_at = k + 1
            else:
                insert_at = j
        # 🔴 幂等判据必须**只在本函数体内**找：写成 `lines[i:insert_at+8]` 会越过函数
        #    边界、看到**下一个**函数的 ensure 调用 ⇒ 把没改过的函数判成"已有"而静默跳过。
        #    这是本脚本第一版就踩中的坑，dry-run 报「改动 7 处（目标 9 个函数）」暴露的。
        body_end = len(lines)
        for k in range(i + 1, len(lines)):
            if re.match(r"^(def |class |@)", lines[k]):
                body_end = k
                break
        head = "\n".join(lines[i:body_end])
        if re.search(r"^\s*%s\(" % ensure, head, re.M):
            edits.append((insert_at, "", name, "already"))
            continue
        insert_at = min(insert_at, body_end)
        ref = lines[insert_at] if insert_at < len(lines) else lines[i + 1]
        ind = _body_indent(ref, lines[i])
        edits.append((insert_at, "%s%s()  # v706：读之前先 ensure（懒建表，否则首次访问 no such table）"
                      % (ind, ensure), name, ensure))

    applied = [e for e in edits if e[1]]
    for at, text, _, _ in sorted(applied, key=lambda x: -x[0]):
        lines.insert(at, text)
    new = "\n".join(lines)

    if not dry and applied:
        if not os.path.exists(path + BAK):
            open(path + BAK, "w", encoding="utf-8").write(src)
        open(path, "w", encoding="utf-8").write(new)
    return edits, len(applied)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="/opt/hergent-erp")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--revert", action="store_true")
    ap.add_argument("--strict", action="store_true",
                    help="9 个目标必须全部找到才退出 0（生产用它自证没漏改）")
    a = ap.parse_args()

    path = os.path.join(a.root, "erp_db.py")
    if not os.path.exists(path):
        print("[v706lazy] 找不到 %s" % path, file=sys.stderr)
        return 1

    if a.revert:
        bak = path + BAK
        if not os.path.exists(bak):
            print("[v706lazy] 无备份可回滚：%s" % bak, file=sys.stderr)
            return 1
        open(path, "w", encoding="utf-8").write(open(bak, encoding="utf-8").read())
        print("[v706lazy] 已回滚，来源 %s" % bak)
        return 0

    edits, n = patch_file(path, a.dry_run)
    for at, text, name, note in edits:
        if note == "already":
            print("  = %-28s 已有 ensure，跳过" % name)
        else:
            print("  + %-28s L%-6d %s" % (name, at + 1, text.strip()[:70]))
    print("\n[v706lazy] %s：改动 %d 处（目标 %d 个函数）"
          % ("dry-run" if a.dry_run else "已写入", n, len(TARGETS)))
    found = len(edits)
    if a.strict and found != len(TARGETS):
        print("[v706lazy] ❗ --strict：只找到 %d / %d 个目标函数，可能有函数被改名或删除"
              % (found, len(TARGETS)), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
