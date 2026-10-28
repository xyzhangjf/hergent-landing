#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v717 真机接口探针：费用单 → 凭证 → 利润表净利 → 付款凭证。

判定全部落在**生产真实返回值**上（不是读代码推断）：
  1. 4 个此前 100% 500 的接口现在必须 200
  2. 建一张费用单后，journal_entries 必须出现 ref_type='expense' 的借贷各一行
  3. 该月利润表必须出现费用与净利（净利 = 毛利 − 费用），且四段之和 == 费用合计
  4. 付款后必须出现 ref_type='expense_pay'，且资产负债表仍平
  5. 跑完**删干净**（费用单 / 凭证 / 往来账 / 会话），并自证残留 0

用法：python3 probe_v717.py            # 本机直连 127.0.0.1:8700
"""
import json
import secrets
import sqlite3
import subprocess
import sys
import time

BASE = "http://127.0.0.1:8700"
DB_MAIN = "/opt/hergent-erp/erp.db"
DB_TENANT = "/opt/hergent-erp/tenant_1.db"
MONTH_NEW = time.strftime("%Y-%m")
MONTH_OLD = "2026-09"
RES = []


def ok(name, cond, detail=""):
    RES.append({"name": name, "pass": bool(cond), "detail": str(detail)[:200]})
    print("%s %-52s %s" % ("PASS" if cond else "FAIL", name, str(detail)[:120]), flush=True)
    return bool(cond)


def q1(db, sql, args=()):
    c = sqlite3.connect("file:%s?mode=ro" % db, uri=True)
    try:
        r = c.execute(sql, args).fetchone()
        return r[0] if r else None
    finally:
        c.close()


def main():
    m = sqlite3.connect(DB_MAIN)
    m.row_factory = sqlite3.Row
    boss = m.execute("SELECT id FROM users WHERE role='boss' AND is_active=1 LIMIT 1").fetchone()
    tok = secrets.token_hex(24)
    csrf = "probe717csrf"
    m.execute(
        "INSERT INTO sessions(token,user_id,created_at,expires_at,last_activity) "
        "VALUES(?,?,datetime('now','localtime'),datetime('now','localtime','+2 hours'),"
        "datetime('now','localtime'))", (tok, boss["id"]))
    m.commit()
    m.close()

    def api(method, path, body=None):
        cmd = ["curl", "-s", "-m", "25", "-X", method,
               "-H", "Authorization: Bearer " + tok,
               "-H", "Cookie: erp_token=%s; csrf_token=%s" % (tok, csrf),
               "-H", "X-CSRF-Token: " + csrf,
               "-H", "Content-Type: application/json",
               BASE + path]
        if body is not None:
            cmd += ["-d", json.dumps(body)]
        r = subprocess.run(cmd, capture_output=True, text=True)
        try:
            return json.loads(r.stdout), r.stdout
        except Exception:
            return None, r.stdout

    eid = None
    try:
        # ---- 1. 此前必 500 的接口 ----
        d, raw = api("GET", "/api/expense-categories")
        # 9 条：客户 3（陈列/促销/返利）+ 供应商 2（运费/装卸）+ 内部 4（办公/差旅/工资/房租）
        ok("GET /expense-categories 返回全部 9 条",
           isinstance(d, list) and len(d) >= 9, "n=%s" % (len(d) if isinstance(d, list) else raw[:60]))
        types = sorted({(x or {}).get("type") for x in (d or [])}) if isinstance(d, list) else []
        ok("分类覆盖 customer/supplier/internal 三类",
           set(types) >= {"customer", "supplier", "internal"}, types)
        d, raw = api("GET", "/api/expense-orders?limit=5")
        ok("GET /expense-orders 200", isinstance(d, dict) and "items" in d and "total" in d, raw[:90])
        d, raw = api("GET", "/api/income-orders?limit=5")
        ok("GET /income-orders 200", isinstance(d, dict) and "items" in d, raw[:90])

        # 2026-09 基线（改口径前后必须逐分不变）
        base, _ = api("GET", "/api/reports/pnl?month=" + MONTH_OLD)
        ok("2026-09 收入仍是 1,128,410.37",
           base and abs((base.get("revenue") or 0) - 1128410.37) < 0.005,
           base and base.get("revenue"))
        ok("2026-09 毛利仍是 150,845.98",
           base and abs((base.get("gross_profit") or 0) - 150845.98) < 0.005,
           base and base.get("gross_profit"))
        ok("2026-09 费用分解四段字段齐全",
           base and all(k in base for k in ("sell_expense", "admin_expense",
                                            "fin_expense", "other_expense")))

        # ---- 2. 建费用单（内部费用·办公费 1000 元）----
        d, raw = api("POST", "/api/expense-orders",
                     {"type": "internal", "amount": 1000, "category_id": 6,
                      "note": "__v717_probe__ 办公用品", "brand": ""})
        ok("POST /expense-orders 200", isinstance(d, dict) and d.get("success"), raw[:120])
        eid = (d or {}).get("id")
        ok("返回 order_id", bool(eid), eid)

        # 幂等：同单号再建不重复（这里不传 order_no，跳过；改用重复读列表）
        d, _ = api("GET", "/api/expense-orders?limit=5&offset=0")
        items = (d or {}).get("items") or []
        ok("列表能查到刚建的单", any(x.get("id") == eid for x in items),
           "total=%s" % (d or {}).get("total"))
        ok("列表带 category_name", any(x.get("category_name") for x in items))

        # ---- 3. 凭证 ----
        n = q1(DB_TENANT, "SELECT COUNT(*) FROM journal_entries WHERE ref_type='expense' AND ref_id=?", (eid,))
        ok("生成费用凭证 2 行（借贷各一）", n == 2, "rows=%s" % n)
        r = sqlite3.connect("file:%s?mode=ro" % DB_TENANT, uri=True)
        try:
            rows = r.execute("SELECT account_code,debit,credit FROM journal_entries "
                             "WHERE ref_type='expense' AND ref_id=? ORDER BY debit DESC", (eid,)).fetchall()
        finally:
            r.close()
        ok("借方为 66020205 办公用品费 1000",
           rows and rows[0][0] == "66020205" and abs(rows[0][1] - 1000) < 0.005, rows)
        ok("贷方为 2202 应付账款 1000",
           len(rows) > 1 and rows[1][0] == "2202" and abs(rows[1][2] - 1000) < 0.005, rows)

        # ---- 4. 利润表出现净利 ----
        pnl, raw = api("GET", "/api/reports/pnl?month=" + MONTH_NEW)
        ok("当月利润表 basis=accrual", pnl and pnl.get("basis") == "accrual", pnl and pnl.get("basis"))
        ok("当月管理费用 = 1000", pnl and abs((pnl.get("admin_expense") or 0) - 1000) < 0.005,
           pnl and pnl.get("admin_expense"))
        ok("当月费用合计 = 1000", pnl and abs((pnl.get("total_expense") or 0) - 1000) < 0.005,
           pnl and pnl.get("total_expense"))
        s4 = sum((pnl or {}).get(k) or 0 for k in ("sell_expense", "admin_expense",
                                                  "fin_expense", "other_expense"))
        ok("四段之和 == 费用合计", pnl and abs(s4 - (pnl.get("total_expense") or 0)) < 0.005, s4)
        ok("净利 = 毛利 − 费用",
           pnl and abs((pnl.get("net_profit") or 0)
                       - ((pnl.get("gross_profit") or 0) - (pnl.get("total_expense") or 0))) < 0.005,
           "net=%s gross=%s exp=%s" % (pnl and pnl.get("net_profit"),
                                        pnl and pnl.get("gross_profit"),
                                        pnl and pnl.get("total_expense")))

        # ---- 5. 付款 ----
        d, raw = api("POST", "/api/expense-orders/%s/pay" % eid, {"amount": 300, "account": "现金"})
        ok("POST /expense-orders/{id}/pay 200", isinstance(d, dict) and d.get("success"), raw[:120])
        n = q1(DB_TENANT, "SELECT COUNT(*) FROM journal_entries WHERE ref_type='expense_pay' AND ref_id=?", (eid,))
        ok("生成付款凭证 2 行", n == 2, "rows=%s" % n)
        r = sqlite3.connect("file:%s?mode=ro" % DB_TENANT, uri=True)
        try:
            rows = r.execute("SELECT account_code,debit,credit FROM journal_entries "
                             "WHERE ref_type='expense_pay' AND ref_id=? ORDER BY debit DESC", (eid,)).fetchall()
        finally:
            r.close()
        ok("借 2202 应付 / 贷 1001 现金 各 300",
           rows and rows[0][0] == "2202" and rows[1][0] == "1001"
           and abs(rows[1][2] - 300) < 0.005, rows)

        # ---- 6. 资产负债表仍平（返回体是嵌套结构：assets/liabilities/equity 三个子对象）----
        bs, raw = api("GET", "/api/reports/balance-sheet?as_of=" + time.strftime("%Y-%m-%d"))
        ok("资产负债表 balanced=true", bs and bs.get("balanced") is True,
           bs and {"balanced": bs.get("balanced"), "unclosed_profit": bs.get("unclosed_profit")})
        ok("资产负债表三段子对象齐全",
           bs and all(isinstance(bs.get(k), dict) and bs.get(k)
                      for k in ("assets", "liabilities", "equity")),
           bs and {k: list((bs.get(k) or {}).keys())[:6] for k in ("assets", "liabilities", "equity")})

        # 单边分录判据：journal_entries 是**逐行**记的（一行只有借或只有贷），
        # 所以不能按行判 `debit==credit`，必须按 voucher_no 汇总后才能比。
        r = sqlite3.connect("file:%s?mode=ro" % DB_TENANT, uri=True)
        try:
            unbal = r.execute(
                "SELECT COUNT(*) FROM (SELECT voucher_no FROM journal_entries "
                "GROUP BY voucher_no "
                "HAVING abs(COALESCE(SUM(debit),0)-COALESCE(SUM(credit),0))>0.005)"
            ).fetchone()[0]
        finally:
            r.close()
        ok("全库凭证按单号借贷平衡", unbal == 0, "unbalanced_vouchers=%s" % unbal)
    finally:
        # ---- 7. 清理：凭证 → 往来账 → 费用单 → 会话 ----
        if eid:
            c = sqlite3.connect(DB_TENANT)
            c.execute("DELETE FROM journal_entries WHERE ref_type IN ('expense','expense_pay') AND ref_id=?", (eid,))
            c.execute("DELETE FROM receivables WHERE ref_type='expense' AND ref_id=?", (eid,))
            c.execute("DELETE FROM expense_orders WHERE id=?", (eid,))
            c.commit()
            left = c.execute("SELECT COUNT(*) FROM journal_entries WHERE ref_id=? AND ref_type IN ('expense','expense_pay')", (eid,)).fetchone()[0]
            left2 = c.execute("SELECT COUNT(*) FROM expense_orders WHERE id=?", (eid,)).fetchone()[0]
            c.close()
            ok("清理后费用凭证残留 0", left == 0, left)
            ok("清理后费用单残留 0", left2 == 0, left2)
        m2 = sqlite3.connect(DB_MAIN)
        m2.execute("DELETE FROM sessions WHERE token=?", (tok,))
        m2.commit()
        resid = m2.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]
        m2.close()
        ok("临时会话残留 0", resid == 0, resid)

    npass = sum(1 for x in RES if x["pass"])
    print("\nSUMMARY %d/%d PASS" % (npass, len(RES)))
    print(json.dumps({"pass": npass, "total": len(RES),
                      "failed": [x for x in RES if not x["pass"]]},
                     ensure_ascii=False, indent=1))
    sys.exit(0 if npass == len(RES) else 1)


if __name__ == "__main__":
    main()
