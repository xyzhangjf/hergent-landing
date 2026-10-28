# 账务域（GL / 凭证 / 报表 / 费用）v716–v717 全量判据

MEMORY.md 里「账务域铁律」是压缩版；这里是**原文**，含成因、数字、验证法。
交付文档：`docs/v716-成本侧打通-2026-10-28.md`、`docs/v717-费用侧打通-2026-10-28.md`。

## 一、成本侧（v716）

**27. 成本判据必须「恰为 0」，不能写 `<= 0`**
退货单金额为负 ⇒ 成本也为负。写 `<= 0` 会**整单跳过成本红冲**，只冲收入不冲成本 ⇒ 成本虚增、毛利低估。
生产实测 **3,925 张负额单**被吞，毛利率差 **2.79 个百分点**。
正解：`erp_db.auto_journal_for_cogs` 用 `to_cents(total_cost) == 0`。

**28. `order_type='transfer'`（调拨单）不能当销售过账**
生产 251 张，金额 0 但成本 **55.16 万**。跟着过账 ⇒ 主营业务成本凭空多 55 万、毛利率掉 **6.3 个点**。
调拨前后总库不变 ⇒ 本就不需要分录。

**29. 一对分录的幂等要各自判自己的 `ref_type`**
用一条 `NOT EXISTS(sale)` 同时生成 sale + cogs，会因 0 元赠品单永远缺 sale 分录 ⇒ 每次重跑**重复插 cogs**（v709 同族）。

**30. `journal_entries` 必须有 `(ref_type, ref_id)` 索引**
88,782 行时 `WHERE ref_type=? AND ref_id=?` 全表扫 ⇒ 22,505 次 ≈ **20 亿次比较** ⇒ dry-run 直接被 SIGTERM。
补 `idx_journal_ref` 后 **0.02 秒**。这也是 `gl_compensation_sweep` 从来跑不动的原因。

**31. 报表接口验证法**
临时 session 写**主库** `sessions`，`expires_at` 必须 `datetime('now','localtime','+2 hours')`（写 `datetime('now','+2 hours')` 是 UTC ⇒ 判已过期 401）
→ `curl -H "Authorization: Bearer <tok>" 127.0.0.1:8700/api/reports/pnl?month=YYYY-MM` → 立刻删 session。

## 二、费用侧（v717）

**32. 费用链路四个断点（全部实测，不是推断）**
1. `routers/finance.py` 给 `expense_order_create` / `expense_order_list` 传 **15 个实参**，db 侧签名只收 8 个 ⇒ `create_expense`/`list_expenses`/`create_income`/`list_incomes` 四个接口 **100% 500**。
2. 全仓只有 `auto_journal_for_sale / payment / purchase / cogs` 四个，**没有 expense** ⇒ 建了费单也不进 GL。
3. `expense_categories.gl_account` 9 条**全是 `6602`**（管理费用）⇒ 差旅、运费、工资全记成管理费用。
4. `get_pnl_gl` 只返回 `total_expense`，而前端读 `sell_expense/admin_expense/fin_expense/other_expense` ⇒ 三行恒 **¥0.00**。

⇒ **「接口 200」在这四个断点里一个都证明不了。**

**33. 删幽灵实参，别补列**
路由传的 7 个多余实参（`discount_amount / settlement_status / department / settlement_unit_id / employee_name / product_info / generation_method`）对应的列在 `expense_orders` 里**一个都不存在**。
补列只会把半成品伪装成能用的功能 ⇒ 直接删。

**34. `journal_entries` 是逐行记录的**
一行只有借或只有贷 ⇒ 判「借贷平衡」必须**按 `voucher_no` 汇总**。按行判 `debit == credit` 会把 88,776 行**全判成单边**（v717 第一版 verify 就栽在这，`bad=88780`）。

**35. `post_ledger` 与 `post_journal` 解耦**
前者管往来账 + `accounts` 余额，后者管 GL。
舟谱历史费用导入传 `post_ledger=False`（不该凭空造应付），但 `post_journal=True` —— 否则导进来的费用在利润表上不存在。
幂等边界：确认凭证按 `ref_type='expense'` 判重；付款凭证 `ref_type='expense_pay'` **故意不幂等**（部分付款每笔都是真实现金流出）。

**36. 费用四段硬断言**
`sell_expense + admin_expense + fin_expense + other_expense` 必须**逐分等于** `total_expense`（`money_eq` 整数分判等），分不平直接 `raise ValueError`。
宁可整页报错，也不让「合计对、明细不对」的账静默流到老板眼前。

**37. 回落现金制的判据（错了两版）**
`has_data` 只看**损益科目**凭证。2026-10 只有一张 920 元采购单（凭证 `1405/2202` 全是资产负债类）⇒ `has_data=False` ⇒ 回落现金制 ⇒ **把进货当费用** ⇒ 净利显示 **−920**。
v717d 加 `month_vouchers`（该月全部凭证行数）后：`if gl.get("has_data") or gl.get("month_vouchers"):`。

