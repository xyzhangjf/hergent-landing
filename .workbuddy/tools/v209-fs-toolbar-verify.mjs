// v209 全屏态「改单 / 编辑组」进驻表格工具行 —— 离线不变量护栏
//
// 为什么必须有它：本次改动把**同一组控件写在了两处**（主工具栏一份、全屏表格工具行一份），
//   重复 = 漂移风险。人手改一处忘另一处，表现为「全屏下少一个按钮」——不报错、不难看、只是功能没了。
//   所以最有价值的一条断言是 C 段：**逐按钮比对两处必须完全同源**（事件 + title + 可见文本）。
//
// 做法：切片**真实源码**（不做复刻实现，避免守卫与源码漂移），只用正则/文本断言，不 exec Vue。
//
// 用法：node .workbuddy/tools/v209-fs-toolbar-verify.mjs
import fs from 'fs'

const SRC = '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/src/pages/Forecast.vue'
const ZOOM = '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/src/components/GridZoomCtl.vue'
const src = fs.readFileSync(SRC, 'utf8')
const zoom = fs.readFileSync(ZOOM, 'utf8')

let pass = 0
const fails = []
function ok(name, cond, extra) {
  if (cond) { pass++; return }
  fails.push(name + (extra ? '  → ' + extra : ''))
}
function eq(name, got, want) {
  ok(name, got === want, 'got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want))
}

/* ---------- 0. 基础：注释剥离（判据不能匹配到注释里的字） ---------- */
const stripComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '')
const tpl = stripComments(src.slice(src.indexOf('<template>'), src.lastIndexOf('</template>')))

/* ---------- 工具：按花括号配平抠出函数/块 ---------- */
function sliceBrace(text, needle) {
  const i = text.indexOf(needle)
  if (i < 0) throw new Error('找不到：' + needle)
  let d = 0
  for (let j = text.indexOf('{', i); j < text.length; j++) {
    if (text[j] === '{') d++
    else if (text[j] === '}') { d--; if (d === 0) return text.slice(i, j + 1) }
  }
  throw new Error('花括号不配平：' + needle)
}
/* 按标签配平抠出 <tag ...> ... </tag>（只处理同名标签的嵌套；本用途里足够） */
function sliceTag(text, startIdx, tag) {
  const open = new RegExp('<' + tag + '\\b', 'g')
  const close = new RegExp('</' + tag + '>', 'g')
  open.lastIndex = startIdx
  const first = open.exec(text)
  if (!first) throw new Error('找不到起始 <' + tag)
  let depth = 0
  let i = first.index
  while (i < text.length) {
    open.lastIndex = i + 1
    close.lastIndex = i + 1
    const no = open.exec(text)
    const nc = close.exec(text)
    if (!nc) throw new Error('标签不配平：' + tag)
    if (no && no.index < nc.index) { depth++; i = no.index }
    else {
      if (depth === 0) return text.slice(first.index, nc.index + nc[0].length)
      depth--
      i = nc.index
    }
  }
  throw new Error('标签不配平：' + tag)
}

/* ---------- 抠出两处编辑组 ---------- */
const TB_BLOCK_HEAD = '<div v-if="editMode && !fsRowHosting" class="tb-edit-group">'
const tbHeadIdx = tpl.indexOf(TB_BLOCK_HEAD)
ok('① 主工具栏编辑组存在且已加让位守卫', tbHeadIdx > 0)
const tbBlock = tbHeadIdx > 0 ? sliceTag(tpl, tbHeadIdx, 'div') : ''

const GRID_HEAD = '<div class="tb-edit-group">'
const gridHeadIdx = tpl.indexOf(GRID_HEAD)
ok('② 表格工具行编辑组存在', gridHeadIdx > 0)
const gridBlock = gridHeadIdx > 0 ? sliceTag(tpl, gridHeadIdx, 'div') : ''

/* 表格工具行那份必须被 <template v-if="fsRowHosting"> 包着 —— 取它前面最近的那个 template */
const before = tpl.slice(0, gridHeadIdx)
const lastTpl = before.lastIndexOf('<template v-if="fsRowHosting">')
ok('③ 表格工具行编辑组由 v-if="fsRowHosting" 守卫（全屏专属）',
   lastTpl > 0 && before.slice(lastTpl).indexOf('</template>') < 0)

/* ---------- 逐按钮提取签名（事件 | title | 可见文本） ---------- */
function sigs(block) {
  const out = []
  const re = /<button\b[\s\S]*?<\/button>/g
  let m
  while ((m = re.exec(block))) {
    const s = m[0]
    const click = (s.match(/@click="([^"]+)"/) || [])[1] || ''
    const title = (s.match(/\stitle="([^"]*)"/) || [])[1] || ''
    const dis = (s.match(/:disabled="([^"]*)"/) || [])[1] || ''
    const text = s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    out.push([click, dis, title, text].join(' | '))
  }
  return out
}
const sigTb = sigs(tbBlock)
const sigGrid = sigs(gridBlock)

