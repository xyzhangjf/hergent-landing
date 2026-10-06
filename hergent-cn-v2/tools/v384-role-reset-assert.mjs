#!/usr/bin/env node
/**
 * v384 判据 —— 「开通账号时选了『导购』，点完却跳回『员工』」修复的**行为级**验收。
 *
 * 报障原文（老板，2026-10-06 19:35）：
 *   「我刚在给『吴敏』创建账号，创建的时候角色已经选了『导购』，
 *     但在点击创建账号后又跳转的『员工』」
 *
 * 生产库取证（只读）已证明**后端存的是 guide**：
 *   users id=999921 username=111111111 display_name=吴敏 role=guide login_scope=mini
 *   ⇒ 这是**纯前端显示**缺陷：账号开通成功后，右侧账号编辑区没有跟着刷新。
 *
 * 设计要点（同 v383，为什么不是 grep 断言）：
 *   源码里"有没有写 syncRoleEdit(fresh)"只能证明我改了字，证明不了**行为变了**。
 *   本脚本把 EmployeeArchive.vue 里的**真实函数源码原样抠出来**（逐字节、含注释），
 *   在 Node 里配一套 stub（employeeApi / staffAccountApi / toast / refs）**真跑一遍**：
 *      openCreate() → 填姓名 → saveEmployeeCore() → 选角色 guide → createAccountInEdit()
 *   然后断言「角色下拉现在是 guide」「没有多余改动标记（dirty=false）」。
 *
 * 用法：
 *   node tools/v384-role-reset-assert.mjs <EmployeeArchive.vue>            # 修复后 → 必须全绿
 *   node tools/v384-role-reset-assert.mjs <EmployeeArchive.vue> --expect-broken
 *                                                       # 修复前（= 生产上线版）→ 必须复现 bug
 * 退出码：0 = 符合预期；1 = 不符合预期。
 */
import fs from 'node:fs'

const VUE = process.argv[2]
const MODE = process.argv[3] || ''
if (!VUE) {
  console.error('usage: node v384-role-reset-assert.mjs <EmployeeArchive.vue> [--expect-broken]')
  process.exit(2)
}
const src = fs.readFileSync(VUE, 'utf8')
const EXPECT_BROKEN = MODE === '--expect-broken'

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

/** 从 `(` 起做**圆括号**配对（同样跳过注释/字符串）。 */
function matchParen(s, open) {
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
      if (c === '(') d += 1
      else if (c === ')') { d -= 1; if (d === 0) return i }
      i += 1
    } else if (st === '//') { if (c === '\n') st = null; i += 1 }
    else if (st === '/*') { if (c === '*' && n === '/') { st = null; i += 2; continue } i += 1 }
    else { if (c === '\\') { i += 2; continue } if (c === st) st = null; i += 1 }
  }
  return -1
}

/** 抠出 `const NAME = computed( ... )` 的整份声明（跨行）。
 *
 *  🔴 别改回"从 `=>` 之后找第一个 `{` 再配对"那种写法 —— 它有个**静默失效**：
 *     `computed(() => a && b)` 这种**表达式体**没有花括号，于是它会一路找到
 *     **后面某个不相干函数**的 `{`，把那段源码当成这个 computed 的身体。
 *     实测踩过（v385 写判据时）：`accDraftWanted` 抠成了邻居 `anyDirty` 的哥哥，
 *     运行到 `if (anyDirty.value)` 才以 `ReferenceError` 炸开 —— 而炸开都算好运，
 *     更坏的情况是**换了一个恰好能跑的对象**，判据从此测的是别的东西。
 *     ⇒ 一律按 `computed(` 那个**圆括号**配对取声明，对两种函数体都成立。 */
function extractComputed(name) {
  const re = new RegExp(`(?:^|\\n)[ \\t]*const[ \\t]+${name}[ \\t]*=[ \\t]*computed\\(`)
  const m = re.exec(src)
  if (!m) throw new Error('找不到 computed：' + name)
  const start = m.index + (m[0][0] === '\n' ? 1 : 0)
  const openParen = m.index + m[0].length - 1
  const end = matchParen(src, openParen)
  if (end < 0) throw new Error('computed 括号配对失败：' + name)
  return src.slice(start, end + 1)
}

