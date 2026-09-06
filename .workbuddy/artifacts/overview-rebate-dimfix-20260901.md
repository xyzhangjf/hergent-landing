# 达成填报维度静默降级 Bug 修复 — 实施与生产验证报告

日期：2026-09-01 · 文件：`server/routers/rebate_achievements.py`（仅 1 个文件，纯后端）

## 背景

《对标国际 ERP 优化方案》第一批 §1.3 已把**规则层**扩展为 5 维（brand/product/category/customer/channel），但**达成填报层**（`rebate_achievements.py`）仍只认 brand/product：

- `DIMENSIONS = ("brand", "product")`
- `_norm_dimension()` 遇品类/客户/渠道 → 返回 `""`
- `upsert_achievement` 与 `import_achievements` 均 `or "brand"` **静默降级**

## 危害链（计算内核证实）

`accrue_rebate`（erp_db.py L9179）按 3 元组精确匹配达成：

```python
a = ach_idx.get((pk, vrule.get('dimension'), scope_key.lower()))
```

因此按品类规则填的达成被降级写成 `(pk, 'brand', sk)` 后：

1. **计提按 `(pk, 'category', sk)` 查询 → 恒查不到 → 返利恒算 0**（用户以为有达成，实际白填）
2. 若同品牌下恰有同名 brand 规则 → **达成污染进品牌口径，返利算错**
3. 前端 `buildAchvRows` 为 category 规则生成行后行内保存即触发此路径（前端无 bug，后端是根因）

## 修复内容（4 处编辑）

| 位置 | 修复前 | 修复后 |
|---|---|---|
| `DIMENSIONS` (L23) | `("brand","product")` | 5 维，对齐 `rebate_rules.py` |
| `_norm_dimension` (L92) | 只认 brand/product | 5 维中英文别名（含 品类/类目/客户/经销商/渠道 等），尾空格容错 |
| `upsert_achievement` (L130) | `or "brand"` 降级 | 非法/缺失 → **422 拒绝**（detail 列出合法值） |
| `import_achievements` (L318) | `or "brand"` 降级 | 非法/缺失行 → **skip + errors 提示**（保持逐行容错语义） |

## 验证

### 本地冒烟（40/40 PASS）
- 5 维英文 + 15 个中文别名归一正确
- 非法/缺失/大小写 → `""`（不再降级）
- upsert 分支：合法 5 维 200、非法 422
- import 分支：合法不跳、非法 skip
- 计提 3 元组匹配：修复后 category 规则达成可命中、修复前恒 0（复刻 `_achievement_index` 语义）

### 生产 E2（47.113.224.140，sales 账号 mptest）
| 验证项 | 结果 |
|---|---|
| POST `dimension=category` | ✅ 200，落库 `dimension="category"`（修复前会写成 brand） |
| POST `dimension=xxx` | ✅ **422**（修复前 200 降级） |
| POST `dimension=品类`（中文别名） | ✅ 200 |
| GET 列表 `dimension=category` 过滤 | ✅ 只返回 category 行 |
| 测试数据清理 | ✅ 残留 0 |

### 部署
- 前置核对：本地分支（upgrade/v84-international）相对生产领先 15 commit，**未跑全量 deploy.sh**；拉生产文件 diff 确认 29 行差异 **100% 为本轮修复**后精确 scp 1 个文件
- 备份：`/root/backup_rebate_dimfix_20260901/`
- chown → 清 pyc → restart → health **200**，服务 active

## 注意事项（存量数据）

**无法自动追溯修复前的降级污染**：此前被降级写成 brand 的 category/customer/channel 达成无法区分恢复。影响面评估：若该租户此前未建品类/客户/渠道规则，则无污染（降级只发生在填报时维度非 2 维的场合）；若有，需人工核对该 brand 维度下的历史达成数据。建议在下次人工对账时抽查。

## 后续建议

- 前端维度筛选下拉已 5 维（上一轮补完），本轮后端填报层补齐后全链路（规则 5 维 → 填报 5 维 → 计提 3 元组匹配）已闭环，**无需前端改动**。
- 剩余冻结项（Claim+审批状态机 / 批量计提作业化 / 增量累积 BV）维持"等客户点名"。
