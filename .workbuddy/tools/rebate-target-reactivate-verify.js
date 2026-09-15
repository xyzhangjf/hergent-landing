// 目标被停用 → 面板全空 的复现 + 恢复验证（沙箱租户内跑，绝不动生产）
//
// 用法:
//   HG_TOKEN=<sbx token> HG_TENANT=9998 OUT=<dir> NODE_PATH=<ws>/node_modules \
//     node rebate-target-reactivate-verify.js
//
// 场景：tenant_1 真实操作后「启用中的返利规则数 = 0」，
//       导致 ①目标与返利·仪表盘 ②预报页·返利冲刺看板 双双空白。
// 本脚本：A 复现空白 → B 用界面上真实的「启用」按钮恢复 → C 验证两面板回归
const puppeteer = require('puppeteer-core')
const fs = require('fs')

const TOKEN = process.env.HG_TOKEN
const TENANT = process.env.HG_TENANT
const OUT = process.env.OUT || '/tmp'
const RULE_NAME = process.env.HG_RULE || '蒙牛低温2026年目标'

const results = []
function ok(cond, label, extra) {
  results.push({ pass: !!cond, label })
  console.log((cond ? '  ✓ ' : '  ✗ ') + label + (extra ? '   ' + extra : ''))
}
function info(m) { console.log('  · ' + m) }
const sleep = ms => new Promise(r => setTimeout(r, ms))

// —— 页面内取数（helper 必须内联：page.evaluate 只序列化函数自身源码）——
function grabRebate() {
  const se = document.querySelector('.state-empty')
  const txt = (document.body.innerText || '').replace(/\s+/g, ' ')
  return {
    emptyText: se ? se.textContent.replace(/\s+/g, ' ').trim().slice(0, 120) : null,
    hasEmpty: !!se,
    canvases: document.querySelectorAll('canvas').length,
    // 关键数字是否出现在页面上（9 月目标 674,000 / 达成 405,461）
    hasTarget674: /674[,.]?000/.test(txt),
    hasAchv405: /405[,.]?461/.test(txt),
    bodyHead: txt.slice(0, 240),
  }
}
function grabRulesTab() {
  const rows = [...document.querySelectorAll('table tbody tr')].map(tr => {
    const tds = [...tr.querySelectorAll('td')].map(td => td.textContent.trim().replace(/\s+/g, ' '))
    const btns = [...tr.querySelectorAll('button')].map(b => b.textContent.trim())
    return { name: tds[0], scope: tds[3], status: tds[8], hasActivate: btns.includes('启用') }
  })
  return { rows }
}
function grabSprint() {
  const card = document.querySelector('.sprint-card')
  const banner = document.querySelector('.sprint-banner')
  const tbl = document.querySelector('.sprint-card table')
  const txt = (document.body.innerText || '').replace(/\s+/g, ' ')
  return {
    card: !!card,
    banner: !!banner,
    bannerText: banner ? banner.textContent.replace(/\s+/g, ' ').trim().slice(0, 140) : null,
    rows: tbl ? tbl.querySelectorAll('tbody tr').length : 0,
    rowNames: tbl ? [...tbl.querySelectorAll('tbody tr')].map(tr => (tr.querySelector('td') || {}).textContent || '').slice(0, 4) : [],
    hasEmptyHint: /暂无|没有|未配置/.test((card || {}).innerText || ''),
    hasTarget674: /674[,.]?000/.test(txt),
  }
}
// 点「启用」按钮（真实 UI 路径，不用直接打 API）
function clickActivate(name) {
  const tr = [...document.querySelectorAll('table tbody tr')]
    .find(x => (x.querySelector('td') || {}).textContent &&
      x.querySelector('td').textContent.trim() === name)
  if (!tr) return 'row-not-found'
  const b = [...tr.querySelectorAll('button')].find(x => x.textContent.trim() === '启用')
  if (!b) return 'btn-not-found'
  b.click()
  return 'clicked'
}

