/**
 * v277 S7 前端真机探针 —— 需求 4（加单列差额角标 + 悬停算路）/ 需求 5（加单支持负数）/ 需求 6（分配结果可见）
 *
 * 对象：隔离沙箱租户 9997（生产 tenant_1 一行不碰）。
 * 🔴 全程**不点保存**（saveEdits 无短路分支 = 真实生产写入）。只做内存动作：进改单、读角标、悬停、改一格为负数。
 *
 * 用法：HG_TOKEN=<token> [HG_TENANT=9997] node /tmp/v277e2e/fe-probe.mjs
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'

const TOKEN = process.env.HG_TOKEN || ''
const TENANT = process.env.HG_TENANT || '9997'
const OUT = process.env.HG_OUT || '/tmp/v277e2e'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const R = []
/* 🔴 必须 `return`！上一版漏了 return ⇒ `if (ok(...))` 恒假、整块断言被静默跳过，
   而摘要仍打「10/10 通过」—— 正是技能里说的「断言静默消失 = 最坏的一种绿」。 */
const ok = (name, cond, detail = '') => {
  R.push([!!cond, name, String(detail)])
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   | ' + detail : ''))
  return !!cond
}

/* 把目标元素滚到视口正中（**含横向** —— 加单列在宽表右侧，只做纵向会让点位落在视口外，
   鼠标事件打到空处、:hover 不成立，看起来像「悬停不生效」）。返回落点 + 命中测试。 */
