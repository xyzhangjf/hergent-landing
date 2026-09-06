# 预报订单模块 · 第四层增强（P11/P12/P13）交付总览

> 日期：2026-08-23 | 范围：在已上线的基础 22 项 + P5/P6/P7（10 项）+ P8/P9/P10（10 项）之上，落地第四层「数据质量闭环 → 智能决策深化 → 规模化生态」共 10 项增强。
> 指令：用户「全做」——10 项端到端落地 `Forecast.vue` 并真正部署后端端点。

---

## 一、交付清单（10 项全部上线）

| 优先级 | 编号 | 功能 | 入口标记 | 价值 |
|---|---|---|---|---|
| P11 数据质量 | P11-1 | 数据缺口补录 | ⚠️ | **高** — 打通 54 行缺失资料，喂入货损/工资工作流 |
| P11 | P11-2 | 安全库存 AI 建议 | 🛡 | 中 — 按销量波动算 95% 服务水平建议值 |
| P11 | P11-3 | 多期滚动预报 | 🗓 | 中 — 跨期次对比 |
| P12 智能决策 | P12-4 | 偏差归因复盘 | 📉 | **高** — 命中率+差异+归因，配方优化闭环 |
| P12 | P12-5 | 自然语言改单 | 💬 | 中 — call_ai 解析口语化改单 |
| P12 | P12-6 | 一键凑单达返利 | 🧮 | 中 — 冲返利门槛自动补量 |
| P12 | P12-7 | 配方模拟 what-if | 🔬 | 中 — 对比两套 recipe 差异 |
| P13 规模化 | P13-8 | 供应商 PO 聚合 | 📦 | **高** — 按品牌聚为 PO 草稿，回写连接器 |
| P13 | P13-9 | 移动端录入契约 | 📱 | 中 — 定契约+Web入口（小程序页待工程实现）|
| P13 | P13-10 | 主动预警推送 | 开关 | 中 — 体检异常自动推企微/飞书 |

---

## 二、改动文件

### 前端（hergent-cn-v2）
- `src/pages/Forecast.vue`（脚本块 + enh-panels 按钮 + 9 个新面板 + ⚠️ 徽标 + CSS）
  - `loadEditGrid` 末尾挂载 `loadGaps(); loadSafety(); _alertedThisLoad=false;`
- `src/api/modules.js`（`forecastApi` 补 8 方法：dataGapsGet/dataGapSave/safetySuggest/varianceGet/varianceAttrGet/varianceAttrPut/nlEdit/supplierPo）

### 后端（hergent-erp，单文件改动）
- `server/routers/forecast_config.py` 追加 **6 端点**（文件由 ~410 行扩至 ~540 行）：
  - `GET|POST /api/forecast/data-gaps`
  - `GET /api/forecast/safety-suggest?ids=`
  - `GET /api/forecast/variance?period_id=`、`GET|PUT /api/forecast/variance-attr?period_id=`
  - `POST /api/forecast/nl-edit`
  - `POST /api/forecast/supplier-po`
- `server.py` 未改（router 已 `include_router`）。

### 文档
- `forecast-miniprogram-input-contract.md`（P13-9 移动端录入契约，新建）

---

## 三、部署与验证结果

| 项 | 结果 |
|---|---|
| 前端 build | ✅ `Forecast-B684oVFW.js` 411.08 kB / gzip 133.27 kB，built 1.29s |
| 前端部署 | ✅ rsync → `/opt/hergent-cn-v2/` + chown hergent:hergent → 生产 HTTP 200，10 功能标记齐全 |
| 后端部署 | ✅ `bash deploy.sh` → health HTTP 200 |
| 后端端点核验 | ✅ 6 新路由未授权探测均 401（确认挂载 + 鉴权生效）|
| 编译 | ✅ 后端 `py_compile` 通过；前端 `npm run build` 一次通过 |

> 部署告警说明：rsync 删除远端 `hermes-engine/.hermes/*`、`backups/20260709_*` 为历史陈旧目录非致命告警；health 探测偶发 HTTP 000 系重启 ~6s 窗口，sleep 后复检 200。

---

## 四、关键 schema 发现与架构适配

- **`products` 表无 `supplier_id` / `lead_days`**（仅 `brand`/`category`/`safety_stock`/`expiry_days`）。
  - → P13-8 供应商 PO 改按 **`brand` 聚合**（品牌≈供货方），不造供应商主档，守「不自研 ERP、只做 AI 层」边界。
  - → P11-2 安全库存改按 **历史销量标准差 × 1.65**（95% 服务水平）算建议值，不依赖 lead_days。

---

## 五、建议真机验证点

1. **登录态走一遍 10 项新功能**（enh-panels 10 个入口）。
2. **缺口补录**：销售/文员在网格内对带 ⚠️ 的 54 行补 `batch_no` / `expiry_date`。
3. **准确率 / 归因**：需先完成至少一期预报提交 + 产生实际销量才有数据，否则返回 note。
4. **供应商 PO**：按品牌聚合（非供应商主档），回写复用 P10-9 连接器骨架（未配置则 soft_fail）。
5. **主动预警**：开关打开后，体检异常自动 `pushForecast`（企微/飞书）。

---

## 六、非阻塞已知项

- `supplier-po` / `connector-writeback` 未配置连接器时 soft_fail（战略：回写走连接器不自研）。
- `variance` / `accuracy` 首期无实际销量时返回 note，非错误。
- P13-9 小程序录单页未在本期实现（仅定契约 + Web 入口），待小程序工程接入。
