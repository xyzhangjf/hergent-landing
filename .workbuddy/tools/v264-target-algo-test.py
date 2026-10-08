#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v264 商品目标管理 · 纯算法单测（**不连数据库**）。

断言用的数字**全部来自用户 2026-09-24 的原话**，不是我自己编的：
  · 「150 箱 / 可报 15 单 / 已达成 15 箱 ⇒ 均单约 9 箱」
  · 「9 箱即 72 包」（单位换算另在 tools/v264-unit-parity-check.py 验）
  · 「经理加 60 箱 × 刘善涛 10% = 6 箱 = 48 包；其原报 40 包 = 5 箱，最终定稿 88 包 = 11 箱」
  · 「不能减单扣到负数，最低到 0」
"""
import os
import sys

BE = "/Users/zhangjunfeng/Documents/hergent-erp"
sys.path.insert(0, os.path.join(BE, "server"))

from domain.product_targets import (  # noqa: E402
    remaining_periods, avg_target_box, prefill_box, allocate,
    suggest_ratios, normalize_ratios,
)

fails = []


def ck(name, got, want, tol=1e-6):
    ok = (abs(got - want) <= tol) if isinstance(want, (int, float)) and not isinstance(want, bool) \
        else (got == want)
    print("   %s %-52s got=%-10s want=%s" % ("ok  " if ok else "FAIL", name, got, want))
    if not ok:
        fails.append("%s: got=%r want=%r" % (name, got, want))


print("=" * 78)
print("① 剩余可报期次（🔴 必须来自整月到货日历，不是期次表行数）")
dates = ["2026-09-{:02d}".format(d) for d in (1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29)]
ck("9/24 看：只算 >= 今天 ⇒ 25/27/29 三天", remaining_periods(dates, "2026-09-24")[0], 3)
ck("本月总到货日数", remaining_periods(dates, "2026-09-24")[1], 15)
ck("9/1 看（含当天）", remaining_periods(dates, "2026-09-01")[0], 15)
ck("10/1 看（全过完）", remaining_periods(dates, "2026-10-01")[0], 0)

print("\n② 均单剩余 = (月目标 − 已达成) ÷ 剩余期次  —— 用用户的原数验算")
ck("达成未填(=0)、15 期 : (150−0)/15", avg_target_box(150, 0, 15)["box"], 10.0)
ck("达成 15 箱、15 期     : (150−15)/15  ← 用户说的『约 9 箱』", avg_target_box(150, 15, 15)["box"], 9.0)
ck("达成 24 箱、剩 12 期  : (150−24)/12  ← 月内越往后越高", avg_target_box(150, 24, 12)["box"], 10.5)
ck("达成 ≥ 目标 ⇒ done", avg_target_box(150, 150, 5)["done"], True)
ck("剩余期次 0 ⇒ no_window", avg_target_box(150, 0, 0)["no_window"], True)

print("\n③ 加单列预填 = 均单剩余 − 本期报单合计（**归位**口径）")
p = prefill_box(150, 15, 15, 0)
ck("达成15、本期未报 ⇒ 9 箱", p["prefill"], 9.0)
p = prefill_box(150, 15, 15, 12)
ck("达成15、本期报12 ⇒ −3 箱（该减！）", p["prefill"], -3.0)
ck("  ↑ 负数语义：报超了", p["prefill"] < 0, True)
p = prefill_box(None, 0, 15, 0)
ck("该商品无目标 ⇒ no_target（不填 0 冒充）", p["no_target"], True)
p = prefill_box(150, 0, 0, 5)
ck("已无可报期次 ⇒ no_window", p["no_window"], True)
p = prefill_box(150, 150, 5, 0)
ck("已达成 ⇒ done，不给建议", p["done"], True)

print("\n④ 加单分配 —— 用户原例：加 60 箱 × 刘善涛 10% = 6 箱")
rows, s = allocate(60, [{"employee_id": 6, "employee_name": "刘善涛", "ratio": 10,
                         "reported_box": 5}])
ck("刘善涛 alloc = 6 箱（60 × 10%，**不归一化**）", rows[0]["alloc"], 6.0)
ck("定稿 = 原报 5 箱 + 6 箱 = 11 箱", rows[0]["final_box"], 11.0)
ck("占比只有 10% ⇒ 剩 54 箱如实上报 unassigned", s["unassigned"], 54.0)
ck("fully_applied=False（经理要看到『占比没填满』）", s["fully_applied"], False)

print("\n⑤ 占比合计 100 ⇒ Σalloc 精确等于总量，不多不少")
rows, s = allocate(100, [{"employee_id": 1, "employee_name": "张", "ratio": 12, "reported_box": 0},
                         {"employee_id": 2, "employee_name": "刘", "ratio": 88, "reported_box": 0}])
ck("张 = 12 箱（12%）", rows[0]["alloc"], 12.0)
ck("刘 = 88 箱（88%）", rows[1]["alloc"], 88.0)
ck("Σalloc == 100", sum(r["alloc"] for r in rows), 100.0)
ck("fully_applied", s["fully_applied"], True)

print("\n⑥ 减单夹断 + **重分配**（D3『最低到 0』+ §7-D3『夹断后再分』）")
rows, s = allocate(-60, [{"employee_id": 1, "employee_name": "甲", "ratio": 10, "reported_box": 5},
                         {"employee_id": 2, "employee_name": "乙", "ratio": 90, "reported_box": 200}])
a, b = rows[0], rows[1]
ck("甲 扣满到 0（−5，不是 −6）", a["alloc"], -5.0)
ck("甲 定稿 0（永不为负）", a["final_box"], 0.0)
ck("乙 承担剩下的 55（54 + 重分配的 1）", b["alloc"], -55.0)
ck("Σalloc == −60（说减 60 就真减 60）", sum(r["alloc"] for r in rows), -60.0)
ck("fully_applied", s["fully_applied"], True)
ck("clip_gap == 0（被夹掉的 1 已重分配出去）", s["clip_gap"], 0.0)

print("\n⑥b 减单但全员报量都不够 ⇒ 夹断缺口如实上报，不造假")
rows, s = allocate(-60, [{"employee_id": 1, "employee_name": "甲", "ratio": 10, "reported_box": 5},
                         {"employee_id": 2, "employee_name": "乙", "ratio": 90, "reported_box": 50}])
ck("甲 −5 / 乙 −50（各自扣满）", (rows[0]["alloc"], rows[1]["alloc"]), (-5.0, -50.0))
ck("Σalloc == −55", sum(r["alloc"] for r in rows), -55.0)
ck("clip_gap == 5（报量不够，扣不满）", s["clip_gap"], 5.0)
ck("fully_applied=False（前端必须提示经理）", s["fully_applied"], False)

print("\n⑦ 减单到极限：全员扣到 0 也减不够 —— 与「占比缺口」不是一回事")
rows, s = allocate(-100, [{"employee_id": 1, "employee_name": "甲", "ratio": 50, "reported_box": 10},
                          {"employee_id": 2, "employee_name": "乙", "ratio": 50, "reported_box": 20}])
ck("甲 0 / 乙 0（都到 0）", (rows[0]["final_box"], rows[1]["final_box"]), (0.0, 0.0))
ck("实际只减掉 30", s["allocated"], -30.0)
ck("clip_gap == 70（报量不足）", s["clip_gap"], 70.0)
ck("ratio_gap == 0（占比是齐的，别混为一谈）", s["ratio_gap"], 0.0)

print("\n⑦b 两种「分不出去」必须分开报（占比缺口 20% + 报量不足 10）")
rows, s = allocate(-100, [{"employee_id": 1, "employee_name": "甲", "ratio": 40, "reported_box": 10},
                          {"employee_id": 2, "employee_name": "乙", "ratio": 40, "reported_box": 90}])
ck("该分 80（占比 40+40）", s["ratio_gap"], 20.0)
ck("甲扣满 10、乙承担 70（60+重分配 10）", (rows[0]["alloc"], rows[1]["alloc"]), (-10.0, -70.0))
ck("Σalloc == −80", sum(r["alloc"] for r in rows), -80.0)

print("\n⑧ 边界：无成员 / 总量 0 / 占比全 0")
rows, s = allocate(0, [{"employee_id": 1, "ratio": 100, "reported_box": 7}])
ck("总量 0 ⇒ 定稿 = 原报", rows[0]["final_box"], 7.0)
rows, s = allocate(60, [])
ck("无成员 ⇒ 不炸，allocated=0", s["allocated"], 0.0)
rows, s = allocate(60, [{"employee_id": 1, "ratio": 0, "reported_box": 3}])
ck("占比全 0 ⇒ fully_applied=False（不静默分错）", s["fully_applied"], False)

print("\n⑨ 自动分解占比（均分，合计精确 100）")
for n in (1, 2, 3, 7, 9):
    r = suggest_ratios(n)
    ck("N=%d 合计" % n, round(sum(r), 6), 100.0)
ck("3 人 ⇒ 33.33/33.33/33.34", suggest_ratios(3), [33.33, 33.33, 33.34])

print("\n⑩ 占比归一化（历史脏数据兜底）")
out, before = normalize_ratios([30, 30, 38])
ck("98 ⇒ 归一化后合计", round(sum(out), 6), 100.0)
ck("  并回报原值 98", before, 98.0)
out, _ = normalize_ratios([60, 40])
ck("已合规 ⇒ 原样", out, [60.0, 40.0])

print("\n" + "=" * 78)
if fails:
    print("❌ 失败 %d 项：" % len(fails))
    for f in fails:
        print("   - " + f)
    sys.exit(1)
print("✅ 全部通过（10 组 · 含用户原例 4 组）")
print("=" * 78)
