/**
 * v713b —— 主脚本没覆盖的两个场景
 *
 * ① 「全被停用」的空态：5 个零停用页面自然触发不到，必须造数据。
 *    用**只读的 fetch 桩**（只改前端拿到的响应，不写库），验证：
 *      · 不会谎报「还没有品牌」（数据在，只是被收起）
 *      · 文案带计数，且就地按钮真的能把它们放出来
 *    🔴 桩必须用 `page.addInitScript` 注入 —— 用 `page.eval` 会在 `Page.reload` 时被重置，
 *       而请求在 reload 后立刻发出，来不及再装一次（v713 首版就是这么假失败的）。
 * ② 外观截图：确认开关在筛选行里不突兀、与相邻控件同一水平线。
 */
import { launch } from './lib/cdp-lite.mjs'

const TOKEN = process.env.HG_TOKEN
const BASE = 'https://hergent.cn'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const FAIL = []
const check = (l, c, e = '') => { console.log((c ? '  ✅ ' : '  ❌ ') + l + (e ? '  ' + e : '')); if (!c) FAIL.push(l) }

const b = await launch({ headless: true })
const page = await b.newPage()
await page.enable()
await page.goto(BASE + '/login', 3200)
for (const c of [
  { name: 'erp_token', value: TOKEN, httpOnly: true },
  { name: 'hergent_auth', value: '1' },
  { name: 'csrf_token', value: 'x' },
  { name: 'hergent_tenant', value: '1' },
]) await page.raw.send('Network.setCookie', { ...c, domain: 'hergent.cn', path: '/', secure: true, sameSite: 'Lax' })

/* ═══════ ① 全停用空态：品牌档案（把每条 is_active 改成 0） ═══════ */
console.log('\n══════ ① 全停用空态（品牌档案，fetch 桩） ══════')

const stub = `
(() => {
  const orig = window.fetch
  window.__stubHit = 0
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || ''
    /* 只拦**主列表**：/api/brands 与 /api/brands?include_inactive=1；
       不拦 /api/brands/pending（待审队列是另一件事）。 */
    if (/\\/api\\/brands(\\?|$)/.test(url)) {
      return orig.apply(this, arguments).then(async (res) => {
        let data
        try { data = await res.clone().json() } catch (_) { return res }
        const arr = Array.isArray(data) ? data : (data && data.items) || null
        if (!arr || !arr.length) return res
        window.__stubHit++
        /* 🔴 只读：改的是**这次响应**里的字段，不写数据库 */
        arr.forEach(x => { x.is_active = 0 })
        return new Response(JSON.stringify(Array.isArray(data) ? arr : { ...data, items: arr }),
          { status: 200, headers: { 'Content-Type': 'application/json' } })
      })
    }
    return orig.apply(this, arguments)
  }
})()`

const sid = await page.addInitScript(stub)
await page.raw.send('Page.navigate', { url: BASE + '/#/archive/brands' })
await sleep(8000)

const hits = await page.eval('window.__stubHit || 0')
check('桩生效（/api/brands 响应被替换）', hits > 0, 'hit=' + hits)

const empty = await page.eval(`(() => {
  const body = (document.body.innerText || '')
  const btn = [...document.querySelectorAll('.lnk-btn')].find(e => /显示已停用/.test(e.textContent))
  const r = btn ? btn.getBoundingClientRect() : null
  return {
    caught: /当前没有启用中的品牌/.test(body),
    lie: /还没有品牌/.test(body),
    hasCount: /（\\d+ 个已停用，已收起）/.test(body),
    toggleShown: !!document.querySelector('.tb-toggle'),
    rows: [...document.querySelectorAll('.tbl tbody tr')].length,
    btn: r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null,
    btnStyle: btn ? (() => { const cs = getComputedStyle(btn); return { fd: cs.textDecorationLine, bd: cs.borderTopWidth, bg: cs.backgroundColor } })() : null,
    snippet: body.replace(/\\s+/g, ' ').match(/当前没有启用中的品牌[^。]{0,40}/),
  }
})()`)
console.log('   空态文案:', empty.snippet ? empty.snippet[0] : '(未匹配)')
console.log('   列表行数:', empty.rows)

