// 轻量 Markdown 渲染（自托管，无外部 CDN；先转义 HTML 防 XSS）
// 支持：标题 #/##/###、粗体 **、斜体 *、行内代码 `、无序列表 -/*、有序列表 1.、
//       表格 |、引用 >、分割线 ---、围栏代码块 ```，其余按段落 + 换行渲染。
// 用法：v-html="renderMd(text)" —— 仅用于可信来源（AI 回复/已抽离 card 围栏的 content）。

export function renderMd(src) {
  if (!src) return ''

  // 1) 抽取围栏代码块，避免被后续行内/块规则破坏
  const codes = []
  const text = src.replace(/```[a-zA-Z0-9]*\n?([\s\S]*?)```/g, (_, code) => {
    const idx = codes.length
    codes.push(code.replace(/\n$/, ''))
    return ` C${idx} `
  })

  const esc = (s) => s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  const lines = text.split(/\r?\n/)
  const out = []
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
      out.push('<pre><code>' + esc(codes[+cm[1]]) + '</code></pre>')
      i++; continue
    }

    // 空行：段落分隔
    if (/^\s*$/.test(line)) { flushPara(); i++; continue }

    // 标题
    const hm = line.match(/^(#{1,3})\s+(.*)$/)
    if (hm) {
      flushPara()
      const lv = hm[1].length
      out.push(`<h${lv} class="md-h md-h${lv}">${esc(hm[2].trim())}</h${lv}>`)
      i++; continue
    }

    // 分割线
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) { flushPara(); out.push('<hr class="md-hr">'); i++; continue }

    // 引用
    if (/^\s*>\s?/.test(line)) {
      flushPara()
      const quote = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { quote.push(lines[i].replace(/^\s*>\s?/, '')); i++ }
      out.push('<blockquote class="md-quote">' + quote.map((l) => esc(l)).join('<br>') + '</blockquote>')
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
      let t = '<table class="md-table"><thead><tr>' + head.map((c) => `<th>${esc(c)}</th>`).join('') + '</tr></thead><tbody>'
      t += rows.map((r) => '<tr>' + r.map((c) => `<td>${esc(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table>'
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

  // 行内格式：行内代码、粗体、斜体（跳过 <pre> 代码块）
  const inline = (s) => s
    .replace(/`([^`]+?)`/g, '<code class="md-code">$1</code>')
    .replace(/\*\*([^*]+?)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<i>$2</i>')

  return out
    .map((b) => (b.startsWith('<pre>') ? b : inline(b)))
    .join('')
}
