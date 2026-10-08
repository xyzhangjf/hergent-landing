# Hergent 项目交接文档（2026-10-08 更新）

> 本文件是**接手人的第一入口**：产品现状、代码位置、部署真相、数据库拓扑、核心功能地图、踩坑记录、待办清单。
>
> **规范类内容不在本文件**（一份内容只有一个家）：
> · 前端开发规范 → `hergent-cn-v2/CLAUDE.md`
> · UI / 视觉 / 布局 / 深色 / 用户可见文案 → `hergent-cn-v2/docs/UI-SPEC.md`
> · 产品级 SOP（立项 / 评审 / 上线）→ `.workbuddy/SOP/PRODUCT-DEVELOPMENT-SOP.md`
> · 跨仓库长期记忆 → `.workbuddy/memory/MEMORY.md`
>
> **本次更新（2026-10-08）四件事**：
> ① 产品定位扩为「**AI 经营副驾 + 自研进销存**」（v380 能力闸门 → v391/v392 八页已上线，默认只 boss 可见）；
> ② **修正两处危险的部署指令** —— 原本文档写的 `rsync --delete` 会删掉生产 **3561 个历史 chunk** 与服务器侧回滚目录（见 §三 3.2 红线）；
> ③ 全文数字改为**生产实测值**（旧版的「13 页面 / 小程序 4 页 / `tenant_1..N` / 13 commit 未推」**全部过期**）；
> ④ 桌面版（Electron）规范整份归档至 `docs/archive/CLAUDE-desktop-20261008.md`，根 `CLAUDE.md` 改为薄路由页。

---

## 一、产品现状（一句话）

**Hergent = 低温奶经销商的「AI 经营副驾 + 自研进销存」（B2B SaaS）**；Web 版 `hergent.cn` 为主产品，预报订单小程序为移动端补充，桌面版（Electron）已冻结。

- **AI 层（护城河）**：AI 副驾 + 六条经营引擎（预报订货 / 货损 / 工资 / 对账催收 / 指标达成 / 返利），行业经验固化成 Hermes Skills。
- **交易层（v380 起的第二条腿）**：自研进销存（采购 / 销售 / 调拨 / 库存 / 往来账），先 boss 用（dogfood）跑顺再对外卖。**这是新能力，不是旧 order CRUD 的解冻**。
- **门槛机制**：走既有的 capability-based 访问控制，新能力 `inventory` **默认只 boss 持有** —— 前端隐藏 + 深链被守卫拦 + 后端 403，三重闸门；卖客户 = 给目标租户"开能力"，不改代码。

## 二、代码位置（两套独立代码，勿混）

| 部分 | 位置 | 说明 |
|------|------|------|
| **Web 前端（主）** | `~/Documents/laozhangai-product/hergent-cn-v2/` | Vue3 SFC + Vite + Pinia；**39 个 `.vue`**（`src/pages/` 顶层 30 + `src/pages/inventory/` 9）；分支 `main` |
| **后端（主）** | `~/Documents/hergent-erp/server/` | FastAPI + SQLite；`routers/` **102 个 `.py`**；分支 `upgrade/v84-international` |
| **预报小程序** | `laozhangai-product/forecast-order-miniprogram-20260812T023419087Z/miniprogram/` | 原生微信小程序（**`pages/` 10 个**：fill / forgot / legal / login / messages / mine / no-permission / password / privacy-settings / summary） |
| 桌面版（**冻结**） | `laozhangai-product/desktop-app/` | Electron「AI 员工操控电脑」，**已暂缓、非主产品**；规范归档在 `docs/archive/CLAUDE-desktop-20261008.md` |
| 行业技能 | `laozhangai-product/hergent-industry-skills/` | 4 个行业技能的源（部署到生产 Hermes） |
| 旧前端（遗留） | `hergent-erp/static/` | vanilla JS IIFE 前端，已被 `hergent-cn-v2` 取代；仍保留在 `/opt/hergent-erp/static/` |
| 记忆 / 工具 | `laozhangai-product/.workbuddy/` | `memory/`（日更 + 长期 + topics）、`tools/`（探针与护栏脚本）、`SOP/` |

## 三、生产部署真相（必读，血泪教训）

