# -*- coding: utf-8 -*-
"""v367 核剩余差集类的真实影响：是「完全无样式」还是「缺修饰（有父类兜底）」"""
import re
import os

VUE = 'src/pages/Forecast.vue'
src = open(VUE, encoding='utf-8').read()
i_style = src.find('<style')
i_body = src.find('>', src.find('<template')) + 1
tpl = src[i_body:src.find('<script')]
sty = src[i_style:]
strip_css = lambda s: re.sub(r'/\*.*?\*/', '', s, flags=re.S)
strip_html = lambda s: re.sub(r'<!--.*?-->', '', s, flags=re.S)

def rules_for(cls, css):
    """返回含 .cls 的选择器原文"""
    out = []
    for m in re.finditer(r'([^{}]+)\{', strip_css(css)):
        sel = m.group(1).strip()
        if sel.startswith('@'):
            continue
        if re.search(r'\.' + re.escape(cls) + r'(?![-_a-zA-Z0-9])', sel):
            out.append(sel)
    return out

GLOBAL = open('src/styles/variables.css', encoding='utf-8').read()

# 目标：类 → (父类/同族, 出现位置说明)
targets = {
    'th':           ('tbl / 元素 th', None),
    'extra':        ('calc-th num', None),
    'spark-th':     ('calc-th', None),
    'tb-ctx':       ('tb-group', None),
    'tb-data':      ('tb-group', None),
    'tb-act':       ('tb-group', None),
    'err-panel':    ('info-panel', None),
    'bi-panel':     ('info-panel', None),
    'btn-retry':    ('btn btn-sm btn-primary', None),
    'ctx-paste':    ('ctx-menu', None),
    'ctx-ipt-fill': ('ctx-menu', None),
    'pc-modal':     ('modal', '跨页'),
}

print('═' * 78)
for cls, (parent, note) in targets.items():
    own_s = rules_for(cls, sty)
    own_g = rules_for(cls, GLOBAL)
    # 元素选择器（th{} / .tbl th{}）
    elem = []
    for m in re.finditer(r'([^{}]+)\{', strip_css(sty)):
        sel = m.group(1).strip()
        if re.search(r'(?:^|[\s,>+~])th(?![-_a-zA-Z0-9])', sel) and not sel.startswith('@'):
            elem.append(sel)
    print('▪ %s' % cls)
    print('   scoped 自有规则 : %s' % (own_s if own_s else '—— 无'))
    print('   global 自有规则 : %s' % (own_g if own_g else '—— 无'))
    if cls == 'th':
        print('   元素 th 规则    : %s' % (elem[:3] if elem else '—— 无'))
    # 父类是否定义
    for p in parent.split(' / '):
        pr = rules_for(p.strip(), sty) or rules_for(p.strip(), GLOBAL)
        if pr:
            print('   父类 .%-12s ✅ 有兜底 : %s' % (p.strip(), pr[0][:70]))
    print()

# ── 模板出现位置
print('═' * 78)
print('模板出现位置（取所在行的前 110 字符）：')
lines = src.split('\n')
for cls in targets:
    for n, l in enumerate(lines[:i_body_ln] if (i_body_ln := src[:src.find('<script')].count('\n')) else []):
        pass
print()
for cls in targets:
    pat = re.compile(r'(?<![-_a-zA-Z0-9])' + re.escape(cls) + r'(?![-_a-zA-Z0-9])')
    hits = []
    for n, l in enumerate(lines):
        if n >= src[:src.find('<script')].count('\n'):
            break
        if pat.search(l) and ('class' in l):
            hits.append('L%-6d %s' % (n + 1, l.strip()[:105]))
    print('▪ %s  (%d 处)' % (cls, len(hits)))
    for h in hits[:4]:
        print('    ', h)
