#!/usr/bin/env python
"""v465e 影子库验收 —— 仓配管理 P1（出库单 / 其它出入库单）后端。

跑法：
    SRC=/tmp/v465e-shadow-src \
    /Users/zhangjunfeng/.workbuddy/binaries/python/envs/default/bin/python \
        .workbuddy/tools/v465e-shadow-verify.py

设计要点（照 v403/v404/v465c 的影子库纪律）：
  · **只写影子副本**，生产快照原样不动（`SRC` 只读，每次重新拷进 WORK）。
  · **Phase 0 不 import 应用**：裸 sqlite3 读原始快照 ⇒ 证明 `wh_*` 四表在生产里**不存在**，
    后面的「懒建表」才是可观察的真实新增（而不是本来就有的表被当成我建的）。
  · **相位反转 = 判别力的证据**：Phase 4 必须让前面为真的断言**变假**
    （库存不足 ⇒ 整单不落；重复过账 ⇒ 拒绝）。只跑一侧全绿不构成证据。
  · **判别力自证（Phase 5）**：证明「出库单走 fefo_deduct」与「其它出库走 inventory_adjust」
    真的是**两条不同的路** —— 对同一批**已过期**库存，前者拒收、后者放行。
    否则「两个方向用不同原语」这个设计决定就是没被验证过的。
  · `ERP_DB_PATH` 必须在 **import erp_db 之前**设好（`DB_DIR` 由它推导，租户库跟着走影子目录）。

Phase 7–9（本轮追加，覆盖「盘点引擎 + 批次级扣减」这批新增代码）：
  · **Phase 7** `_gross_deduct`：手工在影子库造「同商品两批次（一过期一未过期）」，证明
      ① 它**先扣过期批**（排序键与 fefo 同序、但不过滤效期）；② 与 `fefo_deduct` 结论**相反**
      （同一批货 fefo 拒、gross 放行）⇒ 两条路确实是两条；③ 库存不足时**零部分扣减**（原子守卫）。
  · **Phase 8** `_avg_cost`：加权平均，且**无库存返 0**（不编造成本）。
  · **Phase 9** 盘点引擎（自建 `wh_stock_take*`）：相位反转 = 判别力
      —— 未录数不能完成 / 完成不能重做 / 完成不能补录；
      盘亏落 `_gross_deduct`（对表 `inventory_logs.change_type='wh_stocktake_loss'`）、
      盘盈落 `batch_in`（对表 `...'wh_stocktake_gain'`，且**不编造批次号/效期**）；
      UPSERT 能给「账上还没有的货」补一行（`system_qty` 现算 = 0）。
"""
import os
import shutil
import sqlite3
import sys
import traceback

SRC = os.environ.get("SRC", "/tmp/v465e-shadow-src")
WORK = os.environ.get("WORK", "/tmp/v465e-shadow")
SERVER_DIR = "/Users/zhangjunfeng/Documents/hergent-erp/server"

PASS, FAIL = [], []


def ok(name, cond, got=None):
    (PASS if cond else FAIL).append(name)
    print(f"  {'✅' if cond else '❌'} {name}" + ("" if cond else f"   ← got={got!r}"))
    return cond


def section(t):
    print(f"\n{'─' * 72}\n{t}\n{'─' * 72}")


def ro(path, sql, args=()):
    c = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        return c.execute(sql, args).fetchall()
    finally:
        c.close()


def cols_of(db_path, table):
    return [r[1] for r in ro(db_path, f"PRAGMA table_info({table})")]


TENANT = os.path.join(WORK, "tenant_1.db")

# ============================================================ Phase 0（不 import 应用）
section("Phase 0 · 基线（裸 sqlite3 读原始快照，不 import 应用）")
if not os.path.isdir(SRC):
    print(f"❌ 快照目录不存在：{SRC}")
    sys.exit(2)

names = [r[0] for r in ro(os.path.join(SRC, "tenant_1.db"),
                          "SELECT name FROM sqlite_master WHERE type='table'")]
wh_tables = sorted(n for n in names if n.startswith("wh_"))
ok("基线：生产租户库**没有任何** wh_* 表", wh_tables == [], wh_tables)
ok("基线：inbound_orders 存在（P1 复用的既有表，不是新建）", "inbound_orders" in names)
ok("基线：stock_takes 存在（**legacy 盘点表**，本轮不动它、也不复用它）", "stock_takes" in names)

shutil.rmtree(WORK, ignore_errors=True)
os.makedirs(WORK)
for f in ("erp.db", "tenant_1.db"):
    shutil.copy2(os.path.join(SRC, f), os.path.join(WORK, f))

os.environ["ERP_DB_PATH"] = os.path.join(WORK, "erp.db")
# core.py 在 import 期就要求 ERP_SECRET（缺失直接 RuntimeError）—— 影子库只做本地验收，
# 用一个长度达标的假值即可，**绝不读生产密钥**（影子库不该持有任何真实凭据）。
os.environ.setdefault("ERP_SECRET", "shadow-verify-" + "0" * 48)
sys.path.insert(0, SERVER_DIR)
import erp_db as db                                          # noqa: E402
from db.connection import tenant_scope, get_db              # noqa: E402
from db.queries import wh as whdb                           # noqa: E402
from db.queries.inventory import fefo_deduct, inventory_adjust  # noqa: E402

