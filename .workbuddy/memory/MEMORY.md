# Hergent 记忆索引（路由 + 召回锚(§) + 硬判据；细节下沉 topics/）

> 目标 ≤4.3k 字；再涨先下沉 topics/。v484–v496 流水/撞号/部署铁律 → `topics/changelog-v484-v496.md`。

## 路由
- 前端 → `topics/frontend-ui.md`：🔴 `pages.js` 入口唯一源(未登记=失门禁)§v209；🔴 `permView.js` 唯一源、`module:null`=只读§v348；🔴 文案三禁⇒`hergent-ui-copy-guard`§v331；🔴 单入口→多子页(`?tab=`+`watch`)§v424；🔴 列设置齿轮共享 `useColSettings`/`ColMenuPanel`/`col-menu.css`(v432)；🔴 图表唯一源 `src/components/chart/`(v491)：颜色只写 `var(--chart-N)`，导出 PNG 必须内联实际色§v491；🔴 列表页冻结/密度B/本页合计 `psi-list.css` `.freeze-list`：v511–v514 全覆盖 14 页§v511–§v514；🔴 v515–v517 侧栏与按钮系列（v517 老板口误「这个不去掉」⇒按钮恢复；页内下钻与侧栏暴露互不绑定）。⚠️ 只删菜单项，路由与 `pages.js` 登记一行不动：`/data-fill` 仍被多处依赖；删登记会把门禁从 `BIZ_ROLES` 放宽给所有人§v515–§v517。
- 建单/建退单 → `docs/进销存建单页开发规范-v441.md`：🔴 三层高度链｜框式头 `.‹pfx›-hd-box`｜同 path 两 query ⇒ computed+watch｜幂等键成功立刻换；🔴 §R 视觉基准(真机 getComputedStyle)；🔴 `npm run build` 被 safe-delete 拦 ⇒ 隔离 `outDir dist-vNNN`；🔴 v449 起 7 页独立(`docTypes.js`=路径+配置唯一源；`redirect` 不指定 `query` 会继承原 query⇒显式 `query:{}`)。坑六条见 `topics/inventory-psi.md`。
- 后端 → `topics/backend-invariants.md`+`backend-auth.md`：🔴 路由遮蔽先注册者胜§v317；🔴 静默失效=恒空恒0零报错⇒`undefined-call-scan.py`；🔴 幽灵 inode§v289；🔴 门禁用接口模块非页面模块§v328；🔴 FastAPI 未声明 query 参数被静默忽略§v443；🔴 委派链只在唯一源函数加参数；🔴 limit<=0 落回默认；🔴 「从未被执行过的代码」≠安全的§v449。
- 部署 → `topics/deploy-ops.md`：🔴 后端 FLAT `/opt/hergent-erp/`、前端根 `/opt/hergent-cn-v2`；🔴 后端服务名 `hergent-erp.service`(cwd `/opt/hergent-erp`)；`hergent-server.service` 是遗留 Credits Server——重启错既加载不到新代码又拉起遗留服务，判据 `ss -ltnp`→`readlink /proc/<pid>/cwd`§v498；🔴 部署前端前必先 `git fetch`+`git status -sb`，本地落后就构建=把他人已上线功能整体回退§v509（部署后再 fetch 一次防并行回退）；🔴 判据「线上跑谁的构建」=`index.html` entry+该 entry CSS 有无本轮新增类名(只看 chunk 名会误判，旧 chunk 仍在 `assets/` 并集)§v498；🔴 并集存在⇒全目录 grep 零判别力，探针须打在「当前 entry 接线的 chunk」§v517；🔴 生产 `assets/`=并集，绝不 `--delete`；🔴 未登录 curl 探端点拿 401、假路径也 401 ⇒ 探针零判别力⇒改走进程内路由表探针(`from routers.psi import router`+`inspect.signature`，带阳性对照)§v500。
- 预报主表 → `topics/forecast-order-domain.md`：🔴 报单单位永不落大单位(真身 `products.order_unit`)；🔴 价格双轨；🔴 报单≠提货、`forecast_audit` 锚 `MAX(order_date)`；🔴 跨期复制只复制品清单⇒复0行传染§v282；🔴 自动化死锁§v354。
- 返利/目标 → `topics/rebate-domain.md`｜货损效期 → `topics/expiry-loss-domain.md`：🔴 适用月份只写到当月⇒次月规则静默消失§v376；🔴 进得去≠读得到(403被吞)§v353；🔴 到货停单⇒期次不自动建§v364。
- 进销存 → `topics/inventory-psi.md`：🔴 八页继承父行门槛、`pages.js` 不改；🔴 入库批次三列不写⇒效期全空；🔴 FEFO 不足整体拒绝、`sale_order_deliver` 只收 `draft`；🔴 列设置上云、`extra` 空则不加列§v403；🔴 销售/采购退货可不挂原单、调拨走 `transfer_orders` 真双仓(失败必 `raise`)、无调拨退单(v449)；🔴 三页共用 `StatusTabs.vue` 计数必须服务端、后端 counts 口径=忽略 `status` 保留其余筛选§v498；🔴 退单三入口接真表(v500)：`status='returned'` 全系统无人写⇒退单真身在 `return_orders`/`purchase_returns`，counts 用黑名单 `='draft'`§v500；🔴 v509 七列表页布局统一(`StatusTabs`#actions 插槽/筛选同行/`PsiPager.vue` 刻意不统一 PAGE_SIZES)。🔴 删页头硬前提：标签名逐字承接被删页头 `<h2>` 原文⇒`tabTitles.js::QUERY_SUB_TITLES` 优先、`docTypes::shortTitleForList` 回落§v509。
- 审批流(P1-2, v519 前端 + v525/v525b/v525d 后端) → 后端引擎 `server/routers/approvals.py`(6 端点 `/api/approvals`：submit/approve/reject/pending/flows/setFlow)，状态机 `draft→pending_approval(逐节点)→approved→执行`；`boss`/`admin` 恒可审、节点按 `chain[node].role` 匹配；前端只接 purchase/sale/transfer；生产采购链已配 `supervisor→boss`；新端点未登录返401，改进程内探针。前端 `src/api/approvals.js` 薄壳，契约 `client.js` L248 裸 dict 透传§v519。
- **进销存岗位分权(P1-1, v517 + v526 销售员开门)**：v517 会计/主管能进能建不能改删(`canUpdate` 收口，未拆子模块)；🔴 **v526 销售员行级隔离**：采购/调拨列表对 `sales` 注入 owner 过滤(`creator=operator_id=str(u.get("id"))`)，销售列表经 `list_sale` B1 已天然隔离，`transfer_order_list/count/counts` 新增 `operator_id` 过滤；**「开门」=老板在权限页给角色勾 `inventory` 模块(read+update)，零前端代码改动**；🔴 **绝不可把 `sales` 加进 `PSI_ROLES` 名单**——`pages.js` L199-200 警告：直接加=把进价默认白送给所有租户销售员(跨租户红线)。
- 报单/小程序/品牌 → `topics/miniprogram-and-brand-data.md`｜副驾/AI → `topics/ai-copilot.md`(`ai_tools`=只读SQL、数量类先GROUP BY)｜通知 → `topics/notification-center.md`(四层；`event_key` 现算改名即静音§v351)｜IM → `topics/im-channels-v131.md`｜业绩提成 → `topics/sales-reports-and-operator-attribution.md`｜对账 → `topics/reconciliation-redo.md`。
- 新用户/价格/换算/客户档案 → `topics/onboarding-and-archive-gate.md`：🔴 价格真身 `customer_prices`(中/大=小×换算比)；🔴 换算权威 `products.large_ratio/medium_ratio`；🔴 客户档案列表必传 `type=customer`。
- 🔴 跨域铁律 → `topics/cross-domain-iron-laws.md`｜🔴 多会话并行总控 → `topics/parallel-dev-protocol.md`。
- 🔴 协作规范与交付流程(单一可信源) → `docs/Hergent-开发团队协作规范与交付流程.md`：RACI/极简指令/版本号全局序列/one-Edit-at-a-time+scoped 提交/部署三件套/多租户红线/五段交付摘要。派生：`docs/Hergent-发布前自查清单-Checklist.md`(缺五段摘要=不验收硬卡点)｜`docs/Hergent-代码评审与安全债治理.md`(S1–S5/11 共享接口红线)｜`docs/进销存模块差距分析与分阶段开发计划.md`(八维度差距+P0–P3+§九进度快照)｜`docs/进销存P0阶段任务卡.md`(P0 7/7 全闭环)｜`docs/进销存P0-5占用锁定技术方案.md`(🔴真实 `/api/psi/` 后端不在本工作区，根 `server/` 是遗留 `/api/erp/` 旧版)。
- 🔴 进价/价格口径 → `docs/进销存商品进价口径待办清单.md`：权威价源=舟谱《采购订货明细报表》(采购价列=小单位真实进价；表头第5行、数据6~1704、**1705行合计必须排除**)；`products` 有三套条码列 `barcode`/`medium_barcode`/`large_barcode`；🔴 批量改价前必须按「条码+单位名称」分组(同条码混记大/小单位，直接加权平均得无意义值)§v508；🔴 WAL 库备份禁用裸 `cp`，改 `sqlite3 .backup`/`VACUUM INTO`；`get_profit_report` 的 cost 含 amount=0 赠品行⇒单品毛利率会被打负；报缺价数必须带口径名(全量132/活跃68/活跃有销售22/近45天有实际销售额3)。
- 🔴 蒙牛两户头=福宝/恒滋(`products.ordering_entity`：福宝54/恒滋2/空417)；商品名「(恒滋下单)」=走恒滋户头路由标记。🔴 下单侧档案家族=25个，「组/板/包/提」大单位档案，销售跑在小单位兄弟档案上⇒对 `get_profit_report()` 贡献恒为0、不进报表，不要改进价。⚠️ `can_sale` 全库473个全为1=死字段，靠它屏蔽前必须先核实代码是否读取。

## 待修 → 详情 `topics/inventory-psi.md` §待修
✅ 原登记4项已于 2026-10-16 全实核为「已闭环」(教训：待修清单须定期回扫)：销售退货列表恒空(v500)｜采购退货候选含不可退(P0-2)｜`?copy` 空单号被静默吞(P0-7，仅采购页已修)｜`col-prefs` 400(P0-6)｜调拨无列表页。
🔴 阶段进度(2026-10-16 v526 后)：**P0 7/7 全落地**；**P1 4/6**——P1-1 岗位分权 v517 + **P1-1 第二期销售员开门 v526(后端行级隔离，开门靠权限页勾 inventory)**、P1-2 审批流 v519/v525、P1-3 四张报表 v506+v507；P1-4 自动勾对/P1-5 批次追溯未动；P1-6 批量栏反向(v510 删三页工具栏待回补)。报表区33入口仅4真身29占位。⇒ 卡点已转移：销售员进门已解决，剩「对账/批次追溯靠人工」=P1-4/P1-5。
🔴 v517 分权三坑(改权限前必读)：① `_DEFAULT_PERMS` 只管没被租户库覆盖的角色⇒tenant_1/10 的 accountant/supervisor 是存量覆盖，必须迁租户库(v293/v325/v332/v333 同族栽四次)；② `_perm_granted()` 里 list 格式=该模块全部动作放行，只有 dict 才按 read/create/update/delete 细分⇒给 list 格式角色 append 模块名=送全权限；③ 前端写操作曾全用 `canDo('inventory','create')` 一把梭⇒只给 create 等于把改删一起送出，v517 已改挂 `update`(采购列表6+采购详情15+销售列表1+销售详情1)。
🔴 erp 后端源码仓=`/Users/zhangjunfeng/Documents/hergent-erp`(分支 `upgrade/v84-international`)；生产 FLAT `/opt/hergent-erp/core.py`(无 `server/` 前缀)，两处须分别改。⚠️ 护栏「MODULE_IMPACT 入口页↔pages.js module」自 v465e 起 FAIL(sales缺3/stock缺6/reports缺4)——未修，单独立项。
🔴 当前待修 P0：副驾「已读不回」(老板连回3次「要」0回复，请求没进后端)——见 `hergent-capability-reality-audit` 技能。

## 技能路由 → `topics/skill-routing.md`
🔴 `hergent-pre-launch-audit`｜`scoped-commit`｜`parallel-session-safety`｜`rebate-caliber-consistency`｜`chart-render-verify`｜`ui-copy-guard`｜`external-material-pdf`。

## 编号约定
🔴 号=全局共享序列⇒起号前必读 `topics/version-history.md`+**实搜 `git log --all`**+`git worktree list`(只看记忆不够，v509 付学费：照记忆起 v501 实际 v501-v508 已用完)。⚠️ 2026-10-11 一天内 v452~v469 用光。
🔴 改 `pages.js` 前先分清它管「路由」还是「门禁」：本项 `pages.js`=门禁唯一源(不生成路由)，`ruleFor()` 对未登记 path 一律放行⇒删占位页登记=把 boss 硬锁放宽给所有人(v499 差点踩)。
🔴 删侧栏条目必须带阳性对照(断言同区另一该在项仍在)。🔴 侧栏重复入口(v465 复用同 path+tab 遗留)：已删「数据报表›实时概览」v497、「市场营销›供应商返利方案」v498、「返利试算」v499、「进销存›库存查询/库存效期补录」v515。

## 主体/脱敏
hergent-cn-v2(`laozhangai-product`)｜hergent-erp(FastAPI+SQLite)｜🔴 脱敏红线：返利率/进货价/客户名/区域销量/厂家政策；仓内含生产凭据明文⇒远端须 private；PII 不落 `outputs/`。

## 本机坑 → `topics/local-machine-pitfalls.md`(§10–§44)
🔴 `grep "A\|B"` 静默失效⇒`-e`；`&&` 短路；`| head -N` 截命中；`grep -rl` 只搜顶层；zsh 通配无匹配 abort；探针别放 `/tmp`。⚠️ 跨机不一致(v509 付学费)：macOS BSD grep 的 BRE 不支持 `\|`⇒一律 `grep -E "(a|b)"` 或 `-e a -e b`。🔴 工作区文件会被静默回退⇒改长文档前先 `wc -l` 与 HEAD 核数。🔴 rebase/FF 前查未跟踪的 `YYYY-MM-DD.md`(v516 付学费)。🔴 ssh 里嵌 python `-c` 多层引号转义错乱(v517 学费)⇒远端字符串解析改在本地产物上做或写脚本 scp 跑。
