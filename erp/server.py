"""
Hergent ERP Server v2 — 参考舟谱进销存
"""

import os, json, hashlib, uuid
from datetime import datetime
from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
import uvicorn
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import erp_db as db

PORT = int(os.environ.get("ERP_PORT", "8700"))
SECRET = os.environ.get("ERP_SECRET", "hergent-erp-2026")
STATIC = os.path.join(os.path.dirname(__file__), "static")

# ============================================================
# Auth
# ============================================================
def _hpw(pw): return hashlib.sha256((pw+SECRET).encode()).hexdigest()

def _init_users():
    with db.get_db() as conn:
        conn.executescript("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,display_name TEXT DEFAULT '',role TEXT DEFAULT 'user',is_active INTEGER DEFAULT 1,created_at TEXT DEFAULT (datetime('now','localtime')));")
        conn.execute("CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER, created_at TEXT DEFAULT (datetime('now','localtime')))")
        if not conn.execute("SELECT id FROM users WHERE username='admin'").fetchone():
            conn.execute("INSERT INTO users (username,password_hash,display_name,role) VALUES (?,?,?,?)",("admin",_hpw("admin123"),"管理员","admin"))
            conn.commit()

def _get_user(request: Request):
    token = request.cookies.get("erp_token") or request.headers.get("Authorization","").replace("Bearer ","")
    if not token: return None
    with db.get_db() as conn:
        r = conn.execute("SELECT u.* FROM sessions s JOIN users u ON s.user_id=u.id WHERE s.token=? AND u.is_active=1",(token,)).fetchone()
        return dict(r) if r else None

def _auth(request: Request):
    u = _get_user(request)
    if not u: raise HTTPException(401,"未登录")
    return u

def _admin(request: Request):
    u = _auth(request)
    if u['role']!='admin': raise HTTPException(403)
    return u

