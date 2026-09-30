# 后端 · 认证 / 会话 / 限流（细节）

> 索引见 `memory/MEMORY.md`。本文承载「登录、会话、限流、防扫描」的全部细节。

## 会话空闲超时（2026-09-12 落地）
- 阈值 = `core.SESSION_IDLE_MINUTES`（环境变量可覆盖，默认 30；≤0 关闭）。
- 判定在 `_lookup_user_by_token` 的 sessions 查询里：`COALESCE(NULLIF(last_activity,''),NULLIF(created_at,''))` **回落 created_at**，避免空值行被豁免。
- 每次鉴权成功会 UPDATE `last_activity` → **滑动续期**。
- `scheduler._cleanup_idle_sessions` 每 10 分钟兜底清行。

### ⚠️ 历史坑：空字符串会话永不过期
`sessions` 的 `expires_at` / `last_activity` 为**空字符串**时，旧逻辑判为「永不过期」，且两个清理任务都 `WHERE ...!=''` **主动跳过** → 这类行可无限存活（实测一条 2026-06 创建的 admin 会话活了 3 个月）。
修法：`_init_users()` 启动时按 `created_at` 回填空值（幂等），强制它们落入过期/空闲区间。

### 前端体验层
`components/IdleTimeout.vue`（挂 `Shell.vue`）：30 分钟 + 到期前 60 秒倒计时可续期，localStorage 跨标签同步。登出统一走 `Shell.logout()`（先 `POST /api/auth/logout` 销毁服务端会话，再清本地）。

## 登录防护双层（2026-09-12 v125）
| 层 | 机制 | 参数 |
|---|---|---|
| 应用层 | `erp_db.login_is_locked(username, ip)` **双维度** | 用户名 `LOGIN_LOCK_USER_MAX=5` / 来源 IP `LOGIN_LOCK_IP_MAX=20`，均 15 分钟滑动窗 |
| nginx 层 | `/etc/nginx/conf.d/hergent-ratelimit.conf` | `auth_login` 60r/m burst30、`auth_sms` 20r/m burst8、`limit_req_status 429`；两个 server 块的 `= /api/auth/login|register|send-code` |

- `_LOGIN_IP_EXEMPT` 豁免 `127.0.0.1` / 空（保护健康检查与内部脚本）。
- **被拒请求不落库**（锁定检查在记录之前）。
- **分工**：精确拦截归应用层，nginx 只拦洪峰 → 阈值故意放宽，避免误伤 **NAT 共用出口**（办公室多人同时登录）。

## ⚠️ `_client_ip` 取 `X-Forwarded-For` 的最后一段
`$proxy_add_x_forwarded_for` 把真实对端**追加在末尾**；`erp.hergent.cn` 则是 `$remote_addr` 覆盖。
**旧实现把整个 XFF 头当 IP 存库 → 客户端自带前缀即可污染审计并绕过按 IP 的锁定**（已修）。

## 🔴 `/api/auth/login` 被网页端与小程序共用
小程序 `app.js` 的 `apiBase=https://hergent.cn` → 给该接口加任何**前置门槛**（滑块 ticket / 签名 / 新必填字段）都会**断掉小程序登录**；纯前端滑块安全收益为 0（脚本直接 POST 接口）。

## 其它
- ⚠️ nginx 429 是 HTML，**不要用 `error_page 429` 自定义 body**（会连后端 429 自带的 `detail` 中文文案一起劫持）→ 在前端按 `res.status===429` 补文案（`client.js _authErrText()`）。
- ⚠️ `:8700` 绑 **`0.0.0.0`**（仅靠云安全组拦截，实测公网不可达）→ 建议改绑 `127.0.0.1`。
- `sites-enabled/hergent` 是**真实文件**（非指向 `sites-available/` 的符号链接），直接改它。
- `ERP_SECRET` 与密码哈希强绑定（换 / 丢 = 全员密码失效）。
- 🔴 **技术债：`password_changed` 是僵尸字段（半实现）**。`routers/auth.py:133` 认真算 `require_change = not password_changed` 并塞进登录响应，但**前端全站 grep 零匹配** → 文档承诺的「admin / 新用户首次登录强制改密」**从未生效**。上线前需二选一：补前端实现，或显式标注未实现。

## ✅ 自注册链路：邀请码制已跑通（2026-09-12 审查 → 当晚修复上线）
**原故障（三重互锁，自上线起 100% 走不通）**：`ENV=production` 且 `ALLOW_SELF_REGISTER` 未设时走 `code != getattr(db,"_sms_code_cache",{}).get(phone,"")` → **`_sms_code_cache` 全代码库仅此一处引用、从未定义/写入** → 恒 `""` → 恒 400。连带：`send-code` 写的是**另一处**（`set_config("sms_code_"+phone)`，读写信箱不一致）；网关是占位域名 `sms-api.example.com` 且无 `SMS_API_KEY`；前端注册表单**没有验证码框**、`code` 硬编码 `'888888'`。生产 `audit_logs`「自助注册」= **0 条**。
**修复（用户选 C 邀请码制）**：新增 `server/invite_codes.py` + 三张**主库**表 —— `invite_codes`（码/备注/容量/有效期/停用）、`invite_uses`（**核销流水 = 注册事件表**，记公司/手机/租户/账号/IP/UA）、`platform_admins`（平台管理员独立名单）。`/register` 按 `REGISTER_MODE` 分支（**invite 默认 / sms 原样保留 / open 需显式开关**）→ **接真短信只改一个环境变量，不改代码**。
- 🔴 **建表位置**：三张表必须建在 `core._init_users()`（主库），**不能**放 `erp_db.init_db()` —— 后者走 `get_db()` 会跟随调用者租户上下文，把表建进 `tenant_N.db`。
- 🔴 **平台管理员必须独立名单表，不能复用 `boss`**：`_admin()` 只判 `role in (admin,boss)`，而**每个自注册用户就是 boss** → 注册一跑通，邀请码/开租户接口就对所有客户开放 = 提权。用名单表而非新 RBAC 角色，是为了**不碰 `_DEFAULT_PERMS`**（加角色要同步租户库 role_permissions + 迁移兜底，漏一环该角色就丢掉全部模块权限）。名单表**首次为空时**自动播种 `admin`/`boss` 两账号。
- 🔴 **名额核销必须原子**：`UPDATE ... SET used_count=used_count+1 WHERE code=? AND is_active=1 AND (expires_at='' OR ...) AND (max_uses<=0 OR used_count<max_uses)`，`rowcount==1` 才算占到（查一次再写一次会并发超发）。顺序 = **先占名额 → 建号 → 失败 `release()` 归还**（公司名重复那类失败不该烧名额）。
- 注册响应**必须补发 `csrf_token` + 两个 CSRF cookie**（与 `/login` 对齐）。原来不下发 → 注册成功后第一个写操作必 403 `CSRF_REQUIRED`，而前端 `client.js` 一直在等 `data.csrf_token`。
- 公开新增 `GET /api/auth/register-mode` → 前端据此自动切换「邀请码 / 短信验证码」输入框（切 SMS 时前端零改动）。
- 注册限流 **600s → 60s**。原值之所以致命：`_rate_limited` 的时间戳在**校验之前**记录 → 打错邀请码也要干等 10 分钟。（短信通道的 60s 节流另在 `send_code`。）
- `send-code` 在 invite 模式下**明确拒绝**，别让用户等一条永远不会来的短信。
- ⚠️ **`seed_demo_data()` 仍会给新租户灌 15 假客户 + 15 假商品**（与「上传第一份数据激活」引导冲突）；其中 `sale_order_create(cust_id,items,1,"备注")` **把备注传进了 `discount` 位置**（签名第 4 参是 `discount`）→ TypeError 被 `except→logging.debug` 吞掉，`sale_orders` 0 行。**未修**（属产品决策：示例数据到底要不要留）。
- 📌 **运维入口**：生产已预置一张不限次自测码；新建码 = 登录后 `设置 › 客户开通 › 邀请码`（仅平台管理员可见）。命令行建码见 `deploy-ops.md` 的 `runuser -u hergent -- env ERP_SECRET=...` 范式。

## ✅ `/api/tenants` 客户名单泄漏已收紧（2026-09-12 修复）
`routers/platform.py` 的 **router 前缀是 `/api`（不是 `/api/platform`）** → 其 `/tenants`、`/users` 落在 `_PUBLIC_PATHS` 的 `/api/tenants` **前缀**上，中间件鉴权整层跳过，只剩端点内 `_auth`/`_admin`，而 `_admin` 把 `boss` 等同于管理员。
实测修复前：未登录 `GET /api/tenants` 也能拿到**全部客户公司名 + `contact_phone`**；demo 会话还能拿 `/api/tenants/1`（他人租户套餐/创建时间）。
**已修**：`GET /api/tenants`、`GET /api/tenants/{tid}` → `_platform_admin`（前端对这两个路径**零引用**，收紧无回归面）；`POST /api/platform/onboard` 也由 `_admin` → `_platform_admin`。实测修复后：未登录 401 / demo 会话 403。
⚠️ **仍未处理**：`/api/tenants/{tid}/usage`、`/{tid}/members` 调用了**不存在的** `tenant_usage_stats` / `tenant_member_list` → 恒 500；members 的增删**只做 `_auth`、无租户归属校验**（补全函数即成越权面）。`/api/tenants` 列表的用量字段也因该函数缺失而静默为空。

> ✅ **上面这条已过期（2026-09-12 当天即修净，见 `9d9d447`/`b72cf04`）**：四个缺失函数已补齐、整族收紧到
> `_platform_admin`（成员增删查 + usage），`{tid}/my`、`{tid}/current` 的 422 也已修（移进 platform.py
> 并定义在 `{tid}` 之前）。细节见 `MEMORY.md` 对应条目。

## 🔴 已删租户仍可达 → 播种闸门（2026-09-13，commit `ee04263`）
`tenant_middleware`（`server.py:79`）的 `tid` 来源依次是
**`X-Tenant-Id` 头 → `hergent_tenant` cookie → `?tenant_id=` query → 登录用户 `user_tenants[0]`**
—— 前三个**客户端可控**、第四个**会残留**。而 `erp_db.check_user_tenant`（`:4291`）**只查
`user_tenants` 成员表、不校验租户是否还存在**。
→ **别把「中间件 fail-closed」当成「已删租户不可达」**：它 fail-closed 的是「没有租户上下文」，
**不是**「租户不存在」。

后果实证：清完 `ai_roles` 孤儿行后，一次 `list_roles(16)`（16 是被删租户）就当场把 4 行种回来
（`list_roles` → `seed_roles` 惰性初始化）。

修法：`ai_roles._tenant_exists(db, tenant_id)` 作为 `seed_roles()` 的前置闸门（`force=True` 同走），
**只在能确证租户不存在时拒绝**；`tenants` 表不可读属异常态 → **放行并留痕**（宁可漏，不可因一次对账
失败把全体租户的副驾角色抹掉）。同库前提：`ai_roles` 与 `tenants` 都在全局 `erp.db`。

巡检约束：复核孤儿行**只用只读 SQL**（走 API 会自愈重种，用自己的验证动作制造"清不干净"的假象）。
删租户**无级联**（代码里没有 `tenant_delete`）→ 手工删租户须一并清
`user_tenants` / `ai_roles` / `ai_role_channels` / `tenant_<id>.db`。
完整机制、清单与三层验证范式见技能 `hergent-tenant-isolation-audit` §10。

---

## 🔴 员工登录账号：**不分端**（2026-09-19 核查，触发词：开账号 / 员工账号 / web 端账号 / 网页端权限）

### v288（2026-09-27）：账号名可改 —— 老板代改入口 + 三处必须跟着动的副作用
触发：**改账号 / 改登录名 / 账号建错了 / 能不能改用户名**

