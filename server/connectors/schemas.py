# server/connectors/schemas.py — 连接器核心数据结构
from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class ConnectorStatus:
    status: str = "disconnected"   # disconnected | connecting | connected | error
    message: str = ""
    tools: list = field(default_factory=list)


@dataclass
class ToolResult:
    success: bool = False
    data: Any = None
    error: str = ""


@dataclass
class ConnectorHealth:
    status: str = "unknown"        # ok | error | unknown
    latency_ms: int = 0
    message: str = ""
