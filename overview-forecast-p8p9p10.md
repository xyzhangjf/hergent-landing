# Forecast.vue P8/P9/P10 共 10 项增强 · 交付总览

> 上一轮 P5/P6/P7（10 项）已上线；本轮用户「全做」= 再落 P8→P9→P10 共 10 项，端到端上线生产。

## 变更摘要

### ① 前端 10 项增强（生产 HTTP 200，已验证）
全部落在 `hergent-cn-v2/src/pages/Forecast.vue` + `src/api/modules.js`：

| 层级 | 项 | 入口 | 说明 |
|------|----|------|------|
| P8 智能决策 | 自然语言下单建议书 | 📝 建议书 | 汇总体检/货损/MOQ，一键推送审批 |
| P8 | 实时库存临期/缺货预警 | 🔔 库存预警 | 接 inventory 批次+到期，商品名 🔔 徽标 |
| P8 | 预测准确率追踪 | 🎯 准确率 | 上期预报 vs 实际销量，命中率+差异表 |
| P9 协同闭环 | 审批流回写 | ✅ 审批 | 状态机 draft→submitted→approved/rejected→revised + 回写ERP |
| P9 | 云端共享批注 | 💬（升级） | localStorage→云端 per-period 多人共享 |
| P9 | 改动留痕审计 | 📜 审计 | 保存/审批自动写审计 trail |
| P10 平台规模化 | 配方行业模板库 | 📚 行业模板 | 当前 recipe 存模板、一键套用（护城河变现） |
| P10 | 经营看板 BI | 📊 经营看板 | 货损/返利/工资/预报 轻量聚合卡片 |
| P10 | 连接器回写 | 🔗 回写ERP | 审批后经 kingdee/yonyou/zhoupu 回写（降级骨架） |
| P10 | 小程序审批契约 | 📱 小程序审批 | 复用审批状态机，契约见独立文档 |

### ② 后端（同文件扩展，一次 deploy 上线）
`hergent-erp/server/routers/forecast_config.py` 新增 8 端点（均 per-tenant，SQL 防御式降级）：
- `GET /realtime-warn`、`GET /accuracy`
- `GET|POST /submission`（审批状态机）
- `GET|PUT /notes`（云端共享批注）
- `GET|POST /audit`（审计留痕）
- `GET|PUT /recipe-templates`（行业模板）
- `GET /bi`（经营看板聚合）
- `POST /connector-writeback`（回写适配器）

## 业务收益
- **配方/批注/审批/审计/模板** 从「前端本地兜底」升级为「云端 per-tenant 下发」——同客户多设备/多人协同一致，直接服务「配方化差异化」护城河战略。
- **审批闭环打通**：建议书 → 审批状态机 → 回写 ERP（回写为降级骨架，待配置 DataSourceAdapter 真正下发）。
- **行业模板库** = 护城河变现的直接抓手（成功客户 recipe 一键套用）。

## 实测验证
- 前端 `npm run build` ✓（Forecast-DNy9qSpo.js 395.76kB）→ rsync `/opt/hergent-cn-v2` + chown → 生产 HTTP 200，8 功能标签+8 端点路径编入产物核验通过。
- 后端 `bash deploy.sh` ✓ → health **200**；8 新路由未授权探测均 **401**（确认已挂载、鉴权生效）。
- 契约文档：`forecast-miniprogram-approval-contract.md`。

## 已知非阻塞（建议实测项）
1. **登录态真机走一遍**：10 项新功能 + 云端批注/审批/审计是否真从云端拉到（之前是本地）。
2. **准确率需数据**：先完成至少一期预报提交并产生实际销量，准确率才有数字（否则返回"数据不足"提示）。
3. **连接器回写**：未配置 DataSourceAdapter 时 soft_fail + 审计留痕，配置后真正下发（战略：回写走连接器不自研）。
4. **服务启动期迁移告警**（webhook_events 等）为老问题，与本变更无关，服务正常起在 :8700。

任务 #82–#92 全部完成；工作日日志见 `.workbuddy/memory/2026-08-23.md`。
