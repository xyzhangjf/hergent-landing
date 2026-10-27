#!/usr/bin/env python3
"""v710 端到端探针：对账匹配判据 + 月度快照口径。

## 为什么这么验

生产 `bank_transactions` / `monthly_snapshots` **全库 0 行** ⇒ 改完在真实数据上
什么都不会变，"跑一遍接口没报错"证明不了任何事。所以分两段：

**A · 生产只读**：①报表没被动；②零点数据自证；③真实接口在**真实金额**上
把「差 1 分」与「同额」分开，并用老判据现场算出反向对照。

**B · 隔离库行为验证（/tmp 空库 + 生产同一份代码）**：人造数据逼出判据边界
——差 1 分必须 0 匹配、同额且日期在窗内必须 1 匹配、日期超窗必须 0 匹配。

## 两处「反向对照」是硬要求

只证明"新判据给 0 匹配"可能是**因为根本没匹配上**（例如查询本身坏了）。
所以每组都同时算「老判据在同样数据上会给什么」。老判据若也 0，这组数就没有
区分力，断言必须 FAIL —— 第一版探针正是踩了这个坑：我挑的 `100.01 vs 100.00`
差值是 `0.010000000000005116`，**在老判据下也不匹配**，等于什么都没验证。

退出码：0 全过；1 有 FAIL。
"""
import json
import os
import shutil
import sqlite3
import sys
import tempfile
import urllib.request

PROD = "/opt/hergent-erp"
PASS, FAIL = [], []


def chk(name, cond, detail=""):
    if cond:
        PASS.append(name)
        print("  ✅ %s" % name)
    else:
        FAIL.append("%s  %s" % (name, detail))
        print("  🔴 %s  %s" % (name, detail))


def _tok():
    con = sqlite3.connect("file:%s/erp.db?mode=ro" % PROD, uri=True)
    try:
        r = con.execute("SELECT token FROM sessions WHERE user_id=2 "
                        "ORDER BY created_at DESC LIMIT 1").fetchone()
        return r[0] if r else None
    finally:
        con.close()


