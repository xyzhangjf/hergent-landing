# Hergent 记忆索引（目标 ≤4.3k 字 —— 27 条路由 + 硬判据约需 4k；v449 增「进销存按类型拆页」后到 4.3k；再涨就先下沉 topics）

> 细节一律下沉 `topics/`；本文件只留**路由 + 召回锚(§) + 硬判据**。

## 路由
- **前端** → `topics/frontend-ui.md`：🔴 入口唯一源 `pages.js`（未登记=失门禁）`§v209`；🔴 `permView.js` 唯一源、`module:null`=只读 `§v348`；🔴 文案三禁⇒`hergent-ui-copy-guard` `§v331`；🔴 单入口→多子页（`?tab=`+`watch`）`§v424`；🔴 列设置齿轮共享 `useColSettings`/`ColMenuPanel`/`col-menu.css`(v432)。
- **建单/建退单页** → `docs/进销存建单页开发规范-v441.md`（范本=「创建采购订单」）：🔴 三层高度链｜框式头 `.‹pfx›-hd-box`｜同 path 两 query ⇒ **computed+watch**（`onMounted` 不再跑且零报错）｜幂等键成功**立刻换**｜退货落点看**源单状态是否回写**｜🔴 **§R 视觉基准**（**真机 getComputedStyle 实测**，不是读 CSS 推算）｜🔴 探针 v441/v444/v445/v446/v447｜类差集审计(自带判别力自证)；🔴 `npm run build` 被 safe-delete 拦 ⇒ 隔离 `outDir dist-vNNN`；🔴 **v449 起 7 页独立**（`docTypes.js`=路径+配置唯一源、4 内核：销售4种/采购单/采购退/调拨）：`redirect` 不指定 `query` 会**继承原 query**⇒显式 `query:{}`（采购只剥 `kind` 留 `from_po`）｜**部署前比 `outDir` 与源码 mtime**（实测 dist 早于 router 修复⇒白构建）⇒ 详见 `docs/进销存建单页拆分为独立页面-方案-v449.md`。
  - 🔴 **v444→v447 六条**（边框三态不许 `border:none`｜必填红 `*` 复用表单头类｜列宽拖动｜格态值一致｜**行高元凶常在图标按钮**）⇒ `topics/inventory-psi.md`。
  - 🔴 **探针自己会判错**：同文档导航加 `'/?__r='+Date.now()+hash`；`.ipn-ret-tbl` 用 `:not(.-ret-tbl)`；就绪判据用 `title` 非空；按钮按**文案**定位；**模板串正则双反斜杠**、不能写反引号；**INIT 的 user 必须与 token 同账号**。
- **后端** → `topics/backend-invariants.md`+`backend-auth.md`：🔴 路由遮蔽先注册者胜 `§v317`；🔴 静默失效=恒空恒0零报错⇒`undefined-call-scan.py`；🔴 幽灵 inode `§v289`；🔴 门禁用**接口模块**非页面模块 `§v328`；🔴 **FastAPI 未声明的 query 参数被静默忽略** `§v443`；🔴 委派链只在**唯一源函数**加参数；🔴 `limit<=0` 落回默认；🔴 **死代码里的多层缺陷**（`p + [limit]` 当 tuple 拼⇒恒 500；`SELECT to.*` 而别名是 `to_`⇒`to` 成关键字；**「从未被执行过的代码」≠「安全的代码」**）`§v449`。
- **部署** → `topics/deploy-ops.md`：🔴 后端 FLAT `/opt/hergent-erp/`、前端根 `/opt/hergent-cn-v2`；🔴 chunk 名什么都判不了(hash 级联两级)；🔴 生产 `assets/`=并集(绝不 `--delete`)；🔴 判据=生产 md5==HEAD md5 `§v378`；🔴 受控提交→`hergent-scoped-commit`；🔴 rsync 必用绝对路径且**只同步 `dist-vNNN/` 产物**（v460 误把本地仓库根——含营销 `index.html`——拷入 `/opt/hergent-cn-v2`，覆盖 SPA 壳+污染工作树）；本仓 `git checkout -- .`/`git clean` 会毁 SPA（`assets/` 未跟踪）。
- **预报主表** → `topics/forecast-order-domain.md`：🔴 报单单位永不落大单位(真身 `products.order_unit`)；🔴 价格双轨(箱/小单位)；🔴 报单≠提货、`forecast_audit` 锚 `MAX(order_date)`；🔴 跨期复制只复制品清单⇒复 0 行传染 `§v282`；🔴 自动化死锁 `§v354`。
- **返利/目标** → `topics/rebate-domain.md`｜**货损效期** → `topics/expiry-loss-domain.md`：🔴 适用月份只写到当月⇒次月规则静默消失 `§v376`；🔴 进得去≠读得到(403 被吞) `§v353`；🔴 到货停单⇒期次不自动建 `§v364`。
- **进销存(v391→八页)** → `topics/inventory-psi.md`：🔴 八页继承父行门槛、`pages.js` 不改；🔴 入库批次三列不写⇒效期全空；🔴 FEFO 不足整体拒绝、`sale_order_deliver` 只收 `draft`；🔴 销售单无审核⇒已确认单发不了货 `§v412`；🔴 列设置上云、`extra` 空则不加列 `§v403`；🔴 **退单模式头 v448 起也套 `-hd-box`**（只读格进框成为"值"、`.‹pfx›-hint` 必须放框外、`-po` 格宽度要显式写回对抗 0,3,0）`§v448`；🔴 积分已冻结(`credits.py` 别修)；🔴 **v449**：销售/采购退货**可不挂原单**（自选客户/供应商 + **指定退货仓库**，缺则显式报错；挂原单老路径逐字不变）；调拨走 `transfer_orders` **真双仓**（过账=调出减/调入加，同一事务、失败必须 `raise` 不能 `return`）、**无调拨退单**。
- **报单/小程序/品牌** → `topics/miniprogram-and-brand-data.md`：🔴 能登录≠能干活(角色缺 `data`⇒403)；🔴 均单提示四前置缺任一静默 `§v324`；🔴 v433/434 一键清空、跨 tab 复制经 `app.globalData._fsCopy`。
- **副驾/AI** → `topics/ai-copilot.md`(`ai_tools`=只读 SQL、数量类先 GROUP BY)｜**通知没到人** → `topics/notification-center.md`(四层：跑没跑→内容→`enabled_channels(tid)`→出站)；🔴 标题拼内部租户名=文案泄漏、`event_key` 现算改名即静音 `§v351`。
- **IM** → `topics/im-channels-v131.md`｜**业绩提成** → `topics/sales-reports-and-operator-attribution.md`｜**对账** → `topics/reconciliation-redo.md`。
- **新用户/价格/换算/客户档案** → `topics/onboarding-and-archive-gate.md`：🔴 价格真身 `customer_prices`(中/大=小×换算比)；🔴 换算权威 `products.large_ratio/medium_ratio`(判据 `large_ratio>0`)；🔴 客户档案列表必传 `type=customer`。
- 🔴 **跨域铁律** → `topics/cross-domain-iron-laws.md`。

