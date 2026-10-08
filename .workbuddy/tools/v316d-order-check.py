#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v316d 顺序实测 —— 直接看生产接口前 20 行的 (id, ar_balance, last_order) 并断言组内倒序。

动机：截图上「唐成(06-29)」排在「永辉民发店(09-25)」之前，与 `last_order DESC` 不符，
      而离线断言却 PASS ⇒ 必须实测到底哪边对。
只打印 id / 金额 / 日期（不打印客户名 / 电话）。
"""
import json
import ssl
import sys
import urllib.request

TOK = open('/tmp/hg_tok.txt').read().strip()
CTX = ssl._create_unverified_context()


def get(p):
    req = urllib.request.Request('https://127.0.0.1' + p,
                                headers={'Host': 'hergent.cn', 'Authorization': 'Bearer ' + TOK})
    return json.loads(urllib.request.urlopen(req, timeout=25, context=CTX).read().decode())


r = get('/api/contacts?type=customer&limit=20')
items = r['items']
print('total=%d  返回=%d 行' % (r['total'], len(items)))
print('')
print(' %-3s %-6s %-14s %s' % ('#', 'id', '应收(元)', '最近下单(last_order 原值)'))
for i, it in enumerate(items):
    print(' %-3d %-6s %-14.2f [%s]' % (i + 1, it['id'], float(it.get('ar_balance') or 0),
                                       it.get('last_order')))

los = [(it.get('last_order') or '') for it in items]
ars = [float(it.get('ar_balance') or 0) for it in items]

print('')
bad = [(i + 1, los[i], los[i + 1]) for i in range(len(los) - 1) if los[i] < los[i + 1]]
print('组内「最近下单倒序」违例数 = %d' % len(bad))
for i, a, b in bad[:6]:
    print('   第%d→%d 行: [%s]  <  [%s]   ← 顺序反了' % (i, i + 1, a, b))
print('前 20 行应收全对 = %s（有应收=%d/20）'
      % (all(x > 0.005 for x in ars), len([x for x in ars if x > 0.005])))

# 字典序自证：若字符串比较与「按时间比较」不一致，说明 date 格式不统一
import datetime


def parse(s):
    for f in ('%Y-%m-%d %H:%M:%S', '%Y-%m-%d'):
        try:
            return datetime.datetime.strptime(s, f)
        except Exception:
            pass
    return None


parsed = [parse(x) for x in los]
unparsable = [los[i] for i, p in enumerate(parsed) if p is None and los[i]]
print('')
print('无法按 YYYY-MM-DD[ HH:MM:SS] 解析的行数 = %d %s'
      % (len(unparsable), ('例: ' + str(unparsable[:3])) if unparsable else ''))
if all(p is not None for p in parsed):
    real_bad = [(i + 1, los[i], los[i + 1]) for i in range(len(parsed) - 1) if parsed[i] < parsed[i + 1]]
    print('按【真实时间】比较的违例数 = %d  （与字典序违例数 %d 是否一致: %s）'
          % (len(real_bad), len(bad), len(real_bad) == len(bad)))
    print('⇒ 两者不一致 = 库里有非 ISO 格式的 order_date，字典序会排错' if len(real_bad) != len(bad) else '⇒ 两种比较一致')
sys.exit(0 if not bad else 1)
