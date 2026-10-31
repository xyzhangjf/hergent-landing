#!/usr/bin/env node
/**
 * 层级护栏：**工具条弹层的触发按钮必须低于面板本体**（v678）
 *
 * 为什么需要它：这个 bug 修过两次。
 *   ① v704（2026-10-27）修好并上线 —— 做法是 `.tb-pop` 触发按钮 1120 → 1101、
 *      `.tb-pop-panel` 面板 1101 → 1116；
 *   ② 之后 `variables.css` 被整体回退到 v491 版（同一次回退还带走了 `--topbar-h:48px`、
 *      v674 的外壳浮层档、v679 的卡片内距），修复随之消失；
 *   ③ v678（2026-10-31）用户再次看到「导出面板上浮着『品牌/到货周期』两个按钮」。
 * 三次都是"改一个数字"，靠人眼看代码看不出来（值分散在 variables.css + 页面 scoped 样式里），
 * 所以这里用机器把它钉死。
 *
 * 判据（任何一条不满足即 FAIL）：
 *   A. `--z-page-trigger` / `--z-page-pop` 两个令牌都存在且是纯数字；
 *   B. `--z-page-trigger` > `--z-page-overlay`（弹层开着仍可点别的触发按钮做互斥切换）；
 *   C. `--z-page-pop` > `--z-page-trigger`（**核心判据**：面板压过自己的触发器）；
 *   D. `--z-page-pop` < 1121（天气 .wx-pop）且 < `--z-page-modal-overlay`；
 *   E. Forecast.vue 里 `.tb-pop` 真的用 `var(--z-page-trigger)`、`.tb-pop-panel` 真的用
 *      `var(--z-page-pop)`（令牌定义对了但没接线，等于没修）；
 *   F. 上面两条选择器必须**各命中恰好一次**（扫不到 ⇒ 也算失败，防止护栏空转；
 *      选择器改名后本脚本必须跟着改，而不是永远绿）。
 *
 * 用法：node tests/zorder-trigger-below-panel.guard.mjs
 * 退出码：0 全 PASS / 1 有 FAIL
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
/* HG_SRC_ROOT：把校验指向另一份源码副本。**唯一用途是自证判别力** ——
   拿改动前的备份跑一遍必须红，否则这条护栏是空的（永远绿的护栏比没有更坏）。 */
const SRC = process.env.HG_SRC_ROOT ? path.resolve(process.env.HG_SRC_ROOT) : path.join(ROOT, 'src')
const VARS = path.join(SRC, 'styles/variables.css')
const FORECAST = path.join(SRC, 'pages/Forecast.vue')

const R = []
const check = (name, ok, extra = '') => {
  R.push({ name, ok })
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''))
}

const varsText = fs.readFileSync(VARS, 'utf8')
const fcText = fs.readFileSync(FORECAST, 'utf8')

/* 取 `--name:123;` 里的数字。注释里也会出现 `--z-page-trigger:1101` 字样，故只认**行首缩进 + 分号结尾**的声明。 */
function token(name) {
  const re = new RegExp('^\\s*--' + name + '\\s*:\\s*(\\d+)\\s*;', 'm')
  const m = varsText.match(re)
  return m ? Number(m[1]) : null
}

const trigger = token('z-page-trigger')
const pop = token('z-page-pop')
const overlay = token('z-page-overlay')
const modalOverlay = token('z-page-modal-overlay')

check('A1 令牌 --z-page-trigger 存在且为数字', trigger !== null, String(trigger))
check('A2 令牌 --z-page-pop 存在且为数字', pop !== null, String(pop))

if (trigger === null || pop === null) {
  console.log('\n⇒ 令牌缺失 = v704 那次回退的典型形态，先把 variables.css 的两个令牌补回来。')
  console.log('\n合计：PASS ' + R.filter(x => x.ok).length + ' / FAIL ' + R.filter(x => !x.ok).length)
  process.exit(1)
}

check('B  触发按钮 > 页面遮罩（互斥切换仍可点）', trigger > overlay, `trigger ${trigger} > overlay ${overlay}`)
check('C  🔴 面板 > 触发按钮（核心：否则「遮挡带」必现）', pop > trigger, `pop ${pop} > trigger ${trigger}`)
check('D1 面板 < 天气浮层 1121', pop < 1121, `pop ${pop} < 1121`)
check('D2 面板 < 页面级模态遮罩', pop < modalOverlay, `pop ${pop} < modal ${modalOverlay}`)

/* E/F：接线。注意 `.tb-pop{` 与 `.tb-pop-panel{` 是不同选择器，不能只用 includes 粗判。 */
function ruleBody(selector) {
  const re = new RegExp('(?:^|[},])\\s*' + selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}', 'm')
  const m = fcText.match(re)
  return m ? m[1] : null
}

const popBody = ruleBody('.tb-pop')
const panelBody = ruleBody('.tb-pop-panel')

check('F1 `.tb-pop` 规则命中恰好一次（防护栏空转）', popBody !== null)
check('F2 `.tb-pop-panel` 规则命中恰好一次（防护栏空转）', panelBody !== null)

check('E1 `.tb-pop` 使用 var(--z-page-trigger)',
  !!popBody && /z-index\s*:\s*var\(--z-page-trigger\)/.test(popBody),
  popBody ? (popBody.match(/z-index\s*:[^;]*/) || ['(无 z-index)'])[0].trim() : '规则未找到')
check('E2 `.tb-pop-panel` 使用 var(--z-page-pop)',
  !!panelBody && /z-index\s*:\s*var\(--z-page-pop\)/.test(panelBody),
  panelBody ? (panelBody.match(/z-index\s*:[^;]*/) || ['(无 z-index)'])[0].trim() : '规则未找到')

/* 附加：面板必须有 max-height 兜底（矮视口下不许溢出视口到点不到） */
check('G  面板有 max-height 兜底', !!panelBody && /max-height\s*:/.test(panelBody))

const fails = R.filter(x => !x.ok)
console.log('\n合计：PASS ' + (R.length - fails.length) + ' / FAIL ' + fails.length)
if (fails.length) {
  console.log('\n⇒ 层级全序应为：遮罩 1100 < 触发按钮 1101 < 面板 1116 < 天气 1121 < 模态 1125')
  console.log('   详见 src/styles/variables.css 里 --z-page-trigger 上方的注释。')
}
process.exit(fails.length ? 1 : 0)
