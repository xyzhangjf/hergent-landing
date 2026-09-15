// v170 真机验证：编辑态「新增客户」入口（表头那一格已撤，入口迁到工具行）
// 用法:
//   HG_TOKEN=<token> HG_TENANT=9998 NODE_PATH=<ws>/node_modules node forecast-v170-addcol-verify.js
// 覆盖：入口撤除 / 新入口可见 / 开面板 / 自动聚焦 / 命中测试 /
//       【核心】先建立表格选区（旧入口失效的前提）后仍能加列 / 列结构四层对齐 /
//       重名保护 / 弹层互斥 / 死 CSS 清除
const puppeteer = require('puppeteer-core')

const TOKEN = process.env.HG_TOKEN
const TENANT = process.env.HG_TENANT
const NAME = process.env.HG_NAME || 'v170探针客户'

const results = []
function ok(cond, label, extra) {
  results.push({ pass: !!cond, label })
  console.log((cond ? '  ✓ ' : '  ✗ ') + label + (extra ? '   ' + extra : ''))
}
function info(m) { console.log('  · ' + m) }
const sleep = ms => new Promise(r => setTimeout(r, ms))

// —— 页面内通用取数（⚠️ page.evaluate 只序列化「该函数自身」的源码，
//    所以任何 helper 都必须内联，不能引用外部函数/闭包变量）——
function snapTable() {
  const t = [...document.querySelectorAll('table.edit-tbl')].find(tb => tb.querySelector('thead')) || null
  if (!t) return { err: 'no-edit-table' }
  const ths = [...t.querySelectorAll('thead th')]
  const foot = [...document.querySelectorAll('table.edit-tbl')].find(tb => !tb.querySelector('thead'))
  const tr0 = t.querySelector('tbody tr')
  return {
    colgroup: t.querySelectorAll('colgroup col').length,
    ths: ths.length,
    tds: tr0 ? tr0.querySelectorAll('td').length : -1,
    footTds: foot && foot.querySelector('tbody tr') ? foot.querySelector('tbody tr').querySelectorAll('td').length : -1,
    qtyTh: ths.filter(x => x.classList.contains('qty-th')).length,
    custInputs: ths.filter(x => x.querySelector('input.cell-cust')).length,
    // 客户列名字（新列加在「客户列尾部」，其后再跟 extra/amount/… 故不能用 ths.slice(-N) 取）
    custNames: ths.filter(x => x.querySelector('input.cell-cust')).map(x => x.querySelector('input.cell-cust').value),
    spacerTh: ths.filter(x => String(x.className).includes('spacer')).length,
    last2: ths.slice(-2).map(x => x.textContent.trim().slice(0, 4)),
    tailNames: ths.slice(-4).map(x => { const i = x.querySelector('input.cell-cust'); return i ? i.value : x.textContent.trim().slice(0, 4) }),
    custPlaceholder: document.querySelectorAll('input[placeholder="客户名"]').length,
  }
}
function openAddCol() {
  const b = [...document.querySelectorAll('button')].find(x => (x.getAttribute('title') || '').includes('新增客户'))
  if (!b) return false
  if (!document.querySelector('.addcol-pop')) b.click()
  return true
}
function popState() {
  const p = document.querySelector('.addcol-pop')
  if (!p) return { count: 0 }
  const cs = getComputedStyle(p)
  const r = p.getBoundingClientRect()
  const ae = document.activeElement
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + 8)
  const btn = [...document.querySelectorAll('button')].find(x => (x.getAttribute('title') || '').includes('新增客户'))
  return {
    count: document.querySelectorAll('.addcol-pop').length,
    display: cs.display,
    w: +r.width.toFixed(1), h: +r.height.toFixed(1),
    activeIsInput: !!(ae && ae.classList.contains('ac-input')),
    activeCls: ae ? String(ae.className) : '',
    hitInside: hit ? p.contains(hit) : false,
    placeholder: (p.querySelector('.ac-input') || {}).placeholder,
    inputVal: (p.querySelector('.ac-input') || {}).value,
    btnOn: btn ? btn.classList.contains('on') : null,
    tip: ((p.querySelector('.ac-tip') || {}).textContent || '').slice(0, 40),
  }
}

