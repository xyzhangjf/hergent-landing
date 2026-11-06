# Hergent 记忆索引（只留判据首句＋去哪查）

> 🔴 **完整原文一字未删**存档：`topics/memory-index-full-2026-11-06.md`（含全部实测数字、版本线、坏样本细节）。
> 本文件按既有惯例（同 `topics/impl-and-deploy-criteria.md`）压缩为索引；**查细节先搜这两份，再按域指针进 `topics/*.md` / `memory/YYYY-MM-DD.md`**。

**进行中**：阶段 1 第 1 项「库存写入点收敛」（13 裸写→`write_stock_movement` 台账/流水/余额同 SAVEPOINT 三写）**沙箱已验 61 判据、补丁未落地后端仓、未部署**，交付 `outputs/阶段1-第1项-库存写入点收敛交付-2026-11-06.md`｜阶段 1 余项：状态跃迁白名单 / 提交后字段锁定＋乐观锁 / `doc_versions` 时间线 / `party_ledger` 接线。🔴 dev-src 整份生产源码副本**不入库**，由 `stage1-dev-src-rebuild.py --check` 从「快照＋补丁」重建并逐字节自证。

**版本**：v790 粘贴结果面板整块移除、只留网格主色高亮（**已部署 2026-11-06 22:08**，commit `4fcdea95`，线上 `index-BLmA6Vyf.js` / `v790@4fcdea95@20261106-2208`）｜v788 构建号构建时注入＋清理两个死页面（**已部署 2026-11-06**，commit `3b40cc70`）｜阶段0收尾/阶段1验证单见 `outputs/`｜v787 粘贴结果收起时机（**已部署 2026-11-06**，commit `e27780e2`）＝按下保存即清＋取消也收｜v786 粘贴结果类 Excel 表格常驻展示（**已部署 2026-11-06**，commit `31612e17`）｜v785 粘贴严格 N 行全覆盖（**已部署 2026-11-06**，commit `01ce394b`）｜v784 品牌筛选藏行（已部署、**归因后被推翻**）｜v783 空白/0 覆盖清空、v781 纯数字列静默错误（已部署）｜v780 日期文案改短（小程序已上传待发布）｜v779 拦截层读「可提前天数」、v776 外部账号定向催单、v775 拆兜底 event_key、v773→v774 导购受众（后端已上线）｜v778 数量单位不折行、v777 去规格显示（小程序代码已改**未发版**）｜v772 横幅本期清单｜v771 到货日期｜v769 返利率可留空｜v768 GoLink/useGoPage。**小程序 v758–v780 已上传微信平台开发版、待审核发布**。唯一源 `main`。→ `memory/2026-11-05.md` / `2026-11-06.md`

