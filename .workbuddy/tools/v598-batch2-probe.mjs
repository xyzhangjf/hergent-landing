/**
 * v598 真机验证：第二批「更像 Excel」四项
 *   P0 构建号 = v598
 *   P1 C1 双击列边界 = 自适应列宽（先拖窄到 ~60px，再双击 ⇒ 回到能放下内容且 ≤320）
 *   P2 C1 自适应后写入 localStorage（下次打开仍是这个宽度）
 *   P3 A4 单个值 + 已框选一片 ⇒ 粘贴铺满整个选区（Excel 语义）
 *   P4 D1 改过的格出现角标；改回原值角标消失（判据是「值不同」不是「被点过」）
 *   P5 C2 Ctrl+G 打开跳转框；输行号回车 ⇒ 选中该行
 *   P6 C2 输客户名回车 ⇒ 选中该客户列（第一个数量格）
 *   P7 零页面报错
 *   P8 回归：v597 蚂蚁线仍在（第二批不得破坏第一批）
 *   P9 回归：Ctrl+R 向右填充仍生效且页面未刷新
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const USER = process.env.HG_USER || 'mptestsp'
const PASS = process.env.HG_PASS || 'Mpsup@1'
const OUT = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v598-batch2'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const JS_LOGIN = (u, p) => 'fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},'
  + 'body:JSON.stringify({username:' + JSON.stringify(u) + ',password:' + JSON.stringify(p) + '})})'
  + '.then(r=>r.json().then(d=>({s:r.status,d:d})))'
  + '.then(r=>{var d=r.d;if(!d.token)return JSON.stringify({ok:false,status:r.s,detail:d.detail||""});'
  + 'localStorage.setItem("hergent_v2_token",d.token);'
  + 'if(d.csrf_token)localStorage.setItem("hergent_v2_csrf",d.csrf_token);'
  + 'if(d.user)localStorage.setItem("hergent_v2_user",JSON.stringify(d.user));'
  + 'if(d.tenant_id)localStorage.setItem("hergent_v2_tenant",String(d.tenant_id));'
  + 'return JSON.stringify({ok:true})})'

const JS_ENTER_EDIT = `(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').includes('改单') && x.offsetParent !== null)
  if (!b) return JSON.stringify({ ok: false })
  b.click(); return JSON.stringify({ ok: true })
})()`

const JS_CONFIRM = `(() => {
  const m = document.querySelector('.imp-modal, .modal, [role="dialog"]')
  if (!m) return JSON.stringify({ ok: false })
  const b = [...m.querySelectorAll('button')].find(x => /仍要|确定|进入|确认/.test(x.textContent || ''))
  if (!b) return JSON.stringify({ ok: false })
  b.click(); return JSON.stringify({ ok: true })
})()`

/* 商品名称列的「拖拽手柄位置 + 当前 colW + 列索引」——列宽必须读 colgroup 的 style.width：
   table 上有 zoom，用 getBoundingClientRect 量到的是缩放后的像素，与 colW 不是同一个数。 */
const JS_NAME_COL = `(() => {
  const tbl = document.querySelector('table.edit-tbl')
  if (!tbl) return JSON.stringify({ ok: false, reason: 'no table' })
  const ths = [...tbl.querySelectorAll('thead th')]
  const th = ths.find(t => { const i = t.querySelector('.th-in'); return i && (i.textContent || '').includes('商品名称') })
  if (!th) return JSON.stringify({ ok: false, reason: 'no name th', heads: ths.map(t => (t.textContent||'').trim().slice(0,8)) })
  const rz = th.querySelector('.col-resizer')
  const r = rz.getBoundingClientRect()
  const cols = tbl.querySelectorAll('colgroup col')
  const ci = th.cellIndex
  return JSON.stringify({ ok: true, ci, w: parseFloat(cols[ci].style.width),
    x: +(r.left + r.width / 2).toFixed(1), y: +(r.top + r.height / 2).toFixed(1) })
})()`

const JS_STORED_W = `(() => {
  try {
    const o = JSON.parse(localStorage.getItem('hergent-forecast-col-widths') || '{}')
    return JSON.stringify({ ok: true, name: o.name == null ? null : o.name })
  } catch (e) { return JSON.stringify({ ok: false }) }
})()`

/* 表格里第 i 个「数据行」的第 j 个数量格（只数带 qty-cell 的行）
   ⚠️ `inView`：CDP 在**视口外坐标**上派发鼠标事件是**静默无效**的（不报错、事件不落地），
      于是「点了 A 格、结果改的是旧焦点的 B 格」—— v598 第三轮就踩在这（第 9 个客户列 x≈2040
      已超出 1600 视口宽）。凡要点/拖的格，先判 inView 再用。 */
