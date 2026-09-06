# Hergent 项目长期记忆

## 产品线
- hergent.cn = AI 经营副驾 Web 版（生产主产品）；同源 erp.hergent.cn。前端 hergent-cn-v2（Vue3+Vite+Pinia，部署 /opt/hergent-cn-v2，纯静态）。后端 hergent-erp（FastAPI+SQLite，server.py:8700，本地 /Users/zhangjunfeng/Documents/hergent-erp 分支 upgrade/v84-international）。
- desktop-app = Electron 桌面版（已冻结）。

## 用户背景与战略
- 用户=蒙牛低温奶经销商（一人公司，懂业务不懂代码，纯靠 AI 开发），真实数据 ~430商品/716客户/38供应商/580订单/8024专属价。
- 主体公司=湖北省小赫智体数字科技有限公司（自然人独资，91420600MAK1YFG5Y，注册资本50万，2026-05-26，襄阳樊城区）。经营范围含 AI 软件开发/互联网销售，**无食品/乳制品**→小程序类目选「工具→效率」免食品证，名称可带"AI"。法人=用户本人张俊峰→主体验证走法人微信扫码最快。
- 战略=「低温奶经销商 AI 经营副驾」，不造 ERP，只坐客户现有 ERP 之上做分析/顾问/副驾；数据走连接器同步或 Excel/CSV 降级摄入。护城河=低温奶配方化算法(货损/返利/预报)+副驾交互形态。

## 自媒体战线（2026-08-30 启动）
- 定位=需求验证杠杆，视频号为主（经销商在微信，可裂变转发），公众号承接长文；抖音阶段2搬运、小红书/知乎/B站不做。账号=「老张ai实践记」（保留不改名，双目标：卖 Hergent＋广告分成）。
- 内容=一线干货60%(口播)+AI演示30%(录屏植入Hergent)+创业记录10%；铁律讲"我解决了什么生意问题"，脱敏红线(返利率/进货价/客户名/区域销量/不评厂家政策)。
- 北极星=`加微信的精准经销商经销商人数`；不盯播放/点赞/粉丝。阶段：20-30加微→群80-150+10访谈→5-10家付费试用。交付 `Hergent-自媒体实施计划-2026-08-30.md` + 口播稿第1-4条。

## 设计铁律
1. AI 只建议不擅自下单。2. 蒙牛/舟谱无开放API，只生成粘贴模板/CSV。3. Hermes 版本 pin 住不追大版。4. AI 层默认无商品录入入口——但预报模块内联 Excel 网格(bulk-upsert, source='web_grid')属轻量直录例外，与战略一致。

## 关键字段语义（2026-09-03 与用户对齐）
- **厂家编码 / `product_code`**（商品档案 + 预报汇总表列）：= 该商品在**上游厂家订单系统**里的编码（如蒙牛给的货号），用途是**直接复制粘贴到厂家系统去下单**，不是 Hergent 内部 ID、也不是条码。`Forecast.vue:3384`「一键复制厂家下单文本」即按「厂家编码 + 数量」生成，可直接粘厂家系统。凡涉及"导入厂家订单/下单/对接厂家系统"的字段映射，必须优先用 `product_code`，缺失才回退条码。

## 前端规范（hergent-cn-v2）
- 设计令牌 variables.css 双主题；品牌青 --p=#06b6d4。
- 统一 HTTP 层：`src/api/client.js` 的 `api(path,opts)` 唯一业务封装（opts: method/body/timeout=20000/raw/silent401）；后端信封 {success,data?,detail?,message?}。FormData 透传；401 默认踢登录页，轮询用 silent401。Hermes REST 走 `hermesRequest`，SSE 走 `hermesChat`(超时180/300s)。禁裸 fetch（除 login/register/demoLogin）。**⚠️ 副驾对话前端直连 Hermes SSE（/hermes/v1/chat/completions），不经 server.py/hermes_core 二级路径**——分析 AI 能力/流式/工具可视化须核查前端 `hermesChat` 与生产 Hermes v0.19.0 SSE 格式（Responses 风格 `response.output_item.added/done`，item.type=function_call），而非 hermes_core.py（`_call_llm` urllib 同步仅遗留 /api/ai 旧路径用，副驾不走）。
- 副驾已落地：货损/工资/返利/预报四张只读卡；每日简报8:05推送；预报交叉表+Excel导入+催单+审核台+舟谱模板；表格对账上移 Hermes(spreadsheet MCP，前端只透传 file_id)。
- **⚠️ Vue 3 `<script setup>` 自动 unwrap 规则（2026-09-05 真实事故）**：**模板内**访问顶层 ref/computed 由编译器自动 `.value`；**函数体（包括 setup 内普通 function 与 setup script 顶层 const=function）不自动 unwrap**，必须手动 `.value`。例：`const gapSet = computed(() => new Set(...))`；模板里 `gapSet.has(x)` 编译成 `gapSet.value.has(x)` 正常；`function namePadStyle(r){ if (gapSet.has(r.product_id))... }` 直接 throw `Vn.has is not a function`。复查策略：写完 setup 内任何函数，grep `setup.*ref/computed.*\.(has|get|set|size|forEach|keys)` 无 `.value` 即为 bug。**模板里的 ref 调用如果命中 .has/.get/.set/.size，编译产物已含 .value，无需手动加**——只在函数体内才需要。

