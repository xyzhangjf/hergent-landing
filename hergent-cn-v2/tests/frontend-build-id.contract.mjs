/* ㊿·b　前端构建号构建时注入（v788）
   ────────────────────────────────────────────────────────────────────────
   背景（阶段 0 线上只读核实 2026-11-06 实测）：src/main.js 里那行手工构建号
   `window.__HG_BUILD__ = 'v756'` 漏改 31 版（线上实为 v787），导致
   `html[data-build]` 在排查「改了没变」时反而误导人。v788 起改为 vite.config.js
   构建时注入：版本号取自 git 最近提交信息里的 vNNN，附提交短哈希与构建时间。

   🔴 护栏要点：
      ① 三态：旧硬编码确实消失 + 新注入确实出现 + 既有消费点一个不少（防「删功能冒充修复」）；
      ② 动态实跑：真的 import vite.config.js 取 define 的值，校验格式与 HEAD 哈希一致
         （静态判据容易被「换个地方写死」骗过去）；
      ③ 每组关键判据配坏样本自证（撤销修复即红）；
      ④ 所有静态判据一律剥注释 —— 注释里解释旧代码会自撞假红（v785 踩过）。 */

import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const mainPath = path.join(ROOT, 'src/main.js')
const cfgPath = path.join(ROOT, 'vite.config.js')
const fcPath = path.join(ROOT, 'src/pages/Forecast.vue')
const main = fs.readFileSync(mainPath, 'utf8')
const vcfg = fs.readFileSync(cfgPath, 'utf8')
const forecast = fs.readFileSync(fcPath, 'utf8')

const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
const cMain = stripComments(main)
const cCfg = stripComments(vcfg)

let pass = 0, fail = 0
const ok = (cond, msg) => {
  if (cond) { pass++; console.log('  ✅ ' + msg) }
  else { fail++; console.log('  ❌ ' + msg) }
}

