# Hergent 项目长期记忆（索引）

> **本页只回答「该读哪一份」** —— 判据全文 / 解释 / 证据 / 脚本名一律在 `memory/topics/`，动手前点进去读。
> ⚠️ 注入有**上限，超了会被静默截断**（截掉的是本页末尾路由）⇒ 只留「路由 + 触发词 + 一条最贵判据」。
> **每加一个版本判据涨 1–2KB ⇒ 超 4KB 就主动瘦身**（瘦身史 09-19 20.4→11KB、09-20 16.6→3.5KB；⚠️ 现约 9KB，**待瘦身**）。

## 一、路由（改哪个面 → 读哪份）

- **前端**（页面 / 样式 / 表格 / 探针 / 数字格输入）→ `topics/frontend-ui.md`（v151–**v214** 齐备）
  最贵判据：**全屏图层会让页头控件物理不可达**（`elementFromPoint` 命中外层空元素）⇒ 必须在**层内**补副本；让位判据三条件缺一不可（漏 `!crossLoading` = 两边同时无入口 = **死按钮、不报错**）。
  最贵判据 ②（v214-A）：**数字格的病根在输入层，不在校验层** —— `<input type=number>` 会**静默加工**（用户看不到异常）；且 **NFKC 不折 `。`U+3002** = 小数点打不出来的真凶。技能 `hergent-numeric-input-ime-tolerance`。
  触发：全屏 · 工具栏 · 改单 · 图标 · 表格样式 · 单元格选中 · 方向键跳格 · 探针坐标 · 文字不居中（**小程序 button 内置 `line-height:2.55555556`，height 没配 line-height 必偏上 (height−lh)/2**）· **全角数字 · 输入法容错 · 小数点打不出来 · 填了没生效**
- **后端**（路由 / 数据 / DB / 权限 / 账号 / 报 500）→ `topics/backend-invariants.md` + `topics/backend-auth.md`
  最贵判据：**RBAC 中间件在最外层 ⇒ 调 `_check_perm` 时还没有租户** ⇒ 必须显式传 `tenant_id=`，且先 `check_user_tenant`（`set_tenant_context` 会**建库** ⇒ 盲信请求头 = 建库放大）。
  最贵判据 ②（v211b）：**「参数错误却回 500」= 手工 `Model(**d)` 抛的是 `pydantic.ValidationError`，与 FastAPI 的 `RequestValidationError` 不是同一类** ⇒ 落 `Exception` 处理器 ⇒ 用户看到"服务器坏了"。一处修 = 补一个异常处理器。
  最贵判据 ③（v211）：**新表索引要"表与索引同行"** —— `db.indexes` 在 import 期就跑完（早于建表），且 `_create_indexes_on` 逐条 `except: pass` **静默跳过、不报错**。
  最贵判据 ④（v213/v215）：**「恒空 / 恒 0 且零报错」= 静默失效**，三种形态同源 —— `created_at` 生产 UTC / 本机 localtime（同一「与 now() 比」的判据**两环境方向相反**，时区判据必须**显式构造**）；`rev` 恒空（参数名写错 ⇒ 乐观锁永不触发）；`avg_daily_sales` 恒 0（`IN ({ph})` 少传参数 ⇒ 被**裸 `except`** 吞）⇒ **正面断言它非空/非 0；兜底赋默认值必须留痕**。
  触发：角色/权限 · 主管 · 开账号 · 列权限 · 按租户 · 会计能算工资 · 有哪些租户 · 报 500 · 改密失败 · 参数校验 · 新表索引 · 时区 · created_at · 乐观锁 · 409 冲突 · 指纹非空 · **重启的是 `hergent-erp` 不是 `hergent-server`**
