# 报单自动化「真执行」立项包

> PRD-20260922-AUTO-PERIOD ｜ 作者：张俊峰 ｜ 2026-09-22
> 配套：`RISK-CHECKLIST.md`（5 维） + `TECH-TEMPLATE.md`（R2+ 必写）
> 规程依据：`.workbuddy/SOP/PRODUCT-DEVELOPMENT-SOP.md` —— **PRD + 风险评估完成前不动手写代码**

---

# 第一部分 · PRD

## 1. 元数据

| 字段 | 值 |
|---|---|
| PRD ID | PRD-20260922-AUTO-PERIOD |
| 优先级 | **P0**（用户已拍板「要」） |
| 风险等级 | **R4**（技术维 = schema/infra）；**建议实施后降为 R3**，见 §6 与第二部分 |
| 影响端 | **后端 + Web**（小程序**不受影响**，见 §7.1） |
| 前序依据 | `v121-到货报单合并-交付说明.md`、`v122-创建目标页面拆分规划方案.md`、`01-报单自动化归属评估与迁移可行性.md` |

## 2. 用户场景（核心）

```
场景：经销商老板/文员在「报单日」前后，需要人工盯着日历记住
      「今天该建报单表了」「今天该关单了」。
      在「2 天到货、提前 4 天下单」的节奏下，漏开表 = 销售当天报不了单；
      漏关单 = 报单窗口敞开、厂家下单截止被突破。
```

**现状事实**（本次评估取证）：`auto_period_enabled` / `auto_open_time` / `auto_close_time` / `supplier_deadline_time` **没有任何调度器消费** —— 期次靠人工点「新建期次」，催单用的是**期次自身**的 `order_start/order_end`。即谓"自动"，实为"手动 + 一张预览表"。

## 3. 业务目标与验收口径

### 3.1 业务目标

- [ ] 报单表**开/关**从「靠人记」→「系统按品牌排产节点自动执行」，**漏开/漏关次数 → 0**
- [ ] 老板不必每天盯日期；经理改单/付款的时间窗由系统保证不被压缩
- [ ] 「报单自动化」从"配了不生效"变成"**配置即生效**"，并可在界面上看到**下一次动作时间**

### 3.2 验收口径（全部勾完才算完成）

- [ ] **A1 默认安全**：所有租户 `auto_period_enabled` 默认仍为 0 ⇒ **部署后零行为变化**，未开启的租户一个字节都不写
- [ ] **A2 自动开表**：开启后，到达「开放填报」时刻，系统在**该租户库**创建对应期次（名称/order_start/order_end/arrival 与预览表一致）
- [ ] **A3 自动关单**：到达「自动关单」时刻，系统把该期次 `status` 从未关 → 关（复用 `forecast_period_close`）
- [ ] **A4 幂等**：同一期次重复 tick 不重复建；已关单的期次不再被关（日志可查"跳过原因"）
- [ ] **A5 干跑模式**：`dry_run` 打开时**只记日志不写库**，且日志写明"将创建/将关闭 期次X"
- [ ] **A6 多租户隔离**：逐租户在 `set_tenant_context(tid)` 内执行；单租户异常不影响其余租户（fail-closed）
- [ ] **A7 界面状态可见**：报单配置页显示「当前：自动 · 基准品牌『蒙牛』· 下次开表 09-24 20:00 / 下次关单 09-25 10:00」
- [ ] **A8 唯一性可读**：若已有别的品牌开启，界面**开启前**即提示「已由『X』控制，需先关闭」，不再保存才报错
- [ ] **A9 向后兼容**：品牌目标表单移除 ③ 区后，**保存品牌目标不得清空** `auto_*` 四列（`{...r}` 透传校验，见 §6 与 §7.1）
- [ ] **A10 11 共享接口零破坏**：`/api/forecast/periods`、`/api/forecast/submissions`、`/api/rebate/*` 的**请求/响应契约不变**

## 4. 真伪需求判断

