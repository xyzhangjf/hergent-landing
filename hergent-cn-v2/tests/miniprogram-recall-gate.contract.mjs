/* v755 契约：小程序「我的提交」撤回按钮必须由**服务端布尔**决定是否出现。
 *
 * 报障原话（2026-11-04）：「员工反馈在小程序提交的订单，点击撤回提示：仅本人和管理员能撤回，
 *                          但点撤回键的就是员工本人」
 *
 * 根因不是权限判错，是**按钮亮错了人**：
 *   「我的提交」列表范围 = 「我报的 OR 我负责门店报的」（v224）⇒ 员工的列表里会混进
 *   老板/督导**导入或代改**的 pending 单。而撤回按钮当时只判 `item.status === 'pending'`，
 *   完全不看归属 ⇒ 员工点了别人的单，被后端「仅本人或管理员可撤回」挡回，
 *   而他坚信点的是自己的单。
 *   （删除按钮早在 v259 就有 `can_delete` 这道服务端闸门，撤回漏了同一个。）
 *
 * 🔴 为什么闸门必须在**服务端**、不能前端自己判：
 *   前端只能看到「这一项在我的列表里」，看不到「我有没有权撤它」——后者还要看角色
 *   和期次是否已截止。让前端猜就是再造一次越权面。
 *
 * 判据（连续四条缺一条就等于没修）：
 *   A. mine.wxml 撤回按钮 `wx:if="{{item.can_recall}}"`（不再用 status 判）。
 *   B. 坏样本：把 wx:if 改回 `item.status === 'pending'` 必须判否（证明 A 真在起作用）。
 *   C. mine.js 列表 map 必须 `...r` 展开（字段白名单会把 can_recall 丢掉 ⇒ WXML 恒 undefined
 *      ⇒ 按钮永远不亮，属于"修成假阴性"，比原 bug 更难发现）。
 *   D. 后端 `forecast_submission_list` 真的算出了 `can_recall`，且 `/my` 路由把 `role` 传了下去
 *      （不传 role ⇒ 管理员永远看不到撤回按钮 ⇒ 变成另一个方向的假入口）。
 *      后端是本地快照（`.workbuddy/remote-erp/`），缺失时 SKIP 并**明确说出来**，不留假绿。
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const PROJ = path.resolve(ROOT, '..')
const MINI = path.join(PROJ, 'forecast-order-miniprogram-20260812T023419087Z/miniprogram')
const WXML = path.join(MINI, 'pages/mine/mine.wxml')
const MJS = path.join(MINI, 'pages/mine/mine.js')
const FILL = path.join(MINI, 'pages/fill/fill.js')
const FILL_WXML = path.join(MINI, 'pages/fill/fill.wxml')
const FILL_WXSS = path.join(MINI, 'pages/fill/fill.wxss')
const ERP = path.join(PROJ, '.workbuddy/remote-erp/erp_db.py')
const ROUTE = path.join(PROJ, '.workbuddy/remote-erp/routers/forecast_submissions.py')

let failed = 0
const ok = (cond, label, extra = '') => {
  if (cond) console.log('  ✅ ' + label + (extra ? ' ' + extra : ''))
  else { console.log('  ❌ ' + label + (extra ? ' ' + extra : '')); failed++ }
}
const skip = (label, why) => console.log('  ⚠️ SKIP ' + label + ' —— ' + why)

const wxml = fs.readFileSync(WXML, 'utf8')
const mjs = fs.readFileSync(MJS, 'utf8')

console.log('A. 撤回按钮由服务端 can_recall 决定是否渲染')
{
  const m = wxml.match(/<button[^>]*class="recall-btn"[^>]*>/g) || []
  ok(m.length === 1, '模板里恰好 1 个撤回按钮', `实测 ${m.length}`)
  ok(/class="recall-btn"[^>]*wx:if="\{\{item\.can_recall\}\}"/.test(wxml),
    '撤回按钮 wx:if 用的是 item.can_recall（服务端算的归属闸门）')
  ok(!/class="recall-btn"[^>]*wx:if="\{\{item\.status === 'pending'\}\}"/.test(wxml),
    '撤回按钮不再按 status==pending 判断（旧写法已清除）')

  // 坏样本自证：把闸门退回 status 判，必须判否
  const bad = wxml.replace(/wx:if="\{\{item\.can_recall\}\}"/, "wx:if=\"{{item.status === 'pending'}}\"")
  ok(!/class="recall-btn"[^>]*wx:if="\{\{item\.can_recall\}\}"/.test(bad),
    '坏样本（退回 status 判）能被判否（护栏不是空转）')
}

console.log('B. 删除按钮这道老闸门没被顺手改坏（两处必须同族）')
{
  ok(/class="swipe-act"[^>]*wx:if="\{\{item\.can_delete\}\}"/.test(wxml),
    '删除按钮仍是 wx:if="item.can_delete"（v259 的闸门不许回退）')
}

console.log('C. 列表字段必须原样透传（白名单会静默丢掉 can_recall）')
{
  ok(/\.map\(\s*r\s*=>\s*\(\{\s*\.\.\.r/.test(mjs),
    'mine.js 的 records map 用 ...r 展开（can_recall 能透传到 WXML）')
  const bad = mjs.replace(/\.map\(\s*r\s*=>\s*\(\{\s*\.\.\.r/, '.map(r => ({ id: r.id, status: r.status')
  ok(!/\.map\(\s*r\s*=>\s*\(\{\s*\.\.\.r/.test(bad),
    '坏样本（改成字段白名单）能被判否')
}

console.log('D. 后端算出了 can_recall，且 /my 把 role 传下去（跨仓同源）')
{
  if (!fs.existsSync(ERP) || !fs.existsSync(ROUTE)) {
    skip('后端快照检查', '本地缺 .workbuddy/remote-erp/（后端不入 git，需从生产拉取）')
  } else {
    const erp = fs.readFileSync(ERP, 'utf8')
    const route = fs.readFileSync(ROUTE, 'utf8')
    ok(/d\["can_recall"\]\s*=/.test(erp), 'erp_db.py 里真的写了 d["can_recall"]')
    ok(/d\.get\("status"\) == "pending"/.test(erp), '判据含 pending（已撤回/已驳回不给按钮）')
    ok(/_writable and d\.get\("status"\)/.test(erp),
      '判据含期次可写（撤回路由层有 forecast_period_writable 硬锁，漏了就是假入口）')
    // 只切 /my 这一段判 —— 文件里 recall / delete 路由本来就有 role=u.get(...)，
    // 全文级断言会被它们救成假绿（v755 第一版就栽在这里）。
    const i0 = route.indexOf('def my_submissions')
    const i1 = route.indexOf('return {"ok": True, "records": records}')
    const myCall = (i0 >= 0 && i1 > i0) ? route.slice(i0, i1) : ''
    ok(myCall.length > 0, '找到 /my 路由实现体')
    ok(/role=u\.get\("role", ""\)/.test(myCall),
      '/my 路由把 role 传进 forecast_submission_list（不传 ⇒ 管理员看不到撤回按钮）')
    const bad = myCall.replace(/role=u\.get\("role", ""\)/, '')
    ok(!/role=u\.get\("role", ""\)/.test(bad), '坏样本（/my 不传 role）能被判否')
  }
}

/* E. v757：撤回许可收敛成**单点判据**，三条通路缺一不可
 *
 * 报障（2026-11-04 导购马耀秀）：她报了本期民发门店的单，期次还开着，
 * 撤回按钮却不出现。真实链路 —— 主管先导入一版（role='导入'/user_id=老板），
 * 她 09:18 在小程序提交 ⇒ 原位替换到那一行（`forecast_submission_replace`
 * **有意不动 user_id/role**）⇒ 这单名义上永远是「导入单」；
 * 主管 10:11 再保存一次，连 updated_by 都被清掉。
 * ⇒ 只按「本人 user_id」判，「能报这单的人」永远撤不了自己的单。
 *
 * 判据：撤回许可 = 单点函数 `forecast_recall_allowed()`，列表与写入口共用；
 * 通路三条 = 本人 ／ 管理员元组 ／ **该单在我的报单范围**。
 * ⚠️ 入参必须同时吃 dict 与 (id,kind) 元组 —— 列表传元组、路由传 dict，
 *    只认一种不会报错，而是 int(元组) 抛错被 continue 吞成**静默 False**
 *    （v757 第一版补丁自己就栽在这里，按钮照样不亮）。
 */
