/* v364 界面层真机验收探针 —— 生产真实包 + 真实后端
   断言「本月到货」新面板：系统推算 / 实到 / 均单 / 可点停单 / 只对本月有效 / 停单不改节奏。
   🔴 全程**不点保存** —— 只点日历上的日期（纯前端状态），关弹窗后零落库。 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = 'https://hergent.cn'
const OUT = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/到货按月停单-v364-2026-10-02'
fs.mkdirSync(OUT, { recursive: true })
const smoke = fs.readFileSync('/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/hergent-forecast-smoke.mjs', 'utf8')
const USER = /HG_USER \|\| '([^']*)'/.exec(smoke)[1]
const PASS = /HG_PASS \|\| '([^']*)'/.exec(smoke)[1]

const P = [], F = []
const ok = (n, c, d = '') => { (c ? P : F).push(n); console.log((c ? '  PASS  ' : '  🔴FAIL ') + n + (d ? ' | ' + d : '')) }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const br = await launch({})
const page = await br.newPage()
await page.enable()

async function ev(expr, awaitPromise) {
  return await page.eval(expr, awaitPromise)
}

/* 截图：先把证据区滚进视野，再**只裁这一段**（union 后加 14px 内边距），
   免得截成"弹窗顶部 + 一片表单"，看图的人找不到本次要验的东西。 */
async function shot(file, sels) {
  const r = await ev(`(() => {
    const sels = ${JSON.stringify(sels)}
    const els = sels.map(s => document.querySelector(s)).filter(Boolean)
    if (!els.length) return null
    els[0].scrollIntoView({ block: 'center' })
    const bs = els.map(e => e.getBoundingClientRect())
    const x = Math.min(...bs.map(b => b.x)), y = Math.min(...bs.map(b => b.y))
    const x2 = Math.max(...bs.map(b => b.x + b.width)), y2 = Math.max(...bs.map(b => b.y + b.height))
    return { x: Math.max(0, x - 14), y: Math.max(0, y - 14), width: (x2 - x) + 28, height: (y2 - y) + 28 }
  })()`)
  if (r && r.width > 10 && r.height > 10) {
    const res = await page.raw.send('Page.captureScreenshot',
      { format: 'png', clip: { x: r.x, y: r.y, width: r.width, height: r.height, scale: 1 } })
    if (res && res.result && res.result.data) {
      fs.writeFileSync(file, Buffer.from(res.result.data, 'base64'))
      console.log('  [截图] ' + file)
      return
    }
  }
  await page.screenshot(file)
  console.log('  [截图-整页] ' + file)
}

/* ---- 登录 ---- */
await page.goto(BASE + '/')
await sleep(3500)
const login = await ev(`(async () => {
  const r = await fetch('/api/auth/login', {method:'POST',
    headers:{'Content-Type':'application/json','X-Client':'web'},
    body: JSON.stringify({username:${JSON.stringify(USER)},password:${JSON.stringify(PASS)}})})
  const d = await r.json()
  if (!r.ok) return {ok:false, status:r.status}
  localStorage.setItem('hergent_v2_token', d.access_token || d.token || '')
  localStorage.setItem('hergent_v2_tenant', String(d.tenant_id || ''))
  localStorage.setItem('hergent_v2_user', JSON.stringify(d.user || {}))
  return {ok:true}
})()`, true)
ok('A0 登录成功', login && login.ok === true, JSON.stringify(login))

await page.goto(BASE + '/#/rebate')
await sleep(6000)
ok('A1 页面无「页面出错了」', !(await ev(`document.body.innerText.includes('页面出错了')`)))

/* ---- 切到「目标与返利」页签 ---- */
const tabbed = await ev(`(() => {
  const b = [...document.querySelectorAll('button.main-tab')].find(x => (x.innerText||'').trim() === '目标与返利')
  if (!b) return false
  b.click(); return true
})()`)
await sleep(2500)
ok('A2 切到「目标与返利」页签', tabbed === true)

/* ---- 打开蒙牛鲜奶那条规则的编辑弹窗 ---- */
const opened = await ev(`(() => {
  const trs = [...document.querySelectorAll('tr')]
  const tr = trs.find(t => (t.innerText||'').includes('蒙牛鲜奶'))
  if (!tr) return {ok:false, why:'没找到蒙牛鲜奶行', sample: trs.slice(0,6).map(t=>(t.innerText||'').replace(/\\s+/g,' ').slice(0,60))}
  const b = [...tr.querySelectorAll('button')].find(x => (x.innerText||'').trim() === '编辑')
  if (!b) return {ok:false, why:'该行没有「编辑」按钮', btns:[...tr.querySelectorAll('button')].map(x=>(x.innerText||'').trim())}
  b.click(); return {ok:true}
})()`)
await sleep(3000)
ok('A3 打开「蒙牛鲜奶」规则编辑弹窗', opened && opened.ok === true, JSON.stringify(opened))
ok('A4 弹窗已出现', await ev(`!!document.querySelector('.modal-card')`))

