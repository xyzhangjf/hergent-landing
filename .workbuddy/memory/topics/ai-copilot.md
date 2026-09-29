# AI 副驾协议层（围栏 / 经营卡）

## 协议围栏共 5 种（都是「给前端看的控制信号」，绝不是正文）
` ```card `（经营卡 JSON）/ ` ```cards `（要不要出卡的意图）/ ` ```clarify `（反问选项）/
` ```proposal `（配方自进化提案）/ ` ```reminder `（待办提醒）。

## ⭐ 铁律：统一剥离 + 渲染层兜底（2026-09-11 血的教训）
**症状**：老板在 AI 回复最后一段看到整段裸 JSON（`{"type":"forecast",...}`）。
**根因**（不是模型没打围栏——生产库原始报文证明模型打得好好的）：`CopilotDrawer.onDelta` 里
`if (last.card) { last.content = clean }` 分支**只剥了意图围栏、没剥 card 围栏**。卡片在流式
中途抽到之后，后续每一个分片都会把整段卡片 JSON 重新写回正文 → 必然泄漏（因为 ` ```cards `
意图围栏在 card 围栏之后，后面一定还有分片）。

**修法（两层，缺一不可）**：
1. **统一剥离**：`composables/useCardTrigger.js` 的 `stripAllFences()` —— 一处收口剥掉 5 种围栏，
   且要处理 **① 未闭合的流式半截**（`OPEN_PROTOCOL_FENCE_RE`，否则流式过程中半截 JSON 会闪现）；
   **② 语言标签写错/漏写**（` ```json ` 或裸 ` ``` ` 里其实是经营卡 JSON，用 `asCardJson()` 判 type）；
   **③ 完全没围栏的裸 JSON**（`findBareCard()`，见下条）。
   `extractCard` 的正文返回值也必须走它。
2. **渲染层 choke point**：`utils/md.js` 的 `renderMd()` 第一行就 `stripAllFences`。这样**历史会话里
   已经存脏的 content**、`AiHub` 报告导出、`Workbench` 晨报全都自动免疫（Workbench 有自己的
   renderMd，也补了）。**动正文渲染路径时别忘了这个 choke point。**

## ⭐ 第二刀：裸 JSON 无围栏（2026-09-11 第二次修，同日）
**症状**：老板又贴来一张卡（`{"type":"loss","title":"本月货损核算",...}`），**纯裸 JSON、无任何围栏、多行美化**。
**根因**：① `stripAllFences()` 当时**只剥「带围栏」的**，压根没有裸 JSON 能力——
上一版注释里写"`findBareCardJson` 处理裸 JSON 尾巴"是**文档与代码不符**，那个函数只在 `extractCard` ③ 分支里用；
② `CopilotDrawer.onDelta` 是 `if (!last.card) last.card = extractCard(full).card` 但正文一律
`last.content = stripAllFences(full)` → **`extractCard` 返回的已剥净正文被丢弃**。
两条叠加：模型一旦漏打围栏，整段 JSON 留在正文，老板直接看到。

**修法（三处，都在 `useCardTrigger.js`）**：
1. `findBareCardJson` → **`findBareCard`**，返回 `{card,start,end,open}`：
   - 完整对象 → `{card,start,end}`（`end` 用于精确摘除）
   - **流式半截**（有起点、`}` 未到）→ `{card:null,start,open:true}` —— 半截也必须返回 start，
     否则 JSON 会一段段闪现在正文里
2. `stripAllFences` 末尾并入裸 JSON 处理：
   - 完整 → **精确摘除 `[start,end)` 区间，保留 JSON 前后正文**（原来 `slice(0,start)` 一刀切，
     卡片不在末尾时会把后面的正文一起砍掉 —— 已修，实测「前置…+JSON+…后置补充」前后都在）
   - 半截 → 从 start 截断到末尾
   - 还没成形时（只有一个孤立 `{` 挂在尾部）→ **`findOpenBareStart()`** 截断：
     `lastIndexOf('{')` 且其后**全是 JSON 语法字符**（无中文/标点）且无 `}` 才算，避免误伤正文花括号
3. `extractCard` ③ 分支正文改为 `stripAllFences(src)`，与 ①② 口径统一。

## ⭐ 真机验证经营卡剥离的正确姿势（生产 chunk 导出名被压缩）
线上 chunk 的导出名会被 minify 成短名（如 `export{q as D,$ as a,G as b,...}`），
**`import()` 后 `m.stripAllFences` 是 undefined**。正确做法 = **按行为自动识别**：
```js
const m = await import('/assets/useCardTrigger-<hash>.js');
for (const k of Object.keys(m)) {
  const r = m[k](src);                     // src = 中文正文 + 裸卡片 JSON
  if (typeof r === 'string' && !/[{}]/.test(r) && r.includes('正文特征串')) → 这就是 stripAllFences
  if (r && r.card && r.card.type === 'loss')                            → 这就是 extractCard
}
```
在 hergent.cn 页面里跑（同源才能 import chunk），无需登录。实测结果
`stripKey:"s" / cardKey:"f"`，`outClean:true / streamLeakAt:null / midKeepsBoth:true`。
**逐字流式回归**必须这样测：`for(i=1..len) stripAllFences(full.slice(0,i))`，任一时刻出现 `{`/`}` 即泄漏。

## 经营卡 JSON 契约（2026-09-11 起写进协议）
规范字段 = `ResultCard.vue` 认的那套：`type / title / summary / metrics[{label,value,tone,hint}] /
points[{text,tone}] / items[{中文键:值}] / source / status / actions / chart`。
- **`_REPLY_FORMAT_PROTOCOL` 在仓库里重复定义了两份**：`ai_roles.py:353`（经 `GET /api/ai/roles`
  发给前端副驾，**这份才生效**）与 `hermes_core.py`（`/api/ai/chat` 路径）。**改协议必须两处同改**，
  否则前端毫无变化——本次就踩了：只改 hermes_core，前端拿到的是 ai_roles 那份，验证全 False。
- 未规定字段结构之前，模型每次自造键名（同一问题两次分别给出 `daily_avg/suggest` 与
  `daily_sales/days_supply`）→ 卡片渲染不出来。协议钉死后模型稳定输出
  `items:[{"品名":..,"日均":..,"库存":..,"建议":..}]`。
- `ResultCard` 的 `detail` computed 是兜底层：AI 用 `items/rows/detail/list` 任一命名都能渲染，
  键名走 `ITEM_LABELS` 映射，**认不出的键原样当表头（所以协议里必须要求中文键）**。compact 模式不渲染明细。

## 生产 SOUL.md
`/root/.hermes/SOUL.md` 也有同一份卡片协议（Hermes 网关侧）。改协议时这份也要同步
（备份 `.bak-20260911-card-schema`）。它由 Hermes 网关读取，可能需重启 `hermes-gateway` 才生效；
而前端链路的 `system` 是后端 `ai_roles` 给的，重启 `hergent-erp` 即可。

