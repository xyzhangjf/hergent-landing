/* 右键「增加列」加客户 —— 分态真机取证
 * ==================================================================
 * 待验假设（源码推断，逐条落到真机）：
 *  H1 只读态也能右键客户列表头 → 菜单含「增加列」→ 点击 → 列即时出现
 *     依据：colOrderList 里 units 被 push 成 {type:'qty'}；th 上绑了
 *           @contextmenu.prevent="openHdrCtx($event, col.key, col.type)"
 *           → hdrCtx.type==='qty' → 菜单 template 走 master||qty 分支
 *  H2 只读态加的列**当次不保留**：loadCross() 从 all_units 重建 units，
 *     且 loadCross 不调 loadDraft()（全仓库仅 1 处 loadDraft，在 loadEditGrid）
 *  H3 但草稿仍被写入：watch(cross, {deep}) 无 editMode 守卫 → units.push
 *     也会调度 saveDraftNow()（800ms 防抖，saveDraftNow 无任何守卫）
 *  H4 于是它会在**下次进编辑态时复活**：loadEditGrid → loadDraft 补回本地新增列
 *  H5 编辑态加列：正常，且刷新后由草稿补回（持久）
 *  H6 边界：编辑态那个「客户名」空 th 没有 @contextmenu，右键冒泡到 table 的
 *     onTbCtx，而 onTbCtx 要求 closest('td')（th 不是 td）→ 静默无反应
 *     ⇒ units 为空时（新装/全新期次）编辑态几乎没有加客户列入口
 *
 * 用法：HG_TOKEN=xxx HG_TENANT=9998 node forecast-cust-col-rightclick-probe.js
 */
const puppeteer = require('puppeteer-core')

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = 'https://hergent.cn'
const TOKEN = process.env.HG_TOKEN
const TENANT = process.env.HG_TENANT || '9998'
const sleep = ms => new Promise(r => setTimeout(r, ms))

const NEW_A = '右键新客户A'
const NEW_B = '右键新客户B'

// ── 页面内取数 ────────────────────────────────────────────────
function roState() {
  const t = document.querySelector('table.cross-tbl:not(.edit-tbl)')
  if (!t) return null
  const ths = [...t.querySelectorAll('thead th')]
  const qty = ths.filter(x => x.classList.contains('qty-cell'))
  return { qtyCols: qty.length, labels: qty.map(x => (x.textContent || '').trim()).slice(0, 6) }
}
function edState() {
  const t = document.querySelector('table.edit-tbl')
  if (!t) return null
  const ths = [...t.querySelectorAll('thead th')]
  const cust = ths.filter(x => x.querySelector('.cust-hd'))
  const bus = t.querySelector('input[placeholder="客户名"]')
  return {
    qtyCols: cust.length,
    labels: cust.map(x => { const i = x.querySelector('input'); return i ? i.value : '' }),
    bareAddTh: !!bus,
  }
}
function draftUnits() {
  try {
    let found = null
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.indexOf('forecast_draft_') === 0) {
        const d = JSON.parse(localStorage.getItem(k) || 'null')
        if (d && d.units) found = { key: k, units: d.units.map(u => (u && u.name) || u) }
      }
    }
    return found
  } catch (e) { return null }
}
// ⚠️ 不要用 offsetParent 判可见：position:fixed 元素的 offsetParent 恒为 null
//    （首轮踩过：菜单其实弹出来了，却被过滤成 0 个，误报「右键无反应」）
function visibleMenus() {
  return [...document.querySelectorAll('.ctx-menu')].map(m => {
    const cs = getComputedStyle(m)
    const r = m.getBoundingClientRect()
    const vis = cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0
    return { vis, text: (m.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 140), pos: cs.position }
  }).filter(x => x.vis)
}
function allMenuCount() { return document.querySelectorAll('.ctx-menu').length }
// 直接读 Vue 组件实例里的 hdrCtx 状态：区分「handler 没执行」vs「执行了但菜单块不在当前分支」
function readHdrCtx() {
  const t = document.querySelector('thead th')
  if (!t) return { err: 'no-th' }
  let c = t.__vueParentComponent
  const chain = []
  let guard = 0
  while (c && guard++ < 12) {
    chain.push((c.type && (c.type.__name || c.type.name)) || '?')
    const st = c.setupState
    if (st && st.hdrCtx) {
      const h = st.hdrCtx
      return { comp: chain.join('>'), show: h.show, key: h.key, type: h.type, ui: h.ui, mode: h.mode }
    }
    c = c.parent
  }
  return { comp: chain.join('>'), err: 'hdrCtx-not-found-in-chain' }
}
// hdrCtx 菜单块是否物理存在于当前渲染树（只读态分支是否包含它）
function menuBlockInTree() {
  const t = document.querySelector('thead th')
  if (!t) return { err: 'no-th' }
  let c = t.__vueParentComponent
  let guard = 0
  while (c && guard++ < 12) {
    const st = c.setupState
    if (st && st.hdrCtx) {
      const el = c.subTree && c.subTree.el
      const host = (el && el.nodeType === 1) ? el : (el && el.parentElement)
      return { comp: true, hasCtxMenuInSubtree: !!(host && host.querySelector && host.querySelector('.ctx-menu, .ctx-overlay')) }
    }
    c = c.parent
  }
  return { err: 'no-comp' }
}

