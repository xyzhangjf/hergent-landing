/* v686 真机探针：①未选客户/供应商 ⇒ 商品格锁定 + toast 出声 ②选业务员 ⇒ 带出部门 / 无部门给提示 ③全站「经办人」→「业务员」
   —— 只走真实登录流程（点「先看看演示效果」由后端 Set-Cookie），不塞 token。

   用法: node tests/perf/v686/browser-v686.mjs [baseUrl]

   🔴 只读：全程不点「提交」，不产生任何单据。写链路已由 write_probe.py 的 12 条断言覆盖。
   🔴 判据用**用户可见的东西**（占位文案 / toast 文案 / 标签文字 / 下拉值），不用组件内部变量名
      —— 生产产物被 minify，`handlerDeptHint` 这类符号名恒搜不到，拿它判红必假阴性。
*/
import { chromium } from 'playwright'
import fs from 'fs'

const BASE = process.argv[2] || 'https://hergent.cn'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const rows = []
const say = (name, code, detail) => {
  rows.push({ name, code, detail })
  console.log(`  [${code}] ${name}${detail !== undefined ? '  ' + JSON.stringify(detail) : ''}`)
}

/* 页面前缀：purchase 侧 td 用 ipn-*，sales 侧 td 用 isn-*；商品格文本态两边都是 .ipn-v（ProductCombo 共用） */
const PAGES = [
  ['采购订货单',     '/inventory/purchase/new',                 'ipn', '供应商', '先选供应商'],
  ['采购退货单',     '/inventory/purchase/return/new',           'ipn', '供应商', '先选供应商'],
  ['自提销售单',     '/inventory/sale/self-pickup/new',          'isn', '客户',   '先选客户'],
  ['自提退货单',     '/inventory/sale/self-pickup/return/new',   'isn', '客户',   '先选客户'],
  ['车销销售单',     '/inventory/sale/vehicle/new',              'isn', '客户',   '先选客户'],
  ['车销退货单',     '/inventory/sale/vehicle/return/new',       'isn', '客户',   '先选客户'],
]

const b = await chromium.launch({ channel: 'chrome', headless: true })
const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } })

/* toast 是瞬时的（短文案 2.x 秒自动消失）⇒ 装一个 MutationObserver 把文案全存下来，
   否则「点一下有没有出声」会因为采样时机而随机通过/失败。 */
await ctx.addInitScript(() => {
  window.__toastLog = []
  const take = (root) => {
    (root.querySelectorAll ? root.querySelectorAll('.toast-msg') : []).forEach((el) => {
      const t = (el.textContent || '').trim()
      if (t && window.__toastLog[window.__toastLog.length - 1] !== t) window.__toastLog.push(t)
    })
  }
  const start = () => {
    take(document)
    new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => {
      if (n.nodeType === 1) { if (n.classList?.contains('toast-msg')) take(n.parentElement || n); take(n) }
    }))).observe(document.body, { childList: true, subtree: true })
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start)
})

const page = await ctx.newPage()
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
const demo = page.getByRole('button', { name: /先看看演示效果/ })
await demo.first().waitFor({ timeout: 25000 })
await demo.first().click()
await page.waitForSelector('.topbar', { timeout: 30000 })
await sleep(1500)

const build = await page.evaluate(() => window.__HG_BUILD__ || '')
say('构建号 = v688', build === 'v688' ? 'PASS' : 'FAIL', build)

/* ── 参考数据：业务员名单 + 部门表 ────────────────────────────────────── */
const refs = await page.evaluate(async () => {
  const get = async (k) => {
    const r = await fetch(`/api/psi/refs?kind=${k}&limit=2000`, { credentials: 'include' })
    const j = await r.json().catch(() => ({}))
    return j.data || j || {}
  }
  const u = await get('users')
  const d = await get('departments')
  const users = u.users || []
  const depts = d.departments || []
  return {
    users: users.map((x) => ({ id: String(x.id), name: x.name, dept: Number(x.department_id || 0) })),
    depts: depts.map((x) => ({ id: Number(x.id), name: x.name })),
  }
})
const withDept = refs.users.find((u) => u.dept > 0 && refs.depts.some((d) => d.id === u.dept))
const noDept = refs.users.find((u) => !u.dept)
say('演示租户业务员名单', refs.users.length ? 'PASS' : 'SKIP',
  `${refs.users.length} 人 / 配了部门的 ${refs.users.filter((u) => u.dept > 0).length} 人 / 部门 ${refs.depts.length} 个`)