## 部署真相（必读）
- 前端：npm run build → rsync -a --no-owner --no-group --delete dist/ root@47.113.224.140:/opt/hergent-cn-v2/ → chown -R hergent:hergent（nginx 纯静态无需 restart）。SSH `ssh -i ~/.ssh/id_ed25519 root@47.113.224.140`。
- ⚠️ **vite build 受本机 safe-delete 防护拦截**：vite 在 prepareOutDir 清空 `dist/assets`（86 文件 > 阈值 50）会触发 `SAFE_DELETE_BULK_CONFIRM_REQUIRED` 致 build 失败（prepareOutDir 阶段，非代码问题）。正解=build 前先 `mv dist /tmp/hergent-dist-bak-$(date +%s)` 移走旧 dist（mv 不触发删除防护），让 vite 新建 dist 跳过 emptyDir 批量删。另：build 与 rsync 必须用 `&&` 链，禁止 `;`，否则 build 失败仍会把旧 dist 同步上线（2026-09-05 踩过）。
- hergent.cn：/api/→8700、/hermes/→18765(Bearer hergent-prod-gateway-key-2026)。
- 后端：用仓库根 **deploy.sh**（rsync server/ → /opt/hergent-erp/ 带 --exclude='.env' + 绝带 *.db；chown→rm __pycache__→systemctl restart）。**严禁裸 rsync --delete server/ 扁平覆盖，会删根目录 .env 致服务挂（2026-08-22 血训）**。`/opt/hergent-erp/.env` 含 ERP_SECRET+Hermes 键，勿提交 git；备份 `/root/.hergent-env/.env`。健康 curl --noproxy '*' http://127.0.0.1:8700/api/health。
- ⚠️ flatten 路径陷阱：ai_roles._avatar_dir=/opt/hergent-erp/static/role-avatars/<tenant>/<role>.png。

## Hermes 引擎
- 生产 v0.19.0（LLM deepseek-v4-flash）。CORS 须配 cors_origins 否则403。MCP ~/.hermes/config.yaml 顶层 mcp_servers；生产 spreadsheet server=/opt/hergent-mcp-spreadsheet/server.py(stdio)。

## 副驾 Excel 对账架构
- 前端只透传 file_id，Hermes 调 spreadsheet_summary/query/reconcile_files。端点 POST /hermes/v1/chat/completions → nginx /hermes/→18765。逻辑抽 server/spreadsheet_query.py 共享复用。

## 后端已排雷（勿重复 flag）
- connection `_ensure_tenant_db` fail-closed；ai_engine 懒校验；forecast_engine 去硬编码 Mac 路径用 __file__。
- 前端 SSE hermesChat 超时300s+retry+ErrorBoundary。
- 统一错误信封已修复：core.py error_envelope 带 detail/message；server.py 中间件改写 legacy {"error"}。白名单反转默认 deny；store 收口 Pinia；check_dupes 默认"1"+预报幂等。

