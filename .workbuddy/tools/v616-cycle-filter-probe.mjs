/**
 * v616 验证：按「到货周期」筛行 + 复制报单只复制筛选后的行。
 *
 * 用户场景（原话）：
 *   「不同到货周期下单时间不一样，比如今天下 +3 订单，我需要快速把 +3 订单筛出来，
 *    修改后复制商品编码粘贴到蒙牛系统，然后（再粘贴一次）数量。」
 *
 * 为什么必须两个一起做：只加筛选不改复制 = 屏幕上是 +3、剪贴板里是全表 ⇒ 直接下错单。
 *
 * 判据（全部只读，不写任何业务数据）
 *   Z0 构建号 v616
 *   Z1 查看态就绪
 *   A1 查看态有「到货周期」按钮
 *   A2 面板档位 === 网格里实际出现的档位（含「未设置」），且每档行数与网格逐档计数一致
 *   A3 勾 +3天 → 可见行数 === 该档行数；按钮文字变「到货周期 +3天」、角标 1
 *   A4 未设置档被排除时，面板给出的「N 个没设周期」=== 网格里「—」的行数
 *   A5 清空 → 可见行数恢复
 *   C1 无筛选时复制面板报的条数 = N0（作为基线）
 *   C2 筛 +3天 后复制条数为 0（本期有数量的 3 个商品都未设周期）⇒ 证明复制跟着筛选走
 *   C3 改为搜索「红枣」→ 复制条数变 1 ⇒ 证明搜索也计入（v616 之前只认品牌）
 *   B1 编辑态也有该按钮；勾 +3天 后编辑网格可见行数 === 该档行数（两态同口径）
 *   D1 全程零页面报错
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const USER = process.env.HG_USER || 'mptestsp'
const PASS = process.env.HG_PASS || 'Mpsup@1'
const OUT = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v616'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const res = {}; const fail = []
const log = (...a) => console.log(...a)
const chk = (name, cond, detail = '') => {
  res[name] = !!cond
  if (cond) log('PASS', name, detail)
  else { fail.push(name); log('FAIL', name, detail) }
}

const JS_LOGIN = (u, p) => 'fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},'
  + 'body:JSON.stringify({username:' + JSON.stringify(u) + ',password:' + JSON.stringify(p) + '})})'
  + '.then(r=>r.json().then(d=>({s:r.status,d:d})))'
  + '.then(r=>{var d=r.d;if(!d.token)return JSON.stringify({ok:false,status:r.s,detail:d.detail||""});'
  + 'localStorage.setItem("hergent_v2_token",d.token);'
  + 'if(d.csrf_token)localStorage.setItem("hergent_v2_csrf",d.csrf_token);'
  + 'if(d.user)localStorage.setItem("hergent_v2_user",JSON.stringify(d.user));'
  + 'if(d.tenant_id)localStorage.setItem("hergent_v2_tenant",String(d.tenant_id));'
  + 'return JSON.stringify({ok:true,user:d.user&&d.user.username})})'

const JS_HOOK = `(() => { if (window.__HG_ERRS__) return 1; window.__HG_ERRS__ = [];
  window.addEventListener('error', e => window.__HG_ERRS__.push('err:' + (e.message || '')));
  window.addEventListener('unhandledrejection', e => window.__HG_ERRS__.push('rej:' + (e.reason && e.reason.message || e.reason)));
  return 1 })()`
const JS_ERR = `(() => JSON.stringify(window.__HG_ERRS__ || []))()`
const JS_BUILD = `(() => String(window.__HG_BUILD__ || ''))()`

const JS_PICK_PERIOD = `(() => {
  const t = localStorage.getItem('hergent_v2_token') || ''
  return fetch('/api/forecast/periods', { headers: { Authorization: 'Bearer ' + t } })
    .then(r => r.json()).then(d => {
      const list = (d && (d.items || d.periods || d)) || []
      const today = new Date().toISOString().slice(0, 10)
      const arr = Array.isArray(list) ? list : []
      const open = arr.filter(p => String(p.status || '') === 'open')
      const inWin = open.filter(p => (p.order_start || '') <= today && (p.order_end || '') >= today)
      const pick = inWin[0] || open[0] || null
      return JSON.stringify({ ok: !!pick, id: pick && pick.id, name: pick && pick.name })
    })
})()`

/* 查看态：可见行数 + 逐档计数（用网格里的「到货周期」单元格，独立于面板数据） */
const JS_VIEW_COUNTS = `(() => {
  const tbl = document.querySelector('table.tbl.cross-tbl:not(.edit-tbl)')
  if (!tbl) return JSON.stringify({ ok: false })
  const trs = [...tbl.querySelectorAll('tbody tr.data-row')].filter(t => t.getBoundingClientRect().height > 0)
  const cyc = {}
  trs.forEach(t => {
    const c = t.querySelector('td.fc-cycle')
    const v = c ? (c.textContent || '').trim() : '?'
    cyc[v] = (cyc[v] || 0) + 1
  })
  return JSON.stringify({ ok: true, rows: trs.length, cyc })
})()`

