#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v697c：修「采购单审核后既不能预付、也不能入库」——状态值错配。

=====================================================================
🔴 根因（生产实测，不是推测）
=====================================================================
老板 2026-10-27 反馈「看不到 付款 / 预付款 / 入库 入口」。实测生产库
`/opt/hergent-erp/tenant_1.db`：

    SELECT status, COUNT(*) FROM purchase_orders GROUP BY status
      → received=79, confirmed=2, draft=2, cancelled=1

**生产根本没有 `approved` 这个状态。** v417「保存并审核」落库写的是 **`confirmed`**
（`purchase_order_approve` / 作废 / 提交审核 三处守卫都认 `confirmed`，可自证）。
而 v697 我写的判定是：

    elif _st_v == "approved":   pay_mode = "prepay"

⇒ 那 2 张已审单（id 178/179）永远拿不到 `prepay`，**预付款按钮永不出现**。

第二处：`received_amount` 是 **v403 才加的列**，79 张舟谱导入单在导入时就被直接标成
`received`、没走 `confirm` ⇒ 这一列全是 0。而 pay_mode 判「已到货」只看
`received_amount > 0` ⇒ **付款按钮对这 79 张历史欠款单也永不出现**
（这批恰恰是老板最想核账的）。

第三处（比我上轮修的三个洞更致命，是**后端自身**的状态机断裂）：
`purchase_order_confirm`（整单入库）守卫是 `status IN ('draft','approved')`，
分批是 `('draft','approved','partial')` —— **都不收 `confirmed`**
⇒ 审核通过的单**根本入不了库**，前端按后端守卫逐字写的 `canConfirm` 自然也不显示按钮。
不是前端写错，是后端漏了 `confirmed`。

=====================================================================
修法（4 处，全部向后兼容，不动存量数据）
=====================================================================
1. 整单入库守卫补 `confirmed`
2. 分批入库守卫补 `confirmed`
3. 新增 `_po_received_amount(o)`：**到货金额的唯一读法**。
   `received_amount` 为 0 且 `status='received'`（整单到齐语义）⇒ 真值就是订单金额。
   （只对 `received` 兜底；`partial` 不猜 —— 分批到货金额未知，猜就是造数。）
4. `_po_unpaid` / `_po_overpaid` / `pay_mode` / 接口返回的 `received_amount`
   全部改走 `_po_received_amount`；pay_mode 的 `approved` 扩成 `("approved","confirmed")`。

用法：
    python3 patch_v697c_confirmed_state.py --target=/opt/hergent-erp/db/queries/purchases.py [--dry-run]
