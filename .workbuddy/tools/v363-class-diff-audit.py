# ⚠️⚠️ 本脚本**已证实会误报**（2026-10-02 21:10 复核）：
#   ① CSS 复合选择器 `.tag.st-draft{}` 只抽到第一个类 ⇒ 虚报「零定义」
#   ② `\bclass=` 误匹配 `:class=` ⇒ 变量名被当类名
#   ③ 基准缺全局 `src/styles/variables.css`
#   ⇒ 请改用 **v367-class-diff-rigorous.py**（带 4 条自证断言）。留此文件仅为存史。
# ======================================================================
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""§7.1 类差集审计（提取器修正版）
修正：① 静态 class 用负向后顾排除 :class / @class
      ② :class 表达式先删「比较式」再取字面量，避免把变量名当类名
      ③ 取对象语法 { key: ... } 的键名
"""
import sys, re

PAGE = sys.argv[1]
GLOBAL = 'src/styles/variables.css'
src = open(PAGE, encoding='utf-8').read()
lines = src.split('\n')
i_s = src.find('<script'); i_st = src.find('<style', i_s)
tpl = '\n'.join(lines[:src[:i_s].count('\n')])
sty = '\n'.join(lines[src[:i_st].count('\n'):])
tpl_nc = re.sub(r'<!--.*?-->', lambda m: '\n' * m.group(0).count('\n'), tpl, flags=re.S)
sty_nc = re.sub(r'/\*.*?\*/', '', sty, flags=re.S)
glo_nc = re.sub(r'/\*.*?\*/', '', open(GLOBAL, encoding='utf-8').read(), flags=re.S)


def from_binding(expr):
    e = re.sub(r"===?\s*'[^']*'", '', expr)
    e = re.sub(r"!==?\s*'[^']*'", '', e)
    out = set(re.findall(r"'([A-Za-z][\w-]*)'", e))
    for obj in re.findall(r'\{([^{}]*)\}', e):
        for part in obj.split(','):
            if ':' in part:
                k = part.split(':')[0].strip().strip("'\"")
                if re.fullmatch(r'[A-Za-z][\w-]*', k):
                    out.add(k)
    return out


used = {}
for i, l in enumerate(tpl_nc.split('\n')):
    for m in re.finditer(r'(?<![:@\w-])class="([^"]*)"', l):
        for c in m.group(1).split():
            if re.fullmatch(r'[A-Za-z][\w-]*', c):
                used.setdefault(c, (i + 1, l.strip()))
    for m in re.finditer(r":class=\"([^\"]*)\"", l):
        for c in from_binding(m.group(1)):
            used.setdefault(c, (i + 1, l.strip()))

defined = set(re.findall(r'\.([A-Za-z][\w-]*)', sty_nc)) | set(re.findall(r'\.([A-Za-z][\w-]*)', glo_nc))
diff = sorted(set(used) - defined)

print("模板用到类 = %d | 已定义 = %d | 差集 = %d\n" % (len(used), len(defined), len(diff)))
for c in diff:
    ln, ctx = used[c]
    tag = '拼接前缀' if c.endswith('-') else '★需查'
    print("  %-16s L%-6d [%s] %s" % (c, ln, tag, ctx[:108]))
