/* v669 契约：列设置面板的两个缺陷不许回退。
 *
 * 为什么需要它（两条都是「看着对、真实鼠标必现」的隐性缺陷，改动一眼看不出坏）：
 *   ① **全屏遮挡**：`.col-menu` 挂在 `.cross-card` 里，而全屏层 `.grid-area.is-fs` 是
 *      `position:fixed;inset:0;z-index:var(--z-page-fs=1000)` ⇒ 面板的 z 只要低于 1000，
 *      全屏时就被整块白底盖住。生产实测（v668）`elementFromPoint` 三点全命中 `div.pname`。
 *      ⇒ z 必须取变量表的页面级浮层档（`--z-page-overlay/--z-page-menu`），遮罩与本体**成对**。
 *   ② **勾选态不同步**：`@click.prevent` + 单向 `:checked`。Chrome 的 pre-click activation
 *      会在派发 click 之前翻转 `checked`，`preventDefault()` 又让它在派发结束后**还原** ——
 *      这个还原发生在 Vue 的 patch 之后，而 patch 只在 vnode prop 变化时写 DOM ⇒ 永久反相，
 *      只有重开面板（v-if 重建节点）才对齐。真实鼠标必现，JS 的 `el.click()` 不现（探针曾因此漏判）。
 *      ⇒ 一律 `@change`（不 prevent）+ `nextTick` 按状态回写。
 *
 * 只扫模板区（HTML 注释先剥掉）：本仓已有三次「扫全文把注释里的示例当真」的误报。
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const CSS = path.join(ROOT, 'src/styles/col-menu.css')
const PANEL = path.join(ROOT, 'src/components/ColMenuPanel.vue')
const FC = path.join(ROOT, 'src/pages/Forecast.vue')

let failed = 0
const ok = (cond, label, extra = '') => {
  if (cond) console.log('  ✅ ' + label + (extra ? ' ' + extra : ''))
  else { console.log('  ❌ ' + label + (extra ? ' ' + extra : '')); failed++ }
}
const read = (p) => fs.readFileSync(p, 'utf8')
/** 剥掉 HTML 注释与 JS/CSS 块注释，只留"会真正执行"的内容 */
const strip = (s) => s
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')

/* ── ① 层级：面板与遮罩必须成对抬到页面级浮层档 ── */
console.log('① 层级：全屏层(1000) 之上')
{
  const css = strip(read(CSS))
  const ov = css.match(/\.col-menu-overlay\s*\{[^}]*z-index:\s*([^;}]+)/)
  const mn = css.match(/\.col-menu\s*\{[^}]*z-index:\s*([^;}]+)/)
  ok(!!ov && /var\(--z-page-overlay/.test(ov[1]), '遮罩取 --z-page-overlay', ov ? `(${ov[1].trim()})` : '(没找到)')
  ok(!!mn && /var\(--z-page-menu\b/.test(mn[1]), '面板取 --z-page-menu', mn ? `(${mn[1].trim()})` : '(没找到)')
  // 反例：旧的 --z-sticky 档（600+10/11）一旦回来，全屏必然被盖
  ok(!/calc\(var\(--z-sticky[^)]*\)\s*\+\s*1[01]\)/.test(css), '不再使用 --z-sticky 派生档')
  // 令牌本身必须高于全屏层（变量表若改档，这里会先炸）
  const vars = strip(read(path.join(ROOT, 'src/styles/variables.css')))
  const fsZ = Number((vars.match(/--z-page-fs:\s*(\d+)/) || [])[1])
  const menuZ = Number((vars.match(/--z-page-menu:\s*(\d+)/) || [])[1])
  const ovZ = Number((vars.match(/--z-page-overlay:\s*(\d+)/) || [])[1])
  ok(fsZ > 0 && menuZ > fsZ, `--z-page-menu(${menuZ}) > --z-page-fs(${fsZ})`)
  ok(fsZ > 0 && ovZ > fsZ, `--z-page-overlay(${ovZ}) > --z-page-fs(${fsZ})`)
  ok(menuZ > ovZ, `面板(${menuZ}) > 遮罩(${ovZ})（本体压在自己的遮罩上）`)
}

