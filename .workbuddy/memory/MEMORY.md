# Hergent 记忆索引（只放判据 + 去哪查；细节在 `topics/*.md`）

前端 `hergent-cn-v2`（Vue3.5 SFC/Vite）｜后端 `hergent-erp`（FastAPI + SQLite 多租户）。
线上：后端 `/opt/hergent-erp`（扁平，`routers/` 无 `server/` 前缀，**不在 git**）｜前端平铺 `/opt/hergent-cn-v2`（无 dist）｜`root@47.113.224.140`。

## 路由：动手前按域查

前端→`topics/frontend-ui.md`（入口唯一源 `pages.js`；`permView.js` 唯一源、`module:null`=只读；建单页规范 `docs/进销存建单页开发规范-v441.md` §R.1–R.11）｜后端→`backend-invariants.md`｜部署→`deploy-ops.md`｜预报→`forecast-order-domain.md`｜返利→`rebate-domain.md`｜进销存→`inventory-psi.md`｜货损效期→`expiry-loss-domain.md`｜对账→`reconciliation-redo.md`｜副驾→`ai-copilot.md`｜本机坑→`local-machine-pitfalls.md`｜并行→`parallel-dev-protocol.md`｜静默失效家族（改前端必读）→`v629-silent-failure-family.md`。

## 高频硬判据

- prop 到子组件已解包 ⇒ `props.row.value` 恒 undefined，写 `props.row`。
- 模板裸标识符必须在 setup 声明，否则落 `$attrs` 静默 undefined。
- `api()` 只解一层（`client.js` 已 `return data.data ?? data`）⇒ 再写 `(d && d.data)` 恒空；仅 `{raw:true}` 才取 `.data`。
- scopeId 由文件内容派生 ⇒ 动过 SFC 必须重构建重部署。多根组件静默丢父级 `class`。`v-html` 的 DOM 无 scoped ⇒ 要 `:deep()`。
- `v-if` 面板销毁带走 `scrollTop` ⇒ 重开还原；flex 行长文本必须 `min-width:0`。
- 改「恒空 getter」前先 grep 布尔/三元用法（`auth.token` 曾让 IdleTimeout 静默失效）。
- `Teleport to="body"` 的浮层不在页面子树 ⇒ `.page.xxx` 后代选择器对它是死代码。

### 浮层层级（唯一源 `variables.css` v367 阶梯，别自拍 `--z-sticky+N`）

`--z-page-fs`1000 / `--z-page-overlay`1100 / `--z-page-menu`1101 / `--z-page-bar`1120 / Modal 1125·1130 / `--z-sug-pop`1150。
- 🔴 低于 1000 的浮层在全屏页必被整块盖住；**遮罩与本体必须成对抬升**（只抬本体则「点空白关闭」失效）。
- 🔴 页面内 Modal 用 1125/1130（写 1000/1001 会被 `.tb-pop`(1120) 盖住）；`Teleport + fixed`；有自定义浮层就删触发器 `title`。
- 🔴 表格行内下拉必须 `Teleport to="body"` + `fixed`（单元格 `overflow:hidden` 静默裁掉）⇒ 共享件 `RowMoreMenu.vue`。

### 表格 / 控件

- 🔴 **行内图标按钮是行高决定者**：2×`.btn-row-ic`(26)+4 gap=56 净宽，加 td 左右各 8 ⇒ 操作列 ≥72（定 76 + `nowrap`）。抄 `width:64px` ⇒ 换行 ⇒ 行高 29.8→56.6px。**「抄列宽」比「抄机制」更危险**。契约 ⑰。
- 🔴 sticky 列必须补 `background` + `box-shadow:inset 1px 0 0`（`border-collapse:collapse` 下真 border 会丢）。
- 🔴 「换算/解释小字」不占行高 ⇒ 绝对定位浮层；写行内第二行会顶高行高。
- 🔴 列宽按**最不利（宽松）密度**核算：内容宽=列宽−28（`10px 14px`）／紧凑 −16；权威在 `<colgroup>`，td 不写 width。
- 🔴 `.card` 18px 只是「内容卡」基线，套「单行工具条」必须把类名补进 `variables.css` 的 `.card.xx-filter{padding:10px 14px}` 组（否则静默回落 18px）；状态页签只改 `.psi-tabbar .main-tab`。
- 🔴 全站「全选」只能用 `SelectAllCheckbox.vue`（`:indeterminate.prop` + `@change`），范围≡所见。有意不纳入：权限矩阵/列显隐/品牌周期筛选/开关。
- 🔴 `@click.prevent` + 单向 `:checked` 是经典坑（真实鼠标必现，`el.click()` 量不出）⇒ 用 `@change` + `nextTick` 回写；点击切换类控件不许用 `el.click()` 验收。
- 🔴 `<select>` 单位/档位切换用 `:value` + `@change` 取值，**不用 `v-model`**（v-model 在 change 派发前就改掉 `row.unit`，事件里拿不到旧值）；实在要用则必须 `applyUnitChange(..., {force:true})` 摆脱顺序依赖。

