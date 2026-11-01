/** v720 尺度体系审计：布局骨架 / 间距节奏 / 组件细节 / 四态覆盖 / 无障碍
 *
 *  用法：HG_TOKEN=xxx node .workbuddy/tools/v720-scale-audit.mjs [--json out.json]
 *
 *  🔴 与 v719 探针的三条同源纪律：
 *   1. hash 路由 ⇒ URL 必须 `https://hergent.cn/#` + path，写裸路径会全被重定向到 #/workbench；
 *   2. hash 切换等 3200ms（chunk 加载）；
 *   3. 登录态过期是**静默**的（回退 #/workbench、用户名变「我」）⇒ 每页断言 h1/节点数做阳性对照。
 */
import { launch } from './lib/cdp-lite.mjs'
import { writeFileSync } from 'node:fs'

const TOKEN = process.env.HG_TOKEN
if (!TOKEN) { console.error('缺少 HG_TOKEN'); process.exit(2) }

const PAGES = [
  ['工作台', '/'],
  ['看板', '/dashboard'],
  ['本期预报', '/forecast'],
  ['商品档案', '/archive/products'],
  ['客户档案', '/archive/customers'],
  ['销售单', '/inventory/sale'],
  ['采购单', '/inventory/purchase'],
  ['开单单据', '/inventory/sale/new'],
  ['报表设计器', '/reports/builder'],
]

