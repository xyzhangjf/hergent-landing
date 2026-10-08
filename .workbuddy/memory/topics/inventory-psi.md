# 进销存（自研 ERP 交易层）

> 索引｜批次 4（v391 后端薄壳）→ 批次 5（v392 前端八页）→ 批次 6（侧栏 L3/L4 + 手机底栏）
> 主体：hergent-erp 后端 `/api/psi/*`（15 端点）＋ hergent-cn-v2 前端 `/inventory`（1 容器 + 8 页）

## 一、定位与闸门（能力轴 = `inventory`）

- 2026-10-06 战略转向：舟谱不续费，**自研进销存**补进 Hergent —— 先 boss 账号 dogfood，跑顺再卖。
- 闸门 = 既有 capability-based 访问控制新增能力 `inventory`，**默认只 boss**（admin 靠 `["*"]`）。
  · 三层：能力闸门（后端）＋ `pages.js` 入口可见性（前端）＋ 深链守卫。
- 🔴 **唯一不可委派的能力 = `receive`**：`erp_db` 未 re-export `purchase_order_partial_receive`
  ⇒ 老前端分批收货 500（v391 已记）。若要放开分批收货，先补 re-export。

## 二、八页与路由（v392 批次 5）

`/inventory`（容器 `InventoryShell.vue`：`.page page-default` + `.main-tabs` 四页签）下挂 8 条子路由：

| 路由 | 页 | 关键纪律 |
|---|---|---|
| `/inventory` | 工作台 `InvWorkbench` | 4 KPI 与源函数逐条一致；**全 0 时给引导而不是一排 0**；默认 `warehouseId=0` 全部仓（生产有**两个** `is_default=1`，不猜默认仓） |
| `/inventory/purchase` | 采购单列表 | 状态中文映射全；点行去详情 |
| `/inventory/purchase/new` | 新建采购单 | **批次号 + 到期日必填** |
| `/inventory/purchase/:id` | 采购单详情 | 确认入库 = 逐行落批次；`canConfirm/canReceive` **与后端状态前置逐字对齐** |
| `/inventory/sale` | 销售单列表 | **「出货方式」筛选走后端 `order_type`** |
| `/inventory/sale/new` | 新建销售单 | **信用校验交后端**；`status` 不传（空=草稿，发货只收草稿） |
| `/inventory/sale/:id` | 销售单详情 | 发货 → `fefo_deduct`；签收 → 生成应收 |
| `/inventory/stock` | 库存查询 | **默认按到期日升序**（后端给顺序，前端不 sort）；**无创建入口** |

### 路由三条硬规矩（v392）

1. 🔴 **`pages.js` 一字不改** —— 8 条子路由全部**继承**父级 `/inventory` 那一行
   （`module:'inventory'` + `ADMIN_ROLES` + `lock:true`）。`ruleFor()` 是「精确匹配 → 逐级去尾再匹配」
   ⇒ 只要父行不变，子页自动同门槛。已由 `v392-inventory-route-inherit-probe.mjs` 20/20 证明。
2. 🔴 **`path: ''` 的索引子路由是必需的**：没有它，访问 `/inventory` 时父级匹配到了却
   **没有子记录可渲染** ⇒ 页签条在、内容空白。
3. 🔴 **不要给父级加 `redirect: '/inventory'`**（自指重定向 ⇒ vue-router 报循环）；
   **`purchase/new` 必须排在 `purchase/:id` 之前**（否则「新建」被 `:id` 吃掉）。

## 三、🔴 入库批次链路（v392 修的根因）

**症状**：生产 `inventory` 54 行 `batch_no` / `expiry_date` **100% 为空**
⇒ 临期预警与「先出最早到期」对全部存量批次失效。

**根因**：`db/queries/purchases.py::purchase_order_create` 的明细 INSERT 只写六列，
而 `purchase_order_confirm` 入库时**从明细行读** `batch_no`/`expiry_date` 送给 `batch_in`
⇒ 上游填了也被**静默丢掉**。

