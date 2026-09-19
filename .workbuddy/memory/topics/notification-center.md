# 通知中心 / message_center（写端 + 读端 + UI）

> 2026-09-14 P0-1a/1b 落地；同日补「可见性 + 事件键 + 按类静音」。
> 改这一域之前先读本文件。
> 提交：后端 `cde0ffd`（feat/notify 可见性+event_key+日报双发）· 前端 `d36aa8d`（静音/暂停 + 同源计数）。

## 一句话
`message_center` 表由调度器写、**唯一写入口 = `db/queries/finance.py::message_send`**；读端 = `routers/messages.py`（4 端点）→ 前端 `NotificationPanel.vue`（顶栏铃铛）。
**静音/暂停的主键 = `event_key`（稳定事件类型），不是 title** —— 归一化实现**只有一份**：`finance.norm_event_key()`（读端对存量行兜底复用它）。

## 写端（唯一入口）
- `db/queries/finance.py::message_send(title, content, msg_type, sender, recipients, dedup_window=None, event_key=None)`
- 🔴 **第 4 位是 `sender`，第 5 位才是 `recipients`** —— 传收件人**一律用关键字 `recipients=`**。2026-09-15 实测：工资条把 user id 传在第 4 位 → 写进了 `sender`，`recipients` 永远空 → 去重把所有人的工资条折成同一行广播。**全仓其余 17 个调用点传的都是角色标签（正确用法）**，只有工资条这一处踩了位置坑。
- **去重窗口 `MESSAGE_DEDUP_WINDOW = 86400`**（秒）。窗口内命中同键**未读**行 → `dup_count+1`、`content` 刷为最新、`last_at` 更新，**不新增行**。
- 🔴 **去重键 = `title + msg_type + recipients`**，判定要点：
  - **不含 `content`** —— 正文里数量/金额逐次在变（「逾期总额 ¥1,315,656」每次不同）→ 含正文等于**永不去重**。
  - **含 `recipients`** —— 工资条靠它区分员工；去掉会把 A 的工资条折进 B。
  - ⚠️ 比较必须 `CAST(COALESCE(recipients,'') AS TEXT)=?` —— **SQLite 不做隐式转型**（`1 = '1'` 为 false）；`recipients` 落库前一律 `str()`（写入口径历史上 id 与 username 混用）。
- **只对 `is_read=0` 去重**：已读的再来一次是新的一件，应重新露出。
- `dedup_window=0` = 关闭去重（保留旧行为，可回退）。
- **`event_key`** 缺省时由 `norm_event_key(title)` 现算。归一化**顺序敏感**：带「日」的先跑（`2026-09-13` → `09月13日` → `8月20`**口语省略「日」**，实测来自「8月20报单-8月24到货」）。
  实测：`09月13日盈亏快报` 与 `盈亏快报 · 2026-09-13` → 同为 `盈亏快报`（红蓝两版历史日报现在折进同一组）。
- ⚠️ 调用方必须**已被 `_run_per_tenant(fn,label)` 包裹**（`scheduler.py`），否则 `message_send` 会落到主库 —— 跨租户通道。
- 调度器节流现状（`scheduler.py:25-66`）：`库存预警` 1800s · `应收逾期提醒` 3600s · `cron_tasks` 60s · `expense_anomaly` 600s · `inactive_customers`/`expiry`/`contract_expiry` 3600s。