app = FastAPI(title="Hergent ERP", version="0.2.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

# ============================================================
# Auth API
# ============================================================
@app.post("/api/auth/login")
async def login(request: Request):
    d = await request.json()
    u, p = d.get("username",""), d.get("password","")
    with db.get_db() as conn:
        user = conn.execute("SELECT * FROM users WHERE username=? AND is_active=1",(u,)).fetchone()
        if not user or user['password_hash'] != _hpw(p): raise HTTPException(401,"用户名或密码错误")
        token = str(uuid.uuid4())
        conn.execute("INSERT OR REPLACE INTO sessions (token,user_id,created_at) VALUES (?,?,datetime('now','localtime'))",(token,user['id']))
        conn.commit()
        return {"success":True,"token":token,"user":{"id":user['id'],"username":user['username'],"display_name":user['display_name'],"role":user['role']}}

@app.get("/api/auth/me")
def me(request: Request): u = _auth(request); return {"id":u['id'],"username":u['username'],"display_name":u['display_name'],"role":u['role']}

@app.post("/api/auth/logout")
def logout(request: Request):
    token = request.cookies.get("erp_token") or request.headers.get("Authorization","").replace("Bearer ","")
    if token:
        with db.get_db() as conn: conn.execute("DELETE FROM sessions WHERE token=?",(token,)); conn.commit()
    return {"success":True}

# ============================================================
# Products / Contacts / Inventory / Purchase / Sale
# ============================================================
@app.get("/api/products")
def list_products(request: Request, keyword: str="", brand: str="", category: str=""): _auth(request); return db.product_list(keyword,brand,category)

@app.post("/api/products")
async def create_product(request: Request): _auth(request); d = await request.json(); return {"success":True,"id":db.product_create(**d)}

@app.put("/api/products/{pid}")
async def update_product(pid: int, request: Request): _auth(request); db.product_update(pid,**await request.json()); return {"success":True}

@app.get("/api/contacts")
def list_contacts(request: Request, keyword: str="", type: str=""): _auth(request); return db.contact_list(keyword,type)

@app.post("/api/contacts")
async def create_contact(request: Request): _auth(request); d = await request.json(); return {"success":True,"id":db.contact_create(**d)}

@app.get("/api/contacts/{cid}")
def get_contact(cid: int, request: Request): _auth(request); c = db.contact_get(cid); return c or HTTPException(404)

@app.get("/api/inventory")
def query_inventory(request: Request, keyword: str="", brand: str="", low_stock: bool=False): _auth(request); return db.inventory_query(keyword,brand,1,low_stock)

@app.post("/api/sale-orders")
async def create_sale(request: Request):
    u = _auth(request); d = await request.json()
    r = db.sale_order_create(d.get("customer_id"),d.get("items",[]),d.get("warehouse_id",1),d.get("discount",0),d.get("note",""),str(u['id']),d.get("driver_id",""))
    return {"success":True,**r}

@app.get("/api/sale-orders")
def list_sale(request: Request, status: str="", customer_id: int=0, date_from: str="", date_to: str="", operator_id: str="", driver_id: str=""): _auth(request); return db.sale_order_list(status,customer_id,date_from,date_to,operator_id,driver_id)

@app.get("/api/sale-orders/{oid}")
def get_sale(oid: int, request: Request): _auth(request); r = db.sale_order_get(oid); return r or HTTPException(404)

@app.post("/api/sale-orders/{oid}/deliver")
def deliver_sale(oid: int, request: Request): _auth(request); r = db.sale_order_deliver(oid); return {"success":True,**r} if "error" not in r else HTTPException(400,r['error'])

@app.post("/api/sale-orders/{oid}/sign")
def sign_sale(oid: int, request: Request): _auth(request); r = db.sale_order_sign(oid); return {"success":True,**r} if "error" not in r else HTTPException(400,r['error'])

@app.post("/api/purchase-orders")
async def create_purchase(request: Request):
    u = _auth(request); d = await request.json()
    r = db.purchase_order_create(d.get("supplier_id"),d.get("items",[]),d.get("warehouse_id",1),d.get("note",""),str(u['id']))
    return {"success":True,**r}

@app.get("/api/purchase-orders")
def list_purchase(request: Request, status: str="", supplier_id: int=0, date_from: str="", date_to: str=""): _auth(request); return db.purchase_order_list(status,supplier_id,date_from,date_to)

@app.get("/api/purchase-orders/{oid}")
def get_purchase(oid: int, request: Request): _auth(request); r = db.purchase_order_get(oid); return r or HTTPException(404)

@app.post("/api/purchase-orders/{oid}/confirm")
def confirm_purchase(oid: int, request: Request): _auth(request); r = db.purchase_order_confirm(oid); return {"success":True,**r} if "error" not in r else HTTPException(400,r['error'])

# ============================================================
# Payments / Receivables / Cash Flow
# ============================================================
@app.post("/api/payments")
async def create_payment(request: Request): _auth(request); d = await request.json(); return {"success":True,"id":db.payment_create(**d)}

@app.get("/api/payments")
def list_payments(request: Request, date_from: str="", date_to: str="", contact_id: int=0, limit: int=100, offset: int=0): _auth(request); return db.cash_flow_list(date_from,date_to,"",limit,offset)

@app.get("/api/receivables")
def list_receivables(request: Request, type: str="", status: str="", limit: int=200, offset: int=0): _auth(request); return db.receivable_list(type,status,limit,offset)

@app.get("/api/dashboard")
def dashboard(request: Request): _auth(request); return db.account_summary()

# ============================================================
# 预收/预付
# ============================================================
@app.post("/api/prepayments")
async def create_prepayment(request: Request):
    u = _auth(request); d = await request.json()
    db.prepayment_create(d.get("type","ar"),d.get("contact_id"),d.get("amount"),d.get("note",""),str(u['id']),d.get("ref_type",""),d.get("ref_id",0))
    return {"success":True}

@app.get("/api/prepayments")
def list_prepayments(request: Request, type: str="", contact_id: int=0): _auth(request); return db.prepayment_list(type,contact_id)

@app.post("/api/prepayments/{ppid}/refund")
async def refund_prepayment(ppid: int, request: Request):
    u = _auth(request); d = await request.json()
    r = db.prepayment_refund(ppid,d.get("amount",0),str(u['id']))
    return r if "error" not in r else HTTPException(400,r['error'])

# ============================================================
# 费用
# ============================================================
@app.get("/api/expense-categories")
def list_expense_categories(request: Request, type: str=""): _auth(request); return db.expense_category_list(type)

@app.post("/api/expense-orders")
async def create_expense(request: Request):
    u = _auth(request); d = await request.json()
    r = db.expense_order_create(d.get("type","customer"),d.get("contact_id"),d.get("amount"),d.get("category_id",0),d.get("note",""),str(u['id']),d.get("brand",""),d.get("employee_id",""))
    return {"success":True,**r}

@app.get("/api/expense-orders")
def list_expense_orders(request: Request, type: str="", contact_id: int=0): _auth(request); return db.expense_order_list(type,contact_id)

@app.post("/api/expense-orders/{oid}/pay")
async def pay_expense(oid: int, request: Request):
    u = _auth(request); d = await request.json()
    r = db.expense_order_pay(oid,d.get("amount",0),d.get("account","现金"),str(u['id']))
    return r if "error" not in r else HTTPException(400,r['error'])

# ============================================================
# 核销
# ============================================================
@app.post("/api/writeoffs")
async def create_writeoff(request: Request):
    u = _auth(request); d = await request.json()
    r = db.writeoff_create(d.get("type","ar_ar"),d.get("contact_id"),d.get("items",[]),d.get("note",""),str(u['id']))
    return {"success":True,**r}

# ============================================================
# 员工交账
# ============================================================
@app.post("/api/settlements")
async def create_settlement(request: Request):
    u = _auth(request); d = await request.json()
    r = db.settlement_create(d.get("employee_id",""),d.get("items",[]))
    return {"success":True,**r}

@app.get("/api/settlements")
def list_settlements(request: Request, employee_id: str="", date_from: str="", date_to: str=""): _auth(request); return db.settlement_list(employee_id,date_from,date_to)

@app.post("/api/settlements/{sid}/submit")
def submit_settlement(sid: int, request: Request): _auth(request); db.settlement_submit(sid); return {"success":True}

@app.post("/api/settlements/{sid}/confirm")
def confirm_settlement(sid: int, request: Request): _auth(request); db.settlement_confirm(sid); return {"success":True}

# ============================================================
# 报表
# ============================================================
@app.get("/api/reports/sales")
def report_sales(request: Request, date_from: str="", date_to: str=""): _auth(request); return db.report_sales_summary(date_from,date_to)

# ============================================================
# 用户管理
# ============================================================
@app.get("/api/users")
def list_users(request: Request):
    _admin(request)
    with db.get_db() as conn:
        return [dict(r) for r in conn.execute("SELECT id,username,display_name,role,is_active FROM users").fetchall()]

@app.post("/api/users")
async def create_user(request: Request):
    _admin(request); d = await request.json()
    with db.get_db() as conn:
        conn.execute("INSERT INTO users (username,password_hash,display_name,role) VALUES (?,?,?,?)",(d['username'],_hpw(d['password']),d.get('display_name',''),d.get('role','user')))
        conn.commit()
    return {"success":True}

# ============================================================
# Static
# ============================================================
@app.get("/")
def index(): return FileResponse(os.path.join(STATIC,"index.html"))

@app.get("/{path:path}")
async def serve(path: str):
    fp = os.path.join(STATIC, path)
    return FileResponse(fp) if os.path.exists(fp) else FileResponse(os.path.join(STATIC,"index.html"))

if __name__ == "__main__":
    _init_users()
    print(f"[ERP] http://0.0.0.0:{PORT}")
    uvicorn.run(app, host="0.0.0.0", port=PORT)
