# -*- coding: utf-8 -*-
"""v367 最终版：严格只用 <style> 段 + 全局 CSS 作定义基准，一次钉死结论。

前两版各自踩坑：
  · v363：复合选择器 `.tag.st-draft{}` 只抽到第一个类 ⇒ 虚报
  · 上一版：把整个 src（含模板/脚本）喂给提取器 ⇒ `row.extra` 被当定义 ⇒ 虚报「有」
本版：① 定义集**只**来自 <style> 段与全局 css；② 三条自证断言必须全过才输出。
"""
import re
import os

VUE = 'src/pages/Forecast.vue'
src = open(VUE, encoding='utf-8').read()
i_style = src.find('<style')
i_script = src.find('<script')
i_body = src.find('>', src.find('<template')) + 1
tpl = src[i_body:i_script]
sty = src[i_style:]

strip_css = lambda s: re.sub(r'/\*.*?\*/', '', s, flags=re.S)
strip_html = lambda s: re.sub(r'<!--.*?-->', '', s, flags=re.S)

def classes_in_css(css):
    """从**纯 CSS** 里抽所有 .cls（选择器内全抽，不只开头）"""
    out = set()
    for m in re.finditer(r'([^{}]+)\{', strip_css(css)):
        sel = m.group(1)
        if sel.strip().startswith('@'):
            continue
        for cm in re.finditer(r'\.(-?[_a-zA-Z][_a-zA-Z0-9-]*)', sel):
            out.add(cm.group(1))
    return out

defined_scoped = classes_in_css(sty)
defined_global = set()
for g in ['src/styles/variables.css']:
    if os.path.exists(g):
        defined_global |= classes_in_css(open(g, encoding='utf-8').read())
defined = defined_scoped | defined_global

# ── 自证：三条必须全 True
a1 = 'tag' in defined_scoped          # style 段确有 .tag
a2 = 'st-draft' in defined_scoped     # 复合选择器能抽出 st-draft
a3 = 'card' in defined_global         # 全局 css 确有 .card
a4 = 'extra' not in defined_scoped    # 模板里的 extra 不应污染
print('══ 自证（全 True 才可信）══')
print('  .tag 在 scoped          :', a1)
print('  st-draft 在 scoped      :', a2)
print('  .card 在 global         :', a3)
print('  extra 未被误收          :', a4)
assert a1 and a2 and a3 and a4, '自证失败 ⇒ 结论不可信'
print('  scoped 类数=%d  global 类数=%d' % (len(defined_scoped), len(defined_global)))

# ── 拼接类真实值域（从源码**实证**，不再猜）
print()
print('══ 拼接类真实值域 → 定义检查（基准 = style 段 ∪ 全局）══')
tests = {
    'st-':   ['draft', 'submitted', 'approved', 'rejected', 'revised'],
    'sev-':  ['risk', 'warn', 'info'],
    'has-':  ['void', 'short', 'done', 'gap'],
    'soft-': ['miss', 'over'],
    'oe-c':  ['0', '1', '2', '3'],
}
bad = []
for pfx, vals in tests.items():
    for v in vals:
        f = pfx + v
        ok = f in defined
        if not ok:
            bad.append(f)
        print('  %-14s %s' % (f, '✅ 有定义' if ok else '❌ 零定义'))
print('  ⇒ 拼接类缺定义数 = %d' % len(bad))

# ── 真差集
print()
print('══ 静态/字面量类差集 ══')
tpl_c = strip_html(tpl)
used = {}
def add(c, why):
    if c and re.fullmatch(r'[-_a-zA-Z][-_a-zA-Z0-9]*', c):
        used.setdefault(c, why)
for m in re.finditer(r'(?<![-:\w])class="([^"]*)"', tpl_c):
    for c in m.group(1).split():
        add(c, 'static')
for m in re.finditer(r':class="([^"]*)"', tpl_c):
    e = re.sub(r'[=!]==?\s*\'[^\']*\'', '', m.group(1))
    for km in re.finditer(r"(?:^|[{,\s])(?:'([^']+)'|\"([^\"]+)\"|([_a-zA-Z][-_a-zA-Z0-9]*))\s*:", e):
        k = km.group(1) or km.group(2) or km.group(3)
        if k and k not in ('true', 'false'):
            add(k, 'obj-key')
    for sm in re.finditer(r"'([^']*)'|\"([^\"]*)\"", e):
        s = sm.group(1) or sm.group(2)
        if s:
            add(s, 'literal')
NOISE = {'boxes', 'summary', 'history', 'config', 'target', 'oe-c'}
diff = sorted(k for k in used if k not in defined and k not in NOISE)
print('  差集 = %d' % len(diff))
for k in diff:
    print('    %-16s (%s)' % (k, used[k]))

# ── 幽灵令牌
print()
print('══ 幽灵 CSS 变量 ══')
allref = set(re.findall(r'var\((--[_a-zA-Z0-9-]+)', strip_css(src)))
alldef = set(re.findall(r'(--[_a-zA-Z0-9-]+)\s*:', open('src/styles/variables.css', encoding='utf-8').read()))
alldef |= set(re.findall(r'(--[_a-zA-Z0-9-]+)\s*:', strip_css(sty)))
ghost = sorted(allref - alldef)
print('  幽灵 = %d 个：%s' % (len(ghost), ', '.join(ghost) if ghost else '（无）'))
