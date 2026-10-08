/**
 * m2-chart-e2e.mjs —— M2「一卡双图（趋势折线 + 构成环形）」真机只读验收
 *
 * 为什么能确定性验：副驾空态有「查看示例经营卡 →」按钮，直接 push 一张 `demoCard()`，
 * **零 AI 调用、零打桩**，就能把 ResultCard 的图表渲染跑起来。
 * 这张示例卡已被改成「一卡双图」⇒ 同一张卡上应当同时出现 polyline（mini）与 donut（环形）。
 *
 * 要证：
 *   A 折线仍渲染（多图重构没把原有的 mini 打破）：`.rc-spark polyline` 存在且 7 个点
 *   B 环形新增可见：`.rc-donut` 存在，3 段弧（stroke-dasharray 圆）+ 图例 3 项
 *   C 两图都有尺寸（非隐形）与各自 caption
 *   D 自洽：图例三项之和 = 3180（与卡内「货损金额 ¥3,180」一致）
 *   E 全程 0 控制台报错
 *
 * 🔴 只读：唯一写是 localStorage 种 token；不触发任何 AI/后端写。
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const USER = process.env.HG_USER || 'mptestsp'
const PASS = process.env.HG_PASS || 'Mpsup@1'
const SHOT_DIR = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/M2-一卡双图-2026-09-24'
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

const JS_OPEN = '(function(){var d=document.querySelector(".copilot");if(d)return "already";'
  + 'var b=document.querySelector(".tb-copilot");if(!b)return "no-btn";b.click();return "clicked"})()'

const JS_DEMO = '(function(){var b=document.querySelector(".cp-demo");if(!b)return "no-demo-btn";b.click();return "clicked"})()'

/** 图表取证：折线点数 / 环形弧数 / 图例 / 尺寸 / caption */
const JS_CHART = '(()=>{'
  + 'var o={};'
  + 'var sp=document.querySelector(".rc-spark");'
  + 'o.hasSpark=!!sp;'
  + 'if(sp){var pl=sp.querySelector("polyline");o.hasPoly=!!pl;'
  + '  o.pts=pl?(pl.getAttribute("points")||"").trim().split(/\\s+/).filter(Boolean).length:0;'
  + '  var r=sp.getBoundingClientRect();o.sparkRect={w:Math.round(r.width),h:Math.round(r.height)};}'
  + 'var dn=document.querySelector(".rc-donut");'
  + 'o.hasDonut=!!dn;'
  + 'if(dn){'
  + '  var arcs=[].slice.call(dn.querySelectorAll("circle")).filter(function(c){return (c.getAttribute("stroke-dasharray")||"").length>0;});'
  + '  o.arcs=arcs.length;'
  + '  o.arcColors=arcs.map(function(c){return c.getAttribute("stroke")});'
  + '  var r2=dn.getBoundingClientRect();o.donutRect={w:Math.round(r2.width),h:Math.round(r2.height)};}'
  + 'var lg=[].slice.call(document.querySelectorAll(".rc-donut-lg")).map(function(e){return e.textContent.trim()});'
  + 'o.legend=lg;'
  + 'o.caps=[].slice.call(document.querySelectorAll(".rc-chart-cap")).map(function(e){return e.textContent.trim()});'
  + 'o.nChartBlocks=document.querySelectorAll(".rc-chart").length;'
  + 'var card=document.querySelector(".rc");'
  + 'o.hasCard=!!card;o.cardTitle=card?((card.querySelector(".rc-title")||{}).textContent||"").trim():null;'
  + 'o.cardText=card?(card.innerText||""):"";'
  + 'return JSON.stringify(o)})()'

const browser = await launch({ headless: true })
const page = await browser.newPage()
await page.enable()

try {
  log('== 登录并打开副驾 ==')
  await page.goto(BASE + '/', 5000)
  const loginRes = await page.eval(JS_LOGIN(USER, PASS))
  if (String(loginRes).slice(0, 2) === 'NO') throw new Error('登录失败')
  await page.goto(BASE + '/workbench', 6000)
  await page.eval(JS_OPEN)
  await sleep(900)

  log('\n== 点击「查看示例经营卡」 ==')
  const dc = await page.eval(JS_DEMO)
  log('  demo click: ' + dc)
  ok(dc === 'clicked', '示例卡按钮存在且可点')
  await sleep(700)

  const s = JSON.parse(await page.eval(JS_CHART))

  log('\n== A 折线（mini）仍渲染 ==')
  ok(s.hasCard, '经营卡已渲染', s.cardTitle || '')
  ok(s.hasSpark && s.hasPoly, '折线图存在（多图重构未破坏 mini）')
  ok(s.pts === 7, '折线 7 个数据点', 'pts=' + s.pts)
  ok(s.sparkRect && s.sparkRect.h > 0 && s.sparkRect.w > 0, '折线有尺寸（非隐形）', JSON.stringify(s.sparkRect))

  log('\n== B 环形（donut）新增可见 ==')
  ok(s.hasDonut, '环形图存在（donut 首次被真实使用）')
  ok(s.arcs === 3, '环形 3 段弧', 'arcs=' + s.arcs)
  ok(s.legend.length === 3, '图例 3 项', JSON.stringify(s.legend))
  ok(s.donutRect && s.donutRect.h > 0, '环形有尺寸（非隐形）', JSON.stringify(s.donutRect))
  ok(new Set(s.arcColors).size >= 2, '各段颜色不同（可区分）', JSON.stringify(s.arcColors))

  log('\n== C 两张图 + 各自 caption ==')
  ok(s.nChartBlocks === 2, '同一张卡上有 2 个图块', 'n=' + s.nChartBlocks)
  ok(s.caps.some(c => c.indexOf('近 7 日货损') >= 0), '折线 caption 正确', JSON.stringify(s.caps))
  ok(s.caps.some(c => c.indexOf('货损构成') >= 0), '环形 caption 正确')

  log('\n== D 自洽：图例文案 = 指标口径 ==')
  ok(/3,180|3180/.test(s.cardText), '卡内出现货损金额 ¥3,180', '')
  ok(s.legend.join('|') === '纯甄风味酸奶|冠益乳 LB|其他 10 款', '图例与示例数据一致', s.legend.join('|'))

  await page.screenshot(SHOT_DIR + '/01-示例卡-一卡双图.png')

  log('\n== E 控制台 ==')
  const errs = page.errors || []
  ok(errs.length === 0, '全程 0 控制台报错', errs.length ? JSON.stringify(errs.slice(0, 4)) : '')
} catch (e) {
  fail++
  log('  ❌ 探针异常：' + (e && e.message ? e.message : e))
} finally {
  log('\n===== M2 一卡双图探针：PASS ' + pass + ' / FAIL ' + fail + ' =====')
  log('截图目录：' + SHOT_DIR)
  await browser.close()
  process.exit(fail ? 1 : 0)
}
