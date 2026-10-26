import { chromium } from 'playwright'
const BASE = process.argv[2] || 'http://127.0.0.1:5188'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const b = await chromium.launch({ headless: true, executablePath: CHROME })
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await p.goto(BASE + '/?__p=696', { waitUntil: 'domcontentloaded' })
await sleep(2500)
if (!(await p.$('.topbar'))) {
  const d = p.getByRole('button', { name: /先看看演示效果/ })
  await d.first().waitFor({ timeout: 20000 }); await d.first().click()
  await p.waitForSelector('.topbar', { timeout: 30000 }); await sleep(1500)
}
await p.goto(BASE + '/#/inventory/purchase/1', { waitUntil: 'domcontentloaded' })
await sleep(3000)
const m = await p.evaluate(() => {
  const v = 'data-v-3173e2df'
  // 复刻 .ipd-barhd 的排版环境：一行 flex、基线对齐、无固定宽高
  const bar = document.createElement('div')
  bar.className = 'ipd-barhd'
  bar.setAttribute(v, '')
  bar.style.cssText = 'position:fixed;left:0;top:0;width:1400px'
  document.body.appendChild(bar)
  const mk = (tag, cls, val) => {
    const el = document.createElement(tag); el.className = cls; el.setAttribute(v, '')
    if (tag === 'select') { const o = document.createElement('option'); o.textContent = '中转仓'; el.appendChild(o) }
    else el.value = val
    const wrap = document.createElement('div'); wrap.className = 'ipd-bf'; wrap.setAttribute(v, '')
    const lb = document.createElement('span'); lb.className = 'ipd-lb'; lb.setAttribute(v, ''); lb.textContent = '字段'
    wrap.appendChild(lb); wrap.appendChild(el); bar.appendChild(wrap)
    return el
  }
  const a = mk('input', 'input ipd-edit-in', '张三')
  const s = mk('select', 'input ipd-edit-sel', '')
  const d = mk('input', 'input ipd-edit-in ipd-edit-in-sm', '2026-10-26')
  const txt = document.createElement('span'); txt.className = 'ipd-bfv'; txt.setAttribute(v, ''); txt.textContent = '张三'
  const tw = document.createElement('div'); tw.className = 'ipd-bf'; tw.setAttribute(v, '')
  const tl = document.createElement('span'); tl.className = 'ipd-lb'; tl.setAttribute(v, ''); tl.textContent = '字段'
  tw.appendChild(tl); tw.appendChild(txt); bar.appendChild(tw)

  const g = (el) => { const c = getComputedStyle(el); const r = el.getBoundingClientRect(); return { h: +r.height.toFixed(1), w: +r.width.toFixed(1), fs: c.fontSize, bg: c.backgroundColor } }
  const barRect = bar.getBoundingClientRect()
  const r = { editIn: g(a), editSel: g(s), editDate: g(d), text: g(txt), barH: +barRect.height.toFixed(1) }
  bar.remove()
  return r
})
console.log('备注输入框    ', JSON.stringify(m.editIn))
console.log('下拉(业务员)  ', JSON.stringify(m.editSel))
console.log('日期输入框    ', JSON.stringify(m.editDate))
console.log('同行纯文本字段', JSON.stringify(m.text))
console.log('整行高度      ', m.barH + 'px')
await b.close()
