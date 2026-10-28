# Hergent 记忆索引（只放判据 + 去哪查；细节全在 `topics/*.md`）

前端 `hergent-cn-v2`（Vue3.5 SFC/Vite）｜后端 `hergent-erp`（FastAPI + SQLite 多租户）。
线上：后端 `/opt/hergent-erp`（扁平、**不在 git**）｜前端 `/opt/hergent-cn-v2`｜`root@47.113.224.140`。

## 按域查（动手前先查，别凭印象）

前端/浮层/表格/布局/页面真身→`frontend-ui.md`｜后端写库·建表·**路由三张表**·隔离租户 e2e→`backend-invariants.md`｜**库结构变更/迁移/结构漂移/金额精度**→`/opt/hergent-erp/migrations/README.md` + `db/precision.py` + `docs/批次A-版本化迁移与精度常量-2026-10-27.md`｜**报表/凭证/科目树/对账口径**→`docs/` 下 v707~v714 七份交付文档（**没有 topics 汇总页**，别照着老索引去 `topics/accounting-reports.md`，那文件不存在）｜部署·构建·测试基线→`deploy-ops.md`｜单位三档·自由退货·商品候选·**商品档案新增/编辑**·**收文案≠收反馈**→`inventory-psi.md`｜探针纪律·本机坑→`local-machine-pitfalls.md`｜凭证→`backend-auth.md`｜预报→`forecast-order-domain.md`｜返利→`rebate-domain.md`｜货损效期→`expiry-loss-domain.md`｜对账→`reconciliation-redo.md`｜副驾→`ai-copilot.md`｜并行→`parallel-dev-protocol.md`｜静默失效家族（改前端必读）→`v629-silent-failure-family.md`｜**v691–v715 各版完整口径**→`recent-versions-v691-v715.md`。

## 十五条最容易「静默失效」的

