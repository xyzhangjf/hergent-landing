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

# ── v184b（2026-09-17）：「到货周期」固定列 + 导入模版同步新增该列 ──────────
# 基线：be HEAD = ed47d2d。逐块打印首行核对归属（**不按行号猜**，技能 §5.7）。
#   server/erp_db.py（6 hunk = 本轮 1 + 在途 5）
#     本轮 1：16485  forecast_submission_summary 的 imported_products 查询补
#                    `COALESCE(p.arrival_lead_days,0) AS arrival_lead_days`
#                    （off-archive 行不经过 products/grid，不补就恒显示「—」）
#     在途 5：1400   products 建表 SQL：`extra_json` 从括号**外**归位到括号**内**
#                     ⚠️ 该 hunk 1→1 且**首 86 字符完全相同**，差异在 500 字符之后 ——
#                        技能 §5.16 一：截断会骗你，必须打整行才判得出归属
#             10944 + 10959  `_safe_migrate("v110_products_dist_price")` 的搬家两半（一起排）
#             11376 + 11379  `login_is_locked` 改双维度阈值（LOGIN_LOCK_USER_MAX）
#   server/routers/data.py（1 hunk，**全本轮**）→ keep_all（拿「暂存版 == 工作区」自证）
#     396  products_grid 下发 arrival_lead_days
#   server/routers/import_router.py（8 hunk，**全本轮**）→ keep_all
#     138/196/462/1357/1374/1379/1458/1497：关键词表补「到货周期/到货天数」·
#       字段标签改「到货周期」· `_re_rhythm` 正则（+全角加号）· 模版加第 8 列（选填）·
#       示例值「+3天」· 填写说明
SPEC_BE_V184B = ("be", [
    {"file": "server/erp_db.py",
     "exclude_hunks": [1400, 10944, 10959, 11376, 11379],
     "gone": []},
    {"file": "server/routers/data.py", "keep_all": True, "gone": []},
    {"file": "server/routers/import_router.py", "keep_all": True, "gone": []},
])

# ── v184b（2026-09-17，前端）──────────────────────────────────────────
# 基线：fe HEAD = cdca9f4。已提交的 v184（期次复制）那份 spec **已是历史留档**，不要复跑。
#   hergent-cn-v2/src/pages/Forecast.vue（47 hunk = 本轮 39 + 在途 8）
#     本轮 39：全部围绕「到货周期」固定列这一件事 ——
#       301（商品档案弹层改读 arrival_lead_days + 共用 arrivalCycleText）
#       532·538（列设置菜单 c.fixed → isLockedCol）· 633·677·746（查看态表头/格/表尾冻结样式）
#       853·886·912·951（编辑态表头/格/只读渲染分支/表尾）
#       1576（右键菜单固定列提示）· 2008（asProdRow 补字段）
#       2208（colOrderList 透传 fixed）· 2243（COL_DEFAULTS 补宽度）
#       2251（frozenShift → frozenLeftOf/frozenRight）· 2305（isFrozen 认 fixed）
#       2419·2437（arrivalCycleText + MASTER_COL_DEFS 新列）
#       2468（loadCols 新固定列归位）· 2502·2509·2514（visibleCols fixed + 强制归位）
#       2549（isLockedCol）· 2555·2561（toggleCol / quickHide）
#       2695（loadEditGrid 到货周期）· 3680（ctxClear 只读闸门）· 3959（hdrFreezeCol 提示）
#       4227·4230·4233·4238·4240·4290·4294（writeCellVal 只读 + clearRange 实际计数）
#       6731（loadCross 到货周期）· 7414（.frozen.fc-cycle）· 7526（注释订正）· 7664（.cell-ro）
#     在途 8：101        纯空行（无归属价值，排除零风险）
#             2561·2563  loadEditGrid 里「sources 合并而非覆盖」（09-13 起未提交）
#             2574·2576  loadEditGrid 里 extraByPid 累加（行级加单，同上）
#             7636+7651  `.imp-errs` 规则的**搬家两半**（必须一起排；HEAD 里该串 2 处、
#                        工作区亦 2 处，排完留在原位恰好一份）
#             8020        纯空行
#   ⚠️ 上述「在途 hunk 数」是**本刻**快照；跨轮次会变（技能 §5.16 三），复跑前重数。
SPEC_FE_V184B = ("fe", [
    {"file": "hergent-cn-v2/src/pages/Forecast.vue",
     "exclude_hunks": [101, 2561, 2563, 2574, 2576, 7636, 7651, 8020],
     "gone": []},
    # 本轮真机验证工具（HEAD 无这些文件 → new_file，内容直接取工作区）
    {"file": ".workbuddy/tools/v184-arrival-cycle-page.js", "new_file": True, "gone": []},
    {"file": ".workbuddy/tools/v184-arrival-cycle-history.js", "new_file": True, "gone": []},
    {"file": ".workbuddy/tools/v184-arrival-cycle-shot.js", "new_file": True, "gone": []},
    {"file": ".workbuddy/tools/v184-import-step1-preview.py", "new_file": True, "gone": []},
    {"file": ".workbuddy/tools/v184-import-step2-execute.py", "new_file": True, "gone": []},
    {"file": ".workbuddy/tools/forecast-arrival-rhythm-check.py", "new_file": True, "gone": []},
    # 本工具自身（新增上面两个 spec）
    {"file": ".workbuddy/tools/scoped_stage_by_marker.py", "keep_all": True, "gone": []},
])

# ── v184b2（2026-09-17）：把「到货周期」做成**商品档案页可编辑字段**（方案 A）─────
# 基线：be HEAD = 3a60c4d（上一轮的「注释订正」已落，故本轮 data.py 只剩 4 hunk，不再是 1 个）。
#   server/db/queries/products.py（5 hunk，**全本轮**）→ keep_all（拿「暂存版 == 工作区」自证）
#     6  文件头新增归一化的**唯一实现** `normalize_arrival_days` + `_ATD_MAX`（+37）
#     16·23  product_create：白名单加 `arrival_lead_days` + 归一化（认不出→不写）
#     45·53  product_update：白名单加 `arrival_lead_days` + 归一化
#            ⚠️ **本轮最关键的改动**：`allowed` 不在那里放行 = 前端改完 **HTTP 200 静默回旧值**
#   server/routers/data.py（4 hunk，**全本轮**）→ keep_all
#     267  update_product 加**显式校验**（非整数/带小数/越界 → 400 并说清范围；避免「改了没反应也没提示」）
#     287  bulk_upsert_products docstring 补「显式提供才写」守卫说明
#     353  bulk_upsert_products 加守卫（`is not None` 判据 —— **0 是合法值**，真值判断会吞掉「显式取消」）
#     398  products_grid 注释订正：「全仓唯一写入口」→「两个写入口」
#   server/erp_db.py（6 hunk = 本轮 1 + 在途 5）→ exclude_hunks
#     本轮 1：38  门面补导出 `normalize_arrival_days`（让三条写路径共享同一份规则）
#     在途 5：1400    products 建表 SQL：`extra_json` 从括号**外**归位到括号**内**
#             10944 + 10959  `_safe_migrate("v110_products_dist_price")` 的搬家两半（一起排）
#             11376 + 11379  `login_is_locked` 改双维度阈值（LOGIN_LOCK_USER_MAX / IP 维度）
SPEC_BE_V184B2 = ("be", [
    {"file": "server/db/queries/products.py", "keep_all": True, "gone": []},
    {"file": "server/routers/data.py", "keep_all": True, "gone": []},
    {"file": "server/erp_db.py",
     "exclude_hunks": [1400, 10944, 10959, 11376, 11379],
     "gone": []},
])

# ── v184b2（2026-09-17，前端）─────────────────────────────────────────
# 基线：fe HEAD = d7f977f。
#   hergent-cn-v2/src/pages/Forecast.vue（14 hunk = 本轮 6 + 在途 8）→ **markers**
#     本轮 6（全部围绕「到货周期文案的**唯一实现**移到 utils/arrival.js」+ 提示语订正）：
#       1941  import { arrivalCycleText } from '../utils/arrival.js'
#       2423  注释：写入口从「一个」改成「两个」
#       2426  注释：「不做继承品牌默认」的理由（同屏口径同源）
#       2429  删掉本地 `arrivalCycleText` 定义（只留一行指向 utils/arrival.js 的注释）
#       3671  ctxClear 注释：提示语必须指向**真实存在**的改法
#       3673  ctxClear 提示语正文：指向「商品档案」页
#     在途 8：101        纯空行（无归属价值，排除零风险）
#             2646·2648  loadEditGrid 里「sources 合并而非覆盖」（09-13 起未提交）
#             2659·2661  loadEditGrid 里 extraByPid 累加（行级加单，同上）
#             7768+7783  `.imp-errs` 规则的**搬家两半**（必须一起排；HEAD 里该串 2 处、
#                        工作区亦 2 处，排完留在原位恰好一份）
#             8152        纯空行
#   ⚠️ 「4 个 2646/2659 段 + 2 个 CSS 搬移 + 2 个空行」是本刻快照；跨轮次会变，复跑前重数。
#   hergent-cn-v2/src/pages/ProductArchive.vue（14 hunk，**全本轮**）→ keep_all
#     本轮 14：6（页头副标题提「点到货周期格」）·43（表头新列 + 位置理由）
#       51（单元格**三态**渲染 + 两个「留空」语义相反的说明）
#       112（详情弹层字段）·142（新增表单字段 + 留空=不改动）·300（import 共享实现）
#       350（state：editingCycleId / editCycle）·357（addForm 加字段）
#       484（startEditCycle / saveCycle，+29）·599·606·622（saveAdd 校验 + 条件展开守卫）
#       699（导出加该列）·741（.pa-cyc-* 样式 +12）
#   ⚠️ 该文件 hunk 多且密，但**逐块打印确认全为本轮**（无并行会话在途改动）⇒ keep_all 自证成立。
SPEC_FE_V184B2 = ("fe", [
    {"file": "hergent-cn-v2/src/pages/Forecast.vue",
     "markers": [
         "import { arrivalCycleText } from '../utils/arrival.js'",
         "写入口有**两个**（结果落同一列，展示走同一个 `arrivalCycleText`）",
         "与「同屏数字口径必须同源」冲突；要默认值就在导入时填、或在商品档案里设。",
         "/* v184b：文案函数已移到 `utils/arrival.js`（本文件顶部 import）——",
         "🔴 v184b：提示语必须指向**真实存在**的改法",
         "」在网格里只读；要改请到「商品档案」页点该商品的到货周期格（或走预报导入）",
     ],
     "gone": []},
    {"file": "hergent-cn-v2/src/pages/ProductArchive.vue", "keep_all": True, "gone": []},
    # 🆕 共享实现（HEAD 无此文件）
    {"file": "hergent-cn-v2/src/utils/arrival.js", "new_file": True, "gone": []},
    # 上一轮探针的修正（2 处：提示语改成「匹配意图」/ 过期 fixture 由 FAIL 降级 info）——全本轮
    {"file": ".workbuddy/tools/v184-arrival-cycle-page.js", "keep_all": True, "gone": []},
    # 上一轮探针重写为「自播种子」（原版断言「往期不是全「—」」是 fixture 依赖）——全本轮
    {"file": ".workbuddy/tools/v184-arrival-cycle-history.js", "keep_all": True, "gone": []},
    # 本轮真机验证工具（HEAD 无这些文件 → new_file，内容直接取工作区）
    {"file": ".workbuddy/tools/v184b-archive-arrival-cycle.js", "new_file": True, "gone": []},
    {"file": ".workbuddy/tools/v184b-offarchive-forecast.js", "new_file": True, "gone": []},
    {"file": ".workbuddy/tools/v184b-archive-arrival-shot.js", "new_file": True, "gone": []},
    {"file": ".workbuddy/tools/v184b-input-visibility.js", "new_file": True, "gone": []},
    # 本轮交付（真机截图 4 张 + 交付说明）—— outputs/ 已被跟踪，但本目录是新增。
    #   ⚠️ PNG 必须标 `binary: True`：本工具默认按 utf-8 读新文件，截图会在
    #      `invalid start byte` 上炸掉整个 spec（2026-09-17 实测，已修）。
    {"file": "outputs/到货周期可编辑-2026-09-17/交付说明.md", "new_file": True, "gone": []},
    {"file": "outputs/到货周期可编辑-2026-09-17/01-档案页到货周期列.png", "new_file": True, "binary": True, "gone": []},
    {"file": "outputs/到货周期可编辑-2026-09-17/02-到货周期列特写.png", "new_file": True, "binary": True, "gone": []},
    {"file": "outputs/到货周期可编辑-2026-09-17/03-行内编辑态.png", "new_file": True, "binary": True, "gone": []},
    {"file": "outputs/到货周期可编辑-2026-09-17/04-编辑输入框特写.png", "new_file": True, "binary": True, "gone": []},
    # 本工具自身（新增上面两个 spec）
    {"file": ".workbuddy/tools/scoped_stage_by_marker.py", "keep_all": True, "gone": []},
])

# ── loss：货损核算（月度 · 期间流水口径）—— 新页面 + 新后端模块 + 导入扩展位 ──────
# 归属依据（逐 hunk 打印首行核对，不按行号猜）：
#   本轮 = 1 个新页面 + 1 个新后端模块 + 2 个契约测试 + 2 张截图；3 个混合文件里本轮
#   **全是纯插入**（无替换、无搬家），与在途改动不重叠。
#   部署前已把工作区与生产做过两次独立比对，确认「工作区 == 生产 + 本轮改动」：
#     ① 后端 10 个在途文件里 9 个与 /opt/hergent-erp 逐字节一致；第 10 个 server.py 的
#        差异**纯是本轮**（生产上 grep loss_accounting 为空）。
#     ② 前端 hash 归一化产物比对（tools/dist_normalized_diffcheck.py 复核过）：
#        47 个 chunk 里 44 个与生产逐字节相同，仅 index/Shell/modules 三个 chunk 有真实
#        差异 —— 正是本轮改的 3 个文件所在 chunk；新增/删除文件恰好是 LossAccounting 两个。
#     ③ 中文串差集：6 个差异文件的「生产独有中文」全为 0 ⇒ 零夹带、零缺失。
#   在途名单（均为 09-11~09-17 那批未提交改动，**已全部在产**，留在工作区由各自的作者提交）：
SPEC_BE_LOSS = ("be", [
    {"file": "server/routers/loss_accounting.py", "new_file": True, "gone": []},
    # 该文件本轮 4 行（2 行注释 + import + include_router）全属本轮 → keep_all 拿「== 工作区」自证
    {"file": "server/server.py", "keep_all": True, "gone": []},
])

SPEC_FE_LOSS = ("fe", [
    {"file": "hergent-cn-v2/src/pages/LossAccounting.vue", "new_file": True, "gone": []},
    {"file": "hergent-cn-v2/tests/sfc-symbols.contract.mjs", "new_file": True, "gone": []},
    {"file": "hergent-cn-v2/tests/loss-accounting-money.contract.mjs", "new_file": True, "gone": []},
    {"file": "outputs/loss-accounting-2026-09-17-view.png", "new_file": True, "binary": True, "gone": []},
    {"file": "outputs/loss-accounting-2026-09-17-edit.png", "new_file": True, "binary": True, "gone": []},
    # 本轮 1 个 hunk（+217,41 = lossAccountingApi 整块）。在途 9 个：
    #   299/303  forecastApproveApi.summary 加 periodId 形参 + q.push('period_id=')
    #   311/314  bulkUpsert 行**搬家两半**（技能 §5.8：搬移必须两半一起排除）
    #   322      v184c 商品「修改记录」接口
    #   337/348  Excel 导入注释搬家两半
    #   349/380  importApi.template 搬家两半
    {"file": "hergent-cn-v2/src/api/modules.js",
     "exclude_hunks": [299, 303, 311, 314, 322, 337, 348, 349, 380], "gone": []},
    # 本轮 2 个 hunk（+18 加 LossAccounting import；+49,3 加「货损核算」路由项）。在途 2 个：
    #   21 加 ArchiveShell import；49 archive 路由改造（父子路由 + 4 个子路由）
    {"file": "hergent-cn-v2/src/router/index.js",
     "exclude_hunks": [21, 49], "gone": []},
    # 本轮 2 个 hunk（+46 桌面侧栏入口 / +95 移动侧栏入口，各 1 行纯插入）。在途 10 个：
    #   17 删 ⌘K 徽标；109 加 IdleTimeout 注释块；141/146 import 改造（+IdleTimeout/+clearChatCache）
    #   187/188/193 logout 改 async + 清会话缓存 + 空闲超时；327/330/399 .tb-copilot/.tb-cp-k CSS
    {"file": "hergent-cn-v2/src/components/Shell.vue",
     "exclude_hunks": [17, 109, 141, 146, 187, 188, 193, 327, 330, 399], "gone": []},
    # 本工具自身（新增上面两个 spec）
    {"file": ".workbuddy/tools/scoped_stage_by_marker.py", "keep_all": True, "gone": []},
])

# ── v184c：商品档案「编辑」按钮（方案 A：只读详情弹窗 → 可编辑表单）──────────
# 归属依据（逐 hunk 打印首行核对，不按行号猜；两个仓库各自的自证见下）：
#
# 前端（fe HEAD = b926c97）：
#   hergent-cn-v2/src/pages/ProductArchive.vue（**11 hunk，全本轮**）→ keep_all
#     11 个 hunk 的 old_start = 6 / 96 / 116 / 118 / 120 / 123 / 145 / 326 / 394 / 664 / 870，
#     逐块打印确认全部是本轮 v184c 的改动（无并行会话在途尾巴）：
#       6    页头副标题改写（原写「售价/进价/安全库存只读」已不成立，文案不能与事实不符）
#       96   行尾按钮文案「详情」→「编辑」（**入口不变，不新增按钮** —— 方案 A 的定义）
#       116  在只读弹窗原位插入大段设计约束注释（三条：diff 提交 / 条码只读 / 留空=清空）
#       118  遮罩点击 → tryCloseEdit()（有未保存改动时提示一次，不静默丢弃）
#       120  弹窗根节点加 .pa-edit 类 + 标题改「编辑商品」
#       123  🔴 主体：.pa-detail-grid 只读栅格整块换成可编辑表单（7 个分组 + 修改记录区）
#       145  底部按钮：「知道了」→ 「N 个字段已改」提示 + 取消 + 保存（无改动则置灰）
#       326  import 加 nextTick（修改记录展开后滚进视野要用）
#       394  🔴 state + 常量：editForm / editBaseline / EDIT_FIELDS 白名单 / _norm / dirtyCount
#       664  🔴 函数：openDetail 重写 + tryCloseEdit + saveEdit（diff 提交）+ applyActive
#            + toggleChanges + loadChanges
#       870  删 4 行死 CSS（.pa-detail-*）换成 .pa-edit / .pa-sec / .pa-log 等
#     ⚠️ keep_all 自证 = 「构造结果 == 工作区」，成立即证明该文件无在途改动。
#   hergent-cn-v2/src/api/modules.js（9 hunk = 本轮 1 + 在途 8）→ **markers**
#     本轮 1：old_start=363（+5 行注释 + changes 方法，productsApi.changes）
#     在途 8（均为前几轮未提交、且**已全部在产**的改动，留在工作区由各自作者提交）：
#       340/345  forecastApproveApi.summary 加 periodId 形参 + q.push('period_id=')
#       354/356  bulkUpsert 行**搬家两半**（技能 §5.8：搬移必须两半一起排除）
#       384/396  Excel 导入注释搬家两半
#       398/428  importApi.template 搬家两半
#     ⚠️ 两个候选标记串**都恰好命中 old_start=363 这一个 hunk**（已实测）：
#        "changes: (pid) => api('/api/products/' + pid + '/changes'),"  → ['@@ -363,0 +365,6 @@']
#        "v184c 商品「修改记录」"                                          → ['@@ -363,0 +365,6 @@']
#        取功能行那个（更能抵抗注释改写）。
#   ⚠️ 「9 hunk」是本刻快照；跨轮次会变，复跑前重数（本工具会自己断言，不会静默放过）。
SPEC_FE_V184C = ("fe", [
    {"file": "hergent-cn-v2/src/pages/ProductArchive.vue",
     "keep_all": True,
     # 本轮**删掉**的东西必须在暂存版与工作区同时为 0：证明整块替换没留下半截。
     "gone": ["pa-detail-grid", "pa-detail-item", "只读详情弹窗", "openDetail(p)\">详情"]},
    {"file": "hergent-cn-v2/src/api/modules.js",
     "markers": ["changes: (pid) => api('/api/products/' + pid + '/changes'),"],
     "gone": []},
    # 本轮真机验证工具（HEAD 无这些文件 → new_file，内容直接取工作区）
    {"file": ".workbuddy/tools/v184c-archive-edit.js", "new_file": True, "gone": []},
    {"file": ".workbuddy/tools/v184c-api-guard.js", "new_file": True, "gone": []},
    {"file": ".workbuddy/tools/v184c-archive-edit-shot.js", "new_file": True, "gone": []},
    # 本轮交付（6 张真机截图 + 交付说明）。outputs/ 已被跟踪，但本目录是新增。
    #   ⚠️ PNG 必须标 `binary: True`（本工具默认按 utf-8 读新文件，截图会在
    #      `invalid start byte` 上炸掉整个 spec；2026-09-17 实测过一次，已修）。
    {"file": "outputs/商品编辑-2026-09-17/交付说明.md", "new_file": True, "gone": []},
    {"file": "outputs/商品编辑-2026-09-17/01-档案页-每行编辑入口.png", "new_file": True, "binary": True, "gone": []},
    {"file": "outputs/商品编辑-2026-09-17/02-编辑弹窗-上半（身份·品牌·价格）.png", "new_file": True, "binary": True, "gone": []},
    {"file": "outputs/商品编辑-2026-09-17/03-编辑弹窗-下半（描述·状态·修改记录）.png", "new_file": True, "binary": True, "gone": []},
    {"file": "outputs/商品编辑-2026-09-17/04-未保存改动提示（只提交改过的字段）.png", "new_file": True, "binary": True, "gone": []},
    {"file": "outputs/商品编辑-2026-09-17/05-修改记录（谁·何时·哪个字段·改前改后）.png", "new_file": True, "binary": True, "gone": []},
    {"file": "outputs/商品编辑-2026-09-17/06-停用二次确认（有业务后果的动作）.png", "new_file": True, "binary": True, "gone": []},
    # 本工具自身（新增上面这个 spec）—— ⚠️ 它只属于**前端** spec（后端 spec 的 REPO 是另一个
    #   仓库，路径不相通；照 loss 那轮的做法不列它）。
    {"file": ".workbuddy/tools/scoped_stage_by_marker.py", "keep_all": True, "gone": []},
])

