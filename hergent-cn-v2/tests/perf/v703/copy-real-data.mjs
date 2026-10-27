/**
 * v703 线上真实探针（有数据期次）：复制 / 导出 / 数据库 三方逐格对齐
 *
 * 上一支（copy.mjs）跑的是「2026-10-27 期次」，而生产实测该期 **0 条报单** ⇒ 复制出的
 * 5586 格全是空 —— 结构验到了，取值没验到。本支切到**真有报单的期次 37**（22 单 / 29 明细 / 570 件），
 * 把三方摆在一起比：
 *   ① 剪贴板（复制整表）
 *   ② 导出 Excel（Q4 要求与复制同源）
 *   ③ 数据库 SQL（唯一真值，期望值由 SSH 只读生成到 /tmp，不落 outputs/）
 *
 * 判据是**逐格等价**：把每行截成「19 列的数量向量」再比，向量相同即证明
 * 列序对齐（谁报的在谁那一列）、空格位置对齐、数值口径一致。
 */
import { chromium } from 'playwright'
import * as XLSXns from 'xlsx'
import fs from 'node:fs'
// xlsx 是 CJS 包：ESM 下 readFile/utils 挂在 default 上，命名空间里只有部分导出
const XLSX = XLSXns.default || XLSXns

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const TOKEN = process.env.HG_TOKEN
const BASE = 'https://hergent.cn'
const PERIOD = process.env.HG_PERIOD || '37'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

let pass = 0, fail = 0
const ok = (c, msg) => { if (c) { pass++; console.log('  ✅', msg) } else { fail++; console.log('  ❌', msg) } }

const expect = JSON.parse(fs.readFileSync('/tmp/v703-expect-37.json', 'utf8'))
console.log(`期望（数据库真值）：${expect.n} 个有报单商品行 × ${expect.units.length} 列`)

const b = await chromium.launch({ headless: true, executablePath: CHROME })
const ctx = await b.newContext({
  viewport: { width: 1600, height: 1000 },
  permissions: ['clipboard-read', 'clipboard-write'],
  acceptDownloads: true,
})
await ctx.addCookies([
  { name: 'erp_token', value: TOKEN, url: BASE + '/' },
  { name: 'hergent_auth', value: '1', url: BASE + '/' },
])
const p = await ctx.newPage()

await p.goto(BASE + '/#/forecast', { waitUntil: 'domcontentloaded' })
await sleep(4200)

// ============ 切到有报单的期次 ============
console.log(`\n=== 切到期次 ${PERIOD} ===`)
await p.selectOption('.sel-period', PERIOD)
await sleep(5200)
const headsRaw = await p.locator('.cross-viewport thead th').allInnerTexts()
/* 🔴 第一列表头在屏幕上渲染的是**齿轮按钮**（列设置入口），`innerText` 是空串。
   不能 `filter(Boolean)` —— 那会把这一列整根滤掉，之后所有列索引集体左移一位，
   于是「导出 31 列 vs 屏幕 30 列」会变成一条假 FAIL（本轮就是这么踩到的）。
   与导出口径对齐：这一列的数据是行序号，表头就叫「序号」。 */
const heads = headsRaw.map(s => s.replace(/\s+/g, ' ').trim() || '序号')
ok(heads[0] === '序号', `屏幕首列 = ${heads[0]}（屏幕上显示为齿轮，数据是行序号）`)
const iFrom = heads.indexOf(expect.units[0])
const iTo = heads.indexOf(expect.units[expect.units.length - 1])
ok(iFrom >= 0 && iTo > iFrom, `表头 units 段：${expect.units[0]}(idx=${iFrom}) → ${expect.units[expect.units.length - 1]}(idx=${iTo})`)
ok(iTo - iFrom + 1 === expect.units.length, `表头 units 列数 ${iTo - iFrom + 1} === 数据库名册 ${expect.units.length}`)

const rowCnt = await p.locator('tr.data-row').count()
ok(rowCnt > 0, `表体渲染 ${rowCnt} 行`)

// ============ ① 复制 ============
console.log('\n=== ① 剪贴板 vs 数据库 ===')
const exportBtn = p.locator('.tb-data .tb-pop > button').first()
await exportBtn.click()
await sleep(400)
await p.locator('.tb-pop-panel button', { hasText: '复制整表数据' }).first().click()
await sleep(1000)
const text = await p.evaluate(() => navigator.clipboard.readText().catch(() => ''))
const lines = text.split('\r\n')
ok(lines.length > 0, `剪贴板 ${lines.length} 行`)
// 复制回执：不含商品名 ⇒ 用户粘错位时唯一能自查的锚点，必须真有这句
const toastTxt = await p.evaluate(() => [...document.querySelectorAll('.toast')].map(e => e.textContent.trim()).join(' || '))
ok(/已复制\s*\d+\s*行\s*×\s*\d+\s*列/.test(toastTxt) && /商品\s/.test(toastTxt), `回执：${toastTxt.replace(/\s+/g, ' ').slice(0, 130)}`)

