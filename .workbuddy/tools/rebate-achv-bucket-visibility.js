/**
 * 验证「季/年桶」的数据在图表侧是否可见（2026-09-15）
 *
 * 做法：
 *  ① 抓基线 —— 「达成填报」页「全年月度对比」表 12 行「实际达成」列合计
 *  ② 往沙箱库注入两条非月度桶行（2026-Q3 / 2026，各一笔明显金额）
 *  ③ 刷新页面重抓同一张表 → 数字若不变，说明这两条数据图表侧读不到
 *  ④ 切到「按季」口径，确认那条 999,999 在填报表格里「填得到、看得见」
 *
 * 用法：
 *   HG_TOKEN=xxx HG_TENANT=9997 NODE_PATH=<managed node ws>/node_modules node rebate-achv-bucket-visibility.js
 */
const puppeteer = require('puppeteer-core')
const { execSync } = require('child_process')
const fs = require('fs')

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.HG_BASE || 'https://hergent.cn'
const TOKEN = process.env.HG_TOKEN
const TENANT = process.env.HG_TENANT || '9997'
const OUT = '/tmp/achv-period'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const HOST = 'root@47.113.224.140'

// 抓「全年月度对比」表 + 接口原始返回
const probe = () => {
  const num = s => Number(String(s).replace(/[¥,\s件]/g, '')) || 0
  const yc = document.querySelector('.achv-year')
  let rows = []
  if (yc) {
    rows = [...yc.querySelectorAll('tbody tr')].map(tr =>
      [...tr.querySelectorAll('td')].map(td => (td.textContent || '').replace(/\s+/g, ' ').trim()))
  }
  const achvTbl = document.querySelector('.achv-card table.tbl')
  const achvRows = achvTbl ? [...achvTbl.querySelectorAll('tbody tr')].map(tr =>
    [...tr.querySelectorAll('td')].map(td => {
      const i = td.querySelector('input')
      return i ? '{' + (String(i.value) === '' ? '空' : String(i.value)) + '}' : (td.textContent || '').replace(/\s+/g, ' ').trim()
    })) : []
  return {
    ySumAch: rows.reduce((s, r) => s + num(r[2]), 0),
    ySumTarget: rows.reduce((s, r) => s + num(r[1]), 0),
    yRows: rows.map(r => r.join('|')),
    achvRows,
    barText: (document.querySelector('.achv-bar') || {}).textContent,
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
  await p.setViewport({ width: 1440, height: 1100, deviceScaleFactor: 1 })
  await p.evaluateOnNewDocument((t, ten) => {
    localStorage.setItem('hergent_v2_token', t)
    localStorage.setItem('hergent_v2_tenant', String(ten))
    localStorage.setItem('hergent_v2_user', JSON.stringify({ role: 'boss', username: 'sbx_period', display_name: '桶可见性' }))
  }, TOKEN, TENANT)

  const load = async () => {
    await p.goto(`${BASE}/?cb=${Date.now()}#/rebate`, { waitUntil: 'networkidle2', timeout: 60000 })
    await sleep(6500)
    await p.evaluate(() => {
      const x = [...document.querySelectorAll('.main-tab')].find(e => (e.textContent || '').indexOf('达成填报') >= 0)
      if (x) x.click()
    })
    await sleep(6500)
  }

  console.log('\n########## 季/年桶「图表可见性」验证  tenant=' + TENANT + ' ##########')
  console.log('\n--- ① 基线（注入前）---')
  await load()
  const before = await p.evaluate(probe)
  console.log('  全年对比表 月度目标合计 = ¥' + before.ySumTarget.toLocaleString())
  console.log('  全年对比表 实际达成合计 = ¥' + before.ySumAch.toLocaleString())
  console.log('  当前填报表格行数 = ' + before.achvRows.length)
  await p.screenshot({ path: `${OUT}/baseline-full.png`, fullPage: true })

  console.log('\n--- ② 注入沙箱：2026-Q3 记 999,999 / 2026 记 888,888 ---')
  try {
    execSync(`scp -o ConnectTimeout=15 /tmp/sandbox_bucket_inject.py ${HOST}:/tmp/`, { stdio: 'pipe' })
    const out = execSync(
      `ssh -o ConnectTimeout=20 ${HOST} 'cd /opt/hergent-erp && set -a && . ./.env && set +a && ` +
      `runuser -u hergent --preserve-environment -- python3 /tmp/sandbox_bucket_inject.py'`,
      { stdio: 'pipe', encoding: 'utf8' })
    console.log(out.trim().split('\n').map(l => '    ' + l).join('\n'))
  } catch (e) {
    console.log('  注入失败:', (e.stdout || '') + (e.stderr || '') + e.message)
  }

  console.log('\n--- ③ 注入后重抓（图表侧）---')
  await load()
  const after = await p.evaluate(probe)
  console.log('  全年对比表 月度目标合计 = ¥' + after.ySumTarget.toLocaleString())
  console.log('  全年对比表 实际达成合计 = ¥' + after.ySumAch.toLocaleString())
  const delta = after.ySumAch - before.ySumAch
  console.log('  达成合计变化 = ¥' + delta.toLocaleString())
  console.log('  （注入总额 = ¥1,888,887）')
  console.log(delta === 0
    ? '  ✅ 图表侧完全读不到季/年桶数据（合计未变）'
    : '  ⚠️ 图表侧读到了部分数据，变化 ¥' + delta.toLocaleString())
  await p.screenshot({ path: `${OUT}/after-inject-full.png`, fullPage: true })

  console.log('\n--- ④ 切「按季」口径，看填报表格能否看见那条 ---')
  await p.evaluate(() => {
    const s = document.querySelector('.achv-period')
    if (s) { s.value = 'quarter'; s.dispatchEvent(new Event('change', { bubbles: true })) }
  })
  await sleep(5500)
  const q = await p.evaluate(probe)
  console.log('  工具行:', (q.barText || '').replace(/\s+/g, ' ').trim())
  q.achvRows.forEach((r, i) => console.log('    [' + (i + 1) + '] ' + r.join(' | ')))
  const seen = JSON.stringify(q.achvRows).indexOf('999999') >= 0
  console.log(seen ? '  ✅ 按季口径下这条数据「看得见」' : '  ❌ 按季口径下也看不到')
  await p.screenshot({ path: `${OUT}/quarter-with-injected.png`, fullPage: true })

  console.log('\n截图: ' + OUT)
  await b.close()
})().catch(e => { console.error('FATAL', e); process.exit(1) })
