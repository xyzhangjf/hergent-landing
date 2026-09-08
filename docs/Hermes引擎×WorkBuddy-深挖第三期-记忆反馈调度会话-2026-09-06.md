# Hermes 引擎 × WorkBuddy 深挖第三期 · 记忆/反馈/调度/会话 机制层

> 2026-09-06 · 第三期增量深挖。前两期已落地「澄清 / 经营日志 / 护栏 / 文件卡片 / 可视化 / 长期画像 / 自进化审计」。本期**换一个层面**：不再追「交互层的小部件」，而是挖 **WorkBuddy 的「记忆—反馈—调度—会话」四大底座机制**，对照 hergent 副驾主链路逐条核实，找出前两期没碰到的结构性缺口。

---

## 一、结论先行

前两期把「副驾看起来更像副驾」做完了；这一期挖到的是**「副驾能不能真正越用越懂你、会不会丢东西、会不会帮你记」**这三个更底层的问题。结论：

1. **记忆自进化的「最后一公里」没打通**——`corrections/patterns` 表都在，但只喂给了旧「大秘/会计」角色，**副驾主链路（Hermes SSE）完全不写它**，也没有任何 👍👎 纠错入口。AI 的"越用越懂你"目前是**单向的**。
2. **副驾会话只存在浏览器 localStorage**——30 条上限、清缓存/换手机即丢。这是**生产级缺陷**，不是体验问题。
3. **定时任务有一处死代码 bug**——`platform.py` 调用了**全仓不存在的** `db.scheduled_task_create/list/delete`，端点必 500；真正能用的只有 Hermes cron bridge，但模型是裸 cron 字符串。
4. **没有「AI 待办/提醒」**——Workbench 的「今日待办」是 AI 每天生成的只读快照，不是「老板说"周三提醒我补货"→ 到点真提醒」的持久待办。
5. **没有用量/成本归因**——B2B 分层定价的地基目前是空的。

---

## 二、实地核查：四条线现状（逐文件，非猜测）

| 机制 | WorkBuddy 的做法 | hergent 现状（核实结果） | 缺口 |
|---|---|---|---|
| **记忆修正** | 用户可对每条回复反馈，沉淀进长期记忆 | `memory.py` 三表（corrections/patterns/interaction_log）+ `save_correction()` 齐全，但**只被 `dami.py`/`accountant.py`（旧角色）调用**，副驾主链路（`CopilotDrawer.vue` → `hermesChat` → Hermes SSE）不写、也无反馈按钮 | 反馈闭环断开 |
| **会话历史** | `conversation_search` 服务端检索 + 云记忆 | 前端 `store/index.js`：`hergent_chat_sessions_v1` 存 **localStorage，切片保留 30 条**；后端**无任何 chat/session 表** | 换设备即丢、无检索 |
| **调度自动化** | `automation_update`：rrule 复发 + once 一次性 + validFrom/validUntil + 自然语言 | ① `cron_tasks.py` 对接 Hermes cron bridge（list/create/pause/resume/remove）可跑；② `platform.py:321` 调 `db.scheduled_task_create()` → **函数全仓不存在 = 死代码 500**；③ `save_scheduled_report` 仅裸 cron 字符串 | 模型薄弱 + 死代码 |
| **任务/提醒** | `TaskCreate/TaskList` + 一次性 reminder automation | `Workbench.vue` 「今日待办」= AI 每日生成的只读快照（审批/催收/临期），无持久化、不可勾选、非跨会话 | 无 AI 待办系统 |
| **用量计量** | 隐式成本归因（服务 B 端定价） | 全仓 grep `token/usage/cost/billing` **零命中**（除 MFA token） | 定价地基缺失 |

> ⚠️ 关键纠偏：第一期报告说「记忆弱」被第二期修正为「记忆自进化已存在」。本期进一步发现——**记忆自进化存在，但没接上副驾**。这比"没有"更隐蔽：表在、函数在，只是主链路没喂数据。

---

## 三、顺带发现的一个 bug（主动暴露）

**`routers/platform.py:321 / 327 / 332` 调用了全仓不存在的函数：**

```python
tid = db.scheduled_task_create(...)   # line 321
return db.scheduled_task_list(...)    # line 327
db.scheduled_task_delete(tid)         # line 332
```

全仓 `grep -rn "def scheduled_task_create"` **零命中**——`POST/GET/DELETE /api/platform/scheduled-tasks` 三个端点一调必抛 `AttributeError: module 'erp_db' has no attribute 'scheduled_task_create'`，**稳定 500**。这是历史遗留死代码（多半是某次重构只删了实现、没删路由）。已登记，P1 项里一并修。

---

## 四、本期 6 项增量（P0 → P2，附价值排名）

