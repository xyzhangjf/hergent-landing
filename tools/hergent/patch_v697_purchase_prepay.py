#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v697：采购「预付款」+ 修掉三处让付款链路断掉的既有缺陷。

老板 2026-10-26 定的三条口径：
  ① 预付记**货款流水**（`cash_flow`），不另建付款表、不进 `prepayments`；
  ② 只有 `approved`（已审待执行）能预付 —— 钱在审核通过后才出；
  ③ **不设预付上限**（老板明确选了这一项，与我的建议相反，理由见下）。

为什么「不设上限」必须配一个 `overpaid_amount`：
  `_po_unpaid` 一直用 `max(0.0, ...)` 兜底，未结金额永远不会是负数 —— 好处是界面上
  不会出现「-2000」这种吓人的数，坏处是**多付了多少钱被这个 max 吃掉了**。
  预付不设上限后，「预付 12000 / 订单 10000」是允许的，如果不额外把超付额算出来，
  老板会以为「未结 0 = 刚好付完」，而实际多给了供应商 2000。所以本补丁：

      未结 = max(0, 入库金额 − 预付 − 已付)          ← 保持原兜底语义（不为负）
      超付 = 未入库 ? max(0, 预付 − 订单金额)
                     : max(0, 预付 + 已付 − 入库金额)  ← 新增，界面必须显示

=====================================================================
三处既有缺陷（这些不是新功能，是已经躺在线上的 bug）
=====================================================================
🔴 缺陷 1：`_po_unpaid` 只减 `paid_amount`，不减预估。
   货没入库时 `received_amount = 0` ⇒ 未结恒为 0 ⇒ 就算加了预付按钮，
   `purchase_payment_create` 的「amount <= 未结」这道闸也会把每一笔都拒掉。
   不先改这一行，预付功能是摆设。

🔴 缺陷 2：`purchase_order_partial_receive`（分批到货）**不生成 receivables 应付行**。
   而 `purchase_payment_create` 硬性要求「必须有应付行」，否则直接拒。
   ⇒ 分批到货后状态变「部分入库」，但货款页提示「这张单没有对应的应付单，不用登记付款」，
     **部分到货的货永远付不了一分钱**。这是整条链上最贵的一个洞。

🔴 缺陷 3：`purchase_payment_create` 自己返回的 `unpaid_amount` 是
   `max(0, received − paid)`，**没有走刚改过的 `_po_unpaid`**。
   付款成功后前端拿这个值刷新界面 ⇒ 刚付完的那一笔在预付场景下显示错。

另外 `purchase_order_confirm` 的应付行是裸 `INSERT`。以前 confirm 只能跑一次
（状态守卫 draft|approved），分批到货补了应付行之后，一张单会「先有应付行、再 confirm」，
裸 INSERT 就会**生成第二张应付**。改成 UPSERT。

用法：
    python3 patch_v697_purchase_prepay.py --target=/opt/hergent-erp/db/queries/purchases.py [--dry-run]
