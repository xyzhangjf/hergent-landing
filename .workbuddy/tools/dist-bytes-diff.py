#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""两份 minified 产物的**字节级差异定位** —— 回答「同一份源码为什么构建出两个名字」。

为什么需要它（`dist-cn-set-diff.py` 不够用的地方）：
  中文串集合能一眼看穿「有没有夹带别人的功能」，但它是**粗粒度**的 ——
  集合相同**不等于**产物一致（ASCII 常量、注释、数字字面量、短名分配都不进集合）。
  当两份产物的**长度相同、md5 不同**时，最可能的就是「等长字符串替换」
  （`v205`→`v207` 恰好同长），但也可能是压缩器短名重分配。
  这两者的处置完全相反：前者是「我自己的注释改动、可归因」，后者是「构建不可复现、要查」。

用法: python3 dist-bytes-diff.py <A> <B> [--ctx N] [--max M]
  输出：长度、md5、差异段数、每段的 A/B 两侧原文（带 ±ctx 字节上下文）。
  判据：若差异段全是**同长度**替换、且落在注释/ASCII 常量上 ⇒ 可归因；
        若出现**长度变化**或短名（`_ as So` / `_ as Uo`）互换 ⇒ 压缩噪声，需另外证明等价。
"""
import hashlib
import sys


def read(p):
    with open(p, 'rb') as f:
        return f.read()


def diff_segments(a, b, ctx=40, max_seg=200000):
    """返回 [(i, j, a[i:j], b[i:j])] —— 把 A/B 切成「相同块 / 不同块」交替。"""
    n = min(len(a), len(b))
    segs = []
    i = 0
    while i < n:
        if a[i] == b[i]:
            i += 1
            continue
        # 找这一段不同的结束位置：从尾部反向找同步点（简单双向收敛）
        j = i
        k = i
        while j < n and a[j] != b[j]:
            j += 1
        _ = k
        segs.append((i, j, a[i:j], b[i:j]))
        if len(segs) >= max_seg:
            break
        i = j
    return segs


def show(buf, i, j, ctx):
    lo = max(0, i - ctx)
    hi = min(len(buf), j + ctx)
    s = buf[lo:hi].decode('utf-8', errors='replace')
    return s.replace('\n', '\\n')


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    pa, pb = sys.argv[1], sys.argv[2]
    ctx = 40
    if '--ctx' in sys.argv:
        ctx = int(sys.argv[sys.argv.index('--ctx') + 1])

    a, b = read(pa), read(pb)
    print('A %s' % pa)
    print('   len=%d md5=%s' % (len(a), hashlib.md5(a).hexdigest()))
    print('B %s' % pb)
    print('   len=%d md5=%s' % (len(b), hashlib.md5(b).hexdigest()))
    if a == b:
        print('\n✅ 两份产物逐字节相同')
        return 0

    if len(a) != len(b):
        print('\n⚠️ 长度不同（%d vs %d，差 %d 字节）—— 不是纯等长替换，需按插入/删除理解'
              % (len(a), len(b), len(b) - len(a)))

    segs = diff_segments(a, b, ctx=ctx)
    print('\n差异段数：%d' % len(segs))
    same_len = sum(1 for (_i, _j, x, y) in segs if len(x) == len(y))
    print('  其中等长替换：%d 段 / 变长：%d 段' % (same_len, len(segs) - same_len))
    print()
    for idx, (i, j, x, y) in enumerate(segs[:20]):
        print('--- 段 %d @字节 %d..%d（A %d 字节 / B %d 字节）%s'
              % (idx + 1, i, j, len(x), len(y), '【等长】' if len(x) == len(y) else '【变长】'))
        print('  A: %s' % show(a, i, j, ctx))
        print('  B: %s' % show(b, i, j, ctx))
    if len(segs) > 20:
        print('...（只显示前 20 段，共 %d 段）' % len(segs))
    return 0


if __name__ == '__main__':
    sys.exit(main())