| # | 增量 | 优先级 | 借 WorkBuddy 什么 | 价值 |
|---|---|---|---|---|
| ① | 副驾反馈纠错闭环（👍👎 / "这个错了"） | **P0** | 每条回复可反馈 → 记忆修正 | ★★★★★ |
| ② | AI 待办 / 提醒系统（跨会话持久） | **P0** | TaskCreate/TaskList + 一次性 reminder | ★★★★★ |
| ③ | 服务端会话持久化 + 跨设备续聊 | **P1** | 服务端会话 + conversation_search | ★★★★ |
| ④ | 自然语言排程 + RRULE 复发性（顺带修死代码） | **P1** | automation_update 的 rrule/once/validUntil | ★★★★ |
| ⑤ | 跨会话检索（"上次说过 XX"） | **P2** | conversation_search | ★★★ |
| ⑥ | 用量/成本归因（B2B 定价地基） | **P2** | 成本归因 + 分层定价支撑 | ★★★ |

### ① 副驾反馈纠错闭环（P0）★★★★★

**现状**：`memory.py` 的 `save_correction(user_id, original_input, ai_result, correct_result, ...)` 已实现，`dami.py` 有 `handle_correction()`，但只有旧「大秘」角色在用；副驾主链路（Hermes SSE）既不写记忆、也没有反馈入口。老板觉得答案错了，只能再问一次，AI 学不到。

**怎么做**：
- 前端：副驾每条回复下方加两个极简按钮「对 / 错」，点"错"弹一句「哪里不对？（可选填）」。
- 后端：新增 `POST /api/ai/feedback` → 落 `interaction_log(success=0)` + 可选 `save_correction()`（key 按 `tenant_id:user_id`）。
- 记忆召回：`find_similar_corrections()` 已实现，接进下次同主题提问的 `sys` 注入（复用第二期 P0-② 的 `formatDailyLogForAI` 同款注入位）。

**价值**：这是「护城河 = AI 越用越懂你」从口号变现实的**最后一公里**，而且便宜——表、函数全现成，只差一条接线 + 两个按钮。

### ② AI 待办 / 提醒系统（P0）★★★★★

**现状**：`Workbench.vue` 的「今日待办」是 AI 每天生成的只读快照（审批/催收/临期），老板在对话里说"周三提醒我补货""月底记得对返利"，AI 只能口头应一声，**不会真提醒**。

**怎么做**：
- 协议层：生产 `~/.hermes/SOUL.md` 注入 ```reminder 围栏（复用 proposal/clarify 那套 fence 模式）：AI 识别到「要记得/要提醒」→ 输出结构化 `{title, remind_at, repeat}`。
- 后端：新增 `ai_reminders` 表 + `POST/GET/PATCH /api/ai/reminders`（完成/取消）。
- 触发：复用现有「每日简报 8:05」的推送通道（`scheduler.py`），到点扫描 `remind_at` 未完成项 → 推送。
- 前端：Workbench 「今日待办」旁加一个「AI 提醒」小组件，可勾选完成。

**价值**：这是经销商老板**每天的真实心智负担**——记补货、记对账、记政策日。AI 替他记 + 到点提醒，是副驾最直给的价值点，也是留存钩子。

### ③ 服务端会话持久化 + 跨设备续聊（P1）★★★★

**现状**：副驾会话全在 localStorage（`hergent_chat_sessions_v1`，切片 30 条），**换手机 / 清浏览器 = 上下文全丢**。对一个「AI 副驾」产品，这等于"副驾得了失忆症"。

**怎么做**：
- 后端：新增 `chat_sessions` 表（tenant_id, user_id, session_id, title, messages_json, updated_at）。
- 前端：`store/index.js` 的 `saveCurrentSession()` 改为「本地即时 + 服务端异步落库」双写；`loadSessions()` 改为「本地优先、联网时拉服务端覆盖」。
- 顺带解锁 ⑤（跨会话检索）。

**价值**：把 localStorage 的"临时缓存"升级为"资产"，是**多租户 SaaS 的及格线**——真实客户绝不容忍清个缓存就丢对话。

### ④ 自然语言排程 + RRULE 复发性（P1）★★★★

**现状**：`cron_tasks.py` 对接 Hermes cron bridge 可用，但只支持裸 cron 表达式；`platform.py` 的 scheduled-tasks 端点还是死代码（见 §三）。

**怎么做**：
- 修死代码：补 `scheduled_task_create/list/delete` 实现，或删掉这三个坏端点（倾向**删端点**，统一走 `cron_tasks.py`）。
- 排程模型升级：支持 `rrule`（每周一/三/五、每月 15 号）+ `once`（一次性提醒）+ `validUntil`（有效期），对齐 WorkBuddy 的 automation_update。
- 自然语言：老板说"每周一早上发周报"，AI 在对话里用 ```schedule 围栏输出 `{rrule, prompt}` → 落库 → cron bridge 执行。

