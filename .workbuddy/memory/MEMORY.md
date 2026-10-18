# Hergent 记忆索引（只放判据级摘要 + 锚点；详情 `topics/*.md`，全史 `topics/version-history.md`）

> 2026-10-18（v603）：超注入上限，长段落已**逐字**迁入 `topics/frontend-ui.md` 的 `§MEM-ARCHIVE-v603`
> （含 v585 那份 `§MEM-ARCHIVE-v585`）。下面每条只留**判据**，原文在归档里查。

## 路由（🔴=硬判据，改前必读）
- 前端→`topics/frontend-ui.md`：入口唯一源`pages.js`(未登记=失门禁)§v209；`permView.js`唯一源、`module:null`=只读§v348；文案三禁⇒`hergent-ui-copy-guard`§v331；图表唯一源`src/components/chart/`(v491，导PNG须内联实际色)；列表页冻结/密度B/合计`psi-list.css`(v511-v514)；侧栏系列(v515-v517)只删菜单项、路由与`pages.js`登记不动；v518员工档案保存落库回读校验。
- 建单/退单页→`docs/进销存建单页开发规范-v441.md`：三层高度链｜`?tab=`+`watch`单入口多子页｜`npm run build`被safe-delete拦⇒隔离`outDir dist-vNNN`｜v449起7页独立(`docTypes.js`唯一源；`redirect`不指定`query`会继承原query⇒显式`query:{}`)。§R视觉基准=getComputedStyle实测。
- 后端→`topics/backend-invariants.md`：路由遮蔽先注册者胜§v317；静默失效=恒空恒0⇒`undefined-call-scan.py`；门禁用接口模块非页面模块§v328；FastAPI未声明query被静默忽略§v443；意图路由ROUTES按序首匹配(具体插宽泛前)v535；execute_tool返回键`success`非`ok`。
- 部署→`topics/deploy-ops.md`：后端FLAT`/opt/hergent-erp/`(本地仓`/Users/zhangjunfeng/Documents/hergent-erp`)、前端根`/opt/hergent-cn-v2`、`/admin/`别名`/opt/hergent-admin`；后端服务`hergent-erp.service`(cwd`/opt/hergent-erp`)，`hergent-server.service`是遗留Credits Server；部署前必先`git fetch`(落后构建=回退他人功能)v509；判据「线上跑谁」=`index.html` entry+该entry接线的chunk§v498；rsync绝对路径、绝不`--delete`；本仓`git checkout/clean`会毁SPA。
- 预报主表→`topics/forecast-order-domain.md`：报单单位永不落大单位；报单≠提货、`forecast_audit`锚`MAX(order_date)`；跨期复制只复制品清单⇒复0行传染§v282；🔴「N人报」=`COUNT(DISTINCT user_id)`是**账号数不是门店数**（老板一人替十几店填单⇒恒为1），要门店数用`stores`（带`store_kind`去重）§v574。
- 返利/目标→`topics/rebate-domain.md`｜货损效期→`topics/expiry-loss-domain.md`：适用月份只写到当月⇒次月规则静默消失§v376；进得去≠读得到(403被吞)§v353；到货停单⇒期次不自动建§v364。
- 进销存→`topics/inventory-psi.md`：八页继承父行门槛；入库批次三列不写⇒效期全空；FEFO不足整体拒绝、`sale_order_deliver`只收`draft`；退货可不挂原单、调拨走`transfer_orders`真双仓(失败必须raise)、无调拨退单v449；`StatusTabs.vue`计数必须服务端(口径=忽略status保留其余筛选)§v498；退单真身`return_orders`/`purchase_returns`(counts黑名单`='draft'`)；v509七列表页布局统一。
- 审批流(P1-2,v519+v525)→`server/routers/approvals.py`(6端点`/api/approvals`)；状态机`draft→pending_approval→approved→执行`；前端只接purchase/sale/transfer。
- 进销存岗位分权(P1-1,v517+v526)：v517会计/主管能进能建不能改删(`canUpdate`收口)；v526销售员行级隔离(`creator=operator_id=str(u.get("id"))`)；「开门」=老板勾`inventory`模块；绝不可把`sales`加进`PSI_ROLES`(跨租户红线)。三坑：①`_DEFAULT_PERMS`只管未覆盖角色⇒tenant_1/10须迁租户库；②`_perm_granted()`里list=全动作放行、dict才细分；③前端写操作曾全用`canDo('inventory','create')`一把梭⇒改挂`update`。
- 副驾/AI→`topics/ai-copilot.md`(`ai_tools`=只读SQL、数量类先GROUP BY)｜对账→`topics/reconciliation-redo.md`(P1-4 v527/v528：`/funds/reconcile`双上传走v198`recon_engine`；v533修`(await f()||[])`漏await)｜品牌/小程序→`topics/miniprogram-and-brand-data.md`。
- 新用户/价格→`topics/onboarding-and-archive-gate.md`：价格真身`customer_prices`；换算权威`products.large_ratio/medium_ratio`；客户档案列表必传`type=customer`。
- 跨域铁律→`topics/cross-domain-iron-laws.md`｜多会话并行总控→`topics/parallel-dev-protocol.md`。
- 协作规范→`docs/Hergent-开发团队协作规范与交付流程.md`：版本号`vNNN`全局序列/one-Edit-at-a-time+scoped提交/部署三件套/五段交付摘要。
- 进价/价格口径→`docs/进销存商品进价口径待办清单.md`：权威价源=舟谱《采购订货明细报表》(采购价列=小单位真实进价；数据6~1704、1705行合计必须排除)；批量改价前按「条码+单位名称」分组§v508；WAL库备份禁裸cp改`sqlite3 .backup`/`VACUUM INTO`。
- 蒙牛两户头=福宝/恒滋(`products.ordering_entity`)；下单侧档案家族25个「组/板/包/提」大单位、销售跑小单位兄弟档案⇒对`get_profit_report()`贡献恒0、不要改进价。`can_sale`全库473个全为1=死字段。

