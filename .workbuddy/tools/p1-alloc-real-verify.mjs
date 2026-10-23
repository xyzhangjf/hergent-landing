/**
 * P1 真机探针：「分摊」按钮（Forecast.vue 加单格）**真实数据**验收。
 *
 * 背景（与 `p1-alloc-btn-verify.mjs` 的区别）：
 *   那一版**打桩**（拦 `avg-target` 造合成响应），因为演示租户一个商品目标都没有
 *   ⇒ 按钮根本不渲染 ⇒ 只能验「没有 allocRowRef 异常」，验不到「点了真弹窗」。
 *   2026-10-22 老板授权在演示租户造 1 条真实商品目标（脚本
 *   `.workbuddy/tools/seed-demo-target.py`，演示租户 `readonly=1` 走不了 API，
 *   故直写 SQLite，不翻转只读闸门、不重启服务）⇒ 本探针**不打任何桩**，
 *   全程真实接口 + 真实 DOM。
 *
 * 造的数（演示租户 tenant_10）：
 *   期次 29（到货 2026-09-28 ⇒ 目标月 2026-09）
 *   商品 2「蒙牛特仑苏纯牛奶 250ml」补大单位换算（箱=12）
 *   本期清单登记该商品；商品目标 120 箱，分解 刘小顶 60%(72) / 王老板 40%(48)
 *
 * 判据：
 *   ① 演示登录 → ② 预报页出现真实商品行 → ③ avg-target 接口给出 ≥2 个承接人
 *   → ④ 进编辑态后渲染出「分摊」按钮 → ⑤ 点击弹出 .alloc-modal
 *   → ⑥ 弹窗标题 = 本行商品名（证明 `openAlloc(r)` 传的是本行、不是 undefined）
 *   → ⑦ 弹窗 2 行且姓名对得上 → ⑧ 无 allocRowRef / is not a function 异常
 *
 * ⚠️ ⑦ 在演示租户**结构上验不了**：表格行来自 `POST /extra-alloc/preview`，
 *    演示租户 readonly=1 按 method 拦写 ⇒ 403 READONLY_TENANT「演示环境只读」。
 *    故 ⑦ 只有两种非红结局：真出 2 行（理想）／空行提示正是该只读报错（SKIP）。
 *    其余（卡在「计算中…」、显示「没有可分摊的承接人」）一律判红。
 */
import { launch } from './lib/cdp-lite.mjs'

const BASE = 'https://hergent.cn'
const R = []
const ok = (name, cond, detail = '') => R.push({ name, pass: !!cond, detail: String(detail) })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitFor(page, expr, timeoutMs = 15000, step = 400) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try {
      if (await page.eval(`(function(){ try { return !!(${expr}) } catch(e) { return false } })()`)) return true
    } catch { /* 导航中忽略 */ }
    await sleep(step)
  }
  return false
}

