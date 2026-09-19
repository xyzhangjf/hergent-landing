# -*- coding: utf-8 -*-
"""v197 生产只读盘点：蒙牛归并 + 3 组重复建档退休 的写入前状态锁定。

只读（file:...?mode=ro）。用途：在任何写操作之前，把"我准备改的那几行现在到底是什么样"
逐列打出来并断言，避免拿本会话早先的快照去改已经变过的数据。
"""
import sqlite3, sys

DB = "/opt/hergent-erp/tenant_1.db"
TARGET_BRAND = "蒙牛低温"
MERGE_FROM = "蒙牛"
PAIRS = {
    "pair1": (1199, 1438),
    "pair2": (1198, 1439),
    "pair3": (1219, 1451),
}
RETIRE = [1199, 1198, 1219]      # 拟退休（停用 + 清条码）
KEEP = [1438, 1439, 1451]

con = sqlite3.connect("file:%s?mode=ro" % DB, uri=True)
con.row_factory = sqlite3.Row
q = lambda s, p=(): [dict(r) for r in con.execute(s, p).fetchall()]
one = lambda s, p=(): (lambda r: dict(r) if r else None)(con.execute(s, p).fetchone())

print("=" * 78)
print("Q1  brand='%s' 的行（含停用）" % MERGE_FROM)
print("=" * 78)
rows = q("SELECT id,name,spec,barcode,brand,is_active,product_code,factory_price,updated_at "
         "FROM products WHERE brand=? ORDER BY id", (MERGE_FROM,))
for r in rows:
    print("  ", r)
print("  计数 =", len(rows))
print("  [断言] 只有 1 行:", len(rows) == 1)

if rows:
    nm = rows[0]["name"]
    dup = q("SELECT id,name,brand,is_active FROM products WHERE brand=? AND name=?", (TARGET_BRAND, nm))
    print("  [断言] 「%s」内无同名行:" % TARGET_BRAND, len(dup) == 0, "| 同名行数 =", len(dup))
    ex = q("SELECT id,name FROM brands WHERE name=?", (TARGET_BRAND,))
    print("  [断言] brands 表已有「%s」:" % TARGET_BRAND, len(ex) == 1, "|", ex)

print()
print("=" * 78)
print("Q2  3 组重复建档：逐列全字段")
print("=" * 78)
COLS = ["id", "name", "spec", "barcode", "brand", "is_active", "product_code",
        "factory_price", "purchase_price", "dist_price", "sale_price", "unit",
        "zhoupu_seq", "category", "safety_stock", "expiry_days", "arrival_lead_days",
        "source", "created_at", "updated_at"]
for tag, (lo, hi) in PAIRS.items():
    print("-- %s  低id=%d  高id=%d  (拟退休 %d)" % (tag, lo, hi, lo))
    for pid in (lo, hi):
        r = one("SELECT * FROM products WHERE id=?", (pid,))
        if not r:
            print("    id=%s  不存在！" % pid)
            continue
        print("    id=%-5s %s" % (pid, {k: r.get(k) for k in COLS}))
    a = one("SELECT barcode,name,spec FROM products WHERE id=?", (lo,))
    b = one("SELECT barcode,name,spec FROM products WHERE id=?", (hi,))
    if a and b:
        same = (a["barcode"] == b["barcode"] and a["name"] == b["name"] and a["spec"] == b["spec"])
        print("    [断言] 同条码+同名+同规格（确认是重复建档）:", same)
    print()

