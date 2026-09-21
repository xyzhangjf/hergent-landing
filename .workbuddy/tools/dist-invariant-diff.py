#!/usr/bin/env python3
"""dist 差集核查 · 第⑤层 —— **内容不变量比对**（「等长替换」的照妖镜）。

🔴 为什么必须有这一层（补 memory/topics/deploy-ops.md 里那句判据的工具空缺）：
   第①层（去 hash 基名配对字节数）只能回答「**长度**变了没」。而本项目里最常见的两种改动
   **长度一模一样**：
     · Vue SFC 的 scopeId 变了（`data-v-22f6e2c8` → `data-v-8e9340b9`，8 位定长 hex）
     · chunk 引用的**别的 chunk 文件名**变了（`./index-CgHMIahj.js` → `./index-fdK2BKEV.js`）
   ⇒ 「字节数相同」**既不能证明没变、也不能证明变了**。必须做**内容不变量比对**：
     把「本来就该变的那几类字串」归一化掉，再逐字节比 —— 归一化后若**逐字相同**，
     就证明差异**只**来自这些级联，没有夹带任何真实逻辑改动。

归一化规则（只归一化「按构造必然变」的东西，绝不归一化业务字串）：
   ① `data-v-<8hex>`            → `data-v-X`      （Vue scopeId）
   ② `<基名>-<hash>.<js|css>`   → `<基名>-H.<ext>`（rollup 产物名互引）
   ③ `sk-<8hex>` / `vk-<8hex>`  → 同上（Vue 会把 @keyframes / v-bind 变量一起加 scope 前缀）

判据（全部必须满足，缺一条就要人工归因）：
   · 归一化后**逐字相同** ⇒ 该文件**零真实改动**（只是级联）
   · 归一化后不同 ⇒ 把差异片段打出来，人工逐段归因（这才是本次真实改动）

用法：
   python3 .workbuddy/tools/dist-invariant-diff.py <基准dist目录> <对比dist目录>
"""
import sys
import os
import re
import hashlib
import difflib

BASE_RE = re.compile(r'^(.*?)-([A-Za-z0-9_-]{8})\.(js|css)$')
SCOPE_RE = re.compile(r'data-v-[0-9a-f]{8}')
KEYFRAME_RE = re.compile(r'\b([sv])k-[0-9a-f]{8}\b')
ASSET_REF_RE = re.compile(r'([A-Za-z0-9_.-]+?)-([A-Za-z0-9_-]{8})\.(js|css)')


def basename(fn):
    m = BASE_RE.match(fn)
    return m.group(1) + '.' + m.group(3) if m else fn


def norm(text):
    """把「按构造必然变」的字串归一化掉，其余一字不动。"""
    t = SCOPE_RE.sub('data-v-X', text)
    t = KEYFRAME_RE.sub(lambda m: m.group(1) + 'k-X', t)
    t = ASSET_REF_RE.sub(lambda m: m.group(1) + '-H.' + m.group(3), t)
    return t


def md5(b):
    return hashlib.md5(b).hexdigest()


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(2)
    base_dir, cmp_dir = sys.argv[1], sys.argv[2]
    a_dir, b_dir = os.path.join(base_dir, 'assets'), os.path.join(cmp_dir, 'assets')
    for d in (a_dir, b_dir):
        if not os.path.isdir(d):
            print('❌ 找不到目录：' + d)
            sys.exit(2)

    a_map = {basename(f): f for f in os.listdir(a_dir)}
    b_map = {basename(f): f for f in os.listdir(b_dir)}
    only_a = sorted(set(a_map) - set(b_map))
    only_b = sorted(set(b_map) - set(a_map))
    common = sorted(set(a_map) & set(b_map))

    print('===== dist 内容不变量比对（第⑤层）=====')
    print('基准 %s：%d 文件' % (base_dir, len(a_map)))
    print('对比 %s：%d 文件' % (cmp_dir, len(b_map)))
    if only_a or only_b:
        print('\n❌ chunk 集合不一致（新增/删除，不是重命名）：')
        for k in only_a:
            print('   仅基准有：' + k)
        for k in only_b:
            print('   仅对比有：' + k)

    same_byte, md5_same, norm_same, norm_diff = [], [], [], []
    for k in common:
        pa, pb = os.path.join(a_dir, a_map[k]), os.path.join(b_dir, b_map[k])
        ba, bb = open(pa, 'rb').read(), open(pb, 'rb').read()
        if len(ba) == len(bb):
            same_byte.append(k)
        if md5(ba) == md5(bb):
            md5_same.append(k)
            continue
        ta = norm(ba.decode('utf-8', 'replace'))
        tb = norm(bb.decode('utf-8', 'replace'))
        if ta == tb:
            norm_same.append(k)
        else:
            norm_diff.append((k, ta, tb, ba, bb))

    print('\n-- 概览 --')
    print('  基名配对：%d' % len(common))
    print('  md5 完全相同（连名字都没变内容的）：%d' % len(md5_same))
    print('  字节数相同但 md5 不同（=「等长替换」，必须看不变量）：%d' % (len(same_byte) - len(md5_same)))
    print('  归一化后逐字相同（⇒ 差异**只**来自 scopeId / 产物名互引）：%d' % len(norm_same))
    print('  归一化后仍不同（⇒ 本次真实改动）：%d' % len(norm_diff))

    if norm_same:
        print('\n-- 归一化后逐字相同（零真实改动，逐个列出以便日后追溯）--')
        for k in norm_same:
            print('   ✅ ' + k)

    if norm_diff:
        print('\n===== 🔴 归一化后仍有差异的文件（真实改动，逐段归因）=====')
        for k, ta, tb, ba, bb in norm_diff:
            print('\n--- %s  (%d → %d B) ---' % (k, len(ba), len(bb)))
            # 按 } / ; / 换行切成小段再做 unified diff，输出更可读
            sa = re.split(r'(?<=[;{}])', ta)
            sb = re.split(r'(?<=[;{}])', tb)
            n = 0
            for line in difflib.unified_diff(sa, sb, lineterm='', n=0):
                if line.startswith('@@') or line.startswith('+++') or line.startswith('---'):
                    continue
                print('   ' + line[:300])
                n += 1
                if n > 24:
                    print('   …（更多差异已截断）')
                    break
    else:
        print('\n✅ 除上列外无其它差异。')

    print('\n-- scopeId 集合（Vue SFC 源码全文的指纹，可直接反推「哪个 .vue 变了」）--')
    for label, d in (('基准', a_dir), ('对比', b_dir)):
        scopes = set()
        for f in sorted(os.listdir(d)):
            if not f.endswith('.css'):
                continue
            scopes |= set(SCOPE_RE.findall(open(os.path.join(d, f), encoding='utf-8').read()))
        print('  %s: %s' % (label, ', '.join(sorted(scopes))))

    bad = bool(only_a or only_b or norm_diff)
    print('\n' + ('❌ 存在需要人工归因的差异' if bad else '✅ 全部差异都可由「scopeId / 产物名互引」解释，无夹带'))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
