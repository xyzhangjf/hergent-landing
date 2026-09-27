/**
 * 侦察脚本（只读）：员工档案页在**生产 + sales 账号**下到底长什么样。
 * 目的：为 v300-role-dropdown-e2e.mjs 找对「路由 / 行操作按钮 / 角色下拉」三处选择器。
 * 零写入：只 GET。
 */
import { chromium } from '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/node_modules/playwright/index.mjs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const USER = process.env.HG_USER || 'mptest'
// 🔴 凭据不入库（同 v300-role-dropdown-e2e.mjs）：密码必须由 HG_PASS 提供，不设默认值。
const PASS = process.env.HG_PASS
if (!PASS) {
  console.error('[中止] 缺少 HG_PASS（提审测试账号密码；见 .workbuddy/memory/ 当日日志）')
  process.exit(1)
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--no-sandbox', '--disable-gpu'],
})
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()

const api = []
page.on('response', (res) => {
  const u = res.url()
  if (u.indexOf('/api/') !== -1) api.push(res.status() + ' ' + res.request().method() + ' ' + u.replace(BASE, ''))
})
const errs = []
page.on('pageerror', e => errs.push(e.message))

await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' })
const l = await page.evaluate(async ([u, p]) => {
  const r = await fetch('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u, password: p }),
  })
  const d = await r.json()
  if (!d.token) return 'NO:' + JSON.stringify(d).slice(0, 200)
  localStorage.setItem('hergent_v2_token', d.token)
  if (d.csrf_token) localStorage.setItem('hergent_v2_csrf', d.csrf_token)
  if (d.user) localStorage.setItem('hergent_v2_user', JSON.stringify(d.user))
  if (d.tenant_id) localStorage.setItem('hergent_v2_tenant', String(d.tenant_id))
  return 'OK:' + JSON.stringify(d.user) + ' tid=' + d.tenant_id
}, [USER, PASS])
console.log('登录 →', l)

for (const route of ['/archive', '/employee-archive', '/employees', '/staff']) {
  console.log('')
  console.log('══ 路由 ' + route + ' ══')
  try {
    await page.goto(BASE + route, { waitUntil: 'networkidle', timeout: 30000 })
  } catch (e) { console.log('  goto 失败: ' + e.message) }
  await sleep(1200)
  const info = await page.evaluate(() => {
    const txt = (document.body.innerText || '')
    const classes = new Set()
    document.querySelectorAll('[class]').forEach(el => {
      String(el.className).split(/\s+/).forEach(c => { if (c) classes.add(c) })
    })
    const btns = Array.from(document.querySelectorAll('button')).map(b => (b.textContent || '').trim()).filter(Boolean)
    const selects = Array.from(document.querySelectorAll('select')).map(s => ({
      cls: s.className, name: s.name || '', n: s.options.length,
    }))
    const tables = Array.from(document.querySelectorAll('table')).length
    return {
      url: location.href,
      bodyStart: txt.slice(0, 320),
      bodyLen: txt.length,
      tables,
      btns: btns.slice(0, 40),
      selects,
      dfClasses: Array.from(classes).filter(c => /^df-/.test(c)).sort().slice(0, 60),
      accClasses: Array.from(classes).filter(c => /acc-/.test(c)).sort().slice(0, 60),
    }
  })
  console.log('  location:', info.url)
  console.log('  table 数:', info.tables, '| body 字符数:', info.bodyLen)
  console.log('  body 前 320 字:', JSON.stringify(info.bodyStart))
  console.log('  buttons:', JSON.stringify(info.btns))
  console.log('  df-* 类:', JSON.stringify(info.dfClasses))
  console.log('  acc-* 类:', JSON.stringify(info.accClasses))
  console.log('  select:', JSON.stringify(info.selects))
}

console.log('')
console.log('══ /api 调用流水（末 40 条）══')
api.slice(-40).forEach(x => console.log('  ' + x))
console.log('')
console.log('pageerror:', errs.length ? errs.join(' | ') : '无')

await browser.close()
