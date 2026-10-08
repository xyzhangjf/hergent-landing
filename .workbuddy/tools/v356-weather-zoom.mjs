/** v356：只截天气面板并放大 3×，看清「升」「降」字样 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const P = {
  success: true, city: '武汉', lat: 30.5833, lon: 114.2667, temp: 16, code: 51,
  days: [20.0, 24.0, 18.0, 19.0, 20.0].map((t, i) => ({ date: `2026-10-0${i + 1}`, tmax: t, tmin: t - 6, pop: 50, code: 3 })),
}
const SRC = `
(() => {
  localStorage.setItem('hergent_v2_token', ${JSON.stringify(process.env.HG_TOKEN)});
  localStorage.setItem('hergent_v2_user', JSON.stringify({role:'boss',name:'探针'}));
  localStorage.setItem('hergent_v2_tenant', '10');
  const P = ${JSON.stringify(P)};
  const _f = window.fetch;
  window.fetch = function (i, n) {
    const u = (typeof i === 'string') ? i : (i && i.url) || '';
    if (/\\/api\\/weather(\\?|$)/.test(u)) return Promise.resolve(new Response(JSON.stringify(P), {status:200, headers:{'Content-Type':'application/json'}}));
    if (/\\/api\\/weather\\/pref/.test(u)) return Promise.resolve(new Response(JSON.stringify({success:true,city:''}), {status:200, headers:{'Content-Type':'application/json'}}));
    return _f.apply(this, arguments);
  };
})()`

const browser = await launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.enable()
  await page.addInitScript(SRC)
  await page.goto('https://hergent.cn/?cb=' + Date.now(), 5000)
  await page.eval(`document.querySelector('.wx-now').click()`)
  await new Promise(r => setTimeout(r, 1500))
  const rect = JSON.parse(await page.eval(`(()=>{const r=document.querySelector('.wx-pop').getBoundingClientRect();return JSON.stringify({x:r.x,y:r.y,width:r.width,height:r.height})})()`))
  console.log('面板矩形:', JSON.stringify(rect))
  const shot = await page.raw.send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: Math.max(0, rect.x - 6), y: Math.max(0, rect.y - 6), width: rect.width + 12, height: rect.height + 12, scale: 3 },
  })
  fs.writeFileSync('/tmp/v356-wx-zoom.png', Buffer.from(shot.result.data, 'base64'))
  console.log('已写 /tmp/v356-wx-zoom.png')
} finally {
  await browser.close()
}
