/* 货损核算仪表盘 · **本地预检**（v185）
 *
 * 为什么要它：仪表盘是纯前端渲染，错了只会在浏览器里炸（Vue 渲染异常会让整段子树消失），
 * 而 dist 是"整体构建"，直接上线等于让真实用户当第一个测试者。
 * 本脚本把 ①本地 dist 静态服务起来 + ②拦截 /api/** 用**本地后端跑出来的真实 payload**
 * （loss-trend-local-verify.py 导出的 fixture）响应，从而在**不碰生产**的前提下把
 * 渲染、空月语义、双轴、折线断开、筛选联动全部验一遍，并留下截图。
 *
 * 用法：
 *   LOSSFX=/tmp/loss-fixtures node loss-dashboard-local-preflight.js
 * 前置：先跑 LOSSFX=/tmp/loss-fixtures python3 .workbuddy/tools/loss-trend-local-verify.py
 */
const http = require('http')
const fs = require('fs')
const path = require('path')
const puppeteer = require('puppeteer-core')

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
// ⚠️ 可覆盖：多会话共用一个 dist 时，把「我这一份隔离构建」指过来验，
//    否则验的可能是别人**未完工**的产物（本项目 v185-tabs 起实测过这个坑）
const DIST = process.env.HG_DIST
  || '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/dist'
const FX = process.env.LOSSFX || '/tmp/loss-fixtures'
const OUT = process.env.HG_OUT
  || '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/货损核算-2026-09-18'
const PORT = Number(process.env.PORT || 8877)
const sleep = ms => new Promise(r => setTimeout(r, ms))

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff',
}

const failed = []
function ok(cond, label, extra) {
  if (!cond) failed.push(label)
  console.log((cond ? '  ✓ ' : '  ✗ ') + label + (extra !== undefined ? '   [' + extra + ']' : ''))
}
function info(m) { console.log('  · ' + m) }

const bootstrap = JSON.parse(fs.readFileSync(path.join(FX, 'bootstrap.json'), 'utf8'))
const trend = JSON.parse(fs.readFileSync(path.join(FX, 'trend.json'), 'utf8'))

function serve() {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0])
    if (p === '/' || !path.extname(p)) p = '/index.html'
    const f = path.join(DIST, p)
    if (!fs.existsSync(f) || !fs.statSync(f).isFile()) {
      res.writeHead(404); res.end('nf'); return
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' })
    fs.createReadStream(f).pipe(res)
  })
  return new Promise(r => srv.listen(PORT, '127.0.0.1', () => r(srv)))
}

