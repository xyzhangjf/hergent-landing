# Hergent 项目长期记忆（索引）

> **本页只回答「该读哪一份」** —— 判据 / 触发词 / 全文一律在 `memory/topics/`，动手前点进去读。

## 一、路由（改哪个面 → 读哪份）

- **前端**（页面 / 样式 / 表格 / 探针）→ `topics/frontend-ui.md`
- **后端**（路由 / 数据 / DB / 权限 / 登录账号）→ `topics/backend-invariants.md` + `topics/backend-auth.md`
  （🔴 **角色 / 权限清单缺条目 ⇒ 静默失败**：`MAP[x] || x` 形状会把「缺配置」显示成「正常英文值」；
  权威源 ＝ `core.py::_DEFAULT_PERMS`（**AST** 取 key），护栏 `.workbuddy/tools/role-registry-consistency-check.py`（**28 条**）。
  触发词：角色下拉 · 主管/supervisor · 开账号 · 改角色 · 列权限 COLUMN_PERMISSIONS）
  ✅ **v199-ui 已修（fe `09714bd` / be `cb69a5d`，spec `fe-v199-roles`+`be-v199-roles`）**：
  「小程序账号」文案→「**登录账号**」+ 角色下拉补**适用端**标注 · 开账号/改角色接
  `core.normalize_role` 白名单（`known_roles() = _DEFAULT_PERMS ∪ ROLE_PERMS`，判据只写一份）·
  三处漂移收敛（Forecast 列权限/填报白名单改规范角色名 · 小程序补 3 角色 · 回落改显式 `未知角色(x)`）。
  🔴🔴 **三条必背**：① **`normRole` 只做词汇归一（owner→boss），≠ 把后端不存在的名字变成有效权限** ——
  归一 ≠ 授权 ② **前端列级权限目前是空转的**（全仓无人给 `store.user.role` 赋值；且只是展示级隐藏，
  真隔离必须在后端）③ 「标了小程序」的角色集 **必须 ==** 后端有 `data`/`chat` 权限的集合
  （否则用户会按标注去开一个「开了也登不进去」的账号）。
  ⚠️ 未解：白名单**不阻止 admin/boss 给别人派 admin**（策略问题）· `submission_summary` 名单含
  `accountant` 但 `accountant` 无 `data` 权限 ⇒ 会计点「汇总总表」在**中间件**就 403（两处判据互相矛盾）
- **部署 / 构建 / 上线 / 回读 / 旧前端 `static/`** → `topics/deploy-ops.md`
  （🔴 验「后端路由是否已删 / 已加」**禁用 HTTP 状态码** —— 中间件在路由之前拦，三者均与路由存在性无关；
  权威判据 ＝ `/openapi.json` + 同前缀**成对**对照；工具 `.workbuddy/tools/backend-route-removal-verify.py`）
  🔴 **前端铁律（v199c 血的教训）：改完源码必须重建产物再部署** ——
  **md5 双侧一致只证明「传输没坏」，不证明「产物是新的」**（两侧一致完全可以是"都是旧的"）。
  验收三件套缺一不可：**源码形态 ✅ + 产物形态 ✅ + 产物 mtime ≥ 源码 mtime ✅**
  （护栏 `.workbuddy/tools/v199b-invariant-check.mjs` 的 **I6** 就是拦这条）；
  动过页面就必须**真机冒烟**（`hergent-forecast-smoke.mjs`），不能让用户当测试员
