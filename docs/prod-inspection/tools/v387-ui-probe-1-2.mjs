/**
 * v387-ui-probe-1-2.mjs —— 批次 1.2「供应商档案」前端真机验收（**只读**）
 *
 * 开发计划 §三·1.2 验收判据（原文）：
 *   「侧栏档案管理出现第 7 个页签；`Rebate.vue` 那句提示点过去**真的能到**」
 *
 * 验什么：
 *   A 相 `#/archive/suppliers`
 *     ① 页签条共 **7** 个、第 3 位 =「供应商档案」、当前激活项 = 它
 *     ② ★ `tabFromPath` 静默落回判据：深链进 `/archive/suppliers` 时正文标题必须
 *        是「供应商档案」而**不是**「员工档案」（漏登记 = URL 与内容对不上、零报错）
 *     ③ 表格表头 5 列、每行 td=5、**逐列与后端 `type=supplier` 真值按名称配对一致**
 *     ④ 弹窗：点之前同一选择器命中 0（判别力）→ 打开后主区 **8 格 3 行两列 + 2 行通栏**
 *        （零留白）、datalist 真存在、焦点已移入、复用全局 `.input`
 *     ⑤ 关闭契约（UI-SPEC §4.1-④）：无改动「取消」直接关；有改动第一次点只出提示、
 *        第二次才关；Esc 可关
 *   B 相 `#/rebate`
 *     ⑥ `.cf-jump` 真在页面上、真能跳（点后 hash 变、目标页真渲染、不是白屏）
 *     ⑦ 打印实际出现的 `.cf-jump` 文案集合 —— 自证「我看到的是空的」不是选择器写错
 *
 * ⚠️ 供应商那处 `.cf-jump` 的 `v-if` 是 `!contactOptions.length`（没有厂家档案才提示）。
 *   demo 租户有 1 家厂家 ⇒ 该处**不渲染**，所以 ⑥ 用**同实现同函数**的品牌那处触发
 *   （demo `/api/brands` 为空）。「供应商那处指向哪」由构建产物静态取证兜住
 *   （见 v387-rebate-jump-static.sh）。
 *
 * 🔴 脱敏：不打印任何供应商 / 客户名称，只打数量。
 * 🔴 只读：写动作仅 1 次 demo-login，收尾 logout。全程用零写入哨兵看住。
 *
 * 用法（先本地预发，通过后才打线上）：
 *   PROBE_BASE=http://127.0.0.1:8791 node docs/prod-inspection/tools/v387-ui-probe-1-2.mjs
 *   node docs/prod-inspection/tools/v387-ui-probe-1-2.mjs          # 默认 hergent.cn
 */
import { launch } from '../../../.workbuddy/tools/lib/cdp-lite.mjs'

const BASE = process.env.PROBE_BASE || 'https://hergent.cn'
const R = []
const ok = (name, cond, extra = '') => { R.push({ name, ok: !!cond, extra }); console.log((cond ? '  ✅ ' : '  ❌ ') + name + (extra ? '  → ' + extra : '')); return !!cond }
const nz = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function call(method, path, token, body) {
  const h = { 'Content-Type': 'application/json', 'X-Client': 'web' }
  if (token) h.Authorization = 'Bearer ' + token
  const res = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) })
  const txt = await res.text()
  let j = {}; try { j = JSON.parse(txt) } catch { /* ignore */ }
  return { status: res.status, json: j, text: txt }
}
const tok = (o) => o.access_token || o.token || ''

/** 轮询等待某个页面条件成立，返回耗时 ms（超时返 -1）。
 *  🔴 为什么不能只 `sleep(2500)`：路由目标 `Archive.vue` 是 `() => import(...)` 的
 *     **异步组件**；`router.push` 会**先把 hash 改掉、再等着组件到货**（vue-router 4 的
 *     行为：导航未完成时旧视图继续显示）。于是「hash 已变、主内容还没切」是**正常中间态**，
 *     定长等待会把中间态当成「点了没反应」—— 这是最容易写出假失败的一种时序坑。 */
async function waitFor(page, expr, timeoutMs = 15000, stepMs = 300) {
  const t0 = Date.now()
  let errs = 0
  while (Date.now() - t0 < timeoutMs) {
    let v = false
    try { v = await page.eval(expr) } catch { errs++ }
    if (v) return Date.now() - t0
    await sleep(stepMs)
  }
  return -1 - errs      // 负数：-1~-∞；绝对值大于 1 表示期间有 eval 异常
}

/* ---------------- 注入脚本（种令牌 + 零写入哨兵 + toast 账本）
     ⚠️ 模板字符串：内部一律单引号，**禁止反引号**（会截断字符串）。 ---------------- */