**38. 入口按钮注入时序**
chunk 里 `setTimeout(..., 300)` 才找 `#rptBtn_cf`，而实测该按钮 **~1000ms** 才出现 ⇒ 注入整段跳过 ⇒「利润表(权责)」入口**在老板界面上根本不存在**。
正解：内联脚本 + `setInterval(inject,400)` + `MutationObserver(observe body)`，节流 250ms；探针用 `wait_for_function` 别用固定 sleep。

## 三、费用科目映射（v717 落库的 9 条 + 兜底）

分类 → 科目（优先级：`gl_account` → 分类名匹配 → `type` 兜底，且必须校验科目在 `chart_of_accounts` 且 `is_active=1`）：
办公费/差旅费/运费 → 销售费用族 `6601*`；工资/房租/管理费用 → `6602*`；财务费用 → `6603*`；其余 → 其他费用。
`_expense_gl_account(dbc, category_id, etype)` 是唯一入口。

新增两个函数：
- `auto_journal_for_expense(expense_id, db_conn=None)`：借费用科目 / 贷 `2202` 应付账款，**幂等**。
- `auto_journal_for_expense_pay(expense_id, amount, account="现金", db_conn=None)`：借 `2202` / 贷现金或银行，**不幂等**。
- 客户费用从 `('ar', -amount)` 改为 `('ap', amount)`（原写法撞 `CHECK(amount>=0)` 必崩，语义也反）。

## 四、生产数据实况（2026-10-28，v717 后）

收入/成本侧**已通**：22,505 张签收单全部过账（调拨 251 张排除），2026-01~09 收入 **878.61 万**、成本 **778.51 万**、毛利 **100.11 万**、毛利率 **11.39%**，借贷差 **0 分**；接口 `basis=accrual / source=gl`。
费用侧**链路已通**（v717）、**真数据仍 0**。

**每次动账务都要重跑的强判据**：
- 逐月净利加总 **1,001,055.58** == BS `unclosed_profit` **1,001,055.58**，差 **0.00**
- `balanced=true`、`unbalanced_vouchers=0`、`journal_total=88,776`
- 全月扫描 10/10 月 `basis=accrual`，且四段之和 == `total_expense`
- 2026-09 单月：收入 1,128,410.37 / 成本 977,564.39 / 毛利 = 净利 150,845.98

数据缺口（**不是代码问题，是从没进系统**）：
- 库存科目 **−688.6 万**（期初 4.8 万 + 进货 89.9 万，却结转 778.5 万 ⇒ 缺约 690 万进货单）
- 应收 **+1,010 万**（878 万全挂应收，`cash_flow` 仅 16 行 ⇒ 缺银行流水）
- `expense_orders` / `expense_requests` **0 行**；`salary_details` 7 行全是 5000 元 `draft` 占位
⇒ 资产负债表(权责) 上 `assets.inventory` 显示 **−664 万**，是进货没导的真实信号，不是 bug。

## 五、v717 验证链（可复用）

`tests/perf/v717/probe_v717.py`（接口 28/28）→ `probe_v717_ui.py`（真机 18/18）→ 全月扫描 10/10 → 跨表勾稽差 0.00 → BS `balanced=true` → 清理残留全 0（`fixture_v717.py --delete <eid> <token>` 自证）。
字段级：`journal_entries` 按 `voucher_no` 汇总后 `unbalanced=0`。

## 六、遗留（未动，需老板拍板）

1. 费用真数据怎么进：(a) 界面手工逐笔录（入口已可用）(b) 舟谱导 9 个月费用明细 (c) 从工资/运费单据生成（卡在无 `auto_journal_for_salary`）。
2. 付款凭证贷方银行账户**是猜的**：分类名含「银行」→ `100201`，账套有 7 个银行科目，无 UI 让选。
3. `expense_categories.gl_account` / `requires_receipt` 是**账外裸 DDL**（`ALTER TABLE` 直加），应走 `migrations/patches/`。
4. `/opt/static` 无源码仓库，v717/v717c 只在生产文件 + `.bak-*`；回滚靠 `.bak`，重放文本在 `tools/hergent/patch_v717*.py`。
5. 「日记账」入口注入同样依赖脆弱选择器，未修（同 38 的病根）。

---

## 七、v718 进货补录（2026-10-28）

### 7.1 侦察发现（全部实测）

