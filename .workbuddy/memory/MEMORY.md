# Hergent 记忆索引（只留判据首句＋去哪查；细节在 `topics/*.md` / `memory/YYYY-MM-DD.md`）

**前端 v770**｜v780 我的提交两处日期文案改短「报单/到货」（**小程序已上传、待发布**）｜v779 简爱周五被拦＝拦截层没读「可提前天数」（**后端已上线**）｜v778 我的提交「数量+单位」不折行（小程序代码已改、**未发版**）｜v777 我的提交去掉商品规格显示（小程序代码已改、**未发版**）｜v776 外部账号定向催单（后端已上线）｜v775 管理兜底广播拆独立 event_key（后端已上线）｜v773→v774 导购受众先补后收紧｜v772 横幅改本期清单口径｜v771 我的提交到货日期｜v769 返利率可留空｜v768 GoLink/useGoPage｜**小程序 v758–v780 已上传微信平台开发版、待后台审核发布**。唯一源 `main`。
🔴🔴 **中文标签进 flex 行 ⇒ 改文案＝改断行点**（v780）：裸日期只能在连字符断，前面加「报单」后「汉字后可断」⇒ 必须 `nowrap`（v770 同族）。但**两端都 nowrap 又会让日期组不可压缩** ⇒ 长门店名 + 窄屏把「到货」挤出卡片（实测 320px/门店 10 字溢出 17px，改前 0）⇒ 必须给容器 `flex-wrap:wrap` 兜底。判据＝生产真实尺寸下 wrap 永不触发（高度/行数/宽度 Δ0）。**口径变了要反转旧坏样本**：㊽ 原来把「改成到货」当坏样本，v780 起改成「退回『到货日期』」，否则护栏拿旧标准判错正确修改（v769 同族）。改结构后 `probe()` 的 `indexOf` 锚点也要跟着改，否则判据恒假。→ `memory/2026-11-05.md`
🔴🔴 **同一个「能不能报」不许写两份口径**（v779）：编排层 `match_brands_to_periods` 用窗口 `[C-E, C]`（E=`order_max_early_days`），拦截层 v765 只判截止日当天星期 ∈ `order_weekdays` ⇒ 编排层排进去、小程序弹不可报（生产 24 期里 14 条被误拦，含报障的 43 期简爱）。判定统一走 `window_hit(order_end, ws, early)`，E 缺键/坏值/缺列 ⇒ 0（零误伤老租户），上限复用 `MAX_EARLY_LIMIT`。**弹窗日期只认真实期次表**（`next_period_date` 查 `_future_periods`），日历推算的 `next_order_date` 已废弃 —— 生产 43 期之后零未来期次，旧文案「请在 11月7日填报」是虚构日期；查不到 ⇒ 空串 ⇒「本期已无可报日」。`load_rules`/`_future_periods` 一律 `SELECT *` 取后加列。→ `memory/2026-11-05.md`
🔴 **「去掉某字段显示」≠「删数据层」**（v777）：`mine.js::copyRecord` 的 `spec` 仍要带回填报页；更不许全仓替换 `spec`（填报 `.prod-spec`/`.cart-spec`、汇总 `.pspec`、隐私协议都还在用）。护栏须**剥注释后**判结构（本次注释逐字抄了 `spec` 会自撞空白支票）。→ `memory/2026-11-05.md`
🔴🔴 **flex 行里「数值+单位」整块不拆行**（v778）：两层保险缺一不可 —— 绑定不留折行空格 ＋ `.it-qty{flex:none;white-space:nowrap}`；**中文「数字｜汉字」边界本身可断行 ⇒ 只去空格 Chrome 实测仍拆行**。名称侧只给 `flex:1;min-width:0`，严禁 nowrap/ellipsis。量「文本几行」用 `Range.getClientRects()` 与两段 Range 的 top 差，**别用元素高度÷行高**（`align-items:stretch` 会把元素盒拉到与换行名称同高，假报 2 行）。→ `memory/2026-11-05.md`
🔴🔴 **后端零版本管理**：生产 `/opt/hergent-erp/`（FastAPI+`routers/`、非 git 仓、有 `.env`），本仓 `server/` 是旧单文件 ⇒「提交了前端」≠「后端也入库」；靠 `.workbuddy/remote-erp/` 回拉镜像（v765c 起入库）。

