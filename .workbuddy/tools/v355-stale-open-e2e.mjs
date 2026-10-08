/**
 * v355 真机只读验证（生产 hergent.cn）：「过期未关」期次可见化。
 *
 * 背景：v354 修的僵尸期次（status=open 但报单窗口已过）会挡住自动建表，
 *   而它在界面上此前**显示为绿色「进行中」**、连着两天零提示。
 *   v355 加三处提醒 + 一个后端分叉。本探针在**生产真实数据**上验证它真的到位了。
 *
 * 当前生产事实（2026-10-01 只读核对 tenant_1）：
 *   #22  2026-10-01 报单期次  status=open    order_end=2026-10-01  ⇒ stale_open=false（窗口含今天）
 *   #21  2026-09-29 报单期次  status=closed  closed_mode=auto_reap ⇒ 历史页该显示「系统自动回收（报单窗口已过）」
 *   ⇒ 自然形成 **四负一正** 的判别矩阵，且正向那条是真数据留下的真痕迹（不是造出来的）。
 *
 * 🔴 判别力自证（本探针的核心纪律）：
 *   「负向断言全过」有可能是因为**探针根本看不见**。所以每条负向断言都配一次
 *   注入同款 DOM 节点的正向对照：现状 0 → 注入 1 → 移除 0。
 *   三步全对才算「检测器有判别力」，否则那几条 PASS 不算数。
 *
 * 🔴 只读：唯一出网写请求 = 探针自身的 POST /api/auth/login + 末尾 logout。
 * 用法：node .workbuddy/tools/v355-stale-open-e2e.mjs
 */
import { chromium } from '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/node_modules/playwright/index.mjs'
import fs from 'fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const TAG = 'v355-stale-open'
const USER = process.env.HG_USER || 'mptestsp'
const PASS = process.env.HG_PASS || 'Mpsup@1'
const OUT = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/' + TAG + '-2026-10-01'
fs.mkdirSync(OUT, { recursive: true })

let pass = 0, fail = 0
const ok = (c, name, extra = '') => {
  if (c) { pass++; console.log('  ✅ ' + name + (extra ? '  [' + extra + ']' : '')) }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  [' + extra + ']' : '')) }
}

/* v355 五条判别串（逐字取自源码，不是大意） */
const S = {
  noOpen: '当前没有进行中的期次。',            // Forecast.vue GATE_LEAD（既有横幅）
  staleLead: '本期报单已经截止，但还挂着「进行中」。', // Forecast.vue STALE_LEAD（v355 新增）
  staleSub: '已过报单截止日 · 挡住下一期创建',   // ForecastHistory.vue 副行（v355 新增）
  staleTag: '进行中 · 已过截止日',              // ForecastHistory.vue 标签（v355 新增）
  reap: '系统自动回收（报单窗口已过）',         // ForecastHistory.vue closeHint（v355 新增）
}

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--no-sandbox', '--disable-gpu'],
})
const ctx = await browser.newContext({ viewport: { width: 1680, height: 1050 } })
const page = await ctx.newPage()

const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(e.message))

const writes = [], forbidden = []
page.on('request', (r) => {
  const u = r.url()
  if (r.method() === 'GET') return
  if (/\/api\/auth\/(login|logout)/.test(u)) { writes.push(r.method() + ' ' + u.replace(BASE, '')); return }
  writes.push('⚠️ 意外写请求 ' + r.method() + ' ' + u.replace(BASE, ''))
})
page.on('response', (r) => {
  if (r.status() === 403 && r.url().includes('/api/')) forbidden.push(r.url().replace(BASE, '').split('?')[0])
})

const shot = async (t) => { try { await page.screenshot({ path: OUT + '/' + TAG + '-' + t + '.png' }) } catch (_) {} }
const H = () => ({ Authorization: 'Bearer ' + localStorage.getItem('hergent_v2_token'), 'X-Client': 'web' })

