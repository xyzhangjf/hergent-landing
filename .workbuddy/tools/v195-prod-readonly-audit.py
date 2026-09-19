#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
v195 生产只读复核（绝不写入）
目的：确认本轮「甲档」改动只落在 /opt 的两个代码文件上，
      生产 tenant_1 业务数据与品牌待审队列零污染。
只读：sqlite3 以 mode=ro 打开；不做任何 INSERT/UPDATE/DELETE。
"""
import os
import sqlite3
import hashlib

BASE = "/opt/hergent-erp"
TENANT1 = os.path.join(BASE, "tenant_1.db")

def md5(p):
    try:
        h = hashlib.md5()
        with open(p, "rb") as f:
            for chunk in iter(lambda: f.read(65536), b""):
                h.update(chunk)
        return h.hexdigest()
    except Exception as e:
        return "ERR:%s" % e

def ro_connect(path):
    uri = "file:%s?mode=ro" % path
    c = sqlite3.connect(uri, uri=True, timeout=5)
    c.row_factory = sqlite3.Row
    return c

print("=== 1) 生产文件 md5 复核（与本轮部署后基线逐字比对）===")
expect = {
    os.path.join(BASE, "routers", "data.py"): "c29c1f70f042626254d78041abedf042",
    os.path.join(BASE, "erp_db.py"): "ad1a7decab1ba288623d28821fe26165",
    os.path.join(BASE, "db", "connection.py"): "f2563b77146e357aca2117e13dfe5bdd",
}
for p, want in expect.items():
    got = md5(p)
    print("%-46s %s %s" % (os.path.basename(p), got, "OK" if got == want else "MISMATCH(want %s)" % want))

print()
print("=== 2) tenant_1 只读盘点 ===")
print("tenant_1.db 存在:", os.path.exists(TENANT1), "| 大小:", os.path.getsize(TENANT1) if os.path.exists(TENANT1) else "-")

db = ro_connect(TENANT1)
def one(sql, args=()):
    try:
        return db.execute(sql, args).fetchone()
    except Exception as e:
        return ("ERR", str(e))

tests = [
    ("products 总行数", "SELECT COUNT(*) c FROM products"),
    ("products 里 v195/沙箱测试码残留（应 0）",
     "SELECT COUNT(*) c FROM products WHERE code LIKE 'V195%' OR code LIKE 'SBX%' OR code LIKE 'ZBV195%' "
     "OR name LIKE '%v195%' OR name LIKE 'V195%'"),
    ("brand_pending 总行数", "SELECT COUNT(*) c FROM brand_pending"),
    ("brand_pending 里 v195_sbx 残留（应 0）",
     "SELECT COUNT(*) c FROM brand_pending WHERE source = 'v195_sbx'"),
    ("brands 总行数", "SELECT COUNT(*) c FROM brands"),
    ("最新 products 行（看是否被写）",
     "SELECT COUNT(*) c FROM products WHERE is_active = 1"),
]
for label, sql in tests:
    r = one(sql)
    if isinstance(r, tuple):
        print("%-40s => %s" % (label, r))
    else:
        print("%-40s => %s" % (label, dict(r)))

print()
print("--- brand_pending 按 source/status 分布 ---")
try:
    for r in db.execute("SELECT source, status, COUNT(*) c FROM brand_pending GROUP BY source, status ORDER BY c DESC").fetchall():
        print("   ", dict(r))
except Exception as e:
    print("   ERR", e)

print()
print("--- products 里 brand 维度抽样（看品牌登记现状，只读）---")
try:
    for r in db.execute("SELECT COALESCE(brand,'<null>') b, COUNT(*) c FROM products GROUP BY b ORDER BY c DESC LIMIT 15").fetchall():
        print("   ", dict(r))
except Exception as e:
    print("   ERR", e)

db.close()

print()
print("=== 3) 沙箱 9997 是否已销毁 ===")
sbx = os.path.join(BASE, "tenant_9997.db")
print("tenant_9997.db 存在:", os.path.exists(sbx))
if os.path.exists(sbx):
    print("  大小:", os.path.getsize(sbx), "（若仍在，需 down --id 9997）")

print()
print("=== 4) /tmp 遗留脚本盘点 ===")
import glob
for p in sorted(glob.glob("/tmp/v195-*") + glob.glob("/tmp/sandbox_tenant.py")):
    print("   ", p, os.path.getsize(p), "B")

print()
print("AUDIT_DONE")
