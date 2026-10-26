#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v693c：`/api/ai/quota` 多回一个 `is_peak`。

为什么值得单独打一个补丁：执行计划卡片要显示
「现在是高峰，挪到晚上 8 点后约 30 积分」—— 这条提示的前提是前端知道
「此刻是否高峰」。而峰谷判定只写在后端（与成本核算同一份），
让前端自己复制一套必然分叉（时间窗口改了一边忘一边）。

顺带回 `peak_until`：高峰还剩多少分钟，卡片可以直接说「再等 2 小时」。
"""
import sys
import shutil
import py_compile
from pathlib import Path

DEFAULT_TARGET = Path("/opt/hergent-erp/routers/ai_assist.py")

# 补丁 1：加 _peak_until_min 辅助函数
HELPER_OLD = '''def credits_of(cost_cny):
    """成本折积分（1 积分 = 1 分钱）。"""
    return round(float(cost_cny or 0) * CREDITS_PER_YUAN)'''

HELPER_NEW = '''def credits_of(cost_cny):
    """成本折积分（1 积分 = 1 分钱）。"""
    return round(float(cost_cny or 0) * CREDITS_PER_YUAN)


def _peak_until_min(now=None):
    """当前高峰还剩多少分钟；不在高峰返回 0。

    只算「今天之内」：当天最后一段高峰到 18:00 结束，不会跨天；
    周末整段不算高峰 ⇒ 不需要跨天推算。
    """
    if now is None:
        now = datetime.now(timezone(timedelta(hours=8)))
    if now.weekday() >= 5:
        return 0
    mm = now.hour * 60 + now.minute
    for a, b in _PEAK_WINDOWS:
        if a <= mm < b:
            return b - mm
    return 0'''

OLD = '''            "cost_cny_this_month": round(float(cost_cny or 0), 4),
            "exempt": _exempt,'''

NEW = '''            "cost_cny_this_month": round(float(cost_cny or 0), 4),
            "exempt": _exempt,
            # v693c：此刻是否高峰（供前端在执行计划卡片上提示「等晚上更省」）。
            #   峰谷判定只有一份实现（is_peak_now），前端不许自己复制 —— 复制必然分叉。
            "is_peak": is_peak_now(),
            "peak_until_min": _peak_until_min(),'''


def main() -> int:
    dry = "--dry-run" in sys.argv
    target = DEFAULT_TARGET
    for a in sys.argv[1:]:
        if a.startswith("--target="):
            target = Path(a.split("=", 1)[1])
    src = target.read_text(encoding="utf-8")

    if '"peak_until_min"' in src:
        print("已打过 v693c，跳过。")
        return 0
    for name, old in (("helper", HELPER_OLD), ("quota-field", OLD)):
        if src.count(old) != 1:
            print("%s 锚点命中 %d 次（必须 1），未修改。" % (name, src.count(old)))
            return 3

    out = src.replace(HELPER_OLD, HELPER_NEW, 1).replace(OLD, NEW, 1)
    if dry:
        print("[dry-run] 将新增 _peak_until_min() 与 is_peak / peak_until_min 两个返回字段")
        return 0

    backup = target.with_suffix(target.suffix + ".bak-v693c")
    if not backup.exists():
        shutil.copy2(target, backup)
        print("已备份 → %s" % backup)
    tmp = target.with_suffix(".v693c.tmp")
    tmp.write_text(out, encoding="utf-8")
    try:
        py_compile.compile(str(tmp), doraise=True)
    except py_compile.PyCompileError as e:
        tmp.unlink(missing_ok=True)
        print("语法校验失败：%s" % e)
        return 4
    shutil.move(str(tmp), str(target))
    print("已写入 %s" % target)
    return 0


if __name__ == "__main__":
    sys.exit(main())
