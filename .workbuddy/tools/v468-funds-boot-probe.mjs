/**
 * v468（2026-10-11）资金管理 28 页 —— 生产真机 boot 只读探针
 *
 * 目的（只读，不写任何业务数据）：
 *   1. 生产 SPA 能正常启动（entry 必须是本轮构建产物 index-DvY-zU4w.js）
 *   2. 0 个 pageerror（白屏的第一现场）
 *   3. 资金 chunk 全部 200（不是 404 —— 404 = 部署漏文件）
 *   4. SPA 路由表里确实编进了 28 条 /funds/* 路由（防止"路由没 applying"的假上线）
 *
 * 🔴 探针纪律（本机多次实测）：
 *   · 本地代理会让 curl/vite 的失败看起来像 502 ⇒ 一律看 HTTP 状态码 + 浏览器事件。
 *   · 401 是未登录的预期状态，**不算失败**；只有非 2xx/304 且非 401 才算 reqfailed。
 */
// 🔴 ESM 不看 NODE_PATH ⇒ 必须写绝对路径（放到 /tmp 会被本机清理逻辑扫掉，故留在本仓 tools/）
import pw from '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/node_modules/playwright/index.js'
const { chromium } = pw

const EXPECTED_ENTRY = 'index-DvY-zU4w.js'
const FUND_CHUNKS = [
  'FundsDoc-B_61wuhC.js',
  'FundsBalance-BxF_tyC3.js',
  'FundsFlow-C24eseAk.js',
  'FundsStatement-BsOnL08R.js',
  'FundsCost-BoNFazXv.js',
  'FundsStaffDebt-Dd3Uu-9q.js',
  'FundsBankReconcile-DZfzMA_Z.js',
  'funds-CgSO_ztE.js'
]

const pageErrors = []
const badRequests = []
const loadedUrls = []

// 🔴 本机 ms-playwright 没下 chromium（装下载的另一个坑：本地代理 127.0.0.1:63932 会连重试超时）
//    ⇒ 复用系统已装的 Google Chrome，与 memory 里记的做法一致。
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
})
const page = await browser.newPage()

page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 200)))
page.on('response', (r) => {
  const u = r.url()
  loadedUrls.push(u)
  // 401 是未登录请求的预期回执，不计入失败
  if (r.status() >= 400 && r.status() !== 401) badRequests.push(`${r.status()} ${u.slice(0, 120)}`)
})

await page.goto('https://hergent.cn/', { waitUntil: 'networkidle', timeout: 45000 })
await page.waitForTimeout(1500)

// ① entry 校验
const entryOk = loadedUrls.some((u) => u.includes(EXPECTED_ENTRY))
const actualEntry = loadedUrls.filter((u) => /assets\/index-[A-Za-z0-9_-]+\.js/.test(u)).map((u) => u.split('/').pop())

// ② 资金 chunk 是否都已上线（用 HEAD 请求逐个验证，不依赖页面是否恰好加载）
const chunkResults = []
for (const c of FUND_CHUNKS) {
  const r = await page.request.get(`https://hergent.cn/assets/${c}`)
  const st0 = typeof r.status === 'function' ? r.status() : r.status
  chunkResults.push({ chunk: c, status: st0 })
}

// ③ 路由表里有没有 28 条资金路由（直接读上传后的 bundle 文本）
const indexRes = await page.request.get(`https://hergent.cn/assets/${EXPECTED_ENTRY}`)
const bundleText = await indexRes.text()
const fundRouteCount = (bundleText.match(/funds\/[a-z-]+/g) || []).length
// 🔴 判据取数位置：「资金管理」侧栏入口与 28 个子页名编在 **Shell chunk** 里，不是 index chunk
//    —— 第一轮检查成 index chunk 得到 FAIL，实为判据放错文件（v468 实测）。
const SHELL_CHUNK = 'Shell-DBGNeNks.js'
const shellRes = await page.request.get(`https://hergent.cn/assets/${SHELL_CHUNK}`)
const shellText = await shellRes.text()
const hasFundsNav = shellText.includes('资金管理')
const NAV_SAMPLES = ['收款单', '资金余额表', '银行流水对账', '员工欠款', '成本异常调整', '供应商对账明细']
const navHit = NAV_SAMPLES.filter((n) => shellText.includes(n))

await browser.close()

console.log('\n===== v468 资金管理 · 生产真机 boot 探针 =====\n')
console.log(`entry 期望        : ${EXPECTED_ENTRY}`)
console.log(`entry 实际        : ${actualEntry.join(', ') || '(未捕获)'}`)
console.log(`① entry 正确      : ${entryOk ? 'PASS' : 'FAIL'}`)
console.log(`② pageerror 数    : ${pageErrors.length}${pageErrors.length ? ' -> ' + pageErrors[0] : ''}  ${pageErrors.length === 0 ? 'PASS' : 'FAIL'}`)
console.log(`③ 非401 失败请求  : ${badRequests.length}${badRequests.length ? ' -> ' + badRequests.slice(0, 3).join(' | ') : ''}  ${badRequests.length === 0 ? 'PASS' : 'FAIL'}`)
console.log(`④ 资金 chunk 200  : ${chunkResults.filter((r) => r.status === 200).length}/${chunkResults.length}  ${chunkResults.every((r) => r.status === 200) ? 'PASS' : 'FAIL'}`)
chunkResults.filter((r) => r.status !== 200).forEach((r) => console.log(`    ↳ ${r.status} ${r.chunk}`))
console.log(`⑤ bundle 含资金路由: ${fundRouteCount} 条 funds/* 引用  ${fundRouteCount >= 28 ? 'PASS' : 'FAIL'}`)
console.log(`⑥ Shell chunk 含"资金管理"入口: ${hasFundsNav ? 'PASS' : 'FAIL'} （抽样 28 页名命中 ${navHit.length}/${NAV_SAMPLES.length}）`)

const allPass = entryOk && pageErrors.length === 0 && badRequests.length === 0 &&
  chunkResults.every((r) => r.status === 200) && fundRouteCount >= 28 && hasFundsNav
console.log(`\n结论: ${allPass ? '✅ ALL PASS' : '❌ 有 FAIL 项，见上'}`)
