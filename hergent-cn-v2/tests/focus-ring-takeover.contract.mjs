/* v749 + v750 契约：焦点环在同一处位置只能出现**一层**。
 *
 * 两次报障是同一类病的两层：
 *   v749 「点『供应商』输入框时会出现一个品牌色的定位框，全站其他多处输入控件也有相同现象」
 *        ⇒ 组框已经画了环，框内控件又画一层（一大一小）
 *   v750 「报单配置 → 新建报单配置 里也有类似的情况」
 *        ⇒ 控件自己画环，且环与边框隔着 2px 空隙（边框 + 一圈游离框）
 *
 * v749 根因：v439/v448 把焦点高亮上移到组框（`.hd-box .ipn-f:focus-within` 改 border + 3px 光晕），
 *   注释里写着"框内控件的 focus 环要关掉"，但只写了 `border-color:transparent;box-shadow:none`
 *   —— **没写 outline**。全局焦点环恰好用的是 `outline:2px`，不看 border/box-shadow，
 *   于是圆角框里又套一个尖角框。
 *
 * v750 根因：全局那条环是按「鼠标点按钮不该出圈、Tab 才出圈」写的，
 *   但 **`:focus-visible` 对文本类控件在鼠标点击时同样成立**（浏览器按"能接受键盘输入"
 *   判定），所以每条 input/select/textarea 一被点就是「边框变色 + 隔 2px 一圈游离框」。
 *   修法只能是**环内缩**（-1px），不能删环（键盘指示归零）、也不能换 box-shadow（盖掉错误态）。
 *
 * 🔴 这套判据要挡的是三件事，缺一条就有一类回归能溜过去：
 *   ① **接管规则存在**，且只压 `input/select/textarea`（组框里的按钮压掉就是零指示）
 *   ② **它真的压得住全局那条**（特异性 4 > 2）—— 特异性写反了，规则在浏览器里是死的，
 *      但源码层面"看起来加了"
 *   ③ **双向登记**：每个用 `:focus-within` 画环的容器必须在 `:is()` 名单里；
 *      名单里的每一项也必须还在画环（否则是过期条目，会误导人以为已经管了）
 *
 * 另外单独盯一条**反向回归**：不能为了消双环去删全局焦点环 —— 那会让全站键盘用户
 * 零指示。④ 就是查这个。
 *
 * 全部判据是纯函数（输入源码字符串），下面用坏样本逐条自证会红。
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const VARS = path.join(ROOT, 'src/styles/variables.css')

let failed = 0
const ok = (cond, label, extra = '') => {
  if (cond) console.log('  ✅ ' + label + (extra ? ' ' + extra : ''))
  else {
    console.log('  ❌ ' + label + (extra ? ' ' + extra : ''))
    failed++
  }
}

/* ── 工具：剥注释 / 取 <style> / 切规则 / 按顶层逗号分组 ─────────────────── */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
const norm = (s) => s.replace(/\s+/g, ' ').trim()

function styleBlocks(vueSrc) {
  return [...vueSrc.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1])
}

/** 粗切 `sel{body}`（够用：只用来找含 :focus-within 的规则；@media 内的规则也能被切到） */
function rules(css) {
  const out = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(css))) out.push({ sel: norm(m[1]), body: norm(m[2]) })
  return out
}

/** 按**顶层**逗号分组（`:is(a,b)` 里的逗号不能切） */
function splitTop(sel) {
  const out = []
  let depth = 0
  let cur = ''
  for (const ch of sel) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  if (cur.trim()) out.push(cur)
  return out.map(norm)
}

/* ── 工具：截出「平衡括号」的伪类函数体（`:where(:not(...))` 这种嵌套必须按括号配平切，
   用 `[^)]*` 的非贪婪正则会切在第一个 `)`，把剩余部分当成普通选择器算进特异性）── */
function cutBalanced(s, marker) {
  const start = s.indexOf(marker)
  if (start < 0) return null
  let depth = 0
  for (let i = start + marker.length - 1; i < s.length; i++) {
    if (s[i] === '(') depth++
    else if (s[i] === ')') {
      depth--
      if (depth === 0) return { before: s.slice(0, start), inner: s.slice(start + marker.length, i), after: s.slice(i + 1) }
    }
  }
  return null
}

/* ── 工具：特异性（只覆盖本项目用到的形态：#id .cls [attr] :pseudo
      `:where()`=0、`:is()`/`:not()`=参数里最高）── 返回单个数便于比较：(0,2,0) → 20。 */
