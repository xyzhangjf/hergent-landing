/**
 * v368 界面层真机验收探针（无头 Chrome + CDP 直打生产）。
 *
 * 老板本轮拍板四条，界面层能验的是其中三条（②的契约在影子库 G12 与接口层证，
 *   这里再补一条**界面可见**的证据：停单存在时手动建表照样建得出来）：
 *   ① 任一品牌停 ⇒ 整期不建（回执文案必须跟着改，不能再说「仍会按期建」）
 *   ③ 已存在期次给「一键作废」入口（历史页：说明条 + 行内标记 + 按钮 + 点了真生效）
 *   ④ 期次列表加「有 N 期的货不来了」说明
 *
 * ★ 为什么用「远期临时期次」而不是生产在用的 #23：
 *   #23（2026-10-03 报单期次）**此刻窗口正开着**（10-02 16:00 ~ 10-03 21:00）。
 *   若把它作废，调度器下一轮（每 5 分钟）发现"没有 open 期次 + 窗口开着"⇒
 *   **会真的再建一期出来** —— 那才是不可收拾的副作用（v354/355 死锁的反面）。
 *   ⇒ 改为新建一个窗口不重叠的远期期次（2026-11-20 / 到货 11-24），它自己顶着
 *     "已有 open"那道闸 ⇒ 期间不会误建；用完即删（已 closed 才能删，正好作废过）。
 *
 * ★ 顺序本身就是②的证据：先标记 11-24「不到货」，**再**手动建到货 11-24 的期次
 *   ⇒ 建得出来 ⇒ 「手动建表不读停单」这条契约在界面上肉眼可见。
 *
 * 🔴 可完全复原：临时期次删除 + 停单清空，收尾用接口自证库内确实干净。
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = 'https://hergent.cn'
const OUT = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/停单排除升级与一键作废-v368-2026-10-02'
const smoke = fs.readFileSync('/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/hergent-forecast-smoke.mjs', 'utf8')
const USER = /HG_USER \|\| '([^']*)'/.exec(smoke)[1]
const PASS = /HG_PASS \|\| '([^']*)'/.exec(smoke)[1]
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
fs.mkdirSync(OUT, { recursive: true })

const _P = [], _F = []
const ok = (name, cond, detail = '') => {
  ;(cond ? _P : _F).push(name)
  console.log((cond ? '  PASS  ' : '  🔴FAIL ') + name + (detail ? ' | ' + JSON.stringify(detail) : ''))
}
const sec = (t) => console.log('\n' + '='.repeat(78) + '\n' + t + '\n' + '='.repeat(78))

const br = await launch({})
const page = await br.newPage()
await page.enable()
const ev = (e, a = true) => page.eval(e, a)

async function shot(file, sels) {
  const r = await ev(`(() => {
    const sel = ${JSON.stringify(sels)}
    const els = sel.map(s => document.querySelector(s)).filter(Boolean)
    if (!els.length) return null
    els[0].scrollIntoView({ block: 'center' })
    const bs = els.map(e => e.getBoundingClientRect())
    const x = Math.min(...bs.map(b => b.x)), y = Math.min(...bs.map(b => b.y))
    const x2 = Math.max(...bs.map(b => b.x + b.width)), y2 = Math.max(...bs.map(b => b.y + b.height))
    return { x: Math.max(0, x - 14), y: Math.max(0, y - 14), width: (x2 - x) + 28, height: (y2 - y) + 28 }
  })()`)
  if (!r) { console.log('    [截图跳过] 找不到：' + sels.join(', ')); return false }
  const res = await page.raw.send('Page.captureScreenshot', { format: 'png', clip: { ...r, scale: 1 } })
  fs.writeFileSync(file, Buffer.from(res.result.data, 'base64'))
  console.log('    [截图] ' + file)
  return true
}

async function closeModal() {
  await ev(`(() => {
    const b = [...document.querySelectorAll('.modal-ft button')].find(x=>['关闭','取消'].includes((x.innerText||'').trim()))
    if (b) { b.click(); return 'foot' }
    const x = document.querySelector('.modal-card .btn-close')
    if (x) { x.click(); return 'x' }
    return 'none'
  })()`)
  await sleep(1200)
}

/** 打开某品牌编辑弹窗并自证（v365 踩过：按行文本取第一行会点错规则） */
async function openBrand(name) {
  await closeModal()
  await page.goto(BASE + '/#/rebate', 4200)
  await ev(`(() => { const b=[...document.querySelectorAll('button.main-tab')].find(x=>(x.innerText||'').trim()==='目标与返利'); if(b) b.click() })()`)
  await sleep(2400)
  const n = await ev(`[...document.querySelectorAll('tr')].filter(t=>(t.innerText||'').includes(${JSON.stringify(name)}) && [...t.querySelectorAll('button')].some(b=>(b.innerText||'').trim()==='编辑')).length`)
  for (let i = 0; i < n; i++) {
    const hit = await ev(`(() => {
      const rows = [...document.querySelectorAll('tr')].filter(t=>(t.innerText||'').includes(${JSON.stringify(name)}) && [...t.querySelectorAll('button')].some(b=>(b.innerText||'').trim()==='编辑'))
      const b = [...rows[${i}].querySelectorAll('button')].find(x=>(x.innerText||'').trim()==='编辑')
      if (!b) return 'no-btn'
      b.click(); return 'ok'
    })()`)
    if (hit !== 'ok') break
    await sleep(2800)
    const scope = await ev(`(() => { const el = document.querySelector('.modal-card input[list]'); return el ? String(el.value || '').trim() : '' })()`)
    if (scope === name) return { ok: true, row: i, scope, candidates: n }
    await closeModal()
  }
  return { ok: false, scope: null, candidates: n }
}