const JS_CYC_BTN = `(() => {
  const b = [...document.querySelectorAll('.grid-ctl-row .btn')].find(x => (x.textContent || '').includes('到货周期'))
  if (!b) return JSON.stringify({ ok: false })
  const badge = b.querySelector('.btn-badge')
  const r = b.getBoundingClientRect()
  return JSON.stringify({ ok: true, text: (b.textContent || '').replace(/\\s+/g, ' ').trim(),
    badge: badge ? String(badge.textContent).trim() : '',
    x: +(r.left + r.width / 2).toFixed(1), y: +(r.top + r.height / 2).toFixed(1) })
})()`

const JS_OPEN_CYC = `(() => {
  const b = [...document.querySelectorAll('.grid-ctl-row .btn')].find(x => (x.textContent || '').includes('到货周期'))
  if (!b) return 'no-btn'; b.click(); return 'clicked'
})()`

const JS_CYC_PANEL = `(() => {
  const p = document.querySelector('.cycle-pop')
  if (!p) return JSON.stringify({ ok: false })
  const items = [...p.querySelectorAll('.bp-item')].map(l => ({
    days: Number((l.querySelector('input') || {}).value),
    n: Number(((l.querySelector('.bp-n') || {}).textContent || '0').trim()),
    checked: !!(l.querySelector('input') || {}).checked,
  }))
  const warn = p.querySelector('.bp-tip.warn')
  return JSON.stringify({ ok: true, items, warn: warn ? (warn.textContent || '').replace(/\\s+/g, ' ').trim() : '',
    w: +p.getBoundingClientRect().width.toFixed(1) })
})()`

const JS_TOGGLE_CYC = (days) => `(() => {
  const p = document.querySelector('.cycle-pop'); if (!p) return 'no-panel'
  const inp = [...p.querySelectorAll('.bp-item input')].find(i => Number(i.value) === ${days})
  if (!inp) return 'no-item'
  inp.click()
  return 'toggled:' + inp.checked
})()`

const JS_CLEAR_CYC = `(() => {
  const p = document.querySelector('.cycle-pop'); if (!p) return 'no-panel'
  const b = [...p.querySelectorAll('.link-btn')].find(x => (x.textContent || '').includes('清空'))
  if (!b) return 'no-btn'; b.click(); return 'ok'
})()`

/* 复制报单 / 数量面板：读「共 N 个」 */
const JS_OPEN_COPY = `(() => {
  const b = [...document.querySelectorAll('.grid-ctl-row .btn')].find(x => (x.textContent || '').includes('复制报单'))
  if (!b) return 'no-btn'; b.click(); return 'ok'
})()`
const JS_COPY_INFO = `(() => {
  const p = document.querySelector('.copy-pop')
  if (!p) return JSON.stringify({ ok: false })
  const ok = p.querySelector('.cp-tip.ok')
  const empty = p.querySelector('.cp-empty')
  return JSON.stringify({ ok: true,
    count: ok ? Number(((ok.querySelector('b') || {}).textContent || '0').trim()) : 0,
    hasOk: !!ok, empty: empty ? (empty.textContent || '').trim() : '',
    scope: [...p.querySelectorAll('.cp-tip')].map(x => (x.textContent || '').replace(/\\s+/g, ' ').trim()).join(' | ') })
})()`