## 🔴 组件抽离五条必检（v557-v569）
1. 模板组件**逐个 import**（无自动注册）⇒ 漏 import 构建照过、运行时渲染成空元素；判据：产物搜 `_resolveComponent("X")`，出现即 bug。UI「元素看不见」先确认渲染了再调样式。
2. scoped 父抽离**必须连样式搬**：父 `data-v` 只打子组件根元素 ⇒ 内部布局/进度条/告警色静默失效。
3. 专属类 vs 壳层类：多弹窗共用壳层类（`.imp-modal`/`.del-*`）必须放**入口必载**全局表。
4. 控制器型子组件把**写操作 emit 回父级**：父管 `open`+校验，子只拉数据+交互+emit。
5. composable **必须 return 且在外层作用域**（`old_string` 以 `}` 收尾会匹配到内层函数，v569 二次踩）；判据：外层 return 后到 EOF 独立成行的 `}` 恰好 1 个 ⇒ 必跑 `composable-return-probe.cjs`。
- 工具链：`rm -rf dist-vNNN`/emptyDir 会被 safe-delete 拦（>50 文件）⇒ 用 `--emptyOutDir false` 或 `mv`。**报失败先排除 safe-delete，再当代码问题。**

## 🔴 三条结构判据
- **scopeId 由文件内容派生**（v570）：改注释也变 ⇒ 动过任何 SFC 就必须重构建重部署。判据：产物 `类名[data-v-xxxxxxxx]` 与本次构建一致。
- **全屏层之外的元素全屏一律看不见**（v584）：`.grid-area.is-fs{position:fixed;inset:0}` 盖满视口且无报错 ⇒ 要全屏可见必须**放进 `.grid-area` 内部**；补间距：gap 与自身 `margin-top` 叠加 ⇒ 用 `margin-top:4px` 抵回、贴合用 `-10px`。
- **挂点优先选本来就存在的行**（v603）：页脚 `.pin`/`.edit-summary` 已在 grid-area 内 ⇒ 新增入口挂这里 = 零新增行 + 零全屏分支；工具栏 `.grid-ctl-row` 已近满宽，加按钮必折行 = 反而多占一行。

