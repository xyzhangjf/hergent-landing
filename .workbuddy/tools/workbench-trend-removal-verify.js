/* v190 真机验收：「经营工作台」(/workbench) 删除「近 7 天销售趋势」面板
 *
 * ⚠️ 为什么要有这个探针 —— 本轮的判别性风险**不在「删掉没有」，在「删完有没有留白」**：
 *   原布局 today-panel(grid-column:span 8; **grid-row:span 2**) + trend-card(span 4 × 1 行)
 *   ⇒ 第 1 行由 today+trend 拼满，第 2 行 today 独自续占左 8 列、**右 4 列由 trend 顶住**。
 *   只删 trend 的模板/脚本、不动布局，第 2 行右侧就会露出一块 4 列宽的空白
 *   （实测：线上曾出现「trend-card 已从 JS 里消失、但 CSS 仍留着 .trend-card 规则、
 *     expiry-card 仍只占 4 列」的中间状态 ⇒ 真的留白）。
 *
 * 验收四件事：
 *   ① 面板零残留（文案 + 三个类名）
 *   ② 无未捕获异常 / 无与本页相关的 console 报错
 *   ③ 🔴 **无残留空位**（两条几何判据，均不依赖具体实现写法）
 *        a. 两卡并存 ⇒ expiry-card 底边必须与 today-panel 底边对齐（即拉满两行）
 *        b. elementFromPoint 命中测试 ⇒ today-panel 第 2 行右侧的点必须落在卡片内
 *        （任一卡缺失时，改为断言留下那张卡铺满整行）
 *   ④ 其余模块正常（KPI 5 项 / 今日经营要务 / 近效期预警 / AI 晨报）
 *
 * 用法：NODE_PATH=<managed ws>/node_modules node workbench-trend-removal-verify.js
 *   HG_USER / HG_PASS / HG_SHOT_DIR / HG_TAG 可覆盖（HG_TAG 用于 before/after 截图命名）
 */
const puppeteer = require('puppeteer-core')
const fs = require('fs')

const BASE = 'https://hergent.cn'
const USER = process.env.HG_USER || 'mptestsp'
const PASS = process.env.HG_PASS || 'Mpsup@1'
const EXEC = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SHOT = process.env.HG_SHOT_DIR || '/tmp'
const TAG = process.env.HG_TAG || 'run'
const sleep = ms => new Promise(r => setTimeout(r, ms))

let pass = 0, fail = 0
const failures = []
function ok(cond, label, detail) {
  if (cond) { pass++; console.log('  ✅ ' + label) }
  else { fail++; failures.push(label + (detail ? ' — ' + detail : '')); console.log('  ❌ ' + label + (detail ? '  [' + detail + ']' : '')) }
}

async function login() {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS }),
  })
  const d = await r.json()
  if (!d.token) throw new Error('login failed: ' + JSON.stringify(d).slice(0, 200))
  return d
}