- **生产**：`hergent.cn`（Web 主产品）+ `erp.hergent.cn`（同源后端 API）。nginx 配置 `/etc/nginx/sites-enabled/hergent`：`root /opt/hergent-cn-v2;`、`/api/` → `127.0.0.1:8700`、`/hermes/` → `127.0.0.1:18765`（注入 Bearer key）。
- **登录服务器**：`ssh -i ~/.ssh/id_ed25519 root@47.113.224.140`
  ⚠️ 服务器**没有 sqlite3 CLI**，查库一律用 `python3 -c` 或 `ssh ... 'python3 -' <<'PY' ... PY`。

### 3.1 后端部署（`server/` → `/opt/hergent-erp/`，扁平化 flatten）

```bash
rsync -a --no-owner --no-group --exclude=static --exclude=__pycache__ \
  --exclude='*.pyc' --exclude='*.db' --exclude='*.db-wal' --exclude='*.db-shm' \
  server/ root@47.113.224.140:/opt/hergent-erp/
ssh -i ~/.ssh/id_ed25519 root@47.113.224.140 \
  "chown -R hergent:hergent /opt/hergent-erp && rm -rf __pycache__ && systemctl restart hergent-erp"
```

- 🔴 **致命陷阱**：`server/` 里含**本地开发期 DB 快照**，**rsync 绝不带 `*.db`** —— 否则覆盖生产主库 → `database disk image is malformed` → 全站 500。恢复源 = `/opt/hergent-erp/backups/`。
- ⚠️ `--exclude=static` 是必需的：`/opt/hergent-erp/static/` 是被取代的旧前端 dist，别用仓库里的覆盖。
- **健康自查**（**必须 `--noproxy '*'`** —— localhost 走系统代理会返 000，误判成"后端挂了"）：

  ```bash
  curl -s --noproxy '*' http://127.0.0.1:8700/api/health
  # 2026-10-08 实测：{"status":"ok","python":"3.10.12","db_size_mb":16.52,"disk_free_gb":8.2,"api_count":110}
  ```

  `api_count` = **已注册路由数**（实测 110）。它变化说明有路由被加/被遮蔽；`restart` 后 `sleep 8` 等启动期迁移跑完再判。
- ⚠️ 路径别记错：`/opt/hergent/server/` 是**另一个应用**（非 8700 目标）；`/opt/hergent-erp-prod` 是旧 frappe 部署，可忽略。

### 3.2 前端部署（`hergent-cn-v2/dist/` → `/opt/hergent-cn-v2/`）

```bash
cd hergent-cn-v2
mv dist /tmp/hergent-dist-bak-$(date +%s) && \        # vite 清空 dist 会被 safe-delete 防护拦下，先 mv 走
  npm run build && \                                   # base 已在 vite.config.js 里 = '/'，无需 VITE_BASE
  rsync -a --no-owner --no-group dist/ \
    root@47.113.224.140:/opt/hergent-cn-v2/ && \       # 🔴 绝不加 --delete
  ssh -i ~/.ssh/id_ed25519 root@47.113.224.140 \
    "chown -R hergent:hergent /opt/hergent-cn-v2/"
```

🔴 **`--delete` 绝不能用**（**旧版本文件与 `hergent-cn-v2/CLAUDE.md` §5 都曾这么写，2026-10-08 已修正**）。实测依据：

| 项 | 实测值 |
|---|---|
| 一次干净构建的 `dist/assets/` | **76** 个文件 |
| 生产 `/opt/hergent-cn-v2/assets/` | **3637** 个文件（3365 js + 272 css）/ **166 MB** —— **历次构建的并集** |
| 生产 `/opt/hergent-cn-v2/` 同层的**服务器侧资产** | `backups/`、`_rollback/`、**37 个** `index.html.bak-*` —— **都不在 dist 里** |

⇒ 一旦 `--delete`：**3561 个历史 chunk 立刻被删**（浏览器里缓存的旧 `index.html`、或旧 chunk 的动态 `import()` 当场 404），`_rollback/` 与全部 `index.html` 备份**一并消失**，等于**把回滚手段删掉**。
⇒ 正确姿势 = **增量覆盖、永不删除**。那三个外设目录是**刻意留着的回滚资产**，不是垃圾。

**生效判据（不要凭"我传上去了"）**：

```bash
# ① 看生产 index.html 真正引用哪个入口 chunk
ssh -i ~/.ssh/id_ed25519 root@47.113.224.140 \
  'grep -o "assets/index-[A-Za-z0-9_-]*\.js" /opt/hergent-cn-v2/index.html'
# ② 与本机 dist/index.html 比对；③ 再取该 chunk 的 HTTP 200
curl --noproxy '*' -s -o /dev/null -w '%{http_code}\n' https://hergent.cn/assets/<hash>.js
```