/* 在页面里跑的采集函数 —— 必须自包含（会被 toString 注入） */
const COLLECT = function () {
  const px = v => Math.round((parseFloat(v) || 0) * 100) / 100
  const inc = (o, k) => { if (k !== undefined && k !== null && k !== '') o[k] = (o[k] || 0) + 1 }
  const visible = el => {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false
    const r = el.getBoundingClientRect()
    return r.width > 0.5 && r.height > 0.5
  }
  const all = [...document.querySelectorAll('body *')].filter(visible)

  const out = {
    nodeCount: all.length,
    spacing: { pad: {}, mar: {}, gap: {} },
    radius: {}, shadow: {}, fw: {}, fs: {},
    card: { pad: {} },
    ctrl: { btnH: {}, btnPadX: {}, btnRadius: {}, btnFs: {}, inputH: {}, inputRadius: {}, icon: {}, tdPad: {}, tdH: {} },
    skeleton: {},
    states: {},
    a11y: {},
  }

  /* ---- 1. 间距向量（只统计容器与控件，跳过文本节点）---- */
  const isText = el => ['SPAN', 'B', 'I', 'EM', 'STRONG', 'LABEL', 'TD', 'TH', 'A', 'SMALL'].includes(el.tagName)
  for (const el of all) {
    const cs = getComputedStyle(el)
    const tag = el.tagName
    const p = `${px(cs.paddingTop)} ${px(cs.paddingRight)} ${px(cs.paddingBottom)} ${px(cs.paddingLeft)}`
    const m = `${px(cs.marginTop)} ${px(cs.marginRight)} ${px(cs.marginBottom)} ${px(cs.marginLeft)}`
    if (!isText(el) && p !== '0 0 0 0') inc(out.spacing.pad, p)
    if (m !== '0 0 0 0' && !isText(el)) inc(out.spacing.mar, m)
    if (cs.display.includes('flex') || cs.display.includes('grid')) {
      const g = `${px(cs.rowGap)}/${px(cs.columnGap)}`
      if (g !== '0/0') inc(out.spacing.gap, g)
    }
    /* 卡片类容器（按类名粗分）*/
    if (/(^|[-_])(card|panel|sec|box|block)([-_]|$)/.test(el.className || '') && !isText(el)) inc(out.card.pad, p)

    inc(out.radius, px(cs.borderTopLeftRadius))
    if (cs.boxShadow && cs.boxShadow !== 'none') inc(out.shadow, cs.boxShadow)
    if (['H1', 'H2', 'H3', 'H4', 'BUTTON', 'TD', 'TH', 'LABEL'].includes(tag) || /btn|title|hd|label/.test(el.className || '')) {
      inc(out.fw, cs.fontWeight); inc(out.fs, px(cs.fontSize))
    }

    /* ---- 2. 组件细节 ---- */
    const cls = String(el.className || '')
    if (tag === 'BUTTON' || /\bbtn\b/.test(cls) || el.getAttribute('role') === 'button') {
      const r = el.getBoundingClientRect()
      inc(out.ctrl.btnH, Math.round(r.height))
      inc(out.ctrl.btnPadX, px(cs.paddingLeft))
      inc(out.ctrl.btnRadius, px(cs.borderTopLeftRadius))
      inc(out.ctrl.btnFs, px(cs.fontSize))
    }
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
      const r = el.getBoundingClientRect()
      inc(out.ctrl.inputH, Math.round(r.height))
      inc(out.ctrl.inputRadius, px(cs.borderTopLeftRadius))
    }
    if (tag === 'svg') {
      const r = el.getBoundingClientRect()
      inc(out.ctrl.icon, `${Math.round(r.width)}x${Math.round(r.height)}`)
    }
    if (tag === 'TD') {
      inc(out.ctrl.tdPad, p); inc(out.ctrl.tdH, Math.round(el.getBoundingClientRect().height))
    }
  }

  /* ---- 3. 布局骨架：主内容区起点（判各页是否同一网格）---- */
  const pick = sel => {
    for (const s of sel) { const e = document.querySelector(s); if (e && visible(e)) return e }
    return null
  }
  const mainEl = pick(['.main', '.content', '.page-body', 'main', '#app > div'])
  const hdEl = pick(['.page-hd', '.dash-hd'])
  const firstCard = all.find(e => /(^|[-_])(card|panel)([-_]|$)/.test(e.className || '') && e.getBoundingClientRect().height > 60)
  const scroller = pick(['.psi-scroll', '.tbl-wrap', '.scroll', '.list-body'])
  const R = e => e ? e.getBoundingClientRect() : null
  out.skeleton = {
    mainPad: mainEl ? getComputedStyle(mainEl).padding : null,
    mainLeft: mainEl ? Math.round(R(mainEl).left) : null,
    hdHeight: hdEl ? Math.round(R(hdEl).height) : 0,
    hdBottom: hdEl ? Math.round(R(hdEl).bottom) : null,
    cardTop: firstCard ? Math.round(R(firstCard).top) : null,
    cardLeft: firstCard ? Math.round(R(firstCard).left) : null,
    cardWidth: firstCard ? Math.round(R(firstCard).width) : null,
    navH: (() => { const n = pick(['.sidebar', '.sb', 'aside']); return n ? Math.round(R(n).width) : null })(),
    scrollClientW: scroller ? scroller.clientWidth : null,
  }

  /* ---- 4. 四态规则覆盖（同一源里的 :hover/:active/:disabled/:focus-visible）---- */
  const rules = { hover: [], active: [], disabled: [], focusVisible: [] }
  /* 🔴 CSSRuleList 不是可迭代对象（for…of 直接 TypeError）⇒ 必须用下标遍历。
     v720 首版写成 for…of，异常被 try/catch 吞掉，四态覆盖率一律 0/0 —— 典型的探针假阴性。 */
  const walk = list => {
    for (let i = 0; i < list.length; i++) {
      const r = list[i]
      /* 🔴 先取 selectorText 再决定要不要下沉：支持 CSS 嵌套后，**每条**样式规则都带一个
         空 cssRules（对象恒真）⇒ 用 `if (r.cssRules) continue` 会把所有规则当容器跳过，
         规则数恒 0。这是 v720 的第二个探针假阴性。 */
      if (r.selectorText) {
        for (const part of r.selectorText.split(',')) {
          const s = part.trim()
          if (/:hover\b/.test(s)) rules.hover.push(s)
          if (/:active\b/.test(s)) rules.active.push(s)
          if (/:disabled\b|\[disabled\]/.test(s)) rules.disabled.push(s)
          if (/:focus-visible\b/.test(s)) rules.focusVisible.push(s)
        }
      }
      if (r.cssRules && r.cssRules.length) walk(r.cssRules)
    }
  }
  for (let i = 0; i < document.styleSheets.length; i++) {
    try { walk(document.styleSheets[i].cssRules) } catch (e) {}
  }
  /* 取「主体复合选择器」：只有伪类落在最后一个复合片段上，才算该元素本身有这个态；
     否则 `.btn:hover .x` 会被误算到 `.x` 头上。
     🔴 不能直接 `split(/\s/)` —— `:where(a, b, c)` 里的空格、`:not(.a .b)` 里的空格
     都会被当组合器切开，末段退化成 `[tabindex])` 这种碎片，`matches()` 全部 false
     ⇒ 焦点/禁用覆盖率会**假报成 0**（v720 实测：真实 315 处焦点环被判成 36 处）。
     必须按**括号深度**切。 */
  const topLevelCompounds = s => {
    const out = []; let cur = ''; let depth = 0
    for (let i = 0; i < s.length; i++) {
      const ch = s[i]
      if (ch === '(' || ch === '[') depth++
      else if (ch === ')' || ch === ']') depth--
      if (depth === 0 && /[\s>+~]/.test(ch)) { if (cur) { out.push(cur); cur = '' } continue }
      cur += ch
    }
    if (cur) out.push(cur)
    return out
  }
  const subjectOf = (s, pseudo) => {
    const parts = topLevelCompounds(s)
    const last = parts[parts.length - 1] || ''
    const re = pseudo === 'disabled' ? /:disabled\b|\[disabled\]/ : new RegExp(`:${pseudo}\\b`)
    if (!re.test(last)) return null
    return last.replace(/::?(before|after)\b/g, '').replace(new RegExp(`:${pseudo}\\b`, 'g'), '').replace(/\[disabled\]/g, '').trim()
  }
  const matchesAny = (el, list, pseudo) => list.some(s => {
    const b = subjectOf(s, pseudo)
    if (!b) return false
    try { return el.matches(b) } catch (e) { return false }
  })
  /* 按组件类名分组，定位「哪个组件缺态」*/
  const missByClass = {}
  const clsOf = el => String(el.className || '').split(/\s+/).filter(c => c && !/^(is-|has-)/.test(c))[0] || el.tagName.toLowerCase()
  const interactive = all.filter(e => ['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA'].includes(e.tagName) || e.getAttribute('role') === 'button')
  const cov = k => interactive.filter(e => matchesAny(e, rules[k], k === 'focusVisible' ? 'focus-visible' : k)).length
  for (const e of interactive) {
    if (!matchesAny(e, rules.hover, 'hover')) { const c = clsOf(e); missByClass[c] = (missByClass[c] || 0) + 1 }
  }
  /* 阳性对照：CSS 里确实有 .btn:hover 这类规则吗（没有就说明是探针问题，不是产品问题）*/
  out.states = {
    interactiveTotal: interactive.length,
    hoverRules: rules.hover.length, hoverCovered: cov('hover'),
    activeRules: rules.active.length, activeCovered: cov('active'),
    disabledRules: rules.disabled.length, disabledCovered: cov('disabled'),
    focusRules: rules.focusVisible.length, focusCovered: cov('focusVisible'),
    disabledEls: all.filter(e => e.disabled === true).length,
    hoverMissTop: Object.entries(missByClass).sort((a, b) => b[1] - a[1]).slice(0, 8),
    sampleHoverRule: rules.hover.slice(0, 3),
  }

  /* ---- 5. 无障碍 ---- */
  const nameOf = el => (el.textContent || '').trim() ||
    el.getAttribute('aria-label') || el.getAttribute('title') ||
    (el.getAttribute('aria-labelledby') ? '(labelledby)' : '') ||
    (el.querySelector('img[alt]:not([alt=""])') ? '(img)' : '')
  const btns = all.filter(e => e.tagName === 'BUTTON' || e.getAttribute('role') === 'button')
  const noName = btns.filter(e => !nameOf(e))
  const imgs = [...document.querySelectorAll('img')]
  const inputs = all.filter(e => ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.tagName) && e.type !== 'hidden')
  const unlabeled = inputs.filter(e => !(e.labels && e.labels.length) && !e.getAttribute('aria-label') && !e.getAttribute('aria-labelledby'))
  const heads = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(visible).map(e => +e.tagName[1])
  let jumps = 0
  for (let i = 1; i < heads.length; i++) if (heads[i] - heads[i - 1] > 1) jumps++
  const small = interactive.filter(e => { const r = e.getBoundingClientRect(); return r.width < 24 || r.height < 24 })
  out.a11y = {
    btnCount: btns.length, btnNoName: noName.length,
    imgCount: imgs.length, imgNoAlt: imgs.filter(i => !i.hasAttribute('alt')).length,
    inputCount: inputs.length, inputNoLabel: unlabeled.length,
    h1: heads.filter(h => h === 1).length, headingJumps: jumps,
    landmarks: { main: !!document.querySelector('main,[role=main]'), nav: !!document.querySelector('nav,[role=nav]'), aside: !!document.querySelector('aside,[role=complementary]') },
    touchUnder24: small.length,
    smallSamples: small.slice(0, 5).map(e => (e.className || e.tagName).toString().slice(0, 40)),
    ariaAttrs: document.querySelectorAll('[aria-label],[aria-labelledby],[aria-describedby],[aria-live],[role]').length,
    lang: document.documentElement.lang,
    positiveTabindex: document.querySelectorAll('[tabindex]').length &&
      [...document.querySelectorAll('[tabindex]')].filter(e => +e.getAttribute('tabindex') > 0).length,
  }

  /* ---- 6. 定点诊断：三处「看着不对」的读数找源头 ---- */
  const diag = { iconAttrVsBox: {}, fsOdd: [], btnOddH: [] }
  for (const el of all) {
    if (el.tagName === 'svg') {
      const a = el.getAttribute('width'); const r = el.getBoundingClientRect()
      const key = `attr=${a}→box=${Math.round(r.width)}`
      diag.iconAttrVsBox[key] = (diag.iconAttrVsBox[key] || 0) + 1
    }
    const cs = getComputedStyle(el)
    const fsz = Math.round((parseFloat(cs.fontSize) || 0) * 100) / 100
    if (Math.abs(fsz - 13.33) < 0.05 && diag.fsOdd.length < 6) {
      diag.fsOdd.push(`${el.tagName}.${String(el.className || '').slice(0, 28)} | ${(el.textContent || '').trim().slice(0, 18)}`)
    }
    if ((el.tagName === 'BUTTON' || /\bbtn\b/.test(String(el.className || ''))) && diag.btnOddH.length < 8) {
      const h = Math.round(el.getBoundingClientRect().height)
      if (h === 39 || h === 34 || h === 28) diag.btnOddH.push(`${h}px | ${el.tagName}.${String(el.className || '').slice(0, 34)}`)
    }
  }
  out.diag = diag
  return out
}

