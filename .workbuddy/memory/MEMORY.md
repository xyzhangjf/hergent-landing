# Hergent 记忆索引（只放判据级摘要 + 锚点；详情 `topics/*.md`）

> 长段落已逐字迁入 `topics/frontend-ui.md`：`§MEM-ARCHIVE-v603/v605/v605b/v606/v607/v611`。
> 下面只留**判据 + 去哪查**。

## 路由（🔴=硬判据）—— 全表见 `topics/route-index.md`
> 14 个域已逐条迁到那份（前端/建单退单/后端/部署/预报主表/返利/货损/进销存/审批流/分权/副驾/对账/价格/跨域）。**动手前按域 grep**；下面只留例行必读。

- 前端→`topics/frontend-ui.md`：入口唯一源`pages.js`(未登记=失门禁)§v209｜`permView.js`唯一源、`module:null`=只读§v348｜文案三禁⇒`hergent-ui-copy-guard`§v331｜图表唯一源`src/components/chart/`｜列表页冻结/密度/合计`psi-list.css`｜侧栏系列(v515-517)只删菜单项、`pages.js`登记不动。
- 后端→`topics/backend-invariants.md`：路由遮蔽先注册者胜§v317｜静默失效=恒空恒0⇒`undefined-call-scan.py`｜门禁用接口模块非页面模块§v328｜FastAPI未声明query被静默忽略§v443｜意图路由按序首匹配v535｜execute_tool返回键`success`。
- 部署→`topics/deploy-ops.md`：后端FLAT`/opt/hergent-erp/`(线上`routers/`**无**`server/`前缀)｜前端`/opt/hergent-cn-v2`｜服务`hergent-erp.service`｜部署前必`git fetch`v509｜「线上跑谁」=entry+其接线chunk§v498｜rsync绝不`--delete`（🔴 后端 `deploy.sh` 里**内联了** `--delete`，实测试图删服务器独有的 `hermes-engine/`/`backups/`/`data/`，因非空才没删成 ⇒ 后端也只 rsync 改动文件、逐文件传）。
- 预报主表→`topics/forecast-order-domain.md`：报单单位永不落大单位｜「N人报」=账号数非门店数(门店数用`stores`)§v574｜小程序商品来源=`forecast_import_products`，入清单资格=`qty>0`∪`is_new`∪`add_to_list`，「勾品牌→保存」**不会**上架｜🔴 上架/撤下的主语必须是**选中的行**（v615 复选框+批量操作），不是「当前筛选结果」——按筛选整批会连带撤掉原本在清单里的同品牌商品｜撤下候选必须排除「有数量」行（否则下次保存被 `qty>0` 自动加回）｜补录行不得当新商品发`bulk-upsert`（无条件覆盖会清零档案）v612｜🔴 **筛选与「复制报单」必须同口径**（v616）：复制口径=当前看得见的行，取行只有 `copyRows()` 一份（编码/数量共用⇒逐行对齐）；行显隐只有 `rowFilterPass()` 一份（`rowVisible`/`rowBaseShown` 都调它）。到货周期=`products.arrival_lead_days`（非 `lead_time_days`/`arrival_cadence_days`）；本期 294 个里 238 个未设，含刚报单的 3 个 ⇒ 筛 +N 时必须显式报「另有 N 个未设已被排除」｜🔴 **批量改档案的主语是「勾选的行」，不是品牌**（v618 推翻 v617）：同品牌内部周期本就不同（蒙牛低温并存 +3×13 / +4×21）⇒ 按品牌设=强行拉平；入口=「批量操作」第三项（与上架/撤下同一套交互）｜范围**不按 `is_active` 过滤**（本期清单里有 3 个停用但仍在报单，过滤⇒勾了却没变、零报错）｜覆盖已有值必须报「其中 X 个原本已有别的周期」｜批量操作按钮**常驻**（未勾选也能打开，面板里教"先勾序号列"；说明文案只在有勾选时出，别过早解释）。

