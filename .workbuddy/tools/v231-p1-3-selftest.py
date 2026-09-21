#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v231 P1-3 内存库功能反证：渠道价三级单位价 + 按报单单位选档。

为什么用内存库而不是「读代码心算」：
  · 目标是证明 **① 三档能写进去且部分更新不误清**、**② 按单位名能选对档**、
    **③ 不传 unit / 认不出单位时逐字节回到旧行为**（这就是「零变化」的定义）。
  · 同时证明**反例真的会红**（空单位名不得误命中、只给中档时不得清掉小档）。

手法：把 `db.connection.get_db` / `db.queries.products` 换成桩，再 import 真身 `prices.py`
（不连任何真实库、不碰生产）。
"""
import contextlib
import sqlite3
import sys
import types

SRV = '/Users/zhangjunfeng/Documents/hergent-erp/server'
sys.path.insert(0, SRV)

CONN = sqlite3.connect(':memory:')
CONN.row_factory = sqlite3.Row


@contextlib.contextmanager
def _get_db():
    yield CONN


# ---- 桩：不碰真实连接与迁移 ----
m = types.ModuleType('db')
m.__path__ = [SRV + '/db']
sys.modules['db'] = m
m_q = types.ModuleType('db.queries')
m_q.__path__ = [SRV + '/db/queries']
sys.modules['db.queries'] = m_q
m_c = types.ModuleType('db.connection')
m_c.get_db = _get_db
sys.modules['db.connection'] = m_c
m_p = types.ModuleType('db.queries.products')
m_p.factory_price_sql = lambda alias='products': 'COALESCE(%s.factory_price,0)' % alias
sys.modules['db.queries.products'] = m_p

import db.queries.prices as P  # noqa: E402

fail = []


def expect(name, got, want):
    ok = got == want
    print('  %s %-52s got=%r want=%r' % ('ok ' if ok else 'BAD', name, got, want))
    if not ok:
        fail.append(name)


# ---- 建表（= v231 迁移后的结构）----
CONN.executescript("""
CREATE TABLE product_channel_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER DEFAULT 0,
  product_id INTEGER NOT NULL, channel_id INTEGER NOT NULL,
  external_code TEXT DEFAULT '', price REAL DEFAULT 0, updated_at TEXT,
  small_unit_price REAL DEFAULT 0, medium_unit_price REAL DEFAULT 0,
  large_unit_price REAL DEFAULT 0,
  UNIQUE(tenant_id, product_id, channel_id));
CREATE TABLE products (
  id INTEGER PRIMARY KEY, name TEXT, unit TEXT, medium_unit TEXT, large_unit TEXT,
  barcode TEXT DEFAULT '', spec TEXT DEFAULT '', brand TEXT DEFAULT '',
  product_code TEXT DEFAULT '',
  factory_price REAL DEFAULT 0, dist_price REAL DEFAULT 0, is_active INTEGER DEFAULT 1);
