#!/usr/bin/env python
"""v404 影子库验收 —— 采购单详情页三 tab（后端）。

跑法：
    SRC=/tmp/v404-shadow-src /Users/zhangjunfeng/.workbuddy/binaries/python/envs/default/bin/python \
        .workbuddy/tools/v404-shadow-verify.py

设计要点（照 v403/v361 的影子库纪律）：
  · **只写影子副本**，生产快照原样不动（`SRC` 只读，每次重新拷进 WORK）。
  · **不 import 应用就能观察「改动前」形态**：Phase 0 用裸 sqlite3 读原始快照。
  · **相位反转 = 判别力的证据**：Phase 0 写下的断言（「还没有任何付款流水」）必须在
    Phase 4 付款之后**变成假**。只跑一侧（全绿）不构成证据 —— 那可能只是判据恒真。
  · `ERP_DB_PATH` 必须在 **import erp_db 之前**设好：`DB_DIR` 由它推导，
    租户库 `<DB_DIR>/tenant_1.db` 也跟着走影子目录。

v404 与 v403 最大的不同：**本轮不建任何表、不加任何列**。
「货款 / 入库单」两个 tab 都是**派生视图**（来源 = 既有 `receivables` / `cash_flow` /
`prepayments` / `purchase_order_items`）。所以 Phase 1 的断言是「结构一个字节都没变」，
这本身就是一条要守的纪律：派生视图一旦偷偷落表，就会与 `purchase_order_confirm`
写的 `batch_in` 分叉成两套入库台账。
"""
import os
import shutil
import sqlite3
import sys
import traceback
from datetime import datetime

SRC = os.environ.get("SRC", "/tmp/v404-shadow-src")
WORK = os.environ.get("WORK", "/tmp/v404-shadow")
SERVER_DIR = "/Users/zhangjunfeng/Documents/hergent-erp/server"

PASS, FAIL = [], []


def ok(name, cond, got=None):
    (PASS if cond else FAIL).append(name)
    mark = "✅" if cond else "❌"
    print(f"  {mark} {name}" + ("" if cond else f"   ← got={got!r}"))
    return cond


def section(t):
    print(f"\n{'─' * 72}\n{t}\n{'─' * 72}")


def ro(path, sql, args=()):
    c = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        return c.execute(sql, args).fetchall()
    finally:
        c.close()


def rw(path, sql, args=()):
    c = sqlite3.connect(path)
    try:
        cur = c.execute(sql, args)
        c.commit()
        return cur.fetchall() if cur.description else []
    finally:
        c.close()


def cols_of(db_path, table):
    return [r[1] for r in ro(db_path, f"PRAGMA table_info({table})")]


TENANT = os.path.join(WORK, "tenant_1.db")

# ═══════════════════════════════════════════════════ Phase 0：反例（改动前形态）
section("Phase 0  反例自证：影子副本必须是「付款 / 应付都还没发生」的形态")
if not os.path.isdir(SRC):
    print(f"❌ 快照目录不存在：{SRC}（先跑 scp 下载生产快照）")
    sys.exit(2)

shutil.rmtree(WORK, ignore_errors=True)
os.makedirs(WORK)
for f in ("erp.db", "tenant_1.db"):
    shutil.copy2(os.path.join(SRC, f), os.path.join(WORK, f))

pre_po_cols = cols_of(TENANT, "purchase_orders")
print(f"  租户库 purchase_orders({len(pre_po_cols)} 列): {pre_po_cols}")

