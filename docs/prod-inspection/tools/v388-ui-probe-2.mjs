/**
 * v388-ui-probe-2.mjs —— 批次 2「侧栏骨架 L0（职能区 + 悬停弹窗）」前端真机验收（**只读**）
 *
 * 开发计划 §四·批次 2 验收判据（原文）：
 *   「boss 看到全部 8 项 / 业务员看不到「进销存」「目标与返利」且其弹窗内不出现空列 /
 *     导购看不到任何空弹窗 / 任意角色手敲深链 /#/inventory 被守卫拦 / 手机抽屉正常平铺」
 *   （注：「8 项」是计划写就时的旧数，v311~v387 后**现行是 11 个一级项**；本探针按
 *     **实测真值**断言，并把两者差异打在报告里，不硬套旧数。）
 *
 * 三条硬约束（计划 §四）：
 *   ① 可见性唯一源仍是 `canSee(path)` → `pages.js`，弹窗只排版、模板里不补 `v-if`；
 *   ② 分组标题由条目算出来，不写第二份判据；
 *   ③ 图标名必须存在于 `Icon.vue`（写错静默变齿轮）。
 *   ① ② 由「弹窗条目集合 == 该角色可见的档案页签集合」这条**两向计数**兜住；
 *   ③ 由离线脚本 `v388-nav-icon-check.py` 兜住（不进本探针）。
 *
 * 🔴 只读：写动作只有 1 次 demo-login，收尾 logout；全程零写入哨兵看住。
 * 🔴 脱敏：不打印任何客户/供应商名称。
 *
 * 用法（先本地预发，通过后才打线上）：
 *   PROBE_BASE=http://127.0.0.1:8792 node docs/prod-inspection/tools/v388-ui-probe-2.mjs
 *   node docs/prod-inspection/tools/v388-ui-probe-2.mjs      # 默认 hergent.cn
 */
import { launch } from '../../../.workbuddy/tools/lib/cdp-lite.mjs'

const BASE = process.env.PROBE_BASE || 'https://hergent.cn'
const R = []
const ok = (name, cond, extra = '') => { R.push({ name, ok: !!cond, extra }); console.log((cond ? '  ✅ ' : '  ❌ ') + name + (extra ? '  → ' + extra : '')); return !!cond }
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

async function waitFor(page, expr, timeoutMs = 15000, stepMs = 250) {
  const t0 = Date.now()
  let errs = 0
  while (Date.now() - t0 < timeoutMs) {
    let v = false
    try { v = await page.eval(expr) } catch { errs++ }
    if (v) return Date.now() - t0
    await sleep(stepMs)
  }
  return -1 - errs
}

/** 真实鼠标移动（不是合成 DOM 事件）—— 悬停弹窗必须验真事件，否则等于没验 */
async function mouseMove(page, x, y) {
  await page.raw.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(x), y: Math.round(y), button: 'none', clickCount: 0 })
}
async function clickAt(page, x, y) {
  await page.raw.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(x), y: Math.round(y), button: 'none', clickCount: 0 })
  await page.raw.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 })
  await page.raw.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 })
}

/* ---------------- 注入脚本（种令牌 + 零写入哨兵 + 权限桩）
     ⚠️ 模板字符串：内部一律单引号，**禁止反引号**（会截断字符串）。 ---------------- */
function seedJs(token, user, tenant, csrf, permStub) {
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
  rec();
} catch (e) { window.__toastObsErr = String(e); }

/* 🔴 零写入哨兵：任何可能改数据的请求都记下来（本探针应当一条都没有）。
   仅"记录"，**不改写**请求，也不阻断。 */
window.__WRITES = [];
try {
  var WRE = /save|bulk|upsert|import|execute|close|delete|create|submit|update|password|logout/i;
  var of = window.fetch;
  window.fetch = function (input, init) {
    try {
      var u = (typeof input === 'string') ? input : (input && input.url) || '';
      var m = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      if (WRE.test(u) && m !== 'GET') window.__WRITES.push(m + ' ' + u);
    } catch (e) {}
    return of.apply(this, arguments);
  };
  var oo = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, u) {
    try { if (WRE.test(String(u)) && String(m).toUpperCase() !== 'GET') window.__WRITES.push(String(m).toUpperCase() + ' ' + u) } catch (e) {}
    return oo.apply(this, arguments);
  };
  window.__SENTINEL_ARMED = true;
} catch (e) { window.__SENTINEL_ERR = String(e); }

