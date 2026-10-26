#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Hermes usage_pricing 补丁 v1：DeepSeek 峰谷定价 + 2026-09 现行价

背景
----
Hermes 内置价目表是 `deepseek-pricing-2026-07` 快照（注释自承 "Snapshot ... (2026-07)"），
而 DeepSeek 官方其后调价两次：
  - 2026-08-17 起引入峰谷定价（高峰 = 闲时 x2）
  - 2026-09-10 12:00 起 flash 系列再降：闲时 命中0.02 / 未命中1 / 输出4（元/百万）
    高峰（北京时间周一至周五 09:00-12:00、14:00-18:00）翻倍：0.04 / 2 / 8
  - 2026-08-23 起周末全天按闲时计
结果：Hermes 报的成本低估约 1.2~2.4 倍（输出价只用了 2 元，实际闲时 4 元 / 高峰 8 元）。

本补丁做三件事
--------------
1. `PricingEntry` 增加三个可选峰谷字段（peak_input / peak_output / peak_cache_read）
2. 新增 `_is_deepseek_peak()` + `_apply_peak_pricing()`，在 `estimate_usage_cost` 里
   于所有校验/计算**之前**把 entry 换成高峰版 —— 后续逻辑一行不改
3. 更新 `deepseek` provider 下 4 个模型的单价（chat / reasoner 是 v4-flash 的别名，同价）

幂等：文件内已含标记则直接退出 0；锚点找不到则退出 1 且不落盘。
汇率口径：沿用 Hermes 既有 7.14（0.14 USD <-> 1 元 / 0.0028 <-> 0.02 元），不另引入。

