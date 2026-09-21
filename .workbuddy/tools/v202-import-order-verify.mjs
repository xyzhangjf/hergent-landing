#!/usr/bin/env node
/* v202 离线验证：**导入模板行序 → 页面行底顺序**
 *
 * 用户诉求：「预报订单模板导入后，系统中显示的商品名称排序与导入模板中的商品名称排序
 *   不一致。请调整系统逻辑，使导入后系统中的商品名称排列顺序与导入模板中的商品名称顺序
 *   完全保持一致，不受其他排序规则影响。」
 *
 * 本脚本做两件事，缺一不可：
 *   ① **形态断言** —— 从源码里 grep 关键表达式，证明下面这段「复刻实现」没有与源码漂移
 *      （只写行为断言的话，源码改了逻辑而脚本没跟上，脚本会一直绿 —— 那是假绿）
 *   ② **行为断言** —— 用生产真实数据（tenant_1 期次 9：154 个登记商品 / 285 个在售档案）
 *      跑四种场景，证明「模板行序真的决定了行底顺序」
 *
 * 数据准备（只读，不改生产）：
 *   ssh root@47.113.224.140 "python3 -" > /tmp/v202-data.json <<'EOF' … EOF
 *   （导出 reg_order = 登记 id 升序的 product_id 列表、grid_order = products/grid 的 id DESC
 *     顺序、names = id→名称）
 */
import { readFileSync } from 'node:fs'

const ROOT = '/Users/zhangjunfeng/Documents/laozhangai-product'
const VUE = ROOT + '/hergent-cn-v2/src/pages/Forecast.vue'
const PY = '/Users/zhangjunfeng/Documents/hergent-erp/server/erp_db.py'
const IMP = '/Users/zhangjunfeng/Documents/hergent-erp/server/routers/import_router.py'
const DATA = ROOT + '/.workbuddy/tools/data/v202-tenant1-period9.json'

let pass = 0, fail = 0
function ok(cond, label, extra = '') {
  if (cond) { pass++; console.log('  PASS  ' + label + (extra ? '  ' + extra : '')) }
  else { fail++; console.log('  FAIL  ' + label + (extra ? '  ' + extra : '')) }
}
function head(t) { console.log('\n== ' + t + ' ==') }

/* ────────────────────────────────────────────────────────────────────────
   复刻实现：与 Forecast.vue::buildRowBase 的**排序段**逐行等价。
   下面的 A 组断言负责证明这一点。
   ──────────────────────────────────────────────────────────────────────── */
function buildRowBaseOrder(allProds, importedProducts, showAll, refExtra = []) {
  const byId = {}
  const impOrder = {}
  ;(importedProducts || []).forEach((p, i) => {
    const pid = Number(p.id)
    byId[pid] = byId[pid] || p
    if (pid in impOrder) return
    const sn = Number(p.sort_no) || 0
    impOrder[pid] = sn > 0 ? { t: 0, k: sn } : { t: 1, k: i }
  })
  const reportById = {}
  ;(refExtra || []).forEach(r => { if (r && r.product_id) reportById[Number(r.product_id)] = r })
  const refIds = new Set([...Object.keys(byId).map(Number), ...Object.keys(reportById).map(Number)])
  const gridIds = new Set(allProds.map(p => Number(p.id)))
  const off = []
  refIds.forEach(pid => {
    if (!pid || gridIds.has(pid)) return
    off.push({ id: pid })
  })
  const keep = showAll ? allProds : allProds.filter(p => refIds.has(Number(p.id)))
  const out = keep.concat(off)
  const rank = p => impOrder[Number(p.id)] || null
  out.sort((a, b) => {
    const ao = rank(a), bo = rank(b)
    if (ao && bo) return (ao.t - bo.t) || (ao.k - bo.k)
    if (ao) return -1
    if (bo) return 1
    return 0
  })
  return out.map(p => Number(p.id))
}

/* ════════════════════════════════════════════════════════════════════════ */
head('A. 形态断言：复刻实现必须与源码一致（防「源码改了、脚本还是绿」）')

const vue = readFileSync(VUE, 'utf8')
const py = readFileSync(PY, 'utf8')
const imp = readFileSync(IMP, 'utf8')

ok(vue.includes('impOrder[pid] = sn > 0 ? { t: 0, k: sn } : { t: 1, k: i }'),
  'Forecast.vue 含三档顺序键（tier 0 = 有 sort_no / tier 1 = 存量登记 / 不在表内 = 最后）')
