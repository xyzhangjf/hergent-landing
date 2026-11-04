#!/usr/bin/env node
/**
 * 「带权限闸门的跳转」契约（v768）
 * ============================================================================
 * 背景：v291 起，全站把下面这三行**手抄**了 11 份：
 *
 *     if (!canSee(path)) { toast('你没有访问「X」的权限', 'warn'); return }
 *     router.push(path)
 *
 * 抄多份的代价不是理论风险，已经真实发生：
 *   · 文案漂移 —— 只有 Settings 写「请联系管理员」，其余 10 处不写；
 *   · 写法漂移 —— 10 处用 `router.push`，`Forecast.goConnect` 一处还在用
 *     `location.hash = '#/connect'`（拿不到 Promise，无法吞掉重复导航的 reject）；
 *   · 页名抄死 —— v311「能力中心」更名「AI 引擎」时得逐个文件改提示，
 *     漏一个就变成"提示用户去找一个不存在的菜单"（v766/v767 刚清完这一族）。
 *
 * 收敛后的唯一实现是 `src/utils/useGoPage.js`。而这个契约要防的是**回退**：
 * 下一个人想加一个"点了没权限就提示"的入口时，最容易的动作仍然是就地抄三行。
 *
 * 五条判据：
 *   ① 手抄组合数**只能降不能升**（三态：超基线=红 / 低于基线=红并提示下调 / 相等=绿）；
 *   ② 唯一实现本身必须还在、且仍导出 `useGoPage`、仍支持 `label` 覆盖；
 *   ③ 14 条已收敛的锚点必须**仍在位**（防下次重构把调用改回手抄、或把入口删了）；
 *   ④ 本地实例名不得用 `goPage` —— 四个档案页里 `goPage(p)` 是**分页函数**，
 *      同名 `const` + `function` 是 SyntaxError，而跨作用域时是**静默覆盖**；
 *   ⑤ 用了 `goNav` 就必须 `import`（项目无自动导入 ⇒ 漏了模板静默渲染空白）；
 * 外加坏样本自证，证明这套判据真的能红。
 *
 * 用法：node tests/go-nav-unified.contract.mjs
 * 退出码：全过 0，否则 1。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'src')
const IMPL = path.join(SRC, 'utils', 'useGoPage.js')

const failures = []
const notes = []
const ok = (m) => notes.push('✅ ' + m)
const bad = (m) => failures.push(m)

/* 冻结基线（v768 收口后的实测值 0）。**只许往下调**，低了也要改（否则基线越漂越松，
   这个数就变成"永远绿"的摆设）。 */
const HANDROLLED_BASELINE = 0

/* ── 扫描器：抽成纯函数，坏样本才能直接喂字符串自证 ──────────────────── */
const JUMP_RE = /\b(_?router\.(?:push|replace)|location\.hash\s*=|window\.location\.hash)/

/**
 * 剥注释：**逐行处理，行数必须保持不变**。
 *
 * 🔴 这条是踩过的坑：v766 第一版把整段文本用正则替换掉注释、换行也一起吃掉，
 *    结果后面所有行号**集体前移**，报出来的位置全是错的（比不报还糟）。
 *    有些注释解释代码为何这样写、里面就抄着反例（本仓尤其多，见 Shell.vue 与
 *    useGoPage.js），**必须剥掉它们再判断**，否则判据会被自己写的说明文字撞红。
 *
 * 行注释的判据是「`//` 前面是行首或空白」：这样 `href="#/forecast"`、
 * `'http://x'` 里的 `//` 不会被误当成注释起点。
 */
function stripComments(lines) {
  let inBlock = false
  return lines.map((raw) => {
    let line = raw
    if (inBlock) {
      const end = line.indexOf('*/')
      if (end === -1) return ''
      line = ' '.repeat(end + 2) + line.slice(end + 2)
      inBlock = false
    }
    let out = ''
    let i = 0
    while (i < line.length) {
      if (line.startsWith('/*', i)) {
        const end = line.indexOf('*/', i + 2)
        if (end === -1) { inBlock = true; return out }
        i = end + 2
        continue
      }
      if (line.startsWith('//', i) && (i === 0 || /\s/.test(line[i - 1]))) return out
      out += line[i]
      i += 1
    }
    return out
  })
}

