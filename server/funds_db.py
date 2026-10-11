# ============================================================
# funds_db.py —— 资金管理域 · 多租户 SQLite 数据层
# ------------------------------------------------------------
# 设计要点（与 Hergent 现有后端同构）：
#   · 多租户 = **每租户一个库文件**（本项目 2026-07-25 评审结论：维持「每租户一库」，
#     不在共享表上加 tenant_id，避免 143 张表回填 + 全量 SQL 改造的串租户风险）。
#   · `get_db(tenant_id)` 是**唯一的**换库点：生产环境返回
#     `~/Library/Application Support/hergent-erp/tenant_<id>.db`（与 erp.db 同一目录、
#     同一文件）；本地自测用 tenant=1 的隔离库，互不影响。
#   · 所有写操作均带 `tenant_id`（即便每库单租户，也冗余写入，便于未来迁移与审计）。
#
# 🔴 本文件只管 SQL 与行映射，不碰 RBAC / 鉴权（那是 server.py 中间件的事）。
# ============================================================
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, date

# 生产布局：与 erp.db 同目录（每租户一库）。本地自测也走这里，tenant=1 隔离。
ERP_DIR = os.path.expanduser("~/Library/Application Support/hergent-erp")
os.makedirs(ERP_DIR, exist_ok=True)


def db_path(tenant_id):
    return os.path.join(ERP_DIR, f"tenant_{int(tenant_id)}.db")


@contextmanager
def get_db(tenant_id=1):
    path = db_path(tenant_id)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


SCHEMA = """
CREATE TABLE IF NOT EXISTS fund_accounts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id     INTEGER NOT NULL,
    name          TEXT NOT NULL,
    type          TEXT NOT NULL DEFAULT '现金',     -- 现金/银行/支付宝/微信/其他
    bank_name     TEXT DEFAULT '',
    account_no    TEXT DEFAULT '',
    opening_balance REAL DEFAULT 0,
    current_balance REAL DEFAULT 0,
    remark        TEXT DEFAULT '',
    created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fund_docs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id     INTEGER NOT NULL,
    doc_type      TEXT NOT NULL,                     -- 见 DOC_TYPE_PREFIX
    doc_no        TEXT NOT NULL,
    bill_date     TEXT NOT NULL,
    party_type    TEXT NOT NULL DEFAULT 'none',     -- customer/supplier/internal/none
    party_id      INTEGER DEFAULT 0,
    party_name    TEXT DEFAULT '',
    account       TEXT DEFAULT '',
    amount        REAL DEFAULT 0,
    remark        TEXT DEFAULT '',
    status        TEXT NOT NULL DEFAULT 'draft',    -- draft/posted/void
    operator      TEXT DEFAULT '',
    created_at    TEXT NOT NULL,
    posted_at     TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS fund_doc_items (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id        INTEGER NOT NULL,
    tenant_id     INTEGER NOT NULL,
    ref_type      TEXT DEFAULT '',                  -- 关联源单类型（如 sale_order/purchase_order）
    ref_id        INTEGER DEFAULT 0,
    ref_no        TEXT DEFAULT '',
    amount        REAL DEFAULT 0,
    cost          REAL DEFAULT 0,                   -- 仅成本类单据使用（入库/出库核算）
    product_id    INTEGER DEFAULT 0,
    product_name  TEXT DEFAULT '',
    qty           REAL DEFAULT 0,
    remark        TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_fdi_doc ON fund_doc_items(doc_id);

CREATE TABLE IF NOT EXISTS fund_flow (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id     INTEGER NOT NULL,
    doc_id        INTEGER NOT NULL,
    doc_type      TEXT NOT NULL,
    doc_no        TEXT NOT NULL,
    bill_date     TEXT NOT NULL,
    party_type    TEXT DEFAULT 'none',
    party_id      INTEGER DEFAULT 0,
    party_name    TEXT DEFAULT '',
    account       TEXT DEFAULT '',
    amount        REAL DEFAULT 0,                     -- 有符号：收款 + / 付款 -
    balance_after REAL DEFAULT 0,
    remark        TEXT DEFAULT '',
    created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ff_tenant_date ON fund_flow(tenant_id, bill_date);

CREATE TABLE IF NOT EXISTS cost_snapshots (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id     INTEGER NOT NULL,
    product_id    INTEGER NOT NULL,
    product_name  TEXT DEFAULT '',
    spec          TEXT DEFAULT '',
    unit          TEXT DEFAULT '',
    qty           REAL DEFAULT 0,
    avg_cost      REAL DEFAULT 0,
    amount        REAL DEFAULT 0,                     -- qty * avg_cost
    abnormal      INTEGER DEFAULT 0,                  -- 1 = 成本异常（如 avg_cost<=0 或人工标记）
    snapshot_date TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cost_prod ON cost_snapshots(tenant_id, product_id);
"""

