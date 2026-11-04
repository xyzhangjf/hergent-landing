/* v756 契约：**已关闭期次可改单（授权通道）+ 粘贴落点必须看得见**。
 *
 * 报障原话（2026-11-04，老板）：
 *   「主管目前还不适应直接在系统里改单，仍然需要把系统汇总的数据导到 Excel 表格里修改，
 *     改完后再粘贴回系统。目前存在两个问题：
 *     1. …部分单品要等到第二天才能下单，主管需要第二天根据库存情况修改报单，
 *        但此时该期次已经关闭，把 Excel 数据粘贴到已过期期次时保存按钮为灰色，完全无法保存；
 *     2. 粘贴完成后虽然能看到数据已进入系统，但整个反馈是静默的，
 *        视觉上无法感知数据粘贴到了哪个区域。」
 *
 * ── 问题 1 的根因（**不是"要不要放开权限"，是前端漏抄了同一份判据**）───────────────
 *   后端 v305 早就对 `SUMMARY_ROLES`（管理员/老板/主管/财务文员）在 save_matrix 里传
 *   `allow_closed=True` 并写留痕（`_closed_edit`）。前端 `periodLocked`（管"改单"入口）
 *   也早已对 `canEditClosedPeriod` 豁免 —— **只有保存这条链路上的三道闸没跟上**：
 *     ① `enterEdit` 里 `if (noOpenPeriod) return`
 *     ② `saveDisabled` 里 `noOpenPeriod || periodDeadlinePassed`（两条裸判据，无豁免）
 *     ③ `saveEdits` 里 `if (noOpenPeriod || !p.id) return`
 *   ⇒ 表现正是「进得去、粘得进、存不下」。
 *   🔴 判据：这三处都必须带 `!canEditClosedPeriod`（`!p.id` 那条**不豁免** —— 合成期次写下去
 *      就是 period_id=0 的孤儿行，v244 专门消灭过一批）。
 *
 * ── 问题 2 的根因（**不是没 toast，是 toast 说的不是"落在哪"**）────────────────────
 *   原实现只有 `已粘贴 8×5` 一条数字 toast，而这张表 286 行 × 三十来列客户 + 常配 50% 缩放
 *   ⇒ 落点常在视口外，用户只能自己数。修法三件套缺一不可：
 *     ① `markPasteLand` 给落点矩形打主色框（边界格描边 + 内部淡底）；
 *     ② toast 里给**人话坐标**（商品名 / 客户名，不是"第 137 行第 9 列"）；
 *     ③ `ensureRowsRendered` + `scrollRowIntoView` 把人带到落点（分批挂载下 td 可能还没渲染，
 *        不先撑开渲染窗口，高亮与滚动都是"什么也没发生"）。
 *   ⚠️ 三条粘贴路径都要覆盖：区块粘贴 `pasteRegion`、交叉表 `tryPasteCross`、
 *      单值铺满选区 `batchWrite`（v598 分支）—— 只修一条 = "有的粘贴有框、有的没有"。
 *
 * ── 本批真实踩到的坑（必须钉住，否则下次还会踩）──────────────────────────────────
 *   🔴 我新写了一个 `ensureRowsRendered(lastR)`，与 v666 已有的同名函数**撞名**。
 *      JS 函数声明提升 ⇒ 后定义者**静默覆盖**前者，编译不报错、行为却悄悄变了。
 *      判据：`function ensureRowsRendered` 在全文件**只能有 1 处**。
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const VUE = path.join(ROOT, 'src/pages/Forecast.vue')
const ROW = path.join(ROOT, 'src/components/forecast/ForecastRow.vue')

let failed = 0
const ok = (cond, label, extra = '') => {
  if (cond) console.log('  ✅ ' + label + (extra ? ' ' + extra : ''))
  else { console.log('  ❌ ' + label + (extra ? ' ' + extra : '')); failed++ }
}
const count = (s, re) => (s.match(re) || []).length

const vue = fs.readFileSync(VUE, 'utf8')
const row = fs.readFileSync(ROW, 'utf8')

/* ══════════════ A. 已关闭期次的三道闸：授权角色必须放行 ══════════════ */
console.log('\nA. 已关闭期次保存（v305 授权改单通道）')

