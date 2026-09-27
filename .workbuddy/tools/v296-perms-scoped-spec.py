#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v296（2026-09-27）受控提交 —— **前端仓（laozhangai-product，含 hergent-cn-v2 与 .workbuddy）**。

用法：
    python3 .workbuddy/tools/v296-perms-scoped-spec.py                 # 干跑（只写 /tmp/v296-staged/，不碰索引）
    python3 .workbuddy/tools/v296-perms-scoped-spec.py --commit /tmp/msg.txt

================================================================================
基线
================================================================================
fe HEAD = a88a342（docs(outputs): v292 交付物补记两个仓的提交 hash 与归属表；补后端受控提交 spec）
⚠️ `own_hunks` 的 `os` 是**本 spec 编成时刻** `git diff -U0` 的旧侧行号快照；HEAD 一变编号即位移
   （守卫按预期生效 —— 报「白名单对不上」就该重新实取，不要照抄）。

================================================================================
逐文件归属（依据：`git diff -U0` 逐 hunk 读全文，不看文件名、不看数量）
================================================================================
本仓 HEAD 远落后于生产：工作区压着 v265/v269/v274/v275/v291/v293/v294/v295 等多轮
**已部署但未提交**的改动（多会话并行）。本轮（v296）只碰下面 6 个源文件，其中
**5 个是混合文件**（同文件里同时有别人的在途 hunk）：

  · constants/roles.js            6 hunk，**全部为本轮**（`roleIn` 两判 + 4 处注释）⇒ keep_all
  · constants/pages.js           19 hunk；**18 个是我的**，唯一在途 = `os 149`
                                 （另一会话 v294 给 `/archive` 加 `warehouses` 子路由）⇒ exclude_hunks
  · store/index.js                7 hunk；我的是 44/107/120/136/204（v292→v296 改号）；
                                 **281/383 是别人 2026-09-23 的「可靠性补推 / 跨设备落盘」** ⇒ own_hunks
  · router/index.js              10 hunk；我的是 91/111/121/146（v296 的 roleIn 收窄说明 + 两处改号 + 注释）；
                                 **7/24/34/47/56 是 v275/v269/v265/v291 的注释块、68 是 v294 的仓库档案** ⇒ own_hunks
  · components/Shell.vue          3 hunk；我的是 233（v292→v296 改号）；
                                 **66 是 v274 舟谱入口注释、362 是别人的 `SIDEBAR_MIN 120→160`** ⇒ own_hunks
  · pages/Settings.vue           15 hunk；我的是 52/62/592/622/662（改号 + 「档案管理与定时任务已分开」文案）；
                                 **114/117/182/336/457/462/473/478/676/766 是别人的「Hermes Key 移除 +
                                 测试连接改走后端真实链路」**（v281）⇒ own_hunks

✅ **本轮前端没有「物理不可拆」的混合 hunk**（不像后端 `core.py` 的 `supervisor` 行）——
   上面每个在途 hunk 都能整块让给对方。

================================================================================
🔴 依赖闭包已逐项核实（§5.28 / §5.41）—— 本轮**不需要**整文件提交任何人家的文件
================================================================================
  · `roles.js` 的 `roleIn` / `normRole` / `isCanonicalRole` 都是**已有函数**，我只改函数体一行 + 注释 ⇒ 无新符号；
  · `pages.js` 引用的 `roleIn` / `normRole` 在 HEAD 版 `roles.js` 里**都已存在**（v291 入库）；
  · `router/index.js` 的 `pageRoleAllowed` 在 HEAD 里出现 2 次（import + 调用）⇒ 已有；
  · `Settings.vue` 的 `api` 导入在 HEAD 里**已有**（`import { api, setHermesKey, hermesRequest }`）
    ⇒ 我不动那一行，闭包不受影响；
  · 本轮新引入的 `cron` / `bid` 只是 **`pages.js` 里的字符串**（模块名），不是要 import 的符号。
  ⇒ 提交版从库里检出即可解析，无「引用了 HEAD 里不存在的符号」问题。

================================================================================
🔴 删除项（本工具不支持 deleted，须另用 `git add` 单独暂存 —— 见收尾命令）
================================================================================
  · `.workbuddy/tools/perms-{predicate,ui-linkage}-v292-*.{mjs}` / `perms-v292-*.py`（4 个，改号后由 v296 新版接替）
  · `outputs/权限联动-2026-09-27/05-可复跑工具副本/` 里同名的 4 个 v292 副本

⚠️ `v292-sprint-caliber-e2e.mjs`（`??`，无 v292 前缀的删除动作）是**同日另一会话**（v292-返利冲刺口径）
   的工具，**不在本 spec、也不在暂存范围**。