function specificity(sel) {
  let s = ' ' + sel + ' '
  /* :where() 整体归零 */
  let guard = 0
  while (guard++ < 30) {
    const c = cutBalanced(s, ':where(')
    if (!c) break
    s = c.before + ' ' + c.after
  }
  /* :is() / :not() 取参数里最高（:not 本身不加权重，与 :is 同规则） */
  let extra = 0
  guard = 0
  while (guard++ < 40) {
    let hit = null
    let which = ''
    for (const fn of [':is(', ':not(']) {
      const c = cutBalanced(s, fn)
      if (c && (!hit || c.before.length < hit.before.length)) {
        hit = c
        which = fn
      }
    }
    if (!hit) break
    extra += Math.max(...splitTop(hit.inner).map(specificity))
    void which
    s = hit.before + ' ' + hit.after
  }
  const ids = (s.match(/#[\w-]+/g) || []).length
  const cls = (s.match(/\.[\w-]+/g) || []).length
  const attrs = (s.match(/\[[^\]]+\]/g) || []).length
  const pseudos = (s.match(/(?<!:):(?!:)[\w-]+/g) || []).length
  const els = (s.match(/(^|[\s>+~,])([a-z][\w-]*)/g) || []).length
  return ids * 100 + (cls + attrs + pseudos) * 10 + els + extra
}

/* ── 取数：全局焦点环 + 接管规则 + 全部"画环容器" ───────────────────────── */
const varsSrc = strip(fs.readFileSync(VARS, 'utf8'))
const varsRules = rules(varsSrc)

/* 全局焦点环：`:where(...):focus-visible:focus-visible{outline:2px ...}` */
const globalRule = varsRules.find(
  (r) => /focus-visible:focus-visible/.test(r.sel) && /outline\s*:\s*2px/.test(r.body)
)
/* 接管规则：含 `:focus-within` + `outline:none` + `:where(input`
   ⚠️ 必须是 `:where(input` 这种"后代 + 内层控件"形态，不是 `:focus-within{outline:none}` 那种
      把框本身也压掉的写法 —— 后者会把设计意图（圆角框变色）一起干掉。 */
const takeover = varsRules.find(
  (r) => /:focus-within/.test(r.sel) && /outline\s*:\s*none/.test(r.body) && /:where\(input/.test(r.sel)
)

/* 文本控件内缩环（v750）：按"选择器形态"找，**不按 offset 的正负找** ——
   否则把 offset 改回 2px 时规则"找不到"，报的是"规则不存在"，
   诊断信息指错方向（真问题在值上，不在有没有规则）。 */
const innerRing = varsRules.find(
  (r) => /^:is\(input/.test(r.sel) && /outline-offset\s*:/.test(r.body)
)

/* 画环容器：凡「选择器含 :focus-within」且「声明了 border-color 或 box-shadow」的规则 */
function paintersFrom(css, file) {
  const out = []
  for (const r of rules(css)) {
    if (!/:focus-within/.test(r.sel)) continue
    if (!/(border-color|box-shadow)\s*:/.test(r.body)) continue
    for (const one of splitTop(r.sel)) {
      const i = one.indexOf(':focus-within')
      if (i < 0) continue
      out.push({ wrapper: norm(one.slice(0, i)), file })
    }
  }
  return out
}

const files = []
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name.endsWith('.vue')) files.push(p)
    else if (e.name.endsWith('.css')) files.push(p)
  }
}
walk(path.join(ROOT, 'src'))

let painters = []
for (const f of files) {
  const raw = fs.readFileSync(f, 'utf8')
  const rel = path.relative(ROOT, f)
  const blocks = f.endsWith('.vue') ? styleBlocks(raw) : [raw]
  for (const b of blocks) painters.push(...paintersFrom(strip(b), rel))
}
/* 去重（同一 wrapper 可能在多个文件重复声明，如 .tb-search 在 Settings 与 Forecast） */
const painterMap = new Map()
for (const p of painters) {
  if (!painterMap.has(p.wrapper)) painterMap.set(p.wrapper, [])
  if (!painterMap.get(p.wrapper).includes(p.file)) painterMap.get(p.wrapper).push(p.file)
}

/* 接管名单：`:is(...)` 里的每一项 */
const listRaw = takeover ? (takeover.sel.match(/:is\(([\s\S]*?)\)/) || [])[1] : ''
const list = listRaw ? splitTop(listRaw) : []

