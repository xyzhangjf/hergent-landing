# Hergent 记忆索引（只放判据 + 去哪查；细节全在 `topics/*.md` 与 `docs/`）

后端 `hergent-erp`（FastAPI + SQLite 多租户）｜前端两套：`/opt/static`（进销存后台，无构建链）｜`/opt/hergent-cn-v2`（预报/副驾）。
线上 `root@47.113.224.140`，后端 `/opt/hergent-erp`（扁平、**不在 git**）。备份统一放 `/opt/hergent-data/backup/`（部署目录外，`rsync --delete` 扫不到）。

## 按域查

写库·建表·**路由三张表**·租户隔离→`backend-invariants.md`｜**库结构变更/迁移/精度**→`/opt/hergent-erp/migrations/README.md`+`db/precision.py`｜**报表/凭证/对账口径**→`docs/` 下 v707~v716 交付文档（**没有 `topics/accounting-reports.md`，那文件不存在**）｜前端浮层/表格/布局→`frontend-ui.md`｜部署·测试基线→`deploy-ops.md`｜单位三档·商品档案→`inventory-psi.md`｜探针纪律·本机坑→`local-machine-pitfalls.md`｜凭证→`backend-auth.md`｜预报→`forecast-order-domain.md`｜返利→`rebate-domain.md`｜货损效期→`expiry-loss-domain.md`｜对账→`reconciliation-redo.md`｜副驾→`ai-copilot.md`｜并行→`parallel-dev-protocol.md`｜静默失效家族→`v629-silent-failure-family.md`｜v691–v715 各版→`recent-versions-v691-v715.md`。

## 静默失效家族（改前端/后端必读）

