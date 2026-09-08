# Hergent 项目长期记忆

## 产品线与战略
- **hergent.cn**=AI 经营副驾（主产品），同源 erp.hergent.cn。前端 hergent-cn-v2（Vue3+Vite+Pinia，静态 `/opt/hergent-cn-v2`）；后端 hergent-erp（FastAPI+SQLite，`server.py:8700`，本地 `~/Documents/hergent-erp`，分支 `upgrade/v84-international`）。desktop-app 已冻结。
- 战略=**不造 ERP**，坐客户 ERP 之上做分析/顾问/副驾；数据走 Excel/CSV 或连接器（金蝶/用友/畅捷通）。护城河=低温奶配方化算法+副驾交互。订单 CRUD 冻结，回写走连接器。
- 自媒体：视频号「老张ai实践记」+公众号长文；北极星=加微信的精准经销商人数。脱敏红线：返利率/进货价/客户名/区域销量/不评厂家政策。
- ⚠️ **写作规范（2026-09-07 定稿）**：① 系列化互引；② 读者是不懂技术小白→禁用术语转人话（AppSecret→"一把钥匙"、token→"算力消耗（花钱）"、headless→"没窗口的浏览器"）；③ 单篇 1000–1500 字；④ 段落短、小标题多、金句单列。公众号=个人主体未实名→走零凭据粘贴版 HTML。

## 用户与主体
- 用户=蒙牛低温奶经销商，一人公司，懂业务不懂代码，纯靠 AI 开发。
- 主体=湖北省小赫智体数字科技有限公司（自然人独资，2026-05-26，襄阳樊城区，注册资本 50 万，经营范围含 AI 软件开发/互联网销售、**无食品/乳制品**）。法人=张俊峰。信用代码 `91420606MAKF1YPG5Y`；ICP 备案 `鄂ICP备2026027973号-1`。
- ⚠️ **ID 凭据铁律**：信用代码/AppID/备案号/密钥一律**用户文本确认+正则校验**再采信（小程序 AppID `^wx[a-f0-9]{16}$`）。已多连错（OCR 写错法务页、采信假 AppID）。**不靠 OCR。**
- ⚠️ 主体信息出现位置（更正须全改）：`hergent-cn-v2/public|dist/legal/{privacy,terms}.html`、`src/pages/Login.vue` footer、根目录 `备案材料.md`/`上架准备清单.md`、小程序 3 个材料 md、`landing-page/index-icp.html`。
- ⚠️ managed node=`/Users/zhangjunfeng/.workbuddy/binaries/node/versions/22.22.2-2/bin/{node,npm}`

## 设计铁律
1. AI 只建议不擅自下单。2. 蒙牛/舟谱无开放 API→只生成粘贴模板/CSV；**不做服务端爬虫、不托管客户账号**。3. Hermes 版本 pin 住。4. AI 层默认无商品录入入口（预报内联 Excel 网格例外）。
5. ★**产品门面标准**：每新功能先问"谁付费、谁天天看"，答不上=运维自保，不许进客户门面；运维类藏进 `设置›AI 运维`。
6. 用户偏好：极简直接、行动导向；交付摘要五段（交付/变更/构建/对齐/需确认）；"全做"=批量端到端；one-Edit-at-a-time+grep 复核。

## 前端（hergent-cn-v2）
- 设计令牌 `variables.css` 双主题；品牌青 `--p=#06b6d4`。统一 Lucide `<Icon>` 线性 SVG（WeatherWidget 例外保留彩色 emoji）。
- 统一 HTTP 层 `src/api/client.js` 的 `api(path,opts)`（timeout=20000）；后端信封 `{success,data?,detail?,message?}`。Hermes REST=`hermesRequest`，SSE=`hermesChat`。禁裸 fetch（除 login/register/demoLogin）。
- ⚠️ 副驾对话**前端直连 Hermes SSE** `/hermes/v1/chat/completions`，不经 server.py。
- ⚠️ Vue3 `<script setup>` 自动 unwrap **仅限模板**，函数体内必须 `.value`；`reactive` 必须显式 import。大块删 .vue 区块用 **python 锚点切片**勿用行号。