# 单据类型 → 前缀（用于自动单号）+ 中文名 + 对方类型
DOC_META = {
    'receipt':          ('SK', '收款单',      'customer'),
    'customer-fee':     ('KF', '客户费用单',  'customer'),
    'advance-receipt':  ('YS', '预收款单',    'customer'),
    'writeoff':         ('HX', '核销单',      'customer'),
    'sales-settle':     ('XS', '销货结算单',  'customer'),
    'return-settle':    ('TH', '退货结算单',  'customer'),
    'other-receivable': ('QT', '其他应收单',  'customer'),
    'payment':          ('FK', '付款单',      'supplier'),
    'supplier-fee':     ('GF', '供应商费用单', 'supplier'),
    'advance-payment':  ('YF', '预付款单',    'supplier'),
    'purchase-settle':  ('CG', '采购结算单',  'supplier'),
    'internal-fee':     ('NF', '内部费用单',  'internal'),
    'internal-income':  ('NS', '内部收入单',  'internal'),
    'transfer':         ('TB', '资金调拨单',  'none'),
    'in-cost':          ('RC', '入库核算单',  'supplier'),
    'out-cost':         ('CC', '出库核算单',  'customer'),
    'cost-adjust':      ('TZ', '成本调价单',  'none'),
}

DOC_TYPES = list(DOC_META.keys())


def init_funds_db(tenant_id=1):
    with get_db(tenant_id) as db:
        db.executescript(SCHEMA)


def _now():
    return datetime.now().strftime('%Y-%m-%d %H:%M:%S')


def _next_doc_no(db, tenant_id, doc_type, bill_date):
    prefix = DOC_META.get(doc_type, ('DOC', doc_type, 'none'))[0]
    ymd = (bill_date or date.today().isoformat())[:10].replace('-', '')
    like = f"{prefix}-{ymd}-%"
    row = db.execute(
        "SELECT COUNT(*) c FROM fund_docs WHERE tenant_id=? AND doc_no LIKE ?",
        (tenant_id, like)
    ).fetchone()
    seq = (row['c'] + 1) if row else 1
    return f"{prefix}-{ymd}-{seq:03d}"


# --------------------------- 资金账户 ---------------------------
def account_list(tenant_id):
    with get_db(tenant_id) as db:
        rows = db.execute(
            "SELECT * FROM fund_accounts WHERE tenant_id=? ORDER BY id", (tenant_id,)
        ).fetchall()
    return [dict(r) for r in rows]


