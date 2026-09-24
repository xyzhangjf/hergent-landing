// CSV 导出工具（纯前端，无需后端）
// 说明：加 BOM 是为了让 Excel 正确识别 UTF-8，避免中文乱码。

function esc(v) {
  const s = v == null ? '' : String(v)
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

/**
 * @param {{key:string,label:string}[]} columns 列定义
 * @param {object[]} rows 数据行
 */
export function toCsv(columns, rows) {
  const head = columns.map((c) => esc(c.label)).join(',')
  const body = rows.map((r) => columns.map((c) => esc(r[c.key])).join(','))
  return '\ufeff' + [head, ...body].join('\r\n')
}

export function downloadCsv(filename, csvText) {
  const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 生成 `前缀-YYYYMMDD.csv` 形式的文件名 */
export function csvFilename(prefix) {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return prefix + '-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '.csv'
}

/** 一步导出：exportCsv('租户列表', columns, rows) */
export function exportCsv(prefix, columns, rows) {
  downloadCsv(csvFilename(prefix), toCsv(columns, rows))
}
