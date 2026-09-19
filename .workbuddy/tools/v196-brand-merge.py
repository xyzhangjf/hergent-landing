#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v196 品牌归并：蒙牛低温（福宝） + 蒙牛低温（恒滋） → 蒙牛低温

用户 2026-09-19 定调（逐字）：
    「算（这是我们公司在蒙牛低温有两个户头，一个是福宝/一个是恒滋）」
⇒ 两个户头都属于「蒙牛低温」这一个品牌，品牌维度必须统一；商品档案**不合并**
  （两户头的商品条码实测全不重叠，本来就是不同商品）。

前置只读核查（已完成，2026-09-19）：
  · products.brand: 蒙牛低温 132 / 蒙牛低温（福宝）24 / 蒙牛低温（恒滋）1
  · brands 表里**没有**福宝/恒滋（只有 4 行），全库仅 products.brand 存此名
  · chanjet_tokens.scope / expense_orders.brand 均不含福宝/恒滋 ⇒ 零外溢
  · 该 25 行条码**全部唯一** ⇒ 归并后新增重复条码组 = 0（不会引发条码重复误报）

用法:
    --dry     只读预演（打印将改的行 + 前后计数）
    --apply   执行（在线备份 → 单事务 → 逐行断言 → 业务层复核 → 打印回滚 SQL）
"""
import hashlib
import os
import shutil
import sqlite3
import sys
import time

DB = "/opt/hergent-erp/tenant_1.db"
TARGET = "蒙牛低温"
SRC = ["蒙牛低温（福宝）", "蒙牛低温（恒滋）"]
BAK_ROOT = "/tmp"


def sha256(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def counts(cur):
    out = {}
    for b in SRC + [TARGET]:
        out[b] = cur.execute("SELECT COUNT(*) FROM products WHERE brand=?", (b,)).fetchone()[0]
    out["__total__"] = cur.execute("SELECT COUNT(*) FROM products").fetchone()[0]
    out["__allbrands__"] = cur.execute(
        "SELECT COUNT(DISTINCT brand) FROM products").fetchone()[0]
    return out


def main():
    apply_it = "--apply" in sys.argv
    dry = not apply_it
    print("模式:", "DRY（只读预演）" if dry else "APPLY（真写）")
    print("库:", DB, "| sha256 前 =", sha256(DB))

    cur = sqlite3.connect(DB, timeout=30)
    cur.execute("PRAGMA busy_timeout=30000")
    c = cur.cursor()

    before = counts(c)
    print("\n--- 归并前计数 ---")
    for k, v in before.items():
        print("   %-16s %s" % (k, v))

    rows = c.execute(
        "SELECT id, COALESCE(name,''), COALESCE(barcode,''), brand, COALESCE(is_active,1) "
        "FROM products WHERE brand IN (?,?) ORDER BY id", tuple(SRC)).fetchall()
    print("\n--- 将归并的 %d 行 ---" % len(rows))
    for r in rows:
        print("   id=%-5s act=%s 品牌=%-16s bc=%-14s %s" % (r[0], r[4], r[3], r[2], r[1]))

    expect = before[SRC[0]] + before[SRC[1]]
    assert len(rows) == expect, "行数与计数不符: %d vs %d" % (len(rows), expect)

    if dry:
        print("\n[DRY] 未写入。加 --apply 执行。")
        cur.close()
        return

    # ① 在线备份（先把 wal 落盘，保证备份可用）
    c.execute("PRAGMA wal_checkpoint(FULL)")
    os.makedirs(BAK_ROOT, exist_ok=True)
    ts = time.strftime("%Y%m%d_%H%M%S")
    bakdir = os.path.join(BAK_ROOT, "backup_v196_%s" % ts)
    os.makedirs(bakdir, exist_ok=True)
    bak = os.path.join(bakdir, "tenant_1.db")
    shutil.copy2(DB, bak)
    print("\n① 备份:", bak, "| sha256 =", sha256(bak))

    # ② 单事务归并
    ids = [r[0] for r in rows]
    qmarks = ",".join("?" for _ in ids)
    try:
        c.execute("BEGIN IMMEDIATE")
        c.execute(
            "UPDATE products SET brand=? WHERE id IN (%s) AND brand IN (?,?)" % qmarks,
            (TARGET,) + tuple(ids) + tuple(SRC))
        affected = c.rowcount
        # ③ 事务内逐行断言
        assert affected == len(ids), "affected=%d 期望 %d" % (affected, len(ids))
        left = c.execute(
            "SELECT COUNT(*) FROM products WHERE brand IN (?,?)", tuple(SRC)).fetchone()[0]
        assert left == 0, "仍有 %d 行未归并" % left
        tgt = c.execute("SELECT COUNT(*) FROM products WHERE brand=?", (TARGET,)).fetchone()[0]
        assert tgt == before[TARGET] + len(ids), "目标品牌 %d 期望 %d" % (tgt, before[TARGET] + len(ids))
        cur.commit()
        print("② 事务已提交: affected =", affected)
    except Exception as e:
        cur.rollback()
        print("!! 事务回滚:", e)
        cur.close()
        raise

    # ④ 业务层复核（新连接读，确认真落到盘上）
    v = sqlite3.connect("file:%s?mode=ro" % DB, uri=True)
    vc = v.cursor()
    after = counts(vc)
    print("\n--- 归并后计数 ---")
    for k, val in after.items():
        flag = "✅" if (k in SRC and val == 0) or (k == TARGET and val == before[TARGET] + len(ids)) \
            or (k.startswith("__") and val == before[k]) else "⚠️"
        print("   %s %-16s %s（前 %s）" % (flag, k, val, before[k]))
    print("\n   目标品牌合计 =", after[TARGET], "（期望", before[TARGET] + len(ids), "）")
    print("   商品总行数不变 =", after["__total__"] == before["__total__"])
    print("   品牌种类数 前/后 =", before["__allbrands__"], "/", after["__allbrands__"], "（应减 2）")

    # ⑤ 归并后条码重复组变化（应 0 变化）
    def dup_groups(cc):
        return cc.execute(
            "SELECT COUNT(*) FROM (SELECT 1 FROM products WHERE TRIM(COALESCE(barcode,''))<>'' "
            "GROUP BY barcode HAVING COUNT(*)>1)").fetchone()[0]
    print("   重复条码组数 前/后 =", dup_groups(c), "/", dup_groups(vc), "（应相等）")
    v.close()

    # ⑥ 回滚 SQL
    rb = os.path.join(bakdir, "rollback.sql")
    with open(rb, "w", encoding="utf-8") as f:
        for r in rows:
            f.write("UPDATE products SET brand=%s WHERE id=%s;  -- %s\n"
                    % ("'" + r[3].replace("'", "''") + "'", r[0], r[1]))
    print("\n⑥ 回滚脚本:", rb)
    print("   或整体还原: cp %s %s" % (bak, DB))
    cur.close()
    print("\n[APPLY] done.")


if __name__ == "__main__":
    main()
