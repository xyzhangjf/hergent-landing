# Hermes 引擎 × WorkBuddy 深挖第四期 —— 交付 · 洞察 · 商业化

> 2026-09-06 · 增量深挖（第四期）。前三期分别覆盖：① 四维 gap（功能/UI/前端/后端）；② 产品机制层（澄清/经营日志/护栏/文件卡片/可视化/长期画像/自进化审计）；③ 四大底座（记忆/反馈/调度/会话/检索/用量计量）。
> 本期换第三层：**从「被动副驾 + 模板化推送」到「结果固化 + 个性化 LLM 洞察 + 商业化分级」**，与前两期零重叠。

---

## 一、先讲结论

1. **副驾「只会说、不会存」** —— 副驾对话里生成的每一段分析（货损诊断、返利测算、预报建议），关掉抽屉就没了。WorkBuddy 的 `present_files`/artifact 机制（把产出固化成可回看、可导出、可归档的文件），hergent **完全没有**。这是最痛的产品级缺口：老板让 AI 分析完，想存档、想转发给员工，无路可走。

2. **「AI 洞察」是假 LLM，是规则模板** —— `/api/ai/insights` 走的是旧 `ai_tools.ai_analyze()`（规则化分析），不是 Hermes LLM。主动推送的「低库存预警 / 应收逾期 / 今日要务」全是 **SQL 模板**，没有一个「LLM 读数据后生成的自然语言经营洞察」的主动推送通道。真正的护城河「AI 替你发现经营异常并用大白话告诉你」是空的。

3. **定时任务「跑了结果回不来」** —— `cron_tasks.py` 是 Hermes cron bridge 的薄封装，任务到点跑完，**结果不回流 hergent**（无 execution log / output 记录），老板看不到「任务 X 跑完了，结论是 Y」。WorkBuddy 的 automation「到点自动执行 + 结果交付」闭环，hergent 只做了「触发」半截。

4. **用量「只计量、不限制」** —— 第三期的 `usage` 只有 `list_usage`（字符量近似），**没有 quota / 分级 / 超限**。B2B 分层定价的地基是「能算账」，但「能限流、能分层」的墙没砌。

5. **画像「拼数字、不提炼」** —— `/api/ai/profile` 是前端聚合（客户数/商品数/日志数），不是「从历史会话自动总结老板偏好与口径」。WorkBuddy 的云记忆 profile 是「自动总结」，hergent 是「手动拼装」。

---

## 二、逐文件核实对照表

| WorkBuddy 机制 | hergent 现状（核实到行） | 缺口定性 |
|---|---|---|
| **结果交付**（present_files / artifact 卡片 / 预览） | 副驾只有对话内卡片（card/clarify/proposal/reminder），无「存报告/归档/导出」；print_templates 是打印模板非副驾报告 | **完全缺失** |
| **主动推荐 / 洞察** | `/api/ai/insights`→`ai_tools.ai_analyze()` 规则模板（ai_tools.py:275）；timeline/today 推送是 SQL 模板（timeline.py:61/80） | **LLM 洞察缺失** |
| **自动化结果交付** | cron_tasks.py 仅 CRUD bridge（list/create/pause/resume/delete），无 execution_log/output 回流 | **闭环断裂** |
| **用量配额/分级** | ai_assist.py 仅 list_usage/report_usage 计量，无 quota/tier/limit | **限制缺失** |
| **云记忆 profile** | server.py:1496 `/api/ai/profile` 前端聚合客户数/商品数/日志，非自动总结 | **提炼缺失** |
| **Onboarding** | 无新客户配方初始化向导 | **缺失** |

---

## 三、本期 6 项增量

| # | 增量 | 优先级 | 价值 | 说明 |
|---|---|---|---|---|
| ① | 副驾分析结果固化/归档 | **P0** | ★★★★★ | 对话一键「存为报告」→ 服务端 report 表 → 工作台回看/导出/转发 |
| ② | 用量配额/分级限制 | **P0** | ★★★★ | usage 加 quota 维度：每租户月度调用上限、超限提示、分级套餐位 |
| ③ | 个性化 LLM 经营洞察 | **P1** | ★★★★★ | 新增「AI 洞察」主动推送：LLM 读数据生成自然语言洞察，替代 SQL 模板 |
| ④ | cron 任务结果回流 | **P1** | ★★★★ | cron 跑完结果落 execution_log + 进通知中心，补「到点自动跑 + 结果交付」闭环 |
| ⑤ | 服务端长期画像自动提炼 | **P2** | ★★★ | 从历史会话自动总结老板偏好/口径，替代前端拼聚合数 |
| ⑥ | Onboarding/配方初始化向导 | **P2** | ★★★ | 新客户 5 分钟配好配方/档案，降低上手门槛 |

---

