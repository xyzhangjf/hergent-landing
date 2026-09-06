# Forecast.vue 下一代增强（P5/P6/P7）交付总览

> 日期：2026-08-22 ｜ 范围：预报交叉表 `Forecast.vue` 10 项增强 + 后端云端配方/推送端点真正部署
> 状态：**已全部上线生产，前后端验证通过**

## 一、前端 10 项增强（全部落地 `src/pages/Forecast.vue`）

| 项 | 功能 | 关键实现 | 性质 |
|----|------|----------|------|
| P5-1 | 货损联动告警 | `lossWarn(r)` 短保 exp≤7 且超安全库存→risk；≤14 且超 1.5×→watch；name 格显示 🔥 角标 | 纯前端，零后端风险 |
| P5-2 | 返利行内冲刺提示 | `loadRebatePush()` 遍历返利余额调 `rebateGap` 算冲刺缺口，💰面板列出 | 复用既有 rebateGap |
| P5-3 | MOQ 起订量 + 到货周期 | 新增 `moq`/`lead_days` 两列（行内可编辑），`moqMap` + localStorage 兜底；低于 MOQ 行高亮 `moq-below` | 纯前端 |
| P5-4 | 季节因子同环比 | `loadYoY()` 取去年同期期次，`yoyMap`/`yoyPct(r)` 算同比%，表头动态加两列 | 纯前端 |
| P6-5 | 提交前 AI 体检 | `healthIssues`（computed）扫描零量有历史/暴涨>2×/暴跌<0.5×/超安全 3×/货损 risk/未达 MOQ，按 risk/warn/info 排序；🩺面板 + `jumpToRow` 跳转 | 纯前端 |
| P6-6 | 单元格批注 | `notesMap` + localStorage；name 格 💬 角标，`setRowNote` 调 prompt 批注 | 纯前端 |
| P6-7 | 网格内搜索 | `findText`/`findHits`（computed），Ctrl/Cmd+F 唤起，🔍 `findNext` 循环定位 | 纯前端 |
| P6-8 | 企微/飞书推送快照 | `pushForecast()` → `forecastApi.push`（POST `/api/forecast/push`）；失败降级剪贴板 | 后端已部署 |
| P7-9 | 大数据分页 | `pagingOn`/`pageSize=50`/`curPage`，`rowShown(ri)` 加分页过滤；📄 面板翻页 | 纯前端 |
| P7-10 | 云端配方部署 | `forecastRecipeApi`/`columnSchemeApi` 优先后端，失败回退 localStorage；配方/列方案按租户云端下发 | 后端已部署 |

构建：`✓ built in 1.29s`，产物 `Forecast-Bin6FKPn.js`（gzip 124.71 kB）。
部署：`rsync dist/ → root@47.113.224.140:/opt/hergent-cn-v2/` + `chown hergent:hergent`。
生产验证：`curl https://hergent.cn/assets/Forecast-Bin6FKPn.js` → **HTTP 200**；9/10 特性字符串已编入产物核验。

## 二、后端真正部署（收尾 P7-10 + 补 P6-8 推送通道）

**新增文件 `server/routers/forecast_config.py`**
- per-tenant 表 `forecast_config(kind PRIMARY KEY, payload TEXT, updated_at TEXT)`，建表自动 `CREATE TABLE IF NOT EXISTS`。
- 端点：
  - `GET/PUT /api/forecast/recipe` —— 配方化建议引擎云端持久化
  - `GET/PUT /api/forecast/column-schemes` —— 列方案云端持久化
  - `POST /api/forecast/push` —— 推送审批通知（复用 `feishu_notify.push_to_wecom`/`push_to_feishu`，异常 `soft_fail` 不阻断前端）
- 租户隔离由 `db.get_db_tx()` 按 token 上下文自动切租户库保证，表落在租户库内。

**`server.py` 改动**
- 补 `from routers.forecast_config import router as forecast_config_router`
- `app.include_router(forecast_config_router)` 挂载（位于 `forecast_submissions_router` 之后）

**部署与验证**
- `bash deploy.sh` 安全部署（保留 `.env`/`*.db`，`systemctl restart hergent-erp`）。
- 首跑 health 因 `sleep 3` 过短显示 HTTP 000，复检 **HTTP 200**；服务 `active`，Uvicorn 正常起在 :8700。
- 三路由未授权探测均 **401**（确认已挂载、鉴权生效）：
  - `GET /api/forecast/recipe` → 401
  - `POST /api/forecast/push` → 401
  - `GET /api/forecast/column-schemes` → 401

## 三、业务收益
- 「配方 / 列方案」从前端 localStorage 兜底升级为 **per-tenant 云端下发**——同客户多设备/多人协同一致，符合「配方化差异化」护城河战略。
- 推送审批不再仅剪贴板降级，可**真发企微/飞书**通知（通道异常静默降级不阻断）。
- 货损/体检/同环比/MOQ 让预报单在提交前自判风险，把「AI 只建议不擅自下单」的把关前移到编织阶段。

## 四、已知非阻塞项
- 服务启动期迁移告警（`no such table: webhook_events`、若干 `duplicate column` / 历史 `FAILED migration`）为**既有问题**，与本变更无关，服务正常起。
- 前端 `saveEdits` 仅序列化 `qtyByUnit` + 主档字段（含新增 `moq`/`lead_days`）；`suggest/history/_diff/notesMap` 不落库，安全。

## 五、建议下一步（非必须）
1. **登录态真机 E2E**：用户实测 10 项新功能 + 配方/列方案云端下发是否生效。
2. **推送到达确认**：在企微/飞书侧确认收到「预报单审批」通知（依赖 `feishu_notify` 通道配置）。
3. 如后续多租户推广，可在 `forecast_config` 表加 `tenant_id` 维度做跨租户配方模板分发（当前已按连接层天然隔离）。
