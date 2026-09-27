#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v300（2026-09-27）受控提交 —— 前端仓（laozhangai-product：hergent-cn-v2 + .workbuddy + outputs）。

用法：
    python3 .workbuddy/tools/v300-perms-scoped-spec.py                # 干跑（只写 /tmp/v300-staged/）
    python3 .workbuddy/tools/v300-perms-scoped-spec.py --commit /tmp/msg-v300.txt

================================================================================
基线
================================================================================
fe HEAD = 9c7e444（docs(tools+outputs): v299 定时任务修复的探针、drop-in 源与交付记录）
⚠️ `own_hunks` 的 `os` 是**本 spec 编成时刻** `git diff -U0` 的旧侧行号快照；HEAD 一变编号即位移。

================================================================================
逐文件归属（依据：`git diff -U0` 逐 hunk **读全文**，不看文件名、不看数量）
================================================================================
本仓工作区压着多轮「已部署但未提交」的改动（多会话并行）。本轮（v300）只碰下面 3 个
已跟踪文件，其中 **2 个是混合文件**：

  · constants/roles.js                     2 hunk，**全部为本轮** ⇒ keep_all
                                           （ROLE_END / ROLE_END_LABEL / MINI_PROGRAM_ROLES 派生）
  · pages/EmployeeArchive.vue             18 hunk：
       我的（8）  = 45 / 168 / 189 / 321 / 346 / 355 / 666 / 721
       在途（8）  = 31 / 126 / 319 / 338 / 467 / 481 / 529 / 937
                    🔴 这 8 个**全是 v294「个人仓」**（表头 / 注释 / warehouseApi / td 块 / onMounted / 样式）
       🔴 混合（2）= 50  →  `+` 侧 8 行里**前 2 行是我的**（roleName→roleDisplay），
                          第 3~8 行是 v294 的「个人仓」<td> 块 ⇒ keep_plus_slice (0, 2)
                     903 →  纯插入 2 行：`+`[0] 是 v294 的 loadWarehouses()、
                          `+`[1] 是我的 loadRoleCatalog() ⇒ keep_plus_slice (1, 1)
  · tools/role-registry-consistency-check.py  15 hunk，**全部为本轮**（AST 判据改造 + ROLE_END 化 + 判据去 chat）。
       🔴 但并入我认领的 `os=333` 的 `+` 侧 63 行里，**尾部 53 行是另一会话（v267）的
          「F2 报单汇总可见角色白名单」段** —— HEAD 版里 **`F2 报单汇总` 出现 0 次、`v267` 出现 0 次**
          （已用 `git show HEAD:<f> | grep -c` 实证）⇒ 那段**不是我写的、也不属于本轮**。
          ⇒ keep_plus_slice {333: (0, 10)}：只落我的 10 行（442..451 行的 _wired 调用 + 3 条 check）。

================================================================================
🔴 由此产生的一个**必须披露**的差异
================================================================================
提交进 git 的 `role-registry-consistency-check.py` = 工作区版 **− v267 的 F2 段（53 行）**。
而交付目录里的副本 `outputs/.../08-可复跑工具副本/role-registry-consistency-check.py`
是**工作区版**（含 F2）—— 因为 05 号证据（**44/44 全绿**）正是用工作区版跑出来的，
副本必须与「跑出证据的那一版」一致。
⇒ git 里两个同名文件差 53 行是**刻意**的，不是漏交。已在报告 §九 与提交信息里写明。

================================================================================
依赖闭包（§5.28 / §5.41）—— 已逐项核实
================================================================================
  · `roles.js` 新增的是**导出**（ROLE_END / ROLE_END_LABEL），无新 import ⇒ 闭包平凡闭合；
  · `EmployeeArchive.vue` 新引用的 `ROLE_END` / `ROLE_END_LABEL` / `canUseMiniProgram` /
    `isCanonicalRole` 全部**在同轮一并提交的 `roles.js` 里**（角色注册技能已记：这是 §5.41 的场景，
    但本轮的依赖文件 `roles.js` **本身就是我本轮改的文件** ⇒ 天然一起进）；
  · `role-registry-consistency-check.py` 新增 `func_body_has` 是**本文件内**定义、本文件内调用；
    它读的三方源码（server.py / core.py / erp_db.py）路径常量在 HEAD 里已存在（`SERVER_PY` / `CORE_PY`）。

