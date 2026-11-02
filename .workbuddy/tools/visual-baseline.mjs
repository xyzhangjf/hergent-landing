/**
 * visual-baseline.mjs —— 视觉回归抓图（只读，不改线上）
 *
 * 为什么要它（v724）：
 *   v717–v723 连着七版做视觉整改，每次都是「改完 → 跑对比度/尺寸探针 → 肉眼看两张截图」。
 *   探针只能验证**被写进探针的那些判据**（对比度、图标尺寸、焦点环…），
 *   一旦改的是「不该动的页被顺带改了」（v723 第二轮：`.btn.on` 换令牌、`--pri` 改指向），
 *   探针全程 0 缺陷，用户却可能一眼看出某页变了样。缺的是**全页面的像素基线**。
 *
 * 三个设计决定（都有代价，先写清楚）：
 *   1. 只截**视口**（1440×900），不截整页。整页高度随数据量变化 ⇒ 天天不一样，基线没法用。
 *      视口覆盖「首屏信息层级」，也正是设计评审最在意的那一层。要查表格下半部分用
 *      `v721-scroll-region-audit.mjs` / 对比度探针，不走这里。
 *   2. 基线必须**同一构建内连续抓两次**才能测出噪声底噪（`--set ab`）。阈值不是拍脑袋定的，
 *      是实测出来的：见 `visual-diff.py --self-check`。
 *   3. 关掉动效 / 光标 / 滚动条，且显式 blur，否则动画中间态和焦点环会制造假差异。
 *
 * 用法：
 *   HG_TOKEN=xxx node .workbuddy/tools/visual-baseline.mjs --set baseline
 *   HG_TOKEN=xxx node .workbuddy/tools/visual-baseline.mjs --set candidate
 *   HG_TOKEN=xxx node .workbuddy/tools/visual-baseline.mjs --set ab      # A/A 测底噪
 *   HG_TOKEN=xxx node .workbuddy/tools/visual-baseline.mjs --pages workbench,settings
 *   ... --themes light                   # 只跑浅色（默认 light,dark）
 *
 * 产物：
 *   .workbuddy/visual-baseline/<theme>/<slug>.png   ← 基线（入库，覆盖式）
 *   .workbuddy/visual-run/<set>/<theme>/<slug>.png  ← 本次抓图（不入库）
 *   .workbuddy/visual-run/<set>/manifest.json
 */
import fs from 'node:fs'
import path from 'node:path'
import { launch, CHROME_DEFAULT } from './lib/cdp-lite.mjs'

const ROOT = path.resolve(import.meta.dirname, '../..')
const BASE_DIR = path.join(ROOT, '.workbuddy/visual-baseline')
const RUN_DIR = path.join(ROOT, '.workbuddy/visual-run')

const VW = 1440
const VH = 900

const TOKEN = process.env.HG_TOKEN || ''
if (!TOKEN) { console.error('缺 HG_TOKEN（见 MEMORY.md「免密码做生产 UI 真机验证」）'); process.exit(1) }

/* 代表页 12 个：按**结构类型**取，不按流量取 —— 视觉回归要的是覆盖不同渲染骨架，
   同类页面重复截图只是浪费比对时间。
   覆盖：仪表盘网格 / 密集表格+分页 / 档案树 / 图表 / 表单建单 / 设置项列表。 */
const PAGES = [
  ['工作台',      'workbench',       '/workbench'],
  ['看板',        'dashboard',       '/dashboard'],
  ['采购单列表',  'inv-purchase',    '/inventory/purchase'],
  ['销售单列表',  'inv-sale',        '/inventory/sale'],
  ['商品档案',    'arch-products',   '/archive/products'],
  ['毛利分析',    'rp-gross-profit', '/reports/gross-profit'],
  ['库存周转',    'rp-turnover',     '/reports/inventory-turnover'],
  ['目标与返利',  'rebate',          '/rebate'],
  ['资金流水',    'funds-flow',      '/funds/flow'],
  ['往来对账',    'funds-party',     '/funds/party-reconcile'],
  ['采购建单',    'inv-purchase-new', '/inventory/purchase/new'],
  ['设置',        'settings',        '/settings'],
]

/* ── 参数 ─────────────────────────────────────────────────────────── */
const argv = process.argv.slice(2)
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d }
const SET = arg('set', 'candidate')
const THEMES = arg('themes', 'light,dark').split(',').map(s => s.trim()).filter(Boolean)
const ONLY = arg('pages', '') ? arg('pages', '').split(',').map(s => s.trim()) : null

const PICK = ONLY ? PAGES.filter(p => ONLY.includes(p[1]) || ONLY.includes(p[2])) : PAGES
if (!PICK.length) { console.error('--pages 没匹配到任何页面；可选：' + PAGES.map(p => p[1]).join(',')); process.exit(1) }

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

/* 关掉一切会自己变的东西。
   🔴 滚动条必须**显式归零**：macOS 的 overlay 滚动条在 headless 下宽度不稳定，
      有时占 15px、有时 0 ⇒ 内容宽度 1425 / 1440 两套布局，diff 出来整页错位。
      这里统一抹掉，两次抓图口径才一致（真实用户看到的是 overlay，不影响判断）。 */
