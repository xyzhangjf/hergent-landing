/**
 * v264-product-target-dialog.mjs —— 商品目标「新建目标」弹窗真机取证（**不开保存**）
 *
 * 目的：把弹窗里**紧挨目标量输入框的换算提示**逐字读出来，验证它说的是不是系统真值。
 *
 * 真值（生产 tenant 商品 id=1449「蒙牛0蔗糖原味百利包150g*5袋*8包」）：
 *   unit='袋'（小）  medium_unit='包'/medium_ratio=5（⇒ 5 袋 = 1 包）
 *   large_unit='件'/large_ratio=40（⇒ 40 袋 = 1 件）
 *   ⇒ 正确写法只有两种：「1 件 = 40 袋」或「1 件 = 8 包（= 40 袋）」
 *   ⇒ **「1 件 = 8 袋」是错的**（把中单位数量 8，贴上了小单位的名字 袋）
 *
 * 🔴 只读：不点保存、不选员工、不改任何数据。
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const USER = process.env.HG_USER || 'mptestsp'
const PASS = process.env.HG_PASS || 'Mpsup@1'
const SHOT_DIR = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v264-商品目标P0-2026-09-24'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const log = (s) => console.log(s)

const JS_LOGIN = (u, p) => 'fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},'
  + 'body:JSON.stringify({username:' + JSON.stringify(u) + ',password:' + JSON.stringify(p) + '})})'
  + '.then(r=>r.json()).then(d=>{if(!d.token)return "NO";'
  + 'localStorage.setItem("hergent_v2_token",d.token);'
  + 'if(d.csrf_token)localStorage.setItem("hergent_v2_csrf",d.csrf_token);'
  + 'if(d.user)localStorage.setItem("hergent_v2_user",JSON.stringify(d.user));'
  + 'if(d.tenant_id)localStorage.setItem("hergent_v2_tenant",String(d.tenant_id));return "OK"})'

const JS_CLICK_NEW = '(()=>{var b=Array.from(document.querySelectorAll("button")).find(function(x){'
  + 'return (x.innerText||"").trim()==="新建目标"});if(!b)return "NOTFOUND";b.click();return "CLICKED"})()'

/* 勾选商品：v-model 监听 input 事件，直接改 value 不触发 ⇒ 必须手动派发 */
const JS_TYPE_PICK = (kw) => '(()=>{var i=document.querySelector(".pt-pick-in");if(!i)return "NOPICK";'
  + 'var setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set;'
  + 'setter.call(i,' + JSON.stringify(kw) + ');'
  + 'i.dispatchEvent(new Event("input",{bubbles:true}));return "TYPED"})()'

const JS_PICK_LIST = '(()=>{var out=[];'
  + 'document.querySelectorAll(".pt-pick-item").forEach(function(b){'
  + 'var nm=b.querySelector(".pt-pick-nm"),mt=b.querySelector(".pt-pick-meta"),wn=b.querySelector(".pt-pick-warn");'
  + 'out.push({name:nm?(nm.innerText||"").trim():"",meta:mt?(mt.innerText||"").trim().replace(/\\s+/g," "):"",'
  + 'warn:wn?(wn.innerText||"").trim():"",dis:b.className.indexOf("dis")>=0})});'
  + 'return JSON.stringify({n:out.length,items:out.slice(0,40)})})()'

/* 目标量那一行的**逐字**文本（这是本次取证的核心） */
const JS_QTY_ROW = '(()=>{var q=document.querySelector(".pt-qty");'
  + 'return JSON.stringify({qty:q?(q.innerText||"").trim().replace(/\\s+/g," "):null,'
  + 'unit:q&&q.querySelector(".pt-qty-u")?(q.querySelector(".pt-qty-u").innerText||"").trim():null,'
  + 'hint:q&&q.querySelector(".pt-quiet")?(q.querySelector(".pt-quiet").innerText||"").trim().replace(/\\s+/g," "):null})})()'

const JS_PICK_ONE = (name) => '(()=>{var t=' + JSON.stringify(name) + ';'
  + 'var b=Array.from(document.querySelectorAll(".pt-pick-item")).find(function(x){'
  + 'var nm=x.querySelector(".pt-pick-nm");return nm&&(nm.innerText||"").indexOf(t)>=0});'
  + 'if(!b)return "NOTFOUND";b.click();return "PICKED"})()'

const JS_ALLOC_ROW = '(()=>{var t=document.querySelector(".pt-sub-in tbody tr");'
  + 'var sig=document.querySelector(".pt-sigma");'
  + 'return JSON.stringify({sigma:sig?(sig.innerText||"").trim().replace(/\\s+/g," "):null,'
  + 'sigmaOk:sig?String(sig.className).indexOf("ok")>=0:null,'
  + 'row:t?(t.innerText||"").trim().replace(/\\s+/g," "):null})})()'

/* 「保存」按钮状态：**必须同时读 disabled 与计算样式 opacity**。
   v264b 实测的缺陷正是「disabled=true 但视觉与可用态逐属性相同」⇒ 只读 disabled 会全绿，
   看不出用户实际看到的是「一个看着能点、点了没反应的按钮」。 */
