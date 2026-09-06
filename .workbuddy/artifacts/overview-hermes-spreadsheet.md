# 副驾 Excel 对账：方案 A 落地 + 生产 E2E 验收

## 完成了什么
把"上传 Excel 让 Hermes 对账"从**前端主导计算**（脆弱的意图推断 + 参数猜测）回退为**方案 A：表格计算完全上移至 Hermes**，前端只透传 `file_id` 软提示。后端/代理侧（#424 spreadsheet MCP server、#425 注册到 Hermes 并修通 5 层环境坑）已在上一轮验证，本轮回退前端回路并做真机验收。

## 关键改动
- **`hergent-cn-v2/src/api/client.js`**：删除整块前端主导计算回路（`wantsTableCalc` / `classifyIntent` / `inferReconcile` / `inferSum` / `inferGroupBy` / `stripTableQuery` / `safeTableQueryPrefix` / `tableToolSystemHint` / `hermesChatWithTableTools`），仅保留 `hermesChat`。前端零表格计算逻辑。
- **`hergent-cn-v2/src/components/CopilotDrawer.vue`**：`send()` 改回 plain `hermesChat`；上传的 Excel/CSV 的 `file_id` 仅以「软提示」注入 system（`spreadsheetSoftHint()`：先看 summary 再看结构、可用 `spreadsheet_summary`/`spreadsheet_query`、严禁心算预览），卡片抽取逻辑保留。
- **部署**：`npm run build` → `index-GPwyAbbe.js` → rsync `/opt/hergent-cn-v2` + `chown`。

## 真机验收（决定性证据）
模拟前端请求打生产 Hermes 端点，用确定性 fixture（A: K001/100, K002/200, K003/300；B: K001/100, K002/250, K004/400）：
- Hermes 工具链：`spreadsheet_summary`×2 → `spreadsheet_query`×2（自主规划参数、调工具）。
- 最终结论与真实差异**完全一致**：仅 A 有 K003(300)、仅 B 有 K004(400)、K002 A=200/B=250（差 50）、K001 无误。
- 我发过去的预览文本**只含 A 表前 2 行**，Hermes 却找全了预览里根本没出现的 K003/K004 → 证明走的是 MCP 工具对**整表**的真实计算，而非猜测预览。✅ E2E_RECONCILE_PASS

## 架构收益
- 前端不再承担脆弱的"模型听不听话"问题；Hermes 模型自主规划对账/汇总/求和。
- 复用后端 `routers/chat_attachment._run_query` 单点真理源，零重写。
- 与用户铁律一致：先看 Hermes 既有结构、不重复造轮子。

## 后续
- 前端预览文本仍会随消息发出（给模型看列结构），真实计算全在工具侧——属预期行为。
- 待用户真机上传双表走一遍 UI 确认（生产路径已验证，仅缺浏览器点击这一步）。
- 历史遗留：tenant1 企业微信 Webhook 此前被 E2E 覆盖，需用户在「能力中心 → 连接手机 → 企业微信」重填真实 Webhook。
