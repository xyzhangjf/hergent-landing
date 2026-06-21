"""
Hergent ERP 数据库模块 v2
参考舟谱进销存，支持完整的资金管理、费用、核销、员工交账
"""

import sqlite3, os
from contextlib import contextmanager
from datetime import datetime

DB_PATH = os.environ.get("ERP_DB_PATH", os.path.join(os.path.dirname(os.path.abspath(__file__)), "erp.db"))

@contextmanager
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    try: yield conn
    finally: conn.close()

def _gen_no(prefix):
    today = datetime.now().strftime("%Y%m%d")
    with get_db() as db:
        r = db.execute("SELECT order_no FROM purchase_orders WHERE order_no LIKE ? ORDER BY id DESC LIMIT 1",(f"{prefix}{today}%",)).fetchone()
        if not r: r = db.execute("SELECT order_no FROM sale_orders WHERE order_no LIKE ? ORDER BY id DESC LIMIT 1",(f"{prefix}{today}%",)).fetchone()
        if not r: r = db.execute("SELECT order_no FROM expense_orders WHERE order_no LIKE ? ORDER BY id DESC LIMIT 1",(f"{prefix}{today}%",)).fetchone()
        seq = int(r[0][-4:])+1 if r else 1
    return f"{prefix}{today}{seq:04d}"

