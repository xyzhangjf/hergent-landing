// v184b · 预报主表「到货周期」列的**数据集无关**复核（重点：off-archive 行不丢字段）
//
// 用法：
//   HG_TOKEN=<token> HG_TENANT=9999 [HG_SEED_PIDS=1293,1294] NODE_PATH=<ws>[:<repo>/node_modules] \
//     node v184b-offarchive-forecast.js
//
// 为什么要单写一个：
//   上一轮的 v184-arrival-cycle-page.js 把期望值写死成 pid 1160/1161/1162/1523/1164 ——
//   那是**当时那份沙箱数据**的 fixture。换一份数据（本轮沙箱克隆自 tenant_1）后这些 pid
//   根本不在本期行底，探针报 4 条「未遍历到」，看起来像产品缺陷，其实只是 fixture 过期。
//
// 本探针的做法（与数据集解耦）：
//   ① 期望值**从接口现取**（`/api/products?include_inactive=1&limit=5000`）→ {pid: 天数}
//   ② 虚拟滚动遍历主表全部行 → {pid: 页面文案}
//   ③ **逐行双向核对**：有值的行必须显示「+N天」，无值的必须显示「—」。
//      这条断言天然覆盖 off-archive（已停用但被本期引用）行 —— 那类行不走 products/grid，
//      若字段在 imported_products 查询或 asProdRow 白名单里漏了，它就会恒显示「—」而库里有值。
//   ④ 用 HG_SEED_PIDS 在沙箱里给若干 off-archive 行**播一个非零值**，保证「带值的 off-archive 行」
//      真的进入覆盖面（否则整列都是 — 时，③ 是恒真的空断言）。
const puppeteer = require('puppeteer-core')

const TOKEN = process.env.HG_TOKEN
const TENANT = process.env.HG_TENANT || '9999'
const BASE = process.env.HG_BASE || 'https://hergent.cn'
const SEED = (process.env.HG_SEED_PIDS || '1293,1294').split(',').map(s => s.trim()).filter(Boolean)
const SEED_DAYS = Number(process.env.HG_SEED_DAYS || 3)

const results = []
function ok(c, l, e) { results.push({ pass: !!c, label: l }); console.log((c ? '  ✓ ' : '  ✗ ') + l + (e ? '   ' + e : '')) }
function info(m) { console.log('  · ' + m) }
const sleep = ms => new Promise(r => setTimeout(r, ms))