**病根 = 「只做了一半」**：后端**早就有**改用户名的能力（`PUT /api/auth/profile`，`routers/auth.py:243`，
自带 2..32 长度校验 + 查重），但它 `WHERE id = 当前登录用户` ⇒ **只能改自己**；
员工档案弹窗的账号区有「重置密码 / 禁用账号 / 生成重置码」，**唯独没有改账号**
⇒ 用户看到的就是「能改密码、不能改账号」。

**🔴 别被这条误导（差一步就误判成重缺陷）**：`_sqlite_connect` 是
`db_path = _tenant_db.get() or DB_PATH` ⇒ **有租户上下文就走租户库**，而 `users` 是**主库**表，
`/api/users/{uid}/{role,password,status,reset-code}` 又全都用 `db.get_db()` ——
看着像「四个端点全写错库」。**实测推翻**：`server.py::_TENANT_MASTER_PREFIXES` 含 `/api/users`、
`_TENANT_PUBLIC_PREFIXES` 含 `/api/auth` ⇒ 这两族请求期间 `set_tenant_context(None)` ⇒ 走主库、全部有效。
**⇒ 判「某端点写哪个库」的唯一可靠办法 = 查这两个前缀元组，不要看它用哪个连接函数。**

**另附实测（别再拿错那一份当判据）**：主库 `erp.db` 的 users **8 行**（真实账号）；
`tenant_1.db` 里也躺着一份 users **6 行**（`admin/boss/accountant/sales/warehouse/driver` = **另一批种子数据**）。
读端统一走主库（`employee_account_map()` 用 `core._master_db`）⇒ **租户库那份 users 是死数据**。

**判据只有一份**：`core.validate_username(nu)`（2..32 字符 + `USERNAME_IMMUTABLE`）+
`erp_db.user_rename(uid, new, actor, conn=None)`（唯一写入实现）——
`/api/auth/profile`（本人自助）与新端点 `PUT /api/users/{uid}/username`（老板代改，复用
`_assert_user_manageable` 权限闸）**都调它们**。

**改名必须跟着动的三处（漏一条就是「看起来成功、留了半截」）**：
1. **`phone`** —— `staff_account_create` 会写 `phone=username`。**仅当 phone 逐字等于旧账号名**
   （= 它只是拷贝）才跟随；是**真实手机号**则不动（否则把手机号冲掉）。
2. **未用的 `password_reset_codes.username`** —— 一次性重置码是按 `username COLLATE NOCASE` 查的
   （`password_reset.py:193`）。不同步 ⇒ 管理员刚发给员工的码**当场失效**。
3. **审计记「旧名 → 新名」**（原 profile 只写「修改个人资料」，查不出改了哪个字段）。

**历史日志里的旧名一律不动**：`login_logs` / `login_attempts` / `audit_logs` / `mp_events`
记的是「当时用哪个账号登录的」—— 改它才是篡改。

🔴 **`admin` 本体也不可改**（不只是"不能改成 admin"）：`core._init_users()` 的判据是
`SELECT id FROM users WHERE username='admin'` 是否存在，**查不到就再造一个随机密码的管理员**
（密码只打进日志）；`erp_db.py` 初始化时也按 `username='admin'` 绑 tenant 1。
⇒ `USERNAME_IMMUTABLE` 在「新名」与「旧名」两侧都要拦。

🔴 **判重必须 `COLLATE NOCASE`** —— 因为重置码那条路就是 NOCASE 查的。允许 `LiuShantao` 与
`liushantao` 并存 ⇒ 管理员用大写名发码、员工敲小写名，会命中**另一个人**。

🔴 **`_conn_is_master()` 只能用 `os.path.realpath`**（不能用 `abspath`）：
SQLite 的 `PRAGMA database_list` 回的是**解析过 symlink** 的路径（macOS `/var` → `/private/var`），
`abspath` 不解析 ⇒ 同一文件被判成「不是主库」⇒ 改动被静默挪到另一条连接（单测 B2 抓到的）。

**改完的即时语义**：`sessions` 按 `user_id` 关联 ⇒ **已登录会话不被打断**；但**下次登录必须用新名**
（前端提示语刻意点名这一点，否则员工拿旧账号登录被拒会以为密码坏了）。

**算「当前账号名」**：唯一实现 = `erp_db.employee_account_map()`（员工 id → 账号；跨库读主库，
并按 `user_tenants` 收口租户）。

**账号模型**：一张主库 `users` 表 + 一个 `/api/auth/login`，小程序（`wx.request`）与网页端（fetch）
**共用**（`routers/auth.py:138` 注释即证：`v108-fix: ...(wx.request doesn't auto-handle cookies)`）。
`users` **没有「端」字段**；权限只按「角色 → 模块」（`core.py:375-389` `_DEFAULT_PERMS`）。
⇒ **不存在也不需要「web 端专用开通页」** —— 同一个人两套账号正是工资条发错人那类漂移源。
唯一入口 ＝ 档案管理 › 员工档案 › 编辑员工 ›「小程序账号」区，这是**刻意收口**（三处注释互证：
`Settings.vue:28`「成员/账号归位员工档案」· `EmployeeArchive.vue:61/305`「已整合进编辑员工弹窗」）。

🔴 整块语义原**写死为「小程序」共 7 处**（`EmployeeArchive.vue` 表头 / 区标题 / 提示 / 注释 +
`routers/forecast_submissions.py:515` docstring + `erp_db.py:16649` docstring + `api/modules.js` 注释）
⇒ 网页端场景**不可发现** —— 这是 **UI 语义缺陷，不是缺功能**。

✅ **2026-09-19 已修（`09714bd` / 后端 `cb69a5d`，spec `fe-v199-roles` + `be-v199-roles`）**：
页头 / 表头 / 弹窗区标题 / 提示语 / 停用弹窗一律改「**登录账号**」，并注明「网页端 + 小程序通用」；
角色下拉 8 项补**适用端**标注（仅小程序 / 仅网页端 / 网页端 + 小程序）；两个后端 docstring 同步改「开登录账号」。

🔴🔴 **判据（是硬约束，不是文案偏好）**：「标了小程序」的角色集 **必须 ==** 后端有 `data`/`chat`
权限的角色集 ⇒ `admin / boss / sales / staff / supervisor`。
标注多说一个角色，用户就会按标注去开一个「**开了也登不进去**」的账号。
小程序走的接口前缀在 `server.py::_PATH_MODULE_MAP` 落到 `data`（`/api/forecast-submissions`、
`/api/products`）/ `stock`（`/api/inventory`）/ `chat` ⇒ **有 data 或 chat 就能用小程序**
（`accountant` / `guide` / `driver` **不可以**）。已进护栏 D 段断言。

### 缺口 A（P1）：`supervisor` 前后端不一致 —— ✅ **2026-09-19 已修（`2fbc9db`）**
后端 `core.py:388` **有** supervisor `["dashboard","data"]`；`Settings.vue:512/516` **有**「主管」；
而 `EmployeeArchive.vue:306-314` `ROLE_OPTIONS` 与 `:521` `ROLE_NAMES` **都没有** ⇒
① **开不出主管账号**（下拉选不到，只能退选 staff/sales，权限就不对）② 已是 supervisor 者
（生产 `mptestsp`）角色列显示**裸英文**（`roleName()` 缺 key 回落原值）。

**已修**（提交 `2fbc9db`，纯前端，后端一行未改）：`ROLE_OPTIONS` 补
`{value:'supervisor', label:'主管（汇总总表 + 数据）'}` · `ROLE_NAMES` 补 `supervisor:'主管'` ·
新增 `.df-role.r-supervisor`（indigo `#6366f1`，缺它退回基础 teal 与 `r-staff` 撞色）。
真机 24/24（沙箱 9997）；护栏 8/8 + 三反例 6/8、6/8、7/8。

🔴 **本次的新根因形态 = 「清单缺条目 ⇒ 静默失败」**：`roleName(r){ return ROLE_NAMES[r] || r }`
的 `|| r` 兜底让**缺配置与正常英文值长得一样**，肉眼永远发现不了 ⇒ 这不是「显示 bug」，
而是**清单类代码的系统性伪装**。审计判据：见到 `MAP[x] || x` 先怀疑；权威源要往
**会真的拒绝请求**的地方找（此处 = `core.py::_DEFAULT_PERMS`，**AST** 取 key，注释里也有角色名所以不能正则）。

**两条护栏（新增，以后加角色必跑）**
- `.workbuddy/tools/role-registry-consistency-check.py` —— **2026-09-19 升级为 28 条硬断言**
  （较 v198 的 8 条 +20）：A 下拉覆盖 / 纯净 / 无重复 · B `constants/roles.js` 覆盖 + 值都是中文 +
  无空映射 + **两个页面不得再自带角色表**（防「护栏只看一处、漂移从另一处进来」）+
  视图令牌必须在 `EXTRA_OK` 登记 · C 色板覆盖 · D 「标了小程序」集合 == 后端有 `data`/`chat` 的集合 ·
  E Forecast 不再自带表 + `COLUMN_PERMISSIONS`/`ENTRY_ROLES` 必须是**规范角色名** +
  小程序 `ROLE_TEXT` 覆盖 + `roleText` **不回落原值** + 跨面译名逐字一致 · F `normalize_role` 以
  `_DEFAULT_PERMS`/`ROLE_PERMS` 为判据（**不另抄名单**）+ 三处写入口接线。
  **判别力自证**：5 份「各破坏一处」副本跑同一脚本**全部 FAIL**（26/28、26/28、27/28、27/28、27/28）——
  漏报才最危险。
- `.workbuddy/tools/employee-supervisor-role-verify.js` —— 真机探针（沙箱 9997，走真实 UI 建号）。
- 新增 `hergent-cn-v2/src/constants/roles.js` —— 前端角色词汇的**唯一来源**
  （8 规范角色 + 4 历史视图令牌 + `ROLE_ALIAS` + `normRole` + `roleName` + `canUseMiniProgram`）。

✅ **同根因漂移三处 —— 2026-09-19 全部收敛（`09714bd`）**
- `Forecast.vue ROLE_LABELS` 键集缺 6 个角色、多 `dealer/finance/owner/promoter` 四个**后端不存在**的名字；
  连带 `COLUMN_PERMISSIONS = { dist_price: ['owner','finance'] }` **权限永不命中**。
  ✅ 改为 `['admin','boss','accountant']`；`ROLE_LABELS`/`BIZ_ROLES` 删除，改用共享 `roleName()`；
  `ENTRY_ROLES` 改 `['admin','boss','accountant','sales']` 并先 `normRole` 归一；
  supervisor 不再叫「督导」（统一「主管」）；`bizRole` 默认值 `owner` → `boss`。
- ✅ 小程序 `utils/roles.js ROLE_TEXT` 补齐 `driver/guide/staff`，`accountant`「财务」→「会计」、
  `sales`「销售」→「业务员」（与网页端**逐字一致**）；`roleText` 改显式 `未知角色( x )` 不回落。
  `APPROVER_ROLES` **保持原样** = `['admin','boss','accountant','supervisor']`（与后端
  `submission_summary` 逐字一致），但见下方「未解矛盾」。

🔴🔴 **两条必须记住的判据**
1. **`normRole` 只做「词汇归一」（owner→boss、finance→accountant），
   ≠ 把后端不存在的名字变成有效权限。** 视图令牌是演示期词，规范角色名是「后端会真的拒绝请求」的那套 ——
   归一 ≠ 授权。混这两件事正是本题最容易搞错的地方。
