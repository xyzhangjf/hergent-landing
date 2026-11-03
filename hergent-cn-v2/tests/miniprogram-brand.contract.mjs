/* v748 契约：小程序「品牌色只有一个值」这条纪律，必须**被执行**。
 *
 * 报障原话：「小程序我用红框框出来的这个一键置顶按钮，背景色还没有改成统一的品牌色」
 *
 * 根因是两层，都不是"颜色不好看"：
 *   ① 写法躲过了校验：`.back-top` 写的是 `rgba(6,182,212,.92)`。数值上就是旧的亮青
 *      #06b6d4，但只认 `#hex` 的校验**逐字节看不见它** ⇒ 上一轮"58 处已清零"数完，
 *      这个按钮自己留了下来。
 *   ② 半透明让品牌色漂移：92% 不透明度把底色和后景混在一起，实测截图采样 = #1abbd7，
 *      白箭头压它只有 2.28:1；而且**同一按钮压在商品行上和压在白卡片上是两个颜色**。
 *      ⇒ 品牌色带 alpha 就不再是品牌色，而是「品牌色 × 背后内容」。
 *
 * 🔴 更要紧的是第三层：`check-miniprogram-brand.mjs` 当时**没有任何 runner 在跑**。
 *   手工跑它是绿的、看一眼就觉得"品牌色统一过了"，而那正是它漏掉的按钮。
 *   ⇒ 本契约的唯一存在理由：把那个校验接进 `npm test`，并**往副本里注入回旧写法、
 *     要求它必须红**，证明它真的检查了这件事，而不是只证明自己肯 exit 0。
 *
 * 判据（①–③ 是"护栏本身没问题"，④–⑥ 是"护栏真能抓"）：
 *   ① 真树的校验通过
 *   ② 校验脚本里确实有"按数值判 rgb()/rgba()"这条规则（防被删掉后仍绿）
 *   ③ 副本未注入时也通过（证明 HG_MINI_ROOT 生效，① 不是"读的真树"混过去）
 *   ④ 副本注入 `rgba(6,182,212,.92)`（旧值）⇒ 必须红，且点名 #06b6d4
 *   ⑤ 副本注入 `rgba(14,116,144,.92)`（值对了但仍是半透明）⇒ 必须红
 *   ⑥ `.back-top` 精确断言用 var(--brand)（本版回归点，精确到选择器，报错信息更直白）
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = path.resolve(import.meta.dirname, '..')
const PROJ = path.resolve(ROOT, '..')
const MINI = path.join(PROJ, 'forecast-order-miniprogram-20260812T023419087Z/miniprogram')
const GUARD = path.join(PROJ, '.workbuddy/tools/check-miniprogram-brand.mjs')

let failed = 0
const ok = (cond, label, extra = '') => {
  if (cond) console.log('  ✅ ' + label + (extra ? ' ' + extra : ''))
  else {
    console.log('  ❌ ' + label + (extra ? ' ' + extra : ''))
    failed++
  }
}

/** 跑校验脚本；miniRoot 为空则跑真树 */
function runGuard(miniRoot) {
  const env = { ...process.env }
  if (miniRoot) env.HG_MINI_ROOT = miniRoot
  else delete env.HG_MINI_ROOT
  const r = spawnSync(process.execPath, [GUARD], { env, encoding: 'utf8' })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

/* ---------------- ① 真树必须通过 ---------------- */
ok(fs.existsSync(GUARD), '① 校验脚本存在', GUARD)
ok(fs.existsSync(MINI), '① 小程序目录存在', MINI)
const real = runGuard()
ok(real.code === 0, '① 真树品牌色校验通过', `exit=${real.code}`)
if (real.code !== 0) console.log(real.out.trim().split('\n').slice(0, 6).join('\n'))

/* ---------------- ② 规则本身在，且是按数值判的 ---------------- */
const guardSrc = fs.readFileSync(GUARD, 'utf8')
ok(/BRAND_FAMILY/.test(guardSrc), '② 校验含"品牌色家族"表（hex ↔ rgb 同一色系）')
ok(guardSrc.includes('rgbToHex') && guardSrc.includes('BRAND_FAMILY.get'), '② 校验把 rgb()/rgba() 转成 hex 后查品牌色家族')
ok(/HG_MINI_ROOT/.test(guardSrc), '② 校验支持 HG_MINI_ROOT（否则本契约的注入测没法做）')

/* ---------------- 副本（供 ③④⑤ 注入用） ---------------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hg-mini-'))
fs.cpSync(MINI, tmp, { recursive: true })
const target = path.join(tmp, 'pages/fill/fill.wxss')
const targetSrc = fs.readFileSync(target, 'utf8')
/* 注入锚点：.back-top 的实心底。找不到就说明这行被重写过了，测试要报红而不是空转 */
const ANCHOR = 'background:var(--brand);color:#fff;font-size:44rpx'
const anchorHits = targetSrc.split(ANCHOR).length - 1

/* ---------------- ③ 副本未注入 → 通过（证明真的在读副本） ---------------- */
const copyClean = runGuard(tmp)
ok(copyClean.code === 0, '③ 副本（未注入）通过 —— 证明 HG_MINI_ROOT 生效、① 不是读的真树')

/* ---------------- ④ 注入旧值 rgba(6,182,212,.92) → 必须红 ---------------- */
ok(anchorHits === 1, '④ 注入锚点唯一（.back-top 的 var(--brand) 实心底）', `命中 ${anchorHits} 次`)
if (anchorHits === 1) {
  fs.writeFileSync(target, targetSrc.replace(ANCHOR, 'background:rgba(6,182,212,.92);color:#fff;font-size:44rpx'))
  const r = runGuard(tmp)
  ok(r.code === 1, '④ 副本注入 rgba(6,182,212,.92) ⇒ 校验报红', `exit=${r.code}`)
  ok(/#06b6d4/.test(r.out), '④ 报错点名了它等于 #06b6d4（旧亮青）')
  ok(/透明度/.test(r.out), '④ 报错点明了"带透明度 ⇒ 压在不同内容上是不同颜色"')
  fs.writeFileSync(target, targetSrc)
}

/* ---------------- ⑤ 注入 rgba(14,116,144,.92)（值对了但半透明）→ 必须红 ---------------- */
if (anchorHits === 1) {
  fs.writeFileSync(target, targetSrc.replace(ANCHOR, 'background:rgba(14,116,144,.92);color:#fff;font-size:44rpx'))
  const r = runGuard(tmp)
  ok(r.code === 1, '⑤ 副本注入 rgba(14,116,144,.92) ⇒ 校验报红（半修正也不放过）', `exit=${r.code}`)
  ok(/品牌色/.test(r.out), '⑤ 报错说明它是品牌色的 rgb 写法、应写 var(--brand)')
  fs.writeFileSync(target, targetSrc)
}

/* ---------------- ⑥ .back-top 精确到选择器 ---------------- */
{
  const css = fs
    .readFileSync(path.join(MINI, 'pages/fill/fill.wxss'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
  const m = css.match(/\.back-top\{([^}]*)\}/)
  ok(!!m, '⑥ fill.wxss 里有 .back-top 规则')
  const decl = m ? m[1] : ''
  const bg = (decl.match(/background\s*:\s*([^;]+)/) || [])[1]
  ok(bg === 'var(--brand)', '⑥ .back-top 的 background 必须是 var(--brand)', `实际=${bg || '无'}`)
  /* 品牌色带 alpha 就是"品牌色 × 背后内容"（本版根因），已由 ①b 按数值拦住；
     这里再钉住"抬升感靠阴影、不靠透明度"这个决定本身 —— 否则有人为了显得轻，
     会把实心底改回半透明，或者在删掉阴影后被迫加回透明度。 */
  const shadow = (decl.match(/box-shadow\s*:\s*([^;]+)/) || [])[1]
  ok(/rgba\(0,\s*0,\s*0\s*,/.test(shadow || ''), '⑥ .back-top 用中性黑阴影表达"浮起"', `实际=${shadow || '无'}`)
}

/* ---------------- 收尾 ---------------- */
fs.rmSync(tmp, { recursive: true, force: true })
if (failed) {
  console.log(`\n❌ miniprogram-brand: ${failed} 条不通过`)
  process.exit(1)
}
console.log('\n✅ miniprogram-brand: 全部通过')
