/**
 * chartExport.js —— 把图表导出成 PNG（v491，零依赖）
 *
 * 用途：让"图表能直接拿去给厂家看"这句话落地 —— 截图贴进 PPT / 微信 /
 * 邮件都不用再靠操作系统截图。
 *
 * 🔴 导出链路的两个坑（都踩过）：
 *   ① **CSS 变量在导出时失效**。链路是「SVG 序列化 → data URL → <img> → canvas」，
 *      那条链里的 SVG 是**孤立文档**，拿不到 `:root` 上的变量 ⇒ 不内联的话
 *      导出的图**全是黑块**（fill 回落默认黑）。故必须先走 `inlineSvg()` 内联实际色。
 *   ② **尺寸**。不显式给 width/height，canvas 会按 viewBox 之外的默认值画 ⇒ 空白图。
 *
 * ⚠️ 用 data URL 而不是 blob URL：data URL 与页面同源，canvas 不会被污染
 *    （blob URL 在部分浏览器会 taint canvas，`toDataURL` 直接抛安全错误）。
 */
import { inlineSvg, resolveVar, TOKEN } from './chartTheme'

/**
 * @param {SVGElement} svgEl    源 SVG（未内联）
 * @param {string} filename     下载文件名（不含扩展名）
 * @param {object} [opts]
 * @param {string} [opts.background] 背景色令牌，默认页面底；传 '' 得透明背景
 * @returns {Promise<boolean>}  成功与否（失败由调用方决定怎么提示，不静默）
 */
export async function exportSvgToPng(svgEl, filename = 'chart', { background = TOKEN.surface } = {}) {
  if (!svgEl) return false
  // 导出前先把当前文档字体状态固定住：某些浏览器在 img 解码阶段拿不到页面字体，
  // 会让中文标签变成衬线体甚至方块。给文本显式字体族（见 inlineSvg 里对 <text> 的处理）。
  const { node, width, height, scale } = inlineSvg(svgEl, { background })
  const xml = new XMLSerializer().serializeToString(node)
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml)

  const img = new Image()
  img.decoding = 'sync'
  const ok = await new Promise((resolve) => {
    img.onload = () => resolve(true)
    img.onerror = () => resolve(false)
    img.src = url
  })
  if (!ok) return false

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) return false
  if (background) {
    ctx.fillStyle = resolveVar(background)
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

  let dataUrl = ''
  try {
    dataUrl = canvas.toDataURL('image/png')
  } catch (e) {
    return false // canvas 被污染 —— 不静默：返回 false，调用方给提示
  }
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = `${String(filename).replace(/[\\/:*?"<>|]/g, '_')}.png`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  return true
}
