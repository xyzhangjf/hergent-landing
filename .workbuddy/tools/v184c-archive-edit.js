'use strict'
/* v184c 真机验证：商品档案「编辑」弹窗（原只读详情升级为可编辑）+ 修改记录
 *
 * 覆盖分组：
 *   A 入口按钮改为「编辑」
 *   B 弹窗结构（标题 / 分组小标题 / 底部按钮）
 *   C 字段可编辑性（14 个 input、条码与厂家编码 disabled、0 值渲染成空框）
 *   D dirtyCount 与「保存」可用态三态（未改 / 改了 / 改回）
 *   E 🔴 diff 提交 —— 只改一个字段时，PUT body 里**只应有那一个键**（本轮核心断言）
 *   F 修改记录（展开才请求 / 字段名中文 / 刚改的排最前 / 改前→改后正确）
 *   G 非法值被拒（名称空 / 负价 / 到货周期越界）—— 硬证据是「零写请求」
 *   H 关闭行为（有未保存改动时提示一次）
 *   I 状态切换的内联二次确认（取消不产生请求）
 *   J 行内编辑回归（品牌 / 厂价 / 到货周期三列仍可直接点改）
 *
 * 跑法：
 *   NODE_PATH=<ws>/node_modules:<repo>/hergent-cn-v2/node_modules \
 *   HG_TOKEN=xxx HG_TENANT=9997 node .workbuddy/tools/v184c-archive-edit.js
 */
const puppeteer = require('puppeteer-core')

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const TOKEN = process.env.HG_TOKEN
const TENANT = process.env.HG_TENANT
const CHROME = process.env.HG_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const KEYS = ['name', 'spec', 'unit', 'category', 'brand', 'alias',
  'sale_price', 'purchase_price', 'factory_price', 'dist_price',
  'safety_stock', 'expiry_days', 'arrival_lead_days', 'description']

let pass = 0, fail = 0
const out = []
function ok(cond, name, extra) {
  if (cond) { pass++; out.push('  PASS  ' + name) }
  else { fail++; out.push('  FAIL  ' + name + (extra === undefined ? '' : '   << ' + String(extra).slice(0, 260))) }
}
function info(m) { out.push('  info  ' + m) }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

/* ---------------- 浏览器侧 helper（全部作为字符串注入，避免闭包被序列化丢失） ---------------- */

const HELPERS = function () {
  window.__w = []
  const of = window.fetch
  window.fetch = function (u, o) {
    try {
      const m = ((o && o.method) || 'GET').toUpperCase()
      if (/\/api\/products/.test(String(u)) && m !== 'GET') {
        window.__w.push({ url: String(u), method: m, body: String((o && o.body) || '') })
      }
    } catch (e) { /* 记录失败不影响请求本身 */ }
    return of.apply(this, arguments)
  }
  window.__wClear = function () { window.__w = [] }

  /* 弹窗内按 label 前缀定位输入框（label 里的 <span> 会连带 hint 文本，故用 startsWith） */
  window.__field = function (lb) {
    const m = document.querySelector('.pa-modal.pa-edit')
    if (!m) return { err: 'no-modal' }
    for (const l of m.querySelectorAll('label.pa-f')) {
      const sp = l.querySelector('span')
      if (sp && sp.textContent.trim().startsWith(lb)) {
        const el = l.querySelector('input, textarea')
        if (!el) return { err: 'no-input' }
        return { v: el.value, disabled: !!el.disabled, tag: el.tagName, type: el.getAttribute('type') || '' }
      }
    }
    return { err: 'no-field:' + lb }
  }

  /* 用原生 setter + input 事件驱动 v-model。
     ⚠️ 不用 Meta+A 再 type：headless Chrome 下 Meta+A 会失效，新字符**追加**到旧值后面
        （想要 5 却得到 45，看着像保存逻辑错了，其实是探针敲错了 —— v184b 首轮实测踩过）。 */
  window.__set = function (lb, v) {
    const m = document.querySelector('.pa-modal.pa-edit')
    if (!m) return 'no-modal'
    for (const l of m.querySelectorAll('label.pa-f')) {
      const sp = l.querySelector('span')
      if (sp && sp.textContent.trim().startsWith(lb)) {
        const el = l.querySelector('input, textarea')
        if (!el) return 'no-input'
        el.focus()
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, String(v))
        el.dispatchEvent(new Event('input', { bubbles: true }))
        return 'ok'
      }
    }
    return 'no-field:' + lb
  }

  window.__ftState = function () {
    const m = document.querySelector('.pa-modal.pa-edit')
    if (!m) return { err: 'no-modal' }
    const ft = m.querySelector('.pa-modal-ft')
    const btn = ft && ft.querySelector('.btn-primary')
    const note = ft && ft.querySelector('.pa-ft-note')
    return {
      saveDisabled: btn ? !!btn.disabled : null,
      saveText: btn ? btn.textContent.trim() : null,
      note: note ? note.textContent.trim() : '',
    }
  }
}

