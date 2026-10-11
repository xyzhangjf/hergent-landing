/**
 * v465d-wh-nav-transfer-removed-probe.mjs —— 「仓配管理」区剔除「调拨单」只读真机探针
 *
 * 断言（生产真机）：
 *   A. 侧栏「仓配管理」弹窗 = 四列（仓库作业 / 配送作业 / 库存作业 / 库存查询）
 *   B. 「仓库作业」列恰好 6 项 = 入库单 / 出库单 / 盘点单 / 出入库策略 / 其它入库单 / 其它出库单
 *      ⇒ **不含「调拨单」**
 *   C. 全弹窗范围内零「调拨单」文本
 *   D. 反例自证：**进销存**区弹窗里「调拨单」必须仍在 ⇒ 证明判据能选中
 *      （否则「全站无调拨单」也会让 B/C 通过，判据恒真）
 *
 * 只读：仅 GET 首页并点开侧栏弹窗，零写请求。
 * 用法：WH_TOKEN=<boss token> node .workbuddy/tools/v465d-wh-nav-transfer-removed-probe.mjs
 */
import { launch } from './lib/cdp-lite.mjs'

const TOKEN = process.env.WH_TOKEN || ''
const BASE = 'https://hergent.cn/'
if (!TOKEN) { console.log('缺少 WH_TOKEN'); process.exit(2) }

const EXPECT_WORKSHOP = ['入库单', '出库单', '盘点单', '出入库策略', '其它入库单', '其它出库单']
const EXPECT_COLS = ['仓库作业', '配送作业', '库存作业', '库存查询']

let pass = 0, fail = 0
const rec = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
  ok ? pass++ : fail++
}

/** 打开某个侧栏职能区的弹窗，返回 {cols:[{hd, items:[]}], all} */
async function openArea(page, areaName) {
  await page.goto(BASE + '#/', 6000)
  await new Promise(r => setTimeout(r, 1800))
  const clicked = await page.eval(`(function(){
    var btns = [].slice.call(document.querySelectorAll('.sb-area-btn'));
    var t = btns.filter(function(b){ return (b.textContent||'').indexOf(${JSON.stringify(areaName)}) >= 0; });
    if (t.length !== 1) return JSON.stringify({ok:false, n:t.length, names:btns.map(function(b){return b.textContent.trim()})});
    t[0].click();
    return JSON.stringify({ok:true});
  })()`)
  const cj = JSON.parse(clicked)
  if (!cj.ok) return { err: `未唯一命中「${areaName}」区按钮（命中 ${cj.n} 个）` }
  await new Promise(r => setTimeout(r, 700))
  const raw = await page.eval(`(function(){
    var pop = document.querySelector('.sb-pop');
    if (!pop) return JSON.stringify({err:'弹窗未出现'});
    var cols = [].slice.call(pop.querySelectorAll('.sb-pop-col')).map(function(c){
      return {
        hd: (c.querySelector('.sb-pop-hd')||{}).textContent ? c.querySelector('.sb-pop-hd').textContent.trim() : '',
        items: [].slice.call(c.querySelectorAll('.sb-pop-item')).map(function(a){ return (a.textContent||'').trim(); })
      };
    });
    return JSON.stringify({cols: cols, all: (pop.innerText||'')});
  })()`)
  return JSON.parse(raw)
}

const browser = await launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.enable()
  await page.addInitScript(`try{localStorage.setItem('hergent_v2_token',${JSON.stringify(TOKEN)});}catch(e){}`)

  // ---- 面 1：仓配管理 ----
  const wh = await openArea(page, '仓配管理')
  if (wh.err) { rec('仓配管理弹窗可打开', false, wh.err) }
  else {
    rec('仓配管理弹窗可打开', true)
    const hds = wh.cols.map(c => c.hd)
    rec('四列标题正确', JSON.stringify(hds) === JSON.stringify(EXPECT_COLS), hds.join(' / '))

    const workshop = wh.cols.find(c => c.hd === '仓库作业')
    const items = workshop ? workshop.items : []
    rec('仓库作业列 = 6 项', items.length === EXPECT_WORKSHOP.length, `实测 ${items.length} 项：${items.join('、')}`)
    rec('仓库作业列逐项匹配（顺序）', JSON.stringify(items) === JSON.stringify(EXPECT_WORKSHOP),
      items.join('、'))
    rec('🔴 仓配整弹窗零「调拨单」', wh.all.indexOf('调拨单') < 0)

    // 库存查询列应含 P0 三页真身 + 既有两页
    const q = wh.cols.find(c => c.hd === '库存查询')
    const qi = q ? q.items : []
    const needQ = ['库存查询', '车辆库存查询', '效期预警表', '库存预警', '库存效期补录']
    const missQ = needQ.filter(x => qi.indexOf(x) < 0)
    rec('库存查询列含 P0 三页 + 既有两页', missQ.length === 0, missQ.length ? `缺 ${missQ.join('、')}` : qi.join('、'))
  }

  // ---- 面 2：反例自证（进销存区「调拨单」必须仍在）----
  const psi = await openArea(page, '进销存')
  if (psi.err) { rec('反例·进销存弹窗可打开', false, psi.err) }
  else {
    rec('反例·进销存弹窗可打开', true)
    rec('🔴 反例·进销存区「调拨单」仍在（判据非恒真）', psi.all.indexOf('调拨单') >= 0)
  }

  const errs = page.errors || []
  rec('零 console 错误', errs.length === 0, errs.slice(0, 3).join(' | '))
} finally {
  await browser.close()
}

console.log(`\n=== v465d 仓配剔除调拨单探针：PASS ${pass} / FAIL ${fail} ===`)
process.exit(fail ? 1 : 0)
