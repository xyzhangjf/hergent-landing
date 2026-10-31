# 路由索引（2026-10-19 从 MEMORY.md 逐字迁出；MEMORY.md 只留最常用的 4 条 + 指针）

> 用法：先按域在本表找到 `topics/*.md` 或 `docs/*.md`，再读那份。域内判据以对应 topic 为准。

## 前端（通用 UI / 页面工程）
→ `topics/frontend-ui.md`
- 入口唯一源 `pages.js`（未登记=失门禁）§v209
- `permView.js` 唯一源；`module:null` = 只读 §v348
- 文案三禁 ⇒ `hergent-ui-copy-guard` §v331
- 图表唯一源 `src/components/chart/`（v491；导 PNG 必须内联实际色）
- 列表页冻结 / 密度 B / 合计 = `psi-list.css`（v511-v514）
- 侧栏系列（v515-v517）：只删菜单项，路由与 `pages.js` 登记不动
- v518：员工档案保存必须落库回读校验

## 建单 / 退单页
→ `docs/进销存建单页开发规范-v441.md`
- 三层高度链｜`?tab=` + `watch` 单入口多子页
- `npm run build` 被 safe-delete 拦 ⇒ 隔离 `outDir dist-vNNN`
- v449 起 7 页独立（`docTypes.js` 唯一源；`redirect` 不指定 `query` 会继承原 query ⇒ 显式 `query:{}`）
- §R 视觉基准 = getComputedStyle 实测

## 后端
→ `topics/backend-invariants.md`
- 路由遮蔽：先注册者胜 §v317
- 静默失效 = 恒空恒 0 ⇒ 跑 `undefined-call-scan.py`
- 门禁用接口模块，不是页面模块 §v328
- FastAPI 未声明 query 参数会被静默忽略 §v443
- 意图路由 ROUTES 按序首匹配（具体插在宽泛前）v535
- execute_tool 返回键是 `success` 不是 `ok`

## 部署
→ `topics/deploy-ops.md`
- 后端 FLAT `/opt/hergent-erp/`（本地仓 `/Users/zhangjunfeng/Documents/hergent-erp`；**线上 `routers/` 无 `server/` 前缀**）
- 前端根 `/opt/hergent-cn-v2`；`/admin/` 别名 `/opt/hergent-admin`
- 后端服务 `hergent-erp.service`（cwd `/opt/hergent-erp`）；`hergent-server.service` 是遗留 Credits Server
- 部署前必 `git fetch`（落后构建 = 回退他人功能）v509
- 判据「线上跑谁」= `index.html` 的 entry + 该 entry 接线的 chunk §v498
- rsync 绝对路径、绝不 `--delete`；本仓 `git checkout/clean` 会毁 SPA

## 预报主表 / 报单
→ `topics/forecast-order-domain.md`
- 报单单位永不落大单位
- 报单 ≠ 提货；`forecast_audit` 锚 `MAX(order_date)`
- 跨期复制只复制品清单 ⇒ 复 0 行传染 §v282
- 🔴「N 人报」= `COUNT(DISTINCT user_id)` 是**账号数不是门店数**（老板一人替十几店填单 ⇒ 恒为 1）；门店数用 `stores`（带 `store_kind` 去重）§v574
- 🔴 小程序商品来源 = `forecast_import_products`（`save_matrix` 同事务同步）。入清单资格 = `qty>0` ∪ `is_new` ∪ `add_to_list`(v613)。「勾品牌筛选 → 保存」**不会上架**；v613 才有显式按钮，且必须有生效筛选（无筛选时候选 226 个 = 一键灌全表）
- 🔴 补录行**不得**当新商品发 `bulk-upsert`（字段无条件覆盖 ⇒ 清零档案，v612 真机踩过；修法 = 按条码→名称认回，认回的行不发）

## 返利 / 目标
→ `topics/rebate-domain.md`
- 适用月份只写到当月 ⇒ 次月规则静默消失 §v376
- 进得去 ≠ 读得到（403 被吞）§v353
- 到货停单 ⇒ 期次不自动建 §v364

## 货损 / 效期
→ `topics/expiry-loss-domain.md`（同上三条同源判据）

## 进销存 PSI
→ `topics/inventory-psi.md`
- 八页继承父行门槛；入库批次三列不写 ⇒ 效期全空
- FEFO 不足整体拒绝；`sale_order_deliver` 只收 `draft`
- 退货可不挂原单；调拨走 `transfer_orders` 真双仓（失败必须 raise）；无调拨退单 v449
- `StatusTabs.vue` 计数必须服务端（口径 = 忽略 status 保留其余筛选）§v498
- 退单真身 `return_orders` / `purchase_returns`（counts 黑名单 `='draft'`）
- v509 七列表页布局统一

## 审批流（P1-2, v519+v525）
→ `server/routers/approvals.py`（6 端点 `/api/approvals`）
- 状态机 `draft → pending_approval → approved → 执行`
- 前端只接 purchase / sale / transfer

## 进销存岗位分权（P1-1, v517+v526）
- v517：会计 / 主管能进能建不能改删（`canUpdate` 收口）
- v526：销售员行级隔离（`creator=operator_id=str(u.get("id"))`）
- 「开门」= 老板勾 `inventory` 模块；绝不可把 `sales` 加进 `PSI_ROLES`（跨租户红线）
- 三个坑：①`_DEFAULT_PERMS` 只管未覆盖角色 ⇒ tenant_1/10 须迁租户库；②`_perm_granted()` 里 list = 全动作放行、dict 才细分；③前端写操作曾全用 `canDo('inventory','create')` 一把梭 ⇒ 改挂 `update`

## 副驾 / AI
→ `topics/ai-copilot.md`
- `ai_tools` = 只读 SQL；数量类先 GROUP BY

## 对账
→ `topics/reconciliation-redo.md`
- P1-4 v527/v528：`/funds/reconcile` 双上传走 v198 `recon_engine`
- v533 修 `(await f()||[])` 漏 await

## 品牌 / 小程序数据
→ `topics/miniprogram-and-brand-data.md`

## 新用户 / 价格 / 档案门禁
→ `topics/onboarding-and-archive-gate.md`
- 价格真身 `customer_prices`
- 换算权威 `products.large_ratio / medium_ratio`
- 客户档案列表必传 `type=customer`

## 跨域铁律 / 多会话并行
→ `topics/cross-domain-iron-laws.md`｜`topics/parallel-dev-protocol.md`

## 协作规范
→ `docs/Hergent-开发团队协作规范与交付流程.md`
- `vNNN` 全局序列 / one-Edit-at-a-time + scoped 提交 / 部署三件套 / 五段交付摘要

## 进价 / 价格口径
→ `docs/进销存商品进价口径待办清单.md`
- 权威价源 = 舟谱《采购订货明细报表》（采购价列 = 小单位真实进价；1705 行合计必须排除）
- 批量改价前按「条码 + 单位名称」分组 §v508
- WAL 库备份禁裸 `cp`，改 `sqlite3 .backup` / `VACUUM INTO`

## 蒙牛口径（业务事实）
- 两户头 = 福宝 / 恒滋（`products.ordering_entity`）
- 下单侧 25 个「组/板/包/提」大单位、销售跑小单位兄弟档案 ⇒ 对 `get_profit_report()` 贡献恒 0、不要改进价
- `can_sale` 全库 473 个全为 1 = 死字段
