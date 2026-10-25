#!/usr/bin/env node
/**
 * 前端测试统一入口（P1-1）
 *
 * 此前 package.json **没有 test 脚本**，三个契约测试只能靠人记命令手敲 ⇒
 * 等于没有基线。这里把它们收成一条 `npm test`。
 *
 * 三组：
 *   ① 万元↔元 往返（loss-accounting-money）—— 纯函数，必跑
 *   ② SFC 模板符号检查（sfc-symbols）—— 全量扫 src 下所有 .vue 文件。
 *      模板里引用未定义标识符时 **构建不报错**、只在运行时静默不渲染，
 *      是"页面能开但某处没反应"的高发形态，必须全量扫。
 *   ③ 返利口径契约（rebate-calc）—— 打真实 HTTP，需账号；
 *      没给账号时 **跳过而非失败**（不能因为没凭据就红）。
 *
 * 用法：
 *   npm test
 *   npm test -- --user mptest --pass 'Mptest@1'
 *   node tests/run-all.mjs --skip-sfc        # 跳过耗时的全量 SFC 扫描
 * 退出码：有失败 1，全过 0。
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const NODE = process.execPath

const argv = process.argv.slice(2)
const has = (n) => argv.includes('--' + n)
const val = (n, def) => {
  const i = argv.indexOf('--' + n)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def
}

function run(file, args, opts = {}) {
  const r = spawnSync(NODE, [path.join(__dirname, file), ...args], {
    cwd: ROOT, encoding: 'utf8', timeout: opts.timeout || 120000,
    env: { ...process.env, ...(opts.env || {}) },
  })
  return {
    code: r.status ?? (r.error ? -1 : 0),
    out: ((r.stdout || '') + (r.stderr || '')).trim(),
  }
}

/* 已知缺陷白名单：基线**不因它变红**，但每次运行都显式打印。
   为什么不一刀切改红：单个遗留缺陷会让 CI 长期红 ⇒ 没人看 ⇒ 新引入的缺陷也混进去。
   为什么不一刀切删掉：忘了就等于永远不修。登记即负债，必须带说明。 */
/* 2026-10-22：首条已销账 —— Forecast.vue 的 openAlloc(allocRowRef(r)) 已改 openAlloc(r)，
   AllocPanel 里那个从未被调用的 allocRowRef 也一并删除。当前无遗留缺陷。
   机制保留：新发现的已知缺陷照此登记（带说明 + 修法），不要删掉这套白名单。 */
const KNOWN_ISSUES = []

function walkVue(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walkVue(p, acc)
    else if (e.name.endsWith('.vue')) acc.push(p)
  }
  return acc
}

const results = []
const t0 = Date.now()

// ── ① 万元↔元 往返 ──────────────────────────────────────────
console.log('── ① 万元↔元 往返（真实 SFC 实现）──')
{
  const r = run('loss-accounting-money.contract.mjs', ['src/pages/LossAccounting.vue'])
  const tail = r.out.split('\n').filter(Boolean).slice(-3).join('\n   ')
  console.log(r.code === 0 ? '  ✅ PASS' : '  ❌ FAIL', '\n   ' + tail)
  results.push({ name: '万元↔元往返', ok: r.code === 0, code: r.code })
}