console.log('E. 撤回许可单点判据（v757）：三条通路 + 两种入参形状')
{
  if (!fs.existsSync(ERP) || !fs.existsSync(ROUTE)) {
    skip('撤回判据单点化检查', '本地缺 .workbuddy/remote-erp/')
  } else {
    const erp = fs.readFileSync(ERP, 'utf8')
    const route = fs.readFileSync(ROUTE, 'utf8')

    const i0 = erp.indexOf('def forecast_recall_allowed(')
    const i1 = erp.indexOf('def forecast_submission_list(', i0)
    const fn = (i0 >= 0 && i1 > i0) ? erp.slice(i0, i1) : ''
    ok(fn.length > 0, '判据函数 forecast_recall_allowed 存在')
    ok(/int\(row\["user_id"\] or 0\) == int\(user_id or 0\)/.test(fn), '通路① 本人（user_id 相等）')
    ok(/role in \("admin", "boss", "supervisor"\)/.test(fn), '通路② 管理员元组（与 recall 同源）')
    ok(/_norm_store_kind\(_kd\) == kind/.test(fn), '通路③ 该单在我的报单范围（v757 核心）')
    ok(/isinstance\(s, \(tuple, list\)\) and len\(s\) == 2/.test(fn),
      '两种入参形状都吃（列表传元组 / 路由传 dict）')
    const badTuple = fn.replace(/elif isinstance\(s, \(tuple, list\)\) and len\(s\) == 2:[\s\S]{0,80}?else:/, 'else:')
    ok(!/isinstance\(s, \(tuple, list\)\) and len\(s\) == 2/.test(badTuple),
      '坏样本（只认 dict）能被判否 —— 只认一种会静默变 False')

    // 两处必须都调它，否则「按钮亮、点了报错」的假入口会以另一种形状回来
    const listSeg = erp.slice(erp.indexOf('def forecast_submission_list('),
      erp.indexOf('def _forecast_product_cached(', erp.indexOf('def forecast_submission_list(')))
    ok(/forecast_recall_allowed\(d,/.test(listSeg), '列表 can_recall 调的是这个函数')
    const rc0 = erp.indexOf('def forecast_submission_recall(')
    const rc1 = erp.indexOf('def forecast_submission_delete(', rc0)
    const rcSeg = erp.slice(rc0, rc1)
    ok(/forecast_recall_allowed\(row,/.test(rcSeg), '写入口 recall 调的也是这个函数（不是各判一套）')
    ok(/store_scopes/.test(rcSeg), 'recall 接受 store_scopes（不接 ⇒ 范围通路走不到）')

    // 路由必须真的把范围算出来并传下去
    const r0 = route.indexOf('def recall_submission(')
    const r1 = route.indexOf('@router.post("/{sid}/delete")', r0)
    const rSeg = (r0 >= 0 && r1 > r0) ? route.slice(r0, r1) : ''
    ok(rSeg.length > 0, '找到 recall 路由实现体')
    ok(/report_subject_stores\(/.test(rSeg),
      'recall 路由用 report_subject_stores 算范围（与提交越权校验同一函数）')
    ok(/store_scopes=_scopes/.test(rSeg), 'recall 路由把范围传给判据')
    const badRoute = rSeg.replace(/,\s*store_scopes=_scopes/, '')
    ok(!/store_scopes=_scopes/.test(badRoute),
      '坏样本（路由不传范围）能被判否 —— 传了不判/判了不传都是同一个假入口')
  }
}

/* F. v758：已撤回单的「继续修改」—— 撤回只需一行 UPDATE，明细全在，别让用户重填
 *
 * 报障原话（2026-11-04）：「已撤销的单子，如果用户想修改后再次提交，有没有便捷途径，
 *                          现在是撤销后需全部重新填报」
 *
 * 事实（生产核实）：`forecast_submission_recall` 只 `UPDATE status='recalled'`，
 *   **明细一行都没删**（单号 2453 撤回后仍是 23 行 / 300 件）。所以"撤回后重填"不是
 *   数据没了，是两个入口都被关掉了：`rec-copy` 按钮对 recalled 不渲染、`genSample`
 *   也把作废单排除 —— 于是 23 行只能手打。
 *
 * 🔴 「继续修改」≠「复制样单」，不能合并（合并就退回到"拿作废量当模板"的旧风险）：
 *      · 复制   = 拿**别的期次**的有效单当模板 → 只认非作废单；
 *      · 继续修改 = 把**这一单**拉回来改 → 提交命中原单（幂等键 门店+期次），单号不变。
 *   故只放开 recalled、**rejected 仍禁**（驳回是审批方否掉的，不是本人能拉回来的）。
 *
 * 判据（缺一条就是假修）：
 *   ① 模板：recalled 且**期次可写**才给按钮；`period_writable` 由服务端逐条算；
 *   ② mine.js：recalled 放行且带 `revise`/`sid`，rejected 仍拦；
 *   ③ fill.js：**期次必须对齐**（只切门店不切期次 = 23 行整批报到错的期次、零报错）；
 *   ④ 文案：说清"改的是哪一单、单号不变"，不能沿用"生成样单"；
 *   ⑤ 撤回后清本机「本期已报」回执（不清就是假状态：单已撤、页面还说报过了 ⇒ 漏单）。
 */
console.log('F. 已撤回单「继续修改」（v758）：入口闸门 + 期次对齐 + 回执清理')
{
  const fill = fs.existsSync(FILL) ? fs.readFileSync(FILL, 'utf8') : ''
  ok(fill.length > 0, '找到 fill.js')

  // ① 模板闸门
  ok(/class="rec-copy"[^>]*wx:if="\{\{item\.status === 'recalled' && item\.period_writable\}\}"/.test(wxml),
    '「继续修改」按钮 = recalled **且** 服务端 period_writable')
  const badWxml = wxml.replace(
    /wx:if="\{\{item\.status === 'recalled' && item\.period_writable\}\}"/,
    'wx:if="{{item.status === \'recalled\'}}"')
  ok(!/wx:if="\{\{item\.status === 'recalled' && item\.period_writable\}\}"/.test(badWxml),
    '坏样本（去掉期次闸门）能被判否 —— 期次一关就是"点了必报错"的假入口')
  const copies = (wxml.match(/<button[^>]*class="rec-copy"/g) || []).length
  ok(copies === 2, '「复制」与「继续修改」是两个按钮、各带各的条件', `实测 ${copies}`)
  ok(/class="rec-copy"[^>]*wx:if="\{\{item\.status !== 'recalled' && item\.status !== 'rejected'\}\}"/.test(wxml),
    '「复制」仍排除 recalled/rejected（旧的"作废单不作源"纪律不许回退）')

  // ② mine.js
  ok(/const revise = rec\.status === 'recalled'/.test(mjs), 'mine.js 识别 recalled → revise')
  ok(/if \(rec\.status === 'rejected'\)/.test(mjs), 'rejected 仍被拦（驳回单不能自己拉回来）')
  ok(/sid: rec\.id, revise: revise/.test(mjs), '跨页带出单号 + revise 标志（文案要靠单号对上号）')
  const badMjs = mjs.replace(/if \(rec\.status === 'rejected'\)/, 'if (false)')
  ok(!/if \(rec\.status === 'rejected'\)/.test(badMjs), '坏样本（放行 rejected）能被判否')

  // ③④ fill.js：期次对齐 + 拒绝分支 + 文案
  ok(/this\._pendingCopy\.revise && this\._pendingCopy\.period_id/.test(fill),
    '_applyPeriods 会为「继续修改」优先选中源单期次')
  ok(/String\(curP\.id\) !== String\(p\.period_id\)/.test(fill),
    '期次对不上时**明确拒绝**带入（绝不就近塞进别的期次）')
  ok(/revise: !!p\.revise, sid: p\.sid \|\| 0/.test(fill), '_applyCopySample 透传 revise/sid')
  ok(/continue.*修改单号|继续修改单号/.test(fill) || /继续修改单号/.test(
    fs.readFileSync(path.join(MINI, 'pages/fill/fill.wxml'), 'utf8')),
    '文案出现「继续修改单号 N」而不是「样单来自」')
  const badFill = fill.replace(/String\(curP\.id\) !== String\(p\.period_id\)/, 'false')
  ok(!/String\(curP\.id\) !== String\(p\.period_id\)/.test(badFill),
    '坏样本（不校验期次）能被判否 — 这是最难发现的错数据：数量全对、期次全错')

  // ⑤ 回执清理：键名必须单点构造
  ok(/app\.globalData\._fsRecall/.test(mjs), 'mine.js 撤回成功后发出 _fsRecall 信号')
  ok(/app\.globalData\._fsRecall/.test(fill), 'fill.js onShow 消费该信号')
  ok(/_subKeyOf\(/.test(fill), '回执键由 _subKeyOf 单点构造（不照抄字符串）')
  const badFill2 = fill.replace(/_subKeyOf\(/g, '_subKeyLegacy(')
  ok(!/    return this\._subKeyOf\(/.test(badFill2),
    '坏样本（键构造被改回第二份实现）能被判否')

  // 后端：period_writable 必须真的算出来，而不是写死
  if (!fs.existsSync(ERP)) {
    skip('period_writable 跨仓检查', '本地缺 .workbuddy/remote-erp/erp_db.py')
  } else {
    const erp = fs.readFileSync(ERP, 'utf8')
    ok(/d\["period_writable"\] = bool\(_writable\)/.test(erp),
      '后端 d["period_writable"] 来自同一个 _writable（与 can_delete/can_recall 同口径）')
    const badErp = erp.replace(/d\["period_writable"\] = bool\(_writable\)/,
      'd["period_writable"] = True')
    ok(!/d\["period_writable"\] = bool\(_writable\)/.test(badErp),
      '坏样本（写死 True）能被判否 —— 写死等于期次闸门不存在')
  }
}

/* G. v759（方案 B）：填报页顶部「本期已有单」必须是**服务端**的。
 *
 * 为什么 F 修完还得有 G：F 解决的是"已经撤回了怎么救"，而用户真正的动作是
 *   **先撤回、再重填** —— 那一步本不该发生。要让它不发生，用户进填报页就得看见
 *   「本期我已经报过 N 项，要改直接改」。
 *
 * 🔴 `submittedInfo`（v758 那条本机回执）治不了这件事，两个盲区都是硬伤：
 *   ① 纯本机 Storage（`fs_sub_<店>_<期次>`）⇒ 换手机 / 清缓存 / 换人登录后消失，
 *      而单还在库里 —— 用户看到"本期没报过"，就会重新报一遍或干脆不报；
 *   ② 它**只有"已报"一种状态**：撤回后只能靠 v758 的跨页信号去清，杀进程再进就
 *      照旧挂着"✓ 本期已报"（假状态 ⇒ 漏单）。
 *
 * 判据（缺一条就是假修）：
 *   ① 横幅数据来自 `/api/forecast-submissions/my`，按 (门店,类型) 取、按 period_id 精确匹配；
 *   ② **不自动预填**：只给按钮，`refreshServerSub` 体内不许调 `_applySample`
 *      （覆盖式预填会静默改掉用户已填的数）；
 *   ③ 两条横幅**互斥**（服务端 `wx:if` → 本机 `wx:elif`）—— 一屏两条「本期已报」比没有更糟；
 *   ④ 期次可写才给「继续修改」（else 点进去必失败），rejected 一律不给；
 *   ⑤ 四个刷新时机不能漏：挂进 `refreshBanners`、提交后 force、撤回后清 key、onShow 节流。
 */
console.log('G. 填报页「本期已有单」用服务端事实（v759）：互斥渲染 + 不自动预填 + 刷新时机')
{
  const fill = fs.existsSync(FILL) ? fs.readFileSync(FILL, 'utf8') : ''
  ok(fill.length > 0, '找到 fill.js')
  const fwxml = fs.existsSync(FILL_WXML) ? fs.readFileSync(FILL_WXML, 'utf8') : ''
  const fwxss = fs.existsSync(FILL_WXSS) ? fs.readFileSync(FILL_WXSS, 'utf8') : ''
  ok(fwxml.length > 0 && fwxss.length > 0, '找到 fill.wxml / fill.wxss')

  // ① 数据来源与精确匹配
  ok(/serverSub: null/.test(fill), 'data 里有 serverSub（服务端本期已有单）')
  ok(/\/api\/forecast-submissions\/my\?limit=100&store_id=/.test(fill),
    '横幅数据来自 /my（与「我的提交」「复制样单」同一接口，不另开一份读取口径）')
  ok(/String\(r\.period_id\) === String\(p\.id\)/.test(fill),
    '按 period_id 精确匹配当前期次（一店一期一单，不许"取最新一条"代替）')
  const badMatch = fill.replace(/String\(r\.period_id\) === String\(p\.id\)/, 'true')
  ok(!/String\(r\.period_id\) === String\(p\.id\)/.test(badMatch),
    '坏样本（不比期次、取到哪条算哪条）能被判否 —— 会把上一期的单顶到本期横幅上')

  // ② 不自动预填
  const fn0 = fill.indexOf('refreshServerSub(force) {')
  const fn1 = fill.indexOf('_buildServerSub(rec, pid) {')
  ok(fn0 >= 0 && fn1 > fn0, '找到 refreshServerSub 函数体')
  const body = fill.slice(fn0, fn1)
  ok(!/_applySample\(/.test(body),
    'refreshServerSub **不自动带入**（只 setData 横幅；覆盖式预填会静默改掉已填数量）')
  ok(/_applySample\(\{/.test(fill.slice(fn1)), '「继续修改」入口单独调 _applySample（用户点了才带）')
  const badAuto = body.replace('this.setData({ serverSub:', 'this.reviseServerSub(); this.setData({ serverSub:')
  ok(/_applySample\(/.test(badAuto) === false,
    '坏样本（拉取后就自动带入）能被判否 —— 那等于每次进页面都把用户的填写清掉')

  // ③ 互斥渲染
  ok(/wx:if="\{\{serverSub\}\}"/.test(fwxml), '模板里服务端横幅用 wx:if')
  ok(/wx:elif="\{\{submittedInfo\}\}"/.test(fwxml), '本机回执降级为 wx:elif（服务端在就不显示它）')
  const badChain = fwxml.replace(/wx:elif="\{\{submittedInfo\}\}"/, 'wx:if="{{submittedInfo}}"')
  ok(!/wx:elif="\{\{submittedInfo\}\}"/.test(badChain),
    '坏样本（改回 wx:if）能被判否 —— 两条"本期已报"同时出现，数字还不一定一样')
  const iSrv = fwxml.indexOf('wx:if="{{serverSub}}"')
  const iSub = fwxml.indexOf('wx:elif="{{submittedInfo}}"')
  ok(iSrv >= 0 && iSub > iSrv, '服务端横幅排在前面（elif 链方向正确）')

  // ④ 入口闸门
  ok(/actLabel = writable \? '继续修改' : ''/.test(fill),
    '「继续修改」只在期次可写时给出（关了就只显示单号、不给假入口）')
  ok(/status === 'rejected'/.test(fill), '_buildServerSub 单独处理 rejected')
  const rej0 = fill.indexOf("} else if (status === 'rejected') {")
  const rej1 = fill.indexOf('} else {', rej0)
  const rejBody = rej0 >= 0 && rej1 > rej0 ? fill.slice(rej0, rej1) : ''
  ok(rejBody.length > 0 && !/actLabel\s*=/.test(rejBody),
    'rejected 分支不给 actLabel（驳回是审批方否掉的，与 v758 纪律一致）')
  ok(/wx:if="\{\{serverSub\.actLabel\}\}"/.test(fwxml), '模板按钮跟着 actLabel 走（没文案就没按钮）')

  // ⑤ 刷新时机
  ok(/this\.refreshServerSub\(\)\s*\n\s*\}\s*,\s*\n\s*\/\* ============ v759/.test(fill),
    'refreshServerSub 挂在 refreshBanners 末尾（期次/门店/提交后全部覆盖，只改一处）')
  ok(/this\.refreshServerSub\(true\)/.test(fill), '提交成功后 force 刷新（否则横幅一直报提交前的件数）')
  ok(/this\._serverSubKey = ''/.test(fill), '有清 key 的路径（撤回后 / 失败重试）')
  /* 锚点必须用**消费处**（`app.globalData._fsRecall` 那一行），不能用第一次出现的
     `_fsRecall` —— 数据注释里也提到过它（"v758 给撤回补的 _fsRecall 信号"），
     锚错位置就会截到一段说明文字，然后得出"没清 key"的假阴性。 */
  const recallAt = fill.indexOf('app.globalData._fsRecall')
  const recallSeg = recallAt >= 0 ? fill.slice(recallAt, recallAt + 900) : ''
  ok(recallAt >= 0 && /this\._serverSubKey = ''/.test(recallSeg),
    '撤回信号处理里清 key —— 本机回执清了、服务端横幅却继续说"已有单"是最典型的修一半')
  ok(/_serverSubAt/.test(fill) && /Date\.now\(\) - \(this\._serverSubAt \|\| 0\) > 60000/.test(fill),
    'onShow 有 60s 节流（回页面就刷新，但不每次切 tab 都拉一遍带明细的列表）')
  const badForce = fill.replace('this.refreshServerSub(true)', 'this.refreshServerSub()')
  ok(!/this\.refreshServerSub\(true\)/.test(badForce),
    '坏样本（提交后不 force）能被判否 —— key 去重会让横幅停在提交前的数字')

  // 配色：不把旧亮青带进来（v736/v748 同族：一个语义位置两个色值）
  ok(/\.last-bar-srv\{/.test(fwxss), '新增 .last-bar-srv 样式')
  const srvCss = (fwxss.match(/\.last-bar-srv[^{]*\{[^}]*\}/g) || []).join('\n')
  ok(!/#06b6d4|#ecfeff|#a5f3fc/.test(srvCss),
    '新横幅不用旧亮青底（#ecfeff/#a5f3fc）或旧品牌青 #06b6d4 —— 同一位置两种青并排一眼看出')
  /* 🔴 品牌色**不许带 alpha**（`check-miniprogram-brand` 会判红，v748 实测 92% 的半透明按钮
     渲染成另一个色值）。v763 起「主色 8% over 白」烘成实色并收进 --brand-bg 令牌 ——
     所以判据从"字面量是 #ECF4F3"改为"走令牌"，令牌的值由品牌护栏 ⑦d/⑦e 钉死。
     意图（不用 rgba、不用旧亮青）完全不变。 */
  ok(/var\(--brand-bg\)/.test(srvCss), '新横幅底色走 --brand-bg 令牌（实色烘值，不是 rgba）')
  ok(!/rgba\(15,\s*118,\s*110/.test(srvCss), '品牌色没写成 rgba（带 alpha 就不再是那个品牌色）')
  /* 坏样本必须走**同一个提取逻辑**（先换值、再按 .last-bar-srv 切段），
     否则自证是空转的 —— 直接对全文 replace 再断言"没有 var(--brand-bg)"永远成立。 */
  const badFwxss = fwxss.replace(/var\(--brand-bg\)/g, '#ecfeff')
  const badSrv = (badFwxss.match(/\.last-bar-srv[^{]*\{[^}]*\}/g) || []).join('\n')
  ok(!/var\(--brand-bg\)/.test(badSrv) && /#ecfeff/.test(badSrv),
    '坏样本（底色退回旧亮青字面量）能被判否')
}

console.log('')
if (failed) { console.log(`❌ 失败 ${failed} 项`); process.exit(1) }
console.log('✅ miniprogram-recall-gate: 全部通过')
process.exit(0)
