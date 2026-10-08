# ⚠️⚠️ 本脚本**已证实会误报**（2026-10-02 21:10 复核）：
#   ① CSS 复合选择器 `.tag.st-draft{}` 只抽到第一个类 ⇒ 虚报「零定义」
#   ② `\bclass=` 误匹配 `:class=` ⇒ 变量名被当类名
#   ③ 基准缺全局 `src/styles/variables.css`
#   ⇒ 请改用 **v367-class-diff-rigorous.py**（带 4 条自证断言）。留此文件仅为存史。
# ======================================================================
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""对候选类逐个确认：Forecast.vue 的 <style> 段里是否存在「真正的 CSS 选择器定义」
（排除只出现在注释 / JS 查询串 / 模板自身 :class 里的情况）
"""
import sys, re

PAGE, GLOBAL = sys.argv[1], 'src/styles/variables.css'
src = open(PAGE, encoding='utf-8').read()
i_st = src.find('<style')
sty = src[i_st:]
sty_nc = re.sub(r'/\*.*?\*/', '', sty, flags=re.S)     # 去 CSS 注释
glo_nc = re.sub(r'/\*.*?\*/', '', open(GLOBAL, encoding='utf-8').read(), flags=re.S)
tpl = src[:src.find('<script')]

CANDS = ['bi-panel', 'btn-retry', 'ctx-ipt-fill', 'ctx-paste', 'err-panel', 'spark-th',
         'pc-modal', 'pe-modal', 'tb-act', 'tb-ctx', 'tb-data', 'th', 'has-warn', 'has-err',
         'sev-high', 'soft-warn', 'st-open']

print("类名              页面style  全局css  备注")
print("-" * 74)
for c in CANDS:
    # 选择器形态：.xxx 后面跟 { , . : > 空格 # [ 或行尾
    pat = re.compile(r'\.%s(?=[\s,{:>~+.#\[])' % re.escape(c))
    inpage = bool(pat.search(sty_nc))
    inglob = bool(pat.search(glo_nc))
    note = []
    if c in tpl and not inpage and not inglob:
        note.append('模板用到但无定义')
    if c == 'pc-modal':
        note.append('定义在 PriceChannels.vue（他页 scoped）')
    print("%-17s %-9s %-8s %s" % (c, '✅有' if inpage else '❌无', '✅有' if inglob else '❌无',
                                  ' '.join(note)))
