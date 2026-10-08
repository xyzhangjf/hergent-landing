/**
 * dead-path-removed-probe.mjs —— 验证「删除 m.progress 死路径」后：
 *   ① 旧的 .msg-progress 彻底不再出现
 *   ② 示例卡改演示**真实在用**的「工具执行情况」UI（3 条，含 执行中/已完成 耗时）
 *   ③ 示例卡里原有的经营卡/图表没有回归
 * 🔴 只读：仅 localStorage 种 token。
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const DIR = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/流式排查-2026-09-25'
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
const JS_OPEN = '(function(){var d=document.querySelector(".copilot");if(d)return "already";'
  + 'var b=document.querySelector(".tb-copilot");if(!b)return "no-btn";b.click();return "clicked"})()'
const JS_DEMO = '(function(){var b=document.querySelector(".cp-demo");if(!b)return "no-demo";b.click();return "clicked"})()'
const JS_ST = '(()=>{var o={};'
  + 'o.progress=document.querySelectorAll(".msg-progress").length;'
  + 'o.progressAny=(document.body.innerHTML.indexOf("msg-progress")>=0)?1:0;'
  + 'o.toolsBlocks=document.querySelectorAll(".msg-tools").length;'
  + 'o.tools=document.querySelectorAll(".msg-tools .cp-tool").length;'
  + 'o.hd=(document.querySelector(".cp-tools-hd")||{}).innerText||"";'
  + 'o.sts=[].slice.call(document.querySelectorAll(".cp-tool-st")).map(function(e){return e.innerText.trim()});'
  + 'o.names=[].slice.call(document.querySelectorAll(".cp-tool-name")).map(function(e){return e.innerText.trim()});'
  + 'o.cards=document.querySelectorAll(".rc").length;'
  + 'o.charts=document.querySelectorAll(".rc-spark, .rc-donut").length;'
  + 'return JSON.stringify(o)})()'

const b = await launch({ headless: true })
const p = await b.newPage()
await p.enable()
try {
  await p.goto(BASE + '/', 5000)
  await p.eval(JS_LOGIN)
  await p.goto(BASE + '/', 5000)
  await p.eval(JS_OPEN)
  await sleep(1200)
  console.log('示例卡:', await p.eval(JS_DEMO))
  await sleep(900)
  const s = JSON.parse(await p.eval(JS_ST))

  console.log('\n== 死路径已移除 ==')
  ok(s.progress === 0 && s.progressAny === 0, '页面里再无 .msg-progress / 该字符串', JSON.stringify(s.progressAny))
  console.log('\n== 示例卡改演示真实工具 UI ==')
  ok(s.toolsBlocks === 1, '有一个「工具执行情况」块', 'blocks=' + s.toolsBlocks)
  ok(s.tools === 3, '列出 3 条工具', 'tools=' + s.tools)
  ok(/工具执行情况/.test(s.hd), '标题为「工具执行情况」', s.hd.replace(/\s+/g, ' '))
  ok(s.sts.some(x => /已完成/.test(x)), '有「已完成（含耗时）」', JSON.stringify(s.sts))
  ok(s.sts.some(x => /执行中/.test(x)), '有「执行中」', JSON.stringify(s.sts))
  console.log('\n== 无回归 ==')
  ok(s.cards >= 1, '经营卡仍在', 'cards=' + s.cards)
  ok(s.charts >= 1, '卡片图表仍在', 'charts=' + s.charts)
  ok((p.errors || []).length === 0, '0 控制台报错', JSON.stringify((p.errors || []).slice(0, 3)))
  await p.screenshot(DIR + '/示例卡-工具执行情况.png')
} catch (e) {
  fail++; console.log('  ❌ 异常：' + (e && e.message ? e.message : e))
} finally {
  console.log('\n===== 死路径移除探针：PASS ' + pass + ' / FAIL ' + fail + ' =====')
  await b.close()
  process.exit(fail ? 1 : 0)
}
