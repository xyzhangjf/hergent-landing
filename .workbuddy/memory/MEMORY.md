# Hergent 记忆索引（只放**判据** + 去哪查；详情全在 `topics/*.md`）

主体：前端 `hergent-cn-v2`（Vue3.5 SFC/Vite，仓库 `laozhangai-product`）｜后端 `hergent-erp`（FastAPI + SQLite 多租户）。
线上：后端 `/opt/hergent-erp`（**扁平**，`routers/` 无 `server/` 前缀，**不在 git**）｜前端平铺 `/opt/hergent-cn-v2`（**无 dist 子目录**）｜`root@47.113.224.140`。

## 路由：动手前按域 grep（🔴=硬判据）

- **前端**→`topics/frontend-ui.md`：入口唯一源 `pages.js`（未登记=失门禁）｜`permView.js` 唯一源、`module:null`=只读｜文案三禁⇒`hergent-ui-copy-guard`｜图表唯一源 `src/components/chart/`｜列表页冻结/密度/合计 `psi-list.css`。
- **后端**→`topics/backend-invariants.md`：路由遮蔽先注册者胜｜静默失效=恒空恒 0｜门禁用接口模块非页面模块｜FastAPI 未声明 query 被静默忽略｜意图路由按序首匹配｜`execute_tool` 返回键 `success`。🔴 **Starlette 1.0.0 的 `Request.body` 是 async 方法**（无 `.read()`）→ 同步 `def` 端点写 `request.body.read()` 必 500（`AttributeError: 'function' object has no attribute 'read'`）；读 JSON body 用 `await request.json()` 或共享 `http_json.json_body()`，新增读取方式先 grep `body.read()`。🔴 **`erp_db.py` 的 CREATE TABLE 模板曾与真实租户库 schema 漂移**（consignment/subcontract v88 写了"想象列"、缺 subcontract 建表）→ 已 p14h 对齐真实 schema；**改任何建表/查询前以 `tenant_1.db` 真实 schema 为准**，模板漂移是 v88 反复踩坑根源。
- **部署**→`topics/deploy-ops.md`；**预报主表**→`topics/forecast-order-domain.md`；**返利**→`topics/rebate-domain.md`；**进销存**→`topics/inventory-psi.md`；**货损/效期**→`topics/expiry-loss-domain.md`；**对账**→`topics/reconciliation-redo.md`；**副驾**→`topics/ai-copilot.md`；**本机坑**→`topics/local-machine-pitfalls.md`；**并行会话**→`topics/parallel-dev-protocol.md`。
- 🔴 **v629 静默失效家族（5 例真缺陷 + 检查器）→`topics/v629-silent-failure-family.md`**（改前端前必读）。

## 🔴 最高频硬判据（一句话版）

