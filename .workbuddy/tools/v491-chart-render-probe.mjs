#!/usr/bin/env node
/**
 * v491 图表渲染台探针 —— 真组件 + 固定数据 + 无头测量
 * ============================================================================
 * 为什么需要它：图表「画得对不对」是视觉问题。读代码说不清（`height` 算出来
 * 0.4px 和 40px 在源码里长得一样），看生产又造不出需要的数据形状。
 * 所以**在本地渲染真实组件、把数据变量锁死**，再客观测量。
 *
 * 断言全部**成对**：既数「画了几根」也数「几根真的看得见」——
 * 才能区分「没画」和「画了但高度为 0」。
 *
 * 用法：
 *   node .workbuddy/tools/v491-chart-render-probe.mjs          # gen → 起 vite → 测量 → 清理
 *   node .workbuddy/tools/v491-chart-render-probe.mjs gen      # 只生成渲染台
 *   node .workbuddy/tools/v491-chart-render-probe.mjs probe    # 只测量（需先手工起 vite）
 *   node .workbuddy/tools/v491-chart-render-probe.mjs clean    # 只清理
 *
 * 产物：outputs/v491-chart/{measure.json, full.png, *.png}
 * 数据全部是**假数据**（不碰生产租户），但仍遵守清理纪律：跑完即删渲染台。
 */
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const FE = path.join(ROOT, 'hergent-cn-v2')
const NODE = '/Users/zhangjunfeng/.workbuddy/binaries/node/versions/22.22.2-6/bin/node'
const NODE_BIN = path.dirname(NODE)
const NODE_MODULES = '/Users/zhangjunfeng/.workbuddy/binaries/node/workspace/node_modules'
const PORT = 5199
const OUT = path.join(ROOT, 'outputs/v491-chart')
const F = {
  html: path.join(FE, 'v491-harness.html'),
  js: path.join(FE, 'v491-harness.js'),
  probe: path.join(HERE, 'v491-probe.cjs'),
}

