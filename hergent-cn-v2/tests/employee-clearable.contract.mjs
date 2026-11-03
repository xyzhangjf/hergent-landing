/* v737 契约：员工档案里「用户能删空的字段」必须真的能删空（前后端成对，少一边即静默失效）。
 *
 * 为什么需要它 —— 老板实测：「柏万红是导购，员工档案里把她的岗位名称写的是『老板』，
 * 我删掉点击保存后又变回『老板』」。三层各自"正确"，合起来是一次**零报错的假保存**：
 *   ① 前端 `position: f.position || undefined` ⇒ 清空即 `undefined`；
 *   ② `JSON.stringify` 丢掉值为 `undefined` 的键 ⇒ 请求里根本没有 position
 *      ⇒ 后端 `if k in d` 判不到 ⇒ 不写库（HTTP 200）；
 *   ③ 保存后的回读校验 `if (body[k] === undefined) continue` ⇒ 也跳过 position
 *      ⇒ toast 照常「已保存」，重开弹窗又是「老板」。
 * 这类缺陷**任何一层单改都测不出来**：改前端不改后端会变成「保存未生效」红字，
 * 改后端不改前端则一行都没变 —— 只有静态钉住这一对才能防回归。
 *
 * 判据（每条都带坏样本自证，否则"永远通过"的护栏等于没有）：
 *   ① 前端 `CLEARABLE_FIELDS` 里每一列在 body 里都不得写成 `|| undefined`；
 *   ② 前端必须有兜底循环（新加字段忘了写 `''` 也不会退化）；
 *   ③ 两个数字列走 `numOrZero`（发 `''` 会被后端 `d[k] != ''` 当"没传"）；
 *   ④ 后端 `_clearable` 集合与前端 `CLEARABLE_FIELDS` **完全相同**（多/少任一列都判失败）；
 *   ⑤ 回读校验的跳过条件不得放宽到"空值也跳过"（那等于把这道闸门关掉）。
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const PAGE = path.join(ROOT, 'src/pages/EmployeeArchive.vue')
const SERVER = path.join(ROOT, '../.workbuddy/remote-erp/server.py')

let failed = 0
const ok = (cond, label, extra = '') => {
  if (cond) console.log('  ✅ ' + label + (extra ? ' ' + extra : ''))
  else { console.log('  ❌ ' + label + (extra ? ' ' + extra : '')); failed++ }
}

/** 剥掉块注释 / 行注释，只留"会真正执行"的代码（本仓已有多次"扫注释里的示例"误报） */
const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

/** 取 saveEmployeeCore 的函数体（到下一个行首 `}` 为止） */
export function coreBody(src) {
  const s = strip(src)
  const i = s.indexOf('async function saveEmployeeCore')
  if (i < 0) return ''
  const j = s.indexOf('\n}', i)
  return j < 0 ? s.slice(i) : s.slice(i, j)
}

/** 取 `const body = { ... }` 的对象字面量 */
export function bodyLiteral(core) {
  const i = core.indexOf('const body = {')
  if (i < 0) return ''
  const j = core.indexOf('\n  }', i)
  return j < 0 ? '' : core.slice(i, j)
}

/** 取前端 CLEARABLE_FIELDS 数组 */
export function frontFields(src) {
  const m = strip(src).match(/const CLEARABLE_FIELDS\s*=\s*\[([\s\S]*?)\]/)
  if (!m) return null
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
}

/** 取后端 _clearable 集合 */
export function backFields(pySrc) {
  const m = pySrc.match(/_clearable\s*=\s*\{([\s\S]*?)\}/)
  if (!m) return null
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
}

/** ① 主要判据：可清空列在 body 里不得出现 undefined（可对坏样本复用） */
export function undefinedFields(bodySrc, fields) {
  const bad = []
  for (const k of fields) {
    const m = bodySrc.match(new RegExp(`(?:^|[\\s,{])${k}\\s*:([^,\\n]*(?:\\n(?!\\s*[a-z_]+\\s*:)[^,\\n]*)*)`))
    if (!m) { bad.push(`${k}(缺失)`); continue }
    if (/\bundefined\b/.test(m[1])) bad.push(k)
  }
  return bad
}

