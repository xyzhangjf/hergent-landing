# Hergent 记忆索引（只放判据首句 + 去哪查；细节一律 `topics/*.md`）

> 前端构建号 **v724**，下一号 **v725**（`hergent-cn-v2/src/main.js:71`）。v717 对比度/字号 → v718 焦点环/状态/空态 → v719 硬编码色 166→0 → v720 视觉一致与无障碍 → v721 表头冻结 P0 → v722 单滚动区 → v723 深色实心底 45 处 → **v724 视觉回归基线 + 圆角 9 档护栏 + 首屏骨架**。域索引 → `topics/route-index.md`，**动手前按域 grep**。
> 唯一开发源 = `main`；`line-a/v678`、`workbuddy/*` 不再开发 ⇒ 判「修过的 bug 又回来了」先 `git merge-base --is-ancestor <修复commit> HEAD`。
> 🔴 合并/解冲突三教训（`2026-10-31.md`）：冲突块**之外**也有假象（重复 `export`／重复对象键／整段模板被覆盖 ⇒ **构建不报错**）；合并后**必须** `npm test` + `npm run build`；同功能两份客户端 API 按**消费方**取舍。
> 🔴 「改了但用户说没变」第一步查 `window.__HG_BUILD__`（`main.js` 唯一定义）+ `html[data-build]`；SPA 老标签页不重拉 index.html ⇒ 每版手改。判产物不以「dist 存在」为准：`grep -o "v70x" dist/assets/index-*.js`；`mv dist-vNNN dist` 会嵌套 ⇒ 闭包全 200 也能骗过（v637）。

## 路由（🔴=硬判据）
- **前端** → `topics/frontend-ui.md`（4700 行，改前端前必 grep）：入口与门禁唯一源 `pages.js`（未登记=放行，删登记=放宽门禁）｜`permView.js` 唯一源、`module:null`=只读｜文案三禁 ⇒ `hergent-ui-copy-guard`｜图表唯一源 `src/components/chart/`｜列表页冻结/密度/合计 `psi-list.css`｜侧栏系列只删菜单项。副驾 `⌘K`/`⌘⇧K` 已占用 ⇒ 新的用 `⌘⇧O`；外部触发「新建会话」用可消费计数器 `ui.copilotNewTick`+`takeNewTick()`（v649）。
- **后端** → `topics/backend-invariants.md`：路由遮蔽先注册者胜｜静默失效=恒空恒0 ⇒ `undefined-call-scan.py`｜门禁用接口模块非页面模块｜FastAPI 未声明 query 被静默忽略｜意图路由按序首匹配｜`execute_tool` 返回键是 `success`。
- 🔴🔴 **改角色权限必须走 API `POST /api/role-permissions`，不能直接写库**（否则绕过 `reload_perms` 缓存 + 不留 `audit_logs`）；🔴 其合并语义是「未列出的模块 ⇒ 移除」⇒ 必须传**完整清单**。🔴 `roles` 名单（前端 `pages.js`）与 `module` 轴是**两条独立的轴**：给前者≠给后者（v714：supervisor 报表 12 页可见但 `/api/reports/*` 全 403，判据查 `_PATH_MODULE_MAP`）。
- 🔴 **判库存只认 `inventory`**（`quantity`+`stock_value`）；`inventory_balance` 是**空表**（0 行，v714 实测）⇒ 按它判会得出「账面全 0」的假结论。流水 281 条 **100% 是 `change_type='opening'`** ⇒ 判「有没有动过」不能只看流水存在。
- **部署** → `topics/deploy-ops.md`：后端 FLAT `/opt/hergent-erp/`（无 `server/` 前缀）｜前端 `/opt/hergent-cn-v2`｜服务 `hergent-erp.service`｜**rsync 绝不 `--delete`**（`deploy.sh` 内联了它）｜🔴 `https://hergent.cn/` = ERP 前端，`/admin/` = 平台运营控制台（另一应用）⇒ 探针/部署一律用根路径（`/admin/assets/x.js` 永远 200 但返回 index.html，v636）。
- **预报主表** → `topics/forecast-order-domain.md`｜**成本/容量** → `topics/cost-and-capacity.md`｜**返利** → `topics/rebate-domain.md`｜**账务** → `topics/accounting-gl-v716-v717.md`｜**条码小程序** → `topics/miniprogram-and-brand-data.md`。