**修法**：明细 INSERT 按「有值才加列」透传三列（照 v313 加 `order_date` 的范式）
⇒ 不传时 SQL 与行为逐字不变。

🔴 **批次号为什么是必填**：`batch_in` 只在批次号非空时才按 `(商品, 仓库, 批次号)` **累加**同一行；
批次号为空会**每行新建** ⇒ 同一批货入库两次会出现两行、数量对不上。

## 四、🔴 FEFO 出库口径（唯一源 `db/queries/inventory.py`）

- `SALEABLE_BATCH_COND` = `expiry_date='' OR IS NULL OR date(expiry_date) >= date('now','localtime')`
  ⇒ **过期批次不可售**；无到期日**视为可售**（数据问题不是变质）。
- 档位常量：`EXPIRY_CRITICAL_DAYS=30` / `EXPIRY_WARNING_DAYS=90`（前端**不写死**，用接口返回的 thresholds）。
- `fefo_deduct`：**先 pre-check 可售总量**（不足 ⇒ 整体拒绝、**不产生部分扣减**）；
  再按 `CASE WHEN expiry 为空 THEN '9999-12-31' ELSE expiry END ASC, id ASC` 逐批扣；
  SAVEPOINT 保护；返回 `{'success':True,'used':[...]}` 或 `{'error':...,'used':[]}`。
- `sale_order_deliver`：**只接受 `status='draft'`**；逐项查可售库存（不足 ⇒ 返回 error 触发回滚）；
  成功则 FEFO 扣减 + 记批次追溯 + 回写 `batch_id` + 生成拣货波次 + `status='delivered'`。

## 五、销售的「出货方式」（v392 新增）

- `sale_order_list(..., order_type='')` —— 🔴 **追加在参数表末尾**：
  该函数 22+ 调用方虽实测全是关键字传参，但插中间一旦有人按位置传第 7 个参数，
  会**静默变成 `order_type`**（症状：筛选不生效 + 只返回 limit 行）。
- 真数据计数：全量 22508 / `self_pickup` 22257 / `transfer` 251 / 伪值 0。
- 🔴 **筛选必须走后端，不能前端 filter**：2.2 万单按页 50 行，前端过滤会**造假结果**。

## 六、🔴 v392 上线后真机抓到的缺陷（值得跨域吸取）

**`InvPurchaseNew.vue` 模板写了 `¥{{ fmtMoney(...) }}`，而 script 段既没定义也没 import**
⇒ 运行期 `TypeError: fmtMoney is not a function` ⇒ 整页被 ErrorBoundary 兜底替换、
**连带父容器的页签一起消失**（`.main-tabs` 都没了）。

而当时**四道全绿**：`vite build` 绿、路由继承探针 20/20 绿、英文枚举检查 10/10 绿、文案审计绿
—— 因为**模板是运行期求值，构建期不校验标识符可达性**。

**根因形态**：`fmtMoney` 在进销存 7 个页面各有**一份逐字相同**的副本，唯独这一页**漏抄**了。
⇒ 修法不是「补一份」，而是**收敛成唯一实现**（提到 `constants/psiLabels.js`，8 页统一 import）。

**新护栏**：`.workbuddy/tools/v392b-template-symbol-guard.py`
模板里以 `name(` 形式调用了共享符号（`fmtMoney` 族）但 script 段无 `import`/`function`/`const`
⇒ 报红。判别力自证 5/5（反例必红 + 四种正例不误伤）。全量 71 个 `.vue` / 违规 0。

🔴 **跨域教训**：「同一条规则被抄成多份」的代价不只是漂移 —— **漏抄的那份会以「整页崩」的形式爆**，
而静态检查全绿。凡「X 个页面各写一份同样的工具函数」，都要问「漏一个会怎样」。

## 七、验收资产（可复用）

