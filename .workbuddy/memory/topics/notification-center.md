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

---

# §v304b（2026-09-28）「定时提醒一条都没到人」的四层漏斗

用户原话形态：「**该提醒的时候有提醒，但我这两天都没收到**」。这类问题**最容易从错的层开始查** ——
通道是**最后一层**，前三层全在日志/库里，且**每层都能单独造成「零通知、零报错」**。

| 层 | 问题 | 判据 | v304b 实测结论 |
|---|---|---|---|
| **L1 有没有跑** | 定时任务真的触发过吗 | 日志里找**该任务**的触发行 | 🔴 **从没触发过**（相位锁死） |
| **L2 跑了有无内容** | 有候选/有事件吗 | 「无事可推」是否留痕 | 只有重启行 ⇒ 无法区分「没跑」与「跑了没内容」 |
| **L3 内容走哪条通道** | 租户通道 vs 全局 webhook | `enabled_channels(tid)` | `['wecom']` ⇒ **不是**全局 webhook |
| **L4 能否主动出站** | 平台允许主动推吗 | **回执**（message_id） | ✅ `success:true` + `aibot_send_msg-…` |

## L1：`_should_run` 无条件记账 ＋ 时间窗留在**调用处** = 相位锁死
```python
# ❌ 病态：记账与判断不分离。时间窗 AND 在调用处 ⇒ 窗口只在「记账那一分钟」被检查
def _should_run(name, interval, now):
    last = _monitors_run.get(name)
    if last is None or (now - last).total_seconds() >= interval:
        _monitors_run[name] = now          # ← 无条件记账，哪怕当前不在窗口
        return True
    return False
if _should_run("task", 3600, now) and now.hour in (9, 16):
    do_task()
```
**后果**：该任务**永远跑不到且零报错** —— 触发时刻被「进程启动时刻 ＋ interval 整数倍」**锁死**。
**放大项**：服务**频繁重启**（间隔 ≪ interval）⇒ `now-last` 永远不够 ⇒ **一次都不触发**；
且每次重启 `_monitors_run` 清空，「重启后第一次必 True」这个免费的窗口又被**时间窗浪费掉**。
**正解**：判断与记账分离、**只在窗口内记账** —— `_should_run_at(name, now, *, interval_sec, hours=None, minute_from=0, minute_to=5, weekday=None)`（v304）。
⚠️ 注意 `minute_from/minute_to` **默认 0~5 分钟**（不是整点内任意分钟）⇒ 排查时必须按「小时的**前 5 分钟**」算窗口，
否则会得出「9:14 重启后应该马上触发」这种错结论（v304b 本轮踩过）。
**判据台必须遍历 1440 个启动时刻算命中率**（旧 0.35%~8.33% → 新 100%）；两边都 100% 说明判据无判别力。

## L2：可观测性 —— 「跑了但没内容」与「根本没跑」必须长得不一样
- 每个 push 分支都要有 else 留痕（R8）。本轮补：`…: 无事可推（无开放期次 / 无候选单元 / 本期已全部报单 / 刚开放已让位）`。
- 🔴 **`print` 也会骗你**：systemd 下 stdout 是 pipe ⇒ Python **块缓冲（8KB）**；
  `systemctl restart` 发 SIGTERM 而 **Python 不 flush** ⇒ 缓冲内容**随进程丢失**，
  时间戳 = flush 时刻而非打印时刻（实测差 36 秒）。
  修法 `sys.stdout.reconfigure(line_buffering=True)`。⇒ **「日志里没有」≠「没执行」**。

## L3：推送走向的**唯一判据** = `hermes_tenants.enabled_channels(tid)`
- Hergent 有**两条**出站路：① **租户自己的 Hermes 凭据**（`scheduler._push_tenant_channels` → `hermes send`）；
  ② **全局 webhook 兜底**（`feishu_notify.push_to_wecom`，读 `WECOM_WEBHOOK_URL`）。
- 分叉**只看 `enabled_channels(tid)` 是否非空**：非空 ⇒ **只走 ①，绝不回落全局**（防串台）。
- 🔴 **别拿「直接调 `push_to_wecom()` 打印未配置」当结论** —— 它**只是兜底**，tenant 配了渠道时根本走不到。
  本轮差点据此让用户白配一个群机器人 webhook。
