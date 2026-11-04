#!/usr/bin/env node
/**
 * 「文案指向一颗你看不见的按钮」契约（v767）
 * ============================================================================
 * 报障形态：老板让只读角色（销售 / 只看数据）打开客户档案，页面说
 *   「还没有客户档案 —— 点右上角「+ 新增客户」」
 * 但右上角**什么都没有** —— 那颗按钮带 `v-if="canDo('data','create')"`。
 * 用户的结论不是「我没权限」，而是「系统坏了 / 数据丢了」。
 *
 * 为什么它比 v766 那批「死文案」更隐蔽：
 *   v766 的死文案是「指路指向另一个页面」，用户点不动、但至少看得见目标在哪；
 *   这一批是「指路指向本页一颗**被权限藏起来**的按钮」，同一句文案在管理员那里
 *   完全正确、在只读角色那里完全错误 —— 只有**换角色登录**才看得见，单角色自测永远绿。
 *
 * 判据（只认这一条，不另算权限）：
 *   同文件存在  <button ... v-if="...canDo(...)" ...>静态文本</button>
 *   正文出现    点(右上角|上方|顶部|页头)?「<同样那段静态文本>」
 *   且该文案**不在权限分支里**（见 isProtected）
 *   ⇒ 报红。
 *
 * 🔴 「在不在权限分支里」不能靠「附近 ±N 行有没有 canDo(」—— 第一版就是那样写的，
 *    结果按钮和文案隔三行时被判成"已保护"，坏样本当场漏掉。判据改成两条硬证据：
 *      a) 文案**本行**含权限调用（`<template v-if="canDo(...)">文案</template>` 这种单行写法）；
 *      b) 往上数未闭合的 `<template>` 开标签，其中任一个的属性含权限调用
 *         （`<template v-if="canDo(...)">` 换行再写文案的写法）。
 *    两者都没有 ⇒ 文案裸露在无权限分支的平铺版面里 ⇒ 红。
 *
 * 三条设计取舍（都是踩过的坑）：
 *   ① 只认**纯静态文本**按钮。`{{ a ? 'A' : 'B' }}` 这种动态文案无法可靠反查，
 *      硬匹配会大量误报，误报多了这条护栏就会被无视（比没有更糟）。这类靠「已修锚点」钉。
 *   ② 文案文本必须与按钮文本**完全相等**（去掉 +/＋ 与空白后）。
 *      放宽成「前缀匹配」会把「导入」和「导入回填」凑成一对，造出假阳性。
 *   ③ 只看 `<template>` 区。`toast()` 里的同款文字不算 —— 那时用户刚点完按钮，
 *      按钮必然在屏幕上，此时提示「点某按钮」是成立的。
 *
 * 用法：node tests/btn-hint-perm.contract.mjs
 * 退出码：全过 0，否则 1。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'src')

/* 冻结基线（v767 收口后的实测值）。**只许往下调**。
   超了 = 又有人写了「点一颗被权限藏起来的按钮」；低了说明又修了几处，请同步改小，
   别让它变成永远绿的摆设。 */
const DEAD_BASELINE = 0

/* 已修锚点：本版改过的每一处都必须**仍然在位**。
   防的是「下次重构把权限分支删掉、文案留着」—— 那种回退不会报错，只会在客户现场复发。 */
const ANCHORS = [
  ['src/pages/SupplierArchive.vue', "noNewPermHint('+ 新增供应商')"],
  ['src/pages/CustomerArchive.vue', "noNewPermHint('+ 新增客户')"],
  ['src/pages/PriceChannels.vue', "noNewPermHint('新建渠道')"],
  ['src/pages/EmployeeArchive.vue', "noNewPermHint('＋ 新建外部客户')"],
  ['src/pages/EmployeeArchive.vue', 'function acctTitle'],
  ['src/pages/LossAccounting.vue', 'function canAddSubject'],
  ['src/pages/LossAccounting.vue', 'canAddSubject(g.row_kind)'],
  ['src/pages/Rebate.vue', "noNewPermHint('新增版本')"],
  ['src/pages/ReportMapping.vue', "canDo('data', 'delete')"],
  ['src/pages/ReportMapping.vue', "noNewPermHint('新建配置')"],
]

