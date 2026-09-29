/**
 * v332 真机验收探针（只读）：主管视角的侧栏与档案页签是否与真实权限一致。
 *
 * 断言的业务事实（全部来自老板 2026-09-29 报障）：
 *   ① 主管**看不到**「货损核算」（他没有 stock 模块）—— 原来是「看得见、点进去 403」
 *   ② 主管**看得到**「预报订货管理」，且页内**不再**出现「你的角色不能查看报单汇总」
 *      （后端迁库补了 data + 前端补了 module: 'data'）
 *   ③ 档案管理页签只显示他有权限的那几个（品牌/商品 = data），
 *      员工(hr)/客户(crm)/仓库(stock) 三个页签不再显示
 *   ④ 全程零 console.error / 零页面异常
 *
 * 🔴 只读：不点任何写操作、不提交任何表单。
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'

const TOKEN = process.env.HG_TOKEN
const TENANT = process.env.HG_TENANT || '1'
const BASE = 'https://hergent.cn'
const R = []
const ok = (name, cond, detail = '') => R.push({ name, pass: !!cond, detail: String(detail) })

const browser = await launch({})
let page = null
try {
  page = await browser.newPage()
  await page.enable()
  await page.addInitScript(`
    localStorage.setItem('hergent_v2_token', ${JSON.stringify(TOKEN)});
    localStorage.setItem('hergent_v2_tenant', ${JSON.stringify(TENANT)});
  `)

  // ---------- 相位 1：侧栏 ----------
  await page.goto(BASE + '/?cb=' + Date.now() + '#/workbench', 7000)
  const url1 = await page.eval('location.href')
  ok('P1 已登录（未被踢回 #/login）', !/#\/login/.test(url1), url1)

  const navInfo = await page.eval(`(() => {
    const cands = ['.sb', 'aside', 'nav', '.sidebar', '.sb-nav', '[class*=sb-]', '[class*=side]']
    let best = null
    for (const c of cands) {
      const els = [...document.querySelectorAll(c)]
      for (const e of els) {
        const t = (e.innerText || '').trim()
        if (t.length > 20 && (!best || t.length > best.t.length)) best = { sel: c, t, cls: e.className }
      }
    }
    return JSON.stringify(best || { sel: 'none', t: (document.body.innerText || '').slice(0, 400), cls: '' })
  })()`)
  const nav = JSON.parse(navInfo || '{}')
  const navText = String(nav.t || '')
  console.log('侧栏命中：选择器=' + nav.sel + ' 长度=' + navText.length)
  console.log('侧栏文本：' + navText.replace(/\n+/g, ' | ').slice(0, 600))

  ok('P2 侧栏**不含**「货损核算」（主管无 stock ⇒ 不该有入口）', !navText.includes('货损核算'))
  ok('P3 侧栏含「预报订货管理」', navText.includes('预报订货管理'))
  ok('P4 侧栏含「档案管理」', navText.includes('档案管理'))
  ok('P5 侧栏含「目标与返利」（主管有 sales）', navText.includes('目标与返利'))

  // ---------- 相位 2：预报订货管理（页内可读） ----------
  await page.goto(BASE + '/?cb=' + Date.now() + '#/forecast', 8000)
  const fc = await page.eval(`(() => {
    const t = document.body.innerText || ''
    return JSON.stringify({
      url: location.href,
      denied: t.includes('你的角色不能查看报单汇总'),
      hasGrid: !!document.querySelector('.cross-tbl, .grid-area, .cross-viewport, table'),
      textLen: t.length,
    })
  })()`)
  const f = JSON.parse(fc || '{}')
  ok('P6 预报页**不再**出现「你的角色不能查看报单汇总」', !f.denied, JSON.stringify(f))
  ok('P7 预报页表格区已渲染', f.hasGrid, 'hasGrid=' + f.hasGrid + ' textLen=' + f.textLen)

  // ---------- 相位 3：档案管理页签 ----------
  await page.goto(BASE + '/?cb=' + Date.now() + '#/archive', 7000)
  const ar = await page.eval(`(() => {
    const tabs = [...document.querySelectorAll('.module-tabs button')].map(b => b.textContent.trim())
    return JSON.stringify({ url: location.href, tabs })
  })()`)
  const a = JSON.parse(ar || '{}')
  const tabs = a.tabs || []
  console.log('档案页签：' + JSON.stringify(tabs))
  ok('P8 档案管理页签**不含**「员工档案」（主管无 hr）', !tabs.includes('员工档案'), JSON.stringify(tabs))
  ok('P9 档案管理页签**不含**「客户档案」（主管无 crm）', !tabs.includes('客户档案'))
  ok('P10 档案管理页签**不含**「仓库档案」（主管无 stock）', !tabs.includes('仓库档案'))
  ok('P11 档案页签**含**「品牌档案」或「商品档案」（主管有 data）',
     tabs.includes('品牌档案') || tabs.includes('商品档案'), JSON.stringify(tabs))
  ok('P12 落在**可见**页签上（未被 redirect 到不可见页签而空白）', tabs.length > 0 && /archive\/(brands|products)/.test(a.url || ''), a.url)

  // ---------- 相位 4：控制台干净 ----------
  const errs = (page.errors || []).filter(e => !/403/.test(e))
  ok('P13 全程零 console.error / 零页面异常（403 除外）', errs.length === 0, JSON.stringify(errs).slice(0, 300))
} catch (e) {
  ok('探针执行未抛异常', false, e.message)
} finally {
  console.log('\n===== 结果 =====')
  let n = 0
  for (const r of R) {
    console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + (r.pass ? '' : '   ← ' + r.detail))
    n += r.pass ? 1 : 0
  }
  console.log('---- ' + n + '/' + R.length + ' 通过 ----')
  if (browser) await browser.close()
}
