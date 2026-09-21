/**
 * v222-render-read.mjs —— 从**真实渲染的表格**里读「箱数」，证明数字真的变了
 *
 * 前两环已证：① 接口下发字段（真机）② 线上产物里的 `perCase` 读主档（产物切函数 + 生产数据）。
 * 本环补最后一跳：**页面上那个格子里的数字**。
 *   目标商品 id=1164（规格 `340G`、单位 `瓶`、主档 `件=12`）
 *   · v222 前：340G 被末位数字抓成 340 ⇒ 箱数 = 数量/340（几乎恒为 0）
 *   · v222 后：读主档 ⇒ 箱数 = 数量/12
 * 生产库中**只有** pid=1164 有报单历史（期次 14），所以本探针会尝试切到那个期次。
 *
 * 🔴 全程只读：不点保存、不改数据、不切「改单」以外的开关。
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const USER = process.env.HG_USER || 'mptestsp'
const PASS = process.env.HG_PASS || 'Mpsup@1'
const SHOT_DIR = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/客户列删除被恢复排查-2026-09-19'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const log = (s) => console.log(s)

const JS_LOGIN = (u, p) => 'fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},'
  + 'body:JSON.stringify({username:' + JSON.stringify(u) + ',password:' + JSON.stringify(p) + '})})'
  + '.then(r=>r.json()).then(d=>{if(!d.token)return "NO";'
  + 'localStorage.setItem("hergent_v2_token",d.token);'
  + 'if(d.csrf_token)localStorage.setItem("hergent_v2_csrf",d.csrf_token);'
  + 'if(d.user)localStorage.setItem("hergent_v2_user",JSON.stringify(d.user));'
  + 'if(d.tenant_id)localStorage.setItem("hergent_v2_tenant",String(d.tenant_id));return "OK"})'

/* 期次下拉：把候选控件全列出来（只读） */
const JS_PERIODS = '(()=>{var out=[];'
  + 'document.querySelectorAll("select").forEach(function(s,i){'
  + 'out.push({kind:"select",i:i,opts:Array.from(s.options).map(function(o){return {v:o.value,t:(o.text||"").trim()}})})});'
  + 'document.querySelectorAll(".el-select,.period-picker,[class*=period]").forEach(function(e,i){'
  + 'out.push({kind:"widget",i:i,cls:e.className,text:(e.innerText||"").trim().slice(0,80)})});'
  + 'return JSON.stringify(out).slice(0,3000)})()'

/* 在已渲染的表格里找含关键词的行，把该行所有单元格文本打出来 */
const JS_ROW = (kw) => '(()=>{var kw=' + JSON.stringify(kw) + ';var res=[];'
  + 'document.querySelectorAll("table tr").forEach(function(tr){'
  + 'var t=(tr.innerText||"");if(t.indexOf(kw)<0)return;'
  + 'res.push(Array.from(tr.querySelectorAll("td,th")).map(function(c){return (c.innerText||"").trim().replace(/\\s+/g," ")}))});'
  + 'return JSON.stringify({n:res.length,rows:res.slice(0,3)}).slice(0,2500)})()'

/* 表头（判断哪一列是箱数） */
const JS_HEADS = '(()=>{var t=document.querySelector("table");if(!t)return "[]";'
  + 'var th=t.querySelector("thead tr");if(!th)return "[]";'
  + 'return JSON.stringify(Array.from(th.querySelectorAll("th,td")).map(function(c){return (c.innerText||"").trim()}))})()'

const JS_PICK_PERIOD = (want) => '(()=>{var want=' + JSON.stringify(String(want)) + ';'
  + 'var sels=document.querySelectorAll("select");'
  + 'for(var i=0;i<sels.length;i++){for(var j=0;j<sels[i].options.length;j++){var o=sels[i].options[j];'
  + 'if(String(o.value)===want||(o.text||"").indexOf(want)>=0){sels[i].value=o.value;'
  + 'sels[i].dispatchEvent(new Event("change",{bubbles:true}));return "select#"+i+" -> "+o.value+" "+(o.text||"").trim()}}}'
  + 'var w=Array.from(document.querySelectorAll(".el-select,[class*=period]")).find(function(e){return (e.innerText||"").indexOf(want)>=0});'
  + 'if(w){w.click();return "widget-click"}return "NOTFOUND"})()'

const JS_TEXT = 'document.body?document.body.innerText:""'

let browser, failed = false
try {
  fs.mkdirSync(SHOT_DIR, { recursive: true })
  browser = await launch()
  const page = await browser.newPage()
  await page.enable()
  await page.goto(BASE, 3500)
  log('登录：' + await page.eval(JS_LOGIN(USER, PASS)))
  await page.goto(BASE + '/#/forecast', 6000)
  await sleep(6000)

  log('URL = ' + await page.eval('location.href'))
  log('期次控件：' + (await page.eval(JS_PERIODS)))
  log('表头：' + (await page.eval(JS_HEADS)))
  log('当前页面含 340G 的行 = ' + (await page.eval(JS_ROW('340G'))))
  log('当前页面含「新希望」的行 = ' + (await page.eval(JS_ROW('新希望'))))

  /* 尝试切到期次 14（有 pid=1164 报单历史的那个期次） */
  log('')
  log('切换到期次 14：' + (await page.eval(JS_PICK_PERIOD(14))))
  await sleep(6000)
  const row14 = await page.eval(JS_ROW('340G'))
  log('期次 14 下含 340G 的行 = ' + row14)
  log('期次 14 表头 = ' + (await page.eval(JS_HEADS)))

  const body = await page.eval(JS_TEXT)
  const hit = ['客户', '商品', '填报', '汇总', '预报', '期次', '数量', '箱'].filter(k => body.includes(k))
  log('业务词命中 = ' + hit.join('/') + '｜兜底页 = ' + /页面出错了/.test(body))
  const errs = page.errors.slice()
  log('错误 ' + errs.length + ' 条'); errs.slice(0, 8).forEach(e => log('   ' + e.slice(0, 180)))

  const SHOT = SHOT_DIR + '/v222-真实渲染-箱数-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '') + '.png'
  try { await page.screenshot(SHOT); log('截图：' + SHOT) } catch { }

  const r14 = JSON.parse(row14 || '{"n":0}')
  if (r14.n > 0) log('✅ 读到真实渲染行（见上）；请人工核对「箱」列是否 = 数量/12')
  else log('⚠️ 期次 14 下未在表格里定位到 340G（可能需在「汇总」标签页或该商品当期无报单）')

  if (/页面出错了/.test(body) || errs.length > 6) failed = true
} catch (e) {
  log('脚本异常：' + (e && e.message)); failed = true
} finally {
  if (browser) { try { await browser.close() } catch { } }
  process.exit(failed ? 1 : 0)
}
