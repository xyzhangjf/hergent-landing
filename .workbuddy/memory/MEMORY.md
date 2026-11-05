# Hergent 记忆索引（只留判据首句＋去哪查；细节全在 `topics/*.md` / `memory/YYYY-MM-DD.md`）

**前端 v770**（短文案禁止竖排）｜v769 返利率可留空｜v768 GoLink/useGoPage｜v765d 品牌报单日正向横幅｜**小程序 v758–v768 已提交、未发版**。唯一源 `main`。
🔴🔴 **后端零版本管理**：生产 `/opt/hergent-erp/`（FastAPI+`routers/`，非 git 仓、有 `.env`），本仓 `server/` 是旧单文件 ⇒ **「提交了前端」≠「后端也入库」**；靠 `.workbuddy/remote-erp/` 回拉镜像。

## 🔴🔴 部署（错一步=假部署）
`deploy-frontend-closure.py --push` **只补 assets、不传 index.html** ⇒ 三步：`--push`→验闭包全 200→`rsync dist/index.html`（**绝不 `--delete`**，先 `cp -a`）。
验产物**必须从线上 curl 回来 grep**：`emptyOutDir:false` 堆新旧同名 hash chunk ⇒ 抓到旧包得「改动没进产物」假结论；判新旧看**入口 JS 引用了哪一份**。「改了没变」先查 `window.__HG_BUILD__`＋`html[data-build]`。
🔴 后端 FLAT `/opt/hergent-erp/`｜前端 `/opt/hergent-cn-v2/`（`index.html` 在**根**）｜服务 `hergent-erp.service`｜**ERP 前端域名 = `hergent.cn`**（`erp.hergent.cn` 是另一个应用）。→ `topics/deploy-ops.md`
🔴 后端单文件：`cp -a` 备份→`scp`→`chown hergent:hergent`→双侧 `md5sum`→`systemctl restart`→**等 8~10 秒**（重启瞬间 502 正常）。
🔴 `vite build` 十几分钟零输出＝安全删除护栏拦住清 `dist/assets`。合并/解冲突后**必须** `npm test`+`build`：重复 `export`／对象键／模板被覆盖 ⇒ **构建不报错**。

## 🔴🔴 护栏 / 探针（最易伪造「全绿」）
**`run-all.mjs` 不自动扫描**：每个 `*.contract.mjs` 必须显式 `run('文件名')`，否则永不执行、`npm test` 照样 ALL PASS（连踩三轮）。防三种空白支票：正则抽空集／只查唯一不查存在／只写上限（**必须三态**）；护栏接进「全通过→exit(0)」那个大 if。
🔴 **「有没有检查」≠「检查有没有被执行」**：每条要 runner 注册＋**坏样本自证**＋对照组原样全绿。
🔴🔴 **加函数前先 `grep -c "function 名字"`**：同名声明提升静默覆盖、编译不报错；撤共享前缀的兄弟函数高危，先数引用。
🔴 **静态判据锚点必须是「结构化位置」**：判「横幅还在」不能只查 `bwOpen`，查 `class="bw-bar"` 计数==1。
🔴🔴 **探针身份（v729/v770 真踩两次）**：登录态在 cookie；`/root/probe_token.py` 旧版硬编码 user 1 ⇒ 症状不是 401 而是侧栏只渲染 7 区。**token 过期 ⇒ 全部页静默回 `#/workbench`** ⇒ 每页量到同一屏、零异常＝完美假绿 ⇒ **每页第一条断言必须是身份自检（hash≠#/workbench 且 h1≠工作台）**，回退页判作废而非「无异常」。合法别名重定向（如 `/price-channels`→`/archive/prices`）不算回退。侧栏探针另须断言「区数 ≥ 11」。→ `topics/local-machine-pitfalls.md`
🔴 **量「文字几行」要看不同 y 的行盒**：`Range.getClientRects()` 同一排可能返回多个重叠 rect（排序图标旁的表头），按 rect 数判会误报；再排除宽容器（≥120px）里的长句正常换行。
🔴🔴 **读生产租户配置必须先进租户上下文**（`set_tenant_context(1)` 或 `ERP_DB_PATH=/opt/hergent-erp/tenant_1.db`）：不设则默认 `erp.db`（**没有那行配置**）⇒ `get_config()` 恒返 False ⇒ 得「开关是关的」假结论（v765d 踩过，还写进交付说明）。判据：先打印 `[DB] SQLite engine — …` 核对实际文件。

