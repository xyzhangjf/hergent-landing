#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v713 资产负债表(权责) 补明细字段（后端加法，不改前端产物）。

## 问题

`/opt/static`（erp.hergent.cn，唯一消费报表接口的前端）里「资产负债表(权责)」
面板读的是：

    h.cash / h.ar / h.inventory / h.fixed_assets_net      （h = g.assets）
    w.ap                                                  （w = g.liabilities）
    k.paid_in_capital / k.retained                        （k = g.equity）

而 `get_balance_sheet_gl()` 只返回三个 `{"total": x}`。这些字段**从来没存在过**：
老 `get_balance_sheet()` 返回的是**顶层** `cash/ar/inventory_val/ap`，而且取自
`receivables`/`accounts`/`inventory` 业务表，不是 GL —— 前端从未对上过一次。

后果：合计是真数，7 行明细永远 `¥0.00`。比不显示更误导（老板会以为账户没钱、
没有库存）。

## 修法

在 `get_balance_sheet_gl()` 里按科目编码前缀补明细，仍走 v708 的「叶子有效」，
不重复计父子。**纯加法**：`total` / `balanced` / `unclosed_profit` 一律不动。

映射口径（生产 COA 实测）：
    现金及存款   = 10*（库存现金/银行存款/微信/支付宝/个人户）
    应收账款     = 1122
    库存商品     = 1405 + 1406（两套编码都叫「库存商品」，实账都有余额）
    固定资产净值 = 1601 + 1602（固定资产 - 累计折旧）
    应付账款     = 2202（贷方余额取正）
    实收资本     = 4001（贷方余额取正）
    留存收益     = 4103 本年利润 + 4104 利润分配 + unclosed_profit（未结转损益）
另给每组一个 `other`（合计 - 已列明细），让前端将来能显示「其他」，也便于
自证「明细之和 + other == 合计」。

