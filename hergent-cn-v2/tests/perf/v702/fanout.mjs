/* v702 扇出验证：新建目标时选 2 个供应商 → 是否真的生成 2 条**独立**规则。
   🔴 这是「多选」的实质：不验这一步，多选就只是界面效果。
   🔴 会写真数据 ⇒ 用 __TST702_ 前缀标识，测完 DELETE 并**自证残留 0**（不靠"我看着像删了"）。 */
import { chromium } from 'playwright'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const TOKEN = process.env.HG_TOKEN
const BASE = 'https://hergent.cn'
const OUT = 'outputs/v702-供应商作用对象'
const TAG = `__TST702_${Date.now() % 100000}`
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const results = []
function ck(name, ok, extra = '') {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${extra ? ' | ' + extra : ''}`)
}
/* 🔴 写操作（POST/DELETE）后端走 CSRF **双提交**校验：cookie 值必须等于 X-CSRF-Token 头。
   只带 erp_token 会 403 CSRF_REQUIRED（老板真实登录由后端 Set-Cookie 下发 csrf_token，
   所以真人用不会遇到）。探针自己造一个同值即可，**不改任何产品逻辑**。 */
const CSRF = 'probe702csrf'
const H = { Cookie: `erp_token=${TOKEN}; hergent_auth=1; csrf_token=${CSRF}`, 'X-CSRF-Token': CSRF }
async function apiCall(path, opt = {}) {
  const r = await fetch(BASE + path, { ...opt, headers: { ...H, 'Content-Type': 'application/json', ...(opt.headers || {}) } })
  const t = await r.text()
  try { return { status: r.status, body: JSON.parse(t) } } catch { return { status: r.status, body: t } }
}

const b = await chromium.launch({ headless: true, executablePath: CHROME })
const ctx = await b.newContext({ viewport: { width: 1440, height: 950 } })
await ctx.addCookies([
  { name: 'erp_token', value: TOKEN, url: `${BASE}/` },
  { name: 'hergent_auth', value: '1', url: `${BASE}/` },
  // __Host- 前缀在浏览器里要求 Secure + 无 Domain，playwright 注入易被拒 ⇒ 用后端同序兜底的 csrf_token
  { name: 'csrf_token', value: CSRF, url: `${BASE}/` },
])
const p = await ctx.newPage()

await p.goto(`${BASE}/#/rebate?tab=rules`, { waitUntil: 'domcontentloaded' })
await p.reload({ waitUntil: 'domcontentloaded' })
await sleep(4000)

await p.locator('button', { hasText: '创建品牌目标' }).first().click()
await sleep(1500)

/* 规则名称 */
const nameInput = p.locator('.ui-modal-card .form-row').filter({ has: p.locator('label', { hasText: '规则名称' }) })
  .first().locator('input').first()
await nameInput.fill(TAG + '_扇出验证')

/* 全年目标（万元）→ 自动铺 12 个月 */
const annTarget = p.locator('.ui-modal-card input[placeholder="填全年，自动均分"]').first()
await annTarget.fill('12')
await sleep(500)
/* 全年返利率（%） */
const annRate = p.locator('.ui-modal-card input[placeholder="如 10"], .ui-modal-card input[placeholder="各月不同"]').first()
await annRate.fill('1')
await sleep(600)

/* 选 2 个供应商 */
await p.locator('.sp-trigger').first().click()
await sleep(800)
const picked = []
for (let i = 0; i < 2; i++) {
  await p.locator('.sp-item').nth(i).click()
  await sleep(250)
  picked.push((await p.locator('.sp-item .sp-nm').nth(i).innerText()).trim())
}
await p.locator('.sp-panel button', { hasText: '完成' }).click()
await sleep(500)
ck('已选 2 个供应商', (await p.locator('.sp-chip').count()) === 2, picked.join(' / '))
await p.screenshot({ path: `${OUT}/5-扇出前-已选2个.png` }).catch(() => {})

/* 保存 */
await p.locator('.ui-modal-card button', { hasText: '创建' }).first().click()
/* toast 是 3 秒左右自动消失的 ⇒ 必须轮询抓，睡完再看就没了（上一版就是这么漏的） */
let toastText = ''
for (let i = 0; i < 25; i++) {
  await sleep(300)
  const t = await p.locator('.toast-msg').first().innerText().catch(() => '')
  if (t) { toastText = t; break }
}
ck('回执明说「为 2 个供应商各建 1 条」', /2\s*个供应商/.test(toastText) && /2\s*条/.test(toastText), toastText.replace(/\n/g, ' ').slice(0, 60))

/* API 核实：真的落了 2 条，且 scope_key 是供应商 id、名称带后缀 */
const list = await apiCall('/api/rebate-rules?include_inactive=1&limit=500')
const all = (list.body && (list.body.rules || list.body.data || list.body)) || []
const mine = (Array.isArray(all) ? all : []).filter(r => String(r.rule_name || '').startsWith(TAG))
ck('库里有 2 条（不是 1 条、不是 0 条）', mine.length === 2, `count=${mine.length}`)
/* 🔴 口径说明：brand 维度的 scope_key 由后端强制等于 scope_name（rebate_rules.py:1125），
   这是**必须**的 —— 达成的 scope_key 是导入的名称原文，规则侧若用 id 就永远配不上。
   所以这里验的是「两条名称不同 + key 与名称一致」，而不是"key 是数字 id"。 */
ck('两条绑定不同供应商，且 key 与后端口径一致（key === 名称）',
  mine.length === 2
  && mine.every(r => String(r.scope_key) === String(r.scope_name))
  && new Set(mine.map(r => String(r.scope_name))).size === 2,
  mine.map(r => `${r.scope_name}=${r.scope_key}`).join(' , '))
ck('两条作用对象就是刚选的那两个', mine.length === 2 && picked.every(n => mine.some(r => String(r.scope_name) === n)),
  mine.map(r => r.scope_name).join(' / '))
ck('规则名带「· 供应商名」后缀（列表里能区分，不会两行同名）',
  mine.length === 2 && mine.every(r => /·/.test(String(r.rule_name))))
ck('两条目标值相同且都 > 0（同一个数，各算各的）',
  mine.length === 2 && mine.every(r => Number(r.target_value) > 0)
  && new Set(mine.map(r => Number(r.target_value))).size === 1,
  mine.map(r => r.target_value).join(' / '))
ck('维度仍是 brand（后端维度白名单未变，计算链路零改动）',
  mine.length === 2 && mine.every(r => r.dimension === 'brand'))
await p.screenshot({ path: `${OUT}/6-扇出后-列表两条.png` }).catch(() => {})

/* ---------- 清理 + 自证 ---------- */
const ids = mine.map(r => r.id)
const del = []
for (const id of ids) {
  // eslint-disable-next-line no-await-in-loop
  // 默认 DELETE 是**软删除**（is_active=0，行仍在）⇒ 测完要硬删，否则留下停用垃圾
  const r = await apiCall(`/api/rebate-rules/${id}?hard=1`, { method: 'DELETE' })
  del.push(`${id}:${r.status}`)
}
await sleep(800)
const after = await apiCall('/api/rebate-rules?include_inactive=1&limit=500')
const allAfter = (after.body && (after.body.rules || after.body.data || after.body)) || []
const left = (Array.isArray(allAfter) ? allAfter : []).filter(r => String(r.rule_name || '').startsWith(TAG))
ck('测试规则已删净（按名字复核残留 0，且确实建过 2 条才不算空转）',
  ids.length === 2 && left.length === 0,
  `建成=${ids.length} 删除=${del.join(',') || '(无)'} 残留=${left.length}`)

await b.close()

const fail = results.filter(r => !r.ok)
console.log(`\n===== ${results.length - fail.length}/${results.length} PASS =====`)
if (fail.length) { fail.forEach(f => console.log('  FAILED: ' + f.name)); process.exit(1) }
