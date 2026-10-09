/**
 * v424 真机只读探针 —— 「报单配置」四页拆分验收
 *
 * 判据（缺一即 FAIL）：
 *   A. 侧栏「预报订单管理」弹窗里，「报单配置」是**独立一列（分组）**，
 *      四条入口纵向排列，顺序 = 使用频率（报单对象 → 报单自动化 → 报单提醒设置 → 模板参数）；
 *   A2. 四条入口**一屏可见**（无需上翻）：各自 rect 都落在视口内，且弹窗自身不需要内部滚动。
 *   B. 点每一条 ⇒ URL 的 `?tab=`、标签栏标题、页面内容三者**逐一对应**；
 *      且**只有那一块**内容在屏上（另三块不得同时出现）。
 *   C. 全程零 console.error / 零未捕获异常。
 *
 * 环境：本机 vite dev（5195，/api 代理到生产）+ demo 会话（tenant 10 / boss / 只读）。
 * 副作用：1 次 POST /api/auth/demo-login（新增 1 条会话记录，与真实登录同性质）。
 * 用法：node .workbuddy/tools/v424-config-split-probe.mjs
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'

const BASE = process.env.PROBE_BASE || 'http://127.0.0.1:5195'
const API = 'https://erp.hergent.cn'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const R = []
const ok = (id, label, cond, got) => R.push({ id, label, ok: !!cond, got: got === undefined ? '' : String(got) })

/* ---------- 0. demo 会话（只读 boss） ---------- */
const lr = await fetch(API + '/api/auth/demo-login', { method: 'POST' })
const ld = await lr.json()
const TOKEN = ld.token
const TENANT = String(ld.tenant_id || '')
const USERJSON = JSON.stringify(ld.user || {})
if (!TOKEN) { console.error('demo-login 未取到 token'); process.exit(2) }
console.log(`demo 会话：tenant=${TENANT} role=${(ld.user || {}).role} user=${(ld.user || {}).username}`)

const HELP = `(function(){
  window.__p = {
    vis: function(el){ return !!el && el.getBoundingClientRect().width > 0 && getComputedStyle(el).display !== 'none' },
    txt: function(el){ return el ? el.textContent.replace(/\\s+/g,'') : '' },
    areaBtn: function(name){
      return [].slice.call(document.querySelectorAll('.sb-area-btn')).filter(function(b){
        return window.__p.vis(b) && window.__p.txt(b).indexOf(name) >= 0 })[0] || null;
    },
    pop: function(){
      return [].slice.call(document.querySelectorAll('.sb-pop')).filter(window.__p.vis)[0] || null;
    },
    readPop: function(){
      var pop = window.__p.pop();
      if (!pop) return { open:false };
      var cols = [].slice.call(pop.querySelectorAll('.sb-pop-col')).map(function(c){
        var hd = c.querySelector('.sb-pop-hd');
        var items = [].slice.call(c.querySelectorAll('.sb-pop-item')).map(function(a){
          var r = a.getBoundingClientRect();
          return { name: window.__p.txt(a), href: a.getAttribute('href'),
                   top: Math.round(r.top), bottom: Math.round(r.bottom),
                   vis: r.width > 0 && getComputedStyle(a).display !== 'none' };
        });
        return { label: window.__p.txt(hd), items: items };
      });
      var pr = pop.getBoundingClientRect();
      return { open:true, cols: cols, popTop: Math.round(pr.top), popBottom: Math.round(pr.bottom),
               popH: Math.round(pr.height), vh: window.innerHeight,
               scrollH: pop.scrollHeight, clientH: pop.clientHeight };
    },
    clickPopItem: function(name){
      var pop = window.__p.pop(); if (!pop) return 'no-pop';
      var a = [].slice.call(pop.querySelectorAll('.sb-pop-item')).filter(function(x){
        return window.__p.txt(x) === name })[0];
      if (!a) return 'no-item';
      a.click(); return 'clicked';
    },
    activeTabTitle: function(){
      var b = [].slice.call(document.querySelectorAll('.tab-item')).filter(function(x){
        return x.classList.contains('on') })[0];
      return b ? window.__p.txt(b.querySelector('.tab-title')) : null;
    },
    tabTitles: function(){ return [].slice.call(document.querySelectorAll('.tab-item .tab-title')).map(window.__p.txt) },
    cfgCards: function(){ return [].slice.call(document.querySelectorAll('.cfg-card')).map(function(c){
      var t = c.querySelector('.cfg-title'); return window.__p.txt(t) }) },
    pageH2: function(){ var h = document.querySelector('.page-hd h2'); return h ? window.__p.txt(h) : null },
    pageSub: function(){ var s = document.querySelector('.page-hd .page-sub'); return s ? window.__p.txt(s) : null },
    tables: function(){ return document.querySelectorAll('table.tbl').length },
    hasBtn: function(t){ return [].slice.call(document.querySelectorAll('button')).some(function(b){
      return window.__p.vis(b) && window.__p.txt(b) === t }) },
    toolbarBtns: function(){ return [].slice.call(document.querySelectorAll('.toolbar button')).filter(window.__p.vis).map(window.__p.txt) }
  };
  return 'helper-ok';
})()`

