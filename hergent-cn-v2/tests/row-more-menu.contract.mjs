/**
 * v678 行内「更多操作（⋯）」菜单 + 列表操作列「单行不溢出」契约
 * ===========================================================================
 * 为什么需要这一组：
 *   采购单列表的「关联 / 操作」两列原先把 6 个按钮 + 3 个链接全靠 `flex-wrap` 挤成两行
 *   ⇒ 行高从 32.8px 涨到 43~48.6px，一屏少看三行（密度骤降）。
 *   修复 = 不常用动作收进共享件 `RowMoreMenu`（Teleport 到 body 的下拉），常用动作留在外面单行。
 *
 *   这类约定最典型的死法（v629 起反复踩）：
 *   ① 下拉忘了 `Teleport to="body"` + `position:fixed` ⇒ 被表格/卡片的 `overflow:hidden`
 *      静默裁掉（零报错，但菜单点出来只有半截）；
 *   ② 把 `.ipl-op` 的 `flex-wrap:nowrap` 回退成 `wrap` ⇒ 问题复发且隐蔽（行高悄悄涨）；
 *   ③ `INLINE_MAX` / `NO_ACT` 被改坏 ⇒ 模板 `rowActMap[r.id] || NO_ACT` 取不到 `.inline` 直接炸。
 *   ⇒ 必须静态钉住，且每条关键断言都带"已知坏样本"自证判别力（注回缺陷要能抓红）。
 *
 * 静态扫描纪律（踩过）：
 *   · 断言前先剥 HTML 注释（注释里写着"不要 flex-wrap"会被当成违规命中）。
 *   · 本机 shell 的 `grep "A\|B"` 会静默失效 ⇒ 一律用 Node 正则，不用 shell。
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(process.cwd())
const SRC = path.join(ROOT, 'src')
const rel = (p) => p.slice(ROOT.length + 1)

let pass = 0
let failed = 0
function ok (cond, label, extra) {
  if (cond) { pass++; console.log('     ✅ ' + label) }
  else { failed++; console.log('     ❌ ' + label + (extra ? '  → ' + extra : '')) }
}
/** 剥掉 HTML 注释（等长替换保行号）*/
const stripComments = (s) => s.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
const read = (p) => fs.readFileSync(p, 'utf8')

/* ── 判别力自证框架 ───────────────────────────────────────────────
   每条关键断言 = 一个 detector(source) -> bool。
   对真实文件跑必须 PASS；对"已知坏样本"跑必须 FAIL。
   两者都满足才说明这条断言不是空过（v629 同族教训：注回缺陷要能抓红）。 */
function prove (name, detector, goodSample, badSamples) {
  const goodPass = detector(goodSample)
  ok(goodPass, `【自证】${name}：真实样本应判过`)
  let allBadCaught = true
  const missed = []
  for (const [label, bad] of badSamples) {
    if (detector(bad)) { allBadCaught = false; missed.push(label) }
  }
  ok(allBadCaught, `【自证】${name}：已知坏样本必须判红${missed.length ? '（漏抓: ' + missed.join(',') + '）' : ''}`)
}

