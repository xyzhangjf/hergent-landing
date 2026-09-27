#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v300 第三产物编译校验（按文件类型分派）。

🔴 为什么不能"看一眼就提交"：`.js` / `.vue` / `.py` 三种文件的语法边界不同，
   用错工具会**假绿**（例如把 ESM 的 `.js` 直接丢给 `node --check`，Node 会按 CJS
   解析并报 `Cannot use import statement outside a module` —— 看起来"我的代码坏了"，
   实际是校验方法错了）。所以按扩展名分派：

   · `.js`  → 复制成 `.mjs` 再 `node --check`（ESM/CJS 由扩展名决定，不是内容）
   · `.vue` → 仓库自带 `@vue/compiler-sfc`：parse + compileScript + compileTemplate
   · `.py`  → `py_compile`

另附**跨文件符号闭包**：从被改文件里抽出 `import { a, b } from './x'`，
  去源文件里确认 `export` 真的存在 —— 防「改了 import 但导出名字写错」。

用法：
    python3 .workbuddy/tools/v300-compile-check.py <文件> [<文件> ...]
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile

NODE = '/Users/zhangjunfeng/.workbuddy/binaries/node/versions/22.22.2-3/bin/node'
PY = '/Users/zhangjunfeng/.workbuddy/binaries/python/versions/3.13.12/bin/python3'
HERE = os.path.dirname(os.path.abspath(__file__))
FE_REPO = os.path.dirname(os.path.dirname(HERE))
FE_SRC = os.path.join(FE_REPO, 'hergent-cn-v2', 'src')
NODE_MODULES = os.path.join(FE_REPO, 'hergent-cn-v2', 'node_modules')

PASS, FAIL, SKIP = [], [], []


def _run(cmd, env=None):
    return subprocess.run(cmd, capture_output=True, text=True, timeout=180, env=env)


# ---------------------------------------------------------------- .vue

VUE_CHECK_JS = r'''
const path = require('path')
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc')
const fs = require('fs')
const file = process.argv[2]
const src = fs.readFileSync(file, 'utf8')
const { descriptor, errors } = parse(src, { filename: file })
if (errors && errors.length) { console.error('PARSE: ' + errors.map(e => e.message || e).join(' | ')); process.exit(2) }
try { compileScript(descriptor, { id: 'v300chk' }) } catch (e) { console.error('SCRIPT: ' + e.message); process.exit(3) }
if (descriptor.template) {
  const t = compileTemplate({ source: descriptor.template.content, filename: file, id: 'v300chk' })
  if (t.errors && t.errors.length) { console.error('TEMPLATE: ' + t.errors.map(e => e.message || e).join(' | ')); process.exit(4) }
}
console.log('OK')
'''


def check_vue(path):
    with tempfile.NamedTemporaryFile('w', suffix='.cjs', delete=False, encoding='utf-8') as f:
        f.write(VUE_CHECK_JS)
        tmp = f.name
    env = dict(os.environ)
    env['NODE_PATH'] = os.path.join(NODE_MODULES)
    try:
        r = _run([NODE, tmp, path], env=env)
    finally:
        os.unlink(tmp)
    return r.returncode == 0, (r.stdout + r.stderr).strip()


# ---------------------------------------------------------------- .js

def check_js(path):
    """🔴 必须先改扩展名为 .mjs —— ESM/CJS 由扩展名决定，内容不作数。"""
    tmp = tempfile.NamedTemporaryFile('w', suffix='.mjs', delete=False, encoding='utf-8')
    tmp.close()
    shutil.copyfile(path, tmp.name)
    try:
        r = _run([NODE, '--check', tmp.name])
    finally:
        os.unlink(tmp.name)
    return r.returncode == 0, (r.stdout + r.stderr).strip()


# ---------------------------------------------------------------- .py

def check_py(path):
    r = _run([PY, '-m', 'py_compile', path])
    return r.returncode == 0, (r.stdout + r.stderr).strip()


# ---------------------------------------------------------------- 跨文件符号闭包

def import_closure(path):
    """从文件里抽出 `import { a, b } from './x'` 并验证 a/b 在源文件里被 export。

    返回 [(符号, 源文件, 是否存在), ...]。`./x` 解析：先试 `src/x.js`，再试 `src/x/index.js`。
    """
    if not os.path.isfile(path):
        return []
    src = open(path, encoding='utf-8').read()
    out = []
    for m in re.finditer(r"import\s*\{([^}]+)\}\s*from\s*'(\.[^']+)'", src):
        syms = [s.strip().split(' as ')[0].strip() for s in m.group(1).split(',') if s.strip()]
        rel = m.group(2)
        base = os.path.normpath(os.path.join(os.path.dirname(path), rel))
        for cand in (base + '.js', base + '.vue', os.path.join(base, 'index.js')):
            if os.path.isfile(cand):
                target = open(cand, encoding='utf-8').read()
                for s in syms:
                    ok = bool(re.search(
                        r"export\s+(?:default\s+)?(?:async\s+)?(?:const|function|let|var|class)\s+%s\b" % re.escape(s),
                        target)) \
                        or bool(re.search(r"export\s*\{[^}]*\b%s\b" % re.escape(s), target))
                    out.append((s, os.path.relpath(cand, FE_REPO), ok))
                break
        else:
            out.append((','.join(syms), rel + '（未找到源文件）', False))
    return out


def main():
    files = sys.argv[1:]
    if not files:
        print('用法：python3 v300-compile-check.py <文件> [...]')
        return 2
    for p in files:
        ext = os.path.splitext(p)[1].lower()
        name = os.path.relpath(p, os.path.dirname(HERE))
        if not os.path.isfile(p):
            SKIP.append(name)
            print('  SKIP  %s（不存在）' % name)
            continue
        if ext == '.vue':
            ok, msg = check_vue(p)
        elif ext == '.js' or ext == '.mjs':
            ok, msg = check_js(p)
        elif ext == '.py':
            ok, msg = check_py(p)
        else:
            SKIP.append(name)
            print('  SKIP  %s（无对应校验器）' % name)
            continue
        (PASS if ok else FAIL).append(name)
        print(('  PASS  ' if ok else '  FAIL  ') + name + (('   [' + msg[:220] + ']') if msg else ''))

    # 跨文件符号闭包（只对 .vue/.js 做）
    print('')
    print('跨文件符号闭包（import 的每个符号都必须在源文件里真的 export）')
    bad = 0
    total = 0
    for p in files:
        if os.path.splitext(p)[1].lower() not in ('.vue', '.js'):
            continue
        for sym, tgt, ok in import_closure(p):
            if tgt.endswith('（未找到源文件）'):
                continue
            total += 1
            if not ok:
                bad += 1
                print('  FAIL  %s ← %s 未在 %s 中 export' % (sym, os.path.basename(p), tgt))
            else:
                print('  ok    %s ← %s' % (sym, tgt))
    if total and bad == 0:
        PASS.append('符号闭包 %d/%d' % (total, total))
    elif bad:
        FAIL.append('符号闭包 %d 个缺失' % bad)

    print('')
    print('-' * 62)
    print('通过 %d / 失败 %d / 跳过 %d' % (len(PASS), len(FAIL), len(SKIP)))
    if FAIL:
        for f in FAIL:
            print('   ✗ ' + f)
    return 1 if FAIL else 0


if __name__ == '__main__':
    sys.exit(main())
