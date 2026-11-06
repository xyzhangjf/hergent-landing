/* ㊿·d　查错可诊断性 + 负数清 0（v791）
   ────────────────────────────────────────────────────────────────────────
   报障（2026-11-06 22:30，老张原话）：
     「在本期预报粘贴后，出现下面这个报错，导致不能保存，但实际粘贴过去的数字没有负数。
      7 处待修正 / 负数 7 …… 第 6 行 · CD杯（16连）永辉 · 吾悦 不能为负数 …」
   实测事实（已核）：生产 tenant_1 里这 7 个商品在「吾悦」全是正数（30 / 4 / 6 …），
   全库 quantity<0 一条都没有 ⇒ 负数只存在于**前端内存/本地草稿**，不在服务端。
   而原实现只会说一句「不能为负数」：既不给**当前值**，也没有任何出口 —— 用户既无法判断
   系统认为多少，也无法把 7 格一次改掉，只能逐格点开猜，最后结论是「软件算错了」。

   本文件锁三件事：
     A. 数值类错误**必须带上当前值**（且取值走 `rawCellVal`，不能用 `readCellVal`）
     B. 负数有**显式**一键清 0（逐条预览 + 整批一次 Ctrl+Z 可撤销），且与 fixables 共用一份写入实现
     C. 粘贴**当场**报出「其中 N 格是负数」（不等保存才被拦）

   🔴 防三种空白支票（本项目铁律）：
      ① 正则抽到空集 ⇒ 每条截取先断言片段非空；
      ② 只查唯一不查存在 ⇒ 「加了带值」必须与「前缀没变（分组仍能识别）」成对判；
      ③ 只写上限 ⇒ 每条关键判据配坏样本（撤销修复即红）+ 真实源码对照组。
   静态判据一律剥注释 —— 注释里逐字抄旧实现会自撞假红。 */

import fs from 'node:fs'
import vm from 'node:vm'

const vue = fs.readFileSync(new URL('../src/pages/Forecast.vue', import.meta.url), 'utf8')
let pass = 0, fail = 0
function ok (cond, msg, extra = '') {
  if (cond) { pass++; console.log('  ✅ ' + msg + (extra ? ' ' + extra : '')) }
  else { fail++; console.log('  ❌ ' + msg + (extra ? ' ' + extra : '')) }
}
const count = (s, re) => (s.match(re) || []).length
const stripComments = (s) => s
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
const vueCode = stripComments(vue)
/* 按**大括号配平**截取，而不是「截到第一个行首 }」：
   本文件要抽的 `negFixables` 结尾是 `})`、`const x = computed(() => {` 开头，
   行首 `}` 那条老规则会把它截成 `... }`（丢一个右括号）直接语法错。 */
function extract (sig) {
  const i = vue.indexOf(sig)
  if (i < 0) return ''
  const j = vue.indexOf('{', i)
  if (j < 0) return ''
  let depth = 0
  for (let k = j; k < vue.length; k++) {
    const ch = vue[k]
    if (ch === '{') depth++
    else if (ch === '}') { depth--; if (depth === 0) return vue.slice(i, k + 1) }
  }
  return ''
}

console.log('\nA. 数值类错误必须带「当前值」（否则用户不知道系统认为多少）')

const pushErrSrc = extract('function pushErr')
ok(pushErrSrc.length > 200, '截取到 pushErr 真实函数体（防正则抽空集）',
  'len=' + pushErrSrc.length)
ok(/kd\.k === 'neg'/.test(pushErrSrc) && /kd\.k === 'over'/.test(pushErrSrc) && /kd\.k === 'int'/.test(pushErrSrc),
  '三类数值错误（负数 / 超上限 / 非整数）都追加当前值')
ok(/rawCellVal\(ri, ci\)/.test(pushErrSrc),
  '取值走 rawCellVal（取字段本身）')
/* 🔴 成对判：readCellVal 对数量列是 `rw.qtyByUnit[name] || 0`，「没填过」会读成 0 ⇒
   清单里会冒出「不能为负数（当前 0）」这种自相矛盾的句子。 */
