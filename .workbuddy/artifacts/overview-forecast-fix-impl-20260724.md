# 预报订单管理板块审核修复 — 实施与部署报告

> 依据《预报订单管理板块审核报告-2026-07-24.md》（35 项问题：P0×9/P1×16/P2×10），
> 经用户拍板（"按你的推荐来"）批准 5 个推荐方案，端到端完成 P0/P1 修复并部署生产验证。

## 一、交付摘要

| 批次 | 任务 | 内容 | 状态 |
|---|---|---|---|
| #208 | 后端 P0 | E2 RBAC 收口 + D2 save_matrix 单一大事务 | ✅ |
| #209 | 后端 P0 | A1/A2 submit_order 期次精确关联 + A7 accuracy 双口径 | ✅ |
| #210 | 后端 P0 | A5 rebate-gap 补 balances + A8 死代码删除×2 | ✅ |
| #211 | 后端 P0 | D1 N+1 批量优化×4（search_products/safety_suggest/ts_forecast/audit-items） | ✅ |
| #212 | 后端健壮性 | A4 404 / A9 幂等建表 / D3 reject / D4 store_ids / D6 LIMIT / D7 UUID / D8 截断 / D9 EXISTS / D10 索引 / D11 {items,total} | ✅ |
| #213 | 前端交互 | A6 合成行屏蔽删除/关闭 + B1 默认只读 + B2 删除清单物理删除 + B3 只读粘贴提示 | ✅ |
| #214 | 前端样式 | C1 heatStyle 7 色令牌化 + C2 ReportMapping 令牌对齐 + C3 计算列/校验态背景令牌化 | ✅ |
| #215 | 部署验证 | 生产部署 + 双角色 E2 验证 | ✅ |

## 二、关键变更

### 后端（hergent-erp，upgrade/v84-international 工作树，6 文件）
- **erp_db.py**（生产已同步）：`forecast_submissions` 增 `period_id` 列 + 幂等补列；`forecast_submission_create` 支持 `db_conn` 复用事务；新增 `rebate_balances_list()`
- **server.py**：`_PATH_MODULE_MAP` 中 `/api/forecast` 由 `reports` 收口到 `data`（supervisor 默认仅 dashboard+data，修复前访问预报页恒 403）
- **forecast.py**：A4（404/400 语义）、A8（删 column-schemes/accuracy 死代码）、A1/A2（期次精确关联 + all_done 恒真修复）、A5（rebate-gap 恒带 balances）、A9（payments 幂等建表）
- **forecast_config.py**：A7（accuracy 双口径 period_id→order_date 回退）、D1×2、D6、D7（UUID）、D8、D9、D10（索引）
- **forecast_submissions.py**：D2（四段事务合并单一大事务 + period_id 落库）、D3、D4
- **forecast_audit.py**：D1（search_products 批量 IN）、D11（{items,total}）、audit_period 健壮性、A3（可选 period_id）

### 前端（hergent-cn-v2，main 分支，4 文件）
- **Forecast.vue**：B1 默认只读（`editMode=false`）、B2 删除清单（`_deleted` 行保存时过滤→后端幂等重建即物理删除）、B3 只读粘贴提示、D11 doSearch 适配 `{items,total}`、C1 heatStyle 令牌化、C3 计算列/校验态背景令牌化、A6 confirmDelete/confirmClose 防御
- **ForecastHistory.vue**：A6 合成行（id<0）屏蔽关闭/删除按钮 + 品牌青 rgba 令牌化
- **ReportMapping.vue**：C2 全部圆角/按钮/标签对齐全局令牌（新增 --purple/--teal 扩展语义色）
- **variables.css**：新增 --heat-0..4 / --sum-* / --final-bg / --danger-* / --resizer-bg / --purple / --teal（浅/深双套）

## 三、构建

- 后端 6 文件 py_compile 全通过
- 冒烟测试 5 项 PASS（SQLite 内存库：A7 双口径 / A5 未结算合同 / D9 EXISTS / D2 upsert）
- 前端 `npm run build` 成功（1.86s，Forecast--1rZfBOv.js 214.38kB）

## 四、部署（⚠️ 关键决策：精确部署，非全量）

本地分支 upgrade/v84-international 相对生产 commit **0654b74 领先 15 个 commit、5000+ 行差异**（v111 返利整合/AI 卡片/demo/PLG/智能导入等，此前决策"暂缓推送"）。
**未跑 deploy.sh 全量 rsync**，改为：
1. 逐文件 md5 + diff 核对：确认 5 个 DIFF 文件的差异 100% 为本轮修复内容（生产 = 本地 − 修复），erp_db.py 已与生产一致
2. 备份生产 5 文件 → /root/backup_forecast_fix_20260724/
3. 精确 scp 5 文件 → chown → 清 __pycache__ → systemctl restart
4. 前端 rsync dist/ → /opt/hergent-cn-v2/ → chown

**风险规避价值**：避免了 15 个未发布 commit 被误带上生产。

## 五、生产验证（真实登录态）

| 验证项 | 方法 | 结果 |
|---|---|---|
| E2 修复 | supervisor（mptestsp）访问 `/api/forecast/order-board` | ✅ HTTP 200（修复前 403） |
| A7 accuracy | supervisor 访问 `/api/forecast/accuracy?period=week` | ✅ 返回真实期次关联（"基准期次：9月提审期-开放填报"） |
| A5 balances | POST `/api/forecast/rebate-gap` | ✅ 响应恒带 `balances` 键 |
| A4 404 | DELETE `/api/forecast/periods/999999` | ✅ HTTP 404（修复前 200 伪成功） |
| 双角色 | sales（mptest）/ supervisor 均访问预报模块 | ✅ 均 200 |

## 六、需确认事项

1. **accuracy hit_rate=0 是数据现实**：提审期预报 5 件、实际销量尚未产生（期次 2026-08-30~09-15 未结束），非 bug；期次结束后 accuracy 自然出真实命中率
2. **B2 删除行语义**：删除行在保存后才物理消失（后端幂等重建），不保存点「取消」可放弃——符合"AI 只建议不擅自下单"的设计铁律
3. **B1 默认只读**：进入预报页默认只读交叉表，点「编辑」进入编辑网格；原先默认编辑态对非录入员暴露过早
4. **后端 15 个未发布 commit**：仍在 upgrade/v84-international 分支，未随本轮部署上生产；后续发布需单独评审
5. **回滚预案**：备份位于生产 `/root/backup_forecast_fix_20260724/`（server.py + routers/×4）