- **prop 到子组件已被解包** ⇒ `props.row.value` / `props.cross.value` / `props.open.value` 恒 undefined。直接写 `props.row`。
- **模板裸标识符必须在 `defineProps`/setup 声明**，否则落 `$attrs`、静默 undefined（v629：`open` 未声明⇒弹窗永不渲染）。
- **`api()` 只解一层**（`client.js` 已 `return data.data ?? data`）⇒ 调用方再写 `(d && d.data)` 恒空。仅 `{ raw: true }` 的方法（舟谱 `sourceStatus/status`）才取 `.data`。
- **带兜底的 `.data` 不致病**：`Array.isArray(r)?r:(r.items||r.data||[])` 是防御链，别判红。
- **scopeId 由文件内容派生** ⇒ 动过任何 SFC 必须重构建重部署。
- 🔴 **「模式开关」的判据只能用 *setup 快照*，绝不能用会被 preview 覆盖的那份 flags**（v658b 生产实证，用户原话「只勾选了一家门店，弹窗即关闭」）：`AllocPanel` 的勾选模式原判据是 `allocFlags.no_members`，而 `allocFlags` 每轮预演都被 `dd.flags` 覆盖，后端 `extra_alloc_preview` 的 flags 是 `({} if base_mem else {"no_members": True})` ⇒ **勾第一家后 base_mem 非空 ⇒ 返回里没有 no_members ⇒ 判据翻假 ⇒ 整块名册消失、只剩勾中那行，且再也勾不到第二家**。凡「后端每轮都会重算并回传的状态」都不能当 UI 模式开关；开关只认 `setup` 里那个一次性的 `can_pick`（或同样不可变的快照字段）。同族：勾选模式下 `_ratioPayload()` 若把**未勾的行也发上去**（ratio=0），override 是整组替换 ⇒ 落 13 行 ⇒ 下次 `can_pick` 恒假 ⇒ **该商品永远回不到名册**（用户无从自查，界面只显示 13 行 0%）。
- 🔴 **给唯一键「换维/加列」时：租户库必须 补列 → **回填** → 建索引，三步缺一都是静默失效**（v658 生产实证）：① 租户索引 pass 排在列对账之前 ⇒ `no such column`；② `ALTER ADD COLUMN` 只给列不给值 ⇒ 多行空串在新唯一键上**互撞**，`CREATE UNIQUE INDEX` 失败；③ `_create_indexes_on` 是 `except: pass`，**日志一个字都没有**，看着部署成功。验收只能靠 `PRAGMA index_list` 逐库复核，不能看"服务起来了"。
- **多根组件（Fragment）静默丢父级 `class`** ⇒ 写「按 class 选子组件根」的 CSS 前，先真机读 `el.className`。
- **`v-html` 注入的 DOM 没有 scoped 属性** ⇒ `.md p{}` 是死代码，要 `.md :deep(p)`。
- **`v-if` 挂载的面板销毁会带走 `scrollTop`** ⇒ 重开要还原。
- 🔴 **拆行/拆卡组件后仍全表重渲染 ⇒ 先查行内 helper 有没有摸全表聚合**（`rowSumOf`/`rowSumArr`/`cellIssueIndex`/`dupBarcodeAt`），别先怀疑 computed/事件/样式。定位唯一有效手法：hook `Dep.prototype.notify`，按 `this.subs` 订阅数 ≈ 行数 找那个 computed，再读 `this.computed.fn` 源码定名。`onRenderTriggered` 的 `type/key/target` 与 `flags & 16` 都不可信（会带偏）。
- **flex 行里可能超长的文本必须 `min-width:0`**（判据=量 `scrollWidth-clientWidth`）。
- **Modal 必须用 `--z-page-modal-overlay/-modal`（1125/1130）**，写 1000/1001 会被工具栏 `.tb-pop`(1120) 盖住。
- 🔴 **「数字没回填」先分清「算错」还是「没量可算」，别直接怀疑回填代码**（v660 实证）。回填型反馈（分摊/同步/带出）必须先确认**输入量本身非 0**：`0 × 任何占比 = 0`，回填 0 与「什么都没做」在界面上完全同构；而按钮文案往往写着「并回填」—— 用户看到的就是承诺落空。取证顺序：① 查落库表反推他当时的输入（`forecast_alloc_ratio` 有 N 行且均分 ⇒ 他确实设了占比；`forecast_extra_alloc`/`forecast_extra_qty` 空 ⇒ 总量=0）；② 真机三路径各跑一遍（先填量再操作 / 面板内改量 / 换模式）证回填本身。修法不是改回填，而是**让"没量可算"这件事不可能悄悄发生**：总量 0 时点保存不关窗、warn、光标送回总量框。
- **改"恒空 getter"前先 grep 布尔/三元用法**（`auth.token` 改恒空曾让 IdleTimeout 静默失效=安全倒退）。
- **任何 Modal/浮层**：`Teleport + fixed + z-index 1250`；有自定义浮层就删触发器 `title`。

