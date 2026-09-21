#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""改号脚本：把本会话误编的 v205 归还给正确的编号。

背景：v205 已被**同日另一会话**占用（「角色权限表按租户分叉 + 算工资窄模块」，已上线 6276b25）。
      日报里对方明确写了「本侧已实现并已上线，保留 v205，**由对方改号**」。
      v206 亦已被占用（tenant-scan / menu-perm-gate）⇒ 本会话两条线改号为：
        v207 = 合计(箱) 口径订正（可为小数 / 取整只在最终下单 / 缺规格可见）
        v208 = 保存下拉 + 留痕可靠化（保存成功后退出编辑态；原 v205-a/b/c）

纪律（照 memory/topics/skill-routing.md:122）：
  **行号白名单 + 逐行内容自证 + 全局计数断言**。禁用 `grep "A\\|B"`（zsh 静默失效），
  禁用宽替换（会把 v208 组一起改错）。

用法：python3 .workbuddy/tools/v207-renumber.py [--apply]
      默认 dry-run，只报告；--apply 才落盘。
"""
import io
import os
import re
import sys

TARGET = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    '..', '..', 'hergent-cn-v2', 'src', 'pages', 'Forecast.vue')

# 行号 -> (改为的编号, 该行必须包含的自证片段)
PLAN = {
    # ---- v207：合计(箱) 口径订正 ----
    2356: ('v207', 'boxMissing'),
    2388: ('v207', 'rowBoxes'),
    2447: ('v207', '84 → 100'),
    2515: ('v207', '可为小数'),
    2596: ('v207', '唯一实现'),
    2613: ('v207', 'rowFinalQty'),
    2616: ('v207', '抹零元凶'),
    2622: ('v207', '唯一判据'),
    2631: ('v207', '缺规格'),
    4072: ('v207', '小数位'),
    6187: ('v207', 'fmtBox'),
    6510: ('v207', '取整只发生在最终下单'),
    7678: ('v207', 'Math.round'),
    8270: ('v207', '二次抹零'),
    8281: ('v207', '3 位小数'),
    8548: ('v207', '没被算进合计'),
    # ---- v208：保存下拉 + 留痕可靠化（原 v205-a/b/c）----
    3760: ('v208', 'await'),
    6373: ('v208', '面板开着'),
    6378: ('v208', '不再完全静默'),
}

# 全文里 v205 必须恰好只剩这些行；改完后必须为 0
EXPECT_TOTAL_V205_LINES = len(PLAN)


def main():
    apply_ = '--apply' in sys.argv
    path = os.path.normpath(TARGET)
    with io.open(path, encoding='utf-8') as f:
        lines = f.read().split('\n')

    fail = []

    # ① 前置：行数够、目标行确实是 v205、自证片段在
    for ln, (new, needle) in sorted(PLAN.items()):
        idx = ln - 1
        if idx >= len(lines):
            fail.append('L%d 超出文件范围（共 %d 行）' % (ln, len(lines)))
            continue
        s = lines[idx]
        if 'v205' not in s:
            fail.append('L%d 不含 v205：%s' % (ln, s[:70]))
        if needle not in s:
            fail.append('L%d 自证片段缺失 %r：%s' % (ln, needle, s[:70]))

    # ② 前置：v205 的总行数必须与 PLAN 完全吻合（多一行 = 有人又加了改动，必须人工看）
    v205_lines = [i + 1 for i, s in enumerate(lines) if 'v205' in s]
    if len(v205_lines) != EXPECT_TOTAL_V205_LINES:
        fail.append('全文含 v205 的行数 = %d，期望 %d。实际行号 %s'
                    % (len(v205_lines), EXPECT_TOTAL_V205_LINES, v205_lines))
    unknown = [l for l in v205_lines if l not in PLAN]
    if unknown:
        fail.append('这些含 v205 的行号不在白名单里（人工确认后再改）： %s' % unknown)

    if fail:
        print('❌ 前置校验未通过，未做任何写入：')
        for f in fail:
            print('   - ' + f)
        return 2

    # ③ 单行替换（只替换该行第一处 v205；同一行若有第二处会被 ④ 抓到）
    changed = 0
    for ln, (new, _needle) in sorted(PLAN.items()):
        idx = ln - 1
        before = lines[idx]
        after = before.replace('v205', new, 1)
        if after != before:
            lines[idx] = after
            changed += 1

    out = '\n'.join(lines)

    # ④ 后置：全文 v205 必须归零
    left = [i + 1 for i, s in enumerate(out.split('\n')) if 'v205' in s]
    if left:
        print('❌ 替换后仍残留 v205： %s' % left)
        return 2

    print('✅ 前置 + 后置校验通过')
    print('   计划改号行数：%d（v207 组 %d / v208 组 %d）'
          % (len(PLAN),
             sum(1 for v in PLAN.values() if v[0] == 'v207'),
             sum(1 for v in PLAN.values() if v[0] == 'v208')))
    print('   实际改动行数：%d' % changed)
    print('   文件：%s' % path)

    if not apply_:
        print('\n（dry-run，未落盘。加 --apply 才写入）')
        for ln, (new, _n) in sorted(PLAN.items()):
            print('   L%-5d -> %s | %s' % (ln, new, lines[ln - 1].strip()[:72]))
        return 0

    with io.open(path, 'w', encoding='utf-8') as f:
        f.write(out)
    print('\n💾 已落盘。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
