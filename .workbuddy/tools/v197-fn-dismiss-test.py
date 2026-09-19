#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v197 P2-3 函数级幂等验证（完全隔离：只操作 /tmp 下的库副本，绝不碰生产）。

验证命题（`add_brand_pending` / `resolve_brand_pending` 的 v197 契约）：
  A. dismissed 的品牌再次入队 ⇒ **不新建行、不累加 ref_count、原行仍为 dismissed**
  B. dismissed 的行不出现在 `list_brand_pending()`（待审列表）里
  C. dismiss **不改任何商品品牌**（dismiss ≠ merge）
  D. 对照：全新名称正常入 pending，重复入队**会**累加 ref_count（原语义未被改坏）

安全护栏：脚本开头断言 DB_DIR 指向 /tmp 沙箱目录，且断言目标库确实存在；
任一不成立立即 SystemExit，绝不落到生产库上。
"""
import os
import sys
import sqlite3

SCRATCH = "/tmp/v197-fn-test"
os.environ["ERP_DB_PATH"] = os.path.join(SCRATCH, "erp.db")
os.environ.setdefault("ERP_SECRET", "v197-fn-test-only-not-a-real-secret")
sys.path.insert(0, "/opt/hergent-erp")

import erp_db                      # noqa: E402
from db import connection          # noqa: E402

# ---------- 护栏 ----------
if os.path.abspath(connection.DB_DIR) != SCRATCH:
    raise SystemExit("GUARD FAIL: DB_DIR=%r 不是沙箱目录 %r" % (connection.DB_DIR, SCRATCH))

TID = 998
TP = os.path.join(SCRATCH, "tenant_%d.db" % TID)
if not os.path.exists(TP):
    raise SystemExit("GUARD FAIL: 沙箱租户库不存在 %s" % TP)

connection.set_tenant_context(TID)
if connection._tenant_db.get() != TP:
    raise SystemExit("GUARD FAIL: 租户上下文解析为 %r，期望 %r" % (connection._tenant_db.get(), TP))

_print = print
def print(*a):   # noqa: A001
    _print(*a, flush=True)

print("=== 沙箱确认 ===")
print("DB_DIR   =", connection.DB_DIR)
print("tenant   =", connection._tenant_db.get())
print("tenant_1 在库文件是否被引用 =", "/opt/hergent-erp/tenant_1.db" in str(connection._tenant_db.get()))


def q(sql, args=()):
    c = sqlite3.connect(TP)
    c.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in c.execute(sql, args).fetchall()]
    finally:
        c.close()


NAME = "__v197测试品牌__"
NAME2 = "__v197对照品牌__"

# 清掉上次残留，保证可重复运行
c = sqlite3.connect(TP)
for n in (NAME, NAME2):
    c.execute("DELETE FROM brand_pending WHERE raw_name=?", (n,))
c.commit()
c.close()

print()
print("=== 命题 D：对照 —— 全新名称入 pending，重复入队累加（原语义未被改坏）===")
n1 = erp_db.add_brand_pending(NAME2, source="v197test", ref_count=1)
n2 = erp_db.add_brand_pending(NAME2, source="v197test", ref_count=1)
rows2 = q("SELECT id,ref_count,status FROM brand_pending WHERE raw_name=?", (NAME2,))
print("  第一次入队 id=%s / 第二次入队 id=%s" % (n1, n2))
print("  行内容 =", rows2)
assert n1 == n2, "全新名称两次入队不该产生两行"
assert len(rows2) == 1, rows2
assert rows2[0]["status"] == "pending", rows2
assert rows2[0]["ref_count"] == 2, rows2
print("  PASS(D)：pending 去重 + ref_count 累加正常")

print()
print("=== 命题 A：dismiss 后再次入队 ⇒ 不回队、不累加 ===")
pid = erp_db.add_brand_pending(NAME, source="v197test", ref_count=1)
before = q("SELECT id,ref_count,status FROM brand_pending WHERE raw_name=?", (NAME,))
print("  步骤1 入队 id=%s → %s" % (pid, before))

res = erp_db.resolve_brand_pending(pid, "dismiss")
print("  步骤2 dismiss →", res)
mid = q("SELECT id,ref_count,status FROM brand_pending WHERE raw_name=?", (NAME,))
print("    落库状态 =", mid)
assert res.get("success") is True, res
assert res.get("status") == "dismissed", res          # v197：独立状态，不落 resolved
assert mid[0]["status"] == "dismissed", mid
assert not q("SELECT id FROM brands WHERE name=?", (NAME,)), "dismiss 不该建品牌"

pid2 = erp_db.add_brand_pending(NAME, source="v197test", ref_count=7)
after = q("SELECT id,ref_count,status FROM brand_pending WHERE raw_name=?", (NAME,))
print("  步骤3 再次入队（ref_count=7）返回 id=%s → %s" % (pid2, after))
assert len(after) == 1, "dismissed 后不该新建行，实际 %d 行" % len(after)
assert pid2 == pid, "应返回原行 id，实际 %s vs %s" % (pid2, pid)
assert after[0]["status"] == "dismissed", after
assert after[0]["ref_count"] == before[0]["ref_count"], (
    "dismissed 后不该累加 ref_count：%s → %s" % (before[0]["ref_count"], after[0]["ref_count"]))
print("  PASS(A)：dismissed 保持沉默 —— 不新建、不累加、状态不变")

print()
print("=== 命题 B：dismissed 不出现在待审列表 ===")
lst = erp_db.list_brand_pending()
names = [x["raw_name"] for x in lst]
print("  待审列表含本测试品牌 =", NAME in names)
print("  待审列表含对照品牌   =", NAME2 in names)
assert NAME not in names, "dismissed 不该出现在待审列表"
assert NAME2 in names, "pending 应该出现在待审列表"
print("  PASS(B)")

print()
print("=== 命题 C：dismiss 不改动任何商品品牌（dismiss ≠ merge）===")
c = sqlite3.connect(TP)
c.row_factory = sqlite3.Row
brands_before = {r["brand"]: r["n"] for r in c.execute(
    "SELECT brand, COUNT(*) n FROM products GROUP BY brand").fetchall()}
c.close()
# 再 dismiss 一次对照品牌之外的新名字，检查商品品牌分布完全不变
NAME3 = "__v197只忽略品牌__"
c = sqlite3.connect(TP)
c.execute("DELETE FROM brand_pending WHERE raw_name=?", (NAME3,))
c.commit()
c.close()
pid3 = erp_db.add_brand_pending(NAME3, source="v197test", ref_count=1)
erp_db.resolve_brand_pending(pid3, "dismiss")
c = sqlite3.connect(TP)
c.row_factory = sqlite3.Row
brands_after = {r["brand"]: r["n"] for r in c.execute(
    "SELECT brand, COUNT(*) n FROM products GROUP BY brand").fetchall()}
c.close()
print("  商品品牌分布是否完全一致 =", brands_before == brands_after)
if brands_before != brands_after:
    print("    before =", brands_before)
    print("    after  =", brands_after)
assert brands_before == brands_after, "dismiss 不该改动任何商品品牌"
print("  PASS(C)")

print()
print("=== 清理测试行 ===")
c = sqlite3.connect(TP)
for n in (NAME, NAME2, NAME3):
    c.execute("DELETE FROM brand_pending WHERE raw_name=?", (n,))
c.commit()
c.close()
print("  done")

print()
print("=" * 56)
print("ALL PASS —— v197 P2-3 四条命题全部成立")
print("=" * 56)