## 🔴 四条结构判据
- **scopeId 由文件内容派生**（v570）：改注释也变 ⇒ 动过任何 SFC 就必须重构建重部署。
- **全屏层之外的元素全屏一律看不见**（v584）：`.grid-area.is-fs{position:fixed;inset:0}` 盖满视口且无报错 ⇒ 必须放进 `.grid-area` 内部；间距 `4px` 抵回 gap、贴合 `-10px`。
- **挂点优先选本来就存在的行**（v603）：页脚 `.pin`/`.edit-summary` 已在 grid-area 内 ⇒ 零新增行；`.grid-ctl-row` 已近满宽，**常驻**按钮必折行（条件性可接受）。
- **任何 Modal 必须用 `--z-page-modal-overlay/-modal`（1125/1130），不能写 1000/1001**（v617 复发 v136）：工具栏 `.tb-pop` 常态 z-index=**1120**（为"弹层开着能直接点别的触发按钮"特意抬高），Teleport 到 body 后直接根层比较 ⇒ 1120>1001，**触发按钮浮在弹窗上、盖掉正文**。`components/Modal.vue` 曾写死 1000/1001（v617 已改回 token）。
- 🔴 **打开即输入的弹窗：给元素标 `data-autofocus`，别在调用方 `nextTick().focus()`**（v618）：Modal 的 watch 也在 nextTick 之后无条件 focus 第一个可聚焦元素（=关闭按钮）⇒ 两边赛跑、实测被覆盖（探针 C2 假失败）。组件已支持 `data-autofocus` 优先。

## 前端实现细则 —— 全文见 `topics/frontend-ui.md`
> **组件抽离五条必检 / 表格密度与行高 / 拖动填充与框选 / 页脚胶囊与浮层 / Excel 化网格**
> 已逐字迁到 `§MEM-ARCHIVE-v614`（同日迁入，含 v557-v614 全部原文）。改前端前先 grep 那一节。
- 🔴 `rm -rf dist-vNNN`/emptyDir 被 safe-delete 拦（>50 文件）⇒ `--emptyOutDir false` 或 `mv`。**报失败先排除 safe-delete。**
- 🔴 行高真凶通常是**子元素 display** 不是 padding（v606）；改前先查用户在哪一档（`ui_col_prefs`）。
- 🔴 拖动/框选：`onCellOver` 主动 `blur()` ⇒ 表格 `@keydown` 快捷键静默失效，先查 `document.activeElement`。
- 🔴 `margin-left:auto` 的推手不能挂在带 `v-if` 的组件上（v604）⇒ 靠右组必须包**常显容器**。
- 🔴 **多根组件（Fragment）会静默丢掉父级传的 `class`**（v620）：SprintChip = `.sprint-chip` + `<Teleport>`
  ⇒ `class="pin-sprint"` 从未出现在 DOM，`.pin>.pin-sprint{margin-left:auto}` 是空选择器、5 版零报错。
  修法：子组件 `defineOptions({inheritAttrs:false})` + 根节点 `v-bind="$attrs"`；父级 `:deep()`。
  **判据：写「按 class 选子组件根」的 CSS 前，先真机读一次 `el.className`，别 grep 模板就断定类存在。**