| 脚本 | 覆盖 | 读数 |
|---|---|---|
| `server/tools/v392-purchase-batch-link-verify.py` | 采购明细批次三列落库 + confirm 读走 + 累加语义 + 日期校验正反 + A/B 对照 | PASS 37 / FAIL 0 |
| `server/tools/v392-psi-chain-e2e.py` | **完整单据链**（采购→入库→销售→FEFO→查库存）+ 过期批次反例 + FEFO 顺序判别力自证 + order_type 计数 | PASS 35 / FAIL 0 |
| `.workbuddy/tools/v392-inventory-route-inherit-probe.mjs` | 8 条子路由继承 `/inventory` 门槛（含 lock 不让位反例） | 20/20 |
| `.workbuddy/tools/v392-inventory-enum-render-check.py` | 模板里不许出现英文枚举（须经词表函数） | 10/10 |
| `.workbuddy/tools/v392-inv-e2e-probe.mjs` | 真机三相位：boss 八页可进 → 桩改角色被弹回 → 摘桩恢复 | PASS 44 / FAIL 0 |
| `.workbuddy/tools/v392-entry-zero-sneak-verify.py` | 以**生产生效集**为基线的零夹带比对 | PASS 1 / FAIL 0（判别力 4/4） |
| `.workbuddy/tools/v392b-template-symbol-guard.py` | 模板符号可达性护栏 | 71 文件 / 0 违规 |

### 两个探针自身的坑（都已踩过）

1. `sale_order_list()` 返回 `{'orders':[…],'total':N}`，**不是行列表** ⇒ `len(...)` 恒为 2。
   首次跑 ⑨ 段 4 条断言全假红。**判据：读数全是同一个常数 ⇒ 先怀疑取错结构**。
2. `q(sql, (a or b))` 少了逗号 ⇒ 传了 int 而非 tuple ⇒ `sqlite3.ProgrammingError`。
   写 `q(...)` 的参数一律显式加尾逗号。

## 八、部署事实（照抄）

- 前端真身 = **`/opt/hergent-cn-v2/`**（nginx `root`）—— 公网 `https://hergent.cn/` 直接读它。
  ⚠️ **`/admin/` 是另一份历史前端**（`alias /opt/hergent-admin/`），**与 cn-v2 无关**；
  `vite base: '/'`（**不是** `/admin/`）。判据 = 公网实拉 `https://hergent.cn/` 比对入口 chunk 名。
- 上传：tar 管道 / rsync，**绝不 `--delete`**（生产 `assets/` 是历次构建**并集**）。
- 后端 FLAT `/opt/hergent-erp/`，服务 `hergent-erp.service`（:8700），重启后判据取
  `/api/psi/meta` 的文案里是否含本轮标记（**md5 一致 ≠ 进程已加载**）。

---

## 9. 侧栏入口落位（v393 批次 6.1）—— 「八页上线了但点不到」

**背景 = 计划 §七/§八 的显性断点**：批次 5（v392）八页全链上线时，按纪律**刻意没动
`Shell.vue` 的 `NAV`** ⇒ 当时**只有 boss 手敲 URL 能进**，其余角色连 URL 都被守卫拦
（`/inventory` 行 = `module:'inventory'` ＋ `ADMIN_ROLES` ＋ `lock:true`）。
⇒ 对**用户可见面**等于「功能做了却没接上」。

### 9.1 落位后的 NAV 形状（`Shell.vue`）

| 列 | 条目 | `create`（L1 双入口） |
|---|---|---|
| 采购 | `/inventory/purchase` | `/inventory/purchase/new`（标题「新建采购单」） |
| 销售 | `/inventory/sale` | `/inventory/sale/new`（标题「新建销售单」） |
| 库存 | `/inventory/stock`、`/data-fill`（库存效期补录） | — |
| 往来 | **留空**（等往来账模块；`resolveNavItem` 会丢掉空列 ⇒ 弹窗里不出现） | — |
| 其他 | `/inventory`（进销存总览） | — |

🔴 **`pages.js` 一字未改** —— 7 条子路由逐字继承 `/inventory` 那一行
（`ruleFor` 逐级去尾匹配）。**加入口 ≠ 加权限行**。

### 9.2 「进销存」区为什么必须有 `path` 闸门（复用 v390 的判断）

