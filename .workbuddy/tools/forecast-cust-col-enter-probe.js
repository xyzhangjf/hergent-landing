/* 编辑态「客户名」输入框 Enter 失效边界 + 替代路径可用性
 * ------------------------------------------------------------------
 * 待验假设（源码推断）：
 *   onGridKey 挂在 <table> 的 @keydown 上，Enter 分支在有选区时执行
 *   selectCell + focusCell；focusCell 在 nextTick 里 focus() 到表体单元格，
 *   于是 DOM 焦点在 keydown 阶段就离开输入框 → keyup 落在表体单元格
 *   → 表头输入框自己的 @keyup.enter="addCol" 永远收不到 → 加列失败且**无任何提示**。
 *   预期边界：无选区时可用（onGridKey 提前 return），一旦碰过表格就永久失效。
 *
 * 同时验证「替代路径」是否真的能用：
 *   A) 右键客户列表头 → 增加列（startHdrAdd → applyHdrAdd）
 *   B) 右键表体单元格 → 插入客户列（ctxInsertCol）
 *
 * 用法：HG_TOKEN=xxx HG_TENANT=9998 node forecast-cust-col-enter-probe.js
 */
const puppeteer = require('puppeteer-core')

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = 'https://hergent.cn'
const TOKEN = process.env.HG_TOKEN
const TENANT = process.env.HG_TENANT || '9998'

const sleep = ms => new Promise(r => setTimeout(r, ms))

function state() {
  const tbl = [...document.querySelectorAll('table.edit-tbl')].find(t => t.querySelector('thead'))
  if (!tbl) return null
  const hdr = [...tbl.querySelectorAll('thead tr > th')]
  const cust = hdr.filter(th => th.querySelector('.cust-hd'))
  const bus = tbl.querySelector('input[placeholder="客户名"]')
  const sel = tbl.querySelector('td.selected')
  return {
    custCols: cust.length,
    names: cust.map(th => { const i = th.querySelector('input'); return i ? i.value : '' }),
    addInputValue: bus ? bus.value : null,
    addInputFocused: bus ? document.activeElement === bus : null,
    activeTag: document.activeElement ? document.activeElement.tagName + (document.activeElement.dataset && document.activeElement.dataset.r !== undefined ? `[r=${document.activeElement.dataset.r},c=${document.activeElement.dataset.c}]` : '') : null,
    selRow: sel ? sel.getAttribute('data-r') : null,
    selCol: sel ? sel.getAttribute('data-c') : null,
    toasts: [...document.querySelectorAll('.toast, .toast-msg, [class*="toast"]')].map(x => (x.textContent || '').trim()).filter(Boolean),
  }
}

