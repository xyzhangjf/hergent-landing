/**
 * v226 真机验收 —— 「厂价 → 进价」术语统一（商品档案页）
 *
 * 断言（全部只看**渲染后的真实 DOM**，不读源码）：
 *   ① `#/archive/products` 表头里「进价」恰好 1 个、「厂价」0 个（两列已合一）
 *   ② 那个「进价」列表头可见（不是隐藏/0 宽）
 *   ③ 工具栏上的补价入口文案是「补进价」（不是「补厂价」）
 *   ④ 整页可见文本里「厂价」出现次数 = 0
 *   ⑤ 打开「补进价」面板后，面板文案里同样 0 个「厂价」
 *   ⑥ 全程无 console error / pageerror
 *   ⑦ 截图留证
 *
 * 用法：
 *   HG_TOKEN=<token> HG_TENANT=<tenant> \
 *   NODE_PATH=/Users/zhangjunfeng/.workbuddy/binaries/node/workspace/node_modules \
 *   /Users/zhangjunfeng/.workbuddy/binaries/node/versions/22.22.2-3/bin/node v226-ui-verify.js
 *   （不给 HG_TOKEN 时脚本自己用 HG_USER/HG_PASS 登录换取）
 */
const puppeteer = require('puppeteer-core')
const fs = require('fs')

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.HG_BASE || 'https://hergent.cn'
const USER = process.env.HG_USER || 'mptestsp'
const PASS = process.env.HG_PASS || 'Mpsup@1'
const VW = parseInt(process.env.VW || '1440', 10)
const OUT = '/tmp/v226-ui'
const sleep = ms => new Promise(r => setTimeout(r, ms))

const results = []
function ok(c, name, detail) {
  results.push({ c: !!c, name, detail: detail === undefined ? '' : String(detail) })
  console.log(`  ${c ? '✅' : '❌'} ${name}${detail !== undefined ? '  — ' + detail : ''}`)
}

async function login() {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS }),
  })
  const d = await r.json()
  if (!d.token) throw new Error('login failed: ' + JSON.stringify(d).slice(0, 200))
  return { token: d.token, tenant: d.tenant_id || d.tenantId || 1 }
}

// 传入浏览器上下文里执行：返回表头 / 文案 / 计数
function probe() {
  const vis = el => {
    if (!el) return false
    const r = el.getBoundingClientRect()
    const s = getComputedStyle(el)
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
  }
  const ths = [...document.querySelectorAll('th')].map(t => ({
    t: (t.textContent || '').trim(), w: Math.round(t.getBoundingClientRect().width),
  }))
  const btns = [...document.querySelectorAll('button')].map(b => (b.textContent || '').trim())
  const visibleTh = [...document.querySelectorAll('th')].filter(vis)
  return {
    ths,
    visibleThTexts: visibleTh.map(t => (t.textContent || '').trim()),
    fpTh: ths.filter(x => x.t.includes('进价')),
    oldTh: ths.filter(x => x.t.includes('厂价')),
    topBtns: btns.filter(b => b && b.length < 12).slice(0, 28),
    bodyText: (document.body.innerText || '').replace(/\s+/g, ' '),
    tableCount: document.querySelectorAll('table').length,
  }
}

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const auth = await login()
  console.log(`\n##### v226 真机验收  ${BASE}  #/archive/products #####`)

  const b = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--force-device-scale-factor=1'],
    protocolTimeout: 240000,
  })
  const p = await b.newPage()
  const errs = []
  p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message))
  p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()) })
  // 记录所有非 2xx/3xx 响应 —— 用来判断「403」是账号权限（既有）还是本轮改动引入
  const badResp = []
  p.on('response', r => {
    if (r.status() >= 400) badResp.push(r.status() + ' ' + r.request().method() + ' ' + r.url())
  })

  await p.evaluateOnNewDocument((t, ten) => {
    localStorage.setItem('hergent_v2_token', t)
    localStorage.setItem('hergent_v2_tenant', String(ten))
    localStorage.setItem('hergent_v2_user', JSON.stringify({
      role: 'boss', username: 'v226_probe', display_name: '术语验收',
    }))
  }, auth.token, auth.tenant)
  await p.setViewport({ width: VW, height: 1000, deviceScaleFactor: 1 })
  await p.goto(`${BASE}/?cb=${Date.now()}#/archive/products`, { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(6500)

  let a = await p.evaluate(probe)
  await p.screenshot({ path: `${OUT}/archive-products-${VW}.png` })

  console.log('\n--- 表头 ---')
  console.log('  ' + a.ths.map(x => x.t).join(' | '))
  ok(a.fpTh.length === 1, '表头「进价」恰好 1 列', `实测 ${a.fpTh.length}：${JSON.stringify(a.fpTh)}`)
  ok(a.oldTh.length === 0, '表头「厂价」0 列', `实测 ${a.oldTh.length}`)
  ok(a.fpTh.length === 1 && a.visibleThTexts.includes('进价'), '「进价」列头可见（非隐藏/0 宽）',
    '可见表头：' + a.visibleThTexts.join(' | '))
  ok(a.tableCount >= 1, '商品表已渲染', 'table 数 = ' + a.tableCount)

  console.log('\n--- 工具栏按钮 ---')
  console.log('  ' + a.topBtns.join(' / '))
  ok(a.topBtns.some(t => t.includes('进价')), '工具栏存在「进价」相关入口',
    a.topBtns.filter(t => t.includes('进价')).join(' / '))
  ok(!a.bodyText.includes('厂价'), '整页可见文本 0 个「厂价」',
    '实测 ' + (a.bodyText.match(/厂价/g) || []).length)

  // ---- 打开「补价」面板，断言面板文案里也没有「厂价」----
  const opened = await p.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').includes('补进价'))
    if (!b) return 'no-button'
    b.click()
    return 'clicked'
  })
  console.log('\n--- 补价面板 ---')
  ok(opened === 'clicked', '找到并点击了「补进价」入口', opened)
  if (opened === 'clicked') {
    await sleep(2500)
    const panelText = await p.evaluate(() => {
      const m = [...document.querySelectorAll('.modal, [class*=modal], [class*=drawer]')]
        .filter(el => getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 100)
      return m.length ? (m[m.length - 1].innerText || '').replace(/\s+/g, ' ') : ''
    })
    await p.screenshot({ path: `${OUT}/archive-fp-panel-${VW}.png` })
    ok(panelText.length > 0, '补价面板有可见文本', panelText.slice(0, 90))
    ok(!panelText.includes('厂价'), '面板文案 0 个「厂价」',
      '实测 ' + (panelText.match(/厂价/g) || []).length)
    ok(panelText.includes('进价'), '面板文案出现「进价」')
  }

  console.log('\n--- 网络（非 2xx/3xx）---')
  if (!badResp.length) console.log('  （无）')
  badResp.forEach(x => console.log('  ' + x))
  ok(badResp.every(x => !/import|products|forecast/.test(x)),
    '非 2xx 响应与本轮改动域（products/import/forecast）无关',
    badResp.join(' | ') || '（无）')
  ok(errs.length === 0, '无 console error / pageerror', errs.slice(0, 3).join(' | '))

  await b.close()
  const bad = results.filter(r => !r.c)
  console.log(`\n==== 汇总：${results.length} 项断言，${bad.length} 项失败 ====`)
  bad.forEach(r => console.log(`  ❌ ${r.name}  ${r.detail}`))
  console.log(`截图：${OUT}/`)
  process.exit(bad.length ? 1 : 0)
})().catch(e => { console.error('FATAL', e); process.exit(2) })
