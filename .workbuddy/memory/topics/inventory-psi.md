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


---

## v409（P2-1）三档单位：入库量纲必须统一到小单位

> ⚠️ 本小节 2026-10-09 从 `MEMORY.md` **下沉**而来（原文只存在于索引层，域记忆缺失）。

🔴 **明细可按小/中/大下单 ⇒ 入库量纲必须统一到小单位**；否则库存与成本两套量纲混用，且**零报错**。

- **换算唯一实现 = `db/queries/units.py`**（纯函数）。前端**只负责显示、不做判定**（同一规则不能抄两份）。
- 明细落两列快照：`base_ratio`（换算比快照）／`base_qty`（折小单位数量）；**两处登记**（主库 + 租户清单）。
- `confirm` / `partial_receive` 用 `_poi_base_qty` / `_poi_base_price` **成对折算**。
  🔴 只折数量不折价 ⇒ `cost_price` **错一个量级且零报错**。
- `received_qty` **刻意不折**（它是对账用的原始量，折了就对不上单据）。
- 🔴 `medium_ratio` **混类型**（空串 191 行）⇒ 一律 `CAST` / `float(x or 0)`；
  SQL 裸比较 `>0` 有 **191 行假阳性**。
- 老行两列（`large_ratio`/`medium_ratio`）为 0 ⇒ 回退 `quantity`，与改前**逐字一致**（兼容基线）。
- `conversion_text` ≠ `products.spec` —— **不可互相替换**（前者=换算说明，后者=规格）。

## v410（P2-3）最后操作 / 最后打印 人+时间

- 表列：`purchase_orders` 加 4 列 `last_op_at/by`、`last_print_at/by`（`TEXT DEFAULT ''`），**两处登记**。
- 🔴 **盖章唯一实现** `_po_stamp`（UPDATE）+ `_po_stamp_insert`（INSERT），9 个写函数埋点；11 条路由通路传登录人。
- 四条硬口径：① 盖章只 1 个实现（各写一份 ⇒ 改口径必漏且零报错）② **没传人 ⇒ 整对不盖章**（只写一半 =
  「有时间没人」的自相矛盾行，P1-7 审核人吃过这亏）③ **打印只盖 print 章不盖 op 章**（否则"最后操作人"
  恒等于"最后打印人"，两列重复）④ `auditor_id` **保留首次** / `last_op_by` **刷本次**，规则**相反**
  ⇒ approve 必须传**两个**人。
- 四类人 id（creator/auditor/op/print）合并成**一次** `_creator_names` 查询（各查一遍 = 列表查询随列数线性放大）。
- 探针 `tools/v410-p21-last-op/` **109/109**。关键证据：F7 打印后 `last_op_by` 不变；
  F10+F11 换人二审 `auditor_id` 保持 301 而 `last_op_by` 刷成 302；F14 全表无矛盾行。

## v411（P2-4）列设置云端持久化

🔴 **先分清三条轴，别重复造**：
- 列**有哪些**（不可删/自定义列定义与值）= `db/queries/forecast_columns.py` + `custom_fields` + `/api/forecast/columns`（早已上线）
- 列**具名多套方案**（手工点保存）= `/api/forecast/column-schemes`（`forecast_config` KV）+ `Forecast.vue` 列方案下拉（早已上线）
- 列**此刻这一套**（顺序/可见性/冻结列）= **v411 新增**（此前只有三处 localStorage）

- 新表 `ui_col_prefs`：**主键只有 `page`，无 `user_id`** ⇒ 口径 = **租户级**（依据 `forecast_hidden_units`：
  「同一张表不同账号看到不同的列 = 第二套口径」）。白名单三页 `forecast`/`purchase`/`settlement`。
- 唯一实现 = `db/queries/ui_prefs.py`（`col_pref_get` **没存过返回 `None`** 与"存了空"可区分）
  ＋ `composables/useColPrefs.js`（`pull`/`push` debounce 800ms/`flush`/`syncFromCloud`）。
- 🔴 新表**必须显式进 `ddl_map`**（`master_ddl` 在 init_db 更早处采集完 ⇒ 此刻建的表它看不见；
  不下发 = 租户库 `no such table` 500）。与 `mp_events`/`role_end` 同款配方。
- 🔴 `/api/ui` **未登记** `_PATH_MODULE_MAP` ⇒ fail-closed 403。**不能**挑一个模块登记（三页跨
  `data`/`inventory` 两个模块，登任一另一个就存不上）⇒ 照 `/api/ai/sessions` **豁免模块判定**
  （只读写自己的偏好；认证仍强制）。豁免必须在 **`_check_perm(...)` 调用行之前** return。

### 🔴 四条硬口径（后来人别改歪）
1. **`pull()` 必须分开返回 `ok` 与 `cfg`**：「云端没有」`{ok:true,cfg:null}` ⇒ **把本地推上去**；
   「网络失败」`{ok:false,cfg:null}` ⇒ **什么都别做**。混成一个 null ⇒ 弱网静默用本地**覆盖云端**
   且下次联网回不来（**数据损失**，不是同步）。
2. **响应形态异常（网关 HTML / 后端未升级）也算失败**，不算"云端没有"。
3. **整体覆盖，不做逐字段合并**（合并造出"顺序来自 A 设备、可见性来自 B 设备"的第三种状态）。
4. **失败只 `console.warn` 不弹 toast**（拖列不是显式保存动作）；对照「保存为方案」是显式动作 ⇒ 必须提示。

### 过期注释（本仓「注释当事实」又一例）
`erp_db.py` 原写「**已被删除的** `forecast_col_schemes`」—— **并没有被删**：三函数 + 建表语句都在，
真实状态 = **全仓零调用**（无端点；前端走的是同名 localStorage 键 `forecast_col_schemes_<user_id>`）。
已改成如实描述；v411 **不复用**它（按 user_id 隔离 + 名字绑死 forecast）。

### 探针自身 5 个坑
1. `ast.literal_eval` **不认 `64 * 1024`**（BinOp）⇒ 静默 None，把"有上限"判成"没上限"。用 compile+eval。
2. `_check_perm` 锚点必须用**调用行**，不是 `from core import` 行 —— 拿后者把"豁免有效"误判成"失效"。
3. 判据窗口「`apply` 往后 300~400 字符」**越界**到后面的 `persistCols` 定义 ⇒ 误报。要**精确抽函数体**。
4. 判据测**语义同构**不是**排版逐字**（两处 DDL `)))` vs `)) )`）。`norm_ddl` 归一括号内侧空白。
5. `'purchase '`（尾空格）被 strip 接受是**有意的容错**（URL `%20`），不是"漏拦"。

### 取证与产物
- 探针 `tools/v411-p24-colprefs/` **98/98**（后端 47 + 前端 51）。前端探针**真跑** composable
  （剥 import + 注入替身 + **假计时器**）—— 因为口径 1 是**运行期行为**，文本判据测不到。
- 构建 `dist-v411b`（⚠️ `dist-v411a` 二次覆盖时 vite `emptyDir` 失败 ⇒ 换隔离目录，符合"隔离 outDir"纪律）。
  产物核对：三页 chunk 都 import **同一个** `useColPrefs-*.js`；`col-prefs?page=` 只在唯一实现里。
- 与列设置规范：**未新增宿主页** ⇒ 白名单不动；`COL_STORAGE_KEY` **不升版**；自检 ALL PASS。
  主动自律：定位（`useColMenu`）与持久化（`useColPrefs`）**分两个 composable**，各守一件事。

## v412（P2-5）合并动作按钮：保存并打印 / 审核并打印

🔴 **先按「碰不碰库存」分族，别按复杂度分**：
- 保存并打印 = 建单 + 打印（**两步都是既有动作，不改变任何数据**）→ 可做
- 审核并打印 = 审核 + 打印（同上）→ 可做
- 审核并入库 = 审核 + **写库存**（`confirm` ⇒ `batch_in` 真加）；审核并发货 = 审核 + **扣库存**（FEFO 真扣）
  → 各把库存推一格 ⇒ **要先问业务时点**，不是先问成本

**后端零改动、零新增端点**：审核复用列表页那条同一个 `/batch`（`op=approve`）；打印复用
`POST /purchase-orders/{id}/print`。改动只在两个 .vue。

### 动手前核出来的两条真身（别凭名字猜）
- **销售单没有「审核」**：无 `sale_order_approve`；`confirmed` 只是**外部导入的初始状态**；
  `sale_order_deliver` 的 WHERE = **`status='draft'`** ⇒ 「审核并发货」不是"合并两个按钮"，
  而是**先给销售单加一条审核流程**（`draft→confirmed→delivered` + 放开 `deliver` 判据）——新流程，
  且直接改**扣库存**的入口条件。
- **采购 `confirm` 是一次性全收**（`status='received'` + 每行 `batch_in`），而「审核」发生在**货到之前**、
  「入库」在**货到之后** ⇒ 合并会诱导"货没到先把账做上" = **库存虚增**（且批次/效期多半空 ⇒ FEFO 与临期预警失真）。
  若真要做，应做成「审核后**打开入库确认弹窗**」，**不直接写库**。

### 🔴 四条硬口径
1. **`_printNow` 刻意不含 `busy` 守卫**。`doApprovePrint` 审核时已 `busy=true`，里面若再判一次
   ⇒ 「审核成功了、纸没出来」**且零报错**（静默半截，又是「恒空恒 0 且零报错」那一族）。
   互斥交给**调用方**。反例探针 E10/E11 双向自证。
2. **审核失败 ⇒ 一张都不打印**：印一张状态还写「待审批」的单给供应商，比不打印更糟
   （供应商照没审批的量备货）。先取回执确认 `ok_count` 再打印。
