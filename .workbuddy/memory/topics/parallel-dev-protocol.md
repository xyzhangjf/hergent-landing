# 并行开发协议（总控基准）

**适用**：Hergent 多仓库、多 AI 会话同时开发。
**目的**：在「提速」与「不互相踩、不污染生产」之间取平衡。
**一句话法则**：**按缝切分**（每人独占自己的文件树）+ **门口串行**（提交与部署同一时刻只准一人）。

---

## 〇、仓库与风险分级

| 仓库 | 本地路径 | 生产 | 并行风险 | 说明 |
|---|---|---|---|---|
| laozhangai-product | ~/Documents/laozhangai-product | — | 🟢 低 | Hermes 引擎 + 技能 + 本记忆库，与业务代码解耦 |
| hergent-cn-v2 | ~/Documents/laozhangai-product/hergent-cn-v2 | /opt/hergent-cn-v2 | 🟡 中 | Vue3 单页，**构建 all-or-nothing** |
| hergent-erp | ~/Documents/hergent-erp | /opt/hergent-erp (:8700) | 🔴 高 | 后端 + 旧前端，共享热区 |
| forecast-order-miniprogram | ~/Documents/laozhangai-product/forecast-order-miniprogram-20260812T023419087Z | 微信平台 | 🟢 低* | 独立小程序代码，但**嵌套在 laozhangai-product 工作树内**（非独立 git 仓） |

> 最安全的高并行区 = **跨仓库**（laozhangai-product / miniprogram）。最危险区 = hergent-erp 与 hergent-cn-v2 的**共享热文件**。
>
> 🔴 **嵌套仓陷阱（实测）**：`forecast-order-miniprogram-*` 与 `hergent-industry-skills/*` **都位于 `laozhangai-product` 工作树内部**，并非独立 git 仓。因此 laozhangai-product 表面「🟢 低」是假象——若 Hermes 技能任务与小程序任务同时并行，二者共享同一工作树与同一 git 索引，`git add .` / 普通 commit **会互相卷走对方改动**。这两路之间仍要 scoped commit，且小程序那路提交时应显式排除 `hergent-industry-skills/`。

---

## 一、文件 ownership 总控表（必填，开工前更新）

每条并行任务先占一行，明确「谁动哪些文件」。两份任务若落到**同一文件** → 必须串行或重切。

| 任务/会话 | 仓库 | 独占文件/模块（glob） | 碰共享热文件？ | 状态 |
|---|---|---|---|---|
| ① 自研进销存后端 | hergent-erp | `server/routers/inventory.py`、`purchase.py`、`stock_freeze.py`、`stock_lock.py` + 新表/模型 + 迁移脚本 | **是** — 能力注册表（`server/core.py` 或 perms 表，v380 闸门）+ 11 个共享接口若改需谨慎 | 进行中 |
| ② 返利前端 | hergent-cn-v2 | `src/pages/Rebate.vue`、`src/components/rebate/*` | 否（独立页面+组件，不碰 router/store 主干） | 进行中 |
| ③ 小程序报单 | laozhangai-product/forecast-order-miniprogram-* | `miniprogram/pages/fill/*`、`miniprogram/pages/**`、`app.json`、`project.config.json` | 否（独立代码）⚠️ 但**嵌套在 laozhangai-product 工作树内**，提交 laozhangai-product 时勿 `git add .` | 进行中 |
| ④ Hermes 技能/副驾 | laozhangai-product/hergent-industry-skills | `hergent-industry-skills/hergent-milk-{forecast,rebate,commission,expiry}/**` | 否 ⚠️ 同③，嵌套仓，与小程序任务共享工作树 → 两路之间也需 scoped commit | 进行中 |