# 后端（be HEAD = e1f7af0）：本轮唯一改动是 data.py 的 5 行新增，keep_all 自证「== 工作区」。
#   5 行 = 4 行注释 + 「商品名称为空 → 400」那两行闸门（`products.name` 是 NOT NULL，
#   但空串不是 NULL，SQLite 照收 ⇒ 无名商品会出现在报单/小程序里）。
#   ⚠️ data.py 在本仓库常年有在途改动，但**此刻** diff 只有这 5 行（已核实）⇒ keep_all 成立。
#      若复跑时 keep_all 报「 != 工作区」，说明有别的会话动了它，改用 markers。
SPEC_BE_V184C = ("be", [
    {"file": "server/routers/data.py",
     "keep_all": True,
     "gone": ["arrival_lead_days 为空"]},
])

# v184c 收尾：交付说明补「八、提交」（两端 commit 号 + 在途改动未夹带的回读证据）。
# 该文件在 `5b56315` 里已入库，此 spec 只补这一段 —— 单文件、全本轮 ⇒ keep_all。
SPEC_FE_V184C_DOCS = ("fe", [
    {"file": "outputs/商品编辑-2026-09-17/交付说明.md", "keep_all": True, "gone": []},
    {"file": ".workbuddy/tools/scoped_stage_by_marker.py", "keep_all": True, "gone": []},
])

# v185 导航收口：侧栏只保留「货损核算」入口（删掉重复的「货损计算」）。
#   用户原话：「删除侧栏中另一个『货损计算』入口，仅保留『货损核算』入口」。
#   三处导航出口一起收口 —— 只删侧栏会留半截（⌘K 面板仍能搜到旧页）：
#     ① Shell.vue 桌面侧栏  ② Shell.vue 移动抽屉  ③ CommandPalette.vue ⌘K 命令面板
#   ⚠️ **故意不动**的四处，别当漏改：
#     · router/index.js 的 /loss 路由 —— 保留 ⇒ 旧书签/外链不 404（收的是**入口**，不删能力）
#     · Workbench.vue:357 待办卡 path:'/loss' —— 那是**批次效期**深链（「N 批已过期」→看批次
#       清单），改指 /loss-accounting 是错的：核算页按月看流水，没有批次清单
#     · AdvicePanel.vue TYPE_MAP.loss_calc —— AI 建议卡的**类型标签**，不是导航
#     · LossWorkflow.vue 页内文案（标题/导出名/打印副标题）—— 页面自身的事
#   Shell.vue 在本仓库常年有在途改动：此刻 10 个在途 hunk（另一会话在删 ⌘K 角标
#   tb-cp-k / tb-copilot），本轮只占 old_start=46 与 95（两个**纯删除** hunk）
#   ⇒ 必须走 exclude_hunks 黑名单，不能用 gfocus（`-U3` 会把相邻改动并进同一 hunk）。
#   CommandPalette.vue 在 HEAD 干净且本轮 hunk 全是我的 ⇒ keep_all（自证「== 工作区」）。
#   ⚠️ 「10 hunk」是本刻快照；复跑前重数（本工具自己会断言，不会静默放过）。
SPEC_FE_V185_NAV = ("fe", [
    {"file": "hergent-cn-v2/src/components/Shell.vue",
     "exclude_hunks": [17, 111, 143, 148, 189, 190, 195, 329, 332, 401], "gone": []},
    {"file": "hergent-cn-v2/src/components/CommandPalette.vue",
     "keep_all": True, "gone": ["货损计算工作流"]},
    # 本轮的「需求 → 可复跑断言」：把「侧栏只能有货损核算」钉成回归闸。
    {"file": ".workbuddy/tools/loss-accounting-prod-verify.js", "keep_all": True, "gone": []},
    {"file": ".workbuddy/tools/scoped_stage_by_marker.py", "keep_all": True, "gone": []},
])

# ── v185-trend：货损核算「跨期趋势」端点 + 按月仪表盘（用户回「A」）────────────────
# 归属依据（逐 hunk 打印首行核对过，不按行号猜）：
#
# 后端（be HEAD = 待查）：本轮唯一改动文件 = `server/routers/loss_accounting.py`，
#   该文件 7 个 hunk **全是本轮**（已逐块打印确认，无并行会话尾巴）：
#     30      import 加 Query
#     518     新增三张列映射表 + `_agg`（率的唯一实现）
#     531/535/540  `_subtotal` 改为「先求和 → 交 `_agg`」；新增 `ded_sum`
#     552     新 `_subtotal` 定义
#     906     🔴 主体：`_TREND_MAX_MONTHS` / `_NULL_SUM_KEYS` / `_month_add|diff|seq|gaps`
#             / `_trend_series` / `GET /trend`（+232 行）
#   ⇒ keep_all 拿到「构造结果 == 工作区」自证。
SPEC_BE_V185_TREND = ("be", [
    {"file": "server/routers/loss_accounting.py",
     "keep_all": True,
     # 本轮**删掉**的东西必须在暂存版与工作区同时为 0：证明率算法确实只剩 `_agg` 一份
     # （旧的「列名散落在 `_subtotal` 里 + `bool(den_col)` 判率」写法必须彻底消失）。
     "gone": ['num_col = {"store":', "bool(den_col)", "if den_col else None"]},
])

# 前端（fe HEAD = 待查）：
#   `LossDashboard.vue` 新文件（纯展示层，**537 行**）⇒ new_file，内容取工作区。
#   `LossAccounting.vue` **13 个 hunk 全本轮**（逐块打印确认，无在途尾巴；HEAD 922 → 1168，+246）：
#     49/55        模板：编辑条加「趋势已收起」说明 + 区间筛选条/月列表/<LossDashboard> 整块
#     383           import LossDashboard
#     414           趋势状态（trend / trendLoading / trendErr / tRange / tHideOpen / tSkipEmpty）
#     581           派生数据与环比（tSummary / trendSubjects / trendGroups / allMonths /
#                   chartMonths / monthList / prevMonthOf / momAmt / momRate / momAmtText /
#                   momRateText / momCls）
#     598           reload 加 loadTrend + 新 loadTrend() + switchPeriod()
#     604/673/693/707  四个联动刷新点（doRecompute / saveManual / toggleClose / onChangePricing）
#     790           onMounted → async + loadTrend
#     871/884       样式（.la-bad / .la-tbar* / .la-ml*）
#     ⇒ keep_all。
#   `api/modules.js` **9 个 hunk = 本轮 1 + 在途 8** ⇒ markers。
#     本轮 1：old_start=237（`lossAccountingApi.trend` 整块，+7 行）。
#     在途 8（均为前几轮未提交、**已全部在产**的改动，留在工作区由各自作者提交）：
#       340(+1/−1)  forecastApproveApi.summary 加 periodId 形参
#       344(+1)     q.push('period_id=' + periodId)
#       352(+1/−1)  productsApi.bulkUpsert **搬家两半**（技能 §5.8：搬移必须两半一起排除）
#       384(−1)     columnSchemeApi 上方注释搬家（删）
#       395(+1)     forecastColumnsApi 上方注释搬家（增）
#       396(+1/−1)  importApi.template **搬家两半**
#     净：HEAD 512 → 工作区 520（我 +7，在途 +1）⇒ 暂存 519 是正确结果。
#     ⚠️ 标记串 `trend: ({ from = '', to = '', limit = 0 } = {}) =>` 实测**恰好命中 old_start=237**
#        这一个 hunk（取功能行而非注释行，更能抵抗注释改写）。
#   `loss-accounting-prod-verify.js` 本轮 1 个 hunk（+183,46 = `# 6.5 仪表盘` 段）⇒ keep_all。
#   ⚠️ 「9 hunk」「13 hunk」是本刻快照；跨轮次会变，复跑前重数（本工具会自己断言）。
SPEC_FE_V185_TREND = ("fe", [
    {"file": "hergent-cn-v2/src/components/LossDashboard.vue", "new_file": True, "gone": []},
    {"file": "hergent-cn-v2/src/pages/LossAccounting.vue", "keep_all": True, "gone": []},
    {"file": "hergent-cn-v2/src/api/modules.js",
     "markers": ["trend: ({ from = '', to = '', limit = 0 } = {}) =>"], "gone": []},
    {"file": ".workbuddy/tools/loss-accounting-prod-verify.js", "keep_all": True, "gone": []},
    # 本轮的两份「需求 → 可复跑断言」：68 条隔离验证 + 33 条本地渲染预检
    {"file": ".workbuddy/tools/loss-trend-local-verify.py", "new_file": True, "gone": []},
    {"file": ".workbuddy/tools/loss-dashboard-local-preflight.js", "new_file": True, "gone": []},
    # 交付截图（⚠️ 必须标 binary，否则 utf-8 解码会炸掉整个 spec）
    {"file": "outputs/货损核算-2026-09-18/06-仪表盘-本地预检.png",
     "new_file": True, "binary": True, "gone": []},
    {"file": "outputs/货损核算-2026-09-18/07-仪表盘-主图特写-本地预检.png",
     "new_file": True, "binary": True, "gone": []},
    # 本工具自身（新增上面两个 spec）
    {"file": ".workbuddy/tools/scoped_stage_by_marker.py", "keep_all": True, "gone": []},
])

# ── v184d：预报订单汇总表「报单金额按厂价计算」+ 删除「进价」重复列 ──────────────
# 本轮（v184d）在上一轮未提交的 v184 工作之上，补齐**只读态汇总表**的金额口径：
#   只读表原本用 displayPrice（走 dist/sale_price，受已失效的 priceBasis 开关影响）算「下单金额(厂价)」，
#   且「单价(厂价)」列无渲染分支而空白。现把只读表 tbody 的 price/amount 分支、表尾 grand.amount、
#   commitCell 金额基准、displayPrice 全部对齐 factoryPrice（与后端 db.factory_price_sql 逐字同构）。
#   同时删除「进价」列（MASTER_COL_DEFS + COLUMN_PERMISSIONS），但保留行对象 r.purchase_price
#   / 导入解析 / 草稿 / 保存载荷（删列≠删数据），报单金额仍按厂价口径计算。
# 在途（别人的、未提交，2026-09-13 起同一批）：
#   101   纯空行 hunk
#   2648/2650/2661/2663  loadEditGrid 的 sources 合并 / srcByPid 合并 / extraByPid 累加 + buildRowBase（v179 同源，非本轮）
#   7772/7787  `.imp-errs` 规则**搬家两半**（技能 §5.8：两半必须一起排除）
#   8156   纯空行 hunk（即旧 exclude 7105 的位移版）
SPEC_FE_V184D = ("fe", [
    {"file": "hergent-cn-v2/src/pages/Forecast.vue",
     "exclude_hunks": [101, 2648, 2650, 2661, 2663, 7772, 7787, 8156],
     "gone": []},
    # 本工具自身（新增上面这个 spec）
    {"file": ".workbuddy/tools/scoped_stage_by_marker.py", "keep_all": True, "gone": []},
])

# ── v184e：预报汇总表「箱口径四规则」对齐 + 系统建议列移位 ────────────────────────
#   背景：用户要求汇总表各列按四规则逐行对齐 ——
#     ① 件数 = 合计 ÷ 规格（取整）② 加单/最终下单均以「箱」计
#     ③ 最终下单 = 件数 + 加单  ④ 下单金额 = 最终下单 × 单价(厂价/箱)
#   并评估「系统建议」列：发挥作用（后端定稿量辅助加单决策 + 风险提示），位置移到「加单」左侧。
#   Forecast.vue 本轮 25 hunk 全归我（箱口径改造 + 系统建议移位 + 单价(厂价/箱)换算
#     + 列标签/口径说明/返利贡献同步），exclude 8 个在途 hunk：
#     101    顶部插入（历来在途，与本轮无关）
#     2662/2664/2675/2677  loadEditGrid sources 合并 / 行级加单同源（并行会话在途）
#     7818/7833  `.imp-errs` 样式搬家两半（并行会话在途，两半一起排除）
#     8202    纯空行插入（并行会话在途）
#   ⚠️ 根因修复点：loadCross 的 grand 初值缺 boxes，recomputeTotals 装载后未调用 →
#     表尾「件数(箱)」显示「—」；本轮在 loadCross 末补 recomputeTotals()。
SPEC_FE_V184E = ("fe", [
    {"file": "hergent-cn-v2/src/pages/Forecast.vue",
     "exclude_hunks": [101, 2662, 2664, 2675, 2677, 7818, 7833, 8202],
     "gone": []},
    # 本工具自身（新增上面这个 spec）
    {"file": ".workbuddy/tools/scoped_stage_by_marker.py", "keep_all": True, "gone": []},
])

# ── v185-dash：「目标与返利 › 仪表盘」审查落地（R1–R5 + 紧凑档 + 跨页品牌）────────
#   MonthlyAchvChart.vue  28 hunks 全归本轮 → keep_all（自证「构造结果 == 工作区」）：
#     删 4 条重复说明（574px 副标题 / 两条 sec-note / 图例 4→3 合并）
#     + 新增「完整 / 紧凑」密度切换（复活 v154 遗留的 .mac-seg / .seg-btn 死 CSS）
#   Rebate.vue            13 hunks 全归本轮 → keep_all：
#     hero 位换成「本月实际返利」（口径 = 本月全部填报，与达成填报同源同字段）
#     + 行内第 3 格改「距下一档」绝对金额（hasTiers 时）／「距达标」（on_target 时）
#     + 删序号圈、删死字段（triggered / effectiveRate / summary.noData）
#     + goSprint 跨页带 ?brand=
#   Forecast.vue          10 hunks = 本轮 2 + 在途 8 → exclude_hunks
#     本轮：1934（useRoute import）、3280（route.query.brand watcher）
#     在途：loadEditGrid sources 合并 / buildRowBase 行底同源 / .imp-errs 搬家（行号已位移）
#   ⚠️ gone 一律选「不被新注释引用」的精确串 —— 新写的注释里**故意**提到了旧名
#      （`<!-- v185 R1：原 .sec-note「柱高＝实际销量…」已删 -->`），拿旧文案当 gone 会必然误报。
SPEC_FE_V185_DASH = ("fe", [
    {"file": "hergent-cn-v2/src/components/rebate/MonthlyAchvChart.vue", "keep_all": True,
     "gone": ['<span class="sec-note">', "sec.note", '"note":', "深色段＝超出目标的部分"]},
    {"file": "hergent-cn-v2/src/pages/Rebate.vue", "keep_all": True,
     "gone": ['<span class="rr-rank">', "gapText", "gapLabel", "noData:"]},
    {"file": "hergent-cn-v2/src/pages/Forecast.vue",
     "exclude_hunks": [101, 2661, 2663, 2674, 2676, 7789, 7804, 8173],
     "gone": []},
    {"file": ".workbuddy/tools/scoped_stage_by_marker.py", "keep_all": True, "gone": []},
])

# ── v185-r7：品牌筛选候选收窄为「本年度确有品牌目标」──────────────────────────────
#   Rebate.vue       8 hunks 全归本轮 → keep_all
#     chartBrandList 判据换成与 buildYearMatrix **逐字同源**的两个测试
#     （achvRuleActiveInMonth(r, y, m) && monthTargetOf(r, y, m) > 0，∃ m ∈ 1..12）
#     ⇒ 候选里出现的品牌，图表必然画得出至少一根柱。
#     + watch 剔除「已选中但已不在候选」的品牌（防**隐形筛选**）+ 模板传 empty-text
#   BrandFilter.vue  2 hunks 全归本轮 → keep_all
#     emptyText prop：区分「搜索无结果」与「候选本身就是空」两种空清单
#   ⚠️ ruleActiveInMonth 必须 import 起别名 achvRuleActiveInMonth —— 本文件 2165 行
#      另有一份同名本地实现（走本地时区 new Date(y,m-1,1)），直接同名 import 会
#      `Identifier 'ruleActiveInMonth' has already been declared` 编译失败；
#      而若改用它，又会与 buildYearMatrix（走 Date.UTC）错配 ⇒ 必须用 hook 版。
#   ⚠️ gone 选「模板/代码形态」的精确串：`没有匹配的品牌` 作为**三元分支**仍在新模板里，
#      只有 `没有匹配的品牌</p>` 才是真的不在了（这正是 §gone 那条判据的又一次实战）。
SPEC_FE_V185_R7 = ("fe", [
    {"file": "hergent-cn-v2/src/pages/Rebate.vue", "keep_all": True,
     "gone": ["for (const b of (brandList.value || []))", "只用档案会漏",
              "规则里实际出现的品牌名"]},
    {"file": "hergent-cn-v2/src/components/rebate/BrandFilter.vue", "keep_all": True,
     "gone": ['class="bf-empty">没有匹配的品牌</p>']},
    {"file": ".workbuddy/tools/scoped_stage_by_marker.py", "keep_all": True, "gone": []},
])

# ── v185-tabs：货损核算「仪表盘 / 数据填报」拆成两个主 Tab（2026-09-18）──────────
#   用户原话：「请参照目标与返利模块，把仪表盘和数据填报页面分开」。
#
#   归属依据（逐 hunk 打印首行核对过，不按行号猜；基线 HEAD = 49236f0）：
#
#   variables.css  1 hunk（old_start=271）全归本轮 → keep_all
#     页内主 Tab 从 Rebate.vue 的 scoped **上提到全局层**（全站唯一一份，
#     防两页各写一份逐轮视觉漂移 —— 铁律「第二份拷贝＝静默漂移」）
#   Rebate.vue     1 hunk（old_start=3207）全归本轮 → keep_all
#     删掉本地那 5 条 .main-tabs/.main-tab，换成「已上提到全局层」注释；
#     文件末尾 @media print 里隐藏 .main-tabs 那句**刻意保留**（只作用本页）
#   LossAccounting.vue  13 hunk 全归本轮 → keep_all
#     8    工具条整块搬进「数据填报」tab（原位置换成 .main-tabs）
#     43   编辑条搬进填报 tab + 删「趋势图与月列表已在录入态收起」那句补丁
#     57   删 v-if="!editMode" 的整段收起（分 tab 后不再需要这层补丁）
#     73   筛选条右侧提示改写（点柱子=切期次；去填报=跳 tab）
#     128  月列表操作列「查看」→「去填报」（@click 由 switchPeriod 改 goFill）
#     146  LossDashboard @pick 由 switchPeriod 改 pickMonth
#     149  插入「数据填报」tab 整块（工具条 + 编辑条 + 其后的公司卡/主表）
#     331  </template> 收在表尾 footnote 之后（弹窗 Teleport 留在两 tab 之外）
#     486  const mainTab = ref('dashboard')（放最前，防 Cannot access before initialization）
#     794  switchPeriod → switchTab + blockIfDirty + pickMonth（含"留在仪表盘"语义）
#     795  pickMonth 里加 blockIfDirty 拦截（从仪表盘换期次必须拒绝）
#     801  goFill（切到该月 + 跳填报 tab）
#     1095 .la-tabnote 诚实性提示样式（仪表盘读的是**已保存**的数据）
#     ⚠️ 公司卡 / 主表两块**刻意保持原缩进**未重排 —— 175 行纯空白 churn 会让
#        「本轮改动 vs 在途改动」在 hunk 粒度上更难分辨（本项目按 hunk 归属提交）。
#     ⚠️ keep_all 自证「构造结果 == 工作区」成立 ⇒ 此刻该文件**无在途改动**
#        （并发会话的 v185 rebate 工作已由 de41bd6 / 49236f0 提交，不再叠在本文件上）。
#   loss-accounting-prod-verify.js   5 hunk 全归本轮 → keep_all
#     + snapTabs / clickMainTab 两个浏览器内助手；# 1.5 主 Tab 7 条；# 6.5 切回 3 条
#   loss-dashboard-local-preflight.js 7 hunk 全归本轮 → keep_all
#     # 0 主 Tab 4 条；# 5 改读 .la-ml-tbl tbody tr.la-ml-cur>la-ml-m b（期次下拉只在填报 tab）；
#     # 7.5 切填报→7 条（含主表结构 + 工具条 6 按钮 + 落 08-数据填报-本地预检.png）→切回→3 条
#   ⚠️ Forecast.vue **不在本 spec 里**：本轮未碰它。它此刻在途的 8 hunk 属别的会话
#      （v184d 那批），不由本提交认领 —— 不认领 = 不动它，留在工作区由作者提交。
SPEC_FE_V185_TABS = ("fe", [
    {"file": "hergent-cn-v2/src/styles/variables.css", "keep_all": True, "gone": []},
    {"file": "hergent-cn-v2/src/pages/Rebate.vue", "keep_all": True, "gone": []},
    {"file": "hergent-cn-v2/src/pages/LossAccounting.vue", "keep_all": True,
     # 本轮删掉的两串（暂存版与工作区都必须为 0）
     "gone": ["趋势图与月列表已在录入态收起",
              '<button class="la-link" @click="switchPeriod(m.period)">查看</button>']},
    {"file": ".workbuddy/tools/loss-accounting-prod-verify.js", "keep_all": True, "gone": []},
    {"file": ".workbuddy/tools/loss-dashboard-local-preflight.js", "keep_all": True, "gone": []},
    # 重拍的仪表盘截图（**已跟踪** → binary + keep_all）+ 本轮新增的填报页截图（new_file）
    {"file": "outputs/货损核算-2026-09-18/06-仪表盘-本地预检.png",
     "binary": True, "keep_all": True, "gone": []},
    {"file": "outputs/货损核算-2026-09-18/07-仪表盘-主图特写-本地预检.png",
     "binary": True, "keep_all": True, "gone": []},
    {"file": "outputs/货损核算-2026-09-18/08-数据填报-本地预检.png",
     "binary": True, "new_file": True, "gone": []},
    # 本工具自身（新增上面这个 spec + 「已跟踪二进制」支持）
    {"file": ".workbuddy/tools/scoped_stage_by_marker.py", "keep_all": True, "gone": []},
])