## 🔴🔴 部署（错一步＝假部署）
`deploy-frontend-closure.py --push` 只补 assets、不传 index.html ⇒ 三步：`--push`→验闭包全 200→`rsync dist/index.html`（绝不 `--delete`，先 `cp -a`）。验产物**必须从线上 curl 回来 grep**：`emptyOutDir:false` 堆新旧同名 chunk ⇒ 判新旧看**入口 JS 引用哪一份**；「改了没变」先查 `window.__HG_BUILD__`＋`html[data-build]`。
🔴 FLAT：后端 `/opt/hergent-erp/`｜前端 `/opt/hergent-cn-v2/`（index.html 在根）｜`hergent-erp.service`｜**ERP 前端域名＝`hergent.cn`**（`erp.hergent.cn` 是另一个应用）⇒ curl 错域名会得「404＝没传上去」假结论。→ `topics/deploy-ops.md`
🔴 后端单文件：`cp -a` 备份→`scp`（**源带子目录时目标必须写完整路径**，否则拍平成死文件）→`chown hergent:hergent`→双侧 `md5sum`→restart→**等 8~10 秒**。
🔴 `vite build` 十几分钟零输出＝安全删除护栏拦住清 `dist/assets`；合并/解冲突后必须 `npm test`+`build`（重复 export／对象键／模板被覆盖 ⇒ 构建不报错）。

## 🔴🔴 护栏 / 探针（最易伪造「全绿」）
**`run-all.mjs` 不自动扫描**：每个 `*.contract.mjs` 必须显式 `run('文件名')`，否则永不执行却 ALL PASS（连踩三轮）；护栏接进「全通过→exit(0)」的大 if。防三种空白支票：正则抽空集／只查唯一不查存在／只写上限（**必须三态**）。
🔴 「有没有检查」≠「检查有没有被执行」：每条要 runner 注册＋**坏样本自证**＋对照组原样全绿；静态判据锚点必须是**结构化位置**（查 `class="bw-bar"` 计数==1，别查 `bwOpen`）。
🔴🔴 加函数前先 `grep -c "function 名字"`（同名声明提升静默覆盖、编译不报错）；撤共享前缀的兄弟函数先数引用。
🔴🔴 探针身份（v729/v770 真踩两次）：登录态在 cookie；`/root/probe_token.py` 旧版硬编码 user 1 ⇒ 症状不是 401 而是侧栏只 7 区。**token 过期 ⇒ 全部页静默回 `#/workbench`** ⇒ 每页量到同一屏零异常＝完美假绿 ⇒ **每页第一条断言必须是身份自检**（hash≠#/workbench 且 h1≠工作台），合法别名重定向不算回退。侧栏探针另须断言区数 ≥ 11。→ `topics/local-machine-pitfalls.md`
🔴 量「文字几行」按不同 y 的行盒（`Range.getClientRects()` 同排重叠 rect 会误报），排除宽容器 ≥120px 长句。
🔴🔴 读生产租户配置必须先进租户上下文（`set_tenant_context(1)` 或 `ERP_DB_PATH=.../tenant_1.db`）：否则默认 `erp.db` 没有那行配置 ⇒ 得「开关是关的」假结论；先打印 `[DB] SQLite engine — …` 核对文件。

