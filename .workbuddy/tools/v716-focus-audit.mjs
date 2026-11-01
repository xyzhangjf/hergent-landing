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
           offset: c.outlineOffset,
           shadow: c.boxShadow.slice(0,40), bd: c.borderColor }
})()`
const tab = async () => {
  await page.raw.send('Input.dispatchKeyEvent', { type:'keyDown', key:'Tab', code:'Tab', windowsVirtualKeyCode:9, nativeVirtualKeyCode:9 })
  await page.raw.send('Input.dispatchKeyEvent', { type:'keyUp', key:'Tab', code:'Tab', windowsVirtualKeyCode:9, nativeVirtualKeyCode:9 })
  // v718：必须等过渡落定再采样。侧栏/顶栏有 `transition:all`，outline 会被一起做动画，
  // 立刻读会拿到「3px + currentColor」这种中间态，看起来像焦点环没生效。
  await new Promise(r => setTimeout(r, 260))
  return page.eval(BODY())
}

console.log('=== A) 现状：真实焦点指示长什么样 ===')
const real = []
for (let i = 0; i < 14; i++) { const r = await tab(); if (r) real.push(r) }
real.slice(0, 8).forEach(r => console.log(`  ${r.tag}.${r.cls.split(' ')[0]} "${r.t}"\n     outline=${r.outline}\n     boxShadow=${r.shadow || '(无)'}  border=${r.bd}`))
// v718 判据改造：v717 之前焦点全靠浏览器 `outline:auto`，所以旧判据只认 box-shadow 环
// （当时结论「自定义焦点环 0 个」是对的）。v717 起改由全局 `:focus-visible:focus-visible`
// 给 2px solid var(--p-dark) + 2px offset —— 是 **outline** 不是 shadow，
// 沿用旧判据会把新实现也判成「没有」，故改成认 outline 三要素。
const P_DARK = 'rgb(14, 116, 144)'
const isSpec = r => /solid 2px/.test(r.outline) && r.outline.includes(P_DARK) && parseFloat(r.offset) >= 1
const outlineNone = real.filter(r => /none|0px/.test(r.outline)).length
const uniformRing = real.filter(isSpec).length
const offSpec = real.filter(r => !isSpec(r) && !/none|0px/.test(r.outline)).length
console.log(`\n  统计：${real.length} 个元素中`)
console.log(`    outline 被完全抑制（零指示，不可接受）   ${outlineNone}`)
console.log(`    符合规范（solid 2px ${P_DARK} + offset≥1px） ${uniformRing}`)
console.log(`    有指示但不合规（宽度/颜色/offset 不统一）    ${offSpec}`)
if (offSpec) real.filter(r => !isSpec(r) && !/none|0px/.test(r.outline)).slice(0, 5)
  .forEach(r => console.log(`      ✗ ${r.tag}.${r.cls.split(' ')[0]} → outline=${r.outline} offset=${r.offset}`))

console.log('\n=== B) 阳性对照：注入 * { outline:none } 应识别为"无指示" ===')
await page.eval(`(() => { const s=document.createElement('style'); s.textContent='*{outline:none !important;box-shadow:none !important}'; document.head.appendChild(s); return 1 })()`)
await page.eval(`(() => { document.body.setAttribute('tabindex','-1'); document.body.focus(); document.body.removeAttribute('tabindex'); return 1 })()`)
const ctrl = []
for (let i = 0; i < 8; i++) { const r = await tab(); if (r) ctrl.push(r) }
const ctrlNone = ctrl.filter(r => /none|0px/.test(r.outline)).length
console.log(`  注入后 ${ctrl.length} 个元素全被识别为 outline 抑制：${ctrlNone}/${ctrl.length} ${ctrlNone === ctrl.length ? '✅ 探针有效' : '⚠️ 探针失灵'}`)
await b.close()