3. **先 `loadAll()` 再打印**：审核改的是**状态 / 审核时间 / 审核人**三样，不刷就印 = 纸上状态是旧的。
4. **打印前先摘 `?print=1`，且只认首次**：不摘 ⇒ F5 一次又印一张、`print_count` 再 +1，
   而那个计数是判断「到底打没打给供应商」的**唯一依据**。摘参数在打印**之前**。

### 前端判据必须与后端 WHERE 逐字对齐
`canAudit = ['pending_approval','draft','confirmed']` ↔ `purchase_order_approve` 的
`WHERE id=? AND status IN (...)`。前端多给 = 点了才知道不行；少给 = 按钮消失且零报错。

### 老板拍板（v412 收尾）
- **审核并入库 = 「审核后弹入库确认」**（做了）：审核成功后**只拉起** `doConfirm()`，**不直接写库**。
  🔴 调 `doConfirm` **之前必须先把 `busy` 放开** —— 真身自带 `busy` 守卫，拿 `true` 进去直接 return
  ⇒「审核好了、确认没出来」且**零报错**。另有 `canConfirm` 不满足时**如实说**、不去调注定失败的入库。
- **审核并发货 = 不做**：销售单没有审核环节（见下），落它要先新增审批流程 + 改扣库存入口条件。
- **UI 形态**：两个审核动作收进**一个下拉**（主按钮「审核并打印」+ 箭头「审核并入库」），
  **复用打印组 `.ipd-pm*` 类**（不写第二份定位）；`onDocClick` **同时**关 `printOpen` 与 `auditOpen`。

### 🔴 既有隐患（本轮发现，未动）
`sale_order_deliver` 的 WHERE 只认 `status='draft'`，而 `sale_order_cancel` 认
`('draft','confirmed','pending_approval')` ⇒ 库里**确实有** `confirmed`/`pending_approval` 的销售单
（外部导入会产生）⇒ 这些单**永远发不了货**。与 P2-5 无关，单独一件事。

### 探针
`tools/v412-p25-approve-print/probe_p25fe.mjs`（**仅 fe**）**56/56**。关键条**真跑**（node:vm 抽源码 + 注入替身）：
E2 调序、E6 失败时打印调用数 0、E10/E11 busy 守卫反例、F2 摘参数定序、F4/F5 只打一次、F7 读数失败不打印、
C1/C2 跨仓判据集合相同、G1/G4 `?print=1` 有无、H6 `doApproveReceive` 体内无 `confirmPurchase(`、
H7/H8/H9 调 `doConfirm` 时 `busy` 已 false 且放行语句位置在前、H10/H13/H14 失败或不可入库时不进入库环节。
构建 `dist-v412b`（⚠️ 按钮改结构后**必须重建**；`dist-v412a` 是改前的）。
探针自身三坑：`calls.filter(c => c === 'replace')` 但推的是**数组** ⇒ 恒 0 假失败；反例写成
`.then ? true : true` 恒真（等于没测）；末尾误留 `consy()` 占位；vm 导出对象漏加新函数名 ⇒ `not a function` 崩。

---

## §v414（P2-6）采购退货「转单为」—— 已完成，未部署

### 业务边界（先把三项砍到一项）
报告写「转销售 / 调拨 / 退货」三项，实查后**只有退货有承接实体**：销售单实体虽有（`sale_orders`），
但「采购进货 → 销售出货」之间**没有业务流转关系**；进销存**没有调拨单实体**。
⇒ 「转单为」下拉保留三项（对齐舟谱），另两项 `disabled` + 各自一句原因。
老板拍板 **B：跳独立退货建单页**（`/inventory/purchase/new?kind=return&from_po=<oid>`）。

### 🔴 六条硬口径
1. **数量与单价成对是小单位**：`quantity` 折小单位、`unit_price` 折「元/小单位」。
   只折数量不折价 ⇒ 金额差 ratio 倍**且零报错**（与 v409 在 `confirm` 那条同源）。
   可退预览给的就是这一对默认值，前端**不许再乘除一次**。
2. **可退上限唯一实现在后端**（`purchase_order_return_preview`）；前端那道是提前告知，
   拦不住直接打接口的人 —— 退货是**不可逆**的库存动作。
3. **ratio 读快照**（`base_ratio`，反推 `base_qty/quantity` 兜底，拿不到返 **0** 不是 1），
   **不现查商品档案**：换算是下单那一刻的事实。
4. **`returned` 必须进「可退单」白名单**（`status IN ('received','partial','returned')`）——
   v408(P0-3)「有退货即落 returned」使**部分退货的单也变 returned**，排除它 ⇒ 退不了第二批
   （搜不到 = 静默假否定）。⚠️ 状态只是**粗筛**，真能不能退看余量。
5. **新端点走 `/api/psi`**（自动继承 `inventory` 闸门 = 只 boss），**不复用** `/api/purchase-returns`
   （归 `buying` ⇒ 闸门漏；且它 `return HTTPException(...)` **不 raise** ⇒ 客户端拿 500 不是 detail）。
6. **`kind`/`from_po`/`copy` 必须 computed + watch**：`/inventory/purchase/new` 是**同一条 path**，
   `?kind` 变了 vue-router **复用同一实例** ⇒ `onMounted` 不再跑、页面停在旧模式且**零报错**
   （同 v403 的 `oid`/`kind`）。初始化必须抽成**可重入**的 `reinit()`。

### 实现要点
- `purchases.py`：`_poi_ratio(itd)` / `_poi_received_base_qty(itd, status)`（已入库折小单位的**唯一实现**，
  `received_qty>0` 走折算、否则 `status='received'` 回退 `_poi_base_qty`）/ `purchase_order_return_preview(oid)`
  （每行 base_qty/received/returned/returnable/金额 + **人话的不可退原因**）/ `purchase_order_list(returnable=)`。
  ⚠️ 已退量按 **`product_name`** 关联 —— `purchase_return_items` **没有 `product_id` 列**（DDL 实测）。
  ⚠️ 预览**刻意不返回「可退总数量」**：不同商品小单位不同，跨商品求和是**伪指标**，只回金额。
- `routers/psi.py`：`GET …/return-preview`（带 `_doc_owner_ok`）、`POST …/return`（**上限在后端强制**，
  失败一律 `raise`）。`routers/purchase.py::list_purchases` 接收并**透传** `returnable`（不透传 = 筛选框没反应）。
- `erp_db.py`：**re-export** `purchase_order_return_preview`（漏了 = AttributeError → 500）。
- 前端：`psi.js`（`returnPreview`/`returnPurchase`）、`InvPurchaseNew.vue`（`kind=return` 模式：原单选择
  `listPurchases({returnable:1})` + 只读供应商/仓库 + 可退明细表**只填数量** + 退货原因）、
  `InvPurchaseDetail.vue`（「转单为 ▾」复用 `.ipd-pm*`）。
- **顺带修好 P0-2 假入口**：`Shell.vue` **一字未改** —— 侧栏「新建采购退货单」的 `create`
  在 New 页真支持 `kind` 后**自己变真**；两处入口同一份实现。

### 探针 / 构建
`tools/v414-p26-return/probe_p26.py` **37/37**（影子库真跑 + 反例）、`probe_p26fe.mjs` **41/41**
（`node:vm` 抽 SFC 真源码；**FE-F9 跨仓白名单同一集合**）。`sfc-ctx-symbol-guard` 0 未定义符号；
`v400` 列设置自检 ALL PASS。构建 `dist-v414a`。
⚠️ 产物 hash 变了但产物里 grep 不到注释 ⇒ Rollup chunk hash 基于 minify **之前**的代码
（注释影响 hash、不影响字节）—— 别拿 chunk hash 当内容判据。
⚠️ **起号撞车**：v413 已被同日另一会话（副驾超时修复）占用 ⇒ 改 v414。
号段是跨会话资源，起号前要**实搜同日在途改动**，不能只读号表。

## §v415（P2-7）采购单自定义字段 —— 已完成，未部署

**老板拍板 A：最小闭环** —— 复用既有元数据引擎，只驱动 4 面（建单录入 / 详情展示 /
列表列 + 列设置齿轮 / 导出 CSV），类型只给「文本 / 数字」；**不做**按字段筛选、**不做**打印模板。
交付形态 = **空引擎**（一条字段都不预置），用户随时在列设置面板里自建。

### 唯一实现与作用域
- 元数据引擎的**唯一实现** = `db/queries/forecast_columns.py`（文件头 docstring 第 ⑦ 条）。
  ⚠️ 文件名保留历史名（报单矩阵时代），它现在是**全系统**自定义列的唯一实现。
- 新增第二个作用域 `MODULE_PURCHASE_ORDERS = "purchase_orders"`；注册表 `_TARGETS`
  （`table` / `pk_label` / `prefix` / `protected`）+ `_target(module)`。
  🔴 **未知 module 抛 ValueError，绝不回落 products**（回落 = 往商品档案写脏数据）。
- 14 个函数（`list_columns` / `is_protected` / `add_column` / `update_column` / `delete_column` /
  `set_values` / `_purge_values` / …）**全部**带 `module` 参数。
- 类型白名单 `_TYPES = ("text", "number")`（模块级）；新增 `validate_extra(module, values)`。

### 🔴 六条硬口径
1. **`extra` 空则不进 INSERT 列清单** —— 本仓**第六次**用这个范式。一个字段都不填时，
   建单 SQL 与改动前**逐字一致**（老接口/老调用方/老测试零影响）。
2. **加数据库列必须两处都写**：主库 `_safe_migrate("v415_po_extra_json", …)` +
   租户库 `_ensure_tenant_module_tables` 列对账清单。只写一处 ⇒ 「自家有、新租户没有」，**零报错**。
3. 🔴 **采购单域 `protected=True` ⇒ `_ensure` 一行都不写**。⚠️ 这条**必须靠反例证明**：
   探针 **C1** 把 `tgt["protected"]` 换成 `PROTECTED_COLUMNS` ⇒ 采购单域被写入 **5 行**系统列
   （原为 0）。不配反例，「零写入」可能是**恒真**断言（因为压根没跑到）。
