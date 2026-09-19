# Hergent 项目长期记忆（索引）

> **本页只回答「该读哪一份」** —— 判据 / 触发词清单 / 全文一律在 `memory/topics/`，
> 动手前点进对应 topic 读。别在本页找判据。

## 一、路由（改哪个面 → 读哪份）

- **前端**（页面 / 样式 / 表格 / 探针）→ `topics/frontend-ui.md`
- **后端**（路由 / 数据 / DB / 权限）→ `topics/backend-invariants.md` + `backend-auth.md`
- **部署 / 构建 / 上线 / 回读 / 旧前端 `static/`** → `topics/deploy-ops.md`（🔴 **验「后端路由是否已删/已加」禁用 HTTP 状态码**：`rbac_middleware` 按静态前缀 `_PATH_MODULE_MAP` 在**路由之前**拦 ⇒ 匿名恒 401、无权限恒 403、未映射 403，**三者均与路由存在性无关**；权威判据＝**`/openapi.json`**（`app.routes` 镜像）+ 同前缀**成对**对照（200 正例 + 404 负例）；工具 ⭐ `.workbuddy/tools/backend-route-removal-verify.py`）
- **预报主表 · 期次 · 导入登记 · 到货周期** → `topics/forecast-order-domain.md`（🔴🔴 **导入门禁 → §v193**：判据＝「**进行中(open)** 期次」，**不是**「有没有期次」——期次全 closed 时两者结论**相反**，而那正是事故场景（154 个商品挂到已关闭的 9 期）· 判据**取自项目内既定方案**（`outputs/期次数据流程优化方案-2026-09-17/…§四.1`），**别自定口径** · 三处同源：前端 `canImport` ← `GET /periods` 新增 **`open`** ← 后端 `forecast_period_current()` ← 后端 **400 硬闸**（`_period_id<=0`）· 漏洞本体在后端：旧 `current() or default()` 的 `default()` 兜底＝最新期次**不限状态**；零期次落 `period_id=0`，**两种都照样写库** · 🔴 **`periodsLoaded` 标记必需**（`loadPeriods` 的 catch 是**静默**的 ⇒ 抖动会把入口**锁死**）· **`current` ≠ `open`**，不可互换（前者是展示口径、保留兜底）· 选「**禁用**」非「隐藏」 ｜ 🔴 **「到货周期」自 v192 起可被用户隐藏** → **§v192**：仍是固定列（仍钉左侧、仍不可删），只解掉「不可隐藏」这一条；前提是冻结区宽度改按**实际渲染的固定列**累加（不隐藏时与旧式逐字等价 ⇒ 零位移）· 列定义 `hideable` 例外通道 · 两个列设置菜单都别读 `c.fixed` · 判别点＝手动冻结列 left **348→256** ｜ 🔴 **表头右键菜单只在改单态渲染**（查看态右键＝处理器执行但零渲染），**验右键必须先进改单态**。🔴 **「单价(厂价/箱)」→ §v191 + §v191b**：v191 口径「**只在本期生效**」⇒ 落 `forecast_extra_qty.case_price`（唯一键含 产品×期次 ⇒ 天然隔离），**不写商品档案**；新值通道三处 DDL 兜底 · 后端 summary **不加 COALESCE**（null≠0 元/箱）· 前后端两处行映射取**非空值、不累加**。v191b 追加「**留空 = 自动沿用上一期录入的价**」**三级取值链**（本期手工 > 沿用 > 档案价）· 🔴 **沿用值绝不落库**（否则「没填」变「填过」+ 清空被写回 ⇒ 永远清不掉）· 沙箱必须先造往期行才有判别力 ｜ 探针：拦截**先核真实 URL**（`/api/forecast-submissions/*`）、期次 `summary.rows` 可能为 0（行来自导入登记）、挑只读表**必须要求可见**（隐藏的返利冲刺看板 `table.tbl` 会抢先命中）、主探针令牌要 boss/admin 且跑 tenant_1 需显式期次 ｜ 🔴🔴 **改单「删除列」/「保存失败」→ §v194 + §v194b（**两度修正，只认 v3**）→ ✅ **§v195 ＝ 甲档已执行并上线验收**（P0-1 后端止血 **940×/833×** + P1-2a 前端守卫；2026-09-19 凌晨）：**先分清是哪一种**——(a)「**页面出错了 / 表格没了 / 找不到保存按钮**」⇒ `selStats`(`3815`) 越界 ⇒ `App.vue:2` 的 `<ErrorBoundary>`（`position:fixed;inset:0`）**全屏接管** ⇒ **保存按钮根本不存在**（判据 `selRange.c1 > visibleCols.length + units.length - 1`；**普通单击不建选区**，只有拖选 / Shift+单击 / Shift+方向键 / 全选才建；`clampSelection`(4865) **只夹 `selected` 漏 `selRange`** 是第二条腿）——**这条真实、已复现，但不是用户那次**；(b)「**页面还在、点保存弹『保存失败（网络或服务器异常）』**」⇒ **真因**＝后端 `bulk_upsert_products`(`data.py:336`) 在**写事务内**调 `track_brand`(`erp_db.py:8417`)，而它**另开连接**写 `brand_pending` ⇒ **自锁** ⇒ 每行白等 `busy_timeout=5000`(`connection.py:228`) ⇒ **`N ≥ 4 行未注册品牌` 即 > 20 秒** ⇒ 前端 `AbortController`(`client.js:184` timeout=20000) 中止 ⇒ **nginx `499`** ⇒ `AbortError.message`(=`signal is aborted without reason`) 三个正则全不命中 ⇒ 落兜底文案。**判据**：① **等间隔精确 5 秒**的 `database is locked` 同 trace 重复＝**事务自锁**（`16:47:57→16:50:13` 28 条＝`5 秒 × N`；三次真实浏览器 `499`＝`16:48:12 / 18:24:38 / 22:59:55`，起点＝499−20s；我的探针 **4 行 ⇒ 正好 20 秒**，被 499 卡在阈值上）② **`499/502/504` 只在 nginx**、应用日志一行都不写 ⇒ **第 0 步必须查两层**，且 **nginx 是唯一带 UA 的层**（出口 IP 与探针相同 ⇒ **IP 分不出归属**）③ 品牌构成与库对账（`福宝 24` ↔ `products` 里 24 个；`brands` 仅 4 条）④ **异常条数要对上账**（全天 96 = 3×28 + 3×4）· **与「删列」无因果**（失败全落 `bulk-upsert`；`save-matrix` 真实浏览器 **0 次非 200**；三次跑在**三个不同前端构建**上）· **基线**：`12–16/Sep` 真实浏览器 save-matrix **0**、`17/Sep` **3 / 0**、`18/Sep` **0 / 3（全 499）** ⇒ **极低频路径** · **附带伤害＝一次点击 140 秒全租户写冻结**（97 次 locked 里 96 是 `track_brand`，另 1 是 `[Scheduler] Low stock check`）· **第二个坑**：`brand_pending` 13 条全 `resolved`/`backfill`、无 pending，`dismiss`(`8393-8394`) **只标 resolved、不加进 `brands`** ⇒ 「忽略」过的品牌每次复发，而新待审记录**恰因自锁写不进** ⇒ **队列看起来干净、实际永远收不到** · **修复（代码未动一行）**：**P0-1 `track_brand` 登记移出写事务**（循环内只用 `db.normalize_brand()`——返回值与 `track_brand` 相同 ⇒ 不改写入内容；`with` 退出后统一登记 ⇒ **140 秒 → 亚秒级**；⚠️ **后端契约级**，先核调用方）→ **P0-2 只提交脏行**（现每次全量 154 行；与 P0-1 **都要做**）→ P0-3 `bulkUpsert` 放宽超时 + 文案改可行动（**仅缓解**，不解决写锁）；P1-1 `kind` 分类器**必须判 `e.name`**；**P1-2 ＝ (a) 那组独立缺陷**；P2 品牌治理（修好 P0-1 会涌入 14 个品牌 · 需拍板归并）· 告警 · 部署留 `dist-<ts>.tar.gz`（**服务器不留历史 dist** ⇒ 无法事后核对版本）· 待查 `Sep 01` 63 次 locked（来源 `POST /api/rebate-rules`，**同族隐患，机制未核**）· ⚠️ **口径更正：旧的「每天 2000–23000 行 locked」是错的**，实测 `Aug 02`1 / `Sep 01`63 / `Sep 18`97 · 交付 `outputs/改单删列保存失败排查-2026-09-18/`（**02 = v3 报告** · 04 = 原始证据 · 03 = 崩页截图）· **待用户拍板 甲 最小止血 / 乙 止血+治本 / 丙 全做**）
- **返利 / 目标** → `topics/rebate-domain.md`
- **货损 / 效期**（`/loss` vs `/loss-accounting` 先分清）→ `topics/expiry-loss-domain.md`
- **报单 / 小程序 / 品牌** → `topics/miniprogram-and-brand-data.md`（🔴 **小程序隐私申报 / 改名同步 / 备案口径红线** → 该文件末节（2026-09-18）：官方「接口↔个人信息」映射表 · **多申报与少申报都判风险** · 小程序**无 CLI 构建部署**、只能静态核对 + 手点编译 · 登录页**禁止出现引向电商的词**）
- **副驾提示词 / 🔴 AI 在产品里的真实落点（算·录·判·说 四类分工）** → `topics/ai-copilot.md` 末节（🔴 **名带 `ai_` ≠ 用了 AI**：真调模型的只有 4 处，`ai_tools.py` 零模型调用、`ai_learning.py` 是**已接线的坏接口（2026-09-19 已删）** ——「死代码」是误判，别再沿用）｜**通知 / 工资条** → `notification-center.md`
- **IM 渠道** → `im-channels-v131.md`｜**业绩 / 提成 / 龙虎榜** → `sales-reports-and-operator-attribution.md`
- 🔴 **跨域铁律（触发词清单全文）→ `topics/cross-domain-iron-laws.md`** ← 动手前先扫一遍
- **对外材料**（BP / 路演 / 视频号 / 客户沟通 / 赛事报名）→ `outputs/德邻杯-AI创业大赛-2026-09-19/02-脱敏口径清单.md`（五条红线处置 · 金额→复杂度、绝对值→改善幅度 · 截图须用**演示租户**非生产打码 · BP 六页按**评委六问**设计）。赛事后材料一律沿用此口径，别各写一份

