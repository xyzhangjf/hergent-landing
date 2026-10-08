/**
 * v357 真机验收 —— 招投标雷达「记住区域」在 https://hergent.cn 上的端到端行为
 *
 * 覆盖四组：
 *   A 核心需求（真实后端）：选中即记忆 → 下次打开自动带出并直接查该区域
 *   B 兜底（真实后端 + 预置记忆）：该区域无数据 / 记忆值已失效
 *   C 兜底（打桩 500）：请求失败 ≠ 无数据
 *   D 口径一致性：KPI「近 3 日新增」必须与「累计商机」同口径
 *
 * 只读：全程不点任何写操作；招投标雷达本身无写接口，localStorage 写入是本机行为。
 * 用法：HG_TOKEN=... HG_TENANT=... node v357-bidradar-region-verify.mjs
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const TOKEN = process.env.HG_TOKEN || ''
const TENANT = process.env.HG_TENANT || '10'
const BASE = 'https://hergent.cn/'
const ROUTE = '#/bid-radar'

const R = []
const ok = (name, cond, extra) => {
  R.push({ name, pass: !!cond, extra: extra === undefined ? '' : String(extra) })
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* 初始化脚本：① 注入登录态 ② 记录本页所有 /api/bid-radar 请求 URL ③ 可选打桩 500
   每次导航都会重新执行 ⇒ __brUrls 反映「本次导航」的请求序列（正是要验的「首个请求」）。 */
function initScript(seedRegion, failMode) {
  return [
    '(function(){',
    '  try {',
    '    localStorage.setItem("hergent_v2_token", ' + JSON.stringify(TOKEN) + ');',
    '    localStorage.setItem("hergent_v2_tenant", ' + JSON.stringify(String(TENANT)) + ');',
    '    localStorage.setItem("hergent_v2_user", JSON.stringify({role:"boss",name:"探针"}));',
    '    var seed = ' + JSON.stringify(seedRegion) + ';',
    // 🔴 三态：__SKIP__ = 完全不动（验「下次打开自动带出」时**绝不能**重置它，
    //    否则每次导航都清/写一遍，"记住"这件事就永远测不出来 —— 首版探针即栽在此）；
    //    null / "" = 清空；其余 = 预置。
    '    if (seed === "__SKIP__") { /* 保持既有 */ }',
    '    else if (seed === null || seed === "") localStorage.removeItem("br_region");',
    '    else localStorage.setItem("br_region", seed);',
    '  } catch (e) {}',
    '  window.__brUrls = [];',
    '  var FAIL = ' + (failMode ? 'true' : 'false') + ';',
    '  var _f = window.fetch;',
    '  window.fetch = function (i, n) {',
    '    var u = (typeof i === "string") ? i : ((i && i.url) || "");',
    '    if (u.indexOf("/api/bid-radar") >= 0) {',
    '      window.__brUrls.push(u);',
    '      if (FAIL) return Promise.resolve(new Response(JSON.stringify({detail:"探针打桩：模拟服务端错误"}), {status:500, headers:{"Content-Type":"application/json"}}));',
    '    }',
    '    return _f.apply(this, arguments);',
    '  };',
    '})()',
  ].join('\n')
}

const READ = [
  '(() => {',
  '  const q = (s) => document.querySelector(s);',
  '  const sel = q(\'select[aria-label="地区"]\');',
  '  const chip = q(".br-def");',
  '  const notice = q(".br-notice");',
  '  const emptyT = q(".br-empty-t");',
  '  const rows = [...document.querySelectorAll(".br-tbl tbody tr")];',
  '  return JSON.stringify({',
  '    hash: location.hash,',
  '    selValue: sel ? sel.value : null,',
  '    selText: (sel && sel.selectedOptions && sel.selectedOptions[0]) ? sel.selectedOptions[0].textContent.trim() : null,',
  '    selDisabledOpt: (sel && sel.selectedOptions && sel.selectedOptions[0]) ? !!sel.selectedOptions[0].disabled : null,',
  '    chip: chip ? chip.textContent.replace(/\\s+/g, " ").trim() : null,',
  '    notice: notice ? notice.textContent.trim() : null,',
  '    emptyText: emptyT ? emptyT.textContent.trim() : null,',
  '    btnTexts: [...document.querySelectorAll(".br-state .br-btn")].map(e => e.textContent.trim()),',
  '    rowCount: rows.length,',
  '    rowRegions: [...new Set(rows.map(tr => { const c = tr.querySelector(".c-region"); return c ? c.textContent.trim() : "?" }))],',
  '    kpiSubs: [...document.querySelectorAll(".kpi-strip .kpi-sub")].map(e => e.textContent.trim()),',
  '    lsRegion: localStorage.getItem("br_region"),',
  '    urls: (window.__brUrls || []).map(u => decodeURIComponent(u.replace(/^https?:\\/\\/[^/]+/, ""))),',
  '    mainText: q(".br-main") ? q(".br-main").innerText.replace(/\\s+/g, " ").slice(0, 100) : ""',
  '  });',
  '})()',
].join('\n')