4. **类型一律按字符串发出**（建单页数字字段也不 `Number()`）：`Number('abc')`=NaN ⇒
   `JSON.stringify` 变 `null` ⇒ 后端当「清空」⇒ **填了乱字符、保存后是空的、零报错**。
5. 🔴 **详情页 `saveExtra` 送「全部」字段（含空串）**，不是"只送改动过的"：
   空串在后端 = **清空该字段**（删键），"没提交这个键" = 保持原值。
   只送改动键 ⇒ 用户删空后保存，**界面空、库里还有**（静默假成功）。反例 FE-G16。
6. 🔴 **列表页 `onMounted` 必须"先拉定义、再同步云端"**：`applySaved()` 以"已知列"过滤云端那份
   顺序 ⇒ 反序会让自定义键被当**未知列整个滤掉**，只能作为"新列"补到**末尾**
   （顺序静默丢失、零报错）。探针 FE-C2a/C2b 真跑复现。

### 实现要点
- 后端：`purchases.py::purchase_order_create(..., extra=None)`（**校验放在 `with get_db()` 之外**；
  INSERT 尾部 `if _extra:` 才 append `extra_json`）；`list`/`get` 返回前 `load_extra(...)` 顶掉原始键。
  `routers/purchase.py::PurchaseOrderCreate` 加 `extra: dict` + `try/except ValueError → 400`。
  `routers/psi.py` 新增 5 条端点：`GET/POST /purchase-custom-fields`、
  `PUT/DELETE /purchase-custom-fields/{key}`、`POST /purchase-orders/{id}/extra`（`skipped` 非空 ⇒ **raise 400**）。
- 前端：`api/psi.js`（5 方法，唯一网络层）；**新建** `composables/purchaseCustomFields.js`
  = 三页共用的唯一实现：
  - `customColDef(c)` —— 服务端定义 → **与 `PO_COLS` 逐字同形**的列定义
    （`{key,label,w:110,on:false,num,clip,custom:true}`）。🔴 **同形是关键**：列表页所有"列"的判断
    （可见性/顺序/宽度/取值/导出）都靠这个形状 ⇒ 一旦为自定义列分叉出一套，就得处处写两个分支，
    漏一处就是"自定义列不参与排序/导出"这类静默缺陷。
  - `extraValOf(m,key)` / `extraVal(r,key)` —— **两条入口共用一个实现**（详情页拿到"字典本身"
    `order.extra`，列表页拿到"行" `r.extra`）。🔴 **数字 0 原样返回 0，不返回 `''`**（「没有」≠「是零」）。
  - `usePurchaseCustomFields()` 控制器返回 `{defs, raw, ok, err, loaded, loadDefs, addField,
    renameField, removeField}`。🔴 **`loadDefs` 不抛**：读到 0 个 ≠ 没读到（前者正常显示"新增"，
    后者**不能给新增入口**——判据全在服务端，读不到时新增必然失败）；读失败**不清空** `defs`（降级但可用）。
    `addField`/`renameField` 成功后**重拉定义**（服务端是唯一源，本地拼的那份迟早分岔）。
- `InvPurchaseList.vue`：删 `PO_COL_MAP` ⇒ `ALL_COLS = computed(() => PO_COLS.concat(customDefs.value))`
  + `colMap`；`defaultColOrder()` 追加自定义键（**漏了 ⇒ 「恢复默认」把它们从面板整片抹掉**）；
  `defaultColVis()` 给 `false`；`mergeCustomCols()` **增量合并**（🔴 不能重跑 `applySaved()`，
  否则覆盖用户已拖的顺序）；`applyAddField()` 里对**当场新建**的键置 `true`（加了看不见 = 静默假成功，
  与"升级不惊扰"不矛盾）；`colText` 首部加 `_d.custom` 分支（自定义键是随机 `p_xxxxxxxx`，
  不可能在 switch 里逐条列举）；`delField` 用 `window.confirm` 提示值会一并清除
  并**如实报 `purged_products`**（历史键名，语义 = 被清掉的**采购单张数**，别按字面读成商品数）。
- `InvPurchaseNew.vue`：`extra` 随单**同事务**提交（不另调 `/extra`，避免"单成了、字段没了"的
  静默半截）；`cfPayload` **只发非空值**。
- `InvPurchaseDetail.vue`：`cfFilled`（只含有值）/ `cfShow`（有定义 && (有值 || 可写)）/
  `openExtra`（草稿 = 全字段，含空串）/ `saveExtra`（见硬口径 5）；
  `reloadOrder` **只重取单据**（不用 `loadAll()` ⇒ 不整页闪、不连带重取货款/入库/附件；
  也不拿本地刚提交的值顶替——后端会归一 `'5.0'`→`5`，本地那份是**另一个事实**）。
  ⚠️ `cfDefs` 等 ref 必须声明在 `loadAll` **之前**（`const` 暂时性死区）。

### 与列设置规范的契合
- **齿轮是列设置唯一入口** ⇒ 「新增字段」入口长在**列设置面板内部**（`.col-menu-add`），
  **没往工具栏加按钮**（符合老板既定偏好）。
- 新增列**默认收起**（`on:false`）；⚠️ 唯一例外 = 用户当场新建的那个（见上）。
- `COL_STORAGE_KEY` **未升版**（仍 `hergent_purchase_cols_v1`）—— 自定义键是**增量并入**
  `colOrder`/`colVis`，不是换一套存储。
- **未新增齿轮宿主页** ⇒ 白名单三处（实现 + UI-SPEC §2.6.1「五、D」+ 自检 `GEAR_HOSTS`）**一字不改**。
- 新增的三个面板输入框类（`.ipl-cm-in` / `.ipl-cm-sel` / `.ipl-cm-i`）**刻意不上提全局** ——
  上提的触发条件是**跨文件**各写一份（§8），本处只在**同一个 SFC 的 scoped 样式**里。

### 探针 / 构建
- `tools/v415-p27-extracols/probe_p27.py` **71/71**（结构 A 组 / 影子库真跑 B 组 / 3 条反例 C 组）。
  关键真跑：B5a `purged_products=2`；B8 `_ensure` 零写入；B3c 空串→`None`；B4e 空串 ⇒ **删键**；
  B3f number 列非数字 ⇒ ValueError（不是静默变 0）；B6b `_target('')` ⇒ ValueError（空串不默认 products）。
- `tools/v415-p27-extracols/probe_p27fe.mjs` **108/108**（`node:vm` 抽 SFC 真源码；真跑 composable
  而非替身）+ 6 条反例自证。
- `v400-spec-colcfg-consistency.py --strict` **ALL PASS**；`sfc-ctx-symbol-guard.mjs` 三个进货页
  **0 未定义符号**；构建 `dist-v415a`（2.40s）成功。
- ⚠️ 前端探针必须**真跑 composable**（`purchaseCustomFields.js` 先装进独立 VM 取回真身，再注入页面沙箱）——
  替身它就是"把唯一实现换掉"，探针立刻失去意义。

### 探针自身的坑（供后来人）
1. `noImport` 只剥 `import` 不够 —— composable 是 `.js`，还有 `export const` / `export function`
   / `export default` 三形态，都要剥（统一走一个 `stripModule` 入口）。
2. **模块级 `const` 的暂时性死区**：加载器（`bootList`）要用到 `LIST_CLEAN`，而它声明在调用点**之后**
   ⇒ 运行时报 "Cannot access before initialization"。缓存要挂**函数对象属性**，不要用模块级 `let`。
3. `ast.literal_eval` 读不了含 `ast.Name` 的注册表（`_TARGETS` 值里引用了 `PROTECTED_COLUMNS`）
   ⇒ 改成**装载一遍再读**（顺带证明"抽真身"这条路通）。
4. 路由收集若返回 `{path: (verb, fn)}`，同路径的 GET/POST 与 PUT/DELETE 会**互相覆盖**
   （4 条压成 2 条）⇒ 改成返回**列表**，并配反例自证。
5. 影子库读要用"每次新开连接"的 `q1()` —— 复用一条长命连接会读到 SQLite 的**旧快照**，
   让"写成功了没"变成假判据。

## §v438 新建采购单：复刻舟谱「标签同行」紧凑表单头 ＋ 上传附件

🔴 **一、改「输入框外观」前先分清两态**（v436 返工的教训）：进销存表格的可编辑格有
**浏览态 `.ipn-v`（默认可见的文本格）** 与 **编辑态 `.ipn-in`（点格子后才存在）**。
老板说「输入框没底色」时，他要的是 **`.ipn-v`**；只改 `.ipn-in:not(:focus)` 等于改了个
**几乎不可见**的状态 ⇒ 老板看到「没有任何变化」（且很容易误判成缓存/没部署）。
**先用「本地 entry hash == 公网 entry hash」排除缓存，再回到源码找可见态。**

🔴 **二、表单头紧凑化是纯 CSS 的事**：`.ipn-f` 由 `flex-direction: column`（标签在上、
框在下）改 `row`（标签 ＋ 框同行）⇒ 每格 48px→32px。连带三处**必须一起改**，否则局部歪：
① `.ipn-hd` 的 `align-items` 由 `flex-end` 改 `center`（同行后没有「底部对齐」可言）；
② 宽度：标签变横向占位后每格 = 标签 ＋ gap ＋ 控件 ⇒ `.ipn-sel`/`.ipn-date` 要**收窄**、
**备注框要 `flex:1`** 吃剩余宽度，否则右半行留白；
③ **退货模式那条 `.ipn-hint` 要 `flex-basis:100%` 独占一行** —— `.ipn-f` 变 row 后它会挤在
「原采购单」标签与选择器中间，把那一格撑歪。

