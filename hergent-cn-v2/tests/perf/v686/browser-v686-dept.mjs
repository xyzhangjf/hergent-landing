/* v686 真机闭环：**「选业务员 → 自动带出部门」** + 列表页「业务员」列（真实租户）
   —— 演示租户 0 人配部门、0 个部门 ⇒ 上面那个 browser-v686.mjs 只能验「没配部门」的提示分支，
      「带出」这条在那里恒 SKIP。SKIP 不是通过，所以这条主行为必须用真实租户补。

   前置：服务器上先跑 `tools/v686_dept_e2e.py prepare`（给 uid 999903 设 department_id=2=销售部，
         并插一条临时 session），把输出的 TOKEN 通过环境变量传进来。
   收尾：`tools/v686_dept_e2e.py teardown`（department_id 还原、session 删净并自证）。

   用法: TOKEN=v686dept-xxx node tests/perf/v686/browser-v686-dept.mjs [baseUrl]
*/
import { chromium } from 'playwright'

const BASE = process.argv[2] || 'https://hergent.cn'
const TOKEN = process.env.TOKEN || ''
const UID = String(process.env.UID || '999903')
const DEPT_ID = Number(process.env.DEPT_ID || 2)
const DEPT_NAME = process.env.DEPT_NAME || '销售部'
if (!TOKEN) { console.error('缺少 TOKEN 环境变量'); process.exit(2) }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const rows = []
const say = (name, code, detail) => {
  rows.push({ name, code, detail })
  console.log(`  [${code}] ${name}${detail !== undefined ? '  ' + JSON.stringify(detail) : ''}`)
}

