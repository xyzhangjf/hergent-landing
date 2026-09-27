#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v286 前端产物「按字节」比对（比文件名可靠 —— 文件名会被 hash 级联改名）

为什么不能比文件名：v282 实测，只改 2 个源文件却让 29/53 个 chunk 改名
（rollup 的 chunk hash 对模块遍历顺序敏感 ⇒ 一处改动级联改一片名字）。
唯一可靠判据 = **按逻辑名前缀比字节大小**。

⚠️ chunk hash 是 base64url，**可能含 `-`**（如 `index-C7Lw83l-.js`），
   所以正则必须把 hash 段写成 `[A-Za-z0-9_-]{8}`，不能只写 `[A-Za-z0-9_]`。
"""
import re
import sys

PRE = re.compile(r"^(.*)-([A-Za-z0-9_-]{8})\.(js|css)$")


def load(p):
    out = {}
    for line in open(p, encoding="utf-8"):
        parts = line.split()
        if len(parts) >= 2:
            out[parts[-1]] = int(parts[0])
    return out


def pre(n):
    m = PRE.match(n)
    return (m.group(1) + "." + m.group(3)) if m else n


before = load("/tmp/v288/dist_before.txt")
after = load("/tmp/v288/dist_after.txt")

bp, ap = {}, {}
for n, s in before.items():
    bp.setdefault(pre(n), []).append((n, s))
for n, s in after.items():
    ap.setdefault(pre(n), []).append((n, s))

print("=" * 78)
print("构建前 %d 个产物 / 构建后 %d 个产物" % (len(before), len(after)))
print("=" * 78)

same, diff, only_b, only_a = [], [], [], []
for k in sorted(set(bp) | set(ap)):
    b = bp.get(k)
    a = ap.get(k)
    if b and a:
        bs = sum(s for _, s in b)
        as_ = sum(s for _, s in a)
        if bs == as_:
            same.append((k, bs))
        else:
            diff.append((k, bs, as_))
    elif b:
        only_b.append((k, b))
    else:
        only_a.append((k, a))

print()
print("【逐字节相同】%d 个" % len(same))
print("【字节不同】%d 个  ← 这些才是我真正的改动" % len(diff))
print("%-38s %-12s %-12s %s" % ("逻辑名", "构建前", "构建后", "差值"))
for k, bs, as_ in diff:
    print("%-38s %-12d %-12d %+d" % (k, bs, as_, as_ - bs))

if only_b:
    print()
    print("【只在构建前存在】%d 个（= 被删/改名，需逐一解释）" % len(only_b))
    for k, v in only_b:
        print("   %-38s %s" % (k, v))

if only_a:
    print()
    print("【只在构建后存在】%d 个（= 新增，需逐一解释）" % len(only_a))
    for k, v in only_a:
        print("   %-38s %s" % (k, v))

print()
print("=" * 78)
print("判读：干净的结果应满足 —— 差异**精确等于我改的源文件所对应的 chunk**")
print("      本轮只改了 hergent-cn-v2/src/pages/EmployeeArchive.vue 一个源文件")
print("=" * 78)

sys.exit(0)
