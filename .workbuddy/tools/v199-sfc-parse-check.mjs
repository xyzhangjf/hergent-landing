// v199：客户列隐藏名册（B+C）前端改完后的轻量编译校验。
// 不替代 `vite build`，只把「SFC 模板/脚本语法错误」这类必炸问题挡在构建之前。
// 校验：① SFC 解析；② <script setup> 编译；③ 模板编译；④ 本轮 5 处改动的锚点存在性。
//
// 🔴 同时做一条**反向断言**：确认 hiddenUnits 没被写进草稿持久化路径
//    （草稿是「未提交的单元格值」，不该携带「待隐去的列」——否则恢复一份旧草稿
//     会把当时删过的列重新排队隐藏，用户会看到「明明撤销了、列还是没了」）。
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
  compiled = compileScript(descriptor, { id: 'v199check' })
  ok('script setup 编译通过，输出 ' + compiled.content.length + ' 字符')
} catch (e) {
  bad('script setup 编译失败: ' + e.message)
}

console.log('== 3. 模板编译 ==')
if (descriptor.template) {
  const r = compileTemplate({
    source: descriptor.template.content,
    filename: 'Forecast.vue',
    id: 'v199check',
    compilerOptions: { bindingMetadata: compiled ? compiled.bindings : undefined },
  })
  if (r.errors && r.errors.length) bad('模板编译报错: ' + JSON.stringify(r.errors.slice(0, 3)))
  else ok('模板编译通过')
} else bad('没有找到 template 块')

console.log('== 4. 本轮改动锚点（5 处）==')
/* ⚠️ 2026-09-19 v199b：①③④⑤ 四条锚点已随「accessor 化」更新 ——
   v199b 把 `cross.value.hiddenUnits` 的裸读裸写换成了 `hiddenUnits()` 统一入口，
   并把 cross 初始化改为 `blankCross()` 工厂。锚点不跟着更新，脚本就会**假红**（改对了也报 FAIL）。
   形状类不变量（字面量必含 units / 禁裸读 units.length）请跑 v199b-invariant-check.mjs。 */
const anchors = [
  ['① cross 由 blankCross() 工厂初始化', 'const cross = ref(blankCross())'],
  ['② loadEditGrid 每次加载重置', 'hiddenUnits: [],\n    }'],
  ['③ delCol 记入待隐去集合（走 accessor）', 'const hu = hiddenUnits()\n  if (u.name && !hu.includes(u.name)) hu.push(u.name)'],
  ['④ addUnit 移除（加回列的入口，走 accessor）', 'const hu = hiddenUnits()\n  const hi = hu.indexOf(v)\n  if (hi >= 0) hu.splice(hi, 1)'],
  ['⑤ saveEdits 载荷提交 hidden_customers（走 accessor）', 'hidden_customers: hiddenUnits(),'],
]
for (const [name, needle] of anchors) {
  if (src.includes(needle)) ok(name)
  else bad(name + ' —— 未找到锚点')
}

console.log('== 5. 反向断言：hiddenUnits 不得进草稿持久化 ==')
// 草稿读写点（DRAFT_MASTER_KEYS / saveDraft / loadDraft / localStorage 草稿键）
const draftLines = src.split('\n')
  .map((l, i) => [i + 1, l])
  .filter(([, l]) => /DRAFT|saveDraft|loadDraft|clearDraft/.test(l) && /hiddenUnits/.test(l))
if (draftLines.length) bad('hiddenUnits 出现在草稿相关行: ' + JSON.stringify(draftLines.slice(0, 5)))
else ok('草稿路径未引用 hiddenUnits（符合预期）')

// 撤销栈必须覆盖得住：snapshot 是整份 clone(cross.value)
if (src.includes('undoStack.value.push({ t: \'full\', data: clone(cross.value) })'))
  ok('snapshot() 整份深拷贝 cross ⇒ hiddenUnits 随撤销/重做自动回退')
else bad('snapshot() 不再是整份深拷贝 —— hiddenUnits 将无法随撤销回退，需改设计')

console.log(fail ? '\n结果：' + fail + ' 项未通过' : '\n结果：全部通过')
process.exit(fail ? 1 : 0)
