# Hergent 记忆索引（只放判据 + 去哪查；细节全在 `topics/*.md` 与 `docs/`）

后端 `hergent-erp`（FastAPI + SQLite 多租户）｜前端两套：`/opt/static`（进销存后台，**无构建链**）｜`/opt/hergent-cn-v2`（预报/副驾）。
线上 `root@47.113.224.140`，后端 `/opt/hergent-erp`（扁平、**不在 git**）。备份放 `/opt/hergent-data/backup/`（部署目录外，`--delete` 扫不到）。

按域查（均在 `topics/`，省略 `.md`）：写库/建表/**路由三张表**/租户隔离→`backend-invariants`｜迁移/精度→`migrations/README.md`+`precision.py`｜**报表/凭证/对账/费用/负库存**→`docs/` v707~v719 + `accounting-gl-v716-v717`｜浮层/表格→`frontend-ui`｜部署→`deploy-ops`｜单位/商品档案→`inventory-psi`｜本机坑→`local-machine-pitfalls`｜鉴权→`backend-auth`｜预报→`forecast-order-domain`｜返利→`rebate-domain`｜货损效期→`expiry-loss-domain`｜副驾→`ai-copilot`｜并行→`parallel-dev-protocol`｜静默失效→`v629-silent-failure-family`｜v691~v715→`recent-versions-v691-v715`｜跨域→`cross-domain-iron-laws`｜**无 `accounting-reports.md`**

## 静默失效家族（改前端/后端必读｜压过的各条全文在 `v629-silent-failure-family` 附录）

