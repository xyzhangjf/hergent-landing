# 后端 · 数据层 / 路由不变量（细节）

> 索引见 `memory/MEMORY.md`。写后端代码前必读。

## 路由与权限
- **新路由必须登记 RBAC**（`server.py _PATH_MODULE_MAP`，未命中 **fail-closed 403**）：
  forecast→data、forecast-audit→stock、rebate-rules→sales、ai→chat、admin→*、platform→hr。
- ⭐ RBAC 权限**权威副本在主库 `erp.db.role_permissions`**（`core._load_perms()` 读它，改后须**重启**刷新进程内 `ROLE_PERMS`）；`tenant_1.db.role_permissions` 是**不参与鉴权的遗留表**（改它无效）。
- 登录错 5 次锁 15 分（详见 `backend-auth.md`）。

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

