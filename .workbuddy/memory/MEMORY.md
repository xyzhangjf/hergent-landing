# Hergent 记忆索引

> 完整原文存档：`topics/memory-index-full-2026-11-06.md`（含全部实测数字、版本线、坏样本细节）。本文件为压缩索引；查细节先搜该存档，再按域指针进 `topics/*.md` / `memory/YYYY-MM-DD.md`。

## 进行中 / 当前状态（🔴 最重要）
- **阶段 1（进销存交易一致性）沙箱已完成 3 项、未部署、补丁未落地后端仓**：
  - 第 1 项「库存写入点收敛」：13 裸写→`write_stock_movement` 台账/流水/余额同 `SAVEPOINT` 三写（沙箱 61 判据）。
  - 第 3 项「状态跃迁白名单」：`db/queries/doc_state.py` 唯一源＋`guard_sql` 两层守卫＋中文原因（沙箱 131 判据）。
  - 第 4 项「提交后字段锁定＋乐观锁」：字段锁单一源 `editable_fields`/`_phase`/`assert_no_locked_fields`＋复用 `status` 令牌乐观锁（沙箱 28 判据）。
  - 累积补丁 `patches/stage1-accumulated.patch`（10 文件）由 `stage1-make-patch.py` 生成、`stage1-dev-src-rebuild.py --check` 逐字节自证。🔴 dev-src 整份生产源码副本**不入库**。
  - 阶段 1 余项：`doc_versions` 时间线 / `party_ledger` 接线 / 落地部署（需先定 `rebuild_balances()`）。
- 交付报告：`outputs/阶段1-第1项-…-2026-11-06.md` / `阶段1-第3项-…-2026-11-07.md` / `阶段1-第4项-…-2026-11-07.md`。

## 🔴🔴 最高频硬判据（首句＋去哪查）
- **粘贴＝绝对覆盖**：`writeCellVal` 数量格 `= parseNumInput(v)` 整体赋值，但门店格显示＝`qtyByUnit+allocOfStore()`，缺 `qtyCellTakeOver` 接管 ⇒ 粘 12 仍显 12+分摊。修法：`writeCellVal` 写值前先 `qtyCellTakeOver`。反累加分水岭判据「连粘两次 12 仍是 12」。
- **库存写入点＝13 个**（非 6）：查询层 6＋`erp_db.py` 5＋`sync_writer` 1＋`wastage_tracker` 1。收编「数量/金额变了」非「行被改过」（`location_id`/`bin_location` 只改货位须白名单）。
- **三写 SQL 参数顺序错照样假成功**：扣减分支守卫值排 `inv_id` 前 ⇒ 流水记了出库、台账没扣，缺陷只藏发货路径。
- **状态机三套只有业务表 `status` 真**：`approvals.py`/`document_states` 影子表是假。收口唯一源 `doc_state.py`；守卫两层；正则 `(?<![_A-Za-z])status`；白名单须装下现有业务（调拨 `draft→completed` 合法、销售 `signed→cancelled` 放行）。
- **字段锁与状态白名单同源**：`_phase`（full/submitted/terminal）/`editable_fields`/`assert_no_locked_fields`；草稿整单可改、提交后锁核心只留安全字段＋同仓、终态仅安全字段；乐观锁复用 `status` 令牌（`UPDATE … WHERE id=? AND status=?`，rowcount=0 报「刚被别人改过状态」），**不新增列**。
- 前端其他判据（显示≠校验负数、严格 N 行覆盖、粘贴结果面板已删、flex 文案断行、`<GoLink>`≠`useGoPage` 等）**见完整存档**。

## 🔴 阶段 0 线上核实（2026-11-06）
生产 `inventory_logs` 281 条全是 10-29 opening 快照＝假绿；生产后端**非 git 仓**且领先；`status` 全无 CHECK；`party_ledger` 建表未接线；只保存草稿不写库存 ⇒ 入库确认/发货才长流水。证据 `outputs/阶段0-线上只读核实报告-2026-11-06.md`。

## 部署（全文 `topics/deploy-ops.md`）
`deploy-frontend-closure.py --push` 三步验闭包；构建号 build 时从 git 最近提交取 vNNN ⇒ **先 commit 再 build**；ERP 前端域名＝`hergent.cn`（curl 错域名会得 404 假结论）；后端单文件 `cp -a`→`scp`→`chown`→双侧 md5→restart→等 8~10 秒。

## 路由 / 主体 / 本机坑
- 前端 `topics/frontend-ui.md`（门禁 `pages.js` 唯一源、`permView.js` 唯一源）｜后端 `topics/backend-invariants.md`（`execute_tool` 返回键 `success`、改角色权限走 `POST /api/role-permissions`）｜域：预报/返利/成本容量/账务/条码小程序/副驾租户/库存/通知。
- 主体 `hergent-cn-v2` + `hergent-erp`(FastAPI+SQLite)；脱敏红线：返利率/进货价/客户名/区域销量/厂家政策。
- 本机坑：`grep "A\|B"` 静默失效⇒一律 `-e`｜`| head/tail` 截掉决定性命中｜`git commit -m` 含 `{}`/反引号静默失败⇒`-F`｜`patch` 不加 `--batch -f`+`stdin=DEVNULL` ⇒ 被 SIGTERM（exit 137）｜zsh `${PIPESTATUS[0]}` 恒空⇒「管道吞退出码」用 `> file; RC=$?`。