## 回复风格对标 WorkBuddy（2026-09-13 审查）
- 📍 **可复核数据源**：生产副驾真实回复存在 `tenant_N.db` 的 `chat_sessions` 表（`messages_json` 字段，含 `content`/`card`/`clarify`/`tools`）。做回复质量审查**不要造数**，直接查这张表；`erp.db` 里没有这张表。
- ⭐ **"改提示词能否管住模型"已有实证**：09-11 14:40 部署「卡片 items 中文键」→ 14:41 的下一张卡即合规，**1 分钟见效**。结论：格式类问题优先改 `_REPLY_FORMAT_PROTOCOL`，不必等模型/版本升级。
- ⭐ **列举式黑名单必漏**：术语禁令只列 `token/agent/工作流/节点/大模型`，结果漏出 `hermes pairing approve wecom PAVGNRZ2`（真实回复里直接教老板敲命令）。**要写成规则式白名单**（"凡英文标识/命令/路径/字段名一律改写或省略"）。
- ⚠️ **协议覆盖面的盲区**：目前只钉了「卡片字段」。骨架、篇幅、加粗、表格、术语**都无量化要求** → 6 条真实回复篇幅差 7.7 倍、加粗差 21 倍。
- ⚠️ **前端有闲置能力**：`utils/md.js` 早已输出 `<table class="md-table">`，但**真实回复 0 条用表格**。协议里加一句"对比必用表格"即可零成本激活。
- ⚠️ **无校验兜底**：`ResultCard.vue:149` `keys.slice(0,4)` 只取前 4 列，第 5 列起**静默丢弃**；未登记键以英文原名显示给老板（`ITEM_LABELS[k] || k`）。卡片字段规范靠提示词，但仍缺"校验+显式降级"的最后一层。
- ✅ **不要砍掉的既有优势**：口径披露（"这个 0 是'没录'不是'真没有'"）、数据来源标注、自主性边界（"AI 只建议，下单还是你点头"）—— 这三条比 WorkBuddy 的通用回复更到位。
- 产出：`副驾回复风格对标WorkBuddy-差异审查与借鉴-2026-09-13.md`

## 🔴 副驾提示词有 5 处载体（2026-09-13 实证，改协议前必读）

改「回复格式/语气/卡片协议/术语约束」时**只改 Python 常量 = 网页副驾没改**。

| 载体 | 谁在吃 |
|---|---|
| **`/root/.hermes/SOUL.md`** | **网页副驾**：nginx `location /hermes/` → `127.0.0.1:18765` → `hermes-gateway.service`（root, cwd `/root/.hermes`） |
| `server/ai_roles.py::_REPLY_FORMAT_PROTOCOL` | `GET /api/ai/roles`（前端拉角色定义当 system prompt） |
| `server/hermes_core.py::_REPLY_FORMAT_PROTOCOL` | `/api/ai/chat` + 注入 `ROLE_SYSTEMS` |
| `/opt/hermes-tenants/_seed/SOUL.md` | **新租户**播种源（`hermes_tenants.SEED_DIR`）；只在缺失时播种 |
| `/opt/hermes-tenants/hergent_t<N>/SOUL.md` | 该租户 IM 通道 gateway（`HERMES_HOME` 指向它，如 wecom） |

- **判定网页副驾读哪份**：`ss -lptn | grep 18765` → `readlink /proc/<pid>/cwd`；`systemctl show hermes-gateway -p MainPID`。⚠️ 别用 `pgrep -f <词>`（会匹配到自己的 ssh 命令行，拿到 `cwd=/root` 的假进程）。
- **生效**：Python → `restart hergent-erp`；SOUL → `restart hermes-gateway`（18765 需 5~15s 才 bind，立刻查是空）；租户 → `hermes_tenants.gateway_restart(tid)`（`connecting` 需轮询回 `connected`）。
- **唯一可信的 E2E**：`POST http://127.0.0.1:18765/v1/chat/completions`，头 `Authorization: Bearer hergent-prod-gateway-key-2026`，body `{"model":"hermes-agent","messages":[{"role":"user","content":"这个月货损情况怎么样？"}],"stream":false}`，看正文是否出现新骨架标记。**只验 `/api/ai/roles` 或只 grep 落点，都只证明 Python 链路。**
- ⚠️ `/api/ai/roles` 对 `sales` 角色 **403**（不在 RBAC 豁免族）→ 需临时 admin 令牌，别误判成改动失败。
- 生成方式：**脚本一次产出再分发**（两份 Python 用同一函数 patch + 断言相等），手抄必分叉。
- SOUL.md 不在任何 git 仓库 → 改动要单独留档（`artifacts/`）+ 服务器备份。

## 回复协议当前内容（2026-09-13 P0 增补后）
- **骨架**：`【结论】→【依据】→【下一步】→【需要你确认】`（缺项可省）。
- **硬指标**：正文 ≤400 字（实测常到 ~444 字符，含标点/数字）、单段 ≤3 行、加粗 ≤5 处。
- **对比必用 markdown 表格**（2+ 对象 × 2+ 指标）——`utils/md.js` 早已支持 `md-table`，此前真实回复 0 条用表（闲置能力）。
- **用词**：规则式白名单「凡英文标识/命令/代码/路径/字段名/接口名，一律改写为业务语言或省略」+ 保留 token/agent/工作流/节点/大模型 五词黑名单。**列举式黑名单必漏**（曾漏出 `hermes pairing approve wecom PAVGNRZ2`）。
- **拍板**：给 2~3 个带标签选项 + 显式推荐。
- 保留不动：口径披露、数据来源标注、自主性边界（三条比通用助手更强）。

## ✅ 经营卡有两条出卡链路（2026-09-13 已修，保留作架构说明与回归判据）
一次提问可能产出 **两条 assistant 消息**，且结论可能相反。