"""
import sys
import shutil
import py_compile
from datetime import datetime
from pathlib import Path

DEFAULT_TARGET = Path("/opt/hergent-erp/db/queries/purchases.py")

# ─────────────────────────────────────────────────────────────
# 补丁 1：整单入库守卫补 `confirmed`
# ─────────────────────────────────────────────────────────────
CONFIRM_GUARD_OLD = '''        o = db.execute("SELECT * FROM purchase_orders WHERE id=? AND status IN ('draft','approved')",(oid,)).fetchone()
        if not o: return {'error': '状态错误：订单待审批或已确认'}'''

CONFIRM_GUARD_NEW = '''        # v697c：守卫补 `confirmed`。审核落库写的是 `confirmed`（v417「保存并审核」），
        #   而这里原本只收 ('draft','approved') ⇒ **审核通过的单根本入不了库**
        #   （前端 canConfirm 与后端逐字对齐，所以按钮也不显示 —— 老板看到的「没有入库入口」）。
        #   `approved` 保留：存量/其他链路可能有这个值，去掉是破坏性变更。
        o = db.execute("SELECT * FROM purchase_orders WHERE id=? AND status IN ('draft','approved','confirmed')",(oid,)).fetchone()
        if not o: return {'error': '状态错误：该单已作废 / 已入库，不能重复入库'}'''

# ─────────────────────────────────────────────────────────────
# 补丁 2：分批入库守卫补 `confirmed`
# ─────────────────────────────────────────────────────────────
PARTIAL_GUARD_OLD = '''        o = db.execute("SELECT * FROM purchase_orders WHERE id=? AND status IN ('draft','approved','partial')",(oid,)).fetchone()'''

PARTIAL_GUARD_NEW = '''        # v697c：同上，补 `confirmed`。
        o = db.execute("SELECT * FROM purchase_orders WHERE id=? AND status IN ('draft','approved','confirmed','partial')",(oid,)).fetchone()'''

# ─────────────────────────────────────────────────────────────
# 补丁 3：新增 `_po_received_amount`（到货金额的唯一读法）
# ─────────────────────────────────────────────────────────────
UNPAID_DEF_ANCHOR = '''def _po_unpaid(o, ap=None):'''

RECV_FUNC = '''def _po_received_amount(o):
    """**到货金额**（元）—— 全仓唯一的读法。v697c：历史单兜底。

    🔴 为什么需要它：`received_amount` 是 **v403 才加的列**。v403 之前落库的单
       （生产 79 张舟谱导入单，导入时直接标 `received`、没走 `confirm`）这一列是 0。
       若直接拿 0 当「一分货没到」：
         · `_po_unpaid` = max(0, 0 − 预付 − 已付) = 0 ⇒ **「付款」按钮永远不出现**；
         · 这批恰恰是老板最想核账的历史欠款单 —— 界面表现为「还能看，就是付不了钱」，
           典型的静默失效。
    🔴 为什么敢用订单金额兜底：`received` 这个状态就是**整单到齐**语义
       （`purchase_order_confirm` 整单全收才置它），所以到货金额的真值就是订单金额。
    🔴 为什么**只对 `received` 兜底**：`partial`（分批）到货了多少是未知数，
       拿订单金额顶上去就是**造数** —— 宁可显示 0（并在货款页提示），也不猜。
       生产当前 `partial` 为 0 张，不影响。
    """
    v = _po_money(_po_get(o, "received_amount"))
    if v <= 0 and str(_po_get(o, "status", "") or "").strip() == "received":
        return _po_money(_po_get(o, "total_amount"))
    return v


def _po_unpaid(o, ap=None):'''

# ─────────────────────────────────────────────────────────────
# 补丁 4：`_po_unpaid` 改走 `_po_received_amount`
# ─────────────────────────────────────────────────────────────
UNPAID_BODY_OLD = '''    return max(0.0, _po_money(_po_get(o, "received_amount"))
                  - _po_money(_po_get(o, "prepaid_amount"))
                  - _po_money(_po_get(o, "paid_amount")))'''

UNPAID_BODY_NEW = '''    return max(0.0, _po_received_amount(o)
                  - _po_money(_po_get(o, "prepaid_amount"))
                  - _po_money(_po_get(o, "paid_amount")))'''

# ─────────────────────────────────────────────────────────────
# 补丁 5：`_po_overpaid` 改走 `_po_received_amount`
# ─────────────────────────────────────────────────────────────
OVERPAID_BODY_OLD = '''    _recv = _po_money(_po_get(o, "received_amount"))'''

OVERPAID_BODY_NEW = '''    _recv = _po_received_amount(o)'''

# ─────────────────────────────────────────────────────────────
# 补丁 6：pay_mode 认 `confirmed`，且「已到货」走兜底
# ─────────────────────────────────────────────────────────────
PAYMODE_RECV_OLD = '''        _recv_v = _po_money(od.get("received_amount"))'''

PAYMODE_RECV_NEW = '''        _recv_v = _po_received_amount(od)'''

PAYMODE_APPROVED_OLD = '''        elif _st_v == "approved":
            _pay_mode = "prepay"'''

PAYMODE_APPROVED_NEW = '''        # v697c：`confirmed` 才是生产真实的「已审待执行」（v417 定的），`approved` 保留兼容。
        elif _st_v in ("approved", "confirmed"):
            _pay_mode = "prepay"'''

# ─────────────────────────────────────────────────────────────
# 补丁 7：接口返回的入库金额也走兜底（否则界面显示 ¥0.00 而按钮又是亮的，自相矛盾）
# ─────────────────────────────────────────────────────────────
RET_RECV_OLD = '''                "received_amount": _po_money(od.get("received_amount")),'''

RET_RECV_NEW = '''                "received_amount": _po_received_amount(od),'''


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

    out = apply(out, CONFIRM_GUARD_OLD, CONFIRM_GUARD_NEW, "1. 整单入库守卫补 confirmed", results)
    out = apply(out, PARTIAL_GUARD_OLD, PARTIAL_GUARD_NEW, "2. 分批入库守卫补 confirmed", results)
    out = apply(out, UNPAID_DEF_ANCHOR, RECV_FUNC, "3. 新增 _po_received_amount", results)
    out = apply(out, UNPAID_BODY_OLD, UNPAID_BODY_NEW, "4. _po_unpaid 走兜底", results)
    out = apply(out, OVERPAID_BODY_OLD, OVERPAID_BODY_NEW, "5. _po_overpaid 走兜底", results)
    out = apply(out, PAYMODE_RECV_OLD, PAYMODE_RECV_NEW, "6. pay_mode 已到货走兜底", results)
    out = apply(out, PAYMODE_APPROVED_OLD, PAYMODE_APPROVED_NEW, "7. pay_mode 认 confirmed", results)
    out = apply(out, RET_RECV_OLD, RET_RECV_NEW, "8. 接口返回入库金额走兜底", results)

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
    bak = target.with_suffix(target.suffix + f".bak-v697c-{ts}")
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
