/** 精确复核：alpha 合成后的真实对比度 + 小触控目标分类 */
import { launch } from '../lib/cdp-lite.mjs'
const TOKEN = process.env.HG_TOKEN
const PAGES = [['工作台','/'],['看板','/dashboard'],['本期预报','/forecast'],['商品档案','/archive/products'],['销售单','/inventory/sale'],['开单单据','/inventory/sale/new'],['销售报表','/reports/goods-sales'],['员工档案','/archive/employees']]
const b = await launch({ headless: true })
const page = await b.newPage(); await page.enable(); await page.raw.send('Network.enable')
await page.raw.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
await page.goto('https://hergent.cn/login', 2200)
for (const c of [{name:'erp_token',value:TOKEN,httpOnly:true},{name:'hergent_auth',value:'1'},{name:'csrf_token',value:'x'},{name:'hergent_tenant',value:'1'}])
  await page.raw.send('Network.setCookie', { ...c, domain:'hergent.cn', path:'/', secure:true, sameSite:'Lax' })

const PROBE = `(() => {
  const vis = el => { const r = el.getBoundingClientRect(); return r.width>2 && r.height>2 && r.bottom>0 && r.top<innerHeight*3 }
  const rgba = s => { const m=(s.match(/[\\d.]+/g)||[0,0,0,1]).map(Number); return [m[0],m[1],m[2], m.length>3?m[3]:1] }
  const over = (fg, bg) => { const a=fg[3]; return [fg[0]*a+bg[0]*(1-a), fg[1]*a+bg[1]*(1-a), fg[2]*a+bg[2]*(1-a), 1] }
  const lum = c => { const f=v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)}; return 0.2126*f(c[0])+0.7152*f(c[1])+0.0722*f(c[2]) }
  const cr = (a,bb) => { const L1=lum(a),L2=lum(bb); return (Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05) }

  const bad = {}
  let checked = 0
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const seen = new Set(); let n
  while ((n = walker.nextNode())) {
    if (!n.textContent.trim()) continue
    const el = n.parentElement
    if (!el || seen.has(el) || !vis(el)) continue
    seen.add(el)
    const cs = getComputedStyle(el)
    if (cs.visibility==='hidden' || cs.opacity==='0') continue
    // 逐层向上合成背景，直到不透明
    let p = el, stack = []
    while (p && p !== document.documentElement) {
      const c = rgba(getComputedStyle(p).backgroundColor)
      if (c[3] > 0) { stack.push(c); if (c[3] >= 1) break }
      p = p.parentElement
    }
    let base = [255,255,255,1]
    for (let i = stack.length-1; i >= 0; i--) base = over(stack[i], base)
    const fg = over(rgba(cs.color), base)
    // 透明度累乘
    let op = 1, q = el
    while (q && q !== document.documentElement) { op *= parseFloat(getComputedStyle(q).opacity || 1); q = q.parentElement }
    if (op < 1) { base = over([255,255,255,1-op], base); }
    const ratio = cr(fg, base)
    const px = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight)>=700
    const need = (px>=18 || (px>=14&&bold)) ? 3 : 4.5
    checked++
    if (ratio < need - 0.02) {
      const key = cs.color + '|' + 'rgb(' + base.slice(0,3).map(Math.round).join(', ') + ')'
      if (!bad[key]) bad[key] = { fg: cs.color, bg: 'rgb(' + base.slice(0,3).map(Math.round).join(',')+')', cr: +ratio.toFixed(2), need, n: 0, px, sample: [] }
      bad[key].n++
      if (bad[key].sample.length < 3) bad[key].sample.push((n.textContent.trim()).slice(0,10))
    }
  }

  // 小目标分类
  const cats = { 复选框:0, 图标钮:0, 标签页:0, 页脚链接:0, 行内文字链:0, 表单控件:0, 其它:0 }
  const det = []
  ;[...document.querySelectorAll('button,a[href],[role=button],input,select,textarea,[class*=btn],[class*=chip],.tb-toggle')].forEach(el => {
    if (!vis(el)) return
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el)
    if (cs.visibility==='hidden' || el.disabled) return
    if (r.height >= 28 && r.width >= 28) return
    const c = (el.className||'').toString(), tag = el.tagName.toLowerCase(), ty = (el.type||'').toLowerCase()
    let k = '其它'
    if (ty==='checkbox' || ty==='radio') k='复选框'
    else if (/tab-ic|icon-btn|btn-icon|tb-close|refresh/.test(c)) k='图标钮'
    else if (/tab-item/.test(c)) k='标签页'
    else if (/ICP|copyright|beian/.test((el.textContent||''))) k='页脚链接'
    else if (tag==='a') k='行内文字链'
    else if (['input','select','textarea'].includes(tag)) k='表单控件'
    cats[k]++
    if (det.length<14) det.push({ k, w:Math.round(r.width), h:Math.round(r.height), c:c.slice(0,26), t:(el.innerText||el.value||ty||'').trim().slice(0,8) })
  })
  return { checked, bad: Object.values(bad).sort((a,b)=>b.n-a.n).slice(0,10), cats, det }
})()`

const res = []
for (const [name, path] of PAGES) {
  await page.goto('https://hergent.cn/#'+path, 3200)
  const r = await page.eval(PROBE)
  res.push({ name, ...r })
  const tot = Object.values(r.cats).reduce((a,b)=>a+b,0)
  console.log(`\n### ${name}  文本节点=${r.checked}  小目标=${tot}  ${JSON.stringify(r.cats)}`)
  r.bad.forEach(x => console.log(`   ${x.cr}:1 (需${x.need}) ${x.fg} on ${x.bg} ×${x.n} ${x.px}px  例:${x.sample.join('/')}`))
}
import { writeFileSync } from 'fs'
writeFileSync(new URL('./v716-audit.json', import.meta.url), JSON.stringify(res,null,1))
await b.close()
