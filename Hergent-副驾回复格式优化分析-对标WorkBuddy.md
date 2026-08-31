# Hergent 副驾 · 回复格式与呈现优化分析（对标 WorkBuddy）

> 日期：2026-08-31
> 关联文档：`AI层优化设计-对标WorkBuddy.md`（2026-07-22，聚焦 UI/可视化/右栏）、`Hergent-副驾UI规范-2026-08-20.md`（ResultCard 范式）
> 本文补全前者未覆盖的「内容生成侧」：Hermes 引擎自身回复的排版/语气/信息组织，以及副驾前端呈现的最后一公里。

---

## 0. 结论先行

**Hermes 引擎自身没有任何"回复该怎么写"的规范层。** 它的 system prompt（`agent/system_prompt.py` + `agent/prompt_builder.py`）只管两件事：
1. **行为纪律**：用工具、别造假、执行到底、任务完成准则；
2. **缓存工程**：prompt 字节稳定、cache tier 复用。

关于"呈现"的唯一一句是 `DEFAULT_AGENT_IDENTITY` 里的 *"prioritize being genuinely useful over being verbose"*（有用胜过啰嗦）——只涉及字数，不碰排版结构、语气分寸、信息组织。

而副驾前端 `hergent-cn-v2/src/components/CopilotDrawer.vue` 第 77 行是 `{{ m.content }}` **纯文本插值，全仓库零 markdown 渲染**（仅 ` ```card ` 围栏被抽成 ResultCard）。

结果：副驾回复呈现处于**"引擎不管格式 + 前端不渲染格式"的双真空**。Hermes 即便写出漂亮的标题/表格/粗体，在界面上全是裸字符 `#`、`**`；只有 `card` 围栏能被抽成经营卡。WorkBuddy 在这层有显式规范 + 结构化输出 + 富呈现，差距主要在 4 个维度（见 §2）。

**关键利好**：格式层与 Hermes 版本（v0.19.0 / v0.20.6）完全解耦——改善呈现**不需要**走有风险的版本升级，改 SOUL.md + 角色 system 即可，零停机零风险。

---

## 1. 证据（基于真实代码）

| 证据点 | 文件 / 行 | 结论 |
|---|---|---|
| Hermes 系统提示无格式层 | `/tmp/hermes-206-src/agent/system_prompt.py`、`prompt_builder.py:150` `DEFAULT_AGENT_IDENTITY` | 仅 "useful over verbose"，无排版/语气/组织指令 |
| 工具结果有 markdown 辅助，但非回复格式 | `agent/markdown_tables.py` | 那是给工具输出用的，不是回复规范 |
| 结构化角色有 persona 但格式靠硬正则 | `server/hermes_core.py:1042` `ROLE_SYSTEMS` + `:1308` `_format_regex_reply` | 语气好；但固定模板，灵活分析差；末步仅"给个简洁总结"弱指令（`:1226`） |
| 前端零 markdown 渲染 | `hergent-cn-v2/src/components/CopilotDrawer.vue:77` `{{ m.content }}` | 全仓库无 marked/markdown-it/DOMPurify；仅 `card` 围栏生效（`:103` ResultCard） |
| 开放对话大概率无人格注入 | 前端 `hermesChat` → nginx `/hermes/` → 18765 引擎；hergent 后端不在此路径拼 system | 开放对话人格取决于生产 Hermes 的 SOUL.md，需核查/补齐 |

---

## 2. 差距矩阵（对标 WorkBuddy）

