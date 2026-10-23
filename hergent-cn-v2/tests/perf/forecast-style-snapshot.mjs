/* 编辑表「渲染指纹」快照 —— 拆行组件前后必须逐项一致，否则就是样式/结构静默丢失。
   ============================================================
   为什么需要它：拆 `<tr>` 成子组件后，父组件的 `<style scoped>` **不再作用于子组件内部**
   （scoped 只给模板里的元素加 data-v，子组件内部元素带的是它自己的 scopeId）。
   这会让几百条 td/th 规则静默失效 —— 页面照样能用，只是变丑/错位，逻辑探针抓不到。
   所以这里取两份可机检的事实：
     1) 结构：`tagName.className` 的深度优先序列（拆组件不应改变任何一个节点）
     2) 样式：每个元素 40 个计算样式属性（必须逐元素逐属性相同）
   采样策略：表头 + 前 15 行 + 随机 10 行 + 末尾 2 行 + 合计行 ——
   足以覆盖所有 tr/td 状态组合（普通/新增/当前行/整行选中/条件警告/冻结/选中/区间/非法/flash）。
   用法：node tests/perf/forecast-style-snapshot.mjs <tag>
*/
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.HG_BASE || 'https://hergent.cn'
const OUT_DIR = path.dirname(new URL(import.meta.url).pathname)
const TAG = process.argv[2] || 'before'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

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
          m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result)
        }
      }
    })
  }
  send(method, params = {}, sessionId, timeout = 60000) {
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

/* 在页面里跑：抓结构 + 采样元素的 40 个计算样式 */
const PROBE = `(() => {
  const PROPS = ['display','position','width','height','minWidth','maxWidth',
    'paddingTop','paddingRight','paddingBottom','paddingLeft',
    'marginTop','marginRight','marginBottom','marginLeft',
    'borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth',
    'borderTopStyle','borderLeftStyle','borderTopColor','backgroundColor','color',
    'fontSize','fontWeight','lineHeight','textAlign','verticalAlign','whiteSpace',
    'overflowX','overflowY','zIndex','left','top','right','bottom','opacity','visibility',
    'pointerEvents','boxShadow','textOverflow','flexDirection','justifyContent','gap','transform']
  const tbl = document.querySelector('.cross-tbl.edit-tbl')
  if (!tbl) return { error: '编辑表不存在' }
  const rows = [...tbl.querySelectorAll('tbody tr')]
  const idx = new Set()
  for (let i = 0; i < Math.min(15, rows.length); i++) idx.add(i)
  for (let i = Math.max(0, rows.length - 2); i < rows.length; i++) idx.add(i)
  /* 固定抽样（不用随机，保证两次可比） */
  for (let i = 0; i < rows.length; i += Math.max(1, Math.floor(rows.length / 10))) idx.add(i)

  const out = { rows: rows.length, nodes: [], styles: [] }
  const walk = (el, depth, pathStr) => {
    /* 🔴 SVG 元素的 className 是 SVGAnimatedString（不是字符串），原来这里一律退化成空串
       ⇒ svg 上的类名（如 ico）从来进不了指纹，样式比对对 svg 完全瞎。
       取 baseVal 兜住两种类型。（注意：这段在模板字符串里，注释不能出现反引号） */
    const cls = typeof el.className === 'string' ? el.className : ((el.className && el.className.baseVal) || '')
    out.nodes.push(depth + '|' + pathStr + '|' + el.tagName + '.' + cls)
    for (const c of el.children) walk(c, depth + 1, pathStr)
  }
  /* 结构：表头 + 抽样行（用索引定位，拆组件后索引不变才算真一致） */
  const thead = tbl.querySelector('thead')
  if (thead) walk(thead, 0, 'thead')
  const sortedIdx = [...idx].sort((a, b) => a - b)
  for (const i of sortedIdx) { const tr = rows[i]; if (tr) walk(tr, 0, 'tr' + i) }
  const foot = document.querySelector('.col-total-bar table')
  if (foot) walk(foot, 0, 'foot')

  /* 样式：对采样行内的每个元素取 44 个属性 */
  const grab = (root, pathStr) => {
    const list = [root, ...root.querySelectorAll('*')]
    const parts = []
    for (let k = 0; k < list.length; k++) {
      const el = list[k]
      const cs = getComputedStyle(el)
      const vals = PROPS.map(p => cs[p]).join(';')
      parts.push(k + '|' + el.tagName + '|' + vals)
    }
    out.styles.push(pathStr + ' => ' + parts.join('\\n'))
  }
  if (thead) grab(thead, 'thead')
  for (const i of sortedIdx) { const tr = rows[i]; if (tr) grab(tr, 'tr' + i) }
  if (foot) grab(foot, 'foot')
  return out
})()`

const udd = path.join(os.tmpdir(), 'hg-style-' + Date.now())
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
  const S = (m, p = {}, t = 60000) => cdp.send(m, p, sessionId, t)
  await S('Page.enable'); await S('Runtime.enable'); await S('Network.enable')

  const evalJS = async (expression, awaitPromise = false) => {
    const r = await S('Runtime.evaluate', { expression, returnByValue: true, awaitPromise, userGesture: true })
    if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text))
    return r.result?.value
  }
  const waitFor = async (expr, timeout = 90000, label = '') => {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      try { if (await evalJS(`(()=>{try{return !!(${expr})}catch(e){return false}})()`)) return true } catch {}
      await sleep(150)
    }
    throw new Error('waitFor 超时: ' + (label || expr))
  }

  const TOKEN_FILE = path.join(OUT_DIR, '.tmp-token')
  const TOKEN = (process.env.HG_TOKEN || (fs.existsSync(TOKEN_FILE) ? fs.readFileSync(TOKEN_FILE, 'utf8') : '')).trim()
  if (!TOKEN) throw new Error('缺少 tests/perf/.tmp-token')
  const csrf = 'styleprobe' + Date.now()
  for (const [name, value, httpOnly] of [
    ['erp_token', TOKEN, true], ['hergent_auth', '1', false],
    ['hergent_tenant', '1', false], ['csrf_token', csrf, false],
  ]) {
    await S('Network.setCookie', { name, value, url: BASE + '/', httpOnly, secure: BASE.startsWith('https'), sameSite: 'Lax' })
  }

  await S('Page.navigate', { url: BASE + '/#/forecast' }, 60000)
  await waitFor(`document.readyState==='complete'`, 60000, 'load')
  await waitFor(`!!document.querySelector('.cross-tbl')`, 90000, '表格')
  await sleep(1800)

  const opened = await evalJS(`(()=>{
    const c=[...document.querySelectorAll('button,a,span,div')].filter(el=>/^(改单|编辑报单|修改)$/.test((el.textContent||'').trim())&&el.offsetParent!==null);
    if(!c.length) return false; c[0].click(); return true })()`)
  if (!opened) throw new Error('未找到「改单」按钮')
  await waitFor(`!!document.querySelector('.cross-tbl.edit-tbl')`, 90000, '编辑表')
  await waitFor(`document.querySelectorAll('.cross-tbl.edit-tbl tbody tr').length > 200`, 90000, '294 行')
  await sleep(2500)

  /* 让若干状态同时存在，好让指纹覆盖 selected / range-sel / flash 这些分支：
     选中一个格 + 打开列设置外的普通状态。不写任何业务数据。 */
  await evalJS(`(()=>{
    const t=document.querySelector('.cross-tbl.edit-tbl');
    const tr=t.querySelectorAll('tbody tr')[3];
    const td=tr.querySelector('td[data-c="2"]')||tr.querySelector('td');
    if(td){ td.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:100,clientY:100})); }
    window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
    return true })()`)
  await sleep(400)

  const snap = await evalJS(PROBE)
  if (!snap || snap.error) throw new Error(snap ? snap.error : '探针无返回')

  const outFile = path.join(OUT_DIR, `style-${TAG}.json`)
  fs.writeFileSync(outFile, JSON.stringify(snap))
  console.log('build:', await evalJS(`window.__HG_BUILD__ || '-'`))
  console.log('行数:', snap.rows, '| 结构节点:', snap.nodes.length, '| 样式块:', snap.styles.length)
  console.log('已写入', outFile)
} catch (e) {
  console.error('FAILED:', e && e.message)
  if (chromeErr) console.error('chrome stderr:', chromeErr.slice(-300))
  process.exitCode = 1
} finally {
  cleanup()
}