## 🔴 后端写库 / 建表（v665 实读，极易静默不落盘）

- 🔴 **`db.get_db()` 不 commit**（`finally` 只 rollback）⇒ 写库必须用 **`db.get_db_tx()`**（clean exit 才 commit）。用 `get_db()` 写数据会让「接口返回 200、库里 0 行」——最坏那类静默失效。
- 🔴 `conn.executescript()` 会**隐式 commit** 之前的写 ⇒ 建表语句要放在事务块**第一条**，否则会把前序半笔写提前提交。
- 🔴 新增表要**两处同写 DDL**：`erp_db.init_db()` 的 `_safe_migrate_script`（新库）+ 使用侧 lazy `CREATE TABLE IF NOT EXISTS`（**已存在**的租户库），且两份 DDL 逐字一致。只写迁移会让老租户库在低频路径上 `no such table`，很久才被发现。

## 🔴 数字的单位跟着口径走

返利 `target_type=amount|quantity`；quantity 时目标/达成/缺口/均单全是**件数**，模板写死 `¥` 就是把量读成额。跨口径**不能相加**（mixed 时不给金额）。**改任何显示数字处先问：这个数什么单位。**

## 🔴 部署 / 构建

- 构建：`node ./node_modules/vite/bin/vite.js build --emptyOutDir false`（PATH 无 `.bin`；`emptyDir` 会被 safe-delete 拦）。副作用=旧 chunk 留在 dist ⇒ 查符号必须 grep **新** chunk 名。
- 发布：`rsync -av --no-owner --no-group dist/assets/ root@…:/opt/hergent-cn-v2/assets/`（**绝不带 `--delete`**，线上有 2.6 万历史文件）→ favicon/legal → **最后** scp `index.html` → 双侧 md5。macOS rsync 不支持 `--chown`，传完单独 chown。
- 🔴 **只传改动 chunk 会白屏**：新 entry 引用的闭包可能线上全无 ⇒ 传**整个** `dist/assets/`。
- 🔴 **「改了但用户说没变」第一步查构建号** `window.__HG_BUILD__` + `html[data-build]`（每次发版手动改）；SPA 老标签页永不重拉 index.html。
- 🔴 **生产热修不进 git ⇒ 下次整包同步必回退**：cn-v2 是整份 `rsync dist/assets/` 发布，只存在于线上产物、没进源码的改动一定会被覆盖（v663 副驾「新对话」按钮就这样回退过，只在 2026-10-21 的 `Shell-BLfJ9bAV.js` 里）。**「以前修过现在又坏了」的处理法：去 `/opt/hergent-cn-v2/assets/*.js` 数各历史产物里关键字出现次数（`grep -o … | wc -l` + `ls -t`），次数多的那版就是修好的版本，从产物里逐项复刻，别从零重新设计；修完必须进 git 并加源码级契约护栏。**
- 🔴 **站点归属**：`hergent.cn`/`www` → `root /opt/hergent-cn-v2`（cn-v2，预报/副驾全在这）；`erp.hergent.cn` → `root /opt/static`（旧 hergent-admin，`main-*.js`）。**发版核验只认 hergent.cn，打 erp 会看到"没生效"的假象。**
- 样式常落在**懒加载 chunk** 的 css（`Forecast-*.css`），别只 grep `index-*.css`。

## 🔴 测试基线

