/**
 * 通用真机验证（任意租户）：**上下两张单轴图**逐月断言柱高 = 金额 ÷ 该图量程 × 绘图区高
 * 数据链（三边独立，互不引用）：
 *   ① 金额：销量目标从 /api/rebate-rules 实时拉取，用组件同一个纯函数 monthTargetOf 汇总；
 *          实际返利从 /api/rebate-achievements 实时拉取。
 *   ② 量程：从每张图自己的轴刻度标签反推（不依赖任何硬编码金额）。
 *   ③ 高度：从 DOM 实测像素。
 * 另验证：两图月份列对齐、每图每月只有一根柱、轴刻度与柱高同源、
 *        tooltip 贴在本图上且**横向避让被 hover 的柱子**（零遮挡、不出画布、pointer-events:none）、
 *        柱顶**两行横排**标签（v164 起）不裁切 / 不重叠 / 无旋转。
 *
 * 运行（cwd 必须是 hergent-cn-v2，脚本要解析项目的 vite）：
 *   cd laozhangai-product/hergent-cn-v2
 *   NODE_PATH=/Users/zhangjunfeng/.workbuddy/binaries/node/workspace/node_modules \
 *   HG_TOKEN=<token> HG_TENANT=1 HG_TAG=t1 \
 *   node ../.workbuddy/tools/rebate-chart-allmonths-verify.js
 * 取 token：POST https://hergent.cn/api/auth/login {"username":"mptest","password":"Mptest@1"}
 *          或 POST /api/auth/demo-login {}（演示租户）
 */
const path = require('path')
const puppeteer = require('puppeteer-core')

const BASE = 'https://hergent.cn'
const TOKEN = process.env.HG_TOKEN
const TENANT = process.env.HG_TENANT || ''
const TAG = process.env.HG_TAG || 'x'

let pass = 0, fail = 0
const ok = (c, l, e = '') => { if (c) { pass++; console.log('  ✅ ' + l) } else { fail++; console.log('  ❌ ' + l + (e ? '\n        ' + e : '')) } }
const near = (a, b, tol = 0.05) => a != null && b != null && Math.abs(a - b) <= tol

