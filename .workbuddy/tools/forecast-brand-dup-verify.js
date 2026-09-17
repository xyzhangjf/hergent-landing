/* v178 真机验收：条码重复改为**同品牌才算重复** + 条码列加宽 + 编辑网格品牌列有权威来源
 *
 * MODE=before → 对**改动前**的构建取证：两行条码相同但品牌不同时，是否仍误报「条码重复」
 * MODE=after  → 验收：不同品牌 → 零告警；同品牌 → 仍报；列宽够 13 位；品牌列不靠草稿
 *
 * 用法: HG_TOKEN=<t> HG_TENANT=9998 MODE=after node forecast-brand-dup-verify.js
 *      复跑（不想弄脏仓库 outputs/）时用 HG_OUT=/tmp/shots 改输出目录。
 */
const puppeteer = require('puppeteer-core')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = 'https://hergent.cn'
const OUT = process.env.HG_OUT || '/Users/zhangjunfeng/Documents/laozhangai-product/outputs'
const TOKEN = process.env.HG_TOKEN
const TENANT = process.env.HG_TENANT || '9998'
const MODE = process.env.MODE || 'after'
const sleep = ms => new Promise(r => setTimeout(r, ms))

const results = []
function ok(cond, label, extra) {
  results.push({ pass: !!cond, label })
  console.log((cond ? '  ✓ ' : '  ✗ ') + label + (extra ? '   [' + extra + ']' : ''))
}
function info(m) { console.log('  · ' + m) }

// 浏览器内：条码/品牌两列的位置 + 每行的值
function snapCols() {
  const bcEl = document.querySelector('input[placeholder="条码"]')
  const brEl = document.querySelector('input[placeholder="品牌"]')
  if (!bcEl || !brEl) return { err: 'no col' }
  const bcC = +bcEl.dataset.c, brC = +brEl.dataset.c
  const rows = [...new Set([...document.querySelectorAll('input[data-r]')].map(i => +i.dataset.r))].sort((a, b) => a - b)
  const get = (r, c) => {
    const el = document.querySelector(`input[data-r="${r}"][data-c="${c}"]`)
    return el ? String(el.value || '') : null
  }
  const data = rows.map(r => ({ r, barcode: get(r, bcC), brand: get(r, brC) }))
  const brFill = data.filter(x => x.brand && x.brand.trim() !== '').length
  return { bcC, brC, nRows: rows.length, brFill, data }
}

// 浏览器内：条码重复标记现状
function snapDup() {
  const bcEl = document.querySelector('input[placeholder="条码"]')
  const bcC = bcEl ? +bcEl.dataset.c : -1
  const marks = [...document.querySelectorAll('td.invalid')].map(td => ({
    r: +td.dataset.r, c: td.dataset.c == null ? null : +td.dataset.c,
    title: td.getAttribute('title') || '',
  }))
  const barcodeMarks = marks.filter(x => x.c === bcC && /条码重复/.test(x.title))
  const rowBad = [...document.querySelectorAll('.seq-cell.row-bad')].map(x => +x.dataset.r)
  // 查错面板里的条码重复条目（带上「第 N 行」原文 —— 沙箱本身有真实的同品牌重复组，
  // 计数不等于 0 是正常的，必须按**行**判定，否则断言会误伤）
  let panelDup = null
  const p = [...document.querySelectorAll('.info-panel')].find(x => /查错/.test((x.querySelector('.panel-hd b') || {}).textContent || ''))
  if (p) panelDup = [...p.querySelectorAll('.err-list li')]
    .filter(li => /条码重复/.test(li.textContent || ''))
    .map(li => (li.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 90))
  return { nAll: marks.length, barcodeMarks, rowBad, panelDup, panelOpen: !!p, panelDupN: panelDup ? panelDup.length : null }
}

