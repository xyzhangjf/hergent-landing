"""v689：只读查 products 表索引与关键列默认值（不写库）。"""
import sqlite3

c = sqlite3.connect('/opt/hergent-erp/tenant_1.db')
print('== products 索引 ==')
for r in c.execute("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='products'"):
    print(' ', r[0], '|', r[1])
print('== 关键列 ==')
want = {'name', 'unit', 'can_sale', 'can_return', 'can_purchase',
        'mobile_order_units', 'is_active', 'barcode', 'order_seq', 'min_order_qty'}
for r in c.execute('PRAGMA table_info(products)'):
    if r[1] in want:
        print('  %-20s default=%-8r notnull=%s' % (r[1], r[4], r[3]))
print('== 同名商品有多少组 ==')
n = c.execute("SELECT COUNT(*) FROM (SELECT name FROM products GROUP BY name HAVING COUNT(*)>1)").fetchone()[0]
print('  重名组数 =', n)
print('== 现有启用商品数 ==')
print('  ', c.execute('SELECT COUNT(*) FROM products WHERE is_active=1').fetchone()[0])
