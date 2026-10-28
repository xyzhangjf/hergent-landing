#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v714 利润表口径统一：GL 分类覆盖 + 叶子去重 + 净额方向 + 按月回落。

## 改前实测（生产 tenant_1）

`/api/reports/pnl?month=2026-10`、`?month=2026-06`、不带 month —— **三次返回同一组数**
（营业收入 8,786,105.85）。而 2026-10 的 `sale_orders` 里 `signed` **一笔都没有**
（销售只到 2026-09）⇒ 老板在「利润表(权责)」下拉里选 10 月，看到的是全期累计。

根因不是「GL 没数据所以回落」，比那具体：

1. `get_pnl_gl` 用 `get_account_codes_by_category("收入"/"成本"/"费用")` 取科目，
   但本账套 109 个损益科目的 `category` 是 **`损益`**，唯一有发生额的 `6001`
   就在里面 ⇒ `revenue`/`cogs`/`total_expense` **恒为 0**
   ⇒ 路由的 `if revenue>0 or net_profit!=0` 永不成立 ⇒ GL 分支**永远走不到**。
2. `category='成本'` 里混着 5 个 **5 开头**的存货归集科目（5001 生产成本、
   5101 制造费用、5201 劳务成本、5301 研发支出、5401 工程施工）—— 这些是资产性质，
   一旦有余额会被算成「营业成本」。
3. 父子科目一起加（与 v708 资产负债表同一个缺陷）；且收入只取 `credit`、
   成本只取 `debit` ⇒ 红冲/退货/冲销全丢。
4. `net_profit` 里有一项 `+ (cat_sum(rev_codes,"credit") - revenue)` —— 而
   `revenue` 就是 `cat_sum(rev_codes,"credit")`，这一项**恒为 0**，是死逻辑。
5. 路由回落的是 `db.get_pnl()`（**全期累计**现金制），前端下拉选月份时无从得知。

## 改后口径

损益全集 = `code LIKE '6%'`（另收 `category IN ('收入','成本','费用','损益')` 补漏，
异形科目进 `unclassified` 上报，不静默）：

| 组 | 科目 | 方向 |
|---|---|---|
| revenue | `60*` / `61*` / `63*`（主营/其他业务收入、投资收益、营业外收入） | credit − debit |
| cogs | `6401*`（主营业务成本） | debit − credit |
| total_expense | 其余 6 开头（`6402*` 客户费用、`6405` 税金及附加、`6411`/`6421`、`66*`、`67`/`68`/`69`） | debit − credit |

`6402 其他业务成本` 在生产账套下挂的是「客户费用/月返/陈列费/配送费」—— 实务上是费用，
所以只把 `6401` 当销货成本，否则毛利会被客户费用吃掉、失去意义。

**可跨表勾稽的判据**（比"看起来对"强）：
    sum(get_pnl_gl(逐月).net_profit) == get_balance_sheet_gl().unclosed_profit
（符号同号：`unclosed_profit = -sum(debit-credit)`，收入类 debit-credit 为负。
生产实测两边都是 +98,325.00 ✓）

## 按月回落

带 `month` 且该月**没有任何损益凭证** ⇒ 回落 `db.get_pnl(month)`（该月业务单据），
并在响应里标 `basis="cash"` / `source="fallback_business_docs"`。
`db.get_pnl()` 新增可选 `month`；**不带 month 时 SQL 与返回体逐字不变**
（仪表盘 KPI、`/reports/daily`、月度快照都走这条，不能动）。

