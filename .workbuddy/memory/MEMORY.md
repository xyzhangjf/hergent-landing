# Hergent 记忆索引（只放判据首句 + 去哪查；细节一律在 `topics/*.md`）

> 编号已用到 **v705**，下一号 v706。域索引 → `topics/route-index.md`。**动手前按域 grep**。
> ✅ **两条并行源码线已合并为一条（v705 / `02a1b28`）**：现在只有 `main` 一个源，`main` 包含两条线全部历史。
> 留档：A 线（线上 v633-v678）= 分支 `line-a/v678`；B 线（v678-v731）= `workbuddy/main-75f152be`。**都不再在上面继续开发**。
> ⇒ 「修过的 bug 又回来了」仍先 `git merge-base --is-ancestor <修复commit> HEAD`；现在只要是合并前的提交，一律是祖先（除非来自更老的 `build/v*` 分支）。
> 🔴 **合并那轮的三条教训（下次再合并/解冲突必读）**：① `git merge` 会留下**冲突块之外**的假象 —— 重复 `export const xxx`（构建直接报 `Identifier has already been declared`）、重复对象键（静默取后者）、一侧删了另一侧还在的整段模板（脚本被覆盖 ⇒ 模板引用未定义，**构建不报错**，只有 `npm test` 的 SFC 符号检查抓得到）；② 所以合并后**必须**跑 `cd hergent-cn-v2 && npm test`（21 组契约，含 207 个 .vue 的符号扫描）+ `npm run build`，缺一不可；③ 同一功能两线各写一份客户端 API 时，按**消费方**取舍（谁在用留谁），别两版都留。
> ⇒ 合并的取值原则与逐块判据见 `2026-10-31.md` 的「v705 合并」段（含每处取 A/取 B 的一行理由）。
> 本条线 `variables.css` 自 **v491** 起结构没再变过（只加过 z 令牌；`git diff 849588d -- src/styles/variables.css` 现在有差异 = v678/v704/v705 的层级修复）。
> 🔴 「改了但用户说没变」第一步查构建号：`window.__HG_BUILD__`（`main.js` 唯一定义）+ `html[data-build]`。SPA 老标签页不重拉 index.html ⇒ 每版手动改这一行。
> 🔴 判产物不以「dist 存在」为准：先 `grep -o "v67x" dist/assets/index-*.js`。`mv dist-vNNN dist` 会嵌套成 `dist/dist-vNNN`，`ls -d dist* | tail` 正好截掉它 ⇒ 闭包全 200 也能骗过（v637）。

## 路由（🔴=硬判据）
- 前端→`topics/frontend-ui.md`：入口与门禁唯一源 `pages.js`（未登记=放行，删登记=放宽门禁）｜`permView.js` 唯一源、`module:null`=只读｜文案三禁⇒`hergent-ui-copy-guard`｜图表唯一源 `src/components/chart/`｜列表页冻结/密度/合计 `psi-list.css`｜侧栏系列只删菜单项。🔴 副驾快捷键 `⌘K`/`⌘⇧K` 已占用 ⇒ 新的用 `⌘⇧O`；外部触发「新建会话」必须用可消费计数器 `ui.copilotNewTick` + `takeNewTick()` 与 watcher 里 `restoreLatestSession()` 抢首分支（v649）。
- 后端→`topics/backend-invariants.md`：路由遮蔽先注册者胜｜静默失效=恒空恒0⇒`undefined-call-scan.py`｜门禁用接口模块非页面模块｜FastAPI 未声明 query 被静默忽略｜意图路由按序首匹配｜`execute_tool` 返回键是 `success`。
- 部署→`topics/deploy-ops.md`：后端 FLAT `/opt/hergent-erp/`（无 `server/` 前缀）｜前端 `/opt/hergent-cn-v2`｜服务 `hergent-erp.service`｜部署前 `git fetch` v509｜**rsync 绝不 `--delete`**（后端 `deploy.sh` 内联了它）｜🔴 `https://hergent.cn/` = ERP 前端，`/admin/` = 平台运营控制台（另一应用）⇒ 探针/部署一律用根路径（`/admin/assets/x.js` 永远 200 但返回 index.html，v636）。
- 预报主表→`topics/forecast-order-domain.md`（细节全在那边，只留最常踩的 5 条）：
  - 🔴 「我怎么只看到 N 个品」先查品牌筛选残留（`brandSel` 持久化于 `hergent.forecast.brandSel`，`cycleSel` 刻意不持久化）；汇总条必须写**筛选来源**+「清除」（v672 `rowFilterShort`/`clearEveryRowFilter`）。
  - 🔴 **新增一种行筛选条件要改三处**：`rowFilterPass` + `cfOn`（汇总条分支）+ `anyRowFilterOn`（空态）；漏 `cfOn` = 行少了但汇总条还挂「187 个商品」（v673）。
  - 🔴 下单日 = `products.order_days`（v673），与到货周期正交（cadence vs lag）：`d`/`w:1,3,5`/`p:odd|even`/`m:3,7,11`，空串=每天；判定唯一实现 `src/utils/orderDays.js`，后端只做结构校验。
  - 🔴 行序唯一权威 = `forecast_import_products.sort_no`；改顺序只改它，不动清单成员｜「只保留模板里的 N 个品」= 改该表（先确认 `forecast_submission_items.quantity` 全 0）｜品名识别看**报单快照名** `import_name`（档案名≠快照名 91/187）；按编码匹配时**同码多档案优先选「本期已在用的 pid」**（v670）｜模板一品占 2 行而档案 1 条 ⇒ 根因 `ordering_entity`，必须建两条同码档案（v671）。
  - 🔴 品牌已归一 `新希望(南山)`→`新希望`（v673；**库里存半角括号**；纯改数据不发版）。差额必须逐项可解释（187=175+9 缺档+3 户头变体）。
