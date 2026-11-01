/** 视觉层级：每页主按钮数量 / 标题层级 / 首屏信息密度 */
import { launch } from './lib/cdp-lite.mjs'
const TOKEN = process.env.HG_TOKEN
const PAGES=[['工作台','/'],['看板','/dashboard'],['本期预报','/forecast'],['商品档案','/archive/products'],['销售单','/inventory/sale'],['销售报表','/reports/goods-sales']]
const b=await launch({headless:true}); const page=await b.newPage(); await page.enable(); await page.raw.send('Network.enable')
await page.raw.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false})
await page.goto('https://hergent.cn/login',2200)
for(const c of [{name:'erp_token',value:TOKEN,httpOnly:true},{name:'hergent_auth',value:'1'},{name:'csrf_token',value:'x'},{name:'hergent_tenant',value:'1'}])
  await page.raw.send('Network.setCookie',{...c,domain:'hergent.cn',path:'/',secure:true,sameSite:'Lax'})
for(const [name,path] of PAGES){
  await page.goto('https://hergent.cn/#'+path,3200)
  const r=await page.eval(`(() => {
    const vis = el => { const r=el.getBoundingClientRect(); return r.width>2&&r.height>2&&r.top<innerHeight*2 }
    const prim=[...document.querySelectorAll('.btn-primary,[class*="btn-pri"],[class*="btn-primary"]')].filter(vis)
    const all=[...document.querySelectorAll('.btn,.btn-sm,[class*="btn"]')].filter(e=>vis(e)&&!/btn-icon|btn-ic/.test(e.className))
    const heads=[...document.querySelectorAll('h1,h2,h3,h4,.page-title,.ph-title,.panel-hd b,.card-title')].filter(vis).map(e=>({tag:e.tagName,lv:(e.className||'').toString().slice(0,18),px:getComputedStyle(e).fontSize,w:getComputedStyle(e).fontWeight,t:(e.innerText||'').trim().slice(0,10)}))
    return { prim: prim.length, primText: prim.map(e=>(e.innerText||'').trim().slice(0,8)), totalBtn: all.length, heads: heads.slice(0,10) }
  })()`)
  console.log(`\n### ${name}  主按钮=${r.prim} ${JSON.stringify(r.primText)}  按钮总数=${r.totalBtn}`)
  r.heads.forEach(h=>console.log(`   ${h.tag} ${h.px}/${h.w} "${h.t}" .${h.lv}`))
}
await b.close()