## 纪律
- 目录 `ERP_DIR` 覆盖；`--dry-run` / `--revert`。
- 幂等：先判新串在位，再看锚点唯一；函数体按行边界切片替换。
- 改后 ast 语法检查 + 回读校验。
"""

import argparse
import ast
import os
import shutil
import sys

ROOT = os.environ.get("ERP_DIR", "/opt/hergent-erp")
FIN = os.path.join(ROOT, "db/queries/finance.py")
RPT = os.path.join(ROOT, "routers/reports.py")

# ---- 幂等标记 ----
MARK_PNL = 'def get_pnl(month=""):'
MARK_GL = '# v714：损益类科目全集只认「6 开头」'
MARK_RPT = '# v714：该月没有损益凭证 ⇒ 用该月业务单据估算，并把口径标出来'
OLD_SIG_PNL = 'def get_pnl():'
GL_START = 'def get_pnl_gl(month=""):'
GL_END = 'def get_balance_sheet_gl(as_of=""):'
BS_START = 'def get_balance_sheet():'

# ============================================================ get_pnl
NEW_PNL = '''def get_pnl(month=""):
    """简化损益（现金制 + 业务单据）。

    v714：新增可选 `month`。**不带 month 时 SQL 与返回体与改前逐字一致**
    （仪表盘 KPI、`/reports/daily`、月度快照都依赖全期累计，不能动）。

    改前的问题：`routers/reports.py` 的 `/reports/pnl?month=` 在 GL 无数据时
    回落本函数，而本函数**不认月份** ⇒ 前端选任何月份看到的都是全期累计
    （2026-10 实际一笔销售都没签收，界面却显示 878 万）。
    """
    with get_db() as db:
        if month:
            m = month + "%"
            income = db.execute(
                "SELECT COALESCE(SUM(amount),0) FROM cash_flow WHERE type='income' AND created_at LIKE ?",
                (m,)).fetchone()[0]
            expense = db.execute(
                "SELECT COALESCE(SUM(amount),0) FROM cash_flow WHERE type='expense' AND created_at LIKE ?",
                (m,)).fetchone()[0]
            sales = db.execute(
                "SELECT COALESCE(SUM(total_amount),0) FROM sale_orders "
                "WHERE status IN ('delivered','signed') AND order_date LIKE ?",
                (m,)).fetchone()[0]
            purchases = db.execute(
                "SELECT COALESCE(SUM(total_amount),0) FROM purchase_orders "
                "WHERE status='received' AND order_date LIKE ?",
                (m,)).fetchone()[0]
        else:
            income = db.execute("SELECT COALESCE(SUM(amount),0) FROM cash_flow WHERE type='income'").fetchone()[0]
            expense = db.execute("SELECT COALESCE(SUM(amount),0) FROM cash_flow WHERE type='expense'").fetchone()[0]
            sales = db.execute("SELECT COALESCE(SUM(total_amount),0) FROM sale_orders WHERE status IN ('delivered','signed')").fetchone()[0]
            purchases = db.execute("SELECT COALESCE(SUM(total_amount),0) FROM purchase_orders WHERE status='received'").fetchone()[0]
        return {'total_income':sales+income,'total_expense':purchases+expense,'sales':sales,'purchases':purchases,'other_income':income,'other_expense':expense,'net_profit':sales+income-purchases-expense}


'''

# ============================================================ get_pnl_gl
NEW_GL = '''# v714：损益类科目全集只认「6 开头」——`category='成本'` 里混着 5 个 **5 开头**的
# 存货归集科目（5001 生产成本 / 5101 制造费用 / 5201 劳务成本 / 5301 研发支出 /
# 5401 工程施工），它们是资产性质，有余额时会被算成「营业成本」。
# 🔴 补漏条件只能是 `category='损益'`，**不能**写 `category IN ('收入','成本','费用')`：
# 那正是改前的老写法，会把 5 开头整笔收进来（A4 实测 total_expense 从 200 变 10199）。
# 补进来的非 6 开头科目会进 `unclassified` 上报，不静默吞掉。
_LOSS_ACC_WHERE = "(code LIKE '6%' OR category='损益')"
_REV_PREFIX2 = ("60", "61", "63")   # 主营/其他业务收入、投资收益、营业外收入
_COGS_PREFIX = "6401"               # 主营业务成本（6402 是客户费用，归费用）


def get_pnl_gl(month=""):
    """P&L from journal_entries (accrual basis).

    v714：口径定死为「6 开头损益类科目的期间净额」，三类分解
    （收入 / 销货成本 / 费用），并按 v708「叶子有效」去重。

    改前三处硬伤：
      ① 科目取 `category IN ('收入','成本','费用')`，而生产账套 109 个损益科目
         `category` 是 `损益`、唯一有数的 `6001` 就在里面 ⇒ 三项**恒为 0**
         ⇒ `/reports/pnl?month=` 的 GL 分支**永远走不到**。
      ② 父子科目一起加（同 v708 资产负债表），收入只取 credit、成本只取 debit
         ⇒ 红冲/退货全丢。
      ③ `net_profit` 里的 `(cat_sum(rev,'credit') - revenue)` 恒为 0，死逻辑。

    `net_profit` 恒等于「全部 6 开头净额之和」，可跨表勾稽（同号）：
        sum(get_pnl_gl(逐月).net_profit) == get_balance_sheet_gl().unclosed_profit
    """
    if not month:
        month = datetime.now().strftime("%Y-%m")
    with get_db() as db:
        codes = set()
        cats = {}
        for r in db.execute(
                "SELECT code, category FROM chart_of_accounts WHERE is_active=1 AND "
                + _LOSS_ACC_WHERE):
            codes.add(r[0])
            cats[r[0]] = r[1]
        if not codes:
            return {"month": month, "basis": "accrual", "source": "gl",
                    "revenue": 0, "cogs": 0, "gross_profit": 0,
                    "total_expense": 0, "net_profit": 0,
                    "has_data": False, "unclassified": []}
        cl = sorted(codes)
        ph = ",".join("?" * len(cl))
        bal = {}
        for code, dsum, csum in db.execute(
                "SELECT account_code, COALESCE(SUM(debit),0), COALESCE(SUM(credit),0) "
                "FROM journal_entries WHERE substr(date,1,7)=? AND account_code IN (" + ph + ") "
                "GROUP BY account_code", [month] + cl):
            bal[code] = (dsum or 0.0, csum or 0.0)

    def _net(code, is_revenue):
        """净额：收入类 credit-debit；成本费用类 debit-credit（红冲才对得上）。"""
        d, c = bal.get(code, (0.0, 0.0))
        return (c - d) if is_revenue else (d - c)

    def _eff(code, universe, is_revenue, depth=0):
        """叶子有效：该期有非零发生额的子科目 ⇒ 只累加子；否则用自己。"""
        if depth > 8:
            return _net(code, is_revenue)
        kids = [x for x in universe if x != code and x.startswith(code)]
        if not kids:
            return _net(code, is_revenue)
        live = [x for x in kids if x in bal and abs(_net(x, is_revenue)) > 0.005]
        if not live:
            return _net(code, is_revenue)   # 子科目全零 ⇒ 发生额记在父科目上
        return sum(_eff(x, universe, is_revenue, depth + 1) for x in live)

    def _group(universe, is_revenue):
        if not universe:
            return 0.0
        tops = [c for c in universe
                if not any(c != x and c.startswith(x) for x in universe)]
        return sum(_eff(c, universe, is_revenue) for c in tops)

    rev_codes = {c for c in codes if c[:2] in _REV_PREFIX2}
    cogs_codes = {c for c in codes if c.startswith(_COGS_PREFIX)}
    exp_codes = codes - rev_codes - cogs_codes

    revenue = _group(rev_codes, True)
    cost = _group(cogs_codes, False)
    total_exp = _group(exp_codes, False)

    # 补漏进来的异形科目（正常应为空）：已计入费用，但要让口径漂移可见
    unclassified = sorted(c for c in codes if not c.startswith("6"))
    tick = sum((c - d) for d, c in bal.values())   # 全集净额（贷-借）

    return {
        "month": month, "basis": "accrual", "source": "gl",
        "revenue": round(revenue, 2),
        "cogs": round(cost, 2),
        "gross_profit": round(revenue - cost, 2),
        "total_expense": round(total_exp, 2),
        "net_profit": round(revenue - cost - total_exp, 2),
        # `raw_net` = 全集原始净额（贷−借），**不分父子**，与资产负债表
        # `unclosed_profit`（同样直接 SUM 全部 6 开头）同口径 ⇒ 可跨表勾稽。
        # 存在父子双记时 `raw_net > net_profit`，差值正是被叶子有效剔掉的父科目 ——
        # 这不是 bug，是"去重真的发生了"的证据（隔离库 A8b 用人造父子验证）。
        "raw_net": round(tick, 2),
        "has_data": bool(bal),
        "unclassified": unclassified,
    }


'''

# ============================================================ 路由
# 注：首行必须带 4 空格缩进。曾写成无缩进 ⇒ `rpt.find(...)` 命中位置含缩进、
# 拼回去时把缩进吃掉 ⇒ 回滚后 `if month:` 顶格（4 行差异）。替换用 replace 时
# 无缩进也"能过"，因为前缀空格留在原地 —— 于是这个 bug 只在回滚路径暴露。
OLD_ROUTE = '''    if month:
        from db.queries.finance import get_pnl_gl
        gl = get_pnl_gl(month)
        if gl and (gl.get("revenue", 0) > 0 or gl.get("net_profit", 0) != 0):
            return gl
    return db.get_pnl()'''

NEW_ROUTE = '''    if month:
        from db.queries.finance import get_pnl_gl
        gl = get_pnl_gl(month)
        # v714：判据从「有收入或有净利」改成「该月有没有损益凭证」。
        # 旧判据在「有凭证但净额正好为 0」时会误回落现金制；更重要的是
        # `get_pnl_gl` 改前恒返回 0（科目分类对不上）⇒ 这个分支从没走到过。
        if gl.get("has_data"):
            return gl
        # v714：该月没有损益凭证 ⇒ 用该月业务单据估算，并把口径标出来。
        # 改前回落 `db.get_pnl()`（全期累计、不认月份）⇒ 前端下拉选 2026-10
        # 看到的是全期 878 万营收，而 10 月实际一笔销售都没签收 —— 累计冒充当月。
        cash = db.get_pnl(month)
        cash["basis"] = "cash"
        cash["source"] = "fallback_business_docs"
        cash["month"] = month
        cash["note"] = "该月无损益凭证，按业务单据（收付实现）估算"
        return cash
    return db.get_pnl()'''


def _slice(text, start_mark, end_mark, what):
    """按行边界取 [start, end) 片段。返回 (片段, 起始下标, 结束下标) 或 None。"""
    i = text.find(start_mark)
    if i < 0:
        return None
    j = text.find(end_mark, i + len(start_mark))
    if j < 0:
        return None
    return text[i:j], i, j


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--dry-run", action="store_true")
    a.add_argument("--revert", action="store_true")
    a.add_argument("--skip-verify", action="store_true")
    args = a.parse_args()

    for p in (FIN, RPT):
        if not os.path.exists(p):
            print("🔴 找不到 %s" % p)
            return 2
    fin = open(FIN, encoding="utf-8").read()
    rpt = open(RPT, encoding="utf-8").read()

    # ---------- 回滚 ----------
    if args.revert:
        bad = []
        if MARK_GL in fin or MARK_PNL in fin:
            head = fin[fin.find(MARK_GL):] if MARK_GL in fin else fin
            old_pnl = ('def get_pnl():\n'
                       '    with get_db() as db:\n'
                       "        income = db.execute(\"SELECT COALESCE(SUM(amount),0) FROM cash_flow WHERE type='income'\").fetchone()[0]\n"
                       "        expense = db.execute(\"SELECT COALESCE(SUM(amount),0) FROM cash_flow WHERE type='expense'\").fetchone()[0]\n"
                       "        sales = db.execute(\"SELECT COALESCE(SUM(total_amount),0) FROM sale_orders WHERE status IN ('delivered','signed')\").fetchone()[0]\n"
                       "        purchases = db.execute(\"SELECT COALESCE(SUM(total_amount),0) FROM purchase_orders WHERE status='received'\").fetchone()[0]\n"
                       "        return {'total_income':sales+income,'total_expense':purchases+expense,'sales':sales,'purchases':purchases,'other_income':income,'other_expense':expense,'net_profit':sales+income-purchases-expense}\n"
                       '\n\n')
            old_gl = ('def get_pnl_gl(month=""):\n'
                      '    """P&L from journal_entries (accrual basis). Uses COA categories for account selection."""\n'
                      '    if not month:\n'
                      '        month = datetime.now().strftime("%Y-%m")\n'
                      '    from erp_db import get_account_codes_by_category\n'
                      '    with get_db() as db:\n'
                      '        def cat_sum(codes, field):\n'
                      '            """Sum the given field (debit or credit) for a list of account codes in the month."""\n'
                      '            if not codes:\n'
                      '                return 0\n'
                      '            placeholders = ",".join("?" * len(codes))\n'
                      '            r = db.execute(\n'
                      '                f"SELECT COALESCE(SUM({field}),0) FROM journal_entries "\n'
                      '                f"WHERE account_code IN ({placeholders}) AND substr(date,1,7)=?",\n'
                      '                codes + [month]\n'
                      '            ).fetchone()\n'
                      '            return r[0] if r else 0\n'
                      '\n'
                      '        rev_codes = get_account_codes_by_category("收入")\n'
                      '        cost_codes = get_account_codes_by_category("成本")\n'
                      '        exp_codes = get_account_codes_by_category("费用")\n'
                      '\n'
                      '        revenue = cat_sum(rev_codes, "credit")\n'
                      '        cost = cat_sum(cost_codes, "debit")\n'
                      '        total_exp = cat_sum(exp_codes, "debit")\n'
                      '        gross_profit = revenue - cost\n'
                      '        net_profit = gross_profit + (cat_sum(rev_codes, "credit") - revenue) - total_exp  # other rev = excess credit\n'
                      '\n'
                      '        return {\n'
                      '            "month": month, "basis": "accrual",\n'
                      '            "revenue": revenue, "cogs": cost, "gross_profit": gross_profit,\n'
                      '            "total_expense": total_exp, "net_profit": net_profit\n'
                      '        }\n'
                      '\n\n')
            # 用切片把两个函数换回原文
            seg = _slice(fin, MARK_GL, GL_END, "gl")
            if seg:
                fin = fin[:seg[1]] + old_gl + fin[seg[2]:]
            else:
                bad.append("找不到新 gl 块的结束锚点")
            seg2 = _slice(fin, MARK_PNL, BS_START, "pnl")
            if seg2:
                fin = fin[:seg2[1]] + old_pnl + fin[seg2[2]:]
            else:
                bad.append("找不到新 pnl 函数的结束锚点")
        if MARK_RPT in rpt:
            i = rpt.find('    if month:\n        from db.queries.finance import get_pnl_gl')
            j = rpt.find("    return db.get_pnl()", i)
            if i >= 0 and j >= 0:
                rpt = rpt[:i] + OLD_ROUTE + rpt[j + len("    return db.get_pnl()"):]
            else:
                bad.append("路由回滚锚点不匹配")
        if bad:
            print("🔴 回滚失败：")
            for b in bad:
                print("     - " + b)
            return 4
        if args.dry_run:
            print("[dry-run] 将回滚 finance.py + reports.py")
            return 0
        _write(FIN, fin)
        _write(RPT, rpt)
        print("✅ 已回滚")
        return _verify_reverted()

    # ---------- 应用（幂等） ----------
    done_fin = MARK_PNL in fin and MARK_GL in fin
    done_rpt = MARK_RPT in rpt
    if done_fin and done_rpt:
        print("⏭  已是 v714 口径（幂等跳过）")
        return 0
    if done_fin != done_rpt:
        print("🔴 半应用状态：finance.py=%s reports.py=%s，需人工确认" % (done_fin, done_rpt))
        return 6

    problems = []
    if fin.count(OLD_SIG_PNL) != 1:
        problems.append("旧 `def get_pnl():` 出现 %d 次（应 1）" % fin.count(OLD_SIG_PNL))
    if fin.count(GL_START) != 1:
        problems.append("`def get_pnl_gl` 出现 %d 次（应 1）" % fin.count(GL_START))
    if fin.count(GL_END) != 1:
        problems.append("`def get_balance_sheet_gl` 出现 %d 次（应 1）" % fin.count(GL_END))
    if fin.count(BS_START) != 1:
        problems.append("`def get_balance_sheet` 出现 %d 次（应 1）" % fin.count(BS_START))
    if rpt.count(OLD_ROUTE) != 1:
        problems.append("路由旧片段出现 %d 次（应 1）" % rpt.count(OLD_ROUTE))
    if problems:
        print("🔴 锚点校验失败，拒绝改动：")
        for p in problems:
            print("     - " + p)
        return 3

    seg = _slice(fin, GL_START, GL_END, "gl")
    new_fin = fin[:seg[1]] + NEW_GL + fin[seg[2]:]
    seg2 = _slice(new_fin, OLD_SIG_PNL, BS_START, "pnl")
    new_fin = new_fin[:seg2[1]] + NEW_PNL + new_fin[seg2[2]:]
    new_rpt = rpt.replace(OLD_ROUTE, NEW_ROUTE, 1)

    if args.dry_run:
        print("[dry-run] finance.py 换 2 个函数（原 %d → %d 字节）；reports.py 换路由回落（%d → %d 字节）"
              % (len(fin), len(new_fin), len(rpt), len(new_rpt)))
        return 0

    for label, txt in (("finance.py", new_fin), ("reports.py", new_rpt)):
        try:
            ast.parse(txt)
        except SyntaxError as e:
            print("🔴 %s 改后语法错误，拒绝写入：%s" % (label, e))
            return 5

    for path in (FIN, RPT):
        bak = path + ".bak-v714"
        if not os.path.exists(bak):
            shutil.copy2(path, bak)
    _write(FIN, new_fin)
    _write(RPT, new_rpt)
    print("✏️  已写入（备份 .bak-v714）")

    if args.skip_verify:
        return 0
    return _verify()


def _write(path, text):
    tmp = path + ".tmp-v714"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, path)


def _verify():
    fin = open(FIN, encoding="utf-8").read()
    rpt = open(RPT, encoding="utf-8").read()
    bad = []
    if fin.count(MARK_PNL) != 1:
        bad.append("get_pnl 新签名出现 %d 次" % fin.count(MARK_PNL))
    if fin.count(MARK_GL) != 1:
        bad.append("get_pnl_gl v714 标记出现 %d 次" % fin.count(MARK_GL))
    if fin.count("_group(exp_codes, False)") != 1:
        bad.append("费用分组缺失")
    if fin.count('"raw_net": round(tick, 2)') != 1:
        bad.append("自证字段缺失")
    # 不带 month 的 SQL 必须逐字保留（KPI 非回归）
    for sql in ("SELECT COALESCE(SUM(amount),0) FROM cash_flow WHERE type='income'\").fetchone()[0]",
                "FROM sale_orders WHERE status IN ('delivered','signed')\").fetchone()[0]",
                "FROM purchase_orders WHERE status='received'\").fetchone()[0]"):
        if sql not in fin:
            bad.append("全期 SQL 被改动：%s" % sql[:50])
    if rpt.count(MARK_RPT) != 1:
        bad.append("路由 v714 标记出现 %d 次" % rpt.count(MARK_RPT))
    if 'cash["basis"] = "cash"' not in rpt:
        bad.append("回落口径标记缺失")
    if bad:
        print("🔴 回读校验失败：")
        for b in bad:
            print("     - " + b)
        return 4
    print("✅ 回读校验通过（GL 三分口径在位、按月回落标 basis、全期 SQL 逐字未动）")
    return 0


def _verify_reverted():
    fin = open(FIN, encoding="utf-8").read()
    rpt = open(RPT, encoding="utf-8").read()
    bad = []
    if MARK_GL in fin or MARK_PNL in fin:
        bad.append("finance.py 仍残留 v714 标记")
    if MARK_RPT in rpt:
        bad.append("reports.py 仍残留 v714 标记")
    if OLD_SIG_PNL not in fin:
        bad.append("旧 get_pnl 签名未复原")
    if 'def get_pnl_gl(month=""):' not in fin:
        bad.append("get_pnl_gl 未复原")
    if 'get_account_codes_by_category("收入")' not in fin:
        bad.append("旧科目取法未复原")
    if bad:
        print("🔴 回滚自检失败：")
        for b in bad:
            print("     - " + b)
        return 4
    print("✅ 回滚自检通过（旧 get_pnl / get_pnl_gl / 路由片段全部复原）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