- 🔴 浮层定式：`Teleport + fixed + z-index 1250`；有自定义浮层就删触发器 `title`。
- 🔴 **异步补内容判「归属变没变」，比 `messages` 数组引用，不比 `currentId`**（v626）：新对话首次提问时 `currentId` 还是 `''`，`saveCurrentSession()` 在卡/回复飞回来时才写 id ⇒ 比 id 会把**第一张卡静默丢掉**（生产实测 3 问只落 2 张）。store 里切会话/新建对话都是 `chat.messages = …` 换引用，首次提问不换 ⇒ 引用一个判据同时满足「首问保留」「切走丢弃」。
- 🔴 **副驾探针第一个动作必须 `freshChat()`**（`tools/lib/cp-fresh.mjs`，走 UI「＋ 新对话」）：demo 账号打开副驾会**自动恢复上次那段对话**，前几轮探针自己造的卡全在里面 ⇒ 基线污染、v625 三探针复跑全假红。
- 🔴 **产物区只折叠「系统自动补的数」，不折叠 AI 的结论**（v626）：自动经营卡同类留最新一张（产物区语义=现在有什么可用，历次在对话流里）；AI 主回复自出的 ```card / 副驾产出文件每次结论可能不同，折叠等于藏结论。
- 🔴 **异步补出来的东西必须「发起时快照归属」，回来归属变了就丢弃；系统自动产出的内容不许署角色名**（v625）：
  副驾兜底经营卡（`useCardTrigger`）两处叠加 ⇒ 用户报「我没问，大秘主动出来答」。① 卡消息写入不带 `roleMeta`，
  模板署名 `m.roleMeta?.name || currentRole.name` 回落到**当前角色** ⇒ 在「会计」下问工资、切到「大秘」，那张卡就改署「大秘」；
  ② 卡是 `triggerCards` 不 await 补的，请求在路上时切角色/切会话，回来无脑 `messages.push` ⇒ 落进切换后的上下文。
  **判据：任何「用户没直接触发、异步写进对话流」的内容（卡/提醒/推送），写入前必须比对发起时的 `{sessionId, roleId}`。**
  另：这类纯数值聚合卡（无口径披露）一律中性署名「📊 经营数据」，**别用「无 roleMeta 就算自动卡」**——会把 v319 之前的
  AI 主回复一起误判；正确判据是「显式 `cardAuto` ∪ 正文逐字等于 4 句固定开场白（`AUTO_CARD_LEADS` 单一源）」。
- 🔴 **`v-html` 注入的 DOM 拿不到 scoped 的 `data-v-xxx` ⇒ `<style scoped>` 里写 `.md p{...}` 是死代码**（v624，
  副驾 40+ 条 Markdown 排版规则自上线起**一条都没生效**，编译结果是 `.md p[data-v-xxx]`）：
  只剩 UA 默认 + 全局 `*{margin:0;padding:0}` ⇒ `<ol>` 的 padding 被清零、序号「1./2./3.」挂到盒子左侧
  钻进气泡内边距（用户报的「数字序号从容器溢出」）；表格没边框、代码块没标题栏、标题回到 UA 的 2em。
  修法：`.md :deep(p)`（本仓 v487 就已有这个写法，只是其余没跟上）。**判据：样式改了没效果，先量 computed，
  `margin/padding` 全是 0 就是规则没匹配上；grep 源码里有这条规则 ≠ 浏览器用上了。**
- 🔴 **`v-if` 挂载的抽屉/面板，DOM 销毁会连 `scrollTop` 一起带走**（v622 副驾）：重开时浏览器给 0
  ⇒ 用户看到的是**这段对话的第一条**，刚落的那条回复在 3000px 外（用户原话「显示的是历史信息的第一条」）。
  **判据：任何 `v-if` 的滚动容器，打开后必须主动还原位置**，不能指望"消息 watch 会滚"——`messages.length` 没变就不触发。
  定式：绑 `@scroll.passive` 记 `{top, atBottom}`（贴底阈值 40px），重开时「贴底→回底（关闭期间新到的回复也看得见）、中段→还原 top」；
  `nextTick` 只保证元素在、不保证内容撑开 ⇒ 再补 `requestAnimationFrame` + 180ms（仅贴底，且这期间用户自己上翻就取消）。
  守卫：`el.isConnected && copilotOpen` 才记录，否则卸载/动画期的 scroll 会把记录冲成 0。
- 🔴 **flex 行里「可能超长的文本」必须写 `min-width:0`，否则不可压缩、直接冲出容器**（v623 副驾工具行）：
  `.cp-tool-name` 没写 min-width ⇒ 默认 `min-width:auto`（＝内容最小宽度）；对**无空格长串**
  （MCP 工具名 `mcp__hermes_spreadsheet__...`、长文件路径、URL、长 ID）最小宽度就是整串宽 ⇒ 压不动、overflow。
  实测 1440 下 120 字符串：行 `scrollWidth 1052 / clientWidth 857` **溢出 195px**，文字压过卡片边界贴到抽屉边、
  **整页被撑出横向滚动条**；而外层 `overflow` 又会把这部分裁掉（用户看到的是"字被切了/冲出去了"）。
  定式：文本项 `flex:1 1 auto; min-width:0; overflow-wrap:anywhere; word-break:break-word`；
  容器链（`.msg-tools` / `.cp-tools-body`）一路 `min-width:0`。
  **判据：量每行 `scrollWidth-clientWidth` 与滚动容器的横向滚动量，不要肉眼看**（1440 用中文 label 测完全正常，只有无空格串才炸）。
  折行后 `align-items` 要从 center 改 **flex-start**（图标/状态标签贴首行）。
- 🔴 **改工具栏控件宽度只能实测「是否折行」，不能读注释里的余量数字**（v619）：注释里的容量表是历史快照，工具栏后来加过按钮就失效。判据 = `.card.toolbar` 高（单行 62 / 编辑态正常两行 100 / 多折一行 138）。**必须分开量查看态与编辑态** —— 编辑态第一行多一个「工具箱」按钮(89px)，同一宽度查看态单行、编辑态折行（1366 实测：胶囊 192 → 编辑态 138，150 → 100）。定式：`.toolbar.tb-dense .sel-period` 单独收窄。｜原生 select 想显示全内容别猜箭头宽度 ⇒ `width:auto` 让浏览器按最长 option 算，实测宽 202 时文字 136.8 刚好。

## 🔴 行筛选 / 只读 / 批量写（v607-v614｜全文 `§MEM-ARCHIVE-v611`）
- 🔴 行显隐**两份实现**：查看态 `rowVisible(r)`、编辑态 `rowBaseShown(ri)`。**新增筛选必须两处同改**。定式：共用 `brandSelSet`（computed Set）。
- 🔴 **同一状态已由触发控件显示就别复述**（品牌按钮自带角标⇒再出 chip 是噪音 v608）；无角标的筛选必须留 chip。删控件要 grep 它的中文引导词。
- 🔴 **判「能否编辑」不看有没有 input，看有没有保存路径**（v610/v611 查看态只读）：无保存按钮/无 PUT ⇒ 改动只脏内存却污染合计与「复制报单→下单数量」。
- 🔴 **「撤下」与「删行」是两件事**（v614）：删行=从 payload 剔除 ⇒ 整期重建把该行**数量一起清**；撤下=行留在 payload + `list_del` 旗标 ⇒ 只退清单（小程序搜不到），数量/加单/手工单价不动。后端 `rem = ①不在 keep ②在 keep 但 list_del`。
- 🔴 **撤下候选必须排除「行内有数量」的行**：后端 eligible 含 `qty>0` ⇒ 撤下后下次保存**自动加回**（"自己回来了"、零报错）。qty 恒 0 才撤得干净。
- 🔴 **任何筛选/批量按钮先问「没有筛选时它意味着什么」**（v613/v614）：清空筛选后候选=全表差额 ⇒ 必须有筛选闸门（`hasActiveRowFilter`）+ 数量≥20 二次提示。
- 🔴 死 import 的隐形性（v607）：被形参遮蔽 ⇒ Rollup 只 warning、线上正常，**dev 整页加载失败** ⇒ `router.push()` 取真实错误。
- 🔴 **算「这一行放不放得下」必须把 margin/gap 全算进去，只加 `getBoundingClientRect().width` 会算漏**（v621g）：1366 实测 need 与 1440 **完全相同（1022）**，但可用少 74px，叠加 `.tb-sep` 的**外边距不计入元素宽度**（1px 宽+ 上下 margin + 2 个 gap ≈ 22px）才刚好溢出 3px。**判据 = 量容器 `height`（单行 62 / 两行 100），不是比宽度。**
- 🔴 **响应式断点必须逐档实测，注释里的数字一律作废**（v621g）：审批人姓名降级那条挂进 `@media(max-width:1459)` 会**漏掉 1512**（它 > 1459 不吃那档）⇒ 实测仍 102；必须独立开 `@media(max-width:1539)`。收紧档 1359→**1369** 才覆盖 1366。**每加一档就重跑五档量测。**
- 🔴 **工具栏最宽的常常不是按钮，是状态/信息类文本**（v621g）：`.confirm-badge`「已确认 · 微信审核-主管」整条 **164.8px**，姓名部分 88.8px，比任何按钮都宽。收窄优先级：**状态常显 + 姓名降级 title**（不是砍按钮、不是砍状态）。

## 🔴 数字的单位必须跟着口径走（v587）
- 返利目标 `target_type = amount|quantity`；quantity 时目标/达成/贡献/缺口/均单**全是件数**。模板写死 `¥` 就是把量读成额。**改任何显示数字处先问：这个数是什么单位。** 定式：`isQtyRow`/`uVal`/`uGap`。
- 🔴 跨口径不能相加：汇总判 `amount|quantity|mixed`，mixed 时**不给金额**、写明"口径不一致、不合并"。数量型规则的排序键必须同口径，否则缺进价品（金额恒 0）被整条漏掉。
- 🔴 真实数据里不存在的分支怎么验：生产构建已剥离 `__vueParentComponent` ⇒ 从 SFC 源码正则抽真实函数执行 + 断言模板绑定（`v587-unit-logic-test.mjs` 式）。


## 🔴 护栏与产物校验的坑
- 🔴 `v-focus` 类自定义指令没注册=全程静默无效（v589）：必须在 `main.js` 有注册；修完**运行时量**（`selectionStart/End`、`activeElement`），产物 grep `resolveDirective` 是假阴性。
- 🔴「点击即全选」只能挂 click/mouseup，不能 mousedown（v590）；已在编辑同一格时禁止再赋 `editingCell`。**用户说"点击"就是单击。**
- 🔴 `Icon.vue` 是手写 `ICONS` 映射，**写错名字静默兜底成齿轮** ⇒ 用前确认名字存在（v453/v601/v603；v614 补 `minus`）。
- 🔴 **档案名 ≠ 报单快照名**（v614）：报单 `product_name`（「红桶（福宝下单）」）与 `products.name`（「蒙牛红枣酸牛奶1000g*10桶」）可能完全不同字 ⇒ 按名字搜索/匹配的验证必须取**网格 `input.value`**，别拿 SQL/快照名当搜索词。
- 🔴 探针时序三坑（v614）：`fill-search` 的 limit **硬 cap 200** ⇒ 要 offset 分页拉全；toast 3-4s 自灭 ⇒ 轮询「一出现就收」；**保存成功自动退出编辑态**（v208）⇒ 后续断言必须重进改单 + 轮询等网格重建（固定 sleep ⇒ 空 tbody ⇒ `vis=0` 假阴性）。
- `forecast-split-guard.py` 的 API 锚点统计**不剥注释** ⇒ 子组件头注释只写方法名。
- 产物验证正则必须带 `[data-v-xxx]`；**不能 grep 函数名**（minify 改短⇒假阴性），要 grep 稳定类名字符串。

## 🔴 部署必检：入口依赖闭包（v583 整站白屏）
- 只传「改动的几个 chunk」不够：新构建文件名可能与线上完全不同（实测 190 个闭包里 99 个线上没有）⇒ 新 entry 引用的 chunk 全 404 ⇒ **整站白屏**。
- 定式：`python3 ../.workbuddy/tools/deploy-frontend-closure.py --push`（以 `dist/index.html` 为种子递归解析→HEAD 校验→自动补传）。**最后才传 `index.html`**，再双侧 md5。macOS rsync 2.6.9 **不支持 `--chown`** ⇒ 传完单独 chown。
- 🔴 `rsync -R dist/./x` 不锚在 dist，会铺到 `<目标>/dist/…`；别用 `comm` 比清单（locale 序≠ASCII 序）。
- 样式常落在**懒加载 chunk 的 css**（`Forecast-*.css`），不在 `index-*.css` —— 查样式别只 grep 后者。

## 页面真身速查（标题近似、极易改错文件）
- 「预报订单管理 → 商品目标 → 新建商品目标」= `src/pages/ProductTarget.vue`（`/forecast?tab=target` 第 4 页签 ⇒ 无独立 chunk，样式合进 `Forecast-*.css`）。
- 「目标与返利政策 → 创建商品目标」= `src/components/rebate/TargetFormModal.vue`（+`ProductTargetForm.vue`）。

## UI 风格偏好（全文 `§MEM-ARCHIVE-v606`）
- 🔴 **同行控件必须同构**（v599）：基准 `.tb-toggle`/`.btn-sm`（32 高/13 字/1px 边/radius 8/`padding:0 12px`）；判据=顶边差 0、高度差 0。危险程度靠角标配色（`.btn-badge.err`）表达，不改按钮外形。
- 🔴 **看起来能点的必须真能点**：`role=button`+`tabindex=0`+`@click`+`@keydown.enter/space`+`cursor:pointer`+hover。**图标尺寸只由 CSS 定**（全局 `.ico{16px}` 胜 `<svg width>`），量法只认 `getBoundingClientRect`。
- 🔴 拒绝容器形状（圆形/圆角 ghost 全被否）：定稿=裸青色 `chevron-right`（零 bg/border/radius，展开转 90°，静息 `.55`）。**自创形状必被否，先 grep 既有同类控件**。

## 进度 / 交付锚
P0 7/7；P1 6/6✅（分权 v517+v526｜审批流 v519+v525｜四报表 v506+v507｜对账 v527-v533｜批次追溯 v529-v531｜批量栏 v532）。报表区 33 入口仅 4 真身。P2-4 副驾经营指标 + P2-2a 预警外发已交付(v535)；剩余促销ROI(端点坏死500)/货架位(零数据)/现金流预测页面化。**卖前三关未过；调拨单生产仍 0 张**。BI 指标唯一源 `erp_db.py:_BI_MEASURES`（口径必须 `soi.amount`）；库存周转唯一源 `get_inventory_turnover`。

## 编号约定
已用到 v626；下一号 v627。🔴 **「改了但用户说没变」第一步查前端构建号**：`window.__HG_BUILD__`（`main.js` 唯一定义处）+ `html[data-build]`。SPA 老标签页**永不重拉 index.html** ⇒ 部署了也看不到；每次发版**手动改这一行**。
- 起号必读 `version-history.md` + 实搜两仓 `git log --all` + `git worktree list`。并行分叉：scoped 提交→merge origin/main→合并 HEAD 重建→部署→验「双方标记都在」。改 `pages.js` 先分清单"路由"还是"门禁"（本项目=门禁唯一源，`ruleFor` 未登记 path 一律放行⇒删占位登记=放宽门禁）v499。前端 `roles` 窄名单非真保险⇒敏感页必须后端 `_admin` 双保险(v531)。

## 主体 / 脱敏 / 技能 / 本机坑
主体 hergent-cn-v2(`laozhangai-product`)｜hergent-erp(FastAPI+SQLite)。脱敏红线：返利率/进货价/客户名/区域销量/厂家政策；PII 不落 `outputs/`。技能：`hergent-pre-launch-audit`｜`hergent-scoped-commit`｜`parallel-session-safety`｜`rebate-caliber-consistency`｜`chart-render-verify`｜`ui-copy-guard`｜`external-material-pdf`。本机坑→`topics/local-machine-pitfalls.md`（`grep "A\|B"` 静默失效⇒`-e`；`&&` 短路；`| head -N` 截命中；`grep -rl` 只搜顶层；探针别放 `/tmp`；ssh 嵌 python 引号错乱⇒远端脚本）。
