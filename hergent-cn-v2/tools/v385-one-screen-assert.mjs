#!/usr/bin/env node
/**
 * v385 判据 —— 「新建员工 / 选角色 / 开账号 **一屏一次完成**」的**行为级**验收。
 *
 * 老板需求（2026-10-06 20:59，附舟谱截图）：
 *   「我们能否采用一样的方式，新建员工/选择角色和创建账号在一个界面完成，不要分两步。」
 * 拍板：① 只做一屏一键（不加部门、不做角色两级）② 账号**选填**。
 *
 * 设计要点（同 v383/v384，为什么不是 grep 断言）：
 *   源码里"有没有写 if (wantAcc)"只能证明我改了字，证明不了**行为变了**。
 *   本脚本把 EmployeeArchive.vue 里的**真实函数源码原样抠出来**（逐字节、含注释），
 *   在 Node 里配一套 stub **真跑一遍** saveAll()，断言：
 *     · 一次提交 ⇒ 建档案 + 开账号**都发生**，且账号带的是用户选的角色；
 *     · 账号留空 ⇒ 只建档案（账号选填）；
 *     · 密码不合规 ⇒ **一个库都不写**（不留"档案已建、账号没开成"的半成品）；
 *     · 账号开失败 ⇒ 档案保留 + 草稿保留 + 明确提示（可自愈，不静默）；
 *     · 没有开账号权限 ⇒ 按钮文案退化成「创建员工」，**不静默丢输入**。
 *
 * 🔴 自证判别力：`--mutate=<id>` 会先把源码**故意改坏一处**再跑，要求指定断言**必须失败**。
 *    这是「探针先自证判别力」的落地 —— 全绿的判据可能只是没有判别力。
 *
 * 用法：
 *   node tools/v385-one-screen-assert.mjs <EmployeeArchive.vue>              # 必须全绿
 *   node tools/v385-one-screen-assert.mjs <EmployeeArchive.vue> --mutate=no-openacc
 * 退出码：0 = 符合预期；1 = 不符合预期。
 */
import fs from 'node:fs'

const VUE = process.argv[2]
const MUT_ARG = (process.argv.find((a) => a.startsWith('--mutate=')) || '').slice(9)
if (!VUE) {
  console.error('usage: node v385-one-screen-assert.mjs <EmployeeArchive.vue> [--mutate=<id>]')
  process.exit(2)
}
let src = fs.readFileSync(VUE, 'utf8')

/* ============ 一、变异（自证判别力）============ */

const MUTATIONS = {
  // 新建态不再接着开账号（= 修复前的行为）⇒ G4/G5/G9 必须红
  'no-openacc': {
    from: 'if (wantAcc) {\n        Object.assign(accForm2, accSnap)',
    to: 'if (false) {\n        Object.assign(accForm2, accSnap)',
    expectFail: ['G4', 'G5', 'G9'],
    what: '新建成功后不接着开账号',
  },
  // 账号草稿不恢复 ⇒ 用户填的登录名/角色被 resetEditForm 清掉 ⇒ G5/G8 必须红
  'no-accsnap': {
    from: 'Object.assign(accForm2, accSnap)',
    to: 'void 0',
    expectFail: ['G5', 'G8'],
    what: '不恢复账号草稿（登录名/角色被清空）',
  },
  // 去掉"先校验再落库" ⇒ 密码不合规时档案照样建出来 ⇒ I2 必须红（半成品）
  'no-precheck': {
    from: 'if (wantAcc && !pwdOk(accForm2.password))',
    to: 'if (false && wantAcc && !pwdOk(accForm2.password))',
    expectFail: ['I2'],
    what: '不提前校验密码（会留下"档案已建、账号没开成"的半成品）',
  },
  // 账号失败时静默（不提示、假装成功）⇒ J4 必须红
  'silent-fail': {
    from: "toast('员工档案已建好，但登录账号没开成：' + r2.detail + '。请在下方改好后点「开通账号」', 'err')",
    to: 'void 0',
    expectFail: ['J4'],
    what: '账号开失败时静默',
  },
  // 写库步骤返回裸布尔（= v382 遗留的返回形状不一致）⇒ saveAll 写完必提前返回 ⇒ L4/L5 必须红
  'scope-bool': {
    from: '    return { ok: true }\n  } catch (e) {\n    // 后端对"改自己"会 400',
    to: '    return true\n  } catch (e) {\n    // 后端对"改自己"会 400',
    expectFail: ['L4', 'L5'],
    what: 'saveAccScopeCore 返回裸布尔 ⇒ saveAll 写完「可登录端」后静默提前返回',
  },
}

