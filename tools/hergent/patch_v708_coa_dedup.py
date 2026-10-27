#!/usr/bin/env python3
"""v708 立项修复：科目树去重（父子重复计入）+ 资产负债表只留一套口径。

## 三个问题（2026-10-27 实测，`tools/hergent/v708/diagnose_coa_hierarchy.py`）

`tenant_1` 换成三种口径算出来的资产差得离谱：

| 口径 | 资产 | 负债 | 权益 | 差额 |
|---|---|---|---|---|
| ① 现报表（全科目累加） | 12,386,372.20 | 208,764.00 | 8,285,388.04 | +3,892,220.16 |
| ② 仅末级科目 | 3,272,671.32 | **0.00** | 8,285,388.04 | −5,012,716.72 |
| ③ 叶子有效（本版采用） | **10,181,137.96** | 208,764.00 | 8,285,388.04 | +1,686,985.92 |

**为什么 ② 不行**：`1122 应收账款` 的 527 万记在**父科目**上，子科目 `112201~112203` 全是 0。
只算末级会把这 527 万直接砍掉；同理 `2202 应付账款` 20.9 万也归零（负债变 0）。
**为什么 ① 不行**：`1002 银行存款` 414,602.56 恰好等于其 7 个子科目之和
（`100201~100207`），被算两次；`1231 其他应收款` 甚至叠了两层。

⇒ 同一账套里「父=子和的真重复」和「钱记在父上的真余额」**混在一起**，
只能递归逐层判：**有非零余额子科目就用子（父余额是派生），子全零才用父**。

## 改三处

1. **`db/queries/finance.py::get_balance_sheet_gl`** — 汇总改「叶子有效」。
   同时**去掉权益残差兜底**（`if total_equity == 0: equity = 资产 − 负债`）：
   那行会让等式永远成立，判据失去判别力。现在如实显示权益 828.5 万，
   差额 169 万一眼能看到 —— 这是真账不平，不该被"凑平"。
2. **`erp_db.py::get_trial_balance`** — 借贷合计只加「记账层」科目
   （`rows` 明细不变，父科目行照常显示，但合计不再重复累加）。
3. **`routers/reports.py::balance_sheet`** — **只留一套口径**：
   不再回落到简化版 `get_balance_sheet()`（那个函数 `equity = 资产 − 负债` 凑等式，
   结构上不可能不平，而且不返回 `balanced` 字段，前端 `!== false` 会把"没算过"
   显示成「✓ 借贷平衡」；两套口径资产差 8.7 倍）。

## 本版**不**解决（数据问题，需老板对账）

叶子有效口径下仍差 **169 万**（`+1,686,985.92`）—— 这是期初凭证
（`ref_type='opening'`，208 行，`summary='舟谱导入期初余额'`）**真实的借贷缺口**，
不是代码问题。补哪一方（其他应付款？股东垫资？还是某项资产虚高）属于会计判断，
代码不能替老板编一笔分录把账做平。

## 用法

    python3 patch_v708_coa_dedup.py --dry-run
    python3 patch_v708_coa_dedup.py
    python3 patch_v708_coa_dedup.py --revert
"""
import argparse
import py_compile
import shutil
import sys
from pathlib import Path

DEFAULT_ROOT = Path("/opt/hergent-erp")
BAK = ".bak-v708"

