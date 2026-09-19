#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
v195 单变量对照实验 —— 证明「在写事务**内**调用 track_brand」会自锁（5 秒/行），
移到事务**提交之后**则亚秒完成。

背景（2026-09-18 生产事故）：
  bulk_upsert_products 在 `with db.get_db_tx() as conn:` 的写事务里逐行调用
  `db.track_brand()`；而 track_brand 内部用 `with get_db()` 另开一条连接写
  brand_pending。connection._sqlite_connect 的重入分支（源码注释自述
  "Re-entrant calls ... get a fresh throwaway connection to preserve
  transaction isolation"）会为它创建**新连接** ⇒ 撞上外层尚未提交的写锁 ⇒
  每行白等 PRAGMA busy_timeout=5000 ⇒ 28 行 = 140 秒 ⇒ 前端 20 秒超时（nginx 499）。

用法（必须在生产上以 hergent 身份、在 /opt/hergent-erp 下跑，且先 source .env）：
  runuser -u hergent --preserve-environment -- python3 /tmp/v195-bulkupsert-tx-ab.py \
      --tenant 9997 --n 28

🔴 硬约束：只允许沙箱租户（id >= 9997）。tenant_1 / tenant_10 永不触碰。
"""
import argparse
import os
import sys
import time

ERP = "/opt/hergent-erp"
sys.path.insert(0, ERP)
os.chdir(ERP)

import erp_db as db  # noqa: E402
from db import connection as C  # noqa: E402

SEED_COLS = ("name", "spec", "unit", "barcode", "sale_price", "purchase_price",
             "safety_stock", "expiry_days", "product_code", "dist_price",
             "source", "source_id")


def log(m):
    print(m, flush=True)


def seed(tag, n):
    with db.get_db_tx() as conn:
        for i in range(n):
            conn.execute(
                "INSERT INTO products (" + ",".join(SEED_COLS) + ",is_active) VALUES ("
                + ",".join("?" for _ in SEED_COLS) + ",1)",
                ("V195-%s-%02d" % (tag, i), "", "件", "V195%s%04d" % (tag.upper(), i),
                 0, 0, 0, 0, "", 0, "v195_sbx", "v195"),
            )
    log("  已播种 %d 行测试商品（tag=%s）" % (n, tag))


def rows_of(tag, n, brand_pfx):
    out = []
    for i in range(n):
        out.append({
            "name": "V195-%s-%02d" % (tag, i),
            "barcode": "V195%s%04d" % (tag.upper(), i),
            "brand": "%s%s" % (brand_pfx, "ABC"[i % 3]),
        })
    return out


def variant_old(rows):
    """改前形态：track_brand 在写事务内（且生产代码是「先 UPDATE 再登记」，故首行也会撞锁）。"""
    t0 = time.time()
    per = []
    with db.get_db_tx() as conn:
        for r in rows:
            s = time.time()
            row = conn.execute("SELECT id FROM products WHERE barcode=? AND is_active=1 LIMIT 1",
                               (r["barcode"],)).fetchone()
            pid = row["id"] if row else None
            if pid:
                conn.execute("UPDATE products SET spec=? WHERE id=?", ("", pid))  # 模拟生产：DML 先发生
                nb = db.track_brand(r["brand"], "v195_sbx")                       # ← 改前：事务内
                conn.execute("UPDATE products SET brand=? WHERE id=?", (nb, pid))
            else:
                conn.execute("INSERT INTO products (name,barcode,unit,is_active) VALUES (?,?,?,1)",
                             (r["name"], r["barcode"], "件"))
            per.append(time.time() - s)
    return time.time() - t0, per


def variant_new(rows):
    """改后形态：循环内只做纯字符串归一，登记挪到事务提交之后。"""
    t0 = time.time()
    seen = []
    with db.get_db_tx() as conn:
        for r in rows:
            row = conn.execute("SELECT id FROM products WHERE barcode=? AND is_active=1 LIMIT 1",
                               (r["barcode"],)).fetchone()
            pid = row["id"] if row else None
            nb = db.normalize_brand(r["brand"])          # 纯字符串，不碰库
            seen.append(nb)
            if pid:
                conn.execute("UPDATE products SET spec=? WHERE id=?", ("", pid))
                conn.execute("UPDATE products SET brand=? WHERE id=?", (nb, pid))
            else:
                conn.execute("INSERT INTO products (name,barcode,unit,is_active) VALUES (?,?,?,1)",
                             (r["name"], r["barcode"], "件"))
    tx_done = time.time()
    for nb in seen:                                       # ← 改后：事务已提交，锁已释放
        db.track_brand(nb, "v195_sbx")
    return time.time() - t0, tx_done - t0, time.time() - tx_done


def cleanup():
    with db.get_db_tx() as conn:
        n1 = conn.execute("DELETE FROM products WHERE source='v195_sbx'").rowcount
        n2 = conn.execute("DELETE FROM brand_pending WHERE source='v195_sbx'").rowcount
    return n1, n2


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tenant", type=int, required=True)
    ap.add_argument("--n", type=int, default=28)
    ap.add_argument("--variant", default="both", choices=["old", "new", "both"])
    a = ap.parse_args()

    if a.tenant < 9997:
        log("拒绝：只允许沙箱租户（id >= 9997），本次 = %d" % a.tenant)
        return 2

    C.set_tenant_context(a.tenant)
    log("tenant_db = %s" % (C._tenant_db.get(),))
    with db.get_db() as c:
        brands = set(x["name"] for x in c.execute("SELECT name FROM brands").fetchall())
        npend = c.execute("SELECT COUNT(*) FROM brand_pending WHERE status='pending'").fetchone()[0]
    log("brands 表 %d 条 / 待审 pending %d 条（对照基线）" % (len(brands), npend))

    n = a.n
    log("")
    log("=" * 76)
    log("对照组：N = %d 行，每行都带品牌（品牌名不在 brands 表内 ⇒ 必走登记分支）" % n)
    log("=" * 76)

    if a.variant in ("old", "both"):
        tag = "old"
        seed(tag, n)
        rs = rows_of(tag, n, "V195旧品牌")
        log("")
        log("[改前] track_brand 在写事务**内** —— 开始计时 ...")
        el, per = variant_old(rs)
        slow = sum(1 for x in per if x > 1.0)
        log("  总耗时 = %.2f 秒   （>1 秒的行数 = %d / %d）" % (el, slow, n))
        log("  逐行耗时（前 6 行 + 后 3 行）：")
        for i, x in enumerate(per[:6]):
            log("    行 %02d : %6.2f 秒" % (i + 1, x))
        if n > 9:
            log("    ...")
            for i, x in enumerate(per[-3:], start=n - 2):
                log("    行 %02d : %6.2f 秒" % (i, x))
        log("  ⇒ 折算：%.2f / %d = %.2f 秒/行（≈ busy_timeout 5 秒）" % (el, n, el / n))

    if a.variant in ("new", "both"):
        tag = "new"
        seed(tag, n)
        rs = rows_of(tag, n, "V195新品牌")
        log("")
        log("[改后] track_brand 挪到事务**提交之后** —— 开始计时 ...")
        el, tx, reg = variant_new(rs)
        log("  总耗时 = %.3f 秒   （其中事务段 %.3f 秒 / 登记段 %.3f 秒）" % (el, tx, reg))
        log("  ⇒ 折算：%.4f 秒/行" % (el / n))

    d1, d2 = cleanup()
    log("")
    log("清理：删除测试商品 %d 行 / 测试待审品牌 %d 行" % (d1, d2))
    with db.get_db() as c:
        npend2 = c.execute("SELECT COUNT(*) FROM brand_pending WHERE status='pending'").fetchone()[0]
    log("待审 pending 复核 = %d（改后应 > 基线，改前应 = 基线）" % npend2)
    return 0


if __name__ == "__main__":
    sys.exit(main())