### 「改错了」类排查

- 🔴 「模式开关」判据只能用 setup 快照，不能用会被预览覆盖/后端每轮重算回传的 flags。
- 🔴 换唯一键/加列：补列 → **回填** → 建索引，缺一即静默失效；`_create_indexes_on` 是 `except: pass`，只能 `PRAGMA index_list` 逐库复核。
- 🔴 「数字没回填」先分「算错」还是「没量可算」（`0 × 占比 = 0` 与什么都没做同构）。
- 🔴 「底栏要往下翻才看得见」先查写死的 `72vh` 类相对视口高度；判据=量 `bottom` vs `innerHeight`。
- 🔴 拆行后仍全表重渲染 ⇒ 查行内 helper 是否摸全表聚合（hook `Dep.prototype.notify` 按 `this.subs`≈行数找 computed）。「打字卡」根因是「每敲一键写一次响应式」，不是 DOM 规模。

## 🔴 单位三档模型（v683 起全局生效）

- 三档：`products.unit`(小/基础, ratio=1) / `medium_unit`+`medium_ratio` / `large_unit`+`large_ratio`。`order_unit` 只是「默认选哪一档」的偏好，**不是第四档**。
- 🔴 **档案价量纲 = 元/小单位**（`purchase_price`/`sale_price`）；`factory_price` 才是元/大单位。⇒ 按档带价 = `档案价 × 该档 ratio`。采购页曾把它当大单位价（v409 起 7.22 元/板算成 0.72，330 个商品中招）。
- 唯一实现：后端 `db/queries/product_pricing.py`（价格链 last_owner→last→last_legacy→archive→none）；前端唯一入口 `pages/inventory/new/unitPricing.js`。**两边都不许再写第二套**。
- 三件套 `unit` / `base_ratio` / `base_qty` 才落库；扣减/回增一律用 `base_qty`，`base_qty<=0` 回退 `quantity` ⇒ 历史 14.28 万条明细零变化。
- 老板拍板口径：**换档数量不动、金额跟着变**（与 v455 的「价×k、量÷k」相反）；档案没配默认单位时保持各页现状（采购回大包装、其余最小档）。
- 🔴 切客户/供应商/单据类型必须清定价缓存，否则带错价且界面完全正常。契约 ⑱。

## 🔴 后端新增路由必须登记「三张表」

① `_TENANT_MASTER_PREFIXES`/`_TENANT_REQUIRED_PREFIXES`（`server.py` 顶部）② **`_PATH_MODULE_MAP`**（不是 `_PATH_MODULES`）＝模块门禁，**fail-closed**：未登记返回 **403 `MODULE_NOT_CONFIGURED`，连 boss 都打不开** ③ 前端 `pages.js`+`permView.js`。
只登记①不登记②＝接口上线即死（`/api/monitor/health` 躺了一个月）⇒ **「页面能开」不能证明「接口能调」**。纯管理员路由惯用 `"hr"`。

## 🔴 隔离租户 e2e（会动业务数据的验收，唯一安全做法）

- 建 `tenant_99.db`：**只从 `tenant_1.db` 的 `sqlite_master` 复制结构**（不读行）→ 主库 `tenants` 插行 + `user_tenants` 给 boss 加 (2,99) → `X-Tenant-Id: 99` 打真机 HTTP。跑完删库+删两行+删探针 session，并自证 `tenants` 回到 1/10、`tenant_1` 里 `like '%E2E%'` 命中 0。
- 🔴 **prepare 建完库必须 `chown hergent:hergent`**（root 建的库 ⇒ 全线 `attempt to write a readonly database`，含定价接口 500）。改完属主仍 readonly ⇒ 重启进程（`db/connection.py` 的 `_sqlite_cache` 缓存旧 handle，`SELECT 1` 探活照样通过）。
- 🔴 **teardown 删库后必须重启服务再 prepare**：进程持有已删 inode，后续写入落进「幽灵文件」⇒ 现象是「建单 200、详情回显全对，但直连 SQL 查不到明细行」。
- 探针落 `tests/perf/vXXX/`（v681 模板 / v683 含 40 断言）。

## 🔴 后端写库 / 建表 / 格式化

