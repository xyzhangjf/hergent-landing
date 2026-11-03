/* v739 生产验收：客户列整列拖动
 * 验四件事（少一件就说明功能没落地）：
 *   ① 拖动真的换位（不是只有光标变）；
 *   ② 表尾合计**跟着列名走**（换位后 名→值 映射不变）—— 这条最容易悄悄坏；
 *   ③ 松手后云端已存（GET /api/ui/col-prefs 的 cfg.cust）；
 *   ④ 刷新后顺序还在（真正"持久化"）；
 * 最后把顺序**还原**，不在生产上留下测试态。
 */
import { launch, CHROME_DEFAULT } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const TOKEN = fs.readFileSync('/tmp/probe_tok.txt', 'utf8').trim()
const OUT = '/tmp/v739'
fs.mkdirSync(OUT, { recursive: true })

let failed = 0
const ok = (cond, label, extra = '') => {
  console.log((cond ? '  ✅ ' : '  ❌ ') + label + (extra ? ' ' + extra : ''))
  if (!cond) failed++
}

const b = await launch({ headless: true, chromePath: CHROME_DEFAULT })
const p = await b.newPage()
await p.enable()
for (const c of [
  { name: 'erp_token', value: TOKEN, httpOnly: true },
  { name: 'hergent_auth', value: '1' }, { name: 'csrf_token', value: 'x' }, { name: 'hergent_tenant', value: '1' },
]) await p.raw.send('Network.setCookie', { ...c, domain: 'hergent.cn', path: '/', secure: true, sameSite: 'Lax' })
await p.raw.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 950, deviceScaleFactor: 1, mobile: false })

const READ = `(function(){
  const ths = [...document.querySelectorAll('.cross-viewport thead th.cust-col')]
  // 表尾不在 .cross-viewport 里，它是另一张吸底表(.col-total)；按视口找会永远读到空
  const foot = [...document.querySelectorAll('tr.col-total td')]
  // 表尾：客户列按顺序取（cust-col 的类名在 td 上是 qty-cell）
  const footQty = foot.filter(td => td.classList.contains('qty-cell'))
  return JSON.stringify({
    build: window.__HG_BUILD__,
    n: ths.length,
    labels: ths.map(t => (t.innerText || '').trim()),
    foot: ths.map((t, i) => ((footQty[i] ? footQty[i].innerText : '').trim())),
    rects: ths.map(t => { const r = t.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } }),
  })
})()`

async function read () { return JSON.parse(await p.eval(READ)) }
async function mouse (type, x, y, buttons = 0) {
  await p.raw.send('Input.dispatchMouseEvent', {
    type, x: Math.round(x), y: Math.round(y), button: 'left', buttons, clickCount: 1,
  })
}
async function drag (fromIdx, toX) {
  const d = await read()
  const a = d.rects[fromIdx]
  if (!a) throw new Error('无第 ' + fromIdx + ' 列')
  const y = a.y + a.h / 2
  const x0 = a.x + a.w / 2
  await mouse('mouseMoved', x0, y, 0)
  await mouse('mousePressed', x0, y, 1)
  const steps = 14
  for (let i = 1; i <= steps; i++) {
    await mouse('mouseMoved', x0 + (toX - x0) * i / steps, y, 1)
    await new Promise(r => setTimeout(r, 28))
  }
  return { y, x: toX }
}

await p.goto('https://hergent.cn/#/forecast', 6000)
let d0 = await read()
console.log('构建=' + d0.build + ' 客户列数=' + d0.n)
if (d0.build !== 'v739') { console.log('❌ 线上不是 v739，中止'); await b.close(); process.exit(1) }
if (d0.n < 3) { console.log('❌ 客户列不足 3 列，无法验收'); await b.close(); process.exit(1) }
console.log('  原顺序前 8：' + d0.labels.slice(0, 8).join(' | '))
/** 名 → 表尾值（排序无关）。**不能**按位置拼字符串：位置一换，"对得上"就永远为假。 */
const mapOf = (d) => Object.fromEntries(d.labels.map((n, i) => [n, d.foot[i]]))
const mapEq = (a, b) => {
  const ka = Object.keys(a), kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  return ka.every(k => a[k] === b[k])
}
const nonEmpty = (m) => Object.values(m).filter(v => v && v !== '0').length

