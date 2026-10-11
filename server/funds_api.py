# ============================================================
# funds_api.py —— 资金管理域 · FastAPI 路由
# ------------------------------------------------------------
# prefix = /api/funds
# 挂载方式（生产）：在 server.py 里 `app.include_router(funds_router)`，
#   与现有 `erp_router` 同构。本地自测用本文件底部 __main__ 起独立 uvicorn。
#
# 租户：读 `X-Tenant-Id` 头，缺省 1（本地自测）。生产由 server.py 的鉴权中间件
#   统一注入真实租户，本路由不重复做 JWT 校验（鉴权是中间件职责）。
#
# 响应信封：成功返回 `{success:true, ...}` 或纯数据；业务错误返回
#   `{"success": false, "error": "..."}`（前端按 `data.data` 解包，见 client.js）。
# ============================================================
from fastapi import APIRouter, Request, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional, List, Any
import funds_db as db

funds_router = APIRouter(prefix="/api/funds", tags=["funds"])


def _tid(req: Request):
    # 生产由中间件注入；本地自测缺省 1。优先级：头 > query > 1
    h = req.headers.get("X-Tenant-Id")
    if h and h.isdigit():
        return int(h)
    return 1


# --------------------------- 请求模型 ---------------------------
class AccountIn(BaseModel):
    name: str
    type: str = "现金"
    bank_name: str = ""
    account_no: str = ""
    opening_balance: float = 0
    remark: str = ""


class DocItemIn(BaseModel):
    ref_type: str = ""
    ref_id: int = 0
    ref_no: str = ""
    amount: float = 0
    cost: float = 0
    product_id: int = 0
    product_name: str = ""
    qty: float = 0
    remark: str = ""


class DocIn(BaseModel):
    doc_type: str
    bill_date: str = ""
    party_type: str = ""
    party_id: int = 0
    party_name: str = ""
    account: str = ""
    amount: float = 0
    remark: str = ""
    operator: str = ""
    items: List[DocItemIn] = []


# --------------------------- 资金账户 ---------------------------
@funds_router.get("/accounts")
def list_accounts(req: Request):
    return {"success": True, "items": db.account_list(_tid(req))}


@funds_router.post("/accounts")
def create_account(req: Request, data: AccountIn):
    aid = db.account_create(_tid(req), **data.model_dump())
    return {"success": True, "id": aid}


@funds_router.put("/accounts/{aid}")
def update_account(req: Request, aid: int, data: AccountIn):
    db.account_update(_tid(req), aid, **data.model_dump())
    return {"success": True}


# --------------------------- 单据 ---------------------------
@funds_router.get("/docs")
def list_docs(req: Request,
               doc_type: str = "", party_type: str = "", party_id: int = 0,
               status: str = "", date_from: str = "", date_to: str = "",
               keyword: str = "", limit: int = 50, offset: int = 0):
    res = db.doc_list(_tid(req), {
        'doc_type': doc_type, 'party_type': party_type, 'party_id': party_id,
        'status': status, 'date_from': date_from, 'date_to': date_to,
        'keyword': keyword, 'limit': limit, 'offset': offset
    })
    return {"success": True, **res}


@funds_router.post("/docs")
def create_doc(req: Request, data: DocIn):
    if data.doc_type not in db.DOC_TYPES:
        return JSONResponse(status_code=400, content={"success": False, "error": f"未知单据类型: {data.doc_type}"})
    items = [it.model_dump() for it in data.items]
    r = db.doc_create(_tid(req), **{**data.model_dump(), 'items': items})
    if 'error' in r:
        return JSONResponse(status_code=400, content={"success": False, **r})
    return {"success": True, **r}


@funds_router.get("/docs/{doc_id}")
def get_doc(req: Request, doc_id: int):
    d = db.doc_get(_tid(req), doc_id)
    if not d:
        return JSONResponse(status_code=404, content={"success": False, "error": "not found"})
    return {"success": True, **d}


@funds_router.put("/docs/{doc_id}")
def update_doc(req: Request, doc_id: int, data: DocIn):
    r = db.doc_update(_tid(req), doc_id, **data.model_dump(exclude={'doc_type'}))
    if 'error' in r:
        return JSONResponse(status_code=400, content={"success": False, **r})
    return {"success": True, **r}


@funds_router.post("/docs/{doc_id}/post")
def post_doc(req: Request, doc_id: int):
    r = db.doc_post(_tid(req), doc_id)
    if 'error' in r:
        return JSONResponse(status_code=400, content={"success": False, **r})
    return {"success": True, **r}


@funds_router.post("/docs/{doc_id}/void")
def void_doc(req: Request, doc_id: int):
    r = db.doc_void(_tid(req), doc_id)
    if 'error' in r:
        return JSONResponse(status_code=400, content={"success": False, **r})
    return {"success": True, **r}


# --------------------------- 余额 / 流水 ---------------------------
@funds_router.get("/balance")
def balance(req: Request):
    return {"success": True, **db.balance_summary(_tid(req))}


@funds_router.get("/flow")
def flow(req: Request, account: str = "", party_type: str = "", party_id: int = 0,
          date_from: str = "", date_to: str = "", limit: int = 200):
    rows = db.flow_list(_tid(req), {
        'account': account, 'party_type': party_type, 'party_id': party_id,
        'date_from': date_from, 'date_to': date_to, 'limit': limit
    })
    return {"success": True, "items": rows}


# --------------------------- 对账 ---------------------------
@funds_router.get("/statements/customer")
def stmt_customer(req: Request, party_id: int = 0, date_from: str = "", date_to: str = ""):
    return {"success": True, "items": db.statement(_tid(req), 'customer', party_id or None, date_from, date_to)}


@funds_router.get("/statements/supplier")
def stmt_supplier(req: Request, party_id: int = 0, date_from: str = "", date_to: str = ""):
    return {"success": True, "items": db.statement(_tid(req), 'supplier', party_id or None, date_from, date_to)}


# --------------------------- 成本 ---------------------------
@funds_router.get("/cost/query")
def cost_query(req: Request, keyword: str = ""):
    return {"success": True, "items": db.cost_query(_tid(req), keyword)}


@funds_router.get("/cost/summary")
def cost_summary(req: Request):
    return {"success": True, "items": db.cost_summary(_tid(req))}


@funds_router.get("/cost/abnormal")
def cost_abnormal(req: Request):
    return {"success": True, "items": db.cost_abnormal(_tid(req))}


# --------------------------- 其他报表 ---------------------------
@funds_router.get("/staff-debt")
def staff_debt(req: Request):
    return {"success": True, "items": db.staff_debt(_tid(req))}


@funds_router.get("/bank-reconcile")
def bank_reconcile(req: Request, account: str = "", date_from: str = "", date_to: str = ""):
    return {"success": True, **db.bank_reconcile(_tid(req), account, date_from, date_to)}


# 元信息：前端枚举（单据类型 → 中文名/前缀/对方类型）
@funds_router.get("/meta")
def meta():
    return {"success": True, "doc_meta": db.DOC_META, "doc_types": db.DOC_TYPES}


# --------------------------- 本地自测入口 ---------------------------
if __name__ == "__main__":
    import uvicorn
    from fastapi import FastAPI
    db.init_funds_db(1)
    _app = FastAPI(title="Hergent Funds (local dev)")
    _app.include_router(funds_router)
    uvicorn.run(_app, host="127.0.0.1", port=8787, reload=False)
