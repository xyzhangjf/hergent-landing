# 后端 · 数据层 / 路由不变量（细节）

> 索引见 `memory/MEMORY.md`。写后端代码前必读。

## 路由与权限
- **新路由必须登记 RBAC**（`server.py _PATH_MODULE_MAP`，未命中 **fail-closed 403**）：
  forecast→data、forecast-audit→stock、rebate-rules→sales、ai→chat、admin→*、platform→hr。
- ⭐ RBAC 权限**权威副本在主库 `erp.db.role_permissions`**（`core._load_perms()` 读它，改后须**重启**刷新进程内 `ROLE_PERMS`）；`tenant_1.db.role_permissions` 是**不参与鉴权的遗留表**（改它无效）。
- 登录错 5 次锁 15 分（详见 `backend-auth.md`）。

## 🔴🔴 同路径路由**按注册顺序遮蔽** ——「本地有这个 `@app.get`」≠「线上它生效」（v317 实证，2026-09-29）

**症状**：前端某个列表**恒空且零报错** —— 接口 200、控制台干净、数据确实存在、渲染代码也对。

**机制**：`server.py` 里 `include_router(...)`（含 `platform_router`，约 **1012 行**）**早于**文件底部用装饰器注册的路由（如 `@app.get("/api/users")` 在 **1522 行**）执行 ⇒ **FastAPI 按注册顺序匹配，先命中即返回**。当 `routers/platform.py` 里也有 `@router.get("/users")`（`prefix="/api"`）时，**同一路径注册两次**，`server.py` 那份是**死路由** —— 🔴 **任何在那里加的字段都不会生效**（v317 就差点白改）。

**生产实测（唯一可靠判据）**：借**运行进程的 env** 导入 `server` 后打印 `app.routes`：
```bash
ssh root@<host> 'cd /opt/hergent-erp && while IFS= read -r -d "" kv; do \
  case "$kv" in ERP_SECRET=*|DEEPSEEK_API_KEY=*|ENV=*) export "$kv";; esac; \
  done < /proc/$(systemctl show -p MainPID --value hergent-erp)/environ && \
  /usr/bin/python3 -c "
import sys; sys.path.insert(0,\".\")
import server
seen={}
for r in server.app.routes:
    p=getattr(r,\"path\",None); m=sorted(getattr(r,\"methods\",None) or [])
    if p and p.startswith(\"/api/users\"):
        ep=getattr(r,\"endpoint\",None)
        seen.setdefault(p,[]).append(\",\".join(m)+\" -> \"+getattr(ep,\"__module__\",\"?\")+\".\"+getattr(ep,\"__name__\",\"?\"))
for p in sorted(seen):
    for v in seen[p]: print(p, v)
"'
```
v317 当时的输出：
```
/api/users GET -> routers.platform.list_users      ← 先注册，胜出
/api/users GET -> server.list_users                ← 后注册，永不执行
/api/users/{uid}/display-name PUT -> server.set_user_display_name   ← 单次注册，可达
```
⚠️ **直接 `import server` 会因缺 `ERP_SECRET` / `DEEPSEEK_API_KEY` 抛 `RuntimeError`** ⇒ 必须从 `/proc/<pid>/environ` 借环境；**只读 `.env` 不够**（未必含全部键）。

**更省事的判据**：带凭证 `curl` 看**返回形状** —— 命中 `routers/platform.py` 那份回 `{"success":true,"data":[…],"total":N}`（`api()` 解包后前端拿到**裸数组**）；**形状与你在改的那份代码对不上 ⇒ 你改的那份没生效**。

**修法两条路**（v317 选 ②）：
1. 在 `routers/platform.py` 就地合并字段（两处实现从此必须同步，易再分叉）；
2. ⭐ **换数据源**（优选）：改用**租户侧**已有端点（如 `/api/report-mappings/refs`）—— 租户上下文天然正确、字段齐、模块归属清晰，且**只在租户库上跑**、体积可控。

**顺带踩到的过期注释**：`routers/platform.py::list_users` 的 docstring 写着「前端无调用方（已 grep 确认）」，该前提在本轮已失效（前端确实在调它）。🔴 **「生产没有 X」／「无人调用 X」都有保质期** —— 引用旧结论前必须回头复核。

**通用纪律**：给某个已有接口**加字段之前**，先确认**线上生效的是哪一份实现**。`grep` 命中 `@app.get(...)` **不能证明它生效**。

## 数据层铁律
- **新增列登记【三处】**：① `_row_to_dict` ② INSERT/UPDATE SQL ③ `update_rule` 局部元组（**漏③静默丢弃**）+ `erp_db.py` 迁移项。
- ⭐ **新表不能只靠 `_safe_migrate`**（只跑当前上下文库）→ ①DDL 顶部常量 ②进 `_ensure_tenant_module_tables()` 的 `ddl_map` ③业务入口首行调懒建表。
- ⭐ **禁止 `except Exception: pass` 吞写入失败** → `logging.getLogger("hergent").warning(...)`。
- ⚠️ 迁移代码 `tdb` 无 row_factory → **禁止 `dict(row)`**，按列下标取值。
- `sqlite3.Row` 勿 `.get()`；同库读写须同一 tenant context；跨租户写主库须 `sqlite3.connect(db.DB_PATH)` 直写。
- ⭐ **`db.product_list()` 默认 `limit=200`**：取全量必须显式传大 limit（`/api/products` 传 `100000`；`/api/products/grid` 曾漏传 → **静默截断 200 条**）。凡「返回全部 X」的接口都要复核 limit。
- 🔴 **`products` 表没有 `price` / `cost` 列**（2026-09-18 实证）：真实列只有 `purchase_price`(进价) / `sale_price`(售价) / `factory_price`(厂价)。任何 `SELECT ... price, cost ... FROM products` 命中即抛 `no such column` 崩。`routers/barcode.py` 的 `lookup_product` 曾因此崩溃（命中商品就 500），已改为 `sale_price AS price, purchase_price AS cost`（响应键名不变）。**写/改 products 的 SELECT 一律认准这三个真实列**，别照变量名猜 `price`/`cost`。

## 品牌数据两套源
- 品牌档案 = `brands` 表（**规范层**）；预报品牌筛选 = `products.brand` 派生（**只取 `is_active=1`**）。
- → 让品牌从筛选消失要**停用商品**，**不是**忽略待审条目。详见 `miniprogram-and-brand-data.md`。

## ⭐ Hermes CLI 子命令不可按 exit code 判成败
`hermes_cli/pairing.py` 等只 print 文案、**恒 exit 0** → 判据只能是 **stdout**（`Approved!` / `not found or expired` / `locked out` / `Revoked access`）。按 rc 判会把「错码」当「成功」。配对细节见 `im-channels-v131.md`。

## 路由 / 表结构 / 数据层三条硬约束
- **新路由必须登记 RBAC**（`server.py _PATH_MODULE_MAP`，未命中 fail-closed 403）。**例外**：路由若挂在 `_PUBLIC_PATHS` 已放行的前缀下（如 `/api/weather/*`），则**整条免鉴权且无需登记** —— 该判定是 `any(path.startswith(p))` **前缀匹配**。⚠️ 仅适用于**公开数据**（天气 / 节假日 / 版本号），业务数据绝不能走这条路。
- ⭐ **`db.product_list()` 默认 `limit=200`** → 取全量必须显式传大 limit（凡「返回全部 X」的接口都要复核）。
- ⭐ 新表须**三处登记**（DDL 常量 / `_ensure_tenant_module_tables()` ddl_map / 业务入口懒建表）；新增列同样三处；**禁止 `except: pass` 吞写入失败**。
- ⭐ **多租户库布局**：`erp.db`=主库（`tenants` 表 subdomain→id），业务数据在 `tenant_<id>.db`。演示租户 = **id 10「张记乳品（演示）」subdomain=`demo`**（`POST /api/auth/demo-login` 取该租户 boss token，前端只读）。做真机验证时**先确认目标数据落在哪个租户库**——演示租户与真实租户的规则/达成完全不同。
- 排查生产库**只读**用 `sqlite3.connect("file:tenant_N.db?mode=ro", uri=True)`（生产无 sqlite3 CLI，用 python3）。
- 🔴 **建租户库有两条路径，语义不同 —— 注册走干净的那条**：
  - ✅ `tenant_db_init(tid)`（`erp_db.py:10537`）：`iterdump` 过滤 `CREATE TABLE/INDEX` → **只复制 schema**（注册 / `platform.onboard` 用这条）。
  - 🔴 `_ensure_tenant_db(tid, path)`（`db/connection.py:76`，由 `set_tenant_context` 在**库文件不存在时**自动触发）：用 `src.backup(dst)` → **连数据一起复制主库**！新「租户库」会拿到主库的 `users`（含 `password_hash`）、`tenants`（含全部客户手机号）、`contacts/products/sale_orders`。
  - 生产物证：`/opt/hergent-erp/tenant_tenant_1.db`（≈10MB，3 个用户哈希 + 7 个租户 + 主库 12 客户/6 商品/8 订单）。文件名暴露**路径拼装缺陷**：`f"tenant_{tenant_id}.db"`，`tenant_id` 为字符串（如 `seed_demo.py:57`）即拼出任意文件。危害：跨租户凭据泄漏 + 客户库丢失时**静默用别人数据填满而不报错**。修法：改为只复制 schema（复用 `tenant_db_init` 写法）。
- 🔴 **`audit_logs` 无 `tenant_id` 列**（`user_name/action/module/ref_id/detail/created_at/prev_hash/current_hash`）→ 审计无法按租户归属；且注册事件**不记 IP/UA**（登录事件记 IP）。**2026-09-12 部分补齐**：注册事件改记进主库 `invite_uses`（公司/手机/租户/账号/IP/UA），但 `audit_logs` 本身仍无 tenant_id。
- 🔴 **`request.client.host` 在生产恒为 `127.0.0.1`**（2026-09-12 修）：`server.py` 的 `uvicorn.run(app, host, port)` 原本**没开 `proxy_headers`** → nginx 虽已 `proxy_set_header X-Forwarded-For $remote_addr`，uvicorn 也不解析。后果：一切「按 IP」的逻辑退化成**全局共用一把锁**（注册限流 10 分钟内只允许全平台注册一次），且 `sessions.ip_address`、审计、注册流水的来源 IP 全是 127.0.0.1、无法追溯。**已开 `proxy_headers=True, forwarded_allow_ips="127.0.0.1"`**（8700 端口 iptables 仅对本机放行，其余 DROP → 外网无法直连伪造 XFF）。
  ⚠️ 排查任何「按 IP 计数/锁定/限流」异常时，**先确认这个开关是开的**，否则会一路往业务代码里找。
- ⚠️ **`register_user_and_tenant()` 会给新租户灌示例数据**：调 `seed_demo_data()` → 新租户库 `contacts`/`products`/`inventory` 各 **15 行**假数据（可乐/洗发水/洗衣液这类通用快消，非低温奶），`users`/`tenants`/`orders` 为 0。与注册后的「上传你的第一份数据激活」引导口径冲突（用户会以为系统里已有数据）。属**产品决策**，2026-09-12 未改。
- ⚠️ **`/api/tenants/{tid}/usage`、`/{tid}/members` 恒 500**：调用了不存在的 `tenant_usage_stats` / `tenant_member_list`；且 members 的增删**只做 `_auth`、无租户归属校验** → 补全函数即成越权面。`/api/tenants` 列表的用量字段也因函数缺失而静默为空。（2026-09-12 未处理）

---

## 🔴 SQLite DDL 三个阶段坑（2026-09-13 全部实证）

### 1. 默认值必须**单引号**，双引号会被当标识符
`created_at TEXT DEFAULT (datetime("now","localtime"))` → SQLite 把 `"now"` 解析成**列名**（不是字符串字面量）→
`default value of column [created_at] is not constant` → **建表直接失败**。
实测：`auto_rules` 因此在生产 8 个库**全部缺失**，`/api/auto-rules` 三个端点恒 500（真功能损失，只是以「每次重启刷一行无名 FAILED」的形式暴露）。
→ **一律 `datetime('now','localtime')`**。同理禁止 `DEFAULT "x"` 写法。

### 2. `_safe_migrate`（单语句）vs `_safe_migrate_script`（多语句）
`safe_migrate` 走 `db.execute()`，**只吃一条语句**。多语句（如一条迁移里 4 个 `ALTER TABLE ADD COLUMN`）会报
`You can only execute one statement at a time` → 整条失败 → **一个列都加不上**（`v107.146_sale_extra` 实测：`customer_po_no`/`promise_date`/`tax_rate`/`tax_amount` 四列全部长期缺失）。
→ 多语句一律 `_safe_migrate_script`。

