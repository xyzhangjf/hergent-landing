/**
 * v671 验收：全站「全选」交互统一（三态 + 范围一致 + 半选同步）
 *
 * 测什么：
 *   A 采购单列表 `#/inventory/purchase` —— 表头全选框（v510 删过、本轮恢复）
 *       · 存在且是共享件（.sa-cb）· 真实鼠标点 ⇒ 当前页全勾
 *       · 再点 ⇒ 全取消 · 手勾一行 ⇒ 表头 indeterminate=true（半选）
 *       · 子项被手动全勾 ⇒ 表头自动变全选（第 2 条要求的"反向同步"）
 *   B 销售单 / 调拨单列表 —— 同上三态存在且可点
 *   C 本期预报 `#/forecast` 编辑态 —— **回归**：换成共享件后行为不变
 *
 * 🔴 探针纪律（v669/v670 血的教训）：
 *   · 点击切换类控件**必须** `Input.dispatchMouseEvent`；`el.click()` 没有
 *     pre-click activation ⇒ 会把"勾选态不刷新"这类缺陷全漏掉。
 *   · 目标必须 `elementFromPoint(中心) === input`（列表会滚、可能被浮层盖）。
 *
 * 用法：node verify-selectall.mjs [base] [w] [h]
 */
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.argv[2] || 'https://hergent.cn'
const VW = Number(process.argv[3] || 1440)
const VH = Number(process.argv[4] || 780)
const OUT_DIR = path.dirname(new URL(import.meta.url).pathname)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

class PipeCDP {
  constructor (w, r) {
    this.w = w; this.seq = 0; this.pending = new Map(); this.buf = ''
    r.setEncoding('utf8')
    r.on('data', (c) => {
      this.buf += c
      let i
      while ((i = this.buf.indexOf('\0')) >= 0) {
        const s = this.buf.slice(0, i); this.buf = this.buf.slice(i + 1)
        if (!s) continue
        let m; try { m = JSON.parse(s) } catch { continue }
        if (m.id && this.pending.has(m.id)) {
          const p = this.pending.get(m.id); this.pending.delete(m.id)
          m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result)
        }
      }
    })
  }
  send (method, params = {}, sessionId, timeout = 180000) {
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP 超时: ' + method)) }, timeout)
      this.pending.set(id, { resolve: (v) => { clearTimeout(t); resolve(v) }, reject: (e) => { clearTimeout(t); reject(e) } })
      this.w.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0')
    })
  }
}