INSERT INTO products (id,name,unit,medium_unit,large_unit) VALUES (1,'蒙牛纯甄','瓶','桶','箱');
INSERT INTO products (id,name,unit,medium_unit,large_unit) VALUES (2,'两级商品','袋','','');
""")
CH = {"id": 7, "price_source": "matrix"}

print('① 单位名 → 档位（含反证：空名永不匹配）')
expect('桶 → medium', P._tier_of_unit('桶', '瓶', '桶', '箱'), 'medium')
expect('箱 → large', P._tier_of_unit('箱', '瓶', '桶', '箱'), 'large')
expect('瓶 → small', P._tier_of_unit('瓶', '瓶', '桶', '箱'), 'small')
expect('袋（不在三档里）→ None', P._tier_of_unit('袋', '瓶', '桶', '箱'), None)
expect('空 unit → None', P._tier_of_unit('', '瓶', '桶', '箱'), None)
expect('空名不得被命中（两级商品的 medium_unit=空）', P._tier_of_unit('', '', '', ''), None)
expect('空白 unit → None', P._tier_of_unit('   ', '瓶', '桶', '箱'), None)

print('② 旧行为：只给小单位价（= 老调用方的写法）')
r = P.set_channel_matrix(7, [{"product_id": 1, "price": 9.9}])
row = dict(CONN.execute("SELECT * FROM product_channel_prices WHERE product_id=1 AND channel_id=7").fetchone())
expect('updated', r['updated'], 1)
expect('price ← 9.9', row['price'], 9.9)
expect('不变量 small == price', row['small_unit_price'], 9.9)
expect('中档未被误写', row['medium_unit_price'], 0)
expect('大档未被误写', row['large_unit_price'], 0)
expect('不传 unit ⇒ 取主列（零变化）', P.resolve_channel_price(1, CH)[0], 9.9)
expect('可识别单位但该档未录 ⇒ 退回主列', P.resolve_channel_price(1, CH, '箱')[0], 9.9)

print('③ 三档写入 + 按单位选档')
r = P.set_channel_matrix(7, [{"product_id": 1, "small_unit_price": 2.0,
                              "medium_unit_price": 40.0, "large_unit_price": 80.0}])
expect('updated', r['updated'], 1)
expect('瓶/小 → 2.0', P.resolve_channel_price(1, CH, '瓶')[0], 2.0)
expect('桶/中 → 40.0', P.resolve_channel_price(1, CH, '桶')[0], 40.0)
expect('箱/大 → 80.0', P.resolve_channel_price(1, CH, '箱')[0], 80.0)
expect('认不出的单位 ⇒ 退回主列 2.0', P.resolve_channel_price(1, CH, '提')[0], 2.0)
expect('不传 unit ⇒ 主列 2.0', P.resolve_channel_price(1, CH)[0], 2.0)
expect('missing 判据仍按最终值', P.resolve_channel_price(1, CH, '箱')[2], False)

print('④ 🔴 部分更新不得误清其余档（v228 那个 INSERT OR REPLACE 病的同款反证）')
P.set_channel_matrix(7, [{"product_id": 1, "medium_unit_price": 45.0}])
row = dict(CONN.execute("SELECT * FROM product_channel_prices WHERE product_id=1 AND channel_id=7").fetchone())
expect('中档被改成 45', row['medium_unit_price'], 45.0)
expect('小档保持 2.0（未被清零）', row['small_unit_price'], 2.0)
expect('price 保持 2.0（未被清零）', row['price'], 2.0)
expect('大档保持 80.0（未被清零）', row['large_unit_price'], 80.0)
expect('external_code 未被动', row['external_code'], '')

print('⑤ 两级商品：中/大单位名为空 ⇒ 永不误命中')
P.set_channel_matrix(7, [{"product_id": 2, "small_unit_price": 5.0, "large_unit_price": 60.0}])
expect('袋/小 → 5.0', P.resolve_channel_price(2, CH, '袋')[0], 5.0)
expect('空单位名 → 退回主列 5.0（不得命中「大」）', P.resolve_channel_price(2, CH, '')[0], 5.0)

print('⑥ 无值即跳过（不得产生空行）+ 列表接口带上三档')
r = P.set_channel_matrix(7, [{"product_id": 1}])
expect('全空 ⇒ skipped=1 / updated=0', (r['updated'], r['skipped']), (0, 1))
mx = P.matrix_for_channel(7, limit=10)
it = [x for x in mx['items'] if x['id'] == 1][0]
expect('列表带 small_unit_price', it['small_unit_price'], 2.0)
expect('列表带 medium_unit_price', it['medium_unit_price'], 45.0)
expect('列表带 large_unit_price', it['large_unit_price'], 80.0)
expect('列表仍带 price', it['price'], 2.0)

print()
print('自证通过 ✓' if not fail else '自证未通过 ✗ %d 项：%s' % (len(fail), fail))
sys.exit(1 if fail else 0)