- `db.get_db()` **不 commit** ⇒ 写库必须 `db.get_db_tx()`，否则「接口 200、库里 0 行」。
- `conn.executescript()` 会隐式 commit 之前的写 ⇒ 建表语句放事务块首条。
- 新增表两处同写 DDL：`_safe_migrate_script`（新库）+ 使用侧 lazy `CREATE TABLE IF NOT EXISTS`（老库），逐字一致；租户列清单 `_ensure_tenant_module_tables` 也要同步写，否则当次启动有「建单 500」窗口。
- `sqlite3.Row` 缺列抛 `IndexError` ⇒ 用 `_row_get()` 安全取名，别让「少一个字段」变成「开不了单」。
- 🔴 `erp_db.py` 的 CREATE TABLE 模板曾与真实库 schema 漂移 ⇒ 改表/查询前以 `tenant_1.db` 真实 schema 为准。
- 🔴 `"…%（…" % x` 运行时崩 500（v682）：`%` 后紧跟全角字符被当格式符 ⇒ 用 `100%%（` 或改 f-string。**凡 %-format 里出现 `%（），。、；：` 一律复查**。

## 🔴 数字的单位跟着口径走

返利 `target_type=amount|quantity`；quantity 时目标/达成/缺口/均单全是件数，写死 `¥` 就是把量读成额。跨口径不能相加。**改任何显示数字处先问：这个数什么单位。**

## 🔴 部署 / 构建

- 构建 `node ./node_modules/vite/bin/vite.js build --emptyOutDir false`（PATH 无 `.bin`）；旧 chunk 留在 dist ⇒ 查符号必须 grep **新** chunk 名。
- 发布 `rsync -av --no-owner --no-group dist/assets/`（**绝不 `--delete`**）→ 最后 scp `index.html` → 双侧 md5。macOS rsync 不支持 `--chown`。
- 🔴 只传改动 chunk 会白屏（新 entry 闭包线上可能全无）⇒ 传整个 `dist/assets/`。
- 🔴 「改了但用户说没变」第一步查构建号：打包后是**双引号** `__HG_BUILD__="v683"`（源头在 `src/main.js`，**发版前先升版本号**）；懒加载 chunk **不出现**在 index.html 的 script 标签（据此判「没部署」必误判）；SPA 老标签页永不重拉 index.html。
- 🔴 生产热修不进 git ⇒ 下次整包同步必回退。**「以前修过现在又坏了」：数 `/opt/hergent-cn-v2/assets/*.js` 里关键字出现次数（`grep -o … | wc -l` + `ls -t`），次数多的那版就是修好的，从产物复刻，修完必须进 git + 契约护栏。**
- 🔴 站点归属：`hergent.cn`/`www` → `/opt/hergent-cn-v2`；`erp.hergent.cn` → `/opt/static`（旧 admin）。**发版核验只认 hergent.cn**。样式常在懒加载 chunk 的 css。

## 🔴 测试基线

- 入口：后端 `tests/run_all_tests.py`｜前端 `tests/run-all.mjs`（**18 组**：万元往返 / SFC 符号 / 跨组件·漏 import·双重解包 / 返利 HTTP 契约 / 副驾入口 / ⑫顶栏 ⑬侧栏 ⑭标签栏 ⑮行内更多菜单 ⑯页头密度 ⑰建单页密度 ⑱单位×价格联动）。
- 🔴 「有测试文件」≠「有测试」：17/23 后端文件是脚本式（顶层 `sys.exit`）混在 pytest 里 ⇒ 收集 `INTERNALERROR`、零覆盖却看着健全。
- 🔴 转绿前先自证判别力（注回已知缺陷看能否抓红）；假阴性比假红危险。自证框架本身也会错（v683 `bodyOf` 把默认参数 `{}` 当函数体 ⇒ 坏样本全漏抓）。
- 🔴 正则前导要零宽断言 `(?<![\w.$'"])`；扫模板别扫全文，扫前剥 HTML 注释；已知缺陷进 `KNOWN_ISSUES`。
- 🔴 后端无 CI、回滚只靠手工 `.bak-*`（生产后端不在 git）。

## 会话凭证（v628 httpOnly Cookie）

`erp_token`（httpOnly/Secure/lax）+ `hergent_auth=1` + `csrf_token`（回传 `X-CSRF-Token`）。state-changing 缺 CSRF ⇒ **403 CSRF_REQUIRED**（不是 401）。**永远别删 Bearer 分支**（小程序/桌面端/bot 在用）。

## 探针纪律（细节→`local-machine-pitfalls.md`）