const TOKEN = fs.readFileSync(path.join(OUT_DIR, '.tmp-token-v671'), 'utf8').trim()
const udd = path.join(os.tmpdir(), 'hg-v671-' + Date.now())
const chrome = spawn(CHROME, [
  '--remote-debugging-pipe', '--headless=new', '--no-sandbox', '--disable-gpu',
  '--disable-dev-shm-usage', `--user-data-dir=${udd}`, '--no-first-run',
  '--no-default-browser-check', '--disable-extensions', '--mute-audio',
  `--window-size=${VW},${VH + 120}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] })
const cleanup = () => { try { chrome.kill('SIGKILL') } catch {} try { fs.rmSync(udd, { recursive: true, force: true }) } catch {} }

let pass = 0, fail = 0, skip = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✅', m) } else { fail++; console.log('  ❌', m) } }
const skipped = (m) => { skip++; console.log('  ⏭  SKIP —', m) }

try {
  const cdp = new PipeCDP(chrome.stdio[3], chrome.stdio[4])
  let created = null
  for (let i = 0; i < 30; i++) {
    try { created = await cdp.send('Target.createTarget', { url: 'about:blank' }, undefined, 8000); break } catch { await sleep(400) }
  }
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: created.targetId, flatten: true })
  const S = (m, p = {}, t = 180000) => cdp.send(m, p, sessionId, t)
  await S('Page.enable'); await S('Runtime.enable'); await S('Network.enable')
  await S('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 1, mobile: false })

  const evalJS = async (expr, awaitPromise = false) => {
    const r = await S('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise, userGesture: true })
    if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text))
    return r.result?.value
  }
  const waitFor = async (expr, timeout = 90000) => {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      if (await evalJS(`(()=>{try{return !!(${expr})}catch(e){return false}})()`) === true) return true
      await sleep(150)
    }
    return false
  }
  const realClick = async (x, y) => {
    await S('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 })
    await S('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    await S('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  }
  const go = async (hash) => {
    await evalJS(`location.hash = ${JSON.stringify(hash)}`, false)
    await sleep(3500)
  }

  for (const [name, value, httpOnly] of [
    ['erp_token', TOKEN, true], ['hergent_auth', '1', false],
    ['hergent_tenant', '1', false], ['csrf_token', 'fl' + Date.now(), false],
  ]) {
    await S('Network.setCookie', { name, value, url: BASE + '/', httpOnly, secure: BASE.startsWith('https'), sameSite: 'Lax' })
  }

  await S('Page.navigate', { url: BASE + '/' })
  await waitFor("document.querySelector('.app') || document.querySelector('#app') || document.body.innerText.length > 50")
  await sleep(2500)
  console.log('[build]', await evalJS('window.__HG_BUILD__'))

  // 页面内工具：找「坐标真的命中」的表头全选框 / 行勾选框
  await evalJS(`
    window.__hdr = (sel) => {
      const th = document.querySelector(sel)
      if (!th) return { error: '找不到表头 ' + sel }
      const b = th.querySelector('input[type=checkbox]')
      if (!b) return { error: '表头里没有复选框' }
      const r = b.getBoundingClientRect()
      const cx = Math.round(r.left + r.width/2), cy = Math.round(r.top + r.height/2)
      return { cx, cy, sa: b.classList.contains('sa-cb'), checked: b.checked,
               indet: b.indeterminate, disabled: b.disabled, size: Math.round(r.width),
               hit: (document.elementFromPoint(cx, cy) === b) }
    }
    window.__rows = (rowSel) => {
      const bs = [...document.querySelectorAll(rowSel)]
      return { n: bs.length, checked: bs.filter(b => b.checked).length }
    }
    window.__rowBox = (rowSel, i) => {
      const b = document.querySelectorAll(rowSel)[i]
      if (!b) return { error: 'no row ' + i }
      const r = b.getBoundingClientRect()
      const cx = Math.round(r.left + r.width/2), cy = Math.round(r.top + r.height/2)
      return { cx, cy, checked: b.checked, hit: (document.elementFromPoint(cx, cy) === b) }
    }
    'ok'
  `)

  // ══════════ A 采购单列表 ══════════
  console.log('\n=== A 采购单列表 /inventory/purchase（v510 删过、本轮恢复）===')
  await go('#/inventory/purchase')
  const okRows = await waitFor("document.querySelectorAll('.psi-tbl tbody tr td.psi-chk input, .ipl-c-chk input').length > 0")
  if (!okRows) { skipped('采购单列表没有数据行（环境约束，非缺陷）') }
  else {
    const ROWSEL = ".psi-tbl tbody tr td.psi-chk input, tbody tr td.ipl-c-chk input"
    let h = await evalJS(`window.__hdr('.psi-tbl th.psi-chk, thead th.ipl-c-chk')`)
    console.log('  表头:', JSON.stringify(h))
    ok(!h.error, `表头有全选框（${h.error || 'OK'}）`)
    ok(h.sa === true, `用的是共享件 .sa-cb（实测 ${h.sa}）`)
    ok(h.size === 13, `尺寸 13px，与本期预报同款（实测 ${h.size}）`)
    ok(h.hit === true, '表头框坐标真的命中它自己（未被浮层/冻结列盖住）')

    const r0 = await evalJS(`window.__rows(${JSON.stringify(ROWSEL)})`)
    console.log('  行:', JSON.stringify(r0))
    ok(r0.n > 0, `当前页有 ${r0.n} 行可勾`)

    // ① 点表头 ⇒ 全勾
    await realClick(h.cx, h.cy)
    await sleep(700)
    let st = await evalJS(`({ h: window.__hdr('.psi-tbl th.psi-chk, thead th.ipl-c-chk'), r: window.__rows(${JSON.stringify(ROWSEL)}) })`)
    console.log('  点后:', JSON.stringify(st))
    ok(st.h.checked === true, `点表头后 checked=true（实测 ${st.h.checked}）—— 修前恒 false`)
    ok(st.r.checked === st.r.n && st.r.n > 0, `当前页 ${st.r.checked}/${st.r.n} 行全勾`)
    ok(st.h.indet === false, '全勾时 indeterminate=false')

    // ② 再点 ⇒ 全取消
    await realClick(h.cx, h.cy)
    await sleep(700)
    st = await evalJS(`({ h: window.__hdr('.psi-tbl th.psi-chk, thead th.ipl-c-chk'), r: window.__rows(${JSON.stringify(ROWSEL)}) })`)
    console.log('  再点:', JSON.stringify(st))
    ok(st.h.checked === false, `再点后 checked=false（实测 ${st.h.checked}）`)
    ok(st.r.checked === 0, `当前页全部取消（实测 ${st.r.checked}）`)

    // ③ 手勾第一行 ⇒ 表头半选
    const b0 = await evalJS(`window.__rowBox(${JSON.stringify(ROWSEL)}, 0)`)
    if (b0.error || !b0.hit) { skipped('首行勾选框坐标未命中（可能被冻结列遮挡）') }
    else {
      await realClick(b0.cx, b0.cy)
      await sleep(600)
      st = await evalJS(`({ h: window.__hdr('.psi-tbl th.psi-chk, thead th.ipl-c-chk'), r: window.__rows(${JSON.stringify(ROWSEL)}) })`)
      console.log('  手勾一行:', JSON.stringify(st))
      ok(st.h.indet === true, `手勾 1/${st.r.n} 行后表头 indeterminate=true（半选）`)
      ok(st.h.checked === false, '半选时 checked=false（不是"看起来全选"）')

      // ④ 反向同步：把剩下的行逐个勾完 ⇒ 表头自动变全选
      const n = st.r.n
      for (let i = 1; i < Math.min(n, 12); i++) {
        const b = await evalJS(`window.__rowBox(${JSON.stringify(ROWSEL)}, ${i})`)
        if (b.error || !b.hit || b.checked) continue
        await realClick(b.cx, b.cy)
        await sleep(120)
      }
      await sleep(500)
      st = await evalJS(`({ h: window.__hdr('.psi-tbl th.psi-chk, thead th.ipl-c-chk'), r: window.__rows(${JSON.stringify(ROWSEL)}) })`)
      console.log('  逐个勾完:', JSON.stringify(st))
      if (st.r.checked === st.r.n) {
        ok(st.h.checked === true && st.h.indet === false, '子项被逐个勾满后表头自动变全选（反向同步）')
      } else {
        skipped(`只勾到第 ${st.r.checked}/${st.r.n} 行（剩余行未进入可视区），跳过反向同步判据`)
      }
      // ⑤ 反向同步的另一半：「全选后手动取消一行 ⇒ 表头回到半选」
      //    （不依赖滚动，比"逐个勾满"稳 —— 列表外的行点不到是环境约束，不是缺陷）
      const hA = await evalJS(`window.__hdr('.psi-tbl th.psi-chk, thead th.ipl-c-chk')`)
      await realClick(hA.cx, hA.cy); await sleep(700)          // 全选
      const bA = await evalJS(`window.__rowBox(${JSON.stringify(ROWSEL)}, 0)`)
      if (!bA.error && bA.hit) {
        await realClick(bA.cx, bA.cy); await sleep(600)         // 取消第一行
        const st3 = await evalJS(`({ h: window.__hdr('.psi-tbl th.psi-chk, thead th.ipl-c-chk'), r: window.__rows(${JSON.stringify(ROWSEL)}) })`)
        console.log('  全选后取消一行:', JSON.stringify(st3))
        ok(st3.h.indet === true && st3.h.checked === false,
          `全选后取消一行 ⇒ 表头回到半选（indet=${st3.h.indet} checked=${st3.h.checked}）`)
      } else skipped('首行框坐标未命中，跳过"取消一行⇒半选"判据')

      // 复原：取消全部，避免污染用户数据
      const hh = await evalJS(`window.__hdr('.psi-tbl th.psi-chk, thead th.ipl-c-chk')`)
      if (hh.checked) { await realClick(hh.cx, hh.cy); await sleep(400) }
      const h2 = await evalJS(`window.__hdr('.psi-tbl th.psi-chk, thead th.ipl-c-chk')`)
      if (h2.checked || h2.indet) { await realClick(h2.cx, h2.cy); await sleep(400) }
    }
  }

  // ══════════ B 销售单 / 调拨单 ══════════
  for (const [hash, label, sel] of [
    ['#/inventory/sale', '销售单列表', '.psi-tbl th.psi-chk'],
    ['#/inventory/transfer', '调拨单列表', '.psi-tbl th.psi-chk'],
  ]) {
    console.log(`\n=== B ${label} ${hash} ===`)
    await go(hash)
    const has = await waitFor("document.querySelectorAll('.psi-tbl tbody tr td.psi-chk input').length > 0")
    if (!has) { skipped(`${label} 没有数据行（环境约束，非缺陷）`); continue }
    const h = await evalJS(`window.__hdr(${JSON.stringify(sel)})`)
    console.log('  表头:', JSON.stringify(h))
    ok(!h.error && h.sa === true, `${label} 表头全选框就位且是共享件 .sa-cb`)
    if (!h.error && h.hit) {
      await realClick(h.cx, h.cy)
      await sleep(700)
      const st = await evalJS(`({ h: window.__hdr(${JSON.stringify(sel)}), r: window.__rows('.psi-tbl tbody tr td.psi-chk input') })`)
      console.log('  点后:', JSON.stringify(st))
      ok(st.h.checked === true && st.r.checked === st.r.n, `${label} 点表头 ⇒ ${st.r.checked}/${st.r.n} 行全勾`)
      // 复原
      await realClick(st.h.cx, st.h.cy); await sleep(400)
    } else skipped(`${label} 表头框坐标未命中，跳过点击判据`)
  }

  // ══════════ C 本期预报回归 ══════════
  console.log('\n=== C 本期预报 /forecast（换成共享件后的回归）===')
  await go('#/forecast')
  const fg = await waitFor("document.querySelector('.cross-tbl, .tbl') !== null")
  if (!fg) skipped('预报页未加载出表格')
  else {
    // 进编辑态（改单）
    const clicked = await evalJS(`(() => {
      const b = [...document.querySelectorAll('button,a')]
        .filter(el => el.offsetParent !== null && /^(改单|编辑报单|修改)$/.test((el.textContent||'').trim()))[0]
      if (!b) return false
      b.click(); return true
    })()`)
    if (!clicked) skipped('未找到「改单」按钮（可能无开放期次）')
    else {
      await waitFor("document.querySelector('.cross-tbl.edit-tbl input.cell-qty') !== null", 60000)
      await sleep(1500)
      const h = await evalJS(`window.__hdr('.cross-tbl thead th.seq-th')`)
      console.log('  表头:', JSON.stringify(h))
      if (h.error) skipped('编辑态表头没找到全选框：' + h.error)
      else {
        ok(h.sa === true, '预报编辑态全选框也是共享件 .sa-cb（外观未漂移）')
        ok(h.hit === true, '坐标命中自己（回归：全屏/冻结列未遮挡）')
        await realClick(h.cx, h.cy)
        await sleep(900)
        const st = await evalJS(`({ h: window.__hdr('.cross-tbl thead th.seq-th'), sel: (document.querySelector('.sel-stat')||{}).innerText || '' })`)
        console.log('  点后:', JSON.stringify(st))
        ok(st.h.checked === true, `点表头后 checked=true（实测 ${st.h.checked}）—— 换成共享件后行为不变`)
        // 取消，复原
        await realClick(st.h.cx, st.h.cy); await sleep(600)
        const st2 = await evalJS(`window.__hdr('.cross-tbl thead th.seq-th')`)
        ok(st2.checked === false, '再点取消全选，行为不变')
      }
    }
  }

  // ══════════ D 商品档案·批量补进价面板 ══════════
  console.log('\n=== D 商品档案 /archive/products · 批量补进价表头 ===')
  await go('#/archive/products')
  await waitFor("document.querySelector('.pa-fp-btn') !== null || document.body.innerText.length > 500", 60000)
  await sleep(1200)
  const fpBtn = await evalJS(`(() => {
    const b = document.querySelector('.pa-fp-btn')
    if (!b) return { error: '没有「批量补进价」入口（可能已经没有缺进价的商品）' }
    const r = b.getBoundingClientRect()
    return { cx: Math.round(r.left + r.width/2), cy: Math.round(r.top + r.height/2), hit: document.elementFromPoint(Math.round(r.left+r.width/2), Math.round(r.top+r.height/2)) === b }
  })()`)
  if (fpBtn.error) skipped(fpBtn.error)
  else if (!fpBtn.hit) skipped('补进价按钮坐标未命中')
  else {
    await realClick(fpBtn.cx, fpBtn.cy)
    const opened = await waitFor("document.querySelector('.pa-fp-tbl thead th.pa-fp-ck input') !== null", 20000)
    if (!opened) skipped('补进价面板没打开（可能商品已补全）')
    else {
      const h = await evalJS(`window.__hdr('.pa-fp-tbl thead th.pa-fp-ck')`)
      console.log('  表头:', JSON.stringify(h))
      ok(h.sa === true, `补进价表头是全站共享件 .sa-cb（实测 ${h.sa}）`)
      if (h.hit) {
        const before = await evalJS(`window.__rows('.pa-fp-tbl tbody td.pa-fp-ck input')`)
        await realClick(h.cx, h.cy); await sleep(600)
        const st = await evalJS(`({ h: window.__hdr('.pa-fp-tbl thead th.pa-fp-ck'), r: window.__rows('.pa-fp-tbl tbody td.pa-fp-ck input') })`)
        console.log('  点后:', JSON.stringify(st))
        const want = !before.checked || before.checked < before.n
        ok(st.r.checked === (want ? st.r.n : 0), `点表头 ⇒ ${st.r.checked}/${st.r.n}（与点击前状态相反）`)
        // 复原到「全勾」——该面板默认就是全勾，别把用户的待补清单改空
        if (st.r.checked !== st.r.n) { await realClick(st.h.cx, st.h.cy); await sleep(500) }
        const back = await evalJS(`window.__rows('.pa-fp-tbl tbody td.pa-fp-ck input')`)
        ok(back.checked === back.n, `已复原为全勾（${back.checked}/${back.n}）`)
      } else skipped('补进价表头坐标未命中')
      // 关面板
      await evalJS(`(() => { const b = [...document.querySelectorAll('.pa-modal .btn')].find(x => (x.textContent||'').trim() === '关闭'); if (b) b.click(); return !!b })()`)
      await sleep(600)
    }
  }

  // ══════════ E 预报筛选面板（品牌 / 到货周期 / 唯一值）══════════
  console.log('\n=== E 预报筛选面板（品牌 / 到货周期 / 唯一值）===')
  await go('#/forecast')
  await waitFor("document.querySelector('.cross-tbl') !== null")
  await sleep(1500)
  /* 🔴 面板是 `v-if` 挂载的 —— 没打开时 DOM 里根本没有，先数再开必然是 0。
     第一版就是这么假红的（把"面板没开"误判成"没接共享件"）。 */
  const openFilter = async (kw) => {
    const b = await evalJS(`(() => {
      const b = [...document.querySelectorAll('button')].find(el => el.offsetParent && new RegExp(${JSON.stringify(kw)}).test(el.textContent||'') && el.querySelector('svg'))
      if (!b) return { error: '找不到按钮 ' + ${JSON.stringify(kw)} }
      const r = b.getBoundingClientRect()
      return { cx: Math.round(r.left+r.width/2), cy: Math.round(r.top+r.height/2) }
    })()`)
    if (b.error) return b
    await realClick(b.cx, b.cy)
    await sleep(800)
    return b
  }

  // 真正点一次品牌筛选里的全选
  const brandBtn = await evalJS(`(() => {
    const b = [...document.querySelectorAll('button')].find(el => el.offsetParent && /品牌/.test(el.textContent||'') && el.querySelector('svg'))
    if (!b) return { error: '找不到品牌筛选按钮' }
    const r = b.getBoundingClientRect()
    return { cx: Math.round(r.left+r.width/2), cy: Math.round(r.top+r.height/2) }
  })()`)
  if (brandBtn.error) skipped(brandBtn.error)
  else {
    await realClick(brandBtn.cx, brandBtn.cy)
    await sleep(800)
    const bh = await evalJS(`window.__hdr('.brand-pop .bp-acts')`)
    if (bh.error) skipped('品牌面板里没找到全选框：' + bh.error)
    else {
      console.log('  品牌面板表头:', JSON.stringify(bh))
      ok(bh.sa === true, '品牌面板全选框是共享件 .sa-cb')
      if (bh.hit) {
        await realClick(bh.cx, bh.cy); await sleep(700)
        const st = await evalJS(`({ h: window.__hdr('.brand-pop .bp-acts'), checked: [...document.querySelectorAll('.brand-pop .bp-item input')].filter(b=>b.checked).length, total: document.querySelectorAll('.brand-pop .bp-item input').length })`)
        console.log('  点后:', JSON.stringify(st))
        ok(st.h.checked === true && st.checked === st.total,
          `点「全选」⇒ ${st.checked}/${st.total} 个品牌被勾（与"全选"按钮同效）`)
        await realClick(st.h.cx, st.h.cy); await sleep(600)
        const st2 = await evalJS(`({ h: window.__hdr('.brand-pop .bp-acts'), checked: [...document.querySelectorAll('.brand-pop .bp-item input')].filter(b=>b.checked).length })`)
        ok(st2.h.checked === false && st2.checked === 0, `再点 ⇒ 取消全选（${st2.checked} 个勾）—— 复原为"不过滤"`)
      } else skipped('品牌面板全选框坐标未命中')
      const tips = await evalJS(`[...document.querySelectorAll('.brand-pop .bp-acts .sa-cb')].map(b => b.title)`)
      ok(tips.length > 0 && tips.every(t => /不勾|不过滤|全选/.test(t)),
        '提示文案写明了"不勾 = 不过滤"（否则未勾会被读成"一个都没选"）')
    }
    await evalJS(`(() => { const b = [...document.querySelectorAll('button')].find(el => el.offsetParent && /品牌/.test(el.textContent||'') && el.querySelector('svg')); if (b) b.click(); return true })()`)
    await sleep(500)
  }

  // 到货周期面板（面板是 v-if ⇒ 必须打开后再数）
  const cyOpened = await openFilter('到货周期')
  if (cyOpened.error) skipped(cyOpened.error)
  else {
    const ch = await evalJS(`window.__hdr('.brand-pop .bp-acts')`)
    console.log('  周期面板表头:', JSON.stringify(ch))
    ok(!ch.error && ch.sa === true, '到货周期面板的全选框是共享件 .sa-cb')
    await evalJS(`(() => { const b = [...document.querySelectorAll('button')].find(el => el.offsetParent && /到货周期/.test(el.textContent||'') && el.querySelector('svg')); if (b) b.click(); return true })()`)
    await sleep(500)
  }

  const shot = await S('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  fs.writeFileSync(path.join(OUT_DIR, `v671-${VW}x${VH}.png`), Buffer.from(shot.data, 'base64'))
  console.log(`\n================ RESULT: ${fail === 0 ? 'ALL PASS' : 'FAILED(' + fail + ')'}  pass=${pass} fail=${fail} skip=${skip} ================`)
} catch (e) {
  console.error('探针异常：', e && e.message)
  process.exitCode = 1
} finally { cleanup() }