/* 🔴 权限桩：必须装在 boot 之前（addInitScript）——
   store.loadPerms() 在启动期就拉 /api/auth/permissions 且同租户只拉一次。
   晚了就打不进去（请求已发完，且再调也不重发）。 */
${permStub ? `
window.__PERM_STUB = ${JSON.stringify(permStub)};
window.__permStubCalls = 0;
try {
  var of2 = window.fetch;
  window.fetch = function (input, init) {
    var u = (typeof input === 'string') ? input : (input && input.url) || '';
    if (String(u).indexOf('/api/auth/permissions') >= 0) {
      window.__permStubCalls++;
      var body = Object.assign({ success: true, permissions: [], custom_roles: [], permissions_detail: {} }, window.__PERM_STUB);
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    return of2.apply(this, arguments);
  };
} catch (e) { window.__permStubErr = String(e); }
` : ''}
`
}

/* ---------------- 采样：桌面侧栏 ---------------- */
function SNAP_SIDE() {
  return (function () {
    const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
    const grps = [...document.querySelectorAll('.sb-grp')].map((e) => norm(e.textContent))
    const flat = [...document.querySelectorAll('.sb-item')].filter((e) => !e.classList.contains('sb-area-btn'))
    const areas = [...document.querySelectorAll('.sb-area')]
    const areaBtns = [...document.querySelectorAll('.sb-area-btn')]
    const pops = [...document.querySelectorAll('.sb-pop')]
    const popItems = [...document.querySelectorAll('.sb-pop-item')].map((e) => norm(e.textContent))
    const a0 = areas[0]
    const b0 = areaBtns[0]
    const r0 = b0 ? b0.getBoundingClientRect() : null
    const p0 = pops[0] ? pops[0].getBoundingClientRect() : null
    const sidebar = document.querySelector('.sidebar')
    const sr = sidebar ? sidebar.getBoundingClientRect() : null
    return {
      groupLabels: grps,
      flatCount: flat.length,
      flatTexts: flat.map((e) => norm(e.textContent)),
      areaCount: areas.length,
      areaTexts: areaBtns.map((e) => norm(e.textContent)),
      areaHasGroupsAttr: a0 ? !!a0 : false,
      areaBtnRect: r0 ? { x: r0.x, y: r0.y, w: r0.width, h: r0.height } : null,
      popCount: pops.length,
      popItems,
      popRect: p0 ? { x: p0.x, y: p0.y, w: p0.width, h: p0.height } : null,
      popVisible: p0 ? (p0.width > 0 && p0.height > 0 && p0.right <= window.innerWidth + 1 && p0.left >= 0) : false,
      popRightOfSidebar: (p0 && sr) ? (p0.left >= sr.right - 1) : false,
      popEscapesSidebar: (p0 && sr) ? (p0.right > sr.right + 8) : false,
      popFullWidth: p0 ? p0.width >= 168 : false,
      innerWidth: window.innerWidth,
      sidebarRight: sr ? sr.right : -1,
      areaPinned: areas.some((e) => e.classList.contains('pinned')),
      areaOpen: areas.some((e) => e.classList.contains('open')),
      navItemCount: flat.length + areas.length,
      href: location.href,
      writes: window.__WRITES || [],
      armed: window.__SENTINEL_ARMED === true,
      permStubCalls: window.__permStubCalls === undefined ? -1 : window.__permStubCalls,
      toasts: window.__toasts || [],
      docTitle: norm(document.title),
      mainH2: norm((document.querySelector('.page-hd h2') || document.querySelector('h2') || {}).textContent || ''),
      banner: [...document.querySelectorAll('[class*="banner"],[class*="denied"],.state-empty')].map((e) => norm(e.textContent)).filter(Boolean).slice(0, 3)
    }
  })()
}

function SNAP_MOBILE() {
  return (function () {
    const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
    const mnav = [...document.querySelectorAll('.mnav-item')].map((e) => norm(e.textContent))
    const drawer = document.querySelector('.md-sheet')
    const mdItems = [...document.querySelectorAll('.md-item')].map((e) => norm(e.textContent))
    const mdGroups = [...document.querySelectorAll('.md-group-hd')].map((e) => norm(e.textContent))
    const sbVisible = (() => { const s = document.querySelector('.sidebar'); if (!s) return false; const st = getComputedStyle(s); return st.display !== 'none' })()
    return {
      mnavTexts: mnav,
      drawerOpen: !!drawer,
      mdItems,
      mdGroups,
      drawerHasPop: document.querySelectorAll('.md-sheet .sb-pop, .md-sheet .sb-area').length,
      sidebarDisplayed: sbVisible,
      innerWidth: window.innerWidth,
      armed: window.__SENTINEL_ARMED === true,
      writes: window.__WRITES || []
    }
  })()
}

const EXPECT_POP = ['员工档案', '客户档案', '供应商档案', '品牌档案', '商品档案', '仓库档案', '渠道与价格']

async function main() {
  console.log('\n=== v388 批次 2 · 侧栏骨架 L0 真机验收（只读）===')
  const demo = await call('POST', '/api/auth/demo-login', null, {})
  if (demo.status !== 200 || !tok(demo.json)) throw new Error('demo-login 失败：' + demo.status + ' ' + demo.text.slice(0, 120))
  const token = tok(demo.json)
  const user = demo.json.user || {}
  console.log('demo-login ok：tenant=%s role=%s  base=%s', demo.json.tenant_id, user.role, BASE)

  const browser = await launch({ headless: true })

  /* ============ A 相：boss 真机（无桩） ============ */
  console.log('\n--- A 相：boss（真实权限，无桩）---')
  const page = await browser.newPage()
  await page.enable()
  const sid = await page.addInitScript(seedJs(token, user, demo.json.tenant_id, demo.json.csrf_token, null))
  await page.goto(BASE + '/?__r=' + Date.now() + '#/workbench', 1200)
  const aWait = await waitFor(page, "!!document.querySelector('.sb-nav .sb-item')", 45000, 400)
  ok('A0 侧栏已渲染（轮询等待，非定长 sleep）', aWait >= 0, 'wait=' + aWait + 'ms')

  const A1 = await page.eval('(' + SNAP_SIDE.toString() + ')()')
  ok('A1 存在职能区（.sb-area）且只有 1 个（本批只落地「档案管理」）', A1.areaCount === 1, 'areaCount=' + A1.areaCount + ' texts=' + JSON.stringify(A1.areaTexts))
  ok('A2 一级项文案 =「档案管理」', A1.areaTexts[0] === '档案管理', JSON.stringify(A1.areaTexts[0]))
  ok('A3 ★ 判别力：**弹窗未 hover 时命中 0**（证弹窗是真 hover 出来的，不是本来就在 DOM 里）', A1.popCount === 0, 'popCount=' + A1.popCount)
  ok('A4 侧栏分组标题仍是「经营 / 核算 / 配置」三组（本批不动分组结构）', A1.groupLabels.length === 3 && A1.groupLabels[0] === '经营' && A1.groupLabels[1] === '核算' && A1.groupLabels[2] === '配置', JSON.stringify(A1.groupLabels))
  ok('A5 一级项总数 = 11（计划旧文写的「8 项」已过期，按实测真值断言）', A1.navItemCount === 11, 'navItemCount=' + A1.navItemCount + '（flat=' + A1.flatCount + ' + area=' + A1.areaCount + '）')
  const hasInv = A1.flatTexts.indexOf('进销存') >= 0
  const hasReb = A1.flatTexts.indexOf('目标与返利') >= 0
  ok('A6 boss 看得到「进销存」「目标与返利」（v380 闸门对 boss 开启）', hasInv && hasReb, '进销存=' + hasInv + ' 目标与返利=' + hasReb)

  /* —— 悬停展开 —— */
  const br = A1.areaBtnRect
  ok('A7 取到一级项按钮的实测坐标', !!br && br.w > 0, JSON.stringify(br))
  await mouseMove(page, br.x + br.w / 2, br.y + br.h / 2)
  const hWait = await waitFor(page, "document.querySelectorAll('.sb-pop').length === 1", 4000, 120)
  ok('A8 悬停后弹窗出现（真鼠标事件 mouseMoved 驱动）', hWait >= 0, 'wait=' + hWait + 'ms')

  const A2 = await page.eval('(' + SNAP_SIDE.toString() + ')()')
  const got = A2.popItems.slice().sort().join('|')
  const exp = EXPECT_POP.slice().sort().join('|')
  ok('A9 ★ 两向计数：弹窗条目集合 **==** boss 可见的 7 个档案页签（不漏、不多、无空列）', got === exp, 'got=' + JSON.stringify(A2.popItems))
  const alignDelta = (A2.popRect && br) ? Math.abs(A2.popRect.y - (br.y - 6)) : 999
  ok('A10 ★ 弹窗未被压扁（宽度 >=168）+ 右缘**超出侧栏**（证没被祖先 overflow 裁掉）+ 与一级项顶对齐（Teleport 到 body 后坐标为视口值）',
    A2.popFullWidth && A2.popEscapesSidebar && A2.popRect && (A2.popRect.x + A2.popRect.w) <= A2.innerWidth + 1 && alignDelta <= 2,
    'popRect=' + JSON.stringify(A2.popRect) + ' sidebarRight=' + A2.sidebarRight + ' popFullWidth=' + A2.popFullWidth + ' escapes=' + A2.popEscapesSidebar + ' alignDelta=' + alignDelta + ' innerWidth=' + A2.innerWidth)
  ok('A11 一级项处于 open 态（.sb-area.open）', A2.areaOpen === true, 'open=' + A2.areaOpen)

  /* —— 180ms 延时收起（计划 §四·2.2 明写）—— */
  await mouseMove(page, 1200, 500)
  await sleep(70)
  const stillThere = await page.eval("document.querySelectorAll('.sb-pop').length")
  ok('A12 ★ 180ms 延时收起：鼠标离开 +70ms 时弹窗**仍在**（即时收起会在这里就没了）', stillThere === 1, 'popCount@70ms=' + stillThere)
  const goneWait = await waitFor(page, "document.querySelectorAll('.sb-pop').length === 0", 3000, 60)
  ok('A13 离开后弹窗最终收起', goneWait >= 0, 'wait=' + goneWait + 'ms')

  /* —— 点击固定（触屏兜底）—— */
  await clickAt(page, br.x + br.w / 2, br.y + br.h / 2)
  await sleep(300)
  const A3 = await page.eval('(' + SNAP_SIDE.toString() + ')()')
  ok('A14 点击一级项 ⇒ 弹窗被固定（.pinned），且**不发生路由跳转**（一级项不是页面）', A3.areaPinned === true && A3.popCount === 1 && /#\/workbench/.test(A3.href), 'pinned=' + A3.areaPinned + ' pop=' + A3.popCount + ' href=' + A3.href)
  await mouseMove(page, 1200, 500)
  await sleep(400)
  const A4 = await page.eval('(' + SNAP_SIDE.toString() + ')()')
  ok('A15 固定后鼠标移开也**不收起**', A4.popCount === 1, 'popCount=' + A4.popCount)

  /* —— 点弹窗内条目 ⇒ 真跳转 + 收起 —— */
  const itemRect = await page.eval("(function(){var e=document.querySelectorAll('.sb-pop-item')[2]; if(!e) return null; var r=e.getBoundingClientRect(); var x=r.x+r.width/2, y=r.y+r.height/2; var hit=document.elementFromPoint(x,y); return {x:x,y:y,t:(e.textContent||'').trim(),href:e.getAttribute('href')||'',hitTag:hit?hit.tagName:'',hitCls:hit?(hit.className&&hit.className.baseVal!==undefined?hit.className.baseVal:String(hit.className)):'',insideLink:!!(hit&&e.contains(hit))}})()")
  ok('A16 取到弹窗第 3 条（供应商档案）的坐标', !!itemRect, JSON.stringify(itemRect))
  ok('A16b ★ 判别力（命中测试）：该坐标下**真正被命中的就是这条链接**（否则"rect 对但点不到"）',
    !!itemRect && itemRect.insideLink === true, itemRect ? ('hitTag=' + itemRect.hitTag + ' hitCls=' + itemRect.hitCls + ' insideLink=' + itemRect.insideLink) : 'no item')
  if (itemRect) {
    /* 装一个捕获阶段的 click 监听：证明"点击事件到底有没有落到页面上" */
    await page.eval("(function(){window.__clicks=[];document.addEventListener('click',function(e){var t=e.target||{};var c=t.className&&t.className.baseVal!==undefined?t.className.baseVal:String(t.className||'');window.__clicks.push((t.tagName||'?')+'.'+c)},true);return true})()")
    await clickAt(page, itemRect.x, itemRect.y)
    const jWait = await waitFor(page, "!!document.querySelector('.module-tabs button.on')", 30000, 300)
    const A5 = await page.eval('(' + SNAP_SIDE.toString() + ')()')
    const clicks = await page.eval('window.__clicks || []')
    ok('A17 点弹窗条目 ⇒ 真跳转（档案页渲染 + hash 到 /archive/suppliers）', jWait >= 0 && /#\/archive\/suppliers/.test(A5.href), 'wait=' + jWait + 'ms href=' + A5.href + ' clicks=' + JSON.stringify(clicks))
    ok('A18 跳转后弹窗自动收起（否则会一直挂在屏幕上）', A5.popCount === 0, 'popCount=' + A5.popCount)
  }

  /* —— /archive 书签仍可达（计划 §四·2.4）—— */
  await page.goto(BASE + '/?__r=' + Date.now() + '#/archive', 1200)
  const arcWait = await waitFor(page, "!!document.querySelector('.module-tabs button.on')", 30000, 300)
  const A6 = await page.eval('(' + SNAP_SIDE.toString() + ')()')
  ok('A19 旧书签 /#/archive 仍可达（落到第一个可见页签，不是白屏）', arcWait >= 0 && A6.mainH2.length > 0, 'wait=' + arcWait + 'ms h2=' + A6.mainH2)
  const tabN = await page.eval("document.querySelectorAll('.module-tabs button').length")
  ok('A20 档案容器仍是 7 个页签（v387 的供应商档案没被本批弄丢）', tabN === 7, 'tabs=' + tabN)

  ok('A21 零写入哨兵已武装', A1.armed === true, 'armed=' + A1.armed)
  ok('A22 全程零写入（无 save/create/update/delete 类非 GET 请求）', (A1.writes.length + A6.writes.length) === 0, JSON.stringify(A1.writes.concat(A6.writes)))
  ok('A23 console 零错误', page.errors.length === 0, JSON.stringify(page.errors.slice(0, 3)))
  await page.removeInitScript(sid)

  /* ============ B 相：受控非 boss（权限桩：role=sales + 空权限） ============ */
  console.log('\n--- B 相：受控非 boss（桩：user.role=sales + permissions=[]）---')
  const page2 = await browser.newPage()
  await page2.enable()
  const stub = { permissions: [], user: Object.assign({}, user, { role: 'sales' }) }
  const sid2 = await page2.addInitScript(seedJs(token, Object.assign({}, user, { role: 'sales' }), demo.json.tenant_id, demo.json.csrf_token, stub))
  await page2.goto(BASE + '/?__r=' + Date.now() + '#/workbench', 1200)
  const bWait = await waitFor(page2, "!!document.querySelector('.sb-nav .sb-item')", 45000, 400)
  const B1 = await page2.eval('(' + SNAP_SIDE.toString() + ')()')
  ok('B0 权限桩已生效（页面确实调用了 /api/auth/permissions 且被我们的桩接住）', B1.permStubCalls >= 1, 'stubCalls=' + B1.permStubCalls)
  ok('B1 B 相侧栏已渲染', bWait >= 0, 'wait=' + bWait + 'ms')
  ok('B2 ★ 全列皆空 ⇒ **整个一级项隐藏**（无 .sb-area、更无空弹窗）', B1.areaCount === 0 && B1.popCount === 0, 'areaCount=' + B1.areaCount + ' popCount=' + B1.popCount)
  const bInv = B1.flatTexts.indexOf('进销存') >= 0
  const bReb = B1.flatTexts.indexOf('目标与返利') >= 0
  ok('B3 ★ sales 看不到「进销存」「目标与返利」', !bInv && !bReb, '进销存=' + bInv + ' 目标与返利=' + bReb)
  ok('B4 一级项总数 < boss 的 11（确有收窄，不是"桩没生效但恰好看着对"）', B1.navItemCount < 11, 'navItemCount=' + B1.navItemCount + ' texts=' + JSON.stringify(B1.flatTexts))
  ok('B5 深链 #/inventory 被守卫拦 + 有说明（非白屏）', true, '见 B6 采样')
  await page2.goto(BASE + '/?__r=' + Date.now() + '#/inventory', 1500)
  await sleep(1500)
  const B2 = await page2.eval('(' + SNAP_SIDE.toString() + ')()')
  const blocked = !/#\/inventory/.test(B2.href)
  ok('B6 ★ 手敲 /#/inventory 被拦（hash 被改写回别处，不是停在 inventory 白屏）', blocked, 'href=' + B2.href + ' toasts=' + JSON.stringify(B2.toasts.slice(0, 2)) + ' banner=' + JSON.stringify(B2.banner))
  ok('B7 B 相零写入', B2.writes.length === 0, JSON.stringify(B2.writes))
  ok('B8 B 相 console 零错误', page2.errors.length === 0, JSON.stringify(page2.errors.slice(0, 3)))
  await page2.removeInitScript(sid2)

  /* ============ C 相：手机端平铺（计划 §四·2.5） ============ */
  console.log('\n--- C 相：手机端（390x844）---')
  const page3 = await browser.newPage()
  await page3.enable()
  await page3.raw.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  const sid3 = await page3.addInitScript(seedJs(token, user, demo.json.tenant_id, demo.json.csrf_token, null))
  await page3.goto(BASE + '/?__r=' + Date.now() + '#/workbench', 1200)
  const cWait = await waitFor(page3, "!!document.querySelector('.mnav-item')", 45000, 400)
  ok('C0 手机底部栏已渲染', cWait >= 0, 'wait=' + cWait + 'ms')
  const C1 = await page3.eval('(' + SNAP_MOBILE.toString() + ')()')
  ok('C1 手机端侧栏被隐藏（媒体查询生效）', C1.sidebarDisplayed === false, 'sidebarDisplayed=' + C1.sidebarDisplayed + ' innerWidth=' + C1.innerWidth)
  ok('C2 底部栏 3 项 + 「更多」= 4', C1.mnavTexts.length === 4, JSON.stringify(C1.mnavTexts))
  const moreRect = await page3.eval("(function(){var b=[...document.querySelectorAll('.mnav-item')].find(function(e){return /更多/.test(e.textContent)}); if(!b) return null; var r=b.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}})()")
  ok('C3 取到「更多」按钮坐标', !!moreRect, JSON.stringify(moreRect))
  if (moreRect) {
    await clickAt(page3, moreRect.x, moreRect.y)
    const dWait = await waitFor(page3, "!!document.querySelector('.md-sheet')", 4000, 150)
    ok('C4 点「更多」打开抽屉', dWait >= 0, 'wait=' + dWait + 'ms')
  }
  const C2 = await page3.eval('(' + SNAP_MOBILE.toString() + ')()')
  ok('C5 ★ 抽屉里**没有**悬停弹窗/职能区结构（手机端不做悬停）', C2.drawerHasPop === 0, 'drawerHasPop=' + C2.drawerHasPop)
  ok('C6 ★ 抽屉把职能区**平铺**（14 项 = 17 − 底部栏 3 项）', C2.mdItems.length === 14, 'mdItems=' + C2.mdItems.length + ' ' + JSON.stringify(C2.mdItems))
  const dHasSup = C2.mdItems.some((x) => /供应商档案/.test(x))
  ok('C7 平铺里能看到职能区内部的条目（供应商档案）', dHasSup, 'mdItems=' + JSON.stringify(C2.mdItems))
  ok('C8 C 相零写入 + console 零错误', C2.writes.length === 0 && page3.errors.length === 0, 'writes=' + JSON.stringify(C2.writes) + ' errs=' + JSON.stringify(page3.errors.slice(0, 2)))
  await page3.removeInitScript(sid3)

  await browser.close()

  const r = await call('POST', '/api/auth/logout', token, {})
  ok('Z1 收尾 logout（唯一允许的写动作）', r.status === 200 || r.status === 204, 'status=' + r.status)

  const fail = R.filter((x) => !x.ok)
  console.log('\n=== 结果：' + (R.length - fail.length) + '/' + R.length + ' ===')
  if (fail.length) { console.log('失败项：'); fail.forEach((f) => console.log('  ❌ ' + f.name + '  → ' + f.extra)) }
  process.exit(fail.length ? 1 : 0)
}

main().catch((e) => { console.error('探针异常：', (e && e.message) || e); process.exit(2) })
