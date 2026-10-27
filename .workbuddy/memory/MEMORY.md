# Hergent 记忆索引（只放判据 + 去哪查；细节全在 `topics/*.md`）

前端 `hergent-cn-v2`（Vue3.5 SFC/Vite）｜后端 `hergent-erp`（FastAPI + SQLite 多租户）。
线上：后端 `/opt/hergent-erp`（扁平、**不在 git**）｜前端 `/opt/hergent-cn-v2`｜`root@47.113.224.140`。

## 按域查（动手前先查，别凭印象）

前端/浮层/表格/布局/页面真身→`frontend-ui.md`｜后端写库·建表·**路由三张表**·隔离租户 e2e→`backend-invariants.md`｜**库结构变更/迁移/结构漂移/金额精度**→`/opt/hergent-erp/migrations/README.md` + `db/precision.py` + `docs/批次A-版本化迁移与精度常量-2026-10-27.md`｜**报表/凭证/科目树/对账口径**→`topics/accounting-reports.md`｜部署·构建·测试基线→`deploy-ops.md`｜单位三档·自由退货·商品候选·**商品档案新增/编辑**·**收文案≠收反馈**→`inventory-psi.md`｜探针纪律·本机坑→`local-machine-pitfalls.md`｜凭证→`backend-auth.md`｜预报→`forecast-order-domain.md`｜返利→`rebate-domain.md`｜货损效期→`expiry-loss-domain.md`｜对账→`reconciliation-redo.md`｜副驾→`ai-copilot.md`｜并行→`parallel-dev-protocol.md`｜静默失效家族（改前端必读）→`v629-silent-failure-family.md`｜**v691–v709 各版完整口径**→`recent-versions-v691-v709.md`。

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
13. 线上真登录探针要注**两个** cookie：`erp_token`（真凭证 httpOnly）+ `hergent_auth='1'`（标记，路由守卫读它）；只注前者会跳登录页，看起来像"没部署"。`addCookies` 用 `url` 时不能再给 `path`。
14. 🔴 **「业务接口全正常、只有图片/附件裂」⇒ 先查「带不了自定义头的请求」**。`<img>` / `<link>` / 下载 / `window.open` 都只能吃 cookie，发不出 `X-Tenant-Id`；`tenant_middleware` 对 `/api/*` fail-closed ⇒ 403 ⇒ 前端静默回落（v700 头像退回 🚀）。角色头像落盘在 **`/opt/hergent-data/role-avatars/<tenant>/`**（部署目录外，防 rsync --delete）。
15. 🔴 **改过的迁移不会重跑，也不会报错**（v705）。`_migrations` 只记 `(name,status)` ⇒ 名字没变就判"已执行"⇒ 老库旧 SQL、新库新 SQL，**两台都声称 ok**。⇒ 新变更一律写 `migrations/patches/NNNN_名字.sql|py`；`schema_patches` 带 checksum，改已执行版本=**直接失败**。两条连带纪律：**别 import `erp_db` 做任何体检/脚本**（导入期就跑 389 条迁移=会写生产）；`.sql` 别用 `executescript()`（隐式提交 ⇒ 留半截库）。体检 `python3 -m migrations.doctor`（只读）。
16. 🔴 **账不平先查重复写入，别先想"记哪一方"**（v709 血案）。判据两条：同一 `ref_type` 的 `created_at` 有几个时间点（多批次=重复导入）、每个父科目金额是否**逐分等于**其子科目合计（相等=父科目是派生行、不该当分录写）。v709 就是靠这两条把 169 万"缺口"证伪成 4 轮导入 + 12 个父科目双写，删完差 **0.00**、**不编任何调整分录**。
17. 🔴 **补丁脚本幂等判据：先判「新串已在位」，再看旧串唯一**。`NEW = OLD + 追加` ⇒ **OLD 是 NEW 的前缀**，写 `if n_new>=1 and n_old==0` 会**再替换一遍**（语法合法、静默劣化，v709 把 `total_equity +=` 改成 2 行、多加 98,325）。必须加硬断言 `count(new)==1`。同族：回读校验**不能全文扫**（同文件常有合法同构/同名局部变量）。
18. 🔴 **批量改库的白名单别用 `startswith`**：`tenant_*` 会抓到 `tenant_1.pre-v617-*.db` 历史归档，**改它=篡改证据** ⇒ 用 `^tenant_\d+\.db$`；判主库必须 `realpath`（macOS `/var`→`/private/var`），判不出路径 fail-closed。
19. 🔴 **改口径先双算，验证必须人造边界**：生产数据上「改与不改一样」时，跑接口证明不了生效 ⇒ 隔离库造边界值（1 分差必判平、2 分差必判不平）+ 一条**反向对照**（老判据在同组数结论相反，证明新判据有区分力）。**反向对照要程序化挑选**：手挑的边界可能老判据同样给 False，等于什么都没验证（v710 第一版探针就栽在这）。
20. 🔴 **改完脚本先传，再执行**（v710 事故）。脚本带 `--revert`/`--apply`/删除语义时，本地与服务端版本不一致 ⇒ 它做的事和你以为的完全不同，**而输出看起来完全正常**（"已从备份恢复"，只是恢复错了目录）。同族：`rsync` 与 `scp` 串 `&&` 前者失败不阻止后者。
21. 🔴 **判据要看语义分家**：`abs(a-b) < 0.01` 用在「两笔钱是否同一笔」上，浮点下同一事实给相反结论（`50.00-50.01=0.009999999999998010` 判相等 / `100.01-100.00=0.010000000000005116` 判不等；v710 双算 69,186 次比较里 16,456 次相反）；用在「这个数是不是零」上则无所谓（`> 0.005` 保持原样，别硬统一）。