let MUT = null
if (MUT_ARG) {
  MUT = MUTATIONS[MUT_ARG]
  if (!MUT) {
    console.error('未知变异：' + MUT_ARG)
    console.error('可选：' + Object.keys(MUTATIONS).join(' / '))
    process.exit(2)
  }
  if (!src.includes(MUT.from)) {
    console.error('🔴 变异锚点在新源码里找不到 ⇒ 判据已与源码脱节，请先修判据：')
    console.error(JSON.stringify(MUT.from))
    process.exit(2)
  }
  src = src.replace(MUT.from, MUT.to)
  console.log(`=== 变异模式：${MUT_ARG}（${MUT.what}）===`)
  console.log(`    要求这些断言**必须失败**：${MUT.expectFail.join(', ')}\n`)
}

/* ============ 二、从 .vue 里原样抠出真实源码 ============ */

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

/**
 * 抠出 `const NAME = computed( ... )` 的**整份声明**。
 *
 * 🔴 别改回"从 `=>` 之后找第一个 `{` 再配对"那种写法 —— 它有个**静默失效**：
 *    `computed(() => a && b)` 这种**表达式体**没有花括号，于是它会一路找到
 *    **后面某个不相干函数**的 `{`，把那段源码当成这个 computed 的身体，
 *    然后以 `ReferenceError: xxx is not defined` 在**运行时**炸开（或更糟：炸不出来，
 *    只是拿错了函数）。实测踩过：`accDraftWanted` 抠成了 `anyDirty` 的邻居。
 *    ⇒ 一律按 `computed(` 那个**圆括号**配对取声明，对两种函数体都成立。
 */
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

const CONSTS = ['PWD_MIN', 'PWD_HINT']
const FUNCS = [
  'snapshotForm', 'salaryOf', 'pwdOk', 'extraRolesOf', 'syncRoleEdit', 'resetEditForm',
  'openCreate', 'openEdit', 'saveEmployeeCore', 'createAccountCore', 'createAccountInEdit',
  'saveAccScopeCore', 'saveAll',
]
const COMPUTEDS = ['accRoleDirty', 'accScopeDirty', 'accDraftWanted', 'footerBtnLabel']
const PARTS = CONSTS.map(extractConst).concat(FUNCS.map(extractFn))
  .concat(COMPUTEDS.map(extractComputed)).join('\n\n')

/* ============ 三、装进可调用对象 ============ */

const build = new Function('ctx', `
  "use strict";
  const {
    editForm, formSnap, isCreate, editTarget, editOpen, employees, loading, empStats,
    accForm2, accScopeTouched, accRoleEdit, accRolesEdit, accScopeEdit, accScopeBase,
    accPwdEdit, showReset, showRename, accNameEdit, resetCode, resetCodeExp, accBusy,
    roleEndScope, canDo, employeeApi, staffAccountApi, api, toast, computed, store, loadEmployees,
    nameDirty, saveAccRoleCore
  } = ctx;
  ${PARTS}
  return { saveEmployeeCore, resetEditForm, openCreate, openEdit,
           createAccountCore, createAccountInEdit, saveAll, saveAccScopeCore,
           accRoleDirty, accScopeDirty, accDraftWanted, footerBtnLabel };
`)

/* ============ 四、stub 上下文 ============ */

const NEW_ID = 77
const ROLE = 'guide'          // 老板在界面选的：导购
const SCOPE = 'mini'          // 导购的默认端

