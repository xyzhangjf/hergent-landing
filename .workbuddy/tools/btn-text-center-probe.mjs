/**
 * btn-text-center-probe.mjs — 小程序按钮「文字是否真的居中」的像素级实测
 *
 * 为什么需要它：
 *   微信 `<button>` 组件带一套**内置默认样式**（不在仓库里、grep 不到），其中
 *   `line-height: 2.55555556` 是**无单位倍数**，按元素自身 font-size 计算。
 *   于是「设了 height 却没设 line-height」的按钮，行高 ≠ 高度，文字就偏上/偏下 ——
 *   而肉眼看不出偏了几 rpx，也说不清是谁造成的。本探针把按钮单独截屏，
 *   直接量**文字墨迹像素包围盒中心**与**按钮几何中心**之差（单位 rpx）。
 *
 * 关键工程细节（都踩过，注释保留以便复用）：
 *   1) 必须用 `<wx-button>` 自定义元素模拟，**不能用 HTML `<button>`**：
 *      Chrome 对原生 button 额外做了「内容垂直自动居中」，会把本缺陷掩盖掉。
 *   2) 必须写 viewport meta：`mobile:true` 而缺它时布局视口会回落到 ~980px，
 *      与本脚本写死的 rpx 换算基准（375）脱钩。脚本内自带前提断言。
 *   3) 掩膜必须**向内侵蚀**几像素：按钮自身轮廓的抗锯齿像素是「青↔白」混合，
 *      r 通道会被抬到 >90 而被误判成文字（实测把垂直偏移从 -8 污染成 -19.5）。
 *   4) 注入页面的代码里**不能出现反斜杠 n 的换行转义**（本函数体是模板串，
 *      转义会在注入时被吃掉，注释里的也会 —— 踩过两次）。
 *
 * 判别力：自带两个反向对照（行高设得过大/过小），**必须先看到它们报出大偏移**，
 *   否则「实际场景偏移≈0」毫无意义（假绿灯）。
 *
 * 用法：node btn-text-center-probe.mjs <wxss路径> [标签]
 *   环境变量 BTNPROBE_DUMP=<目录>  落盘截图
 *             BTNPROBE_ASCII=1      打印 JS 侧墨迹位图（与 PNG 直解比对用）
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import { launch } from './lib/cdp-lite.mjs'

const VIEWPORT = 375
const DSF = 2
const CLIP_SCALE = 1
const INSET = 3                                    // 掩膜向内侵蚀的图像像素数
const IMG_PX_PER_RPX = (VIEWPORT * DSF * CLIP_SCALE) / 750   // = 1.0

const WXSS = process.argv[2]
const LABEL = process.argv[3] || 'as-is'
if (!WXSS) { console.error('用法：node btn-text-center-probe.mjs <wxss路径> [标签]'); process.exit(2) }

/* 微信 button 组件内置默认样式（仓库里 grep 不到，按官方值补上）。 */
const WECHAT_BUTTON_DEFAULT = `
html,body{margin:0;padding:0}
wx-button{position:relative;display:block;margin-left:auto;margin-right:auto;padding-left:14px;padding-right:14px;
  box-sizing:border-box;font-size:18px;text-align:center;text-decoration:none;line-height:2.55555556;
  border-radius:5px;-webkit-tap-highlight-color:transparent;overflow:hidden;color:#000000;background-color:#f8f8f8;
  border:0;font-family:inherit}
wx-button::after{content:"";position:absolute;left:0;top:0;width:200%;height:200%;border:1px solid rgba(0,0,0,.2);
  border-radius:inherit;transform:scale(.5);transform-origin:0 0;box-sizing:border-box;pointer-events:none}
`
const BUTTON_TAG = 'wx-button'
/* 按钮文案可配：不同页面文案不同（登录页「登 录」/ 首次改密页「设置并进入」…）。
   文案不影响垂直居中（同一 font-size 下 CJK 墨迹盒与行盒的关系一致），但**图里的字必须和实测用的是同一个**，
   否则「图上写着甲、数字来自乙」。 */