/* ── ② 复选框：不许回到 `@click.prevent` + 单向 :checked ── */
console.log('② 复选框：@change + 状态回写')
{
  const fc = strip(read(FC))
  const panel = strip(read(PANEL))
  // `@click.prevent="toggleCol(...)"` 是缺陷写法本身 —— 两个文件都不许再出现
  ok(!/@click\.prevent\s*=\s*"\s*toggleCol\s*\(/.test(fc), 'Forecast.vue 不再用 @click.prevent="toggleCol(...)"')
  ok(!/@click\.prevent\s*=\s*"\s*toggleCol\s*\(/.test(panel), 'ColMenuPanel.vue 不再用 @click.prevent="toggleCol(...)"')
  // 必须有 @change 入口，且数量与「列设置复选框」出现次数一致（查看态 + 改单态 = 2）
  const fcBoxes = [...fc.matchAll(/<input[^>]*type="checkbox"[^>]*colVis\[/g)].length
  const fcChange = [...fc.matchAll(/@change="onColCheck\(/g)].length
  ok(fcBoxes >= 2, 'Forecast.vue 里列设置复选框 ≥2 处（查看态 + 改单态）', `(${fcBoxes})`)
  ok(fcChange === fcBoxes, '每一处都挂 @change="onColCheck(...)"', `(${fcChange}/${fcBoxes})`)
  ok(/@change="onCheck\(/.test(panel), 'ColMenuPanel.vue 挂 @change="onCheck(...)"')
  // 回写必须真的写 DOM（否则「状态没变但 DOM 被浏览器翻过」的残余情况没人纠正）
  const fcWrite = fc.match(/function\s+onColCheck\s*\([^)]*\)\s*\{[\s\S]*?\n\}/)
  ok(!!fcWrite && /nextTick\(/.test(fcWrite[0]) && /\.checked\s*=/.test(fcWrite[0]),
    'Forecast.vue::onColCheck 在 nextTick 里回写 el.checked')
  const pWrite = panel.match(/function\s+onCheck\s*\([^)]*\)\s*\{[\s\S]*?\n\}/)
  ok(!!pWrite && /nextTick\(/.test(pWrite[0]) && /\.checked\s*=/.test(pWrite[0]),
    'ColMenuPanel.vue::onCheck 在 nextTick 里回写 el.checked')
  // 回写的值必须来自状态（colVis / isVisible），不能写死
  ok(!!fcWrite && /colVis\.value\[[^\]]+\]\s*!==\s*false/.test(fcWrite[0]), 'Forecast 回写值取自 colVis（不写死）')
  ok(!!pWrite && /isVisible\(/.test(pWrite[0]), 'ColMenuPanel 回写值取自 isVisible（不写死）')
}

/* ── ③ 全站扫描（v670 加）：v669 只查了 Forecast/ColMenuPanel 两个文件，
      结果 `InvPurchaseList.vue` 那份**自写面板**带着同一个缺陷活到了 v670。
      ⇒ 凡是"全站约定"，判据就必须扫全站，不能只扫基准实现。 ── */
console.log('③ 全站扫描（26 页齿轮 / 77 张序号表）')
{
  const files = []
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (['node_modules', 'dist', '.git'].includes(e.name)) continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.vue') || e.name.endsWith('.js')) files.push(p)
    }
  }
  walk(path.join(ROOT, 'src'))

  let clickPrevent = [], sizeMismatch = [], seqMismatch = [], numMissing = []
  for (const p of files) {
    const raw = read(p)
    const code = strip(raw)
    const rel = path.relative(ROOT, p)
    // ③-a 复选框缺陷写法（全站一律禁止）
    for (const m of code.matchAll(/@click\.prevent\s*=\s*"\s*(?:toggleCol|toggle)\s*\([^"]*\)/g)) {
      clickPrevent.push(rel + ':' + (code.slice(0, m.index).split('\n').length))
    }
    // ③-b 齿轮图标尺寸必须写 :size="15"（<Icon> 默认 16，不写就不一致）
    for (const m of code.matchAll(/<button[^>]*class="[^"]*\bcol-cfg\b[^"]*"[^>]*>\s*<Icon([^>]*)\/>/g)) {
      if (!/:size="15"/.test(m[1])) sizeMismatch.push(rel)
    }
    // ③-c 有 thead 且表体有 seq-cell ⇒ 表头必须有 seq-th（否则列数不等、整行右移）
    const hasThead = /<thead[\s>]/.test(code)
    const nTh = [...code.matchAll(/<th[^>]*\bseq-th\b/g)].length
    const nCell = [...code.matchAll(/<td[^>]*\bseq-cell\b/g)].length
    const nNum = [...code.matchAll(/\bseq-num\b/g)].length
    if (hasThead && nCell > 0 && nTh === 0) seqMismatch.push(rel)
    if (nCell > 0 && nNum < nCell) numMissing.push(rel)
  }
  ok(clickPrevent.length === 0, '全站零 @click.prevent="toggleCol(...)"', clickPrevent.length ? '→ ' + clickPrevent.join(', ') : '')
  ok(sizeMismatch.length === 0, '全站齿轮 <Icon> 一律 :size="15"', sizeMismatch.length ? '→ ' + sizeMismatch.join(', ') : '')
  ok(seqMismatch.length === 0, '有 thead 的表：表体有 seq-cell ⇒ 表头必有 seq-th', seqMismatch.length ? '→ ' + seqMismatch.join(', ') : '')
  ok(numMissing.length === 0, '序号一律包 .seq-num（等宽数字）', numMissing.length ? '→ ' + numMissing.join(', ') : '')
}

/* ── ④ 序号列样式：不许出现"第二真相源"并与全局同分靠顺序赢 ── */
console.log('④ 序号列样式的唯一源与权重')
{
  const cssFiles = []
  /* 🔴 只排除 `variables.css` 这一个文件 —— 它里面写的 `table.seq-host th.seq-th`(0,2,2)
     正是**唯一源本身**，不是"页面覆盖"，扫它必然假红（第一版踩过）。
     ⚠️ 别图省事把整个 `src/styles/` 排掉：`col-menu.css`（齿轮长相）也是"组件级实现"，
     `.col-gear-th{width:44px}` 那种死规则就藏在里面 —— 第二版整目录排除 ⇒ 那条判据恒绿、
     判别力为 0（注回自证时才发现）。 */
  const SKIP = new Set([path.join(ROOT, 'src/styles/variables.css')])
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (['node_modules', 'dist', '.git'].includes(e.name)) continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if ((e.name.endsWith('.vue') || e.name.endsWith('.css')) && !SKIP.has(p)) cssFiles.push(p)
    }
  }
  walk(path.join(ROOT, 'src'))

  const bad = []      // 与全局同分（0,2,2）靠加载顺序赢
  const dead = []     // 裸 .seq-* 或给宿主列另写 width
  for (const p of cssFiles) {
    const code = strip(read(p))
    const rel = path.relative(ROOT, p)
    for (const m of code.matchAll(/table\.(?!tbl\b)([A-Za-z0-9_-]+)\s+(?:th\.seq-th|td\.seq-cell)\s*\{/g)) {
      bad.push(`${rel}: table.${m[1]} ${m[0].match(/(th\.seq-th|td\.seq-cell)/)[0]}`)
    }
    // 裸 .seq-cell{...} / .col-gear-th{width:...} —— 恒被全局 (0,2,2) 压掉 ⇒ 死代码
    if (/^\s*\.seq-(th|cell|num)\s*\{/m.test(code)) dead.push(rel + ': 裸 .seq-* 规则')
    const gearTh = code.match(/\.col-gear-th\s*\{[^}]*\}/)
    if (gearTh && /(width|padding)\s*:/.test(gearTh[0])) dead.push(rel + ': .col-gear-th 里写了 width/padding')
  }
  ok(bad.length === 0, '私有序号样式已提权（选择器带 .tbl，不靠加载顺序）', bad.length ? '→ ' + bad.join(', ') : '')
  ok(dead.length === 0, '无"恒被压掉的死规则"（裸 .seq-* / .col-gear-th 写宽）', dead.length ? '→ ' + dead.join(', ') : '')
}

console.log(failed === 0 ? '\n  ALL PASS' : `\n  FAILED(${failed})`)
process.exit(failed === 0 ? 0 : 1)