/** 抠一个**可有可无**的函数。
 *
 *  🔴 为什么需要它：本脚本的 `--expect-broken` 模式要拿**修复前的历史版本**去跑
 *     （证明判据有判别力），而历史版本不一定有当前这些函数。
 *     例：v385 把 `createAccountInEdit` 拆成了 `createAccountCore` + wrapper ——
 *     拿 v385 之前的源码进来看，core 是不存在的（那时 wrapper 是自包含的、也不调用它）。
 *     硬抠就会以 `找到不到函数：createAccountCore` 中止，工具对历史版本失效。
 *  ⚠️ 但**绝不静默跳过**：缺失时打印一行说明，否则"工具少测了一个函数"没人知道。 */
function extractFnOptional(name) {
  try { return extractFn(name) } catch (_) { return null }
}

const CONSTS = ['PWD_MIN', 'PWD_HINT']
const FUNCS = [
  'snapshotForm', 'salaryOf', 'pwdOk', 'extraRolesOf', 'syncRoleEdit', 'resetEditForm',
  'openCreate', 'openEdit', 'saveEmployeeCore', 'createAccountInEdit',
]
const CORE = extractFnOptional('createAccountCore')
if (!CORE) {
  console.log('[INFO] 源码里没有 createAccountCore —— 按 v385 之前的版本来跑' +
              '（wrapper 自包含，行为等价）')
}
const PARTS = CONSTS.map(extractConst).concat(CORE ? [CORE] : []).concat(FUNCS.map(extractFn))
  .concat([extractComputed('accRoleDirty')]).join('\n\n')

/* ============ 二、把真源码装进一个可调用对象 ============ */

const build = new Function('ctx', `
  "use strict";
  const {
    editForm, formSnap, isCreate, editTarget, editOpen, employees, loading, empStats,
    accForm2, accScopeTouched, accRoleEdit, accRolesEdit, accScopeEdit, accScopeBase,
    accPwdEdit, showReset, showRename, accNameEdit, resetCode, resetCodeExp, accBusy,
    roleEndScope, employeeApi, staffAccountApi, toast, computed, store, loadEmployees
  } = ctx;
  ${PARTS}
  return { saveEmployeeCore, resetEditForm, openCreate, openEdit, createAccountInEdit,
           accRoleDirty, syncRoleEdit };
`)

/* ============ 三、stub 上下文 ============ */

const NEW_ID = 42
const ROLE = 'guide'          // 用户在界面选的：导购
const SCOPE = 'mini'          // 导购的默认端（后端 ROLE_LOGIN_SCOPE['guide']）

/** 新建后**还没开账号**的员工行（列表接口返回）。 */
const ROW_NOACC = {
  id: NEW_ID, name: '吴敏', employee_no: 'E001', position: '导购', hire_date: '',
  has_account: 0, account_user_id: null, account_role: '', account_roles: '',
  account_login_scope: '', account_active: 0, store_ids: [],
}
/** 开通账号**之后**同一员工的行（`employee_account_map()` 补出来的派生字段）。 */
const ROW_ACC = {
  ...ROW_NOACC,
  has_account: 1, account_user_id: 8801, account_role: ROLE,
  account_roles: '', account_login_scope: SCOPE, account_active: 1,
}