# ── v186-directsale：③ 直调行的「临期销售」填报入口 + 列位改名（2026-09-18）──────
#   用户原话：「请给『良品仓 → 临期仓』加一个『临期销售抵扣』填报入口，
#              同时把『临期销售抵扣』改成『临期销售』」
#
#   归属依据（逐 hunk 打印首行核对，不按行号猜；基线 be HEAD = c4d91ac / fe HEAD = 9787f01）：
#
#   六个文件**全部 keep_all** —— 逐块首行核对后无一条在途尾巴：
#     ① 后端 loss_accounting.py 17 hunk：1 条新列定义 / 5 处改名 / `_KIND_DED_COL` 加 direct /
#        `_compute` ③ 段取回填 direct_loss_sale_amt / `bd` 加键 / `loss_wh_sale_other_amt` 减 ③ /
#        `_company_quality` 告警改写 / `_subtotal` docstring 写明**为什么不**加计数字段。
#     ② LossAccounting.vue 4 hunk：subText 的 ded 分支 / 公司卡「展开构成」加一行 /
#        「已进各行抵扣」→「已进 ② 行抵扣」/ 包含关系说明改写 / 计价口径 hint 改名。
#     ③ LossDashboard.vue 6 hunk：7 处改名 + 副图脚注从句「负数=临期销售超过损失」。
#     ④ loss-trend-local-verify.py 17 hunk：PLAN.direct 标量→(直调额, 直调临期销售) 元组 /
#        新增 ⑫ 段 20+ 条 / ⑬ 段改「变更集封印」/ fixture 2 份→4 份。
#     ⑤ loss-dashboard-local-preflight.js 4 hunk：HG_DIST 覆盖 / 按期次取 fixture / 新增 # 7.8。
#     ⑥ loss-accounting-prod-verify.js 3 hunk：snapColDed() + # 4.5 + # 5.5。
#
#   ⚠️ 后端 keep_all 的**前置自证已完成**：生产 `/opt/hergent-erp/routers/loss_accounting.py`
#      md5 == `git show HEAD` 版（565fa50a…）⇒ 工作区 diff 即「prod → 本轮」的唯一 delta，
#      42+/16− 全部为本轮。（这一步必须做：本仓库常态 9~30 个脏文件，
#      「HEAD == 生产」是 keep_all 成立的前提。）
#   ⚠️ `.workbuddy/tools/scoped_stage_by_marker.py` 本轮改动 = 新增这组 spec（keep_all）。
#   ⚠️ 截图 07 **刻意不入 spec**：重拍后 md5 与已提交版相同（05140d4e…）⇒ 无需重提交。
#      06 / 08 是**已跟踪二进制**改动（binary + keep_all），09 / 10 / 11 是新文件。
SPEC_BE_V186_DIRECTSALE = ("be", [
    {"file": "server/routers/loss_accounting.py", "keep_all": True,
     # 改名的**充分性**证据：旧词在整个文件里必须彻底消失（含列位 label 那一行）。
     "gone": ["临期销售抵扣", '{"key": "ded", "label": "临期销售抵扣"']},
])

SPEC_FE_V186_DIRECTSALE = ("fe", [
    {"file": "hergent-cn-v2/src/pages/LossAccounting.vue", "keep_all": True,
     "gone": ["其中：业务员自售（已进各行抵扣）", "临期销售抵扣也走同一口径"]},
    {"file": "hergent-cn-v2/src/components/LossDashboard.vue", "keep_all": True,
     "gone": ["临期销售抵扣"]},
    {"file": ".workbuddy/tools/loss-trend-local-verify.py", "keep_all": True,
     # ⑬ 段从「只允许新增 ded_sum」改成**登记制封印** ⇒ 旧的逐字比对待检器必须消失
     "gone": ["strip_dedsum", "重构等价：_compute 输出与 HEAD 版逐字相同"]},
    {"file": ".workbuddy/tools/loss-dashboard-local-preflight.js", "keep_all": True, "gone": []},
    {"file": ".workbuddy/tools/loss-accounting-prod-verify.js", "keep_all": True, "gone": []},
    # 重拍的两张（**已跟踪二进制** → binary + keep_all）与新出的三张（new_file）
    {"file": "outputs/货损核算-2026-09-18/06-仪表盘-本地预检.png",
     "binary": True, "keep_all": True, "gone": []},
    {"file": "outputs/货损核算-2026-09-18/08-数据填报-本地预检.png",
     "binary": True, "keep_all": True, "gone": []},
    {"file": "outputs/货损核算-2026-09-18/09-临期销售填报入口-本地预检.png",
     "binary": True, "new_file": True, "gone": []},
    {"file": "outputs/货损核算-2026-09-18/10-生产真机-临期销售列位.png",
     "binary": True, "new_file": True, "gone": []},
    {"file": "outputs/货损核算-2026-09-18/11-临期销售填报入口-交付说明-2026-09-18.md",
     "new_file": True, "gone": []},
    # 本工具自身（新增上面这组 spec）
    {"file": ".workbuddy/tools/scoped_stage_by_marker.py", "keep_all": True, "gone": []},
])

SPEC_BE_V186_UNIFY = ("be", [
    {"file": "server/routers/loss_accounting.py", "keep_all": True,
     # 「统一」的**充分性证据**：两个旧变体在整个文件里必须彻底消失。
     #   注意这两个串与上一轮 spec 的 `gone` 不同 —— 上一轮只消了「临期销售抵扣」，
     #   本轮才消「临期货销售额」（② 行）与「临期销售额」（③ 行）。
     "gone": ["临期货销售额", "临期销售额"]},
])

SPEC_FE_V186_UNIFY = ("fe", [
    # ⑬ 段形态随轮次收紧：上一轮是「差异只允许是登记的 13 条」白名单，
    # 本轮上一轮已进 HEAD ⟹ 白名单被删、改成 `_compute` **逐字零差异**，并新增 ⑬-2 双向封印。
    {"file": ".workbuddy/tools/loss-trend-local-verify.py", "keep_all": True,
     "gone": ['"groups[2].rows[0].values.direct_loss_sale_amt",',   # 白名单条目已删
              "missing = [a for a in ALLOWED",                      # 旧的自证器已换成双向写法
              "% len(ALLOWED)"]},
    # 新增 `# 4.6` 直读 payload 段（三粒度同词 + 三个旧变体清零）
    {"file": ".workbuddy/tools/loss-accounting-prod-verify.js", "keep_all": True, "gone": []},
    {"file": "outputs/货损核算-2026-09-18/01-设计方案.md", "keep_all": True,
     "gone": ["| `op_loss_sale_amt` | 临期货销售额 |"]},
    # ⚠️ 这份**故意**不设 gone：文末「八」章节要写清"从哪个旧叫法改成了什么"，
    #    正文里出现旧变体是**说明性引用**，不是残留。用 gone 会误报。
    {"file": "outputs/货损核算-2026-09-18/11-临期销售填报入口-交付说明-2026-09-18.md",
     "keep_all": True, "gone": []},
    # 本工具自身（新增上面这组 spec）
    {"file": ".workbuddy/tools/scoped_stage_by_marker.py", "keep_all": True, "gone": []},
])


# ══ v186-covers：返利「生效期 ∩ 月度分解」门禁取消（用户需求：「有目标就必须画柱」）══
# 根因：tenant_1 规则「蒙牛低温2026年目标」12 个月分解齐全（868.4 万），但
#      effective_start/end 只写了 2026-09 ⇒ 旧口径取交集后只剩 9 月：
#      前端 11 个月目标柱整根不画、后端 covered_months 只认 9 月、试算 as_of_date
#      不在生效期 ⇒ 返利恒 0。8 月已填报的达成 32.4 万 / 实际返利 13.1 万被丢弃。
# 口径（用户拍板）：年度规则适用月份 = 月度分解本身，生效期不再逐月裁剪；
#      单期规则（无分解）仍按生效期过滤；未生效/未填报才用灰色。
# 顺带把散落前后端 5 处的生效期门禁收敛成 1 处（前端 ruleCoversMonth / 后端 rule_covers_month）。
#
# ── 后端归属取证（基线 27bd785；每个 hunk 都已打印首行逐条核对）──
#   rebate_period.py   5 hunks **全部本轮**（covered_months 改写 + rule_covers_month /
#                      rule_covers_date 新增）→ keep_all，且已逐行通读全部 diff
#   rebate_calc.py     4 hunks **全部本轮**（_rule_spec 下传月度字段 + 试算改走
#                      rule_covers_date）→ keep_all
#   rebate_cases.json  1 个纯插入 hunk（+55，含 C22~C25 四条新用例）→ keep_all
#   erp_db.py          ⚠️ 混合：exclude_hunks 收 5 个**在途** hunk（都非本轮、且均已上生产）：
#                        · 1400          products DDL 里 `extra_json` 归位（并发会话）
#                        · 10944/10959   `_safe_migrate("v110_products_dist_price")` 搬家两半
#                        · 11376/11379   `login_is_locked` 双维度 IP 锁定（并发会话）
#                      本轮保留的 4 个 = 9938 / 9940 / 9943（_rule_active_in_month 委托 domain 层）
#                        + 10102（accrue_rebate 报错文案随口径改写）
#   🔴 keep_all 前置已核（§5.10 末）：三个 keep_all 文件的生产 md5 == 工作区 md5
#      （c27bc119 / d2791b17 / 74817ace），且 HEAD→工作区的每个 hunk 内容都是本轮 v186 语义
#      —— 不存在他人「已上线未提交」被记进本次提交。
SPEC_BE_V186_COVERS = ("be", [
    {"file": "server/domain/rebate_period.py", "keep_all": True, "gone": []},
    {"file": "server/domain/rebate_calc.py", "keep_all": True, "gone": []},
    {"file": "server/tests/fixtures/rebate_cases.json", "keep_all": True, "gone": []},
    {"file": "server/erp_db.py",
     "exclude_hunks": [1400, 10944, 10959, 11376, 11379], "gone": []},
    {"file": "server/tests/test_rebate_period_v186.py", "new_file": True, "gone": []},
])

# ── 前端归属取证（基线 96fb918；同上，逐 hunk 打印首行核对）──
#   useMonthlyAchv.js      4 hunks 全部本轮（删 ruleActiveInMonth / 新增 ruleYear +
#                          ruleCoversMonth / 文件头口径注释）→ keep_all
#   MonthlyAchvChart.vue   3 hunks 全部本轮（MIN_TRACK_PX=2 + .track 改实色 #cbd5e1）
#                          → keep_all
#   Rebate.vue             **11 hunks 全部本轮**（import 换共享谓词 / chartYearOptions 走
#                          ruleYear / 删两份本地实现 ruleEffectiveInMonth +
#                          ruleActiveInMonth / buildAchvRows 与 dashBase 改用共享谓词）
#                          → keep_all
#   Forecast.vue           ⚠️ 混合 11 hunks：本轮仅 3 个（1947 文件头注释 + 6375 删本地
#                          ruleEffectiveInMonth + 6420 rebateSprint 用共享谓词）；
#                          8 个**在途**（均为并发会话，已上生产未提交）：
#                            · 101 / 8229              纯空行插入（无法归属 → 一律排除）
#                            · 2686/2688/2699/2701     srcByPid 合并 + extraByPid 累加 +
#                                                      v179 rowBase「查看态/编辑态同源」
#                            · 7845/7860               `.imp-errs` 样式搬家两半
#                          🔴 7845 与 7860 是**同一逻辑改动的两半**（§5.8：只排一半会让规则
#                             彻底消失 / 出现两份）—— 两半都归在途，故一起排除，
#                             `.imp-errs` 留在 HEAD 原位恰好一份。
#   🔴 前端不适用「生产 == HEAD」那条前置（dist 是整体构建产物）——改用「HEAD→工作区每个
#      hunk 内容是否属本轮」判归属，已逐条读过。
SPEC_FE_V186_COVERS = ("fe", [
    {"file": "hergent-cn-v2/src/components/rebate/useMonthlyAchv.js", "keep_all": True, "gone": []},
    {"file": "hergent-cn-v2/src/components/rebate/MonthlyAchvChart.vue", "keep_all": True, "gone": []},
    {"file": "hergent-cn-v2/src/pages/Rebate.vue", "keep_all": True, "gone": []},
    {"file": "hergent-cn-v2/src/pages/Forecast.vue",
     "exclude_hunks": [101, 2686, 2688, 2699, 2701, 7845, 7860, 8229], "gone": []},
    # 本轮新增的两个验证工具（HEAD 无 → new_file）
    {"file": ".workbuddy/tools/rebate-rule-covers-month-check.mjs", "new_file": True, "gone": []},
    {"file": ".workbuddy/tools/rebate-chart-render-harness.py", "new_file": True, "gone": []},
    # 本工具自身（新增上面这组 spec）
    {"file": ".workbuddy/tools/scoped_stage_by_marker.py", "keep_all": True, "gone": []},
    # 交付说明与真机证据（PNG 必须标 binary，否则 utf-8 解码会炸掉整个 spec）
    {"file": "outputs/目标与返利-生效期口径-2026-09-18/01-交付说明.md",
     "new_file": True, "gone": []},
    {"file": "outputs/目标与返利-生效期口径-2026-09-18/02-图表真机测量.json",
     "new_file": True, "gone": []},
    {"file": "outputs/目标与返利-生效期口径-2026-09-18/03-真机图表.png",
     "new_file": True, "binary": True, "gone": []},
    {"file": "outputs/目标与返利-生效期口径-2026-09-18/04-真机月度表.png",
     "new_file": True, "binary": True, "gone": []},
])

# ── v187：货损核算「仪表盘」视觉重做（**纯前端**；本轮无后端改动）────────────
# 归属依据（逐 hunk 打印首行核对过，不按行号猜）：
#   LossDashboard.vue      53 hunks 全部本轮 —— 区域全落在模板 33–290 与脚本 306–631：
#                          色板 token 段（--c-gross/--c-net/--c-ded/--c-rate/--c-g1..g4/
#                          --c-grid/--c-axis/--c-ph-bg/--c-ph-bd）+ bw3 + 占位框收成柱群宽 +
#                          轴单位 y 上移 + 卡片标题换全局 sec-hd/sec-sub + KPI 结构由自造
#                          `.dsh-kpis/.k` 改为规范要求的全局 `.kpi-strip` + 样式段整体重写。
#                          该文件近 2h 内**只有本轮一次写入**（mtime 即我的编辑），
#                          无并发会话足迹 → keep_all（拿「暂存版 == 工作区」逐字节自证）
#   LossAccounting.vue     11 hunks 全部本轮 —— 模板 45–119（仪表盘 tab 内顺序重排：
#                          概览 + 趋势在前、按月明细在后；旧位置纯删 13 行）+ 样式
#                          1192–1221（.la-ml* 与 .la-tbar 间距收口）→ keep_all
#   styles/variables.css    1 hunk（@@ -345,0 +346,26 @@）**纯新增**：全局区块标题
#                          `.sec-hd` / `.sec-sub`（只新增类，不动任何既有规则）→ keep_all
#   loss-dashboard-local-preflight.js  4 hunks 全部本轮（KPI 断言类名同步 → `.kpi-strip .kpi`、
#                          率点 r 3.2→3.4 + 新增「视觉规范（v187）」10 条 + 下半屏截图 +
#                          深色主题段 3 条）
#   loss-accounting-prod-verify.js     3 hunks 全部本轮（KPI 断言同步 + oldKpis/cGross 采集 +
#                          新增「副图 B（3 根柱）柱群不超列宽」闸）
#   🔴 前端**不适用**「生产 == HEAD」那条前置（dist 是整体构建产物）——改用「HEAD→工作区
#      每个 hunk 的内容是否属本轮」判归属，已逐条读过。
#   🔴 本轮构建期间工作区有并发会话在改 Forecast.vue / Rebate.vue / useMonthlyAchv.js ——
#      已用 `tools/dist_normalized_diffcheck.py` 做差集核查确认**零夹带**：首版抓到
#      `Forecast-HASH.js` 真变化，回退到 `git show HEAD:` 版后最终真变化只剩
#      「LossAccounting.js +45 字节」（= bw3 与占位框宽度），其余 28 项为纯派生噪声。
#      故本 spec **不纳入任何 Forecast/Rebate 文件**。
#   `gone` 一律为空：本轮是「视觉重做」而非「删旧串」型变更；唯一删净的 `.dsh-kpis`
#   仍以说明性注释留在 LossDashboard.vue 第 36 行（注释不是活类名，不能拿 gone 断言），
#   改由 preflight / prodverify 的负向断言 `oldKpis === 0` 在运行期把关。
SPEC_FE_V187_DASHBOARD = ("fe", [
    {"file": "hergent-cn-v2/src/components/LossDashboard.vue", "keep_all": True, "gone": []},
    {"file": "hergent-cn-v2/src/pages/LossAccounting.vue", "keep_all": True, "gone": []},
    {"file": "hergent-cn-v2/src/styles/variables.css", "keep_all": True, "gone": []},
    {"file": ".workbuddy/tools/loss-dashboard-local-preflight.js", "keep_all": True, "gone": []},
    {"file": ".workbuddy/tools/loss-accounting-prod-verify.js", "keep_all": True, "gone": []},
    # 本工具自身（新增上面这组 spec）
    # 🔴 2026-09-18 实测事故：本轮首次提交时**本条被守卫拦下** —— 索引里唯独少这个文件。
    #    追因：17:21:00 并发会话提交 fb6edfa 时，其 spec 也对这个文件 keep_all ⇒ 把本轮
    #    刚写进来的 SPEC_FE_V187_DASHBOARD（+60 行）**连带提交进了 HEAD**，于是本文件
    #    在工作区与 HEAD 之间**已无 diff** ⇒「索引内容 == 待提交文件」这条洁净断言必然
    #    失败（索引里不会有它，names 里却有它）。**这是守卫按预期生效，不是回归。**
    #    ⇒ 处置：保留本条目（注释这点改动本身重新产生了 diff，从而可被正常自纳提交），
    #      但要记住**多个会话共用同一个「spec 容器文件」时 keep_all 会互相连带**：
    #      下一轮若发现本文件已无 diff，先 `git log -3` 看是不是已被别人连带带上去了，
    #      不要盲目重跑同一个 spec、也不要据此怀疑归属判定。
    {"file": ".workbuddy/tools/scoped_stage_by_marker.py", "keep_all": True, "gone": []},
    # 交付说明（用户点名的「改动方向 + 预期效果」）
    {"file": "outputs/货损核算-仪表盘视觉重做-2026-09-18/08-仪表盘视觉重做-交付说明-2026-09-18.md",
     "new_file": True, "gone": []},
    # 改前 / 改后 / 下半屏 / 主图特写 / 深色主题 五张本地预检证据
    # 🔴 PNG 必须标 binary，否则 utf-8 解码会炸掉整个 spec
    {"file": "outputs/货损核算-仪表盘视觉重做-2026-09-18/01-改前-仪表盘-本地预检.png",
     "new_file": True, "binary": True, "gone": []},
    {"file": "outputs/货损核算-仪表盘视觉重做-2026-09-18/02-改后-仪表盘-本地预检.png",
     "new_file": True, "binary": True, "gone": []},
    {"file": "outputs/货损核算-仪表盘视觉重做-2026-09-18/03-改后-仪表盘-下半屏.png",
     "new_file": True, "binary": True, "gone": []},
    {"file": "outputs/货损核算-仪表盘视觉重做-2026-09-18/04-改后-主图特写.png",
     "new_file": True, "binary": True, "gone": []},
    {"file": "outputs/货损核算-仪表盘视觉重做-2026-09-18/05-改后-深色主题.png",
     "new_file": True, "binary": True, "gone": []},
    # 生产真机截图（68/68 那一次）
    {"file": "outputs/货损核算-仪表盘视觉重做-2026-09-18/06-生产真机-仪表盘.png",
     "new_file": True, "binary": True, "gone": []},
    {"file": "outputs/货损核算-仪表盘视觉重做-2026-09-18/07-生产真机-数据填报.png",
     "new_file": True, "binary": True, "gone": []},
])

# ── v187：预报「改单网格」汇总列序对齐汇总表 ─────────────────────────────
# Forecast.vue 同时含本轮（v187 列序/口径）与并发会话的在途 hunk（loadEditGrid 同源合并、
# .imp-errs 规则换位、两处空行）⇒ 用 exclude_hunks 黑掉在途 old_start，其余全归本轮。
# ⚠️ exclude_hunks 用的是 **HEAD 坐标的 old_start**，HEAD 一变就要重新取（本次 8 个）。
SPEC_FE_V187 = ("fe", [
    {"file": "hergent-cn-v2/src/pages/Forecast.vue",
     "exclude_hunks": [101, 2691, 2693, 2704, 2706, 7849, 7864, 8233],
     # 旧编辑表头「金额」标签必须消失（用户投诉的正是它把口径算成了别的量）
     "gone": ['calc-th amount">金额']},
    # 本轮新增的真机探针（HEAD 无 → new_file）
    {"file": ".workbuddy/tools/forecast-edit-grid-v187-verify.js", "new_file": True, "gone": []},
    # 本工具自身（新增上面这组 spec）
    {"file": ".workbuddy/tools/scoped_stage_by_marker.py", "keep_all": True, "gone": []},
    # 交付说明与真机证据（PNG 必须标 binary，否则 utf-8 解码会炸掉整个 spec）
    {"file": "outputs/预报改单网格-列序对齐-2026-09-18/01-改单网格列序（合计紧挨报单单元·最终下单·下单金额厂价）-1800.png",
     "new_file": True, "binary": True, "gone": []},
    {"file": "outputs/预报改单网格-列序对齐-2026-09-18/02-交付说明.md",
     "new_file": True, "gone": []},
])