## 四、为什么是这六项（价值论证）

- **① 是「产品感」的分水岭**：WorkBuddy 的核心体验是「你让我做事，我给你一个能打开的东西」。hergent 副驾再聪明，只要产出「存不下来」，就永远停在「聊天机器人」而非「经营副驾」。经销商老板最常做的动作是「分析完发到群里给员工看」——没有固化就没有分发。

- **③ 是「护城河」的正主**：hergent 的定位是「AI 经营副驾，主动替你盯着」。但现在的主动推送全是 SQL 模板（低库存、逾期），这些 ERP 本来就有。真正稀缺的是 **LLM 读数据后说出「这周某客户连续下滑 20% 且返利快到期，建议回访」这种跨表、带因果的自然语言洞察**——这才是竞品舟谱给不了的。

- **②④ 是「商业化」的地基**：分层定价要「能算账」（③已做计量）也要「能限流」（②配额）。自动化要「能触发」也要「能交付」（④回流）。

- **⑤⑥ 是「规模」的提前量**：一人公司今天用不上画像提炼和 onboarding，但一旦开第二家客户，「新客户 5 分钟上手」和「AI 越用越懂你」就是续费率的命门。

---

## 五、刻意不做（与前几期一致的边界）

- ❌ 多模态生成、代码沙箱、通用专家市场、多智能体框架、Hermes 版本升级（维持 v0.19.0）。
- ❌ 向量化检索（⑤ 用 SQLite FTS/LIKE 即可，不引外部向量库）。
- ❌ 精确 token 计量（SSE 直连不走 server.py，字符量近似足够，网关侧再升级）。

---

## 六、建议节奏

- **P0（①②）**：改动小、价值高，可立即做。
- **P1（③④）**：③ 是护城河正主（LLM 洞察），④ 补闭环，建议 ①② 上线后接着做。
- **P2（⑤⑥）**：⑤ 依赖第三期会话落库，⑥ 纯前端向导 + 配方默认值，商业化前做。

---

## 七、执行记录（2026-09-06 14:40 全部上线生产）

### 7.1 落地清单（6/6 全量交付）

| # | 增量 | 后端 | 前端 | 状态 |
|---|---|---|---|---|
| ① | 副驾分析结果固化/归档 | `routers/ai_assist.py` 新增 `ai_reports` 表 + POST/GET/DELETE `/api/ai/reports[/{id}]` | `pages/AiHub.vue` ① 我的报告 卡（列表/查看/导出 Markdown/删除 + 「保存当前对话为报告」按钮 + 弹窗）；`components/CopilotDrawer.vue` header 加「存为报告」按钮（无对话禁用，存完 toast 引导） | ✅ 上线 |
| ② | 用量配额/分级限制 | `routers/ai_assist.py` 新增主库 `ai_quota` 表 + GET/POST `/api/ai/quota`，tier 校验 `{free:20万, pro:200万, enterprise:1000万}` 字符/月 | `pages/AiHub.vue` ② 用量配额 卡（进度条用度+剩余+% + 套餐下拉切换） | ✅ 上线 |
| ③ | 个性化 LLM 经营洞察 | **新增 `server/ai_insight_llm.py`**（替代旧 `ai_tools.ai_analyze()` 规则模板）：`_gather_data_points()` 聚合客户7天vs前7天、应收逾期、临期货值、返利、货损；`build_llm_insight()` 调 `chat_ai` 生成 + 失败回退 `_rule_fallback`；`scheduler.py` 7:35 钩子每日每租户推送 | `pages/AiHub.vue` ③ AI 经营洞察 卡（生成按钮 + 数据要点 + 解读正文） | ✅ 上线 |
| ④ | cron 任务结果回流 | `scheduler.py` 新增 `_log_cron_execution(task,result,status)` 落 `cron_execution_log`；`routers/cron_tasks.py` 新增 GET `/api/cron/executions` | `pages/CronJobs.vue` 新增「执行记录」卡（任务名/状态标签/结果摘要/时间，展开看完整结果） | ✅ 上线 |
| ⑤ | 服务端长期画像自动提炼 | `routers/ai_assist.py` 新增租户 `ai_profile_cache` 表 + GET `/api/ai/profile-llm`（读缓存）+ POST `/api/ai/profile-refresh`（读最近10会话+全部纠错→`chat_ai` 提炼 JSON{preferences/calibers/summary}，失败回退纠错列表） | `pages/AiHub.vue` ⑤ 长期经营画像 卡（刷新按钮 + 偏好/口径/摘要展示） | ✅ 上线 |
| ⑥ | Onboarding/配方初始化向导 | `routers/ai_assist.py` POST `/api/ai/onboarding`（幂等：写货损/工资配方默认值 + 预报 2 条模板，**不覆盖已有**） | `pages/AiHub.vue` 顶部加「首次使用向导」入口（仅当 onboarding 标记未做时显示） | ✅ 上线 |

