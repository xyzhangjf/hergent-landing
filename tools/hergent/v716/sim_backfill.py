#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v716 副本试算：用真实业务单据跑一遍「单据 → 凭证」，看利润表/资产负债表能算出什么。

纪律：
  1. 绝不 import erp_db（导入期会跑 389 条迁移 = 会写生产）。
  2. 只在 /tmp 的副本上写，源库以 mode=ro 打开仅用于校验，不写。
  3. 分录口径照抄 erp_db.auto_journal_for_sale / for_cogs / for_purchase 的硬编码分支
     （flag `voucher_templates` 生产为 0 ⇒ 实际走的就是硬编码）。

产出：备份前后行数、逐月收入/成本/毛利、库存科目余额、借贷是否平、异常单位行占比。
"""
import json
import os
import shutil
import sqlite3
import sys

SRC = "/opt/hergent-erp/tenant_1.db"
SIM = "/tmp/sim_v716.db"

# 可重建的分录类型（opening 是老板给的期初，绝不删）
REBUILDABLE = ("sale", "cogs", "purchase", "revenue_recognition", "payment")
# 收入类科目前缀（v714 口径：60/61/63 = 收入侧）
REV_PREFIX = ("60", "61", "63")
COGS_CODE = "6401"


def cents(x):
    return int(round((x or 0) * 100))


def main():
    out = {}
    if os.path.exists(SIM):
        os.remove(SIM)
    shutil.copy2(SRC, SIM)
    out["sim_copy"] = {"path": SIM, "size": os.path.getsize(SIM)}

    c = sqlite3.connect(SIM)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys=OFF")

    # ---------- 0. 试算前基线 ----------
    before_rows = c.execute("SELECT COUNT(*) FROM journal_entries").fetchone()[0]
    before_by_type = {
        r["ref_type"]: r["n"]
        for r in c.execute(
            "SELECT IFNULL(ref_type,'(null)') ref_type, COUNT(*) n FROM journal_entries GROUP BY ref_type"
        )
    }

    # ---------- 1. 清掉可重建的分录，保留 opening ----------
    ph = ",".join("?" * len(REBUILDABLE))
    c.execute("DELETE FROM journal_entries WHERE ref_type IN (%s)" % ph, REBUILDABLE)
    after_del = c.execute("SELECT COUNT(*) FROM journal_entries").fetchone()[0]
    out["clear"] = {
        "before": before_rows,
        "deleted": before_rows - after_del,
        "kept": after_del,
        "before_by_type": before_by_type,
        "kept_by_type": {
            r["ref_type"]: r["n"]
            for r in c.execute(
                "SELECT IFNULL(ref_type,'(null)') ref_type, COUNT(*) n FROM journal_entries GROUP BY ref_type"
            )
        },
    }

    # ---------- 2. 销售 + 成本分录 ----------
    orders = c.execute(
        """
        SELECT so.id, so.order_no, substr(IFNULL(so.order_date, so.created_at),1,10) d,
               IFNULL(so.total_amount,0) amt, IFNULL(ct.name,'') cname,
               (SELECT ROUND(SUM(soi.quantity * IFNULL(p.purchase_price,0)),2)
                  FROM sale_order_items soi LEFT JOIN products p ON p.id=soi.product_id
                 WHERE soi.order_id=so.id) cost,
               (SELECT COUNT(*) FROM sale_order_items soi WHERE soi.order_id=so.id) nlines
          FROM sale_orders so LEFT JOIN contacts ct ON ct.id=so.customer_id
         WHERE so.status='signed'
         ORDER BY d, so.id
        """
    ).fetchall()

    sale_rows = []
    cogs_rows = []
    seq = {}
    skipped_zero_cost = 0
    cost_zero_amt = 0.0
    for o in orders:
        d = o["d"] or "2026-01-01"
        seq[d] = seq.get(d, 0) + 1
        vno = "J%s%04d" % (d.replace("-", ""), seq[d])
        amt = round(o["amt"], 2)
        if amt == 0:
            continue
        summ = "销售:" + (o["cname"] or "")
        sale_rows.append((vno, d, "1122", "应收账款", amt, 0.0, "sale", o["id"], summ, ""))
        sale_rows.append((vno, d, "6001", "主营业务收入", 0.0, amt, "sale", o["id"], summ, ""))
        cost = round(o["cost"] or 0, 2)
        # 🔴 判据必须是「成本恰为 0」，不能写 <= 0：
        # 退货单金额为负、成本也为负，写 <=0 会把退货成本整单跳过 ⇒ 只冲收入不冲成本，
        # 成本虚增、毛利被低估（v716 首跑实测 3,952 张负额单被吞，销售额 -289,155.16）。
        if cost == 0:
            skipped_zero_cost += 1
            cost_zero_amt += amt
            continue
        cvno = "JC%s%04d" % (d.replace("-", ""), seq[d])
        csumm = "结转销售成本 订单#%s" % (o["order_no"] or o["id"])
        cogs_rows.append((cvno, d, COGS_CODE, "主营业务成本", cost, 0.0, "cogs", o["id"], csumm, ""))
        cogs_rows.append((cvno, d, "1405", "库存商品", 0.0, cost, "cogs", o["id"], csumm, ""))

    INS = (
        "INSERT INTO journal_entries "
        "(voucher_no,date,account_code,account_name,debit,credit,ref_type,ref_id,summary,operator_id) "
        "VALUES (?,?,?,?,?,?,?,?,?,?)"
    )
    c.executemany(INS, sale_rows)
    c.executemany(INS, cogs_rows)

    # ---------- 3. 采购分录（received 视为入库） ----------
    pos = c.execute(
        "SELECT id, order_no, substr(IFNULL(order_date, created_at),1,10) d, IFNULL(total_amount,0) amt "
        "FROM purchase_orders WHERE status='received' ORDER BY d, id"
    ).fetchall()
    pur_rows = []
    pseq = {}
    for p in pos:
        d = p["d"] or "2026-01-01"
        pseq[d] = pseq.get(d, 0) + 1
        vno = "JP%s%04d" % (d.replace("-", ""), pseq[d])
        amt = round(p["amt"], 2)
        if amt == 0:
            continue
        pur_rows.append((vno, d, "1405", "库存商品", amt, 0.0, "purchase", p["id"], "采购入库", ""))
        pur_rows.append((vno, d, "2202", "应付账款", 0.0, amt, "purchase", p["id"], "采购入库", ""))
    c.executemany(INS, pur_rows)
    c.commit()

    out["posted"] = {
        "signed_orders": len(orders),
        "sale_entry_rows": len(sale_rows),
        "cogs_entry_rows": len(cogs_rows),
        "cogs_skipped_no_cost_orders": skipped_zero_cost,
        "cogs_skipped_sales_amt": round(cost_zero_amt, 2),
        "purchase_orders_posted": len(pos),
        "purchase_entry_rows": len(pur_rows),
        "journal_total_rows": c.execute("SELECT COUNT(*) FROM journal_entries").fetchone()[0],
    }

    # ---------- 3b. 单据结构体检：正单/退货单、回款缺口 ----------
    split = c.execute(
        """
        SELECT SUM(CASE WHEN total_amount>0 THEN 1 ELSE 0 END) pos_n,
               ROUND(SUM(CASE WHEN total_amount>0 THEN total_amount ELSE 0 END),2) pos_amt,
               SUM(CASE WHEN total_amount<0 THEN 1 ELSE 0 END) neg_n,
               ROUND(SUM(CASE WHEN total_amount<0 THEN total_amount ELSE 0 END),2) neg_amt
          FROM sale_orders WHERE status='signed'
        """
    ).fetchone()
    out["sales_split"] = {
        "positive_orders": split["pos_n"],
        "positive_amount": split["pos_amt"],
        "return_orders_negative": split["neg_n"],
        "return_amount": split["neg_amt"],
    }
    try:
        cf = c.execute(
            "SELECT COUNT(*) n, ROUND(SUM(CASE WHEN type='income' THEN amount ELSE 0 END),2) inc, "
            "ROUND(SUM(CASE WHEN type='expense' OR type='out' THEN amount ELSE 0 END),2) out"
        ).fetchone()
        out["cash_flow"] = {"rows": cf["n"], "income": cf["inc"], "out": cf["out"]}
    except Exception as e:
        out["cash_flow"] = {"error": str(e)}

    # ---------- 4. 逐月利润表（v714 口径） ----------
    rev_in = " OR ".join(["account_code LIKE '%s%%'" % p for p in REV_PREFIX])
    monthly = []
    for r in c.execute(
        """
        SELECT substr(date,1,7) m,
               ROUND(SUM(CASE WHEN (%s) THEN credit-debit ELSE 0 END),2) revenue,
               ROUND(SUM(CASE WHEN account_code=? THEN debit-credit ELSE 0 END),2) cogs,
               ROUND(SUM(CASE WHEN account_code LIKE '6%%' AND NOT (%s) AND account_code<>?
                              THEN debit-credit ELSE 0 END),2) expense,
               COUNT(*) n
          FROM journal_entries
         WHERE date IS NOT NULL AND date<>''
         GROUP BY m ORDER BY m
        """
        % (rev_in, rev_in),
        (COGS_CODE, COGS_CODE),
    ):
        gp = round((r["revenue"] or 0) - (r["cogs"] or 0), 2)
        monthly.append(
            {
                "month": r["m"],
                "revenue": r["revenue"],
                "cogs": r["cogs"],
                "gross_profit": gp,
                "gross_margin_pct": round(gp / r["revenue"] * 100, 2) if r["revenue"] else None,
                "expense": r["expense"],
                "net_profit": round(gp - (r["expense"] or 0), 2),
                "entry_rows": r["n"],
            }
        )
    out["monthly_pnl"] = monthly

    tot_rev = sum(cents(x["revenue"]) for x in monthly)
    tot_cogs = sum(cents(x["cogs"]) for x in monthly)
    tot_exp = sum(cents(x["expense"]) for x in monthly)
    out["total"] = {
        "revenue": tot_rev / 100.0,
        "cogs": tot_cogs / 100.0,
        "gross_profit": (tot_rev - tot_cogs) / 100.0,
        "gross_margin_pct": round((tot_rev - tot_cogs) / tot_rev * 100, 2) if tot_rev else None,
        "expense": tot_exp / 100.0,
        "net_profit": (tot_rev - tot_cogs - tot_exp) / 100.0,
    }

    # ---------- 5. 关键科目余额 + 借贷是否平 ----------
    bal = {}
    for r in c.execute(
        "SELECT account_code, ROUND(SUM(debit),2) d, ROUND(SUM(credit),2) c "
        "FROM journal_entries GROUP BY account_code"
    ):
        bal[r["account_code"]] = (r["d"] or 0, r["c"] or 0)

    def clean(code):
        # 叶子口径：父科目若其子科目有数则不重复计入（v708 规则）
        kids = [k for k in bal if k != code and k.startswith(code) and len(k) > len(code)]
        kids_with = [k for k in kids if abs(cents(bal[k][0]) - cents(bal[k][1])) > 0]
        return None if kids_with else bal.get(code)

    def net(code):
        v = clean(code)
        return None if v is None else round(v[0] - v[1], 2)

    total_d = sum(cents(v[0]) for v in bal.values())
    total_c = sum(cents(v[1]) for v in bal.values())
    out["ledger"] = {
        "total_debit": total_d / 100.0,
        "total_credit": total_c / 100.0,
        "diff_cents": total_d - total_c,
        "balanced": total_d == total_c,
        "acct_1405_inventory": net("1405"),
        "acct_1122_ar": net("1122"),
        "acct_2202_ap": net("2202"),
        "acct_6001_revenue": net("6001"),
        "acct_6401_cogs": net("6401"),
    }

    # ---------- 6. 单位异常体检（售价/采购价 比值极端行） ----------
    ab = c.execute(
        """
        SELECT COUNT(*) n, ROUND(SUM(amount),2) amt
          FROM (SELECT i.amount, 1.0*p.purchase_price/i.unit_price r
                  FROM sale_order_items i JOIN sale_orders o ON o.id=i.order_id
                  JOIN products p ON p.id=i.product_id
                 WHERE o.status='signed' AND IFNULL(p.purchase_price,0)>0 AND IFNULL(i.unit_price,0)>0)
         WHERE r < 0.15
        """
    ).fetchone()
    total_amt = c.execute(
        "SELECT ROUND(SUM(i.amount),2) FROM sale_order_items i JOIN sale_orders o ON o.id=i.order_id "
        "WHERE o.status='signed'"
    ).fetchone()[0]
    out["unit_anomaly"] = {
        "rows_ratio_lt_0.15": ab["n"],
        "amount": ab["amt"],
        "pct_of_sales": round((ab["amt"] or 0) / total_amt * 100, 3) if total_amt else None,
    }

    print(json.dumps(out, ensure_ascii=False, indent=2))
    c.close()


if __name__ == "__main__":
    main()