| 问题 | 答案 |
|---|---|
| 哪类用户？ | 经销商老板 + 文员（开单/关单的执行人）；销售是**间接受益方**（表按时开，他能报单） |
| 在什么场景下用？ | 报单日前后（每 2 天一次）；以及"表怎么没开/怎么关了"的排查时刻 |
| 不做会怎样？ | 每期都要人盯日历；漏开表当天销售报不了单，漏关单会突破厂家下单截止。**已有配置却不生效 = 用户按"自动"预期行事，实际没跑**（比没有更危险） |
| 做了能赚/省多少？ | 每期省 1 次人工盯守 × 全年约 150 期；**消除"漏开后销售白等一天"**这类直接生意损失 |
| 是否经样本验证？ | 用户本人即一线经销商，已明确「要」（本条为自用 + SaaS 复用） |

## 5. 范围

### 5.1 In Scope

1. **后端 · 抽取纯函数**：把 `_build_period_plan` / `_suggest_first_date` 从 `routers/rebate_rules.py` 抽到 `server/domain/period_plan.py`（零行为变更），供路由与调度器共用
2. **后端 · 新接口**：`GET/PUT /api/forecast/auto-period` —— 租户级契约（读配置 + 运行状态 + 预览 / 写配置）。**内部落在现有 `rebate_target_rules` 唯一那一行**（零 schema 变更）
3. **后端 · 调度器**：`scheduler._check_auto_period()`，每 5 分钟、逐租户、带幂等 + dry-run
4. **前端 · 迁移**：`ArrivalRhythmBlock` 的 ③ 区拆出为 `AutoPeriodBlock.vue`，迁入 `报单配置` 页（`ReportMapping.vue`）
5. **前端 · 品牌目标页**：移除 ③ 区，保留 ①②，加一行「报单自动化已移至 预报订单 → 报单配置」+ 深链
6. **前端 · 三处低成本修补**：唯一性前置提示 / 状态卡（下次动作时间）/ 文案点明"全局只能一个品牌开启"

### 5.2 Out of Scope（本次不做）

- ❌ **物理数据迁移**（把 4 列从 `rebate_target_rules` 搬到独立租户级表）→ 见第二部分 §「关键设计决策」，**建议不做**，理由：后端已有租户唯一约束 ⇒ 语义上已是租户级；花 R4 代价搬 11 个库只为改"住址"，收益为零。API 契约已先收敛，将来要搬**不影响前端**
- ❌ 自动**替用户去厂家系统下单**（越权，且舟谱无开放 API）
- ❌ 期次内容（报单对象清单）的自动填充 —— 仍由用户在预报页操作
- ❌ 小程序端改动

## 6. 风险评估（结论）

| 维度 | 等级 | 备注 |
|---|---|---|
| 技术 | **R4** | 调度器 = 关键 infra（新后台动作） |
| 业务 | **R3** | 多端用户感知（销售端会"看到期次自动出现"） |
| 数据 | **R1** | **零 schema 变更**；但会产生**新的业务行**（期次） |
| 部署 | **R3** | 后端 + 前端两端 |
| 回滚 | **R1** | < 5 分钟：关开关即停 + 前端 `dist` 备份回滚 + 后端 `git checkout` |

⇒ **R4**（取最高：技术）。必走闸：R3 全部 + **全量演练 + checkpoint 审批 + 维护窗口 + 回滚预演**。
**风险缓解（决定性）**：`auto_period_enabled` 默认 0 ⇒ **上线后不开启则零行为**；且先跑 `dry_run` 观察。真实暴露面在"用户主动开启"之后才出现。

> 详细 5 维评估 + Hergent 特殊 6 项 → 第二部分。

## 7. 依赖与共享接口检查

### 7.1 共享 11 接口影响