## 工资条通道（2026-09-15 两轮修复，`routers/salary_send.py`）
- **可见性 fail-closed**：`recipients` 空 = **广播**（全租户可见）· 非空 = 定向（命中当前用户 `id` 或 `username` 字符串化）。
- 🔴 **取不到账号时必须「不投递」** —— 原实现留空 `recipients` 落库 = **实发工资对全公司可见**。修后 `_notify_salary_slip()` 返回 `False`，in-app 分支回 `success=False` + 明确 error 文案，并打 warning 日志指引「去员工档案开登录账号」。
- 收件人来源 = **`db.employee_account_map()[员工id]["id"]`**（员工→账号唯一实现），不再自己拼 `employee_code`。
- 🔴🔴 **`db.hr_employee_get()` 全仓从未定义**（唯一调用点就是本文件）→ 每次发送必 `AttributeError`；且在旧代码里位于 `try` **之外** → **HTTP 500**，`salary_send_logs` 连失败记录都写不下。**「工资条从未发过」的真正根因**。已改用 `db._get_employee(eid)` 并移入 `try`。
- 🔴 **企微通道已下线（不是「改天再接」）**：群机器人 **没有「发给某个人」的能力**，`touser` 对它无效 → 「一键群发工资条」= 把**每个人的实发金额**逐条发进同一个群。判据 = **宁可全体不投，也不可群发**。
  - `CHANNEL_IMPLEMENTED = {"wechat": False, "in-app": True, "email": False, "sms": False}`；未接入原因在 `CHANNEL_BLOCKED_REASON`（**可执行文案**，非「暂未接入」），透出到 `GET /channels` 的 `blocked_reason` 与 `POST /send` 的 `channel_status.note`。
  - 🔴 **能力闸必须在配置闸之前**：原顺序先查 `notification_channels` → 会把「隐私拦截」误报成「通道未配置」，用户永远看不到真正原因。
  - **真定向的唯一路径 = 企微应用消息**，前置条件（缺一不可）：① 企业微信后台建**自建应用**拿 `corpid`/`secret`/`agentid`；② `hr_employees` 需要新增**企微 userid** 列（**当前不存在**，旧代码取的 `employee["wechat_userid"]` 恒为空）；③ 员工档案表单加该字段（前端）；④ 渠道配置界面（**当前不存在**，`/api/salary-send/channels` 无 UI 入口）。接入后 `touser` 才真的生效。
- 🔴 **in-app 不需要任何渠道配置**：站内通知靠 `recipients` 定向。原实现无论哪个通道都先查 `notification_channels('salary')`，而**生产三库该表均空** → 员工即便已关联账号也失败。现「配置闸只对需要外部凭据的通道生效」。
- ⚠️ **`salary_send_logs`（tenant_1=0）/ `salary_details`=0 / `notification_channels`（三库均空）→ 工资条从未真正发过**，所以以上都是**预防性修复**（不是修线上事故）。`tenant_10.salary_send_logs=2` 是演示租户的既有演示数据。

## 「员工 ↔ 登录账号」单一权威（2026-09-15 收敛）
- 权威列 = 主库 **`users.employee_id`**（v110 整型）；遗留列 `users.employee_code`（TEXT，名不副实，存 `hr_employees.id` 的十进制字符串）**只作存量兜底**。
- 唯一实现（`erp_db.py`）：`_emp_link_expr(alias)`（SQL 表达式）/ `resolve_employee_id(user)`（账号→员工）/ `employee_account_map()`（员工→账号）。
- 🔴 **`users.employee_id` 存的是「租户内」的 `hr_employees.id`，而 `users` 是主库全局表** → 查询必须按 `user_tenants.tenant_id` 收口，否则**跨租户认领**（实测：员工 id 7 被 tenant_1 的 `18671058882` 认领到隔离租户）。
- 🔴 **`hr_employees.user_id` 是死列（全仓零写入方、三库恒 0）** → 已由 v167 删除（主库 + 显式循环 `tenant_*.db`；列对账 `_ensure_tenant_module_tables()` **只补不删**，不显式删会永久残留）。**不要再加回来。**

## 读端 API（`routers/messages.py`，prefix `/api/messages`）
| 端点 | 语义 |
|---|---|
| `GET ""` | 分页；回 `items` / `unread_count` / `total` / `has_more` / `recipients` / `event_key` |
| `GET /briefing` | 按 **`(event_key,msg_type)`** 聚合；回 `groups[]` + **`folded`** + `unread_count` |
| `POST /read-all` | 标记已读（**只影响当前用户可见的行**） |
| `POST /{mid}/read` | 单条标记已读（同上） |

