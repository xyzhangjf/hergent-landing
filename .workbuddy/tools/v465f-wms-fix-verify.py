#!/usr/bin/env python
"""v465f 验收 —— 两个 WMS 既有缺陷的修复（**纯代码对齐，不动任何库**）。

跑法：
    SRC=/tmp/v465f-shadow-src \
    /Users/zhangjunfeng/.workbuddy/binaries/python/envs/default/bin/python \
        .workbuddy/tools/v465f-wms-fix-verify.py

────────────────────────── 缺陷与修复 ──────────────────────────
① `GET /api/wms/replenishment/needed` 恒 500 `no such column: pfc.pick_face_qty`
   （前端「补货需求」面板永远显示「读取失败」，且英文错误串漏到界面）
   根因：`erp_db.py` 的 DDL 与两条 SQL 写的是 `pick_face_qty/min_qty/max_qty/location_code`，
        而生产库（三个库全部）实际列是 `forward_min/forward_max/reserve_bin`；
        DDL 又是 `CREATE TABLE IF NOT EXISTS` ⇒ 对既存库**从不补列**，
        于是「写新列名、建旧列名」永久错位。
   修：DDL 对齐真实结构（`product_id UNIQUE` + 三新列）；查询/保存改按真实列名；
       返回字段名**仍保持** `pick_face_qty`/`min_qty`/`max_qty`（前端契约）⇒ 前端零改动。

② `GET /api/wms/cross-dock` 返回 200 但两条 SQL 静默失败 ⇒ 越库机会恒 0 条
   根因（三处叠加）：(a) 列名 `poi.purchase_order_id` / `soi.sale_order_id` 实为 `order_id`；
        (b) 状态词 `po.status='confirmed'` 生产库不存在（真实只有 draft/received/cancelled），
            本系统「在途采购量」既有口径 = `draft/confirmed/pending_approval`；
        (c) `INNER JOIN contacts` 在 supplier_id 缺失（0/已删）时**整行丢弃**。
   修：(a)(b) 对齐；`contacts` 改 LEFT JOIN；补 `product_name` 供前端显示。

────────────────────── 判别力（本脚本的核心） ──────────────────────
只证明「修完有数据」不够。必须证明：
  · 旧 SQL 在**真实生产快照**上确实报错（不是我以为它错）——Phase 0；
  · 只把状态词改回旧值、数据不动，结果**又会变 0** —— 证明状态口径那条真的在起作用（Phase 0/3）；
  · 补货需求在**补足拣货位现存量**后该行**消失** —— 证明比较是活的，不是恒真（Phase 2）；
  · 越库匹配数在删掉待发销售单后**回落到 0** —— 证明非零不是常数（Phase 5）。
"""
import os
import shutil
import sqlite3
import sys

SRC = os.environ.get("SRC", "/tmp/v465f-shadow-src")
WORK = os.environ.get("WORK", "/tmp/v465f-shadow")
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


def try_sql(path, sql, args=()):
    """返回 ('ok', rows) 或 ('err', 异常串)。"""
    c = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        return "ok", c.execute(sql, args).fetchall()
    except Exception as e:
        return "err", f"{type(e).__name__}: {e}"
    finally:
        c.close()


TENANT = os.path.join(WORK, "tenant_1.db")
SNAP_TENANT = os.path.join(SRC, "tenant_1.db")

# ── 旧 SQL 原文（逐字取自 `git show HEAD:server/erp_db.py` @ b3667c9，未改一字）──
OLD_PICK_FACE = ("SELECT pfc.*, p.name as product_name FROM pick_face_config pfc "
                 "LEFT JOIN products p ON pfc.product_id=p.id "
                 "WHERE pfc.warehouse_id=? AND pfc.pick_face_qty < pfc.min_qty")
OLD_INBOUND = ("SELECT poi.*, po.order_date, po.order_no, c.name as supplier_name "
               "FROM purchase_order_items poi "
               "JOIN purchase_orders po ON poi.purchase_order_id=po.id "
               "JOIN contacts c ON po.supplier_id=c.id "
               "WHERE po.status='confirmed' ORDER BY po.order_date LIMIT 50")
