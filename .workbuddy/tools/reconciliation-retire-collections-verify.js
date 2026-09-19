/**
 * v197 真机验收：撤下「三步对账向导」+ 催收跟进独立成页
 *
 * 断言分组：
 *   A 侧栏入口（桌面）   B 新页可打开      C 旧链接重定向
 *   D 命令面板           E 移动端抽屉      F 工作台待办跳转
 *   G 其它页面冒烟       H 控制台无报错
 *
 * 只读：全程不点任何写按钮（「刷新队列」= POST /rebuild，**不点**）。
 *
 * 跑法：
 *   NODE_PATH=/Users/zhangjunfeng/.workbuddy/binaries/node/workspace/node_modules \
 *   HG_TOKEN=$(cat /tmp/hg_boss_token.txt) \
 *   node .workbuddy/tools/reconciliation-retire-collections-verify.js
 */
const puppeteer = require('puppeteer-core')
const fs = require('fs')
const path = require('path')

const TOKEN = process.env.HG_TOKEN || ''
const OUT = process.env.HG_OUT || '/tmp'
const BASE = 'https://hergent.cn'
const TS = Date.now()

const R = []
function ok(name, cond, extra) {
  R.push({ name, pass: !!cond, extra: extra === undefined ? '' : String(extra) })
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

;(async () => {
  if (!TOKEN) { console.error('缺 HG_TOKEN'); process.exit(1) }
  fs.mkdirSync(OUT, { recursive: true })

  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1600, height: 1000 })

  const errs = []
  const bad = []
  const apiHit = []
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message))
  page.on('console', async m => {
    if (m.type() !== 'error') return
    const parts = []
    for (const a of m.args()) {
      try {
        parts.push(await a.evaluate(e => (e && e.stack) || (e && e.message) || String(e)))
      } catch (_) { parts.push('JSHandle@error') }
    }
    errs.push('CONSOLE: ' + parts.join(' '))
  })
  page.on('response', r => {
    const u = r.url()
    if (u.includes('/api/collections/')) apiHit.push(r.status() + ' ' + u.split('?')[0].replace(BASE, ''))
    if (r.status() >= 400 && !u.includes('/api/ai/')) bad.push(r.status() + ' ' + u.split('?')[0].replace(BASE, ''))
  })

  // 文档脚本执行前注入登录态（一次导航到位，不被守卫踢回 login）
  await page.evaluateOnNewDocument((t, u, ten) => {
    localStorage.setItem('hergent_v2_token', t)
    localStorage.setItem('hergent_v2_user', JSON.stringify(u))
    localStorage.setItem('hergent_v2_tenant', String(ten))
  }, TOKEN, { username: 'boss', display_name: '老板' }, 1)

  /* ---------- A 侧栏入口（桌面） ---------- */
  await page.goto(BASE + '/?cb=' + TS + '#/workbench', { waitUntil: 'networkidle2' })
  await sleep(2500)
  ok('A0 登录态有效（未被踢回 login）', !page.url().includes('/login'), page.url())

  const nav = await page.evaluate(() => {
    const sidebar = document.querySelector('.sb-nav')
    const links = sidebar ? [...sidebar.querySelectorAll('a')] : []
    return {
      hrefs: links.map(a => a.getAttribute('href')),
      texts: links.map(a => (a.textContent || '').trim()),
    }
  })
  ok('A1 侧栏有 /collections 入口', nav.hrefs.includes('#/collections'), nav.hrefs.join(','))
  ok('A2 侧栏文案含「催收跟进」', nav.texts.includes('催收跟进'), nav.texts.join('|'))
  ok('A3 侧栏无 /reconciliation 入口', !nav.hrefs.some(h => h && h.includes('reconciliation')), nav.hrefs.join(','))
  ok('A4 侧栏无「对账工作流」文案', !nav.texts.some(t => t.includes('对账工作流')), nav.texts.join('|'))
  const navIcon = await page.evaluate(() => {
    const a = [...document.querySelectorAll('.sb-nav a')].find(x => (x.getAttribute('href') || '').includes('collections'))
    if (!a) return null
    const svg = a.querySelector('svg')
    const p = svg ? svg.querySelector('path') : null
    return { hasSvg: !!svg, d: p ? p.getAttribute('d').slice(0, 30) : '' }
  })
  ok('A5 侧栏入口带线性图标（Lucide phone）', navIcon && navIcon.hasSvg && /^M22 16\.92v3/.test(navIcon.d), JSON.stringify(navIcon))

  /* ---------- B 新页可打开（点侧栏入口，不是直接 goto） ---------- */
  await page.evaluate(() => {
    const a = [...document.querySelectorAll('.sb-nav a')].find(x => (x.getAttribute('href') || '').includes('collections'))
    a.click()
  })
  await sleep(2500)
  const b = await page.evaluate(() => ({
    hash: location.hash,
    h2: (document.querySelector('.page-hd h2') || {}).textContent || '',
    sub: (document.querySelector('.page-sub') || {}).textContent || '',
    card: document.querySelectorAll('.col-card').length,
    stats: [...document.querySelectorAll('.col-stat')].map(e => e.textContent.replace(/\s+/g, ' ').trim()),
    items: document.querySelectorAll('.col-item').length,
    ops: document.querySelectorAll('.col-item .col-ops button').length,
    legacy: document.body.textContent.includes('对账工作流'),
    html: document.querySelector('.page') ? document.querySelector('.page').innerHTML.length : 0,
  }))
  ok('B1 点侧栏跳到 #/collections', b.hash === '#/collections', b.hash)
  ok('B2 页头标题 = 催收跟进', b.h2.trim() === '催收跟进', b.h2)
  ok('B3 页副标题业务化（无「对账」残留）', b.sub.includes('谁欠我钱') && !b.sub.includes('对账'), b.sub)
  ok('B4 催收队列卡片存在', b.card === 1, b.card)
  ok('B5 统计块 5 格', b.stats.length === 5, b.stats.length)
  ok('B6 统计「未收总额」带 ¥ 单位', /^¥/.test((b.stats[0] || '').replace(/^¥/, '¥')) && (b.stats[0] || '').includes('¥'), b.stats[0])
  ok('B7 队列有真实数据行', b.items > 0, b.items)
  ok('B8 每行 4 个动作按钮', b.ops === b.items * 4, b.ops + ' / ' + b.items + ' 行')
  ok('B9 页面无「对账工作流」字样', !b.legacy, b.legacy)
  ok('B10 页面有实质 DOM', b.html > 1000, b.html)
  ok('B11 催收两个接口均 200', apiHit.length >= 2 && apiHit.every(h => h.startsWith('200')), apiHit.join(' ; '))

  await page.screenshot({ path: path.join(OUT, '01-催收跟进-独立页-1600.png'), fullPage: true })

  /* ---------- C 旧链接重定向 ---------- */
  await page.goto(BASE + '/?cb=' + (TS + 1) + '#/reconciliation', { waitUntil: 'networkidle2' })
  await sleep(2500)
  const c = await page.evaluate(() => ({
    hash: location.hash,
    h2: (document.querySelector('.page-hd h2') || {}).textContent || '',
    items: document.querySelectorAll('.col-item').length,
  }))
  ok('C1 旧链接 /reconciliation 重定向到 /collections', c.hash === '#/collections', c.hash)
  ok('C2 重定向后渲染的是催收页', c.h2.trim() === '催收跟进' && c.items > 0, c.h2 + ' / ' + c.items)

  /* ---------- D 命令面板 ---------- */
  await page.goto(BASE + '/?cb=' + (TS + 2) + '#/workbench', { waitUntil: 'networkidle2' })
  await sleep(2000)
  await page.keyboard.down('Meta')
  await page.keyboard.down('Shift')
  await page.keyboard.press('k')
  await page.keyboard.up('Shift')
  await page.keyboard.up('Meta')
  await sleep(700)
  const d = await page.evaluate(() => {
    const panel = document.querySelector('.cmd-panel')
    const items = panel ? [...panel.querySelectorAll('.cmd-item')] : []
    return {
      open: !!panel,
      titles: items.map(i => (i.textContent || '').replace(/\s+/g, ' ').trim()),
    }
  })
  ok('D1 命令面板可唤起', d.open, d.open)
  const colIdx = d.titles.findIndex(t => t.includes('催收跟进'))
  ok('D2 面板含「催收跟进」', colIdx >= 0, d.titles.join(' | '))
  ok('D3 面板无「对账工作流」', !d.titles.some(t => t.includes('对账工作流')), d.titles.join(' | '))
  if (colIdx >= 0) {
    await page.evaluate(i => {
      document.querySelectorAll('.cmd-panel .cmd-item')[i].click()
    }, colIdx)
    await sleep(2200)
    const dh = await page.evaluate(() => location.hash)
    const dhd = await page.evaluate(() => (document.querySelector('.page-hd h2') || {}).textContent || '')
    ok('D4 点面板项跳到催收页', dh === '#/collections' && dhd.trim() === '催收跟进', dh + ' / ' + dhd)
  } else {
    ok('D4 点面板项跳到催收页', false, '前置 D2 未通过，跳过')
  }

  /* ---------- F 工作台待办跳转 ---------- */
  await page.goto(BASE + '/?cb=' + (TS + 3) + '#/workbench', { waitUntil: 'networkidle2' })
  await sleep(3000)
  const f = await page.evaluate(() => {
    const items = [...document.querySelectorAll('.todo-item')]
    return {
      titles: items.map(i => (i.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40)),
      collect: items.findIndex(i => (i.textContent || '').includes('催收')),
      icons: items.map(i => (i.querySelector('.todo-ic') || {}).textContent || ''),
    }
  })
  if (f.collect >= 0) {
    ok('F1 待办含催收项', true, f.titles[f.collect])
    ok('F2 催收待办图标为「催」', f.icons[f.collect] === '催', f.icons.join(','))
    await page.evaluate(i => document.querySelectorAll('.todo-item')[i].click(), f.collect)
    await sleep(2500)
    const fh = await page.evaluate(() => location.hash)
    const fhd = await page.evaluate(() => (document.querySelector('.page-hd h2') || {}).textContent || '')
    ok('F3 待办跳到催收页（非已撤下的对账页）', fh === '#/collections' && fhd.trim() === '催收跟进', fh + ' / ' + fhd)
  } else {
    ok('F1 待办含催收项', false, '当前数据未生成催收待办：' + f.titles.join(' | '))
    ok('F2 催收待办图标为「催」', false, '前置未通过，跳过')
    ok('F3 待办跳到催收页（非已撤下的对账页）', false, '前置未通过，跳过')
  }
  await page.screenshot({ path: path.join(OUT, '02-经营工作台待办-1600.png'), fullPage: true })

  /* ---------- E 移动端抽屉 ---------- */
  await page.setViewport({ width: 390, height: 844 })
  await page.goto(BASE + '/?cb=' + (TS + 4) + '#/workbench', { waitUntil: 'networkidle2' })
  await sleep(2200)
  const e = await page.evaluate(async () => {
    const btns = [...document.querySelectorAll('.mnav-item')]
    const more = btns.find(x => (x.textContent || '').includes('更多'))
    if (more) more.click()
    return { moreFound: !!more, mnav: btns.length }
  })
  await sleep(900)
  const e2 = await page.evaluate(() => {
    const sheet = document.querySelector('.md-sheet')
    const links = sheet ? [...sheet.querySelectorAll('a')] : []
    const r = sheet ? sheet.getBoundingClientRect() : null
    return {
      sheet: !!sheet,
      visible: !!(r && r.width > 0 && r.height > 0),
      hrefs: links.map(a => a.getAttribute('href')),
      texts: links.map(a => (a.textContent || '').trim()),
    }
  })
  ok('E1 移动端「更多」可打开抽屉', e.moreFound && e2.sheet && e2.visible, JSON.stringify({ more: e.moreFound, sheet: e2.sheet, vis: e2.visible, mnav: e.mnav }))
  ok('E2 抽屉含 /collections', e2.hrefs.includes('#/collections'), e2.hrefs.join(','))
  ok('E3 抽屉含「催收跟进」', e2.texts.includes('催收跟进'), e2.texts.join('|'))
  ok('E4 抽屉无 /reconciliation 与「对账工作流」', !e2.hrefs.some(h => h && h.includes('reconciliation')) && !e2.texts.some(t => t.includes('对账工作流')), e2.hrefs.join(',') + ' / ' + e2.texts.join('|'))
  await page.screenshot({ path: path.join(OUT, '03-移动端抽屉-390.png') })

  /* ---------- G 其它页面冒烟（防删文件/改路由打坏别处） ---------- */
  await page.setViewport({ width: 1600, height: 1000 })
  const routes = ['/forecast', '/rebate', '/loss-accounting', '/payroll', '/archive/employees', '/settings', '/dashboard']
  const smoke = []
  for (let i = 0; i < routes.length; i++) {
    const rt = routes[i]
    await page.goto(BASE + '/?cb=' + (TS + 10 + i) + '#' + rt, { waitUntil: 'networkidle2' })
    await sleep(1800)
    const s = await page.evaluate(() => {
      const p = document.querySelector('.page')
      const txt = document.body ? document.body.textContent.replace(/\s+/g, '') : ''
      return {
        hash: location.hash,
        hasPage: !!p,
        html: p ? p.innerHTML.length : 0,
        cards: document.querySelectorAll('.card').length,
        txtLen: txt.length,
      }
    })
    smoke.push({ rt, ...s })
    // 判据：进得去（未被踢回 login）+ .page 有实质 DOM + 有结构性内容
    ok('G' + (i + 1) + ' 冒烟 ' + rt, !s.hash.includes('login') && s.hasPage && (s.html > 600 || s.cards > 0), JSON.stringify(s))
  }

  /* ---------- H 控制台 ---------- */
  const realErrs = errs.filter(e => !/403/.test(e))
  ok('H1 无 pageerror', realErrs.filter(e => e.startsWith('PAGEERROR')).length === 0, realErrs.filter(e => e.startsWith('PAGEERROR')).join(' || '))
  ok('H2 无非 403 的控制台错误', realErrs.filter(e => e.startsWith('CONSOLE')).length === 0, realErrs.filter(e => e.startsWith('CONSOLE')).join(' || '))
  ok('H3 无 404 类资源缺失', !bad.some(x => x.startsWith('404')), bad.join(' ; '))
  ok('H4 断言数 > 0（防断言静默消失）', R.length >= 25, R.length)

  await browser.close()

  console.log('\n===== 结果 =====')
  for (const r of R) {
    console.log((r.pass ? 'PASS  ' : 'FAIL  ') + r.name + (r.extra ? '   [' + r.extra + ']' : ''))
  }
  const pass = R.filter(r => r.pass).length
  console.log('\n合计 %d/%d', pass, R.length)
  console.log('非 403 控制台错误:', JSON.stringify(realErrs))
  console.log('接口命中:', JSON.stringify([...new Set(apiHit)]))
  console.log('非 2xx(排除 /api/ai):', JSON.stringify([...new Set(bad)]))
  process.exit(pass === R.length ? 0 : 2)
})().catch(e => { console.error('FATAL', e); process.exit(1) })
