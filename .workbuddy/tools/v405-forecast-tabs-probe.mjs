/**
 * v405 —— 预报页「页内固定页签退役」只读真机探针（打**本地 dev**，非生产）
 *
 * 被验改动（v405，2026-10-08）：
 *   ① `Forecast.vue` 删掉 `.module-tabs` 页签条（本期预报 / 历史期次 / 报单配置 / 商品目标）
 *      ＋ 其 scoped 样式块；`activeTab` / `setTab()` 保留，改由 URL 的 `?tab=` 驱动。
 *   ② `Shell.vue::NAV` 的「预报订单管理」职能区补一条**无 tab** 的「本期预报」直达条目
 *      （否则主表只剩「历史期次」行的「＋」，受 `canDo('data','create')` 收口）。
 *   ③ `EXPLODED_PATHS` 补 `/forecast` —— 手机端（标签栏不出）抽屉必须摊平三个子页。
 *   ④ `onViewHistory` 由 `activeTab.value='summary'` 改为 `setTab('summary')`（写 URL）。
 *
 * 🔴 判别力自证（缺一不可，否则"全绿"没有意义）：
 *   ① 每条"某类元素个数 = 0"的判据，都先**插桩**造一个同类元素，证明选择器真能选中
 *      （否则选择器写错也会得到 0 = 假绿）。
 *   ② 顶部标签栏必须**实测到 1 条**（不是"我以为它在那"）—— 页内占位删掉后，
 *      它是"我在哪一页"的唯一依据。
 *   ③ 点弹窗子页后**标签数 +1**、再点回默认子页**标签数不变**（URL 归一）——
 *      这一对正反才证明「URL 是唯一真相」没被打断。
 *   ④ 零写入：整轮只允许 GET/HEAD（本探针只读）。
 *
 * 运行：
 *   V405_BASE=http://127.0.0.1:5199 \
 *   V405_TOKEN=$(ssh root@47.113.224.140 'python3 /tmp/v392-probe-tokens.py boss' | cut -f3) \
 *   NODE_PATH=/Users/zhangjunfeng/.workbuddy/binaries/node/workspace/node_modules \
 *   /Users/zhangjunfeng/.workbuddy/binaries/node/versions/22.22.2-6/bin/node \
 *     .workbuddy/tools/v405-forecast-tabs-probe.mjs
 */
import { launch } from './lib/cdp-lite.mjs'

const BASE = process.env.V405_BASE || 'http://127.0.0.1:5199'
const TOKEN = process.env.V405_TOKEN || ''
const TENANT = '1'

const PASS = []
const FAIL = []
const ok = (name, cond, detail = '') => {
  ;(cond ? PASS : FAIL).push(name)
  console.log('  ' + (cond ? 'PASS' : 'FAIL') + '  ' + name + (detail ? ' | ' + detail : ''))
}
const note = (t) => console.log('    · ' + t)
const section = (t) => console.log('\n' + '─'.repeat(78) + '\n' + t + '\n' + '─'.repeat(78))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const INIT = `
;(function(){
  try {
    localStorage.setItem('hergent_v2_token', ${JSON.stringify(TOKEN)});
    localStorage.setItem('hergent_v2_tenant', ${JSON.stringify(TENANT)});
    localStorage.setItem('hergent_v2_csrf', 'probe-csrf');
    localStorage.setItem('hergent_v2_user', JSON.stringify({ id: 2, username: 'boss', role: 'boss', roles: ['boss'], name: '老板' }));
  } catch (e) {}
})();
;(function(){
  window.__WRITES = [];
  function log(m, u){
    try {
      if (String(u).indexOf('/api/') >= 0 && String(m).toUpperCase() !== 'GET' && String(m).toUpperCase() !== 'HEAD')
        window.__WRITES.push(String(m).toUpperCase() + ' ' + String(u).replace(/^https?:\\/\\/[^/]+/, ''));
    } catch (e) {}
  }
  var f = window.fetch;
  window.fetch = function(a, b){
    try { log((b && b.method) || (a && a.method) || 'GET', (typeof a === 'string') ? a : ((a && a.url) || '')); } catch (e) {}
    return f.apply(this, arguments);
  };
  var xo = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(m, u){ try { log(m, u); } catch (e) {} return xo.apply(this, arguments); };
})();
`