# ── v188：预报列名带单位（合计 → 合计(小单位)、件数(箱) → 合计(箱)）───────────
# 纯文案 + 列宽，逻辑零改动；Forecast.vue 里同时含并发会话的在途 hunk
# （srcByPid 合并 / extraByPid 累加 / .imp-errs 规则换位 / 三处空行）⇒ 黑掉其 old_start。
# ⚠️ exclude_hunks 用 **HEAD 坐标的 old_start**：HEAD 一变必须重取（本次 8 个，
#    与 v187 那次的号完全不同 —— 因为 v187 提交后行号整体位移了）。
SPEC_FE_V188 = ("fe", [
    {"file": "hergent-cn-v2/src/pages/Forecast.vue",
     "exclude_hunks": [101, 2721, 2723, 2734, 2736, 7881, 7896, 8265],
     # 旧列名必须消失（裸「合计」/「件数(箱)」若回来就是回退）
     "gone": ["label: '件数(箱)'", 'calc-th boxes">件数(箱)', 'edit-summary">合计 <b>']},
    # 本轮同源更新过的真机探针（v188 加了 H 段「查看态表头」与 B6/H4「表头不折行」判据）
    {"file": ".workbuddy/tools/forecast-edit-grid-v187-verify.js", "keep_all": True, "gone": []},
    # 本工具自身（新增上面这组 spec）
    {"file": ".workbuddy/tools/scoped_stage_by_marker.py", "keep_all": True, "gone": []},
    # 交付说明与真机证据（PNG 必须标 binary，否则 utf-8 解码会炸掉整个 spec）
    {"file": "outputs/预报列名带单位-2026-09-18/01-查看态（只读汇总表）列名-合计小单位-合计箱-1800.png",
     "new_file": True, "binary": True, "gone": []},
    {"file": "outputs/预报列名带单位-2026-09-18/02-改单态（编辑网格）列名同步-1800.png",
     "new_file": True, "binary": True, "gone": []},
    {"file": "outputs/预报列名带单位-2026-09-18/03-交付说明.md",
     "new_file": True, "gone": []},
])

"""v189（2026-09-18）：合计(箱) = 合计(小单位) ÷ 规格 —— 修「规格」取法 + 合计行同源 + 推送箱口径。

Forecast.vue 是**多会话共享文件**，本轮只认领 23 个 hunk，排除并发会话的 8 个在途 hunk。

🔴 **坐标一律取 `git diff -U0`** —— 本工具 `parse_hunks()` 就是跑 `-U0`（见其实现）。
   我曾按 `-U3` 取号（`-99/2730/2742/7890/7904/8274`）写进黑名单，干跑立刻报
   「黑名单里有不存在的 hunk」：`-U3` 会把相邻的小改动**合并成一个 hunk**，而 `-U0` 会拆开，
   两套坐标不可混用。**取证粒度必须与工具一致**，否则表现为「明明看得见的 hunk 说它不存在」。

| old_start (-U0) | 内容（**别人的**，不归本轮） |
|---|---|
| 101  | 工具行后多一个空行 |
| 2732 | loadEditGrid：srcByPid 改「合并而非覆盖」+ 2026-09-13 注释 |
| 2734 | loadEditGrid：srcByPid 由覆盖改 `[...prevSrc, ...r.sources]` |
| 2745 | loadEditGrid：加单注释补「（同商品多行时累加）」 |
| 2747 | loadEditGrid：extraByPid 累加 + 引入 buildRowBase（v179 编辑态行底同源） |
| 7892 | 样式：`.imp-errs` 新增到 v179 段（上半） |
| 7907 | 样式：原 `.imp-errs` 从 P1-1 段删除（下半） |
| 8276 | 文件末尾多一个空行 |

⚠️ 判据：`git diff -U0 -- Forecast.vue | grep -c '^@@'` 应等于 **31**（23 本轮 + 8 在途）。
   若数字变了（别人又动了这个文件），**必须用 `-U0` 重取新坐标**，别沿用本表、更别用 `-U3`。
"""
SPEC_FE_V189_BOXES = ("fe", [
    {"file": "hergent-cn-v2/src/pages/Forecast.vue",
     "exclude_hunks": [101, 2732, 2734, 2745, 2747, 7892, 7907, 8276], "gone": []},
    # 本地断言：从源码抽 perCase 执行 + 与 git HEAD 上一版 rowBoxes 做前后对比（不另写拷贝）
    {"file": ".workbuddy/tools/forecast-boxes-caliber-check.js", "new_file": True, "gone": []},
    # 真机验收：改单元格但不保存，用「80÷40=2 箱 vs 旧口径 8 箱」做判别性断言
    {"file": ".workbuddy/tools/forecast-boxes-v189-verify.js", "new_file": True, "gone": []},
    # 本工具自身（新增 SPEC_FE_V189_BOXES + 注册）。实测本文件此刻只有**我这两处** hunk，
    #   故 keep_all 成立；⚠️ 但它是多会话共用的 spec 容器，别人的 keep_all 会连带把我这份
    #   spec 一起提交进 HEAD（v187 轮已实测过一次）—— 若下一次发现本文件已无 diff，
    #   先 `git log -3` 看是不是被别人连带带走了，不要盲目重跑。
    {"file": ".workbuddy/tools/scoped_stage_by_marker.py", "keep_all": True, "gone": []},
])

"""v190-wb-trend（2026-09-18）：经营工作台（/workbench, Workbench.vue）删除「近 7 天销售趋势」面板，
并**消除删除本身造成的空位** + 清掉残留死 CSS。1 个改动文件（Workbench.vue）+ 1 个新探针。

🔴 本轮的判别性风险**不在「删掉没有」，在「删完有没有留白」**：
   原布局 `today-panel{grid-column:span 8; **grid-row:span 2**}` + `trend-card{span 4}`，
   第 1 行由 today+trend 拼满，第 2 行 today 独自续占左 8 列、**右侧 4 列由 trend 顶住**。
   只删模板/脚本、不动布局 ⇒ 第 2 行右侧必留一块 4 列空洞。

🔴 **部署前实测到线上正是这个「半成品」状态**（另一个会话先做了一半）：
   · JS chunk 里 `近 7 天销售趋势` = 0、`trend-card` = 0 ⇒ 模板与脚本**已删**；
   · 但 CSS chunk 里**仍留着** `.trend-card[data-v-…]{grid-column:span 4}`（5 条死规则）；
   · 且 `.expiry-card` 仍只有 `grid-column:span 4`、无 `grid-row:span 2`。
   ⇒ 真机测得 today-panel 右边界 1204.7px、`.bento` 右边界 1680px ⇒ **空 475.3px**；
     `elementFromPoint` 在该空位命中 `.bento` 本身（`isBentoItself:true`）—— 空位坐实。
   本轮修后同一点位命中 `today-card`（`inToday:true`）、today 右边界 = 1680 = bento 右边界。
   ⚠️ 该对照（**同一点位、同分辨率**的命中目标从「容器」变「卡片」）是本轮最强的证据，
     比「宽度数字变大」有力得多 —— 但只有在改前**真的留了空**时才测得出来，
     所以别跳过「先跑一次改前探针」这一步。

改动要点（Workbench.vue，11 个 -U0 hunk）：
  1. 模板删 trend-card 整块（原 95-104 行）；
  2. 脚本删 `trend` / `trendMax` / `trendMaxLabel` / `barHeight`（**保留** `dashData`（KPI 与
     isEmptyTenant 在用）与 `fmt`（KPI 在用））；
  3. 样式删 `.trend-card` / `.trend-chart` / `.tc-bar-wrap` / `.tc-bar` / `.tc-label`
     + 两个 media 断点里的对应项。🔴 `.tc-` 前缀被 today-card 的 `.tc-body/.tc-title/
     .tc-text/.tc-acts` **共用**，删时必须逐个精确匹配，不能用前缀通配打死；
  4. 布局：`.expiry-card` 加 `grid-row:span 2`（拉满右侧两行，与 today-panel 的 span 2 对齐）；
     两卡各加 `:class="{'span-all': 对方不存在}"` ⇒ 四种显隐组合均无空位
     （生产实测当前租户 **expiryData 为空**，「预警缺失」这条分支就是实际生效的那条）；
  5. `@media(max-width:1200px)`（网格降为 6 列）里 `.expiry-card` 必须改成整行 ——
     它原为 `span 3`、与已删的 trend-card(`span 3`) 拼成一行，只剩自己会右侧空 3 列。

🔴 **本 spec 不动任何数据请求（用户原话要求「删除相关数据请求」，但这里的正确处置是「一个都不删」）**：
   该面板**没有独立请求** —— 它的 `trend` 来自 `/api/dashboard/today-profit` 的**同一个响应**，
   与 KPI 四个数（sales/profit/orders/payment）同源；后端 `server/routers/dashboard.py:77-102`
   一次返回 `{profit, sales, orders, payment, trend}`。且 `trend` 字段**仍被 `Dashboard.vue`
   （「经营趋势」页，路由 `/dashboard`）消费**。
   ⇒ 删请求会连带打掉 KPI 横条；删后端字段会打掉 /dashboard。故前后端**都不动**。

⚠️ 号冲突：`v190` 裸号已被并发会话占用（`fe-v190-caseprice` / `be-v190-gridfp`）。
   本 spec 带语义后缀 `-wb-trend` 区分。Workbench.vue 内注释写的是「v190」，与对方同号，
   但**文件不同**（Workbench.vue vs Forecast.vue）⇒ 追责按文件区分（同 v187 的处理）。
   ⚠️ 部署后才发现此冲突；改注释会连带改 scopeId ⇒ 必须重构建重部署，故本轮从简保留，
   下次改 Workbench.vue 时若顺手，可把注释放到与 spec 后缀一致。

⚠️ 未夹带：Workbench.vue 实测 11 hunk **全部**对应本轮这 8 处编辑（`-U0` 口径：53/73/95/179/
   391/393/395/422/429/431/435），无并发会话在途改动 ⇒ keep_all 成立。
   探针文件是新建（`new_file`）；本工具自身只有「新增 spec + 注册」两处（`keep_all`）。
"""
SPEC_FE_V190_WB_TREND = ("fe", [
    {"file": "hergent-cn-v2/src/pages/Workbench.vue", "keep_all": True, "gone": []},
    # 真机验收：① 面板零残留 ② 无异常 ③ 🔴 空位几何判据（expiry 底边对齐 + elementFromPoint
    #   命中卡片）④ 其余模块正常 ⑤ HG_SMOKE=1 时多页冒烟（chunk 因 scopeId 整体换名后引用完整性）
    {"file": ".workbuddy/tools/workbench-trend-removal-verify.js", "new_file": True, "gone": []},
    {"file": ".workbuddy/tools/scoped_stage_by_marker.py", "keep_all": True, "gone": []},
])

"""v190（2026-09-18）：预报改单网格「单价(厂价/箱)」支持手工录入 —— 录入箱价 → 保存时反推厂价写回商品档案。

后端 1 hunk（`products_grid` 补发 `factory_price`）+ 前端 11 hunk（Forecast.vue）+ 探针 + 交付说明。

🔴 **后端这个 hunk 是「根因」**：`/api/products/grid` 此前**不下发** `factory_price`，而前端
   `factoryPrice(r)` 优先读 `r.factory_price` ⇒ 永远回退进价。凡档案里「厂价 ≠ 进价」的商品
   （全量实测 288 个商品里 151 个有厂价，其中 **105 个有厂价、进价为空**），预警页的
   「单价(厂价/箱)」与报单金额都与后端算的对不上；且用户手工录入厂价回写档案后
   **页面自己读不回来** ⇒ 表现为「填了没生效」。前后端必须**同一个 spec 一起提交**，否则
   单提交一侧就有一态算错（前端白改、后端白改）。

🔴 **注释也进产物哈希（本轮实测踩到，别重犯）**：`@vitejs/plugin-vue` v5.2.4 生产态的
   scope id = `sha256(相对路径 + 源码全文)[:8]`（node_modules 里 `getHash(normalizedPath + source)`）。
   ⇒ 哪怕只改注释，产物里所有 `data-v-*` 都会变 ⇒ **md5 必然与旧包不同**。
   本轮我一度把「/tmp 隔离构建与线上 md5 不同」误判成「隔离目录的路径噪声」，真实原因正是
   我在部署后又订正了 3 行注释。判据：把 `sha256('src/pages/Forecast.vue' + 当前源码)[:8]`
   与线上包里的 `data-v-XXXXXXXX` 对比 —— 相等才说明线上包就是**当前源码**构建的。

Forecast.vue 是**多会话共享文件**，本轮只认领 11 个 hunk，排除并发会话的 8 个在途 hunk（全在
loadEditGrid 的 srcByPid/extraByPid/buildRowBase 那一段 + `.imp-errs` 样式换位 + 首尾空行）。

| old_start (-U0) | 内容（**别人的**，不归本轮） |
|---|---|
| 101  | 文件头多一个空行 |
| 2779 | loadEditGrid：srcByPid「合并而非覆盖」的注释 |
| 2781 | loadEditGrid：srcByPid 改 `[...prevSrc, ...r.sources]` |
| 2792 | loadEditGrid：加单注释补「（同商品多行时累加）」 |
| 2794 | loadEditGrid：extraByPid 累加 + 引入 buildRowBase（v179 编辑态行底同源） |
| 7952 | 样式：`.imp-errs` 新增到 v179 段 |
| 7967 | 样式：原 `.imp-errs` 从 P1-1 段删除 |
| 8336 | 文件末尾多一个空行 |

本轮认领的 11 个（874 / 937 / 978 / 2368 / 2432 / 2437 / 2806 / 2846 / 3168 / 6893 / 7839）：
表头悬停说明 · 该列改录入框 · 口径说明补录入 · `C_PRICE_INPUT` 哨兵 · `priceAuto`+归一化到分 ·
`pricePerCase`/`casePriceToFactory`/`pricePh`/`priceTitle`/`onCasePriceChange` · 编辑态行映射补
`factory_price` · 草稿键加 `factory_price`/`casePrice` · `saveEdits` 写回厂价 · 查看态行映射补
`factory_price` · 录入框样式。

⚠️ 判据：`git diff -U0 -- Forecast.vue | grep -c '^@@'` 应等于 **19**（11 本轮 + 8 在途）。
   数字变了（别人又动了这个文件）必须用 `-U0` **重取坐标**，禁用 `-U3`（会把相邻小改动并成
   一个 hunk，两套坐标不可混用 —— v189 已踩过一次）。
"""
SPEC_BE_V190_GRIDFP = ("be", [
    # 后端仓库本轮只有这一个文件一个 hunk（`factory_price` 下发）→ keep_all 拿到「== 工作区」自证
    {"file": "server/routers/data.py", "keep_all": True,
     # 回归判据：旧版 `purchase_price` **紧接** `safety_stock`（中间没有 factory_price）。
     # 若这个相邻关系又回来，说明「补发厂价」的修复被整体回退 —— 那前端所有单价又会退回进价算。
     "gone": ['"purchase_price": p.get("purchase_price") or 0,\n'
              '            "safety_stock": p.get("safety_stock") or 0,']},
])

SPEC_FE_V190_CASEPRICE = ("fe", [
    {"file": "hergent-cn-v2/src/pages/Forecast.vue",
     "exclude_hunks": [101, 2779, 2781, 2792, 2794, 7952, 7967, 8336],
     # 旧实现必须消失（回退即报）：旧表头（无悬停说明）、旧只读 span（编辑网格里已换成录入框）
     "gone": ['<th class="num calc-th price">单价(厂价/箱)',
              '<td class="num calc price" :data-r="ri"><span',
              '_fpTouched']},
    # 本轮同源更新过的真机探针（v190 加 I 段「单价录入链路」11 条 + J 段「价来自厂价」归因 2 条）
    {"file": ".workbuddy/tools/forecast-edit-grid-v187-verify.js", "keep_all": True,
     "gone": ["/tmp/fc_edit_v187.png"]},
    # 本轮新建：沙箱端到端（录入箱价 → 保存 → 复核档案厂价 + 字段级留痕）
    {"file": ".workbuddy/tools/forecast-caseprice-archive-v190-verify.js", "new_file": True, "gone": []},
    # 本工具自身（新增上面两组 spec + 注册）。实测此刻本文件**只有我这处** hunk，故 keep_all 成立；
    #   ⚠️ 但它是多会话共用的 spec 容器 —— 别人的 keep_all 会连带把我这份 spec 一起带进 HEAD
    #   （v187 轮已实测一次）。若下次发现本文件已无 diff，先 `git log -3` 看是不是被连带带走了。
    {"file": ".workbuddy/tools/scoped_stage_by_marker.py", "keep_all": True, "gone": []},
    # 交付说明与真机证据（PNG 必须标 binary，否则 utf-8 解码会炸掉整个 spec）
    {"file": "outputs/预报单价手工录入-2026-09-18/01-改单网格-单价可手工录入（第1行蓝框为手工价5760 vs 其余灰色自动价）-1800.png",
     "new_file": True, "binary": True, "gone": []},
    {"file": "outputs/预报单价手工录入-2026-09-18/02-沙箱端到端-保存后提示厂价写回1条.png",
     "new_file": True, "binary": True, "gone": []},
    {"file": "outputs/预报单价手工录入-2026-09-18/03-交付说明.md",
     "new_file": True, "gone": []},
])

# ── v191：「单价(厂价/箱)」改为**只在本期生效**（2026-09-18，用户拍板）──────────────────
#   口径变更：手工单价不再反推写回商品档案（那会改掉**所有期次**的金额），改为随报单落进
#   本期 `forecast_extra_qty.case_price`（唯一键含 产品×期次 ⇒ 天然按期次隔离）。
#   归属依据：**逐 hunk 打印首行核对**，不按行号猜。
SPEC_BE_V191_CASEPRICE = ("be", [
    # erp_db.py：11 个 hunk 里**我的只有 6 个** —— v108 建表加列 / case_price 列 /
    #   v190 迁移 / 惰性建表+兜底 ALTER / summary 两条 SQL 分支下发 case_price（2 个）。
    #   其余 5 个是**他人在途**（第 1400 行、v27 与 v161 迁移旁、alert_history_list、login_is_locked）。
    #   🔴 已实测「生产版 vs 工作区」**恰好只差我这 6 个 hunk** ⇒ scp 这两个文件是零夹带的。
    {"file": "server/erp_db.py",
     "exclude_hunks": [1400, 10946, 10961, 11378, 11381],
     # 回归判据：旧版「无日期窗口」分支的字段集里**没有** case_price
     "gone": ['final_qty_expr = "NULL AS final_qty, 0 AS extra_qty"']},
    # save-matrix 的行级 upsert：3 个 hunk **全属本轮**（该文件无他人在途改动）
    #   → keep_all 拿到「构造结果 == 工作区」自证
    {"file": "server/routers/forecast_submissions.py", "keep_all": True,
     "gone": ['"INSERT INTO forecast_extra_qty (period_start, period_end, product_id, product_name, unit, extra_qty) "']},
])

SPEC_FE_V191_PERIODONLY = ("fe", [
    # Forecast.vue：23 个 hunk 里**我的 16 个**；排除的 7 个是纯他人在途 ——
    #   101（工具栏某处）、2841/2843/2854（loadEditGrid 的 srcByPid 合并与加单注释）、
    #   8065/8080/8449（CSS，本轮一行没碰）。
    #   ⚠️ `-2856,2 +2853,21` 是**混合 hunk**：含我的 `casePriceByPid` 9 行
    #   + 他人在途的 v179 行底改造 12 行（后者**已在生产运行**）。hunk 粒度无法再拆，
    #   故整块认领 —— 对应提交信息里的「含他人在途改动」，**不冒认**。
    {"file": "hergent-cn-v2/src/pages/Forecast.vue",
     "exclude_hunks": [101, 2841, 2843, 2854, 8065, 8080, 8449],
     # 旧实现必须消失（回退即报）：
     "gone": ['casePriceToFactory',                    # 反推厂价的唯一实现已删（不再写档案）
              'batchFactoryPrice',                     # 写档案通道已摘除（本文件内零引用）
              '保存时同步写回商品档案的厂价',
              "'factory_price', 'casePrice']"]},       # 草稿键去掉 factory_price
    # 本轮同源更新过的真机探针（K 段：后端已下发 case_price + 未录入为 null 而非 0）
    {"file": ".workbuddy/tools/forecast-edit-grid-v187-verify.js", "keep_all": True, "gone": []},
    # 本轮新建：沙箱端到端（落本期 / 不改档案 / 回读 / 可撤销）
    {"file": ".workbuddy/tools/forecast-caseprice-periodonly-v191-verify.js", "new_file": True, "gone": []},
    # 本工具自身（新增上面两组 spec + 注册）
    {"file": ".workbuddy/tools/scoped_stage_by_marker.py", "keep_all": True, "gone": []},
    # 交付说明与沙箱证据（PNG 必须标 binary，否则 utf-8 解码会炸掉整个 spec）
    {"file": "outputs/预报单价只在本期生效-2026-09-18/01-改单网格-录入手工价（沙箱端到端）.png",
     "new_file": True, "binary": True, "gone": []},
    {"file": "outputs/预报单价只在本期生效-2026-09-18/02-交付说明.md",
     "new_file": True, "gone": []},
])

