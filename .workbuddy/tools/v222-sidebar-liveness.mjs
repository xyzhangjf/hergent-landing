/**
 * v222-sidebar-liveness.mjs —— 决定性实验：**点侧栏**进预报页会不会卡住主线程？
 *
 * 背景：`hergent-forecast-smoke.mjs`（点了侧栏）在 v222 部署后出现
 *   `CDP 超时：Runtime.evaluate`（45s 无响应）；而直接敲 `#/forecast` 的探针一切正常。
 * 两者唯一差别 = **入口方式**。侧栏是真实用户的入口 ⇒ 必须判定这是
 *   ① v222 引入的挂起（严重）／② 侧栏路径本身的历史问题／③ 脚本时序巧合。
 *
 * 做法：走到「点完侧栏」为止，然后**每 2s 探一次平凡表达式**，最多 60s。
 *   主线程长时间无响应 = 真挂起；随即输出 console/page 错误 + 截图。
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const USER = process.env.HG_USER || 'mptestsp'
const PASS = process.env.HG_PASS || 'Mpsup@1'
const SHOT = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/客户列删除被恢复排查-2026-09-19/v222-侧栏挂起诊断.png'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const log = (s) => console.log(s)

const JS_LOGIN = (u, p) => 'fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},'
  + 'body:JSON.stringify({username:' + JSON.stringify(u) + ',password:' + JSON.stringify(p) + '})})'
  + '.then(r=>r.json().then(d=>({s:r.status,d:d})))'
  + '.then(r=>{var d=r.d;if(!d.token)return JSON.stringify({ok:false,status:r.s});'
  + 'localStorage.setItem("hergent_v2_token",d.token);'
  + 'if(d.csrf_token)localStorage.setItem("hergent_v2_csrf",d.csrf_token);'
  + 'if(d.user)localStorage.setItem("hergent_v2_user",JSON.stringify(d.user));'
  + 'if(d.tenant_id)localStorage.setItem("hergent_v2_tenant",String(d.tenant_id));'
  + 'return JSON.stringify({ok:true})})'

const JS_CLICK_SIDEBAR = '(()=>{var all=Array.from(document.querySelectorAll("a,div,span,li,button"));'
  + 'var hit=all.find(x=>/预报订[单货]管理/.test((x.innerText||"").trim())&&(x.innerText||"").trim().length<20);'
  + 'if(hit){hit.click();return (hit.innerText||"").trim()}return ""})()'

let browser
let failed = false
try {
  browser = await launch()
  const page = await browser.newPage()
  await page.enable()

  await page.goto(BASE, 3500)
  log('登录：' + await page.eval(JS_LOGIN(USER, PASS)))
  await page.goto(BASE + '/#/', 4000)

  log('点前 URL = ' + await page.eval('location.href'))
  const t0 = Date.now()
  log('点击侧栏：' + await page.eval(JS_CLICK_SIDEBAR))

  /* 每 2s 探活，最多 60s；用短自旋避免单次 45s 超时把时间浪费掉 */
  let alive = false
  let aliveAt = null
  for (let i = 0; i < 30; i++) {
    await sleep(2000)
    try {
      const v = await page.eval('1+1')
      if (v === 2) { alive = true; aliveAt = Date.now() - t0; break }
    } catch (e) { /* 单次探测超时/异常 → 继续等 */ }
    if (i % 3 === 2) log('   …已等 ' + (Date.now() - t0) + 'ms，主线程仍无响应')
  }

  if (alive) {
    log('✅ 主线程在 ' + aliveAt + 'ms 后响应 → **侧栏路径不挂**（烟测那次是时序/环境巧合）')
    const url = await page.eval('location.href')
    const body = await page.eval('document.body?document.body.innerText:""')
    log('URL = ' + url)
    log('正文长度 = ' + body.length + '｜兜底页 = ' + /页面出错了/.test(body))
    const hit = ['客户', '商品', '填报', '汇总', '预报', '期次', '数量'].filter(k => body.includes(k))
    log('业务词命中 = ' + hit.join('/'))
  } else {
    log('🔴 主线程 60s 内始终无响应 —— **侧栏路径确实挂起**')
    failed = true
  }

  const errs = page.errors.slice()
  log('console/page 错误 ' + errs.length + ' 条：')
  errs.slice(0, 15).forEach(e => log('   ' + e.slice(0, 220)))
  try { await page.screenshot(SHOT); log('截图：' + SHOT) } catch { }
} catch (e) {
  log('脚本异常：' + (e && e.message)); failed = true
} finally {
  if (browser) { try { await browser.close() } catch { } }
  process.exit(failed ? 1 : 0)
}
