#!/usr/bin/env node
/**
 * 全站「指路文案」契约（v766）
 * ============================================================================
 * 报障背景：老板原话「请帮我全站排查一下哪些地方也应该采取这种『去配置、去填写』
 * 关联设计，给用户提供快速跳转到对应页面入口，而不是只提供文案，让用户自己去找」。
 *
 * 实测根因不是文案写错，而是**跳转写法有 4 套并存**：
 *   `<router-link>` 13 处 / 裸 `href="#/..."` 3 处 / 各页自写 `goXxx()` 34 处 / `router.push` 0 处。
 * 于是「加一个可点入口」每次都要重新发明一遍，多数时候干脆没加 —— 文案照样写着
 * 「请到『商品档案』补齐进货价」，而**没有任何可点的东西**。
 *
 * 这类缺陷的形态是「读起来完全正常，只有真去点才发现点不动」，零报错、零控制台日志，
 * 所以只能靠静态契约钉住。三条判据：
 *   ① 死文案总数**只能降不能升**（三态：超基线=红 / 低于基线=红并提示下调基线）；
 *   ② 本版已修的那批锚点必须**真的有入口**（防止下次重构把 GoLink 删掉又变回死文本）；
 *   ③ `<GoLink>` 用到了就必须 import（项目无 unplugin-vue-components、也没全局注册，
 *      漏 import ⇒ 组件未解析 ⇒ **整段静默不渲染**，v557 的 Icon 就是这么丢的）；
 * 外加坏样本自证，证明这套判据真的能红。
 *
 * 用法：node tests/go-hint.contract.mjs
 * 退出码：全过 0，否则 1。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'src')

/* 冻结基线（v766 收口后的实测值）。**只许往下调**。
   超了 = 有人新写了一句指路死文案；低了 = 又修掉了几处，请把本数改小（不许放着不管，
   否则基线越漂越松，这个数就变成"永远绿"的摆设 —— 这是本项目反复踩过的空头支票）。 */
const DEAD_BASELINE = 0

/* 豁免名单：**只收技术上放不进可点元素的地方**，当前仅两类，都是 `:title` 提示（tooltip）。
   浏览器原生 tooltip 是纯文本，塞不进 `<a>` / `<GoLink>` —— 想给入口就得把整句提示搬到
   常驻版面，那是"改设计"，不是"补入口"。所以这类允许保留文字指路。
   🔴 每条豁免都要求**仍然真的存在**（见断言 5）：修掉一条就必须删一条，
      否则豁免名单会慢慢变成"什么都能塞进来的后门"，这个检查也就废了。 */
const EXEMPTS = [
  { file: 'src/components/CopilotDrawer.vue', needle: '去「设置 › AI 团队」里改',
    reason: 'AI 权限按钮的 :title 提示（tooltip 放不进链接）' },
  { file: 'src/pages/Forecast.vue', needle: '请到「商品档案」重新启用',
    reason: '「已停用」角标的 :title 提示（同上）' },
]

/* 跨页指路文案：让用户"去另一个页面办事"的措辞。
   ⚠️ 不含「点右上角 / 点上方」——那些按钮就在同屏，属于同屏指路，改了反而累赘。 */
const CROSS = /请(先)?到|请(先)?在|请前往|前往「|去「|先去|切到「|请去|请到/
/* 声明「这里不需要动」的例外：这些不是指路，是就地表单校验或外部系统说明。 */
const SKIP = /请先选择|请先填写|请先勾选|请先保存|请先修正|请先框选|请先选中|请先点击|请先输入|请先点「|请先在上面|请先停用或改期|不必先去|不必先|畅捷通|金蝶/
/* 同一条指路句里出现下列任一，即视为"能点"（含 GoLink 渲染出的 a.lnk-btn）。 */
const CLICKABLE = /<GoLink|<router-link|href\s*=|@click\s*=|lnk-btn|go-link/
const CN = /[\u4e00-\u9fa5]{3,}/
const WINDOW = 6

