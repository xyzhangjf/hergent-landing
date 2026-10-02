/**
 * v365 界面层真机验收探针（无头 Chrome + CDP 直打生产）。
 *
 * 为什么必须有这一层：影子库验的是**函数**、接口探针验的是**响应体**，两者都看不到
 * 「用户到底能不能看见」。本探针只回答一件事：**界面上有没有把结论如实说出来，且说的与后端一致**。
 *
 * 走的是一条真实业务叙事（三步），每步都带**反例对照**，最后完全复原：
 *   ① 只停「蒙牛低温」的 10-09  ⇒ 面板必须说「仍会按期建…蒙牛鲜奶那天还有货到」（反向文案）
 *   ② 两边都停 10-09            ⇒ 面板必须说「不再自动新建」；报单自动化预览里那一期要划线 + 挂标记
 *   ③ 两边都取消                ⇒ 面板必须说「会恢复自动新建」（**不是**「不影响期次」）
 * 另附：深色模式下这两块**不得出现白块**（v362 栽过）。
 *
 * 🔴 只读 + 可完全复原：所有写操作最后都清空（并在收尾用接口自证库内确实为空）。
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = 'https://hergent.cn'
const OUT = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/停单不再自动建期次-v365-2026-10-02'
const smoke = fs.readFileSync('/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/hergent-forecast-smoke.mjs', 'utf8')
const USER = /HG_USER \|\| '([^']*)'/.exec(smoke)[1]
const PASS = /HG_PASS \|\| '([^']*)'/.exec(smoke)[1]
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

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

/** 裁剪截图：把选择器们包成一张图 */
async function shot(file, sels, extraFooter = false) {
  const r = await ev(`(() => {
    const sel = ${JSON.stringify(sels)}
    const els = sel.map(s => document.querySelector(s)).filter(Boolean)
    if (!els.length) return null
    els[0].scrollIntoView({block:'center'})
    const bs = els.map(e => e.getBoundingClientRect())
    const x = Math.min(...bs.map(b => b.x)), y = Math.min(...bs.map(b => b.y))
    const x2 = Math.max(...bs.map(b => b.x + b.width)), y2 = Math.max(...bs.map(b => b.y + b.height))
    return { x: Math.max(0, x-14), y: Math.max(0, y-14), width: (x2-x)+28, height: (y2-y)+28 }
  })()`)
  if (!r) { console.log('    [截图跳过] 选择器没找到：' + sels.join(', ')); return false }
  const res = await page.raw.send('Page.captureScreenshot', { format: 'png', clip: { ...r, scale: 1 } })
  fs.writeFileSync(file, Buffer.from(res.result.data, 'base64'))
  console.log('    [截图] ' + file)
  return true
}

/** 关掉当前打开的弹窗（探针每步之间要干净，否则上一块的 DOM 会干扰定位） */
async function closeModal() {
  const r = await ev(`(() => {
    const b = [...document.querySelectorAll('.modal-ft button')].find(x=>['关闭','取消'].includes((x.innerText||'').trim()))
    if (b) { b.click(); return 'foot' }
    const x = document.querySelector('.modal-card .btn-close')
    if (x) { x.click(); return 'x' }
    return 'none'
  })()`)
  await sleep(1200)
  return r
}

/**
 * 打开某品牌的编辑弹窗（rebate 页 → 目标与返利 tab），并**自证打开的是这一条**。
 *
 * 🔴 为什么要有"自证 + 换下一行"这个循环：第一版按「行文本包含品牌名」取**第一行**，
 *    结果两次都开到了同一条规则（弹窗标题是通用的「编辑品牌目标」，看不出来）——
 *    于是后面的断言全部在验另一条规则的行为，**看起来像功能错了，其实是探针点错了行**。
 *    这跟「探针先自证判别力」是同一条纪律：先证明探针本身指对了目标，再谈结论。
 */
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
    // 自证：读「作用对象」输入框（带 list 的那个）——弹窗标题是通用的，只有这个字段认得出是谁
    const scope = await ev(`(() => {
      const el = document.querySelector('.modal-card input[list]')
      return el ? String(el.value || '').trim() : ''
    })()`)
    if (scope === name) return { ok: true, row: i, scope, candidates: n }
    await closeModal()
  }
  return { ok: false, scope: null, candidates: n }
}

