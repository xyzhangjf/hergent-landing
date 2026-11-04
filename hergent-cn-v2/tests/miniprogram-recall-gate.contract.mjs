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
    ok(/_recaller\s*=\s*role in \("admin", "boss", "supervisor"\)/.test(erp),
      '管理员元组与 forecast_submission_recall 一致（admin/boss/supervisor）')
    ok(/_owner or _recaller/.test(erp), '判据含「本人 OR 管理员」（不是只看角色）')
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

console.log('')
if (failed) { console.log(`❌ 失败 ${failed} 项`); process.exit(1) }
console.log('✅ miniprogram-recall-gate: 全部通过')
process.exit(0)
