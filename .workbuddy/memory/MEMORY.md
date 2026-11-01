# Hergent 记忆索引（只放判据首句 + 去哪查；细节一律 `topics/*.md`）

> 前端构建号 **v720**，下一号 **v721**（`hergent-cn-v2/src/main.js:71`）。v714–v716 无发版；v717 修 P0（对比度+字号）、v718 P1（焦点环/令牌/状态与空态）、v719 P2 + 硬编码色 166→0、**v720 全站视觉一致性与无障碍**（按下态 0→43%、图标 11→4 档、圆角 15→11 档、无标签控件 72→0、h1 3/9→10/10）。域索引 → `topics/route-index.md`，**动手前按域 grep**。
> 唯一开发源 = `main`（v705 `02a1b28` 合并完两线）；`line-a/v678`、`workbuddy/*` 不再开发 ⇒ 判「修过的 bug 又回来了」先 `git merge-base --is-ancestor <修复commit> HEAD`。
> 🔴 合并/解冲突三教训（`2026-10-31.md`）：冲突块**之外**也有假象（重复 `export`／重复对象键／整段模板被覆盖 ⇒ **构建不报错**）；合并后**必须** `npm test` + `npm run build`；同功能两份客户端 API 按**消费方**取舍。
> 🔴 「改了但用户说没变」第一步查构建号 `window.__HG_BUILD__`（`main.js` 唯一定义）+ `html[data-build]`；SPA 老标签页不重拉 index.html ⇒ 每版手改。判产物不以「dist 存在」为准：`grep -o "v70x" dist/assets/index-*.js`；`mv dist-vNNN dist` 会嵌套 ⇒ 闭包全 200 也能骗过（v637）。

## 路由（🔴=硬判据）
- **前端** → `topics/frontend-ui.md`（4700 行，改前端前必 grep）：入口与门禁唯一源 `pages.js`（未登记=放行，删登记=放宽门禁）｜`permView.js` 唯一源、`module:null`=只读｜文案三禁 ⇒ `hergent-ui-copy-guard`｜图表唯一源 `src/components/chart/`｜列表页冻结/密度/合计 `psi-list.css`｜侧栏系列只删菜单项。副驾快捷键 `⌘K`/`⌘⇧K` 已占用 ⇒ 新的用 `⌘⇧O`；外部触发「新建会话」用可消费计数器 `ui.copilotNewTick`+`takeNewTick()`（v649）。
- **后端** → `topics/backend-invariants.md`：路由遮蔽先注册者胜｜静默失效=恒空恒0 ⇒ `undefined-call-scan.py`｜门禁用接口模块非页面模块｜FastAPI 未声明 query 被静默忽略｜意图路由按序首匹配｜`execute_tool` 返回键是 `success`。
- 🔴🔴 **改角色权限必须走 API `POST /api/role-permissions`，不能直接写库**（否则绕过 `reload_perms` 缓存 + 不留 `audit_logs`）；🔴 其合并语义是「未列出的模块 ⇒ 移除」⇒ 必须传**完整清单**（传 `["reports"]` 会删光该角色原模块）。🔴 `roles` 名单（前端 `pages.js`）与 `module` 轴是**两条独立的轴**：给前者≠给后者（v714：supervisor 报表 12 页可见但 `/api/reports/*` 全 403，判据查 `_PATH_MODULE_MAP`）。
- 🔴 **判库存只认 `inventory`**（`quantity`+`stock_value`）；`inventory_balance` 是**空表**（0 行，v714 实测）⇒ 按它判会得出「账面全 0」的假结论。流水 281 条 **100% 是 `change_type='opening'`**（10-29 期初，`ref_type='v728_stock_snapshot'`）⇒ 判「有没有动过」不能只看流水存在。
- **部署** → `topics/deploy-ops.md`：后端 FLAT `/opt/hergent-erp/`（无 `server/` 前缀）｜前端 `/opt/hergent-cn-v2`｜服务 `hergent-erp.service`｜**rsync 绝不 `--delete`**（`deploy.sh` 内联了它）｜🔴 `https://hergent.cn/` = ERP 前端，`/admin/` = 平台运营控制台（另一应用）⇒ 探针/部署一律用根路径（`/admin/assets/x.js` 永远 200 但返回 index.html，v636）。
- **预报主表** → `topics/forecast-order-domain.md`｜**成本/容量** → `topics/cost-and-capacity.md`｜**返利** → `topics/rebate-domain.md`｜**账务** → `topics/accounting-gl-v716-v717.md`｜**条码小程序** → `topics/miniprogram-and-brand-data.md`。

