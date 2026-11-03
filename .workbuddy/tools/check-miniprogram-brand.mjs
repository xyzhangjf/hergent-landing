#!/usr/bin/env node
/**
 * 小程序品牌色校验（v736，2026-11-03）
 *
 * 背景：小程序原来把亮青 #06b6d4 写死在 58 处，实心底白字只有 2.43:1；
 *       Web 端 v717 就改深了，两边从那版起分叉。同一个"品牌青"在项目里并存过
 *       三个值（#06b6d4 / #0891b2 / #0e7490）—— 这版统一到 --brand 一个。
 *
 * 这套校验要挡的不是"某个色值不好看"，而是**同一个品牌色又长出第二个值**。
 *   ① 除 app.wxss 的声明行外，任何 wxss/js/wxml 里出现 brand 色字面量 → 报错
 *   ①b 同一颜色写成 rgb()/rgba() 数值也要抓（v748：`rgba(6,182,212,.92)` 就是
 *      旧的亮青，只认 #hex 的校验逐字节看不见它）
 *   ② app.wxss 必须声明 --brand 且值精确等于 #0e7490
 *   ③ --brand 在各实际底色上的对比度必须 ≥ 4.5（改浅了当场挂）
 *   ④ 原生载体（json/js/组件属性）必须与 --brand 同值 —— 这几个吃不到 CSS 变量
 *   ⑤ 选中态图标 PNG 的每个可见像素必须等于 --brand —— 图标颜色藏在图片里，
 *      最容易出现"文字改了、图标还是旧色"的裂痕
 *   ⑥ 令牌被使用（var(--brand) 少于下限 = 有人绕过令牌写死了别的东西）
 *
 * 用法：node .workbuddy/tools/check-miniprogram-brand.mjs
 *       HG_MINI_ROOT=<另一个小程序目录> node ...   ← 只给护栏自测（故障注入）用
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname)
/* v748：允许指向一份副本 —— 契约测试靠"往副本里注入回旧写法、要求护栏必须红"
   来证明它真的检查了这件事，而不是只证明自己肯 exit 0。 */
const MINI = process.env.HG_MINI_ROOT
  ? path.resolve(process.env.HG_MINI_ROOT)
  : path.join(ROOT, 'forecast-order-miniprogram-20260812T023419087Z/miniprogram')

/** 唯一的品牌色 —— 与 Web 端 --p-solid 同值 */
const BRAND = '#0e7490'
/** 不许再出现的旧值 / 另两档青 */
const STALE = ['#06b6d4', '#0891b2', '#0d9488', '#0a5a6d']
/** var(--brand) 使用处下限（低于它说明有人绕过令牌写死） */
const MIN_TOKEN_USES = 50

const errs = []
const notes = []

/* ── 读文件 ─────────────────────────────────────────────────────────────── */
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}
const files = walk(MINI)

