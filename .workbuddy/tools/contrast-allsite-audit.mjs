/**
 * contrast-allsite-audit.mjs —— 全站文字对比度扫描（只读，不改线上）
 *
 * 为什么需要它（v735 排查）：
 *   用户报「侧栏浅色不够黑、深色不够白」，根因是 `.sb-item` 把**一级导航**当成
 *   「次要文字」用了 `--t2`。这不是孤例风险 —— 全站 1472 处 `--t2/--t3` 引用，
 *   靠肉眼翻不可能查干净。判据必须落到机器上。
 *
 * 判据（按可点性分档，不按数值一刀切）：
 *   · 可点控件（a/button/[role=button]/select/label/可点行）是「用户要去点它」的东西，
 *     对比度低 = 入口显得像禁用态 ⇒ 门槛提到 AAA 7:1
 *   · 纯文本（说明/表头/单位）只需要「读得到」⇒ AA 4.5:1
 *   ⇒ 所以 P0/P1 只对可点控件报，P2 才报纯文本。
 *
 * 三个容易漏的坑（都在本脚本里处理）：
 *   1. **累积 opacity**：`.sb-beian{opacity:.55}` 让 5.25:1 实际变成 2.9:1。
 *      只读 `color` 会算成合格 —— 必须把整条祖先链的 opacity 乘起来。
 *   2. **alpha 合成**：`--glass-bg:rgba(255,255,255,.72)` 叠白底 ≠ 白；
 *      前景 color 也可能带 alpha。
 *   3. **背景不可判**：祖先有 background-image/gradient 时 backgroundColor 是
 *      transparent，量出来的底色是错的 ⇒ 标 `bgUncertain` 单独看，不混进统计。
 *
 * 用法：
 *   HG_TOKEN=xxx node .workbuddy/tools/contrast-allsite-audit.mjs
 *   HG_TOKEN=xxx node .workbuddy/tools/contrast-allsite-audit.mjs --pages workbench,settings
 *   HG_TOKEN=xxx node .workbuddy/tools/contrast-allsite-audit.mjs --themes light
 *   产物：.workbuddy/contrast-audit/result.json
 */
import fs from 'node:fs'
import path from 'node:path'
import { launch, CHROME_DEFAULT } from './lib/cdp-lite.mjs'

const ROOT = path.resolve(import.meta.dirname, '../..')
const OUT = path.join(ROOT, '.workbuddy/contrast-audit')
const TOKEN = process.env.HG_TOKEN || ''
if (!TOKEN) { console.error('缺 HG_TOKEN'); process.exit(1) }

const argv = process.argv.slice(2)
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d }
const THEMES = arg('themes', 'light,dark').split(',').map(s => s.trim()).filter(Boolean)
const ONLY = arg('pages', '') ? arg('pages', '').split(',').map(s => s.trim()) : null

