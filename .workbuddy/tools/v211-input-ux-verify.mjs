#!/usr/bin/env node
/* v211 离线护栏 —— 单元格输入体验第一批（商品名补全 / 移动端数字键盘 / 触屏可读错误原因）
   读真实源码做形态断言。用法：
     node v211-input-ux-verify.mjs [Forecast.vue 路径]

   设计纪律（沿用 v210）：
   1. 每条断言都要能因「改坏源码」而变红 —— 否则它是恒真断言，比没有守卫更危险（用 v211-guard-falsify.mjs 反证）。
   2. 断言要打**判据**，不是打「有没有这个词」：例如 B2 不只要求单价格有 inputmode，
      还要求它**不是** numeric（numeric 会让安卓上的小数点键消失，把"有 inputmode"当成"对了"就漏掉这个）。
   3. 不做静默跳过：前置不成立就直接红。 */
import fs from 'node:fs'

const SRC = process.argv[2] || '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/src/pages/Forecast.vue'
const src = fs.readFileSync(SRC, 'utf8')

let pass = 0, fail = 0
const lines = []
function ok(name, cond, ev) {
  if (cond) { pass++; lines.push('  ✅ ' + name + (ev ? '   ' + ev : '')) }
  else { fail++; lines.push('  ❌ ' + name + (ev ? '   ' + ev : '')) }
}
const count = (re) => { const m = src.match(re); return m ? m.length : 0 }
const has = (s) => src.indexOf(s) >= 0
const grab = (re) => { const m = src.match(re); return m ? m[0] : '' }

/* ================= A. 商品名称补全（P1-1） ================= */
lines.push('A. 商品名称补全 —— 防「名字打歪 = 给商品档案添一条错商品」')

const nameInput = grab(/<input v-model="r\.name"[^>]*>/)
ok('A1 商品名格绑定了候选列表', /:list="editMode \? 'opt-prodname' : null"/.test(nameInput), nameInput.slice(0, 60) + '…')
/* 🔴 A2 是本批**顺带修的缺陷**：商品名格原本没有 @change ⇒ 改动不进撤销栈、也不点亮状态条。
   护栏必须守住它 —— 这是"加了补全反而更容易改到名字"之后更要紧的一条。 */
ok('A2 商品名格补上了变更钩子（修「改了撤不回」）', /@change="onCellChange"/.test(nameInput), /@change="onCellChange"/.test(nameInput) ? '@change 在位' : '缺 @change')

const dl = grab(/<datalist v-if="ri === 0 && editMode" id="opt-prodname">[\s\S]*?<\/datalist>/)
ok('A3 datalist 只在首行渲染一份（防 6.8 万节点）', dl.length > 0, dl ? 'ri === 0 守卫在位' : '未找到 datalist')
ok('A4 datalist 只在编辑态渲染', /editMode/.test(dl))
ok('A5 option 用 v / l 两个短键', /:value="o\.v"/.test(dl) && /:label="o\.l"/.test(dl))

ok('A6 候选状态与构造函数都在', has('const masterNameOptions = ref([])') && has('function buildNameOptions(list)'))
/* 🔴 A7：两处赋值点缺一不可 —— 只喂一处时某些期次进编辑态候选是空的，而用户看不出「为什么这次没提示」。 */
const assign = count(/masterNameOptions\.value = buildNameOptions\(allProds\)/g)
ok('A7 两处主档取用点都喂了候选', assign === 2, '赋值点 = ' + assign + '（期望 2）')
ok('A8 构造函数按 name/spec 组装且过滤空名', /const name = String\(p\.name \|\| ''\)/.test(src) && /const spec = String\(p\.spec \|\| ''\)\.trim\(\)/.test(src) && /\.filter\(\(o\) => o\.v\)/.test(src))

/* ================= B. 移动端数字键盘（P1-2） ================= */
lines.push('B. 移动端数字键盘 —— 触屏点格子直接弹数字键盘')

/* ⚠️ 这里必须按**行**定位，不能写 /<input …[^>]*>/ 这种「截到第一个 > 为止」的正则：
   单价格那一行自带一个 `>`（`:class="{ 'manual-price': Number(r.casePrice) > 0 }"`），
   内联表达式会把它提前截断 ⇒ 截出来的串里当然没有 inputmode ⇒ **假红**（本轮实测踩到）。
   HTML 属性里出现 > 是合法的，Vue 表达式里更常见 ⇒ 「截到 >」这类正则在模板上天生不可靠。 */
const lineOf = (needle) => (src.split('\n').find((l) => l.indexOf(needle) >= 0) || '')
const qtyInput = lineOf('v-model.number="r.qtyByUnit[u.name]"')
const extraInput = lineOf('v-model.number="r.extraQty"')
const priceInput = lineOf('v-model.number="r.casePrice"')

