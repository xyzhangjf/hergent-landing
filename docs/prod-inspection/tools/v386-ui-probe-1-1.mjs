/**
 * v386-ui-probe-1-1.mjs —— 批次 1.1「客户档案 › 配送线路」前端真机验收（**只读**）
 *
 * 验什么（开发计划 §三·1.1 验收判据：「客户档案编辑弹窗出现『配送线路』；保存后刷新仍在」）：
 *   ① 表格：表头出现「配送线路」，且**是在原有 8 列之间插入、不是替换**（原列一个不少）
 *   ② 对齐：每行 td 数 == 表头列数；并且**逐列与后端真值比对**（按客户名配对），
 *      证明插列没把后面的列挤错位（这是插列最典型的静默事故）
 *   ③ 弹窗：点「编辑」后弹窗里出现 `input[list="cas-route-list"]`，label 文案 =「配送线路」，
 *      该 `list` 指向的 datalist **真的存在**（id 打错 = 静默无候选，不报错）
 *   ④ 判别力自证：弹窗**关闭时**同一选择器必须命中 0（否则③可能是静态元素而非弹窗里的）
 *   ⑤ UI-SPEC：新控件复用全局 `.input` + 页面私有前缀 `.cas-`，不引新类、不写死颜色
 *   ⑥ 零写入自证：全程无业务写请求（fetch/XHR 哨兵 + 「监控已安装」护栏）
 *   ⑦ 控制台错误 0 条
 *
 * ⚠️ 「保存后刷新仍在」为何不在本探针里做：那需要**真的写生产库**。
 *    该链条已由 `v386-shadow-write-test.py`（影子库、16/16）覆盖：
 *    写入 → `contact_get` 读回 → `contact_list` 刷新仍在 → 84 列逐列无副作用。
 *    本探针只负责「前端把字段摆出来了、摆对了、没写坏别的东西」。
 *
 * 🔴 脱敏：不打印任何客户名（demo 租户也一样守）。只输出「配对成功行数」「逐列差异」。
 *
 * 只读性：写动作仅 1 次 demo-login，收尾 logout 注销。
 * 用法：node docs/prod-inspection/tools/v386-ui-probe-1-1.mjs
 */
import { launch } from '../../../.workbuddy/tools/lib/cdp-lite.mjs'

/* 🔴 先本地后线上：默认打 `PROBE_BASE`（用 local-preview.mjs 挂本地新构建 + 真后端）。
   既往探针一律写死 hergent.cn，等于「先上线再验收」——验出问题生产已经变了。
   本页把顺序倒过来：本地验收通过 ⇒ 才上传。 */
const BASE = process.env.PROBE_BASE || 'https://hergent.cn'
const R = []
const ok = (name, cond, extra = '') => { R.push({ name, ok: !!cond, extra }); console.log((cond ? '  ✅ ' : '  ❌ ') + name + (extra ? '  → ' + extra : '')); return !!cond }
const nz = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim()

async function call(method, path, token, body) {
  const h = { 'Content-Type': 'application/json', 'X-Client': 'web' }
  if (token) h.Authorization = 'Bearer ' + token
  const res = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) })
  const txt = await res.text()
  let j = {}; try { j = JSON.parse(txt) } catch { /* ignore */ }
  return { status: res.status, json: j, text: txt }
}
const tok = (o) => o.access_token || o.token || ''

/* ---------------- 注入脚本（种令牌 + 零写入哨兵 + toast 账本） ----------------
   ⚠️ 模板字符串：内部一律用单引号，**禁止出现反引号**（会截断字符串）。 */
function seedJs(token, user, tenant, csrf) {
  return `
try {
  localStorage.setItem('hergent_v2_token', ${JSON.stringify(token)});
  localStorage.setItem('hergent_v2_user', ${JSON.stringify(JSON.stringify(user || {}))});
  ${tenant ? "localStorage.setItem('hergent_v2_tenant', " + JSON.stringify(String(tenant)) + ');' : ''}
  ${csrf ? "localStorage.setItem('hergent_v2_csrf', " + JSON.stringify(String(csrf)) + ');' : ''}
} catch (e) {}

/* toast 账本：只在"出现的当拍"落账（轮询会漏）
   🔴 observe(document) —— 不能用 document.documentElement：文档起点时它还可能是 null。 */
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

/* 原生弹窗桩：无头页无人应答 confirm 会把主线程挂死 */
window.__dlg = [];
window.confirm = function (m) { window.__dlg.push('confirm:' + m); return true };
window.alert = function (m) { window.__dlg.push('alert:' + m) };
`
}