say('存在「已配部门」的业务员（可验自动带出）', withDept ? 'PASS' : 'SKIP',
  withDept ? `${withDept.name} → 部门 ${withDept.dept}` : '演示租户无人配部门')
say('存在「未配部门」的业务员（可验提示分支）', noDept ? 'PASS' : 'SKIP', noDept ? noDept.name : '全都有部门')

/* ── 逐页 ─────────────────────────────────────────────────────────────── */
for (const [label, route, pre, partyWord, lockHint] of PAGES) {
  console.log(`\n=== ${label}  ${route} ===`)
  await page.evaluate((h) => { location.hash = h }, route)
  await sleep(2400)

  /* ① 头部标签：有「业务员」、没有「经办人」 */
  const heads = await page.evaluate(() => [...document.querySelectorAll('.isn-lb, .ipn-lb')]
    .map((el) => (el.textContent || '').replace(/\s+/g, '').replace('*', '')))
  say(`${label}：头部有「业务员」`, heads.includes('业务员') ? 'PASS' : 'FAIL', heads)
  say(`${label}：头部无「经办人」`, heads.includes('经办人') ? 'FAIL' : 'PASS')

  /* ② 未选伙伴 ⇒ 商品格锁定；v687 起格内**不显示**占位文字，但 title 悬停说明还在 */
  const locked = await page.evaluate((p) => {
    const td = document.querySelector(`td.${p}-c-prod`)
    if (!td) return null
    const v = td.querySelector('.ipn-v')
    if (!v) return { noCombo: true }
    return {
      hasLockedClass: v.classList.contains('is-locked'),
      text: (v.textContent || '').trim(),
      title: v.getAttribute('title') || '',
    }
  }, pre)
  if (!locked || locked.noCombo) { say(`${label}：商品格存在`, 'SKIP', locked); continue }
  say(`${label}：未选${partyWord}时商品格锁定`, locked.hasLockedClass ? 'PASS' : 'FAIL', locked.hasLockedClass)
  say(`${label}：锁定态格内不显示占位文字（v687 整洁化）`, locked.text === '' ? 'PASS' : 'FAIL', locked.text)
  say(`${label}：锁定态仍有悬停说明（没字≠没解释）`, locked.title.includes(lockHint) ? 'PASS' : 'FAIL', locked.title)

  /* ③ 点锁定格 ⇒ toast 出声，且**没有**打开输入框 */
  await page.evaluate(() => { window.__toastLog = [] })
  await page.locator(`td.${pre}-c-prod .ipn-v`).first().click()
  await sleep(400)
  const afterClick = await page.evaluate((p) => ({
    toasts: window.__toastLog.slice(),
    inputs: document.querySelectorAll(`td.${p}-c-prod input`).length,
  }), pre)
  /* 🔴 占位文案是「先选客户」，toast 是「请先选择客户」—— 两者**不是**子串关系，
        拿 `lockHint` 去 `includes` toast 会恒 false（探针自己的 bug，别记成产品缺陷）。 */
  say(`${label}：点击锁定格弹出提示`,
    afterClick.toasts.some((t) => t.includes(`请先选择${partyWord}`)) ? 'PASS' : 'FAIL', afterClick.toasts)
  say(`${label}：提示语含「再选择商品」`,
    afterClick.toasts.some((t) => /再选择商品|再选商品/.test(t)) ? 'PASS' : 'FAIL', afterClick.toasts)
  say(`${label}：锁定态没有打开搜索框`, afterClick.inputs === 0 ? 'PASS' : 'FAIL', afterClick.inputs)

  /* ④ 选业务员 ⇒ 带出部门 / 无部门给提示 */
  const hn = await page.evaluate(() => {
    const box = [...document.querySelectorAll('.isn-f, .ipn-f')].find((el) => {
      const lb = el.querySelector('.isn-lb, .ipn-lb')
      return lb && (lb.textContent || '').replace(/\s+/g, '').replace('*', '') === '业务员'
    })
    return box ? [...box.querySelectorAll('select option')].map((o) => o.value) : null
  })
  const opts = (hn || []).filter(Boolean)
  if (!opts.length) { say(`${label}：业务员下拉有可选人`, 'SKIP', '演示租户下拉只有「不指定」'); continue }
  say(`${label}：业务员下拉有可选人`, 'PASS', `${opts.length} 人`)

  const pick = withDept && opts.includes(withDept.id) ? withDept : (opts.includes(noDept?.id) ? noDept : null)
  if (!pick) { say(`${label}：选业务员`, 'SKIP', '名单里没有可控样本'); continue }

  const sel = page.locator('.isn-f, .ipn-f').filter({ has: page.locator('.isn-lb, .ipn-lb', { hasText: '业务员' }) })
    .locator('select').first()
  await sel.selectOption(String(pick.id))
  await sleep(600)

  const deptState = await page.evaluate(() => {
    const find = (word) => {
      const box = [...document.querySelectorAll('.isn-f, .ipn-f')].find((el) => {
        const lb = el.querySelector('.isn-lb, .ipn-lb')
        return lb && (lb.textContent || '').replace(/\s+/g, '').replace('*', '') === word
      })
      return box ? (box.querySelector('select') || null) : null
    }
    const d = find('部门')
    const warn = [...document.querySelectorAll('.isn-hist-warn, .ipn-hist-warn')]
      .map((el) => (el.textContent || '').trim()).filter(Boolean)
    /* 「只提醒不拦截」：保存按钮不能因为这条提示变灰 */
    const btns = [...document.querySelectorAll('button')]
      .filter((el) => /保存|提交|草稿/.test(el.textContent || ''))
    return {
      deptValue: d ? d.value : null,
      deptText: d ? (d.selectedOptions?.[0]?.textContent || '').trim() : null,
      warn,
      btnsDisabled: btns.map((el) => el.disabled),
      btnsText: btns.map((el) => (el.textContent || '').replace(/\s+/g, '')),
    }
  })

  if (pick.dept > 0) {
    const dn = refs.depts.find((d) => d.id === pick.dept)?.name || ''
    /* 采购侧存 id、销售侧存名字 —— 两种都算「带出来了」 */
    const ok = String(deptState.deptValue) === String(pick.dept) || deptState.deptText === dn
    say(`${label}：选「${pick.name}」后部门自动带出`, ok ? 'PASS' : 'FAIL',
      { 期望: dn || pick.dept, 实际值: deptState.deptValue, 实际文本: deptState.deptText })
    say(`${label}：带出成功时不弹「没配部门」提示`,
      deptState.warn.every((w) => !w.includes('还没设置所属部门')) ? 'PASS' : 'FAIL', deptState.warn)
  } else {
    say(`${label}：选「${pick.name}」（无部门）后出提示`,
      deptState.warn.some((w) => w.includes('还没设置所属部门')) ? 'PASS' : 'FAIL', deptState.warn)
    say(`${label}：无部门提示不影响开单（按钮不变灰）`,
      deptState.btnsDisabled.every((d) => d === false) ? 'PASS' : 'FAIL',
      { 按钮: deptState.btnsText, 禁用: deptState.btnsDisabled })
  }
}