// 全空行是页面上「本期导入但没人报」的商品行，保留是正确的；比对只看有报单的行
const vecOf = (l) => l.split('\t').map(v => String(v).trim()).join('::')
const clipVecs = lines.map(vecOf).filter(v => v.replace(/::/g, '') !== '')
const emptyRows = lines.length - clipVecs.length
console.log(`  有报单行 ${clipVecs.length} 行；全空行 ${emptyRows} 行（页面上的 0 报单商品，占位保留）`)
ok(clipVecs.length === expect.n, `有报单行数 ${clipVecs.length} === 数据库 ${expect.n}`)

const a = [...clipVecs].sort()
const b2 = [...expect.vecs].sort()
let diff = 0, firstDiff = ''
for (let i = 0; i < Math.max(a.length, b2.length); i++) {
  if (a[i] !== b2[i]) { diff++; if (!firstDiff) firstDiff = `剪贴板[${i}]=${JSON.stringify(a[i])} / 数据库[${i}]=${JSON.stringify(b2[i])}` }
}
ok(diff === 0, diff === 0 ? '逐格等价：19 列 × 3 行的数量向量与数据库完全一致' : `有 ${diff} 行不等 → ${firstDiff}`)
if (diff) {
  console.log('  剪贴板：', a.slice(0, 3))
  console.log('  数据库：', b2.slice(0, 3))
}

// 列序断言（抽一行：东津那一列必须等于数据库里东津的数）
const idxDongjin = expect.units.indexOf('东津')
const anyWith = b2.find(v => v.split('::')[idxDongjin] !== '')
ok(!!anyWith, `抽样：东津在第 ${idxDongjin + 1} 列，该列有值 ${anyWith ? anyWith.split('::')[idxDongjin] : '—'}`)

// ============ ② 导出 Excel 与剪贴板同源 ============
console.log('\n=== ② 导出 Excel vs 剪贴板 ===')
await exportBtn.click()
await sleep(350)
const [dl] = await Promise.all([
  p.waitForEvent('download', { timeout: 20000 }),
  p.locator('.tb-pop-panel button', { hasText: '导出全部' }).first().click(),
])
const xp = '/tmp/v703-export.xlsx'
await dl.saveAs(xp)
await sleep(300)
const wb = XLSX.readFile(xp)
const ws = wb.Sheets[wb.SheetNames[0]]
const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' })
const xHead = (aoa[0] || []).map(v => String(v).trim())
console.log(`  导出表头 ${xHead.length} 列：${xHead.join(' | ')}`)
ok(xHead.length === heads.length, `导出列数 ${xHead.length} === 屏幕列数 ${heads.length}`)
ok(xHead[0] === '序号', `首列是「序号」（导出保留了屏幕第一列）`)
ok(xHead.join('|') === heads.join('|'), '导出表头与屏幕表头**逐列同名同序**')

const xFrom = xHead.indexOf(expect.units[0])
const xTo = xHead.indexOf(expect.units[expect.units.length - 1])
ok(xTo - xFrom + 1 === expect.units.length, `导出里 units 段列数 = ${xTo - xFrom + 1}`)

const bodyRows = aoa.slice(1)
const xVecs = bodyRows
  .map(r => r.slice(xFrom, xTo + 1).map(v => String(v == null ? '' : v).trim()).join('::'))
  .filter(v => v.replace(/::/g, '') !== '')
console.log(`  导出有报单行 ${xVecs.length} 行（总 ${bodyRows.length} 行）`)
ok(xVecs.length === expect.n, `导出的有报单行数 ${xVecs.length} === 数据库 ${expect.n}`)
const xs = [...xVecs].sort()
let diff2 = 0
for (let i = 0; i < Math.max(xs.length, b2.length); i++) if (xs[i] !== b2[i]) diff2++
ok(diff2 === 0, diff2 === 0 ? '导出与数据库逐格一致（Q4 同源已生效）' : `导出有 ${diff2} 行与数据库不等`)

let diff3 = 0
for (let i = 0; i < Math.max(xs.length, a.length); i++) if (xs[i] !== a[i]) diff3++
ok(diff3 === 0, diff3 === 0 ? '导出与剪贴板逐格一致（两处出口同一份数据）' : `导出与剪贴板有 ${diff3} 行不等`)

