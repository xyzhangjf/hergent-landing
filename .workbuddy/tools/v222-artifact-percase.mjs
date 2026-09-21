/**
 * v222-artifact-percase.mjs —— **部署产物 + 生产真实数据** 的换算口径终局验证
 *
 * 为什么不满足于「源码跑过」：
 *   前几轮我用 `v222-percase-plan.mjs` 从 **.vue 源码**切出 `perCase` 跑过一遍；但那只证明
 *   「源码对了」。**源码对 ≠ 线上产物对** —— 中间还隔着 vite 打包（tree-shake / 变量改名 /
 *   条件编译）。本脚本把最后一环补上：
 *     ① 从**线上**抓 `Forecast-*.js`，断言 md5 == 本地 dist（证明线上跑的就是这份）
 *     ② 从**线上产物**里按花括号配平切出真实的 `perCase`（编译后名 `$a`）
 *     ③ 用**真实登录 + 真实 `/api/products/grid`** 拿 285 个生产商品
 *     ④ 同一函数跑两遍：`arc=商品`（v222 新）vs `arc=undefined`（v222 前，纯规格解析）
 *     ⑤ 逐条列出「谁变了、从多少变到多少」
 *
 * 🔴 只读：不写任何生产数据。
 * 用法：node .workbuddy/tools/v222-artifact-percase.mjs
 */
const BASE = process.env.HG_BASE || 'https://hergent.cn'
const API = process.env.HG_API || 'https://erp.hergent.cn'
const USER = process.env.HG_USER || 'mptestsp'
const PASS = process.env.HG_PASS || 'Mpsup@1'
const CHUNK = process.env.HG_CHUNK || BASE + '/assets/Forecast-B293RISQ.js'
const LOCAL_DIST = '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/dist/assets/Forecast-B293RISQ.js'
const fs = await import('node:fs')
const crypto = await import('node:crypto')

const log = (s) => console.log(s)
const md5 = (buf) => crypto.createHash('md5').update(buf).digest('hex')

/* ---------- 从 JS 文本里按花括号配平切出一个函数 ---------- */
function extractFn(src, anchor) {
  const i = src.indexOf(anchor)
  if (i < 0) throw new Error('锚点未找到：' + anchor)
  // 从锚点往回找最近的 `function `
  const j = src.lastIndexOf('function ', i)
  if (j < 0) throw new Error('未找到 function 关键字')
  // 找参数列表后的第一个 `{`
  let k = src.indexOf('{', j)
  let depth = 0, end = -1
  let inStr = null
  for (let p = k; p < src.length; p++) {
    const c = src[p]
    if (inStr) {
      if (c === '\\') { p++; continue }
      if (c === inStr) inStr = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue }
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) { end = p; break } }
  }
  if (end < 0) throw new Error('花括号未配平')
  return { src: src.slice(j, end + 1), name: src.slice(j + 9, src.indexOf('(', j)).trim() }
}

/* ---------- 1. 抓线上产物 + 与本地产物对账 ---------- */
log('=== v222 部署产物 × 生产真实数据 ===')
const r = await fetch(CHUNK)
if (!r.ok) throw new Error('抓取线上 chunk 失败：HTTP ' + r.status)
const onlineBuf = Buffer.from(await r.arrayBuffer())
const localBuf = fs.readFileSync(LOCAL_DIST)
const mOnline = md5(onlineBuf), mLocal = md5(localBuf)
log('线上 ' + CHUNK)
log('  线上 md5 = ' + mOnline + '（' + onlineBuf.length + ' B）')
log('  本地 md5 = ' + mLocal + '（' + localBuf.length + ' B）')
const sameArtifact = mOnline === mLocal
log('  ' + (sameArtifact ? '✅ 一致 —— 下面跑的就是线上正在执行的那份代码' : '🔴 不一致 —— 线上不是本地构建的那份！'))

const online = onlineBuf.toString('utf8')