1. 接口 200 / 界面正常 **≠** 生效。判据只能用**用户可见字面量**，不能用 minify 后会改名的符号名。
2. `api()` 只解一层 ⇒ 再写 `(d && d.data)` 恒空；prop 已解包 ⇒ 写 `props.row`，不是 `.value`。
3. 写库必须 `get_db_tx()`（`get_db()` 不 commit）；新路由必须登记 **`_PATH_MODULE_MAP`**（fail-closed，未登记 403 连 boss 都打不开）⇒「页面能开」≠「接口能调」。
4. 动过 SFC 必须重构建重部署（scopeId 派生）；发布传**整个** `dist/assets/`，绝不 `--delete`，最后 scp `index.html` + 双侧 md5。
5. 「改了没变」先查 `__HG_BUILD__`（源头 `src/main.js`，**发版前先升**）；懒加载 chunk 不出现在 index.html；SPA 老标签页永不重拉。
6. 「只提醒不拦截」：提醒状态**不得**进 `validate*()`、不得绑 `:disabled`——一进校验就变拦截，界面看不出区别。
7. 列宽按**最不利密度**核算、操作列 ≥72（抄列宽比抄机制更危险）；浮层低于 `--z-page-fs` 会被整块盖住，遮罩与本体成对抬升。🔴 **弹层本体必须高于自己的触发按钮**（v704：反过来会形成"遮挡带"并**静默劫走点击**）。抬不了本体时优先**降按钮**：先问"这一档真实需求是什么"。
8. 单位：档案价 = 元/**小**单位；换档**数量不动、金额跟着变**；切客户/供应商/单据类型必须清定价缓存。
9. 「搜不到」先排除「搜错范围/被截断」：`grep "A\|B"` 静默空、`| head -N` 截掉关键命中、`grep -rl X *.py` 只搜顶层。**多模式用 `-e` 或拆两条。**
10. 探针放 `tests/perf/vXXX/`（`/tmp` import 不到 playwright）；临时登录态只插主库 `erp.db` 的 `sessions`，测完删净并自证残留 0。
11. 🔴 **mock 探针全绿 ≠ 生效**（v697 翻车：24 项界面断言全过，老板线上却看不到入口，因为生产状态值是 `confirmed` 而我写死 `approved`）。**凡判定依赖枚举值/存量数据形态的功能，验证必须落在生产真实数据上**。动手前先 `SELECT status, COUNT(*) ... GROUP BY status` 看真实取值分布。
12. 部署：`rsync` 只能写 `-av`（**默认就不删，别加 `--no-delete`**）；rsync 与 scp 串 `&&` 时前者失败**不阻止后者** ⇒ 传完立刻 ls 新 chunk 存在，否则线上 index.html 指向空文件直接白屏。
13. 线上真登录探针要注**两个** cookie：`erp_token`（真凭证 httpOnly）+ `hergent_auth='1'`（标记，路由守卫读它）；只注前者会跳登录页，看起来像"没部署"。`addCookies` 用 `url` 时不能再给 `path`。**写接口还要过 CSRF**：cookie `csrf_token` + 头 `X-CSRF-Token` 必须同值（`server.py:319`，缺任一 403 `CSRF_REQUIRED`；v711 C 组第一跑 14 项全 403）。
14. 🔴 **「业务接口全正常、只有图片/附件裂」⇒ 先查「带不了自定义头的请求」**。`<img>` / `<link>` / 下载 / `window.open` 都只能吃 cookie，发不出 `X-Tenant-Id`；`tenant_middleware` 对 `/api/*` fail-closed ⇒ 403 ⇒ 前端静默回落（v700 头像退回 🚀）。角色头像落盘在 **`/opt/hergent-data/role-avatars/<tenant>/`**（部署目录外，防 rsync --delete）。
15. 🔴 **改过的迁移不会重跑，也不会报错**（v705）。`_migrations` 只记 `(name,status)` ⇒ 名字没变就判"已执行"⇒ 老库旧 SQL、新库新 SQL，**两台都声称 ok**。⇒ 新变更一律写 `migrations/patches/NNNN_名字.sql|py`；`schema_patches` 带 checksum，改已执行版本=**直接失败**。两条连带纪律：**别 import `erp_db` 做任何体检/脚本**（导入期就跑 389 条迁移=会写生产）；`.sql` 别用 `executescript()`（隐式提交 ⇒ 留半截库）。体检 `python3 -m migrations.doctor`（只读）。
16. 🔴 **账不平先查重复写入，别先想"记哪一方"**（v709 血案）。判据两条：同一 `ref_type` 的 `created_at` 有几个时间点（多批次=重复导入）、每个父科目金额是否**逐分等于**其子科目合计（相等=父科目是派生行、不该当分录写）。v709 就是靠这两条把 169 万"缺口"证伪成 4 轮导入 + 12 个父科目双写，删完差 **0.00**、**不编任何调整分录**。
17. 🔴 **补丁脚本幂等判据：先判「新串已在位」，再看旧串唯一**。`NEW = OLD + 追加` ⇒ **OLD 是 NEW 的前缀**，写 `if n_new>=1 and n_old==0` 会**再替换一遍**（语法合法、静默劣化，v709 把 `total_equity +=` 改成 2 行、多加 98,325）。必须加硬断言 `count(new)==1`。同族：回读校验**不能全文扫**（同文件常有合法同构/同名局部变量）。
18. 🔴 **批量改库的白名单别用 `startswith`**：`tenant_*` 会抓到 `tenant_1.pre-v617-*.db` 历史归档，**改它=篡改证据** ⇒ 用 `^tenant_\d+\.db$`；判主库必须 `realpath`（macOS `/var`→`/private/var`），判不出路径 fail-closed。
19. 🔴 **改口径先双算，验证必须人造边界**：生产数据上「改与不改一样」时，跑接口证明不了生效 ⇒ 隔离库造边界值（1 分差必判平、2 分差必判不平）+ 一条**反向对照**（老判据在同组数结论相反，证明新判据有区分力）。**反向对照要程序化挑选**：手挑的边界可能老判据同样给 False，等于什么都没验证（v710 第一版探针就栽在这）。
20. 🔴 **改完脚本先传，再执行**（v710 事故）。脚本带 `--revert`/`--apply`/删除语义时，本地与服务端版本不一致 ⇒ 它做的事和你以为的完全不同，**而输出看起来完全正常**（"已从备份恢复"，只是恢复错了目录）。同族：`rsync` 与 `scp` 串 `&&` 前者失败不阻止后者。
21. 🔴 **判据要看语义分家**：`abs(a-b) < 0.01` 用在「两笔钱是否同一笔」上，浮点下同一事实给相反结论（`50.00-50.01=0.009999999999998010` 判相等 / `100.01-100.00=0.010000000000005116` 判不等；v710 双算 69,186 次比较里 16,456 次相反）；用在「这个数是不是零」上则无所谓（`> 0.005` 保持原样，别硬统一）。

22. 🔴 **`sqlite3.Row` 没有 `.get()`**（v711：purchase 的 ctx 写了 `o.get("order_no","")` ⇒ 采购过账 100% AttributeError）。取值用 `o["x"] if "x" in o.keys() else 默认`。
23. 🔴 **补丁脚本另两条幂等纪律**（v711 各踩一次）：① **已经应用过的库上重跑时不能改 `NEW` 串的文字** —— 改一个标点就变成 `n_new=0 且 n_old=0` ⇒ 判「锚点不唯一」⇒ `patch_file` **整批回滚**；要改注释就单列一条替换。② 「只针对旧形态」的升级项必须标 **optional** —— 干净副本上旧形态 0 次是**正常的**，按错误处理会连带跳过后面几项（v711 一次重放差 39 行）。

24. 🔴 **`try{window.X=X}catch{}` 是静默失效家族**（v712，详见 `topics/v629-silent-failure-family.md`）：`/opt/static` chunk 有 885 处，页面实测 **407 处 `window.X` 是 `undefined`**；ReferenceError 被空 catch 吞掉 ⇒ 控制台无红字，调用点抛 `X is not a function` ⇒ 面板停在 spinner。**判据：在页面里批量核 `typeof window[name]`，别 grep「有没有定义」。** 修法：改 `index.html` 内联补（module 延迟 ⇒ 内联先跑；chunk 里的赋值仍抛错被吞 ⇒ 不覆盖）。同族：`document.addEventListener("scroll", t=>t.target.closest(...))` —— target 可能是 document ⇒ 每次滚动抛错 + 表头吸顶失效。
25. 🔴 **「前端有没有某入口」必须先在真身目录 grep**（v712 连踩两次）：`erp.hergent.cn → /opt/static`（进销存后台，静态 JS 无构建链）；`hergent.cn → /opt/hergent-cn-v2`（预报/AI 副驾）。**报表接口只有 `/opt/static` 调**。`assets/` 有 4 个历史 `main-*.js`，**先看 `index.html` 引哪个再 grep**。两套都是 `no-cache` ⇒ 原地改即时生效。
26. 🔴 **内联脚本比 `type="module"` 的 chunk 先跑**（v715）⇒ 想 hook `window.api` 之类必须**轮询挂载**；一次性 `var o = window.api` 拿到 undefined、随后被 chunk 覆盖 ⇒ 静默失效。同理 **MutationObserver 不能 observe 尚未创建的容器**（`#rptContent` 是点进报表才渲染的）⇒ observe `body`。

## 近十五版一句话（细节 → `topics/recent-versions-v691-v715.md`）

- **v715** 利润表月份下拉真正生效：`#pnlGlMonth` **没绑 change** + 渲染每次重建 `<select>` 把默认值写回当前月 ⇒ **面板永远只能看当前月**。内联注入四件事（记选择 / change 委托 / 包装 `window.api` 改写 month / MutationObserver 纠正显示）。坑：**内联脚本比 module chunk 先跑** ⇒ `window.api` 时不存在，必须轮询挂载；**不能 observe `#rptContent`**（脚本执行时容器还没建）。
- **v714** 利润表口径统一：`get_pnl_gl` 用 `category IN ('收入','成本','费用')` 取科目，而本账套 **109 个损益科目 category 是「损益」**、唯一有数的 `6001` 就在里面 ⇒ 三项**恒为 0** ⇒ GL 分支**从来没走到过**，一律回落现金制全期累计（**10 月 0 销售却显示 878 万**）。改：全集只认 **6 开头**，`60/61/63`=收入、`6401`=销货成本、其余=费用（**`6402` 归费用**，它挂的是客户费用/月返），按 v708 叶子有效去重，净额按方向取（红冲才对）。`get_pnl(month)` 新增按月（**不带 month 逐字不变**）；回落标 `basis=cash`+`source`。强判据：**逐月净利加总 == BS `unclosed_profit`**（98,325，同号）。验证 21+20+17，反向对照 13 项里 12 FAIL。
- **v713** 资产负债表(权责) 补明细字段：前端读 `assets.cash/ar/inventory/fixed_assets_net`、`liabilities.ap`、`equity.paid_in_capital/retained`，而 `get_balance_sheet_gl` **只返回三个 total** ⇒ 7 行明细**从来是 ¥0.00**。按编码前缀补：`10*` / `1122` / `1405+1406` / `1601+1602` / `2202` / `4001` / `4103+4104+unclosed_profit`，仍走叶子有效。**total/balanced 逐字未动**。
- **v712** 前端补 `window.statCard` + 顺修滚动报错（**这套前端 `/opt/static` 无源码仓库、无构建链，改动只在生产文件 + `.bak-v712`/`.bak-v712b`**）：详见下方第 24 条。
- **v711** 凭证模板整功能补齐（此前是空壳）：`erp_db` 补 5 个 `voucher_template_*`（此前不存在 ⇒ 5 接口全 500，create/update 还 100% NameError：读了 `body` 却用未定义的 `d`）；4 个 `auto_journal_for_*` 改**模板优先、硬编码兜底**，三道闸（flag 关/无匹配/**借贷不平衡**）任一不满足即回落。**flag=0 ⇒ 与改前逐分一致**。附带修：`feature_flags` 缺 `updated_at` ⇒ **flag 机制从来没工作过**。验证 26+16+21，回滚重放 **0 差异**。遗留：前端有页面代码但**无 `window.*` 导出/菜单入口**（导出名含 voucher 的 0 个）⇒ 实际不可达；开 flag 要**主库+租户库各写一行**。
- **v710** 对账判据按整数分（`money_eq` / `ROUND(,2)`）+ 月度快照改 GL 口径 + 顺修 `bank_auto_match` 的 `str - str` 崩溃（该函数**从来没跑通过**）。生产存量影响 0。
- **v709** 期初凭证去重：169 万不是账不平，是 4 轮重复导入 + 12 个父科目双写 ⇒ 删 168 行差 0.00；报表权益并入 `unclosed_profit`。资产 1018万→**225.8万**。
- **v708** 科目树去重：**「只算末级」是错解**（`1122` 527 万记在父上）⇒ 递归「有非零余额子就用子，子全零才用父」；砍掉不带 `as_of` 的假绿灯。
- **v707** 3 处报表平衡判据统一到 `money_balanced()`；双算 0 翻案 ⇒ **别把"改了判据"说成"修好了红叉"**。
- **v705–v706** 版本化迁移+精度常量（`schema_patches` 带 checksum，本包**绝不 import `erp_db`**）｜341 处账外裸 DDL 不收编但补 9 处 ensure｜补 13 索引｜冻结 389 处 `_safe_migrate`。**主库不是 schema 超集**。
- **v691–v704** 弹窗统一（55 处手写遮罩未收编）｜一键复制报单 `cellText`/`cellRaw` 分家｜工具条弹层面板要压住触发按钮（正解降按钮 1101）。

## 进度锚

🔴 **v7xx 补丁是直接 ssh 打在生产的，本地源码不会自动跟上**。本地副本 = `/Users/zhangjunfeng/Documents/hergent-erp`（**`server/` 前缀**，生产是扁平）；2026-10-28 实测它落后生产 v683/v686/v692 + v705–v711 共 5 版（连 `db/precision.py` 都没有），已用生产当前版本覆盖对齐（`93bc709`）。**每次打完生产补丁都要回写一次**，否则下次从本地部署会整体回退且看不出来。判据：逐文件 diff 后确认「本地独有」行是不是**旧形态代码**（是 ⇒ 可覆盖；是未部署的新功能 ⇒ 只能挑 hunk 移植，不能整体覆盖）。
**DDL 对账（只读）**：生产 `cd /opt/hergent-erp && sh tools/ddl_parity/run_parity.sh`（三步合一：抽代码 DDL → dump 库 → 比对）。与 `python3 -m migrations.doctor` 互补：doctor 查「租户库 vs 主库」，这个查「代码声明了但库里没有」。2026-10-28 实测真故障 0（18 张按需懒建 / 7 张独立库 / 68 张租户专属 / 9 处仅主库缺列，均非故障）。跑之前确认 `migrations/other_db_modules.txt` 在——缺它会把 `bid_radar.db` 的表误判成故障。

卖前三关未过；调拨单生产仍 0 张。BI 唯一源 `_BI_MEASURES`（`soi.amount`）；库存周转 `get_inventory_turnover`。
脱敏红线：返利率/进货价/客户名/区域销量/厂家政策；PII 不落 `outputs/`。编号已到 **v715**（均已部署并重启；v712/v715 是**前端** `/opt/static`，生产文件直改 + `.bak-*`）。**新 schema 变更一律写 `migrations/patches/NNNN_名字.sql|py`，不要再往 `erp_db.py` 加 `_safe_migrate`（已冻结，`--check` 会拦）。**

## 待拍板（别自己开工）

1. **凭证模板要不要接入口**（v711 后端已补齐、flag 默认关）：前端**已有页面代码**（`<div class="page-hd">凭证模板</div>` + 「新建凭证模板」表单 + 调 `/voucher-templates` 的 list/test/seed），但**没有 `window.*` 导出、侧栏菜单也无入口** ⇒ 实际不可达。真正要先定的是：谁能改（这东西**能改账**）、改完要不要预览/试算。
2. **对账匹配/内部往来仍有一处浮点判等**：`erp_db.py:18721` 内部往来 `matched` 判定；同类缺陷但 `ic_transactions` 全库 0 行、`entities` 表不存在 ⇒ 功能未启用，无数据可验。
3. 🔴 **成本与费用凭证缺失**（v714 实测）：GL 里**只有 `6001` 98,325 收入**，没有任何成本/费用分录 ⇒ 权责利润表只在 2026-06 有数，其余月份走现金制回落。这不是代码问题——要让权责 P&L 真可用，得先让「销售出库结转成本」「客户费用/费用报销」产生分录。**这是业务数据问题，需老板决定从哪条业务线开始补。**
4. **老口径「资产负债表 (BS)」tab 仍是 `—` / `¥0.00`**：它读的又是另一组字段，与接口返回不匹配 —— 同一类「按从未存在的字段写」。v713 只补了「(权责)」那张。
5. **`get_cashflow()` 仍是现金制简化口径**（`cash_flow` + `sale_orders`），与利润表/资产负债表不同源。`get_cashflow_indirect()` 已从 `pnl.net_profit` 起算（v714 后跟着变对）。改它要单独一版。
6. **利润表卡片金额截断**（v714 真机截图）：4 列 ×190px 下 `¥98,325.00` 末位被切，百万级更明显。是 `.stat-card-val` 既有字号与网格宽度约束，不是 v714 引入（改前这些卡根本渲染不出来）。按规矩 UI 单点单独一轮。

## 其它常查

- **v698 采购三入口**：生产「已审待执行」是 **`confirmed`**（不是 `approved`，生产 0 张）；`received_amount` 是 v403 才加的列、79 张舟谱导入单全 0；入库守卫/pay_mode 已认 `confirmed`，新增 `_po_received_amount()`（`received` 且列为 0 ⇒ 真值=订单金额，**`partial` 不猜**）。
- 字号：主力 **11–12.5px**（业界 13–14px），老板 2026-10-26 定**暂不提档**（笔记本 125%）⇒ 别再重复提议。`table-layout:auto` 下**列宽被内容撑开，改 width 无效** ⇒ 压列必须 `max-width`+省略号；采购退货页是独立组件自带一份宽度。
- **AI 成本口径（2026-10-26 实测）**：上游已是最便宜档 `deepseek-v4-flash`，全期 2759 次调用仅 **$2.38** ⇒ 换模型省不了钱；杠杆顺序：提示词瘦身 > 轮数上限 > 缓存 > 分档路由 > 换模型(0)。计量已改 `ai_usage_v2`（旧表记打字字数，差 3000 倍）：一次请求**只发一个** usage 块且是循环累计值，**绝不按 chunk 累加**；`prompt_tokens` 不能乘全价算成本（高估约 40 倍）；usage 里**没有** cached_tokens。
- 历史交付（P1-4 告警、P1-5 审计、consignment）→ `topics/backend-invariants.md`。
