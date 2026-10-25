/**
 * 契约组 ㉑ —— 开单三件事：未选伙伴锁商品 / 业务员带出部门 / 「经办人」统一叫「业务员」
 * ==========================================================================
 * 为什么要有这一组（老板 2026-10-25 的三项要求）：
 *   ① 未选供应商或客户时**不许筛商品、不许开单**，且要有明确反馈；
 *   ② 选了业务员要**自动带出他的部门**，没配部门时要提示且**不拦开单**；
 *   ③ 自提/车销四页 + 采购/退货的「经办人」统一叫「业务员」，全链路一致。
 *
 * 这三件事的共同点：**全部是静默失效体质** ——
 *   · 锁没锁商品格，接口一路 200、界面一模一样，只有真去点才发现；
 *   · 部门没带出来，用户只会说「这功能没用」，不会报错；
 *   · 少改一处「经办人」，页面上就同时躺着两个名字，谁也不知道哪个才算。
 * ⇒ 必须在 CI 里把判据钉住，而不是靠下一轮人眼复查。
 *
 * 判据设计原则（沿用 v685 组 ⑳）：
 *   · 扫**剥掉注释后**的源码 —— 注释里保留历史术语是允许的（那是文档），
 *     模板/脚本里的字面量才是用户能看见的东西。
 *   · 每条关键判据配**坏样本自证**：注回已知缺陷必须判红，否则不知道自己有没有判别力。
 */
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const HERE = path.dirname(url.fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const NEW = path.join(ROOT, 'src/pages/inventory/new')

let pass = 0
let fail = 0
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log('  ✅ ' + label) } else {
    fail++; console.log('  ❌ ' + label + (extra !== undefined ? '  ← ' + JSON.stringify(extra) : ''))
  }
}
const read = (p) => fs.readFileSync(p, 'utf8')
/** 剥模板注释 + JS 注释。⚠️ 正则前导用零宽断言，否则 `http://` 里的 `//` 会被当注释切掉。 */
const stripComments = (s) => s
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:\w])\/\/[^\n]*/g, '$1')

/* ══════════════════════════════════════════════════════════════════════
   ① 未选供应商/客户 ⇒ 商品格锁定
   ══════════════════════════════════════════════════════════════════════ */
console.log('\n① 未选供应商/客户 ⇒ 不许筛商品（锁在入口，不只在提交时拦）')

const combo = read(path.join(NEW, 'ProductCombo.vue'))
ok(/disabled:\s*\{\s*type:\s*Boolean/.test(combo), 'ProductCombo 有 disabled prop')
ok(/defineEmits\(\s*\[\s*'pick'\s*,\s*'blocked'\s*\]\s*\)/.test(combo), 'ProductCombo 声明 blocked 事件（点了要出声）')
ok(/if\s*\(props\.disabled\)\s*\{\s*emit\('blocked'\);\s*return\s*\}/.test(combo.replace(/\n\s*/g, ' ')) ||
   /if\s*\(props\.disabled\)\s*\{[^}]*emit\('blocked'\)[^}]*return[^}]*\}/.test(combo),
  'open() 在 disabled 时 emit(blocked) 并 return（不进搜索态）')

