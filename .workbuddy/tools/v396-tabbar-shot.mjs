/** v396：全局标签栏 + 退役后页面的截图（只读，打生产）。 */
import { launch } from './lib/cdp-lite.mjs'

const BASE = 'https://hergent.cn'
const TOKEN = process.env.V396_TOKEN || ''
const OUT = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v396-标签栏-2026-10-08'

const INIT = `
;(function(){
  try {
    localStorage.setItem('hergent_v2_token', ${JSON.stringify(TOKEN)});
    localStorage.setItem('hergent_v2_tenant', '1');
    localStorage.setItem('hergent_v2_csrf', 'probe-csrf');
    localStorage.setItem('hergent_v2_user', JSON.stringify({ id: 2, username: 'boss', role: 'boss', roles: ['boss'], name: '老板' }));
  } catch (e) {}
})();`

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const clickArea = (name) => `(function(){
  var b = Array.prototype.slice.call(document.querySelectorAll('.sb-area-btn'))
    .filter(function(x){ return x.textContent.indexOf(${JSON.stringify(name)}) >= 0 })[0];
  if (b) b.click();
  return '1';
})()`

const clickItem = (t) => `(function(){
  var a = Array.prototype.slice.call(document.querySelectorAll('.sb-pop-item'))
    .filter(function(x){ return x.textContent.trim() === ${JSON.stringify(t)} })[0];
  if (a) a.click();
  return '1';
})()`

const main = async () => {
  const browser = await launch({ headless: true, extraArgs: ['--no-proxy-server'] })
  const p = await browser.newPage()
  await p.enable()
  await p.addInitScript(INIT)
  await p.raw.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })

  await p.goto(BASE + '/?__r=' + Date.now() + '#/workbench', 9000)
  await sleep(900)
  await p.screenshot(OUT + '/1-初始-单个标签.png')
  console.log('已截图 1 · 初始（只有 1 个标签：经营工作台）')

  /* 依次点开三个档案页 ⇒ 标签累积 */
  for (const name of ['商品档案', '客户档案', '员工档案']) {
    await p.eval(clickArea('档案管理'))
    await sleep(450)
    await p.eval(clickItem(name))
    await sleep(1300)
  }
  await p.screenshot(OUT + '/2-累积四个标签.png')
  console.log('已截图 2 · 累积（经营工作台 + 3 个档案页）')

  /* 只裁标签栏区域 —— 🔴 v396：`clip` 现由 cdp-lite 显式支持。
     带位按 **实测** 取（不是猜）：标签栏正文 OCR 落在 y≈0.077×900≈69px、高 0.017×900≈15px，
     条目本身另有上下 padding ⇒ 取 y 40~112（高 72）足够包住整条，且不切到下方内容表头。
     左侧 x<190 是侧栏（同一行也有「经营工作台」字样），裁掉以免与标签栏混淆。 */
  await p.screenshot(OUT + '/3-标签栏条带.png', {
    clip: { x: 190, y: 40, width: 1250, height: 72, scale: 1 },
  })
  console.log('已截图 3 · 标签栏条带（供 OCR 自证）')

  /* 目标与返利：退役后页内无页签条 */
  await p.goto(BASE + '/?__r=' + Date.now() + '#/rebate?tab=contracts', 9000)
  await sleep(1800)
  await p.screenshot(OUT + '/4-返利结算-页内无页签条.png')
  console.log('已截图 4 · 返利结算（页内已无页签条）')

  /* 进销存列表：同样无页签条 */
  await p.goto(BASE + '/?__r=' + Date.now() + '#/inventory/purchase', 9000)
  await sleep(1500)
  await p.screenshot(OUT + '/5-采购单-页内无页签条.png')
  console.log('已截图 5 · 采购单（页内已无页签条）')

  /* 🔴 `browser.close()` 实测会**卡住不返回**（CDP `Browser.close` 无回执，node 进程常驻）；
     所有图都已在上面落盘 ⇒ 这里给它 3s 兑现，然后**强制退出**，不让后台任务永远挂着。 */
  await Promise.race([browser.close(), sleep(3000)])
  console.log('✅ 截图完成，共 5 张 → ' + OUT)
  process.exit(0)
}
main().catch(e => { console.log('🔴 ' + (e && e.stack || e)); process.exit(3) })
