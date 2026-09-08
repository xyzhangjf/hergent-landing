# Postmortem PM-20260905-cookie-priority

> 一句话：后端 `_extract_token` cookie 优先于 Authorization 头，致 boss 用户登录被反复踢回登录页。

---

## 1. 元数据

| 字段 | 值 |
|---|---|
| **Postmortem ID** | PM-20260905-cookie-priority |
| **作者** | 张俊峰 + AI |
| **事故日期** | 2026-09-05 22:31（首次发现） |
| **解决时间** | 2026-09-05 22:46（治本部署） |
| **影响范围** | 单用户（boss），但所有用户隐藏风险 |
| **持续时间** | 约 15 分钟（用户主动反馈前已潜在 N 天） |
| **严重度** | **P1**（功能受损：偶发登录态被踢，未致数据丢失/损坏） |

---

## 2. 5W 一句话

**什么 + 何时 + 何地 + 谁影响 + 怎么发现**：2026-09-05 22:31 后端 `core.py:_extract_token` 实现顺序 bug（cookie 优先于 Authorization 头），影响 boss 用户多端登录态，22:31:44 后端日志同时 6 个接口 401 由用户在生产浏览器手动复测发现。

---

## 3. 时间线

| 时间 | 事件 |
|---|---|
| **N 天前**（历史隐患） | 老 ERP 端 `erp_token` cookie 唯一凭证；前端 `hergent-cn-v2` 改用 Authorization 头时没复审后端优先级——埋下 cookie 与 Authorization 头冲突的种子 |
| **22:30** | 用户尝试登录 boss 账号「boss / boss123」|
| **22:31:44** | 后端日志 6 个 API 接口同时 401（含 `/api/auth/me`、`/api/forecast/periods` 等） |
| **22:33** | 用户反馈「无法登录」，转给 AI 排查 |
| **22:35** | AI 排查：后端 login 200 真机登录正常、账号未锁、三种上下文登录全成功——结论：账号问题已排除 |
| **22:38** | AI 假说：「任一 401 即清 token 跳登录」逻辑把偶发 401 误踢——前端**止血**：加 `probeSession()` 401 复核 |
| **22:44** | AI 追溯真因：日志显示 `core.py:_extract_token` cookie 优先于 Authorization 头——一旦 localStorage 残留过期 token 而 cookie 仍有，会短路登录态 → 触发真凶 |
| **22:45** | AI 改 `core.py`：候选容错解析；改 `routers/auth.py`：logout/change_password 用生效 token；写单测 |
| **22:46** | `deploy.sh` 部署；服务重启 |
| **22:50** | 生产 7/7 凭证组合验证全过（包含「头失效回退 cookie」核心场景） |
| **22:50** | 关闭事故 |

---

## 4. 影响（Impact）

- **受影响用户数**：1（boss）+ **所有用户隐藏风险**（cookie 残留场景即可触发）
- **受影响功能**：所有需登录态的 API（含 `/api/auth/me`、`/api/forecast/periods`、`/api/products/*` 等）
- **数据丢失/损坏**：**无**（仅登录态失效）
- **收入影响**：用户侧无法使用 Hergent 监盘；间接影响 B 端 SaaS 信任度
- **对外影响**：尚未扩散（如持续未被发现会扩散至所有用户）

---

## 5. 根因分析（Root Cause）

### 5.1 直接原因（一句话）

`core.py:_extract_token` 实现顺序 bug：从 `Request.cookies['erp_token']` 优先取凭证，未先尝试 `Authorization: Bearer` 头——一旦两者冲突，cookie 短路覆盖头。

### 5.2 根本原因（为什么走到这一步）

1. **历史包袱**：`erp_token` cookie 是老 ERP 时代唯一凭证的遗产，前端迁移到 Authorization 头时没有复审后端优先级
2. **缺文档化的认证架构图**：当时没画「前端 → 凭证传递链路 → 后端解析顺序」的链路图，后端改 cookie 兼容时也没意识到会反向 shadow 头
3. **无单测覆盖「cookie 与头冲突场景」**：谁能想到 cookie 还会优先于头呢？没有测试用例就没人触发回归

### 5.3 触发链

