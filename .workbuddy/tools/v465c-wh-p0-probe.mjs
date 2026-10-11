/**
 * v465c-wh-p0-probe.mjs —— 仓配管理 P0（库存查询三页落真身）只读真机探针
 *
 * 断言：三页在生产真机上「标题正确 + 关键控件在 + 零 console 错误」，
 *       并用**反例自证**（同一模块里仍是占位的 `/wh/other-in` 必须落在「开发中」骨架）
 *       证明判据能区分「已落真身」与「仍是占位」。
 *
 * 只读：仅 GET 页面与接口，零写请求。
 * 用法：WH_TOKEN=<boss token> node .workbuddy/tools/v465c-wh-p0-probe.mjs
 */
import { launch } from './lib/cdp-lite.mjs'

const TOKEN = process.env.WH_TOKEN || ''
const BASE = 'https://hergent.cn/'
if (!TOKEN) { console.log('缺少 WH_TOKEN'); process.exit(2) }

const CASES = [
  { name: '效期预警表', hash: '#/wh/expiry-report', expect: '效期预警表', need: '.kpi-strip', real: true },
  { name: '车辆库存查询', hash: '#/wh/vehicle-stock', expect: '车辆库存查询', need: 'select', real: true },
  { name: '库存预警', hash: '#/wh/stock-alert', expect: '库存预警', need: '.wsa-filter', real: true },
  // 反例自证：同一模块、仍是占位页 ⇒ 必须落在「开发中」骨架，而不是真页
  { name: '其它入库单（仍是占位）', hash: '#/wh/other-in', expect: '其它入库单', need: '.ph-card', real: false },
]

let pass = 0, fail = 0
const browser = await launch({ headless: true })
for (const c of CASES) {
  const page = await browser.newPage()
  await page.enable()
  await page.addInitScript(`try{localStorage.setItem('hergent_v2_token',${JSON.stringify(TOKEN)});}catch(e){}`)
  try {
    await page.goto(BASE + c.hash, 6000)
    await new Promise(r => setTimeout(r, 1800))
    const raw = await page.eval(`(function(){
      var h2 = document.querySelector('.page-hd h2');
      var out = {
        href: location.href,
        h2: h2 ? h2.textContent.trim() : '',
        hasPage: !!document.querySelector('.page'),
        hasKpi: !!document.querySelector('.kpi-strip'),
        hasSel: !!document.querySelector('select'),
        hasFilter: !!document.querySelector('.wsa-filter'),
        hasPhCard: !!document.querySelector('.ph-card'),
        hasErrState: !!document.querySelector('.state-error'),
        errText: (document.querySelector('.state-error')||{}).innerText || '',
        tblRows: document.querySelectorAll('table.tbl tbody tr').length
      };
      return JSON.stringify(out)
    })()`)
    const d = JSON.parse(raw)
    const errs = page.errors || []
    const checks = [
      ['标题命中', d.h2 === c.expect],
      ['落真身页面非空', d.hasPage === true],
      [`关键控件在(${c.need})`, c.need === '.kpi-strip' ? d.hasKpi : c.need === 'select' ? d.hasSel : c.need === '.ph-card' ? d.hasPhCard : d.hasFilter],
      ['非错误态', d.hasErrState === false],
      ['零 console 错误', errs.length === 0],
    ]
    if (c.real) checks.push(['不是占位骨架', d.hasPhCard === false])
    else checks.push(['确为占位骨架', d.hasPhCard === true])
    const bad = checks.filter(x => !x[1]).map(x => x[0])
    const ok = bad.length === 0
    if (ok) pass++; else fail++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}  href=${d.href}`)
    console.log(`      h2="${d.h2}" 表格行=${d.tblRows} 占位卡=${d.hasPhCard} 错误态=${d.hasErrState}`)
    if (bad.length) console.log(`      ✗ ${bad.join(' / ')}`)
    if (errs.length) console.log(`      console: ${errs.slice(0, 3).join(' | ')}`)
    if (c.real) {
      await page.screenshot(`/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v465c-wh-p0/${c.name}.png`).catch(() => {})
    }
  } catch (e) {
    fail++
    console.log(`FAIL  ${c.name}  异常: ${e.message}`)
  }
}
await browser.close()
console.log(`\n===== 汇总：PASS ${pass} / FAIL ${fail} =====`)
process.exit(fail ? 1 : 0)
