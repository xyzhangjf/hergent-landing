# Hergent 记忆索引（判据首句 + 去哪查；细节全在 `topics/*.md` / `.workbuddy/memory/YYYY-MM-DD.md`）

**前端最新 v759**（小程序「本期已有单」服务端横幅）｜v758 撤回单「继续修改」｜v756 关单可保存+粘贴落点｜v755 撤回闸门/新增客户列｜v754 品牌筛选｜v752 删列回读｜v751 品牌焕新｜v750/v749 焦点环｜v747 侧栏图标｜v746/v745 缩放留白｜v744 副驾下载。唯一开发源 `main`。
🔴🔴 **「撤回后要全部重新填报」= 数据没丢，是入口被关了**（v758，小程序）：`forecast_submission_recall` 只 `UPDATE status='recalled'`（**明细一行不删**，生产 2453 撤回后 23 行/300 件全在），而 `rec-copy` 与 `genSample` 都把 `recalled` 排除 ⇒ 23 行只能手打。**「继续修改」≠「复制样单」不许合并**：复制=拿别期有效单当模板（排除作废单是对的）；继续修改=把这一单拉回来（提交命中幂等键 `(店,期次)` 原单、单号不变、`status` 复位 pending）。**rejected 仍禁**（驳回是审批方否掉的）。
🔴🔴 **`_applyCopySample` 只切门店不切期次**（v434 前提是"样单落到当前选中期次"）⇒ "改这一单"必须**两层对齐期次**：`_applyPeriods` 优先选中 `_pendingCopy.period_id` + `_applyCopySample` 再校验不一致就明确拒绝。否则 23 行整批报到错的期次、**零报错**（数量合法、商品都在清单内），最难发现。
🔴 **入口是否出现第三次必须由服务端给**（v259 `can_delete` → v755 `can_recall` → v758 `period_writable`）：期次一关就改不了（路由层 `forecast_period_writable` 硬锁），前端自己判必然再造「按钮亮着、点了报错」。
🔴🔴 **「本期报没报」必须问服务端，本机回执只是兜底**（v759 方案 B —— 让用户**根本不需要撤回**）：`submittedInfo` 是纯本机 Storage（`fs_sub_<店>_<期次>`），两个硬伤治不了 —— ① 换手机 / 清缓存 / 换人登录就消失（单还在库里）；② **只有"已报"一种状态**，撤回后只能靠 `_fsRecall` 跨页信号去清，杀进程再进照旧挂「✓ 本期已报」⇒ **漏单**。修法：`/my?store_id+store_kind` 取回后按 `period_id` **精确匹配**，文案在 `_buildServerSub` 里拼（五种组合摊在 wxml 必漏一种）。🔴 两条横幅 **`wx:if`/`wx:elif` 互斥**（一屏两条「本期已报」比没有更糟）。🔴 **不自动预填**（覆盖式预填会静默改掉已填数），只给按钮 + `_applySample` 的覆盖确认。🔴 刷新时机四条缺一即陈旧：挂 `refreshBanners` 末尾 / 提交后 `force` / 撤回后清 `_serverSubKey` / `onShow` 60s 节流。键名构造收敛单点 `_subKeyOf(o,pid)`。
🔴🔴 **后端仍零版本管理**：生产 `/opt/hergent-erp/` 是 FastAPI+`routers/` 新架构（非 git 仓、有 `.env`），本仓 `server/` 是旧单文件架构、无 `routers/` ⇒ 本地无副本。判据 `grep -c 主管调整 server/erp_db.py`==0 而生产有 ⇒ **"提交了前端" ≠ "后端也入库了"**。靠 `.workbuddy/remote-erp/` 手工回拉。

