/* v738 契约：冻结列的行底色必须跟着行走，不许自己写死一层白底。
 *
 * 为什么需要它 —— 用户原话：「预报订单汇总表里，前面三列『序号/商品名称/到货周期』没有跟后面
 * 的列一样，行与行之间的背景色是深浅交替的」。
 * 根因不是斑马纹没画上，而是**画在了被盖住的地方**：斑马纹是 `<tr>` 的背景，而冻结列为了
 * 遮住横向滚过来的内容，自己在 `td` 上刷了一层**不透明白底** ⇒ 行底色被整块盖掉。
 * 实测（同一 zebra 行，浅色）：tr=#f5f5f7，前三格=#ffffff，第四格起=#f5f5f7。
 *
 * 这类缺陷的特点：**任何单点检查都看不出来**。斑马纹规则写得好好的、冻结列规则也"必要"，
 * 谁都没错，只有把两者放在同一行里量实际渲染色才暴露。所以护栏钉的不是"某条规则对不对"，
 * 而是这条结构约束：
 *   ① 冻结列（.frozen / .seq-cell）的体规则必须读 `--row-bg`（兜底 `var(--bg)`）；
 *   ② 冻结列规则里**不许**出现写死的 `var(--bg)` / `#fff` / `white`；
 *   ③ 每条给表体行上底色的规则，必须**同时**下发 `--row-bg`（否则冻结列又脱节）。
 *
 * 每条判据都带坏样本自证 —— 只会打印 ✅ 的护栏等于没有护栏。
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

/** 剥注释：注释里写过 `background:var(--bg)` 的示例，扫进去就是假阳性 */
export function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/** 取 <style> 段落。
 *  ⚠️ 必须用 **lastIndexOf**：本文件正文注释里出现过字面量 `<style>。` 与拼装打印用的
 *  `'<style>' + PRINT_CSS`，`indexOf` 会从注释里切一刀，切出来的"样式"根本不含规则
 *  ⇒ 所有判据拿到空数组、护栏全绿（假绿灯）。 */
export function styleBody(src) {
  const s = stripComments(src)
  const i = s.lastIndexOf('<style')
  const j = s.lastIndexOf('</style>')
  if (i < 0 || j < i) return ''
  return s.slice(s.indexOf('>', i) + 1, j)
}

/** 把样式拆成 [{sel, body}]。@media 外层头会被跳过，只取里面真带声明的规则。 */
export function rules(css) {
  const out = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(css))) {
    const sel = m[1].trim().replace(/\s+/g, ' ')
    if (!sel || sel.startsWith('@')) continue
    out.push({ sel, body: m[2] })
  }
  return out
}

const isStickyCol = (sel) => /\.frozen\b|\.seq-cell\b|\.seq-th\b/.test(sel)

/** 取某条规则里的 background 简写值（不含 background-image / -color 的其它形态） */
function bgValues(body) {
  return Array.from(body.matchAll(/(?:^|;)\s*background\s*:\s*([^;]+)/g)).map((x) => x[1].trim())
}