/* ⚠️ 必须包成 IIFE 再当字符串求值：`fn.toString()` 得到的是**匿名函数表达式**
   `function () {…}`，而 puppeteer 把字符串当**表达式**求值时，`function` 开头会被解析成
   **函数声明**（要求有名字）⇒ 直接抛 `SyntaxError: Function statements require a function name`。 */
const installHelpers = '(' + HELPERS.toString() + ')()'

/* ---------------- 页面操作 ---------------- */

async function waitRows(page, ms) {
  const t0 = Date.now()
  while (Date.now() - t0 < (ms || 18000)) {
    const n = await page.evaluate(() => document.querySelectorAll('table.tbl tbody tr').length)
    if (n > 0) return n
    await sleep(200)
  }
  return 0
}

async function pollToast(page, ms) {
  const t0 = Date.now()
  while (Date.now() - t0 < (ms || 2600)) {
    const t = await page.evaluate(() => {
      const e = document.querySelector('.toast')
      return e ? e.textContent.trim() : null
    })
    if (t) return t
    await sleep(120)
  }
  return null
}

async function openRow(page, idx) {
  return await page.evaluate((i) => {
    const tr = document.querySelectorAll('table.tbl tbody tr')[i]
    if (!tr) return 'no-row'
    const b = [...tr.querySelectorAll('button')].find(x => x.textContent.trim() === '编辑')
    if (!b) return 'no-edit-btn'
    b.click()
    return 'ok'
  }, idx)
}

async function closeModal(page) {
  await page.evaluate(() => {
    const m = document.querySelector('.pa-modal.pa-edit')
    if (!m) return
    const b = [...m.querySelectorAll('.pa-modal-ft button')].find(x => x.textContent.trim() === '取消')
    if (b) b.click()
    else { const x = m.querySelector('.pa-x'); if (x) x.click() }
  })
  await sleep(400)
}

async function clickSave(page) {
  await page.evaluate(() => {
    const m = document.querySelector('.pa-modal.pa-edit')
    if (!m) return
    const b = m.querySelector('.pa-modal-ft .btn-primary')
    if (b) b.click()
  })
}

const lastWrite = (page) => page.evaluate(() => (window.__w || []).slice(-1)[0] || null)
const writeCount = (page) => page.evaluate(() => (window.__w || []).length)
const clearWrites = (page) => page.evaluate(() => window.__wClear())

/* ---------------- 主流程 ---------------- */