- **部署 / 构建 / 上线 / 回读 / 旧前端 `static/`** → `topics/deploy-ops.md`
  最贵判据：**md5 双侧一致只证明「传输没坏」** —— 既不证明「产物是新的」（验收三件套 = 源码形态 + 产物形态 + **产物 mtime ≥ 源码 mtime**），**也不证明「现在仍一致」**（部署后又改了源码 ⇒ 必须重核）。`dist/` 是共享可变产物 ⇒ 发布前必做差集。
  最贵判据 ②（v214b）：**差集收口用第⑥层 token 对齐**（`tools/dist-token-align.py`：token 数相同 + 非 id 差异全可归约 + id 一对一）—— **注释改动也会改 scopeId（`hash(路径+源码)`）并让压缩标识符整体重编号**（实测 540/756 处），「等长替换 + `e3`→`e6`」是常态**不是夹带**。
  触发：构建 · 上线 · 回读 · 差集 · dist · scopeId · **标识符重编号 · 第⑥层**
- **预报主表 · 期次 · 导入登记 · 到货周期 · 报单商品基准 · 导入后价格/单位** → `topics/forecast-order-domain.md`（最长，v190–v217）
  最贵判据：**口径类缺陷先问「当初拍板的口径是什么」，再回读实现**（v207 合计(箱) 是**实现反了**）；**崩溃时机就是分类器**（点删除才崩 = 字段缺失/越界；进页面即崩 + 栈溢出 = 自递归 accessor）。
  最贵判据 ②（v215）：**报单商品基准 =「期次商品清单」（`forecast_import_products`），不是商品档案**（档案里很多赠品不报单）⇒ 小程序铺开 / 提交放行 / Web 汇总行底**三处必须走同一函数**（`forecast_period_product_ids` + `forecast_period_scope_sql`），排序键也逐字同构（`sort_no>0 优先 → sort_no → id`）；⚠️ `sort_no=0` 的期次顺序 = 导入 id 升序，**不是模板行序**。
  最贵判据 ③（v217）：**「导入后数字被放大」先分清是「导入放大」还是「页面放大」** —— 实测模版**零公式**、导入侧原样透传，放大出自 `Forecast.vue priceAuto = 厂价 × perCase(规格)`（99×10=990）；且**厂价口径 = 元/箱**（后端 `本期需付款 = 箱数 × 厂价`；`厂价 ÷ 分销价 = 规格 × 0.9` 7/7 全中可反推）。**「单位被改写」= 主表取档案优先 + `product_backfill_from_import` 只补空不覆盖**（静默丢弃，回执只写「复用 N 个」）⇒ 单位有「档案基本单位」与「报单单位」两个概念，主表取档案、舟谱下单文件取明细。
  触发：预报 · 改单 · 期次 · 定稿 v205 · 合计(箱) · 退出编辑 v208 · 导入顺序 · 单价 · 到货周期 · **小程序商品数不一致 · 154 vs 285 · 以档案还是以清单 · 顺序对不上** · **价格被放大 · 99 变 990 · 厂价是元/箱还是元/桶 · 单位被改 · 条变件 · 只补空不覆盖**
- **返利 / 目标** → `topics/rebate-domain.md`｜**货损 / 效期**（先分 `/loss` vs `/loss-accounting`）→ `topics/expiry-loss-domain.md`
- **报单 / 小程序 / 品牌 / 员工账号 / 提审账号** → `topics/miniprogram-and-brand-data.md`（隐私申报末节：**多申报与少申报都判风险**；末节「提审账号终态」；**v216 末节：「收回门店」入口** —— 🔴 **「停用配置」≠「收回」**：前改 `report_mapping.is_active`（可再启用）、后 `DELETE employee_stores` 单行（删了没了），两者**都只影响"还能不能报单"、都不删客户与历史报单**）
  最贵判据（09-20 审计）：**「能登录」≠「能干活」** —— 认证走 `/api/auth`（RBAC 豁免）、业务走中间件**模块**；角色缺 `data`（accountant/guide/driver）⇒ 登录成功、每动作 403。先画「角色×端点」矩阵（`tools/mp-role-endpoint-matrix.py`）；提审前必检 `/stores` 非空 —— ⚠️ 载荷键是 **`stores`**（不是 `items`），按 `items` 解析会误报「空」（已踩）。
  最贵判据 ②（v211）：**「重开账号」=`staff_account_create` 双向拒绝 ⇒ 必须先改名+停用旧账号**；新账号 `password_changed` 默认 0 = **首登被强制改密**（提审必卡）。**密码合法长度是「≥8」**（旧的「≤8」已被 `bcrypt2$` 预哈希解除，提审材料那条警告已过时）。
  触发：报单 · 门店可见范围 · `/stores` 空 · 提审账号 · 重开账号 · 密码长度 · 首登改密 · 员工档案 · 报单配置 report_alias · **商品清单口径**（见上条 v215）· **历史脏行/空白员工名**（🔴 先判「有没有唯一持有者」再决定补/删：删 `report_mapping` 一行会**连带删掉导入模板里的一列**）
