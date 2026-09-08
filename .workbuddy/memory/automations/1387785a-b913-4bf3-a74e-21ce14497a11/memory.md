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

## 2026-09-06（第二次触发，实际为会话续接任务）
- 本次触发 user_query = 「继续基于摘要上下文完成对话」（非 Hermes 官方复检），实际执行的是 WorkBuddy 深挖第二期 7 项增量的最后一项 **P2-⑦ 技能/配方自进化 + 审计**。
- 完成：新增 `server/routers/recipe_evolution.py`（recipe_proposals 提案表 + 审批合并 + record_recipe_audit 主库审计），三处配方保存端点接入审计；生产 E2E（demo 租户）全链路通过；commit 78211f4，health 200。
- 详见项目日志 `.workbuddy/memory/2026-09-06.md` §7 与报告 `docs/Hermes引擎×WorkBuddy-深挖第二期-产品机制借鉴-2026-09-06.md` §5。Hermes 官方升级结论维持上一轮：**A 无需升级，v0.19.0**。

## 2026-09-07（例行周检）
- 结论：**A 无需升级，维持生产 v0.19.0**。
- 官方最新：GitHub 仍止于 **v2026.8.31 = v0.21.0「Pantheon」(2026-08-31)**，一周内无新 tag，与 09-06 已评估版完全相同；PyPI 仍停 0.19.0。
- 复用 /tmp/hermes-231-src（v2026.8.31 仍存在）对 5 耦合点做了 grep 复核，与上次结果一致：①/v1/chat/completions 在 gateway 仍在（新运行时端口 8642/API_SERVER_KEY）；②/v1/skills 已恢复（api_server.py:2235）；③ cron bridge **仍未回归（零命中）→ 升级=定时任务全挂**；④ cors_origins 改读 extra/env(API_SERVER_CORS_ORIGINS)，mcp_servers 顶层仍读；⑤ SOUL.md 仍被 discovery+read 原样注入。
- 报告：docs/hermes-update-monitor/2026-09-07.md（目录共 2 份，无需清理）。
- 升级触发条件未变：headless/server 发行说明、cron bridge/config 迁移/18765 兼容修复、或波及 v0.19.0 的严重安全公告。

## 2026-09-08（例行周检）
- 结论：**A 无需升级，维持生产 v0.19.0**。
- 官方最新：GitHub **v2026.9.7 = v0.21.1**（2026-09-07 22:17 UTC，v0.21.0 后 632 PR 滚动汇总，无破坏性公告，完整说明待 v0.22.0）；PyPI 仍停 0.19.0。此为上一轮（09-07 早间执行）之后的新 tag，已按流程做全量核查。
- 下载方式变更：git 直连 GitHub 报 Empty reply、代理 63932 已死 → 改用 **curl codeload.github.com + --http1.1** 拉 tar.gz（66MB）解压至 /tmp/hermes-271-src（183M/5815 py，保留供复查）。
- 5 耦合点核查（v0.21.1）：① /v1/chat/completions 在 gateway 路由表+OpenAI handler（兼容）；② /v1/skills 恢复于 api_server.py:1510 返回 {object,list,data}（兼容）；③ **cron bridge 全仓零命中仍未回归 → 升级=定时任务全挂（断裂依旧）**；④ **config 有实质改善**：gateway/config_loader.py 会把 platforms.api_server 旧键 port/key/host/cors_origins/model_name 桥接进 extra，mcp_servers 顶层仍读（软化了 v0.21.0 评估的"必手改迁移"，仍须 staging 实测）；⑤ SOUL.md 仍被 prompt_builder 读取注入（兼容）。
- v0.21.1 新能力（模块化/启动性能/桌面会话/MCP 授权/cron 修复）90% 桌面向，hergent 增益≈0；新 tag 相对 v0.21.0 无 hergent 需要项 → 维持 A。
- 安全观察：PyPI 4 条未修复漏洞记录（≤0.12.0+飞书 webhook），v0.19.0 理论安全漂移，暴露面小未达触发标准，入观察。
- 报告：docs/hermes-update-monitor/2026-09-08.md（目录共 3 份，无需清理）。