2. **前端列级权限目前是空转的**：全仓**没有任何地方给 `store.user.role` 赋值**（`Shell.vue` 只同步
   `user.name`）⇒ `bizRole` 只取 `localStorage('hergent_biz_role')` 的遗留值或默认值，两者都指向「全可见」。
   且它**只是前端展示级隐藏**（列头、导出、接口照旧）—— 真隔离必须做在后端 DataSourceAdapter 字段过滤，
   否则只是安全幻觉。⇒ 日后真接上会**立刻生效**，届时需业务拍板各角色该看哪些列。
   `canSeeCol` 的失败方向取「**宁可多显示**」：角色未知 ⇒ 不隐藏（静默藏掉一列而用户无处找回，比多显示更坏）。

🔴 **未解矛盾（待后端拍板）**：`submission_summary`（`erp_db.py`）硬编码
`("admin","boss","accountant","supervisor")`，但 **`accountant` 没有 `data` 权限** ⇒
会计点「汇总总表」会在**中间件**就被 403。两处后端判据互相矛盾：要么给 `accountant` 补 `data`，
要么从 `submission_summary` 名单里摘掉它。小程序 `APPROVER_ROLES` 与本名单逐字一致，
改哪边都要三处同步。

### 缺口 B（P2）：「只允许登录小程序」**做不到硬隔离** —— 🔴 2026-09-27 复核并**更正一句错话**
`routers/auth.py` 登录成功后**无任何端校验**；`Login.vue` 处理完 `require_password_change`
一律 `router.push('/workbench')`（4 处：`258/286/316/371`）⇒ `staff` 账号**照样能登 hergent.cn**。
即「业务员只能用小程序」**在权限上成立、在门禁上不成立**；硬隔离需新增端白名单列或按角色设端约束。

🔴 **2026-09-27 更正（老板实测触发，原话「改成员工角色后 web 端也能登录」）**：
原文这句「（只是侧栏按 `_DEFAULT_PERMS["staff"]` 过滤后**只剩几项**）」是**基于 v206 设计的推断，实测证伪** ⇒
`Shell.vue` 侧栏 **12 条菜单里只有 2 条装了门禁**（`canViewForecastSummary(role)` 预报订货、
`store.canModule('payroll')` 算工资；手机抽屉同），路由表**只有 `/zhoupu-import` 一处 `meta.roles`**
⇒ staff 登录后**能看到/能打开 10 项**（工作台/返利/货损/档案/渠道/能力中心/招投标/定时任务/AI 中心/设置
—— 只隐藏了「预报订货」「算工资」两条），
只是**点进去后**接口才 403。**「机制存在」≠「覆盖完整」**。
⚙️ 另新增两条结构性事实（本轮实测）：
- **`/api/auth` 整段在 `_PUBLIC_PATHS`**（`server.py:655`）⇒ RBAC 中间件在登录请求上**根本不执行** ⇒
  想约束「从哪个端登录」，**只能写在登录端点内部**，放中间件里 100% 无效。
- **登录端点必然豁免 RBAC**（登录时还不知道你是谁）⇒ 任何情况都不要指望「角色 → 模块权限」能管住"能不能登录"。
- ⚠️ **别给 login 加"必带头"的硬门槛**：小程序请求虽集中封装在 `miniprogram/utils/api.js`，
  但**存量已发布版本不带新头**，且小程序有备案/审核周期 ⇒ 硬判会把存量小程序用户**全部挡在门外**。
  要做得 **fail-open**（缺头视为小程序），并留可回滚开关。

🧪 **触发本条的表述陷阱（值得单记）**：`EmployeeArchive.vue` 角色下拉里 `staff` 的标注是
`「员工（仅小程序 · 报单 / AI 对话 / 库存）」`——**「仅小程序」说的是"模块权限只够撑小程序那批接口"，
不是"仅能从小程序登录"**；而同页 `:148` 又写着「可登录**网页端**与**预报小程序**」⇒ **同页两句话相反**。
凡遇「角色/权限按端区分」的需求，**先分清他要的是「能力」还是「入口」**，两者实现层完全不同。


### 缺口 C（P3）：role 无白名单 —— ✅ **2026-09-19 已修（后端 `cb69a5d`）**
原状：`routers/forecast_submissions.py`（开账号，直接透传 `d.get("role","staff")`）与
`server.py`（改角色 `UPDATE users SET role=?`）**均无白名单**，而下拉含
`boss`（几乎全开）/ `admin`（全开）⇒ 任何 admin/boss 可一键造出新 admin/boss。

✅ **修法**（判据只写一份，`core.py`）：
```python
def known_roles():      return set(_DEFAULT_PERMS.keys()) | set(ROLE_PERMS.keys())
def normalize_role(role, default=None):
    r = str(role or "").strip();  return r if r in known_roles() else default
def role_reject_detail(role):   return "角色不合法：%s。可选角色：%s" % (role, "、".join(_DEFAULT_PERMS.keys()))
```
三处接线：`PUT /api/users/{uid}/role` · `POST /api/forecast-submissions/staff-accounts` ·
`erp_db.staff_account_create` 的 **INSERT 紧邻处**（第二道闸，防日后新增调用点绕过）。
真机 **9/9**（`role-whitelist-prod-verify.py`，临时令牌走真实 HTTP、跑完即删、users 一字未变）。

两个设计取舍（都写进代码注释）：
1. **不另抄一份角色名表** —— 再抄一份就是下一个漂移源（同日刚修完「前端四处各抄一份」）。
2. **取 `ROLE_PERMS` 并集而不是只用 `_DEFAULT_PERMS`** —— `_check_perm` 查的是 `ROLE_PERMS`，
   写不进权限表的角色 = **僵尸账号**（能登录、每个模块都 403）；并集也兼容租户自定义角色。

🔴 **仍未解（需业务拍板）**：白名单只关掉「写进**任意**角色名」，
**不阻止 admin/boss 给别人派 admin** —— 那是策略问题（谁能派全权限角色），不是校验问题。

另：`staff_account_create` 强制要求**真实员工存在**（`erp_db.py`）⇒
「给非员工（如外包财务）开账号」**暂无通道**；`platform.py` 能建无主账号但走
`_platform_admin`（创始人专属），租户老板用不到。


## 权限粒度实况：只有「模块 × 动作」，**没有字段级**（2026-09-19 核实）

`core.py:450 _check_perm(user, module, action)` 的判据 = **一个模块名 + 一个动作**
（read/create/update/delete）。**不存在**「能读姓名但不读银行账号」的表达力。
中间件按 `路径前缀 → 模块` 推导模块（`server.py:311 _PATH_MODULE_MAP`，**前缀匹配、首个命中者优先**），
动作按 HTTP method 映射（GET=read/POST=create/PUT=update/DELETE=delete）。

**触发词：字段级权限 · 敏感字段 · 脱敏 · SELECT \* · 薪酬/工资 · 银行账号 · id_card · 员工档案权限**

### 🔴 判据一：`hr` 与 `payroll` 都只给了 `boss`（+ `admin` 通配）

`_DEFAULT_PERMS`（`core.py`）里有 `hr` 的角色**只有 `boss`**：
`accountant` = dashboard/accounts/reports/marketing（**无 hr**）｜`supervisor` = dashboard/data（无）｜
`sales`/`guide`/`driver`/`staff` 均无。

✅ **2026-09-19 v205 起多了一个 `payroll` 窄模块，默认同样只给 `boss`**（`admin` 走 `*` 通配）。
`accountant` **刻意不给默认值** —— 「会计能不能算工资」是**按客户差异**的业务决定，
由各租户在权限页自行授予；这正是拆模块的目的。
⇒ 现状「会计算不了工资」是**配置结果**，不再是能力缺失（v205 之前是后者）。

### ✅ 判据二（v205 已拆开）：员工档案 = `hr`，算工资 = `payroll`

**v205 之前**以下前缀**全部映射到 `hr`** ⇒ 把字段从一个页面搬到另一个页面，**权限不发生变化**。

**v205 之后的真实映射**（`server.py` `_PATH_MODULE_MAP`，**顺序即优先级、首个 `startswith` 命中即停**）：

| 前缀 | 模块 | 说明 |
|---|---|---|
| `/api/employees` | `hr` | `SELECT *` ⇒ 含 L3 实名与银行字段 |
| `/api/salary-bank-file` | `hr` | 代发凭据文件（`账号\|姓名\|金额`）＝ L3 |
| **`/api/payroll/bank-file`** | **`hr`** | 同上，**必须排在 `/api/payroll` 之前** |
| `/api/attendance` · `/api/leave` | `hr` | HR 域 |
| `/api/payroll` · `/api/payroll-workflow` · `/api/salary-batch-calculate` · `/api/salary-save` · `/api/salary-summary` · `/api/social-insurance-config` · `/api/salary-send` · `/api/salary-details` · `/api/salary-slip` · `/api/salaries` | **`payroll`** | L2 薪酬层，可单独授权给会计 |

三层信息域：**L1 身份层**（姓名/工号）｜**L2 薪酬层**（底薪/社保基数 → `payroll`）｜
**L3 实名与资金层**（身份证/开户行/银行账号 → 仅 `hr`，泄露**不可逆**）。

🔴 判据仍是「**隔离单位是字段组，不是页面**」—— 「迁移」唯一有价值的形态就是把薪酬前缀
从 `hr` 拆成一个更窄的新模块；v205 已把它落地。
⚠️ **绝不可给 `accountant` 加 `hr`** —— 会连带拿到身份证 + 银行账号（改角色的能力另由
`_admin` 按角色名把着，不靠 `hr`）。
🔴 **加新路径时必须复核顺序**：`/api/payroll/bank-file` 这类「属 payroll 前缀、但语义属 L3」
的路径一旦排到 `/api/payroll` 后面，会计拿到 payroll 就能**顺带读走全公司银行账号**（静默）。

🔴 **推论：权限与位置正交 —— 隔离单位是「字段组」，不是「页面」。**（v205 已按此落地）

### 🔴 判据三：前端**不是**边界

`router/index.js` 的路由 `meta` **只有 `title`，无权限字段**；`components/Shell.vue:41-57` 侧栏菜单
**硬编码**，所有角色看到同样入口。⇒ **菜单/区块的隐藏只是 UX，零安全效果**。
有效判定链只有一条：**中间件（前缀→模块→动作）→ 业务函数**。

### 🔴 判据四：`GET /api/employees` 用 `SELECT *`，敏感字段全量明文返回

`erp_db.py:6247` → `SELECT * FROM hr_employees`，含 `id_card` / `bank_name` / `bank_account` /
`social_insurance_base` / `housing_fund_base` / `salary_structure`。**要么全有，要么全无。**

配套三条缺口（截至 2026-09-19 **均未修**）：
1. **明文落库** —— 而 `crypto_utils`（AES-256-GCM）**现成**、`SENSITIVE_FIELDS` **已含 `bank_account`**、
   已用于客户档案（`db/queries/contacts.py:3`）⇒ **同一套能力没接在员工档案上**。
2. **无留痕** —— `routers/_field_log.py` 覆盖商品/客户/订单/达成/返利/货损，**未覆盖 `hr_employees`**。
   接留痕时抄 `contacts.py:105`：用加密前明文比较、但**排除 `SENSITIVE_FIELDS`** 防日志泄密。
3. **出口无约束** —— `export_salary_bank_file`（`erp_db.py:6742`）明文拼 `账号|姓名|金额|CNY`；
   `/api/salary-slip/{eid}/{month}` 可按**任意员工 + 月份**枚举，**无「只能看自己」检查**。

🟢 **时机**：生产 `hr_employees` 共 **11 名**员工（tenant_1 七名 + tenant_10 四名），
敏感字段**全部 0 行**、`salary_details` **0 行**、`social_insurance_config` **0 行**
⇒ **整块薪酬能力尚未投产，当前是零数据风险窗口**。改造（拆表/加密/改权限）**无需迁移存量**。

📄 完整分析（含三方案对比、三层信息域设计、拍板清单）：
`outputs/员工薪酬信息归属与访问控制分析-2026-09-19/01-分析报告.md`

---

