#!/usr/bin/env node
/**
 * v383 判据 —— 「新建员工：点保存后姓名被清空」修复的**行为级**验收。
 *
 * 设计要点（为什么不是源码级 grep 断言）：
 *   源码里"有没有写 await loadEmployees()"只能证明**我改了字**，证明不了**行为变了**。
 *   本脚本把 EmployeeArchive.vue 里的**真实函数源码原样抠出来**（逐字节，含注释），
 *   在 Node 里配一套 stub（employeeApi / toast / refs）**真跑一遍**：
 *      输入姓名「张三」→ 调 saveEmployeeCore() → 再调 createAccountInEdit()
 *   然后断言"输入框里还是张三""开通账号请求带的是 id=42 而不是 0"。
 *   ⇒ 断言的是**行为**，实现随便重构都不会误判。
 *
 * 用法：
 *   node tools/v383-name-clear-assert.mjs <EmployeeArchive.vue>            # 修复后 → 必须全绿
 *   node tools/v383-name-clear-assert.mjs <EmployeeArchive.vue> --expect-broken
 *                                                                          # 修复前 → 必须复现 bug
 * 退出码：0 = 符合预期；1 = 不符合预期。
 */
import fs from 'node:fs'

const VUE = process.argv[2]
const MODE = process.argv[3] || ''
if (!VUE) {
  console.error('usage: node v383-name-clear-assert.mjs <EmployeeArchive.vue> [--expect-broken]')
  process.exit(2)
}
const src = fs.readFileSync(VUE, 'utf8')

/* ============ 一、从 .vue 里原样抠出真实源码 ============ */

/** 从 from 起，跳过注释与字符串，返回第一个「代码态」的 `{`。 */
function bodyStart(s, from) {
  let i = from
  let st = null
  while (i < s.length) {
    const c = s[i]
    const n = s[i + 1]
    if (!st) {
      if (c === '/' && n === '/') { st = '//'; i += 2; continue }
      if (c === '/' && n === '*') { st = '/*'; i += 2; continue }
      if (c === "'" || c === '"' || c === '`') { st = c; i += 1; continue }
      if (c === '{') return i
      i += 1
    } else if (st === '//') { if (c === '\n') st = null; i += 1 }
    else if (st === '/*') { if (c === '*' && n === '/') { st = null; i += 2; continue } i += 1 }
    else { if (c === '\\') { i += 2; continue } if (c === st) st = null; i += 1 }
  }
  return -1
}

/** 从 `{` 起做括号配对（同样跳过注释/字符串）。 */
function matchBrace(s, open) {
  let i = open
  let d = 0
  let st = null
  while (i < s.length) {
    const c = s[i]
    const n = s[i + 1]
    if (!st) {
      if (c === '/' && n === '/') { st = '//'; i += 2; continue }
      if (c === '/' && n === '*') { st = '/*'; i += 2; continue }
      if (c === "'" || c === '"' || c === '`') { st = c; i += 1; continue }
      if (c === '{') d += 1
      else if (c === '}') { d -= 1; if (d === 0) return i }
      i += 1
    } else if (st === '//') { if (c === '\n') st = null; i += 1 }
    else if (st === '/*') { if (c === '*' && n === '/') { st = null; i += 2; continue } i += 1 }
    else { if (c === '\\') { i += 2; continue } if (c === st) st = null; i += 1 }
  }
  return -1
}

function extractFn(name) {
  const re = new RegExp(`(?:^|\\n)[ \\t]*(?:async[ \\t]+)?function[ \\t]+${name}[ \\t]*\\(`)
  const m = re.exec(src)
  if (!m) throw new Error('找不到函数：' + name)
  const head = m.index + (m[0][0] === '\n' ? 1 : 0)
  const brace = bodyStart(src, head)
  const end = matchBrace(src, brace)
  if (brace < 0 || end < 0) throw new Error('括号配对失败：' + name)
  return src.slice(head, end + 1)
}

function extractConst(name) {
  const re = new RegExp(`(?:^|\\n)[ \\t]*const[ \\t]+${name}[ \\t]*=`)
  const m = re.exec(src)
  if (!m) throw new Error('找不到常量：' + name)
  const start = m.index + (m[0][0] === '\n' ? 1 : 0)
  const nl = src.indexOf('\n', start)
  return src.slice(start, nl < 0 ? undefined : nl)
}

const CONSTS = ['PWD_MIN', 'PWD_HINT']
const FUNCS = [
  'snapshotForm', 'salaryOf', 'pwdOk', 'syncRoleEdit', 'resetEditForm',
  'openCreate', 'openEdit', 'saveEmployeeCore', 'createAccountInEdit',
]
const PARTS = CONSTS.map(extractConst).concat(FUNCS.map(extractFn)).join('\n\n')

/* ============ 二、把真源码装进一个可调用对象 ============ */

