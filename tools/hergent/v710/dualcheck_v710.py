"""v710 双算：三处浮点容差判据换成整数分判据，改前逐对结论对比。

跑法（生产，只读）：
    cd /opt/hergent-erp && python3 /tmp/v710/dualcheck_v710.py

## 为什么必须双算

`abs(a-b) < 0.01` 在浮点下**同一个业务事实会给出相反结论**：
    1234.56 - 1234.55 = 0.010000000000047748  ⇒ 判"不相等"（拒）
    100.00  -  99.99  = 0.010000000000005116  ⇒ 判"不相等"（拒）
    但 2000.00 - 1999.99 = 0.009999999999999787 ⇒ 判"相等"（过）
即：差 1 分的两笔钱，**能不能配上取决于这两个数字的二进制表示**。
这是 v706 修 `money_balanced` 时同一个坑，只是换到了对账与科目树两个场景。

## 三处判据与它的正确写法

| 位置 | 老判据 | 新判据 | 语义 |
|---|---|---|---|
| `bank_import_parse` SQL | `ABS(cf.amount-?)<0.01` | `ROUND(cf.amount,2)=ROUND(?,2)` | 按分相等 |
| `bank_auto_match` | `abs(abs(a)-abs(b)) < 0.01` | `money_eq(abs(a), abs(b))` | 按分相等 |
| `get_balance_sheet_gl._eff` | `abs(bal) > 0.005` | `to_cents(bal) != 0` | 余额是否为 0 |

前两处是「两笔钱是否同一笔」⇒ 差 1 分**不该**算同一笔（那就是错配）。
第三处是「这个科目有没有余额」⇒ 半分法不是判据，0 分才是。
"""
import itertools
import os
import sqlite3
import sys

sys.path.insert(0, "/opt/hergent-erp")
from db.precision import money_balanced, money_eq, to_cents  # noqa: E402

ERP = "/opt/hergent-erp"
FAILS, PASSES = [], []


def chk(label, ok, detail=""):
    (PASSES if ok else FAILS).append(label)
    print(("  ✅ " if ok else "  🔴 ") + label + (("  " + detail) if detail else ""))


def old_match(a, b):
    """bank_auto_match / bank_import_parse 的老判据。"""
    return abs(abs(a) - abs(b)) < 0.01


def new_match(a, b):
    """改成整数分后的判据。"""
    return money_eq(abs(a), abs(b))


def old_nonzero(v):
    return abs(v) > 0.005


def new_nonzero(v):
    return to_cents(v) != 0


def db_files():
    out = []
    for fn in sorted(os.listdir(ERP)):
        if fn == "erp.db" or (fn.startswith("tenant_") and fn.endswith(".db")):
            # 排除历史归档 tenant_1.pre-v617-*.db（那是证据，只读也不比较）
            if ".pre-" in fn:
                continue
            out.append(fn)
    return out


def real_amounts(con):
    """生产里真实出现过的金额（对账对象）。"""
    vals = set()
    for sql in ("SELECT amount FROM cash_flow",
                "SELECT amount FROM receivables",
                "SELECT paid_amount FROM receivables",
                "SELECT current_balance FROM accounts",
                "SELECT total_amount FROM sale_orders",
                "SELECT total_amount FROM purchase_orders"):
        try:
            for (v,) in con.execute(sql):
                if v is not None:
                    vals.add(round(float(v), 2))
        except sqlite3.Error:
            continue
    return sorted(vals)