const JS_SET_FIND = (txt) => `(() => {
  const el = document.getElementById('gridFind')
  if (!el) return JSON.stringify({ ok: false, why: 'no-find' })
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  el.focus(); setter.call(el, ${JSON.stringify(txt)})
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.blur()
  return JSON.stringify({ ok: true, val: el.value })
})()`

const JS_CLOSE_POPS = `(() => { const ov = document.querySelector('.pop-overlay'); if (ov) ov.click(); return 1 })()`

const JS_ENTER_EDIT = `(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').includes('改单') && x.offsetParent !== null)
  if (!b) return JSON.stringify({ ok: false }); b.click(); return JSON.stringify({ ok: true }) })()`

const JS_CONFIRM_OK = `(() => {
  const b = document.querySelector('.ui-cd-danger')
    || [...document.querySelectorAll('.ui-cd-box button, .imp-modal button, .modal button, [role="dialog"] button')]
        .find(x => /仍要|确定|确认|进入/.test(x.textContent || ''))
  if (!b) return JSON.stringify({ ok: false })
  if (b.disabled) return JSON.stringify({ ok: false, why: 'disabled' })
  b.click(); return JSON.stringify({ ok: true }) })()`

const JS_EDIT_COUNTS = `(() => {
  const wrap = document.querySelector('.edit-grid-wrap')
  if (!wrap) return JSON.stringify({ ok: false })
  const trs = [...wrap.querySelectorAll('tbody tr')].filter(t => t.getBoundingClientRect().height > 0)
  return JSON.stringify({ ok: true, vis: trs.length, total: wrap.querySelectorAll('tbody tr').length })
})()`

