# Hergent 记忆索引（只放判据 + 去哪查；细节全在 `topics/*.md`）

前端 `hergent-cn-v2`（Vue3.5 SFC/Vite）｜后端 `hergent-erp`（FastAPI + SQLite 多租户）。
线上：后端 `/opt/hergent-erp`（扁平、**不在 git**）｜前端 `/opt/hergent-cn-v2`｜`root@47.113.224.140`。

## 按域查（动手前先查，别凭印象）

前端/浮层/表格/布局/页面真身→`frontend-ui.md`｜后端写库·建表·**路由三张表**·隔离租户 e2e→`backend-invariants.md`｜部署·构建·测试基线→`deploy-ops.md`｜单位三档·自由退货·商品候选·**商品档案新增/编辑**·**收文案≠收反馈**→`inventory-psi.md`｜探针纪律·本机坑→`local-machine-pitfalls.md`｜凭证→`backend-auth.md`｜预报→`forecast-order-domain.md`｜返利→`rebate-domain.md`｜货损效期→`expiry-loss-domain.md`｜对账→`reconciliation-redo.md`｜副驾→`ai-copilot.md`｜并行→`parallel-dev-protocol.md`｜静默失效家族（改前端必读）→`v629-silent-failure-family.md`。

## 十条最容易「静默失效」的

1. 接口 200 / 界面正常 **≠** 生效。判据只能用**用户可见字面量**，不能用 minify 后会改名的符号名。
2. `api()` 只解一层 ⇒ 再写 `(d && d.data)` 恒空；prop 已解包 ⇒ 写 `props.row`，不是 `.value`。
3. 写库必须 `get_db_tx()`（`get_db()` 不 commit）；新路由必须登记 **`_PATH_MODULE_MAP`**（fail-closed，未登记 403 连 boss 都打不开）⇒「页面能开」≠「接口能调」。
4. 动过 SFC 必须重构建重部署（scopeId 派生）；发布传**整个** `dist/assets/`，绝不 `--delete`，最后 scp `index.html` + 双侧 md5。
5. 「改了没变」先查 `__HG_BUILD__`（源头 `src/main.js`，**发版前先升**）；懒加载 chunk 不出现在 index.html；SPA 老标签页永不重拉。
6. 「只提醒不拦截」：提醒状态**不得**进 `validate*()`、不得绑 `:disabled`——一进校验就变拦截，界面看不出区别。
7. 列宽按**最不利密度**核算、操作列 ≥72（抄列宽比抄机制更危险）；浮层低于 `--z-page-fs` 会被整块盖住，遮罩与本体成对抬升。
8. 单位：档案价 = 元/**小**单位；换档**数量不动、金额跟着变**；切客户/供应商/单据类型必须清定价缓存。
9. 「搜不到」先排除「搜错范围/被截断」：`grep "A\|B"` 静默空、`| head -N` 截掉关键命中、`grep -rl X *.py` 只搜顶层。**多模式用 `-e` 或拆两条。**
10. 探针放 `tests/perf/vXXX/`（`/tmp` import 不到 playwright）；临时登录态只插主库 `erp.db` 的 `sessions`，测完删净并自证残留 0。

## 近三版口径

- **v689** 商品档案「新增」并入「编辑」**同一个弹窗**（`formMode:'edit'|'add'` + 同一个 `editForm`）⇒ 判据是**结构只有一个弹窗**（遮罩数=3、`addForm/addOpen` 必须不存在、两处保存按钮都绑 `saveForm()`），不是像素。新增改走 **`POST /api/products`**（`product_create` 支持 30 字段），**不再 `bulk-upsert`**（那条只认 17 列且**同名即覆盖别人那行**，v226/v184b/v233 三次清零事故全源于此）；`products.name` **无唯一索引**、生产已有 130 组同名 ⇒「同名=同一条」不成立。语义别互抄：编辑「留空=清空」，新增「留空=用默认值」。
- **v688** 采购建单表 1536 视口横滚已修，判据见下方「进度锚」。
- **v687** 收掉建单页常驻占位（「先选供应商/先选客户/请选择原因」）⇒ **必须留三条解释通道**：title 悬停 + 点击 toast + `validate()` 兜底。判「格内没字」只取 `>` 之后的插值，别扫整个标签（title 挂在同一个 span 上，扫全标签会把 title 一起判死）。

## 进度锚

卖前三关未过；调拨单生产仍 0 张。BI 唯一源 `_BI_MEASURES`（`soi.amount`）；库存周转 `get_inventory_turnover`。
脱敏红线：返利率/进货价/客户名/区域销量/厂家政策；PII 不落 `outputs/`。编号已到 **v689**。
字号：主力 **11–12.5px**（业界 13–14px），老板 2026-10-26 定**暂不提档**（笔记本用浏览器 125%）。⇒ 别再重复提议改字号；卖客户前必重上桌面。**v688 已修**采购建单表在 1536 视口横滚，但判据要记住：`table-layout:auto` 下**列宽是被内容撑开的，改 width/min-width 无效** ⇒ 压列必须 `max-width`+省略号，且包 `@media(max-width:1680px)`（否则台式机被误压）；**采购退货页是独立组件**、自带一份 1372 要单独改。数字列一个不能压（截断=读错金额）。别照抄 1372（详情 `topics/frontend-ui.md`）。
历史交付（P1-4 告警、P1-5 审计、consignment）→ `topics/backend-invariants.md`。
