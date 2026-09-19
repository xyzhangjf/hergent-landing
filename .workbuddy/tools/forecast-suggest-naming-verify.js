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

;(async () => {
  const auth = await login()
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1600, height: 1000 })
  const errs = []
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message))
  page.on('dialog', async d => { await d.accept() })

  await page.evaluateOnNewDocument((t, u, ten) => {
    localStorage.setItem('hergent_v2_token', t)
    localStorage.setItem('hergent_v2_user', JSON.stringify(u || {}))
    localStorage.setItem('hergent_v2_tenant', String(ten))
  }, auth.token, auth.user, auth.tenant)

  await page.goto(BASE + '/?cb=' + Date.now() + '#/forecast', { waitUntil: 'networkidle2' })
  await sleep(6000)

  const readonly = await page.evaluate(() => {
    const txt = document.body.innerText || ''
    return {
      url: location.href,
      hasMarketText: txt.includes('配方市场'),
      hasXitongText: txt.includes('系统建议'),
      hasOldAiLabel: txt.includes('AI建议'),
      marketBtnCount: [...document.querySelectorAll('button')].filter(b => (b.innerText || '').includes('配方市场')).length,
    }
  })

  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => (x.innerText || '').trim().includes('改单'))
    if (b) b.click()
  })
  await sleep(4500)

  const grouped = await page.evaluate(() => {
    const box = [...document.querySelectorAll('button')].find(x => (x.innerText || '').trim().startsWith('工具箱'))
    if (!box) return { found: false, step: 'no-toolbox' }
    if (!document.querySelector('.tb-pop-panel')) box.click()
    return { found: true, step: 'toolbox-clicked' }
  })
  await sleep(700)
  const moreOpened = await page.evaluate(() => {
    const g = [...document.querySelectorAll('.tb-pop-panel button')].find(x => (x.innerText || '').trim() === '更多工具')
    if (!g) return { panel: !!document.querySelector('.tb-pop-panel'), labels: [...document.querySelectorAll('.tb-pop-panel button')].map(b => (b.innerText || '').trim()) }
    g.click()
    return { clicked: true }
  })
  await sleep(900)

  const groupItems = await page.evaluate(() => {
    const sug = [...document.querySelectorAll('button')].find(x => (x.innerText || '').includes('建议算法'))
    return { sugBtnFound: !!sug, sugBtnTitle: sug ? sug.getAttribute('title') : null }
  })

  let panel = null
  if (groupItems.sugBtnFound) {
    await page.evaluate(() => {
      if (!document.querySelector('.recipe-panel')) {
        const b = [...document.querySelectorAll('button')].find(x => (x.innerText || '').includes('建议算法'))
        b.click()
      }
    })
    await sleep(500)
    panel = await page.evaluate(() => {
      const p = document.querySelector('.recipe-panel')
      return p ? (p.innerText || '').replace(/\n+/g, ' / ').trim() : null
    })
  }

  const edit = await page.evaluate(() => {
    const ths = [...document.querySelectorAll('.cross-tbl.edit-tbl thead th')]
    const fp = ths.filter(t => (t.innerText || '').trim() === '配方建议')
    return {
      editGridRendered: ths.length > 0,
      thCount: ths.length,
      fangpeiCount: fp.length,
      fangpeiTitle: fp[0] ? fp[0].getAttribute('title') : null,
      bareJianyiCount: ths.filter(t => (t.innerText || '').trim() === '建议').length,
      marketTextInDom: (document.body.innerText || '').includes('配方市场'),
      suggestCellSample: [...document.querySelectorAll('.cross-tbl.edit-tbl tbody td.calc.suggest')].slice(0, 3).map(td => (td.innerText || '').replace(/\n/g, ' ').trim()),
    }
  })

  const OK = [], NG = []
  const chk = (c, l) => (c ? OK : NG).push(l)
  chk(readonly.url.includes('#/forecast'), 'URL 落在 #/forecast（未被守卫踢回登录）')
  chk(readonly.hasMarketText === false && readonly.marketBtnCount === 0, '只读态：无「配方市场」文案与按钮')
  chk(readonly.hasXitongText === true, '只读态：网格列名已是「系统建议」')
  chk(readonly.hasOldAiLabel === false, '只读态：全页已无「AI建议」')
  chk(grouped.found === true, '找到编辑态「工具箱」按钮并展开（' + grouped.step + '）')
  chk(moreOpened.clicked === true, '在工具箱面板中点开「更多工具」（' + JSON.stringify(moreOpened).slice(0, 160) + '）')
  chk(groupItems.sugBtnFound === true, '展开后「建议算法」按钮存在')
  chk(!!groupItems.sugBtnTitle && groupItems.sugBtnTitle.indexOf('系统建议') >= 0, '「建议算法」按钮 title 说明了不影响系统建议')
  chk(!!panel && panel.indexOf('只影响「配方建议」列') >= 0, '面板展开后含提示「只影响「配方建议」列」')
  chk(edit.editGridRendered && edit.thCount > 20, '点「改单」后编辑网格渲染（th = ' + edit.thCount + '）')
  chk(edit.fangpeiCount === 1, '编辑态存在且仅一个「配方建议」列')
  chk(edit.bareJianyiCount === 0, '已无裸「建议」列名')
  chk(!!edit.fangpeiTitle && edit.fangpeiTitle.indexOf('面板') >= 0, '「配方建议」列 title 说明作用域')
  chk(edit.marketTextInDom === false, '编辑态同样无「配方市场」')
  chk(errs.filter(e => !/403/.test(e)).length === 0, '无非 403 控制台错误')

  console.log('=== grouped ===')
  console.log(JSON.stringify(grouped))
  console.log('=== 原始事实 ===')
  console.log(JSON.stringify({ readonly, groupItems, panel, edit, groupOpened: grouped }, null, 2))
  console.log('=== 断言 ===')
  OK.forEach(s => console.log('  ok   ' + s))
  NG.forEach(s => console.log('  FAIL ' + s))
  console.log('断言数 ' + (OK.length + NG.length) + ' / 通过 ' + OK.length)
  console.log('CONSOLE_ERRORS:', JSON.stringify(errs.filter(e => !/403/.test(e)).slice(0, 8)))
  try {
    await page.evaluate(() => {
      const w = document.querySelector('.edit-grid-wrap')
      if (w) w.scrollIntoView({ block: 'center' })
    })
    await sleep(400)
    await page.screenshot({ path: '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/Hergent-报单两列改名-编辑态-2026-09-14.png' })
    console.log('shot ok')
  } catch (e) { console.log('shot fail ' + e.message) }
  await browser.close()
  process.exit(NG.length ? 1 : 0)
})().catch(e => { console.error('FATAL', e.message); process.exit(2) })
