/**
 * m1-slash-e2e.mjs —— M1「对话内斜杠命令」**真机只读**验收
 *
 * 要证的事：
 *   A 真实数据面：在副驾输入 `/` ⇒ 快捷指令浮层**必须出现**，命令清单 = 权限过滤后的预期集
 *   B 过滤：输入 `/库` ⇒ 只剩 `/查库存`
 *   C 键盘：↑↓ 移动高亮；Enter 选中「跳转页面」类命令 ⇒ 真跳转 + 浮层消失
 *   D Esc：关闭浮层，但**草稿保留**（不吞用户已打的字）
 *   E 反例对照：普通文本 / 含空格的 `/xx yy` ⇒ **不弹**浮层（证明它由「首词是 /指令」驱动）
 *
 * 🔴 全程只读：不点新建/保存/删除；唯一写是页面内 localStorage 种 token。
 *   Enter 选择只挑「跳转页面」类命令（纯前端路由，零服务端写、零 AI 调用）。
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const USER = process.env.HG_USER || 'mptestsp'
const PASS = process.env.HG_PASS || 'Mpsup@1'
const SHOT_DIR = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/M1-斜杠命令-2026-09-24'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const log = (s) => console.log(s)
try { fs.mkdirSync(SHOT_DIR, { recursive: true }) } catch { /* ignore */ }

let pass = 0, fail = 0
const ok = (cond, name, extra) => {
  if (cond) { pass++; log('  ✅ ' + name + (extra ? '　→ ' + extra : '')) }
  else { fail++; log('  ❌ ' + name + (extra ? '　→ ' + extra : '')) }
  return !!cond
}

const JS_LOGIN = (u, p) => 'fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},'
  + 'body:JSON.stringify({username:' + JSON.stringify(u) + ',password:' + JSON.stringify(p) + '})})'
  + '.then(r=>r.json()).then(d=>{if(!d.token)return "NO:"+JSON.stringify(d).slice(0,150);'
  + 'localStorage.setItem("hergent_v2_token",d.token);'
  + 'if(d.csrf_token)localStorage.setItem("hergent_v2_csrf",d.csrf_token);'
  + 'if(d.user)localStorage.setItem("hergent_v2_user",JSON.stringify(d.user));'
  + 'if(d.tenant_id)localStorage.setItem("hergent_v2_tenant",String(d.tenant_id));return "OK"})'

/** 在页面内设置 textarea 值并派发 input（触发 v-model + autoGrow） */
const JS_TYPE = (q) => '(function(){var ta=document.querySelector(".cp-input");if(!ta)return JSON.stringify({err:"no textarea"});'
  + 'var st=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,"value").set;'
  + 'st.call(ta,' + JSON.stringify(q) + ');ta.dispatchEvent(new Event("input",{bubbles:true}));'
  + 'return JSON.stringify({ok:true,val:ta.value})})()'

/** 读取斜杠浮层状态 + 权限（用于现算预期命令集） */
const JS_STATE = '(function(){'
  + 'var es=document.querySelectorAll(".cp-slash");var e=es[0]||null;'
  + 'var items=[].slice.call(document.querySelectorAll(".cp-slash-item")).map(function(b){'
  + '  var c=b.querySelector(".cp-slash-cmd");return c?c.textContent.trim():"";});'
  + 'var groups=[].slice.call(document.querySelectorAll(".cp-slash-group")).map(function(g){return g.textContent.trim()});'
  + 'var o={count:es.length,exist:!!e,items:items,groups:groups};'
  + 'if(e){var rc=e.getBoundingClientRect(),cs=getComputedStyle(e);'
  + '  o.rect={w:Math.round(rc.width),h:Math.round(rc.height),top:Math.round(rc.top),bottom:Math.round(rc.bottom)};'
  + '  o.visible=rc.width>0&&rc.height>0;o.inViewport=(rc.top>=0&&rc.bottom<=window.innerHeight);'
  + '  o.bg=cs.backgroundColor;o.z=cs.zIndex;}'
  + 'var act=document.querySelector(".cp-slash-item.active");'
  + 'o.activeCmd=act?(act.querySelector(".cp-slash-cmd")||{}).textContent:null;'
  + 'var ta=document.querySelector(".cp-input");o.draft=ta?ta.value:null;'
  + 'o.drawer=!!document.querySelector(".copilot");o.path=location.pathname;'
  + 'var fe=document.querySelector(".cp-foot-hint");o.footHint=fe?fe.textContent.trim():null;'
  + 'return JSON.stringify(o)})()'

