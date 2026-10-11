#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v465e（2026-10-11）受控提交 —— 仓配管理 P1「仓库作业」六页。

用法：
    python3 .workbuddy/tools/v465e-wh-scoped-spec.py                # 干跑（只写 /tmp/v465e-staged/）
    python3 .workbuddy/tools/v465e-wh-scoped-spec.py --commit /tmp/msg-v465e-fe.txt

================================================================================
基线
================================================================================
fe HEAD = ba71c2d（v465d 仓配剔除调拨单·真机探针）
be HEAD = e1f318b（v465c 仓配管理 P0 后端）

⚠️ `own_hunks` 的 `os` 是**本 spec 编成时刻** `git diff -U0` 的旧侧行号快照；
   任一会话推进 HEAD 后编号即位移 ⇒ 跑之前先复核 hunk 号（本文件末尾有复核命令）。

================================================================================
🔴 并行会话（本轮的最大约束）
================================================================================
另一个会话正在同一工作区开发**资金管理模块**（v465d，未提交）：
`src/pages/funds/`、`src/api/funds.js`、`src/constants/fundLabels.js`（新）
`server/funds_api.py`、`server/funds_db.py`（新）
并**已经改了**两个共享文件：`router/index.js`（+28 路由）、`constants/pages.js`（+28 登记行）。

⇒ 本 spec 对**所有共享文件一律用 `own_hunks` 正向认领**（不用 `exclude_hunks` 黑名单 ——
   对方只要新增一个 hunk，黑名单就会**静默夹带**它，见技能 §5.24b）。

================================================================================
逐文件归属（依据：`git diff -U0` 逐 hunk 读全文）
================================================================================
【前端仓 fe】
全新文件（9）：pages/wh/{WhDialog,WhItems,InboundList,OutboundList,EntryList,OtherIn,OtherOut,
              Stocktake,Strategy}.vue                      ⇒ new_file
本轮独占已跟踪文件（2）：
  · src/api/wh.js            5 hunk（4/14/29/30/38）**全部为本轮** ⇒ keep_all
  · docs/仓配模块开发规范.md   8 hunk **全部为本轮** ⇒ keep_all
共享文件（3）—— 混合：
  · src/components/Shell.vue       4 hunk **全部为本轮**（仓库作业拆三列）
                                   ⇒ own_hunks [485, 486, 488, 492]（仍正向认领，防对方后插)
  · src/constants/pages.js         4 hunk：我的 2 = 257 / 419；在途 2 = 391（zhoupu 行改写 +
                                   funds 28 条 PAGE_RULES）/ 440（funds 28 条占位移除）
                                   ⇒ own_hunks [257, 419]
  · src/router/index.js            3 hunk：我的 2 = 49（wh 6 个 import）/ 262（wh 6 条路由）；
                                   在途 1 = 88（funds 7 个 import）
                                   🔴 262 是**混合 hunk**：`+` 侧 51 行 = 我的 13 行（注释 6 +
                                      6 条路由 + 1 空行）在前，资金管理 38 行在后
                                      ⇒ keep_plus_slice {262: (0, 13)}
                                   dropped = ["component: FundsDoc"]（暂存 0 / 工作区 17）
