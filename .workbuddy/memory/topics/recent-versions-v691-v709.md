# 近期版本完整口径（v691–v709）

> 本文件是从 `MEMORY.md` 拆出的明细，原文照搬，**未删任何一条**。
> `MEMORY.md` 只留一句话判据 + 指向这里。按版本号/关键词搜。

## v709 期初凭证去重（169 万不是账不平）（数据+后端，已部署）

🔴 **v707/v708 判「真账不平、要老板判断记哪一方」是错的**——真相是同一份期初被写了**两层重复**：
① `created_at` 四个时间点（15:33:47/15:36:26/15:38:37/16:01:03）各 52 行**完全相同**（老板点了 4 次，`import_coa_openings()` 无幂等）；
② 每轮里 **12 个父科目**各一行，金额**逐分等于**其直接子科目合计（舟谱「科目期初余额.xlsx」是明细表、父科目也有汇总行，脚本逐行当分录写）。

删 168 行后**借 = 贷 = 2,141,500.44，差 0.00**，**不编任何调整分录**。

报表口径补：`get_balance_sheet_gl` 权益并入**未结转损益**（6 开头科目净额 98,325.00，恒等式要求；不并入永远差一个"当期利润"），返回体加 `unclosed_profit`。

数字：资产 1018万→**225.8万**（不是钱少了，是原来算 4 遍）、试算表差 158.9万→**0**、资产负债差 169万→**0**、`balanced` 双双→**true**。

防复发：`import_coa_openings` 三重保护（幂等／跳父科目／平衡校验，不平则删净本次插入）。

验证 28+16+30，D 组**反向可证伪**（隔离库停用损益类 ⇒ 差额必须回 98,325）+ **回滚实证**（副本 `--revert`，168 行原样插回、精确回到改前）。

🔴 **幂等判据第二次栽同一个坑（反方向）**：`NEW=OLD+追加` ⇒ **OLD 是 NEW 的前缀**，沿用 `if n_new>=1 and n_old==0` 会**再替换一遍**（`total_equity +=` 出现 2 次、静默多加 98,325，语法合法）⇒ 正解「**先判新串在位**」+ 硬断言 `count==1`。

另两坑：`startswith("tenant_")` 会抓到 `tenant_1.pre-v617-*.db` 历史归档（改它=篡改证据）⇒ 用 `^tenant_\d+\.db$`；自检全文 grep 会命中 `import_coa()` 的同构结构 ⇒ **只截目标函数体**判。

## v708 科目树去重 + 报表口径合一（后端，已部署）

`get_balance_sheet_gl` 原来 `WHERE account_code IN (整类)` 汇总，**父科目和子科目一起加** ⇒ `1002 银行存款` 414,602.56 恰等于其 7 子科目之和算两遍（实测 8 个科目如此：160101/123101/1002/123102/160201/101502/101501/1901）。

🔴 **「只算末级」是错解**：`1122 应收账款` **527 万记在父科目上**、子科目全 0 ⇒ 只算末级会让资产掉到 327 万、**负债变 0**；同一账套里「父=子和（真重复）」与「钱记在父上（真余额）」**混在一起** ⇒ 只能递归：**有非零余额子就用子（父是派生），子全零才用父**。

三口径实测（as_of 10-26）：全科目 12,386,372.20 / 仅末级 3,272,671.32 / **叶子有效 10,181,137.96（采用）**。

**COA 层级字段不可用**：`parent_code` 124 个资产科目**全空串**、`level` 不可信（`101201` 标 level=1 而父 `1012` 也是 1）⇒ 父子只能用**编码前缀**（生产标准 4/6/8 位）。

连带砍掉**假绿灯**：不带 `as_of` 时走简化版（`equity=资产−负债` 凑等式 + **返回对象无 `balanced` 字段**，前端 `y.balanced !== false` ⇒ 显示「✓ 借贷平衡」但从未算过），两套口径资产差 **8.7 倍** ⇒ 只留一套；并删掉权益残差兜底。

数字变化：资产 1238万→**1018万**、资产负债差 389万→**169万**、试算表 06 月差 379万→**158.9万**。

