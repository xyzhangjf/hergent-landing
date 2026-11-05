/* v765 契约：小程序端「品牌报单日」的三道闸门必须真的接上。
 *
 * 起因：后端判定内核（`domain/brand_order_window.py`，76 项断言）验的是**算法对不对**，
 * 它一个字都管不到小程序有没有**真的用它**。这个功能最可能的失败形态是：
 *   ① 后端算对了、`fill-search` 也下发了 `orderable:false`，但小程序根本没用 ⇒
 *      界面全绿、能填能提交，业务员在非报单日把单报上去（厂家侧不认，回款对不上）；
 *   ② 只挡住 `setQty`（点 +/− 的入口），却漏了**不走 setQty 的三条写入口**：
 *      `applyLastOrder`（一键带入上次）、`_applySample`（样单 / 继续修改）、
 *      离线草稿补传 —— 结果"手填进不去、一键带进来却提交了"，且零报错；
 *   ③ 前端的 `!p.orderable` 真值判断把「老后端没这个字段」当成「不许报」
 *      ⇒ 一次后端降级让全员报不了单（fail-safe 方向反了）。
 *
 * 判据全部是**静态源码判据**（小程序没有可跑的运行时），所以每条都必须能自证：
 * 往副本里注入对应的坏改法，`audit()` 必须变红。只证明"真树绿"等于没证明。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const PROJ = path.resolve(ROOT, '..')
const MINI = path.join(PROJ, 'forecast-order-miniprogram-20260812T023419087Z/miniprogram')

let failed = 0
const ok = (cond, label, extra = '') => {
  if (cond) console.log('  ✅ ' + label + (extra ? ' ' + extra : ''))
  else {
    console.log('  ❌ ' + label + (extra ? ' ' + extra : ''))
    failed++
  }
}

/* 去注释后再判：这些文件的注释里**大量出现**「周一、四」这类举例，
   不去注释的话"前端不许出现星期字面量"这条会永远红，然后被人删掉。 */
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[;\s])\/\/[^\n]*/g, '$1')
const stripXml = (s) => s.replace(/<!--[\s\S]*?-->/g, '')
const stripCss = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')

function load(root) {
  const rd = (p) => fs.readFileSync(p, 'utf8')
  return {
    js: rd(path.join(root, 'pages/fill/fill.js')),
    wxml: rd(path.join(root, 'pages/fill/fill.wxml')),
    wxss: rd(path.join(root, 'pages/fill/fill.wxss')),
  }
}

