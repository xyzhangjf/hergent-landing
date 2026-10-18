# Hergent 记忆索引（只放判据级摘要 + 锚点；详情 `topics/*.md`，全史 `topics/version-history.md`）

> 2026-10-18：本文件曾超注入上限，长段落已**逐字**迁入 `topics/frontend-ui.md` 的 `§MEM-ARCHIVE-v585`。

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

## 🔴 组件抽离五条必检（v557-v569｜原文 §MEM-ARCHIVE-v585）
1. **模板组件逐个 import**：无自动注册 ⇒ 漏 import **构建照常通过**、运行时渲染成空元素。判据：产物搜 `_resolveComponent("Icon")`，出现即 bug。UI「元素看不见」先确认它渲染了再调样式。
2. **scoped 父抽离必须连样式搬**：父 `data-v` 只打子组件**根元素** ⇒ 内部布局/进度条/告警色静默失效（只剩边框渐变，极难察觉）。
3. **专属类 vs 壳层类**：多弹窗共用壳层类（`.imp-modal`/`.del-*`）必须放**入口必载**全局表，不能靠懒加载组件顺带注入。
4. **控制器型子组件把写操作 emit 回父级**：父管 `open`+校验，子只「拉数据+交互+emit」，禁止「子改一半、父再改一半」。
5. **composable 必须 return 且在外层作用域**：`old_string` 以 `}` 收尾会匹配到**内层函数**（v569 二次踩）。判据：外层 return 后到 EOF **独立成行的 `}` 恰好 1 个**。必须跑 `composable-return-probe.cjs`（构建/md5/HTTP 200 全探不到）。
- 工具链：`rm -rf dist-vNNN` 与 emptyDir 会被 safe-delete 拦（>50 文件）⇒ 用 `--emptyOutDir false` 或 `mv`。**报失败先排除 safe-delete，再当代码问题。**

## 🔴 两条结构判据（v570 / v584｜原文 §MEM-ARCHIVE-v585）
- **scopeId 由文件内容派生**（v570）：改注释也会变 ⇒ 动过任何 SFC 就必须重构建重部署。判据：产物 `类名\[data-v-[0-9a-f]{8}\]` 与本次构建一致。
- **全屏层之外的元素全屏一律看不见**（v584）：`.grid-area.is-fs{position:fixed;inset:0}` 盖住整个视口且**无报错** ⇒ 要全屏可见必须放进 `.grid-area` 内部（优先 DOM 移动）。移动后补间距：`.grid-area{gap:10px}` 与自身 `margin-top` **叠加** ⇒ 用 `margin-top:4px` 抵回，全屏贴合用 `-10px`。探针预期值只能取实测。

## 🔴 表格密度 / 行高（v571-v581 四轮沉淀｜细节全文见 `topics/frontend-ui.md` §MEM-ARCHIVE-v585）
- **定式**：`.cross-tbl{--fc-cell:20px}` 唯一源（`td` line-height / `.pname` / `.cell-input` / `.cell-ro` 全取它），垂直 padding 归零 ⇒ 行高 21px；密度开关只改横向留白（cozy 8 / compact 6）。
- 🔴🔴 **改行高/密度前先查用户在哪一档**：`tenant_1.db:ui_col_prefs WHERE page='ui-density'`。v571/v575 压的都是 compact 而用户看 cozy ⇒ 两次自测"已达标"、用户两次说"还是太高"。
- 🔴 **行高主因通常不是 padding，是 `line-height` 继承 body 1.6**；另两个隐形撑高件：inline 图标后跟块级兄弟（自占一行）、`inline-flex` 按基线顶 2-6px。
- 🔴 **同分打死**：页面写 `xx-tbl td{padding}` 与全局 `[data-density=compact] table.tbl td` 同为 (0,2,2)，页面 CSS 懒加载后注入 ⇒ 恒页面值胜出（切紧凑无效）。修法：页面**显式声明紧凑档**=(0,3,2)；全局 `input{height:24px}` 同理会压死 `.cell-input[data-v]` ⇒ 页面须带 `.cross-tbl` 前缀。
- 🔴 **虚拟滚动常量与真实行高同步**：`ROW_H/GRP_H/DET_H/SUB_H` 是 spacer/窗口/`scrollToIndex` 唯一依据；CSS 改了常量没改 ⇒ 算 29 行实占 609px ⇒ 凭空 91px 空白。进出全屏要重测 `viewportH` 并归零 `scrollTop`。
- **合计栏不能并进表体**：`.col-total-bar` 必须在滚动容器**外**，只能视觉接合；表底浮层必须锚合计栏自身，`overflow:hidden` 下沉到内层视口。
- **域名**：cn-v2 前端 = **hergent.cn**；`erp.hergent.cn` 是另一套 admin（对 cn-v2 产物 404）。