## 近十一版一句话（细节 → `topics/recent-versions-v691-v709.md`）

- **v710** 对账判据按整数分（`money_eq` / `ROUND(,2)`）+ 月度快照改 GL 口径 + 顺修 `bank_auto_match` 的 `str - str` 崩溃（该函数**从来没跑通过**，金额一匹配就 100% 500）。生产存量影响 0（`bank_transactions`/`monthly_snapshots` 全库 0 行）。

- **v709** 期初凭证去重：169 万不是账不平，是 4 轮重复导入 + 12 个父科目双写；删 168 行后差 0.00。报表权益并入未结转损益（`unclosed_profit`）。资产 1018万→**225.8万**，`balanced` 双双→true。
- **v708** 科目树去重：父子一起加算两遍；**「只算末级」是错解**（`1122` 527 万记在父上）⇒ 递归「有非零余额子就用子，子全零才用父」；`parent_code` 全空串、父子只能按编码前缀。砍掉不带 `as_of` 的假绿灯（无 `balanced` 字段 + 资产差 8.7 倍）。
- **v707** 3 处报表平衡判据统一到 `money_balanced()`（整数分）；双算 0 翻案 ⇒ **别把"改了判据"说成"修好了红叉"**。顺修 `test_template()` 未定义 `d` 的存量 500。
- **v706 B2** 341 处账外裸 DDL **不用收编**（真故障 0），但藏着 9 个「先读表后建表」函数会 500，已补 ensure；新增 `extract_ddl_schema.py`/`check_ddl_parity.py` 补 doctor 反方向盲区。**主库不是 schema 超集**。
- **v706 B** 补 13 个索引（`IF NOT EXISTS` 不可信，执行后回读）；清租户库平台表副本（承重点是 `sales-targets` 的 `LEFT JOIN users`）；冻结 389 处 `_safe_migrate`（基线 + `--check`）；`money_balanced` 改整数分。
- **v705** 版本化迁移 + 精度常量：`schema_patches` 带 checksum；本包**绝不 import `erp_db`**；SQL 逐语句 + 显式事务。
- **v704** 工具条弹层面板必须压住它那排触发按钮：正解是**降按钮**（1101）不是抬面板（天花板 1121 被天气占用）。判据=面板矩形内 9 点 `elementFromPoint` 全归面板。
- **v703** 一键复制报单：`cellText` 给人读 / `cellRaw` 进文件，三套旧口径**删净不留空壳**；剪贴板/导出 xlsx/数据库三方逐格等价。
- **v702** 目标作用对象=供应商：`scope_key` 必须存**名称**不能存 id；候选异步晚到会让回显永久落空。
- **v691** 弹窗统一：布局留 slot wrapper；收编会凭空多出 ESC/遮罩关闭 ⇒ 必须开 `guardClose`。仍有 55 处手写遮罩未收编。

