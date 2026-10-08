#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v316d 追查：id=2860 的 last_order 为何从 06-29 变成 09-25（只读）。

若 sale_orders 最近有大量插入/改动 ⇒ 是**数据在变**，不是排序 bug。
"""
import sqlite3

c = sqlite3.connect("file:/opt/hergent-erp/tenant_1.db?mode=ro", uri=True)
c.row_factory = sqlite3.Row

now = c.execute("SELECT datetime('now','localtime')").fetchone()[0]
print("模型时间(本机) =", now)

cols = [r[1] for r in c.execute("PRAGMA table_info(sale_orders)")]
print("sale_orders 列 =", cols)

tot = c.execute("SELECT COUNT(*) FROM sale_orders").fetchone()[0]
print("sale_orders 总行数 =", tot)

if 'created_at' in cols:
    r = c.execute("SELECT MIN(created_at) mn, MAX(created_at) mx FROM sale_orders").fetchone()
    print("created_at 范围 = %s  →  %s" % (r['mn'], r['mx']))
    for h in (1, 2, 6, 24):
        n = c.execute("SELECT COUNT(*) FROM sale_orders WHERE created_at > datetime('now','localtime','-%d hour')" % h).fetchone()[0]
        print("   最近 %2d 小时内新增 = %d" % (h, n))

print("")
print("== id=2860 的订单 ==")
r = c.execute("SELECT COUNT(*) n, MIN(order_date) mn, MAX(order_date) mx FROM sale_orders WHERE customer_id=2860").fetchone()
print("   单数=%s  order_date 范围 = %s → %s" % (r['n'], r['mn'], r['mx']))
for row in c.execute("SELECT id, order_date, created_at FROM sale_orders WHERE customer_id=2860 ORDER BY order_date DESC LIMIT 6").fetchall():
    d = dict(row)
    print("     id=%-6s order_date=%-20s created_at=%s" % (d.get('id'), d.get('order_date'), d.get('created_at')))

print("")
print("== order_date 的日期分布（近 12 个不同值）==")
for row in c.execute("SELECT substr(order_date,1,10) d, COUNT(*) n FROM sale_orders GROUP BY d ORDER BY d DESC LIMIT 12").fetchall():
    print("     %s  x%d" % (row['d'], row['n']))

# 格式自证：有没有非 ISO 的 order_date（会让字符串排序出错）
bad = c.execute("SELECT COUNT(*) FROM sale_orders WHERE order_date IS NOT NULL AND order_date <> '' "
                "AND order_date NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'").fetchone()[0]
print("")
print("非 ISO(YYYY-MM-DD 开头) 的 order_date 行数 = %d" % bad)
c.close()
