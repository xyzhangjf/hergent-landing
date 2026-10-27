#!/usr/bin/env python3
"""v710 补丁：对账匹配判据按整数分 + 月度快照与报表同口径。

## 改什么（3 处，都在后端）

1. `db/queries/finance.py` `bank_import_parse()` 的候选 SQL
   `ABS(cf.amount-?)<0.01` → `ROUND(cf.amount,2)=ROUND(?,2)`

2. `db/queries/finance.py` `bank_auto_match()` 的金额判等
   `abs(abs(txn)-abs(pmt)) < 0.01` → `money_eq(abs(txn), abs(pmt))`

   ⚠️ 第 2 处会**自动写库**（把 cash_flow 标记 `[已对账]`、bank_transactions 标记 matched），
   所以判据错了是**真错配**，不是显示问题。

3. `erp_db.py` `save_monthly_snapshot()` 改用 GL 版（`get_pnl_gl`/`get_balance_sheet_gl`）
   原来存简化版，与 v708 起只留 GL 版的报表页**两个口径**。

## 为什么（双算结论，见 v710/dualcheck_v710.py）

老判据 `abs(a-b) < 0.01` 在浮点下同一个业务事实给相反结论：
    `50.00 vs 50.01` 差=0.009999999999998010 ⇒ **判相等**（会错配）
    `2000.00 vs 1999.99` 差=0.009999999999999787 ⇒ **判相等**
    `1234.56 vs 1234.55` 差=0.010000000000047748 ⇒ **判不相等**
生产真实金额 11,531 个、近邻比较 69,186 次，**16,456 次结论相反**。

## 不动什么（有意的）

`get_balance_sheet_gl._eff` 里的 `abs(bal) > 0.005` **保持原样**。它是「科目有没有余额」的
阈值，不是「两笔钱是否同一笔」的判据；生产 43 个科目上新旧判据**零分歧**，
而 0.005 处两者会分歧（老=零 / 整数分=1 分）⇒ 改了有语义变化、无收益。

## 用法

    python3 patch_v710_precision_family.py --dry-run
    python3 patch_v710_precision_family.py
    python3 patch_v710_precision_family.py --revert
"""
import argparse
import os
import py_compile
import shutil
import sys

# 目录可用环境变量覆盖，目的是**让回滚能在副本上被真正验证**
# （`ERP_DIR=/tmp/xx python3 patch_v710_precision_family.py --revert`），
# 否则"可回滚"只是一句空话。
ERP = os.environ.get("ERP_DIR", "/opt/hergent-erp")
FIN = os.path.join(ERP, "db/queries/finance.py")
MAIN = os.path.join(ERP, "erp_db.py")
IMP = os.path.join(ERP, "import_zhoupu.py")
SUFFIX = ".bak-v710"

FAILS = []


def log(msg):
    print(msg)


def count_occurrences(text, sub):
    n, i = 0, 0
    while True:
        i = text.find(sub, i)
        if i < 0:
            return n
        n += 1
        i += len(sub)


def replace_once(text, old, new, rel, desc):
    """幂等替换。

    🔴 判据顺序是硬要求：**先判新串是否已在位**，再看旧串唯一。
    `NEW = OLD + 追加` 这种形状下 OLD 是 NEW 的前缀，若先判「旧串 0 次即已改」，
    则第二遍跑会**再替换一次**、语法合法、静默劣化（v707 与 v709 各踩一次）。
    """
    n_new = count_occurrences(text, new)
    n_old = count_occurrences(text, old)
    if n_new >= 1:
        log("⏭  %-26s 已是新口径（幂等跳过）— %s" % (rel, desc))
        return text, "already"
    if n_old != 1:
        log("🔴 %-26s 锚点出现 %d 次（应为 1）— %s" % (rel, n_old, desc))
        log("     旧串前 100 字：%s" % old[:100].replace("\n", "\\n"))
        FAILS.append("%s 锚点不唯一（%d 次）" % (rel, n_old))
        return text, "error"
    log("✏️  %-26s %s" % (rel, desc))
    return text.replace(old, new, 1), "done"


# ---------------------------------------------------------------- 替换清单

