#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v329 —— 旧前端（erp.hergent.cn，hergent-erp/static）**权限模块消费地图 + 护栏**。

为什么要有这个工具
------------------
旧前端与新前端**共用同一个后端**（同一套 `core._DEFAULT_PERMS` / `_PATH_MODULE_MAP`）。
老板 2026-09-29 拍板：旧前端**暂时不用，但几周后要整合成「ERP 版本」**。

这带来一个 v328 时没有的风险形状：
  · 旧前端**停用中** ⇒ 现在撤它的模块权限，**当场没人喊**（零真实使用）；
  · 但它**没废弃** ⇒ 整合那天页面会被拉回来，而权限已经撤掉
    ⇒ **页面在、点开全 403**，且是「老功能复活即坏」这种最难归因的故障。

⇒ 所以本工具不是一次性盘点，而是**常驻护栏**：
    凡是旧前端还在调用的模块，**不许从 `_ALL_MODULES` 消失**；
    凡是旧前端 0 调用的模块，才允许按新界面重配时收缩。

判据（不靠印象，全靠源码）
--------------------------
① `server.py::_PATH_MODULE_MAP`  —— 接口前缀 → 模块（唯一权威，AST 取出）
② `core.py::_ALL_MODULES`        —— 权限页可勾选的模块全集（AST 取出）
③ `core.py::_DEFAULT_PERMS`      —— 各角色出厂默认权限（AST 取出）
④ 扫 `hergent-erp/static` 所有 `.js`/`.html` 里的 `/api/...` 字面量 → 归模块

退出码：0 = 全绿；1 = 有护栏失败（模块被摘走 / 漂移）
用法：  python3 legacy-erp-module-map.py            # 报告 + 护栏
        python3 legacy-erp-module-map.py --json     # 机器可读