/* ---------- 判别力工具：同一套选择器，现状 / 注入 / 移除 ---------- */
const det = (needle, scope) => page.evaluate(([nd, sc]) => {
  const sel = sc === 'banner' ? '.gate-bar .gate-txt' : '.hd-sub.warn'
  return [...document.querySelectorAll(sel)].filter((e) => (e.textContent || '').includes(nd)).length
}, [needle, scope])

const inj = (txt, scope) => page.evaluate(([t, sc]) => {
  const wrap = document.createElement('div')
  wrap.id = '__v355_probe__'
  if (sc === 'banner') {
    wrap.className = 'gate-bar'
    const s = document.createElement('span')
    s.className = 'gate-txt'
    s.textContent = t
    wrap.appendChild(s)
  } else {
    wrap.className = 'hd-sub warn'
    wrap.textContent = t
  }
  document.body.prepend(wrap)
  return !!document.getElementById('__v355_probe__')
}, [txt, scope])

const rm = () => page.evaluate(() => {
  const e = document.getElementById('__v355_probe__')
  if (e) e.remove()
  return !document.getElementById('__v355_probe__')
})

/* 三步自证：现状 → 注入 → 移除 */
const selfProve = async (needle, scope, label) => {
  const before = await det(needle, scope)
  await inj(needle, scope)
  const during = await det(needle, scope)
  await rm()
  const after = await det(needle, scope)
  const good = before === 0 && during === 1 && after === 0
  ok(good, '判别力自证：' + label + ' 检测器 0 → 注入 1 → 移除 0',
    `before=${before} during=${during} after=${after}`)
}

/* ---------- A. 登录 ---------- */
console.log('\nA. 登录')
await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' })
const loginRes = await page.evaluate(async ([u, p]) => {
  const r = await fetch('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Client': 'web' },
    body: JSON.stringify({ username: u, password: p }),
  })
  const d = await r.json()
  if (!d.token) return 'NO:' + JSON.stringify(d).slice(0, 160)
  localStorage.setItem('hergent_v2_token', d.token)
  if (d.csrf_token) localStorage.setItem('hergent_v2_csrf', d.csrf_token)
  if (d.user) localStorage.setItem('hergent_v2_user', JSON.stringify(d.user))
  if (d.tenant_id) localStorage.setItem('hergent_v2_tenant', String(d.tenant_id))
  return 'OK:' + (d.user && d.user.role) + ':tenant' + d.tenant_id
}, [USER, PASS])
ok(String(loginRes).startsWith('OK:'), '真账号登录 ' + USER, loginRes)
if (!String(loginRes).startsWith('OK:')) { await browser.close(); process.exit(1) }

/* ---------- B. 后端契约（直调接口，不看渲染） ---------- */
console.log('\nB. 后端契约（v355 新字段真的下发了吗）')
const per = await page.evaluate(async () => {
  const r = await fetch('/api/forecast/periods', {
    headers: { Authorization: 'Bearer ' + localStorage.getItem('hergent_v2_token'), 'X-Client': 'web' },
  })
  return { status: r.status, body: await r.json() }
})
ok(per.status === 200, '/api/forecast/periods 200', 'status=' + per.status)
const hasOS = Object.prototype.hasOwnProperty.call(per.body, 'open_stale')
const hasAR = Object.prototype.hasOwnProperty.call(per.body, 'auto_reap_on')
ok(hasOS && hasAR, 'periods 契约含 open_stale + auto_reap_on（后端已上线）',
  `open_stale=${JSON.stringify(per.body.open_stale)} auto_reap_on=${JSON.stringify(per.body.auto_reap_on)}`)
ok(per.body.open_stale === false && typeof per.body.open_stale === 'boolean',
  'open_stale=false 且为布尔（#22 窗口含今天 ⇒ 不是僵尸）', 'typeof=' + typeof per.body.open_stale)

