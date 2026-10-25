# Hergent 记忆索引（只放**判据** + 去哪查；细节全在 `topics/*.md`）

主体：前端 `hergent-cn-v2`（Vue3.5 SFC/Vite，仓库 `laozhangai-product`）｜后端 `hergent-erp`（FastAPI + SQLite 多租户）。
线上：后端 `/opt/hergent-erp`（**扁平**，`routers/` 无 `server/` 前缀，**不在 git**）｜前端平铺 `/opt/hergent-cn-v2`（**无 dist 子目录**）｜`root@47.113.224.140`。

## 路由：动手前按域 grep（🔴=硬判据）

- **前端**→`topics/frontend-ui.md`：入口唯一源 `pages.js`（未登记=失门禁）｜`permView.js` 唯一源、`module:null`=只读｜文案三禁⇒`hergent-ui-copy-guard`｜图表唯一源 `src/components/chart/`｜列表页冻结/密度/合计 `psi-list.css`｜建单页视觉规范 `docs/进销存建单页开发规范-v441.md`（§R.1–R.11）。v678–v680 密度三连（行内「⋯」/ 页头 / 建单页行高）全部细节在该文件末节。🔴 **`Teleport to="body"` 的浮层不在页面子树里** ⇒ 任何 `.page.xxx` 后代选择器对它都是死代码（v673 副驾抽屉被弹层盖住的根因）；页面级非模态浮层统一登记 `styles/app-layers.css`。
- **后端**→`topics/backend-invariants.md`：路由遮蔽先注册者胜｜静默失效=恒空恒 0｜门禁用接口模块非页面模块｜FastAPI 未声明 query 被静默忽略｜意图路由按序首匹配｜`execute_tool` 返回键 `success`。🔴 **Starlette 1.0.0 的 `Request.body` 是 async 方法**（无 `.read()`）→ 同步 `def` 端点写 `request.body.read()` 必 500；读 JSON body 用 `await request.json()` 或共享 `http_json.json_body()`。🔴 **`erp_db.py` 的 CREATE TABLE 模板曾与真实租户库 schema 漂移** ⇒ **改任何建表/查询前以 `tenant_1.db` 真实 schema 为准**。
- **部署**→`topics/deploy-ops.md`｜**预报主表**→`forecast-order-domain.md`｜**返利**→`rebate-domain.md`｜**进销存**→`inventory-psi.md`｜**货损效期**→`expiry-loss-domain.md`｜**对账**→`reconciliation-redo.md`｜**副驾**→`ai-copilot.md`｜**本机坑/探针**→`local-machine-pitfalls.md`｜**并行会话**→`parallel-dev-protocol.md`。
- 🔴 **v629 静默失效家族（5 例真缺陷 + 检查器）→`topics/v629-silent-failure-family.md`**（改前端前必读）。

## 🔴 最高频硬判据

- **prop 到子组件已被解包** ⇒ `props.row.value` 恒 undefined，直接写 `props.row`。
- **模板裸标识符必须在 setup 声明**，否则落 `$attrs`、静默 undefined（v629：`open` 未声明⇒弹窗永不渲染）。
- **`api()` 只解一层**（`client.js` 已 `return data.data ?? data`）⇒ 调用方再写 `(d && d.data)` 恒空。仅 `{ raw: true }` 的方法才取 `.data`；带兜底的 `.data` 是防御链，别判红。
- **scopeId 由文件内容派生** ⇒ 动过任何 SFC 必须重构建重部署。
- **多根组件（Fragment）静默丢父级 `class`** ⇒ 写「按 class 选子组件根」的 CSS 前先真机读 `el.className`。
- **`v-html` 注入的 DOM 没有 scoped 属性** ⇒ `.md p{}` 是死代码，要 `.md :deep(p)`。
- **`v-if` 挂载的面板销毁会带走 `scrollTop`** ⇒ 重开要还原。
- **flex 行里可能超长的文本必须 `min-width:0`**（判据=量 `scrollWidth-clientWidth`）。
- **改"恒空 getter"前先 grep 布尔/三元用法**（`auth.token` 改恒空曾让 IdleTimeout 静默失效=安全倒退）。

### 浮层层级（唯一源 `variables.css` 的 v367 阶梯，别再自己拍 `--z-sticky+N`）

