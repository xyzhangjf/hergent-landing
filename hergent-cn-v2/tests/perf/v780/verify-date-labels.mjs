/* v780 真实渲染验证：小程序「我的预报提交」记录行两处文案改短后，布局是否真的没变。
 *
 * 用户口径：「报单日期」文字前面加上「报单」；「到货日期」改为「到货」；
 *   保持页面原有布局与样式不变，仅改对应标签文案。
 *
 * 这个改动看着是纯文字，但有两个会静默变形的点，必须实测：
 *   ① 中文标签进 flex 行后可断行 ⇒ 「报单」与日期折成两行（v770 同族）；
 *   ② 日期段加了 nowrap 就不可压缩 ⇒ 门店名被挤到换行（布局变了，用户明说不许）。
 *
 * 用真实 mine.wxss 规则 + 真实 mine.wxml 模板拼等价 HTML（1rpx = 0.5px，375 屏），
 * 三组对照：
 *   OLD  v771 原状态（裸日期 + 「到货日期」）
 *   NEW  当前源码（报单 + 到货，含 .rec-order nowrap）
 *   RISK 文案同 NEW 但拿掉 nowrap —— 用来证明这条 CSS 不是摆设
 *
 * 跑法：cd hergent-cn-v2 && node tests/perf/v780/verify-date-labels.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const MINI = path.join(ROOT, 'forecast-order-miniprogram-20260812T023419087Z/miniprogram')
const wxssRaw = fs.readFileSync(path.join(MINI, 'pages/mine/mine.wxss'), 'utf8')
const wxmlRaw = fs.readFileSync(path.join(MINI, 'pages/mine/mine.wxml'), 'utf8')

const clean = wxssRaw.replace(/\/\*[\s\S]*?\*\//g, '')
const pick = (sel) => {
  const m = clean.match(new RegExp('\\' + sel + '\\s*\\{[^}]*\\}'))
  if (!m) throw new Error('源码里找不到规则 ' + sel)
  return m[0].replace(/(\d+(?:\.\d+)?)rpx/g, (_, n) => Number(n) / 2 + 'px')
}

/* 记录行只用到这几条规则；全部从源码取，不手抄 */
const ROW_SELECTORS = ['.rec', '.rec-hd', '.rec-store', '.rec-date', '.rec-dates',
  '.rec-arrival', '.rec-order', '.rec-status', '.status-pending', '.status-recalled']

const cssFor = (v) => {
  const list = ROW_SELECTORS.filter((s) => v.withOrder || s !== '.rec-order')
  let css = list.map(pick).join('\n')
  if (v.wrap) css = css.replace(/\.rec-dates\{[^}]*\}/, (m) => m.replace('}', ';flex-wrap:wrap}'))
  return css
}

/* 记录头部模板从真实 wxml 抽，避免「验证的不是源码」。
   🔴 转换必须整段把 <view>/<text> 换成 div/span：上一版只换了开头两个标签、
      收尾用正则猜，结果 .rec-status 被圈进 .rec-dates，量出「3 个日期段、行数 3」
      的假失败（实际是状态胶囊被挤成逐字竖排）。 */
const hdTpl = (() => {
  const m = wxmlRaw.match(/<view class="rec-hd"[\s\S]*?<text class="rec-status[^>]*>\{\{item\.statusText\}\}<\/text>\s*<\/view>/)
  if (!m) throw new Error('源码里找不到 .rec-hd 记录头')
  return m[0]
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<view\b/g, '<div').replace(/<\/view>/g, '</div>')
    .replace(/<text\b/g, '<span').replace(/<\/text>/g, '</span>')
    .replace(/<span class="rec-date[^"]*">[^<]*<\/span>/,
      '<span class="rec-date__OCLASS__">__OTEXT__</span>')
    .replace(/<span class="rec-date rec-arrival"[^>]*>[^<]*<\/span>/,
      '<span class="rec-date rec-arrival">__ATEXT__</span>')
    .replace(/\{\{item\.store_name\}\}/g, '{{STORE}}')
    .replace(/\{\{item\.statusText\}\}/g, '{{STATUS}}')
    .replace(/class="rec-status status-\{\{item\.status\}\}"/g, 'class="rec-status {{STCLASS}}"')
})()