function makeCtx(listRef) {
  const calls = { create: [], acct: [], toast: [] }
  const employees = { value: [] }
  const ctx = {
    editForm: {
      name: '', employee_no: '', position: '', hire_date: '', id_card: '',
      bank_name: '', bank_account: '', social_insurance_city: '',
      social_insurance_base: null, housing_fund_base: null, base_salary: null,
    },
    isCreate: { value: true },
    formSnap: { value: '' },
    editTarget: { value: null },
    editOpen: { value: false },
    employees,
    loading: { value: false },
    empStats: { value: null },
    accForm2: { username: '', password: '', role: 'staff', login_scope: 'mini' },
    accScopeTouched: { value: false },
    accRoleEdit: { value: 'staff' },
    accRolesEdit: { value: [] },
    accScopeEdit: { value: 'both' },
    accScopeBase: { value: 'both' },
    accPwdEdit: { value: '' },
    showReset: { value: false },
    showRename: { value: false },
    accNameEdit: { value: '' },
    resetCode: { value: '' },
    resetCodeExp: { value: '' },
    accBusy: { value: false },
    // 与 Vue 的 computed 同语义：每次读 `.value` 求值（这里忽略缓存，等价于"读到最新"）
    computed: (fn) => ({ get value() { return fn() } }),
    roleEndScope: (r) => (r === 'guide' || r === 'sales' || r === 'staff' || r === 'distributor' ? 'mini' : 'web'),
    employeeApi: {
      list: async () => listRef.rows,
      create: async (b) => { calls.create.push(b); return { success: true, employee_id: NEW_ID } },
      update: async () => ({ success: true }),
    },
    staffAccountApi: {
      createAccount: async (b) => { calls.acct.push(b); return { success: true } },
    },
    toast: (m, t) => calls.toast.push({ m, t }),
    store: { loadPerms() {} },
    loadEmployees: async () => { employees.value = listRef.rows.map((x) => ({ ...x })) },
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

/** A：**完整真实流程** —— 新建员工 → 保存 → 选「导购」→ 开通账号。 */
async function scenarioA() {
  const listRef = { rows: [{ ...ROW_NOACC }] }   // 先只有"未开账号"的行
  const { ctx, calls } = makeCtx(listRef)
  const api = build(ctx)

  // ① 点「＋ 添加员工」：此刻账号区编辑态落到默认值 staff（= 员工）
  api.openCreate()
  info('A1', '【起点自证】打开新建弹窗时，账号区角色编辑态 = staff（员工）',
    ctx.accRoleEdit.value === 'staff', JSON.stringify(ctx.accRoleEdit.value))

  // ② 填姓名 + 点「保存」（v383 已修：保存后按 id 回列表取回完整档案）
  ctx.editForm.name = '吴敏'
  ctx.editForm.employee_no = 'E001'
  ctx.editForm.position = '导购'
  const r = await api.saveEmployeeCore()
  check('A2', '保存新建成功（v383 路径未回归）', r && r.ok === true && r.created === true, JSON.stringify(r))
  check('A3', '保存后姓名仍在输入框里（吴敏）', ctx.editForm.name === '吴敏', JSON.stringify(ctx.editForm.name))

  // ③ 在「开通账号」区选角色 = 导购（此后列表里该员工已带账号字段）
  listRef.rows = [{ ...ROW_ACC }]
  ctx.accForm2.username = '111111111'
  ctx.accForm2.password = 'Abcd1234'
  ctx.accForm2.role = ROLE

  // ④ 点「开通账号」
  await api.createAccountInEdit()

  const req = calls.acct[0]
  check('A4', '开通账号请求带上的角色 = guide（导购）', req && req.role === ROLE, req && JSON.stringify(req.role))
  check('A5', '开通账号请求成功（1 次）', calls.acct.length === 1, calls.acct.length)

  // ⑤ 【核心】界面必须停在后端真实角色上
  check('A6', '【核心】开通后角色下拉显示 = guide（导购），不是 staff（员工）',
    ctx.accRoleEdit.value === ROLE, JSON.stringify(ctx.accRoleEdit.value))
  check('A7', '【核心】开通后「有未保存的改动」标记 = false',
    api.accRoleDirty.value === false, JSON.stringify(api.accRoleDirty.value))
  check('A8', '开通后「可登录端」编辑态 = mini（导购的默认端）',
    ctx.accScopeEdit.value === SCOPE, JSON.stringify(ctx.accScopeEdit.value))
  check('A9', '开通后「可登录端」基线已对齐（脏判断基准不残留）',
    ctx.accScopeBase.value === ctx.accScopeEdit.value,
    JSON.stringify([ctx.accScopeBase.value, ctx.accScopeEdit.value]))
  check('A10', '开通后兼任角色清空（不是上一个人的残留）',
    Array.isArray(ctx.accRolesEdit.value) && ctx.accRolesEdit.value.length === 0,
    JSON.stringify(ctx.accRolesEdit.value))
  check('A11', '开通后界面已切到「已有账号」态（editTarget.has_account=1）',
    ctx.editTarget.value && ctx.editTarget.value.has_account === 1,
    ctx.editTarget.value && JSON.stringify(ctx.editTarget.value.has_account))
  check('A12', '开通后没有误报错误 toast', !calls.toast.some((t) => t.t === 'err'), JSON.stringify(calls.toast))
  return { ctx, calls, api }
}

/** B：**二次伤害** —— 若 A7 不成立，用户顺手点「保存」会把导购改回员工。
 *  这里直接按 `saveAll` 的判据复算：`snap.roleDirty = accRoleDirty` ⇒ 为 true 才会发 PUT role。 */
function scenarioB() {
  const { ctx, calls } = makeCtx({ rows: [{ ...ROW_ACC }] })
  const api = build(ctx)
  // 复现"打开弹窗时编辑态是 staff、库里是 guide"这一错位（= 修复前的运行态）
  ctx.accRoleEdit.value = 'staff'
  ctx.editTarget.value = { ...ROW_ACC }
  info('B1', '【机制自证】编辑态 staff ≠ 库里 guide ⇒ accRoleDirty 为真',
    api.accRoleDirty.value === true, JSON.stringify(api.accRoleDirty.value))
  info('B2', '【机制自证】dirty 为真 ⇒ saveAll 会发 PUT /role（把导购**真的**改回员工）',
    api.accRoleDirty.value === true && ctx.accRoleEdit.value === 'staff',
    JSON.stringify({ role: ctx.accRoleEdit.value, dirty: api.accRoleDirty.value }))
  return { ctx, calls, api }
}

/** C：**兜底不静默** —— 开通成功但列表里找不到该员工。 */
async function scenarioC() {
  const listRef = { rows: [] }                  // 列表空 ⇒ find 不到
  const { ctx, calls } = makeCtx(listRef)
  const api = build(ctx)
  api.openCreate()
  ctx.editForm.name = '吴敏'
  const r = await api.saveEmployeeCore()
  check('C1', '保存阶段兜底成功（v383 路径）', r && r.ok === true, JSON.stringify(r))
  listRef.rows = []
  ctx.accForm2.username = '111111111'
  ctx.accForm2.password = 'Abcd1234'
  ctx.accForm2.role = ROLE
  await api.createAccountInEdit()
  check('C2', '列表查不到时不静默（有 warn 提示）',
    calls.toast.some((t) => t.t === 'warn'), JSON.stringify(calls.toast))
  check('C3', '列表查不到时不抛异常、accBusy 已复位', ctx.accBusy.value === false, ctx.accBusy.value)
  return { ctx, calls }
}

/** D：**函数本身是好的** —— 直接喂"已开账号"的行给 resetEditForm，角色能正确落位。
 *  证明缺陷是「少调了一次」，不是「syncRoleEdit 写错了」。 */
function scenarioD() {
  const { ctx } = makeCtx({ rows: [{ ...ROW_ACC }] })
  const api = build(ctx)
  api.resetEditForm({ ...ROW_ACC })
  check('D1', 'resetEditForm(已开账号行) ⇒ 角色 = guide', ctx.accRoleEdit.value === ROLE,
    JSON.stringify(ctx.accRoleEdit.value))
  check('D2', 'resetEditForm(已开账号行) ⇒ 端 = mini', ctx.accScopeEdit.value === SCOPE,
    JSON.stringify(ctx.accScopeEdit.value))
  check('D3', 'resetEditForm(未开账号行) ⇒ 角色落默认 staff（这就是缺陷的起点）',
    (() => { api.resetEditForm({ ...ROW_NOACC }); return ctx.accRoleEdit.value })() === 'staff',
    JSON.stringify(ctx.accRoleEdit.value))
  return { ctx }
}

/* ============ 六、跑 ============ */

const a = await scenarioA()
scenarioB()
await scenarioC()
scenarioD()

const pass = results.filter((r) => r.ok).length
const fail = results.filter((r) => !r.ok && !r.info).length

for (const r of results) {
  const tag = r.info ? 'INFO' : (r.ok ? 'PASS' : 'FAIL')
  console.log(`[${tag}] ${r.id} ${r.label}` + (r.got !== '' ? `  → ${r.got}` : ''))
}
console.log('')
console.log(`RESULT pass=${pass} fail=${fail}`)

if (EXPECT_BROKEN) {
  // 反例模式：跑的是**修复前**的源码 ⇒ 必须至少有一项核心断言失败
  const core = results.filter((r) => ['A6', 'A7'].includes(r.id))
  const broke = core.some((r) => !r.ok)
  if (broke) { console.log('COUNTEREXAMPLE-OK —— 修复前源码如期复现缺陷'); process.exit(0) }
  console.log('🔴 反例模式：修复前源码竟然全绿 ⇒ 判据没有判别力')
  process.exit(1)
}
if (fail > 0) { console.log('🔴 有断言失败'); process.exit(1) }
console.log('✅ 全部通过')
process.exit(0)
