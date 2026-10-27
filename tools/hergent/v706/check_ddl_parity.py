#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把「代码声明的 schema」与「真实库的 schema」对账（只读）。

## 为什么需要它（与 doctor 的分工）

`migrations.doctor` 的对账方向是 **租户库 vs 主库**，它能发现「主库有、租户库没有」。
它**看不见**另一个方向：

    代码里有 `CREATE TABLE xxx`，但**任何一台库都没有这张表**。

这种表不会报错、不会告警，只会在第一次被 SELECT 时炸 `no such table`。它是
`_safe_migrate` 之外的第二种写法（DDL 直接写在函数体里，`db/queries/*.py` 那批
甚至是同一批迁移的第二份拷贝）带来的必然盲区。

## 三档结论（只有第一档是故障）

| 现象 | 定性 | 说明 |
|---|---|---|
| 代码有、**哪个库都没有** | 🔴 故障 | 该 DDL 从没在任何库上跑成过，或只在已消失的库里跑过 |
| 代码有、主库有、某租户库没有 | 🔴 故障 | 该 ALTER/CREATE 没下发到这台库 |
| 代码有、**只有租户库有**、主库没有 | ✅ 正常 | 租户专属表；`tenant_db_init` 的 `_copy_tenant_only_tables()` 已兜底 |
| 库里有、代码里没有 | ⚠️ 未知来源 | 多为 f-string 拼表名建的（`_copy_tenant_only_tables` 注释称有 14 张），列出来备查 |

用法：
    python3 tools/hergent/v706/check_ddl_parity.py --ddl /tmp/ddl.json --schema /tmp/schema_dump.json
    # 附加 --json 输出机器可读结果；--fail-on-fault 有故障时退出 2
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MIG = os.path.join(os.path.dirname(HERE), "v705", "migrations")


def _load_list(name):
    p = os.path.join(MIG, name)
    out = set()
    if os.path.exists(p):
        for line in open(p, encoding="utf-8"):
            line = line.split("#")[0].strip()
            if line:
                out.add(line.lower())
    return out


def load_platform():
    return _load_list("platform_tables.txt")


def load_other_db():
    return _load_list("other_db_modules.txt")


INIT_FUNC = re.compile(r"^_?init_|^ensure_.*_tables$")