## 🔴🔴 部署（错一步=假部署）
`deploy-frontend-closure.py --push` **只补 assets 闭包、不传 index.html** ⇒ 只跑它=线上仍旧入口。**三步**：`--push` → 验 274/274 全 200 → 最后 `rsync dist/index.html`（**绝不 `--delete`**，先 `cp -a` 备份）。
验产物**必须从线上 curl 拉回来 grep 文案**：`emptyOutDir:false` 会堆旧同名 hash chunk ⇒ `find(/^Forecast-/)` 抓到旧包，得「改动没进产物」假结论。「改了没变」先查 `window.__HG_BUILD__`+`html[data-build]`。
🔴 `vite build` 十几分钟零输出 = 安全删除护栏拦住清 `dist/assets` ⇒ `build.emptyOutDir:false`。合并/解冲突后**必须** `npm test`+`build`：重复 `export`／对象键／整段模板被覆盖 ⇒ **构建不报错**。
🔴 后端 FLAT `/opt/hergent-erp/`｜前端 `/opt/hergent-cn-v2`｜服务 `hergent-erp.service`｜根路径=ERP 前端，**`/admin/`=另一应用**（`/admin/assets/x.js` 永远 200 但返 index.html）→ `topics/deploy-ops.md`。

## 🔴🔴 护栏机制（最易伪造「全绿」）
**`run-all.mjs` 不自动扫描**：每个 `*.contract.mjs` 必须显式 `run('文件名')`，否则**永不执行**、`npm test` 照样 ALL PASS（连踩三轮）。**写完必须确认它出现在输出里**。
防三种「空白支票」：正则抽空集全票通过（加解析自检：区数<10 就红）／只查唯一不查存在／只写上限（**必须三态**：命中/新增报错/冻结数不满也报错）。护栏必须接进「全部通过→exit(0)」那个大 if。
🔴 **「有没有检查」≠「检查有没有被执行」**（v748 孤儿护栏）：每条要 runner 注册 + **坏样本自证**。
🔴🔴 **加函数前先 `grep -c "function 名字"`**（v756）：同名函数**声明提升静默覆盖**、编译不报错 ⇒ 交付两份语义不同的实现。
🔴 **撤共享前缀的兄弟函数是高危动作**（v755）：`onTbCtx`（表体单元格右键）≠ `openTbCtx`（工具行菜单）。**先数引用再动手**。

## 🔴 预报 · 数据链路（最高频）
🔴🔴 **改数保存后回跳 = 显示跨角色求和、保存只覆盖一个 role**（v741→v743）：显示=`导入`+小程序 `distributor` 求和，`save-matrix` 只写 `role='导入'`。修法**不是删数据**是拆差额（发 `合计−非导入`，负差额落 `role='主管调整'`）。三件缺一即假生效：`FORECAST_IMPORT_SCOPE_SQL` 两处含两角色／前端 `nonImportByPid` **必须排除 `主管调整`**／`VK_NEG` 只接住「带负号」。`forecast-qty-revert`。
🔴🔴 **保存了又变回原值 = 假保存三连**（v737 第二次踩 v706）：`|| undefined` ⇒ `JSON.stringify` 丢键 ⇒ 后端 `if k in d` 判不到 ⇒ 不写库；回读校验 `===undefined` 又跳过它 ⇒ toast 照样「已保存」。判据不是"哪些是新字段"，是**"界面能不能把它删空"**。`employee-clearable`。
🔴🔴 **已关闭期次保存灰掉 ≠ 权限不够，是前端刹车没跟后端**（v756）：后端 v305 起 `save-matrix` 对 `SUMMARY_ROLES` 已支持 `allow_closed`+留痕，错在**三处同款踩死**：`enterEdit`／`saveDisabled`／`saveEdits`。统一 `&& !canEditClosedPeriod`，复用 v305 同一份名单。🔴 合成期次(`p.id`=0)必须继续拦；「导入 Excel」对已关闭期次仍禁，只有**粘贴**通。`forecast-closed-paste`。
🔴🔴 **粘贴"静默"实质是「数字不对位」不是「没数字」**（v756）：286 行表+三十来客户列+50% 缩放下落点常在视口外。三层缺一即等于没做：描边淡底 2.6s／toast **用商品名·客户名**报落点／视口外滚动 + 分批挂载下先 `ensureRowsRendered` 撑出落点行。🔴 **顺序不可反：先扩渲染→再标→最后滚**。
🔴 **「这一列删不掉」先分清三件**（v740）：入口存不存在（只读态表头右键只有一句灰字，用户看到的是"没删除项"）／落不落库（要 `save-matrix.hidden_customers`→`forecast_hidden_units`）／是否被本期报单挡住（**不挡**）。判据：只读态必须有**可点**入口（只转调 `enterEdit`，不许复制第二套闸门）+ 删完 toast「点保存才生效」。`forecast-delcol-persistence`。
🔴 **「列能拖了」= 四件缺一即假生效**（v739）：按存下来的顺序排／表尾合计**按列名取不许按列号反推**／拖动 ≥5px 且不抢改单态「选整列」手势／落位写 `cfg.cust`（`ui_col_prefs` 租户级）。用 **pointer 事件不用 HTML5 draggable**。`forecast-cust-col-order`。
🔴 **某几列不跟斑马纹/hover 走 → 先查冻结列**（v738）：斑马纹在 `<tr>`、冻结列在 `td` 写死不透明底 ⇒ **子背景盖父背景**；两条规则各自都"对"，只有逐格量 computed 才暴露 ⇒ 判据是**同一行不同 td 的 bg 是否一致**。修法不是补一条斑马规则，是**行状态统一下发 `--row-bg`、冻结列只读它**，半透明行色 `color-mix` 压实色。`forecast-sticky-zebra`。
🔴 **「以前有 X 按钮现在没了」先查是不是上一轮按要求改成了右键菜单**（v753→v754）：撤成 `tbCtx` 后只留零尺寸锚点（**绝不用 `display:none`**，否则 `getBoundingClientRect` 全零、面板定位失效）⇒ 不习惯右键的人=「按钮没了」。**每次撤常驻入口都要问：发现性靠什么补**。`forecast-toolbar-buttons`。
🔴 **判库存只认 `inventory`**（`quantity`+`stock_value`）；`inventory_balance` 是**空表**⇒得「账面全 0」假结论。流水 100% `change_type='opening'` ⇒ 判「有没有动过」不能只看流水。