- 实测当前（2026-10-08）：入口 **`assets/index-pU5YidZl.js`**、样式 **`assets/index-DQ1t-4Q1.css`**。
- ⚠️ **chunk 名什么都判不了**：Vite 的 hash 是**两级级联** —— 改任一 chunk ⇒ `__vite__mapDeps` 变 ⇒ 入口与所有 importer 一起改名。只能拿"生产 `index.html` 引用的那一个"当判据，不能拿"我本地生成了 `index-XXX.js`"当判据。
- nginx 纯静态，**改前端不需要 restart**。
- ⚠️ 生产目录里混着 macOS 的 `._*`（AppleDouble）残文件（历史 scp 带上去的），无害，别当有效文件。

## 四、数据库拓扑（2026-10-08 实测）

目录 `/opt/hergent-erp/`：

| 库 | 大小 / 表数 | 作用 |
|---|---|---|
| **`erp.db`（主库）** | 17.3 MB / **323 表** | 认证（`users` / `sessions` / `user_tenants` / `tenants`）、RBAC（`role_permissions`、无独立 `roles` 表）、`contacts`、`datasource_bindings`（数据源凭据，AES 加密）、种子数据。**启动期迁移只在这个库跑** |
| **`tenant_1.db`（真实业务）** | 32.4 MB / **376 表** | 蒙牛低温奶经销商本体（福宝 / 恒滋两个户头） |
| **`tenant_10.db`（演示 / 测试）** | 3.0 MB / **374 表** | 近空：`products` 13、`contacts` 10、`sale_orders` **0** |

> **租户库总共只有 2 个。**（旧文档写 `tenant_1..N`，会让人以为有 8 个。）另有几类独立小库：`bid_radar.db`（招投标）、`knowledge.db`、`dami_memory.db`、`hergent.db`。

**`tenant_1` 关键表实测行数**：

| 表 | 行数 | 表 | 行数 |
|---|---|---|---|
| `sale_order_items` 销售明细 | **142858** | `contacts` 往来单位 | **759** |
| `sale_orders` 销售单 | **22505** | `purchase_orders` 采购单 | 81 |
| `customer_prices` 客户专属价 | 8024 | `inventory` 库存 | 54 |
| `products` 商品 | 473 | `warehouses` 仓库 | 7 |
| `forecast_extra_qty` 加单 | 1936 | `forecast_submissions` 报单 | 86 |
| `forecast_config` 报单配置 | 35 | `forecast_periods` 期次 | 9 |

🔴 **`contacts` 是"往来单位总表"**，用 `type` 区分：`customer` 702 / `supplier` 38 / `employee` 14 / `department` 4 / `internal` 1。
⇒ **不存在独立的 `suppliers` / `employees` 业务表**：供应商档案（v387 上线的档案管理第 7 个页签）读的就是 `contacts where type='supplier'`；员工的"人"同时存在于主库 `users`（登录）与 `contacts.type='employee'`（业务归属）。**跨库 JOIN 会报 `no such table`**（见 §六 踩坑 2）。

### 4.1 Schema 演进的两条纪律

1. 🔴 **新表必须惰性建表兜底**（`_ensure_xxx_tables(db)` + 每个函数开头调用）—— 启动期迁移覆盖的是主库，**老租户库不会自动得到新表**（8-16 真实事故：预报表缺失 → 小程序填报 500，而页面本身正常）。
2. 🔴 **加列别只看主库** —— 租户库靠**启动期 schema 对账**（日志里看 `[schema-sync] … 补列(+N)`）。核对"列到底加没加"要查**租户库**，不是主库。

## 五、核心功能地图（2026-10-08）

### 5.1 侧栏 = **8 项**（1 个直达 + 7 个职能区）

唯一源：`hergent-cn-v2/src/components/Shell.vue` 的 `NAV`。**去掉分组标题**：7 个职能区本身就是归类。

