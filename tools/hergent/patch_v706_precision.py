#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v706「修」：把 `money_balanced` 的浮点判据换成整数分判据。

## 改的是什么（一句话）

    - abs(float(dr) - float(cr)) <= 0.01          # 浮点：看二进制表示
    + abs(to_cents(dr) - to_cents(cr)) <= 1       # 整数分：确定性

## 为什么这不是"顺手优化"而是业务口径变更

修好之后，一部分**过去被拒**的过账会开始成功：

    100.00 - 99.99    = 0.010000000000005116  ⇒ 老判据拒单
    1234.56 - 1234.55 = 0.010000000000000009  ⇒ 老判据放行

同样是"差 1 分"，一个拒一个过 —— 结论取决于浮点表示，而不是会计口径。
所以这一版**先双算再改**：`tools/hergent/v706/dualcheck_money_balanced.py` 实测
生产 29 张凭证（erp.db 6 / tenant_1 23 / tenant_10 0），老新判据**逐张一致、零翻案**。
换言之，这次改动只影响今后「恰好差 1 分」的新过账。

## 影响面

全仓只有 `db/queries/gl.py::gl_post()` 一处调用 `money_balanced`。
`db/queries/finance.py:102` 的 `abs(...) < 0.01`（严格小于）**刻意不动**：那是
资产负债表「是否平衡」的展示判断，严格性与 gl_post 不同，统一它属于另一件事。

用法：
    python3 patch_v706_precision.py --root=/opt/hergent-erp [--dry-run] [--revert]
"""
import argparse
import py_compile
import re
import shutil
import sys
from datetime import datetime
from pathlib import Path

DEFAULT_ROOT = Path("/opt/hergent-erp")

OLD_CONSTS = '''# 金额比较容差：1 分。两笔钱差不到 1 分，业务上就是"相等"
MONEY_EPS = 0.01
# 数量比较容差：浮点累加后的最后一位噪声量级
QTY_EPS = 1e-6

__all__ = ["MONEY_DECIMALS", "MONEY_EPS", "QTY_EPS",
           "round_money", "to_cents", "money_eq", "money_balanced", "qty_eq"]'''

NEW_CONSTS = '''# 金额比较容差：1 分。两笔钱差不到 1 分，业务上就是"相等"
MONEY_EPS = 0.01
# 同一容差的**整数分**表达（v706 起 `money_balanced` 用它做判定）：
# 整数比较不存在浮点表示问题，`abs(0.010000000000005116) > 0.01` 这类判据不再出现。
MONEY_EPS_CENTS = 1
# 数量比较容差：浮点累加后的最后一位噪声量级
QTY_EPS = 1e-6

__all__ = ["MONEY_DECIMALS", "MONEY_EPS", "MONEY_EPS_CENTS", "QTY_EPS",
           "round_money", "to_cents", "money_eq", "money_balanced", "qty_eq"]'''

OLD_HEAD_LINE = '"""借方合计与贷方合计是否平衡（容差 MONEY_EPS）。'
NEW_HEAD_LINE = '"""借方合计与贷方合计是否平衡（容差 **1 分**，按整数分判定）。'

OLD_RETURN = "return abs(float(dr or 0) - float(cr or 0)) <= MONEY_EPS"
NEW_RETURN = "return abs(to_cents(dr) - to_cents(cr)) <= MONEY_EPS_CENTS"

# 老 docstring 中间那段「刻意保留缺陷」的说明，整块换掉（用首尾标记定位，不用逐字抄）
OLD_PARA = re.compile(r"    🔴 判据与 `db/queries/gl\.py::gl_post\(\)` 的历史写法.*?"
                      r"不该混在一版\"只加常量\"的改动里。\n", re.S)

