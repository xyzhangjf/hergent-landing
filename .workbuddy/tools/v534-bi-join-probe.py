"""v534 BI JOIN 重复累加疑点 · 生产只读实证（零写入）

疑点（侦察发现）：_BI_MEASURES 的 revenue/profit/margin 用 SUM(so.total_amount)，
而 FROM 是 sale_orders LEFT JOIN sale_order_items ⇒ 低于订单级的维度（商品/客户/月）
会把订单总额按明细行数重复累加。已上线的「均单分析」页正用这套算销售额 KPI。

设计（阳性对照）：
  前提阳性 = 存在「订单总额 != 明细合计」且多明细的订单（否则 JOIN 不放大）；
  证据 = JOIN 口径收入 vs 正确口径收入的差额与比例。
"""
import sqlite3

con = sqlite3.connect("file:/opt/hergent-erp/tenant_1.db?mode=ro", uri=True)
c = con.cursor()

c.execute("SELECT COUNT(*) FROM sale_orders WHERE status IN ('delivered','signed')")
signed = c.fetchone()[0]
c.execute("SELECT COUNT(*) FROM sale_order_items")
items = c.fetchone()[0]

c.execute("""
  SELECT COUNT(*) FROM sale_orders so
  WHERE so.status IN ('delivered','signed')
    AND (SELECT COUNT(*) FROM sale_order_items soi WHERE soi.order_id=so.id) > 1
    AND ABS(so.total_amount - COALESCE(
        (SELECT SUM(soi.amount) FROM sale_order_items soi WHERE soi.order_id=so.id),0)) > 0.005
""")
mismatch = c.fetchone()[0]

c.execute("""
  SELECT COUNT(*) FROM sale_orders so
  WHERE so.status IN ('delivered','signed')
    AND (SELECT COUNT(*) FROM sale_order_items soi WHERE soi.order_id=so.id) > 1
""")
multi = c.fetchone()[0]

c.execute("""
  SELECT SUM(so.total_amount) FROM sale_orders so
  LEFT JOIN sale_order_items soi ON soi.order_id=so.id
  WHERE so.status IN ('delivered','signed')
""")
join_sum = c.fetchone()[0] or 0

c.execute("""
  SELECT COALESCE(SUM(t.s),0) FROM (
    SELECT so.id,
           (SELECT SUM(soi.amount) FROM sale_order_items soi WHERE soi.order_id=so.id) AS s
    FROM sale_orders so WHERE so.status IN ('delivered','signed')
  ) t
""")
true_sum = c.fetchone()[0] or 0

# 商品维度实例：JOIN 口径下某个商品的"收入"（会被同单其他商品行放大）
c.execute("""
  SELECT soi.product_id, SUM(so.total_amount) AS join_rev, SUM(soi.amount) AS true_rev
  FROM sale_orders so
  JOIN sale_order_items soi ON soi.order_id=so.id
  WHERE so.status IN ('delivered','signed')
  GROUP BY soi.product_id
  HAVING ABS(SUM(so.total_amount) - SUM(soi.amount)) > 0.005
  ORDER BY (SUM(so.total_amount) - SUM(soi.amount)) DESC LIMIT 3
""")
rows = c.fetchall()

print("signed_orders=%d  items=%d  multi_item_orders=%d" % (signed, items, multi))
print("mismatch_orders(total != items_sum)=%d" % mismatch)
print("JOIN口径收入=%.2f  正确口径收入=%.2f  虚增=%.2f (%.1f%%)"
      % (join_sum, true_sum, join_sum - true_sum,
         (join_sum - true_sum) / true_sum * 100 if true_sum else 0))
print("--- 商品维度实例（JOIN 口径 vs 真实，仅列有差异的前 3）---")
for pid, jr, tr in rows:
    print("product_id=%s  JOIN口径=%.2f  真实=%.2f  虚增=%.2f" % (pid, jr, tr, jr - tr))
con.close()
