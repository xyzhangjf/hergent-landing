/**
 * v691 全量弹窗回归（覆盖 20 个迁移文件的全部可达入口）
 * ==========================================================================
 * 与同目录 `modal-regression.mjs` 的分工：
 *   · modal-regression.mjs → **单页钻取**（品牌档案，16 条精细断言，含字段数/两列 grid）
 *   · 本文件               → **全站扫面**（每页 9 条通用断言，找「哪一页塌了」）
 *
 * 为什么不写死每页的字段名和数量：那样每加一个字段就要改探针，且 20 页 × N 字段
 * 的维护成本会让人放弃维护 —— 放弃维护的探针等于没有探针。
 * 通用断言抓的是「结构性翻车」，这几类恰好是迁移最容易静默出错的地方：
 *
 *   A1 弹窗打得开        —— v-if / teleport / 插槽搬运是否通
 *   A2 宽度在合理区间    —— width prop 是否真传到了 panel（漏 :style="cardStyle" 会退回 580）
 *   A3 圆角 = --radius-lg —— 页面自己那份圆角 CSS 已删，靠组件接管
 *   A4 层级 ≥ 1125        —— 迁移前 7 处只有 60/900/950/961，会被工具栏 1120 盖住
 *   A5 有遮罩             —— 遮罩是兄弟节点，容易在搬运时丢掉
 *   A6 标题非空           —— 头部插槽搬运丢失
 *   A7 正文长度 ≥ 10      —— 默认插槽内容丢失（最致命且不报错）
 *   A8 输入控件 ≥ 1       —— 表单被 v-if 条件裁掉
 *   A9 无 .tb-pop 浮在上面 —— v617 复发过的层级倒挂
 *   A10/A11 关闭语义       —— 无输入：ESC 一次关；有输入：先拦一次再关（guardClose）
 *
 * 用法：node tests/perf/v691/all-pages.mjs [BASE_URL]
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] || 'http://127.0.0.1:5173'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let pass = 0, fail = 0, skip = 0
const rows = []          // 每页一行汇总，最后打印成表
const say = (label, v, extra) => {
  if (v === 'PASS') { pass++; console.log('    ✅ ' + label) }
  else if (v === 'SKIP') { skip++; console.log('    ⏭️  ' + label + (extra !== undefined ? '  ← ' + JSON.stringify(extra) : '')) }
  else { fail++; console.log('    ❌ ' + label + (extra !== undefined ? '  ← ' + JSON.stringify(extra) : '')) }
}

/* ── 量当前最上层对话框（按 role=dialog，组件已统一设置）────────────────── */
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

  // 遮罩：与卡片同时可见、铺满视口的 fixed 层
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
  // 可真正输入的控件（readonly / disabled 不算，用于判断该不该有「未保存」保护）
  const editable = inputs.filter((el) =>
    !el.disabled && !el.readOnly && el.offsetParent !== null)

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

/* ── 在当前页挑「打开弹窗」的按钮 ─────────────────────────────────────────
   返回候选按钮的**文案**列表（最多 8 个），由 node 侧逐个尝试点击。
   排除导航类容器 —— 否则会点到侧边栏的菜单、顶部工具栏。 */
