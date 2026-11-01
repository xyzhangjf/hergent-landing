# Hergent 记忆索引（只放判据首句 + 去哪查；细节一律 `topics/*.md`）

> 前端构建号 **v713**，下一号 **v715**（`hergent-cn-v2/src/main.js:71`）。v714 无发版（数据审计 + 权限变更）。域索引 → `topics/route-index.md`，**动手前按域 grep**。
> 唯一开发源 = `main`（v705 `02a1b28` 合并完两线）；`line-a/v678`、`workbuddy/*` 不再开发 ⇒ 判「修过的 bug 又回来了」先 `git merge-base --is-ancestor <修复commit> HEAD`。
> 🔴 合并/解冲突三教训（`2026-10-31.md`）：冲突块**之外**也有假象（重复 `export`／重复对象键／整段模板被覆盖 ⇒ **构建不报错**）；合并后**必须** `npm test` + `npm run build`；同功能两份客户端 API 按**消费方**取舍。
> 🔴 「改了但用户说没变」第一步查构建号 `window.__HG_BUILD__`（`main.js` 唯一定义）+ `html[data-build]`；SPA 老标签页不重拉 index.html ⇒ 每版手改。判产物不以「dist 存在」为准：`grep -o "v70x" dist/assets/index-*.js`；`mv dist-vNNN dist` 会嵌套 ⇒ 闭包全 200 也能骗过（v637）。

## 路由（🔴=硬判据）
- **前端** → `topics/frontend-ui.md`（4700 行，改前端前必 grep）：入口与门禁唯一源 `pages.js`（未登记=放行，删登记=放宽门禁）｜`permView.js` 唯一源、`module:null`=只读｜文案三禁 ⇒ `hergent-ui-copy-guard`｜图表唯一源 `src/components/chart/`｜列表页冻结/密度/合计 `psi-list.css`｜侧栏系列只删菜单项。副驾快捷键 `⌘K`/`⌘⇧K` 已占用 ⇒ 新的用 `⌘⇧O`；外部触发「新建会话」用可消费计数器 `ui.copilotNewTick`+`takeNewTick()`（v649）。
- **后端** → `topics/backend-invariants.md`：路由遮蔽先注册者胜｜静默失效=恒空恒0 ⇒ `undefined-call-scan.py`｜门禁用接口模块非页面模块｜FastAPI 未声明 query 被静默忽略｜意图路由按序首匹配｜`execute_tool` 返回键是 `success`。
- 🔴🔴 **改角色权限必须走 API `POST /api/role-permissions`，不能直接写库**（否则绕过 `reload_perms` 缓存 + 不留 `audit_logs`）；🔴 **其合并语义是「未列出的模块 ⇒ 移除」** ⇒ 必须传**完整清单**，传 `["reports"]` 会把该角色原模块删光。🔴 `roles` 名单（前端 `pages.js`）与 `module` 轴是**两条独立的轴**：给前者≠给后者（v714：supervisor 报表 12 页可见但 `/api/reports/*` 全 403，判据查 `_PATH_MODULE_MAP`）。
- 🔴 **判库存只认 `inventory`**（`quantity`+`stock_value`）；`inventory_balance` 是**空表**（0 行，v714 实测）⇒ 按它判会得出「账面全 0」的假结论。库内流水当前 281 条 **100% 是 `change_type='opening'`**（10-29 期初盘点，`ref_type='v728_stock_snapshot'`）⇒ 判「有没有动过」不能只看流水存在。
- **部署** → `topics/deploy-ops.md`：后端 FLAT `/opt/hergent-erp/`（无 `server/` 前缀）｜前端 `/opt/hergent-cn-v2`｜服务 `hergent-erp.service`｜**rsync 绝不 `--delete`**（后端 `deploy.sh` 内联了它）｜🔴 `https://hergent.cn/` = ERP 前端，`/admin/` = 平台运营控制台（另一应用）⇒ 探针/部署一律用根路径（`/admin/assets/x.js` 永远 200 但返回 index.html，v636）。
- **预报主表** → `topics/forecast-order-domain.md`｜**成本/容量** → `topics/cost-and-capacity.md`｜**返利** → `topics/rebate-domain.md`｜**账务** → `topics/accounting-gl-v716-v717.md`｜**条码小程序** → `topics/miniprogram-and-brand-data.md`。