function stripComments(text) {
  const blank = (s) => s.replace(/[^\n]/g, ' ')
  let out = ''
  const lines = text.split('\n')
  let inHtml = false
  let inBlk = false
  for (const line of lines) {
    let s = line
    if (inHtml) {
      const i = s.indexOf('-->')
      if (i >= 0) { inHtml = false; s = blank(s.slice(0, i + 3)) + s.slice(i + 3) }
      else s = blank(s)
    } else {
      const i = s.indexOf('<!--')
      if (i >= 0) {
        const e = s.indexOf('-->', i + 4)
        if (e >= 0) s = s.slice(0, i) + blank(s.slice(i, e + 3)) + s.slice(e + 3)
        else { inHtml = true; s = s.slice(0, i) + blank(s.slice(i)) }
      }
    }
    if (inBlk) {
      const i = s.indexOf('*/')
      if (i >= 0) { inBlk = false; s = blank(s.slice(0, i + 2)) + s.slice(i + 2) }
      else s = blank(s)
    } else {
      const i = s.indexOf('/*')
      if (i >= 0 && s.indexOf('*/', i) < 0) { inBlk = true; s = s.slice(0, i) + blank(s.slice(i)) }
    }
    if (!s.includes('http')) {
      const m = s.match(/(^|\s)\/\//)
      if (m) s = s.slice(0, m.index) + blank(s.slice(m.index))
    }
    out += s + '\n'
  }
  return out
}

function templateSpan(lines) {
  let start = 0
  for (let i = 0; i < lines.length; i++) if (/^\s*<template/.test(lines[i])) { start = i; break }
  let depth = 0
  for (let i = start; i < lines.length; i++) {
    depth += (lines[i].match(/<template/g) || []).length
    depth -= (lines[i].match(/<\/template>/g) || []).length
    if (depth <= 0 && i > start) return [start, i]
  }
  return [start, lines.length - 1]
}

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, acc)
    else if (e.name.endsWith('.vue')) acc.push(p)
  }
  return acc
}

/* 返回所有「跨页指路但附近没有可点元素」的位置 */
function findDead(files) {
  const dead = []
  for (const f of files) {
    const rel = path.relative(ROOT, f)
    const clean = stripComments(fs.readFileSync(f, 'utf8'))
    const lines = clean.split('\n')
    const [t0, t1] = templateSpan(lines)
    for (let i = t0; i <= t1; i++) {
      const ln = lines[i]
      if (!CN.test(ln) || SKIP.test(ln) || !CROSS.test(ln)) continue
      const lo = Math.max(t0, i - WINDOW)
      const hi = Math.min(t1, i + WINDOW)
      if (CLICKABLE.test(lines.slice(lo, hi + 1).join('\n'))) continue
      dead.push({ rel, line: i + 1, raw: ln.trim().replace(/\s+/g, ' '),
        text: ln.trim().replace(/\s+/g, ' ').slice(0, 90) })
    }
  }
  return dead
}

const failures = []
const notes = []
const ok = (m) => notes.push('✅ ' + m)
const bad = (m) => { failures.push(m) }

const files = walk(SRC)
const allDead = findDead(files)
/* 按豁免名单摘掉 tooltip 那几条；同时记下每条命中了几个（用于"豁免过期"自检） */
const exemptHits = EXEMPTS.map((e) => ({ ...e, hit: allDead.filter((d) => d.rel === e.file && d.raw.includes(e.needle)).length }))
const dead = allDead.filter((d) => !exemptHits.some((e) => d.rel === e.file && d.raw.includes(e.needle)))

console.log('='.repeat(74))
console.log('全站「指路文案」契约（v766）')
console.log('='.repeat(74))
console.log(`扫描 .vue：${files.length} 个`)

