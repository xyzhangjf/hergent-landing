# 预报订单导入 — 统一模板功能

## 完成内容
为「预报订单导入」（交叉表 / `forecast_cross`）新增**统一下载模板**，解决不同用户用不同表格导致字段错位「翻车」的问题。

## 改动文件
- **后端** `server/routers/import_router.py`
  - 新增端点 `GET /api/import/template-file/{category}`：用 openpyxl 生成真实 `.xlsx` 模板。
    - 表头带「*」必填标记（红色填充），其余加粗；
    - `forecast_cross` 自动带入**本租户现有客户**作为列（统一布局，杜绝自定义表格）；
    - 含示例数据行 + 「填写说明」工作表；
    - 其他分类降级为表头 + 示例行（兼容商品/客户/库存/应收/订单/员工）。
  - 导入预览阶段新增校验：未识别「商品名称」列时显式告警，避免整批商品被静默跳过。
- **前端** `src/api/modules.js`：新增 `importApi.templateFile()`（fetch + blob 下载，绕过 JSON 解析）。
- **前端** `src/pages/Forecast.vue`：预报导入弹窗新增「下载模板」按钮（`imp-actions` 布局），接线 `downloadFcTemplate()`。

## 验证
- 后端健康检查 HTTP 200；`/api/import/template-file/forecast_cross` 返回 `application/vnd.openxmlformats...sheet` 6264 字节。
- 模板内容实测：身份列 `商品名称*/条码/规格/单位/单价` + 租户客户列（苏果超市、全家便利店、鲜丰水果、美宜佳(解放路店)…）+ 示例行 + 说明 sheet。
- 前端 `下载模板` 文案与 `imp-actions` 已随生产 bundle 落地。

## 说明 / 备注
- 模板客户列来自系统现有客户档案；如需新增客户，可在右侧自行追加列（表头写客户名），系统仍自动识别。
- 重复导入同一期次会覆盖「导入」数据，不影响小程序报单（幂等保护）。
- 现有库存/商品等导入仍沿用原 CSV 模式；如需也升级为 xlsx 模板，可复用同一端点（已支持）。

## 后续
- 可在「专家中心」或后续迭代中为其它分类（如库存、商品）接入同一 xlsx 下载按钮，形成统一导入体验。