const failures = []
const notes = []
const ok = (m) => notes.push('✅ ' + m)
const bad = (m) => failures.push(m)

/** 把 `<!-- … -->` 换成等长空白（保留换行），行号才不漂。 */
function stripHtmlComments(s) {
  return s.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
}

/** 去掉装饰符号与空白，用于比较。 */
function norm(s) {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/^\s*[+＋]\s*/, '')
    .replace(/\s+/g, '')
    .trim()
}

const BTN_RE = /<button\b([^>]*)>([\s\S]*?)<\/button>/g
const HINT_RE = /点\s*(?:右上角|右上方|上方|顶部|页头)?\s*「([^」]{2,20})」/g

/* 认哪些调用算「这是一条权限分支」。
   🔴 新增一处判定函数时必须登记在这里 —— 不登记不会报错，只会让那条分支不被认，
      护栏对该处退化成一个摆设（比没有更危险，因为「全绿」会被当真）。 */
const PERM_CALLS = ['canDo(', 'canAddSubject(', 'noNewPermHint(']

/** 文案是否站在权限分支里（两条硬证据，见文件头 a/b）。 */
function isProtected(lines, i) {
  const ln = lines[i]
  if (PERM_CALLS.some((c) => ln.includes(c))) return true
  // b) 往上数未闭合的 <template> —— 注意**本行不参与**：本行的单行写法已由 a 覆盖，
  //    若把本行的 </template> 也算进去，会把刚压进去的开标签弹掉。
  const stack = []
  for (let k = 0; k < i; k++) {
    const re = /<(\/?)template\b([^>]*)>/g
    let m
    while ((m = re.exec(lines[k]))) {
      if (m[1]) stack.pop()
      else if (!m[2].trim().endsWith('/')) stack.push(m[2])
    }
  }
  return stack.some((attrs) => PERM_CALLS.some((c) => attrs.includes(c)))
}

/** 该文件里「带权限闸门、且文案是静态文本」的按钮名集合。 */
function gatedButtonTexts(tpl) {
  const out = new Set()
  let m
  BTN_RE.lastIndex = 0
  while ((m = BTN_RE.exec(tpl))) {
    const attrs = m[1]
    const inner = m[2]
    if (!/canDo\(/.test(attrs) || !/v-if/.test(attrs)) continue
    if (/\{\{/.test(inner)) continue // ③ 动态文案不参与
    const n = norm(inner)
    if (n) out.add(n)
  }
  return out
}

/** 返回 [{file,line,label,text}]。files 允许传临时样本。 */
function findUnprotected(files) {
  const hits = []
  for (const p of files) {
    const raw = fs.readFileSync(p, 'utf8')
    const cut = raw.indexOf('<script')
    const tpl = stripHtmlComments(cut > 0 ? raw.slice(0, cut) : raw)
    const gated = gatedButtonTexts(tpl)
    if (!gated.size) continue
    const lines = tpl.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i]
      HINT_RE.lastIndex = 0
      let m
      while ((m = HINT_RE.exec(ln))) {
        const label = norm(m[1])
        // ② 只认完全相等 —— 前缀匹配会造出「导入 / 导入回填」这种假对
        if (!gated.has(label)) continue
        if (isProtected(lines, i)) continue
        hits.push({ file: path.relative(ROOT, p), line: i + 1, label, text: ln.trim().slice(0, 96) })
      }
    }
  }
  return hits
}

function walk(dir) {
  const out = []
  for (const dp of fs.existsSync(dir) ? [dir] : []) {
    const stack = [dp]
    while (stack.length) {
      const cur = stack.pop()
      for (const e of fs.readdirSync(cur, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue
        const full = path.join(cur, e.name)
        if (e.isDirectory()) stack.push(full)
        else if (e.name.endsWith('.vue')) out.push(full)
      }
    }
  }
  return out
}

/* ── 断言 1：未保护数三态 ─────────────────────────────────────── */
const vueFiles = walk(SRC)
const hits = findUnprotected(vueFiles)

if (hits.length > DEAD_BASELINE) {
  for (const h of hits) bad(`未保护：${h.file}:${h.line} 文案「${h.label}」→ ${h.text}`)
  bad(`未保护数 ${hits.length} > 基线 ${DEAD_BASELINE}：文案指向的按钮带 canDo 闸门，只读角色看不到它`)
} else if (hits.length < DEAD_BASELINE) {
  bad(`未保护数 ${hits.length} < 基线 ${DEAD_BASELINE}：又修掉了几处，请把 DEAD_BASELINE 改成 ${hits.length}`)
} else {
  ok(`未保护 ${hits.length} 处（基线 ${DEAD_BASELINE}），扫了 ${vueFiles.length} 个 .vue`)
}

/* ── 断言 2：已修锚点仍在位 ───────────────────────────────────── */
{
  const missing = []
  for (const [rel, needle] of ANCHORS) {
    const p = path.join(ROOT, rel)
    if (!fs.existsSync(p) || !fs.readFileSync(p, 'utf8').includes(needle)) missing.push(`${rel} → ${needle}`)
  }
  if (missing.length) for (const m of missing) bad(`锚点丢失：${m}`)
  else ok(`已修锚点 ${ANCHORS.length} 条全部在位`)
}

/* ── 断言 3：noNewPermHint 用了必须 import ───────────────────── */
{
  const users = vueFiles.filter((p) => fs.readFileSync(p, 'utf8').includes('noNewPermHint('))
  const miss = users.filter((p) => !/import\s*\{[^}]*noNewPermHint[^}]*\}\s*from\s*'[^']*utils\/permHint/.test(fs.readFileSync(p, 'utf8')))
  if (!users.length) bad('没有任何文件使用 noNewPermHint —— 5 处修复是否被回退了？')
  else if (miss.length) for (const p of miss) bad(`${path.relative(ROOT, p)} 用了 noNewPermHint 却没 import（模板会渲染空白，静默失败）`)
  else ok(`noNewPermHint 使用 ${users.length} 个文件，全部已 import`)
}

