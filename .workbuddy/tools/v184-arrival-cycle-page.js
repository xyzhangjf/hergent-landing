// v184 真机验证：预报「到货周期」固定列
// 用法:
//   HG_TOKEN=<token> HG_TENANT=9999 NODE_PATH=<ws>/node_modules node v184-arrival-cycle-page.js [pass]
//   pass=1 → 现状（修复前，应复现 off-archive 行显示「—」）
//   pass=2 → 修复后（off-archive 行应显示 +3天）
//
// 覆盖用户逐条提出的要求：
//   ① 固定列存在且位置正确（紧跟商品名称）
//   ② 冻结行为：position:sticky + left 精确等于「序号+商品名称」列宽之和（不是硬编码猜值）
//   ③ 横向滚动后 left 不变（真固定）；并设对照列证明滚动确实发生（防假 PASS）
//   ④ 展示格式 +3天 / 空值 —
//   ⑤ 【核心】页面显示 ↔ 导入解析 一致：导入 +4天 的商品，页面必须显示 +4天
//   ⑥ off-archive（已停用但被本期引用）行不得丢字段
//   ⑦ 编辑态该列只读：无 input、Delete 清除计数为 0
const puppeteer = require('puppeteer-core')

const TOKEN = process.env.HG_TOKEN
const TENANT = process.env.HG_TENANT || '9999'
const PASS = process.env.HG_PASS || '1'

const results = []
function ok(cond, label, extra) {
  results.push({ pass: !!cond, label })
  console.log((cond ? '  ✓ ' : '  ✗ ') + label + (extra ? '   ' + extra : ''))
}
function info(m) { console.log('  · ' + m) }
const sleep = ms => new Promise(r => setTimeout(r, ms))

// ── 页面内取数（helper 必须内联：page.evaluate 只序列化函数自身）──
function snapHeader() {
  const t = [...document.querySelectorAll('table.cross-tbl')].find(tb => tb.getAttribute('role') === 'grid')
  if (!t) return { err: 'no-view-table' }
  const cols = [...t.querySelectorAll('colgroup col')].map(c => {
    const st = c.getAttribute('style') || ''
    const m = /width:\s*([\d.]+)px/.exec(st)
    return m ? +m[1] : null
  })
  const ths = [...t.querySelectorAll('thead th')]
  const out = ths.map(th => {
    const cs = getComputedStyle(th)
    return {
      label: (th.querySelector('.th-in span') || {}).textContent ? th.querySelector('.th-in span').textContent.trim() : (th.classList.contains('seq-th') || th.querySelector('.gear') ? '[序号]' : ''),
      cls: String(th.className),
      frozenClass: th.classList.contains('frozen'),
      pos: cs.position,
      left: cs.left,
      inlineLeft: th.style.left || '',
      rectLeft: +th.getBoundingClientRect().left.toFixed(1),
      width: +th.getBoundingClientRect().width.toFixed(1),
    }
  })
  // 全部表格（含表尾那几张）
  const tables = [...document.querySelectorAll('table.cross-tbl')].map((tb, i) => ({
    i, hasThead: !!tb.querySelector('thead'), cls: String(tb.className),
    cols: tb.querySelectorAll('colgroup col').length,
    ths: tb.querySelectorAll('thead th').length,
    firstRowTds: (tb.querySelector('tbody tr') || { querySelectorAll: () => [] }).querySelectorAll('td').length,
  }))
  return { cols, ths: out, tables }
}

function snapFooter() {
  // 表尾是**另一张 table**（无 thead）
  const tables = [...document.querySelectorAll('table.cross-tbl')].filter(tb => !tb.querySelector('thead'))
  return tables.map(tb => {
    const tds = [...(tb.querySelector('tbody tr') || { querySelectorAll: () => [] }).querySelectorAll('td')]
    return tds.map(td => {
      const cs = getComputedStyle(td)
      return { cls: String(td.className), text: td.textContent.trim().slice(0, 12), pos: cs.position, left: cs.left, inlineLeft: td.style.left || '' }
    })
  })
}

