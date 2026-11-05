/* v765 / v779 契约：按品牌报单日（星期）管控的判定内核必须真正被执行。
 *
 * 起因：用户要求「某期次不属于某品牌报单日时，该品牌商品禁止提交，并提示
 * 该商品可报单时间为每周X、Y，本期不可提报」。这是一个**双向都会静默出错**的判定：
 *   判宽了 = 该拦的没拦（业务员在非报单日把单报上去，厂家侧不认）；
 *   判紧了 = 该放的拦住（全员报不了单，比漏拦贵得多）。
 * 两种都不抛异常，只会让人以为「系统就是这样」。
 *
 * 🔴 本契约要堵的正是 v764 同族那层：`.py` 校验脚本不在 `run()` 里 = 永不执行。
 *   `forecast-brand-window-check.py` 若不被注册，`npm test` 照样 ALL PASS，
 *   而判定内核改错（例如星期偏移一位）没有任何人会发现。
 *
 * v779（2026-11-05）新增：拦截层此前只判「期次截止日的星期 ∈ 报单星期」，
 *   没读 `order_max_early_days`，而自动编排层用的是「可提前 E 天」窗口
 *   ⇒ 同一期编排层判可报、小程序判不可报（简爱 43 期）。新增 V/W/X/Y/Z 五段
 *   真判据（140 项）与 9 个针对性坏样本；弹窗日期改为只认真实期次表，
 *   禁止日历推算（生产 43 期之后没有未来期次，旧文案给的 11-07 是虚构日期）。
 *
 * 判据：
 *   ① 真树校验 exit 0 + 「契约全部通过」
 *   ② 条数下限 ≥ 120（防成批删断言后仍全绿）
 *   ③ 关键段必须都在（G 核心断言 / I 现状安全 / N 配规则后生效 / R fail-safe
 *      / V 可提前窗口 / W 真实期次日期 / Y 43 期复刻 / Z AST 静态结构）
 *      —— 段被摘掉时脚本可能仍然全绿，只能靠「段是否存在」判
 *   ④ --self-test exit 0 + 坏样本自证生效
 *   ⑤ 20 个坏样本逐个「已检出」（防 SAMPLES 被删空后只打印一句 OK）
 *   ⑥ 对照组原样不改必须全绿（防「全红也算全部检出」）
 *   ⑦ 篡改自证：摘掉 G 段标题后脚本仍 exit 0 但输出无 G 段
 *      ⇒ 证明判据③ 依赖真实输出，不是恒真
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = path.resolve(import.meta.dirname, '..')
const PROJ = path.resolve(ROOT, '..')
const GUARD = path.join(PROJ, '.workbuddy/tools/forecast-brand-window-check.py')

let failed = 0
const ok = (cond, label, extra = '') => {
  if (cond) console.log('  ✅ ' + label + (extra ? ' ' + extra : ''))
  else {
    console.log('  ❌ ' + label + (extra ? ' ' + extra : ''))
    failed++
  }
}

const PY = process.env.PYTHON || 'python3'
function runPy(script, args = [], timeout = 180000, extraEnv = {}) {
  const r = spawnSync(PY, [script, ...args], {
    cwd: ROOT, encoding: 'utf8', timeout,
    env: { ...process.env, ...extraEnv },
  })
  if (r.error) return { code: -1, out: 'spawn 失败：' + r.error.message }
  return { code: r.status ?? -1, out: ((r.stdout || '') + (r.stderr || '')).trim() }
}

console.log('── v765 按品牌报单日管控 · 判定内核 ──')

const real = runPy(GUARD)
ok(real.code === 0, '判定内核校验 exit 0',
  real.code === 0 ? '' : '\n   ' + real.out.split('\n').slice(-8).join('\n   '))
ok(/品牌报单日判定契约全部通过/.test(real.out), '输出含「契约全部通过」')

/* ② 条数下限：只写"全绿"不写"有多少条"，删掉一半断言也照样全绿 */
const n = real.out.match(/全部通过（(\d+) 项）/)
ok(!!n && Number(n[1]) >= 120, '断言条数 ≥ 120', n ? ` ${n[1]}` : ' — 未找到条数')

/* ③ 关键段必须真的被跑到 —— 「有没有这条检查」≠「检查有没有被执行」 */
const sections = (real.out.match(/=== ([A-Z]) /g) || []).map((s) => s.slice(4, 5))
const need = {
  G: '生产真实 23 期核心断言',
  I: '现状（星期全空）必须全放行',
  N: '配上规则后必须真的拦住',
  S: '行内短标签 weekdays_label',
  T: 'preview 规则行带 rule_id',
  R: '坏库必须回落全放行',
  V: 'v779 可提前窗口（与编排层同构）',
  W: '弹窗日期只认真实期次表',
  X: 'rules_from_rows 读 order_max_early_days',
  Y: '生产 43 期复刻（简爱提前一天放行）',
  Z: 'AST 静态结构（防 docstring 自撞）',
}
for (const [k, desc] of Object.entries(need)) {
  ok(sections.includes(k), `含 ${k} 段：${desc}`)
}
ok(sections.length >= 24, '段数 ≥ 24', ` ${sections.length}`)

/* ④ 自检：真源码全绿不能证明"在检查"，必须让它自证 */
const st = runPy(GUARD, ['--self-test'])
ok(st.code === 0, '--self-test exit 0',
  st.code === 0 ? '' : '\n   ' + st.out.split('\n').slice(-10).join('\n   '))
ok(/坏样本自证全部生效/.test(st.out), '输出含「坏样本自证全部生效」')

/* ⑤ 20 个坏样本必须逐个「已检出」—— 防 SAMPLES 被删空 */
const hit = (st.out.match(/样本\d+ 已检出/g) || []).length
ok(hit >= 18, '坏样本逐个已检出', ` ${hit}/20`)
ok(!/样本\d+ 未被检出/.test(st.out), '无「未被检出」（不存在空白支票）')
ok(!/锚点未命中/.test(st.out), '无「锚点未命中」（坏样本与源码未漂移）')

/* ⑥ 对照组 */
ok(/对照组（原样不改）全绿/.test(st.out), '对照组原样不改时全绿（防「全红也算检出」）')

/* ⑦ 篡改自证：摘掉 G 段标题，脚本仍 exit 0，但输出里没有 G 段
      ⇒ 证明判据③ 是真判据。 */
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-mut-'))
try {
  const src = fs.readFileSync(GUARD, 'utf8')
  const cut = src.replace(/^([ \t]*)print\('=== G [^\n]*\n/m, '$1pass  # 段标题被摘掉\n')
  if (cut === src) {
    ok(false, '篡改自证：未能在脚本里定位 G 段标题（判据③ 无法验证）')
  } else {
    const p = path.join(tmpDir, 'mutated.py')
    fs.writeFileSync(p, cut)
    /* 副本挪到了 /tmp，脚本按自身位置推不出后端目录 ⇒ 必须显式指回去 */
    const m = runPy(p, [], 180000, { BW_REMOTE: path.join(PROJ, '.workbuddy/remote-erp') })
    const stillGreen = m.code === 0
    const hasG = /=== G /.test(m.out)
    ok(stillGreen && !hasG,
      '篡改自证：摘掉 G 段标题后仍 exit 0 但没有 G 段（证明判据③依赖真实输出）',
      stillGreen && !hasG ? '' : ` green=${stillGreen} hasG=${hasG}`)
  }
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true })
}

console.log('')
if (failed) {
  console.log(`❌ 失败 ${failed} 项`)
  process.exit(1)
}
console.log('✓ v765 / v779 品牌报单日判定契约全部通过')
