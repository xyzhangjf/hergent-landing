// v210 护栏的**反证自测**：故意把源码改坏，确认对应断言真的会红。
// 目的：防止「断言写法恒真」——那种守卫比没有更危险（它给你虚假的安全感）。
import fs from 'fs'
const SRC = '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/src/pages/Forecast.vue'
const orig = fs.readFileSync(SRC, 'utf8')

const tplEnd = orig.lastIndexOf('</template>')
const tplOf = (s) => s.slice(s.indexOf('<template>'), tplEnd).replace(/<!--[\s\S]*?-->/g, '')
const scriptOf = (s) => s.slice(tplEnd).replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n')
const sliceBrace = (text, needle) => {
  const i = text.indexOf(needle)
  if (i < 0) throw new Error('找不到 ' + needle)
  let d = 0
  for (let j = text.indexOf('{', i); j < text.length; j++) {
    if (text[j] === '{') d++
    else if (text[j] === '}') { d--; if (d === 0) return text.slice(i, j + 1) }
  }
  throw new Error('不配平 ' + needle)
}

/* --- 三个「是否恒真」探针，与护栏里的写法逐字一致 --- */
function probeC2(src) {                       // 每个 @focus 都带 $event
  const t = tplOf(src)
  const i = t.indexOf('edit-grid-wrap')
  const et = t.slice(i, t.indexOf('</table>', i))
  const all = (et.match(/@focus="onFocusCell\(/g) || []).length
  const withEv = (et.match(/@focus="onFocusCell\([^"]*\$event\)"/g) || []).length
  return { all, withEv, pass: all > 0 && withEv === all }
}
function probeD1(src) {                       // 早退判据 = cellTyping.value && editing
  const g = sliceBrace(scriptOf(src), 'function onGridKey(')
  return /if \(cellTyping\.value && editing && \(e\.key === 'ArrowDown'/.test(g)
}
function probeA4(src) {                       // 复位在 nextTick 之前
  const f = sliceBrace(scriptOf(src), 'function focusCell(')
  return f.indexOf('cellTyping.value = !doSelect') < f.indexOf('nextTick(')
}
function probeH2(src) {                       // keepCellClear 在 nextTick 内、el.focus() 之后
  const f = sliceBrace(scriptOf(src), 'function focusCell(')
  const iF = f.indexOf('el.focus()'), iC = f.indexOf('keepCellClear(el)'), iT = f.indexOf('nextTick(')
  return iC > iF && iC > iT
}
function probeH7(src) {                       // 只在被遮住时才滚（两个方向都是条件分支）
  const c = sliceBrace(scriptOf(src), 'function keepCellClear(')
  return /if \(r\.left < leftGuard \+ M\) wrap\.scrollLeft -= /.test(c) &&
    /else if \(r\.right > wr\.right - M\) wrap\.scrollLeft \+= /.test(c) &&
    /if \(r\.top < topGuard \+ M\) wrap\.scrollTop -= /.test(c) &&
    /else if \(r\.bottom > wr\.bottom - M\) wrap\.scrollTop \+= /.test(c)
}
function probeH5(src) {                       // leftGuard 不是硬编码像素
  const c = sliceBrace(scriptOf(src), 'function keepCellClear(')
  return !/leftGuard = .*[0-9]{3}/.test(c)
}
function probeH3(src) {                       // 粘性格自身跳过
  const c = sliceBrace(scriptOf(src), 'function keepCellClear(')
  return /if \(td && getComputedStyle\(td\)\.position === 'sticky'\) return/.test(c)
}

const cases = [
  ['基线（未改坏）', orig, { C2: true, D1: true, A4: true, H2: true, H7: true, H3: true, H5: true }],
  ['M1 去掉某一列的 $event', orig.replace('@focus="onFocusCell(ri, C_EXTRA_INPUT, $event)"', '@focus="onFocusCell(ri, C_EXTRA_INPUT)"'), { C2: false }],
  ['M2 早退判据退回裸 editing', orig.replace('if (cellTyping.value && editing && (e.key', 'if (editing && (e.key'), { D1: false }],
  ['M3 复位语句挪到 nextTick 之后', orig
    .replace('  cellTyping.value = !doSelect\n  nextTick(() => {', '  nextTick(() => {\n  cellTyping.value = !doSelect')
    .replace('    }\n  })\n}', '    }\n  })\n}'), { A4: null }],   // 该变异只检 A4，由下方单独判
  ['M4 遮罩补偿挪到 el.focus() 之前', orig.replace('      el.focus()\n      if (doSelect && el.select)', '      keepCellClear(el)\n      el.focus()\n      if (doSelect && el.select)')
    .replace('      keepCellClear(el)\n    }', '    }'), { H2: false }],
  ['M5 改成无条件滚动', orig.replace('if (r.left < leftGuard + M) wrap.scrollLeft -= ', 'if (true) wrap.scrollLeft -= '), { H7: false }],
  ['M6 冻结区宽度写死 250px', orig.replace('let leftGuard = wr.left', 'let leftGuard = wr.left + 250'), { H5: false }],
  ['M7 去掉「粘性格自身跳过」', orig.replace('  if (td && getComputedStyle(td).position === \'sticky\') return\n', ''), { H3: false }],
]

const PROBES = {
  C2: (s) => probeC2(s).pass,
  D1: probeD1,
  A4: probeA4,
  H2: probeH2,
  H7: probeH7,
  H5: probeH5,
  H3: probeH3,
}

let bad = 0
for (const [name, src, expect] of cases) {
  const keys = Object.keys(expect)
  const line = []
  for (const k of keys) {
    if (!PROBES[k]) { line.push(k + '=? 无对应探针'); bad++; continue }
    const got = PROBES[k](src)
    const okk = expect[k] === null ? true : got === expect[k]
    if (!okk) bad++
    line.push(k + '=' + got + ' 期望=' + expect[k] + (okk ? ' ✓' : ' ✗'))
  }
  console.log(name.padEnd(30) + ' | ' + line.join('   '))
}

/* M3 单独验证：把复位语句挪到 nextTick 之后，A4 必须由 true 变 false */
const broken = orig.replace(
  '  cellTyping.value = !doSelect\n  nextTick(() => {',
  '  nextTick(() => {\n  cellTyping.value = !doSelect\n  // ')
const a4Broken = probeA4(broken)
console.log('M3b 复位挪到 nextTick 之后   | A4=' + a4Broken + ' 期望=false ' + (a4Broken === false ? '✓' : '✗'))
if (a4Broken !== false) bad++

console.log(bad === 0 ? '\n✅ 反证通过：C2 / D1 / A4 / H2 / H3 / H5 / H7 都会因为「改坏源码」而变红（不是恒真）'
  : '\n❌ 有 ' + bad + ' 项反证未按预期变化 —— 该断言可能恒真，必须重写')
process.exit(bad === 0 ? 0 : 1)
