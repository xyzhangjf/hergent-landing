#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""范围化暂存器（多仓库 / 多轮次），三种归属模式 —— Hergent scoped commit 的落地实现。

归属模式（每个文件选一种）：
  · "markers":      内容标记串；**每个标记必须恰好命中 1 个 hunk**（命中 0/多个即中止）
  · "exclude_hunks": 在途 hunk 的 old_start 黑名单；其余全部归本轮
  · "keep_all":     该文件本轮所有 hunk 都归我 → 断言「构造结果 == 工作区」自证

三种模式共用的**并集覆盖断言**（技能 hergent-scoped-commit §5.6）：
    got_hunks == sorted(mine ∪ deferred)
没写上去的 hunk 一律中止 —— 它同时证明「白名单没写错」与「不存在两侧都没认领的 hunk」。

保底自证（全绿才动索引）：
  ① 每 hunk 旧侧与 HEAD 逐字断
  ② 残留 hunk（暂存版 vs 工作区）== 在途 hunk 数
  ③ 在途特征行在暂存版里的出现次数 == 在 HEAD 里的次数（零夹带）
  ④ GONE 列表在暂存版与工作区都必须为 0
  ⑤ keep_all 文件：暂存版必须与工作区逐字节相同

用法：
  python3 scoped_stage_by_marker.py <spec名>              # 干跑，只写 /tmp/staged_*
  python3 scoped_stage_by_marker.py <spec名> --commit /tmp/msg.txt
