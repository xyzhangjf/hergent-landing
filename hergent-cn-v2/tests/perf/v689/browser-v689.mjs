/**
 * v689 真机探针（只读，不建商品）
 * ==========================================================================
 * 老板要求：「新增商品和编辑商品 UI 应该一样，现在是两个样式，请与编辑商品页面对齐。」
 *
 * 本探针不检查「像不像」，而是检查**是不是同一个东西**：
 *   ① 两态弹窗的 class 相同（都是 .pa-modal.pa-edit）
 *   ② 两态 4 个页签的文案与顺序完全相同
 *   ③ 两态「基本信息」页签的字段标签序列完全相同（这是最容易漂的地方）
 *   ④ 新增能填条码（不是 readonly）、编辑仍只读
 *   ⑤ 新增没有「修改记录」「状态」（那两块本来就只对已有商品成立）
 *   ⑥ 保存按钮：新增时名称空则禁用、填名后可用
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] || 'https://hergent.cn'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let pass = 0, fail = 0, skip = 0
const say = (label, verdict, extra) => {
  if (verdict === 'PASS') { pass++; console.log('  ✅ ' + label) }
  else if (verdict === 'SKIP') { skip++; console.log('  ⏭️  ' + label + (extra ? '  ← ' + JSON.stringify(extra) : '')) }
  else { fail++; console.log('  ❌ ' + label + (extra !== undefined ? '  ← ' + JSON.stringify(extra) : '')) }
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
const page = await ctx.newPage()

/** 读弹窗的结构快照 —— 只取用户看得见的东西（文案 / 标签 / readonly / disabled）。 */
const snap = () => page.evaluate(() => {
  const m = document.querySelector('.pa-modal')
  if (!m) return null
  const txt = (el) => (el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '')
  return {
    cls: m.className,
    title: txt(m.querySelector('.pa-modal-hd b')),
    tabs: [...m.querySelectorAll('.main-tabs .main-tab')].map(txt),
    // 「基本信息」页签内的字段标签（去掉必填星号与 hint 小字，只留字段名）
    baseLabels: [...m.querySelectorAll('.tab-pane')][0]
      ? [...[...m.querySelectorAll('.tab-pane')][0].querySelectorAll('.pa-f > span:first-child')]
        .map((el) => {
          const clone = el.cloneNode(true)
          clone.querySelectorAll('i, .pa-hint').forEach((x) => x.remove())
          return (clone.textContent || '').trim()
        })
      : [],
    // 条码框：新增时应是普通输入框（可编辑）；编辑时应是只读展示框（无 data-f，靠 title 认）
    barcodeEditable: (() => {
      const el = m.querySelector('[data-f="barcode"]')
      if (el) return !el.hasAttribute('readonly') && !el.disabled
      const ro = m.querySelector('input[title*="条码是关联键"]')
      if (ro) return !ro.hasAttribute('readonly') && !ro.disabled
      return null
    })(),
    hasChanges: /修改记录/.test(m.textContent || ''),
    hasStatus: /启用中|已停用/.test(m.textContent || ''),
    hasPriceMatrix: /价格矩阵（按单位档位）/.test(m.textContent || ''),
    unitCards: [...m.querySelectorAll('.sub-card-hd')].map(txt),
    saveBtn: (() => {
      const btns = [...m.querySelectorAll('.pa-modal-ft button')]
      const b = btns.find((x) => /保存/.test(x.textContent || ''))
      return b ? { text: txt(b), disabled: b.disabled } : null
    })(),
  }
})