- 🔴 **凭据可读性三个条件，缺一即静默回落全局 webhook**：
  `hergent` 在 `hergent_tN` **组**里 ＋ 目录 **setgid** ＋ 服务 `UMask=0007`。
  症状：`[ai_channels] 健康检查异常 … Operation not permitted: …/hergent_tN/.env`。
  **`su - <user> -c 'cat …'` 能读 ≠ 服务能读**（沙箱 mount ns 是进程级继承）。
- **在服务沙箱里实测的姿势**：
  ```bash
  systemd-run --pipe --wait --collect --unit=probe \
    --property=User=hergent --property=Group=hergent \
    --property=WorkingDirectory=/opt/hergent-erp \
    --property=ProtectHome=true --property=ProtectSystem=full \
    --property=ReadWritePaths='/opt/hergent-erp /opt/hermes-tenants' \
    --property=NoNewPrivileges=false /usr/bin/python3 /opt/hergent-erp/tools/your-probe.py
  ```
  🔴 **别带 `PrivateTmp=true`** —— 会让 `/tmp` 里的探针脚本**凭空消失**（报 `can't open file '/tmp/…'`，像路径写错）。
- ⚠️ `ProtectSystem=full` **不阻挡读 `/opt`**（只读但可读）；`ProtectHome=true` 只影响 `/home`、`/root`。

## L4：拿**回执**，别拿「脚本返回 True」当结论
- `hermes send` 是**一次性子进程** ⇒ **它的输出不进网关日志** ⇒ **「日志没记录」≠「没发出去」**。
- 正解：
  ```bash
  H=/opt/hermes-tenants/hergent_tN
  sudo -u hergent_tN env HOME=$H HERMES_HOME=$H /usr/local/bin/hermes send --to wecom --json -s '标题' '正文'
  # ⇒ {"success":true,"platform":"wecom","chat_id":"…","message_id":"aibot_send_msg-…","mirrored":true}
  ```
- ⚠️ 企微智能机器人的 `errcode 846609: aibot websocket not subscribed` **只属于 media upload（发文件/图片）路径**，
  **纯文本主动推送正常**（实测 `success:true`）。别拿这个错码判定「不能主动推」。

## 「开放通知」范式（v304b，可照抄）
- **事件驱动挂在建表成功那一刻**，不靠固定钟点代劳：
  `_auto_period_open` 建出期次 ⇒ `_notify_period_opened(pid, os_, oe, close_time=, arrival=)`。
- **为什么不能靠固定轮代劳**：`auto_period` 每 5 分钟一轮、相位由**进程启动时刻**决定（实测落 :58:59 / :03:59），
  而固定催单在 16:00 的**第一分钟**就跑 ⇒ 5 次里 4 次跑在期次**建出来之前** ⇒ 通知会丢。
- **措辞随距关单时间变**：刚开放 0 分钟时「还有 N 个单元未报」必然 = 全部单元 ⇒ 老板会读成「大家都拖着不报」。
  故加 `_period_opened_recently()`（**查库** `created_at`，跨重启有效）⇒ 刚开放 30 分钟内**让位**给开放通知。
- 🔴 **让位逻辑默认值必须选安全侧**：同一函数有**两个调用点**（定时轮 + 手动按钮）。
  若默认让位 ⇒ **用户手点催单毫无反应** = 又一处「点得动、没反应、零报错」。
  ⇒ 参数默认 `False`（不让位/一定发），**只有定时轮显式传 `True`**；两处各留注释禁止「为统一而写成一样」。
  **原则：任何「跳过/让位」逻辑，默认方向都必须是「照常执行」。**
- 🔴 通知调用要**自带 try**，否则会落到建表函数的外层 except 打「**建表失败**」，而期次其实**已建成**（假信号）。
- 🔴 **成功也要留痕**（含 `pushed=N`），否则「发了但没人收到」与「压根没发」日志上一样。

## 站内信去重口径 —— **不是**按 `event_key`
读 `db/queries/finance.py::message_send` 确认：
按 **`(title, msg_type, recipients)` + `is_read=0` + `MESSAGE_DEDUP_WINDOW`(86400s)** 收敛；
命中 ⇒ 不新增行，只 UPDATE 正文/`last_at`/`event_key` 并 **`dup_count = 旧值+1`**。
`dup_count` 记的是「**被重复触发几次**」（INSERT 置 0，命中一次变 1）⇒ 判据**别写 `>=2`**。
`event_key` 只用于**前端按类静音 / 追溯**，**不参与**落库去重 ⇒ **别写「event_key 不同 ⇒ 一期一条」**（错）：
间隔 < 24h 且上一条未读的两期通知会**并成一条**（v166 收敛设计，非缺陷）。