## 🔴 UI 判据（高频，全文 `topics/frontend-ui.md` 末 200 行）
- 🔴 **报「没有 X 按钮」先核 X 是否已存在**（v709：多是不可发现而非缺功能）⇒ 调用方包 `<label>`+`<span>`，**别改共享件**。
- 🔴🔴 **判对齐只能量文字渲染矩形** `Range.selectNodeContents().getBoundingClientRect()`，**盒子差 0 ≠ 对齐**（v710：盒子全 0 而文字差 0.5px）；`line-height` 跟邻居同用 `normal`，别抄数值别写 `1`。
- 🔴🔴 **自动扫描报「全 0」先过阳性对照**（v711：阈值 `<=0.5` 吃掉实测 0.500 ⇒ 改 `<0.4`）；阈值别取实测常见落点。
- 🔴 **图标+文字没居中 = 容器不是 flex**（v711：inline 里 svg 走 `vertical-align:middle` 偏高 1.3~2px ⇒ 抄 `.btn` 的 `inline-flex/center/gap 6`）；flex 里 `vertical-align` 无效 ⇒「改参数值纹丝不动」立刻换思路。
- 🔴 **判「同行同构」挑同类基准**（v712：`.btn`36 与 `.btn-sm`/`.tb-toggle`32 本就并存）；工具栏加控件先算总宽 ⇒ `flex-wrap:wrap`，**换行后 `margin-left:auto` 成孤岛** ⇒ 窄屏改 0。
- 🔴 **「默认隐藏某状态+开关」已有公共件**（v713：`useInactiveFilter`+`InactiveToggle`，7 页已接）⇒ 新页直接套；判据只认 `===0||===false`（**缺失字段当启用**，写 `!x` 会把整表藏光）；**服务端分页页不能改前端过滤**（用后端 total 验，DOM 行数恒等于 pageSize）；判「哪些页该做」看**库里的数据分布**不是代码候选数。
- 🔴 **探针纪律**：fetch 桩用 `addInitScript`（`eval` 会被 reload 清掉）+ 断言 `__stubHit>0`；每场景前 `Page.reload`（浮层吃掉下次点击）；`screenshot()` 返回值必须判空（`clip` 缺 `scale` 静默返回空串）；取列别写死 `td` 索引（列可配置）；滤掉 `/index.html?_v=` 版本轮询；数行数别数 `tbody tr`（虚拟滚动）也别读 `body.innerText`（headless 可能空串）⇒ 直接查接口。
- 🔴 **同行控件必须同构**（基准 `.tb-toggle`/`.btn-sm`：32 高/13 字/radius 8/`padding:0 12px`）；判据=顶边差 0、高度差 0。危险程度靠角标配色，不改按钮外形。
- 🔴 **「UI 不统一」先怀疑样式缺失**（v676：列设置面板 8 个类全站零定义，注释却写「全局已有」）⇒ `v676e-orphan-check.py` 机械核对；**注释说「已有」一律不认，grep 到定义才算**。
- 🔴🔴 **复选框禁止 `@click.prevent` + 单向 `:checked`**（v677 复发）：勾选态与真值永久相反 ⇒ `@change`+`nextTick`；🔴 验它**只能 CDP 真鼠标**（`el.click()` 无 pre-click activation ⇒ 必假 PASS）。护栏 `guard-checkbox-change.py`。
- 🔴 **看起来能点的必须真能点**：`role=button`+`tabindex=0`+`@click`+`@keydown.enter/space`+`cursor:pointer`+hover；图标尺寸只由 CSS 定，量法只认 `getBoundingClientRect`。
- 🔴 **「全选/清空」类裸控件要挂文字时在调用方包 label**（`SelectAllCheckbox.vue` 是全站唯一源，库存三单据/商品档案/调拨面板横向空间紧）。

