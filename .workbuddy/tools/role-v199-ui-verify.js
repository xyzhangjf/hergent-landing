// 真机验证（生产 hergent.cn，只读）：丙（登录账号文案语义化 + 角色适用端标注）
// 与「角色清单收敛」在**浏览器里真的生效**、且两个页面不因新增共享模块而报错。
//
// 为什么必须真机：本轮把 EmployeeArchive/Forecast 的角色表上提成 `src/constants/roles.js`
// 共享模块 —— 构建能过、chunk 里也能 grep 到字符串，但**动态 import 到不存在的路径**这类
// 错误只有在浏览器里跑起来才暴露（页面白屏 / console 报 Failed to fetch dynamically imported module）。
//
// 断言三组：
//   A 员工档案 —— 文案已语义化（登录账号 / 网页端 + 小程序通用）、下拉 8 项带适用端标注、
//                 角色徽标全中文（无裸英文、无「未知角色(」）
//   B 预报主表 —— 页面正常渲染、默认角色下「分销价」列可见（列权限表已用规范角色名）
//   C 运行时   —— 两个页面 console/pageerror 均无错误
//
// 只读：仅页面加载与点开弹窗（不提交任何写操作）；令牌由外部临时注入、跑完即删。
const puppeteer = require('puppeteer-core')

const TOKEN = process.env.PROD_TOKEN
const TENANT = process.env.PROD_TENANT || '1'
if (!TOKEN) { console.error('缺少 PROD_TOKEN'); process.exit(2) }

let pass = 0, fail = 0
const A = (name, cond, extra) => {
  const ok = !!cond
  if (ok) pass++; else fail++
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (extra !== undefined ? '  [' + extra + ']' : ''))
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

// 后端 _DEFAULT_PERMS 的 8 角色 + 「能进小程序」的集合（= 有 data/chat 权限者）。
// 这里硬编码是**故意**的：后端改了而前端没跟，这两条就会红（它就该红）。
const AUTH_ROLES = ['admin', 'boss', 'accountant', 'sales', 'guide', 'driver', 'staff', 'supervisor']
const MINI_ROLES = ['admin', 'boss', 'sales', 'staff', 'supervisor']