- 🔴 **`_visible_where(user)` = fail-closed 可见性**：`recipients` 空 = **广播**（全租户可见，与加过滤前行为一致）；非空 = **定向**，只在该值命中当前用户 `id` 或 `username`（字符串化比对）时可见。
  生产实测 recipients 目前 100% 为空 → 对存量数据**零行为变化**，是为工资条铺路（原先纯租户级查询 = 一启用就全公司可见）。4 个端点**全部**必须接它。
- `triggers = dup_count + 1`（= 累计触发次数）。
- 🔴 **前端「重复 N 次」= `triggers − rows`，不是 `triggers`** —— 前者是「被写端折叠掉的次数」，后者会被每条自身数一遍（两行的组会显示「重复 2 次」而卡脚同时写「共 2 条」，同一件事数两遍）。
- `_row()` 对「新列尚未同步到该租户库」做兼容（缺列按 0/空），不抛错；**存量行 `event_key` 为空时读时兜底 `norm_event_key(title)`** —— 否则历史 21,293 行静音键为空，按类静音对它们完全失效。
- 🔴 **静态路径 `/briefing`、`/read-all` 必须声明在 `/{mid}/read` 之前**，否则被路径参数吃掉返 422。
- 🔴 **`folded` 必须如实回传**（折叠掉多少条）。折叠了 21,286 条却只说「7 件事」= 把积压抹掉（同族铁律「降级即抹掉」/「零值即健康」）。

## RBAC（新增端点必做三层，缺一不可）
1. `server.py::_TENANT_REQUIRED_PREFIXES` 加 `/api/messages` —— 否则静默落主库。
2. `server.py::_PATH_MODULE_MAP` 加 **`"/api/messages": "dashboard"`**。
   🔴 **为什么是 `dashboard`：它是 admin/boss/accountant/sales/guide/driver/staff/supervisor 8 个角色唯一共同拥有的模块**。落 `data` 会让 guide/driver/accountant 一进来就 fail-closed 403 `MODULE_NOT_CONFIGURED`。
3. `include_router(messages_router)`。

## Schema / 迁移
- 表 DDL 在 `erp_db.py::_migrate_v68` 的 `message_center`；**三个新列** `dup_count INTEGER DEFAULT 0` / `last_at TEXT DEFAULT ''` / **`event_key TEXT DEFAULT ''`**。
- **`hr_employees.user_id INTEGER DEFAULT 0`**（v166 幂等迁移 `v166_hr_employee_user_link`）—— 工资条「定向可见」靠它（`salary_send._notify_salary_slip` 用它当收件人）。
  ⚠️ **未关联账号时仍留空 recipients，但打 warning**（不静默把工资条广播给全公司）；`user_id` 为 `0`/空即视为未关联。
- 🔴 **`CREATE TABLE IF NOT EXISTS` 对已存在的表不补列** → 主库（`erp.db`）必须走**幂等 ALTER**（`_safe_migrate_script` 按 `_migrations` 表去重，每块**独立**，别写成一个大 executescript —— 块首遇 `duplicate column name` 会中断整块，块尾建表/种子永远轮不到）。
- **存量租户库不用手工 ALTER** —— `_ensure_tenant_module_tables()` 的列对账机制以主库 schema 为权威源，启动时自动补齐（实测启动日志 `tenant_1.db 补列(+2): ['message_center.event_key', 'hr_employees.user_id']`）。