1. 接口 200 / 界面正常 / **mock 探针全绿** 都不等于生效（v697：24 项全过老板却看不到入口）。判据只用**用户可见字面量**；依赖枚举值/存量形态的，验证必须落在**生产真实数据**上，动手前先 `GROUP BY status`。
2. `api()` 只解一层 ⇒ 再写 `(d && d.data)` 恒空；prop 已解包 ⇒ `props.row` 不是 `.value`。
3. 写库必须 `get_db_tx()`；新路由必须登记 **`_PATH_MODULE_MAP`**（fail-closed，未登记 403 连 boss 都打不开）⇒「页面能开」≠「接口能调」。
4. 动过 SFC 必须重构建重部署（scopeId 派生）；传**整个** `dist/assets/`、绝不 `--delete`，最后 scp `index.html`+双侧 md5。
5. 「改了没变」先查 `__HG_BUILD__`（源头 `src/main.js`，发版前先升）；懒加载 chunk 不在 index.html；SPA 老标签页永不重拉。两套前端都 `no-cache`，原地改即时生效。
6. 「只提醒不拦截」：提醒状态**不得**进 `validate*()`、不得绑 `:disabled`。
7. 列宽按**最不利密度**核算、操作列 ≥72；浮层低于 `--z-page-fs` 会被盖住，遮罩与本体成对抬升。🔴 **弹层本体必须高于自己的触发按钮**（v704 遮挡带会**静默劫走点击**）；抬不动就**降按钮**。
8. 单位：档案价 = 元/**小**单位；换档**数量不动、金额跟着变**；切客户/供应商/单据类型必须清定价缓存。
9. 「搜不到」先排除「搜错范围/被截断」：`grep "A\|B"` 静默空、`| head -N` 截掉关键命中、`grep -rl X *.py` 只搜顶层。多模式用 `-e` 或拆两条。
10. 临时登录态只插主库 `erp.db` 的 `sessions`，测完删净并自证残留 0。
11. 部署 `rsync -av`（默认就不删，别加 `--no-delete`）；rsync 与 scp 串 `&&` 前者失败**不阻止后者** ⇒ 传完立刻 ls 新 chunk。
12. 🔴 **真登录探针**：`/opt/static` 认 `localStorage.hergent_token`，**不认 cookie/`hergent_auth`** ⇒ 只注 cookie 停 `#/login` 但 `/api/*` 照样 200 ⇒ 误判「没数据」。写 LS + `erp_token` cookie；写接口加 CSRF 同值。
13. 🔴 **改过的迁移不会重跑也不报错** ⇒ 新变更写 `migrations/patches/NNNN_*`（带 checksum）；**别 import `erp_db` 做体检**（导入即跑 389 条迁移=写生产）；体检 `-m migrations.doctor`。
14. 🔴 **补丁幂等三件套**：① `NEW=OLD+追加` ⇒ OLD 是 NEW 前缀，`n_new>=1 and n_old==0` 会**再替换一遍** ⇒ 硬断言 `count(new)==1`（回读不能全文扫）；② 已应用的库上重跑**不能改 `NEW` 串文字**（判锚点不唯一 ⇒ 整批回滚）；③ 「只针对旧形态」项标 **optional**。**`old` 是 `new` 前缀时通用判据必失效（v719 实测），改按「已应用形态」判定。**
15. 🔴 **改口径要双算 + 人造边界 + 反向对照**（生产上「改与不改一样」证明不了生效；反向对照**程序化挑选**）；**判据语义分家**：`abs(a-b)<0.01` 判「是否同一笔钱」浮点会翻案，判「是不是零」无所谓。
16. 余项一句话：图片裂=发不出 `X-Tenant-Id`｜账不平先查重复写入（`created_at` 几个时间点 + 父=子合计 ⇒ 派生行、**不编调整分录**）｜改库白名单别 `startswith`（`^tenant_\d+\.db$`、主库要 `realpath`）｜改完脚本**先传再执行**｜`sqlite3.Row` 无 `.get()`。**全文在 `v629-silent-failure-family` 附录。**
17. 🔴 **前端三坑**：① `try{window.X=X}catch{}` ⇒ 实测 **407 处 `window.X` 是 undefined**，空 catch 吞掉 ReferenceError ⇒ 无红字、面板停 spinner（**判据：页面里批量核 `typeof window[name]`，别 grep 定义**）；②「有没有某入口」先在真身目录 grep（`erp.hergent.cn→/opt/static`、`hergent.cn→/opt/hergent-cn-v2`；`assets/` 有 4 个历史 `main-*.js`，先看 `index.html` 引哪个）；③ 内联脚本比 `type="module"` chunk 先跑 ⇒ hook `window.api` 要轮询挂载，`MutationObserver` 不能 observe 未创建的容器 ⇒ observe `body`。

## 账务域铁律（v716–v719｜**动账前必读 `accounting-gl-v716-v717` 全文，本处只留最高危 9 条**）

27. 🔴 成本判据要**恰为 0**（`to_cents(total_cost)==0`），不能 `<=0`：退货单金额为负 ⇒ 写 `<=0` 会**整单跳过成本红冲**（3,925 张负额单被吞，毛利差 **2.79 点**）。
28. 🔴 **调拨单 `order_type='transfer'` 不能当销售**：251 张金额 0 但成本 **55.16 万** ⇒ 跟着过账毛利掉 **6.3 点**。调拨总库不变，不需分录。
32. 🔴 **费用链路四个断点**：路由传 15 实参 / db 收 8（4 接口 100% 500）｜无 `auto_journal_for_expense`｜`gl_account` 9 条全是 `6602`｜`get_pnl_gl` 只返合计而前端读四段。**「接口 200」一个断点都证明不了。**
36. 🔴 **费用四段硬断言**：四段之和**逐分等于** `total_expense`（`money_eq`），不平直接 `raise` —— 宁可整页报错，不让「合计对、明细不对」静默上屏。
37. 🔴 **回落现金制**：`has_data` 只看损益凭证 ⇒ 当月只有采购单 ⇒ 回落 ⇒ **把进货当费用**。加 `month_vouchers` 才对。
38. 🔴 **入口按钮注入时序**：chunk 等 300ms 找 `#rptBtn_cf`，按钮 ~1000ms 才出现 ⇒ 入口**在界面上不存在**。用内联轮询 + `MutationObserver(body)`；探针用 `wait_for_function`。
39. 🔴 **「配了但没人读」**（v719）：`warehouses.allow_neg_inv` 自建库就在 DDL、生产 11 个仓全 `'允许'`，而 `grep -rn allow_neg_inv server/` **0 行** ⇒ `quantity>=0` 守卫与配置**完全相反** ⇒ 业务员仓（`inventory` 0 行）的单一张也发不出。**判据：配置项先 grep 引用数，0 就别信它生效。**
40. 🔴 **库存为什么是假余额**（v719）：`pick_waves` **0 行** + `delivery_status` **全空** + `created_at` 集中在几处 = 签收单批量导入直写 `signed`、绕过发货 ⇒ 零 `sale` 流水；且 **v718 只改 `inventory` 没写流水** ⇒ 差 282,424、库龄算错。**判据：补库存必须同批写流水 + 逐商品-仓对账「余额==流水」（只对全局合计会掩盖行列错配）。**
41. 🔴 **探针断言别写死历史值**：`journal_entries` 88,776@v717 → **88,874**@v718。写死会让「本补丁没动 GL」永久 FAIL，而 FAIL 原因是判据过期不是代码坏了（v717 假 FAIL 同族）。
（余条与细节全在 `accounting-gl-v716-v717`：29/30/31/33/34/35；成本走 `batch_trace`→回落 `数量×purchase_price`；`assets.inventory`=**1405+1406**、`unclosed_profit` 在**顶层**、成本字段 `cogs`；**导入器只认 products**。）

## 生产数据实况（2026-10-28，v719 后｜全文 `accounting-gl-v716-v717`）

收入/成本侧**已通**：22,505 张签收单过账（调拨 251 张排除），2026-01~09 收入 **878.61 万** / 成本 **778.51 万** / 毛利 **100.11 万**（11.39%），`basis=accrual, source=gl`。费用侧**链路通、真数据 0**。
**动账务必跑**：逐月净利合计 **1,001,055.58 == 顶层 `unclosed_profit`**，差 **0.00**；`balanced=true`、不平凭证 0、`journal_total=88,874`。
进货：v718 补 10 月 49 张 / 57.48 万 / 782 行 ⇒ 1405 由 −688.6 万 → **−631.1 万**。
**库存（v719 起是真话但仍负）**：`inventory` **+310,409** → **−3,613,053**（回补净出库 3,923,462），**497 行负**；台账−流水差 **−10**（商品 2435 孤儿 `opening`，**不删流水**）。这个负数 = 「1-9 月进货没进系统」的量化，补齐即收敛，与 1405 同向。
其余缺口（业务问题非代码）：1-9 月进货单（约 631 万）、应收 **+1,010 万**（缺银行流水）、`expense_*` 0 行、`salary_details` 是 `draft` 占位。

## 进度锚

**v7xx 直接 ssh 打生产，本地不会自动跟上**：本地 `~/Documents/hergent-erp`（**带 `server/`**，生产扁平）⇒ **每次打完回写一次**，否则下次从本地部署整体回退且看不出来；判据：逐文件 diff 看「本地独有」行是**旧形态**（可覆盖）还是**未部署新功能**（只能挑 hunk）。
DDL 对账（只读）：`cd /opt/hergent-erp && sh tools/ddl_parity/run_parity.sh`（跑前确认 `migrations/other_db_modules.txt` 在）；2026-10-28 实测真故障 0。
编号到 **v719**（均已部署；v719 改代码已重启，v719b 只改数据不需重启）。**前端改动 = `/opt/static` 生产文件直改 + `.bak-*`**（无源码仓库/构建链，回滚靠 `.bak`）。**新 schema 变更一律 `migrations/patches/NNNN_*`，别再往 `erp_db.py` 加 `_safe_migrate`（已冻结）。**
卖前三关未过。BI 唯一源 `_BI_MEASURES`（`soi.amount`）。脱敏红线：返利率/进货价/客户名/区域销量/厂家政策；PII 不落 `outputs/`。

## 待拍板（别自己开工）

1. **凭证模板要不要接入口**（v711 后端已补齐、flag 默认关）：前端**有页面代码**但**无 `window.*` 导出、菜单无入口** ⇒ 实际不可达。先定：谁能改（这东西**能改账**）、改完要不要预览/试算。
2. **补历史数据 —— 最大拦路虎**（业务）：得从舟谱导 1-9 月**采购明细 + 银行流水 + 费用明细**；费用也可从工资/运费生成，卡在无 `auto_journal_for_salary`。**v718 已补 10 月 49 张，同一报表换日期区间即可补 1-9 月。**
3. **v717 三处妥协**：① 付款凭证贷方银行账户**是猜的**（→`100201`，账套 7 个）；② `expense_categories` 两列**账外裸 DDL**，应走 `migrations/patches/`；③ 「日记账」入口同样是脆弱选择器，**未修**。
4. **三处旧账**：① 老口径「资产负债表 (BS)」tab 仍 `—`/`¥0.00`（读另一组从未存在的字段，v713 只补了「(权责)」那张）；② `get_cashflow()` 仍现金制简化口径，与 P&L/BS 不同源（`get_cashflow_indirect()` 已从 `pnl.net_profit` 起算）；③ 对账/内部往来一处浮点判等（`erp_db.py:18721`，但 `ic_transactions` 0 行 ⇒ 未启用）。
5. **利润表卡片金额截断**：4 列 ×190px 下 `¥98,325.00` 末位被切。UI 单点单独一轮。

## 其它常查

- **v698 采购三入口**：「已审待执行」= **`confirmed`**；`received` 且 `received_amount`=0 ⇒ 真值=订单金额，**`partial` 不猜**。字号主力 **11–12.5px**，**暂不提档**（2026-10-26 定，别再提议）；`table-layout:auto` 下压列用 `max-width`+省略号。
- **AI 成本**：上游已最便宜档 `deepseek-v4-flash` ⇒ 换模型省不了钱；杠杆 提示词瘦身 > 轮数上限 > 缓存。`ai_usage_v2`：一次请求**只发一个** usage 块且是累计值，**绝不按 chunk 累加**；`prompt_tokens` 别乘全价。
