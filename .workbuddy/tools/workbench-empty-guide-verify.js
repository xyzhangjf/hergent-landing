/**
 * 工作台「空账套导入引导」真机验证（打生产 hergent.cn）
 *
 * 为什么要两条用例（缺一不可）：
 *   A. 空白租户   → 引导卡**必须出现**（这是本次改动要交付的效果）
 *   B. 有数据租户 → 引导卡**必须不出现**（这是本次改动最大的风险：误报会让天天看
 *      工作台的老客户看到"还没有数据？"，比不加引导更糟）
 * 判据用 .import-guide 是否存在 + computedStyle 可见性（不是肉眼截图）。
 *   注意：不能用 offsetParent 判可见（fixed 元素恒 null）。
 */
const puppeteer = require('puppeteer-core')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = 'https://hergent.cn'
const OUT = process.env.OUT || '/tmp/wb-verify'

const PASS = [], FAIL = []
function check(name, ok, detail) {
  ;(ok ? PASS : FAIL).push(name)
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
}

async function tokenLogin(u, p) {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u, password: p }),
  })
  const d = await r.json().catch(() => ({}))
  return d.token || ''
}
async function tokenDemo() {
  const r = await fetch(BASE + '/api/auth/demo-login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  })
  const d = await r.json().catch(() => ({}))
  return d.token || ''
}

async function probe(browser, label, token) {
  const page = await browser.newPage()
  const errs = [], bad = []
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message))
  page.on('response', r => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url().replace(BASE, '')) })

  await page.evaluateOnNewDocument((t) => {
    localStorage.setItem('hergent_v2_token', t)
    localStorage.setItem('hergent_v2_user', JSON.stringify({ username: 'probe' }))
  }, token)
  await page.goto(`${BASE}/?cb=${Date.now()}#/workbench`, { waitUntil: 'networkidle2', timeout: 60000 })
  await new Promise(r => setTimeout(r, 6500))

  const info = await page.evaluate(async () => {
    const el = document.querySelector('.import-guide')
    const t = (s) => (document.querySelector(s)?.innerText || '').replace(/\s+/g, ' ').trim()
    // 在页面上下文里复算判据的每个输入（同源直调接口），定位到底哪个条件不成立
    let diag = {}
    try {
      const tok = localStorage.getItem('hergent_v2_token') || ''
      const h = { Authorization: 'Bearer ' + tok }
      const ra = await (await fetch('/api/dashboard/recent-actions?limit=5', { headers: h })).json().catch(() => null)
      const tp = await (await fetch('/api/dashboard/today-profit', { headers: h })).json().catch(() => null)
      const ex = await (await fetch('/api/batch/expiry-scan?warehouse_id=0', { headers: h })).json().catch(() => null)
      const exItems = ex ? (ex.items || [...(ex.expired || []), ...(ex.near || []), ...(ex.warning || [])]) : null
      const td = await (await fetch('/api/today', { headers: h })).json().catch(() => null)
      diag = {
        recentActions_isArray: Array.isArray(ra),
        recentActions_len: Array.isArray(ra) ? ra.length : null,
        recentActions_sample: Array.isArray(ra) ? ra.slice(0, 2) : ra,
        profit: tp ? { sales: tp.sales, orders: tp.orders, payment: tp.payment, profit: tp.profit } : null,
        expiry_len: exItems ? exItems.length : null,
        todayCards_len: td ? (td.cards || []).length : null,
      }
    } catch (e) { diag = { err: String(e).slice(0, 160) } }
    return {
      hash: location.hash,
      hasGuide: !!el,
      guideVisible: el ? getComputedStyle(el).display !== 'none' : false,
      guideTitle: t('.ig-title'),
      pickLabel: t('.ig-pick'),
      kpis: [...document.querySelectorAll('.kpi-val')].map(e => e.textContent.trim()),
      fileInput: document.querySelectorAll('.import-guide input[type=file]').length,
      panelHdrs: [...document.querySelectorAll('.panel-hd b')].map(e => e.textContent.trim()),
      diag,
    }
  })
  await page.screenshot({ path: `${OUT}/wb-${label}.png`, fullPage: true })
  console.log(`\n--- ${label} ---`)
  console.log(JSON.stringify(info, null, 2))
  console.log('非 2xx:', JSON.stringify([...new Set(bad)].slice(0, 8)))
  console.log('console 错误:', JSON.stringify(errs.filter(e => !/403/.test(e)).slice(0, 5)))
  await page.close()
  return info
}

