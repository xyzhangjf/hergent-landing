// v184b 真机验证：「商品档案」页的「到货周期」可编辑列
//
// 用法：
//   HG_TOKEN=<token> HG_TENANT=9999 NODE_PATH=<repo>/hergent-cn-v2/node_modules \
//     node v184b-archive-arrival-cycle.js
//
// 前提：已用 .workbuddy/tools/sandbox_tenant.py up --id 9999 --src 1 起隔离沙箱
//   （写操作只能在沙箱做；tenant_1 / tenant_10 只读）。
//   ⚠️ 沙箱会把 order_date 全改成今天 —— 本轮验证与 order_date 无关，不受影响。
//
// 断言锚点（取自沙箱 DB 实测，不是碰运气）：
//   已设：barcode 6923644203726「每日鲜语小鲜语3.6全脂鲜牛奶450ml*12瓶」= 4 天
//   未设：id 1608「简爱酸奶吸吸乐黄皮百香果味100克x40袋（通路版）」= 0
//
// 覆盖：
//   A 列存在 + 位置（紧跟「单位」，属商品身份块）
//   B 三态显示（+N天 / 未设 / 编辑中）与**接口值双向一致**
//   C 行内编辑真机全路径：设值 → 刷新后仍在 → 接口一致
//   D 留空 = 取消设置 → 0（与预报导入的「留空=不改动」语义相反，必须显式验证）
//   E 非法值（999 / 3.5 / -2）被拒：界面不变 + 库里不变
//   F 详情弹层与列表**同源**（同一个 arrivalCycleText）
//   G 新增表单：带值建档 ✔ ；**同名新增不带该键 → 不清零**（厂价踩过的坑）
//   H 导出 xlsx 含该列且写法与页面一致
//   I 主表回归：#/forecast 该列仍只读
const puppeteer = require('puppeteer-core')
const fs = require('fs')
const path = require('path')

const TOKEN = process.env.HG_TOKEN
const TENANT = process.env.HG_TENANT || '9999'
const BASE = process.env.HG_BASE || 'https://hergent.cn'
const DL = '/tmp/v184b_dl'

const SET_BC = '6923644203726'          // 已设 4 天
const SET_NAME = '每日鲜语小鲜语3.6全脂鲜牛奶450ml*12瓶'
const UNSET_NAME = '简爱酸奶吸吸乐黄皮百香果味100克x40袋（通路版）'

const results = []
function ok(cond, label, extra) {
  results.push({ pass: !!cond, label })
  console.log((cond ? '  ✓ ' : '  ✗ ') + label + (extra ? '   ' + extra : ''))
}
function info(m) { console.log('  · ' + m) }
function head(t) { console.log('\n=== ' + t + ' ===') }
const sleep = ms => new Promise(r => setTimeout(r, ms))

// ────────── 页面内取数（helper 必须内联：page.evaluate 只序列化函数自身） ──────────

function hdr() {
  const t = document.querySelector('table.tbl')
  if (!t) return { err: 'no-table' }
  const ths = [...t.querySelectorAll('thead th')].map(th => th.textContent.trim())
  return {
    ths,
    idx: ths.findIndex(x => x === '到货周期'),
    unitIdx: ths.findIndex(x => x === '单位'),
    rows: t.querySelectorAll('tbody tr').length,
  }
}

function cells() {
  const t = document.querySelector('table.tbl')
  if (!t) return { err: 'no-table' }
  const ths = [...t.querySelectorAll('thead th')].map(th => th.textContent.trim())
  const idx = ths.findIndex(x => x === '到货周期')
  return [...t.querySelectorAll('tbody tr')].map(tr => {
    const tds = [...tr.children]
    const td = tds[idx]
    if (!td) return { name: tds[0] ? tds[0].textContent.trim() : '?', state: 'no-cell' }
    const inp = td.querySelector('input.pa-cyc-input')
    const set = td.querySelector('.pa-cyc-val')
    const none = td.querySelector('.pa-cyc-none')
    return {
      name: tds[0].textContent.trim(),
      state: inp ? 'editing' : (set ? 'set' : (none ? 'unset' : 'other')),
      text: td.textContent.trim(),
      inputAttrs: inp ? ('type=' + inp.type + ' min=' + inp.min + ' max=' + inp.max) : '',
      clickable: !!set || !!none,
      tip: (set || none || {}).title || '',
    }
  })
}