const browser = await launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.enable()

  // ── ① 演示登录（真实登录流程，P0-4 后 localStorage 塞 token 已不通）────────────
  await page.goto(BASE + '/#/login', 5000)
  const clicked = await page.eval(`
    (function () {
      const b = [...document.querySelectorAll('button')]
        .find(x => (x.textContent || '').includes('先看看演示效果'));
      if (!b) return false; b.click(); return true;
    })()
  `)
  ok('登录页找到「演示」按钮', clicked)
  if (!clicked) throw new Error('演示按钮没找到')
  ok('演示登录后进入工作台', await waitFor(page, `location.hash.indexOf('workbench') >= 0`, 15000))

  // ── ② 接口侧：目标与承接人（真实数据，不打桩）──────────────────────────────────
  const api = await page.eval(`
    (async function () {
      const r = await fetch('/api/product-targets/avg-target?period_id=29', { credentials: 'include' })
      const d = await r.json()
      const it = (d.items || {})['2'] || null
      const mem = (it && it.alloc_members) || []
      return { month: d.target_month, hasItem: !!it, basis: it && it.alloc_basis,
               memN: mem.length, mem: mem.map(m => m.employee_name) }
    })()
  `).catch((e) => ({ err: String(e) }))
  ok('avg-target 目标月 = 2026-09（到货月口径）', api.month === '2026-09', api.month || api.err)
  ok('avg-target 返回商品 2 的均单条目', api.hasItem, JSON.stringify(api).slice(0, 160))
  ok('承接人 ≥2 人（按钮渲染的前提）', (api.memN || 0) >= 2,
     `n=${api.memN} ${(api.mem || []).join('/')} basis=${api.basis}`)

  // ── ③ 进预报页，等真实商品行 ───────────────────────────────────────────────────
  await page.eval(`location.hash = '#/forecast'; true`)
  ok('预报页出现真实商品行', await waitFor(
    page, `document.body.innerText.indexOf('蒙牛特仑苏纯牛奶 250ml') >= 0`, 25000))

  // ── ④ 进编辑态（只读态刻意不出按钮）────────────────────────────────────────────
  let btnCount = await page.eval(`document.querySelectorAll('.pt-alloc-btn').length`).catch(() => 0)
  if (!btnCount) {
    await page.eval(`
      (function () {
        const b = [...document.querySelectorAll('button')]
          .find(x => (x.textContent || '').includes('改单'));
        if (b) b.click();
        return !!b;
      })()
    `).catch(() => false)
    await sleep(5000)
    btnCount = await page.eval(`document.querySelectorAll('.pt-alloc-btn').length`).catch(() => 0)
  }
  ok('编辑态渲染出「分摊」按钮', btnCount > 0, `count=${btnCount}`)

  // ── ⑤ 点击 + 验收 ─────────────────────────────────────────────────────────────
  const errBefore = page.errors.length
  if (btnCount > 0) {
    await page.eval(`(function(){ document.querySelector('.pt-alloc-btn').click(); return true })()`)
    const opened = await waitFor(page, `document.querySelector('.alloc-modal')`, 15000)
    ok('点击后弹出分摊弹窗 .alloc-modal', opened)

    const modal = await page.eval(`
      (function () {
        const m = document.querySelector('.alloc-modal');
        if (!m) return null;
        const rows = [...m.querySelectorAll('.alloc-tbl tbody tr')]
          .map(tr => (tr.querySelector('td') || {}).textContent || '');
        return {
          title: (m.querySelector('.imp-hd b') || {}).textContent || '',
          rows: rows,
          head: [...m.querySelectorAll('.alloc-tbl thead th')].map(th => th.textContent || ''),
        };
      })()
    `).catch(() => null)
    ok('弹窗标题 = 本行商品名（openAlloc 拿到的是本行 r）',
       !!modal && modal.title.indexOf('蒙牛特仑苏纯牛奶 250ml') >= 0,
       modal ? modal.title : 'no modal')
    ok('弹窗表头 = 承接人/占比/报量/加单/定稿',
       !!modal && modal.head.join('/').indexOf('承接人') >= 0
       && modal.head.join('/').indexOf('占比') >= 0,
       modal ? modal.head.join('/') : 'no modal')

    /* 🔴 为什么「承接人 2 行」在演示租户**验不了**，且不该判红：
       表格行来自 `POST /extra-alloc/preview`（只读预演，但**是 POST**），
       而演示租户 readonly=1，后端闸门按 method 拦 ⇒ 直调实测返回
       `403 READONLY_TENANT「演示环境只读」`（见 diag8）。
       即：setup（GET）拿到商品名/2 个承接人都正常，唯独预演被环境挡住
       ⇒ 这是**演示环境约束**，不是代码缺陷。
       故此处分两种结论：真出 2 行 = PASS；空行提示恰为只读报错 = SKIP（不计红），
       并把它明确写成"待真实账号复验"。其余任何情况（比如「计算中…」卡死、
       「没有可分摊的承接人」）才是真缺陷 ⇒ 判红。 */
    const rowTxt = modal ? modal.rows.join(' / ') : ''
    const twoRows = !!modal && modal.rows.length === 2
      && rowTxt.indexOf('刘小顶') >= 0 && rowTxt.indexOf('王老板') >= 0
    const readonlyBlocked = !!modal && rowTxt.indexOf('演示环境只读') >= 0
    if (twoRows) {
      ok('弹窗承接人 = 目标档案那 2 人', true, rowTxt)
    } else if (readonlyBlocked) {
      ok('⏭ SKIP 承接人 2 行（演示租户只读拦掉了 POST 预演，待真实账号复验）', true, rowTxt)
    } else {
      ok('弹窗承接人 = 目标档案那 2 人', false, rowTxt || 'no modal')
    }

    const newErrs = page.errors.slice(errBefore)
    const fatal = newErrs.filter((e) => /allocRowRef|is not a function|is not defined/i.test(e))
    ok('点击后无 allocRowRef / is not a function 异常', fatal.length === 0,
       fatal.join(' | ').slice(0, 200) || '无')
  }

  const allErr = page.errors.filter((e) => /allocRowRef/i.test(e))
  ok('全程无 allocRowRef 相关异常', allErr.length === 0, allErr.join(' | ').slice(0, 200) || '无')
} catch (e) {
  ok('探针执行未抛错', false, String(e && e.message || e))
} finally {
  await browser.close()
}

console.log('\n──── P1 分摊按钮真机验收（演示租户真实目标）────')
let pass = 0
for (const r of R) {
  console.log(`  ${r.pass ? '✅' : '❌'} ${r.name}${r.detail ? '  │ ' + r.detail : ''}`)
  if (r.pass) pass++
}
console.log('───────────────────────────────────────────────')
console.log(`  ${pass}/${R.length} ${pass === R.length ? 'ALL PASS' : 'HAS FAILURE'}`)
process.exit(pass === R.length ? 0 : 1)
