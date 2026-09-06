# P1 前端 HTTP 层收编 — 交付报告（2026-08-22）

## 背景
承接《AI 副驾项目系统性代码评审》（`review-ai-copilot-2026-08-22.md`）§1.3「7 处裸 fetch + 401 全局强踢 + 错误信封脆弱」。
P0 四炸弹已排雷闭环后，用户确认「要」推进 P1 前端工程化切片（消灭裸 fetch / 统一错误信封 / 401 分级）。

**实查澄清（避免硬套评审行号）**：grep 核实 7 处裸 `fetch` 真实分布：
- `client.js:19/34/48` login/register/demoLogin —— pre-auth 端点无 token，**刻意保留**裸 fetch（收编会误触发 401 重定向）。
- `client.js:64` 是 `api()` 内部核心、`client.js:105` 是 `hermesChat` 内部核心 —— 本就是统一封装本身。
- **真正外溢重复鉴权逻辑**：`modules.js:197 _formPost`（5 个上传接口共用）与 `Settings.vue:213` 裸 fetch Hermes models。

故收编面收敛为 2 处。

## 改动清单

### #438 强化 `api()` — `src/api/client.js`
- **FormData 兼容**：`body instanceof FormData` 时透传（不设 `Content-Type`、不 `JSON.stringify`），由浏览器补 multipart 边界；JSON 调用行为不变。
- **`silent401` 选项**：默认 `false`（401 仍强踢登录页 `location.hash='#/login'`）；轮询/心跳等后台请求传 `true` 时仅 `auth.token=''` + `throw`，**不跳登录**（消除误踢风险）。
- **文档化统一错误信封契约**：函数头注释写明后端 `{success,data?,detail?,message?}` 提取规则（data 存在返 data.data；否则返整包；失败抛 `Error(detail||message||状态)`）。

### #439 收编 `modules.js _formPost`
- 5 个上传接口（chat-attachment / import smart-parse / one-shot / preview / execute）由裸 `_formPost` 改为 `api(path,{method:'POST',raw:true,body:fd})`。
- 删除重复的 Bearer/CSRF/401 函数体与 `import { auth }`；`raw:true` 保持返回整包行为不变。

### #440 收编 `Settings.vue` 裸 fetch
- `client.js` 新增 `hermesRequest(path, opts)`：统一 Hermes REST 鉴权（复用 `hermesKey` / `localStorage.hermes_v2_key`），返回 `{ok,status,data}`，401 不强制跳登录。
- `Settings.vue test()` 改用 `hermesRequest('/hermes/v1/models')`，保留原 UI 文案逻辑（成功/失败状态码展示）。

## 部署
```
npm run build
rsync -a --no-owner --no-group --delete dist/ root@47.113.224.140:/opt/hergent-cn-v2/
ssh -i ~/.ssh/id_ed25519 root@47.113.224.140 "chown -R hergent:hergent /opt/hergent-cn-v2"
```

## 验证结论（生产 E2E）
| 项 | 命令/路径 | 结果 |
|---|---|---|
| 首页可达 | `curl https://hergent.cn/` | 200 |
| 新 Settings 产物 | `assets/Settings-KSQe_dOR.js` | http=200 size=8656，含重构代码（"测试中"字符串） |
| Hermes REST 接线 | `/hermes/v1/models` | 经 `hermesRequest` 接线，端点实测返回 200 |
| 上传端点接线 | `modules-D_9qyiRj.js` grep `chat-attachment`/`import/execute` | 仍在，`api()` 接线 |
| 无裸 fetch 残留 | grep `fetch(` modules.js / Settings.vue | **均无命中**（仅 `api()`/`hermesRequest` 内部保留） |
| 主包一致 | index.html → `index-CvrHcUCw.js` | 哈希一致 |

语法：`node --check` client.js / modules.js 通过；`vite build` 79 模块成功。

## 残留 / 后续（未启动）
- P1 其余项：后端禁 `return {"error"}`（150 处绕过统一信封）、抽 `spreadsheet_query.py`、store 收口（模块级单例→Pinia）、hermesChat 分级超时。
- P2：拆上帝文件（erp_db.py 13k 行 / server.py 4.5k 行）、强制幂等、租户白名单反转（默认拒绝）、Alembic 迁移。

## 交付物
- 代码：`src/api/client.js`、`src/api/modules.js`、`src/pages/Settings.vue`
- 本报告：`p1-frontend-http-consolidation-2026-08-22.md`