## 🔴 免密码做生产 UI 真机验证（v707，最省事的正路）
生产后端**不是 git 仓**，改它要 `scp` 下来 → `.bak` → `install -o hergent -g hergent -m 644` → `systemctl restart`。登录态：主库 `sessions` join `users`(role='boss') 取 `token`，puppeteer `setCookie` 注入 `erp_token`(httpOnly)+`hergent_auth=1`+`csrf_token`(任意)+`hergent_tenant` ⇒ 以老板身份跑生产页。⚠️ `sessions` **没有 id 列**（用 `created_at`）、`users` **没有 tenant_id**。
- 🔴 **自己插 `sessions` 造临时登录态时，`created_at`/`expires_at`/`last_activity` 必须 `datetime('now','localtime')`**；写 `datetime('now')`（UTC）差 8 小时 ⇒ 直接 **401**，看起来像「token 无效/账号被停用」（v714 实踩）。用完 `delete from sessions where token like '<前缀>%'`。
- 🔴 **免密验证走 `Authorization: Bearer`** ⇒ CSRF 中间件整段豁免（`csrf_middleware` 见 Bearer 直接放行），无需伪造 `csrf_token`；但权限类端点还要 `X-Tenant-Id` 头（`_perms_tenant_or_400` fail-closed，缺了就 400，绝不回落主库）。

## 🔴 结构 / 实现 / 部署判据（原文已搬 → `topics/impl-and-deploy-criteria.md`）
- 🔴 **给表格加列先吃「名称列」宽度**，长文本列 `width+min-width` 同写｜**分页条在滚动容器外**，翻页后 `scrollTop=0`｜**加字段 4 处**（商品 v670 / `hr_employees` v707，且 `employee_create` 有第三份 `allowed` 白名单 ⇒ 先 `grep -c "allowed = \["`）｜`ui_col_prefs` 是**租户级**｜`visibleCols` 元素**没有 `type`**。
- 🔴 **构建** `--emptyOutDir false`（safe-delete 会拦 `rm -rf`，报失败先排它）｜**页面文件名 ≠ 产物 chunk 名**（v706）且每次 build 全部 hash 都变 ⇒ 必须走**闭包补传**｜CSS 改完要量 `getComputedStyle`（v708「规则在产物里 + matches=true + 不生效」成立）｜跨组件覆盖必须写在**目标组件自己文件**（`@media` 不提高特异性）。
- 🔴 **部署必检**：`deploy-frontend-closure.py --push`（最后才传 index.html）+ **curl+`cmp` 逐字节**判产物（脚本报「补传 111」不可信）。
- 🔴 **数字单位跟口径走**（返利 quantity 时全是件数）｜**行显隐两份实现**（查看态 `rowVisible` / 编辑态 `rowBaseShown`）｜备份巡检脚本 `check_backup_alive.py` **别删**。
- 细目全文 → `topics/impl-and-deploy-criteria.md`（v587–v713 原文）、`topics/frontend-ui.md`、`topics/deploy-ops.md`。