## 前端
- `src/api/modules.js` → `messagesApi`：`list({unreadOnly,limit,offset})` / `briefing()` / `markRead(mid)` / `markAllRead()`。
- `src/components/NotificationPanel.vue`（顶栏浮层，440px，`max-height:min(72vh,660px)`，`.nt-body` 可滚）。
  - 三段：**「今日该干什么」聚合卡**（`重复 N 次` / `共 N 条`）· **`.nt-fold` 如实报数** · **「最近通知」默认只显 3 条 + 展开明细**；外加 **「已收起」区**（见下）。
  - 🔴 `markOne()` 标记已读后**直接 `await load()` 重拉** —— 聚合结果由后端口径决定，**前端不自行推算**（防同屏两口径）。
  - `plainText()` 收敛正文 markdown 噪音（`**加粗**` / `| 表格 |` / `---` 分隔行 / `#` 标题 / `[文字](链接)` / `` `代码` ``）。**真实数据里这两种噪音都出现过**：「盈亏快报」带 `**销售额: ¥0**`、失败的定时任务通知整段是管道表格。
  - `.nt-g-body` 有 `-webkit-line-clamp:3`（无上限时**单张卡能吃满整个视口**）。
  - 聚合卡 `:key` 用 `g.event_key`（不是 title）。
- `src/components/Shell.vue`：铃铛 `.tb-bell` + 徽标 `.tb-bell-n`（`99+` 封顶，tooltip 走 `toLocaleString('zh-CN')`）。
  - 🔴 轮询拉的是 **`briefing()`**（聚合简报，tenant_1 实测 7 组），**不是 `list({limit:1})`** —— 后者的 `unread_count` 扣不掉「被用户收起的类」，会出现**铃铛一直红着、面板里空空如也**；也不能为了徽标把 2 万条流水拖下来。
  - `toggleNoti()` 与 `userMenuOpen` **互斥**（防两个浮层叠一起）；`onMounted` 起定时器 / `onBeforeUnmount` 清。

## 按类静音 / 暂停（2026-09-14 落地，前端显示层）
- `src/composables/useNotiPrefs.js`（新增）—— 模块级单例 `rules` → `localStorage['hergent_noti_prefs']`。
  **键 = `event_key`**（title 带日期，拿 title 当键永远静不掉）。两个动作，每个都能被用户观察到效果：
  **不再提示**（永久静音）· **暂停 7/30 天**（到期自动恢复，避免「设置页的坟场」）。
- 🔴 **刻意不做「每天一次 / 每周一次」频率档位**，理由（别再"顺手补上"）：
  ① 写端去重窗口 `MESSAGE_DEDUP_WINDOW=86400` **本就等于「每天一次」**，设了等于没设；
  ② 拉长到 7 天只影响站内角标，会让角标在用户**还没看**的时候就自己缩水（等于丢提醒）；
  ③ 真正的频率控制要等**推送通道（企微/微信）落地**才有意义（那时「每天一次」= 一天最多推一次）。
  → **不做假旋钮：配置项必须能看到效果**（同族：`hergent-capability-reality-audit`「配置看起来能改但没效果」）。
- 🔴 **铃铛徽标与面板头部必须共用 `badgeFromGroups()`（纯函数）** —— 同一份规则 + 同一批 groups ⇒ 必然同数。曾经的设计是「铃铛带副作用记账、面板纯计算」，结果**面板一打开头部就比铃铛少 1**（记账把该类标记为「本周期已计过」后，纯计算侧就把它排除了）。
- 🔴 **改偏好后必须立刻 `emit('unread', unread.value)` 回推铃铛** —— 否则铃铛要等下一轮 2 分钟轮询才变，用户看到「面板说 4、铃铛挂 5」。
- 🔴 **被收起的类不能直接过滤掉**，要移入「已收起」区并显示 **「还有 N 条未看」** —— 静音是「不打扰」不是「藏起来」，否则用户会以为通知没产生（同族铁律「降级即抹掉」）。
- 「已收起」区列的是**规则**（`suppressedList`），不是当次的分组 —— 这样即使该类当前 0 条待看，用户也能恢复提醒。