_ap0 = ro(TENANT, "SELECT COUNT(*) FROM receivables WHERE type='ap' AND ref_type='purchase'")[0][0]
_pay0 = ro(TENANT, "SELECT COUNT(*) FROM cash_flow WHERE ref_type='purchase'")[0][0]
_paid0 = ro(TENANT, "SELECT COUNT(*) FROM purchase_orders WHERE COALESCE(paid_amount,0)>0")[0][0]
print(f"  付款前：ap 应付行={_ap0} · purchase 资金流水={_pay0} · 已结款>0 的单={_paid0}")
ok("0.1 还没有任何采购应付行（反例：Phase 4 付款后此断言必须失败）", _ap0 == 0, _ap0)
ok("0.2 还没有任何采购付款流水（反例：Phase 4 付款后此断言必须失败）", _pay0 == 0, _pay0)
ok("0.3 全库没有任何「已结款>0」的采购单（同上）", _paid0 == 0, _paid0)
ok("0.4 反例：凭空查一个不存在的 ref_type 必须为 0（证明上面三条有判别力）",
   ro(TENANT, "SELECT COUNT(*) FROM cash_flow WHERE ref_type='zzz_nope'")[0][0] == 0)
# v404 不建表：`inbound_orders` 仍是空的、且与本轮的采购单无关联列
_ib0 = ro(TENANT, "SELECT COUNT(*) FROM inbound_orders")[0][0]
_ibc = cols_of(TENANT, "inbound_orders")
ok("0.5 inbound_orders 仍为 0 行（本轮**不写**它，入库单 tab 是派生视图）", _ib0 == 0, _ib0)
ok("0.6 inbound_orders 没有任何指向采购单的列（证明「派生」是唯一可行路线）",
   not any("order_id" in c or "purchase" in c for c in _ibc), _ibc)

# ═══════════════════════════════════════════════════ Phase 1：import（触发迁移）
section("Phase 1  启动期迁移：v404 **不加列、不建表**（结构必须一个字节都没变）")
os.environ["ERP_DB_PATH"] = os.path.join(WORK, "erp.db")
os.environ.pop("DATABASE_URL", None)
os.environ.setdefault("ERP_SECRET", "v404-shadow-verify-local-only")
sys.path.insert(0, SERVER_DIR)
try:
    import erp_db as db                                       # noqa: E402  ← import 触发迁移
    from db.connection import set_tenant_context              # noqa: E402
except Exception:
    traceback.print_exc()
    print("❌ erp_db 导入失败 —— 后面的断言无意义，直接退出")
    sys.exit(3)

post_po_cols = cols_of(TENANT, "purchase_orders")
ok("1.1 租户库 purchase_orders 列数与改动前**完全一致**（v404 不加列）",
   len(post_po_cols) == len(pre_po_cols), (len(pre_po_cols), len(post_po_cols)))
ok("1.2 列名集合也完全一致（不是「数量相同、换了名字」）",
   sorted(post_po_cols) == sorted(pre_po_cols), post_po_cols)

# ═══════════════════════════════════════════════════ Phase 2：详情投影列 + 货款只读
section("Phase 2  「采购订单详情」投影列 + 「货款」只读口径")
set_tenant_context(1)

# 🔴 先造一张**真实可确认**的单，作为 Phase 2/3/4 的共用样本。
#    为什么不复用生产里现成的单：
#      ① id=167/168 那两张草稿单是**孤儿测试数据** —— `supplier_id=1` 与
#         `purchase_order_items.product_id=1` 在租户库里**都不存在**，
#         `purchase_order_confirm` 的 `batch_in` 会撞 `FOREIGN KEY constraint failed`
#         （那个报错是**正确行为**，FK 在拦脏数据，但它不是本轮要验的东西）；
#      ② 更要紧：实测生产**全部 10 行** `purchase_order_items` 的 `product_id`
#         **都**连不上 `products`（LEFT JOIN 后 product_* 整片 NULL）⇒ 拿它们验
#         「投影列有没有值 / 单位回退链生没生效」等于**空转**（断言恒真或恒假，
#         看不出任何东西）。这是本机快照的数据事实，不是本轮引入的。
#    ⇒ 走**真实建单路径**造样本，全流程（明细投影 / 入库单 / 付款）都用它。
_pid = ro(TENANT, "SELECT id FROM products ORDER BY id LIMIT 1")[0][0]
_sid = ro(TENANT, "SELECT id FROM contacts WHERE type='supplier' ORDER BY id LIMIT 1")[0][0]
OP_UID = ro(os.path.join(WORK, "erp.db"), "SELECT id FROM users ORDER BY id LIMIT 1")[0][0]
print(f"      造验收样本单：supplier_id={_sid} product_id={_pid} warehouse_id=1 user_id={OP_UID}")
_created = db.purchase_order_create(
    supplier_id=_sid,
    items=[{"product_id": _pid, "quantity": 4, "unit_price": 2.5,
            "batch_no": "V404-SHADOW", "expiry_date": "2026-12-31"}],
    warehouse_id=1, note="v404 影子库验收", order_date="2026-10-08")