> **修复记录（2026-09-13，A/B/C/D 全做）**
> - **A**：出卡判据由「只看复数 ````cards`」→「AI 已出卡（任意形态）即不兜底」（`CopilotDrawer.vue`：`const aiCarded = !!(cardIntent || (replyMsg && replyMsg.card))`）。
> - **B**：`scan_expiry` 暴露 `total_batches`/`unscanned_batches`；loss-card 判据改三态 `at_risk>0?warn:(效期不全?neutral:good)`，新增「未录效期批次」metric（warn + hint）；`scheduler.py` 同源日报一并修。
> - **C**：卡标题/指标「本月货损」→「近 30 天货损」（实现是 30 天滚动窗口）。
> - **D**：`useCardTrigger.pushCard` 移除 `pushRoleReply(..., 'card')` —— 确定性卡不再推 IM，只推带口径披露的 AI 主回复。
>
> **回归判据（改副驾出卡链路后必查）**
> ① 一次提问只应有 **1 条** assistant 消息（AI 明确不出卡时才 2 条）；② `/api/ai/loss-card` 在「效期不全」时**不得**返回任何 `tone:"good"`；③ 任何 `/ai/roles/*/push` 请求**不得**带 `kind:"card"`。

| 链路 | 触发 | 产出 |
|---|---|---|
| **LLM 主回复** | 协议要求结构化结论「优先输出 ```card 围栏」 | 卡片挂在同一条 assistant 消息上（`extractCard` 解析，认**单数** ` ```card `） |
| **前端兜底** | `CopilotDrawer.vue:1162-1164`：`if (cardIntent) {...} else if (!DENY_RE.test(q)) triggerCards(q)` | **追加一条新 assistant 消息**（`pushCard`），卡来自 `GET /api/ai/{loss,payroll,rebate,forecast}-card` |

- ⚠️ **契约漏洞（必然触发）**：`cardIntent = extractCardIntent()` 只认**复数** ` ```cards `（`useCardTrigger.js:132 CARD_INTENT_RE`），而协议第 32 行明写「出单个 ```card 就不要再出 ```cards（两者只需其一）」→ **AI 越守协议，前端越会判定「未判断」而再补一张**。判据正则与渲染正则**必须同桌核对**（`extractCard` 认单数、`CARD_INTENT_RE` 认复数）。
- ⚠️ **兜底卡判据与 LLM 不同源、无口径披露**：`server.py` 的 `*_card` 端点只做数值聚合，**不会**像 LLM 那样说「0 只说明没录」。例：`at_risk==0 → tone:"good"`、无报损 → `summary="…库存健康。"`；而 `domain/batch_tracker.py:91 WHERE i.expiry_date != ''` 会把无到期日批次**整体排除**，于是「效期全空」反而渲染成全绿「库存健康」。**任何"零值即健康"的判定都要先问：这是真零，还是没数据？**
- ⚠️ **兜底卡也会 IM 推送**：`pushCard → pushRoleReply(..., 'card')` → `POST /api/ai/roles/{rid}/push` → `ai_channels.push_role_channels` 按 `ai_role_channels.role_config.push_scope`（默认 `'all'`，即 card 也推）。所以一条**写错**的兜底卡会直接进老板企微。
- ⚠️ **口径标签与实现要同源核对**：卡写「本月货损」，实现是 `wastage_summary(30)`＝近 30 天滚动窗口（跨月）。查标签真伪看 SQL 的日期条件，别信标题。

## 技能/插件基础设施（2026-09-14 勘察）+ 🔴 租户技能冻结缺陷

**Hermes 自带 5 个技能基础设施模块**（在 venv 里，Hergent 只接了只读列表）：
`/usr/local/lib/hermes-agent/venv/lib/python3.11/site-packages/tools/`
`skills_hub.py`（注册中心适配器 + GitHub 源 + 来源锁 + **隔离区 quarantine** + 审计日志）、
`skills_guard.py`（**外部技能安全扫描**：数据外泄/prompt 注入/破坏性命令/持久化；**信任分级** builtin 永不扫 / trusted 仅 openai+anthropic / community 任一发现即拦截）、
`skill_manager_tool.py`（Agent 自主 create/edit/patch/delete，写 `~/.hermes/skills/`）、
`skills_sync.py`（manifest 式更新，**用户改过就 SKIP 不覆盖**）、
`skill_provenance.py`（区分「AI 自动沉淀」vs「用户要求写的」，用户技能不被 curator 清理）。
→ 做「用户自定义能力插件」时**先把这几个接出来**，不要自造插件体系。

**Hergent 侧现状**：`routers/ai_skills.py` 只有**一个 `GET ""`**（转发 Hermes `/v1/skills`，只读）；
`ConnectCenter.vue:221-272` 已有「技能 tab + 预置/自进化分组 + 机器名→业务名解释」的 UI 壳。

### ✅ 已修：租户 Hermes 的行业技能曾"冻结"，配方改了传不到租户 AI（2026-09-14 `1351c02`）

**缺陷原貌**（保留作回归判据）：
- `recipe_sync.py` 旧 `DEFAULT_SKILLS_DIR = "/root/.hermes/skills"`；`trigger_sync_from_service()`
  以 sudo 跑**默认目录、不传租户号**；5 个调用点全部不传租户。
- `hermes_tenants.py::ensure_home` 租户 home 的 skills **只在目录不存在时**从 `_seed` 拷一次
  （`if not dst_skills.exists()`，注释却写着"镜像式同步"——**注释口径 ≠ 代码行为**的又一实例），此后永不更新。
- 生产证据：`_seed` 与 `hergent_t1` 的 SKILL.md md5 逐字相同（`a3f7a7ee…`）、mtime 同为 `2026-09-10 20:56`
  → 是**播种化石**；「同步时间 2026-09-07 21:20」恰等于配方最后保存时间，正是"拷贝件"的签名。
- 影响：用户把货损临期阈值 7→5，Web 端算式按 5 走，**租户 AI 仍按 7 回答** —— "后端算的"与"AI 说的"分叉。

**修复后的机制（改这块代码前必读）**：
1. 🔴 **目标的权威目录 = `hermes_tenants.home_for(tid)/"skills"`**（即 `/opt/hermes-tenants/hergent_t<N>/skills`）。
   租户网关 `HERMES_HOME` 指向租户 home，Hermes `get_skills_dir() = HERMES_HOME/skills`
   → **只读自己那份**；`/root/.hermes/skills` 只服务 root 那台默认网关，与租户无关。
2. 🔴 **不需要 sudo**：`/opt/hermes-tenants` 整棵树属主就是运行服务的 `hergent`（700），本进程直接写。
   旧实现的 sudo 是因为它写的是 root 独占的 `/root/.hermes`——**换对目录后权限问题自动消失**。
3. 🔴 **ContextVar 不跨进程**：`db.get_tenant_context()` 是 ContextVar，所以「sudo 子进程里再取上下文」
   永远拿不到真租户 → 必须由**调用方显式传 tid**（5 个调用点已全传）。**取不到时跳过，绝不回退 1**。
4. 🔴 **改文件不够，必须重启该租户网关**：`agent/prompt_builder.build_skills_system_prompt` 有
   ①进程内 LRU 缓存 ②磁盘快照 `.skills_prompt_snapshot.json`（按 mtime+size manifest 校验）。
   磁盘快照会因 mtime 变化自动失效，但**进程内 LRU 缓存键不含 mtime** → 同进程永远读旧值。
   故：**内容真变化 且 `gateway_pid(tid)` 在跑 → `gateway_restart(tid, wait=False)`**；
   未在运行则不动（下次启动自然读到）。为减少无谓重启，只在内容真变化时写盘（原子写 + 保留权限位）。
5. 租户无 home/skills（如**演示租户 tenant 10**）→ 静默跳过，**不凭空创建目录**。
6. 运维入口：`python recipe_sync.py --tenant-id N --tenant-home`（CLI 默认仍指全局，供运维批量用）。

**回归资产**：`.workbuddy/tools/recipe-sync-tenant-target-test.py`（本地单测 35 项，假模块注入，不碰生产）、
`.workbuddy/tools/recipe-sync-e2e-prod.py`（生产端到端 12 项，真 API 改配方并改回）。

**仍未做（不要误以为已解决）**：`_seed` 更新后**不会传导到存量租户**（仍是"仅缺失时播种"）；
即内置 skill 本身的正文修订（非配方区块）依然只对**新建租户**生效，除非手工 `--tenant-home` 补跑一遍。

## 🔴 租户 AI 的执行边界：全租户同账号 + `HOME` 指向后端目录（2026-09-14 实测）

> 结论先行：**"不发插件（不进场）"是政策，"有隔离"是能力 —— 两件事。** 政策不落成机制 = 没有。
> 目前 Hergent 只有前者。详见 `outputs/Hergent-插件化架构与商业模式评估-2026-09-14.md` §2.4 与技能
> `hergent-tenant-isolation-audit` §11。

**前提：租户 AI 不是只读聊天框，它手里有三类工具**（`site-packages/tools/`）
`code_execution_tool.py`（任意命令）· `file_tools/files_operations/credential_files`（任意文件读写）· `browser_*`/`web_search`（**出网**）。
→ 所以判据永远是：**租户 A 的 agent 执行一条命令后能读到什么**，任何应用层 `tenant_id` 校验都拦不住。

**六项实测（2026-09-14，全部为生产原始输出）**

| 项 | 实测 |
|---|---|
| 网关运行身份 | 全部同一个 `hergent`；`/etc/passwd` 里只有这一个业务账号（`hergent:x:998:998::/opt/hergent-erp:/usr/sbin/nologin`） |
| 租户网关 `HOME` | **`/opt/hergent-erp`**（后端代码 + 全部数据库目录）；只有 `cwd` 指向 `/opt/hermes-tenants/hergent_t1` |
| `~` 的解析点 | `file_tools.py:48` `os.path.expanduser(path)`；`file_operations.py:49` `_HOME = str(Path.home())`；`code_execution_tool.py:1914` 提示词原文 `os.path.expanduser('~/.hermes/.env')` |
| DB 权限 | `erp.db` / `tenant_1.db` / `tenant_10.db` 均 **644** |
| 系统级沙箱 | `ProtectHome=no` · `ProtectSystem=no` · `PrivateTmp=no` · 无 docker/podman/bwrap/nsjail/firejail |
| 另有一个 **root** 网关 | `hermes-gateway.service`：`User=root`、`WorkingDirectory=/root/.hermes`、`API_SERVER_PORT=18765`、CORS 含 `hergent.cn`。⚠️ **它不是历史遗留、正在服役** —— nginx `location /hermes/` → `127.0.0.1:18765`，即**网页副驾本体**（其协议层 = `/root/.hermes/SOUL.md`，见本文提示词载体表）；另挂 MCP stdio watchdog（spreadsheet）。**所以 A5 只能是"降权 + 沙箱"，不能是"停掉"。** |
| 租户网关怎么起的 | **由 `hergent-erp.service` fork 出来的子进程**（`hermes gateway run --force`，`User=hergent`），**没有任何独立 systemd 单元** → A1 需新增模板单元 `hermes-gateway@tenant_N` + 每租户 OS 用户（**架构级**）；而 **A2 只是给子进程 env 加一行 `HOME=`（分钟级）** |
| `hergent-erp.service` 实测 | `Type=simple`·`User=hergent`·`WorkingDirectory=/opt/hergent-erp`·`MemoryLimit=512M`·`CPUQuota=200%`·**无任何 `Protect*` / `PrivateTmp` / `CapabilityBoundingSet`**（= A4 的落点） |

→ 租户 A 的自写插件让 AI 跑一条命令，即可读**租户 B 的 `.env`（渠道凭证）**、**主库 `erp.db`**、**全部 `tenant_*.db`**。
⚠️ **当前生产只有 1 个真实租户 → 路径尚未激活；第 2 个租户上线那一刻即生效。** 汇报时**必须显式说这句**，
否则会被读成"现在没风险"。

**🔴 两个反直觉的漏判点（都会让排查提前收工）**

1. **`HOME` 不归应用层管**：只看 `cwd` 会得出"隔离良好"的错误结论。必须读进程环境
   （`tr "\0" "\n" < /proc/<pid>/environ | grep -e "^HOME=" -e "^HERMES"` + `readlink /proc/<pid>/cwd`）。
2. **Hermes 的"沙箱"不是安全边界**：`SANDBOX_AVAILABLE = True` 是真的，但 `SANDBOX_ALLOWED_TOOLS` =
   `web_search, web_extract, read_file, write_file, search_files, patch, terminal` ——
   **含 `terminal` 与 `write_file`**。它限的是**资源与稳定性**（`DEFAULT_TIMEOUT=300` / `MAX_TOOL_CALLS=50` /
   stdout 50KB / 剥离 subprocess 环境变量），**不是"能碰哪些文件"**。且租户 `config.yaml` 实测仅 4 键
   （`model`/`max_turns`/`mcp_servers`/`onboarding`），**无任何沙箱或权限配置**。
   → **判据：看到 `SANDBOX_AVAILABLE` 不要收工，去读 `SANDBOX_ALLOWED_TOOLS` 里有没有 `terminal`。**

**收口 6 条（做完了才谈得上开放"用户自定义插件"）**
A1 每租户独立 OS 用户/容器（验收：A 读 B 的 home 必须失败）· A2 租户网关 `HOME` 指向自己的 home ·
A3 `*.db` 收 600 + 属主拆分 · A4 补 systemd 沙箱指令（`ProtectHome`/`ProtectSystem`/`PrivateTmp`/`ReadWritePaths`/`CapabilityBoundingSet`）·
A5 **把网页副驾网关从 root 降权**（**不是停** —— 它是 nginx `/hermes/` 的后端，停了网页副驾即挂）· A6 **出网默认拒绝** + 白名单域名 + 审计日志
（A6 是"数据不得转售"红线在技术上的对应物 —— **能出网才谈得上把数据带走**）。

**🔴 A 组不是一档，必须拆两批**（2026-09-14 二次实测后修正）

| 批次 | 条目 | 成本 | 它是**谁**的前置 |
|---|---|---|---|
| **批 1** | **A2**（子进程 env 设 `HOME`）+ **A4**（systemd 沙箱指令） | **小时级** | **B1 配方域的前置** —— 它们决定 AI 的 `~`/写文件落点 |
| **批 2** | **A1**（模板单元 + 每租户 OS 用户）+ **A3**（库权限拆分）+ **A6**（出网白名单）+ **A5**（降权） | **架构级（周级）** | **L2 自定义技能文本的前置**；可与 B1 **并行**，**硬截止 = 第 2 个真实租户上线前** |

→ 判据：**不要把 A 组当成一个必须整体先完成的闸门**（那会把 B1 无谓推迟周级），
也不要因为 B1 本身安全就认为"整个插件方向已开工"。**批 1 是钥匙，批 2 是围墙。**

⚠️ 与「隔离性不换成本」（§2.2：不要为省内存改共享进程）是同一件事的两面。

## 排查副驾"回复是否正常"的标准取数路径
1. **真实回复在 `tenant_N.db` 的 `chat_sessions.messages_json`**（`erp.db` 没有这张表）—— 按 `updated_at desc` 找最新一条，**不要造数**。
2. 逐条打印 `role` + 附加字段 + 正文；**先数 assistant 条数**：>1 基本就是本文的双链路问题。
3. 卡片字段：`type/title/summary/metrics/points/items/source/status` + 兜底卡多出 `chart/actions`（**有无 `chart`+`actions` 是区分两条链路的快捷判据**）。
4. 是否推送到 IM → `journalctl -u hergent-erp | grep 'roles/.*/push'` + 查 `erp.db` 的 `ai_role_channels`（`role_config=NULL` 即 `push_scope='all'`）。

