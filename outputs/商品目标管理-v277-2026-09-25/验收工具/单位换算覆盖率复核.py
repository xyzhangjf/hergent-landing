#!/usr/bin/env python3
# 只读复核：商品目标「能按箱设目标」的真实分布（v277 后）
# 判据 = domain/unit_convert.py::per_case()，与界面 can_target 同一实现
import sqlite3, sys, collections
sys.path.insert(0, '/opt/hergent-erp')
from domain.unit_convert import per_case

DB = 'file:tenant_1.db?mode=ro'
c = sqlite3.connect(DB, uri=True)
c.row_factory = sqlite3.Row
cols = [r[1] for r in c.execute('PRAGMA table_info(products)')]
need = [x for x in ('id', 'name', 'spec', 'unit', 'large_unit', 'large_ratio', 'status', 'is_active') if x in cols]
rows = c.execute('SELECT %s FROM products' % ','.join(need)).fetchall()

stcol = 'status' if 'status' in cols else ('is_active' if 'is_active' in cols else None)
dist = collections.Counter()
if stcol:
    for r in rows:
        dist[repr(r[stcol])] += 1
print('status 取值分布:', dict(dist))
print('商品总数:', len(rows))

# 判定「启用」：优先 is_active，其次 status ∉ {停用,0}
def enabled(r):
    if 'is_active' in need:
        v = r['is_active']
        if v in (1, '1', True, 'true', '启用'):
            return True
        if v in (0, '0', False, 'false', '停用'):
            return False
    if 'status' in need:
        s = (str(r['status']) or '').strip()
        return s not in ('停用', '0', '', 'false', 'disabled', '已停用')
    return True

lr_of = lambda r: (r['large_ratio'] if 'large_ratio' in need else 0) or 0

def lrf(r):
    v = lr_of(r)
    try:
        return float(v)
    except Exception:
        return 0.0

en = [r for r in rows if enabled(r)]
A = [r for r in en if lrf(r) > 0]
B = [r for r in en if lrf(r) <= 0 and per_case(r['spec'], r['unit'], None) > 0]
C = [r for r in en if lrf(r) <= 0 and per_case(r['spec'], r['unit'], None) <= 0]
print('启用商品: %d  |  A(已有换算 large_ratio>0): %d  |  B(无换算但规格串推得出): %d  |  C(推不出): %d'
      % (len(en), len(A), len(B), len(C)))
print('B 里 large_unit 为空的行数: %d' % sum(1 for r in B if not (r['large_unit'] or '').strip()))
print('B 里 spec 为空的行数: %d' % sum(1 for r in B if not (r['spec'] or '').strip()))
print('C 里 spec 为空的行数: %d' % sum(1 for r in C if not (r['spec'] or '').strip()))
_allmiss = [r for r in rows if lrf(r) <= 0 and per_case(r['spec'], r['unit'], None) <= 0]
_allpars = [r for r in rows if lrf(r) <= 0 and per_case(r['spec'], r['unit'], None) > 0]
print('全量(含停用) 缺换算: 可推=%d 推不出=%d 合计=%d' % (len(_allpars), len(_allmiss), len(_allpars)+len(_allmiss)))
print('--- B 前 8 例 ---')
for r in B[:8]:
    print('  id=%s spec=%r unit=%r large_unit=%r per_case=%s' %
          (r['id'], r['spec'], r['unit'], r['large_unit'], per_case(r['spec'], r['unit'], None)))