## 🔴🔴 最高频硬判据（每条只留判据首句）
- **库存写入点不是 6 个是 13 个**（阶段 1 第 1 项）：「6 个」只数 `db/queries/inventory.py`；真实 = 查询层 6 ＋ `erp_db.py` 5（`rollback_ai_operation`×2/`_asm_apply_inventory`/`save_inventory_opening`/`seed_demo_data`）＋ `sync_writer` 1 ＋ `wastage_tracker` 1。判据：**收编的是「数量/金额变了」，不是「行被改过」** ⇒ `SET location_id` / `SET bin_location` 两处只改货位，必须列白名单，套三写会造 0 变动流水。
- **三写内核对了、SQL 参数顺序错了照样「看起来成功」**：`write_stock_movement` 扣减分支把守卫值排在 `inv_id` 前 ⇒ `WHERE id=?` 绑成扣减量、`quantity>=?` 绑成行号 ⇒ **流水记了出库、台账没扣**；入库无守卫不受影响 ⇒ 缺陷只藏在发货路径，**静态判据与入库测试都抓不到，只有演示数据真跑发货才暴露**。`SAVEPOINT` 名必须带序号（`stock_mv_<n>`），否则 `ROLLBACK TO` 命中外层同名 SP。`inventory_balance` 曾是死表（`reserve.py` 引的 `stock_ledger._BALANCE_UPSERT` 是从未实现的符号）。
- **「99 行只进 76 行」不是藏行，是写入层三处过滤**（v785）：`onPaste` filter 删空白行、`parseTSV` 尾部 pop、`pasteRegion` 按 `maxWriteR` 撑行 + clears 越界跳过。**后端删旧建新且 `qty_by_unit` 只发已存在的 key ⇒ 那格从未被 `writeCellVal` 触达，旧值 12 就永远留库 ⇒ 修复必须在前端写入层。**
- **严格 N 行全覆盖**：`parseTSV` 一行不删（Excel 末行空白时文本以 `\n` 结尾）、`onPaste` 不 filter 不 pop、`pasteRegion` 补行 `sr + rows` + 全块最大列数 + clears 逐格无越界守卫；`tryPasteCross` 按名寻址 ⇒ 空白行**只报数不按位置盲清**（盲清误伤别的商品）。
- **粘贴结果面板已整块删除（v790，三段口径反转）**：v786 常驻表格 → v787 按下保存/取消收起 → **v790 用户拍「不要这个区块，只留网格品牌色高亮」**⇒ `pasteResult`/`setPasteResult`/`.pr-*` 样式全删（不留死状态），`clearPasteResult` 改名 `clearPasteLand`（全文**恰好 2 处**：`saveEdits()` 第一行 + `leaveEdit()`）。视觉反馈只剩 `markPasteLand` 主色框（边界描边/内部淡底，`k` 计数逼动画重放，**绝不起定时器**）+ toast（行数/列数/落点/逐行全覆盖，面板没了它是唯一文字确认）。🔴 契约 `forecast-paste-result-panel` **已删除**，换 `forecast-paste-land-only`（53 判据，A 段是**反向判据**「面板与快照代码必须不存在」，且必须与「高亮还在」成对判，否则把粘贴功能删光也能全绿）；高亮真正画在 `ForecastRow.vue` 的 `ctx.pasteLandCls`（普通列 + 数量列两处）⇒ 跨文件判据不能只读 Forecast.vue。
- **口径变了必须反转旧坏样本/旧判据**（v780/v785）：v783 ㊱·c「尾行空白不撑行」已被用户推翻；㊱·d 抽真实函数体注入桩实跑 + 三组坏样本自证；静态判据一律**剥注释**（注释抄旧代码会自撞空白支票）。
- **同一个「能不能报」不许写两份口径**（v779）：统一 `window_hit(order_end, ws, early)`；弹窗日期只认真实期次表 `next_period_date`，日历推算已废弃；`SELECT *` 取后加列。
- **`run-all.mjs` 不自动扫描**：每个 `*.contract.mjs` 必须显式 `run()`，否则永不执行却 ALL PASS（连踩三轮）；每条要 runner 注册＋坏样本自证＋对照组全绿；防三种空白支票（正则抽空集／只查唯一不查存在／只写上限，**必须三态**）。
- **探针身份**（v729/v770 两次）：token 过期 ⇒ 全部页静默回 `#/workbench` ⇒ 每页量到同一屏＝完美假绿 ⇒ 每页第一条断言必须是身份自检；读生产租户配置先进租户上下文，先打印 `[DB] SQLite engine` 核对文件。
- **中文标签进 flex 行 ⇒ 改文案＝改断行点**（v770/v780/v778）：`nowrap` 与容器 `flex-wrap:wrap` 兜底缺一不可；「数值+单位」两层保险（绑定不留空格 + `.it-qty{white-space:nowrap}`）；量行数用 `Range.getClientRects()`，**别用元素高度÷行高**。
- **「去掉某字段显示」≠「删数据层」**（v777）：`copyRecord` 的 `spec` 仍要带回填报页，不许全仓替换。
- **「保存了又变回原值」＝`|| undefined` 丢键** ⇒ 三道闸门同时放行、toast 照样「已保存」；判据是「界面能不能把它删空」。
- **`<GoLink>` ≠ `useGoPage`**（v768）：判据＝点完人还在不在这一页；实例名不能叫 `goPage`（8 页里是分页函数）。`api()` 第二参是 options 对象不是 method（写 `'PUT'` ⇒ 兜底 GET、拿到旧值却弹「已启用」）。
- **新增展示字段先问「前端拿不拿得到全量」**（v771）：`/open-periods` 只返未关闭期次（24 期里 23 期 closed）⇒ 必须服务端批量补。
- 其余逐条判据（通知受众 v773–v776、返利率留空 v769、扫码 v761、撤回 v758、zoom v745、列拖拽、品牌色/排版令牌、副驾 403、角色权限端点）**见上方完整原文存档**。

- 🔴 **进销存阶段 0 线上核实（2026-11-06，老张拍「A」）**：生产 `inventory_logs` 281 条全是 2026-10-29 一次性 `opening` 快照、之后零真实交易 ⇒ 台账/流水/金额三项「完美相等」是**镜像快照假绿**；阶段 1 第一动作必须是「跑通一笔带批次效期的真实采购入库＋销售出库」，不是先写对账卡。生产主表 `status` **全无 CHECK**（旧判据来自开发版 DDL）；`entity_change_logs`/`audit_logs` 已有字段级留痕＋哈希链；`party_ledger` 建表 0 行、`write_party_ledger` 0 调用；生产 vs git = 220 一致/21 不同/11 缺。证据 `outputs/阶段0-线上只读核实报告-2026-11-06.md`，原计划文档已加修订章节。