export function scan(src) {
  const rs = rules(styleBody(src))
  const stickyMain = rs.filter((r) => isStickyCol(r.sel) && /position\s*:\s*sticky/.test(r.body))
  const badBg = []
  for (const r of rs.filter((r) => isStickyCol(r.sel))) {
    for (const v of bgValues(r.body)) {
      // 允许：读 --row-bg、表头/表尾的 bg3、状态色、渐变/无
      if (/var\(--row-bg\b/.test(v)) continue
      if (/var\(--bg3\)/.test(v)) continue
      if (/var\(--p-bg\)|var\(--danger-bg\)|color-mix\(|none|transparent|linear-gradient/.test(v)) continue
      badBg.push(`${r.sel} → background:${v}`)
    }
  }
  // 表体行底色规则：含 tbody + tr + background:var(--bg*) ⇒ 必须同块下发 --row-bg。
  // ⚠️ 只算**刷在 tr 上**的规则。`> td` 的规则（如 .new-row > td）直接落到每个格子上，
  //    冻结列天然被覆盖 ⇒ 不需要也不该要求它下发变量（要求了就是假失败）。
  const rowPaint = rs.filter(
    (r) => /tbody/.test(r.sel) && /\btr\b/.test(r.sel) && !/>\s*td/.test(r.sel)
      && bgValues(r.body).some((v) => /var\(--bg[0-9]?\)/.test(v))
  )
  const missingVar = rowPaint.filter((r) => !/--row-bg\s*:/.test(r.body)).map((r) => r.sel)
  return { stickyMain, badBg, rowPaint, missingVar }
}

const src = fs.readFileSync(PAGE, 'utf8')

/* ── ① 冻结列的体规则必须读 --row-bg ── */
console.log('① 冻结列读 --row-bg（而不是写死白底）')
const base = scan(src)
ok(base.stickyMain.length >= 2, `找到 ${base.stickyMain.length} 条冻结列体规则（预期 ≥2：.frozen / .seq-cell）`,
  `(${base.stickyMain.map((r) => r.sel).join(' | ')})`)
ok(base.stickyMain.length > 0 && base.stickyMain.every((r) => /var\(--row-bg,var\(--bg\)\)/.test(r.body)),
  '每条都写 `var(--row-bg,var(--bg))`（有兜底，未声明行状态时仍是不透明底）')

/* ── ② 冻结列规则里不许出现写死的底色 ── */
console.log('② 冻结列不许写死背景色')
ok(base.badBg.length === 0, '零处写死 var(--bg) / #fff / white', base.badBg.join(' ; '))

/* ── ③ 行底色规则必须同块下发 --row-bg（唯一源）── */
console.log('③ 行底色与 --row-bg 成对出现')
ok(base.rowPaint.length >= 4, `找到 ${base.rowPaint.length} 条行底色规则（预期 ≥4：斑马/hover/改单斑马/改单hover）`)
ok(base.missingVar.length === 0, '每条都下发了 --row-bg', base.missingVar.join(' ; '))
ok(base.rowPaint.some((r) => /\.zebra/.test(r.sel) && /--row-bg\s*:\s*var\(--bg2\)/.test(r.body)),
  '斑马纹把 --row-bg 设为 --bg2')
ok(base.rowPaint.some((r) => /:hover/.test(r.sel) && /--row-bg\s*:\s*var\(--bg3\)/.test(r.body)),
  'hover 把 --row-bg 设为 --bg3')
ok(base.rowPaint.some((r) => /edit-tbl/.test(r.sel) && /nth-child\(even\)/.test(r.sel)),
  '改单网格的 nth-child(even) 也在名单里（否则改单态序号列同样脱节）')

/* ── 坏样本自证：把修复还原成缺陷，三条判据必须各自报警 ── */
console.log('坏样本自证（改回缺陷必须被抓出来）')

// 坏样本 A：冻结列写回 var(--bg)
const badA = src.replace(
  '.frozen){position:sticky;left:0;background:var(--row-bg,var(--bg))',
  '.frozen){position:sticky;left:0;background:var(--bg)'
)
const ra = scan(badA)
ok(badA !== src, '坏样本 A 构造成功（.frozen 写回 var(--bg)）')
ok(ra.badBg.length > 0, '坏样本 A 被 ② 抓出', ra.badBg[0] || '(没抓到 = 护栏失效)')
ok(!ra.stickyMain.every((r) => /var\(--row-bg,var\(--bg\)\)/.test(r.body)), '坏样本 A 也被 ① 抓出')

// 坏样本 B：斑马纹只上色、不下发变量
const badB = src.replace(
  /(:deep\(\.cross-tbl tbody tr\.data-row\.zebra\)\{)background:var\(--bg2\);--row-bg:var\(--bg2\)/,
  '$1background:var(--bg2)'
)
const rb = scan(badB)
ok(badB !== src, '坏样本 B 构造成功（斑马纹漏掉 --row-bg）')
ok(rb.missingVar.length > 0, '坏样本 B 被 ③ 抓出', rb.missingVar[0] || '(没抓到 = 护栏失效)')

if (failed) {
  console.log(`\n✗ 冻结列斑马纹契约：${failed} 项不通过`)
  process.exit(1)
}
console.log('\n✓ 冻结列斑马纹契约：全部通过')