// 定位某个 th 并右键
async function rightClickTh(page, selector, matchFn) {
  const r = await page.evaluate((sel, mode) => {
    const t = document.querySelector(sel)
    if (!t) return { err: 'no-table' }
    const ths = [...t.querySelectorAll('thead th')]
    let target = null
    if (mode === 'bare') {
      // 表头那个裸「客户名」新增框所在的 th
      target = ths.find(x => x.querySelector('input[placeholder="客户名"]'))
    } else if (mode === 'master') {
      // 主档列头（只读态带 .th-in，且不是 qty-cell / seq-cell）
      target = ths.find(x => x.querySelector('.th-in') && !x.classList.contains('qty-cell') && !x.classList.contains('seq-cell'))
    } else {
      target = ths.find(x => x.querySelector('.cust-hd'))    // 编辑态客户列
      if (!target) target = ths.find(x => x.classList.contains('qty-cell'))  // 只读态客户列
    }
    if (!target) return { err: 'no-target-th' }
    target.scrollIntoView({ block: 'nearest', inline: 'center' })
    const b = target.getBoundingClientRect()
    return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: Math.round(b.width), label: (target.textContent || '').trim() }
  }, selector, matchFn)
  if (r.err) return r
  // 诊断 + 双通道触发：先人工派发 contextmenu（不受 CDP 右键合成影响），
  // 若仍无菜单再退回真实鼠标右键，以此区分「没合成事件」vs「逻辑没弹」
  const diag = await page.evaluate((x, y) => {
    window.__cmLog = []
    document.addEventListener('contextmenu', e => {
      const t = e.target
      window.__cmLog.push('capture:' + (t && t.tagName) + '(' + ((t && typeof t.className === 'string') ? t.className.split(/\s+/)[0] : '') + ')')
    }, true)
    const el = document.elementFromPoint(x, y)
    const chain = []
    let n = el
    while (n && n !== document.body && chain.length < 5) {
      chain.push(n.tagName + ((typeof n.className === 'string' && n.className) ? '.' + n.className.split(/\s+/)[0] : ''))
      n = n.parentElement
    }
    if (el) el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 2, buttons: 2 }))
    return { chain: chain.join(' < '), hasTh: !!(el && el.closest('th')) }
  }, r.x, r.y)
  await sleep(500)
  r.hit = diag.chain
  r.cmLog = await page.evaluate(() => window.__cmLog || [])
  r.menuCount = await page.evaluate(allMenuCount)
  r.hdr = await page.evaluate(readHdrCtx)
  r.via = 'dispatchEvent'
  if (r.menuCount === 0) {
    await page.mouse.click(r.x, r.y, { button: 'right' })
    await sleep(550)
    r.menuCount = await page.evaluate(allMenuCount)
    r.hdr2 = await page.evaluate(readHdrCtx)
    r.via = 'dispatchEvent+realMouse'
  }
  return r
}

async function clickMenuBtn(page, text) {
  return await page.evaluate(txt => {
    const ms = [...document.querySelectorAll('.ctx-menu')].filter(m => {
      const cs = getComputedStyle(m); const r = m.getBoundingClientRect()
      return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0
    })
    for (const m of ms) {
      const b = [...m.querySelectorAll('button')].find(x => (x.textContent || '').indexOf(txt) >= 0)
      if (b) { b.click(); return true }
    }
    return false
  }, text)
}

async function typeAddName(page, name) {
  await sleep(350)
  const has = await page.evaluate(() => !!document.querySelector('input[placeholder="新列名称"]'))
  if (!has) { console.log('   ·    ⚠️ 未出现「新列名称」输入框 → 增加列流程未启动'); return false }
  await page.click('input[placeholder="新列名称"]').catch(() => {})
  await page.type('input[placeholder="新列名称"]', name)
  await page.evaluate(() => {
    const i = document.querySelector('input[placeholder="新列名称"]')
    if (i) i.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
  })
  await sleep(400)
  return true
}

async function clickText(page, txt) {
  return await page.evaluate(t => {
    const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').replace(/\s+/g, '').indexOf(t) >= 0)
    if (b) { b.click(); return true }
    return false
  }, txt)
}