## 跨租户经验采集 / 「越用越聪明」的现状底账（2026-09-14 勘察）
**已有地基（可直接复用，勿另起一套）**：`ai_advice_log`（租户库，含 task_type/payload/reasoning/ai_confidence/status/decision/modified_by_user/decided_at/result_entity_*，AiHub 已有「建议采纳率」KPI）；`review_trust_levels`（L1 免审/L2 先斩后奏/L3 必审）；`recipe_proposals`（提案→审批→合并→审计全链路，`recipe_evolution.py`）；`workflow_recipes`/`forecast_config`（口径真值产地）；`audit_logs` 主库哈希链；`llm_call_log`（主库，**只存长度不存内容**，隐私友好范式）+ `ai_usage`；`user_consents` + `routers/gdpr.py`（导出/匿名化/同意）。
**三个断点（决定方案成败）**：① `modified_by_user` 只存**人名**（`erp_db.py:15214`），不存用户改后的值 → 最高价值的「AI 说 7 我改 5」Delta 丢失；② `recipe_proposals` 只被动创建（`recipe_evolution.py:118`），无「同类覆写重复 N 次→自动提案」触发；③ 跨租户真值共享：`recipe_sync.py:175` 把带真值的 AUTO_RECIPE 块写**同一份**全局 skill，且 `trigger_sync_from_service()`（`:264`）不带 `--tenant-id` → `read_live_recipes(None)` 退化 `or 1`（与上文「租户 HOME」条目同源）。
**两处必须清理**：① `routers/ai_learning.py` —— **已于 2026-09-19 整体删除**（后端 commit `ca0e708` + `6feac0a`）。
🔴 **原判定「是死代码 / 全项目无人 import」不准确**（那是 `grep --include=*.py` 在 zsh 静默失效造成的误判）：它其实**已接线**（`server.py:781` import + `:884` include_router），三个接口在生产**可达**。真实失败链：SQL 读 `llm_calls_log.prompt`/`.tool_used`，而该表仅 9 列（`erp_db.py:14146`，真列名是 `tool_names`、**根本没有 prompt 列**）⇒ `/analyze`、`/stats` 必然 500；`/approve`（`:121`）写死的 `/opt/hergent-erp/server/routes.py` 因生产是 **FLAT 布局**（真文件在 `/opt/hergent-erp/routes.py`，无 `server/` 层）⇒ 必然 FileNotFoundError；且其 `regex`/`tool` 两字段**零校验**就拼进代码行 ⇒ **一旦该路径被"修对"即可向全局 `routes.py` 注入任意 Python（跨租户生效）**。零调用（前端/小程序/nginx access.log 全为 0）⇒ 判为纯负债删除。
**合规定性**：经营参数字段是**商业秘密**而非个人数据 → 主线是合同授权 + 反法，跨租户层只保留「算法口径」（参数名 + 量级桶），金额/工资/客户/进货价/返利费率**一律红线**；`user_consents` 须扩**双档位**（本租户内固化默认开 / 行业匿名共享默认关）。
**验证三合一判据**：`source_ref` 非空（可回溯）+ 30 天内被 ≥2 场景复用（被复用）+ 回归否决率 =0（无回退）；只看第一条 = 「零值即健康」同族错误。
方案全文：`docs/Hergent-行业经验采集与持续学习方案-2026-09-14.md`。

