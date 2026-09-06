# 产品开发 SOP（一人公司 AI 杠杆版）

> **适用范围**：Hergent 全产品线（hergent.cn / erp.hergent.cn / 蒙牛低温奶经销商经营副驾 / 微信小程序 / 后续新产品）。
> **版本**：v1.0（2026-09-06 立版）
> **核心理念**：**模板 + 触发式提醒，不强制流程**。
> 一人公司被流程反噬是最大风险。本 SOP 提供「问对问题」的脚手架，**AI 在接到新需求时主动引用**。

---

## 📜 5 条总原则（一人公司版）

1. **domain expertise 是核心资产，代码是商品**——流程不挡业务判断
2. **轻量模板 + AI 友好 + 触发式提醒**——不引入新负担
3. **每次改动都过 4 道闸**：风险评估 → 技术方案 → 部署回滚 → 复盘
4. **真实数据 = 反馈源**——所有「假设」必须用真机运行时验证
5. **踩坑立刻沉淀**——不进 SOP 的坑会反复踩

---

## 🟦 阶段一：开发前（需求评估）

### 何时进入
- 新产品立项
- 现有产品新增 P0 功能（影响多模块 / 多端）
- 跨产品线功能（同时影响 Web + 小程序 + 后端）

### 必须产出（最小集）
- **PRD 文档**（业务口径 + 验收口径）
  - 模板：`templates/PRD-TEMPLATE.md`
- **风险评估**（5 维：技术 / 业务 / 数据 / 部署 / 回滚）
  - 模板：`templates/RISK-CHECKLIST.md`
- **真伪需求判断**（与用户对话 1-3 轮后明确）
  - 哪类用户在什么场景下要解决什么问题？
  - 不做会怎样？做了能赚/省多少？

### AI 行为约定（接到新需求时主动问）
1. 「这个需求的影响范围是？」——单页 vs 多端
2. 「真伪需求已和用户对齐了吗？」——是否经样本验证
3. 「风险等级 R0-R4？」——见 `templates/RISK-CHECKLIST.md`
4. 「依赖现有 11 个共享接口的有几个？」——避免破坏性

### 一句话原则
> **PRD 不写完不写代码**。即使是 P0 也至少 1 页纸：用户场景 → 验收口径 → 风险等级 → 回滚策略。

---

## 🟧 阶段二：开发中（执行与质量）

### 何时进入
PRD 已写完 + 风险评估已做 + 用户已拍板（关键词：要 / 做 / N）。

### 必做项
1. **技术方案**（架构 + 接口 + 数据 + 依赖 + 回滚）
   - 模板：`templates/TECH-TEMPLATE.md`
2. **Git 分支**（按本仓库约定，非 Trunk-based）
   - 默认在 `main` 上改（小改动 + 自验）
   - 大改动开 feature 分支：`feature/<name>`，合 main
3. **代码规范**（项目级 CLAUDE.md 写过的规则优先）
4. **单测 / E2E**
   - 关键工具函数：单测（参考 `server/.auth_resolve_test.py`）
   - UI 改动：Playwright e2e 真机验证（**禁用 node --check 假阳性**）
5. **构建 + 部署**
   - 前端：`mv dist /tmp/bak-$(date +%s)` → `npm run build && rsync ...`
   - 后端：`bash deploy.sh`（rsync flatten + 排除 .env/.db）
6. **生产验证**（curl + 真机登录 + 业务接口）

### AI 行为约定（执行时主动做）
1. 改前先 grep 现有约束（项目级 CLAUDE.md + .workbuddy/memory/MEMORY.md）
2. 改后先在本地跑单测，再部署
3. 部署前必须先有备份命令（mv / cp / tar）
5. 部署完必须 curl 健康 + 关键业务接口
6. **绝不在没有备份的情况下覆盖生产**

### 一句话原则
> **改完必须真机验证**——`node --check` / `py_compile` / `vite build` 成功 ≠ 功能对。

---

## 🟩 阶段三：开发后（复盘与沉淀）

### 何时进入
- 上线后任意时刻发现事故 / 关键踩坑 / 用户反馈
- 定期（每周末或每月底）回顾一周/月踩坑

### 必做项
1. **Postmortem 文档**（事故复盘）
   - 模板：`templates/POSTMORTEM-TEMPLATE.md`
2. **沉淀到 3 层 memory**：
   - 项目级踩坑 → `.workbuddy/memory/YYYY-MM-DD.md`（每日）
   - 长期项目记忆 → `.workbuddy/memory/MEMORY.md`（按主题）
   - 跨项目习惯 → `~/.workbuddy/MEMORY.md`
3. **判断是否沉淀为 Skill**：
   - 「如果另一人也需要做这件事」→ 沉淀为 Skill
   - 否则只入 memory
4. **判断是否进 CLAUDE.md / SOP**：
   - 反复踩的坑 → 进对应仓库 CLAUDE.md 的「铁律」段
   - 通用流程改进 → 进本 SOP

