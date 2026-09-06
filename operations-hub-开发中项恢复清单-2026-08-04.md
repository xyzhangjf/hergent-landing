# operations-hub「开发中」项批量恢复清单（v107.29）

> 日期：2026-08-04 · commit `01128be` · 线上 bundle `main-DGvIiWoM.js`
> 承接 v107.28（archive-hub 恢复），对姊妹面板「仓配/资金/财务/报表」4 组聚合菜单做同模式排查：**40 处 `dev:true` 实为已实现功能漏接 act，已全部接通**；保留 dev 85 项为确无对应页面。

## 一、已恢复项（40 处 → 接通对应入口）

### 仓配管理（+8）
| 面板项 | 接通入口 | 说明 |
|--------|---------|------|
| 配送单 / 线路设置 | `showDeliveryList()` | 配送路线管理（含优化路线），app.js:7092 |
| 盘点点写单 | `renderStockTake()` | 库存盘点页，app.js:1275 |
| 组拆单 / 组合拆分汇总表 | `render_assembly()` | 组装/拆卸模块，assembly.js:11 |
| 费用明细 | `navTo('marketing')` | 市场费用列表页 |
| 库存查询 | `navTo('stock')` | 库存页 |
| 银流水对账 | `showBankReconList()` | 银行对账列表，app.js:6528 |

### 资金管理（+18）
| 面板项 | 接通入口 |
|--------|---------|
| 收款单 / 付款单 / 客户收入单 / 供应商收入单 / 内部收入单 | `showPaymentForm()` |
| 预付款单 | `showPrepaymentForm()` |
| 客户费用单 / 供应商费用单 / 内部费用单 | `showExpenseForm()` |
| 客户对账单 / 客户对账表 | `showReconciliation('customer')` |
| 供应商对账表 | `showReconciliation('supplier')` |
| 核销单 | `showWriteoffForm()` |
| 员工交账 | `showSettlementForm()` |
| 银流水对账 | `showBankReconList()` |

### 财务管理（+7）
| 面板项 | 接通入口 |
|--------|---------|
| 凭证管理 / 科目余额表 | `navTo('ledger')`（凭证/科目余额表 tab） |
| 资产管理 | `renderAssets()`（固定资产页） |
| 折旧单 | `triggerDepreciation()` |
| 会计准则 | `navTo('gaap')` |
| 合并报表 | `navTo('consolidation')` |
| 资产负债表 | `navTo('reports')`（报表页 BS tab） |

### 数据报表（+7）
| 面板项 | 接通入口 |
|--------|---------|
| 销售订单汇总表 | `navTo('sales')` |
| 采购汇总表 | `navTo('buying')` |
| 应收账款汇总表 | `renderReceivables()` |
| 账户余额表 / 账户收支明细 / 收款明细表 / 付款明细表 | `navTo('accounts')` |

> 全部带 `if (window.xxx)` 存在性兜底：入口模块未加载时静默跳过，不会报错。

## 二、保留 dev 的项（85 处）与原因

| 类别 | 保留项示例 | 原因 |
|------|-----------|------|
| 无独立页面（前端缺） | 入库单、司机任务看板、挑货明细、WMS 控制台、预收退单、销售/采购结算单、其他应收/应付单、资金转账/调账单、成本类全套（重算/异常/核算单） | 后端部分有接口（fund-transfers 等）但无前端 UI，需专项开发 |
| 舟谱对标专用概念 | 静态盘占单（整仓/部分）、业务财务对照表、费用垫付核销、铺市/拜访系列分析 | 本产品无对应数据模型 |
| 报表占位 | 采购入库明细、盘亏汇总、收入汇总、费用合同执行跟踪、预付货量月记录等 40+ 报表 | 无独立报表页，属规划中 |
| 后端有前端缺 | 银行接口（bank_api 后端在）、自定义报表（custom-reports 仅导出扩展） | 需补配置 UI / 报表设计器 |

## 三、建议

1. **成本类**（重算成本/成本异常/出入库核算）是舟谱进销存核心差异功能，后端 `cost-adjustments` 等接口已在，建议优先补前端
2. **资金转账/调账**：后端 `fund-transfers`/`fund-adjustments` 已有接口，补两张表单页即可恢复 3 项
3. **报表类 40+ 项**：建议评估按「销售/采购/库存/资金/客户」分批落地，可复用现有列表渲染骨架