const JS_CELL = (i, j) => `(() => {
  const tbl = document.querySelector('table.edit-tbl')
  if (!tbl) return JSON.stringify({ ok: false })
  const rows = [...tbl.querySelectorAll('tbody tr')].filter(tr => tr.querySelector('td.qty-cell'))
  const tr = rows[${i}]
  if (!tr) return JSON.stringify({ ok: false, reason: 'no row', n: rows.length })
  const td = tr.querySelectorAll('td.qty-cell')[${j}]
  if (!td) return JSON.stringify({ ok: false, reason: 'no col' })
  const r = td.getBoundingClientRect()
  const inView = r.left >= 8 && r.right <= (window.innerWidth - 8) && r.top >= 8 && r.bottom <= (window.innerHeight - 8)
  return JSON.stringify({ ok: true, n: rows.length, inView,
    dr: td.getAttribute('data-r'), dc: td.getAttribute('data-c'),
    x: +(r.left + r.width / 2).toFixed(1), y: +(r.top + r.height / 2).toFixed(1) })
})()`

const JS_VAL = (r, c) => `(() => {
  const td = document.querySelector('td[data-r="${r}"][data-c="${c}"]')
  if (!td) return JSON.stringify({ ok: false })
  const inp = td.querySelector('input')
  return JSON.stringify({ ok: true, v: inp ? inp.value : (td.textContent || '').trim() })
})()`

const JS_DIRTY = (r, c) => `(() => {
  const td = document.querySelector('td[data-r="${r}"][data-c="${c}"]')
  if (!td) return JSON.stringify({ ok: false })
  const d = td.querySelector('.cell-dirty-dot')
  return JSON.stringify({ ok: true, dirty: !!d, n: document.querySelectorAll('.cell-dirty-dot').length })
})()`

const JS_SEL = `(() => {
  const td = document.querySelector('table.edit-tbl td.selected')
  if (!td) return JSON.stringify({ ok: false })
  const firstQty = document.querySelector('table.edit-tbl tbody tr td.qty-cell')
  return JSON.stringify({ ok: true, r: td.getAttribute('data-r'), c: td.getAttribute('data-c'),
    isQty: td.classList.contains('qty-cell'), firstQtyC: firstQty ? firstQty.getAttribute('data-c') : null })
})()`

const JS_JUMP_OPEN = `(() => {
  const p = document.querySelector('.jump-pop')
  if (!p) return JSON.stringify({ ok: false })
  const inp = p.querySelector('.jump-input')
  return JSON.stringify({ ok: true, focused: document.activeElement === inp,
    placeholder: inp ? inp.getAttribute('placeholder') : '',
    z: getComputedStyle(p).zIndex })
})()`

const JS_FIRST_UNIT = `(() => {
  const i = document.querySelector('table.edit-tbl thead th.qty-th input.cell-cust')
  return JSON.stringify({ ok: !!i, name: i ? i.value : '' })
})()`

const JS_ANT = `(() => {
  const m = document.querySelector('.copy-marquee')
  return JSON.stringify({ ok: !!m })
})()`

const JS_ROWVALS = (i) => `(() => {
  const tbl = document.querySelector('table.edit-tbl')
  const rows = [...tbl.querySelectorAll('tbody tr')].filter(tr => tr.querySelector('td.qty-cell'))
  const tr = rows[${i}]; if (!tr) return JSON.stringify({ ok: false })
  const vals = [...tr.querySelectorAll('td.qty-cell')].map(td => Number((td.querySelector('input') || {}).value) || 0)
  return JSON.stringify({ ok: true, vals })
})()`

