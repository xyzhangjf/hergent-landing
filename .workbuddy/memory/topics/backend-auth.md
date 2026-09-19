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

🔴 但整块语义**写死为「小程序」共 7 处**（`EmployeeArchive.vue:31` 表头 / `:155` 区标题 /
`:160` 提示 / `:305` 注释 + `routers/forecast_submissions.py:515` docstring +
`erp_db.py:16649` docstring + `api/modules.js:338` 注释）⇒ 网页端场景**不可发现** ——
这是 **UI 语义缺陷，不是缺功能**（角色下拉 `:306-314` 里已备好会计 / 老板 / 管理员）。

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
- `.workbuddy/tools/role-registry-consistency-check.py` —— 四组断言（A 下拉无重/无缺/无多 ·
  B `ROLE_NAMES` 覆盖 + 两表值集一致 + 无「中文名=英文名」空映射 · C `.df-role.r-*` 色板覆盖 ·
  D 其它清单只告警并横向打印跨页译名）。`ROLE_REG_EMPARCHIVE=/tmp/broken.vue` 可指向副本做判别力自证。
- `.workbuddy/tools/employee-supervisor-role-verify.js` —— 真机探针（沙箱 9997，走真实 UI 建号）。

🔴 **同根因漂移三处（同批发现，**尚未修**，已进校验脚本 D 段告警）**
- `Forecast.vue ROLE_LABELS` 键集缺 6 个角色、多 `dealer/finance/owner/promoter` 四个**后端不存在**的名字；
  而 `bizRole` 取的就是 `store.user.role`（后端角色名）⇒ **键错配**。连带
  `COLUMN_PERMISSIONS = { dist_price: ['owner','finance'] }` **权限失效**（老板/会计看不到该列）。
- `Forecast.vue` 里 supervisor 译作「**督导**」（与员工档案的「主管」不一致）；`sales` 那里叫「销售」。
- 小程序 `utils/roles.js ROLE_TEXT` 缺 `driver/guide/staff`、多 `promoter`。

### 缺口 B（P2）：「只允许登录小程序」**做不到硬隔离**
`routers/auth.py` 登录成功后**无任何端校验**；`Login.vue:250/258` 处理完 `require_password_change`
一律 `router.push('/workbench')` ⇒ `staff` 账号**照样能登 hergent.cn**（只是侧栏按
`_DEFAULT_PERMS["staff"]=["data","chat","stock"]` 过滤后只剩几项）。
即「业务员只能用小程序」**在权限上成立、在门禁上不成立**；硬隔离需新增端白名单列或按角色设端约束。

### 缺口 C（P3，B2B 交付时收口）：role 无白名单
`routers/forecast_submissions.py:523`（开账号，直接透传 `d.get("role","staff")`）与
`server.py:1000`（改角色 `UPDATE users SET role=?`）**均无白名单**，而下拉含
`boss`（几乎全开）/ `admin`（全开）⇒ 任何 admin/boss 可一键造出新 admin/boss。
另：`staff_account_create` 强制要求**真实员工存在**（`erp_db.py:16665`）⇒
「给非员工（如外包财务）开账号」**暂无通道**；`platform.py:318` 能建无主账号但走
`_platform_admin`（创始人专属），租户老板用不到。