function findScrollBox() {
  const t = [...document.querySelectorAll('table.cross-tbl')].find(tb => tb.getAttribute('role') === 'grid')
  if (!t) return { err: 'no-table' }
  let el = t.parentElement
  while (el && el !== document.body) {
    if (el.scrollWidth > el.clientWidth + 20) {
      return { sw: el.scrollWidth, cw: el.clientWidth, cls: String(el.className), sh: el.scrollHeight, ch: el.clientHeight }
    }
    el = el.parentElement
  }
  return { err: 'no-scrollbox' }
}

function scrollTo(x, y) {
  const t = [...document.querySelectorAll('table.cross-tbl')].find(tb => tb.getAttribute('role') === 'grid')
  let el = t.parentElement
  while (el && el !== document.body) {
    if (el.scrollWidth > el.clientWidth + 20) {
      if (x != null) el.scrollLeft = x
      if (y != null) el.scrollTop = y
      return { sl: el.scrollLeft, st: el.scrollTop }
    }
    el = el.parentElement
  }
  return null
}

// 虚拟滚动遍历：逐步下滚，收集 pid → 到货周期文案 + 是否 off-archive
function collectCycle() {
  const t = [...document.querySelectorAll('table.cross-tbl')].find(tb => tb.getAttribute('role') === 'grid')
  const out = {}
  t.querySelectorAll('tbody tr.data-row').forEach(tr => {
    const td = tr.querySelector('td.fc-cycle')
    if (!td) return
    const pid = td.getAttribute('data-pid')
    if (!pid) return
    const nameCell = tr.querySelector('td.fc-name')
    out[pid] = {
      cycle: td.textContent.trim(),
      cls: String(td.className),
      inlineLeft: td.style.left || '',
      pos: getComputedStyle(td).position,
      offTag: !!(nameCell && nameCell.querySelector('.off-tag')),
      impTag: !!(nameCell && nameCell.querySelector('.imp-tag')),
    }
  })
  return out
}

function curScrollTop() {
  const t = [...document.querySelectorAll('table.cross-tbl')].find(tb => tb.getAttribute('role') === 'grid')
  let el = t.parentElement
  while (el && el !== document.body) {
    if (el.scrollHeight > el.clientHeight) return el.scrollTop
    el = el.parentElement
  }
  return 0
}