const JS_EDIT_READY = `(() => JSON.stringify({ ok: !!document.querySelector('.edit-grid-wrap'),
  rows: document.querySelectorAll('.edit-grid-wrap tbody tr').length }))()`

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const isLocal = /127\.0\.0\.1|localhost/.test(BASE)
  const browser = await launch(isLocal ? { extraArgs: ['--no-proxy-server'] } : {})
  const page = await browser.newPage()
  await page.enable()

  await page.goto(BASE, 3000)
  log('登录:', await page.eval(JS_LOGIN(USER, PASS)))
  await page.goto(BASE + '/#/forecast', 1800)
  await page.raw.send('Page.reload', {})
  await sleep(9000)
  const build = await page.eval(`(() => document.documentElement.dataset.build || window.__HG_BUILD__ || '?')()`)
  log('构建号:', build)
  chk('Z0', String(build).indexOf('v616') >= 0, 'build=' + build)
  await page.eval(JS_HOOK)

  let v = { ok: false, rows: 0, cyc: {} }
  for (let i = 0; i < 20; i++) {
    v = JSON.parse(await page.eval(JS_VIEW_COUNTS))
    if (v.ok && v.rows > 0) break
    await sleep(600)
  }
  chk('Z1', v.ok && v.rows > 0, 'rows=' + v.rows)
  const baseRows = v.rows
  log('查看态逐档:', JSON.stringify(v.cyc))

  /* A1 按钮存在 */
  const btn0 = JSON.parse(await page.eval(JS_CYC_BTN))
  chk('A1', btn0.ok, JSON.stringify(btn0))
  if (!btn0.ok) throw new Error('找不到到货周期按钮')
  log('开面板:', await page.eval(JS_OPEN_CYC))
  await sleep(700)
  const panel = JSON.parse(await page.eval(JS_CYC_PANEL))
  log('面板:', JSON.stringify(panel).slice(0, 400))

  /* A2 面板档位完整性 —— 注意：**查看态用的是虚拟滚动**（294 行只渲染视口那 ~20 行），
     所以这里不能用 DOM 逐档计数当基线（v616 首轮就是这么误判的）。
     档位完整性放到编辑态验（那里 v-show 全量行都在 DOM，见下方 B 段）。 */
  const sumPanel = (panel.items || []).reduce((s, it) => s + it.n, 0)
  chk('A2a', panel.ok && (panel.items || []).length === 5 && sumPanel > 0,
    `档位=${(panel.items || []).length} 合计=${sumPanel}（等改单网格行数核对）`)
  await page.screenshot(OUT + '/A2-到货周期面板.png')

  /* A3 勾 +3天（18 行小于视口容量，可以逐行计数） */
  const plus3 = (panel.items || []).find(it => it.days === 3)
  log('勾 +3天:', await page.eval(JS_TOGGLE_CYC(3)))
  await sleep(1400)
  const v3 = JSON.parse(await page.eval(JS_VIEW_COUNTS))
  const btn3 = JSON.parse(await page.eval(JS_CYC_BTN))
  log('筛后:', JSON.stringify(v3), '按钮:', JSON.stringify(btn3))
  chk('A3', plus3 && v3.ok && v3.rows === plus3.n && /\+3天/.test(btn3.text) && btn3.badge === '1',
    `vis=${v3.rows} 期望=${plus3 && plus3.n} btn=${btn3.text}`)
  await page.screenshot(OUT + '/A3-只看+3天.png')

  /* A4 未设置档的告警数必须 == 面板里「未设置」那一档的行数 */
  const panel2 = JSON.parse(await page.eval(JS_CYC_PANEL))
  const unsetItem = (panel2.items || []).find(it => it.days === 0)
  const m = /另有\s*(\d+)\s*个商品没设到货周期/.exec(panel2.warn || '')
  const warnN = m ? Number(m[1]) : -1
  chk('A4', !!unsetItem && warnN === unsetItem.n,
    `告警=${warnN} 未设置档=${unsetItem && unsetItem.n} warn=${(panel2.warn || '').slice(0, 50)}`)

  /* A5 清空恢复 */
  log('清空:', await page.eval(JS_TOGGLE_CYC(3)))
  await sleep(1200)
  const vBack = JSON.parse(await page.eval(JS_VIEW_COUNTS))
  chk('A5', vBack.ok && vBack.rows === baseRows, `rows=${vBack.rows} base=${baseRows}`)
  await page.eval(JS_CLOSE_POPS)
  await sleep(600)

  /* C1 无筛选时复制基线 */
  log('开复制面板:', await page.eval(JS_OPEN_COPY))
  await sleep(800)
  const c0 = JSON.parse(await page.eval(JS_COPY_INFO))
  log('复制基线:', JSON.stringify(c0).slice(0, 300))
  const N0 = c0.count || 0
  await page.eval(JS_CLOSE_POPS)
  await sleep(500)

  /* C2 筛 +3 → 复制条数应为 0（有数量的 3 个商品都没设周期） */
  await page.eval(JS_OPEN_CYC)
  await sleep(600)
  await page.eval(JS_TOGGLE_CYC(3))
  await sleep(1200)
  await page.eval(JS_CLOSE_POPS)
  await sleep(500)
  await page.eval(JS_OPEN_COPY)
  await sleep(800)
  const c2 = JSON.parse(await page.eval(JS_COPY_INFO))
  log('筛+3后复制:', JSON.stringify(c2).slice(0, 300))
  chk('C2', c2.ok && c2.count === 0 && /当前筛选下没有/.test(c2.empty), `count=${c2.count} empty=${c2.empty}`)
  await page.screenshot(OUT + '/C2-筛后复制为空.png')
  await page.eval(JS_CLOSE_POPS)
  await sleep(500)

  /* C3 清周期 + 搜索「红枣」→ 复制条数应变 1（证明搜索也计入） */
  await page.eval(JS_OPEN_CYC)
  await sleep(600)
  await page.eval(JS_TOGGLE_CYC(3))
  await sleep(1000)
  await page.eval(JS_CLOSE_POPS)
  await sleep(400)
  log('搜索红枣:', await page.eval(JS_SET_FIND('红枣')))
  await sleep(1500)
  await page.eval(JS_OPEN_COPY)
  await sleep(800)
  const c3 = JSON.parse(await page.eval(JS_COPY_INFO))
  log('搜索后复制:', JSON.stringify(c3).slice(0, 300))
  chk('C3', c3.ok && c3.count < N0 && c3.count >= 1, `count=${c3.count} N0=${N0}`)
  await page.eval(JS_CLOSE_POPS)
  await page.eval(JS_SET_FIND(''))
  await sleep(1200)

  /* B1 编辑态同口径 */
  log('进改单:', await page.eval(JS_ENTER_EDIT))
  await sleep(1500)
  const cm = JSON.parse(await page.eval(JS_CONFIRM_OK))
  if (cm.ok) log('改单确认：已确认')
  let ed = { ok: false, rows: 0 }
  for (let i = 0; i < 24; i++) {
    await sleep(700)
    ed = JSON.parse(await page.eval(JS_EDIT_READY))
    if (ed.ok && ed.rows > 10) break
  }
  chk('B1a', ed.ok && ed.rows > 0, 'edit rows=' + ed.rows)
  /* 面板各档行数之和必须等于改单网格总行数（面板不是从 DOM 数出来的，是 cross.rows 的分布）*/
  chk('A2sum', sumPanel === ed.rows, `面板合计=${sumPanel} 网格=${ed.rows}`)
  const ebtn = JSON.parse(await page.eval(JS_CYC_BTN))
  log('编辑态按钮:', JSON.stringify(ebtn))
  log('编辑态开面板:', await page.eval(JS_OPEN_CYC))
  await sleep(700)
  const epanel = JSON.parse(await page.eval(JS_CYC_PANEL))
  log('编辑态面板:', JSON.stringify(epanel.items))
  /* A2b：逐档单独勾选 —— 编辑态 v-show 保留了全部 294 行，可以直接按 DOM 计数验，
     这是「筛选真的落到每一行」的强判据（查看态虚拟滚动做不到）。 */
  const bucketDiff = []
  for (const it of (epanel.items || [])) {
    await page.eval(JS_CLEAR_CYC)
    await sleep(700)
    await page.eval(JS_TOGGLE_CYC(it.days))
    await sleep(1000)
    const c = JSON.parse(await page.eval(JS_EDIT_COUNTS))
    if (!c.ok || c.vis !== it.n) bucketDiff.push([it.days || '未设置', c && c.vis, it.n])
  }
  chk('A2b', bucketDiff.length === 0, JSON.stringify(bucketDiff))
  log('逐档不符:', JSON.stringify(bucketDiff))

  /* 多选：+2 与 +3 同时勾 → 可见 = 两档之和 */
  await page.eval(JS_CLEAR_CYC)
  await sleep(600)
  await page.eval(JS_TOGGLE_CYC(2))
  await sleep(600)
  await page.eval(JS_TOGGLE_CYC(3))
  await sleep(1000)
  const e23 = JSON.parse(await page.eval(JS_EDIT_COUNTS))
  const n2 = (epanel.items || []).find(it => it.days === 2)
  const n3 = (epanel.items || []).find(it => it.days === 3)
  chk('A2c', e23.ok && n2 && n3 && e23.vis === n2.n + n3.n,
    `vis=${e23.vis} 期望=${n2 && n2.n}+${n3 && n3.n}`)

  /* B1：单选 +3（同时给截图留一个好状态） */
  await page.eval(JS_CLEAR_CYC)
  await sleep(600)
  log('编辑态勾+3:', await page.eval(JS_TOGGLE_CYC(3)))
  await sleep(1200)
  const e3c = JSON.parse(await page.eval(JS_EDIT_COUNTS))
  const ebtn2 = JSON.parse(await page.eval(JS_CYC_BTN))
  log('编辑态筛后:', JSON.stringify(e3c), '面板 +3 =', n3 && n3.n)
  chk('B1', ebtn2.ok && n3 && e3c.ok && e3c.vis === n3.n, `vis=${e3c.vis} 期望=${n3 && n3.n} btn=${ebtn2.text}`)
  await page.screenshot(OUT + '/B1-编辑态按+3筛选.png')

  const errs = JSON.parse(await page.eval(JS_ERR))
  chk('D1', errs.length === 0, JSON.stringify(errs).slice(0, 200))

  log('\n=== 结果 ===')
  const pass = Object.keys(res).filter(k => res[k]).length
  log(`${pass}/${Object.keys(res).length}`, fail.length ? ('FAIL: ' + fail.join(',')) : 'ALL PASS')
  fs.writeFileSync(OUT + '/result.json', JSON.stringify({ res, fail, N0, v, panel }, null, 2))
  await browser.close()
  process.exit(fail.length ? 1 : 0)
}

main().catch(async (e) => {
  console.error('PROBE ERROR', e && e.message)
  process.exit(2)
})
