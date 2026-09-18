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

// 浏览器内：主 Tab 快照（标签 / 哪个高亮 / 两个 tab 各有的地标在不在）
// ⚠️ 用**精确类名** .main-tabs / .main-tab / .la-tbar / .la-bar / .dsh——
//   禁用 [class*=]，同前缀元素会抢先命中（本项目「探针偏航」铁律）。
function snapTabs() {
  const btns = [...document.querySelectorAll('.main-tabs .main-tab')]
  const on = btns.find(x => x.classList.contains('on'))
  return {
    labels: btns.map(x => (x.textContent || '').replace(/\s+/g, ' ').trim()),
    on: on ? (on.textContent || '').trim() : '',
    // 仪表盘地标：趋势筛选条 + 仪表盘组件根
    hasDash: !!document.querySelector('.la-tbar') && !!document.querySelector('section.dsh'),
    // 数据填报地标：工具条 + 主表
    hasFill: !!document.querySelector('.la-bar') && !!document.querySelector('table.la-tbl'),
    // 月列表（只在仪表盘 tab）
    hasMonthList: !!document.querySelector('.la-ml-tbl'),
  }
}

// 浏览器内：按文字点主 Tab
function clickMainTab(label) {
  const b = [...document.querySelectorAll('.main-tabs .main-tab')]
    .find(x => (x.textContent || '').trim() === label)
  if (!b) return false
  b.click()
  return true
}

/* 浏览器内：`临期销售` 列位（slot=ded）× 各组 ③ 行的填报能力快照。
 * ⚠️ 全部用**精确类名**（table.la-tbl / tr.la-grp / tr.la-row / tr.la-sub / input.la-input），
 *   禁用 [class*=] —— 本项目「探针偏航」铁律（同前缀元素会抢先命中）。
 * ⚠️ 列下标由**表头文字**现取（不是写死第 3 格）：表尾是另一张 table、
 *   列序由后端 col_defs 派生，写死下标会在加列时静默测错列。 */
