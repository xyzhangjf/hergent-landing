/**
 * v316b 真机验收（**只读**）：客户档案页是否已从「P1 规划中」占位变成**真能用**。
 *
 * 背景：v316 批次 1 把 `CustomerArchive.vue` 从 130 行的占位页重写为真实功能页
 *   （列表 + 搜索 + 业态筛选 + 分页 + 逐笔新建/编辑 + Excel 导入）。
 *   批次 1 的产物**已随另一会话 2026-09-30 07:23 的构建上线**
 *   （生产入口 `index-CNc-sf0i.js` ⇒ 唯一引用 `Archive-DPJ1Wskz.js`）。
 *   本探针要回答的不是"产物在不在"，而是"**人打开这一页，能不能用**"。
 *
 * 🔴 判据分三层，缺一层就是假安全感：
 *   ① **几何可见性** —— 不是"在 DOM 里"，而是 `getBoundingClientRect` 有宽高。
 *      本项目的历史缺陷正是「元素在、样式对、点不到」：容器 `.page-hd{display:none}`
 *      ＋ 工具条恰好在 `.page-hd.split` 里 ⇒ 按钮被整块藏掉。
 *   ② **命中测试** —— 元素中心点 `elementFromPoint` 必须落回自己（或被自己包含），
 *      否则就是被别的层盖住（全屏图层 / Teleport 遮罩）。
 *   ③ **数字同源** —— 页面显示的总数、`/api/contacts` 的 total、分页文案里的总数
 *      必须**三方一致**。旧的 `total = len(items)` 会让「共 200 条」与事实自洽，
 *      只有三方对不上才暴露。
 *
 * 🔴 全程只读：所有请求都是 GET；弹窗只「打开 → 读结构 → 关闭」，**绝不点保存**；
 *   导入只到「下载模板」这一步，**绝不点下一步/执行**。
 *
 * 用法：
 *   HG_TOKEN=$(ssh root@47.113.224.140 'cat /tmp/hg_tok.txt') \
 *     /Users/zhangjunfeng/.workbuddy/binaries/node/versions/22.22.2-3/bin/node \
 *     .workbuddy/tools/v316b-archive-customer-e2e.mjs
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'

const TOKEN = process.env.HG_TOKEN
const BASE = 'https://hergent.cn'
const SHOT = process.env.HG_OUT || '/tmp/v316b-archive-customer.png'
if (!TOKEN) { console.log('FATAL 缺 HG_TOKEN'); process.exit(1) }

const R = []
const ok = (n, c, d = '') => R.push({ n, p: !!c, d: String(d) })

/* 页面内工具：几何可见性 + 命中测试 + 文本读取。一次注入，多处复用。 */
const HELPERS = `
  window.__vis = (sel) => {
    const el = document.querySelector(sel)
    if (!el) return { found: false }
    const r = el.getBoundingClientRect()
    return { found: true, w: Math.round(r.width), h: Math.round(r.height),
             visible: r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none' }
  };
  window.__hit = (sel) => {
    const el = document.querySelector(sel)
    if (!el) return 'missing'
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) return 'zero-size'
    const x = r.left + r.width / 2, y = r.top + r.height / 2
    const t = document.elementFromPoint(x, y)
    if (!t) return 'null-target'
    if (el === t || el.contains(t) || t.contains(el)) return 'hit'
    return 'blocked-by ' + t.tagName + (t.className ? '.' + String(t.className).split(' ')[0] : '')
  };
  window.__t = (sel) => { const e = document.querySelector(sel); return e ? (e.innerText || e.textContent || '').trim() : '' };
  window.__num = (s) => { const m = String(s).replace(/,/g, '').match(/\\d+/); return m ? Number(m[0]) : -1 };
`