async function apiProducts(bc) {
  const tk = localStorage.getItem('hergent_v2_token')
  const ten = localStorage.getItem('hergent_v2_tenant')
  const r = await fetch('/api/products?keyword=' + encodeURIComponent(bc) + '&limit=20', {
    headers: { Authorization: 'Bearer ' + tk, 'X-Tenant-Id': String(ten) },
  })
  return await r.json()
}

function clickCycleCell(rowIdx) {
  const t = document.querySelector('table.tbl')
  const tr = t.querySelectorAll('tbody tr')[rowIdx]
  const ths = [...t.querySelectorAll('thead th')].map(x => x.textContent.trim())
  const idx = ths.findIndex(x => x === '到货周期')
  const el = tr.children[idx].querySelector('.pa-cyc-val, .pa-cyc-none')
  if (!el) return false
  el.click()
  return true
}

function fillCycleInput(v) {
  const el = document.querySelector('table.tbl input.pa-cyc-input')
  if (!el) return { err: 'no-input' }
  el.focus()
  /* 用**原生 setter + input 事件**驱动 v-model，而不是 keyboard.type 前先 Meta+A 全选：
     headless Chrome 下 Meta+A 会失效，新字符**追加**到旧值后面 —— 想要 5 却得到 45，
     界面/库里都变成 45，看着像「保存逻辑错了」，其实是探针自己敲错了（v184b 首轮实测）。
     setter + input 事件是用户真实输入在 v-model 上的等价效果，且结果可回读断言。 */
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setter.call(el, String(v))
  el.dispatchEvent(new Event('input', { bubbles: true }))
  return { focused: document.activeElement === el, value: el.value }
}

// 抓写请求：**「被拒」的硬证据 = 根本没发出写请求**（比看 toast 更硬，toast 会过期/被覆盖）。
function installWriteLog() {
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
}
function takeWrites() { const a = window.__w || []; window.__w = []; return a }
// 轮询读 toast（3s 生命周期，且可能被下一次操作覆盖 —— 单点读取会漏）
async function pollToast(page, ms = 2500) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const t = await page.evaluate(toastText)
    if (t) return t
    await sleep(200)
  }
  return null
}

// 等主表（预报）网格真正渲染出行 —— 虚拟滚动下 DOM 行是懒渲染的，
// 不等就取 `tbody tr` 会拿到 null，把「还没渲染」误判成「元素不存在」。
async function waitRows(page, ms = 16000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const n = await page.evaluate(() => {
      const t = [...document.querySelectorAll('table.cross-tbl')].find(x => x.getAttribute('role') === 'grid')
      return t ? t.querySelectorAll('tbody tr').length : -1
    })
    if (n > 0) return n
    await sleep(800)
  }
  return 0
}

function rowIndexByName(nm) {
  const t = document.querySelector('table.tbl')
  return [...t.querySelectorAll('tbody tr')].findIndex(tr => tr.children[0].textContent.trim() === nm)
}

function toastText() {
  const el = document.querySelector('.toast')
  return el ? el.textContent.trim() : null
}

function detailValue() {
  const m = document.querySelector('.pa-modal')
  if (!m) return { err: 'no-modal' }
  const items = [...m.querySelectorAll('.pa-detail-item')]
  const it = items.find(x => x.querySelector('span') && x.querySelector('span').textContent.includes('到货周期'))
  return it ? it.querySelector('b').textContent.trim() : null
}

function openDetail(rowIdx) {
  const t = document.querySelector('table.tbl')
  const tr = t.querySelectorAll('tbody tr')[rowIdx]
  const btn = tr.querySelector('.pa-ops button')
  if (!btn) return false
  btn.click()
  return true
}

function setSearch(kw) {
  const i = document.querySelector('input.pa-kw')
  if (!i) return false
  i.value = kw
  i.dispatchEvent(new Event('input', { bubbles: true }))
  return true
}

function addFormFields() {
  const m = document.querySelector('.pa-modal')
  if (!m) return { err: 'no-modal' }
  return [...m.querySelectorAll('label.pa-f')].map(l => ({
    label: l.querySelector('span') ? l.querySelector('span').textContent.trim() : '',
    hasInput: !!l.querySelector('input'),
  }))
}