| # | 形态 | 名称 | 区内分列 |
|---|---|---|---|
| ① | **直达** | 经营工作台 `/workbench` | — |
| ② | 职能区 `forecast` | **预报订单管理** | 预报订单（历史期次 / 报单配置 / 商品目标）— **L1 双入口**：左半进列表、右半「＋」新建本期预报 |
| ③ | 职能区 `psi` | **进销存** | 采购（采购单 / 采购退货单）· 销售（自提订单 / 自提退单 / 车销订单 / 车销退单）· 调拨 · 库存（库存查询 / 库存效期补录）· **往来（空 —— 页面还没做）** · 其他（进销存总览） |
| ④ | 职能区 `rebate` | **目标与返利** | 目标（仪表盘 / 目标配置 / 达成填报）· 返利（返利结算 / 结算节奏 / 厂家承诺） |
| ⑤ | 职能区 `acct` | **核算** | 损耗（货损计算工作流 / 货损核算 / 货损填报）· 薪酬（算工资） |
| ⑥ | 职能区 `analytics` | **经营分析** | 经营概览（经营趋势）· 市场情报（招投标雷达） |
| ⑦ | 职能区 `archive` | **档案管理** | 商品相关（商品 / 品牌 / 渠道与价格）· 往来相关（客户 / 供应商）· 组织相关（员工）· 仓储相关（仓库） |
| ⑧ | 职能区 `system` | **系统** | AI 能力（AI 引擎）· 自动化（定时任务）· 系统设置（设置）· 打印（打印模板 / 打印设置 / 打印记录） |

- **手机底部栏** `MNAV_PATHS = ['/workbench', '/forecast', '/rebate']`（三项；抽屉里不再重复出现）。
- ⚠️ 职能区里"条目名"与"「＋」"是**两个入口**：判据分别是 `canSee(path)` 与 `canDo(module,'create')`。
- 🔴 **职能区的可见性不由自己决定**：一级项的 `path` 只是**准入锚点**（拿去问 `canSee`）；`archive` 区**故意不写 `path`** —— 它的 7 个页签各挂不同模块，拿容器 `/archive`（`data` ∧ BIZ_ROLES）当闸门会**藏掉"会计看得见渠道与价格"**这条正确行为。
- 🔴 空列（如"往来"）由 `resolveNavItem` 过滤 ⇒ **界面上不会露出空标题**；页面做好了再往那一列加条目，**不要先把标题立起来**。

### 5.2 「谁看得见哪一页」= `src/constants/pages.js::PAGE_RULES`（**26 条**，唯一真源）

两条轴 + 一条"让位"规则 + 一把硬锁：

- **`module`** —— 后端权限模块（`store.canModule`）。客户可在「设置 › 权限」自助开关 ⇒ 表达"**这个租户用不用得上**"。
- **`roles`** —— 角色硬门槛（`roles.js::roleIn`）。产品内置 ⇒ 表达"**这页天然只给哪几类人**"。`null` = 不按角色收紧。
- **`roleGateOpen` 第 ③ 档（让位）** —— 角色不在名单里，但本租户**真的改过**该角色权限（`custom_roles`）且本行有 `module` 且未被 `lock` ⇒ 改由模块轴单独裁决。这就是老板要的「**用户配置优先**」。
- **`lock: true`** —— 产品硬锁，**连客户配置也放不开**。现有 5 页：`/ai-hub`、`/cron`、`/inventory`、`/roles`、`/settings`。

🔴 **四个消费方共用同一份判据**（侧栏 / 路由守卫 / 命令面板 ⌘⇧K / 页内跳转）：`canSeePage`（入口，`roles ∧ module`）、`pageRoleAllowed`（守卫，**只判角色**、故意不判 module）、`canSee(path)`（便捷壳）。不再各写一份 ⇒ 本项目的两种界面级假象「**假入口**（进得去、被拒）」与「**假封锁**（入口没了、手敲 URL 还能进）」**结构上不可能**再出现。

🔴 **fail-open / fail-closed 分界（纪律，不是疏忽）**：
· **未登记的路径 ⇒ 放行**（漏登记不该让整页锁死）；· **角色空串（未加载）⇒ 放行**（启动竞态不该藏掉老板的菜单）；· **角色非空但未知 ⇒ 收紧**（否则自定义角色名可绕过全部产品内置门槛）。

**按 `cat` 分类现状**：

- **`core`**：`/workbench`、`/dashboard`
  🔴 `/workbench` **绝不能**挂 `module:'dashboard'` —— `staff` 的模块里没有 dashboard，挂了就是"员工登录后首页被藏"，而 `/` 的 redirect 与登录跳转都指向它 ⇒ 白屏。
