/** v719 P2 生产验证：标题语义层级 / 热区 / 对比度回归 / 375px 溢出
 *  用法：HG_TOKEN=xxx node .workbuddy/tools/v719-p2-audit.mjs
 */
import { launch } from './lib/cdp-lite.mjs'
const TOKEN = process.env.HG_TOKEN
const PAGES = [
  ['工作台', '/'],
  ['看板', '/dashboard'],
  ['本期预报', '/forecast'],
  ['商品档案', '/archive/products'],
  ['员工档案', '/archive/employees'],
  ['销售单', '/inventory/sale'],
  ['开单单据', '/inventory/sale/new'],
  ['连接中心', '/connect'],
  ['报表设计器', '/reports/builder'],
]

const b = await launch({ headless: true })
const page = await b.newPage()
await page.enable()
await page.raw.send('Network.enable')
await page.raw.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
await page.goto('https://hergent.cn/login', 2200)
for (const c of [
  { name: 'erp_token', value: TOKEN, httpOnly: true },
  { name: 'hergent_auth', value: '1' },
  { name: 'csrf_token', value: 'x' },
  { name: 'hergent_tenant', value: '1' },
]) await page.raw.send('Network.setCookie', { ...c, domain: 'hergent.cn', path: '/', secure: true, sameSite: 'Lax' })

/* ---------- 1. 构建号 ---------- */
await page.goto('https://hergent.cn/', 3000)
const build = await page.eval(`window.__HG_BUILD__ || '(none)'`)
const dataBuild = await page.eval(`document.documentElement.getAttribute('data-build') || '(none)'`)
console.log(`构建号: window=${build}  data-build=${dataBuild}  ${build === 'v719' && dataBuild === 'v719' ? '✅' : '❌'}`)

/* ---------- 2. 标题语义层级 ---------- */
console.log('\n══ 标题层级（每页应恰好 1 个 h1，20px/600）══')
// 注意：档案页（商品/员工）的页头由 Archive.vue 外壳**刻意 display:none**
//（v501 页头退役，标题由顶部标签栏承担）⇒ 这里数 DOM 里的 h1，不按可见性过滤，
//  但把可见性一并带出来，避免把"设计性隐藏"误报成"缺标题"。
const h1probe = `(() => {
  const all = [...document.querySelectorAll('h1')]
  const hasHd = !!document.querySelector('.page-hd, .dash-hd')
  if (!all.length) return { n: 0, hasHd, vis: false, txt: '', fs: '', fw: '' }
  const e = all[0], cs = getComputedStyle(e)
  return { n: all.length, hasHd, vis: e.getBoundingClientRect().height > 0,
           txt: e.textContent.trim().slice(0, 18), fs: cs.fontSize, fw: cs.fontWeight }
})()`
let h1ok = 0, h1bad = []
for (const [name, path] of PAGES) {
  await page.goto('https://hergent.cn/#' + path, 3200)
  const r = await page.eval(h1probe)
  // 判据：有页头的页面必须恰好 1 个 h1（20px/600）；无页头的页面必须 0 个
  const good = r.hasHd ? (r.n === 1 && r.fs === '20px' && r.fw === '600') : (r.n === 0)
  const note = !r.hasHd ? ' (无页头·设计如此)' : (!r.vis ? ' (外壳刻意隐藏·标题由标签栏承担)' : '')
  if (good) h1ok++
  else h1bad.push(`${name}: n=${r.n} hasHd=${r.hasHd} fs=${r.fs} fw=${r.fw} txt="${r.txt}"`)
  console.log(`  ${good ? '✅' : '⚠️ '} ${name.padEnd(6)} h1=${r.n} ${r.fs}/${r.fw}「${r.txt}」${note}`)
}
if (h1bad.length) h1bad.forEach(x => console.log('     · ' + x))

/* ---------- 3. 热区 ---------- */
console.log('\n══ 热区实测 ══')
await page.goto('https://hergent.cn/#/inventory/sale', 3200)
const hit = await page.eval(`(() => {
  const out = {}
  const lbl = document.querySelector('td.psi-chk label.cb-hit')
  if (lbl) { const r = lbl.getBoundingClientRect(); out.chk = { w: Math.round(r.width), h: Math.round(r.height) } }
  const cb = document.querySelector('td.psi-chk input[type=checkbox]')
  if (cb) { const r = cb.getBoundingClientRect(); out.raw = { w: Math.round(r.width), h: Math.round(r.height) } }
  const ti = document.querySelector('.tab-ic')
  if (ti) {
    const before = getComputedStyle(ti, '::before')
    const r = ti.getBoundingClientRect()
    // 伪元素 inset 解析：-5px -3px ⇒ 宽 +6 / 高 +10
    out.tab = { w: Math.round(r.width), h: Math.round(r.height), content: before.content,
                inset: before.inset || before.top + ' ' + before.right + ' ' + before.bottom + ' ' + before.left }
  }
  return out
})()`)
if (hit.chk) console.log(`  勾选列热区 label: ${hit.chk.w}×${hit.chk.h} (裸 checkbox ${hit.raw ? hit.raw.w + '×' + hit.raw.h : 'n/a'})`)
else console.log('  ⚠️ 未找到 td.psi-chk label.cb-hit')
if (hit.tab) console.log(`  .tab-ic: 视觉 ${hit.tab.w}×${hit.tab.h}  伪元素 content=${hit.tab.content} inset=${hit.tab.inset}`)
else console.log('  ⚠️ 未找到 .tab-ic')

