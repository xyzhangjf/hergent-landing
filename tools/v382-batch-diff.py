#!/usr/bin/env python3
# v382：本次隔离构建  vs  基线（v381-iso/dist = 当前线上生效态）
# 判据：归一化（把 -<hash>.ext 抹成 -X.ext）后逐字符相等 ⇒ 纯 hash 级联；
#       不等 ⇒ 真实内容改动，必须逐个归因（是"我的"还是"夹带"）。
import os, re, sys

BASE = sys.argv[1] if len(sys.argv) > 1 else '/tmp/v381-iso/dist/assets'
MINE = sys.argv[2] if len(sys.argv) > 2 else '/tmp/v382-iso/dist/assets'

NORM = re.compile(r'-[A-Za-z0-9_\-]{8}\.(js|css)')

def logical(n):
    m = re.match(r'^(.*)-([A-Za-z0-9_\-]{8})\.(js|css)$', n)
    return (m.group(1), m.group(3)) if m else (n, '')

def norm(p):
    return NORM.sub(r'-X.\1', open(p, 'rb').read().decode('utf-8', 'replace'))

base = {logical(f): os.path.join(BASE, f) for f in os.listdir(BASE)}
mine = {logical(f): os.path.join(MINE, f) for f in os.listdir(MINE)}
print(f"基线(当前线上): {len(base)}   本次构建: {len(mine)}")
only_base = sorted(set(base) - set(mine))
only_mine = sorted(set(mine) - set(base))
print(f"仅基线有(会丢失): {only_base}")
print(f"仅本次有(新引入): {only_mine}")

same = diff = 0
diffs = []
for k in sorted(set(base) & set(mine)):
    if norm(base[k]) == norm(mine[k]):
        same += 1
    else:
        diff += 1
        diffs.append((k, os.path.getsize(base[k]), os.path.getsize(mine[k])))

print(f"\n归一化相同(=零逻辑变化): {same}   真实不同: {diff}")
for k, s1, s2 in diffs:
    print(f"  DIFF {k[0]}.{k[1]}: 基线={s1} 本次={s2} ({s2 - s1:+d} B)")