print("=" * 78)
print("Q3  运行时内省：每张含 product_id 列的表，对 6 个 id 的引用数")
print("=" * 78)
tabs = [r["name"] for r in q(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
watch = {1199: 0, 1438: 0, 1198: 0, 1439: 0, 1219: 0, 1451: 0}
detail = {k: [] for k in watch}
for t in tabs:
    cols = [c["name"] for c in q("PRAGMA table_info(%s)" % t)]
    if "product_id" not in cols:
        continue
    for pid in watch:
        n = con.execute("SELECT COUNT(*) FROM %s WHERE product_id=?" % t, (pid,)).fetchone()[0]
        if n:
            watch[pid] += n
            detail[pid].append("%s=%d" % (t, n))
for tag, (lo, hi) in PAIRS.items():
    print("  %s:  id=%d 引用=%d %s" % (tag, lo, watch[lo], detail[lo]))
    print("       id=%d 引用=%d %s" % (hi, watch[hi], detail[hi]))
print("  [断言] pair1/2 的低 id 仅 FTS 自引用（<=1 且表名含 fts）:",
      all(watch[x] <= 1 and all("fts" in s.split("=")[0].lower() for s in detail[x])
          for x in (1199, 1198)))

print()
print("=" * 78)
print("Q4  pair3：要把 1219 的标量搬到 1451 的两个字段，先看两边现值")
print("=" * 78)
n19 = one("SELECT product_code,factory_price FROM products WHERE id=1219")
n51 = one("SELECT product_code,factory_price FROM products WHERE id=1451")
print("  1219(退休):", n19)
print("  1451(保留):", n51)
print("  [断言] 1451.factory_price 为 0（可直接搬）:", n51 and (n51["factory_price"] or 0) == 0)
print("  [断言] 两边 product_code 相同（无需搬）:",
      n19 and n51 and (n19["product_code"] or "") == (n51["product_code"] or ""))

print()
print("=" * 78)
print("Q5  forecast_import_products：1219 -> 1451 改指前查唯一性冲突")
print("=" * 78)
f19 = q("SELECT * FROM forecast_import_products WHERE product_id=1219")
f51 = q("SELECT period_id FROM forecast_import_products WHERE product_id=1451")
print("  1219 的登记行:")
for r in f19:
    print("    ", {k: r.get(k) for k in ("id", "period_id", "order_date", "product_name", "barcode", "action", "origin", "imported_by")})
print("  1451 已占用的 period_id:", [r["period_id"] for r in f51])
overlap = set(r["period_id"] for r in f19) & set(r["period_id"] for r in f51)
print("  [断言] 改指后不与 1451 现有行撞 period_id:", len(overlap) == 0, "| 交集 =", overlap)
idx = [r["name"] for r in q("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='forecast_import_products'")]
print("  该表索引:", idx)

print()
print("=" * 78)
print("Q6  条码分布：退休后每个条码应只剩 1 个在售行")
print("=" * 78)
for tag, (lo, hi) in PAIRS.items():
    bc = one("SELECT barcode FROM products WHERE id=?", (hi,))["barcode"]
    allr = q("SELECT id,name,is_active FROM products WHERE barcode=? ORDER BY id", (bc,))
    act = [r for r in allr if r["is_active"] == 1]
    print("  %s 条码=%s 共有 %d 行，其中在售 %d 行 -> %s"
          % (tag, bc, len(allr), len(act), [(r["id"], r["is_active"]) for r in allr]))
    print("     [断言] 退休后该条码在售行数 == 1:", len([r for r in allr if r["id"] not in RETIRE and r["is_active"] == 1]) == 1)

print()
print("=" * 78)
print("Q7  brand_pending：为 P2-3 的 dismissed 回填定量")
print("=" * 78)
try:
    bp = q("SELECT status, COUNT(*) n FROM brand_pending GROUP BY status")
    print("  状态分布:", bp)
    cand = q("SELECT p.id,p.raw_name,p.status,p.ref_count FROM brand_pending p "
             "WHERE p.status='resolved' AND NOT EXISTS(SELECT 1 FROM brands b WHERE b.name=p.raw_name)")
    print("  推断为「当年被忽略」（resolved 且 brands 里无此名）的行数 =", len(cand))
    for r in cand[:30]:
        print("    ", r)
except Exception as e:
    print("  brand_pending 读取失败:", e)

print()
print("=" * 78)
print("Q8  当前整体分布")
print("=" * 78)
print("  products is_active:", q("SELECT is_active, COUNT(*) n FROM products GROUP BY is_active"))
print("  products.brand 前 12:", q("SELECT brand, COUNT(*) n FROM products GROUP BY brand ORDER BY n DESC LIMIT 12"))
con.close()
print()
print("AUDIT_DONE")