> **共享热文件清单（任何人改前必须先在本表登记，否则视为冲突）**：
> `hergent-erp/server/server.py`、`hergent-erp/server/core.py`、`hergent-erp/server/routers/platform.py`、
> `hergent-cn-v2/src/router/*`、`hergent-cn-v2/src/store/*`、`hergent-cn-v2/vite.config.js`、集中式 `configs.js` 等。
> 谁动了没登记的热文件 = 谁制造了潜在夹带/回滚。
>
> 📌 **第一轮并行的真实边界**：① 与 ② 分属不同仓库（erp vs cn-v2），可真并行；③ 与 ④ 同处 laozhangai-product 工作树，只能做到「任务并行、提交串行」。前端 ② 因 Vite 单页 all-or-nothing，同一时刻只开一个写会话。

---

## 二、起号（版本号）规程 —— 沿用现有号表

号 = **全局共享序列**，当前已用到 **v459**（v449 即为跨两仓改动：hergent-erp 后端 5 文件 + hergent-cn-v2 前端 13 文件），下一可用 **v460**。起号前必做「三连搜」+ **落盘即登记**：

1. 读 `topics/version-history.md` 尾部**登记表**；
2. 实搜未提交文件 + 两仓 `git log --all` + `git worktree list` + `tools/` 目录（号表常滞后于现实）；
3. 确认未占 → **立即**在登记表追加一行（带后缀消歧，如 `v449-进销存采购`）；
4. 才动笔。
> 撞号不单方面重编：先做消歧 + 登记，交老板拍板唯一性（后落盘者改号，并一次改齐日志/工具/备份目录所有位置）。

---

## 三、提交纪律（scoped commit，绝不 `git add .`）

共享脏工作区里 `git` 分不清「我的」和「别人的」。提交只用受控手法：
- **后端**：取**生产净版**写索引（`git update-index --cacheinfo`），不 `git add` 工作区版；
- 或用**临时索引**（`GIT_INDEX_FILE=/tmp/idx`）只加自己的文件，提交后复位共享索引，避免把别人暂存/改动一起提交；
- **提交前必跑可达性审计**：新增 import 的目标是否入库、引用的符号是否在 HEAD 存在（`py_compile`/`node --check` 都不报这种「检出即炸」的坏提交）。

---

## 四、部署排队约定（串行窗口，最高风险点）

**同一时刻只允许一个会话触碰生产。** 流程：

1. **占窗口**：在群/日志喊「我在部署 vXXX」，别人这一刻不开 rsync；
2. **前端先判夹带**：用 `git archive HEAD` 干净树构建（v413 手法，工作区零污染），或跑 `scripts/pss-check.py`；构建前查 `src/` mtime 晚于生产 `index.html` mtime 的文件是否**只有我改的**；
3. **后端用文件级 diff**：只 scp 自己的 hunk，上传后特征串自证（如 `grep -c subprocess`）；
4. **验收四条**：① 生产 `index.html` md5 == 本地；② 引用 chunk 同名；③ 关键 chunk 字节数一致；④ 真机探针 `console_errors == 0`；
5. **释放窗口**：日志写明「谁 / v几 / 含了谁的东西（若有，须披露）」。

> 前端 Vite 单页**无法只上我这一块**：谁最后 build 谁包含所有人源码。故前端写会话同一时刻建议只开一个；若并行，每次 build 必过 §四② 夹带判据，且被接管上线后做**独立复验**（`md5sum -c` 单向全量比，强于「交集一致」）。

---

## 五、红牌停手信号（任一出现 → 先问，别硬绕）

- 我要改的文件里，别人在途改动**已在线上的生效批次**（隔离 = 回滚别人已上线功能，比夹带更狠）；
- `src/` / 源码 mtime 晚于生产、且不全是我改的；
- 准备 `git stash` / `git checkout -- <file>` 去「我的改动」做对照 → **禁止**（会顺手拿走别人的）；
- 两个任务的 ownership 落在同一文件；
- 改长文档/配置前 `wc -l` 与 HEAD 核数不一致（工作区被静默回退）。

---

## 六、什么时候**不要**并行

- 两任务要动同一文件（router 主文件、`configs.js`）→ 串；
- 一个写接口、另一个立刻消费且没先定契约 → 先定契约（endpoint / 参数 / 返回结构）再并；
- 你没精力同时审 N 份产物 → 并行 = review 量 ×N，反而慢。

---

## 七、专职部署者（唯一串行闸门）+ 交付单队列