- 入口：后端 `tests/run_all_tests.py`（AST 分类两代测试 + 自带 `.env` 注入）｜前端 `tests/run-all.mjs`（万元往返 + 153 SFC 符号 + **跨组件/漏 import/双重解包** + 返利 HTTP 契约 + **⑤ 副驾「新对话」入口契约**）。
- 🔴 **「有测试文件」≠「有测试」**：17/23 后端文件是脚本式（顶层 `sys.exit`）混在 pytest 里 ⇒ 收集 `INTERNALERROR`、零覆盖却看着健全。
- 🔴 **基线转绿前先自证判别力**：注回已知缺陷看能否抓红。假阴性比假红危险得多。
- 🔴 正则前导要**零宽断言** `(?<![\w.$'"])`；消费前导字符会让嵌套调用整层漏检。
- 🔴 扫模板别扫全文（HTML 注释/CSS `var()`/SVG `rotate()`/正文说明文字全是噪声）。**扫模板片段的断言要先剥 HTML 注释**（`.replace(/<!--[\s\S]*?-->/g,'')`）—— 否则你自己写的说明注释会被当成代码，v664 当场误报过。
- 已知缺陷白名单 `KNOWN_ISSUES`：**打印但不阻断 CI**，修完销账。
- 🔴 **后端无 CI、回滚只靠手工 `.bak-*`**（生产后端不在 git）。

## 会话凭证（v628：httpOnly Cookie）

`erp_token`（httpOnly/Secure/lax，JS 读不到）+ `hergent_auth=1`（非 httpOnly，前端判登录态）+ `csrf_token`（前端读来回传 `X-CSRF-Token`）。
🔴 cookie 模式下 state-changing 必须带 CSRF，否则 **403 CSRF_REQUIRED**（不是 401）。**永远别删 Bearer 分支**（小程序/桌面端/bot 在用）。

## 探针纪律

- 🔴 登录只能走**真实登录流程**（点「先看看演示效果」让后端 Set-Cookie）；localStorage 塞 token **已不通**，httpOnly 也无法用 JS 注入。
- 🔴 **要造临时登录态就只能插主库 `erp.db` 的 `sessions`**：`_resolve_auth` 走 `_master_db()` = `db.DB_PATH` = `/opt/hergent-erp/erp.db`，**不是 `tenant_1.db`**（往租户库插完再 curl `/api/auth/me` 必 401，v664 白查过一轮）。`INSERT sessions(token,user_id=2(boss),expires_at,last_activity)`，**测完必须 DELETE**，并在主库+租户库都确认为 0。
- 🔴 第一个动作 `freshChat()`（副驾会自动恢复上次对话，污染基线）。
- 🔴 识别卡片靠 DOM 事实（`.rc` 存在 + `.msg` 的 `m.role`），**不许靠文案**。
- 🔴 数据不具备时 **SKIP 退出 0**，不要判红（演示租户 `readonly=1` 拦写接口是环境约束，不是缺陷）。
- 🔴 **HTTP 探针读响应头必须全小写**：uvicorn 发出的是 `x-template-batch` 这种小写名，`dict(res.headers)` 后拿 `X-Template-Batch` 取恒 None（v665 差点判成「头没发」）。**前缀和后缀都要 lower**。
- 🔴 **`Content-Disposition` 里的中文是 percent-encoded**（RFC 5987 filename*）⇒ 不 `unquote` 永远匹配不到「第1批」。
- 🔴 **toast 是瞬时的**（短文案 3~6s 自关）⇒ 单点 `innerText` 采样会随机读空。判「有没有提示」必须**页面内 150ms 持续采样**存 `window.__toastLog` 再读全量。
- 🔴 **`toast()` 的 `sticky` 判据是 `text.length >= 60`**，可用第三参 `{sticky:true}` 强制。`zhoupuGen` 是唯一「先 toast 已下载、紧接着 toast 提示」的地方（v362 改 toast 栈就是为了它）。

## 本机坑（详见 `topics/local-machine-pitfalls.md`）

`grep "A\|B"` 静默失效⇒用 `-e`；`&&` 前段无匹配会短路；`| head -N` 会截掉决定性命中；`grep -rl X *.py` 只搜顶层。**「搜不到」先排除「搜错了/被截断」。** 探针脚本别放 `/tmp`；ssh 嵌 python 引号易乱⇒传远端脚本。

## 进度锚 / 约定