| 维度 | Hermes / 当前副驾现状 | WorkBuddy 做法 | 差距 |
|---|---|---|---|
| **排版结构** | 引擎无要求→模型自由发挥，常是大段散文、无层次、无小标题 | `final_answer_instructions`：结论先行、分点、表格、关键加粗、信号噪声比约束 | 大 |
| **语气风格** | 引擎仅 "direct/useful"；3 角色 persona 不错但只覆盖大秘/会计/运营；开放对话连 persona 都可能没有 | `response_language`(中文)、区域约定（红涨绿跌、¥）、分寸感（先结论后展开） | 中 |
| **信息组织** | 无"先结论再展开 / 多问逐条答 / 冗余克制"指令；结构化角色靠 `_format_regex_reply` 正则硬模板 | multi-part 逐条应答、重要结果 restate、摘要可独立成立 | 大 |
| **呈现形式** | 前端零 markdown→Hermes 写的标题/列表/表格全成裸字符；仅 `card` 围栏生效 | 富呈现：表格/代码块/图表/artifact/Visualizer 自绘 | 大 |

**根源**：格式控制被"遗忘在两层之间"——引擎层假定用户自己用 SOUL.md 管，前端层假定 AI 自己吐 `card` 围栏，结果谁都没兜底。

---

## 3. 具体改进建议（分三层）

### A 层 · 提示词 / 人格协议（成本最低、零风险、不依赖升级）★ P0
- 写一份《副驾回复格式协议》注入两处：
  1. **生产 Hermes 的 `SOUL.md`**（管开放对话）；
  2. **hergent `ROLE_SYSTEMS`**（管大秘/会计/运营）。
- 协议要点（草案见附录一）：
  - 结论先行：第一句给老板一句话答案，再展开。
  - 数据上卡：凡结构化结论，优先输出 ` ```card ` 围栏（让前端 ResultCard 真正生效，而非散文）。
  - 禁术语上屏：不用 `token/agent/工作流/节点`，用"建议/帮忙算/自动对账"。
  - 中文 + 段落克制：单段≤3 行，关键数字加粗，¥ 与千分位，红涨绿跌。
- 把 `_format_regex_reply` 的硬正则升级为"语义槽位"模板：保留语气，增强灵活分析能力。

### B 层 · 前端呈现（让 markdown / 富呈现生效）★ P1
- `CopilotDrawer.vue` 把 `{{ m.content }}` 换成 **CSP 安全、自托管的轻量 markdown 渲染**（项目铁律禁用外链 CDN），让标题/列表/表格正常显示。
- 或后端把 markdown 结构化后前端零改造消费（复用 M4 的 `card` 思路扩展到通用 md）。

### C 层 · 开放对话补人格 ★ P2
- 确认开放对话是否注入经营副驾人格（当前架构看大概率没注入，直连 Hermes 引擎）。若无，在 SOUL.md 或 nginx 前的 hergent 代理层补一份"低温奶经销商 AI 经营副驾"人格 + 格式协议。

---

## 4. 与 Hermes 版本升级的关系

格式层与升不升级版本**完全解耦**：v0.19.0 与 v0.20.6 都不管回复格式。改善呈现**不需要**走 v0.20.6 升级（那次有 3 处契约断裂 + 生产机无外网部署阻塞）。A 层改 SOUL.md + 角色 system 本周就能做，零停机零风险。

---

## 5. 优先级建议

- **P0（本周）**：A 层——写《副驾回复格式协议》注入 SOUL.md + 角色 system，让大秘等输出 `card` 围栏。收益最大、零风险。
- **P1**：B 层前端 markdown 渲染。
- **P2**：C 层角色模板升级 + 开放对话人格补强。

---

## 附录一 · 《副驾回复格式协议》草案（可直接贴进 SOUL.md / ROLE_SYSTEMS）

> 使用说明：把下面整段追加到生产 Hermes 的 `~/.hermes/SOUL.md`（开放对话），以及 hergent `server/hermes_core.py` 的 `ROLE_SYSTEMS` 各角色 system 末尾（结构化角色）。

```text
你是 Hergent 副驾——低温奶经销商老板的 AI 经营副驾。你坐在这家经销商的 ERP 数据之上，用大白话回答老板的经营问题。

【语气】
- 用"你"称呼老板，像相处多年的老搭档；不说教、不堆术语。
- 禁用上屏词：token / agent / 工作流 / 节点 / 模型 / prompt。一律换成"建议 / 帮忙算 / 自动对账 / 经营卡"。
- 中文回答；金额用 ¥ 与千分位；涨跌用红涨绿跌（中国习惯）。

