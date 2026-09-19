// v197：改完 Forecast.vue 后的轻量编译校验。
// 目的不是替代 `vite build`（那在 #510 做），而是**在不跑完整构建**的前提下，
// 先把「SFC 模板/脚本语法错误」这类必炸问题挡在前面 —— 省一轮 3 分钟的构建才知道写错一个括号。
// 校验三件事：① SFC descriptor 能解析；② <script setup> 能编译成 JS；③ 模板能编译。
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '../../hergent-cn-v2')
const sfcPath = path.join(root, 'src/pages/Forecast.vue')
const src = fs.readFileSync(sfcPath, 'utf8')

const { parse, compileScript, compileTemplate } = await import(
  path.join(root, 'node_modules/@vue/compiler-sfc/dist/compiler-sfc.cjs.js')
)

let fail = 0
const ok = (m) => console.log('  PASS  ' + m)
const bad = (m) => { fail++; console.log('  FAIL  ' + m) }

console.log('== 1. SFC 解析 ==')
const { descriptor, errors } = parse(src, { filename: 'Forecast.vue' })
if (errors && errors.length) bad('descriptor 解析报错 ' + errors.length + ' 条: ' + JSON.stringify(errors.slice(0, 3)))
else ok('descriptor 解析通过（script setup=' + !!descriptor.scriptSetup + ', template=' + !!descriptor.template + '）')

console.log('== 2. <script setup> 编译 ==')
let compiled = null
try {
  compiled = compileScript(descriptor, { id: 'v197check' })
  ok('script setup 编译通过，输出 ' + compiled.content.length + ' 字符')
} catch (e) {
  bad('script setup 编译失败: ' + e.message)
}

console.log('== 3. 模板编译 ==')
if (descriptor.template) {
  const r = compileTemplate({
    source: descriptor.template.content,
    filename: 'Forecast.vue',
    id: 'v197check',
    compilerOptions: { bindingMetadata: compiled ? compiled.bindings : undefined },
  })
  if (r.errors && r.errors.length) bad('模板编译报错: ' + JSON.stringify(r.errors.slice(0, 3)))
  else ok('模板编译通过')
} else bad('没有找到 template 块')

console.log('== 4. 本轮改动锚点存在性 ==')
const anchors = [
  ['clampSelection 夹 selRange（注释）', 'v197（P1-2b）：把**矩形选区与拖拽锚点**'],
  ['clampSelection 夹 selRange（代码）', 'selRange.value = { r0, c0, r1, c1 }'],
  ['clampSelection 夹 selAnchor（代码）', 'selAnchor.value = { r: Math.min(sa.r, nr), c: Math.min(sa.c, nc) }'],
  ['列数变化 watch', 'watch(\n  () => visibleCols.value.length + cross.value.units.length,'],
  ['delCol 至少一列守卫', "toast('至少要保留一列客户列，不能全部删完', 'warn')"],
  ['delCol 越界守卫', 'if (ui < 0 || ui >= cross.value.units.length) return'],
  ['deleteMasterCol 收口', 'delete colVis.value[key]\n  _persistCols()\n  clampSelection()'],
  ['saveEdits 拦空客户列', "toast('至少要有一个客户列才能保存"],
]
for (const [name, needle] of anchors) {
  if (src.includes(needle)) ok(name)
  else bad(name + ' —— 未找到锚点')
}

console.log(fail ? '\n结果：' + fail + ' 项未通过' : '\n结果：全部通过')
process.exit(fail ? 1 : 0)