OLD_GL = '''def get_balance_sheet_gl(as_of=""):
    """Balance Sheet from journal_entries (accrual basis). Uses COA categories."""
    if not as_of:
        as_of = datetime.now().strftime("%Y-%m-%d")
    from erp_db import get_account_codes_by_category
    with get_db() as db:
        def cat_balance(codes):
            """Net balance for a list of codes: SUM(debit) - SUM(credit)."""
            if not codes:
                return 0
            placeholders = ",".join("?" * len(codes))
            r = db.execute(
                f"SELECT COALESCE(SUM(debit)-SUM(credit),0) FROM journal_entries "
                f"WHERE account_code IN ({placeholders}) AND date<=?",
                codes + [as_of]
            ).fetchone()
            return r[0] if r else 0

        asset_codes = get_account_codes_by_category("\u8d44\u4ea7")
        liability_codes = get_account_codes_by_category("\u8d1f\u503a")
        equity_codes = get_account_codes_by_category("\u6743\u76ca")

        total_assets = cat_balance(asset_codes)  # Dr balance = positive
        total_liabilities = -cat_balance(liability_codes)  # Cr balance, negated to positive
        total_equity = -cat_balance(equity_codes)  # Cr balance, negated to positive
        if total_equity == 0:
            total_equity = total_assets - total_liabilities  # residual

        balanced = money_balanced(total_assets, total_liabilities + total_equity)
        return {
            "as_of": as_of, "basis": "accrual",
            "assets": {"total": round(total_assets, 2)},
            "liabilities": {"total": round(total_liabilities, 2)},
            "equity": {"total": round(total_equity, 2)},
            "balanced": balanced
        }'''

NEW_GL = '''def get_balance_sheet_gl(as_of=""):
    """Balance Sheet from journal_entries (accrual basis).

    v708：汇总改「叶子有效」口径，去掉权益残差兜底。

    老实现 `SUM(debit)-SUM(credit) WHERE account_code IN (整类)` 会把父科目和
    子科目一起加 —— 本账套里 `1002 银行存款` 414,602.56 恰好等于其 7 个子科目之和
    （`100201~100207`），于是同一笔钱被算两次；`1231 其他应收款` 叠了两层。
    实测资产虚增到 12,386,372.20，真实值 10,181,137.96。

    也不能一刀切「只算末级」：`1122 应收账款` 的 527 万记在**父科目**上、
    子科目全是 0，砍掉父就丢了真应收（资产会掉到 327 万、负债直接变 0）。
    两种形态混在同一账套里 ⇒ 递归逐层判：有非零余额子科目就用子，子全零才用父。
    """
    if not as_of:
        as_of = datetime.now().strftime("%Y-%m-%d")
    with get_db() as db:
        # 一次取该时点全部科目余额，再在内存里按科目树去重（避免 300+ 次往返）
        bal = {r[0]: r[1] for r in db.execute(
            "SELECT account_code, COALESCE(SUM(debit)-SUM(credit),0) "
            "FROM journal_entries WHERE date<=? GROUP BY account_code",
            (as_of,)).fetchall()}
        rows = db.execute(
            "SELECT code, category FROM chart_of_accounts WHERE is_active=1").fetchall()

        by_cat = {}
        for code, cat in rows:
            by_cat.setdefault(cat, set()).add(code)

        def _eff(code, codes, depth=0):
            """叶子有效：有非零余额子科目 ⇒ 只累加子（父余额是派生）；否则用自己。"""
            if depth > 8:
                return bal.get(code, 0.0)
            kids = [c for c in codes if c != code and c.startswith(code)]
            if not kids:
                return bal.get(code, 0.0)
            live = [c for c in kids if abs(bal.get(c, 0.0)) > 0.005]
            if not live:
                return bal.get(code, 0.0)  # 子科目全零 ⇒ 钱记在父科目上
            return sum(_eff(c, codes, depth + 1) for c in live)

        def cat_balance(category):
            codes = by_cat.get(category, set())
            tops = [c for c in codes
                    if not any(c != x and c.startswith(x) for x in codes)]
            return sum(_eff(c, codes) for c in tops)

        total_assets = cat_balance("\u8d44\u4ea7")
        total_liabilities = -cat_balance("\u8d1f\u503a")
        total_equity = -cat_balance("\u6743\u76ca")

        # v708：删掉「权益为 0 就拿残差凑」的兜底。那行会让
        # `资产 - (负债 + 权益)` 恒等于 0 ⇒ balanced 恒真、判据没有判别力。
        # 现在如实显示权益，差额一眼可见（本账套 169 万是真账不平）。
        balanced = money_balanced(total_assets, total_liabilities + total_equity)
        return {
            "as_of": as_of, "basis": "accrual",
            "assets": {"total": round(total_assets, 2)},
            "liabilities": {"total": round(total_liabilities, 2)},
            "equity": {"total": round(total_equity, 2)},
            "balanced": balanced
        }'''

