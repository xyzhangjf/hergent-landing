/**
 * guard-chip-probe.mjs —— 「AI 权限 chip + 下拉」验收（真机、只读业务数据）
 * 验：① 点开有菜单、两项带说明；② 选择后 chip 文案 + localStorage 变化；
 *     ③ 点外部关闭；④ 与「团队」下拉互斥；⑤ 只读态下禁用且标记不可选。
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
let pass = 0, fail = 0
const ok = (c, n, e) => { if (c) { pass++; console.log('  ✅ ' + n + (e ? '　→ ' + e : '')) } else { fail++; console.log('  ❌ ' + n + (e ? '　→ ' + e : '')) } }

const JS_LOGIN = 'fetch("https://hergent.cn/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},'
  + 'body:JSON.stringify({username:"mptestsp",password:"Mpsup@1"})})'
  + '.then(r=>r.json()).then(d=>{if(!d.token)return "NO";'
  + 'localStorage.setItem("hergent_v2_token",d.token);'
  + 'if(d.csrf_token)localStorage.setItem("hergent_v2_csrf",d.csrf_token);'
  + 'if(d.user)localStorage.setItem("hergent_v2_user",JSON.stringify(d.user));'
  + 'if(d.tenant_id)localStorage.setItem("hergent_v2_tenant",String(d.tenant_id));'
  + 'localStorage.setItem("hergent_ai_guard","advise");return "OK"})'
const JS_OPEN = '(function(){var d=document.querySelector(".copilot");if(d)return "already";'
  + 'var b=document.querySelector(".tb-copilot");if(!b)return "no-btn";b.click();return "clicked"})()'
const JS_ST = '(()=>{var chip=document.querySelector(".cp-guard-btn");'
  + 'var menu=document.querySelector(".cp-guard-menu");'
  + 'return JSON.stringify({'
  + ' label:chip?chip.innerText.replace(/\\s+/g," ").trim():"",'
  + ' disabled:chip?!!chip.disabled:null,'
  + ' menuOpen:!!menu,'
  + ' hd:menu?(menu.querySelector(".cp-role-menu-hd")||{}).innerText||"":"",'
  + ' items:menu?[].slice.call(menu.querySelectorAll(".cp-role-item")).map(function(e){return e.innerText.replace(/\\s+/g," ").trim()}):[],'
  + ' locked:menu?!!menu.querySelector(".cp-role-item.locked"):false,'
  + ' onName:menu?(function(){var o=menu.querySelector(".cp-role-item.on .cp-role-item-name");return o?o.innerText.trim():""})():"",'
  + ' roleMenuOpen:!!document.querySelector(".cp-role-menu:not(.cp-guard-menu)"),'
  + ' guard:localStorage.getItem("hergent_ai_guard")'
  + '})})()'
const JS_CLICK_GUARD = '(function(){var b=document.querySelector(".cp-guard-btn");if(!b)return "no";b.click();return "ok"})()'
const JS_PICK = (n) => '(function(){var m=document.querySelector(".cp-guard-menu");if(!m)return "no-menu";'
  + 'var it=m.querySelectorAll(".cp-role-item")[' + n + '];if(!it)return "no-item";it.click();return "ok"})()'
const JS_CLICK_ROLE = '(function(){var b=document.querySelector(".cp-role");if(!b)return "no";b.click();return "ok"})()'
const JS_OUTSIDE = '(function(){var t=document.querySelector(".cp-input");if(!t)return "no";'
  + 't.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}));return "ok"})()'

const b = await launch({ headless: true })
const p = await b.newPage()
await p.enable()
try {
  await p.goto(BASE + '/', 5000)
  await p.eval(JS_LOGIN)
  await p.goto(BASE + '/', 5000)
  await p.eval(JS_OPEN)
  await sleep(1400)

  console.log('== ① chip 初始态 + 点开菜单 ==')
  let s = JSON.parse(await p.eval(JS_ST))
  ok(/只给建议/.test(s.label), 'chip 文案为「只给建议」（不再是"只建议"）', s.label)
  ok(s.menuOpen === false, '菜单默认收起')
  await p.eval(JS_CLICK_GUARD); await sleep(350)
  s = JSON.parse(await p.eval(JS_ST))
  ok(s.menuOpen, '点开后菜单出现')
  ok(/AI 可以怎么做/.test(s.hd), '菜单标题为「AI 可以怎么做」', s.hd)
  ok(s.items.length === 2, '两项选项', JSON.stringify(s.items))
  ok(s.items.some(x => /不会替你下单/.test(x) || /不替你下单/.test(x)), '「只给建议」带可见说明（不再只藏 hover）')
  ok(s.items.some(x => /可以真的下单/.test(x)), '「可直接执行」带可见说明')
  ok(/只给建议/.test(s.onName), '当前项高亮为「只给建议」', s.onName)

  console.log('\n== ② 选择「可直接执行」 ==')
  await p.eval(JS_PICK(1)); await sleep(350)
  s = JSON.parse(await p.eval(JS_ST))
  ok(/可直接执行/.test(s.label), 'chip 文案变为「可直接执行」', s.label)
  ok(s.guard === 'execute', 'localStorage 已持久化', s.guard)
  ok(s.menuOpen === false, '选择后菜单自动收起')

  console.log('\n== ③ 恢复默认 + 与「团队」下拉互斥 ==')
  await p.eval(JS_CLICK_GUARD); await sleep(250)
  await p.eval(JS_PICK(0)); await sleep(250)
  s = JSON.parse(await p.eval(JS_ST))
  ok(s.guard === 'advise', '已恢复「只给建议」', s.guard)
  await p.eval(JS_CLICK_ROLE); await sleep(350)
  s = JSON.parse(await p.eval(JS_ST))
  ok(s.roleMenuOpen && !s.menuOpen, '团队菜单打开时，权限菜单不得同时开着')
  await p.eval(JS_CLICK_GUARD); await sleep(350)
  s = JSON.parse(await p.eval(JS_ST))
  ok(s.menuOpen && !s.roleMenuOpen, '权限菜单打开时，团队菜单已收起')

  console.log('\n== ④ 点外部关闭 ==')
  await p.eval(JS_OUTSIDE); await sleep(350)
  s = JSON.parse(await p.eval(JS_ST))
  ok(s.menuOpen === false, '点输入框（菜单外）后菜单收起')

  console.log('\n== ⑤ 只读态（临时改 ai_mode，验完还原）==')
  const mode = await p.eval('fetch("https://hergent.cn/api/ai-mode",{method:"PUT",headers:{"Content-Type":"application/json",'
    + '"Authorization":"Bearer "+localStorage.getItem("hergent_v2_token"),'
    + '"X-CSRF-Token":(localStorage.getItem("hergent_v2_csrf")||""),'
    + '"X-Tenant-Id":(localStorage.getItem("hergent_v2_tenant")||"")},'
    + 'body:JSON.stringify({mode:"readonly"})}).then(r=>r.status)')
  console.log('  切只读 HTTP:', mode)
  await p.goto(BASE + '/', 4500); await p.eval(JS_OPEN); await sleep(1500)
  s = JSON.parse(await p.eval(JS_ST))
  ok(s.disabled === true, '只读时权限 chip 被禁用', 'disabled=' + s.disabled)
  await p.screenshot('/Users/zhangjunfeng/Documents/laozhangai-product/outputs/输入框对比-2026-09-25/权限chip-只读态.png')
  const back = await p.eval('fetch("https://hergent.cn/api/ai-mode",{method:"PUT",headers:{"Content-Type":"application/json",'
    + '"Authorization":"Bearer "+localStorage.getItem("hergent_v2_token"),'
    + '"X-CSRF-Token":(localStorage.getItem("hergent_v2_csrf")||""),'
    + '"X-Tenant-Id":(localStorage.getItem("hergent_v2_tenant")||"")},'
    + 'body:JSON.stringify({mode:"auto"})}).then(r=>r.status)')
  console.log('  还原 auto HTTP:', back)
  ok((p.errors || []).length === 0, '0 控制台报错', JSON.stringify((p.errors || []).slice(0, 2)))
} catch (e) {
  fail++; console.log('  ❌ 异常：' + (e && e.message ? e.message : e))
} finally {
  console.log('\n===== 权限 chip 探针：PASS ' + pass + ' / FAIL ' + fail + ' =====')
  await b.close()
  process.exit(fail ? 1 : 0)
}
