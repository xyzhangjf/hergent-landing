# Hergent 记忆索引（只放判据首句 + 去哪查；细节一律 `topics/*.md`）

> 前端构建号 **v728**，下一号 **v729**（`hergent-cn-v2/src/main.js:71`）。近期：v724 视觉回归基线+圆角 9 档 → v725 加载态不先下结论 → v726 加载态形态统一 → v727 字号/间距令牌化（6160 处，零视觉变化）→ **v728 行高令牌化 11 档（434 处）**。逐版细节 → `topics/version-history.md`；域索引 → `topics/route-index.md`，**动手前按域 grep**。
> 唯一开发源 = `main`；`line-a/v678`、`workbuddy/*` 不再开发 ⇒ 判「修过的 bug 又回来了」先 `git merge-base --is-ancestor <修复commit> HEAD`。
> 🔴 合并/解冲突三教训（`2026-10-31.md`）：冲突块**之外**也有假象（重复 `export`／重复对象键／整段模板被覆盖 ⇒ **构建不报错**）；合并后**必须** `npm test` + `npm run build`；同功能两份客户端 API 按**消费方**取舍。
> 🔴 「改了但用户说没变」第一步查 `window.__HG_BUILD__` + `html[data-build]`；SPA 老标签页不重拉 index.html ⇒ 每版手改。判产物别只看「dist 存在」：`grep -o "v70x" dist/assets/index-*.js`；`mv dist-vNNN dist` 会嵌套 ⇒ 闭包全 200 也能骗过。

## 路由（🔴=硬判据）
- **前端** → `topics/frontend-ui.md`（5300 行，改前端前必 grep）：入口与门禁唯一源 `pages.js`（未登记=放行，删登记=放宽门禁）｜`permView.js` 唯一源、`module:null`=只读｜文案三禁 ⇒ `hergent-ui-copy-guard`｜图表唯一源 `src/components/chart/`｜列表页冻结/密度/合计 `psi-list.css`｜侧栏系列只删菜单项。副驾 `⌘K`/`⌘⇧K` 已占用 ⇒ 新的用 `⌘⇧O`；外部触发「新建会话」用可消费计数器 `ui.copilotNewTick`+`takeNewTick()`。
- **后端** → `topics/backend-invariants.md`：路由遮蔽先注册者胜｜静默失效=恒空恒0 ⇒ `undefined-call-scan.py`｜门禁用接口模块非页面模块｜FastAPI 未声明 query 被静默忽略｜意图路由按序首匹配｜`execute_tool` 返回键是 `success`。
- 🔴🔴 **改角色权限必须走 API `POST /api/role-permissions`，不能直接写库**（否则绕过 `reload_perms` 缓存 + 不留 `audit_logs`）；合并语义「未列出的模块 ⇒ 移除」⇒ 必须传**完整清单**。🔴 `roles` 名单（`pages.js`）与 `module` 轴是**两条独立的轴**：给前者≠给后者（判据查 `_PATH_MODULE_MAP`）。
- 🔴 **判库存只认 `inventory`**（`quantity`+`stock_value`）；`inventory_balance` 是**空表**（0 行）⇒ 按它判得「账面全 0」的假结论。流水 281 条 **100% 是 `change_type='opening'`** ⇒ 判「有没有动过」不能只看流水。
- **部署** → `topics/deploy-ops.md`：后端 FLAT `/opt/hergent-erp/`（无 `server/` 前缀）｜前端 `/opt/hergent-cn-v2`｜服务 `hergent-erp.service`｜**rsync 绝不 `--delete`**｜🔴 `https://hergent.cn/` = ERP 前端，`/admin/` = 平台运营控制台（另一应用）⇒ 探针/部署一律用根路径（`/admin/assets/x.js` 永远 200 但返回 index.html）。
- **预报主表** → `topics/forecast-order-domain.md`｜**成本/容量** → `topics/cost-and-capacity.md`｜**返利** → `topics/rebate-domain.md`｜**账务** → `topics/accounting-gl-v716-v717.md`｜**条码小程序** → `topics/miniprogram-and-brand-data.md`。