/** 按下某个键（真 KeyboardEvent，走 Vue @keydown） */
const JS_KEY = (key) => '(function(){var ta=document.querySelector(".cp-input");if(!ta)return "no-ta";'
  + 'ta.dispatchEvent(new KeyboardEvent("keydown",{key:' + JSON.stringify(key) + ',bubbles:true,cancelable:true}));'
  + 'return "ok"})()'

/** 打开副驾抽屉：点顶栏 .tb-copilot；若已开则不动 */
const JS_OPEN = '(function(){var d=document.querySelector(".copilot");if(d)return "already";'
  + 'var b=document.querySelector(".tb-copilot");if(!b)return "no-btn";b.click();return "clicked"})()'

/* 权限端点：与 store.canModule 同源（p.indexOf("*")>=0 || p.indexOf(m)>=0，null ⇒ 全放行） */
const JS_PERMS = 'fetch("/api/auth/permissions",{headers:{"Authorization":"Bearer "+localStorage.getItem("hergent_v2_token")}})'
  + '.then(function(r){return r.text().then(function(t){return JSON.stringify({s:r.status,t:t.slice(0,3000)})})})'

// 命令清单（与 CopilotDrawer.SLASH_COMMANDS 同源；module=权限门槛）
const CMDS = [
  ['/报单', 'data'], ['/查库存', 'stock'], ['/今日洞察', null], ['/生成日报', null], ['/审批提案', null],
  ['/催款', 'accounts'], ['/返利', 'sales'], ['/货损', 'stock'],
  ['/工作台', null], ['/预报', null], ['/返利政策', null], ['/商品目标', 'data'], ['/算工资', 'payroll'],
]
const ALWAYS = CMDS.filter(c => !c[1]).map(c => c[0])           // 无门槛 ⇒ 必现
const PATHS = { '/工作台': '/workbench', '/预报': '/forecast', '/返利政策': '/rebate', '/商品目标': '/product-target', '/算工资': '/payroll' }

const browser = await launch({ headless: true })
const page = await browser.newPage()
await page.enable()