### 3. 建表时机：模块级迁移是「自上而下」执行的
- `erp_db.py` 按行序执行 → **任何被迁移依赖的表，必须在文件顶部（如 `BRAND_PENDING_DDL` 之后）预建**，不能放进 `_ensure_tenant_module_tables()`（它在第 11000+ 行才被调用，晚于第 1080 行的 v89 迁移 → 迁移 FAILED、唯一索引缺失）。
- 同理**不要在早期 import 的模块里调用后面才定义的函数**：`db/queries/finance.py`（在 `erp_db.py:52` 被导入）调 `init_coa()`（定义在 `erp_db.py:3956`）→ 必然 NameError。**延迟 import 也救不了**（`from erp_db import x` 在部分初始化阶段抛 ImportError）。
- 迁移块用 `db/connection.py::log_migration_warn(err)` 打印告警 —— 它**过滤幂等错误**（duplicate column / already exists），与 `erp_db.py::_migration_log_error` 口径一致。裸 `print("[MIGRATION WARN] ...")` 会被同类迁移的第二份拷贝刷屏（实测每次重启固定 4 行）。

### ⭐ 补租户库表的唯一正确机制 = `master_ddl`
`_ensure_tenant_module_tables()` 从**主库 `sqlite_master` 取 DDL** 再下发给每个 `tenant_*.db` —— **不要另外手写一份 DDL 常量**（会漂移）。
流程：① 先在文件顶部把表建进**主库** ② 把表名加进该函数的**取表清单** ③ 重启后遍历自动补各租户库。
`_is_idempotent_migration_error` 只认 `status='ok'` → 失败的迁移修好后**自动重跑**，无需手工清 `_migrations`。

## 🔴 两个诊断陷阱（别被表面状态误导）
- **`routers/platform.py` 的 `APIRouter(prefix="/api")`，不是 `/api/platform`** → `/api/platform/auto-rules` 恒 **404**；真实路径是 `/api/auto-rules`。查端点先 grep `APIRouter(prefix=`。
- **`_PATH_MODULE_MAP` 在路由匹配之前拦** → 对**根本不存在的路径**也返回 **403**（文案像「你的角色'sales'不能访问'hr'模块'」）。**见 403 不要就此断定端点存在**；404 才是路由层的回答。

## 🔴 租户库建库路径必须同源（2026-09-13 修隔离缺陷，commit `7d5396e`）
- `set_tenant_context()` 在租户库文件**不存在**时会触发 `db/connection.py::_ensure_tenant_db()` 兜底建库。它**原用 `src.backup(dst)`** —— SQLite 的 `backup()` 是**页级整库复制**，连**数据**一起搬 → 新租户诞生第一秒就拥有主库 `users`（含密码哈希）/`sessions`/`invite_codes`/`tenants` 与全部业务行。
- 现改为**委托 `erp_db.tenant_db_init()`**（`iterdump()` 只取 `CREATE` 语句）—— 与注册 / `tenant_create` / `seed_demo` 走的正道同源。**凡出现"第二条建库路径"，一律委托，不要自建第二份 schema 复制实现**（同 `master_ddl` 原则）。索引回填 A2（`_create_indexes_on`，`tenant_db_init` 不负责）与 fail-closed 语义保留。
- 委托用 **lazy import**（`from erp_db import tenant_db_init`）：`erp_db` 顶部即 import `db.connection`，加载期不能反向 import；但该函数只在运行期、文件缺失时才走到，届时 `erp_db` 已加载完。
- ⚠️ **判定"是否泄漏"不能看行数相等**：`tenant_1.db` 的 `users` 也是 6 行（与主库数字巧合）但内容完全不同（它是自己的 admin/boss/accountant/sales/warehouse/driver）。真判据 = 「租户库里出现了**主库专属表**（`tenants`/`users`/`invite_codes`/`platform_admins`）的数据」。
- ⚠️ **测隔离必须先造出"该泄漏的东西"**：scratch 环境没有 `server.py:_init_users()` 建的三张表 → 不手工建 `users`/`sessions`/`invite_codes` 并灌数据，断言会「恒真通过」（表不存在也判 0 行）。

## 🔴 迁移失败日志会自动定位（2026-09-13 起）
`_migration_log_error(e)` 在 `name` 缺省时**自动取调用栈位置**，格式 `函数名 @ 文件:行号`（模块级退化为 `文件:行号`）。本仓 **23 处**裸调用点因此**零改动**获得定位能力 —— 它们多为「函数内联的一次性 DDL」、本就无名，且多数写在**模块级**（`co_name == '<module>'`，拿函数名定位无效）。**不必再手工补名字**，也不必再为定位去写 `sqlite3.connect` 代理钩子（代理钩子只在需要抓"哪条 SQL 抛错"时还用得上）。

## 🔴 gate 的「块首多条 ALTER」会吃掉整块 —— 是真功能损失，不是日志噪音（2026-09-13 修，commit `fac71c6`）
上一轮把 23 处裸迁移块收敛为具名迁移时，有 5 处因含 Python 种子无法转纯 SQL，保留为手工
`if not _migration_applied(_M)` gate（`v131d_attachments_commission_assets` /
`product_contact_ext_fields` / `tax_codes_master_data` / `numbering_field_perms` /
`warehouse_addr_tags`）。它们**每次启动都登记 failed**，真因是：**块首排着多条 ALTER，SQLite
顺序执行时只要一条抛 `duplicate column name` 就中断后续全部语句** → 块尾 `executescript`
建表与种子**永远轮不到**，下次启动又从同一条 ALTER 失败。

> **通用判据：看到 gate/迁移反复 failed，先问「它后面有没有东西被吃掉」，别只当日志问题。**

实测损失：**全新库**上 7 张表（contact_persons / delivery_addresses / product_suppliers /
product_images / product_categories / payment_terms / unit_conversions）+ 5 个列
（products.category_id、contacts.biz_license / status）**根本没建出来**；**生产**上
`fixed_assets` 的 3 个折旧列在 8 个库全缺，而 `asset_create()` 直接 INSERT 这 3 列
→ 租户库新建固定资产必 `no such column` 500。

**修法** = 把 ALTER 从 gate 里拿出来，**每条一个独立具名 `_safe_migrate`**
（命名 `v131d_<scope>_<table>_<col>`）。`_safe_migrate` 把 `duplicate column name` 视为
"目标已达成"直接登记 `ok`，不再重试。拆完若剩余部分已是纯 DDL，直接改 `_safe_migrate_script`。

### ⛔ 拆 gate 必须同时处理「种子回填」这个副作用
gate 一旦转绿，**块尾种子会首次执行**。本次那批种子含 `bank_accounts` 的**伪造账号**
（`6222021234567890` / `wx_hergent` / `ali_hergent`），会灌进 tenant_2/3/4/7/8/10 这 6 个空库 ——
与 `5235e63`「新注册租户不再预置演示数据」直接冲突。
**判据：这批种子是「给新库的默认值」还是「给存量库的回填」？** 前者属建库路径；放进迁移里就是
往存量库回填 → 本次选择**删掉种子、保持现状（零数据写入）**。附带也移除了
`field_permissions` 的「sales 不可见 purchase_price」默认行（同属迁移期回填；若认为新库必须有，
应加进建库路径而非迁移）。

## 🔴 模块级迁移只对主库执行 —— 租户库补列必须单独做（2026-09-13 实证 `fac71c6`）
`erp_db.py` 模块级 `_safe_migrate*` 在 **import 期**执行，那时**无租户上下文**（`get_db()` 返回
主库 `erp.db`）→ 新列只落主库、只记进主库 `_migrations`。租户库的两条路径**都不补列**：
- `tenant_db_init()` 只在**建库时**跑一次（复制主库 schema + `_migrate_v68` +
  `_ensure_rebate_columns` 白名单 + 6 条币种）
- `_ensure_tenant_module_tables()` **只下发「表」、不下发「列」**

**所以「主库补好就完事」是错的。** 必须对每个 `tenant_*.db` 幂等
`ALTER TABLE ... ADD COLUMN`；务必用 `glob('tenant_*.db')` 而不是枚举（历史上存在
`tenant_tenant_1.db` 这类异常命名），并以 `runuser -u hergent -- python3` 跑
（root 跑会把 WAL 副文件属主改成 root → hergent 服务读不了）。
**不要在租户库里伪造迁移登记行** —— 租户库压根不跑这些模块级迁移，登记只是谎。
新租户库无需处理：`tenant_db_init()` 复制主库 schema 已含新列。

## ⭐ 租户库列对账已机制化（2026-09-13，commit `0b5c1d5` / `6817e28`）
上面那个缺口**不再靠手工补**。`_ensure_tenant_module_tables()` 末尾挂了一道**列级对账**：
以**主库 schema 为唯一权威源**（同 `master_ddl` 原则，不写第二份 DDL），遍历每个
`tenant_*.db` 比对列，缺列即幂等 `ALTER TABLE ADD COLUMN`（纯 schema，零数据写入）。

- 三个函数：`_table_columns`（读列定义；用 `table_xinfo` 跳过 generated/hidden 列，旧版回退
  `table_info`）、`_master_column_index`（主库列索引，排除 `_TENANT_COL_SYNC_SKIP`）、
  `_sync_tenant_columns_on`（单库比对 + 补列，返回 `(added, warned)` 供汇总）
- 只做能安全自动化的那部分：**非常量默认值**（如 `(datetime('now','localtime'))`）会被 SQLite
  拒绝 → **降级为不带默认值的 ADD**（列存在 > 默认值一致）；**类型不一致** → 只报不改（须重建表）；
  `NOT NULL` 且无默认值 / 主键列 → 跳过并告警
- `_TENANT_COL_SYNC_SKIP` = **主库专属 + 平台级表，绝不下发**：users / sessions / tenants /
  invite_codes / invite_uses / platform_admins / role_permissions / login_attempts /
  **user_tenants**（成员关系只存主库，`erp_db.py:11507` 有明注）/ _migrations / idempotency_keys
- 日志口径：有补列 → WARNING（明细 + 汇总）；只有类型告警 → 明细 INFO + 汇总 WARNING；
  全干净 → 完全静默。`_SCHEMA_SYNC_REPORTED` 按差异签名去重 —— 该函数**同一次启动内跑两遍**
  （文件中部 + 文件末尾，后者保证 `_align_forecast_schema` 已定义），不去重会连报两行
- 首次部署实测：8 库补 **573 列**（tenant_1 +3；tenant_2/3/4/7/8 各 +114）、启动 **8 秒**、
  schema 对象数 2665→**2665**（ADD COLUMN 不增删对象）、数据行数**逐字一致**、跨进程幂等（补列 0）
- ⚠️ **生产库分层**（改动前必查）：`tenant_1.db` = 主库 id=1「测试企业A」，但**含真实业务数据**
  （430 商品 / 730 客户 / 15539 明细 / 8024 客户价；`admin`/`boss`/`liuxiaoding`/`liushantao` 经 `user_tenants` 归属它。⚠️ **2026-09-26 起**原 `mptest`/`mptestsp` 两个提审账号已删，别再拿它们当归属证据）；
  `tenant_2/3/4/7/8` 是 2026-06-18 建的测试租户、**几乎全空（0~1 行）**；`tenant_10`(demo) 与
  `erp.db` 本就 0 缺列。**别把"库文件存在"当成"有真实数据"。**
- ⚠️ **运维脚本一律用绝对路径**：`file:erp.db?mode=ro` 在 ssh（cwd=`/root`）下会**静默产出
  0 字节空备份**，而 glob 出来的 `tenant_*` 因是绝对路径一切正常 → **只坏主库、极难察觉**。
  判据：备份后**逐库核对大小**（本次 erp.db 0.0MB 当场被抓）。

### 列**类型**不一致 → 重建表（2026-09-13 第六轮，已修 tenant_1）
- 对账函数**只比类型**（`tcols[cname][0]` vs `ctype`，`.strip().upper()`），**不比 notnull/default**
  → 修类型时**只改类型词**即可让告警归零，不必整体对齐主库定义（否则会丢租户库独有列）。
- **判类型方向要看前端代码，不要看数据长相**：`store_area` 实际存着 `'60-100㎡'` 这种区间文本，
  但前端 `static/js/modules/data-form-enhance.js:314` 用 `parseFloat(x||0)||0` 处理它
  → **主库 REAL 才是设计意图**，租户库的 TEXT 是早期 DDL 遗留（后加的 `ALTER ... ADD COLUMN`
  遇 duplicate column 被跳过，类型没跟上）。**"数据里有非数值" ≠ "列该是 TEXT"。**