const ob = await page.evaluate(async () => {
  const r = await fetch('/api/forecast/order-board', {
    headers: { Authorization: 'Bearer ' + localStorage.getItem('hergent_v2_token'), 'X-Client': 'web' },
  })
  const d = await r.json()
  return { status: r.status, board: d.board || [] }
})
ok(ob.status === 200, '/api/forecast/order-board 200', 'status=' + ob.status)
const r21 = ob.board.find((x) => Number(x.id) === 21)
const r22 = ob.board.find((x) => Number(x.id) === 22)
const syn = ob.board.filter((x) => Number(x.id) < 0)
console.log('    看板行数 =', ob.board.length, '| 合成行 =', syn.length)
ok(!!r21, '#21 2026-09-29 期次在看板里')
ok(r21 && r21.closed_mode === 'auto_reap' && r21.finalized === true,
  '#21 留痕 closed_mode=auto_reap（本轮的回收修正已落库）',
  r21 ? `mode=${r21.closed_mode} finalized=${r21.finalized} by=${r21.closed_by}` : '')
ok(!!r22 && r22.status === 'open' && r22.stale_open === false,
  '#22 status=open 且 stale_open=false（逐行标记到位）',
  r22 ? `status=${r22.status} stale_open=${r22.stale_open} order_end=${r22.order_end}` : '')
const staleCnt = ob.board.filter((x) => x.stale_open === true).length
ok(staleCnt === 0, '当前看板 stale_open=true 的行数 = 0（无僵尸期次，符合生产现状）', 'n=' + staleCnt)
/* B5. 判据复刻校准 ＋ id>0 护栏在生产真行上的判别力实验。
   ⚠️ 本租户当前**没有**未被期次区间覆盖的报单日期 ⇒ 合成行 0 条，
      若照写「合成行 stale_open 恒 false」就是**空真**（没有判别力，等于没断言）。
      合成行原场景由护栏脚本 v355-stale-open-visible-harness.py B 组在内存库覆盖；
      这里改用**生产真行改造**做等价验证，且正反两侧都给。 */
const TODAY = (() => {
  const d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
})()
const staleImpl = (row, today) => {            // 与后端 forecast_period_stale_open 同款
  if (Number(row.id || 0) <= 0) return false
  if (String(row.status || 'open') !== 'open') return false
  const oe = String(row.order_end || '').slice(0, 10)
  if (oe.length < 10) return false
  return oe < today
}
const staleBadNoId = (row, today) => {         // 坏实现对照：漏掉 id>0 护栏
  if (String(row.status || 'open') !== 'open') return false
  const oe = String(row.order_end || '').slice(0, 10)
  if (oe.length < 10) return false
  return oe < today
}
const mism = ob.board.filter((x) => staleImpl(x, TODAY) !== !!x.stale_open)
ok(mism.length === 0, 'Node 侧复刻判据 vs 后端下发值**逐行一致**（我理解的判据 == 后端实现）',
  ob.board.length + ' 行 / 不一致 ' + mism.length)
console.log('     合成行 =', syn.length, '条 ⇒ 该场景改由「生产真行改造」验证（见下）')
const zRow = r22 ? { ...r22, order_end: '2026-09-29' } : null
const asReal = zRow ? staleImpl(zRow, TODAY) : null
const asSyn = zRow ? staleImpl({ ...zRow, id: -1 }, TODAY) : null
const asBad = zRow ? staleBadNoId({ ...zRow, id: -1 }, TODAY) : null
ok(asReal === true && asSyn === false,
  'id>0 护栏判别力（生产真行改造）：order_end 挪到过去 ⇒ true；再令 id=-1 ⇒ false',
  '真行=' + asReal + ' 合成行=' + asSyn)
ok(asBad === true && asSyn === false,
  '坏实现对照：漏掉 id>0 的写法会把同一行误报成僵尸（证明护栏不是装饰）',
  '坏实现=' + asBad + ' 正解=' + asSyn)
const allHave = ob.board.every((x) => Object.prototype.hasOwnProperty.call(x, 'stale_open'))
ok(allHave, '看板每一行都带 stale_open 键（无遗漏分支）')

