#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
v395 · UI-SPEC §3.4 与 Shell.vue 实现的一致性自检。

目的：规范文档最典型的失效方式是「写完就与实现脱节」（v394 已挖出两处）。
本脚本把 §3.4 里写下的**每一条可验证断言**拿去代码里比对，任一不符即 FAIL。

判据分两类：
  A. 类名存在性  —— 规范表格里出现的 `.sb-*` 类，必须在 Shell.vue 里有定义。
  B. 数值一致性  —— 规范写下的关键数值（min/max 宽、字号、圆角、z-index、余量、断点），
                    必须与 CSS/JS 里逐字相同。

用法：
  python3 v395-spec-shell-consistency.py            # 只报告
  python3 v395-spec-shell-consistency.py --strict    # 有 FAIL 则 exit 1
"""
import re, sys, os, io

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SPEC = os.path.join(ROOT, 'hergent-cn-v2', 'docs', 'UI-SPEC.md')
SHELL = os.path.join(ROOT, 'hergent-cn-v2', 'src', 'components', 'Shell.vue')

spec = io.open(SPEC, encoding='utf-8').read()
shell = io.open(SHELL, encoding='utf-8').read()

# 只取 §3.4 一节（到 §4 标题为止）
m = re.search(r'### 3\.4 .*?(?=\n## 4\. )', spec, re.S)
if not m:
    print('FAIL  规范里找不到 §3.4')
    sys.exit(1)
sec = m.group(0)
print('§3.4 段落长度：%d 字符' % len(sec))

fails = []
def ck(cond, name, detail=''):
    print(('  OK   ' if cond else '  FAIL ') + name + (('  | ' + detail) if detail else ''))
    if not cond:
        fails.append(name)

# ---------- A. 类名存在性 ----------
print('\n[A] 类名存在性（规范表格 ↔ Shell.vue 定义）')
CLASSES = ['.sb-pop', '.sb-pop-col', '.sb-pop-hd', '.sb-pop-row', '.sb-pop-item', '.sb-pop-new']
for c in CLASSES:
    # 规范里提到
    in_spec = c in sec
    # 代码里定义：形如 `.sb-pop{` 或 `.sb-pop-col{`
    defined = re.search(re.escape(c) + r'\s*\{', shell) is not None
    ck(in_spec and defined, '%-14s 规范有 ∧ 代码有定义' % c,
       'spec=%s code=%s' % (in_spec, defined))

# ---------- B. 数值一致性 ----------
print('\n[B] 数值一致性（规范写的 = 代码里的）')

def css_rule(sel):
    """取 `.sel{ ... }` 的声明块（含紧随其后的续行），返回字符串。"""
    i = shell.find(sel + '{')
    if i < 0:
        return ''
    j = shell.find('}', i)
    return shell[i:j + 1]

PAIRS = [
    # (说明, 规范里应出现的串, 代码里应出现的串)
    ('面板 min-width 168px',   '`min-width:168px`',   'min-width:168px'),
    ('面板 border-radius 12px', '圆角 12px',           'border-radius:12px'),
    ('面板 z-index 30',         '`z-index:30`',        'z-index:30'),
    ('列 flex 1 1 auto',        '`flex:1 1 auto`',     'flex:1 1 auto'),
    ('列 min-width 124px',      '`min-width:124px`',   'min-width:124px'),
    ('列 max-width 240px',      '`max-width:240px`',   'max-width:240px'),
    ('列标题 11px/600',         '11px / 600',          'font-size:11px;font-weight:600'),
    ('条目 13px nowrap',        '13px、`nowrap`',      'font-size:13px'),
    ('右创建 flex-shrink:0',    '`flex-shrink:0`',     'flex-shrink:0'),
    ('定位余量 24px',           '− 24px',              '- r.right - 24'),
    ('断点 768px',              '`≤768px`',            '@media(max-width:768px)'),
]
for name, s_need, c_need in PAIRS:
    ck(s_need in sec, '%-24s 规范串 %r' % (name, s_need), 'in_spec=%s' % (s_need in sec))
    ck(c_need in shell, '%-24s 代码串 %r' % (name, c_need), 'in_code=%s' % (c_need in shell))

# ---------- C. 关键机制存在性 ----------
print('\n[C] 关键机制（规范点了名，代码必须有）')
MECH = [
    ('_placePop 给 maxWidth', 'maxWidth: maxW', '_placePop 里'),
    ('navTo 支持 q',          'loc.q',          'navTo 里'),
    ('isCur 逐键比 q',        'Object.keys(q)', 'isCur 里'),
    ('key 带 q',              'JSON.stringify(x.q)', '模板 :key 里'),
    ('抽屉 flatMap 摊平',     'flatMap(sg => sg.items)', 'drawerGroups 里'),
    ('flex-wrap 折行',        'flex-wrap:wrap', '.sb-pop 里'),
]
for name, needle, where in MECH:
    ck(needle in shell, '%-20s 在%s' % (name, where))

# ---------- D. 反例禁令（规范禁止的东西，代码里不许有） ----------
print('\n[D] 反例禁令')
# 头号反例：groups 平铺 —— 即模板里 v-for 直接挂在 .sb-pop 下而无 .sb-pop-col
col_wrap = re.search(r'class="sb-pop-col"', shell) is not None
ck(col_wrap, '模板里有 .sb-pop-col 包一层（非平铺）')

print('\n' + '=' * 60)
if fails:
    print('FAIL %d 项：' % len(fails))
    for f in fails:
        print('  -', f)
    if '--strict' in sys.argv:
        sys.exit(1)
else:
    print('ALL PASS')