## ✅ 角色权限表**已按租户分叉**（2026-09-19 v205 落地并上线，commit `6276b25`）

**触发场景**：任何「按客户差异配置角色权限」的需求（如「我的会计不能算工资，但某客户的会计要能算」）。

**结论（v205 起）**：**做得到。** 给某客户开**不再**等于所有租户一起开。

### 核心不变量（记这一句就够）

> **权限必须由「本请求所属租户」的那份表裁决。**

### v205 之前的三重成因（**改这块前必读，否则会重新引入其中一条**）

| # | 缺陷 | 判据 |
|---|---|---|
| 1 | 接口**无视租户头**（写主库） | `/api/role-permissions` 挂在 `server._TENANT_MASTER_PREFIXES`（`server.py:50`）⇒ `set_tenant_context(None)` ⇒ 读写**恒落主库** |
| 2 | 读端是**进程级全局** | `core.ROLE_PERMS` = import 期在「无租户上下文」下 `_load_perms()` 装载 ⇒ **全平台一份** |
| 3 | `reload_perms()` **串味** | 旧实现是全局单值，任何一次保存都把全局换成「**保存者所在租户**」那一份 |

实测判据（修复前）：同一令牌带 `X-Tenant-Id: 1 / 9 / 10` 打 `GET /api/role-permissions`，
三次返回**逐字相同**（8 角色）；而 `tenant_1.db` 里的自定义角色 `库管` 在返回中**根本不存在**
（既读不到、也改不了）。⚠️ **当时不是泄漏**：读路径与写路径**都锁主库** ⇒ 系统内部自洽。
真缺陷是**能力缺失**（租户级配置无处安放）。

### 地基其实早就在（别重复造）

`erp_db.py` 的 v110 迁移「role_permissions 主库 → 租户库」注释里明写「收敛方向=以租户库为准」，
并已在**每个租户库**建表灌数据 —— **断的只是读写端**。

### v205 的修法（五处）

1. `core.py`：`_load_perms` / `ROLE_PERMS` / 旧 `reload_perms` **整段替换**为按租户分叉 ——
   `_PERMS_CACHE {tenant_key: {role: perms}}` + `RLock`（键 `0` = 无租户上下文）／
   `_tenant_key` / `current_tenant_key` / `effective_tenant_key` / `_read_custom_perms(tid)` /
   `perms_for(tid=None)` / `perms_for_effective(user=None)` / `reload_perms(tid=None)`（**只失效本租户**）／
   `known_roles(tid=None)` / `_check_perm(..., tenant_id=None)`。
   有效权限 = `{**_DEFAULT_PERMS, **本租户自定义}`（按角色整表覆盖，语义与旧实现一致）
   ⇒ 某角色没被本租户配过时**自动回落默认**，不会因为「租户只配了 3 个角色」就让其余 5 个
   变成「每个模块都 403 的僵尸账号」。
2. `db/connection.py`：新增 `tenant_scope(tenant_id)` 上下文管理器（退出恢复原值、可安全嵌套）。
   🔴 两条约束：`tenant_id` **只能来自已校验的成员关系**（`set_tenant_context` 会**建库**）；
   它**不替代** tenant 中间件。
3. `erp_db.get_all_role_permissions(tenant_id=None)`：显式按租户读；表不存在返回 `{}`、
   坏行跳过并 warning（一行脏数据不该让整个租户的权限表读不出来）。
4. `server.py`：`/api/role-permissions` **移出** `_TENANT_MASTER_PREFIXES` +
   新增 `_perms_tenant_or_400()`（四个端点 fail-closed，取不到租户上下文就 400，
   **绝不回落主库** —— 回落会变成「保存成功、但不生效」的静默失败）。
5. `routers/auth.py` `/permissions`：改 `perms_for_effective(u)` —— 该接口在「登录后拉一次、
   决定侧栏显示什么」时被调用，请求**可能不带** `X-Tenant-Id`，故先看请求上下文、
   再按该用户的租户归属回落。

### 🔴🔴 两个最容易踩的坑（各有一个真实判据）

**(1) RBAC 中间件在最外层 ⇒ `_check_perm` 必须显式传 `tenant_id=`。**
它先于 auth / tenant 中间件执行，被调用时 `db.get_tenant_context()` **还没有值**。
不传 ⇒ 拿内置默认放行一个**已被本租户撤销**的模块 = **撤销失效（越权）**，比没有这功能更糟。
⚠️ 解析纪律：**先 `db.check_user_tenant(user["id"], v)` 才敢用这个 id** —— 因为取值路径
`perms_for(tid)` → `tenant_scope` → `set_tenant_context`，后者在租户库缺失时会**建库**（v88 兜底，
建的是整库 schema）⇒ 盲信请求头 = 「带个随机 `X-Tenant-Id` 打任意接口」就能让服务端为每个随机 id
建一整套库 = **DoS 放大**。

**(2) 🔴 豁免 RBAC「模块判定」≠ 放宽访问控制。**
`/api/role-permissions` 必须豁免**模块判定**：它映射的模块是 `hr`，一旦某租户误把 boss 的 `hr`
撤掉，老板就打不开「**唯一能把它改回来**」的页面 ⇒ **自我锁死且无法自救**。
⚠️ 但**豁免不是「任何登录用户可读」** —— 豁免前 GET 只要求 `_auth` ⇒ `sales`/`supervisor`
都能读全租户角色→模块矩阵（原实现由 `hr` 拦着）。改用 `core._admin`
（判 `role in ("admin","boss")`）：**按角色名**把关、不依赖 `hr` 模块，两头都成立。
护栏：`tenant-perms-scope-check.py` 的 **A13c**；判别反例 ⑫。

### 连带修掉的产品既有真 bug（v205-D）

`routers/salary_send.py` 两处把 `db.salary_detail_get(...)` 当 **dict** 用 `slip.get(...)`，
而该函数委托 `get_salary_details`、返回的是 **list** ⇒ 员工当月**有**工资明细时抛
`AttributeError: 'list' object has no attribute 'get'`（HTTP 500）。
**非本轮引入**；生产至今不可达的唯一原因是 `salary_details` 全库 **0 行**（走 `if not slip`
的优雅分支），而「算工资」一旦跑起来就会命中 —— **而让会计能算工资正是 v205 的交付内容**。
⇒ **通用教训：`xxx_get` 这类名字是单数、返回是 list 的 API，是「按名字猜语义」的陷阱。**

### 连带缺陷（同批查出，**仍未修**）

- `库管` 这类**租户自定义角色**曾是**孤儿**（不在全局 `ROLE_PERMS` ⇒ 命中空表 ⇒ 零权限僵尸账号，
  且 `normalize_role` 白名单会 400 拒绝派发它）。v205 后 `known_roles(tid)` / `normalize_role`
  按租户取 ⇒ **自动正确**。
- 🔴 `field_permissions`（**字段级**权限）**有表、有 API、无人消费**：tenant_1 有真实配置
  `('sales','product','purchase_price',0,0)`，但全仓唯一消费方是 `routers/platform.py:573/577`；
  `GET /api/products`、`/api/employees` **无任何读路径**调用它 ⇒ **配了不生效**。别当已有能力。
- `user_tenants.role`（`admin`/`member`）**不参与鉴权** —— `check_user_tenant` / `get_user_tenants`
  只查 user_id/tenant_id。**别误当「按租户角色」机制**。

### ⚠️ 前端两处「无门禁」（v205 有意不动，**已知缺陷**）

侧栏「设置」与「算工资」都是**无条件 router-link（无模块门禁）**：
- 老板**永远进得去**权限页 ⇒ 这正是「`payroll` 不必加进前端 `Settings.vue` 的 `CRITICAL_MODULES` 也能自救」的原因；
- 但没拿到 `payroll` 的会计会**看到「算工资」菜单**、点进去接口 403 —— 既有「有菜单无权限」族缺陷。

### 后续（拍板结论）

- **P0 ✅ 已做**（按租户分叉）｜**P1 ✅ 已做**（拆 `payroll` 窄模块）——二者**必须同批上线**，
  只做 P0 等于「能按租户配权限了，但没有可配的窄模块」。
- **P2 ❌ 不做**（用户：「不能查，靠推送」）—— 维持工资条**推送**，不做「员工自查」自我作用域。
  ⇒ `/api/salary-slip/{eid}/{month}` 仍**可按任意员工 + 月份枚举**（无「只能看自己」检查）；
  当前靠 `payroll` 模块把门（员工没有该模块就 403）。

📄 原始分析与三方案对比：`outputs/员工薪酬信息归属与访问控制分析-2026-09-19/`
｜交付报告：`outputs/权限按租户分叉与算工资窄模块-2026-09-19/`

---

## 🔴 legacy 权限数组 = 「全动作放行」（2026-09-24 核实，影响面全站）
- `core.py::_check_perm`：
  · `if "*" in perms: return True`
  · `if isinstance(perms, list): return module in perms`  ← 注释原文「Legacy format: list of module names — **grants all actions**」
  · 只有 **dict 格式**才细分动作：`return action in mod_perms`
- `server.py` 中间件确实把 method 映射成动作（`{"GET":"read","POST":"create","PUT":"update","PATCH":"update","DELETE":"delete"}`），
  但**对 legacy 数组形同虚设** ⇒ 只要某角色的模块权限写成数组，该模块的**增删改查一并放行**。
- 生产实测：`tenant_1.role_permissions` **只有 2 行**（`库管`→`["dashboard","stock","data"]`、`supervisor`→`["data","dashboard"]`），
  其余角色（boss/sales/accountant/admin/driver/warehouse）全走 `_DEFAULT_PERMS`；而 `_DEFAULT_PERMS` 里
  **除 `admin: ["*"]` 外全是 legacy 数组** ⇒ **默认权限表里没有任何写操作限制**。
- `perms_for(tid)` = `{**_DEFAULT_PERMS, **_read_custom_perms(key)}` —— 按**角色整表覆盖**（不是按模块合并）。
- ⚠️ **`sales` 是模块名，业务员角色名也叫 `sales`** —— 同名不同物。「角色 sales 恰好拥有 sales 模块」纯属
  `_DEFAULT_PERMS["sales"] = ["dashboard","ops-workbench","sales","buying","stock","crm","data"]` 里的巧合式全开。
- ⚠️ **前端侧栏不是安全边界**：`Shell.vue` 15 条入口里**只有「算工资」一条**带 `v-if="store.canModule('payroll')"`
  （桌面 :48 / 移动 :96），其余（含「目标与返利」「档案管理」）**全部裸奔**。权限必须落在服务端。
- 🔴 **写操作的角色级收口要靠路由内显式校验**（`_auth` 只验登录，不验角色）——
  例：`routers/rebate_achievements.py::upsert_achievement` 只有 `_auth(request)`。


## 🔴 v292（2026-09-27）「权限变了没」怎么让别的会话知道：内容指纹 + 极轻端点

### 新增（都在 `core.py` / `routers/auth.py`，纯只读派生，**不新增写操作**）
| 函数 / 端点 | 作用 |
|---|---|
| `core.perms_rev(tid=None)` | 本租户自定义权限表的**内容指纹**：`_canon_perms` 归一 → `json.dumps(sort_keys, separators)` → sha1 前 12 位。空表 ⇒ 固定常量。 |
| `core.custom_roles(tid=None)` | 本租户**真实改过**权限的角色名（升序）。前端用它决定"内置 `roles` 门槛是否让位"。 |
| `core._canon_perms(v)` | 两种合法形态（list `["stock"]` / dict `{"stock":["read"]}`）→ 同一形状（模块名升序去重）。**只比模块集合，不比动作**。 |
| `GET /api/auth/permissions` | **只加不改** `perms_rev` + `custom_roles` 两个键。 |
| `GET /api/auth/perms-rev` | 极轻端点，只回 `{perms_rev, tenant_id}`。供前端每 60 秒 / 切回标签页比对。`_auth` 就够（不回权限内容、不回角色名）。 |

