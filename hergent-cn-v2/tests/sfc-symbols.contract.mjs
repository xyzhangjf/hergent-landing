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
// 无 <script> 的 SFC（纯模板外壳）不是缺陷：compileScript 会直接抛
// "SFC contains no <script> tags" ⇒ 检查器崩溃会被误当成代码坏了。优雅跳过。
if (!descriptor.script && !descriptor.scriptSetup) {
  console.log('SKIP 该 SFC 无 <script>（纯模板外壳），无需符号检查')
  process.exit(0)
}
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

/* 扫描必须在**剥掉 HTML 注释之后**进行：本文件模板注释里常写
   「各页 load() 里从响应读」这类说明文字，正则会把注释里的 `load(`
   当成一次真实调用 ⇒ 大面积误报（v628：153 个文件里 28 个假红）。
   注释不参与渲染，本来就不该进符号表。 */
const raw = descriptor.template.content.replace(/<!--[\s\S]*?-->/g, '')

/* ① 模板里被「调用」的标识符（name( 形式）—— 这类漏定义会直接抛错
   🔴 只在 **JS 表达式**里找：指令 / 事件 / 插值。
      早先在模板全文上扫，把「渲染给用户看的说明文字」也算进去了 ——
      例如 DeliveryOrder.vue 正文写着「分车没有接口（assign_vehicle() 未挂路由）」，
      就被当成调用 ⇒ 假红。正文文本不是代码，不该进符号表（v628）。 */
/* 🔴 v629：表达式里的**字符串字面量必须先抠掉** ——
   「渲染给用户看的中文」里混着 `AI` / `ERP` / `Excel` / `config-auto`
   这类词，不抠就会被当成标识符 ⇒ 10 个文件假红（实测 `'让 AI 分析'`、
   `'同步 ERP'`、`activeTab === 'config-auto'`）。
   抠掉之后再扫，剩下的才是真正的顶层引用。 */
const noStr = (s) => s
  .replace(/'[^']*'|"[^"]*"|`[^`]*`/g, "''")
  /* 正则字面量（`/^\d+$/`）：`/` 前不是 词字符/`)`/`]` 才认它 —— 这样把
     `a / b` 这种**除法**排除在外，只会抠掉真正的正则（v629 实测 Settings.vue 的 `\d`）。 */
  .replace(/(^|[^\w$)\]])\/[^\/\n]+\/[gimsuy]*/g, "$1''")

const exprs = []
for (const m of raw.matchAll(/(?:v-[\w:.-]+|@[\w:.-]+|:[\w:.-]+)="([^"]*)"/g)) exprs.push(noStr(m[1]))
for (const m of raw.matchAll(/\{\{([^}]*)\}\}/g)) exprs.push(noStr(m[1]))