function seedJs(token, user, tenant, csrf) {
  return `
try {
  localStorage.setItem('hergent_v2_token', ${JSON.stringify(token)});
  localStorage.setItem('hergent_v2_user', ${JSON.stringify(JSON.stringify(user || {}))});
  ${tenant ? "localStorage.setItem('hergent_v2_tenant', " + JSON.stringify(String(tenant)) + ');' : ''}
  ${csrf ? "localStorage.setItem('hergent_v2_csrf', " + JSON.stringify(String(csrf)) + ');' : ''}
} catch (e) {}

window.__toasts = [];
try {
  var rec = function () {
    var els = document.querySelectorAll('[class*="toast"]');
    for (var i = 0; i < els.length; i++) {
      var x = (els[i].textContent || '').replace(/\\s+/g, ' ').trim();
      if (x && window.__toasts.indexOf(x) < 0) window.__toasts.push(x);
    }
  };
  new MutationObserver(rec).observe(document, { childList: true, subtree: true, characterData: true });
  document.addEventListener('DOMContentLoaded', rec);
} catch (e) { window.__toastObsErr = String(e); }

/* 零写入哨兵：任何非 GET 的 /api/ 请求都落账 */
window.__WRITES = [];
(function () {
  function logWrite(m, u) {
    try {
      if (String(u).indexOf('/api/') >= 0 && String(m || 'GET').toUpperCase() !== 'GET') {
        window.__WRITES.push(String(m).toUpperCase() + ' ' + String(u));
      }
    } catch (e) {}
  }
  var f0 = window.fetch;
  window.fetch = function (a, b) {
    var u = (typeof a === 'string') ? a : ((a && a.url) || '');
    logWrite((b && b.method) || (a && a.method) || 'GET', u);
    return f0.apply(this, arguments);
  };
  var o0 = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, u) { logWrite(m, u); return o0.apply(this, arguments) };
})();

/* 原生弹窗桩 */
window.__dlg = [];
window.confirm = function (m) { window.__dlg.push('confirm:' + m); return true };
window.alert = function (m) { window.__dlg.push('alert:' + m) };
`
}

/* ---------------- 页面侧采样函数（一律 toString() 注入） ---------------- */

/** A 相：页签条 + 正文标题 + 表格结构 + 与后端逐列比对 */
function SNAP_ARCHIVE() {
  return (async function () {
    const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
    const tabs = [...document.querySelectorAll('.module-tabs button')]
    const tabTexts = tabs.map((b) => norm(b.textContent))
    const activeIdx = tabs.findIndex((b) => b.classList.contains('on'))
    const h2 = norm((document.querySelector('.page-hd h2') || {}).textContent || '')

    const ths = [...document.querySelectorAll('.tbl thead th')].map((t) => norm(t.textContent))
    const trs = [...document.querySelectorAll('.tbl tbody tr')]
    const rows = trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => norm(td.textContent)))

    /* 与后端真值配对：页面 loadList 也传 type=supplier，两边应同源 */
    let api = [], apiTotal = null, apiErr = ''
    try {
      const tk = localStorage.getItem('hergent_v2_token') || ''
      const res = await fetch('/api/contacts?type=supplier&limit=100&offset=0',
        { headers: { Authorization: 'Bearer ' + tk, 'X-Client': 'web' } })
      const j = await res.json()
      api = j.items || []
      apiTotal = j.total
    } catch (e) { apiErr = String(e && e.message || e) }

    const byName = {}
    api.forEach((r) => { byName[norm(r.name)] = r })

    const pairs = rows.map((cells) => {
      const r = byName[cells[0]]
      if (!r) return { found: false, ndiff: -1 }
      /* 表头 5 列：名称 / 类别 / 对接人 / 电话 / (操作列无标题) */
      const exp = [
        norm(r.name),
        norm(r.supplier_category) || '—',
        norm(r.contact_person) || '—',
        norm(r.phone) || '—',
        cells[4],
      ]
      const diffs = []
      for (let i = 0; i < 4; i++) if (norm(cells[i]) !== norm(exp[i])) diffs.push({ i, got: cells[i], exp: exp[i] })
      return { found: true, ndiff: diffs.length, diffs: diffs.slice(0, 3) }
    })

    const nzName = (s) => { const v = norm(s); return v.length > 0 && v !== '—' }

    return {
      tabCount: tabs.length,
      tabTexts,
      activeIdx,
      activeText: activeIdx >= 0 ? tabTexts[activeIdx] : '',
      h2,
      ths,
      rowCount: rows.length,
      tdCounts: rows.map((c) => c.length),
      apiTotal, apiRows: api.length, apiErr,
      matched: pairs.filter((p) => p.found).length,
      aligned: pairs.filter((p) => p.found && p.ndiff === 0).length,
      badPairs: pairs.filter((p) => p.ndiff > 0).slice(0, 2),
      /* 判别力（deprecated，见下）：后端真值里有电话的行数 */
      apiNonEmptyPhone: api.filter((r) => norm(r.phone)).length,
      /* ★ 判别力（改用「空值渲染契约」两向计数）：
         DOM 里类别/对接人/电话三列的「—」格数  必须 ==  后端对应字段为空的行数×3
         —— 若渲染成别的占位符（或硬编码「—」）两侧立刻不等。
         同时 name 列必须非空且非「—」（有名字就必须原样渲染）。 */
      dashCells: rows.reduce((a, c) => a + [1, 2, 3].filter((i) => norm(c[i]) === '—').length, 0),
      apiEmptyCells: api.reduce((a, r) => a + [norm(r.supplier_category), norm(r.contact_person), norm(r.phone)].filter((x) => !x).length, 0),
      nameCellsOk: rows.filter((c) => nzName(c[0])).length,
      /* 弹窗关闭时，同一选择器必须命中 0 */
      modalBeforeClick: document.querySelectorAll('.sup-modal[role="dialog"]').length,
      emptyText: norm((document.querySelector('.sup-panel .state-empty') || {}).textContent || ''),
      statText: norm((document.querySelector('.sup-stat') || {}).textContent || ''),
      href: location.href,
      loggedIn: !!localStorage.getItem('hergent_v2_token'),
      writes: window.__WRITES || [],
      armed: Array.isArray(window.__WRITES),
      toasts: window.__toasts || [],
      toastObsErr: window.__toastObsErr || '',
    }
  })()
}