async function main() {
  if (!fs.existsSync(path.join(FX, 'trend.json'))) {
    console.error('缺 fixture：' + FX + '（先跑 loss-trend-local-verify.py）')
    process.exit(2)
  }
  const srv = await serve()
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--force-device-scale-factor=1'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1680, height: 1100, deviceScaleFactor: 2 })
  const errs = []
  page.on('pageerror', e => errs.push('pageerror: ' + e.message))
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)) })

  await page.setRequestInterception(true)
  page.on('request', req => {
    const u = req.url()
    if (u.includes('/api/')) {
      let body = { ok: true, success: true, data: {} }
      if (u.includes('/api/loss/accounting/bootstrap')) {
        // 🔴 按期次取 fixture：`bootstrap-<period>.json` 存在就用它（真后端导出的那一期），
        //    否则回落到 bootstrap.json 并只把 `period` 标签改成请求值
        //    —— 本轮要按**期次**验「③ 行临期销售」的已填/未填两种态，标签对不上就验的是别的月的数。
        const m = /[?&]period=([^&]*)/.exec(u)
        const qp = m ? decodeURIComponent(m[1]) : ''
        const per = qp && path.join(FX, 'bootstrap-' + qp + '.json')
        if (per && fs.existsSync(per)) {
          body = JSON.parse(fs.readFileSync(per, 'utf8'))
        } else {
          // mock 的数字仍是 fixture 那一期（2026-09）的，这里只把 `period` 标签改成请求里的值
          // —— 验的是"点柱子/切期次"的联动，不是数字本身（数字由 Python 侧断言锁）。
          body = JSON.parse(JSON.stringify(bootstrap))
          if (qp) body.data.period = qp
        }
      } else if (u.includes('/api/loss/accounting/trend')) body = trend
      else if (u.includes('/api/loss/accounting/periods')) {
        body = { ok: true, success: true, data: { periods: bootstrap.data.periods } }
      } else if (u.includes('/api/ai/sessions')) {
        body = { ok: true, success: true, data: { sessions: [] } }
      }
      req.respond({
        status: 200, contentType: 'application/json; charset=utf-8',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(body),
      })
      return
    }
    req.continue()
  })

  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('hergent_v2_token', 'local-preflight')
    localStorage.setItem('hergent_v2_tenant', '9998')
    localStorage.setItem('hergent_v2_user',
      JSON.stringify({ role: 'sales', username: 'local', display_name: '本地预检' }))
  })

  await page.goto(`http://127.0.0.1:${PORT}/#/loss-accounting`,
    { waitUntil: 'networkidle2', timeout: 45000 })
  await sleep(1600)
  info('url = ' + page.url())

  // ── 0) 主 Tab：默认落在「仪表盘」，且两个 tab 的内容真的互斥 ──
  //  ⚠️ 用**精确类名**（.main-tabs/.main-tab/.la-bar/.la-tbar/section.dsh），
  //    禁用 [class*=]（同前缀元素会抢先命中 —— 本项目「探针偏航」铁律）
  console.log('\n# 0) 主 Tab（仪表盘 / 数据填报 分页）')
  const t0 = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.main-tabs .main-tab')]
    const on = btns.find(x => x.classList.contains('on'))
    return {
      labels: btns.map(x => (x.textContent || '').trim()),
      on: on ? (on.textContent || '').trim() : '',
      hasDash: !!document.querySelector('.la-tbar') && !!document.querySelector('section.dsh'),
      hasFill: !!document.querySelector('.la-bar') && !!document.querySelector('table.la-tbl'),
    }
  })
  ok(t0.labels.join('|') === '仪表盘|数据填报', '主 Tab 两个，文案与顺序对', t0.labels.join('|'))
  ok(t0.on === '仪表盘', '默认落在「仪表盘」', t0.on)
  ok(t0.hasDash, '仪表盘地标在')
  ok(!t0.hasFill, '仪表盘态下填报地标不在（工具条/主表属于另一个 tab）')


  // ── 1) 基本渲染 ──
  console.log('\n# 1) 渲染与结构')
  const has = await page.evaluate(() => ({
    dsh: !!document.querySelector('.dsh'),
    kpis: document.querySelectorAll('.dsh-kpis .k').length,
    cards: document.querySelectorAll('.dsh-card').length,
    svgs: document.querySelectorAll('.dsh-svg svg').length,
    mlRows: document.querySelectorAll('.la-ml-tbl tbody tr').length,
    rank: document.querySelectorAll('.rk-row').length,
    legs: document.querySelectorAll('.dsh .lg').length,
  }))
  ok(has.dsh, '仪表盘段已渲染')
  ok(has.kpis === 5, '5 张指标卡', has.kpis)
  ok(has.cards === 4, '4 张图卡（主图 + 构成堆叠 + 抵扣对比 + 主体排行）', has.cards)
  ok(has.svgs === 3, '3 个 SVG（排行图用 HTML 条形）', has.svgs)
  ok(has.mlRows === 6, '月列表 6 行（区间内的每一月都在，含未录入月）', has.mlRows)
  ok(has.rank === 4, '主体排行 4 条', has.rank)

  // ── 2) 空月语义（本轮的核心合同）──
  console.log('\n# 2) 空月 / 缺分母：图上必须看得见，且不能画成 0')
  const empty = await page.evaluate(() => {
    const main = document.querySelectorAll('.dsh-svg svg')[0]
    return {
      ph: [...main.querySelectorAll('text.ph')].map(t => t.textContent.trim()),
      dashed: [...main.querySelectorAll('rect[stroke-dasharray]')].length,
      bars: main.querySelectorAll('g.bars rect').length,
      // ⚠️ 只数**率数据点**（r=3.2）；主图里还有一个 r=3 的「当前期次」标记，
      //    用 `circle` 全量数会多算 1 个
      dots: main.querySelectorAll('circle[r="3.2"]').length,
      polylines: main.querySelectorAll('polyline').length,
      labels: main.querySelectorAll('text.xl-m').length,
    }
  })
  info('占位文字: ' + JSON.stringify(empty.ph))
  ok(empty.ph.includes('未录入'), '空月画了「未录入」占位')
  ok(empty.dashed >= 1, '占位是虚线框（不是 0 柱）', empty.dashed + ' 个')
  ok(empty.bars === 5 * 2, '只有 5 个有数据的月画柱（每月 2 根）', empty.bars)
  ok(empty.labels === 6, 'X 轴 6 个月份标', empty.labels)
  ok(empty.polylines === 1, '折线在空月/缺分母月**断开**（只 1 段：04→05）', empty.polylines + ' 段')
  ok(empty.dots === 4, '率数据点 4 个（04/05/07/09；06 空月、08 缺分母都无点）', empty.dots)

  // ── 3) 双轴都有刻度 ──
  console.log('\n# 3) 双轴：金额与率各自带刻度（共轴会把"率"读成金额）')
  const axes = await page.evaluate(() => {
    const main = document.querySelectorAll('.dsh-svg svg')[0]
    return {
      wan: [...main.querySelectorAll('text.ax')].filter(t => t.textContent.includes('万')).length,
      pct: [...main.querySelectorAll('text.ax-rate')].length,
      unit: [...main.querySelectorAll('text.ax-u')].map(t => t.textContent.trim()),
      ticks: [...main.querySelectorAll('text.ax')].length,
    }
  })
  info('单位标注: ' + JSON.stringify(axes.unit))
  ok(axes.pct >= 3, '右轴（率）有 ≥3 个刻度', axes.pct + ' 个')
  ok(axes.unit.includes('万元') && axes.unit.includes('%'), '两个单位都明确标了', axes.unit.join('/'))
  ok(axes.ticks >= 5, '左轴刻度 ≥5 个', axes.ticks)

  // ── 4) 月列表：三态 + 环比两种单位 ──
  console.log('\n# 4) 月列表：三种「没有数」必须长得不一样；环比两种单位不可混')
  const ml = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.la-ml-tbl tbody tr')]
    return rows.map(tr => {
      const td = [...tr.querySelectorAll('td')].map(x => (x.textContent || '').replace(/\s+/g, ' ').trim())
      const g = tr.querySelector('.la-ml-gap')
      return { period: td[0], net: td[1], rate: td[2], mAmt: td[3], mRate: td[4],
        cls: tr.className, gapLabel: g ? (g.textContent || '').trim() : '',
        comp: td[6], gapTip: g ? (g.getAttribute('title') || '') : '' }
    })
  })
  const byP = Object.fromEntries(ml.map(r => [r.period.slice(0, 7), r]))
  info('降序首行: ' + JSON.stringify(ml[0]))
  ok(ml.length === 6 && ml[0].period.startsWith('2026-09'), '最新月在最上（降序）', ml[0].period)
  ok(byP['2026-06'].net === '未录入', '空月净额显示「未录入」（不是 0）', byP['2026-06'].net)
  ok(byP['2026-08'].net !== '未录入' && byP['2026-08'].rate === '—',
    '缺分母月：净额有数、率显示「—」（不是 0.00%）', byP['2026-08'].rate)
  ok(/缺 \d+ 项/.test(byP['2026-08'].gapLabel), '完整度显示「缺 N 项」', byP['2026-08'].gapLabel)
  ok(/缺公司销售金额/.test(byP['2026-08'].gapTip), '悬停能列出**具体**缺哪几项', byP['2026-08'].gapTip)
  ok(byP['2026-04'].comp === '完整', '已录满的月标「完整」', byP['2026-04'].comp)
  ok(byP['2026-06'].comp === '未录入', '空月的完整度标「未录入」（不是「缺 N 项」）', byP['2026-06'].comp)
  /* 环比要挑"上月也有数"的那一行：05 的上月是 04（两个月都全）——
     挑 07 的话它的上月 06 是空月，按设计只会显示「上月未录入」，验不到单位。 */
  ok(/个百分点/.test(byP['2026-05'].mRate), '净率变化写「个百分点」', byP['2026-05'].mRate)
  ok(/%$/.test(byP['2026-05'].mAmt) && !/个百分点/.test(byP['2026-05'].mAmt),
    '净额环比用 %（金额比金额，与率的变化不同单位）', byP['2026-05'].mAmt)
  ok(byP['2026-06'].mAmt === '—', '空月的环比显示「—」（不跨缺口去跟 5 月比）', byP['2026-06'].mAmt)
  ok(byP['2026-07'].mAmt === '上月未录入', '上月未录入时明确说「上月未录入」，不硬算', byP['2026-07'].mAmt)
  ok(byP['2026-08'].mRate === '—', '上月缺分母 ⇒ 率的变化显示「—」（不是 0）', byP['2026-08'].mRate)

  // ── 5) 点柱切月 ──
  //  ⚠️ 分 tab 后「期次选择器(.la-sel)」只在**数据填报** tab 里 ⇒ 不能再用它读期次；
  //    改读月列表里带 .la-ml-cur 的那一行（仪表盘自带，且它显示的就是共享的 period）。
  console.log('\n# 5) 交互：点柱子切「当前期次」，且**留在仪表盘**（不跳走）')
  const curPeriod = () => page.evaluate(() => {
    const tr = document.querySelector('.la-ml-tbl tbody tr.la-ml-cur')
    const b = tr && tr.querySelector('.la-ml-m b')
    return b ? b.textContent.trim() : ''
  })
  const before = await curPeriod()
  await page.evaluate(() => {
    const g = document.querySelectorAll('.dsh-svg svg')[0].querySelectorAll('g.bars')
    if (g.length) g[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await sleep(900)
  const after = await curPeriod()
  ok(before !== after, '期次已切换', before + ' → ' + after)
  ok(after === '2026-04', '切到图表最左那根柱子对应的月', after)
  const stayed = await page.evaluate(() => ({
    on: ((document.querySelector('.main-tabs .main-tab.on') || {}).textContent || '').trim(),
    dsh: !!document.querySelector('.dsh'),
  }))
  ok(stayed.on === '仪表盘' && stayed.dsh,
    '点柱子后仍停在仪表盘（图上要能连续比各月，跳走就没法比）', stayed.on)

  // ── 6) 两个开关 ──
  console.log('\n# 6) 筛选：两个开关只改显示，且都明说改了哪儿')
  await page.evaluate(() => {
    const boxes = [...document.querySelectorAll('.la-tbar input[type=checkbox]')]
    boxes[1].click()   // 跳过未录入月
  })
  await sleep(700)
  const skip = await page.evaluate(() => ({
    chartMonths: document.querySelectorAll('.dsh-svg svg')[0]
      .querySelectorAll('text.xl-m').length,
    mlRows: document.querySelectorAll('.la-ml-tbl tbody tr').length,
    note: (document.querySelector('.dsh-note') || {}).textContent || '',
  }))
  ok(skip.chartMonths === 5, '跳过未录入月后图上少一个月（6 → 5）', skip.chartMonths)
  ok(skip.mlRows === 6, '月列表**仍是 6 行**（管理界面上未录入月必须可见，好去补）', skip.mlRows)
  ok(/跳过 1 个未录入月/.test(skip.note), '顶部明说跳过了几个', skip.note.trim())
  await page.evaluate(() => {
    const boxes = [...document.querySelectorAll('.la-tbar input[type=checkbox]')]
    boxes[0].click()   // 只看已结账月
  })
  await sleep(700)
  const hid = await page.evaluate(() => {
    const main = document.querySelectorAll('.dsh-svg svg')[0]
    return {
      ph: main ? [...main.querySelectorAll('text.ph')].map(t => t.textContent.trim()) : [],
      bars: main ? main.querySelectorAll('g.bars rect').length : -1,
      labels: main ? main.querySelectorAll('text.xl-m').length : -1,
      note: [...document.querySelectorAll('.dsh-note')].map(x => x.textContent.trim()).join(' | '),
    }
  })
  ok(hid.ph.filter(x => x === '已隐藏').length === 3,
    '有数据但未结账的月全部变灰占位（保留时间轴位置，不把列抽掉）',
    hid.ph.filter(x => x === '已隐藏').length)
  ok(hid.bars === 2 * 2, '只剩已结账的 2 个月参与柱（04/05）', hid.bars)
  ok(hid.labels === 5, '无数据的月被「跳过未录入月」整列拿掉（6 → 5）', hid.labels)
  /* 两条提示合起来必须能解释这一屏：6 个月 → 跳过 1 个（无数据）→ 隐藏 3 个（未结账）
     → 剩 2 个参与图。任一条少写，用户都会看不出"少掉的月去哪了"。 */
  ok(/已隐藏 3 个未结账月/.test(hid.note) && /跳过 1 个未录入月/.test(hid.note),
    '两条提示合起来讲清了"少掉的月去哪了"', hid.note)

  // ── 7) 截图（先还原开关）──
  await page.evaluate(() => {
    const boxes = [...document.querySelectorAll('.la-tbar input[type=checkbox]')]
    boxes[0].click(); boxes[1].click()
  })
  await sleep(900)
  fs.mkdirSync(OUT, { recursive: true })
  const png = path.join(OUT, '06-仪表盘-本地预检.png')
  await page.screenshot({ path: png, fullPage: true })
  info('整页截图: ' + png)
  // 主图特写：双轴刻度、空月占位、折线断点这些细节在整页里看不清
  const mainEl = await page.$('.dsh-card')
  if (mainEl) {
    const p2 = path.join(OUT, '07-仪表盘-主图特写-本地预检.png')
    await mainEl.screenshot({ path: p2 })
    info('主图特写: ' + p2)
  }

  // ── 7.5) 切到「数据填报」再切回来（截图之后跑，免得影响上面那几张图）──
  console.log('\n# 7.5) 主 Tab 切换：两个 tab 的内容确实互斥')
  const clickTab = (label) => page.evaluate((lb) => {
    const b = [...document.querySelectorAll('.main-tabs .main-tab')]
      .find(x => (x.textContent || '').trim() === lb)
    if (!b) return false
    b.click()
    return true
  }, label)
  await clickTab('数据填报')
  await sleep(700)
  const tf = await page.evaluate(() => ({
    on: ((document.querySelector('.main-tabs .main-tab.on') || {}).textContent || '').trim(),
    hasFill: !!document.querySelector('.la-bar') && !!document.querySelector('table.la-tbl'),
    hasDash: !!document.querySelector('.la-tbar') || !!document.querySelector('section.dsh'),
    foot: !!document.querySelector('.la-footnote'),
  }))
  ok(tf.on === '数据填报', '点「数据填报」后高亮切换', tf.on)
  ok(tf.hasFill, '填报地标出现：工具条 + 主表')
  ok(tf.foot, '表尾说明也在填报 tab')
  ok(!tf.hasDash, '趋势段**已移除**（不是 display:none 藏起来）')

  // 主表本身也要验：模板做了搬移（工具条从页首移到本 tab），表结构与列位必须原样
  const ft = await page.evaluate(() => {
    const t = document.querySelector('table.la-tbl')
    const btns = [...document.querySelectorAll('.la-bar button')]
      .map(b => (b.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean)
    return {
      nTh: t.querySelectorAll('thead th').length,
      nGrp: t.querySelectorAll('tbody tr.la-grp').length,
      nRow: t.querySelectorAll('tbody tr.la-row').length,
      nSub: [...t.querySelectorAll('tbody td')].filter(td => (td.textContent || '').trim() === '小计').length,
      foot: ((t.querySelector('tfoot') || {}).textContent || '').replace(/\s+/g, ' ').trim().slice(0, 20),
      bar: btns,
    }
  })
  ok(ft.nTh >= 3, '填报 tab 里主表表头列位齐全（搬移未打乱列）', ft.nTh + ' 列')
  ok(ft.nGrp === 4, '四个行分组都在', ft.nGrp + ' 组')
  ok(ft.nRow >= 2, '数据行在（含空占位）', ft.nRow + ' 行')
  ok(ft.nSub === 4, '每组一条「小计」', ft.nSub + ' 条')
  ok(/合计/.test(ft.foot), '表尾合计校验行在', ft.foot)
  ok(ft.bar.includes('手工录入') && ft.bar.includes('上传数据'),
    '工具条 6 个按钮搬过来后仍在', ft.bar.join(' / '))
  const png2 = path.join(OUT, '08-数据填报-本地预检.png')
  await page.screenshot({ path: png2, fullPage: true })
  info('数据填报 tab 截图: ' + png2)

  await clickTab('仪表盘')
  await sleep(900)
  const td = await page.evaluate(() => ({
    on: ((document.querySelector('.main-tabs .main-tab.on') || {}).textContent || '').trim(),
    dsh: !!document.querySelector('.dsh'),
    ml: document.querySelectorAll('.la-ml-tbl tbody tr').length,
    hasFill: !!document.querySelector('.la-bar'),
  }))
  ok(td.on === '仪表盘' && td.dsh, '切回「仪表盘」后图表重新挂上', td.on)
  ok(td.ml === 6, '切回后月列表行数不变（数据没被重取丢成空）', td.ml + ' 行')
  ok(!td.hasFill, '切回后填报地标已移除')

  // ── 7.8) ③「良品仓 → 临期仓」新增「临期销售」填报入口 + 列位改名（本轮）──
  //  按期取 fixture：2026-07 = ③ 填了 900 元（0.09 万）；2026-08 = 直调额填了但临期销售**未填**
  //  ⚠️ 只看 2026-09（③ 两项都没填）验不出"填了之后小计怎么显示"—— 那正是本轮要保证的事。
  console.log('\n# 7.8) ③ 直调行「临期销售」填报入口 + 列位改名')
  await clickTab('数据填报')
  await sleep(500)

  // 期次下拉（.la-sel，**注意别撞上 .la-sel-sm 计价口径那个**）在填报 tab；
  // page.select 会派发 change ⇒ 触发 reload ⇒ 拦截层按 period 返回对应的真 fixture
  async function pickPeriod(p) {
    await page.select('.la-sel', p)
    await sleep(1200)
  }

  const readCells = () => page.evaluate(() => {
    const ths = [...document.querySelectorAll('table.la-tbl thead th')]
    const dedIdx = ths.findIndex(t => (t.textContent || '').trim().startsWith('临期销售'))
    const rows = [...document.querySelectorAll('table.la-tbl tbody tr')]
    function cellOf(grpNo) {
      const i = rows.findIndex(r => r.classList.contains('la-grp')
        && (r.textContent || '').includes(grpNo))
      if (i < 0) return null
      const rest = rows.slice(i + 1)
      const data = rest.find(r => r.classList.contains('la-row'))
      const sub = rest.find(r => r.classList.contains('la-sub'))
      const pick = tr => {
        const td = tr && tr.querySelectorAll('td')[dedIdx]
        if (!td) return null
        const inp = td.querySelector('input')
        return { input: !!inp, val: inp ? inp.value : null,
                 text: (td.textContent || '').trim(),
                 editable: td.classList.contains('la-editable') }
      }
      return { data: pick(data), sub: pick(sub) }
    }
    const sel = document.querySelector('.la-sel')
    return {
      dedIdx,
      head: ths[dedIdx] ? (ths[dedIdx].textContent || '') : '',
      period: sel ? sel.value : '',
      store: cellOf('①'), direct: cellOf('③'), wastage: cellOf('④'),
    }
  })

  const clickBar = label => page.evaluate(lb => {
    const b = [...document.querySelectorAll('.la-bar button')]
      .find(x => (x.textContent || '').trim() === lb)
    if (!b) return false
    b.click()
    return true
  }, label)

  await pickPeriod('2026-07')
  let c7 = await readCells()
  info('「临期销售」列位 = 第 ' + c7.dedIdx + ' 格 · 表头 = ' + c7.head.replace(/\s+/g, ' '))
  ok(c7.head.includes('临期销售') && !c7.head.includes('抵扣'),
    '列位表头已改名（含「临期销售」、不含「抵扣」）', c7.head.replace(/\s+/g, ' '))
  ok(c7.period === '2026-07', '期次已切到 2026-07（拿到的是真后端那一期的 payload）', c7.period)
  ok(c7.direct.data.text === '0.09',
    '只读态：③ 行临期销售 = 0.09 万（= 900 元）', c7.direct.data.text)
  ok(c7.direct.sub.text === '0.09',
    '🔴 ③ 组小计也显示抵扣（本轮补的显示 —— 否则「毛额 − 抵扣 = 净额」在表上不成立）',
    c7.direct.sub.text)
  ok(c7.store.data.text === '—' && c7.wastage.data.text === '—',
    '① / ④ 没有这一列位 ⇒ 显示「—」（不是 0）',
    c7.store.data.text + ' / ' + c7.wastage.data.text)

  ok(await clickBar('手工录入'), '点「手工录入」进入录入态')
  await sleep(700)
  c7 = await readCells()
  ok(c7.direct.data.input && c7.direct.data.val === '0.09' && c7.direct.data.editable,
    '🔴 录入态：③ 行「临期销售」是**可填输入框**且回填 0.09', c7.direct.data.val)
  ok(!c7.store.data.input && !c7.wastage.data.input,
    '录入态：① / ④ 行没有输入框（该列 scope 只含 ③）',
    '①=' + c7.store.data.input + ' ④=' + c7.wastage.data.input)
  const png3 = path.join(OUT, '09-临期销售填报入口-本地预检.png')
  await page.screenshot({ path: png3, fullPage: true })
  info('③ 行填报入口截图: ' + png3)
  ok(await clickBar('完成录入'), '点「完成录入」退出录入态（未改动 ⇒ 不触发保存）')
  await sleep(700)

  await pickPeriod('2026-08')
  const c8 = await readCells()
  ok(c8.period === '2026-08' && c8.direct.data.input === false,
    '已切到 2026-08 且退回只读态', c8.period)
  ok(c8.direct.data.text === '—' && c8.direct.sub.text === '—',
    '🔴 ③ 临期销售**未填**时，行与小计都显示「—」（不是 0 —— 0 会被读成"一分钱没卖回来"）',
    c8.direct.data.text + ' / ' + c8.direct.sub.text)

  console.log('\n# 8) 控制台')
  ok(errs.length === 0, '无 pageerror / console.error', errs.slice(0, 3).join(' || ') || '0 条')

  await browser.close()
  srv.close()
  console.log('\n' + '='.repeat(64))
  console.log(failed.length ? '失败 ' + failed.length + ' 项：\n  - ' + failed.join('\n  - ')
    : '本地预检全部通过')
  console.log('='.repeat(64))
  process.exit(failed.length ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(3) })
