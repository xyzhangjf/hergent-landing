#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""SFC 自由变量审计 —— 用真实 AST 找出「被引用但没有任何绑定」的标识符。

为什么需要它（v219 scoped commit 实测）：
  「范围化暂存」会从工作区里**摘掉**一部分 hunk（别人的在途 / 本轮刻意不提交的），
  生成一个**从未被人跑过**的第三产物。此时真正的风险不是语法错，而是
  **引用了一个被摘掉的定义** —— `vite build` 不会报（esbuild 不解析自由变量）、
  `node --check` 不会报（语法合法）、`sfc-symbols.contract.mjs` 也不会报（它只查模板→script 方向）。
  只有真机跑起来才炸，而那时已经提交上线了。

判据（本工具）：
  ① 绑定集 B  = 脚本里**出现在绑定位**的全部标识符（变量/函数/类/形参/catch/import）
  ② 引用集 R  = 全部**引用位**标识符（跳过 `a.b` 的 b、`{k: v}` 的 k 等非计算属性名）
  ③ 自由变量 F = R − B − 全局白名单
  `--baseline` 传一份“已知正常”的同类文件（通常是 HEAD 版），输出 **F − F(baseline)**
  ⇒ 「相对基线**新出现**的自由变量」就是这次切分真正制造出来的洞，一眼可审。

⚠️ 它是**近似**而非完备：不做精确作用域链（同名局部变量会互相遮掩），
   因此只能用来抓「摘掉定义但留下引用」这一类，抓不到「作用域遮蔽」那种。
   这与 scoped commit 的场景正好吻合 —— 我们摘的是**定义**，不是改动作用域结构。

用法：
  python3 sfc-freevar-audit.py <file.vue> [--baseline <other.vue>]
"""
import json
import os
import subprocess
import sys

NODE = "/Users/zhangjunfeng/.workbuddy/binaries/node/versions/22.22.2-3/bin/node"
FE = "/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2"

# ── 内嵌的 node 侧脚本：真解析 + 真遍历 ─────────────────────────────────────
NODE_SCRIPT = r"""
const fs = require('fs')
const path = require('path')
const FE = process.env.FE
const sfc = require(path.join(FE, 'node_modules/@vue/compiler-sfc'))
const babel = require(path.join(FE, 'node_modules/@babel/parser'))

const file = process.env.TARGET
const src = fs.readFileSync(file, 'utf8')
let code
if (file.endsWith('.vue')) {
  const { descriptor, errors } = sfc.parse(src, { filename: file })
  if (errors && errors.length) {
    console.error('SFC_PARSE_ERROR: ' + errors.map(e => e.message).join(' | '))
    process.exit(3)
  }
  const blk = descriptor.scriptSetup || descriptor.script
  if (!blk) { console.log(JSON.stringify({ bind: [], ref: [], err: 'NO_SCRIPT_BLOCK' })); process.exit(0) }
  code = blk.content
} else {
  code = src
}

let ast
try {
  ast = babel.parse(code, { sourceType: 'module', errorRecovery: false, plugins: ['jsx'] })
} catch (e) {
  console.error('BABEL_PARSE_ERROR: ' + e.message)
  process.exit(4)
}

const bind = new Set()
const ref = new Set()

function pat(n) {            // 收集一个「绑定模式」里的全部标识符
  if (!n) return
  switch (n.type) {
    case 'Identifier': bind.add(n.name); break
    case 'ObjectPattern': n.properties.forEach(p => pat(p.value !== undefined ? p.value : p)); break
    case 'ArrayPattern': n.elements.forEach(pat); break
    case 'RestElement': pat(n.argument); break
    case 'AssignmentPattern': pat(n.left); break
    case 'Property': pat(n.value); break
    case 'ExperimentalRestProperty': pat(n.argument); break
    default: break
  }
}