# ── v191b：「单价(厂价/箱)」留空 = **自动沿用上一期录入的价**（2026-09-18，用户拍板「直接延用，不加按钮」）──
SPEC_FE_V191B_INHERIT = ("fe", [
    # Forecast.vue：18 个 hunk 里**我的 11 个**；排除的 7 个是纯他人在途 ——
    #   101（工具栏）、2834/2836/2847（loadEditGrid 的 srcByPid 合并与加单注释）、
    #   8070/8085/8454（CSS：本轮一行没碰）。
    #   ⚠️ 黑名单必须是 **HEAD 坐标的 old_start**（`@@ -2834,0 +2875,2 @@` 取 **2834**，不是 2875）——
    #      本轮实测踩过：误填新侧行号 ⇒ 断言「黑名单里有不存在的 hunk」直接中止（守卫按预期生效）。
    {"file": "hergent-cn-v2/src/pages/Forecast.vue",
     "exclude_hunks": [101, 2834, 2836, 2847, 8070, 8085, 8454],
     # 旧文案必须消失（口径改了：留空不再等于「按档案厂价自动算」，而是「自动沿用上一期」）
     "gone": ['留空则按商品档案的厂价自动算',              # 旧表头 title
              '留空 = 按商品档案的厂价自动算',             # 旧 cross-amt-note
              '手工录入价（只在本期生效：本次报单按这个价算金额，不写回商品档案）']},  # 旧 priceTitle 分支
    # 主探针：本轮做了**选择器可见性修正**（隐藏的返利冲刺看板表抢先命中 ⇒ 18/30 假 FAIL）
    {"file": ".workbuddy/tools/forecast-edit-grid-v187-verify.js", "keep_all": True, "gone": []},
    # 本轮新建：沙箱沿用链端到端（三段）＋ 沙箱夹具（造往期录入价）
    {"file": ".workbuddy/tools/forecast-caseprice-inherit-v191b-verify.js", "new_file": True, "gone": []},
    {"file": ".workbuddy/tools/sandbox_extra_qty_fixture.py", "new_file": True, "gone": []},
    # 本工具自身（新增上面这组 spec + 注册）
    {"file": ".workbuddy/tools/scoped_stage_by_marker.py", "keep_all": True, "gone": []},
    # 交付说明与沙箱证据（PNG 必须标 binary，否则 utf-8 解码会炸掉整个 spec）
    {"file": "outputs/预报单价沿用上期-2026-09-18/01-改单网格-沿用上期价（沙箱）.png",
     "new_file": True, "binary": True, "gone": []},
    {"file": "outputs/预报单价沿用上期-2026-09-18/02-交付说明.md",
     "new_file": True, "gone": []},
])

# ── v191b 后端：summary 随行下发「最近一次录入价」及其期次（沿用链的数据源）──
SPEC_BE_V191B_INHERIT = ("be", [
    # erp_db.py：7 个 hunk 里**我的 2 个**（都在 forecast_submission_summary 内，纯新增）；
    #   排除的 5 个是纯他人在途（init_db、_safe_migrate 两处、alert_history_list、login_is_locked）。
    {"file": "server/erp_db.py",
     "exclude_hunks": [1400, 10958, 10973, 11390, 11393],
     "gone": []},
])

# ── v192：「到货周期」由「固定列=不可隐藏」改为**可隐藏**（2026-09-18，用户原话
#    「请把"到货周期"设置成可隐藏列」）──
SPEC_FE_V192_HIDECYCLE = ("fe", [
    # Forecast.vue：18 个 hunk 里**我的 11 个**（820/822 改单态列菜单、2302/2305/2309 冻结区宽度、
    #   2662 MASTER_COL_DEFS 加 hideable、2775/2777 isLockedCol、4320/4324/4325 canDeleteMaster）；
    #   排除的 7 个是纯他人在途 ——
    #     101（查看态列菜单里多出的一个空行）、2873/2875/2886（loadEditGrid 的 srcByPid 合并与加单注释）、
    #     8136/8151/8520（CSS：本轮一行没碰）。
    #   ⚠️ 黑名单 = **HEAD 坐标的 old_start**（`@@ -101,0 +102 @@` 取 **101**，不是新侧的 102）——
    #      本轮取证时把每个 hunk 的首几行内容一并打出来**逐条认归属**（技能 §5.18 三②），未再踩取号坑。
    {"file": "hergent-cn-v2/src/pages/Forecast.vue",
     "exclude_hunks": [101, 2873, 2875, 2886, 8136, 8151, 8520],
     # 旧实现必须消失（这五条正是本轮被替换掉的那一行/那段；0 命中已实测）
     "gone": ["for (const k of FROZEN_COLS) { if (k === key) break; x += colW(k) }",
              "function isLockedCol(key) { return key === 'name' || FROZEN_COLS.includes(key) }",
              "return (colW('seq') + FROZEN_COLS.reduce((s, k) => s + colW(k), 0)) + 'px'",
              '<button v-if="!c.fixed && c.deletable"',
              ':disabled="c.fixed"']},
    # 本轮新建：沙箱真机 41 项判据 + 出图脚本
    {"file": ".workbuddy/tools/forecast-hidecycle-v192-verify.js", "new_file": True, "gone": []},
    {"file": ".workbuddy/tools/v192-hidecycle-shots.js", "new_file": True, "gone": []},
    # 本工具自身（新增上面这组 spec + 注册）
    {"file": ".workbuddy/tools/scoped_stage_by_marker.py", "keep_all": True, "gone": []},
    # 交付说明与沙箱证据（PNG 必须标 binary，否则 utf-8 解码会炸掉整个 spec）
    {"file": "outputs/预报到货周期可隐藏-2026-09-18/01-列设置-到货周期复选框可用（沙箱）.png",
     "new_file": True, "binary": True, "gone": []},
    {"file": "outputs/预报到货周期可隐藏-2026-09-18/02-隐藏后-商品名称后直接是品牌（沙箱）.png",
     "new_file": True, "binary": True, "gone": []},
    {"file": "outputs/预报到货周期可隐藏-2026-09-18/02-交付说明.md",
     "new_file": True, "gone": []},
])

# ── v193：预报导入门禁 —— 没有**进行中（open）**的期次 ⇒ 前端置灰 + 后端 400 ──────
#   用户原话（2026-09-18）：「我们之前设计的流程是：用户必须先点击『新建期次』，之后才能进行
#   导入操作。但目前导入入口直接暴露在页面上，未新建期次也能使用，我实测点击后确实可以正常
#   导入，导致整个业务流程被绕过、逻辑混乱。」
#   🔴 判据取自项目内**用户拍板的既定方案**（不是我拍口径）：
#      `outputs/期次数据流程优化方案-2026-09-17/期次数据流程优化方案-2026-09-17.md`
#      §四.1「不是『必须先建期次』，而是『必须有一个「进行中」的期次』」。
#      ⚠️ 第一版按「有没有期次」实现（沙箱 6/6+8/8 全绿），查方案后才发现方向错、已推倒重做；
#         留档见 `outputs/预报导入门禁-必须先建期次-2026-09-18/04-交付说明.md` §2.1。
SPEC_FE_V193_GATE = ("fe", [
    # Forecast.vue：工作区共 **18 hunk**，我的 **11 个**，在途 **7 个**。
    #   我的（逐 hunk 打内容认过，不按行号猜）：
    #     12   gate-bar 模板（顶部常驻横幅）
    #     47   工具条「导入」按钮 :disabled + :title
    #     132  抽屉内 v180 警告块加 v193 注释
    #     651/654 空态三行 + 按钮组（无进行中期次时改指路「新建期次」）
    #     1983/1987 状态声明（openPeriodId / periodsLoaded）+ curOpenPeriodId 注释改写
    #     6469/6470 判据块 + openImport 硬守卫
    #     7625 loadPeriods 赋值
    #     8221 `.gate-bar` 样式
    #   在途（**纯他人**未提交改动）：
    #     101        纯空行 hunk（工具栏与「新建期次表单」之间多出的一个空行）——无法归属，
    #                排除零风险；与 v163/v191b/v192 三份 spec 的处理**一致**（同一处、同一判断）。
    #     2902/2904/2915  loadEditGrid 的 srcByPid 改「合并而非覆盖」+ 加单注释（2026-09-13 那批）
    #     8175/8190  `.imp-errs` 规则**搬家两半**（技能 §5.8：搬移必须两半一起排除）
    #     8559       纯空行 hunk（td.invalid 规则后多出的一个空行）
    #   ⚠️ 黑名单 = **HEAD 坐标的 old_start**（`@@ -2902,0 +2951,2 @@` 取 **2902**，不是新侧 2951）。
    {"file": "hergent-cn-v2/src/pages/Forecast.vue",
     "exclude_hunks": [101, 2902, 2904, 2915, 8175, 8190, 8559],
     # 旧实现必须消失（这三条正是本轮被替换掉的代码/注释，0 命中已实测）：
     #   ① 工具条旧导入按钮（**没有** :disabled 的那一版）—— 这就是用户实测点得动的那个入口
     #   ② 空态里那个「导入 Excel」按钮 —— 它把绕流程的入口**直接递到手上**
     #   ③ 旧注释里断言「归属链 = current → 兜底 default()」的那半句 —— 本轮把兜底删了
     "gone": ['<button class="btn btn-sm btn-ghost" @click="openImport" title="从 Excel 导入预报订单汇总表"><Icon name="upload"/> 导入</button>',
              '<button class="btn btn-ghost btn-sm" @click="openImport"><Icon name="upload"/> 导入 Excel</button>',
              '→ 兜底 forecast_period_default()），前端只能从 GET /periods 的']},
    # 本轮新建：沙箱四阶段端到端（A 6/6 · B 7/7 · C 8/8 · D 8/8 = 29/29）+ 出图 + 样本 + SQL 助手
    {"file": ".workbuddy/tools/forecast-import-gate-v193-verify.js", "new_file": True, "gone": []},
    {"file": ".workbuddy/tools/v193-import-gate-shots.js", "new_file": True, "gone": []},
    {"file": ".workbuddy/tools/make-fc-cross-sample.py", "new_file": True, "gone": []},
    {"file": ".workbuddy/tools/sandbox_sql.py", "new_file": True, "gone": []},
    # 本轮修的**基础设施缺陷**：`shutil.copy2` 不搬 uid/gid ⇒ 以 root 跑 `sandbox_tenant.py up`
    #   时新库属主 = root:root，而后端以 hergent 运行 ⇒ `attempt to write a readonly database`
    #   （接口 200、success:0，极易误判成业务失败）。修法＝属主跟着**源库**走。
    {"file": ".workbuddy/tools/sandbox_tenant.py", "keep_all": True, "gone": []},
    # 本工具自身（新增上面的 spec + 注册）
    {"file": ".workbuddy/tools/scoped_stage_by_marker.py", "keep_all": True, "gone": []},
    # 交付说明与沙箱证据（PNG 必须标 binary，否则 utf-8 解码会炸掉整个 spec）
    {"file": "outputs/预报导入门禁-必须先建期次-2026-09-18/01-期次已关闭-导入置灰且横幅提示（沙箱）.png",
     "new_file": True, "binary": True, "gone": []},
    {"file": "outputs/预报导入门禁-必须先建期次-2026-09-18/02-未建期次-导入置灰且空态指路（沙箱）.png",
     "new_file": True, "binary": True, "gone": []},
    {"file": "outputs/预报导入门禁-必须先建期次-2026-09-18/03-已建期次-横幅消失且导入恢复可用（沙箱）.png",
     "new_file": True, "binary": True, "gone": []},
    {"file": "outputs/预报导入门禁-必须先建期次-2026-09-18/04-交付说明.md",
     "new_file": True, "gone": []},
])

# ── v193 后端：删掉归属兜底 `forecast_period_default()` + 加 400 硬闸 / `/periods` 下发 open ──
SPEC_BE_V193_GATE = ("be", [
    # import_router.py：3 hunk 全是本轮的（删兜底 + 硬闸），无在途改动 → keep_all 拿「== 工作区」自证。
    #   闸门位置的两个前提（都已核过）：① `_execute_forecast_cross` 是预报导入**唯一**落库入口
    #   （`/preview` 只解析不落库、`/one-shot` 不产出 forecast_cross）；② 客户端**从不传 period_id**。
    {"file": "server/routers/import_router.py", "keep_all": True, "gone": []},
    # forecast.py：2 hunk 里**我的 1 个**（`/periods` 新增 `open` 字段）；
    #   排除的 606 是纯他人在途 —— 付款到账通知的 sender 展示名（"运营主管" → "经营副驾"）。
    {"file": "server/routers/forecast.py", "exclude_hunks": [606], "gone": []},
])

# ══════════════════════════════════════════════════════════════════════════
# Q29（2026-09-19）小程序自助改密 + 忘记密码自助重置 —— 后端
#
# 需求原话：「小程序需要支持自助改密和忘记密码自助改密，因为可能不会给
#   业务员/分销商/导购等分配网页登录权限，只允许登录小程序」
#
# 方案 = **管理员发一次性重置码**（用户在选项里选定）。核心收益：管理员全程
#   不知道员工最终设的密码 —— 此前唯一出路是管理员代改（= 管理员知道员工密码）。
#
# 🔴 本轮归属判定里最要命的一条 = **语义耦合**：
#   `routers/auth.py` 里我的新路由 `forgot_reset` 调用了 `_client_ip(request)`，
#   而这个函数在 HEAD 里**根本不存在**（`git show HEAD:server/routers/auth.py |
#   grep -c "_client_ip"` == 0）。它属于**并发的在途改动**（2026-09-12 的
#   「登录失败按 IP 计数可被 XFF 伪造绕过」修复）。
#   ⇒ 若按「只留我自己的 hunk」把 os=74/80 排掉，HEAD 会在调用处 **NameError**，
#     `/api/auth/forgot-reset` 一进来就 500。故这两个在途 hunk **必须一起带入**。
#   ⇒ 这也正是本工具「hunk 级归属」不能只看「谁写的」、必须看「谁依赖谁」的实例。
#
# gone 名单（旧实现必须消失，暂存版与工作区双向 0 命中）：
#   auth.py 那条旧 IP 写法 —— 它把**整个** X-Forwarded-For 头当 IP 存库。
SPEC_BE_V195_PWRESET = ("be", [
    # 本轮新建：重置码表 + 发码/换密/校验（主库 erp.db，理由见模块 docstring）
    {"file": "server/password_reset.py", "new_file": True, "gone": []},
    # 3 hunk **全部保留**（含 2 个在途）—— 理由见上方「语义耦合」。keep_all 顺带
    # 拿「暂存版 == 工作区」自证，避免我手工列名单时漏掉 os=74/80 而静默 NameError。
    {"file": "server/routers/auth.py", "keep_all": True,
     "gone": ['    ip = request.headers.get("X-Forwarded-For", request.client.host if request.client else "unknown")']},
    # 2 hunk 全是本轮的：
    #   246  CSRF_EXEMPT_PATHS 加 `/api/auth/forgot-reset` —— 🔴 漏了它必 403：
    #        免登录请求既无 Bearer 也无 CSRF cookie，会被 CSRF 中间件直接拒掉。
    #   1015 新增 `POST /api/users/{uid}/reset-code`（管理员发码，admin/boss）。
    {"file": "server/server.py", "keep_all": True, "gone": []},
    # core.py 共 **13 hunk**，我的只有 os=139（`_init_users()` 里补 `_pr_ensure(conn)`
    #   建重置码表）。其余 12 个属**并发的**「bcrypt2$ 密码哈希升级（解除 8 字符上限）
    #   + 会话空闲超时」在途工作，与本轮无关，一个都不带。
    #   ⚠️ 黑名单 = **HEAD 坐标的 old_start**。
    {"file": "server/core.py",
     "exclude_hunks": [6, 13, 16, 26, 28, 30, 37, 40, 53, 57, 187, 190],
     "gone": []},
])

# ══════════════════════════════════════════════════════════════════════════
# 员工账号映射缩进缺陷修复（2026-09-19）—— 后端
#
# 病灶：`erp_db.py::employee_account_map` 的 `return out` 缩进**落在 `for` 体内**
#   （2 个 tab）⇒ 第一次迭代就 return，函数**最多只产出 1 个员工**。
#   生产实证 tenant_1：SQL 命中 2 行（admin→员工1、boss→员工7）却只返回第 1 行
#   ⇒ 员工 #7（法人本人）在员工档案里显示「未开通」，而账号区**只在"已开通"时
#   才渲染** ⇒ 显示未开通 → 看不到账号区 → 开不出来 → 永远显示未开通（死循环）；
#   `salary_send.py:245` 同源调它 ⇒ 第 2 个人起工资条发不出去。
#
# 归属（逐 hunk 打印首行核对过，不按行号猜）：
#   erp_db.py 共 **6 hunk**，我的只有 **os=6054**（`return out` 去缩进 + 8 行理由注释）。
#   其余 5 个属**并发的在途工作**，一个都不带：
#     1400   products 建表 DDL：`),extra_json` → `,extra_json`（括号错位）
#     10958  dist_price 迁移登记**前移**
#     10973  同上的旧位置删除
#     11390  登录锁定改「用户名 / 来源 IP」双维度（常量定义）
#     11393  同上（函数体）
#   ⚠️ 黑名单 = **HEAD 坐标的 old_start**。
#   ⚠️ spec 名不带 v19x 版本号 —— v192/v196 已被并发会话占用，撞号会 grep 混淆。
SPEC_BE_EMPACC_MAP = ("be", [
    {"file": "server/erp_db.py",
     "exclude_hunks": [1400, 10958, 10973, 11390, 11393],
     "gone": []},
    # 本轮新建的回归断言（AST 提取真函数源码 + 临时 sqlite，不 import 真模块；
    # 反例自证过：指向旧缩进副本会 5 项 FAIL）
    {"file": ".workbuddy/tools/employee-account-map-regression.py",
     "new_file": True, "gone": []},
])

# 本工具自身：本轮只有「新增 spec + 注册」两处，全属本轮 → keep_all 拿「== 工作区」自证。
SPEC_FE_EMPACC_TOOL = ("fe", [
    {"file": ".workbuddy/tools/scoped_stage_by_marker.py", "keep_all": True, "gone": []},
])

# 同上的交付物：真机探针 + 诊断报告（已补「甲档实施结果」一节）+ 生产真机截图。
# 报告与截图都是**上一轮留下的未跟踪文件**，与本轮修复属同一件事，一起入库。
SPEC_FE_EMPACC_PAGE = ("fe", [
    {"file": ".workbuddy/tools/employee-account-map-page-verify.js", "new_file": True, "gone": []},
    {"file": "outputs/员工账号开通能力核查-2026-09-19/01-诊断报告.md",
     "new_file": True, "gone": []},
    {"file": "outputs/员工账号开通能力核查-2026-09-19/02-修复后-账号列已开通与账号管理区（生产真机）.png",
     "new_file": True, "binary": True, "gone": []},
])

