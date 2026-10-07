# Hergent 项目长期记忆（索引）

> 限额 14848B ⇒ 新增先下沉 `topics/`。只留**路由 + 召回锚（§）+ 硬判据**。

## 一、路由

- **前端**（页面/样式/表格/数字格/工具栏/选中高亮/Excel 对标/hash 路由/文案/页内门禁/深色）→ `topics/frontend-ui.md`
  · 撤入口 ≠ 撤路由（手敲 URL 照进）⇒ `meta.roles` + `roleIn()`；全屏图层坑 `§v209`
  · 🔴 入口可见性唯一源 = `pages.js`（`module`×`roles`；窄名单行必 `lock`；未登记 = 失门禁）；守卫**只判角色轴** ⇒ 页内挂横幅；模块名唯一源 = `MODULE_LABEL`
  · 🔴 **v348–351** `permView.js` 唯一源、`module:null`=**只读**；多写入口 ⇒ 规则单一实现；搜索 = **查找非筛选**、域页签≡作用
  · 🔴 **v296/300** `roleIn`「未知」两判；`data` 拆 `cron`/`bid`；档案角色下拉 = 动态值域（403 静默降级）；「适用端」唯一源 = `ROLE_END`；⚠️ hash 深链必带 `/#/`
  · 🔴 **v331/338/339** 文案三禁：细节／复述／枚举值 ⇒ 技能 `hergent-ui-copy-guard`；**v335** `canDo(模块,动作)` 三态 fail-open、模块键错 ⇒ 整页按钮消失
  · 🔴 **v357** 雷达 `region`=裸省名、记忆顶层同步读；**v362/363/367** 深色（基类反色 ⇒ 白块、28 幽灵变量）
  · 🔴 **v377** 三轴（cell/row/col）互斥、行轴满宽/列轴满高；进轴前必 `commitPendingEdit`；轴判据 = 列元数据非 DOM `§v377`
  · 🔴 **v378**「选中跨度」与「定位指示」必须两条通道（混成 1 类 ⇒ 点 1 格亮 154 格）；上色只能来自 `spanHas()`；⚠️ `selected.r<0` 守卫不可丢 `§v378`
  · 🔴 **Excel 对标**：网格能力只在 `Forecast.vue`；子代理拿过期注释当事实＋「写了」≠「可达」`§Excel对标扫描`｜**v379**（⛔未上线）`§v379`
  · 🔴 **v382** 弹窗三按钮合一、写库前必抄快照 `§v382`｜**v383/384** 换 `editTarget` 必配重建编辑态（值停旧默认、`dirty` 恒真）`§v383/384`
  · 🔴 **v385** 新建员工/选角色/开账号一屏一次完成；两态共用一份 v-model；**密码先校验再落库**；跨库两步 ⇒ 失败路径须自愈 `§v385`
  · 🔴 **v390/393**（已上线）侧栏 **8 项职能区**+L1「＋」；**无 `path` 闸门 ⇒ 整区冒给不该看的人**；唯一收窄 = `resolveNavItem`；**v393** 进销存入口落位、抽屉补「＋」；**v393b 抽屉无 `max-height`/`overflow` ⇒ 顶部永久够不到**（`fixed` 不随滚动）；判「在眼前」**必按视口判** `§v390·§v393`

- **后端**（权限/账号/DB/报 500/路由遮蔽/角色授权/幽灵模块/动作轴/只读 POST）→ `topics/backend-invariants.md` + `backend-auth.md`
  · 🔴 **v317** 路由遮蔽：同路径**先注册者胜** ⇒ 加字段前必验生效的是哪份
  · RBAC 最外层 ⇒ `_check_perm` 时无租户，须显式传 `tenant_id=`；参数错回 500 = `ValidationError`
  · 🔴 恒空恒 0 且零报错 = 静默失效 ⇒ `tools/undefined-call-scan.py`；读数「碰巧对」⇒ 先问「恒定值 = 当前事实？」
  · 🔴 静默洞四条：**只下发表不下发索引**／**窗口当主键**（v279）／**白名单漏字段**／**租户上下文读 `tenants` 撞影子表**（v352）
  · 🔴 **幽灵 inode**：换库+连接缓存 ⇒ 句柄仍指已删 inode ⇒ **先删后重启**；`DB_PATH` **两份** ⇒ 影子库**两处都 patch**（v289）
  · 🔴 **代码默认 vs 租户覆盖**：`_DEFAULT_PERMS` 只管未被租户库覆盖的角色 ⇒ 改默认必同批迁库；`perms_for` 缓存无 TTL ⇒ 必重启；判「谁有 X」须展开 `admin` 的 `["*"]` `§v333/334`
  · 🔴 映射**首个 `startswith` 即停**；拆模块**三处缺一**；`is_custom` **≠**「自定义角色」⇒ 用 `isCanonicalRole` `backend-auth.md §2`
  · 🔴 **v328** 幽灵模块（0 映射却有勾选框）／造角色**堵后门+开正门**／改角色不动登录端 `§v328`
  · 🔴 **v335** 门禁用**接口模块**非页面模块；动作 = HTTP 方法（停用/重置密码/审核 = `create`）；`_READ_ONLY_POST` 漏 `simulate-batch` `§v335`

