/* v312 「设置 › 权限」角色级登录端（允许使用电脑端 / 允许使用手机端）· 零写入真机探针
 *
 * 为什么要真机而不是读代码：
 *   本轮改动把一张表装进了**两条轴**（端 = 入口 / 模块 = 能力），并要求
 *   ① 勾选状态读**后端实际生效值**（不是前端按 ROLE_END 重算）
 *   ② 两端都不勾在**前端就被拦住**（后端 400 只是第二道）
 *   ③ 老板/管理员的电脑端**置灰不可关**（防线在 `core.ROLE_END_PROTECTED`，界面要跟着置灰）
 *   这三条都不是"我写了"能证明的，只有渲染出来、点下去、看请求才知道。
 *
 * 为什么可以零写入：
 *   `addInitScript` 在**文档任何脚本之前**把 `/api/**` 桩掉 ⇒
 *   ① 不需要真实账号（更不可能碰 admin/boss）② 一个真实请求都不会发出 ③ 不碰生产库。
 *
 * 反例对照（本项目最硬的验证手法）：
 *   同一份探针跑**新旧两个 dist**，结论必须相反 —— 否则断言不算数。
 *     HG_DIST=/tmp/v312-fe/hergent-cn-v2/dist        HG_TAG=new node v312-role-end-ui-e2e.mjs
 *     HG_DIST=<repo>/hergent-cn-v2/dist-v310         HG_TAG=old node v312-role-end-ui-e2e.mjs
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const DIST = process.env.HG_DIST || '/tmp/v312-fe/hergent-cn-v2/dist'
const TAG = process.env.HG_TAG || 'new'
const PORT = Number(process.env.HG_PORT || 8902)
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8'
}
function serve() {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0])
    if (p === '/' || !path.extname(p)) p = '/index.html'
    const f = path.join(DIST, p)
    if (!f.startsWith(DIST) || !fs.existsSync(f) || !fs.statSync(f).isFile()) {
      res.writeHead(404); res.end('nf'); return
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' })
    fs.createReadStream(f).pipe(res)
  })
  return new Promise(r => srv.listen(PORT, '127.0.0.1', () => r(srv)))
}

/* ---------- 角色顺序 = 后端 `{**_DEFAULT_PERMS, **custom}` 的插入序 ----------
   ⚠️ 探针靠"DOM 列序 == 我给的顺序"定位列，所以这个顺序必须与桩里保持一致。
   `admin` 被 Settings.vue 的 `LOCKED_ROLES` 过滤掉（管理员不可改）。 */
const ROLE_ORDER = ['admin', 'boss', 'accountant', 'sales', 'guide', 'driver', 'staff', 'supervisor']
const VISIBLE_ROLES = ROLE_ORDER.filter(r => r !== 'admin')

const MODULES = [
  { id: 'dashboard', label: '经营看板', mini: false },
  { id: 'data', label: '档案管理', mini: true },       // ← 唯一 mini=true（手机端真的在用）
  { id: 'sales', label: '销售管理', mini: false },
  { id: 'hr', label: '员工管理', mini: false },
  { id: 'payroll', label: '算工资', mini: false },
]

/* ---------- 端配置（桩）：覆盖「实际生效值 / 是否被改过 / 电脑端是否锁死」三种情形 ---------- */
const END = {
  admin: { web: true, mini: true, custom: false, locked: true },  // 后端仍返回（前端 LOCKED_ROLES 会滤掉）
  boss: { web: true, mini: true, custom: false, locked: true },   // 老板：两端 + 电脑端锁死
  accountant: { web: true, mini: false, custom: false, locked: false },
  sales: { web: true, mini: true, custom: true, locked: false },  // ← 被本租户改过
  guide: { web: true, mini: false, custom: false, locked: false },
  driver: { web: true, mini: false, custom: false, locked: false },
  staff: { web: false, mini: true, custom: false, locked: false },
  supervisor: { web: true, mini: true, custom: false, locked: false }
}

