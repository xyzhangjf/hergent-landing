# 副驾支持"两个独立文件自动合并对账" — 落地总结

用户要求把"两个独立文件自动合并对账"做成支持。已按"先看 Hermes 结构、不重复造"原则落地，生产真机 E2E 验收通过。

## 架构决策（关键：不碰生产后端）
- 后端 `_run_query(match)` 是**单文件内两 sheet**对账（同路径）。跨文件对账是 MCP 专属新能力。
- 正确做法：在 `server.py` 新增 `spreadsheet_reconcile_files`，**复用后端 `chat_attachment._load_sheets` / `_to_float` 解析层**（不重写解析），并把 match 语义原样套用在两个文件上。零 `chat_attachment.py` 改动 → 无需 restart `hergent-erp`。

## 改动清单（已部署生产）
**1. `/opt/hergent-mcp-spreadsheet/server.py`（已 rsync + chown + 语法 OK）**
- 新增工具 `spreadsheet_reconcile_files(file_a, file_b, key, amount, sheet_a="", sheet_b="")`：
  - `_locate` 两个 file_id（不可猜测 32hex）分别定位；sheet 缺省取各文件首 sheet。
  - key 必填（缺则 400）；amount 可选（缺则只比"有无"、不算金额差）。
- 新增辅助 `_reconcile_files`：对账语义与 `_run_query(match)` **完全一致**（only_in_a / only_in_b / mismatch 三类、阈值 0.001、samples 各 10 条），返回结构对齐，便于前端/Hermes 统一消费。
- 备份 `server.py.bak-reconcile-20260822-143000`；重启 `hermes-gateway` 让 stdio 子进程重生（mcp_stdio_watchdog 保活）。

**2. `hergent-cn-v2/src/components/CopilotDrawer.vue`（构建 `index-BzxOPCDg.js` → rsync + chown）**
- `spreadsheetSoftHint` 改为接收附件数组 `tableFiles`；`send()` 收集**全部** xlsx/csv 附件的 `file_id`（不再只取第一个）。
- ≥2 个表文件时，软提示明确指令 Hermes 用 `spreadsheet_reconcile_files(file_a=,file_b=,key=,amount=)` 跨文件对账，**严禁自行写脚本合并**；单文件保留原 match/groupby/sum 指令。

## E2E 真机验收（决定性证据）
- 工具单测（绕过 Hermes）：流水A/流水B fixture → only_in_a=1(K003/300)、only_in_b=1(K004/400)、mismatch K002(200/250) — 与预期完全一致。
- 经 Hermes 端到端（模拟前端双文件请求）：
  - mcp-stderr 真实记录 `spreadsheet_reconcile_files a=aaaa… b=bbbb… key=单号 amount=金额`（两文件各出现 2 次）。
  - 最终回答："共 3 处差异：只有流水A有 K003(300) / 只有流水B有 K004(400) / K002 A=200 B=250 差50" — 与 fixture 完全吻合。
  - agent.log：`tool_turns=2`、`api_calls=3/90`、`check_close_terminal_requirements returned False`（terminal 本回合不可用）→ **零 terminal、秒级完成、无超时掉线风险**。
- 自建测试 fixture 已清理，生产目录干净。

## 用户怎么用
- 分别上传两份报表（如「银行流水.xlsx」+「系统收支.csv」），直接问"对账"即可。
- AI 会先 `spreadsheet_summary` 看两边结构，再自动调 `spreadsheet_reconcile_files` 跨文件对账，返回差异明细。
- 单文件内双 sheet 对账仍走原 `spreadsheet_query(op=match)`，不受影响。

## 后续可选
- 若想让 AI 在没有明确 key/amount 时更聪明地自动猜测对账列，可在 `_reconcile_files` 加启发式（当前要求 Hermes 传 key）。
- 前端"AI助手暂时离线"提示可优化为"连接中断，可重试"（当前是 SSE 断开后的内存态误报）。
