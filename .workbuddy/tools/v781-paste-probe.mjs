// 实测：Forecast.vue 粘贴逻辑对「单列纯数字」的两种场景
// 场景 A：编辑态 + 已选中数量列单元格  → 应走 pasteRegion 纵向填数量列
// 场景 B：编辑态 + 未选中单元格        → 走 tryPasteCross / 主档粘贴

function parseTSV(text) {
  const norm = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = norm.split('\n')
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop()
  return lines.map(l => l.split('\t').map(s => s.trim()))
}

// —— 模拟业务状态 ——
const units = [{ name: '唐成' }, { name: '李四' }]
const visibleCols = [{ key: 'name', edit: 'text' }, { key: 'spec', edit: 'text' }]
const qtyMax = 999999
function unitCount() { return units.length }
function blankRow() { return { name: '', spec: '', qtyByUnit: {} } }

function parseNumInput(v) {
  const s = String(v == null ? '' : v).trim().normalize('NFKC').replace(/,/g, '').trim()
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return v   // 不合法原样返回（会被判红）
  return Number(s)
}

function writeCellVal(rows, r, c, v) {
  const rw = rows[r]; if (!rw) return false
  if (c < visibleCols.length) {
    const col = visibleCols[c]
    if (col.edit === 'ro') return false
    rw[col.key] = col.edit === 'num' ? parseNumInput(v) : (v == null ? '' : String(v))
    return true
  }
  const ui = c - visibleCols.length
  if (ui < unitCount()) { rw.qtyByUnit[units[ui].name] = parseNumInput(v); return true }
  return false
}

// ===== 场景 A：选中唐成列首格 (r=0, c=visibleCols.length+0=2) =====
function scenarioA_selectedCell() {
  const rows = [blankRow(), blankRow(), blankRow(), blankRow()]
  const selR = 0, selC = visibleCols.length + 0  // 唐成列
  const clipboard = '12\n34\n56\n78\n'
  const block = parseTSV(clipboard)
  const writes = []
  const rowsN = block.length, cols = block[0].length
  for (let i = 0; i < rowsN; i++)
    for (let j = 0; j < cols; j++) {
      const v = (block[i] || [])[j]
      if (v === '' || v == null) continue
      writes.push({ r: selR + i, c: selC + j, v })
    }
  for (const w of writes) writeCellVal(rows, w.r, w.c, w.v)
  return { rows }
}

// ===== 场景 B：未选中单元格，纯数字单列 =====
function scenarioB_noSelection() {
  const rows = [blankRow(), blankRow(), blankRow()]
  const clipboard = '12\n34\n56\n'
  const text = clipboard
  const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim().length)
  // tryPasteCross 第一步：找表头含 名称/品名/商品
  const HEADER = ['名称', '品名', '货品', '商品']
  let tryPasteCrossHit = false
  for (const line of lines) {
    const head = line.split('\t').map(s => s.trim())
    if (head.findIndex(h => HEADER.includes(h)) >= 0) { tryPasteCrossHit = true; break }
  }
  // 主档粘贴（tryPasteCross 失败时走这里）
  const added = []
  const headerMap = ['name', 'barcode', 'spec', 'unit', 'sale_price', 'dist_price', 'product_code', 'factory_price', 'safety_stock', 'expiry_days']
  for (let i = 0; i < lines.length; i++) {
    const cells = lines[i].split('\t')
    const row = blankRow()
    headerMap.forEach((key, ci) => {
      const v = (cells[ci] || '').trim()
      row[key] = v
    })
    if (!row.name && !row.barcode) { /* skipped */ }
    else { rows.push(row); added.push(row.name) }
  }
  return { tryPasteCrossHit, addedNames: added, rows }
}

console.log('=== 场景 A：已选中唐成列单元格，粘贴单列数字 ===')
const A = scenarioA_selectedCell()
console.log('唐成列 (qtyByUnit.唐成) =', A.rows.map(r => r.qtyByUnit['唐成']))
console.log('→ 结论：', A.rows.every(r => r.qtyByUnit['唐成'] != null && r.qtyByUnit['唐成'] !== '') ? '数字成功填进唐成列 ✅' : '未填进 ❌')

console.log('\n=== 场景 B：未选中单元格，粘贴单列数字（纯数字，无表头） ===')
const B = scenarioB_noSelection()
console.log('tryPasteCross 命中表头？', B.tryPasteCrossHit)
console.log('主档粘贴新增的商品名 =', JSON.stringify(B.addedNames))
console.log('→ 结论：', B.tryPasteCrossHit === false && B.addedNames.length > 0
  ? '❌ 数字被当成「商品名」新增了 N 行，唐成列数量没填（改单失败）'
  : '—')

// ===== 场景 C：未选中单元格，但 Excel 是「商品名 + 唐成」两列（带客户名列头） =====
function scenarioC_twoColWithUnitHeader() {
  const rows = [{ name: '商品A', qtyByUnit: {} }, { name: '商品B', qtyByUnit: {} }, { name: '商品C', qtyByUnit: {} }]
  const clipboard = '商品名\t唐成\n商品A\t12\n商品B\t34\n商品C\t56\n'
  const lines = clipboard.replace(/\r/g, '').split('\n').filter(l => l.trim().length)
  const block = lines.map(l => l.split('\t').map(s => s.trim()))
  const head = block[0]
  const nameIdx = head.findIndex(h => /名称|品名|货品|商品/.test(h))
  const map = []
  head.forEach((h, bi) => {
    if (bi === nameIdx) return
    const ui = units.findIndex(u => u.name === h)
    if (ui >= 0) map.push({ bi, c: visibleCols.length + ui })
  })
  let hit = false
  if (nameIdx >= 0 && map.length) {
    block.slice(1).forEach(cells => {
      const nm = cells[nameIdx]
      let ri = rows.findIndex(r => r.name === nm)
      if (ri < 0) { rows.push({ name: nm, qtyByUnit: {} }); ri = rows.length - 1 }
      map.forEach(({ bi, c }) => {
        const v = cells[bi]
        if (v === '' || v == null) return
        writeCellVal(rows, ri, c, v)
      })
      hit = true
    })
  }
  return { hit, rows }
}

console.log('\n=== 场景 C：未选中单元格，Excel 是「商品名 + 唐成」两列（带客户名列头） ===')
const C = scenarioC_twoColWithUnitHeader()
console.log('tryPasteCross 能否正确填充唐成列？', C.hit)
console.log('唐成列 =', C.rows.map(r => r.qtyByUnit['唐成']))
console.log('→ 结论：', C.hit && C.rows.every(r => r.qtyByUnit['唐成'] != null)
  ? '✅ 只要 Excel 列头写的是客户名「唐成」，即使不点单元格也能正确填'
  : '—')
