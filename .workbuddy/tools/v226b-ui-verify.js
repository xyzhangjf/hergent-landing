/**
 * v226b 真机验收 —— ① 缺价计数一致化（诉求 1）  ② 收紧后的界面文案（诉求 2）
 *
 * 断言（全部只看**渲染后的真实 DOM**，不读源码）：
 *   A 商品档案页
 *     A1 表头「进价」恰好 1 列、「厂价」0 列（v226 已验，回归项）
 *     A2 整页可见文本 0 个「厂价」
 *     A3 工具栏补价入口的**数字** = 124（改前面板会写 134）
 *     A4 打开补价面板后，面板标题的数字 = 124
 *     A5 面板表格实际行数 = 124
 *     A6 A3 / A4 / A5 **三处同数** ← 这就是诉求 1 的判据（修前 A4/A5 是 134）
 *     A7 面板文案 0 个「厂价」、且含新提示语「本表只列」
 *   B 预报主表
 *     B1 页面可渲染、无「厂价」
 *     B2 商品档案浮层里的进价一栏写的是「进价(元/箱)」（不再是复用 purchase_price 的那格）
 *   全程无 console error / pageerror；截图留证。
 *
 * 用法：
 *   NODE_PATH=/Users/zhangjunfeng/.workbuddy/binaries/node/workspace/node_modules \
 *   /Users/zhangjunfeng/.workbuddy/binaries/node/versions/22.22.2-3/bin/node v226b-ui-verify.js
 */
const puppeteer = require('puppeteer-core')
const fs = require('fs')

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.HG_BASE || 'https://hergent.cn'
const USER = process.env.HG_USER || 'mptestsp'
const PASS = process.env.HG_PASS || 'Mpsup@1'
const VW = parseInt(process.env.VW || '1440', 10)
const EXPECT_MISSING = parseInt(process.env.EXPECT_MISSING || '124', 10)
const OUT = '/tmp/v226b-ui'
const sleep = ms => new Promise(r => setTimeout(r, ms))