const b = await launch({ headless: true })
const page = await b.newPage()
await page.enable()
await page.raw.send('Network.enable')
await page.raw.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
await page.goto('https://hergent.cn/login', 2200)
for (const c of [
  { name: 'erp_token', value: TOKEN, httpOnly: true },
  { name: 'hergent_auth', value: '1' },
  { name: 'csrf_token', value: 'x' },
  { name: 'hergent_tenant', value: '1' },
]) await page.raw.send('Network.setCookie', { ...c, domain: 'hergent.cn', path: '/', secure: true, sameSite: 'Lax' })

const results = []
for (const [name, path] of PAGES) {
  await page.goto('https://hergent.cn/#' + path, 3400)
  const hash = await page.eval('location.hash')
  let data
  try { data = await page.eval(`(${COLLECT.toString()})()`) } catch (e) { data = { error: String(e) } }
  data.page = name; data.path = path; data.hash = hash
  results.push(data)
  console.log(`· ${name.padEnd(6)} hash=${String(hash).padEnd(22)} 节点=${data.nodeCount ?? '-'} 交互=${data.states?.interactiveTotal ?? '-'} h1=${data.a11y?.h1 ?? '-'}`)
}

await b.close()
const out = process.argv.indexOf('--json')
const file = out > -1 ? process.argv[out + 1] : '/tmp/v720-audit.json'
writeFileSync(file, JSON.stringify(results, null, 1))
console.log('\n写入 ' + file)