---

## 🔴 AI 在产品里的真实落点（2026-09-19 代码级盘点，回答「AI 到底起什么作用」）

**判据先行：文件名带 `ai_` ≠ 真的用了 AI。**
必须查两件事：① 通篇有没有 `call_ai` / `chat_ai`；② 有没有被 import（`grep -rn` 时排除自身文件）。
本轮两个坑都踩到过，记住。

🔴 **v301（2026-09-27）把判据抬到「全仓调用点」层**：
`grep -rn "chat/completions" server/` ⇒ 后端真模型调用点**全仓只有 7 处**：
`ai_engine.py:17-18`（DeepSeek / 通义网关）· `hermes_core.py:14` · `hermes_bridge.py:11`（`call_hermes`）·
`ocr.py:11`（图片/PDF 识别）· `routers/ai_judgement.py:39` · `routers/copilot_proxy.py:35`（Web 副驾）·
`routers/forecast_config.py:1146`（`/hermes-analyze` 异常根因分析）。
👉 **没出现在这 7 处的「AI 能力」，一律先按"待核实"处理，不得直接对外讲。**

📄 **唯一权威表 = `docs/AI能力对照表.md`**（2026-09-27 落盘）：
真 AI 10 项 / 已整改 1 项 / 灰区 4 处 / 对外口径三条红线。
**新增任何带「AI」的界面文案，都要先在这张表里登记。**
⚠️ 别再按「前端 `grep -c "AI"` 的文案条数」对齐 —— 前端含 "AI" 的文案有 100+ 处，
绝大多数是**同一个真能力的界面碎片**，按条数对齐会得出错误结论。**按「能力」组织。**

### 真正调大模型的只有四处（调用链已验证）

| # | 文件 | 能力 | 调用链 |
|---|---|---|---|
| ① | `ai_insight_llm.py` | **跨表 + 因果的自然语言经营洞察**，每日主动推送。作者自注「**这才是护城河正主——竞品舟谱给不了**」+ 纪律「**AI 只建议不擅自下单：洞察只读分析，绝不写库改业务**」 | `scheduler.py:750`、`routers/ai_assist.py:535` |
| ② | `ai_insights.py` | 每日摘要（`chat_ai()`）→ 工作台「AI 晨报」 | `scheduler.py:737`、`server.py:4744` |
| ③ | `ai_product_fill.py` | 商品字段补全（品牌/品类/规格/单位/建议价）。🔴 **本地规则优先（0 token），模糊才调模型** | `server.py:4759` |
| ④ | `CopilotDrawer.vue` + `AiHub.vue` | 副驾问答/报告/卡片；用量配额·个性化洞察·长期画像 | ↔ `routers/ai_assist.py` |

### ⚠️ 不是「名不副实」，但对外仍禁提（**v301 修正定性**）

- **`ai_tools.py` 的 `AI_TOOLS`（11 个工具）通篇零模型调用** —— 纯 SQL + 阈值，
  **11 个全部只读**（`tool_sales_today` / `tool_ar_aging` / `tool_expiry_alert` …）。
  🔴 **v301（2026-09-27）修正**：docstring 原文 `These functions are callable by AI agents via the
  Gateway tool system.` ⇒ 它的真实角色是「**给 AI 用的工具**」（AI 的手脚），
  `ai_` = 「**服务于 AI**」，**不是「由模型计算」** ⇒ **它不是名不副实**。
  **但结论不变**：🔴 **对外仍绝对不要提「我们有 11 个 AI 工具」** —— 客户会读成
  「有 11 个模型能力」，属夸大。**不是假，是会误导。**
  接线（实测）：`server.py:3627` / `3680 list_ai_tools` / `3690 get_tool`。
- ✅ **`ai_learning.py` 已于 2026-09-19 删除**（原是**已接线**的坏接口，非死代码 —— 见上文「跨租户经验采集」节）。
  删除前的真实状态：三个接口**没有一个能工作**（SQL 列名与表结构不符 + 写路径与 FLAT 布局不符），
  且 `/approve` 的 `regex`/`tool` 零校验 ⇒ **未引爆的跨租户代码注入面**。零调用（nginx 0 命中）。
  🔴 **教训（比结论重要）**：`grep -rn "x" --include=*.py` 在 zsh 下**静默失效**（报 `no matches found`，
  看起来像"没有匹配"）⇒ 我据此把它误判成"死代码"，**默认了"不存在的都是无用的"**。
  **正确判据是「先证明存在，再证明被调用，最后证明它能不能跑通」三步** —— 只做前两步，
  会把"接线了但必崩的接口"当成无害残留继续留在生产上。