| # | 发现 | 证据 |
|---|---|---|
| 1 | 采购单 84 张 / 90.07 万，**79 张无任何明细**，全库明细仅 14 行 | `purchase_orders` vs `purchase_order_items` |
| 2 | 2026-10-20 上传的「采购订货明细报表.xlsx」（782 行 / 49 张单 / 57.48 万）被导入器当成 **products** 处理，映射只有 `名称+采购价` ⇒ 明细从未进 `purchase_order_items` | `import_receipts` id=2，`mapping_json={"1":"name","23":"factory_price"}` |
| 3 | 那次误导入把 782 行明细**每行建了一个商品** ⇒ `products` 1270 个，其中 782 个空壳（无条码/无规格/`purchase_price=0`）；130 组重名，最多重复 12 次 | |
| 4 | 782 个空壳**零引用**（销售/客户价/库存/采购明细/预报导入 全 0） | 5 张引用表逐一校验 |
| 5 | 销售明细 142,859 行，**批次 0 行、效期 0 行**；库存 55 行，效期 55/55 全缺 | |
| 6 | 成本口径 = `数量 × products.purchase_price`（`batch_trace` 空表 ⇒ 永远走回落），**不读进货单** | `erp_db.py:6879` |
| 7 | 原始 xlsx 仍在服务器 `data/chat_files/2/6d700aa7fa3b4cd8b0415aff66dc1fbe.xlsx`（28 列全对） | |

**单号交叉验证**：xlsx 的 49 个单号（`CD261001`~`CD261020`）与库内 84 张（`CD2605xx`~`CD2606xx` + 3 张手工 `PO2026...`）**一个都对不上** ⇒ 库内那批是 6 月底批量导入的旧单，10 月这批从未进系统。

### 7.2 做了什么

P1 清污：782 个空壳隔离到 `products_quarantine_v718`（不物理删；fail-closed，5 张引用表全 0 才执行）。商品 1270 → 488。
P2 补录：49 张单 + 782 行明细 + 49 组入库凭证（借 1405 / 贷 2202）+ 库存 121 个商品-仓 +282,434 数量 + 自动建档 2 个（新希望南山 2 个新品，否则单头≠明细）。

匹配率：按条码 719 / 按名称 61 / 未匹配 2（建档后全落地）。
供应商：39 匹配 / 10 兜底（「蒙牛酸奶（湖北恒滋）」contacts 里没有 → 兜底 2923，原名写 note）。
单位：xlsx 全是小单位（杯/瓶/袋/盒/桶/罐/组/包），与档案 `unit` 一致 ⇒ **无需换算**。
幂等：单号判重 + 凭证 `(ref_type,ref_id)` 判重。
凭证号：`JBP + YYYYMMDD + 4 位序号`，按日期各自起编。

### 7.3 数字（改前 → 改后）

| 指标 | 前 | 后 |
|---|---|---|
| 1405 库存商品 | −6,886,117.54 | **−6,311,338.27** |
| 2202 应付账款 | −938,909.98 | **−1,513,689.25** |
| 采购单 / 明细 | 84 / 14 | **133 / 796** |
| 商品 / 库存行 | 1270 / 55 | **490 / 176** |
| 凭证行 | 88,776 | **88,874**（+98 = 49×2） |
| 不平凭证 | 0 | **0** |

验证：库级 12/12 PASS（单头==明细逐单相符 0 张不符、49 组凭证借贷平、销售 22,506/142,859 未受影响）；接口 `balanced=true`、`unclosed_profit=1,001,055.58` == 逐月净利合计（差 0.00）、`basis=accrual`。

### 7.4 两个口径澄清（探针误报，不是 bug）

1. 接口 `assets.inventory = -6,068,564.00`，而 1405 是 −6,311,338.27 —— 差 242,774.27 正是 **1406**。接口按 **1405+1406** 取值（v713 既定实现）。
2. `unclosed_profit` 在**顶层**（不在 `equity`，`equity.retained` 是另一回事）；成本字段名是 **`cogs`** 不是 `cost`。

### 7.5 三个没解决的硬缺口

1. 🔴 **1-9 月进货单完全没进系统**：账面 1405 仍 −631 万，补 10 月只补了 8%。同一张舟谱报表换日期区间即可，脚本已就绪。
2. 🔴 **库存表只进不出**：`inventory_logs` 全部变动只有 `opening` 140 行（27,855）+ `batch_in` 2 行（130），**零销售出库**；销售明细应有出库 4,200,183，库存一分没扣 ⇒ `inventory` 现在是「累计入库量」不是库存余额。**真实库存要成立必须先补「销售出库扣减」这条功能链路。**
3. 🔴 **批次/效期没有任何数据源**：10 月这份采购表 28 列里没有批次号/生产日期/到期日；销售明细批次效期 0/0 ⇒ 低温奶的核心（先进先出、临期预警）推不出来，需另找来源。

### 7.6 回滚

```bash
python3 /tmp/v718.py --rollback /opt/hergent-data/backup/tenant_1.pre-v718-20261028-172342.db
# 只撤商品隔离
INSERT INTO products SELECT * FROM products_quarantine_v718;
# 只撤补录（先凭证后明细后单头）
DELETE FROM journal_entries WHERE ref_type='purchase' AND ref_id IN (SELECT id FROM purchase_orders WHERE source='v718');
DELETE FROM purchase_order_items WHERE order_id IN (SELECT id FROM purchase_orders WHERE source='v718');
DELETE FROM purchase_orders WHERE source='v718';
```
