/* 本期预报页性能采样（真实生产站 / 原生 CDP over pipe）
   为什么不用 puppeteer：本机 Chrome 155 与 puppeteer-core 25.11 不兼容（main frame too early）；
   为什么用 pipe 而不是 WebSocket：Chrome 155 新 headless 会拒绝 WS 连接（1006）；
   为什么 --no-sandbox：当前执行环境禁止 Chrome 自身沙箱（sandbox initialization failed）。
   说明：--disable-gpu 下为软件光栅，**脚本/布局/样式重算指标仍有效**，绘制类指标仅作参考。
   纪律：只读 —— 演示租户登录，不保存不改业务数据，测完关闭并清理临时 profile。
   用法：node tests/perf/forecast-profile.mjs [tag]
*/
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = 'https://hergent.cn'
const OUT_DIR = path.dirname(new URL(import.meta.url).pathname)
const TAG = process.argv[2] || 'baseline'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const result = { meta: {}, viewScroll: {}, open: {}, keystroke: {}, editScroll: {}, errors: [] }
const pushErr = (s) => result.errors.push(String(s).slice(0, 300))

/* ---------------- CDP over pipe ---------------- */
class PipeCDP {
  constructor(w, r) {
    this.w = w; this.seq = 0; this.pending = new Map(); this.buf = ''
    r.setEncoding('utf8')
    r.on('data', (chunk) => {
      this.buf += chunk
      let i
      while ((i = this.buf.indexOf('\0')) >= 0) {
        const s = this.buf.slice(0, i); this.buf = this.buf.slice(i + 1)
        if (!s) continue
        let m; try { m = JSON.parse(s) } catch { continue }
        if (m.id && this.pending.has(m.id)) {
          const p = this.pending.get(m.id); this.pending.delete(m.id)
          m.error ? p.reject(new Error(m.error.message + ' ' + (m.error.data || ''))) : p.resolve(m.result)
        }
      }
    })
  }
  send(method, params = {}, sessionId, timeout = 30000) {
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP 超时: ' + method)) }, timeout)
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v) },
        reject: (e) => { clearTimeout(timer); reject(e) },
      })
      this.w.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0')
    })
  }
}

const udd = path.join(os.tmpdir(), 'hg-perf-' + Date.now())
const chrome = spawn(CHROME, [
  '--remote-debugging-pipe', '--headless=new',
  '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  `--user-data-dir=${udd}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio',
  '--window-size=1440,900', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] })

let chromeErr = ''
chrome.stderr.on('data', d => { chromeErr += String(d) })
const cleanup = () => { try { chrome.kill('SIGKILL') } catch {} try { fs.rmSync(udd, { recursive: true, force: true }) } catch {} }

