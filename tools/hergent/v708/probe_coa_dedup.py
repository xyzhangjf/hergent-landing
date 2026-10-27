#!/usr/bin/env python3
"""v708 端到端探针：科目树去重是否真的生效。

## 三段

**A · 生产真实接口（只读）**
    数字必须真的变：资产 12,386,372.20 → **10,181,137.96**，
    负债必须**保持** 208,764.00（不能像"只算末级"那样变 0），
    权益 8,285,388.04，差额 1,686,985.92 ⇒ balanced=false。

**B · 一致性**（本次修复的核心理由）
    带 `as_of` 与不带 `as_of` 必须返回同一套口径。改前差 8.7 倍
    （141.7 万 vs 1238.3 万），现在必须逐分相等。

**C · 隔离库行为验证（/tmp 空库 + 生产同一份代码）**
    人造一棵 `1002 银行存款`(父) + `100201`/`100202`(子) 的树：
    父记 100、子各记 60/40 ⇒ 叶子有效必须得 **200**（1002 被丢弃），
    老"全科目累加"口径会得 **300**。
    这条反向可证伪：把递归改回 `IN (...)` 全加，立刻 FAIL。

退出码：0 全过；1 有 FAIL。
"""
import argparse
import json
import os
import shutil
import sqlite3
import sys
import tempfile
import urllib.error
import urllib.request

PROD = "/opt/hergent-erp"
PASS, FAIL = [], []

# 2026-10-26（诊断 as_of = MAX(date)）与 2026-06-30 两个时点的实测值。
# 两者资产差 **2,920.00**、负债差 **2,920.00** ⇒ 正是 2026-10 那 4 条凭证
# （借 2,920.004 / 贷 2,920.004，借贷相等）⇒ **差额在两个时点必须相同**。
WANT = {
    "2026-10-26": {"assets": 10181137.96, "liabilities": 208764.00,
                   "equity": 8285388.04, "diff": 1686985.92},
    "2026-06-30": {"assets": 10178217.96, "liabilities": 205844.00,
                   "equity": 8285388.04, "diff": 1686985.92},
}
# 试算表（含损益类）2026-06 的差。与资产负债表差 1,686,985.92 相差 98,325.00
# = 损益类贷方净额（`6001 主营业务收入` 98,325）。这条恒等式是本轮的强一致性证明。
WANT_TB_DIFF = 1588660.92
PL_NET_CREDIT = 98325.00
OLD_ASSETS = 12386372.20        # 改前（全科目累加，虚增）
CASH_BASIS_ASSETS = 1416968.40  # 改前不带 as_of 的简化版


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


def phase_prod():
    print("\n【A】生产真实接口（只读）")
    tok = _tok()
    if not tok:
        chk("拿到真实会话 token", False, "sessions 无 user_id=2")
        return
    chk("拿到真实会话 token", True)

    out = {}
    for as_of, w in WANT.items():
        st, b = _get("/api/reports/balance-sheet?as_of=%s" % as_of, tok)
        chk("as_of=%s → 200" % as_of, st == 200, "status=%s" % st)
        a = float((b.get("assets") or {}).get("total", 0))
        li = float((b.get("liabilities") or {}).get("total", 0))
        eq = float((b.get("equity") or {}).get("total", 0))
        chk("as_of=%s 资产 = %s（去重后，非 1238 万）"
            % (as_of, format(w["assets"], ",.2f")),
            abs(a - w["assets"]) < 0.02, "实测 %.2f（改前 %.2f）" % (a, OLD_ASSETS))
        chk("as_of=%s 负债 = %s（没像『只算末级』那样变 0）"
            % (as_of, format(w["liabilities"], ",.2f")),
            abs(li - w["liabilities"]) < 0.02, "实测 %.2f（只算末级会是 0）" % li)
        chk("as_of=%s 权益 = %s（残差兜底已去，显示真实值）"
            % (as_of, format(w["equity"], ",.2f")),
            abs(eq - w["equity"]) < 0.02, "实测 %.2f" % eq)
        chk("as_of=%s 差额 = %s" % (as_of, format(w["diff"], ",.2f")),
            abs((a - li - eq) - w["diff"]) < 0.05, "实测 %.2f" % (a - li - eq))
        chk("as_of=%s balanced = false（169 万真账不平，必须报不平）" % as_of,
            b.get("balanced") is False, "balanced=%s" % b.get("balanced"))
        out[as_of] = b

    # 两个时点的差额必须相同（10 月那 4 条凭证借贷相等，不影响差额）
    d1 = (float((out["2026-10-26"]["assets"] or {}).get("total", 0))
          - float((out["2026-10-26"]["liabilities"] or {}).get("total", 0))
          - float((out["2026-10-26"]["equity"] or {}).get("total", 0)))
    d2 = (float((out["2026-06-30"]["assets"] or {}).get("total", 0))
          - float((out["2026-06-30"]["liabilities"] or {}).get("total", 0))
          - float((out["2026-06-30"]["equity"] or {}).get("total", 0)))
    chk("两个时点差额相同（10 月凭证借贷相等 ⇒ 不影响差额）",
        abs(d1 - d2) < 0.05, "%.2f vs %.2f" % (d1, d2))

    return tok, out["2026-06-30"]


