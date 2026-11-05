"""Finance queries: payments, receivables, expenses, bank, accounting, reports."""
from contextlib import nullcontext
from datetime import datetime, timedelta
from db.connection import get_db, get_db_tx, get_tenant_context, _gen_no, log_migration_warn
from db.precision import money_balanced, money_eq
from db.queries.inventory import inventory_adjust
from db.queries.reports import get_anomalies, get_sales_leaderboard
import logging
import re
_logger = logging.getLogger(__name__)

def get_pnl(month=""):
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


def get_balance_sheet():
    with get_db() as db:
        ar = db.execute("SELECT COALESCE(SUM(amount-paid_amount),0) FROM receivables WHERE type='ar' AND status!='paid'").fetchone()[0]
        ap = db.execute("SELECT COALESCE(SUM(amount-paid_amount),0) FROM receivables WHERE type='ap' AND status!='paid'").fetchone()[0]
        cash = db.execute("SELECT COALESCE(SUM(current_balance),0) FROM accounts").fetchone()[0]
        inventory_val = db.execute("SELECT COALESCE(SUM(i.quantity*p.purchase_price),0) FROM inventory i JOIN products p ON i.product_id=p.id").fetchone()[0]
        return {'assets':cash+ar+inventory_val,'liabilities':ap,'equity':cash+ar+inventory_val-ap,'cash':cash,'ar':ar,'inventory_val':inventory_val,'ap':ap}


def get_cashflow():
    with get_db() as db:
        cash_in = db.execute("SELECT COALESCE(SUM(amount),0) FROM cash_flow WHERE type='income'").fetchone()[0]
        cash_out = db.execute("SELECT COALESCE(SUM(amount),0) FROM cash_flow WHERE type='expense'").fetchone()[0]
        received = db.execute("SELECT COALESCE(SUM(received_amount),0) FROM sale_orders WHERE status!='draft'").fetchone()[0]
        paid = db.execute("SELECT COALESCE(SUM(paid_amount),0) FROM purchase_orders WHERE status!='draft'").fetchone()[0]
        return {'inflow':cash_in+received,'outflow':cash_out+paid,'net_cash':cash_in+received-cash_out-paid,'cash_in':cash_in,'cash_out':cash_out,'received':received,'paid':paid}


# === Accrual-basis GL Statements (read from journal_entries) ===
# v714：损益类科目全集只认「6 开头」——`category='成本'` 里混着 5 个 **5 开头**的
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
                    # v717：四段费用 + 其他收入也要给默认值 —— 前端会 `|| 0`，
                    # 但缺字段会让「字段有没有返回」这件事无法从返回体判断。
                    "sell_expense": 0, "admin_expense": 0, "fin_expense": 0,
                    "other_expense": 0, "other_revenue": 0,
                    "has_data": False, "month_vouchers": 0, "unclassified": []}
        cl = sorted(codes)
        ph = ",".join("?" * len(cl))
        bal = {}
        for code, dsum, csum in db.execute(
                "SELECT account_code, COALESCE(SUM(debit),0), COALESCE(SUM(credit),0) "
                "FROM journal_entries WHERE substr(date,1,7)=? AND account_code IN (" + ph + ") "
                "GROUP BY account_code", [month] + cl):
            bal[code] = (dsum or 0.0, csum or 0.0)
        # v717d：该月**全部**凭证行数（不只损益科目）。用来回答「这个月到底记过账没有」——
        # `has_data` 只表示「有没有损益科目的发生额」，拿它当回落判据会把
        # 「只记了进货、没记损益」的月份误判成「没记账」⇒ 回落现金制 ⇒
        # 进货被当成费用（2026-10 实测净利 −920）。
        month_vouchers = db.execute(
            "SELECT COUNT(*) FROM journal_entries WHERE substr(date,1,7)=?",
            (month,)).fetchone()[0]

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

    # ---- v717：费用三段分解 + 其他费用 -------------------------------------
    # 前端「费用明细」卡读的是 sell_expense / admin_expense / fin_expense /
    # other_expense 四个字段，而 v714 只返回了 total_expense
    # ⇒ 界面上「销售费用 / 管理费用 / 财务费用」三行**恒为 ¥0.00**
    #   （只有「费用合计」有数）—— 同一类「按从未返回的字段写」缺陷。
    # 分段只按一级科目前缀切，其余全进 other_expense：
    #   6601 销售费用 / 6602 管理费用 / 6603 财务费用
    #   其他 = 6402 客户费用、6403/6405 税金及附加、6411 利息支出、
    #          6421 手续费支出、6701 资产减值、6711 营业外支出、
    #          6801 所得税、6901 以前年度损益调整
    # 🔴 四段之和必须**逐分等于** total_exp。这里用整数分判等（money_eq），
    #    分不平直接抛错 —— 宁可整页报错，也不让「合计对、明细不对」的账
    #    静默流到老板眼前（v710 的教训：浮点判等在「两数是否相等」上会翻案）。
    _sell_codes = {c for c in exp_codes if c.startswith("6601")}
    _admin_codes = {c for c in exp_codes if c.startswith("6602")}
    _fin_codes = {c for c in exp_codes if c.startswith("6603")}
    _oth_codes = exp_codes - _sell_codes - _admin_codes - _fin_codes
    sell_exp = _group(_sell_codes, False)
    admin_exp = _group(_admin_codes, False)
    fin_exp = _group(_fin_codes, False)
    other_exp = _group(_oth_codes, False)
    if not money_eq(sell_exp + admin_exp + fin_exp + other_exp, total_exp):
        raise ValueError(
            "get_pnl_gl 费用分解不平: %.2f+%.2f+%.2f+%.2f=%.2f != total_expense %.2f (%s)"
            % (sell_exp, admin_exp, fin_exp, other_exp,
               sell_exp + admin_exp + fin_exp + other_exp, total_exp, month))
    # 其他收入：收入集合里剔掉 6001*（主营业务收入）剩下的部分，
    # 供界面角标显示（"· 其他收入: ¥x"），**不参与任何合计**。
    other_rev = _group({c for c in rev_codes if not c.startswith("6001")}, True)

    # 补漏进来的异形科目（正常应为空）：已计入费用，但要让口径漂移可见
    unclassified = sorted(c for c in codes if not c.startswith("6"))
    tick = sum((c - d) for d, c in bal.values())   # 全集净额（贷-借）

    return {
        "month": month, "basis": "accrual", "source": "gl",
        "revenue": round(revenue, 2),
        "cogs": round(cost, 2),
        "gross_profit": round(revenue - cost, 2),
        "total_expense": round(total_exp, 2),
        # v717：费用明细四段（口径见上方分解），前端「费用明细」卡按这四个字段渲染。
        "sell_expense": round(sell_exp, 2),
        "admin_expense": round(admin_exp, 2),
        "fin_expense": round(fin_exp, 2),
        "other_expense": round(other_exp, 2),
        "other_revenue": round(other_rev, 2),
        "net_profit": round(revenue - cost - total_exp, 2),
        # `raw_net` = 全集原始净额（贷−借），**不分父子**，与资产负债表
        # `unclosed_profit`（同样直接 SUM 全部 6 开头）同口径 ⇒ 可跨表勾稽。
        # 存在父子双记时 `raw_net > net_profit`，差值正是被叶子有效剔掉的父科目 ——
        # 这不是 bug，是"去重真的发生了"的证据（隔离库 A8b 用人造父子验证）。
        "raw_net": round(tick, 2),
        "has_data": bool(bal),
        # v717d：该月全部凭证行数（含资产负债类）。0 = 这个月完全没记过账，
        # 才允许回落到现金制业务单据估算。
        "month_vouchers": month_vouchers,
        "unclassified": unclassified,
    }


def get_balance_sheet_gl(as_of=""):
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

        total_assets = cat_balance("资产")
        total_liabilities = -cat_balance("负债")
        total_equity = -cat_balance("权益")

        # v709：把「尚未结转到本年利润」的当期损益并入权益。
        # 恒等式是 资产 = 负债 + 所有者权益；损益类（6 开头）在期末结转前仍挂在
        # 账上，不并入就永远差一个「当期利润」。tenant_1 实测未结转 98,325.00
        # （revenue_recognition 90,000 + sale 8,325），恰好等于报表差额 ——
        # 不是账不平，是没结转。结转后损益类归零、4103 有余额，不会重复计。
        _all_codes = set()
        for _s in by_cat.values():
            _all_codes |= _s
        unclosed_profit = -sum(v for _c, v in bal.items()
                               if _c.startswith("6") and _c in _all_codes)
        total_equity += unclosed_profit

        # v708：删掉「权益为 0 就拿残差凑」的兜底。那行会让
        # `资产 - (负债 + 权益)` 恒等于 0 ⇒ balanced 恒真、判据没有判别力。
        # 现在如实显示权益，差额一眼可见（本账套 169 万是真账不平）。
        # v713：给前端「资产负债表(权责)」补明细行。
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

        balanced = money_balanced(total_assets, total_liabilities + total_equity)
        return {
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
        }

# ============================================================
# 商品 / 联系人 / 库存 / 采购 / 销售
# product_* → db/queries/products.py
# ============================================================

# contact_* → db/queries/contacts.py
# inventory_*, stock_take_*, transfer_stock, get_fefo_* → db/queries/inventory.py
# purchase_order_* → db/queries/purchases.py

# sale_order_create → db/queries/sales.py
# sale_order_deliver → db/queries/sales.py
# sale_order_sign → db/queries/sales.py
# sale_order_list → db/queries/sales.py
# sale_order_get → db/queries/sales.py

def payment_create(contact_id=0, amount=0, type=None, pay_type='ar', account='现金', category='', contact_name='', note='', operator_id='', ref_type='', ref_id=0):
    try: from erp_db import check_period_open; check_period_open()
    except Exception: _logger.warning("check_period_open failed in payment_create", exc_info=True)
    if type is not None:
        pay_type = type
    if not contact_id and contact_name:
        with get_db() as db:
            r = db.execute("SELECT id FROM contacts WHERE name=? LIMIT 1",(contact_name,)).fetchone()
            contact_id = r['id'] if r else 0
    with get_db_tx() as db:
        if ref_id and ref_type:
            db.execute("UPDATE receivables SET paid_amount=paid_amount+?,status=CASE WHEN paid_amount+?>=amount THEN 'paid' WHEN paid_amount+?>0 THEN 'partial' ELSE status END WHERE id=?",(amount,amount,amount,ref_id))
        cf_amount = amount if pay_type=='ar' else -amount
        db.execute("UPDATE accounts SET current_balance=current_balance+? WHERE name=?",(cf_amount,account))
        bal = db.execute("SELECT current_balance FROM accounts WHERE name=?",(account,)).fetchone()
        cur = db.execute("INSERT INTO cash_flow (account,type,amount,balance_after,contact_id,ref_type,ref_id,category,note,operator_id) VALUES (?,?,?,?,?,?,?,?,?,?)",(account,'income' if pay_type=='ar' else 'expense',abs(amount),bal['current_balance'] if bal else 0,contact_id,ref_type,ref_id,category,note,operator_id))
        pid = cur.lastrowid
        # generates journal entry inline for atomicity
        from erp_db import auto_journal_for_payment
        auto_journal_for_payment(pid, db_conn=db)
        return pid


def receivable_list(contact_type='', status='', limit=200, offset=0, contact_id=0):
    with get_db() as db:
        where,params = [],[]
        if contact_type: where.append("r.type=?"); params.append('ar' if contact_type=='customer' else 'ap')
        if status: where.append("r.status=?"); params.append(status)
        if contact_id: where.append("r.contact_id=?"); params.append(contact_id)
        w = " WHERE "+" AND ".join(where) if where else ""
        rows = [dict(r) for r in db.execute(f"SELECT r.*,c.name as contact_name FROM receivables r LEFT JOIN contacts c ON r.contact_id=c.id{w} ORDER BY r.id DESC LIMIT ? OFFSET ?",params+[limit,offset]).fetchall()]
        total = db.execute(f"SELECT COUNT(*) FROM receivables r{w}",params).fetchone()[0]
        return {'receivables':rows,'total':total}


def account_summary():
    with get_db() as db:
        today = datetime.now().strftime("%Y-%m-%d")
        income = db.execute("SELECT COALESCE(SUM(amount),0) FROM cash_flow WHERE type='income' AND date(created_at)=?",(today,)).fetchone()[0]
        expense = db.execute("SELECT COALESCE(SUM(amount),0) FROM cash_flow WHERE type='expense' AND date(created_at)=?",(today,)).fetchone()[0]
        ar = db.execute("SELECT COALESCE(SUM(amount-paid_amount),0) FROM receivables WHERE type='ar' AND status!='paid'").fetchone()[0]
        ap = db.execute("SELECT COALESCE(SUM(amount-paid_amount),0) FROM receivables WHERE type='ap' AND status!='paid'").fetchone()[0]
        accounts = [dict(r) for r in db.execute("SELECT * FROM accounts").fetchall()]
        return {'accounts':accounts,'today_income':income,'today_expense':expense,'total_ar':ar,'total_ap':ap}


