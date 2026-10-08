#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v396 一次性：把 MEMORY.md 收紧到限额内，并并入 v396 路由行 + 本机坑新条。

用法：  python3 v396-memory-tighten.py            # 试算（不写盘）
        python3 v396-memory-tighten.py --write    # 落盘

🔴 纪律（沿用 v394 那份）：
  每条替换都断言**原串恰好命中 1 次** —— 命中 0 次（原文变了）或 ≥2 次（判据不唯一）
  都直接中止并打印，绝不"猜着改"。末尾还校验：总字节 ≤ LIMIT、奇数反引号行为 0。
"""
import io
import sys

LIMIT = 14848
P = '.workbuddy/memory/MEMORY.md'

# ── 收紧（每条：原串 → 新串，语义不变，只去冗） ────────────────────────────
TIGHTEN = [
    # R1 v390/393 行：去掉"（已上线）"，**保留** `**…**` 与后文之间的空格
    ('（已上线）侧栏 **8 项职能区**', ' 侧栏 **8 项职能区**'),
    # R2 同上：v393 括注去冗 + "无"→"缺"、"永久够不到"→"够不到"
    ('；**v393** 进销存入口落位、抽屉补＋；**v393b 抽屉无 `max-height`/`overflow` ⇒ 顶部永久够不到**',
     '；**v393** 进销存入口；**v393b 抽屉缺 `max-height`/`overflow` ⇒ 顶部够不到**'),
    # R3 v394 行：去"判据 ="、全角空格
    ('深色判据 = **沿祖先链 alpha 合成** ＋ **白块=亮且近灰**',
     '深色 = **沿祖先链 alpha 合成**＋**白块=亮且近灰**'),
    # R4 v394 行头：去"收口（）"
    ('`UI-SPEC.md` 收口（§8 进销存范式）：', '`UI-SPEC.md` §8 进销存范式：'),
    # R5 Excel 对标行：去"子代理拿"
    ('；子代理拿过期注释当事实＋', '；过期注释当事实＋'),
    # R6 文案行：去"模块"
    ('三态 fail-open、模块键错 ⇒', '三态 fail-open、键错 ⇒'),
    # R7 编号约定段整体替换（去 hash、去双用细节 —— 明细在 version-history.md）
    ('已用到 **v394**（⚠️ **v393 同号两用**：进销存入口 `cdb152e`／小程序明细核对层；**v393b**=抽屉补丁 `dfd7315`；v392=八页；v374 空号）。起号：① 读号表 ② 实搜**未提交文件**＋两仓 git log；**下轮从 v395 起**。明细 → `topics/version-history.md`。',
     '已用到 **v396**（⚠️ **v393 同号两用**；**v393b**=抽屉补丁；v374 空号）。起号：① 读号表 ② 实搜**未提交文件**＋两仓 git log；**下轮从 v397 起**。明细 → `topics/version-history.md`。'),
    # R8 本机坑：CDP 注入条款缩写（⚠️ 原文是「后」，**不带「之」**）
    ('CDP 注入须在 `Page.navigate` 后', 'CDP 注入须在 navigate 后'),
    # R9 本机坑：尾部括注去「等」＋ §36→§38（§37/§38 本轮新建，指向有效）
    ('其余（CSS／sqlite3／heredoc 等）→ `§10–§36`', '其余（CSS／sqlite3／heredoc）→ `§10–§38`'),
    # R10 v390/393 行：`fixed` 的解释下沉到 §v393
    ('（`fixed` 不随滚动）', ''),
    # R11 受控提交行：去「版存在」
    ('须在 HEAD 版存在', '须在 HEAD'),
    # R12 Excel 对标扫描锚点缩写（§ 段名本身未改，仅索引瘦身）
    ('`§Excel对标扫描`', '`§Excel对标`'),
    # R13 第五节标题的 § 上界 36→38
    ('（§10–§36）', '（§10–§38）'),
    # R14 「未上线」的 ⛔ 是装饰符（语义由文字承载）
    ('**v379**（⛔未上线）', '**v379**（未上线）'),
]

# ── 新增 ────────────────────────────────────────────────────────────────────
V396_LINE = (
    '  · 🔴 **v395/396** 弹窗**分组横向分列**；**模块内页签退役 ⇒ 标签栏**'
    '（点一开一／⟳左／关尽回首页／上限 18；退役必补弹窗入口）`§v396`\n'
)

ANCHOR_FRONTEND = '  · 🔴 **v394** `UI-SPEC.md` §8 进销存范式'

NEW_PITFALL = '**读图必走 OCR**（`§37/§38`）；'
ANCHOR_PITFALL = '**模板串禁裸反引号**；'


def main():
    write = '--write' in sys.argv
    s = io.open(P, encoding='utf-8').read()
    before = len(s.encode('utf-8'))

    for old, new in TIGHTEN:
        n = s.count(old)
        if n != 1:
            print('🔴 中止：替换命中 %d 次（要求恰好 1 次）\n    %s' % (n, old[:70]))
            return 2
        s = s.replace(old, new)

    # 并入 v396 行（插在 v394 行之后）
    if s.count(ANCHOR_FRONTEND) != 1:
        print('🔴 中止：v394 锚点命中 %d 次' % s.count(ANCHOR_FRONTEND))
        return 2
    eol = s.index('\n', s.index(ANCHOR_FRONTEND))
    s = s[:eol + 1] + V396_LINE + s[eol + 1:]

    # 本机坑加"读图走 OCR"
    if s.count(ANCHOR_PITFALL) != 1:
        print('🔴 中止：本机坑锚点命中 %d 次' % s.count(ANCHOR_PITFALL))
        return 2
    s = s.replace(ANCHOR_PITFALL, ANCHOR_PITFALL + NEW_PITFALL)

    after = len(s.encode('utf-8'))
    print('字节：%d → %d（%+d，限额 %d，余量 %d）' % (before, after, after - before, LIMIT, LIMIT - after))

    # 自检：反引号闭合（排除 ``` 围栏行）
    bad = 0
    for i, l in enumerate(s.split('\n'), 1):
        if l.strip().startswith('```'):
            continue
        if l.count('`') % 2:
            print('  ⚠️ 奇数反引号 line %d | %s' % (i, l[:70]))
            bad += 1
    print('  奇数反引号行 = %d' % bad)

    if after > LIMIT:
        print('🔴 超限 %d 字节，拒绝写盘。' % (after - LIMIT))
        return 3
    if bad:
        print('🔴 反引号未闭合，拒绝写盘。')
        return 3

    if write:
        io.open(P, 'w', encoding='utf-8').write(s)
        print('✅ 已写盘：' + P)
    else:
        print('（试算模式，未写盘；加 --write 落盘）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
