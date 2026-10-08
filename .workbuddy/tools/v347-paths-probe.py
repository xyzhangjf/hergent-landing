#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v347 只读探针：模块映射解析顺序 + 默认权限真值。

为什么必须做：`_PATH_MODULE_MAP` 是 **首个 startswith 命中即停**，而本轮把
`/api/forecast` 从 `data` 改到 `forecast` —— 若它跑到 `/api/forecast-submissions`
前面，小程序报单链路会**全线 403**（那是 P0 事故，且前端只会显示"无权限"）。
所以判据不是"我写没写对"，而是**实测解析到哪一个**（v332 学过的同一课）。

从源码 AST 抽**真实**常量（不照抄），所以测的是真实实现。

用法： /usr/bin/python3 .workbuddy/tools/v347-paths-probe.py
"""
import ast
import os
import sys

ERP = os.environ.get("ERP_REPO", "/Users/zhangjunfeng/Documents/hergent-erp")
SERVER_PY = os.path.join(ERP, "server", "server.py")
CORE_PY = os.path.join(ERP, "server", "core.py")


def lit(path, name):
    tree = ast.parse(open(path, encoding="utf-8").read())
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for t in node.targets:
                if isinstance(t, ast.Name) and t.id == name:
                    return ast.literal_eval(node.value)
    raise SystemExit("找不到常量 %s in %s" % (name, path))


PMAP = lit(SERVER_PY, "_PATH_MODULE_MAP")
DEFPERM = lit(CORE_PY, "_DEFAULT_PERMS")
ALLMODS = lit(CORE_PY, "_ALL_MODULES")
IMPACT = lit(CORE_PY, "MODULE_IMPACT")


def resolve(path):
    """复刻 server.py 的裁决逻辑：首个 startswith 命中即停。"""
    for prefix, mod in PMAP.items():
        if path.startswith(prefix):
            return mod
    return None


print("=" * 78)
print("① 路径 → 模块 解析实测（首个 startswith 命中即停）")
print("=" * 78)
CASES = [
    # (路径, 期望模块, 说明)
    ("/api/forecast/periods",            "forecast",       "报单主链（本轮改判）"),
    ("/api/forecast/orders/5",           "forecast",       "报单主链"),
    ("/api/forecast/accuracy",           "forecast",       "报单主链"),
    ("/api/forecast/submissions",        "forecast",       "⚠️ 注意：这是**另一个**路径（非 -submissions）"),
    ("/api/forecast-submissions",        "data",           "🔴 小程序报单提交（必须仍是 data）"),
    ("/api/forecast-submissions/my",     "data",           "🔴 小程序「我的报单」（必须仍是 data）"),
    ("/api/forecast-submissions/pending-summary", "data",  "🔴 小程序待报汇总（必须仍是 data）"),
    ("/api/forecast-audit/periods",      "forecast-audit", "🔴 v332 拆出的审核（顺序须在 forecast 之前）"),
    ("/api/products",                    "data",           "档案类（小程序也在用）"),
    ("/api/products/fill-search",        "data",           "档案类"),
    ("/api/cron/tasks",                  "cron",           "定时任务（本轮撤主管授权）"),
    ("/api/bid-radar/x",                 "bid",            "招投标雷达（主管保留）"),
]
fails = []
for path, expect, why in CASES:
    got = resolve(path)
    ok = got == expect
    if not ok:
        fails.append(path)
    print("  %s  %-46s → %-16s %s" % ("PASS" if ok else "FAIL", path, got, why))

print()
print("=" * 78)
print("② `_DEFAULT_PERMS` 真值（本轮改的三个角色）")
print("=" * 78)
for role in ("admin", "boss", "accountant", "supervisor", "sales", "staff", "guide", "driver"):
    v = DEFPERM.get(role)
    if v is None:
        print("  %-12s （不在表里）" % role)
        continue
    s = "*" if v == ["*"] else ",".join(v)
    print("  %-12s cron=%-5s forecast=%-9s bid=%-5s data=%-5s | %s"
          % (role,
             "cron" in v if v != ["*"] else "通配",
             "forecast" in v if v != ["*"] else "通配",
             "bid" in v if v != ["*"] else "通配",
             "data" in v if v != ["*"] else "通配",
             s[:78]))

print()
print("=" * 78)
print("③ 交叉一致性（三处缺一即静默失效）")
print("=" * 78)
chk = []
chk.append(("`forecast` 在 `_ALL_MODULES`（权限页可勾）", "forecast" in ALLMODS))
chk.append(("`forecast` 在 `_PATH_MODULE_MAP` 的值域里（接口真按它判）",
            "forecast" in set(PMAP.values())))
chk.append(("`forecast` 在 `MODULE_IMPACT` 里（界面上能说清勾了会怎样）",
            "forecast" in IMPACT))
chk.append(("`MODULE_IMPACT['data'].entries` 已无「预报订货管理」（不许两处都说是它）",
            "预报订货管理" not in IMPACT.get("data", {}).get("entries", [])))
chk.append(("`MODULE_IMPACT['forecast'].entries` == ['预报订货管理']",
            IMPACT.get("forecast", {}).get("entries") == ["预报订货管理"]))
chk.append(("`_MODULE_CN` 有 `forecast` 译名（403 文案可读）",
            "forecast" in lit(SERVER_PY, "_MODULE_CN")))
chk.append(("主管**不再**持 `cron`（本轮目标 ①）", "cron" not in DEFPERM["supervisor"]))
chk.append(("主管**仍持** `bid`（老板要求他能看招投标雷达）", "bid" in DEFPERM["supervisor"]))
chk.append(("主管**新增** `forecast`（否则他进预报页会恒 403）",
            "forecast" in DEFPERM["supervisor"]))
chk.append(("boss / accountant 也补了 `forecast`（否则权限页勾了却打不开）",
            "forecast" in DEFPERM["boss"] and "forecast" in DEFPERM["accountant"]))
chk.append(("boss **仍持** `cron`（只管主管，不动老板）", "cron" in DEFPERM["boss"]))
chk.append(("一线角色**没有** `forecast`（sales/staff/guide/driver）",
            not any("forecast" in DEFPERM[r] for r in ("sales", "staff", "guide", "driver"))))
for name, ok in chk:
    if not ok:
        fails.append(name)
    print("  %s  %s" % ("PASS" if ok else "FAIL", name))

print()
print("总判定: %s（%d 项失败）" % ("✅ 全绿" if not fails else "❌ 有失败项", len(fails)))
for f in fails:
    print("   - " + f)
sys.exit(1 if fails else 0)