const pageSrc = fs.readFileSync(PAGE, 'utf8')
const core = coreBody(pageSrc)
const body = bodyLiteral(core)
const feFields = frontFields(pageSrc)

/* ── ① body：可清空列一律发空串，不许发 undefined ── */
console.log('① 可清空列在请求体里不得是 undefined（清空 ≠ 没传）')
ok(core.length > 0, '定位到 saveEmployeeCore')
ok(body.length > 0, '定位到 body 字面量')
ok(Array.isArray(feFields) && feFields.length >= 14, 'CLEARABLE_FIELDS 已定义且覆盖 14 列',
  feFields ? `(${feFields.length})` : '(没找到)')
if (body && feFields) {
  const bad = undefinedFields(body, feFields)
  ok(bad.length === 0, '每一列都发空串（0 处 undefined）', bad.length ? `坏样本：${bad.join(', ')}` : '')
  // 位置这一列是本次报障点，单独钉一次（防止有人"整体重排"时把它顺手改回去）
  ok(/position\s*:\s*f\.position\s*\|\|\s*''/.test(body), "position 写成 `f.position || ''`")
}

/* ── ② 兜底循环：新加字段忘了写 '' 也不会退化成静默失效 ── */
console.log('② 发送前兜底（漏写也补空串）')
ok(/for\s*\(\s*const\s+k\s+of\s+CLEARABLE_FIELDS\s*\)/.test(core), '遍历 CLEARABLE_FIELDS 兜底')
ok(/body\[k\]\s*===\s*undefined\s*\)\s*body\[k\]\s*=\s*''/.test(core.replace(/\s+/g, ' ')),
  "兜底把 undefined 补成 ''")

