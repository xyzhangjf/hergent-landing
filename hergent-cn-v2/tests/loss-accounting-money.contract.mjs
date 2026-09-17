/* 万元↔元 换算的往返测试 —— 直接 eval SFC 里的**真实实现**（不复制逻辑，
   否则测的是副本、真实现照样能错）。
   用法：node check_wan_roundtrip.mjs src/pages/LossAccounting.vue
*/
import fs from 'fs'

const file = process.argv[2]
const src = fs.readFileSync(file, 'utf8')

function grab(re, name) {
  const m = src.match(re)
  if (!m) { console.error('XX 未能在源码里找到 ' + name); process.exit(2) }
  return m[0]
}

const parts = [
  grab(/const YUAN_PER_WAN = \d+/, 'YUAN_PER_WAN'),
  grab(/const wanToYuan = \(txt\) => \{[\s\S]*?\n\}/, 'wanToYuan'),
  grab(/function wanText\(v\) \{[\s\S]*?\n\}/, 'wanText'),
]
const { wanToYuan, wanText } = new Function(parts.join('\n') + '\nreturn { wanToYuan, wanText }')()

let fail = 0
const chk = (name, got, want) => {
  const ok = Object.is(got, want) || (Number.isNaN(got) && Number.isNaN(want))
  if (!ok) fail++
  console.log(`  ${ok ? 'OK' : 'XX'} ${name.padEnd(40)} got=${JSON.stringify(got)} want=${JSON.stringify(want)}`)
}

console.log('=== 1 元 → 万元 展示 ===')
chk('0 元', wanText(0), '0')
chk('150000 元', wanText(150000), '15')
chk('15500 元', wanText(15500), '1.55')
chk('8333 元', wanText(8333), '0.8333')
chk('2000000 元', wanText(2000000), '200')
chk('1234567 元（带千分位）', wanText(1234567), '123.4567')
chk('null', wanText(null), '—')

console.log('\n=== 2 万元 → 元（关键是消掉浮点残差）===')
chk('空串', wanToYuan(''), null)
chk('"0"', wanToYuan('0'), 0)
chk('"15"', wanToYuan('15'), 150000)
chk('"1.55"', wanToYuan('1.55'), 15500)
chk('"0.8333"（浮点陷阱）', wanToYuan('0.8333'), 8333)
chk('"0.0001"', wanToYuan('0.0001'), 1)
chk('"123.4567"', wanToYuan('123.4567'), 1234567)
chk('"abc" → NaN', wanToYuan('abc'), NaN)
chk('"  " → null', wanToYuan('   '), null)

console.log('\n=== 3 往返（展示 → 再输入 → 必须回到原值）===')
for (const v of [0, 1, 8333, 15500, 150000, 2000000, 1234567, 99999999]) {
  const shown = wanText(v).replace(/,/g, '')
  chk(`${v} → "${shown}" → `, wanToYuan(shown), v)
}

console.log('\n=== 4 精度边界（万元保留 4 位小数 ⇒ 最小可表示 1 元）===')
chk('0.5 元 → 展示', wanText(0.5), '0.0001')       // 会被四舍五入到 1 元
chk('0.5 元 → 往返', wanToYuan(wanText(0.5).replace(/,/g, '')), 1)
console.log('  ℹ️ 金额精确到「元」；元以下小数在展示时被四舍五入（业务上不会用到分）')

console.log('\n' + '='.repeat(60))
if (fail) { console.log(`失败 ${fail} 项`); process.exit(1) }
console.log('全部通过')