"""
import sys
import shutil
import py_compile
from datetime import datetime
from pathlib import Path

DEFAULT_TARGET = Path("/opt/hergent-erp/db/queries/purchases.py")

# ─────────────────────────────────────────────────────────────
# 补丁 1：未结金额减去预付款（并补 overpaid 计算函数）
# ─────────────────────────────────────────────────────────────
UNPAID_OLD = '''    return max(0.0, _po_money(_po_get(o, "received_amount")) - _po_money(_po_get(o, "paid_amount")))'''

UNPAID_NEW = '''    return max(0.0, _po_money(_po_get(o, "received_amount"))
                  - _po_money(_po_get(o, "prepaid_amount"))
                  - _po_money(_po_get(o, "paid_amount")))


def _po_overpaid(o):
    """**超付金额**（元）。独立于 `_po_unpaid` 的 `max(0, ...)` 兜底。

    v697：老板定「预付不设上限」⇒ 允许预付超过订单金额。若不单独算这个数，
    多付的部分会被 `_po_unpaid` 的 max 吃掉，界面显示「未结 0」——
    那是**看起来刚刚好、实际多给了钱**，属于本仓最忌讳的静默错数。

    口径：
      · 货还没到（`received_amount == 0`）：只能拿订单金额比 ⇒ `max(0, 预付 − 订单金额)`
      · 货已到一部分/全部：拿实际到货金额比 ⇒ `max(0, 预付 + 已付 − 入库金额)`
        （用入库金额而不是订单金额，因为只需要为「真正收到的货」付钱）
    """
    _pre = _po_money(_po_get(o, "prepaid_amount"))
    _paid = _po_money(_po_get(o, "paid_amount"))
    _recv = _po_money(_po_get(o, "received_amount"))
    if _recv > 0:
        return max(0.0, _pre + _paid - _recv)
    return max(0.0, _pre - _po_money(_po_get(o, "total_amount")))'''

# ─────────────────────────────────────────────────────────────
# 补丁 2：付款成功后返回的未结金额走同一口径
# ─────────────────────────────────────────────────────────────
PAYRET_OLD = '''        o2 = db.execute("SELECT COALESCE(paid_amount,0) AS p, COALESCE(received_amount,0) AS r "
                        "FROM purchase_orders WHERE id=?", (oid,)).fetchone()
        return {"payment_id": pid, "order_id": oid, "amount": amt,
                "account": acc,
                "paid_amount": _po_money(o2["p"]),
                "unpaid_amount": max(0.0, _po_money(o2["r"]) - _po_money(o2["p"]))}'''

PAYRET_NEW = '''        o2 = db.execute("SELECT * FROM purchase_orders WHERE id=?", (oid,)).fetchone()
        _o2d = dict(o2) if o2 is not None else {}
        # 🔴 v697：未结金额必须走 `_po_unpaid`（它现在会减 `prepaid_amount`）。
        #    这里原先自己算 `max(0, received − paid)`，与列表页/货款页**不是同一个函数**
        #    ⇒ 预付场景下付款成功后前端拿到的是一个偏大的未结额，界面会「付了但没减」。
        return {"payment_id": pid, "order_id": oid, "amount": amt,
                "account": acc,
                "paid_amount": _po_money(_o2d.get("paid_amount")),
                "unpaid_amount": _po_unpaid(_o2d),
                "overpaid_amount": _po_overpaid(_o2d)}'''

# ─────────────────────────────────────────────────────────────
# 补丁 3：新增预付款登记（插在 purchase_order_inbound 之前）
# ─────────────────────────────────────────────────────────────
INBOUND_ANCHOR = '''def purchase_order_inbound(oid):'''

PREPAY_FUNC = '''def purchase_prepayment_create(oid, amount, account="现金", note="", operator_id=""):
    """给一张**已审待执行、货还没到**的采购单登记预付款。返回 dict。

    ⚠️ 与 `purchase_payment_create` 的分工（两个函数、两种前置条件，不要合并）：
      · 本函数 = **货未到、先给钱**：要求 `status='approved'`，**不碰应付行**（那时还没有）；
      · `purchase_payment_create` = **货已到、结货款**：要求有应付行，且金额 ≤ 未结。
      合并成一个函数会出现「到底按哪套前置条件校验」的歧义，且付款侧的五道安全性质
      会被预付款的宽松条件稀释 —— 钱的入口宁可分开写。

    🔴 为什么不写 `prepayments` 表（老板 2026-10-26 定「走货款流水」）：
       `prepayments` 的语义是**按供应商的往来账余额**（`supplier_balance` 就是拿它算的），
       一旦同一笔钱既在 `prepayments` 又在 `cash_flow`，就会出现「两处记账」，
       而这正是本仓在 `receivables` vs `purchase_orders` 上已经吃过一次亏的事
       （货款页那个「对不上」的黄色提示就是为它写的）。所以只有一个源：`cash_flow`。
       代价是往来账的「预付账款」在 `prepayments` 表里查不到 —— 已在界面上
       把两个概念分开写（本单预付 / 该供应商预付余额），不混淆。

    🔴 为什么预付也走 `auto_journal_for_payment`（借 2202 应付 / 贷 1002 银行）：
       看起来「预付应该记 1123 预付账款」。但入库时 `auto_journal_for_purchase` 会贷
       `2202` **全额**，如果预付记 1123，就还得在入库时补一张「1123 → 2202」的转账凭证，
       否则 2202 虚高、1123 挂着一个永远不会平的余额。统一记 2202 时，
       「入库贷全额 − 预付借部分 = 真实应付」**自动就平了**，不需要任何手工转账。
       小企业口径里这就是「应付账款借方余额」，实质等于预付，报表读得通。

    **不设金额上限**（老板明确要求）。但超付会被算进 `overpaid_amount` 并在货款页明示。
    """
    try:
        amt = round(float(amount or 0), 2)
    except (TypeError, ValueError):
        return {"error": "预付款金额不是合法数字"}
    if amt <= 0:
        return {"error": "预付款金额必须大于 0"}

    # 期间门禁：import 与 check **分开**（与 `purchase_payment_create` 同一条纪律 ——
    # `purchase_order_confirm` 那种 `try: import; check` 合并写法会把「关账被拒」吞成
    # 「import 失败」，钱的操作不能这样）。
    try:
        from erp_db import check_period_open as _cpo
    except Exception as e:  # pragma: no cover - 循环导入兜底
        _logger.warning("check_period_open import failed in purchase_prepayment_create: %s", e)
        _cpo = None
    if _cpo is not None:
        try:
            _cpo()
        except Exception as e:
            return {"error": str(e) or "会计期间已关闭，无法预付款"}

    # 懒建列：老租户库没有 prepaid_amount 时在这里补（一个进程只跑一次）
    _ensure_prepaid_column()

    with get_db_tx() as db:
        o = db.execute("SELECT * FROM purchase_orders WHERE id=?", (oid,)).fetchone()
        if not o:
            return {"error": "采购单不存在"}
        _od = dict(o)
        _st = str(_od.get("status") or "").strip()
        if _st != "approved":
            # 用中文状态说人话，不回显 `draft` 这种英文值（与本仓状态映射纪律一致）
            _zh = {"draft": "草稿（还没提交审核）",
                   "pending_approval": "待审批（等审批通过）",
                   "partial": "部分入库（货已到一部分，请用「付款」）",
                   "received": "已入库（货已到，请用「付款」）",
                   "returned": "已退货", "cancelled": "已取消"}.get(_st, _st or "未知")
            return {"error": f"只有「已审待执行」的采购单能预付款，当前是「{_zh}」"}

        acc = str(account or "现金").strip() or "现金"
        bal = db.execute("SELECT current_balance FROM accounts WHERE name=?", (acc,)).fetchone()
        db.execute("UPDATE accounts SET current_balance=current_balance-? WHERE name=?", (amt, acc))
        new_bal = (bal["current_balance"] if bal else 0) - amt
        # category 是「预付」与「付款」在流水上的唯一区分点（同表同 type='expense'）
        cur = db.execute(
            "INSERT INTO cash_flow (account,type,amount,balance_after,contact_id,ref_type,ref_id,"
            "category,note,operator_id) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (acc, "expense", amt, new_bal, _od.get("supplier_id") or 0, "purchase", oid,
             "采购预付款", note or "", operator_id or ""))
        pid = cur.lastrowid
        db.execute("UPDATE purchase_orders SET prepaid_amount=COALESCE(prepaid_amount,0)+? WHERE id=?",
                   (amt, oid))
        try:
            from erp_db import auto_journal_for_payment
            auto_journal_for_payment(pid, db_conn=db)
        except Exception as e:
            # 凭证失败必须回滚整笔预付：钱动了而账没记，比不付更坏
            # （与 `purchase_payment_create` 同一条硬纪律）。
            _logger.warning("auto_journal_for_payment failed in purchase_prepayment_create: %s", e)
            raise
        o2 = db.execute("SELECT * FROM purchase_orders WHERE id=?", (oid,)).fetchone()
        _o2d = dict(o2) if o2 is not None else {}
        return {"prepayment_id": pid, "order_id": oid, "amount": amt, "account": acc,
                "prepaid_amount": _po_money(_o2d.get("prepaid_amount")),
                "total_amount": _po_money(_o2d.get("total_amount")),
                "unpaid_amount": _po_unpaid(_o2d),
                "overpaid_amount": _po_overpaid(_o2d)}


'''

# ─────────────────────────────────────────────────────────────
# 补丁 4：货款页返回本单预付口径 + 付款模式判定
# ─────────────────────────────────────────────────────────────
PAYLOAD_OLD = '''                "unpaid_amount": unpaid,
                "prepaid_amount": _po_money(pp["v"] if pp else 0),'''

PAYLOAD_NEW = '''                "unpaid_amount": unpaid,
                # 🔴 v697：本字段**改为本单口径**（原来是该供应商所有预付的余额）。
                #    一旦本单能预付，继续用供应商口径就会把别的单的钱显示成这张单的。
                #    供应商口径仍在下面 `supplier_prepay`（P1-1 就在返回它）。
                "prepaid_amount": _po_money(od.get("prepaid_amount")),
                "overpaid_amount": _po_overpaid(od),
                # 付款模式：**后端说了算**，前端只渲染。判定见下方 _pay_mode。
                "pay_mode": _pay_mode,
                # 预付参考上限（不拦，只做界面提示）。老板定了「不设上限」。
                "prepay_cap": max(0.0, _po_money(od.get("total_amount")) - _po_money(od.get("prepaid_amount"))),'''

PAYLOAD_CALC_OLD = '''        unpaid = _po_unpaid(od, apd)'''

PAYLOAD_CALC_NEW = '''        unpaid = _po_unpaid(od, apd)
        # ── 付款 / 预付的**唯一判定**（v697）─────────────────────────────
        # 前端不许自己拿 received_amount 去猜，否则「界面说能预付、后端说状态不对」
        # 这类自相矛盾迟早出现。三种模式互斥：
        #   prepay = 货未到且已审 ⇒ 只能预付
        #   pay    = 有到货金额且未结 > 0 ⇒ 只能结货款
        #   none   = 其余（草稿/待审/已结清/已取消/已退货）
        _st_v = str(od.get("status") or "").strip()
        _recv_v = _po_money(od.get("received_amount"))
        if _st_v in ("cancelled", "returned"):
            _pay_mode = "none"
        elif _recv_v > 0:
            _pay_mode = "pay" if unpaid > 0.005 else "none"
        elif _st_v == "approved":
            _pay_mode = "prepay"
        else:
            _pay_mode = "none"'''

# ─────────────────────────────────────────────────────────────
# 补丁 4b：付款流水带上 `category`（区分预付 / 付款）
# ─────────────────────────────────────────────────────────────
FLOWS_OLD = '''        flows = [dict(r) for r in db.execute(
            "SELECT id, account, amount, note, operator_id, created_at FROM cash_flow "
            " WHERE ref_type='purchase' AND ref_id=? AND type='expense' "
            " ORDER BY id DESC", (oid,)).fetchall()]'''

FLOWS_NEW = '''        # 🔴 v697：必须带出 `category` —— 预付与付款在 `cash_flow` 里同为 `type='expense'`，
        #    唯一的区分点就是 category（'采购预付款' / '采购付款'）。不返回它，界面只能把
        #    两种钱混成一张表，用户看不出「这 500 是货没到就先给的」还是「这是结货款」。
        flows = [dict(r) for r in db.execute(
            "SELECT id, account, amount, note, operator_id, category, created_at FROM cash_flow "
            " WHERE ref_type='purchase' AND ref_id=? AND type='expense' "
            " ORDER BY id DESC", (oid,)).fetchall()]'''

# ─────────────────────────────────────────────────────────────
# 补丁 5b：分批到货**新建**应付行时，把已预付镜像到 paid_amount
# ─────────────────────────────────────────────────────────────
PARTIAL_MIRROR_OLD = '''        if _ap_row:
            # 只改金额，**不动 paid_amount / status** —— 已付过的钱与状态由付款链路负责。
            db.execute("UPDATE receivables SET amount=? WHERE id=?", (_ap_amt, _ap_row["id"]))
        else:
            db.execute("INSERT INTO receivables (type,contact_id,ref_type,ref_id,amount) "
                       "VALUES ('ap',?,'purchase',?,?)", (o["supplier_id"], oid, _ap_amt))'''

PARTIAL_MIRROR_NEW = '''        if _ap_row:
            # 只改金额，**不动 paid_amount / status** —— 已付过的钱与状态由付款链路负责。
            db.execute("UPDATE receivables SET amount=? WHERE id=?", (_ap_amt, _ap_row["id"]))
        else:
            _ap_id = db.execute("INSERT INTO receivables (type,contact_id,ref_type,ref_id,amount) "
                                "VALUES ('ap',?,'purchase',?,?)",
                                (o["supplier_id"], oid, _ap_amt)).lastrowid
            # 🔴 v697b：**预付款必须在应付行上留痕**（同 `confirm` 的理由，见那里的长注释）。
            #   只在**首次创建**应付行时写这一次；后续每次到货都覆盖的话，会把真实付款额
            #   重置回预付额（那是真的会丢账，而且不会报错）。
            _pre_m = min(_po_money(_po_get(o, "prepaid_amount")), _ap_amt)
            if _pre_m > 0:
                db.execute(
                    "UPDATE receivables SET paid_amount=?, "
                    "  status=CASE WHEN amount<=? THEN 'paid' ELSE 'partial' END WHERE id=?",
                    (_pre_m, _pre_m, _ap_id))'''

# ─────────────────────────────────────────────────────────────
# 补丁 6b：confirm 建/更新应付行后同样镜像预付
# ─────────────────────────────────────────────────────────────
CONFIRM_MIRROR_OLD = '''        if _ap_row:
            db.execute("UPDATE receivables SET amount=? WHERE id=?",
                       (o['total_amount'], _ap_row['id']))
        else:
            db.execute("INSERT INTO receivables (type,contact_id,ref_type,ref_id,amount) VALUES ('ap',?,'purchase',?,?)",(o['supplier_id'],oid,o['total_amount']))'''

CONFIRM_MIRROR_NEW = '''        if _ap_row:
            db.execute("UPDATE receivables SET amount=? WHERE id=?",
                       (o['total_amount'], _ap_row['id']))
            _ap_id = _ap_row['id']
        else:
            _ap_id = db.execute("INSERT INTO receivables (type,contact_id,ref_type,ref_id,amount) VALUES ('ap',?,'purchase',?,?)",(o['supplier_id'],oid,o['total_amount'])).lastrowid
        # 🔴 v697b：**预付款必须在应付行上留痕**。
        #    预付走的是 `cash_flow` + `purchase_orders.prepaid_amount`（老板定的口径：
        #    不另建预付款台账）。但 `receivables` 是往来账读的那张表 —— 如果不在它的
        #    `paid_amount` 上镜像一笔，就会出现：
        #       货款页「未结 ¥1,500」  vs  往来账「这笔应付还欠 ¥2,000」
        #    两处记账分叉，正是货款页那个黄色警告要报的错，而且老板会真的不知道该信谁。
        #    镜像值 = 已预付（**封顶到应付金额**）：多付的部分不进应付，
        #    由 `overpaid_amount` 单独提示（不设上限是老板定的，但多付的钱不能悄悄滑进应付）。
        _pre_m = min(_po_money(_po_get(o, "prepaid_amount")), _po_money(o['total_amount']))
        if _pre_m > 0:
            db.execute(
                "UPDATE receivables SET paid_amount=?, "
                "  status=CASE WHEN amount<=? THEN 'paid' ELSE 'partial' END WHERE id=?",
                (_pre_m, _pre_m, _ap_id))'''

# ─────────────────────────────────────────────────────────────
# 补丁 5：分批到货补应付行
# ─────────────────────────────────────────────────────────────
PARTIAL_OLD = '''        # Set status
        if received_count >= total_count:'''

PARTIAL_NEW = '''        # 🔴 v697（缺陷 2）：分批到货**必须同步应付行**。
        #    此前本函数只写 `received_amount`，不建 `receivables` ⇒ 状态是「部分入库」，
        #    但 `purchase_payment_create` 的「必须有应付行」那道闸会直接把付款拒掉
        #    ⇒ **分批到货的货永远付不了一分钱**，而且界面上给的理由是
        #    「这张单没有对应的应付单，不用登记付款」—— 看起来像"确实不用付"，属于静默失效。
        #    金额口径：到齐用 `total_amount`（与 `confirm` 一致，订单金额可能是外部权威值），
        #    未到齐用 `recv_amt`（只欠已到货部分，不该为没到的货付钱）。
        _ap_amt = (_po_money(_po_get(o, "total_amount"))
                   if received_count >= total_count else recv_amt)
        _ap_row = db.execute(
            "SELECT id FROM receivables WHERE type='ap' AND ref_type='purchase' AND ref_id=? "
            "ORDER BY id LIMIT 1", (oid,)).fetchone()
        if _ap_row:
            # 只改金额，**不动 paid_amount / status** —— 已付过的钱与状态由付款链路负责。
            db.execute("UPDATE receivables SET amount=? WHERE id=?", (_ap_amt, _ap_row["id"]))
        else:
            db.execute("INSERT INTO receivables (type,contact_id,ref_type,ref_id,amount) "
                       "VALUES ('ap',?,'purchase',?,?)", (o["supplier_id"], oid, _ap_amt))
        # Set status
        if received_count >= total_count:'''

# ─────────────────────────────────────────────────────────────
# 补丁 6：confirm 的应付行改 UPSERT（分批到货已建行时不能再插一条）
# ─────────────────────────────────────────────────────────────
CONFIRM_AP_OLD = '''        db.execute("INSERT INTO receivables (type,contact_id,ref_type,ref_id,amount) VALUES ('ap',?,'purchase',?,?)",(o['supplier_id'],oid,o['total_amount']))'''

CONFIRM_AP_NEW = '''        # 🔴 v697：改 UPSERT。分批到货（`purchase_order_partial_receive`）现在会先建应付行，
        #    若这里仍是裸 INSERT，同一张单会出现**两条 ap 行** ⇒ 往来账应付翻倍、
        #    货款页 `ORDER BY id LIMIT 1` 只读到第一条，第二条永远没人管。
        _ap_row = db.execute(
            "SELECT id FROM receivables WHERE type='ap' AND ref_type='purchase' AND ref_id=? "
            "ORDER BY id LIMIT 1", (oid,)).fetchone()
        if _ap_row:
            db.execute("UPDATE receivables SET amount=? WHERE id=?",
                       (o['total_amount'], _ap_row['id']))
        else:
            db.execute("INSERT INTO receivables (type,contact_id,ref_type,ref_id,amount) VALUES ('ap',?,'purchase',?,?)",(o['supplier_id'],oid,o['total_amount']))'''

# ─────────────────────────────────────────────────────────────
# 补丁 7：prepaid_amount 列（幂等 ALTER）
# ─────────────────────────────────────────────────────────────
ENSURE_COL_ANCHOR = '''def purchase_order_create('''

ENSURE_COL_FUNC = '''_PREPAID_COL_READY = [False]


def _ensure_prepaid_column():
    """幂等给 `purchase_orders` 加 `prepaid_amount`（v697）。

    ⚠️ **不在模块导入时调用**：导入期执行 DDL 会让「导入这个模块」带副作用，
       而且那时连接池/租户上下文未必就绪。改为在**第一次真的要写预付款**时懒执行
       （`purchase_prepayment_create` 开头），并用模块级标志位保证一个进程只跑一次。
    ⚠️ 老租户库不会走建表语句（那只在空库执行）⇒ 必须靠 ALTER 补齐，这就是本函数存在的理由。
    """
    if _PREPAID_COL_READY[0]:
        return
    try:
        with get_db() as db:
            cols = {r[1] for r in db.execute("PRAGMA table_info(purchase_orders)").fetchall()}
            if "prepaid_amount" not in cols:
                db.execute("ALTER TABLE purchase_orders ADD COLUMN prepaid_amount REAL DEFAULT 0")
                db.commit()
                _logger.info("v697: purchase_orders.prepaid_amount 已新增")
        _PREPAID_COL_READY[0] = True
    except Exception as e:  # pragma: no cover
        # 不置 True：下次调用重试（列缺失不该变成永久禁用预付款）
        _logger.warning("_ensure_prepaid_column failed: %s", e)


'''


def apply(text, old, new, label, results):
    if new in text:
        results.append(("SKIP", label, "已是新版，跳过"))
        return text
    if old not in text:
        results.append(("FAIL", label, "锚点未命中"))
        return text
    if text.count(old) != 1:
        results.append(("FAIL", label, f"锚点出现 {text.count(old)} 次，不唯一"))
        return text
    results.append(("OK", label, ""))
    return text.replace(old, new, 1)


def main():
    args = [a for a in sys.argv[1:]]
    dry = "--dry-run" in args
    target = DEFAULT_TARGET
    for a in args:
        if a.startswith("--target="):
            target = Path(a.split("=", 1)[1])
    if not target.exists():
        print(f"目标文件不存在: {target}")
        return 1

    src = target.read_text(encoding="utf-8")
    out = src
    results = []

    out = apply(out, UNPAID_OLD, UNPAID_NEW, "1. 未结金额减预付 + 新增超付算法", results)
    out = apply(out, PAYRET_OLD, PAYRET_NEW, "2. 付款返回的未结走统一口径", results)
    out = apply(out, PAYLOAD_CALC_OLD, PAYLOAD_CALC_NEW, "3. 付款模式判定 pay_mode", results)
    out = apply(out, PAYLOAD_OLD, PAYLOAD_NEW, "4. 货款页返回本单预付/超付", results)
    out = apply(out, FLOWS_OLD, FLOWS_NEW, "4b. 流水带 category（区分预付/付款）", results)
    out = apply(out, PARTIAL_OLD, PARTIAL_NEW, "5. 分批到货补应付行", results)
    out = apply(out, CONFIRM_AP_OLD, CONFIRM_AP_NEW, "6. confirm 应付行改 UPSERT", results)
    # 6b / 5b 必须排在 6 / 5 之后：它们的锚点是 6 / 5 生成的新代码
    out = apply(out, CONFIRM_MIRROR_OLD, CONFIRM_MIRROR_NEW, "6b. confirm 应付行镜像预付", results)
    out = apply(out, PARTIAL_MIRROR_OLD, PARTIAL_MIRROR_NEW, "5b. 分批到货应付行镜像预付", results)
    out = apply(out, INBOUND_ANCHOR, PREPAY_FUNC + INBOUND_ANCHOR,
                "7. 新增 purchase_prepayment_create", results)
    out = apply(out, ENSURE_COL_ANCHOR, ENSURE_COL_FUNC + ENSURE_COL_ANCHOR,
                "8. prepaid_amount 列（幂等）", results)

    print("=" * 62)
    for st, label, note in results:
        mark = {"OK": "✅", "SKIP": "⏭ ", "FAIL": "❌"}[st]
        print(f"{mark} {label}" + (f"  ← {note}" if note else ""))
    print("=" * 62)
    if any(r[0] == "FAIL" for r in results):
        print("有锚点未命中，未写入任何文件。")
        return 2
    if out == src:
        print("内容无变化（全部已是新版），未写入。")
        return 0

    if dry:
        print("--dry-run：未写入文件。")
        return 0

    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    bak = target.with_suffix(target.suffix + f".bak-v697-{ts}")
    shutil.copy2(target, bak)
    target.write_text(out, encoding="utf-8")
    try:
        py_compile.compile(str(target), doraise=True)
    except Exception as e:
        shutil.copy2(bak, target)
        print(f"❌ 语法检查失败，已回滚：{e}")
        return 3
    print(f"✅ 已写入 {target}\n   备份 {bak}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