区内的「库存效期补录」`/data-fill` 挂的是**宽模块 `stock`**（业务员/会计/主管都可能有）
⇒ 不设 `path` 闸门时，一个叫「进销存」的区会**冒到这些人侧栏**。
⇒ 判据仍是 `canSee('/inventory')` 一处实现，只是「拿哪个 path 当锚点」由数据声明。
真机反例（同令牌桩成 `sales`）：**整个区消失**，且同页仍有「经营工作台」等无关入口
（排掉「整个 app 被换掉」这个假阴性）。

### 9.3 手机抽屉的「＋」

- 桌面弹窗写「**＋ 创建**」二字（横向有余量）；手机只放 `＋` 图形。
- 两者**同一个 `create` 数据源**，`resolveNavItem` 已按 `canDo(module,'create')` 收口，
  模板里**不补判据**（v311/v390 纪律：标题与显隐都从条目算出来）。
- ⚠️ **手机端曾刻意留空这段模板**（当时唯一带 `create` 的条目属底部栏 ⇒ 永不进抽屉）
  ⇒ 现在是**真能点到**的，不是死分支。
- 🔴 但「能点到」需要在**手机抽屉可滚**的前提下才成立 —— 见 `frontend-ui §v393`
  （`.md-sheet` 原本没有 `max-height`/`overflow`，顶部够不到）。

### 9.4 验收与部署判据

- 真机探针 `tools/v393-nav-entry-e2e.mjs` **32/32**（五相位，含 P4 反例、P5 零写入运行时取证）。
- 静态探针 `tools/v393-inventory-nav-entry-probe.mjs`（**PASS 39 / FAIL 0**；
  用 `SHELL_PATH` 指向改动前的 `Shell.vue` 跑 ⇒ **26 / 13**，判别力自证）。
- 落点自检 = 公网 `https://hergent.cn/` 入口 chunk 名 ＋ 新 chunk 200；
  **`/admin/` 是 `alias /opt/hergent-admin/` 的另一份历史前端，与 cn-v2 无关**。
- 🔴 **本轮踩到**：hash 两级级联让 **38 个 chunk 改名**，只传「入口 + 我改的两个」
  ⇒ 页面动态 import 全 404（curl 同 URL 却 200）⇒ **必须整包上传** →
  `deploy-ops.md §6`。

---

## 10. UI 规范范式与三类重复件欠账（v394 批次 6.4）

**唯一权威文档 = `hergent-cn-v2/docs/UI-SPEC.md`**（⚠️ **不是**仓根的 `docs/UI-SPEC.md`），
代码层唯一权威 = `src/styles/variables.css`；两者不一致 ⇒ **以 variables.css 为准，并立即回头改文档**。
v394 新增 **§8 业务模块范式（参考实现：进销存）** ⇒ 进销存八页从此是**全站新模块的抄写模板**；
本节是它在 memory 侧的索引。

### 10.1 容器 + 三件套（§8.1 六条容器规则）

`InventoryShell.vue` = 容器（**自己就是 `.page page-default`，不给子页再套一层**）；
子页 = 列表 / 新建 / 详情（**下钻页不挂页签**）。

| # | 规则 |
|---|---|
| 1 | 容器的类就是 `.page`，子页不再套一层 |
| 2 | 页签由**路径**推导（`tabFromPath(p)`）⇒ 刷新/深链/前进后退自洽，**不存 state** |
| 3 | 下钻页（详情）不挂页签 |
| 4 | `path:''` 索引子路由**必需**（否则 `/inventory` 空白） |
| 5 | 父级**禁自指** `redirect`（`redirect` 指回父路径 ⇒ 循环） |
| 6 | `:id` 路由必排 `new` 之后（`purchase/new` 须先注册） |

### 10.2 页面前缀分配（§8.2）