## 🔴 UI 判据（高频，全文 `topics/frontend-ui.md` 末 300 行）
- 🔴🔴 **令牌化最大的阻力是契约，不是习惯**（v727）：5 个尺寸契约用 `parseFloat` 吃裸 px，遇 `var()` 得 NaN ⇒ 换令牌当场挂测试。**这才是字号采纳率 3% 的根因**。修法是让 `tests/lib/tokens.mjs` 解析 var/calc/倍数行高，契约比**数值**不比源码文本。🔴 改完必做阳性对照（注入坏值看是否真报错），否则「通过」可能只是解析成 null 被 `?? 默认值` 兜住。
- 🔴🔴 **批量迁移脚本必须与护栏共用同一套判据**（v728）：迁移只做 px→令牌换算、没判「这是不是高度」，而护栏看到 `var(--lh-*)` 就放行 ⇒ **「迁移改错 + 护栏放行」同时发生，两边都看着正常**。`height:15px;line-height:15px` 这类徽标被改成 1.4 倍（15.4px）。⇒ 迁移前先问「护栏会因为什么放行」，否则它专挑护栏的漏洞改。
- 🔴 **「用 line-height 当高度」是独立一类，不能并进行高归一**（v728，24 处）：判据=同块有 height/min-height 且与行高差 ≤2px（2px=边框）。`0`（消除 inline-block 空白符，**不是"行高为 1"**）/`normal`/`var(--fc-cell)` 同理保留。🔴 行高令牌必须用**倍数**不用 px（字号会变，写死 px 就不同步）；倍数额回不到整数 px ⇒ 契约要比「行高是否撑满 min-height」，不比「是否写了 18px」。
- 🔴 **缺的不是令牌，是「令牌被使用」**：圆角有 prebuild 检查 ⇒ 采纳 100%；字号 3%、间距 0%。**护栏驱动采纳**，没护栏的令牌 = 死令牌。
- 🔴🔴 **判对比度必须 alpha 合成后算、只看实测、四种底色全算**（含 `--bg4 #f0f0f2` 最易漏）。探针只认 `tools/v716-contrast-audit.mjs`（临时探针算不准 `backdrop-filter` 顶栏）。🔴 **合成背景从最外层往内层倒序叠**（先收集到第一个不透明再倒序），从元素往外叠遇半透明父级必错。
- 🔴 **改令牌值 > 改用法**：`grep -rho "[a-z-]*:[^;{]*var(--x)"` 看属性分布，某属性 >75% 直接改值。
- 🔴🔴 **焦点环别用 `:where()` 降特异性**：基类 `.input{outline:none}` 同为 (0,1,0) 且后加载 ⇒ 吃掉 315 处；正解叠到 (0,2,0)。🔴 **判焦点必须发真 Tab 键**（程序化 `.focus()` 不触发 `:focus-visible`），认 outline 不认 box-shadow。改控件高度前先 `npm test`（22px 行内控件、34px 顶栏被契约锁死）。
- 🔴 **状态标签病根是「三套并行」不是「缺组件」**：`risk/danger/suc/purple` 全站无定义、只在个别页自写 ⇒ 换页面同名类**静默变灰**。
- 🔴 **硬编码色已归零（166→0）**。清色先分类再删：`var(--tok,#hex)` 兜底可删；引用未定义令牌的**顺序反了会作废声明**（删兜底=颜色变透明）。🔴 护栏假阳性：任务号 `<!-- #356 -->` 是合法 hex ⇒ 必须 `stripComments()` 剥三类注释，行注释用 `(^|\s)//` 且排除 `://`。
- 🔴🔴 **深色必须单独验，浅色达标 ≠ 深色达标**：`--p-dark`/`--dan`/`--suc`/`--war` 在深色是**提亮**的，当白字底全坍。⇒ 实心强调底+白字一律 `-solid`；**文字侧用 `-ink`**。🔴 令牌被局部重写会让全局修复失效；运行时探针只见当前可见实例 ⇒ **规则级扫描才是主口径**。
- 🔴 **前端探针三条**：hash 路由 URL 必须 `https://hergent.cn/#`+path；hash 切换等 **3200ms**；🔴🔴 token 过期时页面**静默回退** `#/workbench`（用户名变「我」）⇒ 会伪造「全站 0 缺陷」，**判通过前必须核对节点数量级与用户名**。
- 🔴🔴 **`.ico{width/height:16px}` 会压掉 `:size`**：SVG 宽高是 presentation attribute，优先级低于**任何** CSS 规则 ⇒ **改属性 = 没改**。护栏锁 `{14,16,18,22}`。
- 🔴🔴 **`:active` 别用 `transform:scale()`**：创建层叠上下文与包含块 ⇒ 子级 `position:fixed` 浮层被重新锚定。用渐变叠色 + `inset` 内阴影。
- 🔴 **判「可见性」不判「存在性」**：必查 `getClientRects().length>0`；`.sr-only` 用 `clip-path:inset(50%)`；`<h1>` 有 UA `margin:.67em` 需显式归零。
- 🔴 **CSS 规则统计探针三坑**（`CSSRuleList` 不可 `for...of`／嵌套规则带空 `cssRules`／选择器按括号深度切）→ 全文 `topics/frontend-ui.md`。
- 🔴🔴 **AA 下限使「三级灰」实际只能两级**：bg4 上过 4.5 必须 ≤`#6a6a70` ⇒ `--t2` 与 `--t3` 同值。别再靠深浅体现层级。
- 🔴 **亮青 `--p #06b6d4` 只能做装饰**（当字/当白字底均 2.43）；实心选中底 `--p-solid`、强调文字 `--p-ink`、主交互 `--p-dark`。**改浅色必须同时配深色**。
- 🔴 **组件造了没人用比没有组件更常见** ⇒ 先查**采纳率**再谈重构（且要顺组件树看一层）。报「没有 X 按钮」先核它是否已存在（多是不可发现而非缺功能）。
- 🔴🔴 **判对齐只能量文字渲染矩形**（`Range…getBoundingClientRect()`），**盒子差 0 ≠ 对齐**。**自动扫描报「全 0」先过阳性对照**（阈值别取实测常见落点）。
- 🔴 **「默认隐藏某状态+开关」有公共件**（`useInactiveFilter`+`InactiveToggle`）；判据只认 `===0||===false`（**缺失字段当启用**）；**服务端分页页不能改前端过滤**。
- 🔴🔴 **表头 sticky 必须有「有限高 + overflow-y:auto」的父级当舞台**：无 max-height ⇒ 容器高＝内容高 ⇒ 永不内滚；`overflow:hidden` 祖先吃掉它；**类名写了≠样式存在**。🔴🔴 **`freeze-page` 本仓不成立，别再试** ⇒ **唯一冻结模型 = 表格父级自己当滚动器；要单滚动区就必须让页面不出滚动条**。判「已冻结」须内滚 400px 复测 + 逐表测。
- 🔴 **改页面前先确认它在不在路由上**：`InvSaleNew`/`InvPurchaseNew` 自 v449 起不在路由 ⇒ 改了零影响。真正入口是 `new/` 下 7 个薄壳 + 4 个内核（**改内核 = 覆盖多条路由**）。
- 🔴 控件类三条（图标+文字居中 / 同行控件同构 / 挑同类基准）+「复选框禁用 `@click.prevent`」/「看起来能点的必须真能点」→ `topics/frontend-ui.md` 末节。