function collectCycle() {
  const t = [...document.querySelectorAll('table.cross-tbl')].find(tb => tb.getAttribute('role') === 'grid')
  if (!t) return {}
  const out = {}
  t.querySelectorAll('tbody tr').forEach(tr => {
    const td = tr.querySelector('td.fc-cycle')
    if (!td) return
    const pid = td.getAttribute('data-pid')
    if (!pid) return
    const nameCell = tr.querySelector('td.fc-name')
    out[pid] = {
      cycle: td.textContent.trim(),
      offTag: !!(nameCell && nameCell.querySelector('.off-tag')),
      impTag: !!(nameCell && nameCell.querySelector('.imp-tag')),
      hasInput: !!td.querySelector('input'),
      frozen: getComputedStyle(td).position,
      left: td.style.left || '',
      name: nameCell ? nameCell.textContent.trim().slice(0, 24) : '',
    }
  })
  return out
}
function curScrollTop() {
  const t = [...document.querySelectorAll('table.cross-tbl')].find(tb => tb.getAttribute('role') === 'grid')
  let el = t && t.parentElement
  while (el && el !== document.body) {
    if (el.scrollHeight > el.clientHeight) return el.scrollTop
    el = el.parentElement
  }
  return 0
}
function scrollTo(x, y) {
  const t = [...document.querySelectorAll('table.cross-tbl')].find(tb => tb.getAttribute('role') === 'grid')
  let el = t && t.parentElement
  while (el && el !== document.body) {
    if (el.scrollHeight > el.clientHeight) { if (y == null) el.scrollTop = x; else el.scrollTop = y; return { st: el.scrollTop } }
    el = el.parentElement
  }
  return null
}
async function apiGet(page, url) {
  return await page.evaluate(async (u) => {
    const tk = localStorage.getItem('hergent_v2_token')
    const ten = localStorage.getItem('hergent_v2_tenant')
    const r = await fetch(u, { headers: { Authorization: 'Bearer ' + tk, 'X-Tenant-Id': String(ten) } })
    return await r.json()
  }, url)
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
  await page.goto(BASE + '/?cb=' + Date.now() + '#/forecast', { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(5000)
  ok(!/#\/login/.test(page.url()), '登录态注入成功')
  if (/#\/login/.test(page.url())) { await browser.close(); process.exit(1) }

  console.log('\n=== 0. 给指定的 off-archive 行播一个非零值（沙箱内写，仅为造出「带值」fixture）===')
  for (const pid of SEED) {
    const r = await page.evaluate(async (p, d) => {
      const tk = localStorage.getItem('hergent_v2_token')
      const ten = localStorage.getItem('hergent_v2_tenant')
      const res = await fetch('/api/products/' + p, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tk, 'X-Tenant-Id': String(ten) },
        body: JSON.stringify({ arrival_lead_days: d }),
      })
      return { status: res.status, text: (await res.text()).slice(0, 120) }
    }, pid, SEED_DAYS)
    info(`PUT pid=${pid} → ${JSON.stringify(r)}`)
  }

  console.log('\n=== 1. 期望值：从接口现取（含停用）===')
  const all = await apiGet(page, '/api/products?include_inactive=1&limit=5000')
  const items = Array.isArray(all.items) ? all.items : []
  const want = {}
  for (const p of items) want[String(p.id)] = { d: Number(p.arrival_lead_days) || 0, active: p.is_active !== 0, name: p.name }
  const withVal = Object.values(want).filter(x => x.d > 0).length
  info(`接口返回 ${items.length} 个商品，其中有值的 ${withVal} 个`)

  console.log('\n=== 2. 虚拟滚动遍历主表全部行 ===')
  await page.reload({ waitUntil: 'networkidle2' })
  await sleep(5000)
  await page.evaluate(scrollTo, 0, null)
  await sleep(400)
  const acc = {}
  let guard = 0, top = 0
  while (guard++ < 80) {
    Object.assign(acc, await page.evaluate(collectCycle))
    const ct = await page.evaluate(curScrollTop)
    if (ct === top && guard > 2) break
    top = ct
    const r = await page.evaluate(scrollTo, null, ct + 420)
    await sleep(240)
    if (!r || r.st === ct) break
  }
  await page.evaluate(scrollTo, null, 0)
  await sleep(300)
  const n = Object.keys(acc).length
  info('遍历到行数 = ' + n)
  const dist = {}
  Object.values(acc).forEach(v => { dist[v.cycle] = (dist[v.cycle] || 0) + 1 })
  info('文案分布: ' + JSON.stringify(dist))
  ok(n > 0, '主表渲染出了行', 'n=' + n)

  console.log('\n=== 3. 逐行双向核对：页面文案 == 接口值 ===')
  const bad = []
  for (const [pid, got] of Object.entries(acc)) {
    const w = want[pid]
    if (!w) { bad.push({ pid, got: got.cycle, why: '接口里没有这个 id（可能是已删除商品）' }); continue }
    const exp = w.d > 0 ? '+' + w.d + '天' : '—'
    if (got.cycle !== exp) bad.push({ pid, name: got.name, got: got.cycle, exp, d: w.d, off: got.offTag })
  }
  ok(bad.length === 0, '全部 ' + n + ' 行：页面显示 == 接口值（含 off-archive 行）',
    bad.length ? JSON.stringify(bad.slice(0, 5)) : '')
  ok(n === Object.keys(acc).length, '（对照）行数非 0 ⇒ 上面的「全绿」不是空断言')

  console.log('\n=== 4. off-archive 行覆盖证明 ===')
  const seeded = SEED.filter(p => acc[p])
  ok(seeded.length > 0, '播过种的 off-archive 行确实出现在本期行底（否则本节无覆盖）',
    'seed=' + JSON.stringify(SEED) + ' 命中=' + JSON.stringify(seeded))
  for (const p of seeded) {
    const g = acc[p]
    ok(g.cycle === '+' + SEED_DAYS + '天', `pid=${p}（已停用、被本期引用）显示「+${SEED_DAYS}天」而不是「—」`,
      JSON.stringify(g))
    ok(g.offTag === true, `pid=${p} 确实带「已停用」角标（证明它走的是 off-archive 那条路）`)
    ok(g.hasInput === false, `pid=${p} 该格只读（无 input）`)
  }
  // 对照：至少还有别的行是「—」，说明本列不是「全都有值」的假象
  const dash = Object.values(acc).filter(v => v.cycle === '—').length
  ok(dash > 0, '（对照）仍存在显示「—」的行 ⇒ 上面的 +N天 不是整列统一渲染的结果', '— 的行数=' + dash)

  console.log('\n=== 汇总 ===')
  const failed = results.filter(r => !r.pass)
  console.log(`  ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) { console.log('  失败项:'); failed.forEach(f => console.log('    - ' + f.label)) }
  console.log(errs.length ? '  控制台错误: ' + JSON.stringify(errs.slice(0, 4)) : '  控制台无错误 ✓')
  await browser.close()
  process.exit(failed.length ? 1 : 0)
})().catch(e => { console.error('探针异常:', e); process.exit(2) })