## 🔴 行筛选有两条判据（v607）
- 🔴 行显隐**两份实现**：查看态 `rowVisible(r)`、编辑态 `rowBaseShown(ri)`（编辑表 `<tr v-show>` 的唯一判据）。**新增任何筛选条件必须同时改两处**；品牌只写在后者外的第一个 ⇒ 编辑态点品牌按钮只改 `brandSel`、行一条不动（角标会变），保存退出才「突然生效」。定式：两处共用 `brandSelSet`（computed Set，逐行 `includes` → O(1)）。
- 🔴 **筛选条 `v-if` 要按「触发控件是否自带角标」分两类判**（v608 纠正 v607 的错判）：
  - 列筛选 / 唯一值筛选：表头**无任何角标** ⇒ 必须留 `.filter-row` 的 chip，否则用户清不掉。
  - 品牌筛选：工具栏按钮**自带 `.btn-badge` 数量角标**、面板内还有「全选 / 清空」⇒ **不要再出 chip**
    （用户原话「品牌筛选按钮自带已选品牌个数，这个不需要」）。v607 我补上 `|| brandSel.length` 属于重复信息，v608 已撤。
  - 通用判据：**同一个状态在触发它的控件上已经显示过，就别在下方再复述一遍**。上线前问一句「这个数字是不是说了第二遍」。
- 🔴 **删控件必须 grep 它的中文引导词**：v608 删了 chip，toast 仍写「点筛选条上的 × 清空品牌筛选」⇒ 用户会去找不存在的控件。删 UI 后搜 `筛选条`/`点 ×`/`按钮` 等文案并改写。
- 筛选激活时「新行 brand 为空」会被直接筛掉 = 点「补录商品」什么都没出现 ⇒ 单品牌时继承该品牌，多品牌/粘贴路径必须 toast 说明（`addRow` + 两处粘贴）。
- 🔴 **死 import 的隐形性**（v607）：`useForecastMoq.js` import 了 calc.js 从未导出的 `rowSumOf`，且被函数形参完全遮蔽 ⇒ Rollup 只 warning、产物里 undefined、线上行为正确；**dev 下 ESM 严格校验整页加载失败**，症状「点菜单 URL 变 #/forecast、页面还停在经营工作台」，无 toast 无提示。判据：**dev 进不去而线上正常 ⇒ 用 dev 的 `router.push()` 取真实错误**，别先怀疑权限/路由。
- 🔴 **查看态内联编辑只脏内存、不脏库，但会污染下游真实动作**（v610 实测）：`commitCell` 只改 `cross.rows`，
  刷新即回退、进改单也会重新拉服务端值；但**合计/金额/最终下单/「复制报单→下单数量」都读同一份内存**
  ⇒ 屏幕改了、库里没改，复制给厂家下单就是对不上的量，且改完**零提示**。判据：凡是「内存派生 → 剪贴板/导出/下发」
  的动作，必须先确认读的是已保存值；读内存就必须在存在脏改动时告警或禁用。
- 探针：品牌列是 `<input>` ⇒ `td.textContent` 恒空，必须读 `input.value`；登录用裸 fetch ⇒ 必须 `Page.reload` 一次才能让 App 从 localStorage 恢复登录态。