# ══════════════════════════════════════════════════════════════════════════
# Q29（2026-09-19）小程序自助改密 + 忘记密码自助重置 —— 前端 / 小程序 / 工具
SPEC_FE_V195_PWRESET = ("fe", [
    # EmployeeArchive.vue：7 hunk，我的 5 个（1/2/4/5/6），在途 2 个（os=3/649）。
    #   我的（逐 hunk 读内容认过，不按行号猜）：
    #     185  账号区新增「生成重置码」按钮 + 码展示框（30 分钟有效文案）
    #     306  resetCode / resetCodeExp 状态
    #     386  resetEditForm 里清码（换人 / 重开弹窗即失效，避免发错人）
    #     549  issueResetCode + copyResetCode（含剪贴板失败的降级提示）
    #     730  .rc-tip/.rc-box/.rc-code/.rc-exp 样式
    #   在途：
    #     3     `page-hd` → `page-hd split`（模板侧）
    #     649   `.page-hd/.page-hd h2/.page-sub` 三行 CSS（全局层已有，删本地重复）
    #   🔴 这两半**必须一起排**（技能 §5.8「搬移要两半对称」）：只排 3 不排 649
    #     ⇒ 模板用了 `page-hd split` 而全局 CSS 里那个类还没落地，页头会掉样式；
    #     只排 649 不排 3 ⇒ 本地 CSS 被删而模板没改，同样掉样式。
    {"file": "hergent-cn-v2/src/pages/EmployeeArchive.vue",
     "exclude_hunks": [3, 649], "gone": []},
    # 本轮的**基础设施修复**：`down` 漏清 `password_reset_codes`（主库表、只有
    #   user_id 可定位）。真机探针点一次「生成重置码」就落一行，down 后 users 已删、
    #   码却留着 = **孤儿行**，而 ZERO_RESIDUE 仍报 true（复核清单里没有这张表）。
    #   补了删除 + 复核 + 存在性守卫（表由 ensure_tables 懒建）。
    {"file": ".workbuddy/tools/sandbox_tenant.py", "keep_all": True, "gone": []},
    # 本轮新建：真机探针（隔离沙箱 9997 克隆 tenant_1）A0~F2 共 24 条断言全绿。
    {"file": ".workbuddy/tools/employee-reset-code-v195-verify.js", "new_file": True, "gone": []},
    # 本轮新建：三层验证的另三个脚本（都是「可重跑」的，不是一次性探针）
    #   password-reset-verify.py          本地语义（mock core/fastapi + 临时 sqlite）27/27
    #   password-reset-prod-e2e.py        生产真实链路 E2E（服务器上跑，临时账号跑完即删）21/21
    #   miniprogram-password-pages-check.py 小程序静态核对（无 CLI 构建通道的替代）43/43
    {"file": ".workbuddy/tools/password-reset-verify.py", "new_file": True, "gone": []},
    {"file": ".workbuddy/tools/password-reset-prod-e2e.py", "new_file": True, "gone": []},
    {"file": ".workbuddy/tools/miniprogram-password-pages-check.py", "new_file": True, "gone": []},
    # 本工具自身（新增上面两个 spec + 注册）
    {"file": ".workbuddy/tools/scoped_stage_by_marker.py", "keep_all": True, "gone": []},

    # ── 小程序 ─────────────────────────────────────────────────────────────
    # app.json：2 hunk，我的 1 个（os=6 注册 password/forgot 两个新页面）；
    #   在途 os=9 是 `navigationBarTitleText` 改名「预报订单 → 小赫智体报单助手」，
    #   属「小程序改名与备案重提」那条线，**不带**。
    {"file": "forecast-order-miniprogram-20260812T023419087Z/miniprogram/app.json",
     "exclude_hunks": [9], "gone": []},
    # login.js 4 hunk 全是本轮的：
    #   os=18  进页先看 `fs_need_pwd_change` —— 首次改密没做完就杀进程重进时
    #          storage 里 token 还在，只看 token 就放行 = 强制改密这道闸被绕过
    #   os=52  goForgot() 跳忘记密码页
    #   os=84  消费后端 `require_password_change`（🔴 此前小程序**完全没读**这个字段，
    #          这道闸在小程序侧形同虚设）+ 原密码只放 app.globalData 不落 storage
    #   os=89  删掉旧位置的 track —— 它与 os=84 新增的那行**逐字相同**，属搬移
    #          （故 gone 不能写这句，会命中新行；工具的在途特征行断言已覆盖）
    {"file": "forecast-order-miniprogram-20260812T023419087Z/miniprogram/pages/login/login.js",
     "keep_all": True, "gone": []},
    {"file": "forecast-order-miniprogram-20260812T023419087Z/miniprogram/pages/login/login.wxml",
     "keep_all": True, "gone": []},
    {"file": "forecast-order-miniprogram-20260812T023419087Z/miniprogram/pages/login/login.wxss",
     "keep_all": True, "gone": []},
    # mine 页：新增「修改密码」入口（业务员/分销商/导购可能只登小程序）
    #   + logout 清 `fs_need_pwd_change`（换账号登录不能被上一个账号的标记拦住）
    {"file": "forecast-order-miniprogram-20260812T023419087Z/miniprogram/pages/mine/mine.js",
     "keep_all": True, "gone": []},
    {"file": "forecast-order-miniprogram-20260812T023419087Z/miniprogram/pages/mine/mine.wxml",
     "keep_all": True, "gone": []},
    {"file": "forecast-order-miniprogram-20260812T023419087Z/miniprogram/utils/track.js",
     "keep_all": True, "gone": []},
    # ⚠️ 以下两文件**整份在途**（属「小程序改名与已停售商品跳过」那条线），
    #    本 spec **完全不写进来** —— 不是 exclude 全部 hunk，而是根本不列：
    #    `pages/fill/fill.js`（5 hunk）、`project.config.json`（1 hunk，description 改名）。

    # 新页面（未跟踪 → new_file，各 4 个文件）
    {"file": "forecast-order-miniprogram-20260812T023419087Z/miniprogram/pages/password/password.js",
     "new_file": True, "gone": []},
    {"file": "forecast-order-miniprogram-20260812T023419087Z/miniprogram/pages/password/password.json",
     "new_file": True, "gone": []},
    {"file": "forecast-order-miniprogram-20260812T023419087Z/miniprogram/pages/password/password.wxml",
     "new_file": True, "gone": []},
    {"file": "forecast-order-miniprogram-20260812T023419087Z/miniprogram/pages/password/password.wxss",
     "new_file": True, "gone": []},
    {"file": "forecast-order-miniprogram-20260812T023419087Z/miniprogram/pages/forgot/forgot.js",
     "new_file": True, "gone": []},
    {"file": "forecast-order-miniprogram-20260812T023419087Z/miniprogram/pages/forgot/forgot.json",
     "new_file": True, "gone": []},
    {"file": "forecast-order-miniprogram-20260812T023419087Z/miniprogram/pages/forgot/forgot.wxml",
     "new_file": True, "gone": []},
    {"file": "forecast-order-miniprogram-20260812T023419087Z/miniprogram/pages/forgot/forgot.wxss",
     "new_file": True, "gone": []},

    # 交付物：真机截图（沙箱 9997，生产域名）必须标 binary，否则 utf-8 解码炸掉整个 spec
    {"file": "outputs/小程序自助改密与忘记密码-2026-09-19/01-员工档案账号区-生成前（位置与文案）.png",
     "new_file": True, "binary": True, "gone": []},
    {"file": "outputs/小程序自助改密与忘记密码-2026-09-19/02-生成重置码-六位码与有效期（真实生产沙箱）.png",
     "new_file": True, "binary": True, "gone": []},
    {"file": "outputs/小程序自助改密与忘记密码-2026-09-19/03-交付说明.md",
     "new_file": True, "gone": []},
])

# ══ v197：撤下「三步对账向导」+「催收跟进」独立成页 ══
# 用户决策（2026-09-19）：/reconciliation 页面撤下、催收独立成页、后端接口暂留不删。
# 依据（outputs/对账模块存废与AI归属评估-2026-09-19/）：
#   · 页面「系统应收余额」与匹配结果「系统算出」**不同口径**（客户 2870 同屏差 17.7 万）
#   · 上线以来 39 次访问全为查看、确认 0 次（audit_logs 0 条）
#   · 催收跟进是活的（514 次真实动作）→ 独立成页保住它
#
# ── 归属取证（基线 1501878；每个 hunk 都已打印首行逐条核对，不按行号猜）──
#   CommandPalette.vue   1 hunk **全部本轮** → keep_all
#   Workbench.vue        2 hunks **全部本轮**（催收待办 icon '账'→'催' + path）→ keep_all
#   modules.js           ⚠️ 9 hunks，本轮只 194（reconciliationApi 注释 + 为何不适合；
#                        该 hunk 把 1 行替换成 6 行）；在途 8 个（forecastApproveApi.periodId
#                        / productsApi.opts 透传 / importApi 注释与 template 的**搬家两半**
#                        —— 技能 §5.8：搬移必须两半一起排除）
#   Shell.vue            ⚠️ 12 hunks，本轮只 48（侧栏）/ 96（移动抽屉）；
#                        在途 10 个（⌘ K 徽标删除 / IdleTimeout 挂载 / clearChatCache /
#                        空闲自动登出 onIdleTimeout / .tb-copilot 与 .tb-cp-k 样式）
#   router/index.js      ⚠️ 5 hunks，本轮只 16（import 替换）/ 46（路由替换 + 旧链接 redirect
#                        + 撤下原因注释）；在途 2 个（ArchiveShell import 与 archive 嵌套路由）
#   Collections.vue      HEAD 里无 → new_file
#   Reconciliation.vue   整文件删除 —— **本工具不支持 deleted**，另用 `git rm` 单独暂存
SPEC_FE_V197_RECON_RETIRE = ("fe", [
    {"file": "hergent-cn-v2/src/components/CommandPalette.vue", "keep_all": True,
     # 命令面板里不该再有旧 id 与旧名（我在本文件没写引用旧名的注释，故 gone 可安全设）
     "gone": ["id: 'reconciliation'", "对账工作流"]},
    {"file": "hergent-cn-v2/src/pages/Workbench.vue", "keep_all": True, "gone": []},
    {"file": "hergent-cn-v2/src/api/modules.js",
     "exclude_hunks": [347, 351, 359, 362, 391, 402, 403, 434],
     # 本文件保留 reconciliationApi 定义本身（接口暂留），故 gone 不能设相关串
     "gone": []},
    {"file": "hergent-cn-v2/src/components/Shell.vue",
     "exclude_hunks": [17, 109, 141, 146, 187, 188, 193, 327, 330, 399],
     "gone": ['对账工作流', 'to="/reconciliation"']},
    {"file": "hergent-cn-v2/src/router/index.js",
     "exclude_hunks": [22, 53],
     # 只断言「指向组件的旧路由行」消失；redirect 行与注释里出现 'reconciliation' 是**刻意保留**的
     "gone": ["{ path: 'reconciliation', component: Reconciliation"]},
    {"file": "hergent-cn-v2/src/pages/Collections.vue", "new_file": True,
     # 新页不该再引对账 API / 不该有对账页那套文案
     "gone": ["对账工作流", "客户声称欠款金额", "reconciliationApi"]},
    {"file": ".workbuddy/tools/reconciliation-retire-collections-verify.js",
     "new_file": True, "gone": []},
    {"file": "outputs/对账撤下与催收独立-2026-09-19/01-催收跟进-独立页-1600.png",
     "binary": True, "new_file": True, "gone": []},
    {"file": "outputs/对账撤下与催收独立-2026-09-19/02-经营工作台待办-1600.png",
     "binary": True, "new_file": True, "gone": []},
    {"file": "outputs/对账撤下与催收独立-2026-09-19/03-移动端抽屉-390.png",
     "binary": True, "new_file": True, "gone": []},
    {"file": "outputs/对账撤下与催收独立-2026-09-19/01-交付说明.md",
     "new_file": True, "gone": []},
    # 本工具自身（新增上面这组 spec）
    {"file": ".workbuddy/tools/scoped_stage_by_marker.py", "keep_all": True, "gone": []},
])

# ══ v198（2026-09-19）员工档案补「主管」(supervisor) 角色 —— 纯前端 ══
# 病因 = **前后端角色清单漂移**：后端 `core._DEFAULT_PERMS` 有 8 个角色（v110 起含 supervisor），
#   而 `EmployeeArchive.vue` 的角色下拉（ROLE_OPTIONS）与中文名映射（ROLE_NAMES）**各只列了 7 个**
#   ⇒ ① 开不出新的主管账号（下拉里没有该角色）② 已是主管的账号在「账号」列显示裸英文 `supervisor`
#   （`roleName(r) { return ROLE_NAMES[r] || r }` —— 缺条目不报错，只是把英文原样吐出来，**静默失败**）。
# 后端**一行未改**：`staff_account_create` 与 `PUT /api/users/{uid}/role` 都不做角色白名单，
#   所以这是纯前端「发现性」缺陷 —— 能力在，界面上够不着。
# 归属依据（old_start **现取** `git diff -U0`，不照抄上一轮编号；HEAD 一变编号就整体位移）：
#   EmployeeArchive.vue 共 5 hunk：
#     307  本轮：ROLE_OPTIONS 补 `supervisor` 选项
#     521  本轮：ROLE_NAMES 补 `supervisor: '主管'`
#     740  本轮：`.df-role.r-supervisor` 色板（缺它则退回基础 teal，与 r-staff 撞色）
#     3    在途：`page-hd` → `page-hd split`（并发的「页头样式上提到全局」模板侧）
#     694  在途：删本地 `.page-hd/.page-hd h2/.page-sub` 三行 CSS（全局层已有）
#   🔴 3 与 694 **必须一起排**：只排 3 ⇒ 模板用 `page-hd split` 而本地 CSS 还在、全局层没落地；
#     只排 694 ⇒ 本地 CSS 被删而模板没改。两半对称才不留半成品。
SPEC_FE_V198_SUPERVISOR = ("fe", [
    {"file": "hergent-cn-v2/src/pages/EmployeeArchive.vue",
     "exclude_hunks": [3, 694], "gone": []},
    # 回归护栏：以**后端 `_DEFAULT_PERMS`** 为唯一权威源，核对四组（下拉值集 / 中文名键集 /
    #   CSS 色板 / 其它清单告警 + 跨页译名对照）。判别力自证：三份「各破坏一处」的副本分别
    #   6/8、6/8、7/8，好代码 8/8（rc=0 vs rc=1）。
    {"file": ".workbuddy/tools/role-registry-consistency-check.py", "new_file": True, "gone": []},
    # 真机探针：隔离沙箱 9997（克隆 tenant_1，7 名员工）走**真实 UI** 建 supervisor 账号，
    #   24/24 全绿（含「下拉含 supervisor」「徽标为中文主管」「背景 rgba(99,102,241,.14)」）。
    #   ⚠️ 它会写**主库 users**（staff_account_create 走 _master_db），跑完按 username 精确删。
    {"file": ".workbuddy/tools/employee-supervisor-role-verify.js", "new_file": True, "gone": []},
    # 上一轮（甲档）的核查报告：本轮补第六节「乙档实施结果」，并把遗留里的乙标记为已实施。
    #   两个 hunk（191 改写遗留一行 / 198 追加第六节）都是本轮 ⇒ keep_all。
    {"file": "outputs/员工账号开通能力核查-2026-09-19/01-诊断报告.md",
     "keep_all": True, "gone": []},
    # 真机截图（PNG 必须标 binary，否则 utf-8 解码会炸掉整个 spec）
    {"file": "outputs/员工账号开通能力核查-2026-09-19/03-修复后-主管角色可创建且徽标为中文（生产真机沙箱）.png",
     "new_file": True, "binary": True, "gone": []},
    # 本工具自身（新增上面这组 spec）
    {"file": ".workbuddy/tools/scoped_stage_by_marker.py", "keep_all": True, "gone": []},
])

# v199-ui（2026-09-19）：员工档案「登录账号」文案语义化（丙）+ 开账号 / 改角色两处后端白名单（丁）
#   + 角色清单跨面漂移收敛 + 预报主表整页崩溃（unitCount 自递归）修复。
#
# ⚠️ 本 spec 是**在一个混着并发会话在途改动的工作区**里写的（Forecast.vue 一个文件 59 个 hunk）。
#    归属靠 hunk 的**内容特征**判定，不靠行号 —— 行号会随别人改动整体漂移。
#    我的 hunk 必含下列特征之一：constants/roles 的 import · roleName( · normRole ·
#    isCanonicalRole · ROLE_VIEW_TOKEN_NAMES · COLUMN_PERMISSIONS · ENTRY_ROLES。
#    🔴 其中 `os=2042` 是一个**不可拆**的 hunk：它同时含并发会话的 `blankCross()` / `hiddenUnits()`
#       与我的 `unitCount()` 修复（两者紧邻，落在同一个 hunk 里）⇒ **故意不认领**。
#       若认领，会把并发会话既有 spec 的黑名单全部打乱（它的在途 hunk 会因基线漂移整体失效），
#       代价远大于收益。我的修复已在工作区与生产产物里，会随那个 hunk 一起进版本库。
SPEC_FE_V199_ROLES = ("fe", [
    # 前端角色词汇的**唯一来源**：8 个后端规范角色 + 4 个历史视图令牌 + normRole 归一
    #   + canUseMiniProgram（「能进小程序」的判据与后端有 data/chat 权限者对齐）。
    {"file": "hergent-cn-v2/src/constants/roles.js", "new_file": True, "gone": []},

    # 丙：文案语义化（小程序账号 → 登录账号）+ 角色下拉加适用端标注。
    #   两个在途 hunk 留给并发会话：
    #     os=3   「page-hd」→「page-hd split」（布局改造，非本轮）
    #     os=702 删本地 .page-hd/.page-hd h2/.page-sub 三条 CSS（同上，样式上提全局）
    {"file": "hergent-cn-v2/src/pages/EmployeeArchive.vue",
     "exclude_hunks": [3, 702],
     "gone": ["维护员工底薪与小程序权限", "小程序账号", "小程序权限"]},

    # 漂移收敛：ROLE_LABELS/BIZ_ROLES 删除、COLUMN_PERMISSIONS 与 ENTRY_ROLES 改用规范角色名、
    #   canSeeCol 未知角色不隐藏、bizRole 默认 owner → boss。
    #   ⚠️ 另 50 个 hunk 是在途改动（v199 / v199b 客户列隐藏名册 + v196 只发改动行等），**不是本轮**，
    #      逐个核对过内容；名单见下方列表（含不可拆的 2042，见文件顶部说明）。
    {"file": "hergent-cn-v2/src/pages/Forecast.vue",
     "exclude_hunks": [115, 2042, 2429, 2434, 2682, 2883, 2887, 2949, 2951, 2962,
                       3044, 3049, 3120, 3214, 3238, 3239, 3243, 3315, 3353, 3380,
                       3390, 3391, 3407, 3442, 3444, 3448, 3811, 3820, 3866, 4052,
                       4095, 4226, 4617, 4645, 4860, 4863, 4866, 4867, 4945, 4981,
                       5020, 5041, 5056, 5060, 5063, 5087, 7046, 8267, 8282, 8661],
     "gone": ["const BIZ_ROLES", "const ROLE_LABELS = { owner",
              "dist_price: ['owner'", "ENTRY_ROLES = ['owner'"]},

    # 小程序侧：ROLE_TEXT 补齐 driver/guide/staff，accountant「财务」→「会计」、sales「销售」→「业务员」
    #   （与网页端**逐字**一致）；roleText 不再回落成原值（静默失败载体）→ 显式 `未知角色( x )`。
    #   APPROVER_ROLES 保持原样（与后端 submission_summary 逐字一致），矛盾已写进注释待后端拍板。
    {"file": "forecast-order-miniprogram-20260812T023419087Z/miniprogram/utils/roles.js",
     "keep_all": True, "gone": ["'财务'", "'销售'", "ROLE_TEXT[role] || role"]},

    # 回归护栏：28 条硬断言（比上一版多 20 条）—— 下拉覆盖/纯净、前端两页面**不得自带角色表**、
    #   列权限与填报白名单必须是规范角色名、「标了小程序」集合 == 后端有 data/chat 权限的集合、
    #   译名逐字一致、白名单三处接线。判别力自证：5 份「各破坏一处」副本**全部 FAIL**。
    {"file": ".workbuddy/tools/role-registry-consistency-check.py", "keep_all": True, "gone": []},
    # 部署前差集核查：新增「同一 chunk 改名」识别（Vite 会给共享 chunk 挑某个成员模块的名字 ——
    #   本轮新增 constants/roles.js 后，283 kB 的 xlsx chunk 从 arrival-* 改名为 roles-*）。
    {"file": ".workbuddy/tools/dist_normalized_diffcheck.py", "keep_all": True, "gone": []},
    # 自递归扫描（新）+ 它的判别力自证（新）：3 反例必 FAIL、2 正例（带出口的合法递归）必 PASS。
    {"file": ".workbuddy/tools/direct-self-recursion-check.py", "new_file": True, "gone": []},
    {"file": ".workbuddy/tools/self-recursion-discriminate.py", "new_file": True, "gone": []},
    # hunk 索引表（新）：在几百个脏项的长期工作区里区分「本轮」与「并发会话在途」。
    {"file": ".workbuddy/tools/hunk_index.py", "new_file": True, "gone": []},
    # 真机探针（新，18/18）+ 截图脚本（新）+ 临时令牌 helper（新，插/删/回读计数）。
    {"file": ".workbuddy/tools/role-v199-ui-verify.js", "new_file": True, "gone": []},
    {"file": ".workbuddy/tools/role-v199-shots.js", "new_file": True, "gone": []},
    {"file": ".workbuddy/tools/probe_token.py", "new_file": True, "gone": []},

    # 交付报告 + 两张生产真机截图（PNG 必须标 binary，否则 utf-8 解码会炸掉整个 spec）
    {"file": "outputs/角色清单收敛与预报页崩溃修复-2026-09-19/01-交付报告.md",
     "new_file": True, "gone": []},
    {"file": "outputs/角色清单收敛与预报页崩溃修复-2026-09-19/01-预报主表-已恢复正常渲染（生产真机）.png",
     "new_file": True, "binary": True, "gone": []},
    {"file": "outputs/角色清单收敛与预报页崩溃修复-2026-09-19/02-员工档案-登录账号文案（生产真机）.png",
     "new_file": True, "binary": True, "gone": []},

    # 本工具自身（新增上面这组 spec）
    {"file": ".workbuddy/tools/scoped_stage_by_marker.py", "keep_all": True, "gone": []},
])

# v199-ui 后端：角色白名单（丁）—— 判据只写一份（core.py），三处接线。
#
# ⚠️ 这个仓库同样是长期脏工作区（13 个脏项里只有 4 个是本轮）。归属判据：
#   · core.py  → 只认领含 `def normalize_role(` 的那一个 hunk（其余是并发会话的
#                 bcrypt2 预哈希 / 会话空闲超时等）
#   · server.py → 整个文件的 diff 都是本轮（update_user_role 三行改写）⇒ keep_all 自证
#   · erp_db.py → 只认领 staff_account_create 里 INSERT 紧邻的第二道闸
#   · forecast_submissions.py → 两个 hunk：docstring 改「开登录账号」+ 角色白名单
SPEC_BE_V199_ROLEWL = ("be", [
    {"file": "server/core.py",
     "markers": ["def normalize_role(role, default=None):"],
     "gone": []},
    {"file": "server/server.py", "keep_all": True, "gone": []},
    {"file": "server/erp_db.py",
     "markers": ["角色白名单（第二道闸；第一道在调用入口"],
     "gone": ["为员工开小程序账号"]},
    {"file": "server/routers/forecast_submissions.py",
     "markers": ["为员工开登录账号：{employee_id",
                 "角色白名单（判据唯一来源 = core.normalize_role）"],
     "gone": ["为员工开小程序账号"]},
])

# v199-ui 记忆入库（2026-09-19）：把本轮的判据写进 ledger。
#
# ⚠️ `MEMORY.md` 与 `2026-09-19.md` **同时含并发会话的追加**（同一个文件里的交错段落，
#    不可按 hunk 拆 —— 语义上也不该拆：它们记的是同一批事实的不同侧面）。
#    故本 spec 对这两个文件用 keep_all，并在提交信息里如实写明。
#    其余三个 topics 文件在开工时是干净的 ⇒ 100% 本轮改动。
SPEC_FE_V199_MEMORY = ("fe", [
    {"file": ".workbuddy/memory/topics/backend-auth.md", "keep_all": True, "gone": []},
    {"file": ".workbuddy/memory/topics/cross-domain-iron-laws.md", "keep_all": True, "gone": []},
    {"file": ".workbuddy/memory/topics/skill-routing.md", "keep_all": True, "gone": []},
    {"file": ".workbuddy/memory/MEMORY.md", "keep_all": True, "gone": []},
    {"file": ".workbuddy/memory/2026-09-19.md", "keep_all": True, "gone": []},
    {"file": ".workbuddy/tools/scoped_stage_by_marker.py", "keep_all": True, "gone": []},
])

