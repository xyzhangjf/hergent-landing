/**
 * v387-asset-reconcile.mjs —— 「本地新构建」vs「生产生效集」对账（**只读**）
 *
 * 三条口径，逐条说明为什么必须这么判：
 *
 * ① 不用「目录差集」：生产 `assets/` 是**历次构建的并集**（3133 文件 / 145M），
 *    差集会把几百个早已不被引用的旧 chunk 报成"本地缺失"。
 *    只看**从线上入口 index.html 递归可达**的那一批。
 *
 * ② ③ 的判据必须是「**归一化基名**」而不是原名：
 *    Vite 的 chunk 名 = 内容 hash，而 `constants/pages.js`（`canSee`）被**几乎每个页面**
 *    import ⇒ 改它一行，所有引用它的 chunk **全部改名**。于是"生产的 31 个 chunk 本地
 *    一个都没有"是**正常级联**，把它报成"本地缺失 31"是彻头彻尾的误报（我上一版就这么错过）。
 *    正确的危险信号是：**生产有个 chunk，其基名在本地生效集里根本不存在**
 *    —— 那才是"本地没有这份代码"，上传会覆盖别人的东西 / 打断回退链。
 *
 * ③ 同名未必同内容：还要把两边内容里的 hash 引用**归一化**后逐字节比对，
 *    才能区分"只是改名"和"真的改了代码"。
 *
 * 用法：
 *   BASE=https://hergent.cn DIST=hergent-cn-v2/dist-v387-1-2 \
 *     node docs/prod-inspection/tools/v387-asset-reconcile.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const ROOT = process.cwd()
const DIST = path.resolve(ROOT, process.env.DIST || 'hergent-cn-v2/dist-v387-1-2')
const BASE = process.env.BASE || 'https://hergent.cn'

const md5 = (buf) => crypto.createHash('md5').update(buf).digest('hex')
/**
 * 🔴🔴 BFS 的引用正则 —— **这里犯过一次真事故，务必看懂再改**：
 *   最初写成 `/assets\/([A-Za-z0-9_.-]+\.(?:js|css))/` —— 只认带 `assets/` 前缀的引用。
 *   但 **Vite 的动态 import 生成的是相对路径**：`import("./ArchiveShell-AZv_MDOP.js")`
 *   ⇒ 整批**懒加载组件漏出 BFS**。后果：本地说"生效集 57 个"，真实是 58；
 *   上传清单漏掉 `ArchiveShell-AZv_MDOP.js` ⇒ 生产 `/archive/*` 打不开
 *   （`Failed to fetch dynamically imported module`），而**所有静态核查都是绿的**。
 *   是**生产真机探针**把它抓出来的 —— 静态对账再漂亮也不能替代真机。
 *
 *   现在的正则同时吃：`"./X-YYYYYYYY.js"` / `"assets/X-YYYYYYYY.js"` /
 *   `"/assets/X-YYYYYYYY.js"` / `("X-YYYYYYYY.js")` 四种形态。
 */
const REF = /[("']\/?(?:\.\.?\/)?(?:assets\/)?([A-Za-z][A-Za-z0-9_-]*-[A-Za-z0-9_-]{8}\.(?:js|css))/g
const ANY_REF = /([A-Za-z][A-Za-z0-9_-]*-[A-Za-z0-9_-]{8}\.(?:js|css))/g
const isChunk = (n) => /^[A-Za-z][A-Za-z0-9_]*-[A-Za-z0-9_-]{8}\.(js|css)$/.test(n)

/** 归一化基名：去掉最后一段 8 字符 hash（Vite hash 允许含 `-`） */
function baseName(n) {
  const m = n.match(/^(.*)-[A-Za-z0-9_-]{8}\.(js|css)$/)
  return m ? m[1] + '.' + m[2] : n
}
/** 内容归一化：抹平两类别名级联，只留"代码内容"
 *  ① chunk 之间互相引用的 `assets/xxx-HASH.js`
 *  ② **Vue scoped 的 `data-v-xxxxxxxx`（scopeId）** —— 改一行（哪怕只改注释）就会让
 *     `<style scoped>` 的 scopeId 变，进而整个 `.css` 与 `.js` 内容都变。
 *     不抹平它，就会把纯改名级联误判成"代码改了"（Δ 字节为 0 却被报成差异）。 */
function normContent(buf) {
  return buf.toString('utf8')
    .replace(/assets\/([A-Za-z0-9_.-]+?)-[A-Za-z0-9_-]{8}\.(js|css)/g, 'assets/$1-H.$2')
    /* 🔴 Vite 的动态 import 是**相对路径**：`import("./Login-BukLLi54.js")` —— 没有
       `assets/` 前缀，上面那条**抓不到**。不补这条兜底，改名级联就会被误判成"改了代码"。
       （同一条正则用在两侧，误伤也一致，不影响对比结论。） */
    .replace(/-[A-Za-z0-9_-]{8}\.(js|css)/g, '-H.$1')
    .replace(/data-v-[0-9a-f]{8}/g, 'data-v-H')
}

async function fetchBuf(url) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) return { ok: false, status: res.status, buf: null }
  return { ok: true, status: res.status, buf: Buffer.from(await res.arrayBuffer()) }
}