const ROW_NOACC = {
  id: NEW_ID, name: '吴敏', employee_no: 'E001', position: '导购', hire_date: '',
  has_account: 0, account_user_id: null, account_role: '', account_roles: '',
  account_login_scope: '', account_active: 0, store_ids: [],
}
const ROW_ACC = {
  ...ROW_NOACC,
  has_account: 1, account_user_id: 8801, account_role: ROLE,
  account_login_scope: SCOPE, account_active: 1,
}

/** 与后端 `core._validate_password` 同口径 —— stub 必须**会拒弱密码**，
 *  否则「密码不合规 ⇒ 不留半成品」这条判据就没有判别力（变异测试会暴露）。 */
function pwdPolicyOk(p) {
  const s = String(p || '')
  return s.length >= 8 && /[0-9]/.test(s) && /[a-zA-Z]/.test(s)
}

/**
 * @param opts.perms   本角色的模块权限，如 { data:['create','update'], hr:['create'] }
 * @param opts.acctFail 非空 ⇒ 建账号接口抛这个错（模拟登录名撞车 / 后端策略拒绝）
 * @param opts.rowAcc   非空 ⇒ 列表里的员工**本来就有账号**（编辑态场景）
 */
function makeCtx(opts = {}) {
  const perms = opts.perms || { data: ['create', 'update'], hr: ['create', 'update'] }
  const calls = { emp: [], acct: [], toast: [], api: [] }
  const employees = { value: [] }
  /* ⚠️ 「账号真的建成了没有」必须与「发过几次请求」分开记 ——
     失败的请求也会进 `calls.acct`（它记的是"调用"），
     若拿 `calls.acct.length` 当"已开通"的判据，J 场景（故意失败）就会
     在列表里看到一条根本不存在的账号，把 J2 测反。 */
  const state = { acctOk: 0, scope: '' }
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
    computed: (fn) => ({ get value() { return fn() } }),
    canDo: (m, a) => Array.isArray(perms[m]) && (perms[m].includes('*') || perms[m].includes(a)),
    roleEndScope: (r) => (['guide', 'sales', 'staff', 'distributor'].includes(r) ? 'mini' : 'web'),
    // `nameDirty` / `saveAccRoleCore` 仍 stub —— 本脚本要测的路径里，角色**没有**被改动
    //（L 场景只改端），所以第 ② 步根本不会被调用。`accScopeDirty` / `saveAccScopeCore`
    // 则**用真源码**，因为 L 场景测的正是它们。
    nameDirty: { value: false },
    saveAccRoleCore: async () => ({ ok: true, scopeHandled: false }),
    // `api()` = 前端 HTTP 层的替身（saveAccScopeCore 走它发 PUT /login-scope）。
    // ⚠️ 写成功要**落到"库"里**（state.scope）—— 否则保存后刷新回来还是旧值，
    //    L6「编辑态已对齐到库里的值」就测的是个假象。
    api: async (path, opt) => {
      calls.api.push({ path, opt })
      if (path.includes('/login-scope')) state.scope = opt.body.login_scope
      return { success: true }
    },
    employeeApi: {
      list: async () => employees.value,
      create: async (b) => { calls.emp.push(b); return { success: true, employee_id: NEW_ID } },
      update: async (id, b) => { calls.emp.push({ id, ...b }); return { success: true } },
    },
    staffAccountApi: {
      createAccount: async (b) => {
        calls.acct.push(b)
        if (opts.acctFail) throw new Error(opts.acctFail)
        if (!pwdPolicyOk(b.password)) throw new Error('密码至少需要8位，且包含字母和数字')
        state.acctOk += 1
        return { success: true, user_id: 8801 }
      },
    },
    toast: (m, t) => calls.toast.push({ m, t }),
    store: { loadPerms() {} },
    // 列表接口只会补出**真实存在**的账号 ⇒ 用 state.acctOk（成功次数），不是调用次数。
    // `opts.rowAcc` 用于"进来时本来就有账号"的编辑态场景（那时 acctOk 恒为 0）；
    // `state.scope` 让刚写进去的「可登录端」在刷新后读得回来（同理，别让它读成旧值）。
    loadEmployees: async () => {
      employees.value = [{
        ...((opts.rowAcc || state.acctOk) ? ROW_ACC : ROW_NOACC),
        ...(state.scope ? { account_login_scope: state.scope } : {}),
      }]
    },
  }
  return { ctx, calls, state }
}