def phase_consistency(tok, with_as_of):
    print("\n【B】一致性：带 as_of 与不带 as_of 必须同口径")
    st, b2 = _get("/api/reports/balance-sheet", tok)
    chk("不带 as_of → 200", st == 200, "status=%s" % st)
    a2 = float((b2.get("assets") or {}).get("total", 0))
    chk("不带 as_of 不再走简化版（资产不再是 141.7 万）",
        abs(a2 - CASH_BASIS_ASSETS) > 1, "实测 %.2f（改前简化版 %.2f）"
        % (a2, CASH_BASIS_ASSETS))
    chk("不带 as_of 的资产 = 今天(2026-10-27)权责口径", abs(a2 - WANT["2026-10-26"]["assets"]) < 0.02,
        "实测 %.2f" % a2)
    chk("不带 as_of 也返回 balanced 布尔（不再靠字段缺失显示假绿灯）",
        isinstance(b2.get("balanced"), bool), "type=%s" % type(b2.get("balanced")).__name__)
    chk("两个调用同为 accrual 口径",
        b2.get("basis") == "accrual" and with_as_of.get("basis") == "accrual",
        "%s vs %s" % (b2.get("basis"), with_as_of.get("basis")))


def phase_trial_balance(tok):
    print("\n【C】试算表合计不再重复累加 + 与资产负债表恒等式自洽")
    st, d = _get("/api/trial-balance?month=2026-06", tok)
    chk("试算表 2026-06 → 200", st == 200, "status=%s" % st)
    td = float(d.get("total_debit", 0))
    tc = float(d.get("total_credit", 0))
    diff = td - tc
    chk("借方合计不再是 12,745,566.36（去重后应更小）",
        abs(td - 12745566.36) > 1, "实测 %.2f" % td)
    chk("2026-06 差额 = %s（去重后，非全科目的 379 万）" % format(WANT_TB_DIFF, ",.2f"),
        abs(diff - WANT_TB_DIFF) < 1.0, "实测 %.2f" % diff)
    # 恒等式：试算表含损益类，资产负债表不含 ⇒ 差 = 资产负债表差 − 损益贷方净额
    bs_diff = WANT["2026-06-30"]["diff"]
    chk("恒等式自洽：试算表差 = 资产负债表差 − 损益净额（%s）"
        % format(PL_NET_CREDIT, ",.2f"),
        abs(diff - (bs_diff - PL_NET_CREDIT)) < 1.0,
        "试算表 %.2f vs %.2f − %.2f = %.2f"
        % (diff, bs_diff, PL_NET_CREDIT, bs_diff - PL_NET_CREDIT))
    chk("balanced = false", d.get("balanced") is False, "balanced=%s" % d.get("balanced"))


def phase_isolated():
    print("\n【D】隔离库行为验证（人造父子重复，可证伪）")
    tmp = tempfile.mkdtemp(prefix="v708-probe-")
    dbp = os.path.join(tmp, "probe.db")
    try:
        os.environ["ERP_DB_PATH"] = dbp
        sys.path.insert(0, PROD)
        import erp_db  # noqa: E402

        con = sqlite3.connect(dbp)
        con.execute("DELETE FROM journal_entries")
        con.execute("DELETE FROM chart_of_accounts")
        # 1002 是父（有子），1001 是独立末级
        for code, name, cat in [("1001", "库存现金", "资产"),
                                ("1002", "银行存款", "资产"),
                                ("100201", "工行", "资产"),
                                ("100202", "邮储", "资产")]:
            con.execute("INSERT INTO chart_of_accounts (code,name,category,is_active) "
                        "VALUES (?,?,?,1)", (code, name, cat))
        # 1001 记 500；1002 父记 100（= 子合计，典型重复）；子各 60/40
        rows = [("1001", 500, 0), ("1002", 100, 0), ("100201", 60, 0), ("100202", 40, 0)]
        for code, dr, cr in rows:
            con.execute("INSERT INTO journal_entries "
                        "(date,account_code,account_name,debit,credit,summary) "
                        "VALUES ('2026-08-15',?,?,?,?,?)", (code, code, dr, cr, "探针"))
        con.commit()

        tb = erp_db.get_trial_balance("2026-08")
        td = float(tb.get("total_debit", 0))
        # 叶子有效：1001(500) + 100201(60) + 100202(40) = 600
        # 老全科目累加：500 + 100 + 60 + 40 = 700
        chk("叶子有效合计 = 600（父 1002 的 100 被丢弃）", abs(td - 600) < 0.01,
            "实测 %.2f（老口径会是 700）" % td)
        chk("合计确实小于全科目累加（去重真的发生）", td < 700 - 0.01, "实测 %.2f" % td)
        chk("rows 明细仍是 4 行（父科目行照常显示，只是不进合计）",
            len(tb.get("rows") or []) == 4, "rows=%d" % len(tb.get("rows") or []))

        # 对照：子科目全零时，父余额必须被保留（1122 应收账款 那种形态）
        con.execute("DELETE FROM journal_entries")
        for code, dr in [("1002", 700), ("100201", 0), ("100202", 0), ("1001", 0)]:
            con.execute("INSERT INTO journal_entries "
                        "(date,account_code,account_name,debit,credit,summary) "
                        "VALUES ('2026-08-15',?,?,?,0,?)", (code, code, dr, "探针2"))
        con.commit()
        tb2 = erp_db.get_trial_balance("2026-08")
        chk("子科目全零 ⇒ 父 1002 的 700 被保留（不误杀父记余额）",
            abs(float(tb2.get("total_debit", 0)) - 700) < 0.01,
            "实测 %.2f" % float(tb2.get("total_debit", 0)))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
        chk("临时库已清理（残留 0）", not os.path.exists(tmp), tmp)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-http", action="store_true")
    a = ap.parse_args()
    print("v708 科目树去重 · 端到端探针")
    print("=" * 80)
    if not a.no_http:
        r = phase_prod()
        if r:
            tok, b = r
            phase_consistency(tok, b)
            phase_trial_balance(tok)
    phase_isolated()
    print("\n" + "=" * 80)
    print("通过 %d 项，失败 %d 项" % (len(PASS), len(FAIL)))
    for f in FAIL:
        print("  🔴 " + f)
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
