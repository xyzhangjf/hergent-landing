// v281 验收探针：撤除「直连通道」开关 + 关闭前端直连路径 + 设置页 Key 卡改造
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'

const BASE = 'https://hergent.cn'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
let pass = 0, fail = 0
const ok = (c, n, e) => { if (c) { pass++; console.log('  ✅ ' + n + (e ? '　→ ' + e : '')) } else { fail++; console.log('  ❌ ' + n + (e ? '　→ ' + e : '')) } }

const LOGIN = 'fetch("https://hergent.cn/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},'
  + 'body:JSON.stringify({username:"mptestsp",password:"Mpsup@1"})}).then(r=>r.json()).then(d=>{'
  + 'localStorage.setItem("hergent_v2_token",d.token);'
  + 'if(d.csrf_token)localStorage.setItem("hergent_v2_csrf",d.csrf_token);'
  + 'if(d.user)localStorage.setItem("hergent_v2_user",JSON.stringify(d.user));'
  + 'if(d.tenant_id)localStorage.setItem("hergent_v2_tenant",String(d.tenant_id));return "OK"})'

// 记录所有出站 AI 请求，用于证明「不再打 /hermes/」
const TRACE = `(function(){
  if (window.__traced) return 'already'
  window.__traced = 1; window.__reqs = []
  var of = window.fetch
  window.fetch = function(u, o){ try{ window.__reqs.push(String(u)) }catch(e){} ; return of.apply(this, arguments) }
  return 'traced'
})()`

const TOOLBAR = `(()=>{
  const tb = document.querySelector('.cp-toolbar')
  if (!tb) return JSON.stringify({err:'no-toolbar'})
  // 控件口径要连 div 形态的一起数：cp-role（团队）是 div 不是 button ——
  // 只查 button/label 会漏掉它（上一版探针就这么误判成 4 个控件）。
  // 控件口径 = **最外层**标识：cp-add（＋菜单容器，里面还套着 cp-plus 按钮，
  // 二者是同一个控件，不能各数一次）、cp-role（团队，div）、cp-guard-btn、cp-voice、cp-send。
  const ctrls = [].slice.call(tb.querySelectorAll('.cp-add,.cp-role,.cp-guard-btn,.cp-voice,.cp-send'))
  return JSON.stringify({
    toolbarText: tb.innerText.replace(/\\s+/g,' ').trim(),
    ctrlCount: ctrls.length,
    ctrlList: ctrls.map(e => e.className.split(' ')[0]).join(','),
    hasPlusBtn: !!tb.querySelector('.cp-add .cp-plus'),
    hasProxyBtn: !!document.querySelector('.cp-proxy-btn'),
    proxyTextInApp: document.body.innerText.indexOf('自动降级') >= 0,
    directTextInApp: document.body.innerText.indexOf('直连通道') >= 0,
    guard: !!document.querySelector('.cp-guard-btn'),
    add: !!document.querySelector('.cp-add'),
    role: !!document.querySelector('.cp-role'),
    send: !!document.querySelector('.cp-send'),
    voice: !!document.querySelector('.cp-voice')
  })})()`

const SEND = `(function(){
  var ta = document.querySelector('.cp-input'); if (!ta) return 'no-ta'
  var st = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set
  st.call(ta,'只回两个字：收到'); ta.dispatchEvent(new Event('input',{bubbles:true}))
  return 'filled'})()`
const CLICK_SEND = `(function(){var b=document.querySelector('.cp-send');if(!b||b.disabled)return 'disabled';b.click();return 'sent'})()`

