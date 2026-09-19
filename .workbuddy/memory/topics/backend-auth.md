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

### 缺口 B（P2）：「只允许登录小程序」**做不到硬隔离**
`routers/auth.py` 登录成功后**无任何端校验**；`Login.vue:250/258` 处理完 `require_password_change`
一律 `router.push('/workbench')` ⇒ `staff` 账号**照样能登 hergent.cn**（只是侧栏按
`_DEFAULT_PERMS["staff"]=["data","chat","stock"]` 过滤后只剩几项）。
即「业务员只能用小程序」**在权限上成立、在门禁上不成立**；硬隔离需新增端白名单列或按角色设端约束。

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

### 🔴 判据一：`hr` 模块只给了 `boss`（+ `admin` 通配）

`_DEFAULT_PERMS`（`core.py:375`）里有 `hr` 的角色**只有 `boss`**：
`accountant` = dashboard/accounts/reports/marketing（**无 hr**）｜`supervisor` = dashboard/data（无）｜
`sales`/`guide`/`driver`/`staff` 均无。
⇒ **会计算不了工资、看不了社保** —— 业务上通常由会计承担的工作，现在只有老板能点。

### 🔴 判据二：员工档案与算工资**是同一道门**

以下前缀**全部映射到 `hr`** ⇒ 把字段从一个页面搬到另一个页面，**权限不发生变化**：

| 前缀 | 位置 |
|---|---|
| `/api/employees` | `server.py:541` |
| `/api/payroll-workflow` · `/api/attendance` · `/api/leave` · `/api/salaries` · `/api/webhooks` | `server.py:315/329/336` |
| `/api/payroll` · `/api/salary-batch-calculate` · `/api/salary-save` · `/api/salary-summary` · `/api/social-insurance-config` | `server.py:371-375` |
| `/api/salary-details` · `/api/salary-slip` · `/api/salary-bank-file` | `server.py:598-600` |

🔴 **推论：权限与位置正交 —— 隔离单位是「字段组」，不是「页面」。「迁移」唯一有价值的形态，
是把薪酬前缀从 `hr` 拆成一个更窄的新模块（如 `payroll`），从而能安全地单独授权给会计。**
⚠️ **绝不可给 `accountant` 加 `hr`** —— 会连带拿到身份证 + 银行账号 + 改角色能力。

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

## 🔴🔴 角色权限表是「**全平台一份**」，不是租户级（2026-09-19 实测确证，动手前必读）

**触发场景**：任何「按客户差异配置角色权限」的需求（如「我的会计不能算工资，但某客户的会计要能算」）。

**结论**：**做不到。** 给某客户开 = 所有租户一起开；收回来 = 所有租户一起收。**租户级差异无处安放。**

| # | 事实 | 判据 |
|---|---|---|
| 1 | 权限接口**无视租户头** | 同令牌 `X-Tenant-Id: 1/9/10` 打 `GET /api/role-permissions` → 三次返回**逐字相同**（8 角色，`accountant=[dashboard,accounts,reports,marketing]`） |
| 2 | 权威锁在**主库** | `server.py:50-51` `/api/role-permissions` 在 **`_TENANT_MASTER_PREFIXES`** ⇒ `set_tenant_context(None)`（`:87-92`）⇒ 读写都落 `erp.db`；`:597` 同路径又映射 `hr`（故只 boss/admin 能用） |
| 3 | 判据是**进程级全局** | `core.py:394 _load_perms` / `:406 ROLE_PERMS = _load_perms()`（import 期执行，此刻无租户 → 主库）/ `:408 reload_perms()` 仅保存时调 / `:450-455 _check_perm` 读全局 |
| 4 | 租户库那份是**死数据** | 生产 `erp.db` 1 行(supervisor) · `tenant_1.db` 2 行(**库管**,supervisor) · tenant_9/10 各 1 行；而接口返回里**没有「库管」** ⇒ 既读不到也改不了（`erp_db.py:17045` v110 迁移「以租户库为准」的意图**从未落地**） |

🔴 **核心错配（最该记住的一句）**：中间件在 `server.py:679` 调 `_check_perm` **之前**已正确设好租户上下文（`:109/:125`），
而 `_check_perm` **根本不用它** ⇒ 「租户感知的连接层」+「租户无感的判据」拼在一起。

⚠️ **不要讲成泄漏**：读路径与写路径**都锁主库** ⇒ 系统内部**自洽**，不存在跨租户串味。真缺陷是**能力缺失**（租户级配置无处安放）。

**连带缺陷（同批查出）**
- 🔴 `库管` 是**孤儿角色**：不在 `ROLE_PERMS` ⇒ `_check_perm` 命中空表 ⇒ **零权限僵尸账号**；
  而 `normalize_role` 白名单（`known_roles() = _DEFAULT_PERMS ∪ ROLE_PERMS`）会**直接 400 拒绝派发它**。
  当前无实际影响（生产 `users.role` 只有 admin/boss/sales/supervisor）。⇒ **白名单的判据来源被此缺陷污染**，修 P0 后自动正确。
- 🔴 `field_permissions`（字段级权限）**有表、有 API、无人消费**：tenant_1 有真实配置 `('sales','product','purchase_price',0,0)`，
  但全仓**唯一消费方**是 `routers/platform.py:573/577`；`GET /api/products`、`/api/employees` **无任何读路径**调用它 ⇒ **配了不生效**。别当已有能力。
- `user_tenants.role`（`admin`/`member`）**不参与鉴权** —— `check_user_tenant(:4442)`、`get_user_tenants(:4458)` 只查 user_id/tenant_id。**别误当「按租户角色」机制**。

**修订方案**：**P0** 权限表按租户分叉（`/api/role-permissions` 移出 master 前缀 + `ROLE_PERMS` 改按租户缓存 + fail-safe 回落 `_DEFAULT_PERMS`）
→ **P1** 拆 `payroll` 模块（`/api/employees` 留 `hr`，使「能算工资」≠「能看身份证/银行账号」）→ **P2** 补自我作用域（`/api/salary-slip/{eid}` 无 `payroll`/`hr` 时只允许本人）。
**不做 P0，P1 的差异化对客户无效。**

📄 完整核查与方案：`outputs/员工薪酬信息归属与访问控制分析-2026-09-19/02-按租户差异的权限设计（修订）.md`