// ============ ③ 导出的空格子是不是空（不是 0） ============
const xEmpty = bodyRows.reduce((n, r) => n + r.slice(xFrom, xTo + 1).filter(v => String(v == null ? '' : v).trim() === '').length, 0)
ok(xEmpty > 0, `导出里空格子 ${xEmpty} 个（未把无报单写成 0）`)

// ============ ④ 「仅显示有报单」开关 ============
console.log('\n=== ④ 仅显示有报单 ===')
const zeroToggle = p.locator('label.tb-toggle', { hasText: '仅显示有报单' }).locator('input')
const zc = await zeroToggle.count()
ok(zc > 0, `找到「仅显示有报单」开关（${zc} 个）`)
if (zc) {
  await zeroToggle.first().check()
  await sleep(1600)
  await exportBtn.click(); await sleep(350)
  await p.locator('.tb-pop-panel button', { hasText: '复制整表数据' }).first().click()
  await sleep(1000)
  const t2 = await p.evaluate(() => navigator.clipboard.readText().catch(() => ''))
  const n2 = t2.split('\r\n').filter(Boolean).length
  ok(n2 === expect.n, `勾上后只复制 ${n2} 行（= 有报单的 ${expect.n} 个商品，不再是 294）`)
  await zeroToggle.first().uncheck()
  await sleep(1400)
}

// ============ ⑤ 分组（行序跟随、不丢行不重复） ============
console.log('\n=== ⑤ 按品牌分组 ===')
/* 「分组方式」不在工具栏，而在**列设置弹层**里（`.col-menu`，由表头第一列的齿轮打开）；
   弹层没打开时那个 select 根本没挂载 —— 直接按 aria-label 找会一直等到超时（踩过两次）。
   ⚠️ 勾/取消「仅显示有报单」会触发一次表体重建（watch → 重载），齿轮是**新节点** ⇒
      点一下可能落在旧节点上什么都没发生。故改成最多试 3 次、以「弹层真的出现」为准。
   🔴 折叠分支（点 .grp-head 收起某组）**没有**在这里做自动化：线上该期按品牌只有 **1 个组**，
      折叠它等于全表隐藏，且虚拟滚动下点击目标会被重建替换 ⇒ 断言不可靠。
      该分支的判据与模板是**同一个表达式**（`openGroups[it.gkey] !== false`），代码级同源，
      会在交付说明里如实标注未做线上实测。 */
async function openColMenu() {
  for (let i = 0; i < 3; i++) {
    await p.locator('.cross-tbl thead .col-cfg').first().click()
    await sleep(800)
    if (await p.locator('.col-menu').count()) return true
  }
  return false
}
const menuOk = await openColMenu()
ok(menuOk, '列设置弹层已打开')
if (menuOk) {
  const grpSel = p.locator('.col-menu select[aria-label="分组方式"]').first()
  await grpSel.selectOption('brand')
  await sleep(700)
  await p.locator('.col-menu-overlay').click({ force: true }).catch(() => {})
  await sleep(1800)
  const gc = await p.locator('tr.grp-head').count()
  ok(gc > 0, `按品牌分出 ${gc} 个组`)

  await exportBtn.click(); await sleep(350)
  await p.locator('.tb-pop-panel button', { hasText: '复制整表数据' }).first().click()
  await sleep(1100)
  const t5 = await p.evaluate(() => navigator.clipboard.readText().catch(() => ''))
  const rows5 = t5.split('\r\n').filter(Boolean)
  ok(rows5.length === 294, `分组后仍是 ${rows5.length} 行（分组不丢行、不重复；组头不进剪贴板）`)
  ok(!/[\u4e00-\u9fa5]/.test(t5), '分组后剪贴板仍无中文（组名没被混进来）')
  const v5 = rows5.map(vecOf).filter(v => v.replace(/::/g, '') !== '').sort()
  ok(v5.length === expect.n && v5.join('|') === a.join('|'), `分组后 ${v5.length} 个有报单行与分组前的向量集合完全一致`)

  // 还原
  const menuOk2 = await openColMenu()
  if (menuOk2) {
    await p.locator('.col-menu select[aria-label="分组方式"]').first().selectOption('none')
    await sleep(700)
    await p.locator('.col-menu-overlay').click({ force: true }).catch(() => {})
    await sleep(900)
  }
}

console.log(`\n===== 结果：${pass} PASS / ${fail} FAIL =====`)
await b.close()
process.exit(fail ? 1 : 0)