- 档位：`--z-page-fs`(1000 全屏) / `--z-page-overlay`(1100 遮罩) / `--z-page-menu`(1101 本体) / `--z-page-bar`(1120) / 模态 1125·1130 / `--z-sug-pop`(1150)。
- 🔴 **低于 1000 的浮层在全屏页必被整块盖住**（预报页 `.col-menu` 挂 `.cross-card` 里、不在 `.grid-area.is-fs` 内，原 610/611 ⇒ 全屏时 `elementFromPoint` 三点全命中 `div.pname`）。**遮罩与本体必须成对抬升**，只抬本体则「点空白关闭」跟着失效。
- 🔴 **页面内 Modal 用 `--z-page-modal-overlay/-modal`(1125/1130)**，写 1000/1001 会被 `.tb-pop`(1120) 盖住。`Teleport + fixed`；无页面上下文的顶层确认浮层可用 1250。有自定义浮层就删触发器 `title`。
- 🔴 **表格行内下拉（「⋯更多操作」）必须 `Teleport to="body"` + `position:fixed`**（v678）：单元格普遍 `overflow:hidden`，绝对定位会被静默裁掉。共享件 `components/RowMoreMenu.vue`。

### 表格 / 控件

- 🔴 **行内图标按钮是行高决定者；固定列宽必须按内容倒推**（v680）：两个 `.btn-row-ic`(26) + 4px 间距 = 56 净宽，加 td 左右各 8 ⇒ 操作列须 ≥72（定 **76** + `nowrap`）。新页抄了 `width:64px` ⇒ 净宽 48 ⇒ 按钮换行两行 ⇒ 行高 29.8→**56.6px 翻倍**。**「抄列宽」比「抄机制」更危险**。契约 `psi-order-form-density`（⑰）。
- 🔴 **sticky 列必须补 `background` + `box-shadow:inset 1px 0 0`**：`border-collapse:collapse` 下 sticky 真 `border` 会丢，不补则横向滚动时后面列从底下**透出来**。
- 🔴 **「换算/解释小字」不占行高 ⇒ 绝对定位浮层**（基准 v417c 机制）；写成行内第二行会在多档单位商品时把行高顶起来。
- 🔴 **列宽按「最不利（最宽松）密度」核算**（v678）：内容宽 = 列宽 − 28（宽松档 10px 14px）。按紧凑档(−16)定会差 3px 被静默裁掉末位按钮。列宽权威在 `<colgroup>`，td 不写 width。
- 🔴 **`.card` 的 18px 只是「内容卡」基线，不能套「单行工具条」**（v679）：唯一源是 `variables.css` 的 `.card.xx-filter{padding:10px 14px}` 组；**新增筛选卡必须把类名补进这组，否则静默回落 18px**（无报错）。状态页签只改 `.psi-tabbar .main-tab`，**不动全局 `.main-tab`**。
- 🔴 **全站「全选」只能用 `components/SelectAllCheckbox.vue`**（`:indeterminate.prop` + `@change`）：范围 ≡ 所见（分页=当前页、筛选=当前可见）。有意不纳入：权限矩阵 / 列显隐 / 品牌·周期筛选 / 各类开关（理由见 UI-SPEC §2.6.2 D）。契约须扫全站（只扫基准实现必漏，v669）。
- 🔴 **`@click.prevent` + 单向 `:checked` 是复选框经典坑**（真实鼠标必现，`el.click()` 量不出）：Chrome pre-click activation 在派发前翻转 `checked`、`preventDefault()` 在派发后还原，而 Vue patch 只在 vnode prop 变化时写 DOM ⇒ 勾选态与状态永久相反。正解 `@change` + `nextTick` 回写。🔴 推论：点击切换类控件不许用 `el.click()` 验收。

### 「改错了」类排查