;(async () => {
  const sess = await login()
  console.log(`账号 ${USER} · tenant=${sess.tenant_id} · role=${sess.user && sess.user.role} · tag=${TAG}`)

  const browser = await puppeteer.launch({
    executablePath: EXEC, headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1700,1100'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1700, height: 1100 })
  const errs = []
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()) })
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message))
  page.on('dialog', async d => { try { await d.accept() } catch (e) {} })

  await page.evaluateOnNewDocument((t, u, ten) => {
    localStorage.setItem('hergent_v2_token', t)
    localStorage.setItem('hergent_v2_user', JSON.stringify(u || {}))
    if (ten) localStorage.setItem('hergent_v2_tenant', String(ten))
  }, sess.token, sess.user, sess.tenant_id)

  await page.goto(BASE + '/#/workbench', { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(3500)

  /* ---------- 采集（全部在页面上下文里做，避免坐标换算错误） ---------- */
  const d = await page.evaluate(() => {
    const q = s => document.querySelector(s)
    const rect = el => { if (!el) return null; const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height } }
    const bento = q('.bento'), tp = q('.today-panel'), ec = q('.expiry-card'), rp = q('.report-panel'), ks = q('.kpi-strip')

    const out = {
      // ④ 其余模块
      hasBento: !!bento, hasToday: !!tp, hasExpiry: !!ec, hasReport: !!rp, hasKpiStrip: !!ks,
      kpiCount: ks ? ks.querySelectorAll('.kpi').length : 0,
      hasTodo: !!q('.todo-panel'),
      hasImportGuide: !!q('.import-guide'),
      reportTitle: rp ? (rp.querySelector('.panel-hd b') || {}).textContent || '' : '',
      // ① 面板残留
      text: (document.body.textContent || '').replace(/\s+/g, ''),
      nTrendCard: document.querySelectorAll('.trend-card').length,
      nTrendChart: document.querySelectorAll('.trend-chart').length,
      nTcBar: document.querySelectorAll('.tc-bar').length,
      nTcLabel: document.querySelectorAll('.tc-label').length,
      // ③ 几何
      bentoR: rect(bento), tpR: rect(tp), ecR: rect(ec), rpR: rect(rp),
      tpGridRow: tp ? getComputedStyle(tp).gridRowEnd : null,
      ecGridRow: ec ? getComputedStyle(ec).gridRowEnd : null,
      tpHole: null,
    }

    // ③b today-panel 第 2 行右侧的命中测试
    if (bento && tp) {
      const b = rect(bento), t = rect(tp)
      const GAP = 14
      const colW = (b.width - GAP * 11) / 12
      const x = b.left + 9 * (colW + GAP) + colW          // 第 10 列中心
      const y = t.bottom - 24                             // 贴近 today-panel 底边（第 2 行）
      const el = document.elementFromPoint(x, y)
      out.tpHole = el ? {
        point: { x: Math.round(x), y: Math.round(y) },
        tag: el.tagName,
        cls: String(el.className || '').slice(0, 70),
        inExpiry: !!el.closest('.expiry-card'),
        inToday: !!el.closest('.today-panel'),
        isBentoItself: el === bento,
        inBento: !!el.closest('.bento'),
      } : { point: { x: Math.round(x), y: Math.round(y) }, tag: null }
    }
    return out
  })

  console.log('\n--- 布局几何 ---')
  console.log('  bento   :', d.bentoR && `L${d.bentoR.left.toFixed(0)} R${d.bentoR.right.toFixed(0)} W${d.bentoR.width.toFixed(0)}`)
  console.log('  today   :', d.tpR && `L${d.tpR.left.toFixed(0)} R${d.tpR.right.toFixed(0)} T${d.tpR.top.toFixed(0)} B${d.tpR.bottom.toFixed(0)} H${d.tpR.height.toFixed(0)}`)
  console.log('  expiry  :', d.ecR && `L${d.ecR.left.toFixed(0)} R${d.ecR.right.toFixed(0)} T${d.ecR.top.toFixed(0)} B${d.ecR.bottom.toFixed(0)} H${d.ecR.height.toFixed(0)}`)
  console.log('  report  :', d.rpR && `T${d.rpR.top.toFixed(0)} B${d.rpR.bottom.toFixed(0)}`)
  console.log('  命中测试 :', JSON.stringify(d.tpHole))

  console.log('\n① 面板零残留')
  ok(!d.text.includes('近7天销售趋势'), '页面文案不含「近 7 天销售趋势」')
  ok(!d.text.includes('峰值¥'), '页面文案不含「峰值 ¥」（该面板的副标签）')
  ok(d.nTrendCard === 0, '.trend-card 元素数 = 0', 'n=' + d.nTrendCard)
  ok(d.nTrendChart === 0, '.trend-chart 元素数 = 0', 'n=' + d.nTrendChart)
  ok(d.nTcBar === 0, '.tc-bar 元素数 = 0', 'n=' + d.nTcBar)
  ok(d.nTcLabel === 0, '.tc-label 元素数 = 0', 'n=' + d.nTcLabel)

  console.log('\n② 无异常')
  const isPageError = e => e.startsWith('PAGEERROR')
  const relevant = errs.filter(e => isPageError(e) || /trend|Workbench|is not defined|Cannot read/i.test(e))
  ok(relevant.length === 0, '无未捕获异常 / 无与本页相关的 console 报错', relevant.slice(0, 3).join(' | ') || '')
  console.log(`  ⓘ console error 全量 ${errs.length} 条（含无关资源类）：${errs.slice(0, 4).map(s => s.slice(0, 90)).join(' | ') || '无'}`)

  console.log('\n③ 无残留空位（判别性断言）')
  ok(d.hasToday, '今日经营要务卡存在')
  if (d.hasToday && d.hasExpiry) {
    const gapPx = d.tpR.bottom - d.ecR.bottom
    ok(Math.abs(gapPx) <= 2, '近效期预警底边与今日经营要务底边对齐（右侧无空洞）',
      `today.B=${d.tpR.bottom.toFixed(1)} expiry.B=${d.ecR.bottom.toFixed(1)} 差=${gapPx.toFixed(1)}px`)
    ok(d.tpHole && d.tpHole.inExpiry, 'today 第 2 行右侧命中卡片（不是空位）',
      d.tpHole ? `命中 <${d.tpHole.tag} class="${d.tpHole.cls}"> inExpiry=${d.tpHole.inExpiry} isBento=${d.tpHole.isBentoItself}` : 'no point')
  } else if (d.hasToday && !d.hasExpiry) {
    const gp = d.bentoR.right - d.tpR.right
    ok(gp <= 2, '近效期预警缺失时今日经营要务铺满整行', `bento.R=${d.bentoR.right.toFixed(1)} today.R=${d.tpR.right.toFixed(1)} 差=${gp.toFixed(1)}px`)
  } else if (!d.hasToday && d.hasExpiry) {
    const gp = d.bentoR.right - d.ecR.right
    ok(gp <= 2, '今日经营要务缺失时近效期预警铺满整行', `bento.R=${d.bentoR.right.toFixed(1)} expiry.R=${d.ecR.right.toFixed(1)} 差=${gp.toFixed(1)}px`)
  } else {
    ok(true, '两卡均未渲染，跳过几何断言')
  }

  console.log('\n④ 其余模块正常')
  ok(d.hasKpiStrip && d.kpiCount === 5, 'KPI 横条存在且为 5 项', 'n=' + d.kpiCount)
  ok(d.hasReport, 'AI 晨报卡存在')
  ok(/AI\s*晨报/.test(d.reportTitle || ''), 'AI 晨报标题正确', d.reportTitle)
  ok(d.hasToday || d.hasExpiry || d.hasTodo || d.hasImportGuide, '至少一个业务模块在渲染')
  if (d.hasReport && d.tpR) ok(d.rpR.top >= d.tpR.top - 2, 'AI 晨报位于主体模块之下（未塌到上方）')

  /* ---------- 截图 ---------- */
  const shots = []
  try {
    await page.screenshot({ path: `${SHOT}/workbench-v190-${TAG}-1440.png`, fullPage: true })
    shots.push(`${SHOT}/workbench-v190-${TAG}-1440.png`)
    await page.setViewport({ width: 1100, height: 900 })
    await sleep(900)
    const r1100 = await page.evaluate(() => {
      const b = document.querySelector('.bento'), t = document.querySelector('.today-panel'), e = document.querySelector('.expiry-card')
      const g = el => el ? { bottom: +el.getBoundingClientRect().bottom.toFixed(1), right: +el.getBoundingClientRect().right.toFixed(1) } : null
      return { bento: g(b), today: g(t), expiry: g(e), cols: getComputedStyle(b).gridTemplateColumns.split(' ').length }
    })
    console.log('\n--- 1100px（1200 断点以下，6 列网格）---')
    console.log('  ' + JSON.stringify(r1100))
    ok(r1100.cols === 6, '窄屏网格降为 6 列', 'cols=' + r1100.cols)
    if (r1100.today && r1100.expiry) {
      ok(Math.abs(r1100.today.right - r1100.expiry.right) <= 2 && Math.abs(r1100.today.bottom - r1100.expiry.bottom) > 2,
        '窄屏两卡各自整行（宽度一致、纵向不重叠）',
        `today.R=${r1100.today.right} expiry.R=${r1100.expiry.right}`)
    }
    await page.screenshot({ path: `${SHOT}/workbench-v190-${TAG}-1100.png`, fullPage: true })
    shots.push(`${SHOT}/workbench-v190-${TAG}-1100.png`)
  } catch (e) { console.log('  ⚠️ 截图失败：' + e.message) }

  /* ---------- 多页冒烟（HG_SMOKE=1）----------
     ⚠️ 与本次任务的关系：scopeId = hash(路径 + **源码全文**)，改动任一 .vue 会让**该页**的
     chunk hash 变；而本次部署时各页 chunk 名整体重排 ⇒ 必须确认其他页面引用没断（404 → 白屏）。*/
  if (process.env.HG_SMOKE === '1') {
    console.log('\n⑤ 其他页面冒烟（chunk 换名后引用完整性）')
    const routes = ['/forecast', '/dashboard', '/rebate', '/loss-accounting', '/archive/products', '/connect']
    for (const rt of routes) {
      errs.length = 0
      try {
        await page.goto(BASE + '/#' + rt, { waitUntil: 'networkidle2', timeout: 60000 })
        await sleep(2400)
        const st = await page.evaluate(() => {
          const p = document.querySelector('.page')
          return {
            len: (document.body.textContent || '').replace(/\s+/g, '').length,
            htmlLen: p ? p.innerHTML.length : -1,
            cards: document.querySelectorAll('.card').length,
          }
        })
        const pe = errs.filter(e => e.startsWith('PAGEERROR'))
        // ⚠️ 判据**不能**用「body 文本长度」—— 图表页（/dashboard）的核心内容是 SVG，
        //    不进 textContent：实测它只有 151 字符却完全正常（chartArea=1 / trendSvg=1 /
        //    pageHtml=3719 / card=1）。改用「.page 有实质 DOM + 有结构性内容 + 无未捕获异常」。
        ok(st.htmlLen > 600 && (st.cards > 0 || st.len > 300) && pe.length === 0, `路由 ${rt} 正常渲染`,
          `pageHtml=${st.htmlLen} cards=${st.cards} textLen=${st.len} pageerror=${pe.slice(0, 2).join(' | ')}`)
      } catch (e) {
        ok(false, `路由 ${rt} 正常渲染`, 'THREW ' + e.message)
      }
    }
  }

  await browser.close()
  console.log(`\n===== ${TAG} 结果：${pass} passed / ${fail} failed =====`)
  if (fail) { console.log('失败项：'); failures.forEach(f => console.log('  - ' + f)) }
  console.log('截图：' + shots.join(' , '))
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error('FATAL: ' + (e && e.stack || e)); process.exit(2) })