- **预报主表 · 期次 · 导入登记 · 到货周期** → `topics/forecast-order-domain.md`
  （触发：单价(厂价/箱) v191/v191b · 到货周期列 v192 · 导入门禁 v193 · 🔴 改单删列与保存失败 v194/v194b/v195/v196/v197 ·
   **条码重复判据 v178 → v196** · **品牌归并 v196**（福宝/恒滋 → 蒙牛低温）· 只发改动行 v196 ·
   🔴 **客户列「删了又回来」v199**（**读端来源 ≠ 写端作用域** · 新表 `forecast_hidden_units` · 删列**可逆**））
  ⚠️ **编号撞车**：此处的 v197 = **改单删列序列**（v195 甲→v196 乙→v197 丙→v199 隐藏名册→**v199b/v199c 连续两次点崩**），
  **不是** `reconciliation-redo.md` 里的 v197/v198（对账）。**该序列已用到 v199c，下次从 v200 起编。**
  🔴 **v197 三条必背**：① `idx_products_barcode` 是**普通索引非 UNIQUE**（`v89` 迁移被 `_safe_migrate` 静默跳过）
  ＝同条码多行的**根因** ② `dismissed` 独立状态的真正理由 ＝ **`resolved` 一个状态两个含义**
  （被忽略的品牌**不在** `brands`，混用则「品牌几条/待审剩几条」再也算不清）③ **商品匹配是「条码优先」**——
  多规格共用条码时会把「24瓶」写进「6组」那行 ⇒ 匹配顺序（`条码+名称`→`条码`→`名称`）**待拍板未修**
  🔴 **客户列「删了又回来」v199（✅ 已修并上线）**：客户列 = 后端 **`all_units` 全历史名册**（不按期次/角色），
  而保存（`save_matrix`）**只清本期 `role='导入'`** ⇒ **非导入角色的历史报单永远锚住该列**；
  且 `status != 'rejected'` **恒为真**（全库 `rejected` 0 行 + `_reject` 已于 2026-09-07 删除）⇒ 当时**界面无任何路径能删掉一列**。
  ✅ **修法（v199）**：新表 `forecast_hidden_units`（**租户级，与 `all_units` 同口径**）+ 名册加 `NOT EXISTS` 过滤 +
  `save_matrix` 接 `hidden_customers`（**双向**：隐藏 / 加回=反向 `DELETE`）+ 前端 `cross.hiddenUnits` 待提交集合。
  **删列从此可逆**（旧实现删了就加不回来）；口径同步对齐 `NOT IN ('rejected','recalled')`（连带修掉往期看板漏 `recalled` ⇒ 期次 9 件数 33→4）。
  **判据：读端来源 ≠ 写端作用域 ⇒ 删了必然回来**（根治 = 给「删」一个与读端**同口径**的持久化载体）。
  幽灵表 `forecast_col_schemes`（0 行、零引用）= 当年没做完的一半，v199 补的正是它的另一半。
  🔴 **v199b（v199 上线当天被点崩，已修）**：给 `cross` 加字段只补了 **5 处整体赋值中的 1 处** ⇒
  走「有草稿」分支时 `hiddenUnits` 缺失，`delCol` 的 `.includes` 抛错 ⇒ `ErrorBoundary` 整页「页面出错了」；
  同一族还有 v197 那个 watch 读 `cross.value.units.length`，在「删当期期次」（那处赋值只给 `rows`）时崩。
  ⇒ **铁律：改 `cross` 必 `grep "cross.value = "` 逐处确认**；形状只留 `blankCross()` 一个来源 +
  accessor（`hiddenUnits()` / `unitCount()`）；护栏 `.workbuddy/tools/v199b-invariant-check.mjs`（13 断言）。
  ⚠️ **SFC 编译校验发现不了「运行期字段缺失」**（当时全绿）；「页面出错了」**先读 ErrorBoundary 的灰字**（= `err.message`）
  🔴 **v199c（同日第三次：点侧栏进来就崩 `Maximum call stack size exceeded`，已修）**：**崩溃时机就是分类器** ——
  「点**删除**才崩」= 字段缺失/越界；「**进页面即崩** + 栈溢出」= **自递归 accessor**。
  两条根因：**A** `unitCount()` 兜底写成 `? unitCount() : 0`（**没有出口**；产物形态 `? ae() : 0`）
  ⇒ **accessor 的兜底分支绝不能回落自己**（症状与它要防的那个一模一样）；
  **B** 🔴 **源码改对了、产物没重建** —— `dist/` 停在修复前那次构建 ⇒ rsync 上去仍是旧 chunk，
  而 **build 成功 / rsync 0 / md5 双侧一致 / 公网 200 全绿**。
  ⇒ **md5 一致只证明「传输没坏」，不证明「产物是新的」**；**「源码正确」≠「线上正确」**。
  护栏升到 **16 断言**（`v199b-invariant-check.mjs`：+I5 源码无自递归 · +I6 产物无自递归 **+ 产物 mtime ≥ 源码 mtime**）；
  工具 `self-recursion-scan.mjs` · **真机冒烟 `hergent-forecast-smoke.mjs`**（系统 Chrome + `puppeteer-core`，
  **不下载 Chromium**；`HG_EDIT=1` 复现删列动作）。
  🔴 **铁律：改过 `Forecast.vue` 就必须真机跑一次冒烟** —— 同类事故三次，**编译/构建/静态校验全绿、只有真跑才炸**