## 二、技能路由（37 条 user-level；`-frontend-*` 指新前端 hergent-cn-v2）

- 上线前端 / 后端 → `hergent-frontend-deploy-verify` / `hergent-prod-deploy-e2e`
- 在 hergent.cn 新增页面/模块 → `hergent-cn-v2-add-module`
- 改预报主表列 → `hergent-forecast-column-registry`｜Excel 导入认错列 → `hergent-import-mapping-confirm`
- 布局放不下 / 塌陷 / 浮层被压 / 控件没反应 → `-frontend-layout-capacity` / `-dom-structure-diagnosis` / `-zindex-diagnosis` / `-dead-control-diagnosis`
- 图表柱子没显示 / 颜色不对 / 验前端没镜像后端算法 → `hergent-chart-render-verify`
- 样式上提 / 对齐 WorkBuddy / emoji→线性图标 → `-css-globalize` / `hergent-workbuddy-ui-align` / `hergent-emoji-to-icon-sweep`
- 旧前端 `static/`（erp.hergent.cn）→ `hergent-frontend-add-module` / `hergent-vite-landing` / `hergent-frontend-fetch-consolidation`
- **小程序隐私申报 / 改名同步 / 提审前自查 → `hergent-miniprogram-privacy-audit`**（官方映射表 + 双向错误模型 + 无 CLI 验证）
- 隔离租户沙箱真机验证 → ⭐ `.workbuddy/tools/sandbox_tenant.py`（id ≥ 9997，只能服务器跑）
- 改生产库 / 租户库对账 / SQLite 改列 → `hergent-authorized-prod-data-write` / `hergent-tenant-schema-sync` / `hergent-sqlite-table-rebuild`
- 自注册 / 租户隔离 / 数据不更新 / 能力核对 → `hergent-tenant-isolation-audit` / `hergent-data-staleness-diagnosis` / `hergent-capability-reality-audit`
- **写操作报「保存失败/提交失败」（请求发出去了但没成功）→ `hergent-write-failure-diagnosis`**（三轴：**数这动作发了几个请求**（多阶段非事务 ⇒ 怕"改了一半"）· **失败文案是谁写的**（前端 `kind` 分类器在猜，界面「网络或服务器异常」多是兜底幻觉）· **后端该接口全部失败点**。🔴 **判据：等间隔精确 5 秒的 `database is locked` 同 trace 重复 ＝ 事务自锁**（`busy_timeout=5000`；本仓 `db/connection.py._sqlite_connect` 的重入分支给内层**新连接** ⇒ 事务内「另开连接」必自锁）· 🔴 **必须查两层日志**（应用层一行不写，`499/502/504` 只在 nginx）· 实证 2026-09-19 甲档：`track_brand` 移出写事务 ⇒ 28 行 **140.46s → 0.149s（940×）**。含六步取证法 + `journalctl` 时序还原 + 四个坑：循环上限<实际条数使决定性用例空转 · `console` 抓 Error 得 `JSHandle@error` · 本地时间 vs UTC `created_at` · zsh `grep "A\|B"` 静默失效）
- **给写入口加「前置条件门禁」**（「流程被绕过」/「没做 A 也能做 B」/「要和既定方案一致」）→ `hergent-write-entry-gate`
- 修改日志 / 口径不一致 → `hergent-page-change-log` / `hergent-rebate-caliber-consistency`
- Hermes 网关 / 副驾围栏 / 外部数据源 → `hergent-hermes-tenant-diagnosis` / `hergent-ai-card-protocol` / `hergent-external-data-source`
- **提交（脏工作区）→ `hergent-scoped-commit`**（先读文首「🧭 导航」）
- 业务 Excel→主表/模版 · 导入验证 → `hergent-excel-attachment-to-schema-design` / `hergent-forecast-import-verify`
- xlsx 补值不破公式 / 新产品流程 / WorkBuddy 勘察 → `local-xlsx-xml-minimal-write` / `product-dev-sop` / `workbuddy-*-internals`