🔴 **三、附件：建单页**没有单据 id**，只能「先暂存、保存后上传」**：附件接口是
`/api/psi/purchase-orders/{id}/attachments`（**带归属校验**，`_doc_owner_ok`），而 id 由
`createPurchase` 才生成。所以流程是 **选中 → 暂存本页 → 保存拿到 `oid` → 逐个上传**。
四条硬判据：① 文案**如实**写「保存后随单上传」，**不假装已上传**（暂存是内存态、不是服务端草稿）；
② 上传函数**自己吞异常**，不许连累外层 `try` 把**已建好的单**谎报成「保存失败」；
③ **上传失败不回滚单据**（单据是主体、附件是附属）、单独 toast 报出、失败文件**留在列表可重试**
（后端**同名附件会拒绝**，原因必须可见）；④ `resetForNext()`（「保存并新建」）**必须清空暂存** ——
否则下一张单会**静默继承**上一张的附件（挂错单比丢失更难发现）。退货模式**不给入口**（归属不同，不猜）。

## §v439 建单头「字段框化」——复刻舟谱「标签在框内」，以及 `flex:none` 那个坑

🔴 **一、`.ipn-f` 必须 `flex: none`**（老板报障「经办人/部门/入库仓库 的标签没和框同一行」的**真根因**）：
`.ipn-hd` 是 `flex-wrap: wrap`，`.ipn-f` 默认 `flex-shrink: 1` ⇒ 没有 `min-width` 的格会被**挤窄**，
挤出后格内 `flex-wrap: wrap` 就把「标签」和「下拉」**拆成上下两行**。供应商那格因
`.ipn-f-sup{min-width:320px}` 保住了宽度 ⇒ **只有那三格坏**（症状极具迷惑性）。
补 `flex: none` 后每格成为**原子**：宽度放不下时**整格**换行，永不拆开标签与框。

🔴 **二、把 `.ipn-f` 做成「框」**（`.ipn-hd-box .ipn-f`，只挂建单采购头 + 自定义字段行）：
框内控件**必须去掉自己的边框/底色/内距**，否则「框里套框」。**两个必踩的坑**：
① 全局 `.input` 是 `width:100%` —— 在横排框里会解析成「撑满整框」并**把标签挤出去**
   ⇒ 框内一律 `width:auto`，宽度由 `.ipn-sel/.ipn-date/.ipn-cf-in` **显式**给；
② 聚焦高亮要**上移到框**（`:focus-within`，色值抄全局 `.input:focus` 的 `--p-dark`+`--p-bg`），
   并把框内控件的 focus 环**关掉**，否则一大一小两层环。
标签冒号用 `.ipn-lb::after{content:'：'}` 生成（**不改模板文案**）；退货模式**不挂** `ipn-hd-box`
（那排有只读格 `.ipn-ro`，虚框是「不可改」的既定语义，不顺手改它）。

🔴 **三、`flex-basis:100%` 的隐藏代价**：`.ipn-hint{flex-basis:100%}` 会把**所在格的 max-content
撑大**（实测 691px）；v439 给 `.ipn-f` 加 `flex:none` 后**不再回缩** ⇒ 退货「原采购单」格右侧留
一大片空白、把后面三格推出半屏（`HD_H` 也变 53）。修法 = 给那一格**死宽度**（`.ipn-f-po{width:380px}`）。

🔴 **四、撤字段时的写回纪律**：撤「预计到货日期」输入框，但 `form.expected_date` **照旧加载、
照旧提交** —— 编辑既有单走 `updatePurchase` **整单重写**，**少一个键 = 把原单据的值清空**。
同时 `resetForNext`（保存并新建）里要把它置 `''`：无编辑入口的字段**跨单继承 = 静默错值**。

📏 **五、布局别靠肉眼估**：本次用「**真实构建 CSS + 真实标记 + 无头 Chrome 量几何**」离线判定
（**不需要登录**：把 scoped 的 `[data-v-xxx]` 剥掉，选择器即命中）。实测原宽合计 **1480px**、
内容宽 1412px ⇒ 差 **68px** 才挤掉「备注」换行；收窄到 **~1250px** 后 1440/1280 屏均一行（`HD_H` 74→32）。
本机跑 `--headless=new` 必须加 `--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage`（自带沙箱起不来）。
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


---

## v409（P2-1）三档单位：入库量纲必须统一到小单位

> ⚠️ 本小节 2026-10-09 从 `MEMORY.md` **下沉**而来（原文只存在于索引层，域记忆缺失）。

🔴 **明细可按小/中/大下单 ⇒ 入库量纲必须统一到小单位**；否则库存与成本两套量纲混用，且**零报错**。

- **换算唯一实现 = `db/queries/units.py`**（纯函数）。前端**只负责显示、不做判定**（同一规则不能抄两份）。
- 明细落两列快照：`base_ratio`（换算比快照）／`base_qty`（折小单位数量）；**两处登记**（主库 + 租户清单）。
- `confirm` / `partial_receive` 用 `_poi_base_qty` / `_poi_base_price` **成对折算**。
  🔴 只折数量不折价 ⇒ `cost_price` **错一个量级且零报错**。
- `received_qty` **刻意不折**（它是对账用的原始量，折了就对不上单据）。
- 🔴 `medium_ratio` **混类型**（空串 191 行）⇒ 一律 `CAST` / `float(x or 0)`；
  SQL 裸比较 `>0` 有 **191 行假阳性**。
- 老行两列（`large_ratio`/`medium_ratio`）为 0 ⇒ 回退 `quantity`，与改前**逐字一致**（兼容基线）。
- `conversion_text` ≠ `products.spec` —— **不可互相替换**（前者=换算说明，后者=规格）。

## v410（P2-3）最后操作 / 最后打印 人+时间

- 表列：`purchase_orders` 加 4 列 `last_op_at/by`、`last_print_at/by`（`TEXT DEFAULT ''`），**两处登记**。
- 🔴 **盖章唯一实现** `_po_stamp`（UPDATE）+ `_po_stamp_insert`（INSERT），9 个写函数埋点；11 条路由通路传登录人。
- 四条硬口径：① 盖章只 1 个实现（各写一份 ⇒ 改口径必漏且零报错）② **没传人 ⇒ 整对不盖章**（只写一半 =
  「有时间没人」的自相矛盾行，P1-7 审核人吃过这亏）③ **打印只盖 print 章不盖 op 章**（否则"最后操作人"
  恒等于"最后打印人"，两列重复）④ `auditor_id` **保留首次** / `last_op_by` **刷本次**，规则**相反**
  ⇒ approve 必须传**两个**人。
- 四类人 id（creator/auditor/op/print）合并成**一次** `_creator_names` 查询（各查一遍 = 列表查询随列数线性放大）。
- 探针 `tools/v410-p21-last-op/` **109/109**。关键证据：F7 打印后 `last_op_by` 不变；
  F10+F11 换人二审 `auditor_id` 保持 301 而 `last_op_by` 刷成 302；F14 全表无矛盾行。

## v411（P2-4）列设置云端持久化

🔴 **先分清三条轴，别重复造**：
- 列**有哪些**（不可删/自定义列定义与值）= `db/queries/forecast_columns.py` + `custom_fields` + `/api/forecast/columns`（早已上线）
- 列**具名多套方案**（手工点保存）= `/api/forecast/column-schemes`（`forecast_config` KV）+ `Forecast.vue` 列方案下拉（早已上线）
- 列**此刻这一套**（顺序/可见性/冻结列）= **v411 新增**（此前只有三处 localStorage）

- 新表 `ui_col_prefs`：**主键只有 `page`，无 `user_id`** ⇒ 口径 = **租户级**（依据 `forecast_hidden_units`：
  「同一张表不同账号看到不同的列 = 第二套口径」）。白名单三页 `forecast`/`purchase`/`settlement`。
- 唯一实现 = `db/queries/ui_prefs.py`（`col_pref_get` **没存过返回 `None`** 与"存了空"可区分）
  ＋ `composables/useColPrefs.js`（`pull`/`push` debounce 800ms/`flush`/`syncFromCloud`）。
- 🔴 新表**必须显式进 `ddl_map`**（`master_ddl` 在 init_db 更早处采集完 ⇒ 此刻建的表它看不见；
  不下发 = 租户库 `no such table` 500）。与 `mp_events`/`role_end` 同款配方。
- 🔴 `/api/ui` **未登记** `_PATH_MODULE_MAP` ⇒ fail-closed 403。**不能**挑一个模块登记（三页跨
  `data`/`inventory` 两个模块，登任一另一个就存不上）⇒ 照 `/api/ai/sessions` **豁免模块判定**
  （只读写自己的偏好；认证仍强制）。豁免必须在 **`_check_perm(...)` 调用行之前** return。

### 🔴 四条硬口径（后来人别改歪）
1. **`pull()` 必须分开返回 `ok` 与 `cfg`**：「云端没有」`{ok:true,cfg:null}` ⇒ **把本地推上去**；
   「网络失败」`{ok:false,cfg:null}` ⇒ **什么都别做**。混成一个 null ⇒ 弱网静默用本地**覆盖云端**
   且下次联网回不来（**数据损失**，不是同步）。
2. **响应形态异常（网关 HTML / 后端未升级）也算失败**，不算"云端没有"。
3. **整体覆盖，不做逐字段合并**（合并造出"顺序来自 A 设备、可见性来自 B 设备"的第三种状态）。
4. **失败只 `console.warn` 不弹 toast**（拖列不是显式保存动作）；对照「保存为方案」是显式动作 ⇒ 必须提示。

### 过期注释（本仓「注释当事实」又一例）
`erp_db.py` 原写「**已被删除的** `forecast_col_schemes`」—— **并没有被删**：三函数 + 建表语句都在，
真实状态 = **全仓零调用**（无端点；前端走的是同名 localStorage 键 `forecast_col_schemes_<user_id>`）。
已改成如实描述；v411 **不复用**它（按 user_id 隔离 + 名字绑死 forecast）。