## 🔴 数字的单位必须跟着口径走（v587｜目标类型分金额/数量两类）
- 返利目标 `target_type = amount | quantity`；quantity 时目标/达成/贡献/缺口/均单**全是件数**。模板写死 `¥` 就是把量读成额（「¥96,000 / 件」）。**改任何显示数字处都先问：这个数是什么单位。**
- 定式：`isQtyRow(s)` 单一判定 + `uVal(s,v)`（`¥1,234` / `1,234 件`）+ `uGap(s,v)`（金额型不加符号，保持原观感）。
- 🔴 **跨口径不能相加**：多条规则可能一条按元一条按件 ⇒ 汇总必须判 `amount|quantity|mixed`，mixed 时**不给金额**、写明"口径不一致、不合并汇总、逐项看明细"，否则会印出元+件的虚构数字。同类隐患：数量型规则的「优先加单」若按金额排序，缺进价品（金额恒 0）会被整条漏掉 ⇒ 排序键必须同口径。
- 🔴 **真实数据里不存在的分支怎么验**：生产构建已剥离 `__vueParentComponent`，改不了组件状态。正解 = `v587-unit-logic-test.mjs` 式：**从 SFC 源码原文正则抽取真实函数**配真实依赖执行 + 断言模板绑定（不是复制一份实现去测副本）。