OLD_OUTBOUND = ("SELECT soi.*, so.order_date, so.order_no, ct.name as customer_name "
                "FROM sale_order_items soi "
                "JOIN sale_orders so ON soi.sale_order_id=so.id "
                "JOIN contacts ct ON so.customer_id=ct.id "
                "WHERE so.status IN ('draft','confirmed') ORDER BY so.order_date LIMIT 100")

# 新 SQL（与改动后 erp_db.py 内联串等价）
NEW_INBOUND_DOCKSQL = (
    "SELECT poi.*, p.name as product_name, po.order_date, po.order_no, c.name as supplier_name "
    "FROM purchase_order_items poi JOIN purchase_orders po ON poi.order_id=po.id "
    "LEFT JOIN products p ON poi.product_id=p.id LEFT JOIN contacts c ON po.supplier_id=c.id "
    "WHERE po.status IN ('draft','confirmed','pending_approval') ORDER BY po.order_date LIMIT 50")
NEW_OUTBOUND_DOCKSQL = (
    "SELECT soi.*, p.name as product_name, so.order_date, so.order_no, ct.name as customer_name "
    "FROM sale_order_items soi JOIN sale_orders so ON soi.order_id=so.id "
    "LEFT JOIN products p ON soi.product_id=p.id LEFT JOIN contacts ct ON so.customer_id=ct.id "
    "WHERE so.status IN ('draft','confirmed') ORDER BY so.order_date LIMIT 100")


# ══════════════════════════════ Phase 0 · 基线（不 import 应用）
section("Phase 0 · 基线：在**真实生产快照**上对旧 SQL 定罪（不 import 应用）")
if not os.path.isdir(SRC):
    print(f"❌ 快照目录不存在：{SRC}")
    sys.exit(2)

ok("基线：pick_face_config 真实列 = forward_min/forward_max/reserve_bin",
   [r[1] for r in ro(SNAP_TENANT, "PRAGMA table_info(pick_face_config)")] ==
   ["id", "product_id", "warehouse_id", "forward_min", "forward_max", "reserve_bin"],
   [r[1] for r in ro(SNAP_TENANT, "PRAGMA table_info(pick_face_config)")])
ok("基线：**没有** pick_face_qty / min_qty / max_qty / location_code 列",
   try_sql(SNAP_TENANT, "SELECT pick_face_qty FROM pick_face_config")[0] == "err")
ok("基线：purchase_order_items 有 order_id、**没有** purchase_order_id",
   "order_id" in [r[1] for r in ro(SNAP_TENANT, "PRAGMA table_info(purchase_order_items)")] and
   try_sql(SNAP_TENANT, "SELECT purchase_order_id FROM purchase_order_items")[0] == "err")
ok("基线：sale_order_items 有 order_id、**没有** sale_order_id",
   "order_id" in [r[1] for r in ro(SNAP_TENANT, "PRAGMA table_info(sale_order_items)")] and
   try_sql(SNAP_TENANT, "SELECT sale_order_id FROM sale_order_items")[0] == "err")

st, err = try_sql(SNAP_TENANT, OLD_PICK_FACE, (1,))
ok("① 旧补货 SQL 在真实快照上报错（= 生产 500 的实证）", st == "err", err)
print(f"      旧填充 SQL 报错原文：{err}")

st, err = try_sql(SNAP_TENANT, OLD_INBOUND)
ok("② 旧越库-进货 SQL 在真实快照上报错（= 静默空表的实证）", st == "err", err)
print(f"      旧进货 SQL 报错原文：{err}")
st, err = try_sql(SNAP_TENANT, OLD_OUTBOUND)
ok("② 旧越库-发货 SQL 在真实快照上报错", st == "err", err)
print(f"      旧发货 SQL 报错原文：{err}")

# 修复后的进货 SQL：状态口径不同的**同一份数据**下，结果不同（证明 (b) 真在起作用）
st_new, rows_new = try_sql(SNAP_TENANT, NEW_INBOUND_DOCKSQL)
ok("新进货 SQL 在真实快照上不再报错", st_new == "ok", rows_new if st_new == "err" else None)
ok("新进货 SQL 命中 2 行（tenant 1 的两张 draft 采购单，含 supplier_id=0 的那张）",
   len(rows_new) == 2, len(rows_new))