/* ---------- C. 预报页（负向：当前不该出现警示） ---------- */
console.log('\nC. 预报页 /#/forecast')
forbidden.length = 0
await page.goto(BASE + '/#/forecast', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(5500)
await shot('01-forecast')
const cText = await page.evaluate(() => document.body.innerText)
const c403 = [...new Set(forbidden)].sort()
console.log('     该页 403 接口:', c403.length ? JSON.stringify(c403) : '无')
const cFc = c403.filter((u) => u.startsWith('/api/forecast') || u.startsWith('/api/forecast-submissions') || u.startsWith('/api/products'))
ok(cFc.length === 0, '预报域接口零 403（v355 的三处改动未引入权限回归）', JSON.stringify(cFc))
/* 其余 403（如 /api/ai/roles）归因见 F 段 */
ok(pageErrors.length === 0, '无 JS 报错', pageErrors.slice(0, 2).join(' | '))
ok(cText.length > 300, '页面正文非空', 'len=' + cText.length)
const gateBars = await page.evaluate(() => [...document.querySelectorAll('.gate-bar')].map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 90)))
console.log('     本页 .gate-bar 共', gateBars.length, '条:', JSON.stringify(gateBars))
ok(!cText.includes(S.noOpen), '负向：不含「当前没有进行中的期次。」（确实有 open 期次）')
ok(!cText.includes(S.staleLead), '负向：不含「本期报单已经截止…」（#22 未过期 ⇒ 不该弹警示）')
ok(!cText.includes(S.staleSub) && !cText.includes(S.staleTag), '负向：不含历史页那两条过期文案')
await selfProve(S.staleLead, 'banner', '预报页横幅')