## 🔴 拖动填充 / 拖动类交互（v593）
- 🔴 **「操作成功但看不见」先 `grep` 那个状态量读了几次**：`fillEnd` 只写不读 ⇒ 拖动全程零 DOM 变化。凡是「跟随鼠标」的交互，必须有**一个随状态变化的 DOM 物**（覆盖层/类名），否则等于没做。
- **覆盖层定位**：绝对定位在**滚动容器内容坐标**（需给容器 `position:relative`），坐标 = 首尾网格 `getBoundingClientRect` 相减 + `scrollLeft/Top`（含 `clientLeft/Top`）。**绝不能累加行高**：密度两档不同 + 表格有 `zoom` 必错位。被筛掉的行 `display:none` 宽高 0 ⇒ 保持上一帧框。
- 🔴 **覆盖层必须 `pointer-events:none`**：命中判定走 `elementFromPoint`，可命中就永远落在框上 ⇒ 目标不再更新，症状比原来更难查。
- 拖动期光标定式：`.容器.is-filling *{cursor:crosshair!important}`（否则拖出填充柄即变回文本光标，用户以为拖动已结束）。
- 收尾：拖一格未移动不弹提示；Esc 取消不写入；松手后把整段范围设为选区（结果自证）；提示要带**行号区间**（`已填充 46 格（第 1→46 行）`，行号 = 序号列显示值 = 下标+1）。
- 🔴 **线性填充（v596）：只沿主方向铺一行/一列**（用户否掉矩形语义）。`fillAxis` ref 是范围第二唯一源，`fillSpan` 非主轴恒等于源格。方向按**屏幕像素**判（行 31/列 90，按格数比会偏行），起点 10px 内不定向、越过即锁，**只有另一轴 >当前×2 且 >40px 才改向**（45° 逐格交替不锁会抖；L 形仍可改）。非数量列 `canH=false` 锁死纵向（`writeCellVal` 只拦 `ro`，单价会被写脏直入下单金额）。自滚**只滚当前轴**。范围退化成源格 ⇒ 不写不提示。⚠️ 独立「单价」td **没有 `.fill-handle`** ⇒ 拿它当源格会取到上一个选中格的柄，测的是别的东西。
- 🔴 **拖框选之后表格快捷键全灭**（v597 根因）：`onCellOver` 为结束"正在输入"主动 `blur()` 输入框 ⇒ `activeElement` 变 **BODY**，而快捷键全挂在 `<table @keydown>` ⇒ Ctrl+D/R/C、Delete、方向键**静默无效**（不报错、就是不动）。修法：`onCellUp` 在 `_dragMoved` 时 `focusGrid()`；**单击路径不能补**（会抢掉"单击改一位数字"的落点）。判据：快捷键失效先查 `document.activeElement` 在不在 table 里，别改业务逻辑。
- **Excel 化五项（v597）**：`Ctrl+R` 向右填充＝Excel 语义「用选区**最左列**填满其右侧」（🔴 必须 `preventDefault`，这键浏览器默认是**刷新**，漏了会刷掉未保存草稿）；双击填充柄＝填到「**已报数量的最后一行**」（不能按"下一行有商品名"——报单表每行都有名 ⇒ 一键铺满全表）；复制蚂蚁线＝4 层 `repeating-linear-gradient` + `background-position` 位移**恰好一个周期**（5 实 + 5 空 = 10px），只在剪贴板**写成功后**才亮、Esc 清框**不清选区**且要排在 `cellTyping` 分支之后；`cleanNumText` 只认「[币符?]数字[单位?]」（`66箱`→66、`¥1,200`→1200、`1.5` 不动、`12箱24瓶` 原样），**`toHalfNum` 一个字不许动**（与后端逐字同源；NFKC 已把 nbsp 折成普通空格 ⇒ 按 `\u00a0` 匹配是死分支）。
- 🔴 **边缘自动滚动必须与视口取交集**（v594/v595）：`vBottom = min(容器内容底, innerHeight)`、`vRight = min(容器右内界, innerWidth)`。表体 `72vh`，矮窗口下容器下沿跑到视口外（实测 1600×913：容器底 1052 > 913）⇒ 夹取出的 y 在视口外 ⇒ `elementFromPoint` 返回 **null** ⇒ 终点永不更新，症状是「滚是滚了、框不长」。rAF 每帧 4~20px，滚完必须**重新 hit-test 夹取后的坐标**（指针已拖出容器，mousemove 收不到）；松手/Esc 要 `cancelAnimationFrame`；**只有滚动真的发生（值变化）才 hit-test**，否则到底后每帧重复命中同一格会抖。
- 🔴 **横向填充必须夹进「数量区」，预览框与写入同源**（v595）：拖到右边是合计/加单/单价/金额，`writeCellVal` 对 `edit:'num'` **一律放行**（只拦 `edit:'ro'`）⇒ 横铺会把「客户 A 的 30 箱」写进单价与加单，直接进下单金额。定式 = 单一函数 `fillSpan(a,b)` 同时供 `updateFillBox`/`doFill`/提示用，源列不在数量区就 `c0=c1=源列`（只纵向）。**横向左界 = 冻结列（seq-th + th.frozen）右边界**，不夹会命中 sticky 的商品名列 ⇒ 框长进档案区、松手把一串商品名写成本行名字；`mousemove` 与 rAF 都要过 `safeX()`，只夹横向（纵向命中 null 应「保持上一帧」，别弹回第一行）。横向热区 18px < 纵向 26px（表格 3000+px 宽，纵向拖时指针常离右边缘很近）。

