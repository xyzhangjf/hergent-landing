/**
 * v679 契约：列表页「页头控制区」密度标准（筛选工具条卡片 + 状态页签条）。
 *
 * 现象（老板红框反馈）：采购单列表页头一行筛选控件被塞进 18px 内距的 `.card` 里，
 *   1920 视口实测：筛选卡高 70px，其中 36px 是纯上下留白、控件行只 32px ⇒ 留白占比 51%；
 *   状态页签 `.main-tab` 40px 高、横向 18px 内距，与下方紧凑表格明显脱节。
 *
 * 本契约钉死三件事，防止"改一处漂移两处"：
 *   ① 13 个列表页筛选卡（`.card.xx-filter`）内距必须 ≤ 12px 纵向，且 < `.card` 基线 18px；
 *   ② 状态页签 `.psi-tabbar .main-tab` 纵向内距 ≤ 8px、字号 ≤ 13px；
 *   ③ 筛选行 `.psi-frow` 间距 ≤ 10px。
 * 并对每条断言做"已知坏样本"判别力自证（prove）。
 *
 * 只读源码，不连网、不跑浏览器。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const VARIABLES = join(ROOT, 'src/styles/variables.css')
const PSI = join(ROOT, 'src/styles/psi-list.css')

const FILTER_CLASSES = [
  'ipl-filter', 'isl-filter', 'is-filter',
  'fc-filter', 'ff-filter', 'fd-filter', 'fbk-filter', 'fs-filter',
  'wob-filter', 'woi-filter', 'wsa-filter', 'win-filter', 'wvs-filter',
]

let pass = 0, fail = 0
const errors = []
function ok (name, cond, detail = '') {
  if (cond) { pass++; console.log('  ✅ ' + name) }
  else { fail++; errors.push(name + (detail ? ' :: ' + detail : '')); console.log('  ❌ ' + name + (detail ? ' :: ' + detail : '')) }
}

/** 取 selector 首次出现处其后第一对 `{}` 的声明体（本仓这些规则无嵌套，足够） */
function bodyAfter (css, needle) {
  const i = css.indexOf(needle)
  if (i < 0) return null
  const open = css.indexOf('{', i)
  if (open < 0) return null
  const close = css.indexOf('}', open)
  if (close < 0) return null
  return css.slice(open + 1, close)
}
/** 从声明体读 `padding:` 简写的纵向值（px）；无则 null */
function padV (body) {
  if (!body) return null
  const m = /(?:^|;|\s)padding\s*:\s*([^;]+)/.exec(body)
  if (!m) return null
  const parts = m[1].trim().split(/\s+/).map((s) => parseFloat(s)).filter((n) => !isNaN(n))
  return parts.length ? parts[0] : null
}
function numDecl (body, prop) {
  if (!body) return null
  const m = new RegExp('(?:^|;|\\s)' + prop + '\\s*:\\s*([0-9.]+)px').exec(body)
  return m ? parseFloat(m[1]) : null
}

/** 判别力自证：detector 对 good 必须判绿、对 bad 必须判红 */
function prove (name, detector, good, bad) {
  const gOkay = detector(good)
  const bBad = detector(bad)
  ok(`[自证] ${name} 对真样本判绿`, gOkay === true, 'good 未通过')
  ok(`[自证] ${name} 对坏样本判红`, bBad === false, 'bad 竟通过（假阴性）')
}

const vars = readFileSync(VARIABLES, 'utf8')
const psi = readFileSync(PSI, 'utf8')

console.log('\n── v679 页头控制区密度契约 ──')

