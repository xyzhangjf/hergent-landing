# Hergent 项目长期记忆（索引）

> **本页只回答「该读哪一份」** —— 判据 / 触发词 / 全文一律在 `memory/topics/`，动手前点进去读。

## 一、路由（改哪个面 → 读哪份）

- **前端**（页面 / 样式 / 表格 / 探针）→ `topics/frontend-ui.md`
- **后端**（路由 / 数据 / DB / 权限 / 登录账号）→ `topics/backend-invariants.md` + `topics/backend-auth.md`
  （🔴 **角色 / 权限清单缺条目 ⇒ 静默失败**：`MAP[x] || x` 形状会把「缺配置」显示成「正常英文值」；
  权威源 ＝ `core.py::_DEFAULT_PERMS`（**AST** 取 key），护栏 `.workbuddy/tools/role-registry-consistency-check.py`。
  触发词：角色下拉 · 主管/supervisor · 开账号 · 改角色 · 列权限 COLUMN_PERMISSIONS）
- **部署 / 构建 / 上线 / 回读 / 旧前端 `static/`** → `topics/deploy-ops.md`
  （🔴 验「后端路由是否已删 / 已加」**禁用 HTTP 状态码** —— 中间件在路由之前拦，三者均与路由存在性无关；
  权威判据 ＝ `/openapi.json` + 同前缀**成对**对照；工具 `.workbuddy/tools/backend-route-removal-verify.py`）
- **预报主表 · 期次 · 导入登记 · 到货周期** → `topics/forecast-order-domain.md`
  （触发：单价(厂价/箱) v191/v191b · 到货周期列 v192 · 导入门禁 v193 · 🔴 改单删列与保存失败 v194/v194b/v195/v196/v197 ·
   **条码重复判据 v178 → v196** · **品牌归并 v196**（福宝/恒滋 → 蒙牛低温）· 只发改动行 v196）
  ⚠️ **编号撞车**：此处的 v197 = **改单删列序列**（v195 甲→v196 乙→v197 丙），
  **不是** `reconciliation-redo.md` 里的 v197/v198（对账）。该序列下次请从 **v199** 起编。
  🔴 **v197 三条必背**：① `idx_products_barcode` 是**普通索引非 UNIQUE**（`v89` 迁移被 `_safe_migrate` 静默跳过）
  ＝同条码多行的**根因** ② `dismissed` 独立状态的真正理由 ＝ **`resolved` 一个状态两个含义**
  （被忽略的品牌**不在** `brands`，混用则「品牌几条/待审剩几条」再也算不清）③ **商品匹配是「条码优先」**——
  多规格共用条码时会把「24瓶」写进「6组」那行 ⇒ 匹配顺序（`条码+名称`→`条码`→`名称`）**待拍板未修**
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

## 二、技能路由（38 条 user-level）

→ **`topics/skill-routing.md`**（按「上线构建 / 新模块 / 预报与 Excel / 前端故障 / 样式 / 小程序 /
数据与库 / 诊断族 / **对账资金流水** / 门禁网关 / 文档表格」分组，含沙箱工具与「技能库待整理」提示）

## 三、战略 / 主体

- hergent.cn = AI 经营副驾（同源 erp.hergent.cn）。前端 hergent-cn-v2（Vue3+Vite+Pinia，仓库 `laozhangai-product`，生产 `/opt/hergent-cn-v2`）｜后端 hergent-erp（FastAPI+SQLite `:8700`）。desktop-app 冻结。
- 战略 = **不造 ERP**，坐客户 ERP 之上做分析 / 顾问 / 副驾；数据走 Excel/CSV 或连接器；订单 CRUD 冻结。护城河 = 配方算法 + 副驾交互。
- 🔴 **不做「一切皆插件」**：扩展作者是 **AI 代填**而非客户写码。顺序 P0-a → P0-b → P1 → P2 → P3。
- 主体 = 湖北省小赫智体数字科技有限公司（**经营范围无食品**），法人张俊峰，`91420606MAKF1YPG5Y`。用户 = 蒙牛低温奶经销商，不懂代码。北极星 = 加微信的经销商人数；脱敏红线：返利率 / 进货价 / 客户名 / 区域销量 / 不评厂家政策。

## 四、本机 zsh 坑

`grep "A\|B"`、`--include=*.py` **静默失效** → 用 Grep 工具或 `-e A -e B`｜写文件一律用 **Write**（heredoc 含 `${}` / 反引号会失败）｜给用户的 UI **数字必须带中文单位**（`pp` → 百分点，详见 user-level 记忆）