## 验证这一域的正确姿势
🔴 **真实租户的「全部已读」是不可逆的**（清空用户未读信号）→ **读侧在真租户验、写侧另建隔离租户验**：
1. `erp_db.tenant_db_init(TID)` 建库 → 主库插 `tenants` / `users`(role=boss) / `user_tenants`；
2. **直接往 `erp_db sessions` 插令牌**（免密码、避开 `ERP_SECRET` 依赖），`expires_at` 给足；
3. 用 `finance.message_send` 造数据（顺带验写端去重）；
4. 跑完删 `tenant_<TID>.db*` + 清 `users`/`user_tenants`/`sessions`/`tenants`，核对租户数回到 2、真租户行数未变（脚本 `/tmp/nt_cleanup.py` 会打印**回收前后真租户逐字对照**，`ZERO_RESIDUE_OK` 才算过）。

真机（puppeteer）要点 `/tmp/nt_verify2.js`：`evaluateOnNewDocument` 注入 `hergent_v2_token` / `hergent_v2_user` / `hergent_v2_tenant`；URL 带 `?cb=<ts>`；**先打 `page.url()` 确认没落回 `#/login`**；Chrome 加 `--no-proxy-server`。
⚠️ **偏好类验证别在 `evaluateOnNewDocument` 里 `removeItem('hergent_noti_prefs')`** —— 每次导航都会执行，刷新持久化就永远验不出来（本机踩过，误判成「没落盘」）。干净起点靠 puppeteer 的临时 profile；清一次要写在首次 `goto` 之后。
⚠️ 面板的「已收起」行在 `v-if="showSuppressed"` 里，**不点「展开」读不到 `.nt-s`**（别把测试自身缺陷记成产品 bug）。

### ⭐ 生产写操作的归因法（判「这次写入是谁干的」）
`/var/log/nginx/access.log` 里有三件可交叉比对的证据，足以把一次写入钉到具体会话：
1. **UA** —— 我的 puppeteer = `HeadlessChrome/152`；用户/IDE 内嵌浏览器 = `Chrome/138 ... QQBrowser/21.9`。**UA 不同即不是同一主体**。
2. **响应体字节数**（`$body_bytes_sent`）—— 能反推该会话打的是哪个租户：真实租户 `briefing` ≈ 1820 字节，隔离租户 ≈ 437 字节。⚠️ HTTP/2 响应可能被 gzip，**字节数不能反推 JSON 内容**（别拿它算 `changed` 的值）。
3. **referer 里的 `?cb=<epoch_ms>`** —— 同一会话的全部请求都能用它捞出来。
实操（2026-09-14 实例）：3 次 `read-all` 里 2 次 `HeadlessChrome` 会话的 `briefing` 只有 437 字节 → **打的是隔离租户**；唯一命中 tenant_1 的那次来自一个 `QQBrowser` 会话（当天 3 次真实 `POST /api/auth/login`、连续 2 分钟轮询、先 `briefing`+`list(20)` 再 1 秒后 `read-all`）= **浏览器里的一次人工点击**。
> 🔴 教训：**发现真实租户数据异动时，先归因再认错**。这次我一开始按「我的 e2e 脚本清空了它」认错，与日志证据相反 —— 归因错了会去"修"一个没坏的东西。

## 控制面缺口（2026-09-14 侦察；部分已随 cde0ffd 关闭）
🔴 **「这条通知是给谁的」在生产上根本没建立**，三个证据：
1. **`recipients` 生产 100% 为空串** —— tenant_1 21,293 行 + tenant_10 1,917 行全部 `<空串>`，无一条带值。`message_send` 共 **17 个调用方，只有 `routers/salary_send.py:227/:233` 传值**，且传的是 `employee.get("id")`（整数或 `None`；SQLite 比较不做隐式转型，`1 = '1'` 为 false）→ 那条「工资条按 recipients 分开」的写端逻辑**在生产上从未被触发过**。
   → **已处理**：`salary_send._notify_salary_slip()` 改用 `hr_employees.user_id`（字符串化）+ 未关联时打 warning；写端比较改 `CAST(... AS TEXT)`。**但 `hr_employees.user_id` 生产尚未回填** → 工资条目前仍走「留空 recipients（= 广播）+ warning」，等员工档案关联账号后自动生效。
