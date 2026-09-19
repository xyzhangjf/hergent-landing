/**
 * 返利冲刺看板「措辞」验收脚本（2026-09-15）
 *
 * 背景：用户口径 —— 看板里那个数字是「剩余到货次数里，每次要报多少」，
 *       不是「在某个基准之上额外加多少」。页面上不存在那个基准，所以「额外」是凭空引入的前提。
 *       本脚本断言「额外 / 多加」这类措辞已从用户可见文案里消失，且数字与展开态同源。
 *
 * 用法：
 *   HG_TOKEN=xxx HG_TENANT=9997 HG_BASE=https://hergent.cn \
 *   NODE_PATH=<managed node workspace>/node_modules node forecast-wording-verify.js
 *   可选：VW=1440 TAG=r1440
 *
 * 输出：逐条 PASS/FAIL + 截图 /tmp/fc-wording/<TAG>-*.png
 */
const puppeteer = require('puppeteer-core')
const fs = require('fs')

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.HG_BASE || 'https://hergent.cn'
const TOKEN = process.env.HG_TOKEN
const TENANT = process.env.HG_TENANT || '9997'
const VW = parseInt(process.env.VW || '1440', 10)
const TAG = process.env.TAG || ('w' + VW)
const OUT = '/tmp/fc-wording'
const sleep = ms => new Promise(r => setTimeout(r, ms))

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✅ PASS ' + m) } else { fail++; console.log('  ❌ FAIL ' + m) } }