/* ---------------------------------------------------------------- 渲染台 JS */
const HARNESS_JS = `/** v491 图表渲染台（**临时文件**，验证完毕即删 —— 见 v491-chart-render-probe.mjs clean）
 * 真组件 + 假数据。所有图表都走 src/components/chart/ 的真实实现，不复制一份逻辑。 */
import { createApp, h } from 'vue'
import './src/styles/variables.css'
import './src/styles/chart.css'
import ChartLine from './src/components/chart/ChartLine.vue'
import ChartBar from './src/components/chart/ChartBar.vue'
import ChartDonut from './src/components/chart/ChartDonut.vue'
import ChartHbar from './src/components/chart/ChartHbar.vue'
import ChartFigure from './src/components/chart/ChartFigure.vue'
import { renderMd } from './src/utils/md.js'
import { inlineSvg, resolveVar } from './src/components/chart/chartTheme.js'

const DAYS = ['10-07', '10-08', '10-09', '10-10', '10-11', '10-12', '10-13']
const MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']

/* 折线：第 4 天**故意为 null**（断口），验证「不画成 0」 */
const LINE_SERIES = [
  { name: '销售额', data: [12800, 15400, 9800, null, 21300, 18700, 24100] },
  { name: '毛利', data: [2600, 3100, 1900, null, 4400, 3800, 5100] },
]
/* 柱状 single：7 根都有值，其中一根极小（3）—— 验证 MIN_TRACK_PX 下限 */
const BAR_SINGLE = [{ name: '订单数', data: [42, 55, 31, 3, 73, 66, 81] }]
/* 柱状 target：10 个月有目标、后 2 个月**目标为 0**（不画轨道），达成有超标/不足 */
const TGT = [
  { name: '销量目标', data: [800, 800, 800, 900, 900, 900, 1000, 1000, 1000, 1100, 0, 0] },
  { name: '销量达成', data: [820, 760, 810, 950, 880, 1020, 1100, 940, 1010, 0, 0, 0] },
]
/* 柱状 grouped：3 槽 × 2 系列 = 6 根 */
const GRP = [
  { name: '今年', data: [120, 90, 75] },
  { name: '去年', data: [100, 110, 60] },
]
/* 柱状 stacked：4 槽 × 3 系列 = 12 段 */
const STK = [
  { name: '低温奶', data: [40, 55, 30, 62] },
  { name: '常温奶', data: [25, 20, 38, 18] },
  { name: '其他', data: [12, 9, 15, 22] },
]
/* 环形：8 类目 ⇒ maxSlices=6 ⇒ 前 5 片 + 「其他 3 项」 */
const DONUT_ITEMS = [
  { label: '蒙牛', value: 52000 }, { label: '伊利', value: 31000 }, { label: '光明', value: 18000 },
  { label: '君乐宝', value: 12000 }, { label: '三元', value: 8000 }, { label: '新希望', value: 5000 },
  { label: '认养一头牛', value: 3000 }, { label: '其他小牌', value: 1500 },
]
const HBAR_ITEMS = [
  { label: '永辉超市襄阳店', value: 128000 }, { label: '美廉美樊城店', value: 96000 },
  { label: '中百仓储长虹店', value: 74000 }, { label: '武商量贩襄城店', value: 51000 },
  { label: '好邻居便利店', value: 23000 },
]

/* ---- md.js 出图三形态 ---- */
const MD_LINE = '\`\`\`chart\\n' + JSON.stringify({
  type: 'line', title: '近 7 天销售', fmt: 'money',
  labels: DAYS, series: [{ name: '销售额', data: [12800, 15400, 9800, 17600, 21300, 18700, 24100] }],
}) + '\\n\`\`\`'
const MD_BAR = '\`\`\`chart:bar\\n' + JSON.stringify({
  type: 'bar', title: '品类销售额对比', fmt: 'money',
  labels: ['低温奶', '常温奶', '酸奶'],
  series: [{ name: '销售额', data: [52000, 31000, 18000] }],
}) + '\\n\`\`\`'
const MD_TABLE = [
  '| 品牌 | 销售额 |', '| --- | --- |',
  '| 蒙牛 | 120000 |', '| 伊利 | 98000 |', '| 光明 | 76000 |', '| 君乐宝 | 54000 |',
].join('\\n')
/* spec 非法：**刻意什么都不输出**（不能把半截 JSON 漏到老板眼前） */
const MD_BAD = '\`\`\`chart\\n{ this_is_not_json' + '\\n\`\`\`'

const section = (name, children) => h('section', { class: 'case', 'data-case': name }, children)
const md = (name, src) => section(name, [h('div', { class: 'md-wrap', innerHTML: renderMd(src) })])

const App = {
  render() {
    return h('div', { class: 'grid' }, [
      section('line-basic', [h(ChartLine, { title: '近 7 天销售与毛利', labels: DAYS, series: LINE_SERIES, height: 240 })]),
      section('bar-single', [h(ChartBar, { title: '近 7 天订单数', labels: DAYS, series: BAR_SINGLE, fmt: 'plain', height: 220, refLines: [{ value: 50, label: '日均 50' }] })]),
      section('bar-target', [h(ChartBar, { title: '月度销量目标 vs 达成', labels: MONTHS, series: TGT, mode: 'target', fmt: 'plain', height: 240 })]),
      section('bar-grouped', [h(ChartBar, { title: '同比对比', labels: ['低温奶', '常温奶', '酸奶'], series: GRP, mode: 'grouped', fmt: 'plain', height: 220 })]),
      section('bar-stacked', [h(ChartBar, { title: '品类拆解', labels: ['1 周', '2 周', '3 周', '4 周'], series: STK, mode: 'stacked', fmt: 'plain', height: 220 })]),
      section('donut-many', [h(ChartDonut, { title: '品牌销售结构', items: DONUT_ITEMS, height: 240 })]),
      section('donut-empty', [h(ChartDonut, { title: '空结构', items: [], height: 240 })]),
      section('hbar-rank', [h(ChartHbar, { title: '客户销售排行', items: HBAR_ITEMS, total: 372000 })]),
      section('fig-loading', [h(ChartFigure, { title: '载入中的图', loading: true })]),
      section('fig-empty', [h(ChartFigure, { title: '没数据的图', empty: true, emptyText: '这段时间还没有数据' })]),
      section('fig-error', [h(ChartFigure, { title: '取数失败的图', error: '取数失败', errorTitle: '经营趋势没取到', onRetry: () => {} })]),
      md('md-line', MD_LINE),
      md('md-bar', MD_BAR),
      md('md-table', MD_TABLE),
      md('md-bad', MD_BAD),
    ])
  },
}

createApp(App).mount('#app')
// 探针要用到的纯函数（导出检测链路时复用**同一份**实现，不重写）
window.__v491 = { inlineSvg, resolveVar, ready: true }
`

