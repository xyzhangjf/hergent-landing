#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v292 受控提交：**只提交本轮「角色权限 · 界面联动」的改动**。

用法：
    python3 .workbuddy/tools/v292-perms-scoped-spec.py                 # 干跑（只写 /tmp/v292-staged/，不碰索引）
    python3 .workbuddy/tools/v292-perms-scoped-spec.py --commit /tmp/msg.txt

================================================================================
基线
================================================================================
fe HEAD = ccde4f3（feat(ui): 按角色收窄菜单 —— 页面注册表成为入口可见性的唯一判据源（v291））
⚠️ `own_hunks` 里的 `os` 是**本 spec 编成时刻**的 `-U0` 旧侧行号快照，提交后即失效（守卫按预期生效）。

================================================================================
逐文件归属（依据：`git diff -U0` 逐 hunk 读全文，不看文件名/不看数量）
================================================================================
本仓 HEAD 远落后于生产：工作区压着 v265 / v269 / v274 / v275 等多轮**已部署但未提交**的改动。
本轮只碰 5 个前端文件，其中 **4 个是混合文件**（同文件里同时有别人的在途 hunk）。

  · constants/pages.js                20 hunk，**全部为本轮**（让位规则 / roleGateOpen / lock / normRole）
                                      ⇒ keep_all（自带「构造结果 == 工作区」逐字节自证）
  · store/index.js                     8 hunk；我的是 43 / 92 / 101 / 112 / 130 / 309；
                                       **203 / 305 是别人 2026-09-23 的「可靠性补推 / 跨设备落盘」** ⇒ own_hunks
  · router/index.js                    7 hunk；我的是 109 / 138；
                                       **7 / 24 / 34 / 47 / 56 是 v275 / v269 / v265 / v291 的注释块** ⇒ own_hunks
  · components/Shell.vue               3 hunk；我的是 231（v292 轮询 + visibilitychange）；
                                       **66 是 v274 舟谱入口注释、334 是别人的 `SIDEBAR_MIN 120→160`** ⇒ own_hunks
  · pages/Settings.vue                17 hunk；我的是 51 / 542 / 552 / 557 / 580 / 590 / 603；
                                       **93 / 96 / 161 / 315 / 436 / 441 / 452 / 457 / 615 / 705 是别人的
                                       「Hermes Key 移除 + 文案与布局微调」** ⇒ own_hunks

🔴 **依赖闭包已逐项核实**（§5.28 / §5.41）—— 本轮**不需要**整文件提交任何人家的文件：
    · pages.js 第 1 行 `import { roleIn, normRole, … } from './roles'`
      ⇒ HEAD 版 roles.js 里 `normRole`(1) / `roleIn`(1) **都已存在**（v291 已入库）；
    · router 的 `pageRoleAllowed` 在 HEAD 里出现 2 次（import 与调用）⇒ 已有；
    · store 的 `loadPerms`（HEAD=1）、Settings 的 `api` 导入（HEAD=1）⇒ 已有；
    · 我新引入的 `roleGateOpen` / `permsRev` / `customRoles` / `refreshPermsIfChanged` /
      `permsToModules` / `syncStorePerms` **全部定义在我自己的 hunk 里**（不在被 defer 的侧）。
    ⇒ 提交版从库里检出即可解析，无「引用了 HEAD 里不存在的符号」问题。