## 🔴 副驾 / 租户 / 内存（全文 `topics/copilot-tenant-memory.md`）
- 🔴 租户边界 = 进程用哪个系统账号（v635）：`gateway_api(tid)` 读该租户 `config.yaml` 的 `platforms.api_server.extra`（端口 `18800+tid`）；解析不到 ⇒ **必须 503，绝不回落根实例**。平台租户 1 = 根实例别名（v642）：凭证/state 走 `_host_home`、PID 走 `_systemd_main_pid`；`_identity_kwargs` 必须 `return []`（v646）。
- 🔴🔴 同一企微 bot 只能一个 websocket 订阅：双连报 `846609` ⇒ 不回消息 + 100% CPU 重连死循环；卡住要 `kill -9` 连 `sudo -u` 包装一起杀。进程外推送必踢长连接（v648，2.2s 自愈）；`hermes send` **必须 `stdin=DEVNULL`**（v647）。`/root/.hermes/gateway_state.json` 会被临时 `hermes send` 写脏（v666）⇒ 判通道还要看 pid 是否 `hermes gateway run`。
- 🔴 **企微「三点动画两个版本上下跳」= 我们补丁的字符动画 × 企微客户端对流式的原生动效叠加**（v715）。`tools/hermes_wecom_ack_patch.py` 现为 **v6**：占位 `\u200b`（不可见）+ 帧序列空（只 60s 保活重推）⇒ 位置全让给原生。🔴 **适配器在 `/usr/local/lib/hermes-agent/...`（进程跑这份），`/opt/hermes-agent` 是死副本**；补丁打发行版文件，**Hermes 升级即被覆盖**（现象=又变回「等半天没反应」）⇒ 升级后必跑 `--check`。🔴 `_send_reply_request()` **只在网络层抛异常，服务端拒绝是正常返回带 errcode** ⇒ 必须查 errcode，否则「发了但没显示」且日志全静；收口失败要退回普通发送，**绝不静默吞答案**。
- 🔴 判后端内存看 `ps -o rss -p $(systemctl show -p MainPID --value hergent-erp)`，不看 `memory.current`；顶穿 `MemoryHigh` = D 状态锁死。成本 = 入口数 × 常驻进程 ⇒ 接客户就新开一台；闲置租户停不掉；镜像开客户必须先脱敏。
- 🔴 气泡时间只认 `m.created_at`；「打开副驾显示最后一次」= `latestSessionOfRole() || latestSessionOverall()`（v637）；副驾读表 = `spreadsheet_query._run_query`（v638）｜改完 `hermes_tenants.py` 必须重启后端再做「杀掉观察 60s」。

## 进度 / 交付锚
P0/P1 全交付；剩余促销ROI(端点坏死500)/货架位(零数据)/现金流预测页面化。**卖前三关未过；调拨单生产仍 0 张**。BI 指标唯一源 `erp_db.py:_BI_MEASURES`（口径必须 `soi.amount`）；库存周转唯一源 `get_inventory_turnover`。
v714：主管 `reports` 权限已授（4 个 supervisor 账号，12 张报表页）；商品档案 104 条停用 = **88 条纯遗留（保持停用，不物理删）+ 16 条赠品物料仍压 7,544 件/12,726 元库存**（占库存额 8.1%）⇒ 待老板选「恢复启用」或「报废清零」。全文 `docs/v714-停用商品审计与主管报表权限-2026-11-01.md`。
起号必读 `version-history.md` + 实搜两仓 `git log --all`；前端 `roles` 窄名单非真保险 ⇒ 敏感页必须后端 `_admin` 双保险(v531)。

## 主体 / 脱敏 / 技能 / 本机坑
主体 hergent-cn-v2(`laozhangai-product`)｜hergent-erp(FastAPI+SQLite)。脱敏红线：返利率/进货价/客户名/区域销量/厂家政策；PII 不落 `outputs/`。技能 7 个在 `.workbuddy/skills/`。本机坑 → `topics/local-machine-pitfalls.md`（🔴 `grep "A\|B"` 静默失效 ⇒ 一律 `-e`；`&&` 短路；`| head -N` 截命中；`grep -rl` 只搜顶层；ssh 嵌 python 引号 ⇒ 写远端脚本；`pkill -f x` 会杀掉执行它的 shell）。
- 🔴 **`git commit -m "…含 `{}` 或反引号…"` 在 zsh 里 parse error ⇒ 提交静默失败**，随后 `git push` 报 `Everything up-to-date`（v708 实踩）⇒ 提交一律 `git commit -F- <<'EOF'`。