def phase_a_amount_pairs():
    print("\n【A】两笔金额是否「同一笔」：老判据 vs 整数分判据")
    total_pairs = disagree = 0
    samples = []
    # 只比「近邻」：判据分歧只可能发生在 |a-b| ≈ 1 分处，跨额配对没有信息量，
    # 而且全组合会 O(n²) 直接把进程撑死（实测 137 被杀）。
    deltas = [0.0, 0.01, -0.01, 0.02, -0.02, 1.00]
    for fn in db_files():
        con = sqlite3.connect("file:%s?mode=ro" % os.path.join(ERP, fn), uri=True)
        amounts = real_amounts(con)
        con.close()
        if not amounts:
            print("  %-14s 无金额数据，跳过" % fn)
            continue
        bad = 0
        for v in amounts:
            for d in deltas:
                a, b = v, round(v + d, 2)
                total_pairs += 1
                o, n = old_match(a, b), new_match(a, b)
                if o != n:
                    disagree += 1
                    bad += 1
                    if len(samples) < 6:
                        samples.append((fn, a, b, abs(a - b), o, n))
        print("  %-14s 金额 %3d 个 / 比较 %5d 次 / 结论相反 %d"
              % (fn, len(amounts), len(amounts) * len(deltas), bad))
    print("  合计比较 %d 次，结论相反 %d 次" % (total_pairs, disagree))
    for fn, a, b, d, o, n in samples:
        print("    %s  %.2f vs %.2f  差=%.18f  老=%s 新=%s" % (fn, a, b, d, o, n))

    # 反向可证伪：必须抓到「差 1 分被老判据判成相等」的实例，否则这组样本没有区分力
    witness = [(a, b) for a, b in itertools.combinations(
        [100.00, 99.99, 1234.56, 1234.55, 2000.00, 1999.99, 0.02, 0.01], 2)
        if old_match(a, b) != new_match(a, b)]
    chk("样本有区分力（存在老判据把差 1 分判成相等的实例）", len(witness) > 0,
        "实例 %d 个：%s" % (len(witness), witness[:3]))
    chk("新判据下「差 1 分」一定判不相等",
        all(not new_match(a, b) for a, b in
            [(100.00, 99.99), (1234.56, 1234.55), (2000.00, 1999.99)]),
        "")
    chk("新判据下「同额」一定判相等",
        all(new_match(a, a) for a in [0.0, 0.01, 100.00, 1234.56, 99999.99]), "")
    return disagree


def phase_b_nonzero():
    print("\n【B】科目余额是否为 0：老判据 0.005 vs 整数分")
    bad = 0
    total = 0
    samples = []
    for fn in db_files():
        con = sqlite3.connect("file:%s?mode=ro" % os.path.join(ERP, fn), uri=True)
        try:
            rows = con.execute(
                "SELECT account_code, COALESCE(SUM(debit)-SUM(credit),0) "
                "FROM journal_entries GROUP BY account_code").fetchall()
        except sqlite3.Error:
            rows = []
        con.close()
        if not rows:
            print("  %-14s 无凭证，跳过" % fn)
            continue
        for code, v in rows:
            total += 1
            if old_nonzero(v) != new_nonzero(v):
                bad += 1
                if len(samples) < 6:
                    samples.append((fn, code, v))
        print("  %-14s 科目 %3d 个，结论相反 %d" % (fn, len(rows), bad))
    print("  合计科目 %d，结论相反 %d" % (total, bad))
    for fn, code, v in samples:
        print("    %s %s 余额=%.18f" % (fn, code, v))
    # 这条 B 组不是为了改，而是为了**证明不该改**：
    # 生产 43 个科目零分歧 ⇒ 改成整数分在真实数据上收益为 0；
    # 而 0.005 处两者会分歧（老=零，新=1 分，因 round(0.005,2)=0.01）⇒ 有语义变化无收益。
    # 结论：`_eff` 的 0.005 保持原样，只在文档里说明它是「是否为零」阈值、不是「两笔钱是否相等」判据。
    chk("生产真实余额上新旧判据零分歧（故该处不动）", bad == 0, "分歧 %d 个" % bad)
    chk("0.005 处二者分歧（这正是选择不动它的原因）",
        old_nonzero(0.005) != new_nonzero(0.005),
        "老=%s 新=%s" % (old_nonzero(0.005), new_nonzero(0.005)))
    return bad


def main():
    pa = phase_a_amount_pairs()
    pb = phase_b_nonzero()
    print("\n" + "=" * 78)
    print("A 组结论相反的金额组合 %d 对，B 组结论相反的科目余额 %d 个" % (pa, pb))
    print("通过 %d 项，失败 %d 项" % (len(PASSES), len(FAILS)))
    for f in FAILS:
        print("  🔴 " + f)
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
