#!/usr/bin/env node
/* ============================================================================
   设计令牌护栏（P1/v717 建立）
   ----------------------------------------------------------------------------
   拦住「新发明一个颜色」这件事，而不是回过头去骂存量。

   背景：v716 评审实测 `src/**`（不含 variables.css）里有 199+ 个硬编码色值、
   563 次出现，同一个系统里 `#06b6d4`（品牌青）和 `#2f6bff`（另一个蓝）并存，
   用户会以为来自两个产品。存量一次清不完，但**新增必须拦住**，否则清了也白清。

   判据（不是"看见 # 就报错"，那样没人会用它）：
     每个文件的**允许色值集合**记录在 `scripts/ui-token-baseline.json`。
     - 文件不在 baseline 里、却出现任何 hex 颜色        → 报错（新文件必须走令牌）
     - 文件在 baseline 里、但用了集合外的**新**色值     → 报错（不许发明新颜色）
     - 用了集合内的旧色值                             → 放行（存量，分批清）
     - `#fff/#ffffff/#000` 及其带 alpha 的写法         → 永远放行（结构性白/黑，不值得令牌化）
     清了存量就把 baseline 里那一项删掉（`--update` 会自动做），集合只减不增。

   用法：
     node scripts/check-tokens.mjs            # 检查，有违规 exit 1
     node scripts/check-tokens.mjs --update   # 按当前代码重写 baseline（清完存量后用）
     node scripts/check-tokens.mjs --list     # 打印 baseline 全量，便于分批清理

   接入：`npm run build` 前自动跑（package.json 的 prebuild）。
   ============================================================================ */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const BASELINE = join(ROOT, 'scripts', 'ui-token-baseline.json')
const TOKEN_FILE = 'src/styles/variables.css'

/** 结构性白/黑：永远放行。它们是"没有颜色"，不是"某个色号"。 */
const STRUCTURAL = new Set([
  'fff', 'ffffff', '000', '000000',
  'ffffff00', '00000000',
])

const HEX = /#([0-9a-fA-F]{3,8})\b/g

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (/\.(vue|css)$/.test(name)) out.push(p)
  }
  return out
}

function collect() {
  /** @type {Map<string, Set<string>>} 相对路径 → 该文件出现过的色值 */
  const found = new Map()
  for (const abs of walk(SRC)) {
    const rel = relative(ROOT, abs).split('\\').join('/')
    if (rel === TOKEN_FILE) continue
    const src = readFileSync(abs, 'utf8')
    const vals = new Set()
    for (const m of src.matchAll(HEX)) {
      const v = m[1].toLowerCase()
      // 颜色后必须紧跟非十六进制字符，避免把 #fff 里的 f 和后面单词粘一起
      if (STRUCTURAL.has(v)) continue
      vals.add(v)
    }
    if (vals.size) found.set(rel, vals)
  }
  return found
}

const args = new Set(process.argv.slice(2))
const current = collect()

if (args.has('--update')) {
  const obj = {}
  for (const k of [...current.keys()].sort()) obj[k] = [...current.get(k)].sort()
  writeFileSync(BASELINE, JSON.stringify(obj, null, 2) + '\n', 'utf8')
  const n = Object.values(obj).reduce((a, b) => a + b.length, 0)
  console.log(`已写入 ${BASELINE}`)
  console.log(`  文件 ${Object.keys(obj).length} 个 / 色值 ${n} 条`)
  process.exit(0)
}

if (args.has('--list')) {
  const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {}
  const rows = Object.entries(base).map(([f, cs]) => [f, cs.length])
  rows.sort((a, b) => b[1] - a[1])
  console.log('待清理的硬编码色（文件 → 色值数）：')
  for (const [f, c] of rows) console.log(`  ${String(c).padStart(3)}  ${f}`)
  console.log(`\n合计 ${rows.length} 个文件 / ${rows.reduce((a, b) => a + b[1], 0)} 条`)
  process.exit(0)
}

const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {}
const violations = []

for (const [file, vals] of current) {
  const allowed = new Set(base[file] || [])
  if (!base[file]) {
    violations.push({ file, kind: 'new-file', vals: [...vals].sort() })
    continue
  }
  const added = [...vals].filter(v => !allowed.has(v)).sort()
  if (added.length) violations.push({ file, kind: 'new-color', vals: added })
}

if (!violations.length) {
  const files = Object.keys(base).length
  const total = Object.values(base).reduce((a, b) => a + b.length, 0)
  console.log(`✓ 设计令牌护栏通过（存量待清：${files} 个文件 / ${total} 条，见 --list）`)
  process.exit(0)
}

console.error('\n✗ 设计令牌护栏：出现了新的硬编码色值\n')
for (const v of violations) {
  console.error(`  ${v.file}`)
  console.error(`    ${v.kind === 'new-file' ? '新文件直接用 hex（应从 variables.css 取令牌）' : '新增了 baseline 之外的色值'}`)
  console.error(`    ${v.vals.map(x => '#' + x).join(', ')}\n`)
}
console.error('改法（按顺序选一个）：')
console.error('  1) 用已有令牌：background:var(--p-dark) / color:var(--st-ok-txt) / border:1px solid var(--bd)')
console.error('  2) 确实缺语义色 ⇒ 在 src/styles/variables.css 的 :root 与 :root.dark 里各加一个令牌，再来引用')
console.error('  3) 只是把存量挪了位置/改了大小写 ⇒ 跑 `node scripts/check-tokens.mjs --update`')
console.error('\n不要直接往 baseline 里手塞色值 —— 那等于把护栏拆了。\n')
process.exit(1)