================================================================================
凭据
================================================================================
入库前扫描发现 `v300-role-dropdown-e2e.mjs` / `v300-recon-archive.mjs` 各有 1 处
提审测试账号密码的**明文 fallback 默认值** ⇒ 已改成「必须由 `HG_PASS` 提供、缺失即 exit(1)」，
副本同步更新，并做了**双向自证**（缺 HG_PASS 中止 / 带 HG_PASS 仍 17/17 全绿）。
本 spec 清单里的所有文件重扫后**零命中**。
"""

import os
import sys

REPO = "/Users/zhangjunfeng/Documents/laozhangai-product"
TOOL = os.path.join(REPO, ".workbuddy/tools/scoped_stage_by_marker.py")

P = "hergent-cn-v2/src/"
T = ".workbuddy/tools/"
D = "outputs/权限双链治理-2026-09-27/"
A = "outputs/权限配置双链审计-2026-09-27/"
C = D + "08-可复跑工具副本/"

SPECS = [
    # ── ① roles.js：2 hunk 全是我的 ⇒ keep_all（自带「构造结果 == 工作区」逐字节自证）──
    {"file": P + "constants/roles.js", "keep_all": True, "gone": [],
     "present": ["export const ROLE_END = {",
                 "export const ROLE_END_LABEL = { mini: '仅小程序', both: '网页端 + 小程序', web: '仅网页端' }",
                 "export const MINI_PROGRAM_ROLES = Object.keys(ROLE_END).filter(r => ROLE_END[r] !== 'web')",
                 "🔴 v300（2026-09-27）订正判据：从「有 `data` **或** `chat`」收窄为「有 `data`」"]},

    # ── ② EmployeeArchive.vue：18 hunk 里 8 纯我的 + 2 混合（v294 的「个人仓」在旁边）──
    {"file": P + "pages/EmployeeArchive.vue",
     "own_hunks": [45, 50, 168, 189, 321, 346, 355, 666, 721, 903],
     "keep_plus_slice": {50: (0, 2), 903: (1, 1)},
     "gone": [],
     "present": ["{{ roleDisplay(e.account_role) }}",
                 "兼任角色：' + roleDisplay(r)",
                 "import { roleName, isCanonicalRole, ROLE_END, ROLE_END_LABEL, canUseMiniProgram } from '../constants/roles'",
                 "const BUILTIN_ROLE_ORDER = ['staff', 'supervisor', 'sales', 'guide', 'driver', 'accountant', 'boss', 'admin']",
                 "async function loadRoleCatalog() {",
                 "const extraRoleOptions = computed(() => ROLE_OPTIONS.value.filter(o => o.value !== accRoleEdit.value))",
                 "loadRoleCatalog()  // v300：角色下拉的动态值域（403/失败静默降级为内置 8 项，见函数注释）",
                 "🔴 v300（2026-09-27）从「前端写死 8 项」改为「**内置 8 项 + 本租户自定义角色**」"],
     # v294「个人仓」整批让出去 —— 用 `dropped`（暂存 0 / 工作区 >0）锁死
     "dropped": ["import { employeeApi, importApi, staffAccountApi, warehouseApi } from '../api/modules'",
                 "loadWarehouses()   // v294：个人仓下拉的数据源（失败静默降级，见函数注释）",
                 "<th title=\"个人仓 = 该员工报「本人仓」调拨单时的目标仓；在「编辑」里设置\">个人仓</th>",
                 ".df-wh{font-size:12px"]},

    # ── ③ 护栏：15 hunk 全我的；os=333 尾部粘着 v267 的 F2 段 ⇒ 只落前 10 行 ──
    {"file": T + "role-registry-consistency-check.py",
     "own_hunks": [29, 62, 97, 120, 127, 147, 209, 211, 254, 258, 260, 263, 265, 329, 333],
     "keep_plus_slice": {333: (0, 10)},
     "gone": [],
     "present": ["def func_body_has(path, funcname, needle):",
                 "    def _wired(path, fn, token, note=''):",
                 "    return ('*' in modules) or ('data' in modules)",
                 "check('ROLE_END 覆盖全部后端角色（缺 = 该角色在下拉里没有适用端标注）', not _miss_end,",
                 "check('Settings.vue 角色标签里提「小程序」的角色 = ROLE_END 里 mini/both 的角色', not _st_bad,"],
     # v267 的 F2 段整批让出去（HEAD 里为 0 ⇒ 干净的 dropped）
     "dropped": ["# ---- F2 报单汇总可见角色白名单（v267）-------------------------------------",
                 "print('F2 报单汇总可见角色白名单（后端 SUMMARY_ROLES ↔ 前端 FORECAST_SUMMARY_ROLES）')"]},
]

# ── ④ 本轮新建的工具（HEAD 无 ⇒ new_file，内容直接取工作区；逐字节自证由工具给）────────
NEW_TOOLS = [
    T + "perms-tenant-backfill.py",
    T + "perms-tenant-backfill-test.py",
    T + "v300-compile-check.py",
    T + "v300-guard-discriminate.py",
    T + "v300-perms-baseline-probe.py",
    T + "v300-role-perms-payload-probe.py",
    T + "v300-role-dropdown-e2e.mjs",
    T + "v300-recon-archive.mjs",
    T + "v300-perms-scoped-spec.py",          # 本文件自己
]

# ── ⑤ 本轮交付物（两份 outputs：治理 13 项 + 上游只读审计 4 项）──────────────────────
OUT_FILES = [
    D + "00-实施与验收报告.md",
    D + "01-补漏计划-改前备份复现.txt",
    D + "02-补漏应用与复验-副本演练.txt",
    D + "03-权限指纹-改前改后对照.txt",
    D + "04-补漏判据单测-正反例.txt",
    D + "05-角色一致性护栏.txt",
    D + "06-护栏判别力自证.txt",
    D + "07-第三产物编译校验.txt",
    D + "08-md5自证.txt",
    D + "09-真机-角色下拉动态值域.txt",
    D + "10-端点真实payload-tenant1.json",
    D + "11-端点真实payload-生成过程.txt",
    D + "12-第三产物独立验证.txt",
    D + "13-入库前凭据脱敏自证.txt",
    C + "perms-tenant-backfill.py",
    C + "perms-tenant-backfill-test.py",
    C + "role-registry-consistency-check.py",
    C + "v300-compile-check.py",
    C + "v300-guard-discriminate.py",
    C + "v300-perms-baseline-probe.py",
    C + "v300-role-perms-payload-probe.py",
    C + "v300-role-dropdown-e2e.mjs",
    C + "v300-recon-archive.mjs",
    A + "00-权限配置双链审计报告.md",
    A + "01-生产双链数据链透视.txt",
    A + "02-角色清单一致性护栏.txt",
    A + "03-可复跑工具副本/perms-dual-chain-audit.py",
]

# new_file 的唯一强判据是「暂存版 == 工作区」（逐字节，工具内置）⇒ present 留空，
# 不凭印象写串（§5.42：present 串写错 = 白跑一轮）。
for f in NEW_TOOLS + OUT_FILES:
    SPECS.append({"file": f, "new_file": True, "gone": [], "present": []})

SPEC_MARKER = "v300-perms-scoped-spec"


def main():
    src = open(TOOL, encoding="utf-8").read()
    # 🔴 容器工具尾部是裸 `main()`（无 `if __name__` 守卫）⇒ 直接 import 会立刻跑起来。
    #    故：剥掉尾部调用 → exec 成独立命名空间 → 注入 spec → 调 main()。
    #    好处：**完全不动共享的 spec 容器文件**（那是多会话共写的热点，§5.17）。
    tail = "main()"
    if not src.rstrip().endswith(tail):
        raise SystemExit("工具尾部不再是裸 main()，先读一遍再改这里")
    src = src.rstrip()[: -len(tail)] + "\n"

    # 🔴 产物命名：默认 `/tmp/staged_<basename>`。本轮的副本命名与源**不同基名但同名风险**
    #    （如 `role-registry-consistency-check.py` 出现在 T 与 C 两处）⇒ 一律按完整相对路径命名。
    old_outp = 'outp = "/tmp/staged_" + os.path.basename(path)'
    assert src.count(old_outp) == 1, "工具的文件命名行变了，先读一遍再改这里"
    src = src.replace(old_outp, 'outp = "/tmp/v300-staged/" + path.replace("/", "__")')
    old_prn = 'print("   /tmp/staged_" + os.path.basename(p))'
    assert src.count(old_prn) == 1, "工具的打印行变了，先读一遍再改这里"
    src = src.replace(old_prn, 'print("   /tmp/v300-staged/" + p.replace("/", "__"))')
    os.makedirs("/tmp/v300-staged", exist_ok=True)

    mod = {"__name__": "ssm_v300", "__file__": TOOL}
    exec(compile(src, TOOL, "exec"), mod)

    mod["SPECS"]["fe-v300"] = ("fe", SPECS)
    sys.argv = ["v300-perms-scoped-spec"] + ["fe-v300"] + sys.argv[1:]
    mod["main"]()


if __name__ == "__main__":
    main()