OLD_TB = '''        total_debit,total_credit = 0,0
        for c in coa:
            de = db.execute("SELECT COALESCE(SUM(debit),0) as d,COALESCE(SUM(credit),0) as c FROM journal_entries WHERE account_code=? AND substr(date,1,7)=?",(c["code"],month)).fetchone()
            cd = dict(c); cd["debit"]=de[0]; cd["credit"]=de[1]
            balance = de[0]-de[1]
            if c["category"] in ("\u8d44\u4ea7","\u6210\u672c","\u8d39\u7528"): cd["balance"]=balance
            else: cd["balance"]=-balance
            cd["balance_dir"]="\u501f" if cd["balance"]>=0 else "\u8d37"
            cd["balance"]=abs(cd["balance"])
            total_debit+=de[0]; total_credit+=de[1]
            tb.append(cd)'''

NEW_TB = '''        dc = {}
        codes = [c["code"] for c in coa]
        for c in coa:
            de = db.execute("SELECT COALESCE(SUM(debit),0) as d,COALESCE(SUM(credit),0) as c FROM journal_entries WHERE account_code=? AND substr(date,1,7)=?",(c["code"],month)).fetchone()
            dc[c["code"]] = (de[0], de[1])
            cd = dict(c); cd["debit"]=de[0]; cd["credit"]=de[1]
            balance = de[0]-de[1]
            if c["category"] in ("\u8d44\u4ea7","\u6210\u672c","\u8d39\u7528"): cd["balance"]=balance
            else: cd["balance"]=-balance
            cd["balance_dir"]="\u501f" if cd["balance"]>=0 else "\u8d37"
            cd["balance"]=abs(cd["balance"])
            tb.append(cd)
        # v708：合计只加「记账层」科目。父科目余额是子科目的派生，
        # 父子同加会把同一笔钱算两次（实测 1002 银行存款 = 其 7 个子科目之和）。
        # rows 明细一行不动 —— 父科目行照常显示它自己的数，只是不进合计。
        keep = _ledger_codes(codes, {k: v[0] - v[1] for k, v in dc.items()})
        total_debit = sum(dc[c][0] for c in keep)
        total_credit = sum(dc[c][1] for c in keep)'''

HELPER_ANCHOR = '''def get_trial_balance(month=""):'''

HELPER = '''def _ledger_codes(codes, balances):
    """返回「真正记账的那一层」科目 code（父科目余额是派生 ⇒ 不计入合计）。

    判据与 `db/queries/finance.py::get_balance_sheet_gl._eff` 保持一致：
    有非零余额子科目 ⇒ 递归往下；子科目全零 ⇒ 父自己就是记账层
    （本账套 `1122 应收账款` 527 万就是这种形态）。
    """
    codes = list(codes)
    out = []

    def walk(code, depth):
        if depth > 8:
            out.append(code)
            return
        kids = [c for c in codes if c != code and c.startswith(code)]
        if not kids:
            out.append(code)
            return
        live = [c for c in kids if abs(balances.get(c, 0.0)) > 0.005]
        if not live:
            out.append(code)  # 子科目全零 ⇒ 钱记在父科目上
            return
        for c in live:
            walk(c, depth + 1)

    for top in [c for c in codes if not any(c != x and c.startswith(x) for x in codes)]:
        walk(top, 0)
    return out


def get_trial_balance(month=""):'''

OLD_ROUTE = '''def balance_sheet(request: Request, as_of: str = ""):
    _auth(request)
    if as_of:
        from db.queries.finance import get_balance_sheet_gl
        gl = get_balance_sheet_gl(as_of)
        if gl and gl.get("assets", {}).get("total", 0) > 0:
            return gl
    return db.get_balance_sheet()'''

