/* v761 契约：填报页搜索框「扫一扫」报单。
 *
 * 需求原话（2026-11-04）：「在小程序的"填报"页面的"搜索"框内新增一个"扫码"图标，
 *   用户点击该图标后可通过扫描商品条码完成报单」。
 *
 * 这一版的核心不是"调一次 wx.scanCode"，而是三件**做错了不会报错**的事：
 *
 *   A. 图标必须在搜索框**内部**（不是框旁边），且不引图片资源 —— 漏传一张图就是白方块，
 *      而这是报单页唯一的扫码入口。
 *   B. 取码：二维码内容常是 URL（`https://x/p/6934665094026`），整串去搜**必然空**，
 *      必须抽出条码；抽不出要说"这不是商品条码"，不能拿整串去搜出一个假"不在清单里"。
 *   C. 关联方式：扫码**不新建任何数据**，只定位行 + 光标进数量框；
 *      绝不写 `_qtyMap`（扫一次把已填数冲掉 = 静默数据损失）。
 *
 * 还有两条"看起来无关、实际决定对错"的：
 *   D. 必须先清品牌/常报筛选（AND 叠加 ⇒ 不清就是假"不在本期清单里"）。
 *   E. 必须逐行比对条码，不能取第一行（期次分支 order_by 是模板行序，不是相关度）。
 *
 * 每条判据都配坏样本自证 —— 只写"源码里有这行"是空白支票。
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const PROJ = path.resolve(ROOT, '..')
const MINI = path.join(PROJ, 'forecast-order-miniprogram-20260812T023419087Z/miniprogram')
const FILL = path.join(MINI, 'pages/fill/fill.js')
const WXML = path.join(MINI, 'pages/fill/fill.wxml')
const WXSS = path.join(MINI, 'pages/fill/fill.wxss')

let failed = 0
const ok = (cond, label, extra = '') => {
  if (cond) console.log('  ✅ ' + label + (extra ? ' ' + extra : ''))
  else { console.log('  ❌ ' + label + (extra ? ' ' + extra : '')); failed++ }
}

const js = fs.readFileSync(FILL, 'utf8')
const wxml = fs.readFileSync(WXML, 'utf8').replace(/<!--[\s\S]*?-->/g, '')
const wxss = fs.readFileSync(WXSS, 'utf8')

const ruleOf = (sel) =>
  (wxss.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^{]*\\{[^}]*\\}', 'g')) || []).join('\n')

/* 取源码里一段（从 start 到 end 第一次出现处）。用**函数体**而不是全文判定：
   同样的字段在别的函数里也有，全文断言会被别处救成假绿（v757 踩过）。 */
function sliceOf(src, start, end, span = 5000) {
  const i = src.indexOf(start)
  if (i < 0) return ''
  const j = end ? src.indexOf(end, i + start.length) : -1
  return j > i ? src.slice(i, j) : src.slice(i, i + span)
}
const scanFn = sliceOf(js, 'async _onScanResult(res) {', '  onScanAct() {')

