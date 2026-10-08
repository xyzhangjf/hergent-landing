#!/usr/bin/env python3
# 比对：本地某次构建的 dist/assets  vs  生产生效批次（/tmp/prod-batch）
# 判据：归一化后逐字符相等 ⇒ 纯 hash 级联；不等 ⇒ 真实内容改动（必须逐个归因）
import os, re, sys

NORM = re.compile(r'-[A-Za-z0-9_\-]{8}\.(js|css)')
def logical(n):
    m = re.match(r'^(.*)-([A-Za-z0-9_\-]{8})\.(js|css)$', n)
    return (m.group(1), m.group(3)) if m else (n, '')
def norm(p):
    return NORM.sub(r'-X.\1', open(p, 'rb').read().decode('utf-8', 'replace'))

MINE = sys.argv[1] if len(sys.argv) > 1 else '/tmp/v381-iso/dist/assets'
prod = {logical(f): os.path.join('/tmp/prod-batch', f) for f in os.listdir('/tmp/prod-batch')}
mine = {logical(f): os.path.join(MINE, f) for f in os.listdir(MINE)}
print(f"生产生效批次: {len(prod)}  本次构建: {len(mine)}")
op = sorted(set(prod) - set(mine)); oh = sorted(set(mine) - set(prod))
print("仅生产有:", op)
print("仅本地有:", oh)
same = diff = 0; diffs = []
for k in sorted(set(prod) & set(mine)):
    if norm(prod[k]) == norm(mine[k]): same += 1
    else:
        diff += 1; diffs.append((k, os.path.getsize(prod[k]), os.path.getsize(mine[k])))
print(f"\n归一化相同(=零逻辑变化): {same}   真实不同: {diff}")
for k, s1, s2 in diffs:
    print(f"  DIFF {k[0]}.{k[1]}: prod={s1} mine={s2} ({s2-s1:+d} B)")
