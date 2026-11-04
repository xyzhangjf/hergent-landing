/* v764 契约：登录页「仅限本企业员工内部使用」这条**审核硬要求**必须真正被执行。
 *
 * 起因：用户问「这几个字是合规必须要的吗？不是的话能否去掉」。
 * 查到的事实：它是微信《小程序帐号登录规范要求与修改指引》对「体验范围特定」类
 * 小程序（仅内部人员使用、对外无注册流程）的硬要求 ——
 *   整改建议①「首页有明显的使用范围（特定范围）说明」
 *   官方合规案例原话：「一进入页面即说明提示仅限内部员工可使用，并已进行账号鉴权」
 * 社区置顶驳回回复 + 2026-05-25 真人申诉「我的小程序是内部使用的，不需要公开的」
 * 仍被要求整改 ⇒ **「内部使用」不是豁免理由，恰恰是必须写说明的理由**。
 *
 * 🔴 本契约要堵的是第三层，和 v748 品牌色那条同族：
 *   `.workbuddy/tools/miniprogram-legal-consistency-check.py` 此前**没有任何 runner 在跑**。
 *   它的 38 项一直是人工敲命令、看到 ALL GREEN 就以为"合规查过了"。
 *   而这条文案本身**没有任何断言**：删掉它 `npm test` 照样全绿，要等提审被驳回才发现。
 *   ⇒ 本契约做两件事：把校验接进 `npm test`，并**强制它自证**（`--self-test` 往副本注入
 *     8 种错误写法，每种必须被判红）。
 *
 * 判据（①–③ 防"护栏被绕过"，④–⑥ 防"护栏是空白支票"）：
 *   ① 真树校验 exit 0 + RESULT: ALL GREEN
 *   ② 输出里**确实有 H 组且 10/10**（防 group_h 被从 main() 里摘掉后仍全绿）
 *   ③ 总条目数 ≥ 45（防成批删断言后仍全绿）
 *   ④ --self-test exit 0 + SELF-TEST: OK
 *   ⑤ 自检输出里 8 个坏样本逐个 OK（防 cases 列表被删空，只留一句"OK"）
 *   ⑥ 篡改自证：把 group_h 从 main() 摘掉后，输出仍然 ALL GREEN 但**没有 H 组**
 *      ⇒ 证明 ② 确实依赖「输出里有 H 组」，不是恒真
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = path.resolve(import.meta.dirname, '..')
const PROJ = path.resolve(ROOT, '..')
const GUARD = path.join(PROJ, '.workbuddy/tools/miniprogram-legal-consistency-check.py')

let failed = 0
const ok = (cond, label, extra = '') => {
  if (cond) console.log('  ✅ ' + label + (extra ? ' ' + extra : ''))
  else {
    console.log('  ❌ ' + label + (extra ? ' ' + extra : ''))
    failed++
  }
}

const PY = process.env.PYTHON || 'python3'
function runPy(script, args = [], timeout = 120000) {
  const r = spawnSync(PY, [script, ...args], { cwd: ROOT, encoding: 'utf8', timeout })
  if (r.error) return { code: -1, out: 'spawn 失败：' + r.error.message }
  return { code: r.status ?? -1, out: ((r.stdout || '') + (r.stderr || '')).trim() }
}

console.log('── v764 登录页「使用范围说明」审核合规 ──')

/* ① 真树校验 */
const real = runPy(GUARD)
ok(real.code === 0, '合规校验脚本 exit 0', real.code === 0 ? '' : '\n   ' + real.out.split('\n').slice(-6).join('\n   '))
ok(/RESULT:\s*ALL GREEN/.test(real.out), '输出含 RESULT: ALL GREEN')

/* ② H 组必须真的被主流程跑到 —— 「有没有这条检查」≠「检查有没有被执行」 */
const h = real.out.match(/【H [^】]*】\s*(\d+)\/(\d+)/)
ok(!!h, '输出包含 H 组（说明 group_h 确实注册进了 main()）',
  h ? ` ${h[1]}/${h[2]}` : ' — 整组缺失，等于这条文案没有任何护栏')
if (h) ok(Number(h[1]) === Number(h[2]) && Number(h[2]) === 10, 'H 组 10/10 全通过', ` ${h[1]}/${h[2]}`)

/* ③ 条目数下限：只写"全绿"不写"有多少条"，删掉一半断言也照样全绿 */
const tot = real.out.match(/总计 (\d+)\/(\d+)/)
ok(!!tot && Number(tot[1]) === Number(tot[2]) && Number(tot[2]) >= 45,
  '总断言条数 ≥ 45 且全通过', tot ? ` ${tot[1]}/${tot[2]}` : ' — 未找到总计行')

/* ④ 自检：真源码全绿不能证明"在检查"，必须让它自证 */
const st = runPy(GUARD, ['--self-test'])
ok(st.code === 0, '--self-test exit 0', st.code === 0 ? '' : '\n   ' + st.out.split('\n').slice(-10).join('\n   '))
ok(/SELF-TEST:\s*OK/.test(st.out), '输出含 SELF-TEST: OK')

/* ⑤ 8 个坏样本必须逐个 OK —— 防 cases 被删空后只打印一句"OK" */
const caseLines = st.out.split('\n').filter((l) => /^坏样本/.test(l))
const caseOk = caseLines.filter((l) => /\sOK$/.test(l))
ok(caseLines.length >= 8, '坏样本用例数 ≥ 8', ` ${caseLines.length}`)
ok(caseOk.length === caseLines.length && caseOk.length >= 8,
  '每个坏样本都被检出（无「未检出」）', ` ${caseOk.length}/${caseLines.length}`)
ok(/对照组（原样不改）.*红 0.*OK/.test(st.out), '对照组原样不改时全绿（防「全红也算检出」）')

/* ⑥ 篡改自证：摘掉 group_h 后仍 ALL GREEN，但输出里没有 H 组
      ⇒ 证明 ② 是真判据，不是恒真的空话。ROOT 需硬编码，否则副本按自身位置推算会找错目录。 */
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'legal-mut-'))
let mutated = null
try {
  const src = fs.readFileSync(GUARD, 'utf8')
  const cut = src.replace(
    /^(\s*for fn in \()(group_a, group_b, group_c, group_d, group_e, group_f, group_g), group_h(\)):/m,
    '$1$2$3:'
  )
  if (cut === src) {
    ok(false, '篡改自证：未能在 main() 里定位 group_h 的注册（判据 ② 无法验证）')
  } else {
    const hard = cut.replace(/^ROOT = os\.path\.abspath\(.*$/m, `ROOT = ${JSON.stringify(PROJ)}`)
    const p = path.join(tmpDir, 'mutated.py')
    fs.writeFileSync(p, hard)
    mutated = runPy(p)
    const stillGreen = mutated.code === 0 && /RESULT:\s*ALL GREEN/.test(mutated.out)
    const hasH = /【H [^】]*】/.test(mutated.out)
    ok(stillGreen && !hasH,
      '篡改自证：摘掉 group_h 后仍全绿但没有 H 组（证明判据②依赖真实输出）',
      stillGreen && !hasH ? '' : ` green=${stillGreen} hasH=${hasH}`)
    ok(!/【H [^】]*】\s*(\d+)\/(\d+)/.test(mutated.out),
      '此类篡改会被判据②当场抓住')
  }
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true })
}

console.log('')
if (failed) {
  console.log(`❌ 失败 ${failed} 项`)
  process.exit(1)
}
console.log('✓ v764 使用范围说明契约全部通过')