// ── ② SFC 全量符号检查 ──────────────────────────────────────
if (has('skip-sfc')) {
  console.log('\n── ② SFC 全量符号检查 —— 已跳过(--skip-sfc) ──')
} else {
  console.log('\n── ② SFC 全量符号检查（src/**/*.vue）──')
  const files = walkVue(path.join(ROOT, 'src'))
  const bad = []
  const crashed = []
  const accepted = []
  for (const f of files) {
    const rel = path.relative(ROOT, f)
    const r = run('sfc-symbols.contract.mjs', [rel], { timeout: 60000 })
    if (r.code === 0) continue
    // 检查器自身崩了（编译器抛异常）≠ 模板符号缺失，必须分开统计，
    // 否则"脚本坏了"会被当成"代码坏了"，基线永远修不干净。
    if (/Node\.js v\d|at async asyncRunEntryPoint|^\w*Error:/m.test(r.out)) {
      const first = r.out.split('\n').find((l) => /Error:/.test(l)) || '(未知)'
      crashed.push({ rel, err: first.slice(0, 120) })
      continue
    }
    // 精确取「① 被调用 / ② 被引用的标识符」里未定义的那两行 —— 那才是判失败的依据
    // （v629 起 ② 也判失败：漏掉它等于放过 `v-if="open"` 那类「静默不渲染」）
    const m1 = r.out.match(/① 被调用的标识符：共 \d+ 个，未定义 (\d+) 个\n\s*(.*)/)
    const m2 = r.out.match(/② 指令\/插值中引用的标识符：共 \d+ 个，未定义 (\d+) 个\n\s*(.*)/)
    const miss = [m1 && m1[1] !== '0' ? '调用:' + m1[2] : '', m2 && m2[1] !== '0' ? '引用:' + m2[2] : '']
      .filter(Boolean).join(' | ').slice(0, 200) || '(未能解析)'
    const known = KNOWN_ISSUES.find((k) => k.file === rel && miss.includes(k.sym))
    if (known) accepted.push({ rel, miss, note: known.note })
    else bad.push({ rel, miss })
  }
  console.log(`  扫描 ${files.length} 个 .vue | 符号缺失 ${bad.length} 个 | 已知缺陷 ${accepted.length} 个 | 检查器崩溃 ${crashed.length} 个`)
  for (const b of bad) console.log(`  ❌ ${b.rel}\n        │ 未定义: ${b.miss}`)
  for (const a of accepted) console.log(`  ⚠️  ${a.rel}（已登记已知缺陷，不阻断）\n        │ ${a.note}`)
  for (const c of crashed) console.log(`  ⛔ ${c.rel}\n        │ 检查器崩溃: ${c.err}`)
  results.push({
    name: 'SFC 符号检查',
    ok: bad.length === 0 && crashed.length === 0,
    detail: `共 ${files.length}，新增缺失 ${bad.length}，已知 ${accepted.length}，崩溃 ${crashed.length}`,
  })
}

// ── ③ 返利口径契约（需账号） ────────────────────────────────
{
  const user = val('user', process.env.REBATE_USER || '')
  const pass = val('pass', process.env.REBATE_PASS || '')
  const base = val('base', process.env.REBATE_BASE || 'https://hergent.cn')
  console.log('\n── ③ 返利口径契约（真实 HTTP）──')
  if (!user || !pass) {
    console.log('  ⏭ SKIP：未提供账号（--user/--pass 或 REBATE_USER/REBATE_PASS）')
  } else {
    const r = run('rebate-calc.contract.mjs', ['--base', base, '--user', user, '--pass', pass], { timeout: 300000 })
    const tail = r.out.split('\n').filter(Boolean).slice(-4).join('\n   ')
    console.log(r.code === 0 ? '  ✅ PASS' : '  ❌ FAIL', '\n   ' + tail)
    results.push({ name: '返利口径契约', ok: r.code === 0, code: r.code })
  }
}

// ── ④ <script setup> 跨组件 / 漏 import 符号检查 ───────────
/* 为什么需要第 4 组（v629）：② 只扫**模板**表达式，而 `_allocPid()` / `parseNumInput()`
   这类调用写在 <script setup> 里 ⇒ 构建不报错、模板检查也看不见，
   只有**真机点那一下**才 ReferenceError，还被 ErrorBoundary 吞成"点了没反应"。 */
{
  console.log('\n── ④ <script setup> 跨组件 / 漏 import 符号检查 ──')
  const r = run('cross-sfc-symbol.contract.mjs', [], { timeout: 120000 })
  const tail = r.out.split('\n').filter(Boolean).slice(-3).join('\n   ')
  console.log(r.code === 0 ? '  ✅ PASS' : '  ❌ FAIL', '\n   ' + tail)
  results.push({ name: '脚本内符号检查', ok: r.code === 0, code: r.code })
}

// ── ⑤ 副驾「新对话」入口契约 ─────────────────────────────────
/* 为什么需要第 5 组（v663）：用户报「新对话按键藏在历史会话里，修过又回退了」。
   查实是**生产热修没进 git** —— 下次从源码整包构建同步就自动覆盖回旧形态。
   这条护栏盯的就是那个"唯一入口被藏起来"的结构，不依赖样式和浏览器。 */
{
  console.log('\n── ⑤ 副驾「新对话」入口契约（常驻标题栏，不许藏进历史面板）──')
  const r = run('copilot-newchat.contract.mjs', [], { timeout: 60000 })
  const tail = r.out.split('\n').filter(Boolean).slice(-2).join('\n   ')
  console.log(r.code === 0 ? '  ✅ PASS' : '  ❌ FAIL', '\n   ' + tail)
  results.push({ name: '副驾新对话入口', ok: r.code === 0, code: r.code })
}