- 🔴 **「模式开关」判据只能用 *setup 快照***，不能用会被 preview 覆盖的 flags（v658b：勾第一家后名册整块消失、再也勾不到第二家）。凡「后端每轮重算并回传的状态」都不能当 UI 开关。
- 🔴 **换唯一键/加列：租户库 补列 → **回填** → 建索引，缺一即静默失效**（v658）：`ALTER ADD COLUMN` 只给列不给值 ⇒ 多行空串在新键上互撞；`_create_indexes_on` 是 `except: pass`，日志一个字没有。验收只能 `PRAGMA index_list` 逐库复核。
- 🔴 **「数字没回填」先分「算错」还是「没量可算」**（v660）：`0 × 占比 = 0`，回填 0 与「什么都没做」界面同构，而按钮写着「并回填」。取证靠落库表反推当时的输入。修法是**让"没量可算"不可能悄悄发生**。
- 🔴 **「底栏要往下翻才看得见」先查写死的 `72vh` 类相对视口高度**（v602 / v667 同款两次）：判据=量 `底栏.bottom` vs `innerHeight`。🔴 探针别拿 `getComputedStyle().maxHeight` 当 CSS 兜底值——内联覆盖它、两者恒等；要比就按公式算，且须有「清内联 ⇒ 复现溢出」的判别力自证。
- 🔴 **拆行后仍全表重渲染 ⇒ 先查行内 helper 有没有摸全表聚合**（`rowSumOf`/`cellIssueIndex`/`dupBarcodeAt`）。定位唯一手法：hook `Dep.prototype.notify` 按 `this.subs` ≈ 行数找 computed。`onRenderTriggered` 的字段不可信。
- 🔴 **「打字卡」根因是「每敲一键写一次响应式」，不是 DOM 规模/行高**（v652）：判据=保留 `@input` 121ms vs `cloneNode` 0.1ms。

## 🔴 后端新增路由必须登记「三张表」

- 🔴 **① `_TENANT_MASTER_PREFIXES` / `_TENANT_REQUIRED_PREFIXES`**（`server.py` 顶部）= 租户上下文；
  **② `_PATH_MODULES`**（`server.py` P0-2.1 区块）= 模块门禁，**fail-closed**：
  未登记的路径返回 **403 `MODULE_NOT_CONFIGURED`「路径未配置访问模块」，连 boss/admin 都打不开**；
  **③** 若前端有页面，还要在 `pages.js` + `permView.js` 登记（见前端铁律）。
  只登记 ① 不登记 ② ＝ **接口上线即死**（2026-10-25 实证：v88 P1-4 的 `/api/monitor/health`、
  `/api/monitor/test-alert` 就这样躺了一个月，健康检查/测试告警全不可用，而已登记 ③ 的
  `AlertRules` 页面是好的 ⇒ 「页面能开」不能证明「接口能调」）。
  纯管理员路由惯用 `"hr"`（仅 boss 持有）保持 owner-only，如 `/api/config`、`/api/force-logout`。

## 🔴 后端写库 / 建表（极易静默不落盘）

- 🔴 **`db.get_db()` 不 commit**（`finally` 只 rollback）⇒ 写库必须 **`db.get_db_tx()`**。否则「接口 200、库里 0 行」。
- 🔴 `conn.executescript()` 会**隐式 commit** 之前的写 ⇒ 建表语句放事务块**第一条**。
- 🔴 新增表**两处同写 DDL**：`erp_db.init_db()` 的 `_safe_migrate_script`（新库）+ 使用侧 lazy `CREATE TABLE IF NOT EXISTS`（**已存在**的租户库），两份逐字一致；只写迁移会让老库在低频路径上 `no such table`。

## 🔴 数字的单位跟着口径走

返利 `target_type=amount|quantity`；quantity 时目标/达成/缺口/均单全是**件数**，模板写死 `¥` 就是把量读成额。跨口径**不能相加**。**改任何显示数字处先问：这个数什么单位。**

## 🔴 部署 / 构建

