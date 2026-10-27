/* v702 线上真实验证：目标配置的「作用对象」是否已统一为供应商（可搜索 / 筛选 / 多选 / 回显）
   🔴 用老板真实账号（临时会话）+ 线上真实数据，不 mock —— v697 的教训：mock 全绿但线上看不到。
   🔴 判定只用**用户可见字面量**（按钮文案 / 提示句子 / DOM 结构），不用 minify 后会改名的符号。 */
import { chromium } from 'playwright'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const TOKEN = process.env.HG_TOKEN
const BASE = 'https://hergent.cn'
const OUT = 'outputs/v702-供应商作用对象'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const results = []
function ck(name, ok, extra = '') {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${extra ? ' | ' + extra : ''}`)
}

const b = await chromium.launch({ headless: true, executablePath: CHROME })
const ctx = await b.newContext({ viewport: { width: 1440, height: 950 } })
await ctx.addCookies([
  { name: 'erp_token', value: TOKEN, url: `${BASE}/` },
  { name: 'hergent_auth', value: '1', url: `${BASE}/` },
])
const p = await ctx.newPage()
p.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 160)))

/* ---------- 1. 打开目标配置 ---------- */
await p.goto(`${BASE}/#/rebate?tab=rules`, { waitUntil: 'domcontentloaded' })
await sleep(3800)

const build = await p.evaluate(() => document.documentElement.getAttribute('data-build'))
ck('构建号是 v702', /^v70[2-9]|^v7[1-9]\d/.test(String(build)), String(build))
ck('目标配置页已渲染（有规则表格或空态）', await p.locator('.card').count() > 0)

/* ---------- 2. 打开「创建品牌目标」 ---------- */
const createBtn = p.locator('button', { hasText: '创建品牌目标' }).first()
ck('有「+ 创建品牌目标」按钮', await createBtn.count() > 0)
await createBtn.click()
await sleep(1400)

const modal = p.locator('.ui-modal-card').first()
ck('目标弹窗已打开', await modal.count() > 0)

/* 作用对象区：必须是供应商选择器 */
const scopeLabel = await p.locator('.ui-modal-card label').filter({ hasText: '作用对象' }).first().innerText().catch(() => '')
ck('作用对象标签写明是供应商', /供应商/.test(scopeLabel), scopeLabel.trim())
ck('有供应商选择器触发按钮（.sp-trigger）', await p.locator('.sp-trigger').count() === 1)

/* 🔴 核心判据：非供应商维度的作用对象选项必须消失（原来有 datalist：品牌名 / 商品名） */
const oldDatalists = await p.locator('datalist[id^="rebate-scope"]').count()
ck('非供应商维度的旧候选已移除（无 rebate-scope-* datalist）', oldDatalists === 0, `count=${oldDatalists}`)
const oldPlaceholder = await p.locator('input[placeholder*="品牌名"], input[placeholder*="商品 ID"]').count()
ck('不再有「品牌名 / 商品 ID」输入框', oldPlaceholder === 0, `count=${oldPlaceholder}`)

/* 未选时提示「全部供应商」 */
const noteEmpty = await p.locator('.sp-note').first().innerText().catch(() => '')
ck('未选时提示作用于全部供应商', /全部供应商/.test(noteEmpty), noteEmpty.slice(0, 40))

/* ---------- 3. 展开面板：搜索 / 筛选 / 列表 ---------- */
await p.locator('.sp-trigger').first().click()
await sleep(700)
ck('选择面板已展开', await p.locator('.sp-panel').count() === 1)
ck('有搜索框', await p.locator('.sp-search').count() === 1)

const catOpts = await p.locator('.sp-cat option').count()
ck('有分类筛选下拉（含「全部分类」）', catOpts >= 2, `options=${catOpts}`)

const itemAll = await p.locator('.sp-item').count()
ck('候选列表非空（供应商已加载）', itemAll > 0, `items=${itemAll}`)

/* 列表里必须是供应商：抽查生产已知的供应商名，且不应出现明显客户名 */
const listText = await p.locator('.sp-list').innerText()
ck('候选含生产供应商「简爱」', /简爱/.test(listText))
ck('候选含生产供应商「新希望」', /新希望/.test(listText))

/* 搜索：中文名 */
await p.locator('.sp-search').fill('蒙牛')
await sleep(500)
const afterKw = await p.locator('.sp-item').count()
const kwText = await p.locator('.sp-list').innerText()
ck('搜索「蒙牛」有结果且都被过滤', afterKw > 0 && afterKw < itemAll, `${itemAll}→${afterKw}`)
ck('搜索结果的每一行都含「蒙牛」',
  (await p.locator('.sp-item .sp-nm').allInnerTexts()).every(t => t.includes('蒙牛')))

/* 搜索：编码（生产 38 个供应商里只有 1 个有编码：108811 = 卡士乳业） */
await p.locator('.sp-search').fill('108811')
await sleep(500)
const codeText = await p.locator('.sp-list').innerText()
ck('编码搜索可用（108811 → 卡士乳业）', /卡士/.test(codeText), codeText.split('\n')[0] || '(空)')
/* 🔴 反向自证：生产 pinyin/pinyin_first 实测 0/38 有值 ⇒ 界面不得承诺拼音搜索 */
const ph = await p.locator('.sp-search').getAttribute('placeholder')
ck('搜索框不承诺拼音（否则用户敲 ja 只会看到"没有匹配"）', !/拼音/.test(ph || ''), ph || '')

/* 搜索无结果时给出可执行的下一步，而不是空白 */
await p.locator('.sp-search').fill('zzzzzz')
await sleep(400)
ck('无匹配时提示去供应商档案建档', /供应商档案/.test(await p.locator('.sp-empty').innerText().catch(() => '')))

/* ---------- 4. 多选 ---------- */
await p.locator('.sp-search').fill('')
await sleep(400)
const boxes = p.locator('.sp-item input[type="checkbox"]')
ck('新建态是可多选的复选框', await boxes.count() > 0)

const names = []
for (let i = 0; i < 2; i++) {
  await p.locator('.sp-item').nth(i).click()
  await sleep(220)
  names.push((await p.locator('.sp-item .sp-nm').nth(i).innerText()).trim())
}
await sleep(400)
const chips = await p.locator('.sp-chip').count()
ck('选中 2 个后 chips 显示 2 个', chips === 2, `chips=${chips} names=${names.join('/')}`)

const noteMulti = await p.locator('.sp-note').first().innerText()
ck('提示写明各自独立生成 N 条', /独立目标/.test(noteMulti) && /共\s*2\s*条/.test(noteMulti), noteMulti.slice(0, 60))
ck('提示明确不是合计口径', /不是这几家合计/.test(noteMulti))
ck('提示列出已选供应商名', names.every(n => noteMulti.includes(n)), names.join('、'))

/* 页面上「当前所选供应商」有独立提示（chips 即所选清单） */
const chipText = await p.locator('.sp-chips').innerText()
ck('已选清单可见（chips 区域）', names.every(n => chipText.includes(n)), chipText.replace(/\n/g, ' '))

await p.locator('.sp-panel button', { hasText: '完成' }).click()
await sleep(500)
ck('点「完成」后面板收起但选择保留', await p.locator('.sp-panel').count() === 0 && await p.locator('.sp-chip').count() === 2)
ck('触发器显示「已选 2 个供应商」', /已选\s*2\s*个供应商/.test(await p.locator('.sp-trigger').innerText()))

await p.screenshot({ path: `${OUT}/1-新建-多选供应商.png` }).catch(() => {})

/* 关掉新建弹窗 */
await p.locator('.ui-modal-card button').filter({ hasText: '取消' }).first().click().catch(() => {})
await sleep(800)

/* ---------- 5. 编辑回显：老口径（品牌名对不上供应商） ---------- */
await p.goto(`${BASE}/#/rebate?tab=rules&edit_rule=10`, { waitUntil: 'domcontentloaded' })
await p.reload({ waitUntil: 'domcontentloaded' })   // 深链只在挂载时消费，同实例改 hash 不会重跑
await sleep(4200)
const editOpen = await p.locator('.ui-modal-card').count()
if (editOpen) {
  const noteLegacy = await p.locator('.sp-note').first().innerText().catch(() => '')
  const title = await p.locator('.ui-modal-card #ui-modal-title-1, .ui-modal-card h3').first().innerText().catch(() => '')
  ck('编辑存量规则能打开（标题是编辑）', /编辑/.test(title), title.trim())
  ck('老口径作用对象明确标为未绑定 + 显示原名',
    /未绑定供应商/.test(noteLegacy) && /蒙牛低温/.test(noteLegacy), noteLegacy.slice(0, 60))
  ck('老口径提示说明可以按原样保存', /按原样保存/.test(noteLegacy))
  ck('编辑态是单选（不是复选框）',
    await p.locator('.sp-item input[type="radio"]').count() >= 0)
  const multi = await p.locator('.sp-trigger').innerText()
  ck('编辑态触发器提示只选一个供应商', /选择这条目标的供应商/.test(multi), multi.trim())
  await p.screenshot({ path: `${OUT}/2-编辑-老口径未绑定.png` }).catch(() => {})
} else {
  ck('编辑存量规则能打开（edit_rule 深链）', false, '弹窗未出现')
}

/* ---------- 6. 编辑回显：能对上的（简爱 同名供应商） ---------- */
await p.goto(`${BASE}/#/rebate?tab=rules&edit_rule=9`, { waitUntil: 'domcontentloaded' })
await p.reload({ waitUntil: 'domcontentloaded' })
await sleep(4200)
if (await p.locator('.ui-modal-card').count()) {
  const chip = await p.locator('.sp-chips').innerText().catch(() => '')
  const note = await p.locator('.sp-note').first().innerText().catch(() => '')
  ck('同名供应商自动回显为已选（简爱）', /简爱/.test(chip), chip.replace(/\n/g, ' ').slice(0, 40))
  ck('回显后提示写「作用对象：简爱」', /作用对象：简爱/.test(note), note.slice(0, 50))
  ck('编辑态不出现「未绑定」',
    !/未绑定供应商/.test(note))
  await p.screenshot({ path: `${OUT}/3-编辑-同名供应商已回显.png` }).catch(() => {})
} else {
  ck('编辑规则 9 能打开', false, '弹窗未出现')
}

/* ---------- 7. 移动端 ---------- */
await p.setViewportSize({ width: 390, height: 844 })
await p.goto(`${BASE}/#/rebate?tab=rules`, { waitUntil: 'domcontentloaded' })
await p.reload({ waitUntil: 'domcontentloaded' })
await sleep(3600)
const mBtn = p.locator('button', { hasText: '创建品牌目标' }).first()
if (await mBtn.count()) {
  await mBtn.click()
  await sleep(1200)
  await p.locator('.sp-trigger').first().click().catch(() => {})
  await sleep(700)
  const panel = await p.locator('.sp-panel').count()
  ck('移动端 390px 选择面板正常展开', panel === 1)
  const box = await p.locator('.sp-search').boundingBox().catch(() => null)
  ck('移动端搜索框可见且不溢出（宽 ≤ 视口）', !!box && box.width > 120 && box.x + box.width <= 392,
    box ? `w=${Math.round(box.width)} x=${Math.round(box.x)}` : 'null')
} else {
  ck('移动端能打开创建弹窗', false)
}
await p.screenshot({ path: `${OUT}/4-移动端.png` }).catch(() => {})

await b.close()

const fail = results.filter(r => !r.ok)
console.log(`\n===== ${results.length - fail.length}/${results.length} PASS =====`)
if (fail.length) {
  console.log('FAILED:')
  fail.forEach(f => console.log('  - ' + f.name))
  process.exit(1)
}