## 🔴 页脚胶囊 / 悬停浮层（v583+v585+v588）
- **数字只能有一个源**：父级做「摘要胶囊」必须让子组件 `emit('summary')` 回传，**父级不得重算**。挂点选页脚 `.pin`/`.edit-summary`（已在 `.grid-area` 内）⇒ **零全屏专属分支**。
- **软删行必须过滤**：`cross.rows` 含 `_deleted`，看板/合计须与 `liveRows` 同口径，否则改单删行后缺口纹丝不动。
- **悬停浮层：点击不做 toggle、`@blur` 别用来关**（hover 已开则点击=收起 ⇒「点一下就没了」；点浮层内元素触发 blur ⇒ 误关）。关闭只靠 移出延迟（220-260ms）/ 点别处 / Esc；触发器与浮层有 gap 时必须延迟 + 浮层自身 enter 取消计时。
- **浮层定位定式（v588）**：`Teleport + fixed + z-index 1250`（> `--z-page-fs` 1000），锚自身容器会被祖先 `overflow:hidden` 裁掉；**水平居中用 `left:50%+translateX(-50%)`，不要手算 left / 不要贴 `right:12px`**（1080 宽浮层在宽屏贴右，视觉重心明显偏右）；**垂直仍锚触发器**（向上/向下弹）—— 垂直居中会盖住表格主体、hover 链路跨半屏而断。`transform` 会创建 containing block ⇒ 浮层内不得有 `position:fixed/sticky` 子元素。有自定义浮层就**删掉触发器的 `title`**（原生黑框会同时弹）。
- 真机验证必须 `Input.dispatchMouseEvent` 真移鼠标 + `Input.insertText` 真键入；几何断言用 `getBoundingClientRect` 的 `dCenter/dMargin`（视口中心差、左右边距差），别用截图目测。

## 🔴 护栏与产物校验的坑
- 🔴 **`v-focus` 类自定义指令「没注册」= 全程静默无效**（v589）：模板 10 处 `v-focus`（`Forecast` 只读列表双击进编辑 / `InvPurchaseNew` / `PurchaseOrderForm` / `ProductCombo`），而全仓**从未 `app.directive('focus')`** ⇒ Vue 只 warn 一句，构建照过、页面照开，症状是"输入框不聚焦/光标停末尾、键入变追加"（原 10 键 7 = 107）。**新增/搬运模板时，凡自定义指令必须在 `main.js` 有对应注册**；关键交互不要只靠指令，`@focus` 内联处理器最可靠。用指令修复后必须**运行时量**（`selectionStart/End`、`document.activeElement`），产物里 grep `resolveDirective` 是假阴性（minify 改短 import 名）。
- 🔴 **「点击即全选」只能在 click/mouseup 挂载，不能在 mousedown**（v590）：mousedown 里挂 input，随后的 mouseup 会把 `select()` 折叠成光标 ⇒ 看着像"全选没生效"。另：已在编辑同一格时**禁止再给 `editingCell` 赋新对象**（会重渲染、input 重建、光标丢失、第二下点不住）。判据只看 `selectionStart/End` + `focusedInput` + `inputCount===1`，别信截图。**用户说"点击"就是单击**——v589 只做双击，被退回。
- `forecast-split-guard.py` 的 API 锚点统计**不剥注释** ⇒ 子组件头注释里只写方法名，别写 `xxxApi.method`。⚠️ 别改护栏去剥注释（基线是旧口径录的，改口径必须同时重录基线）。
- 产物验证正则必须带 `[data-v-xxx]`（`类名\[data-v[^{]*\{[^}]*\}`），裸类名只在非 scoped 块成立；**不能 grep 函数名**（minify 会改短 ⇒ 假阴性），要 grep 稳定的**类名字符串**再定位编译形态。

