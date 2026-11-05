/* ㊽ v771 契约（v780 改口径）：小程序「我的预报提交」记录行两处日期文案。
 *
 * 用户口径（v771 / 2026-11-05）：「在每条预报提交记录现有『报单日期』旁增加对应的『到货日期』
 *   展示。保持原有报单日期、页面布局、交互和现有功能不变；到货日期的日期格式、间距和样式
 *   与报单日期保持一致。当到货日期为空或暂无数据时，界面应保持整洁且不报错。」
 *
 * 🔴 v780（2026-11-05）**用户第二次改口径**：「报单日期前面加上『报单』两字，『到货日期』
 *   改为『到货』」。⇒ 记录行两个日期都只留两个字的短标签：
 *       `报单 2026-11-05` / `到货 2026-11-07`。
 *   ⚠️ 本条**推翻了 v771 的「标签统一为『到货日期』」**，所以旧坏样本「标签改成『到货』」
 *      必须反转成「退回『到货日期』」—— 否则护栏会拿旧口径把正确修改判错（v769 同族教训：
 *      口径变了而判据没跟着变，护栏就从保护变成阻力）。
 *   ⚠️ 报单侧**原来没有标签**（裸日期），加「报单」后有汉字断行点 ⇒ 必须 nowrap（v770）；
 *      两端都 nowrap 后日期组不可压缩 ⇒ 另加 flex-wrap 兜底，防门店名很长时挤出卡片。
 *
 * 🔴 为什么字段必须由**服务端**给：records 来自 `forecast_submissions`（只有 period_id /
 *    order_date），小程序能调的 `/open-periods` 只返回 status='open' 的期次 ⇒ 生产 24 期里
 *    23 期是 closed，前端自己按 period_id 拼会大面积空白。故后端批量补 `arrival_date`。
 *
 * 🔴 四层判据缺一即假生效（本项目反复栽的族）：
 *    A 后端真的补了键，且用 `SELECT *` 按列名取（不许 SQL 硬写新列 —— v765c 的
 *      `order_end_date` 缺列教训：硬引用会让整段被 except 吞成「全放行」或列表 500）。
 *    B WXML 确实渲染了标签逐字为「到货日期」的一段，且只在有值时渲染（空值不留孤标签）。
 *    C mine.js 用 `...r` 展开透传（改白名单会静默丢字段）+ 空值归一；纯函数真跑 9 种形态。
 *    D 样式复用 `.rec-date` 同字号同色、nowrap 防中文逐字竖排（v770）。
 *
 * 判据写法沿用 `miniprogram-recall-gate`：**每个坏样本都必须能判否**，
 * 否则护栏只是「写了」而不是「被执行了」。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PROJ = path.resolve(ROOT, '..')
const MINI = path.join(PROJ, 'forecast-order-miniprogram-20260812T023419087Z/miniprogram')
const WXML = path.join(MINI, 'pages/mine/mine.wxml')
const MJS = path.join(MINI, 'pages/mine/mine.js')
const WXSS = path.join(MINI, 'pages/mine/mine.wxss')
const UTIL = path.join(MINI, 'utils/arrivalDate.js')
const ERP = path.join(PROJ, '.workbuddy/remote-erp/erp_db.py')
const ROUTE = path.join(PROJ, '.workbuddy/remote-erp/routers/forecast_submissions.py')

const read = (p) => fs.readFileSync(p, 'utf8')
/* 剥掉注释再判静态结构：本文件与源码里逐字抄了反例，不剥会自撞（v769 踩过）。 */
const strip = (s, re) => s.replace(re, (m) => m.replace(/[^\n]/g, ' '))
const stripHtml = (s) => strip(s, /<!--[\s\S]*?-->/g)
const stripPy = (s) => s.split('\n').map((l) => l.replace(/^\s*#.*$/, '')).join('\n')

/* 把同一组判据跑在任意一份（可能被改坏的）源码上 —— 坏样本自证靠它。 */
function probe({ wxml, mjs, wxss, erp, route }) {
  const w = stripHtml(wxml)
  const j = strip(mjs, /\/\*[\s\S]*?\*\//g).replace(/^\s*\/\/.*$/gm, '')
  const x = strip(wxss, /\/\*[\s\S]*?\*\//g)
  const e = stripPy(erp)

  const iStore = w.indexOf('<text class="rec-store"')
  const iDates = w.indexOf('<view class="rec-dates"')
  /* v780：报单段多了 rec-order 类，锚点跟着改 —— 旧锚点 indexOf('<text class="rec-date">')
     会恒返回 -1，让「三段顺序」这条判据恒假（同时把「移出日期组」坏样本也带成检不出）。 */
  const iOrder = w.indexOf('class="rec-date rec-order"')
  const iArr = w.indexOf('class="rec-date rec-arrival"')
  const iStatus = w.indexOf('<text class="rec-status')

  const c = {}
  // ── A 后端：补键 + 不硬写新列 ────────────────────────────────
  c['后端逐条写 d["arrival_date"]'] = /d\["arrival_date"\]\s*=\s*_parr\.get\(/.test(e)
  c['后端批量查期次且用 SELECT *'] = /SELECT \* FROM forecast_periods WHERE id IN/.test(e)
  c['后端 SQL 不硬引用 arrival_date 列'] = !/SELECT[^;]*\bCOALESCE\s*\(\s*arrival_date/i.test(e)
  c['后端缺列/异常时 fail-safe 为空'] = /except Exception:\s*\n\s*_parr = \{\}/.test(e)
  // /my 路由必须原样透传 records（改成字段白名单会静默丢掉新键）
  const i0 = route.indexOf('def my_submissions')
  const i1 = route.indexOf('return {"ok": True, "records": records}')
  c['/my 路由原样透传 records'] = i0 >= 0 && i1 > i0 &&
    /return \{"ok": True, "records": records\}/.test(route.slice(i0, i1 + 60))

  // ── B WXML：标签统一 / 有值才渲染 / 报单日期原位 ─────────────
  c['rec-hd 仍是「门店｜日期组｜状态」三段且顺序不变'] =
    iStore >= 0 && iDates > iStore && iOrder > iDates && iArr > iOrder && iStatus > iArr
  c['恰好 1 个 .rec-dates 容器'] = (w.match(/<view class="rec-dates"/g) || []).length === 1
  c['报单日期逐字是「报单 {{item.order_date}}」（v780 补短标签）'] =
    (w.match(/<text class="rec-date rec-order">报单 \{\{item\.order_date\}\}<\/text>/g) || []).length === 1 &&
    !/<text class="rec-date">\{\{item\.order_date\}\}<\/text>/.test(w)
  c['到货侧恰好 1 段且标签逐字为「到货」（不是「到货日期」）'] =
    (w.match(/到货 \{\{item\.arrivalDate\}\}<\/text>/g) || []).length === 1 &&
    !/到货日期 \{\{item\.arrivalDate\}\}|预计到货|到货日 \{\{item/.test(w)
  c['到货日期段复用 .rec-date（同字号同色）'] =
    (w.match(/class="rec-date rec-arrival"/g) || []).length === 1
  c['空值整段不渲染（wx:if 绑 arrivalDate）'] =
    /class="rec-date rec-arrival" wx:if="\{\{item\.arrivalDate\}\}"/.test(w)
  c['日期原样输出、前端不再格式化'] =
    /到货 \{\{item\.arrivalDate\}\}/.test(w) && !/\{\{item\.arrivalDate[^}]*(slice|substr|replace|split)/.test(w) &&
    /报单 \{\{item\.order_date\}\}/.test(w) && !/\{\{item\.order_date[^}]*(slice|substr|replace|split)/.test(w)

  // ── C mine.js：透传 + 归一 ────────────────────────────────────
  c['mine.js 引入归一函数'] = /require\('\.\.\/\.\.\/utils\/arrivalDate'\)/.test(j)
  c['records map 仍是 ...r 展开（不丢既有字段）'] = /\.map\(\s*r\s*=>\s*\(\{\s*\.\.\.r/.test(j)
  c['records map 产出 arrivalDate'] = /arrivalDate:\s*normalizeArrivalDate\(r\.arrival_date\)/.test(j)
  c['statusText 映射未被动过'] = /statusText:\s*STATUS_TEXT\[r\.status\] \|\| r\.status \|\| ''/.test(j)

  // ── D WXSS：同款间距 + 防竖排 ────────────────────────────────
  const arrRule = (x.match(/\.rec-arrival\s*\{[^}]*\}/) || [''])[0]
  c['.rec-date 原规则未被改动'] = /\.rec-date\{font-size:24rpx;color:#86868b\}/.test(x)
  c['.rec-dates 为 flex 容器'] = /\.rec-dates\{[^}]*display:flex/.test(x)
  c['到货日期间距 12rpx（与 .rec-status 同节奏）'] = /margin-left:12rpx/.test(arrRule)
  c['中文标签 nowrap 防逐字竖排（v770）'] = /white-space:nowrap/.test(arrRule)
  /* v780：报单侧也变成「汉字 + 日期」，同一条断行风险 ⇒ 同一条判据。 */
  const ordRule = (x.match(/\.rec-order\s*\{[^}]*\}/) || [''])[0]
  c['报单侧 nowrap 防逐字竖排（v780）'] = /white-space:nowrap/.test(ordRule)
  /* 两端 nowrap ⇒ 日期组不可压缩，窄屏 + 长门店名会把「到货」挤出卡片（实测 17px）。
     兜底必须是「整段掉第二行」而不是被裁掉。 */
  c['日期组有 flex-wrap 兜底（v780）'] = /\.rec-dates\{[^}]*flex-wrap:wrap/.test(x)
  return c
}

let failed = 0
const ok = (cond, label, extra = '') => {
  if (cond) console.log('  ✅ ' + label + (extra ? ' ' + extra : ''))
  else { console.log('  ❌ ' + label + (extra ? ' ' + extra : '')); failed++ }
}

const SRC = { wxml: read(WXML), mjs: read(MJS), wxss: read(WXSS), erp: read(ERP), route: read(ROUTE) }
const base = probe(SRC)

console.log('A–D. 源码四层判据（对照组：原样必须全绿）')
for (const [k, v] of Object.entries(base)) ok(v, k)
ok(Object.values(base).every(Boolean), '对照组全绿', `实测 ${Object.values(base).filter(Boolean).length}/${Object.values(base).length}`)

console.log('\nE. 归一纯函数真跑（有值 / 空值 / 缺键 / 脏字面量）')
/* 小程序 util 是 CommonJS；用 new Function 加载，绕开上级 package.json 的 type 设定，
   也避免 `wx` 全局缺失导致 require 失败。 */
function loadUtil(code) {
  const mod = { exports: {} }
  new Function('module', 'exports', code + '\nreturn module.exports')(mod, mod.exports)
  return mod.exports.normalizeArrivalDate
}
const norm = loadUtil(read(UTIL))
const cases = [
  ['2026-11-10', '2026-11-10', '有值原样'],
  [' 2026-11-10 ', '2026-11-10', '前后空白'],
  ['', '', '空串'],
  ['   ', '', '全空白'],
  [undefined, '', '键不存在（旧版后端）'],
  [null, '', 'null'],
  [0, '', '数字 0'],
  [{}, '', '对象'],
  ['None', '', "脏字面量 'None'"],
  ['null', '', "脏字面量 'null'"],
  ['undefined', '', "脏字面量 'undefined'"],
  ['0000-00-00', '', '零值日期'],
]
let normBad = 0
for (const [input, want, label] of cases) {
  let got
  try { got = norm(input) } catch (e) { got = 'THREW: ' + e.message }
  if (got !== want) { console.log('  ❌ ' + label + ` ⇒ ${JSON.stringify(got)}`); normBad++ }
}
ok(normBad === 0, `归一函数 ${cases.length} 种形态全通过（有值不格式化，空值/缺键不抛错）`)
ok(norm('2026-11-10') === '2026-11-10' && !/\d+月\d+日/.test(norm('2026-11-10')),
  '不做二次格式化 ⇒ 与报单日期同为 YYYY-MM-DD')

console.log('\nF. 记录映射仿真：三态呈现 + 原有字段/功能不受影响')
{
  const mapLine = SRC.mjs.split('\n').find((l) => l.includes('const records =') && l.includes('.map(')) || ''
  ok(mapLine.length > 0, '从 mine.js 抽到真实的 records map 行')
  let rows
  try {
    rows = new Function('d', 'STATUS_TEXT', 'normalizeArrivalDate',
      mapLine.trim() + '\nreturn records')(
      { records: [
        { id: 2566, status: 'pending', order_date: '2026-11-05', period_id: 43, arrival_date: '2026-11-10', can_recall: true, can_delete: true, items: [{ quantity: 3 }] },
        { id: 2560, status: 'recalled', order_date: '2026-11-03', period_id: 42, arrival_date: '', can_recall: false },
        { id: 2550, status: 'approved', order_date: '2026-11-01', period_id: 41 },
      ] },
      { pending: '已提交', approved: '已定稿', rejected: '已驳回', recalled: '已撤回' },
      norm
    )
  } catch (e) { console.log('  ❌ map 仿真抛错：' + e.message); failed++ }
  if (rows) {
    // wx:if="{{item.arrivalDate}}" 的等价语义：非空串才渲染整段
    const shown = (r) => !!r.arrivalDate
    ok(rows.length === 3, '三条记录都能映射、不抛错')
    ok(shown(rows[0]) && rows[0].arrivalDate === '2026-11-10', '有值 ⇒ 渲染「到货 2026-11-10」')
    ok(!shown(rows[1]) && !shown(rows[2]), '空值 / 缺键 ⇒ 整段不渲染（不留孤标签，界面整洁）')
    ok(rows[0].statusText === '已提交' && rows[1].statusText === '已撤回', 'statusText 原映射未变')
    ok(rows[0].can_recall === true && rows[0].can_delete === true && rows[0].items.length === 1,
      '撤回/删除闸门与明细等既有字段原样透传（现有功能不受影响）')
    ok(rows[0].order_date === '2026-11-05', '报单日期原值未变')
  }
}

console.log('\nG. 坏样本自证（每个都必须至少判否一条，证明护栏不是空转）')
const bads = [
  ['删掉 wx:if（空值会留下孤零零的标签）', 'wxml', (s) => s.replace(' wx:if="{{item.arrivalDate}}"', '')],
  ['到货侧退回旧口径「到货日期」（v780 已要求改短）', 'wxml', (s) => s.replace('到货 {{item.arrivalDate}}', '到货日期 {{item.arrivalDate}}')],
  ['报单侧漏掉「报单」二字（退回裸日期）', 'wxml', (s) => s.replace(
    '<text class="rec-date rec-order">报单 {{item.order_date}}</text>',
    '<text class="rec-date">{{item.order_date}}</text>')],
  ['wxss 删掉 .rec-order 的 nowrap（报单与日期折成两行）', 'wxss', (s) => s.replace('.rec-order{white-space:nowrap}', '')],
  ['wxss 删掉 flex-wrap 兜底（长门店名把到货挤出卡片）', 'wxss', (s) => s.replace(';flex-wrap:wrap', '')],
  ['把报单日期移出日期组（布局被重排）', 'wxml', (s) => s.replace(
    '<view class="rec-dates">\n              <text class="rec-date rec-order">报单 {{item.order_date}}</text>',
    '<text class="rec-date rec-order">报单 {{item.order_date}}</text>\n            <view class="rec-dates">')],
  ['到货日期改用服务端原字段（脏值会显示出来）', 'wxml', (s) => s.replace(/\{\{item\.arrivalDate\}\}/g, '{{item.arrival_date}}')],
  ['mine.js 改成字段白名单（静默丢字段）', 'mjs', (s) => s.replace(/const records = \(d\.records \|\| \[\]\)\.map\(r => \(\{ \.\.\.r,/, 'const records = (d.records || []).map(r => ({ id: r.id,')],
  ['mine.js 不做归一（undefined 会渲染）', 'mjs', (s) => s.replace('normalizeArrivalDate(r.arrival_date)', 'r.arrival_date')],
  ['wxss 删掉 nowrap（中文标签逐字竖排）', 'wxss', (s) => s.replace('margin-left:12rpx;white-space:nowrap', 'margin-left:12rpx')],
  ['wxss 改掉报单日期字号颜色（样式不再一致）', 'wxss', (s) => s.replace('.rec-date{font-size:24rpx;color:#86868b}', '.rec-date{font-size:28rpx;color:#333}')],
  ['后端不补字段（前端永远拿不到）', 'erp', (s) => s.replace('d["arrival_date"] = _parr.get(_pid, "")', 'pass')],
  ['后端 SQL 硬写新列（缺列租户会 500）', 'erp', (s) => s.replace('"SELECT * FROM forecast_periods WHERE id IN (%s)"', '"SELECT id, COALESCE(arrival_date,\'\') FROM forecast_periods WHERE id IN (%s)"')],
]
for (const [label, key, mutate] of bads) {
  const src = { ...SRC, [key]: mutate(SRC[key]) }
  const changed = src[key] !== SRC[key]
  const p = probe(src)
  const reds = Object.entries(p).filter(([k, v]) => base[k] && !v).map(([k]) => k)
  ok(changed && reds.length > 0, label, reds.length ? `判否 ${reds.length} 条（${reds[0]}）` : '⚠️ 未检出')
}

console.log('\n' + (failed === 0 ? 'RESULT: ALL PASS' : `RESULT: FAILED (${failed})`))
process.exit(failed === 0 ? 0 : 1)
