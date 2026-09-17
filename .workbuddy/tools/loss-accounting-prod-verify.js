/* 货损核算页 /loss-accounting 生产真机只读验收（v184 首次入库）
 *
 * 用途：每次前端重新发布后，用**线上真实产物**复核页面仍可用 —— 因为 dist 是整体构建，
 *       一次无关的重新发布也可能把本页带坏（构建从工作区取，会同时含在途改动）。
 *
 * ⚠️ 只读原则：只「打开录入态 → 数输入框 → 退出」，**绝不写入**。生产 tenant_1 不接受写操作。
 *    安全依据：本轮零改动 ⇒ 应改格数为 0 ⇒ 「保存」按钮应当处于 disabled。
 *
 * 用法: HG_TOKEN=<t> node loss-accounting-prod-verify.js
 *      取 token: POST https://hergent.cn/api/auth/login {"username":"mptest","password":"Mptest@1"}
 *      复跑想换截图目录: 设 HG_OUT=<dir>
 */
const puppeteer = require('puppeteer-core')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = 'https://hergent.cn'
const OUT = process.env.HG_OUT || '/Users/zhangjunfeng/Documents/laozhangai-product/outputs'
const TOKEN = process.env.HG_TOKEN
const TENANT = process.env.HG_TENANT || '1'
const sleep = ms => new Promise(r => setTimeout(r, ms))

const results = []
let failed = 0
function ok(cond, label, extra) {
  if (!cond) failed++
  results.push({ pass: !!cond, label })
  console.log((cond ? '  ✓ ' : '  ✗ ') + label + (extra ? '   [' + extra + ']' : ''))
}
function info(m) { console.log('  · ' + m) }