/** 返回失败原因数组（空 = 全过）。不打印，便于对副本复用。 */
function audit(src) {
  const errs = []
  const A = (cond, msg) => { if (!cond) errs.push(msg) }
  const js = stripJs(src.js)
  const wxml = stripXml(src.wxml)
  const wxss = stripCss(src.wxss)

  /* ── 1. 判定结果被拉下来、并且**在商品铺开时会拉** ── */
  A((js.match(/\n {2}loadBrandWindows\(pid\) \{/g) || []).length === 1,
    'loadBrandWindows 有且只有一处定义')
  A(js.includes('this.loadBrandWindows(pid)'),
    'loadProducts 里按当前期次调了 loadBrandWindows')

  /* ── 2. 唯一写入口 setQty 的闸门 ── */
  A(js.includes('if (p.orderable === false) {'), '🔴 setQty 有 orderable === false 闸门')
  /* v765d：**toast → 弹窗**。用户原话：「如果用户没看到这个提示，还是去填报不能提报的
     商品，给一个弹窗提示」。toast 2.6 秒就消失，而这一屏在小键盘弹起、列表滚到一半时
     顶部横幅根本不在视野里 —— "没看到提示所以继续填"正是要修的场景。
     四条一起锁：弹窗形态 / 走 _bwLock / 正文取后端整句 / 同品牌节流。 */
  A(/wx\.showModal\(\{\s*\n\s*title: '本期不可提报'/.test(js),
    '🔴 闸门用弹窗（不是 2.6s 就消失的 toast）')
  A(js.includes('this._bwLock(p, this._bwMsg(p))'), '🔴 闸门统一走 _bwLock（一处文案）')
  A(/if \(b\.lock_msg\) return b\.lock_msg/.test(js),
    '🔴 弹窗正文用后端整句（前端不拼日期，否则多一份口径）')
  A(js.includes('this._bwLockKey === k'), '🔴 同品牌 4 秒内只弹一次（showModal 会串行排队）')
  A(!/wx\.showToast\(\{ title: this\._bwMsg/.test(js), '🔴 不再用 toast 做拦截（残留即两套）')
  /* fail-safe 方向：老后端没有这个字段（undefined），真值判断会把它当"不许报" */
  A(!/!\s*p\.orderable\b/.test(js), '🔴 不许出现 !p.orderable（undefined 会被当成不许报）')

  /* ── 3. 绕过 setQty 的写入口必须一起挡 ── */
  const purgeCalls = (js.match(/_bwPurgeCart\(\)/g) || []).length
  A(purgeCalls >= 3, '🔴 _bwPurgeCart 至少 3 处（定义 + 一键带入 + 样单）', ` ${purgeCalls}`)
  A(/const purged = this\._bwPurgeCart\(\)\n {4}this\.syncCart\(\)/.test(js),
    '🔴 applyLastOrder（一键带入）铺完就剔')
  A(/const purged = this\._bwPurgeCart\(\)\n {6}this\.syncCart\(\)/.test(js),
    '🔴 _applySample（样单/继续修改）铺完就剔')

  /* ── 4. 提交前最后一道：位置必须在核对层之前，且不自动剔 ── */
  A(js.includes('const bwBad = []'), '🔴 _doSubmit 有提交前品牌检查')
  const iGuard = js.indexOf('const bwBad = []')
  /* 必须找**调用点** `await this._askConfirm(`，不能找 `_askConfirm(` ——
     它的定义（`async _askConfirm(`）在本文件更靠前，indexOf 会命中定义，
     这条判据就恒真了（本项目"锚点选错 ⇒ 恒真断言"已踩过多次）。 */
  const iConfirm = js.indexOf('await this._askConfirm(')
  A(iGuard > 0 && iConfirm > 0 && iGuard < iConfirm,
    '🔴 品牌检查在明细核对层之前（否则用户核对了才发现提交不了）')
  A(/if \(bwBad\.length\) \{/.test(js), '🔴 命中后必须拦下（不是只统计）')
  A(!/delete this\.cartMap\[\s*k\s*\]/.test(js.slice(iGuard, iGuard + 2000)),
    '🔴 提交前只拦不剔（静默删掉用户填的数量比拒绝更糟）')

  /* ── 5. 扫码：必须是独立一种结果，不能沿用「已定位」绿色回执 ── */
  A(js.includes("if (kind === 'locked')"), '扫码结果新增 locked 一种')
  A(js.includes('if (target.orderable === false)'), '🔴 扫码命中不可报商品走 locked 分支')

  /* ── 6. 模板：横幅 + 行内禁用态，且横幅只有一条 ── */
  A((wxml.match(/class="bw-bar"/g) || []).length === 1, '🔴 品牌横幅只有一条（不重复渲染）')
  /* v772：主句已是**本期清单的完整可报品牌清单**，不再点开明细、不再有兜底句。
     四条一起锁：① 整句取后端 banner；② 空串整条不渲染；③ 旧展开机制彻底撤销；
     ④ 旧兜底话术不再出现。
     🔴 只锁「没有旧字样」的话，把整条横幅删掉也全绿 —— 必须同时锁正向存在判据。 */
  A(js.includes("bwBanner: String((d && d.banner) || '')"), '横幅整句取后端 banner')
  A(wxml.includes('wx:if="{{bwBanner}}"'), '🔴 空值整条不渲染（不留孤立标签）')
  A(!/\bbwDetail\b/.test(js) && !/\bbwDetail\b/.test(wxml),
    '🔴 展开明细已撤销（主句已列全，再展开就是重复）')
  A(!/\bbwOpen\b/.test(js) && !/\bbwOpen\b/.test(wxml) && !/toggleBw/.test(js),
    '🔴 展开状态与入口已撤销')
  A(!/其它品牌均可报/.test(js) && !/其它品牌均可报/.test(wxml),
    '🔴 旧兜底话术已撤销（一件事只留一套语义）')
  A(!/bwSub/.test(js) && !/bwSub/.test(wxml), '副句机制已撤销')
  A(wxml.includes('prod-row-lock'), '不可报行有专用类')
  A(wxml.includes('class="prod-lock"'), '行内显示"哪天才能报"')
  A(/\{\{item\.orderable === false\}\}/.test(wxml) || wxml.includes('item.orderable === false'),
    '🔴 行禁用判据是 === false（与 js 同一条，不用真值）')

  /* ── 7. 前端不许自己算星期 ── */
  const wdJs = (js.match(/周[一二三四五六日天]/g) || []).length
  const wdXml = (wxml.match(/周[一二三四五六日天]/g) || []).length
  A(wdJs === 0 && wdXml === 0,
    '🔴 前端源码里没有星期字面量（2 天/期 与 7 天/周 互质，映射只许后端一份）',
    ` js=${wdJs} wxml=${wdXml}`)

  /* ── 8. 样式：复用既有琥珀三色，不新造色值 ── */
  A(wxss.includes('.bw-bar{') && wxss.includes('.prod-row-lock{'), '有 .bw-bar / .prod-row-lock 样式')
  /* v772：主句要**列全**本期清单品牌，5 个品牌时实测会自然折成 2 行（33px→51px）。
     两行可接受；为了压回单行去截断才是错的 —— 省略号会静默藏掉品牌名，
     等于又回到「白名单漏项 = 少报」。这两条锁死不许截断。 */
  A(!/\.bw-title\{[^}]*white-space:\s*nowrap/.test(wxss),
    '🔴 品牌名不许被压成单行（会溢出隐藏）')
  A(!/\.bw-title\{[^}]*(text-overflow|line-clamp)/.test(wxss),
    '🔴 品牌名不许省略号 / 行数截断（列全变列不全）')
  for (const c of ['#fff7ed', '#fed7aa', '#9a3412']) {
    A(wxss.includes(c), `琥珀色 ${c} 被复用（不是新造的值）`)
  }
  A(!/\.bw-[a-z]+\{[^}]*rgba\(/.test(wxss), '🔴 .bw-* 不用 rgba（品牌色带 alpha 会漂）')

  /* ── 9. 模板引用的 data 键必须都在 data 里声明（小程序不报错，只是永远假） ── */
  for (const k of ['bwBrands', 'bwBanner']) {
    A(new RegExp('\\b' + k + ':').test(js), `data 里声明了 ${k}`)
  }

  return errs
}

console.log('── v765 按品牌报单日管控 · 小程序三道闸门 ──')

/* ① 真树 */
const real = audit(load(MINI))
ok(real.length === 0, '真树静态判据全过', real.length ? '\n     - ' + real.join('\n     - ') : '')

/* ② 副本不注入时也全过 —— 证明下面的变异确实作用在副本、audit 读的是传入 root */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-mini-'))
function mutate(name, file, from, to) {
  const dst = path.join(tmp, name)
  fs.cpSync(MINI, dst, { recursive: true })
  const p = path.join(dst, 'pages/fill', file)
  const s = fs.readFileSync(p, 'utf8')
  if (!s.includes(from)) {
    ok(false, `${name}：锚点未命中（源码已改，需更新样本）`)
    return null
  }
  fs.writeFileSync(p, s.replace(from, to))
  return load(dst)
}
try {
  /* 对照：原样复制一份 */
  const ctrl = path.join(tmp, 'ctrl')
  fs.cpSync(MINI, ctrl, { recursive: true })
  const ctrlErrs = audit(load(ctrl))
  ok(ctrlErrs.length === 0, '对照组（原样复制）全绿（证明判据不是"见红就对"）',
    ctrlErrs.length ? ' 残留：' + ctrlErrs.join('|') : '')

  /* ③ 三个坏样本，每个都必须让 audit 变红 */
  const samples = [
    ['m1', 'fill.js',
      'if (p.orderable === false) {',
      'if (false) {',
      'setQty 闸门被去掉（能填但提交时才炸）'],
    ['m2', 'fill.js',
      '      const purged = this._bwPurgeCart()\n      this.syncCart()',
      '      this.syncCart()',
      '样单写入路径漏剔（"手填进不去、带进来却能提交"）'],
    ['m3', 'fill.js',
      "  _bwShort(item) {",
      "  _bwShort(item) {\n    const WD = ['周一', '周二']",
      '前端自己拼星期（两份实现）'],
    ['m4', 'fill.wxml',
      'class="bw-bar"',
      'class="bw-bar-x"',
      '横幅整条被改名（用户再也看不到本期可报品牌）'],
    ['m5', 'fill.js',
      'if (this._bwLockKey === k',
      'if (false',
      '节流被抹掉（+ 连点会叠 3~4 个一模一样的弹窗）'],
    ['m6', 'fill.wxml',
      'wx:if="{{bwBanner}}"',
      'wx:if="{{true}}"',
      '空值也渲染横幅（没清单/接口失败时留一条孤立标签）'],
    ['m7', 'fill.js',
      '  _bwShort(item) {',
      "  _bwShort(item) {\n    const bwDetail = '其它品牌均可报'",
      '旧兜底话术 + 展开明细又回来了（两段式白名单）'],
    ['m8', 'fill.js',
      "          bwBanner: String((d && d.banner) || '')",
      "          bwBanner: '本期可报品牌：其它品牌均可报'",
      '前端写死兜底句（不再用后端按本期清单给的整句）'],
    ['m9', 'fill.wxss',
      '.bw-title{display:block;',
      '.bw-title{display:block;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;',
      '品牌名被压成单行 + 省略号（列全变列不全，白名单又漏项）'],
  ]
  for (const [tag, file, from, to, desc] of samples) {
    const src = mutate(tag, file, from, to)
    if (!src) continue
    const errs = audit(src)
    ok(errs.length > 0, `${tag} 已检出：${desc}`)
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}

console.log('')
if (failed) {
  console.log(`❌ 失败 ${failed} 项`)
  process.exit(1)
}
console.log('✓ v772 小程序品牌报单日闸门契约全部通过')