/**
 * 找「自己判了 canSee、紧接着自己跳转」的行 —— 即本该复用 useGoPage 的手抄组合。
 * 窗口取 ±4 行：够覆盖 `if (...) { return }` 与下一行 `router.push` 的常见形态，
 * 又不会跨过函数边界（本项目函数普遍很短）。
 * 🔴 判断一律基于**剥掉注释的**行，见 `stripComments` 的说明。
 */
function scanHandRolled(text) {
  const rawLines = text.split('\n')
  const lines = stripComments(rawLines)
  const hits = []
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes('canSee(')) continue
    const win = lines.slice(Math.max(0, i - 4), i + 5).join('\n')
    if (JUMP_RE.test(win)) hits.push({ line: i + 1, text: rawLines[i].trim().slice(0, 90) })
  }
  return hits
}

/** 剥注释后的全文（用于"某处是否真的存在某段代码"，而不是注释里提到） */
const codeOf = (text) => stripComments(text.split('\n')).join('\n')

function walk(dir) {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else if (/\.(vue|js)$/.test(e.name)) out.push(p)
  }
  return out
}

const files = walk(SRC)
const read = (p) => fs.readFileSync(p, 'utf8')
const rel = (p) => path.relative(ROOT, p)

/* ── 断言 1：手抄组合数三态 ──────────────────────────────────────────── */
{
  const all = []
  for (const p of files) {
    /* 实现文件自己不算（它内部就是唯一的那一份） */
    if (path.resolve(p) === path.resolve(IMPL)) continue
    for (const h of scanHandRolled(read(p))) all.push({ rel: rel(p), ...h })
  }
  if (all.length > HANDROLLED_BASELINE) {
    bad(
      `手抄「canSee + 跳转」${all.length} 处（基线 ${HANDROLLED_BASELINE}）—— ` +
        `请改用 utils/useGoPage.js 的 goNav()：\n     ` +
        all.map((h) => `${h.rel}:${h.line}  ${h.text}`).join('\n     '),
    )
  } else if (all.length < HANDROLLED_BASELINE) {
    bad(
      `手抄数 ${all.length} < 基线 ${HANDROLLED_BASELINE}：又收敛掉了一些，` +
        `请把 HANDROLLED_BASELINE 改成 ${all.length}（不许放着不管，否则基线会越漂越松）`,
    )
  } else {
    ok(`手抄「canSee + 跳转」${all.length} 处（基线 ${HANDROLLED_BASELINE}）`)
  }
}

/* ── 断言 2：唯一实现本身仍然完整 ────────────────────────────────────── */
{
  if (!fs.existsSync(IMPL)) {
    bad('src/utils/useGoPage.js 不存在 —— 唯一实现被删了')
  } else {
    const src = read(IMPL)
    const checks = [
      ['export function useGoPage', '导出 useGoPage'],
      ['canSee(path)', '调用 canSee 判据'],
      ['pageTitle(path)', '用 pageTitle 反查页名（不许手写页名）'],
      ['opts.label', '支持 label 覆盖（后端动态路径用）'],
      ['.catch(() => {})', '吞掉重复导航的 reject'],
    ]
    const miss = checks.filter(([needle]) => !src.includes(needle))
    if (miss.length) bad(`useGoPage.js 缺失关键实现：${miss.map(([, d]) => d).join('、')}`)
    else ok(`唯一实现完整（${checks.length} 个关键点）`)
  }
}

/* ── 断言 3：已收敛的锚点必须仍在位 ──────────────────────────────────── */
const ANCHORS = [
  ['src/utils/useGoPage.js', 'export function useGoPage'],
  ['src/pages/Settings.vue', "goNav('/data-fill')"],
  ['src/pages/PayrollWorkflow.vue', "goNav('/data-fill')"],
  ['src/pages/LossWorkflow.vue', "goNav('/data-fill')"],
  ['src/pages/ReportMapping.vue', "goNav('/archive/employees')"],
  ['src/pages/SupplierArchive.vue', "goNav('/connect'"],
  ['src/pages/CustomerArchive.vue', "goNav('/connect'"],
  ['src/pages/EmployeeArchive.vue', "goNav('/connect'"],
  ['src/pages/EmployeeArchive.vue', "goNav({ path: '/forecast'"],
  ['src/pages/Forecast.vue', "goNav('/connect')"],
  ['src/pages/Rebate.vue', "goNav('/archive/suppliers')"],
  ['src/pages/Rebate.vue', "goNav('/archive/brands')"],
  ['src/pages/ProductTarget.vue', "goNav({ path: '/forecast'"],
  ['src/components/DataLedger.vue', 'goNav(p)'],
  ['src/pages/ConnectCenter.vue', 'goNav(w.path, { label: w.name })'],
  ['src/pages/Workbench.vue', 'goNav(t.path)'],
]
{
  const miss = []
  for (const [f, needle] of ANCHORS) {
    const p = path.join(ROOT, f)
    if (!fs.existsSync(p) || !read(p).includes(needle)) miss.push(`${f} → ${needle}`)
  }
  if (miss.length) bad(`已收敛的锚点丢失（可能被改回手抄或被删）：\n     ` + miss.join('\n     '))
  else ok(`${ANCHORS.length} 条已收敛锚点仍在位`)
}

