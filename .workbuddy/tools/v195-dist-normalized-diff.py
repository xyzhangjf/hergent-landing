#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""部署后差集核查（v195）：抹平三类构建期派生名后逐字节比对，证明「真变化只有 Forecast 两项」。

三类噪声（缺一条必假阳性）：
  ① chunk 名 hash        Xxx-B8x2rYFo.js        → 源码图任何变化会连锁改写引用它的 chunk
  ② Vue scoped scopeId   data-v-53fd6f8d         → = hash(路径 + **源码全文**)[:8]，改一个字符就变
  ③ scoped keyframes 名  sk-53fd6f8d             → 由 scopeId 派生，同生同灭
⚠️ scopeId 是 base36（含 g-z），正则写 [0-9a-f] 会漏匹配。
"""
import os
import re
import sys

LOCAL = sys.argv[1]          # 本地 dist/assets
ONLINE = sys.argv[2]         # 部署前线上 assets 快照

HASH = re.compile(rb"-([A-Za-z0-9_-]{8})\.(js|css|svg|woff2?|png)")


def norm_bytes(p):
    b = open(p, "rb").read()
    b = HASH.sub(rb".\2", b)                       # ① chunk 名 hash
    b = re.sub(rb"data-v-[0-9a-z]+", rb"data-v-X", b)   # ② Vue scopeId
    b = re.sub(rb"sk-[0-9a-z]{8}", rb"sk-X", b)    # ③ scoped keyframes
    return b


def base_norm(name):
    """归一化后的配对基名（去掉 hash）。"""
    m = re.match(r"^(.*?)-([A-Za-z0-9_-]{8})\.(js|css|svg|woff2?|png)$", name)
    return (m.group(1) + "." + m.group(3)) if m else name


def load(d):
    out = {}
    for n in sorted(os.listdir(d)):
        p = os.path.join(d, n)
        if os.path.isfile(p):
            out[n] = p
    return out


lc, on = load(LOCAL), load(ONLINE)
lb = {base_norm(n): n for n in lc}
ob = {base_norm(n): n for n in on}

print("本地 %d 个文件 / 线上快照 %d 个文件" % (len(lc), len(on)))
print("")

only_local = sorted(set(lb) - set(ob))
only_online = sorted(set(ob) - set(lb))
print("① 仅本地有（新增）: %s" % (only_local or "无"))
print("② 仅线上有（将被 --delete 删除）: %s" % (only_online or "无"))
print("")

same_bytes = diff_bytes = real = 0
real_list = []
for b in sorted(set(lb) & set(ob)):
    p1, p2 = lc[lb[b]], on[ob[b]]
    s1, s2 = os.path.getsize(p1), os.path.getsize(p2)
    if s1 == s2 and open(p1, "rb").read() == open(p2, "rb").read():
        continue                                  # 逐字节相同
    if s1 == s2:
        same_bytes += 1
    else:
        diff_bytes += 1
    if norm_bytes(p1) == norm_bytes(p2):
        continue                                  # 归一化后相同 ⇒ 纯 hash 联动
    real += 1
    real_list.append((b, s1, s2))

print("③ 字节数相同但内容不同（候选 hash 联动）: %d 个" % same_bytes)
print("④ 字节数不同: %d 个" % diff_bytes)
print("")
print("★ 归一化后仍有实质差异（＝真变化）: %d 个" % real)
for b, s1, s2 in real_list:
    print("   %-34s 线上 %8d → 本地 %8d  (%+d)" % (b, s2, s1, s1 - s2))
if real == 0:
    print("   ⇒ 零功能差异")
    print("")
    print("结论：所有『同字节数但 md5 不同』的文件经归一化后逐字节相等 ⇒ 纯 hash 联动，零功能差异；")
    print("      真实变化仅上表所列文件。")
