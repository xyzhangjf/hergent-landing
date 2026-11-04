/* v765 契约：品牌报单日的**配置界面**必须挂在页面上、而且只能发真布尔。
 *
 * 后端判定内核（76 项）+ 小程序三道闸门（已各有契约）都验过了，这一层验的是
 * 「配置能不能被正确地下达」——它有三个静默失败形态，全会让功能空转：
 *   ① 组件写好了但**没挂进页面**：文件存在、import 也在，模板里漏了 `<BrandWindowCard />`
 *      ⇒ 老板永远找不到开关。本项目已多次踩"组件写了没人用"（v748 孤儿护栏同族）。
 *   ② 开关发的是字符串：`{ enabled: 'false' }` 经后端 `bool()` 变成 `True`
 *      ⇒ 点"关闭"其实是打开，零报错（后端已对字符串返回 400，前端也不许这么发）。
 *   ③ 前端自己算星期：矩阵/命中数必须来自 `/brand-window/preview`。2 天/期 与 7 天/周
 *      互质，凭直觉算"配 2 个星期 = 每周两次"必然错，而且错得毫无声响。
 *   ④ `api()` 第二个参数是 **options 对象**。写成 `api(url,'PUT',body)` ⇒ method 兜底 GET、
 *      body 丢弃 ⇒ 按钮点了没反应、还弹"已启用"（2026-11-04 真实踩过）。判据＝发对形态
 *      **且**比对回读值 `!!r.enabled !== next`。*
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const SRC = path.join(ROOT, 'src')

let failed = 0
const ok = (cond, label, extra = '') => {
  if (cond) console.log('  ✅ ' + label + (extra ? ' ' + extra : ''))
  else {
    console.log('  ❌ ' + label + (extra ? ' ' + extra : ''))
    failed++
  }
}

const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[;\s])\/\/[^\n]*/g, '$1')
const stripTpl = (s) => s.replace(/<!--[\s\S]*?-->/g, '')

function read(p) {
  return fs.readFileSync(p, 'utf8')
}

/** 递归列出 .vue/.js（错签名扫描用：漏掉任何一个目录都可能放过一处） */
function walk(dir) {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else if (/\.(vue|js)$/.test(e.name)) out.push(p)
  }
  return out
}