## 🔴 `zoom` 缩放（两套坐标系）
🔴🔴 **虚拟滚动窗口必须换算坐标系**（v745）：容器 `scrollTop/scrollHeight` 在**缩放后**坐标系，而 `ROW_H`/`vsOffsets` 在**未缩放** ⇒ 当未缩放可见下沿用 = 窗口只覆盖 1/z 屏 ⇒ **只渲染半屏 + 下方空白**。判据：**50% 的渲染行数必须 > 100% 的**。`forecast-zoom-virtual`。
🔴🔴 **同一个留白在改单态还有第二份实现**（v746）：改用「首批 N 行 + 每批补齐」(v666)，`EDIT_FIRST_BATCH=24` 按 100% 一屏定的死值 ⇒ 缩小只铺半屏。**报障形态是「一直挂着」不是「闪一下」**：「击键让路」在最前、`_lastGridTypeAt` 只在 `.cell-qty` 更新 ⇒ 数量格连打 ⇒ 补齐被无限期挡回。两件缺一即假生效：首批按 `ceil(editMaxH/(ROW_H*z))`（**z≥1 回退 24**）／**`needFloor` 放在击键让路之前**。`forecast-edit-batch-zoom`。
🔴 **A/B 对照**（v746）整页回退 / 留白量法 / 探针打 `.cell-qty` —— 三个坑全文 `topics/frontend-ui.md` 末节。