**核心思路**：开发会话只管改 + scoped commit + 自测；**全系统只有部署者碰生产**。但部署者只是「半个解」——夹带/回滚发生在**构建与提交**环节，部署者管不到；必须配合 §7.4 两条铁律，否则它只是个高级 `rsync` 包装器。

### 7.1 角色分工

| 角色 | 做什么 | 不做什么 |
|---|---|---|
| 开发会话 ①②③④ | 按 §一 ownership 表改自己文件；**scoped commit** 到 feature 分支；自测（harness / 探针） | 不碰生产、不 rsync、不合 release、不 `git add .` |
| **部署者（专职）** | 收各路「交付单 + v号」→ 合 release → `git archive HEAD` 干净树构建 → 部署 → md5 + 真机探针验收 → 写释放日志 | 不擅自加任何"顺手"文件、不从脏工作树构建、不替业务验收、不并行处理两单 |

### 7.2 开发会话 → 部署者 交付单模板（必填，缺项部署者退单）

```
【交付单】v___ - <一句话标题>
- 交付会话：① 进销存后端 / ② 返利前端 / ③ 小程序 / ④ Hermes 技能
- 仓库：hergent-erp | hergent-cn-v2 | laozhangai-product(嵌套：注明 miniprogram 或 hergent-industry-skills)
- 版本号：v___（已落盘登记于 topics/version-history.md？是/否）
- 本批上线文件（glob，逐项列，部署者只动这些）：
    - path/to/file_a.py
    - path/to/file_b.vue
- 触碰共享热文件：是/否（若是，列明：server/core.py 能力注册 等）
- 类型：后端 scp | 前端 build+rsync | 纯文档 | 小程序上传
- 自测结论：harness X/Y PASS / 探针 X PASS / 仅文档无代码
- 业务验收：已自验 / 待老板确认（部署者不替你做业务验收）
- 部署者需执行：scp 清单 + 备份 + md5 自证 + 探针 / vite build --outDir dist-v___ + rsync 并集 + 双侧 md5
- 已知风险/备注：
```

> 交付单是部署者与开发会话的**唯一契约**。没填「本批上线文件」或「版本号未登记」→ 部署者直接退单，不处理。

### 7.3 队列流程（同一时刻只处理一单）

1. 开发会话：scoped commit 完成 + 自测过 → **填 §7.2 交付单** → 丢进部署队列（群/日志末尾追加一行 `⏳ v___ <标题> @会话X`）；
2. 部署者：按队列顺序取单，**先核对**——① v号已在号表登记？② 清单文件与 `git status` 一致（无夹带未交付文件）？③ 触碰热文件是否已在本表 §一 登记？任一不过 → 退单；
3. 构建：前端**必须** `git archive HEAD` 干净树（工作区零污染，结构上不可能夹带）；后端文件级 scp；
4. 验收四条（§四④）：生产 md5 == 本地 / 引用 chunk 同名 / 关键 chunk 字节数一致 / 真机探针 `console_errors == 0`；
5. 释放：日志写「谁 / v几 / 含了谁的东西（若有，须披露）/ 备份路径」，并把队列行改 `✅ v___`。

### 7.4 部署者两条铁律（违反 = 夹带/回滚回来）

- **🔴 铁律 A —— 构建从干净提交，不从脏工作树**：前端永远 `git archive HEAD` 后构建，**绝不** `vite build` 当前脏工作树。开发会话未提交的在途改动，构建产物绝不可能含它。
- **🔴 铁律 B —— 只部署"被点名交付"的文件**：严格按交付单 glob 操作，**绝不 `git add .` / 绝不 scp 整目录**。嵌套仓（laozhangai-product）尤其：交付小程序时显式排除 `hergent-industry-skills/`；交付 Hermes 技能时显式排除 `forecast-order-miniprogram-*`。

> 没有 A+B，部署者 = 瓶颈 + 仍夹带。有 A+B，它才是真正的「唯一串行闸门」。

### 7.5 交付单示例（可直接抄）