// A1. saveDisabled 用 periodLocked（已含豁免），不是裸的两条
const saveDisabledLine = (vue.match(/const saveDisabled = computed\(\(\) =>[^\n]*\n(?:[^\n]*\n){0,4}/) || [''])[0]
ok(/periodLocked\.value/.test(saveDisabledLine),
  'saveDisabled 走 periodLocked（v305 豁免已在其中，不再裸判 periodDeadlinePassed）')
ok(/noOpenPeriod\.value && !canEditClosedPeriod\.value/.test(saveDisabledLine),
  'saveDisabled 的 noOpenPeriod 带 !canEditClosedPeriod 豁免')

// A2. enterEdit 的 noOpenPeriod 闸同样豁免
const enterEditSeg = (vue.match(/async function enterEdit\(\)[\s\S]{0,1400}/) || [''])[0]
ok(/noOpenPeriod\.value && !canEditClosedPeriod\.value/.test(enterEditSeg),
  'enterEdit 的「没有进行中期次」闸对授权角色放行（否则编辑态进不去）')
ok(!/if \(noOpenPeriod\.value\) \{/.test(enterEditSeg),
  '坏样本检查：enterEdit 里不再有裸 if (noOpenPeriod.value) 拦人')

// A3. saveEdits 首道守卫：noOpenPeriod 豁免，但 !p.id 一律拦
const saveSeg = (vue.match(/async function saveEdits\(opts = \{\}\)[\s\S]{0,3600}/) || [''])[0]
ok(/noOpenPeriod\.value && !canEditClosedPeriod\.value\) \|\| !Number\(p\.id \|\| 0\)/.test(saveSeg),
  'saveEdits 首道守卫 = (noOpenPeriod 且非授权) 或 合成期次(!p.id)；后者不豁免（v244 孤儿行防线）')

// A4. 保存按钮 tooltip 也不能还在说"不能存"
ok(!/saveGateHint \|\| \(periodDeadlinePassed \? lockHint/.test(vue),
  '三处保存按钮 tooltip 不再用 periodDeadlinePassed 直接套 lockHint（会告诉用户"无法修改"却又能点）')
ok(count(vue, /closedEditMode \? '本期次已关闭 · 你以管理者身份改单/g) >= 3,
  '保存/重试按钮 tooltip 写明「授权改单 + 留痕」', '（' + count(vue, /closedEditMode \? '本期次已关闭 · 你以管理者身份改单/g) + ' 处）')

/* ══════════════ B. 粘贴落点：三路覆盖 + 视觉 + 定位 ══════════════ */
console.log('\nB. 粘贴落点（三件套 + 三条路径）')

ok(/const pasteLand = ref\(\{ r0: -1/.test(vue), '存在落点矩形状态 pasteLand')
ok(/function markPasteLand \(r0, c0, r1, c1\)/.test(vue), '存在 markPasteLand（置位 + 定时清除）')
ok(/function pasteLandCls \(r, c\)[\s\S]{0,320}?edge/.test(vue),
  'pasteLandCls 区分「内部格」与「边界格」（边界才描边，否则一片格子各圈一道）')

// 三条路径都必须调 markPasteLand
const pasteRegionSeg = (vue.match(/function pasteRegion\(text\)[\s\S]*?\n\}/) || [''])[0]
ok(/markPasteLand\(sr, sc, _rEnd, _cEnd\)/.test(pasteRegionSeg), '区块粘贴 pasteRegion 标出落点')
const crossPasteSeg = (vue.match(/function tryPasteCross\(block\)[\s\S]*?\n\}/) || [''])[0]
ok(/markPasteLand\(_minR, _minC, _maxR, _maxC\)/.test(crossPasteSeg), '交叉表粘贴 tryPasteCross 标出包围盒')
const batchSeg = (vue.match(/function batchWrite\(val\)[\s\S]*?\n\}/) || [''])[0]
ok(/markPasteLand\(r0, c0, r1, c1\)/.test(batchSeg), '单值铺满选区 batchWrite 同样标落点（v598 分支）')

// 人话坐标
ok(/function pasteRowName \(r\)/.test(vue) && /function pasteColName \(c\)/.test(vue),
  '落点坐标用商品名/客户名（pasteRowName / pasteColName 单一实现，两处粘贴共用）')
ok((pasteRegionSeg.match(/pasteRowName/g) || []).length >= 2,
  'pasteRegion 的 toast 里带了落点名称（不只是 8×5 的数字）')

// 先撑渲染再滚（顺序敏感）
ok(/ensureRowsRendered\(_rEnd\)\s*\n\s*markPasteLand\(sr, sc, _rEnd, _cEnd\)\s*\n\s*scrollRowIntoView\(sr\)/.test(pasteRegionSeg),
  'pasteRegion 顺序正确：扩渲染 → 标落点 → 滚到眼前')

// CSS
ok(/:deep\(td\.paste-land\)/.test(vue) && /:deep\(td\.paste-land\.edge\)/.test(vue),
  'CSS 有 .paste-land（淡底）与 .paste-land.edge（描边）')
ok(/background-image:linear-gradient\(color-mix\(in srgb, var\(--p\) 14%/.test(vue),
  '落点淡底走 background-image（不用 background：会被选区/错误格的背景色顶掉）')

// 子组件接入
ok((row.match(/ctx\.pasteLandCls\(/g) || []).length >= 2,
  'ForecastRow 两处 td（主档列 + 数量列）都接上 pasteLandCls',
  '（' + count(row, /ctx\.pasteLandCls\(/g) + ' 处）')
ok(/pasteLand, pasteLandCls,/.test(vue), 'rowCtx 下发了 pasteLand / pasteLandCls（否则子组件读不到）')

/* ══════════════ C. 授权改单提示条（看得见，不只在 title 里）══════════════ */
console.log('\nC. 授权改单提示条')
ok(/<div v-if="closedEditMode" class="closed-edit-bar"/.test(vue),
  '改单态渲染 .closed-edit-bar 横幅（原来只在按钮 title 里说明，用户看不到）')
ok(/\.closed-edit-bar\{[\s\S]{0,420}?var\(--p\) 10%/.test(vue),
  '.closed-edit-bar 用主色淡底 + 左侧竖条（不用警示黄/错误红：这是"允许"，不是"出错"）')

/* ══════════════ D. 撞名自检（本批真实踩过的坑）══════════════ */
console.log('\nD. 防重复实现（本批真实踩坑）')
const dup = count(vue, /function ensureRowsRendered/g)
ok(dup === 1, 'function ensureRowsRendered 全文件只有 1 处定义（函数声明提升会静默覆盖，编译不报错）',
  '（实测 ' + dup + ' 处）')
ok(/ensureRowsRendered\(_maxR\)/.test(crossPasteSeg) && /ensureRowsRendered\(r1\)/.test(batchSeg),
  '另两条粘贴路径也复用了同一个 ensureRowsRendered（没有各写一份）')

/* ══════════════ E. 坏样本自证（证明护栏不是空转）══════════════ */
console.log('\nE. 坏样本自证')
{
  // E1：把 saveDisabled 的豁免删掉，A1 判据必须报红
  const bad = vue.replace(/\(noOpenPeriod\.value && !canEditClosedPeriod\.value\)\)/, '(noOpenPeriod.value))')
  const badLine = (bad.match(/const saveDisabled = computed\(\(\) =>[^\n]*\n(?:[^\n]*\n){0,4}/) || [''])[0]
  ok(!/noOpenPeriod\.value && !canEditClosedPeriod\.value/.test(badLine),
    '坏样本（saveDisabled 去掉授权豁免）能被判否')

  // E2：把 markPasteLand 调用删掉，B 段判据必须报红
  const bad2 = vue.replace(/markPasteLand\(sr, sc, _rEnd, _cEnd\)/, 'void 0')
  const bad2Seg = (bad2.match(/function pasteRegion\(text\)[\s\S]*?\n\}/) || [''])[0]
  ok(!/markPasteLand\(sr, sc, _rEnd, _cEnd\)/.test(bad2Seg),
    '坏样本（pasteRegion 不标落点）能被判否')

  // E3：把子组件的 pasteLandCls 删掉，判据必须报红
  const bad3 = row.replace(/ctx\.pasteLandCls\(/g, '(()=>\'\')(')
  ok((bad3.match(/ctx\.pasteLandCls\(/g) || []).length < 2,
    '坏样本（ForecastRow 不接落点类）能被判否')

  // E4：再造一个同名函数，D 段判据必须报红
  const bad4 = vue + '\nfunction ensureRowsRendered(x) { return x }\n'
  ok(count(bad4, /function ensureRowsRendered/g) !== 1,
    '坏样本（重复定义 ensureRowsRendered）能被判否')
}

console.log('')
if (failed) { console.log(`❌ v756 契约：${failed} 项未通过`); process.exit(1) }
console.log('✅ v756 契约：全部通过')