P0 7/7、P1 6/6 已交付。**卖前三关未过；调拨单生产仍 0 张**。BI 唯一源 `erp_db.py:_BI_MEASURES`（口径 `soi.amount`）；库存周转唯一源 `get_inventory_turnover`。
脱敏红线：返利率/进货价/客户名/区域销量/厂家政策；PII 不落 `outputs/`。
技能：`hergent-pre-launch-audit`｜`hergent-scoped-commit`｜`parallel-session-safety`｜`rebate-caliber-consistency`｜`chart-render-verify`｜`ui-copy-guard`。
**编号已用到 v659（v659 名册态可**手动进入**：有报单的商品也能把加单分给没报单的门店 —— `allocPickForced` + `enterPickMode()` 预勾现有承接人；名册态末尾补上「不在名册里的原有承接人」（无报单别名者，只渲染 candidates 会真吃掉他们的份额）；「平均分配」在名册态只均摊已勾选；报量 0 标「未报单」）→v660(用户报「分摊数量没有回填」⇒ 真机三路径实测**回填代码没坏**（先填后分摊 / 弹窗内改总量 / 名册态勾选，应用后格子均正确）；根因是**总量 = 0**：0×占比=0，回填 0 与点之前毫无差别，而按钮写着「保存本期占比**并回填**」；修=总量 0 时点保存**不关窗**+warn+光标送回总量框、进窗自动聚焦、顶部黄条、按钮文案切「只保存占比（未填数量）」；另修两真缺陷：`loadAllocSetup` 的 `if(cur)` 会无条件覆盖用户刚填的加单量（期次存过一次后必犯，回填的是旧值）、名册态改「还没勾」的门店加单量被静默丢；`tests/perf/v660/verify-zero-total.mjs` 12 项全 PASS)，→v661(分摊改**显示层叠加**：行挂 `allocByStore`/`allocTaken`，门店格 = 报量+分摊，**绝不写进 `qtyByUnit`**（会滚雪球不可逆）；`rowFinalQty` 有分摊时须 `rowExtraQty=0`，否则 22 箱显示 32)→v662(补货建议口径重做：coverage 只按到货间隔 2 天、safety 只作下限、按件显示；`suggested` 是**小单位**、旧前端写死「件」⇒ 放大 spec 倍)→v663(「新对话」回标题栏常驻，根因=生产热修未进 git + 整包同步覆盖)→v664(删掉历史面板里重复的 `＋ 新对话`，契约测试反向钉住防回潮；**断言扫模板先剥 HTML 注释**)→v665(舟谱模板**源单据号唯一性/分批**：`forecast_doc_seq` 水位（主键含 arrival_date）+ `forecast_template_exports` 台账；**号段只增不减**（作废不回收）、**内容指纹幂等**（同内容不吃号）、两位数用尽**硬拒绝 409**；`zt_seq_start` 语义改「本期**第一批**起点」、默认 21→1)→v666(点改单卡顿真因=**入口一次性建 8252 个 input**（不是打字路径，flush 仍 11.5ms）；首屏 24 行分批挂载 → 首帧 864→388ms、长任务峰值 936→223ms。🔴 `content-visibility` 对 table `tr` **无效**（A/B ±1~4%）；分批**不能用 requestIdleCallback**（会在首帧前连跑完，必须双 rAF）；`editMode=true` 与 rows 换新不同步 ⇒ 载入中必须返回 `[]`；按行号定位 DOM 的入口必须 `ensureRowsRendered`（否则静默无反应）)，下一号 v667。** 报表增强系列 v647(收编旧页)→v648(六图)→v649(徽标动态+客户筛选+删死组件)→v650(业务员筛选+徽标配色琥珀)→v651(采购/调拨/费用/收入/应收汇总接日期筛选；ar-summary 后端补 due_date 过滤)→v652(预报改单打字 124ms→0.1ms：numInput 150ms 防抖+失焦兜底+rAF 滚动+行高前缀和二分)→v652b(`ui_col_prefs` 白名单补全 26 页 + `col_pref_pages()` 如实回 28 个 + 前端 400 升 error)。→v653(商品主档缓存 TTL60s+空闲预取，点改单网络那半从 1.8s 降下来)→v654(拆 `ForecastRow.vue`：改一格 294 行全重渲染→1 行，flush 157ms→60ms；根因= `namePadStyle` 里 `rowWarn(r)` 走 `rowSumOf` 订阅了全表 `rowSumArr`)→v655(抽 `ForecastAgg`/`ForecastHeadCell`/`ForecastQtyOptions` + sprintSummary 改 provide/inject：改一格父组件 **0 次重渲染**（生产真机实测 parentRenders=0）；两真凶=父模板读 `sprintSummary` + 表头 `isCurColHd→spanHas→selected` 订阅链)→v656(停手后 flush 28.6→5.8~8.6ms：新增父组件 `aggTotals` **单遍聚合**（全表一遍算完所有槽位）经 rowCtx 下发，~40 个 ForecastAgg 实例不再各自全表扫描；`watch(healthIssues)` 换 `watch(aggTotals)`；删死 computed `zeroReportCount`/`totalSuggest`/`foot`。render 次数不变（12 次），变的是扫描遍数 8~16→1；指纹零差异 2415 节点)。→v657(加单分摊勾选模式+修「保存后未生效」P0：onAllocApplied 删 loadCross 不再把网格换成只读行；候选池=报单对象名册 `_alloc_candidate_pool`（已部署）；AllocPanel 名册态默认全不勾+平均分配一键勾；extraAllocPreview 加 members 字段；浏览器 e2e 五判据全 PASS：`tests/perf/v657/alloc-pick-e2e-local.mjs`)。→v658(分摊维度改**门店** store_name：候选池一门店一行、三表加列+唯一键换维、`settle_allocs` 锁按门店 + 工号兜底防「填了不算」；**两处静默失效**：租户库索引 pass 早于列对账、补列≠回填（空串互撞致唯一索引建不出来且 `except: pass` 无声）⇒ 顺序固定 补列→回填→建索引，`tools/v658-*-harness.py` 全 PASS)。
- 🔴 **性能判据（v652 实测）**：改单页卡顿根因是「每敲一键写一次响应式」，**不是** DOM 规模/表格紧凑/样式。判据=同一 input 保留 `@input` 写 reactive 121ms、`cloneNode` 丢监听器 0.1ms。任何「输入卡」的排查先做这个二分，别先猜虚拟滚动或压缩行高。~~遗留：停手后一次 ~157ms 全表重算~~ **已由 v654→v655→v656 三连清完**：157ms→60ms（v654 拆行，根因 `namePadStyle` 里 `rowWarn(r)` 摸全表 `rowSumArr`）→ 父组件 0 次重渲染（v655，两真凶=父模板读 `sprintSummary` + 表头 `isCurColHd→spanHas→selected`）→ **6ms**（v656，`aggTotals` 单遍聚合消灭 ~40 个 Agg 实例的重复全表扫描；render 次数不变、扫描遍数 8~16→1）。🔴 **方法论**：这三个版本的定位全部靠 hook `Dep.prototype.notify` + 实测，没有一步是猜的；「拆了组件还全表重渲染」先查行内 helper 有没有摸全表聚合，「父不重渲染了还慢」就数每个 render 背后的全表扫描遍数。

