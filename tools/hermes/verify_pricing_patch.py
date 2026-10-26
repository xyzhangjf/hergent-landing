#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""验证 usage_pricing 补丁：峰谷判定 + 按真实数据验算成本

做法：从打好补丁的源文件里用 AST 取「真实代码」执行（不复制、不重写），
绕开 agent.model_metadata / utils 这类线上才有的依赖。
- 类与函数：按行区间取源码（**含装饰器**，ast.get_source_segment 会漏 @dataclass）
- 价目表：只取 provider == "deepseek" 的条目，逐个 eval 成对象
"""
from __future__ import annotations

import ast
import sys
from datetime import datetime, timedelta, timezone
from decimal import Decimal

SRC = sys.argv[1] if len(sys.argv) > 1 else "/tmp/usp_test.py"
BJ = timezone(timedelta(hours=8))

source = open(SRC, encoding="utf-8").read()
tree = ast.parse(source)
_lines = source.splitlines()

WANTED_FUNCS = {"_is_deepseek_peak", "_apply_peak_pricing"}
WANTED_CLASS = {"PricingEntry"}
WANTED_ASSIGN = {"_DEEPSEEK_PEAK_WINDOWS"}


def node_src(node) -> str:
    """取节点源码，包含装饰器行。"""
    start = node.lineno
    if getattr(node, "decorator_list", None):
        start = min(d.lineno for d in node.decorator_list)
    return "\n".join(_lines[start - 1:node.end_lineno])


chunks = []
for node in tree.body:
    if isinstance(node, ast.ClassDef) and node.name in WANTED_CLASS:
        chunks.append(node_src(node))
    elif isinstance(node, ast.FunctionDef) and node.name in WANTED_FUNCS:
        chunks.append(node_src(node))
    elif isinstance(node, (ast.Assign, ast.AnnAssign)):
        targets = node.targets if isinstance(node, ast.Assign) else [node.target]
        for t in targets:
            if isinstance(t, ast.Name) and t.id in WANTED_ASSIGN:
                chunks.append(node_src(node))

base = "\n".join([
    "from dataclasses import dataclass, replace",
    "from datetime import datetime, timedelta, timezone",
    "from decimal import Decimal",
    "from typing import Any, Dict, Literal, Optional",
    "_ZERO = Decimal('0')",
    "_ONE_MILLION = Decimal('1000000')",
    "_UTC_NOW = lambda: datetime.now(timezone.utc)",
]) + "\n" + "\n\n".join(chunks) + "\n"
ns: dict = {}
exec(base, ns)

# 逐条抽出 deepseek 价目（AST 定位 + eval，不拼字符串）
entry_src = {}
for node in ast.walk(tree):
    if not isinstance(node, ast.Dict):
        continue
    for k, v in zip(node.keys, node.values):
        if not (isinstance(k, ast.Tuple) and len(k.elts) == 2):
            continue
        try:
            kv = ast.literal_eval(k)
        except Exception:
            continue
        if len(kv) != 2 or kv[0] != "deepseek":
            continue
        mdl = kv[1]
        if mdl not in entry_src:
            # value 是多行 Call，起始列在 "): PricingEntry(" 之后 —— 必须按列精确取，
            # 不能用行区间（会带上行首的 "    ): "）
            entry_src[mdl] = ast.get_source_segment(source, v)

if not entry_src:
    print("FATAL: 没抽到任何 deepseek 条目")
    sys.exit(1)

TABLE = {("deepseek", m): eval(s, ns) for m, s in entry_src.items()}

PricingEntry = ns["PricingEntry"]
is_peak = ns["_is_deepseek_peak"]
apply_peak = ns["_apply_peak_pricing"]

fails = []


def check(label, got, want):
    ok = got == want
    print("%s %-50s got=%s want=%s" % ("[ok]" if ok else "[FAIL]", label, got, want))
    if not ok:
        fails.append(label)


print("=== 1. 峰谷时段判定（北京时间）===")
cases = [
    ("周一 08:59 -> 闲", datetime(2026, 10, 26, 8, 59, tzinfo=BJ), False),
    ("周一 09:00 -> 峰", datetime(2026, 10, 26, 9, 0, tzinfo=BJ), True),
    ("周一 11:59 -> 峰", datetime(2026, 10, 26, 11, 59, tzinfo=BJ), True),
    ("周一 12:00 -> 闲", datetime(2026, 10, 26, 12, 0, tzinfo=BJ), False),
    ("周一 13:59 -> 闲", datetime(2026, 10, 26, 13, 59, tzinfo=BJ), False),
    ("周一 14:00 -> 峰", datetime(2026, 10, 26, 14, 0, tzinfo=BJ), True),
    ("周一 16:18（本次实跑）-> 峰", datetime(2026, 10, 26, 16, 18, tzinfo=BJ), True),
    ("周一 17:59 -> 峰", datetime(2026, 10, 26, 17, 59, tzinfo=BJ), True),
    ("周一 18:00 -> 闲", datetime(2026, 10, 26, 18, 0, tzinfo=BJ), False),
    ("周一 20:00 -> 闲", datetime(2026, 10, 26, 20, 0, tzinfo=BJ), False),
    ("周六 16:00 -> 闲", datetime(2026, 10, 24, 16, 0, tzinfo=BJ), False),
    ("周日 10:00 -> 闲", datetime(2026, 10, 25, 10, 0, tzinfo=BJ), False),
]
for label, moment, want in cases:
    check(label, is_peak(moment), want)

print("\n=== 2. 跨时区输入按北京时间换算 ===")
check("08:18 UTC -> 峰（=16:18 北京）", is_peak(datetime(2026, 10, 26, 8, 18, tzinfo=timezone.utc)), True)
check("12:18 UTC -> 闲（=20:18 北京）", is_peak(datetime(2026, 10, 26, 12, 18, tzinfo=timezone.utc)), False)
check("naive 08:18 视为 UTC -> 峰", is_peak(datetime(2026, 10, 26, 8, 18)), True)

print("\n=== 3. 价目表落地情况（美元/百万 token）===")
for model in sorted(entry_src):
    e = TABLE[("deepseek", model)]
    print("  %-18s 闲: in=%-7s out=%-7s hit=%-8s | 峰: in=%-7s out=%-7s hit=%-8s | %s" % (
        model, e.input_cost_per_million, e.output_cost_per_million, e.cache_read_cost_per_million,
        e.peak_input_cost_per_million, e.peak_output_cost_per_million,
        e.peak_cache_read_cost_per_million, e.pricing_version))

for model in ("deepseek-v4-flash", "deepseek-chat", "deepseek-reasoner"):
    e = TABLE[("deepseek", model)]
    check("%s 闲时输出 0.56" % model, e.output_cost_per_million, Decimal("0.56"))
    check("%s 高峰输出 1.12" % model, e.peak_output_cost_per_million, Decimal("1.12"))
check("flash 闲时命中 0.0028", TABLE[("deepseek", "deepseek-v4-flash")].cache_read_cost_per_million, Decimal("0.0028"))
check("pro 闲时输出 1.8908", TABLE[("deepseek", "deepseek-v4-pro")].output_cost_per_million, Decimal("1.8908"))

print("\n=== 4. 用本次真实数据验算（输出 26,065 / 命中 1,347,456 / 未命中 165,209）===")
P_IN, P_OUT, P_HIT = 165209, 26065, 1347456
FX = Decimal("7.14")  # 沿用 Hermes 既有汇率口径


def cost(entry):
    return (Decimal(P_IN) * entry.input_cost_per_million
            + Decimal(P_OUT) * entry.output_cost_per_million
            + Decimal(P_HIT) * entry.cache_read_cost_per_million) / Decimal(1000000)


flash = TABLE[("deepseek", "deepseek-v4-flash")]
peak_entry = apply_peak(flash, datetime(2026, 10, 26, 16, 18, tzinfo=BJ))
off_entry = apply_peak(flash, datetime(2026, 10, 26, 20, 0, tzinfo=BJ))

usd_peak, usd_off = cost(peak_entry), cost(off_entry)
cny_peak, cny_off = usd_peak * FX, usd_off * FX
print("  高峰(16:18 实跑): $%.6f -> ¥%.4f  [%s]" % (usd_peak, cny_peak, peak_entry.pricing_version))
print("  闲时(挪到20:00): $%.6f -> ¥%.4f  [%s]" % (usd_off, cny_off, off_entry.pricing_version))
print("  Hermes 原报:     $0.034200 -> ¥%.4f  [deepseek-pricing-2026-07]" % (Decimal("0.034200") * FX))

check("高峰折人民币 ≈ 0.59 元", round(float(cny_peak), 2), 0.59)
check("闲时折人民币 ≈ 0.30 元", round(float(cny_off), 2), 0.30)
check("高峰确为闲时 2 倍", round(float(usd_peak / usd_off), 6), 2.0)
check("高峰打上 +peak 标记", peak_entry.pricing_version.endswith("+peak"), True)
check("闲时不打标记", off_entry.pricing_version.endswith("+peak"), False)

print("\n=== 5. 其它 provider 的条目不受影响 ===")
plain = PricingEntry(input_cost_per_million=Decimal("1"),
                     output_cost_per_million=Decimal("2"),
                     cache_read_cost_per_million=Decimal("0.1"))
check("无 peak 字段 -> 原样返回",
      apply_peak(plain, datetime(2026, 10, 26, 16, 18, tzinfo=BJ)).output_cost_per_million,
      Decimal("2"))

print("\n%s（%d 项断言，%d 失败）" % ("ALL PASS" if not fails else "HAS FAILURES", len(cases) + 12, len(fails)))
sys.exit(1 if fails else 0)
