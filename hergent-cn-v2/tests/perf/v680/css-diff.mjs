/* 规范化前缀后 diff 四个建单页的 scoped CSS —— 把 copy-paste 漂移全部揪出来。
   用法: node tests/perf/v680/css-diff.mjs [outFile] */
import fs from 'fs'
import path from 'path'

const DIR = 'src/pages/inventory/new'
const FILES = {
  base: 'PurchaseOrderForm.vue',
  ret: 'PurchaseReturnForm.vue',
  sale: 'SaleDocForm.vue',
  trf: 'TransferDocForm.vue',
}

function styleBlock(file) {
  const src = fs.readFileSync(path.join(DIR, file), 'utf8')
  const i = src.indexOf('<style scoped>')
  if (i < 0) return ''
  const j = src.indexOf('</style>', i)
  return src.slice(i + '<style scoped>'.length, j)
}

/** 极简 CSS 规则解析：按 "}" 切，抽出选择器 + 声明体。忽略注释。 */
function rules(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const out = []
  let depth = 0, buf = ''
  for (const ch of clean) {
    buf += ch
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        const k = buf.indexOf('{')
        if (k > 0) {
          const sel = buf.slice(0, k).trim().replace(/\s+/g, ' ')
          const body = buf.slice(k + 1, -1).trim().replace(/\s+/g, ' ')
          out.push([sel, body])
        }
        buf = ''
      }
    }
  }
  return out
}

/** 把 isn 前缀归一回 ipn，让 4 个页面可比。 */
const norm = (s) => s.replace(/\bisn-/g, 'ipn-')
const normSel = (s) => norm(s)

const base = rules(styleBlock(FILES.base)).map(([s, b]) => [normSel(s), norm(b)])
const baseMap = new Map(base.map(([s, b]) => [s, b]))

const report = {}
for (const key of ['ret', 'sale', 'trf']) {
  const cur = rules(styleBlock(FILES[key])).map(([s, b]) => [normSel(s), norm(b)])
  const curMap = new Map(cur.map(([s, b]) => [s, b]))
  const onlyBase = [], onlyCur = [], changed = []
  for (const [s] of baseMap) if (!curMap.has(s)) onlyBase.push(s)
  for (const [s, b] of curMap) {
    if (!baseMap.has(s)) onlyCur.push(s + '  { ' + b + ' }')
    else if (baseMap.get(s) !== b) changed.push(`  ${s}\n    基准: ${baseMap.get(s)}\n    本页: ${b}`)
  }
  report[key] = { onlyBase, onlyCur, changed }
}

const outFile = process.argv[2] || 'tests/perf/v680/css-diff.txt'
let text = ''
for (const [k, r] of Object.entries(report)) {
  text += `\n${'='.repeat(72)}\n### ${k}  (${FILES[k]})\n${'='.repeat(72)}\n`
  text += `\n-- 基准有、本页没有 (${r.onlyBase.length}) --\n` + r.onlyBase.map((s) => '  ' + s).join('\n') + '\n'
  text += `\n-- 本页独有 (${r.onlyCur.length}) --\n` + r.onlyCur.map((s) => '  ' + s).join('\n') + '\n'
  text += `\n-- 同选择器但声明不同 (${r.changed.length}) --\n` + r.changed.join('\n') + '\n'
}
fs.writeFileSync(outFile, text)
console.log(text)
console.log('\n[written] ' + outFile)
