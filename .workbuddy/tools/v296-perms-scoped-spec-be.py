#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v296（2026-09-27）受控提交 —— **后端仓 hergent-erp**：`data` 拆出 `cron` / `bid`。

用法：
    python3 .workbuddy/tools/v296-perms-scoped-spec-be.py                 # 干跑
    python3 .workbuddy/tools/v296-perms-scoped-spec-be.py --commit /tmp/msg-be.txt

⚠️ 本 spec 文件住在**前端仓**（`.workbuddy/` 在前端仓），提交的是**后端仓**；
   两个仓的路径都由 `scoped_stage_by_marker.py` 的 `REPOS` 决定，与本文件位置无关。

================================================================================
基线
================================================================================
be HEAD = d924a69（feat(perms): 权限变更「跨会话可发现」后端支撑 —— 内容指纹 + 真实改过角色（v292））
分支 = upgrade/v84-international（按既定决定**暂缓 push**，本提交不改变该决定）

================================================================================
逐文件归属（依据：`git diff -U0` 逐 hunk 读全文）
================================================================================
· server/core.py          7 hunk，`os` = 487 / 492 / 500 / 504 / 508 / 511 / 626
                          —— **全部归本轮**（v296 的 `_DEFAULT_PERMS` 四行补 `cron`/`bid` +
                          `_ALL_MODULES` + 两处注释 + 改号），故用 `own_hunks` 正向列全。
                          ⚠️ 其中 `os 508` 是**混合 hunk**（详见下方「披露式纳入」）。
· server/server.py       12 hunk；我的是 459 / 472 / 490 / 1062；其余 8 个是**别人的**：
                            · 5    `logging, subprocess`（给内存读数换 subprocess）
                            · 4973 `mem_mb = round(int(subprocess.check_output(...`（同上）
                            · 5266 / 5267 / 5280 / 5287  `warehouse_id`（v294 仓库档案）
                            · 5440 `report_mapping_alias_pool`（v295）
                            · 5518 `order_template` 从必填里移除
                          ⇒ own_hunks
· server/routers/auth.py   1 hunk（`os 85`，v292→v296 改号）⇒ keep_all

================================================================================
🔴 披露式纳入：`core.py` 的 `os 508`（本 spec 唯一一处"带走别人的字"
================================================================================
`-1 / +15` 的 hunk：`-` 侧是 `"supervisor": ["dashboard", "data"],`，`+` 侧是
  · 前 14 行 = **另一会话 v293 的注释块**（`v293（2026-09-27）加 sales：主管要盯返利冲刺看板…`）
  · 第 15 行 = `"supervisor": ["dashboard", "data", "sales", "cron", "bid"],`

**为什么必须整块纳入**（三条，按优先级）：
  1. **`sales` 与 `cron`/`bid` 在同一行** —— 它俩是同一次「整行替换」，hunk 代数
     （`trim_plus_head` / `keep_plus_slice` / `drop_plus_lines`）**只能整行取舍，
     无法在不改文本的前提下把 `sales` 剔掉**。任何"只落我的那半个"的写法都会
     把 `sales` 一起落下（试过：`keep_plus_slice:(14,1)` 落的就是含 sales 的那行）。
  2. **不纳入反而更糟**：若整块 defer，提交版的 `_DEFAULT_PERMS["supervisor"]` 就是
     `["dashboard","data"]`（**没有** cron/bid），而**迁移脚本已按"默认持 data 的四个角色"
     给存量租户补了 `cron`**（tenant_1 / tenant_10 / erp 三库实测 supervisor 都持 cron）
     ⇒ 提交出来的代码默认值与迁移判据**互相矛盾**，下一个新租户会与老租户行为不一致。
  3. 该 `sales` token **已在生产运行**（`/opt/hergent-erp/core.py:530` 实测含 `sales`），
     不是"已提交但未验证"的默认权限变更 —— 上一版 spec 担心的正是后者。

⇒ 结论：整块纳入 + **在提交说明里点名**，并同步写进交付报告 §十 遗留 #8。
   若对方会话仍要提交自己的 `sales`，会发现该行已在库中（内容一致）⇒ 无冲突、无双份。
"""

import os
import sys

REPO = "/Users/zhangjunfeng/Documents/laozhangai-product"
TOOL = os.path.join(REPO, ".workbuddy/tools/scoped_stage_by_marker.py")

SPECS = [
    {"file": "server/core.py",
     "own_hunks": [487, 492, 500, 504, 508, 511, 626], "gone": [],
     "present": ["# ---- v296（2026-09-27）：`data` 拆出两个窄模块 `cron` / `bid`",
                 '"perf", "goals", "reports", "chat", "tasks", "cron", "bid"],',
                 '"supervisor": ["dashboard", "data", "sales", "cron", "bid"],',
                 "# v296（2026-09-27）新增 `cron` / `bid` 两个**窄模块**",
                 '_ALL_MODULES = ["dashboard", "data", "sales", "buying", "stock", "accounts", "crm", "marketing", "hr", "payroll", "projects", "reports", "chat", "tasks", "cron", "bid", "settings"]',
                 "# ---- 权限联动：版本号 + 「真实改过」的角色（v296，2026-09-27）"]},

    {"file": "server/server.py", "own_hunks": [459, 472, 490, 1062], "gone": [],
     "present": ['"/api/bid-radar": "bid",',
                 '"/api/cron": "cron",',
                 '"cron":"定时任务","bid":"招投标雷达",',
                 "# v296（2026-09-27）：`/api/cron` 从 `data` **拆出独立模块 `cron`**",
                 "# 🔴 招投标雷达必须排在 `/api/bi` **之前**",
                 '"tasks":"任务与项目"'],
     "dropped": ["logging, subprocess",
                 "v294：`warehouse_id` 做一次 int 归一",
                 "def report_mapping_alias_pool_endpoint(request: Request):",
                 'missing = [k for k in ("employee", "system_name", "report_alias") if k not in idx]',
                 "subprocess.check_output(['ps', '-o', 'rss=', '-p'"]},

    {"file": "server/routers/auth.py", "keep_all": True, "gone": [],
     "present": ["# ---- v296（2026-09-27）权限联动两个派生字段"]},
]


def main():
    src = open(TOOL, encoding="utf-8").read()
    tail = "main()"
    if not src.rstrip().endswith(tail):
        raise SystemExit("工具尾部不再是裸 main()，先读一遍再改这里")
    src = src.rstrip()[: -len(tail)] + "\n"

    old_outp = 'outp = "/tmp/staged_" + os.path.basename(path)'
    assert src.count(old_outp) == 1, "工具的文件命名行变了"
    src = src.replace(old_outp, 'outp = "/tmp/v296-staged-be/" + path.replace("/", "__")')
    old_prn = 'print("   /tmp/staged_" + os.path.basename(p))'
    assert src.count(old_prn) == 1, "工具的打印行变了"
    src = src.replace(old_prn, 'print("   /tmp/v296-staged-be/" + p.replace("/", "__"))')
    os.makedirs("/tmp/v296-staged-be", exist_ok=True)

    mod = {"__name__": "ssm_v296be", "__file__": TOOL}
    exec(compile(src, TOOL, "exec"), mod)

    mod["SPECS"]["be-v296"] = ("be", SPECS)
    sys.argv = ["v296-perms-scoped-spec-be"] + ["be-v296"] + sys.argv[1:]
    mod["main"]()


if __name__ == "__main__":
    main()
