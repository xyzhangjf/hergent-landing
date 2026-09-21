// v219 真机取证（浏览器层）：v219 定稿 UI 管控 + 第四批打磨 ②⑤⑥ + 往期「重开」入口。
//
// 分工（见 skill hergent-prod-deploy-e2e）：
//   HTTP 层（v219-prod-http-verify.py）已证明**服务端行为**（409 闸门 / reopen 解锁 / 上限生效）；
//   本层只证明**用户真的看得见、点得到、点了有反应**。
//
// 纪律：
//   · 冒烟绝不点「保存」（saveEdits 无「无改动就短路」分支 = 真实生产写入）；
//     本脚本只做内存内动作（改格 / 开面板 / 一键修复），可反复跑。
//   · 格子一律用 `data-r`/`data-c` 锚定 —— 不用「可见集合的第 N 个」（弹窗滚动会改变可见集合，
//     上一版就是这么读错的：修复明明生效，读回却全是 0）。
//   · 「改动记录」在**单元格右键菜单**里（与撤销/重做同组），不在顶层工具栏 —— 上一版找错位置。
const puppeteer = require('puppeteer-core')
const TOKEN = process.argv[2]
const TID = process.argv[3] || '9997'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const results = []
const ok = (cond, label, extra) => {
  results.push({ pass: !!cond, label })
  console.log('%s %s%s', cond ? '✅' : '❌', label, extra ? '   ← ' + extra : '')
}

let BROWSER = null