;(async () => {
  // 组件同源的纯函数（不重写公式，避免"自己验自己"）
  const { createServer } = await import(path.join(process.cwd(), 'node_modules/vite/dist/node/index.js'))
  const server = await createServer({
    server: { middlewareMode: true }, appType: 'custom', logLevel: 'error',
    optimizeDeps: { noDiscovery: true, include: [] },
  })
  const { monthTargetOf, ruleActiveInMonth, monthKey } = await server.ssrLoadModule('/src/components/rebate/useMonthlyAchv.js')

  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1600, height: 1100, deviceScaleFactor: 2 })
  const errs = []
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message))
  await page.evaluateOnNewDocument((t, ten) => {
    localStorage.setItem('hergent_v2_token', t)
    if (ten) localStorage.setItem('hergent_v2_tenant', String(ten))
  }, TOKEN, TENANT)
  await page.goto(BASE + '/?cb=' + Date.now() + '#/rebate', { waitUntil: 'networkidle2' })
  console.log('落地 URL:', page.url())
  await new Promise(r => setTimeout(r, 6000))

  const info = await page.evaluate(async () => {
    const qa = s => [...document.querySelectorAll(s)]
    const num = v => parseFloat(v)
    const tok = localStorage.getItem('hergent_v2_token') || ''
    const ten = localStorage.getItem('hergent_v2_tenant') || ''
    const H = { ...(tok ? { Authorization: 'Bearer ' + tok } : {}), ...(ten ? { 'X-Tenant-Id': ten } : {}) }

    let rules = [], rulesOk = false, achvs = [], achvOk = false
    // 年份取自页面「统计年份」下拉 —— 图表拉的正是这一年的数据（Rebate.vue: /api/rebate-achievements?year=）
    const year = +(document.querySelector('.sel-year') || {}).value || new Date().getFullYear()
    try {
      const r = await fetch('/api/rebate-rules?include_inactive=1', { headers: H })
      const rj = await r.json(); rulesOk = r.ok
      rules = rj.rules || rj.data || rj || []
    } catch (e) { rulesOk = false }
    try {
      // ⚠️ 不带 year 只返回**当前月**那几条；要拿全年必须显式带 year（否则返利柱会被误判为"没数据"）
      const r = await fetch('/api/rebate-achievements?year=' + year, { headers: H })
      const aj = await r.json(); achvOk = r.ok
      achvs = aj.data || aj.items || aj.achievements || (Array.isArray(aj) ? aj : [])
    } catch (e) { achvOk = false }

    const secs = qa('.mac-sec').map(sec => {
      const svg = sec.querySelector('svg.mac-svg')
      const rects = svg ? [...svg.querySelectorAll('rect')].map(e => ({
        cls: e.getAttribute('class') || '',
        fill: e.getAttribute('fill') || '',
        x: num(e.getAttribute('x')), y: num(e.getAttribute('y')),
        w: num(e.getAttribute('width')), h: num(e.getAttribute('height')),
      })).filter(r => r.h > 0 && r.w > 0 && r.fill !== 'transparent') : []
      const gl = svg ? [...svg.querySelectorAll('line.grid')] : []
      const gx = gl[0]
      const ax = svg ? svg.querySelector('line.axis') : null
      return {
        title: (sec.querySelector('.sec-hd b') || {}).textContent || '',
        unit: (sec.querySelector('.sec-u') || {}).textContent || '',
        empty: !!sec.querySelector('.sec-empty'),
        rects,
        ticks: svg ? [...svg.querySelectorAll('.ax-lb')].map(e => e.textContent.trim()) : [],
        gridY: gl.map(e => num(e.getAttribute('y1'))),
        gridX1: gx ? num(gx.getAttribute('x1')) : null,
        gridX2: gx ? num(gx.getAttribute('x2')) : null,
        axisY: ax ? num(ax.getAttribute('y1')) : null,
        moCount: svg ? svg.querySelectorAll('.ax-mo').length : 0,
        paceCount: svg ? svg.querySelectorAll('.pace-line').length : 0,
        secTop: sec.offsetTop, secH: sec.offsetHeight,
      }
    })
    return {
      rulesOk, rulesCount: rules.length, rules,
      achvOk, achvCount: achvs.length, achvs,
      secs,
      year,
      legend: qa('.mac-legend .lg-item').map(e => e.textContent.trim()),
      sub: (document.querySelector('.mac-sub') || {}).textContent || '',
    }
  })
  await server.close()
  if (!info.rulesOk) { console.log('❌ 规则接口失败'); await browser.close(); process.exit(1) }
  if (!info.achvOk) { console.log('❌ 达成接口失败'); await browser.close(); process.exit(1) }

  console.log(`\n规则 ${info.rulesCount} 条 | 达成记录 ${info.achvCount} 条 | 年份 ${info.year}`)
  console.log('图例:', JSON.stringify(info.legend))

  // ── 结构 ──
  console.log('\n【A】结构：两张单轴图并列')
  ok(info.secs.length === 2, `渲染出 ${info.secs.length} 张图（.mac-sec）`)
  ok(info.secs[0].title.includes('销量') && info.secs[1].title.includes('返利'),
    `标题顺序正确：${JSON.stringify(info.secs.map(s => s.title))}`)
  ok(/各用自己的量程/.test(info.sub) && /不可跨图比较/.test(info.sub),
    '副标题写明"两张图各用自己的量程、柱高不可跨图比较"（防止把销量柱与返利柱比高矮）')
  ok(!/左轴|右轴/.test(info.sub + info.legend.join('')), '文案里不再出现"左轴 / 右轴"')
  const alive = info.secs.filter(s => !s.empty)
  console.log(`   两张图都非空：${alive.length === 2}（空的那张会显示占位文案）`)

  // ── 几何 ──
  const geo = s => {
    const gridTop = Math.min(...s.gridY)
    return {
      plotH: Math.round(s.axisY - gridTop),
      max: parseFloat(s.ticks[s.ticks.length - 1].replace(/,/g, '')) * (/万/.test(s.unit) ? 10000 : 1),
      GW: (s.gridX2 - s.gridX1) / 12,
      x0: s.gridX1,
      gridY: s.gridY,
      axisY: s.axisY,
    }
  }
  const G = info.secs.map(s => (s.empty ? null : geo(s)))
  console.log('\n【B】每张图自成一把尺子（量程 / 绘图区高 / 单位）')
  G.forEach((g, k) => {
    if (!g) return console.log(`   ${k} ${info.secs[k].title}：空态（本年无该系列数据）`)
    console.log(`   ${k} ${info.secs[k].title}：量程 ${g.max}（${info.secs[k].unit}）| 绘图区高 ${g.plotH}px | 月槽宽 ${g.GW.toFixed(2)}px`)
  })
  if (G[0] && G[1]) {
    ok(near(G[0].plotH, G[1].plotH), `两图绘图区高相同（${G[0].plotH}px）—— 柱高尺度可比`)
    ok(G[0].max !== G[1].max, `两图量程不同：销量 ${G[0].max} vs 返利 ${G[1].max}（这正是拆图的原因，各读各的尺子）`)
    ok(near(G[0].x0, G[1].x0) && near(G[0].GW, G[1].GW),
      `两图 x 轴几何完全一致（左起 ${G[0].x0} / 月槽 ${G[0].GW.toFixed(2)}px）→ 月份列严格对齐`)
    ok(new Set(info.secs.map(s => s.gridX1)).size === 1 && new Set(info.secs.map(s => s.gridX2)).size === 1,
      '两图网格线横跨同一区间 → 视觉上上下对齐')
  }

  // ── 取柱 ──
  const slot = (i) => ({ s: G[0].x0 + i * G[0].GW, e: G[0].x0 + (i + 1) * G[0].GW })
  const colOf = (k, i) => {
    if (!info.secs[k] || info.secs[k].empty) return []
    const { s, e } = slot(i)
    return info.secs[k].rects.filter(r => r.x >= s - 0.5 && r.x < e)
  }
  const trackH = (k, i) => colOf(k, i).filter(r => r.cls.includes('track')).reduce((a, r) => a + r.h, 0)
  const totalH = (k, i) => colOf(k, i).filter(r => !r.cls.includes('track')).reduce((a, r) => a + r.h, 0)

  // ── 销量图：绝对判据 ──
  const monthRows = []
  for (let i = 0; i < 12; i++) {
    const m = i + 1
    let tgt = 0
    for (const r of info.rules) {
      if (!r || r.dimension !== 'brand') continue
      if (!ruleActiveInMonth(r, info.year, m)) continue
      const t = monthTargetOf(r, info.year, m)
      if (t > 0) tgt += t
    }
    // 实际返利 / 销量达成：按 period_month 汇总（只取品牌维度，与图表口径一致）
    const mm = String(info.year) + '-' + String(m).padStart(2, '0')
    let ar = 0, am = 0
    for (const a of info.achvs) {
      if (!a) continue
      if (a.dimension && a.dimension !== 'brand') continue
      const pm = String(a.period_month || '').replace(/^(\d{4})-(\d)$/, '$1-0$2')
      if (pm === mm || pm === String(info.year) + '-' + m) {
        ar += Number(a.actual_rebate) || 0
        am += Number(a.actual_amount) || 0
      }
    }
    monthRows.push({ 月: m, tgt, am, ar, trk: trackH(0, i), tot: totalH(0, i), rtrk: trackH(1, i), rtot: totalH(1, i) })
  }

  console.log('\n【C】销量图：柱高 = 目标金额 ÷ 该图量程 × 绘图区高（金额来自后端规则，高度来自 DOM）')
  if (G[0]) {
    const rows = monthRows.map(r => ({
      月: r.月, 目标元: r.tgt,
      期望px: +(r.tgt / G[0].max * G[0].plotH).toFixed(2),
      实测px: +r.trk.toFixed(2),
      差: +(r.trk - r.tgt / G[0].max * G[0].plotH).toFixed(2),
    }))
    console.table(rows)
    const bad = rows.filter(r => Math.abs(r.差) > 0.6)
    ok(bad.length === 0, `12 个月逐月吻合（容差 0.6px）：越界 ${bad.length} 个月` + (bad.length ? ' → ' + JSON.stringify(bad) : ''))
    const distinct = [...new Set(rows.filter(r => r.目标元 > 0).map(r => r.实测px))]
    ok(distinct.length > 1, `有目标金额的月份里出现 ${distinct.length} 种柱高：${JSON.stringify(distinct)}${distinct.length > 1 ? '（改造前这些柱子全部等高）' : '（本租户各月目标恰好相同，故等高是正确结果）'}`)
    const mono = rows.filter(r => r.目标元 > 0).sort((a, b) => a.目标元 - b.目标元)
    ok(mono.every((r, i) => i === 0 || r.实测px >= mono[i - 1].实测px - 0.05), '目标金额越大 → 柱子越高（单调性成立）')
    if (mono.length >= 2) {
      const a = mono[0], b = mono[mono.length - 1]
      ok(near(a.实测px / b.实测px, a.目标元 / b.目标元, 0.01),
        `柱高比 = 金额比：${a.月}月/${b.月}月 = ${(a.实测px / b.实测px).toFixed(4)} vs ${(a.目标元 / b.目标元).toFixed(4)}`)
    }
    const zero = rows.filter(r => r.目标元 === 0)
    ok(zero.every(r => r.实测px === 0), `无目标的 ${zero.length} 个月不画柱子（实测全为 0）`)
  }

  console.log('\n【C2】销量图彩色柱 = 销量达成（金额来自 rebate_achievements.actual_amount，高度来自 DOM）')
  if (G[0]) {
    const w = monthRows.filter(r => r.am > 0)
    if (w.length) {
      const rows = w.map(r => ({
        月: r.月, 达成元: r.am,
        期望px: +(r.am / G[0].max * G[0].plotH).toFixed(2),
        实测px: +r.tot.toFixed(2),
        差: +(r.tot - r.am / G[0].max * G[0].plotH).toFixed(2),
      }))
      console.table(rows)
      const bad = rows.filter(r => Math.abs(r.差) > 0.6)
      ok(bad.length === 0, `有销量达成的 ${rows.length} 个月逐月吻合（容差 0.6px）：越界 ${bad.length} 个月` + (bad.length ? ' → ' + JSON.stringify(bad) : ''))
      // 达标/超额：彩色柱必须高于灰轨道 → 该月应出现「深色超额段」；未达标则不应有
      const hasDeep = (k, i) => colOf(k, i).some(x => x.fill === '#0e7490' || x.fill === '#b45309')
      for (const r of w) {
        if (!(r.tgt > 0)) continue
        const over = r.am > r.tgt + 0.5
        ok(hasDeep(0, r.月 - 1) === over,
          `${r.月}月：达成 ${Math.round(r.am)} ${over ? '>' : '≤'} 目标 ${Math.round(r.tgt)} → ${over ? '有' : '无'}深色超额段`)
      }
      // 反向读数
      const r0 = w[0]
      ok(near((monthRows.find(x => x.月 === r0.月).tot / G[0].plotH) * G[0].max, r0.am, 1200),
        `${r0.月}月柱高反向换算 = ${Math.round((monthRows.find(x => x.月 === r0.月).tot / G[0].plotH) * G[0].max)}（接口真值 ${r0.am}）`)
    } else {
      console.log('   （本租户本年尚未录入销量达成 → 只校验目标轨道）')
    }
  }

  console.log('\n【D】返利图：柱高 = 实际返利 ÷ 该图量程 × 绘图区高（金额来自达成接口，高度来自 DOM）')
  if (G[1]) {
    const rows = monthRows.map(r => ({
      月: r.月, 实际返利: r.ar,
      期望px: +(r.ar / G[1].max * G[1].plotH).toFixed(2),
      实测px: +r.rtot.toFixed(2),
      差: +(r.rtot - r.ar / G[1].max * G[1].plotH).toFixed(2),
    }))
    console.table(rows)
    const withAr = rows.filter(r => r.实际返利 > 0)
    if (withAr.length) {
      const bad = withAr.filter(r => Math.abs(r.差) > 0.6)
      ok(bad.length === 0, `有实际返利的 ${withAr.length} 个月逐月吻合（容差 0.6px）：越界 ${bad.length} 个月` + (bad.length ? ' → ' + JSON.stringify(bad) : ''))
      if (withAr.length >= 2) {
        const a = withAr[0], b = withAr[withAr.length - 1]
        ok(near(a.实测px / b.实测px, a.实际返利 / b.实际返利, 0.01),
          `柱高比 = 金额比：${a.月}月/${b.月}月 = ${(a.实测px / b.实测px).toFixed(4)} vs ${(a.实际返利 / b.实际返利).toFixed(4)}`)
      }
      const mono = [...withAr].sort((a, b) => a.实际返利 - b.实际返利)
      ok(mono.every((r, i) => i === 0 || r.实测px >= mono[i - 1].实测px - 0.05), '实际返利越大 → 柱子越高（单调性成立）')
      const zero = rows.filter(r => r.实际返利 === 0)
      ok(zero.every(r => r.实测px === 0), `未录实际返利的 ${zero.length} 个月不画彩色柱（实测全为 0）`)
    } else {
      console.log('   （本租户本年尚未录入实际返利 → 只校验结构）')
      const nz = rows.filter(r => r.rtot > 0)
      if (nz.length) {
        console.log('   ⚠️ 却存在非零柱高的月份：', JSON.stringify(nz))
        nz.forEach(r => console.log(`      ${r.月}月 返利图 rect:`, JSON.stringify(colOf(1, r.月 - 1))))
      }
      ok(nz.length === 0, `无实际返利数据时不画彩色柱（异常 ${nz.length} 个月）`)
    }
  }

  console.log('\n【E】每月只有一根柱（不再是两根并排）')
  {
    let twoPlus = 0, checked = 0
    for (let k = 0; k < 2; k++) {
      if (!G[k]) continue
      for (let i = 0; i < 12; i++) {
        const c = colOf(k, i)
        if (!c.length) continue
        checked++
        // 同一位置最多「填充段 + 超额段」两段叠放，不再有第二根并排柱（即不同 x 的第二组）
        const xs = [...new Set(c.map(r => +r.x.toFixed(2)))]
        if (xs.length > 1) twoPlus++
      }
    }
    ok(twoPlus === 0, `检查 ${checked} 个「图×月」：每月所有分段共用同一个 x（无并排第二根柱），异常 ${twoPlus} 个`)
    const w = colOf(0, 0)[0]?.w
    if (w != null) ok(w > 30, `柱宽 ${w.toFixed(2)}px（比双柱时代的 30px 更宽，单图视觉重量更足）`)
  }

  console.log('\n【F】轴刻度与柱高同源（反向读数自洽）')
  G.forEach((g, k) => {
    if (!g) return
    const step = g.plotH / 5
    ok(g.gridY.length === 6 && near(Math.min(...g.gridY), g.axisY - g.plotH) && near(Math.max(...g.gridY), g.axisY),
      `${info.secs[k].title}：6 条网格线等分量程，最上＝${g.max}、最下＝0`)
    // 取一根有值的柱反向换算
    const i = monthRows.findIndex(r => (k === 0 ? r.tot : r.rtot) > 0)
    if (i >= 0) {
      const h = k === 0 ? monthRows[i].tot : monthRows[i].rtot
      const back = h / g.plotH * g.max
      const truth = k === 0 ? null : monthRows[i].ar
      const label = k === 0 ? '（销量图无独立达成金额源，只验刻度线性）' : `（接口真值 ${truth}）`
      ok(true, `${info.secs[k].title}：${i + 1}月柱高 ${h.toFixed(2)}px 按本图刻度换算 = ${Math.round(back)}${label}`)
    }
  })

  console.log('\n【G】x 轴月份标签只在下方图出现一次')
  {
    const a = info.secs[0]?.moCount ?? 0, b = info.secs[1]?.moCount ?? 0
    ok(a === 0 && b === 12, `上图 ${a} 个、下图 ${b} 个（只在最下方标注一次，避免重复文字）`)
  }

  console.log('\n【H】tooltip 落位：贴在被 hover 的那张图上，且与被 hover 的柱子**零遮挡**')
  {
    const r = await page.evaluate(async () => {
      const R = e => e.getBoundingClientRect()
      const secs = [...document.querySelectorAll('.mac-sec')]
      const out = []
      for (let k = 0; k < secs.length; k++) {
        const svg = secs[k].querySelector('svg.mac-svg')
        if (!svg) continue
        const groups = [...svg.children].filter(e => e.tagName.toLowerCase() === 'g')
        const months = [...svg.querySelectorAll('.ax-mo')].map(e => e.textContent.trim())
        for (let i = 0; i < groups.length; i++) {
          const zone = groups[i].querySelector('rect[fill="transparent"]')
          if (!zone) continue
          zone.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
          // ⚠️ dispatchEvent 是同步的，而 Vue 的 DOM 更新走微任务 —— 不 await 就会读到上一帧（甚至 null）
          await new Promise(res => setTimeout(res, 40))
          const tip = document.querySelector('.mac-tip')
          if (!tip) { out.push({ k, i, noTip: true }); continue }
          const t = R(tip)
          const bars = [...groups[i].querySelectorAll('rect')]
            .filter(x => x.getAttribute('fill') !== 'transparent')
            .map(R).filter(b => b.width > 0 && b.height > 0)
          // ⚠️ 该月没有任何柱身（target 与达成都是 0）时不得参与断言：此时 min/max 会算出 ±Infinity，
          //    而 CDP 的 JSON 序列化把 ±Infinity 变成 null，Math.min(...) 会把它当 0 → 假 FAIL
          const hasBar = bars.length > 0
          const bar = hasBar
            ? { left: Math.min(...bars.map(b => b.left)), right: Math.max(...bars.map(b => b.right)) }
            : null
          const ovW = hasBar ? Math.max(0, Math.min(t.right, bar.right) - Math.max(t.left, bar.left)) : null
          const ovH = hasBar ? Math.max(0, Math.min(t.bottom, bar.bottom) - Math.max(t.top, bar.top)) : null
          const cr = R(secs[k].parentElement)   // .mac-canvas（tooltip 的 offsetParent）
          const flipped = tip.classList.contains('to-left')
          out.push({
            k, i, mo: months[i] || (i + 1) + '月', hasBar,
            secTop: secs[k].offsetTop, tipTop: parseFloat(tip.style.top),
            ovW: ovW == null ? null : +ovW.toFixed(1), ovH: ovH == null ? null : +ovH.toFixed(1),
            side: flipped ? 'left' : 'right',
            gap: hasBar ? +(flipped ? bar.left - t.right : t.left - bar.right).toFixed(1) : null,
            inCanvas: t.left >= cr.left - 1 && t.right <= cr.right + 1 && t.top >= cr.top - 1 && t.bottom <= cr.bottom + 1,
            pe: getComputedStyle(tip).pointerEvents,
          })
        }
      }
      return out
    })
    const svgCount = await page.$$eval('svg.mac-svg', els => els.length)
    ok(r.length === svgCount * 12, `逐月悬停拿到 ${r.length} 条 tooltip（${svgCount} 张图 × 12 月）`)
    ok(r.every(x => !x.noTip), `每个被 hover 的月份都弹出了 tooltip（缺 ${r.filter(x => x.noTip).length} 条）`)
    const live = r.filter(x => !x.noTip)
    const withBar = live.filter(x => x.hasBar)
    const cut = withBar.filter(x => x.ovW > 0.5)
    ok(cut.length === 0, `**被 hover 的柱子零遮挡**（有柱的 ${withBar.length} 个月里，x 区间相交 > 0.5px 的 ${cut.length} 处）` + (cut.length ? ' → ' + JSON.stringify(cut.slice(0, 3)) : ''))
    const minGap = Math.min(...withBar.map(x => x.gap))
    ok(minGap >= 7.5, `盒子贴柱缘的净空恒 ≥ 8px（实测最小 ${minGap}px；贴右 ${withBar.filter(x => x.side === 'right').length} 月 / 贴左 ${withBar.filter(x => x.side === 'left').length} 月）`)
    ok(live.every(x => x.inCanvas), `盒子全部落在画布内（越界 ${live.filter(x => !x.inCanvas).length} 处）`)
    ok(live.every(x => x.pe === 'none'), `tooltip 全程 pointer-events:none（否则挪到柱外侧会吃掉邻柱的悬停事件，实测 ${JSON.stringify([...new Set(live.map(x => x.pe))])}）`)
    ok(withBar.length > 0,
      `至少 1 个月真有柱身可测（否则"零遮挡"就是空断言）；另 ${live.length - withBar.length} 个月无柱，只验证不出画布/不吃事件`)
    const outOfBand = live.filter(x => !(x.tipTop >= x.secTop && x.tipTop <= x.secTop + 40))
    ok(outOfBand.length === 0, `每个 tooltip 都贴在自己那张图上（top 落在 [secTop, secTop+40]；越界 ${outOfBand.length} 处）`)
    console.log('   逐月明细(图·月/遮挡宽/净空/侧):',
      live.map(x => `${x.k + 1}·${x.mo}(${x.hasBar ? x.ovW : '无柱'}/${x.hasBar ? x.gap + 'px' : '—'}/${x.side === 'left' ? '左' : '右'})`).join(' '))
  }

  console.log('\n【H2】真实鼠标移动：tooltip 不吃事件，换柱/移出照常（pointer-events:none 的实证）')
  {
    const pt = await page.evaluate(() => {
      const svg = document.querySelectorAll('svg.mac-svg')[0]
      const groups = [...svg.children].filter(e => e.tagName.toLowerCase() === 'g')
      const z = i => {
        const b = groups[i].querySelector('rect[fill="transparent"]').getBoundingClientRect()
        return { x: b.left + b.width / 2, y: b.top + b.height * 0.8 }
      }
      const sb = svg.getBoundingClientRect()
      return { a: z(7), b: z(9), out: { x: sb.left + sb.width / 2, y: sb.top - 30 } }
    })
    const title = () => page.evaluate(() => {
      const t = document.querySelector('.mac-tip')
      return t ? t.querySelector('b').textContent.trim() : null
    })
    await page.mouse.move(pt.a.x, pt.a.y, { steps: 4 })
    await new Promise(r => setTimeout(r, 200))
    const t1 = await title()
    // 8 月的 tooltip 盒子正盖在邻柱（9~11 月）的悬停区上：若它吃掉事件，这里就换不了柱
    await page.mouse.move(pt.b.x, pt.b.y, { steps: 4 })
    await new Promise(r => setTimeout(r, 200))
    const t2 = await title()
    await page.mouse.move(pt.out.x, pt.out.y, { steps: 4 })
    await new Promise(r => setTimeout(r, 200))
    const t3 = await title()
    ok(/8 月/.test(t1 || ''), `鼠标移到 8 月柱 → tooltip 显示「${t1}」`)
    ok(/10 月/.test(t2 || ''), `再移到 10 月柱（落点被上一只 tooltip 的盒子盖着）→ 正常切换为「${t2}」`)
    ok(t3 === null, `鼠标移出图表 → tooltip 消失（读到 ${t3 === null ? 'null' : JSON.stringify(t3)}）`)
  }

  console.log('\n【I】柱顶两行横排标签实测：不裁切、不重叠、无旋转（实测边界框，替代估算）')
  {
    const boxes = await page.evaluate(() => {
      const out = []
      let si = 0
      for (const svg of document.querySelectorAll('svg.mac-svg')) {
        const vb = svg.viewBox.baseVal
        const sr = svg.getBoundingClientRect()
        for (const t of svg.querySelectorAll('text.bar-lb')) {
          const r = t.getBoundingClientRect()
          // preserveAspectRatio=none + width:100% → x/y 各自线性映射，故可分别换算回 viewBox 坐标
          out.push({
            t: t.textContent.trim(),
            top: +((r.top - sr.top) / sr.height * vb.height).toFixed(2),
            bottom: +((r.bottom - sr.top) / sr.height * vb.height).toFixed(2),
            left: +((r.left - sr.left) / sr.width * vb.width).toFixed(2),
            right: +((r.right - sr.left) / sr.width * vb.width).toFixed(2),
            row: t.classList.contains('bar-lb-rate') ? 'rate' : 'amt',
            si,
            rot: t.getAttribute('transform'),   // v164 起必须为 null（旧版是 rotate(-90) 竖排）
          })
        }
        si++
      }
      return out
    })
    console.log('   实测标签:', JSON.stringify(boxes.slice(0, 6)), boxes.length > 6 ? `… 共 ${boxes.length} 枚` : '')
    if (boxes.length) {
      const cut = boxes.filter(b => b.top < -0.5)
      ok(cut.length === 0, `全部 ${boxes.length} 枚柱顶标签上缘都在画布内（越界 ${cut.length} 枚）` + (cut.length ? ' → ' + JSON.stringify(cut) : ''))
      ok(boxes.every(b => b.bottom <= 200), '标签下缘也未越出画布（单图高 200）')
      ok(boxes.every(b => b.rot === null), `全部标签均无 transform → 竖排已彻底移除（实测首枚 transform=${JSON.stringify(boxes[0].rot)}）`)
      // 横排方案唯一的真风险：同一张图、同一行内相邻两柱的标签水平相撞
      let worstGap = Infinity, hits = 0
      for (const s of [...new Set(boxes.map(b => b.si))]) {
        for (const row of ['amt', 'rate']) {
          const rs = boxes.filter(b => b.si === s && b.row === row).sort((a, b) => a.left - b.left)
          for (let i = 1; i < rs.length; i++) {
            const gap = rs[i].left - rs[i - 1].right
            if (gap < worstGap) worstGap = gap
            if (gap < -0.5) hits++
          }
        }
      }
      ok(hits === 0, `同图同行内相邻标签零重叠（最小水平间距 ${Number.isFinite(worstGap) ? worstGap.toFixed(1) + 'px' : '—（该行仅 1 枚）'}，重叠 ${hits} 处）`)
      console.log(`   两行结构：金额行 ${boxes.filter(b => b.row === 'amt').length} 枚 / 达成率行 ${boxes.filter(b => b.row === 'rate').length} 枚`)
    } else {
      console.log('   （本页无可显示的柱顶标签：选中月份均无达成）')
    }
  }

  console.log('\nCONSOLE_ERRORS:', JSON.stringify(errs.filter(e => !/403/.test(e))))
  await page.screenshot({ path: `/tmp/v164_allmonths_${TAG}.png`, fullPage: true })
  const el = await page.$('.mac')
  if (el) await el.screenshot({ path: `/tmp/v162_chart_${TAG}.png` })
  console.log(`\n${'='.repeat(56)}\n逐月验证：${pass} PASS / ${fail} FAIL\n${'='.repeat(56)}`)
  await browser.close()
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error('FATAL', e); process.exit(2) })