```
用户在多上下文切换（演示 → 真实）
        ↓
localStorage 残留过期 token + erp_token cookie 残留（演示 cookie）
        ↓
前端 api() 发 Authorization 头（过期）+ 后端优先取 cookie（演示账号）
        ↓
后端用错账号解析 → 派生租户 ID + 触发租户失败 → 6 接口 401
        ↓
旧 api() 行为：「任一 401 即清 token 跳登录」
        ↓
用户被反复踢回登录页
```

### 5.4 不是根因的常见误判

- ❌ 不是「账号被锁」——后端 `login_attempts` 表查询无锁定
- ❌ 不是「密码错误」——后端 login 200 真机三种上下文全成功
- ❌ 不是「前端 token 失效」——401 是后端**主动**拒绝，前端未真正发出过期 token 时也会 401
- ✅ 真正根因：**后端 `_extract_token` 实现顺序错了**——cookie 优先导致 short-circuit 登录态

---

## 6. 修复（Mitigation）

### 6.1 立即修复

| 项 | 改动 | 验证 |
|---|---|---|
| **删除 cookie 优先** | `core.py:_extract_token` 改为候选容错：Authorization 头优先 → cookie 备选 → 任一可用即通过 | 单测 17/17 PASS |
| **封装 `_resolve_auth`** | 遍历候选 → 第一个能查到有效用户的采用，结果缓存 `request.state` | 单测同请求重入只查库 1 次 |
| **logout 删全部候选 token** | `routers/auth.py:logout` 不再只删一个 token，而是删全部候选——避免另一份凭证复活会话 | 单测 logout 后所有候选都失效 |
| **change_password 用生效 token** | 改用 `_resolve_auth(req)` 拿生效 token 后 `DELETE ... WHERE token != ?`——避免误删当前会话 | 单测改密后其他会话保留 |
| **前端 401 复核（止血）** | `client.js:probeSession()` 调 `/api/auth/me` 复核——有效仅抛「未授权 401」不踢；失效才清 | 生产 e2e 实测 |

### 6.2 防复发（预防同样事故再次发生）

| 项 | 改动 | 验收口径 |
|---|---|---|
| **后端单测覆盖** | `server/.auth_resolve_test.py` 17 个用例：头/cookie/混合/失效/同请求缓存/`_get_user` 兼容 | 每次 `pytest server/` 全 PASS |
| **后端 `_extract_token` 留兼容包装** | 旧 `_extract_token` 函数保留为「取首个候选」包装；server.py:113 仅用于「有无凭证」判断，紧接其后的 `_get_user` 走容错解析 | 不再存在「旧逻辑静默回归」可能 |
| **CLAUDE.md 铁律段写入** | 后端 `hergent-erp/CLAUDE.md` 加「3. **认证与租户**」段：明文「凭证解析顺序、Auth 改动必检 11 共享接口、改 `_extract_token` 前先看 `_resolve_auth`」 | 文件已部署 |
| **MEMORY.md 写入「后端铁律」段** | `laozhangai-product/.workbuddy/memory/MEMORY.md` 已补「后端踩坑铁律」段，把 cookie 优先案例写明 | grep `erp_token 优先` 可查 |

---

## 7. 检测缺口（Detection Gap）

> **为什么没更早发现？**

- [x] **没有监控告警**——401 频率异常无主动告警，靠用户反馈
- [x] **没有相关单测**——旧 `_extract_token` 从未被单测覆盖「cookie 与头冲突」场景
- [x] **没有相关 e2e**——前端真机未覆盖「演示账号残留 cookie 后切回真实」流程
- [ ] 没有用户主动反馈（用户当晚已主动反馈，是 AI 自己慢响应约 15 分钟）

**改进**：
- **加单测**（已做）：`.auth_resolve_test.py` 17 用例，今后改 `_extract_token` 必须跑过
- **加 E2E**（未做，留 R1）：在 `vps-deploy-e2e` skill 加「演示→真实切换验证」模板，确保 cookie 残留场景被覆盖
- **加监控**（未做，留 R1）：backend 加 `/api/auth/me` 401 频率异常告警（>5/min 触发邮件）

---

## 8. 行动项（Action Items）

> **5W2H：每条写 谁 + 做什么 + 何时 + 如何验证**

