#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v279 沙箱：克隆 tenant_1 -> tenant_9997 并注册。只碰沙箱 + 主库 tenants 一行。

🔴 克隆必须走 SQLite **backup API**，不能用 `shutil.copy2`：
   生产库在 WAL 模式下，最新的已提交数据可能还在 `tenant_1.db-wal` 里没 checkpoint；
   只复制主文件会**丢掉那部分**（或与残留 -wal 拼出不一致状态）。
   `Connection.backup()` 读的是「只读连接上的一致快照」，含 WAL 已提交内容。

用途：让「部署时启动期 schema-sync 补列/换索引」在**生产租户库**与**沙箱库**上
同时被观察到，并给 E2E 一个可写、可造的隔离环境（生产业务表一行不碰）。
"""
import sqlite3
import os
import hashlib

ROOT = "/opt/hergent-erp"
SRC = os.path.join(ROOT, "tenant_1.db")
DST = os.path.join(ROOT, "tenant_9997.db")


def sha16(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for ch in iter(lambda: f.read(1 << 20), b""):
            h.update(ch)
    return h.hexdigest()[:16]


for _s in ("", "-wal", "-shm"):
    if os.path.exists(DST + _s):
        os.remove(DST + _s)

# 记录生产 tenant_1 的指纹与期次 18 原文（事后证「生产一行未动」）
src_before = sha16(SRC)
c1 = sqlite3.connect("file:%s?mode=ro" % SRC, uri=True)
p18_before = c1.execute(
    "SELECT id,name,status,order_start,order_end FROM forecast_periods WHERE id=18").fetchone()
tgt_n_before = c1.execute("SELECT COUNT(*) FROM product_targets").fetchone()[0]
c1.close()

# 一致性克隆（含 WAL 已提交数据）
_src = sqlite3.connect("file:%s?mode=ro" % SRC, uri=True)
_dst = sqlite3.connect(DST)
_src.backup(_dst)
_dst.close()
_src.close()

# 注册沙箱租户（库名按 id 推导：tenant_<id>.db）
m = sqlite3.connect(os.path.join(ROOT, "erp.db"))
m.execute("DELETE FROM tenants WHERE id=9997")
m.execute(
    "INSERT INTO tenants (id,name,subdomain,contact_name,contact_phone,plan,max_users,"
    "is_active,created_at,readonly) VALUES (9997,'V279沙箱','v279sbx','','','free',5,1,"
    "datetime('now','localtime'),0)")
m.commit()
m.close()

c = sqlite3.connect(DST)
c.execute("UPDATE forecast_periods SET status='open' WHERE id=18")
c.commit()
per = [tuple(r) for r in c.execute(
    "SELECT id,name,status,order_start,order_end FROM forecast_periods ORDER BY id DESC LIMIT 4")]
c.close()

print("src_sha16_before =", src_before)
print("tenant_1 period18 before =", p18_before, "| product_targets rows =", tgt_n_before)
print("dst exists =", os.path.exists(DST), "size =", os.path.getsize(DST))
print("sandbox periods =")
for r in per:
    print("   ", r)