## 🔴 UI / CSS（全文 `topics/frontend-ui.md`）
🔴🔴 **中文短文案「逐字竖排」≠ `writing-mode`**（v770）：根因是 `table-layout:auto` 按 **min-content** 分配列宽，而中文可按字断行 ⇒ 没 `white-space:nowrap` 时「启用」的 min-content＝**1 个汉字**，列被压到 48px、`.tag` 28px（还有 16px 内距）、固定 `height:22px` 裁掉第二行。修法 = **在全局唯一源 `.tag` 加 nowrap**（不是给某页补 min-width，那会长出第二份判据）；实测整表只 +12px 横向宽，纵向/响应式不变。`word-break:keep-all` 管不住汉字逐字断行。同类：`tfoot .ft-lb`／表单 label／flex 里被压的按钮文字，护栏 `status-text-nowrap`（㊼，7 坏样本）。
🔴🔴 **`<GoLink>` ≠ `useGoPage`，是一对相反决策**（v768）：判据＝**点完人还在不在这一页**。指路文案⇒GoLink（走守卫、无权限弹回工作台）；按钮/弹窗动作⇒`goNav()`（留原地+toast）。实例名**不能叫 `goPage`**（8 页里 `goPage(p)` 是分页函数）。页名用 `pageTitle(path)`。护栏 `go-nav-unified`（㊺）。
🔴🔴 **「点右上角新建 X」在无权限角色下指向不存在的按钮**（v767）：按钮 `v-if="canDo()"`，只读角色进得了页却看不到按钮；空态与按钮**必须共用同一条判据分支**（唯一源 `permHint.js::noNewPermHint`）。**只有换角色登录才看得见**。话术不写菜单路径。护栏 `btn-hint-perm`（㊹）。
🔴🔴 **`api()` 第二个参数是 options 对象，不是 method**：`api(url,'PUT',{...})` ⇒ 兜底 GET、body 丢弃 ⇒ 拿到旧值却弹绿底「已启用」，**编译与请求都不报错**。护栏先 strip 注释再扫错签名＋回读校验。
🔴 **品牌色 / 对比度**：一个语义位置出现第 2 个色值就是 bug；只认 `#hex` 的校验看不见 `rgba(...)`，**带 alpha 就不是品牌色**；`app.json`/`showModal.confirmColor`/`<switch color>`/tab 图标吃不到 CSS 变量须同批改；`@keyframes` 吃不到 `var()`。「字不够黑」先查层级倒挂；`--t2`≡`--t3` ⇒ 改 t3 为 t2 是零变化。焦点环 `:focus-visible`＋`:focus-within` 两层同守。
🔴 **排版令牌**：字号归并 ≠ 行高归并（改字号会改**宽度**）；同值两个名字是最难发现的债；`rule.style.fontSize` 读 `var()` 返空串；间距归一「收大留小」；用行高当高度 ≠ 行距。侧栏图标撞车只有看才发现，⌘K 面板同批改。
🔴🔴 **「卡上有入口」≠「点进去到那一条」**：深链带 `tab=`／一次性 query 消费后立刻摘／定位 id 必须后端给／过 `canSee()`。

