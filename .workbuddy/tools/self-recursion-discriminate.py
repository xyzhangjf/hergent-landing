#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""direct-self-recursion-check.py 的判别力自证。

做法：造 5 份源码副本——3 份**故意带回退的写法**（历史真 bug + 两种变形）必须 FAIL，
      2 份**正常自递归**（带递减参数 / 带显式出口）必须 PASS。
      基线（真源码）也必须 PASS。

只对**正例**要求 FAIL —— 若正例 PASS 说明脚本没牙齿（漏报），比没有脚本更危险。

注入方式一律是「**新增**一个函数」，不去改现有代码的文本 ⇒
不依赖任何锚点唯一性，源码改动后本脚本不会失效。
覆盖两条路径：`.vue`（插进 `<script>` 段内）+ `.js`（新建文件）。
"""
import io
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
CHECKER = os.path.join(HERE, 'direct-self-recursion-check.py')
SRC = '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/src'

# (名称, 注入到 .vue 的哪个文件(None=新建.js), 文件名, 代码, 期望)
CASES = [
    ('① 历史真 bug：unitCount 自递归兜底',
     'pages/Forecast.vue', None,
     '\nfunction __probeUnitCount() {\n  return Array.isArray(cross.value.units) ? __probeUnitCount() : 0\n}\n',
     'FAIL'),
    ('② 换名换文件：tier() 自递归兜底',
     None, 'src/utils/__probe_tier.js',
     'export function tier() {\n  return Array.isArray(rows.value) ? tier() : 0\n}\n',
     'FAIL'),
    ('③ 短路形态：|| 兜底也自递归',
     None, 'src/utils/__probe_col.js',
     'export function colCount() {\n  return (rows.value && colCount()) || 0\n}\n',
     'FAIL'),
    ('④ 正常递归：带递减参数（不许误伤）',
     None, 'src/utils/__probe_walk.js',
     'export function walk(n) {\n  return n > 0 ? walk(n - 1) : 0\n}\n',
     'PASS'),
    ('⑤ 正常递归：带显式出口（不许误伤）',
     None, 'src/utils/__probe_sum.js',
     'export function sum(list) {\n  if (!list.length) return 0\n  return list[0] + sum(list.slice(1))\n}\n',
     'PASS'),
]


def run(root):
    p = subprocess.run([sys.executable, CHECKER, root], capture_output=True, text=True)
    return p.returncode, (p.stdout + p.stderr)


def inject(root, vue_target, js_target, code):
    if vue_target:
        path = os.path.join(root, vue_target)
        text = io.open(path, encoding='utf-8').read()
        idx = text.rfind('</script>')
        if idx < 0:
            raise SystemExit('找不到 </script>：%s' % vue_target)
        io.open(path, 'w', encoding='utf-8').write(text[:idx] + code + text[idx:])
    else:
        path = os.path.join(root, js_target)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        io.open(path, 'w', encoding='utf-8').write(code)


def main():
    results = []
    rc, out = run(SRC)
    results.append(('基线（真源码，应 PASS）', rc == 0,
                    (out.strip().splitlines() or [''])[-1]))

    for name, vue_target, js_target, code, expect in CASES:
        tmp = tempfile.mkdtemp(prefix='selfrec_')
        try:
            root = os.path.join(tmp, 'src')
            shutil.copytree(SRC, root)
            inject(root, vue_target, js_target, code)
            rc, out = run(root)
            got = 'FAIL' if rc != 0 else 'PASS'
            hit = [l for l in out.splitlines() if 'FAIL' in l]
            detail = hit[0].strip() if hit else (out.strip().splitlines() or [''])[-1]
            results.append(('%s（应 %s）' % (name, expect), got == expect, detail))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    bad = 0
    for name, ok, detail in results:
        print('%-6s %s\n         %s' % ('PASS' if ok else 'FAIL', name, detail))
        if not ok:
            bad += 1
    print('\n%d/%d 判别力自证通过' % (len(results) - bad, len(results)))
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
