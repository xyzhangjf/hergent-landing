# AI 副驾 P0 排雷 — 完成交付（2026-08-22）

## 背景
前一轮对 AI 副驾项目（前端 hergent-cn-v2 + 后端 hergent-erp）做了系统性代码评审，
核出 **4 颗会炸的炸弹** 和若干前端健壮性隐患。用户确认「要」→ 直接挑 P0 动手修。
全部修复已落地、构建、部署到生产，并通过 E2E 验收。

## 改动清单

### 炸弹① 租户库创建 fail-closed（后端 · 致命数据风险）
`server/db/connection.py` — `_ensure_tenant_db()`
- 原：建库/backup 失败只 `warning` + 注释谎称「回退主库」，实际 `get_db()` 已指向可能无 schema 的**空租户库** → 新租户/坏库静默丢数据。
- 改：失败 `raise`；`partial` 标志清理半成品 `.db/.db-wal/.db-shm`；修正误导注释。

### 炸弹② 硬编码 Mac 绝对路径（后端 · 换服务器即崩）
`server/domain/forecast_engine.py`（:100 `exp_smoothing` / :352 `_calculate_promotion_uplift`）
- 原：`sys.path.insert(0, "/Users/zhangjunfeng/Documents/hergent-erp/server")`。
- 改：动态 `_SERVER_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))` 注入 `sys.path`。

### 炸弹③ 缺 AI key 导入即 raise（后端 · 全站起不来）
`server/ai_engine.py`
- 原：导入期 `raise RuntimeError("AI_API_KEY environment variable is required")`。
- 改：**删除导入期 raise**，改 `call_ai()`/`chat_ai()` 顶部懒校验 `if not AI_KEY: return None` + NOTE 注释。
- ⚠️ 过程回归：首轮 Edit 漏删 import-time raise，被生产 E2E `python3 -c "import ai_engine"` 抓到 `RuntimeError` → 重读本地确认 raise 仍在 → 真正删除 → 复验 `AI_KEY set? False` 不再抛。

### 炸弹④ 前端 SSE 三连（前端 · 掉线+半截落盘+误报离线）
`hergent-cn-v2/src/components/CopilotDrawer.vue`
- `send()` 拆 `streamReply(lastPayload)` + `retryLast()`（`lastPayload` 缓存，重试不发新请求）。
- `try/catch` 替 `.catch().finally().then()` 链：链式 `.catch` 不重抛 → `.then` 失败仍会触发卡片请求（旧 bug）。
- 失败 `splice` 半截气泡、分级错误文案、成功才触发卡片/推送、`saveCurrentSession`。
- 新增 `.cp-retry` 重试按钮 + 样式。
- `hergent-cn-v2/src/api/client.js`：`hermesChat` 超时 `120000 → 300000`（保留字符串返回签名，不破 `Workbench.vue:216` 非流式调用）。

### 额外 P0 加固（评审报告同批）
- `hergent-cn-v2/src/router/index.js`：全部 `import X` → `() => import()` 懒加载。首屏主包 `index-Cm01ASIv.js` = 120KB（gzip 47KB），各页独立 chunk。
- 新建 `hergent-cn-v2/src/components/ErrorBoundary.vue`（`onErrorCaptured`）+ `App.vue` 用 `<ErrorBoundary>` 包 `<router-view>` + `main.js` `app.config.errorHandler` → 全局兜底白屏。

## 部署
- 后端：`rsync -a --no-owner --no-group --exclude='*.db*' --exclude='__pycache__' server/ root@47.113.224.140:/opt/hergent-erp/` → `chown hergent:hergent` → `systemctl restart hergent-erp`（active）。
- 前端：`vite build` → `rsync --delete dist/ root@...:/opt/hergent-cn-v2/` → `chown -R hergent:hergent`（nginx 纯静态，无需 restart）。

## 验证结论（生产 E2E）
| 项 | 结果 |
|---|---|
| `/api/health` | 200（python 3.10.12 / 110 api）✅ |
| `import ai_engine` | 不再抛错（`AI_KEY set? False` 安全退出）✅ |
| `forecast_engine` 动态 `erp_db` 解析 | ok ✅ |
| 前端 https + `Host: hergent.cn` | 200 ✅ |
| 主 chunk `assets/index-Cm01ASIv.js` | 200，含「点此重试」✅ |
| 旧「AI助手暂时离线」文案 | 已从所有 `assets` 资源消失（grep `OLD_TEXT_GONE` / `NEW_TIMEOUT_MSG_PRESENT`）✅ |

⚠️ **环境限制（非故障）**：服务器自 curl 公网 IP 返回 `000`（云主机回环/出向限制）；已用 `Host + https` 证明服务正常。

## 残留 / 后续
- P1（消灭裸 fetch、统一错误信封、401 分级、`hermesChat` 分级超时、MCP 解耦、store 收口）与 P2（拆上帝文件 `erp_db.py` 13473 行、`server.py` 4521 行、强制幂等、白名单反转、Alembic）未动，按「新功能写对地方、旧代码慢慢搬」推进，勿大爆炸重构。
- 小程序（forecast-order-miniprogram）审核报告中的 F1/F2/B1 等 bug 修复已落地后端、前端待微信开发者工具重新上传（本环境无法部署微信 app）。
