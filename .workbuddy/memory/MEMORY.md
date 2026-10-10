# Hergent 记忆索引（限额 3000 字）

> 新增下沉 `topics/`；本文件只留**路由 + 召回锚(§) + 硬判据**。

## 路由
- **前端** → `topics/frontend-ui.md`：🔴 入口唯一源 `pages.js`（未登记=失门禁）`§v209`；🔴 `permView.js` 唯一源、`module:null`=只读 `§v348-351`；🔴 文案三禁⇒技能 `hergent-ui-copy-guard` `§v331/339`；🔴 弹窗三按钮合一/密码先校验 `§v382-385`；🔴 单入口→多子页拆（`?tab=`+`watch`+键名对齐）`§v424/427-429`；🔴 **列设置齿轮**共享 `useColSettings`/`ColMenuPanel`/`col-menu.css`(v432)。
- **建单/建退单页** → `hergent-cn-v2/docs/进销存建单页开发规范-v441.md`（范本=「创建采购订单」）：🔴 三层高度链(缺一层底条不贴底)；🔴 框式头 `.‹pfx›-hd-box`+`:focus-within`、红 `*` 必填/不写「选填」；🔴 同 path 两 query ⇒ **computed+watch**（`onMounted` 不再跑且零报错）；🔴 幂等键提交成功**立刻换**（不换=第二次静默无效）；🔴 退货成功落点看**源单状态是否回写**（采购回写⇒回列表；销售不回写⇒就地刷新）；🔴 真机探针 `.workbuddy/tools/v441-psi-new-e2e.mjs`（105 PASS）；🔴 类差集审计 `.workbuddy/tools/v441-psi-new-class-audit.py`(自带判别力自证)；🔴 本机 `npm run build` 被 safe-delete 拦 ⇒ 隔离 `outDir dist-vNNN`。
- 🔴 **探针自己会判错**（v441 实测，先排除再当事实）：`Page.navigate` 到**只差 hash** 的 URL 是**同文档导航**⇒文档不重载、`onMounted` 不跑、`form.*` 留旧值 ⇒ 必须加 `'/?__r='+Date.now()+hash`；`.ipn-ret-tbl` 自带 `-tbl` 类 ⇒ 判「订单模式那张表」要 `:not(.-ret-tbl)`；读数条要**选客户**、退货明细要**选原单**才有（不交互量到的"没有"是设计如此）；重试等到渲染完的判据用 `title` 非空，别用 `hdBox||retTbl`；按钮按**文案**定位别按类名（`.ipn-save-main` 只采购页有，且是"与下拉拼一条去圆角"用的）。
- 🔴 **采购退货候选「粗筛」缺口（待修）**：`purchase_order_list(returnable=1)` 只按 `po.status IN ('received','partial','returned')` 粗筛，真判据在 `return-preview`。tenant_1 实测候选 **79 张全部不可退**（79 张 `received` 单**全无明细行**，`purchase_order_items` 全库仅 11 行且都在 draft/cancelled）⇒ 下拉给 79 个必然失败的选项，且提示语「只列出**进过货**的单」与事实不符。建议：粗筛补 `AND EXISTS(item)` + 空态文案。探针现走「诚实降级」分支。
- 🔴 **销售退货单列表恒空（待修）**：`InvSaleList.vue` 的 `kind=return` 筛 `sale_orders.status='returned'`，而全仓**无写入方**（销售退货不回写源单）⇒ 自提/车销退单**左半入口空表**；`kind=order` 的 `.filter(...status!=='returned')` 是恒真前端过滤。
- **后端** → `topics/backend-invariants.md`+`backend-auth.md`：🔴 路由遮蔽先注册者胜 `§v317`；🔴 静默失效=恒空恒0零报错⇒`tools/undefined-call-scan.py`；🔴 静默洞四(§v279)；🔴 幽灵 inode：先删后重启+`DB_PATH` 两份都 patch `§v289`；🔴 门禁用**接口模块**非页面模块、动作=HTTP 方法 `§v328/335`；🔴 **FastAPI 未声明的 query 参数被静默忽略**（`?limit=300` 被丢、恒回 db 默认值；`psi.py` 委派 `routers.sales.list_sale` 两处都要声明）`§v443`；🔴 委派链只在**唯一源函数**加参数（绕开委派直连 db = 把 B1 数据隔离抄两份）；🔴 `limit<=0` 必须落回默认（SQLite `LIMIT -1`=不限，会把两万行吐出来）。
- **部署** → `topics/deploy-ops.md`：🔴 后端 FLAT `/opt/hergent-erp/`、前端根 `/opt/hergent-cn-v2`；🔴 chunk 名什么都判不了(hash 级联两级)；🔴 生产 `assets/`=并集(绝不 `--delete`)；🔴 后端判据=生产 md5==HEAD md5、写「内容差异」非「文件名差异」`§v378/404`；🔴 受控提交=按 import 图传递扫→`hergent-scoped-commit`。
- **预报主表** → `topics/forecast-order-domain.md`：🔴 报单单位永不落大单位(真身 `products.order_unit`)；🔴 价格双轨 `factory_price`=元/箱、`sale_price`=元/小单位；🔴 报单(判断)≠提货(事实)、`forecast_audit` 锚 `MAX(order_date)`；🔴 跨期复制只复制品清单、上一期为空⇒复0行传染 `§v282`；🔴 报单自动化死锁：人工恢复报单期次永久 open 挡死自动建表 `§v354/355`。
- **返利/目标** → `topics/rebate-domain.md`｜**货损效期** → `topics/expiry-loss-domain.md`：🔴 适用月份=月度分解本身、只写到当月⇒次月规则静默消失 `§v376`；🔴 页面进得去≠页内取数读得到(403 被吞) `§v353`；🔴 到货停单⇒该期次不自动建(§v364)。
- **进销存(v391→八页)** → `topics/inventory-psi.md`：🔴 八页继承父行门槛、`pages.js` 一字不改；🔴 入库批次三列明细 INSERT 不写⇒效期全空；🔴 FEFO 不足整体拒绝不部分扣、`sale_order_deliver` 只收 `draft`；🔴 销售单无审核、`status='draft'` 已确认单永远发不了货 `§v412`；🔴 列设置上云、自定义字段 `extra` 空则不加列 `§v403/415`；🔴 积分已冻结(`credits.py` 停用别修)。
- **报单/小程序/品牌** → `topics/miniprogram-and-brand-data.md`：🔴 能登录≠能干活(角色缺 `data`⇒每动作 403)；🔴 均单提示四前置缺任一静默 `§v324`；🔴 报单页 v433/434 常驻一键清空 /「我的提交」复制跨 tab 经 `app.globalData._fsCopy`。
- **副驾/AI** → `topics/ai-copilot.md`(`ai_tools`=只读 SQL、数量类先 GROUP BY)｜**通知没到人** → `topics/notification-center.md`(四层：跑没跑→内容→`enabled_channels(tid)`→出站)；🔴 标题拼内部租户名=文案泄漏、`event_key` 现算改名即静音 `§v351/352`。
- **IM** → `topics/im-channels-v131.md`｜**业绩提成** → `topics/sales-reports-and-operator-attribution.md`｜**对账** → `topics/reconciliation-redo.md`。
- **新用户/价格/换算/客户档案** → `topics/onboarding-and-archive-gate.md`：🔴 价格真身 `customer_prices`、中/大=小×换算比；换算唯一权威 `products.large_ratio/medium_ratio`(判据 `large_ratio>0`)；🔴 客户档案列表必传 `type=customer`。
- 🔴 **跨域铁律** → `topics/cross-domain-iron-laws.md`。

## 技能路由 → `topics/skill-routing.md`
🔴 `hergent-pre-launch-audit`｜`hergent-external-material-pdf`｜`hergent-scoped-commit`｜`hergent-parallel-session-safety`(比字节不比名)｜`hergent-rebate-caliber-consistency`｜`hergent-chart-render-verify`｜`hergent-ui-copy-guard`。

## 编号约定
🔴 已用到 **v443**；号=全局共享序列，多会话并行⇒起号前必读号表+实搜未提交文件/两仓 `git log --all`/同日在途/`git worktree list` → `topics/version-history.md`。

## 主体/脱敏
hergent-cn-v2(`laozhangai-product`)｜hergent-erp(FastAPI+SQLite)｜🔴 脱敏红线：返利率/进货价/客户名/区域销量/厂家政策；仓内含生产凭据明文⇒远端须 private+入库前跑凭据扫描；PII 不落 `outputs/`。

## 本机坑 → `topics/local-machine-pitfalls.md`(§10–§43)
🔴 `grep "A\|B"` 静默失效⇒`-e`；`&&` 短路；`| head -N` 截命中；zsh 通配无匹配 abort；探针别放 `/tmp`。
