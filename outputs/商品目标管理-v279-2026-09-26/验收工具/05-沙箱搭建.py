#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v279 · 小程序切面沙箱 —— 克隆 tenant_1 -> tenant_9997 + 注册 + 授权。

目的：给「需求 2/3 小程序数据面」（D18–D22）一个**真实后端 + 真实数据**的验证环境，
     并在其中造出一个 `order_unit != unit` 的商品（D20 的硬判据样本）。
🔴 克隆走 SQLite backup API（WAL 模式下 copy2 会丢未 checkpoint 的提交）。
"""
import sqlite3
import os
import hashlib

ROOT = "/opt/hergent-erp"
SRC = os.path.join(ROOT, "tenant_1.db")
DST = os.path.join(ROOT, "tenant_9997.db")
SUP = 999891          # mptestsp（提审主管）


def sha16(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for ch in iter(lambda: f.read(1 << 20), b""):
            h.update(ch)
    return h.hexdigest()[:16]


for s in ("", "-wal", "-shm"):
    if os.path.exists(DST + s):
        os.remove(DST + s)

src_before = sha16(SRC)
_src = sqlite3.connect("file:%s?mode=ro" % SRC, uri=True)
_dst = sqlite3.connect(DST)
_src.backup(_dst)
_dst.close()
_src.close()

m = sqlite3.connect(os.path.join(ROOT, "erp.db"))
m.execute("DELETE FROM tenants WHERE id=9997")
m.execute("INSERT INTO tenants (id,name,subdomain,contact_name,contact_phone,plan,max_users,"
          "is_active,created_at,readonly) VALUES (9997,'V279沙箱','v279sbx','','','free',5,1,"
          "datetime('now','localtime'),0)")
m.execute("DELETE FROM user_tenants WHERE user_id=? AND tenant_id=9997", (SUP,))
m.execute("INSERT INTO user_tenants (user_id, tenant_id, role, created_at) "
          "VALUES (?, 9997, 'member', datetime('now','localtime'))", (SUP,))
m.commit()
m.close()

c = sqlite3.connect(DST)
c.execute("UPDATE forecast_periods SET status='open', order_start='2026-09-24', "
          "order_end='2026-12-31' WHERE id=18")
c.commit()
print("src_sha16_before =", src_before)
print("period18 ->", tuple(c.execute(
    "SELECT id,status,order_start,order_end FROM forecast_periods WHERE id=18").fetchone()))

# D20 样本：档案 order_unit 与 unit 不同源的商品（生产实测仅 1 个）
print("-- order_unit != unit 的商品（D20 样本）")
rows = c.execute(
    "SELECT id, name, unit, COALESCE(order_unit,'') ou, spec, COALESCE(large_unit,'') lu, "
    "COALESCE(large_ratio,0) lr, COALESCE(medium_unit,'') mu, COALESCE(medium_ratio,0) mr "
    "FROM products WHERE COALESCE(order_unit,'')<>'' AND TRIM(order_unit)<>TRIM(COALESCE(unit,'')) "
    "LIMIT 5").fetchall()
for r in rows:
    print("   ", tuple(r))
print("-- 本期清单商品数（period 18）")
try:
    print("   ", c.execute("SELECT COUNT(*) FROM forecast_period_items WHERE period_id=18").fetchone()[0])
except Exception as e:
    print("    (无 forecast_period_items:", str(e)[:40], ")")
print("-- 有换算的启用商品数")
print("   ", c.execute("SELECT COUNT(*) FROM products WHERE CAST(COALESCE(large_ratio,0) AS REAL)>0").fetchone()[0])
c.close()
print("dst exists =", os.path.exists(DST), "size =", os.path.getsize(DST))
