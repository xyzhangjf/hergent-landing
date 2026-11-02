/**
 * sidebar-contrast-probe.mjs —— 量侧栏文字的实际渲染色与对比度（只读）
 *
 * 为什么要单独一个探针（v735）：
 *   用户报「浅色侧栏不够黑、深色不够白」。对比度探针查的是**令牌是否过 AA**，
 *   而这条反馈的根因不是"过不过线"，是**层级**：侧栏条目用的是 `--t2`（次要文字），
 *   与同屏正文 `--t1` 差一个层级。对比度探针会说"5.37:1 合格"，但它回答不了
 *   "为什么侧栏看起来像禁用态"。
 *   ⇒ 本探针必须同时打印「侧栏色 / 正文色」两个值，差值才是判据。
 *
 * 用法：
 *   HG_TOKEN=xxx node .workbuddy/tools/sidebar-contrast-probe.mjs
 */
import { launch, CHROME_DEFAULT } from './lib/cdp-lite.mjs'

const TOKEN = process.env.HG_TOKEN
if (!TOKEN) { console.error('缺 HG_TOKEN'); process.exit(1) }

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

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
    m = s.match(/^#([0-9a-f]{6})$/i)
    if (m) { const n = parseInt(m[1], 16); return { r: n >> 16 & 255, g: n >> 8 & 255, b: n & 255, a: 1 } }
    return null
  }
  const over = (top, bot) => {
    const a = top.a
    return { r: top.r * a + bot.r * (1 - a), g: top.g * a + bot.g * (1 - a), b: top.b * a + bot.b * (1 - a), a: 1 }
  }
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
  const hex = (c) => '#' + [c.r, c.g, c.b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')

  /* 从元素往上逐层合成背景（含半透明 glass-bg 与 body 底色） */
  function bgOf(el) {
    const stack = []
    let n = el
    while (n && n !== document.documentElement) {
      const bc = parse(getComputedStyle(n).backgroundColor)
      if (bc && bc.a > 0) stack.push(bc)
      n = n.parentElement
    }
    stack.push(parse(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 })
    stack.push(parse(getComputedStyle(document.documentElement).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 })
    let out = stack[stack.length - 1]
    for (let i = stack.length - 2; i >= 0; i--) out = over(stack[i], out)
    return out
  }

  function read(el, label) {
    if (!el) return { label, missing: true }
    const cs = getComputedStyle(el)
    const fg = parse(cs.color) || { r: 0, g: 0, b: 0, a: 1 }
    const bg = bgOf(el)
    const fgSolid = fg.a < 1 ? over(fg, bg) : fg
    return {
      label,
      text: (el.innerText || '').trim().slice(0, 10),
      colorDecl: cs.color,
      fgHex: hex(fgSolid),
      bgHex: hex(bg),
      ratio: +ratio(fgSolid, bg).toFixed(2),
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      cls: el.className && el.className.toString ? el.className.toString().slice(0, 40) : '',
    }
  }

  const root = document.documentElement
  const cs = getComputedStyle(root)
  const items = Array.from(document.querySelectorAll('.sb-item'))
  const active = document.querySelector('.sb-item.router-link-active, .sb-item.cur')
  const plain = items.find(e => !e.classList.contains('router-link-active') && !e.classList.contains('cur'))

  const out = {
    theme: root.classList.contains('dark') ? 'dark' : 'light',
    tokens: {
      t1: cs.getPropertyValue('--t1').trim(),
      t2: cs.getPropertyValue('--t2').trim(),
      t3: cs.getPropertyValue('--t3').trim(),
      bg: cs.getPropertyValue('--bg').trim(),
      glassBg: cs.getPropertyValue('--glass-bg').trim(),
    },
    sidebarBgHex: hex(bgOf(document.querySelector('.sidebar') || document.body)),
    rows: [
      read(plain, '侧栏·未选中项 .sb-item'),
      read(active, '侧栏·当前项 .sb-item.active'),
      read(document.querySelector('.sb-pop-item'), '侧栏弹窗项 .sb-pop-item'),
      read(document.querySelector('.sb-pop-hd'), '侧栏弹窗列标题 .sb-pop-hd'),
      read(document.querySelector('.sb-beian'), '侧栏备案号 .sb-beian'),
      read(document.querySelector('.tb-user-name') || document.querySelector('.tb-user'), '顶栏用户名（参照）'),
      read(document.querySelector('.page-hd h1, h1'), '页面标题 h1（参照）'),
      read(document.querySelector('.card .la, .card td, #app main p, #app main td'), '主区正文（参照）'),
    ].filter(Boolean),
    itemCount: items.length,
  }
  return JSON.stringify(out)
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

const results = []
for (const theme of ['light', 'dark']) {
  /* 🔴 必须先落一站再写 localStorage，写完必须经 about:blank 中转 —— 只改 hash 不会重渲染 */
  await page.goto('https://hergent.cn/#/workbench', 2600)
  await page.eval(`localStorage.setItem('hergent_theme', ${JSON.stringify(theme)}); 1`)
  await page.goto('about:blank', 150)
  await page.goto('https://hergent.cn/#/workbench', 3400)
  const raw = await page.eval(MEASURE)
  results.push(JSON.parse(raw))
}

/* sanity：登录态与节点数 —— 用户名变「我」就是 token 失效，量出来的色不可信 */
const sanity = await page.eval(MEASURE)
const s = JSON.parse(sanity)
const uname = (s.rows.find(r => r.label.includes('用户名')) || {}).text || ''
console.log(JSON.stringify({ results, sanity: { theme: s.theme, items: s.itemCount, userName: uname } }, null, 2))

await browser.close()