def cash_flow_list(date_from='', date_to='', account='', limit=100, offset=0):
    with get_db() as db:
        where,params = [],[]
        if date_from: where.append("date(created_at)>=?"); params.append(date_from)
        if date_to: where.append("date(created_at)<=?"); params.append(date_to)
        if account: where.append("account=?"); params.append(account)
        w = " WHERE "+" AND ".join(where) if where else ""
        rows = [dict(r) for r in db.execute(f"SELECT * FROM cash_flow{w} ORDER BY id DESC LIMIT ? OFFSET ?",params+[limit,offset]).fetchall()]
        total = db.execute(f"SELECT COUNT(*) FROM cash_flow{w}",params).fetchone()[0]
        return {'items':rows,'total':total}

# ============================================================
# 预收/预付
# ============================================================


def prepayment_create(ptype, contact_id, amount, note='', operator_id='', ref_type='', ref_id=0):
    with get_db() as db:
        db.execute("INSERT INTO prepayments (type,contact_id,amount,note,operator_id,ref_type,ref_id) VALUES (?,?,?,?,?,?,?)",(ptype,contact_id,amount,note,operator_id,ref_type,ref_id))
        # 同步到账户：预收款→现金+1，预付款→现金-1
        cf = amount if ptype=='ar' else -amount
        db.execute("UPDATE accounts SET current_balance=current_balance+? WHERE name='现金'",(cf,))
        bal = db.execute("SELECT current_balance FROM accounts WHERE name='现金'").fetchone()
        db.execute("INSERT INTO cash_flow (account,type,amount,balance_after,contact_id,ref_type,ref_id,category,note,operator_id) VALUES ('现金',?,?,?,?,'prepayment',?,?,?,?)",('income' if ptype=='ar' else 'expense',amount,bal['current_balance'] if bal else 0,contact_id,ref_id,'预收' if ptype=='ar' else '预付',note,operator_id))
        db.commit()


def prepayment_list(ptype='', contact_id=0):
    with get_db() as db:
        where,params = [],[]
        if ptype: where.append("type=?"); params.append(ptype)
        if contact_id: where.append("contact_id=?"); params.append(contact_id)
        w = " WHERE "+" AND ".join(where) if where else ""
        return [dict(r) for r in db.execute(f"SELECT p.*,c.name as contact_name FROM prepayments p LEFT JOIN contacts c ON p.contact_id=c.id{w} ORDER BY p.id DESC",params).fetchall()]


def prepayment_refund(ppid, amount, operator_id=''):
    with get_db() as db:
        pp = db.execute("SELECT * FROM prepayments WHERE id=?",(ppid,)).fetchone()
        if not pp: return {'error':'不存在'}
        db.execute("UPDATE prepayments SET amount=amount-?,used_amount=used_amount-? WHERE id=?",(amount,amount,ppid))
        cf = -amount if pp['type']=='ar' else amount
        db.execute("UPDATE accounts SET current_balance=current_balance+? WHERE name='现金'",(cf,))
        db.commit(); return {'success':True}


# === 预收退款单 (prepay-refunds) ===
# /api/prepay-refunds is NOT tenant-required -> resolves to the master DB.
# The prepay_refunds table is created by the v93 migration in erp_db.init_db().
# These functions were missing entirely (AttributeError -> 500) before this fix.

def prepay_refund_create(contact_id, amount, prepay_id=0, discount_amount=0, refund_amount=0,
                         writeoff_amount=0, note='', refund_person='', creator_id='',
                         department='', region='', channel='', brand='', account=''):
    no = _gen_no("PR")
    with get_db() as db:
        cur = db.execute(
            """INSERT INTO prepay_refunds
               (order_no, contact_id, amount, prepay_id, discount_amount, refund_amount,
                writeoff_amount, note, refund_person, creator_id, department, region,
                channel, brand, account, status)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'pending')""",
            (no, contact_id, amount, prepay_id, discount_amount, refund_amount, writeoff_amount,
             note, refund_person, creator_id, department, region, channel, brand, account),
        )
        rid = cur.lastrowid
        db.commit()
        return {"order_id": rid, "order_no": no}


def prepay_refund_list(contact_id=0, limit=200, date_from='', date_to='', status='', search='',
                       refund_person='', creator_id='', department='', region='', channel='',
                       brand='', account='', amount_min=0, amount_max=0):
    with get_db() as db:
        where, params = [], []
        if contact_id:
            where.append("pr.contact_id=?"); params.append(contact_id)
        if date_from:
            where.append("pr.order_date>=?"); params.append(date_from)
        if date_to:
            where.append("pr.order_date<=?"); params.append(date_to)
        if status:
            where.append("pr.status=?"); params.append(status)
        if refund_person:
            where.append("pr.refund_person LIKE ?"); params.append(f"%{refund_person}%")
        if creator_id:
            where.append("pr.creator_id=?"); params.append(creator_id)
        if department:
            where.append("pr.department=?"); params.append(department)
        if region:
            where.append("pr.region=?"); params.append(region)
        if channel:
            where.append("pr.channel=?"); params.append(channel)
        if brand:
            where.append("pr.brand=?"); params.append(brand)
        if account:
            where.append("pr.account=?"); params.append(account)
        if search:
            where.append("(pr.order_no LIKE ? OR c.name LIKE ?)")
            params += [f"%{search}%", f"%{search}%"]
        if amount_min:
            where.append("pr.amount>=?"); params.append(amount_min)
        if amount_max:
            where.append("pr.amount<=?"); params.append(amount_max)
        w = (" WHERE " + " AND ".join(where)) if where else ""
        rows = db.execute(
            f"""SELECT pr.*, c.name as contact_name FROM prepay_refunds pr
                LEFT JOIN contacts c ON pr.contact_id=c.id{w}
                ORDER BY pr.id DESC LIMIT ?""",
            params + [limit],
        ).fetchall()
        return [dict(r) for r in rows]


# ============================================================
# 费用单
# ============================================================


def expense_category_list(etype=''):
    with get_db() as db:
        if etype: return [dict(r) for r in db.execute("SELECT * FROM expense_categories WHERE type=? ORDER BY id",(etype,)).fetchall()]
        return [dict(r) for r in db.execute("SELECT * FROM expense_categories ORDER BY type,id").fetchall()]


def expense_order_create(etype, contact_id, amount, category_id=0, note='', operator_id='', brand='', employee_id='', order_no='', order_date='', db_conn=None, post_ledger=True, post_journal=True):
    """建一张费用单。返回 `{'order_id','order_no'}`；单号已存在时返回 `{'existed':True,...}`。

    🔴 2026-09-28 修复（v313，邮件对账 M0）—— 本函数原有**两处必崩缺陷**，从未成功建过一单
       （本地三套库 `expense_orders` 实测全 0 行，与「有表、有页面」的直觉相反）：
       ① 函数体里那条 `INSERT` **没有接收返回值**，随后三处 `cur.lastrowid` ⇒ `NameError`。
       ② `routers/finance.py` 的 `POST /api/finance/expense-orders` 传 **15 个实参**，
          而本函数收 **8 个形参** ⇒ `TypeError`。

    🔴 **形参个数刻意保持 8 个，不去对齐那 15 个**。理由：
       那个路由属 2026-09-15 全量审计登记的**幽灵符号族**（`routers/finance.py` 29/101 个，
       在册结论 =「半成品端点**该删不该补**」），且它依赖 `discount_amount` / `settlement_status` /
       `settlement_unit_id` / `employee_name` / `product_info` / `generation_method` 这 6 个
       **`expense_orders` 里根本不存在**的列 —— 补实现解决不了问题，只会把一个半成品
       伪装成能用的功能。**本函数现在是导入管线（舟谱费用明细）的落库入口**，与那个 HTTP 路由无关。

    ⚠️ 两处**已知未修**（都只在 `etype != 'supplier'` 时才会走到，M0.1 只导供应商侧 ⇒ 走不到）：
       · `'customer'` 分支写 `receivables.amount = -amount`，而该表有 `CHECK(amount>=0)`
         ⇒ 必 `IntegrityError`。看起来是符号写反（客户欠我应为正 `ar`），但**改语义不猜**。
       · `'internal'` 分支直接改「现金」账户余额 —— 导入历史单据不该触发
         ⇒ 由调用方传 `post_ledger=False` 关闭。

    新增的 4 个参数**默认值 = 原行为**，既有调用方零影响：
      · `order_no`    非空则用它（外部系统的原单号）+ 按单号查重，命中直接返回 `existed`
      · `order_date`  非空则写进 `order_date` 列（历史单据不能落成「今天」）
      · `db_conn`     传入调用方的连接 ⇒ 复用同一事务（导入分批 commit 用），**不自行 commit**
      · `post_ledger` False = 不写应收/应付、不动账户余额。
                  🔴 导入**已结算的历史单据**必须传 False：否则会凭空多出一条应付 +
                     反而冲减现金余额，污染账龄，且难以回退。
    """
    no = str(order_no or '').strip()
    if no:
        # 查重必须走**同一个连接**：否则读不到本批尚未提交的已插单据，
        # 同一份文件里出现两次的同一个单号会各建一张单。（同 v269 `sale_order_create` 纪律）
        try:
            with (nullcontext(db_conn) if db_conn is not None else get_db()) as _dq:
                _ex = _dq.execute("SELECT id FROM expense_orders WHERE order_no=? LIMIT 1", (no,)).fetchone()
            if _ex:
                return {'existed': True, 'order_id': _ex['id'] if hasattr(_ex, 'keys') else _ex[0],
                        'order_no': no}
        except Exception as e:
            _logger.warning(f"expense_order_create 按 order_no 查重失败，继续建单: {e}")
    if not no:
        no = _gen_no("EX")
    _cols = ["order_no", "type", "contact_id", "category_id", "amount",
             "note", "operator_id", "brand", "employee_id"]
    _vals = [no, etype, contact_id, category_id, amount, note, operator_id, brand, employee_id]
    if str(order_date or '').strip():
        # 动态拼列：`order_date` **只在有值时**进 INSERT，空值不写 ⇒ 落表默认值（同 v268 纪律）。
        _cols.append("order_date")
        _vals.append(str(order_date).strip())
    with (nullcontext(db_conn) if db_conn is not None else get_db()) as db:
        try:
            cur = db.execute(
                "INSERT INTO expense_orders (%s) VALUES (%s)" % (
                    ",".join(_cols), ",".join("?" * len(_cols))),
                _vals)
        except Exception as e:
            # 并发或查重漏网时撞上 `order_no` 的 UNIQUE 约束 ⇒ 视为幂等命中（只认唯一约束这一类）。
            _m = str(e).lower()
            if no and ("unique" in _m or "constraint" in _m):
                with get_db() as _dq2:
                    _ex2 = _dq2.execute("SELECT id FROM expense_orders WHERE order_no=? LIMIT 1", (no,)).fetchone()
                if _ex2:
                    return {'existed': True, 'order_id': _ex2['id'] if hasattr(_ex2, 'keys') else _ex2[0],
                            'order_no': no}
            raise
        oid = cur.lastrowid
        # 客户/供应商费用生成应收/应付（`post_ledger=False` 时整段跳过）
        if post_ledger:
            if etype == 'customer':
                # v717：原写法 `('ar', ..., -amount)` 撞 `receivables` 的
                # `CHECK(amount>=0)` ⇒ 客户费用（陈列费/促销费/返利）**必 IntegrityError**，
                # 一单也建不成（与「expense_orders 生产 0 行」互为因果）。
                # 语义也是反的：给门店陈列费是「我欠门店」⇒ 记 `ap` 正数；
                # 不是应收负数。要「陈列费冲抵货款」应走核销，不是在应收里写负数。
                db.execute("INSERT INTO receivables (type,contact_id,ref_type,ref_id,amount) VALUES ('ap',?,'expense',?,?)",(contact_id,oid,amount))
            elif etype == 'supplier':
                db.execute("INSERT INTO receivables (type,contact_id,ref_type,ref_id,amount) VALUES ('ap',?,'expense',?,?)",(contact_id,oid,amount))
            elif etype == 'internal':
                db.execute("UPDATE accounts SET current_balance=current_balance-? WHERE name='现金'",(amount,))
        # ---- v717：生成费用凭证（借费用科目 / 贷 2202 应付账款）---------------
        # 🔴 与 `post_ledger` **解耦**：`post_ledger` 管的是「往来账 + accounts 余额」，
        #    而费用**必须**进 GL —— 否则利润表的费用恒为 0、净利恒等于毛利。
        #    舟谱历史费用导入传 post_ledger=False（不该凭空造应付），
        #    但 post_journal 仍为 True，否则导进去的费用在利润表上根本不存在。
        if post_journal and amount:
            try:
                auto_journal_for_expense(oid, db_conn=db)
            except Exception as _e:
                # 记账失败不能把建单一起弄挂（建单是业务事实，凭证可事后补）
                _logger.warning("auto_journal_for_expense(%s) 失败，费用凭证未生成: %s",
                                oid, _e, exc_info=True)
        if db_conn is None:
            db.commit()
    return {'order_id': oid, 'order_no': no}