- 构建：`node ./node_modules/vite/bin/vite.js build --emptyOutDir false`（PATH 无 `.bin`）。副作用=旧 chunk 留在 dist ⇒ 查符号必须 grep **新** chunk 名。
- 发布：`rsync -av --no-owner --no-group dist/assets/ root@…:/opt/hergent-cn-v2/assets/`（**绝不带 `--delete`**）→ 最后 scp `index.html` → 双侧 md5。macOS rsync 不支持 `--chown`，传完单独 chown。
- 🔴 **只传改动 chunk 会白屏**：新 entry 的闭包线上可能全无 ⇒ 传**整个** `dist/assets/`。
- 🔴 **「改了但用户说没变」第一步查构建号**：打包后是**双引号** `__HG_BUILD__="v680"`（grep 单引号会空手）；懒加载路由 chunk **不出现在 index.html 的 script 标签**（用「index.html 没引用」判「没部署」必误判）。SPA 老标签页永不重拉 index.html。
- 🔴 **生产热修不进 git ⇒ 下次整包同步必回退**（v663 副驾「新对话」按钮就这样回退过）。**「以前修过现在又坏了」：去 `/opt/hergent-cn-v2/assets/*.js` 数关键字出现次数（`grep -o … | wc -l` + `ls -t`），次数多的那版就是修好的版本，从产物逐项复刻，别从零重新设计；修完必须进 git + 契约护栏。**
- 🔴 **站点归属**：`hergent.cn`/`www` → `root /opt/hergent-cn-v2`（cn-v2，预报/副驾/进销存全在这，nginx `sites-enabled/hergent`）；`erp.hergent.cn` → `root /opt/static`（旧 hergent-admin）。**发版核验只认 hergent.cn。**
- 样式常落在**懒加载 chunk** 的 css（`Forecast-*.css`），别只 grep `index-*.css`。

## 🔴 测试基线

- 入口：后端 `tests/run_all_tests.py`｜前端 `tests/run-all.mjs`（现 **17 组**：万元往返 / 153 SFC 符号 / 跨组件·漏 import·双重解包 / 返利 HTTP 契约 / 副驾入口 / ⑫顶栏 ⑬侧栏 ⑭标签栏 ⑮行内更多菜单 ⑯页头密度 ⑰建单页密度）。
- 🔴 **「有测试文件」≠「有测试」**：17/23 后端文件是脚本式（顶层 `sys.exit`）混在 pytest 里 ⇒ 收集 `INTERNALERROR`、零覆盖却看着健全。
- 🔴 **转绿前先自证判别力**：注回已知缺陷看能否抓红。假阴性比假红危险得多。
- 🔴 正则前导要**零宽断言** `(?<![\w.$'"])`；消费前导字符会让嵌套调用整层漏检。
- 🔴 **扫模板别扫全文**（HTML 注释/CSS `var()`/SVG `rotate()`/正文文字全是噪声）；扫前先剥 HTML 注释，否则你自己写的说明注释会被当成代码（v664 误报）。
- 已知缺陷白名单 `KNOWN_ISSUES`：**打印但不阻断 CI**，修完销账。
- 🔴 **后端无 CI、回滚只靠手工 `.bak-*`**（生产后端不在 git）。

## 会话凭证（v628：httpOnly Cookie）

`erp_token`（httpOnly/Secure/lax，JS 读不到）+ `hergent_auth=1`（前端判登录态）+ `csrf_token`（前端读来回传 `X-CSRF-Token`）。
🔴 cookie 模式下 state-changing 必须带 CSRF，否则 **403 CSRF_REQUIRED**（不是 401）。**永远别删 Bearer 分支**（小程序/桌面端/bot 在用）。

## 探针纪律（细节 → `topics/local-machine-pitfalls.md`）

- 🔴 登录只能走**真实登录流程**（点「先看看演示效果」让后端 Set-Cookie）；localStorage 塞 token 已不通。探针脚本放 `tests/perf/vXXX/`，**别放 `/tmp`**。
- 🔴 **临时登录态只能插主库 `erp.db` 的 `sessions`**（`_master_db()` = `db.DB_PATH` = `/opt/hergent-erp/erp.db`，**不是 `tenant_1.db`**）；测完必须 DELETE 并确认两库均为 0。
- 🔴 副驾第一个动作 `freshChat()`；识别卡片靠 DOM 事实（`.rc` + `m.role`），**不许靠文案**。
- 🔴 数据不具备时 **SKIP 退出 0**，不要判红（演示租户 `readonly=1` 是环境约束）。
- 🔴 **HTTP 探针读响应头必须全小写**（uvicorn 发 `x-template-batch`）⇒ 前后缀都 lower；`Content-Disposition` 里的中文是 percent-encoded，不 `unquote` 匹配不到「第1批」。
- 🔴 **toast 是瞬时的** ⇒ 判「有没有提示」必须页面内 150ms 持续采样存 `window.__toastLog`。`sticky` 判据是 `text.length >= 60`。
- 🔴 **生产 minify 探针三连坑**：`setupState` 恒 EMPTY_OBJ（用 `type.__name` + `#app._vnode` vnode DFS）；`__vueParentComponent` 被 NODE_ENV 门禁；「改单」需 `reopenPeriod(pid,'full')`（unlock 无效）。
- 🔴 **视口**：1440 下操作列常在视口外，`elementFromPoint` 返 null ⇒ 先 `scrollIntoView` 再点。

