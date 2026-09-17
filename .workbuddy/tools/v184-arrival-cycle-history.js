// v184b 补验：**往期（历史期次）**视图的「到货周期」列
// 为什么单独验：本期走 loadCross、往期走 loadMatrix —— 是**两条行映射**，
//   两处都补了 arrival_lead_days；只验一处的常见后果正是
//   「本期显示 +3天、往期全变「—」」这种单侧静默漂移。
//
// 🔴 v184b 改造：原版断言「往期不是全「—」」直接 FAIL —— 那是**fixture 依赖**：
//   它点开的是列表第一条历史期次，而那一期的商品可能本来就全是 0（2026-09-17 实测：
//   沙箱里 forecast_import_products 只覆盖期次 9 / 13，点开到别的期次就是全「—」，
//   看着像 loadMatrix 丢了字段，其实数据本来就是 0）。
//   现在改成**自播种子**：先从页面拿到真实 pid，再把它们 PUT 成 3，然后重开该期次断言
//   「+3天」必须出现。换任何期次、任何数据集都成立。
//
// 用法：HG_TOKEN=<token> HG_TENANT=9999 NODE_PATH=<ws>[:<repo>/node_modules] node <本文件>
//   HG_HISTORY_NAME=9月 可选：按名字子串选期次（默认取列表第一条）
const puppeteer = require('puppeteer-core')
const TOKEN = process.env.HG_TOKEN
const TENANT = process.env.HG_TENANT || '9999'
const WANT = process.env.HG_HISTORY_NAME || ''
const SEED_DAYS = 3
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
  t.querySelectorAll('tbody tr').forEach(tr => {
    const td = tr.querySelector('td.fc-cycle')
    if (td && td.getAttribute('data-pid')) {
      const nm = tr.querySelector('td.fc-name')
      acc[td.getAttribute('data-pid')] = { t: td.textContent.trim(), name: nm ? nm.textContent.trim().slice(0, 20) : '' }
    }
  })
  return {
    labels: ths.map(th => th.textContent.trim()),
    cyIdx,
    cyCls: cyIdx >= 0 ? String(ths[cyIdx].className) : '',
    cyLeft: cyIdx >= 0 ? ths[cyIdx].style.left : '',
    acc,
  }
}

async function openHistory(page, nameWant) {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '历史期次')
    if (b) b.click()
  })
  await sleep(3500)
  const picked = await page.evaluate((want) => {
    // 期次卡片上的「查看」按钮 —— 想指定期次时按卡片文本匹配，默认取第一条。
    const btns = [...document.querySelectorAll('button')].filter(x => x.textContent.trim() === '查看')
    if (!btns.length) return { ok: false }
    let b = btns[0], idx = 0
    if (want) {
      for (let i = 0; i < btns.length; i++) {
        const card = btns[i].closest('div,li,article,section') || btns[i].parentElement
        const txt = card ? card.textContent : ''
        if (txt.indexOf(want) >= 0) { b = btns[i]; idx = i; break }
      }
    }
    b.click()
    return { ok: true, idx, total: btns.length }
  }, nameWant)
  await sleep(6500)
  return picked
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
  const gotoFc = async () => {
    await page.goto('https://hergent.cn/?cb=' + Date.now() + '#/forecast', { waitUntil: 'networkidle2', timeout: 60000 })
    await sleep(5500)
  }
  await gotoFc()

  const pick = await openHistory(page, WANT)
  info('历史期次「查看」按钮数=' + (pick.total || 0) + '，点了第 ' + (pick.idx + 1) + ' 条' + (WANT ? '（匹配 ' + WANT + '）' : ''))
  ok(pick.ok, '找到并点开了历史期次')

  const A = await page.evaluate(snap)
  if (A.err) { ok(false, '往期未加载出交叉表：' + A.err); await browser.close(); process.exit(1) }
  info('列头: ' + JSON.stringify(A.labels.slice(0, 6)))
  const pids = Object.keys(A.acc)
  const dist0 = {}
  Object.values(A.acc).forEach(v => { dist0[v.t] = (dist0[v.t] || 0) + 1 })
  info('遍历到 ' + pids.length + ' 行｜文案分布: ' + JSON.stringify(dist0))

  ok(A.cyIdx >= 0, '往期视图同样存在「到货周期」列', 'index=' + A.cyIdx)
  ok(A.labels[A.cyIdx - 1] === '商品名称', '位置与本期一致（紧跟商品名称）', A.labels[A.cyIdx - 1])
  ok(A.cyCls.includes('frozen'), '往期该列同样是固定列（.frozen）', A.cyCls)
  ok(!!A.cyLeft, '往期该列同样有冻结偏移 left', A.cyLeft)
  ok(pids.length > 0, '往期渲染出了行（否则后面全是空断言）', pids.length + ' 行')

  // ── 自播种子：把本期次的前几个商品 PUT 成 +3天（沙箱内写）──
  const seed = pids.slice(0, 5)
  info('播种子（PUT ' + SEED_DAYS + '）: ' + JSON.stringify(seed))
  let putOK = 0
  for (const pid of seed) {
    const r = await page.evaluate(async (p, d) => {
      const tk = localStorage.getItem('hergent_v2_token')
      const ten = localStorage.getItem('hergent_v2_tenant')
      const res = await fetch('/api/products/' + p, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tk, 'X-Tenant-Id': String(ten) },
        body: JSON.stringify({ arrival_lead_days: d }),
      })
      return res.status
    }, pid, SEED_DAYS)
    if (r === 200) putOK++
  }
  ok(putOK === seed.length, '播种子写入成功', putOK + '/' + seed.length)

  // 重开该期次（页面重载会回到本期，故重走一次「历史期次 → 查看」）
  await gotoFc()
  await openHistory(page, WANT)
  const B = await page.evaluate(snap)
  const dist1 = {}
  Object.values(B.acc).forEach(v => { dist1[v.t] = (dist1[v.t] || 0) + 1 })
  info('重开后文案分布: ' + JSON.stringify(dist1))
  const hit = seed.filter(p => B.acc[p])
  ok(hit.length > 0, '重开后仍能看到播种过的行（否则本节无覆盖）', '命中 ' + JSON.stringify(hit))
  const allSeed = hit.every(p => B.acc[p].t === '+' + SEED_DAYS + '天')
  ok(allSeed && hit.length > 0,
    '【核心】往期视图真的把 arrival_lead_days 带下去了（播种行显示 +' + SEED_DAYS + '天）',
    JSON.stringify(hit.map(p => p + ':' + (B.acc[p] || {}).t)))
  const dash = Object.values(B.acc).filter(v => v.t === '—').length
  ok(dash > 0, '（对照）同屏仍有「—」的行 ⇒ 不是整列统一渲染', '— 的行数=' + dash)

  await page.screenshot({ path: '/tmp/v184b-history-view.png' })
  info('截图: /tmp/v184b-history-view.png')
  const pass = results.filter(r => r.pass).length
  console.log('\n=== 往期结果 ' + pass + '/' + results.length + ' ===')
  results.filter(r => !r.pass).forEach(r => console.log('  FAIL → ' + r.label))
  await browser.close()
  process.exit(pass === results.length ? 0 : 1)
})().catch(e => { console.error('FATAL', e); process.exit(2) })
