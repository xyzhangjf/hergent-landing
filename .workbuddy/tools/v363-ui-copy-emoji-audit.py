#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v363 UI 规范审计（精确版·行号可靠）
只统计「用户可见文案」里的 emoji 与英文缩写。
"""
import sys, re

path = sys.argv[1]
src = open(path, encoding='utf-8').read()
lines = src.split('\n')
i_script = src.find('<script')
i_style = src.find('<style', i_script if i_script > 0 else 0)
seg_tpl = (1, src[:i_script].count('\n'))
seg_scr = (src[:i_script].count('\n') + 1, src[:i_style].count('\n'))
seg_sty = (src[:i_style].count('\n') + 1, len(lines))
tpl = '\n'.join(lines[seg_tpl[0]-1:seg_tpl[1]])
scr = '\n'.join(lines[seg_scr[0]-1:seg_scr[1]])
sty = '\n'.join(lines[seg_sty[0]-1:seg_sty[1]])

keep_nl = lambda m: '\n' * m.group(0).count('\n')

items = []
off = seg_tpl[0] - 1
tpl_nc = re.sub(r'<!--.*?-->', keep_nl, tpl, flags=re.S)

# 1) 文本节点（标签替空字符串 ⇒ 行号不动）
txt = re.sub(r'<[^>]*>', '', tpl_nc)
for i, l in enumerate(txt.split('\n')):
    s = l.strip()
    if s:
        items.append((off + i + 1, s, '界面文本'))

# 2) 悬停/占位属性
for m in re.finditer(r'(?:title|placeholder|aria-label|alt)="([^"]*)"', tpl_nc):
    v = m.group(1)
    if re.search(r'[\u4e00-\u9fa5]', v):
        items.append((off + tpl_nc[:m.start()].count('\n') + 1, v, '悬停/占位'))

# 3) script 含中文字符串字面量
sbody = re.sub(r'/\*.*?\*/', keep_nl, scr, flags=re.S)
soff = seg_scr[0] - 1
for i, l in enumerate(sbody.split('\n')):
    ls = l.strip()
    if ls.startswith('//') or ls.startswith('*'):
        continue
    for m in re.finditer(r"'([^'\\\n]*)'|\"([^\"\\\n]*)\"|`([^`\\\n]*)`", l):
        t = m.group(1) or m.group(2) or m.group(3) or ''
        if re.search(r'[\u4e00-\u9fa5]', t):
            items.append((soff + i + 1, t, '脚本文案'))

print("=== 分段 ===")
print("  template L%d-%d | script L%d-%d | style L%d-%d"
      % (seg_tpl[0], seg_tpl[1], seg_scr[0], seg_scr[1], seg_sty[0], seg_sty[1]))
print("  → 用户可见文案条目 = %d\n" % len(items))

ALERT = re.compile('[\U0001F300-\U0001FAFF\U0001F000-\U0001F2FF\u2700-\u27BF\u2B00-\u2BFF\u2600-\u26FF\uFE0F]')

def cls(ch):
    cp = ord(ch)
    if cp == 0xFE0F: return 'VS16变体符'
    if 0x1F300 <= cp <= 0x1FAFF or 0x1F000 <= cp <= 0x1F2FF: return 'EMOJI图'
    if cp in (0x2705, 0x274C, 0x274E, 0x2757, 0x2764, 0x2B50, 0x26A0, 0x26A1, 0x2728): return 'EMOJI符号'
    if 0x2700 <= cp <= 0x27BF: return 'DINGBAT'
    if 0x2B00 <= cp <= 0x2BFF: return '箭头符号'
    if 0x2600 <= cp <= 0x26FF: return '杂项符号'
    return 'other'

print("=== ① 用户可见文案里的 emoji/符号 ===")
hits = [(ln, s, t) for ln, t, s in items if ALERT.search(t)]
if not hits:
    print("  （无）")
for ln, s, t in hits:
    chars = sorted({(c, cls(c)) for c in t if ALERT.match(c)})
    print("  L%-6d %-10s %-30s | %s" % (ln, s, '  '.join('%s[%s]' % c for c in chars), t[:76]))
print()

print("=== ② 备注：emoji 全量（含注释）分布 ===")
demoji = re.compile('[\U0001F300-\U0001FAFF\uFE0F]')
allhit = [i + 1 for i, l in enumerate(lines) if demoji.search(l)]
incmt = [n for n in allhit if re.search(r'^\s*(<!--|//|\*|/\*)', lines[n-1])]
print("  全文件真 emoji 行 = %d ；其中行首即注释标记 = %d" % (len(allhit), len(incmt)))
print()

print("=== ③ 用户可见文案里的英文缩写 ===")
ABBR = [('pp', r'\bpp\b'), ('mo', r'\bmo\b'), ('QoQ', r'QoQ'), ('YoY', r'YoY'),
        ('SKU', r'SKU'), ('Δ', r'Δ'), ('N/A', r'N/A'), ('OK', r'\bOK\b')]
tot = 0
for name, pat in ABBR:
    hit = [(ln, s, t) for ln, t, s in items if re.search(pat, t)]
    if hit:
        tot += len(hit)
        print("  ── 「%s」%d 处" % (name, len(hit)))
        for ln, s, t in hit:
            print("      L%-6d %-10s | %s" % (ln, s, t[:88]))
if tot == 0:
    print("  （无）")
print("  合计 %d 处\n" % tot)

print("=== ④ style 段硬编码色值 ===")
sty_off = seg_sty[0] - 1
for i, l in enumerate(sty.split('\n')):
    if re.search(r'#[0-9a-fA-F]{3,8}\b|rgba?\(\s*0\s*,\s*0\s*,\s*0', l):
        print("  L%-6d %s" % (sty_off + i + 1, l.strip()[:118]))
print()

print("=== ⑤ 遮罩 / 交互元素 ===")
for i, l in enumerate(sty.split('\n')):
    if 'overlay' in l and 'background' in l:
        print("  L%-6d %s" % (sty_off + i + 1, l.strip()[:104]))
noc = re.sub(r'<!--.*?-->', '', tpl, flags=re.S)
print("  <button> = %d | <div|span @click> = %d | <Icon> = %d"
      % (len(re.findall(r'<button\b', noc)),
         len(re.findall(r'<(?:div|span)[^>]*@click', noc)),
         len(re.findall(r'<Icon\b', noc))))
