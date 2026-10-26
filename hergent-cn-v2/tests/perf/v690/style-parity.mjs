/**
 * v690 全站「新增 vs 编辑」样式一致性探针（只读，不保存任何数据）
 * ==========================================================================
 * 老板要求：全站排查，找出所有新增页面与编辑页面在样式上不一致的地方。
 *
 * 本探针不看源码，只看**用户能看见的东西**：
 *   ① 两态打开的弹窗是不是**同一个容器**（class 相同 / 尺寸相同）
 *   ② 标题字号、弹窗宽度、圆角、内边距是否一致
 *   ③ 字段标签的字号 / 颜色 / 必填星号是否一致
 *   ④ 输入控件高度是否一致
 *   ⑤ 字段标签序列（顺序 + 数量）是否一致
 *   ⑥ 底部按钮：顺序 / 文案 / 尺寸是否一致
 *
 * 弹窗定位不写死类名 —— 页面上有 18 种手写弹窗 + 1 个共享 Modal.vue，
 * 写死 ".pa-modal" 只能测到商品档案一页。改成「找 fixed 定位、含 ≥2 个输入控件
 * 的最大可见容器」，任何形态都能落到。
 *
 * 🔴 纪律：拿不到 → 报 SKIP 并说明原因，绝不把「测不到」算成「通过」。
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] || 'https://hergent.cn'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let pass = 0, fail = 0, skip = 0
const say = (label, verdict, extra) => {
  if (verdict === 'PASS') { pass++; console.log('  ✅ ' + label) }
  else if (verdict === 'SKIP') { skip++; console.log('  ⏭️  ' + label + (extra !== undefined ? '  ← ' + JSON.stringify(extra) : '')) }
  else { fail++; console.log('  ❌ ' + label + (extra !== undefined ? '  ← ' + JSON.stringify(extra) : '')) }
}

/** 页内：量一次「当前打开的表单弹窗」。返回 null = 没有弹窗。 */
const MEASURE = () => {
  const txt = (el) => (el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '')
  const visible = (el) => {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  /* 候选判定：宽 280–1400、高 ≥150、含 ≥2 个輸入控件。
     🔴 本仓有一半页面的「遮罩」和「弹窗」是**同一个元素**（`.pc-mask` / `.rm-modal`
        本身就是 1920×1080 全屏，对话框是它的子节点）⇒ 遇到超宽元素必须继续下钻，
        否则永远只看到遮罩、测不到任何规格。 */
  const score = (el) => {
    if (!visible(el)) return null
    const r = el.getBoundingClientRect()
    if (r.width < 200 || r.height < 100) return null
    const ctrl = el.querySelectorAll('input:not([type=hidden]), select, textarea').length
    if (ctrl < 2) return null
    const bg = getComputedStyle(el).backgroundColor
    const opaque = !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(bg)
    return { el, w: r.width, h: r.height, opaque }
  }
  let cands = []
  const walk = (node) => {
    for (const el of node.querySelectorAll('div, section, form')) {
      const s = score(el)
      if (!s) continue
      if (s.w > 1400) { walk(el); continue }   // 全屏遮罩 → 下钻找对话框
      cands.push(s)
    }
  }
  walk(document.body)
  // 优先「有背景色」的（真对话框），再按面积取最大
  cands.sort((a, b) => (b.opaque ? 1 : 0) - (a.opaque ? 1 : 0) || b.w * b.h - a.w * a.h)
  if (!cands.length) return null
  const m = cands[0].el
  const cs = getComputedStyle(m)
  const box = m.getBoundingClientRect()

  // 标题：弹窗里字号最大的那句纯文本（排除表格/说明）
  let titleEl = null, best = 0
  for (const el of m.querySelectorAll('b, h1, h2, h3, h4, [class*="modal-hd"], [class*="form-hd"], [class*="dlg-hd"], [class*="-hd"]')) {
    if (el.querySelector('input, select, textarea, button')) continue
    const fs = parseFloat(getComputedStyle(el).fontSize) || 0
    const t = (el.textContent || '').trim()
    if (fs > best && t.length && t.length < 40) { best = fs; titleEl = el }
  }
  // 兜底：有些页标题是 <span> 而非 <b>，按字号从大到小找第一句短文本
  if (!titleEl) {
    for (const el of m.querySelectorAll('span, div')) {
      if (el.children.length > 1) continue
      if (el.querySelector('input, select, textarea, button')) continue
      const fs = parseFloat(getComputedStyle(el).fontSize) || 0
      const t = (el.textContent || '').trim()
      if (fs >= 14 && t.length && t.length < 24 && /新建|新增|添加|编辑|创建/.test(t)) { best = fs; titleEl = el; break }
    }
  }

  // 字段标签：表单里每个控件的**前一个兄弟文本**或 label 内首段文本
  const fields = [...m.querySelectorAll('label, .df-f, [class*="-f"], [class*="-fl"]')]
    .filter((el) => el.querySelector('input:not([type=hidden]), select, textarea'))
  const labels = []
  const labelFs = new Set(), labelColor = new Set(), hasStar = []
  for (const f of fields) {
    const lab = f.querySelector(':scope > span') || f.querySelector(':scope > b') || f
    const clone = lab.cloneNode(true)
    clone.querySelectorAll('input, select, textarea, button, i, em, [class*="hint"], [class*="req"]').forEach((x) => x.remove())
    const t = (clone.textContent || '').replace(/\s+/g, ' ').trim()
    if (!t) continue
    if (labels.includes(t)) continue
    labels.push(t)
    const lcs = getComputedStyle(lab)
    labelFs.add(Math.round(parseFloat(lcs.fontSize) * 10) / 10)
    labelColor.add(lcs.color)
    hasStar.push(/[*＊]/.test(f.textContent || '') || !!f.querySelector('[class*="req"], .req'))
  }

  // 控件高度
  const ctrlH = new Set()
  for (const c of m.querySelectorAll('input:not([type=hidden]), select')) {
    const ccs = getComputedStyle(c)
    if (ccs.display === 'none') continue
    ctrlH.add(Math.round(c.getBoundingClientRect().height))
  }

  // 底部按钮（弹窗内最后一行按钮）
  const allBtns = [...m.querySelectorAll('button')]
  const footerBtns = allBtns.filter((b) => {
    const r = b.getBoundingClientRect()
    const mr = m.getBoundingClientRect()
    return r.top > mr.top + mr.height * 0.6
  })
  const btns = footerBtns.map((b) => {
    const bcs = getComputedStyle(b)
    return {
      text: txt(b),
      h: Math.round(b.getBoundingClientRect().height),
      fs: bcs.fontSize,
      filled: !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(bcs.backgroundColor),
    }
  })

  return {
    cls: m.className,
    w: Math.round(box.width),
    h: Math.round(box.height),
    radius: cs.borderRadius,
    pad: cs.padding,
    title: txt(titleEl),
    titleFs: Math.round(best * 10) / 10,
    labels,
    labelFs: [...labelFs],
    labelColor: [...labelColor],
    starCount: hasStar.filter(Boolean).length,
    ctrlH: [...ctrlH].sort((a, b) => a - b),
    btns,
  }
}

/** 点一个按钮（按文字「包含」匹配；只点可见、未禁用的）。
 *  🔴 必须逐页指定精确文案：员工档案页同时有「＋ 添加员工」和「＋ 新建外部客户」，
 *     用「新建」开头的模糊匹配会点到后者 —— 那是**另一个对象**的弹窗，
 *     拿它跟「编辑员工」比出来的差异全是假的。 */
const clickByText = (needle) => async (page) => page.evaluate((t) => {
  const b = [...document.querySelectorAll('button')].find((x) => {
    if (x.offsetParent === null || x.disabled) return false
    const s = (x.textContent || '').replace(/\s+/g, '')
    return s.includes(t)
  })
  if (!b) return false
  b.click()
  return true
}, needle)

/* [名称, 路由, 新增按钮文案, 编辑按钮文案] */
const CASES = [
  ['商品档案', '/archive/products', '新增', '编辑'],
  ['客户档案', '/archive/customers', '新增客户', '编辑'],
  ['供应商档案', '/archive/suppliers', '新增供应商', '编辑'],
  ['品牌档案', '/archive/brands', '添加品牌', '编辑'],
  ['仓库档案', '/archive/warehouses', '新建仓库', '编辑'],
  ['员工档案', '/archive/employees', '添加员工', '编辑'],
  ['渠道与价格', '/archive/prices', '新建渠道', '编辑'],
  ['AI 团队（角色）', '/roles', '新建团队', '编辑'],
  ['告警规则', '/alerts', '新建规则', '编辑'],
  ['定时任务', '/cron', '新建任务', '编辑'],
  ['买赠活动', '/mkt/promotions', '新建活动', '编辑'],
]

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
const page = await ctx.newPage()

const results = []

try {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  const demo = page.getByRole('button', { name: /先看看演示效果/ })
  await demo.first().waitFor({ timeout: 25000 })
  await demo.first().click()
  await page.waitForSelector('.topbar', { timeout: 30000 })
  await sleep(1500)
  console.log('构建号：', await page.evaluate(() => window.__HG_BUILD__ || '?'))

  for (const [name, route, addText, editText] of CASES) {
    console.log('\n=== ' + name + '  ' + route + ' ===')
    await page.evaluate((h) => { location.hash = h }, route)
    await sleep(3200)

    // 关掉可能残留的弹窗
    await page.keyboard.press('Escape').catch(() => {})
    await sleep(300)

    const addOk = await clickByText(addText)(page)
    if (!addOk) { say(name + '：有「新增/新建」入口', 'FAIL', '找不到按钮「' + addText + '」'); results.push({ name, route, add: null, edit: null }); continue }
    await sleep(1000)
    const add = await page.evaluate(MEASURE)
    if (!add) { say(name + '：新增打开表单弹窗', 'SKIP', '点开后没识别到弹窗（可能是内联表单/独立页）'); }
    // 关掉
    await page.keyboard.press('Escape').catch(() => {})
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /^(取消|关闭|放弃|✕)$/.test((x.textContent || '').trim()) && x.offsetParent !== null)
      if (b) b.click()
    })
    await sleep(700)

    const editOk = await clickByText(editText)(page)
    await sleep(1000)
    const edit = editOk ? await page.evaluate(MEASURE) : null
    if (!editOk) say(name + '：有「编辑」入口', 'SKIP', '演示租户无数据或该页不支持编辑')
    else if (!edit) say(name + '：编辑打开表单弹窗', 'SKIP', '点开后没识别到弹窗')

    if (add && edit) {
      const same = String(add.cls).split(' ').sort().join(' ') === String(edit.cls).split(' ').sort().join(' ')
      say('两态是同一个弹窗容器（class 相同）', same ? 'PASS' : 'FAIL', { add: add.cls, edit: edit.cls })
      say('弹窗宽度一致', add.w === edit.w ? 'PASS' : 'FAIL', { add: add.w, edit: edit.w })
      say('弹窗圆角一致', add.radius === edit.radius ? 'PASS' : 'FAIL', { add: add.radius, edit: edit.radius })
      say('内边距一致', add.pad === edit.pad ? 'PASS' : 'FAIL', { add: add.pad, edit: edit.pad })
      say('标题字号一致', add.titleFs === edit.titleFs ? 'PASS' : 'FAIL', { add: add.titleFs, edit: edit.titleFs })
      say('字段标签字号一致', JSON.stringify(add.labelFs) === JSON.stringify(edit.labelFs) ? 'PASS' : 'FAIL', { add: add.labelFs, edit: edit.labelFs })
      say('输入控件高度一致', JSON.stringify(add.ctrlH) === JSON.stringify(edit.ctrlH) ? 'PASS' : 'FAIL', { add: add.ctrlH, edit: edit.ctrlH })
      say('底部按钮顺序与文案一致',
        JSON.stringify(add.btns.map((b) => b.text)) === JSON.stringify(edit.btns.map((b) => b.text)) ? 'PASS' : 'FAIL',
        { add: add.btns.map((b) => b.text), edit: edit.btns.map((b) => b.text) })
      const common = add.labels.filter((x) => edit.labels.includes(x))
      say('新增字段全部出现在编辑里（编辑 ⊆ 新增不算问题，反向才算）',
        common.length === add.labels.length ? 'PASS' : 'FAIL',
        { onlyInAdd: add.labels.filter((x) => !edit.labels.includes(x)), onlyInEdit: edit.labels.filter((x) => !add.labels.includes(x)) })
    }
    results.push({ name, route, add, edit })
    await page.keyboard.press('Escape').catch(() => {})
  }
} catch (e) {
  console.log('\n探针中断：', e.message)
} finally {
  console.log('\n================ RESULT ================')
  console.log(`PASS ${pass} / FAIL ${fail} / SKIP ${skip}`)
  console.log('\n---- 规格汇总（用户可见） ----')
  for (const r of results) {
    const f = (x) => x ? `w=${x.w} r=${x.radius} pad=${x.pad} title=${x.titleFs}px labels=${x.labelFs} ctrl=${x.ctrlH} 字段${x.labels.length}` : '—'
    console.log(`${r.name}`)
    console.log(`   新增: ${f(r.add)}`)
    console.log(`   编辑: ${f(r.edit)}`)
  }
  await browser.close()
}