const called = new Set()
// 🔴 前导必须是**零宽**断言，不能写成 (?:^|[^\w.$'"]) —— 后者会消费掉那个字符，
//    于是 openAlloc(allocRowRef(r)) 里：匹配 openAlloc( 时把 `(` 吃掉，
//    紧随其后的 allocRowRef( 就再也找不到前导 ⇒ **嵌套调用整层漏检**（v628）。
//    实测这条让 Forecast.vue 的真实缺陷 allocRowRef 隐身，基线呈现"全绿假象"。
for (const e of exprs) {
  for (const m of e.matchAll(/(?<![\w.$'"])([A-Za-z_$][\w$]*)\s*\(/g)) called.add(m[1])
}

/* ② 模板里的 v-if / v-show / v-model / 插值 表达式中的**顶层**标识符。
   🔴 v629：这里**必须排除成员访问**（`allocFlags.no_members` 里的 `no_members`）——
      原正则把每个标识符都收进来 ⇒ 24 个「未定义」里 23 个是对象成员（假红），
      于是 ② 只能当提示、**不敢判失败**；而 `AllocPanel.vue` 那个真缺陷
      `v-if="open"`（defineProps 里根本没声明 open ⇒ 弹窗永不渲染）就混在这 24 个里
      被一起当成噪声放过了 —— **又是一次「全绿假象」**。
      改成零宽前导（不吃字符、且要求前面不是 `.`）后，只剩真正的顶层引用 ⇒ 可以判失败。 */
const referenced = new Set()
for (const m of raw.matchAll(/(?:v-if|v-else-if|v-show|v-model|v-html|v-text)="([^"]*)"/g)) {
  for (const n of noStr(m[1]).matchAll(/(?<![\w.$'"])([A-Za-z_$][\w$]*)/g)) referenced.add(n[1])
}
for (const m of raw.matchAll(/\{\{([^}]*)\}\}/g)) {
  for (const n of noStr(m[1]).matchAll(/(?<![\w.$'"])([A-Za-z_$][\w$]*)/g)) referenced.add(n[1])
}

// JS 关键字 / 字面量 / 内置 / 模板局部变量 / Vue 内置
/* ②‑0：`v-for` 的**迭代变量**是模板局部作用域，本来就不在 bindings 里 ——
   逐个写进白名单既脆弱又会放过真缺陷（v629 实测：改成"只认顶层标识符"之后
   剩下的噪声几乎全是它）⇒ **从本文件的 v-for 表达式里自动抽取**，一个都不猜。 */
const vForLocals = new Set()
for (const m of raw.matchAll(/v-for\s*=\s*"([^"]*)"/g)) {
  const head = m[1].split(/\bin\b/)[0] || ''
  for (const n of head.matchAll(/([A-Za-z_$][\w$]*)/g)) vForLocals.add(n[1])
}
/* 表达式里的**箭头函数形参**（`x => …`）—— 同样是局部作用域。
   v629 实测 FundsReconcile.vue 的 `.map(h => …)` 就差这一条。 */
for (const m of raw.matchAll(/([A-Za-z_$][\w$]*)\s*=>/g)) vForLocals.add(m[1])

const ALLOW = new Set([
  'true', 'false', 'null', 'undefined', 'in', 'of', 'new', 'typeof', 'instanceof', 'return',
  'Math', 'Date', 'JSON', 'Number', 'String', 'Boolean', 'Array', 'Object', 'isFinite',
  'parseInt', 'parseFloat', 'console', '$event', '$slots', '$attrs', '$emit', '$props',
  // CSS / SVG 函数与关键字：模板里 :style / :transform 会写成 var(--x)、rgba(...)、
  // rotate(-90 ...) 等，词法上和"函数调用"同形 —— 不白名单会整片误报（v628）。
  'var', 'rgba', 'rgb', 'calc', 'rotate', 'translate', 'scale', 'skew', 'matrix', 'url',
  'hsl', 'hsla', 'clamp', 'minmax', 'repeat', 'cubic', 'bezier', 'steps', 'linear', 'ease',
  // v-for 迭代变量（模板局部作用域，不在 bindings 里）
  's', 'g', 'r', 'it', 'l', 'p', 'i', 'k', 'v', 'x', 'q',
  // 正则字面量的锚点（`/^\d+$/`）—— 词法上与标识符同形，且它**不可能**是变量名
  '$',
  // 模板里用的对象成员访问会被词法切出来，逐个白名单过于脆弱 —— 改为只对"调用"严格
])

function report(title, set, strict) {
  const miss = [...set].filter(n => !ALLOW.has(n) && !names.has(n) && !vForLocals.has(n))
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

/* v629：② 也判失败 —— 排除成员访问后它已经足够干净（AllocPanel 实测 24 → 0），
   而漏掉它等于放过 `v-if="open"` 那一类「标识符根本不存在 ⇒ 静默不渲染」。 */
if (missCalled.length || missRef.length) {
  console.error('\nXX 有模板引用了但 script setup 没定义的标识符 —— 运行时必然报错/静默不渲染')
  process.exit(1)
}
console.log('\nOK 模板符号与 script setup 一致')
