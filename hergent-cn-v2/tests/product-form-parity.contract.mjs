/**
 * 契约组 ㉒ —— 「新增商品」与「编辑商品」必须是同一个界面（v689）
 * ==========================================================================
 * 老板原话：「新增商品和编辑商品 UI 应该一样，现在是两个样式，请与编辑商品页面对齐。」
 *
 * 为什么用「共用模板 + 模式切换」而不是「把两套模板改成一样」：
 *   两套模板哪怕今天改成一模一样，明天加一个字段、改一处措辞就会重新漂开 ——
 *   而漂开之后没人会记得去比对，用户又会看到「同一件东西两个样子」。
 *   ⇒ 本组钉的不是像素，而是**结构上只有一个弹窗**这个前提。
 *
 * 静默失效体质（这一组为什么必须在 CI 里）：
 *   · 新增偷偷退回 `bulk-upsert` ⇒ 接口 200、商品建出来了，但别名/单位档位/业务范围
 *     **全部没存上**，界面上一点异常都没有；
 *   · 新增又把条码框做成只读 ⇒ 建档时根本没法填条码，而条码是扫码/导入的关联键；
 *   · 「保存」按钮两套各绑一个函数 ⇒ 下学期必有人只改了其中一个。
 *
 * 判据设计（沿用组 ⑳㉑）：扫**剥掉注释后**的源码；每条关键判据配坏样本自证。
 */
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const HERE = path.dirname(url.fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const FILE = path.join(ROOT, 'src/pages/ProductArchive.vue')

let pass = 0
let fail = 0
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log('  ✅ ' + label) } else {
    fail++; console.log('  ❌ ' + label + (extra !== undefined ? '  ← ' + JSON.stringify(extra) : ''))
  }
}
const read = (p) => fs.readFileSync(p, 'utf8')
const stripComments = (s) => s
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:\w])\/\/[^\n]*/g, '$1')

const raw = read(FILE)
const s = stripComments(raw)

/* ══════════════════════════════════════════════════════════════════════
   ① 结构上只有一个弹窗（这是「不会再漂移」的唯一保证）
   ══════════════════════════════════════════════════════════════════════ */
console.log('\n① 新增与编辑共用一个弹窗模板')

