/**
 * hergent-forecast-smoke.mjs —— 预报订单管理页「真机冒烟」验证
 *
 * 为什么必须存在（2026-09-19 的血泪教训）：
 *   同一天内，预报页**连续三次**被整页「页面出错了」打崩，而每一次：
 *     · SFC 编译通过   · `npm run build` 通过   · 静态正则校验通过
 *     · 只有用户点出来才知道 —— 用户成了测试员
 *   根因全是**运行期**才暴露的问题（字段缺失 / accessor 自递归 / 产物未重建），编译期一律看不见。
 *   ⇒ 结论：任何动过 Forecast.vue 的改动，上线后都必须真机跑一次。
 *
 * 它做什么：
 *   用系统已装的 Google Chrome（**不下载 Chromium**）+ 自带的零依赖 CDP 驱动（`lib/cdp-lite.mjs`），
 *   真实登录 → **点侧栏**进预报订货管理 → 采集：
 *     ① 正文是否出现 ErrorBoundary 文案「页面出错了」
 *     ② 是否出现 RangeError: Maximum call stack size exceeded
 *     ③ console.error / pageerror
 *     ④ 是否真的渲染出业务内容（而不是空白/兜底页）
 *     ⑤ 截图存证
 *   设 `HG_EDIT=1` 时额外**复现用户动作**：进改单 → 点第一列「删除该客户列」→ 看是否崩、
 *   列数是否 -1（`delCol` 是纯内存操作，**不点保存就零落库**）。
 *
 * 判据（任一不满足即 FAIL，退出码 1）：
 *   P1 正文不含「页面出错了」        P2 无 RangeError / Maximum call stack
 *   P3 渲染出预报页业务内容          P5 删列不崩且列数 -1（仅 HG_EDIT=1）
 *   P6 保存状态条联动（仅 HG_EDIT=1）
 *   P7 有未保存改动时「回退」可用    P8 点「回退」回到基线（仅 HG_EDIT=1）
 *
 * 🔴 本脚本**绝不点「保存」**：`saveEdits` 没有"无改动就短路"的分支，点下去就是一次
 *    真实生产写入。所有被复现的动作（删列 / 回退）都是纯内存操作，零落库。
 *
 * ⚠️ 本脚本自身的两个坑（都踩过）：
 *   ① 登录**不要点 UI**：登录页有**两个**含「登录」的元素（顶栏导航 + 表单提交按钮），
 *      按文本匹配会点到顶栏那个 ⇒ 脚本静默停在登录页、零报错（只有 P3 才发现）。改走页面内 fetch。
 *   ② 驱动层：Chrome 必须带 `--no-sandbox`（沙箱环境里否则 renderer 一被调试就崩），
 *      且 WebSocket 必须用 `ws` 包 —— 细节见 `lib/cdp-lite.mjs` 顶部注释。
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const USER = process.env.HG_USER || 'mptestsp'
const PASS = process.env.HG_PASS || 'Mpsup@1'
const SHOT_DIR = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/客户列删除被恢复排查-2026-09-19'
const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')
const SHOT = SHOT_DIR + '/真机冒烟-预报页-' + STAMP + '.png'

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const log = (s) => console.log(s)
const notes = []

/* ---- 页面内脚本（全部写成字符串表达式；内部用双引号，避免与外层单引号打架）---- */
const JS_LOGIN = (u, p) => 'fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},'
  + 'body:JSON.stringify({username:' + JSON.stringify(u) + ',password:' + JSON.stringify(p) + '})})'
  + '.then(r=>r.json().then(d=>({s:r.status,d:d})))'
  + '.then(r=>{var d=r.d;if(!d.token)return JSON.stringify({ok:false,status:r.s,detail:d.detail||d.message||""});'
  + 'localStorage.setItem("hergent_v2_token",d.token);'
  + 'if(d.csrf_token)localStorage.setItem("hergent_v2_csrf",d.csrf_token);'
  + 'if(d.user)localStorage.setItem("hergent_v2_user",JSON.stringify(d.user));'
  + 'if(d.tenant_id)localStorage.setItem("hergent_v2_tenant",String(d.tenant_id));'
  + 'return JSON.stringify({ok:true,status:r.s,user:(d.user&&d.user.username)||"",role:(d.user&&d.user.role)||"",tenant:d.tenant_id})})'

const JS_CLICK_SIDEBAR = '(()=>{var all=Array.from(document.querySelectorAll("a,div,span,li,button"));'
  + 'var hit=all.find(x=>/预报订[单货]管理/.test((x.innerText||"").trim())&&(x.innerText||"").trim().length<20);'
  + 'if(hit){hit.click();return (hit.innerText||"").trim()}return ""})()'

const JS_BODY_TEXT = 'document.body?document.body.innerText:""'
const JS_BOUNDARY = '/页面出错了/.test(document.body?document.body.innerText:"")'
const JS_COL_DEL_COUNT = 'document.querySelectorAll("button.col-del").length'
const JS_CLICK_EDIT = '(()=>{var bs=Array.from(document.querySelectorAll("button,.el-button,[role=button],a"));'
  + 'var b=bs.find(x=>/^改\\s*单$/.test((x.innerText||"").trim()));if(!b)return JSON.stringify({ok:false});'
  + 'b.click();return JSON.stringify({ok:true})})()'
