#!/usr/bin/env python3
"""报表「平衡」判据统一 —— **双算校验**（只读，不动任何数据）。

## 为什么要这一步

v706 把 `gl_post()` 的借贷平衡判据从「浮点 `abs(dr-cr) <= 0.01`」换成
「整数分 `abs(to_cents(dr)-to_cents(cr)) <= 1`」。但**报表侧还有三处**仍在用
老判据，口径不一致会产生一种自相矛盾：

    过账时允许「差 1 分仍算平」→ 凭证入库
    报表却说「借贷不平衡」      → 老板看到红色 ✗

统一之前必须先回答一个问题：**换成整数分判据后，现有报表的结论会不会翻案？**
（翻案 = 昨天显示"平衡"今天变"不平衡"，或反过来。）

## 三处被判据影响的位置（2026-10-27 生产实盘）

| # | 位置 | 前端可见文案 |
|---|---|---|
| 1 | `erp_db.py:6718` `get_trial_balance()` | 「✓ 试算平衡 / ✗ 试算不平衡」 |
| 2 | `db/queries/finance.py:102` `get_balance_sheet_gl()` | 「✓ 借贷平衡 / ✗ 借贷不平衡」 |
| 3 | `routers/voucher_templates.py:100` `test_template()` | 模板试算预览的红/绿 |

第 3 处是纯函数（把模板套到样本数据上求和），**没有存量数据可双算**，
它只随模板定义变化 —— 所以本脚本只双算 1 和 2。

## 口径必须复刻到浮点尾数，不能"差不多"

两处报表的合计方式**不同**，复刻错一位就会造出假翻案：

- 试算表：`for c in coa: SUM(debit)/SUM(credit) WHERE account_code=?`，
  **逐科目累加**到 total（浮点累加顺序 = COA 的 code 升序）。
- 资产负债表：`SUM(debit)-SUM(credit) WHERE account_code IN (...)`，
  **一条 SQL 汇总整类**（不是逐科目累加）。

所以本脚本宁可难看也要照着原 SQL 写，不"优化"。

## 已知的展示层盲点（统一判据解决不了，需单独看）

`get_balance_sheet_gl()` 有一行残差兜底：

    if total_equity == 0:
        total_equity = total_assets - total_liabilities   # 残差

只要当期没有任何权益类科目余额，`equity` 就被赋成"使等式成立"的值
⇒ `assets - (liab + equity)` 恒等于 0 ⇒ **balanced 恒为 True，没有判别力**。
这个兜底本身是会计恒等式缺项时的展示妥协，不属本次判据统一的范围；
脚本会把"是否走了残差分支"单独统计出来，让这个盲点可见。

## 用法

    python3 dualcheck_report_balance.py                     # 生产三个库
    python3 dualcheck_report_balance.py --db /path/x.db     # 只算一个库
    python3 dualcheck_report_balance.py --json              # 机器可读

退出码：0 = 双算完成；2 = 有翻案（脚本不修，只报告）。
"""
import argparse
import json
import os
import sqlite3
import sys

# 双算必须调用**生产真实实现**，不能在这里手抄一份 to_cents —— 抄错了就是在验证自己。
sys.path.insert(0, "/opt/hergent-erp")
from db.precision import MONEY_EPS_CENTS, money_balanced, to_cents  # noqa: E402

DEFAULT_DBS = ["/opt/hergent-erp/erp.db",
               "/opt/hergent-erp/tenant_1.db",
               "/opt/hergent-erp/tenant_10.db"]

OLD_EPS = 0.01          # 老判据字面量，逐字复刻（不要改成 MONEY_EPS，就是要看老值）


def _ro(path):
    """只读打开。文件不存在 / 打不开都必须失败退出，不能静默跳过。"""
    if not os.path.exists(path):
        raise SystemExit("库不存在：%s" % path)
    return sqlite3.connect("file:%s?mode=ro" % path, uri=True)


def _old_balanced(a, b):
    """老判据：浮点 `abs(a-b) < 0.01`（严格小于）。逐字复刻三处源码。"""
    return abs(a - b) < OLD_EPS


def months_of(con):
    rows = con.execute(
        "SELECT DISTINCT substr(date,1,7) FROM journal_entries "
        "WHERE date IS NOT NULL AND length(date)>=7 ORDER BY 1"
    ).fetchall()
    return [r[0] for r in rows if r[0] and len(r[0]) == 7 and r[0][4] == "-"]


def trial_balance_check(con, month):
    """复刻 `get_trial_balance(month)` 的合计方式：逐科目累加，COA code 升序。"""
    coa = con.execute(
        "SELECT code, name, category FROM chart_of_accounts WHERE is_active=1 ORDER BY code"
    ).fetchall()
    total_debit = 0
    total_credit = 0
    for code, _name, _cat in coa:
        r = con.execute(
            "SELECT COALESCE(SUM(debit),0), COALESCE(SUM(credit),0) "
            "FROM journal_entries WHERE account_code=? AND substr(date,1,7)=?",
            (code, month),
        ).fetchone()
        total_debit += r[0]
        total_credit += r[1]
    diff = total_debit - total_credit
    old = _old_balanced(total_debit, total_credit)
    new = money_balanced(total_debit, total_credit)
    return {
        "month": month, "accounts": len(coa),
        "total_debit": round(total_debit, 6), "total_credit": round(total_credit, 6),
        "diff": diff, "cents_diff": to_cents(total_debit) - to_cents(total_credit),
        "old": old, "new": new, "flipped": old != new,
    }


