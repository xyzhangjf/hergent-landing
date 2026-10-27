// v704 判据：工具条弹层面板必须压住它那一排触发按钮，且**任何视口下都不许盖住自己的触发器**。
// ⛔ 不验"z-index 数字变了"，只验用户手指会不会被劫走 —— elementFromPoint 的归属 + 矩形是否相交。
import { chromium } from 'playwright'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  PASS', m) } else { fail++; console.log('  FAIL', m) } }

const b = await chromium.launch({ headless: true, executablePath: CHROME })
const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] })
await ctx.addCookies([
  { name: 'erp_token', value: process.env.HG_TOKEN, url: 'https://hergent.cn/' },
  { name: 'hergent_auth', value: '1', url: 'https://hergent.cn/' },
])
const p = await ctx.newPage()
await p.goto('https://hergent.cn/#/forecast', { waitUntil: 'domcontentloaded' })
await sleep(4500)
await p.selectOption('.sel-period', '37')
await sleep(5000)

// 面板是否真开着：按内容识别（`.brand-pop` 等也带 tb-pop-panel 类，不能只数 class）
const EXPORT_OPEN = '.tb-pop-panel:has-text("导出全部")'
const exportBtn = p.locator('.tb-data .tb-pop > button').first()

console.log('\n=== ① 加载的是新构建 ===')
const build = await p.evaluate(() => document.documentElement.dataset.build)
ok(build === 'v704', `data-build=${build}`)

console.log('\n=== ② 层级全序 ===')
await exportBtn.click()
await sleep(700)
const z = await p.evaluate(() => {
  const panel = document.querySelector('.tb-pop-panel')
  const trig = document.querySelector('.tb-data .tb-pop')
  const wx = document.querySelector('.wx-pop')
  return { panel: panel && getComputedStyle(panel).zIndex, trig: trig && getComputedStyle(trig).zIndex, wx: wx && getComputedStyle(wx).zIndex }
})
ok(z.panel === '1116', `面板 z-index=${z.panel}（期望 1116）`)
ok(z.trig === '1101', `触发按钮容器 z-index=${z.trig}（期望 1101）`)
ok(Number(z.panel) > Number(z.trig), `面板 ${z.panel} > 按钮 ${z.trig} ⇒ 遮挡带在原理上不可能再出现`)
ok(Number(z.panel) < 1121, `面板仍低于天气浮层 1121（不抢占"页面内浮层天花板"）`)

console.log('\n=== ③ 面板矩形内 9 点采样：一个都不许被别人接走 ===')
const grid = await p.evaluate(() => {
  const panel = document.querySelector('.tb-pop-panel')
  const pr = panel.getBoundingClientRect()
  const out = []
  for (let iy = 0; iy < 3; iy++) for (let ix = 0; ix < 3; ix++) {
    const x = pr.left + 8 + (pr.width - 16) * (ix / 2)
    const y = pr.top + 8 + (pr.height - 16) * (iy / 2)
    const el = document.elementFromPoint(x, y)
    out.push({ x: Math.round(x), y: Math.round(y), inPanel: el ? panel.contains(el) : false, who: el ? el.tagName + '.' + String(el.className || '').slice(0, 30) : 'null' })
  }
  return { rect: { t: Math.round(pr.top), l: Math.round(pr.left), w: Math.round(pr.width), h: Math.round(pr.height) }, out }
})
console.log('  面板矩形', JSON.stringify(grid.rect))
grid.out.filter(g => !g.inPanel).forEach(g => console.log('  hijack@', g.x + ',' + g.y, g.who))
ok(grid.out.every(g => g.inPanel), `面板内 9 点全部命中面板自身（被劫 ${grid.out.filter(g => !g.inPanel).length} 点）`)

console.log('\n=== ④ 面板里每个选项按钮：中心点命中自己 ===')
const items = await p.evaluate(() => {
  const panel = document.querySelector('.tb-pop-panel')
  return [...panel.querySelectorAll('button')].map(btn => {
    const r = btn.getBoundingClientRect()
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return { txt: String(btn.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 20), self: el === btn || btn.contains(el), disabled: btn.disabled }
  })
})
items.filter(i => !i.self && !i.disabled).forEach(i => console.log('  hijack 项:', i.txt))
ok(items.length >= 7, `面板内 ${items.length} 个选项`)
ok(items.every(i => i.self || i.disabled), '每个可用选项的中心点都命中自己')

