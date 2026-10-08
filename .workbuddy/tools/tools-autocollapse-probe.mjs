/**
 * tools-autocollapse-probe.mjs —— 「工具执行情况」回复中展开 / 结束后自动收起（真机、只读）
 *
 * 期望节奏（对齐 WorkBuddy）：
 *   回复中 → .cp-tools-body **在**（展开），标题为「正在执行」
 *   回复后 → .cp-tools-body **不在**（收起），标题为「工具执行情况」
 *   再点一下 → 又能展开
 * 🔴 只读：仅 localStorage 种 token。
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const Q = process.env.HG_Q || '查一下当前库存，哪些商品库存偏低？'
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
const JS_FILL = '(function(){var ta=document.querySelector(".cp-input");if(!ta)return "no-ta";'
  + 'var st=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,"value").set;'
  + 'st.call(ta,' + JSON.stringify(Q) + ');ta.dispatchEvent(new Event("input",{bubbles:true}));return "ok"})()'
const JS_SEND = '(function(){var b=document.querySelector(".cp-send");'
  + 'if(!b)return "no-btn";if(b.disabled)return "DISABLED";b.click();return "sent"})()'
const JS_ST = '(()=>{var hd=document.querySelector(".cp-tools-hd");'
  + 'return JSON.stringify({'
  + ' tools:document.querySelectorAll(".msg-tools .cp-tool").length,'
  + ' body:document.querySelectorAll(".cp-tools-body").length,'
  + ' hd:hd?hd.innerText.replace(/\\s+/g," ").trim():"",'
  + ' typing:!!document.querySelector(".msg.assistant .typing"),'
  + ' streaming:!!document.querySelector(".copilot.is-typing"),'   // = store.chat.streaming 的可观测代理
  + ' mdLen:(function(){var m=document.querySelector(".msg.assistant .md");return m?(m.innerText||"").length:0})()'
  + '})})()'
const JS_CLICK_HD = '(function(){var b=document.querySelector(".cp-tools-hd");if(!b)return "no";b.click();return "clicked"})()'

const b = await launch({ headless: true })
const p = await b.newPage()
await p.enable()
try {
  await p.goto(BASE + '/', 5000)
  await p.eval(JS_LOGIN)
  await p.goto(BASE + '/', 5000)
  await p.eval(JS_OPEN)
  await sleep(1200)
  await p.eval(JS_FILL)
  await sleep(400)
  console.log('发送:', await p.eval(JS_SEND))

  // ---- 阶段一：回复中，采样到「展开」为止 ----
  let live = null
  for (let i = 0; i < 120; i++) {
    const s = JSON.parse(await p.eval(JS_ST))
    if (s.body > 0 && s.tools > 0) { live = s; break }
    await sleep(500)
  }
  console.log('\n== 回复中 ==')
  ok(!!live, '抓到了「回复中」的状态快照')
  if (live) {
    ok(live.body === 1, '工具明细 **展开**（.cp-tools-body 在）', 'body=' + live.body)
    ok(/正在执行/.test(live.hd), '标题为「正在执行」', live.hd)
    ok(live.tools >= 1, '列出工具步骤', 'tools=' + live.tools)
    await p.screenshot(DIR + '/工具-回复中-展开.png')
  }

  // ---- 阶段二：轮询等它**自动收起**（回复真正结束的标志 = .cp-tools-body 消失）----
  //   ⚠️ 不能用「.typing 消失」当结束判据：第一个字到达时 typing 就没了，但那时仍在流式中，
  //      工具理应保持展开。所以这里直接等「收起」这个可观测事实。
  let after = null
  let waited = 0
  let lastSeen = null
  for (let i = 0; i < 180; i++) {         // 最多等 90s（工具密集的问题本身要跑约 36s）
    const s = JSON.parse(await p.eval(JS_ST))
    waited = i * 0.5
    lastSeen = s
    // 🔴 收起后 `.cp-tool` 行不再渲染（tools 会变 0）⇒ **只能以 body===0 作判据**，
    //    「数据是否还在」改看标题里的「N / N 步」（它由 m.tools 实时算出来）。
    if (s.body === 0 && !s.streaming) { after = s; break }
    await sleep(500)
  }
  console.log(`\n== 回复结束后（等待自动收起 ${waited.toFixed(1)}s）==`)
  if (!after && lastSeen) console.log('   末次观测: streaming=' + lastSeen.streaming + ' body=' + lastSeen.body + ' tools=' + lastSeen.tools + ' hd=' + lastSeen.hd)
  ok(!!after, '工具明细在回复结束后**自动收起**了', after ? '已收起' : '等了 30s 仍未收起')
  if (after) {
    ok(after.body === 0, '.cp-tools-body 不在（工具明细已收起）', 'body=' + after.body)
    ok(!after.streaming, '流式已结束（streaming=false）', 'streaming=' + after.streaming)
    ok(/工具执行情况/.test(after.hd), '标题回到「工具执行情况」', after.hd)
    ok(/\d+ \/ \d+ 步/.test(after.hd), '摘要仍保留步骤计数（数据没被丢，只是收纳）', after.hd)
    ok(after.mdLen > 0, '答案仍完整显示（回复结束后只剩答案）', 'mdLen=' + after.mdLen)
    await p.screenshot(DIR + '/工具-回复结束-已收起.png')
  }

  // ---- 阶段三：再点一下应能展开 ----
  console.log('\n== 手动展开 ==')
  console.log('  点击:', await p.eval(JS_CLICK_HD))
  await sleep(400)
  const m = JSON.parse(await p.eval(JS_ST))
  ok(m.body === 1, '点击后又能展开', 'body=' + m.body)
  ok((p.errors || []).length === 0, '0 控制台报错', JSON.stringify((p.errors || []).slice(0, 3)))
} catch (e) {
  fail++; console.log('  ❌ 异常：' + (e && e.message ? e.message : e))
} finally {
  console.log('\n===== 工具自动收起探针：PASS ' + pass + ' / FAIL ' + fail + ' =====')
  await b.close()
  process.exit(fail ? 1 : 0)
}