const POINT_JS = (sel) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)})
  if (!el) return ''
  el.scrollIntoView({ block: 'center', inline: 'center' })
  const r = el.getBoundingClientRect()
  const x = Math.round(Math.min(Math.max(r.left + r.width / 2, 24), innerWidth - 24))
  const y = Math.round(Math.min(Math.max(r.top + r.height / 2, 24), innerHeight - 24))
  const hit = document.elementFromPoint(x, y)
  return JSON.stringify({ x: x, y: y, vw: innerWidth, vh: innerHeight,
    rectLeft: Math.round(r.left), rectW: Math.round(r.width),
    hitIsSelf: !!(hit && (hit === el || el.contains(hit) || (hit.closest && hit.closest('.pt-xm') === el))) })
})()`

let BROWSER = null
try {
  BROWSER = await launch()
  const p = await BROWSER.newPage()
  await p.enable()

  await p.addInitScript(
    "localStorage.setItem('hergent_v2_token', " + JSON.stringify(TOKEN) + ");" +
    "localStorage.setItem('hergent_v2_tenant', '" + TENANT + "');" +
    "localStorage.setItem('hergent_v2_user', JSON.stringify({username:'sbx',role:'boss'}));"
  )

  const url = await p.goto('https://hergent.cn/?cb=' + Date.now() + '#/forecast', 11000)
  console.log('  导航落点: ' + url)
  ok('F0 未被守卫踢回登录页', !/#\/login/.test(String(url)), String(url))
  await sleep(3500)

  // ── 1. 只读汇总表：加单列角标（需求 4 / 6）───────────────────────────────
  const ro = JSON.parse(await p.eval(`(() => {
    const badges = [...document.querySelectorAll('.pt-xm-b')]
    const tips = [...document.querySelectorAll('.pt-tip')]
    return JSON.stringify({
      badgeTexts: badges.map(b => b.textContent.trim()),
      badgeVisible: badges.filter(b => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 }).length,
      hasDone: document.querySelectorAll('.pt-xm.has-done').length,
      hasGap: document.querySelectorAll('.pt-xm.has-gap').length,
      wraps: document.querySelectorAll('.pt-xm').length,
      tips: tips.length,
      tipDisplayDefault: tips[0] ? getComputedStyle(tips[0]).display : null,
      textLen: document.body.innerText.length
    })
  })()`))
  console.log('  只读表: ' + JSON.stringify(ro))

  ok('F1 页面有实质渲染（不是白屏）', ro.textLen > 400, 'textLen=' + ro.textLen)
  ok('F2 加单列出现角标（.pt-xm-b）', ro.badgeTexts.length > 0, JSON.stringify(ro.badgeTexts))
  ok('F3 角标可见（有实际尺寸）', ro.badgeVisible > 0, 'visible=' + ro.badgeVisible + '/' + ro.badgeTexts.length)
  ok('F4 ★ 角标走「已分配」态（has-done ⇒ 读到了 extra-alloc 的真实分配结果）', ro.hasDone > 0,
     'has-done=' + ro.hasDone + ' has-gap=' + ro.hasGap)
  ok('F5 悬停说明节点已渲染（.pt-tip）', ro.tips > 0, 'tips=' + ro.tips)
  ok('F6 悬停说明默认隐藏（靠 :hover 显示，不是常显噪音）', ro.tipDisplayDefault === 'none', 'display=' + ro.tipDisplayDefault)

  // ── 2. 真实鼠标悬停 → 算路必须显现（需求 4/6 后半句）──────────────────────
  const ptRaw = await p.eval(POINT_JS('.pt-xm'))
  const pt = ptRaw ? JSON.parse(ptRaw) : null
  if (ok('F7 找到加单列悬停目标', !!pt, String(ptRaw))) {
    ok('F7b 前置：落点在视口内且命中测试通过（否则悬停是假红）',
       pt.x > 0 && pt.x < pt.vw && pt.y > 0 && pt.y < pt.vh && pt.hitIsSelf,
       'x=' + pt.x + ' y=' + pt.y + ' vw=' + pt.vw + ' hitIsSelf=' + pt.hitIsSelf + ' rectLeft=' + pt.rectLeft)
    await p.raw.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y, button: 'none', buttons: 0 })
    await sleep(900)
    const t = JSON.parse(await p.eval(`(() => {
      const el = document.querySelector('.pt-xm .pt-tip') || document.querySelector('.pt-tip')
      if (!el) return JSON.stringify({ found: false })
      return JSON.stringify({ found: true, display: getComputedStyle(el).display,
        lines: el.innerText.split('\\n').map(s => s.trim()).filter(Boolean) })
    })()`))
    ok('F8 ★ 悬停后算路浮层可见（display 不再是 none）', t.found && t.display !== 'none',
       'display=' + t.display + ' lines=' + (t.lines || []).length)
    if (t.lines && t.lines.length) {
      console.log('  —— 悬停展示的算路 ——')
      t.lines.forEach(L => console.log('     ' + L))
      ok('F9 ★ 算路含「差额合计」（需求 4 原文要求）', t.lines.some(L => L.includes('差额合计')),
         t.lines.find(L => L.includes('差额合计')) || '')
      const perOp = t.lines.filter(L => L.startsWith('·'))
      ok('F10 ★ 算路含逐人拆解（人名 + 占比 + 报量 + 差额）', perOp.length >= 1, perOp.length + ' 行')
      ok('F11 算路含月目标/已达成出处（口径可追溯）',
         t.lines.some(L => L.includes('月目标') && (L.includes('自动汇总') || L.includes('达成填报'))),
         t.lines.find(L => L.includes('月目标')) || '')
    }
  }
  await p.screenshot(OUT + '/fe-readonly-hover.png')

  // ── 3. 进改单 → 检查加单输入格（需求 5：支持负数）────────────────────────
  const ck = JSON.parse(await p.eval(`(() => {
    const btns = [...document.querySelectorAll('button')]
      .filter(b => b.offsetParent !== null || getComputedStyle(b).display !== 'none')
    const b = btns.find(x => (x.textContent || '').replace(/\\s+/g, '') === '改单')
    if (!b) return JSON.stringify({ clicked: false, candidates: btns.map(x => (x.textContent||'').trim()).filter(Boolean).slice(0, 25) })
    if (b.disabled) return JSON.stringify({ clicked: false, disabled: true, title: b.title || '' })
    b.click(); return JSON.stringify({ clicked: true })
  })()`))
  console.log('  进改单: ' + JSON.stringify(ck))
  if (ok('F12 点到了「改单」按钮（未因定稿被禁用）', ck.clicked, JSON.stringify(ck))) {
    await sleep(7000)
    const g = JSON.parse(await p.eval(`(() => {
      const tds = [...document.querySelectorAll('td.pt-xmtd')]
      const inputs = tds.map(td => td.querySelector('input.cell-qty')).filter(Boolean)
      const abs = [...document.querySelectorAll('.pt-xm-b.pt-xm-abs')]
      return JSON.stringify({
        xmtd: tds.length, inputs: inputs.length,
        firstVal: inputs[0] ? inputs[0].value : null,
        firstTitle: inputs[0] ? inputs[0].title : null,
        absBadges: abs.length, absTexts: abs.map(b => b.textContent.trim()).slice(0, 6),
        absPos: abs[0] ? getComputedStyle(abs[0]).position : null,
        cellMinus: document.querySelectorAll('.cell-input.cell-minus').length
      })
    })()`))
    console.log('  改单网格: ' + JSON.stringify(g))
    ok('F13 编辑网格出现加单列（td.pt-xmtd + 输入格）', g.xmtd > 0 && g.inputs > 0,
       'pt-xmtd=' + g.xmtd + ' inputs=' + g.inputs)
    ok('F14 加单输入框带「可填负数 = 减单」提示', String(g.firstTitle || '').includes('负数'), g.firstTitle)
    ok('F15 编辑格角标绝对定位压角（不挤动输入框、不挡点击）',
       g.absBadges > 0 && g.absPos === 'absolute', 'absBadges=' + g.absBadges + ' position=' + g.absPos)

    const neg = JSON.parse(await p.eval(`(() => {
      const inp = document.querySelector('td.pt-xmtd input.cell-qty')
      if (!inp) return JSON.stringify({ ok: false })
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      set.call(inp, '-7')
      inp.dispatchEvent(new Event('input', { bubbles: true }))
      inp.dispatchEvent(new Event('change', { bubbles: true }))
      return JSON.stringify({ ok: true, val: inp.value })
    })()`))
    ok('F16 能把加单格改成负数（前端不拦负数输入）', neg.ok && neg.val === '-7', JSON.stringify(neg))
    await sleep(700)
    const after = JSON.parse(await p.eval(`(() => {
      const inp = document.querySelector('td.pt-xmtd input.cell-qty')
      return JSON.stringify({
        val: inp ? inp.value : null,
        cellMinus: document.querySelectorAll('.cell-input.cell-minus').length,
        minusIsSelf: inp ? inp.classList.contains('cell-minus') : false,
        color: inp ? getComputedStyle(inp).color : null,
        weight: inp ? getComputedStyle(inp).fontWeight : null
      })
    })()`))
    ok('F17 ★ 负数格被标红加粗（.cell-minus 生效，肉眼可辨的减单信号）',
       after.cellMinus > 0 && after.minusIsSelf,
       'count=' + after.cellMinus + ' color=' + after.color + ' weight=' + after.weight)
    ok('F18 改值后仍是 -7（v-model 未被回写覆盖）', after.val === '-7', 'val=' + after.val)
    await p.screenshot(OUT + '/fe-editgrid-minus.png')
  }

  const errs = (p.errors || []).filter(e => !/403/.test(e))
  ok('F19 页面无 JS 报错（排除 403 权限噪音）', errs.length === 0, JSON.stringify(errs.slice(0, 4)))

  // 断言数量自证：整块断言不许静默消失（技能 §v165）
  ok('F20 断言条数自证（>=16 条，防「整块被跳过却报全绿」）', R.length >= 16, 'R.length=' + R.length)

  await BROWSER.close()
} catch (e) {
  console.log('  FATAL  ' + (e && e.message ? e.message : e))
  R.push([false, 'FATAL ' + (e && e.message ? e.message : e), ''])
  if (BROWSER) { try { await BROWSER.close() } catch {} }
}

const bad = R.filter(x => !x[0])
console.log('\n结果：' + (R.length - bad.length) + ' / ' + R.length + ' 通过')
if (bad.length) { console.log('未通过：'); bad.forEach(b => console.log('   - ' + b[1] + (b[2] ? '  | ' + b[2] : ''))) }
process.exit(bad.length ? 1 : 0)