"""
import ast
import json
import os
import re
import sys
from collections import defaultdict

ERP = os.environ.get("HERGENT_ERP") or "/Users/zhangjunfeng/Documents/hergent-erp"
SERVER = os.path.join(ERP, "server", "server.py")
CORE = os.path.join(ERP, "server", "core.py")
STATIC = os.path.join(ERP, "static")

# v328 曾提议收缩、但因旧前端依赖而**撤回**的组合 —— 冻结在此，整合日按图索骥
FROZEN_SHRINK = {
    "guide":  ["sales", "buying", "stock", "crm"],
    "driver": ["stock"],
    "staff":  ["stock", "cron", "bid"],
    "sales":  ["cron", "bid"],
}


def _ast_get(path, name):
    tree = ast.parse(open(path, encoding="utf-8").read())
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            for t in node.targets:
                if isinstance(t, ast.Name) and t.id == name:
                    return ast.literal_eval(node.value)
    raise SystemExit("没找到 %s（%s）" % (name, path))


def scan_static(path_map):
    """扫旧前端 /api/ 字面量 → {模块: {文件: 次数}}、{模块: set(接口)}"""
    api_re = re.compile(r"['\"`](/api/[A-Za-z0-9_\-/{}\.]+)")
    hit = defaultdict(lambda: defaultdict(int))
    apis = defaultdict(set)
    files_scanned = 0
    for root, dirs, names in os.walk(STATIC):
        dirs[:] = [d for d in dirs if d not in ("node_modules", "dist", ".git")]
        for n in names:
            if not n.endswith((".js", ".html")):
                continue
            p = os.path.join(root, n)
            try:
                src = open(p, encoding="utf-8", errors="ignore").read()
            except Exception:
                continue
            files_scanned += 1
            rel = os.path.relpath(p, STATIC)
            for a in set(api_re.findall(src)):
                path = a.split("?")[0]
                # 与后端 _module_of 同法：最长前缀胜出（首个 startswith 即停是 v296 的坑）
                best = None
                for k, v in path_map.items():
                    if path.startswith(k) and (best is None or len(k) > len(best[0])):
                        best = (k, v)
                if best:
                    hit[best[1]][rel] += 1
                    apis[best[1]].add(path)
    return hit, apis, files_scanned


def main():
    path_map = _ast_get(SERVER, "_PATH_MODULE_MAP")
    all_modules = list(_ast_get(CORE, "_ALL_MODULES"))
    default_perms = _ast_get(CORE, "_DEFAULT_PERMS")

    hit, apis, n_files = scan_static(path_map)
    legacy_mods = sorted(hit)

    fails = []
    if "--json" not in sys.argv:
        print("=" * 74)
        print("v329 旧前端（erp.hergent.cn）权限模块消费地图 + 护栏")
        print("=" * 74)
        print("_PATH_MODULE_MAP = %d 条　旧前端扫描 = %d 文件　_ALL_MODULES = %d 个"
              % (len(path_map), n_files, len(all_modules)))
        print("旧前端调用到的模块（%d 个）= %s\n" % (len(legacy_mods), legacy_mods))

        print("-" * 74)
        print("%-12s %-6s %-6s  %s" % ("模块", "文件", "接口", "主要调用文件（前 3）"))
        print("-" * 74)
        for mod in sorted(hit, key=lambda k: -len(hit[k])):
            top = sorted(hit[mod].items(), key=lambda kv: -kv[1])[:3]
            print("%-12s %-6d %-6d  %s" % (
                mod, len(hit[mod]), len(apis[mod]),
                "; ".join("%s(%d)" % (f, c) for f, c in top)))

    # ---- 护栏 G1：旧前端在用的模块，不许从 _ALL_MODULES 摘走 ----
    if "--json" not in sys.argv:
        print("\n" + "=" * 74)
        print("护栏 G1　旧前端在用的模块必须仍可配置（摘走 = 整合日 403）")
        print("=" * 74)
    for mod in legacy_mods:
        ok = mod in all_modules
        if not ok:
            fails.append("G1 模块 %s 被旧前端 %d 个文件调用，却已从 _ALL_MODULES 摘走"
                         % (mod, len(hit[mod])))
        if "--json" not in sys.argv:
            print("   %-12s %s" % (mod, "✅ 仍可配置" if ok else "❌ 已被摘走 ⇒ 整合日必 403"))

    # ---- 护栏 G2：冻结的收缩组合 —— 现在到底安不安全 ----
    if "--json" not in sys.argv:
        print("\n" + "=" * 74)
        print("冻结清单　v328 因旧前端依赖而撤回的收缩项（整合日再处理）")
        print("=" * 74)
    frozen = {}
    for role, mods in FROZEN_SHRINK.items():
        for mod in mods:
            n = len(hit.get(mod, {}))
            safe = (n == 0)
            cur = mod in (default_perms.get(role) or [])
            frozen["%s.%s" % (role, mod)] = {
                "legacy_files": n, "safe_to_shrink": safe,
                "still_in_default": cur,
            }
            if "--json" not in sys.argv:
                if not cur:
                    tag = "— 已不在默认权限里，无需再动"
                elif safe:
                    tag = "✅ 旧前端 0 调用 ⇒ 现在收缩安全"
                else:
                    tag = "❄️ 冻结：旧前端 %d 个文件在用 ⇒ 等整合日" % n
                print("   %-6s %-8s %s" % (role, mod, tag))

    # ---- 护栏 G3：反例自证（证明本工具真有判别力，不是恒绿） ----
    probe_hit = len(hit.get("stock", {}))          # 正例：必然 > 0
    probe_zero = len(hit.get("__no_such_module__", {}))  # 反例：必然 == 0
    g3_ok = probe_hit > 0 and probe_zero == 0
    if not g3_ok:
        fails.append("G3 反例自证失败：脚本失去判别力（stock=%d / 假模块=%d）"
                     % (probe_hit, probe_zero))
    if "--json" not in sys.argv:
        print("\n" + "-" * 74)
        print("G3 反例自证：stock 命中 %d 个文件（须 >0）／假模块命中 %d（须 =0）⇒ %s"
              % (probe_hit, probe_zero, "OK" if g3_ok else "失去判别力"))
        print("-" * 74)

    out = {
        "legacy_modules": legacy_mods,
        "module_files": {m: len(hit[m]) for m in legacy_mods},
        "frozen": frozen,
        "fails": fails,
    }
    if "--json" in sys.argv:
        print(json.dumps(out, ensure_ascii=False, indent=2))
        return 1 if fails else 0

    if fails:
        print("\n❌ 护栏失败 %d 条：" % len(fails))
        for f in fails:
            print("   ·", f)
        return 1
    print("\n✅ 护栏全绿：旧前端依赖的模块全部仍可配置（整合日不会撞 403）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
