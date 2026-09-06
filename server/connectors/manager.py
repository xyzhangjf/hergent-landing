# server/connectors/manager.py — Connector Manager（动态注册 / 配置 / 生命周期）
import json
import os
from typing import Optional

from .base import IServiceConnector
from .store import save_credentials, load_credentials, delete_credentials
from .qqmail import QQMailConnector
from .wecom import WeComConnector
from .feishu import FeishuConnector

MANIFEST_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "manifest.json")
_IMPL = {
    "qqmail": QQMailConnector,
    "wecom": WeComConnector,
    "feishu": FeishuConnector,
}


class ConnectorManager:
    def __init__(self, manifest_path: str = MANIFEST_PATH):
        self._manifest = self._load_manifest(manifest_path)
        self._connectors: dict[str, IServiceConnector] = {}
        self._status: dict[str, dict] = {}
        for m in self._manifest:
            cid = m["id"]
            impl = _IMPL.get(cid)
            if impl:
                self._connectors[cid] = impl(m)
                self._status[cid] = {"status": "disconnected", "message": ""}

    @staticmethod
    def _load_manifest(path: str) -> list:
        with open(path, encoding="utf-8") as f:
            return json.load(f)

    # ---------- 列表 ----------
    def list_connectors(self) -> list:
        out = []
        for m in self._manifest:
            st = self._status.get(m["id"], {"status": "disconnected", "message": ""})
            out.append(
                {
                    "id": m["id"],
                    "name": m["name"],
                    "desc": m.get("desc", ""),
                    "icon": m.get("icon", ""),
                    "recommend": m.get("recommend", False),
                    "status": st.get("status", "disconnected"),
                    "message": st.get("message", ""),
                    "scopes": m.get("scopes", []),
                    "tools": m.get("tools", []),
                    "auth_fields": m.get("auth_fields", []),
                }
            )
        return out

    # ---------- 配置（加密落库） ----------
    async def configure(self, service_id: str, cfg: dict) -> dict:
        if service_id not in self._connectors:
            raise KeyError("unknown connector: " + service_id)
        m = next(x for x in self._manifest if x["id"] == service_id)
        cfg = cfg or {}
        for f in m.get("auth_fields", []):
            if f.get("required", True) and not cfg.get(f["id"]):
                raise ValueError("缺少必填字段：" + f.get("label", f["id"]))
        save_credentials(service_id, cfg)
        return {"success": True}

    # ---------- 连接（校验凭据） ----------
    async def connect(self, service_id: str, cfg: Optional[dict] = None) -> dict:
        conn = self._connectors.get(service_id)
        if not conn:
            raise KeyError("unknown connector: " + service_id)
        if cfg is None:
            cfg = load_credentials(service_id) or {}
        if not cfg:
            raise ValueError("尚未配置凭据")
        self._status[service_id] = {"status": "connecting", "message": "校验凭据中…"}
        try:
            await conn.configure(cfg)
            st = await conn.connect()
        except Exception as e:
            self._status[service_id] = {"status": "error", "message": str(e)[:200]}
            return dict(self._status[service_id])
        self._status[service_id] = {
            "status": st.status,
            "message": st.message,
            "tools": st.tools,
        }
        return dict(self._status[service_id])

    async def disconnect(self, service_id: str) -> dict:
        conn = self._connectors.get(service_id)
        if conn:
            try:
                await conn.disconnect()
            except Exception:
                pass
        self._status[service_id] = {"status": "disconnected", "message": ""}
        return dict(self._status[service_id])

    async def health(self, service_id: str) -> dict:
        conn = self._connectors.get(service_id)
        if not conn:
            raise KeyError("unknown connector: " + service_id)
        try:
            h = await conn.health_check()
            return {"status": h.status, "latency_ms": h.latency_ms, "message": h.message}
        except Exception as e:
            return {"status": "error", "message": str(e)[:200]}

    async def invoke(self, service_id: str, tool: str, args: dict) -> dict:
        conn = self._connectors.get(service_id)
        if not conn:
            raise KeyError("unknown connector: " + service_id)
        res = await conn.invoke_tool(tool, args or {})
        return {"success": res.success, "data": res.data, "error": res.error}


_manager: Optional[ConnectorManager] = None


def get_manager() -> ConnectorManager:
    global _manager
    if _manager is None:
        _manager = ConnectorManager()
    return _manager
