# -*- coding: utf-8 -*-
"""挑样板商品：蒙牛低温 + 在期次17清单 + 有销售 + 有大单位换算。只读。"""
import sqlite3, os
c = sqlite3.connect("file:/opt/hergent-erp/tenant_1.db?mode=ro&immutable=1", uri=True)

print("== 期次17清单里、蒙牛低温、有换算、有销售的商品（按销量降序 top12）==")
q = """
SELECT p.id, p.name, p.unit, p.order_unit, p.large_unit, p.large_ratio,
       (SELECT COUNT(*) FROM sale_order_items s WHERE s.product_id=p.id) AS n_items,
       (SELECT COALESCE(SUM(s.quantity),0) FROM sale_order_items s WHERE s.product_id=p.id) AS qty
FROM products p
JOIN forecast_import_products i ON i.product_id = p.id AND i.period_id = 17
WHERE p.brand = '蒙牛低温' AND p.large_ratio > 0
ORDER BY qty DESC
LIMIT 12
"""
for r in c.execute(q).fetchall():
    box = (r[7] / r[5]) if r[5] else 0
    print("   id=%-5s %-34s unit=%-3s order=%-3s large=%-3s r=%-5s 明细=%-6s 量=%-9s ≈%s箱"
          % (r[0], r[1][:34], r[2], r[3], r[4], r[5], r[6], r[7], round(box, 1)))

print()
print("== rebate_achievements（达成填报）样例 ==")
cols = [x[1] for x in c.execute("PRAGMA table_info(rebate_achievements)").fetchall()]
print("   cols:", cols)
for r in c.execute("SELECT * FROM rebate_achievements LIMIT 6").fetchall():
    print("   ", dict(zip(cols, r)))
c.close()
