/**
 * m3-proposal-e2e.mjs —— M3「口径提案审核台」真机只读验收
 *
 * 两面：
 *   A 真实面：AI 中心（/ai-hub）上「口径提案审核台」卡片必须渲染（标题/说明/刷新/空态）
 *   B 桩面：把 `/api/ai/recipe-proposals` 打桩成 2 条（1 待审 + 1 已采纳），验证列表 UI：
 *       模块徽标 / 状态徽标 / 理由 / 改动行 / 且非管理员时「采纳·驳回」必须 disabled
 *
 * 🔴 只读：唯一写是 localStorage 种 token；桩在页面内替换 window.fetch（刷新即还），
 *    **绝不真的 accept**（accept 会合并配方 = 生产写）。
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const USER = process.env.HG_USER || 'mptestsp'
const PASS = process.env.HG_PASS || 'Mpsup@1'
const SHOT_DIR = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/M3-提案审核台-2026-09-24'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const log = (s) => console.log(s)
try { fs.mkdirSync(SHOT_DIR, { recursive: true }) } catch { /* ignore */ }

let pass = 0, fail = 0
const ok = (cond, name, extra) => {
  if (cond) { pass++; log('  ✅ ' + name + (extra ? '　→ ' + extra : '')) }
  else { fail++; log('  ❌ ' + name + (extra ? '　→ ' + extra : '')) }
  return !!cond
}

const JS_LOGIN = (u, p) => 'fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},'
  + 'body:JSON.stringify({username:' + JSON.stringify(u) + ',password:' + JSON.stringify(p) + '})})'
  + '.then(r=>r.json()).then(d=>{if(!d.token)return "NO";'
  + 'localStorage.setItem("hergent_v2_token",d.token);'
  + 'if(d.csrf_token)localStorage.setItem("hergent_v2_csrf",d.csrf_token);'
  + 'if(d.user)localStorage.setItem("hergent_v2_user",JSON.stringify(d.user));'
  + 'if(d.tenant_id)localStorage.setItem("hergent_v2_tenant",String(d.tenant_id));return "OK"})'

/* 桩：只拦 recipe-proposals，返回 2 条（1 pending + 1 accepted），其余原样放行 */
const STUB = [
  { id: 901, module: 'loss', title: '临期阈值建议从 7 天改为 5 天',
    changes: { threshold_days: 5 }, rationale: '最近多批临期 7 天仍被拒收，业务口径宜收紧。',
    source: 'ai', status: 'pending', created_by: 'ai', created_at: '2026-09-24 10:00:00',
    reviewed_by: '', reviewed_at: '' },
  { id: 902, module: 'payroll', title: '提成基数口径统一为「回款额」',
    changes: { commission_base: 'received_amount' }, rationale: '避免按开单额算但款未回。',
    source: 'manual', status: 'accepted', created_by: '老板', created_at: '2026-09-20 09:00:00',
    reviewed_by: '老板', reviewed_at: '2026-09-21 11:00:00' },
]
const JS_PATCH = '(function(){'
  + 'window.__stubCalls=0;'
  + 'if(!window.__origFetch){window.__origFetch=window.fetch;}'
  + 'window.fetch=function(u,o){'
  + ' var s=(typeof u==="string")?u:((u&&u.url)||"");'
  + ' if(s.indexOf("/api/ai/recipe-proposals")>=0){window.__stubCalls++;'
  + '   return Promise.resolve(new Response(JSON.stringify({ok:true,proposals:' + JSON.stringify(STUB) + '}),'
  + '     {status:200,headers:{"Content-Type":"application/json"}}));}'
  + ' return window.__origFetch.apply(this,arguments);};'
  + 'return "patched"})()'

const JS_STATE = '(()=>{'
  + 'var card=[].slice.call(document.querySelectorAll(".card")).find(function(c){'
  + '  return (c.innerText||"").indexOf("口径提案审核台")>=0;});'
  + 'var o={hasCard:!!card,stubCalls:(window.__stubCalls||0),path:location.hash};'
  + 'if(!card)return JSON.stringify(o);'
  + 'o.title=((card.querySelector(".panel-hd b")||{}).textContent||"").trim();'
  + 'o.sub=((card.querySelector(".panel-hd .page-sub")||{}).textContent||"").trim();'
  + 'o.hasRefresh=!!card.querySelector(".tb-group .btn");'
  + 'o.empty=!!card.querySelector(".state-empty");'
  + 'o.emptyText=o.empty?(card.querySelector(".state-empty").innerText||"").trim():"";'
  + 'o.rows=card.querySelectorAll(".prop-item").length;'
  + 'o.items=[].slice.call(card.querySelectorAll(".prop-item")).map(function(it){'
  + '  var b=it.querySelector(".prop-ops button");'
  + '  return {mod:((it.querySelector(".prop-mod")||{}).textContent||"").trim(),'
  + '    name:((it.querySelector(".prop-name")||{}).textContent||"").trim(),'
  + '    st:((it.querySelector(".prop-st")||{}).textContent||"").trim(),'
  + '    why:((it.querySelector(".prop-why")||{}).textContent||"").trim().slice(0,40),'
  + '    chg:((it.querySelector(".prop-chg")||{}).textContent||"").trim(),'
  + '    meta:((it.querySelector(".prop-meta")||{}).textContent||"").replace(/\\s+/g," ").trim(),'
  + '    nBtns:it.querySelectorAll(".prop-ops button").length,'
  + '    disabled:b?b.disabled:null};});'
  + 'var hint=[].slice.call(card.querySelectorAll(".quota-sub")).map(function(e){return e.textContent.trim()});'
  + 'o.hints=hint;'
  + 'var bento=document.querySelector(".bento");'
  + 'if(bento){var cr=card.getBoundingClientRect(),br=bento.getBoundingClientRect();'
  + '  o.cardW=Math.round(cr.width);o.bentoW=Math.round(br.width);'
  + '  o.fill=br.width?Math.round(cr.width/br.width*100):0;}'
  + 'return JSON.stringify(o)})()'