/* ============ 五、断言收集 ============ */

const results = []
function check(id, label, cond, got) {
  results.push({ id, label, ok: !!cond, got: got === undefined ? '' : String(got) })
}

/* ============ 六、场景 ============ */

/** G：**核心** —— 一屏填完（档案 + 账号 + 角色），一次提交。 */
async function scenarioG() {
  const { ctx, calls } = makeCtx()
  const api = build(ctx)

  api.openCreate()
  ctx.editForm.name = '吴敏'
  check('G1', '账号没填时，按钮文案 = 「创建员工」',
    api.footerBtnLabel.value === '创建员工', JSON.stringify(api.footerBtnLabel.value))

  // 同一屏里把账号也填上（这正是老板要的：不用先保存一次再回来）
  ctx.accForm2.username = '111111111'
  ctx.accForm2.password = 'Abcd1234'
  ctx.accForm2.role = ROLE
  ctx.accForm2.login_scope = SCOPE
  check('G2', '账号填了之后，按钮文案 = 「创建并开通账号」',
    api.footerBtnLabel.value === '创建并开通账号', JSON.stringify(api.footerBtnLabel.value))

  await api.saveAll()

  check('G3', '【核心】一次提交后建了员工档案（1 次）', calls.emp.length === 1, calls.emp.length)
  check('G4', '【核心】一次提交后**把账号也开了**（1 次）', calls.acct.length === 1, calls.acct.length)
  const req = calls.acct[0]
  check('G5', '【核心】开账号带的是用户选的角色 = guide（导购）',
    req && req.role === ROLE, req && JSON.stringify(req.role))
  check('G6', '没手工改过「可登录端」⇒ 不带该字段（由后端按角色取默认，不覆盖租户配置）',
    req && req.login_scope === '', req && JSON.stringify(req.login_scope))
  check('G7', '开账号绑定的员工 id = 刚建的那一条', req && req.employee_id === NEW_ID,
    req && JSON.stringify(req.employee_id))
  check('G8', '【核心】提交后账号草稿仍在（没被 resetEditForm 清掉，用户不必重敲）',
    ctx.accForm2.username === '111111111' && ctx.accForm2.password === 'Abcd1234'
    && ctx.accForm2.role === ROLE,
    JSON.stringify({ u: ctx.accForm2.username, r: ctx.accForm2.role }))
  check('G9', '提交后提示「员工已创建，登录账号已开通」且无错误提示',
    calls.toast.some((t) => t.m.includes('员工已创建') && t.t === 'ok')
    && !calls.toast.some((t) => t.t === 'err'), JSON.stringify(calls.toast))
  check('G10', '界面已切到「已有账号」态（editTarget.has_account=1）',
    ctx.editTarget.value && ctx.editTarget.value.has_account === 1,
    ctx.editTarget.value && JSON.stringify(ctx.editTarget.value.has_account))
  check('G11', 'v384 未回归：开通后角色编辑态 = guide（不是 staff）',
    ctx.accRoleEdit.value === ROLE, JSON.stringify(ctx.accRoleEdit.value))
  check('G12', '收尾：accBusy 已复位', ctx.accBusy.value === false, ctx.accBusy.value)
  return { ctx, calls }
}

/** H：**账号选填** —— 留空 ⇒ 只建档案，一个账号请求都不发。 */
async function scenarioH() {
  const { ctx, calls } = makeCtx()
  const api = build(ctx)
  api.openCreate()
  ctx.editForm.name = '李四'
  check('H1', '账号留空 ⇒ 按钮文案仍 = 「创建员工」',
    api.footerBtnLabel.value === '创建员工', JSON.stringify(api.footerBtnLabel.value))
  await api.saveAll()
  check('H2', '账号留空 ⇒ 只建档案（1 次）', calls.emp.length === 1, calls.emp.length)
  check('H3', '账号留空 ⇒ 不发任何开账号请求（0 次）', calls.acct.length === 0, calls.acct.length)
  check('H4', '账号留空 ⇒ 无错误提示', !calls.toast.some((t) => t.t === 'err'), JSON.stringify(calls.toast))
  return { ctx, calls }
}

