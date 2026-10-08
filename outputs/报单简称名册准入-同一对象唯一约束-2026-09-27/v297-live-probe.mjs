// v297 真机验收探针（生产 hergent.cn）——「报单简称名册只列真列头」+「同一对象只能一条活跃配置」
// 全程**不产生业务写入**：只登录、读 DOM、读接口。
//   · 唯一一次点击「保存」是**故意触发本地拦截**（员工未选 + 对象已被占用 ⇒ 必被前端就地拒绝），
//     断言点是「出现 field-err 且没有成功 toast」，并用接口复核配置条数未变。
//
// 已踩过的坑（沿用 v295 探针的三条，避免复发）：
//   1. 账号必须 supervisor：`/forecast` 合法角色 = admin/boss/supervisor；用 sales 会被守卫**正确**弹回。
//   2. 冷启动深链必须真的换一次文档（带 query）—— 否则同文档 hash 变更不执行 addInitScript。
//   3. 判别力靠**多路对照**：接管既有列(ok) / 只会新增列(warn) / 撞名被拒(err) / 对象已被占用(err+banner)。
//
// 跑法：PROBE_USER=... PROBE_PASS=... node v297-live-probe.mjs
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'

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

  // ── ① 接口登录 ────────────────────────────────────────────────────────
  out.push('=== ① 接口登录（supervisor） ===')
  const sess = await p.eval(J(
    "return fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'}," +
    "body:JSON.stringify({username:'" + U + "',password:'" + P + "'})}).then(function(r){return r.json()}).then(function(d){" +
    "var t=d.access_token||d.token||'';" +
    "return JSON.stringify({t:t,u:JSON.stringify(d.user||{}),tid:String(d.tenant_id||''),c:d.csrf_token||''})})"))
  const S = JSON.parse(sess)
  out.push(JSON.stringify({ tokenLen: S.t.length, user: JSON.parse(S.u), tenant: S.tid, csrf: !!S.c }))
  if (!S.t) throw new Error('登录失败，拿不到 token')

  // ── ② 注入登录态 + 整页加载深链 ──────────────────────────────────────
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

  // ── ③ 打开「新建配置」─────────────────────────────────────────────────
  const opened = await p.eval(J(
    "var bs=[...document.querySelectorAll('button')];" +
    "var nw=bs.find(function(b){return /新建配置/.test(b.innerText||'')});" +
    "if(nw)nw.click();return !!nw"))
  await sleep(1800)
  out.push('=== ③ 打开新建配置 ===  clicked=' + opened)

  // ── ④ 简称字段是 combobox ────────────────────────────────────────────
  out.push('=== ④ 简称字段（应为 combobox） ===')
  const f4 = await p.eval(J(
    "var fs=[...document.querySelectorAll('.field')];" +
    "var f=fs.find(function(x){return /报单简称/.test(x.innerText||'')});" +
    "if(!f)return JSON.stringify({found:false});" +
    "return JSON.stringify({found:true,isCombo:!!f.querySelector('.combo')})"))
  out.push(f4)
  Object.assign(R, JSON.parse(f4))

  // ── ⑤ 名册下拉：候选只含真列头 ───────────────────────────────────────
  await p.eval(J(
    "var fs=[...document.querySelectorAll('.field')];" +
    "var f=fs.find(function(x){return /报单简称/.test(x.innerText||'')});" +
    "var inp=f&&f.querySelector('input');" +
    "if(inp){inp.focus();inp.dispatchEvent(new Event('focus',{bubbles:true}));}" +
    "return !!inp"))
  await sleep(1000)
  out.push('=== ⑤ 名册下拉（v297 关键：只列真实列头）===')
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

  // ── 小工具 ────────────────────────────────────────────────────────────
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
    "var cls=hi?(hi.className||''):'';" +
    "var tone=cls.indexOf('err')>=0?'err':(cls.indexOf('warn')>=0?'warn':(cls.indexOf('ok')>=0?'ok':''));" +
    "var near=f?[...f.querySelectorAll('.al-near-btn')].map(function(x){return (x.innerText||'').trim()}):[];" +
    "var objBanner=of?of.querySelector('.al-hint'):null;" +
    "var ocls=objBanner?(objBanner.className||''):'';" +
    "return JSON.stringify({obj:(of&&of.querySelector('input')||{}).value||'',alias:inp?inp.value:''," +
    "tone:tone,nearby:near," +
    "objBannerCls:ocls," +
    "objBannerText:objBanner?(objBanner.innerText||'').replace(/\\s+/g,' ').slice(0,160):''})"))
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

  // ── ⑥ 三个"只在配置里出现过"的名字不出现在候选里 ────────────────────
  const items = R.items || []
  const has = (n) => items.some((s) => s.indexOf(n) === 0 || s === n)
  R.misleading = {
    a: items.some((s) => s.indexOf('美联（保康店）') >= 0),
    b: items.some((s) => s.indexOf('永辉东津店') >= 0),
    c: items.some((s) => s.indexOf('永诺（江山店）') >= 0),
  }
  out.push('=== ⑥ 误导名是否仍在候选 ===  ' + JSON.stringify(R.misleading))

  // ── ⑦ 选对象「美联（保康店）」→ 自动解析给真列头 + 对象已有配置 banner ──
  out.push('=== ⑦ 选对象「美联（保康店）」 ===')
  const pa = await pickObj('美联（保康店）')
  const ra = JSON.parse(await readAlias())
  out.push(JSON.stringify({ 对象候选: (pa.opts || []).slice(0, 6), 选中: pa.picked }))
  out.push(JSON.stringify(ra))
  R.A = ra

  // ── ⑧ 点保存：必须被**就地拦下**（对象已有活跃配置）────────────────────
  // 🔴 坑（实测踩过）：页面上有**两个**文字为「保存」的按钮 —— 「模板参数」卡片里那个
  //    (`btn-sm` + @click="saveProfile"，DOM 更靠前) 与新建配置弹窗页脚那个。
  //    用 `innerText==='保存'` 找按钮会命中前者 ⇒ 点了 saveProfile（一个**写接口**），
  //    而弹窗的 save() 根本没跑（所以我第一轮看到 fieldErrs 为空、还以为拦截失效）。
  //    修法：只在**可见弹窗**的页脚里找主按钮。
  out.push('=== ⑧ 点「保存」（应被本地拦截，不产生写入） ===')
  const beforeCnt = await p.eval(J(
    "return fetch('/api/report-mappings?include_inactive=1',{headers:{'Authorization':'Bearer '+localStorage.getItem('hergent_v2_token')}})" +
    ".then(function(r){return r.json()}).then(function(d){var a=Array.isArray(d)?d:(d.items||d.rows||d.data||[]);return String(a.length)})"))
  const clicked = await p.eval(J(
    // ⚠️ 不能用 offsetParent 判"可见"：`.df-modal` 是 position:fixed ⇒ offsetParent **恒为 null**
    //    （第一版就栽在这，探针直接 NO_MODAL、根本没点到按钮）。
    //    改成"含『报单简称』字段的那个弹窗"来定位，既唯一又不受布局影响。
    "var ms=[...document.querySelectorAll('.df-modal')];" +
    "var md=ms.find(function(m){return /报单简称/.test(m.innerText||'')});" +
    "if(!md)return 'NO_MODAL:'+ms.length;" +
    "var bt=md.querySelector('.df-modal-ft .btn-primary');" +
    "if(!bt)return 'NO_BTN';" +
    "var t=(bt.innerText||'').trim();bt.click();return 'CLICKED:'+t"))
  out.push('  点击目标 = ' + clicked)
  R.clicked = clicked
  // toast 存活 3s（store/index.js: setTimeout 3000）⇒ 点完立刻轮询，别等太久
  let saveState = { fieldErrs: [], toasts: [] }
  for (let i = 0; i < 8; i++) {
    await sleep(400)
    const s = await p.eval(J(
      "var errs=[...document.querySelectorAll('.field-err,.df-err')].map(function(x){return (x.innerText||'').trim()});" +
      "var tx=[...document.querySelectorAll('.toast')].map(function(x){return (x.innerText||'').trim()});" +
      "return JSON.stringify({fieldErrs:errs,toasts:tx})"))
    const o = JSON.parse(s)
    if (o.fieldErrs.length || o.toasts.length) { saveState = o; break }
  }
  out.push(JSON.stringify(saveState))
  R.save = saveState
  const afterCnt = await p.eval(J(
    "return fetch('/api/report-mappings?include_inactive=1',{headers:{'Authorization':'Bearer '+localStorage.getItem('hergent_v2_token')}})" +
    ".then(function(r){return r.json()}).then(function(d){var a=Array.isArray(d)?d:(d.items||d.rows||d.data||[]);return String(a.length)})"))
  R.cntBefore = String(beforeCnt); R.cntAfter = String(afterCnt)
  out.push('配置条数 before=' + beforeCnt + ' after=' + afterCnt)

  // ── ⑨ 三态对照：ok / err / warn ───────────────────────────────────────
  // 前置：把对象换成「吃货基地（东津民发广场店)ZY」—— 它的全称里含**两个**真列头（东津 / 民发），
  //       这样 warn 态的「相近列头一键改选」才有内容可给。nearby 会排掉"建议值本身"，
  //       所以像「美联（保康店）」这种只对应一个列头的对象，nearby 必然为空（这是对的行为）。
  out.push('=== ⑨ 三态对照 ===')
  const px = await pickObj('东津民发广场')
  out.push('（前置）对象改为：' + px.picked + '  候选=' + JSON.stringify((px.opts || []).slice(0, 3)))
  R.pickedObj = px.picked
  // 🔴 改选对象后，上一轮保存留下的「这个门店已有一条活跃配置…」必须**立即消失** ——
  //    否则红字挂在一个已被改掉的字段下面，看着像新对象也有问题（真机截图 03 抓到的就是它）。
  R.errsAfterObjChange = JSON.parse(await p.eval(J(
    "var errs=[...document.querySelectorAll('.field-err,.df-err')].map(function(x){return (x.innerText||'').trim()});" +
    "return JSON.stringify(errs)")))
  out.push('  改选对象后的剩余红字 = ' + JSON.stringify(R.errsAfterObjChange))
  const rOk = await setAlias('汴河')                     // 真列头、无人占用 → ok
  out.push('ok 态：' + JSON.stringify(rOk)); R.OK = rOk
  const rErr = await setAlias('东津')                    // 已被 id=3 占用 → err
  out.push('err 态：' + JSON.stringify(rErr)); R.ERR = rErr
  const rWarn = await setAlias('__探针不存在列__')        // 名册外 → warn + nearby
  out.push('warn 态：' + JSON.stringify(rWarn)); R.WARN = rWarn

  // ── ⑩ 接口口径 ────────────────────────────────────────────────────────
  const api = await p.eval(J(
    "return fetch('/api/report-mappings/alias-pool',{headers:{'Authorization':'Bearer '+localStorage.getItem('hergent_v2_token')}})" +
    ".then(function(r){return r.json()}).then(function(d){" +
    "var a=d.aliases||[];var L=a.filter(function(x){return x.listed}).map(function(x){return x.name});" +
    "var N=a.filter(function(x){return !x.listed}).map(function(x){return x.name});" +
    "return JSON.stringify({success:d.success,stats:d.stats,listed:L,notListed:N})})"))
  out.push('=== ⑩ 接口口径 ===\n' + api)
  R.api = JSON.parse(api)

  // ── ⑪ 判别力自证 ──────────────────────────────────────────────────────
  out.push('=== ⑪ 判别力自证 ===')
  const A = R.A || {}, OK = R.OK || {}, ERR = R.ERR || {}, WARN = R.WARN || {}, SV = R.save || {}, AP = R.api || {}
  const checks = [
    ['② 深链停在 /forecast?tab=config（未被弹回）', /#\/forecast\?tab=config/.test(R.href || ''), R.href],
    ['④ 简称字段是 combobox', R.isCombo === true],
    ['⑤ 名册面板出现', R.panel === true],
    ['⑤ 表头数量 = 21（= 接口 stats.total，也已剔除 3 个误导名）',
      /历史列头名册 · 21 个/.test(R.header || ''), R.header],
    ['⑥ 误导名「美联（保康店）」**不在**候选里', R.misleading.a === false],
    ['⑥ 误导名「永辉东津店」**不在**候选里', R.misleading.b === false],
    ['⑥ 误导名「永诺（江山店）」**不在**候选里', R.misleading.c === false],
    ['⑥ 真列头「美联保康」**在**候选里', has('美联保康')],
    ['⑥ 真列头「东津」**在**候选里', has('东津')],
    ['⑦ 选对象后简称被自动解析为真列头「美联保康」（不再是店名全称）',
      A.alias === '美联保康', 'alias=' + A.alias],
    ['⑦ 该对象已有一条活跃配置 → 对象级 banner 是 err 且文案点明「保存会被拒绝」',
      /err/.test(A.objBannerCls || '') && /保存会被拒绝/.test(A.objBannerText || ''), A.objBannerText],
    ['⑧ 点保存命中的是**弹窗页脚**的主按钮（不是「模板参数」那个同名按钮）',
      R.clicked === 'CLICKED:保存', R.clicked],
    ['⑧ 点保存被就地拦下：出现「已有一条活跃配置」字段错误',
      (SV.fieldErrs || []).some((t) => /已有一条活跃配置/.test(t)), JSON.stringify(SV.fieldErrs)],
    ['⑧ 没有出现成功 toast', !(SV.toasts || []).some((t) => /已创建|已更新/.test(t)), JSON.stringify(SV.toasts)],
    ['⑧ 配置条数未变（真的没写进去）', R.cntBefore === R.cntAfter && R.cntBefore !== '', R.cntBefore + ' -> ' + R.cntAfter],
    ['⑨ 改选对象后，上一轮针对**旧对象**的红字立即消失（不留误导）',
      !(R.errsAfterObjChange || []).some((t) => /已有一条活跃配置/.test(t)), JSON.stringify(R.errsAfterObjChange)],
    ['⑨ 真列头且无人占用 → ok', OK.tone === 'ok', 'tone=' + OK.tone],
    ['⑨ 被他人占用 → err', ERR.tone === 'err', 'tone=' + ERR.tone],
    ['⑨ 名册外 → warn', WARN.tone === 'warn', 'tone=' + WARN.tone],
    ['⑨ warn 态给出相近列头可一键改选（且给出的一定是真列头）',
      Array.isArray(WARN.nearby) && WARN.nearby.length > 0 &&
      WARN.nearby.every((n) => (AP.listed || []).includes(n)),
      JSON.stringify(WARN.nearby)],
    ['⑪ 判别力：三态齐备且互不相同', OK.tone === 'ok' && ERR.tone === 'err' && WARN.tone === 'warn'],
    ['⑩ 接口 stats.total = 21 且 configured_only = 2',
      AP.stats && AP.stats.total === 21 && AP.stats.configured_only === 2, JSON.stringify(AP.stats)],
    ['⑩ 接口里 listed 与非 listed 两集合互不相交、并集 = 23',
      (AP.listed || []).filter((n) => (AP.notListed || []).includes(n)).length === 0 &&
      (AP.listed || []).length + (AP.notListed || []).length === 23,
      'listed=' + (AP.listed || []).length + ' notListed=' + (AP.notListed || []).length],
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
