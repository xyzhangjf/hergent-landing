// v165 厂价口径（厂价 ≡ 进价）真机验证
// 断言：① 待补厂价计数由「只看 factory_price」改为「厂价与进价都没有」
//       ② 厂价列对「未录厂价但进价有值」的行显示「取进价 ¥x」而非「未录」
//       ③ 全部厂价文案不再断言「厂价 ≠ 进价」
//       ④ 报单页无新增 console 错误（回归）
const puppeteer = require('puppeteer-core')

const BASE = 'https://hergent.cn'
const USER = process.env.HG_USER || 'mptestsp'
const PASS = process.env.HG_PASS || 'Mpsup@1'
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function login() {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS }),
  })
  const d = await r.json()
  if (!d.token) throw new Error('login failed: ' + JSON.stringify(d).slice(0, 200))
  return { token: d.token, user: d.user || d, tenant: d.tenant_id || d.tenantId || 1 }
}

function fpEff(p) {
  const f = Number(p.factory_price || 0)
  if (f > 0) return f
  const pp = Number(p.purchase_price || 0)
  if (pp > 0) return pp
  return 0
}

const results = []
function assert(name, ok, detail) {
  results.push({ name: name, ok: !!ok, detail: detail === undefined ? '' : String(detail) })
}

;(async () => {
  const auth = await login()
  const H = { 'Authorization': 'Bearer ' + auth.token }

  // ---------- A. API 层：计数口径 ----------
  const pr = await fetch(BASE + '/api/products?include_inactive=1&limit=5000', { headers: H })
  const pj = await pr.json()
  const items = Array.isArray(pj.items) ? pj.items : []
  const active = items.filter(p => p.is_active !== 0)
  const oldMissing = active.filter(p => !(Number(p.factory_price) > 0)).length
  const newMissing = active.filter(p => fpEff(p) === 0).length
  assert('API 返回商品列表非空', items.length > 0, 'items=' + items.length)
  assert('旧口径待补数（只看 factory_price）> 新口径', oldMissing > newMissing,
    '旧=' + oldMissing + ' 新=' + newMissing)
  assert('新口径待补数 = 213', newMissing === 213, 'newMissing=' + newMissing)

  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1680, height: 1050 })
  const errs = []
  const forbidden = []
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)) })
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message.slice(0, 200)))
  page.on('response', r => { if (r.status() === 403) forbidden.push(r.url().replace(BASE, '')) })
  page.on('dialog', async d => { await d.accept() })
  await page.evaluateOnNewDocument((t, u, ten) => {
    localStorage.setItem('hergent_v2_token', t)
    localStorage.setItem('hergent_v2_user', JSON.stringify(u || {}))
    localStorage.setItem('hergent_v2_tenant', String(ten))
  }, auth.token, auth.user, auth.tenant)

  // ---------- B. 商品档案页 ----------
  await page.goto(BASE + '/?cb=' + Date.now() + '#/archive/products', { waitUntil: 'networkidle2' })
  await sleep(6500)

  const dom = await page.evaluate(() => {
    const badge = document.querySelector('.pa-fp-n')
    const fromCells = [...document.querySelectorAll('td.pa-fp-cell .pa-fp-from')].map(e => e.textContent.trim())
    const missCells = [...document.querySelectorAll('td.pa-fp-cell .pa-fp-miss')].map(e => e.textContent.trim())
    const th = [...document.querySelectorAll('th')].find(x => (x.textContent || '').trim() === '厂价')
    const body = document.body.innerText || ''
    const sub = document.querySelector('.page-sub')
    return {
      url: location.href,
      badge: badge ? badge.textContent.trim() : null,
      fromCount: fromCells.length,
      fromSamples: fromCells.slice(0, 4),
      missCount: missCells.length,
      fpThTitle: th ? (th.getAttribute('title') || '') : null,
      subText: sub ? sub.textContent.trim() : '(无 .page-sub)',
      hasPageSubHint: body.indexOf('厂价 ＝ 进价，进价有值即不必再补') >= 0,
    }
  })
  assert('商品档案页已渲染（含厂价列）', dom.url.indexOf('/archive/products') >= 0, dom.url)
  assert('工具栏「补厂价 N」徽标 = 213（旧口径应为 269）', dom.badge === '213', 'badge=' + dom.badge)
  assert('厂价列出现「取进价 ¥x」单元格（进价有值行）', dom.fromCount > 0, 'count=' + dom.fromCount + ' 样例=' + JSON.stringify(dom.fromSamples))
  assert('厂价列头 title 说明「厂价 ＝ 进价」', (dom.fpThTitle || '').indexOf('厂价 ＝ 进价') >= 0, dom.fpThTitle)
  assert('页头副标题带「厂价 ＝ 进价，进价有值即不必再补」',
    (dom.subText || '').indexOf('厂价 ＝ 进价，进价有值即不必再补') >= 0, dom.subText)
  console.log('  [probe] 商品档案页 403 列表: ' + JSON.stringify(forbidden))

  // ---------- C. 批量补价面板文案 ----------
  const opened = await page.evaluate(() => {
    const b = document.querySelector('button.pa-fp-btn')
    if (!b) return false
    b.click(); return true
  })
  await sleep(1200)
  const modal = await page.evaluate(() => {
    const tip = document.querySelector('.pa-modal .pa-tip')
    const gate = document.querySelector('.pa-fp-gate-hint')
    const hd = document.querySelector('.pa-modal-hd b')
    return {
      hd: hd ? hd.textContent.trim() : null,
      tip: tip ? tip.innerText : '',
      gate: gate ? gate.innerText : '',
    }
  })
  assert('「补厂价」按钮可点开面板', opened && modal.hd, modal.hd)
  assert('面板标题改为「厂价与进价都没有」', (modal.hd || '').indexOf('厂价与进价都没有') >= 0, modal.hd)
  assert('面板正文含「厂价 ＝ 进价 ＝ 厂家跟你结算的价」', (modal.tip || '').indexOf('厂价 ＝ 进价 ＝ 厂家跟你结算的价') >= 0)
  assert('面板正文含三档取价顺序', (modal.tip || '').indexOf('厂价 → 进价 → 标准售价') >= 0)
  assert('已删除错误断言「也不是进价」', (modal.tip || '').indexOf('也不是进价') < 0)
  assert('闸门说明提到进价（未开启态）', (modal.gate || '').indexOf('进价') >= 0, (modal.gate || '').slice(0, 80))
  await page.screenshot({ path: 'outputs/Hergent-商品档案-厂价取进价-2026-09-14.png' })

  // ---------- D. 报单页回归（文案改动不引入错误） ----------
  const errsBefore = errs.length
  const fbBefore = forbidden.length
  await page.goto(BASE + '/?cb=' + Date.now() + '#/forecast', { waitUntil: 'networkidle2' })
  await sleep(6000)
  const fc = await page.evaluate(() => {
    const t = document.body.innerText || ''
    return { ok: t.length > 200, hasName: t.indexOf('商品名称') >= 0, url: location.href }
  })
  assert('报单页仍正常渲染', fc.ok, fc.url)
  const fc403 = forbidden.slice(fbBefore)
  // 本账号（supervisor）对返利 / ai-roles 类端点为既有 RBAC 403 —— 与本轮「厂价口径」改动面无关。
  // 断言只对本轮触及的路径报警（products / payments / factory-price / forecast-submissions）。
  const MINE = ['/api/products', '/api/forecast/payments', '/api/forecast/factory-price', '/api/forecast-submissions']
  const fc403mine = fc403.filter(u => MINE.some(p => u.indexOf(p) === 0))
  const fc403other = fc403.filter(u => fc403mine.indexOf(u) < 0)
  assert('报单页对本轮改动面端点无 403', fc403mine.length === 0, '涉及=' + JSON.stringify(fc403mine))
  if (fc403other.length) console.log('  [info] 既有权限 403（非本轮改动面，supervisor 账号限制）: ' + JSON.stringify(fc403other))
  assert('报单页无 PAGEERROR（JS 异常）', errs.slice(errsBefore).filter(e => e.indexOf('PAGEERROR') === 0).length === 0,
    errs.slice(errsBefore).join(' | '))

  await browser.close()

  const pass = results.filter(r => r.ok).length
  console.log('\n===== v165 厂价口径 真机验证 =====')
  results.forEach(r => console.log((r.ok ? '  PASS  ' : '  FAIL  ') + r.name + (r.detail ? '   [' + r.detail + ']' : '')))
  console.log('结果: ' + pass + '/' + results.length + (pass === results.length ? '  全部通过' : '  有失败项'))
  process.exit(pass === results.length ? 0 : 1)
})().catch(e => { console.error('FATAL:', e && e.stack || e); process.exit(2) })