async function main() {
  if (!TOKEN || !TENANT) { console.error('缺 HG_TOKEN / HG_TENANT'); process.exit(2) }
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    defaultViewport: { width: 1560, height: 1020 },
  })
  const page = await browser.newPage()
  page.on('pageerror', e => info('页面 JS 错误: ' + String(e.message).slice(0, 160)))

  await page.evaluateOnNewDocument((t, tn) => {
    localStorage.setItem('hergent_v2_token', t)
    localStorage.setItem('hergent_v2_tenant', tn)
  }, TOKEN, String(TENANT))

  out.push('### v184c 商品档案「编辑」弹窗 —— 真机验证')
  out.push('环境: ' + BASE + '  租户: ' + TENANT)

  await page.goto(BASE + '/#/archive/products', { waitUntil: 'networkidle2', timeout: 45000 })
  await page.evaluate(installHelpers)
  const rows = await waitRows(page)
  ok(rows > 0, 'A1 档案页表格渲染出行', 'rows=' + rows)
  if (!rows) { out.push('无法继续'); return finish(browser) }

  /* ---------- A 入口 ---------- */
  const btnTexts = await page.evaluate(() => [...document.querySelectorAll('table.tbl tbody tr')]
    .slice(0, 3).map(tr => [...tr.querySelectorAll('button')].map(b => b.textContent.trim()).join('|')))
  ok(btnTexts.length && btnTexts.every(s => s.indexOf('编辑') >= 0),
    'A2 每行操作列的按钮是「编辑」', JSON.stringify(btnTexts))

  /* ---------- B/C 打开弹窗、结构、字段 ---------- */
  const opened = await openRow(page, 0)
  await sleep(600)
  const modal = await page.evaluate(() => {
    const m = document.querySelector('.pa-modal.pa-edit')
    if (!m) return { err: 'no-modal' }
    return {
      title: (m.querySelector('.pa-modal-hd b') || {}).textContent || '',
      secs: [...m.querySelectorAll('.pa-sec')].map(s => s.textContent.trim().slice(0, 8)),
      nInput: m.querySelectorAll('input, textarea').length,
      nDisabled: [...m.querySelectorAll('input')].filter(i => i.disabled).length,
      hasLog: !!m.querySelector('.pa-log, .pa-sec-click'),
      ft: [...m.querySelectorAll('.pa-modal-ft button')].map(b => b.textContent.trim()),
      dirtyNote: !!m.querySelector('.pa-ft-note'),
    }
  })
  ok(opened === 'ok' && !modal.err, 'B1 点「编辑」打开弹窗', opened + '/' + JSON.stringify(modal.err))
  ok(modal.title && modal.title.indexOf('编辑商品') === 0, 'B2 弹窗标题为「编辑商品 · …」', modal.title)
  ok(modal.secs && modal.secs.length >= 6, 'B3 有分组小标题（身份/品牌/价格/库存/描述/状态…）', JSON.stringify(modal.secs))
  ok(modal.nInput >= 15, 'C1 弹窗内输入框数量 >= 15（14 可改 + 2 只读）', modal.nInput)
  ok(modal.nDisabled === 2, 'C2 恰好 2 个只读框（条码 + 厂家编码）', modal.nDisabled)
  ok(modal.hasLog, 'B4 有「修改记录」可展开区块')

  const barcode = await page.evaluate(() => window.__field('条码'))
  const pcode = await page.evaluate(() => window.__field('厂家编码'))
  ok(barcode.disabled === true && pcode.disabled === true, 'C3 条码与厂家编码确实 disabled',
    JSON.stringify({ barcode: barcode.disabled, pcode: pcode.disabled }))

  /* 14 个字段都能定位到输入框 */
  const found = []
  for (const k of ['商品名称', '规格', '单位', '分类', '品牌', '别名', '标准售价', '进价',
    '厂价', '分销价', '安全库存', '保质期(天)', '到货周期', '描述']) {
    const f = await page.evaluate((lb) => window.__field(lb), k)
    found.push(k + '=' + (f.err ? 'ERR' : 'ok'))
  }
  ok(found.every(s => s.indexOf('=ok') > 0), 'C4 14 个可改字段都能定位到输入框',
    found.filter(s => s.indexOf('=ok') < 0).join(',') || 'all ok')

  /* ---------- D dirtyCount 三态 ---------- */
  const st0 = await page.evaluate(() => window.__ftState())
  ok(st0.saveDisabled === true, 'D1 刚打开时「保存」置灰（没有改动）', JSON.stringify(st0))
  ok(!st0.note, 'D2 刚打开时没有「N 个字段已改」提示', JSON.stringify(st0.note))

  const v0 = await page.evaluate(() => window.__field('标准售价'))
  info('打开行的标准售价现值 = ' + JSON.stringify(v0.v))
  const num0 = Number(v0.v || 0)
  const v1 = String(num0 > 0 ? num0 + 1 : 5)     // 改成一个一定不同的值
  await page.evaluate((lb, v) => window.__set(lb, v), '标准售价', v1)
  await sleep(220)
  const st1 = await page.evaluate(() => window.__ftState())
  ok(st1.saveDisabled === false, 'D3 改了字段后「保存」可用', JSON.stringify(st1))
  ok(!!st1.note && st1.note.indexOf('1 个字段') >= 0, 'D4 提示「1 个字段已改，未保存」', st1.note)

  /* ---------- G 非法值被拒（在 E 之前做，避免污染 diff 状态） ---------- */
  await clearWrites(page)
  const cases = [
    ['商品名称', '', '名称为空'],
    ['标准售价', '-5', '售价负数'],
    ['到货周期', '999', '到货周期越界'],
  ]
  for (const [lb, val, why] of cases) {
    const bak = await page.evaluate((l) => window.__field(l), lb)
    await page.evaluate((l, v) => window.__set(l, v), lb, val)
    await sleep(180)
    await clickSave(page)
    await sleep(600)
    const w = await writeCount(page)
    const open = await page.evaluate(() => !!document.querySelector('.pa-modal.pa-edit'))
    ok(w === 0 && open, 'G ' + why + ' → 被拒且**零写请求**（弹窗未关）',
      'writes=' + w + ' modalOpen=' + open)
    // 还原该字段，保持后续 diff 断言干净
    await page.evaluate((l, v) => window.__set(l, v), lb, bak.v)
    await sleep(150)
    await clearWrites(page)
  }

  /* ---------- H 关闭行为（有改动时提示） ---------- */
  await page.evaluate((lb, v) => window.__set(lb, v), '标准售价', v1)
  await sleep(180)
  await closeModal(page)
  const tClose = await pollToast(page, 1500)
  ok(tClose && tClose.indexOf('放弃') >= 0, 'H1 有未保存改动时关闭会提示已放弃', JSON.stringify(tClose))
  const modalGone = await page.evaluate(() => !document.querySelector('.pa-modal.pa-edit'))
  ok(modalGone, 'H2 关闭后弹窗确实消失')

  /* ---------- E 🔴 diff 提交（核心） ---------- */
  await clearWrites(page)
  await openRow(page, 0)
  await sleep(600)
  const beforeE = await page.evaluate(() => window.__field('标准售价'))
  const n0 = Number(beforeE.v || 0)
  const n1 = n0 > 0 ? n0 + 1 : 5
  await page.evaluate((lb, v) => window.__set(lb, v), '标准售价', String(n1))
  await sleep(220)
  await clickSave(page)
  /* ⚠️ 「保存成功」的 toast 只活 3 秒，而且是**请求完成后才显示** —— 必须**立刻**开始轮询。
     首轮实测：把它放在几次 evaluate 之后才问，读到的就是 null，看着像「保存没回执」，
     其实只是探针问得太晚（保存本身 E1/E2/E3/E5/E6 全过）。 */
  const tSave = await pollToast(page, 3000)
  await sleep(900)
  const w1 = await lastWrite(page)
  let keys1 = []
  try { keys1 = Object.keys(JSON.parse(w1.body)).sort() } catch (e) { /* 解析失败下面会报 */ }
  ok(w1 && w1.method === 'PUT', 'E1 保存发出了 PUT /api/products/{id}', JSON.stringify(w1 && w1.method))
  ok(keys1.length === 1 && keys1[0] === 'sale_price',
    'E2 🔴 diff 提交：body 只含 sale_price（不是整表回传）', JSON.stringify(keys1))
  ok(Number(JSON.parse(w1.body).sale_price) === n1, 'E3 提交的值是改后的值', w1.body)
  ok(tSave && tSave.indexOf('已保存') >= 0, 'E4 保存成功有回执', JSON.stringify(tSave))
  const modalClosed = await page.evaluate(() => !document.querySelector('.pa-modal.pa-edit'))
  ok(modalClosed, 'E5 保存后弹窗自动关闭')

  /* 列表行即时更新（不刷新页面） */
  await sleep(500)
  const rowTxt = await page.evaluate(() => {
    const tr = document.querySelectorAll('table.tbl tbody tr')[0]
    return tr ? tr.textContent : ''
  })
  ok(rowTxt.indexOf(String(n1)) >= 0, 'E6 列表该行已就地更新为新值（无需刷新）', rowTxt.slice(0, 120))

  /* ---------- F 修改记录 ---------- */
  await clearWrites(page)
  await openRow(page, 0)
  await sleep(600)
  const logBefore = await page.evaluate(() => !!document.querySelector('.pa-modal.pa-edit .pa-log'))
  ok(!logBefore, 'F1 修改记录默认收起（未展开就不请求）')
  await page.evaluate(() => {
    const s = document.querySelector('.pa-modal.pa-edit .pa-sec-click')
    if (s) s.click()
  })
  await sleep(1400)
  const log = await page.evaluate(() => {
    const box = document.querySelector('.pa-modal.pa-edit .pa-log')
    if (!box) return { err: 'no-log' }
    const rows = [...box.querySelectorAll('.pa-log-row')].slice(0, 4).map(r => ({
      t: (r.querySelector('.pa-log-t') || {}).textContent || '',
      w: (r.querySelector('.pa-log-w') || {}).textContent || '',
      f: (r.querySelector('.pa-log-f') || {}).textContent || '',
      v: (r.querySelector('.pa-log-v') || {}).textContent || '',
    }))
    return { n: box.querySelectorAll('.pa-log-row').length, rows, empty: !!box.querySelector('.pa-log-empty') }
  })
  ok(!log.err && log.n > 0, 'F2 展开后有修改记录', JSON.stringify(log.err || ('n=' + log.n)))
  if (log.n > 0) {
    info('最近 4 条: ' + JSON.stringify(log.rows))
    ok(log.rows[0].f === '标准售价', 'F3 刚改的字段排在最前，且字段名是中文', log.rows[0].f)
    ok(log.rows[0].v.indexOf(String(n1)) >= 0, 'F4 记录里「改后」值正确', log.rows[0].v)
    ok(/\d{4}-\d{2}-\d{2}/.test(log.rows[0].t), 'F5 记录带时间', log.rows[0].t)
    ok(log.rows[0].w && log.rows[0].w !== '—', 'F6 记录带操作人', log.rows[0].w)
  }

  /* ---------- E（续）改回原值，把沙箱数据还原 ---------- */
  await page.evaluate((lb, v) => window.__set(lb, v), '标准售价', String(n0 || ''))
  await sleep(220)
  const stBack = await page.evaluate(() => window.__ftState())
  info('改回原值后的底部状态 = ' + JSON.stringify(stBack))
  await clearWrites(page)
  await clickSave(page)
  await sleep(1000)
  const w2 = await lastWrite(page)
  let keys2 = []
  try { keys2 = Object.keys(JSON.parse(w2.body)).sort() } catch (e) { /* ignore */ }
  ok(keys2.length === 1 && keys2[0] === 'sale_price', 'E7 还原也走 diff（仍只有 sale_price）', JSON.stringify(keys2))
  info('还原提交 = ' + (w2 && w2.body))

  /* ---------- I 状态切换二次确认 ---------- */
  await sleep(400)
  await openRow(page, 0)
  await sleep(600)
  await clearWrites(page)
  const act0 = await page.evaluate(() => {
    const a = document.querySelector('.pa-modal.pa-edit .pa-active')
    if (!a) return { err: 'no-active-row' }
    const btn = [...a.querySelectorAll('button')].find(b => /停用此商品|启用此商品/.test(b.textContent))
    if (!btn) return { err: 'no-active-btn' }
    btn.click()
    return { label: btn.textContent.trim() }
  })
  await sleep(400)
  const act1 = await page.evaluate(() => {
    const a = document.querySelector('.pa-modal.pa-edit .pa-active')
    return {
      buttons: [...a.querySelectorAll('button')].map(b => b.textContent.trim()),
    }
  })
  ok(!act0.err && act1.buttons.some(b => b.indexOf('确认') === 0),
    'I1 点「' + (act0.label || '?') + '」出现内联二次确认（确认/取消）', JSON.stringify(act1))
  // 点「取消」→ 不得产生写请求
  await page.evaluate(() => {
    const a = document.querySelector('.pa-modal.pa-edit .pa-active')
    const b = [...a.querySelectorAll('button')].find(x => x.textContent.trim() === '取消')
    if (b) b.click()
  })
  await sleep(500)
  ok(await writeCount(page) === 0, 'I2 二次确认点「取消」不产生任何写请求')

  /* ---------- J 行内编辑回归 ---------- */
  await closeModal(page)
  await sleep(400)
  const inline = await page.evaluate(() => {
    const tr = document.querySelectorAll('table.tbl tbody tr')[0]
    if (!tr) return { err: 'no-row' }
    return {
      cyc: !!tr.querySelector('td.pa-cyc-cell'),
      brand: !!tr.querySelector('td.pa-brand-cell'),
      fp: !!tr.querySelector('td.pa-fp-cell'),
    }
  })
  ok(inline.cyc && inline.brand && inline.fp, 'J1 行内可编三列（到货周期/品牌/厂价）仍在', JSON.stringify(inline))

  /* 点品牌格 → 应出现输入框（行内编辑未被本次改造破坏） */
  await page.evaluate(() => {
    const tr = document.querySelectorAll('table.tbl tbody tr')[0]
    const b = tr && tr.querySelector('td.pa-brand-cell .pa-brand')
    if (b) b.click()
  })
  await sleep(500)
  const brandInput = await page.evaluate(() => !!document.querySelector('table.tbl input.pa-brand-input'))
  ok(brandInput, 'J2 点品牌格仍能进入行内编辑态')

  return finish(browser)
}

async function finish(browser) {
  console.log(out.join('\n'))
  console.log('\n' + '='.repeat(60))
  console.log('结果: ' + pass + ' PASS / ' + fail + ' FAIL  （共 ' + (pass + fail) + ' 项）')
  console.log('='.repeat(60))
  try { await browser.close() } catch (e) { /* ignore */ }
  process.exit(fail ? 1 : 0)
}

main().catch(e => { console.error('探针异常:', e && e.stack || e); process.exit(3) })
