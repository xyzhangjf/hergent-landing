/**
 * v387-jump-diag.mjs —— 定向诊断：Rebate 页内 `.cf-jump` 跳转后主内容为何不切
 * 只读、临时实验，出结论后可删。
 */
import { launch } from '../../../.workbuddy/tools/lib/cdp-lite.mjs'

const BASE = process.env.PROBE_BASE || 'http://127.0.0.1:8791'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const nz = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim()

async function call(method, path, token, body) {
  const h = { 'Content-Type': 'application/json', 'X-Client': 'web' }
  if (token) h.Authorization = 'Bearer ' + token
  const res = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) })
  const txt = await res.text()
  let j = {}; try { j = JSON.parse(txt) } catch { /* ignore */ }
  return { status: res.status, json: j, text: txt }
}
function seedJs(token, user, tenant, csrf) {
  return `
try {
  localStorage.setItem('hergent_v2_token', ${JSON.stringify(token)});
  localStorage.setItem('hergent_v2_user', ${JSON.stringify(JSON.stringify(user || {}))});
  ${tenant ? "localStorage.setItem('hergent_v2_tenant', " + JSON.stringify(String(tenant)) + ');' : ''}
  ${csrf ? "localStorage.setItem('hergent_v2_csrf', " + JSON.stringify(String(csrf)) + ');' : ''}
} catch (e) {}
window.__nav = [];
window.addEventListener('hashchange', function () { window.__nav.push('hashchange:' + location.hash) });
window.addEventListener('popstate', function () { window.__nav.push('popstate:' + location.hash) });
`
}
const SNAP = function () {
  const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
  return {
    hash: location.hash,
    h2: norm((document.querySelector('.page-hd h2') || {}).textContent || ''),
    moduleTabs: document.querySelectorAll('.module-tabs button').length,
    moduleTabOn: norm((document.querySelector('.module-tabs button.on') || {}).textContent || ''),
    mainTabs: document.querySelectorAll('.main-tabs button.main-tab').length,
    mainTabOn: norm((document.querySelector('.main-tabs button.main-tab.on') || {}).textContent || ''),
    cfJump: document.querySelectorAll('.cf-jump').length,
    modalCard: !!document.querySelector('.modal-card'),
    bodyLen: norm(document.body.textContent).length,
    nav: (window.__nav || []).slice(-6),
  }
}
const CLICK_MAIN_TAB = function (label) {
  const bs = [...document.querySelectorAll('.main-tabs button.main-tab')]
  const b = bs.find((x) => (x.textContent || '').trim() === label)
  if (!b) return { clicked: false }
  b.click(); return { clicked: true }
}
const CLICK_CONTRACT = function () {
  const b = [...document.querySelectorAll('button')].find((x) => /录入年度合同/.test(x.textContent || ''))
  if (!b) return { clicked: false }
  b.click(); return { clicked: true }
}
const CLICK_JUMP = function (i) {
  const js = [...document.querySelectorAll('.cf-jump')]
  if (!js[i]) return { clicked: false, n: js.length }
  const t = String(js[i].textContent || '').trim()
  js[i].click()
  return { clicked: true, text: t }
}

async function waitFor(page, expr, ms = 12000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    let v = false; try { v = await page.eval(expr) } catch { /* ignore */ }
    if (v) return Date.now() - t0
    await sleep(300)
  }
  return -1
}

const demo = await call('POST', '/api/auth/demo-login', null, {})
const token = demo.json.token || demo.json.access_token
const user = demo.json.user || {}
const browser = await launch({ headless: true })
const page = await browser.newPage()
await page.enable()
const sid = await page.addInitScript(seedJs(token, user, demo.json.tenant_id, demo.json.csrf_token))

await page.goto(BASE + '/?__r=' + Date.now() + '#/rebate', 1800)
await sleep(7000)
console.log('--- 1) 初始 #/rebate ---')
console.log(JSON.stringify(await page.eval('(' + SNAP.toString() + ')()'), null, 1))

await page.eval('(' + CLICK_MAIN_TAB.toString() + ')("返利结算")')
await sleep(2500)
const c = await page.eval('(' + CLICK_CONTRACT.toString() + ')()')
await sleep(1200)
console.log('--- 2) 打开合同弹窗 ---', JSON.stringify(c))
console.log(JSON.stringify(await page.eval('(' + SNAP.toString() + ')()'), null, 1))

/* 实验 A：真实点击 .cf-jump */
const j = await page.eval('(' + CLICK_JUMP.toString() + ')(0)')
const wA = await waitFor(page, "!!document.querySelector('.module-tabs button.on')")
console.log('--- 实验A 点击 .cf-jump ---', JSON.stringify(j), 'wait=' + wA)
console.log(JSON.stringify(await page.eval('(' + SNAP.toString() + ')()'), null, 1))

/* 实验 B：直接改 hash（绕开 router.push） */
await page.eval("(function(){window.__nav=[];location.hash='#/rebate';return 1})()")
await sleep(1500)
const wB = await waitFor(page, "!!document.querySelector('.main-tabs button.main-tab.on')")
console.log('--- 实验B 回 #/rebate ---', 'wait=' + wB)
await page.eval("(function(){window.__nav=[];location.hash='#/archive/brands';return 1})()")
const wB2 = await waitFor(page, "!!document.querySelector('.module-tabs button.on')")
console.log('--- 实验B 改 hash 到 #/archive/brands ---', 'wait=' + wB2)
console.log(JSON.stringify(await page.eval('(' + SNAP.toString() + ')()'), null, 1))

/* 实验 C：hash 直改到 suppliers（对照） */
await page.eval("(function(){location.hash='#/archive/suppliers';return 1})()")
const wC = await waitFor(page, "/供应商档案/.test((document.querySelector('.page-hd h2')||{}).textContent||'')")
console.log('--- 实验C 改 hash 到 #/archive/suppliers ---', 'wait=' + wC)
console.log(JSON.stringify(await page.eval('(' + SNAP.toString() + ')()'), null, 1))

console.log('--- page.errors ---')
console.log(JSON.stringify(page.errors, null, 1))

await page.removeInitScript(sid)
await browser.close()
