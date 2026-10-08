# ⚠️⚠️ 本脚本**已证实会误报**（2026-10-02 21:10 复核）：
#   ① CSS 复合选择器 `.tag.st-draft{}` 只抽到第一个类 ⇒ 虚报「零定义」
#   ② `\bclass=` 误匹配 `:class=` ⇒ 变量名被当类名
#   ③ 基准缺全局 `src/styles/variables.css`
#   ⇒ 请改用 **v367-class-diff-rigorous.py**（带 4 条自证断言）。留此文件仅为存史。
# ======================================================================
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v363 Forecast.vue 对照 docs/UI-SPEC.md 的合规审计
判据全部来自 UI-SPEC.md：§1.5 圆角四档 / §1.6 阴影令牌 / §1.7 z-index 令牌 /
§2.2 控件高度两档 / §6.3 页面类前缀 / §7.1 类差集=0 / §3.3 断点 / §4.1 弹窗 a11y
"""
import sys, re, os

PAGE = sys.argv[1]                      # src/pages/Forecast.vue
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(PAGE)))
GLOBAL = os.path.join(ROOT, 'src/styles/variables.css')

src = open(PAGE, encoding='utf-8').read()
lines = src.split('\n')
i_s = src.find('<script'); i_st = src.find('<style', i_s)
tpl = '\n'.join(lines[:src[:i_s].count('\n')])
sty = '\n'.join(lines[src[:i_st].count('\n'):])
sty_off = src[:i_st].count('\n')          # style 段起始行(0-based)

def rep(title, rows, hint=''):
    print("\n### %s%s" % (title, ('   ← ' + hint) if hint else ''))
    if not rows:
        print("   ✅ 无不符合项")
    for r in rows:
        print("   L%-6d %s" % (r[0], r[1][:118]))

# ── §1.7 z-index 必须走令牌（自 v241 收敛）
z = [(sty_off + i + 1, l.strip()) for i, l in enumerate(sty.split('\n'))
     if re.search(r'z-index\s*:', l) and not re.search(r'z-index\s*:\s*var\(', l)]
rep("§1.7 z-index 硬编码（须用 --z-* 令牌）", z)

# ── §1.5 圆角只有四档 sm/md/lg/xl
R = [(sty_off + i + 1, l.strip()) for i, l in enumerate(sty.split('\n'))
     if re.search(r'border-radius\s*:\s*[^v;]*\d', l) and 'var(' not in l.split('border-radius')[1][:24]]
rep("§1.5 圆角字面量（只有四档令牌）", R)

# ── §1.6 阴影不得写字面量
SH = [(sty_off + i + 1, l.strip()) for i, l in enumerate(sty.split('\n'))
      if 'box-shadow' in l and 'rgba(' in l.split('box-shadow', 1)[1][:60]and 'var(' not in l.split('box-shadow', 1)[1][:20]]
rep("§1.6 box-shadow 字面量（须用 --shadow-*）", SH)

# ── §2.2 控件高度只有 40px / 32px 两档
H = []
for i, l in enumerate(sty.split('\n')):
    for m in re.finditer(r'\bheight\s*:\s*(\d+(?:\.\d+)?)px', l):
        v = float(m.group(1))
        if v not in (30.0, 32.0, 36.0, 40.0):     # 30=.btn-icon 36=.btn
            H.append((sty_off + i + 1, 'height:%spx  %s' % (m.group(1), l.strip()[:88])))
rep("§2.2 控件高度档外值（规范只认 40/.input 与 32/.fld；30=.btn-icon，36=.btn）", H)

# ── §3.3 断点
media = re.findall(r'@media[^{]*', sty)
print("\n### §3.3 断点 @media")
print("   共 %d 条：%s" % (len(media), ' | '.join(m.strip() for m in media) or '（无）'))
print("   %s 表单型必须有 640px 断点" % ('✅ 有 640px' if any('640' in m for m in media) else '⚠️ 无 640px'))

# ── §7.1 类差集 = 模板类 − (页面 style 类 ∪ 全局 variables.css 类)
tpl_nc = re.sub(r'<!--.*?-->', '', tpl, flags=re.S)
used = set()
for m in re.finditer(r'class="([^"]*)"', tpl_nc):
    for c in m.group(1).split():
        if c and not c.startswith('{') and '}' not in c and '$' not in c and "'" not in c:
            used.add(c)
for m in re.finditer(r":class=\"([^\"]*)\"", tpl_nc):
    for c in re.findall(r"'([A-Za-z][\w-]*)'", m.group(1)):
        used.add(c)
sty_nc = re.sub(r'/\*.*?\*/', '', sty, flags=re.S)
glo = re.sub(r'/\*.*?\*/', '', open(GLOBAL, encoding='utf-8').read(), flags=re.S)
defined = set(re.findall(r'\.([A-Za-z][\w-]*)', sty_nc)) | set(re.findall(r'\.([A-Za-z][\w-]*)', glo))
diff = sorted(used - defined)
print("\n### §7.1 类差集审计（模板用到 − 已定义，须为 0）")
print("   模板用到 %d 个类 · 差集 %d 个" % (len(used), len(diff)))
print("   %s" % ('✅ 差集为 0' if not diff else '⚠️ 零定义类：' + ', '.join(diff[:30])))

# ── §6.3 页面 scoped 只允许本页前缀的类
pref = re.findall(r'\.([a-z]{2,4})-', sty_nc)
from collections import Counter
top = Counter(pref).most_common(8)
print("\n### §6.3 页面 scoped 类前缀分布（页面私有类须带本页前缀）")
print("   " + ' | '.join('%s- (%d)' % (p, c) for p, c in top))

# ── §2.1 .btn-primary 每屏最多一个
print("\n### §2.1 主操作按钮数量（每屏最多一个）")
print("   模板里 .btn-primary = %d" % len(re.findall(r'btn-primary', tpl_nc)))

# ── §4.1 弹窗 5 条
print("\n### §4.1 弹窗语义（role=dialog / aria-modal / Esc）")
print("   role=\"dialog\"   = %d" % len(re.findall(r'role="dialog"', tpl_nc)))
print("   aria-modal       = %d" % len(re.findall(r'aria-modal', tpl_nc)))
print("   aria-labelledby  = %d" % len(re.findall(r'aria-labelledby', tpl_nc)))
print("   Esc 处理         = %d" % len(re.findall(r"'Escape'|\"Escape\"|=== 'Esc'|Escape", src)))

# ── §5.7 图标按钮须有 aria-label 或 title
icon_btn = re.findall(r'<button[^>]*>\s*<Icon[^>]*/>\s*</button>', tpl_nc)
no_lbl = [b for b in icon_btn if 'title=' not in b and 'aria-label' not in b]
print("\n### §5.7 纯图标按钮缺 aria-label/title")
print("   纯图标按钮 = %d ；缺标签 = %d" % (len(icon_btn), len(no_lbl)))
for b in no_lbl[:6]:
    print("      %s" % b[:110])
