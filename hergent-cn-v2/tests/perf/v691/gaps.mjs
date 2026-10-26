/**
 * v691 补验：all-pages.mjs 没覆盖到的 6 组复杂弹窗
 * ==========================================================================
 * all-pages.mjs 的 SKIP 曾经被误读成「演示租户权限不足、要 boss 账号」。
 * 实测推翻了这个判断：那几页**全部正常渲染**，唯一 403 是
 * `/api/rebate-rules/simulate-batch`（返利页后台自动模拟，与弹窗无关）。
 * 真实原因是**探针找不到入口** —— 这几页的开窗入口不是顶部按钮：
 *
 *   · ConnectCenter / DataLedger   → 卡片（.cc-card / .dl-btn）与 URL `?tab=`
 *   · Rebate 结算/承诺             → URL `?tab=settle|promises` 切换子页
 *   · Rebate 规则表单（TargetFormModal）→ rules 子页的「+ 创建品牌目标」
 *   · ReportMapping                → Forecast 的 `?tab=config` 子页
 *   · LossAccounting               → 工具栏「叫法映射」「上传数据」（一个组件 5 种用途）
 *   · WhDialog                     → 入库列表的「新建入库单」
 *
 * 所以本探针**不猜按钮**：每个目标写死「怎么进这一页 + 怎么点开这个弹窗」。
 * 点不开就如实 SKIP（没验过 ≠ 验过），点开了就按组件统一的 8 条硬指标量。
 *
 * 用法：node tests/perf/v691/gaps.mjs [BASE_URL]
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] || 'http://127.0.0.1:5173'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let pass = 0, fail = 0, skip = 0
const say = (label, v, extra) => {
  if (v === 'PASS') { pass++; console.log('    ✅ ' + label) }
  else if (v === 'SKIP') { skip++; console.log('    ⏭️  ' + label + (extra !== undefined ? '  ← ' + JSON.stringify(extra) : '')) }
  else { fail++; console.log('    ❌ ' + label + (extra !== undefined ? '  ← ' + JSON.stringify(extra) : '')) }
}

/* ── 与 all-pages.mjs 同一把尺子（刻意复制而非 import：
       探针要能单独拷走跑，不依赖同目录其它文件）────────────────────── */