1. 接口 200 / 界面正常 **≠** 生效。判据只用**用户可见字面量**，不用 minify 后改名的符号。
2. `api()` 只解一层 ⇒ 再写 `(d && d.data)` 恒空；prop 已解包 ⇒ `props.row` 不是 `.value`。
3. 写库必须 `get_db_tx()`；新路由必须登记 **`_PATH_MODULE_MAP`**（fail-closed，未登记 403 连 boss 都打不开）⇒「页面能开」≠「接口能调」。
4. 动过 SFC 必须重构建重部署（scopeId 派生）；传**整个** `dist/assets/`、绝不 `--delete`，最后 scp `index.html`+双侧 md5。
5. 「改了没变」先查 `__HG_BUILD__`（源头 `src/main.js`，发版前先升）；懒加载 chunk 不在 index.html；SPA 老标签页永不重拉。两套前端都是 `no-cache`，原地改即时生效。
6. 「只提醒不拦截」：提醒状态**不得**进 `validate*()`、不得绑 `:disabled`。
7. 列宽按**最不利密度**核算、操作列 ≥72；浮层低于 `--z-page-fs` 会被盖住，遮罩与本体成对抬升。🔴 **弹层本体必须高于自己的触发按钮**（v704 遮挡带会**静默劫走点击**）；抬不动就**降按钮**。
8. 单位：档案价 = 元/**小**单位；换档**数量不动、金额跟着变**；切客户/供应商/单据类型必须清定价缓存。
9. 「搜不到」先排除「搜错范围/被截断」：`grep "A\|B"` 静默空、`| head -N` 截掉关键命中、`grep -rl X *.py` 只搜顶层。多模式用 `-e` 或拆两条。
10. 临时登录态只插主库 `erp.db` 的 `sessions`，测完删净并自证残留 0。
11. 🔴 **mock 探针全绿 ≠ 生效**（v697：24 项全过，老板看不到入口，因为生产状态值是 `confirmed` 而我写死 `approved`）。凡判定依赖枚举值/存量数据形态，验证必须落在**生产真实数据**上；动手前先 `GROUP BY status` 看真实取值。
12. 部署 `rsync -av`（默认就不删，别加 `--no-delete`）；rsync 与 scp 串 `&&` 时前者失败**不阻止后者** ⇒ 传完立刻 ls 新 chunk。
13. 线上真登录探针注**两个** cookie：`erp_token`（真凭证）+ `hergent_auth='1'`（路由守卫读它）。写接口还要过 CSRF：cookie `csrf_token` + 头 `X-CSRF-Token` 同值，缺任一 403。
14. 🔴 **「业务接口全正常、只有图片裂」⇒ 查「带不了自定义头的请求」**：`<img>`/`<link>`/下载/`window.open` 只能吃 cookie，发不出 `X-Tenant-Id` ⇒ fail-closed 403 ⇒ 前端静默回落。头像在 `/opt/hergent-data/role-avatars/<tenant>/`。
15. 🔴 **改过的迁移不会重跑也不报错**（v705）：`_migrations` 只记 `(name,status)`。⇒ 新变更写 `migrations/patches/NNNN_*.sql|py`；`schema_patches` 带 checksum，改已执行版本=**直接失败**。**别 import `erp_db` 做体检/脚本**（导入期就跑 389 条迁移=写生产）；`.sql` 别用 `executescript()`。体检 `python3 -m migrations.doctor`。
16. 🔴 **账不平先查重复写入**（v709）：看同一 `ref_type` 的 `created_at` 有几个时间点（多批次=重复导入）、父科目金额是否**逐分等于**子科目合计（相等=派生行、不该当分录写）。**不编任何调整分录**。
17. 🔴 **补丁幂等：先判「新串已在位」再判旧串唯一**。`NEW = OLD + 追加` ⇒ OLD 是 NEW 前缀，`if n_new>=1 and n_old==0` 会**再替换一遍**。必须硬断言 `count(new)==1`；回读校验不能全文扫。
18. 🔴 **补丁另两条**：① **已应用的库上重跑不能改 `NEW` 串文字** —— 改一个标点就 `n_new=0 且 n_old=0` ⇒ 判锚点不唯一 ⇒ 整批回滚（要改注释就单列一条替换）。② 「只针对旧形态」项必须标 **optional**。
19. 🔴 **批量改库白名单别用 `startswith`**：`tenant_*` 会抓到 `tenant_1.pre-v617-*.db` 归档（改它=篡改证据）⇒ 用 `^tenant_\d+\.db$`；判主库必须 `realpath`，判不出 fail-closed。
20. 🔴 **改口径先双算，验证必须人造边界 + 反向对照**：生产数据上「改与不改一样」时跑接口证明不了生效；反向对照要**程序化挑选**（手挑的边界可能老判据同样给 False）。
21. 🔴 **改完脚本先传再执行**（v710：「已从备份恢复」，只是恢复错了目录，输出看起来完全正常）。
22. 🔴 **判据要看语义分家**：`abs(a-b)<0.01` 用在「两笔钱是否同一笔」上浮点会翻案（`50.00-50.01` 判相等 / `100.01-100.00` 判不等，v710 双算 16,456/69,186 次相反）；用在「是不是零」上无所谓。
23. 🔴 **`sqlite3.Row` 没有 `.get()`**（v711：采购过账 100% AttributeError）⇒ `o["x"] if "x" in o.keys() else 默认`。
24. 🔴 **`try{window.X=X}catch{}`**（v712）：`/opt/static` 有 885 处，实测 **407 处 `window.X` 是 undefined**；ReferenceError 被空 catch 吞 ⇒ 控制台无红字 ⇒ 面板停 spinner。**判据：页面里批量核 `typeof window[name]`，别 grep「有没有定义」。** 同族：`addEventListener("scroll", t=>t.target.closest(...))`。
25. 🔴 **「前端有没有某入口」必须先在真身目录 grep**：`erp.hergent.cn → /opt/static`；`hergent.cn → /opt/hergent-cn-v2`。**报表接口只有 `/opt/static` 调**。`assets/` 有 4 个历史 `main-*.js`，**先看 `index.html` 引哪个**。
26. 🔴 **内联脚本比 `type="module"` chunk 先跑**（v715）⇒ hook `window.api` 必须**轮询挂载**；**MutationObserver 不能 observe 尚未创建的容器** ⇒ observe `body`。

## 账务域铁律（v716 起）

27. 🔴 **成本判据必须「恰为 0」不是 `<= 0`**：退货单金额为负 ⇒ 成本也为负，写 `<= 0` 会**整单跳过成本红冲**，只冲收入不冲成本 ⇒ 成本虚增、毛利低估（生产 3,925 张负额单被吞，差 2.79 个百分点）。`erp_db.auto_journal_for_cogs` 用 `to_cents(total_cost)==0`。
28. 🔴 **`order_type='transfer'`（调拨单）不能当销售**：生产 251 张、金额 0 但成本 **55.16 万**。跟着过账会让主营业务成本凭空多 55 万、毛利率掉 6.3 个点。调拨前后总库不变 ⇒ 本就不需要分录。
29. 🔴 **一对分录的幂等要各自判自己的 `ref_type`**：用一条 `NOT EXISTS(sale)` 同时生成 sale+cogs，会因 0 元赠品单永远缺 sale 分录 ⇒ 每次重跑**重复插 cogs**（v709 同族）。
30. 🔴 **`journal_entries` 必须有 `(ref_type, ref_id)` 索引**：88,782 行时 `WHERE ref_type=? AND ref_id=?` 全表扫 ⇒ 22,505 次 ≈ 20 亿次比较 ⇒ **查询卡死**（补索引后 0.02 秒）。这也是 `gl_compensation_sweep` 从来跑不动的原因。
31. 报表接口验证法：临时 session（主库 `sessions`，`expires_at` 必须写 `datetime('now','localtime','+2 hours')`，写 `datetime('now','+2 hours')` 是 UTC ⇒ 判已过期 401）→ `curl -H "Authorization: Bearer <tok>" 127.0.0.1:8700/api/reports/pnl?month=YYYY-MM` → 立刻删 session。

## 生产数据实况（2026-10-28，v716 后）

收入/成本侧**已通**：22,505 张签收单全部过账（调拨 251 张排除），2026-01~09 收入 **878.61 万**、成本 **778.51 万**、毛利 **100.11 万**、毛利率 **11.39%**，借贷差 **0 分**；接口 `basis=accrual/source=gl`。
数据缺口（**不是代码问题，是从没进系统**）：库存科目 **−688.6 万**（期初 4.8 万+进货 89.9 万，却结转 778.5 万 ⇒ 缺约 690 万进货单）；应收 **+1,010 万**（878 万全挂应收，`cash_flow` 仅 16 行 ⇒ 缺银行流水）；`expense_orders` 0 行。
⇒ 资产负债表(权责) 上 `assets.inventory` 显示 **−664 万**，是进货没导的真实信号，不是 bug。

## 进度锚

**v7xx 补丁直接 ssh 打生产，本地不会自动跟上**。本地 = `/Users/zhangjunfeng/Documents/hergent-erp`（**`server/` 前缀**，生产扁平）。**每打完生产补丁回写一次**，否则下次从本地部署会整体回退且看不出来；判据：逐文件 diff，确认「本地独有」行是旧形态（可覆盖）还是未部署新功能（只能挑 hunk）。
DDL 对账（只读）：`cd /opt/hergent-erp && sh tools/ddl_parity/run_parity.sh`（跑前确认 `migrations/other_db_modules.txt` 在）。2026-10-28 实测真故障 0。
编号到 **v716**（均已部署并重启）。**新 schema 变更一律写 `migrations/patches/NNNN_*.sql|py`，不要再往 `erp_db.py` 加 `_safe_migrate`（已冻结，`--check` 会拦）。**
卖前三关未过。BI 唯一源 `_BI_MEASURES`（`soi.amount`）。脱敏红线：返利率/进货价/客户名/区域销量/厂家政策；PII 不落 `outputs/`。

## 待拍板（别自己开工）

1. **凭证模板要不要接入口**（v711 后端已补齐、flag 默认关）：前端**有页面代码**但**无 `window.*` 导出、菜单无入口** ⇒ 实际不可达。先定：谁能改（这东西**能改账**）、改完要不要预览/试算。
2. **进货/回款数据怎么补**（v716 暴露，**最大的拦路虎**）：要老板从舟谱导 9 个月进货单 + 银行流水，三表才能真成立。这也是卖给别的经销商时的必备能力（每客户都要导历史）。
3. **费用侧仍是 0**：`expense_orders`/`expense_requests` 全空 ⇒ 利润表有毛利无费用。要么建费用录入流程，要么从工资/运费单据生成。
4. **老口径「资产负债表 (BS)」tab 仍 `—`/`¥0.00`**：读的是另一组从未存在的字段。v713 只补了「(权责)」那张。
5. **`get_cashflow()` 仍是现金制简化口径**，与 P&L/BS 不同源（`get_cashflow_indirect()` 已从 `pnl.net_profit` 起算）。改它要单独一版。
6. **利润表卡片金额截断**：4 列 ×190px 下 `¥98,325.00` 末位被切。UI 单点单独一轮。
7. **对账/内部往来一处浮点判等**：`erp_db.py:18721`；但 `ic_transactions` 0 行、`entities` 表不存在 ⇒ 功能未启用。

## 其它常查

- **v698 采购三入口**：生产「已审待执行」是 **`confirmed`**；`received_amount` 是 v403 才加的列、舟谱导入单全 0；新增 `_po_received_amount()`（`received` 且列为 0 ⇒ 真值=订单金额，**`partial` 不猜**）。
- 字号：主力 **11–12.5px**，老板 2026-10-26 定**暂不提档** ⇒ 别再重复提议。`table-layout:auto` 下列宽被内容撑开、改 width 无效 ⇒ 压列必须 `max-width`+省略号。
- **AI 成本**：上游已是最便宜档 `deepseek-v4-flash`，2759 次调用仅 $2.38 ⇒ 换模型省不了钱；杠杆：提示词瘦身 > 轮数上限 > 缓存。计量在 `ai_usage_v2`：一次请求**只发一个** usage 块且是循环累计值，**绝不按 chunk 累加**；`prompt_tokens` 不能乘全价（高估约 40 倍）。