## 🔴 视觉回归 / 圆角 / 加载态 / 行高（v724–v728，全文 `topics/frontend-ui.md` 末四节）
- **工具**：`tools/visual-baseline.mjs` + `tools/visual-diff.py`（PIL 比对，**不给前端加 npm 依赖**）。12 页 × 浅深 = 24 张，基线 `.workbuddy/visual-baseline/` 入库。**没有 puppeteer** ⇒ 用自研 `lib/cdp-lite.mjs`。⚠️ `goto(url, settleMs)` 第二参是**等待毫秒**不是超时。
- 🔴🔴 **A/A 底噪实测 0 像素** ⇒ 阈值 `px≥800 且 pct≥0.05`，能抓 40×20 换色。但**渲染噪声（0）与数据噪声（无上界）必须分开**：一行表格=4.4%、天气换数字=61px ⇒ **阈值管不住数据，控制点是抓图时间窗**。
- 🔴 四条硬校验不过就 exit 2 不出基线：无「登录已过期」/ 节点数≥200 / hash 真在目标路由 / 用户名不是「我」。**「只换名字」的重构应该零差异**：v724 圆角 568 处改完 21/24 页逐字节相同；v727 令牌化 6160 处 24/24 全过。🔴 **有差异时先查是不是「整体位移」**（v728）：特征是「下游元素 top 同向等量变化、height 全部不变」= 无害；某元素被挤高/换行才是 bug。归因法=注入回退值再截图比基线（10 页全部归到 2 个源头）。
- 🔴 **圆角 9 档**：`hair 2 / 2xs 4 / xs 6 / sm 8（主档）/ md 12 / lg 16 / xl 22 / pill 999 / circle 50%`。**「写死的半高」其实是胶囊** ⇒ 一律 `--radius-pill`。`--radius-hair` 单独留档：柔化的是 1px 的边不是组件的角。
- 🔴 **字号 12 档 / 间距 12 档（含 5 个 `-h` 过渡档）**，全部走令牌，护栏已挂 prebuild。🔴 `-h` 档是**过渡**不是设计目标，P1 归一时只改令牌一行、再跑视觉回归。行高仍未令牌化（同字号最多 18 种行高）⇒ 单独一版。
- 🔴🔴 **「加载中显示了一个结论」比空白严重**：空白让人等一下，结论让人放心走开。**三个病根**：① 用 `.state-empty` 画「加载中…」；② `loading` 初始 `false` ⇒ `onMounted` 在首帧之后才跑 ⇒ 闪一下错误结论，凡 onMounted 必发的请求初始取 `true`；③ 一页多块并发只护一块 ⇒ **每块独立标志**。
- 🔴🔴 **判「加载中会不会误报」要看祖先**：`#extra` 整块在 `<template v-else>` 内 ⇒ loading 时根本不渲染，加 `v-else-if="loading"` 是死代码（**信号是「骨架峰值为 0」= 这段代码没跑过**）。
- 🔴🔴 **测加载态只能延迟 API，不能全局限速**：`emulateNetworkConditions` 下 SPA 主包没下完、Vue 未挂载 ⇒ 全报「无骨架」（假阴性）。用 `addInitScript` 只延迟 `fetch('/api/…')`。副产品判据：API 延迟 1.1s ⇒ 首渲染后 1 秒内的 `.state-empty` 必是误报。
- 🔴🔴 **骨架判据按语义收集全部载体**，全站六种：`.state-empty`／`.ui-skeleton`（`Skeleton.vue`）／`.tbl-skeleton`／`.ch-skel`（图表）／`.skel-line`+`.sk-block`／`.pc-empty`·`.br-state`·`.hint`。**同一个错犯过三次** ⇒ **「整页无骨架」这类清单必须先读源码再动手**：v725 的「13 页」核完只有 3 页要改，另 4 页是上传/表单页**本来就不该有骨架**。
- 🔴🔴 **加载中露出「可提交的假值」比露出结论更严重**（算工资页 `form` 硬编码 5000/0%）⇒ **骨架只盖视觉，盖不住「已渲染成可编辑表单」**，这类必须 `v-if="!loading"` 整个不渲染。变体：**切换主体（客户/仓库/账期）必须立刻清空旧数据**，否则表格里是别人的账。
- 🔴 **探针卡死要区分「产品慢」与「工具坏」**：`/funds/party-reconcile` 反复让 CDP 卡死（换 `addInitScript` 也没用），另一页「等 6300ms 才归零」则是真的慢 ⇒ 别用修产品的耐心去修探针。