/* 四种文案形态 */
const VARIANTS = {
  OLD: { oclass: '', otext: '{{ORDER}}', atext: '到货日期 {{ARR}}', withOrder: false, wrap: false },
  NEW: { oclass: ' rec-order', otext: '报单 {{ORDER}}', atext: '到货 {{ARR}}', withOrder: true, wrap: false },
  RISK: { oclass: ' rec-order', otext: '报单 {{ORDER}}', atext: '到货 {{ARR}}', withOrder: false, wrap: false },
  /* FIX：文案同 NEW，另给日期组一条 wrap 兜底 —— 门店名很长、宽度不够时
     让「到货」整段掉到第二行，而不是被推出卡片右边缘（溢出=看不到内容）。 */
  FIX: { oclass: ' rec-order', otext: '报单 {{ORDER}}', atext: '到货 {{ARR}}', withOrder: true, wrap: true },
}

const CASES = [
  // 生产真实：门店名最长 4 字（tenant_1 264 条记录实测）
  ['生产真实（门店 4 字，已提交）', '美联檀溪', '已提交', 'status-pending'],
  ['生产真实（门店 4 字，已撤回）', '美联保康', '已撤回', 'status-recalled'],
  // 压力：其它租户/未来更长的门店名
  ['压力（门店 10 字）', '蒙牛低温生活超市旗舰店', '已提交', 'status-pending'],
  ['压力（门店 14 字）', '南昌市青山湖区低温奶专营店', '已撤回', 'status-recalled'],
]
const WIDTHS = [320, 360, 375, 414]

const BASE = `
:root{--brand:#007aff}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{font-family:-apple-system,"PingFang SC","Helvetica Neue",sans-serif;background:#f5f5f7}
.page{width:var(--w)}
.list{padding:0 16px}   /* .list 的 32rpx = 16px */
`

const page = (v) => hdTpl
  .replace('__OCLASS__', v.oclass)
  .replace('__OTEXT__', v.otext)
  .replace('__ATEXT__', v.atext)

const browser = await chromium.launch({ channel: 'chrome' })
const results = []

for (const [label, store, status, stclass] of CASES) {
  for (const w of WIDTHS) {
    const row = {}
    for (const [vname, v] of Object.entries(VARIANTS)) {
      const p = await browser.newPage({ viewport: { width: w, height: 400 } })
      await p.setContent(`<!doctype html><meta charset="utf-8"><style>${BASE}${cssFor(v)}</style>
        <div class="page" style="--w:${w}px"><div class="list">${page(v)
          .replace('{{STORE}}', store).replace('{{STATUS}}', status).replace('{{STCLASS}}', stclass)
          .replace('{{ORDER}}', '2026-11-05').replace('{{ARR}}', '2026-11-10')}</div></div>`)
      const m = await p.evaluate(() => {
        const hd = document.querySelector('.rec-hd')
        const dates = document.querySelector('.rec-dates')
        const storeEl = document.querySelector('.rec-store')
        const lines = (el) => {
          const r = document.createRange()
          r.selectNodeContents(el)
          const tops = [...r.getClientRects()].map((x) => Math.round(x.top))
          return new Set(tops).size
        }
        const datesEls = [...dates.querySelectorAll('span')]
        return {
          hdOverflow: hd.scrollWidth - hd.clientWidth,
          datesW: Math.round(dates.getBoundingClientRect().width * 10) / 10,
          storeLines: lines(storeEl),
          dateLines: datesEls.map(lines),
          dateTops: datesEls.map((e) => Math.round(e.getBoundingClientRect().top)),
          hdH: Math.round(hd.getBoundingClientRect().height),
        }
      })
      row[vname] = m
      await p.close()
    }
    results.push({ label, w, ...row })
  }
}
await browser.close()

let bad = 0
const ok = (c, msg) => { console.log((c ? '  \u2705 ' : '  \u274c ') + msg); if (!c) bad++ }

