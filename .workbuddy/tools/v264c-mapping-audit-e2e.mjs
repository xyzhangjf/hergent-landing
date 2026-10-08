/**
 * v264c-mapping-audit-e2e.mjs —— 商品目标页「报单列名对账告警条」**真机只读**验收
 *
 * 本次要证的最后一跳：后端 `/api/product-targets/mapping-audit` 已经返 401/JSON 了，
 * 但**页面上到底有没有把这条告警渲染出来**？三个面要分别证：
 *   Phase A（真实数据）：有 16 个列名没配 ⇒ 告警条**必须出现**，且数字/文案与接口**逐字对应**
 *   Phase B（桩：count=0）：告警条**必须消失** ⇒ 否则配齐的租户天天看到一条常态噪音
 *   Phase C（桩：接口失败）：告警条消失 + **不炸页面、不报错** ⇒ 辅助查询不该吓用户
 *
 * 🔴 全程只读：不点新建、不点保存、不点删除、不改任何服务端数据。
 *    Phase B/C 的「桩」是**在浏览器页面内**替换 `window.fetch`，只影响这一个标签页，
 *    刷新即还原；服务端与生产数据完全不受影响。
 * 🔴 反例对照法（本项目铁律）：只证「有告警条」不够 —— 桩一打就消失，才证明
 *    这条告警是**由数据驱动**的，而不是模板里写死的一坨。
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const USER = process.env.HG_USER || 'mptestsp'
const PASS = process.env.HG_PASS || 'Mpsup@1'
const SHOT_DIR = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v264-商品目标P0-2026-09-24'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const log = (s) => console.log(s)

let pass = 0, fail = 0
const ok = (cond, name, extra) => {
  if (cond) { pass++; log('  ✅ ' + name + (extra ? '　→ ' + extra : '')) }
  else { fail++; log('  ❌ ' + name + (extra ? '　→ ' + extra : '')) }
  return !!cond
}
/* 去空白比对：模板里换行/缩进很多，直接 includes 会假阴性 */
const nz = (s) => String(s == null ? '' : s).replace(/\s+/g, '')

const JS_LOGIN = (u, p) => 'fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},'
  + 'body:JSON.stringify({username:' + JSON.stringify(u) + ',password:' + JSON.stringify(p) + '})})'
  + '.then(r=>r.json()).then(d=>{if(!d.token)return "NO:"+JSON.stringify(d).slice(0,150);'
  + 'localStorage.setItem("hergent_v2_token",d.token);'
  + 'if(d.csrf_token)localStorage.setItem("hergent_v2_csrf",d.csrf_token);'
  + 'if(d.user)localStorage.setItem("hergent_v2_user",JSON.stringify(d.user));'
  + 'if(d.tenant_id)localStorage.setItem("hergent_v2_tenant",String(d.tenant_id));return "OK"})'

/* ── 页面内直接打后端（只读 GET）。
   🔴 必须在页面内先 JSON.stringify：`page.eval` 的 returnByValue 对 `Promise.<object>`
      会退化成 `"[object Object]"`，外层 JSON.parse 直接炸。 ── */
const JS_API = (url) => 'fetch(' + JSON.stringify(url) + ',{headers:{'
  + '"Authorization":"Bearer "+localStorage.getItem("hergent_v2_token"),'
  + '"X-CSRF-Token":(localStorage.getItem("hergent_v2_csrf")||"")}})'
  + '.then(function(r){return r.text().then(function(t){return JSON.stringify({s:r.status,t:t.slice(0,4000)})})})'

/* ── 告警条 DOM 取证：文本 + 几何 + 计算色 + 位置 + 主功能状态 ──
   🔴 「表格区还在吗」这个判据**是错的**：本页列表区是
      `v-if="loading" / v-else-if="err" / v-else-if="!rows.length" / v-else <table>`
      四选一（ProductTarget.vue:61-68），没建过目标的租户**本就没有 <table>**。
      主功能正常的正确证据 = ① `.pt-card` 在 ② 里面**不是** `.pt-err` 错误态
      ③ 列表请求照常发出且 200（见 __reqs/__sts）。 ── */