let browser
const log = (...a) => console.log(...a)
const res = {}
try {
  fs.mkdirSync(OUT, { recursive: true })
  browser = await launch()
  const page = await browser.newPage()
  await page.enable()
  const moveNone = (x, y) => page.raw.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' })
  const move = (x, y) => page.raw.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left' })
  const down = (x, y, cc = 1) => page.raw.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: cc })
  const up = (x, y, cc = 1) => page.raw.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: cc })
  const click1 = async (x, y) => { await moveNone(x, y); await down(x, y); await up(x, y); await sleep(380) }
  const dblclick = async (x, y) => {
    await click1(x, y)
    await sleep(60)
    await down(x, y, 2); await up(x, y, 2)
    await sleep(700)
  }
  const key = (k, code, vk, mod = 0) => (async () => {
    await page.raw.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers: mod })
    await page.raw.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers: mod })
  })()
  const drag = async (a, b) => {
    await moveNone(a.x, a.y); await down(a.x, a.y)
    await move((a.x + b.x) / 2, (a.y + b.y) / 2); await sleep(120)
    await move(b.x, b.y); await sleep(160)
    await up(b.x, b.y); await sleep(380)
  }
  const setVal = async (cell, val) => {
    await click1(cell.x, cell.y)
    await page.raw.send('Input.insertText', { text: val })
    await sleep(180)
    await key('Tab', 'Tab', 9)
    await sleep(340)
  }
  /* 合成 paste 事件：headless 下 CDP 模拟 Cmd+V 不会触发真实 paste（浏览器安全策略），
     故直接派发 ClipboardEvent（DataTransfer 可构造）。A4 是纯逻辑分支（读 clipboardData →
     选口径 → 写入），事件来源不影响判据。 */
  const pasteText = async (text) => {
    return page.eval(`(() => {
      const tbl = document.querySelector('table.edit-tbl')
      if (!tbl) return JSON.stringify({ ok: false })
      const dt = new DataTransfer()
      dt.setData('text/plain', ${JSON.stringify(text)})
      dt.setData('text', ${JSON.stringify(text)})
      const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
      tbl.dispatchEvent(ev)
      return JSON.stringify({ ok: true })
    })()`)
  }

  await page.goto(BASE, 3500)
  log('登录:', await page.eval(JS_LOGIN(USER, PASS)))
  try {
    await page.raw.send('Browser.grantPermissions', {
      origin: BASE, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite']
    })
  } catch (e) { /* 走 execCommand 兜底 */ }

  await page.goto(BASE + '/#/forecast', 7000)
  await sleep(4000)
  const build = await page.eval(`(() => document.documentElement.dataset.build || '?')()`)
  log('构建号:', build)
  res.p0 = String(build).includes('v598')

  log('改单:', await page.eval(JS_ENTER_EDIT))
  await sleep(900)
  const cf = JSON.parse(await page.eval(JS_CONFIRM))
  if (cf.ok) await sleep(1600)
  await sleep(1200)

  /* ── P1/P2 双击列边界自适应 ─────────────────────────────────── */
  let nc = JSON.parse(await page.eval(JS_NAME_COL))
  log('P1 名称列初始:', JSON.stringify(nc))
  if (!nc.ok) { res.p1 = false; res.p2 = false } else {
    /* 先手动拖窄到 ~60px：用户默认列宽 210 往往已经"够用"，不先弄窄就测不出"自适应"发生了什么 */
    await moveNone(nc.x, nc.y); await down(nc.x, nc.y)
    await move(nc.x - 150, nc.y); await sleep(160)
    await up(nc.x - 150, nc.y); await sleep(420)
    const narrow = JSON.parse(await page.eval(JS_NAME_COL))
    log('P1 拖窄后:', JSON.stringify(narrow))
    await dblclick(narrow.x, narrow.y)
    const fit = JSON.parse(await page.eval(JS_NAME_COL))
    const stored = JSON.parse(await page.eval(JS_STORED_W))
    log('P1 双击后:', JSON.stringify(fit), '| localStorage:', JSON.stringify(stored))
    res.p1 = narrow.ok && fit.ok && narrow.w < 120 && fit.w > narrow.w + 40 && fit.w <= 320 && fit.w >= 40
    res.p2 = stored.ok && Math.abs(Number(stored.name) - fit.w) < 0.6
    await page.screenshot(OUT + '/P1-自适应列宽.png')
  }

  /* ── P3 A4 单值铺满选区 ────────────────────────────────────── */
  const a0 = JSON.parse(await page.eval(JS_CELL(0, 0)))
  const a1 = JSON.parse(await page.eval(JS_CELL(1, 1)))
  let p3 = false
  if (a0.ok && a1.ok) {
    await drag(a0, a1)
    const selN = await page.eval(`(() => document.querySelectorAll('td.range-sel').length)()`)
    await pasteText('9')
    await sleep(700)
    const v00 = JSON.parse(await page.eval(JS_VAL(a0.dr, a0.dc)))
    const v11 = JSON.parse(await page.eval(JS_VAL(a1.dr, a1.dc)))
    const v01 = JSON.parse(await page.eval(JS_VAL(a0.dr, a1.dc)))
    const v10 = JSON.parse(await page.eval(JS_VAL(a1.dr, a0.dc)))
    log('P3 选区格数:', selN, '| 四角值:', v00.v, v01.v, v10.v, v11.v)
    p3 = selN >= 4 && [v00.v, v01.v, v10.v, v11.v].every(v => v === '9')
  }
  res.p3 = p3
  await page.screenshot(OUT + '/P3-单值铺满.png')

  /* ── P4 D1 改过角标 ───────────────────────────────────────── */
  /* ⚠️ 两个前置坑（都真机踩过）：
     ① 不能挑 P3 刚填过的格 —— 它们此刻本来就脏，拿脏格断言「改前干净」必失败；
     ② 不能只挑「原本有值」的格 —— 这个期次的编辑网格里已填数量**可能是空的**
        （本轮实测：前 12 行 × 4 列连一个非零值都没有），那样会直接「找不到目标」。
     ⇒ 判据改成「任意一个**当前干净**的格」：有空值就用 Backspace 恢复空，有值就重新键入原值。 */
  let target = null
  for (let i = 0; i < 16 && !target; i++) {
    for (let j = 0; j < 4; j++) {
      const c = JSON.parse(await page.eval(JS_CELL(i, j)))
      if (!c.ok) break
      if (!c.inView) continue
      const v = JSON.parse(await page.eval(JS_VAL(c.dr, c.dc)))
      const d0 = JSON.parse(await page.eval(JS_DIRTY(c.dr, c.dc)))
      if (d0.dirty) continue
      target = { i, j, dr: c.dr, dc: c.dc, v: v.v == null ? '' : String(v.v) }; break
    }
  }
  const restoreCell = async (cell, v0) => {
    await click1(cell.x, cell.y)
    /* 诊断用：确认焦点真落在这个 input 上（上一轮 insertText 写不进去，就是缺这一层证据）。 */
    const act = await page.eval(`(() => {
      const a = document.activeElement
      return JSON.stringify({ tag: a ? a.tagName : '', cls: a ? String(a.className || '') : '',
        ss: a && a.selectionStart, se: a && a.selectionEnd, v: a ? String(a.value) : '' })
    })()`)
    log('P4 恢复前焦点:', act)
    /* 先用 Meta+A 把格内文本全选、再 Backspace 清空，最后写入原值。
       单靠「单击是否全选」不可靠（导航态与输入态的选中范围不同），显式全选才确定。 */
    await key('a', 'KeyA', 65, 4)
    await sleep(80)
    await page.raw.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
    await page.raw.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
    await sleep(120)
    if (String(v0).trim() !== '') {
      await page.raw.send('Input.insertText', { text: String(v0) })
    }
    await sleep(180)
    await key('Tab', 'Tab', 9)
    await sleep(360)
  }
  let p4 = false
  if (target) {
    /* 🔴 每次操作前**重新取坐标**：`setVal` 结尾的 Tab 会跳到下一格，若那格在视口右侧之外，
       `keepCellClear` 会把表格横向滚动 ⇒ 原来记下的 x 已经失效，再用它点击就会点到隔壁格
       （v598 第四轮的失败正是这个：恢复动作写进了别的格，被测格一直停在 99）。 */
    const refresh = async () => JSON.parse(await page.eval(JS_CELL(target.i, target.j)))
    let cur = await refresh()
    const before = JSON.parse(await page.eval(JS_DIRTY(target.dr, target.dc)))
    await setVal(cur, '99')
    const after = JSON.parse(await page.eval(JS_DIRTY(target.dr, target.dc)))
    const now = JSON.parse(await page.eval(JS_VAL(target.dr, target.dc)))
    cur = await refresh()
    await restoreCell(cur, target.v)
    const back = JSON.parse(await page.eval(JS_DIRTY(target.dr, target.dc)))
    const backV = JSON.parse(await page.eval(JS_VAL(target.dr, target.dc)))
    log('P4 格:', target.dr + '/' + target.dc, '| 原值:', JSON.stringify(target.v),
      '| 改前角标:', before.dirty, '| 改 99 后:', after.dirty, '| 实际值:', now.v,
      '| 恢复后值:', JSON.stringify(backV.v), '| 恢复后角标:', back.dirty, '| 全表角标数:', back.n)
    p4 = before.dirty === false && after.dirty === true && now.v === '99' && back.dirty === false
  } else log('P4 找不到任何干净的数量格')
  res.p4 = p4
  await page.screenshot(OUT + '/P4-改过角标.png')

  /* ── P5 C2 Ctrl+G 跳行号 ─────────────────────────────────── */
  await click1(a0.x, a0.y)
  await key('g', 'KeyG', 71, 4)          // Meta+G
  await sleep(450)
  const jp = JSON.parse(await page.eval(JS_JUMP_OPEN))
  log('P5 跳转框:', JSON.stringify(jp))
  let p5 = false
  if (jp.ok) {
    await page.raw.send('Input.insertText', { text: '5' })
    await sleep(220)
    await key('Enter', 'Enter', 13)
    await sleep(700)
    const sel = JSON.parse(await page.eval(JS_SEL))
    log('P5 回车后选中:', JSON.stringify(sel))
    p5 = jp.focused === true && sel.ok && sel.r === '4'
  }
  res.p5 = p5
  await page.screenshot(OUT + '/P5-跳转行号.png')

  /* ── P6 C2 跳客户名 ──────────────────────────────────────── */
  const u0 = JSON.parse(await page.eval(JS_FIRST_UNIT))
  let p6 = false
  if (u0.ok && u0.name) {
    await click1(a0.x, a0.y)
    await key('g', 'KeyG', 71, 4)
    await sleep(420)
    await page.raw.send('Input.insertText', { text: u0.name })
    await sleep(220)
    await key('Enter', 'Enter', 13)
    await sleep(700)
    const sel = JSON.parse(await page.eval(JS_SEL))
    log('P6 客户名:', u0.name, '| 选中:', JSON.stringify(sel))
    p6 = sel.ok && sel.isQty === true && sel.c === sel.firstQtyC
  } else log('P6 没找到客户列')
  res.p6 = p6
  await page.screenshot(OUT + '/P6-跳转客户列.png')

  /* ── P8 回归：蚂蚁线 ─────────────────────────────────────── */
  await click1(a0.x, a0.y)
  await key('c', 'KeyC', 67, 4)
  await sleep(600)
  const ant = JSON.parse(await page.eval(JS_ANT))
  log('P8 蚂蚁线:', JSON.stringify(ant))
  res.p8 = ant.ok === true
  await key('Escape', 'Escape', 27); await sleep(300)

  /* ── P9 回归：Ctrl+R 向右填充 ────────────────────────────── */
  /* ⚠️ 终点只取第 3 个数量列（不是第 4）：P1 已把「商品名称」撑到 320px，右侧整排客户列
     跟着右移 110px ⇒ 第 4 列可能**落在视口右界之外**，此时 elementFromPoint 返回 null、
     填充框不再生长（表现是「只填了 3 格」）—— 那是探针自己造成的，不是产品缺陷。
     这一条是**回归检查**，只要能证明「横向填充仍生效」即可，列数取几不影响判据。 */
  const r5 = JSON.parse(await page.eval(JS_CELL(6, 0)))
  let p9 = false
  if (r5.ok) {
    await setVal(r5, '66')
    await page.eval(`(() => { window.__probe_mark = 1; return 1 })()`)
    await click1(r5.x, r5.y)
    const r5b = JSON.parse(await page.eval(JS_CELL(6, 2)))
    const vw = await page.eval(`(() => window.innerWidth)()`)
    log('P9 拖拽:', JSON.stringify({ ax: r5.x, bx: r5b.x, vw }))
    await drag(r5, r5b)
    await page.raw.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'r', code: 'KeyR', windowsVirtualKeyCode: 82, modifiers: 4 })
    await page.raw.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'r', code: 'KeyR', windowsVirtualKeyCode: 82, modifiers: 4 })
    await sleep(650)
    const notReloaded = await page.eval(`(() => window.__probe_mark === 1)()`)
    const rowv = JSON.parse(await page.eval(JS_ROWVALS(6)))
    log('P9 未刷新:', notReloaded, '| 行内前 5 格:', JSON.stringify(rowv.vals.slice(0, 5)))
    p9 = notReloaded === true && rowv.vals.slice(0, 3).every(v => v === 66)
  }
  res.p9 = p9

  res.p7 = (page.errors || []).length === 0
  log('P7 页面报错:', JSON.stringify(page.errors || []))

  for (const k of ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9']) log(k.toUpperCase(), res[k] ? 'PASS' : 'FAIL')
  const all = Object.values(res).every(Boolean)
  log(all ? '\n=== 全部 PASS ===' : '\n=== 存在 FAIL ===')
  process.exit(all ? 0 : 1)
} catch (e) {
  console.error('探针异常:', e && e.stack || e)
  process.exit(2)
} finally {
  if (browser) { try { await browser.close() } catch { /* ignore */ } }
}
