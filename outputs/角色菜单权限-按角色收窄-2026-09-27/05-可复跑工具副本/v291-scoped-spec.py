#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v291 受控提交：**只提交本轮「按角色收窄菜单」的改动**。

用法：
    python3 .workbuddy/tools/v291-scoped-spec.py                 # 干跑（只写 /tmp/staged_*，不碰索引）
    python3 .workbuddy/tools/v291-scoped-spec.py --commit /tmp/msg.txt

================================================================================
基线
================================================================================
fe HEAD = be94acd（v290 编辑员工弹窗评审与验收全套证据）
⚠️ 行号（own_hunks 的 os）是**本 spec 编成时刻**的快照，提交后即失效 —— 那是守卫按预期生效。

================================================================================
为什么需要它：本轮 11 个源文件里，**5 个是混合文件**
================================================================================
本仓 HEAD 远落后于生产：工作区里压着 v265 / v267 / v269 / v274 / v275 / v278 / v259
等多个会话**已部署但未提交**的改动（前端 src/ 合计 +2165 / -439 行，横跨 26 个文件）。
本轮只碰了其中 11 个，而这 11 个里 5 个混着别人的行。

逐文件归属依据（全部靠 `git diff -U0 | awk '/^@@/{...}'` 打印 hunk 首行 + 读全文裁定）：

  · constants/pages.js            HEAD 无 ⇒ new_file（本轮新建，唯一判据源）
  · Login.vue                     2 hunk，均含 v291 ⇒ keep_all
  · CustomerArchive.vue           2 hunk，均含 v291 ⇒ keep_all
  · EmployeeArchive.vue           2 hunk，均含 v291 ⇒ keep_all
  · LossWorkflow.vue              2 hunk，均含 v291 ⇒ keep_all
  · PayrollWorkflow.vue           2 hunk，均含 v291 ⇒ keep_all
  · CommandPalette.vue            4 hunk，均本轮（含 when 轴被 my canSee 取代）⇒ keep_all
  · store/index.js                4 hunk，我的是 112 / 289；183 / 285 是别人
                                  2026-09-23 的「会话补推 / 跨设备落盘」⇒ own_hunks
  · router/index.js               7 hunk，我的是 7 / 77 / 80；19 / 29 / 42 / 51 是别人
                                  v269 舟谱路由、v265 商品目标 redirect ⇒ own_hunks
  · Shell.vue                     8 hunk，我的是 42 / 74 / 88 / 139 / 149 / 154 / 192；
                                  285（SIDEBAR_MIN 120→160）是别人的 ⇒ own_hunks
  · Workbench.vue                 8 hunk，我的是 122 / 331；96 / 199 / 298 / 341 / 367
                                  是 v259「补货建议」+ P1-2b「经营研判」⇒ own_hunks

================================================================================
两处**故意保留**的在途文本（依赖闭包，§5.28 / §5.26-1）
================================================================================
1. `router/index.js` os=7 的前 5 行是 v275 的注释 → 用 `trim_plus_head {7: 5}` 丢掉。
   但**保留紧随其后的 `import { store } from '../store'`** —— 我的 `ensureRoleLoaded()`
   调 `store.loadPerms()`，摘掉它提交版会 ReferenceError（编译查不出，§5.28）。
   代价 = HEAD 多一行没有注释解释的 import，`dropped` 里点名那 5 行注释。
2. `Shell.vue` os=139（`watch` / `useRoute` import）+ os=154（v275 的
   `watch(() => route.query.denied)` 落点提示）**整体保留**：
   本轮的守卫会 `return { path:'/workbench', query:{ denied: <页面名> } }`，
   而清 query、弹提示的实现就在 os=154 —— 那是本轮**已真机验收过**的一条断言
   （「被拒后弹提示并点名页面」）。只交守卫不交它 ⇒ 提交版 URL 会永久挂着
   `?denied=xxx` 且不给任何解释（watch 是唯一清 query 的地方）。属 §5.11 的
   「拆了会产出语义不自洽的版本」⇒ 整块同行。