NEW_ROUTE = '''def balance_sheet(request: Request, as_of: str = ""):
    """v708：只留一套口径（权责发生制，读 journal_entries）。

    \u6539\u524d\u4e0d\u5e26 as_of \u65f6\u56de\u843d\u7b80\u5316\u7248 `get_balance_sheet()`\uff0c\u5b83\u6709\u4e24\u4e2a\u786c\u4f24\uff1a
    ① \u7528 `equity = \u8d44\u4ea7 \u2212 \u8d1f\u503a` \u6b8b\u5dee\u51d1\u7b49\u5f0f \u21d2 \u7ed3\u6784\u4e0a\u4e0d\u53ef\u80fd\u4e0d\u5e73\uff1b
    ② \u8fd4\u56de\u5bf9\u8c61\u91cc**\u6ca1\u6709** `balanced` \u5b57\u6bb5\uff0c\u800c\u524d\u7aef\u5199\u7684\u662f
       `y.balanced !== false` \u21d2 \u5b57\u6bb5\u7f3a\u5931\u4e5f\u88ab\u5f53\u6210\u201c\u5e73\u201d\uff0c\u4e8e\u662f\u754c\u9762\u4e0a\u663e\u793a
       \u300c\u2713 \u501f\u8d37\u5e73\u8861\u300d\u2014\u2014\u800c\u90a3\u4e2a\u7ed3\u8bba**\u4ece\u6765\u6ca1\u88ab\u8ba1\u7b97\u8fc7**\u3002
    \u4e24\u5957\u53e3\u5f84\u7684\u8d44\u4ea7\u76f8\u5dee 8.7 \u500d\uff08141.7 \u4e07 vs 1238.3 \u4e07\uff09\uff0c\u7528\u6237\u770b\u5230\u54ea\u4e2a\u53d6\u51b3\u4e8e
    \u6709\u6ca1\u6709\u4f20 as_of\uff0c\u8fd9\u672c\u8eab\u5c31\u662f\u7f3a\u9677\u3002

    \u73b0\u5728\u53ea\u6709\u4e00\u5957\uff1a\u6709\u51ed\u8bc1\u5c31\u6309\u79d1\u76ee\u6811\u7b97\uff1b\u6ca1\u51ed\u8bc1\u5c31\u662f\u5168 0\uff080=0 \u786e\u5b9e\u5e73\uff09\u3002
    """
    _auth(request)
    from db.queries.finance import get_balance_sheet_gl
    return get_balance_sheet_gl(as_of or datetime.now().strftime("%Y-%m-%d"))'''

TARGETS = [
    ("db/queries/finance.py", OLD_GL, NEW_GL, "get_balance_sheet_gl → 叶子有效口径 + 去残差兜底"),
    ("erp_db.py", OLD_TB, NEW_TB, "get_trial_balance 合计 → 只加记账层科目"),
    ("erp_db.py", HELPER_ANCHOR, HELPER, "新增 _ledger_codes 辅助函数"),
    ("routers/reports.py", OLD_ROUTE, NEW_ROUTE, "/reports/balance-sheet → 只留一套口径"),
]

IMPORTS = [
    ("routers/reports.py", "import csv, io, json, logging",
     "import csv, io, json, logging\nfrom datetime import datetime",
     "reports.py 补 datetime 导入（新路由用到）"),
]


def _count(t, n):
    return t.count(n)


