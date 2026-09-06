# 返利模块 ①④ 核实报告（2026-09-01）

## 结论先行

用户要求"做①④（计算透明化面板 + 达成率可视化/异常预警），但先看真实代码、不要重复造轮子"。
**核实结果：①④（甚至②试算器、第二批 B2-1 版本化）已在真实代码中完整落地、真接线、生产可用。本轮无需写任何新代码——重造即浪费，用户记忆准确。**

---

## 证据链（代码级）

### ① 计算透明化面板（点金额看算式链）

| 层 | 位置 | 证据 |
|---|---|---|
| 后端 | `rebate_rules.py:625` `POST /simulate` | 模块 docstring："/simulate 返回值带 **steps[] 算式链**与 tiers[] 档位明细，供透明化面板渲染" |
| 前端 | `Rebate.vue` `simResults`(L1758) / `simKey`(L1761) / `simulateBatch`(L1764-1784) | 批量试算结果映射到 `simResults`，仪表盘行"算式"按钮按 `simReady` 显示、点开渲染算式链 |
| API | `modules.js:122` `rebateApi.simulate` | `/api/rebate-rules/simulate` |

### ④ 达成率可视化 + 异常预警区

| 层 | 证据 |
|---|---|
| 前端 | 仪表盘行含进度条 + 达成率 + 节奏判定；异常预警聚合区（此前标记 #356 落地） |
| 后端 | `simulate-batch` 返回 `results[]` + `total_rebate`，异常/缺填报逻辑在仪表盘加载侧聚合 |

### ②（连带发现）试算器 What-if

| 层 | 证据 |
|---|---|
| 后端 | `rebate_rules.py:724` `POST /simulate-batch` — 一次请求批量试算，**仪表盘/试算器统一走它，前端不再镜像算法**（docstring 明示） |
| 前端 | `Rebate.vue:1779` `rebateApi.simulateBatch({items})` → L1912-1916 消费 `cur`/`next` 两档预估 |

### 关键修正：第二批 B2-1 阶梯版本化已上线（推翻上一轮"版本化冻结"判断）

`rebate_rules.py:810-896`（v114）：`GET/POST /{rule_id}/tier-versions` + `GET/DELETE /{version_id}` 全链路，**计提按计提月份锁定当时版本**（`erp_db._pick_tier_version`，生产 erp_db.py 含 3 处引用）。即《对标国际 ERP 优化方案》第二批的版本化，**已在 v114 落地**——我上轮"等客户点名再做"的判断过时了，予以修正。

## 生产核验（47.113.224.140）

```
simulate / simulate-batch / tier-versions×4    ✅ 生产 routers/rebate_rules.py 全在
_pick_tier_version                              ✅ erp_db.py ×3
include_router(rebate_rules_router)             ✅ server.py ×1
/api/health                                     ✅ HTTP 200
```

---

## 新增核验：维度扩展是"半闭环"（修正上轮判断）

上一轮我判断"后端数据模型仅支持 brand/product，品类/客户/渠道筛不到"。本轮核验修正：

| 层 | 现状 | 证据 |
|---|---|---|
| 规则创建 | ✅ 已支持 5 维 | `rebate_rules.py:48` `DIMENSIONS=(brand,product,category,customer,channel)` + 存储 CHECK + v113 扩展（L294） |
| 达成填报 | ❌ **仅 2 维 + 静默降级** | `rebate_achievements.py:95-98` `_norm_dimension` 只认 brand/product；**L130 `_norm_dimension(...) or "brand"` —— 传 category/customer/channel 会被悄悄写成 brand** |

**风险**：用户按"品类维度"规则填报达成 → 数据被静默写进 brand 维度 → 品类规则匹配不到达成（返利算 0）且污染 brand 聚合。
**修复建议**（约 1 人日）：`_norm_dimension` 补 3 维映射 + upsert 时非 5 维直接 422（拒绝而非降级）。属③范畴，待拍板。

## 结论与建议

1. **①④ 无需改动**——已生产就绪。若用户对具体交互（信息密度/文案/流程）不满意，可针对性调，但不应整体重做。
2. **修正上轮判断 1**：版本化（第二批 B2-1）**已上线**（v114 tier-versions + `_pick_tier_version` 月度锁定），非"待做"。
3. **修正上轮判断 2**：维度扩展是**半闭环**——规则层 5 维 ✅，达成填报层静默降级 brand ❌（上述 bug，约 1 人日，建议顺手修）。
4. **剩余待拍板**：Claim+审批状态机、批量计提作业化、增量累积 BV（均第二批重活）；维度填报降级 bug（轻量、建议并入下批）。