| 页 | 前缀 | 页 | 前缀 |
|---|---|---|---|
| `InvWorkbench` | `iw-` | `InvSaleList` | `isl-` |
| `InvPurchaseList` | `ip-` | `InvSaleNew` | `isn-` |
| `InvPurchaseNew` | `ipn-` | `InvSaleDetail` | `isd-` |
| `InvPurchaseDetail` | `ipd-` | `InvStock` | `is-` |
| 跨页 / 容器级 | `inv-` | | |

🔴 **前缀冲突实例**：`.is-acts` 被 `InvSaleList` 与 `InvStock` **各定义一次** —— 两者都是
**scoped** ⇒ **既不报错也不互相覆盖**，正是 §6.2「同一视觉语言不写第二份」的**静默漂移形态**；
**它不会自己暴露**，只能靠类差集扫出来。

### 10.3 状态与文案纪律（§8.3）

- **词表唯一源 = `src/constants/psiLabels.js`**（`PO_STATUS`/`SO_STATUS`/`DELIVERY_STATUS`/`ORDER_TYPE`/`EXPIRY_STATUS`）；
  界面**只走** `textOf(map, v, fallback)` + `tagOf(map, v)` ⇒ **禁英文枚举直出**（v339 第四类病灶）。
- `textOf` 的兜底是中文「未知」而**不是空串** ⇒ **未知值不静默留空**。
- **阈值（30/90 天等）由后端给，前端不写死。**
- **`fmtMoney` 唯一实现**（也在 `psiLabels.js`）⇒ 见 §六：模板调它而 script 漏 import
  ⇒ **整页崩 + 父页签一起消失**（v392b）。

### 10.4 三类重复件欠账（§8.4，**只登记、未整改**）

| 应为全局类 | 处数 | 共同实现 | 出现在 |
|---|---|---|---|
| `.page-acts`（页头右侧操作区） | **9 处 / 8 名** | `display:flex;gap:8px;flex-wrap:wrap`（**7 处逐字相同**；`.iw-acts` 多 `align-items:center`；`.pa-actions` 是 `gap:10px`） | 进销存 8 页（`.is-acts` 被两页各定义一次）＋ `ProductArchive.vue` |
| `.page-pager`（列表分页条） | **3** | 三份**逐字相同** | `.ip-page` / `.isl-page` / `.is-page` |
| `.page-filter`（筛选容器） | **3** | 三份**逐字相同** | `.ip-filter` / `.isl-filter` / `.is-filter` |

🔴 **新增判据**：**同一选择器的定义在站内出现 ≥3 次（且逐字相同）⇒ 必须上提为全局类**；
仅 2 次且未来可能分化 ⇒ 可暂缓，但须在上述表格登记。
⚠️ 整改面 = **8 个页面 + 全站共享层** ⇒ **另立批次**，不要塞进业务改动里同批上。

⚠️ **规范自身的一处已知欠账**（同批修掉的另一处）：§3.2 的通用示例原先写 `pa-actions`，
而 `pa-` 是**商品档案的页面前缀**、定义只在 `ProductArchive.vue` 的 scoped 里
⇒ **规范示例自己违反了 §6.3**，现已改为占位符 `XX-acts`。

### 10.5 403 探针的判据（自 `MEMORY.md §三` 下沉）

**403 必须读 `error_code`，不能只看状态码** —— 同一个 403 背后至少有四种闸门：

| `error_code` | 意义 |
|---|---|
| `MODULE_DENIED` | 模块 / 能力闸门拒绝（进销存 = `inventory`；业务员实测即此码 —— **是模块拒绝，不是只读闸门**） |
| `READONLY_TENANT` | 演示租户**只读**闸门拒绝 |
| `TENANT_FORBIDDEN` | 跨租户拒绝 |
| `UNAUTHENTICATED`（401） | 未登录（认证中间件**先于路由**返回） |

🔴 **「同码 = 零判别力」**：被拒场景与对照场景返回**同一个** `error_code` ⇒
该探针**什么也没证明**。两处实证：① 越权探针 `POST /api/users/999890/password`
在演示租户恒回 `READONLY_TENANT` ⇒ 连续多日**判据失效**（被只读闸门拦下，不再证明越权防守）；
② 匿名请求打到**不存在**的端点**同样回 401**（鉴权中间件先于路由）⇒ 用它判「端点存不存在」零判别力。

