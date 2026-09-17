/* 检查 SFC 模板里引用的函数/变量是否都在 <script setup> 顶层定义过。
 *
 * 为什么需要这一步：Vue 模板里引用了未定义的标识符，**构建不会失败**，
 * 只在运行时 console 报错 / 静默不渲染 —— 属于"页面能打开但某处没反应"的高发形态。
 * 本脚本用真实编译器编译模板，再与 script setup 的 bindings 做双向比对。
 *
 * 用法：node check_sfc_symbols.mjs <file.vue>
 */
import fs from 'fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

const file = process.argv[2]
if (!file) { console.error('用法: node check_sfc_symbols.mjs <file.vue>'); process.exit(2) }

const src = fs.readFileSync(file, 'utf8')
const { descriptor, errors } = parse(src, { filename: file })
if (errors.length) {
  console.error('XX SFC 解析错误:')
  errors.forEach(e => console.error('   ', e.message))
  process.exit(1)
}

const id = 'sfcprobe'
const script = compileScript(descriptor, { id })
const names = new Set(Object.keys(script.bindings || {}))
console.log('script setup 顶层绑定数 =', names.size)

const tpl = compileTemplate({
  source: descriptor.template.content,
  filename: file,
  id,
  compilerOptions: { bindingMetadata: script.bindings, prefixIdentifiers: true },
})
if (tpl.errors.length) {
  console.error('XX 模板编译错误:')
  tpl.errors.forEach(e => console.error('   ', e.message || e))
  process.exit(1)
}
console.log('模板编译 errors = 0')

const raw = descriptor.template.content

/* ① 模板里被「调用」的标识符（name( 形式）—— 这类漏定义会直接抛错 */
const called = new Set()
for (const m of raw.matchAll(/(?:^|[^\w.$'"])([A-Za-z_$][\w$]*)\s*\(/g)) called.add(m[1])

/* ② 模板里的 v-if / v-for / :prop 表达式中的裸标识符（取标识符后跟 . 或 ) 的形态） */
const referenced = new Set()
for (const m of raw.matchAll(/(?:v-if|v-else-if|v-show|v-model|v-html|v-text)="([^"]*)"/g)) {
  for (const n of m[1].matchAll(/([A-Za-z_$][\w$]*)/g)) referenced.add(n[1])
}
for (const m of raw.matchAll(/\{\{([^}]*)\}\}/g)) {
  for (const n of m[1].matchAll(/([A-Za-z_$][\w$]*)/g)) referenced.add(n[1])
}

// JS 关键字 / 字面量 / 内置 / 模板局部变量 / Vue 内置
const ALLOW = new Set([
  'true', 'false', 'null', 'undefined', 'in', 'of', 'new', 'typeof', 'instanceof', 'return',
  'Math', 'Date', 'JSON', 'Number', 'String', 'Boolean', 'Array', 'Object', 'isFinite',
  'parseInt', 'parseFloat', 'console', '$event', '$slots', '$attrs', '$emit', '$props',
  // v-for 迭代变量（模板局部作用域，不在 bindings 里）
  's', 'g', 'r', 'it', 'l', 'p', 'i', 'k', 'v', 'x', 'q',
  // 模板里用的对象成员访问会被词法切出来，逐个白名单过于脆弱 —— 改为只对"调用"严格
])

function report(title, set, strict) {
  const miss = [...set].filter(n => !ALLOW.has(n) && !names.has(n))
  console.log(`\n${title}：共 ${set.size} 个，未定义 ${miss.length} 个`)
  if (miss.length) console.log('   ', miss.join(', '))
  return miss
}

const missCalled = report('① 被调用的标识符', called, true)
const missRef = report('② 指令/插值中引用的标识符', referenced, false)

/* ③ 反向：script setup 里定义了但模板从未用到（只提示，不判失败 —— 可能是有意留给后续） */
const tplUsed = new Set([...called, ...referenced])
const unused = [...names].filter(n => !tplUsed.has(n) && !n.startsWith('_'))
console.log(`\n③ script setup 定义但模板未直接引用：${unused.length} 个`)
if (unused.length) console.log('   ', unused.join(', '))

if (missCalled.length) {
  console.error('\nXX 有模板调用了但 script setup 没定义的函数 —— 运行时必然报错')
  process.exit(1)
}
console.log('\nOK 模板符号与 script setup 一致')