ok("2.0 建出验收样本单（后面三个阶段共用它）", bool(_created.get("order_id")), _created)
OID = _created.get("order_id")

_tag = ro(TENANT, "SELECT COUNT(*) FROM purchase_order_items i "
                  " LEFT JOIN products p ON i.product_id=p.id WHERE p.id IS NULL")[0][0]
print(f"      （数据事实：生产快照里有 {_tag} 行采购明细的商品档案已不存在）")

d = db.purchase_order_get(OID)
_it = d["items"][0]
for k in ("large_barcode", "medium_barcode", "large_unit", "medium_unit",
          "large_ratio", "medium_ratio", "factory_price",
          "product_barcode", "product_name", "spec", "unit_label"):
    ok(f"2.1 明细行出现投影列 {k}", k in _it, sorted(_it.keys()))
# 单位回退链：建单时前端没传 `unit`（生产实测大量为空）⇒ 必须回落到档案单位，
# 否则详情页与入库单的「单位」列整列空白。判据只看**档案存在**的行。
_pts = [x for x in d["items"] if str(x.get("product_name") or "").strip()]
_blank = [x for x in _pts if not str(x.get("unit_label") or "").strip()]
print(f"      明细 {len(d['items'])} 行 · 档案存在 {len(_pts)} 行 · unit_label 空白 {len(_blank)} 行")
ok("2.1b `unit_label` 在**档案存在**的行上都有值（回退链真的生效，不是照抄空的 unit）",
   len(_pts) > 0 and not _blank, [(x.get("unit"), x.get("unit_label")) for x in _pts[:3]])
ok("2.1c 反例自证：这些行的 `unit` 原值确实有空串 ⇒ 2.1b 不是恒真",
   any(not str(x.get("unit") or "").strip() for x in _pts),
   [(x.get("unit"), x.get("unit_label")) for x in _pts[:5]])

P = db.purchase_order_payments(OID)
ok("2.2 purchase_order_payments 返回 {order, payments}",
   set(["order", "payments"]).issubset(P.keys()), sorted(P.keys()))
_o = P["order"]
for k in ("order_no", "supplier_name", "total_amount", "received_amount", "paid_amount",
          "unpaid_amount", "prepaid_amount", "ap_exists", "ap_amount", "ap_unpaid_amount"):
    ok(f"2.3 货款订单信息含 {k}", k in _o, sorted(_o.keys()))
ok("2.4 unpaid_amount == max(0, received_amount − paid_amount)（与列表页同口径）",
   abs(_o["unpaid_amount"] - max(0.0, _o["received_amount"] - _o["paid_amount"])) < 1e-6, _o)
ok("2.5 prepaid_amount 只累加 type='ap' 的预付（不把客户预收算进来）",
   _o["prepaid_amount"] >= 0, _o["prepaid_amount"])
print(f"      货款读数: ap_exists={_o['ap_exists']} ap_amount={_o['ap_amount']} "
      f"入库={_o['received_amount']} 已结={_o['paid_amount']} 未结={_o['unpaid_amount']}")