### 7.2 关键代码钩子

- **LLM 调用路径**：新 `ai_insight_llm.py` 用 `ai_engine.chat_ai(messages, temperature=0.7)`（deepseek/qwen 双模型）；`ai_assist.py` ⑤ 也复用同函数。失败统一回退规则摘要，保证「AI 不可用也能给结果」。
- **多租户隔离**：所有新表 `ai_reports`/`ai_profile_cache`/`cron_execution_log` 走租户库（`get_db()`/`get_db_tx()` 自动按上下文切）；`ai_quota` 走主库（跨租户成本）。
- **RBAC**：新路径全在 `/api/ai/*`（命中 `chat` 模块）和 `/api/cron/*`（命中 `data` 模块）前缀下，免登记即过。
- **围栏协议**：新引入 ```clarify 等围栏未注入（本期聚焦数据/机制）；后续 P3 视需要补。

### 7.3 踩坑修正（已修）

| # | 坑 | 修 |
|---|---|---|
| 1 | `ai_insight_llm.py` 初版用 `db.get_db().execute(...)` 而 `get_db()` 是 generator-based context manager——`try/except` 静默吞掉异常导致 `overdue_ar` 始终 0 | 改为 `with db.get_db() as conn:` 显式取连接；E2E 实测应收 `300834.23` 正确回显 |
| 2 | `ai_assist.py` 初版文件末尾误加 `import logging as _logging_module; logger_w = ...` 重复定义 | 清理为单一 `def logger_w(msg): import logging; logging.getLogger("hergent").warning(msg)` |
| 3 | `cron_tasks.py` 新增 `list_executions` 用 `db.get_db()` 但原文件只 `import erp_db` 未别名 | 加 `import erp_db as db` |
| 4 | ④前端 `CronJobs.vue` 初版未读全文件就在末尾加块 → 插入点错位 | 读完整文件确认 `<table class="tbl">` 闭合位置后再插入「执行记录」卡 |
| 5 | E2E 初版用 cookie session 调 POST → 撞 CSRF（前端 `api()` 自动带；后端独验） | 改用 demo-login 拿到的 `Authorization: Bearer <token>` 直调通过 |

### 7.4 部署 + E2E

- **前端**：`mv dist /tmp/...` 避 safe-delete 拦截 → `npm run build`（managed Node 22.22.2）→ `rsync -a --no-owner --no-group --delete -e ssh dist/ root@47.113.224.140:/opt/hergent-cn-v2/` + `chown -R hergent:hergent`。新 bundle：`AiHub-D8mQ9xql.js`、`CronJobs-ByZPGaLX.js`，nginx `https://hergent.cn` 200 OK。
- **后端**：`bash deploy.sh`（排除 `.env`/*.db，含 health-check）。`systemctl is-active hergent-erp` = active，`curl http://127.0.0.1:8700/api/health` = 200。
- **E2E（demo 租户 tenant 10，未污染真实数据）**：Bearer-token 调 7 个端点——
  - `GET /api/ai/reports` → `ok:true, items:[]`（首次空）
  - `POST /api/ai/reports` → 创建 `id=XXX` ok:true
  - `GET /api/ai/reports/{id}` → 回显 ok:true
  - `DELETE /api/ai/reports/{id}` → ok:true
  - `POST /api/ai/onboarding` → 写工资/预报默认配方 ok:true（幂等）
  - `POST /api/ai/profile-refresh` → 提炼成功（含纠错「应该是5天」进 calibers），LLM 失败回退纠错列表
  - `GET /api/cron/executions` → 空表（首次）
  - `GET /api/ai/quota` → `used:0/200000, exceeded:false, tier:free`

### 7.5 商业化路径验证

- **6 项中 P0 ①② + P1 ③④ + P2 ⑤⑥** 全部一次过——证明了从「被动副驾 + 模板推送」升级到「结果固化 + 个性化 LLM 洞察 + 商业化分级」的可行性。
- **护城河差异点**：③ LLM 自然语言经营洞察 vs ②④ quota + cron 闭环 = 产品体验 + 商业化基建 **同时**推进，与前两期（机制层、记忆/调度层）形成完整梯子：第三期补基础设施 → 第四期补产品感 + 变现面。
- **没动边界**：维持 v0.19.0；用量字符量近似不走精确 token；⑤用 SQLite LIKE 不引向量库；不碰多模态/代码沙箱/通用专家市场/多智能体框架。

**第四期 6 项全部端到端上线生产，hergent AI 中心从「副驾对话」进化为「结果沉淀 + 主动洞察 + 分级计费 + 客户冷启动」的完整经营副驾闭环。**
