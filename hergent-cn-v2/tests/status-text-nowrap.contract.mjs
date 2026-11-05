/* v770 契约：状态 / 标签 / 按钮 / 合计行的**短中文文案必须单行**，不许逐字竖排。
 *
 * 起因（真机实测，1440 视口）：商品档案「启用」两个字上下叠着显示。
 * 根因不是 writing-mode，而是 `table-layout:auto` 按 min-content 分配列宽：
 *   中文可按字断行 ⇒ 没有 nowrap 时「启用」的 min-content = 1 个字（12px），
 *   状态列被压到 48px、`.tag` 只剩 28px（还要扣 16px 内距）⇒ 两字各占一行，
 *   且 `height:22px` 固定 ⇒ scrollHeight 30 被裁掉 8px。
 *
 * 🔴 为什么判据落在「规则块」而不是「全文 grep nowrap」：
 *    全站本来就有几十条 nowrap（表头、按钮、日期…），全文命中不代表 `.tag` 有。
 *    必须按选择器定位到**那一条规则**的 body，再判里面有没有 nowrap。
 * 🔴 剥注释但保留行数：修复注释里逐字写了 `white-space:nowrap` 的解释与反例，
 *    不剥注释会「注释里命中、规则里已删」照样全绿（v766 踩过同款）。
 * 🔴 坏样本必须逐个删 nowrap 自证能红；对照组原样复制必须全绿。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const FILES = {
  vars: path.join(ROOT, 'src/styles/variables.css'),
  psi: path.join(ROOT, 'src/styles/psi-list.css'),
  alert: path.join(ROOT, 'src/pages/wh/StockAlert.vue'),
  trace: path.join(ROOT, 'src/pages/inventory/InvBatchTrace.vue'),
  collect: path.join(ROOT, 'src/components/CollectionsCard.vue'),
  badge: path.join(ROOT, 'src/components/StatusBadge.vue'),
}

let failed = 0
const ok = (cond, label, extra = '') => {
  if (cond) console.log('  ✅ ' + label + (extra ? ' ' + extra : ''))
  else { console.log('  ❌ ' + label + (extra ? ' ' + extra : '')); failed++ }
}
const stripCss = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))

/** 按 CSS 规则块切，返回 selector 命中 contains 的 body 数组。 */
function bodies(css, selFragment) {
  const out = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(css))) {
    const sel = m[1].trim().split('\n').pop().trim()
    if (sel.includes(selFragment)) out.push({ sel, body: m[2] })
  }
  return out
}
const hasNowrap = (b) => /white-space\s*:\s*nowrap/.test(b)

function audit(raw) {
  const errs = []
  const A = (cond, label) => { if (!cond) errs.push(label) }
  const s = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, stripCss(v)]))

  /* ① 全站唯一状态徽章入口（StatusBadge.vue 只挂 .tag，不许自己另造一套造型） */
  const badge = raw.badge
  A(/class="tag"\s*:class="resolvedTone"/.test(badge), 'StatusBadge 仍是 .tag 唯一入口')
  A(!/\.tag\s*\{/.test(stripCss(badge)), '组件内没有第三套 .tag 重定义')

  /* ② .tag 全局规则：唯一 + 单行 */
  const tagExact = bodies(s.vars, '.tag').filter((r) => /^\.tag$/.test(r.sel))
  A(tagExact.length === 1, '.tag 基础规则唯一（多份＝又长出新实现）', `实际 ${tagExact.length}`)
  if (tagExact.length === 1) A(hasNowrap(tagExact[0].body), '🔴 .tag 含 white-space:nowrap（缺了就竖排）')
  /* 变体规则不许把 white-space 改回可断行 */
  const tagAll = bodies(s.vars, '.tag')
  A(!tagAll.some((r) => /white-space\s*:\s*normal/.test(r.body)), '没有 .tag 变体把 nowrap 改回 normal')

  /* ③ 合计行共享件（两类表各一条：.psi-tbl 走进销存七页 / freeze-list 走档案·资金页）。
        🔴 判据是「每一条都 nowrap」，不是「只有一条」—— 只补其中一条时另一半站照样竖排。 */
  const ft = bodies(s.psi, 'tfoot .ft-lb')
  A(ft.length >= 1, 'tfoot .ft-lb 规则存在', `实际 ${ft.length}`)
  A(ft.length > 0 && ft.every((r) => hasNowrap(r.body)),
    '🔴 所有合计标签规则都含 white-space:nowrap（缺一条即半站漏）',
    `实际 ${ft.filter((r) => hasNowrap(r.body)).length}/${ft.length}`)

  /* ④ 两处页面级短文案：库存预警 label / 批次追溯按钮 */
  const lb = bodies(s.alert, '.wsa-lb')
  A(lb.length === 1 && hasNowrap(lb[0]?.body || ''), '🔴 库存预警 .wsa-lb 单行（关键字 / 预警级别）')
  const btn = bodies(s.trace, '.ibt-search .btn')
  A(btn.length === 1 && hasNowrap(btn[0]?.body || ''), '🔴 批次追溯 .ibt-search .btn 单行（追溯）')
  const cr = bodies(s.collect, '.cr-tables .btn')
  A(cr.length === 1 && hasNowrap(cr[0]?.body || ''), '🔴 工作台收款卡片 .cr-tables .btn 单行（1024 双列时「收款」竖排）')

  return errs
}