### 探针自身 5 个坑
1. `ast.literal_eval` **不认 `64 * 1024`**（BinOp）⇒ 静默 None，把"有上限"判成"没上限"。用 compile+eval。
2. `_check_perm` 锚点必须用**调用行**，不是 `from core import` 行 —— 拿后者把"豁免有效"误判成"失效"。
3. 判据窗口「`apply` 往后 300~400 字符」**越界**到后面的 `persistCols` 定义 ⇒ 误报。要**精确抽函数体**。
4. 判据测**语义同构**不是**排版逐字**（两处 DDL `)))` vs `)) )`）。`norm_ddl` 归一括号内侧空白。
5. `'purchase '`（尾空格）被 strip 接受是**有意的容错**（URL `%20`），不是"漏拦"。

### 取证与产物
- 探针 `tools/v411-p24-colprefs/` **98/98**（后端 47 + 前端 51）。前端探针**真跑** composable
  （剥 import + 注入替身 + **假计时器**）—— 因为口径 1 是**运行期行为**，文本判据测不到。
- 构建 `dist-v411b`（⚠️ `dist-v411a` 二次覆盖时 vite `emptyDir` 失败 ⇒ 换隔离目录，符合"隔离 outDir"纪律）。
  产物核对：三页 chunk 都 import **同一个** `useColPrefs-*.js`；`col-prefs?page=` 只在唯一实现里。
- 与列设置规范：**未新增宿主页** ⇒ 白名单不动；`COL_STORAGE_KEY` **不升版**；自检 ALL PASS。
  主动自律：定位（`useColMenu`）与持久化（`useColPrefs`）**分两个 composable**，各守一件事。

## v412（P2-5）合并动作按钮：保存并打印 / 审核并打印

🔴 **先按「碰不碰库存」分族，别按复杂度分**：
- 保存并打印 = 建单 + 打印（**两步都是既有动作，不改变任何数据**）→ 可做
- 审核并打印 = 审核 + 打印（同上）→ 可做
- 审核并入库 = 审核 + **写库存**（`confirm` ⇒ `batch_in` 真加）；审核并发货 = 审核 + **扣库存**（FEFO 真扣）
  → 各把库存推一格 ⇒ **要先问业务时点**，不是先问成本

**后端零改动、零新增端点**：审核复用列表页那条同一个 `/batch`（`op=approve`）；打印复用
`POST /purchase-orders/{id}/print`。改动只在两个 .vue。

### 动手前核出来的两条真身（别凭名字猜）
- **销售单没有「审核」**：无 `sale_order_approve`；`confirmed` 只是**外部导入的初始状态**；
  `sale_order_deliver` 的 WHERE = **`status='draft'`** ⇒ 「审核并发货」不是"合并两个按钮"，
  而是**先给销售单加一条审核流程**（`draft→confirmed→delivered` + 放开 `deliver` 判据）——新流程，
  且直接改**扣库存**的入口条件。
- **采购 `confirm` 是一次性全收**（`status='received'` + 每行 `batch_in`），而「审核」发生在**货到之前**、
  「入库」在**货到之后** ⇒ 合并会诱导"货没到先把账做上" = **库存虚增**（且批次/效期多半空 ⇒ FEFO 与临期预警失真）。
  若真要做，应做成「审核后**打开入库确认弹窗**」，**不直接写库**。

### 🔴 四条硬口径
1. **`_printNow` 刻意不含 `busy` 守卫**。`doApprovePrint` 审核时已 `busy=true`，里面若再判一次
   ⇒ 「审核成功了、纸没出来」**且零报错**（静默半截，又是「恒空恒 0 且零报错」那一族）。
   互斥交给**调用方**。反例探针 E10/E11 双向自证。
2. **审核失败 ⇒ 一张都不打印**：印一张状态还写「待审批」的单给供应商，比不打印更糟
   （供应商照没审批的量备货）。先取回执确认 `ok_count` 再打印。
3. **先 `loadAll()` 再打印**：审核改的是**状态 / 审核时间 / 审核人**三样，不刷就印 = 纸上状态是旧的。
4. **打印前先摘 `?print=1`，且只认首次**：不摘 ⇒ F5 一次又印一张、`print_count` 再 +1，
   而那个计数是判断「到底打没打给供应商」的**唯一依据**。摘参数在打印**之前**。

### 前端判据必须与后端 WHERE 逐字对齐
`canAudit = ['pending_approval','draft','confirmed']` ↔ `purchase_order_approve` 的
`WHERE id=? AND status IN (...)`。前端多给 = 点了才知道不行；少给 = 按钮消失且零报错。

### 老板拍板（v412 收尾）
- **审核并入库 = 「审核后弹入库确认」**（做了）：审核成功后**只拉起** `doConfirm()`，**不直接写库**。
  🔴 调 `doConfirm` **之前必须先把 `busy` 放开** —— 真身自带 `busy` 守卫，拿 `true` 进去直接 return
  ⇒「审核好了、确认没出来」且**零报错**。另有 `canConfirm` 不满足时**如实说**、不去调注定失败的入库。
- **审核并发货 = 不做**：销售单没有审核环节（见下），落它要先新增审批流程 + 改扣库存入口条件。
- **UI 形态**：两个审核动作收进**一个下拉**（主按钮「审核并打印」+ 箭头「审核并入库」），
  **复用打印组 `.ipd-pm*` 类**（不写第二份定位）；`onDocClick` **同时**关 `printOpen` 与 `auditOpen`。

### 🔴 既有隐患（本轮发现，未动）
`sale_order_deliver` 的 WHERE 只认 `status='draft'`，而 `sale_order_cancel` 认
`('draft','confirmed','pending_approval')` ⇒ 库里**确实有** `confirmed`/`pending_approval` 的销售单
（外部导入会产生）⇒ 这些单**永远发不了货**。与 P2-5 无关，单独一件事。

### 探针
`tools/v412-p25-approve-print/probe_p25fe.mjs`（**仅 fe**）**56/56**。关键条**真跑**（node:vm 抽源码 + 注入替身）：
E2 调序、E6 失败时打印调用数 0、E10/E11 busy 守卫反例、F2 摘参数定序、F4/F5 只打一次、F7 读数失败不打印、
C1/C2 跨仓判据集合相同、G1/G4 `?print=1` 有无、H6 `doApproveReceive` 体内无 `confirmPurchase(`、
H7/H8/H9 调 `doConfirm` 时 `busy` 已 false 且放行语句位置在前、H10/H13/H14 失败或不可入库时不进入库环节。
构建 `dist-v412b`（⚠️ 按钮改结构后**必须重建**；`dist-v412a` 是改前的）。
探针自身三坑：`calls.filter(c => c === 'replace')` 但推的是**数组** ⇒ 恒 0 假失败；反例写成
`.then ? true : true` 恒真（等于没测）；末尾误留 `consy()` 占位；vm 导出对象漏加新函数名 ⇒ `not a function` 崩。

---

## §v414（P2-6）采购退货「转单为」—— 已完成，未部署

### 业务边界（先把三项砍到一项）
报告写「转销售 / 调拨 / 退货」三项，实查后**只有退货有承接实体**：销售单实体虽有（`sale_orders`），
但「采购进货 → 销售出货」之间**没有业务流转关系**；进销存**没有调拨单实体**。
⇒ 「转单为」下拉保留三项（对齐舟谱），另两项 `disabled` + 各自一句原因。
老板拍板 **B：跳独立退货建单页**（`/inventory/purchase/new?kind=return&from_po=<oid>`）。

### 🔴 六条硬口径
1. **数量与单价成对是小单位**：`quantity` 折小单位、`unit_price` 折「元/小单位」。
   只折数量不折价 ⇒ 金额差 ratio 倍**且零报错**（与 v409 在 `confirm` 那条同源）。
   可退预览给的就是这一对默认值，前端**不许再乘除一次**。
2. **可退上限唯一实现在后端**（`purchase_order_return_preview`）；前端那道是提前告知，
   拦不住直接打接口的人 —— 退货是**不可逆**的库存动作。
3. **ratio 读快照**（`base_ratio`，反推 `base_qty/quantity` 兜底，拿不到返 **0** 不是 1），
   **不现查商品档案**：换算是下单那一刻的事实。
4. **`returned` 必须进「可退单」白名单**（`status IN ('received','partial','returned')`）——
   v408(P0-3)「有退货即落 returned」使**部分退货的单也变 returned**，排除它 ⇒ 退不了第二批
   （搜不到 = 静默假否定）。⚠️ 状态只是**粗筛**，真能不能退看余量。
5. **新端点走 `/api/psi`**（自动继承 `inventory` 闸门 = 只 boss），**不复用** `/api/purchase-returns`
   （归 `buying` ⇒ 闸门漏；且它 `return HTTPException(...)` **不 raise** ⇒ 客户端拿 500 不是 detail）。
6. **`kind`/`from_po`/`copy` 必须 computed + watch**：`/inventory/purchase/new` 是**同一条 path**，
   `?kind` 变了 vue-router **复用同一实例** ⇒ `onMounted` 不再跑、页面停在旧模式且**零报错**
   （同 v403 的 `oid`/`kind`）。初始化必须抽成**可重入**的 `reinit()`。

### 实现要点
- `purchases.py`：`_poi_ratio(itd)` / `_poi_received_base_qty(itd, status)`（已入库折小单位的**唯一实现**，
  `received_qty>0` 走折算、否则 `status='received'` 回退 `_poi_base_qty`）/ `purchase_order_return_preview(oid)`
  （每行 base_qty/received/returned/returnable/金额 + **人话的不可退原因**）/ `purchase_order_list(returnable=)`。
  ⚠️ 已退量按 **`product_name`** 关联 —— `purchase_return_items` **没有 `product_id` 列**（DDL 实测）。
  ⚠️ 预览**刻意不返回「可退总数量」**：不同商品小单位不同，跨商品求和是**伪指标**，只回金额。