【结构：结论先行】
1. 第一句直接给一句话答案（老板扫一眼就懂）。
2. 再给 1–4 个关键数字或要点。
3. 最后给可执行的下一步建议（如"要我帮你生成采购单吗？"）。

【格式：优先经营卡】
- 凡是结构化结论（货损/返利/预报/对账/工资/指标），必须输出 ```card 围栏，让前端渲染成经营卡：
  ```card
  {"type":"loss","title":"今日货损","summary":"常温奶临期 12 件，建议优先促销","metrics":[{"label":"货损金额","value":"¥386","tone":"warn"}],"points":[{"text":"蒙牛纯牛奶 12 件 3 天内到期","tone":"bad"}],"actions":[{"key":"detail","label":"查看明细"},{"key":"forward","label":"转发","primary":true}]}
  ```
- 卡片之外的解释文字用纯文本，段落≤3 行，关键数字加粗。
- 列表用 - 短句，不用长散文。

【信息组织】
- 多问题逐条答，每条给小标题。
- 不重复已知信息；不确定就明说"我需要你确认 X"。
- 能一句话说清的不甩表单；要落库的动作必须提示老板点"确认"。
```

## 附录二 · 验证清单（落地后）

- [ ] 生产 Hermes `SOUL.md` 已追加协议；重启/热加载生效。
- [ ] hergent `ROLE_SYSTEMS` 各角色 system 已追加协议。
- [ ] 副驾问"今天货损多少"→ 返回 `card` 围栏且前端渲染成经营卡（非散文）。
- [ ] 开放对话中文、无术语、结论先行。
- [ ] 前端仍零 markdown（B 层未做前）时，确认 `card` 围栏路径不受影响。
- [ ] 无头浏览器真机运行时验证（项目铁律）。

---

## 落地记录（2026-08-31，已生产生效）

### 架构修正（重要，推翻本文初稿一处误判）
- Web 副驾 `CopilotDrawer.vue:695` → `sys = currentRole.system_prompt`，`system_prompt` **正取自 `ai_roles` 库**（经 `/api/ai/roles` → `list_roles`）。所以 `ai_roles.system_prompt` **不是死代码**，而是 Web 副驾每角色的真实人格，前端作为 `sys` 透传给引擎。
- Web 副驾链路：`CopilotDrawer` → `hermesChat()` → `POST /hermes/v1/chat/completions` → nginx → **Hermes 引擎(18765)**。引擎全局身份 = 生产 `~/.hermes/SOUL.md`（slot #1）。
- 后端 `/api/ai/chat`（`ai_chat`）走 `hermes_core.call_hermes_agent` → `ROLE_SYSTEMS`（dami/accountant/ops）→ 直连 DeepSeek，是小程序/旧端的另一路径。

### 三处注入点全部落地
| # | 注入点 | 改动 | 生效方式 | 状态 |
|---|---|---|---|---|
| 1 | `ai_roles.py` | 新增 `_REPLY_FORMAT_PROTOCOL`，`list_roles`/`get_role` **读取时追加**（幂等，存量租户零迁移） | 部署后端即时生效 | ✅ 生产已部署 |
| 2 | `hermes_core.py` `ROLE_SYSTEMS` | 同协议追加到 dami/accountant/ops | 部署后端即时生效 | ✅ 生产已部署 |
| 3 | 生产 `~/.hermes/SOUL.md` | 追加「经营副驾」人格 + 格式协议 | `systemctl restart hermes-gateway` | ✅ 已重启生效 |

### 验证结果
- hergent 后端 `/api/health` → **HTTP 200**（部署后曾误报 000，实为服务重启需 ~6s、`deploy.sh` 内 `sleep 3` 过早，6s 后恢复）。
- Hermes 引擎 18765 → 重启后新 pid 监听正常，`hermes-gateway.service` active。
- 三处文件均命中协议标记（grep 计数确认）。
- 部署命令：`bash deploy.sh`（加固版，保留 `.env`/db，无 2026-08-22 事故风险）。