;(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 1000 })
  const bad = []
  page.on('response', r => { if (r.status() >= 400 && !/403/.test(String(r.status()))) bad.push(r.status() + ' ' + r.url().slice(-70)) })

  await page.evaluateOnNewDocument((t, ten) => {
    localStorage.setItem('hergent_v2_token', t)
    if (ten) localStorage.setItem('hergent_v2_tenant', String(ten))
  }, TOKEN, TENANT)

  // ============ A. 复现：目标全被停用 → 两个面板都空 ============
  console.log('\n=== A. 复现空白（规则全部 is_active=0）===')
  await page.goto('https://hergent.cn/?cb=' + Date.now() + '#/rebate', { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(5000)
  ok(!/#\/login/.test(page.url()), '登录态注入成功')
  const A0 = await page.evaluate(grabRebate)
  info('仪表盘空态：' + JSON.stringify(A0.emptyText) + '｜canvas=' + A0.canvases)
  if (OUT) await page.screenshot({ path: OUT + '/rebate-1-before-仪表盘空白.png', fullPage: false })
  ok(A0.hasEmpty, '仪表盘 tab 显示空态（不是数据展示）')
  ok(!A0.hasTarget674, '页面上找不到任何目标数字（9月目标 674,000 缺失）')

  // 规则列表：能看见 2 条，但都是「已停用」
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button.main-tab')].find(x => x.textContent.trim() === '目标与返利')
    if (b) b.click()
  })
  await sleep(2500)
  const A1 = await page.evaluate(grabRulesTab)
  info('规则列表 ' + A1.rows.length + ' 行：')
  A1.rows.forEach(r => info('   ' + r.name + ' | ' + r.scope + ' | ' + r.status + ' | 有启用按钮=' + r.hasActivate))
  if (OUT) await page.screenshot({ path: OUT + '/rebate-2-before-规则列表.png', fullPage: false })
  ok(A1.rows.length > 0, '规则列表仍能看到 ' + A1.rows.length + ' 条（列表用 include_inactive=1）')
  ok(A1.rows.every(r => r.hasActivate), '这些规则都显示「启用」按钮 ⇒ 它们是被停用，不是被删除')

  // 预报页冲刺看板
  await page.goto('https://hergent.cn/?cb=' + Date.now() + '#/forecast', { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(5500)
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => (x.getAttribute('title') || '').includes('展开') || /chevron-down/.test(x.innerHTML))
    if (b) b.click()
  })
  await sleep(1500)
  const A2 = await page.evaluate(grabSprint)
  info('冲刺看板：card=' + A2.card + ' banner=' + A2.banner + ' 行数=' + A2.rows + ' 空提示=' + A2.hasEmptyHint)
  if (OUT) await page.screenshot({ path: OUT + '/forecast-1-before-冲刺看板空白.png', fullPage: false })
  ok(A2.card, '冲刺看板卡片存在（标题栏还在）')
  ok(A2.rows === 0, '看板内一行数据都没有（' + A2.rows + ' 行）⇒ 与用户描述一致')

  // ============ B. 恢复：点界面上真实的「启用」按钮 ============
  console.log('\n=== B. 用界面「启用」按钮恢复「' + RULE_NAME + '」===')
  await page.goto('https://hergent.cn/?cb=' + Date.now() + '#/rebate', { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(5000)
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button.main-tab')].find(x => x.textContent.trim() === '目标与返利')
    if (b) b.click()
  })
  await sleep(2500)
  const clickRes = await page.evaluate(clickActivate, RULE_NAME)
  ok(clickRes === 'clicked', '点到「' + RULE_NAME + '」行的「启用」按钮', clickRes)
  await sleep(4000)
  const B0 = await page.evaluate(grabRulesTab)
  const target = B0.rows.find(r => r.name === RULE_NAME)
  info('恢复后该行状态：' + (target ? target.status : '未找到'))
  if (OUT) await page.screenshot({ path: OUT + '/rebate-3-after-启用点击.png', fullPage: false })
  ok(target && /启用|生效|进行中/.test(target.status || ''), '该规则状态回到「启用」', target ? target.status : '')

  // ============ C. 验证两面板回归 ============
  console.log('\n=== C. 两个面板是否自动回来 ===')
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button.main-tab')].find(x => x.textContent.trim() === '仪表盘')
    if (b) b.click()
  })
  await sleep(5000)
  const C0 = await page.evaluate(grabRebate)
  info('仪表盘：hasEmpty=' + C0.hasEmpty + ' 目标674=' + C0.hasTarget674 + ' 达成405=' + C0.hasAchv405)
  if (OUT) await page.screenshot({ path: OUT + '/rebate-4-after-仪表盘恢复.png', fullPage: false })
  ok(!C0.hasEmpty, '仪表盘空态消失（有数据了）')
  ok(C0.hasTarget674, '出现 9 月目标 674,000')
  ok(C0.hasAchv405, '出现 9 月达成 405,461')

  await page.goto('https://hergent.cn/?cb=' + Date.now() + '#/forecast', { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(6000)
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /chevron-down/.test(x.innerHTML))
    if (b) b.click()
  })
  await sleep(2000)
  const C1 = await page.evaluate(grabSprint)
  info('冲刺看板：banner=' + C1.banner + ' 行数=' + C1.rows + '｜' + JSON.stringify(C1.bannerText))
  info('看板行：' + JSON.stringify(C1.rowNames))
  if (OUT) await page.screenshot({ path: OUT + '/forecast-2-after-冲刺看板恢复.png', fullPage: false })
  ok(C1.banner, '冲刺看板概览条回来了')
  ok(C1.rows > 0, '看板出现 ' + C1.rows + ' 行品牌目标')

  if (bad.length) info('非 2xx 请求: ' + bad.slice(0, 6).join(' ; '))
  const pass = results.filter(r => r.pass).length
  console.log('\n===== 结果 ' + pass + '/' + results.length + ' =====')
  await browser.close()
  process.exit(pass === results.length ? 0 : 1)
})()
