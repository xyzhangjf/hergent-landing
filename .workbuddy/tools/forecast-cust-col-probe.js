/* 编辑态「合计列之后那格『客户名』输入框」的行为与规格探针
 * ------------------------------------------------------------------
 * 起因：用户注意到编辑态「合计」列后面紧跟一列「客户名」输入框，问它是什么、该不该留。
 * 源码只能证明它绑定 addCol()，但有三件事只有真机才说得清：
 *   ① 它在列序列里的真实位置与宽度，以及**表体对应格是不是空格子**（决定它是不是数据列）；
 *   ② 它与左边每个客户列头那个「改名输入框」在**最终生效样式上是否完全一样**
 *      （一样 = 用户无法区分「改已有列」和「加新列」）；
 *   ③ 在它里面按 Enter，是否会**冒泡触发 <table> 的 onGridKey**、顺带把表格选区跳走。
 *
 * 用法（隔离沙箱令牌；加列/删列只改前端内存，不点保存就不落库）：
 *   HG_TOKEN=xxx HG_TENANT=9998 node forecast-cust-col-probe.js
 */
const puppeteer = require('puppeteer-core')

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = 'https://hergent.cn'
const TOKEN = process.env.HG_TOKEN
const TENANT = process.env.HG_TENANT || '9998'
const SHOT = process.env.HG_SHOT || '/tmp/cust-col.png'

const sleep = ms => new Promise(r => setTimeout(r, ms))