# 选一个有库存的商品做 FEFO 测试（生产快照里库存都无批次/无到期日 ⇒ 都算「可售」）
P1 = int(ro(TENANT, "SELECT product_id FROM inventory WHERE quantity>0 AND warehouse_id=1 "
                    "ORDER BY quantity DESC LIMIT 1")[0][0])
BASE_QTY = float(ro(TENANT, "SELECT quantity FROM inventory WHERE product_id=? AND warehouse_id=1",
                    (P1,))[0][0])
CUST = int(ro(TENANT, "SELECT id FROM contacts WHERE type IN ('customer','both') LIMIT 1")[0][0])
print(f"\n  测试商品 #{P1}（仓 1，基线库存 {BASE_QTY}）、客户 #{CUST}")


def stock(pid, wid=1):
    r = ro(TENANT, "SELECT COALESCE(SUM(quantity),0) FROM inventory WHERE product_id=? AND warehouse_id=?",
           (pid, wid))
    return float(r[0][0])


def logs(pid, ref_type):
    return ro(TENANT, "SELECT COUNT(*) FROM inventory_logs WHERE product_id=? AND change_type=?",
              (pid, ref_type))[0][0]


# ============================================================ Phase 1 · 懒建表 + 建单
section("Phase 1 · 懒建表（幂等）+ 建单")
with tenant_scope(1):
    ok("列表在空库上返回 []（不抛 no such table）", whdb.wh_outbound_list() == [])
    ok("其它入库列表在空库上返回 []", whdb.wh_entry_list(direction="in") == [])
    ok("其它出库列表在空库上返回 []", whdb.wh_entry_list(direction="out") == [])

names2 = [r[0] for r in ro(TENANT, "SELECT name FROM sqlite_master WHERE type='table'")]
for t in ("wh_outbound_orders", "wh_outbound_items", "wh_stock_entries", "wh_stock_entry_items"):
    ok(f"懒建表已创建 {t}", t in names2)
idx = [r[0] for r in ro(TENANT, "SELECT name FROM sqlite_master WHERE type='index'")]
ok("索引 idx_woi_outbound 已建", "idx_woi_outbound" in idx)
ok("索引 idx_wsei_entry 已建", "idx_wsei_entry" in idx)

# CHECK 约束必须真的落到表定义里（方向 / 状态 / 数量>0）
ddl = ro(TENANT, "SELECT sql FROM sqlite_master WHERE name='wh_stock_entries'")[0][0]
ok("wh_stock_entries.direction 有 CHECK", "CHECK(direction IN ('in','out'))" in ddl)
ok("wh_stock_entries.status 有 CHECK", "CHECK(status IN ('draft','posted','cancelled'))" in ddl)
ddl2 = ro(TENANT, "SELECT sql FROM sqlite_master WHERE name='wh_stock_entry_items'")[0][0]
ok("明细 quantity 有 CHECK(quantity>0)", "CHECK(quantity>0)" in ddl2)

# ---- 建单 ----
with tenant_scope(1):
    ok("空明细建出库单 ⇒ 显式失败（不建出空单）",
       whdb.wh_outbound_create(CUST, 1, "", [])["success"] is False)
    ok("无效行（数量 0）建单 ⇒ 显式失败",
       whdb.wh_outbound_create(CUST, 1, "", [{"product_id": P1, "quantity": 0}])["success"] is False)

    r1 = whdb.wh_outbound_create(CUST, 1, "P1 影子验收", [{"product_id": P1, "quantity": 100}])
    ok("出库单建单成功", r1.get("success") is True, r1)
    ok("出库单单号前缀 CK", str(r1.get("order_no", "")).startswith("CK"), r1.get("order_no"))
    OID = r1["id"]

    r2 = whdb.wh_entry_create("in", 1, "盘盈", "P1", [
        {"product_id": P1, "quantity": 50, "batch_no": "B-P1", "expiry_date": "2026-12-31", "cost": 3.5}])
    ok("其它入库单建单成功", r2.get("success") is True, r2)
    ok("其它入库单号前缀 QTRK", str(r2.get("entry_no", "")).startswith("QTRK"), r2.get("entry_no"))
    EIN = r2["id"]

    r3 = whdb.wh_entry_create("out", 1, "领用", "P1", [{"product_id": P1, "quantity": 30}])
    ok("其它出库单建单成功", r3.get("success") is True, r3)
    ok("其它出库单号前缀 QTCK", str(r3.get("entry_no", "")).startswith("QTCK"), r3.get("entry_no"))
    EOUT = r3["id"]

    ok("direction 非法 ⇒ 显式失败", whdb.wh_entry_create("sideways", 1, "", "", [])["success"] is False)

    ok("新单状态 = draft", whdb.wh_outbound_get(OID)["status"] == "draft")
    ok("出库单详情带 items（1 行）", len(whdb.wh_outbound_get(OID)["items"]) == 1)
    ok("出库单详情带客户名", whdb.wh_outbound_get(OID).get("customer_name") not in (None, ""))
    ok("其它入库详情带原因候选（后端给）", whdb.wh_entry_get(EIN).get("reason_options") == whdb.wh_entry_reasons("in"))
    ok("其它出库原因候选与入库**不同**", whdb.wh_entry_reasons("out") != whdb.wh_entry_reasons("in"))

    s = whdb.wh_outbound_summary()
    ok("出库单汇总 draft=1", s["draft"] == 1, s)
    ss = whdb.wh_entry_summary("in")
    ok("其它入库汇总 draft=1", ss["draft"] == 1, ss)