| # | 行动 | 负责人 | 截止 | 验证 |
|---|---|---|---|---|
| 1 | **Postmortem 归档**（本文件） | AI | 已完成 | 本文件存在 |
| 2 | **加单测覆盖 4 场景**（已做） | AI | 已完成 | `pytest .auth_resolve_test.py` 17/17 |
| 3 | **后端 CLAUDE.md 加铁律段**（已做） | AI | 已完成 | `hergent-erp/CLAUDE.md` §3 存在 |
| 4 | **MEMORY.md 补「后端踩坑铁律」段**（已做） | AI | 已完成 | grep 可查 |
| 5 | **前端 probeSession() 止血**（已做） | AI | 已完成 | e2e 验证 401 不再立即踢 |
| 6 | **E2E「演示→真实切换」模板**（R1，本季度） | AI | T+30 | playwright 脚本可运行 |
| 7 | **401 频率监控告警**（R1，本季度） | AI | T+30 | 监控面板有 `auth_fail_rate` 指标 |
| 8 | **生产事故日志回溯**（可选，R2） | AI | T+90 | grep erp.db sessions 表历史 401 |

---

## 9. 沉淀（SOP / CLAUDE.md / Skill）

### 9.1 是否进 SOP？
- [x] 是 → 应进 `PRODUCT-DEVELOPMENT-SOP.md` §二「开发中·AI 工作流约定·必问 7」补一条：「改动涉及认证/鉴权/多租户/凭证解析，任一动作必须先确认：`_resolve_auth` 的契约、11 共享接口已覆盖、`logout`/`change_password` 的副作用面」
- **状态**：本次先归档 Postmortem；SOP 主文档具体整合留待「月度 Postmortem 复盘」统一刷入（与本月月底的「回看本月 Postmortem，TOP 3 进 SOP」节奏对齐）

### 9.2 是否进项目级 CLAUDE.md？
- [x] 是 → `hergent-erp/CLAUDE.md` §3「认证与租户」段（已落）
- [x] 是 → `hergent-cn-v2/CLAUDE.md` §3「HTTP 通信」段（已落 probeSession）
- [x] 是 → `forecast-order-miniprogram-20260812T023419087Z/miniprogram/CLAUDE.md` §3（同源警告）

### 9.3 是否沉淀为 Skill？
- [ ] 否 —— 属「铁律」性质，已写入 MEMORY.md 与 3 个项目级 CLAUDE.md；不必再加一个 skill 反而增加维护成本
- 候选：可扩 `hergent-prod-deploy-e2e` 为「含登录/认证切换的回归模板」，但不必新建 skill

### 9.4 是否进 MEMORY.md？
- [x] 是 → `laozhangai-product/.workbuddy/memory/MEMORY.md`「后端已排雷（勿重复 flag）」段（已落）+「后端踩坑铁律」段（已落）

---

## 10. 教训（Lessons）

> 用「未来不再犯」的句式写。

1. **未来不再因「cookie 优先于头」误踢用户**：因为本次把 `_extract_token` 改为候选容错解析（头优先 + cookie 备选 + `request.state` 缓存），并把 `_resolve_auth` 契约写入 CLAUDE.md。
2. **未来不再因「老 ERP 时代遗留的 cookie 路径」隐性 short-circuit**：因为本次把「认证与租户」段写入 hergent-erp/CLAUDE.md，改认证前必看。
3. **未来不再因「前端 HTTP 层一刀切清 token」翻车**：因为本次前端 `client.js` 加 `probeSession()`，401 复核后再决策，把「先反射性踢」改成「先问后端是否真失效」。
4. **未来不再因「认证改动无单测覆盖」埋雷**：因为本次新增 `.auth_resolve_test.py` 17 用例，今后改认证逻辑必须跑。
5. **未来不再因「cookie 残留 / 多上下文切换」暗伤**：因为本次把「演示→真实切换」列为 e2e 必跑场景（R1 待补）。

---

## 📎 Postmortem 完成自查

- [x] 5W 一句话写清
- [x] 时间线完整（22:30 → 22:50 闭环）
- [x] 影响量化（1 + 隐藏 N + 0 数据丢失）
- [x] 根因 vs 直接原因区分（5.1 直接 / 5.2 根本 / 5.3 触发链）
- [x] 不是根因的常见误判也列了
- [x] 修复 + 防复发都有
- [x] 检测缺口提了（监控/单测/e2e 三缺）
- [x] 行动项有负责人 + 截止 + 验证（8 项）
- [x] 4 个沉淀去向答了（SOP/CLAUDE.md/Skill/MEMORY.md）
- [x] 教训 5 条写完

---

> **写 15 分钟 Postmortem，省未来 3 小时再排「boss 登录失败」时间**。
