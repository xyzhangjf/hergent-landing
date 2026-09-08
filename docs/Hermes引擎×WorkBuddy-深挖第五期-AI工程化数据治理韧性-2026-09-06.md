# Hermes 引擎 × WorkBuddy 深挖第五期 —— AI 工程化 · 数据治理 · 反脆弱（韧性）

> 2026-09-06 · 增量深挖（第五期）。前四期分别覆盖：① 四维 gap（功能/UI/前端/后端）；② 产品机制层（澄清/经营日志/护栏/文件卡片/可视化/长期画像/自进化审计）；③ 四大底座（记忆/反馈/调度/会话/检索/用量计量）；④ 交付·洞察·商业化（结果固化/配额/LLM 洞察/cron 回流/画像/onboarding）。
> 本期换第四层：**从「会做得爽」到「做得稳、调得回、出问题救得活」**——AI 工程化、数据治理、反脆弱韧性。与前四期零重叠。

---

## 一、先讲结论

1. **8 个生产租户的 SQLite，从来没自动备份过** —— 一人公司没出过事血本无归，没备份的人不在；租户库 + 主库都裸跑在阿里云盘上。一旦底层 IO 故障或手贱 rm，立刻 0 还原点。这条优先级最高但也最朴素：cron + sqlite3 backup API + 保留近 7/30 天 + 一键演练。

2. **副驾 LLM 调用黑盒** —— `chat_ai()` / `call_ai()` 调完失败只 stdout 日志，老板看到的只有「AI 没回答」。缺 trace_id 贯穿「前端 → API → LLM → 工具调用 → 回流」全链路，缺「AI 健康看板」（成功率/平均延迟/按租户分布/失败归因），调试要 grep 全仓日志。

3. **配方/规则改了就没了** —— loss/payroll/forecast 三处配方引擎只能手动改、覆盖无解药、调崩回不去。WorkBuddy 的"配置即代码 + 版本对比 + 一键回滚"机制，hergent 完全没有。

4. **关键操作无审计** —— `db.audit_log()` 已存在但仅用在 `auth.py`（登录/改密）和 `finance.py:accounts`（关账/科目），**销售开单/收款/调价/对账的写入路径全部零审计**。一单被改了凭什么能说得清。

5. **AI "不会装外行" 是体验差距** —— AI 不知道"自己不知道"。任何检索/分析任务，AI 答错了就答错了，老板以为是真。WorkBuddy 用 confidence 字段 + 引用溯源让 AI"知之为知之"，hergent 仅在 `import_router`/`ai_learning` 局部用了 confidence 字段，**主链路 LLM 回答无置信度**。

---

## 二、逐项核实对照表

| WorkBuddy 机制 / 行业基本功 | hergent 现状（核实到行） | 缺口定性 |
|---|---|---|
| **自动备份与一键恢复** | 仓库根 `deploy.sh` 无备份段；grep 全仓 `sqlite3.*backup` 0 处；`/opt/hergent-erp/backups/` 仅 Postmortem 副产物（增量深的产物名含 mkstemp 随机后缀） | **完全缺失，最高风险** |
| **LLM 调用 tracing** | `core.py:411` 仅异常日志带 trace_id；正常 LLM 调用 `ai_engine.call_ai/chat_ai` 无 trace_id 写入；前端 SSE 链路仅 `network monitor` 可见 | **完全缺失** |
| **配置即代码 / 配方回滚** | `loss_workflow.py` / `payroll_workflow.py` / `forecast_config.py` 三处配方端点仅入库，无 `get_full_recipe`/`import_recipe`/`export_recipe`；`recipe_evolution.py` 提案表只记最终改动 | **完全缺失** |
| **细粒度操作审计** | `erp_db.audit_log` 已存在；调用点仅 7 处（auth 5 + accounts 3）+ 第二期配方审计；销售/收款/对账/调价/库存调整 = 0 处 | **覆盖薄** |
| **多模型路由（按场景）** | `ai_engine.py:348/386` url/model 全局二选一（`AI_PROVIDER` env 单值）；无"长上下文选 qwen / 短任务选 deepseek / 失败超 3 次降级到本地模板"等场景化策略 | **粒度不够** |
| **AI 健康看板 / 可观测性** | 无。当前失败/超时/重试无集中视角 | **完全缺失** |
| **特性开关 / 灰度发布** | `server.py:4250` `feature_flags_list/set/check` 已存在；`voucher_engine.py:222` 已读 `db.feature_flag_list`；**rollout_pct 支持**——半成熟 | **已有骨架，需扩散 + 加 UI** |
| **AI 置信度 + 引用溯源** | `payroll_workflow.py:236` / `loss_workflow.py:256` / `today.py:151` / `import_router.py:213` 局部 `confidence` 字段；**主链路 LLM 回答不输出 confidence** | **部分缺失** |
| **AI 兜底升级（HITL）** | 0 处 | **完全缺失** |

