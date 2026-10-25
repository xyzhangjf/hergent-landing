/**
 * 进销存勾选列内边距契约（v672）——「复选框右边三个小点」
 * ---------------------------------------------------------------------------
 * 为什么需要这一组：
 *   老板截图：采购单列表每行复选框右边都多出三个小点。真机 + 最小复现确认
 *   成因链是**三条各自合理的规则叠出来的**，删任何一条都能"看不见"，但都是错的：
 *     ① `.psi-tbl th/td { overflow:hidden; text-overflow:ellipsis }`  ⇒ 这一格**会画省略号**；
 *     ② `table.tbl td { padding:10px 14px }`                        ⇒ 勾选列 36px 只剩 8px 内容盒；
 *     ③ 复选框 13px                                                  ⇒ 溢出内容盒 5px ⇒ 画「…」。
 *   紧凑密度下 `padding:2px 8px` ⇒ 内容盒 20px 不溢出 ⇒ **只有默认密度露出来**，
 *   所以从 v532 上提共享类那天起一直没被发现（销售/调拨两页同样中招）。
 *
 * 🔴 这条契约钉的是「勾选列左右内边距归零 + 私有勾选列类名不得复活 + 不许靠加宽列遮」，
 *   而不是「省略号别画」—— 后者是症状。
 *
 * 🔴 扫描纪律：
 *   · 断言前**先剥 HTML 注释与 CSS 注释** —— 本文件与源码注释里写满了 `padding:10px 14px`
 *     / `text-overflow:clip` 这类"反面教材"，不剥会把文档判成违规（v664/v671 同族）。
 *   · 本机 shell 里 `grep "A\|B"` 会静默失效 ⇒ 一律用 Node 正则。
 *   · 必须**扫全站**（v669 只扫 3 个文件才漏了 InvPurchaseList 自写面板）。
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(process.cwd())
const SRC = path.join(ROOT, 'src')

let pass = 0
let failed = 0
function ok (cond, label, extra) {
  if (cond) { pass++; console.log('     ✅ ' + label) }
  else { failed++; console.log('     ❌ ' + label + (extra ? '  → ' + extra : '')) }
}
const read = (p) => fs.readFileSync(p, 'utf8')
const stripHtml = (s) => s.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
const stripCss = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))

function walk (dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git'].includes(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.vue') || e.name.endsWith('.css')) out.push(p)
  }
  return out
}
const files = walk(SRC)
const vueFiles = files.filter((f) => f.endsWith('.vue'))
const rel = (p) => p.slice(ROOT.length + 1)
/** 取 <style> 块（只判样式，避免模板 class 用法被当成规则） */
const styleBlocks = (s) => [...s.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n')
/** 拆成 { sel, body } 规则列表（够用：本项目没有 @media 嵌套里的勾选列规则需要精确解析） */
function cssRules (css) {
  const out = []
  const re = /([^{}@]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(css))) out.push({ sel: m[1].trim(), body: m[2] })
  return out
}

const PSI = path.join(SRC, 'styles/psi-list.css')
const psiCss = stripCss(read(PSI))