---

## v404 · 采购单详情页三页签（端点 17 → 20）

**新增三条端点**（`server/routers/psi.py`）：

| 方法 | 路径 | 语义 |
|---|---|---|
| GET | `/api/psi/purchase-orders/{oid}/payments` | 应付 + 付款流水（聚合） |
| POST | `/api/psi/purchase-orders/{oid}/payments` | **登记付款**（写；期间门禁 + 防超付） |
| GET | `/api/psi/purchase-orders/{oid}/inbound` | 入库单（**派生视图，不建表**） |

### 🔴 应付行（`receivables`）的真相 —— 生产只有「没有」这一态
- `receivables` 共 **181 行**，其中 **`ref_type='purchase'` = 0 行**。
- 应付行**唯一生成点** = `purchases.py:358`（在 `purchase_order_confirm` 内）。
- ⇒ 舟谱导入的历史单（`CD…` 前缀，79 张）**只有表头、零明细、从没走过 confirm** ⇒ 永远没有应付行。
- ⇒ 「货款」页签在真实数据上**只能看到「无应付」这一态**；要真正用起来，得让新单走 `confirm`
  （或给历史单补应付行）。**这是产品级待办，不是 bug**。
- 所以「无应付」**必须**与「已结清」区分：`ap_amount = None` ⇒ 界面 `—`；
  文案说「这张单没有对应的应付单，不用登记付款。」，**不许**说「已经结清」。

### 🔴 为什么自建 `purchase_payment_create`，不复用 `fi.payment_create`
`fi.payment_create` 的 `ref_id` 语义是 **`receivables.id`（应收/应付表的行号）**，
**不是业务单据号** ⇒ 传采购单 id 会**改到另一张应收行**，且**零报错**。
⇒ 应付行一律用 **`type='ap' AND ref_type='purchase' AND ref_id=<采购单id>`** 定位。

`purchase_payment_create` 五条安全性质（缺一不可）：
1. `amount > 0`
2. **防超付**（`amount <= ap_unpaid`）
3. **期间门禁**（`check_period_open`）
4. **三处同步**：`receivables(ap).paid_amount/status` → `purchase_orders.paid_amount` → `cash_flow`
5. **无应付行直接拒**（不静默创建）

凭证：`auto_journal_for_payment(pid, db_conn=db)` ⇒ 借 2202 / 贷 1002。

### 🔴 `check_period_open` 的 import 与 check **必须分开写**
`purchase_order_confirm` 里二者裹在同一 `try` ⇒ **关账被拒会被当成 import 失败吞掉**。
钱的操作不能这样 —— 关账回执必须原样透出（实测回执：`{'error': '会计期间 2026-10 已关闭，无法操作'}`）。

### 🔴 修掉的恒真静默 bug：`received_qty` 从不落库
- `purchase_order_confirm` **从不写 `received_qty`**（只有 `purchase_order_partial_receive` 会写）
  ⇒ **整单全收后 `status='received'` 而每行 `received_qty` 仍是 0**。
- 消费方 `ap_invoices` 的收货匹配用 `SUM(poi.received_qty * unit_price)` ⇒ **发票永远匹配不上**
  （静默、恒定、零报错）。`procurement_planner._get_on_order_qty` 按 `status` 过滤，**不受影响**。
- 修法：整单全收时 `UPDATE purchase_order_items SET received_qty = quantity WHERE id = ?`。
- 改前核扰动面：生产 `received_qty>0` **0 行** / `ap_invoices` **0 行** ⇒ 零扰动。

### 🔴 入库单 = 派生视图（不建表）
- `inbound_orders` 相关两张表**存在但空（0 行）且无任何指向采购单的列** ⇒ 无法关联。
- 入库单号由**源单号派生**：`CD260628000002` → `RK260628000002`；返回 `derived: true`。
- `empty` 专指「**还没有入库单**」（≠ 没有明细行）：
  - 草稿单 ⇒ `{empty: true, reason: '这张单还是草稿，没有入库单。', status, order_no}`
  - 已入库单 ⇒ `empty: false` + `head`（含派生单号）+ `items`（可能为空数组）