// ── ⑥ 舟谱模板分批号段契约 ───────────────────────────────────
/* 为什么需要第 6 组（v665）：同期次因各品牌到货不同要分几批导出，而舟谱要求源单据号
   唯一 —— 号段统一性在后端（库内水位），但前端两处会让它白费：`zt_seq_start` 默认值
   被改回 21，或导出后不把「第几批 / 哪段单号」说给用户（分批时那是对账的唯一凭据）。 */
{
  console.log('\n── ⑥ 舟谱模板分批号段契约（起始序号 01 起 + 导出回报批次）──')
  const r = run('zhoupu-batch.contract.mjs', [], { timeout: 60000 })
  const tail = r.out.split('\n').filter(Boolean).slice(-2).join('\n   ')
  console.log(r.code === 0 ? '  ✅ PASS' : '  ❌ FAIL', '\n   ' + tail)
  results.push({ name: '舟谱分批号段', ok: r.code === 0, code: r.code })
}

// ── ⑦ 列设置面板契约（层级 / 勾选同步）──────────────────────
/* 为什么需要第 7 组（v669）：两个缺陷都"改动一眼看不出坏" ——
   ① 面板 z 档一回落，全屏时就被全屏层盖住（真实鼠标点不到，零报错）；
   ② 复选框写回 `@click.prevent` + 单向 `:checked`，真实鼠标必现「勾选态不刷新」，
      而 JS 的 `el.click()` 探针**量不出来**（无 pre-click activation）⇒ 只能靠静态契约钉住。 */
{
  console.log('\n── ⑦ 列设置面板契约（全屏层级 + 勾选态同步）──')
  const r = run('colmenu-sync.contract.mjs', [], { timeout: 60000 })
  const tail = r.out.split('\n').filter(Boolean).slice(-2).join('\n   ')
  console.log(r.code === 0 ? '  ✅ PASS' : '  ❌ FAIL', '\n   ' + tail)
  results.push({ name: '列设置面板契约', ok: r.code === 0, code: r.code })
}

// ── ⑧ 全站「全选」统一契约 ─────────────────────────────────
/* 为什么需要第 8 组（v671）：本期预报那颗三态全选框上提成共享件后推广到 10 处，
   这类约定最典型的死法是「新页面照着老写法抄一遍」—— 抄出来的框没半选态，
   或用 `@click.prevent` 手写 ⇒ 真实鼠标一点勾选态就与真实状态永久相反
   （v669 同源，且 JS 的 el.click() 探针量不出来）⇒ 只能靠静态契约**扫全站**钉住。 */
{
  console.log('\n── ⑧ 全站「全选」统一契约（共享件 + 半选态 + 不得手写三态）──')
  const r = run('select-all.contract.mjs', [], { timeout: 60000 })
  const tail = r.out.split('\n').filter(Boolean).slice(-2).join('\n   ')
  console.log(r.code === 0 ? '  ✅ PASS' : '  ❌ FAIL', '\n   ' + tail)
  results.push({ name: '全站全选统一', ok: r.code === 0, code: r.code })
}

// ── ⑨ 勾选列内边距契约（复选框右边三个小点）──────────────────
/* 为什么需要第 9 组（v672）：缺陷由三条各自合理的规则叠出来 ——
   `.psi-tbl td{overflow:hidden;text-overflow:ellipsis}` + `table.tbl td{padding:10px 14px}`
   + 36px 勾选列 ⇒ 内容盒 8px < 13px 复选框 ⇒ Chrome 补画「…」。
   而它**只在默认密度露出来**（紧凑档 padding 8px 不溢出），所以从 v532 起潜伏了很久。
   这条契约钉「左右内边距归零 + 私有勾选列类名不得复活 + 不许靠加宽列遮」。 */
{
  console.log('\n── ⑨ 勾选列内边距契约（复选框右侧不画省略号）──')
  const r = run('chk-col-padding.contract.mjs', [], { timeout: 60000 })
  const tail = r.out.split('\n').filter(Boolean).slice(-2).join('\n   ')
  console.log(r.code === 0 ? '  ✅ PASS' : '  ❌ FAIL', '\n   ' + tail)
  results.push({ name: '勾选列内边距', ok: r.code === 0, code: r.code })
}