st_pn, rows_pn = try_sql(
    SNAP_TENANT,
    "SELECT p.name FROM purchase_order_items poi JOIN purchase_orders po ON poi.order_id=po.id "
    "LEFT JOIN products p ON poi.product_id=p.id "
    "WHERE po.status IN ('draft','confirmed','pending_approval')")
ok("新进货 SQL 保留全部 2 行（products 缺 id=1 也不丢行 ⇒ LEFT JOIN 生效）",
   st_pn == "ok" and len(rows_pn) == 2, rows_pn)
ok("注：tenant 1 `products` 表**无 id=1**（最早 id=1160）⇒ 上面 product_name=NULL 是如实，非连接写错",
   ro(SNAP_TENANT, "SELECT COUNT(*) FROM products WHERE id=1")[0][0] == 0)
st_oldstatus, rows_oldstatus = try_sql(
    SNAP_TENANT, NEW_INBOUND_DOCKSQL.replace("po.status IN ('draft','confirmed','pending_approval')",
                                             "po.status='confirmed'"))
ok("判别力：**只把状态词改回旧值**、数据不动 ⇒ 结果变 0（证明状态口径是必要条件）",
   st_oldstatus == "ok" and len(rows_oldstatus) == 0, len(rows_oldstatus))
st_inner, rows_inner = try_sql(
    SNAP_TENANT, NEW_INBOUND_DOCKSQL.replace("LEFT JOIN contacts c", "JOIN contacts c"))
ok("判别力：**只把 contacts 改回 INNER JOIN** ⇒ 2 行全丢（证明 LEFT JOIN 是必要条件）",
   st_inner == "ok" and len(rows_inner) == 0, len(rows_inner))

ok("新发货 SQL 在真实快照上不再报错、且 0 行（tenant 1 无 draft/confirmed 销售单）",
   try_sql(SNAP_TENANT, NEW_OUTBOUND_DOCKSQL)[0] == "ok" and
   len(try_sql(SNAP_TENANT, NEW_OUTBOUND_DOCKSQL)[1]) == 0)

# ══════════════════════════════ 起影子库 + import 应用
shutil.rmtree(WORK, ignore_errors=True)
os.makedirs(WORK)
for f in ("erp.db", "tenant_1.db"):
    shutil.copy2(os.path.join(SRC, f), os.path.join(WORK, f))

os.environ["ERP_DB_PATH"] = os.path.join(WORK, "erp.db")
os.environ["DISABLE_AI"] = "1"
os.environ.setdefault("ERP_SECRET", "shadow-verify-" + "0" * 48)
sys.path.insert(0, SERVER_DIR)
import erp_db as db                                   # noqa: E402
from db.connection import tenant_scope                # noqa: E402


def wx(sql, args=(), commit=False):
    c = sqlite3.connect(TENANT)
    try:
        cur = c.execute(sql, args)
        if commit:
            c.commit()
        return cur.fetchall()
    finally:
        c.close()


# ══════════════════════════════ Phase 1 · 缺陷① 不再 500
section("Phase 1 · 缺陷① 修复：wms_pick_face_needs 不再抛错")
with tenant_scope(1):
    try:
        needs = db.wms_pick_face_needs(1)
        ok("wms_pick_face_needs(1) 正常返回（不再 no such column）", isinstance(needs, list), needs)
    except Exception as e:
        ok("wms_pick_face_needs(1) 正常返回（不再 no such column）", False, f"{type(e).__name__}: {e}")
        needs = []
ok("调用后 bin_occupancy 存在（_init_wms_depth_tables 前置生效）",
   "bin_occupancy" in [r[0] for r in ro(TENANT, "SELECT name FROM sqlite_master WHERE type='table'")])
ok("生产快照里 pick_face_config 本来就是 0 行 ⇒ 面板应为**真空态**（不是错误态）",
   ro(TENANT, "SELECT COUNT(*) FROM pick_face_config")[0][0] == 0)

