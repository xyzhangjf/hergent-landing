import { chromium } from 'playwright'
const BASE='https://hergent.cn', sleep=(ms)=>new Promise(r=>setTimeout(r,ms))
const b=await chromium.launch({channel:'chrome',headless:true})
const ctx=await b.newContext({viewport:{width:1920,height:1080}})
const page=await ctx.newPage()
await page.goto(BASE+'/',{waitUntil:'domcontentloaded'})
const d=page.getByRole('button',{name:/先看看演示效果/}); await d.first().waitFor({timeout:25000}); await d.first().click()
await page.waitForSelector('.topbar',{timeout:30000}); await sleep(1200)
const routes=[['#/inventory/stock','.is-filter'],['#/wh/outbound','.wob-filter'],['#/funds/doc','.fd-filter']]
for(const [hash,sel] of routes){
  await page.evaluate(h=>{location.hash=h},hash); await sleep(1500)
  const r=await page.evaluate(s=>{const el=document.querySelector(s); if(!el) return {found:false}; const cs=getComputedStyle(el); const b=el.getBoundingClientRect(); return {found:true,padT:cs.paddingTop,padB:cs.paddingBottom,h:+b.height.toFixed(1)}},sel)
  console.log(hash, sel, JSON.stringify(r))
}
await b.close()