/* ---- 读 ② 本月到货面板 ---- */
const panel = await ev(`(() => {
  const stat = [...document.querySelectorAll('.arr-stat-i')].map(e => (e.innerText||'').replace(/\\s+/g,' ').trim())
  const days = [...document.querySelectorAll('.arr-day')].map(e => ({
    d: (e.querySelector('.arr-day-d')||{}).innerText, w: (e.querySelector('.arr-day-w')||{}).innerText,
    off: e.classList.contains('off') }))
  const note = [...document.querySelectorAll('.ap-skip-note')].map(e=>e.innerText.replace(/\\s+/g,' ').trim())
  const warn = [...document.querySelectorAll('.ap-warn')].map(e=>e.innerText.replace(/\\s+/g,' ').trim())
  return { stat, dayCount: days.length, days, note, warn,
           section: [...document.querySelectorAll('.ap-sec')].map(e=>e.innerText.replace(/\\s+/g,' ').trim()) }
})()`)
console.log('面板读数:', JSON.stringify(panel, null, 1).slice(0, 2200))

ok('A5 ② 区标题写明「次数由到货日数出来，两处永远一致」',
  (panel.section || []).some(s => s.includes('本月到货') && s.includes('两处永远一致')),
  JSON.stringify(panel.section))
ok('A6 三个数字卡：系统推算 / 实到 / 均单',
  panel.stat.length === 3 && panel.stat[0].includes('系统推算') && panel.stat[1].includes('实到')
  && panel.stat[2].includes('均单'), JSON.stringify(panel.stat))
ok('A7 系统推算 = 16 次', /16/.test(panel.stat[0] || ''), panel.stat[0])
ok('A8 2026-10 实到 = 16 次（未停单时与系统推算一致）', /16/.test(panel.stat[1] || ''), panel.stat[1])
ok('A9 均单带中文单位「万元/次」（无英文缩写）',
  /万[元箱]\/次/.test(panel.stat[2] || ''), panel.stat[2])
ok('A10 到货日 chips 共 16 个（= 次数；日历与次数同源）',
  panel.dayCount === 16, panel.dayCount)
ok('A11 chips 里含 5 号、7 号（10-05 / 10-07）',
  panel.days.some(d => d.d === '5') && panel.days.some(d => d.d === '7'),
  JSON.stringify(panel.days.slice(0,4)))
ok('A12 说明写明「到货节奏不会因此改变」（用户原话的落点）',
  panel.note.some(n => n.includes('不会因此改变') || n.includes('不停') || n.includes('不会因为')),
  JSON.stringify(panel.note).slice(0,240))
ok('A13 说明写明改动**只对本月有效**、下月起自动回到系统推算',
  panel.note.some(n => n.includes('只对 2026-10 有效') && n.includes('2026-11') && n.includes('自动回到系统推算')),
  JSON.stringify(panel.note).slice(0,300))
await shot(OUT + '/01-本月到货面板-停单前.png', ['.arr-stat','.arr-days','.ap-skip-note'])

/* ---- 点 5 号 = 停这一单 ---- */
const clicked = await ev(`(() => {
  const b = [...document.querySelectorAll('.arr-day')].find(x => ((x.querySelector('.arr-day-d')||{}).innerText||'').trim() === '5')
  if (!b) return false
  b.click(); return true
})()`)
await sleep(2200)
const after = await ev(`(() => {
  const stat = [...document.querySelectorAll('.arr-stat-i')].map(e => (e.innerText||'').replace(/\\s+/g,' ').trim())
  const days = [...document.querySelectorAll('.arr-day')].map(e => ({
    d: (e.querySelector('.arr-day-d')||{}).innerText, off: e.classList.contains('off') }))
  return { stat, days, reset: !![...document.querySelectorAll('.ap-adopt')].find(x=>(x.innerText||'').includes('恢复系统推算')) }
})()`)
console.log('停单后:', JSON.stringify(after, null, 1).slice(0, 1500))
ok('A14 点一下 5 号 = 停这一单（chip 变 off）',
  clicked === true && (after.days.find(d => d.d === '5') || {}).off === true, JSON.stringify(after.days.slice(0,4)))