## 影子库端到端验收（比静态自检强，成本低）
```bash
S=/tmp/shadow; mkdir -p $S; cp -p /opt/hergent-erp/erp.db /opt/hergent-erp/tenant_1.db $S/; chown -R hergent:hergent $S
sudo -u hergent env V304B_SHADOW=$S ERP_DB_PATH=$S/erp.db /usr/bin/python3 probe.py
```
- 🔴 **`DB_DIR = dirname(DB_PATH)`** ⇒ **一个 `ERP_DB_PATH` 环境变量让主库与租户库同时落到影子目录**（不必 patch 两处）。
- 🔴 探针**开头必须先断言 `DB_PATH.startswith(shadow)`**，否则立即中止（安全闸）。
- 🔴 要发的消息把 `_push_tenant_channels` **换成桩**（通道能力单独验），并**事后核生产库 mtime 未变**。
- 含生产数据副本的影子目录**用完即删**（`rm -rf`）。

---

# §v305（2026-09-28）报单提醒「配置驱动」—— 面板 7 组设置 ＋ 四个节点

**触发**：老板「B/C 方案（配置面板 7 组设置 ＋ 四个节点）都做」。

## 一、架构：**钟点从「写死的常量」搬到「租户配置算出来」**

v304b 及以前，催报的触发时刻是**硬编码的钟点**（`_should_run_at("forecast_reminder", now, hours=(9,16))`）。
v305 改成：主循环 `if _should_run("forecast_reminder", 300, now):`（**只判"该不该跑"，每 5 分钟一次**），
**真正该不该发**由 `_forecast_reminder_cfg()` 读租户配置 ＋ `_auto_period_times()` 算出的**关单时刻**反推。

| 函数 | 职责 | 关键点 |
|---|---|---|
| `_forecast_reminder_cfg()` | 读 `forecast_config(kind='reminder')`，**fail-open 回落** | 🔴 **刻意不做任何 clamp**（不篡改用户填的值） |
| `_auto_period_times()` | 从 `rebate_target_rules.auto_open_time/auto_close_time` 取真实节奏 | ⚠️ **必须排 `build_period_plan` 出来看**，不能凭默认值推理（默认 20:00/10:00，tenant_1 实际 16:00/11:00） |
| `_reminder_close_time(cfg)` | 面板可覆盖关单时刻 | 面板值优先于 `auto_close_time` |
| `_period_close_at(order_end, close_time)` | 关单时刻（date + time 合成） | 催报的**时间锚** |
| `_in_quiet_hours(now, quiet)` | 免打扰时段（**仅影响企业微信**） | `/remind` 手动催单传 `ignore_quiet=True`（人手点的必须发） |

## 二、四个节点（全部挂在**同一个** `close_at` 锚上）

| 节点 | 触发时刻 | 默认 | 说明 |
|---|---|---|---|
| `new_period` | **期次开放时** | on | 由 `_auto_period_open` 发出，受本开关控制（关了即不发，并打日志） |
| `lead` | `close_at - lead_hours` | on（3h） | 「截止前提醒」 |
| `final` | `close_at - final_hours` | on（1h） | 「最后时刻提醒」 |
| `summary` | 关单后 | **off** | 「截止后汇总给主管/老板」—— 老板拍板：**保留开关但默认关闭** |

- 幂等记账：`_due(key, at)` ⇒ `_monitors_run["fcrmd:<期次id>:<节点>"] = now`；**命中即 break**（一轮只发一个节点）。
- `_REMINDER_FIRE_WINDOW_MIN = 10` —— 触发窗口 10 分钟。

## 三、🔴 `final ≥ lead` 冲突：**调度层跳过，绝不 clamp 用户的值**

老板完全可能把 `final_hours` 调得 ≥ `lead_hours` ⇒ 两个节点**同一分钟各催一次**（重复催）。
v305 **不做** `max(1, lead_hours - 1)` 这种「替用户改数」的 clamp（那会**静默改口径** —— v303 段教训），
而是**跳过 final 并打日志**：

```python
_lead_h  = int(cfg.get("lead_hours") or 3)
_final_h = int(cfg.get("final_hours") or 1)
if nodes.get("final", True) and _final_h >= _lead_h:
    print("[Scheduler][v305] tenant=%s: 「最后时刻提醒」提前量(%sh) 不小于「截止前提醒」"
          "(%sh) ⇒ 本轮跳过 final，避免同一分钟重复催" % (tid, _final_h, _lead_h))
elif nodes.get("final", True):
    _at = close_at - timedelta(hours=_final_h)
```