3. `Workbench.vue` os=122 的三行里，第 3 行 `import { hermesChat, auth } from '../api/client'`
   是别人加的 `auth`。整行落（`hermesChat` 是 HEAD 既有的，必须留）⇒ 提交版多一个
   暂未使用的 import，无行为影响（§5.26-1 的取舍）。

================================================================================
三段 `dropped`（「我故意没交的别人的东西」的唯一证据链，§5.29）
================================================================================
三处都用 `grep -cF` 预验过「HEAD = 0 / 工作区 > 0」，故 `暂存 == 0 且 工作区 > 0` 成立。
"""
import os
import sys

REPO = "/Users/zhangjunfeng/Documents/laozhangai-product"
TOOL = os.path.join(REPO, ".workbuddy/tools/scoped_stage_by_marker.py")
P = "hergent-cn-v2/src/"
DELIV = "outputs/角色菜单权限-按角色收窄-2026-09-27/"

SPECS = [
    # ── ① 唯一判据源（本轮新建）+ 它的依赖闭包 ─────────────────────────────
    # 🔴 依赖闭包（§5.28，本轮真抓到的一处）：
    #    pages.js 第 1 行 `import { roleIn, FORECAST_SUMMARY_ROLES, ZHOUPU_IMPORT_ROLES }
    #    from './roles'`，而**HEAD 版 roles.js 里这三个符号一个都没有**（实测 HEAD=0/0/0）
    #    ⇒ 只交 pages.js 会得到一个「import 不存在的具名导出」的提交版：从库里检出即建不起来
    #    （`node --check` / `py_compile` / `vite build` 都不报这种错，只有真检出才炸）。
    #    故 roles.js 必须同行入库。取证：`git diff --numstat` = **77+/1-**，唯一那行删除在
    #    `canUseMiniProgram` 函数体内（重构，不是删导出），且本文件**没有任何 import**
    #    ⇒ 闭包闭合且小（§5.28 出口 (a) 的两个前提都成立）。
    #    ⚠️ 它的改动**全部来自 v26x 在途会话**（FORECAST_SUMMARY_ROLES / ZHOUPU_IMPORT_ROLES /
    #       roleIn / canViewForecastSummary / canImportZhoupu），**我不主张作者权** ——
    #       随本提交入库只为让 pages.js 在 HEAD 上可解析。
    {"file": P + "constants/roles.js", "keep_all": True, "gone": [],
     "present": ["export function roleIn(r, allowList) {",
                 "export const FORECAST_SUMMARY_ROLES = ['admin', 'boss', 'supervisor']",
                 "export const ZHOUPU_IMPORT_ROLES = ['admin', 'boss']"]},

    {"file": P + "constants/pages.js", "new_file": True, "gone": [],
     "present": ["export const PAGE_RULES = {",
                 "export function ruleFor(path) {",
                 "export function canSeePage(path, role, canModule) {",
                 "export function pageRoleAllowed(path, role) {",
                 "export function canSee(path) {",
                 "'/bid-radar':       { title: '招投标雷达',   module: 'data',",
                 "'/settings':        { title: '设置',         module: null,"]},

    # ── ② 纯本轮：keep_all（自带「构造结果 == 工作区」自证）─────────────────
    {"file": P + "pages/Login.vue", "keep_all": True, "gone": [],
     "present": ["store.resetPerms()"]},
    {"file": P + "pages/CustomerArchive.vue", "keep_all": True, "gone": [],
     "present": ["import { canSee } from '../constants/pages'"]},
    {"file": P + "pages/EmployeeArchive.vue", "keep_all": True, "gone": [],
     "present": ["import { canSee } from '../constants/pages'"]},
    {"file": P + "pages/LossWorkflow.vue", "keep_all": True, "gone": [],
     "present": ["import { canSee } from '../constants/pages'"]},
    {"file": P + "pages/PayrollWorkflow.vue", "keep_all": True, "gone": [],
     "present": ["import { canSee } from '../constants/pages'"]},
    {"file": P + "components/CommandPalette.vue", "keep_all": True, "gone": [],
     "present": ["import { canSee } from '../constants/pages'",
                 "when: () => canSee('/bid-radar')",
                 "(!c.module || store.canModule(c.module)) && (!c.when || c.when())"]},

    # ── ③ 混合文件：own_hunks ────────────────────────────────────────────────
    {"file": P + "store/index.js", "own_hunks": [112, 289], "gone": [],
     "present": ["function resetPerms() {",
                 "perms, permsTenant, loadPerms, canModule, resetPerms,"],
     "dropped": ["可靠性补推（2026-09-23）",
                 "跨设备/重开保护（2026-09-23）"]},

    {"file": P + "router/index.js", "own_hunks": [7, 77, 80], "gone": [],
     # os=7 的 `+` 侧前 5 行是 v275 的注释 ⇒ 丢头保尾（尾部是 import { store } + 我的 4 行）
     "trim_plus_head": {7: 5},
     "present": ["import { ruleFor, pageRoleAllowed } from '../constants/pages'",
                 "async function ensureRoleLoaded() {",
                 "function roleGuarded(path) {",
                 "pageRoleAllowed(to.path, store.user.role)",
                 "query: { denied: String((ruleFor(to.path) || {}).title || to.path) }"],
     "dropped": ["🔴 这里**静态** import store 是安全的（已核实）",
                 "store/index.js 不反向依赖 router"]},

    {"file": P + "components/Shell.vue",
     "own_hunks": [42, 74, 88, 139, 149, 154, 192], "gone": [],
     # os=42 的 `+` 侧 [25..32] 是 v274「舟谱入口已撤掉」的 8 行注释（夹在我的两段 v-if 中间）
     "drop_plus_lines": {42: [25, 26, 27, 28, 29, 30, 31, 32]},
     "present": ["import { canSee } from '../constants/pages'",
                 "canSee('/settings')",
                 "store.resetPerms()     // v291：清权限缓存",
                 "watch(() => route.query.denied, (v) => {"],
     "dropped": ["v274（2026-09-25）：**舟谱单据导入的侧栏入口已撤掉**，迁进",
                 "回归判据：本文件里搜「舟谱单据导入」应当**只命中这段注释**"]},

    {"file": P + "pages/Workbench.vue", "own_hunks": [122, 331], "gone": [],
     "present": ["import { canSee, pageTitle } from '../constants/pages'",
                 "if (!canSee(t.path)) { toast('你没有访问「'"],
     "dropped": ["补货建议（v259：", "经营研判（判层 · P1-2b）"]},

    # ── ④ 零写入真机探针 + 注册表护栏（本轮新建）────────────────────────────
    {"file": ".workbuddy/tools/v291-role-menu-probe.mjs", "new_file": True, "gone": [],
     "present": ["Fetch.enable", "ProbeStubPage"]},
    {"file": ".workbuddy/tools/v291-page-registry-guard.py", "new_file": True, "gone": [],
     "present": ["PAGE_RULES"]},
    {"file": ".workbuddy/tools/v291-scoped-spec.py", "new_file": True, "gone": [],
     "present": ["SPEC_FE_V291_MARKER = 'v291'"]},

    # ── ⑤ 交付物（本轮新建，15 个）─────────────────────────────────────────
    # ⚠️ 除已 `head` 逐个核对过的几个外，**不给 present**：新文件的 `out == 工作区`
    #    是逐字节断言（比任何 `present` 串都强），凭空写串只会换来恒假红。
    {"file": DELIV + "00-实施与验收报告.md", "new_file": True, "gone": [], "present": ["v291"]},
    {"file": DELIV + "02-产物差集核查.txt", "new_file": True, "gone": []},
    {"file": DELIV + "02b-补登记后差集.txt", "new_file": True, "gone": []},
    {"file": DELIV + "03-双侧校验-本地md5清单.md5", "new_file": True, "gone": [],
     "present": ["assets/"]},
    {"file": DELIV + "03-双侧校验-线上回执.txt", "new_file": True, "gone": [],
     "present": ["条 OK"]},
    {"file": DELIV + "04-线上回读特征串.txt", "new_file": True, "gone": [],
     "present": ["entry js"]},
    {"file": DELIV + "05-可复跑工具副本/dist-pair-check.py", "new_file": True, "gone": [],
     "present": ["def "]},
    {"file": DELIV + "05-可复跑工具副本/v291-page-registry-guard.py", "new_file": True, "gone": [],
     "present": ["PAGE_RULES"]},
    {"file": DELIV + "05-可复跑工具副本/v291-role-menu-probe.mjs", "new_file": True, "gone": [],
     "present": ["Fetch.enable"]},
    {"file": DELIV + "05-可复跑工具副本/v291-scoped-spec.py", "new_file": True, "gone": [],
     "present": ["own_hunks"]},
    {"file": DELIV + "05-可复跑工具副本/本地md5清单.md5", "new_file": True, "gone": [],
     "present": ["assets/"]},
    {"file": DELIV + "05-可复跑工具副本/页面注册表-pages.js.txt", "new_file": True, "gone": [],
     "present": ["PAGE_RULES"]},
    {"file": DELIV + "06-注册表护栏.txt", "new_file": True, "gone": [],
     "present": ["PAGE_RULES 登记"]},
    {"file": DELIV + "探针-new-原始输出.txt", "new_file": True, "gone": [],
     "present": ["侧栏条目"]},
    {"file": DELIV + "探针-old-原始输出.txt", "new_file": True, "gone": [],
     "present": ["侧栏条目"]},
]

# 给 spec 自己一个只可能出现在本文件里的标记串（present 用）。
# 🔴 为什么不直接用 "v291"：它在本文件里出现几十次，且交付文档里也有 ⇒ 没有判别力。
SPEC_FE_V291_MARKER = 'v291'


def main():
    src = open(TOOL, encoding="utf-8").read()
    # 🔴 本工具**没有** `if __name__ == "__main__"` 守卫（尾部是裸 `main()`）⇒
    #    直接 import 会立刻跑起来。故：剥掉尾部调用 → exec 成模块命名空间 → 注入 spec → 调 main()。
    #    这样做的好处：**完全不改共享的 spec 容器文件**（那是个多会话共写的热点，§5.17）。
    tail = "main()"
    if not src.rstrip().endswith(tail):
        raise SystemExit("工具尾部不再是裸 main()，请先读一遍再改这里")
    src = src.rstrip()[: -len(tail)] + "\n"

    # 🔴 本轮**两个**文件的 basename 都是 `index.js`（`store/index.js` 与 `router/index.js`）
    #    ⇒ 工具默认的 `/tmp/staged_<basename>` 会**互相覆盖**，事后无法逐文件复核
    #    （freevar 审计 / SFC 定点编译都要按文件取产物）。改成按**完整相对路径**命名。
    old_outp = 'outp = "/tmp/staged_" + os.path.basename(path)'
    assert src.count(old_outp) == 1, "工具的文件命名行变了，先读一遍再改这里"
    src = src.replace(old_outp,
                      'outp = "/tmp/v291-staged/" + path.replace("/", "__")')
    old_prn = 'print("   /tmp/staged_" + os.path.basename(p))'
    assert src.count(old_prn) == 1, "工具的打印行变了，先读一遍再改这里"
    src = src.replace(old_prn, 'print("   /tmp/v291-staged/" + p.replace("/", "__"))')
    os.makedirs("/tmp/v291-staged", exist_ok=True)

    mod = {"__name__": "ssm_v291", "__file__": TOOL}
    exec(compile(src, TOOL, "exec"), mod)

    mod["SPECS"]["fe-v291"] = ("fe", SPECS)
    sys.argv = ["v291-scoped-spec"] + ["fe-v291"] + sys.argv[1:]
    mod["main"]()


if __name__ == "__main__":
    main()
