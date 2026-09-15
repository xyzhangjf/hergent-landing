// v166「修改日志」真机验证：入口可达性 + 面板四段式 + 工具栏容量（含单变量对照）
// 用一次性隔离租户 9999 的令牌（写侧已由 audit_log_e2e_http.py 验完），只读本页。
const puppeteer = require('puppeteer-core')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = 'https://hergent.cn'
const TOKEN = process.env.HG_TOKEN
const TENANT = process.env.HG_TENANT || '9999'

let PASS = 0, FAIL = 0
const ok = (c, m) => { c ? (PASS++, console.log('  PASS  ' + m)) : (FAIL++, console.log('  FAIL  ' + m)) }

;(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--force-device-scale-factor=1'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1680, height: 950, deviceScaleFactor: 1 })
  const errs = []
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message))
  const bad = []
  page.on('response', r => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url().slice(0, 110)) })

  await page.evaluateOnNewDocument((t, ten) => {
    localStorage.setItem('hergent_v2_token', t)
    localStorage.setItem('hergent_v2_tenant', String(ten))
    localStorage.setItem('hergent_v2_user', JSON.stringify({ role: 'boss', username: 'e2e', display_name: '王翠花' }))
  }, TOKEN, TENANT)

  await page.goto(`${BASE}/?cb=${Date.now()}#/forecast`, { waitUntil: 'networkidle2', timeout: 60000 })
  await new Promise(r => setTimeout(r, 4500))
  console.log('URL:', page.url())
  ok(!/#\/login/.test(page.url()), '登录态注入成功（未被守卫弹回 /#/login）')

  // ── 选期次（沙箱期 A）─────────────────────────────────
  const picked = await page.evaluate(() => {
    const sel = document.querySelector('.toolbar .sel-period')
    if (!sel) return null
    // 取编号最大的那一期（每跑一轮 E2E 都会新建一期，旧的留痕是旧格式，会污染断言）
    const opts = [...sel.options].filter(o => /E2E留痕期A/.test(o.textContent))
      .sort((a, b) => Number(b.value) - Number(a.value))
    const opt = opts[0]
    if (!opt) return { opts: [...sel.options].map(o => o.textContent) }
    sel.value = opt.value
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    return { value: opt.value, name: opt.textContent }
  })
  ok(picked && picked.name, `选中沙箱期次：${JSON.stringify(picked)}`)
  await new Promise(r => setTimeout(r, 3500))

  // ── 1. 入口：非编辑态就要看得见（v166 最终落点 = 汇总表视图切换行）──
  const entry = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('body button')]
    const hit = btns.filter(b => (b.textContent || '').includes('修改日志'))
    const b = hit[0]
    if (!b) return { found: 0, all: btns.map(x => (x.textContent || '').trim()).filter(Boolean).slice(0, 40) }
    const r = b.getBoundingClientRect()
    const cs = getComputedStyle(b)
    return {
      found: hit.length,
      text: b.textContent.trim(),
      visible: r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden',
      enabled: !b.disabled,
      group: b.closest('.view-seg-row') ? 'view-seg-row' : (b.closest('.tb-group') ? b.closest('.tb-group').className : ''),
      inToolbar: !!b.closest('.toolbar'),
      rowH: b.closest('.view-seg-row') ? Math.round(b.closest('.view-seg-row').getBoundingClientRect().height) : null,
      hasTooltip: !!b.getAttribute('title'),
      y: Math.round(r.top),
      w: Math.round(r.width),
    }
  })
  ok(entry.found >= 1, `页面上有「修改日志」按钮（得到 ${entry.found} 个）`)
  ok(entry.visible, `按钮可见：${entry.text}（${entry.w}px）`)
  ok(entry.enabled, '选了期次后按钮可点（非 disabled）')
  ok(entry.group === 'view-seg-row', `落在汇总表视图切换行（${entry.group}）`)
  ok(entry.inToolbar === false, '未占用主工具栏（1280 只剩 22px，带字按钮会挤成两行）')
  ok(entry.hasTooltip, '带 title 提示（说明它记录哪些动作）')
  ok(!(entry.all || []).some(t => t === '审计'), '「审计」旧文案已消失')

  // ── 2. 点击 → 面板四段式 ──────────────────────────────
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').includes('修改日志'))
    b.click()
  })
  await new Promise(r => setTimeout(r, 1200))
  const panel = await page.evaluate(() => {
    const panels = [...document.querySelectorAll('.info-panel')]
    const el = panels.find(p => (p.textContent || '').includes('修改日志'))
    if (!el) return { open: false, panels: panels.map(p => (p.querySelector('.panel-hd') || {}).textContent || '') }
    const lis = [...el.querySelectorAll('.at-log li')].map(li => li.innerText.replace(/\s+/g, ' ').trim())
    const acts = [...el.querySelectorAll('.at-log .at-act')].map(x => x.textContent.trim())
    const whos = [...el.querySelectorAll('.at-log .at-who')].map(x => x.textContent.trim())
    const times = [...el.querySelectorAll('.at-log .at-time')].map(x => x.textContent.trim())
    const gh = el.querySelector('.at-global-hd')
    return {
      open: true, title: el.querySelector('.panel-hd b').innerText.trim(), lis, acts, whos, times,
      globalHeader: gh ? gh.innerText.replace(/\s+/g, ' ').trim() : null,
      globalExpandable: !!gh,
      globalOpenByDefault: !!el.querySelector('.at-global ul'),
    }
  })
  const lis = panel.lis || []
  ok(panel.open, '点击后面板打开，标题 = ' + panel.title)
  ok(lis.length >= 4, `本期列出 ≥4 条（得到 ${lis.length}）`)
  ok((panel.whos || []).length > 0 && (panel.whos || []).every(w => w === '王翠花'),
     `每条都显示修改人「王翠花」（得到 ${JSON.stringify(panel.whos)}）`)
  ok((panel.times || []).length > 0 && (panel.times || []).every(t => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(t)),
     `时间是可读格式（得到 ${JSON.stringify(panel.times)}）`)
  ok(lis.some(t => /· 保存汇总表 ·/.test(t)) && lis.some(t => /· 导入 ·/.test(t)) && lis.some(t => /· 确认定稿 ·/.test(t)) && lis.some(t => /· 审批通过 ·/.test(t)),
     `动作翻成中文：${JSON.stringify(panel.acts)}`)
  ok(!/保存汇总表 · 保存汇总表/.test(lis[0] || ''), `首条无动作名重复：${lis[0]}`)
  ok(lis.some(t => /状态 → 已通过/.test(t)), '审批明细状态码已中文化（状态 → 已通过）')
  ok(panel.globalExpandable && panel.globalHeader, `有全局操作折叠区：${panel.globalHeader}`)
  ok(panel.globalOpenByDefault === false, '全局区默认折叠（不喧宾夺主）')

  // 展开全局区
  await page.evaluate(() => document.querySelector('.at-global-hd').click())
  await new Promise(r => setTimeout(r, 400))
  const g = await page.evaluate(() => {
    const ul = document.querySelector('.at-global ul')
    return ul ? [...ul.querySelectorAll('li')].map(li => li.innerText.replace(/\s+/g, ' ').trim()) : null
  })
  ok(Array.isArray(g) && g.length >= 1, `展开后可见全局操作 ${g ? g.length : 0} 条`)
  ok(!!g && g.every(t => /厂价闸门/.test(t)), `全局区内容正确：${g && g[g.length - 1]}`)

  // ── 2b. 面板与触发按钮的邻近度（别让面板开在屏幕另一端）──
  const prox = await page.evaluate(() => {
    const btn = document.querySelector('.view-seg-row .log-btn')
    const panel = document.querySelector('.audit-log-panel')
    if (!btn || !panel) return null
    const b = btn.getBoundingClientRect(), r = panel.getBoundingClientRect()
    const ul = panel.querySelector('.at-log')
    return {
      gap: Math.round(r.top - b.bottom), btnBottom: Math.round(b.bottom), panelTop: Math.round(r.top),
      docTopGap: Math.round(r.top),
      listScrollable: ul ? ul.scrollHeight > ul.clientHeight : null,
      listH: ul ? Math.round(ul.getBoundingClientRect().height) : null,
    }
  })
  ok(!!prox && prox.gap >= -20 && prox.gap <= 120,
     `面板紧贴触发按钮下方（间距 ${prox && prox.gap}px；按钮底 ${prox && prox.btnBottom} → 面板顶 ${prox && prox.panelTop}）`)
  ok(prox && prox.listH <= 305, `长列表内部滚动（列表高 ${prox && prox.listH}px，上限 300）`)

  // ── 3. 工具栏容量：单变量对照（去掉新按钮再量）─────────
  console.log('\n【容量】工具栏单行是否被破坏 / 切换行加按钮前后高度 / 提示文字行数')
  const cap = []
  for (const vw of [1280, 1366, 1440, 1680, 1920]) {
    await page.setViewport({ width: vw, height: 950, deviceScaleFactor: 1 })
    await new Promise(r => setTimeout(r, 500))
    const m = await page.evaluate(() => {
      const tb = document.querySelector('.toolbar')
      const row = document.querySelector('.view-seg-row')
      const b = document.querySelector('.view-seg-row .log-btn')
      const tip = document.querySelector('.view-seg-row .view-seg-tip')
      const withBtn = Math.round(tb.getBoundingClientRect().height)
      const rowWith = row ? Math.round(row.getBoundingClientRect().height) : null
      const tipLinesWith = tip ? Math.round(tip.getBoundingClientRect().height / (parseFloat(getComputedStyle(tip).lineHeight) || 18)) : null
      const prev = b.style.display
      b.style.display = 'none'
      const rowWithout = Math.round(row.getBoundingClientRect().height)
      const tipLinesWithout = Math.round(tip.getBoundingClientRect().height / (parseFloat(getComputedStyle(tip).lineHeight) || 18))
      b.style.display = prev
      return { tbH: withBtn, rowWith, rowWithout, tipLinesWith, tipLinesWithout, content: Math.round(tb.getBoundingClientRect().width - 32) }
    })
    cap.push({ vw, ...m })
    console.log(`   ${vw}px: 工具栏单行高 ${m.tbH}px（内宽 ${m.content}）| 切换行 含按钮 ${m.rowWith}px / 去掉后 ${m.rowWithout}px | 提示文字 ${m.tipLinesWith} 行 / 原 ${m.tipLinesWithout} 行`)
  }
  ok(cap.every(c => c.tbH <= 72),
     `工具栏在五个视口仍为单行（≤72px）：${cap.map(c => c.vw + ':' + c.tbH).join(' ')}`)
  ok(cap.every(c => c.rowWith <= c.rowWithout + 60),
     `切换行未因加按钮翻倍变高：${cap.map(c => c.vw + ':' + c.rowWith + '/' + c.rowWithout).join(' ')}`)
  ok(cap.every(c => c.tipLinesWith <= 2),
     `提示文字最多 2 行：${cap.map(c => c.vw + ':' + c.tipLinesWith).join(' ')}`)

  console.log('\nCONSOLE_ERRORS:', JSON.stringify(errs.filter(e => !/403/.test(e))))
  console.log('HTTP>=400:', JSON.stringify([...new Set(bad)]))
  await page.screenshot({ path: '/tmp/audit-log-panel.png', fullPage: false })
  console.log(`\n结果：PASS=${PASS} FAIL=${FAIL}`)
  await browser.close()
  process.exit(FAIL ? 1 : 0)
})()