## 待修（已登记，未动）→ 详情 `topics/inventory-psi.md` §待修
🔴 采购退货候选粗筛含不可退｜销售退货列表恒空（**前端筛错表**，后端已修好）｜`?copy=<不存在单号>` 被静默吞（404 仍显示空表单）｜**调拨无列表页**｜`col-prefs?page=<key>` 返回 400。

## 技能路由 → `topics/skill-routing.md`
🔴 `hergent-pre-launch-audit`｜`scoped-commit`｜`parallel-session-safety`｜`rebate-caliber-consistency`｜`chart-render-verify`｜`ui-copy-guard`｜`external-material-pdf`。

## 编号约定
🔴 已用到 **v461**（号表 → **v462**；⚠️ v452~v461 全是 2026-10-11 **同一天**被用掉的，「下轮从 vN 起」当天就可能过期）；号=全局共享序列⇒起号前必读 `topics/version-history.md` + 实搜未提交文件/两仓 `git log --all`/`git worktree list`。🔴 **部署铁律（v460 踩坑订正，v461 再证）**：主应用根=`/opt/hergent-cn-v2`，`/admin/` alias **`/opt/hergent-admin`** 两套别混（🔴 2026-10-11 15:17 实测该目录 `index.html` 已被一次**错目标 rsync** 覆盖成 SPA 壳、97 个 `assets/` 同时被改写且未留 bak ⇒ 管理后台打不开；恢复=`bash /opt/hergent-admin/scripts/release.sh rollback BG2Yswu1`）；🔴 同日多会话并行**反复互相覆盖部署**（v461 首轮三方 md5 全绿后 40 秒即被覆盖）⇒ 部署必须以「**三方 md5 + 生产真机探针**」当轮复核为准；rsync **必用绝对路径、只同步 `dist-vNNN/` 产物、绝不可把本地仓库根拷进去**（本地根 `index.html` 是营销页，会覆盖生产 SPA 壳）；本仓 `index.html` 已跟踪且是 SPA 壳 ⇒ **不可** `git checkout -- .` / `git clean`（会毁 SPA，因 `assets/` 未跟踪）。

## 并行开发协议 → topics/parallel-dev-protocol.md
🔴 多会话并行**总控基准**：**按缝切分 + 门口串行**。含「文件 ownership 总控表」「起号/提交/部署纪律」「红牌停手信号」。开工前先更新 ownership 表，部署前必占串行窗口。

## 主体/脱敏
hergent-cn-v2(`laozhangai-product`)｜hergent-erp(FastAPI+SQLite)｜🔴 脱敏红线：返利率/进货价/客户名/区域销量/厂家政策；仓内含生产凭据明文⇒远端须 private；PII 不落 `outputs/`。

## 本机坑 → `topics/local-machine-pitfalls.md`(§10–§43)
🔴 `grep "A\|B"` 静默失效⇒`-e`；`&&` 短路；`| head -N` 截命中；zsh 通配无匹配 abort；探针别放 `/tmp`。🔴 **工作区文件会被静默回退** ⇒ 改长文档前先 `wc -l` 与 HEAD 核数。
