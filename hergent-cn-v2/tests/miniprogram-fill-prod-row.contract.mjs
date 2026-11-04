/* v760 契约：填报页商品行 —— 「条码展示」+「名称截断可展开」两条 UI 改进。
 *
 * 需求原话（2026-11-04）：
 *   ① 「在商品名称下方新增商品条码展示区域」
 *   ② 「商品名称默认在超出限定字数时以省略号代替，用户点击后展开显示完整名称」
 *   ③ 「不需要展示库存/日均，这样可以省一行」
 *
 * 🔴 先说清一个前提：省略号**本来就有**（`.prod-name` 一直是 nowrap+ellipsis）。
 *    真正的问题是被截得太狠且没有出口：可读宽 334rpx、30rpx 的字 ⇒ 一行约 11 字，
 *    而本期 187 个商品**中位数 22 字、89% 超过 11 字** ⇒ 几乎每行都看不清是什么商品，
 *    连「（2.6.10.14...）分开单独下单」这类操作要求也被整段吃掉。
 *
 * 判据（每条都配坏样本自证，"改了会不会红"必须验过才算数）：
 *   A. 条码：独立一行、空值不渲染、**整串不截断**、只走「档案→清单快照」两级。
 *   B. 截断：交给 CSS，**不按字数切字符串**（全角/半角混排按字数必错）。
 *   C. 展开：`nameMore` 由**字宽模型**判、短名不给箭头（假入口）、状态存实例 Set
 *      而不是商品对象（分页重建会冲掉）、搜索态自动展开并高亮命中词。
 *   D. 库存/日均那一行已撤（wxml 无活动节点），但 `_metaText()` 与样式保留 ⇒ 恢复只改一行。
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const PROJ = path.resolve(ROOT, '..')
const MINI = path.join(PROJ, 'forecast-order-miniprogram-20260812T023419087Z/miniprogram')
const FILL = path.join(MINI, 'pages/fill/fill.js')
const WXML = path.join(MINI, 'pages/fill/fill.wxml')
const WXSS = path.join(MINI, 'pages/fill/fill.wxss')

let failed = 0
const ok = (cond, label, extra = '') => {
  if (cond) console.log('  ✅ ' + label + (extra ? ' ' + extra : ''))
  else { console.log('  ❌ ' + label + (extra ? ' ' + extra : '')); failed++ }
}

const js = fs.readFileSync(FILL, 'utf8')
const raw = fs.readFileSync(WXML, 'utf8')
const wxml = raw.replace(/<!--[\s\S]*?-->/g, '')   // 注掉的节点不算渲染，也不算违规
const wxss = fs.readFileSync(WXSS, 'utf8')

/* 取某条 CSS 规则的全部声明文本（多条同名合并） */
const ruleOf = (sel) => (wxss.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^{]*\\{[^}]*\\}', 'g')) || []).join('\n')

