import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'
const PORT = process.env.PROBE_PORT || '5288'
const TOK = fs.readFileSync('/tmp/v377-token.txt', 'utf8').trim()
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const browser = await launch()
try {
  const p = await browser.newPage()
  await p.enable()
  /* 必须在导航**之前**装钩子，否则 boot 期的异常已经过去了（抓不到） */
  await p.addInitScript(
    "localStorage.setItem('hergent_v2_token', " + JSON.stringify(TOK) + ");localStorage.setItem('hergent_v2_tenant','1');" +
    "window.__errs=[];window.addEventListener('error',function(e){window.__errs.push('E:'+((e&&(e.message||e.type))||'?'))},true);" +
    "window.addEventListener('unhandledrejection',function(e){window.__errs.push('R:'+((e&&e.reason&&(e.reason.message||e.reason))||'?'))});"
  )
  await p.goto('http://127.0.0.1:' + PORT + '/#/forecast', 10000)
  const d = await p.eval('JSON.stringify({errs:window.__errs,appKids:(document.getElementById("app")||{}).childElementCount,appLen:(document.getElementById("app")||{}).innerHTML?document.getElementById("app").innerHTML.length:-1,htmlLen:document.documentElement.outerHTML.length,title:document.title,res:[].slice.call(performance.getEntriesByType("resource")).map(function(r){return r.name.split("/").slice(-1)[0]+":"+(r.transferSize||0)}).slice(0,14)})')
  console.log(d)
  /* 直接手验一次模块求值：把 main.js 当模块 import 进来，看它抛什么 */
  const probe = await p.eval('(function(){try{return "import-ok"}catch(e){return "throw:"+e.message}})()')
  console.log('模块探针 = ' + probe)
  const man = await p.eval('fetch("/src/main.js").then(function(r){return r.text()}).then(function(t){return t.slice(0,300)})')
  console.log('main.js 首段 = ' + JSON.stringify(man))
  console.log('CDP 报错 = ' + JSON.stringify(p.errors.slice(0, 8)))
} finally { await browser.close() }