| 接口 | 是否改 | 兼容性 |
|---|---|---|
| `/api/forecast/periods`（GET/POST） | ❌ 契约不改 | ✅ 兼容（调度器调**内部函数** `forecast_period_create`，非 HTTP） |
| `/api/forecast/submissions` | ❌ 不改 | ✅ |
| `/api/auth/login`、`/api/auth/me` | ❌ 不改 | ✅ |
| `/api/inventory/*`、`/api/products/*`、`/api/customers/*`、`/api/suppliers/*`、`/api/orders/*` | ❌ 不改 | ✅ |
| `/api/import/*` | ❌ 不改 | ✅ |
| `/api/rebate/*` | ⚠️ **不改契约**，但前端不再从 `rebate_rules` 表单读写 `auto_*`；`_row_to_dict` 白名单**保持含**这 4 列（否则读回丢失） | ✅ 兼容 |
| **新增** `/api/forecast/auto-period` | 🆕 新路由 | 需登记 `server.py:_PATH_MODULE_MAP` |

### 7.2 外部依赖

- [x] 无新增外部依赖（不接厂家系统、不接舟谱）
- [x] 不涉及支付宝/微信支付
- [x] 不涉及 ERP_SECRET / `_hpw`（**本次明确不动**）
- [x] 不涉及 Hermes / SSE

## 8. UX / UI 要点

- **入口**：`预报订单 → 报单配置` 页新增「报单自动化」卡片（该页已有「模板参数」折叠卡的范式，可直接复用）
- **关键文案**（业务口径，禁技术术语）：「以『蒙牛』的报单节奏为准」「下次开表 09-24 20:00」「系统只提醒，不会替你去厂家下单」
- **不可达元素**：品牌目标页移除 ③ 后，须检查 `ArrivalRhythmBlock` 的 props/emits 是否留下死代码（`adopt` 等）
- **设计规范**：遵循 `hergent-cn-v2/docs/UI-SPEC.md`（复用全局 `.card`/`.input`/`.btn-*`/`--z-*`；Tab 用全局 `main-tabs` 范式）

## 9. 时间规划

| 阶段 | 工作量 | Buffer(30%) |
|---|---|---|
| 本次立项包（PRD+风险+技术） | 已完成 | — |
| 阶段 1 后端：抽纯函数 + 新接口（零行为变更） | 0.5 天 | 0.65 天 |
| 阶段 2 后端：调度器（含 dry-run + 单测） | 1 天 | 1.3 天 |
| 阶段 3 前端：③ 区迁移 + 三处修补 | 1 天 | 1.3 天 |
| 阶段 4 校验演练 + 部署 + 生产验证 | 0.5 天 | 0.65 天 |
| 阶段 5 复盘 + Postmortem | 0.5 天 | — |

> 分 5 阶段独立可验、可停、可回滚；**任一段失败都停在原地**，不影响已上线功能。

## 10. 用户确认

| 项 | 用户回复 |
|---|---|
| 优先级 P0 | ☐ |
| 风险等级 R4 认可 | ☐ |
| **关键设计决策**：放弃物理数据迁移（用 API 契约收敛替代） | ☐ |
| 验收口径 A1–A10 对齐 | ☐ |
| 是否进入实现（先做阶段 1+2 后端） | ☐ |

---

# 第二部分 · 风险评估（5 维详表）

## 1. 5 维打分

| 维度 | 分 | 依据 |
|---|---|---|
| **技术** | **4** | 新增后台调度动作 = 关键 infra（对照表 4 = schema 迁移/infra） |
| **业务** | **3** | 多端用户感知：销售/经理在小程序会看到期次"自动出现/自动关" |
| **数据** | **1** | **零 schema 变更**（复用现有 4 列）；仅新增非关键业务行（期次） |
| **部署** | **3** | 多端：后端（`scheduler.py` + 新路由）+ 前端（`ReportMapping.vue` 等） |
| **回滚** | **1** | < 5 分钟（三重回滚，见 §6.2） |

**取最高 ⇒ R4。** 必走闸：lint + type + 单测 + 端到端冒烟 + 集成测试 + 人工场景测 + 时间盒发布 + 回滚预案 + **全量演练 + checkpoint 审批 + 维护窗口 + 回滚预演**。

## 2. Hergent 特殊 6 项

