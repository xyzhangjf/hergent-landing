// v295 真机验收探针 v3（生产 hergent.cn）——「报单简称：历史列头名册点选 + 自动解析」
// 全程只读：登录 → 读 DOM → 读接口。**不点保存**，不产生任何业务写入。
//
// 三个已踩过的坑（都记在这里，避免复发）：
//   1. 账号必须用 supervisor：`/forecast` 的合法角色 = admin/boss/supervisor。用 sales 会被
//      路由守卫**正确**弹回 /workbench，而 Shell 会立刻清掉 `?denied=` ⇒ 看起来像"深链失效"。
//   2. 冷启动深链必须让浏览器**真的换一次文档**：`/` → `/#/forecast?...` 是同文档 hash 变更，
//      addInitScript 不会执行 ⇒ localStorage 为空 ⇒ 被弹到 /login。加 query 参数即可。
//   3. 判别力靠**四路对照**：接管既有列(ok) / 只会新增列(warn) / 撞名被拒(err) / 名册外(warn)。
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'

// 🔴 凭据只从环境变量取（不把提审账号落进被 git 跟踪的 outputs/）：
//   PROBE_USER=... PROBE_PASS=... node v295-live-probe.mjs
const U = process.env.PROBE_USER, P = process.env.PROBE_PASS
if (!U || !P) { console.log('缺 PROBE_USER / PROBE_PASS 环境变量'); process.exit(1) }

const J = (fn) => '(function(){' + fn + '})()'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = []
const R = {}