本仓新增工具与产物：
  .workbuddy/tools/v465e-shadow-verify.py          影子库验收（135/135）
  .workbuddy/tools/v465e-wh-p1-local-probe.mjs     本地只读探针（8/8）
  .workbuddy/tools/v465e-wh-scoped-spec.py         本文件
  outputs/v465e-wh-p1/*.png                        8 张真机截图（binary）

【后端仓 be】
全新文件（2）：server/db/queries/wh.py、server/routers/wh.py ⇒ new_file
已跟踪（1）：server/server.py 21 行**全部为本轮**（_PATH_MODULE_MAP 补 /api/inbound 与 /api/wh
             + include_router）⇒ keep_all
"""

import os
import sys

TOOL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "scoped_stage_by_marker.py")

FE_NEW_PAGES = [
    "hergent-cn-v2/src/pages/wh/WhDialog.vue",
    "hergent-cn-v2/src/pages/wh/WhItems.vue",
    "hergent-cn-v2/src/pages/wh/InboundList.vue",
    "hergent-cn-v2/src/pages/wh/OutboundList.vue",
    "hergent-cn-v2/src/pages/wh/EntryList.vue",
    "hergent-cn-v2/src/pages/wh/OtherIn.vue",
    "hergent-cn-v2/src/pages/wh/OtherOut.vue",
    "hergent-cn-v2/src/pages/wh/Stocktake.vue",
    "hergent-cn-v2/src/pages/wh/Strategy.vue",
]

FE_NEW_TOOLS = [
    ".workbuddy/tools/v465e-shadow-verify.py",
    ".workbuddy/tools/v465e-wh-p1-local-probe.mjs",
    ".workbuddy/tools/v465e-wh-scoped-spec.py",
]

FE_NEW_SHOTS = [
    "outputs/v465e-wh-p1/入库单.png",
    "outputs/v465e-wh-p1/出库单.png",
    "outputs/v465e-wh-p1/盘点单.png",
    "outputs/v465e-wh-p1/出入库策略.png",
    "outputs/v465e-wh-p1/其它入库单.png",
    "outputs/v465e-wh-p1/其它出库单.png",
    "outputs/v465e-wh-p1/新建入库单弹窗.png",
    "outputs/v465e-wh-p1/损益单（仍是占位）.png",
]

FE_SPECS = [
    # —— 共享文件：正向认领，绝不整文件收 ——
    {"file": "hergent-cn-v2/src/components/Shell.vue",
     "own_hunks": [485, 486, 488, 492], "gone": []},
    {"file": "hergent-cn-v2/src/constants/pages.js",
     "own_hunks": [257, 419], "gone": [],
     # 🔴 我**故意没交**的别人的东西（$5.29 的 dropped 证据链：暂存 0 / 工作区 28）
     "dropped": ["'/funds/cost-abnormal':"]},
    {"file": "hergent-cn-v2/src/router/index.js",
     "own_hunks": [49, 262], "gone": [],
     "keep_plus_slice": {262: (0, 13)},
     "dropped": ["component: FundsDoc"]},
    # —— 本轮独占已跟踪文件 ——
    {"file": "hergent-cn-v2/src/api/wh.js", "keep_all": True, "gone": []},
    {"file": "hergent-cn-v2/docs/仓配模块开发规范.md", "keep_all": True, "gone": []},
]

BE_SPECS = [
    {"file": "server/server.py", "keep_all": True, "gone": []},
]


def build(which):
    if which == "fe":
        specs = list(FE_SPECS)
        # new_file 的唯一强判据是「暂存版 == 工作区」（逐字节，工具内置）
        # ⇒ present 留空，不凭印象写串（§5.42：present 串写错 = 白跑一轮）。
        for f in FE_NEW_PAGES + FE_NEW_TOOLS:
            specs.append({"file": f, "new_file": True, "gone": [], "present": []})
        for f in FE_NEW_SHOTS:
            specs.append({"file": f, "new_file": True, "binary": True})
        return ("fe", specs)
    if which == "be":
        specs = list(BE_SPECS)
        for f in ("server/db/queries/wh.py", "server/routers/wh.py"):
            specs.append({"file": f, "new_file": True, "gone": [], "present": []})
        return ("be", specs)
    raise SystemExit("未知仓别：%s" % which)


def main():
    src = open(TOOL, encoding="utf-8").read()
    # 🔴 容器工具尾部是裸 `main()`（无 `if __name__` 守卫）⇒ 直接 exec 会立刻跑起来。
    #    故：剥掉尾部调用 → exec 成独立命名空间 → 注入 spec → 调 main()。
    #    好处：**完全不动共享的 spec 容器文件**（那是多会话共写的热点，§5.17）。
    tail = "main()"
    if not src.rstrip().endswith(tail):
        raise SystemExit("工具尾部不再是裸 main()，先读一遍再改这里")
    src = src.rstrip()[: -len(tail)] + "\n"

    # 🔴 工具默认产物名 `/tmp/staged_<basename>` 在**同基名多文件**时互相覆盖（§5.41b）
    #    ⇒ 一律按完整相对路径命名。
    old_outp = 'outp = "/tmp/staged_" + os.path.basename(path)'
    assert src.count(old_outp) == 1, "工具的文件命名行变了，先读一遍再改这里"
    src = src.replace(old_outp, 'outp = "/tmp/v465e-staged/" + path.replace("/", "__")')
    old_prn = 'print("   /tmp/staged_" + os.path.basename(p))'
    assert src.count(old_prn) == 1, "工具的打印行变了，先读一遍再改这里"
    src = src.replace(old_prn, 'print("   /tmp/v465e-staged/" + p.replace("/", "__"))')
    os.makedirs("/tmp/v465e-staged", exist_ok=True)

    mod = {"__name__": "ssm_v465e", "__file__": TOOL}
    exec(compile(src, TOOL, "exec"), mod)

    mod["SPECS"]["fe-v465e"] = build("fe")
    mod["SPECS"]["be-v465e"] = build("be")

    args = sys.argv[1:]
    which = "fe-v465e"
    for a in ("fe-v465e", "be-v465e"):
        if a in args:
            which = a
            args = [x for x in args if x != a]
            break
    sys.argv = ["v465e-wh-scoped-spec"] + [which] + args
    mod["main"]()


if __name__ == "__main__":
    main()
