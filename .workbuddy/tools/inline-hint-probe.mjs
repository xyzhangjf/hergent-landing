/**
 * inline-hint-probe.mjs —— 「提示内联 + 字数」验收（真机）
 * 关键：① 框外旧提示已消失（省下空间）；② 内联提示与文本区**第一行同线**（几何验证，不靠目测）；
 *      ③ 空时显示快捷键、有字时显示**真实字数**；④ 不挡鼠标（pointer-events:none）。
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
const JS_OPEN = '(function(){var d=document.querySelector(".copilot");if(d)return "already";'
  + 'var b=document.querySelector(".tb-copilot");if(!b)return "no-btn";b.click();return "clicked"})()'

const JS_ST = `(()=>{
  const q=s=>document.querySelector(s);
  const h=q(".cp-inhint"), ta=q(".cp-input"), c=q(".cp-composer");
  const r=e=>{if(!e)return null;const b=e.getBoundingClientRect();const cs=getComputedStyle(e);
    return {top:+b.top.toFixed(1),bottom:+b.bottom.toFixed(1),left:+b.left.toFixed(1),right:+b.right.toFixed(1),
            h:+b.height.toFixed(1),lh:cs.lineHeight,pe:cs.pointerEvents,fs:cs.fontSize,disp:cs.display};};
  const tb=q(".cp-toolbar");
  return JSON.stringify({
    footCount: document.querySelectorAll(".cp-foot-hint").length,
    hintText: h?h.innerText.trim():"",
    hint: r(h), ta: r(ta), composer: r(c), toolbar: r(tb),
    taPadTop: ta?getComputedStyle(ta).paddingTop:null,
    vw: window.innerWidth
  })})()`

const JS_FILL = (t) => '(function(){var ta=document.querySelector(".cp-input");'
  + 'var st=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,"value").set;'
  + 'st.call(ta,' + JSON.stringify(t) + ');ta.dispatchEvent(new Event("input",{bubbles:true}));return "ok"})()'

const b = await launch({ headless: true })
const p = await b.newPage()
await p.enable()
try {
  await p.goto(BASE + '/', 5000)
  await p.eval(JS_LOGIN)
  await p.goto(BASE + '/', 5000)
  await p.eval(JS_OPEN)
  await sleep(1600)

  console.log('== ① 框外旧提示已移除 ==')
  let s = JSON.parse(await p.eval(JS_ST))
  ok(s.footCount === 0, '.cp-foot-hint 已不存在（省下框外那一行）', 'count=' + s.footCount)

  console.log('\n== ② 内联提示与文本区第一行同线（几何验证）==')
  ok(!!s.hint, '内联提示存在')
  const taFirstLineTop = +(s.ta.top + parseFloat(s.taPadTop)).toFixed(1)
  ok(Math.abs(s.hint.top - taFirstLineTop) <= 1.5,
    '提示顶边 = 文本区第一行顶边（±1.5px）',
    'hint.top=' + s.hint.top + ' vs ta第一行=' + taFirstLineTop)
  ok(Math.abs(s.hint.h - parseFloat(s.ta.lh)) <= 1.5,
    '提示行高 = 文本区行高（22px）', 'hint.h=' + s.hint.h + ' vs lh=' + s.ta.lh)
  ok(s.hint.pe === 'none', '不挡鼠标（pointer-events:none）', s.hint.pe)
  ok(s.hint.right <= s.ta.right, '提示在文本区右边界内（未溢出）',
    'hint.right=' + s.hint.right + ' ta.right=' + s.ta.right)
  ok(s.hint.left > s.ta.left + 300, '提示与占位文字不重叠（提示左边界足够靠右）',
    'hint.left=' + s.hint.left + ' ta.left=' + s.ta.left)

  console.log('\n== ③ 空态显示快捷键提示 ==')
  ok(/发送/.test(s.hintText) && /换行/.test(s.hintText), '空态文案为快捷键提示', s.hintText)
  await p.screenshot(DIR + '/内联提示-空态.png')

  console.log('\n== ④ 有字时显示真实字数 ==')
  const TXT = '帮我看看这个月货损'
  await p.eval(JS_FILL(TXT)); await sleep(500)
  s = JSON.parse(await p.eval(JS_ST))
  ok(s.hintText === TXT.length + ' 字', '字数 = 实际字符数', s.hintText + '（应为 ' + TXT.length + ' 字）')
  await p.screenshot(DIR + '/内联提示-字数.png')
  await p.eval(JS_FILL('')); await sleep(400)
  s = JSON.parse(await p.eval(JS_ST))
  ok(/发送/.test(s.hintText), '清空后回到快捷键提示', s.hintText)

  console.log('\n== ⑤ 输入框高度未变（提示是绝对定位，不占布局）==')
  const compH = s.composer.h
  ok(Math.abs(compH - 108) <= 2, 'composer 高度仍为 ~108px（提示没撑高）', 'h=' + compH)
  ok(s.toolbar && s.toolbar.h === 42, '工具条高度仍 42px', 'toolbar.h=' + (s.toolbar && s.toolbar.h))
  ok((p.errors || []).length === 0, '0 控制台报错', JSON.stringify((p.errors || []).slice(0, 2)))
} catch (e) {
  fail++; console.log('  ❌ 异常：' + (e && e.message ? e.message : e))
} finally {
  console.log('\n===== 内联提示探针：PASS ' + pass + ' / FAIL ' + fail + ' =====')
  await b.close()
  process.exit(fail ? 1 : 0)
}
