/**
 * add-menu-probe.mjs —— 「＋变菜单」验收（真机）
 * 关键：**选不同项后，隐藏 input 的 accept 必须变成对应类型，且真的触发了 click()**
 *   —— 只验菜单文案出现是不够的（可能点了没反应）。
 * 另外验：4 个下拉互斥、点外关闭、布局未变（仍 7 控件 / 单行 / 同中线）。
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const DIR = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/输入框对比-2026-09-25'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
try { fs.mkdirSync(DIR, { recursive: true }) } catch { /* ignore */ }
let pass = 0, fail = 0
const ok = (c, n, e) => { if (c) { pass++; console.log('  ✅ ' + n + (e ? '　→ ' + e : '')) } else { fail++; console.log('  ❌ ' + n + (e ? '　→ ' + e : '')) } }

const JS_LOGIN = 'fetch("https://hergent.cn/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},'
  + 'body:JSON.stringify({username:"mptestsp",password:"Mpsup@1"})})'
  + '.then(r=>r.json()).then(d=>{if(!d.token)return "NO";'
  + 'localStorage.setItem("hergent_v2_token",d.token);'
  + 'if(d.csrf_token)localStorage.setItem("hergent_v2_csrf",d.csrf_token);'
  + 'if(d.user)localStorage.setItem("hergent_v2_user",JSON.stringify(d.user));'
  + 'if(d.tenant_id)localStorage.setItem("hergent_v2_tenant",String(d.tenant_id));return "OK"})'
// 监听隐藏 input 的 click，证明真的唤起了系统选择框
const JS_SPY = '(function(){window.__clicks=[];window.__accept=[];'
  + 'if(!window.__ofc){window.__ofc=HTMLInputElement.prototype.click;}'
  + 'HTMLInputElement.prototype.click=function(){'
  + ' if(this.type==="file"){window.__clicks.push(1);window.__accept.push(this.accept);}'
  + ' return window.__ofc.apply(this,arguments)};return "spy"})()'
const JS_OPEN = '(function(){var d=document.querySelector(".copilot");if(d)return "already";'
  + 'var b=document.querySelector(".tb-copilot");if(!b)return "no-btn";b.click();return "clicked"})()'
const JS_ST = '(()=>{var m=document.querySelector(".cp-add-menu");var tb=document.querySelector(".cp-toolbar");'
  + 'var kids=[];if(tb){kids=[].slice.call(tb.children).flatMap(function(x){return [].slice.call(x.children)})}'
  + 'var tops=kids.map(function(k){return Math.round(k.getBoundingClientRect().top)});'
  + 'var cys=kids.map(function(k){var r=k.getBoundingClientRect();return +(r.top+r.height/2).toFixed(1)});'
  + 'return JSON.stringify({menu:!!m,'
  + ' hd:m?(m.querySelector(".cp-role-menu-hd")||{}).innerText||"":"",'
  + ' items:m?[].slice.call(m.querySelectorAll(".cp-role-item")).map(function(e){return e.innerText.replace(/\\s+/g," ").trim()}):[],'
  + ' ctl:kids.length,rows:new Set(tops).size,centers:new Set(cys).size,'
  + ' clicks:(window.__clicks||[]).length,accept:(window.__accept||[]),'
  + ' roleMenu:!!document.querySelector(".cp-role-menu:not(.cp-add-menu):not(.cp-guard-menu):not(.cp-model-menu)"),'
  + ' modelMenu:!!document.querySelector(".cp-model-menu"),guardMenu:!!document.querySelector(".cp-guard-menu")})})()'
const JS_CLICK_ADD = '(function(){var b=document.querySelector(".cp-add .cp-plus");if(!b)return "no";b.click();return "ok"})()'
const JS_PICK = (i) => '(function(){var m=document.querySelector(".cp-add-menu");if(!m)return "no-menu";'
  + 'var it=m.querySelectorAll(".cp-role-item")[' + i + '];if(!it)return "no-item";it.click();return "ok"})()'
const JS_CLICK = (sel) => '(function(){var b=document.querySelector("' + sel + '");if(!b)return "no";b.click();return "ok"})()'

