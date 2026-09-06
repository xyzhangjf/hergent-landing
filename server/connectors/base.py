# server/connectors/base.py — 连接器统一接入接口
from abc import ABC, abstractmethod
from typing import Any, Dict, List

from .schemas import ConnectorStatus, ToolResult, ConnectorHealth


class IServiceConnector(ABC):
    """所有连接器（QQ邮箱 / 企业微信 / 飞书 / 未来任意服务）统一实现的接口。"""

    @property
    @abstractmethod
    def service_id(self) -> str:
        """连接器唯一 id，如 qqmail / wecom / feishu。"""
        ...

    @abstractmethod
    async def configure(self, cfg: Dict[str, Any]) -> None:
        """保存凭据/参数到内存（加密落库由 Manager 负责）。"""
        ...

    @abstractmethod
    async def connect(self) -> ConnectorStatus:
        """按配置校验凭据并建立会话；返回真实连接状态。"""
        ...

    @abstractmethod
    async def disconnect(self) -> None:
        """断开并回收会话。"""
        ...

    @abstractmethod
    async def health_check(self) -> ConnectorHealth:
        """健康检查（重新校验凭据 / 探测服务可达）。"""
        ...

    @abstractmethod
    async def invoke_tool(self, tool: str, args: Dict[str, Any]) -> ToolResult:
        """统一调用入口：send_email / send_message / create_doc ... """
        ...