## 进度锚

卖前三关未过；调拨单生产仍 0 张。BI 唯一源 `_BI_MEASURES`（`soi.amount`）；库存周转 `get_inventory_turnover`。
脱敏红线：返利率/进货价/客户名/区域销量/厂家政策；PII 不落 `outputs/`。编号已到 **v710**（均已部署并重启；前端仍是 v704）。**新 schema 变更一律写 `migrations/patches/NNNN_名字.sql|py`，不要再往 `erp_db.py` 加 `_safe_migrate`（已冻结，`--check` 会拦）。**

## 待拍板（别自己开工）

1. 🔴 **凭证模板不能只补 CRUD**：`erp_db` 缺 5 个函数 + 路由 2 处未定义 `d`，但**最要紧的是模板根本不参与记账** —— `apply_template` 全后端只有 `/api/voucher-templates/test` 一个调用点，`auto_journal_for_*` 从不引用模板、`is_voucher_templates_enabled()` 零调用者 ⇒ 补齐后"配了不生效"，是假绿灯。建议 B：补齐 + 接进 4 个 `auto_journal_for_*`（flag `voucher_templates` 默认关），**需老板先拍「模板能不能改账」**。前端入口是静态 JS、无构建链，藏入口只能改 minified 产物（不该做）。
2. **对账匹配/内部往来仍有一处浮点判等**：`erp_db.py:18721` 内部往来 `matched` 判定；同类缺陷但 `ic_transactions` 全库 0 行、`entities` 表不存在 ⇒ 功能未启用，无数据可验。
3. **`get_pnl()` / `get_cashflow()` 仍是简化口径**（现金制 + `sale_orders`），`/api/reports/pnl` 只有传 `month` 且 GL 有数才走 GL 版 ⇒ 不带月份时利润表与资产负债表不同口径。改它要动仪表盘 KPI，需单独一版。

## 其它常查

- **v698 采购三入口**：生产「已审待执行」是 **`confirmed`**（不是 `approved`，生产 0 张）；`received_amount` 是 v403 才加的列、79 张舟谱导入单全 0；入库守卫/pay_mode 已认 `confirmed`，新增 `_po_received_amount()`（`received` 且列为 0 ⇒ 真值=订单金额，**`partial` 不猜**）。
- 字号：主力 **11–12.5px**（业界 13–14px），老板 2026-10-26 定**暂不提档**（笔记本 125%）⇒ 别再重复提议。`table-layout:auto` 下**列宽被内容撑开，改 width 无效** ⇒ 压列必须 `max-width`+省略号；采购退货页是独立组件自带一份宽度。
- **AI 成本口径（2026-10-26 实测）**：上游已是最便宜档 `deepseek-v4-flash`，全期 2759 次调用仅 **$2.38** ⇒ **换模型省不了钱**；真成本=每轮 `prompt_tokens`≈20,867 × 34~77 轮 ⇒ 杠杆顺序：提示词瘦身 > 轮数上限 > 缓存纪律 > 分档路由 > 换模型(0)。计量已改 `ai_usage_v2`（旧表记的是打字字数，差 3000 倍）：一次请求**只发一个** usage 块且是**循环累计值**，**绝不按 chunk 累加**；`prompt_tokens` 不能乘全价算成本（高估约 40 倍）；usage 里**没有** cached_tokens。当前只加读数不切拦截。
- 历史交付（P1-4 告警、P1-5 审计、consignment）→ `topics/backend-invariants.md`。