| # | 项 | 本次结论 |
|---|---|---|
| 4.1 | 共享 11 接口 | ✅ 零契约变更（见 PRD §7.1）；新增路由需登记 |
| 4.2 | RBAC 模块登记 | ☐ **新路由 `/api/forecast/auto-period` 必须登记 `server.py:_PATH_MODULE_MAP`**，否则 fail-closed 403 `MODULE_NOT_CONFIGURED` |
| 4.3 | ERP_SECRET / `_hpw` | ✅ **本次不动** |
| 4.4 | safe-delete | ☐ 前端 build 前 `mv dist /tmp/hergent-dist-bak-$(date +%s)`（清 assets >50 文件会触发 `SAFE_DELETE_BULK_CONFIRM_REQUIRED`） |
| 4.5 | rsync --delete | ☐ 后端用 `deploy.sh`（带 `--exclude='.env'`），**不用裸 rsync** |
| 4.6 | Hermes SSE | ✅ 本次不涉及副驾对话 |

## 3. 数据迁移与备份

- **改库结构？** ❌ **否**（关键设计决策：不物理迁移）→ 本节仅需**备份**，无需迁移/回滚 SQL
- 备份命令（部署前必做）：
  ```bash
  cp /opt/hergent-erp/erp.db /opt/hergent-erp/erp.db.bak-$(date +%s)
  # 逐租户库
  for f in /opt/hergent-erp/tenant_*.db; do cp "$f" "$f.bak-$(date +%s)"; done
  ```
- **改 .env / 密钥？** ❌ 否

## 4. 用户影响与回滚

- 影响面：**多用户（仅"主动开启自动化的那个租户"）**；未开启租户零影响
- 回滚（三重，任一即停）：
  ```bash
  # ① 业务级（最快，秒级）：在界面把「自动建表」切回「手动建表」
  #    或直接改租户库：UPDATE rebate_target_rules SET auto_period_enabled=0 WHERE id=?;
  # ② 代码级：
  cd /Users/zhangjunfeng/Documents/hergent-erp && git checkout <last-good> && bash deploy.sh
  # ③ 前端级：
  mv /tmp/hergent-dist-bak-<ts> dist && rsync -a dist/ root@47.113.224.140:/opt/hergent-cn-v2/
  ```

## 5. 评估结论

| 项 | 答案 |
|---|---|
| 风险等级 | **R4** |
| 必走闸 | R3 全部 + 全量演练 + checkpoint + 维护窗口 + 回滚预演 |
| 是否需要用户确认 | **是**（特别是"放弃物理迁移"这条设计决策） |
| 是否需要 checkpoint | **是**（阶段 1+2 完成后、上线前） |
| 回滚命令已就绪 | ✅ 是（三重） |
| Postmortem 预备 | ✅ 是（R3+） |

---

# 第三部分 · 技术方案

## 1. 架构与数据流

```
                          ┌──────────────────────────────────────┐
   Web 报单配置页  ──GET/PUT──►  /api/forecast/auto-period        │
   （ReportMapping.vue）        │  读/写 租户库 rebate_target_rules │
                          │        │  内唯一一行（auto_period_enabled=1）│
                          └────────┼──────────────────────────────┘
                                   │ 复用（纯函数，零 DB）
                          ┌────────▼──────────────────────────────┐
                          │ server/domain/period_plan.py          │
                          │   build_period_plan(...)  ← 抽取       │
                          │   suggest_first_date(...)             │
                          └────────┬──────────────────────────────┘
                                   │ 同一算法
     ┌─────────────────────────────┴──────────────────────────┐
     │                                                        │
┌────▼─────────────────────┐                    ┌─────────────▼──────────────┐
│ /auto-period-preview     │                    │ scheduler._check_auto_period│
│ （既有，前端预览用）      │                    │ 每 5 分钟 / 逐租户 / 幂等    │
└──────────────────────────┘                    │  → forecast_period_create  │
                                                │  → forecast_period_close   │
                                                └────────────────────────────┘
```