function fillAddField(labelKey, val) {
  const m = document.querySelector('.pa-modal')
  const ls = [...m.querySelectorAll('label.pa-f')]
  const l = ls.find(x => x.querySelector('span') && x.querySelector('span').textContent.includes(labelKey))
  if (!l) return false
  const i = l.querySelector('input')
  i.value = val
  i.dispatchEvent(new Event('input', { bubbles: true }))
  return true
}

function clickModalBtn(text) {
  const m = document.querySelector('.pa-modal')
  if (!m) return false
  const b = [...m.querySelectorAll('button')].find(x => x.textContent.trim().includes(text))
  if (!b) return false
  b.click()
  return true
}

// 抓导出的 blob：XLSX.writeFile 最终走 URL.createObjectURL + <a download>.click()
function installBlobTrap() {
  window.__blob = null
  const orig = URL.createObjectURL
  URL.createObjectURL = function (b) { window.__blob = b; return orig.call(URL, b) }
  const ac = HTMLAnchorElement.prototype.click
  HTMLAnchorElement.prototype.click = function () {
    if (this.download) { window.__dlName = this.download; return }   // 别真的下载
    return ac.call(this)
  }
}
async function readBlobB64() {
  if (!window.__blob) return null
  const buf = await window.__blob.arrayBuffer()
  let s = ''
  const u8 = new Uint8Array(buf)
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i])
  return btoa(s)
}

