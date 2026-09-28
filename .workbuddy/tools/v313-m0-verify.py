# -*- coding: utf-8 -*-
"""v313 M0.0 验收：影子库上验证三个落库改动（正例 + 反例对照）。

设计纪律（本项目已登记的踩坑）：
  · **影子库**：绝不碰真实 dev 库。复制 `erp.db` → `/tmp/v313-shadow/erp.db`，用
    `ERP_DB_PATH` 指过去（`DB_PATH = os.environ.get("ERP_DB_PATH", ...)`，单入口）。
  · **正反对照**：每个判据都要有「该为真」和「该为假」两侧，否则探针没有判别力。
  · Python 是系统 3.9.6（带 fastapi/openpyxl/cryptography），不是托管 3.13。

跑法： cd server && /usr/bin/python3 <本文件>
"""
from __future__ import print_function

import os
import shutil
import sqlite3
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRV = "/Users/zhangjunfeng/Documents/hergent-erp/server"
SHADOW_DIR = "/tmp/v313-shadow"
SHADOW = os.path.join(SHADOW_DIR, "erp.db")

OK, BAD = [], []


def check(label, cond, extra=""):
    (OK if cond else BAD).append(label)
    print("   %s %s%s" % ("✅" if cond else "❌", label, ("  " + extra) if extra else ""))
    return cond


def setup_shadow():
    if os.path.isdir(SHADOW_DIR):
        shutil.rmtree(SHADOW_DIR)
    os.makedirs(SHADOW_DIR)
    src = os.path.join(SRV, "erp.db")
    shutil.copy2(src, SHADOW)
    os.environ["ERP_DB_PATH"] = SHADOW
    # 清掉可能被继承的租户上下文
    os.environ.pop("HERGENT_TENANT", None)


def q(sql, args=()):
    c = sqlite3.connect(SHADOW)
    try:
        return c.execute(sql, args).fetchall()
    finally:
        c.close()


def cols(table):
    return [r[1] for r in q("PRAGMA table_info(%s)" % table)]