/* ── 断言 0：解析自检（防空集全票通过）─────────────────────────────
   🔴 正则抽空集照样"全部通过"，这是本项目的头号假绿形态。
   若一次都没命中跨页指路，说明正则/剥离逻辑坏了，而不是代码干净了。 */
{
  const hits = files.reduce((n, f) => {
    const lines = stripComments(fs.readFileSync(f, 'utf8')).split('\n')
    return n + lines.filter((l) => CROSS.test(l) && CN.test(l) && !SKIP.test(l) && !l.includes('<template')).length
  }, 0)
  if (files.length < 120) bad(`解析自检：只扫到 ${files.length} 个 .vue（应 ≥120）—— 扫描范围错了`)
  else if (hits < 10) bad(`解析自检：跨页指路只命中 ${hits} 行（应 ≥10）—— 正则或剥离逻辑坏了`)
  else ok(`解析自检：${files.length} 个文件 / 跨页指路行 ${hits} 行（非空集）`)
}

/* ── 断言 1：死文案数三态 ─────────────────────────────────────── */
if (dead.length > DEAD_BASELINE) {
  bad(`死文案 ${dead.length} 处 > 基线 ${DEAD_BASELINE} —— 新增了「只让用户自己去找」的指路文案：`)
  for (const d of dead) failures.push(`   · ${d.rel}:${d.line}  ${d.text}`)
} else if (dead.length < DEAD_BASELINE) {
  bad(`死文案 ${dead.length} 处 < 基线 ${DEAD_BASELINE} —— 又修掉了 ${DEAD_BASELINE - dead.length} 处，` +
      `请把 DEAD_BASELINE 下调到 ${dead.length}（基线不跟实际走 = 空头支票）`)
} else {
  ok(`死文案 ${dead.length} 处 = 基线`)
}

/* ── 断言 2：本版已修的锚点必须真的有入口 ───────────────────────
   防止"下次重构把 GoLink 删掉、文案留着"。逐条对着源码查「该文件里 GoLink 的目标正确」。 */
const ANCHORS = [
  ['src/pages/reports/CompanyProfit.vue',    '/archive/products?fp=1'],
  ['src/pages/reports/CustomerProfit.vue',   '/archive/products?fp=1'],
  ['src/pages/reports/CustomerProfitAnalysis.vue', '/archive/products?fp=1'],
  ['src/pages/reports/GrossProfit.vue',      '/archive/products?fp=1'],
  ['src/pages/wh/StocktakeDiff.vue',         '/wh/stocktake'],
  ['src/pages/wh/StaticFreeze.vue',          '/wh/stocktake'],
  ['src/pages/EmployeeArchive.vue',          'goReportMapping'],
  ['src/pages/ProductTarget.vue',            'goReportMapping'],
  ['src/pages/PriceChannels.vue',            '/archive/customers'],
  ['src/pages/PriceChannels.vue',            '/archive/products'],
  ['src/pages/ReportMapping.vue',            '/archive/warehouses'],
  ['src/components/rebate/SupplierPicker.vue', '/archive/suppliers'],
  ['src/pages/LossAccounting.vue',           "tab: 'fill'"],
  ['src/components/forecast/AllocPanel.vue', "tab: 'target'"],
  ['src/components/forecast/AllocPanel.vue', '/archive/employees'],
  ['src/components/forecast/RebateSprint.vue', "new: 'brand'"],
  ['src/components/forecast/ImportPanel.vue', '/archive/products?fp=1'],
  ['src/components/rebate/MonthlyAchvChart.vue', "tab: 'achv'"],
]
{
  let miss = 0
  for (const [rel, needle] of ANCHORS) {
    const p = path.join(ROOT, rel)
    if (!fs.existsSync(p)) { bad(`锚点文件不存在：${rel}`); miss++; continue }
    if (!fs.readFileSync(p, 'utf8').includes(needle)) {
      bad(`锚点丢了：${rel} 里找不到「${needle}」—— 该处指路又变回死文本`)
      miss++
    }
  }
  if (!miss) ok(`已修锚点 ${ANCHORS.length} 条全部在位`)
}