ok('A15 🔴 实到 16 → 15（停一单就少一次，用户诉求 2）', /15/.test(after.stat[1] || ''), after.stat[1])
ok('A16 🔴 不改节奏：7 号 chip 仍在、且**没被停掉**',
  (after.days.find(d => d.d === '7') || {}).off === false, JSON.stringify(after.days.filter(d=>['5','7'].includes(d.d))))
ok('A17 出现「恢复系统推算」入口（改动可一键撤销）', after.reset === true)
await shot(OUT + '/02-点停10-05-实到16变15.png', ['.arr-stat','.arr-days','.ap-skip-note'])

/* ---- 再点一下 = 恢复 ---- */
await ev(`(() => {
  const b = [...document.querySelectorAll('.arr-day')].find(x => ((x.querySelector('.arr-day-d')||{}).innerText||'').trim() === '5')
  if (b) b.click()
})()`)
await sleep(2200)
const back = await ev(`(() => {
  const stat = [...document.querySelectorAll('.arr-stat-i')].map(e => (e.innerText||'').replace(/\\s+/g,' ').trim())
  return { stat, offCount: document.querySelectorAll('.arr-day.off').length }
})()`)
ok('A18 再点一下恢复：实到回到 16、无停单',
  /16/.test(back.stat[1] || '') && back.offCount === 0, JSON.stringify(back))

/* ---- 打开蒙牛低温：真实生产数据上的「次数 vs 日历」不一致告警 ---- */
await ev(`document.querySelector('.btn-close').click()`)
await sleep(1200)
const opened2 = await ev(`(() => {
  const tr = [...document.querySelectorAll('tr')].find(t => (t.innerText||'').includes('蒙牛低温2026年目标'))
  if (!tr) return false
  const b = [...tr.querySelectorAll('button')].find(x => (x.innerText||'').trim() === '编辑')
  if (!b) return false
  b.click(); return true
})()`)
await sleep(3000)
const low = await ev(`(() => {
  const stat = [...document.querySelectorAll('.arr-stat-i')].map(e => (e.innerText||'').replace(/\\s+/g,' ').trim())
  const warn = [...document.querySelectorAll('.ap-warn')].map(e=>e.innerText.replace(/\\s+/g,' ').trim())
  const adopt = [...document.querySelectorAll('.ap-adopt')].map(e=>(e.innerText||'').trim())
  return { stat, warn, adopt }
})()`)
console.log('蒙牛低温面板:', JSON.stringify(low, null, 1).slice(0, 1600))
ok('A19 打开蒙牛低温弹窗', opened2 === true)
ok('A20 🔴 迁移来的「15 次」与日历 16 天对不上 ⇒ 界面**当面说出来**（不静默）',
  (low.warn || []).some(w => w.includes('对不上')), JSON.stringify(low.warn).slice(0,300))
ok('A21 提供「按日历对齐」一键收敛', (low.adopt || []).some(a => a.includes('按日历对齐')), JSON.stringify(low.adopt))
await shot(OUT + '/03-蒙牛低温-次数与日历不一致告警.png', ['.arr-stat','.arr-days','.ap-warn'])

/* ---- 关弹窗，不保存 ---- */
await ev(`document.querySelector('.btn-close').click()`)
await sleep(1500)
ok('A22 全程无 console 错误 / 未捕获异常', page.errors.length === 0, JSON.stringify(page.errors.slice(0,3)))
ok('A23 弹窗已关闭', !(await ev(`!!document.querySelector('.modal-card')`)))

/* ---- 复查：零落库（走接口读回） ---- */
for (const [rid, name] of [[11, '蒙牛鲜奶'], [10, '蒙牛低温']]) {
  const s = await ev(`(async () => {
    const t = localStorage.getItem('hergent_v2_token')
    const r = await fetch('/api/rebate-rules/${rid}/arrival-skips?year=2026&month=10',
      {headers:{'Authorization':'Bearer '+t,'X-Client':'web'}})
    const d = await r.json()
    return {sd:(d.data||{}).skip_dates_stored, co:(d.data||{}).count_override, c:(d.data||{}).count}
  })()`, true)
  ok('A24.' + rid + ' ' + name + '：停单日仍为空 ⇒ 本次探针**零落库**',
    s && s.sd === '', JSON.stringify(s))
}

console.log('\n合计 ' + (P.length + F.length) + ' 项：PASS ' + P.length + ' / FAIL ' + F.length)
if (F.length) { console.log('🔴 失败项：'); F.forEach(f => console.log('   - ' + f)) }
await br.close()
process.exit(F.length ? 1 : 0)