- **`biz`**（`BIZ_ROLES = admin / boss / accountant / sales / supervisor`）：`/forecast`（`module:'forecast'`，名单 = 后端 `SUMMARY_ROLES`，有 AST 护栏逐项比对）、`/rebate`（`module:'sales'`）、`/loss`（`stock`）、`/loss-accounting`（`loss`）、`/data-fill`（`stock`）、`/archive` + 7 页签（employees→`hr` / customers→`crm` / brands·products·suppliers→`data` / warehouses→`stock` / prices→`null`+窄名单）、`/payroll`（**只挂 module、不挂 roles** —— 契约是"会计能不能算工资由各租户在权限页自行授予"）、`/bid-radar`（`bid`）
- **`admin`**（`ADMIN_ROLES = admin / boss`）：`/price-channels`（旧路径，已 redirect）、`/archive/prices`、`/connect`、`/ai-hub`🔒、`/cron`🔒、`/inventory`🔒、`/roles`🔒、`/settings`🔒、`/print`、`/zhoupu-import`

⚠️ **`/settings` 故意不挂 module**（真实坑）：`_ALL_MODULES` 里有 `settings`，但 `_PATH_MODULE_MAP` 里**没有任何接口归它**（**幽灵模块**），而老板的 `_DEFAULT_PERMS` 里恰好没有 `settings` ⇒ 一旦挂上 `module:'settings'`，**老板自己的「设置」菜单会消失**。

### 5.3 前端路由（`src/router/index.js`）

- 顶层：`/login`；`/` 下挂全部业务路由；`''` → redirect `/workbench`。
- **保留的 redirect**（旧链接 / 书签 / 群里的链接还在用，别删）：`product-target` → `/forecast?tab=target`；`price-channels` → `/archive/prices`。
- **进销存容器** `path:'inventory'` + 8 个子路由：`''`(InvWorkbench) / `purchase` / `purchase/new` / `purchase/:id` / `sale` / `sale/new` / `sale/:id` / `stock`。
  ⚠️ 子路由顺序有约束：`purchase/new` 必须排在 `purchase/:id` 之前，否则"新建"会被当成 id。
- **已撤下、勿再写进功能清单**：`Reconciliation.vue`（对账三步向导，v197 撤下；后端 `/api/reconciliation/*` **保留不删**，留给重做方案做灰度存量入口）、`ForecastApprove.vue`（路由里**零引用**）。

### 5.4 后端关键 router（`hergent-erp/server/routers/`，共 102 个模块）

| 模块 | 作用 |
|------|------|
| `psi.py` | **进销存交易层**（v391 薄壳 15 端点 → v392 八页全链）。🔴 默认只 boss 持有；**唯一不可委派的是收货 `receive`**；403 判据看 `error_code` |
| `inventory.py` | 库存查询 / 批次效期（FEFO：过期批次不可售、无到期日排最后、**不足整体拒绝不部分扣**） |
| `forecast.py` / `forecast_submissions.py` / `forecast_audit.py` | 预报主表 / 小程序报单（员工账号·门店绑定·填报·汇总·审批·转采购）/ 智能审核大脑 |
| `loss_workflow.py`（`/api/loss`）与 `loss_accounting.py`（`/api/loss/accounting`） | 货损**两页**，接口边界**完全分离**（这正是 v349 能把它们拆成两个模块的前提） |
| `rebate_rules.py` | 返利规则 CRUD + 校验 + 冲突检测 + 模拟试算 |
| `collections.py` | 催收跟进引擎（分级提醒、大额升级、承诺/争议/解决闭环） |
| `data.py` | 商品与档案列表 + **模糊匹配**（黑话/别名）+ 别名设置 |
| `ai_skills.py` | Hermes 技能列表代理（读 `.env` 的 HERMES_API_BASE / KEY） |
| `datasources_v2.py` | 数据源 OAuth（金蝶 / 畅捷通）connect·callback·status·disconnect·sync |
| `zhoupu_documents.py` | 舟谱单据导入（`_guard()` 角色名单 + AST 护栏） |
| `print_templates.py` | 打印模板（v395 起页面为占位骨架，入口与 URL 先立住） |
| `core.py` / `server.py` | **RBAC 中枢**：`_DEFAULT_PERMS`（角色→模块）、`_ALL_MODULES`、`MODULE_LABEL`；`server.py::_PATH_MODULE_MAP`（接口前缀→模块） |

### 5.5 预报订单小程序（`miniprogram/pages/`，10 个）