## 纪律
- 目录可用 `ERP_DIR` 覆盖；`--dry-run` / `--revert`。
- 幂等：先判新串已在位，再看锚点唯一；锚点不是 1 次就失败。
- 改完回读校验 + 语法检查。
"""

import argparse
import ast
import os
import shutil
import sys

ROOT = os.environ.get("ERP_DIR", "/opt/hergent-erp")
TARGET = os.path.join(ROOT, "db/queries/finance.py")

ANCHOR = '        balanced = money_balanced(total_assets, total_liabilities + total_equity)'

BLOCK = '''        # v713：给前端「资产负债表(权责)」补明细行。
        # 此前这里只返回三个 total，而前端读的是 assets.cash / assets.ar /
        # assets.inventory / assets.fixed_assets_net、liabilities.ap、
        # equity.paid_in_capital / equity.retained —— 这些字段**从来没存在过**
        # （老 get_balance_sheet() 返回的是顶层 cash/ar/inventory_val/ap，且取自
        # receivables/accounts/inventory 业务表）。界面上 7 行明细永远 ¥0.00，
        # 只有合计对，比空着更误导。
        def prefix_balance(*prefixes):
            """按科目编码前缀取余额，仍走「叶子有效」，不重复计父子。"""
            tot = 0.0
            for p in prefixes:
                sub = {c for c in _all_codes if c.startswith(p)}
                if not sub:
                    continue
                tops = [c for c in sub
                        if not any(c != x and c.startswith(x) for x in sub)]
                tot += sum(_eff(c, sub) for c in tops)
            return tot

        _cash = prefix_balance("10")                 # 库存现金/银行存款/微信/支付宝
        _ar = prefix_balance("1122")                 # 应收账款
        _inv = prefix_balance("1405", "1406")        # 库存商品（两套编码同名）
        _fa_net = prefix_balance("1601", "1602")     # 固定资产 - 累计折旧
        _ap = -prefix_balance("2202")                # 应付账款（贷方为正）
        _paid_in = -prefix_balance("4001")           # 实收资本
        _retained = (-prefix_balance("4103", "4104")  # 本年利润 + 利润分配
                     + unclosed_profit)               # 尚未结转的当期损益

'''

OLD_RET = '''        return {
            "as_of": as_of, "basis": "accrual",
            "assets": {"total": round(total_assets, 2)},
            "liabilities": {"total": round(total_liabilities, 2)},
            "equity": {"total": round(total_equity, 2)},
            "unclosed_profit": round(unclosed_profit, 2),
            "balanced": balanced
        }'''

NEW_RET = '''        return {
            "as_of": as_of, "basis": "accrual",
            "assets": {
                "total": round(total_assets, 2),
                "cash": round(_cash, 2),
                "ar": round(_ar, 2),
                "inventory": round(_inv, 2),
                "fixed_assets_net": round(_fa_net, 2),
                "other": round(total_assets - _cash - _ar - _inv - _fa_net, 2),
            },
            "liabilities": {
                "total": round(total_liabilities, 2),
                "ap": round(_ap, 2),
                "other": round(total_liabilities - _ap, 2),
            },
            "equity": {
                "total": round(total_equity, 2),
                "paid_in_capital": round(_paid_in, 2),
                "retained": round(_retained, 2),
                "other": round(total_equity - _paid_in - _retained, 2),
            },
            "unclosed_profit": round(unclosed_profit, 2),
            "balanced": balanced
        }'''

MARK = '_retained = (-prefix_balance("4103", "4104")'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--revert", action="store_true")
    ap.add_argument("--skip-verify", action="store_true")
    a = ap.parse_args()

    if not os.path.exists(TARGET):
        print("🔴 找不到 %s" % TARGET)
        return 2
    text = open(TARGET, encoding="utf-8").read()

    if a.revert:
        if MARK not in text:
            print("⏭  未打补丁，无需回滚")
            return 0
        norm = text.replace(NEW_RET, OLD_RET)
        if norm == text:
            print("🔴 回滚锚点不匹配：明细返回体与预期不一致，拒绝改动")
            return 4
        start = norm.index("        # v713：给前端「资产负债表(权责)」补明细行。")
        end = norm.index("        balanced = money_balanced(", start)
        norm = norm[:start] + norm[end:]
        if a.dry_run:
            print("[dry-run] 将回滚（%d 字节）" % len(text))
            return 0
        _write(TARGET, norm)
        print("✅ 已回滚")
        # 🔴 回滚后要用「旧形态」的判据自检；拿新形态判据去查必然全红（v713 踩过）
        return _verify_reverted()

    if MARK in text:
        print("⏭  明细字段已存在（幂等跳过）")
        return 0

    n_anchor = text.count(ANCHOR)
    n_ret = text.count(OLD_RET)
    if n_anchor != 1 or n_ret != 1:
        print("🔴 锚点不唯一：balanced 行 %d 次、旧 return %d 次（都要恰好 1）"
              % (n_anchor, n_ret))
        return 3

    new = text.replace(ANCHOR, BLOCK + ANCHOR, 1).replace(OLD_RET, NEW_RET, 1)

    if a.dry_run:
        print("[dry-run] 将插入 %d 字节明细块 + 替换 return；两个锚点各命中 1 次"
              % len(BLOCK))
        return 0

    try:
        ast.parse(new)
    except SyntaxError as e:
        print("🔴 改后语法错误，拒绝写入：%s" % e)
        return 5

    bak = TARGET + ".bak-v713"
    shutil.copy2(TARGET, bak)
    _write(TARGET, new)
    print("✏️  已补明细字段；备份 %s" % bak)

    if a.skip_verify:
        return 0
    return _verify(skip_verify=False)


def _write(path, text):
    tmp = path + ".tmp-v713"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, path)


def _verify_reverted():
    text = open(TARGET, encoding="utf-8").read()
    bad = []
    if MARK in text or "_cash = prefix_balance" in text:
        bad.append("明细块仍然残留")
    if text.count(OLD_RET) != 1:
        bad.append("旧 return 体未复原（%d 次）" % text.count(OLD_RET))
    if bad:
        print("🔴 回滚自检失败：")
        for b in bad:
            print("     - " + b)
        return 4
    print("✅ 回滚自检通过（明细块已清、旧 return 体复原）")
    return 0


def _verify(skip_verify=False):
    text = open(TARGET, encoding="utf-8").read()
    bad = []
    if text.count(MARK) != 1:
        bad.append("明细块出现 %d 次（应为 1）" % text.count(MARK))
    for k in ('"cash": round(_cash, 2)', '"ap": round(_ap, 2)',
              '"paid_in_capital": round(_paid_in, 2)',
              '"retained": round(_retained, 2)'):
        if text.count(k) != 1:
            bad.append("字段缺失或重复：%s（%d 次）" % (k, text.count(k)))
    # 原有语义必须逐字不变
    for k in ('"total": round(total_assets, 2)',
              '"total": round(total_liabilities, 2)',
              '"total": round(total_equity, 2)',
              'balanced = money_balanced(total_assets, total_liabilities + total_equity)'):
        if text.count(k) != 1:
            bad.append("原口径被改动：%s" % k)
    if bad:
        print("🔴 回读校验失败：")
        for b in bad:
            print("     - " + b)
        return 4
    print("✅ 回读校验通过（4 组明细在位、3 个 total 与 balanced 判据逐字未动）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
