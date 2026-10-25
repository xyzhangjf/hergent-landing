/* 建单页 §R 规范符合性探针（v680）
   —— 以「采购订货单建单页」为基准，量测 7 个建单页的行高/列宽/内距/字号/对齐/表头/底部条/配色。
   用法: node tests/perf/v680/conformance.mjs [baseUrl]
   输出: JSON 到 tests/perf/v680/conformance.json + 控制台摘要 */
import { chromium } from 'playwright'
import fs from 'fs'

const BASE = process.argv[2] || 'https://hergent.cn'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const ROUTES = [
  ['采购订货单(基准)', '/inventory/purchase/new'],
  ['采购退货单', '/inventory/purchase/return/new'],
  ['自提订单', '/inventory/sale/self-pickup/new'],
  ['自提退单', '/inventory/sale/self-pickup/return/new'],
  ['车销订单', '/inventory/sale/vehicle/new'],
  ['车销退单', '/inventory/sale/vehicle/return/new'],
  ['调拨单', '/inventory/transfer/new'],
]

const b = await chromium.launch({ channel: 'chrome', headless: true })
const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } })
const page = await ctx.newPage()
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
const demo = page.getByRole('button', { name: /先看看演示效果/ })
await demo.first().waitFor({ timeout: 25000 })
await demo.first().click()
await page.waitForSelector('.topbar', { timeout: 30000 })
await sleep(1200)

const out = { base: BASE, viewport: '1920x1080', pages: {} }

for (const [name, route] of ROUTES) {
  await page.evaluate((h) => { location.hash = h }, route)
  await sleep(1700)
  const r = await page.evaluate(() => {
    const px = (v) => Math.round(parseFloat(v) * 10) / 10
    const q = (s) => document.querySelector(s)
    const tbl = q('table.tbl')
    if (!tbl) return { found: false }
    const tr = tbl.querySelector('tbody tr')
    const tds = tr ? [...tr.children] : []
    const opTd = tds.find((td) => /c-op$/.test(td.className))
    const th = tbl.querySelector('thead th')
    const thcs = getComputedStyle(th)
    const td0 = tds[1] || tds[0]
    const tdcs = getComputedStyle(td0)
    const btn = opTd ? opTd.querySelector('.btn-row-ic') : null
    const bcs = btn ? getComputedStyle(btn) : null
    const opcs = opTd ? getComputedStyle(opTd) : null
    // 表单头
    const hd = q('.ipn-hd, .isn-hd')
    const lb = q('.ipn-lb, .isn-lb')
    const hdCtl = q('.ipn-hd .input, .isn-hd .input, .ipn-hd select, .isn-hd select')
    // 底部条
    const bottom = q('.ipn-bottom, .isn-bottom')
    const total = q('.ipn-total, .isn-total')
    const saveBtn = q('.ipn-save .btn, .isn-save .btn, .ipn-bottom .btn, .isn-bottom .btn')
    // 换算小字
    const conv = q('.ipn-conv, .isn-conv')
    const convcs = conv ? getComputedStyle(conv) : null
    // 商品列
    const prodTh = tbl.querySelector('th.ipn-c-prod, th.isn-c-prod')
    const numTh = tbl.querySelector('th.ipn-c-qty, th.isn-c-price, th.isn-c-amt, th.isn-c-qty')
    const unitTh = tbl.querySelector('th.ipn-c-unit, th.isn-c-unit')
    const stkTh = tbl.querySelector('th.ipn-c-stk, th.isn-c-stk')
    return {
      found: true,
      density: document.documentElement.getAttribute('data-density') || 'none',
      rowH: tr ? px(tr.getBoundingClientRect().height) : null,
      thH: px(thcs.height),
      thFont: thcs.fontSize,
      thPad: thcs.paddingTop + ' ' + thcs.paddingBottom,
      tdPad: tdcs.paddingTop + ' ' + tdcs.paddingBottom,
      tdPadLR: tdcs.paddingLeft + ' ' + tdcs.paddingRight,
      opW: opTd ? px(opTd.getBoundingClientRect().width) : null,
      opBg: opcs ? opcs.backgroundColor : null,
      opShadow: opcs ? opcs.boxShadow : null,
      opBtnH: bcs ? px(bcs.height) : null,
      opBtnsPerRow: opTd ? (() => {
        const bs = [...opTd.querySelectorAll('.btn-row-ic')]
        if (!bs.length) return 0
        const tops = new Set(bs.map((x) => Math.round(x.getBoundingClientRect().top)))
        return tops.size
      })() : null,
      prodW: prodTh ? px(prodTh.getBoundingClientRect().width) : null,
      numW: numTh ? px(numTh.getBoundingClientRect().width) : null,
      unitW: unitTh ? px(unitTh.getBoundingClientRect().width) : null,
      stkW: stkTh ? px(stkTh.getBoundingClientRect().width) : null,
      hdH: hd ? px(hd.getBoundingClientRect().height) : null,
      lbFont: lb ? getComputedStyle(lb).fontSize : null,
      hdCtlH: hdCtl ? px(getComputedStyle(hdCtl).height) : null,
      bottomH: bottom ? px(bottom.getBoundingClientRect().height) : null,
      totalFont: total ? getComputedStyle(total).fontSize : null,
      saveBtnH: saveBtn ? px(getComputedStyle(saveBtn).height) : null,
      convDisplay: convcs ? convcs.display : null,
      convPos: convcs ? convcs.position : null,
    }
  })
  out.pages[name] = r
  console.log(name, JSON.stringify(r))
}

fs.writeFileSync('tests/perf/v680/conformance.json', JSON.stringify(out, null, 2))
await b.close()
console.log('[written] tests/perf/v680/conformance.json')