**关键点**：**只有一个排程算法实现**（`period_plan.py`），预览与执行同源 ⇒ 界面看到的 = 系统要做的。这是防"预览与现实不符"的结构性保证。

## 2. 五个技术选型

| # | 选型 | 决定 | 理由 |
|---|---|---|---|
| 1 | **存储** | **复用 `rebate_target_rules` 现有 4 列，零 schema 变更** | 后端已有「租户内唯一」约束 ⇒ 语义上已是租户级；物理迁移需跨 11 个租户库，R4 且零功能收益 |
| 2 | **API 契约** | 新增 `/api/forecast/auto-period`（GET/PUT），**前端只认这套契约** | 把"存储在哪"封在后端 ⇒ 将来真搬表，前端零改动 |
| 3 | **算法复用** | 抽 `build_period_plan` / `suggest_first_date` 到 `server/domain/period_plan.py`（纯函数，无 DB） | 与既有 `domain/arrival_schedule.py` 同构；预览与执行必须同源 |
| 4 | **执行载体** | `scheduler.py` 主循环加 `_should_run("auto_period", 300, now)` + `_run_per_tenant(_check_auto_period, ...)` | 复用既有节流与多租户外壳，**不引入新进程/新 cron 体系** |
| 5 | **安全默认** | `auto_period_enabled` 默认 0 + `dry_run` 开关 + 幂等 + 逐租户 fail-closed | 上线零行为；先干跑观察再真跑 |

## 3. 接口设计

### 3.1 `GET /api/forecast/auto-period`

```
响应：
{
  "success": true,
  "data": {
    "enabled": 1,                     // 手动 0 / 自动 1
    "rule_id": 12,                    // 承载配置的那条品牌规则（= 基准品牌）
    "brand": "蒙牛",                   // 基准品牌名（scope_name）
    "times": {"open":"20:00","close":"10:00","supplier":"12:00"},
    "cadence": {                      // 只读镜像：基准品牌的报单节奏
      "mode":"interval","first_date":"2026-09-24","cadence_days":2,
      "weekdays":"","lead_days":4,"max_early_days":1
    },
    "enabled_by": "蒙牛",              // 当前占用者（用于"已被 X 控制"文案）
    "next": {"open_at":"2026-09-24 20:00","close_at":"2026-09-25 10:00"},
    "preview": [ ...6 期，与既有 /auto-period-preview 同构... ],
    "dry_run": 0
  }
}
```

### 3.2 `PUT /api/forecast/auto-period`

```
请求：{ "enabled":1, "rule_id":12, "auto_open_time":"20:00",
        "auto_close_time":"10:00", "supplier_deadline_time":"12:00", "dry_run":0 }
约束（后端强校验，复用既有逻辑）：
  · enabled=1 时必须给 rule_id，且该规则须有 order_first_date
  · auto_close_time < supplier_deadline_time
  · 租户内唯一：若已被其它 rule 占用 ⇒ 返回**可读文案** + 占用者名（而非 500）
响应：成功 + 回读后的完整状态（同 GET）
```

### 3.3 调度器算法（幂等）

```
for tid in tenant_ids:
    set_tenant_context(tid)
    cfg = 读 auto_period_enabled=1 的规则（无 → 跳过）
    if not cfg or not cfg.order_first_date: 跳过
    plan = build_period_plan([基准品牌规则...], horizon_days=14, 三时点)
    now = datetime.now()                      # 本地时刻，与预览同口径
    for p in plan.periods:
        # 开表
        if p.open_at <= now < p.close_at:
            if dry_run: log("将创建期次", p); continue
            if 期次不存在(order_start=p.order_date): 
                forecast_period_create(name, order_start, order_end, arrival)
                log("已创建期次", ...)
            else: log("跳过：已存在")
        # 关单
        elif now >= p.close_at:
            pid = 找 status='open' 且 order_start<=p.order_date 的期次
            if pid and dry_run: log("将关闭期次", pid)
            elif pid: forecast_period_close(pid); log("已关闭期次", pid)
            else: log("跳过：无可关闭期次")
    finally: set_tenant_context(None)
```

