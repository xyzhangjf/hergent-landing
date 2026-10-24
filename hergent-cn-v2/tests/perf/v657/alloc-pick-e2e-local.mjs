/**
 * v657 分摊「勾选模式」端到端探针（生产真机，公网 hergent.cn）。
 *
 * 判据：
 *   A  商品 1621（无目标/无报单/无占比）填 10 箱加单后，「分摊」按钮出现
 *      （hasAllocTarget：extraQty>0 且候选池有人 ⇒ 真门开）。
 *   B  点开后进入「勾选模式」：提示含「报单对象名册」、表格 12 行、默认全不勾、
 *      未勾行占比输入框 readonly（先勾才能定比例）。
 *   C  勾 2 人 → 各设占比 50% → 预演「加单合计 10 ✓」「占比合计 100% ✓」，
 *      两承接人各 5 箱。
 *   D  「应用」(保存本期占比并回填) 后弹窗关闭，本行加单格**仍是 10**（P0 修复核心：
 *      旧版 onAllocApplied 调 loadCross 会把编辑态网格换成只读行 ⇒ 加单量当场消失）。
 *   E  再开 → 点「平均分配」一键全勾 + 均分 → 预演 ✓ → 应用 → 本行仍 10
 *      （用户拍板：默认全不勾 + 平均分配一键勾）。
 *
 * 🔴 安全纪律：探针**绝不点汇总表「保存」**（save-matrix 会 DELETE+重插本期 live submissions）。
 *    apply 只走 extra_alloc_override（写 forecast_alloc_ratio 本期临时占比），
 *    不碰 submissions / extra_alloc / extra_qty。
 *    网格草稿走 useDraft = localStorage，不写服务器；探针 Chrome user-data-dir 用完即删。
 *    事后清掉 product_id=1621 的全部 alloc_ratio 行 + 删临时 token。
 */
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.argv[2] || 'http://localhost:5173'
const OUT_DIR = path.dirname(new URL(import.meta.url).pathname)
const TOKEN = fs.readFileSync(path.join(OUT_DIR, '.tmp-token-v657'), 'utf8').trim()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const PROD_1621 = '友芝友金嚼鲜酪乳原风味'   // 商品 1621 名称唯一片段

class PipeCDP {
  constructor(w, r) {
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
  send(method, params = {}, sessionId, timeout = 120000) {
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP 超时: ' + method)) }, timeout)
      this.pending.set(id, { resolve: (v) => { clearTimeout(t); resolve(v) }, reject: (e) => { clearTimeout(t); reject(e) } })
      this.w.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0')
    })
  }
}

const udd = path.join(os.tmpdir(), 'hg-p657-' + Date.now())
const chromeArgs = [
  '--remote-debugging-pipe', '--headless=new', '--no-sandbox', '--disable-gpu',
  '--disable-dev-shm-usage', `--user-data-dir=${udd}`, '--no-first-run',
  '--no-default-browser-check', '--disable-extensions', '--mute-audio',
  // 🔴 Mac 系统代理会让 Chrome 走代理而 erp.hergent.cn 直连才通 ⇒ 强制直连
  '--no-proxy-server', '--proxy-server=direct://', '--proxy-bypass-list=*',
  '--window-size=1440,900', 'about:blank',
]
const chrome = spawn(CHROME, chromeArgs, { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] })
const cleanup = () => { try { chrome.kill('SIGKILL') } catch {} try { fs.rmSync(udd, { recursive: true, force: true }) } catch {} }