## 🔴 表格密度 / 行高（v571-v606｜全文 `topics/frontend-ui.md` §MEM-ARCHIVE-v607）
- 定式：`.cross-tbl{--fc-cell:18px}` 唯一源（td line-height / `.cell-input` / `.cell-ro` / 表头齿轮全取它），垂直 padding 归零 ⇒ 数据行 **21px**；密度开关只改横向留白。
- 🔴🔴 改行高前**先查用户在哪一档**（`tenant_1.db:ui_col_prefs WHERE page='ui-density'`；`html[data-density]` 更可信）：v571/v575 压的都是 compact 而用户看 cozy ⇒ 两次"已达标"被打回。
- 🔴 **行高真凶通常不是 padding/变量，是子元素 display**：v606 编辑表死钉 31px，元凶 `.btn-del` 30×30 + `inline-flex` 按基线顶行盒。判据：先量 td 高，再量格内子元素 `display/vertical-align`；`inline-flex/block` 一律 ≤ `--fc-cell`，或改 `display:flex`+`margin:auto`。
- 🔴 同分打死（页面 CSS 懒加载后注入者胜）/ 底部占位不许写死（遍历兄弟 `gap+marginTop+height`）/ 虚拟滚动常量必须与真实行高同步 / 合计栏在滚动容器外 —— 四条细节见归档。
- 域名：cn-v2 前端 = **hergent.cn**；`erp.hergent.cn` 是另一套 admin（对 cn-v2 产物 404）。

## 🔴 数字的单位必须跟着口径走（v587）
- 返利目标 `target_type = amount | quantity`；quantity 时目标/达成/贡献/缺口/均单**全是件数**。模板写死 `¥` 就是把量读成额。**改任何显示数字处先问：这个数是什么单位。**
- 定式：`isQtyRow(s)` 单一判定 + `uVal(s,v)` + `uGap(s,v)`。
- 🔴 跨口径不能相加：多条规则可能一条按元一条按件 ⇒ 汇总必须判 `amount|quantity|mixed`，mixed 时**不给金额**、写明"口径不一致、不合并汇总"。同类：数量型规则的排序键必须同口径，否则缺进价品（金额恒 0）被整条漏掉。
- 🔴 真实数据里不存在的分支怎么验：生产构建已剥离 `__vueParentComponent` ⇒ 正解是**从 SFC 源码正则抽取真实函数**执行 + 断言模板绑定（`v587-unit-logic-test.mjs` 式）。

## 🔴 拖动填充 / 拖动类交互（v593-v597｜全文 `topics/frontend-ui.md` §MEM-ARCHIVE-v605）
- 跟随鼠标的交互必须有**随状态变化的 DOM 物**（`fillEnd` 只写不读 = 全程零变化）；覆盖层 `pointer-events:none`，坐标靠首尾格 rect 相减（**禁累加行高**：密度两档 + zoom 必错位）。
- 线性填充只沿主方向（按屏幕像素判向）；`fillSpan(a,b)` 单一函数同时供预览/写入/提示；横向左界 = 冻结列右边界（不夹会写脏商品名，单价格 `edit:'num'` 会被放行直入下单金额）。
- 🔴 拖框选后快捷键全灭：`onCellOver` 主动 `blur()` ⇒ `activeElement` 变 BODY ⇒ 挂在 `<table @keydown>` 的 Ctrl+D/R/C 静默失效。先查 `document.activeElement`。边缘自滚必须与视口取交集，滚完重新 hit-test。

## 🔴 页脚胶囊 / 浮层（v583-v588 / v603 / v605）
- 数字只有一个源：父级做摘要胶囊必须让子组件 `emit('summary')` 回传，**父级不得重算**。软删行（`_deleted`）必须过滤，与 `liveRows` 同口径。
- 悬停浮层：点击**不做 toggle**、`@blur` 别用来关；关闭只靠移出延迟(220-260ms)/点别处/Esc。
- 浮层定位定式：`Teleport + fixed + z-index 1250`（> `--z-page-fs` 1000）；**水平居中**用 `left:50%+translateX(-50%)`；**垂直锚触发器**（向上/向下弹）。`transform` 创建 containing block ⇒ 浮层内不得有 `fixed/sticky` 子。有自定义浮层就删掉触发器 `title`。
- 点开式（非悬停）浮层：Esc 监听必须挂**捕获阶段 + stopPropagation**，否则表格的 Esc（放弃本格修改）会跟着一起执行（v603）。
- 🔴 **`margin-left:auto` 的推手不能挂在带 `v-if` 的组件上**（v604）：SprintChip 根元素 `v-if="show"`，无冲刺数据时整块不渲染 ⇒ 推手消失、整行退化成左对齐（右侧控件离右边界空 211px，无报错）。凡"靠右组"必须包一层**常显容器**（`.es-right`）承受 auto。
- 页脚并排控件（合计/冲刺/快捷键）一律 ≤22px 高、12px 字，页脚行高 24px 不得被顶高（v603/v604）。
- 🔴 **v605：编辑表分页整块撤除**（改造动因=用户「不要上一页下一页，点改单直接显示全部」）。认知要点：那套分页是 `v-for` 全渲染 + `v-show` 隐藏 ⇒ **DOM 节点数一个不少**（实测 154 行 / 11990 节点），只省 paint ⇒ 「为性能而分页」在编辑表是伪命题；删掉后进改单 278ms 就全量可见，无卡顿。
- 真机验证必须 `Input.dispatchMouseEvent` 真移鼠标 + `Input.insertText` 真键入；几何断言用 `getBoundingClientRect`，别用截图目测。