================================================================================
🔴 一处**故意不交**（不入库、留给对方会话）
================================================================================
`.workbuddy/tools/role-registry-consistency-check.py` 里的护栏订正（把一条**永久变红**的断言
改成断言真契约「每个 `/forecast` 入口都带门禁且无裸入口」）**本轮不予提交**：
该文件「F2 报单汇总白名单（v267）」整块（48 行）是**别人的在途新增**，而我的订正**长在它中间、
且依赖它定义的 `sh_src`** ⇒ **不可拆**。按纪律「不可拆的 hunk 宁可留给对方」，
整个文件 defer；订正会随对方那次提交一起入库（本地已实测该项 PASS：带门禁 2 处 / 裸入口 0 处）。
"""

import os
import sys

REPO = "/Users/zhangjunfeng/Documents/laozhangai-product"
TOOL = os.path.join(REPO, ".workbuddy/tools/scoped_stage_by_marker.py")
P = "hergent-cn-v2/src/"
DELIV = "outputs/权限联动-2026-09-27/"
T = ".workbuddy/tools/"

SPECS = [
    # ── ① 唯一判据源：本轮 20 个 hunk 全是我的 ⇒ keep_all ──────────────────────
    {"file": P + "constants/pages.js", "keep_all": True, "gone": [],
     "present": ["function roleGateOpen(r, role, customRoles) {",
                 "return roleGateOpen(r, role, customRoles)",
                 "export function pageRoleAllowed(path, role, customRoles) {",
                 "lock: true, cat: 'admin' }",
                 "import { roleIn, normRole, FORECAST_SUMMARY_ROLES, ZHOUPU_IMPORT_ROLES } from './roles'",
                 "return canSeePage(path, store.user.role, store.canModule, store.customRoles)"]},

    # ── ② 混合文件：own_hunks（白名单，不用 exclude_hunks —— 对方会话仍活跃）──
    {"file": P + "store/index.js", "own_hunks": [43, 92, 101, 112, 130, 309], "gone": [],
     "present": ["const permsRev = ref('')",
                 "const customRoles = ref(null)",
                 "const REV_CHECK_MIN_INTERVAL_MS = 20000",
                 "async function refreshPermsIfChanged(force = false) {",
                 "permsRev, customRoles, refreshPermsIfChanged,"],
     "dropped": ["可靠性补推（2026-09-23）", "跨设备/重开保护（2026-09-23）"]},

    {"file": P + "router/index.js", "own_hunks": [109, 138], "gone": [],
     "present": ["store.refreshPermsIfChanged().catch(() => {})",
                 "pageRoleAllowed(to.path, store.user.role, store.customRoles)"],
     "dropped": ["v275（2026-09-25）：路由级角色守卫要用到 store",
                 "v269 (2026-09-25)：舟谱单据导入（销售结算表 / 调拨订单表 → 提货单）",
                 "v265（2026-09-24）：商品目标已收进「预报订货管理」当第 4 个页签",
                 "v291（2026-09-27）：本页的角色白名单已从 `meta.roles` **迁进页面注册表**"]},

    {"file": P + "components/Shell.vue", "own_hunks": [231], "gone": [],
     "present": ["let permsTimer = null",
                 "permsTimer = setInterval(() => store.refreshPermsIfChanged(true), 60000)",
                 "document.removeEventListener('visibilitychange', onVisibilityCheck)"],
     "dropped": ["v274（2026-09-25）：**舟谱单据导入的侧栏入口已撤掉**",
                 "const SIDEBAR_MIN = 160"]},

    {"file": P + "pages/Settings.vue",
     "own_hunks": [51, 542, 552, 557, 580, 590, 603], "gone": [],
     "present": ["function permsToModules(v) {",
                 "async function syncStorePerms() {",
                 "perms: permsToModules(v.permissions).filter(p => p !== '*'),",
                 "菜单与入口已同步更新"],
     "dropped": ["<b>AI 副驾连接</b>",
                 "副驾经本系统服务端转发，网关凭据由服务端保管，无需在此填写。",
                 "import { api } from '../api/client'"]},

    # ── ③ 本轮新建的四个工具 ────────────────────────────────────────────────
    {"file": T + "perms-predicate-v292-verify.mjs", "new_file": True, "gone": [],
     "present": ["import('/src/constants/pages.js')", "B. 不变量穷举（入口可见 ⇒ 守卫放行）"]},
    {"file": T + "perms-ui-linkage-v292-e2e.mjs", "new_file": True, "gone": [],
     "present": ["ctx.route('**/api/auth/permissions*'", "const writes = []"]},
    {"file": T + "perms-v292-dist-pair-check.py", "new_file": True, "gone": [],
     "present": ["def logical(fn):"]},
    {"file": T + "perms-v292-dual-md5.py", "new_file": True, "gone": [],
     "present": ["def md5(p):"]},
    {"file": T + "v292-perms-scoped-spec.py", "new_file": True, "gone": [],
     "present": ["SPEC_FE_V292_MARKER"]},

    # ── ④ 交付物（本轮新建）─────────────────────────────────────────────────
    # ⚠️ 新文件的 `out == 工作区` 是**逐字节断言**（比任何 present 串都强）⇒
    #    除已 head 核对过的几个外不给 present，凭空写串只会换来恒假红。
    {"file": DELIV + "00-实施与验收报告.md", "new_file": True, "gone": [],
     "present": ["v292-权限联动"]},
    {"file": DELIV + "02-产物差集核查.txt", "new_file": True, "gone": [],
     "present": ["零夹带"]},
    {"file": DELIV + "03-双侧校验-本地md5清单.md5", "new_file": True, "gone": [],
     "present": ["assets/"]},
    {"file": DELIV + "03-双侧校验-线上回执.txt", "new_file": True, "gone": [],
     "present": ["项 OK"]},
    {"file": DELIV + "04-线上回读特征串.txt", "new_file": True, "gone": [],
     "present": ["perms_rev"]},
    {"file": DELIV + "06-护栏与一致性检查.txt", "new_file": True, "gone": [],
     "present": ["护栏通过"]},
    {"file": DELIV + "07-租户库只读取证.txt", "new_file": True, "gone": [],
     "present": ["表行数"]},
    {"file": DELIV + "07-租户库只读取证-全租户.py", "new_file": True, "gone": []},
    {"file": DELIV + "08-判据判别-原始输出.txt", "new_file": True, "gone": [],
     "present": ["全部通过"]},
    {"file": DELIV + "08-判据判别-调真函数.py", "new_file": True, "gone": [],
     "present": ["core.custom_roles(1)"]},
    {"file": DELIV + "探针-判据真码-原始输出.txt", "new_file": True, "gone": [],
     "present": ["27 通过 / 0 失败"]},
    {"file": DELIV + "探针-真机UI联动-原始输出.txt", "new_file": True, "gone": [],
     "present": ["19 通过 / 0 失败"]},
    {"file": DELIV + "取证-tenant1-role_permissions只读.py", "new_file": True, "gone": []},
    {"file": DELIV + "05-可复跑工具副本/perms-predicate-v292-verify.mjs", "new_file": True,
     "gone": [], "present": ["B. 不变量穷举（入口可见 ⇒ 守卫放行）"]},
    {"file": DELIV + "05-可复跑工具副本/perms-ui-linkage-v292-e2e.mjs", "new_file": True,
     "gone": [], "present": ["const writes = []"]},
    {"file": DELIV + "05-可复跑工具副本/perms-v292-dist-pair-check.py", "new_file": True,
     "gone": [], "present": ["def logical(fn):"]},
    {"file": DELIV + "05-可复跑工具副本/perms-v292-dual-md5.py", "new_file": True,
     "gone": [], "present": ["def md5(p):"]},
    {"file": DELIV + "05-可复跑工具副本/页面注册表-pages.js.txt", "new_file": True, "gone": [],
     "present": ["PAGE_RULES"]},
]

# 给 spec 自己一个只可能出现在本文件里的标记串（present 用）。
# 🔴 不直接用 "v292"：它在交付文档与工作区里出现几十次，没有判别力。
SPEC_FE_V292_MARKER = "v292-perms-scoped-spec"


def main():
    src = open(TOOL, encoding="utf-8").read()
    # 🔴 本工具尾部是裸 `main()`（无 `if __name__` 守卫）⇒ 直接 import 会立刻跑起来。
    #    故：剥掉尾部调用 → exec 成独立命名空间 → 注入 spec → 调 main()。
    #    好处：**完全不动共享的 spec 容器文件**（那是多会话共写的热点，§5.17）。
    tail = "main()"
    if not src.rstrip().endswith(tail):
        raise SystemExit("工具尾部不再是裸 main()，先读一遍再改这里")
    src = src.rstrip()[: -len(tail)] + "\n"

    # 🔴 本轮的 `store/index.js` 与 `router/index.js` **basename 都是 `index.js`**
    #    ⇒ 工具默认的 `/tmp/staged_<basename>` 会**互相覆盖**，事后无法逐文件复核
    #    （自由变量审计 / 定点编译都要按文件取产物）。改成按**完整相对路径**命名。
    old_outp = 'outp = "/tmp/staged_" + os.path.basename(path)'
    assert src.count(old_outp) == 1, "工具的文件命名行变了，先读一遍再改这里"
    src = src.replace(old_outp, 'outp = "/tmp/v292-staged/" + path.replace("/", "__")')
    old_prn = 'print("   /tmp/staged_" + os.path.basename(p))'
    assert src.count(old_prn) == 1, "工具的打印行变了，先读一遍再改这里"
    src = src.replace(old_prn, 'print("   /tmp/v292-staged/" + p.replace("/", "__"))')
    os.makedirs("/tmp/v292-staged", exist_ok=True)

    mod = {"__name__": "ssm_v292", "__file__": TOOL}
    exec(compile(src, TOOL, "exec"), mod)

    mod["SPECS"]["fe-v292"] = ("fe", SPECS)
    sys.argv = ["v292-perms-scoped-spec"] + ["fe-v292"] + sys.argv[1:]
    mod["main"]()


if __name__ == "__main__":
    main()