console.log('\n【1】RowMoreMenu 共享件：Teleport+fixed / 单根 / 开合关闭')
{
  const COMP = path.join(SRC, 'components/RowMoreMenu.vue')
  ok(fs.existsSync(COMP), 'components/RowMoreMenu.vue 存在')
  const c = stripComments(read(COMP))

  /* 🔴 下拉必须 Teleport 到 body + position:fixed：否则被 `overflow:hidden` 裁掉 */
  const detTeleportFixed = (s) =>
    /Teleport to="body"/.test(s) && /\.row-more-pop[\s\S]*?position:\s*fixed/.test(s)
  prove('Teleport+fixed', detTeleportFixed, c, [
    ['缺 Teleport', c.replace(/<Teleport to="body">/, '')],
    ['缺 position:fixed', c.replace(/position:\s*fixed/, 'position: absolute')],
  ])
  ok(detTeleportFixed(c), '真实件：Teleport to body + .row-more-pop position:fixed')

  /* 🔴 单一根节点：本件在 `.ipl-op` 的 flex 行里，多根（Fragment）会让父级 class 静默丢失 */
  const detSingleRoot = (s) => /<template>\s*<span class="row-more">/.test(s) && /<\/span>\s*<\/template>/.test(s)
  prove('单根节点', detSingleRoot, c, [
    ['多根（Fragment 包两个根）', '<template>\n  <div>a</div>\n  <div>b</div>\n</template>'],
  ])
  ok(detSingleRoot(c), '真实件：<template> 以单根 <span class="row-more"> 起、</span> 止')

  /* 🔴 开合 + 点击空白关闭 + Esc 关闭：少一个就是"菜单关不掉"的死控件 */
  const detClose = (s) =>
    /@click\.stop="toggle"/.test(s) &&
    /document\.addEventListener\('mousedown'[\s\S]*?onDocDown/.test(s) &&
    /'Escape'/.test(s)
  prove('开合与关闭', detClose, c, [
    ['删点击空白监听', c.replace(/document\.addEventListener\('mousedown'[\s\S]*?window\.addEventListener\('scroll'/, '')],
    ['删 Esc', c.replace(/function onKey[\s\S]*?close\(\)\s*\}/, '')],
  ])
  ok(detClose(c), '真实件：toggle + mousedown 空白关闭 + Escape 关闭')

  /* 🔴 点击菜单项后自动收起并 emit pick（动作由宿主页执行，本件只管开合） */
  ok(/emit\('pick'/.test(c) && /function pick/.test(c), '真实件：pick 时 emit(\'pick\') + 自动 close')
}

console.log('\n【2】InvPurchaseList 接入共享件 + inline/more 拆分')
{
  const F = path.join(SRC, 'pages/inventory/InvPurchaseList.vue')
  const s = stripComments(read(F))

  ok(/import RowMoreMenu from '\.\.\/\.\.\/components\/RowMoreMenu\.vue'/.test(s), '已 import RowMoreMenu')
  ok(/<RowMoreMenu[\s\S]*?:items="\(rowActMap\[r\.id\] \|\| NO_ACT\)\.more"/.test(s),
    '模板用 <RowMoreMenu :items="(rowActMap[r.id] || NO_ACT).more">')
  ok(/@pick="k => onRowAction\(k, r\)"/.test(s), '菜单项点击统一走 onRowAction（与外面按钮同一分发）')

  /* 🔴 INLINE_MAX=2：外面最多 2 个主操作，其余进 ⋯（改大就退化成原问题） */
  const detInlineMax = (x) => /const INLINE_MAX = 2/.test(x)
  prove('INLINE_MAX=2', detInlineMax, s, [
    ['改回 5', s.replace(/const INLINE_MAX = 2/, 'const INLINE_MAX = 5')],
    ['删常量', s.replace(/const INLINE_MAX = 2/, '')],
  ])
  ok(detInlineMax(s), '真实件：INLINE_MAX = 2')

  /* 🔴 NO_ACT 双空：模板 `|| NO_ACT` 兜底，若没有 .inline/.more 字段会直接 undefined.xxx 炸 */
  const detNoAct = (x) => /NO_ACT = \{\s*inline: \[\],\s*more: \[\]\s*\}/.test(x)
  prove('NO_ACT 双空', detNoAct, s, [
    ['缺 more', s.replace(/NO_ACT = \{\s*inline: \[\],\s*more: \[\]\s*\}/, 'NO_ACT = { inline: [] }')],
  ])
  ok(detNoAct(s), '真实件：NO_ACT = { inline: [], more: [] }')

  /* 拆分判据：rank<=3 且未达上限进 inline，其余进 more；more 内危险项排最后（防呆） */
  ok(/\(a\.rank <= 3 && inline\.length < INLINE_MAX \? inline : more\)\.push\(a\)/.test(s),
    'rowActions：rank≤3 且未满上限→inline，其余→more')
  ok(/\.sort\(\(a, b\) => \(a\.danger \? 1 : 0\) - \(b\.danger \? 1 : 0\)\)/.test(s),
    'more 内危险项（取消）排到最后（手指滑一下不会点到）')
}

console.log('\n【3】单行不溢出（核心可观测性）：nowrap + 按最不利密度算列宽')
{
  const F = path.join(SRC, 'pages/inventory/InvPurchaseList.vue')
  const s = stripComments(read(F))

  /* 🔴 两个操作容器必须 nowrap：真挤不下时暴露（横向溢出）而不是偷偷换行涨行高 */
  const detOpNowrap = (x) => /\.ipl-op \{[^}]*flex-wrap: nowrap/.test(x)
  const detRelNowrap = (x) => /\.ipl-rel \{[^}]*flex-wrap: nowrap/.test(x)
  prove('.ipl-op nowrap', detOpNowrap, s, [
    ['回退 wrap', s.replace(/\.ipl-op \{ display: flex; flex-wrap: nowrap/, '.ipl-op { display: flex; flex-wrap: wrap')],
  ])
  prove('.ipl-rel nowrap', detRelNowrap, s, [
    ['回退 wrap', s.replace(/\.ipl-rel \{ display: inline-flex; flex-wrap: nowrap/, '.ipl-rel { display: inline-flex; flex-wrap: wrap')],
  ])
  ok(detOpNowrap(s) && detRelNowrap(s), '真实件：.ipl-op / .ipl-rel 均 flex-wrap:nowrap')

  /* 🔴 td 级 white-space:nowrap（双保险，文字不折行） */
  ok(/\.ipl-tbl td\.ipl-c-op \{ white-space: nowrap/.test(s), '真实件：td.ipl-c-op white-space:nowrap')
  ok(/\.ipl-tbl td\.ipl-c-rel \{ white-space: nowrap/.test(s), '真实件：td.ipl-c-rel white-space:nowrap')

  /* 🔴 列宽按"最不利（宽松）密度"核算：宽松 padding 10px 14px ⇒ 内容宽 = 列宽 − 28。
     首版按紧凑档（−16）定了 124 ⇒ 宽松档差 3px 被 overflow:hidden 静默裁半个 ⋯。
     这里钉死 OP_W=128 / REL_W=96（与源码注释里的核算一致）。 */
  const detOPW = (x) => /const OP_W = 128/.test(x)
  const detRELW = (x) => /const REL_W = 96/.test(x)
  prove('OP_W=128（宽松密度核算）', detOPW, s, [
    ['回退 124', s.replace(/const OP_W = 128/, 'const OP_W = 124')],
    ['改 100', s.replace(/const OP_W = 128/, 'const OP_W = 100')],
  ])
  prove('REL_W=96（退货移出后两链接）', detRELW, s, [
    ['回退 108', s.replace(/const REL_W = 96/, 'const REL_W = 108')],
  ])
  ok(detOPW(s) && detRELW(s), '真实件：OP_W=128 / REL_W=96（宽松密度核算，不回退紧凑档数值）')
}

console.log('\n【4】全站其余列表页不得出现同类折行涨行高（复核 v678 全站排查结论）')
{
  /* v678 全站排查结论：除采购单外，其余列表页行内操作单元格均为 white-space:nowrap
     且最多 2~3 个按钮（或按状态互斥只有 1 个），不存在 flex-wrap 涨行高。
     注意区分「行内单元格」与「页面级工具条」：DeliveryOrder/FundsDoc/Promotions/AlertRules
     的 `.dvo-acts`/`.fd-acts`/`.pm-acts`/`.ar-acts` 是**页面顶部工具条**（常驻、不怕换行），
     真正的行内单元格是 `.dvo-op-cell`/`.fd-op`/`.pm-op`/`.ar-op`（均 white-space:nowrap、
     内部按钮直接平铺、不套 flex-wrap 容器）。这里只校验行内单元格与其内部 flex 容器。 */
  // 每个文件：cell = 行内操作单元格类名（必须 white-space:nowrap）；flex = 行内 flex 容器（若有，不得 flex-wrap:wrap）
  const cases = [
    { f: 'pages/inventory/InvPurchaseList.vue', cell: ['ipl-c-op', 'ipl-c-rel'], flex: ['ipl-op', 'ipl-rel'] },
    { f: 'pages/inventory/InvSaleList.vue', cell: ['isl-op'], flex: ['isl-ops'] },
    { f: 'pages/inventory/InvTransferList.vue', cell: ['isl-op'], flex: ['isl-ops'] },
    { f: 'pages/wh/DeliveryOrder.vue', cell: ['dvo-op-cell'], flex: [] },
    { f: 'pages/funds/FundsDoc.vue', cell: ['fd-op'], flex: [] },
    { f: 'pages/BrandArchive.vue', cell: ['ba-ops'], flex: [] },
    { f: 'pages/EmployeeArchive.vue', cell: ['df-ops'], flex: [] },
    { f: 'pages/ReportMapping.vue', cell: ['ops'], flex: [] },
    { f: 'pages/mkt/Promotions.vue', cell: ['pm-op'], flex: [] },
    { f: 'pages/AlertRules.vue', cell: ['ar-op'], flex: [] },
  ]
  let violations = 0
  for (const c of cases) {
    const p = path.join(SRC, c.f)
    if (!fs.existsSync(p)) continue
    const s = stripComments(read(p))
    // ① 行内单元格必须 white-space:nowrap（兜底，防文字折行涨行高）
    const cellRe = new RegExp('\\.(' + c.cell.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\s*\\{[^}]*white-space:\\s*nowrap')
    if (!cellRe.test(s)) { violations++; console.log('     ❌ ' + rel(p) + ' → 行内操作单元格缺少 white-space:nowrap') }
    // ② 行内 flex 容器不得 flex-wrap:wrap（出现即原问题回归）
    for (const cls of c.flex) {
      const re = new RegExp(cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{[^}]*flex-wrap:\\s*wrap')
      if (re.test(s)) { violations++; console.log('     ❌ ' + rel(p) + ' → ' + cls + ' 仍有 flex-wrap:wrap') }
    }
  }
  ok(violations === 0, `全站行内操作单元格无折行涨行高回归（实测 ${violations} 处违规）`)
}

console.log(failed === 0 ? '\n  ALL PASS' : `\n  FAILED(${failed})`)
process.exit(failed === 0 ? 0 : 1)