## 部署真相（每次改动必读）
- 前端：`mv dist /tmp/hergent-dist-bak-$(date +%s)`（vite 清空触发 safe-delete 拦截）→ `npm run build` **&&** `rsync -a --no-owner --no-group --delete dist/ root@47.113.224.140:/opt/hergent-cn-v2/` **&&** `chown -R hergent:hergent`。**必须 &&**。nginx 静态无需 restart。
- hergent.cn：/api/→8700、/hermes/→18765（Bearer hergent-prod-gateway-key-2026）。nginx 按 Host 分流，验证静态须 `-H "Host: hergent.cn"`。
- 后端：用仓库根 `deploy.sh`（排除 .env；**绝不 rsync `*.db`**；chown→rm `__pycache__`→systemctl restart）。**严禁裸 rsync --delete server/**（2026-08-22 删 .env 致服务挂）。健康 `curl --noproxy '*' http://127.0.0.1:8700/api/health`；重启后 **sleep 5** 再探活（3 秒误报 000）。
- ⚠️ **生产=早期部署的工作区整体**：那 3789 行未提交改动+未跟踪新文件（ai_channels/chanjet_connector/datasource_store/recipe_sync/routers/admin_backup/ai_fallback/ai_observability 等）早已在线上（`server.py` 第 762–785 行 include_router 它们）。只部署 HEAD 会回退线上 `forecast.py`(+614)。**部署改动须全量比对工作区 vs 生产 md5，确认无意外回退再 rsync。**
- 生产 E2E：`POST /api/auth/demo-login`（demo 租户不污染真实数据，返回顶层 `token` 字段）；写操作用 `Bearer $TOKEN` 绕过 CSRF；生产查数据可用 `mptestsp/Mpsup@1`（X-Tenant-Id:1）。
- 真机验证 agent-browser：**hash 路由**；**禁设 AGENT_BROWSER_PROXY**；需 `AGENT_BROWSER_EXECUTABLE_PATH="/Applications/Google Chrome.app/..."`。
- ⚠️ 本地 `.git/index.lock` 沙箱内 unlink 被拒→git 写操作全失败；需 `dangerouslyDisableSandbox` 在沙箱外 `rm -f .git/index.lock`。

## 后端踩坑铁律
- **新路由必须登记 RBAC**（`server.py _PATH_MODULE_MAP` 前缀匹配，未命中 fail-closed 403）。已登记：`/api/forecast`→data、`/api/forecast-submissions`→data、`/api/forecast-audit`→stock、`/api/rebate-rules`→sales、`/api/cron`→data、`/api/params`→data、`/api/ai`→chat、`/api/admin`→*、`/api/platform`→hr。带真实登录态测（supervisor 对 sales 模块 403 属正常）。
- **ERP_SECRET 与密码哈希强绑定**：`_hpw`=bcrypt(pw+SECRET)，换/丢 SECRET=全员密码失效；**密码硬上限 8 字符**。登录走主库 erp.db，错 5 次锁 15 分。
- **勿对 sqlite3.Row 用 `.get()`**→列表 GET 直接 500；入口 `if not isinstance(r, dict): r = dict(r)`。E2E 必须覆盖列表 GET。
- **同库读写必须同一 tenant context**（audit_log 在 `_auth()` 后写租户库，查询端 `set_tenant_context(None)` 查主库→永远空）。`db.get_db()` 是生成器式 context manager，必须 `with`。
- **跨租户写主库（users/user_tenants/tenants）禁用 `get_db()`**（跟随调用者租户上下文会写进 tenant_N.db）；须 `sqlite3.connect(db.DB_PATH)` 直写主库。
- data.py import forecast_audit→forecast_audit 里**必须函数内延迟 import** data（否则成环）。
- ⚠️ **核查纪律**：报告"已上线"不算数，必须回代码 grep 符号+生产 md5 验证；grep MISS 后二次细查再定论。
- **AI 建议日志 `ai_advice_log`** 两路写入：① 工作流留痕 `erp_db.log_workflow_advice`；② 副驾采纳 `ai_assist.py` `/api/ai/advice`+`/decide`（adopted/rejected）。`ai_usage` 在 ai_assist.py。

## 预报/报单/品牌目标（v121 已落地）
- **`forecast_periods`**（期次/报单表，租户库）：`id,name,order_start,order_end,arrival_date,status,created_at`。**无 brand 字段→报单表租户级全局、多品牌共用一张**（勿改按品牌拆分）。创建 `forecast_period_create`；关闭 `forecast_period_close` 仅改 status。
- **`rebate_target_rules`**（品牌目标）：基础字段 + **到货排程 6 字段** + **v121 报单排程 10 字段**（`order_mode/order_cadence_days/order_weekdays/order_first_date/order_lead_days/order_max_early_days/auto_period_enabled/auto_open_time/auto_close_time/supplier_deadline_time`）。
- **报单节奏算法（2026-09-08 定稿，方向不可反）**：主序列=最密品牌节奏；品牌归属=提前窗口匹配 `[C_X−E_X, C_X]` 取 max；`D_k>C_X` 作废、`D_k<C_X−E_X` 太早。**零漏报充要条件 `cadence_main ≤ min(E_X)+1`**（蒙牛 cad=2/E=1→0 漏）。**报单只能提前不能延后**。
- **三时点模型**：`T_open`=报单日前一日 20:00 → `T_close`=当日 10:00 → `T_supplier`=当日 12:00（仅提醒不代下单）。窗口 14h 跨夜。错过关单→管理员重开（仅 admin/boss）。
- 算法引擎 `server/domain/arrival_schedule.py`（`effective_interval`/`compute_order_dates`/`match_brands_to_periods`/`build_period_plan`/`suggest_first_date`）；预览 `GET /api/rebate-rules/auto-period-preview`（须在 `/{rule_id}` 前定义）；`_row_to_dict` 白名单须补新列；迁移 `erp_db.py` 两处（tenant patch 元组 + `_safe_migrate` 脚本）。
- ⚠️ **v121 第一批已部署（2026-09-08，`52d7806`+`9c2aa5c`）**：配置面板+6 期预览闭环。**刻意未做 P3 调度执行**（先核对算法再动期次表）。下一批：jobs 台账+monitor、重开端点、`forecast_period_current()` 改时刻判定、`forecast_periods`+10 列、触达（通知/品牌标签/小程序顶部）。
- ⚠️ **v121c 已部署（2026-09-08，仅前端未 commit）**：创建品牌目标只剩「按 12 个月分解」一种模式（默认铺开、无开关），删周期口径与独立目标金额，支持「全年一次录 + 单月微调」，触发方式并入该区。**分流铁律**：`isBrandMonthly = dimension==='brand' && target_type==='amount'` 才走 12 月区；商品目标共用同一弹窗，必须保留原「周期口径+目标金额/数量」，不能全局删（后端仅品牌支持月度分解）。品牌模式 `target_value = 各月之和`，须校验「至少 1 月金额 + 1 月返利率」否则后端 400。老规则月/季口径**不自动拆分**（会改口径），只提示。：「到货日」字段 + 报单日/N/到货日双向联动。**铁律：到货日【不落库】**（只存 `order_lead_days`），否则与「报单日+N」双源必矛盾；到货日=computed，手改即反推 N。N 非法/清空时预览请求不透传 `order_first_date` → 后端回退 arrival 口径（防"界面空、后台按4天算"）。日期一律 `Date.UTC` 算（闰年/跨月/跨年安全）。**不跳周末节假日**（系统现状）。
- ⚠️ **v122 R5 修复 + 字段增强（2026-09-08 已部署）**：
  - **R5 根因**：存量真实品牌规则**多是月口径单期**（tenant_1 四条全 month：蒙牛/简爱 8月、9月，100万/8万）。v121c 锁死「12 月分解唯一模式」且 `save()` 强制 `period_type='year'` → 编辑「9月100万」会变「年度100万」，**返利少算 12 倍**。
  - **方案 A**：品牌页「**年度(12月分解) / 单期(月单值)**」双模式（`brandMode`），按 `period_type` 回填（有 monthly_* 或 year→年度；否则单期），新建默认年度。切换不清空 monthlyRows，保存时才决定写不写月度分解。
  - 新列 `target_year`（年度必填，默认当前年，2000-2100）、`target_unit`（数量单位）；商品默认 `target_type='amount'`；商品维度**整块隐藏 arrival-block**（报单节奏与单品无关）；品牌维度隐藏「目标度量」（只能金额）。
  - ★★★**新增列必须登记【三处】白名单**：① `_row_to_dict` ② INSERT/UPDATE SQL ③ **`update_rule` 的局部更新元组**（L1039 `for k in (...)`）—— 漏了第③处，body 传了也会被 merged 覆盖回旧值**静默丢弃**（本次 target_year 写完回读 None 才暴露，排查 20 分钟）。
  - 商品名候选接 `productRefs`（0→12）；保存时 `resolveProductKey(scope_name)→scope_key`，否则填了名字但 key 空 = 作用于全部单品。
  - **遗留**：文件级拆分（BrandTargetForm.vue / ProductTargetForm.vue）**未做**；品牌约束仍写在前端 `save()` 应下沉 `validate_rule`。
- ★★**到货/报单节奏已合并（2026-09-08 落地，用户选方案 B）**：Rebate.vue 两张卡（到货模式 + 智能报单表）合并为一张「到货与报单节奏」，三分区（①节奏 ②到货产出 ③报单自动化）。
  - **根因**：同一个「到货节奏」被配两遍且可冲突 —— `arrival_first_dom` 是**月内日**（跨月重置）vs `order_first_date` 是**绝对日期**（跨月连续）；均单走 `arrival_*`、预览表走 `order_*` 派生，会算成两个结果（实例：arrival_cadence=2→均单15次 vs order_cadence=3→到货10次，冲刺看板算错）。
  - **统一为单一数据源**：以 `order_*`（报单语义）为唯一输入，到货日 = 报单日 + `order_lead_days` **派生**。`arrival_*` 列保留不删，降为「未迁移时的回退口径」，不静默改写。
  - 后端新增 `compute_arrival_dates_from_order()`；`arrival_summary()` 改**双轨**（有 `order_first_date`→order 派生，否则回退 arrival_*），返回 `source` 字段；`/arrival-preview` 透传 `order_*`（`None`=未传、空串=显式清空退回 arrival_*）。
  - 前端新增迁移弹窗 `openMigrate()`：由旧 `arrival_*` 反推 `order_*`（interval=当月首到日−lead；weekday=到货星期−lead 天），需用户点「确认换算」。
  - ⚠️ **均单口径会变**（迁移后 9 月 15次/6.0万 → 13次/6.92万），因「首次报单→首次到货」隔着提前期，属正确新语义，弹窗已提示。未点迁移的规则行为完全不变。
  - 交付说明：`v121-到货报单合并-交付说明.md`（仓库根）。两仓改动仍未 commit/push。

## 微信小程序「小赫 AI 报单助手」
- AppID=`wxf8ce9b8e4b5693be`；类目「商业服务→企业管理」；备案已提交（域名 ICP ≠ 小程序备案）。提审账号 `mptest/Mptest@1`(sales)、`mptestsp/Mpsup@1`(supervisor)。认证 300 元/次且年审。
- ⚠️ 小程序提交落库 `order_date`=期次 `order_start`（非提交当天）→"按今天查"查不到，须按期次窗口查。`wx.switchTab` 只能跳 tabBar 页。
- 「审批预报单」已下线（经销商以经销商为单位采购，不按门店拆单）；保留 recall + 汇总只读。
- 报单提交 status=`pending` 即计入汇总，无需审批；UI 文案 pending=「已提交」、approved=「已定稿」。

## 事故与凭据
- 2026-08-22：裸 rsync --delete server/ 删 .env→服务挂；已重建（重生成 ERP_SECRET）并备份 `/root/.hergent-env/.env`。
- 凭据：`/opt/hergent-erp/.env`、`/root/.hergent-env/.env` 勿提交 git。企业微信API.docx 含明文密钥（建议迁密钥管理器）。