/* ── 断言 3：GoLink 用到了必须 import（否则整段静默不渲染）──────── */
{
  const users = files.filter((f) => /<GoLink/.test(fs.readFileSync(f, 'utf8')))
  let miss = 0
  for (const f of users) {
    const src = fs.readFileSync(f, 'utf8')
    if (!/^import GoLink from/m.test(src)) {
      bad(`漏 import：${path.relative(ROOT, f)} 用了 <GoLink> 但没 import ⇒ 组件未解析、整段不渲染`)
      miss++
    }
  }
  if (users.length < 10) bad(`只用到了 ${users.length} 处 <GoLink>（应 ≥10）—— 共享件没被用起来`)
  else if (!miss) ok(`<GoLink> 使用 ${users.length} 个文件，全部已 import`)
}

/* ── 断言 4：GoLink 组件自身两种形态都在 ─────────────────────────
   只有 router-link 形态 ⇒ 同页动作（切 tab / 开弹窗）无法表达，会被逼回自写 goXxx()。 */
{
  const p = path.join(SRC, 'components/GoLink.vue')
  if (!fs.existsSync(p)) bad('缺少共享件 src/components/GoLink.vue')
  else {
    const s = fs.readFileSync(p, 'utf8')
    const hasLink = /<router-link/.test(s)
    const hasBtn = /<button/.test(s)
    const hasEmit = /defineEmits\(\['click'\]\)/.test(s)
    if (!hasLink) bad('GoLink 缺 router-link 形态（跨页跳转不成立）')
    if (!hasBtn) bad('GoLink 缺 button 形态（同页动作无法表达，会被逼回自写 goXxx）')
    if (!hasEmit) bad('GoLink 未 defineEmits([click]) —— 同页动作回调收不到')
    if (hasLink && hasBtn && hasEmit) ok('GoLink 两种形态 + click 透传齐全')
  }
}

/* ── 断言 5：坏样本自证（证明判据真的会红）─────────────────────────
   一个永远绿的检查等于没有检查。往临时副本注入两种典型缺陷，必须都被抓到。 */
{
  const tmpRoot = path.join(ROOT, '.tmp-go-hint')
  const tmpFile = path.join(tmpRoot, 'Bad.vue')
  try {
    fs.mkdirSync(tmpRoot, { recursive: true })
    // 坏样本 A：跨页指路死文案（附近没有任何可点元素）
    fs.writeFileSync(tmpFile, `<template>\n  <div>\n    <p>请到「商品档案」补齐进货价，补齐后自动启用。</p>\n  </div>\n</template>\n`, 'utf8')
    const deadA = findDead([tmpFile])
    if (deadA.length !== 1) bad(`坏样本 A 未被检出（死文案应命中 1 处，实际 ${deadA.length}）`)
    // 坏样本 B：同一句但给了可点入口 ⇒ 必须不再算死文案（防"一律报红"的假检查）
    fs.writeFileSync(tmpFile, `<template>\n  <div>\n    <p>请到「商品档案」<GoLink to="/archive/products">补齐进货价</GoLink>。</p>\n  </div>\n</template>\n`, 'utf8')
    const deadB = findDead([tmpFile])
    if (deadB.length !== 0) bad(`坏样本 B 误报（有 GoLink 却仍判死文案 ${deadB.length} 处）`)
    if (deadA.length === 1 && deadB.length === 0) ok('坏样本自证：死文案必检出 / 有入口不误报')
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  }
}

/* ── 断言 6：豁免名单不许过期（修掉了就删条目）───────────────────── */
{
  const stale = exemptHits.filter((e) => e.hit === 0)
  if (stale.length) {
    for (const s of stale) bad(`豁免过期：${s.file} 里已找不到「${s.needle}」—— 该处已不是死文案，请删掉这条豁免`)
  } else {
    ok(`tooltip 豁免 ${EXEMPTS.length} 条仍然必要（命中 ${exemptHits.map((e) => e.hit).join('/')} 处）`)
  }
}

console.log('')
for (const n of notes) console.log('  ' + n)
if (failures.length) {
  console.log('')
  for (const f of failures) console.log('  ❌ ' + f)
}
console.log('')
console.log(failures.length === 0 ? 'ALL PASS' : `FAILED (${failures.length})`)
process.exit(failures.length === 0 ? 0 : 1)