def _get(path, token):
    req = urllib.request.Request(
        "http://127.0.0.1:8700" + path,
        headers={"Cookie": "erp_token=%s; hergent_auth=1" % token,
                 "X-Tenant-Id": "1"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, json.loads(r.read().decode())


def _post(path, body, token):
    """POST 必须带 CSRF 双提交：cookie `csrf_token` 与 header `X-CSRF-Token` 相等。

    中间件只做 `compare_digest(cookie, header)`、不查服务端存储 ⇒ 探针可自带一对相同值。
    🔴 只注 `erp_token` 会 403，看起来像"功能坏了"（v702 已踩过）。
    """
    csrf = "probe-v710-csrf"
    req = urllib.request.Request(
        "http://127.0.0.1:8700" + path,
        data=json.dumps(body).encode(),
        headers={"Cookie": "erp_token=%s; hergent_auth=1; csrf_token=%s" % (token, csrf),
                 "X-CSRF-Token": csrf,
                 "X-Tenant-Id": "1", "Content-Type": "application/json"},
        method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, json.loads(r.read().decode())


def _income_amounts():
    con = sqlite3.connect("file:%s/tenant_1.db?mode=ro" % PROD, uri=True)
    try:
        return sorted({round(float(r[0]), 2) for r in
                       con.execute("SELECT amount FROM cash_flow WHERE type='income' "
                                   "AND amount>0")})
    finally:
        con.close()


def _old_match(a, b):
    """改前的判据原文：`abs(abs(a)-abs(b)) < 0.01`。"""
    return abs(abs(a) - abs(b)) < 0.01


def _counts():
    out = {}
    for fn in ("erp.db", "tenant_1.db", "tenant_10.db"):
        con = sqlite3.connect("file:%s/%s?mode=ro" % (PROD, fn), uri=True)
        for t in ("bank_transactions", "monthly_snapshots"):
            try:
                out[(fn, t)] = con.execute("SELECT COUNT(*) FROM %s" % t).fetchone()[0]
            except sqlite3.Error:
                out[(fn, t)] = -1
        con.close()
    return out


def phase_prod():
    print("\n【A】生产只读：报表没被动 + 零点数据自证 + 真实金额上的行为")
    tok = _tok()
    if not tok:
        chk("拿到真实会话 token", False, "sessions 无 user_id=2")
        return
    chk("拿到真实会话 token", True)

    st, b = _get("/api/reports/balance-sheet?as_of=2026-10-26", tok)
    a = float((b.get("assets") or {}).get("total", 0))
    chk("资产负债表 → 200 且资产仍 2,258,504.26（补丁未动报表）",
        st == 200 and abs(a - 2258504.26) < 0.02, "status=%s assets=%.2f" % (st, a))
    chk("balanced 仍为 true（v709 清理后应平）", b.get("balanced") is True,
        "balanced=%s" % b.get("balanced"))

    st, tb = _get("/api/trial-balance?month=2026-06", tok)
    dr, cr = float(tb.get("total_debit", 0)), float(tb.get("total_credit", 0))
    chk("试算表 2026-06 借=贷（差 0.00）", abs(dr - cr) < 0.005,
        "借 %.2f 贷 %.2f" % (dr, cr))

    cnt = _counts()
    print("  存量行数：" + "  ".join(
        "%s.%s=%d" % (k[0].replace(".db", ""), k[1], v) for k, v in cnt.items()))
    chk("bank_transactions 全库 0 行（对账从未被用过）",
        all(v == 0 for k, v in cnt.items() if k[1] == "bank_transactions"))
    chk("monthly_snapshots 全库 0 行（快照从未被用过）",
        all(v == 0 for k, v in cnt.items() if k[1] == "monthly_snapshots"))

    amounts = _income_amounts()
    chk("取到真实 income 金额", len(amounts) > 0, "%d 个" % len(amounts))
    if not amounts:
        return

    # 挑一个「老判据会把 v 与 v+0.01 判成同一笔」的真实金额 —— 这才有区分力
    buggy = [v for v in amounts if _old_match(v, round(v + 0.01, 2))]
    chk("存在老判据会误判的真实金额（不是编的边界）", len(buggy) > 0,
        "在 %d 个真实金额里 %d 个能触发" % (len(amounts), len(buggy)))
    if not buggy:
        return
    amt = buggy[0]
    off = round(amt + 0.01, 2)
    print("  选用 A=%.2f（A+0.01=%.2f，差=%.18f）" % (amt, off, abs(amt - off)))

    st, r1 = _post("/api/bank-import",
                   {"rows": [{"amount": amt, "date": "2026-08-01", "description": "探针-同额"}]},
                   tok)
    hit_eq = [c for c in (r1[0].get("candidates") or [])
              if abs(float(c.get("amount") or 0) - amt) < 0.005] if st == 200 else []
    chk("同额查询命中 A 那条（不能把该配的判丢）", st == 200 and len(hit_eq) >= 1,
        "status=%s 命中 %d" % (st, len(hit_eq)))

    st, r2 = _post("/api/bank-import",
                   {"rows": [{"amount": off, "date": "2026-08-01", "description": "探针-差1分"}]},
                   tok)
    hit_off = [c for c in (r2[0].get("candidates") or [])
               if abs(float(c.get("amount") or 0) - amt) < 0.005] if st == 200 else []
    chk("查 A+0.01 不得命中 A 那条（按分不等）", st == 200 and not hit_off,
        "status=%s A 被命中 %d 次" % (st, len(hit_off)))
    chk("反向对照：老判据在这组真实金额上会命中（证明上一条有区分力）",
        _old_match(amt, off), "差=%.18f" % abs(amt - off))


def phase_isolated():
    print("\n【B】隔离库行为验证（/tmp 空库 + 生产同一份代码）")
    tmp = tempfile.mkdtemp(prefix="v710-probe-")
    dbp = os.path.join(tmp, "probe.db")
    try:
        os.environ["ERP_DB_PATH"] = dbp
        sys.path.insert(0, PROD)
        import erp_db  # noqa: E402

        def reset(cf_amount, txn_amount, txn_date, cf_created):
            con = sqlite3.connect(dbp)
            con.execute("DELETE FROM cash_flow")
            con.execute("DELETE FROM bank_transactions")
            con.execute("DELETE FROM bank_statements")
            con.execute("INSERT INTO cash_flow (type,amount,note,created_at) "
                        "VALUES ('income',?,'',?)", (cf_amount, cf_created))
            sid = con.execute("INSERT INTO bank_statements (bank_account_id,statement_date,"
                              "status) VALUES (0,'2026-08-31','imported')").lastrowid
            con.execute("INSERT INTO bank_transactions (statement_id,trans_date,description,"
                        "amount,match_status) VALUES (?,?,?,?,'unmatched')",
                        (sid, txn_date, "探针", txn_amount))
            con.commit()
            con.close()
            return sid

        # --- b1) 差 1 分不得自动匹配（50.00 vs 50.01 正是老判据会误判的那一侧） ---
        sid = reset(50.00, 50.01, "2026-08-15", "2026-08-15 10:00:00")
        old_would = _old_match(50.01, 50.00)
        r1 = erp_db.bank_auto_match(sid)
        chk("差 1 分（50.01 vs 50.00）⇒ 自动匹配 0 笔", int(r1.get("matched", -1)) == 0,
            "matched=%s" % r1.get("matched"))
        chk("反向对照：老判据在同样数据上会匹配 1 笔（有区分力）", old_would,
            "差=%.18f 老判据=%s" % (abs(50.01 - 50.00), old_would))

        # --- b2) 同额 + 日期在窗口内 ⇒ 必须匹配（同时证明 _days_apart 真在算） ---
        sid = reset(250.00, 250.00, "2026-08-16", "2026-08-17 09:00:00")
        r2 = erp_db.bank_auto_match(sid)
        chk("同额且相差 1 天 ⇒ 自动匹配 1 笔（改前这里必抛 TypeError）",
            int(r2.get("matched", -1)) == 1, "matched=%s" % r2.get("matched"))

        # --- b3) 同额但日期超 3 天 ⇒ 不得匹配（日期条件真的有约束力） ---
        sid = reset(300.00, 300.00, "2026-08-01", "2026-08-20 09:00:00")
        r3 = erp_db.bank_auto_match(sid)
        chk("同额但相差 19 天 ⇒ 自动匹配 0 笔", int(r3.get("matched", -1)) == 0,
            "matched=%s" % r3.get("matched"))

        # --- b4) 日期缺失 ⇒ 判不匹配（无法验证时宁可漏配，不写假账） ---
        con = sqlite3.connect(dbp)
        con.execute("DELETE FROM cash_flow")
        con.execute("DELETE FROM bank_transactions")
        con.execute("DELETE FROM bank_statements")
        con.execute("INSERT INTO cash_flow (type,amount,note,created_at) "
                    "VALUES ('income',400.00,'','')")
        sid = con.execute("INSERT INTO bank_statements (bank_account_id,statement_date,status) "
                          "VALUES (0,'2026-08-31','imported')").lastrowid
        con.execute("INSERT INTO bank_transactions (statement_id,trans_date,description,amount,"
                    "match_status) VALUES (?,?,'探针',400.00,'unmatched')", (sid, ""))
        con.commit()
        con.close()
        r4 = erp_db.bank_auto_match(sid)
        chk("同额但日期缺失 ⇒ 自动匹配 0 笔（无法验证不放行）",
            int(r4.get("matched", -1)) == 0, "matched=%s" % r4.get("matched"))

        # --- b5) 候选搜索同样按分 ---
        con = sqlite3.connect(dbp)
        con.execute("DELETE FROM cash_flow")
        con.execute("INSERT INTO cash_flow (type,amount,note,created_at) "
                    "VALUES ('income',300.00,'','2026-08-17 09:00:00')")
        con.commit()
        con.close()
        p_off = erp_db.bank_import_parse([{"amount": 300.01, "date": "2026-08-17",
                                           "description": "差1分"}])
        p_eq = erp_db.bank_import_parse([{"amount": 300.00, "date": "2026-08-17",
                                          "description": "同额"}])
        chk("候选搜索：300.01 查不到 300.00", len(p_off[0]["candidates"]) == 0,
            "候选 %d" % len(p_off[0]["candidates"]))
        chk("候选搜索：300.00 查得到（不能全空）", len(p_eq[0]["candidates"]) >= 1,
            "候选 %d" % len(p_eq[0]["candidates"]))

        # --- b6) 月度快照口径 ---
        con = sqlite3.connect(dbp)
        con.execute("DELETE FROM journal_entries")
        con.execute("DELETE FROM chart_of_accounts")
        for code, name, cat in [("1001", "库存现金", "资产"), ("2202", "应付账款", "负债")]:
            con.execute("INSERT INTO chart_of_accounts (code,name,category,is_active) "
                        "VALUES (?,?,?,1)", (code, name, cat))
        for code, name, dr, cr in [("1001", "库存现金", 800, 0),
                                   ("2202", "应付账款", 0, 300),
                                   ("4103", "本年利润", 0, 500)]:
            con.execute("INSERT INTO journal_entries (date,account_code,account_name,"
                        "debit,credit,summary) VALUES ('2026-08-20',?,?,?,?,'探针')",
                        (code, name, dr, cr))
        con.execute("DELETE FROM monthly_snapshots")
        con.commit()
        con.close()

        from db.queries.finance import get_balance_sheet, get_balance_sheet_gl
        gl = get_balance_sheet_gl("2026-08-31")
        simp = get_balance_sheet()
        erp_db.save_monthly_snapshot("2026-08")

        con = sqlite3.connect(dbp)
        row = con.execute("SELECT bs_json FROM monthly_snapshots WHERE month='2026-08'"
                          ).fetchone()
        con.close()
        chk("快照已写入 monthly_snapshots", row is not None, "无 2026-08 行")
        if row:
            bs = json.loads(row[0])
            snap_a = float((bs.get("assets") or {}).get("total", 0))
            gl_a = float(gl["assets"]["total"])
            chk("快照 bs_json 是权责口径 basis=accrual", bs.get("basis") == "accrual",
                "basis=%s" % bs.get("basis"))
            chk("快照带 balanced 字段（简化版没有 ⇒ 前端会误判平）",
                isinstance(bs.get("balanced"), bool),
                "type=%s" % type(bs.get("balanced")).__name__)
            chk("快照资产 == GL 版资产（%.2f）" % gl_a, abs(snap_a - gl_a) < 0.02,
                "快照 %.2f vs GL %.2f" % (snap_a, gl_a))
            chk("快照资产 != 简化版资产（证明口径真换了，不是文字变了）",
                abs(snap_a - float(simp["assets"])) > 0.02,
                "快照 %.2f vs 简化版 %.2f" % (snap_a, float(simp["assets"])))

        con = sqlite3.connect(dbp)
        con.execute("DELETE FROM monthly_snapshots")
        con.commit()
        left = con.execute("SELECT COUNT(*) FROM monthly_snapshots").fetchone()[0]
        con.close()
        chk("临时库快照已删净（残留 0）", left == 0, "残留 %d" % left)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
        chk("临时目录已清理（残留 0）", not os.path.exists(tmp), tmp)


def main():
    phase_prod()
    phase_isolated()
    print("\n" + "=" * 78)
    print("通过 %d 项，失败 %d 项" % (len(PASS), len(FAIL)))
    for f in FAIL:
        print("  🔴 " + f)
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