const b = await chromium.launch({ channel: 'chrome', headless: true })
const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } })
await ctx.addCookies([
  { name: 'erp_token', value: TOKEN, domain: '.hergent.cn', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' },
  { name: 'hergent_auth', value: '1', domain: '.hergent.cn', path: '/', secure: true, sameSite: 'Lax' },
  { name: 'csrf_token', value: TOKEN, domain: '.hergent.cn', path: '/', secure: true, sameSite: 'Lax' },
])
const page = await ctx.newPage()

await page.goto(BASE + '/#/workbench', { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.topbar', { timeout: 30000 })
await sleep(1800)

const build = await page.evaluate(() => window.__HG_BUILD__ || '')
say('构建号 = v689', build === 'v689' ? 'PASS' : 'FAIL', build)

/* 读头部某一格（按 label 找 .isn-f/.ipn-f 里的 select） */
const readSelect = (word) => page.evaluate((w) => {
  const box = [...document.querySelectorAll('.isn-f, .ipn-f')].find((el) => {
    const lb = el.querySelector('.isn-lb, .ipn-lb')
    return lb && (lb.textContent || '').replace(/\s+/g, '').replace('*', '') === w
  })
  const sel = box ? box.querySelector('select') : null
  return sel ? { value: sel.value, text: (sel.selectedOptions?.[0]?.textContent || '').trim() } : null
}, word)

const pickHandler = async () => {
  const box = page.locator('.isn-f, .ipn-f').filter({ has: page.locator('.isn-lb, .ipn-lb', { hasText: '业务员' }) })
  await box.locator('select').first().selectOption(UID)
  await sleep(500)
}

/* ① 采购单：部门列存 **id** */
console.log('\n=== 采购订货单（部门列 = department_id）===')
await page.evaluate(() => { location.hash = '/inventory/purchase/new' })
await sleep(2600)
const before1 = await readSelect('部门')
await pickHandler()
const after1 = await readSelect('部门')
const warn1 = await page.evaluate(() => [...document.querySelectorAll('.ipn-hist-warn')].map((e) => e.textContent.trim()))
say('选业务员前部门是「不指定」', String(before1?.value) === '0' ? 'PASS' : 'FAIL', before1)
say(`选业务员后部门带出 = ${DEPT_NAME}（id=${DEPT_ID}）`,
  String(after1?.value) === String(DEPT_ID) ? 'PASS' : 'FAIL', after1)
say('带出成功时不弹「没配部门」提示',
  warn1.every((w) => !w.includes('还没设置所属部门')) ? 'PASS' : 'FAIL', warn1)

/* ② 自提销售单：部门列存 **名字**（两页同名不同库，别互抄） */
console.log('\n=== 自提销售单（部门列 = 部门名）===')
await page.evaluate(() => { location.hash = '/inventory/sale/self-pickup/new' })
await sleep(2600)
await pickHandler()
const after2 = await readSelect('部门')
say(`选业务员后部门带出 = ${DEPT_NAME}（名字）`,
  after2?.value === DEPT_NAME ? 'PASS' : 'FAIL', after2)

/* ③ 带出的部门**仍然可改**（带出 ≠ 绑定） */
await page.evaluate(() => { location.hash = '/inventory/purchase/new' })
await sleep(2400)
await pickHandler()
await page.locator('.isn-f, .ipn-f').filter({ has: page.locator('.isn-lb, .ipn-lb', { hasText: '部门' }) })
  .locator('select').first().selectOption('0')
await sleep(300)
const manual = await readSelect('部门')
say('带出的部门可以手工改回「不指定」', String(manual?.value) === '0' ? 'PASS' : 'FAIL', manual)

/* ④ 真实租户列表：表头「业务员」列（演示租户因无单据导致空态无表头，这里补上）
   🔴 采购单列表**只有筛选、没有列**（v686 之前就是这样：那页的 `COLS` 里没有 handler，
      老板要的是「命名统一」，把这页的筛选标签从「经办人」改成「业务员」即达标）。
      拿「采购列表要有表头」去判红，会把我自己的过度期望记成产品缺陷。 */
console.log('\n=== 列表页（真实租户有单据 ⇒ 表头能渲染）===')
for (const [label, route, kind] of [
  ['销售单列表', '/inventory/sale', 'column'],
  ['采购单列表', '/inventory/purchase', 'filter'],
]) {
  await page.evaluate((h) => { location.hash = h }, route)
  await sleep(3200)
  /* 筛选区默认折叠在「更多选项」里 ⇒ 先展开，否则量到的是"没渲染"而不是"没有" */
  const more = page.getByRole('button', { name: /更多选项/ })
  if (await more.count()) { await more.first().click(); await sleep(700) }
  const t = await page.evaluate(() => ({
    ths: [...document.querySelectorAll('th')].map((el) => (el.textContent || '').replace(/[\s*▾▴▲▼柱]/g, '')),
    tables: document.querySelectorAll('table').length,
    hasOld: /经办人/.test(document.body.innerText || ''),
    filterOpts: [...document.querySelectorAll('select option')].map((o) => (o.textContent || '').trim()),
    colIdx: [...document.querySelectorAll('th')].findIndex((el) => /业务员/.test(el.textContent || '')),
  }))

  if (kind === 'column') {
    if (!t.tables) { say(`${label}：表头有「业务员」`, 'SKIP', '无单据 ⇒ 空态无表头'); continue }
    say(`${label}：表头有「业务员」`, t.ths.includes('业务员') ? 'PASS' : 'FAIL', t.ths.slice(0, 16))
    if (t.colIdx >= 0) {
      const cell = await page.evaluate((i) => {
        const tr = document.querySelector('tbody tr')
        const td = tr ? tr.children[i] : null
        return td ? (td.textContent || '').trim() : null
      }, t.colIdx)
      say(`${label}：该列有单元格（列真的在渲染）`, cell !== null ? 'PASS' : 'FAIL', cell)
    }
  } else {
    say(`${label}：筛选有「全部业务员」`, t.filterOpts.includes('全部业务员') ? 'PASS' : 'FAIL',
      t.filterOpts.filter((o) => /业务员|经办人/.test(o)))
    say(`${label}：表头不该出现「业务员」（本页只做筛选，加列是另一件事）`,
      t.ths.includes('业务员') ? 'SKIP' : 'PASS', '未加列')
  }
  say(`${label}：页面上没有「经办人」字样`, t.hasOld ? 'FAIL' : 'PASS')
}

const fail = rows.filter((r) => r.code === 'FAIL')
console.log('\n' + '-'.repeat(64))
console.log(`RESULT: ${rows.filter((r) => r.code === 'PASS').length} PASS / ${fail.length} FAIL / ${rows.filter((r) => r.code === 'SKIP').length} SKIP`)
await b.close()
process.exit(fail.length === 0 ? 0 : 1)