try {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  const demo = page.getByRole('button', { name: /先看看演示效果/ })
  await demo.first().waitFor({ timeout: 25000 })
  await demo.first().click()
  await page.waitForSelector('.topbar', { timeout: 30000 })
  await sleep(1500)

  console.log('\n=== 构建号 ===')
  const build = await page.evaluate(() => window.__HG_BUILD__ || '')
  say('构建号 = v689', build === 'v689' ? 'PASS' : 'FAIL', build)

  console.log('\n=== 进入商品档案 ===')
  await page.evaluate(() => { location.hash = '/archive/products' })
  await sleep(3500)
  const hasBtn = await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => /^\s*\+?\s*新增\s*$/.test(b.textContent || '')))
  say('页面上有「+ 新增」按钮', hasBtn ? 'PASS' : 'FAIL')
  if (!hasBtn) throw new Error('找不到新增按钮，后续无法比对')

  /* ── A. 新增态 ─────────────────────────────────────────── */
  console.log('\n=== A. 新增商品弹窗 ===')
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /^\s*\+?\s*新增\s*$/.test(x.textContent || ''))
    b.click()
  })
  await sleep(900)
  const add = await snap()
  if (!add) throw new Error('点「+ 新增」后没有弹出 .pa-modal')
  say('弹出的是同一个商品弹窗（class 含 pa-edit）', /\bpa-edit\b/.test(add.cls) ? 'PASS' : 'FAIL', add.cls)
  say('标题是「新增商品」', add.title === '新增商品' ? 'PASS' : 'FAIL', add.title)
  const WANT_TABS = ['基本信息', '包装单位', '价格', '库存效期']
  say('4 个页签齐全且顺序一致', JSON.stringify(add.tabs) === JSON.stringify(WANT_TABS) ? 'PASS' : 'FAIL', add.tabs)
  say('「基本信息」有 10 个字段（名称/规格/分类/条码/厂家编码/品牌/别名/业务范围/顺序号/起订量）', add.baseLabels.length === 10 ? 'PASS' : 'FAIL', add.baseLabels)
  say('条码在新增时可填（不是只读）', add.barcodeEditable === true ? 'PASS' : 'FAIL', add.barcodeEditable)
  say('有包装单位三档卡片', (add.unitCards || []).length >= 3 ? 'PASS' : 'FAIL', add.unitCards)
  say('有价格矩阵', add.hasPriceMatrix ? 'PASS' : 'FAIL')
  say('没有「修改记录」（新商品没有记录）', add.hasChanges ? 'FAIL' : 'PASS')
  say('没有「启用中/已停用」状态区（新建一律启用）', add.hasStatus ? 'FAIL' : 'PASS')
  say('名称空时「保存」是禁用的', add.saveBtn && add.saveBtn.disabled ? 'PASS' : 'FAIL', add.saveBtn)

  /* 填个名字，保存按钮应立刻可用 */
  await page.evaluate(() => {
    const el = document.querySelector('.pa-modal [data-f="name"]')
    if (!el) return
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, '探针商品名')
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await sleep(400)
  const add2 = await snap()
  say('填了名称后「保存」变为可用', add2.saveBtn && !add2.saveBtn.disabled ? 'PASS' : 'FAIL', add2.saveBtn)

  /* 切到「包装单位」页签，确认新增态也能切（不是只有编辑能用） */
  await page.evaluate(() => {
    const t = [...document.querySelectorAll('.pa-modal .main-tab')].find((x) => /包装单位/.test(x.textContent || ''))
    if (t) t.click()
  })
  await sleep(500)
  const addPack = await page.evaluate(() => ({
    visible: !!document.querySelector('.pa-modal .sub-card-hd'),
    cards: [...document.querySelectorAll('.pa-modal .sub-card-hd')].map((x) => (x.textContent || '').trim()),
  }))
  say('新增态可切到「包装单位」且显示三档卡片', addPack.visible && addPack.cards.length >= 3 ? 'PASS' : 'FAIL', addPack.cards)

  /* 关掉（填了名字，应先进入「放弃新增」内联确认） */
  await page.evaluate(() => {
    const x = document.querySelector('.pa-modal .pa-x')
    if (x) x.click()
  })
  await sleep(600)
  const askClose = await page.evaluate(() => (document.querySelector('.pa-modal .pa-ft-ask') || {}).textContent || '')
  say('新增填了内容后关闭会先确认（不静默丢弃）', /放弃这次新增/.test(askClose) ? 'PASS' : 'FAIL', askClose)
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.pa-modal button')].find((x) => /确认放弃/.test(x.textContent || ''))
    if (b) b.click()
  })
  await sleep(600)

  /* ── B. 编辑态 ─────────────────────────────────────────── */
  console.log('\n=== B. 编辑商品弹窗（同一份模板） ===')
  const opened = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '编辑')
    if (!b) return false
    b.click()
    return true
  })
  say('列表里有「编辑」按钮可点', opened ? 'PASS' : 'SKIP', opened ? undefined : '演示租户可能无商品')
  if (opened) {
    await sleep(1200)
    const edit = await snap()
    if (!edit) { say('编辑弹窗能打开', 'FAIL') } else {
      say('编辑弹窗 class 与新增一致（都是 pa-modal pa-edit）', edit.cls === add.cls ? 'PASS' : 'FAIL', { add: add.cls, edit: edit.cls })
      say('标题是「编辑商品 · 名称」', /^编辑商品 · /.test(edit.title) ? 'PASS' : 'FAIL', edit.title)
      say('页签与新增完全一致', JSON.stringify(edit.tabs) === JSON.stringify(add.tabs) ? 'PASS' : 'FAIL', { add: add.tabs, edit: edit.tabs })
      say('「基本信息」字段标签序列与新增**逐项相同**',
        JSON.stringify(edit.baseLabels) === JSON.stringify(add.baseLabels) ? 'PASS' : 'FAIL',
        { add: add.baseLabels, edit: edit.baseLabels })
      say('条码在编辑时只读（关联键不给改）', edit.barcodeEditable === false ? 'PASS' : 'FAIL', edit.barcodeEditable)
      say('编辑有「修改记录」', edit.hasChanges ? 'PASS' : 'FAIL')
      say('编辑有「启用中/已停用」状态区', edit.hasStatus ? 'PASS' : 'FAIL')
      say('编辑有价格矩阵', edit.hasPriceMatrix ? 'PASS' : 'FAIL')
      say('包装单位三档卡片与新增一致',
        JSON.stringify(edit.unitCards) === JSON.stringify(add.unitCards) ? 'PASS' : 'FAIL',
        { add: add.unitCards, edit: edit.unitCards })
      say('编辑态没改动时「保存」禁用（diff 语义）', edit.saveBtn && edit.saveBtn.disabled ? 'PASS' : 'FAIL', edit.saveBtn)
      /* 编辑弹窗打开着直接关掉（无改动 ⇒ 直接关） */
      await page.evaluate(() => { const x = document.querySelector('.pa-modal .pa-x'); if (x) x.click() })
      await sleep(400)
      const stillOpen = await page.evaluate(() => !!document.querySelector('.pa-modal'))
      say('无改动时关闭不弹确认（直接关）', stillOpen ? 'FAIL' : 'PASS')
    }
  }
} catch (e) {
  fail++
  console.log('  ❌ 探针异常：' + (e && e.message))
} finally {
  console.log(`\nRESULT: ${pass} 通过 / ${fail} 失败 / ${skip} SKIP`)
  await browser.close()
  process.exit(fail ? 1 : 0)
}
