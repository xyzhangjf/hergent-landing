// 轻量 Markdown 渲染（自托管，无外部 CDN；先转义 HTML 防 XSS）
// 支持：标题 #/##/###、粗体 **、斜体 *、行内代码 `、无序列表 -/*、有序列表 1.、
//       表格 |、引用 >、分割线 ---、围栏代码块 ```，其余按段落 + 换行渲染。
// 用法：v-html="renderMd(text)" —— 仅用于可信来源（AI 回复/已抽离 card 围栏的 content）。
import { stripAllFences } from '../composables/useCardTrigger'
/* v491：消息内图表的**几何与数字格式**统一从通用图表层取，本文件不自己算量程/刻度/弧段。
   ⚠️ 只引纯函数（不含 `resolveVar`/`inlineSvg` 那两个会碰 DOM 的），故本模块仍是纯字符串渲染。 */
import { seriesColor } from '../components/chart/chartTheme'
import {
  money, moneyParts, pct, compact, axisNum, moneyUnit, niceMax, niceMin, tickValues,
} from '../components/chart/chartFmt'
import {
  plotBox, lineGeometry, polyline, barLayout, hOf, donutArcs, MIN_TRACK_PX,
} from '../components/chart/chartGeom'

/* ---------------------------------------------------------------------------
   v301（2026-09-28）副驾产出的文件标记 `MEDIA:<绝对路径>` → 文件卡
   🔴 为什么 Web 端会看到一串裸路径（生产实测）：
      副驾要发文件时会在回复末尾写 `MEDIA:/opt/hermes-tenants/.../xx.docx`。
      · 企微渠道：Hermes 的 `gateway/platforms/weixin.py::send_message` 先
        `extract_media()` 把标记**摘出正文**，再 `send_document()` 真上传
        ⇒ 客户端拿到真附件，正文里没有路径。
      · Web 副驾：走 `gateway/platforms/api_server.py`（OpenAI 兼容 SSE），其
        `_resolve_media_to_data_urls()` **只认图片**（非图片 `return None` 原样退回），
        且该渠道**没有任何文件下载路由** ⇒ 路径字符串直达气泡，无法下载/打开。
    ⇒ 这里把标记识别出来（交给 CopilotDrawer 渲染成可下载的文件卡），
      并从展示文本里剥掉（否则会同一行既显示路径又显示卡片）。
   ⚠️ 判据刻意与 Hermes 的 `MEDIA_TAG_CLEANUP_RE` **对齐**：锚定「绝对路径 + 已知扩展名」，
      这样正文里仅仅是"提到 MEDIA:"的句子不会被误伤（Hermes 那边同理）。
--------------------------------------------------------------------------- */
const MEDIA_ABS = String.raw`(?:\/|~\/|[A-Za-z]:[/\\])`
const MEDIA_EXT = 'docx?|xlsx?|pptx?|pdf|md|markdown|txt|csv|json|zip|' +
  'png|jpe?g|gif|webp|bmp|svg|mp4|mov|mp3|wav|ogg'
// 可选引号/反引号包裹；路径不含空白与引号；扩展名大小写不敏感
const MEDIA_TAG_RE = new RegExp(
  'MEDIA:\\s*([`"\']?)(' + MEDIA_ABS + '[^\\s`"\']+?\\.(?:' + MEDIA_EXT + '))\\1', 'gi')
// 流式半截：路径还没写完（尚无扩展名）时先把尾巴收掉，避免气泡里闪过半截路径。
// 允许尾部空白 —— 绝大多数回复末尾是一个换行，不放过它就等于这条规则不生效。
const MEDIA_OPEN_RE = new RegExp('MEDIA:\\s*[`"\']?' + MEDIA_ABS + '[^\\s]*\\s*$', 'i')

/**
 * 把文本拆成「展示文本 + 附件列表」。
 * @param {string} text AI 回复原文
 * @returns {{text: string, files: Array<{path: string, name: string}>}}
 */