const build = new Function('ctx', `
  "use strict";
  const {
    editForm, formSnap, isCreate, editTarget, editOpen, employees, loading, empStats,
    accForm2, accScopeTouched, accRoleEdit, accRolesEdit, accScopeEdit, accScopeBase,
    accPwdEdit, showReset, showRename, accNameEdit, resetCode, resetCodeExp, accBusy,
    roleEndScope, employeeApi, staffAccountApi, toast, store, loadEmployees
  } = ctx;
  ${PARTS}
  return { saveEmployeeCore, resetEditForm, openCreate, openEdit, createAccountInEdit };
`)

/* ============ 三、stub 上下文 ============ */

const NEW_ID = 42
/** 列表接口返回的**完整**员工行（含只有列表才会补的派生字段）。 */
const ROW = {
  id: NEW_ID, name: '张三', employee_no: 'E001', position: '业务员', hire_date: '',
  has_account: 0, account_user_id: null, account_role: 'staff', account_roles: '',
  account_login_scope: '', account_active: 0, store_ids: [],
}

function makeCtx(list) {
  const calls = { create: [], acct: [], toast: [] }
  const employees = { value: [] }
  const ctx = {
    editForm: {
      name: '', employee_no: '', position: '', hire_date: '', id_card: '',
      bank_name: '', bank_account: '', social_insurance_city: '',
      social_insurance_base: null, housing_fund_base: null, base_salary: null,
    },
    formSnap: { value: '' },
    isCreate: { value: true },
    editTarget: { value: null },
    editOpen: { value: false },
    employees,
    loading: { value: false },
    empStats: { value: null },
    accForm2: { username: '', password: '', role: 'staff', login_scope: 'mini' },
    accScopeTouched: { value: false },
    accRoleEdit: { value: 'staff' },
    accRolesEdit: { value: [] },
    accScopeEdit: { value: '' },
    accScopeBase: { value: '' },
    accPwdEdit: { value: '' },
    showReset: { value: false },
    showRename: { value: false },
    accNameEdit: { value: '' },
    resetCode: { value: '' },
    resetCodeExp: { value: '' },
    accBusy: { value: false },
    roleEndScope: () => 'mini',
    employeeApi: {
      list: async () => list,
      create: async (b) => { calls.create.push(b); return { success: true, employee_id: NEW_ID } },
      update: async () => ({ success: true }),
    },
    staffAccountApi: {
      createAccount: async (b) => { calls.acct.push(b); return { success: true } },
    },
    toast: (m, t) => calls.toast.push({ m, t }),
    store: { loadPerms() {} },
    loadEmployees: async () => { employees.value = list.map((x) => ({ ...x })) },
  }
  return { ctx, calls }
}

/* ============ 四、断言收集 ============ */

const results = []
function check(id, label, cond, got) {
  results.push({ id, label, ok: !!cond, got: got === undefined ? '' : String(got) })
}
function info(id, label, cond, got) {
  results.push({ id, label, ok: !!cond, got: got === undefined ? '' : String(got), info: true })
}

/* ============ 五、场景 ============ */

/** A：正常路径 —— 列表能查回新员工（真实生产路径）。 */
async function scenarioA() {
  const { ctx, calls } = makeCtx([ROW])
  const api = build(ctx)
  ctx.editForm.name = '张三'
  ctx.editForm.employee_no = 'E001'
  ctx.editForm.position = '业务员'
  const r = await api.saveEmployeeCore()

  check('A1', '保存返回成功且标记为「新建」', r && r.ok === true && r.created === true, JSON.stringify(r))
  check('A2', '保存后姓名仍在输入框里（张三）', ctx.editForm.name === '张三', JSON.stringify(ctx.editForm.name))
  check('A3', '保存后员工编号仍在（E001）', ctx.editForm.employee_no === 'E001', JSON.stringify(ctx.editForm.employee_no))
  check('A4', '保存后岗位仍在（业务员）', ctx.editForm.position === '业务员', JSON.stringify(ctx.editForm.position))
  check('A5', '弹窗已切到编辑态（isCreate=false）', ctx.isCreate.value === false, ctx.isCreate.value)
  check('A6', 'editTarget 带上了新员工 id', ctx.editTarget.value && ctx.editTarget.value.id === NEW_ID, ctx.editTarget.value && ctx.editTarget.value.id)
  check('A7', 'editTarget 带上了派生字段 has_account（=0，用于渲染「开通账号」）',
    ctx.editTarget.value && 'has_account' in ctx.editTarget.value, ctx.editTarget.value && JSON.stringify(Object.keys(ctx.editTarget.value)))
  check('A8', 'editTarget **不是**创建回执（不含 success 键）',
    ctx.editTarget.value && !('success' in ctx.editTarget.value), ctx.editTarget.value && JSON.stringify(Object.keys(ctx.editTarget.value)))
  check('A9', '保存后没有误报错误 toast', !calls.toast.some((t) => t.t === 'err'), JSON.stringify(calls.toast))
  return { ctx, calls, api }
}