⚠️ **此处「红叉不消失、169 万是期初真缺口要老板对账」的结论已被 v709 推翻**（那是两层重复写入，已清理归零）。

**最强验法**：试算表含损益/资产负债表不含 ⇒ `1,588,660.92 + 98,325.00 = 1,686,985.92` 逐分吻合；另一交叉印证：两时点资产负值各差 2,920（10 月 4 条凭证借贷相等）⇒ 差额必须相同。

探针 29/29（含反向可证伪：改回全加立刻 FAIL；子全零时父 700 必须保留）。

遗留：`save_monthly_snapshot()` 仍存简化版快照，与现报表不同口径。

## v707 报表平衡判据统一（后端，已部署）

3 处展示层判据从浮点 `abs(a-b)<0.01` 换成 `db/precision.money_balanced()`（整数分、容差 1 分）：`erp_db.py:6718` 试算表 / `db/queries/finance.py:102` 资产负债表 / `routers/voucher_templates.py:100` 模板预览。

**前端确实消费这三个字段**（minified js：「✓ 试算平衡/✗ 试算不平衡」「✓ 借贷平衡/✗ 借贷不平衡」），不是死字段。

**双算 0 翻案 ⇒ 界面不会变绿**：新老判据只在「恰好差 1 分」分歧，而生产真差 **379 万**。**别把"改了判据"说成"修好了红叉"。**

🔴 **验证必须人造边界**：生产数据上改与不改一样，跑接口证明不了生效 ⇒ `/tmp` 空库 + `ERP_DB_PATH` + import 生产同一份 `erp_db`，插「借 100.00/贷 99.99」必判平、「差 2 分」必判不平、**再加反向对照**（老判据在同组数判不平，证明第 1 条有区分力）。探针 16/16。

补丁脚本两坑：
① 幂等**不能用「旧串 0 次即已改」**——`import round_money` 是 `import round_money, money_balanced` 的**前缀**，会每次重复插入且语法合法（静默劣化）⇒ 先判「新串已在位」；
② 回读**不能用裸 `d.get(` 全文扫**——同文件另有 `create_template/update_template` 两处合法局部 `d` ⇒ 误报"未修"。

顺修存量 500：`test_template()` 里 `body` 读出来却引用未定义的 `d`（100% NameError，已用 `.bak-v707` 自证非本轮引入）。

**发现未修（④仍待拍板）**：**「凭证模板」整功能不可用** —— `db.voucher_template_list/create/update/delete/apply` 在 `erp_db` **全不存在**（`grep "def voucher_template_"` 0 命中），表 0 行、播种也 500，前端入口完整可见；flag 未登记 ⇒ 自动记账不受影响（一直走硬编码）。

第 2 类对账匹配（`erp_db.py:18675`、汇兑重估 7122/7140/7145）仍浮点，**未动**（有业务后果，须单独一版+双算）。

## v706 批次 B2：账外 DDL 对账 + 9 处懒建表读路径（后端，已部署）

结论=那 **341 处账外裸 DDL 不用收编**（生产实测**真故障 0**），但它们藏着 **9 个"先读表、后建表"的函数**（QMS 3 / 招聘 2 / WMS 3 / 递延 1），第一次点进那 8 个模块就是 500，已补 ensure（照抄 `inspection_plan_create()` 的首行写法，**DDL 不复制第二份**）。

新增两把只读尺子：`extract_ddl_schema.py`（AST 抽 342 表/355 列，**建表语句交 sqlite 解析**列，别自己拆逗号）+ `check_ddl_parity.py`（6 类定性、`--fail-on-fault` 退出 2）—— 因为 **doctor 只能看"主库→租户库"一个方向**，看不见"代码里有、哪个库都没有"。

🔴 两个新事实：**主库不是 schema 超集**（9 列只在租户库，ALTER 写在只遍历 `tenant_*.db` 的 `_patch_tenant_*` 里）；**独立库模块**（`memory.py`/`bid_radar_collect.py`/`kingdee_connector.py`）要对账排除，否则全报假故障（清单 `migrations/other_db_modules.txt`）。