- **构建号与冻结清单**（v788）：`vite.config.js` define 注入 `vNNN@短哈希@构建时间`，**发版提交信息写 vNNN 即自动生效**；`html[data-build]` 是完整串、`window.__HG_BUILD__` 是短号（UI 沿用）。🔴 删文件必须同步收缩所有按文件名登记的清单（`:is()` 焦点环接管名单 / `LH_AS_HEIGHT_FROZEN`），且 `npm test` 不含 prebuild ⇒ 另跑 `npm run tokens:check`；`| tail` 会吞失败退出码为 0。
- **阶段0/1 硬事实**（全文 `outputs/阶段0-线上只读核实报告-2026-11-06.md`）：生产后端**不是 git 仓**且领先 git 仓（严禁反向覆盖）；281 条流水全是 10-29 opening 快照＝假绿；`party_ledger` 建表未接线；🔴 只保存草稿不写库存 ⇒ 采购点「入库确认」、销售点「发货」才会长流水。只读工具 `prod-src-diff.py` / `stage1-ledger-probe.py`。

## 🔴🔴 部署（全文 `topics/deploy-ops.md`）
`deploy-frontend-closure.py --push` 只补 assets ⇒ 三步：`--push`→验闭包全 200→`rsync dist/index.html`（绝不 `--delete`，远端先 `cp -a`）。验产物**必须从线上 curl 回来 grep**：判新旧看**入口 JS 引用哪一份**；「改了没变」先查 `window.__HG_BUILD__`＋`html[data-build]`。🔴 **构建号在 build 时从 git 最近提交里取 vNNN ⇒ 必须先 commit（信息以 vNNN 开头）再 build**，顺序反了会注入上一版号（v790 首轮就打进 v788，白跑一次部署）；`curl` 不支持通配 URL，`assets/Forecast-*.js` 直接 404，要先用 `grep -o 'Forecast-[A-Za-z0-9_-]*\.js'` 从入口取真名。
FLAT：后端 `/opt/hergent-erp/`（非 git 仓，靠 `.workbuddy/remote-erp/` 回拉镜像）｜前端 `/opt/hergent-cn-v2/`（index.html 在根）｜**ERP 前端域名＝`hergent.cn`**（`erp.hergent.cn` 是另一个应用，curl 错域名得「404＝没传上去」假结论）。后端单文件：`cp -a`→`scp`→`chown`→双侧 `md5sum`→restart→**等 8~10 秒**。`vite build` 十几分钟零输出＝安全删除护栏拦住清 `dist/assets`。

## 🔴 路由（硬判据）
- **前端** → `topics/frontend-ui.md`（改前必 grep）：门禁唯一源 `pages.js`（未登记＝放行）｜`permView.js` 唯一源、`module:null`＝只读｜文案三禁⇒`hergent-ui-copy-guard`｜图表唯一源 `src/components/chart/`｜`⌘K`/`⌘⇧K` 已占用⇒新的用 `⌘⇧O`。
- **后端** → `topics/backend-invariants.md`：路由遮蔽先注册者胜｜静默失效＝恒空恒 0｜FastAPI 未声明 query 被静默忽略｜`execute_tool` 返回键是 `success`。改角色权限必须走 `POST /api/role-permissions`（「未列出＝移除」⇒ 传完整清单）。
- **域**：预报 `forecast-order-domain`｜返利 `rebate-domain`｜成本容量 `cost-and-capacity`｜账务 `accounting-gl-v716-v717`｜条码小程序 `miniprogram-and-brand-data`｜副驾租户 `copilot-tenant-memory`｜本机坑 `local-machine-pitfalls`｜库存 `inventory-psi`｜通知 `notification-center`。

## 实现 / 进度 / 主体 / 本机
实现细则 → `topics/impl-and-deploy-criteria.md`。进度：P0/P1 全交付；剩促销 ROI（端点 500）/货架位（零数据）/现金流预测页面化；**卖前三关未过、调拨单生产仍 0 张**；BI 唯一源 `erp_db.py:_BI_MEASURES`；敏感页后端 `_admin` 双保险。主体＝`hergent-cn-v2` + `hergent-erp`(FastAPI+SQLite)；脱敏红线：返利率/进货价/客户名/区域销量/厂家政策。
本机坑：🔴 `grep "A\|B"` 静默失效⇒一律 `-e`｜BSD grep 无 `\s`｜`| head -N`/`| tail -N` 会截掉决定性命中｜`grep -rl X *.py` 只搜顶层｜`git commit -m` 含 `{}`/反引号静默失败⇒`-F`｜**`patch` 不加 `--batch -f` 且 stdin 未关 ⇒ 等交互输入被 SIGTERM（exit 137、零输出）**⇒一律 `--batch -f` + `stdin=DEVNULL`｜**zsh 里 `${PIPESTATUS[0]}` 恒为空**（应为 `pipestatus` 且下标从 1 起）⇒「管道吞退出码」在 zsh 更隐蔽，一律 `> file; RC=$?`｜「搜不到」先排除「搜错范围/被截断」。微信开发者工具 CLI 被「服务端口」挡住 ⇒ 须人工在 IDE 设置里打开一次。
