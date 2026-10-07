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