## 🔴 UI 判据（高频，全文 `topics/frontend-ui.md` 末 200 行）
- 🔴🔴 **判对比度必须 alpha 合成后算、只看实测、四种底色全算**（白 / `--bg2` / `--bg3` / **`--bg4 #f0f0f2` 最易漏**；v717 只算前两种、在 bg4 差 0.04 返工）。探针只认 `tools/v716-contrast-audit.mjs`（import 已修 `./lib/cdp-lite.mjs`）—— 临时探针算不准 `backdrop-filter` 顶栏，会误报 147 处「2.21:1」，而它只剩 1 处 `:disabled`（WCAG 豁免）。
- 🔴 **v717 起全站对比度已达标**。**改令牌值 > 改用法**：`grep -rho "[a-z-]*:[^;{]*var(--x)"` 统计属性分布，某属性 >75% 就直接改值（`--t3` 799 处 color、`--p-dark` 254、`--suc/--dan/--war` 250 ⇒ 6 变量修 1400 处、组件零改动）；分散多属性才拆令牌。正则 `var\(--p\)(?!-)`（否则连 `border-color`/`accent-color` 一起替换，v717 误伤 80 处）；改完按属性前缀分组复核。
- 🔴🔴 **焦点环别用 `:where()` 降特异性**（v718 返工）：基类 `.input{outline:none}` 同为 (0,1,0) 且后加载 ⇒ 吃掉 315 处。正解叠伪类到 (0,2,0)：`:where(…):focus-visible:focus-visible`。判焦点**必须等 260ms**（`transition:all` 把 outline 动画、采样到中间态）且**认 outline 不认 box-shadow**；判「焦点不可用」先注入 `*{outline:none}` 过阳性对照（v716：14 处「有指示」实为浏览器 `outline:auto`、同屏 3 种宽度 ⇒ 结论是「不受控」非「没有」）。铁律：改控件高度前先 `npm test`（22px 建单页行内控件、34px 顶栏被契约锁死）。
- 🔴 **状态标签病根是「三套并行」不是「缺组件」**（v718）：`risk/danger/suc/purple` 全站无定义、只在个别页自写，而 `risk` 由 `statusOf().cls` 动态返回 ⇒ 换页面同名类**静默变灰**；`.state-empty` 也全局定义过两遍。护栏 `scripts/check-tokens.mjs`（挂 `prebuild`，新色即构建失败）。
- 🔴🔴 **v719 起硬编码色归零（166→0、45→0 文件）+ 27 条图表调色板豁免；护栏 `0/0`**。清色**先分类再删**：70 条是 `var(--tok,#hex)` **兜底值**（令牌已定义 ⇒ 删零风险，且消除「令牌漏定义⇒深色模式静默回退浅色」）；35 处引用的 12 个令牌（`--brand/--pri/--line/--bad/--warn-*`）**全站从未定义** ⇒ 兜底一直生效 ⇒ 各页在用自创主色（报表蓝 `#2b6cb0`、副驾蓝 `#2f6bff`，站内主色是青 `#0e7490`）⇒ 补齐时**一律指向 canonical 令牌**。**顺序反了会作废声明**（删掉未定义令牌的兜底 = 颜色变透明）。
- 🔴 **护栏自己有假阳性**：任务号 `<!-- #356：… -->`／`// #357` 都是**合法 hex 字符** ⇒ 单文件虚报 4 条。必须 `stripComments()` 剥三类注释，行注释用 `(^|\s)//` 且**排除 `://`**。一条假阳性就让人想整体关掉护栏。
- 🔴🔴 **原生 `<input type=checkbox>` 是 replaced element，`::before/::after` 不渲染** ⇒ 扩热区只能包 `<label>`（原生关联，不打架 `v-model`）；81 处里 **70 处已包在 `<label class="check-item">`**、热区是整行（评审只量了 input 本体 13×13）。统一用全局 `.cb-hit`，不各页抄副本。「全选/清空」类裸控件要挂文字时也在**调用方包 label**（`SelectAllCheckbox.vue` 是全站唯一源）。
- 🔴 **前端探针三条**：hash 路由 ⇒ URL 必须 `https://hergent.cn/#` + path（写 `/archive/products` 全被重定向到 `#/workbench`，表现为「九页节点数完全相同」）｜hash 切换等 **3200ms**（2600 误判 h1=0）｜token 过期时页面**静默回退** `#/workbench`（用户名变「我」）。
- 🔴🔴 **`.ico{width/height:16px}` 会压掉 `:size` 属性**（v720）：SVG `width/height` 是 **presentation attribute**，优先级低于**任何** CSS 规则 ⇒ 11 档 `size` 全压平，实测 77.8% 渲染 16×16（`attr=13 → box=16`）。改控件尺寸若只改属性、CSS 有同名规则 = 没改。护栏锁 `ICON_SIZES={14,16,18,22}`。
- 🔴🔴 **`:active` 别用 `transform:scale()`**（v720）：创建层叠上下文与包含块，元素内 `position:fixed/absolute` 子级（下拉/浮层）被重新锚定 ⇒ 点一下面板就飞。用 `linear-gradient` 叠色 + `inset` 内阴影。附：「全站唯一缺失的交互态」要**枚举全部规则**（含嵌套）统计 —— `:active` 当时仅 4 条 vs 939 个可交互元素。
- 🔴 **兜底 h1 的判据是「可见性」不是「存在性」**（v720）：`display:none` 同时不在无障碍树 ⇒ 必须 `getClientRects().length > 0`，否则 `Archive.vue` 那两页会被误判「已有 h1」。`.sr-only` 用 `clip-path:inset(50%)`，别 `left:-9999px`（RTL/打印翻车）。`.page-hd` 内 h2→h1 两坑（v719）：写 `.page-hd :is(h1,h2)` 双代兼容（`Forecast.vue` 的 `:deep()` 隐藏规则依赖该选择器）；`<h1>` 有 UA `margin:0.67em` ⇒ 显式 `margin:0`；`Archive.vue` 自 v501 **刻意** `display:none` 页头 ⇒ 档案两页 h1 宽高 0 是设计不是缺陷。
- 🔴🔴 **写 CSS 规则统计探针三个坑**（v720，全是假阴性）：① `CSSRuleList` **不可 `for...of` 迭代**，抛 `TypeError` 被 `try/catch` 吞 ⇒ 读数全 0；② 支持 CSS 嵌套后**每条样式规则都带空 `cssRules`**（对象恒真）⇒ `if (r.cssRules) continue` 把所有规则当容器跳过 ⇒ **先取 `selectorText` 再决定下沉**；③ 取选择器主体要**按括号深度切分**，`split(/\s/)` 把 `:where(a, b, c)` 的空格当组合器 ⇒ `matches()` 全 false（真实 315 处判成 36 处）。三坑叠加能让「已达标」变「覆盖率 4%」。
- 🔴 **Python 替换不要用长度不等的占位符**：`page-hd`(7) 换 `@@DONE@@`(8) 每位吞一字符 ⇒ 88 文件变 `class="page-hd>`，构建才报 `Attribute name cannot contain U+0022`。改用「按块切片、不回写占位符」。
- 🔴🔴 **AA 下限使「三级灰」实际只能两级**：bg4 上过 4.5 必须 ≤`#6a6a70` ⇒ `--t2` 与 `--t3` 同取 `#6a6a70`（深色同 `#b4b4b8`）。别再靠 t2/t3 深浅体现层级。
- 🔴 **亮青 `--p #06b6d4` 只能做装饰**（当文字/当白字底均 2.43）；实心选中底 `--p-solid`、强调文字 `--p-ink`、主交互 `--p-dark`。**改浅色必须同时配深色**（`.df-role` 9 角色原零深色覆盖，只改浅色会让深色掉到 1.86）。
- 🔴 **组件造了没人用比没有组件更常见**（v716：`EmptyState` 6/169、`StatusBadge` **0**、`ConfirmDialog` 1 ⇒ 空态 12 种自定义类名、状态色失控）⇒ 先查**采纳率**再谈重构。报「没有 X 按钮」先核 X 是否已存在（v709：多是不可发现而非缺功能）⇒ 调用方包 `<label>`+`<span>`，**别改共享件**。
- 🔴🔴 **判对齐只能量文字渲染矩形** `Range.selectNodeContents().getBoundingClientRect()`，**盒子差 0 ≠ 对齐**（v710：盒子全 0 而文字差 0.5px）；`line-height` 跟邻居同用 `normal`。**自动扫描报「全 0」先过阳性对照**（v711：阈值 `<=0.5` 吃掉实测 0.500 ⇒ 改 `<0.4`；阈值别取实测常见落点）。
- 🔴 **「默认隐藏某状态+开关」有公共件**（v713：`useInactiveFilter`+`InactiveToggle`，7 页已接）⇒ 新页直接套；判据只认 `===0||===false`（**缺失字段当启用**，写 `!x` 会藏光整表）；**服务端分页页不能改前端过滤**（用后端 total 验，DOM 行数恒等 pageSize）；判「哪些页该做」看**库里的数据分布**不是代码候选数。
- 🔴 **探针纪律**：fetch 桩用 `addInitScript`（`eval` 会被 reload 清掉）+ 断言 `__stubHit>0`；每场景前 `Page.reload`（浮层吃掉下次点击）；`screenshot()` 必判空（`clip` 缺 `scale` 静默返回空串）；取列别写死 `td` 索引；滤掉 `/index.html?_v=` 轮询；数行数别数 `tbody tr`（虚拟滚动）也别读 `body.innerText`（headless 可能空串）⇒ 直接查接口。
- 🔴 控件类三条（图标+文字居中 / 同行控件同构 / 挑同类基准）+「UI 不统一先怀疑样式缺失」/「复选框禁用 `@click.prevent`」/「看起来能点的必须真能点」/「全选类裸控件包 label」→ 已搬 `topics/frontend-ui.md` 末节（护栏 `v676e-orphan-check.py`、`guard-checkbox-change.py`）。
- 🔴🔴 **表头 sticky 只写声明没用，必须有「有限高 + overflow-y:auto」容器当舞台**（v720 审计 161 表定论）：全局 `.table-wrap` 只有 `overflow-x:auto` **无 max-height** ⇒ 容器高＝内容高 ⇒ 永不纵向滚 ⇒ sticky 全失效；`freeze-list` 可靠就因为它自带 `max-height:calc(100vh-240px)`（v512）。**第二种失效：`overflow:hidden` 祖先会吃掉 sticky**（`ProductTarget` 的 `.pt-card`）。**类名写了≠样式存在**（`.tbl-wrap` 全站 CSS 无定义，CronJobs 裸奔）⇒ 判样式缺失 grep CSS 不 grep 模板。审计清单 `docs/v720-表头冻结审计清单-2026-11-02.md`，探针 `tools/v720-table-freeze-scan.mjs`（`--static/--live/--grow`）。🔴 判「已冻结」必须**内滚 400px 复测表头位置**（只看 computed position 会误判）；且要滚**实际的滚动者**（本项目常是 `.view-wrap` 不是 window，滚 window 得 y0===y1 假阳性）。