⇒ **通用范式**：**用户填的值永远是"意图"，系统不得静默改写；冲突一律"降级 + 显式日志"。**
（🔴 反面教材：v303 段的 `max(1, int(cfg["lead_hours"]) - 1)` clamp 曾一度混进**过期部署产物**，
见 `deploy-ops.md §v305`。）

## 四、`per_sales` 是**假开关**（本轮修掉）

`_normalize_reminder` 此前用 `out = dict(REMINDER_DEFAULT)` 起步 ⇒ **`per_sales` 根本没被读过**
（面板能勾、后端当它不存在）。🔴 而且 `per_sales=False` 时**必须同时**把 `unbound = list(missing)`
（未绑销售一并通知），否则会出现「**既没定向到人、也没广播**」= 一条都不到人（正是 v304b 的症状）。
⇒ **验收任何开关的判据**：`grep` 该键名在**读端**（不只是写端/normalize 端）出现过 ⇒ 否则就是假开关。

## 五、通道真相（承接 v304b）

- 企微走 `_push_tenant_channels(_tid, ...)` —— **有租户渠道就只走租户渠道，绝不回落全局**（防串台）；
  全局 `WECOM_WEBHOOK_URL` **从未配置**，故全局 `push_*` 是 no-op。
- `channels.wecom` 默认值 v305 由 **False → True**（老板已收到两条测试消息，通路确认可用）。

## 六、验收（真机）

判据台 `tools/v305-gate-and-config-verify.py` **PASS=76 FAIL=0**；前端真机面板四节点复选框**生产实读**：
`新期次发布时通知` on、`截止前提醒` on、`最后时刻提醒` on、`截止后汇总给主管/老板` **on**、
`按销售列出` on、`站内信` on、`企业微信` **off**。

⚠️ **`tenant_1` 当前无进行中的报单期次** ⇒ 催报**暂无可做**（**数据状态，非缺陷**）；
下一期开放后观察到 `命中「截止前提醒」` 等日志即为验收入口。
未触发时打 `"[Scheduler][v305] tenant=%s: 无进行中的报单期次 ⇒ 无催报计划"`。

## 七、遗留

`tenant_1` 已存提醒配置（2026-09-23 保存，`wecom=false` / `summary=true`）—— 归一化**只在键缺失时兜底**，
**已存值会盖过新默认** ⇒ 老板看到的面板可能仍是旧的 `wecom=off`。**未擅自改写用户数据**（改写 = 替用户改口径）。


## 🔴 「定向到了，但送错人 / 无人可见」——写端键用错（2026-09-29 新增案例）

`_visible_where` 只认 **`users.id` / `username`**。而 `_notify_extra_allocs`
（`forecast_submissions.py:760,773`，加单/减单通知）传的是 **`employee_id`**
（= `product_target_alloc.employee_id` = `hr_employees.id`）⇒ **两把不同的键**：

- 症状二选一，**都不报错、都不留痕**：① 某 `users.id` 恰等于另一人的 `employee_id` ⇒ **送错人**；② 无 user 命中 ⇒ **无人可见**（行照常落库）。
- 收件人**非空** ⇒ 不是广播、不走那条"留空 = 全租户可见"的泄露路径 ⇒ 属**静默错投**，比泄露更隐蔽。
- 🔴 **判据：任何给 `message_send` 传 `recipients` 的调用点，都必须先问「这个值是 `users.id` 吗？」**
  - ✅ 正确：`salary_send.py:253-260` → `employee_account_map()[eid]["id"]`（员工 id → 登录账号 id），取不到**不投递** + warning。
  - ❌ 错误：直接传 `employee_id` / `username` 之外的任何 id。
- ⚠️ `recipients` **必须关键字传**（第 4 位是 `sender`）；`str()` 归一（SQLite 不做隐式转型）。
- 排查入口：`grep -rn "recipients=" server/`，逐个核对取值来源是否 `users.id`。
- 详细修法与双侧验收判据见 `docs/预报-一键分摊与定稿推送-设计方案与开发计划-2026-09-29.md`（P0-1）。

## 🔴 v318（2026-09-29 **已上线**）—— 通知出口「唯一化到关闭期次」＋ 键修复 ＋ 小程序消息页

上面那条「写端键用错」**已修**，且整条通知链**换了出口**。三件事缺一不可：

