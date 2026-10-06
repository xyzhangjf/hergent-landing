#!/usr/bin/env python3
"""v384 残差解释：归一后逐字节比对两个 Archive chunk，把差异段原样打出来。

判据目的：`Archive.js` 归一后仍有 Δ+90 B 残差 —— 必须能**逐条解释**，
否则就是夹带。归一化把 asset 文件名与 scoped 属性名换成占位符，
剩下的差异只可能是「真实代码改动」。
"""
import difflib
import re
import sys

BASE = sys.argv[1]
CAND = sys.argv[2]


def norm(p):
    s = open(p, encoding="utf-8", errors="replace").read()
    # asset 文件名（形如 Forecast-C15gfmjG.js）→ 占位符
    s = re.sub(r"[A-Za-z0-9_$./-]*-[A-Za-z0-9_-]{8}\.(?:js|css)", "ASSET", s)
    # Vue scoped CSS 属性名
    s = re.sub(r"data-v-[0-9a-z]{8}", "SCOPEID", s)
    return s


a = norm(BASE)
b = norm(CAND)
print("归一后长度: 基线 %d -> 候选 %d  (Δ=%+d)" % (len(a), len(b), len(b) - len(a)))
print("=" * 78)

sm = difflib.SequenceMatcher(None, a, b, autojunk=False)
n = 0
for tag, i1, i2, j1, j2 in sm.get_opcodes():
    if tag == "equal":
        continue
    n += 1
    ca = a[max(0, i1 - 70):min(len(a), i2 + 70)]
    cb = b[max(0, j1 - 70):min(len(b), j2 + 70)]
    print("【差异 %d】%s  基线[%d:%d] 候选[%d:%d]" % (n, tag, i1, i2, j1, j2))
    print("  基线: ...%s..." % ca)
    print("  候选: ...%s..." % cb)
    if tag == "replace":
        print("  删掉: %r" % a[i1:i2])
        print("  新增: %r" % b[j1:j2])
    elif tag == "insert":
        print("  新增: %r" % b[j1:j2])
    else:
        print("  删掉: %r" % a[i1:i2])
    print()

print("=" * 78)
if n == 0:
    print("归一后**完全一致** ⇒ 零夹带")
else:
    print("共 %d 处差异段（需逐条核对是否全部来自本轮修复）" % n)
