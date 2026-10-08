#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从 dist 目录（或线上副本）里取「index.html 引用闭包」——只保留本次构建真正在用的 chunk。

为什么要它：生产 `assets/` 是**历次构建的并集**（memory/topics/deploy-ops.md），
拿并集当基线会让「仅新增」判据失去判别力（基线越大越容易假阴性）。
用法: python3 dist-closure.py <src_dist> <dst_dir>
"""
import os
import re
import shutil
import sys

src, dst = sys.argv[1], sys.argv[2]
assets = os.path.join(src, 'assets')

clos = set()
# ① index.html 直接引用的
html = open(os.path.join(src, 'index.html'), encoding='utf-8').read()
for m in re.finditer(r'(?:src|href)="([^"]+)"', html):
    u = m.group(1)
    if u.startswith('/assets/'):
        clos.add(os.path.basename(u))

# ② 传递闭包：从每个文件里抓 ./Name-hash.js|css 形式的相对引用
REF = re.compile(r'\./([A-Za-z0-9_\-\.]+-[A-Za-z0-9_\-]{8}\.(?:js|css))')
changed = True
while changed:
    changed = False
    for name in list(clos):
        p = os.path.join(assets, name)
        if not os.path.exists(p):
            continue
        try:
            t = open(p, encoding='utf-8', errors='ignore').read()
        except Exception:
            continue
        for r in REF.findall(t):
            if r not in clos and os.path.exists(os.path.join(assets, r)):
                clos.add(r)
                changed = True

if os.path.isdir(dst):
    shutil.rmtree(dst)
os.makedirs(os.path.join(dst, 'assets'))
shutil.copy2(os.path.join(src, 'index.html'), os.path.join(dst, 'index.html'))
for n in sorted(clos):
    s = os.path.join(assets, n)
    if os.path.exists(s):
        shutil.copy2(s, os.path.join(dst, 'assets', n))

print('%s → %s：闭包 %d 个 chunk（目录内共 %d 个）'
      % (src, dst, len(clos), len(os.listdir(assets))))
