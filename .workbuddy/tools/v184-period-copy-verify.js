// v184 真机验收：往期「复制」按钮 / 复制弹窗（默认顺延 + 名称联动）/ 空期次保留表头 /
//             从上一期复制清单（seed）/ 新建期次后表格重载
//
// ⚠️ 沿用教训：
//   1. 弹窗选择器一律用**具体类名** —— 复制弹窗与改期次弹窗共用 .pe-modal，
//      所以复制弹窗另有 .pc-modal（本次代码里新加），探针只认它。
//   2. page.evaluate 第一个参数传**字符串**会被当表达式求值 → 一律传函数 + 参数数组。
//   3. 从期次下拉取对照项必须**先滤掉 value<=0 的占位项**（`— 选择期次 —`）。
//   4. 每个「断言行为」前面先加**前置断言**，证明目标真的存在 —— 否则找不到元素时的
//      空结果会被误判成「功能正常」。
const puppeteer = require('puppeteer-core')
const fs = require('fs')

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = 'https://hergent.cn'
const TOKEN = process.env.HG_TOKEN
const TENANT = process.env.HG_TENANT
const OUT = process.env.HG_OUT || '/tmp/v184-shots'

const R = []
const ok = (id, cond, detail) => {
  R.push({ id, pass: !!cond })
  console.log((cond ? 'PASS ' : 'FAIL ') + id + '  ' + String(detail == null ? '' : detail).slice(0, 320))
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
const wait = async (fn, ms = 20000, step = 350) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return v } catch (e) {} await sleep(step) }
  return null
}
const T = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim()

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--force-device-scale-factor=2'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 940, deviceScaleFactor: 2 })
  await page.evaluateOnNewDocument((t, ten) => {
    localStorage.setItem('hergent_v2_token', t)
    localStorage.setItem('hergent_v2_tenant', String(ten))
    localStorage.setItem('hergent_v2_user', JSON.stringify({ role: 'boss', username: 'e2e', display_name: '验证' }))
  }, TOKEN, TENANT)
  const errs = []
  page.on('console', m => { if (m.type() === 'error') errs.push(T(m.text()).slice(0, 200)) })
  page.on('pageerror', e => errs.push('PAGEERROR ' + T(String(e)).slice(0, 200)))
  // 进/出「改单」可能弹 window.confirm（角色提示 / 放弃草稿）。headless 下不接管 dialog，
  // 页面会**一直挂住**到超时，症状是「后面所有断言莫名超时」而不是报错。
  const dialogs = []
  page.on('dialog', async d => { dialogs.push(T(d.message()).slice(0, 120)); try { await d.accept() } catch (e) {} })

  const shot = n => page.screenshot({ path: `${OUT}/${n}.png` }).catch(() => {})

  // ---------- 页面内小工具 ----------
  const tabs = async label => page.evaluate(l => {
    const b = [...document.querySelectorAll('.module-tabs button')].find(x => x.textContent.trim() === l)
    if (b) { b.click(); return true } return false
  }, label)
  const histRows = () => page.evaluate(() => [...document.querySelectorAll('.history-tbl tbody tr')].map(tr => {
    const tds = [...tr.querySelectorAll('td')]
    return {
      name: T(tds[0] ? tds[0].innerText : ''),
      status: T(tds[6] ? tds[6].innerText : ''),
      btns: [...tr.querySelectorAll('button')].map(b => b.textContent.trim()),
    }
    function T(s) { return String(s || '').replace(/\s+/g, ' ').trim() }
  }))
  const clickHistCopy = name => page.evaluate(n => {
    const tr = [...document.querySelectorAll('.history-tbl tbody tr')].find(t => t.innerText.includes(n))
    if (!tr) return 'no-row'
    const b = [...tr.querySelectorAll('button')].find(x => x.textContent.trim() === '复制')
    if (!b) return 'no-btn'
    b.click(); return 'ok'
  }, name)
  const pcVisible = () => page.evaluate(() => !!document.querySelector('.imp-modal.pc-modal'))
  const pcInfo = () => page.evaluate(() => {
    const m = document.querySelector('.imp-modal.pc-modal')
    if (!m) return null
    const inputs = [...m.querySelectorAll('.pe-grid input')]
    const nameEl = inputs[0]
    return {
      title: (m.querySelector('.imp-hd b') || {}).innerText || '',
      head: (m.querySelector('.imp-body .imp-own') || {}).innerText || '',
      name: nameEl ? nameEl.value : '',
      sel: nameEl ? { s: nameEl.selectionStart, e: nameEl.selectionEnd, len: nameEl.value.length } : null,
      dates: inputs.slice(1).map(i => i.value),
      shiftBtns: [...m.querySelectorAll('.pc-shift button')].map(b => ({ t: b.textContent.trim(), on: /btn-primary/.test(b.className) })),
      count: (() => { const p = [...m.querySelectorAll('.imp-own')].find(x => x.innerText.includes('将带过来')); return p ? p.innerText.replace(/\s+/g, ' ').trim() : '' })(),
      warns: [...m.querySelectorAll('.np-warn li')].map(li => li.innerText.replace(/\s+/g, ' ').trim()),
    }
  })
  const pcClose = async () => {
    const x = await page.$('.imp-modal.pc-modal .imp-x')
    if (x) { await x.click(); await sleep(400) }
  }
  const pcClickShift = d => page.evaluate(n => {
    const m = document.querySelector('.imp-modal.pc-modal')
    if (!m) return false
    const b = [...m.querySelectorAll('.pc-shift button')].find(x => x.textContent.trim() === n + ' 天')
    if (!b) return false
    b.click(); return true
  }, d)
  const pcSave = async () => {
    const b = await page.$('.imp-modal.pc-modal .del-actions .btn-primary')
    if (b) await b.click()
  }
  const setInputAt = (sel, idx, val) => page.evaluate((s, i, v) => {
    const el = document.querySelectorAll(s)[i]
    if (!el) return null
    const proto = el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    return el.value
  }, sel, idx, val)
  const toastText = () => page.evaluate(() => { const t = document.querySelector('.toast'); return t ? t.innerText.replace(/\s+/g, ' ').trim() : '' })
  const selPeriod = () => page.evaluate(() => {
    const s = document.querySelector('select.sel-period')
    return s ? { value: s.value, text: (s.selectedOptions[0] || {}).textContent || '' } : null
  })
  const crossState = () => page.evaluate(() => {
    const ths = [...document.querySelectorAll('.cross-tbl thead th')].map(t => t.innerText.replace(/\s+/g, ' ').trim())
    return {
      hasTable: !!document.querySelector('.cross-tbl'),
      thCount: ths.length,
      // ⚠️ 必须返回**全部** th：之前只返回前 8 个，而「厂家编码」在第 2 位之后，
      //    D2 的 every() 因此必然 FAIL —— 典型的「断言选错目标」而不是产品问题。
      ths,
      // 🔴 `data-pid` 在**单元格 td** 上（Forecast.vue:672），`<tr>` 上**没有**这个属性。
      //    早先写 `tr[data-pid]` ⇒ 恒为 0 ⇒ C6/F0/E2 三项假 FAIL，且 F4 的
      //    `dataRows === 0` 变成**永真的假 PASS**（空表断言永远通过）。以 tr.data-row 为准。
      dataRows: document.querySelectorAll('.cross-tbl tbody tr.data-row').length,
      pidCells: document.querySelectorAll('.cross-tbl tbody td[data-pid]').length,
      impTags: document.querySelectorAll('.cross-tbl tbody .imp-tag').length,
      firstNames: [...document.querySelectorAll('.cross-tbl tbody tr.data-row')].slice(0, 4)
        .map(tr => { const td = tr.querySelector('td .pname'); return td ? td.innerText.replace(/\s+/g, ' ').trim().slice(0, 24) : '' }),
      hasEmptyRow: !!document.querySelector('.empty-row'),
      emptyRowText: (() => { const e = document.querySelector('.empty-row'); return e ? e.innerText.replace(/\s+/g, ' ').trim() : '' })(),
      emptyBtns: [...document.querySelectorAll('.empty-row button')].map(b => ({ t: b.textContent.trim(), dis: b.disabled })),
      oldEmptyState: !!document.querySelector('.tbl-state.tbl-empty'),
      pageEmptyText: (() => { const e = document.querySelector('.tbl-state.tbl-empty'); return e ? e.innerText.replace(/\s+/g, ' ').trim().slice(0, 60) : '' })(),
    }
  })
  const npVisible = () => page.evaluate(() => !!document.querySelector('.card.new-period'))
  const npFill = async (name, s, e2, arr) => {
    await setInputAt('.card.new-period .np-row input', 0, name)
    await sleep(250)
    await setInputAt('.card.new-period .np-row input', 1, s)
    await setInputAt('.card.new-period .np-row input', 2, e2)
    await setInputAt('.card.new-period .np-row input', 3, arr)
    await sleep(250)
  }
  const npWarns = () => page.evaluate(() => [...document.querySelectorAll('.card.new-period .np-warn li')].map(li => li.innerText.replace(/\s+/g, ' ').trim()))
  // 建一个期次（F 与 E 共用）。返回 toast 文本（调用方断言「期次已创建」）。
  const createPeriod = async (name, s, e2, arr) => {
    await page.click('button[aria-label="新建期次"]')
    await wait(() => npVisible(), 8000)
    await npFill(name, s, e2, arr)
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('.card.new-period button')].find(x => x.textContent.trim() === '创建')
      if (b) b.click()
    })
    return await wait(async () => { const t = await toastText(); return /期次已创建/.test(t) ? t : null }, 12000)
  }
  // 按**名称**切换期次下拉。value 是期次 id，不可猜；占位项（value<=0）必须先滤掉。
  const selByName = name => page.evaluate(n => {
    const s = document.querySelector('select.sel-period')
    if (!s) return { ok: false, reason: '下拉不在 DOM（当前不是「本期预报」tab）' }
    const opt = [...s.options].find(o => Number(o.value) > 0 && o.textContent.includes(n))
    if (!opt) return { ok: false, reason: '没有这个选项', opts: [...s.options].map(o => o.textContent.trim()).slice(0, 30) }
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(s, opt.value)
    s.dispatchEvent(new Event('change', { bubbles: true }))
    return { ok: true, value: opt.value, text: opt.textContent.trim() }
  }, name)

  await page.goto(`${BASE}/?cb=${Date.now()}#/forecast`, { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(6500)

  // ===================================================================
  // A 往期列表：「复制」按钮的可见条件
  // ===================================================================
  console.log('\n===== A 往期列表「复制」按钮 =====')
  await tabs('历史期次')
  await sleep(2500)
  let rows = await histRows()
  ok('A0 往期列表有行（前置）', rows.length > 0, 'rows=' + rows.length)
  // 🔴 合成行的名字形如「2026-09-17 报单」（未被任何期次窗口覆盖的 order_date 自动成行，
  //    id<0、没有 forecast_periods 记录），它的状态列也显示「进行中」—— 直接
  //    `find(r => r.status === '进行中')` 会**稳定命中合成行** ⇒ A5 断言「进行中期次有复制」
  //    必然 FAIL，看着像产品缺陷。必须先把合成行滤掉。
  const isSynth = n => /^\d{4}-\d{2}-\d{2}\s*报单$/.test(String(n).trim())
  const closedReal = rows.find(r => r.status === '已关闭')
  const openReal = rows.find(r => r.status === '进行中' && !isSynth(r.name))
  const synth = rows.find(r => isSynth(r.name))
  ok('A1 存在已关闭的真实期次（前置）', !!closedReal, closedReal ? closedReal.name : 'none')
  ok('A2 已关闭期次行**有**「复制」（不限 open）', !!(closedReal && closedReal.btns.includes('复制')), closedReal ? JSON.stringify(closedReal.btns) : '')
  ok('A3 已关闭期次行**没有**「修改」（对照：证明条件真的在筛）', !!(closedReal && !closedReal.btns.includes('修改')), closedReal ? JSON.stringify(closedReal.btns) : '')
  ok('A4 存在进行中的真实期次（前置）', !!openReal, openReal ? openReal.name : 'none')
  ok('A5 进行中期次行**有**「复制」', !!(openReal && openReal.btns.includes('复制')), openReal ? JSON.stringify(openReal.btns) : '')
  ok('A6 存在合成行（无 forecast_periods 记录）（前置）', !!synth, synth ? synth.name : 'none')
  ok('A7 合成行**没有**「复制」（关键反例：它没有可引用的 id）', !!(synth && !synth.btns.includes('复制')), synth ? JSON.stringify(synth.btns) : '')
  await shot('A1-history-buttons')

  // ===================================================================
  // B 复制弹窗：默认顺延 + 名称联动 + 全选
  // ===================================================================
  console.log('\n===== B 复制弹窗（源 = 已关闭的「9月3日报单9月8日到货」）=====')
  const SRC10 = '9月3日报单9月8日到货'
  const st10 = await clickHistCopy(SRC10)
  await wait(() => pcVisible(), 8000)
  let p = await pcInfo()
  ok('B0 点「复制」打开弹窗（前置）', !!p, st10)
  if (p) {
    ok('B1 标题为「复制期次」', p.title === '复制期次', p.title)
    ok('B2 标明复制源与状态', p.head.includes(SRC10) && p.head.includes('已关闭'), p.head)
    ok('B3 名称预填 = 源名整体顺延 7 天', p.name === '9月10日报单9月15日到货', p.name)
    ok('B4 日期 = 源窗口整体顺延 7 天', p.dates[0] === '2026-09-10' && p.dates[1] === '2026-09-10' && p.dates[2] === '2026-09-15', JSON.stringify(p.dates))
    ok('B5 名称框已**全选**（点进来直接打字即覆盖）', !!p.sel && p.sel.s === 0 && p.sel.e === p.sel.len && p.sel.len > 0, JSON.stringify(p.sel))
    ok('B6 默认选中「7 天」', p.shiftBtns.some(b => b.t === '7 天' && b.on), JSON.stringify(p.shiftBtns))
    await shot('B1-pc-default-shift7')

    await pcClickShift(14); await sleep(450)
    p = await pcInfo()
    ok('B7 点「14 天」→ 名称与日期按**源 +14** 重算（不叠加）',
      p.name === '9月17日报单9月22日到货' && p.dates[0] === '2026-09-17' && p.dates[2] === '2026-09-22',
      p.name + ' | ' + JSON.stringify(p.dates))
    await pcClickShift(7); await sleep(450)
    p = await pcInfo()
    ok('B8 点回「7 天」→ 恢复源 +7（证明是相对源重算）',
      p.name === '9月10日报单9月15日到货' && p.dates[0] === '2026-09-10', p.name + ' | ' + JSON.stringify(p.dates))

    // 名称 → 日期 force 联动：改名称里的日期，窗口必须跟着变
    await setInputAt('.imp-modal.pc-modal .pe-grid input', 0, '10月1日报单10月4日到货')
    await sleep(500)
    p = await pcInfo()
    ok('B9 改名称里的日期 → 窗口跟着变（force 联动，这是「只改名称即可用」的前提）',
      p.dates[0] === '2026-10-01' && p.dates[1] === '2026-10-01' && p.dates[2] === '2026-10-04',
      p.name + ' | ' + JSON.stringify(p.dates))
    await shot('B2-pc-name-drives-dates')
    await pcClose()
  }

  // ===================================================================
  // C 复制执行（源 = 有 154 个清单的「9月提审期-开放填报」）
  // ===================================================================
  console.log('\n===== C 复制执行 =====')
  const SRC9 = '9月提审期-开放填报'
  // 🔴 `select.sel-period` 只存在于「本期预报」tab —— 在「历史期次」tab 上读它恒为 null。
  //    故复制前先在「本期预报」把 before 取到，再切到「历史期次」去点「复制」。
  await tabs('本期预报'); await sleep(1800)
  const before = await selPeriod()
  await tabs('历史期次'); await sleep(2200)
  const st9 = await clickHistCopy(SRC9)
  await wait(() => pcVisible(), 8000)
  p = await pcInfo()
  ok('C0 打开复制弹窗（前置）', !!p && st9 === 'ok', st9)
  if (p) {
    ok('C1 显示「将带过来 N 个商品」（用后端 imported_count）', /154/.test(p.count), p.count)
    // 软警告要有**确定的重叠源**才可断言：把窗口设成源期次自己的窗口（2026-09-03~09-08），
    // 那正是往期列表里已关闭的「9月3日报单9月8日到货」的窗口 ⇒ 必然重叠。
    // 原写法是「默认 +7 天的窗口应当撞上某期」—— 依赖克隆库里恰好存在那一期，脆弱。
    await setInputAt('.imp-modal.pc-modal .pe-grid input', 1, '2026-09-03')
    await setInputAt('.imp-modal.pc-modal .pe-grid input', 2, '2026-09-08')
    await sleep(600)
    p = await pcInfo()
    ok('C2 软警告提示与已有期次窗口重叠（窗口故意设成源期次自己的窗口，必然重叠）',
      p.warns.length > 0, JSON.stringify(p.warns))
    await shot('C1-pc-count-and-warn')

    // 改成不与任何期次重叠的窗口
    await setInputAt('.imp-modal.pc-modal .pe-grid input', 0, 'v184真机-复制自9期')
    await sleep(300)
    await setInputAt('.imp-modal.pc-modal .pe-grid input', 1, '2026-11-01')
    await setInputAt('.imp-modal.pc-modal .pe-grid input', 2, '2026-11-05')
    await setInputAt('.imp-modal.pc-modal .pe-grid input', 3, '2026-11-08')
    await sleep(400)
    await pcSave()
    const tt = await wait(async () => { const s = await toastText(); return /已复制为/.test(s) ? s : null }, 12000)
    ok('C3 复制成功 toast 说明带过来多少商品', !!tt && /154/.test(tt), tt || '(no toast)')
    await sleep(2500)

    await tabs('历史期次'); await sleep(2500)
    rows = await histRows()
    ok('C4 往期列表已刷新，出现新期次（historyKey++ 生效）',
      rows.some(r => r.name.includes('v184真机-复制自9期')), rows.map(r => r.name).slice(0, 6).join(' | '))

    await tabs('本期预报'); await sleep(3200)
    const after = await selPeriod()
    ok('C5 期次下拉已切到新期次（≠ 复制前）', !!before && !!after && before.value !== after.value,
      `before=${before && before.text} after=${after && after.text}`)
    const cs = await crossState()
    ok('C6 复制后表格重载：出现数据行（清单已带过来，不是空表）',
      cs.hasTable && cs.dataRows > 0, `rows=${cs.dataRows} pidCells=${cs.pidCells} impTags=${cs.impTags} emptyRow=${cs.hasEmptyRow} head=${JSON.stringify(cs.firstNames)}`)
    await shot('C2-after-copy-reloaded')
    console.log('     （C6 诊断）thCount=' + cs.thCount + ' 空行文案=' + JSON.stringify(T(cs.emptyRowText).slice(0, 80)))
  }

  // ===================================================================
  // F 新建期次后表格必须重载（v184 补的那一行）
  // ===================================================================
  console.log('\n===== F 新建期次 → 表格重载 =====')
  const pre = await crossState()
  const preSel = await selPeriod()
  ok('F0 前置：当前期次有数据行', pre.dataRows > 0, `rows=${pre.dataRows} sel=${preSel && preSel.text}`)
  await page.click('button[aria-label="新建期次"]')
  await wait(() => npVisible(), 8000)
  ok('F1 新建期次表单已展开（前置）', await npVisible())
  await npFill('v184真机-空期次', '2026-12-01', '2026-12-05', '2026-12-08')
  const npw = await npWarns()
  console.log('     新建表单软警告：' + JSON.stringify(npw))
  await shot('F1-np-filled')
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.card.new-period button')].find(x => x.textContent.trim() === '创建')
    if (b) b.click()
  })
  const tt2 = await wait(async () => { const s = await toastText(); return /期次已创建/.test(s) ? s : null }, 12000)
  ok('F2 创建成功', !!tt2, tt2 || '(no toast)')
  await sleep(3500)
  const post = await crossState()
  const postSel = await selPeriod()
  ok('F3 期次下拉已切到新期次', !!postSel && postSel.text.includes('v184真机-空期次'), postSel && postSel.text)
  ok('F4 🔴 表格已重载为新期次（旧实现只刷下拉、表格仍挂上一期 ⇒ 数据行会残留）',
    post.dataRows === 0 && post.hasEmptyRow,
    `rows=${post.dataRows} pidCells=${post.pidCells} emptyRow=${post.hasEmptyRow}（rows 曾因选择器写错恒为 0，此项原为假 PASS）`)
  await shot('F2-after-new-period-reloaded')

  // ===================================================================
  // D 空期次：表头必须保留（用户提的第 2 点）
  // ===================================================================
  console.log('\n===== D 空期次 —— 表头保留 / 不可删除可达 =====')
  ok('D0 表格存在（前置）', post.hasTable, JSON.stringify({ hasTable: post.hasTable }))
  ok('D1 🔴 表头存在（旧实现是整张表被空态替换，连列头都没有）', post.thCount > 0, 'thCount=' + post.thCount)
  const mustHave = ['商品名称', '条码', '分销价', '厂家编码']
  const missingThs = mustHave.filter(k => !post.ths.some(t => t.includes(k)))
  ok('D2 不可删除的列都在表头里（含「厂家编码」，它在 th 列表第 8 位之后）', missingThs.length === 0,
    `thCount=${post.thCount} 缺失=${JSON.stringify(missingThs)}`)
  ok('D3 旧的「整块空态」不再出现', !post.oldEmptyState, post.pageEmptyText)
  ok('D4 表体内出现引导行 + 三个填数入口', post.hasEmptyRow && post.emptyBtns.length >= 3,
    post.emptyRowText + '  btns=' + JSON.stringify(post.emptyBtns.map(b => b.t)))
  await shot('D1-empty-keeps-header')

  const thHit = await page.evaluate(() => {
    const ths = [...document.querySelectorAll('.cross-tbl thead th')]
    const i = ths.findIndex(t => t.innerText.includes('条码'))
    if (i < 0) return { i: -1, fired: false }
    const th = ths[i]
    const r = th.getBoundingClientRect()
    // 🔴 **不要**用 puppeteer 的 click({button:'right'})：headless 下它不产生 contextmenu
    //    事件，菜单永不出现 —— 看起来像产品缺陷，实际是探针选错了触发方式（实测踩过）。
    //    模板上是 `@contextmenu.prevent="openHdrCtx(...)"`，监听的就是这个 DOM 事件，
    //    直接派发同名事件行为等价且确定。
    th.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
    }))
    return { i, fired: true, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  })
  ok('D5 前置：找得到「条码」列头并触发右键', thHit.i >= 0 && thHit.fired, `idx=${thHit.i} @${thHit.x},${thHit.y}`)
  if (thHit.i >= 0) {
    const menu = await page.evaluate(() => {
      const m = document.querySelector('.ctx-menu')
      return m ? m.innerText.replace(/\s+/g, ' ').trim() : null
    })
    // 记录一条**既有边界**（不是 v184 引入）：两条 `.ctx-menu`（单元格 ctx / 列头 hdrCtx）在模板里
    // 的**唯一渲染出口**位于 `<div v-else class="grid-area">`（编辑态分支，Forecast.vue:756），
    // 而查看态表头（:626）照样绑了 `@contextmenu.prevent="openHdrCtx(...)"`
    // ⇒ **状态被赋值，但没有渲染出口 = 死控件**。同族铁律：「按钮点了没反应」先查「有没有渲染出口」。
    // 本项如实断言现状（并作为对 v184 的澄清：用户要的「看到不可删除的列」由**表头可见**满足，
    // 不依赖这条右键菜单）。若日后把菜单提到查看态，这里会翻成 FAIL —— 那正是提醒更新断言的信号。
    ok('D6 查看态右击列头**不出菜单**（既有边界：列头菜单唯一出口在编辑态分支）',
      menu === null, menu ? '菜单出现了：' + menu.slice(0, 120) : '(no menu) ✓')
    await shot('D2-readonly-header-rightclick')
  }

  // D7–D9：菜单在**能渲染的那一态**（改单）里必须真的可达，且「不可删除」提示是**列头**菜单那条。
  //   判据：文案能指出是哪一条菜单 —— 列头菜单是「可在**列设置**中隐藏」，
  //   单元格菜单（另一条独立实现）是「可经**列配置**隐藏」，两者不同句、可区分。
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.empty-row button')].find(x => x.textContent.includes('改单填写'))
    if (b) b.click()
  })
  const inEdit = await wait(() => page.evaluate(() => document.querySelectorAll('.cross-tbl.edit-tbl thead th').length > 0), 15000)
  ok('D7 前置：空期次也能进「改单」并渲染出编辑网格表头', !!inEdit,
    inEdit ? 'ths=' + await page.evaluate(() => document.querySelectorAll('.cross-tbl.edit-tbl thead th').length) : '(no edit header)')
  const hdrHit = await page.evaluate(() => {
    const th = [...document.querySelectorAll('.cross-tbl.edit-tbl thead th')].find(t => t.innerText.includes('条码'))
    if (!th) return { ok: false, why: 'no-th' }
    const r = th.getBoundingClientRect()
    th.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
    }))
    return { ok: true, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  })
  ok('D8 前置：编辑网格里找得到「条码」列头并触发右键', hdrHit.ok, JSON.stringify(hdrHit))
  const menu2 = hdrHit.ok ? await wait(() => page.evaluate(() => {
    const ms = [...document.querySelectorAll('.ctx-menu')].map(m => m.innerText.replace(/\s+/g, ' ').trim())
    return ms.length ? ms : null
  }), 6000) : null
  // ⚠️ 编辑网格的 `<table>` 上还绑了 `@contextmenu.prevent="onTbCtx"`（单元格菜单），
  //    对 `<th>` 派发的 contextmenu 会**冒泡**上去 ⇒ 可能同时开出两条 `.ctx-menu`，
  //    而 `querySelector` 只取第一条（DOM 序里单元格菜单在前）⇒ 单条断言会假 FAIL。
  //    判据取「**任一条**是列头菜单那条文案」。
  const menus2 = menu2 || []
  ok('D9 🔴 列头右键菜单可达，且「该主档列不可删除（可在列设置中隐藏）」提示确实出现',
    menus2.some(t => /该主档列不可删除/.test(t) && !/可经列配置隐藏/.test(t)),
    menus2.length ? JSON.stringify(menus2.map(t => t.slice(0, 90))) : '(no menu)')
  await shot('D3-edit-header-contextmenu')
  await page.evaluate(() => { const o = document.querySelector('.ctx-overlay'); if (o) o.click() })
  await sleep(500)
  // 退出改单，回到查看态，避免影响后续（E 组全程在查看态）
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.tb-edit-group button')].find(x => x.textContent.trim() === '取消')
    if (b) b.click()
  })
  await sleep(2600)

  // ===================================================================
  // E 从上一期复制清单（seed，就地填入，不新建期次）
  //    三个数据前置必须**刻意构造**，否则测不出东西（早先版本靠运气，全是假 FAIL/PASS）：
  //    ① 目标期次必须**不是**后端默认期次 —— `forecast_period_default()` 第 2 档是
  //       `ORDER BY id DESC`（最后创建的那个 open 期次），所以必须在目标之后**再建一期**
  //       把默认挪走，否则「seed 后被 loadPeriods 甩到默认期次」这条回归根本无从触发。
  //    ② 目标的窗口必须落在 (2026-08-30, 2026-09-03] —— `nearestPrevPeriod` 取的是
  //       「窗口在本期之前、order_start 最大的那一期」。克隆库里只有 period 9
  //       （08-30 ~ 09-15，**含 154 条清单**）有清单，period 10(09-03)/12(09-15) 都是空的，
  //       所以窗口只要 ≥ 09-03 就会挑到空清单期，seed 回执 0 个商品（早先版本的假 FAIL）。
  //    ③ 名字有**前缀包含关系**（OLD ⊂ NEW）：判定选中项必须用**等值**，不能用 includes。
  // ===================================================================
  console.log('\n===== E 从上一期复制清单（seed，目标 ≠ 默认期次）=====')
  const OLD = 'v184真机-空期次'          // F 建的，2026-12-01（F3 已断言下拉跟随它）
  const TGT = 'v184真机-待填清单'         // 窗口 2026-09-02 → 上一期必是 period 9（154 条）
  const NUD = 'v184真机-后建期次'         // 最后创建 ⇒ 它才是后端默认期次
  const isSel = (t, n) => T(t) === n

  const ttT = await createPeriod(TGT, '2026-09-02', '2026-09-05', '2026-09-08')
  ok('E0 前置：建一个窗口在 period 9 之后的空期次（它的「上一期」必含 154 条清单）',
    !!ttT, ttT || '(no toast)')
  await sleep(3600)
  const stT1 = await selPeriod()
  ok('E1 前置：新建后视图切到该期（默认期次 = 最后创建的 open 期次）', !!stT1 && isSel(stT1.text, TGT), stT1 && stT1.text)

  const ttN = await createPeriod(NUD, '2027-02-01', '2027-02-05', '2027-02-08')
  ok('E2 前置：再建一期，把「后端默认期次」从目标期挪走（否则测不出视图被甩）', !!ttN, ttN || '(no toast)')
  await sleep(3600)
  const stN1 = await selPeriod()
  ok('E3 前置：默认期次已变成后建的那一期', !!stN1 && isSel(stN1.text, NUD), stN1 && stN1.text)

  const back = await selByName(TGT)
  await sleep(3400)
  const stT2 = await selPeriod()
  const csT = await crossState()
  ok(`E4 前置：把视图切回「${TGT}」（它不是默认期次）且它是空表`,
    back.ok && !!stT2 && isSel(stT2.text, TGT) && csT.hasEmptyRow,
    `${JSON.stringify(back)} | sel=${stT2 && stT2.text} emptyRow=${csT.hasEmptyRow} rows=${csT.dataRows}`)

  const seedBtn = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.empty-row button')].find(x => x.textContent.includes('复制清单'))
    return b ? { text: b.textContent.trim(), disabled: b.disabled } : null
  })
  ok('E5 前置：「从上一期复制清单」按钮存在且可用', !!seedBtn && !seedBtn.disabled, JSON.stringify(seedBtn))
  const cntBefore = (await crossState()).dataRows
  if (seedBtn && !seedBtn.disabled) {
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('.empty-row button')].find(x => x.textContent.includes('复制清单'))
      if (b) b.click()
    })
    const tt3 = await wait(async () => { const s = await toastText(); return /填入/.test(s) ? s : null }, 15000)
    ok('E6 seed 成功，且带过来的是**源期次的清单条数**（154，不是 0）',
      !!tt3 && /154/.test(tt3), tt3 || '(no toast)')
    await sleep(4000)
    const after2 = await crossState()
    ok('E7 🔴 表格重载后不再是空表（清单就地填入，未新建期次）',
      after2.dataRows > 0 && !after2.hasEmptyRow,
      `rows: ${cntBefore} -> ${after2.dataRows}  impTags=${after2.impTags}  head=${JSON.stringify(after2.firstNames)}`)
    const selNow = await selPeriod()
    ok('E8 🔴 seed 后视图**仍停在目标期次**（不被 loadPeriods() 甩到后端默认期次）',
      !!selNow && isSel(selNow.text, TGT), selNow && selNow.text)
    await shot('E1-after-seed')

    const toNud = await selByName(NUD)
    await sleep(3200)
    const csNud = await crossState()
    const selN2 = await selPeriod()
    ok('E9 对照：另一期**仍是空的**（seed 只作用目标期次，未串期）',
      toNud.ok && csNud.hasEmptyRow && csNud.dataRows === 0 && isSel(selN2.text, NUD),
      `sel=${selN2 && selN2.text} rows=${csNud.dataRows} emptyRow=${csNud.hasEmptyRow}`)
  }

  // ===================================================================
  console.log('\n===== 控制台错误 =====')
  ok('Z1 无 console error / pageerror', errs.length === 0, JSON.stringify(errs.slice(0, 5)))
  console.log('     （浏览器 confirm 弹窗被自动接受：' + JSON.stringify(dialogs) + '）')

  const pass = R.filter(r => r.pass).length
  console.log('\n=========================================================')
  console.log(`结果：${pass}/${R.length} 通过`)
  if (pass !== R.length) {
    console.log('失败项：')
    R.filter(r => !r.pass).forEach(r => console.log('   ✗ ' + r.id))
  }
  await browser.close()
  process.exit(pass === R.length ? 0 : 1)
})().catch(async e => { console.error('RUNNER ERROR', e); process.exit(2) })