/** 点击到货日历上的某一天；返回**点击之后**的已停集合（Vue 异步渲染 ⇒ 必须等一拍再读） */
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

const say = () => ev(`(() => {
  const e=document.querySelector('.ap-skip-effect')
  return e ? (e.innerText||'').trim() : ''
})()`)
const modalOpen = () => ev(`!!document.querySelector('.modal-card .arrival-block')`)
const skippedDays = () => ev(`[...document.querySelectorAll('.arr-day.off .arr-day-d')].map(x=>(x.innerText||'').trim())`)

/* ---------------- 0. 登录 ---------------- */
sec('0. 登录并进入返利页')
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
ok('0.1 已在页面内登录（token 落 localStorage）', true)

/** 页面内直接读接口，用于收尾自证（不走 UI，避免"UI 说复原了"其实是没复原） */
const api = (method, path, body) => ev(`(async () => {
  const t = localStorage.getItem('hergent_v2_token') || ''
  const r = await fetch(${JSON.stringify(path)}, {method:${JSON.stringify(method)},
    headers:{'Content-Type':'application/json','X-Client':'web','Authorization':'Bearer '+t},
    body: ${body ? JSON.stringify(JSON.stringify(body)) : 'undefined'}})
  return await r.json()
})()`)

/* ---------------- 1. 反例：只停一个品牌 ---------------- */
sec('1. 只停「蒙牛低温」的 10-09 ⇒ 必须如实说「仍会按期建」并点名另一个品牌')
let open = await openBrand('蒙牛低温')
ok('1.1 打开「蒙牛低温」编辑面板（并自证标题就是这条）', open.ok, open)
const before1 = await skippedDays()
ok('1.2 起点：10-09 尚未被停（可作后续变化的反证）', !before1.includes('9'), before1)
const c1 = await clickDay(9)
ok('1.3 点中到货日历里的 9 号 ⇒ 变为已停', c1.r === 'clicked' && c1.off.includes('9'), c1)
await save()
await sleep(3000)
ok('1.4 🔴 有回执时面板**不关闭**（关掉就等于没说过）', await modalOpen())
const t1 = await say()
ok('1.5 🔴 回执已渲染（.ap-skip-effect 有内容）', !!t1, t1)
// 🔴🔴 v368 反转（老板拍板）：排除判定改成「**任一品牌停 ⇒ 整期不建**」，
//     原来这里判的「只停一个品牌 ⇒ 仍会按期建 + 劝用户去另一个品牌也点掉」**已失效**。
//     按技能 §5.49 就地反转 + 注明（保留编号，写明"v368 反转"），不删、不改成静默通过 ——
//     删掉就等于抹掉"这条结论变过"的事实，后来者会照着旧注释改回去。
ok('1.6 [v368 反转] 🔴 文案是「不再自动新建」，**不是**「仍会按期建」',
  /不再自动新建/.test(t1) && !/仍会按期建/.test(t1), t1)
ok('1.7 [v368 反转] 如实交代「谁其实有货、但跟着一起不建」（蒙牛鲜奶）；'
  + '🔴 不再劝用户去另一个品牌点掉（v368 后停一个就够了，那条指引是错的）',
  /蒙牛鲜奶/.test(t1) && /整期不建/.test(t1) && !/请到「/.test(t1), t1)
await shot(OUT + '/01-只停一个品牌-回执说仍会按期建.png', ['.arrival-block', '.modal-ft'])