function ROLES_PAYLOAD() {
  const roles = {}
  for (const r of ROLE_ORDER) {
    roles[r] = {
      permissions: r === 'admin' ? ['*'] : ['data', 'sales', 'hr'],
      is_custom: false,
      is_default: true,
      end: { web: END[r].web, mini: END[r].mini },
      end_is_custom: END[r].custom,
      end_builtin: { web: true, mini: true },
      default_login_scope: END[r].web && END[r].mini ? 'both' : (END[r].mini ? 'mini' : 'web'),
      end_locked_web: END[r].locked
    }
  }
  return { roles, tenant_id: 1 }
}

function INIT() {
  /* 🔴 必须**序列化后内联**，不能在注入串里引用 Node 侧函数 ——
     注入串是在**浏览器**里求值的，`ROLES_PAYLOAD()` / `MODULES` 到了页面里是
     `ReferenceError`，而它发生在 `window.fetch` 内部 ⇒ 被页面的 `loadPerms` catch 吞掉
     ⇒ 表现是"表格在、列没了 / 整页空白"，看起来像产品坏了（实测踩到一次）。 */
  const ROLES_JSON = JSON.stringify(ROLES_PAYLOAD())
  const MODULES_JSON = JSON.stringify(MODULES)
  return `(() => {
  var ROLES = ${ROLES_JSON};
  var MODULES = ${MODULES_JSON};
  /* 🔴 桩必须**有状态**：保存成功后页面会 loadPerms() 按服务端事实重画，
     若桩永远回同一份初值，改动会被"服务端"抹掉 ⇒ 第二步的判据全部失去前提。
     （这正是真实后端的行为：POST 之后再 GET，读到的就是改后的值。）
     ⚠️ 这段注释在**模板字符串内部**，所以不能出现反引号（会提前截断字符串）。 */
  var STATE = JSON.parse(JSON.stringify(ROLES));
  try {
    localStorage.setItem('hergent_v2_token', 'V312-PROBE-TOKEN-NOT-REAL');
    localStorage.setItem('hergent_v2_tenant', '1');
    localStorage.setItem('hergent_v2_user', JSON.stringify({ id: 1, username: 'probe', display_name: '探针', role: 'boss', roles: ['boss'] }));
  } catch (e) {}
  window.__END_REQ = [];
  function j(o) {
    return new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  function scopeOf(w, m) { return (w && m) ? 'both' : (m ? 'mini' : 'web') }
  var orig = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : ((input && input.url) || '');
    var method = ((init && init.method) || 'GET').toUpperCase();
    if (/\\/api\\/auth\\/permissions/.test(url)) {
      return j({ user: { id: 1, username: 'probe', display_name: '探针', role: 'boss', roles: ['boss'] },
                 permissions: ['*'], tenant_id: 1, plan: 'free',
                 capabilities: { view: true, export: true } });
    }
    if (/\\/api\\/auth\\/me/.test(url)) {
      return j({ user: { id: 1, username: 'probe', display_name: '探针', role: 'boss', roles: ['boss'] } });
    }
    /* ---- 写路径：只记账 + 改内存态，不落库 ---- */
    if (/\\/api\\/role-permissions\\/end/.test(url)) {
      var body = null;
      try { body = init && init.body ? JSON.parse(init.body) : null } catch (e) { body = { __raw: String(init && init.body) } }
      window.__END_REQ.push({ url: url, method: method, body: body });
      var nm = (body && body.role_name) || (url.split('/end/')[1] ? decodeURIComponent(url.split('/end/')[1]) : '');
      if (nm && STATE.roles[nm]) {
        if (method === 'POST') {
          STATE.roles[nm].end = { web: !!body.allow_web, mini: !!body.allow_mini };
          STATE.roles[nm].end_is_custom = true;
          STATE.roles[nm].default_login_scope = scopeOf(!!body.allow_web, !!body.allow_mini);
        } else {
          STATE.roles[nm].end_is_custom = false;
        }
      }
      return j({ success: true });
    }
    if (/\\/api\\/role-permissions/.test(url) && method !== 'GET') {
      window.__END_REQ.push({ url: url, method: method, body: null });
      return j({ success: true });
    }
    /* ---- 读路径 ---- */
    if (/\\/api\\/role-permissions\\/?$/.test(url)) return j(STATE);
    if (/\\/api\\/permissions\\/modules/.test(url)) return j({ modules: MODULES });
    if (/\\/api\\//.test(url)) return j([]);
    return orig(input, init);
  };
})()`
}

