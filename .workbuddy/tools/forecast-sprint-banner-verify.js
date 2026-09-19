// 验收「返利冲刺看板 → 决策横幅（A2）」：折叠 71px / 展开 360px / 改单+保存距离 / 编辑态自动折叠
//
// 用法：
//   HG_TOKEN=<沙箱令牌> HG_TENANT=<沙箱租户> HG_BASE=http://127.0.0.1:5173 VW=1440 \
//   NODE_PATH=/Users/zhangjunfeng/.workbuddy/binaries/node/workspace/node_modules \
//   node forecast-sprint-banner-verify.js
//
// 前置：vite dev 已起（/api 代理到 erp.hergent.cn）+ 隔离沙箱租户（9997+）已 up。
// 注意：沙箱会把 order_date 改写成今天 —— 本脚本只验「布局与渲染」，不验任何依赖日期的口径。

const puppeteer = require('puppeteer-core')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.HG_BASE || 'http://127.0.0.1:5173'
const TOKEN = process.env.HG_TOKEN
const TENANT = process.env.HG_TENANT || '9997'
const VW = parseInt(process.env.VW || '1440', 10)
const VH = parseInt(process.env.VH || '900', 10)
const TAG = process.env.TAG || `v${VW}`
const sleep = ms => new Promise(r => setTimeout(r, ms))

let pass = 0, fail = 0
const ok = (c, msg) => { if (c) { pass++; console.log('   PASS  ' + msg) } else { fail++; console.log('   FAIL  ' + msg) } }

// page.evaluate 只序列化函数源码 ⇒ 一律「普通函数 + 显式参数」
const probe = () => {
  const box = el => { if (!el) return null; const r = el.getBoundingClientRect()
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), h: Math.round(r.height) } }
  const q = s => document.querySelector(s)
  const btns = () => [...document.querySelectorAll('.card.toolbar button')]
  const card = q('.card.sprint-card')
  const banner = q('.sprint-banner')
  const body = q('.card.sprint-card .panel-body')
  const gridCtl = q('.grid-ctl-row')
  const editBtn = btns().find(x => /^改单$/.test((x.textContent || '').trim()))
  const saveBtn = btns().find(x => /^(保存|保存中…|重试保存)$/.test((x.textContent || '').trim()))
  const tbl = [...document.querySelectorAll('table')].find(t =>
    [...t.querySelectorAll('thead th, thead td')].some(x => (x.textContent || '').trim() === '最终下单'))
  // 只读态行带 .data-row；编辑态没有该 class → 退回「含数量输入框的那一行」
  const qtyCell = document.querySelector('.qty-input')
  const firstRow = (tbl && tbl.querySelector('tbody tr.data-row')) || (qtyCell ? qtyCell.closest('tr') : null)
  const bcs = body ? getComputedStyle(body) : null
  const bnr = banner ? banner.getBoundingClientRect() : null
  const hd = q('.card.sprint-card .panel-hd')
  const hdM = (() => {                       // 标题条横向余量：决定决策行能否并进标题条（71px 方案）
    if (!hd) return null
    const cs = getComputedStyle(hd)
    const kids = [...hd.children].filter(c => getComputedStyle(c).display !== 'none')
    const used = kids.reduce((s, c) => s + c.getBoundingClientRect().width, 0) + (kids.length - 1) * (parseFloat(cs.gap) || 0)
    const avail = hd.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
    return { avail: Math.round(avail), used: Math.round(used), free: Math.round(avail - used), gap: cs.gap }
  })()
  return {
    vh: window.innerHeight,
    card: box(card),
    banner: bnr ? { h: Math.round(bnr.height), text: (banner.textContent || '').replace(/\s+/g, ' ').trim(), els: banner.children.length } : null,
    bodyDisplay: bcs ? bcs.display : null,
    bodyBorderTop: bcs ? (bcs.borderTopWidth + ' ' + bcs.borderTopStyle + ' ' + bcs.borderTopColor) : null,
    panelHd: hdM,
    gridCtl: box(gridCtl),
    editBtn: box(editBtn),
    saveBtn: box(saveBtn),
    firstRow: box(firstRow),
    thead: box(tbl ? tbl.querySelector('thead') : null),
    pageH: document.documentElement.scrollHeight,
  }
}