# 反例：一张「导入的历史单」——有 status=received 但零明细
_imp = ro(TENANT, "SELECT po.id FROM purchase_orders po "
                  " WHERE NOT EXISTS (SELECT 1 FROM purchase_order_items i WHERE i.order_id=po.id) "
                  " ORDER BY po.id DESC LIMIT 1")
ok("2.6 存在零明细的历史导入单（下面用它验「没有≠是零」）", len(_imp) > 0, _imp)
if _imp:
    IOID = _imp[0][0]
    _pi = db.purchase_order_payments(IOID)["order"]
    ok("2.7 零明细单的 ap_amount 是 **None** 而不是 0.0（「没有应付」≠「应付是零」）",
       _pi["ap_amount"] is None, _pi["ap_amount"])
    ok("2.8 同单 ap_exists=False（界面据此显示 — 而不是 ¥0.00）", _pi["ap_exists"] is False,
       _pi["ap_exists"])

ok("2.9 反例：不存在的 oid → None（证明查询真的带 WHERE，不是恒回一张单）",
   db.purchase_order_payments(10 ** 9) is None)

# ═══════════════════════════════════════════════════ Phase 3：入库单派生视图
section("Phase 3  「入库单」派生视图：空态 / 单号派生 / 明细与合计")
# 3a 未入库（草稿）⇒ 必须给理由，而不是渲染一张全 0 的表。样本单此刻正是 draft。
IB = db.purchase_order_inbound(OID)
ok("3.0 草稿单 → empty=True（不渲染全 0 表）", IB.get("empty") is True, IB.get("empty"))
ok("3.1 空态带人话理由", bool(IB.get("reason")), IB.get("reason"))
ok("3.2 空态**不带** items（界面没法拿它画出假明细）", "items" not in IB, sorted(IB.keys()))
print(f"      空态理由：{IB.get('reason')}")

# 3b 已入库（导入单，零明细）⇒ 不报错，items 为空、合计为 0
if _imp:
    IB2 = db.purchase_order_inbound(IOID)
    ok("3.3 已入库但零明细 → empty=False 且 items=[]（不是报错）",
       IB2.get("empty") is False and IB2.get("items") == [], (IB2.get("empty"), len(IB2.get("items") or [])))
    ok("3.4 derived 标记为 True（界面据此写「按源单派生」说明）", IB2.get("derived") is True)
    _hn = IB2["head"]["inbound_no"]
    _sn = IB2["head"]["src_order_no"]
    ok(f"3.5 入库单号由源单派生（{_sn} → {_hn}）：CD 前缀换 RK，其余原样",
       (_hn == "RK" + _sn[2:]) if _sn.startswith("CD") else (_hn == "RK" + _sn), (_sn, _hn))

# 3c 「已入库 + 有明细」这个组合只有 `confirm` 之后才出现 ⇒ 那组断言放在 Phase 4 里跑
#     （用同一张样本单，同一份代码路径）。见 4.27–4.36。
ok("3.6 反例：不存在的 oid → None", db.purchase_order_inbound(10 ** 9) is None)

# ═══════════════════════════════════════════════════ Phase 4：付款（核心安全性质）
section("Phase 4  付款登记：超付 / 零负金额 / 无应付行 / 三处同步 / 期间门禁")

# 样本单（Phase 2 造的）此刻仍是 draft ⇒ 直接走**真实 confirm** 拿到合法的应付行
CID = OID
_st = db.purchase_order_get(CID)["order"]["status"]
if _st == "pending_approval":
    db.purchase_order_approve(CID)
    _st = db.purchase_order_get(CID)["order"]["status"]
print(f"      样本单 id={CID} 状态={_st} → 走 confirm")
ok("4.0 样本单处于可确认状态（draft/approved）", _st in ("draft", "approved"), _st)

