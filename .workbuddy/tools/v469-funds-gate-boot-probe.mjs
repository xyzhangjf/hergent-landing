/**
 * v469（2026-10-11）资金管理**能力闸门** —— 生产真机 boot 只读探针
 *
 * 目的（只读，不写任何业务数据）：证明「构建→部署→生产运行」这条链是**真的**
 *   （而不是只在本地/源码里看着对）。七项判据：
 *   ① entry 必须是本轮构建产物 `index-DvUY-fp3.js`（防止"部署了旧包"）
 *   ② 0 个 pageerror（白屏的第一现场）
 *   ③ 0 个非 401 失败请求（401 = 未登录的预期状态，不算失败）
 *   ④ 资金相关 chunk 全部 200（404 = 部署漏文件；本机代理会把失败伪装成 502）
 *   ⑤ bundle 里确实编进 28 条 `funds/*` 路由（防"路由没 applying"的假上线）
 *   ⑥ Shell chunk 含侧栏入口「资金管理」+ 28 个子页名（v468 踩过：判据放错 chunk）
 *   ⑦ Settings chunk 含权限页**四新区名**（仓配/资金/市场/报表）—— 即本轮 v469 的
 *      permView 补齐（①栏「权限页组名 == 侧栏一级项名」的产物）
 *
 * 🔴 探针纪律（本机多次实测的坑）：
 *   · ESM **不看 NODE_PATH** ⇒ 必须写绝对路径 import，且 CommonJS 只能 default import。
 *   · 本机 ms-playwright 没下 chromium（本地代理 127.0.0.1:63932 连重试超时）
 *     ⇒ 复用系统 Google Chrome 的 `executablePath`（与 memory 记的做法一致）。
 *   · **判据别放错 chunk**：侧栏入口名与子页名在 **Shell** chunk，不在 index chunk。
 *   · `APIResponse.status` 是**方法**（`r.status()`），不是属性 —— 取值/打印处要一致。
 */
import pw from '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/node_modules/playwright/index.js'
const { chromium } = pw

const EXPECTED_ENTRY = 'index-DvUY-fp3.js'
const SHELL_CHUNK = 'Shell-6bemhQGy.js'
const SETTINGS_CHUNK = 'Settings-CKNnxe8x.js'
const FUND_CHUNKS = [
  'FundsDoc-Byfy1JDF.js',
  'FundsBalance-B8Shvn9w.js',
  'FundsFlow-Buw1hiwn.js',
  'FundsStatement-BjXTyUSZ.js',
  'FundsCost-CGS3qjqv.js',
  'FundsStaffDebt-CRC-CyYJ.js',
  'FundsBankReconcile-CD5aAcmb.js',
  'funds-LLv7dzfd.js'
]
const NAV_SAMPLES = ['收款单', '资金余额表', '银行流水对账', '员工欠款', '成本异常调整', '供应商对账明细']
const SETTINGS_GROUPS = ['仓配管理', '资金管理', '市场营销', '数据报表']

const pageErrors = []
const badRequests = []
const loadedUrls = []

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
})
const page = await browser.newPage()

page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 200)))
page.on('response', (r) => {
  const u = r.url()
  loadedUrls.push(u)
  if (r.status() >= 400 && r.status() !== 401) badRequests.push(`${r.status()} ${u.slice(0, 120)}`)
})

await page.goto('https://hergent.cn/', { waitUntil: 'networkidle', timeout: 45000 })
await page.waitForTimeout(1500)

const entryOk = loadedUrls.some((u) => u.includes(EXPECTED_ENTRY))
const actualEntry = loadedUrls
  .filter((u) => /assets\/index-[A-Za-z0-9_-]+\.js/.test(u))
  .map((u) => u.split('/').pop())

const chunkResults = []
for (const c of FUND_CHUNKS) {
  const r = await page.request.get(`https://hergent.cn/assets/${c}`)
  const st = typeof r.status === 'function' ? r.status() : r.status
  chunkResults.push({ chunk: c, status: st })
}

const bundleText = await (await page.request.get(`https://hergent.cn/assets/${EXPECTED_ENTRY}`)).text()
const fundRouteCount = (bundleText.match(/funds\/[a-z-]+/g) || []).length

const shellText = await (await page.request.get(`https://hergent.cn/assets/${SHELL_CHUNK}`)).text()
const hasFundsNav = shellText.includes('资金管理')
const navHit = NAV_SAMPLES.filter((n) => shellText.includes(n))

const settingsText = await (await page.request.get(`https://hergent.cn/assets/${SETTINGS_CHUNK}`)).text()
const settingsHit = SETTINGS_GROUPS.filter((g) => settingsText.includes(g))

await browser.close()

const chunksOk = chunkResults.every((r) => r.status === 200)
const allPass = entryOk && pageErrors.length === 0 && badRequests.length === 0 &&
  chunksOk && fundRouteCount >= 28 && hasFundsNav && settingsHit.length === SETTINGS_GROUPS.length

console.log('\n===== v469 资金管理能力闸门 · 生产真机 boot 探针 =====\n')
console.log(`entry 期望        : ${EXPECTED_ENTRY}`)
console.log(`entry 实际        : ${actualEntry.join(', ') || '(未捕获)'}`)
console.log(`① entry 正确      : ${entryOk ? 'PASS' : 'FAIL'}`)
console.log(`② pageerror 数    : ${pageErrors.length}${pageErrors.length ? ' -> ' + pageErrors[0] : ''}  ${pageErrors.length === 0 ? 'PASS' : 'FAIL'}`)
console.log(`③ 非401 失败请求  : ${badRequests.length}${badRequests.length ? ' -> ' + badRequests.slice(0, 3).join(' | ') : ''}  ${badRequests.length === 0 ? 'PASS' : 'FAIL'}`)
console.log(`④ 资金 chunk 200  : ${chunkResults.filter((r) => r.status === 200).length}/${chunkResults.length}  ${chunksOk ? 'PASS' : 'FAIL'}`)
chunkResults.filter((r) => r.status !== 200).forEach((r) => console.log(`    ↳ ${r.status} ${r.chunk}`))
console.log(`⑤ bundle 含资金路由: ${fundRouteCount} 条 funds/* 引用  ${fundRouteCount >= 28 ? 'PASS' : 'FAIL'}`)
console.log(`⑥ Shell 含「资金管理」: ${hasFundsNav ? 'PASS' : 'FAIL'} （子页名抽样命中 ${navHit.length}/${NAV_SAMPLES.length}）`)
console.log(`⑦ Settings(权限页)四新区: ${settingsHit.length}/${SETTINGS_GROUPS.length} ${settingsHit.length === SETTINGS_GROUPS.length ? 'PASS' : 'FAIL'} ${settingsHit.join(' / ')}`)
console.log(`\n结论: ${allPass ? '✅ ALL PASS' : '❌ 有 FAIL 项，见上'}`)