/* ---------- 页面内一次性把需要的几何/文案读出来 ---------- */
const READ = `(() => {
  var tbody = document.querySelector('table.tbl tbody');
  var thead = document.querySelector('table.tbl thead');
  if (!tbody || !thead) return JSON.stringify({ ok: false });
  var headCells = Array.from(thead.querySelectorAll('tr')).pop().querySelectorAll('th');
  var heads = Array.from(headCells).map(function (th) { return (th.textContent || '').replace(/\\s+/g, ' ').trim(); });
  var rows = Array.from(tbody.querySelectorAll('tr'));
  function firstCell(tr) { var c = tr.querySelector('td'); return c ? (c.textContent || '').replace(/\\s+/g, ' ').trim() : ''; }
  var endRow = { web: null, mini: null };
  var miniMarks = {};
  var endTags = null;
  var sections = [];
  rows.forEach(function (tr) {
    if (tr.classList.contains('pm-sec')) sections.push(firstCell(tr));
    if (tr.classList.contains('pm-end-sum')) {
      /* ⚠️ 只取 .pm-end-tag 的文本 —— 直接读 td.textContent 会把旁边的「恢复」按钮
         一起读进来（实测踩到：标签变成"网页端 + 小程序恢复"，看起来像文案 bug，其实是探针读错元素）。
         ⚠️ 本注释在模板字符串内部，禁止出现反引号。 */
      endTags = Array.from(tr.querySelectorAll('td')).slice(2).map(function (td) {
        var tag = td.querySelector('.pm-end-tag');
        return (tag ? (tag.textContent || '').trim() : '') + (td.querySelector('button') ? '|恢复' : '');
      });
      return;
    }
    var lb = firstCell(tr);
    if (lb === '允许使用电脑端（网页）' || lb === '允许使用手机端（小程序）') {
      var tds = Array.from(tr.querySelectorAll('td')).slice(2);
      endRow[lb.indexOf('电脑端') >= 0 ? 'web' : 'mini'] = tds.map(function (td) {
        var i = td.querySelector('input[type=checkbox]');
        return i ? { checked: !!i.checked, disabled: !!i.disabled } : null;
      });
      return;
    }
    if (lb) {
      var tds2 = Array.from(tr.querySelectorAll('td'));
      if (tds2.length >= 2) miniMarks[lb] = (tds2[1].textContent || '').trim();
    }
  });
  return JSON.stringify({
    ok: true, heads: heads, sections: sections, endTags: endTags,
    webRow: endRow.web, miniRow: endRow.mini, miniMarks: miniMarks,
    moduleRowCount: Object.keys(miniMarks).length,
    colSubs: Array.from(thead.querySelectorAll('.pm-col-sub')).map(function (e) { return (e.textContent || '').trim(); })
  });
})()`

let pass = 0, fail = 0
const fails = []
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + label + (extra !== undefined ? '  [' + extra + ']' : '')) }
  else { fail++; fails.push(label + '  [' + extra + ']'); console.log('  ❌ ' + label + (extra !== undefined ? '  [' + extra + ']' : '')) }
}

