// v184 补验：**往期（历史期次）**视图的「到货周期」列
// 为什么单独验：本期走 loadCross、往期走 loadMatrix —— 是**两条行映射**，
//   我两处都补了 arrival_lead_days；只验一处的常见后果正是
//   「本期显示 +3天、往期全变「—」」这种单侧静默漂移。
const puppeteer = require('puppeteer-core')
const TOKEN = process.env.HG_TOKEN
const TENANT = process.env.HG_TENANT || '9999'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
function ok(c, l, e) { results.push({ pass: !!c, label: l }); console.log((c ? '  ✓ ' : '  ✗ ') + l + (e ? '   ' + e : '')) }
const info = m => console.log('  · ' + m)

function snap() {
  const t = [...document.querySelectorAll('table.cross-tbl')].find(tb => tb.getAttribute('role') === 'grid')
  if (!t) return { err: 'no-view-table' }
  const ths = [...t.querySelectorAll('thead th')]
  const cyIdx = ths.findIndex(th => th.textContent.trim().startsWith('到货周期'))
  const acc = {}
  t.querySelectorAll('tbody tr.data-row').forEach(tr => {
    const td = tr.querySelector('td.fc-cycle')
    if (td && td.getAttribute('data-pid')) acc[td.getAttribute('data-pid')] = td.textContent.trim()
  })
  return {
    labels: ths.map(th => th.textContent.trim()),
    cyIdx,
    cyCls: cyIdx >= 0 ? String(ths[cyIdx].className) : '',
    cyLeft: cyIdx >= 0 ? ths[cyIdx].style.left : '',
    acc,
  }
}

;(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900 })
  await page.evaluateOnNewDocument((t, ten) => {
    localStorage.setItem('hergent_v2_token', t)
    localStorage.setItem('hergent_v2_tenant', String(ten))
  }, TOKEN, TENANT)
  await page.goto('https://hergent.cn/?cb=' + Date.now() + '#/forecast', { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(6000)

  const tab = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '历史期次')
    if (b) { b.click(); return true }
    return false
  })
  info('点「历史期次」: ' + tab)
  await sleep(4000)

  const viewed = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '查看')
    if (b) { b.click(); return true }
    return false
  })
  info('点第一条「查看」: ' + viewed)
  await sleep(6500)

  const A = await page.evaluate(snap)
  if (A.err) { ok(false, '往期未加载出交叉表：' + A.err); await browser.close(); process.exit(1) }
  info('列头: ' + JSON.stringify(A.labels.slice(0, 6)))
  const dist = {}
  Object.values(A.acc).forEach(v => { dist[v] = (dist[v] || 0) + 1 })
  info('遍历到 ' + Object.keys(A.acc).length + ' 行｜文案分布: ' + JSON.stringify(dist))

  ok(A.cyIdx >= 0, '往期视图同样存在「到货周期」列', 'index=' + A.cyIdx)
  ok(A.labels[A.cyIdx - 1] === '商品名称', '位置与本期一致（紧跟商品名称）', A.labels[A.cyIdx - 1])
  ok(A.cyCls.includes('frozen'), '往期该列同样是固定列（.frozen）', A.cyCls)
  ok(!!A.cyLeft, '往期该列同样有冻结偏移 left', A.cyLeft)
  const nonEmpty = Object.values(A.acc).filter(v => v && v !== '—').length
  ok(nonEmpty > 0, '【核心】往期不是全「—」：真的把 arrival_lead_days 带下去了', nonEmpty + ' 行有值 / 共 ' + Object.keys(A.acc).length)
  ok((dist['+3天'] || 0) > 0 || (dist['+4天'] || 0) > 0, '往期能看到具体的 +N天 文案', JSON.stringify(dist))

  await page.screenshot({ path: '/tmp/v184-history-view.png' })
  info('截图: /tmp/v184-history-view.png')
  const pass = results.filter(r => r.pass).length
  console.log('\n=== 往期结果 ' + pass + '/' + results.length + ' ===')
  results.filter(r => !r.pass).forEach(r => console.log('  FAIL → ' + r.label))
  await browser.close()
  process.exit(0)
})().catch(e => { console.error('FATAL', e); process.exit(2) })
