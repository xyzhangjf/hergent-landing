# 品牌档案 D1 交付概览（2026-08-28）

## 本次完成的缺口
之前 D1 只部署了「路由 + Archive.vue 品牌档案 tab」，**核心组件 `BrandArchive.vue` 从未落盘**，且 `Archive.vue` 用了 `<BrandArchive>` 却漏了 import —— 点 tab 会空白/报错。本次补齐并验证。

## 后端（已部署，直连验证通过）
- `brand_pending` 表已落在主库 `/opt/hergent-erp/erp.db`（v28_brand_pending 迁移记录已落地）。
- 直连验证：`list_brand_pending()` → `[]`；`add_brand_pending()` / `resolve_brand_pending(create/merge/dismiss)` 全链路正常。
- 接口契约（已核对 `routers/purchase.py`）：
  - `GET /api/brands?include_inactive=1` → 品牌列表（含 product_count）
  - `POST /api/brands` / `PUT /api/brands/{id}` / `POST /api/brands/{id}/toggle`
  - `GET /api/brands/pending` / `POST /api/brands/pending/{pid}/resolve`（body: {action, target_name}）
- HTTP 实测：`/api/brands/pending` 现返回 **401（鉴权门）而非 500（表缺失）**，证明表已建、handler 可达。

## 前端（新建并部署）
- 新建 `src/pages/BrandArchive.vue`：
  - 品牌主档表（名称 / 厂商 / 等级 / 关联商品数 / 状态）+ 新增表单 + 编辑弹窗（名称/厂商/等级/统一信用代码/官网/联系方式/备注）+ 停用/启用。
  - **待审品牌面板（决策②）**：每行含命中次数/来源/发现时间，提供「新建为品牌(create)」「合并到已有(merge)」「忽略(dismiss)」，调 resolve 接口并改挂历史商品 brand。
  - 复用现有 `.card/.table-wrap/.btn/.input/.df-modal` 体系，对齐 EmployeeArchive 风格；用统一 `api()` 客户端。
- `Archive.vue` 补 `import BrandArchive`；`router/index.js` 删未使用的孤儿 `BrandArchive` 懒加载 const。
- 构建：`BrandArchive` 静态打包进 `Archive-C5564Wo2.js`（34KB）。
- 部署：rsync 至 `/opt/hergent-cn-v2` + chown hergent；生产 grep 确认「待审品牌」「品牌档案」「archive/brands」均存在。

## 根因复盘（之前 500 的真相）
- 端口 8700 仅由最新代码进程(pid 1919110, cwd /opt/hergent-erp)持有；旧目录 /opt/hergent/server 的陈旧进程(8765/8766)不抢端口。
- 之前 19:15 的 `no such table` 是重启前旧进程实例抛的；19:17 重启后迁移才真正建表。
- 首次 v28 DDL 误用 `created_at TEXT DEFAULT (datetime(...))` 被 SQLite 拒，已改 `DEFAULT ''` 由代码内联填值（调试残留 `__TEST_BRAND__` 已清理，pending 回到 0 行）。

## 遗留（非本次引入，已单列）
- `erp_db.py` 大量存量 `CREATE TABLE` 用 `DEFAULT (datetime('now','localtime'))`（约 269/279/309 等行），本机 SQLite 会拒；属历史技术债，系统一直容忍运行，未顺手改生产 DDL（有风险）。

## 待续（pending 任务）
- D2 #277：商品品牌字段改 brands 下拉 + 允许新建（normalize 接驳 4 写入入口）。
- D3 #278：导入/舟谱写入路径接 normalize，未命中品牌入待审队列。
- D4 #279：目标/返利品牌选择器校验存在于 brands 表。

## 验证说明
当前已做：Vue 构建（模板/导入编译通过）+ 后端函数直连 + HTTP 鉴权门验证。
建议追加：登录态无头浏览器真机点开「档案管理→品牌档案」核对渲染（受限于鉴权，需测试账号或开启 demo 登录）。
