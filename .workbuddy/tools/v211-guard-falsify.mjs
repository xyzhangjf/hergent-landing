#!/usr/bin/env node
/* v211 护栏**反证自测**：故意改坏源码，确认对应断言真的会变红。
   为什么必须有这一步：如果一条断言无论源码怎么写都是绿的（恒真断言），
   它给的是**虚假的安全感** —— 比没有守卫更危险。本轮 v210 已把这条立为纪律。
   用法：node v211-guard-falsify.mjs [Forecast.vue 路径] */
import fs from 'node:fs'

const SRC = process.argv[2] || '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/src/pages/Forecast.vue'
const orig = fs.readFileSync(SRC, 'utf8')

const lineOf = (src, needle) => (src.split('\n').find((l) => l.indexOf(needle) >= 0) || '')
const count = (src, re) => { const m = src.match(re); return m ? m.length : 0 }

/* 与护栏**同一套判据**（必须同源：反证测的是真护栏，不是另写一份） */
function checks(src) {
  const nameInput = (src.match(/<input v-model="r\.name"[^>]*>/) || [''])[0]
  const priceInput = lineOf(src, 'v-model.number="r.casePrice"')
  const dl = (src.match(/<datalist v-if="ri === 0 && editMode" id="opt-prodname">[\s\S]*?<\/datalist>/) || [''])[0]
  const dotCss = (src.match(/\.cell-err-dot\{[^}]*\}/) || [''])[0]
  return {
    A2: /@change="onCellChange"/.test(nameInput),                                  // 商品名改动进撤销栈
    A3: dl.length > 0,                                                            // datalist 仅首行
    A7: count(src, /masterNameOptions\.value = buildNameOptions\(allProds\)/g) === 2,
    B3: /inputmode="decimal"/.test(priceInput) && !/inputmode="numeric"/.test(priceInput),
    C2: count(src, /@mousedown\.stop\.prevent @click\.stop="showCellErr\(/g) === 2,
    C5: /z-index:\s*[1-5]\b/.test(dotCss),
    C6: /left:0;top:0/.test(dotCss),
    D2: src.indexOf('if (cellTyping.value && editing && (e.key') >= 0,
  }
}
const KEYS = ['A2', 'A3', 'A7', 'B3', 'C2', 'C5', 'C6', 'D2']

const A2_SEARCH = 'opt-prodname\' : null" @focus="onFocusCell(ri, ci, $event)" @change="onCellChange"'

const cases = [
  ['基线（未改坏）', orig, { A2: true, A3: true, A7: true, B3: true, C2: true, C5: true, C6: true, D2: true }],
  ['M1 去掉商品名格的 @change',
    orig.replace(A2_SEARCH, 'opt-prodname\' : null" @focus="onFocusCell(ri, ci, $event)"'), { A2: false }],
  ['M2 只留一处候选赋值点',
    orig.replace('    masterNameOptions.value = buildNameOptions(allProds)\n', ''), { A7: false }],
  ['M3 单价格改成 numeric（小数点键消失）',
    orig.replace('inputmode="decimal" min="0" step="0.01"', 'inputmode="numeric" min="0" step="0.01"'), { B3: false }],
  ['M4 去掉角标的 mousedown 拦截',
    orig.replace(/@mousedown\.stop\.prevent @click\.stop="showCellErr\(/g, '@click.stop="showCellErr('), { C2: false }],
  ['M5 角标层级抬到粘性列之上',
    orig.replace('cursor:pointer;z-index:5', 'cursor:pointer;z-index:9'), { C5: false }],
  ['M6 角标挪到右侧（压住徽标）',
    orig.replace('left:0;top:0;width:13px;height:11px', 'right:4px;top:50%;width:13px;height:11px'), { C6: false }],
  ['M7 去掉 datalist 的首行守卫（6.8 万节点）',
    orig.replace('<datalist v-if="ri === 0 && editMode" id="opt-prodname">', '<datalist v-if="editMode" id="opt-prodname">'), { A3: false }],
  ['M8 v210 早退判据退回裸 editing',
    orig.replace('if (cellTyping.value && editing && (e.key', 'if (editing && (e.key'), { D2: false }],
]

let bad = 0
console.log('反证自测：每个变异只改坏一件事，看对应断言是否**真的**变红\n')
for (const [name, src, expect] of cases) {
  const got = checks(src)
  if (src === orig && name.indexOf('基线') < 0) { console.log('  ⚠️ 变异未生效（replace 没命中）: ' + name); bad++; continue }
  const shown = []
  for (const k of KEYS) {
    if (!(k in expect)) continue
    const okk = got[k] === expect[k]
    if (!okk) bad++
    shown.push(k + '=' + got[k] + ' 期望=' + expect[k] + (okk ? ' ✓' : ' ✗ 反证失败'))
  }
  console.log(name.padEnd(34) + ' | ' + shown.join('   '))
}

console.log('')
console.log(bad === 0
  ? '✅ 反证通过：8 条关键断言都会因「改坏源码」而变红 —— 它们不是恒真断言'
  : '❌ 有 ' + bad + ' 项反证未按预期变化 —— 该断言可能恒真，必须重写')
process.exit(bad === 0 ? 0 : 1)