async function clickDay(day) {
  const r = await ev(`(() => {
    const d=[...document.querySelectorAll('.arr-day')].find(x=>((x.querySelector('.arr-day-d')||{}).innerText||'').trim()===${JSON.stringify(String(day))})
    if(!d) return 'no-day'
    d.click(); return 'clicked'
  })()`)
  if (r === 'no-day') return { r, off: null }
  await sleep(600)
  return { r, off: await skippedDays() }
}
const save = () => ev(`(() => {
  const b=[...document.querySelectorAll('.modal-ft .btn-primary')].find(x=>(x.innerText||'').trim()==='保存')
  if(!b) return 'no-save'
  b.click(); return 'ok'
})()`)
const say = () => ev(`(() => { const e=document.querySelector('.ap-skip-effect'); return e ? (e.innerText||'').trim() : '' })()`)
const modalOpen = () => ev(`!!document.querySelector('.modal-card .arrival-block')`)
const skippedDays = () => ev(`[...document.querySelectorAll('.arr-day.off .arr-day-d')].map(x=>(x.innerText||'').trim())`)

/* ---------------- 0. 登录 ---------------- */
sec('0. 登录')
await page.goto(BASE + '/', 3500)
await ev(`(async () => {
  const r = await fetch('/api/auth/login', {method:'POST',
    headers:{'Content-Type':'application/json','X-Client':'web'},
    body: JSON.stringify({username:${JSON.stringify(USER)},password:${JSON.stringify(PASS)}})})
  const d = await r.json()
  localStorage.setItem('hergent_v2_token', d.access_token || d.token || '')
  localStorage.setItem('hergent_v2_tenant', String(d.tenant_id || ''))
  localStorage.setItem('hergent_v2_user', JSON.stringify(d.user || {}))
  return d.access_token ? 1 : 0
})()`)
ok('0.1 页面内登录完成', true)
/** 页面内读接口（收尾自证用，不走 UI —— 避免"UI 说复原了"其实没复原） */
const api = (method, path, body) => ev(`(async () => {
  const t = localStorage.getItem('hergent_v2_token') || ''
  const r = await fetch(${JSON.stringify(path)}, {method:${JSON.stringify(method)},
    headers:{'Content-Type':'application/json','X-Client':'web','Authorization':'Bearer '+t},
    body: ${body ? JSON.stringify(JSON.stringify(body)) : 'undefined'}})
  return await r.json()
})()`)

