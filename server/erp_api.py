"""
Hergent ERP API 路由
由 server.py 通过 app.include_router(erp_router) 加载
"""

from fastapi import APIRouter, Query
from pydantic import BaseModel
from typing import Optional, List
import erp_db as db

erp_router = APIRouter(prefix="/api/erp", tags=["ERP"])


# ============================================================
# 请求模型
# ============================================================

class ProductCreate(BaseModel):
    name: str
    spec: str = ""
    unit: str = "件"
    barcode: str = ""
    brand: str = ""
    category: str = ""
    purchase_price: float = 0
    sale_price: float = 0
    safety_stock: int = 0
    expiry_days: int = 0


class ProductUpdate(BaseModel):
    name: Optional[str] = None
    spec: Optional[str] = None
    unit: Optional[str] = None
    barcode: Optional[str] = None
    brand: Optional[str] = None
    category: Optional[str] = None
    purchase_price: Optional[float] = None
    sale_price: Optional[float] = None
    safety_stock: Optional[int] = None
    expiry_days: Optional[int] = None
    is_active: Optional[int] = None


class ContactCreate(BaseModel):
    name: str
    type: str = "customer"
    phone: str = ""
    address: str = ""
    settlement_method: str = "现结"
    credit_days: int = 0
    employee_id: str = ""


class ContactUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    settlement_method: Optional[str] = None
    credit_days: Optional[int] = None
    employee_id: Optional[str] = None
    is_active: Optional[int] = None


class OrderItem(BaseModel):
    product_id: int
    quantity: int
    unit_price: float


class PurchaseOrderCreate(BaseModel):
    supplier_id: int
    items: List[OrderItem]
    warehouse_id: int = 1
    note: str = ""
    operator_id: str = ""


class SaleOrderCreate(BaseModel):
    customer_id: int
    items: List[OrderItem]
    warehouse_id: int = 1
    discount: float = 0
    note: str = ""
    operator_id: str = ""
    driver_id: str = ""


class PaymentCreate(BaseModel):
    contact_id: int
    amount: float
    pay_type: str = "ar"
    account: str = "现金"
    category: str = ""
    note: str = ""
    operator_id: str = ""
    ref_id: int = 0
    ref_type: str = ""


# ============================================================
# 商品
# ============================================================

@erp_router.post("/products")
def create_product(data: ProductCreate):
    pid = db.product_create(**data.model_dump())
    return {"success": True, "id": pid}


@erp_router.put("/products/{product_id}")
def update_product(product_id: int, data: ProductUpdate):
    db.product_update(product_id, **data.model_dump(exclude_none=True))
    return {"success": True}


@erp_router.get("/products")
def list_products(keyword: str = "", brand: str = "", category: str = "", include_inactive: bool = False):
    return db.product_list(keyword, brand, category, include_inactive)


@erp_router.get("/products/{product_id}")
def get_product(product_id: int):
    p = db.product_get(product_id)
    return p or {"error": "not found"}


# ============================================================
# 客户/供应商
# ============================================================

@erp_router.post("/contacts")
def create_contact(data: ContactCreate):
    cid = db.contact_create(**data.model_dump())
    return {"success": True, "id": cid}


@erp_router.put("/contacts/{contact_id}")
def update_contact(contact_id: int, data: ContactUpdate):
    db.contact_update(contact_id, **data.model_dump(exclude_none=True))
    return {"success": True}


@erp_router.get("/contacts")
def list_contacts(keyword: str = "", type: str = "", include_inactive: bool = False):
    return db.contact_list(keyword, type, include_inactive)


@erp_router.get("/contacts/{contact_id}")
def get_contact(contact_id: int):
    c = db.contact_get(contact_id)
    if not c:
        return {"error": "not found"}
    c["receivable"] = db.contact_receivable_summary(contact_id)
    return c


# ============================================================
# 库存
# ============================================================

@erp_router.get("/inventory")
def query_inventory(keyword: str = "", brand: str = "", warehouse_id: int = 1, low_stock: bool = False):
    return db.inventory_query(keyword, brand, warehouse_id, low_stock)


# ============================================================
# 采购
# ============================================================

@erp_router.post("/purchase-orders")
def create_purchase_order(data: PurchaseOrderCreate):
    items = [it.model_dump() for it in data.items]
    r = db.purchase_order_create(data.supplier_id, items, data.warehouse_id, data.note, data.operator_id)
    return {"success": True, **r}


@erp_router.post("/purchase-orders/{order_id}/confirm")
def confirm_purchase_order(order_id: int):
    r = db.purchase_order_confirm(order_id)
    if "error" in r:
        return {"success": False, **r}
    return {"success": True, **r}


@erp_router.get("/purchase-orders")
def list_purchase_orders(status: str = "", supplier_id: int = 0, date_from: str = "", date_to: str = "", limit: int = 50, offset: int = 0):
    return db.purchase_order_list(status, supplier_id, date_from, date_to, limit, offset)


@erp_router.get("/purchase-orders/{order_id}")
def get_purchase_order(order_id: int):
    r = db.purchase_order_get(order_id)
    return r or {"error": "not found"}


# ============================================================
# 销售
# ============================================================

@erp_router.post("/sale-orders")
def create_sale_order(data: SaleOrderCreate):
    items = [it.model_dump() for it in data.items]
    r = db.sale_order_create(data.customer_id, items, data.warehouse_id, data.discount, data.note, data.operator_id, data.driver_id)
    return {"success": True, **r}


@erp_router.post("/sale-orders/{order_id}/deliver")
def deliver_sale_order(order_id: int):
    r = db.sale_order_deliver(order_id)
    if "error" in r:
        return {"success": False, **r}
    return {"success": True, **r}


@erp_router.post("/sale-orders/{order_id}/sign")
def sign_sale_order(order_id: int):
    r = db.sale_order_sign(order_id)
    if "error" in r:
        return {"success": False, **r}
    return {"success": True, **r}


@erp_router.get("/sale-orders")
def list_sale_orders(status: str = "", customer_id: int = 0, date_from: str = "", date_to: str = "", operator_id: str = "", limit: int = 50, offset: int = 0):
    return db.sale_order_list(status, customer_id, date_from, date_to, operator_id, limit, offset)


@erp_router.get("/sale-orders/{order_id}")
def get_sale_order(order_id: int):
    r = db.sale_order_get(order_id)
    return r or {"error": "not found"}


# ============================================================
# 收支
# ============================================================

@erp_router.post("/payments")
def create_payment(data: PaymentCreate):
    pid = db.payment_create(**data.model_dump())
    return {"success": True, "id": pid}


@erp_router.get("/payments")
def list_payments(date_from: str = "", date_to: str = "", contact_id: int = 0, account: str = "", limit: int = 50, offset: int = 0):
    return db.payment_list(date_from, date_to, contact_id, account, limit, offset)


@erp_router.get("/receivables")
def list_receivables(type: str = "", status: str = "", limit: int = 50, offset: int = 0):
    return db.receivable_list(type, status, limit, offset)


@erp_router.get("/accounts")
def get_account_summary():
    return db.account_summary()