const b = await launch({ headless: true })
const p = await b.newPage()
await p.enable()
try {
  await p.goto(BASE + '/', 5000)
  await p.eval(JS_LOGIN)
  await p.goto(BASE + '/', 5000)
  await p.eval(JS_SPY)
  await p.eval(JS_OPEN)
  await sleep(1600)

  console.log('== ① ＋ 菜单内容 ==')
  await p.eval(JS_CLICK_ADD); await sleep(350)
  let s = JSON.parse(await p.eval(JS_ST))
  ok(s.menu, '点 ＋ 后菜单出现')
  ok(/给 AI 一份材料/.test(s.hd), '菜单标题「给 AI 一份材料」', s.hd)
  ok(s.items.length === 3, '三项入口', JSON.stringify(s.items))
  ok(s.items.some(x => /Excel \/ CSV/.test(x)), '表格项带说明')
  ok(s.items.some(x => /截图或照片/.test(x)), '图片项带说明')
  ok(s.ctl === 7, '控件数仍 7（＋ 没变成两个控件）', 'ctl=' + s.ctl)
  ok(s.rows === 1 && s.centers === 1, '仍单行 + 同一中线', 'rows=' + s.rows + ' centers=' + s.centers)
  await p.screenshot(DIR + '/加号菜单.png')

  console.log('\n== ② 选「上传表格」→ accept 与唤起行为 ==')
  await p.eval(JS_PICK(0)); await sleep(500)
  s = JSON.parse(await p.eval(JS_ST))
  ok(s.clicks === 1, '**真的触发了文件选择框**（不是只关掉菜单）', 'clicks=' + s.clicks)
  ok(s.accept[0] === '.xlsx,.xls,.csv', 'accept = 表格类型', s.accept[0])
  ok(!s.menu, '选择后菜单自动收起')

  console.log('\n== ③ 选「上传图片」/「上传文件」→ accept 各自不同 ==')
  await p.eval(JS_CLICK_ADD); await sleep(250); await p.eval(JS_PICK(1)); await sleep(500)
  s = JSON.parse(await p.eval(JS_ST))
  ok(s.accept[1] === '.jpg,.jpeg,.png,.gif,.webp', '图片项 accept 正确', s.accept[1])
  await p.eval(JS_CLICK_ADD); await sleep(250); await p.eval(JS_PICK(2)); await sleep(500)
  s = JSON.parse(await p.eval(JS_ST))
  ok(s.accept[2] === '.pdf,.txt,.md,.json', '文件项 accept 正确', s.accept[2])
  ok(s.clicks === 3, '三次都真的唤起了选择框', 'clicks=' + s.clicks)

  console.log('\n== ④ 4 个下拉互斥 + 点外关闭 ==')
  await p.eval(JS_CLICK_ADD); await sleep(250)
  await p.eval(JS_CLICK('.cp-model-btn')); await sleep(300)
  s = JSON.parse(await p.eval(JS_ST))
  ok(!s.menu && s.modelMenu, '打开「模型」后 ＋菜单已收起')
  await p.eval(JS_CLICK_ADD); await sleep(250)
  await p.eval(JS_CLICK('.cp-guard-btn')); await sleep(300)
  s = JSON.parse(await p.eval(JS_ST))
  ok(!s.menu && s.guardMenu, '打开「权限」后 ＋菜单已收起')
  await p.eval(JS_CLICK_ADD); await sleep(250)
  await p.eval(JS_CLICK('.cp-role')); await sleep(300)
  s = JSON.parse(await p.eval(JS_ST))
  ok(!s.menu && s.roleMenu, '打开「团队」后 ＋菜单已收起')
  await p.eval(JS_CLICK_ADD); await sleep(250)
  await p.eval('(function(){var t=document.querySelector(".cp-input");'
    + 't.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}));return "ok"})()')
  await sleep(300)
  s = JSON.parse(await p.eval(JS_ST))
  ok(!s.menu, '点输入框（菜单外）后 ＋菜单收起')
  ok((p.errors || []).length === 0, '0 控制台报错', JSON.stringify((p.errors || []).slice(0, 2)))
} catch (e) {
  fail++; console.log('  ❌ 异常：' + (e && e.message ? e.message : e))
} finally {
  console.log('\n===== ＋菜单探针：PASS ' + pass + ' / FAIL ' + fail + ' =====')
  await b.close()
  process.exit(fail ? 1 : 0)
}
