#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""解析 nginx access log（含轮转），把真实浏览器(非 Headless/非 curl/node)的 /api/forecast* 请求按时间列出。"""
import gzip, glob, re, sys, collections

LINE = re.compile(
    r'^(?P<ip>\S+) \S+ \S+ \[(?P<t>[^\]]+)\] "(?P<method>\S+) (?P<path>\S+) [^"]*" '
    r'(?P<status>\d{3}) (?P<size>\S+) "(?P<ref>[^"]*)" "(?P<ua>[^"]*)"'
)

def openf(p):
    return gzip.open(p, 'rt', errors='replace') if p.endswith('.gz') else open(p, errors='replace')

rows = []
for p in sorted(glob.glob('/var/log/nginx/access.log*')):
    for ln in openf(p):
        m = LINE.match(ln)
        if not m:
            continue
        d = m.groupdict()
        ua = d['ua']
        if 'Headless' in ua or 'curl' in ua or ua == 'node' or 'python' in ua.lower():
            kind = 'PROBE'
        else:
            kind = 'BROWSER'
        rows.append((d['t'], kind, d['method'], d['path'], d['status'], d['ip']))

# 只看 9/17 之后
sel = [r for r in rows if '/2026' in r[0] and (r[0].startswith('17/Sep') or r[0].startswith('18/Sep') or r[0].startswith('19/Sep'))]

print('=== 9/17-9/19 期间 /api/forecast* 请求：按 时间 分组，标出 BROWSER vs PROBE ===')
api = [r for r in sel if '/api/forecast' in r[3] or '/api/products' in r[3]]
buckets = collections.OrderedDict()
for t, kind, meth, path, st, ip in api:
    key = t
    buckets.setdefault(key, []).append((kind, meth, path, st))

prev = None
for t, items in buckets.items():
    has_b = any(i[0] == 'BROWSER' for i in items)
    if not has_b:
        continue
    print('---', t, '  (%d 条)' % len(items))
    for kind, meth, path, st in items:
        print('    %-7s %-4s %-52s %s' % (kind, meth, path, st))

print()
print('=== 统计：按 天 + kind ===')
cnt = collections.Counter()
for t, kind, meth, path, st, ip in sel:
    day = t.split(':')[0]
    if '/api/forecast' in path or '/api/products' in path:
        cnt[(day, kind)] += 1
for k in sorted(cnt):
    print(k, cnt[k])

print()
print('=== save-matrix 全部（含 PROBE），带 UA 类别 ===')
for t, kind, meth, path, st, ip in rows:
    if 'save-matrix' in path:
        print('   ', t, kind, st, ip)