# ============================================================ Phase 2 · 出库单过账（FEFO）
section("Phase 2 · 出库单过账 = FEFO 扣减（带「过期批不可售」守卫）")
before = stock(P1)
with tenant_scope(1):
    r = whdb.wh_outbound_issue(OID)
    ok("出库单过账成功", r.get("success") is True, r)
    ok("过账后状态 = issued", whdb.wh_outbound_get(OID)["status"] == "issued")
    ok("issued_at 已写入", bool(whdb.wh_outbound_get(OID)["issued_at"]))
after = stock(P1)
ok("库存精确减少 100", after == before - 100, f"{before} → {after}")
ok("inventory_logs 写入 change_type='wh_outbound'", logs(P1, "wh_outbound") == 1,
   logs(P1, "wh_outbound"))
ok("过账返回逐行 FEFO used 明细",
   bool(r.get("issued") and r["issued"][0].get("used")), r.get("issued"))

# ============================================================ Phase 3 · 其它出入库过账
section("Phase 3 · 其它出入库过账（入库=batch_in / 出库=自建 _gross_deduct，不过滤效期）")
before = stock(P1)
with tenant_scope(1):
    r = whdb.wh_entry_post(EIN)
    ok("其它入库过账成功", r.get("success") is True, r)
    ok("状态 = posted", whdb.wh_entry_get(EIN)["status"] == "posted")
after = stock(P1)
ok("入库后库存 +50", after == before + 50, f"{before} → {after}")
row = ro(TENANT, "SELECT quantity,batch_no,expiry_date FROM inventory WHERE product_id=? AND batch_no='B-P1'",
         (P1,))
ok("其它入库**落了批次号**", bool(row) and row[0][1] == "B-P1", row)
ok("其它入库**落了到期日**", bool(row) and row[0][2] == "2026-12-31", row)

before = stock(P1)
with tenant_scope(1):
    r = whdb.wh_entry_post(EOUT)
    ok("其它出库过账成功", r.get("success") is True, r)
after = stock(P1)
ok("出库后库存 -30", after == before - 30, f"{before} → {after}")
ok("inventory_logs 写入 change_type='wh_entry_out'", logs(P1, "wh_entry_out") == 1,
   logs(P1, "wh_entry_out"))

# ---- 其它入库「同批次累加」分支（已知欠账：batch_in 该分支不写流水）----
section("Phase 3b · 已知欠账取证：batch_in 同批次累加不写 inventory_logs")
with tenant_scope(1):
    r = whdb.wh_entry_create("in", 1, "归还", "同批次再入", [
        {"product_id": P1, "quantity": 5, "batch_no": "B-P1", "expiry_date": "2026-12-31", "cost": 3.5}])
    EIN2 = r["id"]
    n_before = logs(P1, "batch_in")
    q_before = stock(P1)
    whdb.wh_entry_post(EIN2)
    q_after = stock(P1)
    n_after = logs(P1, "batch_in")
ok("同批次二次入库：库存**确实** +5", q_after == q_before + 5, f"{q_before} → {q_after}")
ok("🔴 且 inventory_logs **没有**新增行（复现既有缺口，本模块不修只登记）",
   n_after == n_before, f"{n_before} → {n_after}")

# ============================================================ Phase 4 · 边界 / 相位反转
section("Phase 4 · 边界与状态机（含相位反转）")
with tenant_scope(1):
    r = whdb.wh_outbound_issue(OID)
    ok("相位反转①：重复过账被拒", r.get("success") is False, r)
    r = whdb.wh_outbound_cancel(OID)
    ok("相位反转②：已出库的单不可取消", r.get("success") is False, r)
    r = whdb.wh_entry_cancel(EIN)
    ok("相位反转③：已过账的调整单不可作废", r.get("success") is False, r)
    r = whdb.wh_entry_post(EIN)
    ok("相位反转④：重复过账被拒", r.get("success") is False, r)

# —— 库存不足 ⇒ **整单不落**（两行里一行够、一行不够）——
BIG = stock(P1) + 100000
with tenant_scope(1):
    r = whdb.wh_outbound_create(CUST, 1, "库存不足", [
        {"product_id": P1, "quantity": 1},
        {"product_id": P1, "quantity": BIG}])       # 第二行必然不足
    OID2 = r["id"]
    s_before = stock(P1)
    n_before = logs(P1, "wh_outbound")
    r = whdb.wh_outbound_issue(OID2)
    s_after = stock(P1)
    n_after = logs(P1, "wh_outbound")