`login`（手机号+密码，首登强制改密）/ `password` / `forgot` / `fill`（填报：门店选择 + 搜索 + 别名匹配 + 加减 + 提交）/ `mine`（我的提交，含左滑删除）/ `summary`（汇总总表：AI 建议对比 + 一键复制）/ `messages` / `no-permission`（角色死路关门页）/ `legal` / `privacy-settings`（协议与撤回同意）。

**业务闭环**：老板在 Web「库存效期补录 / 员工档案」开账号并绑门店 → 员工在小程序登录填报 → 老板在 Web 审批 → 转采购申请。
⚠️ 小程序与 Web 端**共享同一后端**，多个接口被两端共同调用 ⇒ 后端改动必须先确认没有破坏性兼容。

### 5.6 Hermes AI 引擎（生产 **v0.19.0**，2026.7.20）

- systemd **`hermes-gateway.service`**（active），`WorkingDirectory=/root/.hermes`，`ExecStart=/usr/local/bin/hermes gateway run`；api_server 仅监听 loopback `127.0.0.1:18765`，由 nginx `/hermes/` 注入 Bearer key。
- **工具入口**：Hermes 动态发现 `/opt/hergent-erp/erp_db.py` 的函数 —— **新增一个 AI 可调用的能力 = 在该文件加一个薄封装函数**。
- **curator 已激活**（每 7 天自动审阅 agent-created 技能）。
- 模型 `deepseek-v4-flash`；LLM key 在 `/opt/hergent-erp/.env` 的 `DEEPSEEK_API_KEY`（旧 `AI_API_KEY` 已吊销）。
- 前端副驾对话**直连** Hermes SSE（`POST /hermes/v1/chat/completions`），**不走后端二级转发**。

### 5.7 数据源适配器（金蝶云星空 / 畅捷通 T+，2026-08-16 上线）

让 Hergent 对接 OAuth + OpenAPI 型 ERP：多租户隔离、凭据加密、数据真正落到**租户库**并被六引擎消费。

- `datasource_store.py` —— 统一凭据表 `datasource_bindings`（**主库**），`save/load/delete/list_all_bindings`，凭据 AES 加密落库。
- `kingdee_connector.py` / `chanjet_connector.py` —— OAuth 授权 URL、token 交换、状态查询；各对象 mapper。
- `sync_writer.py` —— `sync_source(...)`：内部 `set_tenant_context(tid)` 锁写 `tenant_{id}.db`（**零越权**）；关联解析（先有本地 id，经 `products`/`contacts` 的 `source`/`source_id` 反查）；**幂等 upsert**（库存去重键 `(product_id, warehouse_id, batch_no)`；订单头按 `order_no` UNIQUE，items 走"DELETE 旧 + INSERT 新"）。
- `scheduler.py` —— `_sync_all_datasources()` 复用每分钟 loop，逐租户 `set_tenant_context(tid) → sync_source(ALL_OBJECTS) → finally set_tenant_context(None)`；间隔由 `DATASOURCE_SYNC_INTERVAL` 控制（默认 3600s）；单租户失败 `try/except` 不阻断其他租户。

⚠️ **生产端到端真实 OAuth 同步尚未验证** —— 生产**未配置真实凭据**（`KINGDEE_APP_ID/APP_SECRET` 或 `CHANJET_APP_KEY/SECRET`），只验证了代码路径与 auth 网关（401 = RBAC fail-closed 正确）。本地 `tests/test_tenant_sync_full.py` 15 passed。

## 六、踩坑记录（防重复，逐条都是真事故）

1. **SQLite 默认值必须用 `CURRENT_DATE` / `CURRENT_TIMESTAMP`** —— 写 `date('now')` 报 `default value is not constant`。
2. **租户库没有 `users` 表**（在主库）—— 跨库 JOIN 报 `no such table`；人名等主库数据要在 router 层单独查补。**同理没有 `suppliers` / `employees` 业务表**（在 `contacts.type` 里）。
3. **`sqlite3.Row` 不可赋值**（`r["x"]=1` 报错）—— 遍历时先 `dict(r)`。
4. **新角色必须加进 RBAC**（`core.py::_DEFAULT_PERMS`），否则 403。
   🔴 注意：`_DEFAULT_PERMS` 只管**未被租户库覆盖**的角色 —— **改默认值必须同批迁库**；`perms_for` 缓存**无 TTL** ⇒ 改完必重启。