console.log('\n=== ⑤ 真点第 4 项「复制整表数据」 ===')
await p.locator('.tb-pop-panel button', { hasText: '复制整表数据' }).first().click()
await sleep(1200)
const clip = await p.evaluate(() => navigator.clipboard.readText().catch(() => ''))
const rows = clip.split('\r\n').filter(Boolean).length
ok(rows > 0, `剪贴板拿到 ${rows} 行（点到的确实是"复制"，不是被"到货周期"劫走）`)
ok((await p.locator('.cycle-pop').count()) === 0, '没有误开到货周期筛选弹层')
ok((await p.locator(EXPORT_OPEN).count()) === 0, '导出面板已自动关闭')

console.log('\n=== ⑥ 反向：面板外点「品牌」仍能互斥切换（1120→1101 不许把这条弄坏）===')
await exportBtn.click()
await sleep(600)
ok((await p.locator(EXPORT_OPEN).count()) === 1, '导出面板已打开')
await p.locator('.grid-ctl-row .tb-pop > button', { hasText: '品牌' }).first().click()
await sleep(900)
ok((await p.locator('.brand-pop').count()) === 1, '品牌弹层开了（触发按钮 1101 > 遮罩 1100 ⇒ 仍可直接点）')
ok((await p.locator(EXPORT_OPEN).count()) === 0, '导出面板被互斥关掉')
// 关掉品牌弹层：点它自己的触发按钮（工具栏弹层不监听 ESC，ESC 只服务 Modal，别拿它当"关闭"）
await p.locator('.grid-ctl-row .tb-pop > button', { hasText: '品牌' }).first().click()
await sleep(500)

console.log('\n=== ⑦ 任何视口下：面板矩形与自己的触发按钮不许相交 ===')
/* ⚠️ 关闭态必须用**触发按钮的 .on 类**判断：这些工具栏弹层不监听 ESC（ESC 是 Modal 的事），
   拿 keyboard.press('Escape') 当关闭会静默失效 —— 下一轮 click 反而把它 toggle 掉，
   于是 evaluate 里查不到面板，报成 {"err":"missing"} 的假 FAIL（第一版就是这么栽的）。 */
for (const vp of [{ w: 1600, h: 1000 }, { w: 1366, h: 640 }, { w: 1366, h: 420 }]) {
  await p.setViewportSize({ width: vp.w, height: vp.h })
  await sleep(900)
  await p.evaluate(() => window.scrollTo(0, 0))
  await sleep(400)
  if (await exportBtn.evaluate(el => el.classList.contains('on'))) { await exportBtn.click(); await sleep(500) }
  await exportBtn.click()
  await sleep(800)
  const r = await p.evaluate(() => {
    const panel = document.querySelector('.tb-pop-panel')
    const btn = document.querySelector('.tb-data .tb-pop > button')
    if (!panel || !btn) return { err: 'missing' }
    const pr = panel.getBoundingClientRect(), br = btn.getBoundingClientRect()
    const overlap = !(pr.right <= br.left || pr.left >= br.right || pr.bottom <= br.top || pr.top >= br.bottom)
    const el = document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2)
    return {
      overlap, side: pr.top >= br.bottom ? 'below' : (pr.bottom <= br.top ? 'above' : 'cross'),
      panelBox: [Math.round(pr.left), Math.round(pr.top), Math.round(pr.width), Math.round(pr.height)],
      inViewport: pr.top >= 0 && pr.bottom <= window.innerHeight + 1,
      btnClickable: el === btn || btn.contains(el),
      scrollable: panel.scrollHeight > panel.clientHeight + 1,
      h: Math.round(pr.height),
    }
  })
  console.log(`  ${vp.w}x${vp.h}:`, JSON.stringify(r))
  ok(!r.overlap, `${vp.w}x${vp.h} 面板与触发按钮不相交（位于按钮${r.side === 'below' ? '下方' : '上方'}）`)
  ok(r.inViewport, `${vp.w}x${vp.h} 面板完整落在视口内（面板高 ${r.h}${r.scrollable ? '，内部可滚动' : ''}）`)
  ok(r.btnClickable, `${vp.w}x${vp.h} 触发按钮中心仍点得到（能看出开着、能点掉）`)
  await exportBtn.click()   // 用触发按钮关闭（不依赖 ESC）
  await sleep(400)
}

await p.setViewportSize({ width: 1600, height: 1000 })
await sleep(600)
await exportBtn.click()
await sleep(700)
await p.screenshot({ path: '/tmp/v704-after.png', clip: { x: 620, y: 90, width: 620, height: 480 } })

console.log(`\n===== v704：${pass} PASS / ${fail} FAIL =====`)
await b.close()
process.exit(fail ? 1 : 0)