;(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900 })
  const errs = []
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message))

  await page.evaluateOnNewDocument((t, ten) => {
    localStorage.setItem('hergent_v2_token', t)
    localStorage.setItem('hergent_v2_tenant', String(ten))
  }, TOKEN, TENANT)

  await page.goto('https://hergent.cn/?cb=' + Date.now() + '#/forecast', { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(6000)
  info('落点 URL: ' + page.url())
  ok(!/#\/login/.test(page.url()), '登录态注入成功')

  console.log('\n=== A. 表头结构：列位置 ===')
  const A = await page.evaluate(snapHeader)
  if (A.err) { ok(false, '未找到查看态交叉表：' + A.err); await browser.close(); process.exit(1) }
  const labels = A.ths.map(x => x.label)
  info('可见列（' + A.ths.length + '）: ' + JSON.stringify(labels))
  info('colgroup 列宽: ' + JSON.stringify(A.cols))
  info('页面上的表格: ' + JSON.stringify(A.tables))
  const cyIdx = labels.indexOf('到货周期')
  const nmIdx = labels.indexOf('商品名称')
  ok(cyIdx >= 0, '「到货周期」列存在', 'index=' + cyIdx)
  ok(nmIdx >= 0 && cyIdx === nmIdx + 1, '位置：紧跟「商品名称」之后', '商品名称=' + nmIdx + ' 到货周期=' + cyIdx)
  ok(A.ths.length === A.cols.length, '表头格数与 colgroup 列数一致', A.ths.length + '/' + A.cols.length)

  console.log('\n=== B. 冻结行为（sticky + left 精确值）===')
  const cyTh = A.ths[cyIdx]
  info('该列表头: ' + JSON.stringify(cyTh))
  ok(cyTh.frozenClass, '表头带 .frozen 类')
  ok(cyTh.pos === 'sticky', 'computed position = sticky', cyTh.pos)
  // left 必须 = 序号列宽 + 商品名称列宽（按 colW 累加，不是硬编码 200）
  const expectLeft = (A.cols[0] || 0) + (A.cols[nmIdx] || 0)
  const actualLeft = parseFloat(cyTh.inlineLeft)
  info('期望 left = colW(序号)' + A.cols[0] + ' + colW(商品名称)' + A.cols[nmIdx] + ' = ' + expectLeft + 'px；实际 inline left = ' + cyTh.inlineLeft)
  ok(Math.abs(actualLeft - expectLeft) < 0.6, 'inline left 精确等于「序号+商品名称」列宽之和（旧实现硬编码 200 会偏 10px）',
    'actual=' + actualLeft + ' expect=' + expectLeft)
  ok(parseFloat(cyTh.left) === actualLeft, 'computed left 与 inline 一致', cyTh.left)

  // 表尾（另一张 table）
  const Bf = await page.evaluate(snapFooter)
  info('表尾表格数 = ' + Bf.length)
  let footHit = null
  for (const tds of Bf) { const hit = tds.find(x => String(x.cls).includes('fc-cycle')); if (hit) { footHit = hit; break } }
  if (footHit) {
    info('表尾该列: ' + JSON.stringify(footHit))
    ok(footHit.pos === 'sticky' && Math.abs(parseFloat(footHit.inlineLeft) - expectLeft) < 0.6,
      '表尾（另一张 table）该列同样 sticky 且 left 与表体一致', 'left=' + footHit.inlineLeft)
  } else {
    ok(false, '表尾未找到 fc-cycle 列（表尾应与表体同列结构）')
  }

  console.log('\n=== C. 横向滚动后仍固定（含对照列）===')
  const before = { th: cyTh.rectLeft }
  const box = await page.evaluate(findScrollBox)
  info('滚动容器: ' + JSON.stringify(box))
  const moved = await page.evaluate(scrollTo, 420, null)
  await sleep(700)
  const C = await page.evaluate(snapHeader)
  const cyTh2 = C.ths[cyIdx]
  const nmTh2 = C.ths[nmIdx]
  // 对照：找一个未冻结列（取最后可见列）
  const freeIdx = C.ths.map((x, i) => ({ i, f: x.frozenClass })).filter(x => !x.f).map(x => x.i).filter(i => i > cyIdx)
  const freeBefore = A.ths[freeIdx[0]].rectLeft
  const freeAfter = C.ths[freeIdx[0]].rectLeft
  info('scrollLeft 设为 420 → 实际 ' + JSON.stringify(moved))
  info('到货周期 th left: ' + before.th + ' → ' + cyTh2.rectLeft + '（应不变）')
  info('商品名称 th left: ' + A.ths[nmIdx].rectLeft + ' → ' + nmTh2.rectLeft + '（应不变）')
  info('对照列[' + C.ths[freeIdx[0]].label + '] left: ' + freeBefore + ' → ' + freeAfter + '（应变小）')
  ok(Math.abs(cyTh2.rectLeft - before.th) < 1, '横向滚动后「到货周期」表头屏幕位置不变（真固定）', before.th + ' → ' + cyTh2.rectLeft)
  ok(Math.abs(nmTh2.rectLeft - A.ths[nmIdx].rectLeft) < 1, '「商品名称」也不动（同属左侧冻结区）')
  ok(freeAfter < freeBefore - 50, '对照列确实左移了（证明滚动真的发生，防止假 PASS）', freeBefore + ' → ' + freeAfter)
  await page.evaluate(scrollTo, 0, null)
  await sleep(500)

  console.log('\n=== D. 单元格式文案（虚拟滚动遍历全部行）===')
  const acc = {}
  let guard = 0
  let top = 0
  while (guard++ < 60) {
    const got = await page.evaluate(collectCycle)
    Object.assign(acc, got)
    const ct = await page.evaluate(curScrollTop)
    if (ct === top && guard > 2) break
    top = ct
    const r = await page.evaluate(scrollTo, null, ct + 420)
    await sleep(260)
    if (!r || r.st === ct) break
  }
  await page.evaluate(scrollTo, null, 0)
  await sleep(400)
  info('遍历到行数 = ' + Object.keys(acc).length)
  const sample = Object.entries(acc).slice(0, 6).map(([k, v]) => k + ':' + v.cycle)
  info('样本: ' + JSON.stringify(sample))
  const dist = {}
  Object.values(acc).forEach(v => { dist[v.cycle] = (dist[v.cycle] || 0) + 1 })
  info('文案分布: ' + JSON.stringify(dist))

  const EXP = { '1161': '+4天', '1162': '+3天', '1523': '+3天', '1164': '—' }
  /* ⚠️ 下面这组期望值 / off-archive pid 是 **2026-09-17 那一次沙箱（克隆源与其时点）的 fixture**。
     换一份沙箱数据后这些 pid 可能根本不在本期行底 —— 那不是产品缺陷，只是 fixture 过期。
     故「没遍历到」时报**未覆盖**（info），不要报 FAIL（否则会把人引到错误的方向去查产品）。
     🔴 需要**数据集无关**的同义验证，请用 `v184b-offarchive-forecast.js`：它的期望值从接口现取、
     逐行双向核对，并会自己播种子造出「带值的 off-archive 行」，换数据也照样有效。 */
  for (const [pid, want] of Object.entries(EXP)) {
    const got = acc[pid]
    if (!got) { info('未覆盖 pid=' + pid + '（本数据集本期行底里没有它 —— fixture 过期，非缺陷）'); continue }
    ok(got.cycle === want, 'pid=' + pid + ' 页面显示「' + want + '」', 'got=' + JSON.stringify(got.cycle) + ' frozen=' + got.pos + ' left=' + got.inlineLeft)
  }
  // 【核心】off-archive 行
  const off = acc['1160']
  if (!off) {
    info('未覆盖 off-archive 行 pid=1160（本数据集无此 fixture，非缺陷）→ 改跑 v184b-offarchive-forecast.js')
  } else {
    info('pid=1160: ' + JSON.stringify(off))
    ok(off.offTag, 'pid=1160 确实是 off-archive 行（带「已停用」角标）')
    if (PASS === '1') {
      ok(off.cycle === '—', '【复现】修复前：off-archive 行显示「—」，而 DB 里是 3 → 页面与导入不一致', 'got=' + off.cycle)
    } else {
      ok(off.cycle === '+3天', '【修复后】off-archive 行显示「+3天」，与 DB/导入解析一致', 'got=' + off.cycle)
    }
  }
  ok(dist['—'] > 0, '存在显示「—」的行（空值渲染路径成立，不是全都有值）', '共 ' + dist['—'] + ' 行')

  console.log('\n=== E. 编辑态：该列只读 ===')
  const clicked = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.replace(/\s+/g, '').includes('改单'))
    if (b) { b.click(); return true }
    return false
  })
  info('点「改单」: ' + clicked)
  await sleep(6000)
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /继续|确认|仍然|进入/.test(x.textContent) && x.closest('.pop,.modal,.pop-overlay'))
    if (b) b.click()
  })
  await sleep(3000)
  const E = await page.evaluate(() => {
    const t = [...document.querySelectorAll('table.edit-tbl')].find(tb => tb.querySelector('thead'))
    if (!t) return { err: 'no-edit-table' }
    const idx = [...t.querySelectorAll('thead th')].findIndex(th => th.textContent.trim().startsWith('到货周期'))
    const tr = [...t.querySelectorAll('tbody tr')].find(r => r.querySelector('td.fc-cycle'))
    const td = tr ? tr.querySelector('td.fc-cycle') : null
    const foot = [...document.querySelectorAll('table.edit-tbl')].find(tb => !tb.querySelector('thead'))
    const ftr = foot ? foot.querySelector('tbody tr') : null
    const ftds = ftr ? [...ftr.querySelectorAll('td')] : []
    // ⚠️ 编辑态表尾的 td **不带 colCls**（只有 'num calc'）⇒ 不能按 fc-cycle 类找，只能按**列序**对齐。
    //    表尾 = [seq-cell] + visibleCols + units + calc，与表头 [seq] + visibleCols + … 逐列同序。
    const ftd = idx >= 0 ? (ftds[idx] || null) : null
    const unitIdx = [...t.querySelectorAll('thead th')].findIndex(th => th.classList.contains('qty-th'))
    const unitFoot = unitIdx >= 0 ? (ftds[unitIdx] || null) : null
    return {
      thIdx: idx,
      thLabel: idx >= 0 ? [...t.querySelectorAll('thead th')][idx].textContent.trim() : '',
      footThs: ftds.length,
      headThs: [...t.querySelectorAll('thead th')].length,
      hasTd: !!td,
      tdCls: td ? String(td.className) : '',
      inputsInside: td ? td.querySelectorAll('input,textarea,select').length : -1,
      roText: td && td.querySelector('.cell-ro') ? td.querySelector('.cell-ro').textContent.trim() : null,
      tdText: td ? td.textContent.trim() : '',
      footText: ftd ? ftd.textContent.trim() : null,
      footCls: ftd ? String(ftd.className) : '',
      footIsNumber: ftd ? /^[\d,]+(\.\d+)?$/.test(ftd.textContent.trim()) : null,
      unitFootText: unitFoot ? unitFoot.textContent.trim() : null,
      unitFootIsNumber: unitFoot ? /^[\d,]+(\.\d+)?$/.test(unitFoot.textContent.trim()) : null,
      // 对照：数量列（客户列）必须有 input
      numInputs: [...t.querySelectorAll('tbody tr')].slice(0, 3).reduce((s, r) => s + r.querySelectorAll('input').length, 0),
    }
  })
  if (E.err) { ok(false, '未进入编辑态：' + E.err) } else {
    info('编辑态该列: ' + JSON.stringify(E))
    ok(E.hasTd, '编辑态存在该列单元格', 'class=' + E.tdCls)
    ok(E.inputsInside === 0, '【核心】该列单元格内**没有任何 input**（不是假旋钮）', 'inputs=' + E.inputsInside)
    ok(E.tdCls.includes('cell-ro') || E.roText != null, '走只读渲染分支 .cell-ro', 'text=' + JSON.stringify(E.roText))
    ok(E.numInputs > 0, '对照：同排确实有别的 input（证明不是整表都没渲染）', '前3行 input 数=' + E.numInputs)
    ok(E.footThs === E.headThs, '表尾格数与表头一致（列序对齐可用）', E.footThs + '/' + E.headThs)
    ok(E.footIsNumber === false && E.footText === '', '表尾该列**不参与合计**（合计只累 edit:num 列 ⇒ 该格为空串）', 'foot=' + JSON.stringify(E.footText))
    ok(E.unitFootIsNumber === true, '对照：同一行里数量列表尾**是数字**（证明表尾确实在算合计）', 'unitFoot=' + JSON.stringify(E.unitFootText))

    console.log('\n=== F. 只读闸门：右键「清空此单元格」（真机上唯一可达的 clearRange 路径）===')
    // ⚠️ 编辑态没有全局 keydown：@keydown 挂在 <table> 上，而 td 无 tabindex、
    //    焦点只能落在 input 上；Delete 在 input 里被显式放行（删字符）。
    //    故「清空」的真实入口是右键菜单的 ctxClear —— 而它**绕过 writeCellVal**、
    //    直接对 rw[key] 赋值 ⇒ 必须单独验证（v184 已在此加只读闸门）。
    const rc = await page.evaluate(() => {
      const t = [...document.querySelectorAll('table.edit-tbl')].find(tb => tb.querySelector('thead'))
      const vis = x => { const r = x.getBoundingClientRect(); return r.width > 4 && r.height > 4 && r.top > 150 && r.bottom < window.innerHeight - 120 }
      const cy = [...t.querySelectorAll('tbody td.fc-cycle')].find(vis)
      /* ⚠️ 对照格必须**原本非空** —— 第一版取的是「第一个 fc-text 列」，那格本来就是空的，
         「清空后仍为空」于是恒真 = 假 PASS（实测发现）。改为要求它含一个非空文本 input。 */
      const writable = [...t.querySelectorAll('tbody td')].find(x => {
        if (!vis(x)) return false
        const inp = x.querySelector('input.cell-input')
        return !!(inp && inp.type !== 'number' && String(inp.value).trim() !== '')
      })
      const snap = x => {
        const r = x.getBoundingClientRect()
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: x.dataset.r, c: x.dataset.c, text: x.textContent.trim(), val: x.querySelector('input') ? x.querySelector('input').value : null }
      }
      return { cy: cy ? snap(cy) : null, writable: writable ? snap(writable) : null }
    })
    info('只读格: ' + JSON.stringify(rc.cy) + '｜对照可写格: ' + JSON.stringify(rc.writable))

    async function ctxClearAt(pt) {
      await page.mouse.click(pt.x, pt.y, { button: 'right' })
      await sleep(600)
      const label = await page.evaluate(() => {
        const b = [...document.querySelectorAll('.ctx-menu button')].find(x => x.textContent.includes('清空'))
        return b ? b.textContent.replace(/\s+/g, '').trim() : null
      })
      if (label == null) { await page.keyboard.press('Escape'); return { label: null } }
      await page.evaluate(() => {
        const b = [...document.querySelectorAll('.ctx-menu button')].find(x => x.textContent.includes('清空'))
        if (b) b.click()
      })
      await sleep(700)
      const after = await page.evaluate(() => {
        const t = document.querySelector('.toast')
        return { toast: t ? t.textContent.trim() : null }
      })
      return { label, toast: after.toast }
    }

    if (rc.cy) {
      const r1 = await ctxClearAt(rc.cy)
      info('只读列右键「' + r1.label + '」→ toast=' + JSON.stringify(r1.toast))
      const now = await page.evaluate(() => {
        const t = [...document.querySelectorAll('table.edit-tbl')].find(tb => tb.querySelector('thead'))
        const td = [...t.querySelectorAll('tbody td.fc-cycle')].find(x => x.textContent.trim())
        return td ? td.textContent.trim() : null
      })
      // v184b：提示语已改为「在网格里只读；要改请到「商品档案」页…」——断言从「匹配旧原话」
      //   改成「匹配意图」：① 明确拒绝 ② 指向一个**真实存在**的改法。写死原话会让
      //   文案优化变成假失败（2026-09-17 实测踩过）。
      ok(r1.toast && r1.toast.includes('只读') && r1.toast.includes('商品档案'),
        '右键清空只读列 → 明确拒绝并说明该去哪改', JSON.stringify(r1.toast))
      ok(now === rc.cy.text, '该格文本未被清空（只读列拒绝写入）', rc.cy.text + ' → ' + now)
    } else ok(false, '编辑态未找到可见的到货周期格')

    if (rc.writable) {
      ok(rc.writable.val !== '' && rc.writable.val != null, '对照格选取正确：原本**非空**（否则「清空后为空」是假 PASS）', 'r=' + rc.writable.r + ' c=' + rc.writable.c + ' val=' + JSON.stringify(rc.writable.val))
      const r2 = await ctxClearAt(rc.writable)
      await sleep(500)
      const now2 = await page.evaluate((rr, cc) => {
        const el = document.querySelector('table.edit-tbl input[data-r="' + rr + '"][data-c="' + cc + '"]')
        return el ? el.value : null
      }, rc.writable.r, rc.writable.c)
      info('对照可写格 [' + rc.writable.r + ',' + rc.writable.c + '] 右键「' + r2.label + '」→ 值 ' + JSON.stringify(rc.writable.val) + ' → ' + JSON.stringify(now2))
      ok(r2.label && r2.label.includes('清空'), '对照：同一菜单在可写格上正常出现「清空」入口', JSON.stringify(r2.label))
      ok(now2 === '', '对照：可写格被**真的清空**了（证明闸门只对只读列生效，不是整菜单失效）', JSON.stringify(rc.writable.val) + ' → ' + JSON.stringify(now2))
    } else ok(false, '编辑态未找到非空的可写对照格')
  }

  await page.screenshot({ path: '/tmp/v184-pass' + PASS + '-view.png', fullPage: false })
  info('截图: /tmp/v184-pass' + PASS + '-view.png')

  const pass = results.filter(r => r.pass).length
  console.log('\n=== 结果 ' + pass + '/' + results.length + ' (pass=' + PASS + ') ===')
  results.filter(r => !r.pass).forEach(r => console.log('  FAIL → ' + r.label))
  console.log('CONSOLE_ERRORS: ' + JSON.stringify(errs.filter(e => !/403|favicon/.test(e)).slice(0, 5)))
  await browser.close()
  process.exit(0)
})().catch(e => { console.error('FATAL', e); process.exit(2) })
