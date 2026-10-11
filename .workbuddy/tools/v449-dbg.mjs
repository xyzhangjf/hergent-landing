/** v449 一次性诊断（跑完即删）：无头 Chrome 到底能不能打开本地 dev server。 */
import { launch } from './lib/cdp-lite.mjs'

const b = await launch({ headless: true })
const p = await b.newPage()
await p.enable()
for (const u of ['http://127.0.0.1:5199/', 'http://localhost:5199/', 'https://hergent.cn/']) {
  await p.goto(u, 3000)
  const d = await p.eval('JSON.stringify({url:location.href,title:document.title,'
    + 'txt:(document.body?document.body.innerText:"").slice(0,160),hasApp:!!document.querySelector("#app")})')
  console.log('\n' + u + '\n  → ' + d)
}
await b.close()
process.exit(0)
