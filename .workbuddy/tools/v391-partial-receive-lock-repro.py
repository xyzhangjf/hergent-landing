"""最小复现：`purchase_order_partial_receive` 是否**内在**必然 database is locked？

排除「验收脚本自己占着连接」的可能：本脚本是**独立进程**，只做三件事
  1) 建影子副本（生产快照）
  2) 直接建一张采购单（不经任何被我测的端点）
  3) 单独调用 `db.queries.purchases.purchase_order_partial_receive`
若仍报 locked ⇒ 缺陷在**该函数内部**（它调 `inventory_adjust` 时没传 `db_conn`，
而 `inventory_adjust` 会自开第二条连接去写 —— SQLite 单写者 ⇒ 必然锁冲突）。

对照（同族已修好的写法）：`purchase_order_confirm` 调 `batch_in(..., db_conn=db)`
**显式复用外层连接**，所以它不锁。本脚本把这一对照也跑出来。
"""
import os
import shutil
import sqlite3
import sys
import tempfile

SNAP = sys.argv[1]
SRV = os.path.expanduser("~/Documents/hergent-erp/server")

shadow = tempfile.mkdtemp(prefix="v391-lock-")
for f in ("erp.db", "tenant_1.db"):
    shutil.copy2(os.path.join(SNAP, f), os.path.join(shadow, f))

os.environ["ERP_SECRET"] = "shadow-only-not-a-secret"
os.environ["ERP_DB_PATH"] = os.path.join(shadow, "erp.db")
sys.path.insert(0, SRV)

import db.connection as conn
conn.DB_DIR = shadow
conn.set_tenant_context(1)

import erp_db as db
from db.queries.purchases import purchase_order_partial_receive
from db.queries.inventory import inventory_adjust

with conn.get_db() as d:
    sup = d.execute("SELECT id FROM contacts WHERE type='supplier' ORDER BY id LIMIT 1").fetchone()[0]
    prod = d.execute("SELECT id FROM products WHERE is_active=1 ORDER BY id LIMIT 1").fetchone()[0]
    wh = d.execute("SELECT id FROM warehouses ORDER BY id LIMIT 1").fetchone()[0]

print(f"shadow={shadow}\nsupplier={sup} product={prod} warehouse={wh}")

# ① 先验证一个**已修好的同族**写法能不能过（对照）：inventory_adjust 在无外层事务时应成功
try:
    inventory_adjust(prod, wh, 1, 1.0, "probe", 0)
    print("① 对照：inventory_adjust 单独调用（无外层事务）        -> OK")
except Exception as e:
    print(f"① 对照：inventory_adjust 单独调用（无外层事务）        -> {type(e).__name__}: {e}")

# ② 建一张 draft 采购单（用既有函数）
r = db.purchase_order_create(sup, [{"product_id": prod, "quantity": 3, "unit_price": 1}], wh,
                            "v391 lock probe", "1")
oid = r["order_id"]
print(f"② 采购单已建 id={oid} status 应为 draft/pending_approval")

# ③ 关键复现：单独调 partial_receive（此刻没有任何别人占连接）
try:
    out = purchase_order_partial_receive(oid, [{"product_id": prod, "quantity": 1}])
    print(f"③ purchase_order_partial_receive(oid={oid})  -> {out}")
except Exception as e:
    print(f"③ purchase_order_partial_receive(oid={oid})  -> ❌ {type(e).__name__}: {e}")

# ④ 对照：同族的 confirm 走共享连接，应当成功
r2 = db.purchase_order_create(sup, [{"product_id": prod, "quantity": 1, "unit_price": 1}], wh,
                             "v391 lock probe 2", "1")
try:
    out2 = db.purchase_order_confirm(r2["order_id"])
    print(f"④ 对照 purchase_order_confirm(oid={r2['order_id']}) -> {out2}")
except Exception as e:
    print(f"④ 对照 purchase_order_confirm(oid={r2['order_id']}) -> ❌ {type(e).__name__}: {e}")

# ⑤ 结论数据：把 inventory_adjust 的签名与 partial_receive 的调用点摆出来
import inspect
print("\n⑤ inventory_adjust 签名:", str(inspect.signature(inventory_adjust)))
src = inspect.getsource(purchase_order_partial_receive)
line = [l.strip() for l in src.splitlines() if "inventory_adjust(" in l]
print("   partial_receive 内的调用（注意没有 db_conn=）:", line)
src2 = inspect.getsource(db.purchase_order_confirm)
line2 = [l.strip() for l in src2.splitlines() if "batch_in(" in l]
print("   对照 confirm 内的调用（注意有 db_conn=db）  :", line2)

shutil.rmtree(shadow, ignore_errors=True)
