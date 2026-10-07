# -*- coding: utf-8 -*-
"""v367 字符级去注释后精确统计（避开正则注释残留 / 子串假阳性）"""
import re

VUE = 'src/pages/Forecast.vue'
src = open(VUE, encoding='utf-8').read()
i_tpl = src.find('>', src.find('<template')) + 1
i_script = src.find('<script')
i_style = src.find('<style')

def strip_comments(s, kind='css'):
    """字符级状态机去注释：kind='css' 去 /* */；'js' 去 /* */ 与 //；'html' 去 <!-- -->"""
    out = []
    i = 0
    n = len(s)
    while i < n:
        if kind == 'html' and s.startswith('<!--', i):
            j = s.find('-->', i)
            i = n if j < 0 else j + 3
            continue
        if s.startswith('/*', i):
            j = s.find('*/', i)
            i = n if j < 0 else j + 2
            continue
        if kind == 'js' and s.startswith('//', i):
            j = s.find('\n', i)
            i = n if j < 0 else j
            continue
        # 字符串字面量保护（js）
        if kind == 'js' and s[i] in '\'"`':
            q = s[i]
            out.append(s[i]); i += 1
            while i < n and s[i] != q:
                if s[i] == '\\':
                    out.append(s[i]); i += 1
                if i < n:
                    out.append(s[i]); i += 1
            if i < n:
                out.append(s[i]); i += 1
            continue
        out.append(s[i]); i += 1
    return ''.join(out)

sty_c = strip_comments(src[i_style:], 'css')
tpl_c = strip_comments(src[i_tpl:i_script], 'html')

def line_of(pos):
    return src[:pos].count('\n') + 1

print('═' * 72)
print('【P1-a 精确】style 段 z-index 字面量（去注释后，非 var）')
hits = []
for m in re.finditer(r'z-index\s*:\s*([^;}]+)', sty_c):
    val = m.group(1).strip()
    if 'var(' in val:
        continue
    hits.append((m.start(), val))
print('   合计 = %d' % len(hits))
# 分组统计取值
from collections import Counter
c = Counter(v.split()[0] for _, v in hits)
print('   取值分布：', dict(c))
big = [(p, v) for p, v in hits if re.match(r'^1\d{3}$', v.split()[0])]
print('   其中 4 位数（1000+） = %d 处：' % len(big))
for p, v in big[:20]:
    pre = sty_c[:p]
    sel = re.split(r'[{};]', pre)[-1].strip()[-40:]
    print('      %-42s z:%s' % (sel, v))

print()
print('【P1-b 精确】style 段 box-shadow 字面量')
hits = [m.group(1).strip() for m in re.finditer(r'box-shadow\s*:\s*([^;}]+)', sty_c) if 'var(' not in m.group(1)]
print('   合计 = %d → %s' % (len(hits), hits))

print()
print('【P2-a 精确】template 去 HTML 注释后的 ✓ ✗ ⚠ ✅ ❌')
EMO = re.compile('[\u2713\u2717\u2705\u274C\u26A0\u26A0\uFE0F\u2714\u2716]|\u26A0\ufe0f')
n = 0
for m in EMO.finditer(tpl_c):
    ln = line_of(i_tpl + m.start())
    ctx = tpl_c[max(0, m.start() - 40):m.start() + 30].replace('\n', ' ')
    n += 1
    print('   L%-6d %-4s …%s…' % (ln, repr(m.group(0)), ctx))
print('   合计 = %d' % n)

print()
print('【P2-b 精确】template 里 SKU / Δ（词边界）')
for kw in ['SKU', 'Δ']:
    ms = list(re.finditer(r'(?<![A-Za-z])' + re.escape(kw) + r'(?![A-Za-z])', tpl_c))
    print('   %-4s → %d 处' % (kw, len(ms)))
    for m in ms:
        ln = line_of(i_tpl + m.start())
        ctx = tpl_c[max(0, m.start() - 38):m.start() + 28].replace('\n', ' ')
        print('        L%-6d …%s…' % (ln, ctx))

print()
print('【P2-c 精确】script 段「含中文的界面字符串」里的 SKU / Δ')
sc_c = strip_comments(src[i_script:i_style], 'js')
for kw in ['SKU', 'Δ']:
    ms = [m for m in re.finditer(re.escape(kw), sc_c)]
    inn = 0
    for m in ms:
        seg = sc_c[max(0, m.start() - 70):m.start() + 45]
        if re.search(r'[\u4e00-\u9fa5]', seg) and ("'" in seg or '"' in seg or '`' in seg):
            inn += 1
            ln = line_of(i_script + m.start())
            print('   %-4s L%-6d …%s…' % (kw, ln, re.sub(r'\s+', ' ', seg)))
    print('   %-4s script 中疑似进文案 = %d / 共 %d' % (kw, inn, len(ms)))