"""

import os
import sys

REPO = "/Users/zhangjunfeng/Documents/laozhangai-product"
TOOL = os.path.join(REPO, ".workbuddy/tools/scoped_stage_by_marker.py")
P = "hergent-cn-v2/src/"
DELIV = "outputs/权限联动-2026-09-27/"
C = DELIV + "05-可复跑工具副本/"
T = ".workbuddy/tools/"

SPECS = [
    # ── ① 唯一判据源：6 hunk 全是我的 ⇒ keep_all（自带「构造结果 == 工作区」逐字节自证）──
    {"file": P + "constants/roles.js", "keep_all": True, "gone": [],
     "present": ["if (!k) return true                            // ① 未加载（空串）⇒ 放行：拉不到 ≠ 没权限",
                 "if (!isCanonicalRole(k)) return false          // ② v296：真·未知角色 ⇒ 收紧",
                 "「未知」必须分成两种（v296，2026-09-27）",
                 "v296：真·未知角色**不显示**",
                 "v296 起该函数对\"真未知角色\"收紧"]},

    # ── ② 混合文件：让位规则 + 拆模块的模块轴 + fail-open 分界（19 hunk 里 18 个是我的）──
    {"file": P + "constants/pages.js", "exclude_hunks": [149], "gone": [],
     "present": ["二之三、v296：`data` 拆出 `cron` / `bid` 两个窄模块",
                 "四、fail-open / fail-closed 的分界",
                 "module: 'cron',      roles: ADMIN_ROLES",
                 "module: 'bid',       roles: [...ADMIN_ROLES, 'sales']",
                 "真未知不放行，v296",
                 "② 在名单里（空串=未加载亦放行；真未知不放行，v296）"],
     "dropped": ["五个子路由自动继承本行"]},

    # ── ③ 混合文件：改号 + 权限联动接线（在本轮的改动只有改号）──
    {"file": P + "store/index.js", "own_hunks": [44, 107, 120, 136, 204], "gone": [],
     "present": ["/* v296（2026-09-27）：权限**联动**用的两件东西",
                 "// v296：权限联动的两个派生字段",
                 "/* ---- v296 权限联动：权限被别处改过时，本会话自动跟上",
                 "v296：联动的两件东西同样必须清"],
     "dropped": ["可靠性补推（2026-09-23）", "跨设备/重开保护（2026-09-23）"]},

    {"file": P + "router/index.js", "own_hunks": [91, 111, 121, 146], "gone": [],
     "present": ["⚠️ v296：这句话的适用面**收窄**了",
                 "v296（2026-09-27）两处变更：",
                 "拉不到 ⇒ 维持空串，由 roleIn 按\"未加载\"放行",
                 "v296：「权限被别处改过」在这里被发现"],
     "dropped": ["v275（2026-09-25）：路由级角色守卫要用到 store",
                 "v269 (2026-09-25)：舟谱单据导入",
                 "v265（2026-09-24）：ProductTarget 不再由路由懒加载",
                 "v291（2026-09-27）：本页的角色白名单已从 `meta.roles`",
                 "v294：仓库档案"]},

    {"file": P + "components/Shell.vue", "own_hunks": [233], "gone": [],
     "present": ["v296（2026-09-27）权限联动兜底"],
     "dropped": ["v274（2026-09-25）：**舟谱单据导入的侧栏入口已撤掉**",
                 "const SIDEBAR_MIN = 160"]},

    {"file": P + "pages/Settings.vue", "own_hunks": [52, 62, 592, 622, 662], "gone": [],
     "present": ["✅ <b>「档案管理」与「定时任务」已经分开</b>（v296 起）",
                 "v296：这两段文案是**功能的一部分**",
                 "v296：这里**不再**丢弃",
                 "v296：保存/恢复后**必须把本会话的权限重新拉一遍**",
                 "v296：恢复默认同样是一次权限变更"],
     "dropped": ["AI 副驾连接", "网关凭据由服务端保管，无需在此填写。",
                 "import { api } from '../api/client'"]},

    # ── ④ 本轮新建/改名后的工具 ──────────────────────────────────────────────
    # ⚠️ 新文件的「暂存版 == 工作区」是**逐字节断言**（比任何 present 串都强）⇒
    #    present 只为「可读性 + 防呆」，一律**实取**（凭空写串只会换来恒假红）。
    {"file": T + "perms-predicate-v296-verify.mjs", "new_file": True, "gone": [],
     "present": ["B. 不变量穷举（入口可见 ⇒ 守卫放行）",
                 "E. 🔴 真·未知角色（库管）的收紧 —— 反例对照",
                 "roleIn(库管, [库管]) = false"]},
    {"file": T + "perms-ui-linkage-v296-e2e.mjs", "new_file": True, "gone": [],
     "present": ["const writes = []", "层次② 导航时比对"]},
    {"file": T + "perms-v296-dist-pair-check.py", "new_file": True, "gone": [],
     "present": ["def logical(fn):"]},
    {"file": T + "perms-v296-dual-md5.py", "new_file": True, "gone": [],
     "present": ["def md5(p):"]},
    {"file": T + "v296-data-split-migrate.py", "new_file": True, "gone": [],
     "present": ["def migrate_value(v, role):", "破坏性收紧"]},
    {"file": T + "v296-prod-backup.py", "new_file": True, "gone": [],
     "present": ['con.execute("VACUUM INTO ?", (out,))']},
    {"file": T + "v296-api-reachability.py", "new_file": True, "gone": [],
     "present": ["正例：bid 模块", "反例：reports 域"]},
    {"file": T + "v296-perms-scoped-spec.py", "new_file": True, "gone": [],
     "present": ["v296-perms-scoped-spec"]},
    {"file": T + "v296-perms-scoped-spec-be.py", "new_file": True, "gone": [],
     "present": ["v296-perms-scoped-spec-be"]},

    # ── ⑤ 交付物：新增证据 + 本轮更新的报告 / 副本 ────────────────────────────
    {"file": DELIV + "探针-判据真码-v296-更新后.txt", "new_file": True, "gone": [],
     "present": ["44 通过 / 0 失败"]},
    {"file": DELIV + "探针-真机UI联动-v296-重跑.txt", "new_file": True, "gone": [],
     "present": ["19 通过 / 0 失败", "custom_roles"]},
    {"file": DELIV + "09-模块拆分-迁移终态只读复验.txt", "new_file": True, "gone": [],
     "present": ["破坏性收紧 = 0 处", "将变更的行 = 0"]},
    {"file": DELIV + "10-接口可达性-正反例.txt", "new_file": True, "gone": [],
     "present": ["全部符合预期", "正例：bid 模块"]},

    # 报告：4 hunk 全是本轮（标题 / §八 #1 改状态 / §九 加注 / §十 全段）⇒ keep_all
    {"file": DELIV + "00-实施与验收报告.md", "keep_all": True, "gone": [],
     "present": ["## 十、v296（2026-09-27 晚）：§九 五项拍板的执行结果",
                 "**逐条核实 = 五条全是现状**",
                 "🔴 **「定时任务」页面对\"任何能进的人\"当前是坏的**",
                 "### 10.9 遗留（v296 新增）"]},

    # 副本 pages.js：与源同结构 ⇒ 同一个在途 hunk 也要让出去（否则把 v294 的仓库档案夹带进交付副本）
    {"file": C + "页面注册表-pages.js.txt", "exclude_hunks": [149], "gone": [],
     "present": ["二之三、v296：`data` 拆出 `cron` / `bid` 两个窄模块"],
     "dropped": ["五个子路由自动继承本行"]},

    {"file": C + "perms-predicate-v296-verify.mjs", "new_file": True, "gone": [],
     "present": ["B. 不变量穷举（入口可见 ⇒ 守卫放行）"]},
    {"file": C + "perms-ui-linkage-v296-e2e.mjs", "new_file": True, "gone": [],
     "present": ["const writes = []"]},
    {"file": C + "perms-v296-dist-pair-check.py", "new_file": True, "gone": [],
     "present": ["def logical(fn):"]},
    {"file": C + "perms-v296-dual-md5.py", "new_file": True, "gone": [],
     "present": ["def md5(p):"]},
    {"file": C + "v296-data-split-migrate.py", "new_file": True, "gone": [],
     "present": ["def migrate_value(v, role):"]},
    {"file": C + "v296-prod-backup.py", "new_file": True, "gone": [],
     "present": ['con.execute("VACUUM INTO ?", (out,))']},
    {"file": C + "v296-api-reachability.py", "new_file": True, "gone": [],
     "present": ["正例：bid 模块"]},
]

# 给 spec 自己一个只可能出现在本文件里的标记串（present 用）。
# 🔴 不直接用 "v296"：它在交付文档与工作区里出现上百次，没有判别力。
SPEC_FE_V296_MARKER = "v296-perms-scoped-spec"


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
    #    ⇒ 工具默认的 `/tmp/staged_<basename>` 会**互相覆盖**，事后无法逐文件复核。
    #    改成按**完整相对路径**命名。
    old_outp = 'outp = "/tmp/staged_" + os.path.basename(path)'
    assert src.count(old_outp) == 1, "工具的文件命名行变了，先读一遍再改这里"
    src = src.replace(old_outp, 'outp = "/tmp/v296-staged/" + path.replace("/", "__")')
    old_prn = 'print("   /tmp/staged_" + os.path.basename(p))'
    assert src.count(old_prn) == 1, "工具的打印行变了，先读一遍再改这里"
    src = src.replace(old_prn, 'print("   /tmp/v296-staged/" + p.replace("/", "__"))')
    os.makedirs("/tmp/v296-staged", exist_ok=True)

    mod = {"__name__": "ssm_v296", "__file__": TOOL}
    exec(compile(src, TOOL, "exec"), mod)

    mod["SPECS"]["fe-v296"] = ("fe", SPECS)
    sys.argv = ["v296-perms-scoped-spec"] + ["fe-v296"] + sys.argv[1:]
    mod["main"]()


if __name__ == "__main__":
    main()
