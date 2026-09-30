# Hergent 项目长期记忆（索引）

> 只答「该读哪一份」（全文在 `memory/topics/`）｜🔴 硬限额 14848 B，超限即截断 ⇒ 新增先下沉等量。

## 一、路由

- **前端**（页面/样式/表格/数字格）→ `topics/frontend-ui.md`
  · 全屏图层 ⇒ 页头控件**物理不可达**须层内补副本；让位三条件缺一 = 死按钮；数字格病根在输入层（`type=number`／`NFKC` 不折 `。`）
  · 🔴 撤入口 ≠ 撤路由：`v-if` 只藏 DOM ⇒ 手敲 URL 照样进 = 假封锁 ⇒ 受限页挂 `meta.roles` + `roleIn()`
  · 🔴 **v291 入口可见性唯一源 = `constants/pages.js`**（`module`×`roles`）；未登记返 `null` ⇒ `canSee` **fail-open** = **漏登记即失门禁**
  · 🔴 **v296**：`roleIn`「未知」两判（空串放行／真未知收紧）；`data` 拆出 `cron`/`bid`
  · 🔴 **v300**：员工档案角色下拉 = **动态值域**（403 静默降级）；「适用端」唯一源 = `ROLE_END`（判据**仅 `data`**）；⚠️ hash 路由 ⇒ 深链必带 `/#/`（否则落回默认页）
  · 🔴 **v331/338/339** 界面文案禁实现细节／复述眼前物／**内部枚举值渲染** ⇒ 技能 `hergent-ui-copy-guard`；体检 H 面强制
  · 🔴 **v335** 页内按钮门禁 `canDo(模块,动作)`：三态 fail-open；**模块键错 ⇒ 整页按钮消失**（fail-closed，护栏锁值域）
  触发：全屏 · 工具栏 · 表格 · 数字格 · 不居中 · 路由守卫 · 假封锁 · 入口可见性 · hash 路由 · 界面文案 · 页内门禁 · 状态色