- 成本→`topics/cost-and-capacity.md`（v641 实测 + v642 落地 + v645 容量）。

## 🔴 副驾 / 租户 / 内存（全文 → `topics/copilot-tenant-memory.md`；成本 → `topics/cost-and-capacity.md`）
- 🔴 租户边界 = 进程用哪个系统账号（v635）：`gateway_api(tid)` 读该租户 `config.yaml` 的 `platforms.api_server.extra`（端口 `18800+tid`）；解析不到 ⇒ **必须 503，绝不回落根实例**。
- 🔴 平台租户 1 = 根实例别名（v642）：凭证/state 走 `_host_home`、PID 走 `_systemd_main_pid`；`_identity_kwargs` 必须 `return []`（v646）。
- 🔴🔴 同一企微 bot 只能一个 websocket 订阅：双连报 `846609` ⇒ 不回消息 + 100% CPU 重连死循环；卡住要 `kill -9` 连 `sudo -u` 包装一起杀。进程外推送必踢长连接（v648，2.2s 自愈）；`hermes send` **必须 `stdin=DEVNULL`**（v647）。
- 🔴 `/root/.hermes/gateway_state.json` 会被临时 `hermes send` 写脏（v666）：判通道还要看 pid 是否 `hermes gateway run`（`logs/` 那份别读）。
- 🔴 判后端内存看 `ps -o rss -p $(systemctl show -p MainPID --value hergent-erp)`，不看 `memory.current`；顶穿 `MemoryHigh` = D 状态锁死 ⇒ 排「卡住」先看 wchan。成本 = 入口数 × 常驻进程 ⇒ 接客户就新开一台；闲置租户停不掉；镜像开客户必须先脱敏。
- 🔴 气泡时间只认 `m.created_at`；「打开副驾显示最后一次」= `latestSessionOfRole() || latestSessionOverall()`（v637）；副驾读表 = `spreadsheet_query._run_query`（v638）｜改完 `hermes_tenants.py` 必须重启后端再做「杀掉观察 60s」。

## 🔴 结构判据（全文 → `topics/frontend-ui.md` 末节）
- 🔴 **给表格加一列 = 先吃掉「名称列」宽度**（v674）⇒ 长文本列必须 `min-width` 保底，不够就让整表横滚。**新列只写 `width` 无效**，要 `width+min-width` 同写。
- 🔴 **分页条必须在滚动容器外面**（v675）；移出后滚动区 `max-height` 减掉分页高度，且**翻页/改条数/换筛选后 `scrollTop=0`**。
- 🔴 `ui_col_prefs` 是租户级不是 per-user ⇒ 探针切列显隐会改掉全租户视野，测完必须查库确认最终值。
- 🔴 `GET /api/products` 是 `SELECT *` ⇒ 新字段自动下发；`PUT /api/products/{id}` 白名单**故意不收** `order_days` ⇒ 编辑弹窗别放该输入框。`.pa-ft-note` 全局是警告橙 ⇒ 正常态要自带 class 压灰。
- 🔴 给商品加字段要改 4 处（v670）：`_safe_migrate` 加列＋`GRID_COLUMNS`＋`products_grid` 输出＋summary 的 `imported_products` SQL；前端另需 `asProdRow`＋`loadEditGrid`/`loadCross`。缺一处 = 某态恒空。新增列还要 `applySaved` 补列 + `after:'<锚点>'` 定首次落位。
- 🔴 探针数行数别数 `tbody tr`（虚拟滚动只渲染首屏）、也别读 `body.innerText`（headless 可能空串）⇒ 直接查接口。
- scopeId 由文件内容派生（动过 SFC 必重构建）｜全屏层外的元素全屏看不见｜Modal 一律 `--z-page-modal-overlay/-modal`（1125/1130）｜与视口相关的尺寸不许写死 vh｜判「折行」只认行高｜打开即输入用 `data-autofocus`。