;(async () => {
  BROWSER = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--no-proxy-server'],
  })
  const page = await BROWSER.newPage()
  await page.setViewport({ width: 1680, height: 1000 })

  // 注入必须在 goto 之前（SPA 启动前），否则路由守卫拿空 token 把人踢回 /#/login
  await page.evaluateOnNewDocument((t, tid) => {
    localStorage.setItem('hergent_v2_token', t)
    localStorage.setItem('hergent_v2_tenant', String(tid))
  }, TOKEN, TID)

  await page.goto('https://hergent.cn/?cb=' + Date.now() + '#/forecast', {
    waitUntil: 'domcontentloaded', timeout: 60000,
  })
  await sleep(8000)

  ok(!/login/.test(page.url()), 'B0 前置：登录态注入成功（未被踢回 login）', page.url())

  const clicked = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')]
      .filter((x) => x.offsetParent !== null && x.getBoundingClientRect().width > 0)
      .find((x) => (x.textContent || '').replace(/\s+/g, '') === '改单')
    if (!b || b.disabled) return b ? 'disabled' : 'not-found'
    b.click(); return 'clicked'
  })
  await sleep(8000)

  const grid = await page.evaluate(() => ({
    qty: document.querySelectorAll('input.cell-qty').length,
    name: document.querySelectorAll('input.cell-name').length,
  }))
  ok(grid.qty > 0, 'B0b 前置：进入改单态且网格有数量格', JSON.stringify(grid))
  ok(clicked === 'clicked', 'B0c 「改单」可点（未被 v219 定稿管控禁用 —— 当前期次是 open）', clicked)

  // ── DIAG：把可见按钮全量打出来（探针自检，不算判据）────────────────────────
  const diag = await page.evaluate(() => {
    const vis = [...document.querySelectorAll('button')]
      .filter((x) => x.offsetParent !== null && x.getBoundingClientRect().width > 0)
    const txt = vis.map((x) => (x.textContent || '').replace(/\s+/g, '').trim()).filter(Boolean)
    return {
      total: document.querySelectorAll('button').length,
      visible: vis.length,
      hasChk: txt.filter((t) => t.startsWith('查错')),
      badge: (document.querySelector('.btn-badge.err') || {}).textContent || null,
      sample: txt.slice(0, 40),
    }
  })
  console.log('   DIAG 可见按钮 %d/%d；查错类=%s；角标=%s', diag.visible, diag.total,
              JSON.stringify(diag.hasChk), diag.badge)
  console.log('   DIAG 前 40 个：%s', JSON.stringify(diag.sample))

  // ── 定位一个可见格子（返回 data-r / data-c）──────────────────────────────
  const pick = await page.evaluate(() => {
    const el = [...document.querySelectorAll('input.cell-qty')].find((e) => {
      const r = e.getBoundingClientRect()
      return r.width > 4 && r.height > 4 && r.top > 180 && r.bottom < innerHeight - 160
    })
    return el ? { r: +el.dataset.r, c: +el.dataset.c } : null
  })
  ok(!!pick, 'B0d 找到一个可见的数量格（后续按 data-r/data-c 锚定它）', JSON.stringify(pick))
  if (!pick) { console.log('!! 无可见格子，后续无法进行'); await BROWSER.close(); process.exit(1) }
  const RC = pick

  const putQty = (r, c, v) => page.evaluate((r, c, v) => {
    const el = document.querySelector('input.cell-qty[data-r="' + r + '"][data-c="' + c + '"]')
    if (!el) return { ok: false, value: null }
    el.focus()
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    el.blur()
    return { ok: true, value: el.value }
  }, r, c, v)

  const readQty = (r, c) => page.evaluate((r, c) => {
    const el = document.querySelector('input.cell-qty[data-r="' + r + '"][data-c="' + c + '"]')
    return el ? el.value : null
  }, r, c)

  const openCtx = (r, c) => page.evaluate((r, c) => {
    const el = document.querySelector('input.cell-qty[data-r="' + r + '"][data-c="' + c + '"]')
      || document.querySelector('td[data-r="' + r + '"][data-c="' + c + '"]')
    if (!el) return false
    const b = el.getBoundingClientRect()
    el.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, button: 2, buttons: 2,
      clientX: b.left + 5, clientY: b.top + 5,
    }))
    return true
  }, r, c)

  const ctxClick = (prefix) => page.evaluate((prefix) => {
    const m = [...document.querySelectorAll('.ctx-menu')].find((x) => x.getBoundingClientRect().width > 0)
    if (!m) return { found: false, menu: false, items: [] }
    const items = [...m.querySelectorAll('button')].map((b) => ({
      t: (b.textContent || '').replace(/\s+/g, '').trim(), disabled: b.disabled,
    }))
    const b = [...m.querySelectorAll('button')].find((x) => (x.textContent || '').replace(/\s+/g, '').startsWith(prefix))
    if (!b) return { found: false, menu: true, items }
    if (b.disabled) return { found: true, disabled: true, menu: true, items }
    b.click()
    return { found: true, disabled: false, menu: true, items }
  }, prefix)

  // ── B1 改动记录（打磨②；在单元格右键菜单里）──────────────────────────────
  const v1 = await putQty(RC.r, RC.c, '7')
  await sleep(700)
  ok(v1.ok && v1.value === '7', 'B1a 改一格成功（Vue 真的收到输入）', JSON.stringify(v1))

  await openCtx(RC.r, RC.c)
  await sleep(800)
  const menu = await page.evaluate(() => {
    const m = [...document.querySelectorAll('.ctx-menu')].find((x) => x.getBoundingClientRect().width > 0)
    if (!m) return null
    return [...m.querySelectorAll('button')].map((b) => (b.textContent || '').replace(/\s+/g, '').trim())
  })
  ok(!!menu, 'B1b 右键单元格弹出了菜单', menu ? menu.slice(0, 8).join(' | ') : 'null')
  const recBtn = (menu || []).find((t) => t.startsWith('改动记录'))
  ok(!!recBtn, 'B1c 菜单里有「改动记录」入口（与撤销/重做同组 —— 主工具栏不加按钮）', recBtn || '')

  const rec = await ctxClick('改动记录')
  await sleep(900)
  const recPanel = await page.evaluate(() => {
    const hd = [...document.querySelectorAll('.imp-modal .imp-hd b')].find((b) => (b.textContent || '').includes('改动记录'))
    if (!hd) return null
    const modal = hd.closest('.imp-modal')
    return {
      items: modal.querySelectorAll('.undo-item').length,
      tip: (modal.querySelector('.imp-tip') || {}).textContent || '',
      labels: [...modal.querySelectorAll('.undo-item .undo-label')].slice(0, 3).map((x) => (x.textContent || '').replace(/\s+/g, ' ').trim()),
    }
  })
  ok(rec.found && recPanel, 'B1d 点「改动记录」弹出了面板', JSON.stringify(rec).slice(0, 160))
  ok(recPanel && recPanel.items >= 1, 'B1e ★面板列出了改动明细（用户能看出改了什么、能直接退到某一步，不再盲退）',
     recPanel ? 'items=' + recPanel.items + ' 首条=' + JSON.stringify(recPanel.labels[0]) : '')

  await page.evaluate(() => {
    const x = [...document.querySelectorAll('.imp-modal .imp-x')].pop()
    if (x) x.click()
  })
  await sleep(600)

  // ── B2 制造「超上限」错误 → 打开预检面板 + 一键修复（打磨⑤）───────────────
  const v2 = await putQty(RC.r, RC.c, '999999999')
  /* 🔴 必须等过节流再读角标：errCount 由 `setTimeout(,…,1500)` 更新（Forecast.vue Q25），
     填完立刻读必然拿到旧值 null —— 那是**刻意的节流**、不是缺陷（v219 上一版就误判成红了）。 */
  await sleep(2200)
  const badge = await page.evaluate(() => {
    const b = document.querySelector('.btn-badge.err')
    return b ? (b.textContent || '').trim() : null
  })
  ok(v2.value === '999999999' && badge && parseInt(badge) >= 1,
     'B2a 填超上限值后「查错」出现错误角标', 'badge=' + badge + ' value=' + v2.value)

  const opened2 = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')]
      .filter((x) => x.offsetParent !== null && x.getBoundingClientRect().width > 0)
      .find((x) => (x.textContent || '').replace(/\s+/g, '').startsWith('查错'))
    if (!b) return false
    b.click(); return true
  })
  await sleep(1000)
  const fixbar = await page.evaluate(() => {
    const bar = document.querySelector('.err-fixbar')
    if (!bar) return null
    const fix = [...bar.querySelectorAll('button')].find((x) => (x.textContent || '').includes('一键修复'))
    const cap = [...bar.querySelectorAll('button')].find((x) => (x.textContent || '').includes('数量上限'))
    return {
      fixText: fix ? (fix.textContent || '').replace(/\s+/g, ' ').trim() : null,
      capText: cap ? (cap.textContent || '').replace(/\s+/g, ' ').trim() : null,
      manual: (bar.querySelector('.err-fixhint') || {}).textContent || '',
    }
  })
  ok(opened2 && fixbar, 'B2b 点「查错」弹出预检面板，且带操作条 .err-fixbar', JSON.stringify(fixbar))
  ok(fixbar && /一键修复\s*[1-9]/.test(fixbar.fixText || ''), 'B2c 出现「一键修复 N 处」', fixbar ? fixbar.fixText : '')

  const openFix = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.err-fixbar button')].find((x) => (x.textContent || '').includes('一键修复'))
    if (!b) return false
    b.click(); return true
  })
  await sleep(800)
  const prev = await page.evaluate(() => {
    const dlg = document.querySelector('.fix-dlg')
    if (!dlg) return null
    return { text: (dlg.textContent || '').replace(/\s+/g, ' ').slice(0, 400) }
  })
  ok(openFix && prev, 'B3a 点「一键修复」弹出预览弹窗（先看后改，不是一键盲改）', prev ? prev.text.slice(0, 130) : '')
  ok(prev && /999999999\s*→\s*99999/.test(prev.text), 'B3b 预览写清「原值 → 新值」（999999999 → 99999）', prev ? prev.text.slice(0, 240) : '')

  const applied = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.fix-dlg button')].find((x) => (x.textContent || '').includes('确认修复'))
    if (!b) return false
    b.click(); return true
  })
  await sleep(1200)
  const after = await readQty(RC.r, RC.c)
  ok(applied && after === '99999', 'B3c ★确认修复后**同一格**（data-r/data-c 锚定）真的变成上限值 99999',
     'applied=' + applied + ' value=' + after)

  // 🔴 这里**特意立即读**（1200ms 远小于 1.5s 节流）：修完角标必须当场就对。
  //    这条现在同时是「applyFixes 只回写 errList 漏回写 errCount」那个缺陷的回归判据。
  const badge2 = await page.evaluate(() => {
    const b = document.querySelector('.btn-badge.err')
    return b ? (b.textContent || '').trim() : null
  })
  ok(badge2 === null || parseInt(badge2) === 0, 'B3d 修复后错误角标当场归零（与面板同一次回写，不靠 1.5s 节流兜底）', 'badge=' + badge2)

  // ── B4 数量上限可配（打磨⑥）：入口就在「被拦下」的地方 ────────────────────
  await putQty(RC.r, RC.c, '999999999')
  await sleep(800)
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')]
      .filter((x) => x.offsetParent !== null && x.getBoundingClientRect().width > 0)
      .find((x) => (x.textContent || '').replace(/\s+/g, '').startsWith('查错'))
    if (b) b.click()
  })
  await sleep(1000)
  const cap = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.err-fixbar button')].find((x) => (x.textContent || '').includes('数量上限'))
    if (!b) return null
    const t = (b.textContent || '').replace(/\s+/g, ' ').trim()
    b.click()
    return { text: t }
  })
  await sleep(900)
  const ruleDlg = await page.evaluate(() => {
    const d = document.querySelector('.fix-dlg.rule-dlg')
    if (!d) return null
    const inp = d.querySelector('.rule-input')
    return {
      title: (d.querySelector('.fix-hd b') || {}).textContent || '',
      inputVal: inp ? inp.value : null,
      inputType: inp ? inp.type : null,
      hint: (d.querySelector('.rule-hint') || {}).textContent || '',
      tip: (d.querySelector('.fix-tip') || {}).textContent || '',
    }
  })
  ok(cap && ruleDlg, 'B4a ★预检面板里有「数量上限 · 修改」入口，点开有弹窗', cap ? cap.text : '')
  ok(ruleDlg && /数量录入上限/.test(ruleDlg.title), 'B4b 弹窗标题正确', ruleDlg ? ruleDlg.title : '')
  ok(ruleDlg && String(ruleDlg.inputVal).length > 0, 'B4c 弹窗预填当前上限（改前先看到）', ruleDlg ? 'input=' + ruleDlg.inputVal : '')
  ok(ruleDlg && ruleDlg.inputType === 'text', 'B4d 输入框是 type=text 而非 number（v214 判据：number 会静默加工输入）', ruleDlg ? ruleDlg.inputType : '')
  ok(ruleDlg && /当前生效/.test(ruleDlg.hint), 'B4e 有「当前生效」提示', ruleDlg ? ruleDlg.hint.replace(/\s+/g, ' ').trim() : '')
  ok(ruleDlg && /Web 与小程序两个端同时变/.test(ruleDlg.tip), 'B4f 讲清了影响面（本租户 + 两个端同时变）', ruleDlg ? ruleDlg.tip.replace(/\s+/g, ' ').slice(0, 90) : '')

  // 关掉所有浮层
  await page.evaluate(() => {
    document.querySelectorAll('.fix-mask .imp-x, .imp-modal .imp-x, .err-panel .imp-x').forEach((b) => b.click())
    document.querySelectorAll('.imp-overlay, .ctx-overlay').forEach((o) => o.click())
  })
  await sleep(800)

  // ── B5 往期预报的「重开」入口（v219 核心 UI）──────────────────────────────
  const tab = await page.evaluate(() => {
    const cands = [...document.querySelectorAll('button, .tab, [role=tab], a, span')]
      .filter((x) => x.offsetParent !== null && x.getBoundingClientRect().width > 0)
    const t = cands.find((x) => /往期预报|历史期次/.test((x.textContent || '').replace(/\s+/g, '')))
    if (!t) return { ok: false }
    t.click(); return { ok: true, text: (t.textContent || '').replace(/\s+/g, '') }
  })
  await sleep(2500)
  const rows = await page.evaluate(() => {
    const out = []
    for (const tr of document.querySelectorAll('tr')) {
      const btns = [...tr.querySelectorAll('button')].map((b) => (b.textContent || '').replace(/\s+/g, '').trim())
      const hasReopen = btns.includes('重开')
      const hasClose = btns.includes('关闭')
      if (!hasReopen && !hasClose) continue
      out.push({ hasReopen, hasClose, name: (tr.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 34) })
    }
    return out
  })
  ok(tab.ok, 'B5a 切到「往期预报」tab', JSON.stringify(tab))
  const withReopen = rows.filter((r) => r.hasReopen)
  const withClose = rows.filter((r) => r.hasClose)
  ok(withReopen.length > 0, 'B5b ★已关闭期次行有「重开」按钮（关闭可逆，用户有路可走）',
     withReopen.length + ' 行：' + withReopen.map((r) => r.name).slice(0, 2).join(' | '))
  ok(withClose.length > 0 && withReopen.every((r) => !r.hasClose) && withClose.every((r) => !r.hasReopen),
     'B5c 反证：进行中行只有「关闭」、已定稿行只有「重开」—— 两按钮互斥（非无差别都挂）',
     'open行=' + withClose.length + ' closed行=' + withReopen.length)

  // ── 汇总 ──────────────────────────────────────────────────────────────────
  const passed = results.filter((r) => r.pass).length
  console.log('-'.repeat(72))
  console.log('VERDICT: %d/%d PASS', passed, results.length)
  if (passed !== results.length) {
    console.log('FAILED:')
    results.filter((r) => !r.pass).forEach((r) => console.log('   - ' + r.label))
  } else {
    console.log('ALL GREEN')
  }
  await BROWSER.close()
  process.exit(passed === results.length ? 0 : 1)
})().catch(async (e) => {
  console.log('FATAL', e && e.message)
  try { if (BROWSER) await BROWSER.close() } catch (_) {}
  process.exit(2)
})