ok('④ 两处编辑组按钮条数一致', sigTb.length > 0 && sigTb.length === sigGrid.length,
   '工具栏=' + sigTb.length + ' 表格行=' + sigGrid.length)
eq('⑤ 两处编辑组按钮**逐个同源**（@click + :disabled + title + 文本）',
   JSON.stringify(sigGrid), JSON.stringify(sigTb))
if (JSON.stringify(sigGrid) !== JSON.stringify(sigTb)) {
  sigTb.forEach((s, i) => { if (s !== sigGrid[i]) console.log('   差异#' + i + '\n     工具栏: ' + s + '\n     表格行: ' + sigGrid[i]) })
}
/* 期望的按钮序列（顺序也要一致） */
eq('⑥ 按钮顺序 = 取消/回退/查错/补录商品/保存',
   sigTb.map((s) => s.split(' | ')[0]).join(','),
   'exitEdit,undoToLastSaved,openErrList,addRow,saveEdits')

/* 状态条（.save-state）的类绑定与三态 title 必须一致 */
function saveStateSig(block) {
  const i = block.indexOf('class="save-state"')
  if (i < 0) return null
  const seg = block.slice(i, i + 700)
  return seg.replace(/<!--[\s\S]*?-->/g, '').replace(/\s+/g, ' ').trim()
}
eq('⑦ 两处「常驻保存状态」条同源', saveStateSig(gridBlock), saveStateSig(tbBlock))
ok('⑧ 保存状态条挂在编辑组内（不是游离在行里）',
   /class="tb-edit-group"[\s\S]*class="save-state"/.test(gridBlock))

