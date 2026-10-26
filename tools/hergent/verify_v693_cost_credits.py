#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v693 补丁逻辑验证：从**补丁后的真实文件**里用 AST 提取函数与常量来执行。

为什么不用 import：本地没有 fastapi / core / erp_db，模块导不进来。
为什么不用副本代码：副本会与生产文件悄悄分叉，等于自己骗自己。
"""
import ast
import math
import re
import sys
from datetime import datetime, timedelta, timezone

BJ = timezone(timedelta(hours=8))

WANT_FUNCS = {"is_peak_now", "_cache_hit_ratio", "estimate_cost_cny", "credits_of"}
WANT_ASSIGN = {"_PRICE_CACHE_HIT", "_PRICE_CACHE_MISS", "_PRICE_OUTPUT",
               "_PEAK_MULTIPLIER", "_PEAK_WINDOWS", "_CACHE_ANCHORS",
               "CREDITS_PER_YUAN", "QUOTA_TIERS", "CREDIT_EXEMPT_TENANTS"}

PASS = FAIL = 0


def ck(name, got, want, tol=None):
    global PASS, FAIL
    if tol is not None:
        ok = got is not None and abs(got - want) <= tol
    else:
        ok = got == want
    if ok:
        PASS += 1
        print("  PASS  %-46s %s" % (name, got))
    else:
        FAIL += 1
        print("  FAIL  %-46s got=%r want=%r" % (name, got, want))


def load(path):
    src = open(path, encoding="utf-8").read()
    tree = ast.parse(src)
    ns = {"math": math, "datetime": datetime, "timezone": timezone,
          "timedelta": timedelta}
    picked = []
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name in WANT_FUNCS:
            picked.append(node)
        elif isinstance(node, ast.Assign):
            for t in node.targets:
                if isinstance(t, ast.Name) and t.id in WANT_ASSIGN:
                    picked.append(node)
                    break
        elif isinstance(node, ast.AnnAssign):
            if isinstance(node.target, ast.Name) and node.target.id in WANT_ASSIGN:
                picked.append(node)
    # 同一个 ns 里按源码顺序执行 —— 函数查全局变量时能查到常量
    mod = ast.Module(body=picked, type_ignores=[])
    ast.fix_missing_locations(mod)
    exec(compile(mod, "<patched>", "exec"), ns)
    missing = (WANT_FUNCS - set(ns)) | (WANT_ASSIGN - set(ns))
    if missing:
        raise SystemExit("提取失败，缺：%s" % sorted(missing))
    return ns


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "/opt/hergent-erp/routers/ai_assist.py"
    src_text = open(path, encoding="utf-8").read()

    # 🔴 [0] import 完整性 —— 这一组是被真实事故换来的。
    #    AST 提取函数执行时，我把 timezone/timedelta 注进了 namespace，
    #    等于替真实模块把坑填了：单元验证 29 项全过、集成一跑
    #    `name 'timezone' is not defined`，而写库是软失败 ⇒ 界面无异常、
    #    账却一条没进。所以必须先检查「真实文件自己有没有导入」。
    print("[0] import 完整性（AST 验证会掩盖这个坑，必须单独查）")
    ck("文件含 `import math`", bool(re.search(r"^import math\s*$", src_text, re.M)), True)
    ck("文件 import 了 timezone",
       bool(re.search(r"^from datetime import [^\n]*\btimezone\b", src_text, re.M)), True)
    ck("文件 import 了 timedelta",
       bool(re.search(r"^from datetime import [^\n]*\btimedelta\b", src_text, re.M)), True)

    ns = load(path)
    peak, cost, cred = ns["is_peak_now"], ns["estimate_cost_cny"], ns["credits_of"]

    print("\n[1] 峰谷判定（北京时间）")
    ck("周一 10:00 高峰", peak(datetime(2026, 10, 26, 10, 0, tzinfo=BJ)), True)
    ck("周一 16:15 高峰（本次货损任务）", peak(datetime(2026, 10, 26, 16, 15, tzinfo=BJ)), True)
    ck("周一 12:00 边界=闲时", peak(datetime(2026, 10, 26, 12, 0, tzinfo=BJ)), False)
    ck("周一 13:00 午休=闲时", peak(datetime(2026, 10, 26, 13, 0, tzinfo=BJ)), False)
    ck("周一 14:00 边界=高峰", peak(datetime(2026, 10, 26, 14, 0, tzinfo=BJ)), True)
    ck("周一 18:00 边界=闲时", peak(datetime(2026, 10, 26, 18, 0, tzinfo=BJ)), False)
    ck("周一 20:00 闲时", peak(datetime(2026, 10, 26, 20, 0, tzinfo=BJ)), False)
    ck("周六 16:00 周末全天闲时", peak(datetime(2026, 10, 24, 16, 0, tzinfo=BJ)), False)
    ck("周日 10:00 周末全天闲时", peak(datetime(2026, 10, 25, 10, 0, tzinfo=BJ)), False)

    print("\n[2] 成本估算 vs 实测真值")
    # 锚点 1：单问（Hermes 真值 未缓存 134 / 命中 20,734 / 输出 135）
    c1, h1, _ = cost(20867, 135, peak=False)
    ck("单问 成本 ¥", c1, 0.001089, tol=0.00002)
    ck("单问 估算命中 token", h1, 20734, tol=3)
    # 锚点 2：15 轮货损任务（真值 165,209 / 1,347,456 / 26,065）
    c2, h2, _ = cost(1512665, 26065, peak=False)
    ck("15轮 闲时成本 ¥", c2, 0.296416, tol=0.001)
    ck("15轮 估算命中 token", h2, 1347456, tol=200)
    c3, _, _ = cost(1512665, 26065, peak=True)
    ck("15轮 高峰成本 ¥（应为闲时 2 倍）", c3, 0.592832, tol=0.002)
    ck("高峰/闲时 倍数", round(c3 / c2, 4), 2.0)

    print("\n[3] 积分折算（1 积分 = 1 分钱）")
    ck("重型任务闲时 → 积分", cred(c2), 30)
    ck("重型任务高峰 → 积分", cred(c3), 59)
    ck("轻问答 → 积分（抹零不计费）", cred(c1), 0)
    ck("0 成本 → 0 积分", cred(0), 0)

    print("\n[4] 边界与健壮性")
    ck("prompt=0 不炸", cost(0, 0, peak=False)[0], 0.0)
    ck("prompt 极小不炸", cost(10, 5, peak=False)[0] > 0, True)
    ck("命中率始终 <= 1", ns["_cache_hit_ratio"](9_999_999) <= 1.0, True)
    ck("命中率始终 > 0", ns["_cache_hit_ratio"](1) > 0, True)

    print("\n[5] 档位与豁免")
    t = ns["QUOTA_TIERS"]
    ck("free 积分", t.get("free"), 3000)
    ck("plus 积分", t.get("plus"), 20000)
    ck("pro 积分", t.get("pro"), 60000)
    ck("tenant 1 在豁免名单", 1 in ns["CREDIT_EXEMPT_TENANTS"], True)
    # 单人满负荷：每天 3 件 × 30 天 × 30 积分
    need = 3 * 30 * cred(c2)
    ck("单人满负荷月需积分", need, 2700)
    ck("free 3000 能覆盖", need <= t["free"], True)

    print("\n%s  %d 项通过 / %d 项失败" % ("ALL PASS" if not FAIL else "HAS FAILURE", PASS, FAIL))
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