### AI 行为约定（复盘时主动做）
1. 接到事故反馈，先确认 5W：什么 / 何时 / 何地 / 谁影响 / 怎么发现
2. 找根因：连续 3 次失败自动暂停，重读代码而非继续改
3. 修完写 Postmortem（5W + 根因 + 修复 + 防复发）
4. **「完成」必须有验证证据**——`应该没问题` / `看似` / `感觉` = 红旗词

### 一句话原则
> **踩坑不沉淀 = 必然再踩**。Postmortem 写 5 分钟，省未来 3 小时。

---

## 🚦 风险等级（R0-R4）

| 等级 | 典型变更 | 必走闸 |
|---|---|---|
| **R0** | 纯文案 / 注释 / README | diff review |
| **R1** | UI 调整无后端影响 | lint + 视觉冒烟 |
| **R2** | 业务逻辑局部模块 | lint + type + 单测 |
| **R3** | 鉴权 / 支付 / 利润 / 数据导出 | R2 + 集成 + 人工场景测 |
| **R4** | schema 迁移 / 关键 infra / 安全 | 全量演练 + checkpoint + 回滚预演 |

> 详见 `templates/RISK-CHECKLIST.md`。

---

## 🤖 AI 工作流约定（一人公司版）

### 接到新任务前 5 个必问

1. **这是 P0 / P1 / P2？** —— 用户已给出优先级就别自作主张
2. **影响哪些端？** —— Web / 小程序 / 后端 / 桌面
3. **是否触及共享 11 接口？** —— 必须避免破坏性
4. **风险等级 R0-R4？** —— 决定走哪些闸
5. **回滚策略？** —— 必须先答这个再写代码

### 执行中 3 个必做

1. **改前 grep** 项目级 CLAUDE.md + MEMORY.md 找铁律
2. **改后验证** 端到端真机运行（非 build 成功即视为完成）
3. **提交前** 五段交付摘要（交付 / 变更 / 构建 / 对齐效果 / 需确认事项）

### 完成时 2 个必出

1. **commit message** 含根因 + 影响 + 验证
2. **memory 追加** 到 `.workbuddy/memory/YYYY-MM-DD.md`

### 拒绝的 5 种说辞

| 话说 | 必须替换为 |
|---|---|
| 应该没问题 | 实际运行命令并贴输出 |
| 看似修好了 | 跑相关测试用例贴结果 |
| 大概是这样 | 贴代码片段或截图 |
| 等下再处理 | 立即处理或写进 Postmortem |
| 应该兼容 | 实际跑旧路径 + 跑新路径做 diff |

---

## 📂 模板库（按需复制）

| 模板 | 路径 | 触发场景 |
|---|---|---|
| PRD | `templates/PRD-TEMPLATE.md` | 新功能立项 |
| 技术方案 | `templates/TECH-TEMPLATE.md` | 大改动 / 多端 / 跨接口 |
| 风险评估 | `templates/RISK-CHECKLIST.md` | 任何改动前 |
| Postmortem | `templates/POSTMORTEM-TEMPLATE.md` | 事故 / 关键踩坑后 |

---

## 🔗 与现有体系的协作

- **AI Skill 入口**：`~/.workbuddy/skills/product-dev-sop/SKILL.md`（让 AI 接到新需求主动引用本 SOP）
- **专项 Skill**（已有，按场景触发）：
  - `hergent-prod-deploy-e2e`（部署生产端到端）
  - `hergent-frontend-add-module`（新增前端模块）
  - `hergent-emoji-to-icon-sweep`（图标统一）
  - `hergent-frontend-fetch-consolidation`（统一 HTTP）
  - `hergent-vite-landing`（Vite 落地）
- **项目级 CLAUDE.md**（每个仓库根目录，已写）
- **MEMORY.md**（`laozhangai-product/.workbuddy/memory/MEMORY.md`）

---

## 🔄 SOP 本身怎么迭代

1. 每月最后一周回看本月 Postmortem，统计 TOP 3 踩坑
2. 把 TOP 3 进 SOP / CLAUDE.md / Skill（**先沉淀最高频的**）
3. 一次只改一段，避免 SOP 臃肿失焦
4. SOP 改动本身走 Postmortem 模板（事故沉淀也要留底）

---

## ❌ 不做的事（明确边界）

1. ❌ 不做重型 SOP（评审会 / 角色矩阵 / Jira 流程）——一人公司扛不住
2. ❌ 不强制 Git Flow（除非找到技术合伙人）——直接 main 上改足够
3. ❌ 不强制 CI/CD 全自动化——半手工 `deploy.sh` 已足够
4. ❌ 不强制测试覆盖率门槛——单测只覆盖关键工具函数
5. ❌ 不引入新工具（ONES / TAPD / Jira）——`memory` + `daily log` 足够

> **一旦扩到 3-5 人团队，本 SOP 升级为选项 B（中等流程化）**。
> 参考：[VibeSOP](https://github.com/nehcuh/vibesop) / [AI Coding SDLC Playbook for Solopreneurs](https://onepersoncompany.com/169-ai-coding-assistant-sdlc-playbook-solopreneurs-2026.html)。

---

**一句话总结**：PRD 不写完不写代码 → 改完必真机验证 → 踩坑必沉淀 Postmortem。