- 不存在的单 ⇒ **404**（`{ok:false, detail:'订单不存在', code:404}`）。

### 单位回退链（`poi.unit` 生产大量为空串）
新增**不重名**投影，原 `unit` 键保持不动：
```sql
COALESCE(NULLIF(poi.unit,''), p.unit, '') AS unit_label
```
⚠️ `sqlite3.Row["unit"]` 取**第一个**同名列（即 `poi.unit`）—— 所以投影**必须换名**，
不能直接写成 `AS unit`。

### 内部 id 不许流到界面
`operator_id` / `creator_name` / `operator_name` 一律经 `_creator_names` 解析成姓名
（读**主库** `users`；`users` 与 `hr_employees` 是**两套编号**，不可代用）。
反例自证纪律：**反例也要先核实、不能凭印象挑** —— 第一版挑 `psi_list_purchase_orders`，
而它**也**调了 `_creator_names`（v403 加创建人列时接的）⇒ **假红**；改用 `psi_meta`。

### 验收
`v404-shadow-verify.py` **103 PASS / 0 FAIL**（7 Phase）—— 含 Phase 1「不加列不建表」
（列数与列名集合与改动前**完全一致**）、Phase 5 **相位反转**（Phase 0 断言在改动后必须失败）、
Phase 6 AST 接线断言。真机只读 `v404-probe.mjs` **51/0**。

---

## 采购订单对标舟谱（只读分析，2026-10-08）

交付：`outputs/采购订单对标舟谱-差异清单与优化建议-2026-10-08.md`
（15 张舟谱截图 vs 我方三页前端 + 两后端文件；✅34 / ⚠️9 / ❌17）。

 🔴 **假入口（必修）**：侧栏「采购退货单」`create.to` = `/inventory/purchase/new?kind=return`
（`hergent-cn-v2/src/components/Shell.vue:395-396`），但 `InvPurchaseNew.vue` **只读 `copy`、不读 `kind`**
⇒ 「新建采购退货单」建出**普通采购单**；而退货单列表按 `status='returned'` 过滤 ⇒ 永远看不到它。
**通用判据：`create.to` 里的 query 必须被目标页真的读走，否则「入口」是假的**（与 v390/393
「无 path 闸门 ⇒ 整区冒给不该看的人」同族：都要验「跳过去之后真的对吗」）。

 🔴 **退货台账分叉**：`erp_db.py:5205 purchase_return_create` 建 `purchase_returns` 行 +
`inventory_adjust(-qty)` + 冲减 AP，**但不回写 `purchase_orders.status`**（全后端无
`SET status='returned'`）⇒ 「已退货」页签恒 0、详情「已到货」仍显示全收。
旧接口 `server.py:2936 POST /api/purchase-returns` **可用**，缺的是新前端入口 + 状态回写。
⚠️ 部分退货落 `returned` 还是 `partial` 是**产品口径问题，改之前必须先确认**。

**列差**：舟谱 29 列 vs 我方 17 列。缺 请购单号 / 经办人 / 部门 / 单据来源 / 入库时间 / 创建时间 /
审核人 / 最后操作·打印人时。**最大 UI 缺口 = 列设置**（显示隐藏 + 冻结 + 拖动排序 + 恢复默认）——
可复用 `Forecast.vue` 的列配置范式（`UI-SPEC §8`；`v400-spec-colcfg-consistency.py` 已把它写成规范）。
**已有承接、加列即可用**：`departments` 表（`erp_db.py:2441`）、`users.department_id`（`:2405`）、
`contacts.code`（`:2393` 供应商编码）、`contacts.supplier_category`（`:2400`）。
**加列范式照 v403**：`_safe_migrate` 与**租户列同步**（`erp_db.py:812-816` ↔ `:1189-1193`）**两处都要 patch**。