- **后端**（权限/账号/DB/报 500/**路由遮蔽**）→ `topics/backend-invariants.md` + `backend-auth.md`
  · 🔴 **v317** 路由遮蔽：同路径**先注册者胜** ⇒ 加字段前必验生效的是哪份
  · RBAC 在最外层 ⇒ `_check_perm` 时还没租户，须显式传 `tenant_id=`；参数错回 500 = `ValidationError` ≠ `RequestValidationError`
  · 🔴 恒空恒 0 且零报错 = 静默失效 ⇒ `tools/undefined-call-scan.py`；读数「碰巧对」⇒ 先问「恒定值是否恰好等于当前事实」
  · 🔴 静默洞三条：**只下发表不下发索引**（登记 `indexes.py::INDEX_SQLS`）／**窗口当主键**（v279）／**白名单漏字段**；SQLite DDL 是事务性的 ⇒ 建表须 `get_db_tx()`
  · 🔴 **幽灵 inode**：换库+连接缓存 ⇒ 句柄仍指已删 inode ⇒ **先删后重启**；🔴 `DB_PATH` **两份** ⇒ 影子库**两处都 patch**（v289）
  · 🔴 **代码默认 vs 租户覆盖**（v293/312/**325**）：`_DEFAULT_PERMS` 只管**未被租户库覆盖**的角色 ⇒ 改默认**必同批迁库**；`perms_for` **缓存无 TTL** ⇒ **必重启**；**v325** `chat` 默认只 admin/boss，须留 `_ALL_MODULES`；判「谁有 X」须展开 `admin` 的 `["*"]`；v326 人名存两份；**v333** 权限页行 = 模块、人看的是**页面** ⇒ 行下显「对应页面」（源 `MODULE_IMPACT.entries`）；**v334** 动作轴：行是 `list` ⇒ `action` **被短路**；同列两写端点**整列覆盖** ⇒ 形态收敛+合并
  · 🔴 映射**首个 `startswith` 即停**；拆模块**三处缺一** → `backend-invariants.md`
  · 🔴 `is_custom` **≠**「自定义角色」⇒ 用 `isCanonicalRole` → `backend-auth.md §2`
  · 🔴 **v328**：幽灵模块（0 映射却有勾选框）／造角色**堵后门+开正门**／改角色不动登录端 → `backend-auth.md §v328`
  · 🔴 **v335** 门禁用**接口模块**非页面模块（`pages.js` 只管入口）；动作 = HTTP 方法（停用/重置密码/审核 = `create`）；`_READ_ONLY_POST` 漏同族 `simulate-batch`；全 `list`⇒展开全动作 ⇒ **今天不隐藏按钮**
  触发：权限 · 权限双链 · 登录端 · 列权限 · 报 500 · 索引 · 静默失效 · 幽灵 inode · 影子库 · 角色授权 · 导入双管线 · 员工改名 · 幽灵模块 · 细粒度 · 动作轴 · 只读POST · 页内门禁
- **部署 / 上线 / 回读 / 旧前端 `static/`** → `topics/deploy-ops.md`（§v230/277/293/297/**v329 停用≠废弃**）
  · 🔴 生产路径别靠记忆：后端 FLAT `/opt/hergent-erp/`；前端**根路径** `/opt/hergent-cn-v2`；⚠️ `hergent.cn/**admin/**` = `alias /opt/hergent-admin/` ⇒ 核验必查**根**
  · 🔴 加「唯一性/一致性」校验 ⇒ **先清存量再上线**（否则用户被自己锁住，v297）；顺序 **备份→清存量→上后端→上前端**
  · 🔴 **scp 前先 `diff` 生产 vs 本地**（"只差我这 N 行"才传）；md5 不等＋git 干净 = **双向分叉** ⇒ **hunk 移植** → `§v230`
  · 🔴 **chunk 名什么都判不了**（hash 级联）⇒ 判据 = ①逻辑名前缀比字节 ②**判别串取自源码原文**（凭记忆必错）③CSS 逐字节
  · 🔴 **「生产无 X」有保质期**：上线后必回头查入口 chunk；`ls -lt assets/` 只是并集
  · 🔴 沙箱挡「服务内取数据」：`ProtectHome=true` ⇒ **页面空、零报错**；🔴 **接口 200 ≠ 数据正常**（必读正文）
  · 🔴 **绝不用 `git stash`** 做对照构建（会移走别人**已上线**的在途改动）⇒ 改共享文件前**先 `cp` 备份+记字节数**
  · 🔴 生产 `assets/` 是历次构建**并集**（上传**绝不 `--delete`**）；加列靠启动期对账 ⇒ 验收读 `[schema-sync] … 补列(+N)`
  · 🔴 **v305/306c**：中间产物须在**最后编辑之后**重建；**md5 不证新鲜**⇒用**计数串**自证；多会话在途⇒**隔离 outDir**；「点了还是失败」先查**用户那页是否旧包**（SPA 驻留）
  · 🔴 **后端判据 = 生产 md5 == HEAD md5**；前端构建前必查 `src` mtime → 技能 §8.6
  触发：构建 · 上线 · 回读 · 差集 · 夹带 · chunk 改名 · 归因基准 · 备份 · OSS · 还是失败 · 旧包 · 旧前端 · 整合 · 生效集
- 🔴 **受控提交三条纪律** → `deploy-ops.md §v230`＋ **依赖闭包**（新 import 符号须在 HEAD 版存在）→ 技能 `hergent-scoped-commit`
  触发：受控提交 · 夹带 · 索引 · 遗留未提交 · 坏提交 · 依赖闭包
- **预报主表 / 期次 / 导入 / 到货周期 / 报单基准 / 价格单位** → `topics/forecast-order-domain.md`（最长）
  · 🔴 报单单位铁律：永不落大单位（三级中/两级小）⇒ 真身 = `products.order_unit` ⇒ 改单位必带换算，换算不出 ⇒ 退回明细单位 + 告警点名；⚠️ 别拿 `products.unit`
  · 🔴 厂价 = 元/箱 ⇒ `单价(厂价/箱)` 就是厂价本身；⚠️ 修「值不对的公式」先判该运算该不该存在；`purchase/sale/dist_price` = 元/小单位，`factory_price` = 元/大单位（有意分家）
  · 🔴 报单(判断) ≠ 提货(事实)；`forecast_audit` 窗口锚 `MAX(order_date)` ⇒ 停更 101 天零报错；期次「无按钮的行」= 合成行（`id<0`）
  · 🔴 跨期复制只有「商品清单」该复制（键 = `period_id`）；**上一期为空 ⇒ 复制 0 行且逐期传染** ⇒ v282 告警（`src_count` 分「源为空」/「全跳过」＋`forecast_carry_empty`）
  · 🔴 **报单简称名册**三来源 `mapping`/`report`/`hidden`；**v297 准入 = `listed`** ⇒ 「在名册里」≠「不会新增列」
  · 🔴 **v305**：关单后**授权改单** = `allow_closed`（**放行在「期次存在」之后**；**判角色在调用方**）；⚠️ **舟谱模板空数据 ≠ 关单**
  · 🔴 **同一对象只能有一条活跃配置**（v297 **硬拦**四路）⇒ 类型轴 `report_cp_kind`（仓库 7 ≠ 门店 7）＋ 归一历史 `customer`
  触发：预报 · 期次 · 单价 · 报单单位 · 单位换算 · 舟谱模板单价 · 进价 · 合成行 · 报 vs 提 · 沿用上一期 · carry-empty · 报单简称 · 定稿 · 分摊 · 加单
- **返利 / 目标** → `topics/rebate-domain.md`｜**货损 / 效期**（先分 `/loss` vs `/loss-accounting`）→ `topics/expiry-loss-domain.md`
  · 🔴 生效期口径：适用月份 = 月度分解本身 ⇒ 唯一实现 `rebate_period.py::rule_covers_date`；⚠️ `effective_*` = **规则启停窗口**，≠ 冲刺看板截止日（= 到货月月末）
  · 🔴 **页面进得去 ≠ 页面内数据读得到**（v293）：入口走前端 `roles`、页内取数走后端**模块权限**（返利 = `sales`）⇒ 两套独立判据；否则 403 被 catch 吞 ⇒ 恒空零报错
  · 🔴 **只配节奏不设目标**（v282）：`target_value=0` 安全 ⇒ 必走 `rebate_rules.py::_row_rhythm_only()` 正门 = 放行 ＋ **不判重** ＋ **不占月份锁**；`auto_period_enabled` 保持 0
  触发：目标 · 返利 · 生效期 · 月度分解 · 灰柱 · 达成率 · 节奏规则 · 到货规则 · 冲刺看板 · 模块错配 · 403 静默
- **报单 / 小程序 / 品牌 / 员工账号 / 提审** → `topics/miniprogram-and-brand-data.md`
  · 「能登录」≠「能干活」：认证 `/api/auth` 豁免 RBAC、业务走模块中间件；角色缺 `data` ⇒ 每动作 403；新账号 `password_changed=0` = 首登必改密
  · 🔴 **均单提示前置「四件套」**：① 有目标 ② 大单位换算（`no_convert`）③ 该品牌到货规则（`no_rule` **无兜底**）④ 行内单位 = `order_unit` 须与 `avg_per_unit` 同源 ⇒ 缺任一**静默不显示**；**v324** 目标月锚 = **到货月**（非报单月）；分母 = **报单窗口未关**
  · 🔴 **v298「未达标」唯一判据 = `q < target`**（cart **只装 qty>0** ⇒ 未填须按 0 补）；基准取 `_avgMap` **整期全量**，**绝非「已渲染行」**
  · 🔴 手机截图标「还是没修好」⇒ 先判看哪个包 ⇒ 判别点选「本期新增+无条件渲染+肉眼可见」
  触发：报单 · 门店范围 · 提审账号 · 首登改密 · 提交成功无反馈 · 一店一期一单 · 均单目标 · 两把尺子 · no_rule · 到货规则 · 未填不提示 · 校验基准
- **小程序保活** → `topics/miniprogram-keepalive.md`
- **副驾 / AI** → `topics/ai-copilot.md`（`ai_tools` = 只读 SQL；🔴 **数量类先 `GROUP BY`**：`ai_advice_log` 23 条**产出 0 条**）｜**通知/工资条/提醒没到人** → `topics/notification-center.md`；下载打不开也归本 topic
  · 🔴 提醒没到人四层查：**跑没跑 → 有无内容 → 通道走向 = `enabled_channels(tid)`（非全局）→ 能否主动出站（要回执）**；`_should_run` 无条件记账＋时间窗在调用处 = 相位锁死（§v304b）
  · **v305**：催报钟点由**租户配置算**；**`final≥lead` ⇒ 跳过 + 日志，绝不 clamp 用户值**；开关判据 = 读端 `grep` 到才算真（`per_sales` 曾是**假开关**）
- **IM 渠道** → `topics/im-channels-v131.md`｜**业绩/提成/龙虎榜** → `topics/sales-reports-and-operator-attribution.md`｜**对账/流水/催收** → `topics/reconciliation-redo.md`｜键对账 ≠ 账户对账 ⇒ 逐笔可解释；判同物看**条码**不看相似度
- **新用户建档 / 价格方案 / 单位换算** → `topics/onboarding-and-archive-gate.md`
  · 拦写入不拦浏览、隐式建档优先；🔴 六类档案之外还有员工 + `report_mapping` = 预报第一门槛；🔴 `contacts.channel_id` 列**从未创建过**（有守卫 ⇒ 永久落兜底价、零报错）
  · 🔴 价格真身 = `customer_prices`（非 `product_channel_prices`，0 行）；「三列并排」存三级单位价；✅ 三档价联动：中/大 = 小 × 换算比 ⇒ 别每档各存独立数（必漂移）
  · 🔴 换算唯一权威 = `products.large_ratio/medium_ratio`（判据 `large_ratio > 0`，非 `has_multi_unit`）；`unit_conversions` 0 行 ⇒ 别新建；⚠️ 补换算前先判 `unit` 语义（`'件'`=整箱 ⇒ 反向）
  · 🔴 **客户档案 v316/v316d 已上线**；列表**必传 `type=customer`**（混 employee）；默认排序新口径见 topic
  触发：新用户 · 建档前置 · 价格方案 · 千店千价 · 单位换算 · 装箱数 · 三列并排 · customer_prices · 三档价 · 客户档案
- 🔴 **跨域铁律 → `topics/cross-domain-iron-laws.md`** ← 动手前先扫一遍

## 二、技能路由 → `topics/skill-routing.md`

- 🔴 **上线前体检** → `hergent-pre-launch-audit`（31 项含 **H 面文案审计** + 反例对照法）｜触发：上线前检查 · 发版前体检
- 🔴 **对外材料成稿 + 脱敏 + 导 PDF** → `hergent-external-material-pdf`｜数字只取可验证来源；「留空」比「数字小」更危险 ⇒ 转成**假设+成功判据**；**定位句须与全篇证据同向**｜触发：写 BP · 导 PDF
- 🔴 **图表渲染几何验证** → `hergent-chart-render-verify`｜触发：柱子不显示 · 颜色不对 · 图表对不上
- **预填外部 SPA 表单** → `web-form-autofill-spa`｜🔴 只预填、绝不点提交；下拉判定不能看 `input.value`｜触发：报名表 · 下拉选不中
- 🔴 受控提交 → `hergent-scoped-commit`｜并行会话安全 → `hergent-parallel-session-safety`（§八 = 前端夹带判据：比字节不比名；§8.4 前提 = 线上==HEAD）
- 🔴 口径不一致（数字偏大偏小 / 同一笔算两遍 / 同屏两个同名数对不上）→ `hergent-rebate-caliber-consistency`（**第九类 = 页面进得去 ≠ 页内数据读得到**，v293）

## 三、编号约定（⚠️ 起号前必做）

已用到 **v340**（v339 双占 → `version-history.md`）。起号两步：① 读号表 ② 实搜（`-e "v20X"` ＋ `memory/`/`tools/`/两仓/**他线 git log**）；**索引滞后 ⇒ 只认号表**。

## 四、主体 / 脱敏

hergent-cn-v2（`laozhangai-product`）｜hergent-erp（FastAPI+SQLite）｜🔴 脱敏红线：返利率 / 进货价 / 客户名 / 区域销量 / 厂家政策。
🔴 仓内含**生产凭据明文** ⇒ 远端必须 private；**入库前先跑凭据扫描**。个人 PII 不落 `outputs/` ⇒ 环境变量＋打码＋`grep` 自证 0；🔴 **自检件勿打印待查模式原文**（v297）。

## 五、本机坑 → `topics/local-machine-pitfalls.md`（§10–§17）

`grep "A\|B"`／`\(a\|b\)` 静默失效 ⇒ 用 `-e A -e B`；多条 grep 串 `&&` 会短路 ⇒ 用 `;`。
🔴 **heredoc 经 `ssh` 传会吞引号** ⇒ 含引号脚本**本地写盘+`scp`**；服务器**无 `sqlite3` CLI**；无头 Chrome 须 `--no-sandbox` 等四开关 → §10
🔴 **SQLite 只读两个方向**（→ §11）：**活库** `mode=ro`（**不带** `immutable`）；**静态备份**必须 `&immutable=1`。
🔴 **探针必须先自证判别力**（→ §12）：正反两侧都要 + **N/M 数字写死**；别把「接口第一条」当「页面正在看的那条」。
🔴 **判据要在中文路径上自证**（→ §13）：`git` 默认八进制转义非 ASCII 路径 ⇒ 夹带断言**假阳性** ⇒ 用 `-c core.quotepath=false`。