const MEASURE = () => {
  const vis = (el) => {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter(vis)
  if (!dialogs.length) return null
  const panel = dialogs.sort((a, b) =>
    (Number(getComputedStyle(b).zIndex) || 0) - (Number(getComputedStyle(a).zIndex) || 0))[0]
  const cs = getComputedStyle(panel)
  const box = panel.getBoundingClientRect()
  const z = Number(cs.zIndex) || 0

  let mask = null
  for (const el of document.querySelectorAll('div')) {
    if (el === panel || el.contains(panel) || !vis(el)) continue
    const s = getComputedStyle(el)
    if (s.position !== 'fixed') continue
    const r = el.getBoundingClientRect()
    if (r.width >= innerWidth - 2 && r.height >= innerHeight - 2) {
      const bg = s.backgroundColor
      if (bg && !/^(transparent|rgba\(0,\s*0,\s*0,\s*0\))$/.test(bg)) {
        mask = { z: Number(s.zIndex) || 0, bg }
        break
      }
    }
  }

  const inputs = [...panel.querySelectorAll('input:not([type=hidden]),select,textarea')]
  const editable = inputs.filter((el) => !el.disabled && !el.readOnly && el.offsetParent !== null)

  const floats = []
  for (const b of document.querySelectorAll('.tb-pop,.tb-pop-below')) {
    if (!vis(b)) continue
    const bz = Number(getComputedStyle(b).zIndex) || 0
    if (bz > z) floats.push({ cls: b.className, z: bz })
  }

  return {
    cls: String(panel.className),
    w: Math.round(box.width), h: Math.round(box.height),
    radius: cs.borderRadius, z,
    title: (() => { const b = panel.querySelector('b,h3,h2'); return b ? (b.textContent || '').trim() : '' })(),
    textLen: (panel.innerText || '').trim().length,
    inputCount: inputs.length,
    editableCount: editable.length,
    mask, floats,
  }
}

/* 点一个**页面内**的按钮（排除侧栏/顶栏/页签条/已开弹窗） */
const CLICK_TEXT = ([txt, exact]) => {
  const vis = (el) => {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const inNav = (el) => !!el.closest('.sidebar,.topbar,.main-tab,.tabs,.tb-pop,.ui-modal-card,[role=dialog]')
  const b = [...document.querySelectorAll('button')].filter((x) => {
    if (!vis(x) || x.disabled || inNav(x)) return false
    const t = (x.textContent || '').trim()
    return exact ? t === txt : t.includes(txt)
  })[0]
  if (!b) return false
  b.click()
  return true
}

/* 点一个**可点容器**（.cc-card / .dl-btn 这类不是 button 的入口），按可见文案筛 */
const CLICK_SEL_TEXT = ([sel, txt]) => {
  const vis = (el) => {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const el = [...document.querySelectorAll(sel)].filter((x) => vis(x) && (x.textContent || '').includes(txt))[0]
  if (!el) return false
  el.click()
  return true
}

const CLICK_SEL = (sel) => {
  const vis = (el) => {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const el = [...document.querySelectorAll(sel)].filter(vis)[0]
  if (!el) return false
  el.click()
  return true
}

const ensureLogin = async (page) => {
  if (await page.$('.topbar')) return false
  const demo = page.getByRole('button', { name: /先看看演示效果/ })
  await demo.first().waitFor({ timeout: 20000 })
  await demo.first().click()
  await page.waitForSelector('.topbar', { timeout: 30000 })
  return true
}

/* ── 目标清单 ──────────────────────────────────────────────────────────
   step 三种：{t:'按钮文案'} / {s:'.选择器', t:'文案片段'} / {s:'.选择器'}
   expectW = 迁移时给该弹窗定的宽度，量出来不一致 ⇒ width prop 没生效或被别处覆盖 */
const TARGETS = [
  /* 「管理工作流」在 skill 子页里（不是 im）—— 首轮写成 im 就点不到 */
  { name: 'ConnectCenter 管理工作流', route: '/connect?tab=skill', steps: [{ t: '管理工作流' }], expectW: 440 },
  { name: 'ConnectCenter 渠道配置（飞书）', route: '/connect?tab=im', steps: [{ s: '.cc-card', t: '飞书' }], expectW: 560 },
  { name: 'ConnectCenter 畅捷通授权', route: '/connect?tab=erp', steps: [{ s: '.cc-card', t: '畅捷通' }], expectW: 440 },
  { name: 'ConnectCenter 金蝶授权', route: '/connect?tab=erp', steps: [{ s: '.cc-card', t: '金蝶' }], expectW: 440 },
  { name: 'DataLedger 上传数据', route: '/connect?tab=datasource', steps: [{ s: '.dl-btn.primary' }], expectW: 620 },
  { name: 'Rebate 新增结算节奏', route: '/rebate?tab=settle', steps: [{ t: '新增结算节奏' }], expectW: 680 },
  { name: 'Rebate 新增承诺', route: '/rebate?tab=promises', steps: [{ t: '新增承诺' }], expectW: 720 },
  { name: 'Rebate 创建品牌目标（TargetFormModal）', route: '/rebate?tab=rules', steps: [{ t: '创建品牌目标' }], expectW: 580 },
  { name: 'ReportMapping 新建配置', route: '/forecast?tab=config', steps: [{ t: '新建配置' }], expectW: 520 },
  { name: 'ReportMapping Excel 批量导入', route: '/forecast?tab=config', steps: [{ t: 'Excel 批量导入' }], expectW: 460 },
  /* ⚠️ 必须带 `?tab=fill`：LossAccounting 的 `mainTab` 由 URL 驱动，
     默认 `dashboard` 只有趋势图与月列表，**没有** .la-bar 工具条。
     首轮探针漏了这个，把「页面没渲染工具条」误判成权限问题。 */
  { name: 'LossAccounting 叫法映射', route: '/loss-accounting?tab=fill', steps: [{ t: '叫法映射', exact: true }], expectW: 760 },
  /* ⚠️ 环境限制，演示租户验不到（不是缺陷）：
     `POST /api/loss/accounting/import-preview` 对演示租户返回
     403 READONLY_TENANT「演示环境只读」→ 前端 openImport 只在 **501** 时开弹窗，
     其余错误走 toast ⇒ 演示环境永远不弹。真租户（boss 自用）才会 501 弹出来。 */
  { name: 'LossAccounting 上传数据（演示只读，预期弹不出）', route: '/loss-accounting?tab=fill', steps: [{ t: '上传数据', exact: true }], expectW: 760 },
  { name: 'LossAccounting 数据体检', route: '/loss-accounting?tab=fill', steps: [{ t: '数据体检' }], expectW: 760 },
  { name: 'WhDialog 新建入库单', route: '/wh/inbound', steps: [{ s: '.btn-primary' }], expectW: 880 },
  /* `GET /api/ai/reports` 在演示租户返回 `{"reports":[]}` ⇒ 列表为空、没有「查看」按钮。
     报告弹窗要在真有报告的租户上才能验。 */
  { name: 'AiHub 报告查看（演示无报告，预期点不到）', route: '/ai-hub', steps: [{ t: '查看', exact: true }], expectW: 620 },
]

/* 走一遍「进这一页 → 点开这个弹窗」，返回 MEASURE 结果（null = 没打开） */
const openDialog = async (page, tg) => {
  navSeq += 1
  await page.goto(BASE + '/?__p=' + navSeq + '#' + tg.route, { waitUntil: 'domcontentloaded' })
  await sleep(1400)
  if (await ensureLogin(page)) {
    navSeq += 1
    await page.goto(BASE + '/?__p=' + navSeq + '#' + tg.route, { waitUntil: 'domcontentloaded' })
    await sleep(1400)
  }
  await sleep(2600)
  if (!(await page.$('.topbar'))) return { m: null, by: '', why: '无顶栏（未登录）' }

  let hitBy = ''
  for (const st of tg.steps) {
    const ok = st.s
      ? (st.t !== undefined
          ? await page.evaluate(CLICK_SEL_TEXT, [st.s, st.t])
          : await page.evaluate(CLICK_SEL, st.s))
      : await page.evaluate(CLICK_TEXT, [st.t, !!st.exact])
    if (!ok) return { m: null, by: '', why: '入口没找到：' + JSON.stringify(st) }
    hitBy = st.s || st.t
    await sleep(900)
  }
  return { m: await page.evaluate(MEASURE), by: hitBy, why: '点开了但没弹出' }
}

/* 在弹窗里造一次「真实输入」—— guardClose 只认真实 input/change 事件，
   程序化赋值不算（这是它不误伤「自动带出部门」的关键设计），所以这里必须派发事件 */
const MAKE_DIRTY = () => {
  const d = document.querySelector('[role="dialog"]')
  if (!d) return false
  const el = [...d.querySelectorAll('input:not([type=hidden]),textarea,select')]
    .find((x) => !x.disabled && !x.readOnly && x.offsetParent !== null)
  if (!el) return false
  if (el.tagName === 'SELECT') {
    if (el.options.length > 1) el.selectedIndex = Math.min(1, el.options.length - 1)
    el.dispatchEvent(new Event('change', { bubbles: true }))
  } else {
    el.value = (el.value || '') + 'x'
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  return true
}

let navSeq = 0
const runTarget = async (page, tg) => {
  console.log('\n━━━ ' + tg.name + '   ' + tg.route)
  try {
    const opened = await openDialog(page, tg)
    if (!opened.m) { say('弹窗打得开', 'SKIP', opened.why); return }
    const m = opened.m

    const lgToken = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--radius-lg').trim())
    console.log('    （由「' + opened.by + '」打开：' + m.title + ' / ' + m.w + 'px / z=' + m.z +
                ' / 可编辑控件 ' + m.editableCount + '）')

    say('B1 弹窗打得开', 'PASS')
    say('B2 宽度 = ' + tg.expectW, Math.abs(m.w - tg.expectW) <= 2 ? 'PASS' : 'FAIL', m.w)
    say('B3 圆角 = --radius-lg', m.radius === lgToken ? 'PASS' : 'FAIL', { got: m.radius, token: lgToken })
    say('B4 层级 ≥ 1125', m.z >= 1125 ? 'PASS' : 'FAIL', m.z)
    say('B5 有遮罩', m.mask ? 'PASS' : 'FAIL', m.mask)
    say('B6 标题非空', m.title ? 'PASS' : 'FAIL', m.title)
    say('B7 正文 ≥ 10 字', m.textLen >= 10 ? 'PASS' : 'FAIL', m.textLen)
    say('B8 无浮层压在弹窗上', m.floats.length === 0 ? 'PASS' : 'FAIL', m.floats)

    /* B9 干净状态下 ESC 一次就该关（guard 不得误伤）。
       —— 这一条是首轮探针漏掉的：它只测了「有输入控件就期望被拦」，
          可控件存在 ≠ 用户动过，直接判 SKIP 会掩盖真正的误伤。 */
    await page.keyboard.press('Escape')
    await sleep(450)
    const afterClean = await page.evaluate(MEASURE)
    say('B9 未输入时 ESC 一次关（guard 不误伤）', afterClean ? 'FAIL' : 'PASS',
        afterClean ? '仍开着' : '')

    /* B10/B11 脏状态：重开后真敲一次，第一次 ESC 只提示、第二次才关 */
    if (!m.editableCount) { say('B10 脏状态拦截（本弹窗无输入控件，跳过）', 'SKIP'); return }
    const again = await openDialog(page, tg)
    if (!again.m) { say('B10 重开弹窗', 'SKIP', again.why); return }
    const madeDirty = await page.evaluate(MAKE_DIRTY)
    if (!madeDirty) { say('B10 造一次输入', 'SKIP', '找不到可编辑控件'); return }
    await sleep(200)

    await page.keyboard.press('Escape')
    await sleep(450)
    const afterDirty1 = await page.evaluate(MEASURE)
    const hint = await page.evaluate(() =>
      (document.querySelector('[role="dialog"] .ui-modal-guard')?.innerText || '').trim())
    say('B10 动过字段后第一次 ESC 被拦', afterDirty1 && hint ? 'PASS' : 'FAIL',
        { stillOpen: !!afterDirty1, hint: hint.slice(0, 40) })

    if (afterDirty1) {
      await page.keyboard.press('Escape')
      await sleep(450)
      const afterDirty2 = await page.evaluate(MEASURE)
      say('B11 第二次 ESC 真关掉', afterDirty2 ? 'FAIL' : 'PASS', afterDirty2 ? '关不掉' : '')
    }

    /* 收尾：兜底关干净，避免影响下一个目标 */
    for (let i = 0; i < 4; i++) {
      if (!(await page.evaluate(MEASURE))) break
      await page.keyboard.press('Escape')
      await sleep(250)
    }
  } catch (e) {
    say('无异常', 'FAIL', String(e).slice(0, 160))
  }
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage()
page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 160)))

try {
  await page.goto(BASE + '/?__p=0', { waitUntil: 'domcontentloaded' })
  const demo = page.getByRole('button', { name: /先看看演示效果/ })
  await demo.first().waitFor({ timeout: 30000 })
  await demo.first().click()
  await page.waitForSelector('.topbar', { timeout: 30000 })
  await sleep(1500)
  console.log('✅ 进入演示租户（demo_boss / role=boss）')
  for (const tg of TARGETS) await runTarget(page, tg)
} catch (e) {
  console.log('💥 中断：' + String(e).slice(0, 300))
} finally {
  await browser.close()
}

console.log('\n════════════════════════════════════════')
console.log(`  PASS ${pass}   FAIL ${fail}   SKIP ${skip}`)
console.log('════════════════════════════════════════')
process.exitCode = fail ? 1 : 0
