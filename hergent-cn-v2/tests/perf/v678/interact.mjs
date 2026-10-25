/**
 * v678 交互探针：⋯ 菜单的开合 / 定位 / 动作分发。
 *
 * 判据（每一条都是"会真坏"的那种）：
 *   ① 点 ⋯ ⇒ `.row-more-pop` 出现，且 `role=menu`、项数与预期一致
 *   ② 菜单**完全在视口内**（最后一行也不会被裁在屏幕外 / 被表格 overflow 裁掉）
 *   ③ 点空白处 ⇒ 关闭；再点 ⋯ ⇒ 再开（开关可逆，不是一次性）
 *   ④ Esc ⇒ 关闭
 *   ⑤ 滚动 ⇒ 关闭（fixed 浮层一滚就脱位，必须收）
 *   ⑥ 点菜单项 ⇒ 真的执行（用「复制」验证：应跳到 /inventory/purchase/new?copy=<id>）
 *   ⑦ 再点一次 ⋯ ⇒ 关闭（不点空白也能收）
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE || 'http://127.0.0.1:8903'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ROWS = [
  { id: 901, order_no: 'CG901', status: 'draft', supplier: '蒙牛', warehouse: '东津仓', order_date: '2026-10-21', total_amount: 1, received_amount: 0, paid_amount: 0, unpaid: 1, creator_name: '张俊峰', print_count: 0 },
  { id: 905, order_no: 'CG905', status: 'received', supplier: '蒙牛', warehouse: '东津仓', order_date: '2026-10-15', total_amount: 1, received_amount: 1, paid_amount: 1, unpaid: 0, creator_name: '张俊峰', print_count: 2 },
]
const out = []
const ok = (cond, msg, extra = '') => { out.push(`${cond ? '✅' : '❌'} ${msg}${extra ? ' — ' + extra : ''}`); return cond }

/* 🔴 视口必须是 1920：本表 `table-layout:fixed` 且 min-width 1700，列宽合计 ~1868px
   ⇒ 1440 下「操作」列在视口外（`elementFromPoint` 返回 null），Playwright 的
   `click()` 虽然会横向滚动，但滚完再点会让"点到了哪一行"变得不可控。
   老板的屏是 1920 起（他截图里两列都在），所以按 1920 验才是真机口径。 */
const b = await chromium.launch({ channel: 'chrome', headless: true })
const p = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage()
await p.route('**/api/psi/purchase-orders**', (route) => {
  if (route.request().method() !== 'GET') return route.continue()
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ orders: ROWS, total: 2, counts: {}, summary: {} }) })
})
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
const demo = p.getByRole('button', { name: /先看看演示效果/ })
await demo.first().waitFor({ timeout: 25000 }); await demo.first().click()
await p.waitForSelector('.topbar', { timeout: 30000 }); await sleep(1000)
await p.evaluate(() => { location.hash = '#/inventory/purchase' })
await p.waitForSelector('.ipl-tbl tbody tr', { timeout: 20000 }); await sleep(600)
/* 🔴 必须先把「操作」列横向滚进视口再点：本表列宽合计 ~1872 > 可视区，
   不滚的话 `elementFromPoint` 命中 null（按钮在视口外），Playwright 的
   `click()` 会自己 scrollIntoView —— 那一滚会触发本组件的"滚动即收起"，
   于是"点了没反应"，误判成缺陷（v678 首跑就栽在这）。 */
const scrollRight = () => p.evaluate(() => {
  const w = document.querySelector('.ipl-tbl').parentElement
  w.scrollLeft = w.scrollWidth
})
await scrollRight(); await sleep(300)

const btn = (i) => p.locator('.ipl-tbl tbody tr').nth(i).locator('.row-more-btn')
const pop = p.locator('.row-more-pop')

// ① 开 + 项数
await btn(0).click(); await sleep(250)
ok(await pop.count() === 1, '① 点 ⋯ 后菜单出现')
const items0 = await pop.locator('.row-more-mi').allInnerTexts()
ok(items0.join(',') === '打印,复制,取消', '① 草稿行 ⋯ = 打印/复制/取消（危险项排最后）', items0.join(','))
ok(await pop.getAttribute('role') === 'menu', '① 菜单 role=menu')
ok(await btn(0).getAttribute('aria-expanded') === 'true', '① 触发按钮 aria-expanded=true')