---

## 三、本期 6 项增量

| # | 增量 | 优先级 | 价值 | 说明 |
|---|---|---|---|---|
| ① | **多租户库自动备份 + 一键恢复** | **P0** | ★★★★★ | cron 每夜 `sqlite3.connect.backup()` 主库+所有 tenant_N.db → `/opt/hergent-erp/backups/{YYYY-MM-DD}/`；保留近 7 份 + 周保留 4 份；新增 `GET /api/admin/backups` 列表 + `POST /api/admin/backups/restore` 一键演练（dry-run 优先） |
| ② | **LLM 调用全链路 tracing + AI 健康看板** | **P0** | ★★★★ | `chat_ai()`/`call_ai()` 加 `trace_id`（UUID12）+ `tenant_id` + `provider/model/prompt_tokens/finish_reason/latency_ms/error` → `llm_call_log` 主库表；前端 AI 中心新增"AI 健康看板"卡（成功率/平均延迟/失败原因分布/最近 50 条调用） |
| ③ | **配方/规则导出 + 导入（配置即代码）** | **P0** | ★★★★ | 新增 `recipe_export/import` 端点：导出 loss/payroll/forecast 三套配方为带 schema 版本号 JSON（含 `_meta/version/exported_at/tenant_id` + 业务字段）；导入做严格 schema 校验 + dry-run；AiHub + 各配方编辑页加「导出/导入」按钮 |
| ④ | **关键操作细粒度审计** | **P1** | ★★★★ | 销售 orders / 收款 receipts / 调价 price_history / 对账 reconcile / 库存调整 五大路径全覆盖调 `db.audit_log(action, module, target_id)`；AiHub 新增「审计日志」卡（按租户/模块/时间可查） |
| ⑤ | **多模型路由（按场景选模型）** | **P1** | ★★★ | `ai_engine.router(model_hint)` 装饰器：长上下文(>8K tokens) → `qwen-plus`；短快速(<1K) → `deepseek-v4-flash`；连续 3 次失败 → 降级本地模板；前端发送消息时允许 `model` 字段（用户可在副驾 header 临时选） |
| ⑥ | **AI 兜底升级（无把握 → 推通知）** | **P1** | ★★★ | `chat_ai` 解析回复里若有 `confidence<0.4` 或 LLM 抛超时，连续 ≥2 次 → 自动调 `db.notification_create(...)` 给老板推「副驾遇到 x，建议人工复核」；前端 AI 中心加「AI 兜底记录」卡 |

---

## 四、为什么是这六项（价值论证）

- **① 是「血本」**：一人公司最怕的不是「AI 不够聪明」，是「哪天盘坏了」。6 个月前放出去的货、收进来的款，全在 SQLite 里。一旦 IO 故障或 libsqlite 损坏，无备份=破产。`sqlite3.backup()` API 5 行代码就搞定，三天不写就是失职。

- **② 是「副驾可观测性」**：hergent 的护城河是 LLM，但 LLM 是黑盒。没有 trace_id，老板问「这周 AI 怎么老卡」、开发问「这个错误谁出的」、运营问「哪个租户用得多」——三问都答不上。WorkBuddy 的 telemetry 做法是「每一次 LLM 调用都落表 + 看板」，hergent 缺整层。

- **③ 是「副驾可演进」**：loss/payroll/forecast 三套配方是用户多年调出来的 know-how。一旦误覆盖或重写，无回滚点。WorkBuddy 的「配置即代码 + diff + 回滚」把配方当第一类资产，hergent 还把配方当 DB 行。导出 JSON 加 schema 版本 + dry-run 导入是标准做法。