/* ── ⑤ 零价原因格：不再常驻「请选择原因」（v687） ───────────────────── */
/* 只改表单内状态（把某行单价填 0），不提交、不产生单据。单价框靠 `placeholder="0.00"`
   精确定位 —— 数量框的 placeholder 是 `0`，两者可区分。 */
console.log('\n=== 零价原因格（v687 整洁化）===')
await page.evaluate(() => { location.hash = '/inventory/sale/self-pickup/new' })
await sleep(2600)
const priceInp = page.locator('tbody input[placeholder="0.00"]').first()
if (await priceInp.count()) {
  await priceInp.fill('0')
  await priceInp.press('Tab')
  await sleep(600)
  const z = await page.evaluate(() => {
    const sel = document.querySelector('td.isn-c-reason select')
    if (!sel) return null
    return {
      value: sel.value,
      first: (sel.options[0]?.textContent || '').trim(),
      title: sel.getAttribute('title') || '',
      count: sel.options.length,
    }
  })
  if (!z) {
    say('单价填 0 后出现原因下拉', 'SKIP', '未渲染（可能该行没有可编辑单价格）')
  } else {
    say('单价填 0 后出现原因下拉', 'PASS', `${z.count} 项`)
    say('格内首项不再是「请选择原因」', z.first === '—' ? 'PASS' : 'FAIL', z.first)
    say('原因下拉仍有悬停说明', z.title.includes('零价出库') ? 'PASS' : 'FAIL', z.title)
    say('零价原因仍是必选（默认值为空）', z.value === '' ? 'PASS' : 'FAIL', z.value)
  }
} else {
  say('单价输入框可定位', 'SKIP', '没找到 placeholder=0.00 的输入框')
}

