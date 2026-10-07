# -*- coding: utf-8 -*-
"""v392 判据：进销存页面里**不许出现英文枚举被直接渲染**（UI 文案守则 C 类）。

为什么另写一个而不是复用 grep：
  · 用 grep 匹配「`{{ … .status … }}`」会**大面积假红** —— 正确的写法
    `{{ textOf(PO_STATUS, r.status) }}` 里也含 `.status`。
    实测第一版 grep 给出 8 条命中，**8 条全是假红**（全是 `textOf(...)` 包装）。
    ⇒ 判据必须区分「属性访问本身就是要渲染的值」和「属性访问只是喂给映射函数的入参」。
  · 假红会让人学会忽略脚本（本项目 v326 的原始教训）⇒ 宁可写准。

判据（对每个 `{{ … }}` 插值 / 每个 `:attr="…"` 表达式）：
  1. 取出表达式里出现的 `<obj>.<field>`，`field ∈ ENUM_FIELDS`；
  2. 若该属性访问**被包在已知的映射函数里**（`textOf(` / `tagOf(` / 白名单函数名）
     ⇒ 放行（值先过词表）；
  3. 否则**违规**，除非它处在三元里且两个分支都是中文字面量
     （`x === 'draft' ? '草稿' : '未确认'` —— 这种情况值域已被穷举，但**仍应报 🟡**
       因为它没走唯一词表 ⇒ 后端加枚举值就会漏；本脚本按违规报，要求改用 textOf）。

自证（跑一次即打印，无需另写测试）：
  ① 反例必红：4 种真实违规形态
  ② 正例不许误伤：本轮真实使用的 4 种合规写法
"""
import os
import re
import sys

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                    'hergent-cn-v2', 'src')
TARGETS = [os.path.join(ROOT, 'pages', 'inventory'), os.path.join(ROOT, 'constants', 'psiLabels.js')]

ENUM_FIELDS = ['status', 'order_type', 'expiry_status', 'delivery_status',
               'approval_status', 'invoice_status', 'wh_type']
# 允许的「先过词表」包装函数（进销存页面里唯一合法的一组）
WRAPPERS = ['textOf', 'tagOf', 'orderTypeText']

PROP = re.compile(r"([A-Za-z_$][\w$]*\.(?:%s))\b" % '|'.join(ENUM_FIELDS))
INTERP = re.compile(r"\{\{(.*?)\}\}", re.S)
ATTR_EXPR = re.compile(r':[a-zA-Z-]+="([^"]*)"')
ZH = re.compile(r"['\"][^'\"]*[\u4e00-\u9fff][^'\"]*['\"]")


def scan_text(text):
    """返回 [(命中片段, 表达式)]。"""
    hits = []
    for m in INTERP.finditer(text):
        expr = m.group(1).strip()
        hits += _judge(expr, m.group(0).strip())
    for m in ATTR_EXPR.finditer(text):
        expr = m.group(1).strip()
        # 属性表达式里只有「属性访问本身就是值」才算渲染；`:class="tagOf(...)"` 是喂函数
        hits += _judge(expr, m.group(0).strip(), attr=True)
    return hits


def _judge(expr, raw, attr=False):
    out = []
    for pm in PROP.finditer(expr):
        prop = pm.group(1)
        # 是否被包在词表函数里？取属性访问左侧最近的标识符
        left = expr[:pm.start()]
        wrapped = False
        for w in WRAPPERS:
            # `textOf(PO_STATUS, r.status)` —— 只要该属性访问处在某个 wrapper 的括号内即算
            idx = left.rfind(w + '(')
            if idx >= 0 and left.count('(', idx) > left.count(')', idx):
                wrapped = True
                break
        if wrapped:
            continue
        # 三元里两分支都是中文字面量 —— 仍然报（没走唯一词表）
        out.append((raw, prop))
    return out


def selftest():
    print('\n── 自证 ① 反例必红（真实违规形态） ──')
    bad = [
        ('<td>{{ r.status }}</td>', '裸插值'),
        ('<td>{{ o.order_type }}</td>', '裸插值（出货方式）'),
        ('<td>{{ ST_LABEL[p.status] || p.status }}</td>', '兜底回落英文'),
        ("<td>{{ x.status === 'draft' ? '草稿' : x.status }}</td>", '三元里一侧回落英文'),
        ('<span :title="r.expiry_status"></span>', '属性表达式裸渲染'),
    ]
    for src, why in bad:
        got = scan_text(src)
        flag = 'PASS' if got else 'FAIL'
        print(f'  {flag}  反例[{why}] 命中 {len(got)} | {src.strip()}')
        if not got:
            FAIL.append('自证①：' + why)
        else:
            PASS.append('自证①：' + why)

    print('\n── 自证 ② 正例不许误伤（本轮真实写法） ──')
    good = [
        ('<span class="tag" :class="tagOf(PO_STATUS, r.status)">{{ textOf(PO_STATUS, r.status) }}</span>', '词表包装'),
        ('<td>{{ orderTypeText(r.order_type) }}</td>', '白名单函数'),
        ('{{ textOf(EXPIRY_STATUS, r.expiry_status) }}', '词表包装（效期）'),
        ('<span class="tag" :class="tagOf(SO_STATUS, o.status)">{{ textOf(SO_STATUS, o.status) }}</span>', '词表包装（销售）'),
    ]
    for src, why in good:
        got = scan_text(src)
        flag = 'PASS' if not got else 'FAIL'
        print(f'  {flag}  正例[{why}] 命中 {len(got)} | {src.strip()[:70]}')
        if got:
            FAIL.append('自证②误伤：' + why)
        else:
            PASS.append('自证②：' + why)


PASS, FAIL = [], []


def main():
    print('=' * 74)
    print('v392 判据：进销存页面「英文枚举直接渲染」检查')
    print('=' * 74)
    selftest()

    print('\n── ③ 扫描真实文件 ──')
    files = []
    for t in TARGETS:
        if os.path.isdir(t):
            files += [os.path.join(t, f) for f in sorted(os.listdir(t)) if f.endswith('.vue')]
        elif os.path.isfile(t):
            files.append(t)
    print(f'  扫描 {len(files)} 个文件')
    total = 0
    for f in files:
        with open(f, encoding='utf-8') as fh:
            hits = scan_text(fh.read())
        if hits:
            total += len(hits)
            print(f'  🔴 {os.path.relpath(f, ROOT)}  ({len(hits)} 处)')
            for raw, prop in hits:
                print(f'      [{prop}] {raw[:110]}')
    if total:
        FAIL.append(f'真实文件命中 {total} 处')
    else:
        PASS.append('真实文件 0 处裸枚举渲染')
    print(f'  真实文件命中：{total} 处')

    print('\n' + '=' * 74)
    print(f'PASS {len(PASS)} / FAIL {len(FAIL)}')
    for f in FAIL:
        print('  ❌ ' + f)
    print('=' * 74)
    return 1 if FAIL else 0


if __name__ == '__main__':
    sys.exit(main())