- **④ 是「合规+复盘」**：一人公司不必做完整 SOX，但「谁改了这单价格」这种基础留痕必须有。已有 `audit_log` 工具复用，零成本扩 5 个写路径。

- **⑤ 是「成本/性能」**：当前全局单模型二选一，但 deepseek 便宜快、qwen 长上下文稳。按场景路由可省 20-30%、长文不截断。

- **⑥ 是「体验差异」**：AI "知之为知之"是 WorkBuddy 产品级别的差异化。当前 hergent 的 AI 从不主动说"我不确定"，老板误信风险大。兜底升级机制让老板安心：AI 拿不准会告知，告知不到就推通知——安全感是商业化的护城河之一。

---

## 五、刻意不做（与前几期一致的边界）

- ❌ 引 OpenTelemetry / Jaeger 之类的重型 tracing 方案——`trace_id + JSONL 日志 + SQLite 集中表` 足矣，OTel 是给 K8s 微服务用的。
- ❌ 云端备份（OSS / S3）——盘内 ec2 snapshot 是阿里云的事，不在 hergent 范围内；备份落到 `/opt/hergent-erp/backups/`（同盘不同目录）+ 文档交代用户「自己想办法拷出盘」。
- ❌ 模型无关抽象层（基类/继承/工厂）——给两个具体模型加个 `model_hint` 参数足够，不做"未来接入 cohere/mistral"的过度设计。
- ❌ 完整 HITL 工作流（工单系统/审批流）——仅做"AI 不自信 → 自动推一条通知"，不演化为工单系统；已有 ai_reminders 体系复用。
- ❌ 第三方审计合规（GDPR/等保）——一人公司分期再说；只满足"我们自己能复盘"足够。
- ❌ 不动 Hermes v0.19.0（继续 pin）。

---

## 六、建议节奏

- **P0（①②③）**：①②③ 是同源（都是"出事能救/出问题能查"），一起做完效果叠加。建议 ① 先动（最朴素最救命的），②③ 接着做。
- **P1（④⑤⑥）**：④ 最易（调 audit_log 即可），⑤⑥ 中度（涉及 LLM 调用链改造），按 ④ → ⑤ → ⑥ 顺序。
- **P2 候选**（本期外）：⑥ AI 健康看板的"按租户成本归因" / 多模型路由的"用户手动选模型" UI / 配方 diff 可视化对比 / 审计日志导出 CSV。
- **打包建议**：本期 6 项可在 5-7 个 commit 内端到端上线生产；前端入口复用第四期 `AiHub.vue`（AI 健康看板/审计日志/兜底记录三卡追加），后端加 1 个 `routers/ai_observability.py` + 1 个 `routers/admin_backup.py` + 1 个 `routers/recipe_io.py` 即可承载。

---

## 七、与前四期的衔接

| 期 | 主轴 | 留下的能力 | 本期补的 |
|---|---|---|---|
| ① 四维 gap | 已知功能差距 | 修复指标 + 工具可视化 + 流式 | — |
| ② 产品机制层 | 副驾交互体验 | 澄清/护栏/文件卡片/可视化/画像/自进化审计 | — |
| ③ 四大底座 | 持久化基础设施 | 记忆/反馈/调度/会话/检索/用量 | 用量已有，LLM 调用可观测性待补 |
| ④ 交付·洞察·商业化 | 产物固化 + 变现 | 报告/配额/洞察/cron/画像/onboarding | — |
| **⑤** | **AI 工程化 + 数据治理 + 反脆弱** | — | **备份/tracing/配方回滚/审计/路由/兜底** |

**本期本质**：把前四期做出来的"产品感"变成"耐用品"——能恢复、能回溯、能调参、能观测、能兜底。一人公司 solo 路一旦失去这些，一天崩盘全清零。

---

## 八、待用户确认

按惯例端到端落地请用户拍板：

1. 是否按"按顺序开始做"启动 6 项增量？
2. ①备份保留策略默认 **日保留 7 + 周保留 4**（约 11 份 × ~50MB ≈ 550MB 盘占用）——是否调整？
3. ⑤多模型路由默认开启（后台透明，按 token 数自动切）——是否要用户能在副驾手动覆盖（多一个 header 切换器）？
4. ⑥兜底通知默认推 **副驾抽屉 + 邮件 + 微信** 三通道——是否允许只勾选部分？

确认后端到端执行（不按本报告计划文档再延后）。
