# Hergent 记忆索引（只放判据 + 去哪查；细节全在 `topics/*.md`）

前端 `hergent-cn-v2`（Vue3.5 SFC/Vite）｜后端 `hergent-erp`（FastAPI + SQLite 多租户）。
线上：后端 `/opt/hergent-erp`（扁平、**不在 git**）｜前端 `/opt/hergent-cn-v2`｜`root@47.113.224.140`。

## 按域查（动手前先查，别凭印象）

前端/浮层/表格/布局/页面真身→`frontend-ui.md`｜后端写库·建表·**路由三张表**·隔离租户 e2e→`backend-invariants.md`｜部署·构建·测试基线→`deploy-ops.md`｜单位三档·自由退货·商品候选·**商品档案新增/编辑**·**收文案≠收反馈**→`inventory-psi.md`｜探针纪律·本机坑→`local-machine-pitfalls.md`｜凭证→`backend-auth.md`｜预报→`forecast-order-domain.md`｜返利→`rebate-domain.md`｜货损效期→`expiry-loss-domain.md`｜对账→`reconciliation-redo.md`｜副驾→`ai-copilot.md`｜并行→`parallel-dev-protocol.md`｜静默失效家族（改前端必读）→`v629-silent-failure-family.md`。

## 十条最容易「静默失效」的