EDITS_FIN = [
    (
        "from db.precision import money_balanced\n",
        "from db.precision import money_balanced, money_eq\n",
        "新增 money_eq 导入",
    ),
    (
        "WHERE ABS(cf.amount-?)<0.01 AND cf.type=?",
        "WHERE ROUND(cf.amount,2)=ROUND(?,2) AND cf.type=?",
        "bank_import_parse 候选：按分相等",
    ),
    (
        "if abs(abs(txn['amount'])-abs(pmt['amount'])) < 0.01 and",
        "if money_eq(abs(txn['amount'] or 0), abs(pmt['amount'] or 0)) and",
        "bank_auto_match 金额：按分相等",
    ),
    # 🔴 存量崩溃：日期条件是 `字符串 - 字符串`（`'2026-08-15' - '2026-08-15 10:00:00'`）
    # ⇒ 只要金额先匹配上就必抛 TypeError。也就是说 `bank_auto_match` **从来没跑通过**，
    # 只是生产 `bank_transactions` 一直 0 行没人发现。金额判据一改就会走到这里，必须同修。
    (
        "def bank_auto_match(statement_id):\n",
        '''def _days_apart(a, b):
    """两个日期字符串相差几天；任一缺失/非法则返回 999（视为「无法验证」）。

    改前这里写的是 `abs((日字符串)-(日字符串)) <= 3` —— Python 里 `str - str` 直接
    TypeError，所以 `bank_auto_match` 只要金额匹配上就 100% 崩。缺日期时**判不匹配**
    而不是放行：自动匹配会写库（标记 [已对账]），宁可漏配让人工确认。
    """
    from datetime import datetime as _dt

    def _p(s):
        if not s:
            return None
        t = str(s)[:19]
        for f in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%Y/%m/%d %H:%M:%S", "%Y/%m/%d"):
            try:
                return _dt.strptime(t, f)
            except ValueError:
                continue
        return None

    da, db_ = _p(a), _p(b)
    if da is None or db_ is None:
        return 999
    return abs((da - db_).days)


def bank_auto_match(statement_id):
''',
        "新增 _days_apart（修 str-str TypeError）",
    ),
    (
        "and abs((txn['trans_date'][:10] if txn['trans_date'] else '')-(pmt['created_at'][:10] if pmt['created_at'] else '')) <= 3:",
        "and _days_apart(txn['trans_date'], pmt['created_at']) <= 3:",
        "bank_auto_match 日期：真算天数",
    ),
]

OLD_SNAP = """    pnl = get_pnl()
    bs = get_balance_sheet()
    cf = get_cashflow()
"""

NEW_SNAP = """    # v710：快照与「报表页」同口径（权责发生制 GL 版）。
    # 改前存的是简化版：`get_balance_sheet()` 用「权益 = 资产 − 负债」残差凑等式、
    # 且返回体**没有** `balanced` 字段；而 `/api/reports/balance-sheet` 自 v708 起
    # 只留 GL 版 ⇒ 同一个月「报表页」和「快照页」会给出两个资产数。
    # 现金流量表本身属收付实现制，`get_cashflow()` 保持不动。
    import calendar as _cal
    _y, _m = int(month[:4]), int(month[5:7])
    _as_of = "%s-%02d" % (month, _cal.monthrange(_y, _m)[1])
    from db.queries.finance import get_pnl_gl as _get_pnl_gl, get_balance_sheet_gl as _get_bs_gl
    pnl = _get_pnl_gl(month)
    bs = _get_bs_gl(_as_of)
    cf = get_cashflow()
"""


# v709 自己加的期初平衡校验：`abs(差) > 0.01` 与报表判据 `money_balanced` 不同源
# ⇒ 同一个「恰好差 1 分」的期初，导入会拒（报不平）而报表判平。改成同一个函数。
IMPORT_EDITS = [
    (
        "    if abs(_dr_total - _cr_total) > 0.01:\n",
        "    from db.precision import money_balanced as _mb\n"
        "    if not _mb(_dr_total, _cr_total):\n",
        "期初平衡校验改用 money_balanced",
    ),
]


def patch_file(path, edits, dry):
    rel = os.path.relpath(path, ERP)
    text = open(path, encoding="utf-8").read()
    orig = text
    stats = []
    for old, new, desc in edits:
        text, st = replace_once(text, old, new, rel, desc)
        stats.append(st)
        if st == "error":
            return stats
    if text == orig:
        return stats
    if dry:
        log("   (dry-run 不落盘：%s 将变更 %d 字节)" % (rel, len(text) - len(orig)))
        return stats
    if not os.path.exists(path + SUFFIX):
        shutil.copy2(path, path + SUFFIX)
        log("   备份 → %s%s" % (rel, SUFFIX))
    open(path, "w", encoding="utf-8").write(text)
    try:
        py_compile.compile(path, doraise=True)
        log("   py_compile ok: %s" % rel)
    except py_compile.PyCompileError as e:
        shutil.copy2(path + SUFFIX, path)
        log("   🔴 py_compile 失败，已回滚：%s" % e)
        FAILS.append("%s 编译失败已回滚" % rel)
    return stats


