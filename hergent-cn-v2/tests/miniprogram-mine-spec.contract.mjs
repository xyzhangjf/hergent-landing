/* ㊿ v777 去规格 + v778 数量单位不折行：小程序「我的预报提交」展开明细行。
 *
 * 用户口径（2026-11-05）：
 *   v777「把『我的预报提交』里的商品规格显示去掉」；
 *   v778「商品名称过长需要换行时允许按原有方式换行，但后面的预报数量必须始终作为
 *         一个整体完整显示，数值与单位不得被拆到不同行（不能出现『24』和『瓶』
 *         分属两行）；不截断商品名称，兼容不同长度名称与不同位数数量」。
 *
 * 🔴 v778 根因（flex + 折行点两层）：
 *   `.rec-item` 是 flex 行，两个 `<text>` 都默认 `flex-shrink:1` ⇒ 长名称换行时
 *   右侧被压缩；旧绑定 `{{it.quantity}} {{it.unit}}` 中间的空格正是折行点，
 *   「24」与「瓶」因此在两行。修法须两层独立保险：
 *     ① wxml 去掉可折行空格（`{{it.quantity}}{{it.unit}}`）；
 *     ② wxss `.it-qty{flex:none;white-space:nowrap}` 不被压缩、不折行；
 *        `.it-name{flex:1;min-width:0}` 只占剩余宽度、按原方式换行、不截断。
 *   缺任一层仍可能在极端宽度下复发，故两层都要判。
 *
 * 🔴 三条最容易踩的反向破坏（本项目反复栽的族）：
 *   ① 顺手删数据层 —— `mine.js::copyRecord` 仍要把 `spec` 原样带回填报页，
 *      「复制 / 继续修改」靠规格确认「就是这一行」（fill.wxml `.prod-spec`/`.cart-spec`）。
 *   ② 全仓粗暴替换 `spec` —— 填报页、汇总总表、隐私协议的规格都是别的功能。
 *   ③ 为「不折行」把 `white-space:nowrap` / `text-overflow:ellipsis` 加到**名称**上
 *      —— 那会变成不换行或截断，违反「允许名称按原有方式换行、不截断」。
 *
 * 🔴 判据写法纪律：必须剥掉 WXML/WXSS/JS 注释再判结构（源码注释里逐字抄了
 *    `spec`、`.prod-spec`、`flex:none` 等反例，不剥会自撞成空白支票，v769/v776 踩过）；
 *    「有没有」与「有几个」都要判；每个坏样本必须至少判否一条。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PROJ = path.resolve(ROOT, '..')
const MINI = path.join(PROJ, 'forecast-order-miniprogram-20260812T023419087Z/miniprogram')
const P = {
  mineWxml: path.join(MINI, 'pages/mine/mine.wxml'),
  mineWxss: path.join(MINI, 'pages/mine/mine.wxss'),
  mineJs: path.join(MINI, 'pages/mine/mine.js'),
  fillWxml: path.join(MINI, 'pages/fill/fill.wxml'),
  summaryWxml: path.join(MINI, 'pages/summary/summary.wxml'),
  legalWxml: path.join(MINI, 'pages/legal/privacy.wxml'),
}
const read = (p) => fs.readFileSync(p, 'utf8')
/* 把注释内容替换成等长空白，保留行号与位置，不破坏相对顺序判据。 */
const strip = (s, re) => s.replace(re, (m) => m.replace(/[^\n]/g, ' '))
const stripHtml = (s) => strip(s, /<!--[\s\S]*?-->/g)
const stripCss = (s) => strip(s, /\/\*[\s\S]*?\*\//g)
const stripJs = (s) => strip(s, /\/\*[\s\S]*?\*\//g).replace(/^\s*\/\/.*$/gm, '')
const rule = (css, sel) => (css.match(new RegExp('\\' + sel + '\\s*\\{[^}]*\\}')) || [''])[0]

function probe(src) {
  const w = stripHtml(src.mineWxml)
  const x = stripCss(src.mineWxss)
  const j = stripJs(src.mineJs)
  const fw = stripHtml(src.fillWxml)
  const sw = stripHtml(src.summaryWxml)
  const lw = stripHtml(src.legalWxml)
  const itemRule = rule(x, '.rec-item')
  const nameRule = rule(x, '.it-name')
  const qtyRule = rule(x, '.it-qty')
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
    /<view class="rec-item"[^>]*>\s*<text class="it-name">\{\{it\.product_name\}\}<\/text>\s*<text class="it-qty">\{\{it\.quantity\}\}\{\{it\.unit\}\}<\/text>/.test(w)
  c['.it-qty 数量与单位连成整体（恰好 1 处）'] =
    (w.match(/<text class="it-qty">\{\{it\.quantity\}\}\{\{it\.unit\}\}<\/text>/g) || []).length === 1
  c['数量与单位之间没有可折行空格'] =
    !/\{\{it\.quantity\}\}\s+\{\{it\.unit\}\}/.test(w)
  c['.rec-items 容器仍在（展开交互未被整段撤掉）'] =
    (w.match(/<view class="rec-items" wx:if="\{\{expandedId === item\.id\}\}"/g) || []).length === 1

  // ── A2 换行：名称可换行不截断，数量整块不散 ───────────────────
  c['.rec-item 仍是原 flex 行容器（其它布局不动）'] =
    itemRule === '.rec-item{display:flex;justify-content:space-between;padding:8rpx 0;font-size:26rpx;color:#3a3a3c}'
  c['.rec-item 未开 flex-wrap（数量不会整块掉到下一行）'] = !/flex-wrap/.test(itemRule)
  c['.it-name 占剩余宽度且可收缩（flex:1 + min-width:0）'] =
    /flex:\s*1/.test(nameRule) && /min-width:\s*0/.test(nameRule)
  c['.it-name 未设不换行/截断（名称按原方式换行且不截断）'] =
    !/white-space:\s*nowrap|text-overflow|overflow:\s*hidden|line-clamp|word-break/.test(nameRule)
  c['.it-qty 不被 flex 压缩（flex:none）'] = /flex:\s*none/.test(qtyRule)
  c['.it-qty 不折行（white-space:nowrap）'] = /white-space:\s*nowrap/.test(qtyRule)
  c['.it-qty 保留原有配色与字重'] =
    /color:var\(--brand\)/.test(qtyRule) && /font-weight:500/.test(qtyRule)

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
console.log('A–C. 源码判据（对照组：原样必须全绿）')
for (const [k, v] of Object.entries(base)) ok(v, k)
ok(Object.values(base).every(Boolean), '对照组全绿',
  `实测 ${Object.values(base).filter(Boolean).length}/${Object.values(base).length}`)

const QTY = '<text class="it-qty">{{it.quantity}}{{it.unit}}</text>'
const NAME_RULE = '.it-name{flex:1;min-width:0}'
const QTY_RULE = '.it-qty{color:var(--brand);font-weight:500;flex:none;white-space:nowrap}'

console.log('\nD. 坏样本自证（每个都必须至少判否一条，证明护栏不是空转）')
const bads = [
  ['把 {{it.spec}} 加回商品名（v777 需求复发）', 'mineWxml', (s) => s.replace(
    '<text class="it-name">{{it.product_name}}</text>',
    '<text class="it-name">{{it.product_name}} {{it.spec}}</text>')],
  ['改成 {{it.spec || \'\'}} 变体（同样是显示规格）', 'mineWxml', (s) => s.replace(
    '<text class="it-name">{{it.product_name}}</text>',
    "<text class=\"it-name\">{{it.product_name}} {{it.spec || ''}}</text>")],
  ['另起一行塞规格（换标签也算显示）', 'mineWxml', (s) => s.replace(
    QTY, '<text class="it-spec">{{it.spec}}</text>\n              ' + QTY)],
  ['用 wx:if="{{false}}" 藏规格（DOM 还在，不是撤显示）', 'mineWxml', (s) => s.replace(
    QTY, '<text wx:if="{{false}}">{{it.spec}}</text>\n              ' + QTY)],
  ['连商品名一起删（过度删除）', 'mineWxml', (s) => s.replace(
    '<text class="it-name">{{it.product_name}}</text>', '')],
  ['连数量单位一起删（过度删除）', 'mineWxml', (s) => s.replace(QTY, '')],
  ['整段撤掉展开明细（交互被撤）', 'mineWxml', (s) => s.replace(
    /<view class="rec-items" wx:if="\{\{expandedId === item\.id\}\}">[\s\S]*?<\/view>\s*<\/view>\s*<view class="rec-ft">/,
    '<view class="rec-ft">')],
  ['注释声称已去掉、代码没改（假修复：判据不许被注释骗过）', 'mineWxml', (s) => s.replace(
    '<text class="it-name">{{it.product_name}}</text>',
    '<text class="it-name">{{it.product_name}} {{it.spec}}</text>')
    .replace('不再显示规格', '已经彻底去掉规格') + '\n<!-- 规格已去掉 -->'],
  // ── v778 换行专项 ────────────────────────────────────────────
  ['数量与单位之间加回空格（折行点复发）', 'mineWxml', (s) => s.replace(
    '{{it.quantity}}{{it.unit}}', '{{it.quantity}} {{it.unit}}')],
  ['把数量与单位拆成两个 text（又可被分别压缩）', 'mineWxml', (s) => s.replace(
    QTY, '<text class="it-qty">{{it.quantity}}</text><text class="it-qty">{{it.unit}}</text>')],
  ['删掉 .it-qty 的 flex:none（右侧又被压缩）', 'mineWxss', (s) => s.replace(
    QTY_RULE, '.it-qty{color:var(--brand);font-weight:500;white-space:nowrap}')],
  ['删掉 .it-qty 的 white-space:nowrap（第二层保险没了）', 'mineWxss', (s) => s.replace(
    QTY_RULE, '.it-qty{color:var(--brand);font-weight:500;flex:none}')],
  ['给名称加 white-space:nowrap（名称不再按原方式换行）', 'mineWxss', (s) => s.replace(
    NAME_RULE, '.it-name{flex:1;min-width:0;white-space:nowrap}')],
  ['给名称加 ellipsis 截断（商品名被截断）', 'mineWxss', (s) => s.replace(
    NAME_RULE, '.it-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}')],
  ['删掉名称的 min-width:0（flex 不肯收缩，反挤右侧）', 'mineWxss', (s) => s.replace(
    NAME_RULE, '.it-name{flex:1}')],
  ['删掉名称的 flex:1（名称不占剩余宽度）', 'mineWxss', (s) => s.replace(
    NAME_RULE, '.it-name{min-width:0}')],
  ['.rec-item 开 flex-wrap（数量整块掉到下一行）', 'mineWxss', (s) => s.replace(
    '.rec-item{display:flex;', '.rec-item{display:flex;flex-wrap:wrap;')],
  // ── 数据层 / 其它页面 ────────────────────────────────────────
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