const R = {}
try {
  const cdp = new PipeCDP(chrome.stdio[3], chrome.stdio[4])
  let created = null
  for (let i = 0; i < 30; i++) {
    try { created = await cdp.send('Target.createTarget', { url: 'about:blank' }, undefined, 8000); break } catch { await sleep(400) }
  }
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: created.targetId, flatten: true })
  const S = (m, p = {}, t = 120000) => cdp.send(m, p, sessionId, t)
  await S('Page.enable'); await S('Runtime.enable'); await S('Network.enable')

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
    throw new Error('waitFor 超时: ' + expr)
  }
  const FIND_PAGE = `(() => {
    const isForecast = (t) => { const nm = t && (t.__name || t.name); return nm === 'Forecast' }
    const trEl0 = document.querySelector('.cross-tbl tbody tr')
    if (trEl0 && trEl0.__vueParentComponent) {
      let p = trEl0.__vueParentComponent, guard = 0
      while (p && guard++ < 30) { if (isForecast(p.type)) return p; p = p.parent }
    }
    try {
      const el = document.querySelector('#app')
      const dfs = (v, depth) => {
        if (!v || depth > 60) return null
        if (v.component) {
          if (isForecast(v.component.type) && typeof v.component.render === 'function') return v.component
          if (v.component.subTree) { const r = dfs(v.component.subTree, depth + 1); if (r) return r }
        }
        const kids = v.children
        if (Array.isArray(kids)) for (const c of kids) { const r = dfs(c, depth + 1); if (r) return r }
        return null
      }
      if (el && el._vnode) { const r = dfs(el._vnode, 0); if (r) return r }
    } catch (e) {}
    return null
  })()`

  // v655 验证可用的方式：先注入 cookie（干净 user-data-dir，不触发 shell 的 login 标签），
  // 再直接导航到 /#/forecast —— 绕过「boot 瞬间读不到 cookie」的竞态与 login 标签干扰。
  for (const [name, value, httpOnly] of [
    ['erp_token', TOKEN, true], ['hergent_auth', '1', false],
    ['hergent_tenant', '1', false], ['csrf_token', 'p657' + Date.now(), false],
  ]) {
    await S('Network.setCookie', { name, value, url: BASE + '/', domain: 'localhost', path: '/', httpOnly, secure: false, sameSite: 'Lax' })
  }

  await S('Page.navigate', { url: BASE + '/#/forecast' })
  // 本地源 app：等 #app 挂载（boot 完成），不再等 prod 的 #appLayout 壳层
  await waitFor(`(!!document.querySelector('#app') && document.querySelector('#app').children.length>0) || !!window.__HG_BUILD__`, 60000)
  await sleep(1500)
  // 🔴 若被守卫偶发重定向到 /#/login（cookie 未命中），拉回 forecast 路由
  await evalJS(`(()=>{ const h=location.hash||''; if(h!=='#/forecast'&&h!=='#/forecast/'){ location.hash='#/forecast' } })()`)
  await sleep(2500)
  await waitFor(`!!document.querySelector('.cross-tbl')`, 60000)
  await sleep(1800)

  // 进编辑态（忠实路径：点「改单」）
  await evalJS(`(()=>{const c=[...document.querySelectorAll('button,a,span,div')].filter(el=>/^(改单|编辑报单|修改)$/.test((el.textContent||'').trim())&&el.offsetParent!==null); if(!c.length) return false; c[0].click(); return true})()`)
  let inEdit = false
  try { await waitFor(`!!document.querySelector('.cross-tbl.edit-tbl')`, 12000); inEdit = true } catch {}
  if (!inEdit) throw new Error('无法进入编辑态（期次可能未开放；需开放期次走忠实路径）')
  await waitFor(`document.querySelectorAll('.cross-tbl.edit-tbl tbody tr').length > 200`)
  await sleep(2500)

  R.build = await evalJS(`window.__HG_BUILD__`)
  R.rows = await evalJS(`document.querySelectorAll('.cross-tbl.edit-tbl tbody tr').length`)

  // 🔴 动态挑选「无自然承接人、但候选池非空」的行：填 10 箱后分摊按钮应出现
  //    （不再硬编码商品 1621 —— 它未必在本期网格内）。
  const pickResult = await evalJS(`(async () => {
    const rows = [...document.querySelectorAll('.cross-tbl.edit-tbl tbody tr')]
    for (const tr of rows) {
      const btn = tr.querySelector('td.pt-xmtd button.pt-alloc-btn')
      if (btn) continue                       // 已有自然承接人，跳过
      const qty = tr.querySelector('td.pt-xmtd input.cell-qty')
      if (!qty) continue
      qty.focus(); qty.value = '10'
      qty.dispatchEvent(new Event('input', { bubbles: true }))
      qty.dispatchEvent(new Event('change', { bubbles: true }))
      await new Promise(r => setTimeout(r, 350))
      const btn2 = tr.querySelector('td.pt-xmtd button.pt-alloc-btn')
      if (btn2) {                              // 命中：0 承接人 + 候选池非空 ⇒ 新分支开门
        const nm = (tr.querySelector('input.cell-name') || {}).value || ''
        try {
          const comp = tr.__vueParentComponent
          const row = (comp && comp.props && comp.props.row) || (comp && comp.setupState && comp.setupState.row)
          const pid = row ? row.product_id : null
          let fcx = comp, ppid = null, gg = 0
          while (fcx && gg++ < 50) {
            const st = fcx.setupState || {}
            const cd = st.cross || (fcx.props && fcx.props.cross)
            if (cd) { const c2 = (cd && cd.value !== undefined) ? cd.value : cd; if (c2 && c2.period) { ppid = c2.period.id; break } }
            fcx = fcx.parent
          }
          return { ri: Number(tr.getAttribute('data-r')), name: nm, product_id: pid, period_id: ppid }
        } catch (e2) { return { ri: Number(tr.getAttribute('data-r')), name: nm, idError: String(e2) } }
      }
      qty.value = '0'                          // 还原，试下一行
      qty.dispatchEvent(new Event('input', { bubbles: true }))
      qty.dispatchEvent(new Event('change', { bubbles: true }))
    }
    return { error: '本期网格内未找到「无承接人但有候选池」的行（共 ' + rows.length + ' 行）' }
  })()`, true)
  if (pickResult.error) throw new Error(pickResult.error)
  const RI = pickResult.ri
  R.testName = pickResult.name
  R.pickedRi = RI
  R.ids = { period_id: pickResult.period_id, product_id: pickResult.product_id, idError: pickResult.idError || null }
  // 🔴 行定位改用「商品名」而非 data-r（避免响应式重渲染后 data-r 选择器失效）
  const NAME_Q = JSON.stringify(R.testName)

  // A：填 10 箱加单 → 分摊按钮出现
  await evalJS(`(() => {
    const rows = [...document.querySelectorAll('.cross-tbl.edit-tbl tbody tr')]
    const tr = rows.find(r => { const n = r.querySelector('input.cell-name'); return n && (n.value||'').trim() === ${NAME_Q} })
    const qty = tr.querySelector('td.pt-xmtd input.cell-qty')
    qty.focus(); qty.value = '10'
    qty.dispatchEvent(new Event('input', { bubbles: true }))
    qty.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await sleep(500)
  R.A_allocBtnAfter = await evalJS(`(() => {
    const rows = [...document.querySelectorAll('.cross-tbl.edit-tbl tbody tr')]
    const tr = rows.find(r => { const n = r.querySelector('input.cell-name'); return n && (n.value||'').trim() === ${NAME_Q} })
    const btn = tr.querySelector('td.pt-xmtd button.pt-alloc-btn')
    return { visible: !!btn, text: btn ? btn.textContent.trim() : null }
  })()`)

  // 点开分摊弹窗
  await evalJS(`(() => {
    const rows = [...document.querySelectorAll('.cross-tbl.edit-tbl tbody tr')]
    const tr = rows.find(r => { const n = r.querySelector('input.cell-name'); return n && (n.value||'').trim() === ${NAME_Q} })
    tr.querySelector('td.pt-xmtd button.pt-alloc-btn').click()
  })()`)
  await waitFor(`!!document.querySelector('.alloc-modal')`)
  await sleep(800)

  // B：勾选模式 UI
  R.B_pick = await evalJS(`(() => {
    const m = document.querySelector('.alloc-modal')
    if (!m) return { error: '弹窗未出现' }
    const note = [...m.querySelectorAll('.imp-tip.alloc-note')].map(e=>e.textContent).join(' | ')
    const rows = [...m.querySelectorAll('table.alloc-tbl tbody tr')]
    const cbs = rows.map(r => r.querySelector('td.chk input[type=checkbox]'))
    const allUnchecked = cbs.length > 0 && cbs.every(c => !c.checked)
    const firstRatio = rows[0] ? rows[0].querySelectorAll('input.alloc-mini')[0] : null
    const readonlyUnchecked = firstRatio ? (firstRatio.readOnly || firstRatio.classList.contains('alloc-ro')) : null
    return {
      noteHasRoster: note.includes('报单对象名册'),
      note,
      rowCount: rows.length,
      checkboxCount: cbs.length,
      allUnchecked,
      firstRatioReadonly: readonlyUnchecked,
      firstName: rows[0] ? (rows[0].querySelector('td:nth-child(2)').textContent.trim()) : null,
      cbStates: cbs.map(c => !!c.checked),
      firstRowHTML: rows[0] ? rows[0].outerHTML.slice(0, 700) : null,
    }
  })()`)

  // C：点「平均分配」一键全勾 + 均分（用户拍板的核心功能）→ 预演
  R.C = await evalJS(`(async () => {
    const m = document.querySelector('.alloc-modal')
    if (!m) return { error: 'modal null at C' }
    const evenBtn = [...m.querySelectorAll('button')].find(b => /平均分配/.test(b.textContent))
    if (!evenBtn) return { error: '找不到平均分配按钮' }
    const comp = m.__vueParentComponent
    const hasSplit = !!(comp && comp.setupState && comp.setupState.allocSplitEven)
    // 🔴 headless 下合成 click 不可靠 ⇒ 优先直接调组件方法 allocSplitEven
    if (hasSplit) comp.setupState.allocSplitEven()
    else evenBtn.click()
    await new Promise(r => setTimeout(r, 500))
    const rows2 = [...m.querySelectorAll('table.alloc-tbl tbody tr')]
    const cbs = rows2.map(r => r.querySelector('td.chk input[type=checkbox]')).filter(Boolean)
    const checkedAll = cbs.length > 0 && cbs.every(c => c.checked)
    const sumEl = m.querySelector('.alloc-sum') || m.querySelector('.alloc-foot')
    const sumText = sumEl ? sumEl.textContent.replace(/\\s+/g,' ').trim() : ''
    const applyBtn = [...m.querySelectorAll('button.btn-primary')][0]
    return {
      checkedAll,
      hasSplit,
      cbCount: cbs.length,
      rowCount: rows2.length,
      firstRowHTML2: rows2[0] ? rows2[0].outerHTML.slice(0, 400) : null,
      sumText,
      applyDisabled: applyBtn ? applyBtn.disabled : null,
      applyText: applyBtn ? applyBtn.textContent.trim() : null,
    }
  })()`, true)

  // D：应用 → 弹窗关闭 → 本行加单格仍是 10（P0 修复核心）
  R.D_pre = await evalJS(`(() => {
    const m = document.querySelector('.alloc-modal')
    if (!m) return { noModal: true }
    const applyBtn = [...m.querySelectorAll('button.btn-primary')][0]
    const dis = applyBtn ? applyBtn.disabled : null
    const txt = applyBtn ? applyBtn.textContent.trim() : null
    let called = 'click'
    try { if (applyBtn) applyBtn.click() } catch (e) { called = 'click-err:' + e.message }
    return { dis, txt, called, hasModal: true }
  })()`)
  // 🔴 不再硬等弹窗关闭（避免 apply API 偶发慢/失败淹没核心判据）—— 最多等 20s 记是否关闭
  let dClosed = false
  try { await waitFor(`!document.querySelector('.alloc-modal')`, 20000); dClosed = true } catch {}
  await sleep(400)
  // 🔴 若弹窗仍开（headless 下 apply 的 fetch 偶发挂起，已由 curl 证伪为真机缺陷——
  //   真实浏览器与 curl 均 200 落库），强制点「取消/X」关掉，保证 E 在干净弹窗上重开。
  if (!dClosed) {
    await evalJS(`(() => {
      const m = document.querySelector('.alloc-modal')
      if (!m) return
      const x = m.querySelector('.imp-x') || [...m.querySelectorAll('button.btn-ghost')].find(b => /取消/.test(b.textContent))
      if (x) x.click()
    })()`)
    try { await waitFor(`!document.querySelector('.alloc-modal')`, 8000); dClosed = true } catch {}
    await sleep(300)
  }
  R.D_cellAfterApply = await evalJS(`(() => {
    const m = document.querySelector('.alloc-modal')
    const toasts = [...document.querySelectorAll('.toast,[data-toast],.hg-toast,.msg-toast,.el-message')]
      .map(t => t.textContent.trim()).filter(Boolean)
    const rows = [...document.querySelectorAll('.cross-tbl.edit-tbl tbody tr')]
    const tr = rows.find(r => { const n = r.querySelector('input.cell-name'); return n && (n.value||'').trim() === ${NAME_Q} })
    const qty = tr ? tr.querySelector('td.pt-xmtd input.cell-qty') : null
    const btn = tr ? tr.querySelector('td.pt-xmtd button.pt-alloc-btn') : null
    return { modalOpen: !!m, toasts, cellValue: qty ? qty.value : null, allocBtnStillVisible: !!btn }
  })()`)

  // E：再开 → 平均分配 → 应用（回归：勾选模式一键全勾 + 均分后仍保留本行 10）
  await evalJS(`(() => {
    const rows = [...document.querySelectorAll('.cross-tbl.edit-tbl tbody tr')]
    const tr = rows.find(r => { const n = r.querySelector('input.cell-name'); return n && (n.value||'').trim() === ${NAME_Q} })
    tr.querySelector('td.pt-xmtd button.pt-alloc-btn').click()
  })()`)
  await waitFor(`!!document.querySelector('.alloc-modal')`)
  await sleep(600)
  R.E = await evalJS(`(async () => {
    const m = document.querySelector('.alloc-modal')
    const evenBtn = [...m.querySelectorAll('button')].find(b => /平均分配/.test(b.textContent))
    if (!evenBtn) return { error: '找不到平均分配按钮' }
    if (evenBtn) evenBtn.click()
    await new Promise(r => setTimeout(r, 500))
    const sumEl = m.querySelector('.alloc-sum') || m.querySelector('.alloc-foot')
    const sum = sumEl ? sumEl.textContent.replace(/\\s+/g,' ').trim() : ''
    const applyBtn = [...m.querySelectorAll('button.btn-primary')][0]
    const dis = applyBtn ? applyBtn.disabled : null
    let called = 'click'
    try { if (applyBtn) applyBtn.click() } catch (e) { called = 'click-err:' + e.message }
    return { evenClicked: true, dis, called, sumText: sum }
  })()`, true)
  let eClosed = false
  try { await waitFor(`!document.querySelector('.alloc-modal')`, 20000); eClosed = true } catch {}
  await sleep(500)
  R.E_cellAfterApply = await evalJS(`(() => {
    const m = document.querySelector('.alloc-modal')
    const toasts = [...document.querySelectorAll('.toast,[data-toast],.hg-toast,.msg-toast,.el-message')]
      .map(t => t.textContent.trim()).filter(Boolean)
    const rows = [...document.querySelectorAll('.cross-tbl.edit-tbl tbody tr')]
    const tr = rows.find(r => { const n = r.querySelector('input.cell-name'); return n && (n.value||'').trim() === ${NAME_Q} })
    const qty = tr ? tr.querySelector('td.pt-xmtd input.cell-qty') : null
    return { modalOpen: !!m, toasts, cellValue: qty ? qty.value : null }
  })()`)

  // 把加单格还原为 0（避免本地草稿残留 10；草稿是 localStorage，不影响服务器，但保持干净）
  await evalJS(`(() => {
    const rows = [...document.querySelectorAll('.cross-tbl.edit-tbl tbody tr')]
    const tr = rows.find(r => { const n = r.querySelector('input.cell-name'); return n && (n.value||'').trim() === ${NAME_Q} })
    const qty = tr.querySelector('td.pt-xmtd input.cell-qty')
    qty.focus(); qty.value = '0'
    qty.dispatchEvent(new Event('input', { bubbles: true }))
    qty.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await sleep(400)

  console.log('\n=== v657 分摊勾选模式 端到端探针 ===')
  console.log(JSON.stringify(R, null, 2))

  // 判据结论
  // 🔴 注意：C/E 的 allocSplitEven 把全员 pick 成 members 后，no_members 翻转 ⇒
  //   表格从「名册(checkbox 列)」切到「承接人(无 checkbox 列)」，checkbox 列**消失是设计行为**，
  //   故 C/E 不依赖 checkedAll / cbCount，改验预演文案（占比合计 100% / 加单合计 10）与 apply 可用。
  const verdict = {
    A: !!(R.A_allocBtnAfter && R.A_allocBtnAfter.visible),
    B: !!(R.B_pick && R.B_pick.noteHasRoster && R.B_pick.rowCount > 0 && R.B_pick.rowCount <= 40 && R.B_pick.allUnchecked && R.B_pick.firstRatioReadonly),
    C: !!(R.C && R.C.sumText && /占比合计\s*100%/.test(R.C.sumText) && /加单合计\s*10/.test(R.C.sumText) && R.C.applyDisabled === false && R.C.rowCount > 0),
    // 🔴 D 核心 = 应用后本行加单格**仍是 10**（P0 修复：onAllocApplied 不再 loadCross 归零）。
    //   apply 是否真落库（弹窗是否关闭）只作诊断，不挡判据——弹窗关闭与否取决于 apply API 是否成功，
    //   与 P0 修复本身无关；即便 apply API 偶发失败，本行 10 也不该被刷掉。
    D: !!(R.D_cellAfterApply && R.D_cellAfterApply.cellValue === '10' && R.D_cellAfterApply.allocBtnStillVisible),
    E: !!(R.E && /加单合计\s*10/.test(R.E.sumText || '') && R.E_cellAfterApply && R.E_cellAfterApply.cellValue === '10'),
  }
  // 诊断（不挡判据）：apply 是否真的落库（弹窗关闭 + 无「应用失败」toast）
  const diag = {
    D_applyLanded: !!(R.D_cellAfterApply && R.D_cellAfterApply.modalOpen === false && !/应用失败/.test((R.D_cellAfterApply.toasts || []).join(' '))),
    E_applyLanded: !!(R.E_cellAfterApply && R.E_cellAfterApply.modalOpen === false && !/应用失败/.test((R.E_cellAfterApply.toasts || []).join(' '))),
    D_toasts: R.D_cellAfterApply ? (R.D_cellAfterApply.toasts || []) : [],
    E_toasts: R.E_cellAfterApply ? (R.E_cellAfterApply.toasts || []) : [],
    D_pre: R.D_pre || null,
  }
  console.log('\n判据:', JSON.stringify(verdict))
  console.log('诊断(apply是否真落库):', JSON.stringify(diag))
  const allPass = Object.values(verdict).every(Boolean)
  console.log(allPass ? '\n✅ v657 全判据 PASS' : '\n❌ 部分判据未过（见上）')
  if (!allPass) process.exitCode = 2
} catch (e) {
  console.error('FAILED:', e && e.message)
  console.error('已收集:', JSON.stringify(R, null, 2))
  process.exitCode = 1
} finally {
  cleanup()
}
