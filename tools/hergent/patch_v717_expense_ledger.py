#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v717 费用侧打通：接口修复 + 费用凭证 + 科目映射 + 利润表费用分解

背景（全部实测，不是推断）
--------------------------
利润表「只有毛利、没有净利」，不是口径问题，是**费用从来没进过账**：

  ① `expense_orders` / `expense_requests` 生产 0 行，`salary_details` 7 行全是
     5000 元占位草稿，`cash_flow` 支出只有 4 条共 956 元（2026-06 测试）。
     ⇒ 没有任何真实费用数据。
  ② 全仓只有 4 个 `auto_journal_for_*`（sale / payment / purchase / cogs），
     **没有 expense** ⇒ 就算建了费用单，`journal_entries` 里也不会有一行费用。
  ③ `POST/GET /api/expense-orders` 与 `/api/income-orders` 实测全 500：
     `TypeError: expense_order_create() takes from 3 to 12 positional arguments
      but 15 were given`（路由传的 6 个字段在 `expense_orders` 里一个都不存在）。
  ④ `get_pnl_gl` 只返回 `total_expense`，而前端「费用明细」卡读的是
     `sell_expense / admin_expense / fin_expense / other_expense`
     ⇒ 界面上销售/管理/财务费用三行**恒为 ¥0.00**。

本补丁做四件事
--------------
  A. 修 5 个路由（费用单增/查/付、收入单增/查），只传真实存在的参数，不补幽灵列。
  B. 新增 `auto_journal_for_expense` / `auto_journal_for_expense_pay`：
     费用确认 借费用科目 / 贷 2202 应付账款；付款 借 2202 / 贷 现金或银行存款。
  C. `expense_categories.gl_account` 9 条映射到真实末级科目（原来全是 6602）。
  D. `get_pnl_gl` 补四段费用分解，并加**逐分平衡硬断言**（分不平直接抛错）。

用法
----
    python3 patch_v717_expense_ledger.py --dry-run
    python3 patch_v717_expense_ledger.py --apply       # 需先 systemctl stop hergent-erp
    python3 patch_v717_expense_ledger.py --verify
    python3 patch_v717_expense_ledger.py --revert      # 需先 systemctl stop hergent-erp
