#!/usr/bin/env node
/* v212 护栏**反证自测**：故意改坏源码，确认对应断言真的会变红。
   为什么必须有这一步：如果一条断言无论源码怎么写都是绿的（恒真断言），
   它给的是**虚假的安全感** —— 比没有守卫更危险（v210 立规、v211 沿用）。
   用法：node v212-guard-falsify.mjs [Forecast.vue 路径] */
import fs from 'node:fs'

const SRC = process.argv[2] || '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/src/pages/Forecast.vue'
const orig = fs.readFileSync(SRC, 'utf8')

const lineOf = (src, needle) => (src.split('\n').find((l) => l.indexOf(needle) >= 0) || '')
const count = (src, re) => { const m = src.match(re); return m ? m.length : 0 }

/* 与护栏**同一套判据**（必须同源：反证测的是真护栏，不是另写一份） */
function checks(src) {
  const prevFn = (src.match(/async function loadPrevUnits\(\)[\s\S]*?\n\}/) || [''])[0]
  const qtyOptFn = (src.match(/function buildQtyCellOptions\(ri, ui\)[\s\S]*?\n\}/) || [''])[0]
  const softComputed = (src.match(/const softAt = computed\(\(\) => \{[\s\S]*?\n\}\)/) || [''])[0]
  const focusFn = (src.match(/function onFocusCell\(r, c, e\) \{[\s\S]*?\n\}/) || [''])[0]
  const fillFn = (src.match(/function fillSelectionWith\(raw\) \{[\s\S]*?\n\}/) || [''])[0]
  const softCss = (src.match(/\.cell-soft-dot\{[^}]*\}/) || [''])[0]
  const selStatCss = (src.match(/\.sel-stat\{[^}]*\}/) || [''])[0]
  const missCss = (src.match(/\.cell-soft-dot\.soft-miss\{[^}]*\}/) || [''])[0]
  const softDotLine = lineOf(src, 'class="cell-soft-dot"')
  /* 🔴 与护栏**逐字同源**的提取（反证必须测真护栏，不能另写一份判据） */
  const batchFn = (src.match(/function batchWrite\(val\) \{[\s\S]*?\n\}/) || [''])[0]
  const clearFn = (src.match(/function clearRange\(\) \{[\s\S]*?\n\}/) || [''])[0]
  return {
    A1: /s\.store \|\| s\.store_name/.test(prevFn),
    A4: lineOf(src, 'loadPrevUnits().catch(').length > 0,
    A5: src.indexOf('loadPrevUnits().catch(') > src.indexOf('async function loadEditGrid()') &&
        src.indexOf('loadPrevUnits().catch(') < src.indexOf('async function loadCross()'),
    A6: /prevUnitsLoaded\.value = false/.test(src) && /prevUnitMap\.value = \{\}/.test(src),
    A7: prevFn.indexOf('toast(') < 0,
    B2: count(src, /id="opt-qty"/g) === 1,
    B3: /:key="qtyOptKey"/.test((src.match(/<datalist v-if="editMode && qtyOptKey" id="opt-qty"[\s\S]*?<\/datalist>/) || [''])[0]),
    B6: /return \(editMode\.value && qtyOptKey\.value === \(ri \+ '-' \+ ui\)\) \? 'opt-qty' : null/.test(src),
    B7: /syncQtyCellOptions\(r, c\)/.test(focusFn),
    B9: /l: '上期 ' \+ fmt\(pv\)/.test(qtyOptFn),
    C1: /m\.set\(ri \+ '-' \+ ui/.test(softComputed),
    C2: /function cellSoftIssue\(ri, ui\) \{ return softAt\.value\.get\(ri \+ '-' \+ ui\) \|\| '' \}/.test(src),
    C3: /if \(rowTotal <= 0\) continue/.test(softComputed),
    C5: /if \(softWarnCfg\.overOn && cur > 0 && cur >= pv \* ratio\)[\s\S]{0,120}else if \(softWarnCfg\.missOn && cur === 0\)/.test(softComputed),
    C10: /cellSoftIssue\(ri, ui\)/.test(softDotLine),
    C13: /z-index:\s*[1-5]\b/.test(softCss),
    C14: /right:0;top:0/.test(softCss),
    C15: /color:var\(--bg\)/.test(missCss) && missCss.indexOf('#fff') < 0,
    D4: /batchWrite\(parseNumInput\(s\)\)/.test(fillFn),
    D6: /if \(s === ''\) \{ toast\('请输入要填入的值（清空选区请用 Delete 或「清空选区」）', 'warn'\); return \}/.test(src),
    D7: /function closeCtx\(\) \{ ctxMode\.value = 'menu'; ctxFillVal\.value = ''; ctx\.value\.show = false \}/.test(src),
    /* 🔴 以下五条是 v212 真机首跑抓到的**真缺陷**对应的守卫（空选区丢入口 / 浮层吸不住 / 选择器误命中） */
    D10: /<div v-if="selRange" class="sel-stat">/.test(src) && !/v-if="selStats" class="sel-stat"/.test(src),
    D11: src.includes('<span>共 <b>{{ selCellCount }}</b> 格</span>')
      && src.includes('<template v-if="selStats && selStats.sum !== 0">'),
    D12: /const selCellCount = computed\(/.test(src)
      && count(src, /\(\w+\.r1 - \w+\.r0 \+ 1\) \* \(\w+\.c1 - \w+\.c0 \+ 1\)/g) === 1
      && count(src, /selCellCount/g) >= 3,
    D13: /position:fixed/.test(selStatCss) && /bottom:0/.test(selStatCss),
    D14: /left:var\(--sidebar-w/.test(selStatCss),
    D15: /class="ctx-ipt ctx-ipt-fill"/.test(src),
    /* 🔴 v212 真机第 4 个真缺陷：报数按「选区面积」而非「实际写入成功数」。
       两处必须同口径 —— 这个坑 v184 已在 clearRange 上修过，batchWrite 漏了。 */
    D16: /if \(writeCellVal\(ri, ci, val\)\) n\+\+/.test(batchFn)
      && /已批量写入 \$\{n\} 个单元格/.test(batchFn)
      && !/\(r1 - r0 \+ 1\) \* \(c1 - c0 \+ 1\)/.test(batchFn)
      && /if \(writeCellVal\(ri, ci, ''\)\) n\+\+/.test(clearFn),
    E2: count(src, /class="cell-err-dot"/g) === 2,
    E3: count(src, /@mousedown\.stop\.prevent @click\.stop="showCellErr\(/g) === 2,
  }
}

const cases = [
  ['基线（未改坏）', orig, []],

  /* ---- A. 上期按客户的数据源 ---- */
  ['M1 逐格索引改成按商品名汇总',
    /* ⚠️ 必须带上一行唯一标识 —— `const name = s.store || s.store_name || '未署名'` 在
       loadEditGrid 里**还有一份一模一样的**（同缩进），裸字符串 replace 会命中那一份，
       变异落在别处、prevFn 没动 ⇒ 反证假通过（本轮实测踩到）。 */
    orig.replace("      ;(r.sources || []).forEach(s => {\n        const name = s.store || s.store_name || '未署名'\n        bucket[name] = (bucket[name] || 0) + (parseInt(s.qty) || 0)",
      "      ;(r.sources || []).forEach(s => {\n        const name = r.product_name || ''\n        bucket[name] = (bucket[name] || 0) + (parseInt(s.qty) || 0)"),
    { A1: false }],
  ['M2 调用改成 await（阻塞渲染且丢了 catch）',
    orig.replace('loadPrevUnits().catch(() => {})', 'await loadPrevUnits()'),
    { A4: false, A5: false }],
  ['M3 不清跨期次缓存（拿上期的数比本期）',
    orig.replace('  prevUnitsLoaded.value = false\n', ''),
    { A6: false }],
  ['M4 失败时弹错（把增益信息变成噪音）',
    orig.replace("  } catch (e) { /* 增益信息：静默降级 */ }", "  } catch (e) { toast('上期数据载入失败', 'err') }"),
    { A7: false }],

  /* ---- B. 数量格候选 ---- */
  ['M5 数量格再挂一份 datalist（3300 个节点）',
    orig.replace('<span v-if="cellErrMsg(ri, visibleCols.length + ui)" class="cell-err-dot"',
      '<datalist id="opt-qty"></datalist><span v-if="cellErrMsg(ri, visibleCols.length + ui)" class="cell-err-dot"'),
    { B2: false }],
  ['M6 去掉 :key（换格沿用上一格候选）',
    orig.replace('id="opt-qty" :key="qtyOptKey"', 'id="opt-qty"'),
    { B3: false }],
  ['M7 所有格都带 list（互相看到对方候选）',
    orig.replace("return (editMode.value && qtyOptKey.value === (ri + '-' + ui)) ? 'opt-qty' : null",
      "return editMode.value ? 'opt-qty' : null"),
    { B6: false }],
  ['M8 候选只挂在 mousedown（键盘跳格没有候选）',
    orig.replace('  syncQtyCellOptions(r, c)\n', ''),
    { B7: false }],
  ['M9 候选丢掉「上期同格」这一类',
    orig.replace("    out.push({ v: String(pv), l: '上期 ' + fmt(pv) + (prevUnitsPeriod.value ? '（' + prevUnitsPeriod.value + '）' : '') })\n", ''),
    { B9: false }],

  /* ---- C. 软警告分级 ---- */
  ['M10 判据退回逐格现算（去掉成图）',
    orig.replace('const softAt = computed(() => {', 'const softAt = { value: new Map() } // computed(() => {'),
    { C1: false }],
  ['M10b 模板访问器退回逐格现算（O(N²×M) 的老路）',
    orig.replace("function cellSoftIssue(ri, ui) { return softAt.value.get(ri + '-' + ui) || '' }",
      "function cellSoftIssue(ri, ui) { const _r = cross.value.rows[ri]; const _u = cross.value.units[ui]; if (!_r || !_u) return ''; const _pv = prevUnitQty(_r, _u.name); if (_pv == null || _pv <= 0) return ''; const _cur = parseFloat(_r.qtyByUnit[_u.name]) || 0; if (softWarnCfg.overOn && _cur > 0 && _cur >= _pv * softRatio()) return 'over'; if (softWarnCfg.missOn && _cur === 0 && rowSum(_r) > 0) return 'miss'; return '' }"),
    { C2: false }],
  ['M11 去掉漏订的行前提（一进编辑态满屏黄）',
    orig.replace('    if (rowTotal <= 0) continue\n', ''),
    { C3: false }],
  ['M12 two 档改成并列判断（一格可能两标）',
    orig.replace('else if (softWarnCfg.missOn && cur === 0) m.set(ri + \'-\' + ui, \'miss\')',
      'if (softWarnCfg.missOn && cur === 0) m.set(ri + \'-\' + ui, \'miss\')'),
    { C5: false }],
  ['M13 角标挪到左下（撞行号格视觉通道）',
    orig.replace('.cell-soft-dot{position:absolute;right:0;top:0', '.cell-soft-dot{position:absolute;left:0;bottom:0'),
    { C14: false }],
  ['M14 角标层级抬到粘性列之上',
    orig.replace('.cell-soft-dot{position:absolute;right:0;top:0;width:13px;height:11px;display:flex;align-items:center;justify-content:center;border-bottom-left-radius:6px;cursor:pointer;z-index:5',
      '.cell-soft-dot{position:absolute;right:0;top:0;width:13px;height:11px;display:flex;align-items:center;justify-content:center;border-bottom-left-radius:6px;cursor:pointer;z-index:9'),
    { C13: false }],
  ['M15 实心档文字色写死 #fff（深色主题看不见）',
    orig.replace('.cell-soft-dot.soft-miss{background:var(--sev-warn);color:var(--bg)}',
      '.cell-soft-dot.soft-miss{background:var(--sev-warn);color:#fff}'),
    { C15: false }],
  ['M16 角标改用主档列下标 ci（标错格子 / 取不到）',
    orig.replace('v-if="cellSoftIssue(ri, ui)" class="cell-soft-dot" :class="\'soft-\' + cellSoftIssue(ri, ui)"',
      'v-if="cellSoftIssue(ri, ci)" class="cell-soft-dot" :class="\'soft-\' + cellSoftIssue(ri, ci)"'),
    { C10: false }],

  /* ---- D. 批量填同值入口 ---- */
  ['M17 另写一份写循环（脱离 Ctrl+Enter 的写入口）',
    orig.replace('  batchWrite(parseNumInput(s))\n',
      '  const _sr = selRange.value\n  for (let _r = _sr.r0; _r <= _sr.r1; _r++) for (let _c = _sr.c0; _c <= _sr.c1; _c++) writeCellVal(_r, _c, parseNumInput(s))\n'),
    { D4: false }],
  ['M18 允许空值（留空点填入 = 静默清空选区）',
    orig.replace("  if (s === '') { toast('请输入要填入的值（清空选区请用 Delete 或「清空选区」）', 'warn'); return }\n", ''),
    { D6: false }],
  ['M19 closeCtx 不清填入值（残留被当默认值）',
    orig.replace("function closeCtx() { ctxMode.value = 'menu'; ctxFillVal.value = ''; ctx.value.show = false }",
      'function closeCtx() { ctx.value.show = false }'),
    { D7: false }],

  /* ---- E. 回归 ---- */
  ['M20 去掉一处 v211 错误角标的 class',
    orig.replace('class="cell-err-dot"', 'class="cell-err-dot-OLD"'),
    { E2: false }],
  ['M21 去掉一处 v211 角标的 mousedown 拦截',
    orig.replace(/@mousedown\.stop\.prevent @click\.stop="showCellErr\(/g, '@click.stop="showCellErr('),
    { E3: false, E2: true }],

  /* ---- F. v212 真机抓到的三个真缺陷（守卫必须能打红） ---- */
  ['M22 统计条判据退回 selStats（空选区整条消失）',
    orig.replace('<div v-if="selRange" class="sel-stat">', '<div v-if="selStats" class="sel-stat">'),
    { D10: false }],
  ['M23 求和/平均退回"有数字就显示"（恒显示「求和 0」）',
    orig.replace('<template v-if="selStats && selStats.sum !== 0">', '<template v-if="selStats">'),
    { D11: false }],
  ['M24 格数改回模板里重算（同一条规则两处实现）',
    orig.replace(":placeholder=\"selCellCount + ' 格'\"",
      ":placeholder=\"((selRange.r1 - selRange.r0 + 1) * (selRange.c1 - selRange.c0 + 1)) + ' 格'\""),
    { D12: false }],
  ['M25 浮层退回 sticky（包含块夹住 ⇒ 又跑到屏幕外）',
    orig.replace('position:fixed;left:var(--sidebar-w,248px)', 'position:sticky;left:var(--sidebar-w,248px)'),
    { D13: false }],
  ['M26 浮层不让开侧栏（盖在导航上）',
    orig.replace('left:var(--sidebar-w,248px)', 'left:0'),
    { D14: false }],
  ['M27 填入输入框退回共用类名（真机上选择器误命中阈值框）',
    orig.replace('class="ctx-ipt ctx-ipt-fill"', 'class="ctx-ipt"'),
    { D15: false }],
  ['M28 批量填入退回「选区面积」报数（只读列被算进去 ⇒ 报的比实际多）',
    /* 🔴 这是 v212 真机第 4 个真缺陷的变异：12 格选区里只有 4 格数量格，
       原实现会报「已批量写入 12 个单元格」—— 用户以为漏填而反复重试。 */
    orig.replace(
      "  let n = 0\n  for (let ri = r0; ri <= r1; ri++)\n    for (let ci = c0; ci <= c1; ci++) { if (writeCellVal(ri, ci, val)) n++ }\n  toast(`已批量写入 ${n} 个单元格`, 'ok')",
      "  for (let ri = r0; ri <= r1; ri++)\n    for (let ci = c0; ci <= c1; ci++) { writeCellVal(ri, ci, val) }\n  const n = (r1 - r0 + 1) * (c1 - c0 + 1)\n  toast(`已批量写入 ${n} 个单元格`, 'ok')"),
    { D16: false }],
]

let bad = 0, ran = 0, skipped = 0
console.log('反证自测：每个变异只改坏一件事，看对应断言是否**真的**变红\n')
for (const [name, src, expect] of cases) {
  const isBaseline = name.indexOf('基线') >= 0
  if (!isBaseline && src === orig) { console.log('  ⚠️ 变异未生效（replace 没命中）: ' + name); skipped++; bad++; continue }
  const got = checks(src)
  const keys = isBaseline ? Object.keys(got) : Object.keys(expect)
  const shown = []
  for (const k of keys) {
    const want = isBaseline ? true : expect[k]
    const okk = got[k] === want
    if (!okk) bad++
    ran++
    shown.push(k + '=' + got[k] + (okk ? '✓' : ' ✗ 反证失败(期望' + want + ')'))
  }
  console.log(name.padEnd(38) + ' | ' + shown.join('   '))
}

console.log('')
console.log('基线断言 ' + Object.keys(checks(orig)).length + ' 条全绿；'
  + (cases.length - 1) + ' 个变异里 ' + (cases.length - 1 - skipped) + ' 个成功生效')
console.log(bad === 0
  ? '✅ 反证通过：每条关键断言都会因「改坏源码」而变红 —— 它们不是恒真断言'
  : '❌ 有 ' + bad + ' 项反证未按预期变化 —— 该断言可能恒真，必须重写')
process.exitCode = bad === 0 ? 0 : 1
