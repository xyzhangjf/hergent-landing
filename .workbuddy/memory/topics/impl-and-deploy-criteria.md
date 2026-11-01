# 结构与实现细则判据（v587–v713 原文，从 MEMORY.md 原样搬出）

> 本文件是 `MEMORY.md` 超限后拆出的**明细层**，原文照搬、未删任何一条。
> `MEMORY.md` 里只留一句话指针；按关键词（`4 处`/`emptyOutDir`/`闭包`/`isQtyRow`…）搜这里。
> 域内更细的成因与实测数字仍在 `topics/frontend-ui.md` / `deploy-ops.md`。

## 🔴 结构 / 字段扩展（全文 `topics/frontend-ui.md` 末节）
- 🔴 **给表格加一列 = 先吃掉「名称列」宽度**（v674）⇒ 长文本列必须 `min-width` 保底；**只写 `width` 无效**，要 `width+min-width` 同写。
- 🔴 **分页条必须在滚动容器外面**（v675）；移出后滚动区 `max-height` 减掉分页高度，且**翻页/改条数/换筛选后 `scrollTop=0`**。
- 🔴 给商品加字段改 **4 处**（v670）：`_safe_migrate` 加列＋`GRID_COLUMNS`＋`products_grid` 输出＋summary 的 `imported_products` SQL；前端另需 `asProdRow`＋`loadEditGrid`/`loadCross`＋`applySaved` 补列 + `after:'<锚点>'`。缺一处 = 某态恒空。
- 🔴 **给 `hr_employees` 加列也是 4 处（v707）**，且 `employee_create` 还有第三份 `allowed` 白名单 ⇒ 动手前 `grep -c "allowed = \["` 数清（应 ≥3）。
- 🔴 `GET /api/products` 是 `SELECT *` ⇒ 新字段自动下发；`PUT` 白名单**故意不收** `order_days`。`.pa-ft-note` 全局是警告橙 ⇒ 正常态自带 class 压灰。
- 🔴 `ui_col_prefs` 是**租户级**不是 per-user ⇒ 探针切列会改全租户视野，测完查库确认。`visibleCols` 元素**没有 `type` 字段**（v668）⇒ 按 `col.type` 取值必须走 `colOrderList`，否则静默 `return ''`。
- 🔴 `Icon.vue` 是手写 `ICONS` 映射，写错名字**静默兜底成齿轮**。｜scopeId 由文件内容派生（动过 SFC 必重构建）｜全屏层外的元素全屏看不见｜Modal 一律 `--z-page-modal-overlay/-modal`（1125/1130）｜与视口相关的尺寸不许写死 vh｜判「折行」只认行高｜打开即输入用 `data-autofocus`。