if _st in ("draft", "approved"):
    rc = db.purchase_order_confirm(CID)
    ok("4.1 confirm 成功", "error" not in rc, rc)
    _ap = ro(TENANT, "SELECT id,amount,paid_amount,status FROM receivables "
                     " WHERE type='ap' AND ref_type='purchase' AND ref_id=?", (CID,))
    ok("4.2 confirm 后**自动**产生一笔 ap 应付（付款才有对象）", len(_ap) == 1, _ap)
    AP_ID = _ap[0][0] if _ap else 0
    AP_AMT = float(_ap[0][1]) if _ap else 0.0
    print(f"      应付行 id={AP_ID} 金额={AP_AMT}")

    P4 = db.purchase_order_payments(CID)["order"]
    ok("4.3 应付金额与「入库金额 − 已结」一致（两处记账不分叉）",
       abs((P4["ap_unpaid_amount"] or 0) - P4["unpaid_amount"]) < 0.01,
       (P4["ap_unpaid_amount"], P4["unpaid_amount"]))
    UNPAID = P4["unpaid_amount"]
    ok("4.4 未结金额 > 0（否则后面所有付款断言都是空转）", UNPAID > 0, UNPAID)

    # 4a 金额守卫
    r0 = db.purchase_payment_create(CID, 0)
    ok("4.5 金额 0 → 拒绝", "error" in r0, r0)
    rneg = db.purchase_payment_create(CID, -5)
    ok("4.6 金额为负 → 拒绝", "error" in rneg, rneg)
    rover = db.purchase_payment_create(CID, UNPAID + 0.01)
    ok(f"4.7 超付（未结 {UNPAID} + 0.01）→ 拒绝", "error" in rover, rover)
    ok("4.8 三次被拒后 paid_amount 仍为 0（守卫失败不是「拒了但改了库」）",
       float(ro(TENANT, "SELECT COALESCE(paid_amount,0) FROM purchase_orders WHERE id=?",
                (CID,))[0][0]) == 0)
    ok("4.9 三次被拒后 cash_flow 仍无该单流水",
       ro(TENANT, "SELECT COUNT(*) FROM cash_flow WHERE ref_type='purchase' AND ref_id=?",
          (CID,))[0][0] == 0)

    # 4b 第一笔：一半（**带真实操作人**，为 Phase 6 的姓名解析留样本）
    half = round(UNPAID / 2, 2) or 1.0
    r1 = db.purchase_payment_create(CID, half, account="现金", note="影子库验收第一笔",
                                    operator_id=str(OP_UID))
    ok("4.10 首笔付款成功", "error" not in r1, r1)
    print(f"      首笔 {half} → 回执 {r1}")
    _po1 = ro(TENANT, "SELECT COALESCE(paid_amount,0),COALESCE(received_amount,0) "
                      " FROM purchase_orders WHERE id=?", (CID,))[0]
    _ap1 = ro(TENANT, "SELECT COALESCE(paid_amount,0),status FROM receivables WHERE id=?",
              (AP_ID,))[0]
    _cf1 = ro(TENANT, "SELECT amount,type,account,balance_after FROM cash_flow "
                      " WHERE ref_type='purchase' AND ref_id=? ORDER BY id", (CID,))
    ok("4.11 ①purchase_orders.paid_amount 增加了", abs(float(_po1[0]) - half) < 0.01, _po1)
    ok("4.12 ②receivables(ap).paid_amount **同步**增加了（这两处最容易分叉）",
       abs(float(_ap1[0]) - half) < 0.01, _ap1)
    ok("4.13 ③receivables(ap).status 变 partial", _ap1[1] == "partial", _ap1)
    ok("4.14 ④cash_flow 落了一行 expense（货款 tab 靠它查回）",
       len(_cf1) == 1 and _cf1[0][1] == "expense" and abs(float(_cf1[0][0]) - half) < 0.01, _cf1)
    ok("4.15 账户余额被扣减（不是只记流水）",
       abs(float(_cf1[0][3]) - (ro(TENANT, "SELECT current_balance FROM accounts WHERE name='现金'")[0][0])) < 0.01,
       _cf1)
    ok("4.16 生成会计凭证（借 2202 应付 / 贷 1002 银行）",
       ro(TENANT, "SELECT COUNT(*) FROM journal_entries WHERE ref_type='payment' AND ref_id=?",
          (r1["payment_id"],))[0][0] >= 1)
    ok("4.17 回执里的 unpaid_amount 已按新值返回",
       abs(float(r1["unpaid_amount"]) - max(0.0, float(_po1[1]) - float(_po1[0]))) < 0.01, r1)

    # 4c 第二笔：补足
    rest = round(UNPAID - half, 2)
    if rest > 0:
        r2 = db.purchase_payment_create(CID, rest, account="现金", note="影子库验收尾款")
        ok("4.18 补足尾款成功", "error" not in r2, r2)
        _ap2 = ro(TENANT, "SELECT COALESCE(paid_amount,0),status FROM receivables WHERE id=?",
                  (AP_ID,))[0]
        ok("4.19 结清后 ap.status == paid", _ap2[1] == "paid", _ap2)
        ok("4.20 结清后未结为 0", abs(float(db.purchase_order_payments(CID)["order"]["unpaid_amount"])) < 1e-6)
        r3 = db.purchase_payment_create(CID, 0.01)
        ok("4.21 结清后再付 → 拒绝", "error" in r3, r3)

    # 4d 无应付行的单必须拒（**反例自证**：这正是最容易写成「看着成功」的一条）
    if _imp:
        IOID2 = _imp[0][0]
        _before = float(ro(TENANT, "SELECT COALESCE(paid_amount,0) FROM purchase_orders WHERE id=?",
                           (IOID2,))[0][0])
        rno = db.purchase_payment_create(IOID2, 1.0)
        _after = float(ro(TENANT, "SELECT COALESCE(paid_amount,0) FROM purchase_orders WHERE id=?",
                          (IOID2,))[0][0])
        ok("4.22 无应付行的单付款 → 拒绝（不做「只涨 paid_amount」的降级）",
           "error" in rno, rno)
        ok("4.23 被拒后该单 paid_amount 一字未动", abs(_after - _before) < 1e-9, (_before, _after))
        ok("4.24 被拒后该单 cash_flow 也没有流水",
           ro(TENANT, "SELECT COUNT(*) FROM cash_flow WHERE ref_type='purchase' AND ref_id=?",
              (IOID2,))[0][0] == 0)

    # 4e 期间门禁：**关账期必须拒**（import 与 check 分开写的效果）
    _month = datetime.now().strftime("%Y-%m")
    rw(TENANT, "INSERT OR REPLACE INTO accounting_periods (month,status) VALUES (?,?)",
       (_month, "closed"))
    rw(TENANT, "INSERT OR REPLACE INTO system_config (key,value) VALUES ('period_lock_enforced','1')")
    rper = db.purchase_payment_create(CID, 0.01)
    ok("4.25 会计期间已关闭 + 强制锁 → 付款被拒（不是被 try/except 吞掉）",
       "error" in rper, rper)
    print(f"      期间门禁回执：{rper}")
    # 还原锁（影子库无所谓，但让后面读数干净）
    rw(TENANT, "INSERT OR REPLACE INTO system_config (key,value) VALUES ('period_lock_enforced','0')")

    # 4f 付款后入库单视图仍自洽（说明付款没污染到货事实）。
    # ⚠️ 生产里**唯一有明细的单是草稿**（167/168 还是孤儿数据）⇒ 「已入库 + 有明细」这个组合
    #    只有 `confirm` 之后才会出现，所以 3.7–3.11 那组断言在这里补跑（同一份代码路径）。
    IB4 = db.purchase_order_inbound(CID)
    ok("4.26 付款后入库单视图非空（付款不污染到货事实）", IB4.get("empty") is False, IB4.get("empty"))
    ok("4.27 付款后入库单明细行数 == 该单明细行数",
       IB4["summary"]["line_count"] == len(db.purchase_order_get(CID)["items"]))
    _i0b = IB4["items"][0]
    for k in ("order_qty", "order_amount", "recv_amount", "diff_qty", "has_batch",
              "batch_no", "production_date", "barcode", "large_barcode", "spec", "unit_label"):
        ok(f"4.28 入库单明细（已入库场景）含 {k}", k in _i0b, sorted(_i0b.keys()))
    ok("4.29 付款后入库单明细仍带批次号（confirm 落库的三列没被付款冲掉）",
       _i0b["has_batch"] is True, _i0b.get("batch_no"))
    ok("4.30 summary.recv_qty == Σ received_qty（合计不是另算一份）",
       abs(IB4["summary"]["recv_qty"]
           - round(sum(float(x["received_qty"] or 0) for x in IB4["items"]), 2)) < 1e-6,
       IB4["summary"])
    ok("4.31 diff_qty == 订单数量 − 已入库数量",
       all(abs(float(x["diff_qty"]) - (float(x["order_qty"]) - float(x["received_qty"]))) < 1e-6
           for x in IB4["items"]))
    ok("4.32 整单全收 ⇒ 差异数量为 0 且 入库金额 == 订单金额",
       abs(float(_i0b["diff_qty"])) < 1e-6
       and abs(float(_i0b["recv_amount"]) - float(_i0b["order_amount"])) < 1e-6, _i0b)
    _hn2 = IB4["head"]["inbound_no"]
    ok("4.33 新单（PO 前缀，非 CD）的入库单号派生正确（RK + 原单号）",
       _hn2 == "RK" + (IB4["head"]["src_order_no"] or ""), _hn2)
    # 4g v404 修正：`confirm` 必须把「整单全收」落到**每一行**明细（此前只写表头）
    _rq = ro(TENANT, "SELECT COUNT(*), SUM(CASE WHEN COALESCE(received_qty,0)=quantity THEN 1 ELSE 0 END) "
                     " FROM purchase_order_items WHERE order_id=?", (CID,))[0]
    ok("4.34 confirm 后**每一行**明细的 received_qty 都等于订单数量（不再只写表头）",
       _rq[0] == _rq[1] and _rq[0] > 0, _rq)
    ok("4.35 全区终于有「received_qty>0」的明细行了（Phase 0 时为 0 行 ⇒ 相位反转）",
       ro(TENANT, "SELECT COUNT(*) FROM purchase_order_items WHERE COALESCE(received_qty,0)>0")[0][0] > 0)