## 本机坑

`grep "A\|B"` 静默失效⇒用 `-e` 或拆两条；`&&` 前段无匹配会短路；`| head -N` 会截掉决定性命中；`grep -rl X *.py` 只搜顶层；zsh 里 `$c[ ]` 会被当数组下标。**「搜不到」先排除「搜错了范围/被截断」。** `timeout` 命令不存在。

## 布局高度三条唯一源（"太高/太挤"全落在这）

- 🔴 **顶栏**：唯一源 `--topbar-h`（v675 起 **48px**）。栏内最高控件 34px ⇒ 内容盒 47、呼吸位 **6.5px**。别改字号、别加 padding、别页面写死 `height`，也别另立 `--header-h`。量呼吸位须按**内容盒**（扣 `border-bottom:1px`）。契约 ⑫。
- 🔴 **侧栏条目**：高度 = line-height + 上下 padding，**从来没设 `height`**。现 **38.8px**（`padding:9px` + 13×1.6=20.8）；v676 收到 34 老板嫌挤、v677 退回。① `line-height` 必须显式写（UA `normal` 会参差）；② `.sb-area-btn` 只许 `font-family:inherit`，**禁 `font:` 简写/另设 font-size**；③ 禁写死 `height`。契约 ⑬。
- 🔴 **全局标签栏 ≠ 顶栏 ≠ 侧栏 ≠ StatusTabs**：= 顶栏正下方「[⟳] 采购单 ×」那条（`components/TabBar.vue`）。v677 起 **35px**（条目 26 + padding 4×2 + 1）。🔴 **三件必须同步**：`.tabbar` padding、`.tab-item`/`.tab-more-btn`/`.tab-more-item` height（**必须全等**，漏改「更多」会把整条撑回 37 而肉眼查不出）、`.tab-more-menu` 的 `top`。契约 ⑭。❗1 个标签永远出不了「更多」⇒ 造溢出须开 2+ 标签（用 hash 跳 `#/forecast`，**别用 `#/market`**）。

## 进度锚 / 约定

P0 7/7、P1 6/6 已交付。**卖前三关未过；调拨单生产仍 0 张**。BI 唯一源 `erp_db.py:_BI_MEASURES`（口径 `soi.amount`）；库存周转唯一源 `get_inventory_turnover`。
脱敏红线：返利率/进货价/客户名/区域销量/厂家政策；PII 不落 `outputs/`。
技能：`hergent-pre-launch-audit`｜`hergent-scoped-commit`｜`parallel-session-safety`｜`rebate-caliber-consistency`｜`chart-render-verify`｜`ui-copy-guard`。
**编号已到 v680**（v680 六建单页行高 56.6→29.8 / v679 页头密度 / v678 行内「⋯」/ v677 侧栏 38.8+标签栏 35 / v676 侧栏 34 / v675 顶栏 48）。
历史交付细节（P1-4 告警引擎五重报废与收口、P1-5 审计补全、consignment/subcontract 待办）→ `topics/backend-invariants.md`。

## 页面真身速查（标题近似、极易改错文件）

- 「预报订单管理 → 商品目标 → 新建」= `src/pages/ProductTarget.vue`（`/forecast?tab=target` 第 4 页签）。
- 「目标与返利政策 → 创建商品目标」= `src/components/rebate/TargetFormModal.vue`。
- 🔴 **建单页现行落点（v449 拆分后）**：采购订货单 `PurchaseOrderForm`｜采购退货单 `PurchaseReturnForm`｜自提/车销**订单+退单**共 4 入口都走 `SaleDocForm`｜调拨单 `TransferDocForm`｜商品格共享件 `ProductCombo`。`InvPurchaseNew.vue`/`InvSaleNew.vue` 是**已死引用**（无路由）；规范文档 §9/§9.1 是拆分前历史对照（「§R 视觉基准 ✅」已过期），现行看 **§9.3 + §R.11**。