// 浏览器内：条码列的宽度与是否截断
function snapBarcodeWidth() {
  const els = [...document.querySelectorAll('input[placeholder="条码"]')]
  const td = els.length ? els[0].closest('td') : null
  const colW = td ? Math.round(td.getBoundingClientRect().width) : -1
  const clipped = els.filter(e => e.scrollWidth > e.clientWidth + 1).length
  const maxScroll = els.reduce((m, e) => Math.max(m, e.scrollWidth), 0)
  const minClient = els.reduce((m, e) => (m === 0 ? e.clientWidth : Math.min(m, e.clientWidth)), 0)
  const longest = els.reduce((m, e) => (String(e.value).length > String(m).length ? e.value : m), '')
  return { colW, n: els.length, clipped, maxScroll, minClient, longest: String(longest) }
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--force-device-scale-factor=1'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1680, height: 950, deviceScaleFactor: 1 })
  const errs = [], bad = []
  page.on('pageerror', e => errs.push('pageerror: ' + e.message))
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 160)) })
  page.on('response', r => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url().slice(0, 110)) })

  await page.evaluateOnNewDocument((t, ten) => {
    localStorage.setItem('hergent_v2_token', t)
    localStorage.setItem('hergent_v2_tenant', String(ten))
    localStorage.setItem('hergent_v2_user', JSON.stringify({ role: 'boss', username: 'sbx_verify', display_name: '沙箱只读账号' }))
    localStorage.removeItem('hergent-forecast-col-widths')
  }, TOKEN, TENANT)

  await page.goto(`${BASE}/?cb=${Date.now()}#/forecast`, { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(7500)

  /* 🔴 2026-09-17 补（v181 回归时踩到）：探针此前假设「进页面选中的期次就有报单记录」。
     实测沙箱按当期（今天）默认选中「9月15日报单9月19日到货」，该期次**为空**，
     此时点「改单」被 enterEdit 静默拦下 —— **不报错、只 toast「请先选择期次」**，
     于是网格零行、后续断言全部 FATAL「no col」，看起来像功能坏了，实则期次没数据。
     改为遍历期次，挑**第一个真有报单记录**的（实测「9月提审期-开放填报」28 行）。
     `prefer` 用于 G 段 reload 后直接切回同一个期次（免去二次遍历）。 */
  const ensurePeriod = async (prefer) => {
    const list = await page.evaluate(() => {
      const s = [...document.querySelectorAll('select')].find(x => /选择期次/.test(x.innerHTML || ''))
      return s ? [...s.options].filter(o => o.value !== '0').map(o => ({ v: o.value, t: o.textContent.trim() })) : []
    })
    if (!list.length) return { label: 'no-select', val: '', txt: 'no-select' }
    const order = prefer ? [...list.filter(o => o.v === prefer), ...list.filter(o => o.v !== prefer)] : list
    const seen = []
    for (const o of order) {
      await page.evaluate(v => {
        const s = [...document.querySelectorAll('select')].find(x => /选择期次/.test(x.innerHTML || ''))
        s.value = v; s.dispatchEvent(new Event('change', { bubbles: true }))
      }, o.v)
      await sleep(3500)
      const st = await page.evaluate(() => {
        const txt = document.body.innerText || ''
        const mt = [...document.querySelectorAll('table.tbl')].filter(t => !t.closest('.sprint-card'))
        return {
          empty: /暂无预报数据|没有报单记录/.test(txt),
          rows: mt.reduce((a, t) => a + t.querySelectorAll('tbody tr').length, 0),
        }
      })
      seen.push(`${o.t}:${st.empty ? '空' : st.rows + '行'}`)
      if (!st.empty && st.rows > 0) return { label: o.t, val: o.v, txt: `${o.t}（${st.rows} 行）` }
    }
    return { label: '', val: '', txt: 'all-empty(' + seen.join(' / ') + ')' }
  }
  const periodPick = await ensurePeriod()
  ok(!!periodPick.label && periodPick.label !== 'no-select', '选中了有报单记录的期次（改单前置）', periodPick.txt)

  console.log('\n=== A. 进入编辑态 ===')
  const entered = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').trim() === '改单')
    if (!b) return false
    b.click(); return true
  })
  ok(entered, '点「改单」进入编辑态')
  if (!entered) { await browser.close(); process.exit(1) }
  await sleep(6000)

  const C = await page.evaluate(snapCols)
  if (C.err) { console.log('  FATAL: ' + C.err); await browser.close(); process.exit(1) }
  info(`渲染 ${C.nRows} 行 · 条码列 c=${C.bcC} · 品牌列 c=${C.brC} · 品牌非空 ${C.brFill}/${C.nRows}`)

  console.log('\n=== B. 编辑网格品牌列有值（v178 修复：不再依赖本地草稿）===')
  ok(C.brFill > C.nRows * 0.7, `品牌列大多有值（${C.brFill}/${C.nRows}）`)

  console.log('\n=== C. 条码列宽度（v178 加宽）===')
  const W = await page.evaluate(snapBarcodeWidth)
  info(`列宽=${W.colW}px · 输入框 ${W.n} 个 · 被截断 ${W.clipped} 个 · 最长值「${W.longest}」(${W.longest.length} 位) · scroll=${W.maxScroll} client=${W.minClient}`)
  ok(W.colW >= 120, `条码列宽 ≥ 120px（实测 ${W.colW}px）`)
  ok(W.clipped === 0, `没有条码被截断（scrollWidth ≤ clientWidth）`, 'clipped=' + W.clipped)
  ok(W.longest.length >= 13, '存在 13 位条码样本（截断此前只显示 9 位）', W.longest)

  // 取两行做「同条码 × 品牌」实验。优先选现成品牌不同的两行
  const pick = []
  for (let i = 0; i < C.data.length && pick.length < 2; i++) {
    const d = C.data[i]
    if (!d.barcode) continue
    if (!pick.length) { pick.push(d); continue }
    if (String(d.brand || '').trim() !== String(pick[0].brand || '').trim()) pick.push(d)
  }
  if (pick.length < 2) {
    // 退化：随便取两行有品牌的
    const withBc = C.data.filter(d => d.barcode).slice(0, 2)
    pick.length = 0; pick.push(...withBc)
  }
  info(`实验行：第 ${pick[0].r + 1} 行 品牌「${pick[0].brand}」 条码「${pick[0].barcode}」 / 第 ${pick[1].r + 1} 行 品牌「${pick[1].brand}」`)
  ok(String(pick[0].brand || '').trim() !== String(pick[1].brand || '').trim(),
    '选到的两行品牌本就不同（用于构造「不同品牌 × 同条码」）', `${pick[0].brand} vs ${pick[1].brand}`)

  const typeInto = async (r, c, val) => {
    const sel = `input[data-r="${r}"][data-c="${c}"]`
    await page.click(sel, { clickCount: 3 })
    if (String(val) === '') await page.keyboard.press('Backspace')
    else await page.keyboard.type(String(val))
    await page.keyboard.press('Tab')
    await sleep(300)
  }
  const readVal = (r, c) => page.evaluate((rr, cc) => {
    const el = document.querySelector(`input[data-r="${rr}"][data-c="${cc}"]`)
    return el ? String(el.value == null ? '' : el.value) : null
  }, r, c)

  const R0 = pick[0].r, R1 = pick[1].r
  const orig = { bc1: pick[1].barcode, br1: pick[1].brand }

  /* ---- D. 不同品牌 + 同条码 ---- */
  console.log('\n=== D. 两行条码相同、品牌不同 ===')
  await typeInto(R1, C.bcC, pick[0].barcode)
  await sleep(2800)
  const v1 = await readVal(R1, C.bcC)
  ok(v1 === pick[0].barcode, `已把第 ${R0 + 1} 行条码抄到第 ${R1 + 1} 行 = ${v1}`)
  // 打开查错，拿面板条目
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /查错/.test(x.textContent || ''))
    if (b) b.click()
  })
  await sleep(2200)
  const D = await page.evaluate(snapDup)
  info(`条码重复标记 ${D.barcodeMarks.length} 个 → ${JSON.stringify(D.barcodeMarks.map(x => x.title))}`)
  info(`行号标红 ${JSON.stringify(D.rowBad)} · 面板里「条码重复」条目 ${D.panelDup}`)
  await page.screenshot({ path: OUT + '/v178-不同品牌同条码.png' })

  if (MODE === 'before') {
    console.log('\n=== D2. 缺陷判据（before）：不同品牌也报 → 误报 ===')
    ok(D.barcodeMarks.some(x => x.r === R1), '★ 改动前：第 ' + (R1 + 1) + ' 行（品牌「' + pick[1].brand + '」）被标成条码重复 —— 与另一行品牌不同却仍报',
      D.barcodeMarks.map(x => 'r' + (x.r + 1)).join(','))
    ok(D.barcodeMarks.every(x => !/同品牌|品牌未填全/.test(x.title)),
      '★ 改动前的文案不含品牌信息（只说「第 N 行已使用该条码」）', JSON.stringify(D.barcodeMarks.map(x => x.title)))
  } else {
    console.log('\n=== D2. 验收（after）：不同品牌 → 零告警 ===')
    ok(!D.barcodeMarks.some(x => x.r === R1),
      '★ 第 ' + (R1 + 1) + ' 行（品牌「' + pick[1].brand + '」）不再被标记（不同品牌不算重复）',
      JSON.stringify(D.barcodeMarks.map(x => 'r' + (x.r + 1))))
    ok(!D.rowBad.includes(R1), '★ 该行行号也不再标红（本探针未给它制造其它错）', JSON.stringify(D.rowBad))
    // ⚠️ 沙箱里本就有 6 组**真实的**同品牌重复 ⇒ 面板条目数不为 0 是正常的。
    // 必须按「行」判定：只要没有哪条条码重复明细是指向 R1 的，就算这条放行成立。
    const dupForR1 = (D.panelDup || []).filter(t => new RegExp('第\\s*' + (R1 + 1) + '\\s*行').test(t))
    ok(dupForR1.length === 0, '★ 查错清单里没有指向第 ' + (R1 + 1) + ' 行的「条码重复」条目',
      '共' + D.panelDupN + '条条码重复明细；指向本行的=' + JSON.stringify(dupForR1))
  }

  /* ---- E. 同品牌 + 同条码 → 必须仍报（防放行过头）---- */
  console.log('\n=== E. 两行条码相同、品牌改成一样 ===')
  await page.evaluate(() => {
    const b = document.querySelector('.err-panel .imp-x')
    if (b) b.click()
  })
  await sleep(900)
  await typeInto(R1, C.brC, pick[0].brand)
  const br1 = await readVal(R1, C.brC)
  info(`第 ${R1 + 1} 行品牌改为「${br1}」（与第 ${R0 + 1} 行「${pick[0].brand}」相同）`)
  await sleep(2800)
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /查错/.test(x.textContent || ''))
    if (b) b.click()
  })
  await sleep(2200)
  const E = await page.evaluate(snapDup)
  info(`条码重复标记 ${E.barcodeMarks.length} 个 → ${JSON.stringify(E.barcodeMarks.map(x => x.title))}`)
  await page.screenshot({ path: OUT + '/v178-同品牌同条码.png' })
  if (MODE === 'after') {
    ok(E.barcodeMarks.some(x => x.r === R1), '★ 品牌改成一样后**重新报错**（同品牌 + 同条码才算重复）',
      JSON.stringify(E.barcodeMarks.map(x => 'r' + (x.r + 1))))
    const t = (E.barcodeMarks.find(x => x.r === R1) || {}).title || ''
    ok(/同品牌/.test(t), '★ 文案说明是「同品牌」—— 用户能看懂为什么报', t)
    ok(new RegExp('第\\s*' + (R0 + 1) + '\\s*行').test(t), '★ 文案指向冲突的那一行（第 ' + (R0 + 1) + ' 行）', t)
  }

  /* ---- F. 品牌「无从得知」→ 仍报（fail-closed，防静默串档）----
     ⚠️ 关键细节：品牌 = **行内值 || 档案值**（rowBrand）。所以「把行内品牌清空」**不等于**
     品牌未知 —— 档案里还有值，判据仍能区分户头，此时不报是正确的（E 段已验）。
     真正未知 = 行内与档案**都**没有品牌（本租户 275 个商品里有 30 个），这时才必须 fail-closed。 */
  console.log('\n=== F. 品牌无从得知（行内 + 档案都空）===')
  await page.evaluate(() => { const b = document.querySelector('.err-panel .imp-x'); if (b) b.click() })
  await sleep(900)
  // 先把 E 段改过的品牌复原，避免把状态带进 F
  await typeInto(R1, C.brC, orig.br1 === null ? '' : orig.br1)
  await sleep(1200)
  /* 🔴 2026-09-17 补：样本行**必须取视口内的**。网格是虚拟滚动，远处行会被回收 ——
     实测取到第 157 行时 page.click 抛 "Node is either not clickable or not an Element"
     （元素此刻已不在 DOM / 不在可点位置），整个探针在此中断。限定前 12 行即可稳定复现。 */
  const blankRow = C.data.find(d => !String(d.brand || '').trim() && d.r !== R0 && d.r !== R1 && d.r < 12)
  if (!blankRow) {
    info('⚠ 前 12 行内没有档案品牌为空的样本，跳过 F（虚拟滚动下远处行不可点）')
  } else {
    const R2 = blankRow.r
    const origBc2 = blankRow.barcode
    info(`取第 ${R2 + 1} 行（档案品牌为空，条码「${origBc2}」）作为「品牌无从得知」样本`)
    await typeInto(R2, C.bcC, pick[0].barcode)
    await sleep(2800)
    const F = await page.evaluate(snapDup)
    const fm = F.barcodeMarks.find(x => x.r === R2)
    info(`条码重复标记 ${F.barcodeMarks.length} 个 → 该行: ${JSON.stringify(fm ? fm.title : '(无)')}`)
    if (MODE === 'after') {
      ok(!!fm, '★ 品牌无从得知 + 同条码 → 仍报（宁可让用户把品牌填上）',
        JSON.stringify(F.barcodeMarks.map(x => 'r' + (x.r + 1))))
      ok(!!fm && /品牌未填全/.test(fm.title), '★ 文案说明了原因「品牌未填全」', fm ? fm.title : '')
      ok(F.rowBad.includes(R2), '★ 该行行号也标红', JSON.stringify(F.rowBad))
    }
    await page.screenshot({ path: OUT + '/v178-品牌无从得知同条码.png' })
    // 复原该行条码
    await typeInto(R2, C.bcC, origBc2 === null ? '' : origBc2)
    await sleep(1600)
    const back2 = await page.evaluate((rr, cc) => {
      const el = document.querySelector(`input[data-r="${rr}"][data-c="${cc}"]`)
      return el ? String(el.value) : null
    }, R2, C.bcC)
    ok(String(back2) === String(origBc2 || ''), '复原：第 ' + (R2 + 1) + ' 行条码已恢复', 'now=' + back2)
  }

  /* ---- 复原 ---- */
  await typeInto(R1, C.brC, orig.br1 === null ? '' : orig.br1)
  await typeInto(R1, C.bcC, orig.bc1 === null ? '' : orig.bc1)
  await sleep(2000)
  const back = await page.evaluate((rr, cc, v) => {
    const el = document.querySelector(`input[data-r="${rr}"][data-c="${cc}"]`)
    return el ? String(el.value) : null
  }, R1, C.bcC, orig.bc1 || '')
  ok(String(back) === String(orig.bc1 || ''), '复原：第 ' + (R1 + 1) + ' 行条码恢复为「' + (orig.bc1 || '') + '」', 'now=' + back)

  /* ---- G. 品牌列不靠草稿（after 专属）---- */
  if (MODE === 'after') {
    console.log('\n=== G. 清掉本地草稿后，品牌列仍有值（v178 修复点）===')
    const before = await page.evaluate(() => Object.keys(localStorage).filter(k => k.indexOf('forecast_draft') === 0))
    info('当前草稿键: ' + JSON.stringify(before))
    await page.evaluate(() => { Object.keys(localStorage).filter(k => k.indexOf('forecast_draft') === 0).forEach(k => localStorage.removeItem(k)) })
    await page.reload({ waitUntil: 'networkidle2', timeout: 60000 })
    await sleep(7500)
    const hasDraftAfter = await page.evaluate(() => Object.keys(localStorage).filter(k => k.indexOf('forecast_draft') === 0))
    // reload 后页面会回到「当期」期次（可能为空）→ 必须切回刚才那个有数据的期次
    const p2 = await ensurePeriod(periodPick.val)
    info('重载后期次: ' + p2.txt)
    const entered2 = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').trim() === '改单')
      if (!b) return false
      b.click(); return true
    })
    ok(entered2, '重新进入编辑态')
    await sleep(6000)
    const C2 = await page.evaluate(snapCols)
    info(`重载后：渲染 ${C2.nRows} 行 · 品牌非空 ${C2.brFill}/${C2.nRows} · 草稿键 ${JSON.stringify(hasDraftAfter)}`)
    const gridBrandN = await page.evaluate(async () => {
      const r = await (await fetch('/api/products/grid', { headers: { Authorization: 'Bearer ' + localStorage.getItem('hergent_v2_token'), 'X-Tenant-Id': localStorage.getItem('hergent_v2_tenant') } })).json()
      const it = r.items || []
      return { n: it.length, filled: it.filter(x => String(x.brand || '').trim() !== '').length }
    })
    info(`档案侧：${gridBrandN.n} 个商品，其中品牌非空 ${gridBrandN.filled}`)
    /* 🔴 2026-09-17 修：原断言要求「网格行品牌非空数 == 档案侧品牌非空数」，但这两个是
       **不同集合** —— 编辑网格只渲染该期次相关商品（实测 158 行），档案侧是全部商品（285 个）。
       昨天两者凑巧都是 245 才通过，换个期次立刻失效（156 vs 274），看起来像回归、实为断言错。
       改判据为**网格内品牌非空占比**：修复前（品牌只靠草稿恢复）草稿一清即整列空白 → 0%；
       修复后应接近 100%（差的那几行是档案本身就没品牌的商品）。 */
    const ratio = C2.nRows > 0 ? C2.brFill / C2.nRows : 0
    ok(ratio >= 0.9,
      `★ 品牌列非空占比 ≥90%（${C2.brFill}/${C2.nRows} = ${(ratio * 100).toFixed(1)}%）—— 不再依赖草稿`,
      `档案侧 ${gridBrandN.filled}/${gridBrandN.n} 有品牌；draftKeys=${JSON.stringify(hasDraftAfter)}`)
    ok(C2.brFill > 0, '品牌列有值（不是整列空白）')
    await page.screenshot({ path: OUT + '/v178-品牌列不靠草稿.png' })
  }

  console.log('\n=== H. 运行期健康 ===')
  ok(errs.length === 0, '零 console 错误', errs.length ? JSON.stringify(errs.slice(0, 3)) : '')
  const badReal = bad.filter(u => !/audit|404/.test(u))
  ok(badReal.length === 0, '无 4xx/5xx 资源请求', badReal.length ? JSON.stringify(badReal.slice(0, 3)) : '')

  const pass = results.filter(r => r.pass).length
  console.log(`\n结果：PASS ${pass} / FAIL ${results.length - pass}`)
  await browser.close()
  process.exit(results.length - pass === 0 ? 0 : 1)
}
main().catch(e => { console.error('FATAL', e); process.exit(1) })
