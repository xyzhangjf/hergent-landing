/**
 * v700 回归：副驾头像在「租户 cookie 异常」时是否还回落 🚀
 *
 * 老板报「头像回退成火箭」，根因是 <img> 带不了 X-Tenant-Id，只能靠 cookie。
 * 本探针跑两个 case，断言**都必须渲染出 256x256 的真 PNG**：
 *   case1 正常登录态
 *   case2 故意塞一个该账号**无权**的 hergent_tenant（复现老板的残留 cookie 场景）
 */
import { chromium } from 'playwright'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const TOKEN = process.env.HG_TOKEN
const BASE = 'https://hergent.cn'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

let pass = 0, fail = 0
const ok = (c, msg) => { if (c) { pass++; console.log('  ✅', msg) } else { fail++; console.log('  ❌', msg) } }

async function runCase(label, extraCookies, shot) {
  console.log('\n=== ' + label + ' ===')
  const b = await chromium.launch({ headless: true, executablePath: CHROME })
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addCookies([
    { name: 'erp_token', value: TOKEN, url: BASE + '/' },
    { name: 'hergent_auth', value: '1', url: BASE + '/' },
    ...extraCookies
  ])
  const p = await ctx.newPage()
  const reqs = []
  p.on('response', async (r) => {
    if (r.url().includes('/avatar')) {
      let len = 0
      try { len = (await r.body()).length } catch { }
      reqs.push({ s: r.status(), t: r.headers()['content-type'], len })
    }
  })
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  await sleep(4000)
  const btn = p.locator('.tb-copilot').first()
  if (await btn.count()) await btn.click().catch(() => { })
  await sleep(3000)

  ok(await p.locator('.copilot').count() === 1, '副驾抽屉已打开')

  const img = p.locator('.cp-ai-img-png').first()
  ok(await img.count() === 1, '顶栏渲染的是 <img>（不是 emoji 文本）')
  if (await img.count()) {
    const info = await img.evaluate(el => ({
      w: el.naturalWidth, h: el.naturalHeight, src: el.getAttribute('src')
    }))
    ok(info.w === 256 && info.h === 256, `顶栏头像真解码 256x256（实际 ${info.w}x${info.h}，src=${info.src}）`)
  }
  // 不允许出现 🚀 文本节点
  const rocket = await p.locator('.cp-ai-img').first().innerText().catch(() => '')
  ok(!rocket.includes('🚀'), `顶栏无 🚀 回落（容器文本="${rocket.trim()}"）`)

  for (const sel of ['.cp-who-av', '.cp-role-av']) {
    const n = await p.locator(sel + ' img').count()
    ok(n === 1, `${sel} 是 img 而非 emoji`)
  }
  ok(reqs.length > 0 && reqs.every(r => r.s === 200), `头像请求全 200：${JSON.stringify(reqs)}`)

  await p.screenshot({ path: shot })
  await b.close()
}

// case1：正常
await runCase('case1 正常登录态', [], 'outputs/v700-头像/1-正常登录.png')
// case2：塞一个无权租户（uid4 属于租户 10，1 是老板的租户 ⇒ 无权）
await runCase('case2 cookie 残留无权租户(=1)', [
  { name: 'hergent_tenant', value: '1', url: BASE + '/' }
], 'outputs/v700-头像/2-cookie残留无权租户.png')

console.log(`\n===== 合计 ${pass} 过 / ${fail} 败 =====`)
process.exit(fail ? 1 : 0)