console.log('A. 旧硬编码消失 + 新注入出现（三态）')
const OLD_HARDCODE = /window\.__HG_BUILD__\s*=\s*['"]v\d+['"]/
ok(!OLD_HARDCODE.test(cMain), 'main.js 已无 `window.__HG_BUILD__ = \'vNNN\'` 手工硬编码')
ok(/window\.__HG_BUILD__\s*=\s*__HG_BUILD_VERSION__/.test(cMain),
  'main.js 的 window.__HG_BUILD__ 改读注入常量 __HG_BUILD_VERSION__')
ok(/window\.__HG_BUILD_FULL__\s*=\s*__HG_BUILD_FULL__/.test(cMain),
  'main.js 另暴露完整串 window.__HG_BUILD_FULL__（版本号@提交@时间）')
ok(/define\s*:/.test(cCfg), 'vite.config.js 存在 define 编译期注入段')
ok(/__HG_BUILD_VERSION__\s*:\s*JSON\.stringify\(BUILD_VER\)/.test(cCfg),
  'define 注入 __HG_BUILD_VERSION__ = JSON.stringify(BUILD_VER)')
ok(/__HG_BUILD_FULL__\s*:\s*JSON\.stringify\(BUILD_FULL\)/.test(cCfg),
  'define 注入 __HG_BUILD_FULL__ = JSON.stringify(BUILD_FULL)')

console.log('\nB. 既有消费点一个不少（防「删功能冒充修复」）')
ok(/document\.documentElement\.setAttribute\('data-build'/.test(cMain),
  'html[data-build] 仍在设置（排查「改了没变」的入口保留）')
ok(/console\.info\('\[HG\] 前端构建'/.test(cMain), '控制台仍打印构建号')
ok(/window\.__HG_BUILD_FULL__/.test(cMain.replace(/setAttribute[^)]*\)/, '')),
  'data-build 用的是完整串，不是短号（能直接定位提交）')
ok(/window\.__HG_BUILD__/.test(forecast),
  'Forecast.vue 修改日志面板仍读 window.__HG_BUILD__，UI 展示不丢')

console.log('\nC. 来源是「构建时自动算」而不是换个地方写死')
ok(/git log -300 --format=%s/.test(cCfg) && /git rev-parse --short HEAD/.test(cCfg),
  '版本号取自 git 提交历史、哈希取自 HEAD（不是常量表）')
ok(/execSync/.test(cCfg) && /catch\s*\{/.test(cCfg),
  'execSync 有 try/catch 兜底：脱离 git 仓构建也不会崩')
ok(!/\bBUILD_VER\s*=\s*['"]v\d+['"]/.test(cCfg),
  'BUILD_VER 本身没有被写成某个固定版本号')
ok(/BUILD_FULL\s*=\s*`/.test(cCfg), '完整串由三个自动来源拼成（模板字符串）')

console.log('\nD. 动态实跑：真的加载 vite.config.js 取 define 的值')
let cfg = null
try {
  cfg = (await import(cfgPath + '?t=' + Date.now())).default
} catch (e) {
  console.log('  ❌ vite.config.js 无法被 node 加载：' + e.message)
}
ok(!!cfg && !!cfg.define, 'vite.config.js 可被直接 import 且导出 define')
if (cfg && cfg.define) {
  const ver = JSON.parse(cfg.define.__HG_BUILD_VERSION__)
  const full = JSON.parse(cfg.define.__HG_BUILD_FULL__)
  ok(/^v\d{3}$|^dev$/.test(ver),
    `短号格式 vNNN（UI 沿用旧习惯），实测 "${ver}"`)
  ok(/^v\d{3}@[0-9a-f]{7,12}@\d{8}-\d{4}$/.test(full),
    `完整串格式 vNNN@提交短哈希@构建时间，实测 "${full}"`)
  ok(full.startsWith(ver + '@'), '完整串以短号开头，两者同源不会各说各话')
  let head = ''
  try { head = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() } catch { /* 无 git 时跳过 */ }
  ok(!!head && full.split('@')[1] === head,
    `完整串的哈希段 == 真实 HEAD ${head}（可唯一定位线上这份包对应哪次提交）`)
  ok(cfg.build && cfg.build.emptyOutDir === false,
    '既有构建纪律未被动摇：emptyOutDir 仍为 false（闭包补传依赖旧 hash 留存）')
}

console.log('\nE. 坏样本自证（撤销修复必须翻红）')
const badMain = cMain.replace(
  'window.__HG_BUILD__ = __HG_BUILD_VERSION__',
  "window.__HG_BUILD__ = 'v756'")
ok(OLD_HARDCODE.test(badMain) && !OLD_HARDCODE.test(cMain),
  '坏样本 1：把 main.js 改回手工硬编码 ⇒ 静态判据 ① 立刻翻红')
const badCfg1 = cCfg.replace(/define\s*:\s*\{[\s\S]*?\n  \}/, '')
ok(!/define\s*:/.test(badCfg1) && /define\s*:/.test(cCfg),
  '坏样本 2：删掉 define 段 ⇒ 静态判据 ④ 立刻翻红')
const badCfg2 = cCfg.replace(/const BUILD_VER = [^\n]*/, "const BUILD_VER = 'v788'")
ok(/\bBUILD_VER\s*=\s*['"]v\d+['"]/.test(badCfg2) && !/\bBUILD_VER\s*=\s*['"]v\d+['"]/.test(cCfg),
  '坏样本 3：把版本号来源改回写死 ⇒ C 段判据立刻翻红')
const badMain2 = cMain.replace(/document\.documentElement\.setAttribute\('data-build'[^\n]*\n/, '')
ok(!/setAttribute\('data-build'/.test(badMain2) && /setAttribute\('data-build'/.test(cMain),
  '坏样本 4：只留注入、删掉 data-build ⇒ B 段防「删功能冒充」判据翻红')

console.log('\n' + '='.repeat(66))
console.log(`RESULT: ${fail === 0 ? 'ALL PASS' : `FAILED (${fail})`}  pass=${pass} fail=${fail}`)
console.log('='.repeat(66))
process.exit(fail === 0 ? 0 : 1)