- **副驾提示词 / AI 真实落点** → `topics/ai-copilot.md`（**算·录·判·说 四类分工** · 名带 `ai_` ≠ 用了 AI）｜**通知 / 工资条** → `topics/notification-center.md`
- **IM 渠道** → `topics/im-channels-v131.md`｜**业绩 / 提成 / 龙虎榜** → `topics/sales-reports-and-operator-attribution.md`
- **对账 / 收付账户 / 流水 / 催收跟进** → `topics/reconciliation-redo.md`
  最贵判据：**键对账 ≠ 账户对账**；**人工报告不是黄金标准**（回放抓出报告自身 4 处错）⇒ 验收 = **逐笔可解释**，不是「与报告数字相同」。
- 🔴 **跨域铁律 → `topics/cross-domain-iron-laws.md`** ← 动手前先扫一遍
- **对外材料**（BP / 路演 / 视频号 / 客户沟通）→ `outputs/德邻杯-AI创业大赛-2026-09-19/02-脱敏口径清单.md`（金额→复杂度 · 截图用**演示租户**）

## 二、技能路由（user-level）

→ `topics/skill-routing.md`（11 组分类；含沙箱工具 `tools/sandbox_tenant.py`）

## 三、编号约定（⚠️ 起号前必做）

本序列**已用到 v217**（v217 = 导入价格/单位口径诊断，未修）；v216 = 「收回门店」写端；v211b = `pydantic.ValidationError`→422；v203 / v205 / v206 曾被**同日其它会话**占用。
**起号前必查** `grep -rn -e "v20X" -e "V20X" memory/ .workbuddy/tools/`（多模式**必须 `-e`**）。撞号成本 = 源码十几处 + 脚本 + 报告 + 记忆 + **一次重建重部署**。改号脚本 `tools/v207-renumber.py`。

## 四、战略 / 主体

- hergent.cn = AI 经营副驾（同源 erp.hergent.cn）。前端 hergent-cn-v2（Vue3+Vite+Pinia，仓库 `laozhangai-product`，生产 `/opt/hergent-cn-v2`）｜后端 hergent-erp（FastAPI+SQLite `:8700`，生产 FLAT `/opt/hergent-erp`）。desktop-app 冻结。
- 战略 = **不造 ERP**，坐客户 ERP 之上做分析 / 顾问 / 副驾；数据走 Excel/CSV 或连接器；订单 CRUD 冻结。护城河 = 配方算法 + 副驾交互。
- 主体 = 湖北省小赫智体数字科技有限公司（**经营范围无食品**），法人张俊峰，`91420606MAKF1YPG5Y`。
- 用户 = 蒙牛低温奶经销商，**不懂代码**。北极星 = 加微信的经销商人数；脱敏红线：返利率 / 进货价 / 客户名 / 区域销量 / 不评厂家政策。

## 五、本机坑

`grep "A\|B"`、`--include=*.py` **静默失效** → 用 Grep 工具或 `-e A -e B`｜写文件一律用 **Write**（heredoc 含 `${}`/反引号会失败；脚本里别用模板串）｜给用户的 UI **数字必须带中文单位**（`pp` → 百分点，详见 user-level 记忆）