# ============================================================
# Init
# ============================================================
def init_db():
    with get_db() as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,spec TEXT DEFAULT '',unit TEXT DEFAULT '件',barcode TEXT DEFAULT '',brand TEXT DEFAULT '',category TEXT DEFAULT '',purchase_price REAL DEFAULT 0,sale_price REAL DEFAULT 0,safety_stock INTEGER DEFAULT 0,expiry_days INTEGER DEFAULT 0,is_active INTEGER DEFAULT 1,created_at TEXT DEFAULT (datetime('now','localtime')),updated_at TEXT DEFAULT (datetime('now','localtime')));
            CREATE TABLE IF NOT EXISTS contacts (id INTEGER PRIMARY KEY AUTOINCREMENT,type TEXT NOT NULL DEFAULT 'customer',name TEXT NOT NULL,phone TEXT DEFAULT '',address TEXT DEFAULT '',settlement_method TEXT DEFAULT '现结',credit_days INTEGER DEFAULT 0,employee_id TEXT DEFAULT '',is_active INTEGER DEFAULT 1,created_at TEXT DEFAULT (datetime('now','localtime')),updated_at TEXT DEFAULT (datetime('now','localtime')));
            CREATE TABLE IF NOT EXISTS warehouses (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,is_default INTEGER DEFAULT 0);
            INSERT OR IGNORE INTO warehouses (id,name,is_default) VALUES (1,'默认仓库',1);
            CREATE TABLE IF NOT EXISTS inventory (id INTEGER PRIMARY KEY AUTOINCREMENT,product_id INTEGER NOT NULL,warehouse_id INTEGER DEFAULT 1,quantity INTEGER DEFAULT 0,cost_price REAL DEFAULT 0,batch_no TEXT DEFAULT '',expiry_date TEXT DEFAULT '',updated_at TEXT DEFAULT (datetime('now','localtime')),FOREIGN KEY (product_id) REFERENCES products(id));
            CREATE TABLE IF NOT EXISTS purchase_orders (id INTEGER PRIMARY KEY AUTOINCREMENT,order_no TEXT NOT NULL UNIQUE,supplier_id INTEGER NOT NULL,warehouse_id INTEGER DEFAULT 1,total_amount REAL DEFAULT 0,paid_amount REAL DEFAULT 0,status TEXT DEFAULT 'draft',order_date TEXT DEFAULT (datetime('now','localtime')),note TEXT DEFAULT '',operator_id TEXT DEFAULT '',created_at TEXT DEFAULT (datetime('now','localtime')));
            CREATE TABLE IF NOT EXISTS purchase_order_items (id INTEGER PRIMARY KEY AUTOINCREMENT,order_id INTEGER NOT NULL,product_id INTEGER NOT NULL,quantity INTEGER NOT NULL,unit_price REAL DEFAULT 0,amount REAL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS sale_orders (id INTEGER PRIMARY KEY AUTOINCREMENT,order_no TEXT NOT NULL UNIQUE,customer_id INTEGER NOT NULL,warehouse_id INTEGER DEFAULT 1,total_amount REAL DEFAULT 0,received_amount REAL DEFAULT 0,discount REAL DEFAULT 0,status TEXT DEFAULT 'draft',order_date TEXT DEFAULT (datetime('now','localtime')),note TEXT DEFAULT '',operator_id TEXT DEFAULT '',driver_id TEXT DEFAULT '',created_at TEXT DEFAULT (datetime('now','localtime')));
            CREATE TABLE IF NOT EXISTS sale_order_items (id INTEGER PRIMARY KEY AUTOINCREMENT,order_id INTEGER NOT NULL,product_id INTEGER NOT NULL,quantity INTEGER NOT NULL,unit_price REAL DEFAULT 0,amount REAL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS inventory_logs (id INTEGER PRIMARY KEY AUTOINCREMENT,product_id INTEGER NOT NULL,warehouse_id INTEGER DEFAULT 1,change_type TEXT NOT NULL,change_qty INTEGER NOT NULL,before_qty INTEGER DEFAULT 0,after_qty INTEGER DEFAULT 0,cost_price REAL DEFAULT 0,ref_type TEXT DEFAULT '',ref_id INTEGER DEFAULT 0,created_at TEXT DEFAULT (datetime('now','localtime')));
            CREATE TABLE IF NOT EXISTS receivables (id INTEGER PRIMARY KEY AUTOINCREMENT,type TEXT NOT NULL DEFAULT 'ar',contact_id INTEGER NOT NULL,ref_type TEXT DEFAULT '',ref_id INTEGER DEFAULT 0,amount REAL DEFAULT 0,paid_amount REAL DEFAULT 0,status TEXT DEFAULT 'unpaid',due_date TEXT DEFAULT '',created_at TEXT DEFAULT (datetime('now','localtime')));

            -- v2 新增
            CREATE TABLE IF NOT EXISTS cash_flow (id INTEGER PRIMARY KEY AUTOINCREMENT,account TEXT DEFAULT '现金',type TEXT NOT NULL,amount REAL NOT NULL,balance_after REAL DEFAULT 0,contact_id INTEGER DEFAULT 0,ref_type TEXT DEFAULT '',ref_id INTEGER DEFAULT 0,category TEXT DEFAULT '',note TEXT DEFAULT '',operator_id TEXT DEFAULT '',created_at TEXT DEFAULT (datetime('now','localtime')));
            CREATE TABLE IF NOT EXISTS accounts (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,current_balance REAL DEFAULT 0);
            INSERT OR IGNORE INTO accounts (id,name,current_balance) VALUES (1,'现金',0),(2,'微信',0),(3,'支付宝',0),(4,'银行',0);

            CREATE TABLE IF NOT EXISTS expense_categories (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,type TEXT DEFAULT 'customer' CHECK(type IN ('customer','supplier','internal')),parent_id INTEGER DEFAULT 0);
            CREATE TABLE IF NOT EXISTS income_categories (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,type TEXT DEFAULT 'customer' CHECK(type IN ('customer','supplier','internal')),parent_id INTEGER DEFAULT 0);

            CREATE TABLE IF NOT EXISTS expense_orders (id INTEGER PRIMARY KEY AUTOINCREMENT,order_no TEXT NOT NULL UNIQUE,type TEXT NOT NULL DEFAULT 'customer' CHECK(type IN ('customer','supplier','internal')),contact_id INTEGER NOT NULL,category_id INTEGER DEFAULT 0,amount REAL DEFAULT 0,paid_amount REAL DEFAULT 0,status TEXT DEFAULT 'unpaid',order_date TEXT DEFAULT (datetime('now','localtime')),note TEXT DEFAULT '',operator_id TEXT DEFAULT '',brand TEXT DEFAULT '',employee_id TEXT DEFAULT '',created_at TEXT DEFAULT (datetime('now','localtime')));
            CREATE TABLE IF NOT EXISTS income_orders (id INTEGER PRIMARY KEY AUTOINCREMENT,order_no TEXT NOT NULL UNIQUE,type TEXT NOT NULL DEFAULT 'customer',contact_id INTEGER NOT NULL,category_id INTEGER DEFAULT 0,amount REAL DEFAULT 0,received_amount REAL DEFAULT 0,status TEXT DEFAULT 'unpaid',order_date TEXT DEFAULT (datetime('now','localtime')),note TEXT DEFAULT '',operator_id TEXT DEFAULT '',created_at TEXT DEFAULT (datetime('now','localtime')));

            CREATE TABLE IF NOT EXISTS prepayments (id INTEGER PRIMARY KEY AUTOINCREMENT,type TEXT NOT NULL DEFAULT 'ar' CHECK(type IN ('ar','ap')),contact_id INTEGER NOT NULL,amount REAL DEFAULT 0,used_amount REAL DEFAULT 0,ref_type TEXT DEFAULT '',ref_id INTEGER DEFAULT 0,order_date TEXT DEFAULT (datetime('now','localtime')),note TEXT DEFAULT '',operator_id TEXT DEFAULT '',created_at TEXT DEFAULT (datetime('now','localtime')));

            CREATE TABLE IF NOT EXISTS writeoffs (id INTEGER PRIMARY KEY AUTOINCREMENT,order_no TEXT NOT NULL UNIQUE,type TEXT NOT NULL CHECK(type IN ('ar_ar','ap_ap','pre_ar','pre_ap','ar_ap_cross')),contact_id INTEGER NOT NULL,amount REAL DEFAULT 0,note TEXT DEFAULT '',operator_id TEXT DEFAULT '',created_at TEXT DEFAULT (datetime('now','localtime')));
            CREATE TABLE IF NOT EXISTS writeoff_items (id INTEGER PRIMARY KEY AUTOINCREMENT,writeoff_id INTEGER NOT NULL,ref_type TEXT NOT NULL,ref_id INTEGER NOT NULL,amount REAL DEFAULT 0);

            CREATE TABLE IF NOT EXISTS employee_settlement (id INTEGER PRIMARY KEY AUTOINCREMENT,employee_id TEXT NOT NULL,settle_date TEXT DEFAULT (date('now','localtime')),status TEXT DEFAULT 'pending' CHECK(status IN ('pending','submitted','confirmed')),note TEXT DEFAULT '',created_at TEXT DEFAULT (datetime('now','localtime')));
            CREATE TABLE IF NOT EXISTS employee_settlement_items (id INTEGER PRIMARY KEY AUTOINCREMENT,settlement_id INTEGER NOT NULL,ref_type TEXT NOT NULL,ref_id INTEGER NOT NULL,item_type TEXT NOT NULL CHECK(item_type IN ('order','payment','expense')),amount REAL DEFAULT 0,status TEXT DEFAULT 'pending');

            -- 费用/收入默认分类
            INSERT OR IGNORE INTO expense_categories (id,name,type) VALUES (1,'陈列费','customer'),(2,'促销费','customer'),(3,'返利','customer'),(4,'运费','supplier'),(5,'装卸费','supplier'),(6,'办公费','internal'),(7,'差旅费','internal'),(8,'工资','internal'),(9,'房租','internal');
            INSERT OR IGNORE INTO income_categories (id,name,type) VALUES (1,'返利收入','supplier'),(2,'废品收入','internal'),(3,'利息收入','internal');
        """)

# ============================================================
# 商品 / 联系人 / 库存 / 采购 / 销售 (保持原有)
# ============================================================

def product_create(name, **kw):
    allowed = ['spec','unit','barcode','brand','category','purchase_price','sale_price','safety_stock','expiry_days']
    fields = {'name':name}
    for k in allowed:
        if k in kw: fields[k]=kw[k]
    with get_db() as db:
        cur = db.execute(f"INSERT INTO products ({','.join(fields)}) VALUES ({','.join('?'*len(fields))})",tuple(fields.values()))
        db.commit(); return cur.lastrowid

def product_update(pid, **kw):
    allowed = ['name','spec','unit','barcode','brand','category','purchase_price','sale_price','safety_stock','expiry_days','is_active']
    sets = [f"{k}=?" for k in allowed if k in kw]
    if not sets: return
    with get_db() as db:
        db.execute(f"UPDATE products SET {','.join(sets)},updated_at=datetime('now','localtime') WHERE id=?",[*[kw[k] for k in allowed if k in kw],pid])
        db.commit()

def product_list(keyword='', brand='', category='', include_inactive=False):
    with get_db() as db:
        where = ["1=1"] if include_inactive else ["is_active=1"]
        params = []
        if keyword: where.append("(name LIKE ? OR barcode LIKE ? OR spec LIKE ?)"); k=f"%{keyword}%"; params.extend([k,k,k])
        if brand: where.append("brand=?"); params.append(brand)
        if category: where.append("category=?"); params.append(category)
        return [dict(r) for r in db.execute(f"SELECT * FROM products WHERE {' AND '.join(where)} ORDER BY id DESC",params).fetchall()]

def product_get(pid):
    with get_db() as db:
        r = db.execute("SELECT * FROM products WHERE id=?",(pid,)).fetchone()
        return dict(r) if r else None

def contact_create(name, contact_type='customer', **kw):
    allowed = ['phone','address','settlement_method','credit_days','employee_id']
    fields = {'name':name,'type':contact_type}
    for k in allowed:
        if k in kw: fields[k]=kw[k]
    with get_db() as db:
        cur = db.execute(f"INSERT INTO contacts ({','.join(fields)}) VALUES ({','.join('?'*len(fields))})",tuple(fields.values()))
        db.commit(); return cur.lastrowid

def contact_list(keyword='', contact_type='', include_inactive=False):
    with get_db() as db:
        where = [] if include_inactive else ["is_active=1"]
        params = []
        if keyword: where.append("(name LIKE ? OR phone LIKE ?)"); k=f"%{keyword}%"; params.extend([k,k])
        if contact_type: where.append("type IN (?,'both')"); params.append(contact_type)
        sql = "SELECT * FROM contacts" + (" WHERE "+" AND ".join(where) if where else "") + " ORDER BY id DESC"
        return [dict(r) for r in db.execute(sql,params).fetchall()]

def contact_get(cid):
    with get_db() as db:
        r = db.execute("SELECT * FROM contacts WHERE id=?",(cid,)).fetchone()
        if not r: return None
        d = dict(r)
        d['receivable'] = dict(db.execute("SELECT COALESCE(SUM(amount-paid_amount),0) as balance, COUNT(*) as count FROM receivables WHERE contact_id=? AND type='ar' AND status!='paid'",(cid,)).fetchone())
        d['payable'] = dict(db.execute("SELECT COALESCE(SUM(amount-paid_amount),0) as balance FROM receivables WHERE contact_id=? AND type='ap' AND status!='paid'",(cid,)).fetchone())
        return d

def inventory_query(keyword='', brand='', warehouse_id=1, low_stock_only=False):
    with get_db() as db:
        where = ["p.is_active=1"]; params = [warehouse_id]
        if keyword: where.append("(p.name LIKE ? OR p.barcode LIKE ?)"); k=f"%{keyword}%"; params.extend([k,k])
        if brand: where.append("p.brand=?"); params.append(brand)
        if low_stock_only: where.append("COALESCE(inv.quantity,0) <= p.safety_stock")
        return [dict(r) for r in db.execute(f"""
            SELECT p.*, COALESCE(inv.quantity,0) as quantity, COALESCE(inv.cost_price,p.purchase_price) as cost_price, inv.batch_no, inv.expiry_date
            FROM products p LEFT JOIN inventory inv ON p.id=inv.product_id AND inv.warehouse_id=?
            WHERE {' AND '.join(where)} ORDER BY p.name
        """,params).fetchall()]

def inventory_adjust(product_id, warehouse_id, qty_change, cost_price=0, ref_type='', ref_id=0):
    with get_db() as db:
        inv = db.execute("SELECT id,quantity FROM inventory WHERE product_id=? AND warehouse_id=?",(product_id,warehouse_id)).fetchone()
        before = inv['quantity'] if inv else 0; after = before + qty_change
        if inv: db.execute("UPDATE inventory SET quantity=?,cost_price=CASE WHEN ?>0 THEN ? ELSE cost_price END,updated_at=datetime('now','localtime') WHERE id=?",(after,cost_price,cost_price,inv['id']))
        else: db.execute("INSERT INTO inventory (product_id,warehouse_id,quantity,cost_price) VALUES (?,?,?,?)",(product_id,warehouse_id,after,cost_price))
        db.execute("INSERT INTO inventory_logs (product_id,warehouse_id,change_type,change_qty,before_qty,after_qty,cost_price,ref_type,ref_id) VALUES (?,?,?,?,?,?,?,?,?)",(product_id,warehouse_id,ref_type,qty_change,before,after,cost_price,ref_type,ref_id))
        db.commit()

def purchase_order_create(supplier_id, items, warehouse_id=1, note='', operator_id=''):
    no = _gen_no("PO"); total = sum(it['quantity']*it['unit_price'] for it in items)
    with get_db() as db:
        cur = db.execute("INSERT INTO purchase_orders (order_no,supplier_id,warehouse_id,total_amount,note,operator_id) VALUES (?,?,?,?,?,?)",(no,supplier_id,warehouse_id,total,note,operator_id))
        oid = cur.lastrowid
        for it in items: db.execute("INSERT INTO purchase_order_items (order_id,product_id,quantity,unit_price,amount) VALUES (?,?,?,?,?)",(oid,it['product_id'],it['quantity'],it['unit_price'],it['quantity']*it['unit_price']))
        db.commit(); return {'order_id':oid,'order_no':no,'total_amount':total}

def purchase_order_confirm(oid):
    with get_db() as db:
        o = db.execute("SELECT * FROM purchase_orders WHERE id=? AND status='draft'",(oid,)).fetchone()
        if not o: return {'error':'状态错误'}
        for it in db.execute("SELECT * FROM purchase_order_items WHERE order_id=?",(oid,)).fetchall():
            inventory_adjust(it['product_id'],o['warehouse_id'],it['quantity'],it['unit_price'],'purchase',oid)
        db.execute("UPDATE purchase_orders SET status='received' WHERE id=?",(oid,))
        db.execute("INSERT INTO receivables (type,contact_id,ref_type,ref_id,amount) VALUES ('ap',?,'purchase',?,?)",(o['supplier_id'],oid,o['total_amount']))
        db.commit(); return {'order_id':oid,'order_no':o['order_no'],'status':'received'}

def purchase_order_list(status='', supplier_id=0, date_from='', date_to='', limit=100, offset=0):
    with get_db() as db:
        where,params = [],[]
        if status: where.append("po.status=?"); params.append(status)
        if supplier_id: where.append("po.supplier_id=?"); params.append(supplier_id)
        if date_from: where.append("po.order_date>=?"); params.append(date_from)
        if date_to: where.append("po.order_date<=?"); params.append(date_to)
        w = " WHERE "+" AND ".join(where) if where else ""
        orders = [dict(r) for r in db.execute(f"SELECT po.*,c.name as supplier_name FROM purchase_orders po LEFT JOIN contacts c ON po.supplier_id=c.id{w} ORDER BY po.id DESC LIMIT ? OFFSET ?",params+[limit,offset]).fetchall()]
        total = db.execute(f"SELECT COUNT(*) FROM purchase_orders po{w}",params).fetchone()[0]
        return {'orders':orders,'total':total}

def purchase_order_get(oid):
    with get_db() as db:
        o = db.execute("SELECT po.*,c.name as supplier_name FROM purchase_orders po LEFT JOIN contacts c ON po.supplier_id=c.id WHERE po.id=?",(oid,)).fetchone()
        if not o: return None
        items = [dict(r) for r in db.execute("SELECT poi.*,p.name as product_name,p.spec,p.unit FROM purchase_order_items poi LEFT JOIN products p ON poi.product_id=p.id WHERE poi.order_id=?",(oid,)).fetchall()]
        return {'order':dict(o),'items':items}

def sale_order_create(customer_id, items, warehouse_id=1, discount=0, note='', operator_id='', driver_id=''):
    no = _gen_no("SO"); total = sum(it['quantity']*it['unit_price'] for it in items) - discount
    with get_db() as db:
        cur = db.execute("INSERT INTO sale_orders (order_no,customer_id,warehouse_id,total_amount,discount,note,operator_id,driver_id) VALUES (?,?,?,?,?,?,?,?)",(no,customer_id,warehouse_id,total,discount,note,operator_id,driver_id))
        oid = cur.lastrowid
        for it in items: db.execute("INSERT INTO sale_order_items (order_id,product_id,quantity,unit_price,amount) VALUES (?,?,?,?,?)",(oid,it['product_id'],it['quantity'],it['unit_price'],it['quantity']*it['unit_price']))
        db.commit(); return {'order_id':oid,'order_no':no,'total_amount':total}

def sale_order_deliver(oid):
    with get_db() as db:
        o = db.execute("SELECT * FROM sale_orders WHERE id=? AND status='draft'",(oid,)).fetchone()
        if not o: return {'error':'状态错误'}
        for it in db.execute("SELECT * FROM sale_order_items WHERE order_id=?",(oid,)).fetchall():
            inventory_adjust(it['product_id'],o['warehouse_id'],-it['quantity'],ref_type='sale',ref_id=oid)
        db.execute("UPDATE sale_orders SET status='delivered',delivery_date=datetime('now','localtime') WHERE id=?",(oid,))
        db.execute("INSERT INTO receivables (type,contact_id,ref_type,ref_id,amount) VALUES ('ar',?,'sale',?,?)",(o['customer_id'],oid,o['total_amount']))
        db.commit(); return {'order_id':oid,'order_no':o['order_no'],'status':'delivered'}

def sale_order_sign(oid):
    with get_db() as db:
        o = db.execute("SELECT * FROM sale_orders WHERE id=? AND status='delivered'",(oid,)).fetchone()
        if not o: return {'error':'状态错误'}
        db.execute("UPDATE sale_orders SET status='signed' WHERE id=?",(oid,)); db.commit()
        return {'order_id':oid,'order_no':o['order_no'],'status':'signed'}

def sale_order_list(status='', customer_id=0, date_from='', date_to='', operator_id='', driver_id='', limit=100, offset=0):
    with get_db() as db:
        where,params = [],[]
        if status: where.append("so.status=?"); params.append(status)
        if customer_id: where.append("so.customer_id=?"); params.append(customer_id)
        if date_from: where.append("so.order_date>=?"); params.append(date_from)
        if date_to: where.append("so.order_date<=?"); params.append(date_to)
        if operator_id: where.append("so.operator_id=?"); params.append(operator_id)
        if driver_id: where.append("so.driver_id=?"); params.append(driver_id)
        w = " WHERE "+" AND ".join(where) if where else ""
        orders = [dict(r) for r in db.execute(f"SELECT so.*,c.name as customer_name FROM sale_orders so LEFT JOIN contacts c ON so.customer_id=c.id{w} ORDER BY so.id DESC LIMIT ? OFFSET ?",params+[limit,offset]).fetchall()]
        total = db.execute(f"SELECT COUNT(*) FROM sale_orders so{w}",params).fetchone()[0]
        return {'orders':orders,'total':total}

def sale_order_get(oid):
    with get_db() as db:
        o = db.execute("SELECT so.*,c.name as customer_name FROM sale_orders so LEFT JOIN contacts c ON so.customer_id=c.id WHERE so.id=?",(oid,)).fetchone()
        if not o: return None
        items = [dict(r) for r in db.execute("SELECT soi.*,p.name as product_name,p.spec,p.unit FROM sale_order_items soi LEFT JOIN products p ON soi.product_id=p.id WHERE soi.order_id=?",(oid,)).fetchall()]
        return {'order':dict(o),'items':items}

# ============================================================
# 收支/应收应付
# ============================================================

def payment_create(contact_id, amount, pay_type='ar', account='现金', category='', note='', operator_id='', ref_type='', ref_id=0):
    with get_db() as db:
        if ref_id and ref_type:
            db.execute("UPDATE receivables SET paid_amount=paid_amount+?,status=CASE WHEN paid_amount+?>=amount THEN 'paid' WHEN paid_amount+?>0 THEN 'partial' ELSE status END WHERE id=?",(amount,amount,amount,ref_id))
        cf_amount = amount if pay_type=='ar' else -amount
        db.execute("UPDATE accounts SET current_balance=current_balance+? WHERE name=?",(cf_amount,account))
        bal = db.execute("SELECT current_balance FROM accounts WHERE name=?",(account,)).fetchone()
        cur = db.execute("INSERT INTO cash_flow (account,type,amount,balance_after,contact_id,ref_type,ref_id,category,note,operator_id) VALUES (?,?,?,?,?,?,?,?,?,?)",(account,'income' if pay_type=='ar' else 'expense',abs(amount),bal['current_balance'] if bal else 0,contact_id,ref_type,ref_id,category,note,operator_id))
        db.commit(); return cur.lastrowid

def receivable_list(contact_type='', status='', limit=200, offset=0):
    with get_db() as db:
        where,params = [],[]
        if contact_type: where.append("r.type=?"); params.append('ar' if contact_type=='customer' else 'ap')
        if status: where.append("r.status=?"); params.append(status)
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

# ============================================================
# 费用单
# ============================================================

def expense_category_list(etype=''):
    with get_db() as db:
        if etype: return [dict(r) for r in db.execute("SELECT * FROM expense_categories WHERE type=? ORDER BY id",(etype,)).fetchall()]
        return [dict(r) for r in db.execute("SELECT * FROM expense_categories ORDER BY type,id").fetchall()]

def expense_order_create(etype, contact_id, amount, category_id=0, note='', operator_id='', brand='', employee_id=''):
    no = _gen_no("EX")
    with get_db() as db:
        db.execute("INSERT INTO expense_orders (order_no,type,contact_id,category_id,amount,note,operator_id,brand,employee_id) VALUES (?,?,?,?,?,?,?,?,?)",(no,etype,contact_id,category_id,amount,note,operator_id,brand,employee_id))
        # 客户/供应商费用生成应收/应付
        if etype == 'customer':
            db.execute("INSERT INTO receivables (type,contact_id,ref_type,ref_id,amount) VALUES ('ar',?,'expense',?,?)",(contact_id,cur.lastrowid,-amount))
        elif etype == 'supplier':
            db.execute("INSERT INTO receivables (type,contact_id,ref_type,ref_id,amount) VALUES ('ap',?,'expense',?,?)",(contact_id,cur.lastrowid,amount))
        elif etype == 'internal':
            db.execute("UPDATE accounts SET current_balance=current_balance-? WHERE name='现金'",(amount,))
        db.commit(); return {'order_id':cur.lastrowid,'order_no':no}

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
        db.commit(); return {'success':True}

def expense_order_list(etype='', contact_id=0, limit=100):
    with get_db() as db:
        where,params = [],[]
        if etype: where.append("e.type=?"); params.append(etype)
        if contact_id: where.append("e.contact_id=?"); params.append(contact_id)
        w = " WHERE "+" AND ".join(where) if where else ""
        return [dict(r) for r in db.execute(f"SELECT e.*,c.name as contact_name,ec.name as category_name FROM expense_orders e LEFT JOIN contacts c ON e.contact_id=c.id LEFT JOIN expense_categories ec ON e.category_id=ec.id{w} ORDER BY e.id DESC LIMIT ?",params+[limit]).fetchall()]

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

def report_sales_summary(date_from='', date_to=''):
    with get_db() as db:
        where,params = [],[]
        if date_from: where.append("so.order_date>=?"); params.append(date_from)
        if date_to: where.append("so.order_date<=?"); params.append(date_to)
        w = " WHERE "+" AND ".join(where) if where else ""
        r = db.execute(f"""
            SELECT COUNT(*) as count, COALESCE(SUM(total_amount),0) as total_amount, COALESCE(SUM(received_amount),0) as total_received,
                   COALESCE(SUM(discount),0) as total_discount
            FROM sale_orders so{w} AND so.status!='cancelled'
        """,params).fetchone()
        return dict(r) if r else {}

init_db()