# v201：员工薪酬信息「归属与访问控制」的**分析交付**（本轮不改任何代码）。
#
# 起因：用户问「把员工档案的『薪酬与账户』迁到算工资模块的可行性」。
# 核实后的三条反直觉结论（都写进了 present 断言，防止报告被改坏而无人察觉）：
#   ① **迁移不改变任何权限** —— `/api/employees`（`server.py:541`）与
#      `/api/payroll-workflow`（:315）、`/api/payroll*`/`/api/salary-*`（:371-375、:598-600）
#      **全部映射到同一个 `hr` 模块** ⇒ 换页面 = 换位置不换门。
#   ② 真缺口是**权限粒度只有「模块 × 动作」，没有字段级**（`core.py:450 _check_perm`）
#      ⇒ `GET /api/employees` 用 `SELECT *`（`erp_db.py:6247`）把 id_card/bank_account
#      一次性全给；敏感度天差地别的字段绑在同一行、同一接口、同一权限里。
#   ③ `_DEFAULT_PERMS` 里有 `hr` 的**只有 boss** ⇒ **会计两边都进不去**；
#      而「让会计算工资」正是迁移唯一能解决的真问题（解法＝新建 payroll 模块，
#      绝不可给 accountant 加 hr）。
#
# 🟢 时机（决定性）：生产 `hr_employees` 11 名员工，敏感字段**全部 0 行**、
#    `salary_details` **0 行** ⇒ 薪酬能力尚未投产，**现在是零数据风险窗口**。
#
# 产出只有一份分析报告 + 三个记忆文件的**纯追加**；故用 `keep_all` + `present` 正向锁死。
# ⚠️ 这四个文件里没有并发会话的在途改动（提交前逐文件核过 hunk 数均为 1）。
SPEC_FE_V201_PAYROLL_AUDIT = ("fe", [
    {"file": "outputs/员工薪酬信息归属与访问控制分析-2026-09-19/01-分析报告.md",
     "new_file": True, "gone": [],
     "present": ["迁移位置**不会改变任何人的访问权限**",
                 "把字段从 A 页搬到 B 页，门没换、钥匙没换",
                 "会计现在**两边都进不去**",
                 "整块能力尚未投产，现在是零数据风险窗口",
                 "L3 必须与 L2 分开"]},
    {"file": ".workbuddy/memory/2026-09-19.md",
     # 🔴 该文件是**共享追加日志**：并发会话的 v200「报单人门店配置收敛」段（新增行 1..111）
     #    与我的段（112..157）在文件末尾**连续追加**，`-U0` 合并成**一个纯插入 hunk**
     #    ⇒ 既不能 keep_all（会替对方提交），也不能 exclude_hunks（会把自己的段一起丢）。
     #    我的段在尾部 ⇒ 用 trim_plus_head 丢头 110 行、保尾 46 行。
     #    ⚠️ 边界数字怎么来的：工作区该标题行在 1455、HEAD 共 1344 行 ⇒ 它是我新增的第 111 行
     #    ⇒ 丢弃前 110 行。（**别用 `git diff | grep '^+' | grep -n` 数**：那会把 diff 的
     #    `+++ b/...` 头行算成第 1 行，序号整体 +1，照着填就会把自己的标题行也切掉 —— 实测踩过。）
     #    残留 1 个 hunk（对方的段）＝ 在途，留给它的作者提交。
     #    归属与切分是**两件事**：`own_hunks` 认领整个 hunk（本文件只有这一个），
     #    `trim_plus_head` 再从 `+` 侧切掉对方那 111 行。
     "own_hunks": [1344],
     "trim_plus_head": {1344: 110},
     "present": ["## 员工薪酬信息归属与访问控制（分析，未改代码）",
                 "迁移不改变任何权限",
                 "整块薪酬能力尚未投产，现在是零数据风险窗口",
                 "隔离单位是「字段组」不是「页面」"],
     "gone": []},
    {"file": ".workbuddy/memory/topics/backend-auth.md",
     "keep_all": True, "gone": [],
     "present": ["权限粒度实况：只有「模块 × 动作」，**没有字段级**",
                 "判据二：员工档案与算工资**是同一道门**",
                 "判据三：前端**不是**边界"]},
    {"file": ".workbuddy/memory/MEMORY.md",
     # 🔴 该文件同样混着并发会话的 v200 记忆（旧起 33 附近插了 4 行「报单人门店配置收敛」）。
     #    首版我用 `keep_all` ⇒ 工具照报「在途 0」并把它当成本轮 hunk（**keep_all 不分辨归属**）
     #    ⇒ 差点替对方提交。`keep_all` 的语义是「已核实该文件只有我的改动」这个**断言**。
     "exclude_hunks": [33],
     "present": ["权限与位置正交，隔离单位是「字段组」不是「页面」"],
     "gone": []},
    # 本工具自身（新增上面这组 spec）
    {"file": ".workbuddy/tools/scoped_stage_by_marker.py", "keep_all": True, "gone": []},
])

# v200：报单人门店配置入口收敛（移除「员工档案 → 门店」，仅保留「报单配置」）。
#
# 判据：两个入口写**两张互不感知的表**（员工档案写 `employee_stores`；报单配置写
#   `report_mapping`），而小程序「可见门店」只读 `employee_stores` ⇒ 在报单配置里配完
#   **不落到可见范围**（实测 tenant_1 两表零交集）。收敛 = 移除前端入口 + 读端取并集
#   + 让 `report_mapping` 成为真源 + `employee_stores` 退化为历史层。
#
# ⚠️ 前后端分属两个仓库 ⇒ 两条 spec **各自**提交。
#
# 🔴 erp_db.py 是**长期脏工作区**：31 个 hunk 里只有 14 个是本轮。
#    **归属判据绝不能靠标记串**：首版按标记串分类，把自己 3 个 hunk
#    （6259 `store_map→set` / 6460 `touched.add` / 16626 并集 SQL 正文）误判成在途，
#    而工具原有四条自证**全部照过**（见 present 字段的定义处注释）—— 静默少提交。
#    本名单是**逐 hunk 读正文**核出来的，并额外用 present 从正向锁死。
#    那 17 个在途 hunk 归属：v199 客户列隐藏名册（1482 / 15156 / 16138 / 16430 / 16433）、
#    v197 品牌待审 dismissed（8361~8407）、v125 登录锁定双维度（11398 / 11401）、
#    products.dist_price 迁移搬移（10966 / 10981）、products.extra_json 建表（1400）。
SPEC_BE_V200_STORESCOPE = ("be", [
    {"file": "server/erp_db.py",
     "exclude_hunks": [1400, 1482, 8361, 8368, 8369, 8386, 8402, 8405, 8407,
                       10966, 10981, 11398, 11401, 15156, 16138, 16430, 16433],
     "present": ["def employee_stores_prune_covered(employee_id=0):",
                 "def report_mapping_legacy_stores():",
                 "AND NOT EXISTS (SELECT 1 FROM report_mapping rm ",
                 'store_map.setdefault(s["employee_id"], set()).add(s["store_id"])',
                 "touched.add(int(eid))",
                 "可报门店数：历史层 ∪ 报单配置派生",
                 "查员工「可报门店」范围"],
     "gone": ["查员工门店。", "SELECT c.id, c.name FROM employee_stores es JOIN contacts c ON c.id=es.store_id WHERE es.employee_id=? AND c.type IN ('customer','both') ORDER BY c.id"]},
    {"file": "server/server.py",
     "present": ["/api/report-mappings/legacy-stores"],
     "keep_all": True, "gone": []},
])

SPEC_FE_V200_STORESCOPE = ("fe", [
    # ⚠️ 9 个 hunk 里 7 个是本轮；`page-hd split`（old_start 3）与删 3 条 `.page-hd`/`.page-sub`
    #   局部 CSS（708）属**前端 CSS 全局化**那条线 —— 判据：`.page-hd.split` 是**全局**类
    #   （`styles/variables.css:268`，且 `Archive.vue:83` 已在 HEAD 用它），且「移除门店按钮」
    #   动的是 `<td>`，与页头布局无关 ⇒ 与本次收敛无因果。留给它的作者提交。
    {"file": "hergent-cn-v2/src/pages/EmployeeArchive.vue",
     "exclude_hunks": [3, 708],
     "present": ['title="门店配置已收敛到「预报订单管理 → 报单配置」，此处仅展示数量"',
                 "门店配置入口已移出员工档案",
                 "分配门店」弹窗已移除"],
     # ⚠️ 判据用**规则本体**而不是 `df-store-list` 这个名字：删规则后原位留了一行
     #   说明注释，注释里点了名（首版按名字断言 ⇒ 假失败。断言要挑"只有真删掉才会消失"
     #   的文本，否则护栏会被自己的说明文案绊倒）。
     "gone": ["openStores", "saveStores", "storeForm", "allStores",
              ".df-store-list{display:grid", ".df-store-item input{accent-color",
              "分配门店 · "]},
    # 4 个 hunk 全属本轮（提示条 + ref + loadAll 拉取 + CSS）。
    {"file": "hergent-cn-v2/src/pages/ReportMapping.vue",
     "keep_all": True,
     "present": ["legacyStores", "legacy-bar", "历史门店授权"],
     "gone": []},
    # ⚠️ 10 个 hunk 里只有 2 个是本轮（`legacyStores` 新增 / `allStores`+`setStores` 移除）；
    #   其余 8 个是**同一文件里的在途改动**：forecastApproveApi 加 period_id（v191 期次过滤）、
    #   productsApi.bulkUpsert 透传 opts（v196 改单长超时）、以及两处**纯搬移**（注释与
    #   `importApi.template` 换位置）—— 逐个核对过内容，均与门店收敛无关。
    {"file": "hergent-cn-v2/src/api/modules.js",
     "exclude_hunks": [352, 356, 364, 367, 396, 407, 408, 439],
     "present": ["legacyStores: () => api('/api/report-mappings/legacy-stores')",
                 "「报单人的门店」唯一配置入口"],
     "gone": ["allStores: () => api('/api/forecast-submissions/all-stores')",
              "setStores: (eid, storeIds)"]},
    # 函数级验证（22 项）：AST 从 erp_db.py 抽**真实源码**，在内存 sqlite 上跑并集/prune/作用域。
    {"file": ".workbuddy/tools/v200-store-scope-verify.py", "new_file": True, "gone": []},
    # 真机 E2E（13/13）：旧入口消失 / 提示条渲染 / 新接口 200 / 零 pageerror。
    {"file": ".workbuddy/tools/v200-store-entry-e2e.js", "new_file": True, "gone": []},
    # 本工具自身（新增 present 正向断言 + 上面两条 spec）。
    {"file": ".workbuddy/tools/scoped_stage_by_marker.py", "keep_all": True, "gone": []},
])

# v200 交付说明 + 判据入库（记忆）。
#
# ⚠️ 本轮踩到**多会话并发写同一批记忆文件**，故这里逐个文件核过归属：
#   · `2026-09-19.md`（1344,0,110）→ **整块都是我的**（v201 会话已把自己的 46 行提交走）
#   · `MEMORY.md`（37,1,5）→ 我的（v199 那条行的 1→5 改写）；hunk 11 属 v199-ui，且**已提交**
#   · `cross-domain-iron-laws.md`（154,0,22）/ `skill-routing.md`（84,0,7）→ 整块都是我的
#   · 🔴 `forecast-order-domain.md`（1960,0,336）→ **合并 hunk**：
#       HEAD 只有 1960 行（整块 v199→v200 都未提交），其中前 259 行属「改单删列」那条序列
#       （v199 / v199b / v199c 段 + 它的「编号」行），我的 §v200 在**后 77 行**。
#       两者在文件里**连续**⇒ `-U0` 合成一个纯插入 hunk，`exclude_hunks` 用不了
#       ⇒ 用 `trim_plus_head` **丢头保尾**（这正是 v201 会话为同类场景新增的能力）。
#   · `2026-09-09.md` / `automations/*/memory.md` / `topics/backend-auth.md` 属并发会话，**不碰**。
SPEC_FE_V200_NOTES = ("fe", [
    {"file": "outputs/门店配置入口收敛-2026-09-19/01-交付报告.md",
     "new_file": True,
     "present": ["这两个入口写的根本不是同一张表", "读端取并集",
                 "employee_stores_prune_covered"],
     "gone": []},
    {"file": "outputs/门店配置入口收敛-2026-09-19/01-员工档案-可报门店只读列（生产真机）.png",
     "new_file": True, "binary": True, "gone": []},
    {"file": "outputs/门店配置入口收敛-2026-09-19/02-报单配置-历史门店授权提示条（生产真机）.png",
     "new_file": True, "binary": True, "gone": []},
    {"file": ".workbuddy/memory/2026-09-19.md", "keep_all": True,
     "present": ["## v200 —— 报单人门店配置收敛为单一入口",
                 "分 hunk 归属不能靠标记串"],
     "gone": []},
    {"file": ".workbuddy/memory/MEMORY.md", "keep_all": True,
     "present": ["🔴 **报单人门店配置收敛 v200**"],
     "gone": []},
    # `exclude_hunks: []` = 「该文件没有在途 hunk」的显式声明（此文件只有这一个合并 hunk，
    #   它的头 259 行不是我的 —— 靠 `trim_plus_head` 丢，不靠 exclude_hunks）。
    {"file": ".workbuddy/memory/topics/forecast-order-domain.md",
     "exclude_hunks": [],
     "trim_plus_head": {1960: 259},
     "present": ["## §v200 **已上线**：报单人门店配置收敛为单一入口"],
     "gone": []},
    {"file": ".workbuddy/memory/topics/cross-domain-iron-laws.md", "keep_all": True,
     "present": ["### E. 提交 / hunk 归属判定"],
     "gone": []},
    {"file": ".workbuddy/memory/topics/skill-routing.md", "keep_all": True,
     "present": ["v200-store-scope-verify.py", "`present` 正向断言"],
     "gone": []},
    # 本工具自身：新增上面这条 spec（`trim_plus_head` 由 v201 会话提供，非本轮流）。
    {"file": ".workbuddy/tools/scoped_stage_by_marker.py", "keep_all": True, "gone": []},
])

# v202：员工薪酬信息归属 · 追问「按租户差异」→ 查出角色权限表其实是**全平台一份**（分析，未改代码）。
#
# 起因：用户答复「我的公司会计**不能**算工资、也看不到别人的工资，但**有的客户**会计可以算工资」
#   ⇒ 把问题从「敏感信息放哪个页面」升级成「**角色 → 模块权限必须按租户分叉**」。
# 核查结论（都写进 present 断言，防止交付被改坏而无人察觉）：
#   ① **做不到**：角色权限表是「全平台一份」、存主库。给某客户开＝所有租户一起开。
#   ② 实测判据：同令牌 `X-Tenant-Id: 1/9/10` 打 `GET /api/role-permissions` → **返回逐字相同**。
#   ③ 权威锁主库：该前缀在 `_TENANT_MASTER_PREFIXES`（`server.py:50`）⇒ `set_tenant_context(None)`；
#      判据是**进程级全局** `core.ROLE_PERMS`（`:406`），而 `_check_perm`（`:450`）无视中间件已设好的租户。
#   ④ 租户库那份 `role_permissions` 是**死数据**（tenant_1 的 `库管` 既读不到也改不了）。
#      ⚠️ **必须定性为「能力缺失」而非「安全事故」** —— 读写都锁主库、内部自洽，**没有跨租户泄漏**。
#   ⑤ 连带：`field_permissions` 有表有 API 但**无业务消费方**；`user_tenants.role` 不参与鉴权。
#   ⑥ 修订方案：**P0** 权限表按租户分叉 → **P1** 拆 `payroll` 模块 → **P2** 补自我作用域。
#
# 产出：新增 02 修订文档 + 改写 01 的 3 处口径（指针 / 5.3 / 拍板第 1 项）+ 四个记忆文件。
# ⚠️ 提交前逐文件核过归属（见各处注释）—— `MEMORY.md` 与日志里**混着并发会话的在途改动**。
SPEC_FE_V202_TENANTPERM = ("fe", [
    {"file": "outputs/员工薪酬信息归属与访问控制分析-2026-09-19/02-按租户差异的权限设计（修订）.md",
     "new_file": True, "gone": [],
     "present": ["不是因为缺 UI",
                 "三次响应**完全一致**",
                 "既读不到、也改不了",
                 "是「能力缺失」",
                 "租户级差异无处安放",
                 "配置能改、但不生效",
                 "不做 P0，P1 的差异化对客户无效"]},
    # 01 的 4 个 hunk **全是我的**（指针块 + 5.3 两行改写 + 拍板第 1 项）。上一轮已随 2fa132a 提交过，
    # 本轮只动了口径 ⇒ keep_all + gone 锁住「旧口径必须消失」。
    {"file": "outputs/员工薪酬信息归属与访问控制分析-2026-09-19/01-分析报告.md",
     "keep_all": True,
     "present": ["本文第六节第 1 项的答复也已由该文承接",
                 "这是产品化的按客户差异需求"],
     "gone": ["会计终于能算工资（当前的真实业务缺口）",
              "现状**不能**（无 `hr`）。要 → 做 5.3(b)"]},
    # 🔴 共享追加日志：并发会话的 v201「保存后状态不可见」段（新增行 0..53）+ 我的段（54..94）
    #    在文件末尾**连续追加**，`-U0` 合成一个纯插入 hunk ⇒ 既不能 keep_all（会替对方提交），
    #    也不能 exclude_hunks（会把自己的段一起丢）⇒ **丢头保尾**。
    #    边界怎么来的：直接数 `+` 侧下标（**别用 `git diff | grep -n`** —— 会把 `+++ b/…` 头行
    #    算成第 1 行，序号整体 +1，照着填就会把自己的标题行也切掉；上一轮实测踩过）。
    #    我的 `---` 分隔线在 + 侧下标 54 ⇒ 丢前 54 行，保留 `---` 起 41 行。
    #    残留 1 个 hunk（对方的段）＝在途，留给它的作者提交。
    {"file": ".workbuddy/memory/2026-09-19.md",
     "own_hunks": [1500],
     "trim_plus_head": {1500: 54},
     "present": ["## 13:00 员工薪酬信息归属 · 追问「按租户差异」→ 查出权限表其实是**全平台一份**",
                 "别把它讲成泄漏",
                 "`库管` 是**孤儿角色**"],
     "gone": []},
    # 🔴 MEMORY.md 本轮 4 个 hunk：os=13/15 **是我的**（后端条目那条的改写）；
    #    os=37（`保存后状态不可见 v201`）与 os=42（编号撞车行）**是并发会话的** ⇒ 只能显式认领。
    {"file": ".workbuddy/memory/MEMORY.md",
     "own_hunks": [13, 15],
     "present": ["🔴🔴 **但「按租户差异」今天做不到**",
                 "2026-09-19 用户确认：这是本店有意的，不是缺陷"],
     "gone": []},
    {"file": ".workbuddy/memory/topics/backend-auth.md", "keep_all": True,
     "present": ["## 🔴🔴 角色权限表是「**全平台一份**」，不是租户级",
                 "（2026-09-19 实测确证，动手前必读）",
                 "不要讲成泄漏"],
     "gone": []},
    {"file": ".workbuddy/memory/topics/skill-routing.md", "keep_all": True,
     "present": ["§四之二「权限表是全平台一份、不是租户级」",
                 "配置作用域 ≠ 权威作用域"],
     "gone": []},
    # 本工具自身：新增上面这条 spec。
    {"file": ".workbuddy/tools/scoped_stage_by_marker.py", "keep_all": True, "gone": []},
])

# ══════════════════════════════════════════════════════════════════════════════
# v203：报单配置「对象类型」收敛为 门店 / 本人仓
#       用户原话：「在报单配置里有门店和客户两个入口，实际上门店和客户是一个意思，
#                  只保留门店这个入口吧」
# ══════════════════════════════════════════════════════════════════════════════
#
# 依据（这才是本轮真正的发现）：`report_mapping_refs()` 返回的对象池是
#   `contacts.type IN ('customer','both')` —— 「门店」和「客户」两个入口点开选的是**同一批
#   对象**，`counterparty_type` 从来只是个分类标签，不是"两种对象"。⇒ 合并零语义损失。
#
# ⚠️⚠️ **编号撞车修正**（初版误编为 v202）：收口时才发现 v202 已被**两个**会话占用 ——
#   · `ad34224`（已提交）：员工薪酬信息归属 / 租户权限分析
#   · 工作区在途：导入模板行序（`_safe_migrate('v202_forecast_import_sort_no')`）
#   我开工前那步「检查 v202 未被占」是**假阴性**：命令写成 `grep "v202\|v203"`，
#   zsh 下 `\|` 静默失效返回空（这条坑记忆里早记过，本次是**第三次**踩）。
#   🔴 两条硬教训：
#     ① 起号一律 `grep -e a -e b`（或 Grep 工具），**禁用 `\|`**；
#     ② 还要搜 `_safe_migrate('vNNN_...')` 这类**迁移名** —— 那是"某个号已被用掉"最硬的证据
#        （比注释、比 SPEC 名都硬，因为它已经在代码里生效）。
#   改号成本实测 = 源码 9 处注释 + 4 个工具文件改名 + 报告 + **一次重建重部署**；
#   且「只改注释」也会改变产物 hash 与体积（Forecast chunk 296.23kB ↔ 295.95kB）
#   ⇒ **不能以"只是注释"为理由跳过重建**（产物 mtime ≥ 源码 mtime 的门禁同样会拦）。
#
# 归属（逐 hunk 看内容核过）：erp_db.py 共 32 个 hunk，本轮 7 个 ——
#    6292（常量块 + `normalize_report_cp_type`，插在 report_mapping_list 前）
#    6300（list 过滤参数：「刻意不归一」注释）      6322（create 白名单 → 归一）
#    6374（update 归一 + **回写 data**）             6437（health 读端注释）
#    6464 / 6475（import 归一 + 失败文案）
#   其余 25 个属并发会话的在途线（导入模板行序 sort_no / 品牌归并 / 迁移等），
#   与 report_mapping 区域**零交集**（已逐个看内容确认）。
# 🔴 用 `own_hunks`（正向认领）而非 `exclude_hunks`：并发会话**正在活跃改这个文件**
#   （开工时 24 hunk → 收口时 32 hunk）。黑名单模式下它每新增一个 hunk，那个 hunk 就会被
#   当成「我的」而夹带进提交；正向认领天然免疫。代价是列表要按 old_start 写死 ——
#   但这恰好让「基线漂移」以 `missing` 断言的形式**当场暴露**，而不是静默夹带。
SPEC_BE_V203_CPTYPE = ("be", [
    {"file": "server/erp_db.py",
     "own_hunks": [6292, 6300, 6322, 6374, 6437, 6464, 6475],
     "present": ['REPORT_CP_TYPES = ("store", "self_warehouse")',
                 'REPORT_CP_ALIASES = {"customer": "store"}',
                 "def normalize_report_cp_type(t):",
                 "此处**刻意不归一**",
                 'data["counterparty_type"] = _ct',
                 'ctype_raw = (row.get("counterparty_type") or "store").strip()',
                 "对象类型无效（应为 门店 / 本人仓）"],
     # 旧白名单必须清零 —— 不清零说明「第二份判据」还在（本仓库最常见的复发形态）。
     "gone": ['if ctype not in ("store", "customer", "self_warehouse"):',
              "对象类型「{ctype}」无效(应为 store/customer/self_warehouse)"]},
])