def expense_order_pay(oid, amount, account='现金', operator_id=''):
    with get_db() as db:
        o = db.execute("SELECT * FROM expense_orders WHERE id=?",(oid,)).fetchone()
        if not o: return {'error':'不存在'}
        db.execute("UPDATE expense_orders SET paid_amount=paid_amount+?,status=CASE WHEN paid_amount+?>=amount THEN 'paid' ELSE 'unpaid' END WHERE id=?",(amount,amount,oid))
        if o['type']=='customer':
            db.execute("UPDATE receivables SET paid_amount=paid_amount+?,status=CASE WHEN paid_amount+?>=ABS(amount) THEN 'paid' WHEN paid_amount+?>0 THEN 'partial' ELSE 'unpaid' END WHERE ref_type='expense' AND ref_id=?",(amount,amount,oid))
        elif o['type']=='supplier':
            db.execute("UPDATE receivables SET paid_amount=paid_amount+?,status=CASE WHEN paid_amount+?>=amount THEN 'paid' WHEN paid_amount+?>0 THEN 'partial' ELSE 'unpaid' END WHERE ref_type='expense' AND ref_id=?",(amount,amount,oid))
        db.execute("UPDATE accounts SET current_balance=current_balance-? WHERE name=?",(amount,account))
        # ---- v717：付款凭证（借 2202 应付账款 / 贷 现金或银行存款）------------
        # 不记的话，费用付了 GL 不认，2202 会一直挂着「欠款」，资产负债表虚增负债。
        # 与确认凭证用**不同 ref_type**（expense_pay vs expense），互不干扰；
        # 部分付款会多次调用 ⇒ 这里**故意不做幂等拦截**（每笔都是真实现金流出）。
        try:
            auto_journal_for_expense_pay(oid, amount, account, db_conn=db)
        except Exception as _e:
            _logger.warning("auto_journal_for_expense_pay(%s) 失败，付款凭证未生成: %s",
                            oid, _e, exc_info=True)
        db.commit(); return {'success':True}


def expense_order_list(etype='', contact_id=0, limit=100, offset=0,
                       date_from='', date_to='', status='', search='', brand=''):
    """费用单列表。**返回 `{'items': [...], 'total': N}`**（v717 改形态）。

    改前签名只收 `(etype, contact_id, limit)` 三个，而路由传 **11 个实参**
    ⇒ `GET /api/expense-orders` 100% `TypeError` 500，「营销 → 费用」整页打不开。

    同时补 `offset` + `total`：前端分页传的是 `limit` + `offset`，
    老实现没有 offset（收到也丢）⇒ 翻页永远返回同一批数据，且看不出来。
    前端两种形态都兼容（`w.items || Array.isArray(w) ? w : []`）。
    """
    where, params = [], []
    if etype:
        where.append("e.type=?"); params.append(etype)
    if contact_id:
        where.append("e.contact_id=?"); params.append(contact_id)
    if status:
        where.append("e.status=?"); params.append(status)
    if brand:
        where.append("e.brand=?"); params.append(brand)
    if date_from:
        where.append("date(IFNULL(e.order_date,e.created_at))>=date(?)"); params.append(date_from)
    if date_to:
        where.append("date(IFNULL(e.order_date,e.created_at))<=date(?)"); params.append(date_to)
    if search:
        where.append("(IFNULL(e.order_no,'') LIKE ? OR IFNULL(e.note,'') LIKE ? "
                     "OR IFNULL(c.name,'') LIKE ?)")
        _like = "%" + str(search) + "%"
        params.extend([_like, _like, _like])
    w = " WHERE " + " AND ".join(where) if where else ""
    try:
        limit = max(1, min(int(limit or 200), 1000))
    except Exception:
        limit = 200
    try:
        offset = max(0, int(offset or 0))
    except Exception:
        offset = 0
    with get_db() as db:
        total = db.execute(
            "SELECT COUNT(*) FROM expense_orders e "
            "LEFT JOIN contacts c ON e.contact_id=c.id" + w, params).fetchone()[0]
        items = [dict(r) for r in db.execute(
            "SELECT e.*,c.name as contact_name,ec.name as category_name "
            "FROM expense_orders e LEFT JOIN contacts c ON e.contact_id=c.id "
            "LEFT JOIN expense_categories ec ON e.category_id=ec.id" + w +
            " ORDER BY e.id DESC LIMIT ? OFFSET ?", params + [limit, offset]).fetchall()]
    return {'items': items, 'total': total}


# ============================================================ 费用凭证
# v717 **新增**。改前全仓只有 sale / payment / purchase / cogs 四个
# `auto_journal_for_*`，**没有 expense** ⇒ 费用单建了也进不了 GL，
# 利润表费用恒为 0、净利恒等于毛利。这是「只有毛利没有净利」的唯一根因。

# 分类名 → 记账科目（兜底用；优先取 `expense_categories.gl_account`）
_EXPENSE_GL_BY_NAME = {
    "陈列费": "64020101",   # 客户费用-陈列费-主货架陈列费
    "促销费": "640201",     # 客户费用（通用层）
    "返利": "64020105",     # 客户费用-指标达成返利
    "运费": "66020207",     # 管理费用-办公费-运输费
    "装卸费": "66020206",   # 管理费用-办公费-卸货费
    "办公费": "66020205",   # 管理费用-办公费-办公用品费
    "差旅费": "660203",     # 管理费用-差旅费/交通费
    "工资": "660209",       # 管理费用-工资
    "房租": "66020201",     # 管理费用-办公费-仓库租金
}
# type → 记账科目（分类为空/未映射时的最后兜底）
_EXPENSE_GL_BY_TYPE = {"customer": "640201", "supplier": "66020207", "internal": "660210"}
# 付款账户名 → 现金/银行存款科目
_EXPENSE_PAY_ACCOUNT_GL = {"现金": "1001", "银行": "100201",
                           "微信": "10150101", "支付宝": "10150201"}
# 费用确认的对方科目：应付账款。统一用 2202（资产负债表的 `ap` 明细行读的就是它）
_EXPENSE_PAYABLE_GL = "2202"


def _expense_gl_account(dbc, category_id, etype="customer"):
    """费用分类 → 记账科目编码。返回 `(code, category_name)`。

    取数优先级：`expense_categories.gl_account` → 分类名兜底 → type 兜底。

    🔴 两条硬约束，缺一条就会**静默丢账**：
       ① `gl_account` 这一列**没有任何 Python 代码创建**（属账外裸 DDL，见 v705），
          老库有、全新建的租户库可能没有 ⇒ 读它必须 try/except 并容忍缺列。
       ② 写进凭证的编码必须**真的在** `chart_of_accounts` 里且 `is_active=1`——
          `get_pnl_gl` 只统计它自己那套 codes 集合里的科目，编码不存在则
          该笔费用在利润表上**彻底消失**，而且合计差额看起来像"数据问题"。
    """
    name, code = "", ""
    if category_id:
        try:
            r = dbc.execute("SELECT name, gl_account FROM expense_categories WHERE id=?",
                            (category_id,)).fetchone()
            if r:
                keys = r.keys() if hasattr(r, "keys") else None
                name = (r["name"] if keys else r[0]) or ""
                code = (r["gl_account"] if keys else "") or ""
        except Exception:
            # gl_account 列不存在 ⇒ 至少把 name 取到
            try:
                r = dbc.execute("SELECT name FROM expense_categories WHERE id=?",
                                (category_id,)).fetchone()
                if r:
                    name = r[0] or ""
            except Exception:
                pass
    valid = set()
    try:
        for (c,) in dbc.execute("SELECT code FROM chart_of_accounts WHERE is_active=1"):
            valid.add(c)
    except Exception:
        pass

    def _ok(x):
        return bool(x) and (not valid or x in valid)

    if _ok(code):
        return code, name
    n = str(name or "").strip()
    if _EXPENSE_GL_BY_NAME.get(n) and _ok(_EXPENSE_GL_BY_NAME[n]):
        return _EXPENSE_GL_BY_NAME[n], name
    t = _EXPENSE_GL_BY_TYPE.get(etype or "customer") or "6602"
    if not _ok(t):
        cand = sorted(c for c in valid if c.startswith("6602")) or \
               sorted(c for c in valid if c.startswith("6"))
        t = cand[0] if cand else t
    return t, name


def auto_journal_for_expense(expense_id, db_conn=None):
    """费用确认凭证：**借 费用科目 / 贷 2202 应付账款**。

    幂等：同一 `ref_id` 已有 `ref_type='expense'` 分录 ⇒ 直接返回，不重复记。
    与 `auto_journal_for_sale` 同构（`db_conn` 传入即复用调用方事务，不自行 commit）。
    """
    if db_conn is not None:
        dbc = db_conn
        own = False
    else:
        _cm = get_db()
        dbc = _cm.__enter__()
        own = True
    try:
        e = dbc.execute("SELECT * FROM expense_orders WHERE id=?", (expense_id,)).fetchone()
        if not e:
            return None
        if dbc.execute("SELECT id FROM journal_entries WHERE ref_type='expense' "
                       "AND ref_id=? LIMIT 1", (expense_id,)).fetchone():
            return None
        amount = round(float(e["amount"] or 0), 2)
        if not amount:
            return None
        code, cname = _expense_gl_account(dbc, e["category_id"] or 0, e["type"] or "customer")
        date_str = str(e["order_date"] or e["created_at"] or "")[:10]
        if not date_str or date_str == "None":
            date_str = datetime.now().strftime("%Y-%m-%d")
        tag = cname or (e["note"] or "") or ("单据#%s" % (e["order_no"] or expense_id))
        entries = [
            {"code": code, "name": cname or "", "debit": amount, "credit": 0,
             "summary": "费用:" + tag},
            {"code": _EXPENSE_PAYABLE_GL, "name": "应付账款", "debit": 0, "credit": amount,
             "summary": "费用:" + tag},
        ]
        # 延迟导入：`erp_db` 顶层 `from db.queries.finance import ...`，这里顶层导入会成环。
        from erp_db import generate_journal_entry
        return generate_journal_entry("expense", expense_id, date_str, entries, db_conn=dbc)
    finally:
        if own:
            try:
                dbc.commit()
            except Exception as _e:
                _logger.error("auto_journal_for_expense 提交失败: %s", _e, exc_info=True)
            _cm.__exit__(None, None, None)


def auto_journal_for_expense_pay(expense_id, amount, account="现金", db_conn=None):
    """费用付款凭证：**借 2202 应付账款 / 贷 现金或银行存款**。

    🔴 与确认凭证相反，这里**故意不做幂等拦截**：`expense_order_pay` 本身是
    「多次部分付款累加」，每次调用都对应一笔真实流出的现金 ⇒ 必须逐次记账。
    要防重复点击该在支付入口做（前端 disabled / 幂等键），不能在这里吞掉。
    """
    if db_conn is not None:
        dbc = db_conn
        own = False
    else:
        _cm = get_db()
        dbc = _cm.__enter__()
        own = True
    try:
        e = dbc.execute("SELECT * FROM expense_orders WHERE id=?", (expense_id,)).fetchone()
        if not e:
            return None
        amt = round(float(amount or 0), 2)
        if amt <= 0:
            return None
        acct = (account or "现金").strip()
        acct_code = _EXPENSE_PAY_ACCOUNT_GL.get(acct, "")
        # 科目必须在账套里，否则这笔现金在资产负债表上不出现（→ 三表不平）
        if acct_code:
            try:
                _hit = dbc.execute("SELECT 1 FROM chart_of_accounts WHERE code=? AND is_active=1",
                                   (acct_code,)).fetchone()
                if not _hit:
                    acct_code = ""
            except Exception:
                acct_code = ""
        if not acct_code:
            acct_code = "1001"
            acct = "现金"
        date_str = str(e["order_date"] or e["created_at"] or "")[:10]
        if not date_str or date_str == "None":
            date_str = datetime.now().strftime("%Y-%m-%d")
        entries = [
            {"code": _EXPENSE_PAYABLE_GL, "name": "应付账款", "debit": amt, "credit": 0,
             "summary": "费用付款:" + (e["order_no"] or str(expense_id))},
            {"code": acct_code, "name": acct, "debit": 0, "credit": amt,
             "summary": "费用付款:" + (e["order_no"] or str(expense_id))},
        ]
        from erp_db import generate_journal_entry
        return generate_journal_entry("expense_pay", expense_id, date_str, entries, db_conn=dbc)
    finally:
        if own:
            try:
                dbc.commit()
            except Exception as _e:
                _logger.error("auto_journal_for_expense_pay 提交失败: %s", _e, exc_info=True)
            _cm.__exit__(None, None, None)
# ============================================================
# 收入单
# ============================================================
#
# 🔴 v313（2026-09-28，邮件对账 M0）**新增**。为什么必须新增：
#    `income_orders` 表（erp_db.py 建表）+ `income_categories` 种子（返利收入/废品收入/利息收入）
#    早就存在，但**全仓从来没有 `income_order_create` / `income_order_list` 这两个函数** ——
#    `routers/finance.py` 里那两处 `db.income_order_create` / `db.income_order_list` 调用
#    是 2026-09-15 审计登记的**幽灵符号族**成员（`erp_db.py` 是具名导入、无 `__getattr__`）
#    ⇒ `POST/GET /api/income-orders` 必 `AttributeError` 500，且实测 access.log 0 次调用。
#
#    ⚠️ 与费用单**处置不同、别照抄**：费用单那个函数是**被真正依赖的**（名字存在、`hasattr` 通过）
#       ⇒ 修它；收入单这里连定义都没有 ⇒ 属于在册结论里的「**半成品端点该删不该补**」。
#       所以本节的函数是**给导入管线用**的新落库入口，**不是**把那个 HTTP 端点补活
#       （那个路由传 15 个实参 + 依赖 6 个不存在的列，补不动，也不该补）。
#       ⇒ 形参刻意 = 与 `expense_order_list` 同形的 3 个，不迁就路由的 11 个。