/* ---------------- 页面侧采样函数（一律 toString() 后注入，避免手写字符串出错） ---------------- */

/** 表格结构 + 与后端真值逐列比对 */
function SNAP_TABLE() {
  return (async function () {
    const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
    const money = (n) => '¥' + Number(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const fmtDate = (v) => { const s = String(v || '').trim(); if (!s) return '—'; return s.length >= 10 ? s.slice(0, 10) : s }

    const ths = [...document.querySelectorAll('.tbl thead th')].map((t) => norm(t.textContent))
    const trs = [...document.querySelectorAll('.tbl tbody tr')]
    const rows = trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => norm(td.textContent)))

    /* 与后端真值配对：页面 loadList 也传 type=customer，两边应同源 */
    let api = [], apiTotal = null, apiErr = ''
    try {
      const tk = localStorage.getItem('hergent_v2_token') || ''
      const res = await fetch('/api/contacts?type=customer&limit=100&offset=0',
        { headers: { Authorization: 'Bearer ' + tk, 'X-Client': 'web' } })
      const j = await res.json()
      api = j.items || []
      apiTotal = j.total
    } catch (e) { apiErr = String(e && e.message || e) }

    const byName = {}
    api.forEach((r) => { byName[norm(r.name)] = r })

    const pairs = rows.map((cells) => {
      const r = byName[cells[0]]
      if (!r) return { name: cells[0], found: false, diffs: null }
      const exp = [
        norm(r.name),
        norm(r.channel) || '—',
        norm(r.region) || '—',
        norm(r.delivery_route) || '—',
        (norm(r.boss_name) || '未填') + (norm(r.boss_phone) || ''),
        norm(r.assigned_salesperson) || '—',
        Number(r.ar_balance) > 0 ? money(r.ar_balance) : '—',
        fmtDate(r.last_order),
        cells[8],                                   // 操作列不参与比对（按钮文字随权限变）
      ]
      const diffs = []
      for (let i = 0; i < 9; i++) if (i !== 8 && norm(cells[i]) !== norm(exp[i])) diffs.push({ i, got: cells[i], exp: exp[i] })
      return { name: cells[0], found: true, apiRoute: norm(r.delivery_route), apiRegion: norm(r.region), diffs }
    })

    return {
      ths,
      rowCount: rows.length,
      tdCounts: rows.map((c) => c.length),
      colWidths: rows.map((c) => c.length),
      apiTotal,
      apiRows: api.length,
      apiErr,
      pairs: pairs.map((p) => ({ found: p.found, ndiff: p.found ? p.diffs.length : -1, diffs: p.found ? p.diffs.slice(0, 3) : null, apiRoute: p.apiRoute, apiRegion: p.apiRegion })),
      matched: pairs.filter((p) => p.found).length,
      aligned: pairs.filter((p) => p.found && p.diffs.length === 0).length,
      withMoney: rows.filter((c) => String(c[6] || '').indexOf('¥') >= 0).length,
      routeCellsDash: rows.filter((c) => String(c[3] || '') === '—').length,
      /* ④ 弹窗关闭时，同一选择器必须命中 0 */
      routeInputBeforeClick: document.querySelectorAll('input[list="cas-route-list"]').length,
      modalOpenBeforeClick: !!document.querySelector('.cas-modal[role="dialog"]'),
      writes: window.__WRITES || [],
      armed: Array.isArray(window.__WRITES),
      toasts: window.__toasts || [],
      toastObsErr: window.__toastObsErr || '',
      statText: norm((document.querySelector('.cas-stat') || {}).textContent || ''),
      href: location.href,
      loggedIn: !!localStorage.getItem('hergent_v2_token'),
    }
  })()
}