## 🔴 护栏与产物校验的坑
- 🔴 `v-focus` 类自定义指令「没注册」= 全程静默无效（v589）：全仓从未 `app.directive('focus')` ⇒ Vue 只 warn、构建照过，症状是"输入框不聚焦/光标停末尾"。新增/搬运模板时凡自定义指令必须在 `main.js` 有对应注册；修完必须**运行时量**（`selectionStart/End`、`activeElement`），产物 grep `resolveDirective` 是假阴性。
- 🔴「点击即全选」只能挂 click/mouseup，不能 mousedown（v590，mouseup 会把 `select()` 折叠成光标）；已在编辑同一格时禁止再给 `editingCell` 赋新对象。**用户说"点击"就是单击**（v589 只做双击被退回）。
- 🔴 `Icon.vue` 是手写 `ICONS` 映射，**写错名字静默兜底成齿轮** ⇒ 用前必须确认名字存在（v453/v601/v603）。
- `forecast-split-guard.py` 的 API 锚点统计**不剥注释** ⇒ 子组件头注释只写方法名；别改护栏去剥注释（基线是旧口径录的）。
- 产物验证正则必须带 `[data-v-xxx]`；**不能 grep 函数名**（minify 改短 ⇒ 假阴性），要 grep 稳定的类名字符串。

## 🔴 部署必检：入口依赖闭包（v583 整站白屏）
- 只传「改动的几个 chunk」不够：新构建文件名可能与线上完全不同（实测 190 个闭包里 99 个线上没有）⇒ 新 entry 引用的 chunk 全 404 ⇒ **整站白屏**。
- 定式：`python3 ../.workbuddy/tools/deploy-frontend-closure.py --push`（以 `dist/index.html` 为种子递归解析 → HEAD 校验、自动补传）。**最后才传 `index.html`**，然后双侧 md5 五件套。
- 🔴 `rsync -R dist/./x` 不锚在 dist，会铺到 `<目标>/dist/…`；用「源文件 → 目标全路径」逐条传。别用 `comm` 比清单（locale 序 ≠ ASCII 序）。

## 🔴 Excel 化改单网格（v597-v598｜细节 `topics/frontend-ui.md` §MEM-ARCHIVE-v605）
- 🔴 响应式 ↔ WeakMap 基线必须 `toRaw()`（模板里 `r` 是深层 Proxy，与原始对象不同 key ⇒ `get()` 恒 undefined、判据恒 false、**零报错**）。任何「用对象引用当 key」的缓存同族。
- 单值粘贴铺满只在 1×1 且选区>1 时成立；改过角标判据 =「当前值 ≠ 基线」，基线建在**草稿合并之前**（=服务端已保存值）。
- 探针两坑：CDP 对**视口外坐标**派发鼠标事件静默无效；`Tab` 跳格触发横向滚动后旧坐标全失效 ⇒ 每次操作前重取。