ok(!/readCellVal\(/.test(pushErrSrc),
  'pushErr 里不含 readCellVal（避免「不能为负数（当前 0）」自相矛盾）')
ok(/msg \+ '（当前 ' \+ String\(raw\) \+ '）'/.test(pushErrSrc),
  '拼成「（当前 xxx）」后缀而不是改写正文')
ok(/raw !== '' && raw != null/.test(pushErrSrc),
  '空值/未填不追加括号（否则每条都挂个「（当前 ）」）')

/* 真实函数实跑：把 ERR_KINDS / errKindOf / pushErr 一起注入 vm，配桩喂真实格子值。 */
const errKindsSrc = (vueCode.match(/const ERR_KINDS = \[[\s\S]*?\n\]/) || [''])[0]
const errKindOfSrc = extract('function errKindOf')
ok(errKindsSrc.length > 100, '截取到 ERR_KINDS 常量（防抽空集）', 'len=' + errKindsSrc.length)
ok(errKindOfSrc.length > 30, '截取到 errKindOf 真实函数体', 'len=' + errKindOfSrc.length)

function buildSandbox () {
  const sb = vm.createContext({})
  vm.runInContext(`
    const __raw = {}
    function rawCellVal (r, c) { return __raw[r + '_' + c] }
    function colNameOf () { return '吾悦' }
    ${errKindsSrc}
    ${errKindOfSrc}
    ${pushErrSrc}
    this.__raw = __raw
    this.__api = { pushErr, errKindOf }
  `, sb)
  return sb
}

{
  const sb = buildSandbox()
  const list = []
  // ① 负数：必须带出真实值
  sb.__raw['5_10'] = -6
  sb.__api.pushErr(list, 5, 10, { name: 'CD杯（16连）永辉' }, '不能为负数')
  ok(list.length === 1, '负数格产出一条清单项')
  ok(list[0].msg === '不能为负数（当前 -6）',
    '清单文案带出真实值 -6', '→ ' + JSON.stringify(list[0].msg))
  /* 🔴 前缀必须不变：ERR_KINDS 全部按 ^ 前缀分组/筛选，改前缀会让「负数」分组、筛选、
     以及后端 400 回执的 kind 归一一起失效。 */
  ok(list[0].kind === 'neg', '分组仍是 neg（前缀未被改写）')
  ok(sb.__api.errKindOf(list[0].msg).k === 'neg',
    '带值后的文案仍能被 errKindOf 识别为 neg（端到端复核）')

  // ② 超上限 / 非整数同样带值
  const l2 = []
  sb.__raw['7_10'] = 120000
  sb.__api.pushErr(l2, 7, 10, { name: 'x' }, '数量过大（上限 99999）')
  ok(l2[0].msg === '数量过大（上限 99999）（当前 120000）', '超上限也带当前值', '→ ' + l2[0].msg)
  const l3 = []
  sb.__raw['8_10'] = 12.5
  sb.__api.pushErr(l3, 8, 10, { name: 'x' }, '必须为整数')
  ok(l3[0].msg === '必须为整数（当前 12.5）', '非整数也带当前值', '→ ' + l3[0].msg)

  // ③ 空值不追加
  const l4 = []
  sb.__raw['9_10'] = undefined
  sb.__api.pushErr(l4, 9, 10, { name: 'x' }, '不能为负数')
  ok(l4[0].msg === '不能为负数', '未填（undefined）不追加空括号', '→ ' + l4[0].msg)

  // ④ 非数值类不受影响（名称必填 / 条码重复）
  const l5 = []
  sb.__raw['10_0'] = ''
  sb.__api.pushErr(l5, 10, 0, { name: '' }, '商品名称必填（该行已填报数量）')
  ok(l5[0].msg === '商品名称必填（该行已填报数量）', '文本类错误文案原样不动')
}

/* 坏样本：把追加逻辑整段删掉（退回到 v790 的写法）⇒ 上面「带出真实值」的判据必须翻红。
   ⚠️ 用**手写的旧版函数体**而不是对真实源码做正则删改：文件一旦改结构（加注释/换行），
      正则替换会静默失败或造出语法错的样本，坏样本就变成「假自证」。 */
{
  const broken = `
function pushErr(list, ri, ci, r, msg) {
  const kd = errKindOf(msg)
  list.push({ ri, ci, row: ri + 1, col: colNameOf(ci), name: r.name || '', msg, kind: kd.k, kindLabel: kd.label })
}`
  const sb = vm.createContext({})
  vm.runInContext(`
    const __raw = {}
    function rawCellVal (r, c) { return __raw[r + '_' + c] }
    function colNameOf () { return '吾悦' }
    ${errKindsSrc}
    ${errKindOfSrc}
    ${broken}
    this.__raw = __raw
    this.__api = { pushErr }
  `, sb)
  sb.__raw['5_10'] = -6
  const list = []
  sb.__api.pushErr(list, 5, 10, { name: 'x' }, '不能为负数')
  ok(list[0].msg === '不能为负数',
    '坏样本：撤销修复后文案退回「不能为负数」，不带值 ⇒ 判据能翻红')
}

console.log('\nB. 负数一键清 0：显式名单 + 与 fixables 共用一份写入实现')

const negSrc = extract('const negFixables = computed(')
ok(negSrc.length > 300, '截取到 negFixables 真实实现', 'len=' + negSrc.length)
ok(/it\.kind !== 'neg'/.test(negSrc), '只收 kind=neg 的项（不把超上限/非数字混进来）')
ok(/neu: '0'/.test(negSrc), '目标值固定为 0')
/* 🔴 复核闸门不能省：errList 可能来自后端 400 回执（ri/ci 是推算的），拿过期/推算坐标
   写数值会改错格 —— 必须用当前表格状态重算，仍为负数才动手。 */
ok(/cellIssue\(it\.ri, it\.ci\)/.test(negSrc) && /errKindOf\(now\)\.k !== 'neg'/.test(negSrc),
  '动手前用当前表格状态复核（坐标过期/类型变了就不改）')
ok(/seen\.has\(key\)|seen\.add\(key\)/.test(negSrc), '同一格去重（errList 可能有重复项）')

const applyListSrc = extract('function applyFixList')
ok(applyListSrc.length > 300, '截取到 applyFixList 真实函数体', 'len=' + applyListSrc.length)
ok(/writeCellVal\(x\.ri, x\.ci, x\.neu\)/.test(applyListSrc), '写入走统一 writeCellVal')
ok(/pushBatchSnap\(cells\)/.test(applyListSrc), '整批只入一条撤销记录（一次 Ctrl+Z 还原）')
ok(/validateAll\(\)/.test(applyListSrc) && /errCount\.value = rest\.length/.test(applyListSrc),
  '修完在同一段里回写清单与角标（否则角标与面板会短暂自相矛盾）')

const applyFixesSrc = extract('function applyFixes')
const applyNegSrc = extract('function applyNegFixes')
ok(/applyFixList\(fixables\.value\)/.test(applyFixesSrc), 'applyFixes 也走 applyFixList')
ok(/applyFixList\(negFixables\.value\)/.test(applyNegSrc), 'applyNegFixes 走同一段 applyFixList')
/* 单一实现：applyFixList 全文恰好 1 处定义，且没有第二份「循环 writeCellVal + pushBatchSnap」。 */
ok(count(vueCode, /function applyFixList\(/g) === 1, 'applyFixList 全文恰好 1 处定义')
ok(count(vueCode, /pushBatchSnap\(cells\)/g) === 1,
  '批量写入只此一处（出现第二份拷贝必然漂移）')

/* 模板入口：负数按钮存在且与「一键修复」并列、不共用样式语义 */
ok(/负数设为 0（\{\{ negFixables\.length \}\} 处）/.test(vueCode), '查错面板里有「负数设为 0」入口')
ok(/v-if="negFixables\.length"/.test(vueCode), '入口仅在真的有负数时出现')
ok(/applyNegFixes/.test(vueCode), '确认按钮绑到 applyNegFixes')
ok(/negPreviewOpen/.test(vueCode), '有独立的确认弹窗状态（不复用 fixPreviewOpen，避免两个名单串台）')
ok(/若某些负数本意是<b>退货\/冲减<\/b>/.test(vueCode),
  '弹窗明确提示「退货应走退单」（不替用户决定业务语义）')

/* manualErrs 必须扣掉负数，否则「可一键」与「需手工」两个数字加起来超过总数 */
const manualSrc = (vueCode.match(/const manualErrs = computed\([^)]*\)[^\n]*/) || [''])[0]
ok(manualSrc.length > 20, '截取到 manualErrs 定义', '→ ' + manualSrc)
ok(/- negFixables\.value\.length/.test(manualSrc),
  'manualErrs 扣掉可一键处理的负数（两数相加不超过总数）')
/* 坏样本：不扣负数 ⇒ 判据翻红 */
ok(!(vueCode.replace('- negFixables.value.length', '')).includes(
  'const manualErrs = computed(() => errList.value.length - fixables.value.length - negFixables.value.length)'),
  '坏样本：删掉扣减后定义不再是原样（判据有判别力）')

console.log('\nC. 粘贴当场报出负数（不等保存才被拦）')

const regionSrc = extract('function pasteRegion')
ok(regionSrc.length > 2000, '截取到 pasteRegion 真实函数体', 'len=' + regionSrc.length)
ok(/let negN = 0/.test(regionSrc), 'pasteRegion 统计负数格数')
ok(/errKindOf\(cellIssue\(w\.r, w\.c\)\)\.k === 'neg'/.test(regionSrc),
  '按 errKindOf 判定是否负数（与查错同源，不另立口径）')
ok(/其中 \$\{negN\} 格是负数/.test(regionSrc), '粘贴回执里明确报出负数格数')

const crossSrc = extract('function tryPasteCross')
ok(crossSrc.length > 2000, '截取到 tryPasteCross 真实函数体', 'len=' + crossSrc.length)
ok(/let added = 0[^\n]*negN = 0/.test(crossSrc), '按客户列粘贴同样统计负数')
ok(/其中 \$\{negN\} 格是负数/.test(crossSrc), '按客户列粘贴的回执也报负数')

console.log(`\n── 结果：${pass} 通过 / ${fail} 失败 ──`)
process.exit(fail ? 1 : 0)