踩坑：补丁脚本幂等扫描窗口越界会看到**下一个函数**的 ensure ⇒ 静默少改（`--strict` 断言目标数）。

隔离实证：空库跑改后函数自动建表、摘掉 ensure 立刻 `no such table`。测试 139 项全过。

## v706 批次 B：补索引 / 清遗留副本 / 冻结存量 / 修精度（后端，已部署）

① **补索引**（patch 0002）：tenant_1 缺 4、tenant_10 缺 9（含唯一 `uq_product_target_month`）；**不要信任 `IF NOT EXISTS`** —— 同名非唯一索引存在时它会静默跳过，必须执行后回读 `sqlite_master` 并核对 UNIQUE。

② **清遗留副本**（patch 0003）先证伪，结论是**证伪失败**：`tenant_1.users` 有 6 行真 bcrypt 哈希，唯一承重点是 `GET /api/sales-targets` 的 `LEFT JOIN users`（真实员工在主库，种子快照里查不到 ⇒ `user_name` 恒 NULL 的静默错）。三处同修=端点改"租户库取目标+主库取名合并"、**`tenant_db_init()` 不再复制 6 张平台表（断复发，否则新租户立刻再长一张空 users）**、patch 0003 删表且**主库自动跳过**。🔴 主库守卫必须 `realpath`：macOS `/var`→`/private/var`，`abspath` 比较会把主库当租户库删表（离线测试第一次就踩中）；判不出路径要 fail-closed。

③ **冻结 389 处 `_safe_migrate`**（不是 359）：**不逐条改写**（负收益），立 `legacy_baseline.txt`（387 条名字+指纹）+ `--check` 拦"改历史迁移内容/新增裸 DDL"两类静默病；**账外裸 DDL 仍有 341 处**（`db/queries/*.py` 42 处是同一批迁移的第二份拷贝）未清。

④ **修 `money_balanced`**：老判据 `abs(dr-cr)<=0.01` 下同一笔 1 分差结论相反（100.00/99.99 拒、1234.56/1234.55 过）⇒ 改按整数分；**改口径先双算**（29 张凭证零翻案）+ 生产真跑一次验证全链路。测试 28+18+14+43 全过，doctor 3/3 干净。

## v705 批次 A：版本化迁移 + 精度常量

（后端新增 `migrations/` 包 + `db/precision.py`；既有代码只改 4 处）

① **`_migrations` 只记 name+status ⇒ 改过的迁移不会重跑也不会报错**：名字没变就判"已执行"，于是老库按旧 SQL、新库按新 SQL，**两台都声称 ok 结构却不同**，日志里永远看不到。新表 `schema_patches` 带 `checksum`：改已执行版本 ⇒ 运行器**直接失败**（要改就加版本号）；**失败版本允许原地改内容重跑**（它从未生效）——这条区分是核心。

② 🔴 **本包绝不 import `erp_db`**：它在**导入期**就执行 359 条 `_safe_migrate`（会写库），体检工具一旦 import 它，"跑一下看有没有漂移"本身就在改生产 ⇒ 全包直接用 `sqlite3`。

③ SQL 必须逐语句执行 + 显式事务，**不能用 `executescript()`**（隐式提交 ⇒ 中途失败留半截库）。

④ 平台表清单做成**文件**（`platform_tables.txt` / `legacy_platform_copies.txt`）不是代码常量，可 diff 可 review。

生产实测抓到的真问题：`tenant_1` 缺 4 索引（1 个唯一）、`tenant_10` 缺 9（2 个唯一，**`uq_product_target_month` 缺 = 可写重复月度目标**）、两库各有 4 张遗留平台表副本（含 `users` 密码哈希，旧 `backup()` 整库复制事故残留）、`purchase_orders#179 total_amount=920.004`（REAL，84 张里 2 张超 2 位小数）。

纪律：**batch A 只加常量不改口径** ⇒ `money_balanced` 连浮点缺陷一起原样保留（`100.00-99.99 > 0.01` 判不平衡），修它属业务口径变更放 P0-4。

