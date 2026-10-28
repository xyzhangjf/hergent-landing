# Hergent 记忆索引（只放判据 + 去哪查；细节全在 `topics/*.md` 与 `docs/`）

后端 `hergent-erp`（FastAPI + SQLite 多租户）｜前端两套：`/opt/static`（进销存后台，**无构建链**）｜`/opt/hergent-cn-v2`（预报/副驾）。
线上 `root@47.113.224.140`，后端 `/opt/hergent-erp`（扁平、**不在 git**）。备份放 `/opt/hergent-data/backup/`（部署目录外，`--delete` 扫不到）。

## 按域查（均在 `topics/`，`.md` 省略）

写库·建表·**路由三张表**·租户隔离→`backend-invariants`｜迁移/精度→`/opt/hergent-erp/migrations/README.md`+`db/precision.py`｜**报表/凭证/对账/费用**→`docs/` v707~v717 + `accounting-gl-v716-v717`｜前端浮层/表格/布局→`frontend-ui`｜部署·测试基线→`deploy-ops`｜单位三档·商品档案→`inventory-psi`｜本机坑→`local-machine-pitfalls`｜鉴权→`backend-auth`｜预报→`forecast-order-domain`｜返利→`rebate-domain`｜货损效期→`expiry-loss-domain`｜对账→`reconciliation-redo`｜副驾→`ai-copilot`｜并行→`parallel-dev-protocol`｜静默失效→`v629-silent-failure-family`｜v691~v715→`recent-versions-v691-v715`｜跨域铁律全文→`cross-domain-iron-laws`。（**没有 `topics/accounting-reports.md`**）

## 静默失效家族（改前端/后端必读｜13–23 全文在 `v629-silent-failure-family` 附录）