## 🔴 免密码做生产 UI 真机验证（v707，最省事的正路）
生产后端**不是 git 仓**，改它要 `scp` 下来 → `.bak` → `install -o hergent -g hergent -m 644` → `systemctl restart`。登录态：主库 `sessions` join `users`(role='boss') 取 `token`，puppeteer `setCookie` 注入 `erp_token`(httpOnly)+`hergent_auth=1`+`csrf_token`(任意)+`hergent_tenant` ⇒ 以老板身份跑生产页。⚠️ `sessions` **没有 id 列**（用 `created_at`）、`users` **没有 tenant_id**。
- 🔴 **自己插 `sessions` 造临时登录态时，`created_at`/`expires_at`/`last_activity` 必须 `datetime('now','localtime')`**；写 `datetime('now')`（UTC）差 8 小时 ⇒ 直接 **401**（像「token 无效/账号被停用」，v714 实踩）。用完 `delete from sessions where token like '<前缀>%'`。
- 🔴 **免密验证走 `Authorization: Bearer`** ⇒ CSRF 中间件整段豁免；但权限类端点还要 `X-Tenant-Id` 头（`_perms_tenant_or_400` fail-closed，缺了就 400，绝不回落主库）。

## 🔴 结构 / 实现 / 部署判据（原文已搬 → `topics/impl-and-deploy-criteria.md`）
- 🔴 **给表格加列先吃「名称列」宽度**，长文本列 `width+min-width` 同写｜**分页条在滚动容器外**，翻页后 `scrollTop=0`｜**加字段 4 处**（商品 v670 / `hr_employees` v707，且 `employee_create` 有第三份 `allowed` 白名单 ⇒ 先 `grep -c "allowed = \["`）｜`ui_col_prefs` 是**租户级**｜`visibleCols` 元素**没有 `type`**。
- 🔴 **构建** `--emptyOutDir false`（safe-delete 会拦 `rm -rf`，报失败先排它）｜**页面文件名 ≠ 产物 chunk 名**（v706）且每次 build 全部 hash 都变 ⇒ 必须走**闭包补传**｜CSS 改完要量 `getComputedStyle`（v708「规则在产物里 + matches=true + 不生效」成立）｜跨组件覆盖必须写在**目标组件自己文件**（`@media` 不提高特异性）。
- 🔴 **部署必检**：`deploy-frontend-closure.py --push`（最后才传 index.html）+ **curl+`cmp` 逐字节**判产物（脚本报「补传 111」不可信）。
- 🔴 **数字单位跟口径走**（返利 quantity 全是件数）｜**行显隐两份实现**（查看态 `rowVisible` / 编辑态 `rowBaseShown`）｜备份巡检脚本 `check_backup_alive.py` **别删**。细目全文 → 上述 topics 三份。