;(async () => {
  let PASS = 0, FAIL = 0
  const ok = (c, m) => { c ? (PASS++, console.log('  PASS  ' + m)) : (FAIL++, console.log('  FAIL  ' + m)) }
  const info = m => console.log('   ·    ' + m)
  const head = m => console.log('\n【' + m + '】')

  if (!TOKEN) { console.log('缺 HG_TOKEN'); process.exit(1) }

  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--force-device-scale-factor=1'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1680, height: 950, deviceScaleFactor: 1 })
  const errs = []
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message))

  await page.evaluateOnNewDocument((t, ten) => {
    localStorage.setItem('hergent_v2_token', t)
    localStorage.setItem('hergent_v2_tenant', String(ten))
    localStorage.setItem('hergent_v2_user', JSON.stringify({ role: 'boss', username: 'sbx_rclick', display_name: '右键加列探针' }))
    // 清干净：只清草稿键，不留污染（每次新会话从零开始）
    const ks = []
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.indexOf('forecast_draft_') === 0) ks.push(k) }
    ks.forEach(k => localStorage.removeItem(k))
  }, TOKEN, TENANT)

  await page.goto(BASE + '/?cb=' + Date.now() + '#/forecast', { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(6000)

  // ══ 前置：确认处于只读态 ══════════════════════════════════
  head('0. 前置状态')
  const s0 = await page.evaluate(() => {
    const ro = document.querySelector('table.cross-tbl:not(.edit-tbl)')
    const ed = document.querySelector('table.edit-tbl')
    return { ro: !!ro, ed: !!ed }
  })
  ok(s0.ro && !s0.ed, `初始为只读态（只读表 ${s0.ro ? '在' : '不在'} / 编辑表 ${s0.ed ? '在' : '不在'}）`)
  const ro0 = await page.evaluate(roState)
  ok(!!ro0 && ro0.qtyCols > 0, `只读态有客户列 ${ro0 ? ro0.qtyCols : '?'} 个（前几个：${ro0 ? ro0.labels.join('、') : ''}）`)
  const N0 = ro0 ? ro0.qtyCols : 0
  info(`草稿初始状态：${JSON.stringify(await page.evaluate(draftUnits))}`)

  // ══ A. 只读态右键客户列表头 → 增加列 ═══════════════════════
  head('A. 只读态：右键客户列表头 → 「增加列」')
  const rc = await rightClickTh(page, 'table.cross-tbl:not(.edit-tbl)', undefined)
  if (rc.err) {
    ok(false, `只读态定位客户列表头失败：${rc.err}`)
  } else {
    info(`右键落在表头「${rc.label}」（宽 ${rc.w}px）；触发方式=${rc.via}`)
    info(`落点祖先链：${rc.hit}；捕获期 contextmenu 事件：${JSON.stringify(rc.cmLog)}；.ctx-menu 节点数=${rc.menuCount}`)
    const menus = await page.evaluate(visibleMenus)
    ok(rc.cmLog.length > 0, `右键事件确实到达只读表头 th（捕获期记录 ${rc.cmLog.length} 条）`)
    ok(menus.length === 0 && rc.menuCount === 0, `但没有任何菜单渲染（.ctx-menu 节点 ${rc.menuCount} 个）⇒ 只读态右键表头【静默无反应】`)
    info('机制：th 上确实绑了 @contextmenu.prevent="openHdrCtx"，但 hdrCtx 菜单的 DOM 块')
    info('      （.ctx-menu / .ctx-overlay，源码 1315–1457 行）只写在编辑态 v-else 分支内')
    info('      （与 .edit-grid-wrap 同级）⇒ 只读态即便 hdrCtx.show=true 也无处渲染')

    const rcM = await rightClickTh(page, 'table.cross-tbl:not(.edit-tbl)', 'master')
    if (!rcM.err) {
      const menusM = await page.evaluate(visibleMenus)
      ok(rcM.menuCount === 0 && menusM.length === 0, `换 master 列头（「${rcM.label}」）右键同样静默 ⇒ 是整表头普遍现象，非客户列特有`)
    }

    await sleep(900)
    const d1 = await page.evaluate(draftUnits)
    ok(!!d1 && d1.units.length === N0, `只读态下 localStorage 草稿仍被写入（watch(cross,{deep}) 无 editMode 守卫）：units ${d1 ? d1.units.length : '?'} = 列数 ${N0}`)
  }

  // ══ B. 编辑态：右键客户列表头 → 增加列 + 草稿复活 ══════════
  head('B. 编辑态：右键客户列表头 → 「增加列」+ 草稿复活验证')
  const toEdit = await clickText(page, '改单')
  ok(toEdit, '点到「改单」进入编辑态')
  await sleep(5000)
  const ed0 = await page.evaluate(edState)
  ok(!!ed0 && ed0.qtyCols > 0, `编辑态客户列 ${ed0 ? ed0.qtyCols : '?'} 个`)
  info(`只读态没加成（见 A 段），故此处不应出现「${NEW_A}」：${JSON.stringify(ed0 ? ed0.labels.slice(0, 3) : null)}…`)
  const M0 = ed0 ? ed0.qtyCols : 0

  const rc2 = await rightClickTh(page, 'table.edit-tbl', undefined)
  if (rc2.err) {
    ok(false, `编辑态定位客户列表头失败：${rc2.err}`)
  } else {
    const menus2 = await page.evaluate(visibleMenus)
    info(`触发方式=${rc2.via}；祖先链=${rc2.hit}；事件=${JSON.stringify(rc2.cmLog)}；可见菜单 ${menus2.length} 个：${menus2.map(m => m.text).join(' | ').slice(0, 140)}`)
    ok(menus2.some(m => m.text.indexOf('增加列') >= 0), '编辑态菜单里也有「增加列」')
    const c2 = await clickMenuBtn(page, '增加列')
    ok(c2, '点到「增加列」')
    const typedB = await typeAddName(page, NEW_B)
    ok(typedB, `编辑态「增加列」输入「${NEW_B}」`)
    await sleep(900)
    if (!typedB) { await browser.close(); process.exit(1) }
    const ed1 = await page.evaluate(edState)
    ok(ed1 && ed1.qtyCols === M0 + 1, `编辑表客户列数 ${M0} → ${ed1 ? ed1.qtyCols : '?'}`)

    // ① 加列后草稿应立刻含新列
    await sleep(1000)
    const dAdd = await page.evaluate(draftUnits)
    ok(!!dAdd && dAdd.units.indexOf(NEW_B) >= 0, `加列后 localStorage 草稿里含「${NEW_B}」（units ${dAdd ? dAdd.units.length : '?'} 个）`)

    // ② 整页重载 → 落回只读态 → 草稿是否被只读态覆盖
    await page.reload({ waitUntil: 'networkidle2', timeout: 60000 })
    await sleep(5500)
    const dAfter = await page.evaluate(draftUnits)
    const wiped = !(dAfter && dAfter.units.indexOf(NEW_B) >= 0)
    ok(wiped, `⚠️ 重载回到只读态后，草稿里的「${NEW_B}」已被覆盖（units ${dAfter ? dAfter.units.length : '?'} 个）`)
    info('根因：loadCross() 整体替换 cross 时【没有】_ignoreNextWatch 抑制（loadEditGrid 有，见源码 2342/2344），')
    info('      而无 editMode 守卫的 watch(cross,{deep}) 会把只读态的列集写回同一个草稿键 → 覆盖掉编辑态新增列')

    // ③ 再进编辑态：列没回来
    const back = await clickText(page, '改单')
    await sleep(5000)
    const ed2 = await page.evaluate(edState)
    const kept = !!(ed2 && ed2.labels.indexOf(NEW_B) >= 0)
    ok(!kept, `进编辑态后「${NEW_B}」未恢复（列数 ${ed2 ? ed2.qtyCols : '?'}）⇒ 右键加的客户列【刷新/切只读态后丢失】`)
    info(`重载后编辑态客户列 ${ed2 ? ed2.qtyCols : '?'} 个：${ed2 ? ed2.labels.slice(0, 5).join('、') : ''}…`)
  }

  // ══ C. 边界：右键那个裸「客户名」空格子 ════════════════════
  head('C. 边界：右键表头「客户名」空 th（units 为空时的最后手段）')
  const bare = await rightClickTh(page, 'table.edit-tbl', 'bare')
  if (bare.err) {
    ok(false, `未找到裸「客户名」th：${bare.err}`)
  } else {
    const menus3 = await page.evaluate(visibleMenus)
    const noMenu = menus3.length === 0
    ok(noMenu, `右键裸「客户名」格子 → ${noMenu ? '无任何菜单弹出（静默）' : '弹出了菜单：' + JSON.stringify(menus3)}`)
    info('依据：该 th 未绑 @contextmenu，冒泡到 table 的 onTbCtx，而 onTbCtx 要求 closest(\'td\')，th 不是 td → 直接 return')
    await page.keyboard.press('Escape').catch(() => {})
    await page.evaluate(() => { document.body.click() }).catch(() => {})
  }

  // ══ 收尾 ══════════════════════════════════════════════════
  head('结果')
  const netErrs = errs.filter(e => !/favicon|404|Failed to load resource/i.test(e))
  ok(netErrs.length === 0, `控制台无脚本错误（${netErrs.length}）${netErrs.length ? '：' + netErrs.slice(0, 2).join(' / ') : ''}`)
  console.log(`\n  ===== PASS ${PASS} / FAIL ${FAIL} =====\n`)
  await browser.close()
  process.exit(FAIL ? 1 : 0)
})()