1. 接口 200 / 界面正常 **≠** 生效。判据只用**用户可见字面量**，不用 minify 后改名的符号。
2. `api()` 只解一层 ⇒ 再写 `(d && d.data)` 恒空；prop 已解包 ⇒ `props.row` 不是 `.value`。
3. 写库必须 `get_db_tx()`；新路由必须登记 **`_PATH_MODULE_MAP`**（fail-closed，未登记 403 连 boss 都打不开）⇒「页面能开」≠「接口能调」。
4. 动过 SFC 必须重构建重部署（scopeId 派生）；传**整个** `dist/assets/`、绝不 `--delete`，最后 scp `index.html`+双侧 md5。
5. 「改了没变」先查 `__HG_BUILD__`（源头 `src/main.js`，发版前先升）；懒加载 chunk 不在 index.html；SPA 老标签页永不重拉。两套前端都 `no-cache`，原地改即时生效。
6. 「只提醒不拦截」：提醒状态**不得**进 `validate*()`、不得绑 `:disabled`。
7. 列宽按**最不利密度**核算、操作列 ≥72；浮层低于 `--z-page-fs` 会被盖住，遮罩与本体成对抬升。🔴 **弹层本体必须高于自己的触发按钮**（v704 遮挡带会**静默劫走点击**）；抬不动就**降按钮**。
8. 单位：档案价 = 元/**小**单位；换档**数量不动、金额跟着变**；切客户/供应商/单据类型必须清定价缓存。
9. 「搜不到」先排除「搜错范围/被截断」：`grep "A\|B"` 静默空、`| head -N` 截掉关键命中、`grep -rl X *.py` 只搜顶层。多模式用 `-e` 或拆两条。
10. 临时登录态只插主库 `erp.db` 的 `sessions`，测完删净并自证残留 0。
11. 🔴 **mock 探针全绿 ≠ 生效**（v697：24 项全过，老板却看不到入口）。凡判定依赖枚举值/存量形态，验证必须落在**生产真实数据**上；动手前先 `GROUP BY status`。
12. 部署 `rsync -av`（默认就不删，别加 `--no-delete`）；rsync 与 scp 串 `&&` 前者失败**不阻止后者** ⇒ 传完立刻 ls 新 chunk。
13. 🔴 **真登录探针**：`/opt/static` 认 `localStorage.hergent_token`，**不认 cookie / `hergent_auth`** ⇒ 只注 cookie 会停 `#/login` 而 `/api/*` 照样 200 ⇒ 误判「没数据」。探针写 LS + `erp_token` cookie；写接口再加 CSRF 同值。
14. 🔴 **只有图片/附件裂 ⇒ 查「发不出自定义头的请求」**：`<img>`/下载/`window.open` 只能吃 cookie ⇒ 没 `X-Tenant-Id` ⇒ fail-closed 403 ⇒ 前端静默回落。头像在 `/opt/hergent-data/role-avatars/<tenant>/`。
15. 🔴 **改过的迁移不会重跑也不报错**（`_migrations` 只记 name+status）⇒ 新变更写 `migrations/patches/NNNN_*`（带 checksum，改已执行版本=直接失败）；**别 import `erp_db` 做体检**（导入即跑 389 条迁移=写生产）；体检 `python3 -m migrations.doctor`。
16. 🔴 **账不平先查重复写入**：同一 `ref_type` 的 `created_at` 有几个时间点、父科目金额是否**逐分等于**子科目合计（相等=派生行）。**不编调整分录**。
17. 🔴 **补丁幂等**：`NEW = OLD + 追加` ⇒ OLD 是 NEW 前缀，`n_new>=1 and n_old==0` 会**再替换一遍** ⇒ 硬断言 `count(new)==1`；回读不能全文扫。
18. 🔴 **改库白名单别用 `startswith`**（会抓到 `tenant_1.pre-v617-*.db` 归档=篡改证据）⇒ `^tenant_\d+\.db$`；判主库必须 `realpath`，判不出 fail-closed。
19. 🔴 **改口径先双算 + 人造边界 + 反向对照**：生产数据上「改与不改一样」证明不了生效；反向对照要**程序化挑选**。
20. 🔴 **改完脚本先传再执行**：版本不一致 ⇒ 做的事和你以为的完全不同，**输出却完全正常**。
21. 🔴 **判据语义分家**：`abs(a-b)<0.01` 判「两笔钱是否同一笔」浮点会翻案；判「是不是零」无所谓。
22. 🔴 **`sqlite3.Row` 没有 `.get()`** ⇒ `o["x"] if "x" in o.keys() else 默认`。
23. 🔴 **补丁另两条**：① 已应用的库上重跑**不能改 `NEW` 串文字**（判锚点不唯一 ⇒ 整批回滚）；② 「只针对旧形态」项必须标 **optional**。
24. 🔴 **`try{window.X=X}catch{}`**（v712）：`/opt/static` 885 处，实测 **407 处 `window.X` 是 undefined**；ReferenceError 被空 catch 吞 ⇒ 无红字 ⇒ 面板停 spinner。**判据：页面里批量核 `typeof window[name]`，别 grep「有没有定义」。**
25. 🔴 **「前端有没有某入口」必须先在真身目录 grep**：`erp.hergent.cn → /opt/static`；`hergent.cn → /opt/hergent-cn-v2`。**报表接口只有 `/opt/static` 调**。`assets/` 有 4 个历史 `main-*.js`，**先看 `index.html` 引哪个**。
26. 🔴 **内联脚本比 `type="module"` chunk 先跑**（v715）⇒ hook `window.api` 必须**轮询挂载**；**MutationObserver 不能 observe 尚未创建的容器** ⇒ observe `body`。

## 账务域铁律（v716–v717｜**动账前必读 `accounting-gl-v716-v717` 全文，本处只留最高危 6 条**）

27. 🔴 成本判据要**恰为 0**（`to_cents(total_cost)==0`），不能 `<= 0`：退货单金额为负 ⇒ 写 `<=0` 会**整单跳过成本红冲**（生产 3,925 张负额单被吞，毛利差 **2.79 点**）。
28. 🔴 **调拨单 `order_type='transfer'` 不能当销售**：251 张金额 0 但成本 **55.16 万** ⇒ 跟着过账毛利掉 **6.3 点**。调拨总库不变，本就不需分录。
32. 🔴 **费用链路四个断点**：路由传 **15 实参** / db 签名收 8（4 接口 100% 500）｜无 `auto_journal_for_expense`｜`expense_categories.gl_account` 9 条全是 `6602`｜`get_pnl_gl` 只返 `total_expense` 而前端读四段 ⇒ 三行恒 ¥0.00。**「接口 200」一个断点都证明不了。**
36. 🔴 **费用四段硬断言**：四段之和**逐分等于** `total_expense`（`money_eq`），不平直接 `raise` —— 宁可整页报错，不让「合计对、明细不对」静默上屏。
37. 🔴 **回落现金制判据**：`has_data` 只看损益科目凭证 ⇒ 当月只有采购单 ⇒ 回落 ⇒ **把进货当费用**（2026-10 净利 **−920**）。加 `month_vouchers` 才对。
38. 🔴 **入口按钮注入时序**：chunk 等 300ms 找 `#rptBtn_cf`，按钮 **~1000ms** 才出现 ⇒ 入口**在老板界面上根本不存在**。只能内联轮询 + `MutationObserver(body)`；探针用 `wait_for_function`。
（余下 29/30/31/33/34/35 见 topic：分录各判自己的 `ref_type`、`(ref_type,ref_id)` 索引、报表验证法、删幽灵实参、按 `voucher_no` 汇总判平衡、`post_ledger`/`post_journal` 解耦。）

## 生产数据实况（2026-10-28，v717 后｜数字全文同上 topic）

收入/成本侧**已通**：22,505 张签收单过账（调拨 251 张排除），2026-01~09 收入 **878.61 万** / 成本 **778.51 万** / 毛利 **100.11 万**（11.39%），借贷差 0 分，`basis=accrual, source=gl`。费用侧**链路通、真数据 0**。
**动账务必跑**：逐月净利合计 **1,001,055.58 == BS `unclosed_profit`**，差 **0.00**；`balanced=true`、`unbalanced_vouchers=0`、`journal_total=88,776`。
缺口（**不是代码问题，是从没进系统**）：库存 **−688.6 万**（缺约 690 万进货单）、应收 **+1,010 万**（缺银行流水）、`expense_*` 0 行、`salary_details` 全是 `draft` 占位。⇒ BS(权责) `assets.inventory` **−664 万** 是真实信号。

## 进度锚

**v7xx 补丁直接 ssh 打生产，本地不会自动跟上**：本地 = `~/Documents/hergent-erp`（**带 `server/` 前缀**，生产扁平）⇒ **每打完生产补丁回写一次**，否则下次从本地部署会整体回退且看不出来；判据：逐文件 diff，确认「本地独有」行是**旧形态**（可覆盖）还是**未部署新功能**（只能挑 hunk）。
DDL 对账（只读）：`cd /opt/hergent-erp && sh tools/ddl_parity/run_parity.sh`（跑前确认 `migrations/other_db_modules.txt` 在）；2026-10-28 实测真故障 0。
编号到 **v717**（均已部署并重启）。**前端改动是 `/opt/static` 生产文件直改 + `.bak-*`**（无源码仓库、无构建链，回滚靠 `.bak`，可重放文本在 `tools/hergent/patch_v717*.py`）。**新 schema 变更一律写 `migrations/patches/NNNN_*`，别再往 `erp_db.py` 加 `_safe_migrate`（已冻结，`--check` 会拦）。**
卖前三关未过。BI 唯一源 `_BI_MEASURES`（`soi.amount`）。脱敏红线：返利率/进货价/客户名/区域销量/厂家政策；PII 不落 `outputs/`。

## 待拍板（别自己开工）

1. **凭证模板要不要接入口**（v711 后端已补齐、flag 默认关）：前端**有页面代码**但**无 `window.*` 导出、菜单无入口** ⇒ 实际不可达。先定：谁能改（这东西**能改账**）、改完要不要预览/试算。
2. **补历史数据 —— 最大的拦路虎**（业务问题不是代码问题）：三表要真成立，得从舟谱导 9 个月**进货单 + 银行流水 + 费用明细**。费用也可从工资/运费单据生成，但**卡在无 `auto_journal_for_salary`、`salary_details` 全是 `draft` 占位**。
3. **v717 三处妥协**：① 付款凭证贷方银行账户**是猜的**（→`100201`，账套 7 个银行科目，UI 无得选）；② `expense_categories` 两列是**账外裸 DDL**，应走 `migrations/patches/`；③ 「日记账」入口同样的脆弱选择器，**未修**。
4. **老口径「资产负债表 (BS)」tab 仍 `—`/`¥0.00`**：读的是另一组从未存在的字段。v713 只补了「(权责)」那张。
5. **`get_cashflow()` 仍是现金制简化口径**，与 P&L/BS 不同源（`get_cashflow_indirect()` 已从 `pnl.net_profit` 起算）。改它要单独一版。
6. **利润表卡片金额截断**：4 列 ×190px 下 `¥98,325.00` 末位被切。UI 单点单独一轮。
7. **对账/内部往来一处浮点判等**：`erp_db.py:18721`；但 `ic_transactions` 0 行、`entities` 表不存在 ⇒ 未启用。

## 其它常查

- **v698 采购三入口**：生产「已审待执行」是 **`confirmed`**；`received_amount` 舟谱导入单全 0；`_po_received_amount()`：`received` 且列为 0 ⇒ 真值=订单金额，**`partial` 不猜**。
- 字号：主力 **11–12.5px**，老板 2026-10-26 定**暂不提档** ⇒ 别再提议。`table-layout:auto` 下改 width 无效 ⇒ 压列用 `max-width`+省略号。
- **AI 成本**：上游已是最便宜档 `deepseek-v4-flash`（2759 次调用 $2.38）⇒ 换模型省不了钱；杠杆 提示词瘦身 > 轮数上限 > 缓存。计量 `ai_usage_v2`：一次请求**只发一个** usage 块且是循环累计值，**绝不按 chunk 累加**；`prompt_tokens` 不能乘全价（高估约 40 倍）。