## 🔴 副驾 / 租户 / 内存（全文 `topics/copilot-tenant-memory.md`）
- 🔴 租户边界 = 进程用哪个系统账号（v635）：`gateway_api(tid)` 读该租户 `config.yaml` 的 `platforms.api_server.extra`（端口 `18800+tid`）；解析不到 ⇒ **必须 503，绝不回落根实例**。平台租户 1 = 根实例别名（v642）：凭证/state 走 `_host_home`、PID 走 `_systemd_main_pid`；`_identity_kwargs` 必须 `return []`（v646）。
- 🔴🔴 同一企微 bot 只能一个 websocket 订阅：双连报 `846609` ⇒ 不回消息 + 100% CPU 重连死循环；卡住要 `kill -9` 连 `sudo -u` 包装一起杀。进程外推送必踢长连接（v648，2.2s 自愈）；`hermes send` **必须 `stdin=DEVNULL`**（v647）。`/root/.hermes/gateway_state.json` 会被临时 `hermes send` 写脏（v666）⇒ 判通道还要看 pid 是否 `hermes gateway run`。
- 🔴 **企微「三点动画上下跳」= 我们补丁的字符动画 × 客户端原生动效叠加**（v715）。`tools/hermes_wecom_ack_patch.py` 现 **v6**：占位 `\u200b` + 帧序列空（只 60s 保活重推）。🔴 适配器在 `/usr/local/lib/hermes-agent/...`（进程跑这份），`/opt/hermes-agent` 是死副本；**Hermes 升级即被覆盖**（现象=又「等半天没反应」）⇒ 升级后必跑 `--check`。🔴 `_send_reply_request()` **只在网络层抛异常，服务端拒绝是正常返回带 errcode** ⇒ 必须查 errcode；收口失败要退回普通发送，**绝不静默吞答案**。
- 🔴 判后端内存看 `ps -o rss -p $(systemctl show -p MainPID --value hergent-erp)`，不看 `memory.current`；顶穿 `MemoryHigh` = D 状态锁死。成本 = 入口数 × 常驻进程 ⇒ 接客户就新开一台；闲置租户停不掉；镜像开客户必须先脱敏。
- 🔴 气泡时间只认 `m.created_at`；「打开副驾显示最后一次」= `latestSessionOfRole() || latestSessionOverall()`（v637）；副驾读表 = `spreadsheet_query._run_query`（v638）｜改完 `hermes_tenants.py` 必须重启后端再做「杀掉观察 60s」。

