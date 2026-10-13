/**
 * v489 探针（只读；不写生产库、不改任何服务端状态）
 * AI 副驾「产物落位」—— 回复区 vs 侧栏产物区
 *
 * 背景（本仓现状）：
 *   副驾有两类可见产物：(a) 经营卡 —— assistant 消息的 `m.card`（```cards``` 围栏抽出）
 *                        (b) 产出文件 —— assistant 正文里的 `MEDIA:<绝对路径>` 标记
 *   侧栏 `.cp-artifacts` 的 `artifacts` 计算属性原先只收 `m.card` + 用户上传附件 `m.files`，
 *   ⇒ 产出文件只落在回复气泡里，侧栏产物区永远看不到（= 用户报的「产物渲染位置错误」）。
 *
 * 判据（全部只看真实 DOM）：
 *   相位 1（xlsx 产出文件，不可预览）
 *     A 侧栏产物栏已展开      B 经营卡进入侧栏      C 产出文件进入侧栏
 *     D 回复区保留入口（双落位，与经营卡一致）
 *     E 侧栏产物计数 = 卡片1 + 产出文件1 = 2
 *     F 侧栏产出项下载链接指向 /api/ai/media?path=   G 渲染在「本次产物」容器内
 *   相位 2（png 产出文件，可预览）
 *     H 侧栏内联预览 <img> 实际渲染出 blob: 图（说明预览链路（鉴权 blob）通）
 *
 * 用法：
 *   V489_BASE=http://127.0.0.1:8151 node v489-artifact-probe.mjs   # 修后产物
 *   V489_BASE=http://127.0.0.1:8139 node v489-artifact-probe.mjs   # 修前基线（C/E/F/G/H 应 FAIL）
 * ⚠️ 本机沙箱挡 Chrome 访问 loopback ⇒ 本地跑须在非沙箱环境执行。
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'

const BASE = process.env.V489_BASE || 'https://hergent.cn'
const TOKEN = process.env.HG_TOKEN || 'local-dummy-token'
const TENANT = process.env.HG_TENANT || '1'
const IS_LOCAL = /127\.0\.0\.1|localhost/.test(BASE)
const LAT = Number(process.env.V489_LAT || 200)

const SESS_KEY = 'hergent_chat_sessions_v1'
const now = Date.now()
const FILE_NAME = 'rebate-2026-10.xlsx'
const IMG_NAME = 'margin-chart.png'
const CARD_TITLE = '本月返利达成'

const mkSess = (file) => ({
  id: '_v489_ART_', title: '产物落位', roleId: 'copilot', updated_at: now - 1000,
  messages: [
    { role: 'user', content: '给我出一份本月返利对账报表' },
    { role: 'assistant', content: '已生成，请查收。\nMEDIA:/opt/hermes-tenants/1/output/' + file },
    {
      role: 'assistant',
      content: '这是本月经营卡：',
      card: { type: 'kpi', title: CARD_TITLE, summary: '返利达成 92%', metrics: [{ label: '预计返利', value: '12.3 万', tone: 'ok' }] },
    },
  ],
})

const R = []
const ok = (name, cond, detail = '') => R.push({ name, pass: !!cond, detail: String(detail) })

// 永驻 init 脚本：token + fetch 桩（ai 接口全部本地化，含 /api/ai/media 返回真 PNG 字节）
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
    await sleep(1600)
    await page.eval(`(() => { const b=document.querySelector('.cp-art-toggle'); if(b && !document.querySelector('.cp-artifacts.show-art')) b.click(); })()`)
    await sleep(500)
  }
  const goto = async () => { await page.goto(BASE + '/?__r=' + Date.now() + '#/workbench', 2600) }

  // ================= 相位 1：xlsx 产出文件（不可预览 → 下载卡） =================
  await seed([mkSess(FILE_NAME)])
  await goto()
  const url1 = await page.eval('location.href')
  ok('P0 未跳登录页', !/#\/login/.test(url1), url1)

  await openCopilotAndPanel()
  const p1 = JSON.parse(await page.eval(`(() => {
    const panel = document.querySelector('.cp-artifacts');
    const items = panel ? [...panel.querySelectorAll('.cp-art-item')] : [];
    const count = (panel && panel.querySelector('.cp-art-count')) ? panel.querySelector('.cp-art-count').innerText.trim() : '';
    const panelText = panel ? panel.innerText : '';
    const inlineFiles = [...document.querySelectorAll('.cp-body .msg-file')].map(a => a.innerText.replace(/\\s+/g,' ').trim());
    const prodLink = items.map(x => x.querySelector('a.cp-art-file, a.cp-art-dl-row')).filter(Boolean)
      .map(a => a.getAttribute('href')).find(h => h && h.indexOf('media') >= 0 && h.indexOf('rebate') >= 0) || '';
    const inArtBody = !!(panel && panel.querySelector('.cp-art-body a.cp-art-file'));
    return JSON.stringify({
      panelOpen: !!document.querySelector('.cp-artifacts.show-art'),
      itemCount: items.length,
      items: items.map(x => x.innerText.replace(/\\s+/g,' ').trim().slice(0,70)),
      count,
      panelText: panelText.replace(/\\s+/g,' ').trim().slice(0,280),
      inlineFiles, prodLink, inArtBody,
    });
  })()`))

  console.log('\n--- 相位1 DOM 实测 ---')
  console.log(JSON.stringify(p1, null, 1))

  ok('A 侧栏产物栏已展开', p1.panelOpen)
  ok('B 经营卡进入侧栏', p1.panelText.indexOf(CARD_TITLE) >= 0, 'panelText=' + p1.panelText)
  ok('C 副驾产出文件进入侧栏', p1.panelText.indexOf(FILE_NAME) >= 0, 'panelText=' + p1.panelText)
  ok('D 回复区保留入口（气泡内文件卡，与经营卡一致的「双落位」）', p1.inlineFiles.some(t => t.indexOf(FILE_NAME) >= 0), JSON.stringify(p1.inlineFiles))
  ok('E 侧栏产物计数 = 卡片1 + 产出文件1 = 2', p1.count === '2', 'count=' + p1.count + ' items=' + p1.itemCount)
  ok('F 侧栏产出项下载链接指向按路径取数的鉴权端点 /api/ai/media', /\/api\/ai\/media\?path=/.test(p1.prodLink), 'href=' + p1.prodLink)
  ok('G 产出项渲染在「本次产物」分页容器内（.cp-art-body）', p1.inArtBody)

  // ================= 相位 2：png 产出文件（可预览 → 侧栏内联图） =================
  await seed([mkSess(IMG_NAME)])
  await goto()
  await openCopilotAndPanel()
  await sleep(900)   // 等鉴权 blob 取回 + 响应式重渲染
  const p2 = JSON.parse(await page.eval(`(() => {
    const panel = document.querySelector('.cp-artifacts');
    const img = panel ? panel.querySelector('.cp-art-prev img.cp-art-img') : null;
    const frame = panel ? panel.querySelector('.cp-art-prev iframe.cp-art-frame') : null;
    return JSON.stringify({
      hasPrev: !!(panel && panel.querySelector('.cp-art-prev')),
      imgSrc: img ? String(img.getAttribute('src')||'').slice(0,24) : '',
      hasFrame: !!frame,
      panelText: panel ? panel.innerText.replace(/\\s+/g,' ').trim().slice(0,220) : '',
    });
  })()`))
  console.log('\n--- 相位2 DOM 实测 ---')
  console.log(JSON.stringify(p2, null, 1))
  ok('H png 产出文件在侧栏内联预览（鉴权 blob → <img>）', /^blob:/.test(p2.imgSrc), 'imgSrc=' + p2.imgSrc + ' panelText=' + p2.panelText)

  // ================= 相位 3：回归守卫 —— 用户上传附件（m.files）仍要进侧栏 =================
  const UPLOAD = 'uploaded-sales.xlsx'
  const sessUp = {
    id: '_v489_ART_', title: '附件', roleId: 'copilot', updated_at: now - 1000,
    messages: [
      { role: 'user', content: '看看这份表', files: [{ file_id: 'FID_UP_1', file_name: UPLOAD, file_type: 'xlsx', rows: 12 }] },
      { role: 'assistant', content: '好的，已分析。' },
    ],
  }
  await seed([sessUp])
  await goto()
  await openCopilotAndPanel()
  const p3 = JSON.parse(await page.eval(`(() => {
    const panel = document.querySelector('.cp-artifacts');
    const link = panel ? panel.querySelector('.cp-art-body a.cp-art-file') : null;
    return JSON.stringify({
      panelText: panel ? panel.innerText.replace(/\\s+/g,' ').trim().slice(0,220) : '',
      href: link ? String(link.getAttribute('href')||'') : '',
    });
  })()`))
  console.log('\n--- 相位3 DOM 实测 ---')
  console.log(JSON.stringify(p3, null, 1))
  ok('I 回归：用户上传附件仍在侧栏（v-else-if 分支未被新分支顶掉）', p3.panelText.indexOf(UPLOAD) >= 0, 'panelText=' + p3.panelText)
  ok('J 回归：附件项仍走 chat-attachment 按 file_id 取数', /\/api\/chat-attachment\/download\/FID_UP_1/.test(p3.href), 'href=' + p3.href)

  const errs = (page.errors || []).filter(e => !/401|403|Failed to load resource|net::ERR|Load failed|ERR_/i.test(e))
  ok('P5 全程零 console.error / 零页面异常', errs.length === 0, JSON.stringify(errs).slice(0, 260))
} catch (e) {
  ok('探针执行未抛异常', false, (e && e.message) || String(e))
} finally {
  console.log('\n===== v489 产物落位探针 =====  BASE=' + BASE)
  let n = 0
  for (const r of R) {
    console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + (r.pass ? '' : '   ← ' + r.detail))
    n += r.pass ? 1 : 0
  }
  console.log('---- ' + n + '/' + R.length + ' 通过 ----')
  await browser.close()
  process.exit(0)
}
