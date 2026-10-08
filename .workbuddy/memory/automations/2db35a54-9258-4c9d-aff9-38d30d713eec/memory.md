# 自动化：代码审查（2db35a54-9258-4c9d-aff9-38d30d713eec）

---

## ⚠️ 非审查记录：同日会话顺延（2026-10-05 · v377 预报汇总表「行选中/列选中」三轴选择，**已上线 + 已提交**）

> 🔴 **2026-10-05 11:1x 状态更新：v377 已上线并已受控提交**（`7fccebc` 代码 + `d7c2cf1` 文档）。
> 生产入口 `index-CHznNFH-.js` → **`index-DytyxoHe.js`**；`Forecast-DmByzzXg.js` md5 `5f217175…`
> 双侧一致。**下轮审查不要把 `Forecast.vue` 的 v377 段（`selAxis` / `onRowDown` / `onHeadDown` /
> `commitPendingEdit` / `rowBaseShown`）报成新问题** —— 它已过真机 A/B（AFTER 60/60）＋
> 「对已部署产物字节复跑同一探针 60/60」＋ 生效集差集（③ 回退风险 = 0）。
> 另：该次提交**同时**把 `Forecast.vue` 里 v331–v376「已上线未提交」的改动一并追进 HEAD
> （有意为之，理由写在 commit message 里），故 `git log` 里 v377 那一笔会显得很大。
> 其余文件的「已上线未提交」状态**未变** ⇒ 工作区依旧脏，勿据此误判。

本自动化当日 **02:00 的只读审查已正常产出**（见下方 2026-10-05 段，落 `docs/code-review/2026-10-05.md`）；
之后**同一天的人工会话继续推进**。本节只为避免下轮把「刚做的功能/刚修好的缺陷」当成新问题，**不是审查输出**。
详情见 `memory/2026-10-05.md` 的 **v377** 段、`topics/frontend-ui.md §v377`、
交付文档 `docs/UI-预报汇总表-行选中与列选中交付与验收-2026-10-05.md`。