ok(/const\s+formMode\s*=\s*ref\(/.test(s), '存在 formMode（编辑/新增的模式开关）')
ok(/const\s+isAdd\s*=\s*computed\(/.test(s), '存在 isAdd 计算属性')
ok(/const\s+hasUnsaved\s*=\s*computed\(/.test(s), '关闭确认用 hasUnsaved（新增填了东西也要提示）')

/* 旧那套「新增商品弹窗」必须彻底消失：它同时有独立的 addOpen + addForm + saveAdd。 */
ok(!/const\s+addOpen\s*=\s*ref\(/.test(s), '旧新增弹窗的 addOpen 已删除（不再有第二个弹窗）')
ok(!/const\s+addForm\s*=\s*ref\(/.test(s), '旧新增弹窗的 addForm 已删除（不再有第二份表单）')
ok(!/const\s+addSaving\s*=\s*ref\(/.test(s), '旧新增弹窗的 addSaving 已删除')
ok((s.match(/class="pa-overlay"/g) || []).length === 3,
  '遮罩数量回到 3 个（编辑 / 导入 / 补进价）—— 新增弹窗那层没了',
  (s.match(/class="pa-overlay"/g) || []).length)

/* 新增必须写进**同一个** editForm（否则模板复用只是假象） */
const openAddBody = (s.match(/function openAdd\(\)\s*\{[\s\S]*?\n\}/) || [''])[0]
ok(/editForm\.value\s*=/.test(openAddBody), 'openAdd 填的是同一个 editForm（不是另一份表单）')
ok(/editBaseline\.value\s*=/.test(openAddBody), 'openAdd 同时设了 diff 基线（dirtyCount 才能算）')
ok(/detailOpen\.value\s*=\s*true/.test(openAddBody), 'openAdd 打开的是同一个弹窗（detailOpen）')
ok(/formMode\.value\s*=\s*'add'/.test(openAddBody), "openAdd 把模式切成 'add'")
ok(/formMode\.value\s*=\s*'edit'/.test((s.match(/function openDetail\([\s\S]*?\n\}/) || [''])[0]),
  "openDetail 把模式切回 'edit'（否则编辑别人时会带着新增的空表单）")

/* 一个保存入口，两套按钮共绑 */
ok(/function saveForm\(\)/.test(s), '存在唯一的保存入口 saveForm()')
ok((s.match(/@click="saveForm\(\)"/g) || []).length === 2,
  '两处「保存」按钮都绑 saveForm()（新增/编辑各一，不会再只改一边）',
  (s.match(/@click="saveForm\(\)"/g) || []).length)
ok(!/@click="saveEdit\(\)"/.test(s) && !/@click="saveAdd"/.test(s),
  '模板里没有任何按钮直连 saveEdit / saveAdd（避免绕过 saveForm 分流）')

/* ══════════════════════════════════════════════════════════════════════
   ② 四个页签两种模式都在（这是「UI 一样」的核心）
   ══════════════════════════════════════════════════════════════════════ */
console.log('\n② 四个页签 / 字段排布两种模式一致')

const tabsBlock = (s.match(/<div class="main-tabs"[\s\S]*?<\/div>/) || [''])[0]
for (const t of ['基本信息', '包装单位', '价格', '库存效期']) {
  ok(tabsBlock.includes(t), `页签「${t}」在共用模板里（两种模式都有）`)
}
ok(!/v-if="!isAdd"/.test(tabsBlock) && !/v-if="isAdd"/.test(tabsBlock),
  '页签条本身不按模式隐藏（新增也能切 4 个页签）')

/* 关键分组必须两种模式都在：业务范围 / 包装单位三档 / 默认开单单位 / 价格矩阵 */
const bodyHtml = s.slice(s.indexOf('class="pa-modal-body"'), s.indexOf('class="pa-modal-ft"'))
for (const [kw, label] of [
  ['业务范围', '业务范围（可销售/可退货/可采购）'],
  ['小单位（基础单位）', '包装单位·小单位'],
  ['中单位', '包装单位·中单位'],
  ['大单位', '包装单位·大单位'],
  ['默认开单单位', '默认开单单位四档'],
  ['价格矩阵（按单位档位）', '价格矩阵'],
  ['描述', '描述'],
]) {
  ok(bodyHtml.includes(kw), `共用弹窗里有「${label}」`)
}

/* 只有「编辑才成立」的两块必须按模式隐藏 */
ok(/<template v-if="!isAdd">[\s\S]{0,400}?pa-sec-click/.test(bodyHtml),
  '「修改记录」在新增时隐藏（新商品没有记录可查）')
ok(/<template v-if="!isAdd">[\s\S]{0,300}?pa-active/.test(bodyHtml),
  '「状态」区在新增时隐藏（新建一律启用）')

/* 新增必须能填条码 / 厂家编码 —— 否则建档时这两列永远空 */
ok(/<input v-if="isAdd" v-model="editForm\.barcode"/.test(bodyHtml),
  '新增时条码可填（v-model 绑 editForm.barcode）')
ok(/<input v-if="isAdd" v-model="editForm\.product_code"/.test(bodyHtml),
  '新增时厂家编码可填')
ok(/<input v-else :value="detailTarget\?\.barcode/.test(bodyHtml),
  '编辑时条码仍是只读展示（关联键不给改）')

/* ══════════════════════════════════════════════════════════════════════
   ③ 新增走 POST /api/products（不再靠 bulk-upsert 覆盖别人）
   ══════════════════════════════════════════════════════════════════════ */
console.log('\n③ 新增用 product_create（全字段），不再 upsert')

const saveAddBody = (s.match(/async function saveAdd\(\)\s*\{[\s\S]*?\n\}/) || [''])[0]
ok(/api\('\/api\/products',\s*\{\s*method:\s*'POST'/.test(saveAddBody),
  "新增调 POST /api/products（对应后端 product_create）")
ok(!/bulkUpsert/.test(saveAddBody), '新增不再走 bulk-upsert（那条路 17 个列、同名即覆盖别人）')
ok(/body\[k\]\s*=\s*_norm\(k,\s*f\[k\]\)/.test(saveAddBody),
  '新增提交全部 EDIT_FIELDS（不是手写几个字段的子集）')
ok(/body\.barcode\s*=/.test(saveAddBody) && /body\.product_code\s*=/.test(saveAddBody),
  '新增额外提交条码 / 厂家编码（它们不在 EDIT_FIELDS 里）')
ok(/unit-prices/.test(saveAddBody),
  '价格矩阵在新增时随主保存一起写（有填才发，见下一条）')
ok(/const priced\s*=/.test(saveAddBody),
  '价格矩阵「有填才写」—— 全零就不发那次 PUT')

/* 校验：名称必填 / 到货周期 / 数值非负，且错误挂到字段上（不是只飘 toast） */
const validateAddBody = (s.match(/function validateAdd\(\)\s*\{[\s\S]*?\n\}/) || [''])[0]
ok(/errs\.name\s*=/.test(validateAddBody), '校验：名称为空要报错')
ok(/parseArrivalDays/.test(validateAddBody), '校验：到货周期走同一份规则（utils/arrival.js）')
ok(/EDIT_NUM_FIELDS/.test(validateAddBody), '校验：数值字段逐个判非负（不是只判一个）')
ok(/errors\.value\s*=\s*errs/.test(saveAddBody) && /focusField/.test(saveAddBody),
  '校验失败把错误挂到字段并跳到出错页签（不是只飘一条 toast）')

/* 保存按钮可用条件 */
ok(/const\s+canSaveAdd\s*=\s*computed\(/.test(s), '存在 canSaveAdd（名称没填不让点保存）')
ok(/!canSaveAdd/.test(s), '新增模式下保存按钮受 canSaveAdd 控制')

/* ══════════════════════════════════════════════════════════════════════
   ④ 坏样本自证（注回缺陷必须判红）
   ══════════════════════════════════════════════════════════════════════ */
console.log('\n④ 坏样本自证（注回缺陷必须判红）')
{
  /* A. 又冒出一个独立弹窗 ⇒ 遮罩数会变成 4 */
  const bad = '<div v-if="addOpen" class="pa-overlay"></div><div class="pa-overlay"></div><div class="pa-overlay"></div><div class="pa-overlay"></div>'
  ok((bad.match(/class="pa-overlay"/g) || []).length !== 3, '坏样本：多一个弹窗时「遮罩=3」判据能抓到')

  /* B. 新增偷回 bulk-upsert ⇒ 必须被判红 */
  const badSave = `async function saveAdd () { const r = await productsApi.bulkUpsert([row]) }`
  ok(!/api\('\/api\/products',\s*\{\s*method:\s*'POST'/.test(badSave), '坏样本：走 bulkUpsert 时本判据能抓到')

  /* C. 条码在新增里仍是只读 ⇒ 必须被判红 */
  const badBarcode = `<input :value="detailTarget?.barcode || '—'" class="input" readonly>`
  ok(!/<input v-if="isAdd" v-model="editForm\.barcode"/.test(badBarcode), '坏样本：条码只读时本判据能抓到')

  /* D. 只提交手写的几个字段 ⇒ 必须被判红 */
  const badBody = `body = { name: f.name, sale_price: f.sale_price }`
  ok(!/body\[k\]\s*=\s*_norm\(k,\s*f\[k\]\)/.test(badBody), '坏样本：只提交子集时本判据能抓到')

  /* E. 保存按钮直连旧函数 ⇒ 必须被判红 */
  const badBtn = `<button @click="saveEdit()">保存</button>`
  ok(/@click="saveEdit\(\)"/.test(badBtn), '坏样本：按钮直连 saveEdit 时本判据能抓到（应为 true）')
}

console.log(`\n组 ㉒ 结果：${pass} 通过 / ${fail} 失败`)
if (fail) process.exit(1)