### 🔴 为什么版本号用「内容指纹」而不是时间戳
`updated_at` 会因为「保存了一次但内容没变」而变化 ⇒ 前端每次比对都不同、每次都要重拉整份权限表，把「每 60 秒一个几十字节的比对」放大成「每 60 秒一次全量拉取」。指纹只认内容。

### 🔴🔴 最贵的那一条：`custom_roles` 必须按「**内容 ≠ 内置默认**」判，不能按「表里有行」
设置页「保存权限」是**逐角色全量 POST**（`savePerms` 遍历整张矩阵）⇒ 老板点过一次保存，**每个角色都会在租户库留一行**（值与内置默认逐字相同）。
若按「有行」判 ⇒ `roles` 轴对**所有正常租户**整体失效 = 把 v291 的「按角色收窄入口」悄悄拆掉，**且不报任何错**。
实测判据（离线单测）：全量回写（boss/staff 值与默认相同）⇒ `custom_roles` 返回 `[]`；把 staff 的 `chat` 去掉 ⇒ 返回 `['staff']`；租户自定义角色 `库管`（不在 `_DEFAULT_PERMS`）只要有非空模块即入选；空权限的自定义角色不入选。
生产实测 tenant_1：表里 2 行（`supervisor`、`库管`），两者都**真差异** ⇒ 此时两种判法恰好同解（所以"只跑一次生产"**证不出**这条判据的价值，必须靠离线对照）。

### 其它纪律
- **`/api/auth/permissions` 被小程序共用**（`miniprogram/utils/perm.js:99` 权限闸 + `pages/login/login.js:141`）⇒ **只能加键，不能改/删既有键**。本轮新增只加两个键，小程序侧零影响。
- `/api/auth/*` 在 `_TENANT_PUBLIC_PREFIXES` 里 ⇒ 租户上下文恒为 `None` ⇒ 新端点必须与 `/permissions` 一样走 `effective_tenant_key(u)`（请求上下文无值时按用户首个租户回落），否则会拿 `_NO_TENANT` 那份"只有内置默认"的表来算版本。
- `custom_roles` 会把租户自定义角色（如 `库管`）算作"被改过"。对它们**无影响** —— `roles.js::roleIn()` 对**未知角色是 fail-open**（返回 true），它们本来就通过所有角色门槛。
- ~~🔴 顺带记一个**既有洞**（本轮未修）：租户自定义角色（`库管`）能通过**所有** `roles` 门槛（fail-open 是给"启动瞬间空角色"设计的，被"真未知角色"借用了）⇒ 配了 `库管` 的账号会看到「设置 / AI 团队」入口，点进去被 `_admin` 403。要修得让 `roleIn` 区分"空串（未知=未加载）"与"非规范角色名（配置漂移）"。~~
  ✅ **v296 已修**：`roleIn()` 现在把「未知」分两判 —— **空串 = 未加载 ⇒ 放行**（启动竞态，技术性）；
  **非空但不在 `ROLE_NAMES` ⇒ 收紧**。生产 `custom_roles` 实测含 `库管` ⇒ 当时确实是活洞。
  ⚠️ 分工：`roleIn` 判**内置门槛**（真未知**先收紧再查名单** ⇒ 对它恒 false）；「让位」不经它，走 `roleGateOpen` ③。

---

## v296：给一个**粗模块**做「拆细」时的三处缺一不可（`data` → `cron` / `bid`）

**病因**：`data` 一条模块管 **83 个接口前缀**，业务名却叫「档案管理」。老板勾「档案管理」（本意只给档案），
`/api/cron`、`/api/bid-radar` 的接口权限一并被授 ⇒ 与「用户配置优先（让位）」叠加后，侧栏凭空多出「定时任务」。
**拆细是让位规则的**前置修复**：让位的前提是「勾了这个模块 = 想开这一页」，`data` 不满足。**

| 处 | 位置 | 少了它会怎样 |
|---|---|---|
| ① | `core._ALL_MODULES` | 权限页**勾不到**新模块（界面上根本没这一项） |
| ② | `server.py::_PATH_MODULE_MAP` | 接口**仍按旧模块**裁决（拆了也不生效） |
| ③ | **迁移脚本** | 老租户里"原本靠 `data` 就能调"的角色**全部 403**，而页面照样打得开 ⇒ **进得去、拉不到、零报错** |

🔴 **迁移判据必须是「谁原本真能调」**，而不是「凡含旧模块就补」：
写死**产品默认**就持有旧模块的角色名（`/api/cron` 旧 = `data` ⇒ boss/sales/staff/supervisor；
`/api/bid-radar` 旧 = **`reports`** ⇒ boss/accountant **＋ sales**，因为 `pages.js` 名单要求它）；
**客户手工勾出来的旧模块权限不补** —— 那正是要消除的连带。写成"凡含 `data` 就补" = 把原问题原样带过去。
🔴 **部署顺序：先迁库 → 后部署代码 → 再重启。** 补新模块是**纯新增**（旧代码只判旧模块、新模块无人读）⇒
迁库瞬间**零行为变化**；反过来会有"新代码 + 未迁库"的 403 窗口。

### 🔴 `_PATH_MODULE_MAP` 的匹配语义：**首个 `startswith` 命中即停（按插入顺序）**

⇒ **更早的泛化前缀会静默遮蔽更晚的精确键**。v296 实测：**全表 301 键里有 13 条被遮蔽**，
其中 **12 条遮蔽者与被遮蔽者同模块**（无害）；**跨模块的只有 2 条**：

- `/api/bid-radar`(想归 `data`) ← **`/api/bi`(reports)** 吞 —— ⚠️ v296 前的真实状况：这条**一直是死映射**，
  实际按 `reports` 鉴权，而**代码注释与 `pages.js` 都写着"归 data"，两处都错**；后果是**假入口**
  （pages 放 sales 进、sales 没有 `reports` ⇒ 点进去必 403）。✅ v296 已把精确键提到 `/api/bi` **之前**。
- `/api/pricing-settings`(hr) ← `/api/pricing`(sales) 吞 —— **既有，v296 未动**（动它 = 改 `pricing` 域鉴权，需单独评估）。

**可复用做法**：拆模块/加映射前，先跑一遍「遮蔽审计」（对每个键，找**第一个** `startswith` 命中的表项，
看是否 != 它自己）；**加新键时把精确键放在泛化键之前**，并在注释里写明"这不是排版偏好"。
**验收要用正反例**：`/api/bid-radar` 403→200 **且** `/api/bi/summary`、`/api/reports/export` **仍 403**
—— 只有反例能证明"遮蔽解除了、而 `reports` 域**没有**被顺手放宽"。

---

## 「设置 › 权限」与「员工档案 › 账号」是**两条链**（2026-09-27 双链审计实测）

> 完整报告：`outputs/权限配置双链审计-2026-09-27/00-权限配置双链审计报告.md`｜取证脚本 `perms-dual-chain-audit.py`。**本轮零代码改动。**

### 分层（标准 RBAC 两层，**别合并**）

| | A 链「设置 › 权限」 | B 链「员工档案 › 账号与权限」 |
|---|---|---|
| 语义 | **角色 × 模块** —— 这个角色能干什么 | **账号 × 角色** —— 这个人是谁 |
| 粒度 | 模块级（勾 = 该模块全动作） | 账号级（1 主角色 + N 兼任，v266） |
| 落库 | **租户库** `tenant_<id>.db::role_permissions`（每租户一份） | **主库** `erp.db::users.role / roles`（全局单表） |
| 写接口 | `POST /api/role-permissions`（+ `/detail` CRUD 版） | `PUT /api/users/{uid}/role`｜开账号 `POST /api/forecast-submissions/staff-accounts` |
| 读接口 | `GET /api/role-permissions` + `/api/permissions/modules` | 员工列表 enrichment（`erp_db.py:6908` 下发 `account_role/account_roles/account_user_id`） |
| 鉴权 | 四端点一律 `core._admin`（admin/boss）＋ 中间件**豁免模块判定**（防自锁） | `_assert_user_manageable`（admin/boss **且**目标在同企业内，v254 防跨租户接管） |

### 🔴 唯一的接触面 = `core.known_roles(tid)` = `_DEFAULT_PERMS.keys() ∪ perms_for(tid).keys()`

**只在 B 链写入时校验**（开账号 / 改角色）⇒ 方向是「A 定义 → B 引用」，是对的（不另抄角色清单）。
**但它只接了「写」，没接「读」和「提示」** ⇒ 于是有三处断点：

1. **A 链配得出、B 链指派不了**：`EmployeeArchive.vue::ROLE_OPTIONS` 是**前端写死 8 项**（= 内置角色），
   不含租户自定义角色；而 `known_roles(tid)` **含**它们 ⇒ **后端放行、UI 走不通**。
   · 实测：`tenant_1` 的 `库管` 在 `role_permissions` 里有 4 个模块（客户真配过），
     但 `users.role` 里 **0 个 `库管`** ⇒ **配了没人用（死配置）**，且只能手改库才指得上。
   · 🔴 **这类漂移结构上不可能有构建期护栏** —— 护栏是静态的，自定义角色是运行时数据
     ⇒ 只能改成**从后端动态取值域**（这是唯一解，不是优化）。
2. **自定义角色对 `module: null` 的页面拿不到让位**：`pages.js::roleGateOpen` ③ 要求 `r.module` 非空。
   而 `/archive` `/rebate` `/loss` `/forecast` 的 `module` 都是 `null` ⇒ 自定义角色**一律 false**。
   ⇒ 客户给 `库管` 勾了「档案管理」，它**进不去「档案管理」页**（勾了等于没勾，零提示）。
3. **B 链改角色无缓存失效 / 无版本号**：`UPDATE users SET role=?` 之后没有任何 rev bump
   ⇒ 该用户**当前会话照旧**，要重新登录才生效。

### 🔴 生效时机对照（两链**不对称**，是排查「改了没生效」的第一判据）

| | A 链 | B 链 |
|---|---|---|
| 缓存 | `_PERMS_CACHE[tid]`，`reload_perms(tid)` **只失效本租户** | **无缓存** |
| 版本号 | `perms_rev(tid)` 内容指纹（sha1 前 12 位），前端轮询比对 | **无** |
| 本会话 | `syncStorePerms()` 当场重拉 | **不变**（要重登） |
| 其它会话 | 最迟 **1 分钟**（`perms_rev` 轮询） | 重登后 |

### 五份角色名清单（护栏覆盖静态，覆盖不了运行时）

① 后端 `core._DEFAULT_PERMS`（**权威**）② 网页端 `constants/roles.js::ROLE_NAMES`
③ 小程序 `utils/roles.js::ROLE_TEXT` ④ `EmployeeArchive.vue::ROLE_OPTIONS`（🔴 **v300 起不再是「清单」** —— 已改为 **`computed` 动态值域**）
⑤ `Settings.vue::ROLE_LABELS`（措辞更长，故意留本地）
护栏 = `.workbuddy/tools/role-registry-consistency-check.py`（AST 解析后端，**v300 起 44/44**）。

### ✅ 「适用端」文案漂移（v300 **已修**，判据订正而非改期望）

~~`ROLE_OPTIONS` 的 label 写「会计（仅网页端 …）」，而 `_DEFAULT_PERMS` 里 8 个角色全都有 `chat`~~
⇒ **v300 的处置 = 订正「判据本身」**：「能用小程序」从「有 `data` **或** `chat`」
**收窄为仅有 `data`**（理由：`chat` 自 v292/v293 起**全员持有**，已失去区分度）。
「适用端」文案收敛为 **`constants/roles.js::ROLE_END` 全站唯一一份**（`ROLE_END_LABEL` 出中文），
`canUseMiniProgram()` 也改成走它 ⇒ **注释与函数体同源**（原先注释说 data|chat、函数体用硬编码数组，
**同一函数两套口径**的毛病也一并消除）。