/* ── 断言 4：坏样本自证（证明这条判据真的会红，而且不会一律报红）─── */
{
  const tmpRoot = path.join(ROOT, '.tmp-btn-hint')
  const tmpFile = path.join(tmpRoot, 'Bad.vue')
  const write = (tpl) => {
    fs.mkdirSync(tmpRoot, { recursive: true })
    fs.writeFileSync(tmpFile, tpl + '\n<script setup>\n</script>\n', 'utf8')
    return findUnprotected([tmpFile]).length
  }
  try {
    // A：带闸门的按钮 + 无条件文案 ⇒ 必须检出 1
    const a = write(`<template>
  <div>
    <button v-if="canDo('data', 'create')" class="btn">+ 新增客户</button>
    <div class="state-empty">还没有客户档案 —— 点右上角「+ 新增客户」</div>
  </div>
</template>`)
    // B：同一句放进权限分支 ⇒ 必须 0（防"一律报红"的假检查）
    const b = write(`<template>
  <div>
    <button v-if="canDo('data', 'create')" class="btn">+ 新增客户</button>
    <div class="state-empty">
      <template v-if="canDo('data', 'create')">还没有客户档案 —— 点右上角「+ 新增客户」</template>
    </div>
  </div>
</template>`)
    // C：按钮没有闸门 ⇒ 文案永远成立，必须 0
    const c = write(`<template>
  <div>
    <button class="btn">+ 新增客户</button>
    <div class="state-empty">还没有客户档案 —— 点右上角「+ 新增客户」</div>
  </div>
</template>`)
    if (a !== 1) bad(`坏样本 A 未被检出（应 1 处，实际 ${a}）`)
    if (b !== 0) bad(`坏样本 B 误报（已在权限分支内，仍判 ${b} 处）`)
    if (c !== 0) bad(`坏样本 C 误报（按钮无闸门，文案成立，仍判 ${c} 处）`)
    if (a === 1 && b === 0 && c === 0) ok('坏样本自证：闸门+无条件文案必检出 / 有分支不误报 / 无闸门不误报')
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  }
}

console.log('')
for (const n of notes) console.log('  ' + n)
if (failures.length) {
  console.log('')
  for (const f of failures) console.log('  ❌ ' + f)
}
console.log('')
console.log(failures.length === 0 ? 'ALL PASS' : `FAILED (${failures.length})`)
process.exit(failures.length === 0 ? 0 : 1)