- SQLite 改列类型**只能重建表**（官方 12 步）。必做：
  `PRAGMA foreign_keys=OFF` + `legacy_alter_table=ON` → `BEGIN IMMEDIATE` →
  `CREATE TABLE x_new`（DDL 由**原字符串精确片段替换**生成，断言每处命中 1 次）→
  `INSERT INTO x_new SELECT * FROM x` → `DROP TABLE x` → `RENAME` → **重建索引与触发器**。
- ⚠️ **`DROP TABLE` 会连带删掉挂在它上面的触发器**（本轮 `contacts` 有 3 个 FTS 触发器 +
  3 个索引，全要先 dump SQL 再原样重建）。
  🔴 **重建后不要用 `INSERT INTO t_fts(t_fts) VALUES('rebuild')` 回灌**：`'rebuild'` **只对
  external-content 表有效**；标准模式（内容存在 FTS5 自带 `_content` 表）下 `rebuild` 跑完
  索引**仍是 0 行且不报错**。正确做法是 `INSERT INTO <fts>(cols) SELECT vals FROM <src>`
  （列映射取自**源表上的 FTS 触发器**）。详见下文「缺表」与技能 `hergent-tenant-schema-sync`。
- **零数据修改的判据 = 行级 md5 逐字不变**（`SELECT * ORDER BY id` → repr 拼接 → md5）：
  SQLite 在 REAL 亲和性列里遇到转不动的 TEXT 会**原样保留**，所以 `'60-100㎡'` 不会被截成 60。
- **触发器要在一致性副本上验**（`sqlite3.backup()` 复制 → INSERT/UPDATE/DELETE 三连测 → 删副本），
  **生产零写入**；再补 `integrity_check` + `foreign_key_check`。改库前**停服务**。
- 备份目录**不能写 `/root`**（脚本以 `hergent` 跑，无权限）→ 写 `/tmp`，或由 root 单独 cp 一份。

### 租户库与主库的差集，共三类（别混为一谈）
| 差集 | 严重度 | 处置 |
|---|---|---|
| **缺列** | 高（必 500） | 已机制化自动补（启动时按主库 schema 对齐） |
| **类型不一致** | 低（SQLite 弱类型） | 只告警，手工重建表（本节） |
| **缺表** | 视表而定 | ✅ **已机制化（2026-09-13，commit `f63bce2`）**：`master_ddl` 由「手工表名清单」改为 **「主库全部业务表 − `_TENANT_TABLE_SYNC_SKIP`」**，模板里 `_ensure_tenant_module_tables()` 只负责余下两张（bpm_* 等）|
- ⭐ **表级对账与列级对账同源**：都以**主库 schema 为唯一权威源**。**凡出现「第二条建库/建表路径」，一律委托权威实现，不自建第二份会漂移的清单**（同 `master_ddl` 原则）。原手工清单的失效模式 = 新表必须记得回来加，否则租户库**永久滞后**（这就是缺表积累的根因）。
- 🔴 **排除集判据有两个必踩的错法**：Python 侧 `"fts" in name` **误伤 `combo_rule_gifts`**（"gi**fts**"）；SQL 侧 `LIKE '%_fts%'` 同样命中 —— **SQLite 的 `_` 是单字符通配符**，要写 `LIKE '%\_fts%' ESCAPE '\'`，或干脆回 Python 判 `"_fts" in name`。建表语句改写失败（`CREATE TABLE IF NOT EXISTS` 替换没命中）要**告警跳过**，不能静默遗漏。
- ⭐ **FTS5 是独立的一挂，必须单独下发**：`products_fts`/`contacts_fts`（+ 源表上的 3 个同步触发器）。
  - 虚表由 `CREATE VIRTUAL TABLE ... USING fts5(...)` 创建，**附带 5 张影子表**（`_data`/`_idx`/`_docsize`/`_config`/`_content`）；**影子表由 FTS5 自动维护、不能手工建**（会损坏索引），虚表语法也**不能改写成 `CREATE TABLE IF NOT EXISTS`**。
  - 🔴 **半损坏态**（虚表不在、影子表残留）→ 直接建虚表报 `fts5: error creating shadow table ... already exists` 并**中断整段**（连触发器与回填一起跳过）。修法：建虚表前 `DROP TABLE IF EXISTS` 5 张影子表，**但只在虚表不存在时做**（虚表在则绝不动影子表，否则毁索引）。
  - 🔴 **存量回填不能用 `'rebuild'`**：`INSERT INTO x_fts(x_fts) VALUES('rebuild')` **只对 external-content 表有效**；标准模式下内容存在 FTS5 自带的 `_content` 表（新建时为空）→ `rebuild` 跑完索引**仍 0 行且不报错**。正确做法 = 从**主库触发器的列映射反推** `INSERT INTO <fts>(cols) SELECT vals FROM <src>`。
  - 🔴 **重复回填**：`*_insert` 与 `*_update` 触发器 body 里是**同一条** `INSERT ... VALUES (NEW...)` → 遍历触发器逐个执行会翻倍（实测源表 3 行 → 索引 6）。**只取 `*_insert`**，且**只在「实际新建虚表」时回填**（否则每次启动重灌）。
- ⭐ **缺 FTS 不会 500，而是「静默退化」**：`global_search` 的 FTS 分支是 `except Exception: pass` → 缺虚表时默默退去走 LIKE 全表扫描。**所以「搜索能出结果」不能当 FTS 正常的证据**；判据只能是 `COUNT(虚表) == COUNT(源表)`。另外 FTS5 默认 `unicode61` 分词器**把中文整词当一个 token**（`蒙*` 命中、`牛*` 不命中），子串靠 LIKE fallback 兜住 —— 别把「搜不到子串」当 FTS 坏。
- 判「缺表」要不要补，先看**这张表是不是主库级**：含 `tenant_id` 且主库有数据
  （`ai_roles`/`ai_usage`/`llm_call_log`/`ai_channel_configs`/`ai_channel_pairings`/`ai_role_channels`/
  `ai_quota`/`datasource_bindings`/`business_source_config`）→ **权威在主库，租户库本就不该有**，缺属正常。
  ⚠️ **不能靠行数相等判「是否主库级」**（`tenant_N.db` 的 `users` 也是 6 行但内容完全不同），要看「租户库里是否出现主库专属表的数据」。
- 实测（2026-09-13 修复后）：生产新建 **12 表 + 2 虚表 + 6 触发器**、**零数据写入**（全部 0 行）；`tenant_10` FTS 由 0 行回填到 **12/10 行**；`/api/search` 由**静默返回空**恢复 **200**；稳态启动 `schema-sync` **0 行**、启动耗时 6s 无退化。
- **孤儿行**：✅ 2026-09-13 已清净（`ai_roles` 20 行 tid 16–20 + `ai_channel_configs` 1 行 tid 9996，全删；13 张含 `tenant_id` 表复查合计 0）。
  🔴 **清完别用 API 验证**：`ai_roles.list_roles(tid)` 内部会 `seed_roles(tid)`（`INSERT OR IGNORE`）→ **访问即自种**，会把孤儿行"种"回来（实测复发一次）。复核一律用**只读 SQL**。这也是孤儿行**复发的机制性根源**。
- 🔴 **孤儿清理脚本别硬编码表名**：动态扫 `PRAGMA table_info` 找含 `tenant_id` 的表；默认 dry-run，`--apply` 才执行。
- 详细可复用流程见技能 **`hergent-tenant-schema-sync`**。


## 🔴🔴 幽灵符号族：`db.<name>` 有一批**根本不存在**（2026-09-15 全量审计 = 104 个）
- **触发**：本轮修工资条时发现 `routers/salary_send.py` 调 `db.hr_employee_get()`，而该函数**全仓没有定义** → 每次发送必 `AttributeError`。名字看起来极其合理，**人眼审不出来**。
- **唯一可靠判据 = AST 扫 `db.<attr>` + `hasattr(erp_db, ...)`**。不要用 grep：
  ① 仓库里 `import erp_db as db` 与 `import db`（顶层 `db` 包）**两种写法并存**，grep 分不清；
  ② `with get_db() as db:` 会把**连接对象**混进 `db.*` → 必须屏蔽 `execute/commit/close/executescript/fetch*` 等方法名。
- **分两类**（判据：全仓递归 `def <name>` 是否存在）：
  - **A 类（12 个）＝有 `def`、但没导出到 `erp_db`** → 修法只需在 `erp_db.py` 加一行 import：
    `funnel_list` · `funnel_get` · `funnel_delete` · `funnel_stats` · `sale_order_cancel` · `get_supplier_price_comparison` · `purchase_order_partial_receive` · `budget_scenario_list` · `budget_vs_actual` · `get_config`(scheduler) · `batch_price_adjust` · `batch_set_active`
  - **B 类（92 个）＝连定义都没有**（写代码时凭空写出的名字）：
    `account_*` · `cockpit_*`(summary/forecast/ar_alert/stock_health/actions) · `tax_filing_*` · `attachment_delete`/`attachment_get_one` · `alert_rule_*`/`alert_acknowledge`/`alert_resolve` · `product_expiring_list` · `document_archive_*`/`document_tag_list`/`document_retention_check` · `blanket_po_*` · `voucher_template_*`（`voucher_engine.py` 与 `erp_db.py` 各有调用） · `subcontract_*` · `merge_*` · `bank_api_*`/`bank_import_list`/`bank_transaction_auto_match` · `get_migration_status` · `get_dimension_tags` · `budget_line_*`/`budget_scenario_create|update` · `payment_run_engine::receivable_pay` · `hermes_core::memory_pattern_*`/`regex_log_hit` · `backup.py::backup_config_get`/`backup_record_offsite` · `alerting.py::alert_history_recent`/`alert_record_fire`
  - 涉及 **23 个文件**（`routers/finance.py` 一个文件占 29 个）。
- **影响面实测**：access.log（有效期 1884 行、`/api/messages` 40 次可对照）里这些端点**全部 0 次** → **从未被调用**。**不是线上事故，是埋着的地雷**：谁点谁 500（且是 500 + 堆栈，不是 404）。
- ⚠️ **`erp_db` 没有 `__getattr__`、没有 `import *`** → 「没导出」就是真没有，不存在惰性转发兜底。
- **修的顺序**：A 类先修（加 import，一行一个，零风险）；B 类先判「这个功能到底要不要做」——
  多数是半成品端点，**该删端点而不是补实现**。
- **审计脚本可复用**（`hasattr` + AST，只读）：见技能 `hergent-capability-reality-audit` 的「幽灵符号审计」一节。

---

## 🔴🔴 `employee_account_map()` 只返回第 1 个员工（2026-09-19，生产已复现）

**病灶**：`erp_db.py:6054` 的 `return out` **缩进 2 个 tab ＝ 落在 `for` 循环体内**
（与 `out.setdefault(...)` 同级）⇒ **首次迭代即返回**，函数最多产出 **1 个员工**的账号映射。

```python
	out = {}
	for r in rows:
		out.setdefault(int(r["emp_id"]), dict(r))
		return out          # ← tabs=2，在循环里
```

**判据（唯一可靠）＝ 打印真实缩进，别只看编辑器渲染**：
```python
for i in range(a-1, b):
    ln = src[i]; print('L%d tabs=%d repr=%r' % (i+1, len(ln)-len(ln.lstrip('\t')), ln[:60]))
```
`out.setdefault` 与 `return out` **同为 tabs=2** 即中招。这类「映射函数被缩进打断」的缺陷
**人眼审不出来**（代码看起来完全合理，`setdefault` 的存在还暗示"会处理多行"）。

**生产只读实证**：主库 `users` 6 行，其中 `id=1 admin→employee_id=1`、`id=2 boss→employee_id=7`；
tenant_1 租户成员 5 个、员工 7 个 ⇒ `employee_account_map()` **命中 2 行、只返回第 1 行**
⇒ **员工 #7「张俊峰」在员工档案显示「未开通」**，尽管 boss 账号正绑着他。

**连带单向门（同族复发）**：`has_account=False`（`erp_db.py:6261`）⇒ 编辑弹窗显示
「**开通账号**」表单而非账号管理区（`EmployeeArchive.vue:159`）⇒ 真去填表被防重拦下
（`erp_db.py:16671`）提示「请在员工档案的账号管理区启用或重置密码」⇒
**而那个区正因 `has_account=False` 才不显示**。
⚠️ 这与 `erp_db.py:6256-6260` 注释里修过的同族缺陷（`has_account` 误写成 `is_active`
导致禁用后单向门）是**同一族的第二种形态** —— 修「单向门」时要一并检查**映射本身是否完整**。