const readAll = (map) => Object.fromEntries(Object.entries(map).map(([k, p]) => [k, fs.readFileSync(p, 'utf8')]))
console.log('── v770 短中文文案禁止逐字竖排 ──')
const real = audit(readAll(FILES))
ok(real.length === 0, '真树判据全过', real.length ? '\n     - ' + real.join('\n     - ') : '')

/* 对照组 + 坏样本自证 */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v770-nowrap-'))
function mutate(tag, key, from, to) {
  const dst = path.join(tmp, tag)
  fs.mkdirSync(dst, { recursive: true })
  const map = {}
  for (const [k, src] of Object.entries(FILES)) {
    const t = path.join(dst, k)
    fs.copyFileSync(src, t)
    map[k] = t
  }
  const p = map[key]
  const s = fs.readFileSync(p, 'utf8')
  if (!s.includes(from)) { ok(false, `${tag}：锚点未命中（源码已改，需更新样本）`); return null }
  fs.writeFileSync(p, s.replace(from, to))
  return readAll(map)
}
try {
  const ctrl = mutate('ctrl', 'vars', 'white-space:nowrap;', 'white-space:nowrap;')
  ok(ctrl && audit(ctrl).length === 0, '对照组（原样复制）全绿（证明不是「见红就对」）')

  const samples = [
    ['m1', 'vars', '  white-space:nowrap;\n}', '', '删掉 .tag 的 nowrap ⇒ 商品档案「启用」/ 库存查询「无到期日」竖排'],
    ['m2', 'psi', 'white-space:nowrap }', '}', '删掉 tfoot .ft-lb 的 nowrap ⇒ 资金流水「本页合计」竖排'],
    ['m3', 'alert', 'white-space:nowrap }', '}', '删掉 .wsa-lb 的 nowrap ⇒ 库存预警「关键字 / 预警级别」竖排'],
    ['m4', 'trace', 'white-space:nowrap }', '}', '删掉 .ibt-search .btn 的 nowrap ⇒ 批次追溯按钮「追溯」竖排'],
    ['m5', 'vars', '  white-space:nowrap;\n}', '  white-space:normal;\n}', '把 .tag 改成 normal（比删掉更隐蔽）'],
    ['m6', 'psi',
      '.table-wrap.freeze-list > table > tfoot .ft-lb { text-align: left; color: var(--t2); white-space:nowrap }',
      '.table-wrap.freeze-list > table > tfoot .ft-lb { text-align: left; color: var(--t2) }',
      '只删 freeze-list 那条 nowrap（档案/资金页合计标签竖排，另一条还绿着最易漏）'],
    ['m7', 'collect', '.cr-tables .btn{white-space:nowrap}', '.cr-tables .btn{}',
      '删掉收款卡片的 nowrap ⇒ 1024 视口「收款」按钮竖排（1440 看不到，最容易漏）'],
  ]
  for (const [tag, key, from, to, why] of samples) {
    const s = mutate(tag, key, from, to)
    if (!s) continue
    const errs = audit(s)
    ok(errs.length > 0, `${tag} 坏样本必须被检出：${why}`,
      errs.length ? `（命中 ${errs.length} 条）` : '')
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}

console.log(failed ? `\n❌ ${failed} 项未通过` : '\n✅ 全部通过')
process.exit(failed ? 1 : 0)
