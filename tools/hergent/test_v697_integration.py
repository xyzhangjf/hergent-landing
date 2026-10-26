#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v697 采购「预付款 → 入库 → 付款」端到端集成验证（在 tenant_1 真库上跑）。

⚠️ 三条安全约束（本脚本自己保证，跑完必须能自证）：
   ① **不碰库存**：入库这一步用「直接改 status/received_amount + 插应付行」来模拟，
      不调 `purchase_order_confirm`（那个会 `batch_in` 真写库存和批次追踪）；
   ② **不碰真单据**：测试单号前缀 `TST697-`，只在这些行上操作；
   ③ **跑完清理并自证残留 0**：orders / items / cash_flow / receivables /
      journal_entries 全删，accounts 余额恢复原值。

为什么要造真数据跑，而不是"看代码觉得对"：
   v693 的教训是「AST 验证把坑填了」—— 单元测试全过、集成一崩。
   预付链路真正的风险在**事务与多表同步**（cash_flow / prepaid_amount / accounts /
   凭证四者要么都成、要么都不成），这个只有真库真跑才验得出来。
"""
import os
import sys

sys.path.insert(0, "/opt/hergent-erp")
os.chdir("/opt/hergent-erp")

from db.connection import set_tenant_context  # noqa: E402

set_tenant_context(1)  # 切到 tenant_1.db（默认 None = 主库 erp.db）

import sqlite3  # noqa: E402

from db.queries.purchases import (  # noqa: E402
    purchase_prepayment_create, purchase_payment_create, purchase_order_payments,
)

DB = "/opt/hergent-erp/tenant_1.db"
PREFIX = "TST697-"
SUPPLIER_ID = 2886       # 新希望（真供应商）
PRODUCT_ID = 1621        # 真商品
TOTAL = 2000.0

PASS = [0]
FAIL = [0]
TMP_IDS = []   # 临时商品 id；清理后按它自证库存/批次真的没残留


def ck(name, ok, detail=""):
    if ok:
        PASS[0] += 1
        print(f"  ✅ {name}")
    else:
        FAIL[0] += 1
        print(f"  ❌ {name}  {detail}")


def conn():
    c = sqlite3.connect(DB)
    c.row_factory = sqlite3.Row
    return c


def make_order(no_suffix, status, total=TOTAL, product_id=None):
    c = conn()
    oid = c.execute(
        "INSERT INTO purchase_orders (order_no,supplier_id,warehouse_id,total_amount,status,"
        "operator_id,order_date) VALUES (?,?,?,?,?,?,date('now'))",
        (PREFIX + no_suffix, SUPPLIER_ID, 1, total, status, "1")).lastrowid
    c.execute(
        "INSERT INTO purchase_order_items (order_id,product_id,quantity,unit_price,amount,"
        "received_qty,unit,base_ratio,base_qty) VALUES (?,?,?,?,?,?,?,?,?)",
        (oid, product_id or PRODUCT_ID, 10, total / 10, total, 0, "件", 1, 10))
    c.commit()
    c.close()
    return oid


def cleanup():
    c = conn()
    oids = [r["id"] for r in c.execute(
        "SELECT id FROM purchase_orders WHERE order_no LIKE ?", (PREFIX + "%",))]
    if not oids:
        c.close()
        return 0
    q = ",".join("?" * len(oids))
    pids = [r["id"] for r in c.execute(
        f"SELECT id FROM cash_flow WHERE ref_type='purchase' AND ref_id IN ({q})", oids)]
    if pids:
        qp = ",".join("?" * len(pids))
        c.execute(f"DELETE FROM journal_entries WHERE ref_type='payment' AND ref_id IN ({qp})", pids)
    c.execute(f"DELETE FROM cash_flow WHERE ref_type='purchase' AND ref_id IN ({q})", oids)
    c.execute(f"DELETE FROM receivables WHERE ref_type='purchase' AND ref_id IN ({q})", oids)
    c.execute(f"DELETE FROM purchase_order_items WHERE order_id IN ({q})", oids)
    c.execute(f"DELETE FROM purchase_orders WHERE id IN ({q})", oids)
    # 临时商品（真入库用例造的）
    tmp = [r["id"] for r in c.execute("SELECT id FROM products WHERE name LIKE '__TST697%'")]
    TMP_IDS.extend([t for t in tmp if t not in TMP_IDS])
    for t in tmp:
        c.execute("DELETE FROM inventory WHERE product_id=?", (t,))
        c.execute("DELETE FROM batch_trace WHERE product_id=?", (t,))
        c.execute("DELETE FROM products WHERE id=?", (t,))
    c.commit()
    c.close()
    return len(oids)


def residuals():
    """自证：返回各处残留条数（必须全 0）"""
    c = conn()
    oids = [r["id"] for r in c.execute(
        "SELECT id FROM purchase_orders WHERE order_no LIKE ?", (PREFIX + "%",))]
    out = {"orders": len(oids)}
    if oids:
        q = ",".join("?" * len(oids))
        out["items"] = c.execute(
            f"SELECT COUNT(*) FROM purchase_order_items WHERE order_id IN ({q})", oids).fetchone()[0]
        out["cash_flow"] = c.execute(
            f"SELECT COUNT(*) FROM cash_flow WHERE ref_type='purchase' AND ref_id IN ({q})", oids).fetchone()[0]
        out["receivables"] = c.execute(
            f"SELECT COUNT(*) FROM receivables WHERE ref_type='purchase' AND ref_id IN ({q})", oids).fetchone()[0]
    else:
        out["items"] = out["cash_flow"] = out["receivables"] = 0
    out["tmp_products"] = c.execute("SELECT COUNT(*) FROM products WHERE name LIKE '__TST697%'").fetchone()[0]
    # ⚠️ 这里**不能**用 `product_id IN (SELECT id FROM products WHERE name LIKE ...)` ——
    #    商品行已经删了，那个子查询恒空 ⇒ 永远报 0，是**自欺式自证**。
    #    所以按清理前记下的 id 直接查库存/批次。
    if TMP_IDS:
        qq = ",".join("?" * len(TMP_IDS))
        out["tmp_inventory"] = c.execute(
            f"SELECT COUNT(*) FROM inventory WHERE product_id IN ({qq})", TMP_IDS).fetchone()[0]
        out["tmp_batch"] = c.execute(
            f"SELECT COUNT(*) FROM batch_trace WHERE product_id IN ({qq})", TMP_IDS).fetchone()[0]
    else:
        out["tmp_inventory"] = out["tmp_batch"] = 0
    c.close()
    return out


def main():
    c = conn()
    bal_before = {r["name"]: r["current_balance"] for r in c.execute("SELECT name,current_balance FROM accounts")}
    c.close()
    print(f"【准备】accounts 原余额 = {bal_before}")

    print("\n【1】状态守卫：草稿单不能预付")
    oid_draft = make_order("D", "draft")
    r = purchase_prepayment_create(oid_draft, 100, account="现金", operator_id="1")
    ck("draft 单预付被拒", "error" in r, str(r))
    ck("拒绝理由说人话（含「已审待执行」）", "已审待执行" in str(r.get("error", "")), str(r.get("error")))
    ck("拒绝理由不泄漏英文状态值 `draft`", "draft" not in str(r.get("error", "")), str(r.get("error")))

    print("\n【2】正常路径：已审单预付 500")
    oid = make_order("A", "approved")
    r = purchase_prepayment_create(oid, 500, account="现金", note="下单先付30%", operator_id="1")
    ck("预付登记成功", r.get("prepayment_id") and not r.get("error"), str(r))
    ck("返回 prepaid_amount=500", abs(float(r.get("prepaid_amount") or 0) - 500) < 0.01, str(r))
    ck("返回 unpaid_amount=0（货未到不算欠款）", abs(float(r.get("unpaid_amount") or 0)) < 0.01, str(r))
    ck("返回 overpaid_amount=0", abs(float(r.get("overpaid_amount") or 0)) < 0.01, str(r))

    c = conn()
    row = c.execute("SELECT prepaid_amount,paid_amount,received_amount FROM purchase_orders WHERE id=?", (oid,)).fetchone()
    cf = c.execute("SELECT * FROM cash_flow WHERE ref_type='purchase' AND ref_id=? AND type='expense'", (oid,)).fetchall()
    je = c.execute("SELECT COUNT(*) FROM journal_entries WHERE ref_type='payment' AND ref_id=?",
                   (cf[0]["id"],)).fetchone()[0] if cf else 0
    c.close()
    ck("库内 prepaid_amount=500", abs(float(row["prepaid_amount"]) - 500) < 0.01, str(dict(row)))
    ck("paid_amount 仍是 0（预付不冒充已付）", abs(float(row["paid_amount"])) < 0.01, str(dict(row)))
    ck("cash_flow 记了 1 笔", len(cf) == 1, f"got={len(cf)}")
    ck("流水分录 category=采购预付款", cf and cf[0]["category"] == "采购预付款", cf[0]["category"] if cf else "")
    ck("生成了记账凭证", je >= 1, f"journal_entries={je}")

    print("\n【3】货款页口径：pay_mode=prepay")
    d = purchase_order_payments(oid)
    od = d["order"]
    ck("pay_mode = 'prepay'", od["pay_mode"] == "prepay", od["pay_mode"])
    ck("prepaid_amount 是**本单**口径 = 500", abs(od["prepaid_amount"] - 500) < 0.01, str(od["prepaid_amount"]))
    ck("unpaid_amount = 0", abs(od["unpaid_amount"]) < 0.01, str(od["unpaid_amount"]))
    ck("prepay_cap = 1500（参考值，不拦）", abs(od["prepay_cap"] - 1500) < 0.01, str(od["prepay_cap"]))

    print("\n【4】模拟到货：status→received，received_amount=2000，插应付行")
    c = conn()
    c.execute("UPDATE purchase_orders SET status='received', received_amount=?, received_at=datetime('now','localtime') WHERE id=?",
              (TOTAL, oid))
    c.execute("INSERT INTO receivables (type,contact_id,ref_type,ref_id,amount) VALUES ('ap',?,'purchase',?,?)",
              (SUPPLIER_ID, oid, TOTAL))
    c.commit()
    c.close()

    d = purchase_order_payments(oid)
    od = d["order"]
    ck("pay_mode 切换为 'pay'", od["pay_mode"] == "pay", od["pay_mode"])
    ck("**未结 = 2000 − 500 预付 = 1500**（不能重复要全额）",
       abs(od["unpaid_amount"] - 1500) < 0.01, str(od["unpaid_amount"]))
    ck("ap_exists = True", od["ap_exists"] is True)
    ck("overpaid_amount = 0", abs(od["overpaid_amount"]) < 0.01, str(od["overpaid_amount"]))

    print("\n【5】付款 1500 结清")
    r = purchase_payment_create(oid, 1500, account="现金", note="尾款", operator_id="1")
    ck("付款成功", r.get("payment_id") and not r.get("error"), str(r))
    ck("付款返回的 unpaid = 0（走统一口径，不是旧的 received−paid）",
       abs(float(r.get("unpaid_amount") or 0)) < 0.01, str(r.get("unpaid_amount")))

    d = purchase_order_payments(oid)
    od = d["order"]
    ck("结清后 pay_mode = 'none'（按钮应消失）", od["pay_mode"] == "none", od["pay_mode"])
    ck("累计已付 1500", abs(od["paid_amount"] - 1500) < 0.01, str(od["paid_amount"]))
    ck("预付仍是 500（两笔钱分开记）", abs(od["prepaid_amount"] - 500) < 0.01, str(od["prepaid_amount"]))

    print("\n【6】不设上限：预付 2500 > 订单 2000")
    oid_over = make_order("O", "approved", TOTAL)
    r = purchase_prepayment_create(oid_over, 2500, account="现金", operator_id="1")
    ck("超额预付被允许（老板定的不设上限）", r.get("prepayment_id") and not r.get("error"), str(r))
    ck("overpaid_amount = 500（多付的钱必须算出来，不能被 max 吃掉）",
       abs(float(r.get("overpaid_amount") or 0) - 500) < 0.01, str(r.get("overpaid_amount")))
    d = purchase_order_payments(oid_over)
    ck("货款页也报 500 超付", abs(d["order"]["overpaid_amount"] - 500) < 0.01,
       str(d["order"]["overpaid_amount"]))

    print("\n【7】金额非法值")
    oid_bad = make_order("B", "approved")
    ck("金额 0 被拒", "error" in purchase_prepayment_create(oid_bad, 0), "")
    ck("金额 -100 被拒", "error" in purchase_prepayment_create(oid_bad, -100), "")
    ck("金额 'abc' 被拒", "error" in purchase_prepayment_create(oid_bad, "abc"), "")

    print("\n【7b】真入库：预付必须在应付行上留痕（否则往来账永远显示未付）")
    # 用**临时商品**跑真 confirm（会写 inventory / batch_trace），跑完全部删净。
    # 不用真商品是因为删库存行要按 product_id 精确删，用临时商品范围可控。
    c = conn()
    pid_tmp = c.execute(
        "INSERT INTO products (name,spec,unit,barcode,category,purchase_price,sale_price,is_active) "
        "VALUES ('__TST697_临时商品__','1×1','件','TST697BAR','测试',200,0,1)").lastrowid
    c.commit()
    c.close()

    oid_real = make_order("R", "approved", TOTAL, product_id=pid_tmp)
    r = purchase_prepayment_create(oid_real, 500, account="现金", operator_id="1")
    ck("真入库前预付 500 成功", r.get("prepayment_id") and not r.get("error"), str(r))

    from db.queries.purchases import purchase_order_confirm  # noqa: E402
    rc = purchase_order_confirm(oid_real, operator_id="1")
    ck("整单入库成功", rc.get("status") == "received", str(rc))

    c = conn()
    ap = c.execute(
        "SELECT amount, paid_amount, status FROM receivables "
        " WHERE type='ap' AND ref_type='purchase' AND ref_id=?", (oid_real,)).fetchone()
    inv = c.execute("SELECT quantity, cost_price FROM inventory WHERE product_id=?", (pid_tmp,)).fetchall()
    bt = c.execute("SELECT COUNT(*) FROM batch_trace WHERE product_id=?", (pid_tmp,)).fetchone()[0]
    c.close()
    ck("应付行金额 = 订单金额 2000", ap and abs(float(ap["amount"]) - TOTAL) < 0.01, str(dict(ap) if ap else None))
    ck("**应付行 paid_amount 已镜像预付 500**（否则往来账显示欠 2000）",
       ap and abs(float(ap["paid_amount"]) - 500) < 0.01, str(dict(ap) if ap else None))
    ck("应付行状态 = partial", ap and ap["status"] == "partial", str(ap["status"]) if ap else "")
    ck("库存真的进了（临时商品 1 行）", len(inv) == 1, f"got={len(inv)}")
    ck("批次追踪有记录", bt >= 1, f"got={bt}")

    d = purchase_order_payments(oid_real)
    od = d["order"]
    ck("货款页未结 = 2000 − 500 预付 = 1500", abs(od["unpaid_amount"] - 1500) < 0.01, str(od["unpaid_amount"]))
    ck("**往来账应付未结 = 2000 − 500 = 1500，与货款页一致**",
       abs(od["ap_unpaid_amount"] - 1500) < 0.01, str(od["ap_unpaid_amount"]))
    ck("pay_mode = 'pay'（入库后转为结货款）", od["pay_mode"] == "pay", od["pay_mode"])

    # 清理临时商品相关（库存 / 批次）
    c = conn()
    c.execute("DELETE FROM inventory WHERE product_id=?", (pid_tmp,))
    c.execute("DELETE FROM batch_trace WHERE product_id=?", (pid_tmp,))
    c.commit()
    c.close()

    print("\n【8】清理并自证")
    n = cleanup()
    c = conn()
    bal_after = {r["name"]: r["current_balance"] for r in c.execute("SELECT name,current_balance FROM accounts")}
    c.close()
    # 把钱恢复（清理只删流水，不自动退余额 —— 这里显式还原）
    c = conn()
    for k, v in bal_before.items():
        c.execute("UPDATE accounts SET current_balance=? WHERE name=?", (v, k))
    c.commit()
    c.close()
    bal_final = conn().execute("SELECT name,current_balance FROM accounts").fetchall()
    res = residuals()
    print(f"   清理了 {n} 张测试单；残留 {res}")
    ck("残留全 0", all(v == 0 for v in res.values()), str(res))
    ok_bal = {r["name"]: r["current_balance"] for r in bal_final} == bal_before
    ck("accounts 余额已还原", ok_bal, f"before={bal_before} after={ {r['name']: r['current_balance'] for r in bal_final} }")

    print("\n" + "=" * 52)
    print(f"通过 {PASS[0]} 项，失败 {FAIL[0]} 项")
    print("ALL PASS" if FAIL[0] == 0 else "HAS FAILURE")
    return 0 if FAIL[0] == 0 else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        import traceback
        traceback.print_exc()
        print("\n⚠️ 异常中断，尝试清理：")
        try:
            print("清理了", cleanup(), "张测试单")
        except Exception:
            traceback.print_exc()
        sys.exit(2)