- 🔴 **判「某个操作卡不卡」要按阶段分开量，别只看总时长**（v666 实测：「点改单」慢的是**入口一次性建 8252 个 input**，而打字路径 11.5ms 一直没问题）。手法：`Emulation.setCPUThrottlingRate(4)` 模拟笔记本 + `PerformanceObserver(longtask)` + **三线勾稽**（页面内 hook fetch 记起止 / 每 50ms 采样 DOM 节点数 / 长任务时间戳）；`window.fetch` hook 漏「点之前就在飞」的请求⇒ 用 `performance.getEntriesByType("resource")` 兜底。判据用「首帧可用 + 长任务峰值」，不是总时长（总活量不变，变的是多久能开始干活）。
- 🔴 **生产构建探针三连坑（v655 实测，代价极大）**：① prod minify 产物里**所有组件实例 `setupState` 恒为 EMPTY_OBJ、key 被 mangle** ⇒ 探针别用 setupState 做判据/bypass；类型判据用 `type.__name`（prod 保留）、实例入口用 `#app._vnode`（无条件写）+ **vnode DFS**（element 的 children 也要穿透，实例级一层 walk 会漏孙层）；② `__vueParentComponent`/`app._instance` 被 `NODE_ENV!=="production" || __VUE_PROD_DEVTOOLS__` 门禁，prod 不可用；③ 无开放期次时「改单」被 `noOpenPeriod` 守卫静默拦（只 toast）⇒ 解法 `reopenPeriod(pid,'full')`（**unlock 不改 status 无效**）→ 忠实路径 → 测完 `closePeriod` 恢复。本地验证服务用 `tests/perf/v655/serve-dist.mjs`（静态 dist + `/api` 反代 erp.hergent.cn）。
- 🔴 **新增页面用 `useColSettings('<key>')` / `useColPrefs('<key>')` 必须同时在后端 `db/queries/ui_prefs.py` 的 `COL_PREF_PAGES` 登记该 page 键** —— 否则 `/api/ui/col-prefs` 返回 400，该页列可见性/密度**永远同步不上去**，且失败只留 console 痕迹、界面无感。2026-10 之前 15 个页面就这么静默失效。前端现有 26 个 page 键，大小写不一致是历史事实（`INV-SALE-LIST` vs `inv-stock`），**别统一**（等于把存量配置变孤儿）。
- 🔴 **CDP 探针纪律**：`Input.insertText` 与紧随的 `Runtime.evaluate` **无顺序保证** ⇒ 会误判成「字符被重渲染刷掉」。判"字符有没有被抹掉"必须在**页面内** 10ms 采样 `input.value`，别用 CDP 往返。