console.log('=== 1 文案换了但宽度几乎不动（换字不换宽：到货侧减 2 汉字、报单侧加 2 汉字）===')
for (const r of results) {
  const d = r.NEW.datesW - r.OLD.datesW
  ok(Math.abs(d) <= 4, `${r.label} @${r.w}px 日期组宽度 OLD ${r.OLD.datesW}px → NEW ${r.NEW.datesW}px（Δ ${d.toFixed(1)}px）`)
}

console.log('\n=== 2 每个日期段都是单行（不许「报单」与日期折开）===')
for (const r of results) {
  ok(r.NEW.dateLines.every((n) => n === 1), `${r.label} @${r.w}px 日期段行数 = [${r.NEW.dateLines.join(',')}]`)
}

console.log('\n=== 3 两个日期在同一水平线上（一高一矮 = 排版坏了）===')
for (const r of results) {
  ok(r.NEW.dateTops[0] === r.NEW.dateTops[1], `${r.label} @${r.w}px 两个日期 top = ${r.NEW.dateTops.join(' / ')}`)
}

/* 生产真实门店名最长 4 字（tenant_1 264 条记录实测）⇒ 这四组必须与改前逐项一致。
   10/14 字是我人为加长的压力样本，只要求「不比改前更差」，不给绝对阈值。 */
const real = results.filter((r) => r.label.includes('生产真实'))
const stress = results.filter((r) => r.label.includes('压力'))

console.log('\n=== 4 生产真实场景：布局与改前逐项一致（用户要求「布局与样式不变」）===')
for (const r of real) {
  ok(r.NEW.hdH === r.OLD.hdH, `${r.label} @${r.w}px 记录头高度 OLD ${r.OLD.hdH} = NEW ${r.NEW.hdH}px`)
  ok(r.NEW.storeLines === r.OLD.storeLines,
    `${r.label} @${r.w}px 门店名行数 OLD ${r.OLD.storeLines} = NEW ${r.NEW.storeLines}`)
  ok(r.NEW.hdOverflow <= 0 && r.OLD.hdOverflow <= 0,
    `${r.label} @${r.w}px 无横向溢出（OLD ${r.OLD.hdOverflow}px / NEW ${r.NEW.hdOverflow}px）`)
  /* 兜底规则（flex-wrap）在生产真实尺寸下必须**完全不生效**：
     生效了就意味着多了一行，那是布局变化，不能偷偷发生。 */
  ok(r.FIX.hdH === r.NEW.hdH && r.FIX.storeLines === r.NEW.storeLines && r.FIX.datesW === r.NEW.datesW,
    `${r.label} @${r.w}px wrap 兜底未触发（高度/行数/宽度与 NEW 一致）`)
}

console.log('\n=== 5 压力样本（门店 10/14 字）：加了 nowrap 不许把日期挤出卡片 ===')
for (const r of stress) {
  const dOv = r.NEW.hdOverflow - r.OLD.hdOverflow
  ok(r.FIX.hdOverflow <= 0,
    `${r.label} @${r.w}px wrap 兜底后无溢出（无兜底时 NEW ${r.NEW.hdOverflow}px / 改前 OLD ${r.OLD.hdOverflow}px，Δ ${dOv}）`)
}

console.log('\n=== 6 反证：拿掉 .rec-order 的 nowrap 就会折行 ⇒ 这条 CSS 不是摆设 ===')
const risky = results.filter((r) => r.RISK.dateLines.some((n) => n > 1) || r.RISK.dateTops[0] !== r.RISK.dateTops[1])
ok(risky.length > 0, `有 ${risky.length} 组在无 nowrap 时折行/错位（例：${risky[0] ? risky[0].label + ' @' + risky[0].w + 'px 行数[' + risky[0].RISK.dateLines.join(',') + ']' : '—'}）`)

console.log('\n' + (bad === 0 ? 'RESULT: ALL PASS' : `RESULT: FAILED (${bad})`))
process.exit(bad === 0 ? 0 : 1)
