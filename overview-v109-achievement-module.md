# v109 达成数据模块上线说明

**日期**：2026-08-30
**背景**：补「无 API / 手动上传达成数据客户没有填报入口」的缺口

---

## 一、为什么做（缺口诊断）

此前「达成数据」只有 3 条路径，且**对手动上传客户全不通**：

| 来源 | 机制 | 对无 API 客户为何不可用 |
|---|---|---|
| `kpi_achievement_calc` | 从库内 `sale_orders` 汇总当月 delivered/signed | 需要销售单入库，但**前端无销售单导入入口**；且只能算全公司总额，不能按品牌/商品拆 |
| Rebate「试算」 | 手输实际值 → 算命中档位 | what-if 计算器，**不入库、不进看板** |
| Forecast 返利冲刺看板 | 用**本期预报**当"达成" | **语义错位**，漏算已达成 → 缺口偏大 |

后端自身也标注了缺口：
- `forecast_audit.py:151` → `"target_achievement": None,  # v1: 单品指标维度待录入`
- `forecast_audit.py:16` → 「单品级厂家指标当前库无现成表」

**结论**：返利目标体系对主打客群（舟谱类无 API 经销商）此前立不住，必须补结构化填报入口。

---

## 二、做了什么

### 1. 后端：新表 + 接口

**新表 `rebate_achievements`**

| 字段 | 说明 |
|---|---|
| `period_month` | 统计月份 YYYY-MM |
| `dimension` | brand / product |
| `scope_key` / `scope_name` | 作用对象（品牌名 / 商品ID） |
| `actual_amount` / `actual_qty` | 实际达成金额 / 数量 |
| `source` | manual / excel / api |
| `note` | 备注 |

关键设计：**`UNIQUE(period_month, dimension, scope_key)`** —— 同一月重复导入走**覆盖**而非堆积重复行，客户可以放心重导。

建表采用双保险（严格照 v108 `rebate_target_rules` 模式）：
- 主库：`_safe_migrate_script('v109_rebate_achievements', ...)`
- 租户库：尾部 tenant 补丁循环 `tdb.executescript`

**新接口** `server/routers/rebate_achievements.py`

| 端点 | 用途 |
|---|---|
| `GET /api/rebate-achievements?month=` | 列表 |
| `POST /api/rebate-achievements` | 单条新增/更新（upsert） |
| `DELETE /api/rebate-achievements/{id}` | 删除 |
| `POST /api/rebate-achievements/import` | Excel/CSV 批量导入 |

导入能力：
- 支持 `.xlsx` / `.csv`（`.xls` 给出友好提示引导另存）
- 中文表头别名映射（月份/维度/作用对象/实际达成金额/实际达成数量/备注）
- **商品维度自动解析**：按名称或条码匹配商品档案，转成 product_id 与 `rebate_target_rules.scope_key` 对齐；匹配不到按原文导入并在结果中提示
- 单行失败不影响其余行，返回 `{imported, skipped, errors:[{row,msg}]}`

### 2. 前端 Rebate.vue：新增「达成填报」Tab

顶部主 Tab：**目标规则 / 达成填报**

填报 Tab 内容：
- 月份选择器（切换即重载）
- 可编辑表格：维度 / 作用对象 / 目标值 / **实际达成金额 / 实际达成数量**（失焦即存）/ 达成率 / 来源 / 清除
- 达成率着色：≥100% 绿、≥80% 琥珀
- 「下载模板」+「Excel 导入」按钮

行数据来源 = **启用中的目标规则 ∪ 已填报达成**
> 特意保留"有达成但无对应规则"的行，避免客户导入后数据"看不见"。

### 3. 前端 Forecast.vue：冲刺看板打通

核心公式变更：

```
达成 = 填报达成 + 本期预报贡献
gap  = target - (reported + contrib)
```

- 表格新增「**已达成(填报)**」列
- 副标题由「历史已达成未含，配置连接器后自动纳入」改为「达成 = 已填报达成 + 本期预报贡献；未填报部分可到『目标与返利 → 达成填报』补录或 Excel 导入」
- 空态引导由已撤掉的「能力中心 → 返利目标规则」改为「目标与返利」

---

## 三、部署与验证

**后端（外科手术式，未整目录部署）**

`server/` 下有 20 个改动文件，含用户**暂缓推送**的内容。做法：
1. 先把生产版 `erp_db.py` / `server.py` scp 到本地 diff
2. 确认差异**仅**是本次新增（`erp_db.py` 46 行 v109×2；`server.py` 2 行路由注册）→ 说明生产已含用户其他改动
3. 只 rsync 这 3 个文件 + chown + restart

**验证结果**

| 项 | 结果 |
|---|---|
| `health` | HTTP 200 |
| 端点鉴权 | 两个端点均 401（鉴权生效） |
| 建表 | **主库 + 全部 10 个租户库** 均已创建 `rebate_achievements` |
| 前端产物 | `Rebate-C5B1z1W6.js` / `Forecast-DSq7zI5_.js`，新文案 grep 全命中 |

> 踩坑：restart 后 `sleep 3` 不够（启动约需 4s），首次 curl 返回 000 —— 是**误报**不是故障，复查即 200。

---

## 四、待实测（沙箱无法访问 hergent.cn）

请**硬刷新（Cmd+Shift+R）**后验证：

1. 侧边栏「目标与返利」→ 顶部出现「目标规则 / 达成填报」两个 Tab
2. 「达成填报」Tab：选月份 → 看到目标规则对应的行 → 填入金额/数量 → 失焦保存 → 达成率与来源变化
3. 「下载模板」→ 填几行 → 「Excel 导入」→ 覆盖生效
4. 预报页「返利冲刺看板」：出现「已达成(填报)」列，缺口 = 目标 −（填报 + 预报贡献）

---

## 五、备注

- 模板下载走**前端客户端生成 CSV**，与 `DataFill.vue` / `EmployeeArchive.vue` 既有做法一致，故未保留后端 `/template` 端点（避免死代码）。
- 未做浏览器真机验证。