- 🔴 **两套前端 app 分占两个域名（v657 实测，已厘清，非部署事故）**：`erp.hergent.cn` 的 nginx `root` = `/opt/static`（「你的AI团队」`#appLayout` 壳层），其 `/api/` 反代后端 `:8700`；而**副驾/预报真身** `/opt/hergent-cn-v2`（「AI 经营副驾」`<div id="app">`，hergent.cn 第 339 行 `root`）才是 Forecast/预报所在、也是 v647~v657 构建**正确落地的位置**（v657 Oct 24 06:42）。📌 先前探针误打 `erp.hergent.cn`（另一套 app、无 Forecast）才"找不到 Forecast"——**不是构建放错地方**，别据此误判"部署没到用户"。验收一律走本地 `localhost:5173`(vite dev)+`/api` 反代生产后端，**不碰线上路由**；用/验副驾功能认准 **hergent.cn**。
- 🔴 **CDP 探针偶发 fetch 挂起**：headless Chrome 经 CDP 发的 `PUT` 写请求偶发永不 resolve（弹窗卡住、无 toast），但**同一端点 curl 直连/经 vite 反代均 200 落库** ⇒ 是 headless+CDP 环境假象，非产品缺陷。判据只取「应用后本行加单格仍=10」（P0 核心），apply 是否真落库用 curl 独立证伪。千万别因"弹窗没关"误判成 apply 失败。