/* ① 把第 1 列拖到第 3 列右侧（= 插到第 3 列之后） */
console.log('\n== 拖动：第 1 列 → 第 3 列之后 ==')
const target = d0.rects[2]
const { y } = await drag(0, target.x + target.w * 0.85)
await p.screenshot(OUT + '/drag-mid.png')       // 松手前抓一张（应能看到跟手胶囊 + 源列高亮）
await mouse('mouseReleased', target.x + target.w * 0.85, y, 0)
await new Promise(r => setTimeout(r, 700))
let d1 = await read()
console.log('  新顺序前 8：' + d1.labels.slice(0, 8).join(' | '))
ok(d1.labels[2] === d0.labels[0], '第 1 列已落在第 3 位（插到原第 3 列之后）', `${d0.labels[0]} → idx2`)
ok(d1.labels.slice(0, 3).join(',') === [d0.labels[1], d0.labels[2], d0.labels[0]].join(','), '前三个是原来 2,3,1')
ok(d1.labels.length === d0.labels.length, '列数不变（不是复制/丢失）')

/* ② 表尾合计必须跟着列走 */
const m0 = mapOf(d0), m1 = mapOf(d1)
/* 🔴 先证明这条判据**不是空转**：本期表尾若全空，"映射一致"在任何顺序下都成立（假绿灯）。 */
ok(nonEmpty(m0) >= 3, '本期表尾客户列有非空合计（否则下一条是空转）', '非空列=' + nonEmpty(m0))
ok(mapEq(m1, m0), '表尾合计按列名对得上（换位后 名→值 不变）',
  mapEq(m1, m0) ? '' : '\n     改前: ' + JSON.stringify(m0) + '\n     改后: ' + JSON.stringify(m1))

/* ③ 云端已存 */
const pref = JSON.parse(await p.eval(`fetch('/api/ui/col-prefs?page=forecast', { credentials:'include' }).then(r=>r.json()).then(j=>JSON.stringify(j))`))
const cust = (pref && pref.pref && pref.pref.cust) || null
ok(Array.isArray(cust) && cust[2] === d0.labels[0], 'cfg.cust 已写云端（第 3 位就是刚拖的那列）',
  cust ? 'cust[0..3]=' + cust.slice(0, 4).join(',') : 'cfg.cust 缺失')

/* ④ 刷新后仍生效 */
console.log('\n== 刷新（完整重进）==')
await p.goto('about:blank', 400)
await p.goto('https://hergent.cn/#/forecast', 6000)
let d2 = await read()
ok(d2.labels.slice(0, 3).join(',') === d1.labels.slice(0, 3).join(','), '刷新后顺序保持（持久化生效）',
  d2.labels.slice(0, 3).join(','))

/* 还原：把这一列从 idx2 拖回最前 */
console.log('\n== 还原到拖动前顺序 ==')
const first = d2.rects[0]
const { y: y2 } = await drag(2, first.x + 2)
await mouse('mouseReleased', first.x + 2, y2, 0)
await new Promise(r => setTimeout(r, 800))
let d3 = await read()
ok(d3.labels.slice(0, 4).join(',') === d0.labels.slice(0, 4).join(','), '顺序已还原',
  d3.labels.slice(0, 4).join(','))
ok(mapEq(mapOf(d3), m0), '还原后表尾合计仍对得上')

/* 键盘等价路径：Alt+→ 就地验证一次（再还原） */
console.log('\n== 键盘 Alt + → ==')
await p.eval(`(function(){ const th=document.querySelector('.cross-viewport thead th.cust-col'); if(th){ th.focus(); } return 1 })()`)
await p.raw.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, modifiers: 1 })
await p.raw.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, modifiers: 1 })
await new Promise(r => setTimeout(r, 600))
let d4 = await read()
ok(d4.labels[0] === d0.labels[1] && d4.labels[1] === d0.labels[0], 'Alt+→ 把第 1 列后移一位',
  d4.labels.slice(0, 2).join(','))
await p.eval(`(function(){ const th=document.querySelectorAll('.cross-viewport thead th.cust-col')[1]; if(th){ th.focus(); } return 1 })()`)
await p.raw.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37, modifiers: 1 })
await p.raw.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37, modifiers: 1 })
await new Promise(r => setTimeout(r, 600))
let d5 = await read()
ok(d5.labels.slice(0, 3).join(',') === d0.labels.slice(0, 3).join(','), 'Alt+← 再移回来（键盘路径可逆）')

console.log('\n结论：' + (failed ? `❌ ${failed} 条未通过` : '✅ 全部通过'))
await b.close()
process.exit(failed ? 1 : 0)