```
【交付单】v450 - 进销存采购单字段补全
- 交付会话：① 进销存后端
- 仓库：hergent-erp
- 版本号：v450（已登记）
- 本批上线文件：
    - server/routers/purchase.py
    - server/db/queries/purchase.py
- 触碰共享热文件：否
- 类型：后端 scp
- 自测结论：v450-purchase-harness.py 24/0 PASS
- 业务验收：已自验
- 部署者需执行：scp 上述 2 文件 + cp -p 备份 + md5 自证 + 生产 curl 校验
- 已知风险：无
```

### 7.6 共享热文件被并行会话「污染」时，怎么只交自己那一份（实战配方 · v451）

场景：`server/erp_db.py` 是高频共享热文件。开工时工作区里**已经**有别人未提交的 hunk
（v451 实测：`role_user_counts`，事后被对方重构进新文件 `server/perm_guard.py`，故它从 erp_db.py 消失
**属有意为之、非悬空引用** —— 遇到"我的文件里怎么少了/多了东西"先查是不是别人的重构，别急着回补）。
🔴 **整文件 scp / 整文件 `git add` 都会把对方未上线的代码带上生产或写进历史** —— 这就是「夹带」。

三步配方：

1. **先判定基线**：`git show HEAD:<file> | md5` × 生产 md5 × 工作区 md5 三者对比。
   本例「生产 == HEAD ≠ 工作区」⇒ 生产干净、我的改动全在工作区、且**混了别人的**。
   （若「工作区 == HEAD」说明我的改动已提交；若「生产 ≠ HEAD」说明别人已抢先部署，先问再动。）
2. **构造「HEAD + 仅我的 hunk」干净副本** —— **不要手改工作区**，那会毁掉对方的在途改动：
   用脚本把外来块整段剔除，再用 `git diff --no-index --numstat <HEAD版> <干净版>` 校验增删数
   与「工作区总增删 − 外来块增删」**分毫不差**（本例 412−65 = **347** / 64）。
3. **只暂存干净 blob**（关键一步）：
   ```bash
   B=$(git hash-object -w /tmp/clean/erp_db.py)
   git update-index --cacheinfo 100644,$B,server/erp_db.py
   git add <其余纯属自己的文件>          # 绝不 git add .
   git diff --cached --numstat          # 逐文件核对增删数，再 commit
   ```
   效果：提交里只有自己那份；**工作区里对方的改动一行没动**（提交后 `git status` 仍显示对方文件 modified）。

### 7.7 前端「有没有夹带 / 有没有反向夹带」的唯一硬判据 = **入口 chunk 等价性**

- 构建必须来自**干净树**：`git worktree add --detach /tmp/build HEAD`，把自己的文件拷进去再 build
  —— 绝不在脏工作区 build（脏 build 会把别人未提交的前端一起打进产物）。
- 🔴 **「生产 assets 文件清单比对」是不可用判据**：部署管线是 `rsync` 且**从无 `--delete`**
  ⇒ `assets/` 是**累积目录**（实测 4411 个文件，同一个组件的 5 个历史 hash 版本都在）。
- ✅ 可用判据：**纯 HEAD 构建的入口 chunk 文件名 == 生产 `index.html` 引用的入口 chunk**。
  入口 chunk 内嵌「路由 → 各页面 chunk 文件名」全图映射（实测入口里能 `grep` 到 `Settings-`），
  hash 相等 ⇒ 整张图相等 ⇒ **同时**排除夹带（带上别人的）与反向夹带（覆盖掉已上线的）。
- 交付后复核「我的功能是否仍在线」时，要**在"线上入口实际引用的那些 chunk 里"**逐个 grep 特征串，
  **不是**在 `assets/` 全目录里 grep —— 并行会话可能在你部署之后又发一版（v451 实测：入口被对方
  换成新构建，但新构建引用的 chunk 里我的特征串齐全 ⇒ 功能仍在线，这一条才说明问题）。

---

**参考**：`hergent-parallel-session-safety` 技能（完整判据与配方）、`topics/version-history.md`（号表）、`topics/deploy-ops.md`（部署运维）。