/* ---------------- ① 接管规则存在且形态正确 ---------------- */
console.log('\n① 接管规则')
ok(!!globalRule, '全局焦点环仍在（outline:2px + :focus-visible:focus-visible）')
ok(!!takeover, 'variables.css 里有"组框接管"规则（:focus-within + :where(input) + outline:none）')
{
  const inner = takeover ? (takeover.sel.match(/:where\(([\s\S]*?)\)\s*:focus-visible/) || [])[1] : ''
  const innerList = inner ? splitTop(inner) : []
  ok(innerList.includes('input') && innerList.includes('select') && innerList.includes('textarea'),
    '内层目标含 input/select/textarea', `实际=${innerList.join(',') || '无'}`)
  ok(!innerList.includes('button') && !innerList.includes('a') && !innerList.includes('[tabindex]'),
    '内层目标**不含** button/a/[tabindex]（组框里的按钮没有外层环可依赖）', `实际=${innerList.join(',') || '无'}`)
  ok(/^:is\(|:is\(/.test(takeover ? takeover.sel : ''), '用 :is() 枚举容器（一处登记，全站生效）')
  /* 🔴 结构判据（v749 首版在这里翻过车）：`:focus-within` 必须紧贴容器右括号。
     写成 `:is(...) :focus-within ...`（有空格）＝多要求一层"focus-within 的后代"，
     于是 `.ipn-f > select` 这种直接子元素不匹配 —— 供应商输入框因为中间有
     `.ipn-sup-combo` 侥幸治好了，下拉照旧两层环。这种"改一个漏一个"最难发现。 */
  const selTxt = takeover ? takeover.sel : ''
  ok(/\)\s*:focus-within/.test(selTxt) && !/\)\s+:focus-within/.test(selTxt),
    ':focus-within 紧贴容器右括号（不得有空格＝不得多要求一层后代）',
    selTxt.match(/\)(\s*):focus-within/) ? `分隔符="${selTxt.match(/\)(\s*):focus-within/)[1] || '无'}"` : '')
  ok((selTxt.match(/:focus-within/g) || []).length === 1,
    '选择器里只有一处 :focus-within（两处＝又变成"隔一层"）',
    `出现 ${(selTxt.match(/:focus-within/g) || []).length} 次`)
}

/* ---------------- ② 特异性必须压得住全局环 ---------------- */
console.log('\n② 特异性')
{
  /* 自检：计算器得先对，否则"4 > 2"可能只是巧合 */
  ok(specificity(':where(a,b):focus-visible:focus-visible') === 20,
    '自检：全局环选择器算得 (0,2,0)', `= ${specificity(':where(a,b):focus-visible:focus-visible')}`)
  ok(specificity(':is(.a .b):focus-within :where(input):focus-visible') === 40,
    '自检：接管选择器算得 (0,4,0)',
    `= ${specificity(':is(.a .b):focus-within :where(input):focus-visible')}`)
  /* v750：选择器里出现嵌套的 `:where(:not(...))` 与 `:not(.err *)`，
     用 `[^)]*` 非贪婪切括号会切错（把剩余片段当成普通选择器算进去）⇒ 必须按括号配平。
     期望 (0,4,1) = 元素 1 + `.err` 10 + `.err *` 的 `.err` 10 + 两个 :focus-visible 20。 */
  ok(specificity(':is(input):where(:not([type=checkbox])):not(.err):not(.err *):focus-visible:focus-visible') === 41,
    '自检：内缩环形态算得 (0,4,1)（嵌套伪类按括号配平）',
    `= ${specificity(':is(input):where(:not([type=checkbox])):not(.err):not(.err *):focus-visible:focus-visible')}`)
  const g = globalRule ? specificity(globalRule.sel) : 0
  const t = takeover ? specificity(takeover.sel) : 0
  ok(t > g, '接管规则特异性 > 全局焦点环（否则规则是死的）', `接管=${t} / 全局=${g}`)
}