**两个调用点**：
| 调用点 | 后果 |
|---|---|
| `erp_db.py:6244`（`employee_list`） | 最多 1 个员工显示「已开通」，其余全「未开通」 |
| `routers/salary_send.py:245` | 只有第 1 个员工能解析出账号 uid ⇒ 其余人**工资条发不出去** |

🔴 **为什么此前没被发现（重要方法论）**：被**租户收口掩盖**。
`employee_account_map()` 按 `user_tenants` 收口（`erp_db.py:6041`）—— 隔离沙箱租户里
只有 1 个成员 ⇒ 只命中 1 行 ⇒ **上一轮真机探针 24/24 全绿也照不出来**。
⇒ **沙箱验证的天然盲区：凡「按租户成员数决定行数」的逻辑，单成员沙箱恒退化成一行**。
要验这类缺陷，必须让沙箱里**至少有两个可映射成员**（造第二行往期数据同款做法）。

**修复（2026-09-19 已实施并上线）**：`return out` 去缩进到函数体层级（1 行）+ 8 行理由注释。

- 后端 commit **`6d18e88`**；部署**双侧 md5 一致** `dc6d58f0fd5877f66e01bb3fbb1c2bad`，
  `health=200`，启动日志 0 异常；回滚备份 `/root/backup_empaccmap_20260919/erp_db.py`。
  ⚠️ 部署前必须核「生产版 vs 本地版」diff —— 本轮结果恰好是 **`生产 = 本地 − 本轮修复`**，
  才证明不会把分支累积功能带上线（该分支常年领先生产 15+ commit）。
- 回归断言 **`.workbuddy/tools/employee-account-map-regression.py`**（在 `hergent-erp` 仓库）。
  **范式 = AST 提取磁盘上的真函数源码 + 受控命名空间 exec + 临时 sqlite**：
  `erp_db.py` 顶层有 `init_db()`（L12381）且依赖未装的 `cryptography`，**import 即初始化
  本机数据库** ⇒ 不能直接 import；但也不能手抄副本（那等于没测真代码）。折中是 AST 提取。
  11/11（含阴性对照 / 跨租户收口 / 多账号优先级 / `employee_code` 兜底 / tid 空不收口）。
  环境变量 `EMPLOYEE_ACCT_ERPDB=<path>` 可指向任意副本 —— 指向「改回旧缩进」的副本时
  **6/11（5 项 FAIL）**，用来自证断言确有判别力（**断言必须做这一步，否则不知道它有没有牙齿**）。
- 页面真机 **`.workbuddy/tools/employee-account-map-page-verify.js`**，**13/13**：
  列表「账号」列员工 #7 显示「已开通 boss」、「已开通」共 2 行（修复前只会 1 行）；
  点「编辑」进的是**账号管理区**而非「开通账号」表单 ⇒ 上面那个死胡同确已打通。
- **前端零改动** —— `EmployeeArchive.vue` 的渲染分支本来就对，错的是喂给它的数据。

**判据（可复用，比断言本身更重要）**：凡「按 N 行输入产出映射」的函数，断言要写
**`len(结果) == SQL 命中行数`**（用同一 `where` 独立数一遍），**不要写死期望值** ——
写死 `== 2` 会在数据变化时静默失真，且无法逐租户复用。本轮生产只读验证就是用这条
遍历 tenant_1/tenant_10 一次跑完的。


## 🔴 裸 `except:` 收窄：**必须分三类，不能一刀切**（2026-09-23 全仓清零，25 处 / 13 文件）

**先界定「是不是真代码」**：`grep -rn "except\s*:"` 命中不等于缺陷 —— 本轮 30 命中里 **5 行是注释**
（"旧写法是裸 except"的溯源说明）。判别：`awk -F: '{ln=$3; sub(/^[ \t]+/,"",ln); if (substr(ln,1,1)!="#") print}'`。
**注释保持原样**（那是有意留的历史溯源，不是缺陷）。

**三类策略**（判据 = 「被吞掉的到底是什么」）：

| 类 | 判据 | 收窄为 | 为什么 |
|---|---|---|---|
| A 数据解析 | `json.loads` / `await request.json()` / `float()` | `(ValueError, TypeError)` | 这两个异常**完全覆盖**解析失败的全部现实成因（`JSONDecodeError`、`UnicodeDecodeError` 都是 `ValueError` 子类）⇒ 精确且不漏 |
| B DDL 幂等迁移 | `ALTER TABLE ADD COLUMN` 撞已有列 | `sqlite3.OperationalError` | duplicate column 的精确异常；**外层保留 `except Exception` 兜底** ⇒ 收窄不会让导入期炸服务 |
| C 未知操作兜底 | DB 查询 / `zlib` / `_get_user` / redis ping | **只升到 `except Exception` + 补日志** | 见下 |

🔴 **本轮最重要的一条判据**：裸 `except:` 的真实危害**不是"捕获太宽"，而是连 `KeyboardInterrupt`/`SystemExit`
一起吞**（二者继承 `BaseException` 而非 `Exception`）⇒ **最小正确修法就是升到 `except Exception`**。
C 类**刻意不硬猜具体异常**：猜错会把原本"静默降级"（返回空 / 兜底值）变成**"直接 500"**，**制造回归**。
⇒ **只有 A/B 类做精确收窄；C 类只升 Exception + 补留痕**（"静默返回空/兜底值"的 3 处补 `warning`/`debug`）。

**批量修法**（比手工逐处 Edit 更可核验）：脚本按「**文件 + 行号 + 该行 strip 后完全相等**」定位，
① **先全量校验、再落盘**（校验失败则一个文件都不写）；② **按行号降序应用**（否则多行替换会让后续行号漂移
—— 本轮 `reports.py` 的块展开就使 454/464 漂到 456/466）。

**部署前的防夹带审计**（判「哪些 hunk 属于我」之前，**先判「该文件整体是否已上线」**）：
把待上线文件逐个 `ssh cat 生产路径 | diff - 本地文件`；若某文件差异**恰好只有我的 hunk** ⇒ 在途改动**早已在生产**，
不存在夹带。再追加一道过滤：**剔除"不含 except/import 的行"**，剩余若全是自己块展开引入的日志行 ⇒ 零意外内容。

**「生产还有、本地已清零」= 在途未上线**，不是漏修：本轮生产剩 4 处裸 except，正来自本地已修好但未部署的
在途文件 ⇒ 收口必须**以生产为准再看一眼**，否则会误判为"已完成"。
验证口径 = **本地与生产双双 `grep` 归零**（单看一侧都不算数）。

## 报 500 的取证：先看 `finally`，别只看栈顶那一行（v259 实例）

🔴 **Python 中 `finally` 里抛出的异常会**替换** `try` 里的原始异常**（只在 `__context__` 里留指向）。
⇒ 栈指向的那一行常常**不是真正的病根**：v259 排查 `forecast_period_writable` 报 500，栈顶是
`conn.close()` 报 `AttributeError: '_GeneratorContextManager' object has no attribute 'close'`，
看着像 close 的问题；实际是**上一行 `conn = get_db()` 就取错了东西**（拿到上下文管理器而非连接），
`conn.execute()` 在 try 里先炸，close 那个异常把它覆盖了。

**同族病根：`get_db()` 是 `@contextmanager` 生成器**（`db/connection.py`）⇒ **必须 `with` 起来用**。
裸调 `get_db()` 拿到的不是连接。正确写法两种：
- `with get_db() as c: ...`
- 需要"可选自己开连接"时：先 `if db_conn is None: with get_db() as c: return f(..., db_conn=c)`
  （递归把真连接传下去），或 `_cm = get_db(); db = _cm.__enter__()`（仓内既有写法，记得配 `__exit__`）。
⚠️ 全仓裸用处已排查，v259 时**仅 `forecast_period_writable` 一处**是坏的。
⚠️ 波及面：所有**不传 `db_conn`** 的调用方、且 `period_id>0` 时一律 500 —— 实测既有的 `POST /{sid}/recall`
（撤回）就是这样，撤回任何挂期次的单都只吐 "Internal server error"，真正的原因（期次已定稿/已截止）
一次都没到用户面前。**修一个判据函数能同时修好一批接口 ⇒ 遇到 500 先查它属于哪个共用判据。**


---

# §v277 多租户 schema 下发的两个静默洞（2026-09-25）

## 洞一：新建表 ≠ 建好索引 —— 租户库「只下发表、不下发索引」

**机制**：`erp_db.py::_safe_migrate_script(name, sql)` 只把 DDL 落到**主库** `erp.db`；
业务租户库 `tenant_<id>.db` 靠**启动期回放主库 DDL**（`master_ddl`）下发 ——
**只下发表，不下发索引**。索引另有一条通道：`db/indexes.py::INDEX_SQLS` → `_create_indexes_on(每个 tenant_*.db)`。

⇒ **新建表时，索引必须同时登记进 `db/indexes.py::INDEX_SQLS`**，否则：主库有、租户库没有。

**实证（v277）**：`forecast_extra_alloc` 在 `tenant_1/9/10.db` **建表成功**（`sqlite_master` 查得到），
但 `PRAGMA index_list('forecast_extra_alloc')` **返回空**，且全程**零报错**。
唯一性约束（`uq_fea_period_prod_emp`）因此只在主库生效 ⇒ 幂等写入在租户库会**重复插行**。

**验收判据（必须用这条）**：
```sql
SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='<表名>';
```
🔴 **只查「表在不在」会漏** —— 这正是「恒空且零报错」的静默失效族。
逐库跑：`erp.db` + 所有 `tenant_*.db`。

🔴 **同一陷阱的「列」版本（v302 实证：`GET /api/period-close/status` 必崩 500）**：
`erp_db.period_close_status()` 查 `SELECT month,status,closed_at FROM accounting_periods`，
而建表语句 v131d 只有 `month/status/created_at` ⇒ **对所有租户 100% 崩**（不是偶发）。
两层坑：① `SELECT 1 FROM t LIMIT 1` 这类守卫**只验表、不验列**，挡不住列缺失；
② 守卫句被**单独**包在 try 里、而**真正会崩的 SELECT 在 try 之外** ⇒ 守卫一次都没起作用，异常直接 500。
⇒ 修法 = 把**整段查询**纳入 try，且失败记 **warning**（原先记 `debug` = 把真实故障吞成静默失效）。

🔴 **修「查了不存在的列」之前，先判该列本该不该有**（补列 vs 改 SQL 的分水岭）：
查**有没有写入方 + 有没有消费方**。两者皆无 ⇒ **改 SQL 去掉**（补一个恒为空的列 = 造假字段）；
有写入方 ⇒ 补列并登记启动期对账。v302 判据：全仓零写入方（`set_accounting_period` 只写 `month,status`）
＋ 前端零引用 ⇒ 改 SQL；关账状态本就由 `status` 表达，真正的结转事实另在 `period_closures` 表。

## 洞二：窗口当主键 —— `save_matrix` 写一套窗口、`GET /extra-alloc` 读另一套

**机制**：
- `forecast_submissions.py::save_matrix` 把加/减单分配明细按**请求体里的** `start` / `end` 落 `forecast_extra_alloc`
- `product_targets.py::GET /extra-alloc` 按 `_period_or_400(period_id)` 取到的**期次自身** `order_start` / `order_end` 读

⇒ 两者的窗口一旦不一致：**保存返回成功、读取返回空、零报错**，且表里留下两套窗口的重复行。
**触发条件很日常**：只要有人改过期次的 `order_end`（例如为规避 `scheduler._auto_period_close`
把 `order_end` 设成非今天的值），历史分配行立刻"消失"。

**本轮处置（v277 当时）**：仅**验收侧规避**（探针的 `START/END` 动态取自期次自身窗口），未改代码。

### ✅ 已修：v279（2026-09-26）落地方案 A —— 归属键 → `period_id`

老板 2026-09-26 拍板「**选 A**」，已上线（4 文件 · FLAT · 双侧 md5 全等；E2E 36/36）。

**改动四处，缺一不可**（口径必须**全都**统一到期次自身，漏一处就还是两套尺子）：

| 处 | 改法 |
|---|---|
| 表 | `ALTER TABLE forecast_extra_alloc ADD COLUMN period_id INTEGER NOT NULL DEFAULT 0` |
| 唯一索引 | DROP `uq_fea_period_prod_emp` / `idx_fea_period`，建 `uq_fea_periodid_prod_emp` UNIQUE(`period_id`,`product_id`,`employee_id`) |
| 写 | `DELETE FROM forecast_extra_alloc WHERE period_id=?` + `INSERT` 带 `period_id` |
| 读 | `GET /extra-alloc` 按 `period_id=?` 读（不再算窗口） |
| 通知 | `event_key = 'forecast_extra_alloc\|<period_id>\|<product_id>'`（原按窗口拼） |
| 算 | `plan_extra_allocs()` 开头**锚定期次**：`SELECT order_start,order_end FROM forecast_periods WHERE id=?` 覆盖传入窗口 |