## 🔴 小程序撤回 / 归属闸门（后端已生效，小程序待发版）
🔴🔴 **「点撤回提示仅本人或管理员可撤回，点的人就是本人」= 按钮缺归属闸门**（v755）：模板只判 `status==='pending'` 不看归属，而列表范围是「我报的 OR 我负责门店的」⇒ 混进别人的单（删除早有 `can_delete`，撤回漏了同一个）。修法：服务端逐条给 `can_recall`、`/my` 传 `role`。🔴 期次可写闸不能省（`recall` 函数内不判、硬锁在路由层）⇒ 否则又造「点了就报错」；判「UI ⊆ 后端放行」须手工补闸，直调 db 层会假绿。
🔴 **字段白名单静默丢字段**：`mine.js` 必须 `...r` 展开。护栏 `miniprogram-recall-gate`；跨仓断言要**切片到 `/my` 函数体**，全文级会被其他路由救成假绿。
🔴🔴 **v757：「报了单却撤不了」的第二形态 —— 单子名义上从来不是她的**（导购马耀秀，期次还开着按钮仍不出现）：主管先导入（`role='导入'`/`user_id=老板`），员工小程序提交**原位替换到那一行**（v224 键 `(store,period)`，`replace` **有意不动 `user_id`/`role`**）⇒「本人」判据**恒不成立**；主管再 `save-matrix` 又按 `FORECAST_IMPORT_SCOPE_SQL` 删建 ⇒ `updated_by` 也没了。**修法不是补字段，是加第三条通路：该单的 `(store_id,kind)` ∈ 我的报单范围**（与提交越权校验共用 `report_subject_stores`），收敛成单点 `forecast_recall_allowed()`，列表与写入口**都调它**。撤回是软删、`can_delete` 不动；生产 `report_mapping` 20 对象**全部一店一人**。
🔴🔴 **判据函数收「范围」必须两种形状都吃**：列表传 `(id,kind)` **元组**、路由传 `{id,kind}` **字典**；只认一种不报错，而是 `int(元组)` 抛错被 `continue` 吞成**静默 False** ⇒ 按钮照样不亮（v757 第一版自己又造了一遍原 bug）。`v757-recall-scope-harness.py`（`/tmp` 副本、生产零写）。
🔴 **`created_at` 默认 `CURRENT_TIMESTAMP` = UTC，比本地早 8 小时**：曾把 10:11 的导入读成"凌晨 02:11"。判「今天/先后」一律减 8 小时或改用 `updated_at`（`localtime`）。

## 🔴 UI 判据（全文 `topics/frontend-ui.md`）
🔴 **「两边品牌色不一样」先数色值个数，别比色相**：一个语义位置出现第 2 个色值就是 bug。唯一源 `miniprogram/app.wxss` 的 `page{--brand}`；**吃不到 CSS 变量必须同批手改**：`app.json` nav/tabBar、`showModal.confirmColor`、`<switch color>`、**`tab-*-active.png`（色烘在像素里）**。
🔴🔴 **「品牌色统一过了」先问「护栏在跑吗、认几种写法」**（v748）：只认 `#hex` 的校验**看不见 `rgba(6,182,212,.92)`**（数值上就是旧亮青）⇒ 必须按数值判；**带 alpha 就不再是品牌色**（白字掉到 2.55:1）⇒ 要"浮起来"用阴影不用透明度，浅染底色直接**烘成实色**（主色 8% over 白 = `#ECF4F3`）。`miniprogram-brand.contract.mjs`。
🔴 **焦点环两层必须同时守**（v749/v750）：一层治「组框已画环、框内又画一层」，一层治「控件画环、与边框隔 2px」。根因 **`:focus-visible` 对文本类控件鼠标点击也成立** ⇒「只有 Tab 才出圈」对 input/select/textarea 永不成立；`:focus-within` 必须紧贴容器右括号；判有没有环看 `outline-style` 别看宽度。`focus-ring-takeover`。
🔴 **排版/令牌**：**字号归并 ≠ 行高归并**（行高只影响垂直，字号改**宽度**⇒换行/截断/列宽）；最难发现的债是**「同值两个名字」**；**一个令牌两语义**只能**拆名**+护栏防合回；`rule.style.fontSize` 读 `var()` 返**空串**。**间距归一「收大留小」**：判据是**这 2px 人眼看不出**，方向**往上取整**。「用行高当高度」≠行距。余 → `topics/frontend-ui.md`。
🔴 **「字不够黑」先查层级倒挂**（v735）：未选中 5.25 ＞ 已选中 4.96 ⇒ 一屏没「深」锚点，改一处无用。文字 7:1 / UI 图形 3:1 分档；`--t2`≡`--t3` 同值 ⇒「把 t3 改成 t2」是**零变化**；改字色必须同批处理 **hover 底** 与 **`<a>` 下划线**。
🔴 **侧栏图标撞车**（v747）：同一位置两并列项形状分不清就是 bug，渲染/功能全绿、**只有看才发现**；⌘K 面板**同批改**；⚠️ 别用 `bars` 顶替 `bar-chart`。护栏查**唯一性 + 图标名存在**双条（`sidebar-icon-unique`）。