- **主题（老板指令）**：给预报汇总表加「行选中 / 列选中」—— 点击非输入区选整行、竖向拖选多行、
  右键出行菜单；点表头选整列、横向拖选多列、表头/选中列右键出列菜单；并要求说明两轴**互斥/联动**、
  右键**触发区域与菜单项**、覆盖拖动起止/跨行跨列/**与单元格编辑输入态冲突**等边界。
  **只改 1 个文件**：`src/pages/Forecast.vue`（884,101 → 911,681 B）。
- **本轮闭环（下轮别再报为新问题）**：顺带修掉 4 个既有缺陷 —— ① `editColDescAt`/`colHeaderAt`
  **差一列**（右键「此列统计」报隔壁列、CSV/Markdown 表头整体错位）；② `ctxClear` 在加单/单价格
  **右键即崩**（`cross.units[ui]` 越界）+ 这两列复制/清空/粘贴静默无效；③ `selectedRows()` 在列轴下
  把整表当选中行（选一列 + 批量【应用】⇒ 静默改写整张表）；④ 表体右键落在选中列内仍走单元格菜单。
- **新增资产（下轮扫描时请归入「工具」而非「可疑脚本」）**：
  `.workbuddy/tools/v377-rowcol-axis-probe.mjs`（真机 A/B 17 相；AFTER **60/60**、BEFORE **59/59 +1 SKIP**）／
  `v377-ab-compare.mjs`（24 判别点全不同 + 4 护栏全同）。另有 `dist-v377/` 为本轮隔离构建产物。
- ⛔ **未上线**：前端一上线就带上本仓并行会话的在途改动（长期脏工作区）⇒ 须受控提交 +
  夹带判定（**比字节不比 chunk 名**）+ 零夹带核对。等老板一句「发」。
- **未做**：编辑网格**虚拟滚动**（3,234 个常驻 `<input>`）—— 与 v376 P0-2 同一根因，仍是「编辑网格卡」的真杠杆。
- 🔴 **本轮两条可复用教训（已固化进 `frontend-ui.md §v377`）**：
  ① **两个 dev server 并存会互踩 `node_modules/.vite`** ⇒ 同一依赖 3 个 hash ⇒ **双 Vue 运行时 ⇒ 页面整片空白、0 报错**，
  我一度误读成「旧构建没这功能」；判别证据 = `performance.getEntriesByType('resource')`；**A/B 一次只跑一个 server**。
  ② **进行/列轴前必须 `commitPendingEdit()`（先 commit 后 `preventDefault`）** ——
  否则原先聚焦的输入框不失焦、`change` 永不触发 ⇒ 刚改的那格**既不进撤销栈也不点亮「未保存」**（静默丢改动）。
- **号表**：v377 由本线实占 ⇒ **下轮从 v378 起**（`v374` 仍为空号，勿复用）。

---

## ⚠️ 非审查记录：同日会话顺延（2026-10-04 22:3x–23:0x · v376 预报汇总表整改，**10/11 已上线**）

本自动化当日 **02:00 的只读审查已正常产出**（见下方 2026-10-04 段，落 `docs/code-review/2026-10-04.md`）；
之后**同一天的人工会话继续推进**。本节只为避免下轮把「已修好 / 已上线」误报成新问题，**不是审查输出**。
详情见当日 `memory/2026-10-04.md` 的 **v376** 段、`topics/frontend-ui.md §v376`、`topics/version-history.md` 的 v376 行。

- **主题**：老板「按整改清单依次做吧」⇒ 落地 `docs/UI-预报汇总表-提升空间审核-2026-10-04.md` 的 **11 项**
  （P0-1 选中态对比度 3.49:1→**5.08:1**；P0-2 编辑网格渲染热路径 4 项；P1-1/2/3 可访问性；P2 删 10 条死 CSS）。
  只改 **2 个文件**：`src/pages/Forecast.vue` ＋ `src/styles/variables.css`（新增 `--p-ink` 令牌）。
- **本轮闭环（下轮别再报为新问题）**：P0-1 / P1-1 / P1-2 / P1-3 / P2 **以及 P0-2 的前 3 项** —— 共 10 项**已在生产**
  （随另一会话 2026-10-04 **22:45** 的整包批次上线，属**知情携带**）。
- ⛔ **唯一未上线**：P0-2 第 4 项（`rowSumArr`/`rowSumOf` 行合计缓存，Forecast 分块 **+214 B**）。
  **用户不可感知**；无人值守下默认**不发**，待老板一句「发」再走 `hergent-frontend-deploy-verify`。
- 🔴 **未达判据的诚实交代**：P0-2 只做到 **−27.6%/−30.0%**（判据 ≥60%）。栈采样证明 **92.1% 仍来自 `rowSum`**，
  根因是 **3,234 个 `<input>` 全量常驻、不虚拟滚动** ⇒ 真杠杆是**虚拟滚动 / 行级组件化**，
  **不是继续加缓存**。下轮若见「编辑网格卡」相关报障，先看这条，别重复做微观缓存。
- 🔴 **本轮最贵的一课（两条，已在 `frontend-ui.md §v376` 固化）**：
  ① **判「线上有没有某特征」必须先定位所属 chunk** —— 我拿入口 `index-*.js` 搜业务串恒 **0 命中**，
  据此写出「未上线」的**完全相反结论**（**与 v367 已记的 `cssCodeSplit` 坑同源，在 JS 侧复发**）；
  ② **判夹带比字节不比文件名** —— 两构建**文件名差 31 个、真实内容变化只有 1 个**（纯 hash 级联）。
- **号表**：v376 由本线实占；`v374` 已成**空号**（原为另一会话预留、其实际改用 v375）⇒ **下轮从 v377 起**。
- **新增《验证资产》（下轮扫描时请归入「工具」而非「可疑脚本」）**：
  `.workbuddy/tools/v376-grid-a11y-probe.mjs`（真机 A/B **32/32**）／`v376-grid-fingerprint.mjs`（网格指纹逐字节一致）／
  `v376-diff-test-gen.py` + `v376-diff-test.mjs`（差分单测 **12,803 断言 / 0 失败**）。另有 `dist-v376/` 为本轮隔离构建产物。

---

## ⚠️ 非审查记录：同日会话顺延（2026-10-02 16:4x–17:1x · v362 实施并上线）

本自动化当日 **02:00 的只读审查已正常产出**（见下方 2026-10-02 段，落 `docs/code-review/2026-10-02.md`）；
之后**同一天的人工会话继续推进**并**已部署上线**（v361 之后同一日第二次）。
本节只为避免下轮把「已修好/已上线」误报成新问题，**不是审查输出**。详情见当日 `memory/2026-10-02.md` 的 **v362** 段、
`topics/frontend-ui.md §v362` 与 `topics/version-history.md` 的 v362 行。

- **主题（老板报障，两条一次修）**：① 深色模式下通知条**背景仍为白色**、未跟随系统主题，并要求**全站排查**同类；
  ② 长文案通知条**自动关闭太快** ⇒ 改为**不自动关闭**、**点外部关闭**、**加关闭按钮**。
- **先定性（下轮别再当 Modal 找）**：老板说的「弹窗」是**全局通知条 toast**，链路 `_zhoupu_empty_reason` →
  `HTTPException(400)` → `modules.js` 抛 `Error(d.detail)` → `Forecast.vue::zhoupuGen` catch → `store.toast(msg,'err')` → `App.vue`。
  **6 个真 Modal 全无此病**（都已用 `background:var(--bg)`）。
- **根因两族（下轮别只修一族）**：
  - **(甲)** `App.vue` 渲染 `:class="store.ui.toast.type"`，全站实际传 `err/ok/warn`（217/154/150 次），
    CSS 只定义了 `.toast.error/.toast.success` ⇒ **语义色全不生效**；基类 `.toast{background:var(--t1);color:var(--bg)}`
    是**反色**写法 ⇒ **深色下 `--t1=#f5f5f7` ⇒ 整条变白块**（浅色下看不出问题，故长期潜伏）。`.upd-tip` 同族同病。
  - **(乙)** **28 个 CSS 自定义属性「被 var() 引用但全站从未定义」** ⇒ 有 fallback 的静默回落硬编码浅色、无 fallback 的整条声明被丢弃 ⇒ **零报错**。
- **本轮闭环（下轮别再报为新问题）**：`variables.css` 加 toast 令牌 ＋ **13 个兼容别名**补齐幽灵变量；
  `store/index.js` toast 改**栈式**（`ui.toasts[]` / `TOAST_MAX=3` / **`STICKY_LEN=60` ⇒ 长文案不自动关** / 新增 `dismissToast` / id 换序号）；
  `App.vue` 重写通知区（`.notif-dock` ＋ `TransitionGroup` ＋ 实色 `.toast` ＋ `.toast-x` ＋ **捕获阶段**外部点击关闭 ＋ Esc ＋ 两套类型命名都吃）。
  **全站共改 12 个文件**（最大户 `AiOps.vue` 11 处、`ZhoupuImport.vue` 整页脱令牌）。
- **新增《验证资产》（下轮扫描时请归入「工具」而非「可疑脚本」）**：
  `.workbuddy/tools/v362-toast-logic.mjs`（**17/17** 正例 ＋ **5/5** 反例，真跑 `src/store/index.js`）／
  `v362-theme-probe.mjs`（渲染正例 ✅ vs 旧包独测反例 🔴 亮度 245.7 白块）／
  `v362-toast-e2e-live.mjs`（**打生产真 store，11/11**）／ `v362-toast-shot.mjs`（改前改后截图）。
- **🔴 可复用技法**：`document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('app')`
  ⇒ **不打桩、不登录**即可在生产真机驱动真实业务逻辑（Vue3 把 app 挂在 mount 容器上）。
- **🔴 本轮探针自身两个坑**：① 触发 `store.toast()` 后**必须等一拍**再读 DOM，否则读到空 DOM 会**假红**（我据此误判过一次）；
  ② 在**旧包上跑真交互**时 CDP `send()` 会等一个永不返回的回执 ⇒ **脚本静默挂死 3 分半**，反例应改走**确定性产物判据**。
- **已上线**：前端 `hergent.cn` 2026-10-02 16:55。入口 `index-DtmT2gg4.js` md5 **`4b3d8a97…`**、
  全局 CSS `index-Cmtpn6k_.css` md5 **`6dde75bf…`**、`index.html` md5 **`48dfa57f…`**（旧 `c960a540…`）；
  **三向一致**（本地 dist == 线上文件系统 == 公网 curl）；assets **56→56**、逻辑名集合逐项一致 ⇒ **零夹带**；
  `rsync` **不带 `--delete`**（线上顶层有 `backups/` ＋ 21 个 `index.html.bak-*`）；
  回滚锚点 `index.html.bak-v362-pre-20261002-165526` ＋ `/root/backup_v362_20261002/`。
  终态见 `topics/version-history.md` v362 行。**未提交**（按惯例）。**号表推进：下轮从 v363 起。**

---

## 最近执行：2026-10-08
- 模式：严格只读，未改/删/重命名任何代码配置，未部署/重启，无 git 写操作（git status/diff/log 仅读）。
- 范围：窗口 10-07 02:00→10-08 02:00。实质新增＝进销存（PSI）模块：前端 19 文件（18 个新 inventory 页＋api/psi.js/psiLabels.js/pages.js/permView.js/router/index.js 接线）＋ 后端 hergent-erp/server 10 个 .py（routers/psi.py / domain/batch_tracker.py / db/queries/purchases.py / db/queries/sales.py / routers/sales.py 等，属 v391/v392）。**全部已提交**（a96ad3d/1eeabcf/v393 系列），无未提交产品源码。
- 结果：高 0 / 中 0 / 低 3（新增，均为新建 PSI 详情页原生 `window.confirm`：InvPurchaseDetail.vue:205、InvSaleDetail.vue:162/:185，同族历史 L6）。
- 历史遗留 7 项（均低，连续多轮）：H1 前端 fire-and-forget 15 处（17→15，useCardTrigger.js 不再命中）/ H2 后端 print 7 处（import_router.py:966/1283/1303/1361 + forecast_submissions.py:773/785/1291）/ H3 v-html 已缓解残 4 处 / H4 BidRadar 内联 svg(:5/:66) / L5 rebate_settlement.py:47/156 缺键3 / L6 SettlementScheduleTab.vue:377 原生 confirm / L7 同文件:274 品牌加载静默。
- 本轮闭环：无（新增模块非修复）。正向：H1 计数 17→15。
- 工作进展：**进销存 PSI 八页全链正式落库提交**（工作台 KPI/批次级库存 FEFO 查询/采购销售 CRUD）；长期脏前端工作区经「让 git 追上生产」批次（a920119/57815ac/23000bf）闭合，hergent-cn-v2/src 当前无未提交产品源码。
- 未提交：窗口文件全已提交；剩余未跟踪＝outputs/ 交付文档、forecast-order-miniprogram/（已排除）、.workbuddy 工具、hergent-erp 的 tools/tests 与 static/dist-* 构建产物。
- UI 规范：PSI 八页**零硬编码颜色**（grep `#xxxxxx` 零命中）、复用唯一 `.main-tabs`、无 v-html；唯偏离＝3 处原生 confirm（同族 L6）。
- 安全核查：psi.py SQL 全白名单 where+参数化、每端点 `_auth`、request.json 包 except→400；batch_tracker FEFO 逻辑正确、无裸 except；psi.py `/receive` 显式绕过老链路 AttributeError→500 坏函数。零新增注入/鉴权/异常回归。
- 报告落盘：docs/code-review/2026-10-08.md（目录 19 份 ≤30，无需清理）。

## 最近执行：2026-10-07
- 模式：严格只读，未改/删/重命名任何代码配置，未部署/重启，无 git 写操作（git status/diff/log 仅读）。
- 范围：窗口 10-06 02:00→10-07 02:00。落地改动＝前端 5 文件 M（pages.js / Shell.vue / Archive.vue / EmployeeArchive.vue / Rebate.vue，+104/−35）；后端 hergent-erp/server 10 个 .py 窗口内 mtime 但 git 干净（v380–v388 已提交），无未提交后端代码。
- 结果：高 0 / 中 0 / 低 1（新，仅 pages.js:245 父级 /archive 注释漏列 suppliers，三处路由已对齐、无功能影响）。
- 历史遗留 7 项（均低，连续多轮）：H1 前端 fire-and-forget grep 复核 17 处 / H2 后端 print 7 处（import_router.py:966/1283/1303/1361 + forecast_submissions.py:785/773/1291）/ H3 v-html 已缓解残 4 处 / H4 BidRadar 内联 svg(:5/:66) / L5 rebate_settlement.py:156 缺键3 / L6 SettlementScheduleTab.vue:377 原生 confirm / L7 同文件品牌加载静默。
- 本轮闭环：无（7 项遗留均未触及）。
- 工作进展：供应商档案（v387）三处（Archive.vue TABS:82 / pages.js:280 / router/index.js:109）已完全对齐；Rebate 新增「结算节奏」页签（SettlementScheduleTab 组件 v375 就位）；pages.js 把 /forecast、/loss-accounting、/archive、/bid-radar、/cron 门禁语义按 v341/v345/v347/v349 收口，逐行注释锁动机。
- 未提交：前端 5 文件 M（窗口内）＋ 整个 src 长期脏（v380–v388 在途）；后端 git 干净。「生产已部署但 git 里没有」见 04:00 巡检。
- UI 规范：新增代码合规（EmployeeArchive 硬编码色→主题令牌 var(--st-draft-bg/-txt) 已定义）；唯 H4 内联 svg 旧偏离；v-html 经 renderMd 转义。
- 报告落盘：docs/code-review/2026-10-07.md（目录 18 份，≤30，无需清理）。

## 最近执行：2026-10-06
- 模式：严格只读，未改/删/重命名任何代码配置，未部署/重启，无 git 写操作（git status/diff/log 仅读）。
- 范围：窗口 10-05 02:00→10-06 02:00。仅 `hergent-cn-v2/src/pages/Forecast.vue` 有 mtime 改动（= v378 选中保真度 15:37 + v379 Excel 对标 P0 四项 20:50，均入 HEAD `0bff45b`）；`hergent-erp/server` 零源码改动（仅 __pycache__/*.pyc 与 *.db 运行件）。erp/、根目录 Python 无改动。
- 结果：高 0 / 中 0 / 低 0（新增缺陷）。v378/v379 逐行复核：`openPrintable` 签名与 `utils/printable.js:78` 导出完全匹配；`filteredRowsForExport`/`keepCellClear`/`gridHeaders`/`gridRowCells` 均存在；`followEdge` 的 `document.querySelector` 与既有 `focusCell:6151` 同模式（非新回归）。无未定义引用/逻辑错误/集成断裂。
- 历史遗留 7 项（均低，连续多轮）：H1 前端 fire-and-forget 15 处（grep 复核仍 15，行号随重构变动）/ H2 后端 print-except 5 处（import_router.py:966/1283/1303/1361 + forecast_submissions.py:785）/ H3 v-html 已缓解残 4 处 / H4 BidRadar.vue:5/66 内联 svg / 10-05 三项低升第2轮（rebate_settlement.py:156 缺键3、SettlementScheduleTab.vue:377 原生 confirm、:274 静默）。
- 本轮闭环：无（H1–H4 与 10-05 三项低均未触及）。
- 工作进展：v378+v379 提交（HEAD 0bff45b），按惯例未部署、待老板「发」走 hergent-frontend-deploy-verify 受控上线＋零夹带核对。
- 未提交：前端 src 约 24 文件 M（Forecast.vue 已提交不列）+ 后端 server.py M + 未跟踪 rebate_settlement.py 等。「生产已部署但 git 里没有」见 04:00 巡检，不在本任务展开。
- UI 规范：新增代码合规；唯 H4 内联 svg 旧偏离。
- 报告落盘：docs/code-review/2026-10-06.md（目录 17 份，≤30，无需清理）。

## 最近执行：2026-10-05
- 模式：严格只读，未改/删/重命名任何代码配置，未部署/重启，无 git 写操作（git status/diff/log 仅读）。
- 范围：扫描 2026-10-04 02:00 → 10-05 02:00 的 mtime 改动。核心新增＝前端 5 文件（variables.css / SettlementScheduleTab.vue【新】/ modules.js / Rebate.vue / Forecast.vue）＋ 后端 2 文件（rebate_settlement.py【新】/ server.py）。
- 结果：高 0 / 中 0 / 低 2（新增）＋ 1 条系统性观察（非本轮引入）。
  - 低-新1：rebate_settlement.py:156 与 SettlementScheduleTab.vue:235/263 的 `OFFSET_LABELS`/`OFFSET_TEXT` 缺键 3（submit_offset=2+post_offset=1 组合标签错显「上月」），仅标签错误、日期正确。
  - 低-新2：SettlementScheduleTab.vue:377 删除用原生 `window.confirm`（UI规范偏离，同族历史 LOW）。
  - 低-新3：SettlementScheduleTab.vue:274 品牌加载失败静默无日志（设计性降级但不可见）。
  - 系统性观察：rebate_settlement.py 写接口仅 `_auth`（模块级经路径映射给 sales），未服务端强制 create/update/delete 动作权限（与全仓 99/101 路由一致，前端 canDo 守门）；`:313/:322` `request.json()` 无 try（与既有写法一致）。
- 历史遗留未修 4 项（均低，连续多轮）：H1 前端 fire-and-forget 15 处（9 文件，grep 复核仍 15 处）/ H2 后端 print 吞错 import_router.py:966/1283/1303/1361 + forecast_submissions.py:785（行号未变）/ H3 v-html 已缓解残 / H4 BidRadar.vue:5/66 内联 svg。
- 本轮闭环：无（v375/v376 改动未触及 H1–H4 位置）。
- 工作进展：v375 结算节奏配置页（前端新组件 + 后端 rebate_settlement.py + server.py 注册）与 v376 预报汇总表整改（Forecast.vue + variables.css，随 10-04 22:45 批次上线）纳入首审；逐行复核内部自洽、无未定义引用、无破坏性行为；后端依赖字段 open_stale/auto_reap_on/arrival_month 在生产后端均存在，无集成断裂；P2 删 10 条死 CSS 经模板 0 引用核实无活回归。
- 未提交：前端 5 文件（M/??）＋ 更早约 23 个 src 在途；后端 rebate_settlement.py(??) + server.py(M) ＋ 更早 4 源文件在途。「生产已部署但 git 里没有」见 04:00 巡检，不在本任务展开。
- UI 规范：新增代码整体合规（<Icon> 线性 SVG、Δ→差异、scope=col/aria-current/role=grid、--p-ink 选中态 5.08:1）；偏离仅 3 处低危（模态 z-index 写死 900/901、原生 confirm、BidRadar 内联 svg）。
- 报告落盘：docs/code-review/2026-10-05.md（目录 16 份，≤30，无需清理）。

## 最近执行：2026-10-04
- 模式：严格只读，未改/删/重命名任何代码配置，未部署/重启，无 git 写操作（git status/diff/log 仅读）。
- 范围：前端 hergent-cn-v2/src 自 10-03 02:00 起**零 mtime 改动**；后端 hergent-erp/server 4 源文件（erp_db.py / routers/data.py / routers/forecast_submissions.py / routers/product_targets.py）有 v369~v372 共 7 commit（+347/−17，HEAD 8f29593）落地且全部提交。其余 mtime 命中均为 docs/.workbuddy/.git，按范围剔除。
- 结果：高 0 / 中 0 / 低 0（缺陷级新增）。1 处非缺陷级 LOW：v369 在 forecast_submissions.py:785 新增 `print()` 兜底诊断（与 H2 同源，无功能影响）。
- 历史遗留未修 4 项（均低，连续未修）：H1 前端 fire-and-forget 15 处（Shell:304/CopilotDrawer:2007/IdleTimeout:82/ProductTarget:489/Rebate:2537/EmployeeArchive:1178/Forecast:4545/4552/5692/7795/11245/store:384/518/531/router:201）、H2 import_router.py:966/1283/1303/1361 + forecast_submissions.py:785、H3 v-html 已缓解（CopilotDrawer:131/Workbench:161/200/260）、H4 BidRadar 内联 svg(:5/:66)。
- 本轮闭环：无（上一轮 4 项均未修）。
- 工作进展：v369 均单个人口径 + v369b 向上取整 + v370 本人仓库存/销量新鲜度 + v371 单位对齐(per_case) + v372 汇总表空参兜底默认期次，均提交；逐行复核无新缺陷；导入符号 forecast_period_default/_sales_freshness/per_case 均存在（无导入级缺陷）。
- 未提交：前端 src ≥23 文件 M（v362~v368 在途，按惯例未提交，10-03 02:00 后无新改动）；后端 4 源文件已提交，未跟踪为 tools/tests 验证脚本。
- UI 规范：前端零改动，沿用 10-03 结论合规（除 H4 内联 svg）；v-html 经 renderMd 转义。
- 报告落盘：docs/code-review/2026-10-04.md（目录 15 份，≤30，无需清理）。

## 最近执行：2026-10-03
- 模式：严格只读，未改/删/重命名任何代码配置，未部署/重启，无 git 写操作（git status/diff 仅读）。
- 范围：本机自 10-02 02:00 起改动 hergent-cn-v2/src 23 文件 + hergent-erp/server 4 未提交文件（erp_db/forecast/product_targets/scheduler）；arrival_schedule/credits/rebate_rules 仅 mtime 更新、git 已干净不计入。排除 backup/desktop-app/engines/node_modules/dist/assets/hergent_mobile/小程序/docs/.workbuddy 等。
- 结果：高 0 / 中 0 / 低 0（新增）。历史遗留未修 4 项（均低，第2轮）：H1 前端 fire-and-forget（router/index.js:201、store:384/518/531、Forecast.vue:4545/4552/5692/7795/11245、CopilotDrawer:2007、Shell:304、EmployeeArchive:1178、Rebate:2537、ProductTarget:489）、H2 import_router.py:966/1283/1303/1361 print-except、H3 v-html 已缓解（CopilotDrawer:131、Workbench:161/200/260）、BidRadar 内联 svg（:5/:66）。
- 本轮闭环：无（上一轮 BidRadar 内联 svg 未修，且 v357 又增 1 处）。
- 工作进展：24h 内 v362–v368 全部落地（toast/深色适配、到货周期按月停单、停单排除升级、开放通知守开关、UI 规范整改、一键作废），均过 90+ 验收读数 + 真实数据 A/B 取证，逐行复核无新缺陷。v365(2d0d3d2)、v368(89e5493/b59e7d6) 已提交，其余在途未提交。
- 未提交：前端 src 约 40 M + .workbuddy + outputs（共 394 项）；后端 4 M + 未跟踪 tools/tests（共 33 项）。并行会话使在途/已上线同处工作区，须受控提交。
- UI 规范：<Icon> 合规（除 BidRadar 历史遗留 2 处内联 svg）；v-html 经 renderMd 转义；中文文案无英文缩写回潮；v367 已补 z-index 令牌/Δ→差异/aria-live。
- 报告落盘：docs/code-review/2026-10-03.md（目录 13 份，≤30，无需清理）。

## 最近执行：2026-10-02
- 模式：严格只读，未改/删/重命名任何代码配置，未部署/重启，无 git 写操作。
- 范围：本机自 10-01 02:00 起新增改动集中在 hergent-cn-v2/src（11 文件 mtime 更新；5 个 M + 1 新增未跟踪 permView.js 有实质新代码，另 5 个 mtime 更新但内容相对 HEAD 无变化）。后端 hergent-erp/server 自 10-01 02:00 起 **0 个 mtime 更新**（3 个 M 为更早改动）；根目录 erp/ 与脚本无改动。
- 结果：高 0 / 中 0 / 低 1（新）：BidRadar.vue:5/:66 内联手写 `<svg>` 图标，未复用本仓 `<Icon>` 组件（UI 规范一致性偏差，低）。
- 历史遗留未修 3 项（均低，**第4轮**）：H1 前端 fire-and-forget(.catch)（grep 现行行号见报告 §四）、H2 后端 import_router.py:966/1283/1303/1361 print-except、H3 v-html 已缓解残（CopilotDrawer.vue:131、Workbench.vue:161/200/260）。
- 本轮闭环：无（延续 10-01 的 0 新增）。正向复核：三处安全修复（Settings Hermes Key / import_zhoupu 口令 / copilot_proxy 密钥）grep 复核仍保持已修复、无回退。
- 工作进展：24h 内为功能硬化——v355 过期未关横幅 + v347 模块拒绝横幅、v357 区域记忆、v349/v350/v351 权限页重写 + permView.js 单一源 + Promise.all 解耦；逐行扫描无新缺陷。
- 未提交：前端 src 15 M + 新增 permView.js(??) + .workbuddy/tools/* 未跟踪；后端 server 3 M（erp_db/forecast/scheduler）+ 大量未跟踪 tests/tools/scripts/prompts。
- UI 规范：总体合规，仅 BidRadar 内联 svg 1 处偏差（低）；v-html 经 renderMd 转义；中文文案无英文缩写回潮。
- 报告落盘：docs/code-review/2026-10-02.md（目录 13 份，≤30，无需清理）。

---

## ⚠️ 非审查记录：同日会话顺延（2026-10-02 12:2x–12:3x · v361 实施并上线）

本自动化当日 **02:00 的只读审查已正常产出**（见上方 2026-10-02 段，落 `docs/code-review/2026-10-02.md`）；
之后**同一天的人工会话继续推进**并**已部署上线**。本节只为避免下轮把「已修好/已上线」误报成新问题，
**不是审查输出**。详情见当日 `memory/2026-10-02.md` 的 v361 段与 `topics/version-history.md` 的 v361 行。

- **主题（老板报障）**：本期预报导出舟谱自提订单模板时，**没有「导出配置」的报单对象「备货」也出现在模板里**。
- **根因**：`routers/forecast.py::_build_zhoupu_data` 分组旧分支 `if g["cfg"] and ...: db_groups else: zt_groups`
  ⇒ `cfg` 为空（简称没在「报单配置」登记 / 配置已停用）**也默认塞进自提**，客户名回落成列头。
  （同族第 3 次：v294「配了等于没配」、v343「停用照样算」。）
- **本轮闭环（下轮别再报为新问题）**：
  - 分组处新增 `if not g["cfg"]: unmapped_aliases.append(...); continue` ⇒ **自提/调拨都不进** ＋ warnings 点名 + 给正门；
  - `_zhoupu_empty_reason` 增补「被拦住的报单对象」一段（模板因拦住而变空时数出名字）；
  - **v361b**：点名**限量前 5 个 + 「等，共 N 个」**（告警走 `X-Template-Warnings` 响应头，中文 `quote()` 后每字 9 字符，
    逐个点名 30 个 = 2215 字节 ⇒ 会**自己顶穿 1500 字节预算被截断**，而句尾指引最先被切掉）。
- **新增《验证资产》（下轮扫描时请归入「工具」而非「可疑脚本」）**：
  - `hergent-erp/server/tools/v361-unmapped-export-block-harness.py`（可复现护栏，**36/36**）；
  - `hergent-erp/server/tools/v361-realdata-ab-proof.py`（真实数据 A/B 取证，**27/27**；依赖 `tenant_1.db` 一致性快照，已随用随删）。
- **🔴 值得下轮复用的事实（非缺陷）**：报单汇总表为「本期无正数量的列」写一条 `__列占位__`（qty=0/无条码）
  以保住列（写入点 `routers/forecast_submissions.py:1092-1095`）⇒ `_build_zhoupu_data` 在 `qty<=0` 处丢掉
  ⇒ **只有「真的下了量」的报单对象才可能进模板**。「未登记」本身不是泄漏条件，「未登记 **且** 有量」才是。
  真实数据实证：tenant_1 窗口 2026-09-28~09-29 的 20 张导入单里，18 张只有占位行，真有量的只有「唐成」（已登记）与「备货」（未登记）。
- **已上线**：生产 `/opt/hergent-erp/routers/forecast.py` md5 **`dc89ec9c7af67c9c3200098d6cde9039`**（本地一致）；
  备份 `/root/backup_v361c_20261002/`（上一版 `f2b5522b…`）与 `/root/backup_v361b_20261002/`（`da6a2c73…`）；
  `active` + `/api/health` 200 + 0 traceback。**前端无需改**（`Forecast.vue:6422` 已有 toast 显示该响应头）。
  终态见 `topics/version-history.md` v361 行。**真实数据 A/B 27/27**（对部署态 md5 取证，用后快照两侧已删）。
- **🆕 新增技能**：`hergent-realdata-ab-proof`（真源码 × 真租户库快照的行为 A/B 取证；已登记进 `topics/skill-routing.md §数据与库`）。
- **⚠️ 下轮注意**：该行里原先写的「未上线原因 = 怕夹带 v355」**已作废** —— 实测生产本就是 v355，
  `diff 生产 vs 本地` 只显示 v361 的 hunk，无夹带。别再据此判断该文件「有在途改动」。

---

## 最近执行：2026-10-01
- 模式：严格只读，未改/删/重命名任何代码配置，未部署/重启，无 git 写操作。
- 范围：hergent-cn-v2/src 35 改动前端文件 + hergent-erp/server 22 改动后端文件（自 09-30 02:00 起）。关键路径（SQL 构造/鉴权/JSON.parse/except 吞错/v-html）逐行扫描。
- 结果：高 0 / 中 0 / 低 0（新增）。历史遗留未修 3 项（均低，第3轮）：H1 前端 fire-and-forget(.catch)（Forecast.vue:4527/11161、Rebate.vue:2528、CopilotDrawer.vue:2007 等）、H2 后端 print-except（import_router.py:965-966/1282-1283/1302-1303/1360-1361）、H3 v-html 已缓解残（CopilotDrawer.vue:131、Workbench.vue:161/200/260）。
- 本轮闭环：无（上一轮新增为 0；Settings.vue:443 明文 Key、import_zhoupu.py:428 口令、copilot_proxy.py:36 密钥三项旧高危保持已修复，grep 复核）。
- 未提交：前端 src 19 M + .workbuddy/tools/* 大量未跟踪；后端 server/core.py、server.py M + 未跟踪 tests/tools/scripts/prompts。上线前须受控提交。
- UI 规范抽查：<Icon> 线性图标合规、v-html 经 renderMd 转义、中文文案无英文缩写回潮，通过。
- 报告落盘：docs/code-review/2026-10-01.md（目录 12 份，≤30，无需清理）。

## ⚠️ 非审查记录：同日会话顺延（2026-09-29 13:1x–13:4x · v318 实施并上线）

本自动化当日 **02:00 的只读审查已正常产出**（见下方 2026-09-29 段，落 `docs/code-review/2026-09-29.md`）；
之后**同一天的人工会话继续推进**并**已部署上线**。本节只为避免下轮把「已修好/已上线」误报成新问题，
**不是审查输出**。详情见当日 `memory/2026-09-29.md` 的 v318 段与 `topics/version-history.md` 的 v318 行。

- **主题**：加单/减单「一键分摊」＋ 通知出口唯一化到「关闭期次」＋ 小程序消息页。三端共 14 文件（后端 4 / 前端 2 / 小程序 8）。
- **本轮闭环（下轮别再报为新问题）**：
  - `forecast_submissions.py::_notify_extra_allocs` 的 **收件人键错位**（把 `employee_id` 当 `users.id` 用 ⇒ 静默错投）→ **函数已删除**，新出口经 `db.employee_account_map()` 解析，取不到账号不投递。
  - 通知**首报 `forecast_submissions.py` 用 `print` 落 stdout** 那类低危项在**本轮改动的文件里已无新增**（新增代码统一走 `logging` / 结构化回执）。
- **本轮新增未提交代码（下轮扫描时请归入「新功能」而非缺陷）**：`routers/product_targets.py` +355 行（`/extra-alloc/setup`、`/extra-alloc/preview`、`notify_extra_allocs_finalized`）、`erp_db.py::forecast_period_close` 返回布尔、前端 `Forecast.vue` 两处弹窗、小程序 `pages/messages/*`。
- **已上线**：前端入口 `index-BBFLXp_t.js`；后端 4 文件双侧 md5 一致、重启 PID 2809927。终态见 `topics/version-history.md` v318 行。

---

## 最近执行：2026-09-30
- 模式：严格只读，未改/删/重命名任何代码配置，未部署/重启，无 git 写操作。
- 范围：两仓自 09-29 02:00 起全部改动（前端 35 文件 +3,508 行；后端 50 文件 +7,832 行，含新路由 commitments/collections/reconciliation、角色能力 L2 服务端裁决）。优先审查新路由 SQL 构造/鉴权、角色能力默认语义、动态 SQL 路由、前端 JSON.parse 包裹；erp_db.py(+892 DDL) 与档案页(+500×2) 仅 spot-check。
- 结果：高 0 / 中 0 / 低 0（新增）。历史遗留未修 3 项（均低）：H1 前端 fire-and-forget(.catch) 第2轮、H2 后端 print-except 第2轮、H3 v-html 已缓解残。
- 本轮闭环：无（上一轮问题全部延续）。
- 正向复核：上一轮已闭环三处安全项（copilot_proxy 密钥 / import_zhoupu 口令 / Settings Hermes Key）grep 复核仍保持修复，不重复计。
- 设计权衡（非缺陷）：ai_roles.py:28 角色能力 L2 对空值刻意 fail-open（保存量租户零变化），有注释锁定，不建议改。
- 未提交：前端 src 35 + index.html + .gitignore 未提交（另有 3 提交 bedaacc/deb16cd/2769f2b）；后端 50 条目（含 22 未跟踪 tools/tests + 3 提交 a88dfc3/85faff4/8946b76）。
- UI 规范抽查：动作按钮统一 <Icon> 线性 SVG，emoji 仅作角色头像用户内容（RoleAvatar 唯一渲染口），符合规范。
- 报告落盘：docs/code-review/2026-09-30.md（目录 11 份，≤30，无需清理）。

## 最近执行：2026-09-29
- 模式：严格只读，未改/删/重命名任何代码配置，未部署/重启，无 git 写操作。
- 范围：前端 hergent-cn-v2/src 自 09-28 02:00 起 32 文件 + 后端 hergent-erp/server 同窗 29 源码文件（含新路由 commitments.py、对账引擎、auth 登录范围）。
- 结果：高 0 / 中 0 / 低 2（新）。
  - 低-新1：前端 fire-and-forget 静默吞错 4 处（Rebate.vue:2498、Forecast.vue:4201/7451、CopilotDrawer.vue:1833）。
  - 低-新2：后端 except 用 print 落 stdout 而非日志（forecast.py:767/797/843/1019/1111/1123/1235/1295/1329/1453/1607、import_router.py:583/892、forecast_submissions.py:718/1215）。
- 本轮闭环（1 项实质修复）：experience_loop.py 跨租户红线子串黑名单（中危，首报 09-25 第5轮）→ 新增正向白名单 CALIBER_SHAREABLE + is_caliber_shareable（fail-closed，门禁在 335/598/646/823），子串黑名单降为冗余次级。中危历史遗留归零。
- 历史遗留未修：2 项均低——Forecast.vue:4208/10039 loadPtGap().catch（第2轮，09-28 报仍在）、CopilotDrawer.vue:103 v-html（已缓解残）。
- 新增功能（均未提交）：v303 厂家承诺台账（commitments.py，动态 SQL 列名来自硬编码字典、值全参数化，无注入）、v313 舟谱财务导入、auth 登录范围 v310/v312、对账引擎扩展、前端 M1-M4 副驾 / Forecast 列级权限。
- 未提交：前端 ~32 src 文件 M + 小程序 fill/* M + .workbuddy/tools/* 未跟踪；后端 29 server 源码 M + 未跟踪（commitments.py 新路由、测试、运维脚本、docs）。
- UI 规范抽查：v-html 均经 renderMd 转义、Icon.vue 线性图标合规，通过。
- 报告落盘：docs/code-review/2026-09-29.md（目录 10 份，≤30，无需清理）。

## 最近执行：2026-09-28
- 模式：严格只读，未改/删/重命名任何代码配置，未部署/重启，无 git 写操作。
- 范围：09-27 02:00 之后两仓全部改动（前端 +2,419/−429 跨 23 文件；后端 +1,409/−143 跨 18 文件），重点 v294–v300 收尾。
- 结果：高 0 / 中 0 / 低 1（新：Forecast.vue:4177/9982 `loadPtGap().catch(()=>{})` 静默吞错）。
- 历史遗留未修：1 项中危（experience_loop.py:35-46 跨租户黑名单，首报 09-25，第 3 轮）+ 1 项低残（CopilotDrawer.vue:103 v-html，已缓解）。
- 本轮闭环：上一轮（09-27）清单无新增闭幕项；v294 实质落地项（report_mapping_list 参数化、server.py round(os.popen)→subprocess、warehouse_id 白名单）已复核确认。
- 新增功能（v294–v300，全部未提交）：报单对象类型轴、alias-pool 名册接口（已 _auth）、角色动态值域、v299 定时任务页修复、v300 存量租户权限补漏。
- 未提交：前端 ~24 M + 5 新未跟踪；后端 18 M + 7 新未跟踪（含运维脚本）。
- UI 规范抽查：Workbench 3 处 v-html 均经 renderMd 转义，符合规范。
- 报告落盘：docs/code-review/2026-09-28.md（目录 9 份，≤30，无需清理）。

## 最近执行：2026-09-27
- 模式：严格只读，未改/删/重命名任何代码配置，未部署/重启，无 git 写操作。
- 范围：前端 hergent-cn-v2/src 自 09-26 02:00 改动（client.js / CopilotDrawer.vue / TargetFormModal.vue / Forecast.vue / Settings.vue）+ 后端 hergent-erp/server 14 M + 2 新增未跟踪（SOUL.im.md、test_rhythm_only_rule_v282.py）。
- 关键发现：09-26 当天后端有 2 次提交——`743dfc4`(v280 入参校验)、`4e4d2b2`("git 追上生产"同步 27 文件含 v281 安全修复)。**v281 安全修复已正式入库**。
- 结果：高 0 / 中 0 / 低 0（新增代码零新缺陷）。历史遗留未修：1 项中危（experience_loop.py:35-46 跨租户红线子串黑名单，首报 09-25）。
- 本轮闭环（7 项全修，前 3 轮累积的高/中危安全问题归零）：import_zhoupu.py:428 写死口令 hergent2026 → 改 env/随机口令；copilot_proxy.py:36 硬编码网关密钥 → 改 env 空串 fail-loud；Settings.vue:443 Hermes Key 明文 localStorage → 改走后端代理；server.py:4941 os.popen → subprocess.check_output；server/var/ → 已 gitignore；Forecast.vue saveSnap JSON.parse → 加 try；product_targets.py 双重否定 → 已为正向判断。
- 新增功能（v282，未提交）：报单"沿用得 0 商品"告警（前端黄条+站内通知+企微推送）、返利"只配节奏不设目标"规则放行、SOUL.md 按 web/im 渠道渲染+SOUL.im.md、前端副驾改走后端代理。
- 未提交：前端 ~21 M + ProgressSteps.vue(D) 全未提交（09-26 当天 0 提交）；后端 v282（14 M + 2 未跟踪）未提交。
- UI 规范抽查：CopilotDrawer 用 `<Icon>` 8 处、无 emoji 当图标、v-html 经 renderMd 转义，符合规范。
- 报告落盘：docs/code-review/2026-09-27.md（目录 8 份，≤30，无删除）。

## 最近执行：2026-09-26
- 模式：严格只读，未改/删/重命名任何项目代码配置，未部署/重启。
- 范围：前端 hergent-cn-v2/src 最近改动（CopilotDrawer/Forecast/ProductTarget/modules/router/Shell/roles/ConnectCenter/client/ZhoupuImport）+ 后端 hergent-erp/server 近7天（截至 2026-09-26 00:13：forecast_submissions/product_targets/erp_db/db/indexes/copilot_proxy/data/products/auth/server/core/soul_sync/ai_assist/zhoupu_documents/scheduler/forecast/hermes_tenants 等）+ 根目录 import_zhoupu.py。
- 结果：高 1 / 中 2 / 低 4。
  - 高：import_zhoupu.py:428 舟谱导入仍为全员写死默认口令 `hergent2026`（前轮已报、本轮确认仍在；该文件是 CLI 脚本非死代码）。
  - 中：copilot_proxy.py:36 硬编码兜底网关密钥 `hergent-prod-gateway-key-2026`（前轮已报）；Settings.vue:443 Hermes Key 明文 localStorage（前轮已报）。
  - 低 4：Forecast.vue:7773 saveSnap 未包裹 try 的 JSON.parse；product_targets.py:492 双重否定 `not...>0`（当前正确但脆弱）；server/var/ 未 gitignore；server.py:4941 os.popen 拼接（值仅整数、安全但风格）。
- 正向复核：md.js 渲染前转义（v-html 安全）；动态 SQL 列名走白名单仅值参数化（安全）；最新后端文件无新增裸 except；soul_sync/copilot_proxy 容错良好。
- 未提交：前端 src 19 M + 4 新增未跟踪（ConfigCard/ReminderConfig/ProductTarget/ZhoupuImport）+ ProgressSteps.vue 已删；后端 server 21 M + 8 新增未跟踪（含 var/ 需 gitignore）。
- 工作对比：09-26 仅 00:11–00:13 尾段收尾 v279（forecast_extra_alloc 归属键 window→period_id + 索引 DROP/CREATE 覆盖各租户库），无新功能；活跃度集中在 09-25 深夜。
- 待下轮复核：experience_loop.py 跨租户红线（子串黑名单，前轮 MEDIUM，本轮未重读）。
- 报告落盘：docs/code-review/2026-09-26.md（目录 6 份，未超 30，无删除）。

## 最近执行：2026-09-25
- 模式：严格只读，未改/删/重命名任何项目代码配置，未部署/重启。
- 范围：前端 hergent-cn-v2/src 近期改动（CommandPalette/ProductTarget/Workbench/AiHub/useCardTrigger/EmployeeArchive/ResultCard/router/ConnectCenter/Icon/roles/CopilotDrawer/Settings/Forecast/Shell/modules/client/store/AutoPeriodBlock/variables/ReportMapping）+ hergent-erp/server 近7天（含 6 个全新未提交 router/domain：ai_judgement/ai_pager/copilot_proxy/experience_loop/product_targets + domain/product_targets）。
- 结果：高 1 / 中 3 / 低 8。
  - 高：import_zhoupu.py:428 舟谱导入全员账号写死默认口令 `hergent2026`（前轮已报仍存）。
  - 中：copilot_proxy.py:36 硬编码默认网关密钥 `hergent-prod-gateway-key-2026`（新）；Settings.vue:443 Hermes Key 明文 localStorage（前轮已报仍存）；experience_loop.py:35-46 跨租户"红线"仅靠子串黑名单（脆弱）。
  - 低 8 项：experience_loop.py:144 三元+or 优先级、:254 死守卫、:270-278 默认归 loss；Workbench.vue:311-324 冗余分支；ai_judgement.py:48 空 choices IndexError（已兜底）；product_targets.py:365 `not...>0` 误读；CommandPalette/CopilotDrawer `<kbd>` 方向符号；ProductTarget.vue:408 提示误用错误态。
- 已核对正向项：server 无裸 except 残留（de5b08e 生效）；useCardTrigger.js 全部 JSON.parse 在 try 内；md.js 渲染前转义（v-html 安全）。
- 未提交：laozhangai-product src 19 文件 M 未提交；hergent-erp 18 M + 10 新增未跟踪（含 server/var/ 建议确认是否加 .gitignore）。
- 未纳入：hergent-admin 子站（root 独立前端，本轮未扫描，建议下轮专项）。
- 报告落盘：docs/code-review/2026-09-25.md（目录仅 5 份，未超 30，无删除）。

## 最近执行：2026-09-24

## 最近执行：2026-09-23
- 模式：严格只读，未改/删/重命名任何代码配置，未部署/重启。
- 范围：hergent-cn-v2/src 最近前端（Forecast/ReportMapping/AutoPeriodBlock/Rebate 系列 + api/client.js、modules.js）+ hergent-erp/server 近7天改动（含 v247/v248/v252 未提交）。
- 结果：高 0 / 中 2 / 低 4。
  - 中：hermes_core.py:808 裸 except 吞 items 解析错；Forecast.vue:7209 未捕获 JSON.parse。
  - 低：全仓遗留裸 except 约30处；modules.js:212 reconciliationApi 废弃接口；forecast_submissions.py:154 冗余赋值；Forecast.vue:7524 Math.max.apply 隐患。
- 未提交：laozhangai-product 的 src 已全部提交；hergent-erp 有 11 改 + 1 新文件(report_column.py) 未提交，建议评审后提交。
- 报告落盘：docs/code-review/2026-09-23.md

## 修复执行（2026-09-23，用户指令「修复报告中的核心问题」）
- 已修复并上线 5 处：hermes_core.py:808 / Forecast.vue:7209 / Forecast.vue:7524 / modules.js:206 / forecast_submissions.py:154。
- 前端双侧 md5 一致已上线；后端精准 rsync 两文件 + 重启 hergent-erp，服务 active、`/openapi.json` 200。
- 未处理：全仓约 30 处遗留裸 except 仅修点名的一处，其余留系统性专项；其余 9 个今日未提交后端文件未整批上线。
- 详见报告 §八「修复实施记录」。

## 最近执行：2026-09-24
- 模式：严格只读，未改/删/重命名任何代码配置，未部署/重启。
- 范围：hergent-cn-v2/src 近期前端（Forecast/store/CopilotDrawer/ConfigCard/ReportMapping/ReminderConfig/AutoPeriodBlock/Settings/Shell/modules.js/client.js）+ hergent-erp/server 近7天改动（platform/import_router/server/core/erp_db/hermes_tenants/scheduler/hermes_core/ai_engine/einvoice_engine/import_zhoupu/tenant_audit/metrics/ai_insights/ai_credit/ai_pricing/routers/*/scripts/*/db/queries/report_column.py）。
- 结果：高 1 / 中 12 / 低 28。
  - 高：import_zhoupu.py:428 舟谱导入全员账号写死默认口令 `hergent2026`。
  - 中（节选）：einvoice_engine.py 税务 api_key/secret 明文落库(:29-32/91-96)、发票号非原子(:243-251)、事务内30s网络调用(:322-333)；import_zhoupu.py 整表清空无租户守卫(:76-86)；platform.py:385 新建账号 role 未 normalize；Settings.vue:443 Hermes Key 明文 localStorage；CopilotDrawer.vue:90 v-html AI 回复；ReportMapping.vue:334/72-88 failures 与 health 子数组空值守卫；Forecast.vue:7621 saveSnap JSON.parse 无 try；tenant_audit.py:113-126 连接泄漏；metrics.py:42-89 /metrics 无鉴权。
  - 低：28 项（含多处 JSON.parse 无 try、int 无校验、死代码、.xls 正则不一致、emoji/方向符号图标违规、原生 confirm 等）。
- 未提交：laozhangai-product 的 src 多文件 M 未提交；hergent-erp 12 文件 M + 新增 scripts/backup.py、scripts/rollback.sh、db/queries/report_column.py、server/var/（server/var 需确认是否加 .gitignore）。
- 报告落盘：docs/code-review/2026-09-24.md（H1/M1-M3/M9 已逐行复核原始代码）。

---

## ⚙️ 提示词变更（2026-09-26 19:20 · 非执行记录，供下轮识别）

本自动化的**提示词已被重构**（审查维度与扫描边界一条没删，只重排 + 补空 + 加降噪规则）。下轮看到的版本与 09-24~09-26 不同，属正常。
- 新骨架：`一 目标与预期结果 / 二 触发时间 / 三 依赖关系 / 四 红线 / 五 扫描范围 / 六 审查维度 / 七 降噪与去重 / 八 输出要求`。
- **触发时刻未变**（仍 02:00）。
- 新提示词多出三条硬要求：
  1. **降噪**：同一问题连续多轮未修的，汇总表里标「**历史遗留 · 第 N 轮**」只占一行、正文不再重复展开；
  2. **本轮闭环**：上一轮报过、本轮已修好的要写出来（只报新增会造成"问题只增不减"的错觉）；
  3. **去重**：「生产已部署但 git 里没有」那一类**不在本任务展开**，只写「见当日 `docs/prod-inspection/` 报告」——那是 04:00 巡检自动化的范围。
- ⚠️ 已知会撞上的既有历史遗留（下轮应能正确归入「历史遗留」而非当新问题）：`import_zhoupu.py:428` 写死默认口令 `hergent2026`、`copilot_proxy.py:36` 硬编码兜底网关密钥、`Settings.vue:443` Hermes Key 明文 localStorage。
- 改动前提示词逐字存档：`backups/automation-prompts-20260926/A-代码审查-02点-提示词-旧版.md`（1022 字符，md5 `db90d5b4c2d93b9fb33cade3004faf4c`）。
- **下轮必做**：验证新版提示词下「历史遗留轮次」与「本轮闭环」两节是否真的产出。

---

## ⚠️ 非审查记录：同日会话顺延（2026-09-27 傍晚 · v294 实施）

本自动化当日 **02:00 的只读审查已正常产出**；之后**同一天的人工会话继续推进**，把审查发现的问题**改掉了**。
本节只为避免下轮把「已修好」误报成新问题，**不是审查输出**。详见当日 `2026-09-27.md` 与 `topics/version-history.md` 的 v294 段。

- **主题**：报单对象类型轴（一人可报多门店 + 自己仓）。15 文件：后端 7 / 前端 5 / 小程序 3。**未部署**（三端需同步，见下）。
- **本轮闭环（下轮别再报为新问题）**：
  - 🔴 `erp_db.py::report_mapping_list` 的 **SQL 注入**（`counterparty_type` 直插）→ **已参数化**，带判别力验证。
  - `server.py` 里 `round(os.popen(...))` 的**潜伏 TypeError**（os.popen 分支从未工作过）→ 已改 `subprocess.check_output` + `int`。
  - 员工 `warehouse_id` **三处写白名单缺失** → 已补齐；前端新增「报单身份」区块。
- **本轮新发现的历史遗留（下轮可归入「历史遗留」）**：`onboarding` 类文档口径、`update_warehouse` 的 COALESCE 清空问题（已修）等，均记录在当日日志。
- **未部署的硬约束（下轮若见到"改了但线上没变"，先看这条）**：
  本仓有 ~18 个并行会话的未上线在途改动 ⇒ 前端构建产物 53 个中 **29 个**与线上不同、其中仅约 7 个是本轮的
  ⇒ **前端一上线就夹带别人的半成品**。判据：按「逻辑名前缀 + 精确文件名（含内容哈希）」比，**不要用 chunk 名**。
  另：老版小程序不带 `kind`，后端先上线会让 403 出现在新出现的「本人仓」入口上 ⇒ 后端与小程序必须同发。
- **待老板拍板**：A 只发后端 / B 后端 + 小程序（推荐）/ C 等并行会话落定三端齐发。
