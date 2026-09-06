# 预报单小程序审批 · API 契约（P10-10）

> 配套 `Forecast.vue` 的「✅ 审批流（状态机）」。老板在 `forecast-order-miniprogram` 手机端批单，
> 复用同一套后端状态机，web 端与小程序实时一致。

## 状态机
`draft → submitted → approved / rejected → revised(退回修改) → submitted …`

| 状态 | 含义 | 可操作 |
|------|------|--------|
| draft | 草稿 | 提交审批 |
| submitted | 待审批 | 通过 / 驳回 |
| approved | 已通过 | 退回修改 / **回写 ERP**（需配置连接器） |
| rejected | 已驳回 | 退回修改 |
| revised | 退回修改 | 提交审批 |

## 端点（均位于 `server/routers/forecast_config.py`，前缀 `/api/forecast`，需登录态鉴权）
- `GET  /submission?period_id=<pid>` → `{status, by, at, reason}`
- `POST /submission` body `{period_id, action:'submit'|'approve'|'reject'|'revise', reason?}` → 新状态
- `GET  /notes?period_id=<pid>` → `{notes:{pid:{text,by,at}}}`（共享批注）
- `POST /connector-writeback` body `{period_id, connector:'kingdee'|'yonyou'|'zhoupu', items:[{product_id,name,qty}]}` → 回写 ERP（MVP 为适配器骨架，未配置连接器时 soft_fail 并留痕）

## 小程序侧待办
1. 列表页取 `forecast_periods`，展示「待审批」期次（按 `submission.status` 过滤）。
2. 详情页展示交叉表定稿量（复用 `/api/forecast/approval` 或已有 summary 端点）。
3. 审批按钮调用 `POST /submission`（approve/reject），reject 需填原因。
4. 通过后展示「回写 ERP」入口（调 `POST /connector-writeback`）。
5. 与 web 端共享同一 JWT/会话；状态变更即双向可见。

## 备注
- 审批/回写/批注/保存均自动写入 `forecast_config` 表（`approval:<pid>` / `notes:<pid>` / `audit:<pid>`），租户隔离由连接层保证。
- 当前 MVP：连接器回写为降级骨架（无连接器配置时 soft_fail + 审计留痕），战略上「回写走连接器不自研」，配置 DataSourceAdapter 后真正下发。