/* ---------- 让位判据同源（最值钱的一条） ---------- */
const fsh = sliceBrace(src, 'const fsRowHosting = computed(')
ok('⑨ fsRowHosting 是 computed', /=\s*computed\(/.test(fsh))
ok('⑩ 判据含 gridFullscreen', /gridFullscreen\.value/.test(fsh))
ok('⑪ 判据含 viewMode === \'cross\'（逐单补录视图没有表格工具行）', /viewMode\.value\s*===\s*'cross'/.test(fsh))
ok('⑫ 🔴 判据含 !crossLoading（漏它 = 加载中整块被骨架替换 ⇒ 主工具栏与全屏行同时无入口 = 死按钮）',
   /!\s*crossLoading\.value/.test(fsh))

const btnEdit = tpl.indexOf('<Icon name="edit"/>')
ok('⑬ 主工具栏「改单」由 !editMode && !fsRowHosting 守卫',
   /v-if="!editMode && !fsRowHosting"/.test(tpl))
ok('⑭ 主工具栏编辑组由 editMode && !fsRowHosting 守卫',
   /v-if="editMode && !fsRowHosting"\s+class="tb-edit-group"/.test(tpl))
ok('⑮ 表格工具行内有「改单」入口（全屏专属）',
   /<template v-if="fsRowHosting">[\s\S]{0,600}@click="enterEdit"/.test(tpl))
ok('⑯ 「改单」入口仍带 role 提示与载入态（与工具栏版同源）',
   /@click="enterEdit"[\s\S]{0,80}|:disabled="loadingEdit"/.test(tpl) &&
   (tpl.match(/entryRoleWarn \? '当前角色（' \+ roleName\(bizRole\)/g) || []).length === 2)
ok('⑰ 编辑组里「保存」仍带失败重试态（btn-retry）',
   (tpl.match(/'btn-retry': !!saveFailed/g) || []).length === 2)

/* ---------- 紧凑化只作用于全屏 ---------- */
eq('⑱ 「另有 N 个」徽标只在全屏收成图标（两处）',
   (tpl.match(/:class="\{ 'badge-slim': gridFullscreen \}"/g) || []).length, 4)
eq('⑲ 行首装饰分隔条标记 tb-sep-lead（两处）',
   (tpl.match(/class="tb-sep tb-sep-lead"/g) || []).length, 2)
eq('⑳ 缩放控件传 compact=gridFullscreen（两处）',
   (tpl.match(/<GridZoomCtl v-model="gridZoom" :compact="gridFullscreen"\/>/g) || []).length, 2)
ok('㉑ 徽标紧凑时文案仍在 title 与 aria-label 里（信息不丢）',
   /:title="'另有 ' \+ hiddenByRowBase/.test(tpl) && /:aria-label="'另有 ' \+ hiddenByRowBase/.test(tpl) &&
   /:title="'已隐藏 ' \+ zeroReportCount/.test(tpl) && /:aria-label="'已隐藏 ' \+ zeroReportCount/.test(tpl))

/* ---------- CSS 不变量 ---------- */
const css = src.slice(src.lastIndexOf('</template>'))
const grab = (sel) => {
  const i = css.indexOf(sel)
  if (i < 0) return null
  const b = css.indexOf('{', i)
  const e = css.indexOf('}', b)
  return css.slice(b + 1, e).replace(/\s+/g, ' ').trim()
}
const gBase = grab('.tb-edit-group{')
const gToolbar = grab('.toolbar>.tb-edit-group{')
const gRow = grab('.grid-ctl-row>.tb-edit-group{')
const fsRow = grab('.grid-area.is-fs .grid-ctl-row{')
ok('㉒ .tb-edit-group 共用布局存在（display:flex + gap）',
   !!gBase && /display:\s*flex/.test(gBase) && /gap:/.test(gBase))
ok('㉓ 工具栏那份独占整行（flex:0 0 100%）仍在',
   !!gToolbar && /flex:\s*0\s+0\s+100%/.test(gToolbar))
ok('㉔ 🔴 表格工具行那份**不继承**独占整行（否则立刻强制折行）',
   !!gRow && !/flex:\s*0\s+0\s+100%/.test(gRow) && /flex:\s*0\s+0\s+auto/.test(gRow))
ok('㉕ 全屏表格工具行留出全屏按钮的位（padding-right）',
   !!fsRow && /padding-right/.test(fsRow), 'actual=' + fsRow)
ok('㉖ 全屏表格工具行收紧行距（gap:6px）', !!fsRow && /gap:\s*6px/.test(fsRow))
ok('㉗ 全屏隐藏行首装饰分隔条',
   /\.grid-area\.is-fs \.tb-sep-lead\s*\{\s*display\s*:\s*none/.test(css))
ok('㉘ 徽标紧凑类有定义', !!grab('.confirm-badge.badge-slim{'))
ok('㉙ 全屏编辑组再收一档（按钮横向内边距 12→9）',
   /\.grid-area\.is-fs \.grid-ctl-row>\.tb-edit-group>\.btn\{[^}]*padding-left:9px/.test(css))
/* 不引入横向滚动条：.grid-ctl-row 的规则里不得出现 overflow */
ok('㉚ 🔴 表格工具行不引入横向滚动（规则里无 overflow）',
   !/overflow/.test(grab('.grid-ctl-row{') || '') && !/overflow/.test(css.slice(css.indexOf('.grid-area.is-fs .grid-ctl-row{'), css.indexOf('.grid-area.is-fs .grid-ctl-row{') + 300)))

/* ---------- GridZoomCtl ---------- */
ok('㉛ GridZoomCtl 定义 compact prop（Boolean，默认 false）',
   /compact:\s*\{\s*type:\s*Boolean,\s*default:\s*false\s*\}/.test(zoom))
ok('㉜ compact 形态：隐藏「缩放」二字', /\.zoom-group\.zoom-compact \.zb-label\{display:none\}/.test(zoom))
ok('㉝ compact 形态：滑杆收窄（能力不丢，－/＋/重置仍在）',
   /\.zoom-group\.zoom-compact \.zb-range\{width:64px\}/.test(zoom))
ok('㉞ compact 仅由 prop 驱动（不写死在全屏媒体查询里）', /:class="\{ 'zoom-compact': compact \}"/.test(zoom))

/* ---------- 无重复 id（两份同时存在会撞 id） ---------- */
ok('㉟ 🔴 两处编辑组内均无 id=（否则两份同时存在会撞 id / 选错元素）',
   !/\bid="/.test(tbBlock) && !/\bid="/.test(gridBlock))

/* ---------- 回归：v207 合计箱三件套未被本次改动碰到 ---------- */
ok('㊱ v207 合计箱函数仍在（boxesOf / rowBoxes / boxMissing / fmtBox）',
   ['function boxesOf', 'function rowBoxes', 'function boxMissing', 'function fmtBox'].every((k) => src.includes(k)))

console.log('\n===== v209 全屏工具栏不变量护栏 =====')
console.log('两处编辑组按钮签名：')
sigTb.forEach((s, i) => console.log('   ' + (i + 1) + '. ' + s))
if (fails.length) {
  console.log('\n❌ 失败 ' + fails.length + ' 项 / 共 ' + (pass + fails.length) + ' 项')
  fails.forEach((f) => console.log('   · ' + f))
  process.exit(1)
}
console.log('\n✅ 全部通过：' + pass + ' 项断言')