/* ---------------- ③ 双向登记 ---------------- */
console.log('\n③ 双向登记（画环的必须登记 / 登记的必须还在画环）')
{
  const missing = [...painterMap.keys()].filter((w) => !list.includes(w))
  ok(missing.length === 0, '所有"用 :focus-within 画环"的容器都在接管名单里',
    missing.length ? '漏登记：' + missing.join(' | ') : `${painterMap.size} 个容器全覆盖`)
  const stale = list.filter((w) => !painterMap.has(w))
  ok(stale.length === 0, '名单里没有过期条目（登记了但已经不再画环）',
    stale.length ? '过期：' + stale.join(' | ') : `${list.length} 条全部有效`)
  /* v788：删掉 InvPurchaseNew.vue / InvSaleNew.vue 后，这两个旧容器类不再画环。
     钉住它们不许回名单 —— 一旦有人把死页面挂回来，双向登记会先在这里判红。 */
  ok(!list.some((w) => /ipn-hd-box|isn-hd-box/.test(w)),
    'v788：v449 废弃的旧容器类不再登记（死页面已删，挂回来即判红）')
  ok(painterMap.size >= 5 && list.length >= 5,
    '解析自检：画环容器数 ≥ 5（正则失效抽成空集时上面两条会全票通过）',
    `画环=${painterMap.size} / 名单=${list.length}`)
}

/* ---------------- ④ 反向回归：全局环不许被删 ---------------- */
console.log('\n④ 全局环不许为了消双环被删掉')
ok(!!globalRule, '全局 :focus-visible 环仍在（删了就是全站键盘零指示）')
{
  const anyOutlineNone = varsRules.filter(
    (r) => /outline\s*:\s*none/.test(r.body) && !/:focus-within/.test(r.sel) && /:focus-visible/.test(r.sel)
  )
  ok(anyOutlineNone.length === 0, '没有"无条件的 :focus-visible{outline:none}"',
    anyOutlineNone.length ? anyOutlineNone.map((r) => r.sel).join(' | ') : '')
}

/* ---------------- ⑤ 文本控件：焦点环贴内侧（v750） ----------------
   与 ①②③④ 是"同一件事故的第二层"：
     ①–④ 管「组框已经画环 ⇒ 框内控件别再画」（一大一小）
     ⑤   管「控件自己画环 ⇒ 环别浮在边框外 2px」（边框 + 一圈游离框）
   用户两次报障分别对应这两层；只修一层另一种照旧，所以必须在同一个契约里双向守着。 */
console.log('\n⑤ 文本控件焦点环贴内侧（v750）')
/* 判据写成纯函数：真实规则跑一遍要 0 条，若干坏样本各跑一遍要 ≥1 条 ——
   只对真实规则断言，只能证明"现在是对的"，不能证明"改错会被发现"。 */