5. **`urllib` 带 data 时默认 POST** —— 测 PUT 端点必须显式 `method='PUT'`，否则 404 误判。
6. **新表惰性建表兜底**（见 §4.1）；`get_db()` 是**只读语义** —— 写完必须 `db.commit()` 或改用 `get_db_tx()`。
7. **旧前端（`hergent-erp/static/`）规范**：`app.js` 只读不写，新功能走 `js/modules/` 的 IIFE；Vite 构建后 contenthash 自动失效缓存。
   ⚠️ 遗留缺陷：`erp_db` 未 re-export `purchase_order_partial_receive`（**准确名不是 `purchase_order_receive`**）⇒ 旧前端**分批收货**会 500。
8. **微信小程序**：`project.config.json` 的 `appid=touristappid` 可直接导入开发者工具；`app.js` 里 `apiBase` 可切本地调试。
9. **`sync_writer` 多租户写库铁律**：`sync_source()` 内部**必须**先 `set_tenant_context(tid)` 才能写业务表；**绝不**直接写主库 `erp.db`（否则既越权、六引擎又读不到）。越权守卫 `assert_tenant_write_scope(source=...)` 在路由层前置校验。
10. **pytest 跨用例状态污染**：SQLite 连接缓存（`db.connection._sqlite_cache`）+ 模块全局 `DB_PATH/DB_DIR` 会被前序测试改掉 ⇒ 后续 `_reset()` 只删 `tenant_*.db`、主库 test.db 残留 ⇒ 新测试 `total` 全 0。**修复**：`_reset()` 必须先关闭并清空 `_sqlite_cache`/`_sqlite_in_use`，再 **glob 删除 DB_DIR 下所有 `*.db*`（含主库）**，然后 `db.init_db()` 重建。**单跑通过 ≠ 全集通过**，改测试务必跑全集。
11. **`inventory` 表已含 `batch_no` / `expiry_date`** —— 货损引擎按 `product_id` JOIN 读取，T7 直接 upsert 即可，**勿补列**（避免存量租户库 schema 分叉）。
12. 🔴 **`rsync --delete` 会毁掉并集资产**（2026-10-08 发现）—— 生产 `assets/` 是历次构建并集（3637 文件），且同层有服务器侧 `backups/`、`_rollback/`、`index.html.bak-*`。`--delete` 一次删掉 3561 个历史 chunk + 全部回滚资产 ⇒ 老缓存页面 404、无法回滚。**前端部署一律增量覆盖，永不删除**（详见 §3.2）。
13. 🔴 **路由遮蔽**：同一路径**先注册者胜** —— 加字段/加端点前，必须先验证**生效的是哪一份**（否则会出现"代码里有、接口返回里没有"）。
14. 🔴 **`_PATH_MODULE_MAP` 的匹配是"首个 `startswith` 命中即停"** —— 加接口前缀时要注意它会不会被更靠前的规则抢走。
15. 🔴 **部署判据只能看"生产 `index.html` 引用的入口 chunk"** —— Vite 的 hash 是**两级级联**，chunk 名本身什么都判不了（见 §3.2）。
16. 🔴 **文档过期比没有文档更危险**（本文档的降级与重写就是被这件事逼的）——
    · 旧版本文档写 `rsync --delete`（照做会毁生产）；
    · 旧版本写"13 个页面 / 小程序 4 页 / `tenant_1..N` / 13 commit 未推"（实测 39 / 10 / 2 / 68）；
    · 旧版本文档**明文写着生产 Hermes 网关 key**（已在本次改为"见生产 `.env`"）。
    ⇒ **纪律**：交付时必须把"文档说的"与"生产实测的"对齐；不一致就以实测为准并当场改文档。

## 七、待办清单（2026-10-08）

**A. 商业验证（最高优先级）**

- [ ] 找 2-3 个经销商朋友演示产品（真实数据：报单小程序 / 工资 / 应收），验证付费意愿。
- [ ] 生产真实走一遍"小程序填报 → 审批 → 转采购"，留真实 AI 留痕。
- [ ] 产品叙事：六引擎拟人化命名（"6 个 AI 员工"），对齐 Hermes 品牌。

**B. 进销存（自研交易层）**

- [ ] **卖前三关**：① boss 连续自用 3 个月零事故（库存 / 往来账对平）；② 跑通 N 笔真实交易（采购 / 销售 / 退货 / 盘点全覆盖）；③ **数据隔离验证**（其他租户确实看不到 boss 数据）。
- [ ] 补页面：**往来账**（侧栏「往来」列目前是空数组）、报表 / 赠品；车销与退单目前**生产零数据**，能力待补。
- [ ] 旧前端分批收货 500（见 §六 踩坑 7）。

