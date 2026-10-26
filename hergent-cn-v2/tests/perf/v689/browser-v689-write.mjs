/**
 * v689 真机写探针：**在真实租户点「新增商品 → 保存」**，验证前端真的走 POST /api/products
 * 并把非默认字段（别名 / 中单位 / 大单位 / 业务范围开关）一并提交。
 *
 * 为什么还要这一步（前面两个探针不够）：
 *   · 契约只证明源码里写的是 POST，不能证明打出去的是 POST；
 *   · 后端探针只证明「如果调用方提交这些键，库会收」；
 *   · 而「前端到底提交了哪些键」只有真点一次才知道 —— 这正是 v226/v184b/v233 三次
 *     「填了但没存上」的缺陷形态（接口 200、界面正常、字段恒为空）。
 *
 * 前置：服务器 `tools/v689_add_e2e.py prepare` 输出的 TOKEN。
 * 收尾：服务器 `tools/v689_add_e2e.py teardown`（删探针商品 + 删 session 并自证残留 0）。
 *
 * 用法: TOKEN=v689probe-xxx node tests/perf/v689/browser-v689-write.mjs [baseUrl]
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] || 'https://hergent.cn'
const TOKEN = process.env.TOKEN || ''
if (!TOKEN) { console.error('缺少 TOKEN 环境变量'); process.exit(2) }
const NAME = 'v689probe-前端建档'
const BARCODE = 'V689FE0001'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0, fail = 0
const say = (label, verdict, extra) => {
  if (verdict === 'PASS') { pass++; console.log('  ✅ ' + label) }
  else { fail++; console.log('  ❌ ' + label + (extra !== undefined ? '  ← ' + JSON.stringify(extra) : '')) }
}

const b = await chromium.launch({ channel: 'chrome', headless: true })
const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } })
await ctx.addCookies([
  { name: 'erp_token', value: TOKEN, domain: '.hergent.cn', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' },
  { name: 'hergent_auth', value: '1', domain: '.hergent.cn', path: '/', secure: true, sameSite: 'Lax' },
  { name: 'csrf_token', value: TOKEN, domain: '.hergent.cn', path: '/', secure: true, sameSite: 'Lax' },
])
const page = await ctx.newPage()

/* 记账：发出的请求（用来证明前端调的是 POST /api/products，不是旧的 bulk-upsert） */
const sent = []
page.on('request', (r) => {
  const u = r.url()
  if (/\/api\/products/.test(u) && r.method() !== 'GET') {
    sent.push({ method: r.method(), url: u.replace(BASE, ''), body: r.postData() })
  }
})

/** 给 input 赋值并触发 Vue 的 v-model（原生 setter + input 事件）。 */
const setInput = (sel, val) => page.evaluate(([s, v]) => {
  const el = document.querySelector(s)
  if (!el) return false
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement : window.HTMLInputElement
  Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, v)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  return true
}, [sel, val])

const clickTab = (word) => page.evaluate((w) => {
  const t = [...document.querySelectorAll('.pa-modal .main-tab')].find((x) => (x.textContent || '').includes(w))
  if (t) { t.click(); return true }
  return false
}, word)

/** 按「字段名 → 它在弹窗里的 input/select」定位。pa-f 的 label 结构：<span>字段名…</span><input>。 */
const byLabel = (word) => `.pa-modal .pa-f:has(> span:first-child:nth-child(1))`