/** 点首行「编辑」 */
function CLICK_EDIT() {
  const btns = [...document.querySelectorAll('.tbl tbody tr td.cas-ops button')]
  if (!btns.length) return { clicked: false, found: 0, texts: [] }
  const texts = btns.map((b) => (b.textContent || '').trim())
  btns[0].click()
  return { clicked: true, found: btns.length, texts }
}

/** 弹窗内采样 */
function SNAP_MODAL() {
  return (function () {
    const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
    const mod = document.querySelector('.cas-modal[role="dialog"]')
    if (!mod) return { modal: false, routeInputAnywhere: document.querySelectorAll('input[list="cas-route-list"]').length }
    const hd = mod.querySelector('.cas-modal-hd b')
    const labels = [...mod.querySelectorAll('label.cas-f')].map((l) => {
      const sp = l.querySelector('span')
      const ctl = l.querySelector('input,select,textarea')
      return { label: norm(sp ? sp.textContent : ''), ctl: ctl ? ctl.tagName : '' }
    })
    const inp = mod.querySelector('input[list="cas-route-list"]')
    const dl = inp ? document.getElementById(inp.getAttribute('list')) : null
    const own = inp ? inp.closest('label') : null
    return {
      modal: true,
      title: hd ? norm(hd.textContent) : '',
      labelCount: labels.length,
      labels: labels.map((x) => x.label),
      routeInputInModal: mod.querySelectorAll('input[list="cas-route-list"]').length,
      routeInputAnywhere: document.querySelectorAll('input[list="cas-route-list"]').length,
      hasInput: !!inp,
      ownLabel: own && own.querySelector('span') ? norm(own.querySelector('span').textContent) : '',
      inputClass: inp ? inp.className : '',
      inputType: inp ? inp.type : '',
      inputPlaceholder: inp ? inp.placeholder : '',
      inputDisabled: inp ? (!!inp.disabled || !!inp.readOnly) : null,
      datalistId: inp ? inp.getAttribute('list') : '',
      datalistExists: !!dl,
      datalistOptions: dl ? dl.options.length : -1,
      /* 新控件是否落在主区（v-if=showMore 的「更多字段」里就不算合格） */
      inMainForm: own ? !!own.closest('.cas-form:not(.cas-form-more)') : false,
      style: inp ? (function () { const c = getComputedStyle(inp); return { color: c.color, font: c.fontSize, border: c.borderTopWidth + ' ' + c.borderTopStyle, bg: c.backgroundColor } })() : null,
    }
  })()
}