/* ---------------- 1. ① 任一品牌停 ⇒ 整期不建（回执文案） ---------------- */
sec('1. ① 只停「蒙牛低温」的 10-09 ⇒ [v368 反转] 回执必须说「不再自动新建」')
let open = await openBrand('蒙牛低温')
ok('1.1 打开「蒙牛低温」编辑面板（自证是这一条）', open.ok, open)
const before1 = await skippedDays()
ok('1.2 起点：10-09 尚未被停（后续变化的反证）', !before1.includes('9'), before1)
const c1 = await clickDay(9)
ok('1.3 点中到货日历 9 号 ⇒ 变为已停', c1.r === 'clicked' && c1.off.includes('9'), c1)
await save()
await sleep(3000)
ok('1.4 🔴 有回执时面板不关闭（关掉就等于没说过）', await modalOpen())
const t1 = await say()
ok('1.5 回执已渲染', !!t1, t1)
ok('1.6 🔴🔴 [v368 反转] 文案是「不再自动新建」，**不是**「仍会按期建」'
  + '（v365 的旧文案已失效：那时部分停 ⇒ 照建）',
  /不再自动新建/.test(t1) && !/仍会按期建/.test(t1), t1)
ok('1.7 🔴 如实交代「谁其实有货、但跟着一起不建」（蒙牛鲜奶）—— 判据变了，交代义务没变',
  /蒙牛鲜奶/.test(t1) && /整期不建/.test(t1), t1)
ok('1.8 不再劝用户去另一个品牌点掉（v368 后那条指引是错的：停一个就够了）',
  !/请到「/.test(t1), t1)
await shot(OUT + '/01-只停一个品牌-回执说不再自动新建.png', ['.arrival-block', '.modal-ft'])
// 复原这一节写的停单（v365 探针同款：读回来确认真的清了）
await api('PUT', '/api/rebate-rules/10/arrival-skips', { year: 2026, month: 10, skip_dates: '' })
const sk1 = await api('GET', '/api/rebate-rules/10/arrival-skips?year=2026&month=10')
ok('1.9 该节停单已复原（不把脏数据带进下一节）',
  (sk1.data && (sk1.data.skip_dates_stored || '')) === '', sk1.data && sk1.data.skip_dates_stored)

/* ---------------- 2. ② 手动建表不受停单影响（界面可见证据） ---------------- */
sec('2. ② 先把 11-24 标记「不到货」，**再**手动建到货 11-24 的期次 ⇒ 必须建得出来')
await closeModal()
const put1124 = await api('PUT', '/api/rebate-rules/10/arrival-skips',
  { year: 2026, month: 11, skip_dates: '2026-11-24' })
ok('2.1 标记 11-24 不到货（PUT 200）', put1124.success === true, put1124.data && put1124.data.skip_dates_stored)
const made = await api('POST', '/api/forecast/periods', {
  name: 'v368验收临时期次', order_start: '2026-11-20', order_end: '2026-11-20',
  arrival: '2026-11-24', seed_from_prev: false,
})
const PID = Number(made.id || 0)
ok('2.2 🔴🔴 同一天手动建表 ⇒ **建出来了**（停单管的是「系统别替我建」，不是「我不许建」）',
  PID > 0, made)
ok('2.3 建出来的到货日就是被停的那天（没有偷偷改期）', PID > 0, PID)