def income_order_create(itype, contact_id, amount, category_id=0, note='', operator_id='', order_no='', order_date='', db_conn=None, post_ledger=False):
    """建一张收入单。返回 `{'order_id','order_no'}`；单号已存在时返回 `{'existed':True,...}`。

    参数语义与 `expense_order_create` 完全一致（`order_no` 幂等 / `order_date` / `db_conn` / `post_ledger`）。

    🔴 `post_ledger` 默认 **False**（与 expense 的 True 相反，是有意的）：
       expense 默认 True 是为了**保持既有行为不变**（那是老函数）。
       而这里没有历史行为要保 —— 收入单的出入账口径（冲减应付？计入其他应收？还是直接进损益？）
       属于**业务判断**，三种写法在账龄/损益上结果不同。默认不写 = 不静默替用户做账；
       需要生成往来账时由调用方显式传 True，那时口径必须已被确认。
    """
    no = str(order_no or '').strip()
    if no:
        try:
            with (nullcontext(db_conn) if db_conn is not None else get_db()) as _dq:
                _ex = _dq.execute("SELECT id FROM income_orders WHERE order_no=? LIMIT 1", (no,)).fetchone()
            if _ex:
                return {'existed': True, 'order_id': _ex['id'] if hasattr(_ex, 'keys') else _ex[0],
                        'order_no': no}
        except Exception as e:
            _logger.warning(f"income_order_create 按 order_no 查重失败，继续建单: {e}")
    if not no:
        no = _gen_no("IN")
    _cols = ["order_no", "type", "contact_id", "category_id", "amount", "note", "operator_id"]
    _vals = [no, itype, contact_id, category_id, amount, note, operator_id]
    if str(order_date or '').strip():
        _cols.append("order_date")
        _vals.append(str(order_date).strip())
    with (nullcontext(db_conn) if db_conn is not None else get_db()) as db:
        try:
            cur = db.execute(
                "INSERT INTO income_orders (%s) VALUES (%s)" % (
                    ",".join(_cols), ",".join("?" * len(_cols))),
                _vals)
        except Exception as e:
            _m = str(e).lower()
            if no and ("unique" in _m or "constraint" in _m):
                with get_db() as _dq2:
                    _ex2 = _dq2.execute("SELECT id FROM income_orders WHERE order_no=? LIMIT 1", (no,)).fetchone()
                if _ex2:
                    return {'existed': True, 'order_id': _ex2['id'] if hasattr(_ex2, 'keys') else _ex2[0],
                            'order_no': no}
            raise
        oid = cur.lastrowid
        if post_ledger and itype == 'supplier' and contact_id:
            # 供应商收入（厂家返还代垫费用）→ 先记「厂家欠我」= 应收 `ar`。
            # ⚠️ 只在调用方显式 post_ledger=True 时执行（默认不执行，见 docstring）。
            db.execute("INSERT INTO receivables (type,contact_id,ref_type,ref_id,amount) VALUES ('ar',?,'income',?,?)",
                       (contact_id, oid, amount))
        if db_conn is None:
            db.commit()
    return {'order_id': oid, 'order_no': no}


def income_order_list(itype='', contact_id=0, limit=100, offset=0,
                      date_from='', date_to='', status='', search=''):
    """收入单列表。**返回 `{'items': [...], 'total': N}`**（v717b）。

    改前只收 3 个形参，而路由传 8 个 ⇒ `GET /api/income-orders` 100% `TypeError` 500。
    expense 侧同一缺陷 v717 已修，这里补齐，并同样加 `offset` + `total`
    （前端分页传 limit+offset，没有 offset 就永远返回同一批）。
    """
    where, params = [], []
    if itype:
        where.append("i.type=?"); params.append(itype)
    if contact_id:
        where.append("i.contact_id=?"); params.append(contact_id)
    if status:
        where.append("i.status=?"); params.append(status)
    if date_from:
        where.append("date(IFNULL(i.order_date,i.created_at))>=date(?)"); params.append(date_from)
    if date_to:
        where.append("date(IFNULL(i.order_date,i.created_at))<=date(?)"); params.append(date_to)
    if search:
        where.append("(IFNULL(i.order_no,'') LIKE ? OR IFNULL(i.note,'') LIKE ? "
                     "OR IFNULL(c.name,'') LIKE ?)")
        _like = "%" + str(search) + "%"
        params.extend([_like, _like, _like])
    w = " WHERE " + " AND ".join(where) if where else ""
    try:
        limit = max(1, min(int(limit or 200), 1000))
    except Exception:
        limit = 200
    try:
        offset = max(0, int(offset or 0))
    except Exception:
        offset = 0
    with get_db() as db:
        total = db.execute(
            "SELECT COUNT(*) FROM income_orders i "
            "LEFT JOIN contacts c ON i.contact_id=c.id" + w, params).fetchone()[0]
        items = [dict(r) for r in db.execute(
            "SELECT i.*,c.name as contact_name,ic.name as category_name FROM income_orders i "
            "LEFT JOIN contacts c ON i.contact_id=c.id "
            "LEFT JOIN income_categories ic ON i.category_id=ic.id" + w +
            " ORDER BY i.id DESC LIMIT ? OFFSET ?", params + [limit, offset]).fetchall()]
    return {'items': items, 'total': total}


# ============================================================
# 核销单
# ============================================================


def writeoff_create(wtype, contact_id, items, note='', operator_id=''):
    """items: [{ref_type, ref_id, amount}]"""
    no = _gen_no("WO")
    with get_db() as db:
        cur = db.execute("INSERT INTO writeoffs (order_no,type,contact_id,amount,note,operator_id) VALUES (?,?,?,?,?,?)",(no,wtype,contact_id,sum(it['amount'] for it in items),note,operator_id))
        wid = cur.lastrowid
        for it in items:
            db.execute("INSERT INTO writeoff_items (writeoff_id,ref_type,ref_id,amount) VALUES (?,?,?,?)",(wid,it['ref_type'],it['ref_id'],it['amount']))
            # 更新应收应付
            if it['ref_type'] in ('ar','ap'):
                db.execute("UPDATE receivables SET paid_amount=paid_amount+?,status=CASE WHEN paid_amount+?>=amount THEN 'paid' WHEN paid_amount+?>0 THEN 'partial' ELSE status END WHERE id=?",(it['amount'],it['amount'],it['ref_id']))
            elif it['ref_type'] in ('pre_ar','pre_ap'):
                db.execute("UPDATE prepayments SET used_amount=used_amount+? WHERE id=?",(it['amount'],it['ref_id']))
        db.commit(); return {'writeoff_id':wid,'order_no':no}

# ============================================================
# 员工交账
# ============================================================


def settlement_create(employee_id, items):
    """items: [{ref_type, ref_id, item_type, amount}]"""
    with get_db() as db:
        cur = db.execute("INSERT INTO employee_settlement (employee_id) VALUES (?)",(employee_id,))
        sid = cur.lastrowid
        for it in items:
            db.execute("INSERT INTO employee_settlement_items (settlement_id,ref_type,ref_id,item_type,amount) VALUES (?,?,?,?,?)",(sid,it['ref_type'],it['ref_id'],it['item_type'],it['amount']))
        db.commit(); return {'settlement_id':sid}


def settlement_list(employee_id='', date_from='', date_to=''):
    with get_db() as db:
        where,params = [],[]
        if employee_id: where.append("employee_id=?"); params.append(employee_id)
        if date_from: where.append("settle_date>=?"); params.append(date_from)
        if date_to: where.append("settle_date<=?"); params.append(date_to)
        w = " WHERE "+" AND ".join(where) if where else ""
        return [dict(r) for r in db.execute(f"SELECT * FROM employee_settlement{w} ORDER BY id DESC",params).fetchall()]


def settlement_submit(sid):
    with get_db() as db:
        db.execute("UPDATE employee_settlement SET status='submitted' WHERE id=? AND status='pending'",(sid,))
        db.commit()


def settlement_confirm(sid):
    with get_db() as db:
        db.execute("UPDATE employee_settlement SET status='confirmed' WHERE id=?",(sid,))
        db.commit()

# ============================================================
# 报表
# ============================================================


def get_ar_aging():
    with get_db() as db:
        now = datetime.now().strftime("%Y-%m-%d")
        rows = db.execute("SELECT r.*,c.name as contact_name,c.phone FROM receivables r JOIN contacts c ON r.contact_id=c.id WHERE r.type='ar' AND r.status!='paid' AND r.amount>r.paid_amount ORDER BY r.due_date").fetchall()
        aging = {'1_30':[],'31_60':[],'60_plus':[]}
        for r in rows:
            d = dict(r); d['balance'] = d['amount'] - d['paid_amount']
            due = d.get('due_date','') or d.get('created_at','')
            if due:
                days = (datetime.strptime(now,"%Y-%m-%d") - datetime.strptime(due[:10],"%Y-%m-%d")).days
                d['overdue_days'] = max(0, days)
            else: d['overdue_days'] = 0
            if d['overdue_days'] <= 30: aging['1_30'].append(d)
            elif d['overdue_days'] <= 60: aging['31_60'].append(d)
            else: aging['60_plus'].append(d)
        return aging

# bulk_update_prices → db/queries/sales.py

def expense_request_create(contact_id, amount, category, note='', operator_id=''):
    with get_db() as db:
        eid = db.execute("INSERT INTO expense_requests (contact_id,amount,category,note,operator_id,status,created_at) VALUES (?,?,?,?,?,'pending',datetime('now','localtime'))",
                         (contact_id,amount,category,note,operator_id)).lastrowid
        db.commit()
        return eid


def expense_approve(eid, approved=True, approver=''):
    with get_db() as db:
        status = 'approved' if approved else 'rejected'
        db.execute("UPDATE expense_requests SET status=?,approved_by=? WHERE id=?",(status,approver,eid))
        if approved:
            er = db.execute("SELECT * FROM expense_requests WHERE id=?",(eid,)).fetchone()
            if er:
                db.execute("INSERT INTO cash_flow (account,type,amount,contact_id,category,note) VALUES ('现金','expense',?,?,?,?)",
                           (er['amount'],er['contact_id'],er['category'],er['note']))
                db.execute("INSERT INTO expense_orders (order_no,type,contact_id,amount,paid_amount,status,note) VALUES (?,?,?,?,?,?,?)",
                           ('EXP'+datetime.now().strftime('%Y%m%d%H%M%S'),'internal',er['contact_id'],er['amount'],er['amount'],'paid',er['note']))
        db.commit()

# Create expense_requests table + birthday column on contacts
try:
    with get_db() as db:
        db.execute("ALTER TABLE contacts ADD COLUMN birthday TEXT DEFAULT ''")
        db.executescript("CREATE TABLE IF NOT EXISTS expense_requests (id INTEGER PRIMARY KEY AUTOINCREMENT,contact_id INTEGER,amount REAL DEFAULT 0,category TEXT DEFAULT '',note TEXT DEFAULT '',operator_id TEXT DEFAULT '',status TEXT DEFAULT 'pending',approved_by TEXT DEFAULT '',created_at TEXT DEFAULT (datetime('now','localtime')));")
        db.commit()
except Exception as _e:
    import sys; log_migration_warn(_e)

# ============================================================
# v9: 客户门户、产品图片、银行对账、库存盘点
# ============================================================

def bank_import_parse(rows):
    """Parse bank CSV rows and return matched transactions"""
    matched = []
    with get_db() as db:
        for row in rows:
            amount = float(row.get('amount',0))
            date_str = row.get('date','')
            desc = row.get('description','')
            # Try to match by amount + date proximity
            candidates = db.execute("SELECT cf.*,c.name as contact_name FROM cash_flow cf LEFT JOIN contacts c ON cf.contact_id=c.id WHERE ROUND(cf.amount,2)=ROUND(?,2) AND cf.type=? ORDER BY ABS(julianday(cf.created_at)-julianday(?)) LIMIT 3",(abs(amount),'income' if amount>0 else 'expense',date_str)).fetchall()
            matched.append({'row':row,'candidates':[dict(c) for c in candidates]})
    return matched


def bank_confirm_match(cash_flow_id, ref_amount):
    with get_db() as db:
        db.execute("UPDATE cash_flow SET note=note||' [已对账]' WHERE id=?",(cash_flow_id,))
        db.commit()

# stock_take_* → db/queries/inventory.py

# stock_take_update, stock_take_finalize → db/queries/inventory.py


def get_ap_aging():
    now = datetime.now().strftime("%Y-%m-%d")
    with get_db() as db:
        rows = db.execute("SELECT r.*,c.name as contact_name FROM receivables r JOIN contacts c ON r.contact_id=c.id WHERE r.type='ap' AND r.status!='paid' AND r.amount>r.paid_amount ORDER BY r.due_date").fetchall()
        upcoming,due,overdue = [],[],[]
        for r in rows:
            d = dict(r); d['balance'] = d['amount'] - d['paid_amount']
            due_date = d.get('due_date','') or d.get('created_at','')[:10]
            if due_date > now: upcoming.append(d)
            elif due_date == now: due.append(d)
            else: overdue.append(d)
        return {'upcoming':upcoming,'due_today':due,'overdue':overdue}