;(async () => {
  const b = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--force-device-scale-factor=1'],
    protocolTimeout: 180000,
  })
  const p = await b.newPage()
  const errs = []
  p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message))
  p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text().slice(0, 160)) })
  await p.evaluateOnNewDocument((t, ten) => {
    localStorage.setItem('hergent_v2_token', t)
    localStorage.setItem('hergent_v2_tenant', String(ten))
    localStorage.setItem('hergent_v2_user', JSON.stringify({ role: 'boss', username: 'sbx_banner', display_name: '横幅验收' }))
  }, TOKEN, TENANT)
  await p.setViewport({ width: VW, height: VH, deviceScaleFactor: 1 })
  await p.goto(`${BASE}/?cb=${Date.now()}#/forecast`, { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(6000)

  const picked = await p.evaluate(() => {
    const s = [...document.querySelectorAll('select')].find(x => [...x.options].some(o => (o.text || '').includes('选择期次')))
    if (!s) return 'no-select'
    const t = [...s.options].find(o => (o.text || '').includes('提审期')) || [...s.options].find(o => o.value && o.value !== '0')
    if (!t) return 'no-option'
    s.value = t.value; s.dispatchEvent(new Event('change', { bubbles: true }))
    return t.value + ':' + t.text
  })
  console.log(`\n#### ${TAG}  ${VW}x${VH}  期次=${picked}`)
  await sleep(6000)

  // ---------- A. 默认折叠态 ----------
  const a = await p.evaluate(probe)
  console.log('\n-- A. 默认折叠态 --')
  console.log('   卡片:', JSON.stringify(a.card), ' 决策行:', JSON.stringify(a.banner))
  ok(!!a.card, '冲刺卡片已渲染')
  ok(!!a.banner, '决策横幅已渲染')
  if (a.card) ok(Math.abs(a.card.h - 108) <= 10, `折叠态卡片高度 ≈ 108px（panel-hd 71 + 决策行 37；实测 ${a.card.h}）`)
  if (a.banner) {
    ok(a.banner.h <= 46, `决策行单行未换行（实测高 ${a.banner.h}）`)
    const t = a.banner.text
    ok(/个品牌未达标/.test(t) || /全部达成/.test(t), '决策行含「未达标 / 全部达成」')
    ok(/总缺口 ¥/.test(t), '决策行含「总缺口」')
    ok(/次到货/.test(t), '决策行含「次到货」')
    ok(/均单需额外 ¥/.test(t), '决策行含「均单需额外」')
  }
  ok(a.bodyDisplay === 'none', `折叠时明细区隐藏（display=${a.bodyDisplay}）`)
  if (a.panelHd) console.log(`   标题条横向: 可用 ${a.panelHd.avail} / 已用 ${a.panelHd.used} / 余 ${a.panelHd.free}px（gap=${a.panelHd.gap}）；决策行需约 410px → ${a.panelHd.free >= 410 ? '✅ 可并入标题条（→71px 方案）' : '❌ 放不下，须独立成行（→108px）'}`)
  if (a.editBtn && a.gridCtl) {
    const d = a.gridCtl.top - a.editBtn.bottom
    console.log(`   改单底 → 表格工具行顶 = ${d}px`)
    ok(d > 100 && d < 200, `改单→表格距离落到 ≈151px（实测 ${d}）`)
  }
  await p.screenshot({ path: `/tmp/fc-banner/${TAG}-A-collapsed.png` })

  // ---------- B. 展开态 ----------
  await p.evaluate(() => { const x = document.querySelector('.card.sprint-card .imp-x'); x && x.click() })
  await sleep(1200)
  const c = await p.evaluate(probe)
  console.log('\n-- B. 展开态 --')
  console.log('   卡片:', JSON.stringify(c.card), ' 决策行:', c.banner ? c.banner.text : null)
  if (c.card) ok(c.card.h > 300 && c.card.h < 420, `展开态卡片高度 ≈ 360px（实测 ${c.card.h}）`)
  ok(!!c.banner && /总缺口|全部达成/.test(c.banner.text), '展开后决策行仍在（摘要不消失）')
  ok(c.bodyDisplay !== 'none', `展开时明细区可见（display=${c.bodyDisplay}）`)
  console.log('   明细区上边框:', c.bodyBorderTop)
  ok(/dashed/.test(c.bodyBorderTop), '虚线挂在明细区（border-top dashed）')
  await p.screenshot({ path: `/tmp/fc-banner/${TAG}-B-expanded.png` })

  // 收回折叠，供 C 段从折叠态进编辑
  await p.evaluate(() => { const x = document.querySelector('.card.sprint-card .imp-x'); x && x.click() })
  await sleep(900)

  // ---------- C. 编辑态自动折叠 ----------
  await p.evaluate(() => {
    const x = [...document.querySelectorAll('.card.toolbar button')].find(b => /^改单$/.test((b.textContent || '').trim())); x && x.click()
  })
  await sleep(7000)
  const d = await p.evaluate(probe)
  console.log('\n-- C. 编辑态 --')
  console.log('   卡片:', JSON.stringify(d.card), ' 保存:', JSON.stringify(d.saveBtn))
  if (d.card) ok(Math.abs(d.card.h - 108) <= 12, `进编辑态自动折叠 ≈ 108px（实测 ${d.card.h}）`)
  ok(d.bodyDisplay === 'none', `编辑态明细区仍隐藏（display=${d.bodyDisplay}）`)
  if (d.saveBtn && d.firstRow) {
    const d2 = d.firstRow.top - d.saveBtn.bottom
    console.log(`   保存底 → 网格首行顶 = ${d2}px`)
    ok(d2 > 100 && d2 < 220, `保存→首行距离落到 ≈150px（实测 ${d2}）`)
  }
  await p.screenshot({ path: `/tmp/fc-banner/${TAG}-C-editmode.png` })

  console.log(`\n#### ${TAG} 结果: ${pass} PASS / ${fail} FAIL`)
  console.log('pageerror/console.error:', errs.length ? errs.slice(0, 4) : '无')
  await b.close()
  process.exit(fail ? 1 : 0)
})()