const JS_CLICK_FIRST_DEL = '(()=>{var bs=Array.from(document.querySelectorAll("button.col-del"));'
  + 'if(!bs.length)return JSON.stringify({ok:false});var t=bs[0].getAttribute("title")||"";bs[0].click();'
  + 'return JSON.stringify({ok:true,title:t})})()'
const JS_SAVE_STATE = '(()=>{var el=document.querySelector(".save-state");return el?(el.innerText||"").trim():""})()'
/* v201：状态条与「回退」按钮必须**说同一件事** —— 有未保存改动时回退不能是灰的。 */
const JS_BACK_BTN = '(()=>{var bs=Array.from(document.querySelectorAll("button"));'
  + 'var b=bs.find(x=>/^回\\s*退$/.test((x.innerText||"").trim()));'
  + 'if(!b)return JSON.stringify({ok:false});return JSON.stringify({ok:true,disabled:!!b.disabled})})()'
const JS_CLICK_BACK = '(()=>{window.confirm=()=>true;'
  + 'var bs=Array.from(document.querySelectorAll("button"));'
  + 'var b=bs.find(x=>/^回\\s*退$/.test((x.innerText||"").trim()));'
  + 'if(!b)return JSON.stringify({ok:false});b.click();return JSON.stringify({ok:true})})()'

let browser
let failed = false