const JS_BANNER = '(()=>{'
  + 'var es=document.querySelectorAll(".pt-audit");'
  + 'var e=es[0]||null;'
  + 'var o={count:es.length,exist:!!e};'
  + 'if(e){'
  + '  var cs=getComputedStyle(e),rc=e.getBoundingClientRect();'
  + '  o.text=e.innerText||"";'
  + '  o.mono=!!(rc.width>0&&rc.height>0);'
  + '  o.rect={w:Math.round(rc.width),h:Math.round(rc.height),top:Math.round(rc.top)};'
  + '  o.bg=cs.backgroundColor;o.fg=cs.color;o.fontSize=cs.fontSize;'
  + '  o.lines=(e.innerText||"").split("\\n").filter(Boolean).length;'
  + '  var cal=document.querySelector(".pt-caliber");'
  + '  o.afterCaliber=!!(cal&&cal.parentNode===e.parentNode&&(cal.compareDocumentPosition(e)&4));'
  + '  var tb=document.querySelector(".pt-tbar");'
  + '  o.beforeToolbar=!!(tb&&(e.compareDocumentPosition(tb)&4));'
  + '}'
  + 'var cal2=document.querySelector(".pt-caliber");'
  + 'o.caliber=cal2?(cal2.innerText||"").trim().replace(/\\s+/g," ").slice(0,80):null;'
  + 'o.nTable=document.querySelectorAll("table").length;'
  + 'var card=document.querySelector(".pt-card");'
  + 'o.card=!!card;'
  + 'o.cardTxt=card?(card.innerText||"").trim().replace(/\\s+/g," ").slice(0,90):null;'
  + 'o.ptErr=!!document.querySelector(".pt-err");'
  + 'o.tbar=!!document.querySelector(".pt-tbar");'
  + 'o.stubCalls=(window.__auditCalls||0);'
  + 'o.reqs=(window.__reqs||[]).length;'
  + 'o.reqList=(window.__reqs||[]).slice(-30);'
  + 'o.sts=(window.__sts||[]).map(function(x){return {p:x.p.replace(location.origin,""),s:x.s}});'
  + 'o.errPage=/页面出错了|加载失败/.test(document.body?document.body.innerText:"");'
  + 'return JSON.stringify(o)})()'

/* ── 页面内打桩：只拦 `mapping-audit` 一条，其余请求原样放行；
   顺带把**每一次请求的 URL 与状态码**记下来 —— 用来证明「辅助查询失败
   没有连累主功能」（主列表请求照常发出且 200），比找一个可能本就不存在的
   `<table>` 强得多。
   mode='zero' → 返 200 + count=0；mode='fail' → 直接 reject。 ── */
const JS_PATCH = (mode) => '(function(){'
  + 'window.__auditCalls=0;window.__reqs=[];window.__sts=[];'
  + 'if(!window.__origFetch){window.__origFetch=window.fetch;}'
  + 'window.fetch=function(u,o){'
  + 'var s=(typeof u==="string")?u:((u&&u.url)||"");'
  + 'try{window.__reqs.push(s);}catch(e){}'
  + 'if(s.indexOf("/api/product-targets/mapping-audit")>=0){'
  + 'window.__auditCalls++;'
  + (mode === 'zero'
    ? 'return Promise.resolve(new Response('
      + 'JSON.stringify({ok:true,rows_total:0,rows_with_id:0,rows_without_id:0,columns:[],unmapped:[],unmapped_count:0,caliber:"stub-zero"}),'
      + '{status:200,headers:{"Content-Type":"application/json"}}));'
    : 'return Promise.reject(new Error("stub-fail-network"));')
  + '}'
  + 'var pr=window.__origFetch.apply(this,arguments);'
  + 'if(pr&&pr.then){return pr.then(function(r){'
  + 'try{window.__sts.push({p:s,s:r.status});}catch(e){};return r})}'
  + 'return pr;};'
  + 'return "patched:' + mode + '";})()'