let BROWSER = null
async function nav(page, tag) {
  await page.goto(BASE + '?cb=' + Date.now() + ROUTE, 6000)
  await sleep(1200)
  const s = JSON.parse(await page.eval(READ))
  ok('[' + tag + '] 落在招投标雷达页（未被守卫踢回登录）', s.hash.indexOf('bid-radar') >= 0, s.hash)
  return s
}

try {
  BROWSER = await launch({ headless: true })

  /* ================= A 相位：核心需求（真实后端） ================= */
  const pa = await BROWSER.newPage()
  await pa.enable()
  await pa.addInitScript(initScript('__SKIP__', false))

  const a1 = await nav(pa, 'A1')
  ok('A1 未选择地区时下拉为「全部地区」', a1.selValue === '', 'selValue=' + JSON.stringify(a1.selValue))
  ok('A2 未选择地区时不显示「默认」标记', a1.chip === null, 'chip=' + JSON.stringify(a1.chip))
  ok('A3 未选择地区时首个请求不带 region 参数',
    a1.urls.length > 0 && a1.urls[0].indexOf('region=') < 0, a1.urls[0] || '(无请求)')
  ok('A3b 未选择地区时列表有数据（全部地区口径）', a1.rowCount > 0, 'rowCount=' + a1.rowCount)

  // 通过真实 UI 操作选中「湖北」（用户举例的省，真实数据里 count=11）
  await pa.eval('(() => { const s = document.querySelector(\'select[aria-label="地区"]\'); s.value = "湖北"; s.dispatchEvent(new Event("change", {bubbles:true})); return s.value })()')
  await sleep(2200)
  const a2 = JSON.parse(await pa.eval(READ))
  ok('A4 选择「湖北」后写入本机记忆', a2.lsRegion === '湖北', 'br_region=' + JSON.stringify(a2.lsRegion))
  ok('A5 选择「湖北」后请求带 region=湖北',
    a2.urls.some((u) => u.indexOf('region=湖北') >= 0), JSON.stringify(a2.urls))
  ok('A6 出现「默认 湖北」标记', a2.chip !== null && a2.chip.indexOf('湖北') >= 0, 'chip=' + JSON.stringify(a2.chip))
  ok('A7 列表全部为湖北的商机',
    a2.rowCount > 0 && a2.rowRegions.length === 1 && a2.rowRegions[0] === '湖北',
    'rowCount=' + a2.rowCount + ' regions=' + JSON.stringify(a2.rowRegions))
  ok('A8 「累计商机」写明是湖北口径',
    a2.kpiSubs[0] && a2.kpiSubs[0].indexOf('湖北') >= 0, 'kpiSubs[0]=' + JSON.stringify(a2.kpiSubs[0]))
  ok('A9 「近 3 日新增」与「累计商机」同口径（也带 region）',
    a2.urls.filter((u) => u.indexOf('date_from=') >= 0).some((u) => u.indexOf('region=湖北') >= 0),
    JSON.stringify(a2.urls.filter((u) => u.indexOf('date_from=') >= 0)))

  // 断网重开 = 模拟「下次打开应用」（query 变化触发真导航，hash 变化不会重载）
  const a3 = await nav(pa, 'A10')
  ok('A10 重新打开时【首个请求】即带 region=湖北（不闪全部地区）',
    a3.urls.length > 0 && a3.urls[0].indexOf('region=湖北') >= 0, a3.urls[0] || '(无请求)')
  ok('A11 重新打开后下拉自动选中「湖北」', a3.selValue === '湖北', 'selValue=' + JSON.stringify(a3.selValue))
  ok('A12 重新打开后仍显示「默认 湖北」标记', a3.chip !== null && a3.chip.indexOf('湖北') >= 0, 'chip=' + JSON.stringify(a3.chip))
  ok('A13 重新打开后直接展示湖北的列表',
    a3.rowCount > 0 && a3.rowRegions.length === 1 && a3.rowRegions[0] === '湖北',
    'rowCount=' + a3.rowCount + ' regions=' + JSON.stringify(a3.rowRegions))

  await pa.screenshot('/tmp/v357-a-reopen-hubei.png')

  // 点「默认」标记上的 × 取消记忆
  await pa.eval('(() => { const b = document.querySelector(".br-def"); if (!b) return "no-chip"; b.click(); return "ok" })()')
  await sleep(600)
  const a4 = JSON.parse(await pa.eval(READ))
  ok('A14 点×取消记忆后本机记忆被清', a4.lsRegion === null, 'br_region=' + JSON.stringify(a4.lsRegion))
  ok('A15 点×后「默认」标记消失', a4.chip === null, 'chip=' + JSON.stringify(a4.chip))
  ok('A15b 点×不改动当前筛选（仍看湖北）', a4.selValue === '湖北', 'selValue=' + JSON.stringify(a4.selValue))

  const a5 = await nav(pa, 'A16')
  ok('A16 取消记忆后重新打开不再带 region',
    a5.urls.length > 0 && a5.urls[0].indexOf('region=') < 0, a5.urls[0] || '(无请求)')

  /* ================= B 相位：兜底（真实后端 + 预置记忆） ================= */
  // B1 记忆了「天津」，而真实数据里天津 count=0
  const pb = await BROWSER.newPage()
  await pb.enable()
  await pb.addInitScript(initScript('天津', false))
  const b1 = await nav(pb, 'B1')
  ok('B1 记住的地区无数据时，下拉仍显示「天津」（不被回落成首个选项）',
    b1.selValue === '天津' && b1.selText && b1.selText.indexOf('天津') >= 0,
    'selValue=' + JSON.stringify(b1.selValue) + ' selText=' + JSON.stringify(b1.selText))
  ok('B2 空状态说明「天津当前暂无商机」（而非笼统的暂无匹配）',
    b1.emptyText && b1.emptyText.indexOf('天津当前暂无商机') >= 0, 'emptyText=' + JSON.stringify(b1.emptyText))
  ok('B3 空状态提供「查看全部地区」出口', b1.btnTexts.indexOf('查看全部地区') >= 0, JSON.stringify(b1.btnTexts))

  await pb.screenshot('/tmp/v357-b-empty-region.png')

  await pb.eval('(() => { const b = [...document.querySelectorAll(".br-state .br-btn")].find(x => x.textContent.trim() === "查看全部地区"); if (!b) return "no-btn"; b.click(); return "ok" })()')
  await sleep(2200)
  const b2 = JSON.parse(await pb.eval(READ))
  ok('B4 点「查看全部地区」后请求不再带 region',
    b2.urls.length > 0 && b2.urls[b2.urls.length - 1].indexOf('region=') < 0,
    b2.urls[b2.urls.length - 1] || '(无请求)')
  ok('B5 点「查看全部地区」后一并清掉记忆（否则下次打开又空一次）',
    b2.lsRegion === null, 'br_region=' + JSON.stringify(b2.lsRegion))
  ok('B6 回落全部地区后有数据', b2.rowCount > 0, 'rowCount=' + b2.rowCount)

  // B2 相位：记忆值已不在可查询清单里（脏值）
  const pc = await BROWSER.newPage()
  await pc.enable()
  await pc.addInitScript(initScript('火星', false))
  const c1 = await nav(pc, 'C1')
  ok('C1 记忆值已失效时给出提示条（不静默改写选择）',
    c1.notice !== null && c1.notice.indexOf('火星') >= 0 && c1.notice.indexOf('已不在可查询范围') >= 0,
    'notice=' + JSON.stringify(c1.notice))
  ok('C2 失效记忆被清除', c1.lsRegion === null, 'br_region=' + JSON.stringify(c1.lsRegion))
  ok('C3 失效后回落全部地区且有数据（不停在空白列表上）',
    c1.selValue === '' && c1.rowCount > 0, 'selValue=' + JSON.stringify(c1.selValue) + ' rowCount=' + c1.rowCount)
  ok('C4 失效提示只在本次出现（下拉已归位，无残留「默认」标记）',
    c1.chip === null, 'chip=' + JSON.stringify(c1.chip))
  // C5 必须换一个「不预置种子」的页面：沿用 pc 的话，init script 会在每次导航时
  // 把 br_region 重新写回「火星」，于是永远测不出"记忆真的被清掉了"。
  const pc2 = await BROWSER.newPage()
  await pc2.enable()
  await pc2.addInitScript(initScript('__SKIP__', false))
  const c2 = await nav(pc2, 'C5')
  ok('C5 再次打开不再出现失效提示（记忆确实已清）', c2.notice === null, 'notice=' + JSON.stringify(c2.notice))

  /* ================= D 相位：请求失败 ≠ 无数据（打桩 500） ================= */
  const pd = await BROWSER.newPage()
  await pd.enable()
  await pd.addInitScript(initScript('__SKIP__', true))
  const d1 = await nav(pd, 'D1')
  ok('D1 接口失败时显示「加载失败」而不是「暂无匹配的招投标信息」',
    d1.emptyText !== null && d1.emptyText.indexOf('加载失败') >= 0 && d1.emptyText.indexOf('暂无匹配') < 0,
    'emptyText=' + JSON.stringify(d1.emptyText))
  ok('D2 失败态提供「重试」出口', d1.btnTexts.indexOf('重试') >= 0, JSON.stringify(d1.btnTexts))

  await pd.screenshot('/tmp/v357-c-load-failed.png')

  /* ================= 汇总 ================= */
  const pass = R.filter((x) => x.pass).length
  const fail = R.filter((x) => !x.pass)
  R.forEach((x) => console.log((x.pass ? '  PASS  ' : '  FAIL  ') + x.name + (x.extra ? '   [' + x.extra + ']' : '')))
  console.log('')
  console.log('合计 ' + R.length + ' 项：PASS ' + pass + ' / FAIL ' + fail.length)

  if (!R.length) { console.log('FATAL 断言数为 0'); process.exit(2) }
  process.exit(fail.length ? 1 : 0)
} catch (e) {
  console.log('FATAL ' + (e && e.stack ? e.stack : e))
  if (BROWSER) { try { await BROWSER.close() } catch (e2) {} }
  process.exit(3)
} finally {
  if (BROWSER) { try { await BROWSER.close() } catch (e) {} }
}