/* 三个用 ProductCombo 的建单页：必须传 :disabled + @blocked */
for (const [f, hint] of [
  ['SaleDocForm.vue', '先选客户'],
  ['PurchaseReturnForm.vue', '先选供应商'],
]) {
  const s = stripComments(read(path.join(NEW, f)))
  ok(new RegExp(`:disabled="[^"]*prodLocked`).test(s), `${f}：ProductCombo 绑 :disabled="prodLocked(...)"`)
  ok(/@blocked="warnNeed/.test(s), `${f}：ProductCombo 绑 @blocked 出声`)
  ok(s.includes(hint), `${f}：锁定态占位文案含「${hint}」`)
  ok(/function prodLocked\s*\(/.test(s), `${f}：prodLocked() 存在（判据集中在函数里）`)
  /* 🔴 已填过商品的行必须放行：判据里要看得到 `product_id` —— 只看客户/供应商
     会把编辑单、复制单里已有的行一起锁死，用户没法改一个历史值。 */
  ok(/function prodLocked[\s\S]{0,220}product_id/.test(s),
    `${f}：prodLocked 对「已填商品的行」放行（判据含 product_id）`)
}

/* 采购订单页是**内联**组合框，不走 ProductCombo —— 判据在 openProd 里 */
{
  const s = stripComments(read(path.join(NEW, 'PurchaseOrderForm.vue')))
  ok(/function openProd[\s\S]{0,400}supplier_id[\s\S]{0,240}toast\(/.test(s),
    'PurchaseOrderForm：openProd 未选供应商时 toast 出声并 return')
  ok(/is-locked/.test(s), 'PurchaseOrderForm：锁定态有 is-locked 样式钩子')
}

/* 保存拦截（"不许开单"）—— 校验里的文案必须点名是哪个伙伴 */
ok(/if\s*\(!form\.value\.customer_id\)\s*return\s*'请先选择客户'/.test(stripComments(read(path.join(NEW, 'SaleDocForm.vue')))),
  'SaleDocForm：validate 拦「请先选择客户」')
ok(/if\s*\(!form\.value\.supplier_id\)\s*return\s*'请先选择供应商'/.test(stripComments(read(path.join(NEW, 'PurchaseOrderForm.vue')))),
  'PurchaseOrderForm：validate 拦「请先选择供应商」')
ok(/if\s*\(!form\.value\.supplier_id\)\s*return\s*`?请先选择/.test(stripComments(read(path.join(NEW, 'PurchaseReturnForm.vue')))),
  'PurchaseReturnForm：validateStandalone 拦「请先选择供应商」')

/* 调拨单**没有**往来单位（仓到仓），不在本条判据内 —— 显式记一笔，免得被当成漏改 */
console.log('  ℹ️  调拨单没有供应商/客户字段（仓→仓），本项天然不适用')

/* ══════════════════════════════════════════════════════════════════════
   ② 选业务员 → 带出部门；没配部门 → 提示但不拦
   ══════════════════════════════════════════════════════════════════════ */
console.log('\n② 业务员带出部门（唯一实现 + 提示不得进校验）')

const HD = path.join(NEW, 'handlerDept.js')
ok(fs.existsSync(HD), 'handlerDept.js 存在（唯一实现）')
const hdSrc = fs.existsSync(HD) ? read(HD) : ''
ok(/export function handlerDepartment\s*\(/.test(hdSrc), '导出 handlerDepartment()')
ok(/export function handlerDeptWarn\s*\(/.test(hdSrc), '导出 handlerDeptWarn()')
/* 三态必须分得开：没选人 / 没配部门 / 部门被删 —— 合成一种就会给出误导性提示 */
for (const reason of ['no-handler', 'no-dept', 'dept-missing']) {
  ok(hdSrc.includes(`'${reason}'`), `handlerDepartment 区分 ${reason}（提示语各不相同）`)
}

const HINT_PAGES = ['SaleDocForm.vue', 'PurchaseOrderForm.vue', 'PurchaseReturnForm.vue']
for (const f of HINT_PAGES) {
  const raw = read(path.join(NEW, f))
  const s = stripComments(raw)
  ok(/from '\.\/handlerDept\.js'/.test(s), `${f}：引入 handlerDept.js`)
  ok(/handlerDeptWarn\(/.test(s), `${f}：用 handlerDeptWarn() 生成提示`)
  ok(/v-if="handlerDeptHint"/.test(s), `${f}：模板里有提示条（v-if="handlerDeptHint"）`)
  ok(/function onHandlerChange\s*\(/.test(s), `${f}：选人即有 onHandlerChange（自动带出）`)

  /* 🔴 本组最重要的一条：**提示不得进 validate**。
     一进校验，「没配部门」就从提醒变成拦截，而界面上看不出区别（提示条照旧显示）。 */
  const vbody = (s.match(/function validate[^\n]*\([^)]*\)\s*\{[\s\S]*?\n\}/g) || []).join('\n')
  ok(vbody.length > 0, `${f}：找到 validate 函数体`)
  ok(vbody.length > 0 && !/handlerDept|handlerDeptHint/.test(vbody),
    `${f}：handlerDept 不出现在 validate 函数体里（只提醒、不拦截）`)
}

/* 销售四页「部门是 TEXT 名」、采购三页「部门是 id」—— 带出的落点必须各按各的形态 */
ok(/form\.value\.department\s*=\s*hit\.name/.test(stripComments(read(path.join(NEW, 'SaleDocForm.vue')))),
  'SaleDocForm：带出写「部门名」（sale_orders.department 是 TEXT）')
ok(/form\.value\.department_id\s*=\s*hit\.id/.test(stripComments(read(path.join(NEW, 'PurchaseOrderForm.vue')))),
  'PurchaseOrderForm：带出写「部门 id」（purchase_orders.department_id 是 INTEGER）')

/* 配置入口：没有写端的读字段就是死字段（生产 27 个账号 department_id 全 0） */
{
  const emp = stripComments(read(path.join(ROOT, 'src/pages/EmployeeArchive.vue')))
  ok(/业务员部门/.test(emp), 'EmployeeArchive：有「业务员部门」配置卡')
  ok(/\/api\/users\/\$\{[^}]+\}\/department/.test(emp), 'EmployeeArchive：调 PUT /api/users/{id}/department 落库')
  ok(/ev\.target\.value\s*=\s*String\(prev\)/.test(emp),
    'EmployeeArchive：保存失败把下拉**退回旧值**（界面不许显示成功）')
}

/* ══════════════════════════════════════════════════════════════════════
   ③ 「经办人」统一更名「业务员」
   ══════════════════════════════════════════════════════════════════════ */
console.log('\n③ 命名统一（剥掉注释后再查——注释里保留历史术语是允许的）')

const RENAME_FILES = [
  'src/pages/inventory/new/SaleDocForm.vue',
  'src/pages/inventory/new/PurchaseOrderForm.vue',
  'src/pages/inventory/new/PurchaseReturnForm.vue',
  'src/pages/inventory/InvPurchaseList.vue',
  'src/pages/inventory/InvPurchaseDetail.vue',
]
for (const rel of RENAME_FILES) {
  const s = stripComments(read(path.join(ROOT, rel)))
  ok(!s.includes('经办人'), `${rel}：生产代码里不再出现「经办人」`, s.includes('经办人'))
  ok(s.includes('业务员'), `${rel}：出现「业务员」`)
}

/* 销售四页：业务员这个**字段本身是新加的**（此前四页只有部门 + 送货司机） */
{
  const raw = read(path.join(NEW, 'SaleDocForm.vue'))
  const s = stripComments(raw)
  ok(/<label class="isn-lb">业务员<\/label>/.test(s), 'SaleDocForm：模板有「业务员」标签')
  ok(/v-model="form\.handler"/.test(s), 'SaleDocForm：业务员绑定 form.handler')
  ok((s.match(/handler: form\.value\.handler \|\| ''/g) || []).length >= 2,
    'SaleDocForm：订单 + 退货两条提交路径都带 handler', (s.match(/handler: form\.value\.handler \|\| ''/g) || []).length)
  /* 四种类型都要能选人：`users` 不能再只在 hasDriver 时才拉 */
  ok(/const kinds = \['warehouses', 'customers', 'products', 'users', 'departments'\]/.test(s),
    'SaleDocForm：refs 恒拉 users/departments（四页都要有业务员）')
}

/* 列表显示：销售列表要有业务员列，且取 handler_name（不是 id） */
{
  const s = stripComments(read(path.join(ROOT, 'src/pages/inventory/InvSaleList.vue')))
  ok((s.match(/key: 'handler'/g) || []).length >= 2,
    'InvSaleList：订单视图 + 退货视图都有 handler 列', (s.match(/key: 'handler'/g) || []).length)
  ok(/case 'handler': return r\.handler_name/.test(s),
    'InvSaleList：业务员列取 handler_name（显示 id 用户读不懂）')
}

/* ══════════════════════════════════════════════════════════════════════
   坏样本自证 —— 注回已知缺陷，判据必须判红
   ══════════════════════════════════════════════════════════════════════ */
console.log('\n坏样本自证（判别力）')
{
  /* A. 把「没配部门」的提示塞进 validate ⇒ 必须被判红 */
  const badValidate = `
function validate () {
  if (!form.value.customer_id) return '请先选择客户'
  if (handlerDeptHint.value) return handlerDeptHint.value
  return ''
}`
  const vbody = (stripComments(badValidate).match(/function validate[^\n]*\([^)]*\)\s*\{[\s\S]*?\n\}/g) || []).join('\n')
  ok(vbody.length > 0 && /handlerDept/.test(vbody), '坏样本：提示进 validate 时本判据能抓到（应为 true）')

  /* B. ProductCombo 不 emit blocked（点了没反应）⇒ 必须被判红 */
  const badCombo = `function open () { if (props.disabled) { return } editing.value = true }`
  ok(!/emit\('blocked'\)/.test(badCombo), '坏样本：不 emit(blocked) 时本判据能抓到（应为 true）')

  /* C. 残留一个「经办人」标签 ⇒ 必须被判红 */
  const badLabel = '<label class="ipn-lb">经办人</label>'
  ok(stripComments(badLabel).includes('经办人'), '坏样本：残留「经办人」时本判据能抓到（应为 true）')

  /* D. 业务员列取 id 而不是姓名 ⇒ 必须被判红 */
  const badCol = `case 'handler': return r.handler`
  ok(!/case 'handler': return r\.handler_name/.test(badCol), '坏样本：列取 handler(id) 时本判据能抓到（应为 true）')
}

console.log(`\n组 ㉑ 结果：${pass} 通过 / ${fail} 失败`)
if (fail) process.exit(1)
