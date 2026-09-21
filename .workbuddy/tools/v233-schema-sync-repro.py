# -*- coding: utf-8 -*-
"""v233 复验：租户库缺 `products.order_unit` 时，**启动期列对账**是否会自动补列。

为什么要单独复验：这一条是上线后「列真的到了租户库」的**唯一正面判据**
（`[schema-sync] tenant_N.db 补列(+1): ['products.order_unit']`）。
不能靠「接口没报错」推断 —— 那是负判据。

构造法：把租户库的 `order_unit` **改名**（SQLite 3.25+ 支持 RENAME COLUMN）
⇒ 等价于「一个还没见过新主库 schema 的旧租户库」。多一列不影响对账（对账只加不删）。
"""
import logging
import os
import shutil
import sqlite3
import sys

SRC = '/tmp/v233-dryrun'
DST = '/tmp/v233-synctest'
SRV = '/Users/zhangjunfeng/Documents/hergent-erp/server'

shutil.rmtree(DST, ignore_errors=True)
os.makedirs(DST)
shutil.copy(SRC + '/erp.db', DST + '/erp.db')
shutil.copy(SRC + '/tenant_1.db', DST + '/tenant_1.db')

# ---- 造「旧租户库」：改名掉 order_unit ----
c = sqlite3.connect(DST + '/tenant_1.db')
c.execute('ALTER TABLE products RENAME COLUMN order_unit TO order_unit_OLD')
c.commit()
cols = [r[1] for r in c.execute('PRAGMA table_info(products)')]
print('[setup] 改名后 order_unit 在列里? %s ；order_unit_OLD 在列里? %s'
      % ('order_unit' in cols, 'order_unit_OLD' in cols))
c.close()

# ---- 起服务式 schema 对账（真身） ----
sys.path.insert(0, SRV)
os.environ['ERP_DB_PATH'] = DST + '/erp.db'
os.environ['ERP_SECRET'] = 'local-dryrun-only-not-a-real-secret-000000'

_logs = []


class _Cap(logging.Handler):
    def emit(self, rec):
        _logs.append(rec.getMessage())


logging.getLogger().addHandler(_Cap())
logging.getLogger().setLevel(logging.INFO)

import erp_db as db        # noqa: E402

db.init_db()
try:
    db._ensure_tenant_module_tables()
except Exception as e:
    print('[warn] _ensure_tenant_module_tables 抛错（不代表失败）：%s' % e)

print()
print('=' * 90)
print('捕获到的 [schema-sync] 日志行')
print('=' * 90)
hit = [m for m in _logs if 'schema-sync' in m]
for m in hit:
    print('  ' + m)
if not hit:
    print('  （无 schema-sync 日志）')

print()
c = sqlite3.connect(DST + '/tenant_1.db')
cols = [r[1] for r in c.execute('PRAGMA table_info(products)')]
ok = 'order_unit' in cols
dflt = None
if ok:
    for r in c.execute('PRAGMA table_info(products)'):
        if r[1] == 'order_unit':
            dflt = r[4]
c.close()
print('=' * 90)
print('结论')
print('=' * 90)
print('  租户库 order_unit 列：%s' % ('已补上 ✓' if ok else '仍缺失 ✗'))
print('  默认值：%r' % dflt)
pos = any("补列(+1): ['products.order_unit']" in m for m in hit)
print('  正面判据（启动日志出现 `补列(+1): [\'products.order_unit\']`）：%s'
      % ('命中 ✓' if pos else '未命中 ✗'))
print('  原列 order_unit_OLD 仍在（对账只加不删）：%s'
      % ('是 ✓' if 'order_unit_OLD' in cols else '否'))
sys.exit(0 if (ok and pos) else 1)