- **返利 / 目标** → `topics/rebate-domain.md`
- **货损 / 效期**（`/loss` vs `/loss-accounting` 先分清）→ `topics/expiry-loss-domain.md`
- **报单 / 小程序 / 品牌 / 员工账号** → `topics/miniprogram-and-brand-data.md`
  （隐私申报红线在该文件末节：**多申报与少申报都判风险** · **小程序无 CLI 构建** ⇒ 静态核对 + 手点编译）
- **副驾提示词 / 🔴 AI 在产品里的真实落点** → `topics/ai-copilot.md`
  （**算 · 录 · 判 · 说 四类分工** · **名带 `ai_` ≠ 用了 AI** · 对账：比对归确定性代码，确认归人）
  ｜**通知 / 工资条** → `topics/notification-center.md`
- **IM 渠道** → `topics/im-channels-v131.md`
  ｜**业绩 / 提成 / 龙虎榜** → `topics/sales-reports-and-operator-attribution.md`
- **对账 / 收付账户 / 银行·微信·支付宝流水 / 催收跟进** → `topics/reconciliation-redo.md`
  （触发：对账 · 账户明细 · 舟谱流水 · 差异归因 · 补录 · 冲销 · `/collections` · `/reconciliation`）
  🔴 **三条先记住**：① 旧三步向导 v197 已撤、**后端 `/api/reconciliation/*` 暂留不删**、催收已独立成页
  （514 次真实调用）② **系统侧没有资金流水**（`cash_flow` 16 行、`bank_*` 三表 0 行、`accounts.code` 全空）
  ⇒ 形态是**「上传 A vs 上传 B」** ③ **真源在 `~/Documents/流水对账/`**（9 源 + 8 脚本 + 15 报告），
  重做 = 产品化它，不是从零设计
  ✅ **P0 已落地 v198（提交 `9bcdb11`）**：`server/recon_engine.py`（788 行纯标准库无 IO，7 项能力）+
  `server/tests/test_recon_engine.py`（45 断言全绿）+ `mcp/` 入库；真实数据逐笔回放一致。
  🔴 **两条必背判据**：**(a) 键对账 ≠ 账户对账**（真实渠道流水无共同单号 ⇒ 账户对账禁用 `spreadsheet_reconcile_files`）；
  **(b) 人工报告不是黄金标准** —— 本轮回放抓出报告自身 4 处错（同额同日漏配 / 退款符号误记 / 组合漏配），
  验收口径 = **逐笔可解释**而非「与报告数字相同」
- 🔴 **跨域铁律（触发词清单全文）→ `topics/cross-domain-iron-laws.md`** ← 动手前先扫一遍
- **对外材料**（BP / 路演 / 视频号 / 客户沟通 / 赛事报名）→
  `outputs/德邻杯-AI创业大赛-2026-09-19/02-脱敏口径清单.md`（金额→复杂度 · 截图用**演示租户**）

## 二、技能路由（user-level）

→ **`topics/skill-routing.md`**（按「上线构建 / 新模块 / 预报与 Excel / 前端故障 / 样式 / 小程序 /
数据与库 / 诊断族 / **对账资金流水** / 门禁网关 / 文档表格」分组，含沙箱工具与「技能库待整理」提示）

## 三、战略 / 主体

- hergent.cn = AI 经营副驾（同源 erp.hergent.cn）。前端 hergent-cn-v2（Vue3+Vite+Pinia，仓库 `laozhangai-product`，生产 `/opt/hergent-cn-v2`）｜后端 hergent-erp（FastAPI+SQLite `:8700`）。desktop-app 冻结。
- 战略 = **不造 ERP**，坐客户 ERP 之上做分析 / 顾问 / 副驾；数据走 Excel/CSV 或连接器；订单 CRUD 冻结。护城河 = 配方算法 + 副驾交互。
- 🔴 **不做「一切皆插件」**：扩展作者是 **AI 代填**而非客户写码。顺序 P0-a → P0-b → P1 → P2 → P3。
- 主体 = 湖北省小赫智体数字科技有限公司（**经营范围无食品**），法人张俊峰，`91420606MAKF1YPG5Y`。用户 = 蒙牛低温奶经销商，不懂代码。北极星 = 加微信的经销商人数；脱敏红线：返利率 / 进货价 / 客户名 / 区域销量 / 不评厂家政策。

## 四、本机 zsh 坑

`grep "A\|B"`、`--include=*.py` **静默失效** → 用 Grep 工具或 `-e A -e B`｜写文件一律用 **Write**（heredoc 含 `${}` / 反引号会失败）｜给用户的 UI **数字必须带中文单位**（`pp` → 百分点，详见 user-level 记忆）