### ✅ 护栏的 1 条**假红**（v300 **已修** —— 但根因不在"窗口太紧"）

~~断言「开账号接口接入了白名单」FAIL，真因 = 正则窗口 `[\s\S]{0,900}?` 太紧~~
⇒ **v300 处置**：F 段 5 条窗口判据**全部换成 AST 结构判据** `func_body_has(path, funcname, needle)`
（`ast.get_source_segment` 只取**函数自己源码段**，**不受注释长度影响**；返回 `True`/`False`/`None` 三态）。
🔴 并且 **needle 必须带 `(`** —— v300 判别力自证抓出：把 `normalize_role` 改成 `normalize_role_DISABLED`
后护栏**不报红**，因为改名后的调用**仍含子串** `normalize_role`。
⇒ 判据 = 「**真的是一次调用**」，不是「出现过这几个字」。

### 🟡 `_DEFAULT_PERMS` 迭代 vs 租户库**整表覆盖**（实测存量差异）

`Settings.vue::savePerms` 是**按整张矩阵逐角色 POST** ⇒ 点过一次「保存权限」就在租户库固化 8 行，
此后所有默认值变更**对该租户失效**。实测：`tenant_10` 的 `staff` 少 `chat`（v292 的默认没生效）、
`supervisor` 少 `sales`（v293 的默认没生效）⇒ 该租户主管**看返利冲刺看板 = 页面进得去、数据恒空、零报错**。
✅ **v300 已补漏**（`tenant_10` 的 `staff` += `chat`、`supervisor` += `sales`；工具
`.workbuddy/tools/perms-tenant-backfill.py`，判据四条见本文末 §v300）—— `perms_rev`
`df85b80274d3` → `41e1332af26a`，`tenant_1` **逐字符不变**。
⇒ **改 `_DEFAULT_PERMS` 时必须同步查「哪些租户已固化」**（v293 注释已写明，但该租户库当时没改）。
⚠️ 反向证明 `custom_roles` 的**内容判据**是对的：`tenant_10` 的 `boss`/`sales`/`guide`/`driver`
四行与内置默认**逐字相同** ⇒ 若按「表里有行」判，这四个角色会被误判成「改过」⇒ `roles` 门槛整体失效。

### 🟡 `boss` 行里有 3 个「幽灵模块」

`tenant_10` 的 `boss` 行含 `ops-workbench` / `perf` / `goals`，而 `_ALL_MODULES` **只有 17 项、不含这三者**
⇒ 权限页**不渲染**它们，但它们在数组中生效（`_perm_granted` 认）。非缺陷（v296 已修「保存时静默抹掉」），
但要知道**UI 上少三行 ≠ 它们不存在**。

---

## 🔴 v300（2026-09-27）双链的**缝合**：动态值域 + 存量补漏 + 护栏换 AST

上游 = `outputs/权限配置双链审计-2026-09-27/`（只读）；本轮 = `outputs/权限双链治理-2026-09-27/`。

### 1. 唯一接触面终于**接上「读」与「提示」**（此前只接了「写」）

- 接触面 = `core.known_roles(tid)` = `_DEFAULT_PERMS.keys() ∪ perms_for(tid).keys()`。
  它原先**只在 B 链写入时**被用来校验（**放行自定义角色**）⇒ **后端通、UI 断**。
- **实证的「死配置」**：`tenant_1` 的真角色 `库管`（配了 4 个模块）不在写死的 8 项里
  ⇒ 生产 `users.role` 里 **0 个 `库管`** —— **配了，没人能用**。
- 🔴 **修法 = 前端下拉改 `computed` 动态值域**：`loadRoleCatalog()` 打 `GET /api/role-permissions`，
  **403/异常 ⇒ 静默降级内置 8 项**（指派角色本不该由这些角色做 ⇒ 不弹错）。
  label 的三档优先级 = **`ROLE_END`（产品定义）→ `roleCatalog`（后端实况）→ `canUseMiniProgram`（共享兜底）**。
- 新增 `roleDisplay(r)`：内置走共享表、**本租户自定义角色显示原名**、真未知仍走 `未知角色(x)`。

### 2. 🔴🔴 `is_custom` ≠ 「这是自定义角色」（读真实 payload 才暴露）

`GET /api/role-permissions` 的产物里 `is_custom = role in custom`（即**租户库有行**）。
实测 **`tenant_10` 有 7 个角色 `is_custom: true` —— 全是内置角色**
（`boss`/`accountant`/`sales`/`guide`/`driver`/`staff`/`supervisor`）；`tenant_1` 的 `supervisor` 同样。
⇒ **前端若拿 `is_custom` 当「是不是自定义角色」的判据，内置角色会被重复列一遍**（名字也重复）。
⇒ 唯一正确判据 = 「**名字是否在 canonical 集合里**」（`roles.js::isCanonicalRole`）。
已固化为 E2E 断言：用真数据当反例，断言**内置「主管」只出现 1 次**。

### 3. 存量补漏的四条判据（**宁可漏补，不可误补**）

补模块 `M` 当且仅当四条**同时**成立：
① `M ∈ _DEFAULT_PERMS[role]` ② 租户行**缺** `M` ③ `M ∈ 白名单`（本轮 = `chat`→全部内置角色、`sales`→仅 `supervisor`）
④ **租户行模块集 ⊆ 默认值**（= 客户**没改造过**这一行）。
⇒ 反例：行里多了 `payroll`（客户自己加的）⇒ **整行跳过**。单测 **12/0**。

### 4. 🔴 补漏的**隐藏副作用**：让位状态（必须每次重验）

`custom_roles(tid)` 判据 = 「**内容 ≠ 内置默认**」（**不是**"表里有行"），
它决定 `pages.js::roleGateOpen` ③ 的**让位**（让该角色过**内置 `roles` 门槛**）。
⇒ 补漏若补得「**恰好等于默认**」，该角色会**退出 `custom_roles`** ⇒ 页面对它**重新收窄**
（= 拿走一个用户看不见的功能，**零报错**）。
**v300 实测两边 `custom_roles` 均未变**（`tenant_10` 的 `staff`/`supervisor` 仍各缺 `bid`）⇒ 无副作用。
⚠️ **下次把白名单放开到 `bid`，必须重验这一条。**

### 5. 🔴 `perms_for` 有缓存、`perms_rev`/`custom_roles` 没有 ⇒ 冷读 ≠ 热读

`perms_for(tid)` 带**进程级缓存 `_PERMS_CACHE`、无 TTL**，只有**两个保存接口**会调
`reload_perms(tid)` 手动失效；而 `perms_rev`/`custom_roles` 走 `_read_custom_perms` **直读库不缓存**。
⇒ 新进程探针证明的是「**库里**是什么」，**不等于**运行中进程读到什么。
⇒ 让两者等价 = **重启**（无别的轻量办法 —— `reload_perms` 只在保存接口里，那些都要 admin/boss token）。
v300 实测重启 **约 1 秒**（`21:53:15 → 21:53:20`）。

### 6. `/api/role-permissions` 的**双重把关**（设计如此，别的 403 文案别混）

`server.py:655` 映射表登记 `"/api/role-permissions": "hr"`，但**整族被 RBAC 模块判定豁免**
（防"老板误撤自己的 `hr` 后打不开唯一能改回来的页面"），读端改用 `_admin(request)` **按角色名**把关。
⇒ sales 收到 `{"detail":"Forbidden"}`（`_admin`）；而 `/api/employees` 收到模块门禁的
「你的角色「业务员」没有「人事档案」的使用权限」。**两条 403 文案不同，各属各的门**。

### 7. v310 登录端（`login_scope`）的四条硬判据

- **唯一源 = `core.ROLE_LOGIN_SCOPE` + `default_login_scope_for_role()`**；前端 `roles.js::ROLE_END`
  是它的**镜像**（护栏 D2 段逐项比对）。🔴 这份映射**天然会被写成两份**（前端要下拉默认值、
  后端要建号兜底）⇒ **只改一端 = 静默绕过**（界面看着收紧、开出来的号照样能登网页端）。
  未登记角色 ⇒ `both`（宁可放宽）。
- **判据只能写在 `routers/auth.py::login` 内部**（`/api/auth` 整段在 `_PUBLIC_PATHS`，RBAC 中间件对登录请求不执行）。
  缺 `X-Client` ⇒ **视为小程序**（存量小程序不带头且已备案，必带 = 当场切断所有小程序登录）；
  端被拒**不记失败尝试**（否则累加到「5 次锁 30 分钟」把人误锁）；`LOGIN_SCOPE_ENFORCE=0` 一键停用。
- **建号默认值两处都要接**：`erp_db.staff_account_create`（不传 ⇒ 角色默认）+ `routers/forecast_submissions::create_staff_account`；
  显式传值优先（保住手动开通）。非法值**只在路由层 400**，内部函数只收敛。
- **存量回填**：在线备份用 sqlite **`backup` API**（别 `cp`，库正在被写）；**只动当前是 `both`/空的行**
  （人工值不碰 ⇒ 幂等）；改前改后各留逐行快照 + `rollback.sql`。
  现行值（v310）：`sales ×3 = mini`，`admin/boss/supervisor` 仍 `both`。

### 8. v312 角色级「登录端」= **内置默认 ⊕ 租户覆盖**（与 `_DEFAULT_PERMS` 同构）

**范式**：`_DEFAULT_PERMS`（代码常量）⊕ `role_permissions`（租户库表）→ 本轮把"端"做成**同一范式**：
`builtin_role_end`（代码常量）⊕ `role_end`（租户库表），**读取一律走 `core.role_end_for(role, tid)`**。
⇒ 与 §7 的铁律**完全同源**：**「改一端」= 静默绕过**（这次是三处：内置默认 / 前端镜像 / 建号默认值）。

**核心函数（`core.py`）**
| 函数 | 职责 | 🔴 易错点 |
|---|---|---|
| `MINI_MODULES` | 「手机端真实在用」的模块**唯一源** | 只驱动**只读**列；**不做可勾选**（做成可勾 = 假开关） |
| `builtin_role_end(role)` | 出厂默认（`ROLE_LOGIN_SCOPE` **只在这里被直读**） | 别的任何地方再读它 = 绕过了租户覆盖 |
| `role_end_for(role, tid)` | **唯一取值口**；遇覆盖 `{0,0}` **回落内置** | 别在调用处自己拼 `builtin ⊕ custom` |
| `role_end_is_custom(role, tid)` | = **覆盖表里有这一行** | **故意**与 `custom_roles` 的**按内容**判据不同（端只两个布尔，按内容判会把"正好配成内置值"误判成自定义） |
| `default_login_scope_for_role` | = `end_to_scope(role_end_for(...))` | v310 时它**直读 `ROLE_LOGIN_SCOPE`** ⇒ v312 后若漏改这一处，**界面收紧但开出的号照样登网页端** |
| `end_to_scope(end)` | `{web,mini}` → `'web'/'mini'/'both'` | 前端 `roles.js::endToScope` 是**镜像**，取值域须逐项一致 |

**表下发（`erp_db.py`）**：`role_end` DDL 必须**三处齐**（§洞一的老账）——
① `_safe_migrate('v312_role_end', ddl)`（主库）；② **`ddl_map["role_end"] = ddl`**（各租户库，`for _t, ddl in ddl_map.items()`）；
③ 列对账 `_sync_tenant_columns_on`。⚠️ `master_ddl` 在函数**更早处**采集 ⇒ **后建的表不进 `ddl_map` 就只落主库**，
租户库查询报 `no such table`；而 `get_all_role_end` 有兜底 ⇒ 表现为「**页面恒空、零报错**」。

