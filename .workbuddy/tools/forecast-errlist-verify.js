// 本期预报「查错」明细面板 · 真机验证（hergent.cn，隔离租户）
// ------------------------------------------------------------------
// 用户诉求：「点击改单后出现一个查错按钮，点它后要能看出**到底哪里错了**」。
// 本探针做两件事：
//   MODE=before → 客观采集「点『查错』前后 DOM 有无变化」，为缺陷提供硬证据
//   MODE=after  → 验收明细面板：分组汇总 / 逐条位置 / 点击跳转聚焦 / 改对后实时消失
//
// 用法:
//   HG_TOKEN=<token> HG_TENANT=9998 MODE=before node forecast-errlist-verify.js
//
// 全程只读落库：制造错误只改前端内存（不点「保存」），沙箱销毁即消失。
const puppeteer = require('puppeteer-core')

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = 'https://hergent.cn'
const TOKEN = process.env.HG_TOKEN
const TENANT = process.env.HG_TENANT || '9998'
const MODE = process.env.MODE || 'after'
const OUT = process.env.OUT || '/Users/zhangjunfeng/Documents/laozhangai-product/outputs'

const results = []
function ok(cond, label, extra) {
  results.push({ pass: !!cond, label })
  console.log((cond ? '  ✓ ' : '  ✗ ') + label + (extra ? '   ' + extra : ''))
}
function info(m) { console.log('  · ' + m) }
const sleep = ms => new Promise(r => setTimeout(r, ms))

/* ⚠️ page.evaluate 只序列化函数自身源码 → 采集器一律自包含，不引用外部变量 */

// 客观 UI 快照：用于「点前 vs 点后」比对
function snapUI() {
  const panels = [...document.querySelectorAll('.info-panel')].map(p => ({
    title: ((p.querySelector('.panel-hd b') || {}).textContent || '').trim(),
    n: p.querySelectorAll('li').length,
  }))
  const badge = document.querySelector('.btn-badge.err')
  const PHRASES = ['数量过大', '商品名称必填', '条码重复', '必须是数字', '不能为负数', '必须为整数']
  let hits = []
  document.querySelectorAll('div,ul,ol,section,p,li').forEach(el => {
    if (el.children.length > 3) return
    const t = (el.textContent || '').trim().replace(/\s+/g, ' ')
    if (!t || t.length > 400) return
    if (PHRASES.some(k => t.includes(k))) hits.push({ cls: String(el.className).slice(0, 36), txt: t.slice(0, 140) })
  })
  return { panels, badge: badge ? badge.textContent.trim() : null, hits: hits.slice(0, 6), bodyLen: document.body.innerHTML.length }
}

// 错误面板采集（after）
function snapErrPanel() {
  // 面板按「查错」标题定位；退化为「含错误短语的 info-panel」
  let p = [...document.querySelectorAll('.info-panel')].find(x => /查错/.test((x.querySelector('.panel-hd b') || {}).textContent || ''))
  if (!p) p = [...document.querySelectorAll('.info-panel')].find(x => /数量过大|必填|重复/.test(x.textContent || ''))
  if (!p) return { open: false, otherPanels: [...document.querySelectorAll('.info-panel')].map(x => ((x.querySelector('.panel-hd b') || {}).textContent || '').trim()) }
  const txt = el => (el && el.textContent ? el.textContent.trim().replace(/\s+/g, ' ') : '')
  const items = [...p.querySelectorAll('.err-list li')].map(li => ({
    text: txt(li),
    cls: String(li.className),
    loc: (li.querySelector('.err-loc') || {}).textContent ? li.querySelector('.err-loc').textContent.trim().replace(/\s+/g, ' ') : '',
    why: (li.querySelector('.err-why') || {}).textContent ? li.querySelector('.err-why').textContent.trim().replace(/\s+/g, ' ') : '',
  }))
  return {
    open: true,
    title: txt(p.querySelector('.panel-hd b')),
    tag: txt(p.querySelector('.tag')),
    groups: [...p.querySelectorAll('.err-grp')].map(c => ({ text: txt(c), cls: String(c.className), on: /on/.test(String(c.className)) })),
    items,
    more: txt(p.querySelector('.err-more')),
    empty: txt(p.querySelector('.err-empty')),
    bodyScroll: (() => { const b = p.querySelector('.err-list-wrap'); return b ? b.scrollHeight - b.clientHeight : -1 })(),
    h: Math.round(p.getBoundingClientRect().height),
  }
}