"""
import argparse
import json
import os
import re
import shutil
import sqlite3
import sys
import time

P = "/opt/hergent-erp"
F_Q = os.path.join(P, "db/queries/finance.py")
F_R = os.path.join(P, "routers/finance.py")
DB = os.path.join(P, "tenant_1.db")
FE_DIR = "/opt/static"
BAK_DIR = "/opt/hergent-data/backup"
TS = time.strftime("%Y%m%d-%H%M%S")


# ---------------------------------------------------------------- 文本工具
def _read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def _write(p, s):
    with open(p, "w", encoding="utf-8") as f:
        f.write(s)


def sub_once(src, name, old, new, log, optional=False):
    """把 old 换成 new。**幂等**：new 已在位就跳过。

    🔴 顺序不能反：先判 `new in src`，再判 `old` 唯一。
       `NEW = OLD + 追加` 时 OLD 是 NEW 的子串，先判 old 会重复替换
       （v709 踩过：语法合法、静默劣化）。
    """
    if new in src:
        log.append({"edit": name, "action": "already_applied"})
        assert src.count(new) == 1, "%s: new 串在位 %d 次（应 1 次）" % (name, src.count(new))
        return src
    n = src.count(old)
    if n != 1:
        if optional and n == 0:
            log.append({"edit": name, "action": "skipped_optional"})
            return src
        raise AssertionError("%s: 锚点出现 %d 次（应 1 次）" % (name, n))
    out = src.replace(old, new)
    assert out.count(new) == 1, "%s: 替换后 new 出现 %d 次" % (name, out.count(new))
    log.append({"edit": name, "action": "replaced"})
    return out


def sub_region(src, name, start, end, new_region, log):
    """把 [start, end) 之间整段换掉（end 标记本身保留在新内容末尾之外）。

    用于整函数替换：比拼几百行精确字符串稳，锚点只要两行。
    """
    if new_region in src:
        log.append({"edit": name, "action": "already_applied"})
        return src
    ns, ne = src.count(start), src.count(end)
    if ns != 1 or ne != 1:
        raise AssertionError("%s: 起止锚点 %d/%d 次（各应 1）" % (name, ns, ne))
    i, j = src.index(start), src.index(end)
    if j <= i:
        raise AssertionError("%s: 起止顺序反了" % name)
    out = src[:i] + new_region + src[j:]
    log.append({"edit": name, "action": "replaced", "removed_bytes": j - i,
                "new_bytes": len(new_region)})
    return out


# ---------------------------------------------------------------- A/D. 代码补丁
OLD_EARLY_RETURN = '''        if not codes:
            return {"month": month, "basis": "accrual", "source": "gl",
                    "revenue": 0, "cogs": 0, "gross_profit": 0,
                    "total_expense": 0, "net_profit": 0,
                    "has_data": False, "unclassified": []}'''

NEW_EARLY_RETURN = '''        if not codes:
            return {"month": month, "basis": "accrual", "source": "gl",
                    "revenue": 0, "cogs": 0, "gross_profit": 0,
                    "total_expense": 0, "net_profit": 0,
                    # v717：四段费用 + 其他收入也要给默认值 —— 前端会 `|| 0`，
                    # 但缺字段会让「字段有没有返回」这件事无法从返回体判断。
                    "sell_expense": 0, "admin_expense": 0, "fin_expense": 0,
                    "other_expense": 0, "other_revenue": 0,
                    "has_data": False, "unclassified": []}'''

OLD_SPLIT = '''    rev_codes = {c for c in codes if c[:2] in _REV_PREFIX2}
    cogs_codes = {c for c in codes if c.startswith(_COGS_PREFIX)}
    exp_codes = codes - rev_codes - cogs_codes

    revenue = _group(rev_codes, True)
    cost = _group(cogs_codes, False)
    total_exp = _group(exp_codes, False)'''

NEW_SPLIT = '''    rev_codes = {c for c in codes if c[:2] in _REV_PREFIX2}
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
    other_rev = _group({c for c in rev_codes if not c.startswith("6001")}, True)'''

OLD_RETURN_EXP = '''        "total_expense": round(total_exp, 2),
        "net_profit": round(revenue - cost - total_exp, 2),'''

NEW_RETURN_EXP = '''        "total_expense": round(total_exp, 2),
        # v717：费用明细四段（口径见上方分解），前端「费用明细」卡按这四个字段渲染。
        "sell_expense": round(sell_exp, 2),
        "admin_expense": round(admin_exp, 2),
        "fin_expense": round(fin_exp, 2),
        "other_expense": round(other_exp, 2),
        "other_revenue": round(other_rev, 2),
        "net_profit": round(revenue - cost - total_exp, 2),'''

OLD_CREATE_SIG = ("def expense_order_create(etype, contact_id, amount, category_id=0, note='', "
                  "operator_id='', brand='', employee_id='', order_no='', order_date='', "
                  "db_conn=None, post_ledger=True):")

NEW_CREATE_SIG = ("def expense_order_create(etype, contact_id, amount, category_id=0, note='', "
                  "operator_id='', brand='', employee_id='', order_no='', order_date='', "
                  "db_conn=None, post_ledger=True, post_journal=True):")

OLD_CUST = ('                db.execute("INSERT INTO receivables (type,contact_id,ref_type,ref_id,amount) '
            "VALUES ('ar',?,'expense',?,?)\",(contact_id,oid,-amount))")

NEW_CUST = ('                # v717：原写法 `(\'ar\', ..., -amount)` 撞 `receivables` 的\n'
            '                # `CHECK(amount>=0)` ⇒ 客户费用（陈列费/促销费/返利）**必 IntegrityError**，\n'
            '                # 一单也建不成（与「expense_orders 生产 0 行」互为因果）。\n'
            '                # 语义也是反的：给门店陈列费是「我欠门店」⇒ 记 `ap` 正数；\n'
            '                # 不是应收负数。要「陈列费冲抵货款」应走核销，不是在应收里写负数。\n'
            '                db.execute("INSERT INTO receivables (type,contact_id,ref_type,ref_id,amount) '
            "VALUES ('ap',?,'expense',?,?)\",(contact_id,oid,amount))")

OLD_CREATE_TAIL = '''            elif etype == 'internal':
                db.execute("UPDATE accounts SET current_balance=current_balance-? WHERE name='现金'",(amount,))
        if db_conn is None:
            db.commit()
    return {'order_id': oid, 'order_no': no}'''

NEW_CREATE_TAIL = '''            elif etype == 'internal':
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
    return {'order_id': oid, 'order_no': no}'''

OLD_PAY_TAIL = '''        db.execute("UPDATE accounts SET current_balance=current_balance-? WHERE name=?",(amount,account))
        db.commit(); return {'success':True}'''

NEW_PAY_TAIL = '''        db.execute("UPDATE accounts SET current_balance=current_balance-? WHERE name=?",(amount,account))
        # ---- v717：付款凭证（借 2202 应付账款 / 贷 现金或银行存款）------------
        # 不记的话，费用付了 GL 不认，2202 会一直挂着「欠款」，资产负债表虚增负债。
        # 与确认凭证用**不同 ref_type**（expense_pay vs expense），互不干扰；
        # 部分付款会多次调用 ⇒ 这里**故意不做幂等拦截**（每笔都是真实现金流出）。
        try:
            auto_journal_for_expense_pay(oid, amount, account, db_conn=db)
        except Exception as _e:
            _logger.warning("auto_journal_for_expense_pay(%s) 失败，付款凭证未生成: %s",
                            oid, _e, exc_info=True)
        db.commit(); return {'success':True}'''

NEW_EXPENSE_LIST_AND_JOURNAL = '''def expense_order_list(etype='', contact_id=0, limit=100, offset=0,
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
        cand = sorted(c for c in valid if c.startswith("6602")) or \\
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
'''

OLD_LIST_SIG = "def expense_order_list(etype='', contact_id=0, limit=100):"
END_MARK = "# ============================================================\n# \u6536\u5165\u5355"


# ---------------------------------------------------------------- B. 路由补丁
NEW_CREATE_EXPENSE = '''@router.post("/expense-orders")
async def create_expense(request: Request):
    """建一张费用单。

    v717：改前**必崩**。这里给 `db.expense_order_create` 传了 **15 个实参**，
    而函数只收 12 个（第 9~12 位是 order_no / order_date / db_conn / post_ledger）
    ⇒ 线上实测 `TypeError: expense_order_create() takes from 3 to 12 positional
    arguments but 15 were given`，`POST /api/expense-orders` 100% 500。

    那 7 个多余实参（discount_amount / settlement_status / department /
    settlement_unit_id / employee_name / product_info / generation_method）对应的
    列在 `expense_orders` 里**一个都不存在**，属幽灵字段 ⇒ 删掉，不补列。
    """
    _auth(request)
    d = await request.json()
    try:
        amount = round(float(d.get("amount") or 0), 2)
    except Exception:
        raise HTTPException(400, "金额格式不正确")
    if amount <= 0:
        raise HTTPException(400, "费用金额必须大于 0")
    category_id = 0
    try:
        category_id = int(d.get("category_id") or 0)
    except Exception:
        category_id = 0
    # 前端「新增费用」弹窗只传 contact_name（不传 id）⇒ 这里按名字补齐，
    # 否则往来账挂不上客户/供应商（contact_id=0），账龄里看不到这笔。
    contact_id = 0
    try:
        contact_id = int(d.get("contact_id") or 0)
    except Exception:
        contact_id = 0
    if not contact_id and (d.get("contact_name") or "").strip():
        try:
            from db.connection import get_db as _gdb
            with _gdb() as _c:
                _r = _c.execute("SELECT id FROM contacts WHERE name=? LIMIT 1",
                                (d["contact_name"].strip(),)).fetchone()
            if _r:
                contact_id = _r[0]
        except Exception:
            _logger.warning("按 contact_name 反查 contact_id 失败", exc_info=True)
    category_name = ""
    if category_id:
        try:
            for c in db.expense_category_list():
                if c["id"] == category_id:
                    category_name = c["name"]
                    break
        except Exception:
            _logger.warning("expense_category_list failed during budget check", exc_info=True)
    warning = ""
    if category_name:
        check = db.check_budget_before_expense(category_name, amount)
        if check.get("blocked"):
            return {"success": False, "error": check.get("message"), "budget_blocked": True}
        if check.get("warn"):
            # 只提醒不拦截：与「提醒状态不得进 validate/不得绑 disabled」同一条纪律
            warning = check.get("message") or ""
    res = db.expense_order_create(
        d.get("type", "customer"), contact_id, amount,
        category_id, d.get("note", ""), d.get("operator_id", ""),
        d.get("brand", ""), d.get("employee_id", ""),
    )
    if isinstance(res, dict) and res.get("error"):
        return {"success": False, "error": res.get("error")}
    out = {"success": True, "id": res.get("order_id"), "order_no": res.get("order_no")}
    if res.get("existed"):
        out["existed"] = True
    if warning:
        out["budget_warning"] = warning
    return out


'''

NEW_LIST_EXPENSES = '''@router.get("/expense-orders")
def list_expenses(request: Request, type: str = "", contact_id: int = 0, limit: int = 200,
                  offset: int = 0, date_from: str = "", date_to: str = "", status: str = "",
                  search: str = "", brand: str = ""):
    """费用单列表（v717：返回 `{'items','total'}`）。

    改前给 `expense_order_list`（只收 3 个形参）传了 **11 个实参**
    ⇒ `GET /api/expense-orders` 100% 500，「营销 → 费用」整页打不开。
    另：前端分页传 `limit` + `offset`，而老路由**没有 offset 参数**（收到即丢）
    ⇒ 翻页永远同一批数据。现补齐。`department / employee_name /
    settlement_status` 三个筛选对应的列在表里不存在，一并删掉。
    """
    _auth(request)
    return db.expense_order_list(type, contact_id, limit, offset,
                                 date_from, date_to, status, search, brand)


'''

NEW_CREATE_INCOME = '''@router.post("/income-orders")
async def create_income(request: Request):
    """建一张收入单（v717：改前传 15 个实参给只收 10 个的函数 ⇒ 必 500）。"""
    _auth(request)
    d = await request.json()
    try:
        amount = round(float(d.get("amount") or 0), 2)
    except Exception:
        raise HTTPException(400, "金额格式不正确")
    if amount <= 0:
        raise HTTPException(400, "收入金额必须大于 0")
    res = db.income_order_create(
        d.get("type", "customer"), int(d.get("contact_id") or 0), amount,
        int(d.get("category_id") or 0), d.get("note", ""), d.get("operator_id", ""),
    )
    return {"success": True, "id": res.get("order_id"), "order_no": res.get("order_no")}


'''

NEW_LIST_INCOMES = '''@router.get("/income-orders")
def list_incomes(request: Request, type: str = "", contact_id: int = 0, limit: int = 200,
                 offset: int = 0, date_from: str = "", date_to: str = "", status: str = "",
                 search: str = ""):
    """收入单列表（v717：改前传 11 个实参给只收 3 个的函数 ⇒ 必 500）。"""
    _auth(request)
    return db.income_order_list(type, contact_id, limit, offset,
                                date_from, date_to, status, search)


'''

NEW_PAY_EXPENSE = '''@router.post("/expense-orders/{oid}/pay")
async def pay_expense(oid: int, request: Request):
    """费用支付。

    v717 两处改动：
      ① 删掉 `db.auto_journal_for_payment(oid)` —— 它按 `cash_flow.id=oid` 查，
         而这里的 `oid` 是 `expense_orders.id`，两张表的主键不是一个东西
         ⇒ 改前每次调用都必然找不到记录、被 except 静默吞掉（看着"成功"）。
      ② 付款凭证改由 `expense_order_pay` 内部的 `auto_journal_for_expense_pay`
         生成（借 2202 应付账款 / 贷 现金或银行存款）。
    """
    _auth(request)
    d = await request.json()
    try:
        amount = round(float(d.get("amount") or 0), 2)
    except Exception:
        raise HTTPException(400, "金额格式不正确")
    if amount <= 0:
        raise HTTPException(400, "支付金额必须大于 0")
    res = db.expense_order_pay(oid, amount, d.get("account", "现金"), d.get("operator_id", ""))
    if isinstance(res, dict) and res.get("error"):
        return {"success": False, "error": res.get("error")}
    try:
        _au = _auth(request) or {}
        _op = _au.get("display_name") or _au.get("username") or str(_au.get("id", ""))
        db.audit_log(_op, f"费用支付 oid={oid} 金额=¥{amount:.2f} 账户={d.get('account','现金')}",
                     "expense_pay", str(oid), f"amount={amount};account={d.get('account','现金')}")
    except Exception:
        pass
    return {"success": True}
'''

# ---------------------------------------------------------------- C. 数据补丁
GL_MAP = {
    "陈列费": "64020101",
    "促销费": "640201",
    "返利": "64020105",
    "运费": "66020207",
    "装卸费": "66020206",
    "办公费": "66020205",
    "差旅费": "660203",
    "工资": "660209",
    "房租": "66020201",
}

# ---------------------------------------------------------------- E. 前端补丁
FE_CARD_OLD = '["\u8d39\u7528\u5408\u8ba1",F.total_expense||0]'
FE_CARD_NEW = '["\u5176\u4ed6\u8d39\u7528",F.other_expense||0],["\u8d39\u7528\u5408\u8ba1",F.total_expense||0]'


# ---------------------------------------------------------------- 执行
def _code_edits_q(src, log):
    src = sub_once(src, "P&L/空返回补四段字段", OLD_EARLY_RETURN, NEW_EARLY_RETURN, log)
    src = sub_once(src, "P&L/费用四段分解", OLD_SPLIT, NEW_SPLIT, log)
    src = sub_once(src, "P&L/返回体补四段", OLD_RETURN_EXP, NEW_RETURN_EXP, log)
    src = sub_once(src, "费单/签名加 post_journal", OLD_CREATE_SIG, NEW_CREATE_SIG, log)
    src = sub_once(src, "费单/客户费用改记应付", OLD_CUST, NEW_CUST, log)
    src = sub_once(src, "费单/建单后生成凭证", OLD_CREATE_TAIL, NEW_CREATE_TAIL, log)
    src = sub_once(src, "费单/付款后生成凭证", OLD_PAY_TAIL, NEW_PAY_TAIL, log)
    src = sub_region(src, "费单/列表补 offset+total + 新增费用凭证函数",
                     OLD_LIST_SIG, END_MARK, NEW_EXPENSE_LIST_AND_JOURNAL, log)
    return src


def _code_edits_r(src, log):
    src = sub_region(
        src, "路由/建费用单",
        '@router.post("/expense-orders")\nasync def create_expense(request: Request):',
        '@router.post("/expense-orders/check-budget")', NEW_CREATE_EXPENSE, log)
    src = sub_region(
        src, "路由/费用单列表",
        '@router.get("/expense-orders")\ndef list_expenses(request: Request',
        '# ---- Income Orders ----', NEW_LIST_EXPENSES, log)
    src = sub_region(
        src, "路由/建收入单",
        '@router.post("/income-orders")\nasync def create_income(request: Request):',
        '@router.get("/income-orders")', NEW_CREATE_INCOME, log)
    src = sub_region(
        src, "路由/收入单列表",
        '@router.get("/income-orders")\ndef list_incomes(request: Request',
        '@router.post("/expense-orders/{oid}/pay")', NEW_LIST_INCOMES, log)
    src = sub_region(
        src, "路由/费用支付",
        '@router.post("/expense-orders/{oid}/pay")\nasync def pay_expense(oid: int, request: Request):',
        '# ---- Writeoffs ----', NEW_PAY_EXPENSE, log)
    return src


def patch_data(dry=True):
    out = []
    if not os.path.exists(DB):
        return {"error": "库不存在: " + DB}
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    try:
        cols = [r[1] for r in conn.execute("PRAGMA table_info(expense_categories)")]
        if "gl_account" not in cols:
            return {"skipped": "expense_categories 无 gl_account 列（账外 DDL，容忍）"}
        valid = {r[0] for r in conn.execute(
            "SELECT code FROM chart_of_accounts WHERE is_active=1")}
        for name, code in GL_MAP.items():
            row = conn.execute("SELECT id, gl_account FROM expense_categories WHERE name=?",
                               (name,)).fetchone()
            if not row:
                out.append({"name": name, "skip": "分类不存在"})
                continue
            if code not in valid:
                out.append({"name": name, "skip": "目标科目 %s 不在账套" % code})
                continue
            if (row["gl_account"] or "") == code:
                out.append({"name": name, "action": "already", "to": code})
                continue
            out.append({"name": name, "id": row["id"],
                        "from": row["gl_account"], "to": code})
            if not dry:
                conn.execute("UPDATE expense_categories SET gl_account=? WHERE id=?",
                             (code, row["id"]))
        if not dry:
            conn.commit()
    finally:
        conn.close()
    return out


def _fe_file():
    idx_p = os.path.join(FE_DIR, "index.html")
    if not os.path.exists(idx_p):
        return None
    m = re.search(r"assets/main-[A-Za-z0-9_-]+\.js", _read(idx_p))
    return os.path.join(FE_DIR, m.group(0)) if m else None


def patch_frontend(dry=True):
    f = _fe_file()
    if not f or not os.path.exists(f):
        return {"skipped": "找不到前端 chunk"}
    s = _read(f)
    if FE_CARD_NEW in s:
        return {"file": f, "action": "already_applied"}
    n = s.count(FE_CARD_OLD)
    if n != 1:
        return {"file": f, "error": "锚点出现 %d 次（应 1）" % n}
    if dry:
        return {"file": f, "action": "would_replace", "anchor": FE_CARD_OLD}
    bak = f + ".bak-v717"
    if not os.path.exists(bak):
        shutil.copy2(f, bak)
    _write(f, s.replace(FE_CARD_OLD, FE_CARD_NEW))
    return {"file": f, "action": "replaced", "backup": bak}


def do_apply(dry=True):
    rep = {"ts": TS, "dry_run": dry, "code_q": [], "code_r": [], "data": None,
           "frontend": None, "backups": []}
    if dry:
        # dry-run 只在内存里跑，不写盘
        q = _code_edits_q(_read(F_Q), rep["code_q"])
        r = _code_edits_r(_read(F_R), rep["code_r"])
        # 语法检查（不落盘）
        import ast
        ast.parse(q)
        ast.parse(r)
        rep["syntax_ok"] = True
        rep["data"] = patch_data(dry=True)
        rep["frontend"] = patch_frontend(dry=True)
        return rep

    os.makedirs(BAK_DIR, exist_ok=True)
    for p in (F_Q, F_R):
        bak = "%s.bak-v717-%s" % (p, TS)
        shutil.copy2(p, bak)
        rep["backups"].append(bak)
    if os.path.exists(DB):
        dbak = os.path.join(BAK_DIR, "tenant_1.pre-v717-%s.db" % TS)
        shutil.copy2(DB, dbak)
        rep["backups"].append(dbak)

    q = _code_edits_q(_read(F_Q), rep["code_q"])
    r = _code_edits_r(_read(F_R), rep["code_r"])
    import ast
    ast.parse(q)
    ast.parse(r)
    _write(F_Q, q)
    _write(F_R, r)
    rep["data"] = patch_data(dry=False)
    rep["frontend"] = patch_frontend(dry=False)
    man = os.path.join(BAK_DIR, "v717-manifest-%s.json" % TS)
    _write(man, json.dumps(rep, ensure_ascii=False, indent=1))
    rep["manifest"] = man
    return rep


def do_revert():
    import glob
    mans = sorted(glob.glob(os.path.join(BAK_DIR, "v717-manifest-*.json")))
    if not mans:
        return {"error": "找不到 v717 manifest"}
    rep = json.loads(_read(mans[-1]))
    done = []
    for bak in rep.get("backups", []):
        if bak.endswith(".db"):
            continue
        orig = bak.split(".bak-v717-")[0]
        if os.path.exists(bak):
            shutil.copy2(bak, orig)
            done.append(orig)
    fe = os.path.join(FE_DIR, "")
    f = _fe_file()
    if f and os.path.exists(f + ".bak-v717"):
        shutil.copy2(f + ".bak-v717", f)
        done.append(f)
    return {"manifest": mans[-1], "restored": done}


def do_verify():
    out = {"ts": TS, "checks": []}

    def chk(name, cond, detail=""):
        out["checks"].append({"name": name, "pass": bool(cond), "detail": detail})
        return bool(cond)

    q = _read(F_Q)
    r = _read(F_R)
    chk("F_Q 有 sell_expense", "sell_expense" in q)
    chk("F_Q 有 费用分解硬断言", "费用分解不平" in q)
    chk("F_Q 有 auto_journal_for_expense",
        "def auto_journal_for_expense(expense_id" in q)
    chk("F_Q 有 auto_journal_for_expense_pay",
        "def auto_journal_for_expense_pay(" in q)
    chk("F_Q 建单挂过账", "auto_journal_for_expense(oid, db_conn=db)" in q)
    chk("F_Q 付款挂过账", "auto_journal_for_expense_pay(oid, amount, account, db_conn=db)" in q)
    chk("F_Q 客户费用改 ap", "VALUES ('ap',?,'expense'" in q)
    chk("F_Q 列表返回 items/total", "return {'items': items, 'total': total}" in q)
    chk("F_R 列表有 offset", 'offset: int = 0' in r)
    chk("F_R 已删幽灵列 department", '"department", ""' not in r)
    # 🔴 判「真调用」不能查裸函数名：新 pay_expense 的 docstring 里**提到了**它
    #    （解释为什么删），裸字符串判据会把注释当成调用（自己把自己判红）。
    chk("F_R 已删 auto_journal_for_payment 真调用",
        "try: db.auto_journal_for_payment(oid)" not in r)

    if os.path.exists(DB):
        conn = sqlite3.connect("file:%s?mode=ro" % DB, uri=True)
        try:
            rows = conn.execute(
                "SELECT account_code, COALESCE(SUM(debit),0), COALESCE(SUM(credit),0) "
                "FROM journal_entries GROUP BY account_code").fetchall()
            agg = {"sell": 0.0, "admin": 0.0, "fin": 0.0, "other": 0.0,
                   "rev": 0.0, "cogs": 0.0}
            for code, d, c in rows:
                if not code or not code.startswith("6"):
                    continue
                if code.startswith("6401"):
                    agg["cogs"] += d - c
                elif code[:2] in ("60", "61", "63"):
                    agg["rev"] += c - d
                elif code.startswith("6601"):
                    agg["sell"] += d - c
                elif code.startswith("6602"):
                    agg["admin"] += d - c
                elif code.startswith("6603"):
                    agg["fin"] += d - c
                else:
                    agg["other"] += d - c
            out["gl_raw"] = {k: round(v, 2) for k, v in agg.items()}
            out["expense_rows"] = conn.execute(
                "SELECT COUNT(*) FROM journal_entries WHERE ref_type IN ('expense','expense_pay')"
            ).fetchone()[0]
            out["journal_total"] = conn.execute(
                "SELECT COUNT(*) FROM journal_entries").fetchone()[0]
            # 🔴 `journal_entries` 是**逐行**记的：一行只有借或只有贷，
            #    按行判 `debit==credit` 会把全部 88,776 行判成「单边」
            #    （v717 第一版 verify 就栽在这，判据本身是错的，不是账有问题）。
            #    正确判据：按 `voucher_no` 汇总后借贷相等。
            bad = conn.execute(
                "SELECT COUNT(*) FROM (SELECT voucher_no FROM journal_entries "
                "GROUP BY voucher_no "
                "HAVING abs(COALESCE(SUM(debit),0)-COALESCE(SUM(credit),0))>0.005)"
            ).fetchone()[0]
            out["unbalanced_vouchers"] = bad
            chk("凭证按单号借贷平衡", bad == 0, "unbalanced_vouchers=%d" % bad)
        finally:
            conn.close()
    out["all_pass"] = all(c["pass"] for c in out["checks"])
    return out


def main():
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--dry-run", action="store_true")
    g.add_argument("--apply", action="store_true")
    g.add_argument("--revert", action="store_true")
    g.add_argument("--verify", action="store_true")
    a = ap.parse_args()
    if a.revert:
        print(json.dumps(do_revert(), ensure_ascii=False, indent=1))
        return
    if a.verify:
        v = do_verify()
        print(json.dumps(v, ensure_ascii=False, indent=1))
        sys.exit(0 if v["all_pass"] else 1)
    rep = do_apply(dry=not a.apply)
    print(json.dumps(rep, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