const CANDS = () => {
  const inNav = (el) => !!el.closest('.sidebar,.topbar,.main-tab,.tabs,.tb-pop,.ui-modal-card,[role=dialog]')
  const vis = (el) => {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const pats = [/新增|添加|新建|创建|录入|开单/, /^\+/, /编辑|修改/, /导入|上传/, /配置|设置|管理/]
  const btns = [...document.querySelectorAll('button')].filter((b) => vis(b) && !inNav(b) && !b.disabled)
  const out = []
  for (const re of pats) {
    for (const b of btns) {
      const t = (b.textContent || '').trim()
      if (!t || t.length > 24) continue
      if (re.test(t) && !out.includes(t)) out.push(t)
    }
  }
  // 兜底：把剩下的短文案按钮也带上（有些页面触发按钮只有图标）
  for (const b of btns) {
    const t = (b.textContent || '').trim()
    if (t && t.length <= 24 && !out.includes(t)) out.push(t)
    if (out.length >= 10) break
  }
  return out
}

const clickByText = (txt) => {
  const vis = (el) => {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const inNav = (el) => !!el.closest('.sidebar,.topbar,.main-tab,.tabs,.tb-pop,.ui-modal-card,[role=dialog]')
  const b = [...document.querySelectorAll('button')]
    .filter((x) => vis(x) && !x.disabled && !inNav(x) && (x.textContent || '').trim() === txt)[0]
  if (!b) return false
  b.click()
  return true
}

/* 打开弹窗：优先点 `prefer`（人工确认过的触发文案），否则依次试候选文案，谁先弹出算谁。
   返回 { ok, by, m } —— by 记录是被哪个按钮点开的，方便定位。 */
const openFirstDialog = async (page, prefer) => {
  const cands = await page.evaluate(CANDS)
  const order = prefer ? [prefer, ...cands.filter((t) => t !== prefer)] : cands
  const tried = []
  for (const t of order) {
    const clicked = await page.evaluate(clickByText, t)
    tried.push(t + '→' + clicked)
    if (!clicked) continue
    await sleep(700)
    const m = await page.evaluate(MEASURE)
    if (m) return { ok: true, by: t, m }
    // 点开的是页面跳转/展开，不是弹窗 → 退回继续找
  }
  return { ok: false, m: null, cands, tried }
}

/* 自愈登录：`goto` 是整页重载，演示令牌若只存在内存（不是 localStorage），
   重载后会掉回登录页。这里不假设它存在哪，直接以「有没有 .topbar」为准，
   没有就重新点一次「先看看演示效果」。 */
const ensureLogin = async (page) => {
  if (await page.$('.topbar')) return false
  const demo = page.getByRole('button', { name: /先看看演示效果/ })
  await demo.first().waitFor({ timeout: 20000 })
  await demo.first().click()
  await page.waitForSelector('.topbar', { timeout: 30000 })
  return true            // true = 本次重登过，路由需要重新走一遍
}

/* 关掉当前所有弹窗（ESC + 兜底点 X），保证下一页从干净状态开始 */
const forceClose = async (page) => {
  for (let i = 0; i < 4; i++) {
    const m = await page.evaluate(MEASURE)
    if (!m) return true
    await page.keyboard.press('Escape')
    await sleep(250)
  }
  const m2 = await page.evaluate(MEASURE)
  if (!m2) return true
  // 还有？点右上角关闭
  await page.evaluate(() => {
    const d = [...document.querySelectorAll('[role=dialog]')][0]
    if (!d) return
    const btn = d.querySelector('button[aria-label="关闭"]')
    if (btn) btn.click()
  })
  await sleep(300)
  return !(await page.evaluate(MEASURE))
}

/* ── 单页回归 ─────────────────────────────────────────────────────────── */
let navSeq = 0
const checkPage = async (page, route, note, prefer) => {
  console.log('\n━━━ ' + route + (note ? '   ' + note : ''))
  const row = { route, status: 'OK', w: '', title: '', note: '' }
  try {
    /* 🔴 用**带递增 query 的 URL 强制整页重载**，不能用 `goto(BASE + '/#' + route)`。
       实测踩到的两个坑（这一版的两次失败都出自这里）：
       1) `goto` 到只有 hash 不同的 URL，浏览器只做 hashchange、**不重载文档** ⇒
          顶栏的页签条（.tb-strip）与 KeepAlive 缓存一路累积。等到第 7 页时，
          页面上同时存在前面 6 页的按钮，`innerText` 也混在一起 ⇒ 断言会假通过。
       2) 累积还会把「新建活动」这类页面内按钮挤出候选窗口（候选被一堆页签名占满），
          于是探针误报「这一页没有弹窗」——**把好页面判成 SKIP，比判成 FAIL 更危险**。
       query 不同 ⇒ 真正的文档重载 ⇒ 每页都是干净起点，与用户直接打开链接一致。
       代价是重载会丢内存里的演示令牌，由 ensureLogin 自愈。 */
    navSeq += 1
    await page.goto(BASE + '/?__p=' + navSeq + '#' + route, { waitUntil: 'domcontentloaded' })
    await sleep(1500)
    if (await ensureLogin(page)) {
      /* 重登后 router 可能被踢回首页 —— 再走一次目标路由 */
      navSeq += 1
      await page.goto(BASE + '/?__p=' + navSeq + '#' + route, { waitUntil: 'domcontentloaded' })
      await sleep(1500)
    }
    await sleep(2200)
    const shell = await page.$('.topbar')
    if (!shell) { say('页面渲染出来', 'FAIL', '连登录后的顶栏都没有'); row.status = 'ERR'; row.note = '未登录'; rows.push(row); return }

    const opened = await openFirstDialog(page, prefer)
    if (!opened.ok) {
      /* 弹窗没打开不等于弹窗坏了：演示租户对部分模块无权限（诊断实测 /rebate、
         /forecast、/inventory/stock 接口 403，页面根本没渲染出自己的按钮）。
         这种情况必须如实标 SKIP，**不能**记成 PASS —— 它意味着「还没验过」。 */
      say('页面有可打开的弹窗', 'SKIP', '点遍候选仍未弹出（如需授权页面请用 boss 账号人工核）')
      console.log('    [诊断] 候选=' + JSON.stringify(opened.cands) + '  尝试=' + JSON.stringify(opened.tried))
      row.status = 'SKIP'
      row.note = '无可达弹窗'
      rows.push(row)
      return
    }
    const m = opened.m
    row.w = m.w
    row.title = m.title
    console.log('    （由「' + opened.by + '」打开：' + m.title + ' / ' + m.w + 'px）')

    const lgToken = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--radius-lg').trim())

    say('A1 弹窗打得开', 'PASS')
    say('A2 宽度在 380–1000', m.w >= 380 && m.w <= 1000 ? 'PASS' : 'FAIL', m.w)
    say('A3 圆角 = --radius-lg', m.radius === lgToken ? 'PASS' : 'FAIL', { got: m.radius, token: lgToken })
    say('A4 层级 ≥ 1125', m.z >= 1125 ? 'PASS' : 'FAIL', m.z)
    say('A5 有遮罩', m.mask ? 'PASS' : 'FAIL', m.mask)
    say('A6 标题非空', m.title ? 'PASS' : 'FAIL', m.title)
    say('A7 正文文本 ≥ 10 字', m.textLen >= 10 ? 'PASS' : 'FAIL', m.textLen)
    say('A8 输入控件 ≥ 1', m.inputCount >= 1 ? 'PASS' : 'SKIP', m.inputCount)
    say('A9 无浮层压在弹窗上', m.floats.length === 0 ? 'PASS' : 'FAIL', m.floats)

    /* A10/A11 关闭语义
       · 无可输入控件（纯查看/纯确认）→ ESC 一次就该关
       · 有可输入控件 → 敲一个字，第一次 ESC 应被 guardClose 拦住（hint 出现），
         第二次 ESC 才关。这条专门防「加了 guard 但没真的接上」这种静默失效。 */
    if (m.editableCount === 0) {
      await page.keyboard.press('Escape')
      await sleep(450)
      const after = await page.evaluate(MEASURE)
      say('A10 ESC 一次能关（无输入控件）', !after ? 'PASS' : 'FAIL', after ? after.title : '')
    } else {
      // 真敲一个字，触发 input 事件让组件记 touched
      const typed = await page.evaluate(() => {
        const d = [...document.querySelectorAll('[role=dialog]')]
          .sort((a, b) => (Number(getComputedStyle(b).zIndex) || 0) - (Number(getComputedStyle(a).zIndex) || 0))[0]
        if (!d) return false
        const el = [...d.querySelectorAll('input:not([type=hidden]),textarea')]
          .find((x) => !x.disabled && !x.readOnly && x.offsetParent !== null)
        if (!el) return false
        el.focus()
        el.value = (el.value || '') + 'x'
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      })
      if (!typed) {
        say('A10 ESC 一次能关', 'SKIP', '找不到可输入的控件')
      } else {
        await page.keyboard.press('Escape')
        await sleep(450)
        const still = await page.evaluate(MEASURE)
        /* 提示条有两个来源，都要认：
           · 组件统一的 .ui-modal-guard（guardClose 生效）
           · 页面自带的（SupplierArchive 的 .sup-hint，它没走 guardClose 而用自己的 tryClose）
           只认前者会把"页面自有确认"误判成失败。 */
        const hint = await page.evaluate(() => {
          const g = document.querySelector('.ui-modal-guard')
          if (g && g.offsetParent !== null) return (g.innerText || '').trim()
          const el = [...document.querySelectorAll('[role=alert],.sup-hint,.vc-hint,.rs-hint,.pt-hint')]
            .find((x) => x.offsetParent !== null && /未保存|再点一次/.test(x.innerText || ''))
          return el ? (el.innerText || '').trim() : ''
        })
        say('A11 有改动时第一次 ESC 被拦（弹窗仍在）', !!still ? 'PASS' : 'FAIL')
        say('A11b 出现「未保存」提示条', /未保存|再点一次/.test(hint) ? 'PASS' : 'FAIL', hint)
        await page.keyboard.press('Escape')
        await sleep(500)
        const after2 = await page.evaluate(MEASURE)
        say('A11c 第二次 ESC 真关掉', !after2 ? 'PASS' : 'FAIL', after2 ? after2.title : '')
      }
    }
  } catch (e) {
    row.status = 'ERR'
    row.note = e.message.slice(0, 60)
    say('页面回归', 'FAIL', e.message.slice(0, 80))
  }
  await forceClose(page)
  rows.push(row)
}

/* ── 主流程 ───────────────────────────────────────────────────────────── */
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
const page = await ctx.newPage()

/* 路由清单 = 20 个迁移文件的可达入口。
   第 3 项是「人工确认过的触发文案」—— 有就优先点它，避免通用启发式点到
   别的（比如先点到「刷新」把页面重载了）。
   同一页承载多个弹窗时（Rebate 3 个、ConnectCenter 4 个），本探针只验
   「第一个能打开的那个」—— 逐个穷举留待人工，见最终报告。 */
const ROUTES = [
  ['/archive/brands',    'BrandArchive（3 弹窗）',        '+ 添加品牌'],
  ['/archive/suppliers', 'SupplierArchive（2，自带 tryClose，不加 guard）', '+ 新增供应商'],
  ['/archive/customers', 'CustomerArchive（3）',          '+ 新增客户'],
  ['/archive/warehouses','WarehouseArchive（2）',         '＋ 新建仓库'],
  ['/archive/employees', 'EmployeeArchive（5）',          '＋ 新建外部客户'],
  ['/archive/prices',    'PriceChannels（2）',            '新建渠道'],
  ['/mkt/promotions',    'Promotions（1）',               '新建活动'],
  ['/funds/receipt',     'FundsDoc（2）',                 '新建'],
  ['/cron',              'CronJobs（1）',                 '新建任务'],
  ['/roles',             'RoleManage（3）',               '+ 新建团队'],
  ['/connect',           'ConnectCenter（4，含 DataLedger）', ''],
  /* LossAccounting 的工具条（上传数据 / 叫法映射 / 数据体检）挂在「数据填报」tab 下，
     默认落在仪表盘 tab ⇒ 直接带 query 进去，不靠探针点 tab。 */
  ['/loss-accounting?tab=fill', 'LossAccounting（1 组件 5 用途）', '上传数据'],
  ['/ai-hub',            'AiHub（1 报告查看）',               ''],
  ['/rebate',            'Rebate（含 Commitments/Settlement/TargetForm）', ''],
  ['/forecast',          'Forecast（含 ReportMapping）',      ''],
  /* WhDialog 的真实使用者是仓库出入库单，不是库存查询页（后者本来就没有弹窗） */
  ['/wh/inbound',        '+ 入库单（WhDialog 薄封装）',       ''],
  ['/wh/outbound',       '+ 出库单（WhDialog 薄封装）',       ''],
]

try {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  const demo = page.getByRole('button', { name: /先看看演示效果/ })
  await demo.first().waitFor({ timeout: 30000 })
  await demo.first().click()
  await page.waitForSelector('.topbar', { timeout: 30000 })
  await sleep(1500)
  console.log('✅ 进入演示租户')

  for (const [r, note, prefer] of ROUTES) await checkPage(page, r, note, prefer)
} catch (e) {
  fail++
  console.log('\n💥 探针异常：' + e.message)
}

console.log('\n══════════ 汇总 ══════════')
for (const r of rows) {
  const mark = r.status === 'OK' ? '✅' : r.status === 'SKIP' ? '⏭️ ' : '❌'
  console.log(`${mark} ${r.route.padEnd(22)} ${String(r.w).padStart(4)}px  ${(r.title || '').padEnd(18)} ${r.note}`)
}
console.log('══════════════════════════')
console.log(`结果：PASS ${pass} / FAIL ${fail} / SKIP ${skip}`)

await browser.close()
process.exit(fail ? 1 : 0)
