/* 检查 **<script setup> 里调用的标识符** 是否在本文件定义过。
 *
 * 为什么还需要这一份（`sfc-symbols.contract.mjs` 只扫模板）：
 *   v629 真机抓到一个**模板扫描永远抓不到**的缺陷 —— `Forecast.vue::openAlloc`
 *   里写 `const periodId = _allocPid()`，而 `_allocPid` **定义在子组件
 *   AllocPanel.vue**。它不在模板里，只在脚本里 ⇒ 上一份检查器整片看不见；
 *   构建不报错、只有**真机点那一下**才抛 `ReferenceError`，还被 ErrorBoundary 吞掉
 *   ⇒ 「点了没反应、零报错」。上一版 `openAlloc(allocRowRef(r))` 是同一类。
 *
 * 判据（刻意收窄到**高信号**，避免噪声淹没真缺陷）：
 *   只报「本文件**没定义**、却**在别的 .vue 里是顶层绑定**」的调用 ——
 *   跨文件同名 + 没在本文件声明 + 又是调用形态，几乎只能是「引用了别人的私有函数」。
 *   本地 `const/let/function` 声明（含函数体内）一律先排除，形参名也可能误报，
 *   故再叠一层常见名白名单。
 *
 * 用法：node tests/cross-sfc-symbol.contract.mjs
 */
import fs from 'fs'
import path from 'path'
import { parse, compileScript } from '@vue/compiler-sfc'

const ROOT = process.argv[2] || path.resolve(process.cwd(), 'src')

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.vue')) out.push(p)
  }
  return out
}

const files = walk(ROOT)

/* ④ 用：`src/api/modules.js` 里每个 `xxxApi.method` 的**定义文本** ——
   判断这次调用拿到的到底是「信封」还是「已解包的 data」。
   `api()` 末尾 `return data.data !== undefined ? data.data : data` 已解一层，
   唯独传了 `{ raw: true }` 的方法仍返回 `{success, data}` 完整信封。
   只看调用点是看不出来的（`zhoupuApi.status(id)` 里没有 raw 字样）
   ⇒ 必须回到定义处查。 */
const MODULES_JS = path.join(ROOT, 'api', 'modules.js')
const apiMethodsRaw = new Set()   // 'sourceStatus' / 'status' … 这些方法的返回值**是信封**
if (fs.existsSync(MODULES_JS)) {
  const mjs = fs.readFileSync(MODULES_JS, 'utf8')
  // 以 `方法名:` 开头，取到下一处「行首两空格 + 标识符:」或文件尾为止
  const marks = [...mjs.matchAll(/^ {2}([A-Za-z_$][\w$]*)\s*:/gm)]
  marks.forEach((m, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].index : mjs.length
    if (/raw\s*:\s*true/.test(mjs.slice(m.index, end))) apiMethodsRaw.add(m[1])
  })
}

const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')     // 块注释（说明文字里的 `xxx(` 不算调用）
  .replace(/^\s*\/\/.*$/gm, '')         // 行注释
  .replace(/'[^'\\\n]*'|"[^"\\\n]*"|`[^`\\]*`/g, "''")  // 字符串字面量

/* ① 每个 .vue 的顶层绑定 */
const bindingsOf = new Map()
for (const f of files) {
  let b = []
  try {
    const src = fs.readFileSync(f, 'utf8')
    const { descriptor } = parse(src, { filename: f })
    if (!descriptor.script && !descriptor.scriptSetup) continue
    b = Object.keys((compileScript(descriptor, { id: 'x' }).bindings) || {})
  } catch { /* 编不过的文件跳过（不是本检查的对象） */ }
  bindingsOf.set(f, new Set(b))
}

/* ② `src/**\/*.js` 里 export 出来的名字 —— SFC 里调用了它却**没 import**，
   同样是「本文件没有这个标识符」，而且比跨组件那种更容易发生（抽函数/搬代码漏带）。
   v629 第二个真缺陷就是它：`AllocPanel.vue::_allocNum()` 调 `parseNumInput()`
   而本文件只 import 了 `fmt` ⇒ 弹窗一渲染数字就 ReferenceError。 */
