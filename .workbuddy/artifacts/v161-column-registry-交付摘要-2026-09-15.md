# v161 交付摘要 · 报单矩阵「列注册表 + 列值」服务端权威化

**日期** 2026-09-15 ｜ **用户指令** 「A」（选定 P0 列元数据落库 + P1 值存储落库）
**提交** 后端 `785f387`（hergent-erp）· 前端 `52207eb`（laozhangai-product）

---

## 一、交付

| 项 | 内容 |
|---|---|
| 后端 | 5 文件 **+457/-2**；新建 `server/db/queries/forecast_columns.py`（359 行 · 唯一实现） |
| 前端 | 2 文件 **+157/-31**；`hergent-cn-v2/src/api/modules.js` + `src/pages/Forecast.vue` |
| 新 API | `GET/POST /api/forecast/columns`、`PUT/DELETE /api/forecast/columns/{key}`、`POST /api/products/extra-values` |
| 新列 | `products.extra_json`（JSON 扩展列）、`custom_fields.is_system` |
| 验证 | 后端隔离租户 E2E **35/35**；真机 Playwright **16/16** |
| 部署 | 后端 `active`（`{"status":"ok", "api_count":110}`）；前端 `Forecast-Mr9qokbO.js` **双侧 md5 = `d0a504d3682097190e2ae4b202efce1d`** |
| 清理 | 沙箱 `tenant_9997` 已销毁：`ZERO_RESIDUE: true`、源库 `src_business_check.verdict = ok` |

## 二、变更（解决了什么）

1. **「不可删除列」从前端约定升级为服务端权威** —— 此前只由前端 `MASTER_COL_DEFS[].deletable`
   单方决定，后端没有任何对应物。
2. **自定义列的定义与值从浏览器搬进租户库** —— 此前换设备即丢；且值按 `条码::名称` 定位
   ⇒ **商品改名 / 改条码会静默丢值**。现在值按 `product_id`，列 key 由服务端生成（`f_xxxxxxxx`）。
3. **降级不静默** —— 注册表拉取失败会 toast「本次按内置规则显示（新增/删除列不可用）」，
   不会让用户把降级误当正常。
4. **运行期不再吞异常** —— 自定义列没落库属于"静默丢数据"，一律 toast 告警。

### 三类列的最终口径

| 类别 | 列 | 可删 | 说明 |
|---|---|---|---|
| **系统列**（服务端权威） | 商品名称 / 条码 / 标准售价 / 分销价 / 厂家编码 | ❌ | 恰好 5 个，`forecast_columns.PROTECTED_COLUMNS` |
| **可删内置列** | 品牌 / 规格 / 单位 / 进价 / 安全库存 / 保质期天 / 起订量 / 到货天数 | ✅ | 固定 schema 列，**刻意不登记**（登记 = 抄第二份事实） |
| **自定义列** | 用户自建 | ✅ | key 由服务端发；值存 `extra_json` |

## 三、构建 / 部署

- 前端：`CODEBUDDY_SAFE_DELETE_ENABLED=0 npx vite build` → `rsync -az --delete dist/` → `/opt/hergent-cn-v2/`
- 后端：scp 具名文件 → `chown` → `systemctl restart hergent-erp` → `is-active` → `curl 127.0.0.1:8700/api/health`
- 迁移：**无需手工"三处登记"** —— 主库 schema 为唯一权威源 + 启动给每个租户库做列级对账（v131e）。
  实测日志：`[schema-sync] tenant_1.db 补列(+1): ['products.extra_json']`，告警 0 条。

## 四、对齐效果（真机逐列实测）

16/16 通过，其中最有说服力的是**逐列右键菜单与服务端下发的注册表逐字对上**：

| 表头 | 有「删除列」 | 与服务端注册表 |
|---|---|---|
| 商品名称 / 条码 / 标准售价 / 分销价 / 厂家编码 | ❌ | ✅ 正是下发的 5 个 system |
| 品牌 / 规格 / 单位 / 进价 / 安全库存 / 保质期天 / 起订量 / 到货天数 | ✅ | ✅ 均不在注册表 |
| **验证真机列**（自定义，`f_4a0d5dc3`） | ✅ | ✅ 自定义列 |

另：接口 200（`/api/forecast/columns`、`/api/products/grid`）、编辑网格列头含自定义列、
单元格 input 渲染出服务端值「真机值A」（命中 2 个）、无 4xx-5xx、无 console error。

## 五、需确认事项

1. **P2 / P3 本轮未做**（已确认在范围外）：导入三方对账（命中不可删除列 / 命中已注册字段 /
   候选新字段 三选一）、列类型整体采样与校验 —— 是否下一轮做？
2. **两个仓库均未推送**（延续暂缓姿态）—— 本轮要推吗？
3. 上一轮报告里**仍未处理**的 5 项：旧产物目录 `.本期预报-报单导入模版-v1.ref/build.py` 含真实名单 /
   厂价闸门（430 商品 0 个有厂价）/ 主表 21 个报单对象中 19 个不在「报单配置」/ 系统「下载模板」端点
   形态合并 / 粘贴列名别名 `'永辉代码'` —— 优先级如何排？
4. 用户已标「另开一轮」的两项：线上仓库 HEAD 不自洽（`stripAllFences`）、
   汇总表「单价(厂价) / 下单金额」列口径。

## 附：本轮的方法论教训

真机首轮 **9/10 的 FAIL 是测试假阳性，不是产品缺陷** —— `th.click({button:'right', force:true})`
**即使加 `force` 仍按元素中心坐标派发**，而编辑网格列头带 sticky/frozen + 横向滚动
⇒ 三次**不同目标**的右键实际全落到「条码」th 上（三份菜单文本逐字相同）。
改为对目标 `th` 直接 `dispatchEvent(new MouseEvent('contextmenu', …))` 后逐列定案。

**判据：多个不同目标的断言返回完全相同的结果 ⇒ 先怀疑测试没打到目标，再怀疑产品。**
（这条已沉淀进技能 `hergent-frontend-deploy-verify` §四 与 `hergent-scoped-commit` §11。）