/* ── 断言 4：本地实例名不得用 goPage ──────────────────────────────────
   四个档案页里 `goPage(p)` 是分页函数。同名 `const` + `function` ⇒ SyntaxError；
   跨作用域/换声明方式 ⇒ **静默覆盖**（按钮全变成"翻到 undefined 页"，零报错）。 */
{
  const offenders = []
  for (const p of files) {
    if (/const\s+goPage\s*=\s*useGoPage\(\)/.test(codeOf(read(p)))) offenders.push(rel(p))
  }
  if (offenders.length) {
    bad(
      `别把 useGoPage() 的实例叫 goPage（四个档案页里 goPage(p) 是分页函数）：` +
        offenders.join('、'),
    )
  } else {
    ok('无 `const goPage = useGoPage()`（避开与分页函数同名）')
  }
}

/* ── 断言 5：用了 goNav 就必须 import ─────────────────────────────────
   项目没有 unplugin-vue-components 自动导入 ⇒ 漏 import 时模板里那处**静默渲染空白**，
   JS 里那处运行时报 ReferenceError。v557 的 Icon 就是这么丢的。 */
{
  const offenders = []
  for (const p of files) {
    const s = codeOf(read(p))
    if (!/\bgoNav\s*\(/.test(s)) continue
    if (!/import\s*\{[^}]*\buseGoPage\b[^}]*\}\s*from/.test(s)) offenders.push(rel(p))
  }
  if (offenders.length) bad(`用了 goNav 但没 import useGoPage：${offenders.join('、')}`)
  else ok('凡用 goNav 的文件都已 import useGoPage')
}

/* ── 断言 6：坏样本自证 ─────────────────────────────────────────────── */
{
  const samples = [
    {
      name: '手抄组合（必须检出）',
      src: [
        'function goX() {',
        "  if (!canSee('/a')) { toast('no', 'warn'); return }",
        "  router.push('/a')",
        '}',
      ].join('\n'),
      want: 1,
    },
    {
      name: '注释里的代码示例（不许误报）',
      src: [
        '/* 以前是这样：',
        "  if (!canSee('/a')) { return }",
        "  router.push('/a')",
        '*/',
        'const x = 1',
      ].join('\n'),
      want: 0,
    },
    {
      name: '只判权限不跳转（不许误报）',
      src: ["if (!canSee('/cron')) { return }", 'render()'].join('\n'),
      want: 0,
    },
    {
      name: 'goNav 已接管（不许误报）',
      src: ["function goY() {", "  goNav('/a')", '}'].join('\n'),
      want: 0,
    },
  ]
  const wrong = samples.filter((s) => scanHandRolled(s.src).length !== s.want)
  if (wrong.length) {
    bad(
      '坏样本自证失败（判据不可信）：' +
        wrong.map((s) => `${s.name} 期望 ${s.want} 实得 ${scanHandRolled(s.src).length}`).join('；'),
    )
  } else {
    ok(`坏样本自证 ${samples.length} 条全对（含"必须检出"与"不许误报"两类）`)
  }
}

console.log('')
for (const n of notes) console.log('  ' + n)
if (failures.length) {
  console.log('')
  for (const f of failures) console.log('  ❌ ' + f)
}
console.log('')
console.log(failures.length === 0 ? 'ALL PASS' : `FAILED (${failures.length})`)
process.exit(failures.length === 0 ? 0 : 1)