## 🔴 部署必检：入口依赖闭包（v583 整站白屏血案）
- **只传「改动的几个 chunk」不够**：新构建的文件名可能与线上那套**完全不同**（实测 190 个闭包文件里 99 个线上没有）⇒ 新 entry 引用的 `Login`/`Shell`/`Forecast` 全 404 ⇒ **整站白屏**，nginx 只给几条 404，极易误判成"没传完"。
- 定式：`python3 ../.workbuddy/tools/deploy-frontend-closure.py --push`（以 `dist/index.html` 为种子递归解析 → 逐文件 HEAD 校验、自动补传）。**每次部署后必跑，最后才传 `index.html`**。
- 判据「线上跑谁」= `index.html` 的 entry + **该 entry 接线的 chunk 内容**，不是 `ls assets/index-* | head -1`（会取到旧残留）。双侧 md5 五件套必对。
- 🔴 `rsync -R dist/./x` **不锚在 dist**，会铺到 `<目标>/dist/…`；用「源文件 → 目标全路径」逐条传。别用 `comm` 比清单（locale 序 ≠ ASCII 序 ⇒ 假缺失）。

## 🔴 Excel 化改单网格（v597-v598｜细节见 `2026-10-18.md`）
- **Vue 响应式 ↔ WeakMap 基线**：基线用**原始行对象**建、模板里的 `r` 是深层 **Proxy** ⇒ 两者是不同 key，必须 `toRaw()`；否则 `get()` 恒 undefined、判据恒 false、**零报错**（v598 角标一次没亮）。同族：任何「用对象引用当 key」的缓存（WeakMap/Map/Set）都有这个坑。
- **单值粘贴铺满选区**只在剪贴板 **1×1 且选区>1** 时成立；多行多列必须严格按左上角对齐（拉伸=粘贴后全乱）。写入复用 `batchWrite`，不另写循环。
- **双击列边界自适应**：表级 `dblclick` 委托 + `th.cellIndex` 映射（`colgroup` 与 `<th>` 同序=唯一权威，别逐处加参数）；`v-show` 隐藏行必须跳过否则宽度被压到 40；客户列表头是 `<input>`，要读 `value` 不是 `textContent`。
- **改过角标**判据是「当前值 ≠ 基线」而非"被点过"⇒ 改回原值自动消失；基线建在**草稿合并之前**（= 服务端已保存值）。
- **探针两坑**：CDP 在**视口外坐标**派发鼠标事件**静默无效**（判 `inView`）；`Tab` 跳格触发 `keepCellClear` 横向滚动后**旧坐标全部失效**⇒ 每次操作前重新取坐标。

## 页面真身速查（标题近似、极易改错文件的一对）
- 「预报订单管理 → 商品目标 → 新建商品目标」= `src/pages/ProductTarget.vue`（`/forecast?tab=target` 第 4 页签 ⇒ **无独立 chunk**，样式合进 `Forecast-*.css`、JS 合进 `Forecast-*.js`）。
- 「目标与返利政策 → 创建商品目标」= `src/components/rebate/TargetFormModal.vue`（+`ProductTargetForm.vue`）。两者标题只差一字，动手前按用户给的路径确认。

## UI 风格偏好（🔴 折叠/展开控件 v551-v557 六轮返工）
- **同行控件必须同构**（v599）：「另有 N 个在售商品未显示」曾是一枚 25.2px / 12px / 无边框 / `cursor:auto`
  的 `<span>`，夹在一排 32px / 13px / 1px 边框 / pointer 的控件（缩放·勾选框·品牌·复制报单）中间 ⇒
  用户一眼看出"矮一截、像被咬掉一块"。判据：**同一行的控件取 `getBoundingClientRect` 必须顶边差 0、高度差 0**。
  修法是复用同行基准（`.tb-toggle` 的 32px/13px/1px/radius 8），不要自创新尺寸。