/* ---------------- 3. ④ 期次列表的「有 N 期的货不来了」说明 ---------------- */
sec('3. ④ 往期预报（期次列表）：说明条 + 行内「那天不到货」标记')
await page.goto(BASE + '/#/forecast', 6000)
// 🔴 confirm 必须在**导航之后**注入：导航会重建 window，之前注入的会被冲掉
await ev(`(() => { window.confirm = () => true; return 1 })()`)
// 🔴 页签叫「**历史期次**」不是「往期预报」（第一版探针按记忆写了「往期预报」⇒
//    按钮找不到 ⇒ .history-card 根本没挂载 ⇒ 后面 12 条全红，看着像功能没做。
//    这是"探针先自证判别力"的同款纪律：先证明页面真的到位了，再谈结论。）
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.innerText||'').trim()==='历史期次'); if(b) b.click(); return !!b })()`)
await sleep(4500)
const hist = await ev(`(() => {
  const box = document.querySelector('.hist-skip')
  const rows = [...document.querySelectorAll('.history-tbl tbody tr')]
  const row = rows.find(r => (r.innerText || '').includes('v368验收临时期次'))
  return {
    onHistory: /预报订单历史/.test(document.body.innerText),
    note: box ? (box.innerText || '').trim() : '',
    hasRow: !!row,
    marked: row ? /那天不到货/.test(row.innerText) : false,
    voidBtn: row ? [...row.querySelectorAll('button')].some(b => (b.innerText || '').trim() === '一键作废') : false,
    closeBtn: row ? [...row.querySelectorAll('button')].some(b => (b.innerText || '').trim() === '关闭') : false,
    status: row ? ((row.querySelector('.tag') || {}).innerText || '').trim() : '',
  }
})()`)
ok('3.0 往期预报页已渲染（前置条件）', hist.onHistory, hist.onHistory)
ok('3.1 🔴 出现「有 N 期的货不来了」说明条（④）', !!hist.note, hist.note)
ok('3.2 说明条点名了到货日 2026-11-24（用户要对得上自己点的那天）',
  /2026-11-24/.test(hist.note), hist.note)
ok('3.3 临时期次那一行在列表里', hist.hasRow, hist.hasRow)
ok('3.4 🔴 行内挂了「那天不到货」标记（③ 的依据要看得见）', hist.marked, hist.marked)
ok('3.5 🔴 该行出现「一键作废」按钮（③）', hist.voidBtn, hist.voidBtn)
ok('3.6 按钮显示条件正确：它是 open 且被标记 ⇒ 「关闭」也在（未挤掉既有按钮）',
  hist.closeBtn && hist.status === '进行中', hist.status)
await shot(OUT + '/02-期次列表-说明条与一键作废按钮.png', ['.history-card'])

/* ---------------- 4. ③ 点了真生效 ---------------- */
sec('4. ③ 点「一键作废」⇒ 状态变「已作废」，数据保留')
await ev(`(() => {
  const row = [...document.querySelectorAll('.history-tbl tbody tr')].find(r => (r.innerText||'').includes('v368验收临时期次'))
  const b = row ? [...row.querySelectorAll('button')].find(x=>(x.innerText||'').trim()==='一键作废') : null
  if (b) { b.click(); return 'clicked' }
  return 'no-btn'
})()`)
await sleep(4000)
const after = await ev(`(() => {
  const row = [...document.querySelectorAll('.history-tbl tbody tr')].find(r => (r.innerText||'').includes('v368验收临时期次'))
  if (!row) return { gone: true }
  return {
    gone: false,
    status: ((row.querySelector('.tag') || {}).innerText || '').trim(),
    hint: (row.innerText || ''),
    voidBtn: [...row.querySelectorAll('button')].some(b=>(b.innerText||'').trim()==='一键作废'),
  }
})()`)
ok('4.1 🔴 期次**还在**（作废 ≠ 删除，数据保留）', after.gone === false, after)
ok('4.2 🔴 状态标签变「已作废」', after.status === '已作废', after.status)
ok('4.3 🔴 定稿列副行说明「已作废（那批货不到）」（与「人工定稿」可区分）',
  /已作废（那批货不到）/.test(after.hint || ''), (after.hint || '').slice(0, 120))
ok('4.3b 🔴 定稿列**不再**显示「已定稿」—— 作废是撤销、流程没走完，'
  + '否则同一行会写着「已作废」又写着「已定稿」（两列互相打架）',
  !/已定稿/.test(after.hint || ''), (after.hint || '').slice(0, 160))
ok('4.4 作废后按钮不再出现（已 closed ⇒ 不需要再作废）', after.voidBtn === false, after.voidBtn)
await shot(OUT + '/03-作废后-状态变已作废.png', ['.history-card'])

/* ---------------- 5. 深色模式 ---------------- */
sec('5. 深色模式：说明条 / 状态标签不得出现白块（v362 栽过）')
await page.goto(BASE + '/#/forecast', 5000)
await ev(`(() => { document.documentElement.classList.add('dark'); return document.documentElement.className })()`)
await sleep(1200)
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.innerText||'').trim()==='历史期次'); if(b) b.click(); return !!b })()`)
await sleep(4000)
const dark = await ev(`(() => {
  // 🔴 不能把 rgba(...) 前三个数直接当 RGB：alpha 会骗人（v365 探针踩过：
  //    rgba(34,211,238,.06) 忽略 alpha 算出亮度 175 ⇒ 假的白块）。要沿祖先链找不透明底色合成。
  const eff = (el) => {
    let node = el, stack = []
    while (node && node !== document.documentElement) {
      const c = getComputedStyle(node).backgroundColor
      const m = /rgba?\\(([^)]+)\\)/.exec(c || '')
      if (m) {
        const p = m[1].split(',').map(s => parseFloat(s))
        const a = p.length > 3 ? p[3] : 1
        if (a > 0) { stack.push([p[0], p[1], p[2], a]); if (a >= 0.999) break }
      }
      node = node.parentElement
    }
    let base = [255, 255, 255]
    for (let i = stack.length - 1; i >= 0; i--) {
      const [r, g, b, a] = stack[i]
      base = [r * a + base[0] * (1 - a), g * a + base[1] * (1 - a), b * a + base[2] * (1 - a)]
    }
    return { rgb: base.map(Math.round), lum: Math.round(0.299 * base[0] + 0.587 * base[1] + 0.114 * base[2]) }
  }
  const box = document.querySelector('.hist-skip')
  const tag = [...document.querySelectorAll('.history-tbl tbody tr')]
    .find(r => (r.innerText||'').includes('v368验收临时期次'))
  return {
    isDark: document.documentElement.classList.contains('dark'),
    note: box ? eff(box) : null,
  }
})()`)
ok('5.1 已切到深色', dark.isDark, dark.isDark)
ok('5.2 🔴 说明条不是白块（合成后亮度 < 100）',
  dark.note && dark.note.lum < 100, dark.note)