## 页面真身速查（标题近似、极易改错文件）
- 「预报订单管理 → 商品目标 → 新建商品目标」= `src/pages/ProductTarget.vue`（`/forecast?tab=target` 第 4 页签 ⇒ 无独立 chunk，样式合进 `Forecast-*.css`）。
- 「目标与返利政策 → 创建商品目标」= `src/components/rebate/TargetFormModal.vue`（+`ProductTargetForm.vue`）。

## UI 风格偏好（全文 `topics/frontend-ui.md` §MEM-ARCHIVE-v606）
- 🔴 **同行控件必须同构**（v599）：基准 `.tb-toggle`/`.btn-sm`（32 高 / 13 字 / 1px 边 / radius 8 / `padding:0 12px` / pointer）；判据 = 顶边差 0、高度差 0。
- 🔴 **看起来能点的必须真能点**：`role=button`+`tabindex=0`+`@click`+`@keydown.enter/space`+`cursor:pointer`+hover。**图标尺寸只由 CSS 定**（全局 `.ico{16px}` 胜 `<svg width>`），量法只认 `getBoundingClientRect`。
- 🔴 拒绝任何容器形状（圆形/圆角 ghost 全被否）：定稿 = 裸青色 `chevron-right`（零 bg/border/radius，展开转 90°，静息 `.55`）。**自创形状必被否，先 grep 既有同类控件**。
- 其余（筛选徽标只留文字 / Esc 放弃本格修改的还原源 / 编辑态格内即输入框）见归档。

## 进度 / 交付锚（详情 `topics/`）
P0 7/7；P1 6/6✅（分权 v517+v526｜审批流 v519+v525｜四报表 v506+v507｜对账 v527-v533｜批次追溯 v529-v531｜批量栏 v532）。报表区 33 入口仅 4 真身。P2-4 副驾经营指标 + P2-2a 预警外发已交付(v535)；剩余促销ROI(端点坏死500)/货架位(零数据)/现金流预测页面化。**卖前三关未过；调拨单生产仍 0 张**。BI 指标唯一源 `erp_db.py:_BI_MEASURES`（口径必须 `soi.amount`）；库存周转唯一源 `get_inventory_turnover`。

## 编号约定
已用到 v609；下一号 v610。🔴 **「改了但用户说没变」第一步先查前端构建号**：`window.__HG_BUILD__`（`main.js` 唯一定义处）+ `html[data-build]` + 「预报 → 修改日志」面板标题旁。SPA 老标签页**永不重拉 index.html** ⇒ 部署了也看不到。每次发版**手动改这一行**。
- 起号必读 `version-history.md` + 实搜两仓 `git log --all` + `git worktree list`。v517 被双占。并行分叉：scoped 提交→merge origin/main→合并 HEAD 重建→部署→验「双方标记都在」。改 `pages.js` 先分清单"路由"还是"门禁"（本项目=门禁唯一源，`ruleFor` 未登记 path 一律放行 ⇒ 删占位登记=放宽门禁）v499。前端 `roles` 窄名单非真保险 ⇒ 敏感页必须后端 `_admin` 双保险(v531)。
- ~~改单数据行 31px 是既有事实~~ **v606 已查明并修掉**：元凶是操作列 `.btn-del` 30×30 + `inline-flex` 按基线顶行盒（详见「表格密度 / 行高」段）。旧结论「别照行高链直接改」作废——当时只是没找到撑高件。

## 主体 / 脱敏 / 技能 / 本机坑
主体 hergent-cn-v2(`laozhangai-product`)｜hergent-erp(FastAPI+SQLite)。脱敏红线：返利率/进货价/客户名/区域销量/厂家政策；PII 不落 `outputs/`。技能：`hergent-pre-launch-audit`｜`hergent-scoped-commit`｜`parallel-session-safety`｜`rebate-caliber-consistency`｜`chart-render-verify`｜`ui-copy-guard`｜`external-material-pdf`。本机坑→`topics/local-machine-pitfalls.md`（`grep "A\|B"` 静默失效⇒`-e`；`&&` 短路；`| head -N` 截命中；`grep -rl` 只搜顶层；探针别放 `/tmp`；ssh 嵌 python 引号错乱⇒远端脚本）。