ok(vue.includes('return (ao.t - bo.t) || (ao.k - bo.k)'), 'Forecast.vue 含 tier→k 两级比较器')
ok(vue.includes('const rank = p => impOrder[Number(p.id)] || null'), 'Forecast.vue 的比较器取键方式一致')
ok(!vue.includes('const byId = {}\n  ;(importedProducts || []).forEach(p => { byId[Number(p.id)] = byId[Number(p.id)] || p })'),
  'Forecast.vue 已不含 v202 之前的「只建 byId 不建顺序」旧实现')
ok(vue.includes('rowBaseOrder.value = rowBase.map(p => Number(p.id))') &&
  (vue.match(/rowBaseOrder\.value = rowBase\.map/g) || []).length === 2,
  '两个加载点（查看态 / 编辑态）都记录了行底原始顺序', '（实测 2 处）')
ok(vue.includes('const rowBaseOrder = ref([])'), 'rowBaseOrder 定义存在')

ok(py.includes('ALTER TABLE forecast_import_products ADD COLUMN sort_no INTEGER DEFAULT 0'),
  'erp_db.py 含 sort_no 补列（存量租户库惰性迁移）')
ok(py.includes("COALESCE(r.sort_no,0) AS sort_no"), 'summary 的 imported_products 下发了 sort_no')
ok(py.includes('ORDER BY CASE WHEN COALESCE(r.sort_no,0)>0 THEN 0 ELSE 1 END,') &&
  py.includes('COALESCE(r.sort_no,0), r.id'),
  'summary 按 (有无 sort_no, sort_no, id) 排序 —— 存量行退化为「登记插入序」')
ok(py.includes('_has_sort = "sort_no" in _cols'), '「复制上期清单」一并带 sort_no')

ok(imp.includes("_batch_base = (int(_mx or 0) // _BATCH_SPAN + 1) * _BATCH_SPAN"),
  '导入侧计算批次基准（分批导入时「一批」在顺序上是一个整体）')
ok(imp.includes('"row_no": _row_no'), '导入侧记录了模板行号')
ok(imp.includes("origin='import', sort_no=?") && imp.includes('_sno, _period_id, _rr["pid"]'),
  'UPDATE 一并刷新 sort_no（重导同一模板时顺序按最新模板生效）')
ok(imp.includes('_sno = _batch_base + int(_rr.get("row_no") or 0)'), 'sort_no = 批次基准 + 模板行号')

/* ════════════════════════════════════════════════════════════════════════ */
head('B. 真实数据：生产库 tenant_1 期次 9')

const d = JSON.parse(readFileSync(DATA, 'utf8'))
const nm = id => String(d.names[String(id)] ?? d.names[id] ?? '(未知)')
const REG = d.reg_order.map(Number)          // 登记插入序 = 模板序（实证：期次 9 与 13 逐行相同）
const GRID = d.grid_order.map(Number)        // products/grid = id DESC（修复前页面实际序）
const inGrid = new Set(GRID)

console.log(`  登记 ${REG.length} 行 ｜ 在售档案 ${GRID.length} 行 ｜ 登记商品在售的 ${REG.filter(p => inGrid.has(p)).length} 个`)

ok(REG.length === 154, '真实数据就位（154 个登记商品）')
ok(JSON.stringify(REG) !== JSON.stringify(REG.slice().sort((a, b) => b - a)) && REG.join() !== GRID.filter(p => REG.includes(p)).join(),
  '🔴 前提成立：登记序 ≠ 在售档案的 id DESC 序（修复前页面序 = 后者）')

// 场景 1：**存量期次**（sort_no 全 0，迁移补列的默认值）—— 期望退化为「登记插入序」
{
  const imported = REG.map(id => ({ id, sort_no: 0 }))
  const got = buildRowBaseOrder(GRID.map(id => ({ id })), imported, false)
  ok(JSON.stringify(got) === JSON.stringify(REG),
    'B1 存量期次（sort_no=0）→ 行底顺序 == 登记插入序（零数据写入即改善）',
    `首行 ${nm(got[0])}`)
  const before = GRID.filter(p => REG.includes(p))
  ok(got[0] !== before[0] && got[0] === REG[0],
    'B1b 修复前首行被 products.id DESC 顶到最前；修复后回到登记首行',
    `修复前「${nm(before[0]).slice(0, 14)}」→ 修复后「${nm(got[0]).slice(0, 14)}」`)
}