**价值**：把"AI 副驾"从"被动应答"升级为"主动值班"，且是第 ② 项提醒系统的底层依赖。

### ⑤ 跨会话检索（P2）★★★

**现状**：无服务端会话，自然无从检索。

**怎么做**：依赖 ③ 落库后，加 `GET /api/ai/search-chat?q=...`，用 SQLite `LIKE`/关键词召回最近 N 条相关对话，注入 sys（"你上次跟老板说过 XX"）。第一阶段不做向量，够用。

**价值**：让副驾有"记性"，但需先有 ③，故排 P2。

### ⑥ 用量/成本归因（P2）★★★

**现状**：全仓无 token/usage/cost 计量。当前一人公司自用无所谓，但**要卖给别的经销商做 B2B SaaS，必须先能回答"每个客户成本多少、该收多少"**。

**怎么做**：在 `hermesChat` 网关侧（nginx → Hermes 或 server.py 中间层）记录每次调用的 token 用量 + 归属租户，落 `usage_log` 表，出 `GET /api/admin/usage` 报表。**注意**：副驾直连 Hermes SSE，用量抓取点要放在网关，不是 server.py。

**价值**：商业化地基，当前不急，故 P2 只做设计、不落地。

---

## 五、与上期不重复声明

本期 6 项与前两期 7 项**零重叠**：前两期做的是「交互层」（澄清、卡片、可视化、护栏、画像、自进化提案），本期做的是「记忆—反馈—调度—会话」四大底座。其中 ①③④ 是结构性修补（副驾记忆单向、会话本地化、调度死代码），属于**先补课再谈体验**的范畴。

---

## 六、建议节奏

- **P0（①②）**：改动小、价值最高，可立即做。
- **P1（③④）**：③ 是 ⑤ 的前置，④ 是 ② 的底层依赖，建议 ①② 上线后接着做。
- **P2（⑤⑥）**：⑤ 等 ③，⑥ 只出设计。

---

## 七、执行记录（2026-09-06 已全部落地生产）

> 用户「按顺序开始做」后，6 项增量**端到端上线**（后端 + 前端 + 协议 + 生产 E2E 验证）。

| # | 项 | 落地方式 | 验证 |
|---|---|---|---|
| ① | 反馈纠错闭环 | 后端 `POST /api/ai/feedback`（落 memory corrections）+ `GET feedback-memory`；前端副驾每条回复「对/错」按钮，错弹窗填纠正 | E2E：`learned=true`；feedback-memory 200 |
| ② | AI 待办提醒 | 后端 `ai_reminders` 表 + CRUD；`scheduler.py` 每分钟扫到点项推站内+渠道（daily/weekly/monthly 复发性）；前端 ```reminder 围栏→「记下提醒」卡片；生产 SOUL.md 注入协议 | E2E：建/列/完成全通；reminder 解析 8 用例过 |
| ③ | 服务端会话持久化 | 后端 `chat_sessions` 表 + GET(列表/单条)/POST/DELETE；前端 store 双写 + 跨设备拉取 + 打开空会话拉全文 | E2E：sessions=1 写/列/查全通 |
| ④ | 排程 + 修死代码 | 删 `platform.py` 三个坏端点（原 500）；`CronJobs.vue` 加「仅执行一次」(repeat=1) | 死端点 500→403 拦截；Hermes cron 原生支持 repeat |
| ⑤ | 跨会话检索 | 后端 `GET /api/ai/search-chat`（LIKE 召回+片段）；前端历史面板搜索框 | E2E：hits=1 + snippets 命中 |
| ⑥ | 用量归因 | 后端 `ai_usage` 表（主库跨租户）+ POST/GET；前端副驾成功回复后上报字符量 | E2E：by_tenant=[{tenant_id:10,calls:1,…}] |

**提交**：
- 后端 `cda7e70`（ai_assist + scheduler + platform 修死代码）+ `b97d3e8`（补 import）
- 前端 `b9a1fc8`（CopilotDrawer + store + useCardTrigger + CronJobs）

**部署**：后端 `deploy.sh` 健康 200；前端 `npm build` + rsync，生产 bundle grep 命中全部新端点（feedback/reminders/sessions/usage/search-chat/仅执行一次/已记下提醒）。

**已知留白**（非缺陷，属刻意取舍）：
- ⑥ 用量计量用**字符量**近似（Hermes SSE 直连不经过 server.py，token 精确值需网关侧抓取，留待商业化阶段做网关计量）。
- ④ 的完整 RRULE（每周一三五、每月 15 号）未做独立解析器，一次/永久 + daily/weekly/monthly 已覆盖经销商主流场景；更细复发留给 Hermes cron 的 schedule 表达式。
- ⑤ 检索用 SQLite LIKE（非向量），够用，量大再升级。