# 前端：两个页面 + 4 个验证工具。
#   · `ReportMapping.vue`：11 个 hunk **全属本轮**（5 处文案 + types 数组 + typeLabel/typeClass
#     + openEdit 归一 + 2 处注释）⇒ 用 keep_all，自证「暂存版 == 工作区」。
#   · `EmployeeArchive.vue`：6 个 hunk 里我的 4 个（49/65/217/454 —— 把「门店/客户」文案统一
#     为「门店」，含只读列 title、说明注释、交接弹窗、代码注释）；
#     3 与 671 属**前端 CSS 全局化**那条在途线 —— 判据：`page-hd.split` 是全局类
#     （`styles/variables.css` 里已有），671 删的是 3 条 `.page-hd`/`.page-sub` **局部** CSS，
#     与「对象类型收敛」无因果。
SPEC_FE_V203_CPTYPE = ("fe", [
    {"file": "hergent-cn-v2/src/pages/ReportMapping.vue", "keep_all": True,
     "present": ["function normalizeCpType(t) { return t === 'customer' ? 'store' : t }",
                 "store: '门店', customer: '门店'",
                 "store: 'info', customer: 'info'",
                 "个门店未配置",
                 "尚未配置报单的门店（前 50）",
                 "对象类型填 store（门店）或 self_warehouse（本人仓）"],
     # 这 7 条全是「只有真删掉才会消失」的旧文案 —— 别拿类名当判据（删了规则还可能
     # 留一行说明注释点名，v200 为此吃过一次假失败）。
     "gone": ["{ v: 'customer', label: '客户' }",
              "customer: '客户'",
              "customer: 'purple'",
              "个门店/客户未配置",
              "尚未配置报单的门店/客户",
              "请给下列员工各建一条「门店 / 客户」映射",
              "store / customer / self_warehouse"]},
    {"file": "hergent-cn-v2/src/pages/EmployeeArchive.vue",
     "exclude_hunks": [3, 671],
     "present": ["为该员工配门店，配了即授权其小程序可报",
                 "在那里按「员工 × 门店」建一条报单映射",
                 "个报单配置（门店）",
                 "会导致这些门店无人报单"],
     "gone": ["门店/客户", "门店 / 客户"]},
    # 判据自证（25 项）：AST 就地从 erp_db.py 取真实源码 exec，**不 import erp_db**
    # （本地缺 cryptography，import 会连带拉起整条依赖链）。零依赖、可离线跑。
    {"file": ".workbuddy/tools/v203-cp-type-normalize-check.py", "new_file": True, "gone": []},
    # 生产只读验证（16 项）：🔴 必须 `set_tenant_context(1)` —— 不设则读错库，
    # 症状（映射 0 条 / 可见门店 0 家）与「数据被删光」一模一样（本轮实测误判过一次）。
    {"file": ".workbuddy/tools/v203-prod-verify.py", "new_file": True, "gone": []},
    # 影子库写路径验证（22 项）：`ERP_DB_PATH` 指到 /tmp + 租户副本，绝不碰生产库；
    # 核心断言是 update 的「归一必须回写 data」（不回写会被通用字段循环静默覆盖）。
    {"file": ".workbuddy/tools/v203-shadow-write-test.py", "new_file": True, "gone": []},
    # 真机 E2E（26/26，重部署后复跑仍 26/26）：类型控件只剩门店/本人仓。
    # 🔴 脚本**绝不点「保存」** —— 没有"无改动短路"分支，点下去就是真实生产写入。
    {"file": ".workbuddy/tools/v203-cp-type-e2e.js", "new_file": True, "gone": []},
    # 本工具自身：新增上面两个 spec（+ 编号撞车那两条硬教训）。
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
         "be-v184": SPEC_BE_V184, "fe-v184": SPEC_FE_V184,
         "be-v184b": SPEC_BE_V184B, "fe-v184b": SPEC_FE_V184B,
         "be-v184b2": SPEC_BE_V184B2, "fe-v184b2": SPEC_FE_V184B2,
         "be-v184c": SPEC_BE_V184C, "fe-v184c": SPEC_FE_V184C,
         "fe-v184c-docs": SPEC_FE_V184C_DOCS,
         "be-loss": SPEC_BE_LOSS, "fe-loss": SPEC_FE_LOSS,
         "fe-v185-nav": SPEC_FE_V185_NAV,
         "be-v185-trend": SPEC_BE_V185_TREND, "fe-v185-trend": SPEC_FE_V185_TREND,
         "fe-v184d": SPEC_FE_V184D,
         "fe-v184e": SPEC_FE_V184E,
         "fe-v185-dash": SPEC_FE_V185_DASH,
         "fe-v185-r7": SPEC_FE_V185_R7,
         "fe-v185-tabs": SPEC_FE_V185_TABS,
         "be-v186-directsale": SPEC_BE_V186_DIRECTSALE,
         "fe-v186-directsale": SPEC_FE_V186_DIRECTSALE,
         "be-v186-unify": SPEC_BE_V186_UNIFY,
         "fe-v186-unify": SPEC_FE_V186_UNIFY,
         "be-v186-covers": SPEC_BE_V186_COVERS,
         "fe-v186-covers": SPEC_FE_V186_COVERS,
         "fe-v187-dashboard": SPEC_FE_V187_DASHBOARD,
         "fe-v189-boxes": SPEC_FE_V189_BOXES,
         # v190-wb-trend：经营工作台删「近 7 天销售趋势」面板 + 消除删除造成的空位。
         #   ⚠️ v190 裸号已被并发会话的 fe-v190-caseprice 占用，故带 -wb-trend 语义后缀；
         #   Workbench.vue 内注释写「v190」与对方同号，但**文件不同**（Workbench.vue vs
         #   Forecast.vue）⇒ 追责按文件区分（同 v187 的做法）。
         "fe-v190-workbench-trend": SPEC_FE_V190_WB_TREND,
         # ⚠️ v187 号被并发会话占用（fe-v187-dashboard = 货损仪表盘），本 spec 加 -editgrid 后缀区分。
         #    代价：Forecast.vue 内注释里写的「v187」不带后缀，与对方同号 ⇒ 追责时要按文件区分。
         "fe-v187-editgrid": SPEC_FE_V187,
         # v188：预报列名带单位。本 spec 直接带语义后缀（labels），即便 v188 号被并发会话
         #   占用也能按后缀区分（v187 就是这么撞上的）。
         "fe-v188-labels": SPEC_FE_V188,
         # v190：预报改单网格「单价(厂价/箱)」手工录入。前后端**必须一起提交**（后端补发
         #   factory_price 是根因，缺它前端所有单价都会退回进价算）⇒ 两个 spec 一起跑。
         # 同样带语义后缀而非只写号码（v187/v188 号都被并发会话撞过）。
         "fe-v190-caseprice": SPEC_FE_V190_CASEPRICE,
         "be-v190-gridfp": SPEC_BE_V190_GRIDFP,
         "fe-v191-periodonly": SPEC_FE_V191_PERIODONLY,
         "be-v191-caseprice": SPEC_BE_V191_CASEPRICE,
         "fe-v191b-inherit": SPEC_FE_V191B_INHERIT,
         "be-v191b-inherit": SPEC_BE_V191B_INHERIT,
         "fe-v192-hidecycle": SPEC_FE_V192_HIDECYCLE,
         "fe-v193-gate": SPEC_FE_V193_GATE,
         "be-v193-gate": SPEC_BE_V193_GATE,
         # Q29（2026-09-19）：小程序自助改密 + 忘记密码自助重置（管理员发一次性重置码）。
         #   前后端**必须一起上**：小程序忘记密码页打的是后端的 `/api/auth/forgot-reset`
         #   （免登录），前端单独上线 = 页面在、接口 404；后端单独上线则无人调用。
         "be-v195-pwreset": SPEC_BE_V195_PWRESET,
         "fe-v195-pwreset": SPEC_FE_V195_PWRESET,
         "be-empacc-map": SPEC_BE_EMPACC_MAP,
         "fe-empacc-tool": SPEC_FE_EMPACC_TOOL,
         "fe-empacc-page": SPEC_FE_EMPACC_PAGE,
         # v197：撤下三步对账向导 + 催收跟进独立成页。
         #   ⚠️ 整文件删除的 Reconciliation.vue 不在本 spec 内（工具不支持 deleted），
         #      提交前须先 `git rm hergent-cn-v2/src/pages/Reconciliation.vue` 暂存它。
         "fe-v197-recon-retire": SPEC_FE_V197_RECON_RETIRE,
         # v198：员工档案补「主管」(supervisor) —— 纯前端发现性缺陷 + 角色清单回归护栏。
         "fe-v198-supervisor": SPEC_FE_V198_SUPERVISOR,
         # v199-ui：文案语义化（丙）+ 白名单（丁）+ 角色清单漂移收敛 + 预报页自递归修复。
         #   ⚠️ 前后端分属两个仓库 ⇒ 两条 spec **各自**提交；白名单的判据在 be、发现性在 fe。
         "fe-v199-roles": SPEC_FE_V199_ROLES,
         "be-v199-roles": SPEC_BE_V199_ROLEWL,
         # v199-ui 记忆入库（判据写进 ledger）。
         "fe-v199-memory": SPEC_FE_V199_MEMORY,
         # v200：报单人门店配置入口收敛（移除员工档案入口，仅留报单配置）。
         #   前后端分属两仓库 ⇒ 各自规格、各自提交。
         "be-v200-storescope": SPEC_BE_V200_STORESCOPE,
         "fe-v200-storescope": SPEC_FE_V200_STORESCOPE,
         # v201：员工薪酬信息「归属与访问控制」的分析交付（本轮**零代码改动**，
         #   只有分析报告 + 三个记忆文件的纯追加）。
         "fe-v201-payroll-audit": SPEC_FE_V201_PAYROLL_AUDIT,
         "fe-v202-tenantperm": SPEC_FE_V202_TENANTPERM,
         # v200 交付说明 + 判据入库（记忆）。⚠️ 并发会话在同一批记忆文件里有在途改动，
         #   本 spec 逐个文件核过归属（详见 SPEC_FE_V200_NOTES 上方注释）。
         "fe-v200-notes": SPEC_FE_V200_NOTES,
         # v203：报单配置「对象类型」收敛为 门店 / 本人仓（用户：「门店和客户是一个意思」）。
         #   ⚠️ 编号初版误编为 v202，收口时发现已被两个会话占用 ⇒ 改 v203（详见定义处注释）。
         "be-v203-cptype": SPEC_BE_V203_CPTYPE,
         "fe-v203-cptype": SPEC_FE_V203_CPTYPE}

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
    elif "own_hunks" in spec:
        # 显式认领名单（`exclude_hunks` 的对称面）。用于「该 hunk 属于我，但我只落它 `+` 侧
        # 的一部分」—— 即配合 `trim_plus_head` / `trim_plus` 使用。
        # 🔴 这里**不能**用 `keep_all` 代替：keep_all 带一条「暂存版 == 工作区」的断言，
        #    与任何 trim 天然矛盾（v201 实测直接炸在 `keep_all 但构造结果 != 工作区`）。
        #    keep_all 的语义是「整个文件都是我的」，而本场景是「整个 hunk 是我的、
        #    但其中一段是别人先追加的」—— 两件事，必须分开表达。
        mine = sorted(set(int(x) for x in spec["own_hunks"]))
        missing = [m for m in mine if m not in got]
        assert not missing, \
            "%s：own_hunks 里有不存在的 hunk %s（基线漂移？）" % (spec["file"], missing)
        deferred = [g for g in got if g not in set(mine)]
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
        # 🔴 binary=True：PNG/zip 等**不可按 utf-8 解码**的新文件。
        #   2026-09-17 实测踩过：交付目录里的截图会让 `open(..., encoding="utf-8")` 在
        #   `osition 0: invalid start byte` 上炸掉，整个 spec 连第一个文件都跑不完。
        #   二进制只做「暂存版 == 工作区（逐字节）」这一条自证 —— 它本来就没有 hunk、
        #   没有行数、也不该有 gone 文案检查，所以不需要任何别的分支。
        is_bin = bool(spec.get("binary"))
        # 🔴 binary=True：PNG/zip 等**不可按 utf-8 解码**的文件。
        #   2026-09-17 实测踩过：交付目录里的截图会让 `open(..., encoding="utf-8")` 在
        #   `osition 0: invalid start byte` 上炸掉，整个 spec 连第一个文件都跑不完。
        #   二进制只做「暂存版 == 工作区（逐字节）」这一条自证 —— 它本来就没有 hunk、
        #   没有行数、也不该有 gone 文案检查，所以不需要任何别的分支。
        #   ⚠️ 2026-09-18 起支持**已跟踪**二进制（此前只允许 new_file）：交付目录里的截图
        #      重拍后若不带上，交付目录就与当前页面对不上。二进制无 hunk ⇒ 归属只能是
        #      「整文件」故只接受 keep_all（拿 `out == wt` 逐字节自证），**不许**按 hunk 拆。
        assert not (is_bin and not (spec.get("new_file") or spec.get("keep_all"))), \
            "%s：binary 只能配 new_file 或 keep_all（二进制没有 hunk 可拆）" % path
        assert not (is_bin and spec.get("gone")), "%s：binary 不该有 gone 名单" % path
        wt = (open(os.path.join(REPO, path), "rb").read() if is_bin
              else open(os.path.join(REPO, path), encoding="utf-8").read())

        if is_bin:
            # 二进制**不取 HEAD 内容**（`git show` 走 text=True 会 UnicodeDecodeError），
            # 只探「HEAD 里有没有」来决定 new_file / keep_all 谁成立。
            has = subprocess.run(["git", "-C", REPO, "cat-file", "-e", "HEAD:" + path],
                                 capture_output=True).returncode == 0
            assert has != bool(spec.get("new_file")), \
                "%s：HEAD 里%s该文件，与 new_file=%s 不符（已跟踪的二进制请用 keep_all）" \
                % (path, "已有" if has else "没有", bool(spec.get("new_file")))
            head, hunks, mine, deferred, out = "", [], [], [], wt
        elif spec.get("new_file"):
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
            # trim_plus_head：只落 `+` 侧**后 (len-n) 行**，丢掉**前** n 行 —— `trim_plus` 的对称面。
            #   场景（v201 实测）：**共享文件**（`memory/2026-09-19.md` 这类）被两个会话在文件
            #   同一处连续追加，`git diff -U0` 把两段**合并成一个纯插入 hunk** ⇒
            #   无法用 `exclude_hunks` 排除（那会连自己的段一起丢）。本轮我的段在**尾部**、
            #   对方 v200 的段在前 111 行 ⇒ 丢头保尾。
            #   🔴 判据：`keep_all` 是「该文件只有我的改动」的**断言**，不是省事写法 ——
            #   本轮首版对 MEMORY.md 用了 keep_all，工具照报「在途 0」并把他人的 v200 记忆
            #   当成本轮 hunk（keep_all 不分辨归属）⇒ 差点替对方提交。
            trim_head = {int(k): int(v) for k, v in spec.get("trim_plus_head", {}).items()}
            assert set(trim_head) <= set(mine), \
                "trim_plus_head 必须落在本轮 hunk 里：%s" % sorted(set(trim_head) - set(mine))
            assert not (set(trim_head) & set(trim_plus)), \
                "同一 hunk 不能同时 trim_plus 与 trim_plus_head：%s" \
                % sorted(set(trim_head) & set(trim_plus))
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
                if os_ in trim_head:
                    n = trim_head[os_]
                    assert 1 <= n < len(plus), ("trim_plus_head 越界", os_, n, len(plus))
                    trimmed_lines += plus[:n]
                    plus = plus[n:]
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
            # 🔴 只对**非空白行**逐行计数 —— 空行在 HEAD 里遍地都是，对它做「计数相等」
            #   这个判据必然假失败（v201 实测：trim_plus_head 切掉对方段落头部时含 2 个空行，
            #   `HEAD=1344 vs 暂存=1389`，守卫当场炸，而改动完全正确）。
            #   判据要挑**有区分度**的行，否则护栏会被空白绊倒、进而被人绕着走。
            #   非空白行的计数相等仍能抓住两类真错：「多」＝原处没删干净又插了一份；
            #   「少」＝把 HEAD 原位那份也误删了。
            # 🔴 2026-09-19 v200 再一般化一步：**纯标点 / 纯符号行同样没有区分度** ——
            #   `'---\n'`（Markdown 分隔线）在 HEAD、我的插入段、被 trim 的对方段里都会出现，
            #   于是「暂存=17 HEAD=16」当场炸，而改动完全正确（我本来就新增了一条分隔线）。
            #   ⇒ 判据统一收敛为「**该行含字母 / 数字 / 汉字才算有区分度**」。
            #   ⚠️ 别把阈值放宽到「长度 ≥ N」——`## v200 …` 与 `---` 长度可以一样。
            for l in trimmed_lines:
                if not re.search(r"[0-9A-Za-z\u4e00-\u9fff]", l):
                    continue
                assert out.count(l) == head.count(l), \
                    "trim_plus 截掉的行计数漂移（HEAD=%d 暂存=%d）：%r" \
                    % (head.count(l), out.count(l), l[:60])

        inflight_sample = pick_inflight_sample(hunks, set(mine))

        outp = "/tmp/staged_" + os.path.basename(path)
        if is_bin:
            open(outp, "wb").write(out)
        else:
            open(outp, "w", encoding="utf-8").write(out)
        staged_blobs[path] = out

        # 混合 hunk 只落一半时，被丢弃的 `+` 侧（split_minus_only 整侧 / trim_plus 尾部）
        # 会在残留里**单独成一块** → 每处期望值 +1
        n_def = (len(deferred) + len(spec.get("split_minus_only", []))
                 + len(spec.get("trim_plus", {})) + len(spec.get("trim_plus_head", {})))
        resid = subprocess.run(["git", "-C", REPO, "diff", "-U0", "--no-index",
                                "--", outp, os.path.join(REPO, path)],
                               capture_output=True, text=True).stdout
        n_resid = len(re.findall(r"(?m)^@@", resid))

        print("=" * 74)
        print("%s" % path)
        print("  hunk 总 %d | 本轮 %d %s | 在途 %d %s" % (len(hunks), len(mine), mine, n_def, deferred))
        if is_bin:
            print("  二进制（%d 字节）：无行数/无 hunk，只做逐字节自证" % len(out))
        else:
            print("  行数 HEAD %d -> 暂存 %d (%+d) | 工作区 %d"
                  % (head.count("\n"), out.count("\n"),
                     out.count("\n") - head.count("\n"), wt.count("\n")))
        if spec.get("keep_all"):
            assert out == wt, "%s：keep_all 但构造结果 != 工作区（切片法有误）" % path
            print("  暂存版 == 工作区（该文件无在途改动，keep_all 自证 ✓）")
        if is_bin:
            assert out == wt, "%s：二进制暂存版 != 工作区（构造有误）" % path
            print("  暂存版 == 工作区（逐字节 ✓）")
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

        # 🔴 present：正向断言「本轮特征**必须**出现在暂存版里，且与工作区计数一致」。
        #   为什么必须有它（2026-09-19 v200 实测踩到）：exclude_hunks 模式下，若把**自己的**
        #   hunk 误写进黑名单，现有四条自证**全部照过** ——
        #     ① `missing` 只查「黑名单项是否存在」，自己那 hunk 当然存在；
        #     ② 并集覆盖断言恒真（黑名单∪其余 == 全集）；
        #     ③ `n_resid == n_def` 也成立（少落的那块正好算进"在途"数里）；
        #     ④ 在途零夹带抽样只验「没夹带进来」，不验「有没有漏掉自己的」。
        #   ⇒ 结果是**静默少提交**：提交里字段/函数缺一半，而工作区还留着，下一轮再混进别人那批。
        #   与 v199「MAP[x] || x 把缺配置显示成正常值」同族：判据只看一侧，缺项就隐形。
        #   present 是 `gone` 的**对称面**：一个验「该没有的没有」，一个验「该有的有」。
        for s in spec.get("present", []):
            a, b = out.count(s), wt.count(s)
            ok = a > 0 and a == b
            bad += 0 if ok else 1
            print("  %s 本轮特征 %-46s 暂存=%d 工作区=%d" % ("ok " if ok else "BAD", s[:46], a, b))

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
            # 已跟踪改动用 reset 清掉**旧索引态**；新文件 reset 是 no-op（无害）。
            git("reset", "-q", "HEAD", "--", path)
            # 🔴 str 传 text=True（走文本管道），bytes 必须 text=False —— 混用会让 PNG
            #   在 hash-object 里被当文本编码，静默写出**损坏的 blob**。
            #   反之 stdout 的类型也跟着 text 走：text=True → str，text=False → bytes，
            #   故取回时**两边都要兼容**（首版只写了 .decode()，直接 AttributeError）。
            res = subprocess.run(["git", "-C", REPO, "hash-object", "-w", "--stdin"],
                                 input=out, text=isinstance(out, str),
                                 capture_output=True, check=True)
            blob = (res.stdout if isinstance(res.stdout, str) else res.stdout.decode()).strip()
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
