// v297 真机证据截图（只读：不点保存、不写任何数据）
//   OUT=outputs目录 PROBE_USER=... PROBE_PASS=... node v297-shot.mjs <outDir>
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
const U = process.env.PROBE_USER, P = process.env.PROBE_PASS
if (!U || !P) { console.log('缺 PROBE_USER / PROBE_PASS'); process.exit(1) }
const OUT = process.argv[2]
if (!OUT) { console.log('用法: node v297-shot.mjs <outDir>'); process.exit(1) }
const J = (fn) => '(function(){' + fn + '})()'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const b = await launch({ headless: true })
const p = await b.newPage()
try {
  await p.enable()
  await p.goto('https://hergent.cn/', 4000)
  const s = JSON.parse(await p.eval(J(
    "return fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'}," +
    "body:JSON.stringify({username:'" + U + "',password:'" + P + "'})}).then(function(r){return r.json()}).then(function(d){" +
    "return JSON.stringify({t:d.access_token||d.token||'',u:JSON.stringify(d.user||{}),tid:String(d.tenant_id||''),c:d.csrf_token||''})})")))
  if (!s.t) throw new Error('登录失败')
  const initId = await p.addInitScript(
    "try{localStorage.setItem('hergent_v2_token'," + JSON.stringify(s.t) + ");" +
    "localStorage.setItem('hergent_v2_user'," + JSON.stringify(s.u) + ");" +
    "localStorage.setItem('hergent_v2_tenant'," + JSON.stringify(s.tid) + ");" +
    "localStorage.setItem('hergent_v2_csrf'," + JSON.stringify(s.c) + ");}catch(e){}")
  await p.goto('https://hergent.cn/?__shot=' + Date.now() + '#/forecast?tab=config', 11000)
  await p.removeInitScript(initId).catch(() => {})
  await sleep(1200)
  await p.eval(J("var bs=[...document.querySelectorAll('button')];var n=bs.find(function(b){return /新建配置/.test(b.innerText||'')});if(n)n.click();return 1"))
  await sleep(1800)

  const fieldOf = (re) => "var fs=[...document.querySelectorAll('.field')];var f=fs.find(function(x){return new RegExp('" + re + "').test(x.innerText||'')});"
  const focusAlias = async () => {
    await p.eval(J(fieldOf('报单简称') + "var i=f&&f.querySelector('input');if(i){i.focus();i.dispatchEvent(new Event('focus',{bubbles:true}));}return 1"))
    await sleep(900)
  }
  const pickObj = async (kw) => {
    await p.eval(J(fieldOf('全称') + "var i=f&&f.querySelector('input');if(i){i.focus();i.value=" + JSON.stringify(kw) + ";i.dispatchEvent(new Event('input',{bubbles:true}));}return 1"))
    await sleep(900)
    await p.eval(J(fieldOf('全称') + "var its=f?[...f.querySelectorAll('.combo-item')]:[];if(its.length)its[0].dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));return 1"))
    await sleep(1300)
  }
  const setAlias = async (v) => {
    await p.eval(J(fieldOf('报单简称') + "var i=f&&f.querySelector('input');if(i){i.focus();i.value=" + JSON.stringify(v) + ";i.dispatchEvent(new Event('input',{bubbles:true}));}return 1"))
    await sleep(900)
  }
  const blur = async () => { await p.eval(J("if(document.activeElement)document.activeElement.blur();return 1")); await sleep(400) }

  // ① 名册下拉：只列真实列头
  await focusAlias()
  console.log(await p.screenshot(OUT + '/真机-01-名册只列真实列头.png'))

  // ② 选一个"对象已被占用"的门店 → 对象级 err 提示 + 点保存被就地拦下
  await p.eval(J("var i=document.body;if(i&&i.click)i.click();return 1"))
  await sleep(300)
  await pickObj('美联（保康店）')
  await p.eval(J(
    "var ms=[...document.querySelectorAll('.df-modal')];" +
    "var md=ms.find(function(m){return /报单简称/.test(m.innerText||'')});" +
    "var bt=md&&md.querySelector('.df-modal-ft .btn-primary');if(bt)bt.click();return 1"))
  await sleep(900)
  console.log(await p.screenshot(OUT + '/真机-02-同一对象只能一条配置保存被拒.png'))

  // ③ 相近列头一键改选（对象全称里含两个真列头，warn 态才渲染该区块）
  await pickObj('东津民发广场')
  await setAlias('__探针不存在的列__')
  await blur()
  console.log(await p.screenshot(OUT + '/真机-03-名册外名字与相近列头一键改选.png'))
} finally {
  console.log('console.errors:', JSON.stringify((p.errors || []).slice(0, 5)))
  await b.close()
}