ok("库存不足 ⇒ 过账**失败**且给出可读原因", r.get("success") is False and "库存不足" in str(r.get("error", "")), r)
ok("🔴 且**整单不落**：第一行也没被扣（库存分毫未动）", s_after == s_before, f"{s_before} → {s_after}")
ok("🔴 且**没有**多写一行流水", n_after == n_before, f"{n_before} → {n_after}")
with tenant_scope(1):
    ok("且单据仍是 draft（没被置成 issued）", whdb.wh_outbound_get(OID2)["status"] == "draft")

# —— 同一商品拆成多行：逐行看都够、合起来才超 ⇒ 必须由**聚合**校验拦住 ——
#    （这是 `_by_product()` 存在的理由；逐行校验会放过去，然后第二行才炸 ⇒ 半出库）
half = stock(P1) / 2.0 + 1          # 两行各 half ⇒ 单行 < 库存，合计 > 库存
with tenant_scope(1):
    r = whdb.wh_outbound_create(CUST, 1, "同商品多行", [
        {"product_id": P1, "quantity": half}, {"product_id": P1, "quantity": half}])
    OID3 = r["id"]
    s0 = stock(P1)
    n0 = logs(P1, "wh_outbound")
    r = whdb.wh_outbound_issue(OID3)
    s1 = stock(P1)
    n1 = logs(P1, "wh_outbound")
ok("🔴 同一商品拆多行、合计超库存 ⇒ 被**聚合校验**拦住（不会先扣一行再失败）",
   r.get("success") is False and "库存不足" in str(r.get("error", "")), r)
ok("🔴 且库存分毫未动", s1 == s0, f"{s0} → {s1}")
ok("🔴 且零新增流水", n1 == n0, f"{n0} → {n1}")

with tenant_scope(1):
    r = whdb.wh_outbound_cancel(OID2)
    ok("draft 单可正常取消", r.get("success") is True)
    ok("取消后状态 = cancelled", whdb.wh_outbound_get(OID2)["status"] == "cancelled")
    whdb.wh_outbound_cancel(OID3)

# ============================================================ Phase 5 · 判别力自证
section("Phase 5 · 判别力自证：过期库存上「两条路真的不同」")
# 造一个过期批次（影子库内，安全）：同商品、仓 2（不干扰上面的仓 1 断言）
EXP_PID = P1
with sqlite3.connect(TENANT) as c:
    c.execute("INSERT INTO inventory (product_id,warehouse_id,quantity,cost_price,batch_no,expiry_date) "
              "VALUES (?,2,77,2.0,'EXP-1','2020-01-01')", (EXP_PID,))
    c.commit()
ok("已造过期批次（仓 2，数量 77，到期 2020-01-01）",
   ro(TENANT, "SELECT quantity FROM inventory WHERE product_id=? AND warehouse_id=2 AND batch_no='EXP-1'",
      (EXP_PID,))[0][0] == 77)

with tenant_scope(1):
    f = fefo_deduct(EXP_PID, 2, 10, ref_type="probe")
ok("① fefo_deduct 对过期批**拒收**（可售 0）⇒ 销售出库不能出过期奶",
   bool(f.get("error")), f)

with tenant_scope(1):
    a = inventory_adjust(EXP_PID, 2, -10, ref_type="wh_entry_out", ref_id=0)
ok("② inventory_adjust 对同一批**放行**（报损能报掉过期品）",
   not (a and a.get("error")), a)
ok("③ 两者结论不同 ⇒ 「出库单 / 其它出库单 用不同原语」这个设计**被验证过**",
   bool(f.get("error")) and not (a and a.get("error")))

# —— ④ 复现「不显式 BEGIN 就会留下半出库」⇒ 证明 `_begin_write()` 不是防御性摆设 ——
#    🔴 复现要点：必须让 `SAVEPOINT` 成为该连接上的**第一条事务性语句**。
#       若之前已有过 INSERT/UPDATE（python sqlite3 会隐式 BEGIN），SAVEPOINT 就变成内层，
#       RELEASE 不再提交 ⇒ 现象消失。这正是这个坑最阴的地方：**是否踩到取决于执行顺序**。
#       所以对照组用一个**干净连接**、只做 SELECT。
section("Phase 5b · 判别力自证：干净连接上跑「没有 BEGIN」的对照，证明半出库真的会留下")
BEFORE = stock(P1)
_ctrl_conn = sqlite3.connect(TENANT)
_ctrl_conn.row_factory = sqlite3.Row
try:
    # 只做 SELECT（不触发隐式 BEGIN），然后让 fefo_deduct 自己 SAVEPOINT
    a1 = fefo_deduct(P1, 1, 1, ref_type="wh_outbound_probe", ref_id=0, db_conn=_ctrl_conn)
    ok("对照组①：第一行扣减成功", not a1.get("error"), a1)
    b1 = fefo_deduct(P1, 1, 1e9, ref_type="wh_outbound_probe", ref_id=0, db_conn=_ctrl_conn)
    ok("对照组②：第二行报库存不足", bool(b1.get("error")), b1)
    ok("对照组③：RELEASE 之后连接已不在事务中（in_transaction=False ⇒ 已被提交）",
       _ctrl_conn.in_transaction is False, _ctrl_conn.in_transaction)
    _ctrl_conn.rollback()          # 与 get_db().__exit__ 等价的一步