### 四类工作分工框架（算 / 录 / 判 / 说）

**判据与 BP 可用措辞全文** → `outputs/德邻杯-AI创业大赛-2026-09-19/04-AI在产品里的分工.md`

- **算** ＝ 确定性系统（**AI 绝不进来**：有唯一正确答案 · 可复算 · 可审计）
  → 报单汇总 / 返利核算 / 工资提成 / 箱与小单位换算 ← 🔴 **这一层是护城河**
- **录** ＝ AI 入口（源头是人写的 · 格式脏 · 量大）→ 商品档案补全已做；
  🔴 **报单与目标的录入仍是纯人工 ← 最大缺口，也正是用户抱怨的「靠人填数据」**
- **判** ＝ AI 核心（没有唯一答案 · 靠经验 · 多目标）→ 订多少 / 先出哪批 / 为什么掉量 ← **几乎空白**
- **说** ＝ AI 出口 → AI 晨报 / 经营卡片 / 副驾问答 ← 已做

**一句话记法**：**「算」这一层没有「智能」可替代，只有「口径」要遵守。**
⇒ 这同时就是「基座模型按周升级会不会收编应用层」的答案：模型只会让「录/判/说」更好，动不了「算」。

**补齐优先级**：P0 补「录」（报单 + 目标录入，不碰钱风险低，且产出干净数据）→ P1「判」的订购建议
→ P2 出库优先级/掉量归因 → P3 接进晨报。🔴 **顺序不能颠倒**：没有「录」的干净数据，「判」只会给出看着像样实则错的建议，比没有更伤信任。

---

## 🔴 「对账」的六环节归属（2026-09-19 评估；全文 `outputs/对账模块存废与AI归属评估-2026-09-19/`）

**触发词**：对账 / 对账工作流 / reconciliation / 银行流水对账 / 厂家对账 / 客户对账 / 差异比对

**核心判据 —— 「对账」不是一个动作，是六个环节，归属各不相同**（别再把它们当一件事讨论）：

| 环节 | 归属 | 判据 |
|---|---|---|
| 1 认列（每列是什么） | 🟢 **AI** | 列名千变万化，是语言问题不是计算问题 |
| 2 定键（按什么匹配） | 🟢 **AI 提议 + 人点头** | 键选错后面全错 ⇒ 不可自动执行 |
| 3 **比对（逐笔找差异）** | 🔴 **确定性代码** | **不能算错的地方**。已有写对的实现 ↓ |
| 4 归因（差异是什么原因） | 🟢 **AI 最该干的活** | 唯一靠算算不出来的；人做要一小时 |
| 5 确认 | 🔴 **人** | 财务责任不可代签 |
| 6 改数（录单/调账） | 🔴 **人**（AI 最多代填草稿） | 与「AI 工具全部只读」铁律一致 |

**划分依据一句话**：**格式识别是"算不出答案的地方"（给 AI）；金额比对是"不能算错的地方"（给代码）；
确认与改数是"责任所在"（给人）。** ⇒ 对账**同时踩「算」与「判」两边**，所以必须拆开归属，不能整体给一边。

### 🔴 最重要的一条：差异比对早已写对，而且只有 40 行

`server/spreadsheet_query.py` → `_run_query(op="match")`：按 key 建索引 → `only_in_a` / `only_in_b` /
`mismatch`（逐 key 双向差集 + 同键金额不符）。**逻辑正确、无 AI 参与。**

⇒ **「比对」本身不难做成系统功能；难的是「把两边数据弄成能比对的样子」（环节 1-2）。**
⇒ 而侧栏那个「对账工作流」**恰恰跳过了 1-2，也跳过了 3，只做了环节 5 的空壳**
（一个输入框 + 一次确认）⇒ **它的失败不在「做成了系统功能」，在「做错了层」。**

### 现有 `/reconciliation` 的实测底账（2026-09-19）

- **全历史 39 次调用，全是 GET**（34× `/customers` + 5× `/customer/2870`，**永远同一个客户**）；
  `customer-match` / `customer-confirm` / 供应商全套 **POST = 0**；`audit_logs` 里对账确认 **0 条**
  ⇒ **从没有一次对账被走完过**（连带该页的催收队列 `/api/collections/*` 有 **514** 次 ⇒ **那一半才是活的**）
- 🔴 **它给出的是错答案**：客户「永辉民发店」同屏两个"系统"数字 —— 界面「系统应收余额」取自
  `receivables` = **¥177,013.73**，而匹配的 `system_total` 取自 `sale_orders − cash_flow` = **¥0**
  （该客户这两张表都空）⇒ **口径错配，差 17.7 万**。这不是「没人用」，是「用了会错」
- 三类场景：客户对账**接口有/无入口**、厂家对账**接口有/界面无入口**、银行流水**完全没有且
  `bank_*` 表全 0 行** ⇒ **真正可用的 0 类**
- 结论：**页面移除；后端接口暂留**（与 `ai_learning` 不同 —— 那次是必崩+零调用+注入洞，这次接口能正常工作，只是被用错地方）；催收队列独立成模块

**给 AI 这条路的底座已就位**：附件通道 `chat_attachment.py`（xlsx/csv/图/PDF + `/query`）✅ +
`op="match"` 算子 ✅ + Hermes 卡片协议 `"type":"reconcile"`（**已定义但从未使用**）⚠️ +
缺 1 个「逐笔应收/应付明细」只读工具（`ai_tools.py` 只有 `tool_ar_aging` 汇总）

---

## 🔴 能力名实对照表（2026-09-27 复核 —— **对外讲 AI 之前必读**）

**判据**：界面/文件名带 `AI` ≠ 调了模型。逐个查 ① 有没有 `call_ai`/`chat_ai` ② 有没有被 import。

| 界面 / 文件 | 名字含 AI | 真调模型 | 判定 |
|---|---|---|---|
| **「AI智能建议」按钮**（`Forecast.vue`） | ✅ | ❌ 前端 `computeSuggestion` 纯配方（安全库存 / 均值 / 趋势外推 / 加权融合）；后端 `routers/forecast_audit.py::audit_period` **通篇零模型调用** | 🔴 **名不副实** ⇒ **v301 已正名为「补货建议」**（代码已改，**未部署**） |
| **`ai_advice_log` 23 条**（`tenant_1`） | ❌ 表名无 AI | ❌ **由大模型产出的 = 0 条** | 🔴 **不能当 AI 产出来讲** —— 构成见下 |
| `ai_tools.py` 的 11 个工具 | ✅ | ❌ 纯 SQL + 阈值 | ⚠️ **不是名不副实**（`ai_` 指「服务于 AI」，它是 AI 的手脚）—— 但**对外仍禁提「11 个 AI 工具」**：原因不是假，是会误导 |
| `ai_insight_llm.py` 经营洞察 | ✅ | ✅ 真调（跨表因果） | ✅ |
| `ai_insights.py` 每日晨报 | ✅ | ✅ 真调 | ✅ |
| `ai_product_fill.py` 商品补全 | ✅ | ✅ 本地规则优先、模糊才调 | ✅ |
| 副驾问答 / 经营卡片 | ✅ | ✅ 真调 | ✅ |

### 🔴 `ai_advice_log` 的真身（v301 实测 · **讲「AI 产出」之前必须先 GROUP BY**）