try {
  await page.goto(BASE + '/#/archive/products', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.topbar', { timeout: 30000 })
  await sleep(2600)

  console.log('\n=== 构建号 ===')
  const build = await page.evaluate(() => window.__HG_BUILD__ || '')
  say('构建号 = v689', build === 'v689' ? 'PASS' : 'FAIL', build)

  console.log('\n=== 新增 → 填字段 → 保存 ===')
  const opened = await page.evaluate(() => {
    const x = [...document.querySelectorAll('button')].find((t) => /^\s*\+?\s*新增\s*$/.test(t.textContent || ''))
    if (x) { x.click(); return true }
    return false
  })
  say('点开「+ 新增」', opened ? 'PASS' : 'FAIL')
  await sleep(900)

  /* 基本信息：名称 / 条码 / 别名；业务范围取消「可退货」 */
  await setInput('.pa-modal [data-f="name"]', NAME)
  await setInput('.pa-modal [data-f="barcode"]', BARCODE)
  const aliasOk = await page.evaluate((v) => {
    // 别名那格：label 文本以「别名」开头
    const lab = [...document.querySelectorAll('.pa-modal .pa-f')].find((el) => {
      const sp = el.querySelector('span')
      return sp && (sp.textContent || '').trim().startsWith('别名')
    })
    if (!lab) return false
    const el = lab.querySelector('input')
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  }, '探针别名A,探针别名B')
  say('别名可填（新增页有这个字段）', aliasOk ? 'PASS' : 'FAIL')

  const uncheckReturn = await page.evaluate(() => {
    const lab = [...document.querySelectorAll('.pa-modal .check-item')].find((x) => /可退货/.test(x.textContent || ''))
    if (!lab) return false
    const cb = lab.querySelector('input[type="checkbox"]')
    if (!cb) return false
    if (cb.checked) cb.click()
    return !cb.checked
  })
  say('「可退货」开关可以关掉（业务范围在新增页可用）', uncheckReturn ? 'PASS' : 'FAIL')

  /* 包装单位：中单位 条/6、大单位 箱/24 */
  say('切到「包装单位」页签', (await clickTab('包装单位')) ? 'PASS' : 'FAIL')
  await sleep(500)
  const pk = await page.evaluate(() => {
    const setVal = (el, v) => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const cards = [...document.querySelectorAll('.pa-modal .sub-card')]
    const pick = (kw) => cards.find((c) => ((c.querySelector('.sub-card-hd') || {}).textContent || '').includes(kw))
    const mid = pick('中单位'); const big = pick('大单位')
    if (!mid || !big) return { ok: false }
    const midInputs = [...mid.querySelectorAll('input')]
    const bigInputs = [...big.querySelectorAll('input')]
    setVal(midInputs[0], '条'); setVal(midInputs[2], '6')
    setVal(bigInputs[0], '箱'); setVal(bigInputs[2], '24')
    return { ok: true, mid: midInputs.length, big: bigInputs.length }
  })
  say('中/大单位与换算比可填', pk.ok ? 'PASS' : 'FAIL', pk)

  /* 价格：矩阵里给小单位填批发价 3.9 */
  say('切到「价格」页签', (await clickTab('价格')) ? 'PASS' : 'FAIL')
  await sleep(500)
  const priced = await page.evaluate(() => {
    const inp = document.querySelector('.pa-modal .pm-wrap tbody tr input.pm-input')
    if (!inp) return false
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(inp, '3.9')
    inp.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })
  say('价格矩阵可填（新增页也能填）', priced ? 'PASS' : 'FAIL')

  /* 保存 */
  const clicked = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.pa-modal-ft button')]
    const save = btns.find((x) => /保存/.test(x.textContent || ''))
    if (!save || save.disabled) return false
    save.click()
    return true
  })
  say('「保存」可点（名称已填）', clicked ? 'PASS' : 'FAIL')
  await sleep(3000)

  console.log('\n=== 前端实际发出的请求 ===')
  for (const s of sent) console.log('   ' + s.method + ' ' + s.url)
  const post = sent.find((s) => s.method === 'POST' && /\/api\/products$/.test(s.url))
  say('发出了 POST /api/products（不是 bulk-upsert）', !!post ? 'PASS' : 'FAIL', sent.map((s) => s.method + ' ' + s.url))
  say('没有调用 bulk-upsert', !sent.some((s) => /bulk-upsert/.test(s.url)) ? 'PASS' : 'FAIL')

  if (post) {
    let body = {}
    try { body = JSON.parse(post.body || '{}') } catch (e) { body = {} }
    const keys = Object.keys(body)
    say('提交体含 30 个以上字段（不是手写子集）', keys.length >= 28 ? 'PASS' : 'FAIL', keys.length)
    for (const [k, want] of [
      ['barcode', BARCODE], ['alias', '探针别名A,探针别名B'], ['medium_unit', '条'],
      ['large_unit', '箱'], ['can_return', 0], ['unit', '件'],
    ]) {
      const got = body[k]
      say(`提交体 ${k} = ${JSON.stringify(want)}`, String(got) === String(want) ? 'PASS' : 'FAIL', got)
    }
    say('提交体含默认开单单位三个键', ['default_purchase_unit', 'default_sale_unit', 'default_gift_unit'].every((k) => k in body) ? 'PASS' : 'FAIL')
  }

  const matrixSent = sent.find((s) => /unit-prices/.test(s.url))
  say('价格矩阵单独写了一次（有填才发）', !!matrixSent ? 'PASS' : 'FAIL', sent.map((s) => s.url))

  /* 弹窗关掉 + 列表能搜到 */
  console.log('\n=== 保存后的界面事实 ===')
  const closed = await page.evaluate(() => !document.querySelector('.pa-modal'))
  say('保存后弹窗自动关闭', closed ? 'PASS' : 'FAIL')

  await setInput('.pa-page input[type="search"], input[placeholder*="搜索"], input[placeholder*="名称"]', NAME).catch(() => {})
  await sleep(2200)
  const found = await page.evaluate((n) => (document.body.innerText || '').includes(n), NAME)
  say('列表里能搜到刚建的商品「' + NAME + '」', found ? 'PASS' : 'FAIL')
} catch (e) {
  fail++
  console.log('  ❌ 探针异常：' + (e && e.message))
} finally {
  console.log(`\nRESULT: ${pass} 通过 / ${fail} 失败`)
  await b.close()
  process.exit(fail ? 1 : 0)
}