// 浏览器内：主表结构（表头列位 / 行分组 / 数据行 / 小计 / 表尾）
function snapTable() {
  const t = document.querySelector('table.la-tbl')
  if (!t) return null
  const ths = [...t.querySelectorAll('thead th')].map(x => (x.textContent || '').replace(/\s+/g, ' ').trim())
  const grps = [...t.querySelectorAll('tbody tr.la-grp')].map(tr => ({
    name: (tr.querySelector('.la-grp-name') || {}).textContent || '',
    den: (tr.querySelector('.la-grp-den') || {}).textContent || '',
    noratio: !!tr.querySelector('.la-grp-noratio'),
  }))
  return {
    nTh: ths.length, ths,
    nGrp: grps.length, grps,
    nRow: t.querySelectorAll('tbody tr.la-row').length,
    // 空的「还没有门店 / 还没有业务员」占位行 —— 它也算 .la-row，
    // 直接数 .la-row 会把占位行当成数据行，进而误判「可填格太少」
    nBlank: t.querySelectorAll('tbody tr.la-row-blank').length,
    rowNames: [...t.querySelectorAll('tbody tr.la-row .la-subj-name')].map(x => (x.textContent || '').trim()),
    addBtns: [...t.querySelectorAll('tbody button.la-add')].map(x => (x.textContent || '').replace(/\s+/g, ' ').trim()),
    nSub: t.querySelectorAll('tbody tr.la-sub').length,
    hasFoot: !!t.querySelector('tfoot tr.la-foot'),
    footTxt: ((t.querySelector('tfoot tr.la-foot') || {}).textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
    coFormula: ((document.querySelector('.la-co-formula') || {}).textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
    kpis: [...document.querySelectorAll('.la-kpi')].length,
    hint: ((document.querySelector('.la-subj-th') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
  }
}

// 浏览器内：工具栏按钮文案（用来确认关键动作还在）
function snapBar() {
  const bar = document.querySelector('.la-bar')
  if (!bar) return null
  return [...bar.querySelectorAll('button')].map(b => (b.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean)
}

// 浏览器内：侧栏是否有入口 + 是否残留被删的旧入口
function snapSidebar() {
  const txt = [...document.querySelectorAll('a, .nav-item, .side-item, .menu-item, li')]
    .map(x => (x.textContent || '').replace(/\s+/g, ' ').trim())
  return {
    acc: txt.filter(x => x === '货损核算' || x.startsWith('货损核算')).length,
    // 🔴 v185：侧栏「货损计算」入口已删（仅保留货损核算）。
    //   这条断言就是那个需求的回归闸 —— 页面正文与侧栏都在 body.innerText 里，
    //   本页是 /loss-accounting，所以出现「货损计算」即说明旧入口又回来了。
    calc: txt.filter(x => x === '货损计算' || x.startsWith('货损计算')).length,
  }
}

async function main() {
  if (!TOKEN) { console.error('缺 HG_TOKEN'); process.exit(2) }
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--force-device-scale-factor=1'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1680, height: 1000, deviceScaleFactor: 1 })
  const errs = [], bad = []
  page.on('pageerror', e => errs.push('pageerror: ' + e.message))
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 160)) })
  page.on('response', r => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url().slice(0, 100)) })

  await page.evaluateOnNewDocument((t, ten) => {
    localStorage.setItem('hergent_v2_token', t)
    localStorage.setItem('hergent_v2_tenant', String(ten))
    localStorage.setItem('hergent_v2_user', JSON.stringify({ role: 'sales', username: 'ro_verify', display_name: '只读验收' }))
  }, TOKEN, TENANT)

  // ⚠️ 绝不加 --proxy-server；?cb= 打掉中间缓存（.workbuddy 里有「探针偏航」的教训）
  const url = BASE + '/?cb=' + Date.now() + '#/loss-accounting'
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 })
  await sleep(2500)

  console.log('\n# 1) 落点与标题')
  const cur = page.url()
  info('url = ' + cur)
  ok(!/#\/login/.test(cur), '未被打回登录页（注入生效）')
  const title = await page.$eval('body', () => (document.body.innerText || '').slice(0, 200).replace(/\s+/g, ' '))
  info('正文开头: ' + title.slice(0, 120))
  ok(/货损核算/.test(title), '页面标题含「货损核算」')

  console.log('\n# 2) 公司卡与主表')
  const t = await page.evaluate(snapTable)
  if (!t) ok(false, '找到主表 table.la-tbl')
  else {
    ok(true, '找到主表 table.la-tbl')
    ok(t.nTh >= 3, '表头列位齐全', t.nTh + ' 列：' + t.ths.join(' | '))
    ok(t.nGrp >= 1, '存在行分组', t.nGrp + ' 组')
    t.grpDetail = t.grps.map(g => g.name + (g.noratio ? '（无分母 · 不给率）' : '')).join(' ; ')
    info('分组: ' + t.grpDetail)
    ok(t.nRow >= 1, '有数据行', t.nRow + ' 行（含空占位 ' + t.nBlank + ' 行）')
    if (t.rowNames.length) info('主体: ' + t.rowNames.join(' / '))
    if (t.addBtns.length) info('主体新增按钮（录入态才显示）: ' + t.addBtns.join(' / '))
    ok(t.nSub >= 1, '有「小计」行', t.nSub + ' 行')
    ok(t.hasFoot, '有表尾合计校验行', t.footTxt)
    info('公司卡公式: ' + t.coFormula)
    ok(t.kpis >= 3, '公司卡 KPI 块齐全', t.kpis + ' 个')
    ok(/分子 =/.test(t.coFormula), '公司卡显式写出分子/分母口径', t.coFormula)
  }

  console.log('\n# 3) 工具栏')
  const bar = await page.evaluate(snapBar)
  info('按钮: ' + (bar || []).join(' / '))
  ok(bar && bar.includes('手工录入'), '「手工录入」按钮在（第一优先功能）')
  ok(bar && bar.includes('上传数据'), '「上传数据」（导入扩展位）按钮在')

  console.log('\n# 4) 侧栏入口（仅保留「货损核算」）')
  const sb = await page.evaluate(snapSidebar)
  ok(sb.acc >= 1, '侧栏有「货损核算」入口', sb.acc + ' 处')
  ok(sb.calc === 0, '侧栏已无「货损计算」入口', sb.calc + ' 处')
  const bodyHas = await page.evaluate(() => {
    const t = document.body.innerText || ''
    return { calc: (t.match(/货损计算/g) || []).length, acc: (t.match(/货损核算/g) || []).length }
  })
  ok(bodyHas.calc === 0, '整页正文（含导航）不含「货损计算」', 'x' + bodyHas.calc)
  info('正文「货损核算」出现 ' + bodyHas.acc + ' 次')

  console.log('\n# 5) 录入态（只开不写）')
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.la-bar button')].find(x => /手工录入/.test(x.textContent || ''))
    if (b) b.click()
  })
  await sleep(900)
  const ed = await page.evaluate(() => {
    const barEl = document.querySelector('.la-editbar')
    const saveBtn = [...document.querySelectorAll('.la-editbar button')].find(x => /保存/.test(x.textContent || ''))
    const giveBtn = [...document.querySelectorAll('.la-editbar button')].find(x => /放弃/.test(x.textContent || ''))
    return {
      hasBar: !!barEl,
      barTxt: barEl ? (barEl.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 70) : '',
      nInput: document.querySelectorAll('.la-editbar input.la-input, td.la-cell input.la-input').length,
      units: [...new Set([...document.querySelectorAll('.la-cell .la-unit')].map(x => (x.textContent || '').trim()))],
      saveDisabled: saveBtn ? saveBtn.disabled : null,
      hasGive: !!giveBtn,
    }
  })
  ok(ed.hasBar, '进入录入态出现工具条 .la-editbar', ed.barTxt)
  ok(ed.nInput >= 1, '出现可录输入框', ed.nInput + ' 个')
  info('单元格单位: ' + (ed.units || []).join(' / '))
  ok(ed.hasGive, '「放弃修改」按钮在')
  ok(ed.saveDisabled === true, '零改动时「保存」为 disabled（写路径有闸）', 'disabled=' + ed.saveDisabled)

  console.log('\n# 6) 退出录入态（不保存）')
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.la-bar button')].find(x => /完成录入/.test(x.textContent || ''))
    if (b) b.click()
  })
  await sleep(700)
  const out = await page.evaluate(() => !!document.querySelector('.la-editbar') === false && !!document.querySelector('table.la-tbl'))
  ok(out, '已退出录入态且主表仍在')

  await page.screenshot({ path: OUT + '/loss-accounting-prod-verify.png', fullPage: false })
  info('截图: ' + OUT + '/loss-accounting-prod-verify.png')

  console.log('\n# 7) 错误与 4xx/5xx')
  // 🔴 已知全局既有项（**不是本页的问题，别追**）：副驾组件调 /api/ai/roles，
  //    sales 角色没有 AI 模块权限 ⇒ 恒 403。已在 dashboard / forecast / loss-accounting
  //    三页对照确认为全局现象（2026-09-17 归因）。只把它单列出来，不影响其余断言。
  const KNOWN = /\/api\/ai\/roles/
  const knownBad = bad.filter(x => KNOWN.test(x))
  const unexpected = bad.filter(x => !KNOWN.test(x))
  let realErrs = errs.filter(e => !/favicon/i.test(e))
  if (knownBad.length && !unexpected.length) {
    // 控制台的 "Failed to load resource ... 403" 没有 URL，只能靠「其余 4xx 为空」来归属
    realErrs = realErrs.filter(e => !/status of 403/.test(e))
  }
  info('页面错误 ' + realErrs.length + ' 条' + (realErrs.length ? ': ' + realErrs.slice(0, 3).join(' || ') : ''))
  const badAgg = {}
  unexpected.forEach(x => { const k = x.slice(0, 34); badAgg[k] = (badAgg[k] || 0) + 1 })
  info('非 2xx 响应 ' + unexpected.length + ' 条' + (unexpected.length ? ': ' + Object.entries(badAgg).map(([k, v]) => k + '×' + v).join(' ; ') : ''))
  if (knownBad.length) info('（已归因的全局既有项 ' + knownBad.length + ' 条：' + knownBad[0] + '）')
  ok(realErrs.length === 0, '页面无 JS 报错')
  ok(unexpected.length === 0, '无非预期 4xx/5xx')

  await browser.close()
  console.log('\n==== 结果: ' + (results.length - failed) + '/' + results.length + ' 通过，失败 ' + failed + ' ====')
  process.exit(failed ? 1 : 0)
}
main().catch(e => { console.error('崩溃: ' + e.message); process.exit(3) })