const PAGES = [
  ['工作台', 'workbench', '/workbench'],
  ['看板', 'dashboard', '/dashboard'],
  ['采购单列表', 'inv-purchase', '/inventory/purchase'],
  ['销售单列表', 'inv-sale', '/inventory/sale'],
  ['商品档案', 'arch-products', '/archive/products'],
  ['毛利分析', 'rp-gross-profit', '/reports/gross-profit'],
  ['库存周转', 'rp-turnover', '/reports/inventory-turnover'],
  ['目标与返利', 'rebate', '/rebate'],
  ['资金流水', 'funds-flow', '/funds/flow'],
  ['往来对账', 'funds-party', '/funds/party-reconcile'],
  ['采购建单', 'inv-purchase-new', '/inventory/purchase/new'],
  ['设置', 'settings', '/settings'],
]
const PICK = ONLY ? PAGES.filter(p => ONLY.includes(p[1]) || ONLY.includes(p[2])) : PAGES
if (!PICK.length) { console.error('--pages 没匹配到'); process.exit(1) }

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const SCAN = String.raw`
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
  const over = (t, b) => ({ r: t.r * t.a + b.r * (1 - t.a), g: t.g * t.a + b.g * (1 - t.a), b: t.b * t.a + b.b * (1 - t.a), a: 1 })
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
  const hex = (c) => '#' + [c.r, c.g, c.b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')

  /* 🔴 性能：getComputedStyle 是这个脚本唯一的瓶颈（首版 24 页把浏览器跑 OOM）。
     两个记忆化：① 每个元素只取一次 cs；② effOpacity / bgOf 从父级结果递推，不再逐层重爬。 */
  const csCache = new Map(), opCache = new Map(), bgCache = new Map()
  const csOf = (el) => { let v = csCache.get(el); if (!v) { v = getComputedStyle(el); csCache.set(el, v) } return v }

  /* 累积 opacity = 父级累积 × 自身 */
  function effOpacity(el) {
    if (!el || el.nodeType !== 1) return 1
    let v = opCache.get(el)
    if (v !== undefined) return v
    const self = parseFloat(csOf(el).opacity)
    v = (isNaN(self) ? 1 : self) * effOpacity(el.parentElement)
    opCache.set(el, v)
    return v
  }

  /* 背景 = 父级已合成色，再把自身 backgroundColor 叠上去。
     🔴 uncertain 的判据（首版写错过一次，把整个侧栏滤掉了）：
        "祖先链上有任何背景图就算不确定" 是错的 —— body 上挂一张全站装饰底纹，
        全站每个节点都会被标记成不可判 ⇒ 真问题全被静默丢掉。
        正确判据：**从元素往上，遇到第一个不透明实底（alpha≥.99）就停**，
        只有在到达实底之前撞见 background-image，才叫"底色不可判"。
        body/html 自身不做计入（那是全站底，不是这条文字的背景）。 */
  function bgOf(el) {
    if (!el || el.nodeType !== 1) return { bg: { r: 255, g: 255, b: 255, a: 1 }, uncertain: false, solid: true }
    const hit = bgCache.get(el)
    if (hit) return hit
    const parent = bgOf(el.parentElement)
    const cs = csOf(el)
    const isRoot = el === document.body || el === document.documentElement
    const selfImage = !isRoot && cs.backgroundImage && cs.backgroundImage !== 'none'
    const bc = parse(cs.backgroundColor)
    const opaque = !!(bc && bc.a >= 0.99)
    const bg = bc && bc.a > 0 ? over(bc, parent.bg) : parent.bg
    let out
    /* 🔴 三条分支的顺序不能换：
       ① 自身不透明 ⇒ 祖先链上的一切都被遮住，uncertain 只看自己这一层；
       ② 自身半透明但父级已是实底 ⇒ 只叠自己，不累积祖先标记；
       ③ 一路半透明到顶 ⇒ 才把祖先的 image 标记接过来。
       首版把 ①②③ 写成 if/else 两条，且 ② 缺了"重置 uncertain"⇒ 一个透明父级
       就让整棵子树永久 uncertain（实测 43/44 行被误标，等于静默丢掉全部结果）。 */
    if (opaque) out = { bg, uncertain: !!selfImage, solid: true }
    else if (parent.solid) out = { bg, uncertain: !!selfImage, solid: false }
    else out = { bg, uncertain: parent.uncertain || !!selfImage, solid: false }
    bgCache.set(el, out)
    return out
  }
  bgCache.set(document.documentElement, {
    bg: parse(getComputedStyle(document.documentElement).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 },
    uncertain: false, solid: true,
  })

  const cssPath = (el) => {
    const parts = []
    let n = el, d = 0
    while (n && n.nodeType === 1 && d < 4) {
      let s = n.tagName.toLowerCase()
      const cls = (n.className && n.className.toString ? n.className.toString() : '').trim().split(/\s+/).filter(c => c && !c.startsWith('data-v')).slice(0, 2)
      if (cls.length) s += '.' + cls.join('.')
      parts.unshift(s); n = n.parentElement; d++
      if (n && n.id) { parts.unshift('#' + n.id); break }
    }
    return parts.join('>')
  }

  /* 可点判据：a / button / select / role=button / label / 带 tabindex 的行 */
  const CLICKABLE = 'a,button,select,textarea,input,[role="button"],[role="tab"],[role="menuitem"],[role="option"],label,summary'
  const ZONES = [['sidebar', '.sidebar,.sb-nav,.sb-pop'], ['topbar', '.topbar,.tb'], ['tabs', '.tabs,.tabbar,.stabs'], ['mobile-nav', '.mnav'], ['table', 'table,.psi-list'], ['card', '.card'], ['modal', '.modal,.dlg']]

  const hasOwnText = (el) => Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim().length > 0)
  const visible = (el) => {
    if (!el.getClientRects().length) return false
    /* 🔴 只认 cs 缓存里已有的？不行 —— 这里必须真读。但 csOf 会缓存，总调用量 = 元素数，可接受。 */
    const cs = csOf(el)
    if (cs.visibility === 'hidden' || cs.display === 'none') return false
    return true
  }

  /* 🔴 页面内先聚合再回传：同一条规则渲染 50 行商品是 50 个节点，
     但它是**一个问题**。不聚合会把 CDP 消息撑到几十 MB（首版就是这么崩的）。 */
  const groups = new Map()
  let scanned = 0, kept = 0
  for (const el of document.querySelectorAll('body *')) {
    scanned++
    if (!hasOwnText(el)) continue
    if (!visible(el)) continue
    if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'NOSCRIPT') continue
    const cs = csOf(el)
    const txt = (el.innerText || '').trim()
    if (!txt) continue
    const op = effOpacity(el)
    if (op < 0.05) continue
    const { bg, uncertain } = bgOf(el)
    let fg = parse(cs.color)
    if (!fg) continue
    fg = { ...fg, a: fg.a * op }
    const fgSolid = fg.a < 1 ? over(fg, bg) : fg
    const r = +ratio(fgSolid, bg).toFixed(2)
    /* 只要可疑的：10:1 以上不必看（AAA 7 已过一大截，再多就是纯黑/纯白）。
       阈值取 10 不取 7 —— 深色侧栏 7.83 也要在清单里才看得见，它是"及格但偏灰"的典型。 */
    if (r >= 10) continue
    kept++
    const clickable = !!el.closest(CLICKABLE)
    let zone = 'other'
    for (const [name, sel] of ZONES) { if (el.closest(sel)) { zone = name; break } }
    const key = [cssPath(el), hex(fgSolid), hex(bg), Math.round(parseFloat(cs.fontSize)), cs.fontWeight, clickable ? 1 : 0, zone, uncertain ? 1 : 0].join('|')
    const g = groups.get(key)
    if (g) { g.n++; if (g.t.length < 18) g.t = txt.slice(0, 18) }
    else groups.set(key, {
      p: cssPath(el), t: txt.slice(0, 18), r,
      fs: Math.round(parseFloat(cs.fontSize)), fw: cs.fontWeight,
      op: +op.toFixed(2), fg: hex(fgSolid), bg: hex(bg),
      ck: clickable ? 1 : 0, z: zone, u: uncertain ? 1 : 0, n: 1,
    })
  }
  return JSON.stringify({ rows: Array.from(groups.values()), total: scanned, kept })
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

fs.mkdirSync(OUT, { recursive: true })
const all = []

for (const theme of THEMES) {
  await page.goto('https://hergent.cn/#/workbench', 2600)
  await page.eval(`localStorage.setItem('hergent_theme', ${JSON.stringify(theme)}); 1`)
  for (const [label, slug, route] of PICK) {
    await page.goto('about:blank', 150)
    await page.goto('https://hergent.cn/#' + route, 3200)
    const raw = await page.eval(SCAN)
    const data = JSON.parse(raw)
    /* sanity：登录态必须还在，否则量的是登录页 */
    const who = await page.eval(`(() => { const e = document.querySelector('.tb-user-name,.tb-user'); return e ? (e.innerText||'').trim().slice(0,8) : '' })()`)
    all.push({ theme, label, slug, route, userName: who, total: data.total, kept: data.kept, rows: data.rows })
    process.stdout.write(`  ${theme.padEnd(5)} ${slug.padEnd(18)} 元素 ${String(data.total).padEnd(5)} 可疑组 ${String(data.rows.length).padEnd(4)} user=${who}\n`)
  }
}

fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(all, null, 1))
console.log('\n写入 .workbuddy/contrast-audit/result.json')
await browser.close()