/** 点右上角「+ 新增供应商」 */
function CLICK_ADD() {
  const btns = [...document.querySelectorAll('.sup-actions button')]
  const b = btns.find((x) => /新增供应商/.test(x.textContent || ''))
  if (!b) return { clicked: false, found: btns.length, texts: btns.map((x) => (x.textContent || '').trim()) }
  b.click()
  return { clicked: true, found: btns.length, texts: btns.map((x) => (x.textContent || '').trim()) }
}

/** A 相：弹窗结构采样 */
function SNAP_MODAL() {
  return (function () {
    const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
    const mod = document.querySelector('.sup-modal[role="dialog"]')
    if (!mod) return { modal: false, anyModal: document.querySelectorAll('.sup-modal[role="dialog"]').length }
    const b = mod.querySelector('.sup-modal-hd b')
    const main = mod.querySelector('.sup-form:not(.sup-form-more)')
    const more = mod.querySelector('.sup-form-more')
    const labels = main ? [...main.querySelectorAll('label.sup-f')] : []
    const labTexts = labels.map((l) => norm(l.querySelector('span') ? l.querySelector('span').textContent : ''))
    const fulls = labels.filter((l) => l.classList.contains('sup-f-full')).length
    const catInp = mod.querySelector('input[list="sup-cat-list"]')
    const catDl = catInp ? document.getElementById(catInp.getAttribute('list')) : null
    const own = catInp ? catInp.closest('label') : null
    const ae = document.activeElement
    const firstInp = mod.querySelector('input.input')
    const cs = firstInp ? getComputedStyle(firstInp) : null
    return {
      modal: true,
      title: b ? norm(b.textContent) : '',
      ariaModal: mod.getAttribute('aria-modal'),
      labelledby: mod.getAttribute('aria-labelledby'),
      labelledbyExists: !!document.getElementById(mod.getAttribute('aria-labelledby') || ''),
      tabindex: mod.getAttribute('tabindex'),
      mainLabelCount: labels.length,
      mainLabels: labTexts,
      fullCount: fulls,
      hasCatInput: !!catInp,
      catInModal: mod.querySelectorAll('input[list="sup-cat-list"]').length,
      catOwnLabel: own && own.querySelector('span') ? norm(own.querySelector('span').textContent) : '',
      catInputClass: catInp ? catInp.className : '',
      catDatalistId: catInp ? catInp.getAttribute('list') : '',
      catDatalistExists: !!catDl,
      catDatalistOptions: catDl ? catDl.options.length : -1,
      moreCount: more ? more.querySelectorAll('label.sup-f').length : 0,
      moreBtnText: norm((mod.querySelector('.sup-more') || {}).textContent || ''),
      ftButtons: [...mod.querySelectorAll('.sup-modal-ft button')].map((x) => norm(x.textContent)),
      hint: norm((mod.querySelector('.sup-hint') || {}).textContent || ''),
      focusInModal: !!ae && (ae === mod || mod.contains(ae)),
      focusTag: ae ? ae.tagName + (ae.className ? '.' + String(ae.className).split(/\s+/)[0] : '') : '',
      inputFontSize: cs ? cs.fontSize : '',
      /* UI-SPEC §2.2：控件高度只有 40px / 32px 两档；全局 `.input` 定的是 40px */
      inputHeight: cs ? cs.height : '',
      inputBorder: cs ? cs.borderTopWidth + ' ' + cs.borderTopStyle : '',
    }
  })()
}

/** 点弹窗底部指定文案的按钮 */
function CLICK_FT(labelRe) {
  const bs = [...document.querySelectorAll('.sup-modal[role="dialog"] .sup-modal-ft button')]
  const b = bs.find((x) => new RegExp(labelRe).test(x.textContent || ''))
  if (!b) return { clicked: false, texts: bs.map((x) => (x.textContent || '').trim()) }
  b.click()
  return { clicked: true, label: (b.textContent || '').trim() }
}

function MODAL_COUNT() {
  return document.querySelectorAll('.sup-modal[role="dialog"]').length
}

/** 展开「更多字段」并采样 */
function OPEN_MORE() {
  const m = document.querySelector('.sup-modal[role="dialog"]')
  if (!m) return { ok: false }
  const b = m.querySelector('.sup-more')
  if (!b) return { ok: false }
  b.click()
  return { ok: true, text: (b.textContent || '').trim() }
}

function SNAP_MORE() {
  const m = document.querySelector('.sup-modal[role="dialog"]')
  const more = m ? m.querySelector('.sup-form-more') : null
  const s = more ? more.querySelector('input[list="sup-settle-list"]') : null
  const dl = s ? document.getElementById(s.getAttribute('list')) : null
  return {
    moreExists: !!more,
    moreLabels: more ? [...more.querySelectorAll('label.sup-f')].map((l) => String((l.querySelector('span') || {}).textContent || '').replace(/\s+/g, ' ').trim()) : [],
    settleInput: !!s,
    settleDatalistId: s ? s.getAttribute('list') : '',
    settleDatalistExists: !!dl,
    settleDatalistOptions: dl ? dl.options.length : -1,
  }
}

/** 给第一个输入框真实输入（走 CDP 键盘走得进 v-model，见 main 里用 Input.insertText） */

/** B 相：切 Rebate 页内主页签（`.main-tabs > button.main-tab`） */
function CLICK_MAIN_TAB(label) {
  const bs = [...document.querySelectorAll('.main-tabs button.main-tab')]
  const b = bs.find((x) => (x.textContent || '').trim() === label)
  if (!b) return { clicked: false, texts: bs.map((x) => (x.textContent || '').trim()) }
  b.click()
  return { clicked: true, texts: bs.map((x) => (x.textContent || '').trim()) }
}

