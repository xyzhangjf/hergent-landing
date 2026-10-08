#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生产库只读核查：报单单位（order_unit）与档案小单位（unit）不一致的商品有几行、是否带换算。
只读打开（mode=ro），不写任何东西。"""
import sqlite3

c = sqlite3.connect("file:/opt/hergent-erp/tenant_1.db?mode=ro", uri=True)
rows = c.execute(
    "SELECT id, name, COALESCE(unit,''), COALESCE(order_unit,''), "
    "COALESCE(large_unit,''), COALESCE(large_ratio,0), COALESCE(medium_ratio,0), "
    "COALESCE(spec,'') FROM products").fetchall()

print("生产商品总数 =", len(rows))
mis = []
for r in rows:
    u = r[2] or ''
    ou = r[3] or ''
    if ou and ou != u:
        mis.append(r)
print("order_unit != unit 的商品数 =", len(mis))
for r in mis:
    has_conv = float(r[5] or 0) > 0 or float(r[6] or 0) > 0
    print("   id=%s unit=%r order_unit=%r large_unit=%r large_ratio=%s medium_ratio=%s "
          "spec=%r 有换算=%s name=%s"
          % (r[0], r[2], r[3], r[4], r[5], r[6], r[7], has_conv, r[1]))

# 有换算的商品总数（D20 要成立，必须「有换算」且「报单单位不在档案三级单位里」同时为真）
ok = 0
for r in rows:
    if float(r[5] or 0) > 0 or float(r[6] or 0) > 0:
        ok += 1
print("有单位换算（large_ratio 或 medium_ratio > 0）的商品数 =", ok)

try:
    print("forecast_extra_alloc 行数 =",
          c.execute("SELECT COUNT(*) FROM forecast_extra_alloc").fetchone()[0])
except Exception as e:
    print("forecast_extra_alloc:", e)
c.close()