/** I：**不留半成品** —— 密码不合规时，档案也**不能**建出来。
 *  这是"合并成一屏"新引入的风险面：分两步时不存在这个状态（账号是第二步才校验）。 */
async function scenarioI() {
  const { ctx, calls } = makeCtx()
  const api = build(ctx)
  api.openCreate()
  ctx.editForm.name = '王五'
  ctx.accForm2.username = '222222222'
  ctx.accForm2.password = 'abc'          // 不合规
  ctx.accForm2.role = ROLE
  check('I1', '密码不合规但账号已填 ⇒ 按钮仍承诺「创建并开通账号」',
    api.footerBtnLabel.value === '创建并开通账号', JSON.stringify(api.footerBtnLabel.value))
  await api.saveAll()
  check('I2', '【核心】密码不合规 ⇒ 员工档案**一个都没建**（不留半成品）',
    calls.emp.length === 0, calls.emp.length)
  check('I3', '密码不合规 ⇒ 不发开账号请求', calls.acct.length === 0, calls.acct.length)
  check('I4', '密码不合规 ⇒ 明确报错（不静默）',
    calls.toast.some((t) => t.t === 'err' && t.m.includes('密码')), JSON.stringify(calls.toast))
  check('I5', '密码不合规 ⇒ accBusy 已复位（按钮不会卡在禁用）',
    ctx.accBusy.value === false, ctx.accBusy.value)
  return { ctx, calls }
}

/** J：**账号失败可自愈** —— 档案保留、草稿保留、明确说明。 */
async function scenarioJ() {
  const { ctx, calls } = makeCtx({ acctFail: '账号已存在: 111111111' })
  const api = build(ctx)
  api.openCreate()
  ctx.editForm.name = '吴敏'
  ctx.accForm2.username = '111111111'
  ctx.accForm2.password = 'Abcd1234'
  ctx.accForm2.role = ROLE
  await api.saveAll()
  check('J1', '账号开失败时，员工档案**已保留**（不假装全成功、也不回滚掉档案）',
    calls.emp.length === 1, calls.emp.length)
  check('J2', '账号开失败后界面停在「未开通账号」态（用户可就地重试）',
    ctx.editTarget.value && ctx.editTarget.value.has_account === 0,
    ctx.editTarget.value && JSON.stringify(ctx.editTarget.value.has_account))
  check('J3', '账号开失败后**草稿还在**（登录名/角色/密码没被清空，可直接重试）',
    ctx.accForm2.username === '111111111' && ctx.accForm2.role === ROLE
    && ctx.accForm2.password === 'Abcd1234',
    JSON.stringify({ u: ctx.accForm2.username, r: ctx.accForm2.role }))
  check('J4', '【核心】账号开失败**不静默**：提示里说明"员工档案已建好"+ 原因',
    calls.toast.some((t) => t.t === 'err' && t.m.includes('员工档案已建好')
      && t.m.includes('账号已存在')),
    JSON.stringify(calls.toast))
  check('J5', '账号开失败后 accBusy 已复位', ctx.accBusy.value === false, ctx.accBusy.value)
  return { ctx, calls }
}