console.log('\n【1】唯一源：勾选列左右内边距归零（缺陷修复本体）')
{
  const rules = cssRules(psiCss).filter((r) => /\.psi-chk/.test(r.sel) && /padding/.test(r.body))
  const zero = rules.find((r) =>
    /padding-left:\s*0/.test(r.body) && /padding-right:\s*0/.test(r.body))
  ok(!!zero, 'psi-list.css 有 `.psi-tbl ...psi-chk { padding-left:0; padding-right:0 }`',
    rules.length ? '现有：' + rules.map((r) => r.sel).join(' | ') : '未找到任何 psi-chk 的 padding 规则')

  /* 🔴 权重必须是 (0,3,2)：`[data-density=compact] table.tbl.psi-tbl td{padding:2px 8px}`
     也是 (0,3,2)，写成 `.psi-tbl td.psi-chk`（(0,2,1)）会被压掉 ⇒ 紧凑档静默不生效。
     这一条是 v672 真机量出来的（第一版就写成 (0,2,1)，注入实测 compact 下 padding 仍是 8px）。 */
  ok(zero && /table\.tbl\.psi-tbl\s+t[hd]\.psi-chk/.test(zero.sel),
    '归零规则的权重 ≥ 紧凑密度规则（选择器须带 table.tbl.psi-tbl）', zero && zero.sel)

  /* 🔴 紧凑密度那条 `[data-density=compact] table.tbl.psi-tbl td{padding:2px 8px}` 在**同一个文件里更靠后**，
     同权重靠顺序决胜 ⇒ 基础选择器会被它压掉。必须显式列出紧凑变体（权重 (0,4,2)）。
     这条也是真机量出来的：只写基础选择器时，注入实测 compact 下 padding 仍是 8px。 */
  ok(zero && /\[data-density="compact"\]\s+table\.tbl\.psi-tbl\s+td\.psi-chk/.test(zero.sel),
    '归零规则含紧凑密度变体（[data-density="compact"] … td.psi-chk）', zero && zero.sel)

  /* 纵向内边距必须留着（否则行高会跟着变，三页行高不再一致）*/
  const vertical = rules.find((r) => /padding-(top|bottom)/.test(r.body) || /padding:\s*[\d.]+px\s+0/.test(r.body))
  ok(!vertical, '没有顺手改纵向内边距（行高不变）', vertical && vertical.sel)

  /* 不许用 text-overflow:clip 遮症状（溢出还在，复选框一变大就复现）*/
  const clip = cssRules(psiCss).filter((r) => /text-overflow:\s*clip/.test(r.body))
  ok(clip.length === 0, '没有用 `text-overflow:clip` 遮症状', clip.map((r) => r.sel).join(' | '))

  /* 成因链自检：列宽 − 左右基础内边距 仍容不下 13px 复选框 ⇒ 这条归零规则必须在场。
     值从源码读，不写死 —— 哪天列宽或基础 padding 变了，这条会提醒重算成因链。 */
  const base = cssRules(stripCss(read(path.join(SRC, 'styles/variables.css'))))
    .find((r) => /^table\.tbltd$/.test(r.sel.replace(/\s+/g, '')))
  const padH = base ? (() => {
    const m = /padding:\s*([\d.]+)px\s+([\d.]+)px/.exec(base.body)
    return m ? parseFloat(m[2]) : null
  })() : null
  ok(padH !== null, '能读到基础表格单元格的横向内边距（table.tbl td）', '未匹配')
  const CHK = 36
  const CB = 13
  ok(padH === null || CHK - padH * 2 < CB,
    `成因链仍成立：${CHK}px − ${padH ?? '?'}×2 = ${padH === null ? '?' : CHK - padH * 2}px < 复选框 ${CB}px ⇒ 归零内边距是必需的（不是审美）`)
}

console.log('\n【2】勾选列只许用共享 `.psi-chk`（私有类名不得复活）')
{
  const bad = []
  for (const f of vueFiles) {
    const s = stripCss(stripHtml(read(f)))
    for (const m of s.matchAll(/\b([a-z]{2,6})-c-chk\b/g)) bad.push(rel(f) + ' → ' + m[1] + '-c-chk')
  }
  ok(bad.length === 0, '全站无页面私有勾选列类名（xx-c-chk）', bad.slice(0, 4).join('; '))

  /* 反向：任何一个 th/td 只要带 chk 语义的类，必须同时带 psi-chk */
  const loose = []
  for (const f of vueFiles) {
    const s = stripHtml(read(f))
    for (const m of s.matchAll(/<(t[hd])\s+class="([^"]*)"/g)) {
      const cls = m[2]
      if (!/\bchk\b/.test(cls) && !/\bpsi-chk\b/.test(cls)) continue
      if (!/\bpsi-chk\b/.test(cls)) loose.push(rel(f) + ' → <' + m[1] + ' class="' + cls + '">')
    }
  }
  ok(loose.length === 0, '凡勾选格的 th/td 都带 `.psi-chk`（视觉唯一源）', loose.slice(0, 4).join('; '))
}

console.log('\n【3】页面 scoped 不得再给 `.psi-chk` 写尺寸/内边距（第二真相源）')
{
  const bad = []
  for (const f of vueFiles) {
    const css = stripCss(styleBlocks(read(f)))
    for (const r of cssRules(css)) {
      if (!/\.psi-chk/.test(r.sel)) continue
      if (/padding|\bwidth\b|\bheight\b|font-size/.test(r.body)) bad.push(rel(f) + ' → ' + r.sel)
    }
  }
  ok(bad.length === 0, '无页面 scoped 覆盖 `.psi-chk` 的盒模型', bad.slice(0, 4).join('; '))
}

console.log('\n【4】三页列宽同值 36，且不许靠加宽列遮省略号')
{
  const pages = ['InvPurchaseList', 'InvSaleList', 'InvTransferList']
  for (const name of pages) {
    const p = path.join(SRC, 'pages/inventory', name + '.vue')
    const s = stripHtml(read(p))
    ok(/const CHK_W = 36\b/.test(s), name + '：CHK_W = 36（冻结节偏移 0/36/82 的基准）')
    ok(/<col :style="\{ width: CHK_W \+ 'px' \}" \/>/.test(s), name + '：列宽由 <colgroup> 的 CHK_W 给出')
    ok(/<th class="psi-chk/.test(s) && /<td class="psi-chk/.test(s), name + '：表头与表体勾选格都用 `.psi-chk`')
  }
}

console.log('\n' + '─'.repeat(66))
console.log(`  通过 ${pass} / 失败 ${failed}`)
process.exit(failed === 0 ? 0 : 1)