## 🔴 探针身份（v729，最易伪造「0 缺陷」；全文 `topics/local-machine-pitfalls.md` 末节）
🔴🔴 **登录态已迁 cookie** ⇒ 老探针**静默跳 `#/login`**（`get token()` 恒空、写 localStorage 无效）；用 `routers/auth.py` 三枚 cookie。🔴🔴 **`/root/probe_token.py` 是旧版硬编码 user 1** ⇒ 症状**不是 401**，而是**侧栏只渲染 7 区**（`REPORT_VIEWER_ROLES` 滤整区）⇒ 极易误判成「区被删了/图标 bug」⇒ **任何侧栏/权限探针第一条断言必须是「侧栏区数 ≥ 11」**。token 过期 ⇒ **全部**页静默回 `#/workbench`；**权限不足 = 只有部分页回退**。截图必须 `p.screenshot(path,{clip})`。

## 路由（🔴=硬判据）
- **前端** → `topics/frontend-ui.md`（5.5k 行，**改前必 grep**）：入口门禁唯一源 `pages.js`（未登记=放行）｜`permView.js` 唯一源、`module:null`=只读｜文案三禁⇒`hergent-ui-copy-guard`｜图表唯一源 `src/components/chart/`｜列表页冻结/密度 `psi-list.css`｜副驾 `⌘K`/`⌘⇧K` 已占用 ⇒ 新的用 `⌘⇧O`。
- **后端** → `topics/backend-invariants.md`：路由遮蔽**先注册者胜**｜静默失效=恒空恒 0 ⇒ `undefined-call-scan.py`｜门禁用**接口模块**非页面模块｜FastAPI 未声明 query 被静默忽略｜`execute_tool` 返回键是 `success`。
- 🔴🔴 **改角色权限必须走 API `POST /api/role-permissions`**（直写库绕过 `reload_perms`+不留 `audit_logs`），合并语义「未列出=移除」⇒ 传**完整清单**。`roles` 与 `module` 是**两条独立轴**。
- 🔴🔴 **副驾产物 403「不在可访问范围内」= 允许根只认了一半 home**（v744）：`_host_home(1)=/root/.hermes` vs `home_for(1)=/opt/hermes-tenants/hergent_t1`（真产物）。修法=两者**并集**。**"能生成不能下载"先查这里，别查鉴权/穿越。**
- **域**：预报 `forecast-order-domain`｜返利 `rebate-domain`｜成本容量 `cost-and-capacity`｜账务 `accounting-gl-v716-v717`｜条码小程序 `miniprogram-and-brand-data`｜副驾租户 `copilot-tenant-memory`｜本机坑 `local-machine-pitfalls`｜库存 `inventory-psi`。

## 实现 / 真机 / 进度 / 主体
实现/真机：加列先吃「名称列」宽度、长文本列 `width+min-width` 同写｜分页条在滚动容器外｜加字段 4 处（`employee_create` 有第三份 `allowed`）｜`ui_col_prefs` 租户级｜跨组件覆盖写在目标组件自己文件｜生产后端**不是 git 仓**｜Bearer 免 CSRF，权限端点要 `X-Tenant-Id`（原文 `topics/impl-and-deploy-criteria.md`）。
进度：P0/P1 全交付；剩促销 ROI（端点坏死 500）/货架位（零数据）/现金流预测页面化。**卖前三关未过；调拨单生产仍 0 张**。BI 唯一源 `erp_db.py:_BI_MEASURES`。敏感页必须后端 `_admin` 双保险。
主体：`hergent-cn-v2`(`laozhangai-product`) + `hergent-erp`(FastAPI+SQLite)。脱敏红线：返利率/进货价/客户名/区域销量/厂家政策。
本机坑 → `topics/local-machine-pitfalls.md`：🔴 `grep "A\|B"` 静默失效⇒一律 `-e`｜BSD grep 无 `\s`｜`| head -N` 会截掉决定性命中｜`grep -rl X *.py` 只搜顶层｜`git commit -m` 含 `{}`/反引号在 zsh 静默失败⇒`git commit -F-`。🔴 **「搜不到」必须先排除「搜错了范围/被截断了」，再当成事实。**