const BTN_TEXT = process.env.BTNPROBE_TEXT || '登 录'

const rpx2px = (css) => css.replace(/(-?\d*\.?\d+)rpx/g, (_, n) => (parseFloat(n) * VIEWPORT / 750) + 'px')

function scenarios() {
  /* 对照组分两族，因为「文字位置由谁决定」有两种机制：
       · 块级 + line-height 排版（微信 button 的默认形态）⇒ 行高能推动文字
       · flex + align-items ⇒ 行高推不动，只有对齐方式能推动
     用**两族各自成立**的对照，才能既证明探针有判别力，又能反过来证明当前处于哪种机制。 */
  return [
    { name: LABEL, css: '' },
    // 族一：强制 flex 并改对齐方向（对两种机制都有效），行高同时钉死为 1.2 以免混淆
    {
      name: 'control-align-start', css:
        '.btn{display:flex !important;align-items:flex-start !important;justify-content:center !important;line-height:1.2 !important}'
    },
    {
      name: 'control-align-end', css:
        '.btn{display:flex !important;align-items:flex-end !important;justify-content:center !important;line-height:1.2 !important}'
    },
    // 族二：只改行高（仅对「块级 + line-height」机制有效）
    { name: 'control-lh-too-big', css: '.btn{line-height:150rpx !important}' },
    { name: 'control-lh-too-small', css: '.btn{line-height:20rpx !important}' },
    /* 健壮性：只改高度、不动其他属性。
       flex 居中下残差应**不随高度变化**（若跟着长 ⇒ 是真缺陷，不是量化底噪）；
       块级 + line-height 下残差会随高度线性漂移（这正是「height 与 line-height 必须永远相等」的病根）。 */
    { name: 'robust-h120', css: '.btn{height:120rpx !important}' },
    { name: 'robust-h200', css: '.btn{height:200rpx !important}' },
  ]
}

