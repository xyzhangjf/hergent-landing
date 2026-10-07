#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
v394 · MEMORY.md 可校验收紧 + 并入 v394 路由行

纪律（历史做法）：
  每条替换断言「在全文命中恰好 1 次」，命中数 != 1 直接失败退出（不写盘）。
  先算增量、再决定收紧额度；写盘前后各报一次字节数。

用法：
  python3 v394-memory-tighten.py            # 试算（不写盘）
  python3 v394-memory-tighten.py --write     # 写盘
"""
import sys, os, hashlib

MEM = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'memory', 'MEMORY.md')
MEM = os.path.abspath(MEM)
LIMIT = 14848

V394_LINE = (
    "  · 🔴 **v394** `UI-SPEC.md` 收口（§8 进销存范式）：**同选择器 ≥3 次且逐字同 ⇒ 上提全局类**"
    "（欠账 `.page-acts` 9 处）；深色判据 = **沿祖先链 alpha 合成** ＋ **白块=亮且近灰** `§v394`"
)

OLD_105 = r'''🔴 五条最常踩：`grep "A\|B"` 静默失效 ⇒ `-e`；`&&` 短路；`| head -N` 截命中；**zsh 通配无匹配 abort 整条**；**探针别放 `/tmp`**。**探针先自证判别力**（正反两侧+N/M 写死）；**判据取值域须与输入同宽**；CDP 注入须在 `Page.navigate` 之后；**`git show HEAD:` 做对照时若改动已提交 ⇒ HEAD 就是改后，须取 `<commit>^:`**。其余（scoped CSS 插 `[data-v-…]` ⇒ 精确串恒 0；无 `sqlite3` CLI ⇒ 只读 URI+`runuser`；heredoc 经 `ssh` 吞引号 ⇒ 落盘+`scp`）→ `§10–§33`'''

NEW_105 = r'''🔴 五条最常踩：`grep "A\|B"` 静默失效 ⇒ `-e`；`&&` 短路；`| head -N` 截命中；**zsh 通配无匹配 abort 整条**；**探针别放 `/tmp`**。**探针先自证判别力**（两侧+N/M 写死）；**判据取值域须与输入同宽**；CDP 注入须在 `Page.navigate` 后；**模板串内禁裸反引号**；**`git show HEAD:` 对照前先判改动是否已提交（已 ⇒ 取 `<commit>^:`）**。其余（scoped CSS／sqlite3／heredoc 等）→ `§10–§36`'''

# 锚点：v390/393 那一行的结尾（插入 v394 行用）
ANCHOR_390 = "判「在眼前」**必按视口判** `§v390·§v393`"

PAIRS = [
    # 1) 前端区插入 v394 行（锚点尾部保留）
    ("INSERT", ANCHOR_390, ANCHOR_390 + "\n" + V394_LINE),

    # 2) 五条最常踩：整行替换（加 §36 锚、删冗余示例三层）
    ("REPL", OLD_105, NEW_105),

    # 3) 本机坑 header 版本区间
    ("REPL", "（§10–§33）", "（§10–§36）"),

    # 4) 部署区：chunk 级联那句去重
    ("REPL",
     "（级联改名 ⇒ 只传入口+改的两个 = 动态 import 404；判据 `comm -23` 缺失=0）",
     "（只传入口+改的两件 = 动态 import 404；判据 `comm -23` 缺失=0）"),

    # 5) 号表：v393 → v394 / 下轮 v395
    ("REPL",
     "已用到 **v393**（⚠️ **同号两用**：进销存侧栏入口 `cdb152e`／小程序明细核对层；**v393b**=抽屉补丁 `dfd7315`；v392=八页；v374 空号）。起号：① 读号表 ② 实搜**未提交文件**＋两仓 git log；**下轮从 v394 起**。",
     "已用到 **v394**（⚠️ **v393 同号两用**：进销存入口 `cdb152e`／小程序明细核对层；**v393b**=抽屉补丁 `dfd7315`；v392=八页；v374 空号）。起号：① 读号表 ② 实搜**未提交文件**＋两仓 git log；**下轮从 v395 起**。"),

    # 6) §三 v391/392 行：括注（同码=零判别力）下沉 topics/inventory-psi.md
    ("REPL",
     "403 判据看 `error_code`（同码 = 零判别力）→ `inventory-psi.md`",
     "403 判据看 `error_code` → `inventory-psi.md`"),

    # 7) 前端 v393 行：全角括号书引号改半角，省字不丢义
    ("REPL", "**v393** 进销存入口落位、抽屉补「＋」；", "**v393** 进销存入口落位、抽屉补＋；"),

    # 8) 技能路由：括注去冗
    ("REPL", "（夹带判据：**比字节不比名**）", "（**比字节不比名**）"),

    # 9) 副驾通知：去掉已并入版本的补记
    ("REPL", "⇒ 改名即**静音全失效**（v352 修）", "⇒ 改名即**静音全失效**"),

    # 10) 建档：括注去冗
    ("REPL", "（非 `product_channel_prices`，0 行）", "（非 `product_channel_prices`）"),

    # 11) 本机坑：词面微缩
    ("REPL", "**模板串内禁裸反引号**；", "**模板串禁裸反引号**；"),

    # 12) 部署：增词去冗
    ("REPL", "**恰好 N 个**才是在途", "**恰好 N 个**才在途"),

    # 13) 返利 v376：括注去冗
    ("REPL", "（`is_active` 仍 1、界面零异常）", "（`is_active` 仍 1、零异常）"),

    # 14) 返利 v373：括注去冗
    ("REPL", "（现行「年度合同+12月分解」主体搞反、页不可下线）", "（现行「年度合同+12月分解」主体搞反）"),

    # 15) 本机坑：尾部关键词再缩
    ("REPL", "（scoped CSS／sqlite3／heredoc 等）", "（CSS／sqlite3／heredoc 等）"),

    # 16) 后端：问句去空格
    ("REPL", "「恒定值 = 当前事实？」", "「恒定值=当前事实？」"),

    # 17) 前端 v378：词面微缩
    ("REPL", "上色只能来自 `spanHas()`", "上色只来自 `spanHas()`"),

    # 18) 前端 v209：词面微缩
    ("REPL", "⇒ `meta.roles` + `roleIn()`", "⇒ `meta.roles`+`roleIn()`"),
]


def main():
    raw = open(MEM, encoding='utf-8').read()
    before = len(raw.encode('utf-8'))
    print("=== 收紧前 ===")
    print("  bytes =", before, " / 限额", LIMIT, " 余量", LIMIT - before)

    txt = raw
    ok = True
    print("\n=== 逐条试算 ===")
    for i, (kind, old, new) in enumerate(PAIRS, 1):
        n = txt.count(old)
        d = len(new.encode('utf-8')) - len(old.encode('utf-8'))
        flag = "OK " if n == 1 else "‼️ "
        if n != 1:
            ok = False
        print("  %s#%d %-6s 命中=%d  Δ=%+d B  | %s" % (flag, i, kind, n, d, old[:38].replace('\n', '⏎')))
        if n == 1:
            txt = txt.replace(old, new)

    after = len(txt.encode('utf-8'))
    print("\n=== 收紧后（试算） ===")
    print("  bytes =", after, " Δ =", after - before, " 余量", LIMIT - after)
    if not ok:
        print("\n‼️ 有替换未命中唯一 → 拒绝写盘")
        return 2
    if after > LIMIT:
        print("\n‼️ 仍超限，需再收紧", after - LIMIT, "B → 拒绝写盘")
        return 3

    if '--write' in sys.argv:
        open(MEM, 'w', encoding='utf-8').write(txt)
        print("\n✅ 已写盘", MEM)
        print("   md5 =", hashlib.md5(txt.encode('utf-8')).hexdigest())
    else:
        print("\n（试算模式，未写盘；加 --write 落盘）")
    return 0


if __name__ == '__main__':
    sys.exit(main())