2. **读端完全不过滤收件人** —— **已处理**：`routers/messages.py::_visible_where()` fail-closed。
3. **前端无 per-user 偏好载体** —— 全表无 `user_settings`/`app_config`/`kv` 类；既有范式是 **localStorage**（`Shell.vue` 侧栏宽、`CopilotDrawer.vue` 抽屉宽 + `hergent_ai_guard`、`WeatherWidget.vue` 城市、`IdleTimeout.vue` 时间戳）→ **设备级、换端即丢**。静音/暂停就按这个范式做；要做成 per-user 云端偏好，得先有载体表 + 迁移 + RBAC 三层登记。

🔴 **静音 / 开关类需求的两个硬前提**（不满足就不该动手）：
- **title 不可作静音键**：① `scheduler.py:414` 用 **`task["name"]` 当 title**，而 name 是**用户原话**（生产真有 39 条 =「你帮我设个定时任务，每天上午8点把当日AI方面的重大新闻发给我」）；② 大量 title 是**动态拼接**（`{today}盈亏快报`、`{start}~{end} 付款确认`、`{today} 厂家付款 ...`）。
  → **已解决**：`event_key` + `norm_event_key()`；同时 `scheduler._execute_scheduled_task` 的 title 规范化为 `定时任务·{名前16字}`（完整原话留在正文）。
- **`msg_type` 只有 4 级且过粗**（warning / danger / notice / info）：`danger` 同时含「应收逾期提醒」和「效期预警·紧急」；`warning` 同时含「库存预警」「客户流失预警」「合同到期提醒」「异常支出预警」。→ 按类型静音误伤率极高，所以静音键必须用 `event_key`。

**噪音集中度（决定该治什么）**：tenant_1 前 2 个 title = **99.76%**（库存预警 + 应收逾期提醒，共 21,293）；tenant_10 前 4 个 = **99.5%**。两者 `is_read=0` 曾 100%（上线至今无一条被读）。
⚠️ 2026-09-14 18:34 该积压被**用户自己**在面板上点了「全部已读」（旧版是全租户级、不可逆）→ tenant_1 未读只剩之后新产生的 2 条。用户如问「通知怎么空了」，答案就是这个。

**多通道是三条独立调用**：`routers/forecast.py:342-344` 的站内 `message_send` 与 `push_to_wecom` / `push_to_feishu` 各自独立，互不感知 → 任何「关闭通知」若要声明作用域，**站内静音不等于企微不推**（未来做总开关时必须按通道分开）。

## 已知遗留（2026-09-14）
1. 存量积压**不做数据迁移** + 读端用 `folded` 如实呈现（与 `recipe_market` 同款处理）。
2. **失败的定时任务通知**（AI 回「抱歉，我没有设置定时提醒的功能」）仍按天累积 —— 写端去重只压同标题同 recipients 的窗口内重复（title 已规范化，现在至少能按类静音掉）。
3. ✅ **同一份日报双发**已修（`cde0ffd`）：`_generate_morning_report` 推送失败不再额外落库，只落一条简版；`event_key` 让「`09月13日盈亏快报`」与「`盈亏快报 · 2026-09-13`」这类历史双标题也能折进同一组。
4. ⏳ **`hr_employees.user_id` 未回填** → 工资条的定向可见尚未真正生效（见上）。回填入口 = 员工档案关联登录账号。
5. ⏳ 静音/暂停是**设备级**（localStorage）。要跨端需 per-user 云端偏好载体（未做）。