### ① 出口迁移：`save-matrix` → `关闭期次`
- 旧：`forecast_submissions.py::_notify_extra_allocs`（原 `:726-779`）挂在 **`POST /save-matrix`**（= 保存**草稿**）上
  ⇒ 经理每改一轮保存一次 = 收件箱被草稿刷屏；而真正的终态「关闭期次」**一条都不发**。
- 新：**唯一出口** = `routers/forecast.py::close_period` → `routers/product_targets.py::notify_extra_allocs_finalized(period_id, operator)`。
  `save-matrix` 里 `_notified = 0`（**回执键保留**，语义改为「本动作不发通知」）。
- 🔴 **幂等判据 = 状态跃迁，不是「接口被调了一次」**：`erp_db.py::forecast_period_close` 改为**返回布尔**
  （`was != "closed"`；期次不存在也返回 `False`）。只有 `transitioned == True` 才推送。
  - 为什么不能靠通知层 24h 去重窗口兜底：那个窗口**只对 `is_read=0` 生效** ⇒ 会把
    「关 → 重开 → 再关」这**第二次真·定稿**一起折叠掉。
  - 两个调用方：`forecast.py:511`（端点，会推）与 `scheduler.py:1305`（**自动关单不经端点 ⇒ 不推送**，
    已写进 docstring）。大量测试替身（如 `test_auto_period_v242.py`）不读返回值 ⇒ 加返回值安全。
- 端点回执新增 `{"notified": {"sent","skipped","people"}}`；前端 `confirmClose` 读它出 toast。

### ② 收件人键：`employee_id` → `employee_account_map()`
`notify_extra_allocs_finalized` 经 `db.employee_account_map()` 解析（**与 `salary_send` 同范式**），
**取不到账号的不投递** + warning；`dedup_window=0`（去重交给①的跃迁判据）。
`event_key` 保持 `forecast_extra_alloc|<period_id>|<product_id>` —— 小程序按此前缀识别加/减单。

### ③ 小程序消息页（「通过小程序发送」这句话的落地处）
- **为什么不是微信订阅消息**：「工具→效率」类目**拿不到长期订阅**（只能一次性授权）⇒ 做不了系统主动通知的主渠道。
- 而销售**每天必开小程序报单** ⇒ 「页面内可见」是**零授权、必达**的那条（同款先例 = v304 报单进度提醒条）。
- 新建 `pages/messages/messages.{js,json,wxml,wxss}`（`app.json` 已登记）：读 `GET /api/messages`
  （全部/未读切换、下拉刷新、触底分页、乐观已读、`read-all`）。
  - 🔴 可见性**由服务端 `_visible_where` 收口**，前端**不做第二套过滤**。
  - 🔴 「**读不到**」必须显式渲染错误条，**不能显示成「没有通知」** —— 两者对用户是**完全不同**的结论。
  - 折叠摘要**在 js 里把换行折成全角空格**：`white-space:pre-wrap` 与 `-webkit-line-clamp` 不能同时用。
- 入口两处：`pages/mine`（「我的通知」+ 未读角标）与 `pages/fill` 顶部未读条（`.msg-bar`，**0 条不渲染**）。
- ⚠️ **该接口是裸对象**（顶层 `{items,total,unread_count,has_more}`），**不是** `{success,data}` 信封
  —— 与 `/api/product-targets/*`（**是**信封）不同族。写调用方前先 **curl 一次看形状**，别按同族推断。
- ⚠️ 小程序代码**本轮只在本地就绪**：必须在**微信开发者工具**里上传/提审，网页端部署**不含**它。

### ④ 🔴 第〇层：**先问「这条路径到底发不发」**（v318+1，2026-09-29 实测）
查「通知没到人」时，四层（跑没跑 / 有无内容 / 通道走向 / 能否主动出站）**之前**还有一层：
**这个动作走的代码路径，究竟有没有挂通知？**
- 生产实证：v318 把加单/减单推送挂在**手动** `POST /api/forecast/periods/{pid}/close`。
  但实际生产的定稿**主要来自自动关单** —— `scheduler.py::_auto_period_close` **直调 `db.forecast_period_close`、不经端点**
  ⇒ **今天期次 #21 的定稿（09-29 11:18）一条通知都没发**。
- 判据：`grep -rn "<写状态的那个函数名>"` ⇒ **有几处调用？** 每一处都要问「副作用带了吗」。
  **服务层直调 vs 走端点** 是这类漏挂的头号成因。