const browser = await launch({ headless: true })
const page = await browser.newPage()
await page.enable()

try {
  log('== 登录 ==')
  await page.goto(BASE + '/', 5000)
  const lr = await page.eval(JS_LOGIN(USER, PASS))
  if (String(lr).slice(0, 2) === 'NO') throw new Error('登录失败')
  await page.goto(BASE + '/', 5000)   // 带 token 重载

  log('\n== A 真实面：AI 中心 上的审核台卡片 ==')
  await page.eval('location.hash = "#/ai-hub"')
  await sleep(1800)
  let s = JSON.parse(await page.eval(JS_STATE))
  ok(s.hasCard, '审核台卡片已渲染')
  ok(s.title === '口径提案审核台', '标题正确', s.title)
  ok(/采纳/.test(s.sub), '说明文案提到「采纳」', s.sub.slice(0, 40))
  ok(s.hasRefresh, '刷新按钮存在')
  ok(s.empty || s.rows > 0, '呈现空态或列表（二者其一）', s.empty ? '空态' : ('rows=' + s.rows))
  // 🔴 关键：403 必须显示「没权限」，绝不能显示成「暂无待审提案」（否则是「没数据 vs 没权限」混为一谈）
  if (s.empty) {
    ok(/权限/.test(s.emptyText), '无权限时提示的是「权限」而非「暂无提案」', s.emptyText.slice(0, 46))
    ok(!/暂无待审提案/.test(s.emptyText), '未把 403 误报成「暂无待审提案」')
  }
  log('  （真实面现状：' + (s.empty ? '权限提示（本角色对 /api/ai/* 403）' : ('列表 ' + s.rows + ' 条')) + '）')
  await page.screenshot(SHOT_DIR + '/01-审核台-真实面.png')

  log('\n== B 桩面：2 条提案的列表 UI ==')
  await page.eval(JS_PATCH)
  // 用 hash 重入触发组件重挂载（不整页刷新，桩保留）
  await page.eval('location.hash = "#/workbench"')
  await sleep(700)
  await page.eval('location.hash = "#/ai-hub"')
  await sleep(1800)
  s = JSON.parse(await page.eval(JS_STATE))
  ok(s.stubCalls >= 1, '桩确实被调用过（≥1）', 'calls=' + s.stubCalls)
  ok(s.rows === 2, '渲染 2 条提案', 'rows=' + s.rows)
  ok(!s.empty, '不再显示空态')
  // 🔴 几何断言：卡片必须整行铺开。漏写 base 的 grid-column 会被塞进 1 列窄栏、文字竖排
  ok(s.fill >= 90, '卡片整行铺开（未被栅格塞进窄栏）',
    'fill=' + s.fill + '%  card=' + s.cardW + '/' + s.bentoW)
  const i0 = s.items[0] || {}, i1 = s.items[1] || {}
  ok(i0.mod === '货损', '第 1 条模块徽标=货损', i0.mod)
  ok(i0.st === '待审批', '第 1 条状态=待审批', i0.st)
  ok(/5/.test(i0.chg), '第 1 条显示改动行（threshold_days=5）', i0.chg)
  ok(/拒收/.test(i0.why), '第 1 条显示理由', i0.why)
  ok(i1.mod === '工资', '第 2 条模块徽标=工资', i1.mod)
  ok(i1.st === '已采纳', '第 2 条状态=已采纳', i1.st)
  ok(/人工提交/.test(i1.meta), '人工来源标注正确', i1.meta)
  ok(i1.nBtns === 0, '已处理的提案不显示操作按钮', 'n=' + i1.nBtns)
  ok(i0.nBtns === 2, '待审提案有 采纳+驳回 两个按钮', 'n=' + i0.nBtns)
  ok(i0.disabled === true, '非管理员时「采纳」按钮 disabled（不误改配方）', 'disabled=' + i0.disabled)
  ok(s.hints.some(h => /仅管理员/.test(h)), '显示「仅管理员可采纳/驳回」提示', JSON.stringify(s.hints))
  await page.screenshot(SHOT_DIR + '/02-审核台-列表(桩).png')

  log('\n== 控制台 ==')
  const errs = page.errors || []
  ok(errs.length === 0, '全程 0 控制台报错', errs.length ? JSON.stringify(errs.slice(0, 4)) : '')
} catch (e) {
  fail++
  log('  ❌ 探针异常：' + (e && e.message ? e.message : e))
} finally {
  log('\n===== M3 提案审核台探针：PASS ' + pass + ' / FAIL ' + fail + ' =====')
  log('截图目录：' + SHOT_DIR)
  await browser.close()
  process.exit(fail ? 1 : 0)
}