## 🔴 免密码做生产 UI 真机验证（v707，全文 → `topics/deploy-ops.md`）
生产后端**不是 git 仓**（改它要 scp + `.bak` + `install -o hergent` + restart）。登录态取主库 `sessions` join `users`(role='boss')，注入 `erp_token`+`hergent_auth=1`+`csrf_token`+`hergent_tenant`。
- 🔴 **自己插 `sessions` 时三个时间列必须 `datetime('now','localtime')`**；写 `datetime('now')`（UTC）差 8 小时 ⇒ 直接 401（像 token 无效）。用完按前缀删干净。
- 🔴 免密验证走 `Authorization: Bearer` ⇒ CSRF 整段豁免；权限类端点还要 `X-Tenant-Id`（缺了就 400，绝不回落主库）。

## 🔴 结构 / 实现 / 部署判据（原文 → `topics/impl-and-deploy-criteria.md`）
- 🔴 **给表格加列先吃「名称列」宽度**，长文本列 `width+min-width` 同写｜**分页条在滚动容器外**，翻页后 `scrollTop=0`｜**加字段 4 处**（且 `employee_create` 有第三份 `allowed` 白名单 ⇒ 先 `grep -c "allowed = \["`）｜`ui_col_prefs` 是**租户级**｜`visibleCols` 元素**没有 `type`**。
- 🔴 **构建** `--emptyOutDir false`（safe-delete 会拦 `rm -rf`）｜**页面文件名 ≠ 产物 chunk 名**且每次 build 全部 hash 都变 ⇒ 必须走**闭包补传**｜CSS 改完要量 `getComputedStyle`（「规则在产物里 + matches=true + 不生效」成立）｜跨组件覆盖必须写在**目标组件自己文件**。
- 🔴 **部署必检**：`deploy-frontend-closure.py --push`（最后才传 index.html）+ **curl+`cmp` 逐字节**判产物。
- 🔴 **数字单位跟口径走**｜**行显隐两份实现**（查看态 `rowVisible` / 编辑态 `rowBaseShown`）｜`check_backup_alive.py` **别删**。