## 前端实现细则（全文 `topics/frontend-ui.md`，改前端前先 grep）
- 🔴 构建：`--emptyOutDir false`（`rm -rf` 被 safe-delete 拦）；**报失败先排除 safe-delete**；行高真凶常是**子元素 display** 不是 padding。浮层定式 `Teleport + fixed` + **层级一律取 `--z-page-*` 令牌**（页面里不许拍数）。
- 🔴🔴 **弹层本体必须高于自己的触发器**（v678 第三次复发，v704 修过）：`.tb-pop` 1101 < `.tb-pop-panel` 1116。反过来 ⇒ 按钮浮在面板上成「遮挡带」并**静默劫走点击**（点面板中部实际触发的是那个按钮），界面看着只是"多了条带边框"。优先**降按钮**（1101 已够"高过遮罩 1100"）。护栏 `tests/zorder-trigger-below-panel.guard.mjs`。
- 🔴 抬高浮层 = 把风险从"被盖"转成"盖住自己触发器"：凡 `position + 估算高度` 的定位，必须同时改「实测宽高 + 选空间大的一侧 + max-height 钳制」（v678 `positionTbPop`）。
- 🔴 样式不生效先排除三条：多根组件丢父级 class（`inheritAttrs:false`+`v-bind="$attrs"`）、`v-html` 拿不到 scoped（挂 `:deep()`）、`v-if` 面板连 `scrollTop` 一起销毁。flex 超长文本要 `min-width:0`、可折行工具行要 `flex:0 0 auto`。
- 🔴 前端判权限一律 `canDo(模块,动作)`；临时高亮用 data 属性不用 class；跳转定位要等 `currentId` 切到目标且 `el.isConnected`。响应式断点**逐档实测**（注释里的余量数字一律作废；查看态/编辑态分开量）。
- 🔴 `visibleCols` 元素**没有 `type` 字段**（v668）：按 `col.type` 分支的取值必须走 `colOrderList` 或自己补 `type`，否则静默 `return ''`（筛选清单只剩「（空白）」1/1）。计算列只在 `colOrderList`。
- 🔴 副驾三条（v625/v627）：异步补内容必须「发起时快照归属」；协议里的沉默也是表态；卡不是人说的话就别用气泡包它。

## 🔴 行筛选 / 只读 / 批量写（v607-v614）
- 🔴 行显隐**两份实现**（`rowVisible(r)` 查看态 / `rowBaseShown(ri)` 编辑态，共用 `brandSelSet`）⇒ 新增筛选必须两处同改；判「能否编辑」看有没有保存路径，不看有没有 input。
- 🔴 「撤下」≠「删行」（留行+`list_del` 旗标，候选排除 `qty>0`）；任何筛选/批量按钮先问「没有筛选时它意味着什么」（清空后候选=全表差额 ⇒ 必须有筛选闸门）。

## 🔴 数字的单位必须跟着口径走（v587）
- 返利 `target_type = amount|quantity`；quantity 时目标/达成/贡献/缺口/均单**全是件数**。改任何显示数字前先问单位；定式 `isQtyRow`/`uVal`/`uGap`。跨口径不能相加：mixed 时不给金额、写明「口径不一致、不合并」。
- 🔴 真实数据里不存在的分支怎么验：生产构建剥离了 `__vueParentComponent` ⇒ 从 SFC 源码正则抽真实函数执行 + 断言模板绑定。## 🔴 部署必检：入口依赖闭包（v583 整站白屏）+ 护栏纪律
- 定式 `python3 ../.workbuddy/tools/deploy-frontend-closure.py --push`（以 `dist/index.html` 为种子递归补传，**最后才传 `index.html`**）+ 双侧 md5。macOS rsync 不支持 `--chown`；`rsync -R dist/./x` 不锚在 dist；别用 `comm` 比清单。🔴 脚本常报「线上 92/203、补传 111」却末态全 200 ⇒ 计数可疑，**判产物以 curl 内容为准**。样式常落在**懒加载 chunk 的 css**（`Forecast-*.css`）。
- 🔴 `Icon.vue` 是手写 `ICONS` 映射，写错名字**静默兜底成齿轮** ⇒ 用前确认名字存在。
- 🔴 档案名 ≠ 报单快照名：按名字搜索/匹配的验证必须取**网格 `input.value`**（改单网格名称在 `input.cell-name` 的 `title` 里）。
- 🔴 护栏要防空转：扫到 0 个目标就 exit 1，别打印「全 PASS」（类名一改就永远绿）。探针时序/指令/产物正则的坑见 `topics/frontend-ui.md` 末节。