NEW_PARA = '''    ## 判据

        abs(to_cents(dr) - to_cents(cr)) <= MONEY_EPS_CENTS     # = 1

    老写法是 `abs(dr - cr) <= 0.01`。浮点下「差 1 分」的结论取决于二进制表示，
    **同样的业务事实会得出相反结论**：

        100.00 - 99.99    = 0.010000000000005116  ⇒ 老判据**不平**（拒单）
        1234.56 - 1234.55 = 0.010000000000000009  ⇒ 老判据**平**（过账）

    v706 改成按整数分比较。存量影响已双算核实（2026-10-27）：
    `erp.db` 6 张凭证 / `tenant_1.db` 23 张 / `tenant_10.db` 0 张，
    老新判据**逐张一致、零翻案** —— 本次只影响今后「恰好差 1 分」的新过账。

    ⚠️ 边界：判据比的是「按分规整之后」的差。输入若有第三位小数（如 `2.675`），
    规整后只差 1 分 ⇒ 判平。这不是缺陷：金额最小单位就是分，三分位金额本身是非法输入
    （全库写入都经 `round_money()`）；老判据在那里的"不平"是拿浮点噪声当业务规则。
'''


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=str(DEFAULT_ROOT))
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--revert", action="store_true")
    a = ap.parse_args()
    root = Path(a.root)
    p = root / "db" / "precision.py"
    if not p.exists():
        print("找不到 %s" % p, file=sys.stderr)
        return 1

    bak = p.with_suffix(".py.bak-v706")

    if a.revert:
        if not bak.exists():
            print("没有备份可回滚：%s" % bak, file=sys.stderr)
            return 1
        shutil.copy2(bak, p)
        print("已回滚 db/precision.py ← %s（记得重启服务）" % bak.name)
        return 0

    src = p.read_text(encoding="utf-8")
    if "MONEY_EPS_CENTS" in src and NEW_RETURN in src:
        print("⏭  db/precision.py 已打过（幂等跳过）")
        return 0

    steps = []
    # ① 常量与 __all__
    n = src.count(OLD_CONSTS)
    if n != 1:
        print("❌ 常量块锚点命中 %d 次（应为 1），不做任何改动" % n, file=sys.stderr)
        return 2
    src = src.replace(OLD_CONSTS, NEW_CONSTS)
    steps.append("常量：新增 MONEY_EPS_CENTS 并登记 __all__")

    # ② docstring 首行
    n = src.count(OLD_HEAD_LINE)
    if n != 1:
        print("❌ docstring 首行锚点命中 %d 次" % n, file=sys.stderr)
        return 2
    src = src.replace(OLD_HEAD_LINE, NEW_HEAD_LINE)
    steps.append("docstring 首行")

    # ③ 中间那段"刻意保留缺陷"的说明
    src, k = OLD_PARA.subn(NEW_PARA, src)
    if k != 1:
        print("❌ 说明段落匹配 %d 次（应为 1）" % k, file=sys.stderr)
        return 2
    steps.append("说明段落改写（含双算证据）")

    # ④ 判据本体
    n = src.count(OLD_RETURN)
    if n != 1:
        print("❌ 判据行锚点命中 %d 次" % n, file=sys.stderr)
        return 2
    src = src.replace(OLD_RETURN, NEW_RETURN)
    steps.append("判据：浮点 → 整数分")

    if a.dry_run:
        for s in steps:
            print("🔍 将执行：%s" % s)
        print("（dry-run 未写入）")
        return 0

    if not bak.exists():
        shutil.copy2(p, bak)
        print("   备份 %s" % bak.name)
    p.write_text(src, encoding="utf-8")
    try:
        py_compile.compile(str(p), doraise=True)
    except py_compile.PyCompileError as e:
        shutil.copy2(bak, p)
        print("❌ 语法检查失败，已回滚：%s" % e, file=sys.stderr)
        return 2
    for s in steps:
        print("✅ %s" % s)
    print("\n完成。重启服务后生效：systemctl restart hergent-erp")
    print("时间：%s" % datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
