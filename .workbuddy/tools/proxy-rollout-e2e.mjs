/**
 * proxy-rollout-e2e.mjs —— 副驾代理层 P2 放量验收（真机、只读）
 *
 * 放量后应然：
 *   ① 有 chat 权限的账号（supervisor）⇒ 走代理 `/api/ai/copilot/chat`，且**不再**打 /hermes
 *   ② 无 chat 权限的账号（sales）⇒ 代理 403 ⇒ **自动退回** /hermes，副驾照常可用（关键保险）
 *
 * 🔴 只读：唯一写是 localStorage（token + 开关）。
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const SHOT_DIR = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/副驾代理层-2026-09-24'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const log = (s) => console.log(s)
try { fs.mkdirSync(SHOT_DIR, { recursive: true }) } catch { /* ignore */ }

let pass = 0, fail = 0
const ok = (c, n, e) => { if (c) { pass++; log('  ✅ ' + n + (e ? '　→ ' + e : '')) } else { fail++; log('  ❌ ' + n + (e ? '　→ ' + e : '')) } }

const JS_LOGIN = (u, p) => 'fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},'
  + 'body:JSON.stringify({username:' + JSON.stringify(u) + ',password:' + JSON.stringify(p) + '})})'
  + '.then(r=>r.json()).then(d=>{if(!d.token)return "NO:"+JSON.stringify(d).slice(0,90);'
  + 'localStorage.setItem("hergent_v2_token",d.token);'
  + 'if(d.csrf_token)localStorage.setItem("hergent_v2_csrf",d.csrf_token);'
  + 'if(d.user)localStorage.setItem("hergent_v2_user",JSON.stringify(d.user));'
  + 'if(d.tenant_id)localStorage.setItem("hergent_v2_tenant",String(d.tenant_id));return "OK"})'

const JS_SPY = '(function(){window.__urls=[];window.__sts=[];if(!window.__of){window.__of=window.fetch;}'
  + 'window.fetch=function(u,o){var pr=window.__of.apply(this,arguments);'
  + 'try{var s=(typeof u==="string")?u:((u&&u.url)||"");window.__urls.push(s);'
  + ' if(pr&&pr.then){pr.then(function(r){window.__sts.push({u:s,s:r.status});return r},function(e){window.__sts.push({u:s,s:"ERR"});});}}catch(_){}'
  + 'return pr};return "spy"})()'

const JS_OPEN = '(function(){var d=document.querySelector(".copilot");if(d)return "already";'
  + 'var b=document.querySelector(".tb-copilot");if(!b)return "no-btn";b.click();return "clicked"})()'

const JS_FILL = '(function(){var ta=document.querySelector(".cp-input");if(!ta)return "no-ta";'
  + 'var st=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,"value").set;'
  + 'st.call(ta,"只回复两个字：收到");ta.dispatchEvent(new Event("input",{bubbles:true}));return "filled"})()'
const JS_CLICK = '(function(){var btn=document.querySelector(".cp-send");'
  + 'if(!btn)return "no-btn";if(btn.disabled)return "DISABLED";btn.click();return "sent"})()'

const JS_ST = '(function(){var u=(window.__urls||[]);var st=(window.__sts||[]);'
  + 'return JSON.stringify({'
  + ' proxy:u.filter(function(x){return x.indexOf("/api/ai/copilot/chat")>=0}).length,'
  + ' hermes:u.filter(function(x){return x.indexOf("/hermes")>=0}).length,'
  + ' sts:st.filter(function(x){return x.u.indexOf("/api/ai/copilot/chat")>=0||x.u.indexOf("/hermes")>=0})'
  + '    .map(function(x){return x.u.replace(location.origin,"").slice(0,28)+"="+x.s}),'
  + ' msgs:document.querySelectorAll(".msg").length,'
  + ' lastAi:(function(){var a=document.querySelectorAll(".msg.assistant");'
  + '   return a.length?((a[a.length-1].innerText||"").trim().length):0})()})})()'

const browser = await launch({ headless: true })

async function runCase(label, user, pass_) {
  log(`\n== ${label}（${user}）==`)
  const page = await browser.newPage()
  await page.enable()
  try {
    await page.goto(BASE + '/', 5000)
    const lr = await page.eval(JS_LOGIN(user, pass_))
    if (String(lr).slice(0, 2) === 'NO') throw new Error('登录失败 ' + lr)
    await page.goto(BASE + '/', 5000)     // 带 token 重载
    await page.eval(JS_SPY)
    await page.eval(JS_OPEN)
    await sleep(1200)
    await page.eval(JS_FILL)
    await sleep(400)
    log('  click: ' + await page.eval(JS_CLICK))
    await sleep(4000)
    const s = JSON.parse(await page.eval(JS_ST))
    log('  请求/状态: ' + JSON.stringify(s.sts))
    await page.screenshot(`${SHOT_DIR}/P2-${user}.png`)
    return s
  } finally {
    // cdp-lite 的 page 没有 close()；留到 browser.close() 统一收尾
  }
}

try {
  // ① supervisor：已开 chat 权限 ⇒ 走代理
  const a = await runCase('有 chat 权限', 'mptestsp', 'Mpsup@1')
  ok(a.proxy >= 1, '走了代理端点', 'proxy=' + a.proxy)
  ok(a.hermes === 0, '不再直连 /hermes', 'hermes=' + a.hermes)
  ok(a.msgs >= 2 && a.lastAi > 0, '副驾正常出回复（一问一答且助手有内容）',
    'msgs=' + a.msgs + ' lastAiLen=' + a.lastAi)

  // ② sales：无 chat 权限 ⇒ 代理 403 ⇒ 自动退回 /hermes
  const b = await runCase('无 chat 权限', 'mptest', 'Mptest@1')
  ok(b.proxy >= 1, '先尝试了代理端点', 'proxy=' + b.proxy)
  ok(b.hermes >= 1, '403 后自动退回既有 /hermes（副驾没被关掉）', 'hermes=' + b.hermes)
  ok(b.sts.some(x => x.indexOf('/api/ai/copilot/chat') >= 0 && x.indexOf('=403') >= 0),
    '代理确实返回 403（证明退回是被权限触发的）', JSON.stringify(b.sts))
  ok(b.msgs >= 2 && b.lastAi > 0, '退回后副驾照常出回复',
    'msgs=' + b.msgs + ' lastAiLen=' + b.lastAi)
} catch (e) {
  fail++; log('  ❌ 探针异常：' + (e && e.message ? e.message : e))
} finally {
  log('\n===== P2 放量探针：PASS ' + pass + ' / FAIL ' + fail + ' =====')
  log('截图目录：' + SHOT_DIR)
  await browser.close()
  process.exit(fail ? 1 : 0)
}