ok('B1 数量格 inputmode=numeric', /inputmode="numeric"/.test(qtyInput))
ok('B2 加单格 inputmode=numeric', /inputmode="numeric"/.test(extraInput))
/* 🔴 B3 的判据是"两件事"，缺一不可：有 inputmode，且**不是** numeric。
   单价有 step=0.01（两位小数）；若给成 numeric，安卓上小数点键会消失 ⇒ 用户永远填不了小数价。
   只断言"有 inputmode"会让这个错静默通过。 */
ok('B3 单价格 inputmode=decimal（且不是 numeric）',
  /inputmode="decimal"/.test(priceInput) && !/inputmode="numeric"/.test(priceInput),
  /inputmode="decimal"/.test(priceInput) ? 'decimal' : (priceInput ? '缺 inputmode' : '未找到单价 input'))
ok('B4 主档数字列按「该列是否整数」动态给键盘',
  /:inputmode="c\.num === 'int' \? 'numeric' : 'decimal'"/.test(src))

/* ================= C. 触屏可读的错误原因（P1-3） ================= */
lines.push('C. 触屏可读的错误原因 —— 悬停在触屏上不存在')

ok('C1 showCellErr 用 cellIssue 取原因', /function showCellErr\(ri, ci\)[\s\S]{0,160}cellIssue\(/.test(src))
/* 🔴 C2：mousedown 与 click 必须**都**拦。少 mousedown ⇒ 按下角标先被 td 的 onCellDown 接走，
   点一下「看原因」顺手把选区也改了（且用户以为只是看了个提示）。 */
const guard = count(/@mousedown\.stop\.prevent @click\.stop="showCellErr\(/g)
ok('C2 两处角标都拦住了 mousedown 与 click', guard === 2, '拦住的角标数 = ' + guard + '（期望 2）')
ok('C3 数量格角标与 td 的 title 同判据（都用 cellErrMsg）',
  /v-if="cellErrMsg\(ri, visibleCols\.length \+ ui\)" class="cell-err-dot"/.test(src))
ok('C4 主档列角标用 cellIssue（与 td 的 title 同判据）',
  /v-if="cellIssue\(ri, ci\)" class="cell-err-dot"/.test(src))
/* 🔴 C5：z-index 必须低于粘性列的 6 —— 否则横向滚动时，被冻结列盖住的那半张表上的角标
   会浮出来飘在冻结列上面（v210 刚踩过粘性遮挡的坑）。 */
const dotCss = grab(/\.cell-err-dot\{[^}]*\}/)
ok('C5 角标层级低于粘性列（避免滚动时浮在冻结列上方）',
  /z-index:\s*[1-5]\b/.test(dotCss), dotCss ? (dotCss.match(/z-index:\s*\d+/) || ['无 z-index'])[0] : '未找到样式')
ok('C6 角标取左上角（右中=徽标、右下=填充柄，都已占用）', /left:0;top:0/.test(dotCss))
ok('C7 角标的图标尺寸被压住（格子仅约 26px 高）',
  /\.cell-err-dot svg\.ico\{[^}]*width:9px/.test(src))

/* ================= D. 回归：v210 两态模型不许被这批碰坏 ================= */
lines.push('D. 回归 —— v210 单元格两态模型 / 键盘跳格')

ok('D1 cellTyping 仍在', has('const cellTyping = ref(false)'))
ok('D2 早退判据仍是 cellTyping.value && editing', has('if (cellTyping.value && editing && (e.key'))
const fc = src.slice(src.indexOf('function focusCell('), src.indexOf('function focusCell(') + 2200)
ok('D3 focusCell 里两态复位仍写在 nextTick 之前',
  fc.indexOf('cellTyping.value = !doSelect') >= 0 && fc.indexOf('cellTyping.value = !doSelect') < fc.indexOf('nextTick('))
ok('D4 七个可编辑 input 的 @focus 仍带 $event（漏一列 = 那列单击不全选）',
  count(/@focus="onFocusCell\([^)]*, \$event\)"/g) === 7,
  '带 $event 的 @focus = ' + count(/@focus="onFocusCell\([^)]*, \$event\)"/g) + '（期望 7）')
ok('D5 跳格后的粘性遮挡补偿仍在（keepCellClear）', has('keepCellClear'))
ok('D6 F2 仍是「进输入态」语义', has('focusCell(r, c, { select: false })'))

/* ================= 汇总 ================= */
for (const l of lines) console.log(l)
console.log('')
console.log('v211 离线护栏：' + pass + ' 绿 / ' + fail + ' 红   （共 ' + (pass + fail) + ' 项）')
process.exit(fail === 0 ? 0 : 1)
