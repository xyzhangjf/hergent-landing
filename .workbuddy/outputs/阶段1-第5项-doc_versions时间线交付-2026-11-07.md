# 阶段 1 第 5 项「C」：doc_versions 单据版本时间线 —— 交付报告

> 日期：2026-11-07　|　状态：**沙箱完成、已提交 `origin/main`、未部署**
> 关联：第 1 项（库存三写）/ 第 3 项（状态白名单）/ 第 4 项（字段锁＋乐观锁）
> 路线图决策：用户拍「C 和 A 都做」；销售·调拨·退货单字段级锁定**纳入阶段 2 统一收口**。

---

## 1. 结论

给每张核心单据留一条「谁、在什么时候、把单子从什么状态变成什么、改了哪些字段」的**版本时间线**，落库到新表 `doc_versions`。

- **不新增任何物理列**：表随首次写调用 `CREATE TABLE IF NOT EXISTS` **惰性创建**（不单独发迁移）；`version` 按 `(doc_type, doc_id)` 用 `SELECT COALESCE(MAX(version),0)+1` 自增（单连接串行、无需并发锁）；`fields_changed`/`data` 以 JSON 存、空则 NULL。
- **留痕两路同源**：状态跃迁挂 `set_doc_status`（全部单据类型通用生效）；字段编辑挂各单据编辑入口（本项接好采购单 3 个入口，其余单据无独立编辑函数、由状态守卫兜底）。
- **验收**：内核 `stage1-doc-versions-verify.py` **20/20**（含坏样本），函数级 e2e `stage1-doc-versions-e2e.py` **10/10**；并入 `stage1-verify-all.py` 后**全量 14/14 步通过**。

---

## 2. 收口前状况

第 3/4 项已把「状态」和「字段编辑」关进了 `doc_state` 单一源，但**没有任何一层把「这次到底发生了什么」记下来**：

- 一张单被改了状态、改了字段，事后无法回答「谁、何时、从什么到什么、改了哪几个字段」。
- 既有表 `document_states`（第 3 项核实）是 0 行影子表、前端不读；不能复用。
- 没有 `version` 物理列，也不想为时间线引入迁移 / 回填历史数据（与本轮「不新增列、不单独迁移」口径一致）。

---

## 3. doc_versions 设计

### 3.1 表结构（惰性创建，不加迁移）

```
doc_versions(
  id INTEGER PK AUTOINCREMENT,
  doc_type TEXT NOT NULL,        -- purchase_order / sale_order / transfer_order / ...
  doc_id   TEXT NOT NULL,        -- 业务单 id（统一转 str）
  version  INTEGER NOT NULL,     -- 按 (doc_type,doc_id) MAX+1 自增，从 1 起
  action   TEXT NOT NULL,        -- create | status_change | field_edit
  status_from TEXT,              -- 状态跃迁来源；非状态类留 NULL
  status_to   TEXT,              -- 状态跃迁目标
  actor    TEXT,                 -- 操作人
  fields_changed TEXT,           -- JSON 数组：本次实际改动字段名；空则 NULL
  data     TEXT,                 -- JSON：可选结构化细节（old/new）；空则 NULL
  created_at TEXT NOT NULL       -- '%Y-%m-%d %H:%M:%S'
)
+ UNIQUE INDEX uq_doc_versions_per_doc (doc_type, doc_id, version)
```

**为什么惰性建表 + MAX+1**：① 多租户按「每租户一个 DB 文件」隔离，故**不打 tenant 列**；② 不单独发迁移，随补丁部署即生效；③ 写入路径本就单连接串行，`MAX+1` 不会回退或重复（坏样本已证明：第 4~10 次写入 version=4..10，不回退）。

### 3.2 三个函数（`db/queries/doc_state.py` 末尾）

- `_ensure_doc_versions(db)`：幂等建表＋唯一索引。
- `record_doc_version(db, doc_type, doc_id, action, status_from=None, status_to=None, actor='', fields_changed=None, data=None)` → 返回本次 `version`。**不自行 commit**，事务归调用方。
- `doc_version_timeline(db, doc_type, doc_id)` → 按 `version` 升序返回，并把 `fields_changed`/`data` 的 JSON 字符串解析回对象。

### 3.3 留痕两路

- **状态跃迁（对全部单据通用）**：`set_doc_status` 在 rowcount 校验通过、return 前调
  `record_doc_version(db, doc_type, doc_id, 'status_change', status_from=src, status_to=to_status, actor=operator_id)`。
- **字段编辑（接采购单三入口）**：
  - `purchase_order_create`：建单后写 `create`（含 `status_to`）。
  - `purchase_order_update`（整单重写）：写 `field_edit`，`fields_changed` 固定 10 个核心/安全字段。
  - `purchase_order_update_header`（安全字段）：写 `field_edit`，`fields_changed` = 实际被改的列名（`[s.split('=?')[0] for s in sets]`）。

---

## 4. 改了什么