**防自锁三件套**（`role_end` 是能把人锁在门外的表）
1. **两端不可同时关** ⇒ 路由层 400（关完该角色谁都登不进，**连改回来的页面也进不去**）。
2. `ROLE_END_PROTECTED = ("admin","boss")` **电脑端禁关** ⇒ 400。
3. `role_end_for` 遇 `{0,0}` **回落内置**（宁可放宽）⇒ 兜住任何绕过路由层的脏写入。

**API（`server.py`）**
- `GET /api/permissions/modules`：每模块增只读 `"mini"`。
- `GET /api/role-permissions`：每角色增 `end` / `end_is_custom` / `end_builtin` / `default_login_scope` / `end_locked_web`。
  🔴 它调的是公开取值口 **`role_end_for`**（不是 `role_end_map`）—— 写探针时别认错。
- `POST /api/role-permissions/end`：三条把关（`normalize_role` 白名单 / `not web and not mini` 400 / 保护角色关电脑端 400）；
  与内置**同值即 `delete_role_end`（删行）**；写后 `reload_role_end(tid)` 失效缓存。
- `DELETE /api/role-permissions/end/{role_name}`：恢复出厂。
- 缓存按租户分键：`_ROLE_END_CACHE` / `reload_role_end(tid)` / `current_tenant_key()`。

**前端联动（`EmployeeArchive.vue`）**
- 角色政策**改了不影响在用人**（`accounts.login_scope` 是账号自己的值，**不是动态派生**）⇒ 避免"改角色把在用人锁在门外"。
- 不一致才提示（`df-mismatch`）＋ `alignAccScope()` **一键对齐**。
- 🔴 **`accScopeTouched`**：没手工改过 ⇒ 提交时**省略** `login_scope`（后端按角色政策取默认）；手工改过才发。
  **防的是"前端拿自己猜的默认值静默覆盖掉租户刚在权限页配的政策"**。


## §v326 人名存两份：档案名（权威）vs 账号显示名

- 权威 = 租户库 `hr_employees.name`；右上角读的是主库 `users.display_name`
  （`routers/auth.py::get_permissions` 返回的 `user`）。
- 员工档案「开通账号」**写两份**（前端传 `display_name: editTarget.value.name`）
  ⇒ **先改名后开户**两份一致；**先开户后改名必然分叉**。同一个名字，结果取决于操作顺序
  ⇒ 判定为**漏写**，不要拿"两套东西"替它辩护。
- 修法（v326 已上线）：`erp_db.sync_employee_account_display_name(emp_id, new_name)`，
  由 `PUT /api/employees/{eid}` 在**真改名**（`name != old_name`）时调用，返回 `(affected, error)`；
  失败**不抛异常**（档案名此时已落库，抛 500 会让用户以为没改成而重试），以 `rename_error` 回带前端。
- 🔴 三条不可省的约束：
  ① 关联判据用**唯一实现** `_emp_link_expr(...)` —— ⚠️ 别名必须传**表名 `users`**：
     SQLite 的 `UPDATE` **不支持表别名**，传 `"u"` 抛 `no such column: u.employee_id`，
     而异常被兜底分支吞掉 ⇒ 返回 `(0,"")`、界面只看到「保存成功但名字没变」（单测 A 段当场抓到）。
  ② 租户收口：`users.employee_id` 是**租户内**的 `hr_employees.id` ⇒ 必须用 `user_tenants` 过滤，
     否则会把 A 租户的员工改名同步到 B 租户里 id 相同的账号 = **跨租户串改**。
  ③ `IFNULL(users.external_ref,'')=''`：外部客户（分销商）账号那列名字是「客户名称」，另一套语义（v308/v317）。
- 🔴 **已知耦合（改 sales 员工姓名前必须先决定是否回填）**：`sale_orders.operator_id` 存的是
  **业务员中文姓名**（'程欢欢' 3184 行 / '张俊峰' 2034 行 …），而 `core._doc_owner_ok()` 判定
  sales 角色能否看一张单，比的正是 `operator_id == user.display_name`
  ⇒ 改 `display_name` 会让该员工**历史单据归属断链**（现场表现 =「我的单子都不见了」，且是 404 静默）。
  🔴 **限定语别丢**：`_doc_owner_ok(order, user)` 的**第一行**是 `if user.get("role") != "sales": return True`
  ⇒ 这条耦合**只对 sales 成立**；改 **boss / accountant / warehouse / supervisor / driver** 的名字
  **不影响**单据可见性（曾据此误判「改 boss 名会接上/断掉 376 行」，当场纠正）。
- 🔴 **改名不跟随的四处（别顺手一起改，各有独立语义）**：
  ① `warehouses.name`（「王会计仓」/「赵仓管仓」）= **按员工名派生的仓库名**，员工改名后**不跟随**（既有行为）；
  ② `salary_details.employee_name` = 工资明细**生成时的姓名快照** ⇒ 改它等于**篡改历史凭证**；
  ③ `tenant_members.display_name` = `tenant_id=3` 的**种子行**，与本租户真实账号无关；
  ④ `tenant_1.db` 里**也有一张 `users` 表**（6 行 demo：admin/boss/accountant/sales/warehouse/driver）
     —— **废弃表，别查它**。活库判据：登录走**主库**（`db/connection.py::_sqlite_connect` 用
     `_tenant_db.get() or DB_PATH`，而若登录时**还没有租户上下文** ⇒ 取 `DB_PATH` 主库）。
- 存量（**已全部对齐 2/2**）：emp 5（郝洋 ↔ 赵仓管）、uid 999905（boss，档案名「符号」↔ 账号「王会计」，
  2026-09-29 老板拍板按档案名对齐 ⇒ `sync(emp=3,「符号」) 影响 1 行`，复扫**分叉数 = 0**）。
  验收判据两层：① 库层 `hr_employees.name == users.display_name`；② **接口层**
  `POST /api/auth/login` 与 `GET /api/auth/permissions` 返回的 `user.display_name` 即前端右上角取值
  （用测试账号实测：返回的正是各自的档案名）。
- **无用户级缓存**：`display_name` 每次鉴权直读 ⇒ 改后即时生效，不必重启服务
  （但 SPA 内存里已持有的 `user` 对象要重登/刷新才刷新）。

## §v328 「权限名 ↔ 它真正对应的功能」一致性（2026-09-29 落地）

- 🔴 **幽灵模块**的判据 = `server.py::_PATH_MODULE_MAP` 里**没有任何接口前缀映射到它**。
  有勾选框却 0 映射 ⇒ 勾与不勾**完全等价**（= 假配置）。v328 删掉 `marketing` / `settings`，
  并摘掉 `ops-workbench` / `perf`（它们连 `_ALL_MODULES` 都没进 ⇒ "持有却看不见"的隐形遗产）。
  `goals` 是**反向**的：它有 `/api/goals` 映射却没登记 ⇒ 本轮**补进** `_ALL_MODULES`（可配）。
- 🔴 **删模块必须三处同批**（v296 那条纪律的同一形态）：① `core._ALL_MODULES`
  ② `server.py::list_modules` 的译名表（含 `_MODULE_CN` 403 文案表）
  ③ **迁移脚本清存量**（`tools/v328-drop-ghost-modules.py`）。
  漏 ③ 的后果：裁决上无害（0 接口），但**权限页一直显示那个勾**（读的是
  `{**_DEFAULT_PERMS, **custom}`），假配置继续摆在老板面前。存量实测 tenant_1/10 各 4 行。
- 🔴 **造角色：堵后门必须与开正门同批**。
  后门 = `POST /api/role-permissions` 只判非空 ⇒ 任意字符串落库 ⇒ 拼错的名字变成
  **永不命中的死配置**，还会进 `known_roles()` 变成"可派发的合法角色"（派给谁谁全员 403）。
  正门 = `POST /api/role-permissions/new`（v328 新增，可 `from_role` 复制权限与登录端）。
  校验唯一实现 = `core.validate_role_name(role, tid, allow_new)`：内置恒合法；自定义须过
  长度 ≤16 与符号黑名单，且 `allow_new=False` 时还得**已存在于本租户**
  （⚠️ 判"本租户"而不是 `known_roles()` 全局 —— 否则 A 客户的角色名在 B 客户也算合法）。
- 🔴 **改角色不动登录端**（`PUT /api/users/{uid}/role`）：v307 契约是「账号事实优先」，
  自动改 = 静默收回一个人的登录能力。v328 的做法是**把漂移摆到台面上**：端点返回
  `default_login_scope` / `login_scope` / `scope_drift`，前端在 `scope_drift` 时弹
  「按新角色对齐吗？」（默认建议对齐、但**不静默**）。
- 🔴 **许诺差距（本轮真正的产品问题）**：多数页面入口走 `pages.js` 的**角色门槛**（`module: null`），
  勾模块**不会**让它们出现 ⇒ 界面在许诺一件兑现不了的事。修法不是改判据（判据是对的），
  是把「勾了会怎样」写进界面：`core.MODULE_IMPACT` 分 `entries`（入口跟着变）与
  `feeds`（入口不变、页面里的数据要靠它）。护栏 §G 段逐项比对它与 `pages.js`。
- 🔴 **旧前端是收缩默认权限的前置条件**：`erp.hergent.cn`（`hergent-erp/static`）与新前端
  **共用后端**，且旧前端**没有按角色隐藏页面**的机制 ⇒ 页面对所有人显示、靠后端 403 兜
  ⇒ 撤模块的后果是「页面还在、点开全 403」，比"不给看"更糟。v328 实测：
  `stock` 被旧前端 17 个文件调用（含 `mobile.html` 扫码链路）、`sales` 7 个（含 `driver-board.js`
  司机看板）、`buying` 4 个 ⇒ guide/driver/staff 的这些模块**一律不撤**。
  只撤了 `cron`/`bid`（旧前端 0 调用 + 小程序只调 `data`）。
  ⚠️ 顺带  发现既有缺陷：`driver-board.js` 调的是 **sales** 模块，而 driver 默认只有
  `dashboard`+`stock` ⇒ 司机看板对 driver 默认 403（待老板确认该页是否已废弃）。

## 🔴 v332（2026-09-29）：`forecast-audit` 拆模块 ＋ **租户覆盖行漂移**（主管缺 `data`）

- **病灶一（模块归属错）**：`/api/forecast-audit/*`（审核 / 定稿 / 采纳 / 厂家返利视图）整段归
  `stock`，且**全程只有 `_auth()`、无任何角色白名单** ⇒ 后果两头都错：
  · **过授权**：持 `stock` 的司机 / 导购 / 销售**都能调 `/audit-period/adopt` 把报单定稿**；
  · **该有的没有**：主管（无 `stock`）看得见「预报订货管理」入口，却审核不了、返利区恒空。
  ✅ 拆独立窄模块 `forecast-audit`，默认给 **admin / boss / supervisor** —— 与
  `forecast_submissions.py::SUMMARY_ROLES` **逐项对齐**（能看全公司汇总的人 = 该能审核它的人）。
  🔴 **顺序陷阱**：`/api/forecast-audit` 也 `startswith("/api/forecast")`（归 `data`），
  而 `_PATH_MODULE_MAP` 是**首个命中即停** ⇒ 登记行必须在 `/api/forecast` **之前**；
  验收判据不是"写没写"，而是**实测解析到哪一个**（拆错就会把 `data` 域的人放进来）。
