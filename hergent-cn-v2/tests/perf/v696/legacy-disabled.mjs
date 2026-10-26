import { chromium } from 'playwright'
const BASE = process.argv[2] || 'http://127.0.0.1:5188'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const b = await chromium.launch({ headless: true, executablePath: CHROME })
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await p.goto(BASE + '/?__p=696', { waitUntil: 'domcontentloaded' })
await sleep(2000)
if (!(await p.$('.topbar'))) {
  const d = p.getByRole('button', { name: /先看看演示效果/ })
  await d.first().waitFor({ timeout: 20000 }); await d.first().click()
  await p.waitForSelector('.topbar', { timeout: 30000 }); await sleep(1500)
}
await p.goto(BASE + '/#/inventory/purchase/1', { waitUntil: 'domcontentloaded' })
await sleep(2500)

const probe = () => p.evaluate(() => {
  let v = ''
  for (const ss of document.styleSheets) {
    let rules; try { rules = ss.cssRules } catch (e) { continue }
    if (!rules) continue
    for (const x of rules) { const t = x.selectorText || ''; if (t.includes('ipd-edit-sel')) { const m = t.match(/data-v-[0-9a-z]+/); if (m) v = m[0] } }
  }
  const mk = (cls, dis) => {
    const el = document.createElement('select'); el.className = cls; el.setAttribute(v, '')
    const o = document.createElement('option'); o.textContent = '中转仓'; el.appendChild(o)
    el.disabled = dis; document.body.appendChild(el); return el
  }
  const on = mk('input ipd-edit-sel', false), off = mk('input ipd-edit-sel', true)
  const res = { 可用: getComputedStyle(on).backgroundColor, 禁用: getComputedStyle(off).backgroundColor, v }
  on.remove(); off.remove()
  return res
})

console.log('【A】现行 v696 代码：', JSON.stringify(await probe()))

/* 【B】把旧代码的规则按「组件 CSS 后加载」的真实层叠条件注入回来：
   旧规则 .ipd-edit-sel{background:#fff} 与 .input:disabled{background:var(--bg4)}
   同为 (0,2,0)，谁后谁赢。这里显式把旧规则追加到 head 末尾。 */
const r2 = await p.evaluate(() => {
  let v = ''
  for (const ss of document.styleSheets) {
    let rules; try { rules = ss.cssRules } catch (e) { continue }
    if (!rules) continue
    for (const x of rules) { const t = x.selectorText || ''; if (t.includes('ipd-edit-sel')) { const m = t.match(/data-v-[0-9a-z]+/); if (m) v = m[0] } }
  }
  const st = document.createElement('style'); st.id = '__legacy'
  st.textContent = `.ipd-edit-sel[${v}]{height:40px;padding:4px 6px;font-size:13px;border:1px solid var(--t3);border-radius:6px;background:#fff;color:var(--t1)}`
  document.head.appendChild(st)
  const mk = (dis) => {
    const el = document.createElement('select'); el.className = 'input ipd-edit-sel'; el.setAttribute(v, '')
    const o = document.createElement('option'); o.textContent = '中转仓'; el.appendChild(o)
    el.disabled = dis; document.body.appendChild(el); return el
  }
  const on = mk(false), off = mk(true)
  const res = { 可用: getComputedStyle(on).backgroundColor, 禁用: getComputedStyle(off).backgroundColor }
  on.remove(); off.remove()
  return res
})
console.log('【B】注入旧规则后（模拟改造前）：', JSON.stringify(r2))
await b.close()