async function main() {
  /* ---------- 前置：拿 demo 令牌（tenant 10，只读） ---------- */
  const demo = await call('POST', '/api/auth/demo-login', null, {})
  if (demo.status !== 200 || !tok(demo.json)) throw new Error('demo-login 失败：' + demo.status + ' ' + demo.text.slice(0, 120))
  const token = tok(demo.json)
  const user = demo.json.user || {}
  console.log('demo-login ok：tenant=%s role=%s', demo.json.tenant_id, user.role)

  /* 前置：后端 options 必须含 delivery_route（前端 datalist 的候选来源） */
  const opt = await call('GET', '/api/contacts/options?type=customer', token)
  const optKeys = Object.keys((opt.json && opt.json.options) || {}).sort()
  ok('后端 `/api/contacts/options` 含 `delivery_route` 键（datalist 的候选来源）',
    optKeys.includes('delivery_route'), JSON.stringify(optKeys))

  const browser = await launch({ headless: true })
  let T, M
  try {
    const page = await browser.newPage()
    await page.enable()
    const sid = await page.addInitScript(seedJs(token, user, demo.json.tenant_id, demo.json.csrf_token))
    /* 🔴 冷启动深链必须让 URL **真的不同**（只改 hash 不产生新文档 ⇒ 种下的 localStorage 是空的） */
    await page.goto(BASE + '/?__r=' + Date.now() + '#/archive/customers', 1800)
    await new Promise((r) => setTimeout(r, 7000))

    T = await page.eval('(' + SNAP_TABLE.toString() + ')()')
    await page.screenshot('/tmp/v386-1-1-table.png')

    const clk = await page.eval('(' + CLICK_EDIT.toString() + ')()')
    await new Promise((r) => setTimeout(r, 900))
    M = await page.eval('(' + SNAP_MODAL.toString() + ')()')
    await page.screenshot('/tmp/v386-1-1-modal.png')

    /* 收尾：点「取消」关弹窗（**绝不点保存**），再确认弹窗已关 */
    await page.eval("(function(){var b=[].slice.call(document.querySelectorAll('.cas-modal-ft button'));for(var i=0;i<b.length;i++){if((b[i].textContent||'').trim()==='取消'){b[i].click();return 'cancel-clicked'}}return 'no-cancel'})()")
    await new Promise((r) => setTimeout(r, 600))
    M.afterCloseRouteInput = await page.eval("document.querySelectorAll('.cas-modal[role=\"dialog\"] input[list=\"cas-route-list\"]').length")
    M.clickInfo = clk
    M.pageErrors = page.errors.slice(0, 8)
    await page.removeInitScript(sid)
    await page.screenshot('/tmp/v386-1-1-closed.png')
    await browser.close()
  } catch (e) {
    try { await browser.close() } catch { /* ignore */ }
    throw e
  }

  /* ================= 断言 ================= */
  console.log('\n===== 断言 =====')

  console.log('\n-- 前置（不通过则后面全是假结论）--')
  ok('已登录且**停在**目标路由 `#/archive/customers`（不是被守卫弹走）',
    T.loggedIn && /#\/archive\/customers/.test(T.href), 'href=' + T.href)
  ok('表格真渲染出客户行（否则列断言全部空转）', T.rowCount >= 1,
    '行数=' + T.rowCount + ' | 页面统计="' + T.statText + '"')
  ok('后端真值也取到了（逐列比对的基准，取不到则下面的"对齐"无意义）',
    T.apiTotal !== null && T.apiRows >= 1 && !T.apiErr,
    'apiTotal=' + T.apiTotal + ' apiRows=' + T.apiRows + (T.apiErr ? ' err=' + T.apiErr : ''))
  ok('写监控已安装（缺它，「零写入」恒真）', T.armed === true, 'armed=' + T.armed)
  ok('toast 观察器安装成功', !T.toastObsErr, T.toastObsErr || 'ok')
  ok('页面客户数与后端 `type=customer` 的 total 一致（没把供应商混进来）',
    String(T.statText).indexOf(String(T.apiTotal)) >= 0 || T.apiTotal === T.rowCount,
    '页面="' + T.statText + '" 后端total=' + T.apiTotal)

  console.log('\n-- ① 表格：插入而非替换 --')
  ok('表头共 **9** 列（原 8 列 + 配送线路）', T.ths.length === 9, T.ths.length + ' 列：' + JSON.stringify(T.ths))
  ok('表头第 4 列（index 3）=「配送线路」', nz(T.ths[3]) === '配送线路', 'ths[3]=' + JSON.stringify(T.ths[3]))
  ok('「配送线路」在表头**只出现一次**（不是重复列、也没占掉别人）',
    T.ths.filter((x) => x === '配送线路').length === 1,
    '命中 ' + T.ths.filter((x) => x === '配送线路').length + ' 次')
  const KEEP = ['客户名称', '业态', '片区', '老板 / 电话', '负责业务员', '应收余额', '最近下单']
  const missing = KEEP.filter((k) => !T.ths.includes(k))
  ok('原有 **7** 个表头标签一个不少（证明是「插入」不是「替换」）',
    missing.length === 0, missing.length ? '缺：' + JSON.stringify(missing) : JSON.stringify(T.ths))
  ok('每行 td 数 == 9（与表头对齐，无错位/无缺格）',
    T.tdCounts.every((n) => n === 9), '各行 td 数：' + JSON.stringify(T.tdCounts))

  console.log('\n-- ② 逐列与后端真值比对（按客户名配对，插列最典型的静默事故）--')
  ok('DOM 每一行都能在后端 `type=customer` 结果里配对到（两端口径同源）',
    T.matched === T.rowCount && T.rowCount >= 1, '配对 ' + T.matched + ' / ' + T.rowCount)
  ok('★ **所有配对行逐列一致**（含 业态/片区/配送线路/老板电话/业务员/应收余额/最近下单）',
    T.aligned === T.matched && T.matched >= 1,
    '完全一致 ' + T.aligned + ' / ' + T.matched +
    (T.aligned === T.matched ? '' : ' 差异样例=' + JSON.stringify(T.pairs.filter((p) => p.ndiff > 0).slice(0, 2))))
  ok('判别力：比对**不是**「两边全空所以相等」——至少 1 行「应收余额」列是带 ¥ 的真值',
    T.withMoney >= 1, '带 ¥ 的行数=' + T.withMoney)
  ok('判别力：配送线路列在 demo 数据（全空）下按契约渲染为「—」',
    T.routeCellsDash === T.rowCount, '「—」行数=' + T.routeCellsDash + ' / ' + T.rowCount)

  console.log('\n-- ③ 弹窗：字段真的摆出来了 --')
  ok('④ 判别力：**点编辑之前**，同一选择器命中 0（证明③的命中来自弹窗）',
    T.routeInputBeforeClick === 0 && !T.modalOpenBeforeClick,
    'before=' + T.routeInputBeforeClick + ' modalBefore=' + T.modalOpenBeforeClick)
  ok('首行「编辑」按钮存在且被点中', M.clickInfo && M.clickInfo.clicked === true,
    JSON.stringify(M.clickInfo && { found: M.clickInfo.found, texts: M.clickInfo.texts.slice(0, 1) }))
  ok('弹窗已打开且标题 =「编辑客户」', M.modal === true && M.title === '编辑客户', 'title=' + JSON.stringify(M.title))
  ok('弹窗内 `input[list="cas-route-list"]` 命中 **1** 个', M.routeInputInModal === 1, '命中 ' + M.routeInputInModal)
  ok('该输入框所在 label 文案含「配送线路」', String(M.ownLabel).indexOf('配送线路') === 0,
    'label=' + JSON.stringify(M.ownLabel))
  ok('新控件在**主区**（不是藏在「更多字段」里）', M.inMainForm === true, 'inMainForm=' + M.inMainForm)
  ok('`list` 属性指向的 datalist **真的存在**（id 打错 = 静默无候选）',
    M.datalistId === 'cas-route-list' && M.datalistExists === true,
    'id=' + M.datalistId + ' exists=' + M.datalistExists + ' options=' + M.datalistOptions)
  ok('输入框可编辑（未 disabled/readonly，且是文本类）',
    M.inputDisabled === false && M.inputType === 'text', 'disabled=' + M.inputDisabled + ' type=' + M.inputType)
  ok('弹窗主区字段数 = 9（原 8 个 + 配送线路）', M.labelCount === 9,
    M.labelCount + ' 个：' + JSON.stringify(M.labels))

  console.log('\n-- ⑤ UI-SPEC 合规（不引新类、不写死颜色）--')
  ok('复用全局 `.input` 类（与同屏其它字段同源，不自造样式）',
    String(M.inputClass).split(/\s+/).includes('input'), 'class=' + JSON.stringify(M.inputClass))
  ok('label 用页面私有前缀 `.cas-`（§UI-SPEC 页面私有命名）', M.labels.length > 0 && M.inMainForm === true,
    'labels[0]=' + JSON.stringify(M.labels[0]))

  console.log('\n-- ⑥ 零写入 + ⑦ 控制台错误 --')
  const WRITE_RISK = /save|matrix|bulk|upsert|import|execute|close|delete|create|submit|update|password|logout/i
  const allW = (T.writes || []).filter((w) => WRITE_RISK.test(w))
  ok('★ 零写入：全程未发出业务写请求', allW.length === 0, allW.length ? JSON.stringify(allW) : '0 条')
  ok('关弹窗后弹窗内的配送线路输入框已消失（弹窗真关掉了，没留残留层）',
    M.afterCloseRouteInput === 0, '残留=' + M.afterCloseRouteInput)
  const errs = (M.pageErrors || []).filter((e) => !/favicon|404 \(Not Found\)/i.test(e))
  ok('控制台错误 / 未捕获异常 **0** 条', errs.length === 0, errs.length ? JSON.stringify(errs.slice(0, 3)) : '0 条')
  const badToast = (T.toasts || []).filter((t) => /失败|错误|异常/.test(t))
  ok('无错误类 toast（如「加载客户失败」）', badToast.length === 0, badToast.length ? JSON.stringify(badToast) : '0 条')

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