// ② 视口内 + 层级
const geo = await pop.evaluate((el) => {
  const r = el.getBoundingClientRect()
  const cs = getComputedStyle(el)
  return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, z: cs.zIndex, pos: cs.position, inVp: r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth }
})
ok(geo.inVp, '② 菜单完全在视口内', JSON.stringify(geo))
ok(geo.pos === 'fixed' && geo.z === '1101', '② fixed + z=1101（页面级菜单档）', `${geo.pos}/${geo.z}`)

// ③ 点空白关 + 再开
await p.mouse.click(700, 200); await sleep(250)
ok(await pop.count() === 0, '③ 点空白处关闭')
/* ⚠️ 重新滚一次：上面那一点如果落在可排序列的表头上，会触发 `load()` ⇒
   `v-if="loading"` 换 Skeleton ⇒ 表格重建 ⇒ `scrollLeft` 归零（探针自身的坑，不是缺陷）。
   所以每次点操作列前都要重新定位，否则量到的是"视口外"的坐标。 */
await scrollRight(); await sleep(250)
await btn(0).click(); await sleep(250)
ok(await pop.count() === 1, '③ 再点 ⋯ 能重新打开')

// ④ Esc
await p.keyboard.press('Escape'); await sleep(200)
ok(await pop.count() === 0, '④ Esc 关闭')

// ⑤ 滚动
await btn(0).click(); await sleep(200)
await p.evaluate(() => window.scrollBy(0, 40)); await sleep(300)
ok(await pop.count() === 0, '⑤ 页面滚动后自动关闭')

// ⑥ 最后一行（贴近视口底）也能完整显示；点「复制」真的跳走
await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await sleep(300)
const n = await p.locator('.ipl-tbl tbody tr').count()
await btn(n - 1).click(); await sleep(250)
const geo2 = await pop.evaluate((el) => {
  const r = el.getBoundingClientRect()
  const b = el.previousElementSibling
  return { inVp: r.top >= 0 && r.bottom <= innerHeight, bottom: Math.round(r.bottom), vh: innerHeight }
})
ok(geo2.inVp, '⑥ 贴底行的菜单也不越界（自动上翻）', JSON.stringify(geo2))
await p.evaluate(() => window.scrollTo(0, 0)); await sleep(200)

await btn(0).click(); await sleep(200)
const before = p.url()
await pop.locator('.row-more-mi', { hasText: '复制' }).click()
await sleep(900)
const after = p.url()
ok(after !== before && /purchase\/new\?copy=901/.test(after), '⑥ 菜单项「复制」真的执行（跳建单页）', after.slice(after.indexOf('#')))

// ⑦ 再点 ⋯ 自身关闭
await p.evaluate(() => { location.hash = '#/inventory/purchase' }); await sleep(1200)
await p.waitForSelector('.ipl-tbl tbody tr', { timeout: 15000 }); await scrollRight(); await sleep(300)
await btn(1).click(); await sleep(200)
const opened = await pop.count()
await btn(1).click(); await sleep(200)
ok(opened === 1 && await pop.count() === 0, '⑦ 再点 ⋯ 自身即关闭（开→关可逆）')
const items1 = await (async () => { await btn(1).click(); await sleep(200); const t = await pop.locator('.row-more-mi').allInnerTexts(); await p.keyboard.press('Escape'); return t })()
ok(items1.join(',') === '复制,退货,取消', '⑦ 已入库行 ⋯ = 复制/退货/取消（无状态动作时外面留「打印」）', items1.join(','))

console.log(out.join('\n'))
const bad = out.filter((l) => l.startsWith('❌')).length
console.log(`\n${bad ? '🔴 ' + bad + ' 条不合格' : '✅ 全部通过'}（${out.length} 条）`)
await b.close()
process.exit(bad ? 1 : 0)
