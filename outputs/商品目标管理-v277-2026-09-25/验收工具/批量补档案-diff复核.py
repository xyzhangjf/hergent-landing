#!/usr/bin/env python3
# 只读 diff：v264 批量补换算（large_ratio / large_unit）到底改了几行、改成什么
import sqlite3

NEW = 'file:/opt/hergent-erp/tenant_1.db?mode=ro'
OLD = 'file:/opt/hergent-erp/backups/2026-09-25/tenant_1.db.bak-v264-largeRatio-20260925-222042?mode=ro'
RBK = 'file:/opt/hergent-erp/backups/2026-09-25/tenant_1.db.bak-v264-rollbackJian-20260925-222305?mode=ro'

def load(uri):
    c = sqlite3.connect(uri, uri=True)
    c.row_factory = sqlite3.Row
    out = {}
    for r in c.execute('SELECT id, name, spec, unit, large_unit, large_ratio FROM products'):
        out[r['id']] = dict(r)
    c.close()
    return out

old, new, rbk = load(OLD), load(NEW), load(RBK)
print('行数: old=%d new=%d rollback时点=%d' % (len(old), len(new), len(rbk)))

changed = []
for pid, o in old.items():
    n = new.get(pid)
    if not n:
        continue
    if (o['large_unit'] or '') != (n['large_unit'] or '') or float(o['large_ratio'] or 0) != float(n['large_ratio'] or 0):
        changed.append((pid, o, n))
print('=== 相对 pre-backfill：净改动的行数 = %d ===' % len(changed))
from collections import Counter
c = Counter((o['unit'], n['large_unit'], n['large_ratio']) for _, o, n in changed)
for k, v in c.most_common(12):
    print('  unit=%r -> large_unit=%r ratio=%s  : %d 行' % (k[0], k[1], k[2], v))

# 回滚时点 vs 现在：证明那 21 行确实被还原
back = []
for pid, r in rbk.items():
    n = new.get(pid)
    if n and (float(r['large_ratio'] or 0) != float(n['large_ratio'] or 0) or (r['large_unit'] or '') != (n['large_unit'] or '')):
        back.append((pid, r, n))
print('=== 回滚时点(22:23) vs 现在：仍不同的行数 = %d（= 被回滚的 21 行） ===' % len(back))
for pid, r, n in back[:25]:
    print('  id=%s unit=%r large_unit %r->%r  ratio %s->%s' %
          (pid, n['unit'], r['large_unit'], n['large_unit'], r['large_ratio'], n['large_ratio']))