def revert():
    for path in (FIN, MAIN, IMP):
        if os.path.exists(path + SUFFIX):
            shutil.copy2(path + SUFFIX, path)
            log("↩️  已从备份恢复 %s" % os.path.relpath(path, ERP))
        else:
            log("⏭  无备份，跳过 %s" % os.path.relpath(path, ERP))
    return 0


def verify():
    log("\n【回读校验】")
    fin = open(FIN, encoding="utf-8").read()
    main = open(MAIN, encoding="utf-8").read()

    def bad(label, cond, extra=""):
        if not cond:
            FAILS.append(label)
        log(("  ✅ " if cond else "  🔴 ") + label + (("  " + extra) if extra else ""))

    bad("finance.py 已导入 money_eq", "import money_balanced, money_eq" in fin)
    bad("候选 SQL 已按分相等", "WHERE ROUND(cf.amount,2)=ROUND(?,2) AND cf.type=?" in fin)
    bad("候选 SQL 无残留浮点容差", "ABS(cf.amount-?)<0.01" not in fin)
    bad("自动匹配已用 money_eq",
        "if money_eq(abs(txn['amount'] or 0), abs(pmt['amount'] or 0)) and" in fin)
    bad("自动匹配无残留浮点容差",
        "abs(abs(txn['amount'])-abs(pmt['amount'])) < 0.01" not in fin)
    bad("新增 _days_apart 且只 1 处定义",
        count_occurrences(fin, "def _days_apart(a, b):") == 1,
        "实际 %d 处" % count_occurrences(fin, "def _days_apart(a, b):"))
    bad("日期判据已改真算天数", "and _days_apart(txn['trans_date'], pmt['created_at']) <= 3:" in fin)
    bad("日期判据无 str-str 残留",
        "-(pmt['created_at'][:10] if pmt['created_at'] else '')" not in fin)
    # 反向断言：不该动的没被动
    bad("_eff 的 0.005 保持原样（有意不动）",
        "live = [c for c in kids if abs(bal.get(c, 0.0)) > 0.005]" in fin)

    # 快照：必须都出现且各只一次（防重复插入把权益加两遍那类事故）
    n_pnl = count_occurrences(main, "pnl = _get_pnl_gl(month)")
    n_bs = count_occurrences(main, "bs = _get_bs_gl(_as_of)")
    bad("快照已用 GL 版 P&L（且只 1 次）", n_pnl == 1, "实际 %d 次" % n_pnl)
    bad("快照已用 GL 版资产负债表（且只 1 次）", n_bs == 1, "实际 %d 次" % n_bs)
    bad("快照不再调简化版（pnl = get_pnl() 归零）",
        count_occurrences(main, "    pnl = get_pnl()\n") == 0)
    bad("快照仍保留现金流量 get_cashflow()", "    cf = get_cashflow()\n" in main)

    imp = open(IMP, encoding="utf-8").read()
    bad("期初平衡校验已改用 money_balanced",
        "if not _mb(_dr_total, _cr_total):" in imp)
    bad("期初平衡校验无浮点容差残留",
        "abs(_dr_total - _cr_total) > 0.01" not in imp)

    # 语法
    for f in (FIN, MAIN, IMP):
        try:
            compile(open(f, encoding="utf-8").read(), f, "exec")
            log("  ✅ 语法 ok %s" % os.path.relpath(f, ERP))
        except SyntaxError as e:
            FAILS.append("语法错误 %s: %s" % (f, e))
            log("  🔴 语法错误 %s: %s" % (f, e))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--revert", action="store_true")
    ap.add_argument("--skip-verify", action="store_true")
    a = ap.parse_args()

    if a.revert:
        return revert()

    log("目标目录 %s" % ERP)
    for p in (FIN, MAIN, IMP):
        if not os.path.exists(p):
            log("🔴 缺文件 %s" % p)
            return 2

    log("\n【1/3】db/queries/finance.py（对账判等 + 日期）")
    patch_file(FIN, EDITS_FIN, a.dry_run)
    log("\n【2/3】erp_db.py（月度快照口径）")
    patch_file(MAIN, [(OLD_SNAP, NEW_SNAP, "save_monthly_snapshot 改 GL 口径")], a.dry_run)

    log("\n【3/3】import_zhoupu.py（期初平衡校验与报表同判据）")
    patch_file(IMP, IMPORT_EDITS, a.dry_run)

    if not a.dry_run and not a.skip_verify:
        verify()

    log("\n" + "=" * 78)
    if FAILS:
        log("失败 %d 项：" % len(FAILS))
        for f in FAILS:
            log("  🔴 " + f)
        return 1
    log("补丁完成，全部校验通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