## 🔴 备份巡检 / 告警通道（v666）
- `scripts/check_backup_alive.py` 有 `--test`/`--dry-run`；**别删**。通道按序 `.env` 的 `WECOM_/FEISHU_WEBHOOK_URL` → 都没有走 `hermes send` ⇒ cron 必须以 root 跑。改 `/etc/cron.d/hergent-backup` 前 `cp -p`。

## UI 风格偏好（全文 `§MEM-ARCHIVE-v606`；列面板 → 日志 v676/v677）
- 🔴 同行控件必须同构（基准 `.tb-toggle`/`.btn-sm`：32 高/13 字/radius 8/`padding:0 12px`）；判据=顶边差 0、高度差 0。危险程度靠角标配色，不改按钮外形。
- 🔴 **「UI 不统一」先怀疑样式缺失，不是审美**（v676）：列设置面板 8 个类全站零定义，而注释写着「全局层已有」。定式 `v676e-orphan-check.py` 机械核对模板类 vs 样式定义；**注释说「已有」一律不认，grep 到定义才算**（反向也要查：模板用到的 `li.hidden` 曾零样式）。
- 🔴🔴 **复选框禁止 `@click.prevent` + 单向 `:checked`**（v677；v669 修过又复发）：Chrome 的 pre-click activation 先翻转 checked 再派发 click，`preventDefault()` 让浏览器在**派发结束后还原**，而 Vue 只在 vnode prop 变化时写 DOM ⇒ 不再 patch ⇒ **勾选态与真值永久相反**。定式 `@change`（不 prevent）+ `nextTick(() => el.checked = state)`。全站 4 处：`Forecast.vue` 查看态/改单态、`ColMenuPanel.vue`、`InvPurchaseList.vue`；护栏 `guard-checkbox-change.py`（扫到 0 处即 exit 1）。
- 🔴🔴 **验复选框只能 CDP 真鼠标**（`Input.dispatchMouseEvent` + 点后等 ≥1s）：JS `el.click()` **没有 pre-click activation** ⇒ 用它的探针会对上面这个 bug 一路判 PASS（v669、v677 各被骗一次）。定式：**先在旧版跑出 FAIL 再用它验修复**（判别力自证）。
- 🔴 看起来能点的必须真能点：`role=button`+`tabindex=0`+`@click`+`@keydown.enter/space`+`cursor:pointer`+hover。图标尺寸只由 CSS 定，量法只认 `getBoundingClientRect`。拒绝容器形状：定稿=裸青色 `chevron-right`，自创形状必被否，先 grep 既有同类控件。

## 进度 / 交付锚
P0/P1 全交付；剩余促销ROI(端点坏死500)/货架位(零数据)/现金流预测页面化。**卖前三关未过；调拨单生产仍 0 张**。BI 指标唯一源 `erp_db.py:_BI_MEASURES`（口径必须 `soi.amount`）；库存周转唯一源 `get_inventory_turnover`。
起号必读 `version-history.md` + 实搜两仓 `git log --all`；前端 `roles` 窄名单非真保险 ⇒ 敏感页必须后端 `_admin` 双保险(v531)。

## 主体 / 脱敏 / 技能 / 本机坑
主体 hergent-cn-v2(`laozhangai-product`)｜hergent-erp(FastAPI+SQLite)。脱敏红线：返利率/进货价/客户名/区域销量/厂家政策；PII 不落 `outputs/`。技能 7 个在 `.workbuddy/skills/`。本机坑→`topics/local-machine-pitfalls.md`（🔴 `grep "A\|B"` 静默失效 ⇒ 一律 `-e`；`&&` 短路；`| head -N` 截命中；`grep -rl` 只搜顶层；ssh 嵌 python 引号⇒写远端脚本；`pkill -f x` 会杀掉执行它的 shell）。
