/** 焦点探针 + 阳性对照 + 实测 outline 真实值 */
import { launch } from './lib/cdp-lite.mjs'
const TOKEN = process.env.HG_TOKEN
const b = await launch({ headless: true }); const page = await b.newPage()
await page.enable(); await page.raw.send('Network.enable')
await page.raw.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
await page.goto('https://hergent.cn/login', 2200)
for (const c of [{name:'erp_token',value:TOKEN,httpOnly:true},{name:'hergent_auth',value:'1'},{name:'csrf_token',value:'x'},{name:'hergent_tenant',value:'1'}])
  await page.raw.send('Network.setCookie', { ...c, domain:'hergent.cn', path:'/', secure:true, sameSite:'Lax' })
await page.goto('https://hergent.cn/#/inventory/sale', 3600)

const BODY = () => `(() => {
  const el = document.activeElement
  if (!el || el === document.body) return null
  const c = getComputedStyle(el)
  return { tag: el.tagName.toLowerCase(), cls: (el.className||'').toString().slice(0,26),
           t: (el.innerText||el.value||el.type||'').trim().slice(0,10),
           outline: c.outlineStyle + ' ' + c.outlineWidth + ' ' + c.outlineColor,
           shadow: c.boxShadow.slice(0,40), bd: c.borderColor }
})()`
const tab = async () => {
  await page.raw.send('Input.dispatchKeyEvent', { type:'keyDown', key:'Tab', code:'Tab', windowsVirtualKeyCode:9, nativeVirtualKeyCode:9 })
  await page.raw.send('Input.dispatchKeyEvent', { type:'keyUp', key:'Tab', code:'Tab', windowsVirtualKeyCode:9, nativeVirtualKeyCode:9 })
  return page.eval(BODY())
}

console.log('=== A) 现状：真实焦点指示长什么样 ===')
const real = []
for (let i = 0; i < 14; i++) { const r = await tab(); if (r) real.push(r) }
real.slice(0, 8).forEach(r => console.log(`  ${r.tag}.${r.cls.split(' ')[0]} "${r.t}"\n     outline=${r.outline}\n     boxShadow=${r.shadow || '(无)'}  border=${r.bd}`))
const outlineNone = real.filter(r => /none|0px/.test(r.outline)).length
const hasShadowRing = real.filter(r => r.shadow && r.shadow !== 'none' && !/rgba?\(0, 0, 0, 0\)/.test(r.shadow)).length
console.log(`\n  统计：${real.length} 个元素中 outline 被抑制 ${outlineNone} 个；有自定义 box-shadow 焦点环 ${hasShadowRing} 个`)

console.log('\n=== B) 阳性对照：注入 * { outline:none } 应识别为"无指示" ===')
await page.eval(`(() => { const s=document.createElement('style'); s.textContent='*{outline:none !important;box-shadow:none !important}'; document.head.appendChild(s); return 1 })()`)
await page.eval(`(() => { document.body.setAttribute('tabindex','-1'); document.body.focus(); document.body.removeAttribute('tabindex'); return 1 })()`)
const ctrl = []
for (let i = 0; i < 8; i++) { const r = await tab(); if (r) ctrl.push(r) }
const ctrlNone = ctrl.filter(r => /none|0px/.test(r.outline)).length
console.log(`  注入后 ${ctrl.length} 个元素全被识别为 outline 抑制：${ctrlNone}/${ctrl.length} ${ctrlNone === ctrl.length ? '✅ 探针有效' : '⚠️ 探针失灵'}`)
await b.close()