/* ---------- 4. 对比度回归 ---------- */
console.log('\n══ 对比度（alpha 合成后，仅列不达标）══')
const CONTRAST = `(() => {
  const vis = el => { const r = el.getBoundingClientRect(); return r.width>2 && r.height>2 && r.bottom>0 && r.top<innerHeight*3 }
  const rgba = s => { const m=(s.match(/[\\d.]+/g)||[0,0,0,1]).map(Number); return [m[0],m[1],m[2], m.length>3?m[3]:1] }
  const over = (fg, bg) => { const a=fg[3]; return [fg[0]*a+bg[0]*(1-a), fg[1]*a+bg[1]*(1-a), fg[2]*a+bg[2]*(1-a), 1] }
  const lum = c => { const f=v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)}; return 0.2126*f(c[0])+0.7152*f(c[1])+0.0722*f(c[2]) }
  const cr = (a,bb) => { const L1=lum(a),L2=lum(bb); return (Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05) }
  const bad = []; let checked = 0
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const seen = new Set(); let n
  while ((n = walker.nextNode())) {
    if (!n.textContent.trim()) continue
    const el = n.parentElement
    if (!el || seen.has(el) || !vis(el)) continue
    seen.add(el)
    const cs = getComputedStyle(el)
    if (cs.visibility==='hidden' || cs.opacity==='0') continue
    let p = el, stack = []
    while (p && p !== document.documentElement) {
      const c = rgba(getComputedStyle(p).backgroundColor)
      if (c[3] > 0) { stack.push(c); if (c[3] >= 1) break }
      p = p.parentElement
    }
    let base = [255,255,255,1]
    for (let i = stack.length-1; i >= 0; i--) base = over(stack[i], base)
    const fg = over(rgba(cs.color), base)
    checked++
    const ratio = cr(fg, base)
    const size = parseFloat(cs.fontSize)
    const need = (size >= 18.66 || (size >= 14 && parseInt(cs.fontWeight) >= 600)) ? 3 : 4.5
    if (ratio < need && !(el.closest(':disabled') || el.matches(':disabled'))) {
      bad.push({ t: n.textContent.trim().slice(0,20), r: +ratio.toFixed(2), need, fs: size, dis: !!el.closest('*[disabled]') })
    }
  }
  return { checked, bad: bad.slice(0, 6) }
})()`
let totalNodes = 0, totalBad = 0
for (const [name, path] of PAGES) {
  await page.goto('https://hergent.cn/#' + path, 3200)
  const r = await page.eval(CONTRAST)
  totalNodes += r.checked; totalBad += r.bad.length
  const tag = r.bad.length ? '⚠️ ' : '✅'
  console.log(`  ${tag} ${name.padEnd(6)} 检查 ${String(r.checked).padStart(4)} 节点，不达标 ${r.bad.length}`)
  r.bad.forEach(x => console.log(`       · 「${x.t}」${x.r}:1 (需${x.need}) ${x.fs}px${x.dis ? ' [disabled]' : ''}`))
}
console.log(`  合计 ${totalNodes} 节点 / 不达标 ${totalBad}`)

/* ---------- 5. 375px 横向溢出 ---------- */
console.log('\n══ 375px 横向溢出 ══')
let ovf = 0
for (const [name, path] of PAGES) {
  await page.raw.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true })
  await page.goto('https://hergent.cn/#' + path, 2400)
  const r = await page.eval(`({ sw: document.documentElement.scrollWidth, iw: innerWidth })`)
  const over = r.sw - r.iw
  if (over > 1) { ovf++; console.log(`  ⚠️  ${name.padEnd(6)} 溢出 ${over}px`) }
  else console.log(`  ✅ ${name.padEnd(6)} 溢出 0`)
  await page.raw.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
}
console.log(`  溢出页数 ${ovf}/${PAGES.length}`)

await b.close()
console.log('\n══ 完成 ══')