## 🔴 UI / CSS（全文 `topics/frontend-ui.md`）
🔴🔴 中文短文案逐字竖排 ≠ `writing-mode`（v770）：`table-layout:auto` 按 min-content 分列宽，中文可按字断行 ⇒ 没 `white-space:nowrap` 时「启用」min-content＝1 汉字。修法＝**全局唯一源 `.tag` 加 nowrap**（不在页面补 min-width，那会长出第二份判据）；`word-break:keep-all` 管不住。同类 `tfoot .ft-lb`／表单 label／flex 里被压的按钮。护栏 `status-text-nowrap`（㊼，7 坏样本）。
🔴🔴 `<GoLink>` ≠ `useGoPage`（v768）：判据＝**点完人还在不在这一页**。指路文案⇒GoLink（走守卫、弹回工作台）；按钮/弹窗⇒`goNav()`（留原地+toast）。实例名**不能叫 `goPage`**（8 页里 `goPage(p)` 是分页函数）。页名用 `pageTitle(path)`。护栏 ㊺。
🔴🔴 「点右上角新建 X」在无权限角色下指向不存在的按钮（v767）：空态与按钮**共用同一条判据分支**（唯一源 `permHint.js::noNewPermHint`）；只有换角色登录才看得见；话术不写菜单路径。护栏 ㊹。
🔴🔴 `api()` 第二个参数是 options 对象不是 method：写成 `'PUT'` ⇒ 兜底 GET、body 丢弃 ⇒ 拿到旧值却弹「已启用」，编译与请求都不报错。护栏先 strip 注释再扫错签名＋回读校验。
🔴 品牌色／对比度：一个语义位置出现第 2 个色值就是 bug；只认 `#hex` 看不见 `rgba(...)`，**带 alpha 就不是品牌色**；`app.json`/`showModal.confirmColor`/`<switch color>`/tab 图标吃不到 CSS 变量须同批改；`@keyframes` 吃不到 `var()`。「字不够黑」先查层级倒挂；`--t2`≡`--t3` ⇒ 改 t3 为 t2 是零变化。焦点环 `:focus-visible`＋`:focus-within` 两层同守。
🔴 排版令牌：字号归并 ≠ 行高归并（改字号会改宽度）；同值两个名字最难发现；`rule.style.fontSize` 读 `var()` 返空串；间距归一「收大留小」；用行高当高度 ≠ 行距。侧栏图标撞车只有看才发现，⌘K 面板同批改。
🔴🔴 「卡上有入口」≠「点进去到那一条」：深链带 `tab=`／一次性 query 消费后立刻摘／定位 id 必须后端给／过 `canSee()`。