## 🔴 预报 / 返利 / 小程序（细节见各 topic）
🔴🔴 **「本期报没报」必须问服务端**（v759）：本机 Storage 换机/清缓存即消失 ⇒ 漏单；两条横幅 `wx:if`/`wx:elif` **互斥**，不自动预填，刷新时机四条缺一即陈旧。
🔴🔴 **「撤回后要全部重填」＝数据没丢、入口被关了**（v758）：`recall` 只改 status；`rec-copy`/`genSample` 排除 `recalled`。**「继续修改」≠「复制样单」**（幂等键 `(店,期次)`、单号不变）；`_applyCopySample` 只切门店不切期次 ⇒ 改这一单必须两层对齐期次，否则整批报错期次、零报错。入口出现与否**由服务端给**（`can_delete`→`can_recall`→`period_writable`）。
🔴🔴 **改数保存后回跳**＝显示跨角色求和、保存只写一个 role ⇒ 拆差额（`合计−非导入`，负差额落 `role='主管调整'`）；`nonImportByPid` 排除主管调整。**保存了又变回原值**＝`|| undefined` 丢键⇒`if k in d` 判不到⇒不写库⇒回读跳过⇒toast 照样「已保存」，判据是「界面能不能把它删空」。
🔴🔴 **已关闭期次保存灰掉 ≠ 权限不够**（v756）：后端支持 `allow_closed`，错在三处同款踩死（`enterEdit`／`saveDisabled`／`saveEdits`）。**粘贴「静默」实质是数字不对位**：描边淡底 2.6s／toast 用商品名·客户名报落点／先 `ensureRowsRendered`，顺序不可反。
🔴 **zoom 两套坐标系**（v745/v746）：容器 `scrollTop/scrollHeight` 是缩放后坐标、`ROW_H` 是未缩放 ⇒ 窗口只覆盖 1/z 屏（判据：50% 渲染行数必须 > 100%）；同一留白在改单态有第二份实现 `EDIT_FIRST_BATCH=24`，报障形态是「一直挂着」。
🔴 **列 / 斑马纹 / 冻结列**：列可拖四件缺一即假生效（按存的顺序排／合计按列名取／≥5px 不抢选列手势／落位写 `cfg.cust`，用 pointer 不用 HTML5 draggable）；某几列不跟斑马纹先查冻结列 `td` 写死底（子盖父，修法下发 `--row-bg`）；「以前有 X 按钮现在没了」先查是不是上轮改成了右键菜单（撤常驻入口必问发现性靠什么补）。判库存只认 `inventory`；`inventory_balance` 是空表。
🔴 **返利 · 目标配置**（v769）：**「返利率留空」≠「这一格不写」** —— `resolve_month_rate` 会向前找最近有值的月 ⇒ 2 月留空被静默套成 1 月的 10%（零报错多算返利）。修法＝有目标金额的月份**显式落 0**。只删「请至少填写一个月返利率」是假修复：前端 `save()` 与后端 `_is_num_like` 两层都拦。→ `topics/rebate-domain.md`
🔴 **v765 品牌报单日**（v765d 口径）：只认 `order_weekdays`，绝不依赖 `order_first_date`/`order_mode`（生产规则两者全空 ⇒ 复用 `build_period_plan()` 会静默跳过全部）。2 天/期与 7 天/周互质 ⇒ 星期以 7 期循环。**`order_end_date` 是后加列**（tenant_10 缺）⇒ SQL 硬引用会整段抛错被 except 吞成「全放行」，开关打开也永远不生效。
横幅只说「本期可报品牌：A、B」，**不点名不可报品牌**；**还有未配星品牌（free）必须追加「，其它品牌均可报」**（白名单漏项＝用户不敢填＝少报，比黑名单更危险）。拦截＝弹窗不是 toast，正文由后端 `lock_msg` 整句给，按品牌 4 秒节流，`next_order_date` 从明天起算。→ `topics/forecast-order-domain.md`
🔴 **小程序扫码**（v761）：`wx.scanCode` 三件 —— 同批隐私申报（后台仍需手动补）／`fail:()=>{}` 把 auth deny 吞成「点了没反应」／无 `prompt` 参数；一维码贴太近必糊，相册是绕法。**「一个条码一个商品」是错觉**：本期 6 组同码，只定位第 1 个会把数量填进另一个渠道那行 ⇒ `filter(barcode===code)` 后点名「同条码还有 B」。扫码绝不写 `_qtyMap`。
🔴 **小程序撤回归属闸门**（后端已生效、待发版）：列表范围是「我报的 OR 我负责门店的」⇒ 服务端逐条给 `can_recall`（本人／角色／该单 `(store_id,kind)` ∈ 我的范围，第三条必需：主管导入后员工原位替换不动 `user_id`）。判据函数收「范围」须两种形状都吃（元组 / 字典）；`created_at` 是 UTC 比本地早 8 小时。

