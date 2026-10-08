#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""直调后端 `_arc_map`，定位「库里 order_unit='提' 但接口回 '包'」的断点。只读。"""
import os
import sys
import sqlite3

# systemd 的 EnvironmentFile —— 不读它，core.py 会在 import 期直接 RuntimeError
with open("/opt/hergent-erp/.env", encoding="utf-8") as f:
    for _ln in f:
        _ln = _ln.strip()
        if _ln.startswith("ERP_SECRET="):
            os.environ["ERP_SECRET"] = _ln.split("=", 1)[1].strip().strip('"').strip("'")

sys.path.insert(0, "/opt/hergent-erp")
import db

db.set_tenant_context(9997)

c = sqlite3.connect("file:/opt/hergent-erp/tenant_9997.db?mode=ro", uri=True)
print("A. RAW sqlite       :", c.execute(
    "SELECT id, unit, order_unit FROM products WHERE id=1556").fetchone())
c.close()

with db.get_db() as cc:
    r = cc.execute("SELECT id, unit, order_unit, spec FROM products WHERE id=1556").fetchone()
    print("B. get_db() read    :", tuple(r) if r else None)

from routers.product_targets import _arc_map
arc = _arc_map([1556])
print("C. _arc_map(1556)   :", arc.get(1556))

from db.queries.products import order_unit_sql, unit_display_map, unit_value
with db.get_db() as cc:
    r = cc.execute("SELECT " + order_unit_sql("p") + " FROM products p WHERE p.id=1556").fetchone()
    print("D. order_unit_sql   :", tuple(r) if r else None)

a = arc.get(1556) or {}
print("E. unit_display_map(75, arc) =", unit_display_map(75, a))
print("F. unit_value(75,'提',spec,arc) =", unit_value(75, "提", a.get("spec"), a))
print("G. arc keys =", sorted(a.keys()))