;(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--no-proxy-server'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1560, height: 1000, deviceScaleFactor: 2 })

  const errs = []
  page.on('pageerror', e => errs.push('PAGEERROR: ' + String((e && e.message) || e)))
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()) })

  await page.evaluateOnNewDocument((t, ten) => {
    localStorage.setItem('hergent_v2_token', t)
    localStorage.setItem('hergent_v2_tenant', String(ten))
  }, TOKEN, TENANT)

  // ── A 员工档案 ────────────────────────────────────────────────
  console.log('A 员工档案（生产租户 ' + TENANT + '）')
  await page.goto('https://hergent.cn/?cb=' + Date.now() + '#/archive/employees', { waitUntil: 'networkidle2' })
  await sleep(3500)
  A('A0 落在员工档案页', page.url().includes('#/archive/employees'), page.url().split('#')[1] || '')

  const head = await page.evaluate(() => {
    const sub = (document.querySelector('.page-sub') || {}).innerText || ''
    const ths = Array.from(document.querySelectorAll('thead th')).map(e => (e.innerText || '').trim())
    const roles = Array.from(document.querySelectorAll('.df-role')).map(e => (e.innerText || '').trim())
    return { sub, ths, roles, rows: document.querySelectorAll('tbody tr').length }
  })
  A('A1 页头文案已语义化（含「登录账号权限」+「网页端 / 小程序通用」）',
    head.sub.includes('登录账号权限') && head.sub.includes('网页端 / 小程序通用'), head.sub)
  A('A2 页头不再写死「小程序权限」', !head.sub.includes('小程序权限'))
  A('A3 表头为「登录账号」（不是「小程序账号」）',
    head.ths.includes('登录账号') && !head.ths.includes('小程序账号'), head.ths.join(' | '))
  A('A4 列表渲染出行', head.rows > 0, head.rows + ' 行')
  A('A5 角色徽标全部是中文（无裸英文角色名）',
    head.roles.length > 0 && head.roles.every(t => !/^[a-z_]+$/.test(t)), head.roles.join(','))
  A('A6 角色徽标无「未知角色(」标记（= 清单没漏条目）',
    head.roles.every(t => t.indexOf('未知角色(') < 0), head.roles.join(','))

  const opened = await page.evaluate(() => {
    const tr = document.querySelector('tbody tr')
    if (!tr) return 'no-row'
    const b = Array.from(tr.querySelectorAll('button')).find(x => (x.innerText || '').trim() === '编辑')
    if (!b) return 'no-btn'
    b.click(); return 'ok'
  })
  A('A7 点开第一行员工的「编辑」', opened === 'ok', opened)
  await sleep(1200)

  const modal = await page.evaluate(() => {
    const titles = Array.from(document.querySelectorAll('.df-sec-title')).map(e => (e.innerText || '').trim())
    const sel = document.querySelector('.df-acc-create select.acc-role, .df-acc-manage select.acc-role')
    const tip = document.querySelector('.df-acc-create .df-tip, .df-acc-manage .df-acc-sum')
    return {
      titles,
      tip: tip ? (tip.innerText || '').trim() : '',
      opts: sel ? Array.from(sel.options).map(o => o.value + '|' + o.textContent.trim()) : [],
    }
  })
  A('A8 弹窗区标题为「登录账号」', modal.titles.includes('登录账号'), modal.titles.join(' / '))
  A('A9 角色下拉 8 项且集合 == 后端 8 角色',
    modal.opts.length === 8 &&
    AUTH_ROLES.every(r => modal.opts.some(o => o.indexOf(r + '|') === 0)),
    modal.opts.length + ' 项: ' + modal.opts.map(o => o.split('|')[0]).join(','))

  const labeledMini = modal.opts.filter(o => o.split('|')[1].indexOf('小程序') >= 0)
    .map(o => o.split('|')[0])
  A('A10 「标了小程序」的角色集 == 有 data/chat 权限的角色集（文案与权限对齐）',
    labeledMini.length === MINI_ROLES.length && MINI_ROLES.every(r => labeledMini.indexOf(r) >= 0),
    '标了: ' + labeledMini.join(','))

  const staffLabel = (modal.opts.find(o => o.indexOf('staff|') === 0) || '').split('|')[1] || ''
  const accLabel = (modal.opts.find(o => o.indexOf('accountant|') === 0) || '').split('|')[1] || ''
  A('A11 staff 文案说明「仅小程序」', staffLabel.includes('仅小程序'), staffLabel)
  A('A12 accountant 文案说明「仅网页端」', accLabel.includes('仅网页端'), accLabel)
  A('A13 账号区提示说明两端通用（不再是「登录预报小程序」）',
    modal.tip.includes('网页端') && modal.tip.includes('小程序'), modal.tip.slice(0, 80))
  console.log('')

  // 关掉弹窗（点遮罩）后再去预报页
  await page.evaluate(() => { const o = document.querySelector('.df-overlay'); if (o) o.click() })
  await sleep(600)
  errs.length = 0

  // ── B 预报主表 ────────────────────────────────────────────────
  console.log('B 预报主表')
  await page.goto('https://hergent.cn/?cb=' + Date.now() + '#/forecast', { waitUntil: 'networkidle2' })
  await sleep(4000)
  A('B0 落在预报页', page.url().includes('#/forecast'))
  const fc = await page.evaluate(() => {
    const ths = Array.from(document.querySelectorAll('thead th')).map(e => (e.innerText || '').trim())
    return { ths, body: document.body.innerText.length }
  })
  A('B1 页面有内容渲染', fc.body > 200, fc.body + ' 字符')
  A('B2 默认角色下「分销价」列可见（列权限表已改用规范角色名）',
    fc.ths.some(t => t.indexOf('分销价') >= 0), fc.ths.slice(0, 14).join(' | '))
  console.log('')

  // ── C 运行时错误 ─────────────────────────────────────────────
  console.log('C 运行时')
  const real = errs.filter(e => !/favicon|ResizeObserver|404 \(Not Found\)/i.test(e))
  A('C1 两个页面均无 console 错误 / 页面异常', real.length === 0, real.slice(0, 3).join(' ;; '))

  await browser.close()
  console.log('')
  console.log('-'.repeat(64))
  console.log('真机断言 %d/%d 通过', pass, pass + fail)
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error('运行异常:', e); process.exit(2) })