/** 去掉注释，避免注释里的说明文字被当成代码 */
function stripComments(text, kind) {
  if (kind === '.wxml') return text.replace(/<!--[\s\S]*?-->/g, '')
  if (kind === '.wxss') return text.replace(/\/\*[\s\S]*?\*\//g, '')
  if (kind === '.js') return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  return text
}

const rel = (p) => path.relative(MINI, p)
const lineOf = (text, idx) => text.slice(0, idx).split('\n').length

/* ── ① 品牌色字面量只能在 app.wxss 的声明行 ────────────────────────────── */
const APP_WXSS = path.join(MINI, 'app.wxss')
if (!fs.existsSync(APP_WXSS)) {
  errs.push('缺少 app.wxss —— 品牌色令牌没有落地（所有页面都会退回硬编码）')
}

for (const f of files) {
  const ext = path.extname(f)
  if (!['.wxss', '.wxml', '.js', '.json'].includes(ext)) continue
  if (f === APP_WXSS) continue

  const raw = fs.readFileSync(f, 'utf8')
  const code = stripComments(raw, ext)
  const all = [...STALE, BRAND].join('|')
  const re = new RegExp(`(${all.replace(/#/g, '#')})`, 'gi')

  let m
  while ((m = re.exec(code))) {
    const hit = m[1].toLowerCase()
    const ln = lineOf(code, m.index)
    const ctx = code.slice(Math.max(0, m.index - 60), m.index + 40).replace(/\s+/g, ' ')
    // 原生载体是豁免位（吃不到 CSS 变量），单独由 ④ 校验值
    const isNativeCarrier =
      (ext === '.json' && /"(navigationBarBackgroundColor|selectedColor)"\s*:/.test(ctx)) ||
      (ext === '.js' && /confirmColor\s*:/.test(ctx)) ||
      (ext === '.wxml' && /\bcolor\s*=\s*"$/.test(ctx.slice(0, ctx.indexOf(hit))))
    if (isNativeCarrier) {
      if (hit !== BRAND) {
        errs.push(`${rel(f)}:${ln} 原生载体色值不是 ${BRAND}（是 ${hit}）—— ${ctx.trim()}`)
      }
      continue
    }
    errs.push(
      `${rel(f)}:${ln} 出现品牌色字面量 ${hit}（应写 var(--brand)）—— ${ctx.trim()}`
    )
  }
}

/* ── ①b 换个写法（rgb/rgba 数值）也算品牌色字面量 ──────────────────────────
   v748 教训：`.back-top` 写的是 `rgba(6,182,212,.92)` —— 数值上就是旧的亮青
   #06b6d4，只是不叫这个名字。只认 `#hex` 的校验**逐字节看不见它**，所以上一轮
   「58 处已清零」数完之后，这个按钮一直亮着一档更浅的青（实测渲染 #1abbd7）。

   判定按**数值**、不按写法：把 rgb()/rgba() 解析成 hex 再比对。
   顺带把「带 alpha 的品牌色」一并挡掉 —— 品牌色只要混了透明度，压在不同内容上
   就是不同颜色（同一按钮压在商品行上 vs 白卡片上是两个色），那已经不是品牌色
   而是「品牌色 × 背后内容」。要"浮起来"用阴影，不用透明度。 */
const BRAND_FAMILY = new Map([...STALE.map((h) => [h, '旧值']), [BRAND, '品牌色']])
const rgbToHex = (r, g, b) =>
  '#' +
  [r, g, b]
    .map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0'))
    .join('')

for (const f of files) {
  const ext = path.extname(f)
  if (!['.wxss', '.wxml', '.js', '.json'].includes(ext)) continue
  if (f === APP_WXSS) continue
  const code = stripComments(fs.readFileSync(f, 'utf8'), ext)
  /* 兼容三种写法：rgb(6,182,212) / rgba(6, 182, 212, .92) / rgb(6 182 212 / .92) */
  const re = /rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*(?:[,/]\s*([\d.]+%?)\s*)?\)/gi
  let m
  while ((m = re.exec(code))) {
    const hex = rgbToHex(+m[1], +m[2], +m[3])
    const kind = BRAND_FAMILY.get(hex)
    if (!kind) continue
    const ln = lineOf(code, m.index)
    const alpha = m[4]
    const translucent = alpha !== undefined && alpha.replace('%', '') !== '1'
    const ctx = code.slice(Math.max(0, m.index - 60), m.index + 40).replace(/\s+/g, ' ')
    errs.push(
      `${rel(f)}:${ln} 用 rgb()/rgba() 写法绕过了十六进制校验：${m[0]} = ${hex}（${kind}）` +
        (translucent ? `，还带透明度 ${alpha} ⇒ 压在不同内容上是不同颜色` : '') +
        `（应写 var(--brand)）—— ${ctx.trim()}`
    )
  }
}

/* ── ② app.wxss 的 --brand 必须存在且等于 #0e7490 ───────────────────────── */
if (fs.existsSync(APP_WXSS)) {
  const code = stripComments(fs.readFileSync(APP_WXSS, 'utf8'), '.wxss')
  const m = code.match(/--brand\s*:\s*(#[0-9a-fA-F]{6})\s*;/)
  if (!m) {
    errs.push('app.wxss 没有声明 `--brand:#xxxxxx;` ')
  } else if (m[1].toLowerCase() !== BRAND) {
    errs.push(`app.wxss 的 --brand = ${m[1]}，应为 ${BRAND}`)
  }
  // 令牌不许改名/加档：只许一个 --brand
  const extra = [...code.matchAll(/(--brand[-a-z0-9]*)\s*:/g)].map((x) => x[1])
  const unexpected = extra.filter((n) => n !== '--brand')
  if (unexpected.length) {
    errs.push(`app.wxss 出现了额外的品牌令牌 ${unexpected.join(', ')} —— 品牌色只留一个档`)
  }
}

/* ── ③ 对比度：--brand 在各实际底色上 ≥ 4.5 ───────────────────────────── */
function lum(hex) {
  const h = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  const f = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
function ratio(a, b) {
  const la = lum(a)
  const lb = lum(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}
const BASES = [
  ['#ffffff', '白卡片'],
  ['#f5f5f7', '页面底'],
  ['#ecfeff', '浅青底（msg-bar / 标签）'],
  ['#f2f2f7', '灰底（+/− 按钮）'],
]
for (const [bg, label] of BASES) {
  const r = ratio(BRAND, bg)
  if (r < 4.5) errs.push(`${BRAND} 压在 ${bg}（${label}）只有 ${r.toFixed(2)}:1，低于 AA 4.5`)
  else notes.push(`${BRAND} on ${bg} = ${r.toFixed(2)}  ${label}`)
}
const onBrand = ratio('#ffffff', BRAND)
if (onBrand < 4.5) errs.push(`白字压在 ${BRAND} 只有 ${onBrand.toFixed(2)}:1，低于 AA 4.5`)
else notes.push(`#ffffff on ${BRAND} = ${onBrand.toFixed(2)}  实心底白字`)

/* ── ④ 原生载体逐项核对（吃不到 CSS 变量，最容易被漏） ─────────────────── */
function requireMatch(file, regex, what) {
  const p = path.join(MINI, file)
  if (!fs.existsSync(p)) return errs.push(`缺少 ${file}（${what}）`)
  const code = stripComments(fs.readFileSync(p, 'utf8'), path.extname(file))
  if (!regex.test(code)) errs.push(`${file} 的${what}不是 ${BRAND}`)
}
requireMatch('app.json', new RegExp(`"navigationBarBackgroundColor"\\s*:\\s*"${BRAND}"`, 'i'), '导航栏底色')
requireMatch('app.json', new RegExp(`"selectedColor"\\s*:\\s*"${BRAND}"`, 'i'), 'tabBar 选中色')
requireMatch('app.js', new RegExp(`confirmColor\\s*:\\s*['"]${BRAND}['"]`, 'i'), 'showModal confirmColor')
requireMatch(path.join('pages/fill/fill.js'), new RegExp(`confirmColor\\s*:\\s*['"]${BRAND}['"]`, 'i'), 'showModal confirmColor')
requireMatch(
  path.join('pages/privacy-settings/privacy-settings.wxml'),
  new RegExp(`<switch[^>]*\\bcolor\\s*=\\s*"${BRAND}"`, 'i'),
  '<switch color>'
)
notes.push('原生载体 5 处（json×2 / js×2 / switch）均等于 ' + BRAND)

/* ── ⑤ 选中态图标 PNG 每个可见像素必须等于 --brand ─────────────────────── */
/** 最小 PNG 解码：只支持 8bit、colorType 2(RGB)/6(RGBA)、非隔行 —— 本仓图标即此格式 */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG')
  let off = 8
  let w = 0
  let h = 0
  let ct = 0
  let bd = 0
  let interlace = 0
  const idat = []
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      w = data.readUInt32BE(0)
      h = data.readUInt32BE(4)
      bd = data[8]
      ct = data[9]
      interlace = data[12]
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    off += 12 + len
  }
  if (bd !== 8 || interlace !== 0 || (ct !== 2 && ct !== 6)) {
    throw new Error(`不支持的 PNG 格式 bitDepth=${bd} colorType=${ct} interlace=${interlace}`)
  }
  const bpp = ct === 6 ? 4 : 3
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = w * bpp
  const out = Buffer.alloc(h * stride)
  const paeth = (a, b, c) => {
    const p = a + b - c
    const pa = Math.abs(p - a)
    const pb = Math.abs(p - b)
    const pc = Math.abs(p - c)
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
  }
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)]
    const src = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride)
    const dst = out.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride)
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? dst[x - bpp] : 0
      const b = prev[x]
      const c = x >= bpp ? prev[x - bpp] : 0
      let v = src[x]
      if (ft === 1) v += a
      else if (ft === 2) v += b
      else if (ft === 3) v += (a + b) >> 1
      else if (ft === 4) v += paeth(a, b, c)
      dst[x] = v & 0xff
    }
  }
  return { w, h, bpp, data: out }
}

