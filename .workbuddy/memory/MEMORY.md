# Hergent 记忆索引（只放判据 + 去哪查；细节全在 `topics/*.md`）

前端 `hergent-cn-v2`（Vue3.5 SFC/Vite）｜后端 `hergent-erp`（FastAPI + SQLite 多租户）。
线上：后端 `/opt/hergent-erp`（扁平、`routers/` 无 `server/`、**不在 git**）｜前端平铺 `/opt/hergent-cn-v2`｜`root@47.113.224.140`。

## 按域查（动手前先查，别凭印象）

前端/浮层/表格/布局/页面真身→`frontend-ui.md`｜后端写库·建表·**路由三张表**·隔离租户 e2e→`backend-invariants.md`｜部署·构建·测试基线→`deploy-ops.md`｜单位三档·自由退货·商品候选·数字单位→`inventory-psi.md`｜探针纪律·本机坑→`local-machine-pitfalls.md`｜凭证→`backend-auth.md`｜预报→`forecast-order-domain.md`｜返利→`rebate-domain.md`｜货损效期→`expiry-loss-domain.md`｜对账→`reconciliation-redo.md`｜副驾→`ai-copilot.md`｜并行→`parallel-dev-protocol.md`｜静默失效家族（改前端必读）→`v629-silent-failure-family.md`。

## 十条最容易「静默失效」的（细节在各 topic）

1. 接口 200 / 界面看着正常 **≠** 生效。判据只能用**用户可见字面量**，不能用 minify 后会改名的符号名（`handlerDeptHint` 这类恒搜不到）。
2. `api()` 只解一层（`client.js` 已 `data.data ?? data`）⇒ 再写 `(d && d.data)` 恒空；prop 已解包 ⇒ 写 `props.row`，不是 `props.row.value`。
3. 写库必须 `db.get_db_tx()`（`get_db()` 不 commit）；新路由必须登记 **`_PATH_MODULE_MAP`**（fail-closed，未登记 403 连 boss 都打不开）。「页面能开」不证明「接口能调」。
4. 动过 SFC 必须重构建重部署（scopeId 由内容派生）；发布传**整个** `dist/assets/`，绝不 `--delete`，最后 scp `index.html` + 双侧 md5。
5. 「改了但没变」第一步查构建号 `__HG_BUILD__`（源头 `src/main.js`，**发版前先升**）；懒加载 chunk 不出现在 index.html；SPA 老标签页永不重拉。
6. 「只提醒不拦截」：提醒状态**不得**进 `validate*()` 函数体、不得绑 `:disabled`。一进校验就变拦截，而界面看不出区别。
7. 列宽按**最不利密度**核算、操作列 ≥72（「抄列宽」比「抄机制」更危险）；浮层低于 `--z-page-fs` 会被整块盖住，遮罩与本体必须成对抬升。
8. 单位：档案价 = 元/**小**单位；换档**数量不动、金额跟着变**；切客户/供应商/单据类型必须清定价缓存。
9. 「搜不到」先排除「搜错范围 / 被截断」：`grep "A\|B"` 静默返回空、`| head -N` 截掉决定性命中、`grep -rl X *.py` 只搜顶层。**多模式一律用 `-e` 或拆两条。**
10. 探针放 `tests/perf/vXXX/`（`/tmp` 下 import 不到 playwright）；临时登录态只插主库 `erp.db` 的 `sessions`，测完删净并自证残留 0。

## v686 三条口径（2026-10-25）

- 销售四页（自提/车销 订单+退单）此前**根本没有**「经办人」字段 ⇒ 是**补字段**不是改名；落 `sale_orders.handler` / `return_orders.handler`。
- 「选业务员带出部门」唯一实现 `pages/inventory/new/handlerDept.js`；**采购侧存 `department_id`(id)、销售侧存 `department`(名字)**，两页同名不同库，别互抄。
- 采购单列表只有「业务员」**筛选**、没有列（本页从没加过 handler 列）；**仓里没有单据打印模板**（`/print` 是「开发中」占位，`printable.js` 只服务 AI 报告）。`InvPurchaseNew.vue`/`InvSaleNew.vue` 已被 tree-shaking 排除（改它们产物 md5 不变）。

## 进度锚

卖前三关未过；调拨单生产仍 0 张。BI 唯一源 `erp_db.py:_BI_MEASURES`（`soi.amount`）；库存周转 `get_inventory_turnover`。
脱敏红线：返利率 / 进货价 / 客户名 / 区域销量 / 厂家政策；PII 不落 `outputs/`。
编号已到 **v686**（v685 商品候选可用优先 / v684 自由退货只提醒 / v683 单位可选+价格联动 / v682 `%（` 崩 / v681 monitor 门禁+隔离租户 e2e）。
历史交付（P1-4 告警引擎、P1-5 审计、consignment/subcontract 待办）→ `topics/backend-invariants.md`。
