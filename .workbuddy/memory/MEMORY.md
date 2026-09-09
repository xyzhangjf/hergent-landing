# Hergent 项目长期记忆

## 产品线与战略
- **hergent.cn**=AI 经营副驾（主产品），同源 erp.hergent.cn。前端 hergent-cn-v2（Vue3+Vite+Pinia，`/opt/hergent-cn-v2`）；后端 hergent-erp（FastAPI+SQLite，`server.py:8700`，本地 `~/Documents/hergent-erp`，分支 `upgrade/v84-international`）。desktop-app 已冻结。
- 战略=**不造 ERP**，坐客户 ERP 之上做分析/顾问/副驾；数据走 Excel/CSV 或连接器。护城河=低温奶配方化算法+副驾交互。订单 CRUD 冻结，回写走连接器；AI 只建议不擅自下单。
- 自媒体：视频号「老张ai实践记」+公众号长文；北极星=加微信的经销商人数。脱敏红线：返利率/进货价/客户名/区域销量/不评厂家政策。写作规范（2026-09-07）：系列互引、术语转人话、单篇 1000–1500 字、段落短小标题多金句单列。

## 用户与主体
- 用户=蒙牛低温奶经销商，一人公司，懂业务不懂代码，纯靠 AI 开发。主体=湖北省小赫智体数字科技有限公司（自然人独资 2026-05-26，襄阳樊城，注册资本 50 万，经营含 AI 软件/互联网销售、**无食品**）。法人张俊峰。信用代码 `91420606MAKF1YPG5Y`；ICP `鄂ICP备2026027973号-1`。
- ⚠️ **ID 凭据铁律**：一律**用户文本确认+正则校验**再采信（AppID `^wx[a-f0-9]{16}$`），**不靠 OCR**。主体信息多处出现（legal html、Login.vue footer、备案 md、小程序材料）更正须全改。
- managed node=`/Users/zhangjunfeng/.workbuddy/binaries/node/versions/22.22.2-2/bin/{node,npm}`

## 设计铁律
- ★产品门面标准：每新功能先问"谁付费、谁天天看"，答不上=运维自保，不许进客户门面；运维类藏 `设置›AI 运维`。AI 层默认无商品录入入口（预报内联 Excel 网格例外）。
- 偏好：极简行动导向；交付摘要五段（交付/变更/构建/对齐/需确认）；"全做"=批量端到端；one-Edit-at-a-time+grep 复核；选项 A/B/C + 影响表。

## 前端（hergent-cn-v2）
- ⭐ 返利目标表单已拆分（v122）：`src/components/rebate/`=`useRebateTargetForm.js`(纯逻辑)+`TargetFormModal.vue`(按 dimension 分流)+`Brand/ProductTargetForm.vue`+`MonthlySplitBlock/ArrivalRhythmBlock/RebateValueBlock.vue`；`Rebate.vue` 退化宿主。子组件依赖走 props/emits，禁复用父页作用域变量。
- 品牌目标双模式：`brandMode`=年度(12 月分解，按 period_type 有 monthly_* 或 year 回填)/单期(月单值)；`target_year/target_unit` 新列。**到货日不落库**（只存 `order_lead_days` 反推）；日期一律 `Date.UTC`；不跳周末节假日。
- 统一 Lucide `<Icon>` 线性 SVG（WeatherWidget 例外彩 emoji）；统一 `src/api/client.js` `api()`；**副驾 SSE 前端直连 Hermes** `/hermes/v1/chat/completions` 不经 server.py。
- ⭐ **前端零图表库**（deps 仅 vue/vue-router/pinia/xlsx）。需要图表一律**纯 SVG 自绘**，不引 ECharts（避免 +330KB gzip，违背轻量 AI 层定位）。v123 已有可复用实现：`components/rebate/MonthlyAchvChart.vue` + `useMonthlyAchv.js`。
- ⚠️ **`<script setup>` 顶层 `watch([a, b, someRef], fn)` 会 TDZ**：watch 注册时即求数组值，若该 ref 定义在下方 → `Cannot access 'x' before initialization`。一律写 getter `() => x.value`。
- ⚠️ **vite dev 缓存会制造假象**：改完源码务必 `pkill -f vite && rm -rf node_modules/.vite` 再重启，否则一直跑旧编译产物（曾据此误判"回退基线也报错"）。另：`npm run build` 在 dev server 运行时 emptyDir 会 rmSync 失败，先 pkill。
- ⚠️ Vue3 `<script setup>` 函数体内必须 `.value`；`reactive` 显式 import；大块删 .vue 用 python 锚点切片勿用行号。