/* ───────────────────────────────────────────────────────────────────────── */
console.log('A. 扫码入口：在搜索框**内部**、纯 CSS 画、不依赖图片')
{
  const box = sliceOf(wxml, '<view class="search-box">', '<!-- v761：扫码结果条', 3000)
  ok(box.length > 100, '模板里有 .search-box 容器')
  ok(/<input[^>]*class="search-ipt"/.test(box), '输入框在 .search-box 内')
  ok(/class="scan-btn"/.test(box), '扫码按钮在 .search-box 内（用户要求"搜索框内"）')

  // 坏样本：把按钮从盒子里摘出去 ⇒ 上面那条切片断言必须同时失效
  const boxNoBtn = box.replace(/<view class="scan-btn"[\s\S]*?<\/view>\s*<\/view>/, '</view>')
  ok(/class="scan-btn"/.test(box) && !/class="scan-btn"/.test(boxNoBtn),
    '坏样本自证：按钮不在盒子里时该断言查不到它')

  ok((wxml.match(/class="scan-btn"/g) || []).length === 1, '扫码按钮恰好 1 个')
  ok(/bindtap="onScanTap"/.test(wxml), '扫码按钮绑 onScanTap')

  // 图标 = 四角 + 中线，全 CSS；这段里出现 <image> 就是"漏传一张图 = 白方块"的复发
  const icIdx = wxml.indexOf('class="scan-ic"')
  const icSeg = icIdx > 0 ? wxml.slice(icIdx, icIdx + 600) : ''
  ok((icSeg.match(/class="scan-f scan-/g) || []).length === 4, '四角各一个 .scan-f', `实测 ${(icSeg.match(/class="scan-f scan-/g) || []).length}`)
  ok(/class="scan-line"/.test(icSeg), '有中线（扫码取景框的标志性横线）')
  ok(!/<image/.test(icSeg), '这段里没有 <image> —— 图标不依赖图片资源')

  const iconCss = ruleOf('.scan-f') + ruleOf('.scan-line')
  ok(/var\(--brand\)/.test(iconCss), '图标描边取 var(--brand)（品牌色不许出现第二个字面量）')
  ok(!/#[0-9a-f]{6}/i.test(iconCss), '图标 CSS 里没有品牌色字面量')
  ok(/\.scan-btn\{[^}]*width:84rpx/.test(wxss) && /\.scan-btn\{[^}]*height:88rpx/.test(wxss),
    '触控区 ≥ 84×88rpx（小触控区在真机上点不准）')
}

/* ───────────────────────────────────────────────────────────────────────── */
console.log('')
console.log('B. 调起扫码：一维码 + 二维码、允许相册、取消不打扰')
{
  ok(/wx\.scanCode\(\{/.test(js), '调的是 wx.scanCode')
  const seg = sliceOf(js, 'onScanTap() {', '  /* 从扫码结果里抽商品条码', 800)
  ok(/scanType:\s*\[\s*'barCode'\s*,\s*'qrCode'\s*\]/.test(seg), "scanType 同时含 barCode 与 qrCode")
  ok(/onlyFromCamera:\s*false/.test(seg), 'onlyFromCamera:false（允许相册，少一条路就是随机失效）')

  const failSeg = sliceOf(seg, 'fail:', '})', 200)
  ok(failSeg.length > 0 && !/showToast|showModal/.test(failSeg),
    'fail 分支不弹任何东西 —— 用户取消是正常动作，弹"扫码失败"是冤枉他')

  // 坏样本：只开二维码 ⇒ 扫一维条码直接失败（而商品条码全是 EAN-13）
  const onlyQr = seg.replace("['barCode', 'qrCode']", "['qrCode']")
  ok(!/scanType:\s*\[\s*'barCode'\s*,\s*'qrCode'\s*\]/.test(onlyQr), '坏样本自证：只开 qrCode 必须判否')
}

/* ───────────────────────────────────────────────────────────────────────── */
console.log('')
console.log('C. 取码：URL/带前缀的二维码内容必须抽出条码，抽不出不许硬搜')
{
  const pickFn = sliceOf(js, '_pickCode(raw) {', '  /* 扫码结果 → 搜索 → 定位', 900)
  ok(pickFn.length > 100, '_pickCode 存在')
  ok((js.match(/_pickCode\(/g) || []).length >= 2, '_pickCode 被真正调用（不只是定义）')
  ok(/\\d\{8,14\}/.test(pickFn), '非纯数字时在串里抽 8–14 位连续数字段')
  ok(/length === 13/.test(pickFn), '优先 13 位（本期条码全是 EAN-13）')

  // 行为验证：把函数体拿出来真跑一遍（不是靠"源码里有这行"）
  const body = pickFn.slice(pickFn.indexOf('{') + 1, pickFn.lastIndexOf('}'))
  const mk = (src) => new Function('raw', body.replace(/return\s+seg\.find[^\n]*\n?/, 'return seg.find(x => x.length === 13) || seg.sort((a, b) => b.length - a.length)[0]\n'))
  let pick
  try { pick = mk(pickFn) } catch (e) { pick = null }
  ok(!!pick, '_pickCode 函数体可独立执行（语法 + 依赖自洽）')
  if (pick) {
    ok(pick('6934665094026') === '6934665094026', '纯数字 13 位原样返回')
    ok(pick('https://x.hergent.cn/p/6934665094026') === '6934665094026', 'URL 里抽出 13 位条码')
    ok(pick('条码:6934665094026,批次:2026') === '6934665094026', '带中文前缀/后缀也能抽出')
    ok(pick('HELLO-WORLD') === '', '抽不出时返回空串（不许把整串拿去搜）')
    ok(pick('123') === '', '太短（<8 位）不认，避免"12"这种搜出一片')
  }
  // 坏样本：把"抽不出返回空"改成"返回原串" ⇒ 会搜出一个假的"不在本期清单里"
  const badRaw = pickFn.replace("if (!seg.length) return ''", "if (!seg.length) return s")
  ok(/if \(!seg\.length\) return ''/.test(pickFn) && !/if \(!seg\.length\) return ''/.test(badRaw),
    '坏样本自证：改成回退原串必须判否')
}

/* ───────────────────────────────────────────────────────────────────────── */
console.log('')
console.log('D. 关联方式：不新建数据、不覆盖已填数量')
{
  ok(scanFn.length > 200, '定位到 _onScanResult 函数体', `${scanFn.length} 字符`)
  ok(!/setQty\s*\(/.test(scanFn), '扫码链路**不调用 setQty** —— 只定位不填数')
  ok(!/_qtyMap\s*\[[^\]]*\]\s*=(?!=)/.test(scanFn), '不写 _qtyMap —— 扫一次把已填数冲掉是静默数据损失')
  ok(!/batchSetQty|Object\.assign\(this\._qtyMap/.test(scanFn), '没有批量写数量的旁路')

  // 坏样本：加一句 setQty(...) 必须被判否
  const badWrite = scanFn.replace("this.setData({ scanRes: patch }", "this.setQty(target.id, 1); this.setData({ scanRes: patch }")
  ok(!/setQty\s*\(/.test(scanFn) && /setQty\s*\(/.test(badWrite), '坏样本自证：插入 setQty 必须判否')
}

/* ───────────────────────────────────────────────────────────────────────── */
console.log('')
console.log('E. 先清筛选再读表（不清 = 假"不在本期清单里"）')
{
  const iClear = scanFn.indexOf("brandSel: '', freqOn: false")
  const iLoad = scanFn.indexOf('loadProducts(code, false)')
  ok(iClear > 0, '扫码前把 brandSel / freqOn 一起清掉')
  ok(iLoad > iClear, '清筛选在 loadProducts **之前**', `clear@${iClear} load@${iLoad}`)
  ok(/kw:\s*code/.test(scanFn), '扫到的码写进搜索框（用户要看得见"刚扫的是哪个"）')

  // 坏样本：把 loadProducts 提到清筛选之前 —— 请求会带着旧品牌，立刻空集
  const badOrder = scanFn.replace(/this\.setData\(\{\s*kw: code[\s\S]*?\}\)\s*\n\s*const loaded = await this\.loadProducts\(code, false\)/,
    'const loaded = await this.loadProducts(code, false)\n' + "    this.setData({ kw: code, brandSel: '', freqOn: false })")
  const badLoadPos = badOrder.indexOf('loadProducts(code, false)')
  const badClearPos = badOrder.indexOf("brandSel: '', freqOn: false")
  ok(!!badOrder && badLoadPos >= 0 && badClearPos >= 0 && badLoadPos < badClearPos,
    '坏样本自证：顺序反过来后"清筛选"确实落在请求之后（可被判红）')
}

/* ───────────────────────────────────────────────────────────────────────── */
console.log('')
console.log('F. 逐行比对条码；精确命中可能不止一个（本期实测 6 组同码）')
{
  ok(/const hits = rows\.filter\(r => String\(r\.barcode \|\| ''\) === code\)/.test(scanFn),
    '在返回行里按 barcode === code **筛出全部**精确命中（不是取第一个）')
  ok(/let target = hits\[0\] \|\| null/.test(scanFn), '定位的是精确命中的第一行')
  const iFind = scanFn.indexOf('const hits = ')
  const iUse = scanFn.indexOf('target = rows[0]')
  ok(iFind > 0 && iUse > iFind, '先精确查找，查不到才退回第一行（并转"可能是整箱码"）')

  // 坏样本：退回 rows.find(单条) —— 同码时静默定位到另一渠道那一行
  const badFirst = scanFn.replace(
    /const hits = rows\.filter\(r => String\(r\.barcode \|\| ''\) === code\)/, "const hits = [rows.find(r => String(r.barcode || '') === code)].filter(Boolean)")
  ok(!/const hits = rows\.filter/.test(badFirst), '坏样本自证：改成只取第一条必须判否')

  /* 🔴 同码多行是本期的**常态**而不是边缘：蒙牛红枣酸牛奶1000g*10桶 与 同名（福宝下单）、
     果纤维芭乐菠萝 200g*10瓶*6组 与 200g*24瓶 —— 同一实物不同渠道/装箱，条码天然相同。
     只"定位第 1 个"而不点名，数量就填进另一个渠道那一行，且零报错。 */
  ok(/kind = 'dup'/.test(scanFn), '精确命中 >1 时单独走 dup 分支')
  ok(/others = hits\.slice\(1, 3\)\.map\(r => r\.name\)/.test(scanFn), '把"同条码还有哪几个"取出来（最多 2 个）')
  ok(/others, othersN: hits\.length - 1/.test(scanFn), '同码总数也传下去（超过 2 个时说"等 N 个"）')
  ok(/rows\.length === 1 \? 'box' : 'fuzzy'/.test(scanFn),
    '主条码全对不上时区分「单个（整箱码）」与「多个（片段命中）」')

  const badDup = scanFn.replace(/others = hits\.slice\(1, 3\)\.map\(r => r\.name\)/, 'others = []')
  ok(!/others = hits\.slice\(1, 3\)/.test(badDup), '坏样本自证：不点名同码其它行必须判否')
}

/* ───────────────────────────────────────────────────────────────────────── */
console.log('')
console.log('G. 定位复用 _scrollTo（第二份滚动实现必然漂移）')
{
  ok(/this\._scrollTo\(target\.id\)/.test(scanFn), '定位走 _scrollTo')
  ok(!/wx\.pageScrollTo/.test(scanFn), '扫码链路里没有第二份滚动实现')
  ok((js.match(/^  _scrollTo\(id\) \{/m) || []).length === 1, '_scrollTo 全文件只有 1 处定义')

  // 坏样本：换自带 scrollTo ⇒ 高亮/聚焦/键盘时序那套（v421 修过的）会全部失效
  const badScroll = scanFn.replace('this._scrollTo(target.id)', 'wx.pageScrollTo({ scrollTop: 0 })')
  ok(!/wx\.pageScrollTo/.test(scanFn) && /wx\.pageScrollTo/.test(badScroll), '坏样本自证：自写滚动必须判否')

  ok(/this\.setData\(\{ scanRes: patch \}, \(\) => \{/.test(scanFn),
    '先 setData 再滚（列表没渲染完就查 #prod-<id>，查不到且不报错）')
}

/* ───────────────────────────────────────────────────────────────────────── */
console.log('')
console.log('H. 结果条：全部文案集中在 _scanTip，模板不做分支')
{
  const tipFn = sliceOf(js, '_scanTip(kind, o) {', '\n  },\n', 2600)
  ok(tipFn.length > 200, '_scanTip 存在')
  const kinds = ['bad', 'notfound', 'error', 'ok', 'box', 'dup']
  for (const k of kinds) ok(new RegExp(`kind === '${k}'`).test(tipFn), `有 ${k} 分支`)
  ok(/匹配到 ' \+ d\.n/.test(tipFn), 'fuzzy（片段命中多个）有独立文案')
  ok(/这个条码本期对应 ' \+ d\.n/.test(tipFn), 'dup 的提示说"本期对应 N 个商品"（不是"匹配到"）')
  ok(/同条码还有「/.test(tipFn) && /请核对名称再填/.test(tipFn),
    'dup 把"同条码还有哪个"直接写出来 + 要求核对名称（只说定位第 1 个，用户没有理由怀疑）')

  /* 一屏上不能出现"说了但没动作"的提示：notfound 必须给出口 */
  ok(/actKind: 'all'/.test(tipFn), 'notfound 给「看全部」出口（不给出口 = 让人干瞪眼）')
  ok(/actKind: 'scan'/.test(tipFn), '其余分支给「继续扫」')

  ok((wxml.match(/wx:if="\{\{scanRes\}\}"/g) || []).length === 1, '结果条只有**一个** wx:if 入口')
  ok(/\{\{scanRes\.tip\}\}/.test(wxml) && /\{\{scanRes\.sub\}\}/.test(wxml) && /\{\{scanRes\.act\}\}/.test(wxml),
    '模板只负责摆 tip/sub/act 三个占位（拼文案在 js）')
  ok(!/wx:if="\{\{scanRes\.kind/.test(wxml), '模板里没有按 kind 分叉的 wx:if（五种组合摊在 wxml 必漏一种）')
}

/* ───────────────────────────────────────────────────────────────────────── */
console.log('')
console.log('I. 配色：三档语义各自成立，不带旧亮青')
{
  const css = ruleOf('.scan-res')
  ok(/#ECF4F3/.test(css), '已定位态用品牌浅染实色 #ECF4F3（品牌色带 alpha 就不是品牌色）')
  ok(/\.scan-res\.is-box\{[^}]*#fff7ed/.test(wxss), '整箱/多匹配态用琥珀（提示风险，不是"成功"）')
  ok(/\.scan-res\.is-nf\{[^}]*#f5f5f7/.test(wxss), '未定位态用中性灰（品牌绿会被读成"成功了"）')
  const all = ruleOf('.scan-res') + ruleOf('.scan-res.is-box') + ruleOf('.scan-res.is-nf') +
    ruleOf('.scan-res-t') + ruleOf('.scan-res-sub') + ruleOf('.scan-res-act')
  ok(!/#06b6d4|#ecfeff|#a5f3fc/i.test(all), '不含旧亮青（#06b6d4/#ecfeff/#a5f3fc）—— 同一语义位置不许两个色值')
  ok(/\.scan-res-act\{[^}]*var\(--brand\)/.test(wxss), '主按钮文字取 var(--brand)')
}

/* ───────────────────────────────────────────────────────────────────────── */
console.log('')
console.log('J. 状态清理：换关键词/换筛选/换期次/换门店都要收起结果条')
{
  const n = (js.match(/scanRes:\s*null/g) || []).length
  ok(n >= 7, 'scanRes 的清理点 ≥ 7 处（输入/清空/清筛/品牌/常报/期次/门店）', `实测 ${n}`)
  for (const fn of ['onSearch(e) {', 'clearSearch() {', 'pickBrand(e) {', 'toggleFreq() {', 'clearFilters() {']) {
    const seg = sliceOf(js, fn, '\n  },', 800)
    ok(/scanRes:\s*null/.test(seg), fn.replace(' {', '') + ' 里清 scanRes')
  }
  const per = sliceOf(js, 'onPeriodChange(e) {', '  /* M10', 4000)
  ok(/scanRes:\s*null/.test(per), '切期次清 scanRes（结果条说的是上一期的商品）')
  const st = sliceOf(js, '_switchStore(i) {', '  /* M10', 3000)
  ok(/scanRes:\s*null/.test(st), '切门店清 scanRes')
}

/* ───────────────────────────────────────────────────────────────────────── */
console.log('')
console.log('K. 取数失败不许伪装成"不在清单里"')
{
  const loadFn = js.slice(js.indexOf('async loadProducts(keyword, append) {'), js.indexOf('  /* P2-5: 错误视图'))
  ok(loadFn.length > 1000, '定位到 loadProducts 函数体', `${loadFn.length} 字符`)
  ok(/return true/.test(loadFn), 'loadProducts 成功分支 return true')
  ok(/return false/.test(loadFn), 'loadProducts 失败分支 return false')
  ok(/if \(loaded !== true\)/.test(scanFn) && /_scanTip\('error'/.test(scanFn),
    '扫码链路单独处理取数失败（否则旧列表会被比对成假结论）')

  const badErr = scanFn.replace("if (loaded !== true) {", 'if (false) {')
  ok(!/if \(loaded !== true\)/.test(badErr), '坏样本自证：去掉失败分支必须判否')
}

console.log('')
if (failed) { console.log(`❌ 失败 ${failed} 项`); process.exit(1) }
console.log('✓ v761 扫码报单契约全部通过')