const ICONS = ['assets/tab-fill-active.png', 'assets/tab-mine-active.png']
const tb = [0x0e, 0x74, 0x90]
for (const relIcon of ICONS) {
  const p = path.join(MINI, relIcon)
  if (!fs.existsSync(p)) {
    errs.push(`缺少选中态图标 ${relIcon}`)
    continue
  }
  let img
  try {
    img = decodePng(fs.readFileSync(p))
  } catch (e) {
    errs.push(`${relIcon} 无法校验（${e.message}）—— 请人工确认图标颜色是 ${BRAND}`)
    continue
  }
  const bad = new Map()
  for (let i = 0; i < img.data.length; i += img.bpp) {
    const [r, g, b] = [img.data[i], img.data[i + 1], img.data[i + 2]]
    const a = img.bpp === 4 ? img.data[i + 3] : 255
    if (a < 128) continue // 半透明边缘不计
    if (r !== tb[0] || g !== tb[1] || b !== tb[2]) {
      const k = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b
        .toString(16)
        .padStart(2, '0')}`
      bad.set(k, (bad.get(k) || 0) + 1)
    }
  }
  if (bad.size) {
    const top = [...bad.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
    errs.push(
      `${relIcon} 的图标色不是 ${BRAND} —— 命中 ${top
        .map(([k, n]) => `${k}×${n}`)
        .join(', ')}（tabBar 文字色由 app.json 给，图标色藏在这张图里，必须同批改）`
    )
  } else {
    notes.push(`${relIcon} 全部可见像素 = ${BRAND}`)
  }
}

/* ── ⑥ 令牌被真正使用（只定义不用 = 空白支票） ─────────────────────────── */
let tokenUses = 0
for (const f of files) {
  if (path.extname(f) !== '.wxss') continue
  const code = stripComments(fs.readFileSync(f, 'utf8'), '.wxss')
  tokenUses += (code.match(/var\(--brand\)/g) || []).length
}
if (tokenUses < MIN_TOKEN_USES) {
  errs.push(
    `var(--brand) 只用了 ${tokenUses} 处，少于下限 ${MIN_TOKEN_USES} —— ` +
      `品牌色正在被绕过硬编码（要么是有人改回字面量，要么是页面被删了）`
  )
  notes.push(`var(--brand) 共 ${tokenUses} 处（下限 ${MIN_TOKEN_USES}）`)
} else {
  notes.push(`var(--brand) 共 ${tokenUses} 处（下限 ${MIN_TOKEN_USES}）`)
}

/* ── 输出 ──────────────────────────────────────────────────────────────── */
if (errs.length) {
  console.error(`\n✗ 小程序品牌色校验未通过：${errs.length} 条\n`)
  for (const e of errs) console.error('  · ' + e)
  console.error('')
  process.exit(1)
}
console.log('✓ 小程序品牌色校验通过（单一 --brand，无旧值残留）')
for (const n of notes) console.log('  · ' + n)
process.exit(0)