运维：`python3 -m migrations.doctor`（只读体检）/ `runner --apply --all-tenants`，退出码 2=需人看、1=工具崩。验证 38/38 离线 + 生产临时库 `import erp_db` + 4 接口 200 + 打基线只增 1 表。

## v704 工具条弹层面板必须压住它那一排触发按钮

（`variables.css` 新增 `--z-page-trigger:1101` / `--z-page-pop:1116`；`Forecast.vue` `.tb-pop` / `.tb-pop-panel` 改用它）

症状=「导出」下拉展开后一条**遮挡带**：面板从 y156 向下 356px，正好罩住表体工具行的「品牌/到货周期/复制报单」（y221–253），而那三个按钮当时是 **1120 > 面板 1101** ⇒ 浮在面板上**并劫走点击**（点面板中部会莫名打开到货周期筛选，探针 `elementFromPoint` 在面板矩形第 2 个采样点命中的就是那个按钮）。

🔴 **不能靠抬面板修**：页面内浮层天花板 1121 已被天气 `.wx-pop` 占用且是四处注释契约的基准（`Shell.vue`/`forecast-modal.css`/`Forecast.vue`）。正解=把按钮**降**回它真正需要的档：1120 的原意只是「> `.pop-overlay` 1100 ⇒ 弹层开着仍可直接点别的触发按钮做互斥切换」，1101 就够。新全序：遮罩 1100 < 触发按钮 1101 < 面板 1116 < 天气 1121 < 外壳 1122 < 模态 1125。

连带两处必修：① `positionTbPop` 的 `w=240/estH=320` 是估值，实测 242×356 ⇒ **面板提权后翻到上方会盖住自己的触发器**（看不到"开着"、点不掉），改成**实测 + 选空间更大一侧 + 把 max-height 钳到该侧**（`popStyle.maxHeight`，空串时 Vue 移除属性，CSS 的 62vh/70vh 照旧）；② `.tb-pop-panel` 补 `max-height:calc(100vh-16px);overflow-y:auto` 兜底（1366×420 下面板高 256、内部滚动）。

判据不是 z-index 数字，而是 **面板矩形内 9 点 `elementFromPoint` 全归面板、且面板矩形与触发按钮永不相交**（1600×1000 / 1366×640 / 1366×420 三档）。探针 `tests/perf/v704/zorder.mjs` **23/23**，回归 v703 的 23 + 24 全过。

探针坑：**工具栏弹层不监听 ESC**（ESC 是 Modal 的）⇒ 拿 `keyboard.press('Escape')` 当关闭会静默失效、下一轮 click 反而 toggle 掉、报 `{err:"missing"}` 假 FAIL；关闭态要判触发按钮的 `.on` 类。另一坑：`.brand-pop`/`.copy-pop` 也带 `.tb-pop-panel` 类 ⇒ 数面板不能用 `querySelectorAll('.tb-pop-panel').length`，要按内容识别。

## v703 一键复制报单数据（`Forecast.vue`）

用户口径原话：「**只复制数字，列从『周运潘』开始、『备货』结束**，行从商品第一行到最后一行；按品牌筛选就从筛选后第一行到最后一行」⇒ 复制**报单对象列段**（`cross.units` 全段，生产实测 19 列，顺序=`MIN(s.id)`），**无表头/无商品名/无汇总列**；`\t`+`\r\n`，空格**留空不写 0**。

根因=屏幕/导出/打印**三套口径**（旧 `gridHeaders` 缺 4 个汇总列、客户空格写 0、行序不看筛选；`filteredRowsForExport` 自己重写筛选还漏品牌/到货周期）⇒ 立 `cellRaw/screenRowItems/screenColumns/screenHeaders/screenRowCells` 为唯一实现（列=colOrderList、行=flatItems），三套旧函数**删净不留空壳**。

两条取值纪律：`cellText()` 给人读（千分位/`—`/`/箱`）、`cellRaw()` 进文件（纯数值/空串），混用会让 TSV 变文本无法求和。入口并入「导出」下拉（**不新增工具栏按钮**）。

验证 `tests/perf/v703/copy.mjs` 23 + `copy-real-data.mjs` 24，**剪贴板/导出 xlsx/数据库三方逐格等价**。