- ⚠️ 修法不能"顺手也挂到自动路径"：自动关单 11:00、v305 授权改单可改到 12:00
  ⇒ 11:00 推的是**一小时后还会被改掉**的版本，且推送**不可撤回**。
  ⇒ 正解是「把出口定在**人确认的那一次**」：自动关单只标「尚未推送」，另给手动推送按钮。
- 同类铁律延伸：**「两条路径产出同一状态」本身就是缺陷信号**（详见技能
  `hergent-capability-reality-audit` 第三十三种伪装）。

### v319c 落地（2026-09-29 已上线）：出口 = 「关闭期次」端点的**人工那一次** ＋ 手动补推

- 自动关单（`scheduler._auto_period_close`）现在**只落 `closed_mode='auto'`**，`alloc_pushed_at` **保持空**
  ⇒ 历史页对该期次显示「尚未推送」＋「推送通知」按钮，**由人确认的那一次才真发**（老板拍板）。
- 手动出口 = `POST /api/forecast/periods/{pid}/push-alloc`。🔴 **刻意不拦重复推** —— 这是人明确点的动作，
  服务端拦反而让「补推一次」这个正当操作做不到；防误点是前端 `confirm` 的职责。
- `close_period` 推送**走成功就写 `alloc_pushed_at`**（本期无加/减单时 `sent = 0` 也算「这个动作已完成」）；
  **抛异常则不标记** ⇒ 如实停在「尚未推送」。
- ⚠️ **别把 `closed_at` 当「已推送」的判据**：关闭是**状态**、推送是**动作**；
  自动关单改了状态但**没做动作** —— 这正是本条要消灭的静默（经理以为"已经通知下去了"）。
- 界面护栏：只有 `alloc_count > 0`（本期真有加/减单分配行）才显示推送按钮，否则那是**假待办**
  （让人去点一个没内容的动作）。生产 5 个历史期次 `alloc_count` 全 0 ⇒ 都不显示，**设计如此**。
- ⚠️ 存量期次的 `closed_mode` 全为空串（列是 v319c 才加的）⇒ 界面显示「（早期定稿，无留痕）」。
  **这是如实**，但老板可能以为"没生效" —— **留痕从下一次关闭开始才有**，要主动说明。

---

# §v330（2026-09-29 已上线）通知**错发** —— 「空 recipients = 广播」这一条语义在角色变多后崩了

**触发**：老板「刚登录刘小顶的小程序账号，发现他收到大量与他无关的系统通知」。

## 一、病根：**收件人维度只有"人"，没有"角色"**

`message_center` 的 `recipients` 空值 = **广播（全租户可见）**。
2026-09-14 建这条语义时的现实是「**只有老板一人用 Web 工作台**」⇒ 广播无害。
**v318 把同一个接口接到了小程序**（销售每天必开报单）⇒ 广播立刻变成**全员可见老板的经营告警**。

🔴 **最容易误判的一点**：界面上的「会计 / 经营副驾 / 运营主管」是 **`sender`（发送者标签）**，
**不是收件人**。写端 21 个调用点**全部只传第 4 位 `sender`**：

```python
db.message_send("库存预警", msg, "warning", "经营副驾")   # 第 4 位 = sender；recipients 默认 ""
```
⇒ **看着像"发给这些角色"，实际全是广播**。查这类问题先问：**"这个字段是发件人还是收件人？"**

**生产读数（改前，tenant_1）**：总 **21,352** 条 → 销售（刘小顶，`sales`，`login_scope=mini`）
**可见 21,351 ＝ 100.0%**；`recipients=''` 的 **21,350** 条、真定向仅 **2** 条；
库存预警 13,355 ＋ 应收逾期 7,924 ＝ **99.7%**。
🔴 **不是"噪音"是"泄密"**：首条正文「永辉民发店(¥177,014)、襄阳一中（三绿）XYB(¥67,764)、
美团优选(¥47,710)，逾期总额 **¥1,315,656**」—— 客户名 ＋ 欠款金额 直接发给业务员。

## 二、判定模型（**两轴，从窄到宽**）—— 唯一实现在 `finance.message_visible()`

```
① recipients 非空  ⇒ 只给这些人（人级定向：催报 / 工资条 / 定时任务结果）
② recipients 为空  ⇒ 按 event_key 查受众规则表 ⇒ 用户的**任一角色**在受众里即可见
③ 查不到（新事件忘了登记）⇒ 只给 admin,boss
```

