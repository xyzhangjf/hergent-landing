/**
 * v405 —— 视觉核验截图（本地 dev）：删掉页内页签条后，顶部是否留突兀空隙 / 四子页风格是否统一
 * 运行：V405_BASE=http://127.0.0.1:5199 V405_TOKEN=... node .workbuddy/tools/v405-shot.mjs
 */
import fs from 'fs'
import { launch } from './lib/cdp-lite.mjs'

const BASE = process.env.V405_BASE || 'http://127.0.0.1:5199'
const TOKEN = process.env.V405_TOKEN || ''
const OUT = process.env.V405_OUT || '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v405-forecast-tabs-2026-10-08'
fs.mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const INIT = `
;(function(){
  try {
    localStorage.setItem('hergent_v2_token', ${JSON.stringify(TOKEN)});
    localStorage.setItem('hergent_v2_tenant', '1');
    localStorage.setItem('hergent_v2_csrf', 'probe-csrf');
    localStorage.setItem('hergent_v2_user', JSON.stringify({ id: 2, username: 'boss', role: 'boss', roles: ['boss'], name: '老板' }));
  } catch (e) {}
})();
`

const shots = [
  { name: '01-桌面-本期预报-主表', hash: '#/forecast', wait: 9000 },
  { name: '02-桌面-历史期次', hash: '#/forecast?tab=history', wait: 5000 },
  { name: '03-桌面-报单配置', hash: '#/forecast?tab=config', wait: 5000 },
  { name: '04-桌面-商品目标', hash: '#/forecast?tab=target', wait: 5000 },
]

const browser = await launch({})
const page = await browser.newPage()
await page.enable()
const sid = await page.addInitScript(INIT)

for (const s of shots) {
  await page.goto(BASE + '/' + s.hash, s.wait)
  const p = OUT + '/' + s.name + '.png'
  await page.screenshot(p)
  const h = await page.eval('location.hash')
  console.log('shot ' + s.name + '  ← ' + h)
}

/* 侧栏弹窗展开（看 4 条入口的排版） */
await page.goto(BASE + '/#/forecast', 5000)
await page.eval(`(() => { const b = Array.from(document.querySelectorAll('.sb-area-btn')).find(x => x.textContent.includes('预报订单管理')); if (b) b.click(); return !!b })()`)
await sleep(600)
await page.screenshot(OUT + '/05-桌面-侧栏弹窗4条入口.png')
console.log('shot 05 侧栏弹窗')

/* 手机 375（看底部栏 / 抽屉） */
await page.raw.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true })
await page.goto(BASE + '/#/forecast', 5000)
await page.screenshot(OUT + '/06-手机375-本期预报.png')
console.log('shot 06 手机')

await page.eval(`(() => { const b = Array.from(document.querySelectorAll('.mnav-item')).find(x => x.textContent.includes('更多')); if (b) b.click(); return !!b })()`)
await sleep(800)
await page.screenshot(OUT + '/07-手机375-抽屉摊平.png')
console.log('shot 07 手机抽屉')

await page.removeInitScript(sid)
await browser.close()
console.log('输出目录：' + OUT)