finally:
    _ctrl_conn.close()
AFTER = stock(P1)
ok("🔴 对照组④：库存**真的少了 1** ⇒ 「不显式开事务 ⇒ 失败也留半出库」是实测事实，"
   "`_begin_write()` 是必需的（不是防御性摆设）", AFTER == BEFORE - 1, f"{BEFORE} → {AFTER}")
with tenant_scope(1):
    # 复原对照组残留：用 inventory_adjust(+1) 而**不是**裸 UPDATE —— 后者
    # `WHERE product_id=? AND warehouse_id=?` 会命中**该商品在该仓的所有批次行**
    # （本商品此刻有两行：原始行 + Phase 3 建的 B-P1 行）⇒ 一次 +1 变 +2，越补越多。
    # inventory_adjust 取 fetchone() 拿到具体行 id 再按 id 更新 ⇒ 恰好多补 1。
    inventory_adjust(P1, 1, 1, ref_type="probe_restore")
ok("对照组残留已复原（恰好多补 1，不是 +N）", stock(P1) == BEFORE, f"{BEFORE} vs {stock(P1)}")

# ============================================================ Phase 6 · 路由表 / 映射表（静态）
section("Phase 6 · 路由表与权限映射（没有 HTTP 也要核）")
from routers.wh import router as wh_router                   # noqa: E402
routes = [(sorted(r.methods - {"HEAD", "OPTIONS"})[0], r.path) for r in wh_router.routes]
paths = [p for _, p in routes]
ok("路由前缀 = /api/wh", all(p.startswith("/api/wh") for p in paths), paths[:3])
# 🔴 静态段必须排在 {id} 之前，否则 'summary' 会被当 int 解析 ⇒ 422
def idx_of(p):
    return paths.index(p)
for static, dyn in (("/api/wh/outbound/summary", "/api/wh/outbound/{oid}"),
                    ("/api/wh/entries/reasons", "/api/wh/entries/{eid}"),
                    ("/api/wh/entries/summary", "/api/wh/entries/{eid}")):
    ok(f"顺序：{static} 排在 {dyn} 之前", idx_of(static) < idx_of(dyn),
       f"{idx_of(static)} vs {idx_of(dyn)}")
ok("出库单 6 条路由齐全",
   {("GET", "/api/wh/outbound"), ("POST", "/api/wh/outbound"),
    ("GET", "/api/wh/outbound/summary"), ("GET", "/api/wh/outbound/{oid}"),
    ("POST", "/api/wh/outbound/{oid}/issue"), ("DELETE", "/api/wh/outbound/{oid}")} <= set(routes),
   routes)
ok("其它出入库 7 条路由齐全",
   {("GET", "/api/wh/entries"), ("POST", "/api/wh/entries"),
    ("GET", "/api/wh/entries/reasons"), ("GET", "/api/wh/entries/summary"),
    ("GET", "/api/wh/entries/{eid}"), ("POST", "/api/wh/entries/{eid}/post"),
    ("DELETE", "/api/wh/entries/{eid}")} <= set(routes), routes)

# 映射表：两条新键必须在，且**首匹配解析到 stock**
import re
src = open(os.path.join(SERVER_DIR, "server.py"), encoding="utf-8").read()
i = src.index("_PATH_MODULE_MAP = {")
blk = src[i:src.index("\n}\n", i)]
keys = re.findall(r'"(/api/[^"]*)"\s*:\s*"([^"]+)"', blk)


def resolve(path):
    for k, mod in keys:              # 表序 = 匹配序（首匹配即停）
        if path.startswith(k):
            return mod
    return None


ok("映射表含 /api/inbound → stock", dict(keys).get("/api/inbound") == "stock")
ok("映射表含 /api/wh → stock", dict(keys).get("/api/wh") == "stock")
ok("/api/inbound/12 实解析到 stock", resolve("/api/inbound/12") == "stock", resolve("/api/inbound/12"))
ok("/api/wh/outbound 实解析到 stock", resolve("/api/wh/outbound") == "stock", resolve("/api/wh/outbound"))
ok("/api/wh/entries/1/post 实解析到 stock", resolve("/api/wh/entries/1/post") == "stock")
# 反例：两键不得吞掉既有键（嵌套前缀陷阱）
shadowed = [k for k, _ in keys if k in ("/api/inventory", "/api/webhooks", "/api/warehouses",
                                        "/api/wastage", "/api/invoices")
            and resolve(k) != dict(keys)[k]]
ok("🔴 反例：新前缀没吞掉任何既有键（/api/inventory /api/webhooks /api/warehouses 等）",
   shadowed == [], shadowed)