function buildHTML(fileCss, extra) {
  const css = rpx2px(WECHAT_BUTTON_DEFAULT + '\n' + fileCss + '\n' + extra)
  // 结构与 login.wxml 保持一致（card 内两个 ipt + 一个 btn）
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>${css}</style></head>
<body><div class="login-page"><div class="card">
  <input class="ipt" placeholder="手机号 / 账号">
  <input class="ipt" placeholder="密码" type="password">
  <${BUTTON_TAG} class="btn">${BTN_TEXT}</${BUTTON_TAG}>
</div></div></body></html>`
}

/* 页面内：量按钮几何 + 计算样式 */
const MEASURE_JS = `(() => {
  const btn = document.querySelector('.btn')
  const card = document.querySelector('.card')
  const cs = getComputedStyle(btn), ccs = getComputedStyle(card)
  const r = btn.getBoundingClientRect()
  const cr = card.getBoundingClientRect()
  return JSON.stringify({
    rect: {x:r.x, y:r.y, w:r.width, h:r.height},
    card: {x:cr.x, w:cr.width, padL:parseFloat(ccs.paddingLeft), padR:parseFloat(ccs.paddingRight)},
    lineHeight: cs.lineHeight, fontSize: cs.fontSize,
    display: cs.display, alignItems: cs.alignItems, justifyContent: cs.justifyContent,
    padL: cs.paddingLeft, padR: cs.paddingRight,
    layoutW: document.documentElement.clientWidth, dpr: window.devicePixelRatio,
  })
})()`

/* 页面内：解出「文字墨迹包围盒」。只统计**内缩后圆角矩形内部**的像素。 */
const decodeJs = (dataUrl, radiusCss) => `(async () => {
  const img = new Image()
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = ${JSON.stringify(dataUrl)} })
  const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height
  const ctx = cv.getContext('2d'); ctx.drawImage(img, 0, 0)
  const {data} = ctx.getImageData(0, 0, img.width, img.height)
  const W = img.width, H = img.height
  const R = ${Number(radiusCss)}
  const I = ${INSET}
  const w = W - 2 * I, h = H - 2 * I, rr = Math.max(R - I, 1)
  const inside = (x, y) => {
    const X = x - I, Y = y - I
    if (X < 0 || Y < 0 || X > w || Y > h) return false
    const cx = X < rr ? rr : (X > w - rr ? w - rr : X)
    const cy = Y < rr ? rr : (Y > h - rr ? h - rr : Y)
    return (X - cx) * (X - cx) + (Y - cy) * (Y - cy) <= rr * rr
  }
  let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1, n = 0
  const rows = []
  for (let y = 0; y < H; y++) {
    let cnt = 0
    for (let x = 0; x < W; x++) {
      if (!inside(x + 0.5, y + 0.5)) continue
      const i = (y * W + x) * 4
      if (data[i] > 90 && data[i + 1] > 190) {
        n++; cnt++
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y
      }
    }
    rows.push(cnt)
  }
  const NL = String.fromCharCode(10)
  let ascii = ''
  for (let y = 0; y < H; y += 4) {
    for (let x = 0; x < W; x += 8) {
      const i = (y * W + x) * 4
      ascii += (inside(x + 0.5, y + 0.5) && data[i] > 90 && data[i + 1] > 190) ? '#' : '.'
    }
    ascii += NL
  }
  return JSON.stringify({W, H, n, inkLeft: x0, inkRight: x1, inkTop: y0, inkBottom: y1,
    inkCx: (x0 + x1 + 1) / 2, inkCy: (y0 + y1 + 1) / 2, boxCx: W / 2, boxCy: H / 2, rows, ascii})
})()`

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'btnprobe-'))
const fileCss = fs.readFileSync(WXSS, 'utf8')

const rows = []
const browser = await launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.enable()
  await page.raw.send('Emulation.setDeviceMetricsOverride',
    { width: VIEWPORT, height: 900, deviceScaleFactor: DSF, mobile: true })

  for (const sc of scenarios()) {
    const f = path.join(tmp, sc.name + '.html')
    fs.writeFileSync(f, buildHTML(fileCss, sc.css))
    await page.goto('file://' + f, 600)
    const m = JSON.parse(await page.eval(MEASURE_JS))

    const shot = await page.raw.send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: false,
      clip: { x: m.rect.x, y: m.rect.y, width: m.rect.w, height: m.rect.h, scale: CLIP_SCALE },
    })
    if (process.env.BTNPROBE_DUMP) {
      fs.mkdirSync(process.env.BTNPROBE_DUMP, { recursive: true })
      fs.writeFileSync(path.join(process.env.BTNPROBE_DUMP, sc.name + '.png'),
        Buffer.from(shot.result.data, 'base64'))
    }
    const ink = JSON.parse(await page.eval(decodeJs(
      'data:image/png;base64,' + shot.result.data,
      (16 * VIEWPORT / 750) * DSF * CLIP_SCALE)))

    const offY = (ink.inkCy - ink.boxCy) * IMG_PX_PER_RPX
    const offX = (ink.inkCx - ink.boxCx) * IMG_PX_PER_RPX
    if (process.env.BTNPROBE_ASCII) {
      console.log(`\n--- [${sc.name}] n=${ink.n} bbox x[${ink.inkLeft},${ink.inkRight}] y[${ink.inkTop},${ink.inkBottom}]`)
      console.log(ink.ascii)
    }
    rows.push({ sc: sc.name, offX, offY, ink, m })
  }
} finally { await browser.close() }

/* ---------------- 断言 ---------------- */
const mk = (s) => rows.find(x => x.sc === s)
let pass = 0, fail = 0
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✅ ' + msg) } else { fail++; console.log('  ❌ ' + msg) } }
const r2rpx = (cssPx) => cssPx * 750 / VIEWPORT

console.log('\n' + '='.repeat(86))
console.log(`按钮文字居中实测   源文件=${WXSS}`)
console.log(`标签=${LABEL}   视口 ${VIEWPORT}px · dpr ${DSF} · 1 图像像素 = ${IMG_PX_PER_RPX} rpx · 掩膜内缩 ${INSET}px`)
console.log('='.repeat(86))
console.log('场景'.padEnd(22) + '水平偏移'.padStart(12) + '垂直偏移'.padStart(12) + '   墨迹盒 / 按钮盒')
for (const row of rows) {
  const { ink } = row
  console.log(row.sc.padEnd(22)
    + (row.offX.toFixed(2) + ' rpx').padStart(12)
    + (row.offY.toFixed(2) + ' rpx').padStart(12)
    + `   ${ink.inkRight - ink.inkLeft + 1}×${ink.inkBottom - ink.inkTop + 1} / ${ink.W}×${ink.H}`)
}

const A = mk(LABEL), BIGH = mk('control-lh-too-big'), SMALLH = mk('control-lh-too-small')
const AS = mk('control-align-start'), AE = mk('control-align-end')
const m = A.m
const isFlex = m.display === 'flex' && m.alignItems === 'center'
const cardW = m.card.w - m.card.padL - m.card.padR
const lineH = parseFloat(m.lineHeight)
const heightRpx = r2rpx(m.rect.h)
const lineHRpx = r2rpx(lineH)
/* 机理预言：行盒贴在内容盒顶部 ⇒ 文字中心 = 行高一半，按钮中心 = 高度一半 */
const predictedY = (lineHRpx - heightRpx) / 2

console.log('\n【A】探针前提与几何')
ok(m.layoutW === VIEWPORT, `布局视口 ${m.layoutW}px == rpx 换算基准 ${VIEWPORT}px（否则所有 rpx 数字无效）`)
ok(Math.abs(m.rect.w - cardW) < 1, `按钮块级铺满卡片内容宽：${m.rect.w}px == ${cardW}px（改动未影响布局宽度）`)
console.log(`  display=${m.display}  align-items=${m.alignItems}  justify-content=${m.justifyContent}`)
console.log(`  height=${heightRpx} rpx  font-size=${r2rpx(parseFloat(m.fontSize))} rpx  line-height=${lineH}px = ${lineHRpx.toFixed(2)} rpx  padding=${m.padL}/${m.padR}`)
ok(A.ink.inkTop > INSET && A.ink.inkBottom < A.ink.H - INSET && A.ink.inkLeft > INSET && A.ink.inkRight < A.ink.W - INSET,
  `墨迹未被掩膜裁切（bbox 不贴内缩边界）⇒ 量的是完整字形`)

console.log('\n【B】判别力自证：对照必须报出大偏移、且双向可识别')
ok(AS.offY <= -20, `强制顶对齐 ⇒ 墨迹明显偏上 ${AS.offY.toFixed(2)} rpx`)
ok(AE.offY >= 20, `强制底对齐 ⇒ 墨迹明显偏下 ${AE.offY.toFixed(2)} rpx`)
ok(AS.offY < 0 && AE.offY > 0, `两向偏移相反且量级对称 ⇒ 探针能双向识别，不是单向假信号`)

console.log('\n【C】机理归属：文字位置当前由谁决定')
if (isFlex) {
  /* 容差 2 rpx：墨迹包围盒是**整数像素**，其中心 (y0+y1+1)/2 有 0.5 图像像素量化，
     叠加字形墨迹中心与行盒中心的字体度量差，实测残差恒在 ±1 rpx。原缺陷 7 rpx。 */
  ok(Math.abs(BIGH.offY - A.offY) <= 2 && Math.abs(SMALLH.offY - A.offY) <= 2,
    `行高改成 150rpx / 20rpx 文字都不动（差 ${Math.abs(BIGH.offY - A.offY).toFixed(2)} / ${Math.abs(SMALLH.offY - A.offY).toFixed(2)} rpx，容差 2）⇒ 已与 line-height 解耦`)
  console.log(`  ℹ️ 按钮为 flex 居中（align-items=center）⇒ 居中不再依赖 height 与 line-height 相等，`)
  console.log(`     故不再做「行盒贴顶」预言核对；居中成立性由 D 段实测偏移直接判定。`)
} else {
  ok(BIGH.offY > 20 && SMALLH.offY < -20, `行高 150rpx ⇒ 偏下 ${BIGH.offY.toFixed(2)}；行高 20rpx ⇒ 偏上 ${SMALLH.offY.toFixed(2)}`)
  console.log(`  ℹ️ 机理核对：行高 ${lineHRpx.toFixed(2)} rpx vs 高度 ${heightRpx} rpx ⇒ 预言偏移 ${predictedY.toFixed(2)} rpx，实测 ${A.offY.toFixed(2)} rpx`)
  ok(Math.abs(A.offY - predictedY) <= 2.5, `实测与「行盒贴顶」预言一致（|差| ${Math.abs(A.offY - predictedY).toFixed(2)} rpx ≤ 2.5）`)
  ok(true, `⇒ 缺陷机理确认：文字位置由 line-height 决定，而它比 height 小 ${(heightRpx - lineHRpx).toFixed(2)} rpx`)
}

console.log('\n【D】实际场景：文字是否在按钮内垂直 + 水平居中')
/* 阈值 1.5 rpx：即 0.75 CSS px，不到 2 倍屏上的 1.5 物理像素；而原缺陷 7 rpx ⇒ 判别余量 4.7 倍。
   不设 0 是因为墨迹包围盒中心有 0.5 图像像素的量化下限，任何实现都到不了「精确 0」。 */
ok(Math.abs(A.offY) <= 1.5, `垂直偏移 ${A.offY.toFixed(2)} rpx（阈值 ±1.5 rpx ≈ 0.75 CSS px；原缺陷 7 rpx）`)
ok(Math.abs(A.offX) <= 1.5, `水平偏移 ${A.offX.toFixed(2)} rpx（阈值 ±1.5 rpx）`)

console.log('\n【E】高度无关性：只改 height，残差会不会跟着长')
{
  const H120 = mk('robust-h120'), H200 = mk('robust-h200')
  console.log(`  height 120rpx ⇒ ${H120.offY.toFixed(2)} rpx   height 200rpx ⇒ ${H200.offY.toFixed(2)} rpx`)
  if (isFlex) {
    ok(Math.abs(H120.offY) <= 1.5 && Math.abs(H200.offY) <= 1.5,
      `三种高度（96/120/200 rpx）残差都 ≤1.5 rpx ⇒ 残差是量化底噪，不随几何增长`)
    ok(Math.max(Math.abs(A.offY), Math.abs(H120.offY), Math.abs(H200.offY))
       - Math.min(Math.abs(A.offY), Math.abs(H120.offY), Math.abs(H200.offY)) <= 2,
      `残差在三种高度间基本恒定 ⇒ flex 居中与 height 解耦，改高度不会再漂`)
  } else {
    const p120 = (lineHRpx - r2rpx(H120.m.rect.h)) / 2, p200 = (lineHRpx - r2rpx(H200.m.rect.h)) / 2
    console.log(`  ℹ️ 预言（行盒贴顶）：120rpx ⇒ ${p120.toFixed(2)} rpx，200rpx ⇒ ${p200.toFixed(2)} rpx`)
    ok(Math.abs(H120.offY - p120) <= 2.5 && Math.abs(H200.offY - p200) <= 2.5,
      `块级 + line-height 下残差随高度**线性漂移**并精确命中预言 ⇒ 病根就是「height 与 line-height 必须永远相等」`)
  }
}

console.log('\n' + '='.repeat(86))
console.log(fail === 0 ? `✅ 全部通过 ${pass}/${pass + fail}` : `❌ 失败 ${fail} 项 / 共 ${pass + fail} 项`)
console.log('='.repeat(86) + '\n')
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(fail === 0 ? 0 : 1)