🔴 三条纪律：
1. **规则表是唯一实现**（`db/queries/finance.py` 顶部）。读端**不许自己再写一份角色判断**
   —— 本项目已多次栽在"同一条规则抄成两份"。
2. **`recipients` 优先且不叠加角色** —— 否则"发给某人"的定向通知会因角色相符而漏给别人。
3. **未登记 ⇒ 只给管理端**：fail-closed 对业务员，**但对老板绝不隐藏**
   （绝不能因为"漏登记"而少给老板东西）。

**受众表要点**（完整表在代码里）：
- 经营结果/钱的账（盈亏快报、应收逾期、异常支出、合同到期）→ `admin,boss,accountant`
- 洞察类（AI 经营洞察、今日经营洞察、档案健康）→ `admin,boss`
- 客户流失 → `admin,boss,sales,supervisor`（业务线要跟进，不含金额）
- 执行面（库存预警、效期预警）→ `admin,boss,accountant,supervisor,staff`
- 🔴 **报单线**（本期报单已开放、预报催单、预报·新期次、`forecast_*`）→
  `admin,boss,sales,supervisor,distributor,staff`
  **必须含 `sales/staff/distributor/supervisor` 四个** —— 它们才是
  `core.ROLE_LOGIN_SCOPE` 里能在**小程序**登录的人。漏掉 = 「该报单的人收不到催报」，
  **与错发是同一枚硬币**（一个多给、一个少给，都静默）。
- `定时任务·*` → 兜底 `admin,boss`，**正常靠 `recipients` 定向给创建者**
  （`cron_tasks.user_id` / `scheduled_tasks.user_id` **就是 `users.id`**）

## 三、同源的两个附带缺陷

1. 🔴 **`is_read` 是共享行上的单列、没有 per-user 维度** ⇒ **任何一人点「全部已读」，
   全租户（含老板）的未读一起清空**。
   实证：`/var/log/nginx/access.log*` 全量只有 **4 次** `POST /api/messages/read-all`，
   其中 **2026-09-29 21:56:46 那次来自小程序**（iPhone / `MicroMessenger`、
   referer `servicewechat.com`），同一时刻库里 21,350 行 `is_read=1`。
   - 本轮**只结构性堵住了最严重的一半**：`read-all` 只作用于**可见行** ⇒ **不可见就改不到**，
     销售再也清不掉老板的未读。
   - **未做**：受众**重叠**的两个角色（boss 与 accountant 都能看「应收逾期」）仍共享那一行已读位。
     要干净需 `message_reads(user_id, mid)` 表 —— 该表要走 **ddl_map 三处齐 + 索引登记**，
     属独立 schema 变更，**单开一轮**。
2. 🔴 **定时任务结果通知把老板的私人任务原话广播给全员** ——
   `scheduler._execute_scheduled_task` 的 `message_send` 不带 `recipients`，
   而标题就是用户原话（生产 39 条＝「你帮我设个定时任务，每天上午8点把当日AI方面的重大新闻发给我」）。
   已修：`recipients=` 定向给创建者；`_check_cron_tasks` 透传 `user_id`。

## 四、顺手清掉的**第二条读路径**（安全）

`erp_db.py` 里有 4 个**无门禁读函数**（`message_list` / `message_mark_read` /
`message_mark_all_read` / `message_unread_count`）—— 直接
`SELECT * FROM message_center WHERE is_read=0`，**完全不过滤收件人/受众**。
全仓（含 `tools/` 与 `laozhangai-product`）实测 **0 调用方** ⇒ 已删除。
**判据**：改通知可见性时，必须 `grep -rn "message_center" server/` 找出**所有**读路径
—— 只改路由层会留下一个"能绕过门禁的后门"。

## 五、验收这一域的姿势（本轮实证）

| 层 | 做法 | 读数 |
|---|---|---|
| 纯函数 | `audience_for_event` / `roles_in_audience` / `message_visible` | 5 条 |
| 读端集成 | **临时 SQLite 造数据** + 直接调 `routers.messages._visible_scan(conn, user)` | 7 条（6 种角色可见集） |
| 判别力 | `tools/v330-audience-discriminate.py`：把判据改坏（关受众轴 / 放宽默认 / 去前缀 / 定向不优先） | **5 坏副本全红 + 1 NO-OP 不误报** |
| 生产干跑 | **只读**真库跑真代码，拿"改后"读数 | 刘小顶 **21,351→2**、boss **21,351→21,351 零损失** |
| 生产真机 | 真账号打真接口（**全 GET，不调 `read-all`**） | 销售 `total=1`；老板 `total=1975` 全量 + `groups=12` |

