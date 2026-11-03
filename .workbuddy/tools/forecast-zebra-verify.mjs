/**
 * forecast-zebra-verify.mjs —— v738 验收：斑马 / hover / 图表证据（只读，不改任何数据）
 *
 * 判据（都不是"看规则"，而是量**实际渲染色**）：
 *   ① zebra 行：前三格（序号/商品名称/到货周期）与第四格起必须**同色**
 *   ② 普通行：全部同色（= --bg）
 *   ③ hover 普通行：全部同色（= --bg3）—— 修斑马纹之前，前三列连 hover 也是死的
 * 用法：HG_TOKEN=xxx node .workbuddy/tools/forecast-zebra-verify.mjs
 */
import { launch, CHROME_DEFAULT } from './lib/cdp-lite.mjs'
import fs from 'node:fs'

const TOKEN = process.env.HG_TOKEN
if (!TOKEN) { console.error('缺 HG_TOKEN'); process.exit(1) }
const OUT = process.env.HG_OUT || '/tmp/v738'
fs.mkdirSync(OUT, { recursive: true })

const MEASURE = String.raw`
(function () {
  const parse = (s) => {
    s = (s || '').trim()
    if (!s || s === 'transparent' || s === 'rgba(0, 0, 0, 0)') return null
    let m = s.match(/^rgba?\(([^)]+)\)$/)
    if (m) { const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number); return { r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1 } }
    return null
  }
  const over = (t,b) => ({r:t.r*t.a+b.r*(1-t.a), g:t.g*t.a+b.g*(1-t.a), b:t.b*t.a+b.b*(1-t.a), a:1})
  const hex = (c) => '#' + [c.r,c.g,c.b].map(v=>Math.round(v).toString(16).padStart(2,'0')).join('')
  function bgOf(el) {
    const st = []; let n = el
    while (n && n !== document.documentElement) {
      const bc = parse(getComputedStyle(n).backgroundColor)
      if (bc && bc.a > 0) st.push(bc)
      n = n.parentElement
    }
    let out = {r:255,g:255,b:255,a:1}
    for (let i = st.length-1; i >= 0; i--) out = over(st[i], out)
    return out
  }
  window.__hgRowHexes = (tr) => Array.from(tr.children).map(td => hex(bgOf(td)))
  window.__hgTbl = document.querySelector('.cross-tbl')
  const rows = Array.from(window.__hgTbl.querySelectorAll('tbody tr.data-row'))
  window.__hgZebra = rows.find(r => r.classList.contains('zebra'))
  window.__hgPlain = rows.find(r => !r.classList.contains('zebra'))
  const pick = (tr) => tr ? { hexes: window.__hgRowHexes(tr), trBg: hex(bgOf(tr)) } : null
  const cs = getComputedStyle(document.documentElement)
  return JSON.stringify({
    theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
    build: window.__HG_BUILD__,
    tokens: { bg: cs.getPropertyValue('--bg').trim(), bg2: cs.getPropertyValue('--bg2').trim(), bg3: cs.getPropertyValue('--bg3').trim() },
    zebra: pick(window.__hgZebra),
    plain: pick(window.__hgPlain),
    plainRect: window.__hgPlain ? (() => { const b = window.__hgPlain.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height } })() : null,
    tblRect: (() => { const b = window.__hgTbl.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height } })(),
  })
})()
`

const uniq = (a) => Array.from(new Set(a))

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

const report = {}
for (const theme of ['light', 'dark']) {
  await page.goto('https://hergent.cn/#/forecast', 2600)
  await page.eval(`localStorage.setItem('hergent_theme', ${JSON.stringify(theme)}); 1`)
  await page.goto('about:blank', 150)
  await page.goto('https://hergent.cn/#/forecast', 4200)

  const base = JSON.parse(await page.eval(MEASURE))

  /* hover：把鼠标移到「普通行」中段某个非冻结格上，量整行 */
  await page.raw.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: Math.round(base.plainRect.x + base.tblRect.w * 0.55),
    y: Math.round(base.plainRect.y + base.plainRect.h / 2),
    buttons: 0,
  })
  await new Promise(r => setTimeout(r, 500))
  const hovered = JSON.parse(await page.eval(`
    (function(){ const tr = window.__hgPlain
      return JSON.stringify({ hexes: window.__hgRowHexes(tr), trBg: (function(){return ''})() }) })()`))

  /* 截图：只截表格可视区（含冻结列 + 右侧） */
  const clip = { x: Math.round(base.tblRect.x), y: Math.round(base.tblRect.y), width: Math.min(1300, Math.round(base.tblRect.w)), height: Math.min(420, Math.round(base.tblRect.h)), scale: 2 }
  await page.screenshot(`${OUT}/forecast-${theme}.png`, { clip })

  report[theme] = {
    build: base.build,
    tokens: base.tokens,
    zebraHexes: uniq(base.zebra.hexes),
    zebraTrBg: base.zebra.trBg,
    plainHexes: uniq(base.plain.hexes),
    hoverHexes: uniq(hovered.hexes),
    zebraCellCount: base.zebra.hexes.length,
  }
}

console.log(JSON.stringify(report, null, 2))
await browser.close()