const FREEZE_CSS = `
  *,*::before,*::after{animation:none!important;transition:none!important;
    animation-duration:0s!important;transition-duration:0s!important}
  *{caret-color:transparent!important}
  html{scrollbar-width:none!important}
  ::-webkit-scrollbar{width:0!important;height:0!important;display:none!important}
`

/* 抓图前的一致性检查。v723 差点交出假「0」就是因为没查这两条：
   token 失效 → SPA 静默回退 #/workbench → 每页都是同一个工作台。 */
function SANITY() {
  const txt = document.body ? document.body.innerText : ''
  const nodes = document.querySelectorAll('body *').length
  const loginExpired = /登录已过期|请重新登录|登录已失效/.test(txt)
  const nameEl = document.querySelector('.tb-user-name,.user-name,.tb-user')
  const userName = nameEl ? (nameEl.innerText || '').trim().slice(0, 12) : ''
  return {
    hash: location.hash,
    nodes,
    loginExpired,
    userName,
    title: (document.querySelector('h1') || {}).innerText || '',
  }
}

const browser = await launch({ headless: true, chromePath: CHROME_DEFAULT })
const page = await browser.newPage()
await page.enable()

for (const c of [
  { name: 'erp_token', value: TOKEN, httpOnly: true },
  { name: 'hergent_auth', value: '1' },
  { name: 'csrf_token', value: 'x' },
  { name: 'hergent_tenant', value: '1' },
]) await page.raw.send('Network.setCookie', { ...c, domain: 'hergent.cn', path: '/', secure: true, sameSite: 'Lax' })

await page.raw.send('Emulation.setDeviceMetricsOverride', {
  width: VW, height: VH, deviceScaleFactor: 1, mobile: false,
})
/* 动效直接按「用户要求减少动态」来解释 —— 比注入 CSS 更贴近真实，且 CSS 也照注一遍兜底 */
await page.raw.send('Emulation.setEmulatedMedia', {
  features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
})

const outDir = path.join(RUN_DIR, SET)
fs.mkdirSync(outDir, { recursive: true })

const manifest = { set: SET, tookAt: new Date().toISOString(), viewport: [VW, VH], build: '', pages: [] }
const warnings = []

for (const theme of THEMES) {
  const dir = path.join(outDir, theme)
  fs.mkdirSync(dir, { recursive: true })

  /* 主题落在 documentElement 的 .dark 上（不是 data-theme）；先写 localStorage 再进页面 */
  await page.goto('https://hergent.cn/#/workbench', 2600)
  await page.eval(`localStorage.setItem('hergent_theme', ${JSON.stringify(theme)}); 1`)
  manifest.build = await page.eval('window.__HG_BUILD__ || ""')

  for (const [label, slug, route] of PICK) {
    /* 🔴 hash 路由必须整串带上 `#`；只改 hash 不会重新渲染（Vue Router 复用组件），
       所以先回 about:blank 再进目标页 —— 这一步在 v723 漏过一次，两张图字节数完全相同。 */
    await page.goto('about:blank', 150)
    await page.goto('https://hergent.cn/#' + route, 3200)

    await page.eval(`(() => {
      const s = document.createElement('style'); s.textContent = ${JSON.stringify(FREEZE_CSS)};
      document.head.appendChild(s); return 1
    })()`)

    /* 字体没加载完就截 = 首字回退字体，两次抓图可能一个有一个没有 */
    await page.eval('document.fonts.ready.then(() => 1)').catch(() => null)
    /* 焦点环：截图前必须 blur，否则 A 组带环、B 组不带（取决于上一步点过什么） */
    await page.eval('(document.activeElement || {}).blur && document.activeElement.blur(), 1')
    await sleep(700)

    const s = await page.eval(`(${SANITY.toString()})()`)

    /* 三条硬校验，任一不过就中止 —— 宁可不出基线，也不要出一套假的 */
    if (s.loginExpired) warnings.push(`[${theme}/${slug}] 页面提示登录过期 ⇒ 本次抓图无效`)
    if (s.nodes < 200) warnings.push(`[${theme}/${slug}] 节点数仅 ${s.nodes} ⇒ 疑似白屏或静默回退`)
    if (!s.hash.includes(route.replace(/^\//, ''))) warnings.push(`[${theme}/${slug}] hash 未落在目标路由（实际 ${s.hash}）`)
    if (s.userName === '我') warnings.push(`[${theme}/${slug}] 顶栏用户名为「我」⇒ 登录态已失效`)

    const file = path.join(dir, slug + '.png')
    await page.screenshot(file)
    const st = fs.statSync(file)
    if (st.size < 3000) warnings.push(`[${theme}/${slug}] 截图仅 ${st.size} 字节 ⇒ 疑似空白页`)

    manifest.pages.push({ theme, slug, label, route, nodes: s.nodes, h1: s.title, bytes: st.size })
    process.stdout.write(`  ${theme.padEnd(5)} ${slug.padEnd(18)} nodes=${String(s.nodes).padEnd(5)} ${(st.size / 1024).toFixed(0)}KB\n`)
  }
}

fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
await browser.close()

console.log(`\n构建号 ${manifest.build || '?'} → ${path.relative(ROOT, outDir)}（${manifest.pages.length} 张）`)
if (warnings.length) {
  console.log('\n🔴 警告 ' + warnings.length + ' 条：')
  warnings.forEach(w => console.log('   ' + w))
  process.exit(2)
}
console.log('✅ 全部页面通过登录态/节点数/路由三条校验')
