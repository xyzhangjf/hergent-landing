/* v183 纯逻辑校验：从 Forecast.vue 真切片取出真函数执行（不是复制一份逻辑）
 * 目的：把「达成率文案 + 配色判定」在浏览器之外独立算一遍，验证：
 *   ① 文案格式与精度（1 位小数、整数不带 .0）
 *   ② 配色三态与边界（0.05 个百分点）
 *   ③ 🔴 新增不变量：到货月未开始时（frac=0）**没有颜色但必须有达成率文案**
 *      —— v181/182 时文案挂在 sprintPaceOf 上，frac=0 会连达成率一起消失
 *   ④ 配色与文案同源（sprintBarClass 复用 sprintPaceOf）
 */
import fs from 'fs'

const SRC = '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/src/pages/Forecast.vue'
const raw = fs.readFileSync(SRC, 'utf8')

/* 按「起始标记 + 花括号配平」精确切出函数体（切不到就报错，绝不静默用空实现） */
function cut(startMarker) {
  const i = raw.indexOf(startMarker)
  if (i < 0) throw new Error('切不到: ' + startMarker)
  let depth = 0, started = false
  for (let j = i; j < raw.length; j++) {
    if (raw[j] === '{') { depth++; started = true }
    else if (raw[j] === '}') { depth--; if (started && depth === 0) return raw.slice(i, j + 1) }
  }
  throw new Error('花括号不配平: ' + startMarker)
}

const parts = [
  cut('function paceNum(v) {'),
  'const PACE_EPS = 0.05',
  cut('function sprintPaceOf(ach) {'),
  cut('function sprintAchText(ach) {'),
  cut('function sprintBarClass(ach) {'),
]
const slice = parts.join('\n\n')

/* sprintTimeProgress 由组件 computed 提供 → 作为自由变量注入（可替换成任意口径做边界测试） */
const build = new Function('sprintTimeProgress', slice + '\n;return { paceNum, PACE_EPS, sprintPaceOf, sprintAchText, sprintBarClass }')

let pass = 0, fail = 0
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + label + (extra ? '   [' + extra + ']' : '')) }
  else { fail++; console.log('  ✗ ' + label + (extra ? '   [' + extra + ']' : '')) }
}
const eq = (got, want, label) => ok(got === want, label, `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`)

const F = 17 / 30                       // 2026-09-17 → 本月真实日期进度
const withFrac = f => build({ value: { frac: f, pct: Math.round(f * 100), pct1: String(f * 100), shown: f > 0 && f < 1 } })
const M = withFrac(F)

console.log('切片长度 ' + slice.length + ' 字符 / ' + parts.length + ' 段（来自 ' + SRC.split('/').pop() + '）')
console.log('\n=== A. sprintAchText：格式与精度 ===')
eq(M.sprintAchText(0.61372), '达成率 61.4%', '61.372% → 达成率 61.4%')
eq(M.sprintAchText(17 / 30), '达成率 56.7%', '56.667% → 达成率 56.7%')
eq(M.sprintAchText(0.5625), '达成率 56.3%', '56.25% → 兑现 1 位小数（四舍五入）')
eq(M.sprintAchText(0.4), '达成率 40%', '整数不带 .0')
eq(M.sprintAchText(0), '达成率 0%', '零值照显（不是「—」）')
eq(M.sprintAchText(1), '达成率 100%', '满额')
eq(M.sprintAchText(1.2), '达成率 120%', '超额不截断')
eq(M.sprintAchText(0.0005), '达成率 0.1%', '极小值不丢位')
eq(M.sprintAchText(null), '', 'ach 缺失 → 空串（模板 v-if 兜住）')
ok(!/\d\.0%$/.test(M.sprintAchText(0.5)), '不出现「50.0%」这类多余尾零', M.sprintAchText(0.5))

console.log('\n=== B. sprintPaceOf：配色三态与边界（frac=' + (F * 100).toFixed(3) + '%）===')
eq((M.sprintPaceOf(0.61372) || {}).cls, 'pace-ahead', '达成 61.372% → ahead（绿）')
eq((M.sprintPaceOf(0.5625) || {}).cls, 'pace-behind', '达成 56.250% → behind（红）')
eq((M.sprintPaceOf(F) || {}).cls, 'pace-even', '达成＝时间进度 → even（灰）')
eq((M.sprintPaceOf(F + 0.0004) || {}).cls, 'pace-even', '差 +0.04 个百分点 → 仍 even（阈值下沿）')
eq((M.sprintPaceOf(F + 0.0006) || {}).cls, 'pace-ahead', '差 +0.06 个百分点 → ahead（阈值上沿）')
eq((M.sprintPaceOf(F - 0.0006) || {}).cls, 'pace-behind', '差 −0.06 个百分点 → behind')
eq(M.sprintPaceOf(null), null, 'ach 缺失 → null')
ok(Math.abs((M.sprintPaceOf(0.61372) || {}).pp - 4.7053) < 0.01, 'pp 是真实差值（非先各取整再相减）', String((M.sprintPaceOf(0.61372) || {}).pp))
ok(!('text' in (M.sprintPaceOf(0.61372) || {})), 'sprintPaceOf 已不再产出文案（v183 解耦，避免两套文案）')

console.log('\n=== C. 边界：到货月未开始 / 已结束 ===')
const P0 = withFrac(0)      // 未来月
const P1 = withFrac(1)      // 过去月
eq(P0.sprintPaceOf(0.3), null, 'frac=0（到货月未开始）→ 不判色（走中性）')
eq(P0.sprintBarClass(0.3), '', 'frac=0 → 进度条无色（不做「0 达成也判绿」的误判）')
eq(P0.sprintAchText(0.3), '达成率 30%', '🔴 frac=0 时必须仍显示达成率（v181/182 会连它一起消失）')
eq(P1.sprintBarClass(0.5), 'red', 'frac=1（过去月）→ 达成 50% 判红')
eq(P1.sprintBarClass(1), 'green', 'frac=1 且满额 → 判绿')
eq(P1.sprintAchText(0.5), '达成率 50%', 'frac=1 时文案照常')

console.log('\n=== D. 配色与进度条同源（sprintBarClass 复用 sprintPaceOf）===')
for (const a of [0.61372, 0.5625, F, 0, 1, 1.5]) {
  const p = M.sprintPaceOf(a)
  const want = p ? (p.state === 'behind' ? 'red' : 'green') : ''
  eq(M.sprintBarClass(a), want, `ach=${a} → bar=${want || '(无色)'}，与 pace state=${p ? p.state : 'null'} 一致`)
}
eq(M.sprintBarClass(null), '', 'ach 缺失 → bar 无色')

console.log('\n结果：PASS ' + pass + ' / FAIL ' + fail)
process.exit(fail === 0 ? 0 : 1)
