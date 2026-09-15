/* 表格工具行（.grid-ctl-row）控件样式规格审计
 * ------------------------------------------------------------------
 * 目的：把「仅显示有报单 / 品牌 / 复制报单」等控件的**最终生效值**打出来。
 * 为什么不能只看源码：.btn(14px/--radius-md) 与 .btn-sm(13px/--radius-sm) 是
 * 同特异性的单类选择器，谁赢只取决于**源码顺序**；再加上 Forecast.vue 的
 * scoped 层与用户代理默认值，只有 getComputedStyle 才是真相。
 *
 * 用法（隔离沙箱令牌，全程只读；点「全选」只改前端内存状态，不落库）：
 *   HG_TOKEN=xxx HG_TENANT=9997 node forecast-ctl-row-style-audit.js
 */
const puppeteer = require('puppeteer-core')

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = 'https://hergent.cn'
const TOKEN = process.env.HG_TOKEN
const TENANT = process.env.HG_TENANT || '9997'
const SHOT = process.env.HG_SHOT || '/tmp/ctl-row-style.png'

const sleep = ms => new Promise(r => setTimeout(r, ms))

/* 需要对比的属性（顺序即输出列序） */
const PROPS = ['fontSize', 'fontWeight', 'color', 'backgroundColor',
  'borderTopWidth', 'borderTopColor', 'borderRadius', 'height', 'paddingLeft']

const LABELS = {
  zoomBtn: '缩放 －/＋ 按钮', zoomLabel: '缩放「缩放」标签', zoomVal: '缩放「100%」数值',
  toggle: '仅显示有报单 (label)', toggleBox: '仅显示有报单 (checkbox)',
  brandBtn: '品牌按钮', copyBtn: '复制报单按钮', badge: '品牌计数 .btn-badge',
  fsBtn: '全屏按钮', tbGhost: '主工具栏「导入」(对照)',
}

/* 页面内采集器：抓「最终生效值」+ 文字 + 实际盒高
   ⚠️ 必须写成「普通函数 + 显式参数」：puppeteer 只序列化函数源码，
      闭包捕获的外层变量进不了页面上下文（会 ReferenceError）。 */
function collect(props) {
  const row = [...document.querySelectorAll('.grid-ctl-row')]
    .find(x => x.getBoundingClientRect().height > 0)
  if (!row) return { err: '未找到可见的 .grid-ctl-row' }
  const cs = el => {
    if (!el) return null
    const s = getComputedStyle(el), o = {}
    props.forEach(p => { o[p] = s[p] })
    o.text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 22)
    o.boxH = Math.round(el.getBoundingClientRect().height)
    return o
  }
  const btn = kw => [...document.querySelectorAll('.grid-ctl-row button, .tb-pop button')]
    .find(b => (b.textContent || '').includes(kw))

  const out = {}
  out.zoomBtn = cs(row.querySelector('.zb-btn'))
  out.zoomLabel = cs(row.querySelector('.zb-label'))
  out.zoomVal = cs(row.querySelector('.zb-val'))
  out.toggle = cs(row.querySelector('.tb-toggle'))
  out.toggleBox = cs(row.querySelector('.tb-toggle input'))
  out.brandBtn = cs(btn('品牌'))
  out.copyBtn = cs(btn('复制报单'))
  out.badge = cs(row.querySelector('.btn-badge'))
  out.fsBtn = cs(document.querySelector('.grid-fs-btn'))
  const tb = document.querySelector('.toolbar')
  out.tbGhost = tb ? cs([...tb.querySelectorAll('button')].find(b => (b.textContent || '').includes('导入'))) : null
  out._order = [...row.children].map(c => (c.className || c.tagName).toString().split(' ')[0])
  return out
}