;(async () => {
  let PASS = 0, FAIL = 0
  const ok = (c, m) => { c ? (PASS++, console.log('  PASS  ' + m)) : (FAIL++, console.log('  FAIL  ' + m)) }
  const info = m => console.log('   ·    ' + m)

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
    localStorage.setItem('hergent_v2_user', JSON.stringify({ role: 'boss', username: 'custprobe2', display_name: '客户列探针2' }))
    try { localStorage.removeItem('hergent-forecast-draft-v1') } catch (e) {}
  }, TOKEN, TENANT)

  await page.goto(`${BASE}/?cb=${Date.now()}#/forecast`, { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(5500)
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').trim() === '改单')
    b && b.click()
  })
  await sleep(3500)
  ok(await page.evaluate(() => !![...document.querySelectorAll('table.edit-tbl')].find(t => t.querySelector('thead'))), '已进入编辑态')

  /* 把「客户名」输入框滚到视野内并聚焦（模拟用户真实操作） */
  const focusAddInput = async () => {
    await page.evaluate(() => {
      const inp = document.querySelector('table.edit-tbl input[placeholder="客户名"]')
      if (inp) { inp.scrollIntoView({ block: 'nearest', inline: 'center' }); inp.focus() }
    })
    await sleep(300)
  }

  /* ══════ 用例 A：全新进编辑态、**未碰过表格**（无选区）══════ */
  console.log('\n══════ 用例 A：无选区（刚进编辑态，先点输入框）══════')
  const a0 = await page.evaluate(state)
  info(`起始：客户列 ${a0.custCols} 列；表格选中格 = ${a0.selRow === null ? '(无)' : 'r' + a0.selRow + '/c' + a0.selCol}`)
  ok(a0.selRow === null, '起始确实没有选中单元格（selected.r < 0）')

  await focusAddInput()
  await page.keyboard.type('探针A')
  await page.keyboard.press('Enter')
  await sleep(900)
  const a1 = await page.evaluate(state)
  console.log('   Enter 后：客户列 ' + a1.custCols + ' 列；输入框值 = ' + JSON.stringify(a1.addInputValue))
  info(`焦点所在元素 = ${a1.activeTag}`)
  ok(a1.custCols === a0.custCols + 1, `无选区时 Enter **能**加出客户列（${a0.custCols} → ${a1.custCols}）`)
  ok(a1.addInputValue === '', 'addCol 成功后清空了输入框（值为空字符串）')

  /* 清掉这一列，避免影响后续计数 */
  await page.evaluate((nm) => {
    const th = [...document.querySelectorAll('table.edit-tbl thead tr > th')]
      .find(x => { const i = x.querySelector('input'); return i && i.value === nm })
    const d = th && th.querySelector('.col-del'); d && d.click()
  }, '探针A')
  await sleep(600)
  const a2 = await page.evaluate(state)
  ok(a2.custCols === a0.custCols, `已回退（${a1.custCols} → ${a2.custCols} 列）`)

  /* ══════ 用例 B：先点过表格（有选区）══════ */
  console.log('\n══════ 用例 B：有选区（先点一下表格，再进输入框）══════')
  await page.evaluate(() => {
    const td = document.querySelector('table.edit-tbl tbody td.qty-cell, table.edit-tbl tbody td.num')
    td && td.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  })
  await sleep(400)
  const b0 = await page.evaluate(state)
  info(`选中格 = ${b0.selRow === null ? '(无)' : 'r' + b0.selRow + '/c' + b0.selCol}；客户列 ${b0.custCols} 列`)

  await focusAddInput()
  const focusedOk = await page.evaluate(() => {
    const inp = document.querySelector('table.edit-tbl input[placeholder="客户名"]')
    return inp && document.activeElement === inp
  })
  ok(focusedOk, '已把焦点放进「客户名」输入框')

  await page.keyboard.type('探针B')
  await page.keyboard.press('Enter')
  await sleep(900)
  const b1 = await page.evaluate(state)
  console.log('   Enter 后：客户列 ' + b1.custCols + ' 列；输入框值 = ' + JSON.stringify(b1.addInputValue))
  info(`焦点所在元素 = ${b1.activeTag}`)
  info(`表格选中格 ${b0.selRow} → ${b1.selRow}（列 c${b0.selCol} → c${b1.selCol}）`)
  info(`页面提示（toast）= ${JSON.stringify(b1.toasts)}`)

  ok(b1.custCols === b0.custCols,
    `🔴 有选区时 Enter **加不出**客户列（${b0.custCols} → ${b1.custCols}）—— addCol 未被调用`)
  ok(b1.addInputValue === '探针B',
    `键入的内容**原地留着**（value="${b1.addInputValue}"）⇒ 失败是静默的，用户无从察觉`)
  ok(b1.selRow !== b0.selRow,
    `同时表格选中格被跳走（r${b0.selRow} → r${b1.selRow}）—— keydown 被 <table> 的 onGridKey 吃掉`)
  ok(!b1.toasts.length, '全程没有任何 toast 提示（无「已存在」也无「失败」）')

  /* 再按一次，看是否继续只是挪选区（证明不是偶发） */
  await focusAddInput()
  await page.keyboard.press('Enter')
  await sleep(700)
  const b2 = await page.evaluate(state)
  info(`再按一次 Enter：客户列 ${b2.custCols} 列；选中格 r${b1.selRow} → r${b2.selRow}`)
  ok(b2.custCols === b0.custCols, '再按 Enter 仍然加不出列（可复现，非偶发）')

  /* ══════ 替代路径 A：右键客户列表头 → 增加列 ══════ */
  console.log('\n══════ 替代路径 A：右键客户列表头 → 增加列 ══════')
  const target = await page.evaluate(() => {
    const th = [...document.querySelectorAll('table.edit-tbl thead th')].find(x => x.querySelector('.cust-hd'))
    if (!th) return null
    th.scrollIntoView({ block: 'nearest', inline: 'center' })
    const r = th.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  })
  if (!target) { console.log('   (未找到客户列表头，跳过)') } else {
    await page.mouse.click(target.x, target.y, { button: 'right' })
    await sleep(700)
    const menuOpen = await page.evaluate(() => {
      const m = document.querySelector('.ctx-menu')
      return m ? [...m.querySelectorAll('button')].map(b => (b.textContent || '').trim()).filter(Boolean) : null
    })
    info('右键菜单项 = ' + JSON.stringify(menuOpen))
    ok(!!menuOpen, '右键客户列表头弹出了菜单')

    const clicked = await page.evaluate(() => {
      const m = document.querySelector('.ctx-menu')
      if (!m) return false
      const b = [...m.querySelectorAll('button')].find(x => (x.textContent || '').includes('增加列'))
      if (!b) return false
      b.click(); return true
    })
    ok(clicked, '菜单里有「增加列」并已点开')
    await sleep(600)
    const hasIpt = await page.evaluate(() => !!document.querySelector('.ctx-ipt[placeholder="新列名称"]'))
    ok(hasIpt, '出现「新列名称」输入框')
    if (hasIpt) {
      await page.evaluate(() => { const i = document.querySelector('.ctx-ipt[placeholder="新列名称"]'); i.focus() })
      await page.keyboard.type('右键新增列')
      await page.keyboard.press('Enter')
      await sleep(900)
      const c1 = await page.evaluate(state)
      ok(c1.custCols === b0.custCols + 1, `右键→增加列 **能**加出客户列（${b0.custCols} → ${c1.custCols}）`)
      ok(c1.names.includes('右键新增列'), '新列名正确落位')
      /* 清理 */
      await page.evaluate((nm) => {
        const th = [...document.querySelectorAll('table.edit-tbl thead tr > th')]
          .find(x => { const i = x.querySelector('input'); return i && i.value === nm })
        const d = th && th.querySelector('.col-del'); d && d.click()
      }, '右键新增列')
      await sleep(600)
      const c2 = await page.evaluate(state)
      ok(c2.custCols === b0.custCols, `已回退（${c1.custCols} → ${c2.custCols}）`)
    }
  }

  console.log('\nCONSOLE_ERRORS:', JSON.stringify(errs.slice(0, 5)))
  console.log(`\n结果：PASS=${PASS} FAIL=${FAIL}`)
  await browser.close()
  process.exit(0)
})().catch(e => { console.error('FATAL', e); process.exit(2) })
