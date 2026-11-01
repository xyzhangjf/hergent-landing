#!/usr/bin/env node
/* ============================================================================
   v720-table-freeze-scan.mjs — 全站表头冻结审计探针
   ----------------------------------------------------------------------------
   三种模式：
     --static  纯静态扫源码：列出每个 <table> 的祖先链 + 是否带 freeze-list
               （不需要登录态、不联网、秒出）
     --live    真机：逐页采表头位置 / 滚动容器 / 行数，并**内滚 400px 后复测**
               表头是否还钉在容器顶（这是"冻结是否真的生效"的唯一硬判据）
     --grow    真机：往可增行明细表注入 30 行，复测表头是否滚走（阳性对照）

   用法：
     node .workbuddy/tools/v720-table-freeze-scan.mjs --static
     HG_TOKEN=<boss token> node .workbuddy/tools/v720-table-freeze-scan.mjs --live
     HG_TOKEN=<boss token> node .workbuddy/tools/v720-table-freeze-scan.mjs --grow

   🔴 三条踩过的坑（别改回去）：
   1. 判"已冻结"不能只看 getComputedStyle(th).position === 'sticky'。
      sticky 的锚点是**最近的滚动容器**；容器若没限高（高度=内容高）、或某祖先
      overflow:hidden 且自己不滚，sticky 会静默失效 ⇒ 必须内滚后复测位置。
   2. 找滚动容器要同时认 overflow:hidden——它同样会成为 sticky 锚点
      （ProductTarget 的 .pt-card{overflow:hidden} 就是这样吃掉表头冻结的）。
   3. 页面无数据时表格 v-if="rows.length" 整块不渲染 ⇒ 真机扫出 0 个表是正常的，
      不是"页面没有表格"。空数据页只能按结构判定。
   ============================================================================ */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'fs'
import { join, relative, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const SRC = join(ROOT, 'hergent-cn-v2/src')

/* ─────────────────────────── --static ─────────────────────────── */

const VOID = new Set(['br', 'hr', 'img', 'input', 'col', 'meta', 'link', 'source', 'area', 'base', 'embed', 'param', 'track', 'wbr'])

function walkVue(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    const st = statSync(p)
    if (st.isDirectory()) walkVue(p, out)
    else if (f.endsWith('.vue')) out.push(p)
  }
  return out
}

/** 逐行扫描 <template> 段，维护标签栈，遇到 <table> 记录当时的 class 祖先链 */
function tablesIn(file) {
  const raw = readFileSync(file, 'utf8')
  const m = raw.match(/<template>([\s\S]*)<\/template>/)
  const body = m ? m[1] : raw
  const base = m ? raw.slice(0, m.index + '<template>'.length).split('\n').length : 1
  const stack = []
  const found = []
  const tagRe = /<(\/?)([a-zA-Z][\w-]*)([^<>]*)>/g
  body.split('\n').forEach((line, i) => {
    const ln = base + i
    let t
    tagRe.lastIndex = 0
    while ((t = tagRe.exec(line))) {
      const closing = t[1] === '/'
      const tag = t[2].toLowerCase()
      const attrs = t[3]
      if (closing) {
        for (let j = stack.length - 1; j >= 0; j--) {
          if (stack[j].tag === tag) { stack.length = j; break }
        }
        continue
      }
      const cm = attrs.match(/class\s*=\s*"([^"]*)"/)
      const cls = cm ? cm[1].trim() : ''
      if (tag === 'table') found.push({ line: ln, cls, chain: stack.filter(s => s.cls).map(s => s.cls) })
      if (!attrs.trimEnd().endsWith('/') && !VOID.has(tag)) stack.push({ tag, cls })
    }
  })
  return found
}

function runStatic() {
  const files = walkVue(SRC)
  const rows = []
  for (const f of files) for (const t of tablesIn(f)) rows.push({ file: relative(ROOT, f).split('\\').join('/'), ...t })
  const has = (r, w) => (r.chain.join(' ') + ' ' + r.cls).includes(w)
  const free = rows.filter(r => has(r, 'freeze-list'))
  const modal = rows.filter(r => !has(r, 'freeze-list') && /modal|mask|dlg|drawer/.test(r.chain.join(' ')))
  const rest = rows.filter(r => !free.includes(r) && !modal.includes(r))

  console.log(`扫描 ${files.length} 个 .vue，共 ${rows.length} 个 <table>`)
  console.log(`  freeze-list 机制 : ${free.length}`)
  console.log(`  弹窗 / 抽屉内     : ${modal.length}`)
  console.log(`  无任何冻结声明     : ${rest.length}`)
  console.log('\n=== 无冻结声明的表格（逐项核对清单用）===')
  for (const r of rest) {
    console.log(`${r.file}:${r.line}\t${r.cls || '(无class)'}\t${r.chain.slice(-2).join(' > ')}`)
  }
  const out = '/tmp/v720-table-freeze-static.json'
  writeFileSync(out, JSON.stringify(rows, null, 1))
  console.log(`\n原始结果 → ${out}`)
}

