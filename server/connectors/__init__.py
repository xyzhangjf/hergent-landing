# server/connectors — MCP 连接器后端（直连接口架构 v1）
# 动态注册 + 配置 + 生命周期管理；直接调用第三方官方 API。
# 结构遵循 IServiceConnector 抽象，后续可平滑替换为 stdio MCP 子进程。

from .manager import ConnectorManager, get_manager

__all__ = ["ConnectorManager", "get_manager"]