# 说明性反例：/api/webhooks 看着像 /api/wh 的嵌套，其实不是
ok("反例自证：'/api/webhooks'.startswith('/api/wh') 为 False（目测会误判，须实测）",
   not "/api/webhooks".startswith("/api/wh"))

# ============================================================ Phase 7 · _gross_deduct 原语
section("Phase 7 · 自建 _gross_deduct：过期优先 + 与 fefo 结论相反 + 原子守卫")


def stock_of_batch(pid, wid, batch_no):
    r = ro(TENANT, "SELECT COALESCE(SUM(quantity),0) FROM inventory "
                   "WHERE product_id=? AND warehouse_id=? AND batch_no=?", (pid, wid, batch_no))
    return float(r[0][0])


# 在仓 3 造「同商品两批次」（隔离，不干扰前面仓 1 / 仓 2 的断言）：
#   · GB-OK  未过期（2099-12-31）数量 5   —— **先插** ⇒ id 更小
#   · GB-EXP 已过期（2020-01-01）数量 30 —— 后插   ⇒ id 更大
# 故意让「id 小的那批未过期」⇒ 若实现错误地按 id 排序，就会先扣 GB-OK，断言立刻抓到。
W3 = 3
with sqlite3.connect(TENANT) as c:
    c.execute("INSERT INTO inventory (product_id,warehouse_id,quantity,cost_price,batch_no,expiry_date) "
              "VALUES (?,?,?,?,?,?)", (P1, W3, 5, 1.0, "GB-OK", "2099-12-31"))
    c.execute("INSERT INTO inventory (product_id,warehouse_id,quantity,cost_price,batch_no,expiry_date) "
              "VALUES (?,?,?,?,?,?)", (P1, W3, 30, 2.0, "GB-EXP", "2020-01-01"))
    c.commit()
ok("已造两批次：GB-OK(5, 未过期, id 更小) + GB-EXP(30, 已过期, id 更大)",
   stock(P1, W3) == 35, stock(P1, W3))


def gross(qty):
    """走 `_gross_deduct` 的真实调用姿势：先 `_begin_write`、成功才 commit。

    ⚠️ **必须自己套 `tenant_scope(1)`**：本函数在 `with tenant_scope(...)` 块**之外**调用，
       而 `tenant_scope` 退出时会**恢复上一个租户值**（块外=主库）⇒ 忘了套就会打到 `erp.db`
       上，现象是"刚插进去的库存看不见、一律可用 0"（本脚本第一版正是这么栽的）。
    """
    with tenant_scope(1):
        with get_db() as db:
            whdb._begin_write(db)
            r = whdb._gross_deduct(db, P1, W3, qty, ref_type="probe_gross", ref_id=0)
            if r.get("success"):
                db.commit()
            return r


r_gross = gross(20)
ok("_gross_deduct 扣 20 成功", r_gross.get("success") is True, r_gross)
ok("🔴 先扣**已过期**那批（GB-EXP）—— 排序按到期日，不是按 id",
   bool(r_gross.get("used")) and r_gross["used"][0]["batch_no"] == "GB-EXP"
   and float(r_gross["used"][0]["quantity"]) == 20, r_gross.get("used"))
ok("未过期批分毫未动（GB-OK 仍 5）", stock_of_batch(P1, W3, "GB-OK") == 5,
   stock_of_batch(P1, W3, "GB-OK"))
ok("过期批剩 10", stock_of_batch(P1, W3, "GB-EXP") == 10, stock_of_batch(P1, W3, "GB-EXP"))

# —— 判别力：同一批货，fefo_deduct 与 _gross_deduct 结论**必须相反** ——
with tenant_scope(1):
    f = fefo_deduct(P1, W3, 20, ref_type="probe_fefo")
ok("① fefo_deduct 要扣 20 ⇒ **拒**（可售只有 5，过期批不算可售）", bool(f.get("error")), f)
ok("② _gross_deduct 同一数量同一仓 ⇒ **放行**（它就是要扣过期品）", r_gross.get("success") is True)
ok("③ 两者结论相反 ⇒「出库单走 fefo / 其它出库与盘亏走 _gross_deduct」这条分界**被验证过**",
   bool(f.get("error")) and r_gross.get("success") is True)

# —— 原子守卫：不足时必须**零部分扣减** ——
#    ⚠️ 失败路径返回的是 `{'error': ...}` —— **没有 `success` 键**（与 `fefo_deduct` 同契约）。
#       所以判据是 `bool(r.get('error'))`，不能写 `r.get('success') is False`（那是 None，永远不等）。
n_after_ok = logs(P1, "probe_gross")
ok("成功那次写了 1 行流水（change_type=ref_type='probe_gross'）", n_after_ok == 1, n_after_ok)
b_ok0, b_exp0 = stock_of_batch(P1, W3, "GB-OK"), stock_of_batch(P1, W3, "GB-EXP")
r_short = gross(100000)
ok("库存不足 ⇒ 显式失败 + 可读原因",
   bool(r_short.get("error")) and "库存不足" in str(r_short.get("error")), r_short)
