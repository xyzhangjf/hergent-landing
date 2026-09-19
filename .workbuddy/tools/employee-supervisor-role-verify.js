// 真机验证：「主管」(supervisor) 在员工档案可发现 / 可创建 / 可正确显示。
//
// 病灶（2026-09-19 修复）：EmployeeArchive.vue 的 ROLE_OPTIONS 与 ROLE_NAMES 各只列了 7 个
//   角色，**都漏掉 supervisor** ⇒ ① 开不出新的主管账号（下拉里没有该角色）
//   ② 已是主管的账号在「账号」列显示裸英文 `supervisor`（roleName 的 fallback 就是角色名本身，
//      缺映射不报错、只是把英文原样吐出来）。
//
// 断言四组：
//   A 角色下拉 —— 8 个选项、含 supervisor、文案正确（决定「能不能开出主管账号」）
//   B 真实建号 —— 走 UI 给员工开一个 supervisor 账号（端到端能落库）
//   C 显示名  —— 列表该行显示「主管」而非裸英文（本次修复的主症）
//   D 色板    —— badge class 含 r-supervisor 且背景为 indigo 透明底（与 staff 的 teal 区分开）
//
// 跑在**隔离沙箱租户**（id ≥ 9997，克隆真实租户 ⇒ 员工数据与生产一致）。
// ⚠️ 建账号会写**主库 users**（staff_account_create 走 _master_db），所以：
//   · username 固定为 NEW_USER，跑完必须按 username 精确删除（见交付说明的清理段）；
//   · 删前先备份 erp.db。
const puppeteer = require('puppeteer-core')

const TOKEN = process.env.PROD_TOKEN
const TENANT = process.env.PROD_TENANT || '9997'
const OUT = process.env.HG_OUT || '/tmp'
const NEWUSER = process.env.NEW_USER || 'sbxsup9997'
const NEWPWD = process.env.NEW_PWD || 'Sbx@9997'

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

