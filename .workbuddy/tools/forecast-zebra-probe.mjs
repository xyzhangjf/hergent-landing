/**
 * forecast-zebra-probe.mjs —— 量预报订单汇总表「前 3 列 vs 后面列」的**实际渲染色**（只读）
 *
 * 用户报：「序号 / 商品名称 / 到货周期 三列的行底色不跟着斑马纹走」。
 * 判据不是"看哪条规则写了什么"，而是**同一行里不同 td 的 computed backgroundColor 是否一致**。
 * 所以本探针逐格打印 computed 值 + 逐层合成后的实色，一个 zebra 行 + 一个非 zebra 行对照。
 *
 * 用法：
 *   HG_TOKEN=xxx node .workbuddy/tools/forecast-zebra-probe.mjs
 */
import { launch, CHROME_DEFAULT } from './lib/cdp-lite.mjs'

const TOKEN = process.env.HG_TOKEN
if (!TOKEN) { console.error('缺 HG_TOKEN'); process.exit(1) }

const MEASURE = String.raw`
(function () {
  const parse = (s) => {
    s = (s || '').trim()
    if (!s || s === 'transparent' || s === 'rgba(0, 0, 0, 0)') return null
    let m = s.match(/^rgba?\(([^)]+)\)$/)
    if (m) {
      const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number)
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }
    }
    return null
  }
  const over = (t, b) => ({ r: t.r*t.a + b.r*(1-t.a), g: t.g*t.a + b.g*(1-t.a), b: t.b*t.a + b.b*(1-t.a), a: 1 })
  const hex = (c) => '#' + [c.r, c.g, c.b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')
  function bgOf(el) {
    const st = []
    let n = el
    while (n && n !== document.documentElement) {
      const bc = parse(getComputedStyle(n).backgroundColor)
      if (bc && bc.a > 0) st.push(bc)
      n = n.parentElement
    }
    let out = { r: 255, g: 255, b: 255, a: 1 }
    for (let i = st.length - 1; i >= 0; i--) out = over(st[i], out)
    return out
  }
  const tbl = document.querySelector('.cross-tbl')
  if (!tbl) return JSON.stringify({ error: 'no .cross-tbl', url: location.hash })
  const rows = Array.from(tbl.querySelectorAll('tbody tr.data-row'))
  const pick = (wantZebra) => rows.find(r => r.classList.contains('zebra') === wantZebra)
  const zr = pick(true), nr = pick(false)
  const readRow = (tr, tag) => {
    if (!tr) return { tag, missing: true }
    const tds = Array.from(tr.children)
    return {
      tag,
      trClass: tr.className,
      trBgDecl: getComputedStyle(tr).backgroundColor,
      trBgHex: hex(bgOf(tr)),
      cells: tds.slice(0, 8).map((td, i) => ({
        i,
        cls: (td.className || '').toString().replace('td ', '').slice(0, 46),
        decl: getComputedStyle(td).backgroundColor,
        hex: hex(bgOf(td)),
        text: (td.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 12),
      })),
      cellCount: tds.length,
    }
  }
  const cs = getComputedStyle(document.documentElement)
  return JSON.stringify({
    hash: location.hash,
    theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
    tokens: {
      bg: cs.getPropertyValue('--bg').trim(),
      bg2: cs.getPropertyValue('--bg2').trim(),
      bg3: cs.getPropertyValue('--bg3').trim(),
      pbg: cs.getPropertyValue('--p-bg').trim(),
    },
    dataRows: rows.length,
    zebra: readRow(zr, 'zebra'),
    plain: readRow(nr, 'plain'),
  })
})()
`

const browser = await launch({ headless: true, chromePath: CHROME_DEFAULT })
const page = await browser.newPage()
await page.enable()
for (const c of [
  { name: 'erp_token', value: TOKEN, httpOnly: true },
  { name: 'hergent_auth', value: '1' },
  { name: 'csrf_token', value: 'x' },
  { name: 'hergent_tenant', value: '1' },
]) await page.raw.send('Network.setCookie', { ...c, domain: 'hergent.cn', path: '/', secure: true, sameSite: 'Lax' })

await page.raw.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })

const out = {}
for (const theme of ['light', 'dark']) {
  await page.goto('https://hergent.cn/#/forecast', 2600)
  await page.eval(`localStorage.setItem('hergent_theme', ${JSON.stringify(theme)}); 1`)
  await page.goto('about:blank', 150)
  await page.goto('https://hergent.cn/#/forecast', 4200)
  out[theme] = JSON.parse(await page.eval(MEASURE))
}
console.log(JSON.stringify(out, null, 2))
await browser.close()
