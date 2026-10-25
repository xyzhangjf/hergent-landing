import { chromium } from 'playwright'
const BASE='https://hergent.cn', OUT='tests/perf/v679'
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms))
const INJECT=`
.card.ipl-filter,.card.isl-filter,.card.is-filter,.card.fc-filter,.card.ff-filter,.card.fd-filter,.card.fbk-filter,.card.fs-filter,.card.wob-filter,.card.woi-filter,.card.wsa-filter,.card.win-filter,.card.wvs-filter{padding:10px 14px;}
.psi-tabbar .main-tab{padding:7px 12px;font-size:13px;}
.psi-frow{gap:10px;}
.psi-tabbar{margin:0 0 10px;}
`
const b=await chromium.launch({channel:'chrome',headless:true})
const ctx=await b.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:2})
const page=await ctx.newPage()
await page.goto(BASE+'/',{waitUntil:'domcontentloaded'})
const d=page.getByRole('button',{name:/先看看演示效果/}); await d.first().waitFor({timeout:25000}); await d.first().click()
await page.waitForSelector('.topbar',{timeout:30000}); await sleep(1200)
await page.evaluate(()=>{location.hash='#/inventory/purchase'}); await page.waitForSelector('.ipl-filter',{timeout:20000}); await sleep(800)
async function clip(name){
  const box=await page.evaluate(()=>{const f=document.querySelector('.ipl-filter').getBoundingClientRect();const t=document.querySelector('.psi-tabbar').getBoundingClientRect();return {x:Math.max(0,f.left-4),y:Math.max(0,f.top-4),width:f.width+8,height:(t.bottom-f.top)+12}})
  await page.screenshot({path:`${OUT}/${name}`,clip:box})
}
await clip('head-before.png')
await page.addStyleTag({content:INJECT}); await sleep(300)
await clip('head-after.png')
await b.close(); console.log('ok')