**🔴 DDL 落法（两个易错点）**：

1. `ADD COLUMN` 必须**单独走 `_safe_migrate()`**（单语句），**不能并进 `_safe_migrate_script()`**：
   `executescript` 中任一语句抛错会**中断后续所有语句**，而 `ALTER TABLE ADD COLUMN`
   是所有语句里**唯一不幂等**的那条（重复执行 = `duplicate column name`）。
   单独走才能让 `_is_idempotent_migration_error()` 把它记成 `"ok"`、不误告警。
2. **DROP 旧唯一索引必须写进 `db/indexes.py::INDEX_SQLS`**，不能只放进一次性迁移 ——
   `INDEX_SQLS` 是**唯一**覆盖全部 `tenant_*.db` 的通道（见「洞一」）。
   旧索引留着会与新键**两套约束并存**：同一窗口挂两个期次时，旧键会**误拒新键允许的行**。

**验收里最值钱的一条**（证明归属真的不随窗口漂）：

> 改期次 `order_end` A→C 之后 ——
> 按**当前**期次窗口查 = **0 行**（= v277 当时 `GET` 读到的结果，复现了旧病）
> 按**落库时**窗口查 = 仍 3 行；按 **`period_id`** 查 = 仍 3 行；HTTP 仍回 3 行；
> **改窗口前后落库数据逐字节相同**。

**为什么不用方案 B**：B 只是让**写**也去取期次窗口，把两把尺子合成一把 ——
但「窗口当键」的脆弱性还在（窗口仍是主键，改窗口仍会孤立旧行）。A 把**属性**降回属性。

**通用教训**：**同一个逻辑集合，写入键与读取键必须是同一个稳定标识。**
拿「可变的属性」当键 ⇒ 属性一改，历史行成孤儿，而**全程零报错**。

**迁移负担实测**：生产 4 库 `forecast_extra_alloc` 均为 `COUNT(*)=0` ⇒ 存量迁移负担为**零**。

## 🔴🔴 幽灵 inode：删除/替换库文件 + 连接缓存（2026-09-26 亲历，最贵的一个坑）

**现象链**（排查近一整轮，每一层单独看都"正常"）：
- 沙箱库里 `products.order_unit='提'`，API 却回「**包**」
- 改成 `unit='袋'` 后**接口纹丝不动**
- `/product-targets/products` 也回「包」
- API **读得到**目标（`id=3, created_by=mptestsp`），但**把所有磁盘库扫一遍都查不到 `id=3`**

**根因**：`db/connection.py::_sqlite_connect()` 按 `(threading.get_ident(), db_path)` 缓存连接
（`_sqlite_cache`）。在**服务运行中** `os.remove()` 掉库文件并重建同名文件 ⇒
缓存里的 Connection 仍指向**已被删除的旧 inode** ⇒ **写入落进幽灵文件、读取返回旧数据**。

**🔴 判据陷阱（这条是整轮最贵的认知）**：

```python
conn.execute("SELECT 1")      # 对「已被删除文件」的句柄 —— 照样成功！
```
⇒ **`SELECT 1` 验证不了 inode 是否被切换通**。任何「跑一句 SQL 看看通不通」的自证都不成立。

**铁律**：
> **维护期删除 / 替换任何库文件（尤其 `tenant_<id>.db` 的销毁重建），必须先删文件、再 `systemctl restart`，
> 用重启清 `_sqlite_cache`。**
> 顺序不能反：先重启再删 ⇒ 重启后的新连接照样会在删文件后变成幽灵。

**通用排查序（「库读是 X、API 回 Y」时照这个走）**：

1. 先排除**路由遮蔽** —— 是不是有两份同名路由 / 两份同名函数（`grep` 端点装饰器）；
2. 再**直调底层函数**，证明逻辑本身对（本轮：直调 `_arc_map` 打印 `order_unit_sql` 的返回值、
   `unit_display_map(75, arc)`、`unit_value(75,'提',...)` ⇒ 逻辑全对）；
3. 逻辑对 ⇒ 必然是**运行进程读到了别的文件** ⇒ 扫全部 db 候选（**含子目录 `db/tenant_1.db`、
   `incident_*`、`.hermes/`**）；
4. 都扫不到 ⇒ 就是**句柄级问题** ⇒ **重启验证**（重启后立刻恢复 = 确诊）。

⚠️ **扫描脚本别用裸 `except: pass`** —— 它会把「表不存在」也静默吃掉，看起来像「扫过了、没有」。
⚠️ 这条也解释了另一件事：**「生产库文件被删了但服务还活着、还能读写」**不是奇迹，是幽灵 inode。

## 附：写事务互锁（v277 再次踩到）

`get_db_tx()` 持写事务期间，**另开连接读同一个 SQLite 文件会互锁**。
⇒ 只算不写的准备阶段（`plan_extra_allocs`：读 `product_targets` / `product_target_alloc` / 本期报单）
必须放在**事务外（之前）**；通知类副作用（`_notify_extra_allocs`）必须放在**提交后**。

## 附：白名单漏字段 = 静默不写

`db/queries/products.py` 的 `product_update` / `product_create` 有一份**字段白名单**。
🔴 v277 实测：同组的 `large_unit` / `medium_unit` / `medium_ratio` 都在，**唯独漏了 `large_ratio`**
⇒ 用户在前端填的换算比**静默不写、也不报错**（前端 toast 成功、后端无异常、库里没变）。
**排查手法**：改字段写不进去时，不要先查前端 —— 先看这张白名单有没有该字段；
「同族字段齐了、单独少一个」是最典型的形态。

## 🔴 附：影子库 / 沙盒验收 —— **DB_PATH 有两份**（v289 真踩进生产）

**症状**：验收脚本宣称"跑在影子库上、零写入生产"，但其中一条**写操作**没反映到影子库
（另一条读操作却正常）—— 说明**读写走了不同的库**。

**根因**：本项目取"主库"的入口**不止一个**，且各自持有**独立的 DB_PATH 变量**：

| 入口 | 读的是哪份 DB_PATH |
|---|---|
| `core._master_db()` → `db.sqlite3.connect(db.DB_PATH)` | `erp_db.DB_PATH` |
| `erp_db.get_db()` → `_connect()` → `_sqlite_connect()` | **`db/connection.py:11` 自己那份** |
| `erp_db._open_master()`（v288 加） | `erp_db.DB_PATH` |
| 租户上下文 | `_tenant_db.get()`（另有一套，指向 `tenant_<id>.db`） |

⇒ 只 patch `erp_db.DB_PATH`：**认证**（走 `_master_db`）读到影子 ✅，**写库**（走 `get_db`）
仍落生产 🔴。v289 因此把生产上**提审账号 `mptestsp` 的密码**真的改掉了。

**正确姿势（缺一不可）**
```python
erp_db.DB_PATH = SHADOW          # core._master_db() 用
import db.connection as _dbc
_dbc.DB_PATH = SHADOW            # get_db() / _sqlite_connect() 用  ← 最容易漏
```
**跑前自证**（不通过就 `exit(2)`，宁可不验也不能污染生产）：
```python
with erp_db.get_db() as c:
    main = {r[1]: r[2] for r in c.execute("PRAGMA database_list")}["main"]
    assert os.path.realpath(main) == os.path.realpath(SHADOW)
m = erp_db._open_master()
assert os.path.realpath({r[1]: r[2] for r in m.execute("PRAGMA database_list")}["main"]) \
       == os.path.realpath(SHADOW)
```

**判「有没有真写生产」的判据（mtime 会骗人）**
- ❌ **不能只看主库文件 mtime**：WAL 模式下改动先进 `-wal`，主文件 mtime 可能不动（v289 就被它骗过）。
- ✅ **用内容判据**：拿**生产代码**反查"我这次用过的那个值"是否生效 ——
  如 `core._verify_password("我用的那个密码", 生产库里的 hash)` ⇒ True 就说明真写进去了。
- ✅ 顺手核对**行数/清单**：探针账号、探针会话有没有出现在生产库。

**善后模板**：`cp erp.db backups/<tag>/` → 用权威函数写回原值 → 用**只读**方式自证
（`_verify_password` 正例 True / 反例 False）→ 只读复查全库影响面 → 删影子目录。

---

# §v310 导入双管线 + 「`hasattr` 扫不到」的一类缺陷（2026-09-28）

## 洞一：舟谱导出若走通用导入管线 = **静默 0 行**

**判据（看两处即知是不是舟谱导出）**：
① 文件**首行是标题**（「采购明细报表」「收入单明细表」），第 2 行「导出时间：…」，
第 3–4 行是**筛选条件块**（条件名 + 取值两行），**真表头在第 5 行**；
② `xl/worksheets/sheet1.xml` 里的 `<dimension ref="A1"/>` **与实际列数严重不符**。

实测三个真实舟谱导出文件（**正反对照**）：

| 读取方式 | 采购明细 | 收入明细 | 费用明细 |
|---|---|---|---|
| `read_only=True` | max_row=**1** | **1** | **1** |
| `read_only=False` | **1140** | **20** | **240** |
| 丢失 | 1139 | 19 | 239 |

而 **`routers/import_router.py` 里 5 处读表全部 `read_only=True`**（全仓 15 处全是）⇒
这类文件在它眼里「只有一列一个格子」⇒ **「成功返回 0 行」且零报错**。

**正解**：走 `routers/zhoupu_documents.py` —— 它第 59 行已写明并处理：
> `· 读舟谱导出`**必须** `ws.reset_dimensions()`：它写的 `<dimension>` 是错的，
> openpyxl `read_only=True` 时 `max_column` 会恒为 1，表现为「这个表只有一列」。

**新增一种「舟谱导出形态」** = `SPECS` 加一条（`fields`/`required`/`sheet`）+ `do_import()` 加一个落库分支。
`detect_file` / `bind_columns` / `iter_rows` / `RefIndex` / 单号切块 / 后台任务 / 回执 **全部复用**。
⚠️ 新增 `SPECS` 的 `sheet` 名必须与既有互不相同（实测 5 个 sheet 名天然不同，可靠）；
`required` 必须选**区分度高**的列，否则形态之间互相误判。

**探针（必须两侧都跑，别只看一侧）**：
`for m in (True, False): load_workbook(p, read_only=m).worksheets[0].max_row`
—— 两侧不一致 ⇒ 该文件必须走 `zhoupu_documents`。

## 洞二：`hasattr` 审计**结构上扫不到**「名字存在但签名/函数体错」

- **A 类 · 已知幽灵符号族**：`db.income_order_create` / `income_order_list` / `income_category_list`
  **未导出到 `erp_db`**（`routers/finance.py` 调用）。本轮用同一判据复现：

  ```
  erp_db.py 模块级绑定名 1163 个；`db.<attr>` 去重 960 个；erp_db 未绑定 = 101 个
  routers/finance.py 占 29 个   ← 与 2026-09-15 登记的「29 个」读数一字不差 ⇒ 扫描有效、问题在册
  ```
  ⇒ **处置照在册结论**：半成品端点**该删不该补**；导入管线要落库就**在 `db/queries/` 新增函数**（绕过路由）。

- **B 类 · `hasattr` 通过但调不通（本轮新发现）**：`expense_order_create`
  ① 定义 **8 个形参** vs `routers/finance.py:579/589` 传 **15 个实参**
  ⇒ `TypeError: takes from 3 to 8 positional arguments but 15 were given`；
  ② 函数体内 `cur.lastrowid` 的 **`cur` 从未赋值** ⇒ 参数对齐后 `type='customer'/'supplier'` 仍 `NameError`。

  🔴 **教训**：`hasattr` 只回答「名字在不在」，**回答不了「能不能调通」**。必须补两只探针：
  - **正反对照 arity 探针**：`f(*([0]*15))` 应 `TypeError`；`f(*([0]*8))` 应抛**非 TypeError**
    （证明 arity 通过、已进函数体）—— 两侧都跑才有判别力；
  - **AST 扫未绑定名**：函数体内 `Store` 集合 − `Load` 集合（`cur` 就是这么找出来的）。
  - 现有 `tools/undefined-call-scan.py` 是**未绑定名**扫描器，但它**指向了 `laozhangai-product` 仓**，
    扫不到 `hergent-erp/server`；且 `db.<attr>` 那一族要用 **AST + `erp_db` 绑定名差集**（见 `v310i2-ghost-static.py`）。

## 🔴 连带事实：「有表、有页面」≠「能写入」

`erp.db` / `tenant_1.db` / `tenant_2.db` **三套库**里 `income_orders` 与 `expense_orders` **全部 0 行**。
⇒ 判「某功能到底能不能用」，**读行数比读代码快**；`created_at` 为空/表恒 0 行 = 写入路径从未成功过。

