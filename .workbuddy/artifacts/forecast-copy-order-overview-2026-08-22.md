# 预报模块：舟谱双字段对齐 + 一键复制下单

## 交付摘要
按用户拍板（① 保留分销价/标准售价双字段 ② "XX下单"子行保持拆行）+ 新增硬需求（页面可复制厂家编码+数量直接粘厂家系统下单），完成预报模块与舟谱订单表的字段对齐与复制能力。

## 后端改动（hergent-erp/server）
- `erp_db.py`：主库加 `products.dist_price`（v110 迁移）；租户库补丁循环（P1-4）同步加 `dist_price`。厂家编码复用既有 `products.product_code`（=舟谱"永辉代码"），未新建列。
- `db/queries/products.py`：`product_create`/`product_update` 的 allowed 字段补 `dist_price`。
- `routers/data.py`：`POST /api/products/bulk-upsert` 接收 `product_code`/`dist_price`；`GET /api/products/grid` 输出这两字段。
- `erp_db.py` `forecast_submission_summary`：rows 子查询补 `product_code`/`dist_price`，只读交叉表可显示厂家编码与分销价。

## 前端改动（hergent-cn-v2/src/pages/Forecast.vue）
- 交叉表只读视图冻结列扩展为：商品/规格 | 条码 | **厂家编码** | **分销价** | **标准售价**（对齐舟谱冻结列）。
- 复制能力：
  - 工具栏「⧉ 复制全部下单」按钮 → 复制所有客户（按客户分组、TSV `厂家编码\t数量`）。
  - 每个客户列头「⧉」按钮 → 复制单个客户下单文本。
  - 无厂家编码时回退用条码；`navigator.clipboard` + `execCommand` 兜底。
- 编辑模式商品清单加「分销价」「厂家编码(永辉代码)」输入框；Excel 粘贴识别补厂家编码/分销价表头映射。
- 全链路（loadEditGrid / loadCross / addRow / saveEdits / onPaste）携带 product_code/dist_price。

## 验证
- 构建：vite build 成功（Forecast-C2sps4Ss.js）。
- 部署：后端 deploy.sh 扁平 rsync（保留 .env）+ restart，health=200；前端 rsync /opt/hergent-cn-v2 + chown。
- 库结构核验：全部 tenant_*.db 均已有 dist_price 列（PRAGMA 检查 NONE missing）。
- 真机 E2E（puppeteer-core + 本机 Chrome，无头登录 boss）：**10/10 PASS** —— 登录 / 切交叉表 / 表头含厂家编码·分销价·标准售价 / 复制全部按钮 / 列复制⧉ / 编辑含厂家编码+分销价输入。

## 用户现在可以这样用
1. 预报模块 → 交叉表视图（或点「编辑」录入/粘贴舟谱整片商品，含厂家编码、分销价）。
2. 在交叉表视图，点某客户列头「⧉」复制该客户下单文本，或点工具栏「⧉ 复制全部下单」复制所有客户。
3. 打开厂家系统下单页，直接 Ctrl+V 粘贴 —— 每行 `厂家编码<Tab>数量` 即可完成录单。

## 交付文件
- `hergent-cn-v2/src/pages/Forecast.vue`（前端改动）
- `hergent-erp/server/erp_db.py`、`db/queries/products.py`、`routers/data.py`（后端改动）
- `artifacts/forecast-copy-e2e.cjs`（可复用 E2E 脚本）
- `artifacts/forecast-xlsx-structure-align-2026-08-22.md`（前期方案文档）
