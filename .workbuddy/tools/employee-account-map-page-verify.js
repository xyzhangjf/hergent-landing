// 真机验证：员工档案页的「账号状态」是否正确（生产 tenant_1，只读）
//
// 病灶：`erp_db.py::employee_account_map` 的 `return out` 缩进**落在 `for` 体内**
//   ⇒ 函数最多只产出 1 个员工 ⇒ 命中的第 2 个人起一律显示「未开通」。
//   而账号区**只在 "已开通" 时才渲染**（EmployeeArchive.vue:159 走「开通账号」表单，
//   :170 才走账号管理区）⇒ 显示未开通 → 看不到账号管理区 → 开不出来 → 永远未开通。
//
// 本探针用**生产真页面 + 真数据**证明两件事：
//   A. 列表「账号」列：「张俊峰」显示「已开通 boss」（旧代码显示「未开通」）
//   B. 点该行「编辑」→ 弹窗是**账号管理区**（`.df-acc-manage` + 「登录账号：boss」），
//      而**不是**「开通账号」表单 ⇒ 死循环确已打破
//
// 只读：全程不点任何写按钮（开通/保存/停用/生成重置码）。
const puppeteer = require('puppeteer-core')

const TOKEN = process.env.PROD_TOKEN
const TENANT = process.env.PROD_TENANT || '1'
const OUT = process.env.HG_OUT || '/tmp'

if (!TOKEN) {
  console.error('缺少 PROD_TOKEN 环境变量')
  process.exit(2)
}

let pass = 0
let fail = 0
const A = (name, cond, extra) => {
  const okk = !!cond
  if (okk) pass++; else fail++
  console.log((okk ? '  PASS  ' : '  FAIL  ') + name + (extra !== undefined ? '  [' + extra + ']' : ''))
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

;(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--no-proxy-server'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1560, height: 1000, deviceScaleFactor: 2 })

  const consoleErrs = []
  page.on('pageerror', e => consoleErrs.push(String((e && e.message) || e)))

  // 令牌必须在文档脚本执行前注入
  await page.evaluateOnNewDocument((t, ten) => {
    localStorage.setItem('hergent_v2_token', t)
    localStorage.setItem('hergent_v2_tenant', String(ten))
  }, TOKEN, TENANT)

  await page.goto('https://hergent.cn/?cb=' + Date.now() + '#/archive/employees',
    { waitUntil: 'networkidle2' })
  await sleep(3500)

  // ── A. 列表「账号」列 ─────────────────────────────────────────
  const u = page.url()
  A('A1 落在员工档案页', u.includes('#/archive/employees'), u.split('#')[1] || u)

  const rows = await page.$$eval('tbody tr', rs => rs.map(r => r.innerText.replace(/\s+/g, ' ')))
  A('A2 表格渲染出员工行', rows.length > 0, rows.length + ' 行')

  const find = kw => rows.find(t => t.indexOf(kw) >= 0) || ''
  const zjf = find('张俊峰')
  const adm = find('管理员')

  A('A3 「张俊峰」行显示「已开通 boss」（旧代码显示未开通）',
    zjf.indexOf('已开通 boss') >= 0, zjf || '(未找到该行)')
  A('A4 「管理员」行显示「已开通 admin」',
    adm.indexOf('已开通 admin') >= 0, adm || '(未找到该行)')

  const opened = rows.filter(t => t.indexOf('已开通') >= 0).length
  const closed = rows.filter(t => t.indexOf('未开通') >= 0).length
  A('A5 「已开通」行数 = 2（旧代码只会是 1）', opened === 2, '已开通 ' + opened + ' / 未开通 ' + closed)
  A('A6 已开通 + 未开通 == 总行数', opened + closed === rows.length,
    opened + '+' + closed + ' vs ' + rows.length)

  // ── B. 点「编辑」→ 弹窗应是账号管理区 ────────────────────────
  const clicked = await page.evaluate(() => {
    const trs = Array.from(document.querySelectorAll('tbody tr'))
    const tr = trs.find(r => (r.innerText || '').indexOf('张俊峰') >= 0)
    if (!tr) return 'no-row'
    const btns = Array.from(tr.querySelectorAll('button'))
    const b = btns.find(x => (x.innerText || '').trim() === '编辑')
    if (!b) return 'no-btn'
    b.click()
    return 'ok'
  })
  A('B1 找到并点击「张俊峰」行的「编辑」', clicked === 'ok', clicked)
  await sleep(1200)

  const dlg = await page.evaluate(() => {
    const q = s => document.querySelector(s)
    const manage = q('.df-acc-manage')
    const create = q('.df-acc-create')
    const bodyTxt = (document.body.innerText || '').replace(/\s+/g, ' ')
    const btns = Array.from(document.querySelectorAll('button')).map(b => (b.innerText || '').trim())
    return {
      hasManage: !!manage,
      hasCreate: !!create,
      manageTxt: manage ? manage.innerText.replace(/\s+/g, ' ') : '',
      createTxt: create ? create.innerText.replace(/\s+/g, ' ') : '',
      hasOpenBtn: btns.indexOf('开通账号') >= 0,
      titleHasSec: bodyTxt.indexOf('小程序账号') >= 0,
    }
  })

  A('B2 弹窗渲染出「小程序账号」区', dlg.titleHasSec)
  A('B3 弹窗是**账号管理区**（.df-acc-manage 存在）', dlg.hasManage, dlg.manageTxt.slice(0, 60))
  A('B4 弹窗**没有**「开通账号」表单（.df-acc-create 不存在）', !dlg.hasCreate,
    dlg.hasCreate ? dlg.createTxt.slice(0, 60) : '')
  A('B5 没有「开通账号」按钮（死循环已打破）', !dlg.hasOpenBtn)
  A('B6 管理区文案含「登录账号：boss」', dlg.manageTxt.indexOf('登录账号：boss') >= 0,
    dlg.manageTxt.slice(0, 80))

  await page.screenshot({ path: OUT + '/empacc-page.png' }).catch(() => {})
  A('B7 页面零 JS 异常', consoleErrs.length === 0, consoleErrs.slice(0, 2).join(' | '))

  await browser.close()

  console.log('')
  console.log('='.repeat(58))
  console.log('结果：' + pass + '/' + (pass + fail) + (fail ? ' —— ' + fail + ' 项失败' : ' 全绿'))
  process.exit(fail ? 1 : 0)
})().catch(e => {
  console.error('探针异常:', e && e.stack || e)
  process.exit(1)
})