## 🔴 权限矩阵三张表 + 一条「只改默认值等于没改」（v325，2026-09-29）

**改任何「默认权限」之前，先读完这三条：**

1. **`_DEFAULT_PERMS` 只管「没被租户库覆盖」的角色。** 实测 `tenant_1` 有 **2 行**覆盖（`库管`/`supervisor`）、
   `tenant_10` 有 **7 行** ⇒ 只改出厂默认，对**存量租户几乎无效**，且**全链路零报错**。
   ⇒ 「改了默认值没效果」不是缓存问题，是**双源模型**本身。**必须同批迁库**。
   （判据用 `core.custom_roles(tid)`，**不是** `role in perms_for(tid)` —— 后者恒真，因为 `perms_for`
   返回的是「内置 ⊕ 覆盖」的**全量**合并结果。本轮实测踩过。）
2. **权限表缓存无 TTL。** `perms_for(tid)` 是**进程级**缓存，`perms_rev`（版本号）与 `custom_roles`
   才直读库。⇒ **迁库/直改库之后必须重启服务**，否则读数还是旧的。改**运行中代码**同理。
3. **`_ALL_MODULES`（权限页可勾项）与 `_PATH_MODULE_MAP`（接口真裁决）是两回事，可能不同步。**
   现状：`goals` **在** `_PATH_MODULE_MAP`（`/api/goals`）但**不在** `_ALL_MODULES` ⇒ 权限页不渲染；
   `ops-workbench` / `perf` 两边都没有路径映射 = **死名字**。
   🔴 **但这不会丢数据**：`GET /api/role-permissions` 返回 `{**_DEFAULT_PERMS, **custom}` **原文**，
   且 **v296** 已把前端「按 `known` 过滤未知模块」删掉（`Settings.vue`：「**不认识 ≠ 丢掉**」）
   ⇒ 保存时逐字回传。**后端「不登记」与前端「不过滤」两条必须同时成立**，缺一条就变成
   「老板点一次保存，`goals` 从租户库静默消失」（零报错）。测试已固化 `known.has(p)` 不许回归。

**撤权限比补权限危险**（补权错了只是多给，撤权错了会把客户自己配的东西一起弄没）⇒ 六条纪律见
`tools/perms-tenant-revoke-chat.py`：① 绝不碰 admin/boss ② **绝不删行**（删行 ⇒ 角色回落内置默认、
**丢掉客户自己加的模块**）③ 保持 list/dict 原形态 ④ 除目标模块外动到别的 ⇒ **整行跳过 + 告警**
⑤ 幂等 ⑥ 坏 JSON 不猜。另加：备份失败要 **fail-fast**（否则跑到半途失败、输出像"跑过了"而数据未改）；
**幂等重跑不得覆盖 `rollback.sql`**（空文件盖掉上一份 = 回滚能力静默丢失，而"跑第二遍确认幂等"是标准流程）。

**`admin` 是 legacy 通配 `["*"]`**，不列模块名 ⇒ 任何「数一数谁有 X 模块」的判据**必须展开通配**
（`m in mods or '*' in mods`，即 `core._perm_granted` 的语义），否则会把 admin 漏掉、
得出"默认只有 boss 有"的错读数。本轮实测踩到。

**AI 能力闸 = `chat` 模块**（`/api/chat`、`/api/ai`、`/api/ai/skills`、`/api/chat-attachment`、`/api/correct`）。
出厂默认只 `admin`/`boss`；`chat` **必须在 `_ALL_MODULES` 里**（否则老板勾不到 = 「预留入口」落空）。
撤 `chat` 是**真封锁**，前提是这两条同时成立（改前复验）：`/hermes/` 直连已被 nginx `return 403;`
封堵（v281）、前端 `hermesChat` 只打 `/api/ai/copilot/chat`。已固化为护栏 F3 段（`.workbuddy/tools/role-registry-consistency-check.py`）。


## 🔴🔴 导入管线的「三份映射表 + 表头写死第 1 行」（2026-09-30 全量实证）

**背景**：用户提出高频上传（库存/应收应付/订单明细/收款流水）"必须先下载模板再复制粘贴"不现实，
要求评估"导出即上传"。核查结论：**基础设施已具备约八成**（8 类目 + 三级识别 + 表头指纹记忆 +
列映射确认界面 + 回执撤销**全部已存在**），瓶颈**不在功能缺失**，在下面三条。

**① 列映射表有**三份**，且已分叉（同族"同一规则抄多份"坑）**
- 主链路：`routers/import_router.py::COLUMN_PATTERNS`（**子串匹配**，别名最全）
- 一步导入 `/one-shot`：函数内自带的精确 `mapping_alias`（只 3 类目）
- 智能识别 `/smart-parse`：`_mapping_for()` 内自带 `alias`（6 类目，**精确匹配**）
- 🔴 **已分叉实证**：**「进价」在 `/one-shot` 写向 `purchase_price`（已降级的历史列），
  在 `/smart-parse` 写向 `factory_price`（权威列）** ⇒ 同一份数据走不同入口进不同的列。
- 加字段/改口径时**必须同时改三处**，否则静默不一致。

**② 表头一律取文件第 1 行**（`/preview`、`/one-shot`、`/smart-parse` 三处均 `headers = rows[0]`）
- 且 `openpyxl.load_workbook(..., read_only=True)` ⇒ **拿不到合并单元格**（多级表头无法处理）。
- 真实导出件前面常有「标题 / 公司名 / 导出时间」⇒ 表头取错。**且不会失败**：实测
  「库存查询表」这行标题因含「库存」被识别成 **数量列** ⇒ 系统显示"已识别"，用户点确认 ⇒ **整表列错位**。

**③ 识别器「从不拒绝」，只静默错位**（匹配 = 子串包含 + 首个命中者赢；关键词含大量泛词）
2026-09-30 探针实测三例（`tools/import-recognition-probe.py`，AST 提取关键词表 + 逐字复现算法）：
- 舟谱订单明细「**客户名称**」→ 被判成 **`product_name`**（泛词「名称」）
- 舟谱应收「应收 / **已收** / **未收** 金额」三列 → **都映射到同一「金额」字段**（落库后列覆盖前列）
- 「单据日期」→ 被映射成 `due_date`
⇒ **这解释了用户为何宁可复制粘贴到模板 —— 用户的选择是理性的**。

**④ 其余两条已实证的缺口**
- **尾部合计行无专门剔除**：执行体只跳"整行为空"；合计行是否被拦住取决于其名称列能否匹配上档案 ⇒ **看运气**。
- **指纹记忆命中条件 = 表头去空格后逐字节相同 + 含列顺序**（`_headers_fingerprint`）⇒ 真实导出件表头微变即失效。

**⑤ 类目与入口的现状（别误判"没入口"）**
8 类目**已全部建好**（含 `receivables` / `order_items` / `payment_receipts`）。
有专门页面的只有 `products`(商品档案) / `employees`(员工档案) / `inventory`(DataFill 库存效期)；
**其余（客户/应收/订单明细/专属价/收款流水）在 `components/DataLedger.vue`（数据台账）弹窗里传**
—— 判定表 = `CAT_META[cat].page`（`page` 为空即走弹窗），**改类目入口只改这一处**。

**⑥ 竞品表头命中率**（同一探针）：畅捷通 44% / 金蝶 38%。关键列（名称/数量）能中，
但**成本价、结存金额、保质期截止日期、主计量单位大量未命中** ⇒ 能导进去但**丢成本与效期数据**。

**可复跑**：`python3 .workbuddy/tools/import-recognition-probe.py`（只读；不连库不联网）。
**完整方案评估**（三层方案 + 诚实边界）见 `docs/导入方案评估-从导出到入库-2026-09-30.md`。



---

# 🔴🔴 v352（2026-10-01）第四种静默洞：**租户上下文里读 `tenants` = 读影子表（0 行）**

## 一、症状与机制

```python
set_tenant_context(1)
rows = db.tenant_list()          # ← 期望拿到主库的租户登记表
print(len(rows))                 # ← 实际 0（或只有租户库自己那张空表的内容）
```

- `erp_db.tenant_list()` 走 `_connect()`，而 `_connect()` 是**租户感知**的：
  有租户上下文 ⇒ 返回**租户库**。于是 `SELECT * FROM tenants` 打到的是
  **租户库自己的 `tenants` 表**。
- 生产实测（2026-10-01，只读探针）：`tenant_1.db`、`tenant_10.db` 里那张表
  **都是 0 行**（主库有的 6 行历史租户也不在里面）⇒ 租户属性被读成
  **"没有这个租户"**，**全程零报错**。
- 后果形态：`for t in (db.tenant_list() or []): labels[t['id']] = ...` 这类
  **静默变成"什么都不做"**；若下游据此判"非生产租户 / 未登记 ⇒ 不推送"，
  就会**静默停发全部通知**（比报错更难发现）。

> 判据：**"跨租户"或"读租户属性"的查询，一律不能走 `_connect()`。**
> 同族的正确做法（`core.py` 已有先例）：
> - `core.tenant_is_readonly(tid)` → `SELECT readonly FROM tenants WHERE id=?`，走 `_master_db()`
> - `erp_db.tenant_list_page()` 文档明写「直连主库只读、绕过租户上下文」
> ⇒ v352 新增 **`erp_db.tenant_master_all(active_only=False)`**：直连主库读全量 tenants；
> 返回 **`None` = 读失败（未知）**，**`[]` = 确实没有租户** —— 两者语义不同，调用方须分开处理
> （多租户判断上，`None` 应按**最保守方向**处理）。

## 二、怎么自证（别只读代码）

```bash
# 生产只读探针：每个租户库里那张影子表有几行
python3 - <<'PY'
import sqlite3, glob, os
for p in sorted(glob.glob("/opt/hergent-erp/tenant_*.db")):
    c = sqlite3.connect("file:%s?mode=ro" % p, uri=True)
    t = [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='tenants'")]
    n = len(list(c.execute("SELECT id FROM tenants"))) if t else None
    print(os.path.basename(p), "有影子表" if t else "无影子表", "行数=%s" % n)
    c.close()
PY
```
实测输出形态：`tenant_1.db 有影子表 行数=0` / `tenant_10.db 有影子表 行数=0`。

## 三、连带纪律：**"有表"≠"有内容"，且"内容为空"要往"读错库/读错上下文"上想**

这类洞与已有的三种静默洞同族（**恒空恒 0 且零报错**）：
只下发表不下发索引 / 窗口当主键 / 白名单漏字段 / **本条的影子表**。
遇到"某个判断看起来永远不成立、但日志干净"，先问三句：
① 这表是**哪个库**的？② 当前在**哪个租户上下文**？③ 这个"空"是**真没有**还是**读错了地方**？

---

## 🔴 v449（2026-10-11）：**「从未被执行过的代码」≠「安全的代码」** —— 死代码里叠了三层缺陷

**背景**：进销存调拨要接进前端（新建 `GET /api/psi/transfer-orders`），而调拨那套函数
（`transfer_order_list` / `transfer_order_get` / `transfer_order_complete`）在此前**从未被任何端点调用过**
—— 生产 `transfer_orders` 表 **0 张**、前端零引用 ⇒ 缺陷**层层叠加、从未暴露**。接上线后一次全炸。

### 抓到的五层（按暴露顺序，修好一层立刻露出下一层）

| 层 | 代码 | 症状 |
|---|---|---|
| ① | `from inventory import inventory_adjust` | `ModuleNotFoundError` —— **`server/inventory.py` 根本不存在**（真身在 `db/queries/inventory.py`）⇒ 端点必然 500 |
| ② | `if "error" in r1:` | `inventory_adjust` **成功时返回 `None`** ⇒ `TypeError: argument of type 'NoneType' is not iterable` —— **成功路径反而崩**。同仓别处都写 `isinstance(x, dict) and "error" in x`，只有这里写歪 |
| ③ | `if "error" in r1: return r1` | 函数体在 `with get_db_tx() as db:` 里，而 `get_db_tx` **正常退出即 commit** ⇒ 失败时 `return` 会**提交半截调拨**：调出仓已扣、调入仓没加 ⇒ **货凭空消失**，接口却返回 error（调用方以为"没成功、库存没动"）。**必须 `raise` 让事务整体回滚** |
| ④ | `p + [limit, offset]` | `p` 来自 `w, p = ("WHERE status=? ", (status,)) if status else ("", ())` ⇒ 是 **tuple** ⇒ `TypeError: can only concatenate tuple (not "list") to tuple` ⇒ 恒 500 |
| ⑤ | `SELECT to.*` | 别名声明是 `to_`，而 SELECT 写了 `to.*` ⇒ SQLite 把 `to` 当**关键字 TO** ⇒ `near "to": syntax error`（④ 修好后**立刻**暴露） |