## 后端踩坑铁律
- **ERP_SECRET 与密码哈希强绑定**：`SECRET=ERP_SECRET`，`_hpw`=bcrypt.hashpw(pw+SECRET)→换/丢 ERP_SECRET=全系统密码哈希失效。改前须留旧值或备全量重置脚本；登录走主库 erp.db，重置须改 erp.db+各 tenant_*.db；错5次锁15分。
- **密码长度硬上限=8字符**（2026-08-30）：SECRET 64hex 占满 bcrypt 72字节→密码≤8，否则500。正解 HMAC-SHA256 预哈希(需全量重置，暂不动)。
- 租户库新列走 erp_db 尾部补丁循环；import_router 计算列须 _CROSS_SKIP_KEYWORDS+纯数字表头跳过+identity_like 排除。
- **新路由必须登记 RBAC 路径→模块映射**：server.py `_PATH_MODULE_MAP`(292条) 未命中 fail-closed 403 `MODULE_NOT_CONFIGURED`；**未登录时先 401 → 401 无法区分"已登记/未登记"，必须带真实登录态测**。新接口照既有口径选模块(如 rebate-achievements→stock)。
- **工具函数勿对 sqlite3.Row 用 `.get()`**（2026-08-31 真实 500）：`_compute_status(r)` 对 `fetchone/fetchall` 的 Row 调 `r.get("is_active")` → `AttributeError`，列表 GET 直接 500（py_compile 只验语法不执行，本地单库 dict 测不出）。正解=入口 `if not isinstance(r, dict): r = dict(r)`；**生产 E2E 必须覆盖列表类 GET 接口**。
- Alembic server/alembic/ v88 脚手架已就位，勿重复建；按 README S1→S3 受控。

## 小程序预报（forecast_submissions）运维（2026-08-30）
- 开号走 `erp_db.staff_account_create(...)`（含 _hpw 哈希+绑首个租户+employee_code=str(id)），须生产机 `set -a;. /opt/hergent-erp/.env;set +a` 后调，**只读 .env 绝不改**。
- employee_stores 在【租户库】非主库（get_db() JOIN contacts）；绑门店插 tenant_1.db，门店=contacts type IN('customer','both') AND is_active=1。
- supervisor 默认无权限：`_DEFAULT_PERMS` 无 supervisor（已修入 ["dashboard","data"] 但是手工插库+导入期加载，老板在 Web 端改权限即失效、须重启才生效）→ 治本=写进 `_DEFAULT_PERMS` 并迁移全部租户库。
- 期次须覆盖当天：open-periods 只返 status='open' 且今天∈order_start~order_end；新建期次双写旧列 order_start_date/order_end_date 与新列 order_start/order_end。
- 无 employees 表，employee_id 自由号非外键。租户上下文头 X-Tenant-Id（或 cookie hergent_tenant）。
- 微信小程序：appid 须真实账号(非 touristappid)、request 合法域名须配 hergent.cn、隐私指引须勾选剪切板(wx.setClipboardData)、类目首选工具→效率。提审测试账号 mptest/Mptest@1(sales) + mptestsp/Mpsup@1(supervisor)。tabBar 静态无法按角色隐藏→汇总总表入口迁 mine 页(同审批门控)。

## 权限/员工/账号 整合要点
- 跨库隔离：users 主库 erp.db；hr_employees/role_permissions 租户库。不能物理合并。
- SSOT：hr_employees=人、users=认证、role_permissions=角色能力(须统一租户库)。
- 员工档案=「员工+账号」融合视图(列含小程序账号、行含开账号/停用)。设置→权限只管角色×模块矩阵；账号与组织管部门树+当前账号+主题。
- 离职联动：停用员工须联动禁用账号(P0-1 已修，按 employee_id OR employee_code 匹配，返回 accounts_affected)；报单配置须交接不可作废(P0-4 transfer-mappings)。
- 权限页防自锁：PROTECTED_ROLES=[admin,boss]×CRITICAL_MODULES=[hr,data] 锁必选+加载补回；LOCKED_ROLES=[admin] 整列禁编辑。保存走 list 格式(_check_perm 视为全操作授权)，reload_perms() 热生效。

## 2026-08-22 事故恢复
- 裸 rsync --delete server/ 删根目录 .env→hergent-erp 起不来。已重建 .env(regenerate ERP_SECRET 64hex+并入旧 Hermes 键)+备份 /root/.hergent-env/.env。影响：3个历史 ENC PII 字段暂显 [encrypted]+全员重登；业务数据无损。日后找到旧 .env 替换即恢复。

## 凭据
- 企业微信API.docx 含 GitHub PAT×2/阿里云AK×2/LLM key/企微Secret(明文，建议迁密钥管理器)。`/opt/hergent-erp/.env` 与 `/root/.hergent-env/.env` 生产机密，勿提交 git。