用法：python3 patch_usage_pricing.py [--dry-run]
"""
from __future__ import annotations

import re
import shutil
import sys
from datetime import datetime
from pathlib import Path

TARGET = Path(
    "/usr/local/lib/hermes-agent/venv/lib/python3.11/site-packages/agent/usage_pricing.py"
)
MARK = "DEEPSEEK_PEAK_PRICING_V1"
PRICING_VERSION = "deepseek-pricing-2026-09"

# 美元/百万 token。汇率 7.14（沿用 Hermes 既有口径）
# flash 系列：闲时 未命中 1 元=0.14 / 命中 0.02 元=0.0028 / 输出 4 元=0.56
#            高峰 未命中 2 元=0.28 / 命中 0.04 元=0.0056 / 输出 8 元=1.12
FLASH_OFF = dict(inp="0.14", out="0.56", cr="0.0028")
FLASH_PEAK = dict(inp="0.28", out="1.12", cr="0.0056")
# pro 系列：2026-08-17 峰谷价，闲时 4.5/13.5/0.15 元，高峰翻倍（9-10 那次降价不含 pro）
PRO_OFF = dict(inp="0.6303", out="1.8908", cr="0.0210")
PRO_PEAK = dict(inp="1.2606", out="3.7815", cr="0.0420")

MODEL_PLANS = {
    "deepseek-chat": (FLASH_OFF, FLASH_PEAK),
    "deepseek-reasoner": (FLASH_OFF, FLASH_PEAK),
    "deepseek-v4-flash": (FLASH_OFF, FLASH_PEAK),
    "deepseek-v4-pro": (PRO_OFF, PRO_PEAK),
}

PEAK_HELPERS = '''

# ── {mark}: DeepSeek 峰谷定价 ──────────────────────────────────────────
# DeepSeek 自 2026-08-17 起按峰谷计费，2026-09-10 起 flash 系列为现行价：
#   闲时（含周末全天）  命中 0.02 / 未命中 1 / 输出 4  （元/百万）
#   高峰（北京时间周一至周五 09:00-12:00、14:00-18:00）全部 x2
# Hermes 原价目表是 2026-07 快照，输出仍按 2 元，会低估 1.2~2.4 倍。
_DEEPSEEK_PEAK_WINDOWS = ((9 * 60, 12 * 60), (14 * 60, 18 * 60))


def _is_deepseek_peak(at: Optional[datetime] = None) -> bool:
    """当前是否落在 DeepSeek 高峰时段（北京时间，仅周一至周五）。"""
    moment = at or _UTC_NOW()
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    bj = moment.astimezone(timezone(timedelta(hours=8)))
    if bj.weekday() >= 5:  # 周六 / 周日全天闲时
        return False
    minutes = bj.hour * 60 + bj.minute
    return any(start <= minutes < end for start, end in _DEEPSEEK_PEAK_WINDOWS)


def _apply_peak_pricing(entry: PricingEntry, at: Optional[datetime] = None) -> PricingEntry:
    """高峰时段把 entry 换成 peak 价；没有 peak 字段或非高峰则原样返回。"""
    if (
        entry.peak_input_cost_per_million is None
        and entry.peak_output_cost_per_million is None
        and entry.peak_cache_read_cost_per_million is None
    ):
        return entry
    if not _is_deepseek_peak(at):
        return entry

    def _pick(off, peak):
        return peak if peak is not None else off

    return replace(
        entry,
        input_cost_per_million=_pick(entry.input_cost_per_million, entry.peak_input_cost_per_million),
        output_cost_per_million=_pick(entry.output_cost_per_million, entry.peak_output_cost_per_million),
        cache_read_cost_per_million=_pick(
            entry.cache_read_cost_per_million, entry.peak_cache_read_cost_per_million
        ),
        pricing_version=(entry.pricing_version or "") + "+peak",
    )
'''


def build_block(model: str, off: dict, peak: dict) -> str:
    return (
        "    (\n"
        '        "deepseek",\n'
        '        "%s",\n'
        "    ): PricingEntry(\n"
        '        input_cost_per_million=Decimal("%s"),\n'
        '        output_cost_per_million=Decimal("%s"),\n'
        '        cache_read_cost_per_million=Decimal("%s"),\n'
        '        peak_input_cost_per_million=Decimal("%s"),\n'
        '        peak_output_cost_per_million=Decimal("%s"),\n'
        '        peak_cache_read_cost_per_million=Decimal("%s"),\n'
        '        source="official_docs_snapshot",\n'
        '        source_url="https://api-docs.deepseek.com/quick_start/pricing",\n'
        '        pricing_version="%s",\n'
        "    ),"
    ) % (model, off["inp"], off["out"], off["cr"], peak["inp"], peak["out"], peak["cr"], PRICING_VERSION)


def main() -> int:
    global TARGET
    dry = "--dry-run" in sys.argv
    for arg in sys.argv[1:]:
        if arg.startswith("--target="):
            TARGET = Path(arg.split("=", 1)[1])
    if not TARGET.exists():
        print("FATAL: 目标不存在 %s" % TARGET)
        return 1

    src = TARGET.read_text(encoding="utf-8")
    if MARK in src:
        print("SKIP: 已打过补丁（找到标记 %s），未做任何修改" % MARK)
        return 0

    out = src
    problems = []

    # 1) import dataclasses.replace
    if "from dataclasses import dataclass, replace" not in out:
        if "from dataclasses import dataclass\n" in out:
            out = out.replace(
                "from dataclasses import dataclass\n",
                "from dataclasses import dataclass, replace\n",
                1,
            )
        else:
            problems.append("dataclasses import 锚点未命中")

    # 2) import timedelta
    if "datetime, timedelta, timezone" not in out:
        if "from datetime import datetime, timezone\n" in out:
            out = out.replace(
                "from datetime import datetime, timezone\n",
                "from datetime import datetime, timedelta, timezone\n",
                1,
            )
        else:
            problems.append("datetime import 锚点未命中")

    # 3) PricingEntry 加 peak 字段（插在 cache_write 之后）
    anchor = "    cache_write_cost_per_million: Optional[Decimal] = None\n    request_cost:"
    if "peak_input_cost_per_million: Optional[Decimal] = None" not in out:
        if anchor in out:
            out = out.replace(
                anchor,
                "    cache_write_cost_per_million: Optional[Decimal] = None\n"
                "    # %s — 峰谷价：非 None 时由 _apply_peak_pricing 在高峰时段替换\n"
                "    peak_input_cost_per_million: Optional[Decimal] = None\n"
                "    peak_output_cost_per_million: Optional[Decimal] = None\n"
                "    peak_cache_read_cost_per_million: Optional[Decimal] = None\n"
                "    request_cost:" % MARK,
                1,
            )
        else:
            problems.append("PricingEntry 锚点未命中")

    # 4) 插入峰谷辅助函数（放在 _UTC_NOW 之后）
    utc_anchor = '_UTC_NOW = lambda: datetime.now(timezone.utc)\n'
    if "_is_deepseek_peak" not in out:
        if utc_anchor in out:
            out = out.replace(utc_anchor, utc_anchor + PEAK_HELPERS.format(mark=MARK), 1)
        else:
            problems.append("_UTC_NOW 锚点未命中")

    # 5) 替换 4 条 deepseek 单价
    for model, (off, peak) in MODEL_PLANS.items():
        pattern = re.compile(
            r'    \(\n        "deepseek",\n        "%s",\n    \): PricingEntry\(.*?\n    \),'
            % re.escape(model),
            re.S,
        )
        new_block = build_block(model, off, peak)
        out, n = pattern.subn(lambda _m, b=new_block: b, out, count=1)
        if n != 1:
            problems.append("模型条目替换失败: %s (命中 %d 次)" % (model, n))

    # 6) estimate_usage_cost 加 at 参数 + 换价
    if "    at: Optional[datetime] = None,\n) -> CostResult:" not in out:
        sig_anchor = "    api_key: Optional[str] = None,\n) -> CostResult:"
        if sig_anchor in out:
            out = out.replace(
                sig_anchor,
                "    api_key: Optional[str] = None,\n"
                "    at: Optional[datetime] = None,\n"
                ") -> CostResult:",
                1,
            )
        else:
            problems.append("estimate_usage_cost 签名锚点未命中")

    call_anchor = "    notes: list[str] = []\n    amount = _ZERO\n"
    if "_apply_peak_pricing(entry, at)" not in out:
        if call_anchor in out:
            out = out.replace(
                call_anchor,
                "    # %s — 高峰时段换价后再走原有校验与计算\n"
                "    entry = _apply_peak_pricing(entry, at)\n\n" % MARK + call_anchor,
                1,
            )
        else:
            problems.append("estimate_usage_cost 调用点锚点未命中")

    if problems:
        print("FATAL: 以下锚点未命中，未做任何修改：")
        for p in problems:
            print("  - %s" % p)
        return 1

    # 语法校验（改动前先在内存 compile）
    try:
        compile(out, str(TARGET), "exec")
    except SyntaxError as exc:
        print("FATAL: 补丁后语法错误，未落盘: %s" % exc)
        return 1

    if dry:
        print("DRY-RUN OK: 通过语法校验，未写盘。变更 %d -> %d 字符" % (len(src), len(out)))
        return 0

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = TARGET.with_suffix(TARGET.suffix + ".bak-patch-%s" % stamp)
    shutil.copy2(TARGET, backup)
    TARGET.write_text(out, encoding="utf-8")
    print("OK: 已打补丁")
    print("  备份: %s" % backup)
    print("  目标: %s" % TARGET)
    print("  字符: %d -> %d" % (len(src), len(out)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