生产判据：`GET /api/psi/transfer-orders` **500 → 200**、`GET /api/return-orders` **500 → 200**
（后者是 v441 就登记「待修」的 `return_order_list`，当时把 500 写成了**预期**断言 ⇒ 修好后必须**反转探针口径**）。

### 三条可复用的纪律

1. **接通死代码要预期它会炸，并且修完第一层要再测第二层** —— 五层是一层层露出来的，
   只修"报出来的那一个错"会反复上线。
2. **同族扫描要判「类型」而不是判「写法」**：全仓 `w, p = (…, (…)) if … else ("", ())` 型
   tuple 源共 **7 处**，但**只有 2 处**会做 `+ [..]` 拼接（另外 5 处是 tuple 直接传参，安全）。
   逐处核对后把结论**固化成 harness 的动态清点断言**（`v449-listfix-harness.py` D 段），
   防后人只修一处、或"好心"把 5 处安全代码也改了（**扩大风险面**）。
3. **"表里 0 行"是个强信号**：它同时意味着「**没有任何人用过这条路**」⇒ 这条路上的代码
   从未被真实数据驱动过，**缺陷密度会异常高**。（对比：同样 0 行的 `return_orders` 也有两层。）

### 🔴 附带踩到的两个工具坑（同族，值得记住）

- **`sqlite3.Connection` 没有 `rowcount`** —— 要**cursor** 的（`cur.rowcount`）。
  写清理脚本时用错对象 ⇒ 抛 `AttributeError` ⇒ **事务未 commit** ⇒ 等于没删。
  **「清理脚本报错」必须回读基线计数验证，不能只看它"跑过了"。**
- **产物可能早于源码**：`dist-v449` 是 10:10 构建的，而 `src/router/index.js` 10:17 才改
  ⇒ 产物里**没有**那个修复。**部署前必须比 `outDir` mtime 与源码 mtime**（否则安静地部署一份旧代码）。

- 🔴 **「已挂载 / 已生效」不能靠 HTTP 状态码猜**（v471 实测）：认证中间件对**未挂载**的 `/api/*` 路径
  **同样先返回 401** ⇒ 「返回 401 而不是 404，所以路由已挂上」是**错误推理**（v468b 据此误判资金已挂上、
  我 v469 的 API 探针也因此报了**假绿**，实际是 404「接口不存在」）。
  **唯一可靠判据：遍历 `app.routes` 数该前缀条数** ——
  `[r.path for r in app.routes if r.path.startswith('/api/funds')]`，实测 **0** → 手工挂载后 **16**。
  🔴 **同族**：「只改生产、不进 git」的补丁会被下一次「从仓库部署」**静默冲掉且不报错**
  （v471 资金的 `include_router` 就是这么丢的，而同期入库的 `_PATH_MODULE_MAP` 反而活下来
  ⇒ 症状是「有模块登记、没路由」）⇒ **生产手工补丁同批必须回灌仓库**。

- 🔴 **同一个参数可能在「整条委派链」上都没声明 —— 只修一半等于没修**（v473 实测）：`offset`
  在 `psi.py::psi_list_sale_orders` 与 `routers/sales.py::list_sale` **两处都没有声明**，
  FastAPI 把未声明的 query 参数**静默丢弃** ⇒ 前端翻页只改文案、**内容不动**（22505 张单只看得到前 50 张）。
  **v443 当时只补了 `limit`**，注释里甚至写下了「`offset=100` → 与 `offset=0` 同一批 id」的实测，
  却没顺着把 `offset` 补上 ⇒ 死链又活了 30 个版本。
  **判据：新增/修复一个 query 参数，必须逐个 `grep` 三层（薄壳 router → 委派 handler → db 函数）
  确认「声明 + 透传」都在**；只查一层 = 假绿。
  🔴 **同族做法**：唯一能证明「参数真的被接住」的取证是**穿过 FastAPI 参数解析层**
  （`fastapi.testclient` 打真实路由）。直接调 `db.xxx(offset=3)` **证明不了任何事** —— 那个函数本来就收 `offset`。
  探针范式：`.workbuddy/tools/v473-so-order-sort-probe.py`（HTTP 层 + 注入面反例 + 三层源码级复核）。

- ⚠️ **白名单判据里两个容易写反的细节**（v473 生产探针踩过，13 个键全被误报）：
  ① `SELECT COUNT(DISTINCT so.col) FROM <表>` **必须给表起别名 `so`** —— 白名单表达式一律写成 `so.xxx`，
     漏别名直接 `no such column: so.xxx`，异常被 `try/except` 吞掉 ⇒ 判据变量成 `None` ⇒ **全部键误判成"排序没生效"**。
  ② **全 NULL 列的 `COUNT(DISTINCT x)` 返回 `0` 而不是 `1`**（SQLite 不数 NULL）⇒ 「是否全同值」的判据
     必须写 `<= 1`（0 = 全 NULL，1 = 全同值），**ASC 与 DESC 相同在这两种情况下都是预期**。
  🔴 顺带一条业务事实：生产 `sale_orders` 22505 行里 `status` **全部是 `signed`**
  ⇒ 按「状态」排序**看不出任何变化**是数据事实，不是排序没生效。

- 🔴🔴 **P0 已于 v497 修复（后端仓 845c998，已部署+重启 hergent-erp）**：`get_profit_report`
  （`server/erp_db.py:3520`）两处缺陷，**补价前被 purchase_price 全 0 掩盖、补价后立刻现形**：
  ① **退货负数量被当成销量** —— `sale_order_items.quantity < 0` 是销售退货行，
     `profit = sold×sale_price − sold×purchase_price` 里 sold 为负 ⇒ 售价没录时
     `profit = 负数量×(0−进价)` = **正数**：退货被算成毛利（实测妙奇奶酪棒草莓
     qty=-19、进价 7.19 ⇒ 假毛利 +¥136.61，品牌环图把它画成 100% 占比）。
  ② **status 过滤空转** —— `LEFT JOIN sale_orders so ON soi.order_id=so.id AND so.status IN('delivered','signed')`
     里 `so.*` 一列都没 select ⇒ 过滤形同虚设，draft/cancelled 单的销量也进 sold_qty。
     **修法**：sold_qty 改子查询 `LEFT JOIN (SELECT soi.product_id, SUM(soi.quantity) q FROM sale_order_items soi JOIN sale_orders so ON soi.order_id=so.id WHERE so.status IN('delivered','signed') GROUP BY soi.product_id) s ON s.product_id=p.id`。
  止血（v494 已部署前端）：Dashboard 三张毛利图绑 `:empty="pbPriceMissing"`
  （`profit-breakdown` 收入=0 ⇒ 任何非零毛利都是假象，一律不画）。
  🔴 **教训**：「数据缺陷被恒 0 掩盖」与「恒 0 本身就是缺陷」是两回事 ——
  补数的**同一轮**必须重跑依赖该数的下游判据/图表，否则旧缺陷换一身皮继续骗人。


## §MEM-ARCHIVE-v634（2026-10-20 从 MEMORY.md 迁入）

### 副驾权限边界 + 文档上下文注渲染

- 🔴 **「副驾能改生产代码」是 OS 身份问题，不是开关**（v634）：web 端副驾=**单一实例**（`copilot_proxy` 上游只写 `127.0.0.1:18765`，属主 `hergent`，可写 `/opt/hergent-erp`、不可写前端 dist）；企微端才是真隔离（`hergent_t1`，**无 sudo**、只能写自己 home）。`hermes_tenants.py` 只用来取 `home_for()` 存文件、**不用于选网关**⇒ web 端所有租户共用超管身份。**卖 SaaS 前必须做：web 端按租户路由到各自实例。** 全文 `topics/backend-invariants.md` §MEM-ARCHIVE-v634。
- 🔴 **给模型看的上下文注，不进人的气泡**（v634）：Hermes `_build_document_context_note` 生成 `[The user sent a document: …]` 落在 user 回合正文 ⇒ 老板看到「像乱码」。渲染层抽成附件条、**不动落盘数据**；文件名优先解 `agent_path` 的 basename（URL 编码），兜底才解 display_name（`_E6_9C_88` 字节 hex）；**只吃英文注**，前端自己拼的 `【附件：…】` 是给人看的、必须原样留。§MEM-ARCHIVE-v634。


## §MEM-ARCHIVE-v635（2026-10-20 从 MEMORY.md 迁入）

### 副驾按租户路由（实施细节 + 五个必踩的坑）

**定式**：`hermes_tenants.gateway_api(tenant_id)` → `{url,key,tenant,isolated}` 或 `None`。
- tenant 1（平台自有）→ `HERMES_API_URL`（默认 18765 根实例），`isolated=False`
- 其它 → 读 `home/config.yaml` 的 `platforms.api_server.extra.{port,key}`，端口 `API_PORT_BASE(18800)+tid`
- `None` ⇒ 代理 `raise HTTPException(503)`，**绝不为其它租户回落根实例**（回落=洞还在且静默）

**五个坑（都实测踩过）**
1. `gateway_start` 原先要求「至少一个渠道凭证」⇒ 只服务网页端的租户起不来。放宽为 `enabled_channels() or _has_api_server()`（`ensure_running` 同改）。
2. `_spawn` 创建的 `logs/gateway.log` 属主是**后端**（hergent）、0644 ⇒ 租户账号写自己的日志 `PermissionError`，网关秒退且报「30 秒内未启动」。必须在 `open()` 后 `_try_chmod(0o660)`。
3. **全仓没有任何地方调 `ensure_home`**（旧实现靠人工/渠道配置触发）⇒ 新租户永远拿不到 api_server。已挂到 `erp_db.tenant_create()`（软失败），网关由保活 60 秒内拉起。
4. `ensure_api_server` **不能 `yaml.safe_dump` 整份重写**（会抹掉种子 config 的大段中文安全基线注释）。改为文本块替换 `^  api_server:`；写前用 `yaml.safe_load` 双校验「别的平台没丢 + 目标值确实写进去」。
5. 每租户实例常驻 **~250MB RSS**（实测），服务器 3.5G 已用 2.2G ⇒ 卖 SaaS 的容量规划要按租户数×250MB 算。

**验收（实测）**
- `t10 → 18810 isolated=True`，真实对话返回；`t1 → 18765 isolated=False`，同样通。
- `t10` 身份：写 `/opt/hergent-erp` DENIED、读 `.env` DENIED、读 `tenant_1.db` DENIED、`sudo -n true` DENIED。
- `kill -9` 租户实例 → 95 秒内保活自动拉起（端口复原）。
- 未登记租户 `99` → `gateway_api` 返回 None（且 `set_tenant_context` 本身也拒绝建库）。
- nginx `/hermes/` = `return 403`，前端已无 `hergent_copilot_proxy` 直连开关 ⇒ 代理是唯一通道。

**遗留**：① 隔离实例重启窗口内降级到 `hermes_core`（本仓 LLM + ERP 业务工具，无 shell 权限，可接受但文案说「备用模型」不准）；
② 演示租户 `readonly=1` 会让 POST 副驾被 RBAC 中间件拦死 ⇒ **demo 根本体验不到 AI**（产品问题，待定）；
③ 根实例 `/root/.hermes` 里躺着 demo 时期的历史会话与记忆沉淀，与老板自己的混在一起，未清理。


## §MEM-ARCHIVE-v636（2026-10-20 从 MEMORY.md 迁入）

### 副驾消息时间「有的有有的没有」的四类成因

| 类 | 现象 | 根因 | 处置 |
|---|---|---|---|
| ① 企微/IM 会话 | 整条会话 171/171 条全无时间（含用户今早刚聊的） | 后端 `_sync_im_sessions` 只 `SELECT role, content`，把 Hermes `messages.timestamp`（REAL 秒）丢了 | 已修：带上 `created_at = int(ts*1000)`；upsert 全量覆盖 ⇒ 打开历史面板自动补齐 |
| ② 旧 web 会话 | 10-16 之前的会话一条时间都没有 | 前端 v521（2026-10-16 10:27）才加 `created_at`，之前落盘就没有 | 无法还原（实测 32 条缺，按 role+content 在 Hermes 库唯一匹配仅 5 条）⇒ 不造假值 |
| ③ 首次使用演示 | 「先看一下我能怎么帮你」3 条无时间 | `showDemo()` 三处 push 漏写 | 已修：共用一个 `demoAt` |
| ④ 已切换角色 | 分隔线无时间 | 模板走 `cp-switch-line` 分支，不是消息 | 设计如此，不改 |