- 🔴 **带图标+动词文案的徽标会被当成按钮**：凡是"看起来能点"的元素必须有 `role="button"` + `tabindex="0"` +
  `@click` + `@keydown.enter.space` + `cursor:pointer` + hover 反馈。否则就是"看着像按钮的死元素"。

- **拒绝任何容器形状**：圆形 / 圆角矩形 ghost 按钮均被否。定稿 =「干净青色裸箭头」：零 background/border/radius，永远同一个 `chevron-right`，展开时 `rotate(90deg)`（不换图标），`var(--t2)` + 静息 `opacity:.55` / hover 1，16px，`padding:6px` 扩热区。**先 grep 仓库既有同类控件**（`.exp-chev`/`.grp-toggle`/`.sb-caret`），自创形状必被否。
- **`<Icon>` 陷阱**：`Icon.vue` 是手写 `ICONS` 映射，**写错名字静默兜底成齿轮** ⇒ 用前必须确认名字存在。

## 进度 / 交付锚（详情 `topics/`）
P0 7/7；P1 6/6✅（分权 v517+v526｜审批流 v519+v525｜四报表 v506+v507｜对账 v527-v533｜批次追溯 v529-v531｜批量栏 v532）。报表区 33 入口仅 4 真身。P2-4 副驾经营指标 + P2-2a 预警外发已交付(v535)；剩余 促销ROI(端点坏死500)/货架位(零数据)/现金流预测页面化，成本口径待拍板。**卖前三关未过；调拨单生产仍 0 张**。BI 指标唯一源 `erp_db.py:_BI_MEASURES`（口径必须 `soi.amount`）；库存周转唯一源 `get_inventory_turnover`。

## 编号约定
已用到v599；下一号v600。🔴 **「改了但用户说没变」第一步先查前端构建号**（v591）：`window.__HG_BUILD__`（`main.js` 唯一定义处）+ `html[data-build]` + 「预报 → 修改日志」面板标题旁 `前端 vNNN`。SPA 老标签页**永不重拉 index.html**，部署了也看不到（index.html 已 `no-store`，问题在"不刷新"）。每次发版**手动改这一行**（无 CI 注入）。
- 🔴 **编辑态 = 格内即输入框（v592）**：`.cell-input` 去边框/圆角/白底，横向出血 `--cell-pad-h`（舒适 8 / 紧凑 6，**不许写死**，写死 8 在紧凑档外溢 2px）；焦点视觉靠 `.td.selected` 的 2px outline + 青底。表头客户名输入框**保留方框**。手工价/负数/错误态改 `box-shadow:inset` 承接。改单网格数据行 31px 是**既有事实**（旧样式对照同为 31、line-height 归零仍 31），别照行高链结论直接改。起号必读`version-history.md`+实搜两仓`git log --all`+`git worktree list`。v517被双占。并行分叉：先scoped提交→merge origin/main→合并HEAD重建→部署→验「双方标记都在」。改`pages.js`先分清单"路由"还是"门禁"(本项目=门禁唯一源，`ruleFor`未登记path一律放行⇒删占位登记=放宽门禁)v499。前端`roles`窄名单非真保险⇒敏感页必须后端`_admin`双保险(v531先例)。

## 主体 / 脱敏 / 技能 / 本机坑
主体 hergent-cn-v2(`laozhangai-product`)｜hergent-erp(FastAPI+SQLite)。脱敏红线：返利率/进货价/客户名/区域销量/厂家政策；PII 不落 `outputs/`。技能：`hergent-pre-launch-audit`｜`hergent-scoped-commit`｜`parallel-session-safety`｜`rebate-caliber-consistency`｜`chart-render-verify`｜`ui-copy-guard`｜`external-material-pdf`。本机坑→`topics/local-machine-pitfalls.md`（`grep "A\|B"` 静默失效⇒`-e`；`&&` 短路；`| head -N` 截命中；`grep -rl` 只搜顶层；探针别放 `/tmp`；ssh 嵌 python 引号错乱⇒远端脚本）。
