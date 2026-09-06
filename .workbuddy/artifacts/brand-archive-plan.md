# 品牌档案（品牌治理）技术方案与排期

> 背景：用户在报单汇总表想加「品牌列」（已作为 Step 1 默认显示落地），并进一步提出
> 在档案管理加「品牌档案/商品档案」、让商品匹配品牌。核心价值两点：
> ① 服务舟谱类**无 API/MCP** 的 Excel/手动用户——统一品牌命名，避免聚合分裂；
> ② 支撑**品牌目标 / 返利**，品牌必须是受管理实体而非商品上的自由文本。

---

## 0. 现状盘点（已核对代码，先别重造轮子）

后端**已经**有品牌档案能力，缺口主要在**前端管理入口**和**商品↔品牌治理**：

| 能力 | 现状 | 位置 |
|---|---|---|
| `brands` 表 | 已存在：id/name/manufacturer/logo_url/is_active + 迁移列 tier/description/credit_code/website/contact_info | `server/erp_db.py:6960` |
| 品牌 CRUD | `get_brands()`（带 product_count 关联）、`save_brand`、`save_brand_edit`、`toggle_brand` | `server/erp_db.py:6888+` |
| 品牌 REST | `GET/POST /api/brands`、`PUT /api/brands/{id}`、`POST /api/brands/{id}/toggle`、`POST /api/brands/{id}/logo` | `server/routers/purchase.py:130-149` |
| 品牌种子 | `FMCG_BRANDS` 快消品牌模板 + 播种逻辑 | `server/erp_db.py:5499,5592+` |
| 品牌目标 | `kpi_targets.brand` 维度已建模，`kpi_target_create(brand=)` | `server/erp_db.py:697,12687`；`routers/forecast.py:168` |
| 品牌返利 | `rebate_rules.brand` 维度已建模，`rebate_rule_create(brand=)` | `server/erp_db.py:698,12724`；`routers/forecast.py:426` |
| 商品.brand | **自由文本**，无外键；`get_brands()` 用 `p.brand=b.name` 名字关联统计 | `server/erp_db.py:306,327,6892` |
| Excel/舟谱导入 | 品牌列映射为自由文本（`"品牌"/"brand"/"厂家"/"厂牌"`），**未归一、不建档** | `server/routers/import_router.py:72,137`；`import_zhoupu.py:96` |
| 连接器 | kingdee/chanjet 已带 `brand` 字段写入（同样自由文本） | `chanjet_connector.py:378`、`kingdee_connector.py:326` |
| **前端管理页** | **缺失**：`Archive.vue` 只有「员工档案 / 客户档案」两个 tab，全站无品牌管理 UI | `src/pages/Archive.vue` |

**结论**：后端品牌档案"骨架"已具备，真正要补的是 **P1-A 前端品牌档案页** 和 **P1-B 商品↔品牌治理（轻量归一）** + **P1-C 导入归一**，P2 目标/返利几乎免改即可受益。

---

## 1. 总体设计原则（契合 solo 非技术创始人低风险基线）

- **不追硬外键迁移**：不给 `products` 加 `brand_id` 并回填 428 行（ALTER + 全量读写改造，solo 风险高、易翻车）。
- **轻量治理 = 文本 brand + 归一/匹配层**：保留 `products.brand` 文本，在**所有写入入口**统一调 `normalize_brand()`，把"蒙牛/蒙牛乳业"收敛到规范名；未命中按需自动建档。
- **逐层递进、可回退**：每步独立可上、互不影响；历史脏数据用「合并品牌」工具一次性治理，不阻塞日常。

---

## 2. P1-A 前端「品牌档案」页（核心缺口）

**改动文件**
- `src/pages/Archive.vue`：新增「品牌档案」tab（复制现有 employees/customers tab 模式，`goTab('brands')`、`/archive/brands`）。
- 新建 `src/pages/BrandArchive.vue`（复用 `EmployeeArchive.vue`/`CustomerArchive.vue` 的列表+弹窗风格）。
- `src/router/index.js`：新增 `archive/brands` 路由（复用 Archive 组件，`meta.title='档案管理'`）。
- 侧边栏「档案管理」无需改（沿用 `/archive` 入口 + tab 切换）。

**BrandArchive.vue 功能**
- 列表：`GET /api/brands` → 表格展示 品牌名 / 厂家 / 层级(tier) / 商品数(product_count) / logo / 状态；顶部搜索过滤。
- 新增/编辑：弹窗表单（name 必填、manufacturer、tier、description、website、contact_info、credit_code；logo 走 `POST /api/brands/{id}/logo` base64）。
- 停用/启用：`POST /api/brands/{id}/toggle`；`product_count>0` 时禁止硬删，仅可停用。
- 合并品牌（治理工具，见 P1-B）：选「源品牌→目标品牌」，把源品牌商品改挂目标并停用源。