// ────────── 主流程 ──────────
;(async () => {
  fs.mkdirSync(DL, { recursive: true })
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1600, height: 950 })
  const errs = []
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message))
  page.on('dialog', d => d.accept())

  await page.evaluateOnNewDocument((t, ten) => {
    localStorage.setItem('hergent_v2_token', t)
    localStorage.setItem('hergent_v2_tenant', String(ten))
  }, TOKEN, TENANT)

  const goArchive = async () => {
    // 路由是嵌套的：#/archive/products（外壳 ArchiveShell + 子页 ProductArchive）。
    // ⚠️ 别猜成 #/products —— 那样会落到空壳上，`table.tbl` 找不到，症状像「页面没渲染」。
    await page.goto(BASE + '/?cb=' + Date.now() + '#/archive/products', { waitUntil: 'networkidle2', timeout: 60000 })
    await sleep(3500)
  }
  await goArchive()
  info('落点 URL: ' + page.url())
  ok(!/#\/login/.test(page.url()), '登录态注入成功（未被打回登录页）')

  // ── A. 列存在与位置 ──
  head('A. 列存在与位置')
  const A = await page.evaluate(hdr)
  if (A.err) { ok(false, '未找到商品档案表格：' + A.err); await browser.close(); process.exit(1) }
  info('表头(' + A.ths.length + '): ' + JSON.stringify(A.ths))
  ok(A.idx >= 0, '「到货周期」列存在', 'idx=' + A.idx)
  ok(A.idx === A.unitIdx + 1, '位置紧跟在「单位」之后（商品身份块末尾）', `单位@${A.unitIdx} → 到货周期@${A.idx}`)
  ok(A.idx > 0 && A.idx < A.ths.indexOf('品牌'), '位置在「品牌」之前（不落在价格组里）', '品牌@' + A.ths.indexOf('品牌'))
  info('本页行数: ' + A.rows)

  // ── B. 三态显示 == 接口值（逐行核对）──
  head('B. 三态显示 与 接口值 双向一致')
  const B = await page.evaluate(cells)
  const nonEmpty = B.filter(c => c.state !== 'other' && c.state !== 'no-cell')
  ok(nonEmpty.length === B.length, '每行该格都渲染出了三态之一（无「other」= 无渲染出口缺失）',
    '异常行: ' + JSON.stringify(B.filter(c => c.state === 'other' || c.state === 'no-cell').map(c => c.name)))
  const setRows = nonEmpty.filter(c => c.state === 'set')
  const unsetRows = nonEmpty.filter(c => c.state === 'unset')
  info(`本页：已设 ${setRows.length} 行 / 未设 ${unsetRows.length} 行 / 编辑中 ${nonEmpty.filter(c => c.state === 'editing').length} 行`)
  ok(setRows.length + unsetRows.length === nonEmpty.length, '三态判定无遗漏')
  ok(setRows.every(c => /^\+\d+天$/.test(c.text)), '已设行的写法严格是「+N天」',
    JSON.stringify(setRows.map(c => c.text).slice(0, 6)))
  ok(unsetRows.every(c => c.text === '未设'), '未设行显示「未设」（不是「—」：本格可点，破折号不表意）')
  ok(setRows.every(c => c.clickable) && unsetRows.every(c => c.clickable), '三态中的静态态都可点（有编辑入口）')
  ok(setRows.every(c => /点这里改/.test(c.tip)) && unsetRows.every(c => /点这里设置/.test(c.tip)),
    '两种态的 title 各自表意（可点但含义不同）')

  // 逐行与接口值比对
  const apiAll = await page.evaluate(apiProducts, '')
  const byName = {}
  for (const p of (apiAll.items || [])) byName[p.name] = p
  const mism = []
  for (const c of nonEmpty) {
    const p = byName[c.name]
    if (!p) continue                       // 本页 50 行按 id 倒序，接口取的是别的页
    const n = Number(p.arrival_lead_days) || 0
    const want = n > 0 ? '+' + n + '天' : '未设'
    if (c.text !== want) mism.push({ name: c.name, page: c.text, api: want })
  }
  ok(mism.length === 0, '逐行「页面显示 == 接口值」（同名同值，双向）', mism.length ? JSON.stringify(mism.slice(0, 4)) : `核对 ${nonEmpty.length} 行`)

  // ── C. 行内编辑真机全路径 ──
  head('C. 行内编辑：设值 → 刷新仍在 → 接口一致')
  await page.evaluate(setSearch, SET_BC)
  await sleep(1800)
  let C = await page.evaluate(cells)
  const apiC0 = await page.evaluate(apiProducts, SET_BC)
  const rowC0 = (apiC0.items || []).find(p => p.barcode === SET_BC)
  const dbC0 = rowC0 ? Number(rowC0.arrival_lead_days) || 0 : -1
  info('锚点：库=' + dbC0 + ' 页面=' + JSON.stringify(C.map(c => c.text)))
  ok(C.length === 1 && C[0].text === (dbC0 > 0 ? '+' + dbC0 + '天' : '未设'),
    '按条码检索命中 1 行，且页面显示 == 库里值（不预设初值，可重复跑）',
    `库=${dbC0} 页面=${C[0] && C[0].text}`)

  ok(await page.evaluate(clickCycleCell, 0), '点击该格 → 进入编辑态')
  await sleep(350)
  const editing = await page.evaluate(cells)
  ok(editing[0].state === 'editing', '渲染出输入框（不是只改状态没出口）')
  ok(/type=number/.test(editing[0].inputAttrs) && /max=365/.test(editing[0].inputAttrs),
    '输入框是 number 且带 max=365（与后端 _ATD_MAX 同值）', editing[0].inputAttrs)

  const fC = await page.evaluate(fillCycleInput, '5')
  ok(fC.value === '5', '输入框已收到 5（v-model 同步成功）', JSON.stringify(fC))
  await page.keyboard.press('Enter')
  await sleep(1300)
  const toastC = await page.evaluate(toastText)
  ok(/到货周期已设为 \+5天/.test(toastC || ''), '保存后有明确反馈', JSON.stringify(toastC))
  let afterC = await page.evaluate(cells)
  ok(afterC[0].state === 'set' && afterC[0].text === '+5天', '列表即时变为「+5天」', JSON.stringify(afterC[0]))

  await page.reload({ waitUntil: 'networkidle2' })
  await sleep(2500)
  await page.evaluate(setSearch, SET_BC)
  await sleep(1800)
  afterC = await page.evaluate(cells)
  ok(afterC[0].text === '+5天', '★ 刷新后仍是「+5天」（不是只在内存里）', JSON.stringify(afterC[0]))
  const apiC = await page.evaluate(apiProducts, SET_BC)
  const rowC = (apiC.items || []).find(p => p.barcode === SET_BC)
  ok(rowC && Number(rowC.arrival_lead_days) === 5, '★ 库里 = 5（经接口回读）', rowC ? 'arrival_lead_days=' + rowC.arrival_lead_days : 'not-found')

  // ── D. 留空 = 取消设置 ──
  head('D. 留空 = 取消设置（语义与预报导入的「留空=不改动」相反）')
  await page.evaluate(clickCycleCell, 0)
  await sleep(350)
  const fD = await page.evaluate(fillCycleInput, '')
  ok(fD.value === '', '输入框已清空', JSON.stringify(fD))
  await page.keyboard.press('Enter')
  await sleep(1300)
  const toastD = await page.evaluate(toastText)
  ok(/已取消设置/.test(toastD || ''), '反馈明确说了「取消设置」而不是含糊的「已保存」', JSON.stringify(toastD))
  let afterD = await page.evaluate(cells)
  ok(afterD[0].state === 'unset' && afterD[0].text === '未设', '列表变为「未设」', JSON.stringify(afterD[0]))
  await page.reload({ waitUntil: 'networkidle2' })
  await sleep(2500)
  await page.evaluate(setSearch, SET_BC)
  await sleep(1800)
  afterD = await page.evaluate(cells)
  ok(afterD[0].text === '未设', '★ 刷新后仍是「未设」', JSON.stringify(afterD[0]))
  const apiD = await page.evaluate(apiProducts, SET_BC)
  const rowD = (apiD.items || []).find(p => p.barcode === SET_BC)
  ok(rowD && Number(rowD.arrival_lead_days) === 0, '★ 库里 = 0（清得掉，不是「清了又自己回来」）', rowD ? 'arrival_lead_days=' + rowD.arrival_lead_days : 'not-found')

  // ── E. 非法值被拒 ──
  head('E. 非法值被拒：界面不变 + 库不变 + **没有发出写请求**')
  await page.evaluate(installWriteLog)
  for (const [bad, why, expectToast] of [
    ['999', '超上界 365', true],
    ['3.5', '小数', true],
    ['-2', '负数', true],
    // 'abc' 存不进 type="number"（DOM 自己把 value 变空）⇒ 不是我们的校验拦的，
    // 故只断言「无写请求 + 状态不变」，不断言错误提示（那会把浏览器的功劳算成我们的）。
    ['abc', '非数字（DOM 层就存不下）', false],
  ]) {
    const preC = await page.evaluate(cells)
    const apiPre = await page.evaluate(apiProducts, SET_BC)
    const rPre = (apiPre.items || []).find(p => p.barcode === SET_BC)
    const dbPre = rPre ? Number(rPre.arrival_lead_days) || 0 : -1
    await page.evaluate(takeWrites)                       // 清空写日志
    await page.evaluate(clickCycleCell, 0)
    await sleep(300)
    const fE = await page.evaluate(fillCycleInput, bad)
    await page.keyboard.press('Enter')
    const t = await pollToast(page, 2200)
    const c = await page.evaluate(cells)
    const apiE = await page.evaluate(apiProducts, SET_BC)
    const rowE = (apiE.items || []).find(p => p.barcode === SET_BC)
    const dbv = rowE ? Number(rowE.arrival_lead_days) || 0 : -1
    const writes = await page.evaluate(takeWrites)
    const toastOK = expectToast ? /到货天数请填/.test(t || '') : true
    ok(toastOK && c[0].text === preC[0].text && dbv === dbPre && writes.length === 0,
      `「${bad}」（${why}）被拒且无副作用`,
      `toast=${JSON.stringify(t)} 页面 ${preC[0].text}→${c[0].text} 库 ${dbPre}→${dbv} 写请求=${writes.length} input=${JSON.stringify(fE.value)}`)
  }

  // ── F. 详情弹层同源 ──
  head('F. 详情弹层与列表同源（同一个 arrivalCycleText）')
  await page.evaluate(clickCycleCell, 0)
  await sleep(350)
  await page.evaluate(fillCycleInput, '3')
  await page.keyboard.press('Enter')
  await sleep(1300)
  const listF = await page.evaluate(cells)
  await page.evaluate(openDetail, 0)
  await sleep(600)
  const dF = await page.evaluate(detailValue)
  ok(dF === listF[0].text, '弹层「到货周期」== 列表该格文案', `列表=${listF[0].text} 弹层=${dF}`)
  await page.evaluate(() => { const b = [...document.querySelectorAll('.pa-modal button')].find(x => x.textContent.includes('知道了')); if (b) b.click() })
  await sleep(500)

  // ── G. 新增表单：能带值；同名不带该键不清零 ──
  head('G. 新增表单：带值建档 ✔ / 同名不带该键 → 不清零（厂价踩过的坑）')
  const NEW_NAME = 'v184b临时测试商品-带周期'
  await page.evaluate(() => { const b = [...document.querySelectorAll('.pa-actions button')].find(x => x.textContent.includes('新增')); b.click() })
  await sleep(700)
  // ⚠️ 必须先开弹窗再断言字段 —— 首轮把断言写在开弹窗前，拿到 no-modal 报假失败。
  const af = await page.evaluate(addFormFields)
  ok(Array.isArray(af) && af.some(f => f.label.includes('到货周期') && f.hasInput),
    '新增弹窗里有「到货周期」输入框', Array.isArray(af) ? JSON.stringify(af.map(x => x.label)) : JSON.stringify(af))
  await page.evaluate(fillAddField, '商品名称', NEW_NAME)
  await page.evaluate(fillAddField, '条码', 'V184BTEST001')
  await page.evaluate(fillAddField, '到货周期', '6')
  await page.evaluate(clickModalBtn, '保存')
  await sleep(2500)
  let apiG = await page.evaluate(apiProducts, 'V184BTEST001')
  let rowG = (apiG.items || []).find(p => p.barcode === 'V184BTEST001')
  ok(rowG && Number(rowG.arrival_lead_days) === 6, '新增（填 6）→ 建档即带到货周期 6', rowG ? 'days=' + rowG.arrival_lead_days : 'not-created')

  // 同名新增、**不填**该字段 → 不得清零
  await page.evaluate(() => { const b = [...document.querySelectorAll('.pa-actions button')].find(x => x.textContent.includes('新增')); b.click() })
  await sleep(700)
  await page.evaluate(fillAddField, '商品名称', NEW_NAME)
  await page.evaluate(fillAddField, '条码', 'V184BTEST001')
  await page.evaluate(fillAddField, '规格', 'X')      // 制造一个「确实更新了」的证据
  await page.evaluate(clickModalBtn, '保存')
  await sleep(2500)
  apiG = await page.evaluate(apiProducts, 'V184BTEST001')
  rowG = (apiG.items || []).find(p => p.barcode === 'V184BTEST001')
  ok(rowG && Number(rowG.arrival_lead_days) === 6,
    '★ 同名新增且**留空**该字段 → 到货周期仍是 6（未被 0 覆盖）',
    rowG ? `days=${rowG.arrival_lead_days} spec=${rowG.spec}` : 'not-found')
  ok(rowG && rowG.spec === 'X', '（对照）同一次保存的其它字段确实被更新了 → 证明不是「整个请求没生效」', rowG ? 'spec=' + rowG.spec : '')

  // ── H. 导出含该列 ──
  head('H. 导出 xlsx 含「到货周期」且写法与页面一致')
  await page.evaluate(setSearch, 'V184BTEST001')
  await sleep(1600)
  await page.evaluate(installBlobTrap)
  await page.evaluate(() => { const b = [...document.querySelectorAll('.pa-actions button')].find(x => x.textContent.includes('导出')); b.click() })
  await sleep(2500)
  const b64 = await page.evaluate(readBlobB64)
  if (b64) {
    const buf = Buffer.from(b64, 'base64')
    fs.writeFileSync(path.join(DL, 'archive.xlsx'), buf)
    let XLSX = null
    try { XLSX = require('xlsx') } catch (e) { XLSX = null }
    if (XLSX) {
      const wb = XLSX.read(buf, { type: 'buffer' })
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })
      const cols = rows.length ? Object.keys(rows[0]) : []
      ok(cols.includes('到货周期'), '导出表头含「到货周期」', JSON.stringify(cols))
      ok(rows.length === 1 && rows[0]['到货周期'] === '+6天',
        '导出值与页面同写法（+6天）', JSON.stringify(rows[0] || {}))
    } else { ok(false, '本地缺 xlsx 依赖，无法解析导出件（用 NODE_PATH 指到 hergent-cn-v2/node_modules）') }
  } else { ok(false, '没抓到导出的 blob（导出按钮可能未生效）') }

  // ── I. 主表回归：该列仍只读 ──
  head('I. 回归：#/forecast 主表该列仍只读（本轮只加了「另一个写入口」，没放开网格）')
  await page.goto(BASE + '/?cb=' + Date.now() + '#/forecast', { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(4000)
  // ⚠️ 虚拟滚动下 tbody 行是懒渲染的：不等就取 tr 会拿到 null，
  //    于是 hasInput/frozen/left 全变 null，看起来像「只读失效 + 冻结失效」两个产品缺陷（首轮实测）。
  const nRows = await waitRows(page)
  info('主表已渲染行数: ' + nRows)
  const I = await page.evaluate(() => {
    const t = [...document.querySelectorAll('table.cross-tbl')].find(x => x.getAttribute('role') === 'grid')
    if (!t) return { err: 'no-cross-tbl' }
    const cols = [...t.querySelectorAll('colgroup col')]
    const ths = [...t.querySelectorAll('thead th')].map(th => {
      const sp = th.querySelector('.th-in span')
      return sp ? sp.textContent.trim() : (th.classList.contains('seq-th') ? '[序号]' : '')
    })
    const i = ths.indexOf('到货周期')
    /* 🔴 不能用 `tr.children[i]` 抓那格 —— 网格支持分组（groupBy），
       第一条 `tbody tr` 可能是**只有一格的分组表头行**，按列序取必然取到 null/错格，
       表现出来就像「只读失效 + 冻结失效」两个产品缺陷（v184b 首轮实测正是如此）。
       改为按**具体列类名**找 `td.fc-cycle`（禁用 `[class*=xx-]` 属性选择器：
       它会命中 Teleport 到 body 之前的同前缀元素）。 */
    const td = [...t.querySelectorAll('tbody tr td')].find(x => x.classList.contains('fc-cycle'))
    const firstRow = [...t.querySelectorAll('tbody tr')].find(r => r.querySelector('td'))
    return {
      ths, idx: i,
      rowTds: firstRow ? [...firstRow.children].map(x => ({ c: String(x.className).slice(0, 26), t: x.textContent.trim().slice(0, 8) })).slice(0, 7) : null,
      found: !!td,
      cellText: td ? td.textContent.trim() : null,
      hasInput: td ? !!td.querySelector('input') : null,
      frozen: td ? td.classList.contains('frozen') : null,
      left: td ? getComputedStyle(td).left : null,
      seqW: cols[0] ? (/(\d+)/.exec(cols[0].getAttribute('style') || '') || [])[1] : null,
      nameW: cols[1] ? (/(\d+)/.exec(cols[1].getAttribute('style') || '') || [])[1] : null,
    }
  })
  if (I.err) ok(false, '未找到主表：' + I.err)
  else {
    ok(I.idx >= 0, '主表仍有「到货周期」列', 'idx=' + I.idx)
    if (!I.found) {
      ok(false, '未抓到 td.fc-cycle（诊断：见下）', JSON.stringify(I.rowTds))
      info('首行各格: ' + JSON.stringify(I.rowTds))
    } else {
      ok(I.hasInput === false, '★ 主表该格仍是只读（无 input）')
      ok(I.frozen === true, '该列仍冻结')
      const seqW = I.seqW ? Number(I.seqW) : null, nameW = I.nameW ? Number(I.nameW) : null
      ok(I.left === (seqW + nameW) + 'px', '冻结偏移仍 = 序号宽 + 商品名称宽（非硬编码）',
        `left=${I.left} 期望=${seqW + nameW}px`)
      info('主表该格文案: ' + JSON.stringify(I.cellText))
    }
  }

  head('汇总')
  const failed = results.filter(r => !r.pass)
  console.log(`  ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) { console.log('  失败项:'); failed.forEach(f => console.log('    - ' + f.label)) }
  if (errs.length) { console.log('  控制台错误 ' + errs.length + ' 条:'); errs.slice(0, 6).forEach(e => console.log('    ! ' + e)) }
  else console.log('  控制台无错误 ✓')
  await browser.close()
  process.exit(failed.length ? 1 : 0)
})().catch(e => { console.error('探针异常:', e); process.exit(2) })
