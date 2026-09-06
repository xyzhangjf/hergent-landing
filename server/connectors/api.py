# server/connectors/api.py — /api/connectors REST 路由（FastAPI APIRouter）
# 由 server.py 通过 register_connector_routes(app) 挂载，对现有 server.py 改动极小。
from fastapi import APIRouter, Request

from .manager import get_manager

router = APIRouter()


@router.get("/api/connectors")
async def list_connectors():
    """列出已注册连接器 + 当前状态。前端 backendReady() 探测此端点。"""
    return {"connectors": get_manager().list_connectors()}


@router.post("/api/connectors/{service_id}/configure")
async def configure(service_id: str, request: Request):
    """保存凭据（加密落库）。"""
    try:
        cfg = await request.json()
    except Exception:
        cfg = {}
    await get_manager().configure(service_id, cfg)
    return {"success": True}


@router.post("/api/connectors/{service_id}/connect")
async def connect(service_id: str, request: Request):
    """启动并校验凭据；请求体可携带 cfg（连接中心前端即如此）。"""
    try:
        cfg = await request.json()
    except Exception:
        cfg = None
    return await get_manager().connect(service_id, cfg)


@router.post("/api/connectors/{service_id}/disconnect")
async def disconnect(service_id: str):
    return await get_manager().disconnect(service_id)


@router.get("/api/connectors/{service_id}/health")
async def health(service_id: str):
    return await get_manager().health(service_id)


@router.post("/api/connectors/{service_id}/invoke")
async def invoke(service_id: str, request: Request):
    """直接调试工具（开发 / 排查用）。body: {"tool": "...", "args": {...}}"""
    body = await request.json()
    return await get_manager().invoke(service_id, body.get("tool", ""), body.get("args", {}))


def register_connector_routes(app) -> None:
    app.include_router(router)