那张表**共 23 条**，按 `ai_source` / `task_type` 拆开是这样：

| `ai_source` | `task_type` | 条数 | 是不是 AI |
|---|---|---|---|
| `miniprogram:forecast` | `forecast_submit` | **19** | ❌ 小程序**报单提交时按规则算出的**分拨建议，只是走了同一条留痕通道 |
| （空串） | `order_review` | 2 | ❌ 同上 |
| `workflow:loss` | `loss_calc` | 1 | ❌ 工作流提示 |
| `workflow:payroll` | `payroll_calc` | 1 | ❌ 工作流提示 |

⇒ **由大模型产出的：0 条**。且 `status='pending'` 有 **21 条**、`decision` 非空仅 **2 条** ⇒ **没有一条被真正执行过**。
**真正的「模型真在用」证据在副驾会话（会话数 / 消息条数），不在这张表里。**

🔴 **一般化判据**：**表格的标签 ≠ 数据的构成。** 对外讲任何一个「产出量」之前，
**先按来源列一次 GROUP BY** —— **先去数它，再决定怎么叫它**。
`ai_` 前缀是**标签**，`GROUP BY ai_source` 才是**事实**。**改口径救不了错标签。**

**两处「自己都不一致」（可直接被追问，务必先修）**：
1. 「AI智能建议」**按钮**叫 AI，而**同一功能的列头**叫「**配方建议**」（`lblMap` 的 `suggest: '配方建议'`）。
2. `forecast_audit.py` 的 docstring 写着「纯只读（**AI 只建议**…）」，实现里却没有任何模型调用
   —— **注释口径 ≠ 代码行为**的又一实例。

**处置顺序（不能颠倒）**：① 按钮已正名为「**补货建议**」（v301，代码已改未部署）→ ② 再谈对外宣传；
③ 对外只讲「内嵌 AI 引擎」，**不讲引擎品牌**（Hermes 是第三方，当前 v0.19.0）；
④ 唯一真正该讲的 AI 卖点是这两条：**「AI 是生产关系」**（一个人 + AI 做出 **1,349** 个唯一接口 / **367** 张表）
＋ **「AI 的能力边界可以被工程管住」**（租户 AI 收进独立系统账号、跨租户库打不开）。
⚠️ 数字口径：**接口 1,349 = 按「方法+路径」去重**（装饰器计数 1,445）；**页面 22 = 副驾端含 component 的路由**（ERP 端另有 102 模块，不对外）。

**顺带一条现成的可信度资产**：`forecast_audit.py` 已有 `_sales_freshness`（v265），
系统**已经**在算「这份建议依据的销量有多旧」；且前端在未连接 ERP 时有一段诚实提示
（`Forecast.vue`：「未连接时建议量缺少数据支撑、仅供参考」）。

🔥 ✅ **v301 已执行（P0-2「数据依据常显」）—— 关键发现值得记**：
`_sales_freshness` **总是**返回读数（`max_date` / `days_stale` / `window_start` / `window_end` / `level`），
是**前端** `auditStale`（`level !== 'fresh' ? f : null`）在 fresh 档把它丢掉
⇒ **数据新鲜时反而看不到依据** —— 诚实的产品应当**始终**说明依据。
改法：`auditStale` → **`auditFresh`**，**新鲜与否只决定配色、不决定是否渲染**；
读数仍取自后端**同一份**、前端**不重算**（避免「同一事实两份实现」）。新增 `.audit-fresh-ok`（中性色）。
🔴 **一般化判据**：凡「只在异常时才显示的解释」都值得反过来问一句 ——
**正常态下用户看不看得到依据？** 看不到，就是把"别吵"做过了头。

---

## 🔴 `MEDIA:<绝对路径>` = 第 6 种协议标记，但**没有"统一剥离"**（2026-09-28 v306）

**与上面 5 种围栏的本质区别**：`cards|card|clarify|proposal|reminder` 是**给前端看的控制信号**，
剥掉就完；`MEDIA:` 是**「请把这个文件发给用户」的交付指令** —— 剥掉等于**丢文件**。
⇒ 所以它**不能**进 `stripAllFences()`，必须**由渠道适配器各自消费**。

### 🔴 铁律：同一份回复，**两个渠道的 MEDIA 处理完全不同**

| 渠道 | 落点 | 行为 |
| --- | --- | --- |
| **企微** | `gateway/platforms/weixin.py::send_message`（~1851–1900） | `extract_media()` 摘标记 → `filter_media_delivery_paths()` → `_deliver_media()` → `send_document()` **真上传** ⇒ 客户端拿真附件 |
| **Web 副驾** | `gateway/platforms/api_server.py::_resolve_media_to_data_urls`（589 起） | **只认图片**（`_MEDIA_IMG_EXT = {.png,.jpg,.jpeg,.gif,.webp,.bmp}`），`suffix not in …→ return None` ⇒ 非图片**原样退回**；该渠道**本无任何文件下载路由** |

⇒ **症状 = 气泡里裸着 `MEDIA:/opt/…`**。⚠️ 见到此类症状**先问「是哪个渠道」**，
别去查 `media_id`/`access_token`/鉴权/跨域/文件类型 —— **全都是错的方向**（v306 结论：与这些全无关，
且**不调用企微任何服务端接口 ⇒ 无需企微权限与凭证**）。

### 修法（v306 已落地，判据可复用）

1. **后端补通道**（唯一真缺口）：`routers/ai_assist.py` 新增 `GET /api/ai/media`，
   `_MEDIA_ROOTS=("output","media")` ＋ 纯函数 `_media_path_allowed(raw, home)`
   （`realpath` + `commonpath` 双判 ⇒ 同时挡 `../` 穿越与**符号链接逃逸**）。
   `FileResponse(filename=…)` 让中文名自动走 `filename*=utf-8''…`（不乱码）。
   🔴 **准入要一起改**：`server.py::rbac_middleware` 必须把 `/api/ai/media` 与既有 `/api/ai/sessions`、
   `/api/ai/search-chat` 并列**豁免模块判定** —— 否则无 `chat` 权限的角色看到卡片却 403
   = 「点得动但打不开」，**比不给卡更糟**（认证仍由 `_get_user` ＋ 端点内 `_auth` 兜底）。
2. **前端把标记变卡片**：`utils/md.js::splitMedia()` → `{text, files:[{path,name}]}`，
   判据与 Hermes 的 `MEDIA_TAG_CLEANUP_RE` **对齐**（锚定绝对路径 ＋ 已知扩展名，
   否则模型在正文里**提到** `MEDIA:` 也会被误摘），含**流式半截收尾**与去重。
3. 🔴 **卡片必须走模板渲染，绝不能塞进 markdown HTML** —— `v-html` ＋ `<style scoped>` 编译成
   `.md table[data-v-…]` ⇒ 注入的 DOM **拿不到** scoped 样式（复用 `.cp-art-file` 类名在模板里写）。

### 落地状态（v306 ／ v306b，均已上线）