;(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],   // ⚠️ 绝不加 --proxy-server
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900 })
  const errs = [], bad = []
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message))
  page.on('response', r => { if (r.status() >= 400 && !/403/.test(String(r.status()))) bad.push(r.status() + ' ' + r.url().slice(0, 110)) })

  await page.evaluateOnNewDocument((t, ten) => {
    localStorage.setItem('hergent_v2_token', t)
    if (ten) localStorage.setItem('hergent_v2_tenant', String(ten))
  }, TOKEN, TENANT)

  await page.goto('https://hergent.cn/?cb=' + Date.now() + '#/forecast', { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(4500)
  info('落点 URL: ' + page.url())
  ok(!/#\/login/.test(page.url()), '登录态注入成功（未落回 #/login）')

  const boot = await page.evaluate(() => ({
    btns: [...document.querySelectorAll('button')].map(b => b.textContent.trim().replace(/\s+/g, '')).filter(Boolean).slice(0, 26),
    tables: document.querySelectorAll('table').length,
  }))
  info('可见按钮: ' + boot.btns.join(' | ').slice(0, 220))
  if (bad.length) info('非 2xx: ' + bad.join(' ; '))

  // ── 进入编辑态 ──
  const clicked = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('改单'))
    if (b) { b.click(); return true }
    return false
  })
  info('点「改单」: ' + clicked)
  await sleep(5200)

  // 可能弹角色确认框
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /继续|确认|仍然|进入/.test(x.textContent) && x.closest('.pop,.modal,.pop-overlay'))
    if (b) b.click()
  })
  await sleep(2500)

  console.log('\n=== A. 表头入口已撤（v170 核心改动）===')
  const A = await page.evaluate(snapTable)
  if (A.err) { ok(false, '未进入编辑态：' + A.err); await browser.close(); process.exit(1) }
  info('列数：colgroup=' + A.colgroup + ' thead=' + A.ths + ' tbody=' + A.tds + ' 表尾=' + A.footTds)
  info('客户列 ' + A.qtyTh + ' 个（含改名输入框 ' + A.custInputs + '）｜末两列=' + JSON.stringify(A.last2) + '｜尾四列名=' + JSON.stringify(A.tailNames))
  ok(A.custPlaceholder === 0, '页面上已无「客户名」输入框（那个默认在视口外 2475px 的入口）')
  ok(A.spacerTh === 0, '表头已无 spacer 占位列')
  ok(A.last2[0] === '合计' && A.last2[1] === '操作', '末两列 = 合计 → 操作（原先中间夹着入口格）', JSON.stringify(A.last2))
  const N0 = A.qtyTh

  console.log('\n=== B. 工具行新入口 ===')
  const B = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => (x.getAttribute('title') || '').includes('新增客户'))
    if (!b) return { err: 'no-btn' }
    const r = b.getBoundingClientRect()
    const row = b.closest('.grid-ctl-row')
    return {
      text: b.textContent.trim().replace(/\s+/g, ' '), cls: String(b.className),
      w: +r.width.toFixed(1), h: +r.height.toFixed(1),
      inViewport: r.right <= window.innerWidth + 1 && r.left >= 0 && r.top >= 0,
      inCtlRow: !!row, tooltip: (b.getAttribute('title') || '').slice(0, 30),
    }
  })
  if (B.err) ok(false, '工具行未找到「新增客户」按钮')
  else {
    info('按钮「' + B.text + '」 ' + B.w + '×' + B.h + 'px  class=' + B.cls)
    ok(B.inViewport && B.w > 60, '按钮在首屏可视区内（不再需要右滚 1.8 屏）')
    ok(B.inCtlRow, '按钮挂在表格工具行 .grid-ctl-row 上')
  }

  console.log('\n=== C. 【核心】先建立表格选区（旧入口回车失效的前提），再开面板 ===')
  const touched = await page.evaluate(() => {
    const t = [...document.querySelectorAll('table.edit-tbl')].find(tb => tb.querySelector('thead'))
    // ⚠️ 虚拟滚动：必须挑「真正可见且在视口内的」单元格，否则点空（首个 td 常在视口外）
    const vis = [...t.querySelectorAll('tbody td[data-r][data-c]')].find(td => {
      const r = td.getBoundingClientRect()
      return r.width > 4 && r.height > 4 && r.top > 190 && r.bottom < window.innerHeight - 130 && r.left > 70
    })
    if (!vis) return null
    const r = vis.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  info('待点击单元格坐标: ' + (touched ? JSON.stringify(touched) : 'null'))
  if (touched) { await page.mouse.click(touched.x, touched.y); await sleep(400) }
  const sel = await page.evaluate(() => {
    const t = [...document.querySelectorAll('table.edit-tbl')].find(tb => tb.querySelector('thead'))
    return { sel: t.querySelectorAll('td.selected').length, range: t.querySelectorAll('td.range-sel').length }
  })
  info('选区状态: selected=' + sel.sel + ' range-sel=' + sel.range)
  ok(sel.sel > 0 || sel.range > 0, '已建立表格选区（这正是旧表头输入框回车静默失效的场景）')

  const opened = await page.evaluate(openAddCol)
  await sleep(450)
  const C = await page.evaluate(popState)
  ok(opened && C.count === 1 && C.display !== 'none', '点击后弹层出现且可见', C.count + ' 个, display=' + C.display)
  ok(C.activeIsInput, '开面板即自动聚焦输入框（可直接敲名字）', 'activeElement=' + C.activeCls)
  ok(C.hitInside, '弹层未被下层内容压住（命中测试落在面板内）')
  ok(C.btnOn === true, '触发按钮进入 .on 选中态（v169 补的 .btn.on 定义在此生效）')
  ok(C.w <= 340, '面板宽度受控（≤340px，与品牌 240 / 复制报单 320 同一量级）', C.w + 'px')
  info('面板 ' + C.w + '×' + C.h + 'px｜placeholder=' + C.placeholder + '｜tip=' + C.tip + '…')

  console.log('\n=== D. 回车加列（真实键盘） ===')
  await page.click('.addcol-pop .ac-input')
  await page.type('.addcol-pop .ac-input', NAME)
  await sleep(250)
  await page.keyboard.press('Enter')
  await sleep(900)
  const D = await page.evaluate(snapTable)
  const Dp = await page.evaluate(popState)
  info('加列后：colgroup=' + D.colgroup + ' thead=' + D.ths + ' tbody=' + D.tds + ' 表尾=' + D.footTds + '｜客户列=' + D.qtyTh)
  ok(D.qtyTh === N0 + 1, '客户列 ' + N0 + ' → ' + D.qtyTh + '（回车真的加上列了）')
  ok(D.custNames.includes(NAME), '新列名 = ' + NAME + '（挂在客户列尾部，其后仍有 加单/金额/…/合计/操作）', JSON.stringify(D.custNames.slice(-3)))
  ok(D.custInputs === D.qtyTh, '每个客户列都有改名输入框（' + D.custInputs + '/' + D.qtyTh + '）')
  ok(D.colgroup === D.ths && D.ths === D.tds && D.tds === D.footTds,
     '列结构四层对齐 colgroup/thead/tbody/表尾 = ' + D.colgroup + '/' + D.ths + '/' + D.tds + '/' + D.footTds)
  ok(Dp.count === 0, '提交后弹层自动关闭')

  console.log('\n=== E. 重名保护 ===')
  await page.evaluate(openAddCol)
  await sleep(400)
  await page.click('.addcol-pop .ac-input')
  await page.type('.addcol-pop .ac-input', NAME)
  await page.keyboard.press('Enter')
  await sleep(600)
  const E = await page.evaluate(snapTable)
  const Ep = await page.evaluate(popState)
  const Etoast = await page.evaluate(() => { const t = document.querySelector('.toast'); return t ? t.textContent.trim() : null })
  ok(E.qtyTh === N0 + 1, '重名未重复加列（仍 ' + E.qtyTh + ' 列）')
  ok(!!Etoast && Etoast.includes('已存在'), '给出重名提示 toast', JSON.stringify(Etoast))
  ok(Ep.count === 1, '重名时面板保持打开（可直接改名字重试）')

  console.log('\n=== F. 弹层互斥 ===')
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => (x.getAttribute('title') || '').includes('按品牌'))
      || [...document.querySelectorAll('button')].find(x => x.textContent.trim().includes('品牌'))
    if (b) b.click()
  })
  await sleep(500)
  const F = await page.evaluate(() => ({ addcol: document.querySelectorAll('.addcol-pop').length, brand: document.querySelectorAll('.brand-pop').length }))
  ok(F.addcol === 0 && F.brand === 1, '打开品牌筛选时「新增客户」面板自动关闭（同一套互斥生效）', JSON.stringify(F))

  console.log('\n=== G. CSS 层（取生产真实 CSS 文本，比 CSSOM 可靠）===')
  const G = await page.evaluate(async () => {
    const urls = [...document.querySelectorAll('link[rel=stylesheet]')].map(l => l.href)
    let txt = ''
    const meta = []
    for (const u of urls) {
      try { const s = await (await fetch(u)).text(); txt += s; meta.push(u.split('/').pop() + ':' + s.length) } catch (e) { meta.push(u.split('/').pop() + ':ERR') }
    }
    const n = re => (txt.match(re) || []).length
    // 顺带诊断 CSSOM（只读同域可读的那些）
    let cssRules = 0, cssErr = 0
    for (const s of document.styleSheets) { try { cssRules += s.cssRules.length } catch (e) { cssErr++ } }
    return {
      sheets: meta, len: txt.length, cssRules, cssErr,
      addcol: n(/addcol-pop/g), acInput: n(/ac-input/g), acTip: n(/ac-tip/g),
      spacerBound: n(/\.spacer(?![a-zA-Z0-9_-])/g), tdSpacer: n(/td\.spacer/g),
    }
  })
  info('样式表: ' + G.sheets.join(' , ') + '｜合计 ' + G.len + ' 字符｜CSSOM 规则 ' + G.cssRules + ' 条 / 不可读 ' + G.cssErr)
  info('计数: .addcol-pop=' + G.addcol + ' .ac-input=' + G.acInput + ' .ac-tip=' + G.acTip +
       ' .spacer(边界)=' + G.spacerBound + ' td.spacer=' + G.tdSpacer)
  ok(G.addcol > 0 && G.acInput > 0 && G.acTip > 0, '新增弹层样式已进生产 CSS（.addcol-pop / .ac-input / .ac-tip）')
  ok(G.spacerBound === 0 && G.tdSpacer === 0, '.spacer 死规则已从生产 CSS 移除（模板删了 CSS 也删了）')

  // 收尾截图（清理：先把面板关掉再截）
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => (x.getAttribute('title') || '').includes('新增客户')); if (b && document.querySelector('.addcol-pop')) b.click() })
  await sleep(300)
  await page.screenshot({ path: '/tmp/v170-edit-grid.png' })
  info('截图: /tmp/v170-edit-grid.png')

  const pass = results.filter(r => r.pass).length
  console.log('\n=== 结果 ' + pass + '/' + results.length + ' ===')
  results.filter(r => !r.pass).forEach(r => console.log('  FAIL → ' + r.label))
  console.log('CONSOLE_ERRORS: ' + JSON.stringify(errs.filter(e => !/403/.test(e)).slice(0, 5)))
  await browser.close()
  process.exit(pass === results.length ? 0 : 1)
})().catch(e => { console.error('FATAL', e); process.exit(2) })