const b = await launch({ headless: true })
const p = await b.newPage()
let initId = ''
try {
  await p.enable()
  await p.goto('https://hergent.cn/', 4000)

  // ── ① 后端真实登录接口拿 token（比模拟点表单可靠：v-model 在合成事件下易静默不触发）
  out.push('=== ① 接口登录（supervisor：/forecast 的合法角色） ===')
  const sess = await p.eval(J(
    "return fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'}," +
    "body:JSON.stringify({username:'"+U+"',password:'"+P+"'})}).then(function(r){return r.json()}).then(function(d){" +
    "var t=d.access_token||d.token||'';" +
    "return JSON.stringify({t:t,u:JSON.stringify(d.user||{}),tid:String(d.tenant_id||''),c:d.csrf_token||''})})"))
  const S = JSON.parse(sess)
  out.push(JSON.stringify({ tokenLen: S.t.length, user: JSON.parse(S.u), tenant: S.tid, csrf: !!S.c }))
  if (!S.t) throw new Error('登录失败，拿不到 token')

  // ── ② boot 前注入登录态，再**整页加载**深链
  initId = await p.addInitScript(
    "try{localStorage.setItem('hergent_v2_token'," + JSON.stringify(S.t) + ");" +
    "localStorage.setItem('hergent_v2_user'," + JSON.stringify(S.u) + ");" +
    "localStorage.setItem('hergent_v2_tenant'," + JSON.stringify(S.tid) + ");" +
    (S.c ? "localStorage.setItem('hergent_v2_csrf'," + JSON.stringify(S.c) + ");" : '') +
    "}catch(e){}")
  await p.goto('https://hergent.cn/?__probe=' + Date.now() + '#/forecast?tab=config', 11000)
  out.push('=== ② 深链进「预报订货管理 → 报单配置」 ===')
  const nav = await p.eval(J(
    "return JSON.stringify({href:location.href," +
    "hasNewBtn:/新建配置/.test(document.body.innerText||'')," +
    "hasPage:/报单简称|报单配置/.test(document.body.innerText||'')})"))
  out.push(nav)
  Object.assign(R, JSON.parse(nav))

  // ── ③ 打开「新建配置」弹窗
  const opened = await p.eval(J(
    "var bs=[...document.querySelectorAll('button')];" +
    "var nw=bs.find(function(b){return /新建配置/.test(b.innerText||'')});" +
    "if(nw)nw.click();return !!nw"))
  await sleep(1800)
  out.push('=== ③ 打开新建配置 ===  clicked=' + opened)

  // ── ④ 简称字段：是不是 combobox？
  out.push('=== ④ 简称字段（应为 combobox） ===')
  const f4 = await p.eval(J(
    "var fs=[...document.querySelectorAll('.field')];" +
    "var f=fs.find(function(x){return /报单简称/.test(x.innerText||'')});" +
    "if(!f)return JSON.stringify({found:false});" +
    "var inp=f.querySelector('input');" +
    "return JSON.stringify({found:true,isCombo:!!f.querySelector('.combo')," +
    "ph:inp?(inp.placeholder||''):''," +
    "fieldText:(f.innerText||'').replace(/\\s+/g,' ').slice(0,200)})"))
  out.push(f4)
  Object.assign(R, JSON.parse(f4))

  // ── ⑤ 聚焦简称框 → 名册下拉（表头 + 候选项 + 状态标签）
  await p.eval(J(
    "var fs=[...document.querySelectorAll('.field')];" +
    "var f=fs.find(function(x){return /报单简称/.test(x.innerText||'')});" +
    "var inp=f&&f.querySelector('input');" +
    "if(inp){inp.focus();inp.dispatchEvent(new Event('focus',{bubbles:true}));}" +
    "return !!inp"))
  await sleep(1000)
  out.push('=== ⑤ 名册下拉 ===')
  const f5 = await p.eval(J(
    "var fs=[...document.querySelectorAll('.field')];" +
    "var f=fs.find(function(x){return /报单简称/.test(x.innerText||'')});" +
    "var pan=f&&f.querySelector('.combo-panel');" +
    "if(!pan)return JSON.stringify({panel:false});" +
    "var items=[...pan.querySelectorAll('.combo-item')].map(function(i){return (i.innerText||'').replace(/\\s+/g,' ').trim()});" +
    "var hd=pan.querySelector('.al-hd');" +
    "return JSON.stringify({panel:true,header:hd?(hd.innerText||'').replace(/\\s+/g,' '):''," +
    "count:items.length,items:items})"))
  out.push(f5)
  Object.assign(R, JSON.parse(f5))
  await p.eval(J("var i=document.body;if(i&&i.click)i.click();return 1"))
  await sleep(300)

  // ── 小工具：选对象 / 填简称 / 读简称字段状态
  const pickObj = async (kw) => {
    await p.eval(J(
      "var fs=[...document.querySelectorAll('.field')];" +
      "var of=fs.find(function(x){return /全称/.test(x.innerText||'')});" +
      "var inp=of&&of.querySelector('input');" +
      "if(inp){inp.focus();inp.value=" + JSON.stringify(kw) + ";inp.dispatchEvent(new Event('input',{bubbles:true}));}" +
      "return !!inp"))
    await sleep(900)
    const r = await p.eval(J(
      "var fs=[...document.querySelectorAll('.field')];" +
      "var of=fs.find(function(x){return /全称/.test(x.innerText||'')});" +
      "var its=of?[...of.querySelectorAll('.combo-item')]:[];" +
      "if(!its.length)return JSON.stringify({picked:'',opts:[]});" +
      "var opts=its.map(function(i){return (i.innerText||'').trim()});" +
      "its[0].dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));" +
      "return JSON.stringify({picked:opts[0],opts:opts})"))
    await sleep(1300)
    return JSON.parse(r)
  }
  const readAlias = () => p.eval(J(
    "var fs=[...document.querySelectorAll('.field')];" +
    "var f=fs.find(function(x){return /报单简称/.test(x.innerText||'')});" +
    "var of=fs.find(function(x){return /全称/.test(x.innerText||'')});" +
    "var inp=f&&f.querySelector('input');" +
    "var hi=f&&f.querySelector('.al-hint');" +
    "var tone=hi?((hi.className||'').indexOf('err')>=0?'err':(hi.className||'').indexOf('warn')>=0?'warn':(hi.className||'').indexOf('ok')>=0?'ok':''):'';" +
    "var near=f?[...f.querySelectorAll('.al-near-btn')].map(function(x){return (x.innerText||'').trim()}):[];" +
    "return JSON.stringify({obj:(of&&of.querySelector('input')||{}).value||'',alias:inp?inp.value:''," +
    "tone:tone,hint:hi?(hi.innerText||'').replace(/\\s+/g,' '):'',nearby:near})"))
  const setAlias = async (v) => {
    await p.eval(J(
      "var fs=[...document.querySelectorAll('.field')];" +
      "var f=fs.find(function(x){return /报单简称/.test(x.innerText||'')});" +
      "var inp=f&&f.querySelector('input');" +
      "if(inp){inp.focus();inp.value=" + JSON.stringify(v) + ";inp.dispatchEvent(new Event('input',{bubbles:true}));}" +
      "return 1"))
    await sleep(900)
    return JSON.parse(await readAlias())
  }

  // ── ⑥ 对照 A：选对象 `美联（保康店）`（只在 mapping 里、报单从未落地）→ 自动带出 + warn + nearby
  out.push('=== ⑥ 对照 A：选对象 → 简称自动解析（预期 warn + nearby 有「美联保康」） ===')
  const pa = await pickObj('美联（保康店）')
  const ra = JSON.parse(await readAlias())
  out.push(JSON.stringify({ 对象候选: pa.opts.slice(0, 6), 选中: pa.picked }) + '\n' + JSON.stringify(ra))
  R.A = ra

  // ── ⑦ 对照 B：点 nearby 的「美联保康」一键改选 → 接管既有列（ok）
  let rb = { tone: '', alias: '', nearby: [] }
  if (ra.nearby && ra.nearby.length) {
    await p.eval(J(
      "var fs=[...document.querySelectorAll('.field')];" +
      "var f=fs.find(function(x){return /报单简称/.test(x.innerText||'')});" +
      "var bs=f?[...f.querySelectorAll('.al-near-btn')]:[];" +
      "var t=bs.find(function(b){return (b.innerText||'').trim()===" + JSON.stringify(ra.nearby[0]) + "});" +
      "if(t)t.click();return !!t"))
    await sleep(800)
    rb = JSON.parse(await readAlias())
  } else {
    rb = await setAlias('美联保康')
  }
  out.push('=== ⑦ 对照 B：一键改选 nearby → 接管既有列（预期 ok） ===')
  out.push(JSON.stringify(rb))
  R.B = rb

  // ── ⑧ 对照 C：手打已被他人占用的列头「东津」→ 撞名会被拒（err）
  out.push('=== ⑧ 对照 C：手打「东津」（已被他人占用）→ 预期 err ===')
  const rc = await setAlias('东津')
  out.push(JSON.stringify(rc))
  R.C = rc

  // ── ⑨ 对照 D：手打名册外名字 → 会新增一列（warn）
  out.push('=== ⑨ 对照 D：手打名册外名字（预期 warn） ===')
  const rd = await setAlias('__探针不存在列__')
  out.push(JSON.stringify(rd))
  R.D = rd

  // ── ⑩ 接口口径自证（页面读的与接口读的是同一个源）
  out.push('=== ⑩ 接口口径自证 ===')
  const api = await p.eval(J(
    "return fetch('/api/report-mappings/alias-pool',{headers:{'Authorization':'Bearer '+localStorage.getItem('hergent_v2_token')}})" +
    ".then(function(r){return r.json()}).then(function(d){" +
    "var a=d.aliases||[];var sg=d.suggest||{};" +
    "var srcCount={mapping:0,report:0,hidden:0,other:0};" +
    "a.forEach(function(x){(x.sources||[]).forEach(function(s){if(srcCount[s]===undefined)srcCount.other++;else srcCount[s]++})});" +
    "var keys=Object.keys(sg);var froms={};keys.forEach(function(k){var f=sg[k].from;froms[f]=(froms[f]||0)+1});" +
    "return JSON.stringify({success:d.success,stats:d.stats,srcCount:srcCount,suggestN:keys.length,suggestFrom:froms," +
    "s2225:sg['store:2225']||null})})"))
  out.push(api)
  R.api = JSON.parse(api)

  // ── ⑪ 判别力自证
  out.push('=== ⑪ 判别力自证 ===')
  const A = R.A || {}, B2 = R.B || {}, C = R.C || {}, D = R.D || {}
  const checks = [
    ['② 深链停在 /forecast?tab=config（未被弹回）', /#\/forecast\?tab=config/.test(R.href || ''), R.href],
    ['③④ 简称字段已改为 combobox', R.isCombo === true],
    ['④ 占位文案指向「点选历史列头」', /点选历史列头/.test(R.ph || '')],
    ['⑤ 名册面板出现', R.panel === true],
    ['⑤ 名册表头带数量', /历史列头名册 · \d+ 个/.test(R.header || ''), R.header],
    ['⑤ 候选项 = 名册全量（≥20）', (R.count || 0) >= 20, 'count=' + R.count],
    /* ⑥ 选对象后自动带出。**这条对象（美联（保康店））恰好已被别人占用**，
       所以正确结果是 err（提前报冲突）而不是"安全"—— 这正是本功能要拦的形态之一。 */
    ['⑥ 选中对象后简称被自动带出（非空）', !!A.alias, 'alias=' + A.alias],
    ['⑥ 该对象已被他人占用 → 提前报冲突 err（不必等保存才失败）', A.tone === 'err', 'tone=' + A.tone],
    ['⑦ 改选名册里既有列头 → ok「接管汇总表既有列头」', B2.tone === 'ok', 'tone=' + B2.tone + ' alias=' + B2.alias],
    ['⑧ 另一条被他人占用的名字 → err「保存会被拒绝」', C.tone === 'err', 'tone=' + C.tone],
    ['⑨ 名册外名字 → warn「会新增一列」', D.tone === 'warn', 'tone=' + D.tone],
    /* nearby 只在 warn 态渲染（err/ok 时没必要劝你改选）⇒ 断言必须打在 ⑨ 上 */
    ['⑨ warn 态下给出相近列头「美联保康」可供一键改选',
      Array.isArray(D.nearby) && D.nearby.includes('美联保康'), JSON.stringify(D.nearby)],
    ['⑪ 判别力：三态齐备且互不相同（ok/warn/err）',
      B2.tone === 'ok' && D.tone === 'warn' && C.tone === 'err'],
    ['⑪ 判别力：⑥ 与 ⑦ 同一对象、不同简称 → 结论相反（err vs ok）',
      A.tone !== B2.tone, A.tone + ' vs ' + B2.tone],
    ['⑩ 接口 success', R.api && R.api.success === true],
    ['⑩ 三来源齐备（report 源非空 = 有真落地列）', R.api && R.api.srcCount.report > 0, JSON.stringify(R.api && R.api.srcCount)],
    ['⑩ suggest 带 store:2225 且 nearby 正确', !!(R.api && R.api.s2225 && (R.api.s2225.nearby || []).includes('美联保康'))],
  ]
  let bad = 0
  for (const [name, ok, extra] of checks) {
    out.push((ok ? '  PASS  ' : '  FAIL  ') + name + (extra ? '  [' + extra + ']' : ''))
    if (!ok) bad++
  }
  out.push(bad === 0 ? '\n>>> 真机验收 ALL PASS（' + checks.length + '/' + checks.length + '）'
                     : '\n>>> 真机验收 有 ' + bad + ' 项 FAIL（共 ' + checks.length + ' 项）')
} catch (e) {
  out.push('!! 探针异常: ' + ((e && e.message) || e))
} finally {
  if (initId) await p.removeInitScript(initId).catch(() => {})
  for (const line of out) console.log(line)
  console.log('console.errors:', JSON.stringify((p.errors || []).slice(0, 8)))
  await b.close()
}