ok("🔴 且**零部分扣减**（两批数量都没变）",
   stock_of_batch(P1, W3, "GB-OK") == b_ok0 and stock_of_batch(P1, W3, "GB-EXP") == b_exp0,
   (stock_of_batch(P1, W3, "GB-OK"), stock_of_batch(P1, W3, "GB-EXP")))
r_zero = gross(0)
ok("数量 ≤ 0 ⇒ 拒绝（失败路径无 `success` 键，用 `error` 判）",
   bool(r_zero.get("error")), r_zero)
ok("🔴 两次被拒都**没写流水**（失败回滚是真回滚）",
   logs(P1, "probe_gross") == n_after_ok, f"{n_after_ok} → {logs(P1, 'probe_gross')}")
r_neg = gross(-5)
ok("负数取绝对值语义（`abs()`）⇒ 与传 5 同义：扣成功、且再写 1 行流水",
   r_neg.get("success") is True and logs(P1, "probe_gross") == n_after_ok + 1, r_neg)

# ============================================================ Phase 8 · _avg_cost
section("Phase 8 · _avg_cost：加权平均；无库存返 0（不编造成本）")
# 到此刻仓 3 的账面（Phase 7 后）：GB-OK 5@1.0 + GB-EXP 剩 5@2.0（30-20-5）
with tenant_scope(1):
    with get_db() as db:
        a = whdb._avg_cost(db, P1, W3)
ok("加权平均 = 两批剩余量×各自成本 的加权值（与手算一致）",
   abs(float(a) - 1.5) < 1e-6, a)
with tenant_scope(1):
    with get_db() as db:
        z = whdb._avg_cost(db, P1, 999)
ok("无库存的仓 ⇒ 返 0.0（不编造一个成本出来）", float(z) == 0.0, z)

# ============================================================ Phase 9 · 盘点引擎
section("Phase 9 · 盘点引擎（自建 wh_stock_take*）—— 相位反转 = 判别力")
names3 = [r[0] for r in ro(TENANT, "SELECT name FROM sqlite_master WHERE type='table'")]
ok("懒建表已创建 wh_stock_takes", "wh_stock_takes" in names3)
ok("懒建表已创建 wh_stock_take_items", "wh_stock_take_items" in names3)
idx3 = [r[0] for r in ro(TENANT, "SELECT name FROM sqlite_master WHERE type='index'")]
ok("唯一索引 idx_wsti_key 已建（(take_id,product_id,warehouse_id) 落库级约束）",
   "idx_wsti_key" in idx3, idx3[-6:])

with tenant_scope(1):
    s = whdb.wh_stocktake_start()
ok("开新一期成功", s.get("success") is True, s)
ok("期次号前缀 PD", str(s.get("take_no", "")).startswith("PD"), s.get("take_no"))
TID = s["id"]
n_groups = ro(TENANT, "SELECT COUNT(*) FROM (SELECT 1 FROM inventory GROUP BY product_id, warehouse_id)")[0][0]
ok("快照项数 = inventory 里的 (商品,仓库) 组合数", s.get("item_count") == n_groups,
   f"{s.get('item_count')} vs {n_groups}")

with tenant_scope(1):
    lst = whdb.wh_stocktake_list()
ok("期次列表含本期，且 counted=0 / diff_count=0",
   any(t["id"] == TID and t["counted"] == 0 and t["diff_count"] == 0 for t in lst), lst[:1])

with tenant_scope(1):
    r = whdb.wh_stocktake_finalize(TID)
ok("🔴 相位反转①：一行实盘数都没录就完成 ⇒ 被拒（不是静默成功）",
   r.get("success") is False and "实盘数" in str(r.get("error", "")), r)

# —— 录数：制造一个 5 的盘亏（仓 3） ——
sys3_before = stock(P1, W3)
with tenant_scope(1):
    r = whdb.wh_stocktake_update(TID, P1, W3, sys3_before - 5)
ok("录一行实盘数成功", r.get("success") is True, r)
with tenant_scope(1):
    g = whdb.wh_stocktake_get(TID)
row_p = [x for x in g["items"] if x["product_id"] == P1 and x["warehouse_id"] == W3]
ok("明细里该行 actual_qty 已写入", bool(row_p) and
   abs(float(row_p[0]["actual_qty"]) - (sys3_before - 5)) < 1e-6,
   row_p[0]["actual_qty"] if row_p else None)
ok("期次统计 counted=1", g["counted"] == 1, g["counted"])
ok("期次统计 diff_qty = -5（盘亏）", abs(float(g["diff_qty"]) + 5) < 1e-6, g["diff_qty"])
keys = [(x["product_id"], x["warehouse_id"]) for x in g["items"]]
ok("🔴 明细按 (商品,仓库) 唯一（不是 legacy 那样按商品把多仓/多批揉成一行）",
   len(keys) == len(set(keys)), len(keys) - len(set(keys)))

# —— UPSERT：给「账上还没有的货」补一行 ——
NEW_PID = int(ro(TENANT, "SELECT id FROM products WHERE id NOT IN "
                         "(SELECT DISTINCT product_id FROM inventory) ORDER BY id LIMIT 1")[0][0])