check('空态说「当前没有启用中的品牌」（不谎报）', empty.caught === true, '')
check('没有误报「还没有品牌」', empty.lie === false, '')
check('文案带计数（N 个已停用，已收起）', empty.hasCount === true, '')
check('空态里给了就地入口按钮', empty.btn !== null, '')
if (empty.btnStyle) {
  console.log('   按钮样式:', JSON.stringify(empty.btnStyle))
  check('就地按钮是文字链接样式（有下划线、无边框、无背景）',
    /underline/.test(empty.btnStyle.fd) && empty.btnStyle.bd === '0px',
    JSON.stringify(empty.btnStyle))
}

/* 点就地按钮 → 4 条应全部出现（数据一直在内存里，只是被过滤） */
if (empty.btn) {
  await page.raw.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(empty.btn.x), y: Math.round(empty.btn.y) })
  await page.raw.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(empty.btn.x), y: Math.round(empty.btn.y), button: 'left', clickCount: 1 })
  await page.raw.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(empty.btn.x), y: Math.round(empty.btn.y), button: 'left', clickCount: 1 })
  await sleep(1300)
  const after = await page.eval(`(() => {
    const trs = [...document.querySelectorAll('.tbl tbody tr')].filter(t => !t.querySelector('td.empty'))
    const el = document.querySelector('.tb-toggle')
    return { rows: trs.length, toggleOn: el ? el.classList.contains('on') : null }
  })()`)
  check('点就地按钮后 4 个品牌全部出现', after.rows === 4, 'rows=' + after.rows)
  check('此时开关同步变为已展开态', after.toggleOn === true, 'on=' + after.toggleOn)
}

await page.removeInitScript(sid)

/* ═══════ ② 外观：商品档案筛选行里的开关 ═══════ */
console.log('\n══════ ② 外观（商品档案筛选行） ══════')
await page.raw.send('Page.navigate', { url: BASE + '/#/archive/products' })
await sleep(8500)

const shot = await page.eval(`(() => {
  const box = document.querySelector('.pa-filters')
  if (!box) return null
  const r = box.getBoundingClientRect()
  const el = [...document.querySelectorAll('.tb-toggle')].find(e => /显示已停用/.test(e.textContent) && e.getBoundingClientRect().width > 10)
  if (!el) return { noToggle: true }
  const ir = el.getBoundingClientRect()
  /* 与相邻的 .btn（重置）比顶边，确认同一水平线 */
  const btn = [...box.querySelectorAll('.btn')].find(e => e.getBoundingClientRect().width > 10)
  const br = btn ? btn.getBoundingClientRect() : null
  return {
    clip: { x: Math.max(0, r.left - 8), y: Math.max(0, r.top - 8), width: Math.min(r.width + 16, 1400), height: Math.max(20, r.height + 16), scale: 2 },
    toggle: { top: +ir.top.toFixed(1), h: +ir.height.toFixed(1), text: el.textContent.trim() },
    btn: br ? { top: +br.top.toFixed(1), h: +br.height.toFixed(1) } : null,
  }
})()`)

if (shot && shot.toggle && shot.btn) {
  console.log('   开关:', JSON.stringify(shot.toggle), ' 相邻按钮:', JSON.stringify(shot.btn))
  check('与相邻按钮顶边对齐（差 ≤ 1px）', Math.abs(shot.toggle.top - shot.btn.top) <= 1, 'Δ' + Math.abs(shot.toggle.top - shot.btn.top).toFixed(2))
  check('与相邻按钮等高（差 ≤ 1px）', Math.abs(shot.toggle.h - shot.btn.h) <= 1, 'Δ' + Math.abs(shot.toggle.h - shot.btn.h).toFixed(2))
  const out = await page.screenshot('/tmp/hgv713-filters.png', { clip: shot.clip })
  console.log(out ? '   ✅ 截图已落盘 /tmp/hgv713-filters.png' : '   ❌ 截图返回空串（clip 少 scale？）')
  if (!out) FAIL.push('截图未落盘')
} else {
  console.log('   ⚠️ 未取到筛选行几何:', JSON.stringify(shot))
  FAIL.push('筛选行几何未取到')
}

console.log('\n' + '='.repeat(56))
if (FAIL.length) { console.log('FAILED ' + FAIL.length + ' 项：'); FAIL.forEach(x => console.log('  · ' + x)) }
else console.log('RESULT: ALL PASS')
console.log('='.repeat(56))
await b.close()
process.exit(FAIL.length ? 1 : 0)