def _apply(root, rel, old, new, desc, dry, log):
    p = root / rel
    if not p.exists():
        log("🔴 %s 不存在：%s" % (rel, p))
        return "error"
    t = p.read_text(encoding="utf-8")
    n_old, n_new = _count(t, old), _count(t, new)
    # 幂等：先判「新串已在位」（旧串可能是新串的前缀，反过来判会重复插入）
    if n_new == 1:
        log("⏭  %-24s 已就位（幂等跳过）— %s" % (rel, desc))
        return "already"
    if n_new > 1:
        log("🔴 %-24s 新串出现 %d 次（疑似重复写入）— %s" % (rel, n_new, desc))
        return "error"
    if n_old != 1:
        log("🔴 %-24s 锚点出现 %d 次（应为 1）— %s" % (rel, n_old, desc))
        log("     锚点开头：%s" % old.splitlines()[0][:90])
        log("     拒绝执行，请人工核对源码结构")
        return "error"
    if dry:
        log("🔍 %-24s 待替换 — %s" % (rel, desc))
        return "dry"
    if not (root / (rel + BAK)).exists():
        shutil.copy2(p, root / (rel + BAK))
    p.write_text(t.replace(old, new, 1), encoding="utf-8")
    log("✅ %-24s 已替换 — %s" % (rel, desc))
    return "changed"


def verify(root, log):
    ok = True
    fin = (root / "db/queries/finance.py").read_text(encoding="utf-8")
    erp = (root / "erp_db.py").read_text(encoding="utf-8")
    rpt = (root / "routers/reports.py").read_text(encoding="utf-8")

    if "_eff(code, codes, depth=0)" not in fin:
        log("🔴 finance.py 缺 _eff 递归（叶子有效口径没生效）"); ok = False
    if "total_equity = total_assets - total_liabilities" in fin:
        log("🔴 finance.py 残差兜底仍在（判据仍无判别力）"); ok = False
    if "def _ledger_codes(" not in erp:
        log("🔴 erp_db.py 缺 _ledger_codes"); ok = False
    if "total_debit+=de[0]; total_credit+=de[1]" in erp:
        log("🔴 erp_db.py 试算表合计仍在全科目累加"); ok = False
    if "return db.get_balance_sheet()" in rpt:
        log("🔴 reports.py 仍在回落简化版（两套口径未合一）"); ok = False
    if "from datetime import datetime" not in rpt:
        log("🔴 reports.py 缺 datetime 导入（新路由会 NameError）"); ok = False
    return ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=str(DEFAULT_ROOT))
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--revert", action="store_true")
    a = ap.parse_args()
    root = Path(a.root)

    def log(s):
        print(s)

    if a.revert:
        for rel in ("db/queries/finance.py", "erp_db.py", "routers/reports.py"):
            bak = root / (rel + BAK)
            if bak.exists():
                shutil.copy2(bak, root / rel)
                log("已还原 %s ← %s（记得重启服务）" % (rel, bak.name))
            else:
                log("⏭  %s 无备份，跳过" % rel)
        return 0

    log("v708 科目树去重 + 资产负债表口径合一（root=%s%s）"
        % (root, "，DRY-RUN" if a.dry_run else ""))
    log("=" * 88)
    st = []
    for rel, old, new, desc in TARGETS:
        st.append(_apply(root, rel, old, new, desc, a.dry_run, log))
    for rel, old, new, desc in IMPORTS:
        st.append(_apply(root, rel, old, new, desc, a.dry_run, log))

    if "error" in st:
        log("\n🔴 有目标未按预期处理，未写盘。")
        return 2
    if a.dry_run:
        log("\nDRY-RUN 结束，未写盘。")
        return 0

    errs = []
    for rel in ("db/queries/finance.py", "erp_db.py", "routers/reports.py"):
        try:
            py_compile.compile(str(root / rel), doraise=True)
        except py_compile.PyCompileError as e:
            errs.append("%s: %s" % (rel, e))
    if errs:
        log("\n🔴 语法校验失败，回滚：")
        for e in errs:
            log("   " + e)
        for rel in ("db/queries/finance.py", "erp_db.py", "routers/reports.py"):
            bak = root / (rel + BAK)
            if bak.exists():
                shutil.copy2(bak, root / rel)
        return 2
    log("\n✅ 三个文件 py_compile 通过")

    log("\n回读校验：")
    if not verify(root, log):
        return 2
    log("✅ 回读通过")
    log("\n下一步：重启 → 跑 probe_v708（数字必须从 1238 万变 1018 万、负债仍是 20.9 万）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