/* v673：副驾抽屉层级 —— 页面级非模态浮层必须让位。
   现象：侧栏（AI 副驾抽屉 z950）打开时，预报页「品牌/到货周期/复制报单」的**弹层**
   整块浮在抽屉上。根因：`.tb-pop-panel` 是 `Teleport to="body"`，v135 那条
   `.page.copilot-on .tb-pop-panel` **永不匹配**（祖先没了）⇒ 面板恒 1101；
   列菜单（.col-menu 1101 / 遮罩 1100）更是从没进过名单。
   修法：CopilotDrawer 给 `<body>` 挂 copilot-on，规则收到 styles/app-layers.css（唯一源）。 */
{
  console.log('\n── ⑩ 副驾抽屉层级契约（页面浮层不给盖抽屉）──')
  const r = run('overlay-layers.contract.mjs', [], { timeout: 60000 })
  const tail = r.out.split('\n').filter(Boolean).slice(-2).join('\n   ')
  console.log(r.code === 0 ? '  ✅ PASS' : '  ❌ FAIL', '\n   ' + tail)
  results.push({ name: '副驾抽屉层级', ok: r.code === 0, code: r.code })
}

// ⑪ 应用外壳浮层层级（v674）
/* 现象：左侧导航悬停/点开「进销存」「仓配管理」等，弹窗上有「品牌 / 到货周期 /
   复制报单」按钮浮着，条目点不到。
   根因：`.sb-pop` 写死 z-index:30，而页面工具条容器 .tb-pop 是 --z-page-bar:1120
   ⇒ 两套层级体系没对齐，位置一重叠按钮必然在上（1440 中 5 个职能区、
   1366 中 5 个且含两个按钮）。修法：新增 --z-shell-pop:1122（1120 与 1125 之间）。 */
{
  console.log('\n── ⑪ 应用外壳浮层层级契约（侧栏弹窗不被页面按钮盖）──')
  const r = run('shell-pop-layer.contract.mjs', [], { timeout: 60000 })
  const tail = r.out.split('\n').filter(Boolean).slice(-2).join('\n   ')
  console.log(r.code === 0 ? '  ✅ PASS' : '  ❌ FAIL', '\n   ' + tail)
  results.push({ name: '外壳浮层层级', ok: r.code === 0, code: r.code })
}

// ⑫ 顶部导航栏高度（v675）
/* 反馈原话：「顶部导航栏我觉得有一点点高了，请稍微调矮一点」。
   事实：高度只由 --topbar-h 决定，原先 56px，而栏内最高的三件（.tb-btn /
   .tb-copilot / .wx-now）都是 34px ⇒ 上下各 11px，比控件"松"一圈。
   修法：48px（上下各 7px）。契约钉区间 [44,52] + 上下呼吸位 ≥6px +
   唯一源（不许别处重复/改名定义、.topbar 不许写死 px）。 */
{
  console.log('\n── ⑫ 顶栏高度契约（48px · 唯一源 · 控件不挤爆）──')
  const r = run('shell-topbar-h.contract.mjs', [], { timeout: 60000 })
  const tail = r.out.split('\n').filter(Boolean).slice(-2).join('\n   ')
  console.log(r.code === 0 ? '  ✅ PASS' : '  ❌ FAIL', '\n   ' + tail)
  results.push({ name: '顶栏高度', ok: r.code === 0, code: r.code })
}

// ── 汇总 ────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok)
console.log('\n' + '='.repeat(66))
for (const r of results) {
  console.log(`  ${r.ok ? '✅' : '❌'} ${r.name.padEnd(20)} ${r.detail ?? ('rc=' + r.code)}`)
}
console.log('RESULT: ' + (failed.length === 0 ? 'ALL PASS' : `FAILED (${failed.length})`)
  + `   ${((Date.now() - t0) / 1000).toFixed(1)}s`)
console.log('='.repeat(66))
process.exit(failed.length === 0 ? 0 : 1)
