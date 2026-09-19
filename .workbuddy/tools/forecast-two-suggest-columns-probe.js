const puppeteer = require('puppeteer-core')
const BASE = 'https://hergent.cn'
const sleep = ms => new Promise(r => setTimeout(r, ms))

// 凭据不入库：提审测试账号密码见 memory/topics/deploy-ops.md
// 跑法：HG_USER=mptestsp HG_PASS='<密码>' node forecast-two-suggest-columns-probe.js
const HG_USER = process.env.HG_USER || 'mptestsp'
const HG_PASS = process.env.HG_PASS
if (!HG_PASS) {
  console.error('缺少环境变量 HG_PASS（提审测试账号密码，见 memory/topics/deploy-ops.md）')
  process.exit(1)
}

async function login() {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: HG_USER, password: HG_PASS }),
  })
  const d = await r.json()
  return { token: d.token, user: d.user || d, tenant: d.tenant_id || d.tenantId || 1 }
}

function dumpTables() {
  return [...document.querySelectorAll('table')].map((t, i) => {
    const cs = getComputedStyle(t)
    const ths = [...t.querySelectorAll('thead th')].map(x => (x.innerText || '').trim()).filter(Boolean)
    const r = t.getBoundingClientRect()
    return {
      i, cls: t.className, visible: cs.display !== 'none' && r.width > 0 && r.height > 0,
      thCount: ths.length,
      hasXitong: ths.filter(s => s.includes('系统建议')),
      hasFangpei: ths.filter(s => s.includes('配方建议')),
      hasBare: ths.filter(s => s === '建议'),
      tail: ths.slice(-9),
    }
  })
}

;(async () => {
  const auth = await login()
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1600, height: 1000 })
  page.on('dialog', async d => { await d.accept() })
  await page.evaluateOnNewDocument((t, u, ten) => {
    localStorage.setItem('hergent_v2_token', t)
    localStorage.setItem('hergent_v2_user', JSON.stringify(u || {}))
    localStorage.setItem('hergent_v2_tenant', String(ten))
  }, auth.token, auth.user, auth.tenant)
  await page.goto(BASE + '/?cb=' + Date.now() + '#/forecast', { waitUntil: 'networkidle2' })
  await sleep(6000)

  const ro = await page.evaluate(dumpTables)
  console.log('=== 只读态：所有表格 ===')
  console.log(JSON.stringify(ro, null, 1))

  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => (x.innerText || '').trim().includes('改单'))
    if (b) b.click()
  })
  await sleep(4500)
  const ed = await page.evaluate(dumpTables)
  console.log('=== 编辑态：所有表格 ===')
  console.log(JSON.stringify(ed, null, 1))

  await browser.close()
})().catch(e => { console.error('FATAL', e.message); process.exit(1) })
