# v113 年度合同弹窗修复 — 合作方只选厂家 + 品牌下拉

## 交付
按用户反馈修复「录入年度合同」弹窗两点问题，端到端落地并上生产验证。

## 变更
| 层 | 文件 | 改动 |
|---|---|---|
| 前端 | `Rebate.vue` | ①合作方下拉改 `/api/contacts?limit=300&type=supplier`（只取厂家）+ 解析 `{items}` 信封（原解析 `list.data` 失败 → 下拉实际为空）；②新增「品牌（可选）」下拉（已录入品牌，brandList ref）；③contractForm 加 brand_id（新建/编辑回填/保存提交）；④合同卡片与筛选下拉显示品牌 tag；⑤合作方 label 改「合作方（厂家）」 |
| 后端 | `erp_db.py` | `rebate_contracts` 加 `brand_id` 列（尾部补丁循环，生产库自动迁移）；`_coerce_contract_args`/create/update 支持 brand_id（int≥0 校验）；`get_rebate_contracts`/`get_rebate_summary` LEFT JOIN brands 返回 `brand_name` |
| 后端 | `server.py` | POST/PUT `/api/rebate-contracts` 透传 `brand_id` |

## 构建与部署
- 前端 `npm run build` ✓（`Rebate-DDbId0Eb.js 70.49 kB`）→ rsync → `/opt/hergent-cn-v2` → chown
- 后端 py_compile ✓ → rsync flatten（排除 `*.db*/.env`）→ chown → 清 `__pycache__` → restart → **health 200**
- 服务器侧核验：`brand_id` 列已加、erp_db×16 / server.py×2、「品牌（可选）」/「type=supplier」命中新 chunk

## 对齐效果：生产 E2E 9/9 PASS（mptest + tenant_1）
- contacts?type=supplier → **38 家纯厂家**（蒙牛酸奶/蒙牛鲜奶等），无客户混入
- 创建合同带 brand_id → summary 返回 `brand_name`（蒙牛低温）
- 编辑改 brand_id=0（不限）生效；老合同（无 brand_id）兼容读取
- 测试合同零残留

## 需确认事项
1. 两仓库未 push（hergent-erp `upgrade/v84-international`、laozhangai-product `main`），要推说一声；
2. 品牌为**可选**（不选 = 合同覆盖全部品牌）；若业务上要求「一合同一品牌」必填，可改必填并加同厂家同品牌同年度唯一约束；
3. 建议浏览器真机抽查：录入弹窗合作方下拉只见厂家、品牌下拉可选「蒙牛低温」等已录入品牌、保存后卡片带品牌 tag。
