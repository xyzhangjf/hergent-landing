/**
 * v424 截图留档 —— 侧栏弹窗（报单配置分组）＋ 四个独立子页。
 * 只读：仅 demo-login 一次 + 页面 GET。
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = 'http://127.0.0.1:5195'
const OUT = '/Users/zhangjunfeng/WorkBuddy/Worktrees/laozhangai-product/main-58650390/outputs/v424-screens'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
fs.mkdirSync(OUT, { recursive: true })

const ld = await (await fetch('https://erp.hergent.cn/api/auth/demo-login', { method: 'POST' })).json()
const browser = await launch({ headless: true })
const page = await browser.newPage()
await page.enable()

await page.goto(BASE + '/#/login', 2500)
await page.eval(`(function(){
  localStorage.setItem('hergent_v2_token', ${JSON.stringify(ld.token)});
  localStorage.setItem('hergent_v2_tenant', ${JSON.stringify(String(ld.tenant_id))});
  localStorage.setItem('hergent_v2_user', ${JSON.stringify(JSON.stringify(ld.user))});
  return 'ok' })()`)

/* ① 弹窗展开
   🔴 必须带 `__r`（只读探针的"强制新文档"时间戳，`useTabs.js::EPHEMERAL` 会把它排除出标签身份）：
      否则「同 path 同 hash」的 `Page.navigate` 会被当成**同文档导航**⇒ 不重载 ⇒ 弹窗还开着，
      下一张图与这张**逐字节相同**（实测踩过：01/02 都是 91971 B）。 */
const TS = () => Date.now() + '-' + Math.floor(Math.random() * 1e6)

await page.goto(BASE + '/#/forecast?tab=config&__r=' + TS(), 6500)
await page.eval(`(function(){ var b=[].slice.call(document.querySelectorAll('.sb-area-btn')).filter(function(x){return x.textContent.indexOf('预报订单管理')>=0})[0]; if(b) b.click(); return 1 })()`)
await sleep(900)
await page.screenshot(`${OUT}/01-侧栏弹窗-报单配置分组.png`)
console.log('shot 01 打开弹窗:', await page.eval(`document.querySelectorAll('.sb-pop .sb-pop-item').length`), '条')

/* ②~⑤ 四个子页（各自新文档） */
const PAGES = [
  ['02-报单对象.png', 'config'],
  ['03-报单自动化.png', 'config-auto'],
  ['04-报单提醒设置.png', 'config-remind'],
  ['05-模板参数.png', 'config-template']
]
for (const [f, tab] of PAGES) {
  await page.goto(BASE + '/#/forecast?tab=' + tab + '&__r=' + TS(), 4200)
  await page.screenshot(`${OUT}/${f}`)
  console.log('shot', f)
}

await browser.close()
console.log('DONE →', OUT)
