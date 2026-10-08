#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v316d HTTP 层验证 —— 证明【监听中的服务进程】真的在用新排序。

与函数层（v316d-prod-smoke.py）的区别：那个 import 磁盘代码，
这个打真实 HTTP 接口 ⇒ 只有重启后加载新代码才可能通过。

脱敏：只取 id 与金额，**不打印 name / phone / address**。
"""
import json
import ssl
import sys
import urllib.request

TOK = open('/tmp/hg_tok.txt').read().strip()
CTX = ssl._create_unverified_context()


def get(path):
    req = urllib.request.Request(
        'https://127.0.0.1' + path,
        headers={'Host': 'hergent.cn', 'Authorization': 'Bearer ' + TOK})
    return json.loads(urllib.request.urlopen(req, timeout=25, context=CTX).read().decode())


PASS, FAIL = [], []


def ok(name, cond, detail=''):
    (PASS if cond else FAIL).append(name)
    print(('  [OK]   ' if cond else '  [FAIL] ') + name + ('  | ' + str(detail) if detail else ''))


c = get('/api/contacts?type=customer&limit=5')
s = get('/api/contacts?type=supplier&limit=5')
c20 = get('/api/contacts?type=customer&limit=20')

c_ids = [r['id'] for r in c['items']]
c_ar = [round(float(r['ar_balance'] or 0), 2) for r in c['items']]
s_ids = [r['id'] for r in s['items']]
c20_ar = [float(r['ar_balance'] or 0) for r in c20['items']]

print('客户 total=%d  前5 (id, 应收元)=%s' % (c['total'], list(zip(c_ids, c_ar))))
print('供应商 total=%d 前5 id=%s' % (s['total'], s_ids))
print('')

ok('H1 客户前 5 行【全部】有应收（旧代码不可能做到：旧按建档时间倒序）',
   len(c_ar) == 5 and all(x > 0.005 for x in c_ar), c_ar)
ok('H2 客户前 20 行全部有应收', len(c20_ar) == 20 and all(x > 0.005 for x in c20_ar),
   '有应收=%d/20' % len([x for x in c20_ar if x > 0.005]))
ok('H3 客户总数 = 702（分页信封的 total 未被排序改动影响）', c['total'] == 702, c['total'])
ok('H4 供应商前 5 id 严格递减（= 旧行为 id DESC，零影响）',
   all(s_ids[i] > s_ids[i + 1] for i in range(len(s_ids) - 1)), s_ids)
ok('H5 供应商总数 = 38', s['total'] == 38, s['total'])
ok('H6 返回结构仍是 {items,total}（未被改动破坏）',
   isinstance(c.get('items'), list) and 'total' in c, list(c.keys()))
ok('H7 每行都带 ar_balance 且为数值（前端「应收余额」列依赖该字段）',
   len(c20['items']) == 20 and all(isinstance(r.get('ar_balance'), (int, float)) for r in c20['items']),
   '缺失=%d' % len([r for r in c20['items'] if not isinstance(r.get('ar_balance'), (int, float))]))

print('')
print('==== 合计：PASS=%d  FAIL=%d ====' % (len(PASS), len(FAIL)))
for f in FAIL:
    print('  - ' + f)
sys.exit(0 if not FAIL else 1)