**C. 数据源 / 集成**

- [ ] **生产真实 OAuth 同步验证**：配 `KINGDEE_APP_ID/APP_SECRET` 或 `CHANJET_APP_KEY/SECRET` + 某租户授权回调，跑一遍 inventory / 销售单 / 采购单真实落库，确认六引擎能消费。
- [ ] 对账引擎催收的**消息触达**（企微 / 微信推送）—— 现仅系统内队列，通道未启用。

**D. 仓库与工程卫生**

- [ ] **GitHub 推送**：前端 **68 个 commit 未推**、后端 **11 个 commit 未推**；前端工作区另有 **400 个未跟踪文件**（工具脚本 / 交付产物 / 截图）待归档清理 —— 有专门 SOP，别用 `git stash`、别一把 `git add .`。
- [ ] 生产 `assets/` 已 166 MB / 3637 文件：择机在**保留 `_rollback/` 与 `index.html.bak-*`** 的前提下归档历史 chunk（**不要用 `--delete`**）。
- [ ] 前端样式欠账：`.page-acts`（9 处）、`.page-pager`（3）、`.page-filter`（3）三组重复件上提为全局类（UI-SPEC §8 范式）。
- [ ] 复查是否还有别的文档在教 `rsync --delete`（本轮已修 2 处）。

**E. 已知安全债 / 后端缺陷（待复核后逐项处理）**

- [ ] 🔴 **生产 Hermes 网关 Bearer 密钥以明文存在于「已跟踪」文件中**（2026-10-08 复核：**7 个提交 / HEAD 树 14 个文件**，含 `.workbuddy/artifacts/nginx-hermes-proxy.conf`、多篇 `memory/*.md`、旧 `HANDOFF.md`）。**本仓 remote 指向 GitHub**（`xyzhangjf/hergent-landing`）且当前有 **68 个 commit 未推**。
      2026-09-21 已登记过此债（当时 3 提交 / 9 文件），**规模在增长**。⇒ 建议动作：① 确认远端为 **private**；② **轮换该网关密钥**（比清历史成本低、收益确定）；③ 历史清除须与其它会话协调（会重写 68 个未推提交的父链）。**本轮只做到"新写内容不含该字面"，未做半清**（半清会造成"已修好"的错觉）。
- [ ] 同一族：`Mpsup@1` 测试口令、手机号同样早已入库（见 `.workbuddy/memory/2026-09-21.md` 该条）。
- [ ] 凭据硬编码：`import_zhoupu.py` 口令、`copilot_proxy.py` 网关密钥兜底、`Settings.vue` 用 localStorage 明文存 Hermes Key。
- [ ] `_hpw` 密码哈希受 `ERP_SECRET` 长度约束（占 64 字节）⇒ 密码最长 **8 字符**（需复核是否仍成立）。
- [ ] `_DEFAULT_PERMS` 缺 `supervisor` 角色，需手工补 `role_permissions`（需复核）。

## 八、关键凭据位置（**只写位置，不写值**）

> 🔴 纪律：**生产凭据不写进任何文档 / 不进 Git**。提交前跑一遍凭据扫描。本文档旧版本曾明文写出网关 key，已删除。

- **生产 `.env`**：`/opt/hergent-erp/.env`（`ERP_SECRET` / `DEEPSEEK_API_KEY` / Hermes key），权限 600。
- **本机私密文件**：`~/Documents/企业微信API.docx`（GitHub PAT / 阿里云 AK / 企微 Secret；**部分 PAT 已失效待更新**）。
- **Hermes 网关 key**：由 nginx 注入，**不暴露前端**；取用请登录服务器看 `.env` / nginx 配置。
- **SSH**：`~/.ssh/id_ed25519`（root@47.113.224.140）。

---

*交接人：AI 协作开发（2026-10-08）· 项目记忆见 `.workbuddy/memory/2026-10-08.md`（日更）与 `.workbuddy/memory/MEMORY.md`（长期）*
*规范入口：根 `CLAUDE.md`（路由页）→ `hergent-cn-v2/CLAUDE.md`（前端）、`hergent-cn-v2/docs/UI-SPEC.md`（UI）、`.workbuddy/SOP/PRODUCT-DEVELOPMENT-SOP.md`（产品级）*
