#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
沙箱 9997 条码重复诊断（只读）+ 可选消重
用法：
  python3 v195-sbx-dup-barcode.py diag          # 只读，列出重复组
  python3 v195-sbx-dup-barcode.py fix  <id> <new_barcode>   # 改一条（改前自动备份）

⚠️ 只允许操作 tenant_9997（隔离沙箱）；对 tenant_1 及任何 < 9997 的库直接拒跑。
"""
import os
import sys
import shutil
import sqlite3
import time

SBX = 9997
BASE = "/opt/hergent-erp"
PATH = os.path.join(BASE, "tenant_%d.db" % SBX)


def guard():
    if sys.argv[1:2] and sys.argv[1] == "fix":
        if SBX < 9997:
            print("REFUSE: 只允许沙箱 id >= 9997")
            sys.exit(2)
    if not os.path.exists(PATH):
        print("REFUSE: 沙箱库不存在", PATH)
        sys.exit(2)


def diag():
    db = sqlite3.connect("file:%s?mode=ro" % PATH, uri=True, timeout=8)
    db.row_factory = sqlite3.Row
    cols = [r[1] for r in db.execute("PRAGMA table_info(products)").fetchall()]
    print("products 列:", ", ".join(cols))
    bc = "barcode" if "barcode" in cols else None
    if not bc:
        print("无 barcode 列")
        return
    print()
    print("=== 按 (brand, barcode) 分组，找重复 ===")
    q = ("SELECT COALESCE(brand,'') brand, barcode, COUNT(*) c, "
         "GROUP_CONCAT(id || ':' || COALESCE(name,'') , ' || ') items "
         "FROM products WHERE TRIM(COALESCE(barcode,'')) <> '' "
         "GROUP BY brand, barcode HAVING c > 1 ORDER BY c DESC LIMIT 30")
    n = 0
    for r in db.execute(q).fetchall():
        n += 1
        print("  [%d] brand=%r barcode=%r ×%d" % (n, r["brand"], r["barcode"], r["c"]))
        print("       %s" % r["items"])
    print("  重复组数 =", n)

    print()
    print("=== 纯 barcode 维度（不分品牌）重复 ===")
    m = 0
    for r in db.execute(
            "SELECT barcode, COUNT(*) c, GROUP_CONCAT(id || ':' || COALESCE(name,''), ' || ') items "
            "FROM products WHERE TRIM(COALESCE(barcode,'')) <> '' "
            "GROUP BY barcode HAVING c > 1 ORDER BY c DESC LIMIT 30").fetchall():
        m += 1
        print("  [%d] barcode=%r ×%d  %s" % (m, r["barcode"], r["c"], r["items"]))
    print("  重复组数 =", m)
    db.close()


def fix(pid, new_bc):
    ts = time.strftime("%Y%m%d_%H%M%S")
    bak = "/tmp/backup_v195_sbx_%s/tenant_9997.db" % ts
    os.makedirs(os.path.dirname(bak), exist_ok=True)
    shutil.copy2(PATH, bak)
    print("已备份 ->", bak)
    db = sqlite3.connect(PATH, timeout=8)
    db.row_factory = sqlite3.Row
    before = db.execute("SELECT id, name, brand, barcode FROM products WHERE id=?", (pid,)).fetchone()
    if not before:
        print("REFUSE: 找不到 id=%s" % pid)
        sys.exit(2)
    print("改前:", dict(before))
    db.execute("UPDATE products SET barcode=? WHERE id=?", (new_bc, pid))
    db.commit()
    after = db.execute("SELECT id, name, brand, barcode FROM products WHERE id=?", (pid,)).fetchone()
    print("改后:", dict(after))
    db.close()


if __name__ == "__main__":
    guard()
    mode = sys.argv[1] if len(sys.argv) > 1 else "diag"
    if mode == "diag":
        diag()
    elif mode == "fix":
        fix(int(sys.argv[2]), sys.argv[3])
    else:
        print("用法: diag | fix <id> <new_barcode>")
