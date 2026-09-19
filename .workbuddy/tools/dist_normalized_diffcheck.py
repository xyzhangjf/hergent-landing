#!/usr/bin/env python3
"""部署前差集核查：证明「真变化只有本次改动」，其余全是可解释的派生噪声。

（2026-09-17 v183 起入库 —— 这脚本在 v181/v182/v183 被重写过三次，别再重写第四次。）

为什么不能直接 md5 逐文件比：
  改 Forecast.vue 里任意一个字符，会连带改三样与样式无关的东西 ——
    ① Vite chunk 名 hash（连带改写引用它的 chunk 里的 __vite__mapDeps 字符串）
    ② Vue scoped 的 data-v-<scopeId>（scopeId = hash(路径 + **源码**)，含注释）
    ③ 由 scopeId 派生的 scoped @keyframes 名 sk-<scopeId>
  ⇒ 必须先把这三样抹平，再看「还有什么真的不一样」。

用法: python3 dist_normalized_diffcheck.py <改前目录> <改后目录>
  例: python3 .workbuddy/tools/dist_normalized_diffcheck.py \\
        /tmp/prod_before hergent-cn-v2/dist
  「改前目录」的取法：`rsync -az --include='*/' --include='*.js' --include='*.css'
   --include='*.html' --exclude='*' root@47.113.224.140:/opt/hergent-cn-v2/ /tmp/prod_before/`
  （⚠️ 只取 js/css/html；若日后要整体回滚，这份副本**不能**直接 `rsync --delete`）
"""
import os
import re
import sys

RE_CHUNK = re.compile(rb'([A-Za-z0-9_]+)-([A-Za-z0-9_-]{8})\.(js|css)')
RE_SCOPE = re.compile(rb'data-v-[0-9a-z]+')
RE_KF = re.compile(rb'sk-[0-9a-z]+')


def norm(data: bytes) -> bytes:
    data = RE_CHUNK.sub(rb'\1-HASH.\3', data)
    data = RE_SCOPE.sub(rb'data-v-H', data)
    data = RE_KF.sub(rb'sk-H', data)
    return data


def read_tree(root: str) -> dict:
    out = {}
    for dirpath, _, files in os.walk(root):
        for f in files:
            if not f.endswith(('.js', '.css', '.html')):
                continue
            p = os.path.join(dirpath, f)
            rel = os.path.relpath(p, root)
            out[rel] = open(p, 'rb').read()
    return out


before_root, after_root = sys.argv[1], sys.argv[2]
before, after = read_tree(before_root), read_tree(after_root)

# 文件集合比对（未归一化，直接按原文件名）
only_b = sorted(set(before) - set(after))
only_a = sorted(set(after) - set(before))
print('改前 %d 项 / 改后 %d 项' % (len(before), len(after)))
print('仅改前有: %s' % (only_b or '无'))
print('仅改后有: %s' % (only_a or '无'))

# 文件集合也无法直接比：chunk 名 hash 变了，文件名本身就不同 ⇒ 改按「归一化后的文件名」配对
def norm_name(rel: str) -> str:
    d, f = os.path.split(rel)
    return os.path.join(d, RE_CHUNK.sub(rb'\1-HASH.\3', f.encode()).decode())

nb = {norm_name(k): v for k, v in before.items()}
na = {norm_name(k): v for k, v in after.items()}
print()
print('归一化文件名后：改前 %d 项 / 改后 %d 项' % (len(nb), len(na)))
print('仅改前有: %s' % (sorted(set(nb) - set(na)) or '无'))
print('仅改后有: %s' % (sorted(set(na) - set(nb)) or '无'))
assert len(nb) == len(before) and len(na) == len(after), '归一化后出现重名，比对不可靠'

# 单侧文件里可能藏着「同一个 chunk 改名」—— 别当成「删了一个文件 + 加了一个文件」。
# Vite 会给「被多处引用的共享 chunk」挑 chunk 内**某一个成员模块**的名字来命名：
# 源码里新增/删除一个被多处引用的模块，就可能让 283 kB 的 xlsx 共享 chunk 从 `arrival-*`
# 改名成 `roles-*`（2026-09-19 实测：新增 constants/roles.js 后正是如此）。
# 判据：同扩展名 + 归一化后长度接近（±2% 且不超过 2 kB）。**只报告、不自动配对** ——
# 「长度接近」也可能是巧合，配对与否由人看内容确认；这里的作用是把噪声定性出来。
paired = set()
renames = []
for b in sorted(set(nb) - set(na)):
    if not b.endswith(('.js', '.css')):
        continue
    for a in sorted(set(na) - set(nb)):
        if a in paired or os.path.splitext(a)[1] != os.path.splitext(b)[1]:
            continue
        lb, la = len(nb[b]), len(na[a])
        if abs(la - lb) <= max(2048, int(lb * 0.02)):
            paired.add(a)
            renames.append((b, a, lb, la, norm(nb[b]) == norm(na[a])))
            break
if renames:
    print()
    print('疑似同一 chunk 改名（**不是**文件被删/新增）：')
    for b, a, lb, la, same in renames:
        print('   %s → %s   %d → %d 字节  归一化后%s'
              % (b, a, lb, la, '逐字节相同' if same else '仅剩标识符分配差异（压缩器重新分配短名）'))

print()
print('%-34s %10s %10s  %s' % ('文件(归一化名)', '改前', '改后', '判定'))
print('-' * 84)
real, drift = [], 0
for name in sorted(set(nb) & set(na)):
    x, y = nb[name], na[name]
    if x == y:
        verdict = '逐字节相同'
    elif norm(x) == norm(y):
        verdict = '纯派生噪声（chunk名/scopeId）'
        drift += 1
    else:
        verdict = '**真变化**'
        real.append((name, x, y))
    if verdict != '逐字节相同':
        print('%-34s %10d %10d  %s' % (name, len(x), len(y), verdict))

print()
print('纯派生噪声 %d 项 / 真变化 %d 项 / 疑似改名 %d 项' % (drift, len(real), len(renames)))
print()
if not real:
    print('✅ 零真变化（改前 == 改后）')
else:
    for name, x, y in real:
        nx, ny = norm(x), norm(y)
        print('--- 真变化: %s   %d → %d (净 %+d)' % (name, len(x), len(y), len(y) - len(x)))
        if nx == ny:
            print('    ⚠️ 归一化后长度/内容相同，说明只是等长替换')
            continue
        # 找出第一个真实差异区间，给出上下文
        i = 0
        while i < min(len(nx), len(ny)) and nx[i] == ny[i]:
            i += 1
        lo, hi = max(0, i - 70), min(len(nx), i + 70)
        print('    首个差异 @%d' % i)
        print('      改前: %r' % nx[lo:hi])
        print('      改后: %r' % ny[lo:hi])
        nd = abs(len(nx) - len(ny))
        print('    归一化后长度差 %+d 字节' % (len(ny) - len(nx)))
        if nd < 400:
            print('    归一化后改后内容片段: %r' % ny[i - 40:i + 260])