## 🔴 预报 / 返利 / 小程序（细节见各 topic）
🔴🔴 「本期报没报」必须问服务端（v759）：本机 Storage 换机/清缓存即消失 ⇒ 漏单；两条横幅 `wx:if`/`wx:elif` 互斥，不自动预填，刷新时机四条缺一即陈旧。
🔴🔴 「撤回后要全部重填」＝数据没丢、入口被关了（v758）：`recall` 只改 status；**「继续修改」≠「复制样单」**（幂等键 `(店,期次)`、单号不变）；`_applyCopySample` 只切门店不切期次 ⇒ 改这一单必须两层对齐期次，否则整批报错期次、零报错。入口出现与否**由服务端给**（`can_delete`→`can_recall`→`period_writable`）。
🔴🔴 改数保存后回跳＝显示跨角色求和、保存只写一个 role ⇒ 拆差额（`合计−非导入`，负差额落 `role='主管调整'`）。**保存了又变回原值**＝`|| undefined` 丢键⇒`if k in d` 判不到⇒不写库⇒回读跳过⇒toast 照样「已保存」，判据是「界面能不能把它删空」。
🔴🔴 已关闭期次保存灰掉 ≠ 权限不够（v756）：后端支持 `allow_closed`，错在三处同款踩死。**粘贴「静默」实质是数字不对位**：描边淡底 2.6s／toast 用商品名·客户名报落点／先 `ensureRowsRendered`，顺序不可反。
🔴 zoom 两套坐标系（v745/v746）：容器 `scrollTop/scrollHeight` 是缩放后、`ROW_H` 未缩放 ⇒ 窗口只覆盖 1/z 屏（判据：50% 渲染行数 > 100%）；改单态留白有第二份实现 `EDIT_FIRST_BATCH=24`，报障形态是「一直挂着」。
🔴 列／斑马纹／冻结列：列可拖四件缺一即假生效（按存的顺序排／合计按列名取／≥5px 不抢选列手势／落位写 `cfg.cust`，用 pointer）；冻结列 `td` 写死底会盖父级斑马纹（修法下发 `--row-bg`）；撤常驻入口必问发现性靠什么补。判库存只认 `inventory`；`inventory_balance` 是空表。
🔴 返利目标配置（v769）：**「返利率留空」≠「这一格不写」** —— `resolve_month_rate` 向前找最近有值的月 ⇒ 留空被静默套上月费率（零报错多算返利）。修法＝有目标金额的月份**显式落 0**；只删前端硬拦是假修复（后端 `_is_num_like` 也拦）。→ `topics/rebate-domain.md`
🔴🔴 **v772 横幅口径（覆盖 v765d）**：范围＝**本期预报清单** `forecast_import_products`，不是全商品档案（全档案 18 品牌、本期清单只 5 个）。没配 `order_weekdays` 的品牌自动算可报、主句一次列全 ⇒「，其它品牌均可报」/`free`/`has_unrestricted_brand`/可展开明细整套撤销。清单空⇒`''`、全被挡⇒「本期暂无可报品牌」、全可报也列全。🔴 判定闸门 `brands` 仍只含配了规则的品牌、**结构一字未动**（提交/行内禁用零改动）。`period_brands` 复用 `erp_db.forecast_period_scope_sql`，导入失败降级精确命中、绝不退化成全表；PRAGMA 判 `brand` 列防缺列租户整段抛错。🔴 品牌名**不许 nowrap/省略号**：5 个品牌实测自然折 2 行（33→51px），截断＝白名单漏项。→ `topics/forecast-order-domain.md`
🔴 v765 品牌报单日（判定内核不变）：只认 `order_weekdays`，绝不依赖 `order_first_date`/`order_mode`；2 天/期与 7 天/周互质 ⇒ 星期以 7 期循环。**`order_end_date` 是后加列**（tenant_10 缺）⇒ SQL 硬引用会整段抛错被吞成「全放行」，开关打开也永远不生效。横幅只说可报品牌、不点名不可报。拦截＝弹窗不是 toast，正文由后端 `lock_msg` 整句给，按品牌 4 秒节流。🔴 v779 起弹窗日期改由 `next_period_date()` 查真实期次表（`next_order_date` 日历推算已废弃，只在历史单测里保留）。→ `topics/forecast-order-domain.md`
🔴 小程序扫码（v761）：`wx.scanCode` 三件 —— 同批隐私申报／`fail:()=>{}` 吞掉 auth deny／无 `prompt` 参数；一维码贴太近必糊，相册是绕法。**一个条码可能对应多个商品** ⇒ `filter(barcode===code)` 后点名同码其它行；扫码绝不写 `_qtyMap`。
🔴 小程序撤回归属闸门（后端已生效、待发版）：列表范围是「我报的 OR 我负责门店的」⇒ 服务端逐条给 `can_recall`（本人／角色／该单 `(store_id,kind)` ∈ 我的范围；第三条必需：主管导入后员工原位替换不动 `user_id`）。判据函数收「范围」须两种形状都吃；`created_at` 是 UTC 比本地早 8 小时。
🔴 **新增展示字段先问「前端拿不拿得到全量」**（v771）：`/my` 的 records 只有 `period_id`，而 `/open-periods` **只返回未关闭期次**（生产 24 期里 23 期 closed）⇒ 前端自己拼期次字段必然大面积空白且静默。修法＝服务端批量补，SQL 用 `SELECT *` 按列名取（v765c 缺列教训）。空值 `wx:if` **整段不渲染** ⇒ 卡片与改前逐像素一致；中文标签 nowrap（v770）。`normalizeArrivalDate` 只归一不格式化（前端再格式化＝第二份口径）。护栏 ㊽。