## 🔴 UI 判据（高频，全文 `topics/frontend-ui.md` 末 200 行）
- 🔴🔴 **判对比度必须 alpha 合成后算、只看实测、四种底色全算**（白/`--bg2`/`--bg3`/**`--bg4 #f0f0f2` 最易漏**；v717 只算两种、在 bg4 差 0.04 返工）。探针只认 `tools/v716-contrast-audit.mjs`——临时探针算不准 `backdrop-filter` 顶栏，误报 147 处而它只剩 1 处 `:disabled`（WCAG 豁免）。🔴 **合成背景从最外层往内层倒序叠**（先收集到第一个不透明再倒序），从元素往外叠遇半透明父级必错（5% 红当 100% 红 ⇒ 6.49 报成 1.47）。
- 🔴 **v717 起对比度已达标**。**改令牌值 > 改用法**：`grep -rho "[a-z-]*:[^;{]*var(--x)"` 看属性分布，某属性 >75% 直接改值（`--t3` 799 处、`--p-dark` 254 处 ⇒ 6 变量修 1400 处）；正则 `var\(--p\)(?!)`，改完按属性前缀复核。
- 🔴🔴 **焦点环别用 `:where()` 降特异性**（v718 返工）：基类 `.input{outline:none}` 同为 (0,1,0) 且后加载 ⇒ 吃掉 315 处；正解叠到 (0,2,0)。🔴 **判焦点必须发真 Tab 键**（程序化 `.focus()` 不触发 `:focus-visible`），等 260ms，认 outline 不认 box-shadow。改控件高度前先 `npm test`（22px 行内控件、34px 顶栏被契约锁死）。
- 🔴 **状态标签病根是「三套并行」不是「缺组件」**：`risk/danger/suc/purple` 全站无定义、只在个别页自写，`risk` 由 `statusOf().cls` 动态返回 ⇒ 换页面同名类**静默变灰**。护栏 `scripts/check-tokens.mjs`。
- 🔴 **v719 起硬编码色归零（166→0）**。清色先分类再删：`var(--tok,#hex)` 兜底可删；引用未定义令牌的**顺序反了会作废声明**（删兜底 = 颜色变透明）。🔴 护栏自身假阳性：任务号 `<!-- #356 -->` 是合法 hex ⇒ 必须 `stripComments()` 剥三类注释，行注释用 `(^|\s)//` 且排除 `://`。
- 🔴🔴 **深色必须单独验，浅色达标 ≠ 深色达标**（v723）：`--p-dark`/`--dan`/`--suc`/`--war` 在深色是**提亮**的（当文字色正确），当白字底全坍（2.43/3.41/2.02/2.05）。⇒ 实心强调底+白字一律 `-solid`；**文字侧用 `-ink`**（`--dan-ink` 深 `#f0908a`）；`background:#fff`+`color:#fff` 深色 1:1。正解是新增**深浅同值**令牌（浅色像素级零变化）。🔴 令牌被局部重写会让全局修复失效（`.btn-primary` 3 页各自重定义）；运行时探针只见当前可见实例（6 页 13 处 vs 源码 25 处）⇒ **规则级扫描才是主口径**。
- 🔴 **前端探针三条**：hash 路由 URL 必须 `https://hergent.cn/#`+path；hash 切换等 **3200ms**；🔴🔴 token 过期时页面**静默回退** `#/workbench`（用户名变「我」）⇒ 会伪造「全站 0 缺陷」，**判全站通过前必须核对节点数量级与用户名**（v723 假读数 0/3304、真读数 20/12333）。
- 🔴🔴 **`.ico{width/height:16px}` 会压掉 `:size`**：SVG 宽高是 presentation attribute，优先级低于**任何** CSS 规则 ⇒ **改属性 = 没改**。护栏锁 `ICON_SIZES={14,16,18,22}`。
- 🔴🔴 **`:active` 别用 `transform:scale()`**：创建层叠上下文与包含块 ⇒ 子级 `position:fixed` 浮层被重新锚定。用 `linear-gradient` 叠色 + `inset` 内阴影。
- 🔴 **兜底 h1 判「可见性」不判「存在性」**：必查 `getClientRects().length>0`；`.sr-only` 用 `clip-path:inset(50%)`；`<h1>` 有 UA `margin:.67em` 需显式 `margin:0`。`Archive.vue` 两页 h1 宽高 0 是自 v501 的刻意设计。
- 🔴 **CSS 规则统计探针三坑**（全假阴性）：`CSSRuleList` 不可 `for...of`（抛错被 catch 吞 ⇒ 读数全 0）；支持嵌套后每条规则都带空 `cssRules`（须先取 `selectorText`）；取选择器主体要按**括号深度**切分（`split(/\s/)` 把 `:where(a, b, c)` 的空格当组合器 ⇒ `matches()` 全 false）。
- 🔴 **Python 替换别用长度不等的占位符**：`page-hd`(7)→`@@DONE@@`(8) 每位吞一字符 ⇒ 88 文件坏。改「按块切片、不回写占位符」。
- 🔴🔴 **AA 下限使「三级灰」实际只能两级**：bg4 上过 4.5 必须 ≤`#6a6a70` ⇒ `--t2` 与 `--t3` 同值（深色 `#b4b4b8`）。别再靠深浅体现层级。
- 🔴 **亮青 `--p #06b6d4` 只能做装饰**（当字/当白字底均 2.43）；实心选中底 `--p-solid`、强调文字 `--p-ink`、主交互 `--p-dark`。**改浅色必须同时配深色**。
- 🔴 **组件造了没人用比没有组件更常见**（v716：`StatusBadge` 0 处、`EmptyState` 6/169）⇒ 先查**采纳率**再谈重构（且要顺组件树看一层）。报「没有 X 按钮」先核它是否已存在（多是不可发现而非缺功能）。
- 🔴🔴 **判对齐只能量文字渲染矩形**（`Range…getBoundingClientRect()`），**盒子差 0 ≠ 对齐**。**自动扫描报「全 0」先过阳性对照**（阈值别取实测常见落点）。
- 🔴 **「默认隐藏某状态+开关」有公共件**（`useInactiveFilter`+`InactiveToggle`，7 页已接）；判据只认 `===0||===false`（**缺失字段当启用**）；**服务端分页页不能改前端过滤**。
- 🔴🔴 **表头 sticky 必须有「有限高 + overflow-y:auto」的父级当舞台**（v720–v722）：无 max-height ⇒ 容器高＝内容高 ⇒ 永不内滚；`overflow:hidden` 祖先吃掉它；**类名写了≠样式存在**。🔴🔴 **`freeze-page` 本仓不成立，别再试** ⇒ **唯一冻结模型 = 表格父级自己当滚动器；要单滚动区就必须让页面不出滚动条**（`flex:1 1 0`；支点 `InventoryShell.vue`/`Archive.vue` 的 `.page{height:100%}`）。判「已冻结」须内滚 400px 复测 + 逐表测。
- 🔴 **改页面前先确认它在不在路由上**：`InvSaleNew`/`InvPurchaseNew` 自 v449 起不在路由 ⇒ 改了零影响。查 `src/router/index.js` + `ls dist/assets`；真正入口是 `new/` 下 7 个薄壳 + 4 个内核（**改内核 = 覆盖多条路由**）。
- 🔴 控件类三条（图标+文字居中 / 同行控件同构 / 挑同类基准）+「复选框禁用 `@click.prevent`」/「看起来能点的必须真能点」→ `topics/frontend-ui.md` 末节。

## 🔴 视觉回归基线 / 圆角 / 加载态（v724，全文 `topics/frontend-ui.md` 末节）
- **工具**：`tools/visual-baseline.mjs`（抓图）+ `tools/visual-diff.py`（PIL 比对，**不给前端加 npm 依赖**）。12 页 × 浅深 = 24 张，基线 `.workbuddy/visual-baseline/` 入库。**没有 puppeteer**（Chrome 153 与 23/25 版冲突）⇒ 用自研 `lib/cdp-lite.mjs`。
- 🔴🔴 **A/A 底噪实测 0 像素**（连抓两次字节相同）⇒ 阈值可压到 `px≥800 且 pct≥0.05`，能抓 40×20 换色。但**渲染噪声（0）与数据噪声（无上界）必须分开**：一行表格 = 4.4%、天气 18°→19° = 61px ⇒ **阈值管不住数据，真正的控制点是抓图时间窗**（改完未部署抓基线、部署后立刻抓候选）。只截视口，管不住滚动区中部。
- 🔴 四条硬校验，不过就 exit 2 **不出基线**：无「登录已过期」/ 节点数≥200 / hash 真在目标路由 / 用户名不是「我」（v723 假「0」的教训）。**「只换名字」的重构应该零差异**：v724 圆角 568 处改完，24 页里 **21 页逐字节相同**、3 页 ≤0.03%。
- 🔴 **圆角 9 档**：`hair 2 / 2xs 4 / xs 6 / sm 8（主档）/ md 12 / lg 16 / xl 22 / pill 999 / circle 50%`，护栏在 `check-tokens.mjs`。**「写死的半高」其实是胶囊**（11px@22px 开关、18px@34px 顶栏钮、5.5px@13px 天气格）⇒ 一律 `--radius-pill`，视觉等价且以后不会坏。`--radius-hair` 单独留档：柔化的是 1px 的边不是组件的角。🔴 护栏第一版漏放行 `!important`，**第一跑就冤枉正确代码**。
- 🔴🔴 **「加载中显示了一个结论」比空白严重**：工作台 KPI 显 `¥0`、要务显「0 项」、近效期显「无临期批次，保持节奏」（风控位说一切正常）。骨架用现成 `.skel-line`（不造新组件）+ `sk-h12`/`sk-h22` 两档高度，**必须与被替代的那行文字等高**否则跳版。`bootLoading` 只盖首屏 await，**不盖 AI**。验证只能在限速下轮询（latency 700ms）。
- 🔴 **数「组件采纳率」要顺着组件树看一层**：`Skeleton.vue` 直接 import 数是 0，但 `ReportTable` 用了它、36/47 报表页走它 ⇒ 判「造了没人用」是错的。

## 🔴 免密码做生产 UI 真机验证（v707，最省事的正路）
生产后端**不是 git 仓**，改它要 `scp` 下来 → `.bak` → `install -o hergent -g hergent -m 644` → `systemctl restart`。登录态：主库 `sessions` join `users`(role='boss') 取 `token`，puppeteer `setCookie` 注入 `erp_token`(httpOnly)+`hergent_auth=1`+`csrf_token`(任意)+`hergent_tenant` ⇒ 以老板身份跑生产页。⚠️ `sessions` **没有 id 列**（用 `created_at`）、`users` **没有 tenant_id**。
- 🔴 **自己插 `sessions` 造临时登录态时，`created_at`/`expires_at`/`last_activity` 必须 `datetime('now','localtime')`**；写 `datetime('now')`（UTC）差 8 小时 ⇒ 直接 **401**（像「token 无效」，v714 实踩）。用完 `delete from sessions where token like '<前缀>%'`。
- 🔴 **免密验证走 `Authorization: Bearer`** ⇒ CSRF 中间件整段豁免；但权限类端点还要 `X-Tenant-Id` 头（`_perms_tenant_or_400` fail-closed，缺了就 400，绝不回落主库）。

## 🔴 结构 / 实现 / 部署判据（原文已搬 → `topics/impl-and-deploy-criteria.md`）
- 🔴 **给表格加列先吃「名称列」宽度**，长文本列 `width+min-width` 同写｜**分页条在滚动容器外**，翻页后 `scrollTop=0`｜**加字段 4 处**（商品 v670 / `hr_employees` v707，且 `employee_create` 有第三份 `allowed` 白名单 ⇒ 先 `grep -c "allowed = \["`）｜`ui_col_prefs` 是**租户级**｜`visibleCols` 元素**没有 `type`**。
- 🔴 **构建** `--emptyOutDir false`（safe-delete 会拦 `rm -rf`，报失败先排它）｜**页面文件名 ≠ 产物 chunk 名**（v706）且每次 build 全部 hash 都变 ⇒ 必须走**闭包补传**｜CSS 改完要量 `getComputedStyle`（v708「规则在产物里 + matches=true + 不生效」成立）｜跨组件覆盖必须写在**目标组件自己文件**（`@media` 不提高特异性）。
- 🔴 **部署必检**：`deploy-frontend-closure.py --push`（最后才传 index.html）+ **curl+`cmp` 逐字节**判产物（脚本报「补传 111」不可信）。
- 🔴 **数字单位跟口径走**（返利 quantity 全是件数）｜**行显隐两份实现**（查看态 `rowVisible` / 编辑态 `rowBaseShown`）｜备份巡检脚本 `check_backup_alive.py` **别删**。

## 🔴 副驾 / 租户 / 内存（全文 `topics/copilot-tenant-memory.md`）
- 🔴 租户边界 = 进程用哪个系统账号（v635）：`gateway_api(tid)` 读该租户 `config.yaml` 的 `platforms.api_server.extra`（端口 `18800+tid`）；解析不到 ⇒ **必须 503，绝不回落根实例**。平台租户 1 = 根实例别名（v642）：凭证/state 走 `_host_home`、PID 走 `_systemd_main_pid`；`_identity_kwargs` 必须 `return []`（v646）。
- 🔴🔴 同一企微 bot 只能一个 websocket 订阅：双连报 `846609` ⇒ 不回消息 + 100% CPU 重连死循环；卡住要 `kill -9` 连 `sudo -u` 包装一起杀。进程外推送必踢长连接（v648，2.2s 自愈）；`hermes send` **必须 `stdin=DEVNULL`**（v647）。`/root/.hermes/gateway_state.json` 会被临时 `hermes send` 写脏（v666）⇒ 判通道还要看 pid 是否 `hermes gateway run`。
- 🔴 **企微「三点动画上下跳」= 我们补丁的字符动画 × 客户端原生动效叠加**（v715）。
- 🔴 判后端内存看 `ps -o rss -p $(systemctl show -p MainPID --value hergent-erp)`，不看 `memory.current`；顶穿 `MemoryHigh` = D 状态锁死。成本 = 入口数 × 常驻进程 ⇒ 接客户就新开一台；闲置租户停不掉；镜像开客户必须先脱敏。
- 🔴 气泡时间只认 `m.created_at`；「打开副驾显示最后一次」= `latestSessionOfRole() || latestSessionOverall()`（v637）；副驾读表 = `spreadsheet_query._run_query`（v638）｜改完 `hermes_tenants.py` 必须重启后端再做「杀掉观察 60s」。

## 进度 / 交付锚
P0/P1 全交付；剩余促销ROI(端点坏死500)/货架位(零数据)/现金流预测页面化。**卖前三关未过；调拨单生产仍 0 张**。BI 指标唯一源 `erp_db.py:_BI_MEASURES`（口径必须 `soi.amount`）；库存周转唯一源 `get_inventory_turnover`。
v714：主管 `reports` 权限已授（4 个 supervisor 账号，12 张报表页）；商品档案 104 条停用 = **88 条纯遗留（保持停用）+ 16 条赠品物料仍压 7,544 件/12,726 元库存**（占 8.1%）⇒ 待老板选「恢复启用」或「报废清零」。全文 `docs/v714-停用商品审计与主管报表权限-2026-11-01.md`。
起号必读 `version-history.md` + 实搜两仓 `git log --all`；前端 `roles` 窄名单非真保险 ⇒ 敏感页必须后端 `_admin` 双保险(v531)。

## 主体 / 脱敏 / 技能 / 本机坑
主体 hergent-cn-v2(`laozhangai-product`)｜hergent-erp(FastAPI+SQLite)。脱敏红线：返利率/进货价/客户名/区域销量/厂家政策；PII 不落 `outputs/`。技能 7 个在 `.workbuddy/skills/`。本机坑 → `topics/local-machine-pitfalls.md`（🔴 `grep "A\|B"` 静默失效 ⇒ 一律 `-e`；🔴 **`grep -E` 里的 `\s` 在本机 BSD grep 不存在**，带空白的匹配会静默返回空（v724 因此一度以为圆角已清干净，实际是 `var(--radius-xs, 6px)` 逗号后有空格）⇒ 查这类先退到字面量子串；`&&` 短路；`| head -N` 截命中；`grep -rl` 只搜顶层；ssh 嵌 python 引号 ⇒ 写远端脚本；`pkill -f x` 会杀掉执行它的 shell）。
- 🔴 **`git commit -m "…含 `{}` 或反引号…"` 在 zsh 里 parse error ⇒ 提交静默失败**，随后 `git push` 报 `Everything up-to-date`（v708 实踩）⇒ 提交一律 `git commit -F-`。