- **后端**：扁平布局 `/opt/hergent-erp/`，md5 `d8023421…`/`a7b2f58d…`，备份 `*.bak-v306-20260928_153616`。
- **前端三轮**：① 全量版（15:55，暴露空壳卡片）② **摘除版**（15:59，`index-D2ohw4_-.js`/`Shell-lZFC-FXN.js`）
  ③ **下载修复版（当前线上，16:15）** `index-DvMm-2ep.js`/`Shell-9VFgLDdi.js`，
  备份 `index.html.bak-v306b-20260928_161553`；公网入口实取一致、双侧 md5 3/3。
- 🔴 **判夹带的方法**：chunk 名**什么都判不了**（hash 级联）⇒ 用「**可视串 ＋ 逻辑名**」比对本地构建产物
  vs 从 `https://hergent.cn/assets/` 实拉的**现役** chunk（⚠️ 现役 Shell 名不在 `index.html` 里，
  要去**入口 chunk** 里 grep；`Server-*.js` 之类容易与 `ArchiveShell-*.js` **子串误匹配**）。
  且**必须再核「入口是否活着」**（`v-if="false"` 只藏 DOM、组件仍被打包 ⇒ 只看串会**误报**）。
- 判夹带时**别信 401/403** —— RBAC 中间件在**路由匹配之前**返回，对「路由存不存在」零判别力；
  必须用**有权限角色**（`demo-login` 的 boss）探 ⇒ `/api/collections/aging` 等 5 个接口在生产是 **404**。

### 🔴🔴 v306b：卡片**能显示 ≠ 能下载** —— 裸 `<a href>` 不带鉴权头（老板原话「无法从网站上提取文件」）

**症状**：文件卡显示正常、文件名**完全正确**，一点就进 Chrome 下载记录并失败：「无法从网站上提取文件」。
**接口本身是好的**（带 token `curl` = 200 / 45,452 字节，与磁盘 md5 逐字节一致）。

**根因**：本仓鉴权 = `Authorization: Bearer`（token 存 localStorage，**不是 cookie**）。
裸 `<a href>` 是**普通链接跳转** ⇒ **不带这个头** ⇒ 端点回 **401（JSON）** ⇒ Chrome 中断下载。
⇒ 正解 = `fetch(带头) → blob → objectURL → a.download → click`（本仓既有范式：
`pages/Workbench.vue::downloadWeeklyDocx`、`api/modules.js` 的模板下载）。
**落点**：`CopilotDrawer.vue` 新增 `downloadAuthed(url, name)`；气泡文件卡 ＋ **产物栏附件卡**
（`/api/chat-attachment/download/:id`，同一个坑，带 token 实测存在但匿名必 401）都改走它。

**四个极具迷惑性的点**（写进判据，别再被骗）：
1. 🔴 **`:download` 属性会自己提供文件名** ⇒ 下载记录里文件名**完全正确**，只瞄名字会以为端点通了。
   **判据必须是响应状态码**，不是文件名对不对。
2. 🔴 **`revokeObjectURL` 不能紧跟 `click()` 同步执行** —— Chrome 还没读完 blob 就撤销，会报出
   **一模一样**的「无法从网站上提取文件」⇒ 修好 401 又换回一个长得相同的故障（本仓多处这么写；
   新代码一律延后 10 秒）。
3. 🔴 **探针里「页面内 `fetch` 带 token」≠「用户点一下」** —— v306 第一版探针正是这么验的，
   200 / 45,452 字节**全绿**却漏掉真缺陷。**凡「点了会发生什么」的验收，一律 `locator.click()`。**
4. ⚠️ **导航型下载不上报页面 Network 域** ⇒ 挂 `page` 的 `response` 监听得到**空数组**（像是请求没发）。
   要抓就挂 `ctx.on('response')` ＋ `ctx.on('page', p => attach(p))`（缺陷版卡片带 `target="_blank"`，
   请求发生在**新页面**里）。

**验收读数（模板）**：反例 `failure='canceled'` ＋ 裸链请求 **401**；正例 `failure=null` / **45,452 字节**
/ 落盘文件名吻合 / 请求头含 `authorization` + `x-tenant-id`；该条消息**两个**文件各自 200 且
**md5 与服务器磁盘逐字节一致**；回归件（纯文本 markdown 表格/列表）仍正常渲染、失败请求 = 无。

---

## 🔴 「AI 团队」角色**到底是什么**（2026-09-29 代码级核对 —— 谈"角色/团队"之前必读）

**一句话**：今天的角色 = **人格提示词前缀 + 署名头像 + 推送落点**，仅此三者；**不是权限、不是能力、不是上下文**。

**切一个角色实际只动三处**（`pickRole()` 全文只有 `setAiRole()` + 关菜单两行）：
1. `CopilotDrawer.vue:87-88` 助手头像渲染读的是 **`currentRole`** ⇒ ⚠️ **全部历史回复被追溯性改写**（切谁，历史就都变成谁的）；
2. `send()` 里 `sys = currentRole.system_prompt` ⇒ 只影响**下一条**消息；
3. `pushRoleReply(role_id)` → `ai_role_channels` ⇒ 回复推到该角色绑定的 IM 渠道（**"团队"目前唯一有实体支撑的含义**）。

**切换时一个都不动**：对话内容（`chat.messages` 原样）、`aiGuard`（只给建议/可执行是**另一个独立开关**）、
会话归属（`saveCurrentSession` 只存 messages+updated_at，**不存角色**）、后端（请求体**无 role_id**；
`copilot_proxy.py` 只认 messages 里的 `role:'user'/'system'`）。

**字段天花板**：`ai_roles` = `name / system_prompt / opening / avatar / built_in / is_active / sort_order / custom_avatar`
（`server/ai_roles.py:100`）—— **无** 技能 / 工具 / 模型 / 数据范围 / 权限 任何一列；也无 `ai_role_skills` 类表。
`opening` 只当**菜单副标题**显示（`CopilotDrawer.vue:381`），不产生行为。

**四条易犯的误判（判据/红线）**：
- 🔴 **角色 ≠ 权限**。真边界是**用户的** RBAC 模块权限 + `ai_mode`(readonly/disabled)。把"切到会计"当"看不到财务以外"是危险误解。
- 🔴 **system prompt 会被上文压过**：上下文是几十条具体内容，人格只是开头一句 ⇒ 延续会话里"切了像没切"是**必然**，不是 bug。
- 🔴 **历史署名必须快照**（`m.roleId`），不能按 `currentRole` 渲染 —— 否则切角色 = 改写历史署名（多人与审计场景直接失真）。
- 🔴 **要让角色当能力边界，必须后端按 role_id 裁剪**（现 system 由**前端拼**、后端不知角色 ⇒ 前端一改即越权）。

**补齐清单（分层，详见 `outputs/AI团队角色切换-设计评估-2026-09-29.md`）**：
L0 立刻正确 = 消息级 roleId 快照 / 切换插入分隔卡+`opening` 当开场白 / 输入框常驻"将由 X 回答" chip；
L1 上下文语义 = 切换时二选一「新开/继续」+ 继续时 system 显式声明"上文由他人回答，勿沿用其口径"；
L2 真差别 = `ai_roles` 扩 `skills/tools/model/data_scope/guard` + **后端裁剪** + 角色权限 ∩ 用户权限(fail-closed) + per-role 审计配额。
**战略含义**：角色字段设计 = 「行业 skill pack + 数据范围 + 渠道」的**打包单位**；不补则"AI 团队"永远停在头像切换器，
而它占的 UI 位置（会话级配置）反而在**承诺**它做不到的事。