## 路由（🔴＝硬判据）
- **前端** → `topics/frontend-ui.md`（改前必 grep）：门禁唯一源 `pages.js`（未登记＝放行）｜`permView.js` 唯一源、`module:null`＝只读｜文案三禁⇒`hergent-ui-copy-guard`｜图表唯一源 `src/components/chart/`｜列表页 `psi-list.css`｜`⌘K`/`⌘⇧K` 已占用⇒新的用 `⌘⇧O`。
- **后端** → `topics/backend-invariants.md`：路由遮蔽先注册者胜｜静默失效＝恒空恒 0｜门禁用接口模块非页面模块｜FastAPI 未声明 query 被静默忽略｜`execute_tool` 返回键是 `success`。
- 🔴🔴 改角色权限必须走 `POST /api/role-permissions`（直写库绕过 `reload_perms`＋不留 `audit_logs`），「未列出＝移除」⇒ 传完整清单。`roles` 与 `module` 是两条独立轴。
- 🔴🔴 副驾产物 403「不在可访问范围内」＝允许根只认了一半 home（`_host_home(1)` vs `home_for(1)`）⇒ 取并集。
- **域**：预报 `forecast-order-domain`｜返利 `rebate-domain`｜成本容量 `cost-and-capacity`｜账务 `accounting-gl-v716-v717`｜条码小程序 `miniprogram-and-brand-data`｜副驾租户 `copilot-tenant-memory`｜本机坑 `local-machine-pitfalls`｜库存 `inventory-psi`｜通知 `notification-center`。
🔴🔴 **通知「某人收不到 / 不该收到」先查角色受众表**：v330 收口时 `guide` 一条没写，v333 才把导购收紧成 `mini` ⇒ 5 个在职导购里 3 个判 False（马耀秀 0 条）。版本线：v773 报单线 8 条一锅端补 guide ⇒ 0→31，误把「唐成」兜底广播（无 recipients、含别人单元名＋金额）发给导购；v774 撤 3 条催单规则 ⇒ 31→20；**v775 从写端拆 `forecast_reminder_unbound` 独立键 + 管理链 `admin,boss,supervisor` 受众，旧 `预报催单` 精确/前缀只为存量 11 行保留且受众必须一模一样** ⇒ 一线 sales/staff/distributor 各 −11、guide 稳定 20、管理链 Δ0。🔴 同一 event_key 前缀不许同时服务「定向」与「管理兜底」；写端不传 event_key 会被 `norm_event_key(title)` 归一回 `预报催单 · 报单期次`（真踩）。定向类不看角色只看 `recipients`。**🔴 v776 另修「发送目标」，不是可见性**：`report_mapping` 5 行 `employee_id=0` 但有 `external_user_id` ⇒ 每期只发兜底广播、本人 0 条催单，**改受众表永远修不好**；按 uid 人级定向 `forecast_remind_ext_<uid>`（正文只列本人单元、无金额），受众同名前缀仅异常态兜底，纯增量 ⇒ 管理端 Δ0。映射须双收 `report_alias`+`system_name`（易胜玲/易胜琳异字）+ `is_active`/`user_tenants` 收口 + PRAGMA 判后加列。🔴 静态判据查全文 `user_tenants` 被 docstring 自撞成空白支票（m20 实测检出 0 条）⇒ 必须锚代码行。验证用**生产副本库真跑**（`ERP_DB_PATH` 指副本 + python 先灌 `.env` 的 `ERP_SECRET`），零生产数据改动。判据＝真实 `message_visible` 全表扫 + 内存改规则反证 + 本人 session 实测 total；护栏 ㊾（35 判据 / 27 坏样本）+ `v773-guide-notice-check.py`。探活端口 **8700**（写 8000 得 `000` 假故障）。→ `memory/2026-11-05.md`

## 实现 / 进度 / 主体 / 本机
实现：加列先吃「名称列」宽度、长文本列 `width+min-width` 同写｜分页条在滚动容器外｜加字段 4 处｜`ui_col_prefs` 租户级｜跨组件覆盖写在目标组件自己文件｜Bearer 免 CSRF，权限端点要 `X-Tenant-Id`。
进度：P0/P1 全交付；剩促销 ROI（端点 500）/货架位（零数据）/现金流预测页面化。**卖前三关未过；调拨单生产仍 0 张**。BI 唯一源 `erp_db.py:_BI_MEASURES`。敏感页必须后端 `_admin` 双保险。
主体：`hergent-cn-v2`(`laozhangai-product`)＋`hergent-erp`(FastAPI+SQLite)。脱敏红线：返利率/进货价/客户名/区域销量/厂家政策。
本机坑：🔴 `grep "A\|B"` 静默失效⇒一律 `-e`｜BSD grep 无 `\s`｜`| head -N`/`| tail -N` 会截掉决定性命中｜`grep -rl X *.py` 只搜顶层｜`grep "X-…"` 会命中更长名字⇒加边界｜`git commit -m` 含 `{}`/反引号静默失败⇒`-F`。🔴「搜不到」先排除「搜错范围/被截断」再当事实。
🔴 微信开发者工具 CLI 被「服务端口」挡住：`cli upload`/`open`/`islogin` 全报 `IDE service port disabled`，`--port` 绕不过；须人工在 IDE「设置→安全设置→打开服务端口」一次。