## 路由（🔴＝硬判据）
- **前端** → `topics/frontend-ui.md`（改前必 grep）：门禁唯一源 `pages.js`（未登记＝放行）｜`permView.js` 唯一源、`module:null`＝只读｜文案三禁⇒`hergent-ui-copy-guard`｜图表唯一源 `src/components/chart/`｜列表页 `psi-list.css`｜`⌘K`/`⌘⇧K` 已占用⇒新的用 `⌘⇧O`。
- **后端** → `topics/backend-invariants.md`：路由遮蔽**先注册者胜**｜静默失效＝恒空恒 0｜门禁用**接口模块**非页面模块｜FastAPI 未声明 query 被静默忽略｜`execute_tool` 返回键是 `success`。
- 🔴🔴 **改角色权限必须走 `POST /api/role-permissions`**（直写库绕过 `reload_perms`＋不留 `audit_logs`），「未列出＝移除」⇒ 传完整清单。`roles` 与 `module` 是两条独立轴。
- 🔴🔴 **副驾产物 403「不在可访问范围内」**＝允许根只认了一半 home（`_host_home(1)` vs `home_for(1)`）⇒ 取**并集**。
- **域**：预报 `forecast-order-domain`｜返利 `rebate-domain`｜成本容量 `cost-and-capacity`｜账务 `accounting-gl-v716-v717`｜条码小程序 `miniprogram-and-brand-data`｜副驾租户 `copilot-tenant-memory`｜本机坑 `local-machine-pitfalls`｜库存 `inventory-psi`。

## 实现 / 进度 / 主体 / 本机
实现：加列先吃「名称列」宽度、长文本列 `width+min-width` 同写｜分页条在滚动容器外｜加字段 4 处｜`ui_col_prefs` 租户级｜跨组件覆盖写在目标组件自己文件｜Bearer 免 CSRF，权限端点要 `X-Tenant-Id`。
进度：P0/P1 全交付；剩促销 ROI（端点坏死 500）/货架位（零数据）/现金流预测页面化。**卖前三关未过；调拨单生产仍 0 张**。BI 唯一源 `erp_db.py:_BI_MEASURES`。敏感页必须后端 `_admin` 双保险。
主体：`hergent-cn-v2`(`laozhangai-product`)＋`hergent-erp`(FastAPI+SQLite)。脱敏红线：返利率/进货价/客户名/区域销量/厂家政策。
本机坑：🔴 `grep "A\|B"` 静默失效⇒一律 `-e`｜BSD grep 无 `\s`｜`| head -N`/`| tail -N` 会截掉决定性命中｜`grep -rl X *.py` 只搜顶层｜`grep "X-…"` 会命中更长名字⇒加边界｜`git commit -m` 含 `{}`/反引号静默失败⇒`-F`。🔴 **「搜不到」先排除「搜错范围/被截断」再当事实。**
🔴 **微信开发者工具 CLI 被「服务端口」挡住**：`cli upload`/`open`/`islogin` 全报 `IDE service port disabled`，`--port` 也绕不过；须人工在 IDE「设置→安全设置→打开服务端口」一次。