async function main() {
  console.log('=== v312 角色登录端 UI 探针 [' + TAG + '] ===')
  console.log('dist = ' + DIST + '\n')
  const srv = await serve()
  const browser = await launch({ headless: true, port: PORT + 1 })
  const page = await browser.newPage()
  await page.enable()
  const base = 'http://127.0.0.1:' + PORT
  const ident = await page.addInitScript(INIT())

  /* 🔴 hash 路由：深链必须带 `/#/`（否则静默落回默认页）。`?t=` 用来强制重新加载文档。 */
  await page.goto(base + '/?t=' + Date.now() + '#/settings?tab=perm', 3000)
  let d = { ok: false }
  let lastRaw = ''
  for (let i = 0; i < 20; i++) {
    const raw = await page.eval(READ)
    lastRaw = raw
    try { d = JSON.parse(raw) } catch (e) { d = { ok: false } }
    if (d.ok && (d.moduleRowCount || 0) > 0) break
    await sleep(350)
  }
  if (!d.ok) {
    /* 页面没就绪就**干净退出**，不要继续读 undefined 字段（那会抛 TypeError，
       看起来像探针坏了，掩盖"桩没打进页面"这个真原因）。 */
    const why = await page.eval("JSON.stringify({href:location.href,appLen:(document.querySelector('#app')||{innerHTML:''}).innerHTML.length,body:(document.body.innerText||'').replace(/\\s+/g,' ').slice(0,200)})")
    console.log('❌ 页面未渲染出权限表 —— 探针无法继续。')
    console.log('   READ 原始返回 = ' + lastRaw)
    console.log('   页面现状 = ' + why)
    console.log('   console 错误 = ' + JSON.stringify(page.errors.slice(0, 3)))
    await browser.close(); srv.close(); process.exit(2)
  }
  console.log('  表头 = ' + JSON.stringify(d.heads))
  console.log('  分节 = ' + JSON.stringify(d.sections))
  console.log('  模块行数 = ' + d.moduleRowCount + '  手机端标记 = ' + JSON.stringify(d.miniMarks))
  console.log('  端行 = 电脑端 ' + JSON.stringify(d.webRow) + ' / 手机端 ' + JSON.stringify(d.miniRow))
  console.log('  默认端标签 = ' + JSON.stringify(d.endTags))
  console.log('')

  const N = VISIBLE_ROLES.length
  const salesIdx = VISIBLE_ROLES.indexOf('sales')
  const bossIdx = VISIBLE_ROLES.indexOf('boss')

  if (TAG === 'new') {
    ok('页面渲染成功（模块行 > 0，说明不是把整页打坏了）', d.ok && d.moduleRowCount > 0, d.moduleRowCount + ' 行')
    ok('表头第一列是「权限项」', (d.heads || [])[0] === '权限项', (d.heads || [])[0])
    ok('表头新增只读列「手机端」', (d.heads || []).includes('手机端'), JSON.stringify(d.heads))
    ok('列数 = 2 + 角色数（' + N + '）', (d.heads || []).length === 2 + N, (d.heads || []).length + ' 列')
    ok('① 登录端 分节存在', (d.sections || []).some(s => /①\s*登录端/.test(s)), JSON.stringify(d.sections))
    ok('② 功能模块 分节存在', (d.sections || []).some(s => /②\s*功能模块/.test(s)), JSON.stringify(d.sections))
    ok('「允许使用电脑端（网页）」行存在', Array.isArray(d.webRow) && d.webRow.length === N, (d.webRow || []).length + ' 格')
    ok('「允许使用手机端（小程序）」行存在', Array.isArray(d.miniRow) && d.miniRow.length === N, (d.miniRow || []).length + ' 格')
    /* 勾选状态 = 后端实际生效值（不是前端按内置重算） */
    ok('业务员的手机端勾选 = 后端给的 true', !!(d.miniRow && d.miniRow[salesIdx] && d.miniRow[salesIdx].checked),
       JSON.stringify(d.miniRow && d.miniRow[salesIdx]))
    ok('导购的手机端勾选 = 后端给的 false（不是按内置一把勾上）',
       !!(d.miniRow && d.miniRow[VISIBLE_ROLES.indexOf('guide')] && !d.miniRow[VISIBLE_ROLES.indexOf('guide')].checked),
       JSON.stringify(d.miniRow && d.miniRow[VISIBLE_ROLES.indexOf('guide')]))
    ok('老板的电脑端勾选框被置灰（防自锁：ROLE_END_PROTECTED）',
       !!(d.webRow && d.webRow[bossIdx] && d.webRow[bossIdx].disabled), JSON.stringify(d.webRow && d.webRow[bossIdx]))
    ok('业务员的电脑端勾选框**不**置灰', !!(d.webRow && d.webRow[salesIdx] && !d.webRow[salesIdx].disabled),
       JSON.stringify(d.webRow && d.webRow[salesIdx]))
    ok('被改过端的角色列头标出「登录端已改」', (d.colSubs || []).filter(s => s === '登录端已改').length === 1,
       JSON.stringify(d.colSubs))
    /* 只读「手机端」标记：判据来自后端 MINI_MODULES */
    ok('「档案管理」行标「有」（后端 MINI_MODULES = data）', d.miniMarks['档案管理'] === '有', d.miniMarks['档案管理'])
    ok('「销售管理」行标「—」（不在 MINI_MODULES 里）', d.miniMarks['销售管理'] === '—', d.miniMarks['销售管理'])
    ok('默认端标签随每个角色各自的 end 合成（老板=两端 / 导购=仅网页端 / 员工=仅小程序）',
       (d.endTags || [])[bossIdx] === '网页端 + 小程序' && (d.endTags || [])[VISIBLE_ROLES.indexOf('guide')] === '仅网页端'
       && (d.endTags || [])[VISIBLE_ROLES.indexOf('staff')] === '仅小程序',
       JSON.stringify(d.endTags))
    ok('被改过的角色多一个「恢复」按钮（其余没有）',
       (d.endTags || [])[salesIdx] === '网页端 + 小程序|恢复'
       && (d.endTags || []).filter(t => /\|恢复$/.test(t)).length === 1,
       (d.endTags || [])[salesIdx])

    /* ===== 交互 1：取消业务员的手机端 + 保存 ⇒ 必须**只发一个** end 请求 ===== */
    console.log('\n---- 交互 1：取消「业务员」的手机端 后点「保存权限」----')
    await page.eval(`(() => {
      var tbody = document.querySelector('table.tbl tbody');
      var rows = Array.from(tbody.querySelectorAll('tr'));
      var tr = rows.find(function (t) { var c = t.querySelector('td'); return c && (c.textContent || '').indexOf('允许使用手机端') >= 0; });
      var tds = Array.from(tr.querySelectorAll('td')).slice(2);
      tds[${salesIdx}].querySelector('input[type=checkbox]').click();
    })()`)
    await sleep(300)
    const beforeSave = JSON.parse(await page.eval('JSON.stringify(window.__END_REQ)'))
    ok('只勾选、未点保存 ⇒ **一个请求都不发**（避免每次点击都写库）', beforeSave.length === 0, beforeSave.length + ' 个')
    await page.eval(`(() => {
      var b = Array.from(document.querySelectorAll('button')).find(function (x) { return (x.textContent || '').trim() === '保存权限'; });
      if (b) b.click();
    })()`)
    await sleep(1200)
    const reqs1 = JSON.parse(await page.eval('JSON.stringify(window.__END_REQ)'))
    const modPosts = reqs1.filter(r => r.method === 'POST' && /\/api\/role-permissions$/.test(r.url))
    const endPost = reqs1.filter(r => r.method === 'POST' && /role-permissions\/end$/.test(r.url))
    console.log('  模块 POST ' + modPosts.length + ' 个 / 端 POST ' + endPost.length + ' 个')
    console.log('  端请求 = ' + JSON.stringify(endPost))
    ok('发出 1 个 POST /api/role-permissions/end', endPost.length === 1, endPost.length + ' 个')
    ok('**只**提交真改过的那个角色（没有给 7 个角色各写一行）', endPost.length === 1, endPost.length + ' 个')
    ok('body 带 role_name=sales', !!(endPost[0] && endPost[0].body && endPost[0].body.role_name === 'sales'),
       JSON.stringify(endPost[0] && endPost[0].body))
    ok('body 的 allow_web=true / allow_mini=false（只改的那一轴与另一轴的实际值）',
       !!(endPost[0] && endPost[0].body && endPost[0].body.allow_mini === false && endPost[0].body.allow_web === true),
       JSON.stringify(endPost[0] && endPost[0].body))
    const afterSave = JSON.parse(await page.eval(READ))
    ok('保存后按**服务端事实**重画：业务员手机端已取消勾选',
       !!(afterSave.miniRow && afterSave.miniRow[salesIdx] && !afterSave.miniRow[salesIdx].checked),
       JSON.stringify(afterSave.miniRow && afterSave.miniRow[salesIdx]))

    /* ===== 交互 2：两端都取消 ⇒ 前端必须拦住（第二个勾恢复、且不再发请求） ===== */
    console.log('\n---- 交互 2：把「业务员」两端都取消（前端侧把关）----')
    await page.eval(`(() => {
      var tbody = document.querySelector('table.tbl tbody');
      var rows = Array.from(tbody.querySelectorAll('tr'));
      var tr = rows.find(function (t) { var c = t.querySelector('td'); return c && (c.textContent || '').indexOf('允许使用电脑端') >= 0; });
      var tds = Array.from(tr.querySelectorAll('td')).slice(2);
      tds[${salesIdx}].querySelector('input[type=checkbox]').click();
    })()`)
    await sleep(300)
    await page.eval(`(() => {
      var b = Array.from(document.querySelectorAll('button')).find(function (x) { return (x.textContent || '').trim() === '保存权限'; });
      if (b) b.click();
    })()`)
    await sleep(1200)
    const reqs2 = JSON.parse(await page.eval('JSON.stringify(window.__END_REQ)'))
    const endPost2 = reqs2.filter(r => r.method === 'POST' && /role-permissions\/end$/.test(r.url))
    const after2 = JSON.parse(await page.eval(READ))
    console.log('  端 POST 累计 = ' + endPost2.length + '（交互 1 之后应保持不变）')
    ok('两端都不勾时**没有**为业务员再发端请求（前端就拦住了，后端 400 只是第二道）',
       endPost2.length === endPost.length, endPost2.length + ' vs ' + endPost.length)
    ok('被拒的那一轴恢复成勾选（界面与服务端事实一致，不是"看着取消了其实没变"）',
       !!(after2.webRow && after2.webRow[salesIdx] && after2.webRow[salesIdx].checked),
       JSON.stringify(after2.webRow && after2.webRow[salesIdx]))
    ok('全程无 console 错误', page.errors.length === 0, page.errors.slice(0, 2).join(' | '))
  } else {
    /* ===== 反例：旧产物必须**没有**这套 UI（否则本探针没有判别力）===== */
    ok('旧产物仍正常渲染（模块行 > 0）—— 先排除"页面坏了"这种伪证', d.ok && d.moduleRowCount > 0, d.moduleRowCount + ' 行')
    ok('旧产物表头**没有**只读列「手机端」', !(d.heads || []).includes('手机端'), JSON.stringify(d.heads))
    ok('旧产物表头第一列**不是**「权限项」', (d.heads || [])[0] !== '权限项', (d.heads || [])[0])
    ok('旧产物**没有**「允许使用电脑端（网页）」行', !Array.isArray(d.webRow), JSON.stringify(d.webRow))
    ok('旧产物**没有**「允许使用手机端（小程序）」行', !Array.isArray(d.miniRow), JSON.stringify(d.miniRow))
    ok('旧产物**没有**① 登录端分节', !(d.sections || []).some(s => /①\s*登录端/.test(s)), JSON.stringify(d.sections))
    ok('旧产物无「登录端已改」标记', (d.colSubs || []).filter(s => s === '登录端已改').length === 0, JSON.stringify(d.colSubs))
  }

  await page.removeInitScript(ident)
  await page.eval('1')
  await browser.close()
  srv.close()
  console.log('')
  console.log('=== [' + TAG + '] PASS=' + pass + ' FAIL=' + fail + ' ===')
  if (fails.length) fails.forEach(f => console.log('  · ' + f))
  process.exit(fail ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(2) })
