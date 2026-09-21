/**
 * btn-center-compare-shot.mjs — 生成「按钮文字居中」修复前后的对照图
 *
 * 画面里每行按钮上压一条**红色虚线 = 按钮几何垂直中线**，一眼就能看出修复前文字浮在中线之上、
 * 修复后文字被中线穿过。两个按钮的 CSS 都**直接取自真实文件**（不接受手抄），
 * 只是把 `.btn{` 改名成 `.btn.before{` / `.btn.after{` 以同屏共存。
 *
 * 用法：node btn-center-compare-shot.mjs <容器样式来源wxss> <修复前wxss> <修复后wxss> <输出png> [前标签] [后标签]
 *   容器样式来源：提供 .login-page / .card 等页面容器样式（只为画面像真实产品；
 *   它不参与居中判定 —— 按钮是否居中只由 .btn 自身与微信 button 默认样式决定）。
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import { launch } from './lib/cdp-lite.mjs'

const [COMMON_WXSS, BEFORE_WXSS, AFTER_WXSS, OUT_PNG, CAP_BEFORE, CAP_AFTER] = process.argv.slice(2)
const BTN_TEXT = process.env.BTN_TEXT || '登 录'
if (!OUT_PNG) {
  console.error('用法：node btn-center-compare-shot.mjs <容器样式来源> <修复前wxss> <修复后wxss> <输出png> [前标签] [后标签]')
  process.exit(2)
}

const VIEWPORT = 375
const DSF = 3
const WECHAT_BUTTON_DEFAULT = `
html,body{margin:0;padding:0}
wx-button{position:relative;display:block;margin-left:auto;margin-right:auto;padding-left:14px;padding-right:14px;
  box-sizing:border-box;font-size:18px;text-align:center;text-decoration:none;line-height:2.55555556;
  border-radius:5px;-webkit-tap-highlight-color:transparent;overflow:hidden;color:#000000;background-color:#f8f8f8;
  border:0;font-family:inherit}
wx-button::after{content:"";position:absolute;left:0;top:0;width:200%;height:200%;border:1px solid rgba(0,0,0,.2);
  border-radius:inherit;transform:scale(.5);transform-origin:0 0;box-sizing:border-box;pointer-events:none}
`
const rpx2px = (css) => css.replace(/(-?\d*\.?\d+)rpx/g, (_, n) => (parseFloat(n) * VIEWPORT / 750) + 'px')
const pickBtn = (f) => {
  const line = fs.readFileSync(f, 'utf8').split('\n').find(l => l.trim().startsWith('.btn{'))
  if (!line) throw new Error('在 ' + f + ' 里找不到 .btn{ 规则')
  return line.trim()
}
/* 公共部分 = 容器样式来源全文去掉 .btn 规则（提供 .login-page / .card / .ipt 等真实容器样式）。
   ⚠️ 只删「以 .btn{ 开头」的整行，不要顺手删注释首行 —— 多行注释删掉首行会把注释体留成裸 CSS，直接坏掉。 */
const common = fs.readFileSync(COMMON_WXSS, 'utf8').split('\n')
  .filter(l => !l.trim().startsWith('.btn{')).join('\n')
const cssBefore = pickBtn(BEFORE_WXSS).replace(/^\.btn\{/, '.btn.before{')
const cssAfter = pickBtn(AFTER_WXSS).replace(/^\.btn\{/, '.btn.after{')

const html = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>${rpx2px(WECHAT_BUTTON_DEFAULT + '\n' + common + '\n' + cssBefore + '\n' + cssAfter + `
/* 仅对照图专用：中线由脚本按**按钮实测矩形**摆放（不能靠 top:50% —— 按钮自带 margin-top:8rpx，
   卡片中心会比按钮中心高 2 CSS px，画出来的基准线就是错的）。 */
body{position:relative}
.mid{position:absolute;border-top:1px dashed #ff3b30;pointer-events:none;z-index:9}
.cap{font:600 30rpx/1.6 -apple-system,"PingFang SC",sans-serif;color:#1d1d1f;margin:36rpx 0 12rpx 24rpx}
.cap .n{color:#ff3b30;font-family:ui-monospace,Menlo,monospace}
`)}</style></head>
<body><div class="login-page" style="padding-top:0">
  <div class="cap">修复前 · <span class="n">${CAP_BEFORE || ''}</span></div>
  <div class="card"><wx-button class="btn before">${BTN_TEXT}</wx-button></div>
  <div class="cap">修复后 · <span class="n">${CAP_AFTER || ''}</span></div>
  <div class="card"><wx-button class="btn after">${BTN_TEXT}</wx-button></div>
</div></body></html>`

const tmp = path.join(os.tmpdir(), 'btncmp-' + Date.now() + '.html')
fs.writeFileSync(tmp, html)

const browser = await launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.enable()
  await page.raw.send('Emulation.setDeviceMetricsOverride',
    { width: VIEWPORT, height: 800, deviceScaleFactor: DSF, mobile: true })
  await page.goto('file://' + tmp, 800)
  /* 按按钮实测矩形摆放中线（1px 粗 ⇒ 上移 0.5px 使其视觉中心正好压在按钮中心上） */
  const placed = await page.eval(`(() => {
    const out = []
    document.querySelectorAll('.card').forEach(card => {
      const b = card.querySelector('wx-button'), r = b.getBoundingClientRect()
      const l = document.createElement('i'); l.className = 'mid'
      l.style.left = r.left + 'px'; l.style.width = r.width + 'px'
      l.style.top = (r.top + window.scrollY + r.height / 2 - 0.5) + 'px'
      document.body.appendChild(l)
      out.push({btnTop: r.top, btnH: r.height, lineTop: r.top + r.height / 2 - 0.5})
    })
    return JSON.stringify(out)
  })()`)
  console.log('中线落点：' + placed)
  const geo = JSON.parse(await page.eval(`(() => {
    const rs = [...document.querySelectorAll('.card')].map(e => e.getBoundingClientRect())
    const top = Math.min(...rs.map(r => r.top)), bottom = Math.max(...rs.map(r => r.bottom))
    return JSON.stringify({x:0, y:Math.max(0, top - 64), width: ${VIEWPORT}, height: (bottom - top) + 84,
      w: document.documentElement.clientWidth})
  })()`))
  if (geo.w !== VIEWPORT) throw new Error(`布局视口 ${geo.w}px ≠ ${VIEWPORT}px，换算基准失真，拒绝出图`)
  const shot = await page.raw.send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: false,
    clip: { x: 0, y: geo.y, width: geo.width, height: geo.height, scale: 1 },
  })
  fs.mkdirSync(path.dirname(OUT_PNG), { recursive: true })
  fs.writeFileSync(OUT_PNG, Buffer.from(shot.result.data, 'base64'))
  console.log('已出图：' + OUT_PNG)
} finally { await browser.close(); fs.rmSync(tmp, { force: true }) }