def invoice_create(sale_order_id, invoice_no, invoice_date, tax_rate=0):
    with get_db() as db:
        iid = db.execute("INSERT INTO invoices (sale_order_id,invoice_no,invoice_date,tax_rate,status) VALUES (?,?,?,?,'issued')",
                         (sale_order_id,invoice_no,invoice_date,tax_rate)).lastrowid
        db.execute("UPDATE sale_orders SET invoice_status='invoiced' WHERE id=?",(sale_order_id,))
        db.commit()
        return iid


def get_message_templates():
    with get_db() as db:
        return [dict(r) for r in db.execute("SELECT * FROM message_templates WHERE is_active=1 ORDER BY id").fetchall()]


def save_message_template(name, content, category=''):
    with get_db() as db:
        tid = db.execute("INSERT INTO message_templates (name,content,category) VALUES (?,?,?)",(name,content,category)).lastrowid
        db.commit()
        return tid

# v12 migrations
try:
    with get_db() as db:
        db.execute("ALTER TABLE products ADD COLUMN large_unit TEXT DEFAULT ''")
        db.execute("ALTER TABLE products ADD COLUMN unit_ratio INTEGER DEFAULT 1")
        db.execute("ALTER TABLE contacts ADD COLUMN region TEXT DEFAULT ''")
        db.execute("ALTER TABLE sale_orders ADD COLUMN invoice_status TEXT DEFAULT ''")
        db.executescript("""
            CREATE TABLE IF NOT EXISTS invoices (id INTEGER PRIMARY KEY AUTOINCREMENT,sale_order_id INTEGER,invoice_no TEXT,invoice_date TEXT,tax_rate REAL DEFAULT 0,status TEXT DEFAULT 'issued',created_at TEXT DEFAULT (datetime('now','localtime')));
            CREATE TABLE IF NOT EXISTS message_templates (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,content TEXT NOT NULL,category TEXT DEFAULT '',is_active INTEGER DEFAULT 1,created_at TEXT DEFAULT (datetime('now','localtime')));
        """)
        if not db.execute("SELECT id FROM message_templates LIMIT 1").fetchone():
            db.execute("INSERT INTO message_templates (name,content,category) VALUES ('催款提醒','【Hergent】{客户名}您好，您有 ¥{金额} 已逾期 {天数} 天，请尽快安排付款。如有疑问请联系我们。','催款')")
            db.execute("INSERT INTO message_templates (name,content,category) VALUES ('生日祝福','【Hergent】{客户名}您好，祝您生日快乐！感谢您一直以来的信任与支持！','祝福')")
            db.execute("INSERT INTO message_templates (name,content,category) VALUES ('对账单通知','【Hergent】{客户名}您好，您的{月份}对账单已生成。本月消费 ¥{金额}，已付 ¥{已付}，请核对。','对账')")
        db.commit()
except Exception as _e:
    import sys; log_migration_warn(_e)

# ============================================================
# v13: 费用预算、产品分类树、交货状态、供应商评估、授信记录、截图
# ============================================================

def rate_supplier(supplier_id, price_rating, delivery_rating, quality_rating, note=''):
    with get_db() as db:
        rid = db.execute("INSERT INTO supplier_ratings (supplier_id,price_rating,delivery_rating,quality_rating,note) VALUES (?,?,?,?,?)",
                         (supplier_id,price_rating,delivery_rating,quality_rating,note)).lastrowid
        db.commit()
        return rid


def get_supplier_ratings(supplier_id=0):
    with get_db() as db:
        w = "WHERE sr.supplier_id="+str(supplier_id) if supplier_id else ""
        rows = db.execute(f"SELECT sr.*,c.name as supplier_name,AVG((sr.price_rating+sr.delivery_rating+sr.quality_rating)/3.0) as avg_rating FROM supplier_ratings sr JOIN contacts c ON sr.supplier_id=c.id {w} GROUP BY sr.supplier_id ORDER BY avg_rating DESC").fetchall()
        return [dict(r) for r in rows]


def get_volume_discounts(product_id=0):
    with get_db() as db:
        w = "WHERE product_id="+str(product_id)+" OR product_id=0" if product_id else ""
        return [dict(r) for r in db.execute(f"SELECT * FROM volume_discounts {w} ORDER BY product_id,min_qty").fetchall()]


def save_volume_discount(product_id, min_qty, discount_pct):
    with get_db() as db:
        did = db.execute("INSERT INTO volume_discounts (product_id,min_qty,discount_pct) VALUES (?,?,?)",(product_id,min_qty,discount_pct)).lastrowid
        db.commit()
        return did


def get_commission_rules():
    with get_db() as db:
        return [dict(r) for r in db.execute("SELECT * FROM commission_rules WHERE is_active=1").fetchall()]


def save_commission_rule(name, rate_pct=0, fixed_amount=0, min_sales=0):
    with get_db() as db:
        cid = db.execute("INSERT INTO commission_rules (name,rate_pct,fixed_amount,min_sales) VALUES (?,?,?,?)",(name,rate_pct,fixed_amount,min_sales)).lastrowid
        db.commit()
        return cid


def get_dashboard_prefs(user_id):
    with get_db() as db:
        r = db.execute("SELECT widgets FROM dashboard_prefs WHERE user_id=?",(user_id,)).fetchone()
        return r['widgets'].split(",") if r else None


def get_rebate_contracts():
    with get_db() as db:
        return [dict(r) for r in db.execute("SELECT rc.*,c.name as contact_name FROM rebate_contracts rc JOIN contacts c ON rc.contact_id=c.id ORDER BY rc.id DESC").fetchall()]


def get_rebate_progress():
    with get_db() as db:
        contracts = get_rebate_contracts()
        for c in contracts:
            actual = db.execute("SELECT COALESCE(SUM(total_amount),0) FROM sale_orders WHERE customer_id=? AND substr(order_date,1,4)=? AND status IN ('delivered','signed')",(c['contact_id'],c['year'])).fetchone()[0]
            c['actual'] = actual; c['progress_pct'] = round(actual/c['target_amount']*100,1) if c['target_amount']>0 else 0
            c['rebate_due'] = actual*c['rebate_pct']/100 if actual>=c['target_amount'] else 0
        return contracts


def get_dashboard_summary(start_date, end_date):
    """Dashboard data for a custom date range"""
    with get_db() as db:
        income = db.execute("SELECT COALESCE(SUM(amount),0) FROM cash_flow WHERE type='income' AND date(created_at)>=? AND date(created_at)<=?",(start_date,end_date)).fetchone()[0]
        expense = db.execute("SELECT COALESCE(SUM(amount),0) FROM cash_flow WHERE type='expense' AND date(created_at)>=? AND date(created_at)<=?",(start_date,end_date)).fetchone()[0]
        sales = db.execute("SELECT COALESCE(SUM(total_amount),0),COUNT(*) FROM sale_orders WHERE date(order_date)>=? AND date(order_date)<=? AND status IN ('delivered','signed')",(start_date,end_date)).fetchone()
        purchases = db.execute("SELECT COALESCE(SUM(total_amount),0),COUNT(*) FROM purchase_orders WHERE date(order_date)>=? AND date(order_date)<=? AND status='confirmed'",(start_date,end_date)).fetchone()
        payments = db.execute("SELECT COALESCE(SUM(amount),0),COUNT(*) FROM cash_flow WHERE type='income' AND date(created_at)>=? AND date(created_at)<=?",(start_date,end_date)).fetchone()
        new_custs = db.execute("SELECT COUNT(*) FROM contacts WHERE type='customer' AND date(created_at)>=? AND date(created_at)<=?",(start_date,end_date)).fetchone()[0]
        # Trend data
        trend_days = (datetime.strptime(end_date,"%Y-%m-%d")-datetime.strptime(start_date,"%Y-%m-%d")).days
        group_by = "date(order_date)" if trend_days<=31 else "substr(order_date,1,7)" if trend_days<=366 else "substr(order_date,1,4)"
        trend = [dict(r) for r in db.execute(f"SELECT {group_by} as period,COALESCE(SUM(total_amount),0) as amount,COUNT(*) as cnt FROM sale_orders WHERE date(order_date)>=? AND date(order_date)<=? AND status IN ('delivered','signed') GROUP BY {group_by} ORDER BY period",(start_date,end_date)).fetchall()]
        top_prods = [dict(r) for r in db.execute("SELECT p.name,SUM(soi.quantity) as qty,SUM(soi.amount) as amt FROM sale_order_items soi JOIN sale_orders so ON soi.order_id=so.id JOIN products p ON soi.product_id=p.id WHERE date(so.order_date)>=? AND date(so.order_date)<=? AND so.status IN ('delivered','signed') GROUP BY p.name ORDER BY amt DESC LIMIT 5",(start_date,end_date)).fetchall()]
        accounts = [dict(r) for r in db.execute("SELECT * FROM accounts").fetchall()]
        return {'income':income,'expense':expense,'sales_total':sales[0],'sales_count':sales[1],'purchase_total':purchases[0],'payments_total':payments[0],'new_customers':new_custs,'profit':sales[0]-expense,'trend':trend,'top_products':top_prods,'accounts':accounts,'start_date':start_date,'end_date':end_date}


def get_dashboard_full():
    """Single API call that returns all dashboard data"""
    from erp_db import get_health_score  # lazy import to avoid circular dependency
    now = datetime.now()
    today = now.strftime("%Y-%m-%d"); month = now.strftime("%Y-%m")
    with get_db() as db:
        # Core dashboard
        today_income = db.execute("SELECT COALESCE(SUM(amount),0) FROM cash_flow WHERE type='income' AND date(created_at)=?",(today,)).fetchone()[0]
        today_expense = db.execute("SELECT COALESCE(SUM(amount),0) FROM cash_flow WHERE type='expense' AND date(created_at)=?",(today,)).fetchone()[0]
        total_ar = db.execute("SELECT COALESCE(SUM(amount-paid_amount),0) FROM receivables WHERE type='ar' AND status!='paid'").fetchone()[0]
        total_ap = db.execute("SELECT COALESCE(SUM(amount-paid_amount),0) FROM receivables WHERE type='ap' AND status!='paid'").fetchone()[0]
        accounts = [dict(r) for r in db.execute("SELECT * FROM accounts").fetchall()]
        cash = sum(a['current_balance'] for a in accounts)
        # Health & anomalies
        health = get_health_score()
        # AR aging (summary only - top 5)
        ar_rows = db.execute("SELECT r.*,c.name as contact_name FROM receivables r JOIN contacts c ON r.contact_id=c.id WHERE r.type='ar' AND r.status!='paid' AND r.amount>r.paid_amount ORDER BY r.due_date LIMIT 10").fetchall()
        ar_list = []; top_ar_balance = 0
        for r in ar_rows:
            d = dict(r); d['balance'] = d['amount'] - d['paid_amount']; top_ar_balance += d['balance']
            d['overdue_days'] = max(0,(datetime.strptime(today,"%Y-%m-%d")-datetime.strptime((d.get('due_date') or today)[:10],"%Y-%m-%d")).days)
            ar_list.append(d)
        # Anomalies
        anomalies = get_anomalies()
        # Low stock count
        low_stock = db.execute("SELECT COUNT(*) FROM inventory i JOIN products p ON i.product_id=p.id WHERE i.quantity<=p.safety_stock AND p.safety_stock>0").fetchone()[0]
        # Pending approvals
        pending_count = db.execute("SELECT COUNT(*) FROM sale_orders WHERE approval_status='pending'").fetchone()[0]
        pending_orders = [dict(r) for r in db.execute("SELECT so.*,c.name as customer_name FROM sale_orders so JOIN contacts c ON so.customer_id=c.id WHERE so.approval_status='pending' ORDER BY so.id DESC LIMIT 5").fetchall()]
        # Activity feed
        recent_orders = [dict(r) for r in db.execute("SELECT so.*,c.name as customer_name FROM sale_orders so JOIN contacts c ON so.customer_id=c.id ORDER BY so.id DESC LIMIT 5").fetchall()]
        recent_payments = [dict(r) for r in db.execute("SELECT cf.*,c.name as contact_name FROM cash_flow cf LEFT JOIN contacts c ON cf.contact_id=c.id ORDER BY cf.id DESC LIMIT 3").fetchall()]
        # AI insights
        income = today_income; expense = today_expense
        insights = []
        if income>expense*1.5: insights.append('📈 今日收入远超支出，经营状况良好')
        elif expense>income: insights.append('⚠️ 今日支出超过收入')
        if total_ar>50000: insights.append('🔴 应收总额偏高，建议加快回款')
        if low_stock>0: insights.append('📦 有'+str(low_stock)+'个商品低于安全库存')
        # Birthdays
        birthdays = [dict(r) for r in db.execute("SELECT * FROM contacts WHERE type='customer' AND birthday LIKE ?",(f"%{now.strftime('%m-%d')}",)).fetchall()]
        # Expiry
        expiring = db.execute("SELECT COUNT(*) FROM inventory WHERE expiry_date!='' AND quantity>0 AND date(expiry_date)<=date('now','+30 days') AND date(expiry_date)>=date('now')").fetchone()[0]
        # Churn
        churn = db.execute("SELECT COUNT(*) FROM contacts c WHERE c.type='customer' AND c.is_active=1 AND (SELECT MAX(order_date) FROM sale_orders WHERE customer_id=c.id)<date('now','-30 days')").fetchone()[0]
        # YoY
        this_m = db.execute("SELECT COALESCE(SUM(total_amount),0) FROM sale_orders WHERE substr(order_date,1,7)=? AND status IN ('delivered','signed')",(month,)).fetchone()[0]
        last_m = db.execute("SELECT COALESCE(SUM(total_amount),0) FROM sale_orders WHERE substr(order_date,1,7)=? AND status IN ('delivered','signed')",((now.replace(day=1)-timedelta(days=1)).strftime("%Y-%m"),)).fetchone()[0]
        last_y = db.execute("SELECT COALESCE(SUM(total_amount),0) FROM sale_orders WHERE substr(order_date,1,7)=? AND status IN ('delivered','signed')",(now.replace(year=now.year-1).strftime("%Y-%m"),)).fetchone()[0]
        # Credit util
        cred_custs = db.execute("SELECT * FROM contacts WHERE type='customer' AND credit_limit>0 AND is_active=1").fetchall()
        cred_list = []
        for c in cred_custs:
            cd = dict(c); used = db.execute("SELECT COALESCE(SUM(amount-paid_amount),0) FROM receivables WHERE contact_id=? AND type='ar' AND status!='paid'",(cd['id'],)).fetchone()[0]
            cd['used']=used; cd['util_pct']=round(used/cd['credit_limit']*100) if cd['credit_limit']>0 else 0; cred_list.append(cd)
        total_cred_limit = sum(c['credit_limit'] for c in cred_list); total_cred_used = sum(c['used'] for c in cred_list)
        # Leaderboard
        ldr = get_sales_leaderboard(month)
        # Budget
        budgets = [dict(r) for r in db.execute("SELECT * FROM expense_budgets WHERE month=?",(month,)).fetchall()]
        for b in budgets:
            actual = db.execute("SELECT COALESCE(SUM(eo.amount),0) FROM expense_orders eo JOIN expense_categories ec ON eo.category_id=ec.id WHERE ec.name=? AND substr(eo.order_date,1,7)=?",(b['category_name'],month)).fetchone()[0]
            b['actual']=actual; b['usage_pct']=round(actual/b['amount']*100,1) if b['amount']>0 else 0
        # Delivery
        delivered = db.execute("SELECT COUNT(*) FROM sale_orders WHERE driver_id!='' AND status='delivered'").fetchone()[0]
        pending_delivery = db.execute("SELECT COUNT(*) FROM sale_orders WHERE status='draft'").fetchone()[0]

    return {
        'dashboard':{'today_income':today_income,'today_expense':today_expense,'total_ar':total_ar,'total_ap':total_ap,'accounts':accounts,'cash':cash},
        'health':health,'anomalies':anomalies,'low_stock':low_stock,
        'ar_aging':ar_list,'top_ar_balance':top_ar_balance,
        'pending_approvals':{'count':pending_count,'orders':pending_orders},
        'activity':{'orders':recent_orders,'payments':recent_payments},
        'insights':insights,'birthdays':birthdays,'expiring_count':expiring,'churn_count':churn,
        'yoy':{'this_month':this_m,'last_month':last_m,'last_year':last_y,'mom_pct':round((this_m-last_m)/(last_m+1)*100),'yoy_pct':round((this_m-last_y)/(last_y+1)*100)},
        'credit':{'customers':sorted(cred_list,key=lambda x: x['util_pct'],reverse=True)[:6],'total_limit':total_cred_limit,'total_used':total_cred_used,'total_pct':round(total_cred_used/(total_cred_limit+1)*100)},
        'leaderboard':ldr,'budgets':budgets,'delivery':{'in_transit':delivered,'pending':pending_delivery}
    }