/* ── 页面内采集器（普通函数 + 显式参数：puppeteer 不序列化闭包变量）── */
function collect() {
  const tbl = [...document.querySelectorAll('table.edit-tbl')]
    .find(t => t.querySelector('thead'))
  if (!tbl) return { err: '未找到编辑态表格（可能没进编辑态）' }

  const hdrThs = [...tbl.querySelectorAll('thead tr > th')]
  const cols = [...tbl.querySelectorAll('colgroup col')]
  const bodyTds = [...tbl.querySelectorAll('tbody tr')][0]
    ? [...tbl.querySelectorAll('tbody tr')[0].children] : []

  const px = el => el ? Math.round(el.getBoundingClientRect().width) : null

  const colInfo = hdrThs.map((th, i) => {
    const inp = th.querySelector('input')
    return {
      i,
      cls: (th.className || '').toString().trim(),
      label: (th.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 16),
      placeholder: inp ? (inp.getAttribute('placeholder') || '') : null,
      hasInput: !!inp,
      inpCls: inp ? (inp.className || '').toString() : null,
      inCustHd: !!th.querySelector('.cust-hd'),      // 是否被「改名」外壳包着
      hasDelBtn: !!th.querySelector('.col-del'),      // 是否带删除列按钮
      w: px(th),
      colW: cols[i] ? Math.round(cols[i].getBoundingClientRect().width) : null,
    }
  })

  const sumIdx = colInfo.findIndex(c => c.label === '合计')
  const addIdx = colInfo.findIndex(c => c.placeholder === '客户名')

  /* 表体 / 表尾在**同一列索引**上的单元格内容 —— 判「是不是空壳」 */
  const cellAt = (tds) => tds && tds[addIdx] ? {
    cls: (tds[addIdx].className || '').toString().trim(),
    html: (tds[addIdx].innerHTML || '').trim(),
    text: (tds[addIdx].textContent || '').trim(),
    hasInput: !!tds[addIdx].querySelector('input'),
  } : null

  const footTbls = [...document.querySelectorAll('table.edit-tbl')].filter(t => !t.querySelector('thead'))
  const footTds = footTbls[0] ? [...footTbls[0].querySelectorAll('tbody tr')[0].children] : []

  /* 改名输入框 vs 新增输入框：最终生效样式对比 */
  const styleOf = el => {
    if (!el) return null
    const s = getComputedStyle(el)
    const o = {}
    ;['fontSize', 'fontWeight', 'textAlign', 'height', 'paddingLeft', 'borderTopWidth',
      'borderTopColor', 'backgroundColor', 'color', 'width'].forEach(p => { o[p] = s[p] })
    o.boxW = Math.round(el.getBoundingClientRect().width)
    return o
  }
  const renameInp = tbl.querySelector('thead .cust-hd input')
  const addInp = addIdx >= 0 ? hdrThs[addIdx].querySelector('input') : null

  /* 相邻关系：合计 → 目标格 */
  const sumR = sumIdx >= 0 ? hdrThs[sumIdx].getBoundingClientRect() : null
  const addR = addIdx >= 0 ? hdrThs[addIdx].getBoundingClientRect() : null

  return {
    cols: colInfo, sumIdx, addIdx,
    thCount: hdrThs.length,
    custCols: colInfo.filter(c => c.inCustHd).length,
    bodyCell: cellAt(bodyTds),
    footCell: cellAt(footTds),
    renameStyle: styleOf(renameInp),
    addStyle: styleOf(addInp),
    renamePh: renameInp ? renameInp.getAttribute('placeholder') : null,
    gap: (sumR && addR) ? Math.round(addR.left - sumR.right) : null,
    /* 几何：默认滚动位置能否看到目标格？
       —— 全表 44 列、header 总宽 ~4000px，视口 ~1600px，这是"它到底算不算常显入口"的硬判据 */
    geom: (() => {
      const w = tbl.closest('.edit-grid-wrap')
      const th = addIdx >= 0 ? hdrThs[addIdx] : null
      if (!w || !th) return null
      const inner = Math.max(0, w.clientWidth > 0 ? w.clientWidth : 0)
      return {
        headerW: Math.round(tbl.getBoundingClientRect().width),
        clientW: inner,
        scrollW: Math.round(w.scrollWidth),
        thOffsetLeft: Math.round(th.offsetLeft),
        thW: Math.round(th.getBoundingClientRect().width),
        // 在 scrollLeft=0 时，目标格左边界落在视口外多少像素
        offAtDefault: Math.round(th.offsetLeft - inner),
        screensToScroll: inner ? +( (th.offsetLeft - inner) / inner ).toFixed(1) : null,
      }
    })(),
    scroll: (() => {
      const w = tbl.closest('.edit-grid-wrap')
      return w ? { left: Math.round(w.scrollLeft), width: Math.round(w.scrollWidth), client: Math.round(w.clientWidth) } : null
    })(),
    units: [...(window.__probeUnits || [])],
    selRow: (document.querySelector('td.selected') || {}).getAttribute
      ? document.querySelector('td.selected').getAttribute('data-r') : null,
  }
}

/* 客户列数 + 当前选中行（用于验证 Enter 是否顺带跳走选区） */
function snapshotState() {
  const tbl = [...document.querySelectorAll('table.edit-tbl')].find(t => t.querySelector('thead'))
  if (!tbl) return null
  const hdr = [...tbl.querySelectorAll('thead tr > th')]
  const sel = tbl.querySelector('td.selected')
  return {
    custCols: hdr.filter(th => th.querySelector('.cust-hd')).length,
    names: hdr.filter(th => th.querySelector('.cust-hd'))
      .map(th => { const i = th.querySelector('input'); return i ? i.value : '' }),
    addInputVisible: !!hdr.find(th => th.querySelector('input[placeholder="客户名"]')),
    selRowIdx: sel ? sel.getAttribute('data-r') : null,
    selColIdx: sel ? sel.getAttribute('data-c') : null,
  }
}