/** K：**没有开账号权限** ⇒ 按钮退化成「创建员工」，且不静默丢输入。 */
async function scenarioK() {
  const { ctx, calls } = makeCtx({ perms: { hr: ['create', 'update'] } })   // 只有建档案权限
  const api = build(ctx)
  api.openCreate()
  ctx.editForm.name = '赵六'
  // 即使（模板正常情况下不会渲染出来的）账号字段被填了，也不能悄悄丢掉
  ctx.accForm2.username = '333333333'
  ctx.accForm2.role = ROLE
  check('K1', '没有开账号权限 ⇒ 按钮文案 = 「创建员工」（不承诺开号）',
    api.footerBtnLabel.value === '创建员工', JSON.stringify(api.footerBtnLabel.value))
  await api.saveAll()
  check('K2', '没有开账号权限 ⇒ 只建档案（1 次）', calls.emp.length === 1, calls.emp.length)
  check('K3', '没有开账号权限 ⇒ 不发开账号请求（不会半成功）',
    calls.acct.length === 0, calls.acct.length)
  return { ctx, calls }
}

/** L：**只改「可登录端」** —— 写一屏一键时**顺带抓到**的一处 v382 遗留缺陷。
 *  `saveAccScopeCore` 返回裸布尔，而 saveAll 的调用点读 `r3.ok` ⇒ 恒 `undefined` ⇒ 恒真
 *  ⇒ **写完可登录端必然提前返回**：库里真的改了，但界面不刷新、不弹成功提示、窗口不关，
 *  脏标签还在 ⇒ 用户以为没保存，反复点。 */
async function scenarioL() {
  const { ctx, calls } = makeCtx({ rowAcc: true })
  const api = build(ctx)
  api.openEdit({ ...ROW_ACC })
  check('L1', '起点：打开已开通账号的员工，角色/端编辑态与库里一致（无脏标记）',
    api.accScopeDirty.value === false && api.accRoleDirty.value === false,
    JSON.stringify([api.accScopeDirty.value, api.accRoleDirty.value]))
  ctx.accScopeEdit.value = 'both'                 // 用户**只**改「可登录端」
  check('L2', '只改「可登录端」⇒ accScopeDirty = true',
    api.accScopeDirty.value === true, JSON.stringify(api.accScopeDirty.value))
  await api.saveAll()
  check('L3', '写库确实发了 PUT /login-scope（1 次）',
    calls.api.length === 1 && calls.api[0].path.includes('/login-scope'),
    JSON.stringify(calls.api.map((c) => c.path)))
  check('L4', '【核心】写完**没有静默提前返回** —— 成功提示出现了',
    calls.toast.some((t) => t.t === 'ok' && t.m.includes('已保存')), JSON.stringify(calls.toast))
  check('L5', '【核心】saveAll 正常收尾：窗口已关闭',
    ctx.editOpen.value === false, ctx.editOpen.value ? '仍开着（= 静默提前返回了）' : '已关闭')
  check('L6', '编辑态已对齐到库里的新值（端 = both，脏标签消掉）',
    ctx.accScopeEdit.value === 'both' && ctx.accScopeBase.value === 'both',
    JSON.stringify([ctx.accScopeEdit.value, ctx.accScopeBase.value]))
  return { ctx, calls }
}

/* ============ 七、跑 ============ */

await scenarioG()
await scenarioH()
await scenarioI()
await scenarioJ()
await scenarioK()
await scenarioL()

const failIds = results.filter((r) => !r.ok).map((r) => r.id)
for (const r of results) {
  console.log(`[${r.ok ? 'PASS' : 'FAIL'}] ${r.id} ${r.label}` + (r.got !== '' ? `  → ${r.got}` : ''))
}
const pass = results.filter((r) => r.ok).length
console.log('')
console.log(`RESULT pass=${pass} fail=${failIds.length}`)

if (MUT) {
  const missing = MUT.expectFail.filter((id) => !failIds.includes(id))
  if (missing.length === 0) {
    console.log(`✅ 变异自证通过 —— 「${MUT.what}」如期让 ${MUT.expectFail.join('/')} 变红`)
    process.exit(0)
  }
  console.log(`🔴 变异自证失败 —— 改坏了「${MUT.what}」，但这些断言竟然还是绿的：${missing.join(', ')}`)
  console.log('   ⇒ 它们没有判别力，等于没测。')
  process.exit(1)
}
if (failIds.length > 0) { console.log('🔴 有断言失败'); process.exit(1) }
console.log('✅ 全部通过')
process.exit(0)