**顺带修**：
- `_sync_im_sessions` 的 `updated_at` 原写 `datetime.now()` ⇒ 每次 GET 列表都刷新成"刚刚"，一条 9-11 的会话永远排最前。改用最后一条消息时间。
- `fmtTime`（历史列表）直接 `new Date('YYYY-MM-DD HH:MM:SS')` —— 该非 ISO 串在 Safari/WebKit 是 Invalid Date（Chrome 宽松才过）⇒ 统一走 `toTs()` 归一。

**验收**
- 后端：`im:wecom:20260911_153316_f57750b7` 172/172 条有 `created_at`，时间点与 Hermes 一致（09-11 15:33 → 10-20 13:31），`updated_at` = 最后消息时间。
- 单测 19/19（从 SFC 抽真实函数）：`toTs` 数字/SQL 串/ISO/空/垃圾串；`fmtMsgTime` 今天→时分、今年往日→月日时分、去年→年月日；`fmtTime` 不含 Invalid；`showDemo` 3/3 带时间；全文件只剩 isSwitch 一处无时间。
- 真机 14/14（demo 登录 → 注入真实企微消息 → DOM 断言）：4 条有时间且文本正确、2 条缺时间不渲染标签、时间标签数=4、零 Invalid、零报错。

### 部署链的一个认知纠正
`https://hergent.cn/` = ERP 前端（nginx `root /opt/hergent-cn-v2`）；`/admin/` = **平台运营控制台**（`alias /opt/hergent-admin/`，只有一个 index-*.js + css，最后更新 10-13）。
本次误把探针入口写成 `/admin/` ⇒ 拿到的是控制台登录页（`__HG_BUILD__` 为空、无 `.tb-copilot`），差点误判整条部署链失效。
另外顺手验了两件事，都正常：闭包脚本校验的 `https://hergent.cn/assets/<name>` 是真 200（假文件名 `nope.js` 返回 **404**，不会回落 index.html 骗过校验）；`/admin/assets/<新文件>` 才会回落 HTML（因为 `^~ /admin/` 里 `try_files` 兜底）。

---

# 🔴 v646：入口合并后「读运行态」的地方必须用 `_host_home(tid)`（2026-10-20 22:40）

## 报障现象
老板在企微发消息、副驾正常回复，但 **Web 端副驾历史里看不到**。他说「以前可以」。
——「以前可以」是铁证：合并前企微对话写 `home_for(1)`（= t1 目录），同步也读那里 ⇒ 能对上。

## 根因
v642 把企微搬进根实例 `/root/.hermes` 后，只改了凭证/state/日志/pid 相关的几个函数。
**`_sync_im_sessions` 仍 `home_for(tid) / "state.db"`** ⇒ 永远读合并前的老库。
实测：新消息在 `/root/.hermes/state.db`（`20261020_214705_472cb39e`，21:47），
同步读的是 t1 老库（最新只有 9-27 的 cli 会话）⇒ Web 历史永久缺新消息，老历史还在（所以像"以前可以"）。

## 定式（同族 8 处，一次改完）
| 位置 | 语义 | 改法 |
|---|---|---|
| `routers/ai_assist._sync_im_sessions` | 读 Hermes `state.db` | **扫两个库**：`_host_home` + `home_for`（老库留着，合并前历史只在它里面） |
| `routers/ai_assist./media` | 副驾产出文件下载白名单根 | `_host_home` |
| `recipe_sync.tenant_skills_dir` | 配方写回技能目录 | `_host_home`（否则写进没人读的老目录＝静默失效） |
| `hermes_tenants._run` | 跑 hermes CLI（`pairing approve`/`send`） | `_host_home` |
| `hermes_tenants._env_head` | 给 CLI 注入租户 `.env` | `_host_home` |
| `_read_pairing_json` / `_pairing_channels` | 配对状态 | `_host_home` |
| `gateway_status` 返回的 `home` | 展示真实生效的 home | `_host_home` |

已带平台分支、**不要动**：`_proc_pid_for_home`(995)、`config_drift`(1221)、`ensure_running`(1609)、`_spawn`(1381)、`ensure_home`(747 建目录)。

## 🔴 反向坑：改了 home 就不能再切身份
`_identity_kwargs(1)` 仍返回 `sudo -n -u hergent_t1 --preserve-env`，
而 `/root/.hermes` 属 `hergent`（= 后端自身）、权限 0700 ⇒ **hergent_t1 进不去**，
`hermes` 一 import 就崩。实测 2026-10-20 22:44:38 库存预警推送全失败
（`send 失败 tenant=1 tgt=wecom`，sudo 日志里 `USER=hergent_t1 PWD=/root/.hermes`）。
⇒ **`_identity_kwargs` 对平台租户必须 `return []`**（沿用后端身份）。非平台租户不变。

## 验证（生产真机）
- 单测 5/5：新会话落库 + 老会话 212 条不丢 + 非平台租户不炸 + upsert 幂等 + `updated_at` 不是 now
- 真机：历史列表出现「[wecom] 企微消息接收确认 21:47」，点进去提问/回复都在，零 JS 异常
- 回归：`gateway_status(1)`=running/connected、`_run(pairing list)` rc=0、t10 仍走 sudo

## ⚠️ 顺手发现、**未修**
1. **主动推送（`hermes_tenants.send`）不可靠**：`send_message_tool` 靠
   `gateway.run._gateway_runner_ref()` 拿 adapter，独立进程里是 None ⇒ wecom 需 live gateway
   ⇒ 我实测 120s 超时。**不是 v646 引入**：16:16/16:17（合并前、t1 home）就有同样失败。
   修法方向：后端改走根实例 HTTP 接口发，而不是 fork CLI。
2. **t1 的 cron/告警没搬**：`scripts/llm_health_monitor.py`（root cron，每 5 分钟）
   `ALERT_HOME=/opt/hermes-tenants/hergent_t1`，仍往死掉的 t1 写；且它把告警写进
   **老板的企微会话**（同 `session_key`），污染历史。改默认值前要先确认根 home 发得出去。

## 合并必须搬的清单（v642 漏了 2 项，v646 又补 1 项）
`config.yaml`、`.env`、`skills/`、`SOUL.md`、**`platforms/pairing/*.json`**、
**`state.db`（历史是否迁移要单独决定）**、**所有 `home_for` 的运行态调用点**、**cron/告警任务**。

---

# 🔴 v647：推送链路两处真因 + Web 历史滤推送（2026-10-20 23:00-23:40）

用户一句「修」，对象是我在 v646 结尾提的两件事：① 主动推送不可靠 ② 企微会话混进运维告警。

## ① 「推送卡住不返回」的真因不是企微，是 stdin
`hermes_tenants._run` 用 `subprocess.run(input=None)` ⇒ **stdin 继承调用方**。
而 `hermes send` 的 CLI 在 `not sys.stdin.isatty()` 时会 `sys.stdin.read()` 读到 EOF 才肯干活
（`send_cmd._read_message_body`）⇒ 调用方 stdin 是**常开管道**时整个 CLI 挂死到超时。
- 我 22:44 实测卡 120s，一度以为是「企微独立连接与网关互踢」——**误判**，那是我 ssh 探针的管道。
- 生产后端 stdin 是 /dev/null（systemd 默认）所以没暴露；cron 也是 /dev/null。
- 修法：`input_text is None` 时显式 `stdin=subprocess.DEVNULL`（有 input 时不能同时设 stdin）。
- 🔴 **判「CLI 挂住」先看调用方 stdin**，别先怪平台。

## ② 「独立推送会不会踢掉网关的连接」——实测不会
`_standalone_send` 确实另开一条 WeCom 短连接（官方同一 bot 只允许一条有效长连接，v642 踩过 846609）。
但 23:26 用根实例凭证真发一条：**网关日志零新增**（无 closed/Reconnected）。
当日 3 次偶发断连（21:25/22:42/22:52）与推送**无因果**（20 次推送只对应 3 次断连，且时间对不上）。
⇒ 保留 CLI 独立短连接这条路，不改成「经网关代理发送」。

## ③ 巡检告警的 home 必须跟着入口合并一起搬
`llm_health_monitor.ALERT_HOME` 默认还指向已停用的 t1 ⇒ 老板在能力中心改密钥后，
巡检静默用过期的 .env。改 `/root/.hermes` + 同口径设 HOME + stdin DEVNULL。
⇒ **「入口合并」清单再加一项：所有 cron 脚本里硬编码的 HERMES_HOME 默认值。**

## ④ Web 历史滤「机器推送」（`ai_assist._is_machine_push`）
告警与老板的企微 DM 共用同一 session_key（`hermes send` 无 session-key 参数）⇒ 全混进一个会话。
实测 t1 老会话 212 条活跃消息里推送约占一半：巡检 191 / 库存 24 / 备份 5 / 报单 3 / 简报 2 / 自检 2。
- 判据：**首行标题白名单（12 类）+ 只作用于 role=assistant**。
  🔴 不能按「token_count/finish_reason 为 NULL」判——实测 345 条无计数里 103 条是真实回复。
  🔴 不能滤首行「经营副驾」——那是 agent 真实回复的签名（41 条），不是推送标题。
- 新增推送类型时往 `_PUSH_TITLE_RES` 加一行。推送本身仍留在企微 App 与站内通知中心，不丢信息。
- 效果：老会话 212→83 条（27 user + 56 assistant），接口实测首「你好」尾「工资模块」回复。

## ⑤ 顺带修掉挂了一天的 crit：`/opt/hergent-erp/{backups,var}` 755→700
跨租户数据面检查报「2 处过宽」= 租户账号能穿透读别家库备份。属主 hergent、引用方全是
hergent/root ⇒ chmod 700 后后端读写不变、`hergent_t1` 实测被挡。
🔴 `normalize_tenant_perms.py` 只管 hermes-tenants//tmp，**不管后端自己这两个目录**——它们要手工收口。

## ⑥ 库存预警「每 30 分钟一条」是重启假象
`_push_alert_throttled` 的节流字典在**进程内存**里 ⇒ 每次重启后端首次检测补推一次（代码注释自认「可接受」）。
22:49/23:18/23:25 三条间隔都对应我的重启，不是刷屏 bug。正常态是一天一条。

## ⑦ v648：企微推送会踢掉网关长连接（推翻当晚「不踢网关」的中间结论）
**判据链**（全部实测，2026-10-20 23:39-23:45）：
- 机制：后端 `send_message` → `hermes send` CLI → `tools/send_message_tool`（in-process runner 弱参只有网关进程自己有）→
  `plugins/platforms/wecom/adapter.py::_standalone_send` ⇒ **临时开一条企微 WS（aibot_subscribe）发完即断**。
  企微规则「同一 bot 只允许一条有效订阅」⇒ 网关的长连接被服务端关闭 ⇒ 适配器 ~2.2s 后重连成功。
  日志形态：`WebSocket error: WeCom websocket closed` → `Reconnected` 成对，**无 846609**、无 CPU 空转。
- 对时：close 22:42/22:52/23:22/23:27/46/23:32/23:37:56 与推送一一对应（cron */5 + 自检推送）；
  **23:40 cron 无告警 ⇒ 23:43 网格点无 close** ⇒ 「5 分钟一次 closed」是推送驱动，**不是服务端轮换**。
- 🔴 排除项：心跳 30s（`HEARTBEAT_INTERVAL_SECONDS=30`，ws heartbeat=60）⇒ 不是客户端空闲被踢。
- 🔴 **aibot 协议纯 WS**（subscribe/callback/send_msg/upload 全在 WS 上），**没有 HTTP 发送 API**；
  网关 api_server 路由表只有 sessions/chat/jobs/runs，**无代发端点** ⇒ 进程外推送踢连接架构上免不了。
- 🔴 **判网关/企微通道状态只认 `/root/.hermes/gateway_state.json`**（$HERMES_HOME 下，含 platforms.wecom.state+updated_at）。
  `/root/.hermes/logs/gateway_state.json` 是**无任何代码引用的历史遗留**（全 venv grep 只有一个写处），曾误导判读成 disconnected，现已消失。
- 影响面：每次推送 = 网关入站断 2.2s（老板恰在瞬间发消息可能投递失败，WS 无离线队列）；正常态频率低（告警 24h 节流+仅状态跳变才推），今晚高频是重启补推假象。
- 方案：**接受（推荐）**；彻底方案 P1 = 把库存预警/巡检推送改成网关内 hermes cron（deliver=wecom 走 live adapter）或给网关加代发端点；可选缓解 = `_ALERT_PUSH_AT` 节流落盘防重启补推。
- CLOSE-WAIT 陈旧 fd 无害（适配器注释自证 tighter keepalive 会 drained），重启网关即清。
