#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v316d 生产冒烟 —— 证明「有应收排前 + 最近下单倒序」在生产库真实数据上成立。

在【重启之前】跑：它 import 的是**磁盘上的生产代码**，因此若这里失败，
只需还原文件、不必重启服务（避免把坏代码带上线）。

只读：不写任何一行。
脱敏：只打印 id / 金额 / 计数，绝不打印客户名 / 电话 / 地址。
"""
import os
import sys

sys.path.insert(0, '/opt/hergent-erp')
os.chdir('/opt/hergent-erp')

from db.queries.contacts import contact_count, contact_list   # noqa: E402
from db.connection import set_tenant_context, get_db          # noqa: E402

set_tenant_context(1)

PASS, FAIL = [], []


def ok(name, cond, detail=''):
    (PASS if cond else FAIL).append(name)
    print(('  [OK]   ' if cond else '  [FAIL] ') + name + ('  | ' + str(detail) if detail else ''))


def ar_of(rows):
    return [float(r.get('ar_balance') or 0) for r in rows]


def lo_of(rows):
    return [(r.get('last_order') or '') for r in rows]


n_cust = contact_count('', 'customer')
n_supp = contact_count('', 'supplier')
print('[COUNT] customer=%d  supplier=%d' % (n_cust, n_supp))
print('')

print('S1 首屏（limit=20）')
first20 = contact_list('', 'customer', limit=20, offset=0)
a20 = ar_of(first20)
n_pos = len([x for x in a20 if x > 0.005])
ok('S1.1 返回 20 行', len(first20) == min(20, n_cust), 'n=%d' % len(first20))
ok('S1.2 前 20 行【全部】是有应收的客户', n_pos == len(first20) and len(first20) > 0,
   '有应收=%d/%d' % (n_pos, len(first20)))
print('    首屏应收结余(元): ' + ','.join('%.2f' % x for x in a20[:10]) + ' ...')

print('')
print('S2 全量前缀性质 + 组内排序')
allc = contact_list('', 'customer', limit=100000, offset=0)
ar_all = ar_of(allc)
lo_all = lo_of(allc)
pos_idx = [i for i, x in enumerate(ar_all) if x > 0.005]
neg_idx = [i for i, x in enumerate(ar_all) if x <= 0.005]
prefix_ok = (not pos_idx) or (not neg_idx) or (max(pos_idx) < min(neg_idx))
ok('S2.1 有应收的行连续排在无应收之前', prefix_ok,
   '有应收=%d 无应收=%d' % (len(pos_idx), len(neg_idx)))
k = len(pos_idx)
pre, suf = lo_all[:k], lo_all[k:]
ok('S2.2 有应收组内按最近下单倒序', all(pre[i] >= pre[i + 1] for i in range(len(pre) - 1)), 'n=%d' % len(pre))
ok('S2.3 无应收组内按最近下单倒序', all(suf[i] >= suf[i + 1] for i in range(len(suf) - 1)), 'n=%d' % len(suf))
ok('S2.4 有应收组非空（否则 S2.1/S2.2 空转）', k > 0, 'n=%d' % k)

print('')
print('S3 供应商列表零影响（应与 id DESC 逐行一致）')
supp = contact_list('', 'supplier', limit=100000, offset=0)
supp_ids = [r['id'] for r in supp]
cache = {}
with get_db() as db:
    old_ids = [r[0] for r in db.execute(
        'SELECT c.id FROM contacts c WHERE c.is_active=1 AND c.type IN (?,?) ORDER BY c.id DESC',
        ('supplier', 'both')).fetchall()]
ok('S3.1 供应商全量新旧逐 id 一致', supp_ids == old_ids, 'n=%d/%d' % (len(supp_ids), len(old_ids)))
s_ar = len([x for x in ar_of(supp) if x > 0.005])
s_lo = len([x for x in lo_of(supp) if x])
print('    （背景）供应商中有应收=%d/%d  last_order 非空=%d/%d' % (s_ar, len(supp), s_lo, len(supp)))
tgt = [i for i, r in enumerate(supp) if r['id'] == 2919]
ok('S3.2 有应收的纯供应商 id=2919 未被提到首位', (not tgt) or tgt[0] != 0, '位置=%s' % tgt)
ok('S3.3 id=2919 确实在列表里（否则 S3.2 空转）', len(tgt) == 1, 'hit=%d' % len(tgt))

print('')
print('S4 分页确定性')
ids_page = []
off = 0
while True:
    rs = contact_list('', 'customer', limit=20, offset=off)
    if not rs:
        break
    ids_page.extend([r['id'] for r in rs])
    if len(rs) < 20:
        break
    off += 20
ok('S4.1 分页序列 == 全量序列', ids_page == [r['id'] for r in allc],
   'paged=%d full=%d' % (len(ids_page), len(allc)))
ok('S4.2 分页无重复', len(set(ids_page)) == len(ids_page), 'uniq=%d' % len(set(ids_page)))

print('')
print('S5 旧排序反例（同库同时刻，证明改动真的生效）')
SQL_OLD = ("SELECT c.id, COALESCE((SELECT SUM(amount-paid_amount) FROM receivables "
           "WHERE contact_id=c.id AND type='ar' AND status!='paid'),0) ar FROM contacts c "
           "WHERE c.is_active=1 AND c.type IN (?,?) ORDER BY c.id DESC LIMIT ?")
with get_db() as db:
    old20 = db.execute(SQL_OLD, ('customer', 'both', 20)).fetchall()
old_pos = len([r[1] for r in old20 if float(r[1] or 0) > 0.005])
ok('S5.1 旧排序前 20 行里有应收的 比 新排序少', old_pos < n_pos, '旧=%d 新=%d' % (old_pos, n_pos))

print('')
print('==== 合计：PASS=%d  FAIL=%d ====' % (len(PASS), len(FAIL)))
for f in FAIL:
    print('  - ' + f)
sys.exit(0 if not FAIL else 1)