## 前端实现细则（全文 `topics/frontend-ui.md`）
- 🔴 构建 `--emptyOutDir false`（`rm -rf` 被 safe-delete 拦）；**报失败先排除 safe-delete**；行高真凶常是**子元素 display** 不是 padding。浮层定式 `Teleport + fixed` + 层级取 `--z-page-*` 令牌（页面里不许拍数）。
- 🔴 **页面文件名 ≠ 产物 chunk 名**（v706：`EmployeeArchive.vue` 落到 `Archive-*.js`）；**每次 build 全部 chunk hash 都变** ⇒「只传改动那个」一定白屏，必须闭包补传。
- 🔴🔴 **CSS 改完要量 `getComputedStyle`，不能只 grep 产物**（v708）：「规则在产物里 + `matches===true` + 不生效」成立 —— 同特异性时**压缩后顺序**定胜负。
- 🔴🔴 **跨组件样式覆盖必须写在目标组件自己的文件里**（v708）：`@media` **不提高特异性**，scoped 还会把类编成 `.wx[data-v-<父>]` ⇒ Shell.vue 里那条媒体查询**从没生效过**。
- 🔴 **裸文本在 flex 容器里是匿名 flex item**（v708）：被压到 1 字宽 ⇒ 逐字换行。包 `<span>`+`nowrap`；`ellipsis` 要生效**必须**配 `min-width:0`；空间不够让 `flex:1` 让位，按钮/胶囊 `flex-shrink:0`。
- 🔴 `appearance:none` **必须补自绘箭头**；用 `background-color`+`background-image`+右侧让位 padding，**不能**写 `background` 简写（会重置 image）。
- 🔴🔴 **弹层本体必须高于自己的触发器**（v678 第三次复发：`.tb-pop` 1101 < `.tb-pop-panel` 1116 ⇒ 按钮成遮挡带并静默劫走点击）⇒ 优先**降按钮**；护栏 `zorder-trigger-below-panel.guard.mjs`；抬高后同时改「实测宽高 + 选空间大的一侧 + max-height 钳制」。
- 🔴 样式不生效先排三条：多根组件丢父级 class（`inheritAttrs:false`+`v-bind="$attrs"`）、`v-html` 拿不到 scoped（挂 `:deep()`）、`v-if` 面板连 `scrollTop` 一起销毁。可折行工具行 `flex:0 0 auto`。
- 🔴 前端判权限一律 `canDo(模块,动作)`；临时高亮用 data 属性不用 class；跳转定位要等 `currentId` 切到目标且 `el.isConnected`。响应式断点**逐档实测**（注释里的余量数字一律作废；查看/编辑态分开量）。
- 🔴 副驾三条（v625/v627）：异步补内容必须「发起时快照归属」；协议里的沉默也是表态；卡不是人说的话就别用气泡包它。


## 🔴 行筛选 / 只读 / 批量写（v607-v614，全文 `topics/forecast-order-domain.md`）
- 🔴 行显隐**两份实现**（`rowVisible(r)` 查看态 / `rowBaseShown(ri)` 编辑态，共用 `brandSelSet`）⇒ 新增筛选两处同改；判「能否编辑」看有没有保存路径，不看有没有 input。
- 🔴「撤下」≠「删行」（留行+`list_del` 旗标，候选排除 `qty>0`）；任何筛选/批量按钮先问「没有筛选时它意味着什么」（清空后候选=全表差额 ⇒ 必须有筛选闸门）。


## 🔴 数字的单位必须跟着口径走（v587）
返利 `target_type = amount|quantity`；quantity 时目标/达成/贡献/缺口/均单**全是件数**。定式 `isQtyRow`/`uVal`/`uGap`。跨口径不能相加：mixed 时不给金额、写明「口径不一致、不合并」。真实数据里不存在的分支：生产构建剥离了 `__vueParentComponent` ⇒ 从 SFC 源码正则抽真实函数执行 + 断言模板绑定。


## 🔴 部署必检：入口依赖闭包（v583 整站白屏）+ 护栏纪律
- 定式 `python3 ../.workbuddy/tools/deploy-frontend-closure.py --push`（以 `dist/index.html` 为种子递归补传，**最后才传 index.html**）+ 双侧 md5。macOS rsync 不支持 `--chown`；`rsync -R dist/./x` 不锚在 dist；别用 `comm` 比清单。🔴 脚本常报「补传 111」却末态全 200 ⇒ 计数可疑，**判产物以 curl + `cmp` 逐字节为准**。样式常落在**懒加载 chunk 的 css**。
- 🔴 护栏要防空转：扫到 0 个目标就 exit 1，别打印「全 PASS」。


## 🔴 备份巡检 / 告警通道（v666，详情 `topics/deploy-ops.md`）
`scripts/check_backup_alive.py` 有 `--test`/`--dry-run`；**别删**。通道按序 `.env` 的 `WECOM_/FEISHU_WEBHOOK_URL` → 都没有走 `hermes send` ⇒ cron 必须以 root 跑。改 `/etc/cron.d/hergent-backup` 前 `cp -p`。