;(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })

  // ── A. 有数据租户（tenant 1，mptest/sales）→ 引导卡必须不出现
  const tOk = await tokenLogin('mptest', 'Mptest@1')
  check('取到 mptest token（tenant 1）', !!tOk, tOk ? `len ${tOk.length}` : '登录失败')
  if (tOk) {
    const a = await probe(browser, 'tenant1-with-data', tOk)
    check('A 未被踢回登录页', !a.hash.includes('login'), a.hash)
    check('A 工作台已渲染（KPI 条存在）', a.kpis.length >= 4, `kpis=${JSON.stringify(a.kpis)}`)
    check('A 【关键】有数据租户不显示导入引导卡', a.hasGuide === false,
      a.hasGuide ? `误报！标题="${a.guideTitle}"` : '正确：未出现')
  }

  // ── B. 真正的空账套：**现场注册一个全新租户**（用自测码）。
  //    注意别拿 demo 租户当"空账套"—— demo(tenant_10) 其实有数据（10 条近效期预警），
  //    实测它不会触发引导卡。本次改动的目标场景恰恰是"刚注册、什么都没导入"的租户。
  // 凭据不入库：邀请码与测试租户密码均从环境变量取（见 memory/topics/deploy-ops.md）
  // 跑法：INVITE='<联调码>' HG_TEST_PW='<任意≥8位>' node workbench-empty-guide-verify.js
  const INVITE = process.env.INVITE
  const TPW = process.env.HG_TEST_PW
  if (!INVITE || !TPW) {
    console.error('需要环境变量 INVITE 与 HG_TEST_PW（见 memory/topics/deploy-ops.md）')
    process.exit(1)
  }
  const stamp = Date.now().toString().slice(-6)
  const company = 'ZZ工作台引导' + stamp
  let reg = {}
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch(BASE + '/api/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company, phone: '131' + String(Date.now()).slice(-8),
        password: TPW, invite_code: INVITE,
      }),
    })
    reg = await r.json().catch(() => ({}))
    if (r.status === 200 && reg.token) break
    if (String(reg.detail || reg.message || '').includes('频繁')) {
      console.log('  · 命中 60s 注册限流，等 65s 重试…')
      await new Promise(r2 => setTimeout(r2, 65000))
      continue
    }
    break
  }
  check('现场注册空白租户 → 200', !!reg.token,
    reg.token ? `tenant_id=${reg.tenant_id} user=${(reg.user || {}).username}` : JSON.stringify(reg).slice(0, 160))
  if (reg.token) console.log(`   ↳ 待清理：tenant_id=${reg.tenant_id} username=${(reg.user || {}).username} company=${company}`)
  if (reg.token) {
    const b = await probe(browser, 'fresh-empty-tenant', reg.token)
    check('B 未被踢回登录页', !b.hash.includes('login'), b.hash)
    check('B 【关键】空账套显示导入引导卡', b.hasGuide && b.guideVisible,
      `hasGuide=${b.hasGuide} visible=${b.guideVisible} 标题="${b.guideTitle}"`)
    check('B 引导卡带真实文件选择控件', b.fileInput === 1, `fileInput=${b.fileInput}`)
    check('B 按钮文案提到 Excel', /Excel/.test(b.pickLabel), `"${b.pickLabel}"`)
    check('B 空账套 KPI 全 0', b.kpis.every(v => /^(¥?0|0)$/.test(v)), JSON.stringify(b.kpis))
  }

  await browser.close()
  console.log(`\n通过 ${PASS.length} / 共 ${PASS.length + FAIL.length}`)
  if (FAIL.length) { console.log('失败项:', FAIL.join(' | ')); process.exit(1) }
})()