## 审计日志补全（P1-5，2026-10-22 交付，真机复核 PASS）
- 平台级：`platform.py` 5 端点（建账号/API令牌/Webhook 生命周期）接 `_audit`（主库 `admin_audit`，跨租户）；读 `GET /api/platform/audit-logs`。
- 租户级：`finance.py` 钱货写端点补 **8** 处 fail-safe 审计（prepayment/prepay_refund/prepay_refund_apply/employee_settlement/writeoff/settlement/settlement_submit/settlement_confirm）；现有 18 处 `db.audit_log`（含原有 payment/expense_pay + 8 历史 accounts）。
- 部署：服务器就地改 + 备份 `.bak-20261022-p15a/p15c` + `py_compile` + 重启（PID 1023862）。
- 验证：平台 e2e（admin_audit 写读）+ 租户 sink（隔离租户 99 注册→audit_log→读回→哈希链 valid→清理）。🔴 前次曾误报「finance 已交付」，实为把 8 处历史 accounts 审计错算成新增，本次已纠正补齐。
- 遗留：P1-4 监控告警核心已上线+落库（v638 前已收口；推送 webhook **未接** = 仅余 P0 缺口，待用户提供群机器人地址）。P2 占位页/集成三域（经营报表分析 v634~636 / 数电票+开放API v637 / 市场区 v638）**已全部交付**；市场区 16 张为诚实"模块待开发"空态、3 张真身当前生产 0 行。

## P1-4 监控告警（2026-10-22 核心已上线 + 真机验证）
- 新建 `monitoring.py`：系统级健康检查（DB/磁盘/调度器心跳）+ `record_error` fail-safe 推送 + `check_and_alert` 周期评估。
- 推送接线 + 全局 500 捕获 + `/api/monitor/health`、`/api/monitor/test-alert`（`_admin` 守卫）。
- 🔴 **修复 v88 业务告警引擎五重报废**：① 在主库跑→0 规则⇒改 `_run_per_tenant`；② 字段 `condition`→`rule_condition`；③ 缺 `alert_record_fire`/`alert_history_recent`⇒补到 `erp_db.py`；④ 指标层 `inventory_below_safety` 把 dict 当 list 遍历 + 列名 `qty`→`quantity`；⑤ `alert_history_create` INSERT 列名对照的是不存在的 `rule_name/ref_type/ref_id`（真实表是 `rule_id/metric/current_value/...`），被 `try/except:pass` 静默吞掉 ⇒ 落库永远 0 行；去重键同步改为 `rule_id`。
- 租户1 播种 3 条保守默认规则（幂等）。部署：`.bak-20261022-p14/p14b/p14c/p14d` + `py_compile` + 重启（PID 3762124）。用户决策：暂不接企微推送，保留监控+落库。
- **P1-4 收口（p14g，2026-10-22 17:10）**：v88 告警规则 CRUD 已端到端打通 —— 修了 `request.body.read()` 缺陷族（Starlette 1.0.0 的 `Request.body` 是 async 方法，同步 `def` 端点写 `.read()` 必 500），13 处/12 函数全改 `async def`+`await json_body()`（新增 `http_json.py`），隔离租户真机验收 11 步全 PASS；前端 `AlertRules.vue` 已在 v633 发布。**待办（v88 业务模块另一类缺陷，与 body.read 无关）**：`/api/consignment/*` 的 `consignment_agreement_create` INSERT 列名(`type`/`contact_id`)与真实表列(`direction`/`partner_id`)不匹配；`/api/subcontract/*` 调用了 `erp_db` 里不存在的函数(`subcontract_order_create` 等)；两组前端均未接，是否补齐单列决策。`/api/stock-locks` 已完全复活(200)。备份 `.bak-20261022-p14g`。

## 页面真身速查（标题近似、极易改错文件）

- 「预报订单管理 → 商品目标 → 新建」= `src/pages/ProductTarget.vue`（`/forecast?tab=target` 第 4 页签，无独立 chunk）。
- 「目标与返利政策 → 创建商品目标」= `src/components/rebate/TargetFormModal.vue`。