/* ── ③ 数字列：清空发 0，不发 '' 也不发 undefined ── */
console.log('③ 数字列（社保基数 / 公积金基数）')
ok(/social_insurance_base\s*:\s*numOrZero\(/.test(body), 'social_insurance_base 走 numOrZero')
ok(/housing_fund_base\s*:\s*numOrZero\(/.test(body), 'housing_fund_base 走 numOrZero')
ok(/function\s+numOrZero\s*\(/.test(pageSrc), 'numOrZero 已定义')
/* 🔴 反向那一半：存 0 之后，回填绝不能把 0 显示成「0」。
   否则「清空 → 保存 → 重开」会凭空冒出一个 0，等于拿一次修复换一个新怪现象
   （与 `perf_score` 的 0=未评 同口径）。 */
{
  /* 判据抽成函数，才能喂坏样本自证（否则「坏样本」那条只是断言正则能匹配字面量，恒真） */
  const refillShowsZero = (lines) => lines.some((l) => /!=\s*null/.test(l))
  const refillLines = (strip(pageSrc).match(/editForm\.(?:social_insurance_base|housing_fund_base)\s*=[^\n]*/g) || [])
  ok(refillLines.length === 2, '两处基数回填都能定位到', `(${refillLines.length})`)
  ok(!refillShowsZero(refillLines), '回填把 0 折算成空输入框（不显示「0」）',
    refillShowsZero(refillLines) ? '仍用 `!= null` 判断 ⇒ 清空后重开会冒出「0」' : '')
  // 坏样本自证：同一判据喂给旧写法必须命中
  const badRefill = ['editForm.social_insurance_base = src.social_insurance_base != null ? src.social_insurance_base : null']
  ok(refillShowsZero(badRefill), '坏样本 `!= null` 会被同一判据抓出（不是恒真）')
  ok(!refillShowsZero(['editForm.social_insurance_base = src.social_insurance_base ? src.social_insurance_base : null']),
    '干净样本零命中')
}

/* ── ④ 前后端清单必须同名同集合 ── */
console.log('④ 前后端可清空清单必须完全一致')
if (!fs.existsSync(SERVER)) {
  console.log('  ⏭ SKIP：找不到后端 server.py（仅前端仓）')
} else {
  const py = fs.readFileSync(SERVER, 'utf8')
  const beFields = backFields(py)
  ok(!!beFields && beFields.length > 0, '后端 _clearable 已定义',
    beFields ? `(${beFields.length})` : '(没找到)')
  if (beFields && feFields) {
    const onlyFe = feFields.filter((k) => !beFields.includes(k))
    const onlyBe = beFields.filter((k) => !feFields.includes(k))
    ok(onlyFe.length === 0, '前端发的每一列后端都允许清空', onlyFe.length ? `后端缺：${onlyFe.join(', ')}` : '')
    ok(onlyBe.length === 0, '后端允许的每一列前端都在发', onlyBe.length ? `前端缺：${onlyBe.join(', ')}` : '')
  }
  // 后端那条"空串当没传"的分支不得被整体删掉（删了会让 warehouse_id 等语义一起变）
  ok(/d\[k\]\s*!=\s*''\s*or\s+k\s+in\s+_clearable/.test(py), "后端仍区分「没传」与「清空」（`!= '' or k in _clearable`）")
}

/* ── ⑤ 回读校验：这道闸门不许放宽 ── */
console.log('⑤ 保存后回读校验（闸门不许关）')
ok(/for\s*\(\s*const\s+k\s+of\s+DRIFT_CHECK_FIELDS\s*\)/.test(core), '回读校验仍在遍历 DRIFT_CHECK_FIELDS')
ok(/body\[k\]\s*===\s*undefined\)\s*continue/.test(core.replace(/\s+/g, ' ')),
  '跳过条件仍只认 undefined（不许改成"空值也跳过"）')
ok(/DRIFT_CHECK_FIELDS\s*=\s*\[[^\]]*'position'/.test(strip(pageSrc).replace(/\s+/g, ' ')),
  'position 在 DRIFT_CHECK_FIELDS 里（保存后会被回读比对）')

/* ── ⑥ 坏样本自证：把同一套判据喂给"有缺陷的写法"，必须抓得出来 ── */
console.log('⑥ 坏样本自证（判据必须有判别力）')
if (feFields) {
  const badBody = body.replace(/position\s*:\s*f\.position\s*\|\|\s*''/, 'position: f.position || undefined')
  const caught = undefinedFields(badBody, feFields)
  ok(caught.includes('position'), '坏样本 `position: f.position || undefined` 被抓出', `(命中 ${caught.join(',') || '无'})`)
  const cleanBody = body
  ok(undefinedFields(cleanBody, feFields).length === 0, '干净样本零命中（不是恒真）')
  // 后端清单少一列也必须能判出来（把真实源码里那列删掉再跑同一套比对）
  const beSrc = (() => { try { return fs.readFileSync(SERVER, 'utf8') } catch { return '' } })()
  if (beSrc) {
    // ⚠️ 只在 `_clearable` 块内删 —— `,'position',` 在文件里出现的第一处是
    //    `employee_create` 的 allowed，全局 replace 会删错地方（那才是恒真的假自证）。
    const shrunk = beSrc.replace(/(_clearable\s*=\s*\{)([\s\S]*?)(\})/, (m, a, inner, b) =>
      a + inner.replace(/'position'\s*,\s*/, '') + b)
    const beShrunk = backFields(shrunk) || []
    const onlyFe = feFields.filter((k) => !beShrunk.includes(k))
    ok(beShrunk.length === feFields.length - 1 && onlyFe.includes('position'),
      '坏样本：后端清单删掉 position ⇒ 比对当场报「后端缺 position」', `(命中 ${onlyFe.join(',') || '无'})`)
  }
}
function backFieldsSafe() {
  try { return backFields(fs.readFileSync(SERVER, 'utf8')) } catch { return null }
}

console.log('\n' + (failed === 0 ? 'RESULT: ALL PASS' : `RESULT: FAILED (${failed})`))
process.exit(failed === 0 ? 0 : 1)