/* ---------- 生产生效集 ---------- */
async function prodSet() {
  const seen = new Map()
  const idx = await fetchBuf(BASE + '/index.html')
  if (!idx.ok) throw new Error('拉不到生产 index.html：' + idx.status)
  const queue = []
  for (const m of idx.buf.toString('utf8').matchAll(REF)) queue.push(m[1])
  while (queue.length) {
    const f = queue.shift()
    if (seen.has(f)) continue
    const r = await fetchBuf(BASE + '/assets/' + f)
    if (!r.ok) { seen.set(f, { missing: true, status: r.status }); continue }
    seen.set(f, { buf: r.buf, md5: md5(r.buf), base: baseName(f) })
    for (const m of r.buf.toString('utf8').matchAll(REF)) {
      if (!seen.has(m[1]) && isChunk(m[1])) queue.push(m[1])
    }
  }
  return { map: seen, htmlBuf: idx.buf }
}

/* ---------- 本地生效集 ---------- */
function localSet() {
  const seen = new Map()
  const queue = []
  const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8')
  for (const m of html.matchAll(REF)) queue.push(m[1])
  while (queue.length) {
    const f = queue.shift()
    if (seen.has(f)) continue
    const p = path.join(DIST, 'assets', f)
    if (!fs.existsSync(p)) { seen.set(f, { missing: true }); continue }
    const buf = fs.readFileSync(p)
    seen.set(f, { buf, md5: md5(buf), base: baseName(f) })
    for (const m of buf.toString('utf8').matchAll(REF)) {
      if (!seen.has(m[1]) && isChunk(m[1])) queue.push(m[1])
    }
  }
  return seen
}

const P = await prodSet()
const L = localSet()
console.log('[reconcile] 生产生效集 ' + P.map.size + ' 个 ｜ 本地生效集 ' + L.size + ' 个')
console.log('[reconcile] 生产入口 md5=' + md5(P.htmlBuf) + '  本地入口 md5=' + md5(fs.readFileSync(path.join(DIST, 'index.html'))))

/* 本地基名索引 */
const localByBase = new Map()
for (const [name, v] of L) if (!v.missing) localByBase.set(v.base, { name, v })

const same = [], rehashOnly = [], diffCode = [], trulyMissing = []
for (const [name, pv] of P.map) {
  if (pv.missing) { console.log('  ⚠️ 生产入口引用取不到：' + name + ' → ' + pv.status); continue }
  const hit = localByBase.get(pv.base)
  if (!hit) { trulyMissing.push(name); continue }
  if (hit.name === name && hit.v.md5 === pv.md5) { same.push(name); continue }
  if (normContent(hit.v.buf) === normContent(pv.buf)) rehashOnly.push({ name, local: hit.name })
  else diffCode.push({ name, local: hit.name, pMd5: pv.md5, lMd5: hit.v.md5, dBytes: hit.v.buf.length - pv.buf.length })
}

console.log('\n===== 对账结果（基准 = 生产生效集）=====')
console.log('① 逐字节相同（同名字）：' + same.length)
console.log('② 只是**改了名**、归一化后内容一致：' + rehashOnly.length)
console.log('③ 归一化后**内容仍不同**（= 本轮真改动的代码）：' + diffCode.length)
console.log('④ ★ 基名在本地生效集里**找不到** ⇒ 必须是 0：' + trulyMissing.length)
if (trulyMissing.length) console.log('   🔴 ' + JSON.stringify(trulyMissing, null, 1))
if (diffCode.length) {
  console.log('\n-- ③ 真改动清单（Δ字节 = 本地 − 生产）--')
  for (const d of diffCode) console.log('  ' + d.name + '  →  本地 ' + d.local + '  Δ=' + (d.dBytes >= 0 ? '+' : '') + d.dBytes + 'B')
}

/* ⑤ 上传清单：本地新构建里，生产"没有这个文件名"或"同名但内容不同"的 */
const upload = []
for (const [name, v] of L) {
  if (v.missing) continue
  const pv = P.map.get(name)
  if (!pv || pv.missing || pv.md5 !== v.md5) upload.push(name)
}
console.log('\n⑤ 需上传：' + upload.length + ' 个（+ index.html ' + (md5(fs.readFileSync(path.join(DIST, 'index.html'))) === md5(P.htmlBuf) ? '否' : '是') + '）')
console.log('[UPLOAD_ASSETS] ' + JSON.stringify(upload.sort()))

/* ⑥ 自证（防的正是上面那条真事故）：BFS 覆盖不到的 chunk 必须能逐个解释，
 *    否则说明引用正则又漏了某种形态 ⇒ 上传清单会**再次缺文件**、而静态核查全绿。 */
const dirAll = fs.readdirSync(path.join(DIST, 'assets')).filter((n) => isChunk(n))
const bfsSet = new Set([...L.keys()])
const notSeen = dirAll.filter((n) => !bfsSet.has(n))
console.log('\n⑥ BFS 自证：dist 目录含 chunk **' + dirAll.length + '** 个；BFS 覆盖 **' +
  (dirAll.length - notSeen.length) + '** 个；未覆盖 **' + notSeen.length + '**' +
  (notSeen.length ? '  🔴 ' + JSON.stringify(notSeen) : '  ✅'))

/* ⑦ 兜底上传清单：**目录全集**（而不是 BFS 集）里，生产缺的。宁可多传（幂等），
 *    也不要因为 BFS 漏一环而在生产上留 404。 */
const dirMissing = dirAll.filter((n) => {
  const p = P.map.get(n)
  return !p || p.missing
})
console.log('⑦ 兜底清单（按**目录全集**算，生产缺的）：' + dirMissing.length + ' 个' +
  (dirMissing.length ? '  ' + JSON.stringify(dirMissing.sort()) : '  ✅'))

process.exit(trulyMissing.length ? 2 : 0)