def main():
    print("=" * 74)
    print("① 影子库准备")
    setup_shadow()
    print("   影子库:", SHADOW, " 大小 %d B" % os.path.getsize(SHADOW))

    # --- 反例 1：迁移前不该有 unit 列（证明「查得到/查不到」这个探针有判别力）---
    before = cols("purchase_order_items")
    check("N1 迁移前 purchase_order_items 无 unit 列", "unit" not in before,
          "现有列: %s" % before)

    # --- 触发迁移：导入 erp_db（模块级 _safe_migrate 在此执行）---
    print()
    print("=" * 74)
    print("② 触发启动期迁移（导入 erp_db）+ 新符号导出")
    sys.path.insert(0, SRV)
    os.chdir(SRV)
    import erp_db as db  # noqa

    after = cols("purchase_order_items")
    check("P1 迁移后 purchase_order_items 有 unit 列", "unit" in after,
          "现有列: %s" % after)
    check("P2 erp_db 导出了 income_order_create", hasattr(db, "income_order_create"))
    check("P3 erp_db 导出了 income_order_list", hasattr(db, "income_order_list"))
    check("P4 erp_db 仍导出 expense_order_create", hasattr(db, "expense_order_create"))

    # --- 反例 2：路由的真实写法（15 实参）仍必失败（我们**不**去对齐那个半成品端点）---
    print()
    print("=" * 74)
    print("③ expense_order_create：反例（15 实参，= 路由真实写法）")
    try:
        db.expense_order_create('supplier', 1, 1, 0, '', '', '', '', 0, 'u', '', 0, '', '', 'manual')
        check("N2 15 实参应抛 TypeError", False, "居然没抛")
    except TypeError as e:
        check("N2 15 实参抛 TypeError（与修复前一致，路由仍是坏的）", True, str(e)[:70])
    except Exception as e:
        check("N2 15 实参抛 TypeError", False, "抛的是 %s: %s" % (type(e).__name__, e))

    # --- 正例 1：8 实参 + 新增参数能真正建单（修复前这里必 NameError）---
    print()
    print("=" * 74)
    print("④ expense_order_create：正例（修 cur / arity 保持 8）")
    sup = q("SELECT id FROM contacts WHERE type='supplier' LIMIT 1")
    if not sup:
        check("前置：影子库有供应商档案", False, "拿不到 supplier")
        return
    sid = sup[0][0]
    n0 = q("SELECT COUNT(*) FROM expense_orders")[0][0]
    try:
        r1 = db.expense_order_create('supplier', sid, 12900.30, 4, 'M0.0 验单', 'test',
                                     order_no='V313EX0001', order_date='2026-08-31 00:00:00',
                                     post_ledger=False)
        check("P5 建费用单成功且返回 order_id>0",
              bool(r1.get('order_id')), "返回 %s" % r1)
    except Exception as e:
        check("P5 建费用单成功", False, "%s: %s" % (type(e).__name__, e))
        return
    row = q("SELECT order_no,type,amount,order_date FROM expense_orders WHERE order_no='V313EX0001'")
    check("P6 落库字段正确（单号/类型/金额/日期=传入值而非今天）",
          bool(row) and row[0][0] == 'V313EX0001' and row[0][2] == 12900.30
          and str(row[0][3]).startswith('2026-08-31'),
          "库里=%s" % ((row[0] if row else None),))

    # --- 幂等 ---
    r2 = db.expense_order_create('supplier', sid, 12900.30, 4, 'dup', 'test',
                                 order_no='V313EX0001', post_ledger=False)
    n1 = q("SELECT COUNT(*) FROM expense_orders")[0][0]
    check("P7 同单号重跑 = 幂等（existed=True 且行数不增）",
          r2.get('existed') is True and n1 == n0 + 1,
          "existed=%s 行数 %d→%d" % (r2.get('existed'), n0, n1))

    # --- post_ledger=False 应**不**生成应收 ---
    ar = q("SELECT COUNT(*) FROM receivables WHERE ref_type='expense'")
    check("P8 post_ledger=False 未生成应收/应付记录", ar[0][0] == 0, "receivables(expense)=%d" % ar[0][0])

    # --- 正例 2：income_order_create ---
    print()
    print("=" * 74)
    print("⑤ income_order_create：正例 + 幂等 + post_ledger 默认关闭")
    inc0 = q("SELECT COUNT(*) FROM income_orders")[0][0]
    ri = db.income_order_create('supplier', sid, 176709.08, 1, 'M0.0 验单', 'test',
                                order_no='V313IN0001', order_date='2026-08-31 00:00:00')
    ri2 = db.income_order_create('supplier', sid, 176709.08, 1, 'dup', 'test', order_no='V313IN0001')
    inc1 = q("SELECT COUNT(*) FROM income_orders")[0][0]
    check("P9 建收入单成功", bool(ri.get('order_id')), "返回 %s" % ri)
    check("P10 收入单幂等（existed + 行数不增）",
          ri2.get('existed') is True and inc1 == inc0 + 1,
          "existed=%s 行数 %d→%d" % (ri2.get('existed'), inc0, inc1))
    ar2 = q("SELECT COUNT(*) FROM receivables WHERE ref_type='income'")
    check("P11 收入单默认 post_ledger=False ⇒ 不写应收", ar2[0][0] == 0,
          "receivables(income)=%d" % ar2[0][0])
    lst = db.income_order_list('supplier', 0, 5)
    check("P12 income_order_list 可调用且带出 contact_name/category_name",
          isinstance(lst, list) and (not lst or ('contact_name' in lst[0])))

    # --- 正例 3：purchase_order_create 的外部单据参数 ---
    print()
    print("=" * 74)
    print("⑥ purchase_order_create：order_no/order_date/status/unit/amount")
    prd = q("SELECT id,name,unit FROM products LIMIT 1")
    if not prd:
        check("前置：影子库有商品档案", False)
        return
    pid, pname, punit = prd[0]
    items = [
        {"product_id": pid, "quantity": 264, "unit_price": 3.8792, "amount": 1024.11, "unit": punit},
        {"product_id": pid, "quantity": 24, "unit_price": 4.05, "amount": 97.20, "unit": punit},
    ]
    rp = db.purchase_order_create(sid, items, order_no='V313PO0001',
                                  order_date='2026-08-31 00:00:00', status='received')
    prow = q("SELECT order_no,status,total_amount,order_date FROM purchase_orders WHERE order_no='V313PO0001'")
    check("P13 建采购单成功（不传 status 时才是阈值判定）", bool(rp.get('order_id')), "返回 %s" % rp)
    check("P14 status 用了传入的 'received'（不是 pending_approval）",
          bool(prow) and prow[0][1] == 'received', "库里 status=%s" % (prow[0][1] if prow else None))
    check("P15 order_date = 传入的历史日期（不是今天）",
          bool(prow) and str(prow[0][3]).startswith('2026-08-31'),
          "库里 order_date=%s" % (prow[0][3] if prow else None))
    check("P16 total_amount 用**权威金额**合计 1121.31（不是 Σ数量×单价 1130.19）",
          bool(prow) and abs(float(prow[0][2]) - 1121.31) < 0.005,
          "库里=%.4f ; 若按数量×单价应为 %.4f" % (
              float(prow[0][2]) if prow else -1, 264 * 3.8792 + 24 * 4.05))
    pr = db.purchase_order_create(sid, items, order_no='V313PO0001')
    check("P17 采购单幂等（existed=True）", pr.get('existed') is True, "返回 %s" % pr)
    irow = q("SELECT quantity,unit_price,amount,unit FROM purchase_order_items WHERE order_id=?", (rp['order_id'],))
    check("P18 明细行落 unit 列（原始单位已持久化）",
          bool(irow) and irow[0][3] == punit,
          "明细=%s" % ((irow[0] if irow else None),))
    check("P19 明细行 amount = 权威值（非 quantity×unit_price）",
          bool(irow) and abs(float(irow[0][2]) - 1024.11) < 0.005,
          "amount=%.4f" % (float(irow[0][2]) if irow else -1))

    # --- 反例 3：默认行为未变（不传 status ⇒ 走阈值）---
    print()
    print("=" * 74)
    print("⑦ 反例：不传 status 时仍走审批阈值（证明默认行为未被改动）")
    rp2 = db.purchase_order_create(sid, items, order_no='V313PO0002')
    p2 = q("SELECT status FROM purchase_orders WHERE order_no='V313PO0002'")
    tot = sum(i["amount"] for i in items)
    expect = 'pending_approval' if tot >= 5000 else 'draft'
    check("N3 不传 status ⇒ 按阈值判定（本例 %.2f 元 ⇒ %s）" % (tot, expect),
          bool(p2) and p2[0][0] == expect, "库里=%s" % (p2[0][0] if p2 else None))

    print()
    print("=" * 74)
    print("结果: ✅ %d 项通过 / ❌ %d 项失败" % (len(OK), len(BAD)))
    if BAD:
        for b in BAD:
            print("   ❌", b)
        sys.exit(1)


if __name__ == "__main__":
    main()