const jsExports = new Map()   // name → 定义它的 js 文件
function walkJs(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walkJs(p, out)
    else if (e.name.endsWith('.js')) out.push(p)
  }
  return out
}
for (const f of walkJs(ROOT)) {
  const s = fs.readFileSync(f, 'utf8')
  const names = new Set()
  for (const m of s.matchAll(/export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1])
  for (const m of s.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const n of m[1].matchAll(/(?:^|,)\s*([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?/g)) {
      names.add(n[2] || n[1])
    }
  }
  for (const n of names) {
    if (!jsExports.has(n)) jsExports.set(n, [])
    jsExports.get(n).push(path.relative(ROOT, f))
  }
}

/* 全局 / 内置 / Vue 与本项目常见的通用名 —— 白名单（不构成"跨组件引用"的证据） */
const GLOBAL = new Set([
  'ref', 'computed', 'watch', 'watchEffect', 'onMounted', 'onUnmounted', 'onBeforeUnmount',
  'nextTick', 'reactive', 'toRef', 'toRefs', 'shallowRef', 'defineAsyncComponent', 'inject',
  'provide', 'useRouter', 'useRoute', 'useStore', 'setTimeout', 'clearTimeout', 'setInterval',
  'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'queueMicrotask', 'Promise',
  'fetch', 'alert', 'confirm', 'Number', 'String', 'Boolean', 'Array', 'Object', 'Math', 'Date',
  'JSON', 'Set', 'Map', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent',
  'decodeURIComponent', 'console', 'document', 'window', 'navigator', 'localStorage',
  'sessionStorage', 'Blob', 'FileReader', 'URL', 'FormData', 'Error', 'RegExp', 'Symbol',
  'structuredClone', 'AbortController', 'Intl', 'btoa', 'atob', 'Image', 'Event', 'CustomEvent',
  'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'new', 'function', 'await',
  // `new Promise((resolve, reject) => …)` 的**形参** —— 名字固定、且不在声明扫描里
  // （v629 实测：8 条疑似里 6 条是它 ⇒ 不白名单会把噪声堆到盖住真缺陷）
  'resolve', 'reject',
  'each', 'map', 'filter', 'reduce', 'find', 'some', 'every', 'sort', 'forEach', 'push',
  'includes', 'indexOf', 'join', 'split', 'slice', 'trim', 'replace', 'match', 'test', 'then',
  'catch', 'finally', 'toString', 'valueOf', 'keys', 'values', 'entries', 'from', 'of',
  'emit', 'props', 'toast', 'fmt', 'api', 't', 'h', 'next', 'done', 'cb', 'fn', 'f', 'g',
])

let bad = 0
for (const f of files) {
  let src
  try { src = fs.readFileSync(f, 'utf8') } catch { continue }
  const { descriptor } = parse(src, { filename: f })
  if (!descriptor.scriptSetup) continue
  const body = strip(descriptor.scriptSetup.content)

  /* 本文件里**任何位置**声明过的名字（含函数体内的 const/let/function）先排除 */
  const declared = bindingsOf.get(f) || new Set()
  for (const m of body.matchAll(/\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) {
    declared.add(m[1])
  }
  for (const m of body.matchAll(/\bimport\s+([\s\S]*?)\s+from\b/g)) {
    for (const n of m[1].matchAll(/([A-Za-z_$][\w$]*)/g)) declared.add(n[1])
  }
  // 解构声明 `const { a, b } =` / `const [x] =`
  for (const m of body.matchAll(/\b(?:const|let|var)\s*[{[]([^}\]]*)[}\]]/g)) {
    for (const n of m[1].matchAll(/([A-Za-z_$][\w$]*)/g)) declared.add(n[1])
  }
  // 对象/类的**方法简写** `set(v) { … }` / `foo(a, b) {` —— 它是**定义**不是调用
  // （v629 实测 ReportingMapping.vue 的 `set(v) {` 被当成一次 `set()` 调用 ⇒ 假红）
  for (const m of body.matchAll(/(?<![\w.$])([A-Za-z_$][\w$]*)\s*\([^()]*\)\s*\{/g)) {
    declared.add(m[1])
  }

  const called = new Set()
  // 零宽前导：不吃掉前导字符 ⇒ 嵌套调用 `openAlloc(allocRowRef(r))` 两个都能命中
  for (const m of body.matchAll(/(?<![\w.$'"])([A-Za-z_$][\w$]*)\s*\(/g)) called.add(m[1])

  /* ③ `props.<已声明的 prop>.value` —— **prop 在子组件里已被 Vue 解包**，
     再 `.value` 恒为 undefined ⇒ 各种"静默 return / 恒空"，零报错。
     v629 第四例：AllocPanel 里 `props.cross.value` / `props.row.value` / `props.open.value`
     ⇒ 分摊弹窗永远卡在「正在读取分摊依据…」。
     ⚠️ 只对 **defineProps 里声明过的**名字判：没声明的走 $attrs，另当别论。 */
  const propBlock = (body.match(/defineProps\s*\(\s*\{([\s\S]*?)\n\s*\}/) || [])[1] || ''
  const propNames = [...propBlock.matchAll(/(?<![\w.$'"])([A-Za-z_$][\w$]*)\s*:/g)].map((m) => m[1])
  for (const p of propNames) {
    const re = new RegExp('props\\.' + p + '\\.value\\b', 'g')
    const hits = body.match(re)
    if (!hits) continue
    console.log(`XX ${path.relative(ROOT, f)} 里 \`props.${p}.value\` —— `
      + `${p} 是已声明的 prop，到手时**已被解包**（模板里传 ref 会脱壳）`
      + ` ⇒ 恒 undefined，应直接写 \`props.${p}\`（${hits.length} 处）`)
    bad++
  }

  // 本文件 import 进来的名字（含 `import * as X`）
  const imported = new Set(declared)

  for (const name of called) {
    if (declared.has(name) || GLOBAL.has(name)) continue
    const rel = path.relative(ROOT, f)

    // ②‑A：有 js 模块 export 它，但本文件没 import ⇒ 漏带 import（v629 第二处真缺陷）
    const from = jsExports.get(name)
    if (from && from.length && !imported.has(name)) {
      console.log(`XX ${rel} 调用了 \`${name}()\` 但**没 import** —— 它 export 自：`
        + `${from.slice(0, 2).join(', ')}`)
      bad++
      continue
    }
    // ②‑B：只在**别的 .vue** 里是顶层绑定 ⇒ 引用了别的组件的私有函数
    const owners = []
    for (const [g, set] of bindingsOf) {
      if (g === f) continue
      if (set.has(name)) owners.push(path.relative(ROOT, g))
    }
    if (!owners.length) continue
    console.log(`XX ${rel} 调用了未定义的 \`${name}()\` `
      + `—— 它只在这些文件里定义：${owners.slice(0, 3).join(', ')}`)
    bad++
  }

  /* ④ **双重解包**：`api()`（src/api/client.js）末尾已经
     `return data.data !== undefined ? data.data : data` —— 返回值**就是** data 本体。
     再写 `(r && r.data)` 恒 undefined ⇒ 不报错、只是"永远空/永远回落默认值"。
     v629 一次抓出 3 处（AllocPanel×2、RebateSprint、AiOps），全是这种静默失效。
     ⚠️ 只判**没带 `raw: true`** 的调用 —— 带 raw 的拿到的是完整信封，取 `.data` 才是对的
        （如 zhoupuApi.sourceStatus / status）。 */
  for (const m of body.matchAll(
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+([^\n;]*)\s*$/gm,
  )) {
    const v = m[1]
    const callText = m[2]
    const bareApi = /(^|[^.\w$])api\s*\(/.test(callText)
    const viaModule = /\b[A-Za-z_$][\w$]*Api\.([A-Za-z_$][\w$]*)/.exec(callText)
    if (!bareApi && !viaModule) continue
    // 信封模式的三种情况 ⇒ 取 `.data` 合法，跳过
    if (/raw\s*:\s*true/.test(callText)) continue
    if (viaModule && apiMethodsRaw.has(viaModule[1])) continue
    // 在该变量后续 ~1200 字符内找 `.data` 访问（超出就不是同一处逻辑了）
    const from = m.index + m[0].length
    const near = body.slice(from, from + 1200)
    const re = new RegExp(`${v}\\.data\\b`)
    const hit = re.exec(near)
    if (!hit) continue

    /* 🔴 关键收窄：**带兜底的写法不致病**，别报成缺陷淹没真问题。
       大量现存代码是防御链，例如
         `Array.isArray(r) ? r : (r.items || r.data || [])`   ← 数组端点命中第一支，正常
         `d.data || d || []`                                   ← 最终回落到 d 本体，正常
         `d && d.data ? d.data : d`                            ← 三元 else 是 d，正常
       只有「`.data` 是**唯一**来源、失败即恒空」才真坏，例如
         `const data = (d && d.data) || null`  ⇒ 恒 null（v629 AllocPanel 真缺陷）
         `(d && d.data && d.data.items) || {}` ⇒ 恒 {}（PeriodOps 真缺陷）
       判据：同一条语句里**没有** `|| v` / `: v` / `Array.isArray(v)` 这三种兜底之一。 */
    const stmtEnd = body.indexOf('\n', from + hit.index)
    const stmt = body.slice(from + hit.index - 200, stmtEnd < 0 ? body.length : stmtEnd)
    const hasFallback = new RegExp(`\\|\\|\\s*${v}\\b`).test(stmt)
      || new RegExp(`Array\\.isArray\\(\\s*${v}\\s*\\)`).test(stmt)
      || new RegExp(`\\?:\\s*${v}\\b|:\\s*${v}\\s*(?:\\)|;|$|,)`).test(` ${stmt}`)
    if (hasFallback) continue
    console.log(`XX ${path.relative(ROOT, f)} 变量 \`${v}\` 来自 \`api()\`（**已解包一层**），`
      + `却又取 \`${v}.data\` ⇒ 恒 undefined（静默恒空，零报错）。直接写 \`${v}\` 即可`
      + `\n     调用：${callText.trim().slice(0, 130)}`)
    bad++
  }
}

if (bad) {
  console.error(`\nXX 发现 ${bad} 处跨组件引用（运行时必然 ReferenceError）`)
  process.exit(1)
}
console.log(`OK ${files.length} 个 SFC：<script setup> 无跨组件私有函数引用`)