- **部署 / 上线 / 旧前端 `static/`**（构建/夹带/chunk 改名/生效集）→ `topics/deploy-ops.md`（§v230/277/293/297/**v329 停用≠废弃**）
  · 🔴 路径别靠记忆：后端 FLAT `/opt/hergent-erp/`；前端**根** `/opt/hergent-cn-v2`；⚠️ `admin/` = alias `/opt/hergent-admin/` ⇒ 核验查**根**
  · 🔴 **chunk 名什么都判不了**（hash 级联**两级**：改任一 chunk ⇒ `__vite__mapDeps` 变 ⇒ 入口＋所有 importer 改名）
  · 🔴 **「生产无 X」有保质期**（发版后必回查入口 chunk）；⚠️ 沙箱 `ProtectHome=true` 挡「服务内取数」⇒ 页面空零报错；**接口 200 ≠ 数据正常**
  · 🔴 **绝不用 `git stash`** 做对照构建（会移走别人**已上线**改动）⇒ 改共享文件前**先 `cp` 备份+记字节数**；中间产物须在**最后编辑之后**重建；多会话 ⇒ **隔离 outDir**
  · 🔴 生产 `assets/` 是历次构建**并集**（上传**绝不 `--delete`**）；加列靠启动期对账 ⇒ 读 `[schema-sync] … 补列(+N)`
  · 🔴 **共享工作区替你上线**：别人整包构建带上你的在途改动 ⇒ 改完尽早提交别冒认；线上第三态 ⇒ scope-id 摘 hunk 重建
  · 🔴 **后端判据 = 生产 md5 == HEAD md5**；前端构建前必查 `src` mtime → 技能 §8.6
  · 🔴 **v378 零夹带四路**（基名+字节／**全 token 归一**／`scopeId`／vs **生产生效集**）；增量面 `find -newermt` ⇒ **恰好 N 个**才是在途；零写入猴补必带「监控已安装」护栏 `§v378`；**v393** 上传必整包（级联改名 ⇒ 只传入口+改的两个 = 动态 import 404；判据 `comm -23` 缺失=0）`§v393`

- 🔴 **受控提交** → `deploy-ops §v230/§v381` ＋**依赖闭包**（新 import 须在 HEAD 版存在）→ 技能 `hergent-scoped-commit`

- **预报主表/期次/导入/到货周期/报单基准/价格单位/分摊/沿用上一期/个人仓归属** → `topics/forecast-order-domain.md`
  · 🔴 报单单位铁律：永不落大单位（三级中/两级小）⇒ 真身 = `products.order_unit`；改单位必带换算，算不出 ⇒ 退回明细+告警
  · 🔴 价格**双轨量纲**：`factory_price`=元/箱、`sale_price`=元/小单位；加金额先查覆盖率（厂价 100%、sale 30%）；`store_kind` **不参与定价** `§报单金额口径双轨`
  · 🔴 报单(判断) ≠ 提货(事实)；`forecast_audit` 窗口锚 `MAX(order_date)` ⇒ 停更即零报错；合成行 `id<0`
  · 🔴 跨期复制只有「商品清单」该复制（键 = `period_id`）；**上一期为空 ⇒ 复 0 行且逐期传染** ⇒ v282 告警 `§跨期复制`
  · 🔴 **报单简称名册**三来源 `mapping`/`report`/`hidden`；**v297 准入 = `listed`** ⇒ 在名册 ≠ 不会新增列
  · 🔴 **v305** 关单后**授权改单** = `allow_closed`（判角色在调用方）；⚠️ **舟谱模板空数据 ≠ 关单**
  · 🔴 **同一对象只能有一条活跃配置**（v297 **硬拦**四路）⇒ 类型轴 `report_cp_kind`（仓库 7 ≠ 门店 7）＋ 归一历史 `customer`
  · 🔴 **v361** 舟谱导出：**「未登记 且 有量」才泄漏**；点名告警须限量（响应头 1500B）`§v361`
  · 🔴 **报单自动化死锁**（v354/355）：人工「恢复报单」的期次**永久 open** ⇒ 挡死此后每期自动建表（零提示）；判据必带 `id>0`（合成行恒 `'open'`）`§v354/355`
  · 🔴 **v358/359** 分解到人：**Σ比例=100 ⟺ Σ数量=总量** ⇒ 唯一源 = 被编辑侧、另一侧摊尾差；判据必带分母；加单分摊不强制但自动发生 `§v358/359`

- **返利/目标** → `topics/rebate-domain.md`｜**货损/效期**（先分 `/loss` vs `/loss-accounting`）→ `topics/expiry-loss-domain.md`
  · 🔴 生效期口径：适用月份 = **月度分解本身** ⇒ 唯一实现 `domain/rebate_period.py`；**分解只写到当月 ⇒ 次月整条规则静默消失**（`is_active` 仍 1、界面零异常）`§v376`
  · 🔴 **页面进得去 ≠ 页内取数读得到**（v293/v353）：入口走 `roles`、页内走模块权限（返利 = `sales`）；403 被吞 ⇒ 恒空零报错 `backend-auth.md §v353`
  · 🔴 **只配节奏不设目标**（v282）⇒ `_row_rhythm_only()` 正门；**v360 返利填 0 = 该月无返利**（判据**两段式**）`§v282·§v360`
  · 🔴 **v373** 结算 = **按月核销、次月上账**（现行「年度合同+12月分解」主体搞反、页不可下线）；`contract_id` 前端无写入入口 ⇒ 筛选恒空 = 假功能 `§v373·§v375`
  · 🔴 **v364/365/368 到货停单**：只留本月、不改节奏；**停单 ⇒ 该期次不自动建**（`build_period_plan`）；手动建表不读停单；已存在期次 `void` 作废 `§v364·§v365·§v368`

- **进销存（自研 ERP 交易层，v391 薄壳 → v392 八页）** → `topics/inventory-psi.md`
  · 🔴 八页**继承父行门槛、`pages.js` 一字不改**（`ruleFor` 逐级去尾）；`path:''` 索引子路由**必需**；父级 `redirect` 自指报循环；`purchase/new` 必排 `:id` 前
  · 🔴 **入库批次三列**：明细 INSERT 不写 ⇒ `confirm` 读空 ⇒ 生产 `inventory` 54 行效期**全空**（v392 已修）；批次号空 ⇒ `batch_in` 每行新建不累加
  · 🔴 **FEFO**：过期批次不可售、无到期日排最后、**不足整体拒绝不部分扣**；`sale_order_deliver` 只收 `draft`；`sale_order_list` 返回 `{'orders','total'}` **非行列表**；`order_type` 必**追加参数表末尾**
  · 🔴 **v392b**：模板调 `fmtMoney` 而 script 漏 import ⇒ **整页崩 + 父页签一起消失**；四探针全绿 ⇒ 收敛唯一实现 + 护栏 `v392b-template-symbol-guard.py`
- 🔴 **积分已冻结**：口径 = **套餐档位**；`credits.py` 写端点**停用别修**
- **报单/小程序/品牌/员工账号/提审/均单目标** → `topics/miniprogram-and-brand-data.md`
  · 「能登录」≠「能干活」：`/api/auth` 豁免 RBAC；角色缺 `data` ⇒ 每动作 403；`password_changed=0` = 首登必改密
  · 🔴 **均单提示四前置**（v324）：目标＋换算＋到货规则(无兜底)＋行内单位同源 ⇒ 缺任一静默；月锚=到货月；分母=报单窗口未关
  · 🔴 **v298 未达标 = `q < target`**（cart 只装 qty>0 ⇒ 未填按 0）；基准 = `_avgMap` 整期全量
  · 🔴 **v372 两端口径错位**：`order_date` = 期次 `order_start` ≠ 今天 ⇒ 汇总恒空；不传 `period_id` ⇒ 兜底 `forecast_period_default()`
  · 🔴 **v393 明细核对层**：`showModal` 正文纯文本装不下几十项 ⇒ **自绘半屏**；原 `if(!confirmed)` 使**改单零确认**

- **副驾/AI** → `topics/ai-copilot.md`（`ai_tools` = 只读 SQL；🔴 **数量类先 `GROUP BY`**）｜**通知/工资条/提醒没到人**、**收到了不该收的** → `topics/notification-center.md`
  · 🔴 没到人四层查：**跑没跑 → 有无内容 → 通道走向 = `enabled_channels(tid)`（非全局）→ 能否出站**；`_should_run` 无条件记账 = 相位锁死（§v304b）｜**小程序保活** → `topics/miniprogram-keepalive.md`
  · 🔴 **v351→352**：标题拼内部租户名 = 文案层泄漏；`event_key` 现算 ⇒ 改名即**静音全失效**（v352 修）；**v366** 开关各调用方遵守度不同 ⇒ 外部客户企微不可达
- **IM 渠道** → `topics/im-channels-v131.md`｜**业绩/提成/龙虎榜** → `topics/sales-reports-and-operator-attribution.md`｜**对账/流水/催收** → `topics/reconciliation-redo.md`
- **新用户建档/价格方案/单位换算/客户档案** → `topics/onboarding-and-archive-gate.md`
  · 拦写入不拦浏览、隐式建档优先；🔴 六类档案之外还有员工 + `report_mapping` = 预报第一门槛；`contacts.channel_id` **从未创建过** `§onboarding`
  · 🔴 价格真身 = `customer_prices`（非 `product_channel_prices`，0 行）；「三列并排」存三级单位价；✅ 三档价联动：中/大 = 小 × 换算比 ⇒ 别每档各存独立数（必漂移）
  · 🔴 换算唯一权威 = `products.large_ratio/medium_ratio`（判据 `large_ratio > 0`，非 `has_multi_unit`）；⚠️ 补换算前先判 `unit` 语义（`'件'`=整箱 ⇒ 反向）
  · 🔴 客户档案 v316 已上线；列表**必传 `type=customer`**
- 🔴 **跨域铁律 → `topics/cross-domain-iron-laws.md`** ← 动手前先扫一遍

## 二、技能路由 → `topics/skill-routing.md`（唯一源；本节只留高频）

- 🔴 `hergent-pre-launch-audit`（上线前体检 31 项含 H 面文案）｜`hergent-external-material-pdf`（对外材料/脱敏/PDF）
- 🔴 `hergent-scoped-commit`｜`hergent-parallel-session-safety`（夹带判据：**比字节不比名**）｜`hergent-rebate-caliber-consistency`（数字对不上/0 被当空）｜`hergent-chart-render-verify`

## 三、编号约定（⚠️ 起号前必做）

已用到 **v393**（⚠️ **同号两用**：进销存侧栏入口 `cdb152e`／小程序明细核对层；**v393b**=抽屉补丁 `dfd7315`；v392=八页；v374 空号）。起号：① 读号表 ② 实搜**未提交文件**＋两仓 git log；**下轮从 v394 起**。明细 → `topics/version-history.md`。
🔴 **v391/392**（`a96ad3d`/`1eeabcf`/`15fa937`✅）进销存薄壳 15 端点 ⇒ **八页全链**；`inventory` 默认只 boss；**唯一不可委派 = `receive`**；403 判据看 `error_code`（同码 = 零判别力）→ `inventory-psi.md`
🔴 跨会话判「谁的改动」**比特征串不比字节差**；「同一规则抄多份」⇒ 漏抄那份**整页崩** `§v376/377`

## 四、主体 / 脱敏

hergent-cn-v2（`laozhangai-product`）｜hergent-erp（FastAPI+SQLite）｜🔴 脱敏红线：返利率/进货价/客户名/区域销量/厂家政策。
🔴 仓内含**生产凭据明文** ⇒ 远端须 private、**入库前跑凭据扫描**；个人 PII 不落 `outputs/`（环境变量＋打码＋`grep` 自证 0）。

## 五、本机坑 → `topics/local-machine-pitfalls.md`（§10–§33）

🔴 五条最常踩：`grep "A\|B"` 静默失效 ⇒ `-e`；`&&` 短路；`| head -N` 截命中；**zsh 通配无匹配 abort 整条**；**探针别放 `/tmp`**。**探针先自证判别力**（正反两侧+N/M 写死）；**判据取值域须与输入同宽**；CDP 注入须在 `Page.navigate` 之后；**`git show HEAD:` 做对照时若改动已提交 ⇒ HEAD 就是改后，须取 `<commit>^:`**。其余（scoped CSS 插 `[data-v-…]` ⇒ 精确串恒 0；无 `sqlite3` CLI ⇒ 只读 URI+`runuser`；heredoc 经 `ssh` 吞引号 ⇒ 落盘+`scp`）→ `§10–§33`