/* ---------- D. 历史期次页（正向：#21 的真痕迹必须可见） ---------- */
console.log('\nD. 历史期次页 /#/forecast?tab=history')
forbidden.length = 0
await page.goto(BASE + '/#/forecast?tab=history', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(5500)
await shot('02-history')
const hist = await page.evaluate(() => {
  const trs = [...document.querySelectorAll('tbody tr')]
  const pick = (needle) => {
    const tr = trs.find((t) => (t.textContent || '').includes(needle))
    if (!tr) return null
    const tag = tr.querySelector('.tag')
    const warn = tr.querySelector('.hd-sub.warn')
    return {
      text: (tr.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 150),
      tag: tag ? (tag.textContent || '').trim() : null,
      warn: warn ? (warn.textContent || '').trim() : null,
      hasReap: (tr.textContent || '').includes('系统自动回收（报单窗口已过）'),
      hasSub: (tr.textContent || '').includes('已过报单截止日 · 挡住下一期创建'),
    }
  }
  return { total: trs.length, body: (document.body.innerText || ''), r21: pick('2026-09-29 报单期次'), r22: pick('2026-10-01 报单期次') }
})
const d403 = forbidden.slice()
console.log('     该页 403 接口:', d403.length ? JSON.stringify(d403) : '无')
console.log('     历史表行数 =', hist.total)
console.log('     #21 行:', JSON.stringify(hist.r21))
console.log('     #22 行:', JSON.stringify(hist.r22))
ok(d403.length === 0, '该页无 403')
ok(pageErrors.length === 0, '无 JS 报错', pageErrors.slice(0, 2).join(' | '))
ok(hist.total > 0, '历史表有行', 'rows=' + hist.total)
ok(!!hist.r21 && hist.r21.hasReap,
  '✅ 正向（真数据）：#21 行显示「系统自动回收（报单窗口已过）」—— v355 留痕分叉真的渲染出来了')
ok(!!hist.r21 && hist.r21.tag === '已关闭', '#21 状态标签 = 已关闭', hist.r21 ? hist.r21.tag : '')
ok(!!hist.r22 && hist.r22.tag === '进行中', '#22 状态标签 = 「进行中」（未被误标成「已过截止日」）', hist.r22 ? hist.r22.tag : '')
ok(!!hist.r22 && hist.r22.warn === null, '#22 行没有琥珀色副行（stale_open=false 已传到渲染层）',
  hist.r22 ? String(hist.r22.warn) : '')
ok(!hist.body.includes(S.staleSub), '负向：全页不含「已过报单截止日 · 挡住下一期创建」')
ok(!hist.body.includes(S.staleTag), '负向：全页不含「进行中 · 已过截止日」')
const warnCnt = await page.evaluate(() => document.querySelectorAll('.hd-sub.warn').length)
ok(warnCnt === 0, '全页 .hd-sub.warn 数量 = 0（与上一条互证）', 'n=' + warnCnt)
await selfProve(S.staleSub, 'sub', '历史页副行')

/* ---------- E. 只读自证 ---------- */
console.log('\nE. 只读自证')
const READONLY_POST_RES = [/\/api\/rebate-rules\/simulate/]
const badWrites = writes.filter((w) =>
  !/^POST \/api\/auth\/(login|logout)$/.test(w) && !READONLY_POST_RES.some((re) => re.test(w)))
ok(badWrites.length === 0, '无意外写请求', 'bad=' + JSON.stringify(badWrites) + ' | all=' + JSON.stringify(writes))
ok(pageErrors.length === 0, '全程无 JS 报错', pageErrors.slice(0, 3).join(' | '))

/* ---------- F. 403 归因对照（换一个与 v355 无关的页面） ----------
   C 段那条 `/api/ai/roles` 403 必须归因：是 v355 引入的，还是全局既有？
   做法：goto 一个与预报毫不相干的页面（工作台），看**同一组** 403 是否照样出现。
   若两组完全相同 ⇒ 它来自全局外壳（`src/store/index.js` 的 `loadAiRoles()`：主管角色
   无 `ai` 模块 ⇒ RBAC 403 ⇒ store 的 catch 兜底成空角色列表，界面无异常）。
   ⇒ 判定为「探针账号的既有权限现状」，**不是** v355 的回归。 */
console.log('\nF. 403 归因对照（无关页）')
forbidden.length = 0
await page.goto(BASE + '/#/workbench', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(4500)
await shot('03-workbench')
const w403 = [...new Set(forbidden)].sort()
console.log('     工作台 403:', JSON.stringify(w403))
console.log('     预报页 403:', JSON.stringify(c403))
const wAi = w403.filter((u) => u.startsWith('/api/ai/'))
const cAi = c403.filter((u) => u.startsWith('/api/ai/'))
/* ⚠️ 别断「两页 403 完全相同」—— 实测两页**本来就不同**（工作台 6 条、预报页 1 条），
   403 是随页面而变的。正确判据是：① AI 域 403 跨页共有；② 预报页除 AI 域外一条都没有。 */
ok(wAi.length > 0 && cAi.length > 0,
  '`/api/ai/*` 域 403 在两个页面都出现 ⇒ 角色既有现状，不是 v355 引入',
  '工作台 ' + JSON.stringify(wAi) + ' / 预报页 ' + JSON.stringify(cAi))
const cOther = c403.filter((u) => !u.startsWith('/api/ai/'))
ok(cOther.length === 0, '预报页除 AI 域外零 403（v355 改动域完全干净）', JSON.stringify(cOther))
/* F2. 硬证据：主管权限集里根本没有 `ai` ⇒ 那个 403 是 RBAC 的必然结果 */
const perms = await page.evaluate(async () => {
  const r = await fetch('/api/auth/permissions', {
    headers: { Authorization: 'Bearer ' + localStorage.getItem('hergent_v2_token'), 'X-Client': 'web' },
  })
  return await r.json()
})
const plist = perms.permissions || []
ok(!plist.includes('ai'), '主管权限集不含 `ai` ⇒ `/api/ai/roles` 403 是 RBAC 必然结果（非 v355 回归）', JSON.stringify(plist))
ok(plist.includes('forecast') && plist.includes('data'),
  '该账号仍持有 forecast + data（预报页取数正常）', JSON.stringify(plist))

console.log('\n' + '='.repeat(64))
console.log('结果: ' + pass + ' 通过 / ' + fail + ' 失败')
console.log('截图: ' + OUT)
await page.evaluate(() => fetch('/api/auth/logout', {
  method: 'POST', headers: { Authorization: 'Bearer ' + localStorage.getItem('hergent_v2_token') },
}).catch(() => {}))
await browser.close()
process.exit(fail ? 1 : 0)
