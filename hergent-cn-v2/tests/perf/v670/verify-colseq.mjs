/**
 * v670 验收：规范 §2.6.1 全站排查后修的两条 P0 + 一致性收尾。
 *
 *   P0-1 采购单列表 `/inventory/purchase`：**自写**列菜单（v669 只修了共享件与 Forecast，此页漏网）
 *        真实鼠标取消勾选 ⇒ `input.checked` 必须**当帧**跟着变，900ms 后也不许被浏览器翻回去。
 *   P0-2 审批中心 `/inventory/approvals`：表头列数必须等于表体列数（修前表体多一个 seq-cell ⇒ 整行右移）。
 *   P1   齿轮 `<Icon>` 尺寸一致（:size="15"）、序号格走 .seq-num。
 *
 * 🔴 探针纪律（v669 血的教训）：
 *   · 点击切换类控件**必须** `Input.dispatchMouseEvent`，`el.click()` 没有 pre-click activation ⇒ 缺陷全漏。
 *   · 列清单 `overflow:auto`，行滚出可视区后 rect 算得出但点击落到别处 ⇒ 目标必须
 *     `elementFromPoint(中心) === input`。
 *   · 首次访问会自动展开快捷键浮层 `.kbd-pop`（z 1250）⇒ 量之前先关掉。
 *
 * 用法：node verify-colseq.mjs [base] [w] [h]
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

const TOKEN = fs.readFileSync(path.join(OUT_DIR, '.tmp-token-v670'), 'utf8').trim()
const udd = path.join(os.tmpdir(), 'hg-v670-' + Date.now())
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
  const waitFor = async (expr, timeout = 120000) => {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      if (await evalJS(`(()=>{try{return !!(${expr})}catch(e){return false}})()`) === true) return true
      await sleep(120)
    }
    throw new Error('waitFor 超时: ' + expr)
  }
  const realClick = async (x, y) => {
    await S('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 })
    await S('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    await S('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  }

  for (const [name, value, httpOnly] of [
    ['erp_token', TOKEN, true], ['hergent_auth', '1', false],
    ['hergent_tenant', '1', false], ['csrf_token', 'fl' + Date.now(), false],
  ]) {
    await S('Network.setCookie', { name, value, url: BASE + '/', httpOnly, secure: BASE.startsWith('https'), sameSite: 'Lax' })
  }

  // 页面内工具：挑一个「坐标真的命中 input」的复选框
  const installHelpers = () => evalJS(`
    window.__killKbd = () => {
      const p = document.querySelector('.kbd-pop')
      if (!p) return false
      const b = p.querySelector('button') || p
      ;(b).click()
      return true
    }
    window.__pick = (wantChecked) => {
      const m = document.querySelector('.col-menu')
      if (!m) return { error: '面板没开' }
      const list = m.querySelector('.col-menu-list')
      if (list) list.scrollTop = 0
      const boxes = [...m.querySelectorAll('input[type=checkbox]')].filter(b => !b.disabled)
      for (const b of boxes) {
        if (b.checked !== wantChecked) continue
        const r = b.getBoundingClientRect()
        const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2)
        if (cx < 1 || cy < 1 || cx > innerWidth - 1 || cy > innerHeight - 1) continue
        const hit = document.elementFromPoint(cx, cy)
        if (hit !== b) continue
        const li = b.closest('li')
        return { cx, cy, label: (li && li.textContent || '').trim().slice(0, 24) }
      }
      return { error: '找不到坐标命中的复选框 wantChecked=' + wantChecked }
    }
    window.__snap = () => {
      const m = document.querySelector('.col-menu')
      if (!m) return { error: '面板没开' }
      const info = [...m.querySelectorAll('.col-menu-list li')].map(li => {
        const b = li.querySelector('input[type=checkbox]')
        return { label: (li.textContent || '').trim().slice(0, 20), checked: b ? b.checked : null, hidden: li.classList.contains('hidden') }
      })
      const tbl = document.querySelector('table.tbl')
      return { info, thCount: tbl ? tbl.querySelectorAll('thead th').length : -1 }
    }
    window.__gearSize = () => {
      const g = document.querySelector('button.col-cfg.gear svg')
      if (!g) return null
      return { w: g.getAttribute('width'), h: g.getAttribute('height') }
    }
  `)

  // ══════════ ① 采购单列表：列菜单勾选同步（P0-1）══════════
  console.log('\n=== ① 采购单列表 /inventory/purchase — 列设置勾选同步（v669 漏网的那一处）===')
  await S('Page.navigate', { url: BASE + '/#/inventory/purchase' })
  await waitFor(`!!document.querySelector('table.ipl-tbl')`, 120000)
  await sleep(2500)
  console.log('  [build]', await evalJS(`window.__HG_BUILD__`))
  await installHelpers()
  await evalJS(`window.__killKbd()`)

  const gs = await evalJS(`window.__gearSize()`)
  console.log('  齿轮 svg:', JSON.stringify(gs))
  ok(gs && gs.w === '15' && gs.h === '15', `齿轮图标 :size="15"（实测 ${gs && gs.w}×${gs && gs.h}）`)

  // 开面板（真实鼠标点齿轮）
  const gearBox = await evalJS(`(() => {
    const g = document.querySelector('button.col-cfg.gear')
    if (!g) return null
    const r = g.getBoundingClientRect()
    return { cx: Math.round(r.left + r.width/2), cy: Math.round(r.top + r.height/2) }
  })()`)
  ok(!!gearBox, '找到列设置齿轮')
  await realClick(gearBox.cx, gearBox.cy)
  await waitFor(`!!document.querySelector('.col-menu')`)
  await sleep(500)
  await evalJS(`window.__killKbd()`)
  ok(true, '面板已打开')

  // ── 方向 A：取消勾选（显示 → 隐藏）──
  const pickOn = await evalJS(`window.__pick(true)`)
  ok(!pickOn.error, '选中一个已勾选的复选框' + (pickOn.error ? `（${pickOn.error}）` : ` 「${pickOn.label}」`))
  let before = await evalJS(`window.__snap()`)
  const thBefore = before.thCount
  await realClick(pickOn.cx, pickOn.cy)
  const justAfter = await evalJS(`window.__snap()`)      // 立刻采样
  await sleep(900)                                        // v669：翻转还原发生在 patch 之后
  const later = await evalJS(`window.__snap()`)

  if (!pickOn.error) {
    const target = (arr) => (arr.info || []).find(x => pickOn.label && x.label && pickOn.label.includes(x.label.slice(0, 8)))
    const j = target(justAfter), l = target(later)
    console.log('  取消后立刻:', JSON.stringify(j), '\n  900ms 后 :', JSON.stringify(l))
    ok(!!j && j.checked === false, '点完当帧 checked 立即变 false（功能与勾选同帧一致）')
    ok(!!l && l.checked === false, '900ms 后 checked 仍为 false（未被浏览器翻回去）')
    ok(!!j && j.hidden === true, 'li.hidden=true（列确实藏了，功能生效）')
    ok(justAfter.thCount === thBefore - 1, `表头列数 ${thBefore} → ${justAfter.thCount}（−1）`)
  }

  // ── 方向 B：重新勾上（隐藏 → 显示）──
  const pickOff = await evalJS(`window.__pick(false)`)
  if (!pickOff.error) {
    ok(true, `选中一个未勾选的复选框「${pickOff.label}」`)
    const b2 = await evalJS(`window.__snap()`)
    await realClick(pickOff.cx, pickOff.cy)
    const j2 = await evalJS(`window.__snap()`)
    await sleep(900)
    const l2 = await evalJS(`window.__snap()`)
    const t2 = (arr) => (arr.info || []).find(x => pickOff.label && x.label && pickOff.label.includes(x.label.slice(0, 8)))
    const jj = t2(j2), ll = t2(l2)
    console.log('  勾上后立刻:', JSON.stringify(jj), '\n  900ms 后 :', JSON.stringify(ll))
    ok(!!jj && jj.checked === true, '重新勾上当帧 checked=true')
    ok(!!ll && ll.checked === true, '900ms 后 checked 仍为 true')
    ok(j2.thCount === b2.thCount + 1, `表头列数 ${b2.thCount} → ${j2.thCount}（+1）`)
  } else {
    skipped('未找到未勾选的复选框（' + pickOff.error + '）')
  }

  // 判别力自证：把某个 input 的 checked 用手写 JS 翻反，看下一次真实交互后是否被纠正
  const selfCheck = await evalJS(`(async () => {
    const m = document.querySelector('.col-menu')
    const b = [...m.querySelectorAll('input[type=checkbox]')].find(x => !x.disabled)
    b.checked = !b.checked                       // 人为制造 DOM 与状态不一致
    const dirty = b.checked
    b.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise(r => setTimeout(r, 300))
    return { dirty, after: b.checked, liHidden: b.closest('li').classList.contains('hidden') }
  })()`, true)
  console.log('  自证:', JSON.stringify(selfCheck))
  ok(selfCheck.after === !selfCheck.liHidden, '人为翻反后，@change 会按状态把 DOM 纠正回来（checked 与 hidden 互补）')

  const shot1 = await S('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  fs.writeFileSync(path.join(OUT_DIR, `v670-purchase-${VW}x${VH}.png`), Buffer.from(shot1.data, 'base64'))
  // 关面板
  await evalJS(`(() => { const x = document.querySelector('.col-menu-x'); if (x) x.click() })()`)
  await sleep(400)

  // ══════════ ② 审批中心：表头/表体列数（P0-2）══════════
  console.log('\n=== ② 审批中心 /inventory/approvals — 表头列数 = 表体列数 ===')
  await S('Page.navigate', { url: BASE + '/#/inventory/approvals' })
  await sleep(3500)
  const appr = await evalJS(`(() => {
    const t = document.querySelector('table.tbl')
    if (!t) return { empty: true, hasEmptyState: !!document.querySelector('.empty') }
    const th = [...t.querySelectorAll('thead th')]
    const tr = t.querySelector('tbody tr')
    if (!tr) return { empty: true, hasEmptyState: true }
    const td = [...tr.children]
    return {
      empty: false,
      thCount: th.length, tdCount: td.length,
      firstTh: th[0] ? th[0].textContent.trim() : null,
      firstThCls: th[0] ? th[0].className : null,
      firstTdCls: td[0] ? td[0].className : null,
      hasSeqNum: !!(td[0] && td[0].querySelector('.seq-num')),
      seqW: td[0] ? Math.round(td[0].getBoundingClientRect().width) : -1,
    }
  })()`)
  console.log('  ', JSON.stringify(appr))
  if (appr.empty) {
    skipped('审批中心当前无待审数据（空态），列数判据不适用 —— 已由静态契约 tests/colmenu-sync.contract.mjs 覆盖')
  } else {
    ok(appr.thCount === appr.tdCount, `表头列数 ${appr.thCount} = 表体列数 ${appr.tdCount}（修前 5≠6 整行右移）`)
    ok(appr.firstTh === '序号', `首列表头是「序号」（实测「${appr.firstTh}」）`)
    ok(/seq-th/.test(appr.firstThCls || ''), '首列表头带 .seq-th')
    ok(/seq-cell/.test(appr.firstTdCls || ''), '首列表体带 .seq-cell')
    ok(appr.hasSeqNum, '序号包在 .seq-num 里（等宽数字）')
    ok(appr.seqW >= 40 && appr.seqW <= 52, `序号列宽 ${appr.seqW}px（规范 46px，允许 ±6 取整）`)
  }
  const shot2 = await S('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  fs.writeFileSync(path.join(OUT_DIR, `v670-approvals-${VW}x${VH}.png`), Buffer.from(shot2.data, 'base64'))

  console.log(`\n================ RESULT: ${fail === 0 ? 'ALL PASS' : 'FAILED(' + fail + ')'}  pass=${pass} fail=${fail} skip=${skip} ================`)
  cleanup()
  process.exit(fail === 0 ? 0 : 1)
} catch (e) {
  console.error('探针异常:', e && e.message)
  cleanup()
  process.exit(2)
}
