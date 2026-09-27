#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""本地 dist 的每个产物 vs 生产 /opt/hergent-cn-v2 的对应文件 —— 逐个 md5 比对。

判据：本地 53 个产物 + index.html **全部在生产上存在且 hash 逐字节相同** ⇒
      生产跑的就是本地这份构建的产物（无需重新上传）。

为什么要这么做，而不是「直接 rsync 一遍」：
  · 生产 `assets/` 是**历次构建的并集**（本地 53 个 vs 生产 308 个）——
    上传时绝不 `--delete`，所以两边的文件集合本来就不同，目录级 diff 无意义。
  · 本轮 v286 → v288 只改了注释里的版本号字样，被压缩抹掉 ⇒ 产物应完全不变。
    那就**用证据证明它没变**，而不是无意义地重传一遍（重传 = 凭空引入风险）。
"""

import sys

LOCAL = "/tmp/v288/local.md5"
PROD = "/tmp/v288/prod.md5"


def load(p):
    out = {}
    for line in open(p, encoding="utf-8"):
        parts = line.split()
        if len(parts) >= 2:
            out[parts[-1]] = parts[0]
    return out


loc = load(LOCAL)
prod = load(PROD)

same, miss, diff = [], [], []
for name, h in sorted(loc.items()):
    ph = prod.get(name)
    if ph is None:
        miss.append((name, h))
    elif ph == h:
        same.append(name)
    else:
        diff.append((name, h, ph))

print("=" * 78)
print("本地产物 %d 个 / 生产索引 %d 个" % (len(loc), len(prod)))
print("=" * 78)
print()
print("【存在且 hash 相同】%d 个" % len(same))
if diff:
    print()
    print("【hash 不同】%d 个 —— 生产是旧版本，必须重新上传" % len(diff))
    for n, a, b in diff:
        print("   %-46s 本地 %s  生产 %s" % (n, a[:12], b[:12]))
if miss:
    print()
    print("【生产上不存在】%d 个 —— 必须上传" % len(miss))
    for n, h in miss:
        print("   %-46s %s" % (n, h))

print()
print("=" * 78)
if not diff and not miss:
    print("结论：本地 53 个产物 + index.html 在生产上**逐字节齐全**")
    print("      ⇒ 生产跑的就是这份构建的产物，**无需重新上传**")
else:
    print("结论：存在差异 ⇒ 需要上传")
sys.exit(0)
