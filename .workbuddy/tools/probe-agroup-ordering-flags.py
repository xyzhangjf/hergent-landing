# -*- coding: utf-8 -*-
"""A 组二次侦察（只读）：系统里有没有现成字段能标记"这是下单档案、不参与销售"。
重点看 can_sale / can_purchase / ordering_entity / order_unit —— 不查任何价格（脱敏红线）。
"""
import sqlite3

DB = '/opt/hergent-erp/tenant_1.db'
IDS = [1439, 1535, 1537, 1538, 1541, 1542, 1547, 1549, 1550, 1551, 1552,
       1557, 1558, 1561, 1566, 1569, 1573, 1580, 1584, 1586]

con = sqlite3.connect(f'file:{DB}?mode=ro', uri=True)
con.text_factory = lambda b: b.decode('utf-8', 'replace')
cur = con.cursor()

Q = ('can_sale', 'can_purchase', 'can_return', 'ordering_entity', 'order_unit',
     'unit', 'medium_unit', 'large_unit', 'is_active', 'source')

print('=== 1. A 组 20 个：销售/采购开关 与 下单户头字段 ===')
print(f"{'id':>5} | {'可销售':>4} | {'可采购':>4} | {'可退':>4} | {'活跃':>4} | {'单位':<4} | {'中单位':<6} | {'大单位':<6} | {'下单户头':<10} | {'下单单位':<6}")
r = cur.execute(f"SELECT id, name, {','.join(Q)} FROM products WHERE id IN ({','.join('?'*len(IDS))})", IDS).fetchall()
for row in r:
    pid, name = row[0], row[1]
    v = dict(zip(Q, row[2:]))
    print(f"{pid:>5} | {str(v['can_sale']):>4} | {str(v['can_purchase']):>4} | {str(v['can_return']):>4} "
          f"| {str(v['is_active']):>4} | {str(v['unit']):<4} | {str(v['medium_unit']):<6} | {str(v['large_unit']):<6} "
          f"| {str(v['ordering_entity']):<10} | {str(v['order_unit']):<6}")

print('\n=== 2. 全库 ordering_entity 取值分布（看福宝/恒滋有没有被系统记录）===')
for k, c in cur.execute("SELECT COALESCE(ordering_entity,'<空>') AS oe, COUNT(*) AS c FROM products GROUP BY oe ORDER BY c DESC LIMIT 12"):
    print(f"  {k}: {c} 个商品")

print('\n=== 3. 全库 can_sale 分布（有多少档案被标了"不可销售"）===')
for k, c in cur.execute("SELECT COALESCE(can_sale,'<空>') AS cs, COUNT(*) AS c FROM products GROUP BY cs ORDER BY c DESC"):
    print(f"  can_sale={k}: {c} 个")

print('\n=== 4. 下单侧档案家族规模估算（名字含下单/到货/排期标记 且 生命周期零销售）===')
n = cur.execute("""
  SELECT COUNT(*) FROM products p
  WHERE p.is_active=1
    AND (p.name LIKE '%下单%' OR p.name LIKE '%到货%' OR p.name LIKE '%排期%' OR p.name LIKE '%发货%')
    AND NOT EXISTS (SELECT 1 FROM sale_order_items s WHERE s.product_id = p.id)
""").fetchone()[0]
print(f"  活跃 + 名字带下单/到货/排期/发货标记 + 生命周期零销售 = {n} 个商品")
print('  （这些就是"下单侧档案"家族的真实规模）')

con.close()