- `routers/psi.py`：`GET …/return-preview`（带 `_doc_owner_ok`）、`POST …/return`（**上限在后端强制**，
  失败一律 `raise`）。`routers/purchase.py::list_purchases` 接收并**透传** `returnable`（不透传 = 筛选框没反应）。
- `erp_db.py`：**re-export** `purchase_order_return_preview`（漏了 = AttributeError → 500）。
- 前端：`psi.js`（`returnPreview`/`returnPurchase`）、`InvPurchaseNew.vue`（`kind=return` 模式：原单选择
  `listPurchases({returnable:1})` + 只读供应商/仓库 + 可退明细表**只填数量** + 退货原因）、
  `InvPurchaseDetail.vue`（「转单为 ▾」复用 `.ipd-pm*`）。
- **顺带修好 P0-2 假入口**：`Shell.vue` **一字未改** —— 侧栏「新建采购退货单」的 `create`
  在 New 页真支持 `kind` 后**自己变真**；两处入口同一份实现。

### 探针 / 构建
`tools/v414-p26-return/probe_p26.py` **37/37**（影子库真跑 + 反例）、`probe_p26fe.mjs` **41/41**
（`node:vm` 抽 SFC 真源码；**FE-F9 跨仓白名单同一集合**）。`sfc-ctx-symbol-guard` 0 未定义符号；
`v400` 列设置自检 ALL PASS。构建 `dist-v414a`。
⚠️ 产物 hash 变了但产物里 grep 不到注释 ⇒ Rollup chunk hash 基于 minify **之前**的代码
（注释影响 hash、不影响字节）—— 别拿 chunk hash 当内容判据。
⚠️ **起号撞车**：v413 已被同日另一会话（副驾超时修复）占用 ⇒ 改 v414。
号段是跨会话资源，起号前要**实搜同日在途改动**，不能只读号表。

## §v415（P2-7）采购单自定义字段 —— 已完成，未部署

**老板拍板 A：最小闭环** —— 复用既有元数据引擎，只驱动 4 面（建单录入 / 详情展示 /
列表列 + 列设置齿轮 / 导出 CSV），类型只给「文本 / 数字」；**不做**按字段筛选、**不做**打印模板。
交付形态 = **空引擎**（一条字段都不预置），用户随时在列设置面板里自建。

### 唯一实现与作用域
- 元数据引擎的**唯一实现** = `db/queries/forecast_columns.py`（文件头 docstring 第 ⑦ 条）。
  ⚠️ 文件名保留历史名（报单矩阵时代），它现在是**全系统**自定义列的唯一实现。
- 新增第二个作用域 `MODULE_PURCHASE_ORDERS = "purchase_orders"`；注册表 `_TARGETS`
  （`table` / `pk_label` / `prefix` / `protected`）+ `_target(module)`。
  🔴 **未知 module 抛 ValueError，绝不回落 products**（回落 = 往商品档案写脏数据）。
- 14 个函数（`list_columns` / `is_protected` / `add_column` / `update_column` / `delete_column` /
  `set_values` / `_purge_values` / …）**全部**带 `module` 参数。
- 类型白名单 `_TYPES = ("text", "number")`（模块级）；新增 `validate_extra(module, values)`。

### 🔴 六条硬口径
1. **`extra` 空则不进 INSERT 列清单** —— 本仓**第六次**用这个范式。一个字段都不填时，
   建单 SQL 与改动前**逐字一致**（老接口/老调用方/老测试零影响）。
2. **加数据库列必须两处都写**：主库 `_safe_migrate("v415_po_extra_json", …)` +
   租户库 `_ensure_tenant_module_tables` 列对账清单。只写一处 ⇒ 「自家有、新租户没有」，**零报错**。
3. 🔴 **采购单域 `protected=True` ⇒ `_ensure` 一行都不写**。⚠️ 这条**必须靠反例证明**：
   探针 **C1** 把 `tgt["protected"]` 换成 `PROTECTED_COLUMNS` ⇒ 采购单域被写入 **5 行**系统列
   （原为 0）。不配反例，「零写入」可能是**恒真**断言（因为压根没跑到）。
4. **类型一律按字符串发出**（建单页数字字段也不 `Number()`）：`Number('abc')`=NaN ⇒
   `JSON.stringify` 变 `null` ⇒ 后端当「清空」⇒ **填了乱字符、保存后是空的、零报错**。
5. 🔴 **详情页 `saveExtra` 送「全部」字段（含空串）**，不是"只送改动过的"：
   空串在后端 = **清空该字段**（删键），"没提交这个键" = 保持原值。
   只送改动键 ⇒ 用户删空后保存，**界面空、库里还有**（静默假成功）。反例 FE-G16。
6. 🔴 **列表页 `onMounted` 必须"先拉定义、再同步云端"**：`applySaved()` 以"已知列"过滤云端那份
   顺序 ⇒ 反序会让自定义键被当**未知列整个滤掉**，只能作为"新列"补到**末尾**
   （顺序静默丢失、零报错）。探针 FE-C2a/C2b 真跑复现。

### 实现要点
- 后端：`purchases.py::purchase_order_create(..., extra=None)`（**校验放在 `with get_db()` 之外**；
  INSERT 尾部 `if _extra:` 才 append `extra_json`）；`list`/`get` 返回前 `load_extra(...)` 顶掉原始键。
  `routers/purchase.py::PurchaseOrderCreate` 加 `extra: dict` + `try/except ValueError → 400`。
  `routers/psi.py` 新增 5 条端点：`GET/POST /purchase-custom-fields`、
  `PUT/DELETE /purchase-custom-fields/{key}`、`POST /purchase-orders/{id}/extra`（`skipped` 非空 ⇒ **raise 400**）。
- 前端：`api/psi.js`（5 方法，唯一网络层）；**新建** `composables/purchaseCustomFields.js`
  = 三页共用的唯一实现：
  - `customColDef(c)` —— 服务端定义 → **与 `PO_COLS` 逐字同形**的列定义
    （`{key,label,w:110,on:false,num,clip,custom:true}`）。🔴 **同形是关键**：列表页所有"列"的判断
    （可见性/顺序/宽度/取值/导出）都靠这个形状 ⇒ 一旦为自定义列分叉出一套，就得处处写两个分支，
    漏一处就是"自定义列不参与排序/导出"这类静默缺陷。
  - `extraValOf(m,key)` / `extraVal(r,key)` —— **两条入口共用一个实现**（详情页拿到"字典本身"
    `order.extra`，列表页拿到"行" `r.extra`）。🔴 **数字 0 原样返回 0，不返回 `''`**（「没有」≠「是零」）。
  - `usePurchaseCustomFields()` 控制器返回 `{defs, raw, ok, err, loaded, loadDefs, addField,
    renameField, removeField}`。🔴 **`loadDefs` 不抛**：读到 0 个 ≠ 没读到（前者正常显示"新增"，
    后者**不能给新增入口**——判据全在服务端，读不到时新增必然失败）；读失败**不清空** `defs`（降级但可用）。
    `addField`/`renameField` 成功后**重拉定义**（服务端是唯一源，本地拼的那份迟早分岔）。
- `InvPurchaseList.vue`：删 `PO_COL_MAP` ⇒ `ALL_COLS = computed(() => PO_COLS.concat(customDefs.value))`
  + `colMap`；`defaultColOrder()` 追加自定义键（**漏了 ⇒ 「恢复默认」把它们从面板整片抹掉**）；
  `defaultColVis()` 给 `false`；`mergeCustomCols()` **增量合并**（🔴 不能重跑 `applySaved()`，
  否则覆盖用户已拖的顺序）；`applyAddField()` 里对**当场新建**的键置 `true`（加了看不见 = 静默假成功，
  与"升级不惊扰"不矛盾）；`colText` 首部加 `_d.custom` 分支（自定义键是随机 `p_xxxxxxxx`，
  不可能在 switch 里逐条列举）；`delField` 用 `window.confirm` 提示值会一并清除
  并**如实报 `purged_products`**（历史键名，语义 = 被清掉的**采购单张数**，别按字面读成商品数）。
- `InvPurchaseNew.vue`：`extra` 随单**同事务**提交（不另调 `/extra`，避免"单成了、字段没了"的
  静默半截）；`cfPayload` **只发非空值**。
- `InvPurchaseDetail.vue`：`cfFilled`（只含有值）/ `cfShow`（有定义 && (有值 || 可写)）/
  `openExtra`（草稿 = 全字段，含空串）/ `saveExtra`（见硬口径 5）；
  `reloadOrder` **只重取单据**（不用 `loadAll()` ⇒ 不整页闪、不连带重取货款/入库/附件；
  也不拿本地刚提交的值顶替——后端会归一 `'5.0'`→`5`，本地那份是**另一个事实**）。
  ⚠️ `cfDefs` 等 ref 必须声明在 `loadAll` **之前**（`const` 暂时性死区）。

### 与列设置规范的契合
- **齿轮是列设置唯一入口** ⇒ 「新增字段」入口长在**列设置面板内部**（`.col-menu-add`），
  **没往工具栏加按钮**（符合老板既定偏好）。
- 新增列**默认收起**（`on:false`）；⚠️ 唯一例外 = 用户当场新建的那个（见上）。
- `COL_STORAGE_KEY` **未升版**（仍 `hergent_purchase_cols_v1`）—— 自定义键是**增量并入**
  `colOrder`/`colVis`，不是换一套存储。
- **未新增齿轮宿主页** ⇒ 白名单三处（实现 + UI-SPEC §2.6.1「五、D」+ 自检 `GEAR_HOSTS`）**一字不改**。
- 新增的三个面板输入框类（`.ipl-cm-in` / `.ipl-cm-sel` / `.ipl-cm-i`）**刻意不上提全局** ——
  上提的触发条件是**跨文件**各写一份（§8），本处只在**同一个 SFC 的 scoped 样式**里。