/** B 相：Rebate 页 —— 找「录入年度合同」并打开（**该按钮在「返利结算」页签下**） */
function CLICK_CONTRACT() {
  const bs = [...document.querySelectorAll('button')]
  const b = bs.find((x) => /录入年度合同/.test(x.textContent || ''))
  if (!b) return { clicked: false, candidates: bs.filter((x) => /合同/.test(x.textContent || '')).map((x) => (x.textContent || '').trim()).slice(0, 8) }
  b.click()
  return { clicked: true, label: (b.textContent || '').trim() }
}

/** B 相：采样 `.cf-jump` 集合 + 弹窗状态 */
function SNAP_JUMPS() {
  const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
  const jumps = [...document.querySelectorAll('.cf-jump')]
  const card = document.querySelector('.modal-card')
  return {
    count: jumps.length,
    texts: jumps.map((b) => norm(b.textContent)),
    inModal: jumps.filter((b) => card && card.contains(b)).length,
    modalOpen: !!card,
    step1: !!document.querySelector('.cf-step.active'),
    hash: location.hash,
    h2: norm((document.querySelector('.page-hd h2') || {}).textContent || ''),
    styles: jumps.map((b) => { const c = getComputedStyle(b); return { deco: c.textDecorationLine, cursor: c.cursor, color: c.color } }),
  }
}

/** B 相：点第 idx 个 `.cf-jump` */
function CLICK_JUMP(idx) {
  const jumps = [...document.querySelectorAll('.cf-jump')]
  if (!jumps[idx]) return { clicked: false, count: jumps.length }
  const t = String(jumps[idx].textContent || '').trim()
  jumps[idx].click()
  return { clicked: true, text: t }
}

/** 目标页渲染判据（跳过去之后） */
function SNAP_TARGET() {
  const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
  return {
    hash: location.hash,
    h2: norm((document.querySelector('.page-hd h2') || {}).textContent || ''),
    tabActive: norm((document.querySelector('.module-tabs button.on') || {}).textContent || ''),
    bodyLen: norm(document.body.textContent).length,
    hasApp: !!document.querySelector('#app > *'),
    toasts: (window.__toasts || []).slice(0, 5),
  }
}