try {
  fs.mkdirSync(SHOT_DIR, { recursive: true })
  log('=== hergent 预报页真机冒烟 ===')

  browser = await launch()
  const page = await browser.newPage()
  await page.enable()
  log('浏览器已就绪（系统 Chrome + 零依赖 CDP 驱动）')

  /* ---- 1. 登录（在页面内 fetch ⇒ cookie / localStorage 都落在真实浏览器上下文里） ---- */
  await page.goto(BASE, 3500)
  const li = JSON.parse(await page.eval(JS_LOGIN(USER, PASS)))
  log('登录结果：' + JSON.stringify(li))
  if (!li.ok) notes.push('⚠️ 登录失败，后续判据不成立（请核对账号状态）')

  /* ---- 2. 进首页 → 点侧栏「预报订货管理」（＝用户的真实动作，而不是敲 URL） ---- */
  await page.goto(BASE + '/#/', 4000)
  const beforeText = await page.eval(JS_BODY_TEXT)
  log('进入首页后：文本长度=' + beforeText.length + '，仍是登录页=' + /用户名[\s\S]{0,10}密码/.test(beforeText))
  const entered = await page.eval(JS_CLICK_SIDEBAR)
  log('点击侧栏「预报订货管理」：' + (entered || '（未找到，回落直接路由 #/forecast）'))
  if (!entered) await page.goto(BASE + '/#/forecast', 5000)
  await sleep(3000)

  /* ---- 2.5 可选：改单 → 点「删除该客户列」（复现用户动作，**不保存**）---- */
  let editProbe = { skipped: true }
  let backProbe = { skipped: true }
  if (process.env.HG_EDIT === '1') {
    log('进入改单模式：' + (await page.eval(JS_CLICK_EDIT)))
    /* 等改单网格挂载 + 草稿恢复（渲染完成后再读状态条，避免读到上一帧） */
    await sleep(1800)
    const before = await page.eval(JS_COL_DEL_COUNT)
    const stateBefore = await page.eval(JS_SAVE_STATE)
    log('改单后客户列删除按钮数：' + before + '｜保存状态条：' + (stateBefore || '(未找到 .save-state)'))
    if (before > 0) {
      log('点击第 1 列的删除按钮：' + (await page.eval(JS_CLICK_FIRST_DEL)))
      await sleep(2500)
      const after = await page.eval(JS_COL_DEL_COUNT)
      const boundaryNow = await page.eval(JS_BOUNDARY)
      const stateAfter = await page.eval(JS_SAVE_STATE)
      editProbe = { skipped: false, before, after, boundaryNow, stateBefore, stateAfter }
      log('删列后按钮数：' + after + '（预期 ' + (before - 1) + '）｜出现「页面出错了」=' + boundaryNow)
      log('删列后保存状态条：' + (stateAfter || '(未找到 .save-state)'))

      /* ---- 2.6 「回退」按钮：可用性 + 实际回退（**纯内存操作，零落库**）---- */
      const backBtn = JSON.parse(await page.eval(JS_BACK_BTN))
      if (backBtn.ok) {
        await page.eval(JS_CLICK_BACK)
        await sleep(1500)
        backProbe = {
          skipped: false,
          disabledBefore: backBtn.disabled,
          colsAfterBack: await page.eval(JS_COL_DEL_COUNT),
          stateAfterBack: await page.eval(JS_SAVE_STATE),
        }
        log('「回退」按钮 disabled=' + backBtn.disabled + '｜点回退后列数=' + backProbe.colsAfterBack
          + '（预期回到 ' + before + '）｜状态条=' + (backProbe.stateAfterBack || '(无)'))
      } else {
        notes.push('⚠️ 未找到「回退」按钮，P7 / P8 跳过')
      }
    } else {
      editProbe = { skipped: false, before, after: before, boundaryNow: false, stateBefore, stateAfter: stateBefore, note: '改单模式下没有 col-del 按钮' }
      notes.push('⚠️ 改单模式下未发现 button.col-del，删列动作未真正复现')
    }
  } else {
    log('（未开 HG_EDIT，跳过改单/删列动作）')
  }

  /* ---- 3. 采集 ---- */
  const body = await page.eval(JS_BODY_TEXT)
  const url = await page.eval('location.href')
  const hasBoundary = await page.eval(JS_BOUNDARY)
  const errors = page.errors.slice()
  const hasStack = /Maximum call stack|RangeError/i.test(body + ' ' + errors.join(' '))
  const FEATURE = ['客户', '商品', '填报', '汇总', '预报', '期次', '数量']
  const hitFeatures = FEATURE.filter(k => body.includes(k))
  try { await page.screenshot(SHOT) } catch { /* 截图失败不影响判定 */ }

  log('')
  log('--- 采集结果 ---')
  log('当前 URL   : ' + url)
  log('正文长度   : ' + body.length)
  log('正文摘录   : ' + body.replace(/\s+/g, ' ').slice(0, 240))
  log('命中的业务词: ' + (hitFeatures.join(' / ') || '（无）'))
  log('console/page 错误 ' + errors.length + ' 条：')
  errors.slice(0, 10).forEach(e => log('   ' + e.slice(0, 170)))
  log('截图       : ' + SHOT)
  notes.forEach(n => log(n))

  log('')
  log('--- 判据 ---')
  if (!hasBoundary) log('  PASS  P1 正文无「页面出错了」')
  else { log('  FAIL  P1 正文出现 ErrorBoundary 兜底文案「页面出错了」'); failed = true }

  if (!hasStack) log('  PASS  P2 无 RangeError / Maximum call stack')
  else { log('  FAIL  P2 出现栈溢出'); failed = true }

  if (hitFeatures.length >= 2) log('  PASS  P3 预报页渲染出业务内容（命中 ' + hitFeatures.length + ' 个业务词）')
  else { log('  FAIL  P3 未渲染出预报页业务内容（命中 ' + hitFeatures.length + ' 个）'); failed = true }

  log('  ' + (errors.length ? 'WARN' : 'PASS') + ' P4 console 错误 ' + errors.length + ' 条（不计入失败，供参考）')

  if (editProbe.skipped) log('  SKIP  P5 删列动作未验证（未设 HG_EDIT=1）')
  else if (editProbe.note) { log('  FAIL  P5 ' + editProbe.note); failed = true }
  else if (!editProbe.boundaryNow && editProbe.after === editProbe.before - 1)
    log('  PASS  P5 点「删除该客户列」未崩且列数 ' + editProbe.before + '→' + editProbe.after)
  else { log('  FAIL  P5 删列异常：列数 ' + editProbe.before + '→' + editProbe.after + '，兜底页=' + editProbe.boundaryNow); failed = true }

  if (editProbe.skipped || editProbe.stateBefore === undefined) log('  SKIP  P6 保存状态条未验证（未设 HG_EDIT=1）')
  else if (/尚未修改/.test(editProbe.stateBefore) && /有未保存的改动/.test(editProbe.stateAfter))
    log('  PASS  P6 状态条联动正常：「' + editProbe.stateBefore + '」→「' + editProbe.stateAfter + '」')
  else {
    log('  FAIL  P6 状态条异常：进编辑="' + editProbe.stateBefore + '"（期望含「尚未修改」），'
      + '删列后="' + editProbe.stateAfter + '"（期望含「有未保存的改动」）'); failed = true
  }

  if (backProbe.skipped) log('  SKIP  P7/P8 回退按钮未验证（未设 HG_EDIT=1 或未找到按钮）')
  else {
    if (backProbe.disabledBefore === false) log('  PASS  P7 有未保存改动时「回退」可用（不再与状态条自相矛盾）')
    else { log('  FAIL  P7 有未保存改动，但「回退」仍是灰的（状态条与按钮文案不一致）'); failed = true }

    if (backProbe.colsAfterBack === editProbe.before && /尚未修改/.test(backProbe.stateAfterBack))
      log('  PASS  P8 点「回退」回到基线：列数回到 ' + backProbe.colsAfterBack + '，状态条回到「尚未修改」')
    else { log('  FAIL  P8 回退未回到基线：列数 ' + backProbe.colsAfterBack + '（预期 ' + editProbe.before
      + '），状态条="' + backProbe.stateAfterBack + '"（期望含「尚未修改」）'); failed = true }
  }

  log('')
  log(failed ? '结论：❌ 未通过' : '结论：✅ 通过')
} catch (e) {
  console.log('脚本异常：' + (e && e.message))
  failed = true
} finally {
  if (browser) { try { await browser.close() } catch { /* ignore */ } }
  process.exit(failed ? 1 : 0)
}