/* 页面内的取数片段（集中一处，避免各相位各写一份选择器） */
const EV = {
  areaBtnClick: (label) => `(() => {
      const b = Array.from(document.querySelectorAll('.sb-area-btn')).find(x => x.textContent.includes(${JSON.stringify(label)}));
      if (!b) return false;
      b.click(); return true;
    })()`,
  popItems: `(() => Array.from(document.querySelectorAll('.sb-pop-item')).map(e => e.textContent.trim()))()`,
  popClick: (label) => `(() => {
      const a = Array.from(document.querySelectorAll('.sb-pop-item')).find(x => x.textContent.trim() === ${JSON.stringify(label)});
      if (!a) return false;
      a.click(); return true;
    })()`,
  tabTitles: `(() => Array.from(document.querySelectorAll('.tabbar .tab-item')).map(e => {
      const t = e.querySelector('.tab-title'); return t ? t.textContent.trim() : '';
    }).filter(Boolean))()`,
  mnavClick: `(() => {
      const b = Array.from(document.querySelectorAll('.mnav-item')).find(x => x.textContent.includes('更多'));
      if (!b) return false;
      b.click(); return true;
    })()`,
}

async function main() {
  if (!TOKEN) { console.error('!! 缺 V405_TOKEN'); process.exit(2) }
  console.log('目标：' + BASE + ' | 角色：boss | 浏览器：无头 Chrome')

  const browser = await launch({})
  const page = await browser.newPage()
  await page.enable()
  const sid = await page.addInitScript(INIT)

  /* ═══ P0 落地 ═══ */
  section('P0 打开 #/forecast（注入 boss 凭证）')
  await page.goto(BASE + '/#/forecast', 9000)
  const href0 = await page.eval('location.href')
  note('落点：' + href0)
  ok('P0 落在预报页（未被守卫弹回）', /#\/forecast/.test(String(href0)), String(href0))

  /* ═══ P1 页内页签条已消失（含判别力自证）═══ */
  section('P1 页内固定页签条已删除')
  const selfTest = await page.eval(`(() => {
    const d = document.createElement('div'); d.className = 'module-tabs';
    const bt = document.createElement('button'); bt.textContent = 'ZZ_PLACEHOLDER'; d.appendChild(bt);
    document.body.appendChild(d);
    const n = document.querySelectorAll('.module-tabs').length;
    const nb = document.querySelectorAll('.module-tabs button').length;
    d.remove();
    return { n, nb };
  })()`)
  ok('P1a 自证①：`.module-tabs` 选择器有判别力（插桩后 = 1）', selfTest.n === 1, 'n=' + selfTest.n)
  ok('P1b 自证②：`.module-tabs button` 选择器有判别力（插桩后 = 1）', selfTest.nb === 1, 'nb=' + selfTest.nb)

  const p1 = await page.eval(`(() => ({
    mt: document.querySelectorAll('.module-tabs').length,
    mtBtn: document.querySelectorAll('.module-tabs button').length,
    /* ⚠️ 必须排除**顶部标签栏**里的 button.tab-item ——
       它的 textContent 就是子页名（如「本期预报」），不排除会把**新机制**误判成
       "页内按钮还在"（首轮实测就是这么红了一条：假红，判据写错而非代码错）。
       ⚠️ 本段在 JS 模板串里 ⇒ 注释里**不许出现反引号**（会提前闭合模板串）。 */
    inlineBtns: Array.from(document.querySelectorAll('button'))
      .filter(b => !b.closest('.tabbar'))
      .map(b => (b.textContent || '').trim())
      .filter(t => ['本期预报', '历史期次', '报单配置', '商品目标'].includes(t)),
  }))()`)
  ok('P1c 页内 `.module-tabs` 个数 = 0', p1.mt === 0, 'mt=' + p1.mt)
  ok('P1d 页内 `.module-tabs button` 个数 = 0', p1.mtBtn === 0, 'mtBtn=' + p1.mtBtn)
  ok('P1e 页内不再有那 4 个子页按钮（逐字匹配）', p1.inlineBtns.length === 0, JSON.stringify(p1.inlineBtns))

  /* ═══ P2 顶部标签栏 ═══ */
  section('P2 顶部全局标签栏（删掉页内占位后唯一的位置指示）')
  const p2 = await page.eval(`(() => ({
    hasBar: !!document.querySelector('.tabbar'),
    items: Array.from(document.querySelectorAll('.tabbar .tab-item')).map(e => {
      const t = e.querySelector('.tab-title'); return t ? t.textContent.trim() : '';
    }).filter(Boolean),
    hasRefresh: !!document.querySelector('.tabbar .tab-refresh'),
    hasClose: !!document.querySelector('.tabbar .tab-close'),
  }))()`)
  ok('P2a 标签栏真实渲染', p2.hasBar === true)
  ok('P2b 初始恰好 1 条标签', p2.items.length === 1, JSON.stringify(p2.items))
  ok('P2c 该标签标题 = 「本期预报」', p2.items[0] === '本期预报', String(p2.items[0]))
  ok('P2d 标签三要素齐（⟳ / 标题 / ×）', p2.hasRefresh && p2.hasClose)

  /* ═══ P3 主体功能未被破坏 ═══ */
  section('P3 原有功能交互未受影响（工具栏 / 期次 / 筛选 / 网格）')
  const p3 = await page.eval(`(() => ({
    toolbar: !!document.querySelector('.card.toolbar'),
    periodSel: !!document.querySelector('select.sel-period'),
    periodOpts: document.querySelectorAll('select.sel-period option').length,
    search: !!document.querySelector('#gridFind'),
    grid: !!document.querySelector('.cross-tbl, .edit-tbl'),
    gridRows: document.querySelectorAll('.cross-tbl tbody tr, .edit-tbl tbody tr').length,
    title: document.title,
  }))()`)
  ok('P3a 主工具栏卡片存在', p3.toolbar === true)
  ok('P3b 期次选择器存在', p3.periodSel === true)
  ok('P3c 期次已从后端加载（option > 1）', p3.periodOpts > 1, 'opts=' + p3.periodOpts)
  ok('P3d 搜索框存在（订单筛选入口）', p3.search === true)
  ok('P3e 汇总表 / 编辑网格已渲染', p3.grid === true)
  note('网格行数=' + p3.gridRows + '（无进行中期次时为 0，不作硬判据）· title=' + p3.title)

  /* ═══ P4 侧栏弹窗 ═══ */
  section('P4 侧栏「预报订单管理」职能区弹窗：4 个子页入口')
  const clicked4 = await page.eval(EV.areaBtnClick('预报订单管理'))
  await sleep(500)
  const p4 = await page.eval(EV.popItems)
  ok('P4a 一级项可点开', clicked4 === true)
  ok('P4b 弹窗条目数 = 4（v405 补了「本期预报」）', p4.length === 4, JSON.stringify(p4))
  const want4 = ['本期预报', '历史期次', '报单配置', '商品目标']
  ok('P4c 4 条逐字 = ' + JSON.stringify(want4), JSON.stringify(p4) === JSON.stringify(want4), JSON.stringify(p4))

  /* ═══ P5 点子页 ═══ */
  section('P5 点「历史期次」：URL / 标签 / 内容三者一致')
  const n0 = (await page.eval(EV.tabTitles)).length
  const clicked5 = await page.eval(EV.popClick('历史期次'))
  await sleep(2000)
  const p5 = await page.eval(`(() => ({
    hash: location.hash,
    items: Array.from(document.querySelectorAll('.tabbar .tab-item')).map(e => {
      const t = e.querySelector('.tab-title'); return t ? t.textContent.trim() : '';
    }).filter(Boolean),
    mt: document.querySelectorAll('.module-tabs').length,
    histCard: !!document.querySelector('.history-card'),
  }))()`)
  ok('P5a 弹窗条目可点（命中「历史期次」）', clicked5 === true)
  ok('P5b URL 带 ?tab=history', /\?tab=history/.test(p5.hash), p5.hash)
  ok('P5c 标签数 = ' + (n0 + 1) + '（点一个开一个、累积）', p5.items.length === n0 + 1, JSON.stringify(p5.items))
  ok('P5d 新标签标题 = 「历史期次」', p5.items.includes('历史期次'), JSON.stringify(p5.items))
  ok('P5e 历史期次组件真实渲染（.history-card）', p5.histCard === true)
  ok('P5f 切子页后页内仍无 `.module-tabs`', p5.mt === 0, 'mt=' + p5.mt)

  /* ═══ P6 / P7 / P8 子页互跳三连 ═══
     🔴 每条都要**先重开侧栏弹窗**：点弹窗条目时模板上是 `@click="areaClose"` ⇒ 弹窗自动收起，
        直接连着点第二条必然 miss（首轮实测 P6 四条全红，就是这个原因）。 */
  const openPop = async () => {
    await page.eval(EV.areaBtnClick('预报订单管理'))
    await sleep(450)
  }

  section('P6 再点「本期预报」：URL 归一到 /forecast（已存在的标签不新增）')
  const n1 = p5.items.length
  await openPop()
  const clicked6 = await page.eval(EV.popClick('本期预报'))
  await sleep(2000)
  const p6 = await page.eval(`(() => ({
    hash: location.hash,
    items: Array.from(document.querySelectorAll('.tabbar .tab-item')).map(e => {
      const t = e.querySelector('.tab-title'); return t ? t.textContent.trim() : '';
    }).filter(Boolean),
    toolbar: !!document.querySelector('.card.toolbar'),
    histCard: !!document.querySelector('.history-card'),
  }))()`)
  ok('P6a 弹窗条目可点（命中「本期预报」）', clicked6 === true)
  ok('P6b URL 归一到不带 tab 的 /forecast', !/\?tab=/.test(p6.hash), p6.hash)
  ok('P6c 标签数不变（仍 ' + n1 + '，证归一未开重复标签）', p6.items.length === n1, JSON.stringify(p6.items))
  ok('P6d 主表回来了（.card.toolbar）', p6.toolbar === true)
  ok('P6e 历史期次已卸载（互斥渲染）', p6.histCard === false)

  section('P7 第三次点「历史期次」：标签数仍不变（同类再证）')
  await openPop()
  const clicked7 = await page.eval(EV.popClick('历史期次'))
  await sleep(2000)
  const p7 = await page.eval(`(() => ({
    hash: location.hash,
    items: Array.from(document.querySelectorAll('.tabbar .tab-item')).map(e => {
      const t = e.querySelector('.tab-title'); return t ? t.textContent.trim() : '';
    }).filter(Boolean),
    histCard: !!document.querySelector('.history-card'),
    viewBtn: !!Array.from(document.querySelectorAll('.history-card button')).find(b => b.textContent.trim() === '查看'),
  }))()`)
  ok('P7a 弹窗条目可点（命中「历史期次」）', clicked7 === true)
  ok('P7b URL 带 ?tab=history', /\?tab=history/.test(p7.hash), p7.hash)
  ok('P7c 标签数不变（仍 ' + n1 + '）', p7.items.length === n1, JSON.stringify(p7.items))
  ok('P7d 历史期次渲染 + 行内「查看」按钮在', p7.histCard === true && p7.viewBtn === true,
    'histCard=' + p7.histCard + ' viewBtn=' + p7.viewBtn)

  /* ═══ P8 🔴 本次唯一的**功能性修复**：`onViewHistory` 必须写 URL ═══
     改前是 `activeTab.value = 'summary'` ⇒ 页面切回主表、URL 却留在 `?tab=history`
     （页签条在时被页内高亮掩盖；退役后标签栏标题成了唯一指示 ⇒ 同屏自相矛盾）。 */
  section('P8 历史期次行内点「查看」：URL 必须归一到 /forecast（v405 修复点）')
  const clicked8 = await page.eval(`(() => {
      const b = Array.from(document.querySelectorAll('.history-card button')).find(x => x.textContent.trim() === '查看');
      if (!b) return false;
      b.click(); return true;
    })()`)
  if (!clicked8) {
    console.log('  SKIP  P8a 历史期次列表为空（无「查看」按钮）⇒ 本相位无法执行，非失败')
  } else {
    await sleep(2200)
    const p8 = await page.eval(`(() => ({
      hash: location.hash,
      items: Array.from(document.querySelectorAll('.tabbar .tab-item')).map(e => {
        const t = e.querySelector('.tab-title'); return t ? t.textContent.trim() : '';
      }).filter(Boolean),
      toolbar: !!document.querySelector('.card.toolbar'),
      histCard: !!document.querySelector('.history-card'),
    }))()`)
    ok('P8a 行内「查看」可点', clicked8 === true)
    ok('P8b URL 已归一到不带 tab 的 /forecast（修复：改前会停在 ?tab=history）', !/\?tab=/.test(p8.hash), p8.hash)
    ok('P8c 页面回到主表（.card.toolbar）', p8.toolbar === true)
    ok('P8d 历史期次已卸载', p8.histCard === false)
    ok('P8e 标签数不变（仍 ' + n1 + '）', p8.items.length === n1, JSON.stringify(p8.items))
  }

  /* ═══ P9 手机端 ═══ */
  section('P9 手机端 375px：标签栏不出 + 底部栏 + 抽屉摊平')
  await page.raw.send('Emulation.setDeviceMetricsOverride', {
    width: 375, height: 812, deviceScaleFactor: 2, mobile: true,
  })
  await sleep(900)
  const p9a = await page.eval(`(() => {
    const bar = document.querySelector('.tabbar');
    const vis = (el) => { if (!el) return null; const cs = getComputedStyle(el); return !(cs.display === 'none' || cs.visibility === 'hidden') && el.getBoundingClientRect().height > 0 };
    return {
      tabbarVisible: vis(bar),
      mnav: Array.from(document.querySelectorAll('.mnav-item')).filter(vis).map(e => e.textContent.trim()),
    };
  })()`)
  ok('P9a 手机端标签栏**不出现**（Q6 A）', p9a.tabbarVisible === false, String(p9a.tabbarVisible))
  ok('P9b 底部栏 = 3 项 + 「更多」', p9a.mnav.length === 4, JSON.stringify(p9a.mnav))
  ok('P9c 底部栏含「预报订单管理」（= summary 入口）', p9a.mnav.some(t => t.includes('预报订单管理')), JSON.stringify(p9a.mnav))

  const clickedMore = await page.eval(EV.mnavClick)
  await sleep(700)
  const drawer = await page.eval(`(() => ({
    sheet: !!document.querySelector('.md-sheet'),
    items: Array.from(document.querySelectorAll('.md-sheet .md-item')).map(e => e.textContent.trim()),
    groups: Array.from(document.querySelectorAll('.md-sheet .md-group-hd')).map(e => e.textContent.trim()),
  }))()`)
  ok('P9d 抽屉可打开', clickedMore === true && drawer.sheet === true)
  ok('P9e 抽屉里有「预报订单管理」组', drawer.groups.includes('预报订单管理'), JSON.stringify(drawer.groups))
  const want3 = ['历史期次', '报单配置', '商品目标']
  ok('P9f 抽屉摊平三子页 ' + JSON.stringify(want3), want3.every((t) => drawer.items.includes(t)), JSON.stringify(drawer.items))
  ok('P9g 抽屉**不含**「本期预报」（归底部栏，不重复）', !drawer.items.includes('本期预报'), JSON.stringify(drawer.items))

  /* ═══ P10 零写入 ═══ */
  section('P10 零写入（只读探针）')
  const writes = await page.eval('window.__WRITES || []')
  note('全部非 GET 请求：' + (writes.length ? JSON.stringify(writes) : '（无）'))
  const KNOWN_READONLY = []
  const unexpected = writes.filter((w) => !KNOWN_READONLY.some((re) => re.test(w)))
  ok('P10a 无非预期写请求', unexpected.length === 0, JSON.stringify(unexpected))

  /* ═══ P11 运行期错误 ═══ */
  section('P11 运行期错误')
  const errs = page.errors || []
  note('错误条数：' + errs.length)
  if (errs.length) errs.slice(0, 5).forEach((e) => note(e.slice(0, 200)))
  ok('P11a 无 console.error / 未捕获异常', errs.length === 0, errs.slice(0, 2).join(' ;; '))

  await page.removeInitScript(sid)
  await browser.close()

  section('汇总')
  console.log('PASS ' + PASS.length + ' / FAIL ' + FAIL.length)
  if (FAIL.length) { console.log('失败项：'); FAIL.forEach((f) => console.log('  - ' + f)) }
  process.exit(FAIL.length ? 1 : 0)
}

main().catch(async (e) => {
  console.error('探针异常：' + (e && e.message))
  process.exit(3)
})