async function main() {
  /* ---------- 前置：demo 令牌（tenant 10，只读） ---------- */
  const demo = await call('POST', '/api/auth/demo-login', null, {})
  if (demo.status !== 200 || !tok(demo.json)) throw new Error('demo-login 失败：' + demo.status + ' ' + demo.text.slice(0, 120))
  const token = tok(demo.json)
  const user = demo.json.user || {}
  console.log('demo-login ok：tenant=%s role=%s  base=%s', demo.json.tenant_id, user.role, BASE)

  /* 前置：后端 options 必须含 supplier_category（v387 补的那一项，前端 datalist 的候选来源） */
  const opt = await call('GET', '/api/contacts/options?type=supplier', token)
  const optKeys = Object.keys((opt.json && opt.json.options) || {}).sort()

  const browser = await launch({ headless: true })
  let T, M, MM, JM, TG, A_WAIT = 0, B_WAIT = 0
  /* 空值兜底：页面没渲染时，采样函数会返回 undefined —— 直接往下走会抛 TypeError，
     把"页面白屏"这个真信号掩盖成一堆 `reading '0' of undefined`。补齐字段让断言优雅失败。 */
  const DEF = (o) => Object.assign({
    tabTexts: [], ths: [], tdCounts: [], pairs: [], toasts: [], writes: [], mainLabels: [],
    ftAfter: [], labels: [], styles: [], texts: [], candidates: [], apiErr: '', extra: '',
    href: '', statText: '', emptyText: '', pageErrors: [], pageErrors2: [],
  }, o || {})
  try {
    const page = await browser.newPage()
    await page.enable()
    const sid = await page.addInitScript(seedJs(token, user, demo.json.tenant_id, demo.json.csrf_token))

    /* ================= A 相：#/archive/suppliers ================= */
    /* 🔴 冷启动深链必须让 URL **真的不同**（只改 hash 不产生新文档 ⇒ 种下的 localStorage 是空的） */
    await page.goto(BASE + '/?__r=' + Date.now() + '#/archive/suppliers', 1800)
    /* 🔴 不能定长 sleep：本地预发是磁盘秒开，生产要过网络拉整套生效集（57 个 chunk），
       同一个 7s 在本地够、在线上常常不够 —— 于是"页面还没渲染"被误读成"功能没做"。 */
    A_WAIT = await waitFor(page, "!!document.querySelector('.module-tabs button.on')", 45000, 400)

    T = DEF(await page.eval('(' + SNAP_ARCHIVE.toString() + ')()'))
    await page.screenshot('/tmp/v387-1-2-archive.png')

    /* --- 弹窗：打开 --- */
    T.clickAdd = await page.eval('(' + CLICK_ADD.toString() + ')()')
    await sleep(900)
    M = DEF(await page.eval('(' + SNAP_MODAL.toString() + ')()'))
    await page.screenshot('/tmp/v387-1-2-modal.png')

    /* ⑤a 无改动时「取消」应直接关 */
    M.cancel1 = await page.eval('(' + CLICK_FT.toString() + ')("^取消$")')
    await sleep(700)
    M.afterCancel1 = await page.eval('(' + MODAL_COUNT.toString() + ')()')

    /* ⑤b 有改动时第一次点「取消」只出提示 */
    T.clickAdd2 = await page.eval('(' + CLICK_ADD.toString() + ')()')
    await sleep(800)
    await page.eval("(function(){var m=document.querySelector('.sup-modal[role=\"dialog\"]');if(!m)return 0;var i=m.querySelector('input.input');i.focus();return 1})()")
    await page.raw.send('Input.insertText', { text: '探针临时输入' })
    await sleep(400)
    M.dirty = await page.eval('(' + SNAP_MODAL.toString() + ')()')
    M.cancel2 = await page.eval('(' + CLICK_FT.toString() + ')("取消|放弃")')
    await sleep(700)
    M.afterCancel2 = await page.eval('(' + MODAL_COUNT.toString() + ')()')
    M.hintAfter = await page.eval("(function(){var h=document.querySelector('.sup-modal[role=\"dialog\"] .sup-hint');return h?(h.textContent||'').replace(/\\s+/g,' ').trim():''})()")
    M.ftAfter = await page.eval("(function(){return [].slice.call(document.querySelectorAll('.sup-modal[role=\"dialog\"] .sup-modal-ft button')).map(function(b){return (b.textContent||'').trim()})})()")
    await page.screenshot('/tmp/v387-1-2-dirty.png')

    /* ⑤c 第二次点才关 */
    M.cancel3 = await page.eval('(' + CLICK_FT.toString() + ')("取消|放弃")')
    await sleep(700)
    M.afterCancel3 = await page.eval('(' + MODAL_COUNT.toString() + ')()')

    /* ⑤d Esc 可关（无改动时）
       ⚠️ Esc 事件是 CDP 真键盘派发给**当前 focus 的元素**的，而 `@keydown.esc` 挂在
       `.sup-modal` 上 ⇒ 必须先确认「焦点确实在弹窗内」再派发，否则测的是「焦点在哪」
       而不是「Esc 能不能关」。上一版把打开等待写死 800ms，出现过一次焦点未就位 ⇒ 假失败。 */
    await page.eval('(' + CLICK_ADD.toString() + ')()')
    M.escOpenWait = await waitFor(page, "!!document.querySelector('.sup-modal[role=\"dialog\"]')", 8000, 200)
    await waitFor(page, "(function(){var m=document.querySelector('.sup-modal[role=\"dialog\"]');return !!m && (document.activeElement===m || m.contains(document.activeElement))})()", 8000, 200)
    M.escPre = await page.eval('(' + SNAP_MODAL.toString() + ')()')
    M.escBefore = await page.eval('(' + MODAL_COUNT.toString() + ')()')
    await page.raw.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
    await page.raw.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
    await sleep(700)
    M.escAfter = await page.eval('(' + MODAL_COUNT.toString() + ')()')

    /* ④b 「更多字段」展开后结算方式 datalist 存在 */
    await page.eval('(' + CLICK_ADD.toString() + ')()')
    await sleep(800)
    MM = {}
    MM = DEF(MM)
    MM.open = await page.eval('(' + OPEN_MORE.toString() + ')()')
    await sleep(500)
    MM.snap = DEF(await page.eval('(' + SNAP_MORE.toString() + ')()'))
    await page.screenshot('/tmp/v387-1-2-more.png')
    /* 关掉（此时已 dirty，需要两次）；用 X 按钮的 tryClose 同样走二次确认 */
    await page.eval('(' + CLICK_FT.toString() + ')("取消|放弃")')
    await sleep(500)
    await page.eval('(' + CLICK_FT.toString() + ')("取消|放弃")')
    await sleep(500)
    MM.leftOpen = await page.eval('(' + MODAL_COUNT.toString() + ')()')

    /* ================= B 相：#/rebate =================
       🔴 用**独立 page**：A 相在同一文档里做过大量交互（CDP 打字 / 派发 Esc /
          反复开关弹窗）。实测同一 page 接着跑 B 相时，`.cf-jump` 点击后 hash 会变、
          但目标组件始终不挂载（轮询 15s 超时、console 零错误）。把 B 相放到新 target 后
          304ms 就正常挂载 ⇒ 是探针自身的状态污染，不是产品缺陷。
          （定向实验见 `v387-jump-diag.mjs`：A 相不参与时，三种路径全绿。） */
    const page2 = await browser.newPage()
    await page2.enable()
    const sid2 = await page2.addInitScript(seedJs(token, user, demo.json.tenant_id, demo.json.csrf_token))
    await page2.goto(BASE + '/?__r=' + Date.now() + '#/rebate', 1800)
    B_WAIT = await waitFor(page2, "!!document.querySelector('.main-tabs button.main-tab')", 45000, 400)
    /* 🔴 `.cf-jump` 那两处都在**年度合同录入弹窗**里，而弹窗入口「+ 录入年度合同」
       在**「返利结算」页签**下（默认停在「仪表盘」⇒ 直接找按钮会得 0，看着像功能没做）。 */
    const tabSw = await page2.eval('(' + CLICK_MAIN_TAB.toString() + ')("返利结算")')
    await sleep(2500)
    const con = await page2.eval('(' + CLICK_CONTRACT.toString() + ')()')
    await sleep(1200)
    JM = DEF(await page2.eval('(' + SNAP_JUMPS.toString() + ')()'))
    JM.tabSwitch = tabSw
    JM.clickInfo = con
    await page2.screenshot('/tmp/v387-1-2-rebate.png')

    /* 点第一个 `.cf-jump`（demo 下 brands 为空 ⇒ 出现的是「品牌档案」那处，同函数同实现） */
    const jc = await page2.eval('(' + CLICK_JUMP.toString() + ')(0)')
    /* 等到**目标容器真的挂上**（标题 + 页签条同时在），而不是定长 sleep */
    const waited = await waitFor(page2,
      "!!document.querySelector('.module-tabs button.on') && !!document.querySelector('.page-hd h2')")
    TG = DEF(await page2.eval('(' + SNAP_TARGET.toString() + ')()'))
    JM.jumpClick = jc
    JM.waitMs = waited
    JM.target = TG
    await page2.screenshot('/tmp/v387-1-2-jump-target.png')

    const arr = await page2.eval('(' + SNAP_ARCHIVE.toString() + ')()')
    TG.writesAfterJump = arr.writes
    TG.toasts = arr.toasts

    T.pageErrors = page.errors.slice(0, 8)
    T.pageErrors2 = page2.errors.slice(0, 8)
    await page.removeInitScript(sid)
    await page2.removeInitScript(sid2)
    await browser.close()
  } catch (e) {
    try { await browser.close() } catch { /* ignore */ }
    throw e
  }

  /* ================= 断言 ================= */
  console.log('\n===== 断言 =====')

  console.log('\n-- 前置（不通过则后面全是假结论）--')
  ok('A 相页面已渲染就绪（轮询等待，非定长 sleep）', A_WAIT >= 0, '就绪耗时=' + A_WAIT + 'ms')
  ok('B 相页面已渲染就绪', B_WAIT >= 0, '就绪耗时=' + B_WAIT + 'ms')
  ok('已登录且**停在**目标深链 `#/archive/suppliers`（没被守卫弹走）',
    T.loggedIn && /#\/archive\/suppliers/.test(T.href), 'href=' + T.href)
  ok('写监控已安装（缺它，「零写入」恒真）', T.armed === true, 'armed=' + T.armed)
  ok('toast 观察器安装成功', !T.toastObsErr, T.toastObsErr || 'ok')
  ok('后端真值取到了（逐列比对的基准）', T.apiTotal !== null && T.apiRows >= 1 && !T.apiErr,
    'apiTotal=' + T.apiTotal + ' apiRows=' + T.apiRows + (T.apiErr ? ' err=' + T.apiErr : ''))
  ok('后端 `/api/contacts/options?type=supplier` 含 `supplier_category` 键（v387 补的那项，datalist 候选来源）',
    optKeys.includes('supplier_category'), 'keys=' + JSON.stringify(optKeys))
  ok('★ 同一接口**不含** `bank_account`（加密列不该出现在候选里）',
    !optKeys.includes('bank_account'), 'keys=' + JSON.stringify(optKeys))

  console.log('\n-- ① 页签条：第 7 个页签、第 3 位 --')
  ok('页签共 **7** 个', T.tabCount === 7, T.tabCount + ' 个：' + JSON.stringify(T.tabTexts))
  ok('第 3 位（index 2）=「供应商档案」', nz(T.tabTexts[2]) === '供应商档案', 'tabTexts[2]=' + JSON.stringify(T.tabTexts[2]))
  ok('当前激活页签 =「供应商档案」', nz(T.activeText) === '供应商档案', 'activeIdx=' + T.activeIdx + ' activeText=' + JSON.stringify(T.activeText))
  ok('「供应商档案」在页签里只出现 **1** 次（不是重复页签）',
    T.tabTexts.filter((x) => x === '供应商档案').length === 1, '命中 ' + T.tabTexts.filter((x) => x === '供应商档案').length + ' 次')
  const KEEPTAB = ['员工档案', '客户档案', '品牌档案', '商品档案', '仓库档案', '渠道与价格']
  const missTab = KEEPTAB.filter((k) => !T.tabTexts.includes(k))
  ok('原 **6** 个页签一个不少（证明是「插入」不是「替换」）',
    missTab.length === 0, missTab.length ? '缺：' + JSON.stringify(missTab) : 'ok')

  console.log('\n-- ② ★ tabFromPath 静默落回判据（漏登记 = URL 与内容对不上、零报错）--')
  ok('★ 正文标题 =「供应商档案」而**不是**「员工档案」（深链没落回兜底页签）',
    nz(T.h2) === '供应商档案', 'h2=' + JSON.stringify(T.h2))

  console.log('\n-- ③ 表格：5 列 + 逐列与后端真值比对 --')
  ok('判别力：demo 后端确实有供应商（否则下表断言全空转）', T.apiTotal >= 1, 'apiTotal=' + T.apiTotal)
  ok('表格真渲染出供应商行', T.rowCount >= 1, '行数=' + T.rowCount + (T.emptyText ? ' empty="' + T.emptyText + '"' : ''))
  ok('表头共 **5** 列', T.ths.length === 5, T.ths.length + ' 列：' + JSON.stringify(T.ths))
  ok('表头第 1 列 =「供应商名称」、第 5 列（操作）无标题',
    nz(T.ths[0]) === '供应商名称' && nz(T.ths[4]) === '', JSON.stringify(T.ths))
  ok('每行 td 数 == 5（与表头对齐，无错位/无缺格）',
    T.tdCounts.length > 0 && T.tdCounts.every((n) => n === 5), JSON.stringify(T.tdCounts))
  ok('DOM 每一行都能在后端 `type=supplier` 结果里配对到（两端口径同源）',
    T.matched === T.rowCount && T.rowCount >= 1, '配对 ' + T.matched + ' / ' + T.rowCount)
  ok('★ **所有配对行逐列一致**（名称 / 类别 / 对接人 / 电话）',
    T.aligned === T.matched && T.matched >= 1,
    '完全一致 ' + T.aligned + ' / ' + T.matched + (T.aligned === T.matched ? '' : ' 差异=' + JSON.stringify(T.badPairs)))
  ok('★ 判别力（两向计数）：DOM 里类别/对接人/电话三列的「—」格数 **==** 后端对应字段为空的行数×3',
    T.dashCells === T.apiEmptyCells,
    'DOM「—」格=' + T.dashCells + ' 后端空值格=' + T.apiEmptyCells + '（不等 ⇒ 要么占位符不一致、要么比对基准错）')
  ok('★ 判别力：名称列有真值（既非空也非「—」）—— 证明不是「两边全空所以相等」',
    T.nameCellsOk === T.rowCount && T.rowCount >= 1, '有名字的行=' + T.nameCellsOk + ' / ' + T.rowCount)
  ok('页面统计文本与后端 total 一致（没把客户/员工混进来）',
    String(T.statText).indexOf(String(T.apiTotal)) >= 0, '页面="' + T.statText + '" 后端=' + T.apiTotal)

  console.log('\n-- ④ 弹窗：8 格零留白 + datalist 真存在 + 焦点 --')
  ok('判别力：**点新增之前** `.sup-modal[role="dialog"]` 命中 0',
    T.modalBeforeClick === 0, 'before=' + T.modalBeforeClick)
  ok('「+ 新增供应商」按钮存在且被点中',
    T.clickAdd && T.clickAdd.clicked === true, JSON.stringify(T.clickAdd && T.clickAdd.texts))
  ok('弹窗已打开且标题 =「新增供应商」', M.modal === true && M.title === '新增供应商', 'title=' + JSON.stringify(M.title))
  ok('`aria-modal="true"`（§4.1-①）', M.ariaModal === 'true', 'aria-modal=' + M.ariaModal)
  ok('`aria-labelledby` 指向的元素**真的存在**（§4.1-①）',
    M.labelledby === 'sup-modal-title' && M.labelledbyExists === true, 'labelledby=' + M.labelledby + ' exists=' + M.labelledbyExists)
  ok('`tabindex="-1"`（§4.1-②）', M.tabindex === '-1', 'tabindex=' + M.tabindex)
  ok('★ 打开后焦点已移入弹窗内（§4.1-②，否则 Esc 监听不到）',
    M.focusInModal === true, 'focus=' + M.focusTag)
  ok('主区字段数 = **8**（3 行两列 + 2 行通栏）', M.mainLabelCount === 8, M.mainLabelCount + ' 个：' + JSON.stringify(M.mainLabels))
  ok('★ 通栏字段 = **2** 个（地址 / 备注）⇒ 恰好填满、零留白',
    M.fullCount === 2, 'full=' + M.fullCount)
  ok('主区字段顺序含「供应商名称 / 供应商类别 / 对接人 / 联系电话 / 开户行 / 银行账号」',
    ['供应商名称', '供应商类别', '对接人', '联系电话', '开户行', '银行账号'].every((k, i) => String(M.mainLabels[i] || '').indexOf(k) === 0),
    JSON.stringify(M.mainLabels.slice(0, 6)))
  ok('主区含 `input[list="sup-cat-list"]` 且 label 以「供应商类别」开头',
    M.hasCatInput === true && String(M.catOwnLabel).indexOf('供应商类别') === 0, 'label=' + JSON.stringify(M.catOwnLabel))
  ok('★ `list` 指向的 datalist **真的存在**（id 打错 = 静默无候选）',
    M.catDatalistId === 'sup-cat-list' && M.catDatalistExists === true,
    'id=' + M.catDatalistId + ' exists=' + M.catDatalistExists + ' options=' + M.catDatalistOptions)
  ok('新控件复用全局 `.input`（不自造样式）',
    String(M.catInputClass).split(/\s+/).includes('input'), 'class=' + JSON.stringify(M.catInputClass))
  /* UI-SPEC §2.2：控件高度只有 40px / 32px **两档**。
     全局 `.input` = 40px；本页弹窗内用 `.sup-f .input{height:32px}` 收窄（形式密集场景），
     两档都在规范内 —— 判据是「落在两档之一」，**不是**写死 40px（上一版就是把这条写死了）。 */
  ok('输入框高度落在 UI-SPEC §2.2 的两档之内（40px / 32px）+ 实线边框',
    (M.inputHeight === '40px' || M.inputHeight === '32px') && /solid/.test(M.inputBorder),
    'height=' + M.inputHeight + ' border=' + M.inputBorder + ' font=' + M.inputFontSize)

  console.log('\n-- ⑤ 关闭契约（UI-SPEC §4.1-④）--')
  ok('无改动时点「取消」→ 弹窗**直接关**', M.afterCancel1 === 0, '残留=' + M.afterCancel1)
  ok('有改动时第一次点「放弃改动」→ 弹窗**仍在**（不许静默丢弃）',
    M.afterCancel2 === 1, '残留=' + M.afterCancel2)
  ok('★ 且出现内联二次确认提示 `.sup-hint`',
    /未保存/.test(String(M.hintAfter)), 'hint=' + JSON.stringify(M.hintAfter))
  ok('★ 且取消按钮文案变成「放弃改动」（按钮名与动作同判据）',
    (M.ftAfter || []).some((x) => /放弃改动/.test(x)), JSON.stringify(M.ftAfter))
  ok('第二次点才真的关', M.afterCancel3 === 0, '残留=' + M.afterCancel3)
  ok('Esc 能关（无改动时）', M.escBefore === 1 && M.escAfter === 0,
    'before=' + M.escBefore + ' after=' + M.escAfter +
    ' 弹窗已就位=' + M.escOpenWait + 'ms 派发时焦点=' + ((M.escPre && M.escPre.focusTag) || '?') +
    ' 在弹窗内=' + (M.escPre && M.escPre.focusInModal))

  console.log('\n-- ④b 「更多字段」--')
  ok('「更多字段」按钮可展开', MM.open && MM.open.ok === true, JSON.stringify(MM.open))
  ok('展开后出现 6 个附加字段', MM.snap.moreExists === true && MM.snap.moreLabels.length === 6, JSON.stringify(MM.snap.moreLabels))
  ok('含 `input[list="sup-settle-list"]` 且 datalist **真存在**',
    MM.snap.settleDatalistId === 'sup-settle-list' && MM.snap.settleDatalistExists === true,
    'id=' + MM.snap.settleDatalistId + ' exists=' + MM.snap.settleDatalistExists + ' options=' + MM.snap.settleDatalistOptions)

  console.log('\n-- ⑥ Rebate 入口：「那句提示点过去真的能到」--')
  ok('Rebate 页切到「返利结算」页签成功（`.cf-jump` 就在该页签的合同弹窗里）',
    JM.tabSwitch && JM.tabSwitch.clicked === true, JSON.stringify(JM.tabSwitch && JM.tabSwitch.texts))
  ok('「+ 录入年度合同」按钮存在且被点中（进入合同向导）',
    JM.clickInfo && JM.clickInfo.clicked === true, JSON.stringify(JM.clickInfo && (JM.clickInfo.label || JM.clickInfo.candidates)))
  ok('合同向导弹窗已打开且停在 Step 1', JM.modalOpen === true && JM.step1 === true, 'modal=' + JM.modalOpen + ' step1=' + JM.step1)
  ok('★ 页面上确实渲染出了 `.cf-jump`（真按钮，不是死文案）', JM.count >= 1,
    JM.count + ' 个：' + JSON.stringify(JM.texts))
  ok('★ `.cf-jump` 样式是链接形态（下划线 + 手型指针）',
    (JM.styles || []).length >= 1 && (JM.styles || []).every((s) => /underline/.test(s.deco) && s.cursor === 'pointer'),
    JSON.stringify((JM.styles || [])[0] || {}))
  ok('点它之后 hash **真的变了**（不是白屏、不是原地不动）',
    JM.jumpClick && JM.jumpClick.clicked === true && nz(TG.hash) !== '#/rebate',
    'clicked="' + (JM.jumpClick && JM.jumpClick.text) + '" hash=' + TG.hash)
  ok('★ 目标档案页**真的渲染出来了**（有正文、有标题、有激活页签）',
    TG.hasApp === true && nz(TG.bodyLen) > 100 && nz(TG.h2).length >= 2,
    'h2=' + JSON.stringify(TG.h2) + ' tabActive=' + JSON.stringify(TG.tabActive) + ' bodyLen=' + TG.bodyLen + ' wait=' + JM.waitMs + 'ms')
  ok('落到的是**档案管理容器**下的页签（页签条激活项非空）',
    nz(TG.tabActive).length >= 2, 'tabActive=' + JSON.stringify(TG.tabActive))
  ok('判别力：跳转不是被 `canSee` 拦下改弹 toast（无权限类 toast）',
    !(TG.toasts || []).some((t) => /没有访问/.test(t)), JSON.stringify((TG.toasts || []).slice(0, 3)))

  console.log('\n-- ⑦ 零写入 + 控制台错误 --')
  const WRITE_RISK = /save|contacts|bulk|upsert|import|execute|close|delete|create|submit|update|password|logout/i
  const allW = (T.writes || []).filter((w) => WRITE_RISK.test(w))
  const wAfter = (TG.writesAfterJump || []).filter((w) => WRITE_RISK.test(w))
  ok('★ 零写入：全程未发出业务写请求', allW.length === 0 && wAfter.length === 0,
    allW.length || wAfter.length ? JSON.stringify([...allW, ...wAfter].slice(0, 5)) : '0 条')
  const errs = [...(T.pageErrors || []), ...(T.pageErrors2 || [])]
    .filter((e) => !/favicon|404 \(Not Found\)/i.test(e))
  ok('控制台错误 / 未捕获异常 **0** 条（A/B 两相合并）', errs.length === 0, errs.length ? JSON.stringify(errs.slice(0, 3)) : '0 条')
  const badToast = (T.toasts || []).filter((t) => /失败|错误|异常/.test(t))
  ok('无错误类 toast（如「加载供应商失败」）', badToast.length === 0, badToast.length ? JSON.stringify(badToast) : '0 条')

  console.log('\n===== 收尾注销 =====')
  const r = await call('POST', '/api/auth/logout', token, {})
  let body = {}; try { body = JSON.parse(r.text) } catch { /* ignore */ }
  ok('注销回执 success=true（判据取响应体，不看状态码）', body.success === true, 'status=' + r.status)

  const fail = R.filter((x) => !x.ok).length
  console.log('\n============================================')
  console.log('通过 ' + (R.length - fail) + ' 项，失败 ' + fail + ' 项（共 ' + R.length + '）')
  console.log('============================================')
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error('探针异常：', (e && e.message) || e); process.exit(2) })