const JS_BTN_DISABLED = '(()=>{var b=Array.from(document.querySelectorAll(".pt-modal-ft button")).find(function(x){'
  + 'return (x.innerText||"").trim()==="保存"});if(!b)return "NOBTN";'
  + 'var cs=getComputedStyle(b);'
  + 'return "disabled="+b.disabled+" opacity="+cs.opacity+" cursor="+cs.cursor})()'

let browser, failed = false
try {
  fs.mkdirSync(SHOT_DIR, { recursive: true })
  browser = await launch()
  const page = await browser.newPage()
  await page.enable()

  log('=== 登录 + 进商品目标页 ===')
  await page.goto(BASE, 3500)
  log('  ' + await page.eval(JS_LOGIN(USER, PASS)))
  await page.goto(BASE + '/#/product-target', 6000)

  log('')
  log('=== 打开「新建目标」 ===')
  log('  ' + await page.eval(JS_CLICK_NEW))
  await sleep(1200)

  log('')
  log('=== 搜「原味百利包」 → 读候选清单（**列全部**，上次只列前 8 条导致选错品） ===')
  log('  ' + await page.eval(JS_TYPE_PICK('原味百利包')))
  await sleep(1800)
  const pl = JSON.parse((await page.eval(JS_PICK_LIST)) || '{"n":0,"items":[]}')
  log('  候选 ' + pl.n + ' 条：')
  ;(pl.items || []).forEach(p => log('   ├ ' + p.name + '　→「' + p.meta + '」'
    + (p.warn ? ' ⚠' + p.warn : '') + (p.dis ? '  [禁选]' : '')))

  log('')
  log('=== 选中 id=1449「蒙牛0蔗糖原味百利包150g*5袋*8包」→ 读目标量那一行 ===')
  log('  ' + await page.eval(JS_PICK_ONE('原味百利包150g')))
  await sleep(900)
  const q = JSON.parse((await page.eval(JS_QTY_ROW)) || '{}')
  log('  目标量单位 = 「' + q.unit + '」')
  log('  换算提示   = 「' + q.hint + '」')
  log('  整行文本   = 「' + q.qty + '」')

  const SHOT = SHOT_DIR + '/v264-新建目标弹窗-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '') + '.png'
  try { await page.screenshot(SHOT); log('  截图：' + SHOT) } catch { }

  log('')
  log('=== 选人 + 读 Σ 占比实时提示 ===')
  const JS_ADD_TWO = '(()=>{var es=document.querySelectorAll(".pt-emp");'
  + 'if(es.length<1)return "NOEMP";var n=0;'
  + 'for(var i=0;i<es.length&&n<2;i++){if(!es[i].disabled){es[i].click();n++}}return "ADDED"+n})()'
  log('  ' + await page.eval(JS_ADD_TWO))
  await sleep(700)
  const a0 = JSON.parse((await page.eval(JS_ALLOC_ROW)) || '{}')
  log('  Σ（占比全 0）= 「' + a0.sigma + '」 sigmaOk=' + a0.sigmaOk + '｜保存按钮 disabled=' + await page.eval(JS_BTN_DISABLED))

  const JS_SET_TARGET = '(()=>{var i=document.querySelector(".pt-qty-in");if(!i)return "NOQTY";'
  + 'var s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set;'
  + 's.call(i,"150");i.dispatchEvent(new Event("input",{bubbles:true}));return "OK"})()'
  log('  填目标量 150 箱：' + await page.eval(JS_SET_TARGET))
  await sleep(400)

  const JS_SET_RATIO = (vals) => '(()=>{var ins=document.querySelectorAll(".pt-ratio");'
  + 'var v=' + JSON.stringify(vals) + ';var s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set;'
  + 'for(var i=0;i<ins.length&&i<v.length;i++){s.call(ins[i],String(v[i]));ins[i].dispatchEvent(new Event("input",{bubbles:true}))}'
  + 'return "SET"+ins.length})()'
  log('  把两人占比设成 40 / 60：' + await page.eval(JS_SET_RATIO([40, 60])))
  await sleep(500)
  const a1 = JSON.parse((await page.eval(JS_ALLOC_ROW)) || '{}')
  log('  Σ（40+60）   = 「' + a1.sigma + '」 sigmaOk=' + a1.sigmaOk)
  log('  分解行       = 「' + a1.row + '」')
  log('  保存按钮 disabled=' + await page.eval(JS_BTN_DISABLED))

  log('  再把第二人改成 50（Σ=90）：' + await page.eval(JS_SET_RATIO([40, 50])))
  await sleep(500)
  const a2 = JSON.parse((await page.eval(JS_ALLOC_ROW)) || '{}')
  log('  Σ（40+50）   = 「' + a2.sigma + '」 sigmaOk=' + a2.sigmaOk + '｜保存按钮 disabled=' + await page.eval(JS_BTN_DISABLED))

  try { await page.screenshot(SHOT_DIR + '/v264-弹窗分解Σ-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '') + '.png') } catch { }

  log('')
  const errs = page.errors.slice()
  log('=== 控制台错误 ' + errs.length + ' 条 ===')
  errs.slice(0, 8).forEach(e => log('   ' + e.slice(0, 200)))
  if (errs.length > 4) failed = true

  log('')
  log('（本脚本不点保存，弹窗随浏览器关闭而丢弃）')
} catch (e) {
  log('脚本异常：' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : e))
  failed = true
} finally {
  if (browser) { try { await browser.close() } catch { } }
  process.exit(failed ? 1 : 0)
}