// 注意：page.evaluate 只序列化函数源码 → 一律「普通函数 + 显式参数」，闭包变量进不去
const probe = () => {
  const txt = el => (el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : null)
  const box = el => { if (!el) return null; const r = el.getBoundingClientRect()
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) } }

  const card = document.querySelector('.sprint-card')
  const banner = document.querySelector('.sprint-card .sprint-banner')
  const sum = document.querySelector('.sprint-card .sprint-sum')
  const suggest = document.querySelector('.sprint-card .sprint-suggest')
  const body = document.querySelector('.sprint-card .panel-body')
  const tbl = [...document.querySelectorAll('.sprint-card table')].find(t =>
    [...t.querySelectorAll('thead th')].some(x => (x.textContent || '').trim() === '建议均单'))
  const heads = tbl ? [...tbl.querySelectorAll('thead th')].map(x => (x.textContent || '').trim()) : null

  // 页面所有可见文本（用于全局扫残留措辞）—— 只看业务卡片，排除脚本/样式
  return {
    vh: window.innerHeight,
    cardH: box(card) ? box(card).h : null,
    bannerText: txt(banner),
    sumText: txt(sum),
    suggestText: txt(suggest),
    bodyVisible: body ? getComputedStyle(body).display !== 'none' : null,
    sprintHeads: heads,
    // 横幅里「总缺口」与「均单需报」两个数字原文，供同源比对
    bannerNums: banner ? (banner.textContent || '').match(/[\d,]+/g) : null,
    fullPageText: document.body.innerText.replace(/\s+/g, ' ')
  }
}

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const b = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--force-device-scale-factor=1'],
    protocolTimeout: 240000
  })
  const p = await b.newPage()
  const errs = []
  p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message))
  p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()) })
  await p.evaluateOnNewDocument((t, ten) => {
    localStorage.setItem('hergent_v2_token', t)
    localStorage.setItem('hergent_v2_tenant', String(ten))
    localStorage.setItem('hergent_v2_user', JSON.stringify({ role: 'boss', username: 'sbx_wording', display_name: '措辞验收' }))
  }, TOKEN, TENANT)
  await p.setViewport({ width: VW, height: 900, deviceScaleFactor: 1 })
  await p.goto(`${BASE}/?cb=${Date.now()}#/forecast`, { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(6000)

  // 选期次（默认「— 选择期次 —」，不选则看板 v-if="cross.period" 不渲染）
  const picked = await p.evaluate(() => {
    const s = [...document.querySelectorAll('select')].find(x => [...x.options].some(o => (o.text || '').includes('选择期次')))
    if (!s) return 'no-select'
    const t = [...s.options].find(o => (o.text || '').includes('提审期')) || [...s.options].find(o => o.value && o.value !== '0')
    if (!t) return 'no-option'
    s.value = t.value; s.dispatchEvent(new Event('change', { bubbles: true }))
    return t.value + ':' + t.text
  })
  console.log(`\n########## ${TAG}  ${BASE}  期次=${picked} ##########`)
  await sleep(5500)

  const a = await p.evaluate(probe)
  await p.screenshot({ path: `${OUT}/${TAG}-1-collapsed.png` })

  console.log('\n--- 折叠态（决策横幅）---')
  console.log('  横幅原文:', a.bannerText)
  ok(!!a.bannerText, '决策横幅已渲染')
  ok(a.bannerText && a.bannerText.includes('均单需报'), '横幅含「均单需报」')
  ok(a.bannerText && a.bannerText.includes('次到货'), '横幅保留「剩 N 次到货」')
  ok(a.bannerText && !a.bannerText.includes('额外'), '横幅不含「额外」')
  ok(a.bodyVisible === false, `折叠时明细区隐藏（display=${a.bodyVisible === false ? 'none' : '可见'}）`)

  // 展开
  await p.evaluate(() => {
    const btn = document.querySelector('.sprint-card .imp-x')
    const body = document.querySelector('.sprint-card .panel-body')
    if (btn && body && getComputedStyle(body).display === 'none') btn.click()
  })
  await sleep(1600)
  const c = await p.evaluate(probe)
  await p.screenshot({ path: `${OUT}/${TAG}-2-expanded.png` })

  console.log('\n--- 展开态 ---')
  console.log('  说明段:', c.sumText)
  console.log('  建议段:', c.suggestText)
  ok(c.bodyVisible === true, '展开后明细区可见')
  ok(c.sumText && c.sumText.includes('均单需报'), '说明段含「均单需报」')
  ok(c.sumText && !c.sumText.includes('额外'), '说明段不含「额外」')
  ok(c.sumText && c.sumText.includes('建议均单'), '说明段仍引用表头「建议均单」（术语一致）')
  ok(c.suggestText && c.suggestText.includes('每单需报'), '系统建议含「每单需报」')
  ok(c.suggestText && !c.suggestText.includes('多加'), '系统建议不含「多加」')
  ok(c.sprintHeads && c.sprintHeads.join('|').includes('建议均单'), '表头保留「建议均单」列')
  ok(!!c.bannerText && c.bannerText.includes('均单需报'), '展开态横幅仍在（常显）')

  const txt = c.fullPageText || ''
  console.log('\n--- 全局残留扫描（整页可见文本）---')
  ok(!txt.includes('均单需额外'), '整页无「均单需额外」')
  ok(!txt.includes('每单多加'), '整页无「每单多加」')
  ok(!/均单[^，。；]*额外/.test(txt), '整页无「均单…额外」组合')

  // 同源：横幅的「总缺口」与「均单需报」都应出现在展开态数字里（同一 fmt）
  if (a.bannerNums && c.bannerNums) {
    const same = a.bannerNums.join(',') === c.bannerNums.join(',')
    ok(same, `折叠/展开两态横幅数字一致（${a.bannerNums.join(',')}）`)
  }

  console.log('\n--- 布局 ---')
  console.log(`  折叠态卡片高=${a.cardH}px  视口=${a.vh}px`)
  ok(a.cardH !== null && a.cardH < 200, `折叠态卡片仍为摘要高度（${a.cardH}px < 200）`)

  console.log('\n--- 运行时错误 ---')
  console.log('  ' + (errs.length ? errs.slice(0, 4).join('\n  ') : '无'))
  ok(errs.length === 0, '页面无 console/page 错误')

  console.log(`\n===== ${TAG} 结果：${pass} PASS / ${fail} FAIL =====\n`)
  await b.close()
  process.exit(fail ? 1 : 0)
})()