const browser = await launch({ headless: true })
const page = await browser.newPage()
await page.enable()

try {
  /* ---------- 1. 注入会话 ---------- */
  await page.goto(BASE + '/#/login', 2500)
  const injected = await page.eval(`(function(){
    localStorage.setItem('hergent_v2_token', ${JSON.stringify(TOKEN)});
    localStorage.setItem('hergent_v2_tenant', ${JSON.stringify(TENANT)});
    localStorage.setItem('hergent_v2_user', ${JSON.stringify(USERJSON)});
    return localStorage.getItem('hergent_v2_token') ? 'ok' : 'fail';
  })()`)
  ok('S0', '会话注入 localStorage', injected === 'ok', injected)

  /* ---------- 2. 进「报单对象」页 ---------- */
  await page.goto(BASE + '/#/forecast?tab=config', 6500)
  await page.eval(HELP)

  const h2 = await page.eval('JSON.stringify({h2: window.__p.pageH2(), sub: window.__p.pageSub(), tables: window.__p.tables(), toolbar: window.__p.toolbarBtns()})')
  const obj = JSON.parse(h2 || '{}')
  ok('B0[首屏]', '?tab=config 首屏 = 报单对象（表格 + 新建配置）',
    obj.tables > 0 && (obj.toolbar || []).some(t => t.indexOf('新建配置') >= 0),
    JSON.stringify(obj))

  /* ---------- 3. 打开侧栏弹窗，读分组结构 ---------- */
  await page.eval(`(function(){
    if (window.__p.pop()) return 'already';
    var b = window.__p.areaBtn('预报订单管理'); if (!b) return 'no-area-btn'; b.click(); return 'clicked'
  })()`)
  await sleep(600)
  await page.eval(HELP)
  const popRaw = await page.eval('JSON.stringify(window.__p.readPop())')
  const pop = JSON.parse(popRaw || '{"open":false}')

  ok('A0', '侧栏存在「预报订单管理」一级项且可展开', pop.open === true, pop.open)
  ok('A1', '弹窗已展开', pop.open === true, pop.open)
  const labels = (pop.cols || []).map(c => c.label)
  ok('A2', '弹窗分列标题 = [预报订单, 报单配置]', JSON.stringify(labels) === JSON.stringify(['预报订单', '报单配置']), JSON.stringify(labels))

  const orderCol = (pop.cols || []).find(c => c.label === '报单配置')
  const orderNames = orderCol ? orderCol.items.map(i => i.name) : []
  ok('A3', '「报单配置」四条入口、按使用频率自上而下',
    JSON.stringify(orderNames) === JSON.stringify(['报单对象', '报单自动化', '报单提醒设置', '模板参数']),
    JSON.stringify(orderNames))
  ok('A4', '「预报订单」列 = [本期预报, 历史期次, 商品目标]（报单配置已迁出）',
    JSON.stringify(((pop.cols || [])[0] || {}).items ? pop.cols[0].items.map(i => i.name) : []) === JSON.stringify(['本期预报', '历史期次', '商品目标']),
    JSON.stringify(((pop.cols || [])[0] || {}).items || []))

  const inView = (orderCol ? orderCol.items : []).filter(i => i.vis && i.top >= 0 && i.bottom <= (pop.vh || 0))
  ok('A5', '四条入口一屏可见（rect 全在视口内，无需上翻）',
    orderCol && inView.length === 4, `in-view=${inView.length}/4 vh=${pop.vh} tops=${JSON.stringify((orderCol ? orderCol.items : []).map(i => i.top + '~' + i.bottom))}`)
  ok('A6', '弹窗自身不需内部滚动（scrollH <= clientH）',
    (pop.scrollH || 0) <= (pop.clientH || 0) + 1, `scrollH=${pop.scrollH} clientH=${pop.clientH}`)

  /* ---------- 4. 逐条点击 → 三面一致 ---------- */
  const CASES = [
    { name: '报单对象',     tab: 'config',          title: '报单对象',     cards: [],                                table: true,  h2sub: '报单简称' },
    { name: '报单自动化',   tab: 'config-auto',     title: '报单自动化',   cards: ['报单自动化'],                     table: false },
    { name: '报单提醒设置', tab: 'config-remind',   title: '报单提醒设置', cards: ['报单提醒设置'],                   table: false },
    { name: '模板参数',     tab: 'config-template', title: '模板参数',     cards: ['模板参数'],                       table: false }
  ]

  for (const c of CASES) {
    // 重新打开弹窗（点走一条后 areaClose 会收起）—— 幂等：已在开就不再点，避免「点一下反而收起」
    await page.eval(`(function(){
      if (window.__p.pop()) return 'already';
      var b = window.__p.areaBtn('预报订单管理'); if (b) b.click(); return 'clicked'
    })()`)
    await sleep(500)
    await page.eval(HELP)
    const clickRes = await page.eval(`window.__p.clickPopItem(${JSON.stringify(c.name)})`)
    await sleep(1800)
    await page.eval(HELP)

    const snapRaw = await page.eval(`JSON.stringify({ url: location.hash, tab: window.__p.activeTabTitle(), cards: window.__p.cfgCards(), tables: window.__p.tables(), h2: window.__p.pageH2(), sub: window.__p.pageSub(), toolbar: window.__p.toolbarBtns(), tabs: window.__p.tabTitles() })`)
    const s = JSON.parse(snapRaw || '{}')
    const tag = `B[${c.name}]`

    ok(tag + '.click', '弹窗条目可点', clickRes === 'clicked', clickRes)
    ok(tag + '.url', `URL tab=${c.tab}`, String(s.url || '').indexOf('tab=' + c.tab) >= 0, s.url)
    ok(tag + '.tabtitle', `标签栏当前标题 = ${c.title}`, s.tab === c.title, s.tab)
    ok(tag + '.cards', `屏上 cfg-card = ${JSON.stringify(c.cards)}`, JSON.stringify(s.cards || []) === JSON.stringify(c.cards), JSON.stringify(s.cards))
    ok(tag + '.table', `报单对象表${c.table ? '在' : '不在'}屏上`, (s.tables > 0) === c.table, `tables=${s.tables}`)
    if (c.name === '报单对象') {
      ok(tag + '.sub', '保留副标题（业务口径）', String(s.sub || '').indexOf('报单简称') >= 0, s.sub)
      ok(tag + '.toolbar', '工具栏含「新建配置」', (s.toolbar || []).some(t => t.indexOf('新建配置') >= 0), JSON.stringify(s.toolbar))
    }

    /* 5'. 内容深度（证明「拆出来但功能没丢」）+ 侧栏当前项高亮（isCur 认新 tab 键） */
    if (c.name === '模板参数') {
      const d = JSON.parse(await page.eval(`JSON.stringify({ inputs: document.querySelectorAll('.tp-body input').length,
        labels: [].slice.call(document.querySelectorAll('.tp-body label')).map(function(l){return l.textContent.replace(/\\s+/g,'')}),
        save: window.__p.hasBtn('保存') })`) || '{}')
      ok(tag + '.fields', '模板参数字段仍在（公司名称/业务员/默认仓/起始序号/下单主体）',
        (d.labels || []).length >= 5 && (d.inputs || 0) >= 4, JSON.stringify(d.labels))
      ok(tag + '.savebtn', '「保存」按钮在', d.save === true, d.save)
    }
    if (c.name === '报单提醒设置') {
      const d = JSON.parse(await page.eval(`JSON.stringify({ sw: document.querySelectorAll('.switch input').length,
        chk: document.querySelectorAll('.chk input').length, blocks: document.querySelectorAll('.set-block').length,
        save: window.__p.hasBtn('保存设置') })`) || '{}')
      ok(tag + '.control', '提醒面板控件仍在（总开关 + 分块勾选 + 保存设置）',
        (d.sw || 0) >= 1 && (d.chk || 0) >= 4 && (d.blocks || 0) >= 3 && d.save === true, JSON.stringify(d))
    }
    if (c.name === '报单自动化') {
      const d = JSON.parse(await page.eval(`JSON.stringify({ seg: document.querySelectorAll('.ap-grid .seg-btn').length,
        inp: document.querySelectorAll('.ap-grid input[type=time]').length, sel: document.querySelectorAll('.ap-grid select').length })`) || '{}')
      ok(tag + '.control', '自动化面板控件仍在（模式二选一 + 3 个时刻 + 品牌节奏下拉）',
        (d.seg || 0) >= 2 && (d.inp || 0) >= 3 && (d.sel || 0) >= 1, JSON.stringify(d))
    }
    {
      await page.eval(`(function(){
        if (window.__p.pop()) return 'already';
        var b = window.__p.areaBtn('预报订单管理'); if (b) b.click(); return 'clicked' })()`)
      await sleep(400)
      await page.eval(HELP)
      const cur = await page.eval(`(function(){
        var a = [].slice.call(document.querySelectorAll('.sb-pop-item.cur')).filter(window.__p.vis)[0];
        return a ? window.__p.txt(a) : '' })()`)
      ok(tag + '.hl', '侧栏弹窗内当前项高亮 = ' + c.name, cur === c.name, cur)
    }
  }

  /* ---------- 5. 反向：旧深链 ?tab=config 仍落在「报单对象」 ---------- */
  await page.goto(BASE + '/#/forecast?tab=config', 4000)
  await page.eval(HELP)
  const legacy = await page.eval(`JSON.stringify({ tab: window.__p.activeTabTitle(), tables: window.__p.tables(), cards: window.__p.cfgCards() })`)
  const lg = JSON.parse(legacy || '{}')
  ok('C1', '旧深链 ?tab=config → 报单对象（表格在、cfg-card 不在）',
    lg.tab === '报单对象' && lg.tables > 0 && (lg.cards || []).length === 0, JSON.stringify(lg))

  /* ---------- 6. 零报错 ---------- */
  const errs = page.errors || []
  ok('D1', '全程零 console.error / 零未捕获异常', errs.length === 0, errs.slice(0, 4).join(' || '))
} catch (e) {
  ok('EXC', '探针自身异常', false, (e && e.message) || String(e))
} finally {
  await browser.close()
}

/* ---------- 汇总 ---------- */
const pass = R.filter(r => r.ok).length
console.log('\n=== v424 报单配置四页拆分 · 真机只读探针 ===')
for (const r of R) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.id.padEnd(20)} ${r.label}${r.got ? '   → ' + r.got : ''}`)
console.log(`\n小结：PASS ${pass} / FAIL ${R.length - pass} / 共 ${R.length}`)
process.exit(R.some(r => !r.ok) ? 1 : 0)
