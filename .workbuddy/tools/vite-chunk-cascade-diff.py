# -*- coding: utf-8 -*-
"""把「Vite 构建产物的 chunk 文件名级联改名」从「内容真的变了」里剥出来。

为什么需要它：rolling 的 `[hash]` **不是纯内容哈希** —— 它把**依赖 chunk 的哈希**也纳入
计算（`hashPlaceholder`）。于是**只要有一个上游 chunk 改了一个字节**，它的所有 importer
都会被改名，importer 的 importer 再改名……我实测过：某次只改了一个页面，
结果整包 30+ 个 chunk 全部换名，肉眼看 `ls -lt` 会以为「到处都改了」。

判据：**把文件内容里所有 `-<8位hash>.js|.css` 归一成 `-HASH.js|.css` 之后，两份产物
      只要归一化内容一致，就是「同一份代码、只是换了名」**；只有归一化内容不同，
      才是真的要审的改动。

用法：
  python3 v365-normalized-diff.py <本地dist> <生产dist清单+文件所在目录>
"""
import hashlib
import os
import re
import sys

RX = re.compile(rb"-([A-Za-z0-9_-]{8})\.(js|css)")
SKIP = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".woff", ".woff2",
        ".ttf", ".eot", ".map", ".mp4", ".pdf", ".svg", ".zip")


def norm(data):
    """归一化 chunk 名 → 稳定指纹（16 位十六进制）。"""
    if data[:4] == b"\x89PNG" or b"webpackChunk" == data[:14]:
        pass
    return hashlib.sha1(RX.sub(rb"-HASH.\2", data)).hexdigest()[:16]


def walk(root):
    out = {}
    for dp, _dn, fn in os.walk(root):
        for f in fn:
            if f.endswith(SKIP) or f.startswith("._"):
                continue
            p = os.path.join(dp, f)
            rel = os.path.relpath(p, root)
            try:
                with open(p, "rb") as fh:
                    out[rel] = norm(fh.read())
            except OSError:
                pass
    return out


local = walk(sys.argv[1])
prod = walk(sys.argv[2])

prod_by_norm = {}
for rel, h in prod.items():
    prod_by_norm.setdefault(h, []).append(rel)

same, diff = [], []
for rel in sorted(local):
    h = local[rel]
    if h in prod_by_norm:
        same.append((rel, prod_by_norm[h][0]))
    else:
        diff.append(rel)

print("本地文件 %d 个｜归一化后**与生产同一份代码**（只是换了名）：%d"
      % (len(local), len(same)))
for a, b in same:
    if a != b:
        print("   同码换名: %-42s <=> %s" % (a, b))
    else:
        print("   逐字节同名同码: %s" % a)

print()
print("🔴 归一化后**仍有实质差异**的本地文件：%d 个" % len(diff))
for rel in diff:
    print("   ", rel)

sys.exit(0)
