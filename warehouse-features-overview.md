# 仓配管理缺失功能 — 已全部开发并上线 (v108)

入口统一在 **仓配管理** 面板。本次补全 4 项原本空白/未开发的功能，已构建并部署到生产环境验证通过。

## 补全清单

| 功能 | 入口 | 说明 |
|---|---|---|
| **临期预警表** | 仓配管理 → 临期预警表 | 全屏弹层，红区(≤30天)/黄区(31–60天) 效期预警，按效期汇总数量与批次。数据来自 `/api/expiry/forecast`（FEFO 规则）。 |
| **WMS 控制台** | 仓配管理 → WMS 控制台 | 复用既有深度能力：补货需求、越库调度（自动加载）+ 上架策略（按产品ID）、拣货路径优化（按波次ID）。 |
| **库存锁定·到期时间** | 仓配管理 → 库存锁定 | 新增「到期时间」字段（留空=长期锁定）；列表临期（≤24h）高亮。修复了原到期判断恒为 false 的 bug（SQLite 字符串 vs ISO 比较）。 |
| **条码操作（后端）** | 仓配管理 → 条码操作 | 修复 `batch_in`/`batch_out_fefo` 参数顺序错误 + 新增扫描流水表 `barcode_scan_logs` 与记录/查询函数，扫码出入库现在真实写入库存与流水。 |

## 关键技术处理
- **遗留脏 schema 重建**：生产库 `barcode_scan_logs` 已存在且是旧字段（`scan_type/ref_type/ref_id`），导致 `CREATE TABLE IF NOT EXISTS` 不生效、`INSERT` 报 `no such column: direction`。已 DROP+重建为 `direction/batch_no/cost`，并在迁移中加 **self-heal**（检测到旧 schema 自动重建），防止复发。
- 顺手修正：`main.js` 中 `wms-console.js` 被重复 import；侧边栏去重（本会话更早工作）注释掉的 ~11 个重复入口，因 `navTo` 对未注册模块静默返回，不会崩溃。

## 部署与验证
- 前端：`vite build` → `main-BjcTE3GO.js` + `main-DWmeGzR9.css`，`rsync` 至 `47.113.224.140:/opt/hergent-erp/static/`（保留 `avatars`）。
- 后端：`scp` 4 个文件（`erp_db.py`/`barcode.py`/`inventory.py`/`stock_lock.py`），`chown` + 清 `__pycache__` + `systemctl restart hergent-erp`。
- 验证：`/api/health` = **200**；`/api/barcode/scan-in`、`/api/expiry/forecast`、`/api/wms/*`、`/api/stock-locks` 均返回 **401**（路由通 + 鉴权生效，非 404）；两库 `barcode_scan_logs` 字段正确。

## 待办 / 说明
- 本地改动**尚未 git commit**（含侧边栏去重 + 本次仓配改动），确认后可提交。
- 仓配管理下仍有 **9 个 `dev:true` 占位入口**（入库单、司机任务看板、组拆单、挑货明细、组合拆分汇总表、成本异常表等）——它们需要新建后端模块，不在本次「补缺」范围内，需另行排期。