try {
  log('== 登录并进入工作台 ==')
  await page.goto(BASE + '/', 5000)
  const loginRes = await page.eval(JS_LOGIN(USER, PASS))
  log('  login: ' + loginRes)
  if (String(loginRes).slice(0, 3) === 'NO:') throw new Error('登录失败：' + loginRes)
  await page.goto(BASE + '/workbench', 6000)

  // 现算「权限过滤后应有的命令集」
  let perms = null
  try {
    const pr = JSON.parse(await page.eval(JS_PERMS))
    if (pr && pr.s === 200) { const d = JSON.parse(pr.t); perms = Array.isArray(d.permissions) ? d.permissions : null }
  } catch { /* ignore */ }
  const canMod = (m) => { if (!perms) return true; return perms.indexOf('*') >= 0 || perms.indexOf(m) >= 0 }
  const expected = CMDS.filter(c => !c[1] || canMod(c[1])).map(c => c[0])
  log('  perms: ' + (perms ? JSON.stringify(perms) : 'null(全放行)'))
  log('  expected cmds: ' + JSON.stringify(expected))

  const opened = await page.eval(JS_OPEN)
  log('  open drawer: ' + opened)
  await sleep(700)

  log('\n== A 真实数据面：输入 / ==')
  await page.eval(JS_TYPE('/'))
  await sleep(400)
  let s = JSON.parse(await page.eval(JS_STATE))
  ok(s.drawer, '副驾抽屉已打开')
  ok(s.exist && s.count === 1, '斜杠浮层出现（且唯一）', 'count=' + s.count)
  ok(s.visible && s.rect && s.rect.h > 0, '浮层可见（非隐形）', s.rect ? JSON.stringify(s.rect) : '')
  ok(s.inViewport, '浮层完整落在视口内（未被裁切）', s.rect ? ('top=' + s.rect.top + ' bottom=' + s.rect.bottom) : '')
  ok(s.items[0] === '/报单', '首项是 /报单', s.items[0])
  ok(JSON.stringify(s.items) === JSON.stringify(expected), '命令集 = 权限过滤后的预期集',
    'dom=' + JSON.stringify(s.items) + ' exp=' + JSON.stringify(expected))
  for (const c of ALWAYS) ok(s.items.indexOf(c) >= 0, '必现命令 ' + c)
  ok(new Set(s.groups).size === s.groups.length && s.groups.length >= 1, '分组标题无重复', JSON.stringify(s.groups))
  await page.screenshot(SHOT_DIR + '/01-输入斜杠-浮层出现.png')

  log('\n== B 过滤（数据驱动：取当前可见的首个命令做子串过滤）==')
  // 🔴 不能写死 `/查库存` —— 它对 module=stock 的用户会被权限过滤掉（本账号 perms=["data","dashboard"]）。
  //    取**当前可见**的首个命令，用它的名字做子串，现算预期子集。
  const kwCmd = s.items[0]                       // 上一步 A 的可见命令集
  const kw = kwCmd.slice(1)
  const expSub = expected.filter(c => c.slice(1).toLowerCase().includes(kw.toLowerCase()))
  await page.eval(JS_TYPE('/' + kw))
  await sleep(350)
  s = JSON.parse(await page.eval(JS_STATE))
  ok(s.exist && JSON.stringify(s.items) === JSON.stringify(expSub),
    '输入 /' + kw + ' 过滤到预期子集 ' + JSON.stringify(expSub), 'dom=' + JSON.stringify(s.items))
  await page.screenshot(SHOT_DIR + '/02-过滤-' + kw + '.png')

  log('\n== C 键盘：ArrowDown 移动高亮 ==')
  await page.eval(JS_TYPE('/'))
  await sleep(300)
  const s0 = JSON.parse(await page.eval(JS_STATE))
  await page.eval(JS_KEY('ArrowDown'))
  await sleep(200)
  const s1 = JSON.parse(await page.eval(JS_STATE))
  ok(s1.activeCmd && s1.activeCmd !== s0.activeCmd, 'ArrowDown 使高亮下移', (s0.activeCmd || '') + ' → ' + (s1.activeCmd || ''))
  await page.eval(JS_KEY('ArrowUp'))
  await sleep(200)
  const s2 = JSON.parse(await page.eval(JS_STATE))
  ok(s2.activeCmd === s0.activeCmd, 'ArrowUp 回到首项', s2.activeCmd)

  log('\n== D Esc 关闭浮层但保留草稿 ==')
  await page.eval(JS_KEY('Escape'))
  await sleep(300)
  s = JSON.parse(await page.eval(JS_STATE))
  ok(!s.exist, 'Esc 后浮层消失')
  ok(s.draft === '/', '草稿保留为 /（未被吞）', JSON.stringify(s.draft))

  log('\n== E 反例对照：普通文本 / 含空格 ⇒ 不弹 ==')
  await page.eval(JS_TYPE('你好'))
  await sleep(300)
  s = JSON.parse(await page.eval(JS_STATE))
  ok(!s.exist, '普通文本「你好」不弹浮层')
  await page.eval(JS_TYPE('/查库存 你好'))
  await sleep(300)
  s = JSON.parse(await page.eval(JS_STATE))
  ok(!s.exist, '含空格的「/查库存 你好」不弹浮层（已是提问不是选命令）')
  await page.screenshot(SHOT_DIR + '/03-反例-不弹浮层.png')

  log('\n== F 真实选择：Enter 命中「跳转页面」命令 ⇒ 跳转 + 浮层消失 ==')
  const navCmd = expected.find(c => PATHS[c])
  ok(!!navCmd, '存在可见的跳转类命令', navCmd || '(none)')
  if (navCmd) {
    await page.eval(JS_TYPE(navCmd))
    await sleep(350)
    const before = JSON.parse(await page.eval(JS_STATE))
    ok(before.exist && before.items.length === 1 && before.items[0] === navCmd, '输入完整命令后仅剩该项', JSON.stringify(before.items))
    await page.eval(JS_KEY('Enter'))
    await sleep(900)
    const after = JSON.parse(await page.eval(JS_STATE))
    ok(after.path === PATHS[navCmd], 'Enter 后跳转到 ' + PATHS[navCmd], 'path=' + after.path)
    ok(!after.drawer, '跳转后副驾抽屉自动收起')
    ok(!after.exist, '跳转后浮层消失')
    await page.screenshot(SHOT_DIR + '/04-选中跳转-已跳页.png')
  }

  log('\n== 控制台 ==')
  const errs = page.errors || []
  ok(errs.length === 0, '全程 0 控制台报错', errs.length ? JSON.stringify(errs.slice(0, 4)) : '')
} catch (e) {
  fail++
  log('  ❌ 探针异常：' + (e && e.message ? e.message : e))
} finally {
  log('\n===== M1 斜杠命令探针：PASS ' + pass + ' / FAIL ' + fail + ' =====')
  log('截图目录：' + SHOT_DIR)
  await browser.close()
  process.exit(fail ? 1 : 0)
}