/* ---------- 2. 从线上产物切出真实 perCase ---------- */
const fn = extractFn(online, 'Number(n.large_ratio)||0;if(')
log('')
log('切出函数名（编译后）= ' + fn.name)
log('函数源码：')
log('  ' + fn.src.replace(/\s+/g, ' ').slice(0, 700))

const perCase = new Function('return (' + fn.src + ')')()
log('函数已实例化：perCase(' + perCase.length + ' 个形参)')

/* ---------- 3. 真实登录 + 拉生产商品主档 ---------- */
log('')
log('--- 生产数据 ---')
const lr = await fetch(API + '/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: USER, password: PASS }),
})
const ld = await lr.json()
if (!ld.token) throw new Error('登录失败：' + JSON.stringify(ld).slice(0, 200))
log('登录成功（租户 ' + ld.tenant_id + '）')

const gr = await fetch(API + '/api/products/grid?limit=2000', {
  headers: { Authorization: 'Bearer ' + ld.token, 'X-Tenant-Id': String(ld.tenant_id || 1) },
})
const gd = await gr.json()
const rows = gd.items || gd.data || gd.rows || (Array.isArray(gd) ? gd : [])
log('商品行数 = ' + rows.length + '（有 large_ratio 的 = ' + rows.filter(p => (Number(p.large_ratio) || 0) > 0).length + '）')

/* ---------- 4. 同一函数跑两遍 ---------- */
const out = []
for (const p of rows) {
  const spec = p.spec, unit = p.unit
  const now = perCase(spec, unit, p)     // v222：档案优先
  const old = perCase(spec, unit, undefined) // v222 前：纯规格解析
  if (now !== old) out.push({ id: p.id, name: (p.name || '').slice(0, 28), spec, unit, old, now, lu: p.large_unit, lr: p.large_ratio })
}

log('')
log('--- 口径变化清单（同一线上函数，arc=商品 vs arc=undefined）---')
log('变化条数 = ' + out.length + ' / ' + rows.length + '（' + (out.length / rows.length * 100).toFixed(1) + '%）')
const fixZero = out.filter(x => x.old === 0 && x.now > 0)
log('其中「旧口径算不出(0) → 现在能算」= ' + fixZero.length + ' 条（纯修复）')
log('')
log('  id     | 规格             | 单位 | 旧 → 新 | 主档换算')
for (const x of out.sort((a, b) => b.id - a.id)) {
  log('  ' + String(x.id).padEnd(6) + ' | ' + String(x.spec).padEnd(16) + ' | ' + String(x.unit).padEnd(4) + ' | '
    + String(x.old).padStart(6) + ' → ' + String(x.now).padStart(6) + ' | ' + x.lu + ' = ' + x.lr)
}

/* ---------- 5. 定点断言 ---------- */
log('')
log('--- 定点断言 ---')
const byId = Object.fromEntries(rows.map(p => [p.id, p]))
function assertOne(id, expect) {
  const p = byId[id]
  if (!p) { log('  FAIL id=' + id + ' 不存在'); return false }
  const got = perCase(p.spec, p.unit, p)
  const ok = got === expect
  log('  ' + (ok ? 'PASS' : 'FAIL') + ' id=' + id + '（' + String(p.spec) + ' / ' + p.unit + ' / ' + p.large_unit + '=' + p.large_ratio
    + '）perCase = ' + got + '（期望 ' + expect + '）')
  return ok
}
let allOk = true
allOk = assertOne(1164, 12) && allOk      // 340G 被当 340 瓶 → 应为 12
allOk = assertOne(1539, 8) && allOk       // 无换算 → 回退规格解析（"8" 纯数字）
if (byId[1478]) allOk = assertOne(1478, 6) && allOk // 待用户复核那条：16 → 6

log('')
log(sameArtifact && allOk ? '结论：✅ 线上产物 + 生产数据 全通过' : '结论：❌ 未通过')
process.exit(sameArtifact && allOk ? 0 : 1)
