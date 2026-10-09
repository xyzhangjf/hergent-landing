/* CSV 导出的**唯一实现**（转义规则 + 下载动作 + 文件名日期戳）。

   🔴 为什么要从页面里上提成公共工具：这条规则原先只写在 `InvPurchaseList.vue` 里。
      P1-5 给采购单详情页也加了导出 ⇒ 立刻变成**两处**。同一规则抄两份的代价不是
      "多写几行"，而是**漏抄的那一份出错**：一份记得加 BOM，另一份忘了 ⇒ 用户用 Excel
      打开是满屏乱码，且**前台零报错**（文件照样下载成功）。这与本仓「同屏两个说法」
      「同一规则多份实现」是同一类缺陷。

   🔴 `\ufeff`（UTF-8 BOM）**不是保险，是必需**：Excel 打开无 BOM 的 UTF-8 CSV 时，
      中文会按本机代码页解释 ⇒ 乱码。实测过，别删。
   🔴 行分隔用 `\r\n`（不是 `\n`）：Excel 与 Windows 记事本对 `\n` 的兼容性不如 `\r\n`。

   消费面（谁都不许再写第二份）：
     · `InvPurchaseList.vue::doExport`（列表导出，跟随列设置）
     · `InvPurchaseDetail.vue::doExport`（单张采购单明细导出）
*/

/** 单个单元格 → CSV 片段。含 `,` / `"` / 换行的值必须整体加引号并把内部 `"` 翻倍。 */
export function csvCell (v) {
  const s = String(v === null || v === undefined ? '' : v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * 本地日期戳 `YYYY-MM-DD`。
 *
 * 🔴 **刻意不用 `new Date().toISOString().slice(0,10)`**：`toISOString` 是 **UTC**。
 *    中国是 UTC+8 ⇒ 北京时间**凌晨 0:00–7:59** 导出的文件名会写成**前一天**
 *    （例：本地 10-09 07:00 = UTC 10-08 23:00 ⇒ 文件名标 10-08）。
 *    用户按文件名归档时会以为导错了。所以按**本地**年月日拼。
 */
export function localDateStamp (d = new Date()) {
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * 触发下载一个 CSV。
 * @param {string} filename 文件名（不含路径）；调用方自己拼日期戳（用 `localDateStamp`）
 * @param {Array<Array<any>>} rows 行 × 列；首行通常是表头
 */
export function downloadCsv (filename, rows) {
  const csv = rows.map(row => row.map(csvCell).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