/* ─────────────────────────── --live / --grow ─────────────────────────── */

const PAGES = [
  ['工作台', '/workbench'], ['看板', '/dashboard'], ['本期预报', '/forecast'], ['返利', '/rebate'],
  ['亏损核算', '/loss-accounting'], ['工资', '/payroll'], ['数据填报', '/data-fill'], ['舟谱导入', '/zhoupu-import'],
  ['商品档案', '/archive/products'], ['客户档案', '/archive/customers'], ['品牌档案', '/archive/brands'],
  ['仓库档案', '/archive/warehouses'], ['供应商档案', '/archive/suppliers'], ['员工档案', '/archive/employees'],
  ['销售单', '/inventory/sale'], ['采购单', '/inventory/purchase'], ['调拨单', '/inventory/transfer'],
  ['库存', '/inventory/stock'], ['批次追溯', '/inventory/batch-trace'], ['审批中心', '/inventory/approvals'],
  ['采购建单', '/inventory/purchase/new'], ['销售建单', '/inventory/sale/new'], ['调拨建单', '/inventory/transfer/new'],
  ['报表设计器', '/reports/builder'], ['库存周转', '/reports/inventory-turnover'], ['促销ROI', '/reports/promo-roi'],
  ['采购汇总', '/reports/purchase'], ['调拨汇总', '/reports/transfer'], ['数据健康', '/reports/data-health'],
  ['开放接口', '/openapi/console'], ['促销', '/mkt/promotions'],
  ['入库', '/wh/inbound'], ['出库', '/wh/outbound'], ['盘点', '/wh/stocktake'], ['仓储策略', '/wh/strategy'],
  ['盘点差异', '/wh/stocktake-diff'], ['全盘', '/wh/stocktake-full'], ['损益', '/wh/pnl'], ['组合', '/wh/combo'],
  ['配送', '/wh/delivery'], ['线路', '/wh/route-setup'], ['拣货波次', '/wh/pick-wave'], ['库位', '/wh/location'],
  ['效期', '/wh/expiry-report'], ['车存', '/wh/vehicle-stock'], ['库存预警', '/wh/stock-alert'],
  ['收款单', '/funds/receipt'], ['资金余额', '/funds/balance'], ['资金流水', '/funds/flow'],
  ['银行对账', '/funds/reconcile'], ['往来对账', '/funds/party-reconcile'], ['成本查询', '/funds/cost-query'],
  ['员工欠款', '/funds/staff-debt'], ['客户对账', '/funds/customer-statement'],
  ['设置', '/settings'], ['价格渠道', '/prices'], ['定时任务', '/cron'], ['告警规则', '/alerts'], ['招标雷达', '/bid-radar'],
]

/* 采集：每张表的表头是否钉住。判据 = 容器内滚 400px 后，表头相对容器顶的 gap 不变 */
const PROBE = function () {
  const clsOf = el => { if (!el) return ''; const c = el.className; return typeof c === 'string' ? c : (c.baseVal || '') }
  const out = []
  for (const t of document.querySelectorAll('table')) {
    const r = t.getBoundingClientRect()
    if (r.width < 20) continue
    const th = t.tHead ? t.tHead.querySelector('th') : null
    const rows = [...t.tBodies].reduce((a, b) => a + b.rows.length, 0)
    /* 找 sticky 的锚点：最近的 overflow 非 visible 祖先（hidden 也算，它同样会吃掉 sticky） */
    let pane = null, m = t.parentElement
    while (m && m !== document.body) {
      const s = getComputedStyle(m)
      if (s.overflow !== 'visible') { pane = m; break }
      m = m.parentElement
    }
    const base = {
      cls: clsOf(t).trim() || '(无class)',
      rows, th: t.tHead ? t.tHead.querySelectorAll('th').length : 0,
      h: Math.round(r.height),
      thPos: th ? getComputedStyle(th).position : '-',
      pane: pane ? (clsOf(pane).trim() || pane.tagName.toLowerCase()) : '(window)',
      paneCanScroll: pane ? pane.scrollHeight > pane.clientHeight + 4 : document.documentElement.scrollHeight > innerHeight + 4,
      paneH: pane ? pane.clientHeight : innerHeight,
      paneSH: pane ? pane.scrollHeight : document.documentElement.scrollHeight,
      pinned: null,
    }
    if (th && pane && base.paneCanScroll) {
      /* 情况一：容器自己会滚 ⇒ 内滚 400px，看表头相对容器顶的 gap 是否不变 */
      const g0 = Math.round(th.getBoundingClientRect().top - pane.getBoundingClientRect().top)
      pane.scrollTop = 400
      const g1 = Math.round(th.getBoundingClientRect().top - pane.getBoundingClientRect().top)
      pane.scrollTop = 0
      base.pinned = Math.abs(g1 - g0) <= 2 && g1 >= -2
      base.gap = [g0, g1]
    } else if (th && base.h > innerHeight * 0.7) {
      /* 情况二：容器不滚（高度=内容高，典型是 table-wrap 没限高）⇒ 真实滚动发生在更外层。
         🔴 这里必须滚"实际的滚动者"，不能固定滚 window：本项目的滚动者常常是
            `.view-wrap`（Shell 的滚动区），window 根本滚不动 ⇒ window.scrollTo 无效
            ⇒ y0===y1 ⇒ 会被误判成"钉住了"（告警历史 50 行就是这么假阳性的）。 */
      let mover = null, q = t.parentElement
      while (q && q !== document.body) {
        const s = getComputedStyle(q)
        if (/(auto|scroll|hidden)/.test(s.overflow) && q.scrollHeight > q.clientHeight + 4) { mover = q; break }
        q = q.parentElement
      }
      const canWin = document.documentElement.scrollHeight > innerHeight + 4
      const scrollBy = n => { if (mover) mover.scrollTop = n; else if (canWin) window.scrollTo(0, n) }
      const y0 = Math.round(th.getBoundingClientRect().top)
      scrollBy(400)
      const y1 = Math.round(th.getBoundingClientRect().top)
      scrollBy(0)
      base.pinned = Math.abs(y0 - y1) <= 2
      base.windowMoved = y0 - y1
      base.mover = mover ? (clsOf(mover).trim() || mover.tagName.toLowerCase()) : (canWin ? '(window)' : '(滚不动)')
    } else if (th) {
      /* 情况三：表格本身装得下视口，冻不冻都看不见差别 ⇒ 不适用 */
      base.pinned = null
      base.note = '表格未超视口，冻结与否无感'
    }
    out.push(base)
  }
  return { n: out.length, vh: innerHeight, out }
}