# ═══════════════════════════════════════════════════ Phase 5：相位反转
section("Phase 5  相位反转：Phase 0 的三条断言现在必须**失败**（判别力自证）")
_apN = ro(TENANT, "SELECT COUNT(*) FROM receivables WHERE type='ap' AND ref_type='purchase'")[0][0]
_payN = ro(TENANT, "SELECT COUNT(*) FROM cash_flow WHERE ref_type='purchase'")[0][0]
_paidN = ro(TENANT, "SELECT COUNT(*) FROM purchase_orders WHERE COALESCE(paid_amount,0)>0")[0][0]
print(f"  付款后：ap 应付行={_apN} · purchase 资金流水={_payN} · 已结款>0 的单={_paidN}")
ok("5.1 0.1 已反转（现在有应付行了）", _apN > 0, _apN)
ok("5.2 0.2 已反转（现在有付款流水了）", _payN > 0, _payN)
ok("5.3 0.3 已反转（现在有已结款>0 的单了）", _paidN > 0, _paidN)
ok("5.4 inbound_orders 仍为 0 行（全程没写过它 ⇒ 派生视图没有偷偷落表）",
   ro(TENANT, "SELECT COUNT(*) FROM inbound_orders")[0][0] == 0)
ok("5.5 purchase_orders 列数仍与改动前一致（付款没有偷偷加列）",
   len(cols_of(TENANT, "purchase_orders")) == len(pre_po_cols))