- 登录只能走真实流程（点「先看看演示效果」让后端 Set-Cookie）；脚本放 `tests/perf/vXXX/`，**别放 `/tmp`**（playwright 在仓库 node_modules 里，`/tmp` 下 import 不到）。
- 临时登录态只能插主库 `erp.db` 的 `sessions`（**不是 `tenant_1.db`**）；测完 DELETE 并确认两库均 0。
- 副驾第一个动作 `freshChat()`；识别卡片靠 DOM 事实（`.rc`+`m.role`），不许靠文案。
- 数据不具备时 SKIP 退出 0（演示租户 `readonly=1`、只有 13 个商品、无商品档案权限是环境约束）。
- HTTP 探针读响应头必须全小写；`Content-Disposition` 中文是 percent-encoded。toast 瞬时 ⇒ 150ms 采样存 `window.__toastLog`。
- 生产 minify 三连坑：`setupState` 恒 EMPTY_OBJ（用 `type.__name` + `#app._vnode` vnode DFS）；`__vueParentComponent` 被 NODE_ENV 门禁；「改单」需 `reopenPeriod(pid,'full')`。
- 1440 下操作列常在视口外 ⇒ 先 `scrollIntoView` 再点。**`v-if` 切换单元格会把 `<select>` 整块卸载** ⇒ 选项要在格子还开着时读。

## 本机坑

`grep "A\|B"` 静默失效⇒用 `-e` 或拆两条；`&&` 前段无匹配会短路；`| head -N` 截掉决定性命中；`grep -rl X *.py` 只搜顶层；zsh 里 `$c[ ]` 当数组下标；`timeout` 不存在。**「搜不到」先排除「搜错范围/被截断」。**

## 布局高度三条唯一源

- 🔴 顶栏：唯一源 `--topbar-h`（**48px**），栏内最高控件 34px ⇒ 内容盒 47、呼吸位 6.5px。别改字号/padding/写死 height，别另立 `--header-h`。契约 ⑫。
- 🔴 侧栏条目：高度 = line-height + 上下 padding，**从来没设 height**，现 **38.8px**（`padding:9px` + 13×1.6）。`line-height` 必须显式写；`.sb-area-btn` 只许 `font-family:inherit`；禁写死 height。契约 ⑬。
- 🔴 全局标签栏 = 顶栏正下方「[⟳] 采购单 ×」（`TabBar.vue`），现 **35px**。**三件必须同步**：`.tabbar` padding、`.tab-item`/`.tab-more-btn`/`.tab-more-item` height（必须全等，漏改「更多」撑回 37 而肉眼查不出）、`.tab-more-menu` 的 `top`。契约 ⑭。❗造溢出须开 2+ 标签（hash 跳 `#/forecast`）。

## 进度锚 / 约定

P0 7/7、P1 6/6 已交付。**卖前三关未过；调拨单生产仍 0 张**。BI 唯一源 `erp_db.py:_BI_MEASURES`（`soi.amount`）；库存周转唯一源 `get_inventory_turnover`。
脱敏红线：返利率/进货价/客户名/区域销量/厂家政策；PII 不落 `outputs/`。
技能：`hergent-pre-launch-audit`｜`hergent-scoped-commit`｜`parallel-session-safety`｜`rebate-caliber-consistency`｜`chart-render-verify`｜`ui-copy-guard`。
编号已到 **v683**（v683 单位可选+价格联动 / v682 `%（` 崩 / v681 monitor 门禁+隔离租户 e2e / v680 建单页行高 / v679 页头密度 / v678 行内「⋯」/ v677 侧栏+标签栏 / v675 顶栏 48）。
历史交付细节（P1-4 告警引擎、P1-5 审计、consignment/subcontract 待办）→ `topics/backend-invariants.md`。

## 页面真身速查（标题近似，极易改错文件）

- 「预报订单管理→商品目标→新建」=`pages/ProductTarget.vue`（`/forecast?tab=target` 第 4 页签）｜「目标与返利→创建商品目标」=`components/rebate/TargetFormModal.vue`。
- 商品档案 = `pages/ProductArchive.vue`，路由 **`/archive/products`**（`/archive` 是员工档案）。
- 🔴 建单页现行落点（v449 拆分后）：采购订货 `PurchaseOrderForm`｜采购退货 `PurchaseReturnForm`｜自提/车销**订单+退单**共 4 入口走 `SaleDocForm`｜调拨 `TransferDocForm`｜商品格共享件 `ProductCombo`。`InvPurchaseNew.vue`/`InvSaleNew.vue` 是**已死引用**（无路由）；规范文档 §9/§9.1 是拆分前历史对照，现行看 **§9.3 + §R.11**。
