// 轻量 Markdown 渲染（自托管，无外部 CDN；先转义 HTML 防 XSS）
// 支持：标题 #/##/###、粗体 **、斜体 *、行内代码 `、无序列表 -/*、有序列表 1.、
//       表格 |、引用 >、分割线 ---、围栏代码块 ```，其余按段落 + 换行渲染。
// 用法：v-html="renderMd(text)" —— 仅用于可信来源（AI 回复/已抽离 card 围栏的 content）。
import { stripAllFences } from '../composables/useCardTrigger'

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
  const codes = []
  const text = body.replace(/```([a-zA-Z0-9]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
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
  const isNumCell = (v) => /^-?\d[\d,]*(\.\d+)?%?$/.test(String(v == null ? '' : v).trim())
  const buildTableChart = (head, rows) => {
    const numIdx = []
    for (let c = 0; c < head.length; c++) {
      if (isNumCell(head[c])) continue            // 表头本身是数字（如年份列）不算数值列
      let cnt = 0
      for (const r of rows) if (isNumCell(r[c])) cnt++
      if (cnt >= 2) numIdx.push(c)
    }
    if (numIdx.length < 2 || rows.length < 3) return ''
    const W = 220, H = 96, pX = 6, pTop = 10, pBot = 16
    const n = rows.length
    const pal = ['var(--p-dark)', 'var(--suc)', 'var(--war)', 'var(--dan)', 'var(--violet, #8b5cf6)']
    let svg = `<line x1="${pX}" y1="${H - pBot}" x2="${W - pX}" y2="${H - pBot}" stroke="var(--border-subtle)" stroke-width="1"/>`
    numIdx.forEach((c, si) => {
      const series = rows.map((r) => parseFloat(String(r[c] == null ? '' : r[c]).replace(/[,%]/g, '')) || 0)
      const min = Math.min(...series), max = Math.max(...series)
      const span = (max - min) || 1
      const color = pal[si % pal.length]
      const pts = series.map((v, k) => {
        const x = pX + (n <= 1 ? 0 : (k / (n - 1)) * (W - pX * 2))
        const y = (H - pBot) - ((v - min) / span) * (H - pTop - pBot)
        return x.toFixed(1) + ',' + y.toFixed(1)
      }).join(' ')
      svg += `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
    })
    const legend = numIdx.map((c, si) => `<span class="md-chart-lg"><i style="background:${pal[si % pal.length]}"></i>${esc(head[c])}</span>`).join('')
    return `<div class="md-table-chart" hidden><svg class="md-chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${svg}</svg><div class="md-chart-legend">${legend}</div></div>`
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
        t += '<div class="md-table-bar"><button type="button" class="md-table-chart-toggle" title="切换表格 / 图表视图">📊 看图表</button></div>' + chart
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