function walk(n, skipBindOf) {
  if (!n || typeof n.type !== 'string') return
  switch (n.type) {
    case 'VariableDeclarator':
      if (n.id) pat(n.id)
      walk(n.init); return
    case 'FunctionDeclaration':
    case 'FunctionExpression':
      if (n.id) bind.add(n.id.name)
      ;(n.params || []).forEach(pat)
      walk(n.body); return
    case 'ArrowFunctionExpression':
      ;(n.params || []).forEach(pat)
      walk(n.body); return
    case 'ClassDeclaration':
    case 'ClassExpression':
      if (n.id) bind.add(n.id.name)
      walk(n.superClass); walk(n.body); return
    case 'CatchClause':
      pat(n.param); walk(n.body); return
    case 'ImportDeclaration':
      ;(n.specifiers || []).forEach(s => { if (s.local) bind.add(s.local.name) })
      return
    case 'MemberExpression':
      walk(n.object)
      if (n.computed) walk(n.property)      // a[b] 的 b 是引用；a.b 的 b 不是
      return
    case 'OptionalMemberExpression':
      walk(n.object)
      if (n.computed) walk(n.property)
      return
    case 'ObjectProperty':
    case 'Property':
      if (n.computed) walk(n.key)
      else if (n.shorthand) ref.add(n.key.name)
      walk(n.value); return
    case 'ObjectMethod':
      if (n.computed) walk(n.key)
      ;(n.params || []).forEach(pat)
      walk(n.body); return
    case 'ClassMethod':
    case 'ClassProperty':
    case 'PropertyDefinition':
      if (n.computed && n.key) walk(n.key)
      if (n.value) walk(n.value)
      return
    case 'LabeledStatement':
      walk(n.body); return            // 标签名不是变量引用
    case 'BreakStatement':
    case 'ContinueStatement':
      return
    case 'Identifier':
      ref.add(n.name); return
    case 'JSXIdentifier':
      return
    default:
      for (const k of Object.keys(n)) {
        if (k === 'loc' || k === 'start' || k === 'end' || k === 'leadingComments' ||
            k === 'trailingComments' || k === 'innerComments' || k === 'extra') continue
        const v = n[k]
        if (Array.isArray(v)) v.forEach(x => { if (x && typeof x.type === 'string') walk(x) })
        else if (v && typeof v.type === 'string') walk(v)
      }
      return
  }
}
walk(ast.program)

console.log(JSON.stringify({ bind: [...bind], ref: [...ref] }))
"""

GLOBALS = set("""
window document navigator location localStorage sessionStorage console alert confirm prompt
setTimeout clearTimeout setInterval clearInterval requestAnimationFrame cancelAnimationFrame
Math JSON Date Number String Boolean Array Object Function Symbol BigInt Promise Map Set WeakMap
WeakSet RegExp Error TypeError RangeError SyntaxError parseInt parseFloat isNaN isFinite
encodeURIComponent decodeURIComponent encodeURI decodeURI structuredClone queueMicrotask
getComputedStyle getSelection matchMedia MutationObserver IntersectionObserver ResizeObserver
fetch XMLHttpRequest Blob URL URLSearchParams FileReader Image TextEncoder TextDecoder
CustomEvent Event KeyboardEvent MouseEvent ClipboardEvent AbortController performance crypto
atob btoa DOMParser Element HTMLElement Node CSS requestIdleCallback cancelIdleCallback
undefined null true false NaN Infinity globalThis arguments this super new typeof instanceof in of
await async yield return if else for while do switch case default break continue try catch finally
throw delete void let const var function class extends import export from as static get set
Vue ref reactive computed watch watchEffect onMounted onUnmounted nextTick defineProps defineEmits
defineExpose defineOptions useRoute useRouter store
""".split())


def run(path):
    env = dict(os.environ, FE=FE, TARGET=os.path.abspath(path))
    r = subprocess.run([NODE, "-e", NODE_SCRIPT],
                       capture_output=True, text=True, env=env)
    if r.returncode != 0:
        print("🔴 解析失败（%s）：%s" % (path, r.stderr.strip()[:400]))
        return None
    return json.loads(r.stdout)


def freevars(path):
    d = run(path)
    if d is None:
        return None
    bind, ref = set(d["bind"]), set(d["ref"])
    return sorted(ref - bind - GLOBALS)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    target = sys.argv[1]
    baseline = None
    if "--baseline" in sys.argv:
        baseline = sys.argv[sys.argv.index("--baseline") + 1]

    f_t = freevars(target)
    if f_t is None:
        sys.exit(1)
    print("=" * 72)
    print("目标：%s" % target)
    if baseline:
        f_b = freevars(baseline) or []
        print("基线：%s（自由变量 %d 个）" % (baseline, len(f_b)))
        new = sorted(set(f_t) - set(f_b))
        gone = sorted(set(f_b) - set(f_t))
        print("── 🔴 相对基线**新出现**的自由变量（%d）──" % len(new))
        for n in new:
            print("   ", n)
        if gone:
            print("── 相对基线**消失**的（%d，通常是好事：摘掉了整个块）──" % len(gone))
            for n in gone:
                print("   ", n)
        print("=" * 72)
        if new:
            print("裁定：✗ 有新增自由变量 ⇒ 切分摘掉了某些定义却留下了引用")
            sys.exit(1)
        print("裁定：✓ 无新增自由变量（切分没有制造未绑定引用）")
    else:
        print("自由变量（%d）：%s" % (len(f_t), ", ".join(f_t) if f_t else "（无）"))
        print("=" * 72)
        sys.exit(0 if not f_t else 1)


main()