function innerRingViolations(sel, body) {
  const v = []
  if (!/outline-offset\s*:\s*-1px/.test(body)) v.push('offset 不是 -1px')
  if (/outline\s*:\s*none/.test(body)) v.push('写成 outline:none（键盘用户零指示）')
  if (/box-shadow\s*:/.test(body)) v.push('改用 box-shadow（会盖掉错误态的 --dan-bg 光晕）')
  for (const t of ['checkbox', 'radio', 'range', 'color', 'file']) {
    if (!sel.includes(`[type=${t}]`)) v.push(`未排除 [type=${t}]`)
  }
  if (!/:not\(\.err\)/.test(sel)) v.push('未排除 .err 自身')
  if (!/:not\(\.err \*\)/.test(sel)) v.push('未排除 .err 容器内的控件')
  if (!/\):where\(/.test(sel)) v.push(':is() 与 :where() 之间有空白（= 后代选择器 ⇒ 规则静默失效）')
  if (!/^:is\(input/.test(sel)) v.push('没有以 :is(input…) 开头（目标不是文本控件）')
  return v
}
if (innerRing) {
  const v = innerRingViolations(innerRing.sel, innerRing.body)
  ok(v.length === 0, '真实规则 0 条违规', v.length ? v.join('；') : innerRing.sel.slice(0, 72) + '…')
  const ig = specificity(innerRing.sel)
  const gg = globalRule ? specificity(globalRule.sel) : 0
  ok(ig > gg, '特异性 > 全局焦点环（否则规则是死的）', `内缩环=${ig} / 全局=${gg}`)
} else {
  ok(false, 'variables.css 里有"文本控件环内缩"规则（outline-offset:-Npx + :is(input…)）')
}

/* ---------------- ⑥ 反向：按钮/链接仍用外环 ---------------- */
console.log('\n⑥ 反向：非文本控件（按钮/链接/[tabindex]）必须保留外环')
{
  const gBody = globalRule ? globalRule.body : ''
  ok(/outline-offset\s*:\s*2px/.test(gBody),
    '全局环仍是向外 2px（按钮/链接没有可变色的边框，靠这圈认焦点）', gBody)
  const gSel = globalRule ? globalRule.sel : ''
  ok(/button/.test(gSel) && /a,/.test(gSel) && /\[tabindex\]/.test(gSel),
    '全局环仍覆盖 button/a/[tabindex]')
}

/* ---------------- 坏样本自证 ---------------- */
console.log('\n坏样本自证（改坏了必须红）')
{
  /* A：接管规则把 button 也压掉 ⇒ ① 的"不含 button"要红 */
  const badA = takeover
    ? takeover.sel.replace(':where(input,select,textarea)', ':where(input,select,textarea,button)')
    : ''
  const innerA = badA ? (badA.match(/:where\(([\s\S]*?)\)\s*:focus-visible/) || [])[1] : ''
  ok(innerA.split(',').map((s) => s.trim()).includes('button'),
    '坏样本 A：内层目标加上 button ⇒ 判据能识别出来')

  /* B：把 :is() 换成单个类 ⇒ 只治一个容器，其余照旧双层 */
  const badB = ':is(.hd-box .ipn-f) :focus-within :where(input):focus-visible'.replace(
    ':is(.hd-box .ipn-f)',
    '.hd-box .ipn-f'
  )
  const listB = (badB.match(/:is\(([\s\S]*?)\)/) || [])[1] || ''
  ok(!listB, '坏样本 B：不用 :is() ⇒ 名单抽成空集，③ 的"全覆盖"必然报红')
  ok([...painterMap.keys()].some((w) => w !== '.hd-box .ipn-f'),
    '坏样本 B 反证：确实存在别的画环容器（所以只写一个类是不够的）')

  /* C：最像"顺手修一下"的错法 —— 直接写 `input:focus-visible{outline:none}`
        （特异性 11 < 全局环 20 ⇒ 规则是死的；而且它连"只在组框里生效"都没做到）*/
  const badC = 'input:focus-visible'
  ok(!(specificity(badC) > specificity(':where(a,b):focus-visible:focus-visible')),
    '坏样本 C：`input:focus-visible{outline:none}` 压不过全局环（规则会静默失效）',
    `${specificity(badC)} vs ${specificity(':where(a,b):focus-visible:focus-visible')}`)

  /* E：v749 首版踩过的写法 —— `:is(...) :focus-within`（中间有空格）
        ⇒ 变成"容器里还得有个 focus-within 的后代"，直接子元素全不匹配 */
  {
    const badE = ':is(.hd-box .ipn-f) :focus-within :where(input,select,textarea):focus-visible'
    ok(/\)\s+:focus-within/.test(badE) && !/\)\s*:focus-within/.test(badE.replace(/\)\s+:focus-within/, 'X')),
      '坏样本 E：`:is(...) :focus-within`（中间空格）会被结构判据识破')
  }

  /* D：把某条画环规则改到不存在 ⇒ 名单出现过期条目 */
  const fakePainters = new Map([['.hd-box .ipn-f', ['x']]])
  ok(list.filter((w) => !fakePainters.has(w)).length > 0,
    '坏样本 D：某容器不再画环 ⇒ 名单里那条成为过期条目，③ 会报红')

  /* F–J：v750 这层的五种典型改错，逐条对**真实规则**做字符串突变，判据必须报红 */
  {
    const g = innerRing || { sel: '', body: '' }
    const cases = [
      ['F offset 写回 2px（＝这次要修的症状）', g.sel, g.body.replace('-1px', '2px')],
      ['G `:is(...)` 与 `:where(...)` 之间加空格', g.sel.replace('):where(', ') :where('), g.body],
      ['H 顺手改成 outline:none', g.sel, g.body.replace(/outline-offset\s*:\s*-1px/, 'outline:none')],
      ['I 去掉 [type=checkbox] 排除', g.sel.replace(':not([type=checkbox])', ''), g.body],
      ['J 去掉 .err 排除', g.sel.replace(':not(.err *)', '').replace(':not(.err)', ''), g.body],
    ]
    for (const [label, s, b] of cases) {
      const v = innerRingViolations(s, b)
      ok(v.length > 0, `坏样本 ${label} ⇒ 判据报红`, v.slice(0, 2).join('；'))
    }
  }
}

/* ---------------- 结论 ---------------- */
if (failed) {
  console.log(`\n❌ focus-ring-takeover: ${failed} 条不通过`)
  process.exit(1)
}
console.log('\n✅ focus-ring-takeover: 全部通过')
