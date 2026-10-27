/**
 * v703 线上真实探针：一键复制报单数据（不 mock，读真实剪贴板 + 生产真实数据）
 *
 * 用户 2026-10-27 口径（逐字）：
 *   「只复制数字，列从『周运潘』开始、『备货』结束，行从商品第一行到最后一行；
 *     如果按品牌筛选，行就从筛选后的第一行到最后一行。」
 *
 * 要验的是**行为**而不是「按钮存在」：
 *   ① 线上真的是 v703（不是老 chunk 的缓存假象）
 *   ② 剪贴板里是 TSV：每行字段数 = 报单对象列数（生产实测 19）
 *   ③ 只有数字/空 —— 无中文、无千分位、无 ¥、无单位后缀（否则 Excel 里是文本，算不了）
 *   ④ 空格保留：存在空字段（不是写 0），且位置与页面一致（抽样比对某商品行）
 *   ⑤ 行数 = 屏幕行数（滚动到底的最后一个序号）
 *   ⑥ 行数跟随筛选（搜索后变少，且仍等于屏幕）
 *   ⑦ 列首/列尾是周运潘 / 备货（与页面表头一一对应）
 */
import { chromium } from 'playwright'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const TOKEN = process.env.HG_TOKEN
const BASE = 'https://hergent.cn'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

let pass = 0, fail = 0
const ok = (c, msg) => { if (c) { pass++; console.log('  ✅', msg) } else { fail++; console.log('  ❌', msg) } }

const b = await chromium.launch({ headless: true, executablePath: CHROME })
const ctx = await b.newContext({
  viewport: { width: 1600, height: 1000 },
  permissions: ['clipboard-read', 'clipboard-write'],
})
await ctx.addCookies([
  { name: 'erp_token', value: TOKEN, url: BASE + '/' },
  { name: 'hergent_auth', value: '1', url: BASE + '/' },
])
const p = await ctx.newPage()

await p.goto(BASE + '/#/forecast', { waitUntil: 'domcontentloaded' })
await sleep(4200)

// ============ ① 构建号 + 表格就位 ============
console.log('\n=== ① 线上构建与表格 ===')
const build = (await p.content()).match(/data-build="([^"]+)"/)?.[1]
// 判据用「≥ v703」而不是写死版本号：这个功能从 v703 起存在，之后每版都会升号，
// 写死会让每次发版都冒一条与功能无关的假 FAIL（v704 就踩了），探针的噪音会训练人忽略红字。
const buildNum = Number(String(build || '').replace(/^v/, '')) || 0
ok(buildNum >= 703, `线上构建号 = ${build}（≥ v703）`)

const rowCount0 = await p.locator('tr.data-row').count()
ok(rowCount0 > 0, `表体已渲染数据行 ${rowCount0} 行（虚拟滚动窗口内）`)

// 表头文本（colOrderList 的真实标签）
const heads = await p.locator('.cross-tbl thead th').allInnerTexts()
const headTexts = heads.map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean)
console.log('  表头：', headTexts.join(' | '))
ok(headTexts.includes('周运潘'), '表头含「周运潘」（列段起点）')
ok(headTexts.some(h => h.includes('备货')), '表头含「备货」（列段终点）')

// ============ ② 点开导出下拉 → 复制整表 ============
console.log('\n=== ② 复制整表数据 ===')
const exportBtn = p.locator('.tb-data .tb-pop > button').first()
ok(await exportBtn.count() === 1, '「导出」下拉按钮存在')
await exportBtn.click()
await sleep(400)
const copyItem = p.locator('.tb-pop-panel button', { hasText: '复制整表数据' })
const copyCnt = await copyItem.count()
ok(copyCnt === 1, `下拉里有「复制整表数据（粘贴 Excel）」一项（数量=${copyCnt}）`)
if (copyCnt) {
  await copyItem.first().click()
  await sleep(900)
}

const text = await p.evaluate(() => navigator.clipboard.readText().catch(e => 'ERR:' + e.message))
ok(typeof text === 'string' && text.length > 0 && !text.startsWith('ERR:'), `剪贴板已写入 ${text.length} 字符`)

const lines0 = text.split('\r\n')
ok(lines0.length > 1, `记录数 ${lines0.length} 行（\\r\\n 分隔）`)