- **病灶二（真根因，最隐蔽）**：`tenant_1.db::role_permissions` 的 `supervisor` 行是
  **2026-08-30 写入后冻结**的，**缺 `data`** —— 而代码 `_DEFAULT_PERMS['supervisor']` 一直有它。
  `perms_for` = `{**默认, **租户}` **按角色整表覆盖** ⇒ 租户行一旦存在，代码侧对默认表的
  任何增改（v293 加 sales、v296 加 cron/bid、v325 撤 chat、v330 加 messages）**都不会同步**。
  ✅ 迁移**只补不删**；查法 = 把每个库的每一行与期望表逐项比（`tools/v332-perms-drift-audit.py`，
  只读）。🔴 **同类遗留**（本轮**只报告不动手**，收紧权限须单独拍板）：租户库 `sales`/`staff`
  **多出** `cron`/`bid`（v328 撤默认时未迁库 ⇒ **收紧对老租户无效**）、`tenant_10 accountant` 多 `bid`。
- 🔴 **验收入口铁律**：**401 / 403 都发生在「路由存不存在」之前**（RBAC 中间件在路由匹配之前
  按模块裁决）⇒ 验证路由/权限**必须用有权限角色的令牌**，并逐条写**期望状态码**；全程只读 GET。
  ⚠️ **别借用户身份**：生产 `sessions` 里通常已有同角色的其它会话（本轮用的是"微信审核-主管"），
  优先用它，避免冒用老板/报障人的会话。

## 🔴 v334（2026-09-30）：**动作轴（action）细粒度** —— 「四层全通、前端没接上」＋三处静默失效

老板给舟谱截图问「为什么没有更细粒度的权限配置」。**答案不是没做，是做了但读不到** —— 这一类
「功能齐备却整条失联」的形状在本仓反复出现（v333b 的 `is_default` 同族），判据值得记死。

### 1. 机械原因：`list` 形态把 `action` **短路**掉（这是第一判据，先查它）

`core._perm_granted(perms, module, action)` 兼容两种形态：
- `dict` = 新版细粒度：`{模块: [动作…]}` ⇒ **真的会读 `action`**；
- `list` = legacy：分支写着 `return module in perms` ⇒ **`action` 参数被忽略、恒等于「全动作」**。

⇒ 生产两库**16 行 `role_permissions` 全是 `list`** ⇒ 动作轴**从未被读过一次** ⇒ 界面没有承载动作的列，
**是必然结果，不是漏做**。
🔴 **判据**：问「某条权限到底有没有被读」时，**先看库里那一行的形态**，不要看有没有 UI 控件。

### 2. 四层链路（改/查都按这四层走，缺一层就白改）

| 层 | 位置 | 作用 |
|---|---|---|
| ① 方法 → 动作 | `server.py` 中间件 | `GET=read`／`POST=create`／`PUT=update`／`DELETE=delete` |
| ② 门禁 | `server.py` RBAC 中间件 | 用 `_PATH_MODULE_MAP` 判模块 + 动作 |
| ③ 判定 | `core._perm_granted` | `dict` 形态才看动作 |
| ④ 存储 | `role_permissions.permissions`（JSON 列，**整列覆盖**） | 形态即 `list`/`dict` |

### 3. 三处静默失效（v334 全修；同族改动必逐条排查）

- 🔴 **(a) 双写端点互相拍平**：`POST /api/role-permissions`（收 `list`）与
  `POST /api/role-permissions/detail`（收 `dict`）写**同一行的同一列**，而
  `erp_db.save_role_permissions` 是**整列覆盖** ⇒ 用户在旧矩阵上保存一次，**细配被静默拍平成 `list`、
  零报错**。修法：`core.normalize_perms_shape()` 收敛形态 ＋ `core.merge_module_list_into()`
  **旧矩阵保存时沿用已有动作**（两处都有的模块保留 `existing`；新勾选给全动作；取消则移除）。
  ⇒ **可复用判据：同一列有 >1 个写端点时，先确认它们写的是不是同一种形态。**
- 🔴 **(b) 端点漏角色名校验**：`/detail` 没接 v328 的 `core.validate_role_name` ⇒ **造角色后门**
  （可凭任意角色名落库）。**加新写端点时必须回头对齐 v328 的三道校验，否则后门复活。**
- 🔴 **(c) 只读 POST 被判成 `create`**：11 条「用 POST 做的查询」在动作轴下要求 `create` ⇒
  用户「收紧写权限」取消「新增」时**误伤整条 AI 副驾**。修法：`server._READ_ONLY_POST` 白名单
  （`_READ_ONLY_POST = tuple(...)`，中间件把 `action` 从 `create` **纠偏成 `read`**）。
  ⚠️ **白名单宁缺勿滥**：157 个 POST 端点**无法自动分类** ——
  ① 按 HTTP 方法误伤面过大；② 看函数体内写 SQL **136/157 查不到**（写操作下沉在 `erp_db`）；
  ③ 看 `db.*` 调用名会把 `employees/{eid}/toggle`、`users/{uid}/password` **误判成只读**。
  三次自动尝试全失败 ⇒ **只能人工核定**。

### 4. 🔴 **零迁移的诀窍**：`_DEFAULT_PERMS` 保持 `list` 不动

`list` 天然 = 「全动作」⇒ 出厂默认行为**逐条不变** ⇒ **不需要任何迁移脚本**，配 **504 项等价性硬证明**
（内置角色 × 模块 × 四动作，新旧判据结果全等）。⇒ **可复用：给某轴「加细粒度」时，把旧形态定义成
「该轴的满值」，就能把迁移成本降到 0**（同 v312 登录端「内置默认 ⊕ 租户覆盖」的思路）。

### 5. 下发口（**只增不改**！）

`routers/auth.py::/permissions` 增 `"permissions_detail": user_module_actions(u)` ——
该接口**被微信小程序共用** ⇒ 只加字段、不动旧字段。`user_module_actions` = 多角色**并集取宽**；
`admin` 的 `["*"]` ⇒ `{"*": [全部动作]}`。

### 6. 一条「主动不做」的边界（避免造假开关）

**不照抄舟谱的「导出／导入」两列**：动作轴由 **HTTP 方法推导**，而导出/导入**都是 `POST`**、
不是方法级语义 ⇒ 硬做只会造出**点了不生效的假开关**（比不做更糟）。
⇒ **判据：新开关必须能指到一条真正的服务端判定；指不到就不做，并如实说明。**

### 7. v334 落点 / 验证

- 后端：`core.py`（`normalize_perms_shape`／`merge_module_list_into`／`user_module_actions` ＋
  `_ALL_ACTIONS`／`_ALL_MODULES`）、`server.py`（`_READ_ONLY_POST` ＋ 中间件纠偏 ＋ 两保存端点收敛）、
  `routers/auth.py`（`permissions_detail`）。
- 前端：**只动 `Settings.vue` 一个文件** —— 权限 tab 内「按角色配置 / 批量总览」切换；角色列表 →
  点进单角色详情（模块分组 × 四动作列 ＋ 整行全选）；旧矩阵包进 `v-if="permView==='matrix'"`
  **原样保留**（这就是「不影响已有权限」的界面落法）。
  🔴 **不做新路由**：`/roles` 已被 AI 团队占用；`/settings` 的 `module: null` 是**刻意**的（避免老板自锁）。
- 测试：`server/tests/test_role_action_matrix_v334.py` **42/42**（A 等价性 504 项／B 细粒度生效／
  C `admin` 通配／D 四形态矩阵／E merge 不丢动作含反例自证／F 白名单可达性**静态 AST 提取**
  —— ⚠️ **不能 `import server`**，会拉起整个 app 要 `DEEPSEEK_API_KEY`／G 影子库端到端）。
  ⚠️ 影子库隔离**变量名是 `ERP_DB_PATH` 且必须赋值**（`setdefault` 无效），并加自证断言
  `assert abspath(db.DB_PATH) == abspath(MASTER)`。
- 上线：3 个后端文件 ＋ **重启**（`perms_for` 缓存**无 TTL**）；前端 `index.html` `290477ab…`
  三方一致、assets **1772 → 1803 只增不删**。回滚锚 `/root/backup_v334_20260930-133310/`。
- ⚠️ **起号撞车**：同日另一会话已占 `v334`（对外材料）⇒ 本线登记为 **`v334-角色权限细粒度`**
  （代码产物已落盘 `v334_*`，**不重命名**）。

## §v335 🔴 门禁的模块键必须取「**接口的模块**」，不是「页面的模块」（2026-09-30）

**v335 = 把动作轴从接口层下沉到页内按钮**（前端 16 文件 157 处。后端**零改动**）。

### ① 🔴 唯一最容易写错的判据

`constants/pages.js` 的 `module` 只决定**入口显不显示**，**与接口归属经常不同**。按页面模块写门禁
= 造「假入口」（按钮亮着、一点 403）。实测分歧（本轮活体验证）：

| 页面 | 页面 `module` | 写接口实际归属 |
|---|---|---|
| 客户档案 | `crm` | **data**（`/api/contacts`） |
| 员工档案 | `hr` | **data**（账号六件套 `/api/users/*`） |
| 渠道与价格 | `null` | **data** |
| 库存效期补录 | `stock` | **data**（`/api/import/*`） |

⇒ 权威源只能是后端 `_PATH_MODULE_MAP`（护栏 **AST 直读 `server.py`**，不维护第二份清单）。

### ② 🔴 动作 = HTTP 方法，不是业务语感（写错就会「门禁撒谎」）

`GET=read`／`POST=create`／`PUT·PATCH=update`／`DELETE=delete`。反直觉实例：
**「停用/启用」「重置密码」「撤销导入」「保存价格矩阵」「结算」「申领」「审核通过/驳回/冲销」全是 `create`**。
「编辑规则」按钮其实是**两种动作**（新建 POST / 编辑 PUT）⇒ 同一按钮须按状态二选一。

### ③ 🔴 只读 POST 白名单漏了**同族兄弟** —— `simulate-batch`（真实发现，待修）

`_READ_ONLY_POST` 已登记 `/api/rebate-contracts/simulate`，**却漏了 `/api/rebate-rules/simulate-batch`**
（`routers/rebate_rules.py:2059`，文档原文「把返利算法唯一留在后端」，同族 `/simulate` 注明「What-if 用，**不落库**」）
⇒ RBAC 按 HTTP 方法判成 **`create`**。**后果**：`/rebate` 默认 tab（仪表盘）**一加载就发 11 次**该 POST；
角色若被收窄成只读，**这一页一打开就 403**，且前端 `catch` 吞掉 ⇒ **图表静默空白、零报错**。
**修法**：补 `/api/rebate-rules/simulate`（`startswith` 前缀一并覆盖 `-batch`）。

⚠️ 另 7 条语义只读的 POST 待逐个判定：`/api/forecast/supplier-po`、`/api/product-targets/extra-alloc/preview`、
`/api/forecast-audit/compute`、`/api/forecast-audit/audit-period`、`/api/forecast/nl-edit`、
`/api/import/preview`、`/api/forecast/rebate-gap`。**本轮刻意不门禁这批**（否则「权限收紧」会被错做成「功能残缺」）。

### ④ 🔴 生产权限值的**形态**决定门禁今天是否可见

`role_permissions` 三库（`erp.db` 1 行 / `tenant_1.db` 9 行 / `tenant_10.db` 7 行）**全部仍是旧格式 `list`**，
新格式 `dict` **0** 行。但**接口下发的是 dict** —— `normalize_perms_shape` 把 `list` **展开成全动作**：

```json
{"dashboard":["read","create","update","delete"], … "data":["read","create","update","delete"] …}
```

⇒ **`permActs` 非 null（门禁代码路径真的在跑）、但每个模块都恒真** ⇒
**「零回归」由数据保证；门禁只在管理员主动收窄动作后跟手** ⇒ 上线当天**界面上看不到任何变化**。
要看到效果必须去权限页取消某角色的某个动作勾选。⚠️ 因此「零回归」与「门禁有效」**会互相掩盖**，
验证必须用**响应改写**（见 `frontend-ui.md §v335`）。

### ⑤ `/api/commitments*` 仍未登记 `_PATH_MODULE_MAP`（独立主题，恒 403）
