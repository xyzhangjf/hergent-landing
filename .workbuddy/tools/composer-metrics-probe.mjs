/**
 * composer-metrics-probe.mjs —— 副驾输入框「真机几何测量」（只读）
 * 目的：给「与 WorkBuddy 输入框对比」提供我方**实测值**（而不是读 CSS 猜）。
 * 测：输入槽圆角/高度/背景、工具条是否换行、控件是否同一中线、文本可用宽度、390px 窄屏表现。
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const JS_LOGIN = 'fetch("https://hergent.cn/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},'
  + 'body:JSON.stringify({username:"mptestsp",password:"Mpsup@1"})})'
  + '.then(r=>r.json()).then(d=>{if(!d.token)return "NO";'
  + 'localStorage.setItem("hergent_v2_token",d.token);'
  + 'if(d.csrf_token)localStorage.setItem("hergent_v2_csrf",d.csrf_token);'
  + 'if(d.user)localStorage.setItem("hergent_v2_user",JSON.stringify(d.user));'
  + 'if(d.tenant_id)localStorage.setItem("hergent_v2_tenant",String(d.tenant_id));return "OK"})'
const JS_OPEN = '(function(){var d=document.querySelector(".copilot");if(d)return "already";'
  + 'var b=document.querySelector(".tb-copilot");if(!b)return "no-btn";b.click();return "clicked"})()'

// 一次取全：几何 + 背景 + 控件中线集合 + 换行判定
const JS_METRICS = `(()=>{
  const q=s=>document.querySelector(s);
  const box=s=>{const e=q(s);if(!e)return null;const r=e.getBoundingClientRect();const c=getComputedStyle(e);
    return {w:+r.width.toFixed(1),h:+r.height.toFixed(1),r:+(r.top+r.height/2).toFixed(1),radius:c.borderRadius,bg:c.backgroundImage!=="none"?c.backgroundImage:c.backgroundColor,pad:c.padding,fs:c.fontSize,lh:c.lineHeight};};
  const cy=s=>{const e=q(s);if(!e)return null;const r=e.getBoundingClientRect();return +(r.top+r.height/2).toFixed(1)};
  const toolbar=q(".cp-toolbar");
  let rows=0, centers=[];
  if(toolbar){
    const kids=[...toolbar.children].flatMap(c=>[...c.children]);
    const tops=kids.map(k=>+k.getBoundingClientRect().top.toFixed(0));
    rows=new Set(tops).size;                      // 不同 top 的个数 = 行数
    centers=kids.map(k=>cy("."+[...k.classList].join("."))).filter(v=>v!==null);
  }
  const ta=q(".cp-input");
  let usableW=null;
  if(ta){const c=getComputedStyle(ta);const r=ta.getBoundingClientRect();
    usableW=+(r.width-parseFloat(c.paddingLeft)-parseFloat(c.paddingRight)).toFixed(1);}
  return JSON.stringify({
    composer:box(".cp-composer"), input:box(".cp-input"), toolbar:box(".cp-toolbar"),
    send:box(".cp-send"), plus:box(".cp-plus"), voice:box(".cp-voice"),
    role:box(".cp-role"), guard:box(".cp-guard-btn"), hint:box(".cp-foot-hint"),
    controlCount:toolbar?toolbar.querySelectorAll("button,label,[role=button]").length:0,
    toolbarRows:rows, centersSame:new Set(centers).size, centers,
    usableW, taMaxH:(ta?getComputedStyle(ta).maxHeight:null), taMinH:(ta?getComputedStyle(ta).minHeight:null),
    vw:window.innerWidth
  })})()`

const DIR = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/输入框对比-2026-09-25'

function brief(m) {
  return {
    视口宽: m.vw,
    输入槽: m.composer && { 宽: m.composer.w, 高: m.composer.h, 圆角: m.composer.radius, 背景: String(m.composer.bg).slice(0, 46) },
    文本区: m.input && { 宽: m.input.w, 高: m.input.h, 内边距: m.input.pad, 字号: m.input.fs, 最小高: m.taMinH, 最大高: m.taMaxH },
    文本可用宽: m.usableW,
    工具条: m.toolbar && { 高: m.toolbar.h, 内边距: m.toolbar.pad },
    工具条行数: m.toolbarRows,
    控件数: m.controlCount,
    不同中线数: m.centersSame,
    发送键: m.send && { 宽: m.send.w, 高: m.send.h, 圆角: m.send.radius },
    底部提示行: m.hint && { 高: m.hint.h, 字号: m.hint.fs },
  }
}

async function run(width, label, shot) {
  const b = await launch({ headless: true, extraArgs: width ? ['--window-size=' + width] : [] })
  const p = await b.newPage()
  await p.enable()
  try {
    await p.goto(BASE + '/', 5000)
    await p.eval(JS_LOGIN)
    await p.goto(BASE + '/', 5000)
    await p.eval(JS_OPEN)
    await sleep(1400)
    const m = JSON.parse(await p.eval(JS_METRICS))
    console.log('=== ' + label + ' ===')
    console.log(JSON.stringify(brief(m), null, 1))
    if (shot) await p.screenshot(DIR + '/' + shot)
    console.log('errors:', (p.errors || []).slice(0, 2))
    return m
  } finally {
    await b.close()
  }
}

await run(null, '桌面（1600px）', '我方-桌面.png')
console.log()
await run('390,844', '窄屏（390px）', '我方-390.png')