const b = await launch({ headless: true })
const p = await b.newPage(); await p.enable()
try {
  await p.goto(BASE + '/', 6000)
  await p.eval(LOGIN)
  await p.goto(BASE + '/', 6000)
  await p.eval(TRACE)

  // ── ① 输入框：开关是否整条消失、其余控件是否完好
  await p.eval('(function(){var d=document.querySelector(".copilot");if(d)return "already";var b=document.querySelector(".tb-copilot");if(!b)return "no-btn";b.click();return "clicked"})()')
  await sleep(1800)
  const t = JSON.parse(await p.eval(TOOLBAR))
  if (t.err) { console.log('  ❌ 工具条不存在:', t.err); fail++ } else {
    ok(!t.hasProxyBtn, '「自动降级」按钮已消失（.cp-proxy-btn 不存在）')
    ok(!t.proxyTextInApp, '页面上已无「自动降级」字样')
    ok(!t.directTextInApp, '页面上已无「直连通道」字样')
    ok(t.ctrlCount === 5, '工具条控件数 = 5（原 6）', String(t.ctrlCount) + ' 个: ' + t.ctrlList + ' | ' + t.toolbarText)
    ok(t.guard && t.add && t.role && t.send && t.voice, '其余控件（＋/只给建议/团队/语音/发送）都还在')
  }

  // ── ② 发一条消息：证明只走代理、完全不碰 /hermes/
  await p.eval(SEND); await sleep(600)
  const sent = await p.eval(CLICK_SEND)
  ok(sent === 'sent', '发送按钮可用并已点击', sent)
  await sleep(12000)
  const st = await p.eval(`(()=>{const ms=document.querySelectorAll('.msg-bubble');const last=ms[ms.length-1];
    return JSON.stringify({bubbles:ms.length, lastText:last?last.innerText.replace(/\\s+/g,' ').slice(0,60):''})})()`)
  const s = JSON.parse(st)
  ok(s.bubbles >= 2 && s.lastText.length > 0, '副驾正常回复（走代理链路）', s.lastText)
  const reqs = JSON.parse(await p.eval('JSON.stringify(window.__reqs||[])'))
  const toHermes = reqs.filter(u => u.indexOf('/hermes/') >= 0)
  const toProxy = reqs.filter(u => u.indexOf('/api/ai/copilot/chat') >= 0)
  ok(toHermes.length === 0, '本轮**没有**任何请求打到 /hermes/（直连路径已断）', JSON.stringify(toHermes))
  ok(toProxy.length >= 1, '本轮确实走了 /api/ai/copilot/chat', toProxy.length + ' 次')
  await p.screenshot('/Users/zhangjunfeng/Documents/laozhangai-product/outputs/安全-v281/输入框-撤除开关后.png')
  ok((p.errors || []).length === 0, '0 报错', JSON.stringify((p.errors || []).slice(0, 2)))

  // ── ③ 设置页：Key 输入框应消失、测试连接应打后端且成功
  //    🔴 本应用是 **hash 路由**（createWebHashHistory）⇒ 必须走 `/#/settings?tab=ai`，
  //       写成 `/settings?tab=ai` 会落回默认页（上一版探针就这么误判了）。
  await p.goto(BASE + '/#/settings?tab=ai', 6000)
  await sleep(3000)
  const set = JSON.parse(await p.eval(`(()=>{
    const card = [].slice.call(document.querySelectorAll('.card')).find(c=>c.innerText.indexOf('AI 副驾连接')>=0 || c.innerText.indexOf('Hermes API 连接')>=0)
    const pw = document.querySelectorAll('input[type=password]').length
    return JSON.stringify({
      found: !!card,
      cardText: card ? card.innerText.replace(/\\s+/g,' ').slice(0,120) : '',
      pwInputs: pw,
      hasSaveBtn: document.body.innerText.indexOf('Hermes API Server Key') >= 0
    })})()`))
  ok(set.found, '设置页存在「AI 副驾连接」卡片', set.cardText)
  ok(set.pwInputs === 0, '卡上已无密码输入框（前端不再存 Key）', 'password inputs=' + set.pwInputs)
  ok(!set.hasSaveBtn, '「Hermes API Server Key」输入提示已移除')
  const testClicked = await p.eval(`(()=>{const bs=[].slice.call(document.querySelectorAll('button')).filter(b=>b.innerText.trim()==='测试连接');if(!bs.length)return 'no-btn';bs[0].click();return 'clicked'})()`)
  ok(testClicked === 'clicked', '找到并点击「测试连接」', testClicked)
  await sleep(3500)
  const res = await p.eval(`(()=>{const e=document.querySelector('.set-result');return e?e.innerText.trim():'(无结果)'})()`)
  ok(/连接正常/.test(res), '测试连接 → 打后端真实链路并返回「连接正常」', res)
  await p.screenshot('/Users/zhangjunfeng/Documents/laozhangai-product/outputs/安全-v281/设置页-连接检测.png')
} finally { await b.close() }

console.log('\n===== v281 验收：PASS ' + pass + ' / FAIL ' + fail + ' =====')
process.exit(fail ? 1 : 0)
