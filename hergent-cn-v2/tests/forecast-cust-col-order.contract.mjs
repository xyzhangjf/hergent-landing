/* v739 契约：客户列（`cross.units`）整列拖动排序。
 *
 * 需求原话：「支持将某一报单人的整列拖拽到其他报单人所在列的前面或后面，并实现列的实时
 * 位置调整与顺序持久化」。
 *
 * 这一族缺陷的形态不是"某处写错"，而是**四件事中缺一件**：
 *   ① 加载时不按存下来的顺序排 ⇒ 拖完刷新就回去了（用户会连拖三次以为没生效）；
 *   ② 表尾合计按"列号算术"取 ⇒ 列一动，合计就挂到隔壁列（数还是数，谁也看不出来）；
 *   ③ 拖动没有阈值 / 没排除表头按钮 ⇒ 一次普通点击就把列搬走；
 *   ④ 落位没写偏好 ⇒ 当场看着对，刷新即还原。
 * 所以护栏钉的是这四条结构性约束，而不是"某一行代码长什么样"。
 *
 * 每条判据都带**坏样本自证** —— 只打印 ✅ 的护栏等于没有护栏。
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const PAGE = path.join(ROOT, 'src/pages/Forecast.vue')

let failed = 0
const ok = (cond, label, extra = '') => {
  if (cond) console.log('  ✅ ' + label + (extra ? ' ' + extra : ''))
  else { console.log('  ❌ ' + label + (extra ? ' ' + extra : '')); failed++ }
}

const src = fs.readFileSync(PAGE, 'utf8')

/** 剥注释：本文件注释里就写着 `footUnit((ci - 1) - visibleCols.length)` 这类旧写法，
 *  不剥就是假阳性（"改了"和"注释里提到改过"分不开）。 */
function stripComments (s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}
const code = stripComments(src)

/** 取函数体：从 `function name` 到下一个行首 `}`（本文件的函数都在行首收尾）。 */
function fnBody (name, text = code) {
  const re = new RegExp('function\\s+' + name + '\\s*\\([\\s\\S]*?\\n\\}', '')
  const m = text.match(re)
  return m ? m[0] : ''
}
/** 取 <style> 段（本页只有一处）。用 lastIndexOf，理由见 v738 契约的同一段注释。 */
function styleBody (text = code) {
  const i = text.lastIndexOf('<style')
  const j = text.lastIndexOf('</style>')
  return (i < 0 || j < i) ? '' : text.slice(text.indexOf('>', i) + 1, j)
}