/* ── 列表页：业务员列 ─────────────────────────────────────────────────── */
console.log('\n=== 列表页：业务员列 ===')
/* 🔴 路由是 `purchase`（不是 `purchases`）：`/inventory/purchases` 不在 router 里 ⇒ 什么都不渲染，
      打红会变成「探针跳错页」被记成「功能没做」。 */
for (const [label, route, word] of [['销售单列表', '/inventory/sale', '业务员'], ['采购单列表', '/inventory/purchase', '业务员']]) {
  await page.evaluate((h) => { location.hash = h }, route)
  await sleep(3000)
  const t = await page.evaluate(() => ({
    ths: [...document.querySelectorAll('th')].map((el) => (el.textContent || '').replace(/[\s*▾▴▲▼]/g, '')),
    tables: document.querySelectorAll('table').length,
    empty: /还没有/.test(document.body.innerText || ''),
    hasOld: /经办人/.test(document.body.innerText || ''),
  }))
  /* 演示租户**没有任何单据** ⇒ 空态不渲染表头。列定义（COLS / SR_COLS）与 `colText` 映射
     由契约组 ㉑ 断言，`handler_name` 由 HTTP 探针在真实租户上验过 —— 这里如实记 SKIP。 */
  if (!t.tables) {
    say(`${label}：表头有「${word}」`, 'SKIP', t.empty ? '演示租户无单据 ⇒ 空态无表头（列定义由契约组 ㉑ 覆盖）' : '未渲染表格')
  } else {
    say(`${label}：表头有「${word}」`, t.ths.includes(word) ? 'PASS' : 'FAIL', t.ths.slice(0, 16))
  }
  say(`${label}：页面上没有「经办人」字样`, t.hasOld ? 'FAIL' : 'PASS')
}

/* ── 员工档案：业务员部门配置入口 ─────────────────────────────────────── */
console.log('\n=== 员工档案 · 业务员部门 ===')
await page.evaluate(() => { location.hash = '/archive/employees' })
await sleep(2800)
const arch = await page.evaluate(() => ({
  text: /业务员部门/.test(document.body.innerText || ''),
  selects: document.querySelectorAll('.hd-sel').length,
  redirected: !/员工档案|档案管理/.test(document.body.innerText || ''),
}))
if (arch.redirected) {
  say('员工档案「业务员部门」配置入口', 'SKIP', '演示租户无档案模块权限（生产已由 HTTP 探针验过 PUT 真写库）')
} else {
  say('员工档案有「业务员部门」配置卡', arch.text ? 'PASS' : 'FAIL', arch)
  say('每个业务员一行部门下拉', arch.selects > 0 ? 'PASS' : 'FAIL', arch.selects)
}

const fail = rows.filter((r) => r.code === 'FAIL')
console.log('\n' + '-'.repeat(64))
console.log(`RESULT: ${rows.filter((r) => r.code === 'PASS').length} PASS / ${fail.length} FAIL / ${rows.filter((r) => r.code === 'SKIP').length} SKIP`)
fs.writeFileSync(new URL('./browser-v686.json', import.meta.url), JSON.stringify({ base: BASE, rows }, null, 2))
await b.close()
process.exit(fail.length === 0 ? 0 : 1)
