# Hergent 项目长期记忆（索引）

> **本页只回答「该读哪一份」** —— 判据全文 / 解释 / 证据 / 脚本名一律在 `memory/topics/`，动手前点进去读。
> ⚠️ 注入有上限，超了**静默截断**（截掉末尾路由）⇒ 只留「路由 + 触发词 + 最贵判据」。**超 6KB 就瘦身**（09-19 20.4→11K、09-20 16.6→3.5K、09-21 11.3→5.5K；🔴 09-21 实测 **11.3KB 仍被完整注入** ⇒ 原 4KB 上限过严，改 6KB 留边际；再压会伤判据主干）。

## 一、路由（改哪个面 → 读哪份）

- **前端**（页面/样式/表格/探针/数字格）→ `topics/frontend-ui.md`
  · 全屏图层 ⇒ 页头控件**物理不可达**，须**层内**补副本；让位三条件缺一 = **死按钮不报错**
  · v214-A 数字格病根在**输入层**：`type=number` 静默加工、`NFKC` 不折 `。`
  触发：全屏 · 工具栏 · 表格 · 数字格 · 全角数字 · 文字不居中
- **后端**（路由/数据/DB/权限/账号/报 500）→ `topics/backend-invariants.md` + `backend-auth.md`
  · RBAC 在最外层 ⇒ `_check_perm` 时**还没租户**，须显式传 `tenant_id=`
  · v211b 参数错回 500 = `ValidationError` ≠ `RequestValidationError`；v211 索引须**表与索引同行**
  · v213/v215 **恒空恒 0 且零报错 = 静默失效**（时区两环境方向相反 / 参数名错 / 裸 `except`）
  触发：权限 · 开账号 · 列权限 · 报 500 · 参数校验 · 索引 · 时区 · 乐观锁
- **部署 / 构建 / 上线 / 回读 / 旧前端 `static/`** → `topics/deploy-ops.md`
  · **md5 一致只证明「传输没坏」** ⇒ 补验**产物 mtime ≥ 源码 mtime**；改过源码须重核
  · v214b 差集收口用**第⑥层 token 对齐**：注释也改 scopeId ⇒ 标识符整体重编号，等长替换**不是夹带**
  触发：构建 · 上线 · 回读 · 差集 · scopeId · 重编号
- **预报主表 / 期次 / 导入 / 到货周期 / 报单基准 / 价格单位** → `topics/forecast-order-domain.md`（最长）
  · 口径类缺陷**先问当初拍板的口径**；**崩溃时机即分类器**（点删才崩=字段缺失 / 进页即崩+栈溢出=自递归）
  · v215 报单基准 = **期次商品清单**非档案，三处走同一函数
  · v217 **先分「导入放大」还是「页面放大」**（`priceAuto=厂价×规格`，厂价=**元/箱**）；单位被改 = 档案优先 + 回填**只补空不覆盖**
  触发：预报 · 期次 · 定稿 · 合计(箱) · 导入顺序 · 单价 · 价格放大 · 单位被改
- **返利 / 目标** → `topics/rebate-domain.md`｜**货损 / 效期**（先分 `/loss` vs `/loss-accounting`）→ `topics/expiry-loss-domain.md`
- **报单 / 小程序 / 品牌 / 员工账号 / 提审** → `topics/miniprogram-and-brand-data.md`
  · **「能登录」≠「能干活」**：认证 `/api/auth` 豁免 RBAC、业务走模块中间件；角色缺 `data` ⇒ 每动作 403
  · v211 重开账号须先改名+停用旧的；新账号 `password_changed=0` = **首登强制改密**，密码 **≥8**
  触发：报单 · 门店范围 · 提审账号 · 首登改密 · 员工档案 · 收回门店
- **副驾 / AI 落点** → `topics/ai-copilot.md`（算·录·判·说；名带 `ai_` ≠ 用了 AI）｜**通知 / 工资条** → `topics/notification-center.md`
- **IM 渠道** → `topics/im-channels-v131.md`｜**业绩 / 提成 / 龙虎榜** → `topics/sales-reports-and-operator-attribution.md`
- **对账 / 流水 / 催收** → `topics/reconciliation-redo.md`｜**键对账 ≠ 账户对账**；**人工报告不是黄金标准** ⇒ 验收 = **逐笔可解释**
- **新用户首次使用 / 建档门禁（v218）** → `topics/onboarding-and-archive-gate.md`｜拦写入不拦浏览、隐式建档优先；🔴 六类档案之外还有**员工 + `report_mapping`** = 预报第一硬门槛
  触发：新用户 · 上手 · 建档前置 · 空状态 · onboarding · 孤儿单
- 🔴 **跨域铁律 → `topics/cross-domain-iron-laws.md`** ← 动手前先扫一遍
- **对外材料** → `outputs/德邻杯-AI创业大赛-2026-09-19/02-脱敏口径清单.md`（金额→复杂度 · 截图用演示租户）

## 二、技能路由 → `topics/skill-routing.md`（11 组；含沙箱 `tools/sandbox_tenant.py`）

## 三、编号约定（⚠️ 起号前必做）

已用到 **v218**（v218 新用户+建档前置只读未修；v217 价格/单位口径未修；v216 收回门店写端；v211b →422）。起号前必查 `grep -rn -e "v20X" -e "V20X" memory/ .workbuddy/tools/`（多模式**必须 `-e`**）。撞号 = 源码十几处 + 报告 + 记忆 + **一次重建重部署**。

## 四、战略 / 主体

- hergent.cn = AI 经营副驾｜前端 hergent-cn-v2（Vue3+Vite，仓库 `laozhangai-product`，生产 `/opt/hergent-cn-v2`）｜后端 hergent-erp（FastAPI+SQLite `:8700`，生产 FLAT `/opt/hergent-erp`）。
- 战略 = **不造 ERP**，坐客户 ERP 之上做分析/顾问/副驾；数据走 Excel/CSV 或连接器；订单 CRUD 冻结。护城河 = 配方算法 + 副驾交互。
- 主体 = 湖北省小赫智体数字科技（**经营范围无食品**），法人张俊峰，`91420606MAKF1YPG5Y`｜用户 = 蒙牛低温奶经销商，**不懂代码**｜脱敏红线：返利率 / 进货价 / 客户名 / 区域销量 / 厂家政策。

## 五、本机坑

`grep "A\|B"`、`--include=*.py` **静默失效** → 用 Grep 工具或 `-e A -e B`｜写文件一律用 **Write**（heredoc 含 `${}` 会失败）｜UI **数字必须带中文单位**（`pp` → 百分点）