## 进度 / 交付锚
P0/P1 全交付；剩余促销ROI(端点坏死500)/货架位(零数据)/现金流预测页面化。**卖前三关未过；调拨单生产仍 0 张**。BI 指标唯一源 `erp_db.py:_BI_MEASURES`（口径必须 `soi.amount`）；库存周转唯一源 `get_inventory_turnover`。
v714：主管 `reports` 权限已授（4 个 supervisor 账号，12 张报表页）；商品档案 104 条停用 = **88 条纯遗留（保持停用，不物理删）+ 16 条赠品物料仍压 7,544 件/12,726 元库存**（占库存额 8.1%）⇒ 待老板选「恢复启用」或「报废清零」。全文 `docs/v714-停用商品审计与主管报表权限-2026-11-01.md`。
起号必读 `version-history.md` + 实搜两仓 `git log --all`；前端 `roles` 窄名单非真保险 ⇒ 敏感页必须后端 `_admin` 双保险(v531)。

## 主体 / 脱敏 / 技能 / 本机坑
主体 hergent-cn-v2(`laozhangai-product`)｜hergent-erp(FastAPI+SQLite)。脱敏红线：返利率/进货价/客户名/区域销量/厂家政策；PII 不落 `outputs/`。技能 7 个在 `.workbuddy/skills/`。本机坑 → `topics/local-machine-pitfalls.md`（🔴 `grep "A\|B"` 静默失效 ⇒ 一律 `-e`；`&&` 短路；`| head -N` 截命中；`grep -rl` 只搜顶层；ssh 嵌 python 引号 ⇒ 写远端脚本；`pkill -f x` 会杀掉执行它的 shell）。
- 🔴 **`git commit -m "…含 `{}` 或反引号…"` 在 zsh 里 parse error ⇒ 提交静默失败**，随后 `git push` 报 `Everything up-to-date`（v708 实踩）⇒ 提交一律 `git commit -F- <<'EOF'`。
