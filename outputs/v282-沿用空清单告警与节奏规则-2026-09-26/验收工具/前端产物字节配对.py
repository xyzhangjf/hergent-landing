# -*- coding: utf-8 -*-
"""逐文件对比：线下生效批次（线上）vs 本次新构建。

判据链：
  1) 线上 index.html 与「构建前本地 dist」md5 一致 ⇒ dist_before.txt 就是线上生效批次的文件名清单
  2) rollup 的 chunk hash 对模块遍历顺序敏感 ⇒ 文件名会级联改名，**不能**用文件名判内容
  3) 唯一穿透噪声的判据是**字节大小**：同前缀 + 不同 hash 但字节相同 ⇒ 内容相同

⚠️ 上一版踩的坑：chunk hash 是 base64url，**含 `-` 和 `_`**（如 `Shell-CT9Duu0-.js`），
   正则用 `[A-Za-z0-9_]{6,}` 会漏掉尾部 `-` ⇒ 前缀提取失败 ⇒ 误报 DIFF。
   这里固定 vite 默认 hash 长度 8，从右侧匹配。
"""
import re
import sys

PRE = re.compile(r"^(.*)-([A-Za-z0-9_-]{8})\.(js|css)$")


def pre(n):
    m = PRE.match(n)
    return (m.group(1) + "." + m.group(3)) if m else n


def load(path):
    d = {}
    for line in open(path, "r", encoding="utf-8", errors="replace"):
        p = line.split()
        if len(p) >= 2:
            try:
                d[p[-1]] = int(p[0])
            except ValueError:
                pass
    return d


names = [x.strip() for x in open("/tmp/v282/dist_before.txt", encoding="utf-8") if x.strip()]
prod = load("/tmp/v282/prod_sizes.txt")   # 线上 assets 全量（251，含历次并集）
final = load("/tmp/v282/final_sizes.txt")  # 本次新构建（53）

fp = {}
for n, s in final.items():
    fp.setdefault(pre(n), []).append((n, s))

same, diff, missed = 0, [], []
for n in sorted(names):
    ps = prod.get(n)
    fs = fp.get(pre(n))
    fsz = fs[0][1] if fs else None
    if ps is None:
        missed.append(n)
    elif ps == fsz:
        same += 1
    else:
        diff.append((n, ps, fsz))

print("=" * 78)
print("线上生效批次文件数 : %d" % len(names))
print("逐字节相同         : %d" % same)
print("不同               : %d" % len(diff))
print("线上查不到         : %d" % len(missed))
print("=" * 78)
for n, ps, fsz in diff:
    d = (fsz - ps) if (ps is not None and fsz is not None) else None
    print("  %-32s 线上=%-9s 新构建=%-9s 差值=%s" % (n, ps, fsz, d))
if missed:
    for n in missed:
        print("  [线上无] %s" % n)
print("=" * 78)
