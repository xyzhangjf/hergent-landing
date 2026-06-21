"""
Hergent ERP 数据库模块
SQLite 本地数据库，存储进销存核心数据
"""

import sqlite3
import os
from contextlib import contextmanager
from datetime import datetime, timedelta

DB_PATH = os.path.join(os.path.expanduser("~"), "Library", "Application Support", "hergent", "erp.db")
os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)


@contextmanager
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        yield conn
    finally:
        conn.close()


def init_db():
    with get_db() as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                spec TEXT DEFAULT '',
                unit TEXT DEFAULT '件',
                barcode TEXT DEFAULT '',
                brand TEXT DEFAULT '',
                category TEXT DEFAULT '',
                purchase_price REAL DEFAULT 0,
                sale_price REAL DEFAULT 0,
                safety_stock INTEGER DEFAULT 0,
                expiry_days INTEGER DEFAULT 0,
                is_active INTEGER DEFAULT 1,
                created_at TEXT DEFAULT (datetime('now','localtime')),
                updated_at TEXT DEFAULT (datetime('now','localtime'))
            );

            CREATE TABLE IF NOT EXISTS contacts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT NOT NULL CHECK(type IN ('customer','supplier','both')),
                name TEXT NOT NULL,
                phone TEXT DEFAULT '',
                address TEXT DEFAULT '',
                settlement_method TEXT DEFAULT '现结',
                credit_days INTEGER DEFAULT 0,
                employee_id TEXT DEFAULT '',
                is_active INTEGER DEFAULT 1,
                created_at TEXT DEFAULT (datetime('now','localtime')),
                updated_at TEXT DEFAULT (datetime('now','localtime'))
            );

            CREATE TABLE IF NOT EXISTS warehouses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                is_default INTEGER DEFAULT 0
            );

            INSERT OR IGNORE INTO warehouses (id, name, is_default) VALUES (1, '默认仓库', 1);

            CREATE TABLE IF NOT EXISTS inventory (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_id INTEGER NOT NULL,
                warehouse_id INTEGER DEFAULT 1,
                quantity INTEGER DEFAULT 0,
                cost_price REAL DEFAULT 0,
                batch_no TEXT DEFAULT '',
                expiry_date TEXT DEFAULT '',
                updated_at TEXT DEFAULT (datetime('now','localtime')),
                FOREIGN KEY (product_id) REFERENCES products(id)
            );

            CREATE TABLE IF NOT EXISTS purchase_orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_no TEXT NOT NULL UNIQUE,
                supplier_id INTEGER NOT NULL,
                warehouse_id INTEGER DEFAULT 1,
                total_amount REAL DEFAULT 0,
                paid_amount REAL DEFAULT 0,
                status TEXT DEFAULT 'draft' CHECK(status IN ('draft','confirmed','received','settled','cancelled')),
                order_date TEXT DEFAULT (datetime('now','localtime')),
                note TEXT DEFAULT '',
                operator_id TEXT DEFAULT '',
                created_at TEXT DEFAULT (datetime('now','localtime')),
                updated_at TEXT DEFAULT (datetime('now','localtime')),
                FOREIGN KEY (supplier_id) REFERENCES contacts(id)
            );

            CREATE TABLE IF NOT EXISTS purchase_order_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_id INTEGER NOT NULL,
                product_id INTEGER NOT NULL,
                quantity INTEGER NOT NULL,
                unit_price REAL DEFAULT 0,
                amount REAL DEFAULT 0,
                FOREIGN KEY (order_id) REFERENCES purchase_orders(id),
                FOREIGN KEY (product_id) REFERENCES products(id)
            );

            CREATE TABLE IF NOT EXISTS sale_orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_no TEXT NOT NULL UNIQUE,
                customer_id INTEGER NOT NULL,
                warehouse_id INTEGER DEFAULT 1,
                total_amount REAL DEFAULT 0,
                received_amount REAL DEFAULT 0,
                discount REAL DEFAULT 0,
                status TEXT DEFAULT 'draft' CHECK(status IN ('draft','delivered','signed','settled','cancelled')),
                order_date TEXT DEFAULT (datetime('now','localtime')),
                delivery_date TEXT DEFAULT '',
                note TEXT DEFAULT '',
                operator_id TEXT DEFAULT '',
                driver_id TEXT DEFAULT '',
                created_at TEXT DEFAULT (datetime('now','localtime')),
                updated_at TEXT DEFAULT (datetime('now','localtime')),
                FOREIGN KEY (customer_id) REFERENCES contacts(id)
            );

            CREATE TABLE IF NOT EXISTS sale_order_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_id INTEGER NOT NULL,
                product_id INTEGER NOT NULL,
                quantity INTEGER NOT NULL,
                unit_price REAL DEFAULT 0,
                amount REAL DEFAULT 0,
                FOREIGN KEY (order_id) REFERENCES sale_orders(id),
                FOREIGN KEY (product_id) REFERENCES products(id)
            );

            CREATE TABLE IF NOT EXISTS inventory_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_id INTEGER NOT NULL,
                warehouse_id INTEGER DEFAULT 1,
                change_type TEXT NOT NULL CHECK(change_type IN ('purchase_in','sale_out','sale','purchase','return_in','check','loss','transfer')),
                change_qty INTEGER NOT NULL,
                before_qty INTEGER DEFAULT 0,
                after_qty INTEGER DEFAULT 0,
                cost_price REAL DEFAULT 0,
                ref_type TEXT DEFAULT '',
                ref_id INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now','localtime')),
                FOREIGN KEY (product_id) REFERENCES products(id)
            );

            CREATE TABLE IF NOT EXISTS receivables (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT NOT NULL CHECK(type IN ('ar','ap')),
                contact_id INTEGER NOT NULL,
                ref_type TEXT DEFAULT '',
                ref_id INTEGER DEFAULT 0,
                amount REAL DEFAULT 0,
                paid_amount REAL DEFAULT 0,
                status TEXT DEFAULT 'unpaid' CHECK(status IN ('unpaid','partial','paid')),
                due_date TEXT DEFAULT '',
                settled_at TEXT DEFAULT '',
                created_at TEXT DEFAULT (datetime('now','localtime')),
                FOREIGN KEY (contact_id) REFERENCES contacts(id)
            );

            CREATE TABLE IF NOT EXISTS cash_flow (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account TEXT DEFAULT '现金',
                type TEXT NOT NULL CHECK(type IN ('income','expense')),
                category TEXT DEFAULT '',
                amount REAL NOT NULL,
                balance_after REAL DEFAULT 0,
                contact_id INTEGER DEFAULT 0,
                ref_type TEXT DEFAULT '',
                ref_id INTEGER DEFAULT 0,
                note TEXT DEFAULT '',
                operator_id TEXT DEFAULT '',
                created_at TEXT DEFAULT (datetime('now','localtime'))
            );

            CREATE TABLE IF NOT EXISTS accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                current_balance REAL DEFAULT 0
            );

            INSERT OR IGNORE INTO accounts (id, name, current_balance) VALUES (1, '现金', 0);
            INSERT OR IGNORE INTO accounts (id, name, current_balance) VALUES (2, '微信', 0);
            INSERT OR IGNORE INTO accounts (id, name, current_balance) VALUES (3, '支付宝', 0);
            INSERT OR IGNORE INTO accounts (id, name, current_balance) VALUES (4, '银行', 0);
        """)


# ============================================================
# 单号生成
# ============================================================

def _generate_order_no(prefix):
    today = datetime.now().strftime("%Y%m%d")
    with get_db() as db:
        row = db.execute(
            "SELECT order_no FROM purchase_orders WHERE order_no LIKE ? ORDER BY id DESC LIMIT 1",
            (f"{prefix}{today}%",)
        ).fetchone()
        if not row:
            row = db.execute(
                "SELECT order_no FROM sale_orders WHERE order_no LIKE ? ORDER BY id DESC LIMIT 1",
                (f"{prefix}{today}%",)
            ).fetchone()
        if row:
            last = row[0]
            seq = int(last[-4:]) + 1
        else:
            seq = 1
    return f"{prefix}{today}{seq:04d}"


# ============================================================
# 商品管理
# ============================================================

def product_create(name, **kwargs):
    with get_db() as db:
        allowed = ['spec','unit','barcode','brand','category','purchase_price','sale_price','safety_stock','expiry_days']
        fields = {'name': name}
        for k in allowed:
            if k in kwargs:
                fields[k] = kwargs[k]
        columns = ', '.join(fields.keys())
        placeholders = ', '.join(['?' for _ in fields])
        cur = db.execute(f"INSERT INTO products ({columns}) VALUES ({placeholders})", tuple(fields.values()))
        db.commit()
        return cur.lastrowid


def product_update(product_id, **kwargs):
    allowed = ['name','spec','unit','barcode','brand','category','purchase_price','sale_price','safety_stock','expiry_days','is_active']
    sets = []
    vals = []
    for k in allowed:
        if k in kwargs:
            sets.append(f"{k}=?")
            vals.append(kwargs[k])
    if not sets:
        return
    sets.append("updated_at=datetime('now','localtime')")
    vals.append(product_id)
    with get_db() as db:
        db.execute(f"UPDATE products SET {', '.join(sets)} WHERE id=?", vals)
        db.commit()


def product_list(keyword='', brand='', category='', include_inactive=False):
    with get_db() as db:
        where = []
        params = []
        if not include_inactive:
            where.append("is_active=1")
        if keyword:
            where.append("(name LIKE ? OR barcode LIKE ? OR spec LIKE ?)")
            k = f"%{keyword}%"
            params.extend([k, k, k])
        if brand:
            where.append("brand=?")
            params.append(brand)
        if category:
            where.append("category=?")
            params.append(category)
        sql = "SELECT * FROM products"
        if where:
            sql += " WHERE " + " AND ".join(where)
        sql += " ORDER BY id DESC"
        return [dict(r) for r in db.execute(sql, params).fetchall()]


def product_get(product_id):
    with get_db() as db:
        r = db.execute("SELECT * FROM products WHERE id=?", (product_id,)).fetchone()
        return dict(r) if r else None


# ============================================================
# 客户/供应商管理
# ============================================================

def contact_create(name, contact_type='customer', **kwargs):
    with get_db() as db:
        allowed = ['phone','address','settlement_method','credit_days','employee_id']
        fields = {'name': name, 'type': contact_type}
        for k in allowed:
            if k in kwargs:
                fields[k] = kwargs[k]
        columns = ', '.join(fields.keys())
        placeholders = ', '.join(['?' for _ in fields])
        cur = db.execute(f"INSERT INTO contacts ({columns}) VALUES ({placeholders})", tuple(fields.values()))
        db.commit()
        return cur.lastrowid


def contact_update(contact_id, **kwargs):
    allowed = ['name','type','phone','address','settlement_method','credit_days','employee_id','is_active']
    sets = []
    vals = []
    for k in allowed:
        if k in kwargs:
            sets.append(f"{k}=?")
            vals.append(kwargs[k])
    if not sets:
        return
    sets.append("updated_at=datetime('now','localtime')")
    vals.append(contact_id)
    with get_db() as db:
        db.execute(f"UPDATE contacts SET {', '.join(sets)} WHERE id=?", vals)
        db.commit()


def contact_list(keyword='', contact_type='', include_inactive=False):
    with get_db() as db:
        where = []
        params = []
        if not include_inactive:
            where.append("is_active=1")
        if keyword:
            where.append("(name LIKE ? OR phone LIKE ?)")
            k = f"%{keyword}%"
            params.extend([k, k])
        if contact_type:
            where.append("type IN (?, 'both')" if contact_type == 'customer' else "type IN (?, 'both')")
            params.append(contact_type)
        sql = "SELECT * FROM contacts"
        if where:
            sql += " WHERE " + " AND ".join(where)
        sql += " ORDER BY id DESC"
        return [dict(r) for r in db.execute(sql, params).fetchall()]


def contact_get(contact_id):
    with get_db() as db:
        r = db.execute("SELECT * FROM contacts WHERE id=?", (contact_id,)).fetchone()
        return dict(r) if r else None


def contact_receivable_summary(contact_id):
    """客户应收汇总"""
    with get_db() as db:
        r = db.execute(
            "SELECT SUM(amount - paid_amount) as balance, COUNT(*) as count FROM receivables WHERE contact_id=? AND type='ar' AND status!='paid'",
            (contact_id,)
        ).fetchone()
        return dict(r) if r else {'balance': 0, 'count': 0}


# ============================================================
# 库存管理
# ============================================================

def inventory_query(keyword='', brand='', warehouse_id=1, low_stock_only=False):
    with get_db() as db:
        where = ["inv.warehouse_id=?", "p.is_active=1"]
        params = [warehouse_id]
        if keyword:
            where.append("(p.name LIKE ? OR p.barcode LIKE ?)")
            k = f"%{keyword}%"
            params.extend([k, k])
        if brand:
            where.append("p.brand=?")
            params.append(brand)
        if low_stock_only:
            where.append("COALESCE(inv.quantity,0) <= p.safety_stock")

        sql = """
            SELECT p.id, p.name, p.spec, p.unit, p.brand, p.category,
                   p.sale_price, p.purchase_price, p.safety_stock,
                   COALESCE(inv.quantity, 0) as quantity,
                   COALESCE(inv.cost_price, p.purchase_price) as cost_price,
                   inv.batch_no, inv.expiry_date
            FROM products p
            LEFT JOIN inventory inv ON p.id = inv.product_id AND inv.warehouse_id=?
            WHERE """ + " AND ".join(where) + """
            ORDER BY p.name
        """
        params.insert(0, warehouse_id)
        return [dict(r) for r in db.execute(sql, params).fetchall()]


def inventory_adjust(product_id, warehouse_id, qty_change, cost_price=0, ref_type='', ref_id=0):
    """库存变动（保证事务）"""
    with get_db() as db:
        inv = db.execute(
            "SELECT id, quantity FROM inventory WHERE product_id=? AND warehouse_id=?",
            (product_id, warehouse_id)
        ).fetchone()

        if inv:
            before_qty = inv['quantity']
            after_qty = before_qty + qty_change
            db.execute(
                "UPDATE inventory SET quantity=?, cost_price=?, updated_at=datetime('now','localtime') WHERE id=?",
                (after_qty, cost_price if cost_price > 0 else db.execute("SELECT cost_price FROM inventory WHERE id=?", (inv['id'],)).fetchone()['cost_price'], inv['id'])
            )
        else:
            before_qty = 0
            after_qty = qty_change
            db.execute(
                "INSERT INTO inventory (product_id, warehouse_id, quantity, cost_price) VALUES (?,?,?,?)",
                (product_id, warehouse_id, after_qty, cost_price)
            )

        db.execute(
            "INSERT INTO inventory_logs (product_id, warehouse_id, change_type, change_qty, before_qty, after_qty, cost_price, ref_type, ref_id) VALUES (?,?,?,?,?,?,?,?,?)",
            (product_id, warehouse_id, ref_type, qty_change, before_qty, after_qty, cost_price, ref_type, ref_id)
        )
        db.commit()


# ============================================================
# 采购管理
# ============================================================

def purchase_order_create(supplier_id, items, warehouse_id=1, note='', operator_id=''):
    """创建采购单。items: [{product_id, quantity, unit_price}]"""
    order_no = _generate_order_no("PO")
    total_amount = sum(it['quantity'] * it['unit_price'] for it in items)

    with get_db() as db:
        cur = db.execute(
            "INSERT INTO purchase_orders (order_no, supplier_id, warehouse_id, total_amount, status, note, operator_id) VALUES (?,?,?,?,'draft',?,?)",
            (order_no, supplier_id, warehouse_id, total_amount, note, operator_id)
        )
        order_id = cur.lastrowid
        for it in items:
            amount = it['quantity'] * it['unit_price']
            db.execute(
                "INSERT INTO purchase_order_items (order_id, product_id, quantity, unit_price, amount) VALUES (?,?,?,?,?)",
                (order_id, it['product_id'], it['quantity'], it['unit_price'], amount)
            )
        db.commit()
        return {'order_id': order_id, 'order_no': order_no, 'total_amount': total_amount}


def purchase_order_confirm(order_id):
    """确认入库：更新库存 + 应收应付 + 库存流水"""
    with get_db() as db:
        order = db.execute("SELECT * FROM purchase_orders WHERE id=? AND status='draft'", (order_id,)).fetchone()
        if not order:
            return {'error': '采购单不存在或状态不是草稿'}

        items = db.execute("SELECT * FROM purchase_order_items WHERE order_id=?", (order_id,)).fetchall()

        for it in items:
            inventory_adjust(it['product_id'], order['warehouse_id'], it['quantity'],
                             cost_price=it['unit_price'], ref_type='purchase', ref_id=order_id)

        db.execute("UPDATE purchase_orders SET status='received', updated_at=datetime('now','localtime') WHERE id=?", (order_id,))

        # 生成应付
        db.execute(
            "INSERT INTO receivables (type, contact_id, ref_type, ref_id, amount, paid_amount, status) VALUES ('ap',?, 'purchase', ?, ?, 0, 'unpaid')",
            (order['supplier_id'], order_id, order['total_amount'])
        )
        db.commit()
        return {'order_id': order_id, 'order_no': order['order_no'], 'status': 'received'}


def purchase_order_list(status='', supplier_id=0, date_from='', date_to='', limit=50, offset=0):
    with get_db() as db:
        where = []
        params = []
        if status:
            where.append("po.status=?")
            params.append(status)
        if supplier_id:
            where.append("po.supplier_id=?")
            params.append(supplier_id)
        if date_from:
            where.append("po.order_date >= ?")
            params.append(date_from)
        if date_to:
            where.append("po.order_date <= ?")
            params.append(date_to)
        sql = """
            SELECT po.*, c.name as supplier_name
            FROM purchase_orders po
            LEFT JOIN contacts c ON po.supplier_id = c.id
        """
        if where:
            sql += " WHERE " + " AND ".join(where)
        sql += " ORDER BY po.id DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        orders = [dict(r) for r in db.execute(sql, params).fetchall()]
        total = db.execute("SELECT COUNT(*) FROM purchase_orders po" + (" WHERE " + " AND ".join(where) if where else ""), params[:-2]).fetchone()[0]
        return {'orders': orders, 'total': total}


def purchase_order_get(order_id):
    with get_db() as db:
        order = db.execute(
            "SELECT po.*, c.name as supplier_name FROM purchase_orders po LEFT JOIN contacts c ON po.supplier_id=c.id WHERE po.id=?",
            (order_id,)
        ).fetchone()
        if not order:
            return None
        items = db.execute(
            "SELECT poi.*, p.name as product_name, p.spec, p.unit FROM purchase_order_items poi LEFT JOIN products p ON poi.product_id=p.id WHERE poi.order_id=?",
            (order_id,)
        ).fetchall()
        return {'order': dict(order), 'items': [dict(it) for it in items]}


# ============================================================
# 销售管理
# ============================================================

def sale_order_create(customer_id, items, warehouse_id=1, discount=0, note='', operator_id='', driver_id=''):
    """创建销售单"""
    order_no = _generate_order_no("SO")
    total_amount = sum(it['quantity'] * it['unit_price'] for it in items) - discount

    with get_db() as db:
        cur = db.execute(
            "INSERT INTO sale_orders (order_no, customer_id, warehouse_id, total_amount, discount, status, note, operator_id, driver_id) VALUES (?,?,?,?,?,'draft',?,?,?)",
            (order_no, customer_id, warehouse_id, total_amount, discount, note, operator_id, driver_id)
        )
        order_id = cur.lastrowid
        for it in items:
            amount = it['quantity'] * it['unit_price']
            db.execute(
                "INSERT INTO sale_order_items (order_id, product_id, quantity, unit_price, amount) VALUES (?,?,?,?,?)",
                (order_id, it['product_id'], it['quantity'], it['unit_price'], amount)
            )
        db.commit()
        return {'order_id': order_id, 'order_no': order_no, 'total_amount': total_amount}


def sale_order_deliver(order_id):
    """出库签收：减少库存 + 生成应收"""
    with get_db() as db:
        order = db.execute("SELECT * FROM sale_orders WHERE id=? AND status='draft'", (order_id,)).fetchone()
        if not order:
            return {'error': '销售单不存在或状态不是草稿'}

        items = db.execute("SELECT * FROM sale_order_items WHERE order_id=?", (order_id,)).fetchall()

        for it in items:
            inventory_adjust(it['product_id'], order['warehouse_id'], -it['quantity'],
                             ref_type='sale', ref_id=order_id)

        db.execute("UPDATE sale_orders SET status='delivered', delivery_date=datetime('now','localtime'), updated_at=datetime('now','localtime') WHERE id=?", (order_id,))

        # 生成应收
        db.execute(
            "INSERT INTO receivables (type, contact_id, ref_type, ref_id, amount, paid_amount, status) VALUES ('ar',?, 'sale', ?, ?, 0, 'unpaid')",
            (order['customer_id'], order_id, order['total_amount'])
        )
        db.commit()
        return {'order_id': order_id, 'order_no': order['order_no'], 'status': 'delivered'}


def sale_order_sign(order_id):
    """客户签收：仅更新状态"""
    with get_db() as db:
        order = db.execute("SELECT * FROM sale_orders WHERE id=? AND status='delivered'", (order_id,)).fetchone()
        if not order:
            return {'error': '销售单不存在或状态不是已出库'}
        db.execute("UPDATE sale_orders SET status='signed', updated_at=datetime('now','localtime') WHERE id=?", (order_id,))
        db.commit()
        return {'order_id': order_id, 'order_no': order['order_no'], 'status': 'signed'}


def sale_order_list(status='', customer_id=0, date_from='', date_to='', operator_id='', limit=50, offset=0):
    with get_db() as db:
        where = []
        params = []
        if status:
            where.append("so.status=?")
            params.append(status)
        if customer_id:
            where.append("so.customer_id=?")
            params.append(customer_id)
        if date_from:
            where.append("so.order_date >= ?")
            params.append(date_from)
        if date_to:
            where.append("so.order_date <= ?")
            params.append(date_to)
        if operator_id:
            where.append("so.operator_id=?")
            params.append(operator_id)
        sql = """
            SELECT so.*, c.name as customer_name
            FROM sale_orders so
            LEFT JOIN contacts c ON so.customer_id = c.id
        """
        if where:
            sql += " WHERE " + " AND ".join(where)
        sql += " ORDER BY so.id DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        orders = [dict(r) for r in db.execute(sql, params).fetchall()]
        total = db.execute("SELECT COUNT(*) FROM sale_orders so" + (" WHERE " + " AND ".join(where) if where else ""), params[:-2]).fetchone()[0]
        return {'orders': orders, 'total': total}


def sale_order_get(order_id):
    with get_db() as db:
        order = db.execute(
            "SELECT so.*, c.name as customer_name FROM sale_orders so LEFT JOIN contacts c ON so.customer_id=c.id WHERE so.id=?",
            (order_id,)
        ).fetchone()
        if not order:
            return None
        items = db.execute(
            "SELECT soi.*, p.name as product_name, p.spec, p.unit FROM sale_order_items soi LEFT JOIN products p ON soi.product_id=p.id WHERE soi.order_id=?",
            (order_id,)
        ).fetchall()
        return {'order': dict(order), 'items': [dict(it) for it in items]}


# ============================================================
# 收支管理
# ============================================================

def payment_create(contact_id, amount, pay_type='ar', account='现金', category='', note='', operator_id='', ref_id=0, ref_type=''):
    """收款/付款。pay_type: ar=收款, ap=付款"""
    with get_db() as db:
        # 更新应收/应付
        if ref_id and ref_type:
            db.execute(
                "UPDATE receivables SET paid_amount=paid_amount+?, status=CASE WHEN paid_amount+?>=amount THEN 'paid' WHEN paid_amount+?>0 THEN 'partial' ELSE status END, settled_at=datetime('now','localtime') WHERE id=?",
                (amount, amount, amount, ref_id)
            )

        # 记录流水
        cf_type = 'income' if pay_type == 'ar' else 'expense'
        cf_amount = amount if pay_type == 'ar' else -amount

        # 更新账户余额
        db.execute("UPDATE accounts SET current_balance=current_balance+? WHERE name=?", (cf_amount, account))

        bal = db.execute("SELECT current_balance FROM accounts WHERE name=?", (account,)).fetchone()
        balance_after = bal['current_balance'] if bal else 0

        cur = db.execute(
            "INSERT INTO cash_flow (account, type, category, amount, balance_after, contact_id, ref_type, ref_id, note, operator_id) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (account, cf_type, category, abs(amount), balance_after, contact_id, ref_type, ref_id, note, operator_id)
        )
        db.commit()
        return cur.lastrowid


def payment_list(date_from='', date_to='', contact_id=0, account='', limit=50, offset=0):
    with get_db() as db:
        where = []
        params = []
        if date_from:
            where.append("created_at >= ?")
            params.append(date_from)
        if date_to:
            where.append("created_at <= ?")
            params.append(date_to)
        if contact_id:
            where.append("contact_id=?")
            params.append(contact_id)
        if account:
            where.append("account=?")
            params.append(account)
        sql = "SELECT * FROM cash_flow"
        if where:
            sql += " WHERE " + " AND ".join(where)
        sql += " ORDER BY id DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        rows = [dict(r) for r in db.execute(sql, params).fetchall()]
        total = db.execute("SELECT COUNT(*) FROM cash_flow" + (" WHERE " + " AND ".join(where) if where else ""), params[:-2]).fetchone()[0]
        return {'payments': rows, 'total': total}


def receivable_list(contact_type='', status='', limit=50, offset=0):
    with get_db() as db:
        where = []
        params = []
        if contact_type:
            where.append("r.type=?")
            params.append('ar' if contact_type == 'customer' else 'ap')
        if status:
            where.append("r.status=?")
            params.append(status)
        sql = """
            SELECT r.*, c.name as contact_name, c.type as contact_type
            FROM receivables r LEFT JOIN contacts c ON r.contact_id=c.id
        """
        if where:
            sql += " WHERE " + " AND ".join(where)
        sql += " ORDER BY r.id DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        rows = [dict(r) for r in db.execute(sql, params).fetchall()]
        total = db.execute("SELECT COUNT(*) FROM receivables r" + (" WHERE " + " AND ".join(where) if where else ""), params[:-2]).fetchone()[0]
        return {'receivables': rows, 'total': total}


def account_summary():
    with get_db() as db:
        accounts = [dict(r) for r in db.execute("SELECT * FROM accounts").fetchall()]
        today = datetime.now().strftime("%Y-%m-%d")
        income = db.execute("SELECT COALESCE(SUM(amount),0) FROM cash_flow WHERE type='income' AND date(created_at)=?", (today,)).fetchone()[0]
        expense = db.execute("SELECT COALESCE(SUM(amount),0) FROM cash_flow WHERE type='expense' AND date(created_at)=?", (today,)).fetchone()[0]
        ar_total = db.execute("SELECT COALESCE(SUM(amount-paid_amount),0) FROM receivables WHERE type='ar' AND status!='paid'").fetchone()[0]
        ap_total = db.execute("SELECT COALESCE(SUM(amount-paid_amount),0) FROM receivables WHERE type='ap' AND status!='paid'").fetchone()[0]
        return {
            'accounts': accounts,
            'today_income': income,
            'today_expense': expense,
            'total_ar': ar_total,
            'total_ap': ap_total
        }


# 初始化
init_db()
