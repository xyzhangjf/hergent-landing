#!/usr/bin/env python3
"""v653：/api/products/grid 专用精简查询。

背景（实测）：products 表 79 列；`SELECT *` + `dict(row)` 1159 行 = 48.7ms，
而 grid 只输出 21 个字段 ⇒ 58 列的 dict 构造是纯浪费（占该端点后端耗时约 3/4）。

红线：
- 行集与排序必须与 product_list("", "", "", limit=100000) **完全一致**
  （is_active=1、ORDER BY id DESC、LIMIT 100000）—— 否则网格会少商品/乱序。
- 用 SELECT * + 按需取键，**不写固定列名 SQL** —— 租户库 schema 与建表模板可能漂移
  （p14h 教训），固定列名在缺列的库上直接 500。
"""
import io
import sys

PRODUCTS = "/opt/hergent-erp/db/queries/products.py"
ERPDB = "/opt/hergent-erp/erp_db.py"
DATA = "/opt/hergent-erp/routers/data.py"

NEW_FUNC = '''

# ============================ 编辑网格专用精简行（v653） ============================
# 🔴 为什么不能直接复用 product_list：products 表生产实测 **79 列**，
#    `SELECT *` + `dict(row)` × 1159 行要 **48.7ms**（2026-10-23 实测），
#    而 /api/products/grid 只输出 21 个字段 ⇒ 其余 58 列的 dict 构造纯属浪费
#    （占该端点后端耗时的约 3/4）。
# ⚠️ 这里刻意用 `SELECT *` + 按需取键，**不写固定列名列表** —— 租户库的真实 schema
#    与建表模板可能漂移（p14h 的教训），固定列名在缺列的库上会直接 500。
# ⚠️ 行集/排序必须与 `product_list("", "", "", limit=100000)` 一字不差，
#    否则编辑网格会少商品或乱序（用户会以为"商品丢了"）。
GRID_COLUMNS = (
    "id", "name", "barcode", "spec", "unit", "order_unit",
    "large_unit", "large_ratio", "medium_unit", "medium_ratio",
    "sale_price", "purchase_price", "factory_price", "safety_stock",
    "expiry_days", "product_code", "dist_price", "category", "brand",
    "arrival_lead_days", "extra_json",
)


def product_grid_rows():
    """在售商品主档的精简行（仅供 /api/products/grid）。

    与 `product_list("", "", "", limit=100000)` **同一行集、同一排序**
    （is_active=1 + ORDER BY id DESC + LIMIT 100000），只是不做无关列的 dict 构造。
    """
    with get_db() as db:
        rows = db.execute(
            "SELECT * FROM products WHERE is_active=1 ORDER BY id DESC LIMIT ?",
            (100000,),
        ).fetchall()
        if not rows:
            return []
        have = set(rows[0].keys())
        keys = [k for k in GRID_COLUMNS if k in have]
        return [{k: r[k] for k in keys} for r in rows]
'''


def read(p):
    return io.open(p, encoding="utf-8").read()


def write(p, s):
    io.open(p, "w", encoding="utf-8").write(s)


# ---------- 1) db/queries/products.py：追加函数 ----------
s = read(PRODUCTS)
if "def product_grid_rows(" in s:
    print("SKIP products.py：已存在 product_grid_rows")
else:
    anchor = "def product_fuzzy_match("
    assert s.count(anchor) == 1, "锚点不唯一: product_fuzzy_match"
    s = s.replace(anchor, NEW_FUNC.strip("\n") + "\n\n\n" + anchor, 1)
    write(PRODUCTS, s)
    print("OK products.py：已追加 product_grid_rows")

# ---------- 2) erp_db.py：加入 import 列表 ----------
s = read(ERPDB)
if "product_grid_rows" in s:
    print("SKIP erp_db.py：import 已含 product_grid_rows")
else:
    old = "product_create, product_update, product_list, product_get,"
    assert s.count(old) == 1, "锚点不唯一: erp_db import 行"
    s = s.replace(old, "product_create, product_update, product_list, product_grid_rows, product_get,", 1)
    write(ERPDB, s)
    print("OK erp_db.py：import 已补 product_grid_rows")

# ---------- 3) routers/data.py：改用精简查询 ----------
s = read(DATA)
if "db.product_grid_rows()" in s:
    print("SKIP data.py：已改用 product_grid_rows")
else:
    old = '''    # v130: 必须显式传大 limit —— product_list 默认 limit=200，在售商品超过 200 时会被静默截断，
    # 导致报单网格缺商品、品牌筛选下拉候选被砍（与 /api/products 保持一致取全量）。
    items = db.product_list("", "", "", limit=100000)'''
    assert s.count(old) == 1, "锚点不唯一: data.py 的 product_list 调用"
    new = '''    # v130: 必须显式传大 limit —— 默认 limit=200，在售商品超过 200 时会被静默截断，
    # 导致报单网格缺商品、品牌筛选下拉候选被砍（与 /api/products 保持一致取全量）。
    # v653：改用 product_grid_rows() —— 与 product_list 同一行集/排序，但只构造本端点
    #   真正输出的 21 列（products 表实测 79 列，全量 dict 转换占该端点后端耗时约 3/4）。
    items = db.product_grid_rows()'''
    s = s.replace(old, new, 1)
    write(DATA, s)
    print("OK data.py：已改用 product_grid_rows()")

# ---------- 4) 自检：行集一致性（直接比对两个函数的结果） ----------
sys.path.insert(0, "/opt/hergent-erp")
from db.connection import set_tenant_context  # noqa: E402
set_tenant_context(1)
import erp_db as db  # noqa: E402

full = db.product_list("", "", "", limit=100000)
slim = db.product_grid_rows()
print("\n自检：product_list=%d 行, product_grid_rows=%d 行" % (len(full), len(slim)))
assert len(full) == len(slim), "行数不一致"
assert [r["id"] for r in full] == [r["id"] for r in slim], "id 顺序不一致"
miss = [k for k in db.GRID_COLUMNS if k in set(full[0].keys()) and k not in set(slim[0].keys())] \
    if hasattr(db, "GRID_COLUMNS") else []
print("自检：id 顺序一致 ✔  字段缺失:", miss or "无")

# 关键字段逐个比对（21 列都要一致）
KEYS = [k for k in (
    "id", "name", "barcode", "spec", "unit", "order_unit", "large_unit", "large_ratio",
    "medium_unit", "medium_ratio", "sale_price", "purchase_price", "factory_price",
    "safety_stock", "expiry_days", "product_code", "dist_price", "category", "brand",
    "arrival_lead_days", "extra_json",
) if k in full[0]]
bad = 0
for a, b in zip(full, slim):
    for k in KEYS:
        if a.get(k) != b.get(k):
            bad += 1
            if bad <= 3:
                print("  差异 id=%s %s: %r != %r" % (a["id"], k, a.get(k), b.get(k)))
print("自检：逐行逐字段比对 %d 行 × %d 列，差异 %d 处" % (len(full), len(KEYS), bad))
assert bad == 0, "字段值不一致"
print("\nALL CHECKS PASSED")