with tenant_scope(1):
    r = whdb.wh_stocktake_update(TID, NEW_PID, 1, 7)
ok("🔴 UPSERT：给账上没有的货补一行 ⇒ 成功（不必先去入库）", r.get("success") is True, r)
with tenant_scope(1):
    g2 = whdb.wh_stocktake_get(TID)
row_new = [x for x in g2["items"] if x["product_id"] == NEW_PID]
ok("补的那行 system_qty 现算 = 0", bool(row_new) and float(row_new[0]["system_qty"]) == 0.0,
   row_new[0]["system_qty"] if row_new else None)
ok("补的那行 actual_qty = 7", bool(row_new) and float(row_new[0]["actual_qty"]) == 7.0,
   row_new[0]["actual_qty"] if row_new else None)
ok("期次统计 counted=2", g2["counted"] == 2, g2["counted"])

# —— 入参校验 ——
with tenant_scope(1):
    ok("实盘数为负 ⇒ 拒", whdb.wh_stocktake_update(TID, P1, W3, -1)["success"] is False)
    ok("没选商品 ⇒ 拒", whdb.wh_stocktake_update(TID, 0, W3, 1)["success"] is False)
    ok("实盘数不是数字 ⇒ 拒", whdb.wh_stocktake_update(TID, P1, W3, "abc")["success"] is False)

# —— 完成盘点：差异真的落库 ——
s3 = stock(P1, W3)
n_loss_b = logs(P1, "wh_stocktake_loss")
n_bin_b = logs(NEW_PID, "batch_in")
with tenant_scope(1):
    r = whdb.wh_stocktake_finalize(TID)
ok("完成盘点成功", r.get("success") is True, r)
ok("adjusted = 2（一亏一盈）", r.get("adjusted") == 2, r)
ok("loss = 5", abs(float(r.get("loss", 0)) - 5) < 1e-6, r)
ok("gain = 7", abs(float(r.get("gain", 0)) - 7) < 1e-6, r)
ok("🔴 盘亏落到库存（仓 3 减少 5）", abs(stock(P1, W3) - (s3 - 5)) < 1e-6,
   f"{s3} → {stock(P1, W3)}")
ok("🔴 盘亏记在 inventory_logs.change_type='wh_stocktake_loss'",
   logs(P1, "wh_stocktake_loss") == n_loss_b + 1, logs(P1, "wh_stocktake_loss"))
ok("🔴 盘盈落到库存（新商品 = 7）", abs(stock(NEW_PID, 1) - 7) < 1e-6, stock(NEW_PID, 1))
ok("🔴 已知不对称取证：盘盈在流水里**只记 batch_in**（`batch_in` 硬编码 change_type、"
   "不透传 ref_type/ref_id）⇒ 审计时盘盈无法从 inventory_logs 单独识别",
   logs(NEW_PID, "batch_in") == n_bin_b + 1, logs(NEW_PID, "batch_in"))
ok("且确实**没有** wh_stocktake_gain 这种流水（与上一条同源，钉住现状）",
   logs(NEW_PID, "wh_stocktake_gain") == 0, logs(NEW_PID, "wh_stocktake_gain"))
row_gain = ro(TENANT, "SELECT batch_no, expiry_date FROM inventory "
                      "WHERE product_id=? AND warehouse_id=1", (NEW_PID,))
ok("🔴 盘盈**不编造批次号**", bool(row_gain) and (row_gain[0][0] or "") == "", row_gain)
ok("🔴 盘盈**不编造效期**", bool(row_gain) and (row_gain[0][1] or "") == "", row_gain)
with tenant_scope(1):
    st = whdb.wh_stocktake_get(TID)["status"]
ok("期次状态 = completed", st == "completed", st)

# —— 相位反转（完成后不可逆） ——
with tenant_scope(1):
    r = whdb.wh_stocktake_finalize(TID)
ok("🔴 相位反转②：完成后再完成 ⇒ 被拒", r.get("success") is False and "不能重复" in str(r.get("error", "")), r)
with tenant_scope(1):
    r = whdb.wh_stocktake_update(TID, P1, W3, 1)
ok("🔴 相位反转③：已完成的期次再录数 ⇒ 被拒", r.get("success") is False and "已完成" in str(r.get("error", "")), r)
ok("🔴 且库存**没被这次被拒的录数改动**（拒绝是真拒绝，不是「先写后拒」）",
   abs(stock(P1, W3) - (s3 - 5)) < 1e-6, f"{s3 - 5} vs {stock(P1, W3)}")
with tenant_scope(1):
    ok("不存在的期次 ⇒ 详情返 None", whdb.wh_stocktake_get(999999) is None)
    ok("不存在的期次 ⇒ 完成被拒", whdb.wh_stocktake_finalize(999999)["success"] is False)

# ============================================================ 汇总
section("汇总")
print(f"  PASS {len(PASS)} / FAIL {len(FAIL)}")
if FAIL:
    print("  失败项：")
    for f in FAIL:
        print(f"    ❌ {f}")
    sys.exit(1)
print("  ✅ ALL PASS")