"""
import os
import re
import subprocess
import sys

REPOS = {
    "fe": "/Users/zhangjunfeng/Documents/laozhangai-product",
    "be": "/Users/zhangjunfeng/Documents/hergent-erp",
}

# ── v171b：说明文字清理（保留作记录）────────────────────────────────────
SPEC_V171 = ("fe", [
    {
        "file": "hergent-cn-v2/src/pages/Rebate.vue",
        "markers": ["只记<b>真实变化</b>", "字段级留痕；数据源与写路径见下方弹窗注释", "都会自动记录在这里"],
        "gone": ["真实变化", "自动留痕", "都会自动记录在这里", "改成了什么"],
    },
    {"file": "hergent-cn-v2/src/pages/Forecast.vue",
     "markers": ["修改日志：本期每一次改动", "关闭期次会自动记录"],
     "gone": ["关闭期次会自动记录", "都会自动留痕"]},
    {"file": "hergent-cn-v2/src/pages/BrandArchive.vue", "markers": ["ba-add-hint"],
     "gone": ["点击后填写品牌信息"]},
    {"file": "hergent-cn-v2/src/pages/RoleManage.vue",
     "markers": ["'点击更换头像'", "'点击停用'"],
     "gone": ["点击更换头像", "点击上传头像", "点击停用", "点击启用"]},
])

# ── v163 + v164：预报订单导入（户头 / 期次 / 回执 / 厂价证明）─────────────
# 归属依据（逐 hunk 打印首行核对过，不按行号猜）：
SPEC_BE_V163 = ("be", [
    # 该文件本轮全部 hunk 都属本次（无在途改动）→ 用 keep_all 拿到「== 工作区」自证
    {"file": "server/routers/import_router.py", "keep_all": True, "gone": []},
    {"file": "server/db/queries/business_profile.py", "keep_all": True, "gone": []},
    {"file": "server/routers/forecast_config.py", "keep_all": True, "gone": []},
    {
        "file": "server/erp_db.py",
        # 在途（别人的、未提交）：
        #   1398  products DDL 里 extra_json 从「表定义外」挪进定义内（v161 收尾，非本轮）
        #   10895 + 10910  `_safe_migrate("v110_products_dist_price")` 的**搬家两半**（技能 §5.8：搬移必须两半一起排除）
        #   11327 + 11330  `login_is_locked` 双维度 IP 锁定（v125，未提交）
        "exclude_hunks": [1398, 10895, 10910, 11327, 11330],
        "gone": [],
    },
    {
        "file": "server/routers/forecast.py",
        # 在途：471  付款到账通知的 sender 展示名（"运营主管" → "经营副驾"），非本轮
        "exclude_hunks": [471],
        "gone": [],
    },
])

SPEC_FE_V163 = ("fe", [
    {"file": "hergent-cn-v2/src/pages/ReportMapping.vue", "keep_all": True, "gone": []},
    {
        "file": "hergent-cn-v2/src/pages/Forecast.vue",
        # 在途（均为 2026-09-13 那批未提交改动）：
        #   101        纯空行 hunk（无法归属，排除零风险）
        #   2264/2266/2277/2279  srcByPid / extraByPid 改「合并而非覆盖」
        #   6002/6004  loadCross 的 sumById 合并（同上）
        #   6778/6794  `.imp-errs` 规则**搬家两半**（技能 §5.8：两半必须一起排除）
        #   7105       纯空行 hunk
        "exclude_hunks": [101, 2264, 2266, 2277, 2279, 6002, 6004, 6778, 6794, 7105],
        "gone": [],
    },
])

# ── v173：达成数据「周期口径」下拉下线（前端）+ 存储键恒为月度键（后端）──────
# 前端归属说明（**本文件本轮为 keep_all，理由必须写清**）：
#   41 个 hunk 中本轮的 7 个纯属本轮、9 个与在途深度混合、其余属在途的 v156
#   「达成填报月度目标口径 + 全年月度对比」块（自 2026-09-13 起一直在途，见
#   memory/2026-09-13.md 第 615 行：44 hunk → 保留 27 / 拆 2 / 排除 15）。
#   之所以不能按 hunk 拆：本轮新增的「周期」列（`<td>周期</td>`）与在途把该行
#   `<td>{{ row.target_type ? fmtTarget(row) : '—' }}</td>` 改名成 `fmtAchvTarget(row)`
#   落在**同一个 @@ 块**里；只留我那一半会产出「列名叫『本月目标』、取的却是整期
#   target_value」的错误中间态（`fmtAchvTarget` / `monthTarget` 均为 HEAD 不存在的
#   在途符号，HEAD 计数 = 0）。且本轮 `onAchvMonth()` 调用在途的
#   `loadYearAchievements()`。⇒ 按技能 §10.1「带进来的那部分改动，它的完整语义是否
#   也在本次提交里？」，这些在途块必须同行；强行拆分只会把 HEAD 留成自相矛盾的一版。
#   连带 `</td>` 标签归位（348/356/357/360）与行位移（1658/1733/1745/1754 等）也在同一页
#   同一批函数内，一并落地；它们**已全部部署在产**（工作区即部署产物）。
SPEC_V173_FE = ("fe", [
    {"file": "hergent-cn-v2/src/pages/Rebate.vue", "keep_all": True,
     # 本轮删掉的原文（不在我的注释里出现，故可安全断言 == 0）
     "gone": ['<option value="month">按月</option>',
              '<option value="quarter">按季</option>',
              '<option value="year">按年</option>',
              "const achvPeriod = ref('month')",
              "function onAchvPeriod()",
              "function onAchvPeriodInput()"]},
])

# 后端归属说明：
#   rebate_calc.py       3 hunks 全在本轮改写的 period_key_for 内 → keep_all
#   rebate_achievements.py 7 hunks 全为本轮（写入端 fail-closed），已逐个打印首行核对 → keep_all
#   erp_db.py            本轮 4 hunks（accrue_rebate / get_rebate_contract_overview 传 ref_date、
#                        _contract_year_achieved 文档串）；在途 5 hunks：
#                          1400  products DDL 里 extra_json 归位（v161 收尾）
#                          10906 + 10921  `_safe_migrate("v110_products_dist_price")` 搬家两半
#                          11338 + 11341  `login_is_locked` 双维度 IP 锁定
SPEC_V173_BE = ("be", [
    {"file": "server/domain/rebate_calc.py", "keep_all": True, "gone": []},
    {"file": "server/routers/rebate_achievements.py", "keep_all": True, "gone": []},
    {"file": "server/erp_db.py",
     "exclude_hunks": [1400, 10906, 10921, 11338, 11341],
     "gone": []},
])

# ── v175：本期预报主表「序号列冻结」（前端）─────────────────────────────
# 归属依据（逐 hunk 打印首行核对，不按行号猜）：
#   本轮 9 个 hunk：1983（frozenShift 定义）/ 572 600 669（只读表 thead·tbody·表尾）
#                   / 773 806 863（编辑表 thead·tbody·表尾）/ 6692（序号列 sticky CSS）
#                   / 6698（表尾冻结格反向同步 CSS）
#   在途 10 个 hunk（2026-09-13 起同一批未提交改动）：
#     101        纯空行
#     2316/2318  srcByPid 改「合并而非覆盖」
#     2329/2331  extraByPid 累加
#     6155/6157  loadCross 的 sumById 防御性聚合
#     6931/6947  `.imp-errs` 规则**搬家两半**（技能 §5.8：搬移两半必须一起排除）
#     7280       纯空行
SPEC_FE_V176 = ("fe", [
    {
        "file": "hergent-cn-v2/src/pages/Forecast.vue",
        "exclude_hunks": [101, 2316, 2318, 2329, 2331, 6155, 6157, 6931, 6947, 7280],
        # 本轮删掉的旧内联（冻结列偏移硬编码 0 / 200px）——暂存版里必须为 0，
        # 同时证明「6 个渲染点全部改到」，没有漏掉任何一处
        "gone": ["'left:0;min-width:200px'", "'left:200px;min-width:200px'",
                 "isFrozen(col) ? 'left:0' : ''"],
    },
])

# ── v177：本期预报主表下线五列（前端）───────────────────────────────────
# 归属依据（逐 hunk 打印首行核对，不按行号猜）：
#   本轮 5 个 hunk —— 全部落在列注册表及其派生配置上：
#     1981       COL_DEFAULTS 去掉 safety_stock/expiry_days 的默认列宽（列已不渲染 → 死配置）
#     2131       在 MASTER_COL_DEFS 上方插入 v177 说明注释块（纯插入 10 行）
#     2137       删 sale_price（标准售价）列定义
#     2141       删 safety_stock / expiry_days / moq / lead_days 四条列定义
#     2215       COLUMN_PERMISSIONS 去掉 sale_price 条目（列已不渲染 → 死配置）
#   ⚠️ 本轮**只删显示列**：行对象数据字段、DRAFT_MASTER_KEYS、prodRows upsert 载荷、
#      HEADER_KEYS 粘贴/导入映射、rowWarn/moqWarn/rowMoq/rowLead/computeSuggestion
#      一律未动（diff 仅 5 个 hunk 即证）。
#   在途 10 个 hunk（2026-09-13 起同一批未提交改动，与 SPEC_FE_V176 那份名单同源）：
#     101        纯空行
#     2322/2324  srcByPid 改「合并而非覆盖」
#     2335/2337  extraByPid 累加
#     6161/6163  loadCross 的 sumById 聚合
#     6957/6973  `.imp-errs` 规则**搬家两半**（技能 §5.8：两半必须一起排除）
#     7306       纯空行
SPEC_FE_V177 = ("fe", [
    {
        "file": "hergent-cn-v2/src/pages/Forecast.vue",
        "exclude_hunks": [101, 2322, 2324, 2335, 2337, 6161, 6163, 6957, 6973, 7306],
        # 本轮删掉的列定义与死配置：暂存版与工作区都必须为 0
        "gone": ["{ key: 'sale_price', label: '标准售价'",
                 "{ key: 'safety_stock', label: '安全库存'",
                 "{ key: 'expiry_days', label: '保质期天'",
                 "{ key: 'moq', label: '起订量'",
                 "{ key: 'lead_days', label: '到货天数'",
                 "sale_price: ['owner', 'finance', 'sales', 'supervisor']",
                 "safety_stock: 86, expiry_days: 86"],
    },
])

SPEC_FE_V178 = ("fe", [
    {
        "file": "hergent-cn-v2/src/pages/Forecast.vue",
        # 在途 10 个 hunk 全是 2026-09-13 的「同商品多行合并」——loadEditGrid 的
        # srcByPid 合并 + extraByPid 累加、loadCross 的 sumById 逐字段合并，
        # 外加两处 CSS 挪位与两个空行。与本轮「条码重复改按品牌判定 + 条码列加宽」无关。
        "exclude_hunks": [101, 2328, 2330, 2341, 2343, 6167, 6169, 6963, 6979, 7312],
        "gone": [],
    },
    {
        "file": ".workbuddy/tools/forecast-errlist-verify.js",
        # 9 个 hunk 全部是本轮为「同品牌才重复」做的适配：抓品牌列数据位、制造重复时
        # 连品牌一起抄、复原改为逐项还原原值。无在途改动 → keep_all（自证 == 工作区）。
        "keep_all": True,
        "gone": [],
    },
])

# v178 收尾小提交：探针输出目录可用 HG_OUT 覆盖 + 交付说明按「当前线上包」复跑结论修正。
# 两个文件的本轮改动都归我（探针 2 hunk / 说明 2 hunk），无在途 → keep_all。
SPEC_FE_V178B = ("fe", [
    {
        "file": ".workbuddy/tools/forecast-brand-dup-verify.js",
        "keep_all": True,
        "gone": [],
    },
    {
        "file": "outputs/条码重复按品牌判定-2026-09-16/条码重复按品牌判定-改动范围与验证结果-2026-09-16.md",
        "keep_all": True,
        "gone": [],
    },
])

# ── v178c：导入「列映射确认」界面（前端）────────────────────────────────
# ✅ **已提交（2026-09-16）**：代码 `731fa14`（5 文件 +296/−53）。复跑本 spec 会命中
#    `ImportMapping.vue：标了 new_file，但 HEAD 里已存在同名文件` —— 那是**守卫按预期生效**，
#    不是回归；要复现请先 `git stash` 或用提交前的 HEAD 建临时 worktree。
# 归属依据（逐 hunk 打印首行核对过，不按行号猜）：
#   ImportMapping.vue      **新文件**（HEAD 无）→ 走 new_file，内容 == 工作区
#   ProductArchive.vue     全部 hunk 都是本轮（impStep 两步式 / ImportMapping / pa-map 样式）→ keep_all
#   DataFill.vue           全部 hunk 都是本轮（previewInv+doImportInv 拆分 / df-map 样式）→ keep_all
#   EmployeeArchive.vue    本轮 10 个；在途 2 个 —— **同一条改动的两半**（技能 §5.8）：
#     3     模板 `page-hd` → `page-hd split`
#     618   scoped `.page-hd/.page-hd h2/.page-sub` 整组删除（搬到全局层）
#     ⇒ 只排一半会让模板用 `page-hd split` 而全局 CSS 里还没有 `.page-hd`。两半一起排除。
#   Forecast.vue           本轮 11 处；在途 10 处（均为 2026-09-13 起那批未提交改动）：
#     101        纯空行
#     2332/2334  srcByPid 改「合并而非覆盖」
#     2345/2347  extraByPid 累加
#     6208/6210  loadCross 的 sumById 逐字段合并
#     7020       `.imp-errs` 规则**搬出**（原 HEAD:7020）
#     7353       纯空行
#     🔴 7005 是**混合 hunk**：diff 把「我删掉的 `.imp-ident-row .imp-miss{...}`」与
#        「在途搬进来的 `.imp-errs{...}`」配成了一对 1→1 修改。故走 `split_minus_only`：
#        只落 `-` 侧（我的删除），丢弃 `+` 侧（在途的搬入）。与排除 7020（搬出）配合，
#        `.imp-errs` 在暂存版里仍留在 HEAD 原位，恰好一份、零夹带。
SPEC_FE_V178C = ("fe", [
    {"file": "hergent-cn-v2/src/components/ImportMapping.vue", "new_file": True, "gone": []},
    {"file": "hergent-cn-v2/src/pages/ProductArchive.vue", "keep_all": True,
     # 一步式 → 两步式：旧按钮文案与旧函数名双双消失（HEAD 各 1 / 2 处，暂存版与工作区都必须 0）
     "gone": ["开始导入", "runImport"]},
    {"file": "hergent-cn-v2/src/pages/DataFill.vue", "keep_all": True,
     "gone": ["importInventory"]},
    {"file": "hergent-cn-v2/src/pages/EmployeeArchive.vue",
     "exclude_hunks": [3, 618], "gone": ["importEmployees"]},
    {
        "file": "hergent-cn-v2/src/pages/Forecast.vue",
        "exclude_hunks": [101, 2332, 2334, 2345, 2347, 6208, 6210, 7020, 7353],
        "split_minus_only": [7005],
        # 本轮删掉的旧内联与死 CSS：暂存版与工作区都必须为 0
        "gone": ['v-if="impCross" class="imp-ident"',
                 ".imp-ident{background:var(--bg3)",
                 ".imp-ident-row{display:flex",
                 ".imp-ident-row .imp-miss{color:var(--war)}",
                 ".imp-customers{font-weight:400",
                 "const impCross = ref(null)"],
    },
])

# ── v178c：导入「列映射确认」后端支持（后端）────────────────────────────
# ✅ **已提交（2026-09-16）**：`942732a`（+98/−11）。复跑本 spec 会打出「hunk 总 0」并自证通过
#    —— 那是「已提交、工作区已干净」的正常表现。
# 归属依据：9 个 hunk 全部为本轮，无在途改动（逐 hunk 打印首行核对，全部含 v178 或本轮新增符号）
#   81    COLUMN_PATTERNS["products"] 补 product_code（插在 brand 之前）
#   161   FIELD_LABELS 取代旧 _all_fields 字面量
#   208   _all_fields 改为由 FIELD_LABELS 派生
#   764/774/776  /preview 客户列「就地升级」修重复条（by_index）
#   794   每列附 samples（最多 3 个不重复非空值）
#   837/851  field_options（key + 中文标签）下发
SPEC_BE_V178C = ("be", [
    {"file": "server/routers/import_router.py", "keep_all": True, "gone": []},
])

# ── v179：主表行底只列「本批导入 ∪ 有报单」+ 导入即建档（前端）─────────────
# 归属依据（逐 hunk 打印首行核对过，不按行号猜）。基线 HEAD = edc1b36。
#   本轮 16 个：
#     150/154   导入回执改「四分支」（archived_no_qty 独立成一档，不再渲染成绿色成功）
#     514/684   两处工具栏加「显示全部商品」开关 + 「另有 N 个在售商品未显示」角标
#     604       商品名单元格加「导入 / 已停用」角标
#     1787/1788 showAllProducts + hiddenByRowBase + asProdRow + buildRowBase + 勾选 watcher
#     2361/2366/2430  编辑态行底（offArchive / rowBaseTotal / 草稿分支）
#     6206/6209/6236/6244  查看态行底与角标
#     7004（trim_plus 后）/7039  `.imp-none` 与 `.imp-tag`/`.off-tag` 样式
#   在途 7 个（均为 2026-09-13 起那批未提交改动）：
#     101          纯空行
#     2326/2328    srcByPid 改「合并而非覆盖」
#     2339/2341    extraByPid 累加
#     7019         `.imp-errs` 规则**搬出**（原 HEAD:7019）
#     7352         纯空行
#   🔴 7004 是**混合 hunk**：我的 3 行（2 行注释 + `.imp-none`）后面**粘着在途搬进来的
#      `.imp-errs{...}`** —— `-U0` 把相邻插入合并成一块，整块留/整块排都错。
#      故走 `trim_plus:{7004:1}`：只落前 3 行、丢掉尾部 1 行；与排除 7019（搬出）配合
#      ⇒ `.imp-errs` 在暂存版里**仍留在 HEAD 原位、恰好一份**，我的 `.imp-none` 完整落地。
SPEC_FE_V179 = ("fe", [
    {"file": "hergent-cn-v2/src/pages/Forecast.vue",
     "exclude_hunks": [101, 2326, 2328, 2339, 2341, 7019, 7352],
     "trim_plus": {7004: 1},
     "gone": []},
])

# ── v179：导入即建档（与数量解耦）+ 登记台账 + summary 带行返回（后端）─────────
# 归属依据（逐 hunk 打印首行核对）。基线 HEAD = 942732a（分支 upgrade/v84-international）。
#   import_router.py：9 个 hunk **全部是 `_execute_forecast_cross` 内**的本轮重写
#     （语汇全是 `_prod_rows` / `pr["..."]` / `oe_row` / `_reg_rows`）→ keep_all（自证 == 工作区）
#   erp_db.py：本轮 3 个 / 在途 5 个
#     1814      本轮：_ensure_forecast_tables 惰性建 forecast_import_products
#     15861     本轮：init_db 里 _safe_migrate('v179_forecast_import_products')
#     16157     本轮：forecast_submission_summary 返回 imported_products（带行，不只 id）
#     1400      在途：products DDL 括号修正（extra_json 归位）
#     10916/10931 在途：_safe_migrate("v110_products_dist_price") 的**搬家两半**（技能 §5.8，必须一起排）
#     11348/11351 在途：login_is_locked 双维度 IP 锁定（LOGIN_LOCK_IP_MAX）
SPEC_BE_V179 = ("be", [
    {"file": "server/routers/import_router.py", "keep_all": True, "gone": []},
    {"file": "server/erp_db.py",
     "exclude_hunks": [1400, 10916, 10931, 11348, 11351],
     "gone": []},
])

# ── v180：期次归属前置展示 + 条件引导 + 改名入口（前端）─────────────────────
# 基线 HEAD = 3ae7de4（分支 main）。逐 hunk 打印首行核对归属：
#   Forecast.vue：24 个 hunk → 本轮 16 / 在途 7 / 纯空行 1
#     2422/2424/2435/2437 在途：loadEditGrid 里「sources 合并而非覆盖」（09-13 起在途，
#        §5.12 记载的那批，与本轮无关）
#     7148/7163           在途：`.imp-errs` 规则的**搬家两半**（§5.14/§5.15，必须一起排）
#     101 / 7500          纯空行 hunk：无归属价值，排除零风险（§5.8）
#     其余 16 个          本轮：pick 步归属、mismatch 提示、软警告、名称解析条件覆盖、
#         curOpenPeriodId 口径隔离、pe-modal、AUDIT_ACTION_LABEL、np-warn CSS
#   ForecastHistory.vue：2 个 hunk **全部本轮**（行内「修改」按钮 + defineEmits）→ keep_all
#   modules.js：9 个 hunk → 本轮 1 / 在途 8
#     24      本轮：forecastApi.updatePeriod（PATCH /periods/{pid}）
#     293/298 在途：forecastApproveApi.summary 加 periodId（HEAD 的 Forecast.vue 已在
#              传第 4 个实参，是那批在途的一半，别当成本轮）
#     307/309、331/343、345/375 在途：productsApi.bulkUpsert 与 importApi.template
#              的搬家两半（§11 记载）
SPEC_FE_V180 = ("fe", [
    {"file": "hergent-cn-v2/src/pages/Forecast.vue",
     "exclude_hunks": [101, 2422, 2424, 2435, 2437, 7148, 7163, 7500],
     "gone": []},
    {"file": "hergent-cn-v2/src/pages/ForecastHistory.vue", "keep_all": True, "gone": []},
    {"file": "hergent-cn-v2/src/api/modules.js", "markers": ["updatePeriod"], "gone": []},
    {"file": ".workbuddy/tools/v180-period-guide-verify.js", "new_file": True, "gone": []},
])

# ── v180：期次可改名（PATCH /periods/{pid}）+ 导入登记归属双口径对齐（后端）────
# 基线 HEAD = e4dcd13（分支 upgrade/v84-international）。逐 hunk 打印首行核对：
#   erp_db.py：9 个 hunk → 本轮 4 / 在途 5
#     14857      本轮：period_validate（唯一硬校验实现）+ forecast_period_update
#     14861      本轮：forecast_period_create 接入 period_validate
#     16201/16208 本轮：forecast_submission_summary 的 imported_products 改**双口径**
#                （原单口径 r.period_id=? ⇒ 与 rows 的 date_cond 不同源，行底丢全部导入登记）
#     1400        在途：products DDL 里 extra_json 归位
#     10933/10948 在途：_safe_migrate("v110_products_dist_price") 搬家两半
#     11365/11368 在途：login_is_locked 双维度 IP 锁定
#   forecast.py：3 个 hunk → 本轮 2 / 在途 1
#     117/119     本轮：create_period 接 ValueError→400 + 新增 PATCH /periods/{pid}
#     473         在途：付款通知 sender 展示名「运营主管」→「经营副驾」
SPEC_BE_V180 = ("be", [
    {"file": "server/erp_db.py",
     "exclude_hunks": [1400, 10933, 10948, 11365, 11368],
     "gone": []},
    {"file": "server/routers/forecast.py",
     "exclude_hunks": [473],
     "gone": []},
])

# ── v181：返利冲刺看板 · 进度条「与时间进度对比」文案（前端）─────────────────
# 基线 HEAD = e83411b（分支 main）。逐 hunk 打印首行核对归属（共 20 个 hunk）：
#   本轮 12 个：
#     371 / 385    页头与决策横幅「本月时间进度」由整数 pct 改 1 位小数 pct1
#     412          进度单元格 .sp-bar 挂 :title=paceHint(s)（仅放不下时才提示）
#     415          进度单元格新增 .sp-pace 文案行
#     6254         paceNum()（1 位小数、整数不带 .0；百分比与百分点共用同一格式化）
#     6259         sprintTimeProgress 空值分支补 pct1
#     6267         return 里补 pct1（与差值同精度，页头可与文案对账）
#     6269         sprintPaceOf()（三态判定的**唯一**实现）+ PACE_EPS
#     6272         注释：sprintBarClass 改为复用 sprintPaceOf
#     6274         sprintBarClass 改为复用（消灭「文案写落后、进度条却判绿」的分叉）
#     6279         sprintPaceMap / paceFits / measureSprintPace / paceHint
#                   + onMounted / window.resize / watch 重测
#     7471         .sp-pace 五条 CSS（三态色 + .is-hidden 保留占位）
#   在途 8 个（均为 2026-09-13 起那批未提交改动，与本轮无关）：
#     101          纯空行 hunk（无归属价值，排除零风险）
#     2500 / 2502  loadEditGrid 里「sources 合并而非覆盖」
#     2513 / 2515  loadEditGrid 里 extraByPid 累加（行级加单）
#     7358 / 7373  `.imp-errs` 规则的**搬家两半**（技能 §5.8 / §5.14：
#                  两半必须一起排除；只排一半会让暂存版里 .imp-errs 出现两次或零次）
#     7722         纯空行 hunk
SPEC_FE_V181 = ("fe", [
    {"file": "hergent-cn-v2/src/pages/Forecast.vue",
     "exclude_hunks": [101, 2500, 2502, 2513, 2515, 7358, 7373, 7722],
     "gone": []},
])

# v181 第二笔（工具/文档/截图）：这两个既有探针的 hunk **全部**是本轮为让回归不再
#   「假红」而做的适配（2026-09-17 补 ensurePeriod / 虚拟滚动样本行 / 占比判据），
#   无在途改动 → keep_all（拿到「暂存版 == 工作区」自证）。
#   ⚠️ 新探针与说明文档走 `new_file`，PNG 是二进制 → 不能过本脚本（会按 utf-8 读坏），
#      故这笔实际用 `git add` 落地，本 spec 仅用于**干跑自证**。
SPEC_FE_V181B = ("fe", [
    {"file": ".workbuddy/tools/forecast-brand-dup-verify.js", "keep_all": True, "gone": []},
    {"file": ".workbuddy/tools/forecast-errlist-verify.js", "keep_all": True, "gone": []},
])

# v182（文案单位「个百分点」→「%」）：Forecast.vue 共 12 个 hunk ——
#   **本轮 4 个**（6276 / 6280 / 6283 / 6295，全部是 sprintPaceOf 的注释与 head 字符串），
#   **在途 8 个**（09-13 那批仍未提交，按内容判定、不按行号猜）：
#     101          纯空行 hunk
#     2502 / 2504  loadEditGrid 里「sources 合并而非覆盖」
#     2515 / 2517  loadEditGrid 里 extraByPid 累加（行级加单）
#     7419 / 7434  `.imp-errs` 规则的**搬家两半**（必须一起排，只排一半会让暂存版里出现两次或零次）
#     7794         纯空行 hunk
SPEC_FE_V182 = ("fe", [
    {"file": "hergent-cn-v2/src/pages/Forecast.vue",
     "exclude_hunks": [101, 2502, 2504, 2515, 2517, 7419, 7434, 7794],
     "gone": []},
])

# ── v183（2026-09-17）：冲刺看板「进度」列文案 → 只留「达成率 X%」（三态判语删除）──
# ✅ **已提交（2026-09-17）**：代码 `0c542db`（13 hunk +40/−32）。本 spec 记的是**提交前**的行号快照，
#    故现在复跑会命中「黑名单里有不存在的 hunk（基线漂移？）」并中止 —— 那是**守卫按预期生效**：
#    v183 进 HEAD 后就地删/改了那 13 处，其后 16 个在途 hunk 的 old_start 整体位移，名单自然全失效。
#    ⚠️ 本 spec 已是**一次性归属记录**：那 16 个在途 hunk 从未提交，故 worktree 也复现不出当时的行号
#       ⇒ 它的价值转为**审计留档**（「当时这 13 个 hunk 为什么归我」），不再用于复跑。
# 我的 hunk（13 个，按内容判定）：412 / 417 / 6257 / 6280 / 6291 / 6293 / 6298 /
#   6311 / 6314 / 6319 / 6331 / 6334 / 7536
# ⚠️ 6280 与 6334（paceHint 体）不靠关键词也能看出是「v183 解耦」这一件事的两半：
#   6280 把 text/hover 从 sprintPaceOf 拆掉，6334 把 hover 改成回吐同一句文案，必须一起进/一起排。
# 排除的在途（16 个，全部**非**本轮）：
#   · 并发会话 v184「复制期次 / 0 行保留表头」：560·642·1779(@copy=openPeriodCopy)·1850·5265·6715·6795·7481
#   · 2026-09-13 那批（v182 时即在途、且已在线上）：2502·2504·2515·2517
#   · 既有 CSS 搬家两半（必须一起排）：7422+7437(.imp-errs) ；纯空行：101·7797
SPEC_FE_V183 = ("fe", [
    {"file": "hergent-cn-v2/src/pages/Forecast.vue",
     "exclude_hunks": [101, 560, 642, 1779, 1850, 2502, 2504, 2515, 2517,
                       5265, 6715, 6795, 7422, 7437, 7481, 7797],
     "gone": []},
])

# ── v184（2026-09-17）：期次复制 + 空表列展示（后端）────────────────────
# 基线 HEAD = 401bfcf。hunk 归属**逐块打印首行核对过**（不按行号猜）：
#   server/erp_db.py（11 hunk = 本轮 6 + 在途 5）
#     本轮 6：1831（v184 origin 列迁移）·14972（_period_copy_products + copy/seed + 清单条数）
#             ·15016（order_board 清单条数 GROUP BY）·15040 ·15064（真实行/合成行填 imported_count）
#             ·15999（_ensure_forecast_tables 惰性补列）
#     在途 5：1400            products DDL 里 `extra_json` 从括号外**归位**到括号内（1→1 替换，
#                             M/P 两侧都是同一行长 SQL，肉眼几乎无法区分 —— 已打印全行确认：
#                             唯一差异是 `)),extra_json TEXT DEFAULT '');` → `),extra_json …');`）
#             10933 + 10948  `_safe_migrate("v110_products_dist_price")` 的**搬家两半**
#                            （§5.8/§5.14：必须一起排，只排一半会让该迁移出现两次或零次）
#             11365 + 11368  `login_is_locked` 改双维度阈值（v125 注释 + LOGIN_LOCK_USER_MAX）
#   server/routers/forecast.py（2 hunk = 本轮 1 + 在途 1）
#     本轮 1：173  `POST /periods/{pid}/copy` + `/seed`（+79 行纯插入）
#     在途 1：527  payments_confirm 里消息 sender `"运营主管"` → `"经营副驾"`（1→1，与本轮无关）
#   server/routers/import_router.py（3 hunk，**全本轮**）→ keep_all（拿「暂存版 == 工作区」自证）
#     746 / 749 / 753：INSERT 列清单加 `origin` + 显式 `origin='import'` 的 UPDATE + 注释
SPEC_BE_V184 = ("be", [
    {"file": "server/erp_db.py",
     "exclude_hunks": [1400, 10933, 10948, 11365, 11368],
     "gone": []},
    {"file": "server/routers/forecast.py",
     "exclude_hunks": [527],
     "gone": []},
    {"file": "server/routers/import_router.py", "keep_all": True, "gone": []},
])

# ── v184（2026-09-17）：期次复制 + 空表列展示（前端）────────────────────
# 基线 HEAD = ea15ed0。逐块打印首行核对：
#   Forecast.vue（16 hunk = 本轮 8 + 在途 8）
#     本轮 8：561（删「只读态 0 行 ⇒ 整块空态」分支）·643（表体内引导行 3 个动作）
#             ·1780（`@copy="openPeriodCopy"` 接驳）·1851（复制期次弹窗 +47）
#             ·5266（AUDIT_ACTION_LABEL 加 period_copy/period_seed）
#             ·6722（createPeriod 补 onPeriodChange 重载表格）
#             ·6802（复制期次逻辑 + seedFromPrev 守视图，+141）
#             ·7488（.pc-shift / .empty-row 样式 +8）
#     在途 8：101        纯空行（无归属价值，排除零风险）
#             2503·2505  loadEditGrid 里「sources 合并而非覆盖」（09-13 起未提交）
#             2516·2518  loadEditGrid 里 extraByPid 累加（行级加单，同上）
#             7429+7444  `.imp-errs` 规则的**搬家两半**（必须一起排；HEAD 里该串 2 处、
#                        工作区亦 2 处，排完留在原位恰好一份）
#             7805        纯空行
#   ForecastHistory.vue（2 hunk，**全本轮**）→ keep_all：35（「复制」按钮 + 注释）、55（emit 加 'copy'）
#   src/api/modules.js（9 hunk = 本轮 1 + 在途 8）
#     本轮 1：26  `copyPeriod` / `seedPeriod` 两个方法（+6）
#     在途 8：293+297 forecastApproveApi.summary 加 periodId 参数与 query
#             305+308 · 331+342 · 343+374 —— **三对搬家两半**（bulkUpsert / Excel 导入注释 /
#                         importApi.template 各被搬到新位置）；每对必须一起排
SPEC_FE_V184 = ("fe", [
    {"file": "hergent-cn-v2/src/pages/Forecast.vue",
     "exclude_hunks": [101, 2503, 2505, 2516, 2518, 7429, 7444, 7805],
     "gone": []},
    {"file": "hergent-cn-v2/src/pages/ForecastHistory.vue", "keep_all": True, "gone": []},
    {"file": "hergent-cn-v2/src/api/modules.js",
     "exclude_hunks": [293, 297, 305, 308, 331, 342, 343, 374],
     "gone": []},
    # 本轮真机验证脚本（HEAD 无此文件）+ 本工具自身的配套改动（新增上面两个 spec）
    {"file": ".workbuddy/tools/v184-period-copy-verify.js", "new_file": True, "gone": []},
    {"file": ".workbuddy/tools/scoped_stage_by_marker.py", "keep_all": True, "gone": []},
])

SPECS = {"v171": SPEC_V171, "be-v163": SPEC_BE_V163, "fe-v163": SPEC_FE_V163,
         "fe-v173": SPEC_V173_FE, "be-v173": SPEC_V173_BE, "fe-v176": SPEC_FE_V176,
         "fe-v177": SPEC_FE_V177, "fe-v178": SPEC_FE_V178, "fe-v178b": SPEC_FE_V178B,
         "fe-v178c": SPEC_FE_V178C, "be-v178c": SPEC_BE_V178C,
         "fe-v179": SPEC_FE_V179, "be-v179": SPEC_BE_V179,
         "fe-v180": SPEC_FE_V180, "be-v180": SPEC_BE_V180,
         "fe-v181": SPEC_FE_V181, "fe-v181b": SPEC_FE_V181B,
         "fe-v182": SPEC_FE_V182, "fe-v183": SPEC_FE_V183,
         "be-v184": SPEC_BE_V184, "fe-v184": SPEC_FE_V184}

def git(*a, **kw):
    return subprocess.run(["git", "-C", REPO] + list(a), capture_output=True,
                          text=True, check=True, **kw).stdout


def parse_hunks(path):
    diff = git("diff", "-U0", "--", path)
    hunks, cur = [], None
    for ln in diff.splitlines(keepends=True):
        if ln.startswith("@@"):
            m = re.match(r"@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@", ln)
            cur = {"os": int(m.group(1)), "oc": int(m.group(2) or 1),
                   "minus": [], "plus": [], "hdr": ln.strip()}
            hunks.append(cur)
        elif cur is not None:
            if ln.startswith("+"):
                cur["plus"].append(ln[1:])
            elif ln.startswith("-"):
                cur["minus"].append(ln[1:])
    return hunks


def pick_inflight_sample(hunks, mine_oses):
    """自动抽「在途 hunk」的特征行（每 hunk 取最长的一行，最多 3 条），用于零夹带断言。"""
    out = []
    for h in hunks:
        if h["os"] in mine_oses:
            continue
        cands = [l.strip() for l in (h["plus"] + h["minus"]) if len(l.strip()) >= 20]
        if cands:
            out.append(max(cands, key=len)[:60])
    return out[:3]


def resolve_ownership(spec, hunks):
    """返回 (mine: sorted list, deferred: sorted list)，并做并集覆盖断言。"""
    got = sorted(h["os"] for h in hunks)
    if spec.get("keep_all"):
        mine, deferred = got, []
    elif "exclude_hunks" in spec:
        deferred = sorted(set(spec["exclude_hunks"]))
        missing = [d for d in deferred if d not in got]
        assert not missing, (
            "%s：黑名单里有不存在的 hunk %s（基线漂移？）\n"
            "  ⚠️ 先确认本 spec 是否**已提交**：那批 hunk 一旦进 HEAD，其后所有在途 hunk 的\n"
            "     old_start 会整体位移、名单必然全失效、必然走到这里 —— 那是守卫**按预期生效**，\n"
            "     不是回归，也不要据此改名单（改了只会错得更隐蔽）。"
            % (spec["file"], missing))
        mine = [g for g in got if g not in set(deferred)]
    else:
        mine_oses = []
        for mk in spec["markers"]:
            hit = [h["os"] for h in hunks if any(mk in l for l in h["minus"] + h["plus"])]
            assert len(hit) == 1, \
                "标记 %r 命中 %d 个 hunk（要求恰好 1 个）：%s" % (mk, len(hit), hit)
            mine_oses.append(hit[0])
        assert len(set(mine_oses)) == len(spec["markers"]), "两个标记指向同一个 hunk，名单有误"
        mine = sorted(set(mine_oses))
        deferred = [g for g in got if g not in set(mine)]
    # 🔴 并集覆盖断言：同时证明「名单没写错」与「不存在两侧都没认领的 hunk」
    assert got == sorted(set(mine) | set(deferred)), \
        ("有未登记的 hunk，先读懂它是谁的：%s" % (set(got) ^ (set(mine) | set(deferred))))
    assert not (set(mine) & set(deferred)), "同一 hunk 同时被判为本轮与在途"
    return mine, deferred


def main():
    args = sys.argv[1:]
    commit_msg = None
    if "--commit" in args:
        i = args.index("--commit")
        commit_msg = args[i + 1]
        args = args[:i] + args[i + 2:]
    assert len(args) == 1, "用法：scoped_stage_by_marker.py <spec名> [--commit <msg文件>]"
    spec_name = args[0]
    assert spec_name in SPECS, "未知 spec：%s（可选 %s）" % (spec_name, list(SPECS))

    global REPO
    repo_key, file_specs = SPECS[spec_name]
    REPO = REPOS[repo_key]
    print("仓库 = %s" % REPO)
    print("基线 HEAD = %s" % git("rev-parse", "--short", "HEAD").strip())
    print("spec = %s（%d 个文件）" % (spec_name, len(file_specs)))

    staged_blobs, bad = {}, 0

    for spec in file_specs:
        path = spec["file"]
        wt = open(os.path.join(REPO, path), encoding="utf-8").read()

        if spec.get("new_file"):
            # 新文件：HEAD 里不存在 → 无 hunk 可解析，内容直接取工作区（自证 == 工作区）
            has = subprocess.run(["git", "-C", REPO, "cat-file", "-e", "HEAD:" + path],
                                 capture_output=True).returncode == 0
            assert not has, "%s：标了 new_file，但 HEAD 里已存在同名文件" % path
            head, hunks, mine, deferred, out = "", [], [], [], wt
        else:
            hunks = parse_hunks(path)
            head = git("show", "HEAD:" + path)
            mine, deferred = resolve_ownership(spec, hunks)
            minus_only = set(spec.get("split_minus_only", []))
            assert minus_only <= set(mine), \
                "split_minus_only 必须落在本轮 hunk 里：%s" % sorted(minus_only - set(mine))
            # trim_plus：只落 `+` 侧的**前 (len-n) 行**，丢掉尾部 n 行。
            #   场景（v179 实测）：我的 3 行 CSS 后面**粘着在途搬进来的一行**（`-U0` 把相邻插入
            #   合并成一个 hunk）—— 整块保留 = 替在途提交那次搬移；整块排除 = 把我的改动一起丢掉。
            #   与 split_minus_only 是**对称的两个半拆法**：一个丢 `+` 侧、一个丢 `+` 侧尾部。
            trim_plus = {int(k): int(v) for k, v in spec.get("trim_plus", {}).items()}
            assert set(trim_plus) <= set(mine), \
                "trim_plus 必须落在本轮 hunk 里：%s" % sorted(set(trim_plus) - set(mine))
            lines = head.splitlines(keepends=True)
            trimmed_lines = []
            for h in sorted([x for x in hunks if x["os"] in mine], key=lambda x: -x["os"]):
                os_, oc = h["os"], h["oc"]
                plus = h["plus"]
                if os_ in trim_plus:
                    n = trim_plus[os_]
                    assert 1 <= n < len(plus), ("trim_plus 越界", os_, n, len(plus))
                    trimmed_lines += plus[len(plus) - n:]
                    plus = plus[:len(plus) - n]
                if oc == 0:
                    assert h["minus"] == [], "纯插入 hunk 不该有 - 行"
                    assert 1 <= os_ <= len(lines), ("插入点越界", os_)
                    lines[os_:os_] = plus               # 🔴 纯插入一律 lines[a:a]，不是 a-1
                else:
                    seg = lines[os_ - 1: os_ - 1 + oc]
                    assert seg == h["minus"], \
                        ("old_start=%d 旧侧不匹配\n HEAD=%r\n diff=%r" % (os_, seg, h["minus"]))
                    # 🔴 混合 hunk 只落 `-` 侧：diff 把「我删掉的一行」与「在途搬进来的一行」
                    #    配成 1→1 修改时，落 `+` 侧 = 替在途提交了那次搬移（技能 §5.8）。
                    lines[os_ - 1: os_ - 1 + oc] = [] if os_ in minus_only else plus
            out = "".join(lines)
            # 🔴 被 trim 掉的每一行，在暂存版里必须与 HEAD **计数相等**（不许多、不许少）：
            #   多 = 重复（原处没删干净，还多插了一份）；少 = 把 HEAD 原位那份也误删了。
            for l in trimmed_lines:
                assert out.count(l) == head.count(l), \
                    "trim_plus 截掉的行计数漂移（HEAD=%d 暂存=%d）：%r" \
                    % (head.count(l), out.count(l), l[:60])

        inflight_sample = pick_inflight_sample(hunks, set(mine))

        outp = "/tmp/staged_" + os.path.basename(path)
        open(outp, "w", encoding="utf-8").write(out)
        staged_blobs[path] = out

        # 混合 hunk 只落一半时，被丢弃的 `+` 侧（split_minus_only 整侧 / trim_plus 尾部）
        # 会在残留里**单独成一块** → 每处期望值 +1
        n_def = (len(deferred) + len(spec.get("split_minus_only", []))
                 + len(spec.get("trim_plus", {})))
        resid = subprocess.run(["git", "-C", REPO, "diff", "-U0", "--no-index",
                                "--", outp, os.path.join(REPO, path)],
                               capture_output=True, text=True).stdout
        n_resid = len(re.findall(r"(?m)^@@", resid))

        print("=" * 74)
        print("%s" % path)
        print("  hunk 总 %d | 本轮 %d %s | 在途 %d %s" % (len(hunks), len(mine), mine, n_def, deferred))
        print("  行数 HEAD %d -> 暂存 %d (%+d) | 工作区 %d"
              % (head.count("\n"), out.count("\n"),
                 out.count("\n") - head.count("\n"), wt.count("\n")))
        if spec.get("keep_all"):
            assert out == wt, "%s：keep_all 但构造结果 != 工作区（切片法有误）" % path
            print("  暂存版 == 工作区（该文件无在途改动，keep_all 自证 ✓）")
        assert n_resid == n_def, \
            "残留 hunk %d != 在途 hunk %d，归属有误" % (n_resid, n_def)
        print("  残留 hunk == 在途 hunk == %d ✓" % n_resid)

        for s in inflight_sample:
            a, c = out.count(s), head.count(s)
            ok = a == c
            bad += 0 if ok else 1
            print("  %s 在途特征 %-46s 暂存=%d HEAD=%d" % ("ok " if ok else "BAD", s[:46], a, c))
        if not inflight_sample:
            print("  （无在途 hunk，跳过零夹带抽样）")

        for s in spec["gone"]:
            a, b = out.count(s), wt.count(s)
            ok = a == 0 and b == 0
            bad += 0 if ok else 1
            print("  %s 已删文案 %-24s 暂存=%d 工作区=%d" % ("ok " if ok else "BAD", s, a, b))

    print("=" * 74)
    assert bad == 0, "自证失败 %d 项，先查归属判定" % bad
    print("自证通过 ✓  暂存版：")
    for p in staged_blobs:
        print("   /tmp/staged_" + os.path.basename(p))

    if commit_msg:
        names = []
        for path, out in staged_blobs.items():
            git("reset", "-q", "HEAD", "--", path)
            blob = subprocess.run(["git", "-C", REPO, "hash-object", "-w", "--stdin"],
                                  input=out, text=True, capture_output=True,
                                  check=True).stdout.strip()
            subprocess.run(["git", "-C", REPO, "update-index", "--add", "--cacheinfo",
                            "100644,%s,%s" % (blob, path)], check=True)
            names.append(path)
        staged_now = [n for n in git("-c", "core.quotepath=false", "diff", "--cached",
                                     "--name-only").split("\n") if n.strip()]
        print("\n索引内容 =", staged_now)
        assert set(staged_now) == set(names) and len(staged_now) == len(names), \
            "索引不干净（可能混入并行会话预暂存的文件），放弃提交：%s" % staged_now
        print(git("diff", "--cached", "--stat"))
        print(git("commit", "-F", commit_msg))
        print("提交后：", git("log", "--oneline", "-1"))


main()