// 后端 core._DEFAULT_PERMS 的 8 个角色 —— 这里硬编码一份是**故意**的：
// 若日后后端加了角色而前端没跟，这条断言会红（它就该红）。
const AUTH_ROLES = ['admin', 'boss', 'accountant', 'sales', 'guide', 'driver', 'staff', 'supervisor']

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
  page.on('console', m => { if (m.type() === 'error') consoleErrs.push('CONSOLE: ' + m.text()) })

  await page.evaluateOnNewDocument((t, ten) => {
    localStorage.setItem('hergent_v2_token', t)
    localStorage.setItem('hergent_v2_tenant', String(ten))
  }, TOKEN, TENANT)

  await page.goto('https://hergent.cn/?cb=' + Date.now() + '#/archive/employees',
    { waitUntil: 'networkidle2' })
  await sleep(3500)

  const url = page.url()
  A('A0 落在员工档案页（沙箱租户）', url.includes('#/archive/employees'), (url.split('#')[1] || url))

  const rowCount = await page.$$eval('tbody tr', rs => rs.length)
  A('A1 员工列表渲染出行（克隆自真实租户）', rowCount > 0, rowCount + ' 行')

  // ── A. 打开「开通账号」表单，读角色下拉 ────────────────────────
  const opened = await page.evaluate(() => {
    const tr = document.querySelector('tbody tr')
    if (!tr) return 'no-row'
    const b = Array.from(tr.querySelectorAll('button')).find(x => (x.innerText || '').trim() === '编辑')
    if (!b) return 'no-btn'
    b.click()
    return 'ok'
  })
  A('A2 点开第一行员工的「编辑」', opened === 'ok', opened)
  await sleep(1200)

  const form = await page.evaluate(() => {
    const box = document.querySelector('.df-acc-create')
    const sel = document.querySelector('.df-acc-create select.acc-role')
    return {
      hasCreateForm: !!box,
      hasSelect: !!sel,
      options: sel ? Array.from(sel.options).map(o => o.value + '|' + o.textContent.trim()) : [],
      defaultValue: sel ? sel.value : '',
    }
  })
  A('A3 该员工未开通 ⇒ 渲染的是「开通账号」表单', form.hasCreateForm && form.hasSelect,
    form.hasCreateForm ? '有表单' : '无表单')

  const optVals = form.options.map(s => s.split('|')[0])
  A('A4 角色下拉共 8 个选项（= 后端 _DEFAULT_PERMS 角色数）',
    optVals.length === 8, optVals.length + ' 个: ' + optVals.join(','))
  A('A5 角色下拉含 supervisor（修复前没有 ⇒ 开不出主管账号）',
    optVals.indexOf('supervisor') >= 0)
  A('A6 下拉角色集合 == 后端 8 角色',
    AUTH_ROLES.every(r => optVals.indexOf(r) >= 0) && optVals.length === AUTH_ROLES.length,
    '缺: ' + AUTH_ROLES.filter(r => optVals.indexOf(r) < 0).join(','))

  const supLabel = (form.options.find(s => s.indexOf('supervisor|') === 0) || '').split('|')[1] || ''
  A('A7 supervisor 的中文文案正确（不再暴露英文）',
    supLabel.indexOf('主管') >= 0, supLabel)

  // ── B. 真实建一个 supervisor 账号（走 UI 全链路）────────────────
  const filled = await page.evaluate((usr, pwd) => {
    const setVal = (el, v) => {
      const proto = el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype
        : window.HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }
    const u = document.querySelector('.df-acc-create input[placeholder="如 13800000001"]')
    const p = document.querySelector('.df-acc-create input[placeholder="至少 4 位"]')
    const s = document.querySelector('.df-acc-create select.acc-role')
    if (!u || !p || !s) return 'missing-input'
    setVal(u, usr); setVal(p, pwd); setVal(s, 'supervisor')
    return JSON.stringify({ user: u.value, pwdLen: p.value.length, role: s.value })
  }, NEWUSER, NEWPWD)
  const f = JSON.parse(filled)
  A('B1 表单三项均已真实填入（Vue 已收到 input 事件）',
    f.user === NEWUSER && f.pwdLen === NEWPWD.length && f.role === 'supervisor', filled)

  // ⚠️ 必须在**另一次** evaluate 里读按钮状态。在同一个同步块里填完值立刻读，
  //    Vue 还没重渲染 ⇒ 拿到改前的 disabled（本轮实测：这里读 true、而点下去是通的），
  //    症状是「按钮明明可点却说不可点」的**假 FAIL**。技能 §6「点击+读要分两次」同源。
  await sleep(400)
  const btnState = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('.df-acc-create button'))
      .find(b => (b.innerText || '').trim() === '开通账号')
    return btn ? { disabled: btn.disabled } : null
  })
  A('B2 「开通账号」按钮因此变为可点（disabled=false）',
    !!btnState && btnState.disabled === false, btnState ? 'disabled=' + btnState.disabled : '未找到按钮')

  const clicked = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('.df-acc-create button'))
      .find(b => (b.innerText || '').trim() === '开通账号')
    if (!btn || btn.disabled) return 'blocked'
    btn.click()
    return 'ok'
  })
  A('B3 点击「开通账号」', clicked === 'ok', clicked)

  // 等 toast（技能：toast 只活 3 秒且请求完成后才出现 ⇒ 点完立刻轮询）
  let toastTxt = ''
  for (let i = 0; i < 30; i++) {
    await sleep(200)
    toastTxt = await page.evaluate(() => {
      const el = document.querySelector('.toast, .toast-ok, .toast-err, [class*="toast"]')
      return el ? (el.innerText || '').trim() : ''
    })
    if (toastTxt) break
  }
  A('B4 后端受理：toast 出现且为成功文案', toastTxt.indexOf('账号已开通') >= 0, toastTxt || '(无 toast)')

  // ── C. 列表显示名（本次修复的主症）────────────────────────────
  await page.reload({ waitUntil: 'networkidle2' })
  await sleep(3000)

  const rowsTxt = await page.$$eval('tbody tr', rs => rs.map(r => r.innerText.replace(/\s+/g, ' ')))
  const target = rowsTxt.find(t => t.indexOf(NEWUSER) >= 0) || ''
  A('C1 列表出现该账号（已开通 ' + NEWUSER + '）',
    target.indexOf('已开通 ' + NEWUSER) >= 0, target || '(未找到该行)')
  A('C2 该行角色显示中文「主管」（修复前显示裸英文 supervisor）',
    target.indexOf('主管') >= 0 && target.indexOf(' supervisor') < 0, target)
  // 直接检查**角色徽标**本身，而不是猜行尾 —— 徽标文本若是纯英文角色名，
  // 就是 ROLE_NAMES 缺映射（本次缺陷的形态）。
  const roleBadges = await page.$$eval('.df-role', els => els.map(e => (e.innerText || '').trim()))
  A('C3 全部角色徽标都是中文（无裸英文角色名）',
    roleBadges.length > 0 && roleBadges.every(t => !/^[a-z_]+$/.test(t)),
    roleBadges.length + ' 枚: ' + roleBadges.join(' / '))

  const badge = await page.evaluate(() => {
    const s = document.querySelector('.df-role.r-supervisor')
    if (!s) return null
    const cs = getComputedStyle(s)
    return {
      text: (s.innerText || '').trim(),
      cls: s.className,
      bg: cs.backgroundColor,
      color: cs.color,
    }
  })
  A('D1 颜色徽标命中 .df-role.r-supervisor（修复前会退回基础 teal）', !!badge,
    badge ? badge.cls : '未找到')
  if (badge) {
    A('D2 徽标文本 = 「主管」', badge.text === '主管', badge.text)
    A('D3 背景为 indigo 14% 透明底（与 r-staff 的 teal 区分开）',
      badge.bg === 'rgba(99, 102, 241, 0.14)', badge.bg)
    A('D4 前景色 = indigo #6366f1', badge.color === 'rgb(99, 102, 241)', badge.color)
  }

  // ── E. 再点编辑 ⇒ 进账号管理区，摘要也走中文 ────────────────────
  await page.evaluate(usr => {
    const tr = Array.from(document.querySelectorAll('tbody tr'))
      .find(r => (r.innerText || '').indexOf(usr) >= 0)
    if (!tr) return
    const b = Array.from(tr.querySelectorAll('button')).find(x => (x.innerText || '').trim() === '编辑')
    if (b) b.click()
  }, NEWUSER)
  await sleep(1300)

  const manage = await page.evaluate(() => {
    const m = document.querySelector('.df-acc-manage')
    const sel = document.querySelector('.df-acc-manage select.acc-role')
    const btn = Array.from(document.querySelectorAll('.df-acc-manage button'))
      .find(b => (b.innerText || '').trim() === '修改角色')
    return {
      hasManage: !!m,
      txt: m ? m.innerText.replace(/\s+/g, ' ') : '',
      selVals: sel ? Array.from(sel.options).map(o => o.value) : [],
      selCur: sel ? sel.value : '',
      btnDisabled: btn ? btn.disabled : null,
    }
  })
  A('E1 已开通 ⇒ 弹窗进入账号管理区', manage.hasManage, manage.txt.slice(0, 70))
  A('E2 摘要里角色也是中文「主管」',
    manage.txt.indexOf('主管') >= 0 && manage.txt.indexOf('supervisor') < 0, manage.txt.slice(0, 80))
  A('E3 管理区角色下拉同样含 supervisor 8 项',
    manage.selVals.length === 8 && manage.selVals.indexOf('supervisor') >= 0, manage.selVals.join(','))
  A('E4 下拉已选中当前角色 supervisor，故「修改角色」置灰', manage.selCur === 'supervisor' && manage.btnDisabled === true,
    'cur=' + manage.selCur + ' disabled=' + manage.btnDisabled)

  await page.screenshot({ path: OUT + '/empacc-supervisor.png' }).catch(() => {})
  A('E5 页面零 JS 异常', consoleErrs.length === 0, consoleErrs.slice(0, 2).join(' | '))

  await browser.close()

  console.log('')
  console.log('='.repeat(58))
  console.log('结果：' + pass + '/' + (pass + fail) + (fail ? ' —— ' + fail + ' 项失败' : ' 全绿'))
  process.exit(fail ? 1 : 0)
})().catch(e => {
  console.error('探针异常:', (e && e.stack) || e)
  process.exit(1)
})