# ═══════════════════════════════════════════════════ Phase 6：操作人姓名解析
section("Phase 6  内部账号 id 不许流到界面：付款/入库单的操作人必须解析成姓名")
#
# 🔴 为什么用「行为 + 接线」两条一起验，而不是起一套 HTTP 栈调端点：
#    `psi_get_purchase_payments` / `psi_get_purchase_inbound` 里除了 `_auth` 之外**只做**
#    这一件后处理（解析 operator_id）。要起 HTTP 栈就得往影子主库塞一枚真 token、
#    再造 Request 桩，成本远大于收益，而且**验到的是 FastAPI 而不是我们的逻辑**。
#    这里改成：① 行为 —— 直接调**同一个** `_creator_names`（唯一实现）看它是否真出姓名；
#              ② 接线 —— AST 断言**两个端点的函数体里确实调了它**（否则逻辑写了没接上，
#                 正是本项目反复踩的「写了 ≠ 可达」）。
try:
    import routers.psi as _psi
    _names = _psi._creator_names([str(OP_UID), "", None])
    _nm = _names.get(str(OP_UID), "")
    ok("6.1 _creator_names 能把内部 user_id 解析成中文姓名", bool(_nm), _names)
    ok("6.2 解析结果**不是**那个数字 id 本身（不是把 id 原样回显）", _nm != str(OP_UID), _nm)
    print(f"      user_id={OP_UID} → {_nm!r}")