/* ------------------------------------------------------------ 渲染台 HTML */
const HARNESS_HTML = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">
<title>v491 图表渲染台（临时）</title><link rel="icon" href="data:,"><style>
body{margin:0;padding:18px 22px;background:var(--bg,#f6f8fb);color:var(--t1,#0f172a);
  font:14px/1.6 -apple-system,"PingFang SC",sans-serif}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(560px,1fr));gap:18px;max-width:1440px}
.case{background:var(--surface,#fff);border:1px solid var(--border,#e2e8f0);border-radius:10px;padding:14px 16px}
.md-wrap{max-width:520px}
</style></head><body>
<div id="app"></div>
<script type="module" src="/v491-harness.js"></script></body></html>
`

/* ------------------------------------------------------------- 无头测量 */
const PROBE_CJS = `/* v491 图表探针：全部断言在页面内算，主进程只负责搬运。 */
const fs = require('fs'), path = require('path'), puppeteer = require('puppeteer-core')
const OUT = process.env.HG_OUT
const PORT = process.env.HG_PORT || '${PORT}'
const CHROME = process.env.AGENT_BROWSER_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const url = 'http://127.0.0.1:' + PORT + '/v491-harness.html'

;(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'],
    /* 🔴 protocolTimeout 默认 180s，且**盖过** waitForFunction 自己的 timeout。
       页面一旦 reload（vite 预构建完成时会整页重载），旧执行上下文被销毁 ⇒
       挂起的 CDP 调用要干等 3 分钟才报错。压低它，让失败快速暴露、可重试。 */
    protocolTimeout: 30000,
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1500, height: 1600, deviceScaleFactor: 2 })
  const errs = []
  const logs = []
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message))
  page.on('console', (m) => {
    logs.push(m.type() + ': ' + m.text())
    if (m.type() === 'error' && !/favicon/.test(m.text())) errs.push('console.error: ' + m.text())
  })
  page.on('requestfailed', (r) => errs.push('requestfailed: ' + r.url() + ' — ' + ((r.failure() || {}).errorText || '')))
  page.on('response', (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) errs.push('HTTP ' + r.status() + ': ' + r.url()) })
  let navs = 0
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) navs++ })

  /* 🔴 vite dev 的坑：首次请求会触发依赖预构建（optimizeDeps），完成时 **整页 reload**。
     若 reload 撞上等待，执行上下文被销毁 ⇒ 调用悬空。对策 = **可重试的加载循环**：
     失败一次就重来，重来时依赖已烤热、不再 reload。 */
  const loadAndWait = async (tries) => {
    for (let k = 0; k < tries; k++) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 })
      try {
        /* 🔴 必须显式 polling:'mutation' 或数字 —— 默认轮询走 requestAnimationFrame，
           无头环境帧可能不触发，条件明明满足也永远检查不到（表现为 3 分钟后
           protocolTimeout 报「Runtime.callFunctionOn timed out」，页面却零错误）。 */
        await page.waitForFunction('window.__v491 && window.__v491.ready === true', { timeout: 12000, polling: 200 })
        return true
      } catch (e) { await new Promise((r) => setTimeout(r, 1200)) }
    }
    return false
  }
  if (!(await loadAndWait(4))) {
    /* 诊断**不能用 evaluate**：页面若在反复 reload，evaluate 自己就会悬空
       （那样只会再报一次 protocolTimeout，把真正的报错盖掉）。只用事件收集。 */
    console.error('READY FAILED：渲染台一直没就绪')
    console.error('导航次数=' + navs + '（>4 说明页面在反复 reload）')
    console.error('页面错误：\\n' + (errs.length ? errs.join('\\n') : '（无）'))
    console.error('全部 console 日志：\\n' + (logs.length ? logs.slice(-30).join('\\n') : '（无）'))
    try {
      const dump = await Promise.race([
        page.evaluate(() => ({
          ready: typeof window.__v491,
          scripts: [...document.querySelectorAll('script')].map((s) => s.src || '(inline)'),
          appEmpty: !(document.getElementById('app') || {}).innerHTML,
        })),
        new Promise((_, rej) => setTimeout(() => rej(new Error('dump 超时 6s')), 6000)),
      ])
      console.error('页面现场：' + JSON.stringify(dump))
    } catch (e) { console.error('现场抓取失败：' + e.message) }
    await browser.close().catch(() => {})
    process.exit(3)
  }
  console.error('（导航次数 ' + navs + '；>1 说明触发了 vite 预构建 reload，已重试成功）')
  await new Promise((r) => setTimeout(r, 400))   // 等 ResizeObserver 量完宽

  const data = await page.evaluate(async () => {
    const q = (c, s) => { const el = document.querySelector('[data-case="' + c + '"]'); return el ? el.querySelectorAll(s) : [] }
    const bars = (c) => [...q(c, 'rect.ch-bar')].map((r) => ({
      h: +r.getAttribute('height'), w: +r.getAttribute('width'), x: +r.getAttribute('x'),
      fillAttr: r.getAttribute('fill'), fill: getComputedStyle(r).fill,
    }))
    const uniq = (a) => [...new Set(a)]
    const out = { cases: {}, light: {}, dark: {}, exportOk: false }

    /* —— 折线：两条线 + 断口（第 4 点为 null ⇒ 第 1 条 path 里应出现 2 段 M） —— */
    const lines = [...q('line-basic', 'path.ch-line')].map((p) => ({ d: p.getAttribute('d') || '', stroke: getComputedStyle(p).stroke }))
    out.cases.line = {
      pathCount: lines.length,
      segCounts: lines.map((l) => (l.d ? l.d.split('M').length - 1 : 0)),
      strokes: uniq(lines.map((l) => l.stroke)),
      dots: q('line-basic', 'circle.ch-dot').length,
      xLabels: q('line-basic', 'text.ch-ax-lb').length,
    }

    /* —— 柱状 single：7 根，含 1 个极小值（验证 MIN_TRACK_PX 下限） —— */
    const bs = bars('bar-single')
    out.cases.barSingle = {
      total: bs.length, visible: bs.filter((b) => b.h >= 1.5).length,
      heights: bs.map((b) => b.h), fills: uniq(bs.map((b) => b.fill)),
      refLines: q('bar-single', 'line.ch-ref').length,
    }

    /* —— 柱状 target：轨道 = fill 属性为 var(--chart-track) 的那批 —— */
    const bt = bars('bar-target')
    const tracks = bt.filter((b) => /chart-track/.test(b.fillAttr || ''))
    const fills = bt.filter((b) => !/chart-track/.test(b.fillAttr || ''))
    out.cases.barTarget = {
      total: bt.length,
      trackCount: tracks.length, trackVisible: tracks.filter((b) => b.h >= 1.5).length,
      trackHeights: tracks.map((b) => b.h), trackFills: uniq(tracks.map((b) => b.fill)),
      fillCount: fills.length, fillHeights: fills.map((b) => b.h), fillFills: uniq(fills.map((b) => b.fill)),
      fillXs: uniq(fills.map((b) => b.x)).length,
    }

    const bg = bars('bar-grouped')
    out.cases.barGrouped = { total: bg.length, visible: bg.filter((b) => b.h >= 1.5).length, fills: uniq(bg.map((b) => b.fill)) }
    const bst = bars('bar-stacked')
    out.cases.barStacked = { total: bst.length, visible: bst.filter((b) => b.h >= 1.5).length, fills: uniq(bst.map((b) => b.fill)) }

    /* —— 环形：8 类目应合成 6 片（前 5 + 其他） —— */
    const arcs = [...q('donut-many', 'circle.ch-arc')].map((c) => ({ stroke: getComputedStyle(c).stroke, dash: c.getAttribute('stroke-dasharray') }))
    out.cases.donut = {
      arcCount: arcs.length, strokes: uniq(arcs.map((a) => a.stroke)),
      hasDash: arcs.every((a) => !!a.dash && a.dash !== 'none'),
      legendText: [...q('donut-many', '.ch-donut-row')].map((r) => r.innerText.replace(/\\s+/g, ' ').trim()),
      otherMerged: /其他/.test((document.querySelector('[data-case="donut-many"]') || {}).innerText || ''),
    }
    const de = document.querySelector('[data-case="donut-empty"]')
    out.cases.donutEmpty = { stateText: de ? de.innerText.replace(/\\s+/g, ' ').trim().slice(0, 60) : '', arcs: q('donut-empty', 'circle.ch-arc').length }

    /* —— 横向排行：5 行 ⇒ 5 条，且长度递减 —— */
    const hb = [...q('hbar-rank', 'rect.ch-hb-bar')].map((r) => ({ w: +r.getAttribute('width'), fill: getComputedStyle(r).fill }))
    out.cases.hbar = { total: hb.length, widths: hb.map((b) => b.w), fills: uniq(hb.map((b) => b.fill)), tracks: q('hbar-rank', 'rect.ch-hb-track').length }

    /* —— ChartFigure 三态 —— */
    const txt = (c) => { const el = document.querySelector('[data-case="' + c + '"]'); return el ? el.innerText.replace(/\\s+/g, ' ').trim() : '' }
    out.cases.figStates = {
      loadingText: txt('fig-loading'), loadingSkel: q('fig-loading', '.ch-skel').length,
      emptyText: txt('fig-empty'),
      errorText: txt('fig-error'), errorBtn: q('fig-error', 'button.ch-retry').length,
    }

    /* —— md.js 出图（AI 消息内联图表） —— */
    const mdCard = (c) => document.querySelector('[data-case="' + c + '"]')
    const c1 = mdCard('md-line'), c2 = mdCard('md-bar'), c3 = mdCard('md-table'), c4 = mdCard('md-bad')
    out.cases.md = {
      lineSvg: c1 ? c1.querySelectorAll('svg.ch-md-svg').length : 0,
      linePolylines: c1 ? c1.querySelectorAll('polyline.ch-md-line').length : 0,
      lineTitle: c1 ? (c1.querySelector('.ch-md-ti') || {}).innerText : '',
      barBars: c2 ? c2.querySelectorAll('rect.ch-md-bar').length : 0,
      barTitle: c2 ? (c2.querySelector('.ch-md-ti') || {}).innerText : '',
      tableSegBtns: c3 ? [...c3.querySelectorAll('.ch-md-segbtn')].map((b) => b.getAttribute('data-form')) : [],
      tablePanes: c3 ? c3.querySelectorAll('.ch-md-pane').length : 0,
      tableHiddenDefault: c3 ? (c3.querySelector('.md-table-chart') || {}).hasAttribute?.('hidden') : null,
      tableHasToggle: c3 ? c3.querySelectorAll('.md-table-chart-toggle').length : 0,
      /* 非法 spec：不能出图，更不能把半截 JSON 漏出来 */
      badCard: c4 ? c4.querySelectorAll('.ch-md-card').length : 0,
      badLeak: c4 ? /this_is_not_json/.test(c4.innerText) : null,
      aspect: c1 ? (c1.querySelector('svg.ch-md-svg') || {}).getAttribute?.('preserveAspectRatio') : null,
    }

    /* —— CSS 变量解析（导出内联的基础）：已定义 / 带 fallback / 字面色 三种 —— */
    out.resolveVar = {
      cssVar: window.__v491.resolveVar('var(--chart-1)'),
      fallback: window.__v491.resolveVar('var(--nope-xyz-491, #123456)'),
      plain: window.__v491.resolveVar('#abcdef'),
    }

    /* —— 明暗两态：同一个 bar 的实际色必须不同（CSS 变量真的接上了） —— */
    const probeFill = () => {
      const r = document.querySelector('[data-case="bar-single"] rect.ch-bar')
      const d = document.querySelector('[data-case="bar-target"] rect.ch-bar')
      return { bar: r ? getComputedStyle(r).fill : '', track: d ? getComputedStyle(d).fill : '',
               bg: getComputedStyle(document.body).backgroundColor }
    }
    out.light = probeFill()
    const settle = () => new Promise((r) => setTimeout(r, 160))   // 不用 rAF：无头下可能不触发帧
    document.documentElement.classList.add('dark')
    await settle()
    out.dark = probeFill()
    document.documentElement.classList.remove('dark')
    await settle()

    /* —— 导出 PNG：走**同一份** inlineSvg，验证「CSS 变量已内联 ⇒ 不是黑块」 —— */
    try {
      const run = async () => {
      const svg = document.querySelector('[data-case="bar-target"] svg.ch-svg')
      const { node, width, height, scale } = window.__v491.inlineSvg(svg)   // 走产品默认背景令牌
      const xml = new XMLSerializer().serializeToString(node)
      const dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml)
      const img = new Image(); img.decoding = 'sync'
      const ok = await Promise.race([
        new Promise((res) => { img.onload = () => res(true); img.onerror = () => res(false); img.src = dataUrl }),
        new Promise((res) => setTimeout(() => res(false), 5000)),   // 解码兜底：绝不无限等
      ])
      if (ok) {
        const cv = document.createElement('canvas')
        cv.width = Math.round(width * scale); cv.height = Math.round(height * scale)
        const ctx = cv.getContext('2d')
        ctx.fillStyle = getComputedStyle(document.body).backgroundColor
        ctx.fillRect(0, 0, cv.width, cv.height)
        ctx.drawImage(img, 0, 0, cv.width, cv.height)
        const px = ctx.getImageData(0, 0, cv.width, cv.height).data
        const seen = new Set()
        for (let i = 0; i < px.length; i += 4 * 53) seen.add(px[i] + ',' + px[i + 1] + ',' + px[i + 2])
        out.exportOk = true
        out.exportPng = cv.toDataURL('image/png')
        out.export = { w: cv.width, h: cv.height, colorCount: seen.size, colors: [...seen].slice(0, 10),
                       xmlHasVar: /var\\(--/.test(xml), xmlLen: xml.length,
                       varCtx: (xml.match(/[^"]{0,60}var\\(--[^;"]{0,40}/g) || []).slice(0, 5) }
      } else { out.export = { err: 'img decode failed' } }
      }
      await Promise.race([run(), new Promise((_, rej) => setTimeout(() => rej(new Error('导出段整体超时 10s')), 10000))])
    } catch (e) { out.export = { err: String(e && e.message || e) } }

    return out
  })

  data.jsErrors = errs
  fs.mkdirSync(OUT, { recursive: true })
  if (data.exportPng) {
    fs.writeFileSync(path.join(OUT, 'export-target.png'), Buffer.from(data.exportPng.split(',')[1], 'base64'))
    delete data.exportPng
  }
  await page.screenshot({ path: path.join(OUT, 'full.png'), fullPage: true })
  fs.writeFileSync(path.join(OUT, 'measure.json'), JSON.stringify(data, null, 1))

  /* ---- 断言（成对：根数 + 可见根数） ---- */
  const A = []
  const ck = (name, cond, detail) => A.push({ name, pass: !!cond, detail })
  const c = data.cases
  ck('折线: 2 条线', c.line.pathCount === 2, 'path=' + c.line.pathCount)
  ck('折线: null 断口切段(2 段)', c.line.segCounts.every((s) => s === 2), JSON.stringify(c.line.segCounts))
  ck('折线: 折点 12（7×2 减 null 的 2 个）', c.line.dots === 12, 'dots=' + c.line.dots)
  ck('柱 single: 7 根', c.barSingle.total === 7, 'n=' + c.barSingle.total)
  ck('柱 single: 7 根可见(含极小值≥2px)', c.barSingle.visible === 7 && Math.min(...c.barSingle.heights) >= 2, JSON.stringify(c.barSingle.heights))
  ck('柱 single: 参考线 1 条', c.barSingle.refLines === 1, 'n=' + c.barSingle.refLines)
  ck('柱 target: 10 根轨道(后 2 月无目标不画)', c.barTarget.trackCount === 10, 'n=' + c.barTarget.trackCount)
  ck('柱 target: 10 根轨道全可见', c.barTarget.trackVisible === 10 && Math.min(...c.barTarget.trackHeights) >= 2, JSON.stringify(c.barTarget.trackHeights))
  ck('柱 target: 填充覆盖 9 个月(第 10 月达成 0 不画)', c.barTarget.fillXs === 9, 'xs=' + c.barTarget.fillXs)
  ck('柱 target: 段数 15（9 基准 + 6 超标月多出的深色段）', c.barTarget.fillCount === 15, 'n=' + c.barTarget.fillCount)
  ck('柱 target: 轨道色唯一(明确灰)', c.barTarget.trackFills.length === 1, JSON.stringify(c.barTarget.trackFills))
  ck('柱 target: 达成色非灰(没被一刀切)', c.barTarget.fillFills.length >= 1 && !/rgb\\(203, 213, 225\\)/.test(c.barTarget.fillFills.join()), JSON.stringify(c.barTarget.fillFills))
  ck('柱 grouped: 6 根全可见', c.barGrouped.total === 6 && c.barGrouped.visible === 6, JSON.stringify(c.barGrouped))
  ck('柱 stacked: 12 段全可见', c.barStacked.total === 12 && c.barStacked.visible === 12, JSON.stringify(c.barStacked))
  ck('环: 8 类目合 6 片', c.donut.arcCount === 6, 'n=' + c.donut.arcCount)
  ck('环: 弧段有 dasharray', c.donut.hasDash, '')
  ck('环: 尾部合并成「其他」', c.donut.otherMerged, JSON.stringify(c.donut.legendText))
  ck('环空态: 不画空环且有文案', c.donutEmpty.arcs === 0 && c.donutEmpty.stateText.length > 0, JSON.stringify(c.donutEmpty))
  ck('排行: 5 条 + 长度递减', c.hbar.total === 5 && c.hbar.widths.every((w, i, a) => i === 0 || w <= a[i - 1]), JSON.stringify(c.hbar.widths))
  ck('排行: 轨道 5 条', c.hbar.tracks === 5, 'n=' + c.hbar.tracks)
  ck('三态: 载入有骨架', c.figStates.loadingSkel > 0, 'skel=' + c.figStates.loadingSkel)
  ck('三态: 空态有文案', /还没有/.test(c.figStates.emptyText), JSON.stringify(c.figStates.emptyText))
  ck('三态: 错误态有重试按钮', c.figStates.errorBtn >= 1 && /重试/.test(c.figStates.errorText), JSON.stringify(c.figStates.errorText))
  ck('md: 折线出图', c.md.lineSvg === 1 && c.md.linePolylines === 1, JSON.stringify({ svg: c.md.lineSvg, pl: c.md.linePolylines }))
  ck('md: 柱状出图 3 根', c.md.barBars === 3, 'n=' + c.md.barBars)
  ck('md: 表格出图三形态', c.md.tableSegBtns.length === 3, JSON.stringify(c.md.tableSegBtns))
  ck('md: 表格图默认收起 + 有开关', c.md.tableHiddenDefault === true && c.md.tableHasToggle === 1, JSON.stringify({ h: c.md.tableHiddenDefault, t: c.md.tableHasToggle }))
  ck('md: 非法 spec 不出图且不漏 JSON', c.md.badCard === 0 && c.md.badLeak === false, JSON.stringify({ card: c.md.badCard, leak: c.md.badLeak }))
  ck('md: 出图等比缩放', c.md.aspect === 'xMidYMid meet', String(c.md.aspect))
  ck('主题: 明暗两态颜色不同', data.light.bar !== data.dark.bar && !!data.light.bar && !!data.dark.bar, JSON.stringify({ l: data.light, d: data.dark }))
  ck('导出: 生成了 PNG 且非单色块', data.exportOk && data.export && data.export.colorCount >= 6, JSON.stringify(data.export))
  ck('导出: 内联后 XML 不含 var(--', data.export && data.export.xmlHasVar === false, 'hasVar=' + (data.export && data.export.xmlHasVar) + ' ctx=' + JSON.stringify((data.export || {}).varCtx || []))
  ck('内联: 已定义变量解析成实际色值', /^(#|rgb)/.test(String(data.resolveVar.cssVar)) && !/var\\(/.test(String(data.resolveVar.cssVar)), String(data.resolveVar.cssVar))
  ck('内联: 变量未定义时取 fallback（不自留 var()）', data.resolveVar.fallback === '#123456', String(data.resolveVar.fallback))
  ck('内联: 字面色原样返回', data.resolveVar.plain === '#abcdef', String(data.resolveVar.plain))
  ck('零 JS 报错', errs.length === 0, errs.join(' | '))

  const bad = A.filter((a) => !a.pass)
  console.log('')
  A.forEach((a) => console.log((a.pass ? '  ✅ ' : '  ❌ ') + a.name + (a.detail ? '   [' + a.detail + ']' : '')))
  console.log('')
  console.log(bad.length ? '❌ ' + bad.length + '/' + A.length + ' 项未通过' : '✅ 全部 ' + A.length + ' 项通过')
  console.log('产物：' + OUT)
  await browser.close()
  process.exit(bad.length ? 1 : 0)
})().catch((e) => { console.error('PROBE FAILED:', e && e.stack || e); process.exit(2) })
`

/* ----------------------------------------------------------------- 命令 */
function gen() {
  fs.writeFileSync(F.html, HARNESS_HTML, 'utf8')
  fs.writeFileSync(F.js, HARNESS_JS, 'utf8')
  fs.writeFileSync(F.probe, PROBE_CJS, 'utf8')
  console.log('✅ 已生成渲染台：' + path.relative(ROOT, F.html) + ' / ' + path.relative(ROOT, F.js))
  console.log('   探针：' + path.relative(ROOT, F.probe) + '（临时文件，跑完即删）')
}

function clean() {
  for (const p of [F.html, F.js, F.probe]) {
    if (fs.existsSync(p)) { fs.unlinkSync(p); console.log('已删 ' + path.relative(ROOT, p)) }
  }
}

function startVite() {
  const env = { ...process.env, PATH: NODE_BIN + ':' + (process.env.PATH || '') }
  const srv = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: FE, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  srv.stdout.on('data', (d) => { log += d })
  srv.stderr.on('data', (d) => { log += d })
  srv._log = () => log
  return srv
}

function waitServer(tries = 60) {
  return new Promise((resolve, reject) => {
    const tick = (n) => {
      http.get({ host: '127.0.0.1', port: PORT, path: '/v491-harness.html', timeout: 1500 }, (res) => {
        res.resume(); resolve(true)
      }).on('error', () => (n <= 0 ? reject(new Error('vite 未在 ' + PORT + ' 起来')) : setTimeout(() => tick(n - 1), 500)))
    }
    tick(tries)
  })
}

function probe() {
  const env = {
    ...process.env,
    NODE_PATH: NODE_MODULES,
    HG_PROXY: '', http_proxy: '', https_proxy: '', HTTP_PROXY: '', HTTPS_PROXY: '',
    HG_PORT: String(PORT), HG_OUT: OUT,
  }
  const r = spawnSync(NODE, [F.probe], { cwd: ROOT, env, encoding: 'utf8' })
  process.stdout.write(r.stdout || '')
  if (r.stderr) process.stderr.write(r.stderr)
  return r.status === 0
}

const cmd = process.argv[2] || 'all'
if (cmd === 'gen') { gen(); process.exit(0) }
if (cmd === 'clean') { clean(); process.exit(0) }
if (cmd === 'probe') { process.exit(probe() ? 0 : 1) }

gen()
const srv = startVite()
let ok = false
try {
  await waitServer()
  ok = probe()
  if (!ok) console.error('---- vite 日志 ----\n' + srv._log().slice(-2500))
} catch (e) {
  console.error('❌ ' + e.message)
  console.error(srv._log().slice(-1200))
} finally {
  srv.kill('SIGTERM')
  spawnSync('pkill', ['-f', 'vite --port ' + PORT])
  clean()
}
process.exit(ok ? 0 : 1)