🔴 **两个判据自己的坑**（比产品 bug 更值得记）：
- **"老板零损失"的判据不是「看到全部行」**，而是「**看不到任何发给别人的**」。
  我改了两次才对：第一次把「定向给老板自己的那行」当成"发给别人的"、
  第二次把「定向给刘小顶的那行」算成老板的。
- **判别力自证的坏副本不能只造一个 `db/queries/finance.py` 骨架** ——
  那会**把真 `db` 包整个遮住**，`from db.connection import ...` 立刻 ModuleNotFoundError，
  于是「报红」变成「导入失败」= **假绿**。修法 = **复制真 `db` 包**再替换其中一份。

## 六、性能与边界

逐行判 + 全表读：**tenant_1（2.1 万行）真机 352ms**（改规则**立即**对存量 21,352 行生效，
**无需回填**）。⚠️ 百万级需改成「**写端落 `audience` 列 + SQL 侧过滤**」。

## 🔴 v330+1 补：**给了受众 ≠ 给了门禁** —— 通知有两个门，v330 只开了第一个

**症状**：唐成（`distributor`，报单人）小程序「我的通知」：
「你的角色『distributor』没有『首页看板』的使用权限」。

**根因**：v330 把 `distributor`/`staff` 放进了**报单线受众**，但 `/api/messages` 归
**`dashboard` 模块**，而 `distributor` 只有 `["data"]`、`staff` 只有 `["data","stock"]`
⇒ RBAC 中间件在**可见性之前**就 403 了。

### 两个门必须一起开

| 门 | 谁管 | 本次状态 |
|---|---|---|
| **受众门**（这条通知该给谁） | `finance.message_visible()` | ✅ v330 已开（分销商在报单线受众里） |
| **模块门**（这个人能不能打开收件箱） | `core._check_perm(u, module)` + `_PATH_MODULE_MAP` | ❌ v330 漏了 ⇒ 403 |

⇒ **改通知可见性时，必须同时查 RBAC 模块门禁**，否则会出现「名单里有他、他却进不去」。

### 修法：拆出独立窄模块 `messages`（与 v296 拆 `payroll` 同款）

🔴 **两个看似省事、实则错误的选项**（别再走）：
- `"/api/messages": "data"` ⇒ `accountant` 的模块是 `dashboard,accounts,reports`、**没有 data**
  ⇒ 把会计挡在门外（而应收逾期/异常支出的受众正是会计）。
- 给 `distributor` 加 `dashboard` ⇒ `dashboard` 还管 `/api/dashboard`、`/api/today`
  （首页看板 = 经营数据）⇒ **过授权**。

✅ 按 **v296/v328 五项同步纪律**落（缺一处就全员 403 或"权限名与功能不一致"）：
1. `core._ALL_MODULES` += `messages`（权限页能勾到）
2. `server._PATH_MODULE_MAP`：`"/api/messages": "messages"`
   （匹配 = **首个 `startswith` 命中即停**，故 `/briefing`、`/read-all`、`/{mid}/read` 一并覆盖）
3. `core.MODULE_IMPACT` += `messages`（`entries/feeds` 都空，但**不等于"勾了没变化"**：
   勾了才读得到通知数据）
4. `server.list_modules` 标签表 += `"messages":"消息通知"`
5. 🔴 **迁移脚本回填 `role_permissions`** —— `perms_for` = `{**_DEFAULT_PERMS, **租户自定义}`
   是**按角色整表覆盖**（生产 tenant_1 的 `distributor` 就存着 `["data"]`）
   ⇒ **不迁，代码改了也白改**。本轮干跑→落库 17 行（主库 1 + tenant_1 9 + tenant_10 7）。
   外加 `core.MINI_MODULES` 补 `messages`（小程序 v318 起真在调；该常量注释明确要求"日后加了新模块必须回来补"）。
   ⚠️ 权限缓存 **无 TTL** ⇒ 迁完**必须重启**才生效。

### ⚠️ 已知缺口（v330 副作用，未修）

**自定义角色**（如 tenant_1 的「库管」）**不在受众规则表里** ⇒ 落到 `DEFAULT（admin,boss）`
⇒ **看不到任何通知**。建议：受众规则表支持"自定义角色 → 受众"配置，
或按该角色**拥有的模块**推受众（有 `stock` ⇒ 库存/效期类）。**别假装它不存在。**