;(async () => {
  let PASS = 0, FAIL = 0
  const ok = (c, m) => { c ? (PASS++, console.log('  PASS  ' + m)) : (FAIL++, console.log('  FAIL  ' + m)) }

  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--force-device-scale-factor=1'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1680, height: 950, deviceScaleFactor: 1 })
  const errs = [], bad = []
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message))
  page.on('response', r => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url().slice(0, 110)) })

  await page.evaluateOnNewDocument((t, ten) => {
    localStorage.setItem('hergent_v2_token', t)
    localStorage.setItem('hergent_v2_tenant', String(ten))
    localStorage.setItem('hergent_v2_user', JSON.stringify({ role: 'boss', username: 'v169audit', display_name: '规格审计' }))
  }, TOKEN, TENANT)

  await page.goto(`${BASE}/?cb=${Date.now()}#/forecast`, { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(5500)
  ok(!/#\/login/.test(page.url()), '登录态注入成功（未被弹回 /#/login）')

  /* ══ 1. 基线：抓全部控件的最终生效值 ══ */
  const base = await page.evaluate(collect, PROPS)
  if (base.err) { console.log('ERR', base.err); await browser.close(); process.exit(1) }

  console.log('\n╔══ 表格工具行控件 · 最终生效值 ══════════════════════════════════════════════════════')
  console.log('║ ' + '控件'.padEnd(22) + PROPS.map(p => p.replace(/[A-Z]/g, c => c.toLowerCase()).slice(0, 9).padStart(10)).join(''))
  for (const k of Object.keys(LABELS)) {
    const v = base[k]
    if (!v) { console.log('║ ' + LABELS[k].padEnd(22) + '  (缺失)'); continue }
    console.log('║ ' + LABELS[k].padEnd(22) + PROPS.map(p => String(v[p]).replace(/^(rgb\(.*?\))$/, '$1').slice(0, 9).padStart(10)).join(''))
  }
  console.log('╚' + '═'.repeat(112))
  console.log('\n实测盒高：')
  for (const k of Object.keys(LABELS)) {
    if (base[k]) console.log('   ' + LABELS[k].padEnd(22) + base[k].boxH + 'px')
  }
  console.log('\n工具行子元素顺序：', JSON.stringify(base._order))

  /* ══ 2. 三控件「逐属性全等」判定（v169 规格统一后的验收判据）═══
     判据不是「看起来差不多」，而是 getComputedStyle 逐属性字符串相等：
     只要有一项不等，就说明其中一个控件还在走另一套规则（= 用户看到的不一致）。 */
  console.log('\n═══ 三控件规格一致性（仅显示有报单 / 品牌 / 复制报单）═══')
  const CMP_PROPS = ['fontSize', 'fontWeight', 'color', 'backgroundColor',
    'borderTopColor', 'borderRadius', 'paddingLeft']
  const KEYS = ['toggle', 'brandBtn', 'copyBtn']
  for (const p of CMP_PROPS) {
    const vals = KEYS.map(k => (base[k] ? base[k][p] : '(缺失)'))
    ok(new Set(vals).size === 1, `${p} 三者一致（${vals.join(' / ')}）`)
  }
  const hs = KEYS.map(k => base[k] && base[k].boxH)
  ok(new Set(hs).size === 1, `实测盒高齐平（${hs.join(' / ')}）`)
  ok(base.toggle.fontSize === '13px' && base.toggle.fontWeight === '500',
    `「仅显示有报单」已归队到 13px/500（${base.toggle.fontSize}/${base.toggle.fontWeight}）`)
  ok(base.toggle.backgroundColor === 'rgba(0, 0, 0, 0)',
    `「仅显示有报单」底色为透明，与 .btn-ghost 同（${base.toggle.backgroundColor}）`)

  /* ══ 3. 选中态 .btn.on 是否真的存在（真缺陷探测）═══ */
  console.log('\n═══ 选中态（:class="{on:...}"）实际效果 ═══')
  const snap = () => page.evaluate(() => {
    const b = [...document.querySelectorAll('.grid-ctl-row button, .tb-pop button')]
      .find(x => (x.textContent || '').includes('品牌'))
    if (!b) return null
    const s = getComputedStyle(b)
    return { cls: b.className, bg: s.backgroundColor, color: s.color, border: s.borderTopColor, shadow: s.boxShadow }
  })
  const before = await snap()
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.grid-ctl-row button, .tb-pop button')]
      .find(x => (x.textContent || '').includes('品牌'))
    b && b.click()
  })
  await sleep(700)
  const during = await snap()
  console.log('  开面板前:', JSON.stringify(before))
  console.log('  开面板后:', JSON.stringify(during))
  ok(during && /(^|\s)on(\s|$)/.test(during.cls), '点击后按钮带上了 .on 类')
  /* 逐项断言而非「有任何变化」：四个属性都该变，少一项就说明规则只写了一半 */
  ok(before.bg !== during.bg, `.on 改变了底色（${before.bg} → ${during.bg}）`)
  ok(before.color !== during.color, `.on 改变了文字色（${before.color} → ${during.color}）`)
  ok(before.border !== during.border, `.on 改变了边框色（${before.border} → ${during.border}）`)
  ok(before.shadow !== during.shadow, `.on 加上了阴影（${during.shadow}）`)
  /* 视觉语言与同页 .view-seg button.on 同源：浅底应恰为 --bg4(#f0f0f2) */
  ok(during.bg === 'rgb(240, 240, 242)',
    `.on 底色 = --bg4(--bg4: #f0f0f2)，与 .view-seg button.on 同一套「已选中」语言（${during.bg}）`)

  /* ══ 4. .btn-badge 是否有样式（真缺陷探测）═══ */
  console.log('\n═══ 品牌计数 .btn-badge 实际渲染 ═══')
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.link-btn')].find(b => (b.textContent || '').includes('全选'))
    btn && btn.click()
  })
  await sleep(500)
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.grid-ctl-row button, .tb-pop button')]
      .find(x => (x.textContent || '').includes('品牌'))
    const panel = document.querySelector('.brand-pop')
    if (panel) b && b.click()          // 关掉面板，让 badge 单独可测
  })
  await sleep(600)
  const badge = await page.evaluate(() => {
    const el = document.querySelector('.grid-ctl-row .btn-badge')
    if (!el) return { present: false }
    const s = getComputedStyle(el)
    const btn = el.closest('button')
    const bs = getComputedStyle(btn)
    return {
      present: true, text: el.textContent.trim(),
      fontSize: s.fontSize, fontWeight: s.fontWeight, color: s.color,
      background: s.backgroundColor, radius: s.borderRadius, padding: s.padding,
      boxH: Math.round(el.getBoundingClientRect().height),
      btnFontSize: bs.fontSize, btnColor: bs.color,
      sameAsButton: s.fontSize === bs.fontSize && s.color === bs.color && s.backgroundColor === 'rgba(0, 0, 0, 0)',
    }
  })
  console.log('  ' + JSON.stringify(badge))
  if (badge.present) {
    ok(!badge.sameAsButton, '品牌计数是独立徽标（有自己的底/色/字号），而非与正文同号的裸数字')
    ok(badge.fontSize === '11px', `徽标字号 11px（比按钮标签低一档）（实测 ${badge.fontSize}）`)
    ok(badge.boxH === 18, `徽标高 18px（在 32px 按钮内不参与撑高）（实测 ${badge.boxH}）`)
    ok(badge.radius === '9px', `徽标为胶囊形（半径 9px = 高 18 的一半）（实测 ${badge.radius}）`)
    ok(badge.background !== 'rgba(0, 0, 0, 0)', `徽标有底色（${badge.background}）`)
    ok(badge.color !== badge.btnColor, `徽标文字色区别于按钮正文（${badge.color} vs ${badge.btnColor}）`)
  } else {
    FAIL++; console.log('  FAIL  勾选品牌后未出现计数徽标')
  }

  /* ══ 5. .btn-badge.err 变体（「查错」按钮用；数据里未必有错 → 用离屏探针验规则本身）═══ */
  console.log('\n═══ .btn-badge.err 变体（离屏探针，不依赖数据）═══')
  const probe = await page.evaluate(() => {
    const host = document.createElement('div')
    host.style.cssText = 'position:absolute;left:-9999px;top:0'
    const mk = cls => { const s = document.createElement('span'); s.className = cls; s.textContent = '99+'; return s }
    const a = mk('btn-badge'), b = mk('btn-badge err')
    host.append(a, b); document.body.appendChild(host)
    const g = el => { const s = getComputedStyle(el); return { h: Math.round(el.getBoundingClientRect().height),
      fs: s.fontSize, bg: s.backgroundColor, color: s.color, r: s.borderRadius } }
    const r = { plain: g(a), err: g(b) }
    host.remove(); return r
  })
  console.log('  ' + JSON.stringify(probe))
  ok(probe.err.bg !== probe.plain.bg && probe.err.color !== probe.plain.color,
    `.err 变体有独立配色（普通 ${probe.plain.bg}/${probe.plain.color} → err ${probe.err.bg}/${probe.err.color}）`)
  ok(probe.err.h === probe.plain.h && probe.err.fs === probe.plain.fs && probe.err.r === probe.plain.r,
    `.err 与普通徽标同尺寸（高 ${probe.err.h} 字号 ${probe.err.fs} 半径 ${probe.err.r}）`)

  /* ══ 6. 五视口容量：本轮加宽了 3 个控件，必须确认没有把工具栏挤成两行 ══ */
  console.log('\n═══ 五视口容量（工具行变宽后是否换行）═══')
  const cap = []
  for (const w of [1280, 1366, 1440, 1512, 1680, 1920]) {
    await page.setViewport({ width: w, height: 950, deviceScaleFactor: 1 })
    await sleep(450)
    const m = await page.evaluate(() => {
      const box = el => {
        if (!el) return null
        const r = el.getBoundingClientRect(), kids = [...el.children]
        const top = kids.length ? Math.min(...kids.map(k => k.getBoundingClientRect().top)) : r.top
        const bot = kids.length ? Math.max(...kids.map(k => k.getBoundingClientRect().bottom)) : r.bottom
        return { h: Math.round(r.height), span: Math.round(bot - top), w: Math.round(r.width) }
      }
      return { tb: box(document.querySelector('.toolbar')),
        row: box([...document.querySelectorAll('.grid-ctl-row')].find(x => x.getBoundingClientRect().height > 0)) }
    })
    cap.push(`${w}: toolbar=${m.tb && m.tb.h}px row=${m.row && m.row.h}px/${m.row && m.row.w}`)
    ok(m.tb && m.tb.h <= 70, `主工具栏 @${w} 仍单行（高 ${m.tb && m.tb.h}px）`)
    ok(m.row && m.row.h <= 44, `表格工具行 @${w} 仍单行（高 ${m.row && m.row.h}px）`)
    if (w === 1440) await page.screenshot({ path: SHOT })
  }
  console.log('  容量：' + cap.join('  |  '))

  /* ══ 7. 编辑态：.tb-edit-group 是 flex:0 0 100%，**本就刻意独占第二行**，
        所以判据不是「是否两行」而是三件事：
          (a) 第一行仍单行；(b) 组内 5 个按钮同排；(c) 「查错」徽标出现时（+24px）也不溢出。
        (c) 是本轮唯一新增宽度，必须用「实测占用 + 徽标宽 ≤ 可用宽」正面证明，而非等它换行。 */
  console.log('\n═══ 编辑态（改单）· 第一行 / 编辑组 行数 ═══')
  await page.setViewport({ width: 1280, height: 950, deviceScaleFactor: 1 })
  await sleep(400)
  const entered = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').trim() === '改单')
    if (!b) return false
    b.click(); return true
  })
  await sleep(2400)
  ok(entered, '已进入编辑态（点「改单」）')
  const probeEdit = () => page.evaluate(() => {
    const tb = document.querySelector('.toolbar')
    if (!tb) return null
    const eg = tb.querySelector('.tb-edit-group')
    const lines = els => els.length ? new Set(els.map(k => Math.round(k.getBoundingClientRect().top / 6))).size : 0
    const sel = 'button, select, input, .tb-toggle, .chip, .tb-pop'
    const main = [...tb.querySelectorAll(sel)].filter(k => !eg || !eg.contains(k))
    const inEg = eg ? [...eg.querySelectorAll('button')] : []
    const er = inEg.find(b => (b.textContent || '').includes('查错'))
    const cs = getComputedStyle(tb)
    const rects = inEg.map(b => b.getBoundingClientRect())
    return {
      h: Math.round(tb.getBoundingClientRect().height),
      linesMain: lines(main), linesEdit: lines(inEg), editCount: inEg.length,
      egSum: rects.length ? Math.round(Math.max(...rects.map(r => r.right)) - Math.min(...rects.map(r => r.left))) : null,
      avail: Math.round(tb.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)),
      errW: er ? Math.round(er.getBoundingClientRect().width) : null,
      errTxt: er ? er.textContent.trim().replace(/\s+/g, ' ') : null,
    }
  })
  for (const w of [1280, 1440, 1680]) {
    await page.setViewport({ width: w, height: 950, deviceScaleFactor: 1 })
    await sleep(450)
    const m = await probeEdit()
    console.log(`  @${w}: toolbar=${m.h}px  首行=${m.linesMain}行  编辑组=${m.editCount}按钮/${m.linesEdit}行`
      + `  组占用=${m.egSum}px  可用=${m.avail}px  余量=${m.avail - m.egSum}px  查错=${m.errW}px「${m.errTxt}」`)
    ok(m.linesMain === 1, `编辑态首行 @${w} 单行（${m.linesMain} 行）`)
    ok(m.linesEdit === 1 && m.editCount === 5, `编辑组 @${w} 5 个按钮同排（${m.editCount} 个 / ${m.linesEdit} 行）`)
    ok(m.egSum + 24 <= m.avail,
      `编辑组即使加上「查错」徽标(+24px) 也不溢出 @${w}（${m.egSum}+24 ≤ ${m.avail}）`)
    if (w === 1440) await page.screenshot({ path: SHOT.replace(/\.png$/, '-edit.png') })
  }

  console.log('\n截图：' + SHOT)
  console.log('CONSOLE_ERRORS:', JSON.stringify(errs.slice(0, 6)))
  console.log('HTTP>=400:', JSON.stringify(bad.slice(0, 6)))
  console.log('\n结果：PASS=' + PASS + ' FAIL=' + FAIL)

  await browser.close()
  process.exit(FAIL ? 1 : 0)
})()