1. 接口 200 / 界面正常 **≠** 生效。判据只能用**用户可见字面量**，不能用 minify 后会改名的符号名。
2. `api()` 只解一层 ⇒ 再写 `(d && d.data)` 恒空；prop 已解包 ⇒ 写 `props.row`，不是 `.value`。
3. 写库必须 `get_db_tx()`（`get_db()` 不 commit）；新路由必须登记 **`_PATH_MODULE_MAP`**（fail-closed，未登记 403 连 boss 都打不开）⇒「页面能开」≠「接口能调」。
4. 动过 SFC 必须重构建重部署（scopeId 派生）；发布传**整个** `dist/assets/`，绝不 `--delete`，最后 scp `index.html` + 双侧 md5。
5. 「改了没变」先查 `__HG_BUILD__`（源头 `src/main.js`，**发版前先升**）；懒加载 chunk 不出现在 index.html；SPA 老标签页永不重拉。
6. 「只提醒不拦截」：提醒状态**不得**进 `validate*()`、不得绑 `:disabled`——一进校验就变拦截，界面看不出区别。
7. 列宽按**最不利密度**核算、操作列 ≥72（抄列宽比抄机制更危险）；浮层低于 `--z-page-fs` 会被整块盖住，遮罩与本体成对抬升。
8. 单位：档案价 = 元/**小**单位；换档**数量不动、金额跟着变**；切客户/供应商/单据类型必须清定价缓存。
9. 「搜不到」先排除「搜错范围/被截断」：`grep "A\|B"` 静默空、`| head -N` 截掉关键命中、`grep -rl X *.py` 只搜顶层。**多模式用 `-e` 或拆两条。**
10. 探针放 `tests/perf/vXXX/`（`/tmp` import 不到 playwright）；临时登录态只插主库 `erp.db` 的 `sessions`，测完删净并自证残留 0。
11. 🔴 **mock 探针全绿 ≠ 生效**（v697 翻车：24 项界面断言全过，老板线上却看不到入口，因为生产状态值是 `confirmed` 而我写死 `approved`）。**凡判定依赖枚举值/存量数据形态的功能，验证必须落在生产真实数据上**，mock 只验渲染、不验判定。动手前先 `SELECT status, COUNT(*) ... GROUP BY status` 看真实取值分布。
12. 部署：`rsync` 只能写 `-av`（**默认就不删，别加 `--no-delete`**，该参数不存在会报错且一个文件都不传）；rsync 与 scp 串 `&&` 时前者失败**不阻止后者** ⇒ 传完立刻 ls 新 chunk 存在，否则线上 index.html 指向空文件直接白屏。
13. 线上真登录探针要注**两个** cookie：`erp_token`（真凭证 httpOnly）+ `hergent_auth='1'`（标记，路由守卫读它）；只注前者会跳登录页，看起来像"没部署"。`addCookies` 用 `url` 时不能再给 `path`。
14. 🔴 **「业务接口全正常、只有图片/附件裂」⇒ 先查「带不了自定义头的请求」**。`<img>` / `<link>` / 下载 / `window.open` 都是浏览器自发请求，**只能吃 cookie**，发不出 `X-Tenant-Id`。而 `tenant_middleware` 对 `/api/*` fail-closed 要求租户上下文 ⇒ cookie 残留别的租户或 token 过期就 403 ⇒ 前端静默回落（v700 头像就是这样退回 🚀，端点本身没错，是它根本没被执行）。角色头像落盘在 **`/opt/hergent-data/role-avatars/<tenant>/`**（不在 static 下，故意放部署目录外防 rsync --delete）。

## 近四版口径

- **v702 目标作用对象＝供应商**（`components/rebate/SupplierPicker.vue` 新增；`TargetFormModal` 改）。`dimension` 不动（brand/product 只决定表单形态），**后端零改动**；新建多选=**扇出 N 条独立规则**（名加「· 供应商名」），编辑恒单选。四条硬判据：① **`scope_key` 必须存供应商名称、不能存 id** —— 后端 `rebate_rules.py:1125` 对 brand 强制 `scope_key=scope_name`，且返利按 `(月份,维度,scope_key)` 配对**达成**（`rebate_achievements.scope_key` 是导入的名称原文）⇒ 用 id 永远配不上、返利一笔算不出；代价=供应商改名旧目标失联。② **候选异步晚到会让回显永久落空**：`init()` 早于父页拉供应商 ⇒「简爱」被永久判"未绑定"（init 只跑一次）⇒ 监听 `supplierOptions.length` 补匹配，且**不覆盖用户已改的选择**。③ `DELETE /api/rebate-rules/{id}` 默认**软删除**，测试清理要 `?hard=1`；"没建成所以没东西删"会让清理断言**空转 PASS** ⇒ 判据写「建成 N 且残留 0」。④ 探针写操作要 **CSRF 双提交**（cookie `csrf_token` == header `X-CSRF-Token`），只注 `erp_token` 会 403 看着像功能坏了。前端两坑：**`watch(getter)` 立即求值** ⇒ 引用后定义的 ref 即 TDZ 白屏；**`.ui-modal-body` 有 `overflow-y:auto`** ⇒ absolute 浮层被裁，选择器必须内嵌面板。诚实性：生产 `pinyin/pinyin_first` **0/38 有值** ⇒ 界面不承诺拼音搜索（探针有反向断言守着）。验证 38（线上真实会话）+ 9（真写库扇出、硬删自证残留 0）。
- **v691 弹窗全站统一**（`components/Modal.vue` 收编 20 文件 40 弹窗）。三条硬判据：① 弹窗内部布局必须留在 **slot wrapper**（`.ba-fields`/`.df-body`…），放组件里父页 scoped 后代选择器就命中不到；② **类名透传不是解法**（v-if 挂载照样打不到组件内部元素），试过已弃；③ `#header` 只换标题、**关闭按钮永远由组件渲染**。层级统一 **1125/1130**（原来 7 处倒挂：`.pc-mask`/`.rm-modal` 只有 60）。**收编会让 16 页凭空多出 ESC/遮罩关闭** ⇒ 必须开 `guardClose`（判据=纯 DOM 级 `input`/`change` 才算动过，第一下只提示第二下才关），不能让各页自己写 isDirty。补验口径（`tests/perf/v691/gaps.mjs`，线上 14 目标 133 断言 0 FAIL）：① **「有输入控件」≠「用户动过」**——探脏必须先派发 `Event('input',{bubbles:true})`，否则把好弹窗判 SKIP；② **内容容器是 `.body > .content`，不是 `.main`**（用 `.main` 判渲染会恒 null、把正常页误判白屏）；③ 复杂弹窗入口多为 **URL 子页 + 卡片**，不是顶部按钮（`ConnectCenter` im/erp/datasource/**skill**、`Rebate` settle/promises/rules、`ReportMapping` forecast?tab=config、`LossAccounting` **?tab=fill** 才有 `.la-bar`）。**覆盖边界**：全站**仍有 55 处手写遮罩**（`Forecast.vue` 14、`Rebate.vue` 10 为主）未收编 —— 别说成「全站唯一弹窗骨架」。
- **v689** 商品档案「新增」并入「编辑」**同一个弹窗**（`formMode:'edit'|'add'` + 同一个 `editForm`）⇒ 判据是**结构只有一个弹窗**（遮罩数=3、`addForm/addOpen` 必须不存在、两处保存按钮都绑 `saveForm()`），不是像素。新增改走 **`POST /api/products`**（`product_create` 支持 30 字段），**不再 `bulk-upsert`**（那条只认 17 列且**同名即覆盖别人那行**，v226/v184b/v233 三次清零事故全源于此）；`products.name` **无唯一索引**、生产已有 130 组同名 ⇒「同名=同一条」不成立。语义别互抄：编辑「留空=清空」，新增「留空=用默认值」。
- **v687** 收掉建单页常驻占位（「先选供应商/先选客户/请选择原因」）⇒ **必须留三条解释通道**：title 悬停 + 点击 toast + `validate()` 兜底。判「格内没字」只取 `>` 之后的插值，别扫整个标签（title 挂在同一个 span 上，扫全标签会把 title 一起判死）。

## 进度锚

卖前三关未过；调拨单生产仍 0 张。BI 唯一源 `_BI_MEASURES`（`soi.amount`）；库存周转 `get_inventory_turnover`。
脱敏红线：返利率/进货价/客户名/区域销量/厂家政策；PII 不落 `outputs/`。编号已到 **v702**（目标作用对象=供应商，**已部署**，线上 `data-build=v702`）。
- **v698（2026-10-27）采购三入口修复**：生产真实的「已审待执行」是 **`confirmed`**（v417 定的），**不是 `approved`**（生产 0 张）；`received_amount` 是 v403 才加的列、79 张舟谱导入单全 0。三处同修：入库守卫补 `confirmed`（原本只收 `approved` ⇒ 已审单纯不进库，后端自身断裂）、`pay_mode` 认 `confirmed`、新增 `_po_received_amount()`（`received` 且该列为 0 ⇒ 真值=订单金额，**`partial` 不猜**）。验证 28（真实数据只读）+ 6（线上真实页面，不 mock）。
字号：主力 **11–12.5px**（业界 13–14px），老板 2026-10-26 定**暂不提档**（笔记本用浏览器 125%）。⇒ 别再重复提议改字号；卖客户前必重上桌面。**v688 已修**采购建单表在 1536 视口横滚，但判据要记住：`table-layout:auto` 下**列宽是被内容撑开的，改 width/min-width 无效** ⇒ 压列必须 `max-width`+省略号，且包 `@media(max-width:1680px)`（否则台式机被误压）；**采购退货页是独立组件**、自带一份 1372 要单独改。数字列一个不能压（截断=读错金额）。别照抄 1372（详情 `topics/frontend-ui.md`）。
**AI 成本与计费口径（2026-10-26 实测，别再凭印象）**：上游已是 `deepseek-v4-flash`（最便宜档），全期 2759 次调用/897 万输入 tokens 仅 **$2.38** ⇒ **换模型省不了钱**。真成本 = **每轮 `prompt_tokens`≈20,867 × 单会话 34~77 轮**（`system_prompt` 18,477 字符是主因）⇒ 杠杆顺序：提示词瘦身 > 轮数上限场景化 > 缓存纪律 > 分档路由 > 换模型(0)。**v692 已修计量**：旧 `ai_usage` 记的是用户打字字数（差约 3000 倍，配额形同虚设）⇒ 代理层 `_UsageTap` 旁路读 SSE 末尾的 `usage`（**只读不改、不碰字节级透传红线**）落 `ai_usage_v2`。三条口径别改猜：① 一次请求**只发一个** usage 块且是**整个 agent 循环的累计值** ⇒ 一次请求落一行、**绝不按 chunk 累加**；② `prompt_tokens` = 未缓存+缓存命中，可作用量但**不能乘全价算成本**（高估约 40 倍）；③ usage 里**没有** cached_tokens。**第 1 期只加读数不切拦截**（`exceeded` 仍按字符判）—— token 阈值是定价问题，贸然切会让 tenant 1 月中 429。模型选择曾于 2026-09-25 撤下，根因=网关无 `model_routes`（切了静默回落），恢复**必须先改网关**，判据三条：新模型名进 `session_model_usage` / 两次 `estimated_cost_usd` 不同 / `prompt_tokens` 不变（**只验回显不算**）。Hermes 库 `api_server` 会话 `user_id` 全 NULL ⇒ 归因只能在代理层。方案见根目录《大模型对话三点改进方案-2026-10-26.md》。
历史交付（P1-4 告警、P1-5 审计、consignment）→ `topics/backend-invariants.md`。
