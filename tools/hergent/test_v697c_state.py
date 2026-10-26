#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v697c 验证：**只读**，在生产 tenant_1 真实数据上验证状态判定。

与 v697 那批测试的区别：v697 用的是造出来的数据，结果全绿但**没验到生产真实状态值**
⇒ 老板打开线上说「看不到入口」。本脚本直接读生产库里**真实存在的单**，
断言 `pay_mode` / 入库守卫在真实状态值下的行为。

用法（在生产机上跑）：
    python3 test_v697c_state.py
"""
import os
import sys

sys.path.insert(0, "/opt/hergent-erp")

from db.connection import set_tenant_context  # noqa: E402

set_tenant_context(1)

import sqlite3  # noqa: E402

from db.queries.purchases import (  # noqa: E402
    purchase_order_payments,
    _po_unpaid,
    _po_overpaid,
    _po_received_amount,
)

DB = "/opt/hergent-erp/tenant_1.db"

PASS = 0
FAIL = 0


def ck(name, ok, detail=""):
    global PASS, FAIL
    if ok:
        PASS += 1
        print("  ✅ " + name)
    else:
        FAIL += 1
        print("  ❌ " + name + "  " + detail)


def main():
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    rows = con.execute(
        "SELECT id, order_no, status, total_amount, "
        "COALESCE(received_amount,0) ra, COALESCE(paid_amount,0) pa, "
        "COALESCE(prepaid_amount,0) pre "
        "FROM purchase_orders ORDER BY id").fetchall()

    by_status = {}
    for r in rows:
        by_status.setdefault(r["status"], []).append(r)
    print("生产状态分布：" + ", ".join(f"{k}={len(v)}" for k, v in sorted(by_status.items())))

    # ── 1. confirmed 的单必须能预付（v697 在这里判的是 approved ⇒ 永远 prepay 不到）
    print("\n[1] confirmed（生产真实的「已审待执行」）→ 必须能预付")
    conf = by_status.get("confirmed", [])
    if not conf:
        print("  ⚠️  生产没有 confirmed 状态的单，跳过（不代表通过）")
    for r in conf:
        p = purchase_order_payments(r["id"])
        od = p.get("order") or {}
        ck(f"单 {r['id']} ({r['order_no']}) pay_mode=prepay",
           od.get("pay_mode") == "prepay", f"实际={od.get('pay_mode')}")
        ck(f"单 {r['id']} 未结=0（货没到不该有未结）",
           abs(_po_unpaid(dict(r)) - 0) < 0.005, f"实际={_po_unpaid(dict(r))}")

    # ── 2. received 且 received_amount=0 的老单（v403 前落库）→ 必须能付款
    print("\n[2] received 老单（received_amount=0，舟谱导入没回填）→ 必须能付款")
    recv0 = [r for r in by_status.get("received", []) if r["ra"] <= 0]
    print(f"  这类单共 {len(recv0)} 张（v697c 之前它们的「付款」按钮全部不显示）")
    for r in recv0[:3]:
        od = dict(r)
        ck(f"单 {r['id']} 到货金额兜底 = 订单金额 {r['total_amount']}",
           abs(_po_received_amount(od) - r["total_amount"]) < 0.005,
           f"实际={_po_received_amount(od)}")
        ck(f"单 {r['id']} 未结 = {r['total_amount']} - 预付 - 已付",
           abs(_po_unpaid(od) - max(0.0, r["total_amount"] - r["pre"] - r["pa"])) < 0.005,
           f"实际={_po_unpaid(od)}")
        p = purchase_order_payments(r["id"])
        po = p.get("order") or {}
        ck(f"单 {r['id']} pay_mode=pay", po.get("pay_mode") == "pay",
           f"实际={po.get('pay_mode')}")
        ck(f"单 {r['id']} 接口返回入库金额已兜底",
           abs(float(po.get("received_amount") or 0) - r["total_amount"]) < 0.005,
           f"实际={po.get('received_amount')}")

    # ── 3. cancelled / draft：都不能预付
    print("\n[3] 不能预付的状态")
    for st in ("cancelled", "draft"):
        for r in by_status.get(st, [])[:1]:
            p = purchase_order_payments(r["id"])
            po = p.get("order") or {}
            ck(f"{st} 单 {r['id']} pay_mode≠prepay", po.get("pay_mode") != "prepay",
               f"实际={po.get('pay_mode')}")

    # ── 4. 入库守卫必须收 confirmed（不真跑入库，只验守卫能命中）
    print("\n[4] 入库守卫必须能选中 confirmed 的单（只读验 SQL，不执行入库）")
    for r in conf:
        hit = con.execute(
            "SELECT id FROM purchase_orders WHERE id=? "
            "AND status IN ('draft','approved','confirmed')", (r["id"],)).fetchone()
        ck(f"单 {r['id']} 命中整单入库守卫", hit is not None)
        hit2 = con.execute(
            "SELECT id FROM purchase_orders WHERE id=? "
            "AND status IN ('draft','approved','confirmed','partial')", (r["id"],)).fetchone()
        ck(f"单 {r['id']} 命中分批入库守卫", hit2 is not None)
    # 已入库 / 已取消不能被守卫选中（防重复入库）
    for r in by_status.get("received", [])[:1] + by_status.get("cancelled", [])[:1]:
        hit = con.execute(
            "SELECT id FROM purchase_orders WHERE id=? "
            "AND status IN ('draft','approved','confirmed')", (r["id"],)).fetchone()
        ck(f"{r['status']} 单 {r['id']} 不命中入库守卫（防重复入库）", hit is None)

    # ── 5. partial 不兜底（分批到货金额未知，猜就是造数）
    print("\n[5] partial 不做金额兜底（宁可显示 0 也不猜）")
    fake = {"status": "partial", "received_amount": 0, "total_amount": 9999}
    ck("partial 且 received_amount=0 → 到货金额仍为 0",
       abs(_po_received_amount(fake) - 0) < 0.005, f"实际={_po_received_amount(fake)}")
    fake2 = {"status": "draft", "received_amount": 0, "total_amount": 9999}
    ck("draft 且 received_amount=0 → 到货金额仍为 0",
       abs(_po_received_amount(fake2) - 0) < 0.005, f"实际={_po_received_amount(fake2)}")

    # ── 6. 超付口径仍成立
    print("\n[6] 超付口径（不设上限的配套）")
    ck("未到货：预付 2500 / 订单 2000 → 超付 500",
       abs(_po_overpaid({"status": "confirmed", "received_amount": 0,
                         "total_amount": 2000, "prepaid_amount": 2500,
                         "paid_amount": 0}) - 500) < 0.005)
    ck("已到齐：预付 500 + 已付 2000 / 到货 2000 → 超付 500",
       abs(_po_overpaid({"status": "received", "received_amount": 2000,
                         "total_amount": 2000, "prepaid_amount": 500,
                         "paid_amount": 2000}) - 500) < 0.005)

    print("\n" + "=" * 62)
    print(f"通过 {PASS} / 失败 {FAIL}")
    print("=" * 62)
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