## 🔴 副驾 / 租户 / 内存（全文 `topics/copilot-tenant-memory.md`）
- 🔴 租户边界 = 进程用哪个系统账号：`gateway_api(tid)` 读该租户 `config.yaml` 的 `platforms.api_server.extra`（端口 `18800+tid`）；解析不到 ⇒ **必须 503，绝不回落根实例**。平台租户 1 = 根实例别名。
- 🔴🔴 同一企微 bot 只能一个 websocket 订阅：双连报 `846609` ⇒ 不回消息 + 100% CPU 重连死循环。`hermes send` **必须 `stdin=DEVNULL`**；`gateway_state.json` 会被临时 send 写脏 ⇒ 判通道还要看 pid 是否 `hermes gateway run`。
- 🔴 判后端内存看 `ps -o rss -p $(systemctl show -p MainPID --value hergent-erp)`，不看 `memory.current`；顶穿 `MemoryHigh` = D 状态锁死。成本 = 入口数 × 常驻进程 ⇒ 接客户就新开一台；镜像开客户必须先脱敏。

## 进度 / 交付锚
P0/P1 全交付；剩余促销ROI(端点坏死500)/货架位(零数据)/现金流预测页面化。**卖前三关未过；调拨单生产仍 0 张**。BI 指标唯一源 `erp_db.py:_BI_MEASURES`（口径必须 `soi.amount`）。
v714：主管 `reports` 已授；商品档案 104 条停用中 **16 条赠品物料仍压 7,544 件/12,726 元库存** ⇒ 待老板选「恢复启用」或「报废清零」。
起号必读 `topics/version-history.md` + 实搜两仓 `git log --all`；前端 `roles` 窄名单非真保险 ⇒ 敏感页必须后端 `_admin` 双保险。

## 主体 / 脱敏 / 本机坑
主体 hergent-cn-v2(`laozhangai-product`)｜hergent-erp(FastAPI+SQLite)。脱敏红线：返利率/进货价/客户名/区域销量/厂家政策；PII 不落 `outputs/`。本机坑 → `topics/local-machine-pitfalls.md`（🔴 `grep "A\|B"` 静默失效 ⇒ 一律 `-e`；🔴 **BSD grep 没有 `\s`** ⇒ 带空白的匹配静默返回空；`&&` 短路；`| head -N` 截命中；`grep -rl` 只搜顶层；ssh 嵌 python 引号 ⇒ 写远端脚本）。
- 🔴 **`git commit -m` 含 `{}` 或反引号在 zsh 里 parse error ⇒ 提交静默失败**，随后 push 报 `Everything up-to-date` ⇒ 一律 `git commit -F-`。
- 🔴 **统计代码里的样式值必须先遮罩注释**：注释里的说明文字（`` `padding:10px 14px` `` 带反引号）会被算成真实用法（v727 因此虚报「75 处残余」，实际 4 处）。