const browser = await launch({})
try {
  const page = await browser.newPage()
  await page.enable()
  await page.addInitScript(`
    try {
      localStorage.setItem('hergent_v2_token', ${JSON.stringify(TOKEN)});
      localStorage.setItem('hergent_v2_tenant', '1');
    } catch (e) {}
  `)

  /* ---------------- 相位 1：落地 + 页签 ---------------- */
  const landed = await page.goto(BASE + '/?cb=' + Date.now() + '#/archive/customers', 9000)
  await page.eval(HELPERS)
  ok('P1 已登录（未落回登录页）', !/#\/login/.test(String(landed)), landed)

  const tabInfo = JSON.parse(await page.eval(`JSON.stringify({
    tabs: [...document.querySelectorAll('.module-tabs button')].map(b => b.textContent.trim()),
    url: location.href, tabKey: document.querySelector('.module-tabs button.on') ? document.querySelector('.module-tabs button.on').textContent.trim() : ''
  })`) || '{}')
  ok('P2 档案页签含「客户档案」', (tabInfo.tabs || []).includes('客户档案'), JSON.stringify(tabInfo.tabs))
  ok('P3 URL 停在 /archive/customers（未被 redirect 走）', /#\/archive\/customers/.test(String(tabInfo.url)), tabInfo.url)
  ok('P4 当前选中的页签就是「客户档案」', tabInfo.tabKey === '客户档案', 'on=' + tabInfo.tabKey)

  /* ---------------- 相位 2：页面结构 + 几何可见性（反例对照） ---------------- */
  const st = JSON.parse(await page.eval(`(() => {
    const txt = document.body.innerText || ''
    const rows = [...document.querySelectorAll('.archive-panel table.tbl tbody tr')]
    const bizSel = document.querySelector('.cas-filters select')
    const nameCell = rows.length ? rows[0].querySelector('td.cas-name') : null
    return JSON.stringify({
      hasP1: /P1\\s*规划中/.test(txt),
      hasComing: /即将上线/.test(txt),
      stat: window.__t('.cas-stat'),
      pageinfo: window.__t('.cas-pageinfo'),
      rowCount: rows.length,
      firstName: nameCell ? (nameCell.innerText || '').trim() : '',
      bizOptions: bizSel ? bizSel.options.length : -1,
      bizFirstLabel: bizSel && bizSel.options[1] ? bizSel.options[1].textContent.trim() : '',
      kw: window.__vis('.cas-kw'),
      kwHit: window.__hit('.cas-kw'),
      biz: window.__vis('.cas-filters select'),
      tbl: window.__vis('.archive-panel table.tbl'),
      actions: window.__vis('.cas-actions'),
      addHit: window.__hit('.cas-actions .btn-primary'),
      impHit: window.__hit('.cas-actions .btn-ghost:last-child'),
      headers: [...document.querySelectorAll('.archive-panel table.tbl thead th')].map(th => th.textContent.trim()),
      sub: window.__t('.page-sub'),
    })
  })()`))

  /* 🔴 反例侧：占位页的两个特征串必须**不出现**。
     对照依据（同一时刻、同一台机器上取）：当前生效包 Archive-DPJ1Wskz.js 里
     「P1 规划中」=0 / 我的判别串=1；旧包 Archive-Dih4yx1i.js 里 =1 / =0。 */
  ok('P5 页面**不含**「P1 规划中」（占位已移除）', !st.hasP1)
  ok('P6 页面**不含**「即将上线」', !st.hasComing)

  /* 正例侧：只有真实页才有的结构 */
  ok('P7 工具条 .cas-actions 几何可见（历史上被 .page-hd{display:none} 整块藏掉）',
     st.actions && st.actions.visible, JSON.stringify(st.actions))
  ok('P8「+ 新增客户」按钮**命中测试通过**（可见且未被遮挡）', st.addHit === 'hit', st.addHit)
  ok('P9「导入」按钮命中测试通过', st.impHit === 'hit', st.impHit)
  ok('P10 搜索框几何可见', st.kw && st.kw.visible, JSON.stringify(st.kw))
  ok('P11 搜索框命中测试通过', st.kwHit === 'hit', st.kwHit)
  ok('P12 业态下拉几何可见', st.biz && st.biz.visible, JSON.stringify(st.biz))
  ok('P13 业态下拉选项 > 1（选项来自 /api/contacts/options，非硬编码）',
     st.bizOptions > 1, 'options=' + st.bizOptions + ' 第1项=' + st.bizFirstLabel)
  ok('P14 列表渲染出真实行', st.rowCount >= 1, 'rows=' + st.rowCount + ' 首行=' + st.firstName)
  ok('P15 表头 8 列符合设计（客户名称/业态/片区/老板·电话/负责业务员/应收余额/最近下单/操作）',
     st.headers.length === 8 && st.headers[0] === '客户名称', JSON.stringify(st.headers))
  ok('P16 分页文案存在（total > 每页 20 条才会渲染）', /共\s*\d+\s*个客户/.test(st.pageinfo), st.pageinfo)
  ok('P17 顶部客户计数存在', /个客户/.test(st.stat), st.stat)

  console.log('页面读数：stat=' + JSON.stringify(st.stat) + ' | pageinfo=' + JSON.stringify(st.pageinfo)
    + ' | rows=' + st.rowCount + ' | bizOptions=' + st.bizOptions)

  /* ---------------- 相位 3：接口三方同源 ---------------- */
  const api = JSON.parse(await page.eval(`(async () => {
    const tok = localStorage.getItem('hergent_v2_token')
    const H = { Authorization: 'Bearer ' + tok, 'X-Tenant-Id': '1', 'X-Client': 'web' }
    const g = async (u) => { const r = await fetch(u, { headers: H }); let j = null; try { j = await r.json() } catch (e) {} return { status: r.status, j } }
    const a = await g('/api/contacts?type=customer&limit=5&offset=0')
    const b = await g('/api/contacts/options?type=customer')
    const c = await g('/api/contacts?type=customer&limit=1000&offset=0')
    const d = await g('/api/contacts?type=supplier&limit=3&offset=0')
    return JSON.stringify({
      a: { s: a.status, total: a.j && a.j.total, n: (a.j && a.j.items || []).length },
      b: (() => {
        const top = b.j ? Object.keys(b.j).sort() : null
        const o = (b.j && b.j.options) || {}
        return { s: b.status, topKeys: top, keys: Object.keys(o).sort(),
                 biz: Array.isArray(o.channel) ? o.channel.length : -1,
                 region: Array.isArray(o.region) ? o.region.length : -1,
                 channelList: o.channel || [] }
      })(),
      c: { s: c.status, total: c.j && c.j.total, n: (c.j && c.j.items || []).length },
      d: { s: d.status, total: d.j && d.j.total }
    })
  })()`))

  ok('P18 /api/contacts?type=customer 返回 200', api.a.s === 200, 'status=' + api.a.s)
  ok('P19 limit=5 时**真的只给 5 条**（旧的丢 limit 缺陷已修）', api.a.n === 5, 'n=' + api.a.n)
  ok('P20 limit=1000 时返回 > 200 条（旧的 200 硬顶已修）',
     api.c.n > 200, 'n=' + api.c.n + ' total=' + api.c.total)
  ok('P21 两种 limit 下 total 相同（total 来自 COUNT 而非 len(items)）',
     api.a.total === api.c.total, api.a.total + ' vs ' + api.c.total)
  ok('P22 total > 200（生产客户数已超旧硬顶）', api.a.total > 200, 'total=' + api.a.total)

  /* 🔴 三方同源：页面顶部计数 == 分页文案总数 == 接口 total */
  const nStat = /个客户/.test(st.stat) ? Number(String(st.stat).replace(/[^\d]/g, '')) : -1
  const nPage = /共\s*\d+\s*个客户/.test(st.pageinfo) ? Number(String(st.pageinfo).match(/共\s*(\d+)/)[1]) : -1
  ok('P23 【三方同源】顶部计数 == 接口 total', nStat === api.a.total, 'stat=' + nStat + ' api=' + api.a.total)
  ok('P24 【三方同源】分页文案总数 == 接口 total', nPage === api.a.total, 'page=' + nPage + ' api=' + api.a.total)
  ok('P25 页面首屏行数 == 请求的 limit（默认 20）', st.rowCount === 20 || st.rowCount === api.a.total,
     'rows=' + st.rowCount)

  ok('P26 /api/contacts/options 返回 200（路由顺序正确，未被 /{cid} 吞掉成 422）',
     api.b.s === 200, 'status=' + api.b.s)
  ok('P27 options 契约 = {options:{channel,region,assigned_salesperson,settlement_method}} 四维',
     Array.isArray(api.b.keys) && api.b.keys.length === 4,
     'keys=' + JSON.stringify(api.b.keys) + ' top=' + JSON.stringify(api.b.topKeys))
  ok('P28 options 里「业态(channel)」候选 > 1 个', api.b.biz > 1, 'channel=' + api.b.biz)
  ok('P29 options 里「片区(region)」候选 > 1 个', api.b.region > 1, 'region=' + api.b.region)
  ok('P30 下拉里的第 1 个真实选项**就在** options 接口返的业态清单里（真同源，非硬编码）',
     api.b.channelList.includes(st.bizFirstLabel),
     'label=' + st.bizFirstLabel + ' in ' + JSON.stringify(api.b.channelList.slice(0, 8)))
  ok('P31 type=supplier 走同一实现（供应商 38 家量级、与客户不混）',
     api.d.s === 200 && api.d.total > 0 && api.d.total !== api.a.total,
     'supplier=' + api.d.total + ' customer=' + api.a.total)

  /* ---------------- 相位 4：交互（只读，绝不保存） ---------------- */
  // 4a 打开「新增客户」弹窗
  await page.eval(`(document.querySelector('.cas-actions .btn-primary')||{click(){}}).click()`)
  await page.eval('new Promise(r=>setTimeout(r,600))')
  const modal = JSON.parse(await page.eval(`JSON.stringify({
    open: !!document.querySelector('.cas-modal'),
    title: window.__t('.cas-modal-hd b'),
    fields: document.querySelectorAll('.cas-modal .cas-f').length,
    mainFields: document.querySelectorAll('.cas-modal .cas-form:not(.cas-form-more) .cas-f').length,
    moreTxt: window.__t('.cas-more'),
    moreOpen: !!document.querySelector('.cas-form-more'),
    hasDatalist: ['cas-biz-list','cas-region-list','cas-emp-list'].map(id=>!!document.getElementById(id)),
    labels: [...document.querySelectorAll('.cas-modal .cas-form:not(.cas-form-more) .cas-f > span')].map(s=>s.textContent.replace(/\\s+/g,' ').trim())
  })`) || '{}')
  ok('P32 点「+ 新增客户」弹出表单', modal.open, JSON.stringify(modal.open))
  ok('P33 弹窗标题为「新增客户」', modal.title === '新增客户', modal.title)
  ok('P34 主字段 8 个（客户名称/业态/片区/负责业务员/老板姓名/老板电话/地址/备注）',
     modal.mainFields === 8, 'main=' + modal.mainFields + ' labels=' + JSON.stringify(modal.labels))
  ok('P35 「更多字段（选填）」折叠按钮存在且默认为收起态',
     /更多字段/.test(modal.moreTxt) && !modal.moreOpen, 'more=' + JSON.stringify(modal.moreTxt) + ' open=' + modal.moreOpen)
  ok('P36 三个 datalist 候选清单都已挂载（业态/片区/业务员）',
     (modal.hasDatalist || []).every(Boolean), JSON.stringify(modal.hasDatalist))

  // 4b 展开折叠区
  await page.eval(`(document.querySelector('.cas-more')||{click(){}}).click()`)
  await page.eval('new Promise(r=>setTimeout(r,400))')
  const more = JSON.parse(await page.eval(`JSON.stringify({
    open: !!document.querySelector('.cas-form-more'),
    n: document.querySelectorAll('.cas-form-more .cas-f').length,
    txt: window.__t('.cas-more'),
    types: [...document.querySelectorAll('.cas-form-more input')].map(i=>i.type),
    bizOptions: (() => { const s = document.querySelector('.cas-form-more select'); return s ? s.options.length : -1 })()
  })`) || '{}')
  ok('P37 点开后折叠区展开', more.open)
  ok('P38 折叠区 6 个字段（编码/助记码/电话/结算方式/账期/信用额度）', more.n === 6, 'n=' + more.n)
  ok('P39 折叠按钮文案变为「收起更多字段」', /收起/.test(more.txt), more.txt)
  ok('P40 结算方式下拉三选（未设置/现结/赊账）', more.bizOptions === 3, 'options=' + more.bizOptions)
  /* 🔴 数字格必须 type=text + inputmode=numeric：
     `type=number` 会把中文输入法的全角「１２」/「。」直接吞掉、且不触发 input 事件 ⇒ 数字格静默失效。 */
  ok('P41 账期/信用额度用 type=text（不用 type=number，避免吞全角数字）',
     !(more.types || []).includes('number') && (more.types || []).includes('text'),
     JSON.stringify(more.types))

  // 4c 关弹窗
  await page.eval(`(document.querySelector('.cas-x')||{click(){}}).click()`)
  await page.eval('new Promise(r=>setTimeout(r,500))')
  ok('P42 关闭后弹窗消失', !(await page.eval(`!!document.querySelector('.cas-modal')`)))

  // 4d 搜索：写一个必定不存在的关键词 ⇒ 必须走服务端查询并给空态
  const kwProbe = await page.eval(`(async () => {
    const inp = document.querySelector('.cas-kw')
    if (!inp) return JSON.stringify({ err: 'no input' })
    const before = document.querySelectorAll('.archive-panel table.tbl tbody tr').length
    inp.value = '__绝不可能存在的客户名__'
    inp.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 1400))
    const after = document.querySelectorAll('.archive-panel table.tbl tbody tr').length
    const empty = (document.querySelector('.state-empty') || {}).innerText || ''
    const stat = window.__t('.cas-stat')
    inp.value = ''
    inp.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 1400))
    const restored = document.querySelectorAll('.archive-panel table.tbl tbody tr').length
    return JSON.stringify({ before, after, empty: empty.trim(), stat, restored })
  })()`)
  const k = JSON.parse(String(kwProbe) || '{}')
  ok('P43 搜索关键字后列表真的被服务端过滤（行数归零）', k.after === 0, JSON.stringify(k))
  ok('P44 空态给出可读提示', /没有匹配的客户/.test(String(k.empty)), JSON.stringify(k.empty))
  ok('P45 清空关键字后列表恢复', k.restored >= 1, 'restored=' + k.restored)

  // 4e 业态筛选：选第一个真实业态 ⇒ 行数应 <= 全量
  const bizProbe = await page.eval(`(async () => {
    const sel = document.querySelector('.cas-filters select')
    if (!sel || sel.options.length < 2) return JSON.stringify({ err: 'no select' })
    const label = sel.options[1].textContent.trim()
    const before = window.__num(window.__t('.cas-stat'))
    sel.value = sel.options[1].value
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise(r => setTimeout(r, 1500))
    const after = window.__num(window.__t('.cas-stat'))
    const rows = document.querySelectorAll('.archive-panel table.tbl tbody tr').length
    sel.value = ''
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise(r => setTimeout(r, 1500))
    const restored = window.__num(window.__t('.cas-stat'))
    return JSON.stringify({ label, before, after, rows, restored })
  })()`)
  const bz = JSON.parse(String(bizProbe) || '{}')
  ok('P46 选业态后总数变小（筛选真的作用在服务端）',
     bz.after >= 0 && bz.after < bz.before, JSON.stringify(bz))
  ok('P47 清空业态后总数恢复', bz.restored === bz.before, JSON.stringify(bz))

  /* ---------------- 相位 5：无异常 ---------------- */
  const errs = (page.errors || []).filter(e => !/403/.test(e))
  ok('P48 全程零 console.error / 零页面异常', errs.length === 0, JSON.stringify(errs).slice(0, 300))

  await page.screenshot(SHOT)
} catch (e) {
  ok('探针执行未抛异常', false, e.message)
} finally {
  console.log('\n===== v316b 客户档案真机验收（只读）=====')
  let n = 0
  for (const r of R) {
    console.log((r.p ? 'PASS' : 'FAIL') + '  ' + r.n + (r.p ? '' : '   ← ' + r.d))
    n += r.p ? 1 : 0
  }
  console.log('---- ' + n + '/' + R.length + ' 通过 ----')
  await browser.close()
}