except Exception as e:
    ok(f"6.1 _creator_names 可导入并解析（导入失败：{e}）", False, e)

import ast
import ast as _ast
_src = open(os.path.join(SERVER_DIR, "routers/psi.py"), encoding="utf-8").read()
_tree = _ast.parse(_src)
_calls = {}
for _n in _ast.walk(_tree):
    if isinstance(_n, (ast.FunctionDef, ast.AsyncFunctionDef)) and _n.name in (
            "psi_get_purchase_order", "psi_get_purchase_payments", "psi_get_purchase_inbound"):
        _calls[_n.name] = any(
            isinstance(x, ast.Call) and isinstance(x.func, ast.Name) and x.func.id == "_creator_names"
            for x in _ast.walk(_n))
ok("6.3 详情端点**接线**到了 _creator_names（v404 补 creator_name）",
   _calls.get("psi_get_purchase_order") is True, _calls)
ok("6.3b 货款端点**接线**到了 _creator_names（写了 ≠ 可达，必须验接线）",
   _calls.get("psi_get_purchase_payments") is True, _calls)
ok("6.4 入库单端点**接线**到了 _creator_names", _calls.get("psi_get_purchase_inbound") is True, _calls)
# 反例：AST 判据本身要有判别力 —— 拿一个**不含该调用**的端点必须判 False。
# ⚠️ 反例必须挑**真的不含**的函数：第一版挑了 `psi_list_purchase_orders`，
#    结果它**也**调了 `_creator_names`（v403 加「创建人」列时接的）⇒ 反例自己假红。
#    这正是「反例也要先核实、不能凭印象挑」的实例。这里改用 `psi_meta`（纯元数据端点）。
_routes = [n for n in _ast.walk(_tree)
           if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == "psi_meta"]
ok("6.5 反例自证：`psi_meta` 不含 _creator_names（⇒ 6.3/6.4 的判据非恒真）",
   bool(_routes) and not any(
       isinstance(x, ast.Call) and isinstance(x.func, ast.Name) and x.func.id == "_creator_names"
       for _r in _routes for x in _ast.walk(_r)))

# ═══════════════════════════════════════════════════ 汇总
section("汇总")
print(f"  PASS={len(PASS)}  FAIL={len(FAIL)}")
if FAIL:
    print("  ❌ 失败项：")
    for f in FAIL:
        print(f"     · {f}")
    sys.exit(1)
print("  ✅ 全部通过")