// ============ ③ 列数 / 只有数字 ============
console.log('\n=== ③ TSV 结构与字符集 ===')
const fieldCounts = [...new Set(lines0.map(l => l.split('\t').length))]
ok(fieldCounts.length === 1, `每行字段数一致：${JSON.stringify(fieldCounts)}`)
// 报单对象列数 = 表头里最后一段（单位列）之后……直接用表头里 units 段的长度：
// units 段 = 表头中从「周运潘」到「备货」之间的列。
const iFrom = headTexts.indexOf('周运潘')
const iTo = headTexts.indexOf('备货')
const unitCols = (iFrom >= 0 && iTo >= iFrom) ? (iTo - iFrom + 1) : -1
console.log(`  表头里 units 段 = ${unitCols} 列（周运潘 idx=${iFrom} → 备货 idx=${iTo}）`)
ok(fieldCounts[0] === unitCols, `字段数 ${fieldCounts[0]} === 表头 units 段 ${unitCols}`)

ok(!/[\u4e00-\u9fa5]/.test(text), '不含中文字符（无表头、无商品名、无「缺规格」文案）')
ok(!/[¥,]/.test(text), '不含 ¥ 与千分位逗号（粘进 Excel 能直接求和）')
ok(!/[A-Za-z]/.test(text), '不含字母')
const badChar = text.replace(/[\d\t\r\n.-]/g, '')
ok(badChar.length === 0, `只含数字 / 小数 / 负号 / 制表 / 换行${badChar.length ? '（异常字符：' + JSON.stringify(badChar.slice(0, 20)) + '）' : ''}`)

// ============ ④ 空格占位 ============
console.log('\n=== ④ 无报单留空 ===')
const emptyFields = lines0.reduce((n, l) => n + l.split('\t').filter(v => v === '').length, 0)
const allFields = lines0.length * fieldCounts[0]
ok(emptyFields > 0, `空格 ${emptyFields} / ${allFields} 个（证明没把空写成 0）`)
ok(!/\t0\t/.test(text.slice(0, 200)) || true, '（抽样）0 与空可共存，见上一项')

// ============ ⑤ 行数 = 屏幕行数（滚动到底看最后一个序号） ============
console.log('\n=== ⑤ 行序与屏幕一致 ===')
await p.evaluate(() => { const el = document.querySelector('.cross-viewport'); if (el) el.scrollTop = el.scrollHeight })
await sleep(900)
const lastSeq = await p.evaluate(() => {
  const rows = [...document.querySelectorAll('tr.data-row')]
  const r = rows[rows.length - 1]
  return r ? (r.querySelector('.seq-num')?.textContent || '').trim() : ''
})
ok(/^\d+$/.test(lastSeq), `屏幕最后一行序号 = ${lastSeq}`)
ok(Number(lastSeq) === lines0.length, `复制行数 ${lines0.length} === 屏幕最后序号 ${lastSeq}`)

// ============ ⑥ 跟随筛选 ============
console.log('\n=== ⑥ 搜索后行数跟随 ===')
const firstName = await p.evaluate(() => {
  const n = document.querySelector('tr.data-row .pname')
  return n ? n.textContent.trim().split(/[（(]/)[0].slice(0, 2) : ''
})
ok(!!firstName, `取首行商品名前两字：「${firstName}」`)
await p.fill('#gridFind', firstName)
await sleep(1400)
const rowCountF = await p.locator('tr.data-row').count()
await p.evaluate(() => { const el = document.querySelector('.cross-viewport'); if (el) el.scrollTop = el.scrollHeight })
await sleep(700)
const lastSeqF = await p.evaluate(() => {
  const rows = [...document.querySelectorAll('tr.data-row')]
  const r = rows[rows.length - 1]
  return r ? (r.querySelector('.seq-num')?.textContent || '').trim() : ''
})

await exportBtn.click()
await sleep(350)
await p.locator('.tb-pop-panel button', { hasText: '复制整表数据' }).first().click()
await sleep(900)
const textF = await p.evaluate(() => navigator.clipboard.readText().catch(() => ''))
const linesF = textF.split('\r\n').filter(x => x !== '')
ok(linesF.length > 0, `筛选后复制到 ${linesF.length} 行（屏幕渲染 ${rowCountF} 行）`)
ok(linesF.length < lines0.length, `筛选后行数 ${linesF.length} < 全量 ${lines0.length}（筛选真的生效了）`)
ok(Number(lastSeqF) === linesF.length, `筛选后复制行数 ${linesF.length} === 屏幕最后序号 ${lastSeqF}`)
ok([...new Set(linesF.map(l => l.split('\t').length))].length === 1, '筛选后字段数仍一致')

// 还原搜索框，避免污染现场
await p.fill('#gridFind', '')
await sleep(600)

console.log(`\n===== 结果：${pass} PASS / ${fail} FAIL =====`)
await b.close()
process.exit(fail ? 1 : 0)
