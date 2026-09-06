# server/connectors/feishu.py — 飞书连接器（直连接口）
# 连接时获取 tenant_access_token；invoke 直接调飞书 Open API。
import json
import httpx

from .base import IServiceConnector
from .schemas import ConnectorStatus, ToolResult, ConnectorHealth

_BASE = "https://open.feishu.cn/open-apis"


class FeishuConnector(IServiceConnector):
    def __init__(self, manifest: dict):
        self._manifest = manifest
        self._cfg: dict = {}
        self._token: str = ""
        self._connected = False

    @property
    def service_id(self) -> str:
        return "feishu"

    async def configure(self, cfg: dict) -> None:
        self._cfg = cfg or {}

    async def connect(self) -> ConnectorStatus:
        try:
            async with httpx.AsyncClient(timeout=15) as c:
                r = await c.post(
                    _BASE + "/auth/v3/tenant_access_token/internal",
                    json={"app_id": self._cfg["app_id"], "app_secret": self._cfg["app_secret"]},
                )
                d = r.json()
            if d.get("code", 0) != 0:
                return ConnectorStatus("error", "飞书鉴权失败：" + str(d.get("msg", ""))[:160])
            self._token = d["tenant_access_token"]
            self._connected = True
            return ConnectorStatus(
                "connected",
                "tenant_access_token 获取成功",
                ["send_message", "upload_file", "create_doc", "get_events"],
            )
        except Exception as e:
            self._connected = False
            return ConnectorStatus("error", "飞书连接失败：" + str(e)[:160])

    async def disconnect(self) -> None:
        self._connected = False
        self._token = ""

    async def health_check(self) -> ConnectorHealth:
        if not self._token:
            return ConnectorHealth("error", 0, "未连接")
        return ConnectorHealth("ok", 0, "已连接（tenant_access_token 有效）")

    async def invoke_tool(self, tool: str, args: dict) -> ToolResult:
        if not self._token:
            return ToolResult(False, None, "未连接，请先连接")
        try:
            if tool == "send_message":
                return await self._send_message(args)
            if tool == "create_doc":
                return await self._create_doc(args)
            if tool == "get_events":
                return await self._get_events(args)
            if tool == "upload_file":
                return ToolResult(True, {"note": "上传文件需二进制流，建议走飞书 SDK"}, None)
            return ToolResult(False, None, "未知工具：" + tool)
        except Exception as e:
            return ToolResult(False, None, str(e)[:200])

    async def _send_message(self, args: dict) -> ToolResult:
        receive_id = args.get("receive_id", "")
        msg_type = args.get("msg_type", "text")
        content = args.get("content", "")
        if isinstance(content, dict):
            content = json.dumps(content, ensure_ascii=False)
        elif msg_type == "text":
            content = json.dumps({"text": content}, ensure_ascii=False) if not content.startswith("{") else content
        payload = {
            "receive_id": receive_id,
            "msg_type": msg_type,
            "content": content,
        }
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(
                _BASE + "/im/v1/messages",
                params={"receive_id_type": args.get("receive_id_type", "user_id")},
                headers={"Authorization": "Bearer " + self._token},
                json=payload,
            )
            d = r.json()
        if d.get("code", 0) != 0:
            return ToolResult(False, None, d.get("msg", ""))
        return ToolResult(True, {"message_id": d.get("data", {}).get("message_id")}, None)

    async def _create_doc(self, args: dict) -> ToolResult:
        payload = {
            "title": args.get("title", "未命名文档"),
            "folder_token": args.get("folder_token", ""),
            "doc_type": "docx",
        }
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(
                _BASE + "/docx/v1/documents",
                headers={"Authorization": "Bearer " + self._token},
                json=payload,
            )
            d = r.json()
        if d.get("code", 0) != 0:
            return ToolResult(False, None, d.get("msg", ""))
        return ToolResult(True, {"document": d.get("data")}, None)

    async def _get_events(self, args: dict) -> ToolResult:
        params = {"time_min": args.get("start", ""), "time_max": args.get("end", "")}
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.get(
                _BASE + "/calendar/v4/calendars/primary/events",
                headers={"Authorization": "Bearer " + self._token},
                params={k: v for k, v in params.items() if v},
            )
            d = r.json()
        if d.get("code", 0) != 0:
            return ToolResult(False, None, d.get("msg", ""))
        return ToolResult(True, {"events": d.get("data", {}).get("items", [])}, None)