export function splitMedia(text) {
  const t = String(text || '')
  const files = []
  if (t.indexOf('MEDIA:') < 0) return { text: t, files }
  let out = t.replace(MEDIA_TAG_RE, (_full, _q, path) => {
    const name = String(path).split(/[\\/]/).pop() || '文件'
    // 去重：同一条回复里同一个文件被标两次只出一张卡
    if (!files.some((f) => f.path === path)) files.push({ path, name })
    return ''
  })
  out = out.replace(MEDIA_OPEN_RE, '')
  if (files.length) out = out.replace(/\n{3,}/g, '\n\n')   // 摘掉整行后别留一堆空行
  return { text: out, files }
}

export function renderMd(src) {
  if (!src) return ''
  // 0) 最后一道闸：协议围栏（```card / ```cards / ```clarify / ```proposal / ```reminder）
  //    绝不允许出现在老板眼前——含历史会话里已残留的、以及模型漏打/写错语言标签的卡片 JSON。
  const body = stripAllFences(src)

  // 1) 抽取围栏代码块（保留语言标签），避免被后续行内/块规则破坏
  //    v491：语言标签放宽到含 `:` / `-`，用于 ```chart / ```chart:bar 这类**出图**围栏；
  //    出图围栏不进 codes（它不是代码，不给复制按钮），改走 charts 占位 ` H{n} `。
  const codes = []
  const charts = []
  const text = body.replace(/```([a-zA-Z0-9:_-]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const L = (lang || '').trim().toLowerCase()
    if (L === 'chart' || L.indexOf('chart:') === 0 || L.indexOf('图表') === 0) {
      const idx = charts.length
      charts.push({ raw: code.replace(/\n$/, ''), type: L.indexOf(':') >= 0 ? L.split(':')[1] : '' })
      return ` H${idx} `
    }
    const idx = codes.length
    codes.push({ lang: (lang || '').trim(), code: code.replace(/\n$/, '') })
    return ` C${idx} `
  })

  const esc = (s) => s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // v486 P1-②：代码块原文要塞进 HTML **属性**（data-code）供复制按钮读取，
  // 光有 esc() 不够 —— 引号不转义会截断属性、破坏结构。故另加属性级转义。
  const escAttr = (s) => esc(s)
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

  const lines = text.split(/\r?\n/)
  const out = []
  const toc = []
  // 标题 slug（用于 TOC 锚点 id；兼容中文）
  const slugOf = (s) => {
    let base = String(s).trim().toLowerCase()
      .replace(/[`*_~]/g, '')
      .replace(/\s+/g, '-')
      .replace(/[^\w一-龥-]/g, '')
    return base || 'h'
  }

  // v487 P2-③：表格→迷你折线图。数值列（≥2 个数值单元格、且表头非数字）≥2 且数据行≥3 时，
  // 在表格右上角加「看图表」开关（点击由 CopilotDrawer 事件委托切换）。图表内联 SVG，
  // 视觉对齐 ResultCard 的 var(--p-dark) 折线风格，零新依赖、零新接口。
  //
  // ---------------------------------------------------------------------------
  // v491：升级为**三种形态 + 自主选型**（原来只有折线一种）
  // ---------------------------------------------------------------------------
  // 为什么要升级：折线天然表达"随时间变化"。把"类别对比"或"占比结构"也连成折线，
  // 读者会顺着线读出"趋势"，而数据里根本没有趋势 —— 这是**看错**，不是不好看。
  //
  // 形态优先级：
  //   ① AI 显式指定（```chart:bar 围栏）—— 最权威；
  //   ② 按数据形状推断：数值列 ≥2 ⇒ 走势；数值列 =1 且行数 ≤8 ⇒ 占比；否则 ⇒ 对比；
  //   ③ 都不适合就不画（宁可不画，也别画错）。
  //
  // 🔴 几何与数字格式**不是这里写的**：量程、刻度、柱位、弧段、单位换算全部来自
  //    `components/chart/`（页面上的 Vue 图表用的是同一套纯函数）。本文件只负责把算好的
  //    几何**拼成字符串** —— 消息走 v-html，若改成挂载 Vue 组件就等于把整条消息流渲染
  //    改成命令式挂载，风险与收益不成比例。
  const isNumCell = (v) => /^-?\d[\d,]*(\.\d+)?%?$/.test(String(v == null ? '' : v).trim())
  const toNum = (v) => {
    const s = String(v == null ? '' : v).trim().replace(/[,%]/g, '')
    const x = parseFloat(s)
    return isFinite(x) ? x : 0
  }
  /** 表头推断口径：金额类走 ¥/万换算，其余按普通数字（刻度不换算"件/箱"这类无共识单位） */
  const MONEY_HINT = /(金额|销售额|毛利|利润|收入|支出|回款|成本|价格|价|元|费用|返利)/
  const inferFmt = (head, cols) => (cols.some((c) => MONEY_HINT.test(String(head[c] || ''))) ? 'money' : 'plain')

  const MC = { W: 480, LINE_H: 200, BAR_H: 200, DONUT_H: 156, PAD: { l: 56, r: 16, t: 20, b: 26 } }
  const fmtVal = (v, fmt) => {
    if (fmt === 'money') return money(v)
    return Number(v).toLocaleString('zh-CN', { maximumFractionDigits: 0 })
  }
  const fmtShort = (v, fmt) => {
    if (fmt === 'money') { const p = moneyParts(v); return p.v === '—' ? '' : p.v + p.unit }
    return compact(v)
  }
  const mcSvg = (inner, W, H) =>
    `<svg class="ch-md-svg" viewBox="0 0 ${W} ${H}" role="img" preserveAspectRatio="xMidYMid meet">${inner}</svg>`
  const legendHtml = (names, colors) =>
    '<div class="ch-md-legend">' + names.map((nm, i) =>
      `<span class="ch-md-lg"><i style="background:${colors[i] || seriesColor(i)}"></i>${esc(nm)}</span>`).join('') + '</div>'

  /** 走势（折线） */
  function mcLine(labels, seriesList, fmt) {
    const W = MC.W; const H = MC.LINE_H; const PAD = MC.PAD
    const box = plotBox({ W, H, pad: PAD })
    const all = []
    seriesList.forEach((s) => s.data.forEach((v) => { if (v != null) all.push(v) }))
    const yMax = niceMax(Math.max(0, ...all, 1))
    const yMin = 0
    const geo = lineGeometry({ plotW: box.plotW, plotH: box.plotH, base: box.base, padL: PAD.l, padT: PAD.t, count: labels.length })
    const unit = fmt === 'money' ? moneyUnit(yMax) : ''
    let inner = ''
    tickValues(yMin, yMax, 4).forEach((v) => {
      const y = geo.yAt(v, yMin, yMax)
      inner += `<line class="ch-md-grid" x1="${PAD.l}" x2="${W - PAD.r}" y1="${y}" y2="${y}"/>`
      inner += `<text class="ch-md-ax" x="${PAD.l - 6}" y="${y + 4}" text-anchor="end">${esc(axisNum(v, unit))}</text>`
    })
    if (unit) inner += `<text class="ch-md-ax" x="${PAD.l - 6}" y="${PAD.t - 7}" text-anchor="end">${esc(unit)}元</text>`
    seriesList.forEach((s, si) => {
      const pts = []
      s.data.forEach((v, i) => { if (v != null) pts.push({ x: geo.xAt(i), y: geo.yAt(v, yMin, yMax) }) })
      if (pts.length < 2) return
      const col = seriesColor(si)
      inner += `<polyline class="ch-md-line" points="${polyline(pts)}" stroke="${col}"/>`
      pts.forEach((p) => { inner += `<circle cx="${Math.round(p.x * 100) / 100}" cy="${Math.round(p.y * 100) / 100}" r="2.4" fill="${col}"/>` })
    })
    const N = labels.length
    const step = N <= 12 ? 1 : Math.ceil(N / 8)
    labels.forEach((t, i) => {
      if (i % step !== 0 && i !== N - 1) return
      inner += `<text class="ch-md-ax" x="${Math.round(geo.xAt(i))}" y="${H - PAD.b + 15}" text-anchor="middle">${esc(t)}</text>`
    })
    inner += `<line class="ch-md-axis" x1="${PAD.l}" x2="${W - PAD.r}" y1="${box.base}" y2="${box.base}"/>`
    return { svg: mcSvg(inner, W, H), colors: seriesList.map((_, i) => seriesColor(i)), names: seriesList.map((s) => s.name) }
  }

  /** 对比（柱状，多系列分组） */
  function mcBar(labels, seriesList, fmt) {
    const W = MC.W; const H = MC.BAR_H; const PAD = MC.PAD
    const box = plotBox({ W, H, pad: PAD })
    const all = []
    seriesList.forEach((s) => s.data.forEach((v) => { if (v != null) all.push(v) }))
    const yMin = Math.min(0, ...all)
    const yMax = niceMax(Math.max(0, ...all, 1))
    const yMinV = yMin < 0 ? niceMin(yMin) : 0
    const lay = barLayout({ plotW: box.plotW, padL: PAD.l, count: labels.length })
    const unit = fmt === 'money' ? moneyUnit(yMax) : ''
    const yOf = (v) => box.base - hOf(v, yMinV, yMax, box.plotH)
    let inner = ''
    tickValues(yMinV, yMax, 4).forEach((v) => {
      const y = yOf(v)
      inner += `<line class="ch-md-grid" x1="${PAD.l}" x2="${W - PAD.r}" y1="${y}" y2="${y}"/>`
      inner += `<text class="ch-md-ax" x="${PAD.l - 6}" y="${y + 4}" text-anchor="end">${esc(axisNum(v, unit))}</text>`
    })
    if (unit) inner += `<text class="ch-md-ax" x="${PAD.l - 6}" y="${PAD.t - 7}" text-anchor="end">${esc(unit)}元</text>`
    const cnt = seriesList.length
    labels.forEach((_, i) => {
      seriesList.forEach((s, si) => {
        const v = s.data[i]
        if (v == null) return
        const g = cnt > 1 ? lay.xInGroup(i, si, cnt) : { x: lay.xBar(i), w: lay.bw }
        const y = yOf(v)
        const h = Math.max(Math.abs(box.base - y), MIN_TRACK_PX)
        inner += `<rect class="ch-md-bar" x="${Math.round(g.x * 100) / 100}" y="${v >= 0 ? y : box.base}" width="${Math.round(g.w * 100) / 100}" height="${Math.round(h * 100) / 100}" fill="${seriesColor(si)}" rx="1.5"/>`
        if (cnt === 1 && labels.length <= 8) {
          inner += `<text class="ch-md-lbl" x="${g.x + g.w / 2}" y="${y - 5}" text-anchor="middle">${esc(fmtShort(v, fmt))}</text>`
        }
      })
    })
    const N = labels.length
    const step = N <= 12 ? 1 : Math.ceil(N / 8)
    labels.forEach((t, i) => {
      if (i % step !== 0 && i !== N - 1) return
      inner += `<text class="ch-md-ax" x="${Math.round(PAD.l + lay.slot * (i + 0.5))}" y="${H - PAD.b + 15}" text-anchor="middle">${esc(t)}</text>`
    })
    inner += `<line class="ch-md-axis" x1="${PAD.l}" x2="${W - PAD.r}" y1="${box.base}" y2="${box.base}"/>`
    return { svg: mcSvg(inner, W, H), colors: seriesList.map((_, i) => seriesColor(i)), names: seriesList.map((s) => s.name) }
  }

  /** 占比（环形）——「其他」档由 chartGeom 之外的这里合并：小切片不合并会变成一堆碎屑 */
  function mcDonut(items, fmt) {
    const W = MC.W; const H = MC.DONUT_H
    const MAXS = 6
    let list = items.filter((it) => it.value > 0).sort((a, b) => b.value - a.value)
    if (list.length > MAXS) {
      const head = list.slice(0, MAXS - 1)
      const tail = list.slice(MAXS - 1)
      head.push({ label: `其他 ${tail.length} 项`, value: tail.reduce((s, it) => s + it.value, 0) })
      list = head
    }
    const cx = H / 2 + 4
    const cy = H / 2
    const r = H / 2 - 8
    const th = Math.max(16, r * 0.42)
    const { arcs, total } = donutArcs(list, { cx, cy, r, thickness: th, gapDeg: 1.4 })
    if (!total) return null
    let inner = `<circle class="ch-md-track" cx="${cx}" cy="${cy}" r="${Math.round((r - th / 2) * 100) / 100}" fill="none" stroke="var(--border-subtle)" stroke-width="${Math.round(th * 100) / 100}"/>`
    arcs.forEach((a) => {
      if (!a.path) return
      inner += `<path d="${a.path}" fill="${seriesColor(a.i)}"/>`
    })
    inner += `<text class="ch-md-cv" x="${cx}" y="${cy + 5}" text-anchor="middle">${esc(fmtShort(total, fmt))}</text>`
    // 图例即明细（名称 + 数值 + 占比）
    let lg = '<div class="ch-md-dl">'
    arcs.forEach((a) => {
      if (!a.value) return
      lg += `<div class="ch-md-drow"><i style="background:${seriesColor(a.i)}"></i>` +
        `<span class="ch-md-dn" title="${esc(a.label)}">${esc(a.label)}</span>` +
        `<span class="ch-md-dv">${esc(fmtVal(a.value, fmt))}</span>` +
        `<span class="ch-md-dp">${esc(pct(a.pct))}</span></div>`
    })
    lg += '</div>'
    return {
      html: `<div class="ch-md-donut">${mcSvg(inner, W, H)}${lg}</div>`,
      colors: arcs.map((a) => seriesColor(a.i)),
      names: arcs.map((a) => a.label),
    }
  }

  /** 表格 → 图表盒（多形态 + 分段切换）。返回 '' = 不适合画 */
  const buildTableChart = (head, rows) => {
    const numIdx = []
    for (let c = 0; c < head.length; c++) {
      if (isNumCell(head[c])) continue            // 表头本身是数字（如年份列）不算数值列
      let cnt = 0
      for (const r of rows) if (isNumCell(r[c])) cnt++
      if (cnt >= 2) numIdx.push(c)
    }
    if (!numIdx.length || rows.length < 3) return ''
    // 标签列 = 第一个非数值列（没有就用行号）
    const labelCol = head.findIndex((_, c) => !numIdx.includes(c))
    const labels = rows.map((r, i) => (labelCol >= 0 ? String(r[labelCol] == null ? '' : r[labelCol]) : String(i + 1)))
    const fmt = inferFmt(head, numIdx)
    const seriesList = numIdx.map((c) => ({ name: String(head[c] || ''), data: rows.map((r) => toNum(r[c])) }))

    const panes = []
    const lineRes = mcLine(labels, seriesList, fmt)
    panes.push({ form: '走势', key: 'line', svg: lineRes.svg })
    if (numIdx.length <= 3 && rows.length <= 16) {
      const barRes = mcBar(labels, seriesList, fmt)
      panes.push({ form: '对比', key: 'bar', svg: barRes.svg })
    }
    if (numIdx.length === 1 && rows.length <= 8 && rows.every((r) => toNum(r[numIdx[0]]) > 0)) {
      const dn = mcDonut(rows.map((r, i) => ({ label: labels[i], value: toNum(r[numIdx[0]]) })), fmt)
      if (dn) panes.push({ form: '占比', key: 'donut', svg: dn.html })
    }
    if (!panes.length) return ''

    const first = panes[0]
    const useLegend = first.key !== 'donut'
    const bar = panes.length > 1
      ? '<div class="ch-md-seg">' + panes.map((p, i) =>
        `<button type="button" class="ch-md-segbtn${i === 0 ? ' on' : ''}" data-form="${p.key}">${p.form}</button>`).join('') + '</div>'
      : ''
    const body = panes.map((p, i) =>
      `<div class="ch-md-pane" data-form="${p.key}"${i === 0 ? '' : ' hidden'}>${p.svg}</div>`).join('')
    const lg = useLegend ? legendHtml(lineRes.names, lineRes.colors) : ''
    return `<div class="md-table-chart" hidden>${bar}${body}${lg}</div>`
  }

  /** ```chart 围栏：AI 显式出图。spec 是 JSON（也容忍被人手写成单引号） */
  function renderChartSpec(raw, forcedType) {
    let spec = null
    try { spec = JSON.parse(raw) } catch (e) { spec = null }
    if (!spec || typeof spec !== 'object') return ''
    const type = String(spec.type || forcedType || '').toLowerCase()
    const fmt = spec.fmt === 'money' ? 'money' : spec.fmt === 'plain' ? 'plain' : 'money'
    const title = spec.title ? `<div class="ch-md-ti">${esc(String(spec.title))}</div>` : ''
    let body = ''
    let lg = ''
    if (type === 'donut' || type === 'pie' || Array.isArray(spec.items)) {
      const dn = mcDonut((spec.items || []).map((it) => ({ label: String(it.label == null ? '' : it.label), value: toNum(it.value) })), fmt)
      if (!dn) return ''
      body = dn.html
    } else {
      const labels = (spec.labels || []).map((x) => String(x))
      const seriesList = (spec.series || []).map((s) => ({
        name: String(s.name == null ? '数值' : s.name),
        data: (s.data || []).map((v) => (v === null || v === '' || v === undefined ? null : toNum(v))),
      })).filter((s) => s.data.length)
      if (!labels.length || !seriesList.length) return ''
      if (type === 'line' || type === '折线' || type === '走势') {
        const r = mcLine(labels, seriesList, fmt)
        body = r.svg; lg = legendHtml(r.names, r.colors)
      } else {
        const r = mcBar(labels, seriesList, fmt)
        body = r.svg; lg = legendHtml(r.names, r.colors)
      }
    }
    return `<div class="ch-md-card">${title}${body}${lg}</div>`
  }

  let i = 0
  let para = []

  const flushPara = () => {
    if (!para.length) return
    out.push('<p>' + para.map((l) => esc(l)).join('<br>') + '</p>')
    para = []
  }

  while (i < lines.length) {
    const line = lines[i]

    // 代码块占位（独占一行）
    // v491：出图围栏占位（独占一行）。spec 解析失败 ⇒ 什么都不输出
    // （**刻意不显示半截 JSON**：那是把实现细节漏到老板眼前）。
    // 🔴 这个分支**必须** `i++`：主循环靠 `i` 前进，只写 `continue` 就是无限循环 ——
    //    而且它是**静默**的（不抛错、不报错，只是把主线程占死：页面看着"加载完了"，
    //    实际任何脚本调用都再无响应）。实测踩过，见 v491 探针。
    const chm = line.match(/^ H(\d+) $/)
    if (chm) {
      flushPara()
      const h = charts[+chm[1]]
      const html = h ? renderChartSpec(h.raw, h.type) : ''
      if (html) out.push(html)
      i++; continue
    }

    const cm = line.match(/^ C(\d+) $/)
    if (cm) {
      flushPara()
      const c = codes[+cm[1]]
      const lang = (c.lang || '').toUpperCase()
      const lineEls = c.code.split('\n').map((ln, n) =>
        `<span class="md-ln"><span class="md-ln-no">${n + 1}</span><span class="md-ln-tx">${esc(ln)}</span></span>`
      ).join('')
      out.push(
        '<div class="md-codeblock">' +
        // v486 P1-②：顶栏加「一键复制」。原文走 data-code 属性（escAttr 转义），
        // 点击由 CopilotDrawer 的 .md 事件委托统一处理（与 TOC 跳转同一入口）。
        '<div class="md-codeblock__bar"><span class="md-codeblock__lang">' + (lang || 'CODE') + '</span>' +
        '<button type="button" class="md-code-copy" data-code="' + escAttr(c.code) + '" title="复制这段内容">' +
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>' +
        '<span class="md-code-copy-tx">复制</span></button></div>' +
        '<pre class="md-pre"><code class="md-code">' + lineEls + '</code></pre>' +
        '</div>'
      )
      i++; continue
    }

    // 空行：段落分隔
    if (/^\s*$/.test(line)) { flushPara(); i++; continue }

    // 标题
    const hm = line.match(/^(#{1,3})\s+(.*)$/)
    if (hm) {
      flushPara()
      const lv = hm[1].length
      const txt = hm[2].trim()
      const disp = txt.replace(/[`*_~]/g, '')
      let base = slugOf(txt)
      let id = 'md-' + base
      let k = 2
      while (toc.some((t) => t.id === id)) { id = 'md-' + base + '-' + k; k++ }
      toc.push({ lv, text: disp, id })
      out.push(`<h${lv} id="${id}" class="md-h md-h${lv}">${esc(txt)}</h${lv}>`)
      i++; continue
    }

    // 分割线
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) { flushPara(); out.push('<hr class="md-hr">'); i++; continue }

    // 引用
    if (/^\s*>\s?/.test(line)) {
      flushPara()
      const quote = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { quote.push(lines[i].replace(/^\s*>\s?/, '')); i++ }
      const raw = quote.join('\n').trim()
      let cls = 'md-quote md-quote--ai'
      let tag = ''
      const keyM = raw.match(/^\s*(?:\*{1,2})?(结论|重点|注意|提醒|关键|建议)(?:\*{1,2})?\s*[:：]/)
      if (keyM) {
        cls = 'md-quote md-quote--key'; tag = keyM[1]
        // 去掉正文里重复的「**结论**：」前缀，避免和徽标重复
        quote[0] = quote[0].replace(/^\s*(?:\*{1,2})?(?:结论|重点|注意|提醒|关键|建议)(?:\*{1,2})?\s*[:：]\s*/, '')
      } else if (/(来源[:：]|引自|——\s*$)/.test(raw)) {
        cls = 'md-quote md-quote--src'
      }
      const tagHtml = tag ? `<span class="md-quote__tag">${esc(tag)}</span>` : ''
      out.push(`<blockquote class="${cls}">${tagHtml}` + quote.map((l) => esc(l)).join('<br>') + '</blockquote>')
      continue
    }

    // 表格：当前行含 | 且下一行是分隔行
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:-]*-[\s:-]*\|/.test(lines[i + 1])) {
      flushPara()
      const parseRow = (r) => r.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim())
      const head = parseRow(line)
      i += 2
      const rows = []
      while (i < lines.length && lines[i].includes('|') && !/^\s*$/.test(lines[i])) { rows.push(parseRow(lines[i])); i++ }
      const chart = buildTableChart(head, rows)
      let t = '<div class="md-table-wrap">'
      if (chart) {
        // v491：按钮图标由彩色 emoji 换成线性 SVG（全站图标规范：装饰性 emoji 一律换成
        // 与文字同色的线条图标；消息区在 v-html 里，用不了 <Icon> 组件，故内联同一套路径）。
        // ⚠️ 文字必须包在 `-tx` 里：切换时只改这一个 span 的文案，
        //    若像 v487 那样直接写 `tog.textContent` 会把里面的图标一起抹掉。
        t += '<div class="md-table-bar"><button type="button" class="md-table-chart-toggle" title="在表格和图表之间切换">' +
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>' +
          '<span class="md-table-chart-toggle-tx">看图表</span></button></div>' + chart
      }
      t += '<table class="md-table"><thead><tr>' + head.map((c) => `<th>${esc(c)}</th>`).join('') + '</tr></thead><tbody>'
      t += rows.map((r) => '<tr>' + r.map((c) => `<td>${esc(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table></div>'
      out.push(t)
      continue
    }

    // 列表（有序/无序）
    const ulm = line.match(/^\s*[-*]\s+(.*)$/)
    const olm = line.match(/^\s*\d+\.\s+(.*)$/)
    if (ulm || olm) {
      flushPara()
      const type = olm ? 'ol' : 'ul'
      const buf = []
      while (i < lines.length) {
        const m = lines[i].match(/^\s*([-*]|\d+\.)\s+(.*)$/)
        if (!m) break
        const isOl = /^\d+\./.test(m[1])
        if ((isOl && type !== 'ol') || (!isOl && type !== 'ul')) break
        buf.push(m[2]); i++
      }
      out.push(`<${type}>` + buf.map((l) => `<li>${esc(l)}</li>`).join('') + `</${type}>`)
      continue
    }

    // 普通段落行
    para.push(line); i++
  }
  flushPara()

  // 行内格式：行内代码、粗体、斜体（跳过 <pre> 代码块与代码块容器）
  // v487 P2-⑦：先抽 [[control: ...]] 轻量围栏渲染成真实交互控件（滑块/开关），变更经
  //   CopilotDrawer 的 @change 委托回灌 AI。控件 HTML 在已转义文本上注入，不会被二次转义。
  const inline = (s) => {
    let r = String(s).replace(/\[\[control:\s*([^\]]+?)\]\]/g, (_m, body) => {
      const p = String(body).split('|').map((x) => x.trim())
      const type = (p[0] || 'slider').toLowerCase()
      const label = p[1] || '参数'
      if (type === 'switch') {
        const on = (p[2] || '').toLowerCase() === 'on' || p[2] === '1' || p[2] === 'true'
        return '<span class="md-control" data-type="switch" data-label="' + escAttr(label) + '" data-value="' + (on ? 'on' : 'off') + '">' +
          '<label class="md-control-lbl">' + esc(label) + '</label>' +
          '<button type="button" class="md-switch ' + (on ? 'on' : '') + '" role="switch" aria-checked="' + on + '" data-label="' + escAttr(label) + '"></button>' +
          '</span>'
      }
      const min = p[2] || '0', max = p[3] || '100', step = p[4] || '1', val = p[5] || min
      return '<span class="md-control" data-type="slider" data-label="' + escAttr(label) + '" data-value="' + escAttr(val) +
        '" data-min="' + escAttr(min) + '" data-max="' + escAttr(max) + '" data-step="' + escAttr(step) + '">' +
        '<label class="md-control-lbl">' + esc(label) + '</label>' +
        '<input type="range" class="md-control-range" min="' + escAttr(min) + '" max="' + escAttr(max) + '" step="' + escAttr(step) + '" value="' + escAttr(val) + '" data-label="' + escAttr(label) + '">' +
        '<span class="md-control-val">' + esc(val) + '</span></span>'
    })
    return r
      .replace(/`([^`]+?)`/g, '<code class="md-code">$1</code>')
      .replace(/\*\*([^*]+?)\*\*/g, '<b>$1</b>')
      .replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<i>$2</i>')
  }

  let html = out
    .map((b) => (b.startsWith('<pre>') || b.startsWith('<div class="md-codeblock">') ? b : inline(b)))
    .join('')

  // P1-b：长回复（≥3 个标题）自动生成可折叠目录（点击跳转，不触发 hash 路由）
  if (toc.length >= 3) {
    const items = toc.map((t) =>
      `<li class="md-toc-li lv${t.lv}"><span class="md-toc-link" data-anchor="${t.id}">${esc(t.text)}</span></li>`
    ).join('')
    html = `<details class="md-toc" open><summary class="md-toc__title">目录</summary><ul class="md-toc-list">${items}</ul></details>` + html
  }

  return html
}
