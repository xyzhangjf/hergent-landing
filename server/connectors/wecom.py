# server/connectors/wecom.py — 企业微信连接器（直连接口）
# 连接时获取 access_token；invoke 直接调企业微信应用消息 / 群机器人 API。
import httpx

from .base import IServiceConnector
from .schemas import ConnectorStatus, ToolResult, ConnectorHealth

_BASE = "https://qyapi.weixin.qq.com/cgi-bin"


class WeComConnector(IServiceConnector):
    def __init__(self, manifest: dict):
        self._manifest = manifest
        self._cfg: dict = {}
        self._token: str = ""
        self._connected = False

    @property
    def service_id(self) -> str:
        return "wecom"

    async def configure(self, cfg: dict) -> None:
        self._cfg = cfg or {}

    async def connect(self) -> ConnectorStatus:
        try:
            async with httpx.AsyncClient(timeout=15) as c:
                r = await c.get(
                    _BASE + "/gettoken",
                    params={"corpid": self._cfg["corpid"], "corpsecret": self._cfg["secret"]},
                )
                d = r.json()
            if d.get("errcode", 0) != 0:
                return ConnectorStatus("error", "企微鉴权失败：" + str(d.get("errmsg", ""))[:160])
            self._token = d["access_token"]
            self._connected = True
            return ConnectorStatus(
                "connected",
                "access_token 获取成功",
                ["send_message", "send_group_message", "get_contacts", "create_webhook_robot"],
            )
        except Exception as e:
            self._connected = False
            return ConnectorStatus("error", "企微连接失败：" + str(e)[:160])

    async def disconnect(self) -> None:
        self._connected = False
        self._token = ""

    async def health_check(self) -> ConnectorHealth:
        if not self._token:
            return ConnectorHealth("error", 0, "未连接")
        return ConnectorHealth("ok", 0, "已连接（access_token 有效）")

    async def invoke_tool(self, tool: str, args: dict) -> ToolResult:
        if not self._token:
            return ToolResult(False, None, "未连接，请先连接")
        try:
            if tool == "send_message":
                return await self._send_message(args)
            if tool == "send_group_message":
                return await self._send_group_message(args)
            if tool == "get_contacts":
                return await self._get_contacts(args)
            if tool == "create_webhook_robot":
                return ToolResult(True, {"note": "群机器人在企业微信后台创建，此处仅登记"}, None)
            return ToolResult(False, None, "未知工具：" + tool)
        except Exception as e:
            return ToolResult(False, None, str(e)[:200])

    async def _send_message(self, args: dict) -> ToolResult:
        payload = {
            "touser": args.get("user_id", ""),
            "msgtype": "text",
            "agentid": int(self._cfg.get("agentid", 0)),
            "text": {"content": args.get("content", "")},
        }
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(_BASE + "/message/send", params={"access_token": self._token}, json=payload)
            d = r.json()
        if d.get("errcode", 0) != 0:
            return ToolResult(False, None, d.get("errmsg", ""))
        return ToolResult(True, {"msgid": d.get("msgid")}, None)

    async def _send_group_message(self, args: dict) -> ToolResult:
        # robot_key 走群机器人 webhook
        robot_key = args.get("robot_key") or args.get("chat_id")
        if robot_key:
            webhook = "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=" + robot_key
            async with httpx.AsyncClient(timeout=15) as c:
                r = await c.post(webhook, json={"msgtype": "text", "text": {"content": args.get("content", "")}})
                d = r.json()
            ok = d.get("errcode", 0) == 0
            return ToolResult(ok, d, None if ok else d.get("errmsg", ""))
        # 否则走应用推送（按部门/标签）
        payload = {
            "toparty": args.get("party", ""),
            "msgtype": "text",
            "agentid": int(self._cfg.get("agentid", 0)),
            "text": {"content": args.get("content", "")},
        }
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(_BASE + "/message/send", params={"access_token": self._token}, json=payload)
            d = r.json()
        ok = d.get("errcode", 0) == 0
        return ToolResult(ok, {"msgid": d.get("msgid")}, None if ok else d.get("errmsg", ""))

    async def _get_contacts(self, args: dict) -> ToolResult:
        dept_id = args.get("dept_id", 1)
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.get(
                _BASE + "/user/simplelist",
                params={"access_token": self._token, "department_id": dept_id, "fetch_child": 0},
            )
            d = r.json()
        if d.get("errcode", 0) != 0:
            return ToolResult(False, None, d.get("errmsg", ""))
        return ToolResult(True, {"users": d.get("userlist", [])}, None)