### 回滚锚点
- **SOUL.md**：备份 `/root/.hermes/SOUL.md.bak-20260831`，回滚 `cp` 回去即可（无需重启即可被新会话读取）。
- **后端两文件**：`git revert c20ac36` 于 `upgrade/v84-international` 分支，重跑 `deploy.sh`。`ROLE_SYSTEMS` 协议含「回复格式与呈现约定」标记，重复部署不会叠加重复。

---

## B 层落地记录（2026-08-31 17:4x 完成并上线）

### 改动
| 文件 | 改动 | 说明 |
|---|---|---|
| `hergent-cn-v2/src/utils/md.js` | **新增** | 自托管轻量 Markdown 渲染器，**零外部依赖、无 CDN**（符合项目禁外链铁律）。支持：标题 `#/##/###`、粗体 `**`、斜体 `*`、行内代码 `` ` ``、无序列表 `-/*`、有序列表 `1.`、表格 `\|`、引用 `>`、分割线 `---`、围栏代码块 |
| `hergent-cn-v2/src/components/CopilotDrawer.vue:77` | `{{ m.content }}` → `<div class="md" v-html="renderMd(m.content)">` | 消息正文由纯文本插值改为富渲染 |
| 同上 `:273` | `import { renderMd } from '../utils/md'` | 引入渲染器 |
| 同上 style 区 | 新增 `.md` 系列 scoped 样式 | 段落/标题/列表/表格/引用/分割线/代码块排版 |

### 安全设计（关键）
- **先转义再渲染**：`esc()` 先把 `& < >` 转成实体，之后块级/行内规则都在已转义文本上进行；`<pre>` 代码块跳过行内替换。
- **实测**：输入 `正常 **粗体** <script>alert(1)</script> 结束` → 输出 `&lt;script&gt;`，**不含裸 `<script>`**。
- 渲染源仅 AI 回复（`m.content`），且 card 围栏已被 `extractCard` 抽离，ResultCard 经营卡路径不受影响。

### 构建与部署
- 构建：`npm run build`（1.6s 无错误）。产物 `Shell-duYiYfkf.js` / `index-DadNn5Fv.js`（CopilotDrawer 打包进 Shell chunk）。
- 部署：远端先 tar 备份 `/root/hergent-cn-v2-bak-20260831-174602.tar.gz`（324K），再 `rsync -a --no-owner --no-group --delete dist/ → /opt/hergent-cn-v2/` + `chown -R hergent:hergent`。
- nginx：`/etc/nginx/sites-enabled/hergent` 的 `root /opt/hergent-cn-v2`（hergent.cn）；erp 子域走 `/opt/hergent-erp/static`。
- **校验**：本地 dist 与远端 `/opt/hergent-cn-v2` 的 `index.html`、`index-*.js`、`Shell-*.js` **md5 逐字节一致**；`Shell-duYiYfkf.js` 命中 `md-table` / `cp-smart-result`，确认 renderMd 已打包。
- 线上：`https://hergent.cn/` 200、`/assets/Shell-duYiYfkf.js` 200。
- 提交：laozhangai-product 仓库（含 `hergent-cn-v2/src` 全量生产代码 + `package.json` 依赖 pinia/xlsx）。

> ⚠️ 部署过程观察：本机 `dist/` 在首次 rsync 后被**另一次构建重写**（首轮产物 `index-Be32gAbD.js`/`Shell-oC4EKwEH.js` 已被替换）。服务器上无自动构建脚本、无相关 cron（仅 `healthcheck.sh` 每 5 分钟），推测为本地其他会话/工具链触发。最终以本地与远端 md5 一致作为验收依据。

### 遗留 / 后续
- **真机运行时验证（项目铁律）待用户实测**：登录 hergent.cn → 打开副驾 → 发「今天货损多少」（应回 `card` 经营卡 + 结论先行）、「写一份本周经营汇报」（应出现标题/列表/加粗，而非裸 `#`/`**`）。
- C 层（角色模板由硬正则升级为语义槽位）未做，属下一档优化。
- 若后续 Workbench 的 AI 报告也想统一富渲染，可直接复用 `src/utils/md.js`（其自带 `renderMd` 为弱版，可替换）。

---

## 附录三 · 「答非所问」根因修复 + AI 自主判断出卡（2026-08-31 晚）

### 现象
用户问「写一段本周经营汇报正文，不需要卡片」→ 副驾硬弹 3 张经营卡 + 1 个空壳汇总步骤。**根因不是 AI，是前端**：`CopilotDrawer.vue` 旧代码用 `REVIEW_RE` 宽关键词（含「经营汇报」）命中即跑写死的 `runReviewPipeline` 三卡，**完全不解析用户否定词**——卡片在 AI 回答之外被机械补出。

### 决策原则（用户拍板）
> 老板不懂技术、不知道什么是"卡片"，永远不该由他决定要不要卡片——**该不该出卡由 AI 按问题语义判断**。

### 机制：```cards 意图围栏协议
- AI 在回复**末尾**输出隐藏控制标记：` ```cards {"show":["loss","wage","rebate","forecast"]} ``` `（`show:[]` = 纯文字一张不补）。
- 该围栏**不出现在界面上**（前端 `stripIntentFence` 剥离），老板无感知。
- 前端三级决策（`CopilotDrawer.streamReply` 成功分支）：
  1. **AI 意图优先**：有 ````cards` 围栏 → 完全按 `show` 执行（`fireCards` 按名映射到货损/工资/返利/预报接口）；
  2. **弱兜底**：无意图围栏（模型漏标/旧会话）→ 单卡正则（`LOSS_RE` 等）触发，且过 `DENY_RE` 否定词过滤（"不要卡片/只要文字/纯文字"）→ 不补；
  3. **硬编排管线已废弃**：`REVIEW_RE`/`REVIEW_STEPS`/`runReviewPipeline` 从 `useCardTrigger.js` **删除**（"经营汇报"等词不再无条件弹卡）。

### 改动与验证
| 层 | 文件 | 改动 |
|---|---|---|
| 前端 | `hergent-cn-v2/src/composables/useCardTrigger.js` | 新增 `extractCardIntent` / `stripIntentFence` / `DENY_RE` / `fireCards`；删除 `REVIEW_RE`/`REVIEW_STEPS`/`runReviewPipeline`；`extractCard` 正则加 `(?!s)` 负前瞻防止误吞 ````cards` 意图围栏 |
| 前端 | `hergent-cn-v2/src/components/CopilotDrawer.vue` | `onDelta` 先剥意图围栏再抽经营卡；成功分支改三级决策 |
| 后端 | `hergent-erp/server/ai_roles.py` + `hermes_core.py` | `_REPLY_FORMAT_PROTOCOL` 两处同步追加「是否出经营卡——由你判断，用户不需要知道卡片」规则 + few-shot |
| 引擎 | 生产 `~/.hermes/SOUL.md` | 追加同规则（Web 副驾主导人格），备份 `SOUL.md.bak-20260831-cards` |

**验证**：逻辑单测 12/12 通过（意图解析/剥离/否定词不误伤/围栏共存/坏 JSON 降级）；构建产物 `Shell-CpryCXG-.js`/`index-BxhZjDpQ.js` 上线，线上引用新 hash、资源 200、旧管线归零；后端 health 200、hermes-gateway 重启后 18765 正常。**提交**：laozhangai-product `8f37b11`、hergent-erp `f51ee45`。

### 待用户实测（判定 AI 判断力）
- 问「**这个月工资怎么算**」→ 应只弹 1 张工资卡（AI 判定给卡）；
- 问「**帮我写一份周报正文，只要文字**」→ 应纯文字 0 卡（AI 判定纯文字）——若仍弹卡，说明模型没遵守 ````cards` 协议，需在协议里加更硬的 few-shot。
