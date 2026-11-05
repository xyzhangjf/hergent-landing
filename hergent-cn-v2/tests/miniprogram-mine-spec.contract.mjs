/* ㊿ v777 契约：小程序「我的预报提交」展开明细不再显示商品规格。
 *
 * 用户口径（2026-11-05）：「请把小程序『我的预报提交』里的商品规格显示去掉」。
 *   范围只有**这一个页面的显示层**：`mine.wxml` 的 `.rec-item` 明细行由
 *   「商品名 + 规格 + 数量单位」改为「商品名 + 数量单位」。
 *
 * 🔴 两条最容易踩的反向破坏（本项目反复栽的族）：
 *   ① 顺手删数据层 —— `mine.js::copyRecord` 仍要把 `spec` 原样带回填报页，
 *      「复制 / 继续修改」打开的购物车/填报行靠规格确认「就是这一行」
 *      （fill.wxml 的 `.prod-spec` / `.cart-spec`）。删了它 = 显示去掉了，
 *      但复制功能静默丢规格，且编译与请求都不报错。
 *   ② 全仓粗暴替换 `spec` —— 填报页、汇总总表、隐私协议的规格都是**别的功能**，
 *      一个都不许动。隐私协议写「预报商品、规格、单位、数量」是因为服务端确实
 *      还在收集/返回该字段，不是残留文案。
 *
 * 🔴 判据写法纪律：
 *   · 必须剥掉 WXML/JS 注释再判结构 —— 本次源码注释里逐字写了 `spec`、
 *     `copyRecord`、`.prod-spec`，不剥会自撞成空白支票（v769 踩过）。
 *   · 「有没有」与「有几个」都要判（只查唯一不查存在 = 空白支票）。
 *   · 每个坏样本都必须至少判否一条，否则护栏只是「写了」而不是「被执行了」。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PROJ = path.resolve(ROOT, '..')
const MINI = path.join(PROJ, 'forecast-order-miniprogram-20260812T023419087Z/miniprogram')
const P = {
  mineWxml: path.join(MINI, 'pages/mine/mine.wxml'),
  mineJs: path.join(MINI, 'pages/mine/mine.js'),
  fillWxml: path.join(MINI, 'pages/fill/fill.wxml'),
  summaryWxml: path.join(MINI, 'pages/summary/summary.wxml'),
  legalWxml: path.join(MINI, 'pages/legal/privacy.wxml'),
}
const read = (p) => fs.readFileSync(p, 'utf8')
/* 把注释内容替换成等长空白，保留行号与位置，不破坏相对顺序判据。 */
const strip = (s, re) => s.replace(re, (m) => m.replace(/[^\n]/g, ' '))
const stripHtml = (s) => strip(s, /<!--[\s\S]*?-->/g)
const stripJs = (s) => strip(s, /\/\*[\s\S]*?\*\//g).replace(/^\s*\/\/.*$/gm, '')

function probe(src) {
  const w = stripHtml(src.mineWxml)
  const j = stripJs(src.mineJs)
  const fw = stripHtml(src.fillWxml)
  const sw = stripHtml(src.summaryWxml)
  const lw = stripHtml(src.legalWxml)
  const c = {}

  // ── A 显示层：恰好一行商品名、零个规格绑定 ────────────────────
  c['.it-name 恰好存在 1 个（商品名没被一起删）'] =
    (w.match(/<text class="it-name">/g) || []).length === 1
  c['.it-name 逐字只输出商品名'] =
    (w.match(/<text class="it-name">\{\{it\.product_name\}\}<\/text>/g) || []).length === 1
  c['mine.wxml 里规格绑定为 0（剥注释后的真代码）'] =
    !/\{\{\s*it\.spec|\{\{\s*item\.spec|wx:if="\{\{[^}]*spec/.test(w)
  c['规格没有靠 wx:for/hidden 藏在 DOM 里'] =
    !/\bspec\b/.test(w.slice(w.indexOf('class="rec-items"'), w.indexOf('class="rec-ft"')))
  c['明细行仍是「商品名｜数量单位」两段且顺序不变'] =
    /<view class="rec-item"[^>]*>\s*<text class="it-name">\{\{it\.product_name\}\}<\/text>\s*<text class="it-qty">\{\{it\.quantity\}\} \{\{it\.unit\}\}<\/text>/.test(w)
  c['.it-qty 原样保留（数量与单位不受影响）'] =
    (w.match(/<text class="it-qty">\{\{it\.quantity\}\} \{\{it\.unit\}\}<\/text>/g) || []).length === 1
  c['.rec-items 容器仍在（展开交互未被整段撤掉）'] =
    (w.match(/<view class="rec-items" wx:if="\{\{expandedId === item\.id\}\}"/g) || []).length === 1

  // ── B 数据层：复制 / 继续修改仍带规格 ──────────────────────────
  const iCopy = j.indexOf('copyRecord(e)')
  const iLogout = j.indexOf('logout()')
  const copyBlock = iCopy >= 0 ? j.slice(iCopy, iLogout > iCopy ? iLogout : undefined) : ''
  c['copyRecord 仍在（复制/继续修改入口未被撤）'] = iCopy >= 0
  c['copyRecord 的 items.map 仍逐字带 spec: it.spec'] =
    /spec:\s*it\.spec\s*\|\|\s*''/.test(copyBlock)
  c['copyRecord 仍带 product_id / unit / quantity（明细四个字段齐全）'] =
    /product_id:\s*it\.product_id/.test(copyBlock) &&
    /unit:\s*it\.unit\s*\|\|\s*'件'/.test(copyBlock) &&
    /quantity:\s*Number\(it\.quantity\)/.test(copyBlock)
  c['records map 仍是 ...r 展开（spec 能透传到明细）'] =
    /\.map\(\s*r\s*=>\s*\(\{\s*\.\.\.r/.test(j)

  // ── C 其它页面不许被全仓替换波及 ──────────────────────────────
  c['填报页 .prod-spec 仍在'] = /class="prod-spec"/.test(fw)
  c['填报页 .cart-spec 仍在'] = /class="cart-spec"/.test(fw)
  c['汇总总表 .pspec 仍在'] = /class="pspec"/.test(sw)
  c['隐私协议仍如实列出「规格」字段'] = /预报商品、规格、单位、数量/.test(lw)
  return c
}

let failed = 0
const ok = (cond, label, extra = '') => {
  if (cond) console.log('  ✅ ' + label + (extra ? ' ' + extra : ''))
  else { console.log('  ❌ ' + label + (extra ? ' ' + extra : '')); failed++ }
}

const SRC = Object.fromEntries(Object.entries(P).map(([k, p]) => [k, read(p)]))
const base = probe(SRC)
console.log('A–C. 源码三层判据（对照组：原样必须全绿）')
for (const [k, v] of Object.entries(base)) ok(v, k)
ok(Object.values(base).every(Boolean), '对照组全绿',
  `实测 ${Object.values(base).filter(Boolean).length}/${Object.values(base).length}`)

console.log('\nD. 坏样本自证（每个都必须至少判否一条，证明护栏不是空转）')
const bads = [
  ['把 {{it.spec}} 加回商品名（本次需求复发）', 'mineWxml', (s) => s.replace(
    '<text class="it-name">{{it.product_name}}</text>',
    '<text class="it-name">{{it.product_name}} {{it.spec}}</text>')],
  ['改成 {{it.spec || \'\'}} 变体（同样是显示规格）', 'mineWxml', (s) => s.replace(
    '<text class="it-name">{{it.product_name}}</text>',
    "<text class=\"it-name\">{{it.product_name}} {{it.spec || ''}}</text>")],
  ['另起一行塞规格（换标签也算显示）', 'mineWxml', (s) => s.replace(
    '<text class="it-qty">{{it.quantity}} {{it.unit}}</text>',
    '<text class="it-spec">{{it.spec}}</text>\n              <text class="it-qty">{{it.quantity}} {{it.unit}}</text>')],
  ['用 wx:if="{{false}}" 藏规格（DOM 还在，不是撤显示）', 'mineWxml', (s) => s.replace(
    '<text class="it-qty">{{it.quantity}} {{it.unit}}</text>',
    '<text wx:if="{{false}}">{{it.spec}}</text>\n              <text class="it-qty">{{it.quantity}} {{it.unit}}</text>')],
  ['连商品名一起删（过度删除）', 'mineWxml', (s) => s.replace(
    '<text class="it-name">{{it.product_name}}</text>', '')],
  ['连数量单位一起删（过度删除）', 'mineWxml', (s) => s.replace(
    '<text class="it-qty">{{it.quantity}} {{it.unit}}</text>', '')],
  ['整段撤掉展开明细（交互被撤）', 'mineWxml', (s) => s.replace(
    /<view class="rec-items" wx:if="\{\{expandedId === item\.id\}\}">[\s\S]*?<\/view>\s*<\/view>\s*<view class="rec-ft">/,
    '<view class="rec-ft">')],
  ['注释声称已去掉、代码没改（假修复：判据不许被注释骗过）', 'mineWxml', (s) => s.replace(
    '<text class="it-name">{{it.product_name}}</text>',
    '<text class="it-name">{{it.product_name}} {{it.spec}}</text>')
    .replace('不再显示规格', '已经彻底去掉规格') + '\n<!-- 规格已去掉 -->'],
  ['顺手删 copyRecord 的 spec（复制功能静默丢规格）', 'mineJs', (s) => s.replace(
    "spec: it.spec || '', ", '')],
  ['copyRecord 的 items.map 删掉（复制带不回明细）', 'mineJs', (s) => s.replace(
    /items: items\.map\(it => \(\{[\s\S]*?\}\)\),/, 'items: [],')],
  ['records 改成字段白名单（items/spec 全丢）', 'mineJs', (s) => s.replace(
    /const records = \(d\.records \|\| \[\]\)\.map\(r => \(\{ \.\.\.r,/,
    'const records = (d.records || []).map(r => ({ id: r.id,')],
  ['全仓替换：把填报页 .prod-spec 也删了', 'fillWxml', (s) => s.replace(
    /<view class="prod-spec">[^<]*<\/view>/, '')],
  ['全仓替换：把填报页购物车规格也删了', 'fillWxml', (s) => s.replace(
    /<view class="cart-spec">[^<]*<\/view>/, '')],
  ['全仓替换：把汇总总表 .pspec 也删了', 'summaryWxml', (s) => s.replace(
    /<view class="pspec">[^<]*<\/view>/, '')],
  ['顺手删隐私协议里的「规格」（与仍在收集字段不符）', 'legalWxml', (s) => s.replace(
    '预报商品、规格、单位、数量', '预报商品、单位、数量')],
]
for (const [label, key, mutate] of bads) {
  const src = { ...SRC, [key]: mutate(SRC[key]) }
  const changed = src[key] !== SRC[key]
  const p = probe(src)
  const reds = Object.entries(p).filter(([k, v]) => base[k] && !v).map(([k]) => k)
  ok(changed && reds.length > 0, label,
    reds.length ? `判否 ${reds.length} 条（${reds[0]}）` : '⚠️ 未检出')
}

console.log('\n' + (failed === 0 ? 'RESULT: ALL PASS' : `RESULT: FAILED (${failed})`))
process.exit(failed === 0 ? 0 : 1)