# ══════════════════════════════ Phase 2 · 缺陷① 语义（min/max 映射 + 存量比较是活的）
section("Phase 2 · 缺陷① 语义：保存 + 上下限映射 + 拣货位存量比较")
PID = int(ro(TENANT, "SELECT id FROM products ORDER BY id LIMIT 1")[0][0])
with tenant_scope(1):
    r = db.wms_pick_face_config_save(PID, 10, 50, 1, "R-01-01")
    ok("保存上下限成功（forward_min/max/bins 落库）", r.get("success") is True, r)
ok("pick_face_config 落 1 行", ro(TENANT, "SELECT COUNT(*) FROM pick_face_config")[0][0] == 1)
row = ro(TENANT, "SELECT product_id,warehouse_id,forward_min,forward_max,reserve_bin FROM pick_face_config")[0]
ok("落库值逐字正确 (10,50,'R-01-01')",
   (row[0], row[1], row[2], row[3], row[4]) == (PID, 1, 10.0, 50.0, "R-01-01"), row)

with tenant_scope(1):
    needs = db.wms_pick_face_needs(1)
ok("现存量 0 < 下限 10 ⇒ 出现在补货需求里", len(needs) == 1, needs)
if needs:
    n = needs[0]
    ok("返回字段名保持前端契约（pick_face_qty / min_qty / max_qty）",
       {"pick_face_qty", "min_qty", "max_qty"} <= set(n.keys()), sorted(n.keys()))
    ok("min_qty 映射自 forward_min = 10", n["min_qty"] == 10, n.get("min_qty"))
    ok("max_qty 映射自 forward_max = 50", n["max_qty"] == 50, n.get("max_qty"))
    ok("pick_face_qty = 0（无拣货位占用）", n["pick_face_qty"] == 0, n.get("pick_face_qty"))
    ok("product_name 非空（JOIN products 生效）", bool(n.get("product_name")), n.get("product_name"))
    ok("reserve_bin 透传 = 'R-01-01'", n.get("reserve_bin") == "R-01-01", n.get("reserve_bin"))

# UPSERT：再存一次不产生第二行、且值被更新
with tenant_scope(1):
    db.wms_pick_face_config_save(PID, 20, 60, 1, "R-02-02")
ok("同 product_id 二次保存 ⇒ 仍 1 行（UPSERT 而非新增）",
   ro(TENANT, "SELECT COUNT(*) FROM pick_face_config")[0][0] == 1)
ok("UPSERT 更新了值（forward_min 10 → 20）",
   ro(TENANT, "SELECT forward_min FROM pick_face_config")[0][0] == 20.0)

# 判别力：补足拣货位现存量 ≥ 下限 ⇒ 该行**消失**（证明比较是活的）
wx("INSERT INTO bin_locations (warehouse_id,code,zone,description,is_active) "
   "VALUES (1,'PF-V465F','pick_face','v465f 验收',1)", commit=True)
BID = int(ro(TENANT, "SELECT id FROM bin_locations WHERE code='PF-V465F'")[0][0])
wx("INSERT INTO bin_occupancy (bin_id,product_id,quantity) VALUES (?,?,?)", (BID, PID, 999), commit=True)
with tenant_scope(1):
    needs2 = db.wms_pick_face_needs(1)
ok("判别力：拣货位现存量 999 ≥ 下限 20 ⇒ 该商品**移出**补货需求",
   len(needs2) == 0, needs2)
wx("UPDATE bin_occupancy SET quantity=? WHERE bin_id=? AND product_id=?", (5, BID, PID), commit=True)
with tenant_scope(1):
    needs3 = db.wms_pick_face_needs(1)
ok("现存量降到 5 < 20 ⇒ 又回到补货需求（比较随数据联动）", len(needs3) == 1, needs3)
ok("此时 pick_face_qty 读数 = 5（不是恒 0）", needs3 and needs3[0]["pick_face_qty"] == 5, needs3)

