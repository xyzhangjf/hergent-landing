# 商品档案（轻量版）交付说明 — 2026-08-28

用户在「档案管理」中选择 **① 轻量版** 商品档案，已落地并部署到生产。

## 改动清单
1. **后端** `hergent-erp/server/routers/data.py` — `GET /api/products` 路由新增 `include_inactive` 参数（仅传 `1` 时返回停用商品），并先在后端拉全量匹配集合再按前端分页切片，修正 `db.product_list` 默认 limit=200 导致翻页丢失的问题，从而给出正确 `total`。
2. **前端** 新建 `hergent-cn-v2/src/pages/ProductArchive.vue`：
   - 筛选：关键词 / 品牌下拉（来自 `/api/brands`）/ 分类下拉（全量枚举）/ 含停用开关 + 重置。
   - 表格列：名称 / 条码 / 规格 / 单位 / 品牌 / 标准售价 / 进价 / 安全库存 / 状态 / 详情。
   - **行内改品牌**：点品牌格弹出 datalist（复用 Forecast 修复范式，共享单份避免 DOM 爆炸），保存走 `PUT /api/products/{id}`（后端 `normalize_brand` 自动归一）。
   - 只读详情弹窗：展示名称/条码/规格/单位/品牌/分类/售价/进价/分销价/安全库存/保质期/厂家编码/别名/状态。
   - 分页（20/50/100 每页）。
3. **前端** `Archive.vue` — 新增「商品档案」tab（`archive/products`），`tabFromPath` 增加 `'products'` 分支。
4. **前端** `router/index.js` — 增加 `{ path: 'archive/products', component: Archive }`。

## 验证
- 前端 `npm run build` 成功，Archive 分块已包含「商品档案」「pa-brand-list」及 `PUT /api/products/`。
- 前端 `rsync` 同步至 `/opt/hergent-cn-v2/` 完成。
- 后端 `bash deploy.sh` 部署，服务健康 `GET /api/health` → HTTP 200。
- 后端真实数据验证（demo token）：`GET /api/products?include_inactive=1&limit=3` 返回 `total=11`、品牌字段正常、`401` 鉴权门正常（确认路由未破坏）。
- 无头浏览器真机验证被本沙箱代理不可用阻断（无法连外网到 hergent.cn），**未做浏览器级 UI 运行时验证**；建议你在浏览器实测：「档案管理 → 商品档案」打开、筛选、行内改品牌。

## 设计取舍
- 仅品牌支持行内编辑（符合方案①「行内改品牌」）；售价/进价/安全库存为只读，修改走 Web 网格/连接器，避免与连接器同步互相覆盖。
- 行内改品牌**未**走 `track_brand` 入待审队列——人工在档案里指定品牌属于「显式指派」而非「导入发现」，直接写入 `products.brand` 并归一，避免待审噪音；规范品牌仍需在「品牌档案」里「添加品牌」。