;(async () => {
  let PASS = 0, FAIL = 0
  const ok = (c, m) => { c ? (PASS++, console.log('  PASS  ' + m)) : (FAIL++, console.log('  FAIL  ' + m)) }

  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--force-device-scale-factor=1'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1680, height: 950, deviceScaleFactor: 1 })
  const errs = [], bad = []
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message))
  page.on('response', r => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url().slice(0, 110)) })

  await page.evaluateOnNewDocument((t, ten) => {
    localStorage.setItem('hergent_v2_token', t)
    localStorage.setItem('hergent_v2_tenant', String(ten))
    localStorage.setItem('hergent_v2_user', JSON.stringify({ role: 'boss', username: 'custprobe', display_name: '客户列探针' }))
    try { localStorage.removeItem('hergent-forecast-draft-v1') } catch (e) {}
  }, TOKEN, TENANT)

  await page.goto(`${BASE}/?cb=${Date.now()}#/forecast`, { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(5500)
  ok(!/#\/login/.test(page.url()), '登录态注入成功（未被弹回 /#/login）')

  /* ── 进编辑态 ── */
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').trim() === '改单')
    b && b.click()
  })
  await sleep(3500)
  const inEdit = await page.evaluate(() => !![...document.querySelectorAll('table.edit-tbl')].find(t => t.querySelector('thead')))
  ok(inEdit, '已进入编辑态（存在带 thead 的 .edit-tbl）')
  if (!inEdit) { console.log('ERR 未进编辑态，终止'); await browser.close(); process.exit(1) }

  console.log('\n═══ 1. 编辑态表头列序列（含索引 / 宽度 / 是否含输入框）═══')
  const r1 = await page.evaluate(collect)
  if (r1.err) { console.log('ERR', r1.err); await browser.close(); process.exit(1) }
  r1.cols.forEach(c => {
    const mark = (c.i === r1.sumIdx) ? '  ← 合计' : (c.i === r1.addIdx) ? '  ★ 目标格' : ''
    console.log(`  [${String(c.i).padStart(2)}] ${String(c.w).padStart(4)}px  ${c.cls.padEnd(22).slice(0, 22)}` +
      ` text="${c.label}" ph=${c.placeholder === null ? '—' : '"' + c.placeholder + '"'}` +
      ` custHd=${c.inCustHd ? 'Y' : 'n'} del=${c.hasDelBtn ? 'Y' : 'n'}${mark}`)
  })
  console.log(`\n  表头总列数 ${r1.thCount}｜客户列（带 .cust-hd）${r1.custCols} 列`)
  console.log(`  合计列索引 = ${r1.sumIdx}｜目标格索引 = ${r1.addIdx}｜相邻间隙 = ${r1.gap}px`)

  ok(r1.addIdx >= 0, `定位到「客户名」输入框所在列（索引 ${r1.addIdx}）`)
  ok(r1.addIdx === r1.sumIdx + 1, `它紧跟在「合计」之后（合计 ${r1.sumIdx} → 目标 ${r1.addIdx}，间隙 ${r1.gap}px）`)
  ok(r1.gap === 0, `与「合计」零间隙贴合（${r1.gap}px）—— 视觉上确实"长在合计右边"`)

  console.log('\n═══ 1b. 几何：默认滚动位置能不能看到它？（决定它算不算「常显入口」）═══')
  const g = r1.geom
  if (g) {
    console.log(`  表头总宽 ${g.headerW}px｜可视宽 ${g.clientW}px｜可滚动宽 ${g.scrollW}px`)
    console.log(`  目标格 offsetLeft = ${g.thOffsetLeft}px（列宽 ${g.thW}px）`)
    console.log(`  ⇒ 默认位置下它在视口右边界外 ${g.offAtDefault}px，需向右滚约 ${g.screensToScroll} 屏才出现`)
    ok(g.headerW > g.clientW, `表头宽度(${g.headerW}) > 视口(${g.clientW}) ⇒ 表格本身要横向滚动`)
    ok(g.offAtDefault > 0,
      `🔴 默认滚动位置**看不到**它（右侧超出 ${g.offAtDefault}px）⇒ 它不是"一眼可见"的常显入口`)
  } else {
    console.log('  (几何数据缺失)')
  }

  console.log('\n═══ 2. 它是数据列还是空壳？（决定它的语义）═══')
  console.log('  表体同列单元格 :', JSON.stringify(r1.bodyCell))
  console.log('  表尾同列单元格 :', JSON.stringify(r1.footCell))
  ok(r1.bodyCell && r1.bodyCell.cls.includes('spacer') && r1.bodyCell.html === '',
    `表体同列是空格子 .td.spacer，无任何内容（${r1.bodyCell && r1.bodyCell.cls}）`)
  ok(r1.footCell && r1.footCell.cls.includes('spacer') && r1.footCell.html === '',
    '表尾同列同样是空格子 —— 全表只有表头这一个输入框')
  ok(r1.bodyCell && !r1.bodyCell.hasInput && r1.footCell && !r1.footCell.hasInput,
    '表体/表尾的该列都不含输入框 ⇒ **不是数据列**，只是表头里的一个入口控件')

  console.log('\n═══ 3. 与「客户列改名输入框」是否可区分 ═══')
  const fmt = o => o ? Object.keys(o).map(k => `${k}=${o[k]}`).join(' ') : '(无)'
  console.log('  改名输入框(客户列头) :', fmt(r1.renameStyle))
  console.log('  新增输入框(合计之后) :', fmt(r1.addStyle))
  const sameStyle = r1.renameStyle && r1.addStyle &&
    ['fontSize', 'fontWeight', 'textAlign', 'height', 'paddingLeft', 'borderTopWidth', 'backgroundColor', 'color']
      .every(p => r1.renameStyle[p] === r1.addStyle[p])
  ok(sameStyle, '两个输入框的最终生效样式**逐属性相同** ⇒ 长得一模一样')
  const renameCol = r1.cols.find(c => c.inCustHd && c.hasInput)
  ok(!!renameCol && !!r1.addStyle, '存在可对比的改名输入框')
  ok(renameCol && renameCol.inCustHd && renameCol.hasDelBtn,
    '改名输入框在 .cust-hd 外壳内、且旁边有删除按钮（可区分「改」）')
  ok(r1.cols[r1.addIdx] && !r1.cols[r1.addIdx].inCustHd && !r1.cols[r1.addIdx].hasDelBtn,
    '目标格**无 .cust-hd 外壳、无删除按钮** ⇒ 结构上属「新增」而非「改」')

  /* ── 4. 功能验证：输入 + Enter 能否真的加出一列 ── */
  console.log('\n═══ 4. 功能验证：在它里面输入客户名 + Enter ═══')
  const st0 = await page.evaluate(snapshotState)
  console.log('  操作前：客户列', st0.custCols, '列；表格选中格 =',
    st0.selRowIdx === null ? '(无)' : `r${st0.selRowIdx}/c${st0.selColIdx}`)

  /* 先点一个表体单元格，制造「已有选区」的场景（用于验证 Enter 是否顺带跳走） */
  await page.evaluate(() => {
    const td = document.querySelector('table.edit-tbl tbody td.qty-cell, table.edit-tbl tbody td.num')
    td && td.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  })
  await sleep(400)
  const st1 = await page.evaluate(snapshotState)
  console.log('  点过单元格后：选中格 =',
    st1.selRowIdx === null ? '(无)' : `r${st1.selRowIdx}/c${st1.selColIdx}`)

  const PROBE_NAME = '探针客户'
  await page.evaluate(() => {
    const th = [...document.querySelectorAll('table.edit-tbl thead tr > th')]
      .find(x => x.querySelector('input[placeholder="客户名"]'))
    const inp = th.querySelector('input')
    inp.scrollIntoView({ block: 'nearest', inline: 'center' })
    inp.focus()
  })
  await sleep(300)
  await page.keyboard.type(PROBE_NAME)
  await sleep(200)
  const typedVal = await page.evaluate(() => {
    const inp = [...document.querySelectorAll('table.edit-tbl thead input[placeholder="客户名"]')][0]
    return inp ? inp.value : null
  })
  ok(typedVal === PROBE_NAME, `输入框已接受键入（value="${typedVal}"）`)

  await page.keyboard.press('Enter')
  await sleep(900)
  const st2 = await page.evaluate(snapshotState)
  console.log('  Enter 之后：客户列', st2.custCols, '列；末尾列名 =', JSON.stringify(st2.names.slice(-3)))
  console.log('  Enter 之后：选中格 =',
    st2.selRowIdx === null ? '(无)' : `r${st2.selRowIdx}/c${st2.selColIdx}`)

  ok(st2.custCols === st0.custCols + 1,
    `按 Enter 真的加出了一列客户（${st0.custCols} → ${st2.custCols} 列）`)
  ok(st2.names.includes(PROBE_NAME) || (st2.names[st2.names.length - 1] === PROBE_NAME),
    `新列名就是刚键入的「${PROBE_NAME}」`)
  ok(st2.addInputVisible, '新增后输入框已在 DOM（且 addCol 会清空它）')

  /* ★ 冒泡副作用：Enter 是否连表格选区一起动 */
  const selMoved = st1.selRowIdx !== null && st2.selRowIdx !== st1.selRowIdx
  console.log('  ' + (selMoved ? '⚠️' : '  ') +
    ` Enter 使表格选区 ${st1.selRowIdx === null ? '(无)' : 'r' + st1.selRowIdx} → ${st2.selRowIdx === null ? '(无)' : 'r' + st2.selRowIdx}`)
  ok(!selMoved,
    '在客户名框按 Enter **不应**改动表格选区 —— 若 FAIL，说明 keydown 冒泡到了 <table> 的 onGridKey')

  /* ── 5. 可逆性：点该列的删除按钮，列应消失 ── */
  console.log('\n═══ 5. 可逆性：删除刚加的列 ═══')
  await page.evaluate((nm) => {
    const th = [...document.querySelectorAll('table.edit-tbl thead tr > th')]
      .find(x => { const i = x.querySelector('input'); return i && i.value === nm })
    const del = th && th.querySelector('.col-del')
    del && del.click()
  }, PROBE_NAME)
  await sleep(700)
  const st3 = await page.evaluate(snapshotState)
  ok(st3.custCols === st0.custCols, `删除后客户列回到原数（${st2.custCols} → ${st3.custCols}）`)

  /* ── 6. 截图：滚到表尾，让「合计 → 客户名 → 操作」同框 ── */
  console.log('\n═══ 6. 截图（滚到表格最右端）═══')
  await page.evaluate(() => {
    const w = [...document.querySelectorAll('table.edit-tbl')].find(t => t.querySelector('thead')).closest('.edit-grid-wrap')
    if (w) w.scrollLeft = w.scrollWidth
  })
  await sleep(800)
  await page.screenshot({ path: SHOT, fullPage: false })
  console.log('  ' + SHOT)

  /* 目标格与「合计」同框的紧致裁剪 —— 方便肉眼比对 */
  const clip = await page.evaluate(() => {
    const ths = [...document.querySelectorAll('table.edit-tbl thead tr > th')]
    const add = ths.find(x => x.querySelector('input[placeholder="客户名"]'))
    const sum = ths.find(x => (x.textContent || '').trim() === '合计')
    if (!add || !sum) return null
    const a = add.getBoundingClientRect(), s = sum.getBoundingClientRect()
    return { x: Math.max(0, s.left - 120), y: Math.max(0, s.top - 6),
      width: Math.min(680, a.right - s.left + 260), height: 260 }
  })
  if (clip) {
    await page.screenshot({ path: SHOT.replace(/\.png$/, '-zoom.png'), clip })
    console.log('  ' + SHOT.replace(/\.png$/, '-zoom.png'))
  }

  console.log('\nCONSOLE_ERRORS:', JSON.stringify(errs.slice(0, 6)))
  console.log('HTTP>=400     :', JSON.stringify(bad.slice(0, 6)))
  console.log(`\n结果：PASS=${PASS} FAIL=${FAIL}`)
  await browser.close()
  process.exit(FAIL ? 1 : 0)
})().catch(e => { console.error('FATAL', e); process.exit(2) })