/* ── ① 加载期就要应用（否则"拖完刷新就回去"） ───────────────────── */
console.log('① 顺序的读写通道')
ok(/const\s+units\s*=\s*orderedUnits\(/.test(code),
  'loadCross 里客户列名册经 orderedUnits()（唯一排序入口）')
ok(/function\s+orderedUnits\s*\(/.test(code), 'orderedUnits 已定义')
{
  const body = fnBody('_colCfg')
  ok(/cust\s*:\s*custOrder\.value/.test(body), '列配置里带 cust（顺序跟着 col-prefs 走）')
  // 坏样本自证：把 cust 从 cfg 里拿掉必须被判出来
  const bad = body.replace(/,\s*cust\s*:\s*custOrder\.value/, '')
  ok(!/cust\s*:\s*custOrder\.value/.test(bad), '坏样本：cfg 少了 cust 会被上一条抓出（不是恒真）')
}
{
  const body = fnBody('applySaved')
  ok(/Array\.isArray\(p\.cust\)/.test(body), 'applySaved 认得 p.cust')
  ok(/applyCustOrder\(\)/.test(body), 'applySaved 应用后立刻重排（云端配置晚到也生效）')
  ok(/typeof n === 'string'/.test(body), '只收字符串（存档被改坏时不至于整列消失）')
}

/* ── ② 表尾合计/取列：按名字，不许按列号算术 ─────────────────────── */
console.log('② 列定位：按名字而不是按列号')
ok(!/footUnit\(\(ci\s*-\s*1\)\s*-\s*visibleCols\.length\)/.test(code),
  '不再用 `(ci-1)-visibleCols.length` 反推客户列下标')
ok(/footUnitOf\(col\.key\)/.test(code), '表尾客户列走 footUnitOf(col.key)')
{
  const body = fnBody('unitIdxOf')
  ok(/findIndex\(u\s*=>\s*u\.name === name\)/.test(body), 'unitIdxOf 按 name 查找')
  // 坏样本自证：旧写法必须能被第一条判据识别
  const oldStyle = '{{ footUnit((ci - 1) - visibleCols.length) || \'\' }}'
  ok(/footUnit\(\(ci\s*-\s*1\)\s*-\s*visibleCols\.length\)/.test(oldStyle),
    '坏样本：旧的下标推算法会被上一条抓出')
}

/* ── ③ 触发：阈值 + 不抢改单态手势 + 不吞表头按钮 ────────────────── */
console.log('③ 触发条件')
{
  const body = fnBody('onCustHeadDown')
  ok(/if\s*\(editMode\.value\)\s*return/.test(body), '改单态不接管（那里 mousedown = 选整列）')
  ok(/col\.type\s*!==\s*'qty'/.test(body), '只对客户列生效（主档/合计列不参与）')
  ok(/closest\('button,\.col-resizer'\)/.test(body), '从漏斗/＋/改宽手柄按下时不接管')
  // 坏样本自证
  ok(!/if\s*\(editMode\.value\)\s*return/.test(body.replace(/if\s*\(editMode\.value\)\s*return/, '')),
    '坏样本：去掉 editMode 守卫会被上一条抓出')
}
ok(/Math\.abs\(e\.clientX - d\.x0\) < 5/.test(fnBody('_custMove')),
  '拖动阈值 5px（低于它算点击，不算搬列）')
ok(/@pointerdown="onCustHeadDown\(\$event, col\)"/.test(code), '表头绑定 pointerdown')
ok(/@keydown="onCustHeadKey\(\$event, col\)"/.test(code), '表头绑定键盘等价操作')
ok(/e\.altKey/.test(fnBody('onCustHeadKey')), 'Alt + ←/→ 换位（键盘/读屏可达）')

/* ── ④ 放置判定：只跟左右邻列中线比，一次一格 ────────────────────── */
console.log('④ 放置位置判定')
{
  const body = fnBody('_custDropIndexAt')
  ok(/r\.left \+ r\.width \/ 2/.test(body), '用邻列水平中线作为分界')
  ok(/return cur - 1/.test(body) && /return cur \+ 1/.test(body), '越过哪边就插到哪边（前/后）')
  ok(!/for\s*\(/.test(body), '不做全表扫描（拖动时每次 pointermove 都会调用）')
}

/* ── ⑤ 落位保存 + Esc 复位且不保存 ──────────────────────────────── */
console.log('⑤ 保存与取消')
{
  const body = fnBody('_custUp')
  ok(/custOrder\.value\s*=\s*cross\.value\.units\.map/.test(body), '松手时把当前顺序写成新偏好')
  ok(/_persistCols\(\)/.test(body), '写入列配置（localStorage + 云端）')
  ok(/colPrefs\.flush\(\)/.test(body), '立刻 flush（拖完就切页也不丢）')
}
{
  const body = fnBody('_custCancel')
  ok(cross_check_reset(body), 'Esc 按原名次复位（不是"清空顺序"）')
  ok(!/_persistCols\(\)/.test(body), 'Esc 取消**不写库**')
  // 坏样本自证：给取消加一次保存必须被抓出
  ok(/_persistCols\(\)/.test(body + '\n  _persistCols()'), '坏样本：取消里偷偷保存会被上一条抓出')
}
function cross_check_reset (body) {
  return /cross\.value\.units\s*=\s*back/.test(body) && /recomputeTotals\(\)/.test(body)
}

/* ── ⑥ 视觉反馈 ─────────────────────────────────────────────────── */
console.log('⑥ 视觉反馈')
{
  const css = styleBody()
  ok(/th\.cust-col\{[^}]*cursor:grab/.test(css), '客户列表头 grab 光标（提示"这列能拖"）')
  ok(/th\.is-drag-src\{/.test(css), '被拖列有独立高亮（半透明 + 青框）')
  ok(/body\.cust-col-dragging\{/.test(css), '拖动中整页 grabbing + 禁止选中')
  ok(/\.cust-drag-ghost\{/.test(css), '跟手胶囊样式存在')
  ok(/\.cust-drag-ghost\{[^}]*background:var\(--p-solid\)/.test(css),
    '胶囊底用 --p-solid（白字 ≥AA；`--p` 只有 2.43，不行）')
  ok(/touch-action:pan-y/.test(css), '触屏：横向手势留给拖动，纵向仍可滚动')
  // 坏样本自证：白字压在 --p 上必须被识别为违规
  const badCss = '.cust-drag-ghost{background:var(--p);color:#fff}'
  ok(!/background:var\(--p-solid\)/.test(badCss), '坏样本：胶囊底误用 --p 会被上一条抓出')
}

console.log('')
if (failed) { console.log('✗ 客户列拖动排序契约：' + failed + ' 条未通过'); process.exit(1) }
console.log('✓ 客户列拖动排序契约：全部通过')
