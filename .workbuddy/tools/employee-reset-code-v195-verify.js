// 真机验证：员工档案「生成重置码」（Q29 小程序忘记密码通道）
// 目标：证明新按钮在真实生产页面渲染、可点、调对接口、能展示与复制码
// 租户：隔离沙箱 9997（克隆 tenant_1）—— 生产 tenant_1 零写入
const puppeteer = require('puppeteer-core')

const TOKEN = process.env.SB_TOKEN
const TENANT = process.env.SB_TENANT || '9997'
const SB_UID = process.env.SB_UID || '999879'
const OUT = process.env.HG_OUT || '/tmp'

const ok = []
const A = (name, cond, extra) => {
  ok.push({ name, pass: !!cond, extra: extra === undefined ? '' : extra })
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (extra !== undefined ? '  ' + extra : ''))
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

;(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--no-proxy-server'],
  })
  const page = await browser.newPage()
  // ⚠️ 剪贴板权限必须走 CDP `Browser.grantPermissions`。
  //    `browser.defaultBrowserContext().overridePermissions(...)` 在 headless='new'
  //    下**静默不生效**（实测 `permissions.query` 仍为 denied）⇒ 复制会稳定报
  //    「复制失败，请手动记录：xxxxxx」，看着像产品缺陷，实为探针环境问题。
  const cdp = await page.target().createCDPSession()
  await cdp.send('Browser.grantPermissions', {
    origin: 'https://hergent.cn',
    permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
  })
  await page.setViewport({ width: 1560, height: 1000, deviceScaleFactor: 2 })

  const consoleErrs = []
  const pageErrs = []
  page.on('console', async m => {
    if (m.type() !== 'error') return
    const parts = []
    for (const a of m.args()) {
      try { parts.push(await a.evaluate(e => (e && e.stack) || (e && e.message) || String(e))) }
      catch (_) { parts.push('?') }
    }
    consoleErrs.push(parts.join(' | '))
  })
  page.on('pageerror', e => pageErrs.push(String(e && e.message || e)))

  const posts = []
  page.on('response', async r => {
    const u = r.url()
    if (u.includes('/api/users/') && u.includes('/reset-code')) {
      let body = ''
      try { body = await r.text() } catch (_) {}
      posts.push({ url: u, status: r.status(), body })
    }
  })

  // ⚠️ 必须在 goto 之前注入（文档脚本执行前）
  await page.evaluateOnNewDocument((t, ten) => {
    localStorage.setItem('hergent_v2_token', t)
    localStorage.setItem('hergent_v2_tenant', String(ten))
  }, TOKEN, TENANT)

  await page.goto('https://hergent.cn/?cb=' + Date.now() + '#/archive/employees',
    { waitUntil: 'networkidle2' })
  await sleep(3500)

  // ── A. 页面落地 ───────────────────────────────────────────────
  const url = page.url()
  A('A0 落地在 /archive/employees（未被守卫踢回登录页）', url.includes('#/archive/employees'), url)

  const state = await page.evaluate(() => {
    const txt = s => { const e = document.querySelector(s); return e ? e.textContent.trim() : null }
    const rows = [...document.querySelectorAll('tbody tr')]
      .filter(tr => tr.querySelector('td'))
    const accRow = rows.find(tr => /管理员/.test(tr.textContent))
    const editBtn = accRow
      ? [...accRow.querySelectorAll('button')].find(b => b.textContent.replace(/\s+/g, '') === '编辑')
      : null
    return {
      rowCount: rows.length,
      accBadge: accRow ? (accRow.textContent.match(/已开通\s*\S+/) || [''])[0] : '',
      hasEditBtn: !!editBtn,
      tabs: [...document.querySelectorAll('.module-tabs button')].map(b => b.textContent.trim()),
      bodyHead: document.body.innerText.slice(0, 120),
    }
  })
  A('A1 员工表加载出 7 行', state.rowCount === 7, 'rows=' + state.rowCount)
  A('A2 「管理员」行显示「已开通 sbx_verify」徽标', /已开通\s*sbx_verify/.test(state.accBadge), state.accBadge)
  A('A3 「管理员」行有「编辑」按钮', state.hasEditBtn)

  // ── B. 打开编辑弹窗 → 账号区 ─────────────────────────────────
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('tbody tr')].filter(tr => tr.querySelector('td'))
    const r = rows.find(tr => /管理员/.test(tr.textContent))
    const b = [...r.querySelectorAll('button')].find(x => x.textContent.replace(/\s+/g, '') === '编辑')
    b.click()
  })
  await sleep(900)

  const acc = await page.evaluate(() => {
    const modal = document.querySelector('.df-modal.edit-modal')
    if (!modal) return { modal: false }
    const secs = [...modal.querySelectorAll('.df-sec')]
    const s2 = secs.find(s => /小程序账号/.test(s.textContent))
    if (!s2) return { modal: true, sec: false }
    const btns = [...s2.querySelectorAll('button')].map(b => ({
      t: b.textContent.replace(/\s+/g, ''), disabled: b.disabled,
      visible: !!(b.getBoundingClientRect().width > 0),
    }))
    const gen = [...s2.querySelectorAll('button')]
      .find(b => b.textContent.replace(/\s+/g, '') === '生成重置码')
    const tip = s2.querySelector('.rc-tip')
    return {
      modal: true, sec: true,
      title: (modal.querySelector('.df-modal-hd b') || {}).textContent,
      sum: (s2.querySelector('.df-acc-sum') || {}).textContent,
      btns,
      hasGen: !!gen,
      genDisabled: gen ? gen.disabled : null,
      genVisible: gen ? gen.getBoundingClientRect().width > 0 : null,
      tipText: tip ? tip.textContent.trim() : null,
      rcBoxNow: s2.querySelectorAll('.rc-box').length,
    }
  })
  A('B1 编辑弹窗已打开', acc.modal)
  A('B2 弹窗标题为「编辑员工 · 管理员」', /编辑员工\s*·\s*管理员/.test(acc.title || ''), acc.title)
  A('B3 「小程序账号」区已渲染', acc.sec)
  A('B4 账号摘要显示 sbx_verify + 启用中', /sbx_verify/.test(acc.sum || '') && /启用中/.test(acc.sum || ''), (acc.sum || '').trim())
  A('C1 存在「生成重置码」按钮', acc.hasGen)
  A('C2 该按钮可见且未被禁用（account_active=true）', acc.genVisible === true && acc.genDisabled === false,
    'visible=' + acc.genVisible + ' disabled=' + acc.genDisabled)
  A('C3 旁注文案为「线下发给员工 · 30 分钟内有效 · 用一次即废」',
    acc.tipText === '线下发给员工 · 30 分钟内有效 · 用一次即废', JSON.stringify(acc.tipText))
  A('C4 尚未生成时无结果框（.rc-box 不存在）', acc.rcBoxNow === 0, 'rcBox=' + acc.rcBoxNow)

  await page.screenshot({ path: OUT + '/01-编辑弹窗-账号区（生成前）.png' })

  // ── D. 点击生成 → 真实接口 ───────────────────────────────────
  await page.evaluate(() => {
    const s2 = [...document.querySelectorAll('.df-modal.edit-modal .df-sec')]
      .find(s => /小程序账号/.test(s.textContent))
    const b = [...s2.querySelectorAll('button')]
      .find(x => x.textContent.replace(/\s+/g, '') === '生成重置码')
    b.click()
  })

  // toast 只活 3 秒 → 点击后立刻轮询
  let toastTxt = null
  for (let i = 0; i < 40; i++) {
    toastTxt = await page.evaluate(() => {
      const t = document.querySelector('.toast, .hg-toast, [class*="toast"]')
      return t ? t.textContent.trim() : null
    })
    if (toastTxt) break
    await sleep(100)
  }
  await sleep(600)

  A('D1 点击后发出 1 次 POST /reset-code 且返回 200',
    posts.length === 1 && posts[0].status === 200,
    posts.map(p => p.status + ' ' + p.url).join(',') || '无请求')
  A('D2 请求路径精确指向沙箱账号 uid=' + SB_UID,
    posts.length > 0 && posts[0].url.includes('/api/users/' + SB_UID + '/reset-code'),
    posts.length ? posts[0].url : '')
  let code = ''
  try { code = JSON.parse(posts[0].body).code || '' } catch (_) {}
  A('D3 响应体含 6 位数字重置码', /^\d{6}$/.test(code), 'code=' + code)

  const shown = await page.evaluate(() => {
    const s2 = [...document.querySelectorAll('.df-modal.edit-modal .df-sec')]
      .find(s => /小程序账号/.test(s.textContent))
    const b = s2.querySelector('.rc-box')
    return {
      hasBox: !!b,
      code: b ? (b.querySelector('.rc-code') || {}).textContent : null,
      exp: b ? (b.querySelector('.rc-exp') || {}).textContent : null,
      copyBtn: b ? [...b.querySelectorAll('button')].map(x => x.textContent.replace(/\s+/g, '')) : [],
    }
  })
  A('D4 结果框 .rc-box 出现', shown.hasBox)
  A('D5 展示的码与接口返回**逐字一致**', shown.code === code, 'ui=' + shown.code + ' api=' + code)
  A('D6 有效期文案含「前有效」', /前有效/.test(shown.exp || ''), JSON.stringify(shown.exp))
  A('D7 结果框带「复制」按钮', (shown.copyBtn || []).includes('复制'), JSON.stringify(shown.copyBtn))
  A('D8 生成成功 toast = 「重置码已生成，请线下发给本人」',
    toastTxt === '重置码已生成，请线下发给本人', JSON.stringify(toastTxt))

  await page.screenshot({ path: OUT + '/02-编辑弹窗-账号区（已生成重置码）.png' })

  // ── E. 复制按钮 ──────────────────────────────────────────────
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.df-modal.edit-modal .rc-box button')]
      .find(x => x.textContent.replace(/\s+/g, '') === '复制')
    b.click()
  })
  await sleep(500)
  let clip = null
  try { clip = await page.evaluate(() => navigator.clipboard.readText()) } catch (e) { clip = 'READ_ERR:' + e.message }
  let toast2 = null
  for (let i = 0; i < 30; i++) {
    toast2 = await page.evaluate(() => {
      const t = document.querySelector('.toast, .hg-toast, [class*="toast"]')
      return t ? t.textContent.trim() : null
    })
    if (toast2 && /复制/.test(toast2)) break
    await sleep(100)
  }
  A('E1 点「复制」后剪贴板内容 == 重置码', clip === code, 'clip=' + clip)
  A('E2 复制 toast = 「已复制重置码」', toast2 === '已复制重置码', JSON.stringify(toast2))

  // ── F. 无错误 ────────────────────────────────────────────────
  const realConsole = consoleErrs.filter(e => !/403|401|TENANT|MODULE_NOT_CONFIGURED/.test(e))
  A('F1 无 console error（排除权限类 403/401）', realConsole.length === 0, realConsole.slice(0, 3).join(' || '))
  A('F2 无 pageerror', pageErrs.length === 0, pageErrs.slice(0, 2).join(' || '))

  // 汇总
  const pass = ok.filter(x => x.pass).length
  console.log('\n===== 结果 ' + pass + '/' + ok.length + ' =====')
  ok.filter(x => !x.pass).forEach(x => console.log('FAIL ' + x.name + '  ' + x.extra))
  if (realConsole.length) console.log('CONSOLE_ERRORS:', JSON.stringify(realConsole.slice(0, 5)))
  if (pageErrs.length) console.log('PAGE_ERRORS:', JSON.stringify(pageErrs.slice(0, 5)))

  await browser.close()
  process.exit(pass === ok.length ? 0 : 1)
})().catch(e => { console.log('FATAL', e); process.exit(2) })
