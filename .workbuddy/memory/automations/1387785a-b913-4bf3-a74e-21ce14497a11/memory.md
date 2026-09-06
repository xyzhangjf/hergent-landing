# Hermes Agent 官方更新监控 — 执行记录

## 2026-09-06（首次执行）
- 结论：**A 无需升级，维持生产 v0.19.0**。
- 官方最新：GitHub v2026.8.31 = v0.21.0「Pantheon」(2026-08-31)，晚于已评估的 v2026.8.27(v0.20.6)；PyPI 仍停 0.19.0（滞后，不作为依据）。
- 已浅克隆 v2026.8.31 到 /tmp/hermes-231-src 做 5 耦合点静态核查：
  - ① /v1/chat/completions：gateway/platforms/api_server.py 原生提供(端口8642/API_SERVER_KEY) + proxy /v1/{tail} 仍在 → 语义兼容、形态待核
  - ② /v1/skills：v0.21.0 在 gateway api_server 恢复(相对 v0.20.6 纯 /api/skills 是逆转)，返回 {object,data[]} 匹配 hergent → 新形态下兼容
  - ③ cron bridge：全仓零结果，**仍未回归** → 断裂依旧（升级=定时任务全挂）
  - ④ config：mcp_servers 顶层键仍读(兼容)；cors_origins/api_server 挪 extra/环境变量 → 需迁移
  - ⑤ ~/.hermes/SOUL.md 仍被引擎原样读取注入 → 兼容
- 关键事实：v0.21.0 引入全新 gateway/ 运行时（默认端口 8642、API_SERVER_KEY、进程监管），架构变化比 v0.20.6 更大；新能力 90% 桌面/多机器人向，对 hergent 增益≈0；唯一亮点 cron 记忆化被 cron 桥接断裂抵消。
- 环境备注：本机代理 127.0.0.1:63932 已失效，GitHub 直连可用（克隆前必须 unset 代理变量）。
- 报告：docs/hermes-update-monitor/2026-09-06.md（目录首次创建，仅 1 份，无过期清理动作）。
- 升级触发条件（写进报告）：官方出现 headless/server 正式发行说明、或修复 cron bridge/config 迁移/18765 兼容、或严重安全公告波及 v0.19.0 暴露面。