/** B：保存后**直接**为同一员工开通账号（用户诉求的后半句）。 */
async function scenarioB(prev) {
  const { ctx, calls, api } = prev
  ctx.accForm2.username = 'zhangsan'
  ctx.accForm2.password = 'Abcd1234'
  await api.createAccountInEdit()
  const req = calls.acct[0]
  check('B1', '开通账号请求带上了正确 employee_id（42，不是 0）', req && req.employee_id === NEW_ID, req && JSON.stringify(req.employee_id))
  check('B2', '开通账号请求带上了显示名（张三）', req && req.display_name === '张三', req && JSON.stringify(req.display_name))
  check('B3', '开通账号成功（1 次请求）', calls.acct.length === 1, calls.acct.length)
}

/** C：反例 —— 若 editTarget 是残缺回执，必须**拒发**而不是兜成 0。 */
async function scenarioC() {
  const { ctx, calls } = makeCtx([ROW])
  const api = build(ctx)
  // 重现修复前的 editTarget：只有创建回执，没有 id
  ctx.editTarget.value = { success: true, employee_id: NEW_ID }
  ctx.accForm2.username = 'zhangsan'
  ctx.accForm2.password = 'Abcd1234'
  await api.createAccountInEdit()
  check('C1', '残缺档案下**不发**开通请求（不会兜成 employee_id=0 = 外部客户语义）', calls.acct.length === 0, calls.acct.length)
  check('C2', '残缺档案下明确报错，不静默', calls.toast.some((t) => t.t === 'err'), JSON.stringify(calls.toast))
  return { ctx, calls, api }
}

/** D：【机制自证】把创建回执当员工行直接喂 resetEditForm ⇒ 姓名被清空。 */
function scenarioD() {
  const { ctx } = makeCtx([])
  const api = build(ctx)
  ctx.editForm.name = '张三'
  ctx.editForm.employee_no = 'E001'
  // 这就是 `openEdit(created)` 在修复前做的事
  api.resetEditForm({ success: true, employee_id: NEW_ID })
  info('D1', '【机制自证】openEdit(创建回执) ⇒ 姓名被清成空串', ctx.editForm.name === '', JSON.stringify(ctx.editForm.name))
  info('D2', '【机制自证】openEdit(创建回执) ⇒ 员工编号被清成空串', ctx.editForm.employee_no === '', JSON.stringify(ctx.editForm.employee_no))
  return { ctx, api }
}

/** E：兜底路径 —— 列表里查不到新员工时，也绝不能退回残缺对象。 */
async function scenarioE() {
  const { ctx, calls } = makeCtx([]) // 列表为空 ⇒ 查不到
  const api = build(ctx)
  ctx.editForm.name = '张三'
  const r = await api.saveEmployeeCore()
  check('E1', '查不到时仍返回成功且标记新建', r && r.ok === true && r.created === true, JSON.stringify(r))
  check('E2', '兜底对象仍保留姓名（张三）', ctx.editForm.name === '张三', JSON.stringify(ctx.editForm.name))
  check('E3', '兜底对象仍带 id（42）', ctx.editTarget.value && ctx.editTarget.value.id === NEW_ID, ctx.editTarget.value && ctx.editTarget.value.id)
  check('E4', '兜底对象也**不是**创建回执（不含 success 键）',
    ctx.editTarget.value && !('success' in ctx.editTarget.value), ctx.editTarget.value && JSON.stringify(Object.keys(ctx.editTarget.value)))
}

/* ============ 六、跑 ============ */

const a = await scenarioA()
await scenarioB(a)
await scenarioC()
scenarioD()
await scenarioE()

console.log('== v383 判据：' + VUE + (MODE ? ' [' + MODE + ']' : '') + ' ==')
for (const r of results) {
  const tag = r.info ? 'INFO' : (r.ok ? 'PASS' : 'FAIL')
  console.log(`[${tag}] ${r.id} ${r.label}${r.got ? '  ← 实际: ' + r.got : ''}`)
}
const hard = results.filter((r) => !r.info)
const nPass = hard.filter((r) => r.ok).length
const nFail = hard.length - nPass
console.log(`RESULT pass=${nPass} fail=${nFail}`)

const byId = (id) => results.find((r) => r.id === id)
const keepsName = byId('A2').ok        // 修复后的核心判据
const mechHolds = byId('D1').ok        // bug 机制（应当恒为真）

if (MODE === '--expect-broken') {
  // 修复前：必须**复现** bug，且机制自证成立
  const ok = !keepsName && mechHolds
  console.log(ok
    ? 'COUNTEREXAMPLE-OK —— 该版本确实复现「保存后姓名被清空」，且机制 = D1'
    : 'COUNTEREXAMPLE-BAD —— 该版本没有复现 bug（判据无判别力 / 或此版本已修复）')
  process.exit(ok ? 0 : 1)
}

process.exit(nFail === 0 ? 0 : 1)