def account_create(tenant_id, **kw):
    now = _now()
    with get_db(tenant_id) as db:
        cur = db.execute(
            """INSERT INTO fund_accounts
               (tenant_id, name, type, bank_name, account_no, opening_balance, current_balance, remark, created_at)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (tenant_id, kw.get('name', ''), kw.get('type', '现金'),
             kw.get('bank_name', ''), kw.get('account_no', ''),
             float(kw.get('opening_balance', 0) or 0), float(kw.get('opening_balance', 0) or 0),
             kw.get('remark', ''), now)
        )
        return cur.lastrowid


def account_update(tenant_id, aid, **kw):
    with get_db(tenant_id) as db:
        db.execute(
            """UPDATE fund_accounts SET name=?, type=?, bank_name=?, account_no=?,
               opening_balance=?, remark=? WHERE tenant_id=? AND id=?""",
            (kw.get('name'), kw.get('type', '现金'), kw.get('bank_name', ''),
             kw.get('account_no', ''), float(kw.get('opening_balance', 0) or 0),
             kw.get('remark', ''), tenant_id, aid)
        )


def _recompute_account_balance(tenant_id, account, conn=None):
    own = conn is None
    db = conn if conn is not None else get_db(tenant_id)
    try:
        acc = db.execute(
            "SELECT opening_balance FROM fund_accounts WHERE tenant_id=? AND name=?",
            (tenant_id, account)
        ).fetchone()
        if not acc:
            return
        opening = float(acc['opening_balance'] or 0)
        row = db.execute(
            "SELECT COALESCE(SUM(amount),0) s FROM fund_flow WHERE tenant_id=? AND account=?",
            (tenant_id, account)
        ).fetchone()
        bal = opening + float(row['s'] if row else 0)
        db.execute(
            "UPDATE fund_accounts SET current_balance=? WHERE tenant_id=? AND name=?",
            (bal, tenant_id, account)
        )
    finally:
        if own:
            db.close()


# --------------------------- 单据 ---------------------------
def doc_list(tenant_id, filters=None):
    filters = filters or {}
    where = ["tenant_id=?"]
    args = [tenant_id]
    if filters.get('doc_type'):
        where.append("doc_type=?")
        args.append(filters['doc_type'])
    if filters.get('party_type') and filters['party_type'] != 'all':
        where.append("party_type=?")
        args.append(filters['party_type'])
    if filters.get('party_id'):
        where.append("party_id=?")
        args.append(filters['party_id'])
    if filters.get('status') and filters['status'] != 'all':
        where.append("status=?")
        args.append(filters['status'])
    if filters.get('date_from'):
        where.append("bill_date>=?")
        args.append(filters['date_from'])
    if filters.get('date_to'):
        where.append("bill_date<=?")
        args.append(filters['date_to'])
    if filters.get('keyword'):
        where.append("(doc_no LIKE ? OR party_name LIKE ? OR remark LIKE ?)")
        k = f"%{filters['keyword']}%"
        args.extend([k, k, k])
    limit = int(filters.get('limit', 50) or 50)
    offset = int(filters.get('offset', 0) or 0)
    with get_db(tenant_id) as db:
        rows = db.execute(
            f"SELECT * FROM fund_docs WHERE {' AND '.join(where)} "
            f"ORDER BY bill_date DESC, id DESC LIMIT {limit} OFFSET {offset}",
            args
        ).fetchall()
        total = db.execute(
            f"SELECT COUNT(*) c FROM fund_docs WHERE {' AND '.join(where)}", args
        ).fetchone()['c']
    return {'items': [dict(r) for r in rows], 'total': total}


def doc_get(tenant_id, doc_id):
    with get_db(tenant_id) as db:
        r = db.execute(
            "SELECT * FROM fund_docs WHERE tenant_id=? AND id=?", (tenant_id, doc_id)
        ).fetchone()
        if not r:
            return None
        items = db.execute(
            "SELECT * FROM fund_doc_items WHERE doc_id=?", (doc_id,)
        ).fetchall()
    d = dict(r)
    d['items'] = [dict(i) for i in items]
    return d


def doc_create(tenant_id, **kw):
    now = _now()
    bill_date = kw.get('bill_date') or date.today().isoformat()
    doc_type = kw['doc_type']
    doc_no = _next_doc_no_sql(tenant_id, doc_type, bill_date)
    meta = DOC_META.get(doc_type, ('DOC', doc_type, 'none'))
    party_type = kw.get('party_type') or meta[2]
    with get_db(tenant_id) as db:
        cur = db.execute(
            """INSERT INTO fund_docs
               (tenant_id, doc_type, doc_no, bill_date, party_type, party_id, party_name,
                account, amount, remark, status, operator, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (tenant_id, doc_type, doc_no, bill_date, party_type,
             int(kw.get('party_id', 0) or 0), kw.get('party_name', ''),
             kw.get('account', ''), float(kw.get('amount', 0) or 0), kw.get('remark', ''),
             'draft', kw.get('operator', ''), now)
        )
        doc_id = cur.lastrowid
        items = kw.get('items') or []
        for it in items:
            db.execute(
                """INSERT INTO fund_doc_items
                   (doc_id, tenant_id, ref_type, ref_id, ref_no, amount, cost, product_id,
                    product_name, qty, remark)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                (doc_id, tenant_id, it.get('ref_type', ''), int(it.get('ref_id', 0) or 0),
                 it.get('ref_no', ''), float(it.get('amount', 0) or 0),
                 float(it.get('cost', 0) or 0), int(it.get('product_id', 0) or 0),
                 it.get('product_name', ''), float(it.get('qty', 0) or 0), it.get('remark', ''))
            )
        # 金额回填（含明细时以明细合计为准）
        if items:
            tot = sum(float(it.get('amount', 0) or 0) for it in items)
            db.execute("UPDATE fund_docs SET amount=? WHERE id=?", (tot, doc_id))
    return {'id': doc_id, 'doc_no': doc_no}


def _next_doc_no_sql(tenant_id, doc_type, bill_date):
    with get_db(tenant_id) as db:
        return _next_doc_no(db, tenant_id, doc_type, bill_date)


def doc_update(tenant_id, doc_id, **kw):
    with get_db(tenant_id) as db:
        r = db.execute(
            "SELECT status FROM fund_docs WHERE tenant_id=? AND id=?", (tenant_id, doc_id)
        ).fetchone()
        if not r:
            return {'error': 'not found'}
        if r['status'] != 'draft':
            return {'error': '只有草稿可编辑'}
        db.execute(
            """UPDATE fund_docs SET bill_date=?, party_type=?, party_id=?, party_name=?,
               account=?, amount=?, remark=?, operator=? WHERE tenant_id=? AND id=?""",
            (kw.get('bill_date'), kw.get('party_type'), int(kw.get('party_id', 0) or 0),
             kw.get('party_name', ''), kw.get('account', ''), float(kw.get('amount', 0) or 0),
             kw.get('remark', ''), kw.get('operator', ''), tenant_id, doc_id)
        )
        db.execute("DELETE FROM fund_doc_items WHERE doc_id=?", (doc_id,))
        for it in (kw.get('items') or []):
            db.execute(
                """INSERT INTO fund_doc_items
                   (doc_id, tenant_id, ref_type, ref_id, ref_no, amount, cost, product_id,
                    product_name, qty, remark)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                (doc_id, tenant_id, it.get('ref_type', ''), int(it.get('ref_id', 0) or 0),
                 it.get('ref_no', ''), float(it.get('amount', 0) or 0),
                 float(it.get('cost', 0) or 0), int(it.get('product_id', 0) or 0),
                 it.get('product_name', ''), float(it.get('qty', 0) or 0), it.get('remark', ''))
            )
        if kw.get('items'):
            tot = sum(float(it.get('amount', 0) or 0) for it in kw['items'])
            db.execute("UPDATE fund_docs SET amount=? WHERE id=?", (tot, doc_id))
    return {'success': True}


def _last_balance(tenant_id, account, conn=None):
    db = conn if conn is not None else get_db(tenant_id)
    try:
        r = db.execute(
            "SELECT balance_after FROM fund_flow WHERE tenant_id=? AND account=? "
            "ORDER BY id DESC LIMIT 1", (tenant_id, account)
        ).fetchone()
        if r:
            return float(r['balance_after'])
        acc = db.execute(
            "SELECT opening_balance FROM fund_accounts WHERE tenant_id=? AND name=?",
            (tenant_id, account)
        ).fetchone()
        return float(acc['opening_balance'] if acc else 0)
    finally:
        if conn is None:
            db.close()


def doc_post(tenant_id, doc_id):
    now = _now()
    with get_db(tenant_id) as db:
        r = db.execute(
            "SELECT * FROM fund_docs WHERE tenant_id=? AND id=?", (tenant_id, doc_id)
        ).fetchone()
        if not r:
            return {'error': 'not found'}
        if r['status'] != 'draft':
            return {'error': '只有草稿可过账'}
        amount = float(r['amount'] or 0)
        # 资金调拨：一正一负两笔流水（同 account 互转不进余额，这里简化为两笔分别记账）
        signed = amount if r['doc_type'] in ('receipt', 'advance-receipt', 'internal-income',
                                              'sales-settle', 'return-settle', 'other-receivable',
                                              'customer-fee') else -amount
        bal = _last_balance(tenant_id, r['account'], db) + signed
        db.execute(
            """INSERT INTO fund_flow
               (tenant_id, doc_id, doc_type, doc_no, bill_date, party_type, party_id,
                party_name, account, amount, balance_after, remark, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (tenant_id, doc_id, r['doc_type'], r['doc_no'], r['bill_date'], r['party_type'],
             r['party_id'], r['party_name'], r['account'], signed, bal, r['remark'], now)
        )
        if r['doc_type'] == 'transfer':
            # 对方账户（account 形如 "A → B"）
            to_acc = (r['account'].split('→')[-1] or '').strip()
            if to_acc and to_acc != r['account']:
                bal2 = _last_balance(tenant_id, to_acc, db) + amount
                db.execute(
                    """INSERT INTO fund_flow
                       (tenant_id, doc_id, doc_type, doc_no, bill_date, party_type, party_id,
                        party_name, account, amount, balance_after, remark, created_at)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (tenant_id, doc_id, r['doc_type'], r['doc_no'], r['bill_date'],
                     r['party_type'], r['party_id'], r['party_name'], to_acc, amount, bal2,
                     r['remark'], now)
                )
        db.execute(
            "UPDATE fund_docs SET status='posted', posted_at=? WHERE id=?",
            (now, doc_id)
        )
        if r['account']:
            _recompute_account_balance(tenant_id, r['account'], db)
            if r['doc_type'] == 'transfer':
                to_acc = (r['account'].split('→')[-1] or '').strip()
                if to_acc and to_acc != r['account']:
                    _recompute_account_balance(tenant_id, to_acc, db)
        # 成本调价单：写过成本快照
        if r['doc_type'] == 'cost-adjust':
            _apply_cost_adjust(db, tenant_id, doc_id)
    return {'success': True}


def _apply_cost_adjust(db, tenant_id, doc_id):
    now = date.today().isoformat()
    items = db.execute(
        "SELECT * FROM fund_doc_items WHERE doc_id=?", (doc_id,)
    ).fetchall()
    for it in items:
        db.execute(
            """INSERT INTO cost_snapshots
               (tenant_id, product_id, product_name, spec, unit, qty, avg_cost, amount, abnormal, snapshot_date, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(tenant_id, product_id) DO UPDATE SET
                 avg_cost=excluded.avg_cost, amount=qty*excluded.avg_cost,
                 updated_at=excluded.updated_at, abnormal=0""",
            (tenant_id, it['product_id'], it['product_name'], '', '',
             float(it['qty'] or 0), float(it['cost'] or 0),
             float(it['qty'] or 0) * float(it['cost'] or 0), 0, now, now)
        )


def doc_void(tenant_id, doc_id):
    with get_db(tenant_id) as db:
        r = db.execute(
            "SELECT account, status FROM fund_docs WHERE tenant_id=? AND id=?", (tenant_id, doc_id)
        ).fetchone()
        if not r:
            return {'error': 'not found'}
        if r['status'] == 'void':
            return {'error': '已是作废状态'}
        db.execute("UPDATE fund_docs SET status='void' WHERE tenant_id=? AND id=?", (tenant_id, doc_id))
        if r['status'] == 'posted' and r['account']:
            db.execute("DELETE FROM fund_flow WHERE tenant_id=? AND doc_id=?", (tenant_id, doc_id))
            _recompute_account_balance(tenant_id, r['account'], db)
    return {'success': True}


# --------------------------- 余额 / 流水 ---------------------------
def balance_summary(tenant_id):
    with get_db(tenant_id) as db:
        rows = db.execute(
            "SELECT * FROM fund_accounts WHERE tenant_id=? ORDER BY id", (tenant_id,)
        ).fetchall()
    accounts = [dict(r) for r in rows]
    total = sum(float(a['current_balance'] or 0) for a in accounts)
    return {'accounts': accounts, 'total': total}


def flow_list(tenant_id, filters=None):
    filters = filters or {}
    where = ["tenant_id=?"]
    args = [tenant_id]
    if filters.get('account'):
        where.append("account=?")
        args.append(filters['account'])
    if filters.get('date_from'):
        where.append("bill_date>=?")
        args.append(filters['date_from'])
    if filters.get('date_to'):
        where.append("bill_date<=?")
        args.append(filters['date_to'])
    if filters.get('party_type') and filters['party_type'] != 'all':
        where.append("party_type=?")
        args.append(filters['party_type'])
    if filters.get('party_id'):
        where.append("party_id=?")
        args.append(filters['party_id'])
    limit = int(filters.get('limit', 200) or 200)
    with get_db(tenant_id) as db:
        rows = db.execute(
            f"SELECT * FROM fund_flow WHERE {' AND '.join(where)} "
            f"ORDER BY bill_date DESC, id DESC LIMIT {limit}", args
        ).fetchall()
    return [dict(r) for r in rows]


# --------------------------- 对账（客户 / 供应商）---------------------------
def statement(tenant_id, party_type, party_id=None, date_from='', date_to=''):
    where = ["tenant_id=?", "party_type=?", "status='posted'"]
    args = [tenant_id, party_type]
    if party_id:
        where.append("party_id=?")
        args.append(party_id)
    if date_from:
        where.append("bill_date>=?")
        args.append(date_from)
    if date_to:
        where.append("bill_date<=?")
        args.append(date_to)
    with get_db(tenant_id) as db:
        docs = db.execute(
            f"SELECT * FROM fund_docs WHERE {' AND '.join(where)} ORDER BY bill_date, id",
            args
        ).fetchall()
        parties = db.execute(
            "SELECT party_name, MAX(party_id) party_id FROM fund_docs "
            "WHERE tenant_id=? AND party_type=? AND party_name<>'' GROUP BY party_name",
            (tenant_id, party_type)
        ).fetchall()
    rows = []
    for p in parties:
        pid = p['party_id']
        sub = [dict(d) for d in docs if d['party_id'] == pid]
        recv = sum(float(d['amount'] or 0) for d in sub if d['doc_type'] in ('receipt', 'advance-receipt', 'sales-settle', 'return-settle', 'other-receivable', 'customer-fee'))
        pay = sum(float(d['amount'] or 0) for d in sub if d['doc_type'] in ('payment', 'advance-payment', 'purchase-settle', 'supplier-fee'))
        # 应收为正、应付为正；期末余额 = 应收 - 应付（客户方向）
        balance = recv - pay
        rows.append({
            'party_id': pid, 'party_name': p['party_name'],
            'doc_count': len(sub), 'receivable': recv, 'payable': pay,
            'balance': balance, 'docs': sub
        })
    if party_id:
        rows = [r for r in rows if r['party_id'] == party_id]
    return rows


# --------------------------- 成本 ---------------------------
def cost_query(tenant_id, keyword=''):
    with get_db(tenant_id) as db:
        if keyword:
            rows = db.execute(
                "SELECT * FROM cost_snapshots WHERE tenant_id=? AND (product_name LIKE ? OR spec LIKE ?)",
                (tenant_id, f"%{keyword}%", f"%{keyword}%")
            ).fetchall()
        else:
            rows = db.execute(
                "SELECT * FROM cost_snapshots WHERE tenant_id=? ORDER BY id", (tenant_id,)
            ).fetchall()
    return [dict(r) for r in rows]


def cost_summary(tenant_id):
    with get_db(tenant_id) as db:
        rows = db.execute(
            "SELECT product_id, product_name, spec, unit, SUM(qty) qty, "
            "SUM(amount) amount FROM cost_snapshots WHERE tenant_id=? GROUP BY product_id",
            (tenant_id,)
        ).fetchall()
    return [dict(r) for r in rows]


def cost_abnormal(tenant_id):
    with get_db(tenant_id) as db:
        rows = db.execute(
            "SELECT * FROM cost_snapshots WHERE tenant_id=? AND (abnormal=1 OR avg_cost<=0 OR qty<0)",
            (tenant_id,)
        ).fetchall()
    return [dict(r) for r in rows]


def staff_debt(tenant_id):
    """员工欠款 = 内部费用单（员工借款）未冲销部分；简化为按 operator/remark 归集。
       这里以「内部费用单 + 内部收入单」净额近似：支出 - 回收。"""
    with get_db(tenant_id) as db:
        rows = db.execute(
            """SELECT party_name, SUM(CASE WHEN doc_type='internal-fee' THEN amount ELSE 0 END) AS fee,
                      SUM(CASE WHEN doc_type='internal-income' THEN amount ELSE 0 END) AS income
               FROM fund_docs WHERE tenant_id=? AND party_type='internal' AND status='posted'
               GROUP BY party_name""",
            (tenant_id,)
        ).fetchall()
    out = []
    for r in rows:
        debt = float(r['fee'] or 0) - float(r['income'] or 0)
        if debt > 0.0001:
            out.append({'staff': r['party_name'], 'debt': debt,
                        'fee': float(r['fee'] or 0), 'income': float(r['income'] or 0)})
    return out


def bank_reconcile(tenant_id, account='', date_from='', date_to=''):
    """银行流水对账：只统计**银行类账户**的已过账流水，供与银行对账单勾对。
       返回银行类账户 + 其流水。

       🔴 两个坑（2026-10-11 本地自测发现，均已修）：
       ① **未按银行账户过滤**：`flow_list` 在 `account` 为空时返回**全部账户**流水，
          于是「现金」这类非银行账户的行会混进"银行流水对账"里（自测实际返回 2 笔、
          应为 1 笔）。修法：先取银行类账户名，再按名字集合过滤；显式指定 account 时只留该账户。
       ② **嵌套连接**：原先在 `with get_db(...)` 里调 `flow_list`（它自己再开一个连接）
          ⇒ 与 `doc_post` 撞过同一个 "database is locked"（见 `_recompute_account_balance` 的修法）。
          这里把 `flow_list` 移到 `with` 之外 ⇒ 两次连接是**先后顺序**，不再嵌套。"""
    with get_db(tenant_id) as db:
        accs = [dict(a) for a in db.execute(
            "SELECT * FROM fund_accounts WHERE tenant_id=? AND type='银行'", (tenant_id,)
        ).fetchall()]
    bank_names = {a['name'] for a in accs}
    flow = flow_list(tenant_id, {'account': account, 'date_from': date_from, 'date_to': date_to})
    # ① 恒先卡「必须是银行类账户」（即便显式传了 account），② 再按显式账户收窄
    #    ⇒ 问「现金」得到空表（它是非银行类，不属于本页语义），而不是把整本账的现金流水吐出来。
    flow = [r for r in flow if r.get('account') in bank_names]
    if account:
        flow = [r for r in flow if r.get('account') == account]
    return {'accounts': accs, 'flow': flow}
