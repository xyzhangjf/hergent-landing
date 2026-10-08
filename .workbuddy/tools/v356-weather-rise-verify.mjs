/**
 * v356 真机验收：天气面板「升」/「降」字样
 *
 * 判据（正 + 负两侧，缺一不可）：
 *   正：喂「相邻日最高温差 ≥3°C（一升一降）」⇒ .up em 文本 = 升、.down em 文本 = 降
 *   负：喂「相邻差都 <3°C」 ⇒ 一个 .wx-trend-dot 都不该有 em（证明上面那条不是恒真）
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'

const BASE = 'https://hergent.cn'
const ok = [], bad = []
const chk = (name, pass, extra = '') => (pass ? ok : bad).push(`${pass ? 'PASS' : 'FAIL'} ${name}${extra ? ' :: ' + extra : ''}`)

// 真实契约（取自生产 GET /api/weather）
const mkPayload = (tmaxs) => ({
  success: true, city: '武汉', lat: 30.5833, lon: 114.2667,
  temp: tmaxs[0] - 4, code: 51,
  days: tmaxs.map((t, i) => ({
    date: `2026-10-0${i + 1}`, tmax: t, tmin: t - 6, pop: 50, code: 3,
  })),
})
const P_UP_DOWN = mkPayload([20.0, 24.0, 18.0, 19.0, 20.0]) // Δ: +4(up) -6(down) +1 +1
const P_FLAT = mkPayload([20.0, 21.0, 20.5, 21.2, 21.0])    // Δ 全 < 3 ⇒ 无拐点

const stub = (payload) => `
(() => {
  try {
    localStorage.setItem('hergent_v2_token', ${JSON.stringify(process.env.HG_TOKEN)});
    localStorage.setItem('hergent_v2_user', JSON.stringify({role:'boss',name:'探针'}));
    localStorage.setItem('hergent_v2_tenant', '10');
  } catch (e) {}
  const P = ${JSON.stringify(payload)};
  const _f = window.fetch;
  window.fetch = function (input, init) {
    const url = (typeof input === 'string') ? input : (input && input.url) || '';
    if (/\\/api\\/weather(\\?|$)/.test(url))
      return Promise.resolve(new Response(JSON.stringify(P), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    if (/\\/api\\/weather\\/pref/.test(url))
      return Promise.resolve(new Response(JSON.stringify({ success: true, city: '' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    return _f.apply(this, arguments);
  };
})()`

const READ = `(() => {
  const q = (s) => [...document.querySelectorAll(s)].map(e => e.textContent.trim());
  return JSON.stringify({
    popOpen: !!document.querySelector('.wx-pop'),
    trendWrap: !!document.querySelector('.wx-trend-wrap'),
    dotTotal: document.querySelectorAll('.wx-trend-dot').length,
    upDots: document.querySelectorAll('.wx-trend-dot.up').length,
    downDots: document.querySelectorAll('.wx-trend-dot.down').length,
    upTexts: q('.wx-trend-dot.up em'),
    downTexts: q('.wx-trend-dot.down em'),
    anyEmTexts: q('.wx-trend-dot em'),
  });
})()`

async function phase(browser, name, payload, expect) {
  const page = await browser.newPage()
  await page.enable()
  const id = await page.addInitScript(stub(payload))
  await page.goto(BASE + '/?cb=' + Date.now(), 5000)
  // 打开天气面板
  const clicked = await page.eval(`(() => { const b = document.querySelector('.wx-now'); if (!b) return false; b.click(); return true })()`)
  await new Promise(r => setTimeout(r, 1200))
  const raw = await page.eval(READ)
  const r = JSON.parse(raw)
  console.log(`\n===== ${name} =====`)
  console.log(JSON.stringify(r, null, 2))
  console.log('errors:', JSON.stringify(page.errors.slice(0, 3)))

  chk(`${name} · 面板已展开`, r.popOpen)
  chk(`${name} · 趋势容器已渲染`, r.trendWrap)
  chk(`${name} · 升拐点数量`, r.upDots === expect.up, `期望 ${expect.up} 实得 ${r.upDots}`)
  chk(`${name} · 降拐点数量`, r.downDots === expect.down, `期望 ${expect.down} 实得 ${r.downDots}`)
  if (expect.up > 0) {
    chk(`${name} · 升字渲染`, r.upTexts.length === expect.up && r.upTexts.every(t => t === '升'), JSON.stringify(r.upTexts))
  }
  if (expect.down > 0) {
    chk(`${name} · 降字渲染`, r.downTexts.length === expect.down && r.downTexts.every(t => t === '降'), JSON.stringify(r.downTexts))
  }
  // 负对照：无拐点 ⇒ 一个 em 都不该有
  if (expect.up === 0 && expect.down === 0) {
    chk(`${name} · 负对照：无任何升降字样`, r.anyEmTexts.length === 0, JSON.stringify(r.anyEmTexts))
  }
  await page.screenshot(`/tmp/v356-weather-${name}.png`)
  await page.removeInitScript(id)
  return r
}

const browser = await launch({ headless: true })
let BROWSER = browser
try {
  await phase(browser, 'A-有升有降', P_UP_DOWN, { up: 1, down: 1 })
  await phase(browser, 'B-无拐点', P_FLAT, { up: 0, down: 0 })
} catch (e) {
  bad.push('FATAL ' + e.message)
} finally {
  if (BROWSER) await BROWSER.close()
}

console.log('\n================ 结果 ================')
ok.forEach(l => console.log('  ' + l))
bad.forEach(l => console.log('  ' + l))
console.log(`\n${ok.length} PASS / ${bad.length} FAIL`)
process.exit(bad.length ? 1 : 0)