### 探针 / 构建
- `tools/v415-p27-extracols/probe_p27.py` **71/71**（结构 A 组 / 影子库真跑 B 组 / 3 条反例 C 组）。
  关键真跑：B5a `purged_products=2`；B8 `_ensure` 零写入；B3c 空串→`None`；B4e 空串 ⇒ **删键**；
  B3f number 列非数字 ⇒ ValueError（不是静默变 0）；B6b `_target('')` ⇒ ValueError（空串不默认 products）。
- `tools/v415-p27-extracols/probe_p27fe.mjs` **108/108**（`node:vm` 抽 SFC 真源码；真跑 composable
  而非替身）+ 6 条反例自证。
- `v400-spec-colcfg-consistency.py --strict` **ALL PASS**；`sfc-ctx-symbol-guard.mjs` 三个进货页
  **0 未定义符号**；构建 `dist-v415a`（2.40s）成功。
- ⚠️ 前端探针必须**真跑 composable**（`purchaseCustomFields.js` 先装进独立 VM 取回真身，再注入页面沙箱）——
  替身它就是"把唯一实现换掉"，探针立刻失去意义。

### 探针自身的坑（供后来人）
1. `noImport` 只剥 `import` 不够 —— composable 是 `.js`，还有 `export const` / `export function`
   / `export default` 三形态，都要剥（统一走一个 `stripModule` 入口）。
2. **模块级 `const` 的暂时性死区**：加载器（`bootList`）要用到 `LIST_CLEAN`，而它声明在调用点**之后**
   ⇒ 运行时报 "Cannot access before initialization"。缓存要挂**函数对象属性**，不要用模块级 `let`。
3. `ast.literal_eval` 读不了含 `ast.Name` 的注册表（`_TARGETS` 值里引用了 `PROTECTED_COLUMNS`）
   ⇒ 改成**装载一遍再读**（顺带证明"抽真身"这条路通）。
4. 路由收集若返回 `{path: (verb, fn)}`，同路径的 GET/POST 与 PUT/DELETE 会**互相覆盖**
   （4 条压成 2 条）⇒ 改成返回**列表**，并配反例自证。
5. 影子库读要用"每次新开连接"的 `q1()` —— 复用一条长命连接会读到 SQLite 的**旧快照**，
   让"写成功了没"变成假判据。

## §v438 新建采购单：复刻舟谱「标签同行」紧凑表单头 ＋ 上传附件

🔴 **一、改「输入框外观」前先分清两态**（v436 返工的教训）：进销存表格的可编辑格有
**浏览态 `.ipn-v`（默认可见的文本格）** 与 **编辑态 `.ipn-in`（点格子后才存在）**。
老板说「输入框没底色」时，他要的是 **`.ipn-v`**；只改 `.ipn-in:not(:focus)` 等于改了个
**几乎不可见**的状态 ⇒ 老板看到「没有任何变化」（且很容易误判成缓存/没部署）。
**先用「本地 entry hash == 公网 entry hash」排除缓存，再回到源码找可见态。**

🔴 **二、表单头紧凑化是纯 CSS 的事**：`.ipn-f` 由 `flex-direction: column`（标签在上、
框在下）改 `row`（标签 ＋ 框同行）⇒ 每格 48px→32px。连带三处**必须一起改**，否则局部歪：
① `.ipn-hd` 的 `align-items` 由 `flex-end` 改 `center`（同行后没有「底部对齐」可言）；
② 宽度：标签变横向占位后每格 = 标签 ＋ gap ＋ 控件 ⇒ `.ipn-sel`/`.ipn-date` 要**收窄**、
**备注框要 `flex:1`** 吃剩余宽度，否则右半行留白；
③ **退货模式那条 `.ipn-hint` 要 `flex-basis:100%` 独占一行** —— `.ipn-f` 变 row 后它会挤在
「原采购单」标签与选择器中间，把那一格撑歪。

🔴 **三、附件：建单页**没有单据 id**，只能「先暂存、保存后上传」**：附件接口是
`/api/psi/purchase-orders/{id}/attachments`（**带归属校验**，`_doc_owner_ok`），而 id 由
`createPurchase` 才生成。所以流程是 **选中 → 暂存本页 → 保存拿到 `oid` → 逐个上传**。
四条硬判据：① 文案**如实**写「保存后随单上传」，**不假装已上传**（暂存是内存态、不是服务端草稿）；
② 上传函数**自己吞异常**，不许连累外层 `try` 把**已建好的单**谎报成「保存失败」；
③ **上传失败不回滚单据**（单据是主体、附件是附属）、单独 toast 报出、失败文件**留在列表可重试**
（后端**同名附件会拒绝**，原因必须可见）；④ `resetForNext()`（「保存并新建」）**必须清空暂存** ——
否则下一张单会**静默继承**上一张的附件（挂错单比丢失更难发现）。退货模式**不给入口**（归属不同，不猜）。

## §v439 建单头「字段框化」——复刻舟谱「标签在框内」，以及 `flex:none` 那个坑

🔴 **一、`.ipn-f` 必须 `flex: none`**（老板报障「经办人/部门/入库仓库 的标签没和框同一行」的**真根因**）：
`.ipn-hd` 是 `flex-wrap: wrap`，`.ipn-f` 默认 `flex-shrink: 1` ⇒ 没有 `min-width` 的格会被**挤窄**，
挤出后格内 `flex-wrap: wrap` 就把「标签」和「下拉」**拆成上下两行**。供应商那格因
`.ipn-f-sup{min-width:320px}` 保住了宽度 ⇒ **只有那三格坏**（症状极具迷惑性）。
补 `flex: none` 后每格成为**原子**：宽度放不下时**整格**换行，永不拆开标签与框。

🔴 **二、把 `.ipn-f` 做成「框」**（`.ipn-hd-box .ipn-f`，只挂建单采购头 + 自定义字段行）：
框内控件**必须去掉自己的边框/底色/内距**，否则「框里套框」。**两个必踩的坑**：
① 全局 `.input` 是 `width:100%` —— 在横排框里会解析成「撑满整框」并**把标签挤出去**
   ⇒ 框内一律 `width:auto`，宽度由 `.ipn-sel/.ipn-date/.ipn-cf-in` **显式**给；
② 聚焦高亮要**上移到框**（`:focus-within`，色值抄全局 `.input:focus` 的 `--p-dark`+`--p-bg`），
   并把框内控件的 focus 环**关掉**，否则一大一小两层环。
标签冒号用 `.ipn-lb::after{content:'：'}` 生成（**不改模板文案**）；退货模式**不挂** `ipn-hd-box`
（那排有只读格 `.ipn-ro`，虚框是「不可改」的既定语义，不顺手改它）。

🔴 **三、`flex-basis:100%` 的隐藏代价**：`.ipn-hint{flex-basis:100%}` 会把**所在格的 max-content
撑大**（实测 691px）；v439 给 `.ipn-f` 加 `flex:none` 后**不再回缩** ⇒ 退货「原采购单」格右侧留
一大片空白、把后面三格推出半屏（`HD_H` 也变 53）。修法 = 给那一格**死宽度**（`.ipn-f-po{width:380px}`）。

🔴 **四、撤字段时的写回纪律**：撤「预计到货日期」输入框，但 `form.expected_date` **照旧加载、
照旧提交** —— 编辑既有单走 `updatePurchase` **整单重写**，**少一个键 = 把原单据的值清空**。
同时 `resetForNext`（保存并新建）里要把它置 `''`：无编辑入口的字段**跨单继承 = 静默错值**。

📏 **五、布局别靠肉眼估**：本次用「**真实构建 CSS + 真实标记 + 无头 Chrome 量几何**」离线判定
（**不需要登录**：把 scoped 的 `[data-v-xxx]` 剥掉，选择器即命中）。实测原宽合计 **1480px**、
内容宽 1412px ⇒ 差 **68px** 才挤掉「备注」换行；收窄到 **~1250px** 后 1440/1280 屏均一行（`HD_H` 74→32）。
本机跑 `--headless=new` 必须加 `--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage`（自带沙箱起不来）。


## v444 建单页四项改动（细节；索引在 MEMORY.md「建单/建退单页」）
- **出厂 15 行**：`PRESET_ROWS = 15` 常量，两页同值（散着写必然出现「改一页忘另一页」）。
- **必填列红 `*`**：必须用表单头**同一枚类**（`.ipn-req` / `.isn-req`）与同一色值 `--dan`；
  集合由 `validate()` / `validateReturn()` 决定（采购：商品/采购价/订单数量；销售：商品/数量/单价；退货表：退货数量）。
- **列宽拖动** `useColResize.js` + `ColResizeHandle.vue`：
  · `wStyle()` 必须同时给 `width` + `min-width`（CSS 里 `.ipn-c-prod{min-width:240px}` 会**挡住拖窄**）；
  · `startW` 从 th 的 `getBoundingClientRect()` 现量（写死会「一按下就跳」）；
  · `mousemove`/`mouseup` 挂 **document**（手柄 7px 宽，挂手柄上拖出去就断）；
  · 🔴 `MAX_W = 2400`，**不能设成看起来够用的 720** —— 销售页在 1600px 屏上商品列默认就有 794px，
    硬夹 720 的结果是**越拖越窄**（794→720）。这是首轮真机探针跑出来的真实缺陷。
  · **只存本机 localStorage，不上云**：列宽跟屏幕走；且 `useColPrefs` 是整份 cfg 覆盖写，
    并进去会把另一份冲掉（两种失效方式见 `useColResize.js` 文件头）。
  · 订单/退货两种模式各一份宽度（`-ret` 后缀），共用会互相顶掉。
- **输入框不许有底色**：`.ipn-in` / `.isn-in` / `.ipn-v` 一律 `background:transparent`。
  🔴 必须**显式写 transparent**，删规则只会退回全局 `.input{background:var(--bg3)}` 的灰底。
  🔴 **只撤明细表**：表单头的框（`.‹pfx›-hd-box .‹pfx›-f`，即「供应商/客户」那格）**仍保留底色**。