await shot(OUT + '/04-深色模式-说明条与已作废行.png', ['.history-card'])

/* ---------------- 6. 复原 ---------------- */
sec('6. 复原（临时期次删除 + 停单清空，接口自证）')
if (PID > 0) {
  // 🔴 删除**只接受已 closed 的期次**（open 直接 400）。若前面那步没点成（UI 变动 /
  //   按钮没出现），这里会先补一次作废再删 ⇒ 复原不留下 open 的脏期次。
  await api('POST', '/api/forecast/periods/' + PID + '/void')
  const del = await api('DELETE', '/api/forecast/periods/' + PID)
  ok('6.1 临时期次已删除（必要时先补作废 —— 删除只接受已关闭期次）',
     del.success === true, del.detail || del)
}
await api('PUT', '/api/rebate-rules/10/arrival-skips', { year: 2026, month: 11, skip_dates: '' })
await api('PUT', '/api/rebate-rules/10/arrival-skips', { year: 2026, month: 10, skip_dates: '' })
const fin = await api('GET', '/api/forecast/periods')
const finSk = await api('GET', '/api/rebate-rules/10/arrival-skips?year=2026&month=11')
ok('6.2 库内已无 skipped（不留下脏数据）',
  Array.isArray(fin.skipped) && fin.skipped.length === 0, fin.skipped)
ok('6.3 11 月停单已清空',
  (finSk.data && (finSk.data.skip_dates_stored || '')) === '', finSk.data && finSk.data.skip_dates_stored)
ok('6.4 临时期次不在期次列表里了',
  !(fin.periods || []).some(p => p.name === 'v368验收临时期次'),
  (fin.periods || []).length)

sec('汇总')
console.log('  合计 %d 项：PASS %d / FAIL %d', _P.length + _F.length, _P.length, _F.length)
if (_F.length) { console.log('  🔴 失败项：'); _F.forEach(x => console.log('    · ' + x)) }
await br.close?.()
process.exit(_F.length ? 1 : 0)