async function main() {
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
    localStorage.setItem('hergent_v2_user', JSON.stringify({ role: 'boss', username: 'errcheck', display_name: '查错验证' }))
  }, TOKEN, TENANT)

  await page.goto(`${BASE}/?cb=${Date.now()}#/forecast`, { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(6000)
  ok(!/#\/login/.test(page.url()), '登录态注入成功（未被弹回 /#/login）')

  console.log('\n=== A. 进入编辑态 ===')
  const entered = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').trim() === '改单')
    if (!b) return false
    b.click(); return true
  })
  ok(entered, '点「改单」进入编辑态')
  if (!entered) { await browser.close(); process.exit(1) }
  await sleep(5000)

  const bar = await page.evaluate(() => {
    const g = document.querySelector('.tb-edit-group')
    if (!g) return null
    return [...g.querySelectorAll('button')].map(b => b.textContent.trim().replace(/\s+/g, ' '))
  })
  info('编辑组按钮: ' + JSON.stringify(bar))
  ok(!!bar && bar.some(t => /查错/.test(t)), '编辑组里有「查错」按钮')

  const grid = await page.evaluate(() => ({
    rows: document.querySelectorAll('input.cell-qty[data-c]').length,
    cols: [...new Set([...document.querySelectorAll('input[data-c]')].map(i => +i.dataset.c))].length,
  }))
  info('网格规模: 数量格 ' + grid.rows + ' 个 / 列 ' + grid.cols + ' 种')
  ok(grid.rows > 0, '编辑网格已渲染')

  /* ── B. 经界面制造 3 类真实错误（只改前端内存，不保存） ── */
  console.log('\n=== B. 制造错误（经真实输入）===')

  // 取第一页内某一行的「第一个客户数量列」与「条码列」
  const cells = await page.evaluate(() => {
    const qs = [...document.querySelectorAll('input.cell-qty[data-c]')].map(i => ({ r: +i.dataset.r, c: +i.dataset.c }))
    if (!qs.length) return null
    const rows = [...new Set(qs.map(x => x.r))].sort((a, b) => a - b)
    const qCols = [...new Set(qs.map(x => x.c))].sort((a, b) => a - b)
    const bc = document.querySelector('input[placeholder="条码"]')
    return {
      r0: rows[0], r1: rows[1] || rows[0],
      firstQtyC: qCols[0], maxQtyC: qCols[qCols.length - 1],
      barcodeC: bc ? +bc.dataset.c : -1,
      qtyCols: qCols.length,
    }
  })
  info('单元格定位: ' + JSON.stringify(cells))
  if (!cells) { await browser.close(); process.exit(1) }

  const typeInto = async (r, c, val) => {
    const sel = `input[data-r="${r}"][data-c="${c}"]`
    await page.click(sel, { clickCount: 3 })
    await page.keyboard.type(String(val))
    await page.keyboard.press('Tab')          // blur → 触发 @change
    await sleep(260)
  }
  const readQty = (r, c) => page.evaluate((rr, cc) => {
    const el = document.querySelector(`input[data-r="${rr}"][data-c="${cc}"]`)
    return el ? el.value : null
  }, r, c)

  // ① 数量过大（上限 999999）
  await typeInto(cells.r0, cells.firstQtyC, '99999999')
  const v1 = await readQty(cells.r0, cells.firstQtyC)
  ok(String(v1) === '99999999', `已写入超限数量（第 ${cells.r0 + 1} 行 · 列 ${cells.firstQtyC}）= ${v1}`)
  // ② 负数
  await typeInto(cells.r1, cells.firstQtyC, '-5')
  const v2 = await readQty(cells.r1, cells.firstQtyC)
  ok(String(v2) === '-5', `已写入负数（第 ${cells.r1 + 1} 行 · 列 ${cells.firstQtyC}）= ${v2}`)
  // ③ 条码重复（第二行抄第一行条码）
  let dupOk = false
  if (cells.barcodeC >= 0) {
    const bc0 = await page.evaluate((rr, cc) => {
      const el = document.querySelector(`input[data-r="${rr}"][data-c="${cc}"]`)
      return el ? String(el.value || '').trim() : ''
    }, cells.r0, cells.barcodeC)
    if (bc0) {
      await typeInto(cells.r1, cells.barcodeC, bc0)
      const bc1 = await page.evaluate((rr, cc) => {
        const el = document.querySelector(`input[data-r="${rr}"][data-c="${cc}"]`)
        return el ? String(el.value || '').trim() : ''
      }, cells.r1, cells.barcodeC)
      dupOk = bc1 === bc0
      info(`条码重复：第 ${cells.r0 + 1} 行「${bc0}」抄到第 ${cells.r1 + 1} 行 → ${bc1}`)
    } else info('⚠ 第 1 行条码为空，跳过条码重复用例')
  }
  ok(dupOk, '已制造「条码重复」错误', dupOk ? '' : '(条码列为空/未定位，本用例跳过)')

  await sleep(2600)   // 等角标节流刷新

  /* ── C. 点「查错」：前后 DOM 对比 ── */
  console.log('\n=== C. 点「查错」（' + MODE + ' 判据）===')
  const sBefore = await page.evaluate(snapUI)
  info('点前：角标=' + JSON.stringify(sBefore.badge) + ' 面板数=' + sBefore.panels.length + ' bodyLen=' + sBefore.bodyLen)

  const clicked = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /查错/.test(x.textContent || ''))
    if (!b) return false
    b.click(); return true
  })
  ok(clicked, '点到「查错」按钮')
  await sleep(1400)

  const sAfter = await page.evaluate(snapUI)
  info('点后：角标=' + JSON.stringify(sAfter.badge) + ' 面板数=' + sAfter.panels.length + ' bodyLen=' + sAfter.bodyLen)
  const delta = sAfter.bodyLen - sBefore.bodyLen
  info('DOM 体量变化 Δ=' + delta + ' ／ 新增含错误短语的元素 ' + sAfter.hits.filter(h => !sBefore.hits.some(b => b.txt === h.txt)).length + ' 个')

  const toastTxt = await page.evaluate(() => [...document.querySelectorAll('.toast')].map(x => x.textContent.trim()).join(' | '))
  info('toast: ' + JSON.stringify(toastTxt))

  if (MODE === 'before') {
    console.log('\n=== D. 缺陷判据（before）===')
    ok(!!sAfter.badge, '角标已出现（说明全表校验确实算出了错误）', 'badge=' + sAfter.badge)
    const newPanels = sAfter.panels.length - sBefore.panels.length
    const newHits = sAfter.hits.filter(h => !sBefore.hits.some(b => b.txt === h.txt))
    ok(newPanels === 0 && newHits.length === 0 && Math.abs(delta) < 50,
      '★ 点「查错」后界面上**没有任何明细出现**（复现用户痛点）',
      `新面板=${newPanels} 新短语元素=${newHits.length} Δ=${delta}`)
    ok(!toastTxt, '连 toast 都没有（点了一点反应都没有）', 'toast=' + JSON.stringify(toastTxt))
  } else {
    /* ── D. 明细面板验收 ── */
    console.log('\n=== D. 明细面板 ===')
    const P = await page.evaluate(snapErrPanel)
    ok(P.open, '★ 点「查错」后出现明细面板')
    if (!P.open) { info('实际面板: ' + JSON.stringify(P.otherPanels)); await browser.close(); process.exit(1) }
    info('标题=' + JSON.stringify(P.title) + ' 标签=' + JSON.stringify(P.tag) + ' 面板高=' + P.h + 'px')
    info('分组: ' + JSON.stringify(P.groups.map(g => g.text)))
    ok(P.groups.length >= 3, '按原因分了组（' + P.groups.length + ' 组）')
    ok(P.items.length >= 3, '逐条列出错误（' + P.items.length + ' 条）')
    const joined = P.items.map(i => i.text).join('\n')
    console.log('  ┌─ 明细 ────────────────────────────')
    P.items.slice(0, 6).forEach((i, n) => console.log(`  │ ${n + 1}. ${i.text}`))
    console.log('  └───────────────────────────────────')
    ok(/数量过大/.test(joined), '明细含「数量过大」')
    ok(/不能为负数/.test(joined), '明细含「不能为负数」')
    if (dupOk) ok(/条码重复/.test(joined), '明细含「条码重复」')
    ok(new RegExp(`第\\s*${cells.r0 + 1}\\s*行`).test(joined), `明细指出行号（含「第 ${cells.r0 + 1} 行」）`)
    ok(P.items.every(i => i.loc && i.why), '每一条都有「位置」与「原因」两段', P.items.slice(0, 2).map(i => i.loc + '||' + i.why).join(' / '))
    ok(!/undefined|NaN|\[object/.test(joined), '明细无生码（undefined/NaN/[object]）')
    ok(P.items.some(i => /^\d+\s*$/.test(i.loc.split('·')[0] || '') || /第\s*\d+\s*行/.test(i.loc)), '位置以行号开头', P.items[0] ? P.items[0].loc : '')
    await page.screenshot({ path: OUT + '/v174-查错明细面板.png' })

    // 点击第一条 → 跳转并聚焦该单元格
    const first = P.items[0]
    const wantR = +(String(first.loc).match(/第\s*(\d+)\s*行/) || [])[1]
    await page.evaluate(() => {
      const li = document.querySelector('.err-list li')
      if (li) li.click()
    })
    await sleep(1200)
    const focused = await page.evaluate(() => {
      const a = document.activeElement
      if (!a || !a.dataset) return null
      return { r: +a.dataset.r, c: +a.dataset.c, tag: a.tagName, val: a.value }
    })
    info('跳转后焦点: ' + JSON.stringify(focused) + '（明细指向第 ' + wantR + ' 行）')
    ok(!!focused && focused.tag === 'INPUT' && focused.r === wantR - 1, '★ 点击明细跳转到出错单元格并聚焦')
    const stillOpen = await page.evaluate(() => !!document.querySelector('.err-panel'))
    ok(stillOpen, '★ 面板保持打开（不遮挡网格，可边看清单边改）')

    // 改对 → 该条自动消失。⚠️ **故意不点「查错」**：面板开着时应自己跟着刷新，
    // 若必须手动重查才更新，用户改完还得再点一次才知还剩几处。
    const before2 = P.items.length
    await typeInto(cells.r0, cells.firstQtyC, '0')
    await sleep(2800)
    const P2 = await page.evaluate(snapErrPanel)
    info('修正 1 处后（未手动重新查错）：' + before2 + ' → ' + (P2.items ? P2.items.length : 0) + ' 条；标题=' + JSON.stringify(P2.tag))
    ok(P2.open, '面板仍在（没被误关）')
    ok(P2.items && P2.items.length === before2 - 1, '★ 改对后该条自动从清单消失（无需再点「查错」）')
    ok(!/数量过大/.test(P2.items.map(i => i.text).join('\n')), '「数量过大」已不在清单里')
    ok(P2.groups.length === P.groups.length - 1, '分组也同步少了「数量过大」那一组（' + P2.groups.map(g => g.text).join(' / ') + '）')
    await page.screenshot({ path: OUT + '/v174-查错-修正后.png' })
  }

  console.log('\n=== E. 运行期健康 ===')
  ok(errs.length === 0, '零 console 错误', errs.length ? JSON.stringify(errs.slice(0, 3)) : '')
  const badReal = bad.filter(u => !/audit|404/.test(u))
  ok(badReal.length === 0, '无 4xx/5xx 资源请求', badReal.length ? JSON.stringify(badReal.slice(0, 3)) : '')

  const pass = results.filter(r => r.pass).length
  console.log(`\n结果：PASS ${pass} / FAIL ${results.length - pass}`)
  await browser.close()
  process.exit(results.length - pass === 0 ? 0 : 1)
}
main().catch(e => { console.error('FATAL', e); process.exit(1) })
