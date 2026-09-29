/**
 * v332b 真机验收探针（只读）：主管拿到 `stock` 后，侧栏与页内是否**从"隐藏"变为"可用"**。
 *
 * 与 v332 的差别（同一套断言结构，期望值**反转**）：
 *   v332 期望侧栏**不含**「货损核算」（主管当时没有 stock）；
 *   v332b 期望侧栏**含**它、且档案管理页签**多出「仓库档案」**（因为 stock 到手）。
 *   两条对着看，才证明"侧栏跟着真实权限走"这件事是真的在生效，而不是写死的。
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'

const TOKEN = process.env.HG_TOKEN
const TENANT = process.env.HG_TENANT || '1'
const BASE = 'https://hergent.cn'
const R = []
const ok = (name, cond, detail = '') => R.push({ name, pass: !!cond, detail: String(detail) })

const browser = await launch({})
try {
  const page = await browser.newPage()
  await page.enable()
  await page.addInitScript(`
    localStorage.setItem('hergent_v2_token', ${JSON.stringify(TOKEN)});
    localStorage.setItem('hergent_v2_tenant', ${JSON.stringify(TENANT)});
  `)

  // ---------- 侧栏 ----------
  await page.goto(BASE + '/?cb=' + Date.now() + '#/workbench', 7000)
  const url1 = await page.eval('location.href')
  ok('P1 已登录', !/#\/login/.test(url1), url1)

  const navText = await page.eval(`(() => {
    const a = document.querySelector('aside')
    return a ? a.innerText : ''
  })()`)
  console.log('主管侧栏：' + String(navText).replace(/\n+/g, ' | '))

  for (const t of ['预报订货管理', '目标与返利', '档案管理', '货损核算']) {
    ok('P2 侧栏**含**「' + t + '」', String(navText).includes(t))
  }
  /* 🔴 「货损计算工作流」与「库存效期补录」**本来就不在侧栏** —— `Shell.vue` 的 NAV 表里
     没有这两条（侧栏是 3 组 10 项的精简版）。它们的入口是 **⌘K 命令面板**与**页面内跳转**。
     所以本批给它们补 `module` 的收益**不体现在侧栏**，而体现在：
       ① 权限页勾/取消「仓库管理」时它们**跟着变**（此前 `module: null` ⇒ 勾了也不生效）；
       ② 页内接口随模块裁决（下面的 P9/P10 证明页面进得去、用得了）。
     ⚠️ 若断言"侧栏含它们"会得到**假红** —— 那是既有产品设计，不是本批该改的东西。 */
  for (const t of ['货损计算工作流', '库存效期补录']) {
    ok('P2′ 侧栏**不含**「' + t + '」（既有设计：走 ⌘K／深链，非侧栏）', !String(navText).includes(t))
  }
  // 角色轴仍然生效：这两页只给 老板/管理员（+招投标给业务员），主管不该看到
  ok('P3 侧栏**不含**「定时任务」（角色轴：只给老板/管理员）', !String(navText).includes('定时任务'))
  ok('P4 侧栏**不含**「招投标雷达」（角色轴：只给老板/管理员/业务员）', !String(navText).includes('招投标雷达'))

  // ---------- 档案页签：有 stock 后应多出「仓库档案」 ----------
  await page.goto(BASE + '/?cb=' + Date.now() + '#/archive', 7000)
  const ar = await page.eval(`JSON.stringify({
    url: location.href,
    tabs: [...document.querySelectorAll('.module-tabs button')].map(b => b.textContent.trim())
  })`)
  const a = JSON.parse(ar || '{}')
  const tabs = a.tabs || []
  console.log('档案页签：' + JSON.stringify(tabs))
  ok('P5 页签**含**「仓库档案」（stock 到手后新增）', tabs.includes('仓库档案'), JSON.stringify(tabs))
  ok('P6 页签仍**不含**「员工档案」（主管无 hr）', !tabs.includes('员工档案'))
  ok('P7 页签仍**不含**「客户档案」（主管无 crm）', !tabs.includes('客户档案'))
  ok('P8 页签仍**含**「品牌档案」或「商品档案」（有 data）', tabs.includes('品牌档案') || tabs.includes('商品档案'))

  // ---------- 两个新开的页面：进得去、页内不报权限不足 ----------
  for (const [path, name] of [['#/loss-accounting', '货损核算'], ['#/loss', '货损计算工作流'], ['#/data-fill', '库存效期补录']]) {
    await page.goto(BASE + '/?cb=' + Date.now() + path, 6000)
    const info = await page.eval(`(() => {
      const t = document.body.innerText || ''
      return JSON.stringify({
        url: location.href,
        denied: /权限不足|没有.{0,12}的使用权限|无权/.test(t),
        len: t.length,
      })
    })()`)
    const d = JSON.parse(info || '{}')
    ok('P9 「' + name + '」页内**无**权限不足提示', !d.denied, JSON.stringify(d))
    ok('P10 「' + name + '」页面已渲染内容', (d.len || 0) > 120, 'len=' + d.len + ' url=' + d.url)
  }

  // ---------- 回归：预报页仍正常 ----------
  await page.goto(BASE + '/?cb=' + Date.now() + '#/forecast', 8000)
  const f = JSON.parse(await page.eval(`JSON.stringify({
    denied: (document.body.innerText||'').includes('你的角色不能查看报单汇总'),
    hasGrid: !!document.querySelector('.grid-area, .cross-tbl, table'),
  })`) || '{}')
  ok('P11 预报页仍**不**报「不能查看报单汇总」（v332 回归）', !f.denied)
  ok('P12 预报页表格仍渲染', f.hasGrid)

  const errs = (page.errors || []).filter(e => !/403/.test(e))
  ok('P13 全程零 console.error / 零页面异常', errs.length === 0, JSON.stringify(errs).slice(0, 240))
} catch (e) {
  ok('探针执行未抛异常', false, e.message)
} finally {
  console.log('\n===== 结果 =====')
  let n = 0
  for (const r of R) {
    console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + (r.pass ? '' : '   ← ' + r.detail))
    n += r.pass ? 1 : 0
  }
  console.log('---- ' + n + '/' + R.length + ' 通过 ----')
  await browser.close()
}
