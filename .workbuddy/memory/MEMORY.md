# Hergent 记忆索引（判据+索引；细节在 topics/*.md 与 docs/）

后端 hergent-erp(FastAPI+SQLite多租户)，本地 ~/Documents/hergent-erp 带 server/ 前缀；线上 root@47.113.224.140 /opt/hergent-erp 扁平、不在 git（直接 ssh 打生产，本地打完回写）。前端两套：/opt/static(erp.hergent.cn，直改 minified main-*.js，无源码)｜/opt/hergent-cn-v2(hergent.cn，有构建链 npm build+rsync assets+scp index.html)。备份 /opt/hergent-data/backup/。

按域查：写库/建表/租户隔离→backend-invariants｜迁移→migrations/README.md｜报表→report-platform｜浮层→frontend-ui｜部署→deploy-ops｜单位/商品→inventory-psi｜鉴权→backend-auth｜预报→forecast-order-domain｜返利→rebate-domain｜货损效期→expiry-loss-domain｜副驾→ai-copilot｜并行→parallel-dev-protocol｜静默失效全文→v629-silent-failure-family｜账务全文→accounting-gl-v716-v717｜近期版本→recent-versions-v691-v715。

## 静默失效家族（必读，全文 v629 附录）
1. 接口200/界面正常/mock全绿≠生效；判据只用用户可见字面量，依赖枚举/存量须落生产真实数据(GROUP BY status先验)。
2. 写库必 get_db_tx()；新路由必登记 _PATH_MODULE_MAP(fail-closed，未登记403连boss都打不开)→「页面能开」≠「接口能调」。
3. 动SFC必重构建重部署(scopeId派生)；传整个 dist/assets/、绝不--delete，scp index.html+双侧md5。
4. 改了没变先查 __HG_BUILD__(src/main.js发版前先升)；懒加载chunk不在index.html；SPA老标签页不重拉。
5. 🔴 搜不到先排除搜错范围/被截断/判据错：Bash grep "A\|B" 静默空(用Grep或-e)；|head -N截关键命中；grep -rl只搜顶层；注释数字会过期→从数据源数。
6. 临时登录态只插主库 erp.db sessions，测完删净自证残留0。
7. 🔴 部署前 mv dist/assets/* 到/tmp(vite emptyDir被safe-delete shim拦>50文件)；rsync与scp串&&前者失败不阻止后者→传完ls新chunk。
8. 🔴 改过迁移不重跑也不报错→新变更走 migrations/patches/NNNN_*(带checksum)；别 import erp_db做体检(导入即跑迁移写生产)；补丁幂等三件套(OLD是NEW前缀时通用判据失效，改按已应用形态判定)。
9. 🔴 真登录探针：/opt/static认localStorage.hergent_token(不认cookie)；hergent.cn认hergent_v2_token+hergent_v2_tenant，须addInitScript在页面脚本前注入；user_id=1(admin)被踢用2。
10. 🔴 真身页+表0行=从未启用；接口有入口无=功能不存在(表0行时grep页面里的调用不是定义)。
11. 弹层本体必须高于触发按钮(v704遮挡带静默劫走点击)；列宽按最不利密度、操作列≥72。

## 账务域铁律（动账前必读 accounting-gl-v716-v717 全文）
- 成本判据恰为0(to_cents(total_cost)==0)不能<=0(退货单负额整单吞，毛利差2.79点)。
- 调拨单 order_type='transfer' 不能当销售(251张金额0但成本55万，毛利掉6.3点)。
- 费用四段硬断言：四段之和逐分等于total_expense(money_eq)，不平直接raise。
- 配了但没人读=没生效(先grep引用数，0就别信)；回落现金制须加month_vouchers。
- 探针断言别写死历史值(88,776→88,874)。

## 生产数据实况(2026-10-28)
收入878.61/成本778.51/毛利100.11万(11.39%)01~09 accrual；库存v728按舟谱快照重建281行/15.69万/0负；资金域16账户期初116,638.05。动账须跑：净利合计==unclosed_profit、balanced、不平凭证0。

## 进度锚
v730 P0-S1库存金额化(patch0011+9写入点)｜v731 P0-S2库存内核重构(inventory_balance+stock_ledger单一写入口，未部署)｜v731②数据健康S3(8卡，未部署)｜v722资金域16账户｜v723报表平台化(report_definitions+执行器+GenericReport.vue 29条/reports/*，前端v656)｜v724~v726报表修正/图表化｜v727补录1-10月｜v728库存重建｜v729合并8组重复商品｜v732 ④仓配闭环(W1拣货波次/W2预留reserve.py/W3库位，lock:true仅老板；backend 3d45452/08be6d3 + frontend a65c8ae)。**2026-10-29 已部署**：backend patch12/13/14 ok、新端点带鉴权200；frontend 从a65c8ae隔离构建(剥report路由改stub避免拖垮构建)+rsync assets+scp index.html，双侧md5一致、HTTP200。
**2026-10-29 ⑤验证**：29定义全配SQL，faithful复刻执行器(validate_sql+_build_params，只读RO)在tenant_1.db实跑→26张返回真实数据(3张大表截断5001)+3张kind=unavailable占位+0拒绝0报错；前端⑤组件(modules.js+GenericReport.vue+ReportBuilder.vue)已部署hergent.cn待commit；4张0行(income-summary/receipt-detail/payment-detail/attendance)源表空疑似口径指错表待核对。

## ⑤ 报表平台化(已上线·2026-10-29验证)
v723落地report_definitions+执行器(routers/report_engine.py，仅在生产/opt/hergent-erp，本地server/旧扁平结构未含→源码待回收)；前端modules.js(reportEngineApi)+GenericReport.vue+ReportBuilder.vue(老板门禁)已部署hergent.cn。
**29定义全部已配SQL**：faithful复刻执行器在tenant_1.db只读实跑→26张返回真实数据(3张大表截断5001:account-flow/customer-profit-analysis/sales-order)、3张kind=unavailable占位(material-data/material-usage/stock-upload)、0拒绝0报错。此前"25张报Incorrect number of bindings supplied"是带参SQL用`SELECT COUNT(*) FROM (<sql>)`空跑未绑定参数的测试假象，非执行器行为。
**4张返回0行(执行正常但源表空，疑似口径指错表)**：income-summary(income_orders)/receipt-detail(payment_receipts)/payment-detail(period_payments)/attendance(attendance)——tenant_1这些表无数据，真实收入来自签收单signed等，待核对重定向源表。
**待办**：①后端report_engine.py回收进仓库(生产routers/+db/结构与本地server/扁平不一致，先对齐再落，否则落本地无法import)；②4张0行报表口径重定向；③调拨双入口合并(v725已合并，见topic)。

## 待拍板
- 凭证模板入口(v711后端齐flag默认关，前端无入口)；补历史数据(舟谱1-9月采购/银行流水/费用)；v717三处妥协；三处旧账(BS tab仍—、cashflow仍现金制、对账浮点)；利润表卡片截断。
- 卖前三关未过(连续3月零事故/跑通N笔真实交易/数据隔离验证)。
