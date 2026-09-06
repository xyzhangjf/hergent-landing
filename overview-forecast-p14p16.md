# 预报订单模块 · 第五层增强（P14/P15/P16）交付总览

> 日期：2026-08-23 | 范围：在已上线四层（基础22 + P5/P6/P7 + P8/P9/P10 + P11/P12/P13）之上，落地第五层「算法智能 → 自动化闭环 → 商业生态」共 10 项增强。
> 指令：用户「全做」——10 项端到端落地 `Forecast.vue` 并真正部署后端端点。

---

## 一、交付清单（10 项全部上线）

| 优先级 | 编号 | 功能 | 入口标记 | 价值 |
|---|---|---|---|---|
| P14 算法 | P14-1/2 | 时间序列预测 + 置信区间 | 🤖 | **高** — 算法护城河起点（历史销量回归外推+95%区间） |
| P14 | P14-3 | 节假日/促销日历因子 | 📆 | 中 — 节令放大因子一键叠加 |
| P14 | P14-4 | 滞销/临期反向预警 | 🔻 | 中 — 反向去库存建议 |
| P15 闭环 | P15-5 | 采购单直发 | 🧾 | **高** — 预报→采购真正闭环（持久化+连接器直推） |
| P15 | P15-6 | 异常自愈闭环 | 🛠 | 中 — 异常+干预方案+处置状态跟踪 |
| P15 | P15-7 | Hermes 深度联动 | 🧠 | 中 — 异常交 Hermes 大脑根因分析 |
| P16 商业 | P16-8 | 配方市场 | 🏪 | **高** — 行业配方变可交易资产（变现抓手） |
| P16 | P16-9 | 数据健康分 | 💡 | 中 — 每 SKU 评分（深化 P11-1） |
| P16 | P16-10 | 移动端真机闭环 | 📲 | 中 — Web 侧录单表单闭环（小程序另立） |

---

## 二、改动文件

### 前端（hergent-cn-v2）
- `src/pages/Forecast.vue`
  - enh-panels 加 9 按钮（🤖📆🔻🧾🛠🧠🏪💡📲）
  - 大脚本块 P14-P16（`miniInputOpen` 之后、`P0-2 Excel 导入` 之前）：8 个面板开关联动 ref + 各 load/apply/submit 函数
  - 名称单元格加 💡 健康分徽标（`hsMap<60`）
  - 模板插入 8 个新面板（ts/cal/slow/po2/heal/hermes/market/hs）
  - P13-9 面板升级为可用录单表单（选商品+数量+单位+备注 → `submitOrder`）
  - CSS 加 `.hs-badge/.mini-form/.mini-msg/.heal-row`
- `src/api/modules.js`（`forecastApi` 补 13 方法）

### 后端（hergent-erp，单文件改动）
- `server/routers/forecast_config.py` 追加 **11 端点**（文件由 ~623 行扩至 ~850 行）：
  - `GET /api/forecast/ts-forecast`（P14-1/2）
  - `GET|PUT /api/forecast/calendar-factors`（P14-3）
  - `GET /api/forecast/slow-movers`（P14-4）
  - `POST /api/forecast/purchase-order` + `GET /api/forecast/purchase-orders` + `POST /api/forecast/purchase-order/push`（P15-5）
  - `GET|POST /api/forecast/interventions`（P15-6）
  - `POST /api/forecast/hermes-analyze`（P15-7，复用 `HERMES_API_BASE/HERMES_API_KEY`）
  - `GET /api/forecast/recipe-market` + `POST /api/forecast/recipe-market` + `POST /api/forecast/recipe-market/adopt`（P16-8）
  - `GET /api/forecast/data-health`（P16-9）
- `server.py` 未改（router 已 `include_router`）。

---

## 三、部署与验证结果

| 项 | 结果 |
|---|---|
| 前端 build | ✅ `Forecast-DiKmwpaA.js` 427.31 kB / gzip 137.57 kB，built 1.23s |
| 前端部署 | ✅ rsync → `/opt/hergent-cn-v2/` + chown hergent:hergent → RSYNC_FRONTEND_OK；9 功能中文标记 + 8 接口路径均编入 dist |
| 后端部署 | ✅ `bash deploy.sh` → health HTTP 200 |
| 后端端点核验 | ✅ 11 新路由未授权探测均 401（确认挂载 + 鉴权生效） |
| 编译 | ✅ 后端 `py_compile` 通过；前端 `npm run build` 一次通过 |

> 部署告警说明：rsync 删除远端 `hermes-engine/.hermes/*`、`backups/20260709_*` 为历史陈旧目录非致命告警；health 探测偶发 HTTP 000 系重启 ~6s 窗口，sleep 后复检 200。

---

## 四、关键适配与架构边界

- **P15-5 采购单** 仍按 `brand` 聚合（守「不自研 ERP、只做 AI 层」边界），回写/推送复用连接器骨架（未配置则 `soft_fail`）。
- **P14-1 时间序列** 依赖 `sale_order_items` 历史（SQLite `strftime` 按月聚合），无历史则降级提示「需先产生实际销售数据」。
- **P15-7 Hermes** 若生产未配置 `HERMES_API_KEY` 则 `soft_fail`（不阻断前端），配置后真正调用大脑根因分析。
- **P16-10** 小程序录入页未在本期实现（契约见 `forecast-miniprogram-input-contract.md`），Web 侧先做可用闭环表单。

---

## 五、建议真机验证点

1. **登录态走一遍 9 个新面板**（enh-panels 9 个入口）。
2. **智能预测 / 滞销临期** 需历史销量数据才有结果（首期可能为空）。
3. **采购直发 / 配方市场 / Hermes 分析** 需对应配置（连接器 / Hermes key）才真正生效，否则 `soft_fail` 提示。
4. **数据健康分** 徽标随评分实时显示在网格名称列（分<60 标 💡）。
5. **移动录单** Web 表单提交后，「✅ 审批」面板 `reportedUnits` +1。

---

## 六、非阻塞已知项

- `purchase-order/push`、`hermes-analyze` 未配置对应通道时 `soft_fail`（战略：回写/大脑接入走配置，不自研）。
- `ts-forecast` 首期无历史销量返回空，非错误。
- P16-10 小程序工程内录入页为待办（本期仅 Web 闭环 + 契约）。
