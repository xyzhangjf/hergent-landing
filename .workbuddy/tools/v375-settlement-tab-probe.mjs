import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'

const BASE = 'https://hergent.cn'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
let pass = 0, fail = 0
const ok = (c, n, e) => { if (c) { pass++; console.log('  [OK] ' + n + (e ? '  -> ' + e : '')) } else { fail++; console.log('  [XX] ' + n + (e ? '  -> ' + e : '')) } }

const JS_LOGIN = 'fetch("/api/auth/demo-login",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"})'
  + '.then(r=>r.json()).then(d=>{var t=d.token||(d.data&&d.data.token);if(!t)return "NO";'
  + 'localStorage.setItem("hergent_v2_token",t);'
  + 'if(d.csrf_token)localStorage.setItem("hergent_v2_csrf",d.csrf_token);'
  + 'if(d.user)localStorage.setItem("hergent_v2_user",JSON.stringify(d.user));'
  + 'var tid=d.tenant_id||(d.data&&d.data.tenant_id);if(tid)localStorage.setItem("hergent_v2_tenant",String(tid));'
  + 'return "OK"}).catch(e=>"ERR:"+e)'

const JS_TABS = 'JSON.stringify([].slice.call(document.querySelectorAll(".main-tab")).map(function(e){return e.innerText.trim()}))'

const JS_CLICK = '(function(){var bs=document.querySelectorAll(".main-tab");'
  + 'for(var i=0;i<bs.length;i++){if(bs[i].innerText.trim()==="结算节奏"){bs[i].click();return "clicked"}}return "not-found"})()'

const JS_STATE = '(()=>{var o={};'
  + 'o.txt=(document.querySelector(".page")||{}).innerText||"";'
  + 'o.hasExplain=o.txt.indexOf("本月提交上月的核销资料")>=0;'
  + 'o.isEmpty=o.txt.indexOf("还没有配置任何结算节奏")>=0;'
  + 'o.hasBtn=(o.txt.indexOf("新增结算节奏")>=0)||(o.txt.indexOf("配第一条结算节奏")>=0);'
  + 'o.hasCal=o.txt.indexOf("本月结算日历")>=0;'
  + 'return JSON.stringify(o)})()'

const b = await launch({ headless: true })
const p = await b.newPage()
await p.enable()
try {
  await p.goto(BASE + '/', 5000)
  const lg = await p.eval(JS_LOGIN)
  console.log('演示登录: ' + lg)
  ok(lg === 'OK', '演示会话建立')

  await p.goto(BASE + '/#/rebate', 6000)
  await sleep(2500)

  const tabs = JSON.parse((await p.eval(JS_TABS)) || '[]')
  console.log('页签: ' + JSON.stringify(tabs))
  ok(tabs.indexOf('目标配置') >= 0, '页签「目标配置」已生效（改名成功）')
  ok(tabs.indexOf('结算节奏') >= 0, '页签「结算节奏」已上线')
  ok(tabs.indexOf('目标与返利') < 0, '旧页签名「目标与返利」已从页签区消失')
  ok(tabs.length === 6, '页签共 6 个', String(tabs.length))

  const clicked = await p.eval(JS_CLICK)
  console.log('点击「结算节奏」: ' + clicked)
  await sleep(2500)

  const st = JSON.parse((await p.eval(JS_STATE)) || '{}')
  console.log('页面文本片段: ' + String(st.txt || '').slice(0, 170).replace(/\s+/g, ' '))
  ok(clicked === 'clicked', '能点进「结算节奏」')
  ok(st.hasExplain, '渲染出业务口径说明（本月提交上月核销资料）')
  ok(st.isEmpty || st.hasBtn, '空态或新增入口已渲染')
  console.log('  本月结算日历区块: ' + (st.hasCal ? '有' : '无（无配置时按设计不显示）'))

  const errs = (p.errors || []).filter(e => String(e).indexOf('favicon') < 0)
  ok(errs.length === 0, '无 JS 运行时错误', errs.slice(0, 2).join(' / '))
} catch (e) {
  console.log('探针异常: ' + (e && e.message))
  fail++
} finally {
  await b.close().catch(() => { })
}
console.log('')
console.log('结果: ' + pass + ' 通过 / ' + fail + ' 失败')
process.exit(fail ? 1 : 0)