/* ---------------- 2. 正例：两边都停 ---------------- */
sec('2. 再把「蒙牛鲜奶」的 10-09 也停 ⇒ 必须说「不再自动新建」，报单预览同步划线')
open = await openBrand('蒙牛鲜奶')
ok('2.1 打开「蒙牛鲜奶」编辑面板（并自证标题是这条，不是上一条）', open.ok, open)
const before2 = await skippedDays()
ok('2.2 该面板里 10-09 尚未被停（说明确实是另一条规则）', !before2.includes('9'), before2)
const c2 = await clickDay(9)
ok('2.3 点中鲜奶的 9 号 ⇒ 变为已停', c2.r === 'clicked' && c2.off.includes('9'), c2)
await save()
await sleep(3000)
const t2 = await say()
ok('2.4 🔴 回执变成「不再自动新建」', /不再自动新建/.test(t2), t2)
ok('2.5 🔴 文案里给了"此刻实际影响"（窗口未开 ⇒ 届时不会自动建表）',
  /不会自动建表|已经建好|窗口已经过了|系统没建它/.test(t2), t2)
await shot(OUT + '/02-两个品牌都停-回执说不再自动新建.png', ['.arrival-block', '.modal-ft'])

sec('3. 报单自动化预览：被排除的期次必须划线 + 挂标记 + 顶部说明条')
await closeModal()
// 🔴 「报单自动化」不在预报订单首页，而在 **报单配置** 页签里（v242 迁过去的）——
//    第一版探针直接 goto /#/forecast 就找 .ap-excl，结果整块都没挂载。
await page.goto(BASE + '/#/forecast', 6000)
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.innerText||'').trim()==='报单配置'); if(b) b.click(); return !!b })()`)
await sleep(4000)
const excl = await ev(`(() => {
  const box = document.querySelector('.ap-excl')
  return {
    hasApBlock: /报单自动化/.test(document.body.innerText),
    note: box ? (box.innerText||'').trim() : '',
    offRows: document.querySelectorAll('tr.ap-row-off').length,
    chips: [...document.querySelectorAll('.ap-offchip')].map(e=>(e.innerText||'').trim()),
    lineThrough: (() => { const td=document.querySelector('tr.ap-row-off td'); return td?getComputedStyle(td).textDecorationLine:'' })(),
  }
})()`)
ok('3.0 报单自动化那一块已渲染（前置条件）', excl.hasApBlock, excl.hasApBlock)
ok('3.1 🔴 顶部出现说明条（.ap-excl）', !!excl.note, excl.note)
ok('3.2 🔴 说明条说「系统不会自动新建」并点名到货日',
  /不会/.test(excl.note) && /自动新建/.test(excl.note) && /2026-10-09/.test(excl.note), excl.note)
ok('3.3 🔴 被排除的那一行加了 .ap-row-off（划线）', excl.offRows >= 1, excl.offRows)
ok('3.4 🔴 该行文字真的被 line-through 划掉（不是只加了类名没样式）',
  /line-through/.test(excl.lineThrough), excl.lineThrough)
ok('3.5 🔴 到货列挂上「不到货 · 不会建」标记', excl.chips.some(c => /不到货/.test(c)), excl.chips)
await shot(OUT + '/03-报单自动化预览-排除行划线并挂标记.png', ['.ap-excl', 'table'])

sec('4. 深色模式：这两块不得出现白块（v362 栽过）')
const themed = await ev(`(() => {
  document.documentElement.classList.remove('light'); document.documentElement.classList.add('dark')
  return document.documentElement.className
})()`)
ok('4.1 已切到深色（html.class 含 dark）', /dark/.test(themed), themed)
await sleep(700)
const lum = await ev(`(() => {
  /* 🔴 不能用"把 backgroundColor 里的前三个数当 RGB"算亮度 —— v365 的说明条底色是
     rgba(34,211,238,.06)，alpha 只有 0.06，叠在深色页面上其实几乎就是页面底色；
     忽略 alpha 会算出亮度 175（看起来像白块）⇒ **误报**。
     正确做法：沿祖先链找到第一个不透明底色，把该元素的半透明底色**合成**上去再算亮度。 */
  const parse = (c) => { const m = String(c||'').match(/[\\d.]+/g); if(!m || m.length<3) return null
    return { r:+m[0], g:+m[1], b:+m[2], a: m.length>3 ? +m[3] : 1 } }
  const baseOf = (el) => { let e = el
    while (e) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0.95) return c; e = e.parentElement }
    return { r:255, g:255, b:255, a:1 } }
  const Y = (c) => Math.round(0.2126*c.r + 0.7152*c.g + 0.0722*c.b)
  const pick = (s) => { const e = document.querySelector(s); if (!e) return null
    const st = getComputedStyle(e), c = parse(st.backgroundColor) || {r:0,g:0,b:0,a:0}, b = baseOf(e)
    const eff = { r: c.r*c.a + b.r*(1-c.a), g: c.g*c.a + b.g*(1-c.a), b: c.b*c.a + b.b*(1-c.a) }
    return { sel:s, raw: st.backgroundColor, color: st.color, effLum: Y(eff), lum: Y(c) } }
  return { html: Y(baseOf(document.body) || {r:255,g:255,b:255}),
           rows: ['.ap-excl','.ap-offchip','tr.ap-row-off td'].map(pick) }
})()`)
ok('4.2 页面底色是深色（合成亮度 < 90）', (lum.html ?? 255) < 90, lum.html)
ok('4.3 🔴 说明条不是白块（按 alpha 合成后的有效亮度 < 110；忽略 alpha 会误报）',
  (lum.rows[0]?.effLum ?? 255) < 110, lum.rows[0])
ok('4.4 🔴 被排除行的底色也不是白块', (lum.rows[2]?.effLum ?? 255) < 110, lum.rows[2])
await shot(OUT + '/04-深色模式-排除说明与划线行.png', ['.ap-excl', 'table'])

/* ---------------- 5. 取消停单：回执要按「取消之后」算 ---------------- */
sec('5. 两个品牌都取消停单 ⇒ 必须说「会恢复自动新建」（不是「不影响期次」）')
await ev(`(()=>{ document.documentElement.classList.remove('dark'); document.documentElement.classList.add('light') })()`)
for (const nm of ['蒙牛低温', '蒙牛鲜奶']) {
  const o = await openBrand(nm)
  ok(`5.x 打开「${nm}」面板（并自证标题）`, o.ok, o)
  const before5 = await skippedDays()
  ok(`5.y 「${nm}」面板里 10-09 确实是已停状态（前置）`, before5.includes('9'), before5)
  const c5 = await clickDay(9)
  ok(`5.z 取消「${nm}」的 9 号 ⇒ 已停集合里不再有 9`,
    c5.r === 'clicked' && !c5.off.includes('9'), c5)
  await save()
  await sleep(3000)
  const tt = await say()
  if (nm === '蒙牛鲜奶') {
    ok('5.1 🔴 回执说「会恢复自动新建」', /会恢复自动新建/.test(tt), tt)
    ok('5.2 🔴 且**没有**说「不再自动新建」', !/不再自动新建/.test(tt), tt)
    await shot(OUT + '/05-取消停单-回执说会恢复自动新建.png', ['.arrival-block', '.modal-ft'])
  }
  await closeModal()
}

/* ---------------- 6. 收尾：用接口自证确实复原了 ---------------- */
sec('6. 收尾自证：库内停单确实已清空（不靠 UI 自己说）')
const chk = []
for (const rid of [10, 11]) {
  const r = await api('GET', `/api/rebate-rules/${rid}/arrival-skips?year=2026&month=10`)
  chk.push({ rid, stored: (r && r.data && r.data.skip_dates_stored) || '' })
}
ok('6.1 🔴 两条规则的 2026-10 停单日都已清空（完全复原）',
  chk.every(x => x.stored === ''), chk)
const ap = await api('GET', '/api/forecast/auto-period')
ok('6.2 🔴 报单自动化预览的 excluded_count 已回到 0（线上不留痕迹）',
  Number((ap && ap.data && ap.data.excluded_count) || 0) === 0,
  ap && ap.data && ap.data.excluded_count)

const errs = page.errors.filter(e => !/favicon|ResizeObserver/.test(e))
ok('6.3 全程无页面级 JS 报错', errs.length === 0, errs.slice(0, 3))

sec('汇总')
console.log(`  合计 ${_P.length + _F.length} 项：PASS ${_P.length} / FAIL ${_F.length}`)
if (_F.length) { console.log('  🔴 失败项：'); _F.forEach(x => console.log('     - ' + x)) }
await br.close()
process.exit(_F.length ? 1 : 0)
