'use strict'
/* v184c 补验：后端 API 层（绕过前端，直接打接口）
 *
 * 为什么必须单独验：
 *   · `name` 非空闸门是本轮**唯一**的后端改动，而 UI 探针里「名称为空」是被**前端**拦下的
 *     （零写请求）⇒ 后端那道闸**一次都没被触发过**。没被触发的代码 = 不知道有没有用。
 *   · 「停用/启用」在 UI 探针里只验了二次确认的出现与取消，真正的落库没验。
 *
 * 全部动作结束时把数据还原（name 写回原名、is_active 写回 1），不留脏数据。
 *
 * 跑法：NODE_PATH=... HG_TOKEN=xxx HG_TENANT=9997 node .workbuddy/tools/v184c-api-guard.js
 */
const puppeteer = require('puppeteer-core')

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const TOKEN = process.env.HG_TOKEN
const TENANT = process.env.HG_TENANT
const CHROME = process.env.HG_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

let pass = 0, fail = 0
const out = []
function ok(cond, name, extra) {
  if (cond) { pass++; out.push('  PASS  ' + name) }
  else { fail++; out.push('  FAIL  ' + name + (extra === undefined ? '' : '   << ' + String(extra).slice(0, 260))) }
}
function info(m) { out.push('  info  ' + m) }