console.log('A. 条码：独立一行、空值不渲染、整串不截断')
{
  const nodes = wxml.match(/<view[^>]*class="prod-code"[^>]*>/g) || []
  ok(nodes.length === 1, '模板里恰好 1 个条码节点', `实测 ${nodes.length}`)
  ok(/class="prod-code"[^>]*wx:if="\{\{item\.barcode\}\}"/.test(wxml),
    '条码节点 wx:if 绑 item.barcode（空串 = 真没有 ⇒ 不渲染，不留空行）')
  ok(/<view[^>]*class="prod-code"[^>]*>\{\{item\.barcode\}\}<\/view>/.test(wxml),
    '节点内容就是条码本身（不拼"条码""无"之类前缀，不占可读宽度）')

  // 坏样本：去掉 wx:if ⇒ 每个商品都留一行空白，187 行多出 187 个空洞
  const noIf = wxml.replace(/ (wx:if="\{\{item\.barcode\}\}")/, '')
  ok(!/class="prod-code"[^>]*wx:if="\{\{item\.barcode\}\}"/.test(noIf),
    '坏样本自证：去掉 wx:if 必须判否')

  ok(/barcode:\s*String\(it\.barcode \|\| ''\)\.trim\(\)/.test(js),
    'js 取的是 档案/清单快照 合并后的 it.barcode，并 trim')
  // 坏样本：退回中/大包装码 —— 实测本期无主码的 3 个商品连中/大码也没有（零收益），
  //   而退回时必须标注是哪个包装，标错反而让用户拿中箱码去对单瓶
  ok(!/barcode:\s*String\([^)]*medium_barcode/.test(js),
    '不退回中/大包装码（零收益且会比对错商品）')

  const codeCss = ruleOf('.prod-code')
  ok(/font-size:24rpx/.test(codeCss), '条码 24rpx —— 缩到 20rpx 的 13 位数字对着实物核不动')
  ok(/ui-monospace|Menlo|monospace/.test(codeCss), '等宽字体（数字对齐才方便逐位比对）')
  ok(/white-space:nowrap/.test(codeCss), '条码不换行')
  ok(!/text-overflow:ellipsis/.test(codeCss), '条码**不许**省略号截断（后 4 位是搜索用的，截了就废）')
  ok(/color:#8e8e93/.test(codeCss), '层级靠颜色降级（比规格 #86868b 再浅一档），不靠缩字号')
}

console.log('B. 截断交给 CSS，不按字数切字符串')
{
  const base = ruleOf('.prod-name')
  ok(/white-space:nowrap/.test(base) && /text-overflow:ellipsis/.test(base) && /overflow:hidden/.test(base),
    '基类仍是「单行 + 省略号」三件套')
  ok(!/it\.name\.slice\(|it\.name\.substr|it\.name\.substring/.test(js),
    'js 里没有对商品名做字符串截断（全角/半角混排按字数切必错）')

  const open = ruleOf('.prod-name-open')
  ok(/white-space:normal/.test(open), '展开态放开换行')
  ok(/overflow-wrap:anywhere/.test(open),
    '用 overflow-wrap 而不是 break-all：否则 `250g*24瓶` 会被切成 `250` + `g*24瓶`')
  ok(!/color:|font-size:|text-decoration/.test(open),
    '展开态不改颜色/字号/下划线（187 行满屏链接色会花，还像能点进详情）')

  // 坏样本：给展开态加链接色 ⇒ 视觉契约被破坏，必须判否
  const badOpen = open.replace('white-space:normal', 'white-space:normal;color:#0f766e')
  ok(/color:/.test(badOpen) && !/color:/.test(open), '坏样本自证：展开态一旦加链接色必须判否')
}

console.log('C. 展开：字宽判定 + 短名不给假入口 + 状态不挂在商品对象上')
{
  ok(/charCodeAt\(i\) < 128 \? 0\.56 : 1/.test(js),
    '`_nameUnits` 按字宽估（ASCII 0.56 / 其余 1），不是数 length')
  // 坏样本：退回「字数 > 11」—— 这正是当初被判死的写法
  const badUnits = js.replace(/charCodeAt\(i\) < 128 \? 0\.56 : 1/, '1')
    .replace(/this\._nameUnits\(s\) > 10\.2/, "String(s || '').length > 11")
  const byLength = (src) => /String\(s \|\| ''\)\.length > 11/.test(src)
  ok(!byLength(js) && byLength(badUnits), '坏样本自证：改回按字数判必须被检出')

  ok(/if \(!p \|\| !p\.nameMore\) return/.test(js),
    '`toggleName` 对「放得下」的名称直接 return（短名挂个点了没反应的箭头 = 假入口）')
  const badToggle = js.replace(/if \(!p \|\| !p\.nameMore\) return[^\n]*\n/, '')
  ok(/if \(!p \|\| !p\.nameMore\) return/.test(js) && !/if \(!p \|\| !p\.nameMore\) return/.test(badToggle),
    '坏样本自证：删掉早退必须判否')

  ok(/nmOpen:\s*!!_kw \|\| _open\.has\(String\(it\.id\)\)/.test(js),
    '展开状态读实例 Set（`_nmOpen`），且搜索态一律展开')
  ok(!/nmOpen:\s*it\.nmOpen/.test(js),
    '不从商品对象读展开状态 —— `loadProducts` 的 Object.assign 会把它整批冲掉')
  // 坏样本：改成读 item.nmOpen（"展开了一个、滚回来又收起来"的那个坑）
  const badState = js.replace(/nmOpen: !!_kw \|\| _open\.has\(String\(it\.id\)\)/, 'nmOpen: it.nmOpen')
  ok(!/nmOpen:\s*!!_kw/.test(badState), '坏样本自证：改成读商品对象必须判否')

  ok(/<text wx:for="\{\{item\.nameSegs\}\}"/.test(wxml), '名称按命中分段逐段渲染')
  ok(/seg\.hit \? 'nm-hit' : ''/.test(wxml) && /\.nm-hit\{/.test(wxss),
    '命中词有独立样式类（`.nm-hit`）')
  ok(/nameSegs: this\._nameSegs\(it\.name, _kw\)/.test(js),
    '分段用的是**本次查询的关键词**（不是上一次的，否则"搜新词、高亮停在旧词"）')

  // 箭头不能用字体字形（部分安卓机缺 ⌄/⌃ 会显示豆腐块）
  const chev = ruleOf('.nm-chev')
  ok(/::after/.test(chev) && /border-right:2rpx solid/.test(chev) && /rotate\(45deg\)/.test(chev),
    '箭头是 CSS 画的（border + rotate），不依赖字体字形')
  ok(/\.nm-chev-open::after\{[^}]*rotate\(-135deg\)/.test(wxss), '展开后箭头翻转（⌄ → ⌃）')
}

console.log('D. 库存/日均那一行已撤，但恢复路径只差一行')
{
  ok(!/<view[^>]*class="prod-meta"/.test(wxml), '模板里没有活动的 `.prod-meta` 节点（已注掉）')
  ok(/<!--\s*<view class="prod-meta">/.test(raw), '注掉的那行仍在（恢复只需取消注释）')
  ok(/_metaText\(it, hasMyWh\) \{/.test(js), '`_metaText()` 口径保留（本人仓/全公司库存/不拿 0 冒充）')
  ok(/\.prod-meta\{/.test(wxss), '`.prod-meta` 样式保留（删了它，恢复时那行会变成裸文字）')

  // 坏样本：把节点塞回活动区必须判否（即 `badBack` 里真能检出活动节点 ⇒ 上面那条会红）
  const badBack = raw.replace(/<!--\s*<view class="prod-meta">\{\{item\.metaText\}\}<\/view>\s*-->/, '<view class="prod-meta">{{item.metaText}}</view>')
  const activeIn = (t) => /<view[^>]*class="prod-meta"/.test(t.replace(/<!--[\s\S]*?-->/g, ''))
  ok(!activeIn(raw) && activeIn(badBack), '坏样本自证：节点被解除注释必须判否')
}

console.log('E. 行结构：名称行是 flex，箭头占固定宽度不被裁')
{
  ok(/<view class="prod-name-row">/.test(wxml), '名称被包在 `.prod-name-row` 里（名称 + 箭头同一行）')
  const row = ruleOf('.prod-name-row')
  ok(/display:flex/.test(row) && /align-items:flex-start/.test(row), '`.prod-name-row` 是 flex（箭头不被文字挤走）')
  ok(/flex:1;min-width:0/.test(ruleOf('.prod-name')), '名称 `flex:1;min-width:0`（不加 min-width:0 省略号不生效）')
  ok(/flex:0 0 auto/.test(ruleOf('.nm-chev')), '箭头固定宽度（不参与压缩）')

  // 轻量结构校验：标签开闭必须配平（新增了嵌套 text，配平错会整页白屏且编译不报错）
  const opens = (wxml.match(/<([a-zA-Z][\w-]*)(?:\s[^>]*?)?(?<!\s\/)>/g) || [])
    .map((t) => (t.match(/^<([a-zA-Z][\w-]*)/) || [])[1])
  const closes = (wxml.match(/<\/([a-zA-Z][\w-]*)>/g) || []).map((t) => t.replace(/<\/|>/g, ''))
  const cnt = (arr) => arr.reduce((m, k) => (m[k] = (m[k] || 0) + 1, m), {})
  const a = cnt(opens), b = cnt(closes)
  const bad = Object.keys({ ...a, ...b }).filter((k) => (a[k] || 0) !== (b[k] || 0))
  ok(bad.length === 0, 'wxml 标签配平', bad.length ? `不配平: ${bad.join(',')}` : '')
}

console.log('')
if (failed) { console.log(`❌ 失败 ${failed} 项`); process.exit(1) }
console.log('✅ v760 商品行契约全部通过')