def balance_sheet_check(con, as_of):
    """复刻 `get_balance_sheet_gl(as_of)`：整类一条 SQL 汇总 + 权益残差兜底。"""
    def codes(category):
        return [r[0] for r in con.execute(
            "SELECT code FROM chart_of_accounts WHERE category=? AND is_active=1", (category,)
        ).fetchall()]

    def cat_balance(cl):
        if not cl:
            return 0
        ph = ",".join("?" * len(cl))
        r = con.execute(
            "SELECT COALESCE(SUM(debit)-SUM(credit),0) FROM journal_entries "
            "WHERE account_code IN (%s) AND date<=?" % ph, cl + [as_of]
        ).fetchone()
        return r[0] if r else 0

    asset_codes = codes("资产")
    liability_codes = codes("负债")
    equity_codes = codes("权益")

    total_assets = cat_balance(asset_codes)
    total_liabilities = -cat_balance(liability_codes)
    total_equity = -cat_balance(equity_codes)
    residual_used = False
    if total_equity == 0:                      # ← 源码原样，含精确 == 0 比较
        total_equity = total_assets - total_liabilities
        residual_used = True

    rhs = total_liabilities + total_equity
    old = _old_balanced(total_assets, rhs)
    new = money_balanced(total_assets, rhs)
    return {
        "as_of": as_of, "assets": round(total_assets, 6),
        "liabilities": round(total_liabilities, 6), "equity": round(total_equity, 6),
        "diff": total_assets - rhs, "cents_diff": to_cents(total_assets) - to_cents(rhs),
        "residual_used": residual_used, "old": old, "new": new, "flipped": old != new,
        "codes": {"资产": len(asset_codes), "负债": len(liability_codes), "权益": len(equity_codes)},
    }


def as_of_candidates(con):
    """资产负债表可被查询的时点：各月末 + 今天（前端默认不带 as_of 时不走 GL 版，故取年末/今）。"""
    import datetime
    today = datetime.date.today().isoformat()
    out = []
    for (d,) in con.execute(
        "SELECT DISTINCT substr(date,1,7) FROM journal_entries WHERE date IS NOT NULL ORDER BY 1"
    ).fetchall():
        if not d or len(d) != 7:
            continue
        y, m = int(d[:4]), int(d[5:7])
        if m == 12:
            nxt = datetime.date(y + 1, 1, 1)
        else:
            nxt = datetime.date(y, m + 1, 1)
        out.append((nxt - datetime.timedelta(days=1)).isoformat())
    out.append(today)
    return sorted(set(out))


def run_db(path):
    con = _ro(path)
    try:
        has_je = con.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='journal_entries'"
        ).fetchone()[0]
        if not has_je:
            return {"db": path, "skip": "无 journal_entries 表"}
        n = con.execute("SELECT COUNT(*) FROM journal_entries").fetchone()[0]
        tb = [trial_balance_check(con, m) for m in months_of(con)]
        bs = [balance_sheet_check(con, d) for d in as_of_candidates(con)]
        return {"db": path, "entries": n, "trial_balance": tb, "balance_sheet": bs}
    finally:
        con.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", action="append", help="只算指定库（可多次）")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    dbs = a.db or DEFAULT_DBS

    results = [run_db(p) for p in dbs]
    flips = 0
    for r in results:
        if "skip" in r:
            continue
        flips += sum(1 for x in r["trial_balance"] if x["flipped"])
        flips += sum(1 for x in r["balance_sheet"] if x["flipped"])

    if a.json:
        print(json.dumps({"results": results, "flips": flips}, ensure_ascii=False, indent=2))
        return 2 if flips else 0

    print("报表平衡判据双算（只读）")
    print("  老判据 |dr-cr| < 0.01 （浮点）   新判据 |分差| <= %d （整数分）" % MONEY_EPS_CENTS)
    print("=" * 92)
    for r in results:
        print("\n【%s】凭证 %s 条" % (r["db"], r.get("entries", "-")))
        if "skip" in r:
            print("  跳过：%s" % r["skip"])
            continue
        print("  -- 试算表 --")
        if not r["trial_balance"]:
            print("     无凭证，无月份可算")
        for x in r["trial_balance"]:
            print("     %s  借 %14.2f  贷 %14.2f  差 %14.6f (分差 %+d)  老=%s 新=%s%s"
                  % (x["month"], x["total_debit"], x["total_credit"], x["diff"], x["cents_diff"],
                     "平" if x["old"] else "不平", "平" if x["new"] else "不平",
                     "   ⚠翻案" if x["flipped"] else ""))
        print("  -- 资产负债表 --")
        for x in r["balance_sheet"]:
            tag = " [权益走残差兜底⇒恒平]" if x["residual_used"] else ""
            print("     %s  资产 %14.2f  负债 %14.2f  权益 %14.2f  差 %12.6f  老=%s 新=%s%s%s"
                  % (x["as_of"], x["assets"], x["liabilities"], x["equity"], x["diff"],
                     "平" if x["old"] else "不平", "平" if x["new"] else "不平",
                     "   ⚠翻案" if x["flipped"] else "", tag))
    print("\n" + "=" * 92)
    print("翻案合计：%d 处" % flips)
    return 2 if flips else 0


if __name__ == "__main__":
    sys.exit(main())