def period_close(month=""):
    if not month: month = datetime.now().strftime("%Y-%m")
    with get_db() as db:
        # Check if already closed
        if db.execute("SELECT month FROM period_closures WHERE month=?",(month,)).fetchone():
            return {"error":"该期间已结转"}
        # Sum income/expense accounts and transfer to 本年利润
        income = db.execute("SELECT COALESCE(SUM(credit-debit),0) FROM journal_entries WHERE account_code LIKE '6%' AND substr(date,1,7)=?",(month,)).fetchone()[0]
        expense = db.execute("SELECT COALESCE(SUM(debit-credit),0) FROM journal_entries WHERE account_code LIKE '6[4-9]%' AND substr(date,1,7)=?",(month,)).fetchone()[0]
        profit = income - expense
        # Generate closing entry
        vno = generate_journal_entry("closing",0,month+"-28",[
            {"code":"6001","name":"主营业务收入","debit":income,"credit":0,"summary":"结转收入"},
            {"code":"4103","name":"本年利润","debit":0,"credit":income,"summary":"结转收入"},
            {"code":"4103","name":"本年利润","debit":expense,"credit":0,"summary":"结转费用"},
            {"code":"6401","name":"主营业务成本","debit":0,"credit":expense,"summary":"结转成本"},
        ],"")
        # Also close expense accounts
        db.execute("INSERT INTO period_closures (month,profit,status) VALUES (?,?,?)",(month,profit,"closed"))
        db.commit()
        return {"voucher_no":vno,"profit":profit,"month":month}

