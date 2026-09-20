#!/usr/bin/env python3
"""通用版 token 对齐（用法：python3 token-align.py <a.js> <b.js>）。

判据：
  · token 总数相同
  · 非 id token 差异全部落在「按构造必然变」的两类（chunk 互引名 / data-v-<8hex> scopeId）
  · id 重命名为严格一对一
⇒ 三者同时成立 = 零逻辑 / 零字面量改动（仅命名与级联）
"""
import re
import sys
import collections

ID_START = re.compile(r'[A-Za-z_$]')
ID_CHAR = re.compile(r'[A-Za-z0-9_$]')
DIGIT = re.compile(r'[0-9]')
WS = re.compile(r'\s+')
REGEX_PREV = set('(,=:[!&|?{};+-*%~^<>')
SCOPE = re.compile(r'data-v-[0-9a-f]{8}')
ASSET = re.compile(r'([A-Za-z0-9_.-]+?)-([A-Za-z0-9_-]{8})\.(js|css)')


def tokenize(s):
    out = []
    i, n = 0, len(s)
    while i < n:
        c = s[i]
        if c in ' \t\r\n':
            i = WS.match(s, i).end()
            continue
        if c in '"\'':
            j = i + 1
            while j < n:
                if s[j] == '\\':
                    j += 2
                    continue
                if s[j] == c:
                    j += 1
                    break
                j += 1
            out.append(('str', s[i:j]))
            i = j
            continue
        if c == '`':
            j = i + 1
            while j < n:
                if s[j] == '\\':
                    j += 2
                    continue
                if s[j] == '`':
                    j += 1
                    break
                j += 1
            out.append(('tmpl', s[i:j]))
            i = j
            continue
        if c == '/' and i + 1 < n and s[i + 1] == '/':
            j = s.find('\n', i)
            i = n if j < 0 else j
            continue
        if c == '/' and i + 1 < n and s[i + 1] == '*':
            j = s.find('*/', i + 2)
            i = n if j < 0 else j + 2
            continue
        if c == '/':
            prev = out[-1][1][-1] if out and out[-1][1] else ''
            if not out or prev in REGEX_PREV:
                j = i + 1
                in_class = False
                while j < n:
                    ch = s[j]
                    if ch == '\\':
                        j += 2
                        continue
                    if ch == '[':
                        in_class = True
                    elif ch == ']':
                        in_class = False
                    elif ch == '/' and not in_class:
                        j += 1
                        break
                    elif ch == '\n':
                        break
                    j += 1
                while j < n and s[j].isalpha():
                    j += 1
                out.append(('regex', s[i:j]))
                i = j
                continue
            out.append(('punc', '/'))
            i += 1
            continue
        if DIGIT.match(c) or (c == '.' and i + 1 < n and DIGIT.match(s[i + 1])):
            j = i
            while j < n and (s[j].isalnum() or s[j] in '._' or
                             (s[j] in '+-' and s[j - 1] in 'eE')):
                j += 1
            out.append(('num', s[i:j]))
            i = j
            continue
        if ID_START.match(c):
            j = i
            while j < n and ID_CHAR.match(s[j]):
                j += 1
            out.append(('id', s[i:j]))
            i = j
            continue
        out.append(('punc', c))
        i += 1
    return out


def explain(v):
    """判断一个非 id token 差异是否属于「按构造必然变」的两类。"""
    v2 = SCOPE.sub('data-v-X', v)
    v2 = ASSET.sub(lambda m: m.group(1) + '-H.' + m.group(3), v2)
    return v2


def main():
    fa, fb = sys.argv[1], sys.argv[2]
    ta = tokenize(open(fa, encoding='utf-8').read())
    tb = tokenize(open(fb, encoding='utf-8').read())
    print('比对 %s\n     vs %s' % (fa, fb))
    print('token 数 base=%d new=%d  %s' % (len(ta), len(tb), '✅ 相同' if len(ta) == len(tb) else '❌ 不同'))
    if len(ta) != len(tb):
        return 1

    nonid, id_diff = [], 0
    mapping, rev = collections.defaultdict(set), collections.defaultdict(set)
    for i, ((ka, va), (kb, vb)) in enumerate(zip(ta, tb)):
        if ka == kb and va == vb:
            continue
        if ka != 'id':
            if ka == kb:
                nonid.append((i, ka, va, vb))
            else:
                nonid.append((i, 'KIND:' + ka + '->' + kb, va, vb))
            continue
        id_diff += 1
        mapping[va].add(vb)
        rev[vb].add(va)

    print('标识符名不同的 token：%d ；映射条目 旧%d / 新%d' % (id_diff, len(mapping), len(rev)))
    o2m = {k: v for k, v in mapping.items() if len(v) > 1}
    m2o = {k: v for k, v in rev.items() if len(v) > 1}
    print('  一对一性：旧名→多名 %d ；新名←多旧名 %d  %s' % (
        len(o2m), len(m2o), '✅ 严格一对一' if not o2m and not m2o else '❌ 非一对一'))

    print('\n非 id token 差异：%d 条' % len(nonid))
    unexplained = []
    for i, kind, va, vb in nonid:
        ea, eb = explain(va), explain(vb)
        ok = ea == eb
        if not ok:
            unexplained.append((i, kind, va, vb))
        if len(nonid) <= 20 or not ok:
            print('  [%s] %s %s %s' % ('✅可解释' if ok else '🔴未解释', kind,
                                       va[:90], ('→ ' + vb[:90]) if va != vb else ''))
    if len(nonid) > 20:
        print('  …（共 %d 条，仅列可解释的前若干 + 全部未解释）' % len(nonid))

    ok = not o2m and not m2o and not unexplained
    print('\n' + ('✅ 结论：差异**仅**为标识符重命名 + scopeId/产物名级联 —— 零逻辑、零字面量改动'
                  if ok else '❌ 存在未解释差异，需人工归因'))
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
