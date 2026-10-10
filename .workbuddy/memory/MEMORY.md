# Hergent 记忆索引（限额 3000 字）

> 细节一律下沉 `topics/`；本文件只留**路由 + 召回锚(§) + 硬判据**。

## 路由
- **前端** → `topics/frontend-ui.md`：🔴 入口唯一源 `pages.js`（未登记=失门禁）`§v209`；🔴 `permView.js` 唯一源、`module:null`=只读 `§v348`；🔴 文案三禁⇒`hergent-ui-copy-guard` `§v331`；🔴 单入口→多子页（`?tab=`+`watch`）`§v424`；🔴 列设置齿轮共享 `useColSettings`/`ColMenuPanel`/`col-menu.css`(v432)。
- **建单/建退单页** → `docs/进销存建单页开发规范-v441.md`（范本=「创建采购订单」）：🔴 三层高度链；🔴 框式头 `.‹pfx›-hd-box`；🔴 同 path 两 query ⇒ **computed+watch**（`onMounted` 不再跑且零报错）；🔴 幂等键成功**立刻换**；🔴 退货落点看**源单状态是否回写**；🔴 探针 `v441`(105) + `v444`(38)；🔴 类差集审计(自带判别力自证)；🔴 `npm run build` 被 safe-delete 拦 ⇒ 隔离 `outDir dist-vNNN`。
  - 🔴 **v444 四条**：出厂 **15 行** `PRESET_ROWS`｜必填列红 `*` **用表单头同一枚类**｜**列宽拖动**（`MAX_W` 不能设 720）｜**输入框无底色**（只撤明细表）⇒ 细节 `topics/inventory-psi.md`。
  - 🔴 **探针自己会判错**（先排除再当事实）：只差 hash 的 `Page.navigate` = **同文档导航** ⇒ 加 `'/?__r='+Date.now()+hash`；`.ipn-ret-tbl` 自带 `-tbl` ⇒ 用 `:not(.-ret-tbl)`；读数条要选客户、退货明细要选原单才有；就绪判据用 `title` 非空；按钮按**文案**定位；**模板串里正则要双反斜杠**、**模板串内注释不能写反引号**、**INIT 的 user 必须与 token 同账号**。
- **后端** → `topics/backend-invariants.md`+`backend-auth.md`：🔴 路由遮蔽先注册者胜 `§v317`；🔴 静默失效=恒空恒0零报错⇒`undefined-call-scan.py`；🔴 幽灵 inode：先删后重启+`DB_PATH` 两份都 patch `§v289`；🔴 门禁用**接口模块**非页面模块 `§v328`；🔴 **FastAPI 未声明的 query 参数被静默忽略**（`?limit=` 被丢）`§v443`；🔴 委派链只在**唯一源函数**加参数；🔴 `limit<=0` 落回默认（`LIMIT -1`=不限）。
- **部署** → `topics/deploy-ops.md`：🔴 后端 FLAT `/opt/hergent-erp/`、前端根 `/opt/hergent-cn-v2`；🔴 chunk 名什么都判不了(hash 级联两级)；🔴 生产 `assets/`=并集(绝不 `--delete`)；🔴 判据=生产 md5==HEAD md5 `§v378`；🔴 受控提交→`hergent-scoped-commit`。
- **预报主表** → `topics/forecast-order-domain.md`：🔴 报单单位永不落大单位(真身 `products.order_unit`)；🔴 价格双轨(箱/小单位)；🔴 报单≠提货、`forecast_audit` 锚 `MAX(order_date)`；🔴 跨期复制只复制品清单⇒复 0 行传染 `§v282`；🔴 自动化死锁 `§v354`。
- **返利/目标** → `topics/rebate-domain.md`｜**货损效期** → `topics/expiry-loss-domain.md`：🔴 适用月份只写到当月⇒次月规则静默消失 `§v376`；🔴 进得去≠读得到(403 被吞) `§v353`；🔴 到货停单⇒期次不自动建 `§v364`。
- **进销存(v391→八页)** → `topics/inventory-psi.md`：🔴 八页继承父行门槛、`pages.js` 不改；🔴 入库批次三列不写⇒效期全空；🔴 FEFO 不足整体拒绝、`sale_order_deliver` 只收 `draft`；🔴 销售单无审核⇒已确认单发不了货 `§v412`；🔴 列设置上云、`extra` 空则不加列 `§v403`；🔴 积分已冻结(`credits.py` 别修)。
- **报单/小程序/品牌** → `topics/miniprogram-and-brand-data.md`：🔴 能登录≠能干活(角色缺 `data`⇒403)；🔴 均单提示四前置缺任一静默 `§v324`；🔴 v433/434 一键清空、跨 tab 复制经 `app.globalData._fsCopy`。
- **副驾/AI** → `topics/ai-copilot.md`(`ai_tools`=只读 SQL、数量类先 GROUP BY)｜**通知没到人** → `topics/notification-center.md`(四层：跑没跑→内容→`enabled_channels(tid)`→出站)；🔴 标题拼内部租户名=文案泄漏、`event_key` 现算改名即静音 `§v351`。
- **IM** → `topics/im-channels-v131.md`｜**业绩提成** → `topics/sales-reports-and-operator-attribution.md`｜**对账** → `topics/reconciliation-redo.md`。
- **新用户/价格/换算/客户档案** → `topics/onboarding-and-archive-gate.md`：🔴 价格真身 `customer_prices`(中/大=小×换算比)；🔴 换算唯一权威 `products.large_ratio/medium_ratio`(判据 `large_ratio>0`)；🔴 客户档案列表必传 `type=customer`。
- 🔴 **跨域铁律** → `topics/cross-domain-iron-laws.md`。

## 待修（已登记，未动）
- 🔴 采购退货候选「粗筛」把不可退的也列出：tenant_1 候选 **79 张全部不可退**（全无明细行）⇒ 下拉 79 个必然失败的选项，提示语「只列出进过货的单」与事实不符。建议粗筛补 `AND EXISTS(item)`。
- 🔴 销售退货单列表恒空：`InvSaleList.vue` 的 `kind=return` 筛 `sale_orders.status='returned'`，而**全仓无写入方**⇒ 退单左半入口空表。

## 技能路由 → `topics/skill-routing.md`
🔴 `hergent-pre-launch-audit`｜`hergent-external-material-pdf`｜`hergent-scoped-commit`｜`hergent-parallel-session-safety`｜`hergent-rebate-caliber-consistency`｜`hergent-chart-render-verify`｜`hergent-ui-copy-guard`。

## 编号约定
🔴 已用到 **v444**；号=全局共享序列⇒起号前必读 `topics/version-history.md` + 实搜未提交文件/两仓 `git log --all`/`git worktree list`。

## 主体/脱敏
hergent-cn-v2(`laozhangai-product`)｜hergent-erp(FastAPI+SQLite)｜🔴 脱敏红线：返利率/进货价/客户名/区域销量/厂家政策；仓内含生产凭据明文⇒远端须 private；PII 不落 `outputs/`。

## 本机坑 → `topics/local-machine-pitfalls.md`(§10–§43)
🔴 `grep "A\|B"` 静默失效⇒`-e`；`&&` 短路；`| head -N` 截命中；zsh 通配无匹配 abort；探针别放 `/tmp`。
