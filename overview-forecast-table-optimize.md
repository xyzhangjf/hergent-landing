# 预报汇总表表体优化 · 交付总览（P1+P2+P3）

> 日期：2026-08-23 ｜ 范围：只读汇总视图（viewMode==='cross'）为主，编辑矩阵附带 ｜ 改动：前端 `Forecast.vue` + 后端 `data.py`（补 2 字段）

## 一、背景
工具栏重设计（分组工具栏）上线后，用户追问「汇总表表体本身还能优化哪些」。审计发现两处真问题：
1. **只读汇总视图搜索/排序失效** —— `rowShown()` 只认编辑模式的 `filterText`；`Ctrl+F` 的 `findText` 仅在编辑模式生效且只滚动不隐藏行。430 个 SKU × 几十列时无法按名筛选，只能硬滚。
2. **只读视图信息最少** —— 风险徽标（⚠🔥💡💬）只在编辑模式显示，主视图反而看不到货损/缺口/健康分。

## 二、交付清单（9 项全落地）

### P1 可读性基础（低风险）
- **P1-1 斑马纹 + 行 hover 高亮**：`data-row.zebra` + `:hover`；编辑矩阵用 `nth-child(even)`。宽表横扫不再串行。
- **P1-2 数量单元格热力图**：`heatStyle(r,uname)` 按数值深浅铺 teal 色阶（maxQty 归一）。订得多的一眼可见。只读 + 编辑单元格均生效。
- **P1-3 合计行吸底**：原 `col-total` 行从 `tbody` 移入 `<tfoot>` 并 `position:sticky;bottom:0`。滚动不丢总盘子。
- **P1-4 修搜索 + 表头排序**：`rowVisible(r)` 同时认 `findText/filterText`；只读工具栏加筛选框；表头「合计 / 下单金额 / 商品」可点击排序（`sortInd` 显示 ▲▼）。

### P2 信息补全
- **P2-5 风险徽标同步只读视图**：名称单元格加 ⚠(安全库存/短保) 🔥(货损) 🔔(库存预警) 💬(批注) ⚠️(缺口) 💡(健康分<60)，与编辑模式一致。
- **P2-6 汇总表 AI建议列**：`showSuggest` 开关控制，列显示 `r.ai`（AI 建议量），直接对比预报 vs AI。
- **P2-7 待定稿显示**：未定稿时「最终下单」列改显「待定稿」（原与「件数」撞脸，均显 r.boxes）。
- **P2-8 无价标缺价**：单价/金额无价时显红色「缺价」标记（复用健康分概念）。

### P3 大改（最高价值）
- **P3 按品类/品牌分组 + 组内小计 + 折叠**：`groupBy`（不分组/按品类/按品牌）切换；`renderModel` 统一扁平列表（分组头行 + 数据行同列迭代，行带 `zi` 斑马序号与 `gkey` 折叠归属）；组内小计（件数 + 金额）；点击分组头折叠/展开。430 SKU 平铺痛点质变。

## 三、后端改动（极小）
`server/routers/data.py` 的 `products_grid` 返回补 `"category"`, `"brand"` 两字段 —— P3 分组数据源。`loadCross` 并行取 `productsApi.grid()` 建 `prodMeta` 并给行附 `category/brand`。

## 四、验证结果
- 前端 `npm run build` ✓（`Forecast-fJN4VdMN.js` 432.85 kB / gzip 139.26 kB，built 1.36s）→ rsync + chown → **RSYNC_FRONTEND_OK**
- 后端 `bash deploy.sh` ✓ → **health 200**；`/api/products/grid` 未授权探测 **401**（挂载+鉴权生效）
- 产物核验：`tb-toolbar` / `grp-head` / `pending-final` / `miss-price` / `按品类` / `按品牌` / `显示AI建议` / `待定稿` / `缺价` / `点表头` / `分组可点击折叠` / `grp-sub-info` / `sortable` 全部编入 dist

## 五、诚实说明与待真机验证
- 排序点击、分组折叠、热力图渲染属 Vue 交互，无头环境无法点按钮验证，需**登录真机**确认手感。
- 分组依赖 `products.category/brand` 真实有值；若部分 SKU 主档缺品类则归入「未分类」组，属正常降级。
- 建议真机走查：① 筛选框输入商品名看是否实时过滤；② 点表头「合计/下单金额」看是否排序；③ 分组切「按品类」看分组头+小计+折叠；④ 热力图深浅、风险徽标、AI建议列、待定稿/缺价标记是否如预期。
