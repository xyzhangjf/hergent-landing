#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v695 周期函数纯逻辑单测（不需要连生产，本地可跑）。

为什么要单独测：周期计算全是**月末边界**的坑 —— 2 月只有 28/29 天，
锚点 31 日的客户在 2 月到底算哪天？如果写成"每轮都在上轮基础上加一个月"，
2 月被钳到 28 之后，3 月就永久变成 28 日了（客户会发现自己"额度恢复日越跑越早"）。
正确做法是**每轮都从原始 anchor_day 重算**。这里就是把这件事钉死。

用法：python3 tools/hergent/test_v695_cycle.py
"""
import calendar
from datetime import date, datetime

FAIL = []


def _cycle_bounds(anchor_day, now=None):
    """与 patch_v695 写入生产的那份**逐字一致**（改一边必须改另一边）。"""
    now = now or datetime.now()
    d = max(1, min(31, int(anchor_day or 1)))

    def _clamp(y, m):
        return min(d, calendar.monthrange(y, m)[1])

    if now.day >= _clamp(now.year, now.month):
        sy, sm = now.year, now.month
    else:
        sy, sm = (now.year, now.month - 1) if now.month > 1 else (now.year - 1, 12)
    sd = _clamp(sy, sm)

    ny, nm = (sy, sm + 1) if sm < 12 else (sy + 1, 1)
    nd = _clamp(ny, nm)
    return date(sy, sm, sd), date(ny, nm, nd)


def ck(label, got, want):
    ok = got == want
    print(("    PASS  " if ok else "    FAIL  ") + label + "  ← got=%s want=%s" % (got, want))
    if not ok:
        FAIL.append(label)


def main() -> int:
    print("A. 常规锚点（月中开通，老板自己的 6/18 这类）")
    ck("anchor=18 today=2026-10-26", _cycle_bounds(18, datetime(2026, 10, 26, 21, 0)),
       (date(2026, 10, 18), date(2026, 11, 18)))
    ck("anchor=18 today=2026-10-05（还没到本锚点，落到上月）",
       _cycle_bounds(18, datetime(2026, 10, 5, 9, 0)),
       (date(2026, 9, 18), date(2026, 10, 18)))
    ck("anchor=18 today=2026-10-18（当天即新一轮起点）",
       _cycle_bounds(18, datetime(2026, 10, 18, 0, 30)),
       (date(2026, 10, 18), date(2026, 11, 18)))

    print("\nB. 1 号锚点 = 等价自然月（老行为，作为回归基线）")
    ck("anchor=1 today=2026-10-26", _cycle_bounds(1, datetime(2026, 10, 26, 10, 0)),
       (date(2026, 10, 1), date(2026, 11, 1)))

    print("\nC. 月末钳制（锚点 31 日）")
    ck("anchor=31 today=2026-01-31", _cycle_bounds(31, datetime(2026, 1, 31, 12, 0)),
       (date(2026, 1, 31), date(2026, 2, 28)))
    ck("anchor=31 today=2026-02-15（2 月只有 28 天，锚点钳到 28）",
       _cycle_bounds(31, datetime(2026, 2, 15, 12, 0)),
       (date(2026, 1, 31), date(2026, 2, 28)))
    ck("anchor=31 today=2026-02-28（落在钳制后的锚点上）",
       _cycle_bounds(31, datetime(2026, 2, 28, 12, 0)),
       (date(2026, 2, 28), date(2026, 3, 31)))
    ck("anchor=31 today=2026-03-01（**关键**：3 月必须回到 31，不能退化成 28）",
       _cycle_bounds(31, datetime(2026, 3, 1, 12, 0)),
       (date(2026, 2, 28), date(2026, 3, 31)))
    ck("anchor=31 today=2026-03-31", _cycle_bounds(31, datetime(2026, 3, 31, 12, 0)),
       (date(2026, 3, 31), date(2026, 4, 30)))

    print("\nD. 跨年（12 月 → 次年 1 月）")
    ck("anchor=20 today=2026-12-25", _cycle_bounds(20, datetime(2026, 12, 25, 12, 0)),
       (date(2026, 12, 20), date(2027, 1, 20)))
    ck("anchor=20 today=2027-01-05（落到上一年 12 月那轮）",
       _cycle_bounds(20, datetime(2027, 1, 5, 12, 0)),
       (date(2026, 12, 20), date(2027, 1, 20)))

    print("\nE. 非法锚点兜底（不能抛异常，否则接口 500）")
    ck("anchor=0 → 按 1 号", _cycle_bounds(0, datetime(2026, 10, 26, 12, 0)),
       (date(2026, 10, 1), date(2026, 11, 1)))
    # anchor=99 ⇒ 钳到 31；today=10/26 还没到 10/31 ⇒ 本轮起点落到**9 月**，
    # 而 9 月只有 30 天 ⇒ 起点是 9/30（不是 9/31）。这正是钳制该有的样子。
    ck("anchor=99 → 钳到 31（10/26 仍在上一轮，起点 9/30）",
       _cycle_bounds(99, datetime(2026, 10, 26, 12, 0)),
       (date(2026, 9, 30), date(2026, 10, 31)))
    ck("anchor=None → 按 1 号", _cycle_bounds(None, datetime(2026, 10, 26, 12, 0)),
       (date(2026, 10, 1), date(2026, 11, 1)))

    print("\nF. 不变式：任意一天都必须落在 [start, end) 里，且跨度 28~31 天")
    bad = []
    d0 = date(2026, 1, 1)
    cur = datetime(2026, 1, 1, 12, 0)
    while cur.date() < date(2027, 1, 1):
        for anchor in range(1, 32):
            s, e = _cycle_bounds(anchor, cur)
            span = (e - s).days
            if not (s <= cur.date() < e) or span < 28 or span > 31:
                bad.append((str(cur.date()), anchor, str(s), str(e), span))
        cur = datetime.fromordinal(cur.toordinal() + 1).replace(hour=12)
    print(("    PASS  " if not bad else "    FAIL  ") + "全年 × 31 个锚点共 11,315 组全满足" if not bad
          else "    反例（前 5 条）：%s" % bad[:5])
    if bad:
        FAIL.append("不变式")

    print("\n" + ("ALL PASS" if not FAIL else "HAS FAILURE: %s" % FAIL))
    return 0 if not FAIL else 1


if __name__ == "__main__":
    raise SystemExit(main())
