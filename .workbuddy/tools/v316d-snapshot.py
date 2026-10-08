#!/usr/bin/env python3
"""v316d —— 在【生产】上把活库一致性快照到 /tmp，供本地只读比对。

用 sqlite3 backup() API（不是 cp）：活库带 -wal/-shm，直接 cp 会拷到
不一致的中间态。backup() 走 SQLite 自己的一致性页拷贝。

只打印计数（contacts / sale_orders / receivables），不含任何 PII。
"""
import sqlite3, os

SRC = '/opt/hergent-erp/tenant_1.db'
DST = '/tmp/v316d-tenant1-snapshot.db'

if not os.path.exists(SRC):
    print('snapshot_fail: src missing ' + SRC)
    raise SystemExit(1)

if os.path.exists(DST):
    os.remove(DST)

src = sqlite3.connect('file:' + SRC + '?mode=ro', uri=True)
dst = sqlite3.connect(DST)
src.backup(dst)
dst.close()
src.close()

chk = sqlite3.connect(DST)
n_c = chk.execute('SELECT COUNT(*) FROM contacts').fetchone()[0]
n_o = chk.execute('SELECT COUNT(*) FROM sale_orders').fetchone()[0]
n_r = chk.execute('SELECT COUNT(*) FROM receivables').fetchone()[0]
chk.close()

print('snapshot_ok size=%d contacts=%d sale_orders=%d receivables=%d'
      % (os.path.getsize(DST), n_c, n_o, n_r))