**工作量**：前端单页 + 路由 ≈ 1 天。

---

## 3. P1-B 商品↔品牌治理（轻量归一，非硬 FK）

**后端新增**（建议放 `server/routers/import_router.py` 或新 `server/brand_normalize.py`）
- `normalize_brand(raw)`：
  1. `trim` + 去空格/全半角；
  2. 走 `brands.alias`（可加 alias 列或独立 synonyms 表）做别名映射；
  3. 精确匹配 `brands.name` → 返回规范名；
  4. 未命中 → 返回原值（或按策略自动建，见 P1-C）。
- 写入入口**统一接驳**（全部在写库前调 `normalize_brand`）：
  - 商品 web_grid 录入：`POST /api/products/bulk-upsert`（scope=标准售价/进价，2026-08-22 已上线）；
  - Excel 导入：`import_router.py` 商品流程；
  - 舟谱导入：`import_zhoupu.py`；
  - 连接器：kingdee/chanjet 的 `brand` 字段。
- 商品档案/编辑行品牌字段：前端从「纯手填」改为「选 brands 下拉 + 允许新建」（调 `/api/brands` 取候选），`DataFill.vue` / 预报编辑行接此下拉。

**历史脏数据治理**：品牌档案页提供「合并品牌」按钮（后端 `merge_brand(src,dst)`：UPDATE products SET brand=dst WHERE brand=src；再 disable src）。一次性处理"蒙牛/蒙牛乳业"等。

**工作量**：后端 normalize + 4 个写入入口接驳 + 前端下拉 ≈ 1.5 天。

---

## 4. P1-C 导入品牌匹配 / 自动建（舟谱用户关键）

- 在 `import_router.py` 商品导入：读「品牌」列 → `normalize_brand` → 未命中且非空 → `save_brand(name, source='import')` 自动建档，保证聚合不分裂。
- 复用已有「导入预览」校验逻辑：预览阶段标注"将新建品牌 X / 将合并到 Y"，让用户先知。
- 取舍（需你拍板）：自动建体验顺但可能建出错别字品牌 → 建议**自动建 + 品牌档案页可合并**双保险。

**工作量**：≈ 0.5 天（复用 normalize）。

---

## 5. P2 品牌目标 / 返利（依赖 P1-B，几乎免改）

- `kpi_targets.brand` / `rebate_rules.brand` 已按品牌维度建模；品牌被治理为规范名后，目标达成看板、返利计算**自然按规范品牌聚合**，无需改表。
- 仅前端：目标/返利配置页的品牌输入由「手填」改为「选 brands」（校验 brand 存在于 `brands` 表）。`forecast.py` 写入逻辑已支持。
- **工作量**：≈ 0.5 天（前端选择器 + 校验）。

---

## 6. 排期（建议 5 个工作日）

| 天 | 内容 | 产出 |
|---|---|---|
| D1 | P1-A 品牌档案页 + 路由 | 前端可见「品牌档案」tab，可增删改/停用/logo |
| D2 | P1-B `normalize_brand` + 4 写入入口接驳 + 商品品牌下拉 | 商品.brand 写入即归一 |
| D3 | P1-C 导入匹配/自动建 + 合并品牌工具 | 舟谱/Excel 导入品牌不再分裂；历史脏数据可合并 |
| D4 | P2 目标/返利品牌选择器改造 + 联调 | 目标/返利按规范品牌配置与看板 |
| D5 | 回归：428 SKU 归一、舟谱导入样例、目标/返利看板 | 验收 |

---

## 7. 需你拍板的决策点

1. **是否接受「文本 brand + 归一层」而非「硬外键 brand_id」？** 我推荐轻量方案（低风险、免 428 行回填迁移）。
2. **导入遇未命中品牌：自动建 vs 进待审？** 推荐自动建 + 档案页可合并。
3. **历史脏数据治理时机**：导入逐步归一，还是先用「合并品牌」工具集中清一次？

## 8. 与现有能力对齐（已具备，不必新建）

- 汇总表：可「按品牌分组」+ 品牌列已默认显示（本次 Step 1）。
- 品牌目标/返利：`kpi_targets.brand`、`rebate_rules.brand` 维度已建。
- 品牌 CRUD / logo / 种子：后端已全。

> 下一步：你确认第 7 节三个决策点后，我按 D1→D5 顺序端到端实现（每步 build+rsync+生产验证）。
