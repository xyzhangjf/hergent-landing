/**
 * v492 探针（只读；不写生产库、不改任何服务端状态）
 *
 * 覆盖本轮两个改动：
 *   ① 加宽副驾区域  —— .copilot 宽度 880 → 1120，使「产物栏打开」时输入框工具条
 *                      （左＝＋/团队/权限/朗读声音，右＝语音/截图/发送）保持**单行**。
 *   ② 用户上传附件  —— 用户发给副驾的文件（m.files）**不再**进侧栏产物区，
 *                      改为留在沟通面板（气泡）里，可下载回看。
 *
 * 判据（全部只看真实 DOM）：
 *   相位 A（布局）
 *     A1 副驾抽屉已加宽（.copilot 宽度 ≥ 1000）
 *     A2 工具条单行：.cp-tools 与 .cp-trailing 顶边一致（未换行）
 *     A3 工具条在「产物栏展开」状态下测的（复现窄聊天区）
 *   相位 B（产物落位）
 *     B1 用户上传文件名 **不在** 侧栏产物区
 *     B2 用户上传文件 **在** 沟通面板（气泡）里，且有可下载文件卡
 *     B3 该下载卡走 chat-attachment 按 file_id 取数
 *     B4 回归：副驾产出文件仍在侧栏
 *     B5 回归：经营卡仍在侧栏
 *     B6 侧栏产物计数 = 卡片1 + 产出文件1 = 2（不含用户附件）
 *     P5 全程零 console.error / 零页面异常
 *
 * 用法：
 *   V492_BASE=http://127.0.0.1:8181 node v492-probe.mjs   # 修后产物（全绿）
 *   V492_BASE=http://127.0.0.1:8183 node v492-probe.mjs   # 修前基线（A1/A2/B1/B2/B3 应 FAIL）
 * ⚠️ 本机沙箱挡 Chrome 访问 loopback ⇒ 本地跑须在非沙箱环境执行。
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'

const BASE = process.env.V492_BASE || 'https://hergent.cn'
const TOKEN = process.env.HG_TOKEN || 'local-dummy-token'
const TENANT = process.env.HG_TENANT || '1'
const IS_LOCAL = /127\.0\.0\.1|localhost/.test(BASE)
const LAT = Number(process.env.V492_LAT || 120)

const SESS_KEY = 'hergent_chat_sessions_v1'
const now = Date.now()
const UP_NAME = '我的报表.xlsx'          // 用户**上传**的文件（不该进侧栏）
const ART_NAME = 'rebate-2026-10.xlsx'   // 副驾**产出**的文件（应留在侧栏）
const CARD_TITLE = '本月返利达成'

const mkSess = () => ({
  id: '_v492_LAY_', title: 'v492', roleId: 'copilot', updated_at: now - 1000,
  messages: [
    { role: 'user', content: '看看这份表，顺便出一份返利对账', files: [{ file_id: 'FID_UP_9', file_name: UP_NAME, file_type: 'xlsx', rows: 3 }] },
    { role: 'assistant', content: '已生成，请查收。\nMEDIA:/opt/hermes-tenants/1/output/' + ART_NAME },
    {
      role: 'assistant',
      content: '这是本月经营卡：',
      card: { type: 'kpi', title: CARD_TITLE, summary: '返利达成 92%', metrics: [{ label: '预计返利', value: '12.3 万', tone: 'ok' }] },
    },
  ],
})

const R = []
const ok = (name, cond, detail = '') => R.push({ name, pass: !!cond, detail: String(detail) })

const INIT_STUB = `
(function(){
  try {
    localStorage.setItem('hergent_v2_token', ${JSON.stringify(TOKEN)});
    localStorage.setItem('hergent_v2_tenant', ${JSON.stringify(TENANT)});
  } catch(e){}
  const _f = window.fetch.bind(window);
  const LAT = ${LAT};
  const delay = (fn) => new Promise(res => setTimeout(function(){ res(fn()); }, LAT));
  const J = (obj) => delay(function(){ return new Response(JSON.stringify(obj), { status:200, headers:{ 'Content-Type':'application/json' } }); });
  const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
  window.fetch = function(u, o){
    const url = (typeof u === 'string') ? u : ((u && u.url) || '');
    if (url.indexOf('/api/ai/roles') === 0) {
      return J({ roles: [ { role_id:'copilot', name:'经营副驾', is_active:1, system_prompt:'', guard:'' } ] });
    }
    if (url.indexOf('/api/ai/media') === 0) {
      return delay(function(){
        const bin = atob(PNG_B64); const arr = new Uint8Array(bin.length);
        for (let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
        return new Response(arr, { status:200, headers:{ 'Content-Type':'image/png' } });
      });
    }
    if (url.indexOf('/api/chat-attachment/download/') === 0) {
      return delay(function(){ return new Response('dummy', { status:200, headers:{ 'Content-Type':'application/octet-stream' } }); });
    }
    if (/\\/api\\/ai\\/sessions\\/[^/]+/.test(url)) {
      const id = url.split('/api/ai/sessions/')[1].split('?')[0];
      let msgs = [];
      try { const arr = JSON.parse(localStorage.getItem(${JSON.stringify(SESS_KEY)})||'[]'); const s = arr.find(x=>x.id===id); if (s) msgs = s.messages||[]; } catch(e){}
      return J({ session: { messages: msgs } });
    }
    if (/\\/api\\/ai\\/sessions(\\?|$)/.test(url)) return J({ sessions: [] });
    return _f(u, o);
  };
})();
`

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const browser = await launch({ extraArgs: IS_LOCAL ? ['--no-proxy-server'] : [] })
try {
  const page = await browser.newPage()
  await page.enable()
  await page.addInitScript(INIT_STUB)

  let seedId = ''
  const seed = async (arr) => {
    if (seedId) { await page.removeInitScript(seedId); seedId = '' }
    seedId = await page.addInitScript(
      `(function(){ try { localStorage.setItem(${JSON.stringify(SESS_KEY)}, ${JSON.stringify(JSON.stringify(arr))}); } catch(e){} })();`
    )
  }
  const openCopilotAndPanel = async () => {
    await page.eval(`(() => { const b=document.querySelector('.tb-copilot'); if(b) b.click(); })()`)
    await sleep(1500)
    await page.eval(`(() => { const b=document.querySelector('.cp-art-toggle'); if(b && !document.querySelector('.cp-artifacts.show-art')) b.click(); })()`)
    await sleep(600)
  }
  const goto = async () => { await page.goto(BASE + '/?__r=' + Date.now() + '#/workbench', 2400) }

  await seed([mkSess()])
  await goto()
  const url0 = await page.eval('location.href')
  ok('P0 未跳登录页', !/#\/login/.test(url0), url0)

  await openCopilotAndPanel()

  // ---------- 相位 A：布局（工具条单行） ----------
  const a = JSON.parse(await page.eval(`(() => {
    const dr = document.querySelector('.copilot');
    const chat = document.querySelector('.cp-chat');
    const tools = document.querySelector('.cp-toolbar .cp-tools');
    const trail = document.querySelector('.cp-toolbar .cp-trailing');
    const rc = el => el ? el.getBoundingClientRect() : null;
    const A=rc(tools), B=rc(trail), D=rc(dr), C=rc(chat);
    return JSON.stringify({
      drawerW: D ? Math.round(D.width) : 0,
      chatW: C ? Math.round(C.width) : 0,
      toolsTop: A ? Math.round(A.top) : -1,
      trailTop: B ? Math.round(B.top) : -1,
      artOpen: !!document.querySelector('.cp-artifacts.show-art'),
    });
  })()`))
  console.log('\n--- 相位A 布局实测 ---')
  console.log(JSON.stringify(a, null, 1))
  ok('A1 副驾抽屉已加宽（.copilot ≥ 1000px）', a.drawerW >= 1000, 'drawerW=' + a.drawerW)
  ok('A2 输入框工具条单行（.cp-tools 与 .cp-trailing 顶边一致）', Math.abs(a.toolsTop - a.trailTop) < 4, 'toolsTop=' + a.toolsTop + ' trailTop=' + a.trailTop)
  ok('A3 本次是在「产物栏展开」状态测量（复现窄聊天区）', a.artOpen === true)

  // ---------- 相位 B：产物落位 ----------
  const b = JSON.parse(await page.eval(`(() => {
    const panel = document.querySelector('.cp-artifacts');
    const panelText = panel ? panel.innerText.replace(/\\s+/g,' ').trim() : '';
    const count = (panel && panel.querySelector('.cp-art-count')) ? panel.querySelector('.cp-art-count').innerText.trim() : '';
    const userMsg = document.querySelector('.cp-body .msg.user');
    const userText = userMsg ? userMsg.innerText.replace(/\\s+/g,' ').trim() : '';
    const links = [...document.querySelectorAll('.cp-body .msg.user a.msg-file')].map(function(x){ return { t:x.innerText.replace(/\\s+/g,' ').trim(), h:x.getAttribute('href') }; });
    return JSON.stringify({
      panelText: panelText.slice(0,300),
      count: count,
      userText: userText.slice(0,200),
      links: links,
    });
  })()`))
  console.log('\n--- 相位B 产物落位实测 ---')
  console.log(JSON.stringify(b, null, 1))
  ok('B1 用户上传文件 **不在** 侧栏产物区', b.panelText.indexOf(UP_NAME) < 0, 'panelText=' + b.panelText)
  ok('B2 用户上传文件 **在** 沟通面板（气泡）里', b.userText.indexOf(UP_NAME) >= 0, 'userText=' + b.userText)
  const upLink = (b.links || []).find(x => x.t.indexOf(UP_NAME) >= 0) || null
  ok('B3 气泡内有可下载文件卡', !!upLink, JSON.stringify(b.links))
  ok('B4 该下载卡走 chat-attachment 按 file_id 取数', !!(upLink && /\/api\/chat-attachment\/download\/FID_UP_9/.test(upLink.h)), upLink ? 'href=' + upLink.h : 'no link')
  ok('B5 回归：副驾产出文件仍在侧栏', b.panelText.indexOf(ART_NAME) >= 0, 'panelText=' + b.panelText)
  ok('B6 回归：经营卡仍在侧栏', b.panelText.indexOf(CARD_TITLE) >= 0, 'panelText=' + b.panelText)
  ok('B7 侧栏产物计数 = 卡片1 + 产出文件1 = 2（不含用户附件）', b.count === '2', 'count=' + b.count)

  const errs = (page.errors || []).filter(e => !/401|403|Failed to load resource|net::ERR|Load failed|ERR_/i.test(e))
  ok('P5 全程零 console.error / 零页面异常', errs.length === 0, JSON.stringify(errs).slice(0, 260))
} catch (e) {
  ok('探针执行未抛异常', false, (e && e.message) || String(e))
} finally {
  console.log('\n===== v492 探针 =====  BASE=' + BASE)
  let n = 0
  for (const r of R) {
    console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + (r.pass ? '' : '   ← ' + r.detail))
    n += r.pass ? 1 : 0
  }
  console.log('---- ' + n + '/' + R.length + ' 通过 ----')
  await browser.close()
  process.exit(0)
}