# ══════════════════════════════ Phase 3 · 缺陷② 在真实数据上不再静默
section("Phase 3 · 缺陷② 修复：cross_dock 在**真实生产数据**上如实返回")
with tenant_scope(1):
    r = db.cross_dock_opportunities(1)
ok("cross_dock 返回 dict（未吞异常）", isinstance(r, dict), type(r))
ok("inbound_items = 2（两张 draft 采购单，此前恒 0）", r.get("inbound_items") == 2, r.get("inbound_items"))
ok("outbound_items = 0（tenant 1 无 draft/confirmed 销售单，如实为 0）",
   r.get("outbound_items") == 0, r.get("outbound_items"))
ok("cross_dock_opportunities = 0（**如实空**而非静默失败）",
   r.get("cross_dock_opportunities") == 0, r.get("cross_dock_opportunities"))

# ══════════════════════════════ Phase 4 · 匹配逻辑真的会产出机会
section("Phase 4 · 匹配逻辑：造一张「待发销售单」⇒ 必须产出越库机会")
CUST = int(ro(TENANT, "SELECT id FROM contacts WHERE id<>0 ORDER BY id LIMIT 1")[0][0])
wx("INSERT INTO sale_orders (order_no,customer_id,warehouse_id,total_amount,status,order_date) "
   "VALUES ('SO-V465F-TEST',?,1,9.9,'draft',date('now','localtime'))", (CUST,), commit=True)
SOID = int(ro(TENANT, "SELECT id FROM sale_orders WHERE order_no='SO-V465F-TEST'")[0][0])
wx("INSERT INTO sale_order_items (order_id,product_id,quantity,unit_price,amount) VALUES (?,?,?,?,?)",
   (SOID, 1, 7, 1.0, 7.0), commit=True)
with tenant_scope(1):
    r2 = db.cross_dock_opportunities(1)
ok("待发销售单出现 ⇒ outbound_items = 1", r2.get("outbound_items") == 1, r2.get("outbound_items"))
ok("同商品(1) 在进货与待发两侧 ⇒ 产出 2 条越库机会（进货侧本就 2 行明细）",
   r2.get("cross_dock_opportunities") == 2, r2.get("cross_dock_opportunities"))
ops = r2.get("opportunities") or []
op = ops[0] if ops else {}
ok("机会含 match_qty 且 = min(进货 2, 待发 7) = 2", op.get("match_qty") == 2, op.get("match_qty"))
ok("机会含 inbound_po（单号非空）", bool(op.get("inbound_po")), op.get("inbound_po"))
ok("机会含 outbound_so = 'SO-V465F-TEST'", op.get("outbound_so") == "SO-V465F-TEST", op.get("outbound_so"))
ok("机会含 outbound_customer（客户名非空）", bool(op.get("outbound_customer")), op.get("outbound_customer"))
ok("机会的 product_id = 1", op.get("product_id") == 1, op.get("product_id"))

# ══════════════════════════════ Phase 5 · 相位反转（非零不是常数）
section("Phase 5 · 相位反转：删掉待发销售单 ⇒ 机会数**回落**到 0")
wx("DELETE FROM sale_order_items WHERE order_id=?", (SOID,), commit=True)
wx("DELETE FROM sale_orders WHERE id=?", (SOID,), commit=True)
with tenant_scope(1):
    r3 = db.cross_dock_opportunities(1)
ok("相位反转：无待发单 ⇒ opportunities 回落到 0（证明上一相不是常数）",
   r3.get("cross_dock_opportunities") == 0, r3.get("cross_dock_opportunities"))
ok("相位反转：inbound_items 仍是 2（只有发货侧变，进货侧不受影响）",
   r3.get("inbound_items") == 2, r3.get("inbound_items"))

# ══════════════════════════════ 汇总
print(f"\n{'═' * 72}")
print(f"  汇总：PASS {len(PASS)} / FAIL {len(FAIL)}")
if FAIL:
    print("  失败项：")
    for f in FAIL:
        print(f"    ❌ {f}")
else:
    print("  ✅ ALL PASS")
print(f"{'═' * 72}")
sys.exit(1 if FAIL else 0)