async function main() {
  if (!TOKEN || !TENANT) { console.error('缺 HG_TOKEN / HG_TENANT'); process.exit(2) }
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    defaultViewport: { width: 1280, height: 900 },
  })
  const page = await browser.newPage()
  /* ⚠️ 必须在 goto **之前**注册才生效（放后面就只是个不执行的占位）。
     本脚本的 fetch 自带 Authorization 头，所以不依赖它；注入只为让页面以真实身份渲染，
     免得 SPA 因未登录跳登录页、把同源 fetch 的上下文搅乱。 */
  await page.evaluateOnNewDocument((t, tn) => {
    localStorage.setItem('hergent_v2_token', t)
    localStorage.setItem('hergent_v2_tenant', String(tn))
  }, TOKEN, String(TENANT))
  await page.goto(BASE + '/#/archive/products', { waitUntil: 'domcontentloaded', timeout: 45000 })

  out.push('### v184c 后端 API 层补验（绕过前端直打接口）')
  out.push('环境: ' + BASE + '  租户: ' + TENANT)

  const pid = await page.evaluate(async (token, tenant) => {
    const h = { 'Authorization': 'Bearer ' + token, 'X-Tenant-Id': String(tenant) }
    const r = await fetch('/api/products?limit=1&include_inactive=1', { headers: h })
    const j = await r.json()
    const it = (j.items || [])[0]
    return it ? { id: it.id, name: it.name, active: it.is_active } : null
  }, TOKEN, String(TENANT))
  ok(pid && pid.id, '取到一个商品做靶子', JSON.stringify(pid))
  if (!pid || !pid.id) { return finish(browser) }
  info('靶子商品: id=' + pid.id + '  name=' + JSON.stringify(pid.name) + '  is_active=' + pid.active)

  const call = (bodyArr) => page.evaluate(async (token, tenant, id, arr) => {
    const h = {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token,
      'X-Tenant-Id': String(tenant),
    }
    const res = []
    for (const b of arr) {
      const r = await fetch('/api/products/' + id, { method: 'PUT', headers: h, body: JSON.stringify(b) })
      let t = ''
      try { t = await r.text() } catch (e) { /* ignore */ }
      res.push({ body: b, status: r.status, text: t.slice(0, 160) })
    }
    return res
  }, TOKEN, String(TENANT), pid.id, bodyArr)

  /* ---- 后端 name 闸门 ---- */
  const r = await call([{ name: '' }, { name: '   ' }])
  ok(r[0] && r[0].status === 400, '后端起效：name 空串 → 400（前端拦不住的直连请求也被拒）',
    JSON.stringify(r[0]))
  ok(r[0] && /名称不能为空/.test(r[0].text || ''), '空串的 400 带明确原因', r[0] && r[0].text)
  ok(r[1] && r[1].status === 400, '后端起效：name 全空格 → 400（不只是空串）', JSON.stringify(r[1]))

  /* ---- 不能误伤：合法改名仍应通过 ---- */
  if (pid.name && pid.name.trim()) {
    const r2 = await call([{ name: pid.name }])
    ok(r2[0] && r2[0].status === 200, '未误伤：原名原值写回 → 200', JSON.stringify(r2[0]))
  } else {
    info('靶子商品原名为空（历史数据），跳过「写回原名」这一条')
  }

  /* ---- 其它非法值仍被后端挡住（与前端闸门对齐）---- */
  const r3 = await call([{ arrival_lead_days: 999 }, { arrival_lead_days: 3.5 }])
  ok(r3[0] && r3[0].status === 400, '到货周期 999 → 后端 400', JSON.stringify(r3[0]))
  ok(r3[1] && r3[1].status === 400, '到货周期 3.5 → 后端 400', JSON.stringify(r3[1]))

  /* ---- 停用 / 启用真实落库 ---- */
  const beforeActive = await page.evaluate(async (token, tenant, id) => {
    const h = { 'Authorization': 'Bearer ' + token, 'X-Tenant-Id': String(tenant) }
    const r = await fetch('/api/products?limit=1&include_inactive=1', { headers: h })
    const j = await r.json()
    const it = (j.items || []).find(x => x.id === id)
    return it ? it.is_active : null
  }, TOKEN, String(TENANT), pid.id)

  const rOff = await call([{ is_active: 0 }])
  ok(rOff[0] && rOff[0].status === 200, '停用请求 → 200', JSON.stringify(rOff[0]))
  const afterOff = await page.evaluate(async (token, tenant, id) => {
    const h = { 'Authorization': 'Bearer ' + token, 'X-Tenant-Id': String(tenant) }
    const r = await fetch('/api/products?limit=5000&include_inactive=1', { headers: h })
    const j = await r.json()
    const it = (j.items || []).find(x => x.id === id)
    return it ? it.is_active : null
  }, TOKEN, String(TENANT), pid.id)
  ok(afterOff === 0, '停用**真的落库**了（回读 is_active=0）', 'before=' + beforeActive + ' after=' + afterOff)

  /* 停用后：默认列表（不含停用）里应当查不到它 —— 这才是「停用」对用户的实际含义 */
  const inDefault = await page.evaluate(async (token, tenant, id) => {
    const h = { 'Authorization': 'Bearer ' + token, 'X-Tenant-Id': String(tenant) }
    const r = await fetch('/api/products?limit=5000', { headers: h })
    const j = await r.json()
    return (j.items || []).some(x => x.id === id)
  }, TOKEN, String(TENANT), pid.id)
  ok(inDefault === false, '停用后不再出现在默认（在售）列表里 —— 即报单/小程序可选列表', 'inDefault=' + inDefault)

  /* 还原 */
  const rOn = await call([{ is_active: beforeActive == null ? 1 : beforeActive }])
  ok(rOn[0] && rOn[0].status === 200, '已还原启用状态 → 200', JSON.stringify(rOn[0]))
  const afterOn = await page.evaluate(async (token, tenant, id) => {
    const h = { 'Authorization': 'Bearer ' + token, 'X-Tenant-Id': String(tenant) }
    const r = await fetch('/api/products?limit=5000&include_inactive=1', { headers: h })
    const j = await r.json()
    const it = (j.items || []).find(x => x.id === id)
    return it ? it.is_active : null
  }, TOKEN, String(TENANT), pid.id)
  ok(afterOn === (beforeActive == null ? 1 : beforeActive), '还原后与初始状态一致', 'now=' + afterOn)

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