| 文件 | 改动 |
|---|---|
| `dev-src/db/queries/doc_state.py` | 顶部加 `import json`；`__all__` 加 `record_doc_version`/`doc_version_timeline`；`set_doc_status` 加 `status_change` 留痕；文件末尾加 `_ensure_doc_versions`/`record_doc_version`/`doc_version_timeline`（约 +98 行）。 |
| `dev-src/db/queries/purchases.py` | import 加 `record_doc_version`；`purchase_order_create` / `purchase_order_update` / `purchase_order_update_header` 三处各加一条 `record_doc_version` 钩子（约 +17/−2 行）。 |
| `patches/stage1-accumulated.patch` | 重生成（现 10 文件、2,130 行，含第 4、5 项增量）；`stage1-dev-src-rebuild.py --check` 逐字节自证 10/10。 |
| `tools/stage1-doc-versions-verify.py` | 新建，内核验收 20 判据（含坏样本）。 |
| `tools/stage1-doc-versions-e2e.py` | 新建，函数级 e2e 10 判据（真实业务函数）。 |
| `tools/stage1-verify-all.py` | `STEPS` 增两步（现 14 步）。 |
| `tools/stage1-make-patch.py` | 头注释补第 5 项说明（惰性建表、record/timeline、set_doc_status 通用留痕、purchases 三钩子、不新增物理列）。 |

---

## 5. 验证

`stage1-verify-all.py` **14/14 步通过**，其中本项：

- **内核 `stage1-doc-versions-verify.py` 20/20**：
  ① 建表惰性幂等（重复调用不报错、表结构稳定）② `version` 自增 1→2→3 ③ 落库内容（action/status_from/status_to/actor/fields_changed 为 JSON 数组/data 为 JSON 对象）④ `doc_version_timeline` 升序＋JSON 解析回对象 ⑤ **坏样本 MAX+1 不回退**（连续第 4~10 次写入 version=4..10，不因中间查询回落）⑥ 不同 `doc_id` 各自从 1 起算 ⑦ `created_at` 为时间戳格式 ⑧ 空 `fields_changed`/`data` 落 NULL。
- **函数级 e2e `stage1-doc-versions-e2e.py` 10/10**（复用 `demo.build_sandbox(reset=True, with_fix=True)`，自备最小 products/warehouses）：
  ① `purchase_order_create` 写 `create` ② `set_doc_status` 写 `status_change` ③ `purchase_order_update_header` 写 `field_edit` ④ timeline 恰好 3 条、`version` 升序且 action 正确 ⑤ **unchanged 不污染时间线**（`set_doc_status` 同状态早返，不新增版本行）。
- **回归未破坏既有**：状态 e2e 19/19 仍全绿（`set_doc_status` 新钩子不影响状态校验/乐观锁路径）。

---

## 6. 遗留缺陷 / 未做

- **销售·调拨·退货单的字段级留痕未接**：这三张单无独立编辑函数（无 `sale_order_update` 之类），其「字段编辑」目前只发生在状态跃迁（已被第 3 项守卫），故本项只对采购单三入口接 `field_edit`。用户已明确把**销售·调拨·退货单字段级锁定 + 留痕统一纳入阶段 2 收口**。
- **时间线查询接口未做**：`doc_version_timeline` 已就绪，但前端「单据详情 / 操作日志」页面尚未接、服务端路由未暴露（属展示层，随阶段 2 或 A 部署后补）。
- **`data` 结构化细节未填**：当前 `field_edit` 只记「改了哪些字段名」，未记 old/new 值（避免一次写入过大；如需审计到值，阶段 2 再决定）。
- **不部署**：与第 1/3/4 项一起攒够、统一上线。

---

## 7. 风险与落地步骤

- **向后兼容**：纯新增表＋纯新增写调用，不改任何既有列/既有写入语义；演示数据回放、状态 e2e 均通过 ⇒ 对线上现有单据零侵入。
- **性能**：每张单的每次状态/字段改动多一条 INSERT（同一事务内），量级与单据操作数同阶，无 N+1 风险。
- **落地前置（A 部署时一并处理）**：先与老张确认 `rebuild_balances()` 历史库存余额是否一次性重建（第 1 项遗留）；再 `git apply` 补丁 → 单测 → 复跑 `stage1-verify-all` 14/14 → 前端 build 部署 `hergent.cn` → 后端 `scp` `/opt/hergent-erp` + 双侧 md5 + restart + 等 8~10s → 灰度自测。
- **灰度自测要点**：建一张采购单 → 改状态 → 改备注 → 查 `doc_versions` 应有 3 行且 `version` 升序、action 分别为 `create`/`status_change`/`field_edit`。

---

## 8. 复现

```bash
cd /Users/zhangjunfeng/Documents/laozhangai-product
# 内核验收（含坏样本）
python3 .workbuddy/tools/stage1-doc-versions-verify.py
# 函数级 e2e（真实业务函数 + 惰性建表 + 时间线）
python3 .workbuddy/tools/stage1-doc-versions-e2e.py
# 全量回归入口
python3 .workbuddy/tools/stage1-verify-all.py
# 补丁↔开发副本逐字节自证
python3 .workbuddy/tools/stage1-dev-src-rebuild.py --check
```

提交纪律同前序：`git reset -q HEAD -- <我的文件>` → `git add` → `git -c core.quotepath=false diff --cached --name-only` 逐行确认只有我的文件 → `git commit -F`（不带 pathspec）→ push `origin/main`。**仍不部署、不动 `~/Documents/hergent-erp` 生产仓。**