try {
  const cdp = new PipeCDP(chrome.stdio[3], chrome.stdio[4])

  let created = null
  for (let i = 0; i < 30; i++) {
    try { created = await cdp.send('Target.createTarget', { url: 'about:blank' }, undefined, 8000); break } catch { await sleep(400) }
  }
  if (!created) throw new Error('Chrome 未就绪: ' + chromeErr.slice(-200))
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: created.targetId, flatten: true })
  const S = (m, p = {}, t = 30000) => cdp.send(m, p, sessionId, t)

  await S('Page.enable'); await S('Runtime.enable'); await S('Performance.enable')
  await S('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  result.meta.browser = (await S('Browser.getVersion')).product

  const evalJS = async (expression, awaitPromise = false) => {
    const r = await S('Runtime.evaluate', { expression, returnByValue: true, awaitPromise, userGesture: true })
    if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text))
    return r.result?.value
  }
  const waitFor = async (expr, timeout = 60000, label = '') => {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      try { if (await evalJS(`(()=>{try{return !!(${expr})}catch(e){return false}})()`)) return true } catch {}
      await sleep(120)
    }
    throw new Error('waitFor 超时: ' + (label || expr))
  }
  const nav = async (url) => { await S('Page.navigate', { url }, 60000); await waitFor(`document.readyState==='complete'`, 60000, url) }
  const metrics = async () => Object.fromEntries((await S('Performance.getMetrics')).metrics.map(m => [m.name, m.value]))
  const diff = (a, b) => {
    const k = ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'LayoutCount', 'RecalcStyleCount', 'JSEventListeners', 'Nodes']
    const o = {}; for (const x of k) if (a[x] != null && b[x] != null) o[x] = +(b[x] - a[x]).toFixed(6)
    return o
  }
  const sec2ms = v => v == null ? null : +(v * 1000).toFixed(1)

  /* ---------- 1) 认证：临时只读会话（tenant 1），否则回落演示租户 ---------- */
  const TOKEN_FILE = path.join(OUT_DIR, '.tmp-token')
  const TOKEN = (process.env.HG_TOKEN || (fs.existsSync(TOKEN_FILE) ? fs.readFileSync(TOKEN_FILE, 'utf8') : '')).trim()

  await S('Network.enable')
  if (TOKEN) {
    const csrf = 'perfprobe' + Date.now()
    for (const [name, value, httpOnly] of [
      ['erp_token', TOKEN, true],
      ['hergent_auth', '1', false],
      ['hergent_tenant', '1', false],
      ['csrf_token', csrf, false],
    ]) {
      await S('Network.setCookie', { name, value, url: 'https://hergent.cn/', httpOnly, secure: true, sameSite: 'Lax' })
    }
    result.meta.authMode = 'session-token(tenant1)'
    await nav(BASE + '/#/forecast')
  } else {
    result.meta.authMode = 'demo'
    await nav(BASE + '/')
    await sleep(1500)
    result.meta.demoClicked = await evalJS(`(()=>{const els=[...document.querySelectorAll('button,a,div[role="button"],span')];const el=els.find(e=>/先看看演示效果/.test(e.textContent||'')&&e.offsetParent!==null);if(!el)return false;(el.closest('button')||el).click();return true})()`)
    await sleep(3000)
    await evalJS(`location.hash='#/forecast'`)
  }
  await waitFor(`document.querySelector('.cross-tbl')`, 90000, '.cross-tbl')
  await sleep(1800)
  result.meta.me = await evalJS(`fetch('/api/auth/me',{credentials:'include'}).then(r=>r.json()).then(d=>({tenant:d.tenant_id??d.tenantId??null,user:(d.user&&d.user.username)??null,role:(d.user&&d.user.role)??null})).catch(e=>({err:String(e)}))`, true)

  result.meta.build = await evalJS('window.__HG_BUILD__ || null')
  result.meta.density = await evalJS(`document.documentElement.getAttribute('data-density')`)
  result.meta.viewport = await evalJS(`({w:innerWidth,h:innerHeight,dpr:devicePixelRatio})`)
  result.meta.navTiming = await evalJS(`(()=>{const n=performance.getEntriesByType('navigation')[0]||{};return{domInteractiveMs:Math.round(n.domInteractive||0),loadMs:Math.round(n.loadEventEnd||0)}})()`)
  result.meta.viewDom = await evalJS(`({tr:document.querySelectorAll('.cross-tbl tbody tr').length,td:document.querySelectorAll('.cross-tbl tbody td').length,allNodes:document.querySelectorAll('*').length})`)

  const scrollProbe = `(async()=>{
    const pick=()=>{const vp=document.querySelector('.cross-viewport');if(vp&&vp.scrollHeight>vp.clientHeight+20)return vp;
      const t=document.querySelector('.cross-tbl');let el=t&&t.parentElement;
      while(el&&el!==document.body&&!(el.scrollHeight>el.clientHeight+20))el=el.parentElement;
      return (el&&el!==document.body)?el:null};
    const el=pick(); if(!el)return{error:'no scrollable'};
    const before=el.scrollTop; el.scrollTop=0;
    let frames=0,last=performance.now(),t0=performance.now(),running=true,gaps=[];
    const tick=t=>{frames++;gaps.push(t-last);last=t;if(running)requestAnimationFrame(tick)};
    requestAnimationFrame(tick);
    const step=()=>{el.scrollTop+=55;if(performance.now()-t0<1200)setTimeout(step,16);else running=false};
    step();
    await new Promise(r=>setTimeout(r,1400));
    const dur=performance.now()-t0; gaps.sort((a,b)=>a-b);
    const p=q=>gaps.length?+gaps[Math.min(gaps.length-1,Math.floor(q*(gaps.length-1)))].toFixed(1):null;
    const r={fps:+(frames/(dur/1000)).toFixed(1),maxGapMs:+Math.max(...gaps).toFixed(1),p95GapMs:p(0.95),container:el.className||'(anon)',rowsRendered:document.querySelectorAll('.cross-tbl tbody tr').length};
    el.scrollTop=before; return r;
  })()`

  /* ---------- 3) 查看态滚动 ---------- */
  result.viewScroll = await evalJS(scrollProbe, true)

  /* ---------- 4) 打开编辑态（改单） ---------- */
  result.open.button = await evalJS(`(()=>{const el=[...document.querySelectorAll('button')].find(e=>/改单/.test((e.textContent||'').trim())&&e.offsetParent!==null);return el?{found:true,disabled:!!el.disabled,text:(el.textContent||'').trim().slice(0,24)}:{found:false}})()`)

  const mBefore = await metrics()
  const tWall = Date.now()
  await evalJS(`(()=>{const el=[...document.querySelectorAll('button')].find(e=>/改单/.test((e.textContent||'').trim())&&e.offsetParent!==null);window.__openT0=performance.now();if(el)el.click();})()`)

  let openOk = true
  try {
    await waitFor(`document.querySelectorAll('.cross-tbl.edit-tbl tbody tr').length>50`, 120000, 'edit rows')
    await waitFor(`document.querySelectorAll('.cross-tbl.edit-tbl .cell-qty').length>0`, 60000, 'qty inputs')
  } catch (e) { openOk = false; pushErr('open: ' + e.message) }
  await sleep(1500)
  const mAfter = await metrics()
  result.open.ok = openOk
  result.open.wallMs = Date.now() - tWall
  result.open.inPageMs = await evalJS(`window.__openT0?+(performance.now()-window.__openT0).toFixed(1):null`)
  result.open.cost = diff(mBefore, mAfter)
  result.open.dom = await evalJS(`({tr:document.querySelectorAll('.cross-tbl.edit-tbl tbody tr').length,td:document.querySelectorAll('.cross-tbl.edit-tbl tbody td').length,inputs:document.querySelectorAll('.cross-tbl.edit-tbl input').length,allNodes:document.querySelectorAll('*').length})`)

  /* ---------- 5) 单键输入成本 + A/B 变体（判定 JS 还是绘制主导） ---------- */
  if (openOk) {
    await evalJS(`(()=>{window.__lat=[];window.__long=[];try{new PerformanceObserver(l=>{for(const e of l.getEntries())window.__long.push(Math.round(e.duration))}).observe({entryTypes:['longtask']})}catch(e){}
      document.addEventListener('input',()=>{const t=performance.now();requestAnimationFrame(()=>window.__lat.push(+(performance.now()-t).toFixed(1)))},true);})()`)

    const hasTarget = await evalJS(`(()=>{
      const rows=[...document.querySelectorAll('.cross-tbl.edit-tbl tbody tr')];
      for(const r of rows){const i=r.querySelector('.cell-qty'); if(i){ i.setAttribute('data-perf-target','1'); i.focus(); i.value=''; return true }}
      const any=document.querySelector('.cross-tbl.edit-tbl .cell-qty'); if(any){any.setAttribute('data-perf-target','1');any.focus();return true} return false })()`)

    if (hasTarget) {
      const LAT = `(()=>{const a=window.__lat.slice().sort((x,y)=>x-y);const p=q=>a.length?a[Math.min(a.length-1,Math.floor(q*(a.length-1)))]:null;return{n:a.length,min:a[0]??null,p50:p(0.5),p90:p(0.9),max:a[a.length-1]??null}})()`
      const summarize = (n, c, lat, lt) => ({
        chars: n,
        perChar: {
          taskMs: +(sec2ms(c.TaskDuration) / n).toFixed(1),
          scriptMs: +(sec2ms(c.ScriptDuration) / n).toFixed(1),
          layoutMs: +(sec2ms(c.LayoutDuration) / n).toFixed(1),
          recalcStyleMs: +(sec2ms(c.RecalcStyleDuration) / n).toFixed(1),
          layoutCount: +(c.LayoutCount / n).toFixed(1),
          recalcStyleCount: +(c.RecalcStyleCount / n).toFixed(1),
          otherMs: +((sec2ms(c.TaskDuration) - sec2ms(c.ScriptDuration) - sec2ms(c.LayoutDuration) - sec2ms(c.RecalcStyleDuration)) / n).toFixed(1),
        },
        latency: lat,
        longtasks: lt,
      })
      const typeOnce = async (n, delay = 80, sel = '[data-perf-target="1"]') => {
        await evalJS(`(()=>{const el=document.querySelector(${JSON.stringify(sel)});if(el){el.value='';el.focus();}window.__lat=[];window.__long=[];})()`)
        await sleep(200)
        const m1 = await metrics()
        const dispatchMs = []
        for (let i = 0; i < n; i++) {
          const t = Date.now()
          await S('Input.insertText', { text: String((i + 1) % 10) })
          dispatchMs.push(Date.now() - t)
          await sleep(delay)
        }
        await sleep(500)
        const m2 = await metrics()
        return { ...summarize(n, diff(m1, m2), await evalJS(LAT), await evalJS(`window.__long.slice(0,20)`)), dispatchMs }
      }

      result.keystroke = await typeOnce(10, 80)

      // A/B：逐项剥离可疑绘制成本，看延迟能降多少（只用于定位，不是修复）
      result.variants = {}
      const variants = [
        ['no-shadow', '*{box-shadow:none!important}'],
        ['zoom-off', '.cross-tbl{zoom:1!important}'],
        ['sticky-off', '.cross-tbl td,.cross-tbl th{position:static!important}'],
        ['content-vis', '.cross-tbl.edit-tbl tbody tr{content-visibility:auto;contain-intrinsic-size:21px}'],
        ['heat-off', '.qty-cell{background:none!important}'],
      ]
      for (const [name, css] of variants) {
        try {
          await evalJS(`(()=>{const s=document.createElement('style');s.id='pv-${name}';s.textContent=${JSON.stringify(css)};document.head.appendChild(s);})()`)
          await sleep(350)
          result.variants[name] = await typeOnce(8, 80)
        } catch (e) { pushErr('variant ' + name + ': ' + e.message) }
        await evalJS(`(()=>{const s=document.getElementById('pv-${name}');if(s)s.remove();})()`)
        await sleep(200)
      }

      /* 针对性验证：关掉 autocomplete / spellcheck（判定 Autofill/拼写检查这类未打点 C++ 成本） */
      await evalJS(`(()=>{document.querySelectorAll('.cross-tbl.edit-tbl input').forEach(i=>{i.setAttribute('autocomplete','off');i.setAttribute('spellcheck','false')});})()`)
      await sleep(300)
      result.autocompleteOff = await typeOnce(8, 80)
      await evalJS(`(()=>{document.querySelectorAll('.cross-tbl.edit-tbl input').forEach(i=>{i.removeAttribute('autocomplete');i.removeAttribute('spellcheck')});})()`)

      /* 定位实验 A：把该 input **整个移出表格**（属性与 Vue 监听器全保留）再打字。
         若延迟掉下来 ⇒ 是「表格上下文/DOM 规模」；若仍是 120ms ⇒ 是该元素自身。 */
      await evalJS(`(()=>{const el=document.querySelector('[data-perf-target="1"]');if(el){el.__home=el.parentElement;document.body.appendChild(el);el.focus();}})()`)
      await sleep(300)
      result.detachedInput = await typeOnce(8, 80)

      /* 定位实验 B：新建一个同属性 input（type/inputmode/class 一致）放 body。 */
      await evalJS(`(()=>{const i=document.createElement('input');i.id='perf-dup';i.type='text';i.setAttribute('inputmode','numeric');i.className='cell-input cell-qty';i.style.cssText='position:fixed;left:8px;top:40px;width:120px;height:20px;z-index:99999;background:#fff;color:#000';document.body.appendChild(i);})()`)
      await sleep(200)
      result.dupInput = await typeOnce(6, 80, '#perf-dup')
      await evalJS(`(()=>{const i=document.getElementById('perf-dup');if(i)i.remove();})()`)

      /* 定位实验 C：同属性 input + `list="opt-qty"`（唯一差别是 datalist）。 */
      result.datalistInfo = await evalJS(`(()=>{const dl=document.getElementById('opt-qty');if(!dl)return{present:false};return{present:true,options:dl.querySelectorAll('option').length}})()`)
      await evalJS(`(()=>{const i=document.createElement('input');i.id='perf-dup2';i.type='text';i.setAttribute('inputmode','numeric');i.className='cell-input cell-qty';i.setAttribute('list','opt-qty');i.style.cssText='position:fixed;left:8px;top:70px;width:120px;height:20px;z-index:99999;background:#fff;color:#000';document.body.appendChild(i);})()`)
      await sleep(200)
      result.dupWithList = await typeOnce(6, 80, '#perf-dup2')
      await evalJS(`(()=>{const i=document.getElementById('perf-dup2');if(i)i.remove();})()`)

      /* 定位实验 D：cloneNode —— 复制全部属性、**丢弃 Vue 监听器** */
      await evalJS(`(()=>{const src=document.querySelector('[data-perf-target="1"]');if(!src)return;const c=src.cloneNode(true);c.id='perf-clone';c.removeAttribute('data-perf-target');c.style.cssText='position:fixed;left:8px;top:130px;width:120px;height:20px;z-index:99999;background:#fff;color:#000';document.body.appendChild(c);})()`)
      await sleep(200)
      result.cloneNoListeners = await typeOnce(6, 80, '#perf-clone')

      /* 定位实验 D2：clone + **空 input 监听器** —— 区分「监听器存在」与「监听器内的响应式写入」 */
      await evalJS(`(()=>{const c=document.getElementById('perf-clone');if(!c)return;c.addEventListener('input',()=>{});c.focus();})()`)
      await sleep(200)
      result.cloneWithNoopListener = await typeOnce(6, 80, '#perf-clone')

      /* 定位实验 E：真元素剥掉所有属性（**保留 Vue 监听器**） */
      await evalJS(`(()=>{const el=document.querySelector('[data-perf-target="1"]');if(!el)return;const keep=[...el.attributes].map(a=>[a.name,a.value]);el.__attrs=keep;[...el.attributes].forEach(a=>el.removeAttribute(a.name));el.setAttribute('data-perf-target','1');el.setAttribute('type','text');el.style.cssText='position:fixed;left:8px;top:100px;width:120px;height:20px;z-index:99999;background:#fff;color:#000';el.focus();})()`)
      await sleep(200)
      result.strippedAttrs = await typeOnce(6, 80)

      /* 对照实验：页面上一个**独立的小输入框**（与表格无关）。
         作用：判定「~120ms/键」是页面成本，还是 headless/CDP 环境固有开销。 */
      await evalJS(`(()=>{const i=document.createElement('input');i.id='perf-ctl';i.style.cssText='position:fixed;left:8px;top:8px;width:140px;height:26px;z-index:99999;background:#fff;color:#000';document.body.appendChild(i);})()`)
      await sleep(250)
      result.controlTiny = await typeOnce(8, 80, '#perf-ctl')
      await evalJS(`(()=>{const i=document.getElementById('perf-ctl');if(i)i.remove();})()`)
    } else pushErr('no qty input found')

    /* ---------- 6) 编辑态滚动 ---------- */
    result.editScroll = await evalJS(scrollProbe, true)
  }

  result.meta.jseventListeners = (await metrics()).JSEventListeners
} catch (e) {
  pushErr('fatal: ' + (e && e.message))
  if (chromeErr) pushErr('chrome stderr: ' + chromeErr.slice(-300))
} finally {
  result.meta.measuredAt = new Date().toISOString()
  const outFile = path.join(OUT_DIR, `forecast-${TAG}.json`)
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
  console.log('\n=== 写入 ' + outFile + ' ===')
  cleanup()
  process.exit(0)
}