## 部署真相（每次改动必读）
- 前端：`mv dist /tmp/hergent-dist-bak-$(date +%s)` → `npm run build` **&&** `rsync -a --no-owner --no-group --delete dist/ root@47.113.224.140:/opt/hergent-cn-v2/` **&&** `chown -R hergent:hergent`。必须 &&，nginx 静态免 restart。
- hergent.cn：/api/→8700、/hermes/→18765（Bearer hergent-prod-gateway-key-2026）。验证静态须 `-H "Host: hergent.cn"`。
- 后端：仓库根 `deploy.sh`（排 .env；**绝不 rsync *.db**；chown→rm `__pycache__`→systemctl restart）。**严禁裸 rsync --delete server/**。health `curl --noproxy '*' http://127.0.0.1:8700/api/health`；重启后 **sleep 5** 再探活。
- ⚠️ **生产=早期部署的工作区整体**（数千行未提交改动+未跟踪新文件早已在线）；只部署 HEAD 会回退线上 `forecast.py`(+614)。部署前须全量比对工作区 vs 生产 md5 防意外回退。
- 生产**扁平布局**：`/opt/hergent-erp/` 直接是 `server/` 内容，无 server/ 子层。服务器跑单测：先 `. /opt/hergent-erp/.env`（缺 ERP_SECRET 会 RuntimeError），再 `sys.path.insert(0,'/opt/hergent-erp')`。
- 生产 E2E：`POST /api/auth/demo-login`（demo 租户不污染，token 顶层）；查数据 `mptestsp/Mpsup@1`（X-Tenant-Id:1，但 rebate-rules 属 sales，supervisor 403 正常）。
- GitHub 推走 **SSH:443**（https PAT 已过期）。本地 `.git/index.lock` 沙箱 unlink 被拒→dangerouslyDisableSandbox 外 rm。真机 agent-browser：hash 路由、禁 AGENT_BROWSER_PROXY、需 Chrome executable path。

## 后端踩坑铁律
- **新路由必须登记 RBAC**（`server.py _PATH_MODULE_MAP`，未命中 fail-closed 403）：forecast/forecast-submissions/cron/params→data、forecast-audit→stock、rebate-rules→sales、ai→chat、admin→*、platform→hr。
- **ERP_SECRET 与密码哈希强绑定**（换/丢=全员密码失效；密码硬上限 8 字符）；登录错 5 次锁 15 分。
- sqlite3.Row 勿 `.get()`（入口 `if not isinstance(r,dict): r=dict(r)`）；同库读写须同一 tenant context；`db.get_db()` 是 with 生成器。跨租户写主库（users/tenants）须 `sqlite3.connect(db.DB_PATH)` 直写。data↔forecast_audit 成环→函数内延迟 import。
- 核查纪律：报告不算数，必须 grep 符号+生产 md5。**新增列登记【三处】白名单**：① `_row_to_dict` ② INSERT/UPDATE SQL ③ `update_rule` 局部更新元组（漏③会静默丢弃）。

## 预报/报单/品牌目标
- `forecast_periods`（期次/报单表，租户库）**无 brand 字段→租户级全局、多品牌共用一张**。创建 `forecast_period_create`；关闭 `forecast_period_close`。
- **报单节奏算法（2026-09-08 定稿）**：主序列=最密品牌节奏；品牌归属=提前窗口 `[C_X−E_X, C_X]` 取 max；零漏报 iff `cadence_main ≤ min(E_X)+1`（蒙牛 cad=2/E=1→0 漏）。**只提前不延后**。
- 三时点：T_open=报单日前一日 20:00 / T_close=当日 10:00 / T_supplier=当日 12:00（仅提醒不代下单）。错过→admin/boss 重开。
- 引擎 `server/domain/arrival_schedule.py`；预览 `GET /api/rebate-rules/auto-period-preview`（须在 `/{rule_id}` 前定义）。
- 已部署：v121 第一批 `52d7806`+`9c2aa5c`（配置面板+6 期预览，**刻意未做 P3 调度执行**）；v122 R5 修复+字段增强（根因：存量月口径单期被 v121c 强改年度致返利少算 12 倍，改双模式）。到货/报单节奏合并（方案 B，单一 order_* 数据源，arrival_* 降为回退口径不静默改写）。

## 小程序「小赫 AI 报单助手」
- AppID=`wxf8ce9b8e4b5693be`；类目「商业服务→企业管理」；提审账号 mptest/Mptest@1(sales)、mptestsp/Mpsup@1(supervisor)。**订单落库 order_date=期次 order_start**（非提交当天）→按期次窗口查。pending=已提交、approved=已定稿；「审批预报单」已下线。报单提交即计入汇总。

## 返利目标判重（v125 铁律）
- **判重维度 = 覆盖月份集合，不是 period_type**。单期(month)与年度(year) 口径不同但覆盖同月 = 重复目标（会导致目标/达成/返利三处翻倍）。
- 实现：`server/domain/rebate_period.py::covered_months()`（只依赖标准库，**必须放 domain 层**，放路由模块会被 erp_db 迁移回填触发循环 import）；`detect_conflicts()` 按月份交集判重。
- DB 兜底：`rebate_rule_month_lock` + `UNIQUE(dimension,target_type,scope_key,ym)`，停用/删除即释放；`IntegrityError → 409`。
- `POST /api/rebate-rules/precheck` 供前端保存前提示（两入口共用）。
- ⚠️ `rebate_achievements` **不绑 rule_id**（按 period_month+dimension+scope_key）→ 停用/删除返利规则不影响达成填报；`rebate_tier_versions/calculations` 需先查引用数。
- ⚠️ 迁移代码里 `tdb` 无 row_factory → 禁止 `dict(row)`，按列下标取值。
- ⚠️ 前端 `api()` 自带 `JSON.stringify`，body 必须传对象（传字符串＝二次序列化 → 后端「规则必须是对象」）。

## 事故与凭据
- 2026-08-22 裸 rsync --delete 删 .env→服务挂；已重建（重生成 ERP_SECRET）并备份 `/root/.hergent-env/.env`。`/opt/hergent-erp/.env` 勿提交 git。