/* 主列表请求（排除 mapping-audit 本身）—— 用于证明主功能未被连累 */
const LIST_REQ = (sts, reqs) => {
  const isList = (x) => String(x).indexOf('/api/product-targets') >= 0
    && String(x).indexOf('mapping-audit') < 0
  return {
    sent: (reqs || []).filter(isList).length,
    done: (sts || []).filter(x => isList(x.p)),
  }
}

let browser, failed = false
const go = async (page, hash, ms) => {
  await page.eval('location.hash=' + JSON.stringify(hash))
  await sleep(ms || 4200)
}

try {
  fs.mkdirSync(SHOT_DIR, { recursive: true })
  browser = await launch()
  const page = await browser.newPage()
  await page.enable()

  log('=== 0. 登录 ===')
  await page.goto(BASE, 3500)
  const li = await page.eval(JS_LOGIN(USER, PASS))
  ok(li === 'OK', '登录 ' + USER, li)
  if (li !== 'OK') throw new Error('登录失败，后续无从验证')

  /* ══════════════════════ Phase A：真实数据 ══════════════════════ */
  log('')
  log('=== 1. 打开商品目标页（真实数据） ===')
  await page.goto(BASE + '/#/product-target', 6000)

  const raw = JSON.parse((await page.eval(JS_API('/api/product-targets/mapping-audit'))) || '{}')
  ok(raw.s === 200, 'GET /mapping-audit = 200（未登录 401 / 未登记 403 / 不存在 404）', 'status=' + raw.s)
  let api = null
  try { api = JSON.parse(raw.t) } catch { }
  ok(!!api && api.ok === true, '响应 ok=true', api ? ('rows_total=' + api.rows_total + ' rows_with_id=' + api.rows_with_id + ' rows_without_id=' + api.rows_without_id) : String(raw.t).slice(0, 200))
  if (!api) throw new Error('mapping-audit 响应无法解析，后续断言无意义')

  const N = Number(api.unmapped_count || 0)
  const COLS = api.columns || []
  const sameN = COLS.filter(c => c.status === 'same_name_only').length
  const unknownN = COLS.filter(c => c.status === 'unknown').length
  const mappedN = COLS.filter(c => c.status === 'mapped').length
  log('  接口读数：unmapped=' + N + '｜same_name_only=' + sameN + '｜unknown=' + unknownN + '｜mapped=' + mappedN
    + '｜columns=' + COLS.length)
  log('  口径 = ' + JSON.stringify(api.caliber).slice(0, 300))

  /* 三态自洽（同一份数据内部必须能对上） */
  ok(sameN + unknownN === N, '分项自洽：same_name_only + unknown == unmapped_count', sameN + ' + ' + unknownN + ' = ' + (sameN + unknownN) + ' vs ' + N)
  ok(COLS.length === N + mappedN, '分项自洽：columns == unmapped + mapped', COLS.length + ' vs ' + (N + mappedN))
  ok(Array.isArray(api.unmapped) && api.unmapped.length === N, 'unmapped[] 长度 == unmapped_count', (api.unmapped || []).length + ' vs ' + N)

  const b = JSON.parse((await page.eval(JS_BANNER)) || '{}')
  log('  页面读数：.pt-audit 个数=' + b.count + '｜可见=' + b.mono + '｜尺寸=' + JSON.stringify(b.rect)
    + '｜行数=' + b.lines + '｜bg=' + b.bg + '｜fg=' + b.fg)
  log('  页面骨架：.pt-caliber=' + !!b.caliber + '｜.pt-tbar=' + b.tbar + '｜.pt-card=' + b.card
    + '｜.pt-err=' + b.ptErr + '｜<table>=' + b.nTable + '｜卡片文案=' + JSON.stringify(b.cardTxt))
  log('  ── 告警条正文 ──')
  String(b.text || '').split('\n').filter(Boolean).forEach(l => log('   | ' + l.slice(0, 130)))

  /* A1 存在性 —— 由数据决定，不写死 */
  ok(N > 0 ? b.count === 1 : b.count === 0,
    '告警条存在性与接口一致（unmapped_count=' + N + ' ⇒ 期望 ' + (N > 0 ? '出现 1 条' : '不出现') + '）', '.pt-audit 个数=' + b.count)
  if (N === 0) {
    log('  ⚠️ 生产当前 unmapped_count=0 —— 本批列名已全部配齐，Phase A 的文案断言自动跳过；')
    log('     告警条「消失」这件事由 Phase B 专门证明。')
  }

  if (N > 0) {
    const t = nz(b.text)
    /* A2 标题数字 = 接口数字（不是页面自己算的第三份实现） */
    ok(t.includes('有' + N + '个报单列名还没配进「报单配置」'), '标题数字与接口一致', '期望「有 ' + N + ' 个报单列名还没配进「报单配置」」')
    /* A3 列名前 8 个 + 「等 N 个」后缀（>8 才出现） */
    const head8 = api.unmapped.slice(0, 8).join('、')
    ok(t.includes(nz(head8)), '前 8 个列名逐个对上（顿号连接）', nz(head8))
    if (api.unmapped.length > 8) {
      ok(t.includes('等' + api.unmapped.length + '个'), '超过 8 个时补「等 N 个」后缀', '等 ' + api.unmapped.length + ' 个')
    } else {
      ok(!/等\d+个/.test(t), '不超过 8 个时**不**出现「等 N 个」', 'unmapped 共 ' + api.unmapped.length + ' 个')
    }
    /* A4 两个分项文案 */
    ok(t.includes('其中' + sameN + '个在客户档案里有同名'), '分项①「有同名」数字与接口一致', '其中 ' + sameN + ' 个')
    ok(t.includes('（配一下就能对上），' + unknownN + '个连客户档案里也没有'), '分项②「档案里也没有」数字与接口一致', unknownN + ' 个')
    /* A5 修法指引可读且不是死链（本项目明确不加深链） */
    ok(t.includes('预报订单管理→报单配置'), '给了修法指引', '「预报订单管理 → 报单配置」')
    ok(!/<a\s|href=/.test(String(b.text || '')), '告警条内无跳转链接（报单配置是页签、无独立路由，加深链会成死链）')
  }

  /* A6 几何：真的渲染出来了（不是 display:none / 高度塌成 0） */
  if (N > 0) {
    ok(!!b.exist && b.mono && b.rect.w > 200 && b.rect.h > 20, '告警条实际渲染（宽高 > 0）', JSON.stringify(b.rect))
    ok(!!b.afterCaliber, '位置在口径条之后（同父、文档序靠后）')
    ok(!!b.beforeToolbar, '位置在工具栏之前（用户先看到风险提示）')
    /* A7 颜色：琥珀底 + 非透明（复用站内语义色，不是白底隐形） */
    const bgOk = /^rgb/.test(String(b.bg)) && !/rgba?\(0,\s*0,\s*0,\s*0\)/.test(String(b.bg))
    ok(bgOk, '背景色已着色（非透明）', b.bg + ' / 文字 ' + b.fg)
    ok(b.bg !== b.fg, '前景/背景不同色（不是看不见的文字）', b.fg + ' on ' + b.bg)
  }

  const errA = page.errors.length
  ok(errA === 0, 'Phase A 控制台 0 报错', errA + ' 条')
  page.errors.slice(0, 8).forEach(e => log('   ' + e.slice(0, 200)))
  ok(!b.errPage, '无兜底错误页')
  /* 主功能对照（真实数据下）：告警条**没有**把列表区挤掉/顶掉 */
  ok(b.card && !b.ptErr, '列表卡片 .pt-card 在且**不是**错误态 .pt-err', '卡片文案=' + JSON.stringify(b.cardTxt))

  const SHOT_A = SHOT_DIR + '/06-告警条-真实数据（16个列名未配）.png'
  try { await page.screenshot(SHOT_A); log('  截图：' + SHOT_A) } catch { }

  /* ══════════════════════ Phase B：桩 count=0 ══════════════════════ */
  log('')
  log('=== 2. 反例对照：桩成「一条都没问题」⇒ 告警条必须消失 ===')
  const p1 = await page.eval(JS_PATCH('zero'))
  ok(p1 === 'patched:zero', '已在页面内打桩（只拦 mapping-audit，其余原样放行）', p1)
  await go(page, '#/workbench', 2500)
  await go(page, '#/product-target', 4200)

  const b2 = JSON.parse((await page.eval(JS_BANNER)) || '{}')
  ok(b2.stubCalls >= 1, '桩**确实被调用过**（否则「消失了」是假绿）', '拦截次数 = ' + b2.stubCalls)
  ok(b2.count === 0, '桩 count=0 时告警条**不渲染**（配齐的租户不会被常态噪音打扰）', '.pt-audit 个数=' + b2.count)
  const L2 = LIST_REQ(b2.sts, b2.reqList)
  log('  主功能对照：列表请求发出 ' + L2.sent + ' 次｜完成 ' + JSON.stringify(L2.done))
  log('  期间全部请求 = ' + JSON.stringify(b2.reqList))
  ok(!!b2.caliber, '口径条仍在（页面正常渲染，不是整块挂掉）', String(b2.caliber).slice(0, 60))
  ok(b2.card && !b2.ptErr, '列表卡片 .pt-card 在且不是错误态 .pt-err', '卡片文案=' + JSON.stringify(b2.cardTxt))
  ok(L2.done.length >= 1 && L2.done.every(x => x.s === 200),
    '主列表请求照常发出且全部 200（打桩没有连累主功能）', JSON.stringify(L2.done))
  const errB = page.errors.length - errA
  ok(errB === 0, 'Phase B 新增 0 报错', errB + ' 条')

  const SHOT_B = SHOT_DIR + '/07-对照-配齐时告警条自动消失.png'
  try { await page.screenshot(SHOT_B); log('  截图：' + SHOT_B) } catch { }

  /* ══════════════════════ Phase C：桩接口失败 ══════════════════════ */
  log('')
  log('=== 3. 反例对照：桩成「接口失败」⇒ 静默降级、不炸页面 ===')
  const p2 = await page.eval(JS_PATCH('fail'))
  ok(p2 === 'patched:fail', '已换成失败桩', p2)
  await go(page, '#/workbench', 2500)
  await go(page, '#/product-target', 4200)

  const b3 = JSON.parse((await page.eval(JS_BANNER)) || '{}')
  ok(b3.stubCalls >= 1, '失败桩确实被调用过', '拦截次数 = ' + b3.stubCalls)
  ok(b3.count === 0, '接口失败时告警条不渲染（loadAudit 的 catch 生效）', '.pt-audit 个数=' + b3.count)
  const L3 = LIST_REQ(b3.sts, b3.reqList)
  log('  主功能对照：列表请求发出 ' + L3.sent + ' 次｜完成 ' + JSON.stringify(L3.done))
  log('  期间全部请求 = ' + JSON.stringify(b3.reqList))
  ok(!!b3.caliber && b3.tbar, '口径条 + 工具栏仍在 ⇒ 页面骨架完整')
  ok(b3.card && !b3.ptErr, '列表卡片在且不是错误态 ⇒ 辅助查询失败**没有**连累主功能', '卡片文案=' + JSON.stringify(b3.cardTxt))
  ok(L3.done.length >= 1 && L3.done.every(x => x.s === 200),
    '主列表请求照常发出且全部 200', JSON.stringify(L3.done))
  ok(!b3.errPage, '无兜底错误页')
  const errC = page.errors.length - errA - errB
  ok(errC === 0, 'Phase C 新增 0 报错（已 catch，不该冒泡成未捕获异常）', errC + ' 条')
  if (errC > 0) page.errors.slice(errA + errB).slice(0, 6).forEach(e => log('   ' + e.slice(0, 220)))

  const SHOT_C = SHOT_DIR + '/08-对照-接口失败时静默降级不炸页面.png'
  try { await page.screenshot(SHOT_C); log('  截图：' + SHOT_C) } catch { }

  log('')
  log('────────────────────────────')
  log('通过 ' + pass + ' 项，失败 ' + fail + ' 项')
  if (fail > 0) failed = true
} catch (e) {
  log('脚本异常：' + (e && e.stack ? e.stack.split('\n').slice(0, 5).join('\n') : e))
  failed = true
} finally {
  if (browser) { try { await browser.close() } catch { } }
  process.exit(failed ? 1 : 0)
}
