/**
 * v488 真机 DOM 探针（只读；不写生产库、不改任何服务端状态）
 *
 * 目标：验证「进入 AI 副驾自动恢复当前角色最近一次会话」这条新行为。
 *   需求① 按角色维度 + 最后消息时间取最新   → 相位 1：注入 A(旧)/B(新)，进入即恢复 B
 *   需求② 恢复完整历史 + 定到上次浏览位置 + 加载态不闪空白 → 相位 1：遮罩先显后隐 + 2 条消息 + 滚到底
 *   需求③ 无历史 ⇒ 回退新建              → 相位 3：注入 []，进入是空白新对话（遮罩正常消失）
 *   需求④ 「＋ 新对话」入口保留            → 相位 1 后：历史面板里按钮存在
 *   需求⑤ 新建/切换后最近会话判定实时更新    → 相位 2：切到 A 后重载 ⇒ 恢复 A（而非 B）
 *
 * 关键实现（为什么这么写）：
 *   · fetch 桩 + token 用 **永驻 init 脚本**（boot/挂载期就发请求，导航后再打桩来不及）。
 *   · 会话数据用 **按相位增删的 seed init 脚本** 在 **document-start** 写入 localStorage：
 *     每次导航旧文档 pagehide 会把内存里的会话落盘，若用「导航后再 eval 写」会被这回落盘
 *     覆盖（实测相位 3 因此误恢复到上一条会话）。document-start 写入发生在任何 app 脚本之前，
 *     落盘的旧值当场被覆盖 ⇒ 相位完全隔离。
 *   · 桩**只**拦 /api/ai/roles、/api/ai/sessions*（返回扁平对象即可，api() 对无 .data 的整包原样返回），
 *     其余请求透传。并给 ai 桩加 ~280ms 延迟 —— 加载态本就是为「有网络时延的异步窗口」而设，
 *     零延迟下遮罩一闪而过（<1 帧）根本无法观测；这是还原真机时序，不是造数据。
 *
 * 用法：
 *   V488_BASE=http://127.0.0.1:8137 node v488-probe.mjs   # 本地静态产物
 *   HG_TOKEN=xxx node v488-probe.mjs                        # 打生产 hergent.cn（需真 token）
 * ⚠️ 本机沙箱会挡 Chrome 访问 loopback ⇒ 本地跑需在非沙箱环境下执行（否则 chrome-error）。
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'

const BASE = process.env.V488_BASE || 'https://hergent.cn'
const TOKEN = process.env.HG_TOKEN || 'local-dummy-token'
const TENANT = process.env.HG_TENANT || '1'
const IS_LOCAL = /127\.0\.0\.1|localhost/.test(BASE)
const LAT = Number(process.env.V488_LAT || 280)   // 桩延迟（ms）

const SESS_KEY = 'hergent_chat_sessions_v1'
const now = Date.now()
const sessA = {
  id: '_v488_A_', title: '会话甲', roleId: 'copilot', updated_at: now - 180000,
  messages: [
    { role: 'user', content: '会话甲的内容：分析上月返利政策' },
    { role: 'assistant', content: '甲的回复内容' },
  ],
}
const sessB = {
  id: '_v488_B_', title: '会话乙', roleId: 'copilot', updated_at: now - 60000,
  messages: [
    { role: 'user', content: '会话乙的内容：看看本月库存效期' },
    { role: 'assistant', content: '乙的回复内容' },
  ],
}

const R = []
const ok = (name, cond, detail = '') => R.push({ name, pass: !!cond, detail: String(detail) })

// —— 永驻 init 脚本：token + fetch 桩 + 遮罩/消息出现探针（不写会话）——
const INIT_STUB = `
(function(){
  try {
    localStorage.setItem('hergent_v2_token', ${JSON.stringify(TOKEN)});
    localStorage.setItem('hergent_v2_tenant', ${JSON.stringify(TENANT)});
  } catch(e){}
  window.__v488 = { sawRestoring:false, restoringPos:'', sawMsgs:false };
  try {
    const mo = new MutationObserver(function(){
      const el = document.querySelector('.cp-restoring');
      if (el) {
        window.__v488.sawRestoring = true;
        try { window.__v488.restoringPos = getComputedStyle(el).position; } catch(e){}
      }
      if (document.querySelector('.cp-body .msg')) window.__v488.sawMsgs = true;
    });
    mo.observe(document.documentElement, { childList:true, subtree:true, attributes:true });
  } catch(e){}
  const _f = window.fetch.bind(window);
  const LAT = ${LAT};
  const J = (obj) => new Promise(res => setTimeout(function(){
    res(new Response(JSON.stringify(obj), { status:200, headers:{ 'Content-Type':'application/json' } }));
  }, LAT));
  window.fetch = function(u, o){
    const url = (typeof u === 'string') ? u : ((u && u.url) || '');
    const method = ((o && o.method) || 'GET').toUpperCase();
    if (url.indexOf('/api/ai/roles') === 0) {
      return J({ roles: [ { role_id:'copilot', name:'经营副驾', is_active:1, system_prompt:'', guard:'' } ] });
    }
    if (/\\/api\\/ai\\/sessions\\/[^/]+/.test(url)) {
      const id = url.split('/api/ai/sessions/')[1].split('?')[0];
      let msgs = [];
      try { const arr = JSON.parse(localStorage.getItem(${JSON.stringify(SESS_KEY)})||'[]'); const s = arr.find(x=>x.id===id); if (s) msgs = s.messages||[]; } catch(e){}
      return J({ session: { messages: msgs } });
    }
    if (/\\/api\\/ai\\/sessions(\\?|$)/.test(url)) {
      if (method === 'GET') return J({ sessions: [] });
      return J({ ok:true });
    }
    return _f(u, o);
  };
})();
`

const browser = await launch({ extraArgs: IS_LOCAL ? ['--no-proxy-server'] : [] })
try {
  const page = await browser.newPage()
  await page.enable()
  await page.addInitScript(INIT_STUB)

  const gotoWorkbench = async () => {
    await page.goto(BASE + '/?__r=' + Date.now() + '#/workbench', 2600)
  }
  let seedId = ''
  const clearSeed = async () => { if (seedId) { await page.removeInitScript(seedId); seedId = '' } }
  const seed = async (arr) => {
    await clearSeed()
    seedId = await page.addInitScript(
      `(function(){ try { localStorage.setItem(${JSON.stringify(SESS_KEY)}, ${JSON.stringify(JSON.stringify(arr))}); } catch(e){} })();`
    )
  }
  // 点开副驾 + 每 25ms 采样，返回时间线
  const openAndRecord = async (ms = 2200) => JSON.parse(await page.eval(`(async () => {
    const t0 = performance.now();
    const rec = [];
    const b = document.querySelector('.tb-copilot');
    const clicked = !!b; if (b) b.click();
    await new Promise(res => {
      const loop = () => {
        const el = document.querySelector('.cp-restoring');
        rec.push({ t: Math.round(performance.now()-t0),
          restoring: !!el,
          pos: el ? getComputedStyle(el).position : '',
          msgs: document.querySelectorAll('.cp-body .msg').length });
        if (performance.now()-t0 > ${ms}) return res();
        setTimeout(loop, 25);
      };
      loop();
    });
    return JSON.stringify({ clicked, rec });
  })()`))
  const bodyText = async () => await page.eval(`[...document.querySelectorAll('.cp-body .msg')].map(m=>m.innerText).join(' | ')`)
  const flags = async () => JSON.parse(await page.eval(`JSON.stringify(window.__v488||{})`))

  // ============ 相位 1：有历史（A 旧 / B 新）→ 自动恢复 B ============
  await seed([sessA, sessB])
  await gotoWorkbench()

  const url1 = await page.eval('location.href')
  ok('相位1 P0 未跳登录页', !/#\/login/.test(url1), url1)

  const r1 = await openAndRecord()
  ok('相位1 P1 副驾入口可点击', r1.clicked)
  const everRestoring = r1.rec.some(x => x.restoring)
  ok('① 恢复期间出现加载遮罩（不闪空白）', everRestoring, JSON.stringify(r1.rec.slice(0, 6)))
  const anyPos = (r1.rec.find(x => x.pos) || {}).pos
  ok('① 遮罩为覆盖层（position:absolute 压在对话流上）', anyPos === 'absolute', 'pos=' + anyPos)
  const endRestoring = r1.rec[r1.rec.length - 1].restoring
  ok('① 恢复完成后遮罩消失', !endRestoring, 'endRestoring=' + endRestoring)
  const t1 = await bodyText()
  ok('① 自动恢复到「最近」会话乙（非空白新对话）', /会话乙/.test(t1), t1.slice(0, 120))
  ok('② 恢复完整历史（用户+助手两条）', r1.rec[r1.rec.length - 1].msgs >= 2, 'msgs=' + r1.rec[r1.rec.length - 1].msgs)
  const sc = JSON.parse(await page.eval(`(() => { const b=document.querySelector('.cp-body'); return b ? JSON.stringify({top:b.scrollTop,h:b.scrollHeight,c:b.clientHeight}) : '{}'; })()`))
  ok('② 定位到上次浏览位置（滚到底部）', typeof sc.top === 'number' && (sc.h - sc.c - sc.top) < 8, JSON.stringify(sc))

  // 需求④：历史面板里「＋ 新对话」入口存在
  await page.eval(`(() => { const b=[...document.querySelectorAll('.cp-icon-btn')].find(x=>/历史/.test(x.getAttribute('title')||x.innerText||'')); if(b) b.click(); })()`)
  await new Promise(r => setTimeout(r, 500))
  const hasNewBtn = await page.eval(`[...document.querySelectorAll('.cp-hist-hd button')].some(b=>/新对话/.test(b.innerText))`)
  ok('④ 「＋ 新对话」入口保留', hasNewBtn)
  // 点开历史面板里的「会话甲」（触发 openChatSession ⇒ bump 甲 updated_at）
  const clickedA = await page.eval(`(() => { const items=[...document.querySelectorAll('.cp-hist-item')]; const it=items.find(x=>/会话甲/.test(x.innerText)); if(it){it.click();return true;} return false; })()`)
  ok('相位1 可切到会话甲（供相位2复用）', clickedA)
  await new Promise(r => setTimeout(r, 500))

  // ============ 相位 2：切换后实时更新（切到 A 再重载 ⇒ 应恢复 A 而非 B）============
  await clearSeed()                     // 不再注入：读上一步落盘的 localStorage（甲已 bump 为最新）
  await gotoWorkbench()
  const r2 = await openAndRecord()
  const t2 = await bodyText()
  ok('⑤ 切换到「会话甲」后重载 ⇒ 恢复甲（最近判定实时更新）', /会话甲/.test(t2) && !/会话乙/.test(t2), t2.slice(0, 120))
  ok('⑤ 恢复期间仍有加载遮罩', r2.rec.some(x => x.restoring))

  // ============ 相位 3：无历史 ⇒ 回退新建 ============
  await seed([])                        // document-start 注入空列表，覆盖上一次落盘
  await gotoWorkbench()
  const r3 = await openAndRecord()
  const n3 = r3.rec[r3.rec.length - 1].msgs
  const welcome = await page.eval(`!!document.querySelector('.cp-welcome')`)
  ok('③ 无历史 ⇒ 回退空白新对话（0 消息 + 欢迎页）', n3 === 0 && welcome, 'msgs=' + n3 + ' welcome=' + welcome)
  const sawR3 = r3.rec.some(x => x.restoring && x.pos === 'absolute')
  ok('③ 回退场景遮罩先显后隐（无卡死）', sawR3 && !r3.rec[r3.rec.length - 1].restoring, JSON.stringify({sawR3, end:r3.rec[r3.rec.length-1].restoring}))

  // ============ 需求④ 补充：点「＋ 新对话」应清空消息 ============
  await page.eval(`(() => { const b=[...document.querySelectorAll('.cp-icon-btn')].find(x=>/历史/.test(x.getAttribute('title')||x.innerText||'')); if(b) b.click(); })()`)
  await new Promise(r => setTimeout(r, 400))
  const cleared = await page.eval(`(async () => {
    const b=[...document.querySelectorAll('.cp-hist-hd button')].find(x=>/新对话/.test(x.innerText));
    if(!b) return 'no-btn'; b.click();
    await new Promise(r=>setTimeout(r,300));
    return document.querySelectorAll('.cp-body .msg').length;
  })()`)
  ok('④ 点「＋ 新对话」⇒ 清空为空白新对话', cleared === 0, 'msgs=' + cleared)

  // ============ P5 零 console 错误 ============
  const errs = (page.errors || []).filter(e => !/401|403|Failed to load resource|net::ERR|Load failed|ERR_/i.test(e))
  ok('P5 全程零 console.error / 零页面异常', errs.length === 0, JSON.stringify(errs).slice(0, 300))
} catch (e) {
  ok('探针执行未抛异常', false, (e && e.message) || String(e))
} finally {
  console.log('\n===== v488 真机 DOM 探针结果 =====  BASE=' + BASE + '  LAT=' + LAT + 'ms')
  let n = 0
  for (const r of R) {
    console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + (r.pass ? '' : '   ← ' + r.detail))
    n += r.pass ? 1 : 0
  }
  console.log('---- ' + n + '/' + R.length + ' 通过 ----')
  await browser.close()
  process.exit(n === R.length ? 0 : 2)
}