探针三坑：① 首列表头是**齿轮**（`innerText` 空）⇒ `filter(Boolean)` 会滤掉整列、列索引集体左移、冒「31 vs 30 列」假 FAIL；② 「分组方式」在**列设置弹层**里，弹层没开时 select 根本没挂载；③ 期次 38 生产**报单 0 条** ⇒ 复制全空是**对的**，先查 `COUNT(*)` 再下结论。**探针别写死版本号**（`=== 'v703'` 每版必冒假 FAIL）⇒ 用 `>= v703`。

## v702 目标作用对象＝供应商（`components/rebate/SupplierPicker.vue` 新增；`TargetFormModal` 改）

`dimension` 不动（brand/product 只决定表单形态），**后端零改动**；新建多选=**扇出 N 条独立规则**（名加「· 供应商名」），编辑恒单选。

四条硬判据：
① **`scope_key` 必须存供应商名称、不能存 id** —— 后端 `rebate_rules.py:1125` 对 brand 强制 `scope_key=scope_name`，且返利按 `(月份,维度,scope_key)` 配对**达成**（`rebate_achievements.scope_key` 是导入的名称原文）⇒ 用 id 永远配不上、返利一笔算不出；代价=供应商改名旧目标失联。
② **候选异步晚到会让回显永久落空**：`init()` 早于父页拉供应商 ⇒「简爱」被永久判"未绑定"（init 只跑一次）⇒ 监听 `supplierOptions.length` 补匹配，且**不覆盖用户已改的选择**。
③ `DELETE /api/rebate-rules/{id}` 默认**软删除**，测试清理要 `?hard=1`；"没建成所以没东西删"会让清理断言**空转 PASS** ⇒ 判据写「建成 N 且残留 0」。
④ 探针写操作要 **CSRF 双提交**（cookie `csrf_token` == header `X-CSRF-Token`），只注 `erp_token` 会 403 看着像功能坏了。

前端两坑：**`watch(getter)` 立即求值** ⇒ 引用后定义的 ref 即 TDZ 白屏；**`.ui-modal-body` 有 `overflow-y:auto`** ⇒ absolute 浮层被裁，选择器必须内嵌面板。

诚实性：生产 `pinyin/pinyin_first` **0/38 有值** ⇒ 界面不承诺拼音搜索（探针有反向断言守着）。验证 38（线上真实会话）+ 9（真写库扇出、硬删自证残留 0）。

## v691 弹窗全站统一（`components/Modal.vue` 收编 20 文件 40 弹窗）

三条硬判据：① 弹窗内部布局必须留在 **slot wrapper**（`.ba-fields`/`.df-body`…），放组件里父页 scoped 后代选择器就命中不到；② **类名透传不是解法**（v-if 挂载照样打不到组件内部元素），试过已弃；③ `#header` 只换标题、**关闭按钮永远由组件渲染**。

层级统一 **1125/1130**（原来 7 处倒挂：`.pc-mask`/`.rm-modal` 只有 60）。**收编会让 16 页凭空多出 ESC/遮罩关闭** ⇒ 必须开 `guardClose`（判据=纯 DOM 级 `input`/`change` 才算动过，第一下只提示第二下才关），不能让各页自己写 isDirty。

补验口径（`tests/perf/v691/gaps.mjs`，线上 14 目标 133 断言 0 FAIL）：
① **「有输入控件」≠「用户动过」**——探脏必须先派发 `Event('input',{bubbles:true})`，否则把好弹窗判 SKIP；
② **内容容器是 `.body > .content`，不是 `.main`**（用 `.main` 判渲染会恒 null、把正常页误判白屏）；
③ 复杂弹窗入口多为 **URL 子页 + 卡片**，不是顶部按钮（`ConnectCenter` im/erp/datasource/**skill**、`Rebate` settle/promises/rules、`ReportMapping` forecast?tab=config、`LossAccounting` **?tab=fill** 才有 `.la-bar`）。

**覆盖边界**：全站**仍有 55 处手写遮罩**（`Forecast.vue` 14、`Rebate.vue` 10 为主）未收编 —— 别说成「全站唯一弹窗骨架」。