/* ---------- ① 筛选卡内距 ---------- */
const filterBody = bodyAfter(vars, '.card.ipl-filter')
const filterPadV = padV(filterBody)
const filterDetector = (css) => {
  const b = bodyAfter(css, '.card.ipl-filter')
  const v = padV(b)
  return v !== null && v <= 12 && v < 18
}
ok('筛选卡内距规则存在', filterBody !== null)
ok('筛选卡纵向内距 ≤12px 且 <18px 基线', filterPadV !== null && filterPadV <= 12 && filterPadV < 18, `实测 ${filterPadV}`)
ok('筛选卡横向内距 ≤16px', (() => { const m = /padding\s*:\s*([^;]+)/.exec(filterBody || ''); if (!m) return false; const p = m[1].trim().split(/\s+/).map(parseFloat); return (p[1] ?? p[0]) <= 16 })())
ok('覆盖全部 ' + FILTER_CLASSES.length + ' 个列表页筛选卡类名', FILTER_CLASSES.every((c) => vars.includes('.' + c)))
ok('`.card` 基线仍是 18px（说明覆盖有意义）', (numDecl(bodyAfter(vars, '.card{'), 'padding') ?? 18) === 18, '基线被改')
prove('筛选卡内距', filterDetector,
  vars,
  vars.replace(/padding\s*:10px 14px/, 'padding:18px'))

/* ---------- ② 状态页签条 ---------- */
const tabBody = bodyAfter(psi, '.psi-tabbar .main-tab')
const tabPadV = padV(tabBody)
const tabFont = numDecl(tabBody, 'font-size')
const tabDetector = (css) => {
  const b = bodyAfter(css, '.psi-tabbar .main-tab')
  const v = padV(b); const f = numDecl(b, 'font-size')
  return v !== null && v <= 8 && f !== null && f <= 13
}
ok('状态页签收紧规则存在', tabBody !== null)
ok('状态页签纵向内距 ≤8px', tabPadV !== null && tabPadV <= 8, `实测 ${tabPadV}`)
ok('状态页签字号 ≤13px', tabFont !== null && tabFont <= 13, `实测 ${tabFont}`)
prove('状态页签', tabDetector,
  psi,
  psi.replace(/\.psi-tabbar \.main-tab \{[^}]*\}/, '.psi-tabbar .main-tab { padding: 10px 18px; font-size: 14px }'))

/* ---------- ③ 筛选行间距 ---------- */
const frowBody = bodyAfter(psi, '.psi-frow {')
const frowGap = numDecl(frowBody, 'gap')
ok('筛选行 gap ≤10px', frowGap !== null && frowGap <= 10, `实测 ${frowGap}`)
prove('筛选行间距', (css) => { const g = numDecl(bodyAfter(css, '.psi-frow {'), 'gap'); return g !== null && g <= 10 },
  psi,
  psi.replace(/\.psi-frow \{[^}]*\}/, '.psi-frow { display: flex; align-items: center; gap: 12px; flex-wrap: wrap }'))

/* ---------- ④ 漂移检查：页面 scoped 不得给筛选卡另设 padding ---------- */
function walk (dir) {
  const out = []
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    const st = statSync(p)
    if (st.isDirectory()) out.push(...walk(p))
    else if (n.endsWith('.vue')) {
      const src = readFileSync(p, 'utf8')
      for (const c of FILTER_CLASSES) {
        const re = new RegExp('\\.' + c + '\\s*\\{[^}]*\\}', 'g')
        let m
        while ((m = re.exec(src))) {
          if (/(?:^|;|\s)padding\s*:/.test(m[0])) {
            out.push(`${p.replace(ROOT + '/', '')} :: .${c} 自带 padding`)
          }
        }
      }
    }
  }
  return out
}
const drift = walk(join(ROOT, 'src/pages'))
ok('页面 scoped 未给筛选卡另设 padding（无第二份真相源）', drift.length === 0, drift.slice(0, 4).join(' | '))

/* ---------- 汇总 ---------- */
console.log(`\n  ${fail === 0 ? 'ALL PASS' : 'FAILED'}  (${pass} passed, ${fail} failed)`)
if (fail) { console.log('\n  失败项:'); errors.forEach((e) => console.log('   - ' + e)) }
process.exit(fail === 0 ? 0 : 1)