**技能库待整理**：`hergent-prod-deploy-e2e` 已成杂物箱；巨型技能全无 `references/`；诊断族命名不统一。

## 三、战略 / 主体

- hergent.cn = AI 经营副驾（同源 erp.hergent.cn）。前端 hergent-cn-v2（Vue3+Vite+Pinia，仓库 `laozhangai-product`，生产 `/opt/hergent-cn-v2`）｜后端 hergent-erp（FastAPI+SQLite `:8700`）。desktop-app 冻结。
- 战略 = **不造 ERP**，坐客户 ERP 之上做分析/顾问/副驾；数据走 Excel/CSV 或连接器；订单 CRUD 冻结。护城河 = 配方算法 + 副驾交互。
- 🔴 **不做「一切皆插件」**：扩展作者是 **AI 代填**而非客户写码。顺序 P0-a → P0-b → P1 → P2 → P3。
- 主体 = 湖北省小赫智体数字科技有限公司（**经营范围无食品**），法人张俊峰，`91420606MAKF1YPG5Y`。用户 = 蒙牛低温奶经销商，不懂代码。北极星 = 加微信的经销商人数；脱敏红线：返利率 / 进货价 / 客户名 / 区域销量 / 不评厂家政策。

## 四、本机 zsh 坑

`grep "A\|B"`、`--include=*.py` **静默失效** → 用 Grep 工具或 `-e A -e B`｜写文件一律用 **Write**（heredoc 含 `${}` / 反引号会失败）｜给用户的 UI **数字必须带中文单位**（`pp` → 个百分点，详见 user-level 记忆）
