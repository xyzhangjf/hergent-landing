/**
 * 副驾抽屉层级契约（v673）——「品牌/到货周期/复制报单弹层盖在副驾抽屉上」
 * ---------------------------------------------------------------------------
 * 现象：侧栏弹窗（AI 副驾抽屉 .copilot，z 950）打开时，本期预报页的
 *   品牌 / 到货周期 / 复制报单 **弹层** 整块浮在抽屉之上。
 *
 * 根因（真机取证，1440×900，演示租户）：
 *   v135 用 `.page.copilot-on .tb-pop` 在预报页降过一次级，但只治住**按钮容器**：
 *     ① `.tb-pop-panel` 是 `Teleport to="body"` ⇒ 已不在 `.page` 后代里
 *        ⇒ `.page.copilot-on .tb-pop-panel` **永不匹配**（选择器写对了，祖先没了）
 *        ⇒ 面板恒 1101 > 抽屉 950；
 *     ② 列菜单 `.col-menu`(1101) / `.col-menu-overlay`(1100) 从来没进过名单。
 *   实测副驾打开后：`.tb-pop` = auto ✓，但 `.tb-pop-panel` = 1101、`.col-menu` = 1101，
 *   `elementFromPoint` 命中的是面板/列表项自己 ⇒ 确证浮在抽屉上。
 *
 * 钉的判据（任何一条破 ⇒ 缺陷回来）：
 *   ① `copilot-on` 必须挂在 **<body>**（页面根管不到 Teleport 出去的浮层）；
 *   ② 全局唯一源 `styles/app-layers.css` 必须覆盖 6 个类；
 *   ③ `main.js` 必须引入该表（不进入口 chunk = 样式根本不存在，v560 教训）；
 *   ④ Forecast.vue 里**不许**再有 `.page.copilot-on`（第二真相源，且它对 Teleport 无效）；
 *   ⑤ 模态一律不许被降级（确认框必须还能压住抽屉）。
 *
 * 🔴 扫描纪律：先剥注释再断言（源码注释里写满「.page.copilot-on」这类反面教材）。
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
/* .vue 里既有 HTML 注释也有 CSS 注释（本页注释里写满了 `.page.copilot-on` 这类反面教材） */
const cleanVue = (s) => stripCss(stripHtml(s))
/* 拆规则：返回 [{ sel, body }]，sel 已压成单行 */
function cssRules (css) {
  const out = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(css))) {
    const sel = m[1].replace(/\s+/g, ' ').trim()
    if (sel) out.push({ sel, body: m[2] })
  }
  return out
}

console.log('\n⑩ 副驾抽屉层级（v673）')

/* ---------- ① body 类由 CopilotDrawer 维护 ---------- */
const drawerPath = path.join(SRC, 'components/CopilotDrawer.vue')
const drawer = read(drawerPath)
const drawerJs = stripHtml(drawer.slice(drawer.indexOf('<script'), drawer.lastIndexOf('</script>')))
ok(/document\.body\.classList\.toggle\(\s*['"]copilot-on['"]/.test(drawerJs),
  'CopilotDrawer 在 watch 里给 <body> 切换 copilot-on',
  '未找到 document.body.classList.toggle(\'copilot-on\')')
ok(/onBeforeUnmount\([\s\S]{0,160}classList\.remove\(\s*['"]copilot-on['"]\s*\)/.test(drawerJs),
  '组件卸载时摘掉 body.copilot-on（防页面浮层永久停在 auto）')
ok(/watch\(\(\)\s*=>\s*store\.ui\.copilotOpen/.test(drawerJs),
  '切换挂在 store.ui.copilotOpen 上（抽屉真实开关，不是别的地儿）')

/* ---------- ② 全局唯一源 ---------- */
const layersPath = path.join(SRC, 'styles/app-layers.css')
ok(fs.existsSync(layersPath), 'styles/app-layers.css 存在（抽屉让位的唯一源）')
const layersRaw = fs.existsSync(layersPath) ? read(layersPath) : ''
const layers = stripCss(layersRaw)
const rules = cssRules(layers)
const autoRule = rules.find((r) => /body\.copilot-on/.test(r.sel) && /z-index\s*:\s*auto/.test(r.body))
const autoSels = autoRule ? autoRule.sel.split(',').map((s) => s.trim()) : []
const MUST = [
  ['body.copilot-on .tb-pop', '.tb-pop 触发按钮容器'],
  ['body.copilot-on .tb-pop-panel', '.tb-pop-panel 弹层本体（Teleport 到 body）'],
  ['body.copilot-on .pop-overlay', '.pop-overlay 弹层互斥遮罩'],
  ['body.copilot-on .col-menu', '.col-menu 列设置面板'],
  ['body.copilot-on .col-menu-overlay', '.col-menu-overlay 列设置遮罩'],
  ['body.copilot-on .grid-area.is-fs', '.grid-area.is-fs 表体全屏层']
]
for (const [sel, label] of MUST) {
  ok(autoSels.includes(sel), 'app-layers.css 有 ' + label + ' ⇒ z-index:auto',
    '现有降级选择器：' + (autoSels.join(' | ') || '(无)'))
}
ok(!/--z-page-modal|--z-sug-pop|1130|1125/.test(layers),
  '⛔ 不动模态/建议浮层（确认框必须还能压住抽屉）',
  '规则里出现了模态档位')

/* ---------- ③ 入口 chunk 必须加载 ---------- */
const mainJs = read(path.join(SRC, 'main.js'))
ok(/import\s+['"]\.\/styles\/app-layers\.css['"]/.test(mainJs),
  'main.js 引入 styles/app-layers.css（懒加载表 = 样式根本不存在）')

/* ---------- ④ 页面里不许再有第二真相源 ---------- */
const forecast = cleanVue(read(path.join(SRC, 'pages/Forecast.vue')))
const pageCopilot = forecast.match(/\.page\.copilot-on[^{]*\{/g) || []
ok(pageCopilot.length === 0,
  'Forecast.vue 不再写 .page.copilot-on 规则（对 Teleport 浮层无效，且是第二真相源）',
  '仍有 ' + pageCopilot.length + ' 条：' + pageCopilot.slice(0, 2).join(' | '))
ok(!/:class="\{[^"]*'copilot-on'/.test(forecast),
  'Forecast.vue 根节点不再绑 copilot-on（类已迁到 body）')

/* ---------- ⑤ Teleport 出去的页面浮层必须被覆盖 ---------- */
const TEL = []
;(function walk (dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git'].includes(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name.endsWith('.vue')) {
      const t = stripHtml(read(p))
      if (/<Teleport[^>]*to="body"/.test(t) && /tb-pop-panel|pop-overlay/.test(t)) TEL.push(path.relative(SRC, p))
    }
  }
})(SRC)
ok(TEL.length > 0, '扫到 Teleport 到 body 的工具栏弹层页面（' + TEL.length + ' 个：' + TEL.slice(0, 4).join(', ') + '）')
const uncovered = TEL.filter((f) => {
  const t = stripHtml(read(path.join(SRC, f)))
  return /class="[^"]*tb-pop-panel/.test(t) && !/body\.copilot-on\s+\.tb-pop-panel/.test(layers)
})
ok(uncovered.length === 0, '所有 Teleport 弹层都被 body.copilot-on 覆盖', uncovered.join(', '))

console.log('\n  小计：' + pass + ' 通过 / ' + failed + ' 失败')
if (failed) process.exitCode = 1