function snapColDed() {
  const t = document.querySelector('table.la-tbl')
  if (!t) return null
  const ths = [...t.querySelectorAll('thead th')].map(x => (x.textContent || '').replace(/\s+/g, ' ').trim())
  const dedIdx = ths.findIndex(x => x.includes('临期销售'))
  const kids = [...t.querySelectorAll('tbody tr')]
  const txt = x => (x ? (x.textContent || '').replace(/\s+/g, ' ').trim() : '')
  function infoOf(noChar) {
    const gi = kids.findIndex(tr => tr.classList.contains('la-grp') && txt(tr).includes(noChar))
    if (gi < 0) return null
    const rest = kids.slice(gi + 1)
    const row = rest.find(tr => tr.classList.contains('la-row'))
    const sub = rest.find(tr => tr.classList.contains('la-sub'))
    const cell = tr => (tr ? ([...tr.querySelectorAll('td')][dedIdx] || null) : null)
    const c = cell(row)
    const inp = c ? c.querySelector('input.la-input') : null
    return {
      grp: txt(kids[gi]).slice(0, 24),
      rowTxt: txt(c) || '(无行)',
      hasInput: !!inp,
      inputVal: inp ? inp.value : null,
      subTxt: txt(cell(sub)) || '(无小计)',
    }
  }
  return {
    nTh: ths.length, dedIdx, headers: ths,
    hdrHasOld: ths.some(x => x.includes('抵扣')),
    store: infoOf('①'), operator: infoOf('②'), direct: infoOf('③'), wastage: infoOf('④'),
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

  console.log('\n# 1.5) 主 Tab（「仪表盘」/「数据填报」分页 · 对齐「目标与返利」页）')
  let tb = await page.evaluate(snapTabs)
  info('tab: ' + tb.labels.join(' / ') + '   当前: ' + tb.on)
  ok(tb.labels.length === 2, '主 Tab 恰好两个', tb.labels.join(' / '))
  ok(tb.labels.join('|') === '仪表盘|数据填报', 'tab 文案与顺序与需求一致', tb.labels.join('|'))
  ok(tb.on === '仪表盘', '默认落在「仪表盘」（与「目标与返利」一致）', tb.on)
  ok(tb.hasDash && tb.hasMonthList, '仪表盘态：趋势地标 + 月列表都在')
  ok(!tb.hasFill, '仪表盘态：填报地标（工具条/主表）不在')

  // 切到「数据填报」—— 下面 # 2 ~ # 6 全部在这一屏跑（工具条 / 主表 / 录入态都在这里）
  await page.evaluate(clickMainTab, '数据填报')
  await sleep(600)
  tb = await page.evaluate(snapTabs)
  ok(tb.on === '数据填报', '点「数据填报」后高亮跟着切', tb.on)
  ok(tb.hasFill, '数据填报态：工具条 + 主表都在')
  ok(!tb.hasDash && !tb.hasMonthList, '数据填报态：趋势与月列表**已移除**（不是藏起来）')

  console.log('\n# 2) 公司卡与主表（数据填报 tab）')
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

  console.log('\n# 4.5) ③ 直调行的「临期销售」列位（只读态）')
  const ded = await page.evaluate(snapColDed)
  if (!ded) ok(false, '主表可读（snapColDed）')
  else {
    info('表头: ' + ded.headers.join(' | '))
    ok(ded.dedIdx >= 0, '表头含「临期销售」列位', '第 ' + (ded.dedIdx + 1) + ' 格 = ' + ded.headers[ded.dedIdx])
    ok(!ded.hdrHasOld, '表头已不叫「临期销售抵扣」（本次改名）')
    const pageHasOld = await page.evaluate(() => (document.body.innerText || '').match(/临期销售抵扣/g) || [])
    ok(pageHasOld.length === 0, '整页正文无「临期销售抵扣」旧词', 'x' + pageHasOld.length)
    ok(!!ded.direct, '③ 良品仓直调临期仓 组在', (ded.direct || {}).grp)
    if (ded.direct) {
      // 生产租户（mptest / 永诺旗舰店）该期零录入 ⇒ 只读态应显示「—」而不是 0
      // （0 会被读成"一分钱没卖回来" —— 「零值即健康」陷阱）
      info('③ 行该格: ' + ded.direct.rowTxt + '   ③ 小计该格: ' + ded.direct.subTxt)
      ok(!ded.direct.hasInput, '只读态 ③ 行该格不是输入框')
      ok(ded.direct.rowTxt === '—', '③ 行未填 ⇒ 显示「—」（不是 0）', ded.direct.rowTxt)
      ok(ded.direct.subTxt === '—', '③ 组小计未填 ⇒ 显示「—」（不是 0）', ded.direct.subTxt)
    }
    // scope 收紧：该列只含 ③，① / ④ 不该有这个格子
    info('① 行: ' + (ded.store || {}).rowTxt + '   ④ 行: ' + (ded.wastage || {}).rowTxt)
    ok((ded.store || {}).rowTxt === '—', '① 门店退货行该列显示「—」（列位 scope 不含它）', (ded.store || {}).rowTxt)
    ok((ded.wastage || {}).rowTxt === '—', '④ 报损行该列显示「—」', (ded.wastage || {}).rowTxt)
  }

  // ── 4.6) 「临期销售」三个粒度必须同一个词（直读真数据 payload） ────────
  //   为什么读 payload 而不读 DOM：`col_defs[].label` 在页面上**不直接显示** ——
  //   它进的是「保存时的校验错误提示」与「溯源 / 修改日志的字段名」，DOM 里只有列位表头。
  //   所以"三个粒度是不是同一个词"这条判据只能在数据层取，读 DOM 会误判成"通过"。
  console.log('\n# 4.6) 「临期销售」三粒度标签统一（直读 payload）')
  const lab = await page.evaluate(async () => {
    const r = await fetch('/api/loss/accounting/bootstrap', {
      headers: { Authorization: 'Bearer ' + (localStorage.getItem('hergent_v2_token') || '') },
    })
    const j = await r.json()
    const d = j.data || j
    const cd = d.col_defs || []
    const pick = k => (cd.find(x => x.key === k) || {}).label || null
    const ded = (d.slots || []).find(s => s.key === 'ded') || {}
    return { http: r.status, slot: ded.label, op: pick('op_loss_sale_amt'),
             direct: pick('direct_loss_sale_amt'), whole: JSON.stringify(d) }
  })
  ok(lab.http === 200, 'bootstrap 可直读（HTTP 200）', 'HTTP ' + lab.http)
  info('列位表头 / ② 行 / ③ 行 = ' + [lab.slot, lab.op, lab.direct].join(' / '))
  const labs = [lab.slot, lab.op, lab.direct]
  ok(labs.every(x => x === '临期销售'), '三个粒度都是「临期销售」', JSON.stringify(labs))
  // ⭐ 逐个"等于新词"只保证各自对；这条才保证**互相一致** —— 将来谁只改一处会漏检。
  ok(new Set(labs).size === 1, '三个粒度是**同一个词**（不是各自"碰巧都对"）', JSON.stringify(labs))
  for (const oldWord of ['临期销售抵扣', '临期销售额', '临期货销售额']) {
    ok(lab.whole.indexOf(oldWord) === -1, 'payload 全量无旧变体「' + oldWord + '」',
       'x' + (lab.whole.split(oldWord).length - 1))
  }

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

  console.log('\n# 5.5) ③ 直调行的「临期销售」填报入口（录入态 · 只开不写）')
  const dedEd = await page.evaluate(snapColDed)
  if (!dedEd) ok(false, '录入态主表可读')
  else {
    ok(!!dedEd.direct, '录入态下 ③ 组仍在', (dedEd.direct || {}).grp)
    if (dedEd.direct) {
      // 🔴 本轮需求的正面证据：③ 行这一格在录入态必须是**可填输入框**
      ok(dedEd.direct.hasInput, '🔴 ③ 行「临期销售」是可填输入框（本轮新增的填报入口）',
        'input=' + dedEd.direct.hasInput + ' value=' + JSON.stringify(dedEd.direct.inputVal))
      const inpCount = await page.evaluate(() => {
        const t = document.querySelector('table.la-tbl')
        const ths = [...t.querySelectorAll('thead th')].map(x => (x.textContent || '').replace(/\s+/g, ' ').trim())
        const i = ths.findIndex(x => x.includes('临期销售'))
        const kids = [...t.querySelectorAll('tbody tr')]
        const gi = kids.findIndex(tr => tr.classList.contains('la-grp') && (tr.textContent || '').includes('③'))
        const row = kids.slice(gi + 1).find(tr => tr.classList.contains('la-row'))
        return { n: row ? row.querySelectorAll('input.la-input').length : -1, col: i }
      })
      info('③ 行录入态输入框总数 = ' + inpCount.n + '（该列下标 ' + inpCount.col + '）')
      ok(inpCount.n === 2, '③ 行录入态恰好 2 个输入框（直调临期仓额 + 临期销售）', inpCount.n + ' 个')
    }
    // 回归闸：② 业务员的抵扣列必须照旧可填（同一 slot 的另一列，不能被本轮的 scope 收紧误伤）
    ok((dedEd.operator || {}).hasInput === true, '② 业务员行该列照旧是可填输入框（回归闸）', (dedEd.operator || {}).grp)
    // scope 收紧：① / ④ 不该出现输入框
    ok((dedEd.store || {}).hasInput === false, '① 门店退货行该列无输入框（scope 只含 ②③）', (dedEd.store || {}).rowTxt)
    ok((dedEd.wastage || {}).hasInput === false, '④ 报损行该列无输入框', (dedEd.wastage || {}).rowTxt)
  }

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

  console.log('\n# 6.5) 趋势仪表盘（v185 · 生产上无录入时走空态，同样要验）')
  // 先切回「仪表盘」：本段全部断言都建立在那一屏（# 2~# 6 已把页面停在数据填报 tab）
  await page.evaluate(clickMainTab, '仪表盘')
  await sleep(900)
  const backTb = await page.evaluate(snapTabs)
  ok(backTb.on === '仪表盘', '切回「仪表盘」后高亮跟着回', backTb.on)
  ok(backTb.hasDash && backTb.hasMonthList, '切回后趋势地标 + 月列表都回来了')
  ok(!backTb.hasFill, '切回后填报地标（工具条/主表）已移除')

  const dsh = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.la-ml-tbl tbody tr')]
    const rate = rows.map(tr => ((tr.querySelectorAll('td')[4] || {}).textContent || '').trim())
    const comp = rows.map(tr => ((tr.querySelectorAll('td')[6] || {}).textContent || '').trim())
    return {
      has: !!document.querySelector('.dsh'),
      bar: !!document.querySelector('.la-tbar'),
      nRows: rows.length,
      first: ((rows[0] || {}).textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24),
      rateTexts: [...new Set(rate)].filter(t => t && t !== '—'),
      compStates: [...new Set(comp)],
      kpis: document.querySelectorAll('.kpi-strip .kpi').length,
      // v187 视觉重做：概览条必须收敛到全站规范的 .kpi-strip，旧自造类必须消失；
      // 图表配色必须走本组件的 --c-* token（读得到即有值）
      oldKpis: document.querySelectorAll('.dsh-kpis, .dsh .k').length,
      cGross: (() => {
        const d = document.querySelector('.dsh')
        return d ? getComputedStyle(d).getPropertyValue('--c-gross').trim() : ''
      })(),
      cards: document.querySelectorAll('.dsh-card').length,
      svgs: document.querySelectorAll('.dsh-svg svg').length,
      empty: ((document.querySelector('.dsh-empty') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
      rank: document.querySelectorAll('.rk-row').length,
      // 「万元」与「%」两个单位必须同时出现在主图上（双轴各自标注）
      units: [...document.querySelectorAll('.dsh text.ax-u')].map(t => t.textContent.trim()),
      // 月列表操作列：分 tab 后文案由「查看」改为「去填报」（点它 = 切月 + 跳填报 tab）
      ops: [...new Set([...document.querySelectorAll('.la-ml-op')].map(td => (td.textContent || '').trim()))],
    }
  })
  ok(dsh.has, '趋势仪表盘已渲染')
  ok(dsh.bar, '趋势区间筛选条在')
  ok(dsh.ops.join('|') === '去填报', '月列表操作列文案 = 「去填报」', dsh.ops.join('|'))
  ok(dsh.nRows === 12, '月列表 = 默认近 12 个月', dsh.nRows + ' 行')
  ok(/^\d{4}-\d{2}/.test(dsh.first), '首行是最新月份（降序）', dsh.first)
  const hasCharts = dsh.cards > 0
  if (hasCharts) {
    ok(dsh.kpis === 5, '5 项概览，承载形态 = 全站规范的 .kpi-strip', dsh.kpis)
    ok(dsh.oldKpis === 0, '旧自造 KPI 类已消失（.dsh-kpis / .dsh .k）', 'count=' + dsh.oldKpis)
    ok(!!dsh.cGross, '图表色 token --c-gross 在生产真的生效', dsh.cGross || '(空)')
    ok(dsh.cards === 4, '4 张图卡', dsh.cards)
    // v187：柱群不得超列宽。副图 B 有**三根**柱，是唯一会溢出的那张 ——
    // 生产默认区间是 12 个月、列宽只 ~79px，正是这个缺陷的暴露场景
    // （以前"藏"着是因为只有最右列有数据，右边恰有 padR 的空间接住它）。
    const fit = await page.evaluate(() => {
      const svgs = [...document.querySelectorAll('.dsh-svg svg')]
      if (svgs.length < 3) return { slot: 0, span: 0, n: 0 }
      const xl = [...svgs[0].querySelectorAll('text.xl-m')].map(t => +t.getAttribute('x'))
      const slot = xl.length > 1 ? Math.abs(xl[1] - xl[0]) : 0
      const spans = [...svgs[2].querySelectorAll('g.bars')].map(g => {
        const rs = [...g.querySelectorAll('rect')]
        if (!rs.length) return 0
        const min = Math.min(...rs.map(r => +r.getAttribute('x')))
        const max = Math.max(...rs.map(r => +r.getAttribute('x') + +r.getAttribute('width')))
        return max - min
      })
      return { slot, span: spans.length ? Math.max(...spans) : 0, n: spans.length }
    })
    if (fit.n === 0 || !fit.slot) {
      info('柱群宽度检查：跳过（当前区间没有可比的有数据月）')
    } else {
      ok(fit.span <= fit.slot, '副图 B（3 根柱）柱群不超列宽（否则会挤进相邻月份）',
        '群宽 ' + fit.span.toFixed(1) + ' vs 列宽 ' + fit.slot.toFixed(1))
    }
    ok(dsh.svgs === 3, '3 个 SVG 图', dsh.svgs)
    ok(dsh.units.includes('万元') && dsh.units.includes('%'),
      '主图双轴各带单位（柱=万元 / 线=%）', dsh.units.join('/'))
    info('主体排行 ' + dsh.rank + ' 条')
  } else {
    ok(/录入/.test(dsh.empty), '生产暂无录入 ⇒ 显示空态且**说清了原因**', dsh.empty.slice(0, 60))
  }
  /* 完整度只允许三态；环比只允许「%」（金额）、「个百分点」（率）、『上月未录入/首次/—』 */
  ok(dsh.compStates.every(t => /^(完整|未录入|缺 \d+ 项)$/.test(t)),
    '完整度列只有三态（完整 / 未录入 / 缺 N 项）', dsh.compStates.join(' | '))
  ok(dsh.rateTexts.every(t => /个百分点$/.test(t) || /^(上月未录入|首次)$/.test(t)),
    '净率变化一律用「个百分点」（不是 %）', dsh.rateTexts.slice(0, 3).join(' | ') || '（本期全为 —）')
  if (hasCharts) {
    await (await page.$('.dsh')).screenshot({ path: OUT + '/loss-accounting-prod-dashboard.png' })
    info('仪表盘截图: ' + OUT + '/loss-accounting-prod-dashboard.png')
  }

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
