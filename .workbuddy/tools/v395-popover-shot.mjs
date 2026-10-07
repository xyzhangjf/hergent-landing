/** v395：进销存 / 系统 两个弹窗的横向分列截图（只读，打生产）。 */
import { launch } from './lib/cdp-lite.mjs'

const BASE = 'https://hergent.cn'
const TOKEN = process.env.V395_TOKEN || ''
const OUT = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v395-侧栏弹窗横向分列-2026-10-08'

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

const main = async () => {
  const browser = await launch({ headless: true, extraArgs: ['--no-proxy-server'] })
  const p = await browser.newPage()
  await p.enable()
  await p.addInitScript(INIT)
  for (const [name, area] of [['进销存', '进销存'], ['系统', '系统']]) {
    await p.goto(BASE + '/?__r=' + Date.now() + '#/workbench', 9000)
    await sleep(800)
    await p.eval(`(function(){
      var b = Array.prototype.slice.call(document.querySelectorAll('.sb-area-btn'))
        .filter(function(x){ return x.textContent.indexOf(${JSON.stringify(area)}) >= 0 })[0];
      if (b) b.click();
      return '1';
    })()`)
    await sleep(700)
    await p.screenshot(OUT + '/' + name + '弹窗-横向分列.png')
    console.log('已截图：' + name)
  }
  await browser.close()
}
main().catch(e => { console.log('🔴 ' + (e && e.stack || e)); process.exit(3) })