// 场景 2：**新导入**（sort_no = 模板行号）—— 期望严格跟随 sort_no
{
  const wanted = REG.map((id, i) => ({ id, sort_no: i + 1 }))
  const got = buildRowBaseOrder(GRID.map(id => ({ id })), wanted, false)
  ok(JSON.stringify(got) === JSON.stringify(REG), 'B2 新导入（sort_no=1..N）→ 行底顺序 == 模板行序')
}

// 场景 3：**sort_no 与登记序相反** —— 证明顺序由 sort_no 决定，而不是碰巧与登记序相同
{
  const rev = REG.slice().reverse()
  const imported = REG.map((id, i) => ({ id, sort_no: REG.length - i }))
  const got = buildRowBaseOrder(GRID.map(id => ({ id })), imported, false)
  ok(JSON.stringify(got) === JSON.stringify(rev),
    'B3 sort_no 置为逆序 → 行底顺序**完全倒过来**（证明真按 sort_no 排，不是空转）',
    `首行 ${nm(got[0])}`)
}

// 场景 4：**混合** —— 一半新导入（tier 0）、一半存量（tier 1）
{
  const half = Math.floor(REG.length / 2)
  const imported = REG.map((id, i) => ({ id, sort_no: i < half ? 100000 + i + 1 : 0 }))
  const got = buildRowBaseOrder(GRID.map(id => ({ id })), imported, false)
  const expect = REG.slice(0, half).concat(REG.slice(half))
  ok(JSON.stringify(got) === JSON.stringify(expect),
    'B4 一半有 sort_no、一半为 0 → 有值的前半按行序、存量后半按登记序（tier 生效）')
}

// 场景 5：**不在登记台账里的商品**（小程序报单 / 手工新增）—— 必须排在最后
{
  const extraPid = GRID.find(p => !REG.includes(p))
  const imported = REG.map((id, i) => ({ id, sort_no: i + 1 }))
  const got = buildRowBaseOrder(GRID.map(id => ({ id })), imported, false, [{ product_id: extraPid }])
  ok(got.length === REG.length + 1 && got[got.length - 1] === extraPid,
    'B5 不在登记台账里的商品（有报单但没导入）排最后，不插进模板行之间',
    `末行 ${nm(extraPid)}`)
}

// 场景 6：**显示全部商品**（showAll）—— 导入的仍在最前且按模板序
{
  const imported = REG.map((id, i) => ({ id, sort_no: i + 1 }))
  const got = buildRowBaseOrder(GRID.map(id => ({ id })), imported, true)
  // ⚠️ 行底 = 在售档案 ∪ **不在在售档案但被本期引用的行**（实测 154 个登记商品里 3 个已停用）
  //    ⇒ 全量视图下不是 `GRID.length` 而是 `GRID.length + 档案外行数`。
  //    （首版断言就写成了 `GRID.length`，被本脚本自己抓到 —— 断言写错与实现出错长得一样，
  //      所以每条 FAIL 都要先回读实现再改断言。）
  const offN = REG.filter(p => !inGrid.has(p)).length
  ok(got.length === GRID.length + offN,
    'B6a 勾「显示全部商品」时行数 = 全量在售档案 + 档案外的本期行',
    `${got.length} 行 = ${GRID.length} + ${offN}`)
  ok(JSON.stringify(got.slice(0, REG.length)) === JSON.stringify(REG),
    'B6b 全量视图下导入的商品仍按模板序排在最前')
}

// 场景 7：**档案外的行**（已停用但被本期引用）也不打乱模板序
{
  const offPid = 999999
  const imported = REG.map((id, i) => ({ id, sort_no: i + 1 })).concat([{ id: offPid, sort_no: 0 }])
  const got = buildRowBaseOrder(GRID.map(id => ({ id })), imported, false)
  ok(got[got.length - 1] === offPid && got.length === REG.length + 1,
    'B7 档案外的登记行（已停用）跟在模板序列之后')
}

/* ════════════════════════════════════════════════════════════════════════ */
console.log('\n== 结果 ==')
console.log(`  PASS=${pass}  FAIL=${fail}`)
process.exit(fail ? 1 : 0)