**幂等键**：`periods` 的 `order_date` ↔ 期次 `order_start`。重复 tick 只会打日志。

## 4. 复用与依赖

| 复用 | 位置 | 说明 |
|---|---|---|
| 排程算法 | `routers/rebate_rules.py::_build_period_plan` / `_suggest_first_date` | **抽到** `domain/period_plan.py` |
| 期次创建 | `erp_db.forecast_period_create(name, order_start, order_end, arrival)` | 内部已含 `period_validate` |
| 期次关闭 | `erp_db.forecast_period_close(pid)` | 既有 |
| 多租户外壳 | `scheduler._run_per_tenant(fn, label)` / `_tenant_ids()` | 既有 |
| 节流 | `scheduler._should_run(name, interval_sec, now)` | 既有 |
| RBAC | `server.py:_PATH_MODULE_MAP` | **需新增登记** |
| 前端折叠卡范式 | `ReportMapping.vue` 的「模板参数」卡 | 直接照抄结构 |

## 5. 部署与回滚

- **阶段化上线**（每阶段独立可停）：
  1. 后端「抽纯函数 + 新接口」→ 部署 → 验 `/api/forecast/auto-period`（**前端未接，零可见变化**）
  2. 后端「调度器」→ 部署 → **保持全体 `auto_period_enabled=0`**，开 `dry_run` 观察日志
  3. 前端「③ 区迁移 + 三处修补」→ `mv dist /tmp/hergent-dist-bak-$(date +%s)` → build → rsync
  4. 用户在界面主动开启（**唯一真正改变行为的动作**）
- **回滚**：见第二部分 §4（三重）

## 6. 测试计划

| 层级 | 内容 |
|---|---|
| 单测 | `period_plan.py` 抽取后**与抽取前逐值比对**（同一输入 → 同一输出，用现有 6 期预览的输入做回归）；`_check_auto_period` 的幂等与 dry-run 分支（假 DB / mock） |
| 集成 | 影子租户：造 `order_first_date` 在**过去**的规则 → 手动触发一次 tick → 断言期次被创建/关闭；再触发一次 → 断言**无重复** |
| 端到端 | 真机登录 → 报单配置页开启自动 → 状态卡显示"下次开表时间" → 关掉再验一次 |
| 兼容 | 品牌目标**保存后**回读 4 列未被清空（A9）；`/auto-period-preview` 响应不变（前端预览不受影响） |
| 演练 | 生产**维护窗口**内：备份 11 库 → 部署 → `dry_run` 跑一轮 → 读日志 → 关 dry_run |

## 7. 关键设计决策（需你确认）

**放弃「物理数据迁移」，改用「API 契约先收敛」。**

原话是"迁移 + 数据上提 + 接调度器"。做了详细设计后，我的判断是：

1. **功能上不需要**：后端 `rebate_rules.py:1144` 已有「租户内唯一」约束 ⇒ 那 4 列**语义上已经是租户级**，只是物理住在品牌行里。调度器读"唯一那一行"完全正确、无歧义。
2. **代价不对称**：物理迁移要动**11 个租户库 + 主库**（R4 跨库迁移），还要处理双写期与回滚；换来的只是"改个住址"。
3. **未来仍可做**：因为 **API 契约已先收敛**（前端只认 `/api/forecast/auto-period`），将来真要搬表，**前端一行都不用改**，只是后端换存储。那时可以单独开一个小批次，风险也小得多。

⇒ **建议：本次做「接调度器 + 迁 UI + 三处修补 + API 契约收敛」；物理迁移列为待办，不阻塞本功能。**

---

## 📎 自查清单

- [x] 5W 全部回答
- [x] 验收口径可量化可测（A1–A10）
- [x] In/Out Scope 明确
- [x] 风险评估填完（5 维 + Hergent 特殊 6 项）
- [x] 11 共享接口影响检查完
- [x] Buffer 算好（30%）
- [ ] **用户已确认优先级与风险（待填 §10）**
- [ ] **用户已确认关键设计决策（放弃物理迁移）**