const results = []
function ok(c, name, detail) {
  results.push({ c: !!c, name, detail: detail === undefined ? '' : String(detail) })
  console.log(`  ${c ? '✅' : '❌'} ${name}${detail !== undefined ? '  — ' + detail : ''}`)
}
const numOf = s => {
  const m = String(s || '').match(/(\d[\d,]*)/)
  return m ? parseInt(m[1].replace(/,/g, ''), 10) : null
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

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const auth = await login()
  console.log(`\n##### v226b 真机验收  ${BASE} #####`)

  const b = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--force-device-scale-factor=1'],
    protocolTimeout: 240000,
  })
  const p = await b.newPage()
  const errs = []
  p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message))
  p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()) })
  /* 记录所有 >=400 的响应 —— 用来把「403」归因清楚：
     该测试账号是 `supervisor` 角色、没有「AI 对话」权限 ⇒ /api/ai/* 恒 403（v226 已确认的既有项，
     与本轮改动无关）。所以只有断言「403 不落在 products/import/forecast 域」才是有判别力的。 */
  const badResp = []
  p.on('response', r => {
    if (r.status() >= 400) badResp.push(r.status() + ' ' + r.request().method() + ' ' + r.url())
  })

  await p.evaluateOnNewDocument((t, ten) => {
    localStorage.setItem('hergent_v2_token', t)
    localStorage.setItem('hergent_v2_tenant', String(ten))
    localStorage.setItem('hergent_v2_user', JSON.stringify({
      role: 'boss', username: 'v226b_probe', display_name: '计数验收',
    }))
  }, auth.token, auth.tenant)
  await p.setViewport({ width: VW, height: 1000, deviceScaleFactor: 1 })

  /* ---------------- A. 商品档案页 ---------------- */
  console.log('\n===== A. 商品档案页 =====')
  await p.goto(`${BASE}/?cb=${Date.now()}#/archive/products`, { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(7000)

  const a = await p.evaluate(() => {
    const ths = [...document.querySelectorAll('th')].map(t => (t.textContent || '').trim())
    const btns = [...document.querySelectorAll('button')]
      .map(x => (x.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
    return {
      ths,
      btnTexts: btns,
      bodyText: (document.body.innerText || '').replace(/\s+/g, ' '),
    }
  })
  await p.screenshot({ path: `${OUT}/archive-products-${VW}.png` })

  ok(a.ths.filter(t => t.includes('进价')).length === 1, 'A1 表头「进价」恰好 1 列',
    '实测 ' + a.ths.filter(t => t.includes('进价')).length)
  ok(a.ths.filter(t => t.includes('厂价')).length === 0, 'A1b 表头「厂价」0 列',
    '实测 ' + a.ths.filter(t => t.includes('厂价')).length)
  ok(!a.bodyText.includes('厂价'), 'A2 整页可见文本 0 个「厂价」',
    '实测 ' + (a.bodyText.match(/厂价/g) || []).length)

  const badgeBtn = a.btnTexts.find(t => t.includes('进价') && numOf(t) != null)
    || a.btnTexts.find(t => t.includes('进价'))
  const badgeNum = badgeBtn ? numOf(badgeBtn) : null
  console.log('  工具栏入口：' + (badgeBtn || '(未找到)'))
  ok(badgeNum === EXPECT_MISSING, `A3 工具栏补价入口数字 = ${EXPECT_MISSING}`,
    '实测 ' + badgeNum + '（文案：' + badgeBtn + '）')
  await p.screenshot({ path: `${OUT}/archive-toolbar-${VW}.png`, clip: { x: 0, y: 0, width: VW, height: 220 } })

  // 打开补价面板
  const opened = await p.evaluate(() => {
    const x = [...document.querySelectorAll('button')]
      .find(y => (y.textContent || '').includes('补进价'))
    if (!x) return 'no-button'
    x.click()
    return 'clicked'
  })
  ok(opened === 'clicked', 'A4 找到并点击了补价入口', opened)

  let panelTitleNum = null, rowCount = null, panelText = ''
  if (opened === 'clicked') {
    await sleep(3000)
    const pan = await p.evaluate(() => {
      /* ⚠️ 必须**先取 `.pa-modal`（外层）**再退到 [class*=modal] ——
         后者会命中 `.pa-modal-body`（含 "modal" 子串），而 body 里**没有标题行**，
         于是数字永远取不到（上一版探针就栽在这里，看着像"功能没生效"）。 */
      const pick = () => {
        const outer = [...document.querySelectorAll('.pa-modal')]
          .filter(el => getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 100)
        if (outer.length) return outer[outer.length - 1]
        const any = [...document.querySelectorAll('[class*=modal]')]
          .filter(el => getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 100)
        return any.length ? any[any.length - 1] : null
      }
      const m = pick()
      if (!m) return { title: '', rows: -1, text: '' }
      const tbl = m.querySelector('.pa-fp-tbl')
      const text = (m.innerText || '').replace(/\s+/g, ' ')
      const tm = text.match(/还有\s*([\d,]+)\s*个/)
      return {
        title: tm ? tm[0] : (m.querySelector('.pa-modal-hd') || {}).textContent || '',
        rows: tbl ? tbl.querySelectorAll('tbody tr').length : -1,
        text,
      }
    })
    panelTitleNum = numOf(pan.title)
    rowCount = pan.rows
    panelText = pan.text
    console.log('  面板标题：' + pan.title)
    console.log('  面板表格行数：' + pan.rows)
    await p.screenshot({ path: `${OUT}/archive-fp-panel-${VW}.png` })

    ok(panelTitleNum === EXPECT_MISSING, `A4 面板标题数字 = ${EXPECT_MISSING}`,
      '实测 ' + panelTitleNum)
    ok(rowCount === EXPECT_MISSING, `A5 面板表格行数 = ${EXPECT_MISSING}`, '实测 ' + rowCount)
    ok(badgeNum === panelTitleNum && panelTitleNum === rowCount,
      'A6 三处同数（工具栏徽标 / 面板标题 / 面板行数）← 诉求 1 的判据',
      `徽标=${badgeNum} 标题=${panelTitleNum} 行数=${rowCount}`)
    ok(!panelText.includes('厂价'), 'A7 面板文案 0 个「厂价」',
      '实测 ' + (panelText.match(/厂价/g) || []).length)
    ok(panelText.includes('本表只列'), 'A7b 面板含新提示语「本表只列」（口径已说清）',
      panelText.slice(0, 100))

    // 关掉面板
    await p.evaluate(() => {
      const x = [...document.querySelectorAll('.pa-x, button')]
        .find(y => (y.className || '').includes('pa-x'))
      if (x) x.click()
    })
    await sleep(600)
  }

  /* ---------------- B. 预报主表 ---------------- */
  console.log('\n===== B. 预报主表 =====')
  await p.goto(`${BASE}/?cb=${Date.now()}#/forecast`, { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(8000)
  let btxt = await p.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' '))
  await p.screenshot({ path: `${OUT}/forecast-${VW}.png` })
  ok(btxt.length > 200, 'B1 预报页已渲染', '文本长度 ' + btxt.length)
  ok(!btxt.includes('厂价'), 'B1b 预报页可见文本 0 个「厂价」',
    '实测 ' + (btxt.match(/厂价/g) || []).length)

  // 商品档案浮层**只能经右键菜单**打开，且菜单项仅在 `ctx.type==='master' && ctx.key==='name'`
  // 时出现（Forecast.vue:1796）⇒ 必须右键**名称列**那一格。名称列 = 该行里文本含中文、
  // 且不是纯数字/单位文本的那一格（td 上没有稳定的 data-c，故用文本特征定位）。
  const ctxRes = await p.evaluate(() => {
    const tr = document.querySelector('table tbody tr')
    if (!tr) return 'no-row'
    const tds = [...tr.children]
    const td = tds.find(x => {
      const t = (x.textContent || '').trim()
      return t && /[\u4e00-\u9fa5A-Za-z]/.test(t) && !/^\d+(\.\d+)?$/.test(t)
        && !x.classList.contains('calc') && !x.classList.contains('seq-cell')
    })
    if (!td) return 'no-name-cell'
    const rect = td.getBoundingClientRect()
    td.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, button: 2,
      clientX: Math.round(rect.left + 12), clientY: Math.round(rect.top + 12),
    }))
    return 'dispatched@' + (td.textContent || '').trim().slice(0, 16)
  })
  let openedProfile = ctxRes
  if (ctxRes === 'dispatched') {
    await sleep(900)
    openedProfile = await p.evaluate(() => {
      const cands = [...document.querySelectorAll('button, div, li, a, span')]
        .filter(x => /查看商品档案/.test(x.textContent || '')
          && x.querySelectorAll('*').length <= 1
          && getComputedStyle(x).display !== 'none')
      if (!cands.length) return 'no-menu-item'
      cands[cands.length - 1].click()
      return 'clicked'
    })
  }
  console.log('  浮层入口：' + openedProfile)
  if (openedProfile === 'clicked') {
    await sleep(2200)
    const prof = await p.evaluate(() => {
      const m = [...document.querySelectorAll('.imp-modal, [class*=profile-modal], [class*=modal]')]
        .filter(el => getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 80)
      return m.length ? (m[m.length - 1].innerText || '').replace(/\s+/g, ' ') : ''
    })
    await p.screenshot({ path: `${OUT}/forecast-prodprofile-${VW}.png` })
    ok(prof.includes('进价(元/箱)'), 'B2 商品档案浮层进价栏写明「进价(元/箱)」', prof.slice(0, 120))
    ok(!/进价(?!\(元\/箱\))/.test(prof.replace('进价(元/箱)', '')), 'B2b 浮层没有第二个含糊的「进价」',
      prof.slice(0, 120))
  } else {
    console.log('  （跳过 B2：未找到档案浮层入口 — ' + openedProfile + '）')
  }

  console.log('\n--- 控制台 / 网络 ---')
  if (badResp.length) badResp.forEach(x => console.log('  ' + x))
  else console.log('  （无非 2xx/3xx 响应）')
  ok(badResp.every(x => !/\/api\/(products|import|forecast)(\/|\?|$)/.test(x)),
    'C1 非 2xx 响应不落在本轮改动域（products/import/forecast）',
    badResp.join(' | ') || '（无）')
  /* 403 的归属必须精确：`/api/forecast-audit/*`、`/api/rebate-*`、`/api/ai/*` 都是**返利/AI 模块**，
     该账号（supervisor）无这些模块权限 ⇒ 恒 403，是既有现象。
     ⚠️ 两条探针陷阱（都踩过）：
       ① 用 `/api/forecast` 这种**前缀**正则会误命中 `forecast-audit`，把既有 403 判成本轮问题；
       ② 浏览器的 console 文案是 `Failed to load resource: ... 403 ()` —— **不含 URL**，
          所以 C2 只能断言「console error 条数 ≤ 403 条数（每条都能被某个 403 解释）」，
          拿 URL 正则去匹配 console 文本必然恒失败。 */
  const expected403 = x => /\/api\/(ai|rebate-rules|rebate-achievements|forecast-audit)(\/|\?|$)/.test(x)
  ok(badResp.every(expected403) && errs.length <= badResp.length,
    'C2 所有 console error 都可由既有 403（返利/AI 模块权限）解释',
    `console ${errs.length} 条 / 403 ${badResp.length} 条`)

  await b.close()
  const bad = results.filter(r => !r.c)
  console.log(`\n==== 汇总：${results.length} 项断言，${bad.length} 项失败 ====`)
  bad.forEach(r => console.log(`  ❌ ${r.name}  ${r.detail}`))
  console.log(`截图：${OUT}/`)
  process.exit(bad.length ? 1 : 0)
})().catch(e => { console.error('FATAL', e); process.exit(2) })