const GROW = function () {
  const t = document.querySelector('table')
  if (!t || !t.tBodies[0]) return { err: 'no tbody' }
  const body = t.tBodies[0]
  const proto = body.rows[body.rows.length - 1]
  if (!proto) return { err: 'no row' }
  for (let i = 0; i < 30; i++) {
    const c = proto.cloneNode(true)
    c.querySelectorAll('input').forEach(el => { el.value = '' })
    body.appendChild(c)
  }
  return { rows: body.rows.length }
}

async function runLive(mode) {
  const TOKEN = process.env.HG_TOKEN
  if (!TOKEN) { console.error('缺 HG_TOKEN'); process.exit(1) }
  const { launch } = await import('./lib/cdp-lite.mjs')
  const b = await launch({ headless: true })
  const page = await b.newPage(); await page.enable()
  await page.raw.send('Network.enable')
  await page.raw.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await page.goto('https://hergent.cn/login', 2200)
  for (const c of [
    { name: 'erp_token', value: TOKEN, httpOnly: true },
    { name: 'hergent_auth', value: '1' },
    { name: 'csrf_token', value: 'x' },
    { name: 'hergent_tenant', value: '1' },
  ]) await page.raw.send('Network.setCookie', { ...c, domain: 'hergent.cn', path: '/', secure: true, sameSite: 'Lax' })

  const all = []
  for (const [name, path] of PAGES) {
    await page.goto('https://hergent.cn/#' + path, 3000)
    if (mode === 'grow') {
      let g; try { g = await page.eval(`(${GROW.toString()})()`) } catch (e) { g = { err: String(e) } }
      await new Promise(r => setTimeout(r, 400))
      let r; try { r = await page.eval(`(${PROBE.toString()})()`) } catch (e) { r = { err: String(e) } }
      console.log(`· ${name.padEnd(7)} 加行=${JSON.stringify(g)} 表=${r.n ?? '-'}`)
      for (const t of (r.out || [])) console.log(`    ${JSON.stringify(t)}`)
      all.push({ name, path, grow: g, ...r })
      continue
    }
    let r; try { r = await page.eval(`(${PROBE.toString()})()`) } catch (e) { r = { err: String(e) } }
    console.log(`· ${name.padEnd(7)} ${String(path).padEnd(26)} 表=${r.n ?? '-'}`)
    for (const t of (r.out || [])) {
      const mark = t.pinned === true ? '✅钉住' : t.pinned === false ? '🔴滚走' : '—'
      console.log(`    ${mark} ${t.cls.padEnd(22)} rows=${String(t.rows).padEnd(4)} ${t.thPos.padEnd(7)} 容器=${String(t.pane).padEnd(20)} ${t.paneH}/${t.paneSH}${t.windowMoved ? ' winMove=' + t.windowMoved : ''}`)
    }
    all.push({ name, path, ...r })
  }
  writeFileSync('/tmp/tbl-live.json', JSON.stringify(all, null, 1))
  console.log('\n原始结果 → /tmp/tbl-live.json')
  await b.close()
}

/* ─────────────────────────── main ─────────────────────────── */
const arg = process.argv[2] || '--static'
if (arg === '--static') runStatic()
else if (arg === '--live' || arg === '--grow') await runLive(arg.slice(2))
else { console.error('用法: --static | --live | --grow'); process.exit(1) }