/** 返回失败原因数组（空 = 全过）；对副本复用同一套判据 */
function audit(srcRoot) {
  const errs = []
  /* A 只收两个参数时，调用处传的第三个 extra 会被**静默丢掉**（报错信息里看不到文件名）。
     判据出错时最需要的就是「哪个文件」——所以这里必须收 extra。 */
  const A = (cond, msg, extra = '') => { if (!cond) errs.push(msg + (extra || '')) }
  const card = path.join(srcRoot, 'components/forecast/BrandWindowCard.vue')
  const page = path.join(srcRoot, 'pages/Forecast.vue')
  const rhythm = path.join(srcRoot, 'components/rebate/ArrivalRhythmBlock.vue')
  const rebate = path.join(srcRoot, 'pages/Rebate.vue')

  for (const f of [card, page, rhythm, rebate]) {
    A(fs.existsSync(f), '缺文件：' + path.relative(srcRoot, f))
  }
  if (errs.length) return errs

  const c = stripJs(stripTpl(read(card)))
  const pg = stripJs(stripTpl(read(page)))
  const rh = stripJs(stripTpl(read(rhythm)))
  const rb = stripJs(stripTpl(read(rebate)))

  /* ① 挂进了页面（import + 标签两件事都要有） */
  A(/import\s+BrandWindowCard\s+from\s+'\.\.\/components\/forecast\/BrandWindowCard\.vue'/.test(pg),
    'Forecast.vue import 了 BrandWindowCard')
  A(/<BrandWindowCard\s*\/>/.test(pg), '🔴 Forecast.vue 模板里真的渲染了 <BrandWindowCard />')
  A(pg.indexOf('<BrandWindowCard />') > pg.indexOf("activeTab === 'config-auto'"),
    '挂在「报单自动化」同一子页下（不新增子页 ⇒ 不用改 TAB_KEYS 三处）')

  /* ② 开关只发真布尔 */
  A(!/enabled:\s*['"]/.test(c), '🔴 开关不发字符串（"false" 经 bool() 会变真）')
  A(/enabled:\s*next\b/.test(c) && /const\s+next\s*=\s*!p\.enabled/.test(c),
    '开关的值来自取反后的真布尔')

  /* ③ 前端不算星期：矩阵/命中数必须来自后端预览 */
  A(c.includes('/api/forecast/brand-window/preview'), '矩阵数据来自 preview 端点')
  A(!/order_weekdays/.test(c), '🔴 卡片里不碰 order_weekdays（不在前端算星期）')
  A(!/new Date\(/.test(c), '🔴 卡片里不自己推日期/星期')
  const wd = (c.match(/周[一二三四五六日天]/g) || []).length
  A(wd === 0, '🔴 卡片源码里没有星期字面量', ` ${wd}`)

  /* ④ 配错的两种情形必须标红（生产真实坏数据：品牌名匹配 0 个商品） */
  A(/products\s*\?/.test(c) && c.includes('bw-bad'), '匹配 0 个商品的品牌会被标红')
  A(c.includes('never_brands') || c.includes('命中'), '「最近 N 期一期都不命中」会被看见')
  A(c.includes('匹配 0 个商品'), '文案说清"为什么这条规则不生效"')

  /* ②b 🔴 `api()` 第二个参数是 **options 对象**，不是 method 字符串。
     2026-11-04 真实踩过：写成 `api(url, 'PUT', {enabled})` ⇒ `opts` 是个字符串、
     `method` 取不到 ⇒ 兜底 GET、body 整个丢弃 ⇒ 拿回"当前仍为关"的旧值，
     界面照样弹绿底「已启用」＝**假成功**。编译不报错、请求也不报错（GET 本来就 200），
     只有比对回读值 / 看后端日志才发现。两层都要守：发对形态、且校验回读。 */
  A(/api\('\/api\/forecast\/brand-window'\s*,\s*\{\s*method:\s*'PUT'\s*,\s*body:/.test(c),
    '🔴 开关用 options 对象发 PUT（不是 api(url, "PUT", body)）')
  A(/!!r\.enabled\s*!==\s*next/.test(c),
    '🔴 写入后比对回读值（不符即报失败，防"提示已启用其实没开"）')
  /* 扫描前必须**去注释**：本卡片自己的注释里就写着 `api(url, 'PUT', {enabled})` 这个反例，
     不去注释会把文档当代码判红（第一次跑正是这样自撞的）。 */
  const badSig = walk(srcRoot).filter((f) =>
    /api\([^)]*,\s*['"](?:GET|PUT|POST|DELETE|PATCH)['"]/.test(stripJs(stripTpl(read(f)))))
  A(!badSig.length, '🔴 没有 api(url, "METHOD", …) 错签名',
    badSig.length ? ' ' + badSig.slice(0, 3).map((f) => path.relative(srcRoot, f)).join(',') : '')

  /* ⑤ 周期说明：报单星期的真实含义必须在配置处说清 */
  A(/orderWkNote/.test(rh), 'ArrivalRhythmBlock 有报单星期含义说明')
  A(rh.includes('/7'), '说明里给出「约占 N/7 的期次」这个换算')
  A(/7 天全勾|7 天全选/.test(rh), '7 个全勾 = 不限制，单独说')

  /* ⑥ 就地入口（v765e）：卡片上的「改报单日 ›」必须**真的能落到那一条规则**上。
     三个静默失败形态：
       a) 入口指向 `/rebate` 而不带 `edit_rule` ⇒ 落到规则列表，用户还要自己找 ＝ 等于没做；
       b) 带了 `edit_rule` 却不带 `tab=rules` ⇒ 弹窗开在「返利看板」子页背后，关掉后人在别处；
       c) 不过 `canSee('/rebate')` ⇒ 没有返利权限的人能点、点了被守卫踢回工作台（假入口）。
     另有一条：**不许按品牌名反查规则 id** —— 规则里的 `scope_key`（如 `蒙牛低温/鲜奶`）
     与归一后的品牌名（`蒙牛低温`）不是一回事，拿名字 `find()` 等于在前端重写一遍归一化。 */
  const tabRules = (c.match(/tab:\s*'rules'/g) || []).length
  A(/edit_rule:\s*String\(id\)/.test(c), '🔴「改报单日」走 edit_rule 深链（不是只跳 /rebate）')
  A(tabRules >= 2, '🔴 两个入口都带 tab=rules（否则弹窗开在别的子页背后）', ` ${tabRules}/2`)
  A(/canSee\('\/rebate'\)/.test(c), '🔴 入口过 canSee(/rebate) 权限闸门（防"能点、点了被踢"）')
  A(/r\.rule_id/.test(c) && !/find\([^)]*scope_key/.test(c),
    '🔴 按 rule_id 定位，不按品牌名反查（scope_key 与归一后品牌名不是一回事）')
  A(c.includes('goNewBrand'), '空态有「去配第一条」入口（不是又一句指路文字）')

  /* ⑦ 承接端：Rebate.vue 必须真的认这两个一次性指令，且消费后从 URL 清掉。
     不清的后果：按 F5 会再弹一次新建窗，用户会以为"上次没保存成功"。 */
  A(/function _applyRouteNew/.test(rb), 'Rebate.vue 认 ?new=brand（空态按钮的落点）')
  A(/_applyRouteNew\(\)/.test(rb) && rb.indexOf('_applyRouteEdit()') < rb.indexOf('_applyRouteNew()'),
    '`?new` 在 loadRules 里被调用，且排在 edit 之后（同时挂 URL 时以"改已有那条"为准）')
  /* 🔴 必须**数出现次数**而不是只判存在：`delete q.new` 要在两处都有 ——
     `_applyRouteNew()` 消费后立刻摘（防 F5 重新弹）、`syncTabUrl()` 兜底（切子页时清）。
     只判存在的话，删掉任一处另一处还在，判据照样绿 ⇒ 坏样本变空头支票（本样本第一次就是这样漏的）。 */
  const delNew = (rb.match(/delete q\.new/g) || []).length
  A(delNew >= 2, '🔴 一次性 new 指令两处都清（消费后立刻摘 + syncTabUrl 兜底）', ` ${delNew}/2`)

  return errs
}

console.log('── v765 按品牌报单日管控 · Web 配置界面 ──')

const real = audit(SRC)
ok(real.length === 0, '真树判据全过', real.length ? '\n     - ' + real.join('\n     - ') : '')

/* 坏样本自证：每条"防静默失败"的判据都要能被注入的坏改法触发 */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-web-'))
/* 副本必须与 `audit()` 读到的文件集**完全一致** —— 少复制一个文件，那条判据就会因为
   "文件不存在" 报红，看起来像"坏样本被检出了"，实际上检的是缺失而不是坏改法（假阳性）。 */
function copyTree(dst) {
  fs.cpSync(path.join(SRC, 'components'), path.join(dst, 'components'), { recursive: true })
  fs.mkdirSync(path.join(dst, 'pages'), { recursive: true })
  for (const f of ['Forecast.vue', 'Rebate.vue']) {
    fs.cpSync(path.join(SRC, 'pages', f), path.join(dst, 'pages', f))
  }
}
function mutate(name, rel, from, to) {
  const dst = path.join(tmp, name)
  copyTree(dst)
  const p = path.join(dst, rel)
  const s = read(p)
  if (!s.includes(from)) {
    ok(false, `${name}：锚点未命中（源码已改，需更新样本）`)
    return null
  }
  fs.writeFileSync(p, s.replace(from, to))
  return dst
}
try {
  const ctrl = path.join(tmp, 'ctrl')
  copyTree(ctrl)
  const ctrlErrs = audit(ctrl)
  ok(ctrlErrs.length === 0, '对照组（原样复制）全绿（证明判据不是"见红就对"）',
    ctrlErrs.length ? ' 残留：' + ctrlErrs.join('|') : '')

  const samples = [
    ['w1', 'pages/Forecast.vue', '<BrandWindowCard />', '',
      '组件没挂进模板（文件在、入口不在）'],
    ['w2', 'components/forecast/BrandWindowCard.vue',
      'enabled: next', "enabled: String(next)",
      '开关发字符串（点了「关闭」其实打开）'],
    ['w3', 'components/forecast/BrandWindowCard.vue',
      "import { api } from '../../api/client'",
      "import { api } from '../../api/client'\nconst _wk = ['周日', '周一']",
      '前端自己拼星期（第二份实现）'],
    ['w4', 'components/forecast/BrandWindowCard.vue',
      "await api('/api/forecast/brand-window', { method: 'PUT', body: { enabled: next } })",
      "await api('/api/forecast/brand-window', 'PUT', { enabled: next })",
      '🔴 api 错签名 ⇒ 发的是 GET，界面却提示「已启用」（假成功）'],
    ['w5', 'components/forecast/BrandWindowCard.vue',
      'if (!!r.enabled !== next) {', 'if (false) {',
      '🔴 不比回读值 ⇒ 没写进去也提示成功'],
    ['w6', 'components/forecast/BrandWindowCard.vue',
      "{ tab: 'rules', edit_rule: String(id) }", '{ edit_rule: String(id) }',
      '🔴 深链丢了 tab=rules（弹窗开在别的子页背后）'],
    ['w7', 'components/forecast/BrandWindowCard.vue',
      "const canEditRebate = computed(() => canSee('/rebate'))",
      'const canEditRebate = computed(() => true)',
      '🔴 入口不过权限闸门（能点、点了被踢回工作台）'],
    ['w8', 'components/forecast/BrandWindowCard.vue',
      "{ tab: 'rules', edit_rule: String(id) }", "{ tab: 'rules', brand: r.brand }",
      '🔴 只带品牌名不带 rule_id（前端得自己反查 = 第二份归一化）'],
    ['w9', 'pages/Rebate.vue',
      '  delete q.new', '  void q.new',
      '🔴 一次性 new 指令有一处不回清（F5 再弹一次新建窗）'],
  ]
  for (const [tag, rel, from, to, desc] of samples) {
    const dst = mutate(tag, rel, from, to)
    if (!dst) continue
    const errs = audit(dst)
    ok(errs.length > 0, `${tag} 已检出：${desc}`)
  }
  ok(samples.length >= 9, '坏样本 ≥ 9（防样本被删空后全绿）', ` ${samples.length}`)
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}

console.log('')
if (failed) {
  console.log(`❌ 失败 ${failed} 项`)
  process.exit(1)
}
console.log('✓ v765 Web 品牌报单日配置契约全部通过')
