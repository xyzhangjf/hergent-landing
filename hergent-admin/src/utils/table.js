// 表格通用工具：前端排序 + 分页切片
// 说明：当前后台数据量在百级以内，分页与排序均在本地完成；
// 若日后数据量上千，改为后端 limit/offset + order_by，调用方只需替换 computed。

export const PAGE_SIZE = 20

/**
 * 对行数组做排序（不修改原数组）
 * @param {Array} rows 数据行
 * @param {string} key 排序字段，空串表示不排序
 * @param {'asc'|'desc'} dir 方向
 */
export function sortRows(rows, key, dir) {
  if (!key) return rows
  const arr = [...rows]
  arr.sort((a, b) => {
    let va = a[key]
    let vb = b[key]
    if (va == null) va = ''
    if (vb == null) vb = ''
    // 数字直接比大小，其余按中文友好的字符串比较
    if (typeof va === 'number' && typeof vb === 'number') {
      return dir === 'asc' ? va - vb : vb - va
    }
    const sa = String(va)
    const sb = String(vb)
    return dir === 'asc' ? sa.localeCompare(sb, 'zh') : sb.localeCompare(sa, 'zh')
  })
  return arr
}

/** 取第 page 页（1 起）的数据切片 */
export function pageSlice(rows, page, pageSize = PAGE_SIZE) {
  const start = (page - 1) * pageSize
  return rows.slice(start, start + pageSize)
}