# v28 migrations
try:
    with get_db() as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS journal_entries (id INTEGER PRIMARY KEY AUTOINCREMENT,voucher_no TEXT,date TEXT,account_code TEXT,account_name TEXT,debit REAL DEFAULT 0,credit REAL DEFAULT 0,ref_type TEXT,ref_id INTEGER,summary TEXT,operator_id TEXT,created_at TEXT DEFAULT (datetime('now','localtime')));
            CREATE TABLE IF NOT EXISTS period_closures (month TEXT PRIMARY KEY,profit REAL,status TEXT,created_at TEXT DEFAULT (datetime('now','localtime')));
        """)
        db.commit()
    # ⚠️ 2026-09-12 移除本行的 init_coa() 调用：它**从来不可能成功**。
    #    本模块在 erp_db.py 第 52 行被导入，而 init_coa 定义在 erp_db.py 第 3943 行 ——
    #    此刻 erp_db 尚未执行到那里，`init_coa` 这个名字还没被定义 → NameError，
    #    被下面的 except 吞掉，每次启动只留一行
    #    `[MIGRATION WARN] name 'init_coa' is not defined`。
    #    （即使改成模块内延迟 import 也不成立：`from erp_db import init_coa` 会因
    #      erp_db 处于「部分初始化」而抛 ImportError，同样被吞。）
    #    该调用已移到 erp_db.py 中 init_coa 定义之后，那里才是能执行到的位置。
except Exception as _e:
    import sys; log_migration_warn(_e)


# ============================================================
# v29: 自动凭证、会计期间、现金流量直接法、财务指标、催款、利润排行
# ============================================================

# Auto-generate journal entries for business transactions

def get_cashflow_direct(month=""):
    if not month: month = datetime.now().strftime("%Y-%m")
    with get_db() as db:
        sales_collection = db.execute("SELECT COALESCE(SUM(amount),0) FROM cash_flow WHERE type='income' AND substr(created_at,1,7)=?",(month,)).fetchone()[0]
        purchase_payment = db.execute("SELECT COALESCE(SUM(amount),0) FROM cash_flow WHERE type='expense' AND category='采购' AND substr(created_at,1,7)=?",(month,)).fetchone()[0]
        expense_payment = db.execute("SELECT COALESCE(SUM(amount),0) FROM cash_flow WHERE type='expense' AND category!='采购' AND substr(created_at,1,7)=?",(month,)).fetchone()[0]
        salary_payment = db.execute("SELECT COALESCE(SUM(amount),0) FROM cash_flow WHERE category='工资' AND substr(created_at,1,7)=?",(month,)).fetchone()[0]
        tax_payment = db.execute("SELECT COALESCE(SUM(amount),0) FROM cash_flow WHERE category='税费' AND substr(created_at,1,7)=?",(month,)).fetchone()[0]
        operating_in = sales_collection
        operating_out = purchase_payment + expense_payment + salary_payment + tax_payment
        return {"operating_in":operating_in,"operating_out":operating_out,"operating_net":operating_in-operating_out,"sales_collection":sales_collection,"purchase_payment":purchase_payment,"expense_payment":expense_payment,"salary_payment":salary_payment,"tax_payment":tax_payment}

def get_cashflow_indirect(month=""):
    """Indirect method cash flow statement: start from net profit, adjust for non-cash items
    and working capital changes to arrive at operating cash flow."""
    if not month: month = datetime.now().strftime("%Y-%m")
    from erp_db import get_account_codes_by_category
    with get_db() as db:
        # 1. Net profit (from P&L GL)
        pnl = get_pnl_gl(month)
        net_profit = pnl.get("net_profit", 0)

        # 2. Adjust for non-cash items: depreciation
        dep_dr = db.execute(
            "SELECT COALESCE(SUM(debit),0) FROM journal_entries WHERE ref_type='depreciation' AND substr(date,1,7)=?",
            (month,)
        ).fetchone()[0]
        # Bad debt provision
        bad_debt = db.execute(
            "SELECT COALESCE(SUM(debit),0) FROM journal_entries WHERE ref_type='bad_debt' AND substr(date,1,7)=?",
            (month,)
        ).fetchone()[0]
        # FX gain/loss
        fx_sum = db.execute(
            "SELECT COALESCE(SUM(credit)-SUM(debit),0) FROM journal_entries WHERE ref_type='fx_reval' AND substr(date,1,7)=?",
            (month,)
        ).fetchone()[0]

        # 3. Working capital changes: AR, inventory, AP
        prev_month_end = (datetime.strptime(month+"-01","%Y-%m-%d") - timedelta(days=1)).strftime("%Y-%m-%d")
        month_end = (datetime.strptime(month+"-01","%Y-%m-%d") + timedelta(days=32)).strftime("%Y-%m-01")
        month_end = (datetime.strptime(month_end,"%Y-%m-%d") - timedelta(days=1)).strftime("%Y-%m-%d")

        def net_balance(codes, as_of):
            if not codes: return 0
            ph = ",".join("?"*len(codes))
            r = db.execute(f"SELECT COALESCE(SUM(debit)-SUM(credit),0) FROM journal_entries WHERE account_code IN ({ph}) AND date<=?", codes+[as_of]).fetchone()
            return r[0] if r else 0

        asset_codes = get_account_codes_by_category("资产")
        liability_codes = get_account_codes_by_category("负债")

        ar_change = net_balance(asset_codes, month_end) - net_balance(asset_codes, prev_month_end)
        # Inventory change (approximate from non-AR assets)
        inv_change = 0  # Simplified — more precise calc would isolate inventory codes
        ap_change = -net_balance(liability_codes, month_end) + net_balance(liability_codes, prev_month_end)

        # 4. Operating cash flow
        operating_cf = round(net_profit + dep_dr + bad_debt + fx_sum - ar_change - inv_change + ap_change, 2)

        # 5. Investing: fixed asset purchases
        investing_out = db.execute(
            "SELECT COALESCE(SUM(purchase_price),0) FROM fixed_assets WHERE substr(purchase_date,1,7)=?",
            (month,)
        ).fetchone()[0]
        # Asset sale proceeds
        asset_sale_in = db.execute(
            "SELECT COALESCE(SUM(credit),0) FROM journal_entries WHERE ref_type='asset_disposal' AND substr(date,1,7)=? AND account_code='1002'",
            (month,)
        ).fetchone()[0]
        investing_cf = round(asset_sale_in - investing_out, 2)

        # 6. Financing: simplified (capital changes)
        equity_codes = get_account_codes_by_category("权益")
        equity_change = net_balance(equity_codes, month_end) - net_balance(equity_codes, prev_month_end)
        financing_cf = round(equity_change, 2)

        net_change = round(operating_cf + investing_cf + financing_cf, 2)

        return {
            "month": month, "basis": "indirect",
            "operating": {
                "net_profit": net_profit,
                "depreciation": dep_dr,
                "bad_debt": bad_debt,
                "fx_gain_loss": fx_sum,
                "ar_change": round(-ar_change, 2),
                "ap_change": round(ap_change, 2),
                "net": operating_cf
            },
            "investing": {
                "asset_purchase": -investing_out,
                "asset_sale": asset_sale_in,
                "net": investing_cf
            },
            "financing": {
                "capital_change": equity_change,
                "net": financing_cf
            },
            "net_change": net_change
        }

# Financial ratios

def get_payment_terms():
    with get_db() as db:
        return [dict(r) for r in db.execute("SELECT * FROM payment_terms WHERE is_active=1 ORDER BY id").fetchall()]


def save_payment_term(name, days, description=""):
    with get_db() as db:
        tid = db.execute("INSERT INTO payment_terms (name,days,description) VALUES (?,?,?)",(name,days,description)).lastrowid
        db.commit(); return tid


def get_supplier_scorecard(supplier_id=0):
    with get_db() as db:
        w = "WHERE c.type='supplier'" + (" AND c.id="+str(supplier_id)) if supplier_id else ""
        suppliers = [dict(r) for r in db.execute(f"SELECT c.* FROM contacts c {w} AND c.is_active=1").fetchall()]
        for s in suppliers:
            sid = s["id"]
            ratings = db.execute("SELECT AVG(price_rating) as pr,AVG(delivery_rating) as dr,AVG(quality_rating) as qr,COUNT(*) as cnt FROM supplier_ratings WHERE supplier_id=?",(sid,)).fetchone()
            s["price_score"] = round(ratings[0] or 0,1); s["delivery_score"] = round(ratings[1] or 0,1); s["quality_score"] = round(ratings[2] or 0,1); s["rating_count"] = ratings[3]
            s["overall"] = round((s["price_score"]+s["delivery_score"]+s["quality_score"])/3,1)
            # Purchase stats
            po_stats = db.execute("SELECT COUNT(*),COALESCE(SUM(total_amount),0) FROM purchase_orders WHERE supplier_id=? AND status='confirmed'",(sid,)).fetchone()
            s["po_count"] = po_stats[0]; s["po_total"] = po_stats[1]
        return sorted(suppliers, key=lambda x: x["overall"], reverse=True)


def get_price_schemes():
    with get_db() as db:
        return [dict(r) for r in db.execute("SELECT * FROM price_schemes WHERE is_active=1").fetchall()]

def save_price_scheme(name, margin_pct=0, description=""):
    with get_db() as db:
        pid = db.execute("INSERT INTO price_schemes (name,margin_pct,description) VALUES (?,?,?)",(name,margin_pct,description)).lastrowid
        db.commit(); return pid

# Credit control schemes

def get_credit_schemes():
    with get_db() as db:
        return [dict(r) for r in db.execute("SELECT * FROM credit_control_schemes WHERE is_active=1").fetchall()]

def save_credit_scheme(name, credit_limit=0, credit_days=0, freeze_days=30):
    with get_db() as db:
        cid = db.execute("INSERT INTO credit_control_schemes (name,credit_limit,credit_days,freeze_days) VALUES (?,?,?,?)",(name,credit_limit,credit_days,freeze_days)).lastrowid
        db.commit(); return cid

# Unit archive

def bank_statement_create(bank_account_id, statement_date, opening_balance, closing_balance):
    with get_db() as db:
        cur = db.execute("INSERT INTO bank_statements(bank_account_id,statement_date,opening_balance,closing_balance) VALUES(?,?,?,?)", (bank_account_id,statement_date,opening_balance,closing_balance))
        db.commit(); return cur.lastrowid


def bank_statement_list(bank_account_id=0):
    with get_db() as db:
        if bank_account_id:
            rows = db.execute("SELECT * FROM bank_statements WHERE bank_account_id=? ORDER BY statement_date DESC", (bank_account_id,)).fetchall()
        else:
            rows = db.execute("SELECT * FROM bank_statements ORDER BY statement_date DESC").fetchall()
        return [dict(r) for r in rows]


def bank_transaction_create(statement_id, trans_date, description, amount, trans_type):
    with get_db() as db:
        cur = db.execute("INSERT INTO bank_transactions(statement_id,trans_date,description,amount,trans_type) VALUES(?,?,?,?,?)", (statement_id,trans_date,description,amount,trans_type))
        db.commit(); return cur.lastrowid


def bank_transaction_list(statement_id):
    with get_db() as db:
        rows = db.execute("SELECT * FROM bank_transactions WHERE statement_id=? ORDER BY trans_date", (statement_id,)).fetchall()
        return [dict(r) for r in rows]


def bank_transaction_match(tid, ref_type, ref_id):
    with get_db() as db:
        db.execute("UPDATE bank_transactions SET matched_ref_type=?,matched_ref_id=?,match_status='matched' WHERE id=?", (ref_type,ref_id,tid))
        db.commit()


def bank_transaction_unmatch(tid):
    with get_db() as db:
        db.execute("UPDATE bank_transactions SET matched_ref_type=NULL,matched_ref_id=NULL,match_status='unmatched' WHERE id=?", (tid,))
        db.commit()


def _days_apart(a, b):
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
    with get_db() as db:
        txns = [dict(r) for r in db.execute("SELECT * FROM bank_transactions WHERE statement_id=? AND match_status='unmatched'", (statement_id,)).fetchall()]
        payments = [dict(r) for r in db.execute("SELECT * FROM cash_flow WHERE note NOT LIKE '%[已对账]%' ORDER BY created_at").fetchall()]
        matched = 0
        for txn in txns:
            for pmt in payments:
                if money_eq(abs(txn['amount'] or 0), abs(pmt['amount'] or 0)) and _days_apart(txn['trans_date'], pmt['created_at']) <= 3:
                    db.execute("UPDATE bank_transactions SET matched_ref_type='payment',matched_ref_id=?,match_status='matched' WHERE id=?", (pmt['id'],txn['id']))
                    db.execute("UPDATE cash_flow SET note=COALESCE(note,'')||' [已对账]' WHERE id=?", (pmt['id'],))
                    matched += 1; break
        db.commit(); return {"matched":matched,"total":len(txns)}

# ===== Multi-Currency =====

def currency_list():
    with get_db() as db:
        rows = db.execute("SELECT * FROM currencies WHERE is_active=1 ORDER BY code").fetchall()
        return [dict(r) for r in rows]


def currency_create(code, name, symbol, decimal_places=2):
    with get_db() as db:
        db.execute("INSERT OR REPLACE INTO currencies(code,name,symbol,decimal_places) VALUES(?,?,?,?)", (code.upper(),name,symbol,decimal_places))
        db.commit()


def exchange_rate_set(from_currency, to_currency, rate, effective_date):
    with get_db() as db:
        db.execute("INSERT OR REPLACE INTO exchange_rates(from_currency,to_currency,rate,effective_date) VALUES(?,?,?,?)", (from_currency.upper(),to_currency.upper(),rate,effective_date))
        db.commit()


def exchange_rate_get(from_currency, to_currency, date=None):
    with get_db() as db:
        if date:
            row = db.execute("SELECT rate FROM exchange_rates WHERE from_currency=? AND to_currency=? AND effective_date<=? ORDER BY effective_date DESC LIMIT 1", (from_currency.upper(),to_currency.upper(),date)).fetchone()
        else:
            row = db.execute("SELECT rate FROM exchange_rates WHERE from_currency=? AND to_currency=? ORDER BY effective_date DESC LIMIT 1", (from_currency.upper(),to_currency.upper())).fetchone()
        return row['rate'] if row else None


def exchange_rate_list():
    with get_db() as db:
        rows = db.execute("SELECT * FROM exchange_rates ORDER BY effective_date DESC LIMIT 50").fetchall()
        return [dict(r) for r in rows]

# ===== Multi-Level Approval Workflow =====

# ===== Message Center 写端收敛（v166, 2026-09-14）=====
# 现象（生产 tenant_1 实测）：message_center 21,293 行里 99.8% 是「库存预警 / 应收逾期提醒」
# 两类，同一标题同一天最多 1,447 行（旧版每分钟无条件跑），且 is_read 恒为 0（没人读）。
# 根因：本函数原是裸 INSERT —— 同一件事每扫描一次就新增一行 → 告警疲劳把真信号淹掉。
# 收敛口径：同一 (title, msg_type, recipients) 在 MESSAGE_DEDUP_WINDOW 秒内**只保留一行**，
# 重复触发只累加 dup_count 并刷新 content/last_at —— 把流水收敛成「一句话 + 触发次数」。
# 为什么去重键**不含 content**：预警正文里带数量/金额，逐次都在变（「仅剩3件」→「仅剩2件」），
# 拿正文做签名等于没去重。
# 为什么去重键**含 recipients**：工资条靠它区分员工（salary_send.py 传 employee_id），
# 不含会把全员工资条折叠成一条。
MESSAGE_DEDUP_WINDOW = 86400

# 标题里所有「日期形态」的片段 —— 归一化时一律抹掉。**顺序敏感**（带「日」的先跑）。
_EVENT_KEY_DATE_RES = (
    re.compile(r"\d{4}-\d{2}-\d{2}"),           # 2026-09-13
    re.compile(r"\d{1,2}月\d{1,2}日"),           # 09月13日 / 9月3日
    re.compile(r"\d{1,2}月\d{1,2}(?![\d月])"),    # 8月20 —— 口语写法（省略「日」），
)                                               # 实测来自「8月20报单-8月24到货」


def norm_event_key(title):
    """把动态标题归一成稳定的「事件类型」键 —— 前端的按类静音 / 频率 / 暂停都挂在它上面。

    为什么不能拿 title 本身当键：标题里带日期，同一种通知每天都长不一样 ——
      `09月13日盈亏快报` / `盈亏快报 · 2026-09-13` / `08月20日 厂家付款 2026-08-20~2026-08-22`
    → 按标题做静音规则**永远会漏**（用户静音了昨天那条，今天这条照样进来）。

    为什么归一化只在后端实现：前端再写一份「标题 → 类型」的映射表就是同一规则的
    第二份拷贝，必然漂移。前端只消费返回值、不自算。
    """
    s = (title or "").strip()
    for _p in _EVENT_KEY_DATE_RES:
        s = _p.sub("", s)
    s = re.sub(r"\s*[~～]\s*-?\s*", "-", s)      # `2026-08-20~2026-08-22` 抹掉日期后的残渣
    s = re.sub(r"\s*[·・]\s*(?=[·・])", "", s)   # 连续分隔符塌成一个
    s = re.sub(r"\s*[-—]\s*$", "", s)
    s = re.sub(r"\s+", " ", s)
    s = s.strip(" ·-—\u3000")
    return s or (title or "").strip()


# ============================================================
# v330（2026-09-29）通知受众（audience）—— 「这条通知该给谁看」的**唯一规则表**
# ============================================================
# 病根（2026-09-29 生产实测）：`message_center` 原先只有「人级定向」`recipients`，
# 而**空值被当作广播（全租户可见）**。这在「只有老板用 Web 工作台」时无害；
# 但 v318 把同一个接口接到了**小程序**（销售每天必开）⇒ 销售直接看到老板的经营告警。
#   租户 1 共 21,352 条，销售账号 **可见 21,351 条 = 100.0%**，
#   其中 99.7% 是「库存预警 + 应收逾期提醒」，正文含**客户名与欠款金额**
#   （实测第一条：「永辉民发店(¥177,014)…逾期总额 ¥1,315,656」）。
#
# 两轴（判定顺序 = 从窄到宽，实现见 `message_visible()`）：
#   ① `recipients` 非空 ⇒ **只给这些人**（人级定向，最精确）：催报 / 工资条 / 定时任务结果
#   ② `recipients` 为空 ⇒ 按**事件类型**查本表 ⇒ 当前用户的**角色**是否在受众里
#   ③ 查不到（新事件忘了登记）⇒ `DEFAULT_AUDIENCE` ——
#      **fail-closed 对业务员，但对老板绝不隐藏**（老板必须能看到全部，绝不能"少给他东西"）。
#
# 🔴 三条纪律：
#   1. **本表是唯一实现**。读端（`routers/messages.py`）必须调 `message_visible()`，
#      **不许自己再写一份角色判断**（两份必然漂移；本项目已踩过同类）。
#   2. **前缀规则按长度降序**（`_AUDIENCE_PREFIX` 构造时已排序）—— 首个命中即停，
#      顺序错了会让「库存预警」抢走「库存预警·紧急」。
#   3. 新增通知类型时**必须同步登记本表**，否则它落到 DEFAULT（只有管理端能看到）。
AUDIENCE_ALL = "*"                    # 真正的全租户广播（目前无使用方，留给"系统维护"类）
DEFAULT_AUDIENCE = "admin,boss"       # 未登记事件 ⇒ 只给管理端

# 事件键 → 受众（角色标签，逗号分隔；角色清单见 core._DEFAULT_PERMS）
_AUDIENCE_EXACT = {
    # —— 经营结果 / 钱的账：老板 ＋ 会计 ——
    "盈亏快报": "admin,boss,accountant",
    "经营日报": "admin,boss,accountant",
    "经营卡简报": "admin,boss,accountant",
    "应收逾期提醒": "admin,boss,accountant",
    "异常支出预警": "admin,boss,accountant",
    "合同到期提醒": "admin,boss,accountant",
    # —— 经营洞察：只给管理端（是"给我看的结论"，不是待办）——
    "AI 经营洞察": "admin,boss",
    "今日经营洞察": "admin,boss",
    "档案健康检查": "admin,boss",
    # —— 客户流失：业务线要跟进（不含金额）——
    "客户流失预警": "admin,boss,sales,supervisor",
    # —— 执行面：管理端 ＋ 主管 ＋ 店员（要有人去动手）——
    "库存预警": "admin,boss,accountant,supervisor,staff",
    "效期预警·紧急": "admin,boss,accountant,supervisor,staff",
    "效期预警·提醒": "admin,boss,accountant,supervisor,staff",
    # —— 报单线：按「谁该看」分三类，**不许用一个前缀一锅端**（v774 / v775）——
    #    ① 面向全体报单人的广播（期次开放 / 新期次 / 加单减单）⇒ 含 `guide`。
    #       受众覆盖 `sales/staff/distributor/supervisor/guide` 五个报单角色 ——
    #       它们正是 `core.ROLE_LOGIN_SCOPE` 里能在小程序登录的角色
    #       （`staff/distributor/sales/guide`=mini、`supervisor`=both）。
    #       v773（2026-11-05）补 `guide`：v330 收口受众时导购还是 `web` 端，
    #       v333 才收紧成 `mini`（老板原话「导购报单要用小程序」）—— 两条改动没对上，
    #       结果生产 5 个在职导购里 3 个在 21,704 条通知中**可见 0 条**（含马耀秀）。
    #       经营结果 / 账务 / 洞察类一概不动 —— 那些正文含客户名与欠款金额，
    #       放开就是重演 v330 修掉的泄密。
    #    ② 定向催单 `forecast_remind_emp_<id>`：落库带 `recipients=<账号id>`，
    #       `message_visible` 定向优先 ⇒ 受众表根本不参与判定，写 guide 纯属冗余。
    #    ②b v776（D 方案）`forecast_remind_ext_<uid>`：`report_mapping` 里
    #       `employee_id=0` 但有 `external_user_id` 的 5 个分销商单元（唐成等），
    #       写端按外部账号**人级定向**，正文只列他自己的单元、不带本期总金额。
    #       同样带 `recipients` ⇒ 受众表不参与；登记管理链只为异常态兜底。
    #    ③ 管理兜底广播（v775 起独立 event_key `forecast_reminder_unbound`）：
    #       未绑定负责人 / 账号停用的单元，写端发 `recipients=''`，正文含
    #       **别人的单元名 ＋ 本期订量/金额**（生产实测「唐成」11 条）。
    #       只给管理链 `admin,boss,supervisor` —— 一线/外部角色看到金额就是泄密。
    #    🔴 v773 一锅端补 guide ⇒ 导购 0→31（其中 11 条兜底广播）；v774 只撤 3 条
    #       催单规则 ⇒ 31→20；v775（B 方案）从**写端**拆出独立 event_key，把兜底
    #       广播连同历史存量行一并收窄到管理链。旧 `预报催单` 精确/前缀键**只为
    #       存量 11 行保留**（写端已不再生成），受众必须和 ③ 一模一样 ——
    #       两处漂移 = 同一类通知两套口径，历史行会悄悄漏给一线角色。
    #    🔴 纪律：同一 event_key 前缀不许同时服务「定向」与「管理兜底」两种意图。
    #       漏给与错发是同一枚硬币的两面，都静默零报错。
    "本期报单已开放": "admin,boss,sales,supervisor,distributor,staff,guide",
    "预报催单": "admin,boss,supervisor",                   # 存量行兜底，见 ③
    "预报·新期次": "admin,boss,sales,supervisor,distributor,staff,guide",
    "forecast_reminder_unbound": "admin,boss,supervisor",  # v775 管理兜底（新行）
}

# 前缀规则（动态键：`定时任务·<原名>` / `forecast_remind_emp_<id>` …）
# ⚠️ v352 起「经营卡简报」的新行**走上面的 _AUDIENCE_EXACT 精确键**（不再带租户名后缀）；
#    这里保留它的前缀项**只为存量行** —— 2026-10-01 之前落库的行事件键形如
#    `经营卡简报 · <租户名>`（标题拼了租户名后被 norm_event_key 现算出来的）。
#    删掉前缀项 = 那些历史行会掉进 DEFAULT_AUDIENCE（业务员收不到、管理端也多看）。
_AUDIENCE_PREFIX_RAW = {
    "定时任务·": "admin,boss",                       # 兜底；正常靠 recipients 定向给创建者
    "经营卡简报": "admin,boss,accountant",           # v352：仅服务存量行（新行走精确键）
    "预报·新期次": "admin,boss,sales,supervisor,distributor,staff,guide",
    # v775：`预报催单` 前缀**只服务存量 11 行**兜底广播（`预报催单 · 报单期次`），
    #   写端已改用独立 event_key ⇒ 受众必须与 `_AUDIENCE_EXACT` 的新键一致（管理链），
    #   否则同一批历史行与未来行两套口径。护栏 ㊾ 有「两键受众相同」判据。
    "预报催单": "admin,boss,supervisor",
    # 定向催单：recipients 非空走定向优先，受众表不参与；保留原六角色作异常态兜底。
    "forecast_remind_emp_": "admin,boss,sales,supervisor,distributor,staff",
    # v776（D 方案）：外部报单账号的定向催单。始终带 `recipients`（定向优先），
    #   这里登记管理链**只作异常态兜底** —— 万一 recipients 丢失，也不能落 DEFAULT
    #   把「别人的单元名」广播出去，更不能含一线/外部角色。
    #   🔴 与写端 `scheduler.FORECAST_REMIND_EXT_PREFIX` 同名，护栏 ㊾ 有判据。
    "forecast_remind_ext_": "admin,boss,supervisor",
    "forecast_period_open_": "admin,boss,sales,supervisor,distributor,staff,guide",
    "forecast_extra_alloc": "admin,boss,sales,supervisor,distributor,staff,guide",
}
# 🔴 长前缀优先（首个命中即停 ⇒ 必须最具体的排前面）
_AUDIENCE_PREFIX = sorted(_AUDIENCE_PREFIX_RAW.items(), key=lambda kv: -len(kv[0]))


def audience_for_event(event_key):
    """事件键 → 受众（逗号分隔角色标签，或 `*`）。未登记 ⇒ `DEFAULT_AUDIENCE`。"""
    k = (event_key or "").strip()
    if not k:
        return DEFAULT_AUDIENCE
    v = _AUDIENCE_EXACT.get(k)
    if v:
        return v
    for pref, aud in _AUDIENCE_PREFIX:
        if k.startswith(pref):
            return aud
    return DEFAULT_AUDIENCE


def roles_in_audience(roles, audience):
    """用户**任一**角色在受众里即通过。`*` = 全租户；空受众 = 谁都不给（fail-closed）。

    🔴 传**全部角色**（`core.user_roles(u)` = 主角色 ＋ 兼任），不是 `users.role` 单值 ——
       v266 起角色可叠加且"只有权限裁决取并集"，只认主角色会让兼任主管的销售
       收不到主管该收的通知（静默少给）。
    """
    aud = (audience or "").strip()
    if not aud:
        return False
    if aud == AUDIENCE_ALL:
        return True
    bag = "," + aud.replace(" ", "") + ","
    return any(("," + str(r or "").strip() + ",") in bag for r in (roles or []))


def message_visible(title, event_key, recipients, roles, user_ids):
    """**「这条通知该不该给这个人看」的唯一实现**（读端必须调它）。

    `roles` = 该用户全部角色；`user_ids` = `{str(id), str(username)}`
    （写端口径历史不统一，两种都认）。

    🔴 定向优先：`recipients` 非空时**只看它**，不再叠加角色 ——
       否则"给某人"的定向通知会因为角色恰好也在受众里而漏给别人。
    """
    rc = str(recipients or "").strip()
    if rc:
        return rc in user_ids
    ek = (event_key or "").strip() or norm_event_key(title)
    return roles_in_audience(roles, audience_for_event(ek))


def audience_of_row(title, event_key):
    """给出某行**实际生效的受众**（供 API 透出与排查用；不改数据）。"""
    ek = (event_key or "").strip() or norm_event_key(title)
    return audience_for_event(ek)


def message_send(title, content, msg_type="notice", sender="系统", recipients="",
                 dedup_window=None, event_key=None):
    """写一条通知，同一件事在窗口内重复触发时**不新增行**而是累加 dup_count。

    返回落库行 id。`dedup_window=0` 关闭去重（逐条落库，仅用于确实要逐条留痕的场景）。

    `event_key` = 稳定的「事件类型」键（前端静音规则的主键）。不传则由
    `norm_event_key(title)` 自动归一 —— 保证 `09月13日盈亏快报` 与
    `盈亏快报 · 2026-09-13` 落到同一个键上。

    **受众**（2026-09-29 起）：不在这里传参，而是**由 `event_key` 经
    `audience_for_event()` 推导**（见本文件上方的受众规则表）——
    这样 21 个调用点**零改动**就都有了受众，且新增事件类型只需登记那张表。
    `recipients` 仍是**人级定向**（催报 / 工资条 / 定时任务结果）；
    两者关系与判定顺序见 `message_visible()`。
    """
    win = MESSAGE_DEDUP_WINDOW if dedup_window is None else int(dedup_window)
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    # recipients 一律归一成字符串再落库/比较：salary_send 原先传的是**整数** employee_id，
    # 而 SQLite 不做隐式转型（`1 = '1'` 为 false）→ 工资条的去重与「定向可见」会静默失效。
    rcpt = "" if recipients is None else str(recipients)
    ekey = (event_key or "").strip() or norm_event_key(title)
    with get_db() as db:
        if win > 0:
            row = db.execute(
                "SELECT id, COALESCE(dup_count,0) AS dc FROM message_center "
                "WHERE title=? AND msg_type=? AND CAST(COALESCE(recipients,'') AS TEXT)=? AND is_read=0 "
                "AND created_at >= datetime('now','localtime',?) "
                "ORDER BY id DESC LIMIT 1",
                (title, msg_type, rcpt, "-%d seconds" % win)).fetchone()
            if row:
                db.execute("UPDATE message_center SET content=?, dup_count=?, last_at=?, event_key=? WHERE id=?",
                           (content, (row["dc"] or 0) + 1, now, ekey, row["id"]))
                db.commit()
                return row["id"]
        cur = db.execute(
            "INSERT INTO message_center(title,content,msg_type,sender,recipients,dup_count,last_at,event_key) "
            "VALUES(?,?,?,?,?,0,?,?)", (title, content, msg_type, sender, rcpt, now, ekey))
        db.commit()
        return cur.lastrowid


def get_cost_centers():
    """Return all departments as cost centers with financial summary."""
    with get_db() as db:
        c = db.cursor()
        c.execute("SELECT * FROM departments WHERE is_active=1 ORDER BY id")
        depts = [dict(r) for r in c.fetchall()]
        for d in depts:
            c.execute("SELECT COALESCE(SUM(amount),0) FROM expense_orders WHERE cost_center_id=?", (d["id"],))
            d["total_expense"] = c.fetchone()[0]
            c.execute("SELECT COALESCE(SUM(amount),0) FROM income_orders WHERE cost_center_id=?", (d["id"],))
            d["total_income"] = c.fetchone()[0]
            c.execute("SELECT COALESCE(SUM(total_amount),0) FROM sale_orders WHERE profit_center_id=? AND status IN ('delivered','signed')", (d["id"],))
            d["total_sales"] = c.fetchone()[0]
            d["net"] = (d["total_sales"] or 0) + (d["total_income"] or 0) - (d["total_expense"] or 0)
    return depts


def get_pnl_by_cost_center():
    """P&L broken down by cost center / profit center."""
    with get_db() as db:
        c = db.cursor()
        c.execute("SELECT id, name FROM departments WHERE is_active=1 ORDER BY id")
        depts = [(r["id"], r["name"]) for r in c.fetchall()]

        result = []
        for did, dname in depts:
            c.execute("SELECT COALESCE(SUM(total_amount),0) FROM sale_orders WHERE profit_center_id=? AND status IN ('delivered','signed')", (did,))
            sales = c.fetchone()[0] or 0
            c.execute("SELECT COALESCE(SUM(amount),0) FROM expense_orders WHERE cost_center_id=? AND type='supplier'", (did,))
            cogs = c.fetchone()[0] or 0
            c.execute("SELECT COALESCE(SUM(amount),0) FROM expense_orders WHERE cost_center_id=? AND type!='supplier'", (did,))
            opex = c.fetchone()[0] or 0
            c.execute("SELECT COALESCE(SUM(amount),0) FROM income_orders WHERE cost_center_id=?", (did,))
            income = c.fetchone()[0] or 0

            gross_profit = sales - cogs
            net_profit = gross_profit + income - opex
            result.append({
                "cost_center_id": did, "name": dname,
                "revenue": sales, "cogs": cogs, "gross_profit": gross_profit,
                "other_income": income, "opex": opex, "net_profit": net_profit,
            })

        # Add unassigned
        c.execute("SELECT COALESCE(SUM(total_amount),0) FROM sale_orders WHERE profit_center_id=0 AND status IN ('delivered','signed')")
        unassigned_sales = c.fetchone()[0] or 0
        c.execute("SELECT COALESCE(SUM(amount),0) FROM expense_orders WHERE cost_center_id=0")
        unassigned_expense = c.fetchone()[0] or 0
        c.execute("SELECT COALESCE(SUM(amount),0) FROM income_orders WHERE cost_center_id=0")
        unassigned_income = c.fetchone()[0] or 0

        if unassigned_sales or unassigned_expense or unassigned_income:
            result.append({
                "cost_center_id": 0, "name": "未分配",
                "revenue": unassigned_sales, "cogs": 0, "gross_profit": unassigned_sales,
                "other_income": unassigned_income, "opex": unassigned_expense,
                "net_profit": unassigned_sales + unassigned_income - unassigned_expense,
            })

        total = {
            "revenue": sum(r["revenue"] for r in result),
            "cogs": sum(r["cogs"] for r in result),
            "gross_profit": sum(r["gross_profit"] for r in result),
            "other_income": sum(r["other_income"] for r in result),
            "opex": sum(r["opex"] for r in result),
            "net_profit": sum(r["net_profit"] for r in result),
        }

    return {"centers": result, "total": total}


def assign_cost_center(ref_type, ref_id, cost_center_id):
    """Assign a transaction to a cost center / profit center."""
    with get_db() as db:
        c = db.cursor()
        if ref_type == "expense":
            c.execute("UPDATE expense_orders SET cost_center_id=? WHERE id=?", (cost_center_id, ref_id))
        elif ref_type == "income":
            c.execute("UPDATE income_orders SET cost_center_id=? WHERE id=?", (cost_center_id, ref_id))
        elif ref_type == "sale":
            c.execute("UPDATE sale_orders SET profit_center_id=? WHERE id=?", (cost_center_id, ref_id))
        db.commit()
    return True


# Performance indexes — now in db.indexes (auto-created on import)
from db.indexes import _create_indexes

_create_indexes()