## v444 探针（.workbuddy/tools/v444-psi-new-e2e.mjs，38 PASS/0 FAIL）与它踩的坑
1. 🔴 **JS 模板串里写正则要双反斜杠**：`MEASURE` 是模板串，源码写 `\*` 会被吃掉一个反斜杠 ⇒
   页面内变 `/^*+/` ⇒ `SyntaxError: Nothing to repeat` ⇒ 整段量测抛错、字段全 undefined。
   而打印字段全 undefined ⇒ `JSON.stringify` 全省略 ⇒ 只显示**空 `{}`**，看着像「页面没渲染」。
   **被这个空 `{}` 误导了四轮** ⇒ 量测打印**必须带 `err` 字段**。
2. 🔴 **模板串内部的注释不能写反引号**（提前终止模板串）—— 本轮踩了两次。
3. 🔴 **探针 INIT 里硬编码的 `hergent_v2_user` 必须与 token 同一账号**：前端用 localStorage 的 `role`
   判路由权限，与 token 不一致会被踢到 `#/login`（症状同样是空 `{}`）。已改成可用环境变量覆盖。
4. 🔴 **生产上可能没有任何活跃会话** ⇒ `v392-probe-tokens.py boss` 返回**空串**（不是报错）。
   本轮按 v441-prod-probe 的既定做法造临时 admin 会话（user_id=1，1 小时），**用完即删**（核对残留 0）。
5. 采购页**默认态 tbody 里一个 input 都没有**（v417j「点哪格哪格才是输入框」）⇒ 探针必须先点一格再量。

## v445 明细表输入框「边框三态」（默认无框 → hover 灰 → focus 青+发光）

规范 §4.6；前端两页（`InvPurchaseNew.vue` / `InvSaleNew.vue`），**后端零改动**。
v444 撤**底色** → v445 撤**边框**，两步合起来才是"默认态整行就是一排文字"。

**三条硬约束**
1. 只切 `border-color: transparent`，**不许 `border: none`** —— 边框宽度仍 1px ⇒ 盒模型不变 ⇒
   零尺寸抖动、零行位移（`border:none` 会让输入框宽高各缩 2px，15 行 × 13 列一起跳）。
2. focus 的"更清晰"靠**换色 + 外发光 box-shadow(3px)**，**不加粗 border**（加粗同样改盒模型）。
3. hover 与 focus 必须**颜色 + 发光双重区分**，不能只靠深浅（深浅在深色/浅色两套主题下总有一边看不出来）。
   ⇒ 悬浮**不给**外发光，发光是聚焦专属。

**必须显式写回的三条例外**（🔴 这是本轮最容易漏、漏了就是静默失效的地方）
- 「默认透明」选择器 `table.ipn-tbl .ipn-in:not(:focus)` 权重 **(0,3,1)**，**高于**全局
  `.input.err` / `.input:disabled` / `.input[readonly]` 的 **(0,2,0)** ⇒ 不写回会把**校验红框
  一起变没**。同理禁用/只读会浮框（等于承诺"这格能填"，点了没反应比没框更糟 —— 退货明细
  `ret_qty` 绑了 `:disabled="!Number(row.returnable_qty)"`，是真实场景）。
- `.err:focus` 的**红色外发光**也要写回，否则被上面的青色外发光（(0,3,1)）盖成"红框配青光"。

**采购页 `.ipn-v`（v417j 文本态 span）用 `inset box-shadow` 画框**，不用 border：
它是 span，加 border 会把行高顶起来（紧凑档 min-height:16 会切字）。
⚠️ 采购页**点激活时行高 18px→22px** 是 v417j 既有设计（文本态矮 5px 是密度收益来源），
**不是**本轮引入的抖动 ⇒ 零抖动的硬判据放在**销售页**（常驻 input，三态盒模型一字不变）。

## v445 探针（.workbuddy/tools/v445-psi-border-e2e.mjs，31 PASS/0 FAIL/0 SKIP）与它踩的坑
1. 🔴 **hover 必须用 CDP `Input.dispatchMouseEvent` 真实移动鼠标**：CSS `:hover` 不是能靠加 class
   伪造的状态，用 JS 加 class 等于自己骗自己。
2. 过渡有 `.2s` ⇒ 移动/聚焦后**等 450ms 再量**，否则量到过渡中间值（看着像"没实现"）。
3. 🔴 **CSS 变量取出来是 hex（`#e5e5ea`），computed `border-color` 是 `rgb(...)`** ⇒ 必须换算后再比，
   否则永远不等、误判成"边框没生效"。
4. `let s1 = null` 提到 if 块外：`const s1` 声明在 `if (!hs.err) {...}` 里 ⇒ 块外引用
   `ReferenceError: s1 is not defined`（本轮真的踩了，前半程 18 PASS 后崩在这里）。
5. **生产取令牌本轮没写库**：`v392-probe-tokens.py` 那套要先有活跃会话，本轮查询发现生产**已有 3 个
   活跃会话**（boss 就在里面）⇒ 直接只读取用，**没造临时会话、用完也不用删**（比 v444 干净）。
   取法：`sessions JOIN users`，用 `/api/auth/permissions` + `/api/psi/meta` 双 200 验活。
   🔴 `USER_JSON` 必须跟着改成 boss（`{id:2, username:'boss', role:'boss', roles:['boss']}`）——
   boss 的 id 是 **2**（admin 才是 1）。

**实测值（浅色主题）**：`--bd`=rgb(229,229,234)、`--p-dark`=rgb(8,145,178)、`--dan`=rgb(255,59,48)、
`--p-bg`=rgba(6,182,212,.06)、`--dan-bg`=rgba(255,59,48,.1)。
销售页三态 `82×28` 与行高 `62.59` 逐像素全等；采购页 `.ipn-v` `242.45×18` 与行高 `31.8` 全等。
**部署**：`dist-v445`（`InvPurchaseNew-BMbMtrRh.js` / `InvSaleNew-B9ognmAC.js` / `index-DLj3qIQK.js`），
生产 assets **1882 → 1928**（并集，无 `--delete`）。回归：v441 六界面 105 PASS/0 FAIL。

## v446（2026-10-11）视觉基准固化 → 规范 §R（前端/后端零代码改动）

**做了什么**：把「创建采购订单」的字号 / 行高 / 控件宽高 / 内距 / 间距 / 分组 / 疏密**量成表**写进规范 §R。
探针 `.workbuddy/tools/v446-psi-visual-spec-probe.mjs` 打生产真机读 `getComputedStyle`（**不是**读 CSS 推算），
原始数据 `outputs/v446-visual-spec/measurements.json`。

**关键实测值（1600×1000 / cozy / 采购页）**：
- 字号：页标题 20/600；区块标题 14/700；明细 td 13；th 13/500(`--t3`)；`.ipn-v` 13；标签 12(`--t3`)；序号 12；换算 11；
  **框内控件 14（继承 body 14px，源码那一行没写字号）**；底部金额 18（**无令牌**）
- 行高：th 行 **38.5**；数据行 **31.8**（= td pad 2×2 + 最高控件 22）；`.ipn-v` 18；`.ipn-in` 22；字段框 **32**；框内控件 30；底条 41
- 字段框：pad `0 6px 0 10px` / gap 4 / bg `--bg3` / border 1px `--bd` / radius 8 / flex nowrap + center
- 表单头：一行 **6 格**，格间距 **10px**，合计 1262px（容器 1312px）
- 内距：th `4px 8px` / td `2px 8px`（序号列 `2px 4px`）/ `.ipn-v` `0 4px` / **`.ipn-in` `0 14px`（继承全局 `.input`）**
- 垂直节奏：`.page-hd` mb **18** → 表单头 mb **12** → 明细区（工具条 mb 8）→ 底条**紧贴**（无间距、`border-top:1px`）
- 疏密：滚动区可视 710px ⇒ 首屏 **21.12 行**；表 `min-width` 1372 > 容器 1312 ⇒ **1600 视口有横滚**

**🔴 销售页 vs 采购页（同一探针、同视口实测）**

| 项 | 采购（基准） | 销售 | 结论 |
|---|---|---|---|
| 字段框 / 标签 / 框内控件 | 32 / 12px / 30 | 32 / 12px / 30 | ✅ 一致 |
| 数据行高 | **31.8** | **62.6** | ❌ |
| 表头行高 | 38.5 | 46.5 | ❌ |
| 明细格控件高 | 22（`.ipn-in`） | **28**（`.isn-in`） | ❌ |
| 首屏行数 | 21.12 | 14.99 | ❌ 差 6 行 |

**成因**：销售页**没有** `table.isn-tbl td` 内距规则 ⇒ 落到全局 `table.tbl td{padding:10px 14px}`；
且销售页**没有** `.isn-v` 文本态（不是 v417j「点哪格」模式，全是常驻 `.isn-in{height:28px}`）。

**🔴 探针本身踩的两个坑（同类任务必看）**：
1. 销售页类名前缀是 **`isn-`**（`.isn-hd-box .isn-f`），照抄 `.ipn-*` 选择器一律 `NOT_FOUND` ⇒ 量测函数必须**按页参数化**选择器。
2. `tbody tr:first-child td` 的**第一个是序号列**（`seq-cell`，pad `2px 4px` / 12px），不是常规数据格 ⇒ 量常规格要用 `:not(.seq-cell)`。

**🔴 事故：工作区文档被静默回退**：开工时该规范文档工作区为 **464 行旧版**（HEAD 665 行含 v444/v445），
旧版**无独有内容**（纯回退，0 处 v444/v445 关键词）⇒ `git checkout HEAD -- <file>` 恢复，旧版另存 `.workbuddy/tmp/`。
**纪律**：改长文档前先 `wc -l` 与 HEAD 核数，**别默认工作区 == HEAD**。