def _func_name(entry):
    """`erp_db.py._init_qms_tables` → `_init_qms_tables`。"""
    return entry.rsplit(".", 1)[-1].lstrip(".")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ddl", required=True)
    ap.add_argument("--schema", required=True)
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--fail-on-fault", action="store_true")
    a = ap.parse_args()

    ddl = json.load(open(a.ddl, encoding="utf-8"))
    schema = json.load(open(a.schema, encoding="utf-8"))
    platform = load_platform()
    other_db = load_other_db()
    dbs = list(schema)
    master = "erp.db"
    tenants = [d for d in dbs if d != master]

    decl_tables = ddl["tables"]
    decl_cols = ddl["columns"]

    def cols_of(db, table):
        return {c.lower() for c in schema[db].get(table, [])} if table in schema[db] else None

    fault_missing_everywhere = []
    lazy_on_demand = []          # 建在 _init_* 里：首次用到才建，库里没有是正常
    foreign_db = []              # 建在自己的库文件里：不归 erp.db 管
    inline_create = []           # 建在普通函数体里：需人工确认"建在用之前"
    fault_missing_in_tenant = []
    tenant_only = []
    ok_all = []

    for t, info in decl_tables.items():
        if t in platform:
            continue                          # 平台表只应存在于主库，另行判断
        have = [db for db in dbs if t in schema[db]]
        if not have:
            mods = {f.split(":")[0] for f in info["files"]}
            funcs = [_func_name(x) for x in info.get("funcs", [])]
            if mods and mods.issubset(other_db):
                foreign_db.append((t, sorted(mods)))
            elif funcs and all(INIT_FUNC.match(f or "") for f in funcs):
                lazy_on_demand.append((t, funcs[0]))
            elif funcs and all(f and f != "<module>" for f in funcs):
                # 建在**普通函数体里**：多为"先建表再插"的自愈写法（refunds 就是这样）。
                # 静态看不出建与用的先后，所以只列出来，不判故障 —— 但必须人看。
                inline_create.append((t, funcs[0], info["files"][0]))
            else:
                fault_missing_everywhere.append((t, info["files"], funcs))
        elif master not in have:
            tenant_only.append((t, have))
        elif all(db in have for db in tenants):
            ok_all.append(t)
        else:
            miss = [db for db in tenants if db not in have]
            fault_missing_in_tenant.append((t, miss))

    # 平台表：应当只在主库
    platform_leak = []
    for t in sorted(platform):
        for db in tenants:
            if t in schema[db]:
                platform_leak.append((t, db))

    # 列：只查表已存在的情形（表都缺已经在上面报了）
    #
    # 🔴 「缺列」必须分两类，否则会把设计当故障：
    #   · 只在**主库**缺、所有租户库都有 ⇒ 该 ALTER 写在"租户补丁循环"里
    #     （`_patch_tenant_*` 只遍历 tenant_*.db）。新租户由 `_ensure_tenant_module_tables()`
    #     补上，主库的这张表本身不承载业务 ⇒ **不是故障**，但要知道主库不是超集。
    #   · **任一租户库**缺 ⇒ 真故障（这台库没拿到那条 ALTER）。
    fault_cols, master_lag_cols = [], []
    for key, files in decl_cols.items():
        t, c = key.split(".", 1)
        if t in platform:
            continue
        miss_tenants, miss_master = [], False
        for db in dbs:
            have = cols_of(db, t)
            if have is None:
                continue
            if c not in have:
                if db == master:
                    miss_master = True
                else:
                    miss_tenants.append(db)
        if miss_tenants:
            fault_cols.append({"table": t, "column": c, "dbs": miss_tenants, "files": files})
        elif miss_master:
            master_lag_cols.append((t, c))

    # 库里有、代码没声明（f-string 拼名等）
    undeclared = []
    for db in dbs:
        for t in schema[db]:
            if t in decl_tables or t in platform:
                continue
            undeclared.append(t)

    faults = len(fault_missing_everywhere) + len(fault_missing_in_tenant) + len(fault_cols)

    if a.json:
        print(json.dumps({
            "declared_tables": len(decl_tables), "declared_columns": len(decl_cols),
            "faults": faults,
            "missing_everywhere": [{"table": t, "files": f, "funcs": fn}
                                   for t, f, fn in fault_missing_everywhere],
            "lazy_on_demand": [{"table": t, "func": f} for t, f in lazy_on_demand],
            "inline_create": [{"table": t, "func": f, "at": loc} for t, f, loc in inline_create],
            "master_lag_columns": [{"table": t, "column": c} for t, c in master_lag_cols],
            "foreign_db": [{"table": t, "modules": m} for t, m in foreign_db],
            "missing_in_tenant": [{"table": t, "missing_in": m} for t, m in fault_missing_in_tenant],
            "missing_columns": fault_cols,
            "tenant_only": [{"table": t, "in": h} for t, h in tenant_only],
            "platform_leak": [{"table": t, "db": d} for t, d in platform_leak],
            "undeclared_in_db": sorted(set(undeclared)),
        }, ensure_ascii=False, indent=1))
        return 2 if (a.fail_on_fault and faults) else 0

    W = 96
    print("=" * W)
    print("代码声明 %d 张表 / %d 个列  ⇄  %s" % (len(decl_tables), len(decl_cols), " / ".join(dbs)))
    print("=" * W)

    print("\n【一】代码有、哪个库都没有 —— 其中真故障 %d 张" % len(fault_missing_everywhere))
    if fault_missing_everywhere:
        print("   🔴 故障：DDL 不在任何 init 函数里、也不属于独立库 —— 没人建过它")
        for t, files, funcs in fault_missing_everywhere[:40]:
            print("   %-32s %-26s %s" % (t, ",".join(funcs[:2]) or "?", files[0]))
        if len(fault_missing_everywhere) > 40:
            print("   ... 还有 %d 张" % (len(fault_missing_everywhere) - 40))
    else:
        print("   ✅ 无（下面两类不算故障）")
    print("   ── 按需懒建（建在 _init_* 里，首次使用才建）…… %d 张" % len(lazy_on_demand))
    if lazy_on_demand:
        print("      " + ", ".join("%s(%s)" % (t, f) for t, f in lazy_on_demand[:8])
              + (" ..." if len(lazy_on_demand) > 8 else ""))
        print("      ⚠️ 这类表在首次访问前不存在是设计如此，但**读路径必须先 ensure**，"
              "否则第一次点进那个页面就是 500（v706 已补 9 处）")
    print("   ── 建在独立库（不归 erp.db 管）…… %d 张" % len(foreign_db))
    if foreign_db:
        print("      " + ", ".join("%s(%s)" % (t, ",".join(m)) for t, m in foreign_db[:8]))
    print("   ── 建在普通函数体里（自建自用，需人工确认建在用之前）…… %d 张" % len(inline_create))
    if inline_create:
        for t, f, loc in inline_create:
            print("      %-28s %-34s %s" % (t, f, loc))

    print("\n【二】代码有、主库有、某租户库没有 …… %d 张" % len(fault_missing_in_tenant))
    if fault_missing_in_tenant:
        print("   🔴 故障：某条 CREATE 没下发到这台库")
        for t, miss in fault_missing_in_tenant[:30]:
            print("   %-34s 缺于 %s" % (t, ", ".join(miss)))

    print("\n【三】表在库里、但列不在 —— 真故障 %d 处" % len(fault_cols))
    if fault_cols:
        print("   🔴 故障：某台**租户库**没拿到那条 ALTER")
        for f in fault_cols[:30]:
            print("   %-28s.%-20s 缺于 %s" % (f["table"], f["column"], ", ".join(f["dbs"])))
        if len(fault_cols) > 30:
            print("   ... 还有 %d 处" % (len(fault_cols) - 30))
    else:
        print("   ✅ 无")
    print("   ── 只有主库缺、租户库都有（ALTER 写在租户补丁循环里）…… %d 处"
          % len(master_lag_cols))
    if master_lag_cols:
        print("      " + ", ".join("%s.%s" % (t, c) for t, c in master_lag_cols[:10])
              + (" ..." if len(master_lag_cols) > 10 else ""))
        print("      ⚠️ 这说明**主库不是 schema 超集**：新租户靠 `_ensure_tenant_module_tables()`"
              " 补列，主库对应表无业务数据故无影响。")

    print("\n【四】只在租户库、主库没有 …… %d 张（正常，建库时由对账补齐）"
          % len(tenant_only))
    if tenant_only:
        print("   " + ", ".join(t for t, _ in tenant_only[:14]) + (" ..." if len(tenant_only) > 14 else ""))

    print("\n【五】库里有、代码没声明（f-string 拼名建的表）…… %d 张"
          % len(set(undeclared)))
    if undeclared:
        print("   " + ", ".join(sorted(set(undeclared))[:16]) + (" ..." if len(set(undeclared)) > 16 else ""))

    if platform_leak:
        print("\n【六】平台表出现在租户库（v706 已清过，再出现即回归）…… %d 处" % len(platform_leak))
        for t, d in platform_leak:
            print("   %-24s %s" % (t, d))

    print("\n" + "-" * W)
    print("结论：真故障 %d 处（%d 张表全库缺失 / %d 张租户缺表 / %d 处租户缺列）。"
          % (faults, len(fault_missing_everywhere), len(fault_missing_in_tenant), len(fault_cols)))
    print("      不算故障但需知晓：%d 张按需懒建、%d 张建在独立库、%d 张函数内自建、"
          "%d 张租户专属、%d 处只有主库缺列、%d 张库里有而代码无字面声明。"
          % (len(lazy_on_demand), len(foreign_db), len(inline_create), len(tenant_only),
             len(master_lag_cols), len(set(undeclared))))
    return 2 if (a.fail_on_fault and faults) else 0


if __name__ == "__main__":
    sys.exit(main())
