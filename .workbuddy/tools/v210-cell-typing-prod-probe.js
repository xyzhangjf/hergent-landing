// v210 真机验收：单元格两态模型 —— ① 单击即全选内容 ② 方向键跨格跳转（生产 hergent.cn）
//
// 用户诉求（原话）：
//   ①「单元格应支持单击选中所有内容，便于用户快速修改已有内容」
//   ②「要支持键盘方向键进行不同单元格之间的跳转」
//
// 🔴 本探针**绝不点「保存」**：saveEdits() 没有「无改动就短路」分支，点下去 = 真实生产写入 +
//    一条「实际什么都没改」的 save_changes 假记录。本次连「改单 ⇄ 取消」都不需要点取消 ——
//    直接在编辑态里做交互取证，最后**不保存**直接关浏览器（草稿只在临时 profile 的 localStorage，
//    随浏览器进程销毁）。
//    ⇒ 另加 S6 段：**请求日志取证**，断言全程没有打到任何写接口。这是本探针「零写入」的硬证据，
//      比「我没点保存」这句话可靠得多。
//
// 用法：
//   cd .workbuddy/tools && NODE_PATH=<ws>/node_modules node v210-cell-typing-prod-probe.js
//   环境变量：
//     HG_TOKEN / HG_TENANT  —— 走**隔离沙箱租户**（sandbox_tenant.py up 产出的 token）。
//                              这是推荐姿势：沙箱里可以自由造期次/报单，且对生产零影响。
//     HG_SHOT_DIR           —— 覆盖截图目录
//
// 🔴 **为什么要沙箱而不是「演示」租户**（2026-09-20 实测踩到）：
//    演示租户当时**没有进行中的期次**（页头显示「当前没有进行中的期次」），编辑网格无从渲染；
//    而期次是**业务数据的载体**，靠「新建期次」也造不出带报单的网格 ⇒ 演示租户根本不是可用的取景面。
//    沙箱 = 从真实租户克隆（真实商品档案 + 真实报单配置 + 可直接插一个 open 期次），
//    跑完 `down` 销毁并复核 `ZERO_RESIDUE: true`（源库 sha256 前后一致）。
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SHOT_DIR = process.env.HG_SHOT_DIR || '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/单元格两态模型-2026-09-20';
const SANDBOX_TOKEN = process.env.HG_TOKEN || '';
const SANDBOX_TENANT = process.env.HG_TENANT || '';
const SANDBOX_USER = process.env.HG_USER || 'sbx_v210';
const SANDBOX_NAME = process.env.HG_TENANT_NAME || '';
const PERIOD_MARK = process.env.HG_PERIOD_MARK || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const fails = [];
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + label + (extra !== undefined ? '  ' + extra : '')); }
  else { fail++; fails.push(label + (extra !== undefined ? '  ' + extra : '')); console.log('  ❌ ' + label + (extra !== undefined ? '  ' + extra : '')); }
}

/* ---------- 页面内表达式（一律用模板字面量，避免嵌套引号陷阱）---------- */

/* 光标/焦点现状：当前聚焦在哪个格、值是什么、文本是否被全选 */
const JS_FOCUS = `(() => {
  const el = document.activeElement
  const isCell = !!el && el.tagName === 'INPUT' && el.hasAttribute('data-r')
  const r = isCell ? Number(el.getAttribute('data-r')) : null
  const c = isCell ? Number(el.getAttribute('data-c')) : null
  let sel = null
  try { sel = (el && el.selectionStart != null) ? [el.selectionStart, el.selectionEnd] : null } catch (e) { sel = 'throws' }
  const len = el && el.value != null ? String(el.value).length : null
  const selRange = document.querySelectorAll('.range-sel').length
  const selTd = document.querySelector('td.selected')
  return JSON.stringify({
    isCell, r, c, sel, len,
    val: isCell ? String(el.value) : null,
    cls: isCell ? el.className : (el ? el.tagName : null),
    fullSelect: !!(isCell && Array.isArray(sel) && sel[0] === 0 && sel[1] === len && len > 0),
    typed: isCell ? el.getAttribute('type') : null,
    selRange, hasSelectedTd: !!selTd,
    ctlRow: !!document.querySelector('.grid-ctl-row'),
    nEditGroup: document.querySelectorAll('.tb-edit-group').length,
    groupInRow: !!document.querySelector('.grid-ctl-row > .tb-edit-group'),
    saveState: ((document.querySelector('.grid-ctl-row .save-state') || document.querySelector('.save-state') || {}).textContent || ''),
    undoDisabled: (() => { const b = Array.from(document.querySelectorAll('button')).find((x) => /^回退$/.test(String(x.textContent).trim())); return b ? b.disabled : null })(),
    undoFound: !!Array.from(document.querySelectorAll('button')).find((x) => /^回退$/.test(String(x.textContent).trim())),
  })
})()`

/* 找「一个值非空且不是 0」的客户数量格，返回它的坐标与当前值 */
const JS_PICK_QTY = `(() => {
  const ins = Array.from(document.querySelectorAll('.edit-tbl input.cell-qty[data-r]'))
  const hit = ins.find((el) => { const v = String(el.value || '').trim(); return v !== '' && Number(v) > 0 })
  if (!hit) return JSON.stringify({ err: 'no non-empty qty cell', n: ins.length })
  const rc = hit.getBoundingClientRect()
  return JSON.stringify({
    n: ins.length,
    r: Number(hit.getAttribute('data-r')), c: Number(hit.getAttribute('data-c')),
    val: String(hit.value),
    x: Math.round(rc.left + rc.width / 2), y: Math.round(rc.top + rc.height / 2),
  })
})()`

/* 找「一个值非空的商品名称格」（type=text ⇒ selectionStart 可用，能直接验全选） */
const JS_PICK_TEXT = `(() => {
  const ins = Array.from(document.querySelectorAll('.edit-tbl input.cell-name[data-r]'))
  const hit = ins.find((el) => String(el.value || '').trim().length >= 4)
  if (!hit) return JSON.stringify({ err: 'no text cell', n: ins.length })
  const rc = hit.getBoundingClientRect()
  return JSON.stringify({
    n: ins.length,
    r: Number(hit.getAttribute('data-r')), c: Number(hit.getAttribute('data-c')),
    val: String(hit.value), len: String(hit.value).length,
    x: Math.round(rc.left + rc.width / 2), y: Math.round(rc.top + rc.height / 2),
  })
})()`

/* 某坐标格（r,c）的屏幕中心，用于真实鼠标点击。
   ⚠️ 一并做**命中测试**：只算坐标是不够的 —— 坐标看着正常但点下去没聚焦，
   原因可能是「被浮层/冻结列压住」「滚出视口」「scrollIntoView 动画未结束」，
   这三者都表现为「点了没反应」，不测命中就只能靠猜。 */
const jsPointOf = (r, c) => `(() => {
  const el = document.querySelector('.edit-tbl input[data-r="${r}"][data-c="${c}"]')
  if (!el) return JSON.stringify({ err: 'no cell ' + ${r} + ',' + ${c} })
  const rc = el.getBoundingClientRect()
  const x = Math.round(rc.left + rc.width / 2), y = Math.round(rc.top + rc.height / 2)
  const top = document.elementFromPoint(x, y)
  return JSON.stringify({
    x, y, w: Math.round(rc.width), h: Math.round(rc.height),
    visible: rc.width > 4 && rc.height > 4,
    inVp: rc.top >= 0 && rc.bottom <= window.innerHeight && rc.left >= 0 && rc.right <= window.innerWidth,
    topTag: top ? top.tagName : null,
    topCls: top ? String(top.className || '').slice(0, 40) : null,
    hitIsSelf: top === el,
  })
})()`

/* v207 合计(箱) 回归读数 */
const JS_BOX = `(() => {
  const cells = Array.from(document.querySelectorAll('.edit-tbl td.boxes'))
  const withVal = cells.filter((td) => { const t = String(td.textContent).trim(); return t !== '' && t !== '0' && t !== '—' })
  return JSON.stringify({ n: cells.length, nWithVal: withVal.length, sample: withVal.slice(0, 4).map((td) => String(td.textContent).trim()) })
})()`

/* v209 回归：全屏下「改单」是否仍在表格工具行内 */
const JS_FS_EDITBTN = `(() => {
  const btn = Array.from(document.querySelectorAll('button')).find((b) => /^改单$/.test(String(b.textContent).trim()))
  const row = document.querySelector('.grid-ctl-row')
  const fs = !!document.querySelector('.grid-area.is-fs')
  return JSON.stringify({ exists: !!btn, inRow: !!(btn && row && row.contains(btn)), fullscreen: fs })
})()`

const readFocus = async (p) => JSON.parse(await p.evaluate(JS_FOCUS));

/* 🔴 取「某格**当下**的屏幕坐标」，并且**保证这个坐标真的能点到它**。三件事都是实测踩出来的：

   ① **先滚到视口中央再取坐标**：中间的键盘跳格 / PageDown 都会滚动表格，旧坐标随即过期 ——
      拿过期坐标去点，点空（或点到别的元素），表现是 activeElement 变成 null，
      会被误读成「功能坏了」。baseline 实测正是这样：S3 读到 `{r:null,c:null}`。

   ② **横向也必须显式居中**（v210b 实测新增，最坑的一条）：只靠 scrollIntoView 会被**粘性列**骗过。
      本表 `.seq-cell` / `.frozen` 都是 `position:sticky;left:0`（冻结区实测约 250px），
      而 scrollIntoView 用的是**最小滚动**语义：只要格子「落在滚动口里」就不再滚 ⇒
      它刚好停在滚动口左边缘，也就是**被冻结列盖住**的位置。浏览器不知道 sticky 会遮挡，
      于是 `scrollIntoView` 之后 `elementFromPoint` 命中的是 `td.seq-cell`，不是 input。
      实测：End 把表格滚到 sl=2055 后，目标格停在 x=284..360，冻结列占 x=283..533
      ⇒ 点击落到序号列 ⇒ 后续断言全部读成 `{r:null,c:null}`，看着像「功能坏了」。
      ⇒ 这里直接把格子横滚到**滚动容器正中**，一次性绕开所有粘性遮挡（含将来新增的冻结列）。

   ③ 返回值带 `hitIsSelf`，调用方**必须**断言它 —— 否则「点了没反应」又会以假红形式出现。 */
const pointOfCell = async (p, r, c) => {
  await p.evaluate((rr, cc) => {
    const el = document.querySelector(`.edit-tbl input[data-r="${rr}"][data-c="${cc}"]`)
    if (!el) return
    if (el.scrollIntoView) el.scrollIntoView({ block: 'center', inline: 'nearest' })
    /* 横向居中：用「滚动内容坐标」反算 scrollLeft（不能拿视口坐标直接减，那忽略了当前 scrollLeft） */
    const wrap = el.closest('.table-wrap')
    if (wrap) {
      const wr = wrap.getBoundingClientRect()
      const er = el.getBoundingClientRect()
      const contentX = er.left - wr.left + wrap.scrollLeft
      const want = contentX + er.width / 2 - wrap.clientWidth / 2
      const maxS = Math.max(0, wrap.scrollWidth - wrap.clientWidth)
      wrap.scrollLeft = Math.max(0, Math.min(maxS, want))
    }
  }, r, c)
  await sleep(300)
  return JSON.parse(await p.evaluate(jsPointOf(r, c)))
}
const clickCell = async (p, r, c) => {
  const pt = await pointOfCell(p, r, c)
  if (pt.err) return pt
  await p.mouse.click(pt.x, pt.y)
  return pt
}
/* ⚠️ 目标列必须选**真有输入框**的列：编辑表里 `edit:'ro'` 的列（如「到货周期」）只有文本、没有 input，
   拿它当跳格目标会得到「focus 找不到元素 ⇒ 焦点不动」的**假红**
   （baseline 实测：从 商品名称(c=0) 按 Tab 到 c=1 就是这种假红，看着像 Tab 坏了，其实那列没输入框）。 */
const pickInputCol = async (p) => {
  const cc = await p.evaluate(`(() => {
    const el = document.querySelector('.edit-tbl input.cell-qty[data-r]')
    return el ? Number(el.getAttribute('data-c')) : -1
  })()`)
  return cc
}

(async () => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const p = await b.newPage();
  const consoleErrs = [];
  p.on('console', (m) => { if (m.type() === 'error') consoleErrs.push(m.text().slice(0, 160)); });
  p.on('pageerror', (e) => consoleErrs.push('pageerror: ' + String(e.message).slice(0, 160)));
  p.on('dialog', (d) => d.accept());

  /* S6 用的请求日志：把「零写入」变成可取证的事实 */
  const writes = [];
  p.on('request', (req) => {
    const m = req.method().toUpperCase();
    if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return;
    const u = req.url();
    if (!/\/api\//.test(u)) return;
    writes.push(m + ' ' + u.replace(/^https?:\/\/[^/]+/, '').slice(0, 90));
  });

  await p.setViewport({ width: 1600, height: 950, deviceScaleFactor: 1 });
  await p.goto('https://hergent.cn/?cb=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2200);

  /* ---------- 取景：注入沙箱登录态（推荐）或走「演示」登录 ---------- */
  if (SANDBOX_TOKEN && SANDBOX_TENANT) {
    console.log('\n########## 取景：隔离沙箱租户 ' + SANDBOX_TENANT + ' ##########');
    await p.evaluate((tok, tid, uname) => {
      localStorage.setItem('hergent_v2_token', tok);
      localStorage.setItem('hergent_v2_tenant', String(tid));
      localStorage.setItem('hergent_v2_user', JSON.stringify({
        id: 0, username: uname, display_name: '沙箱验证账号', role: 'boss',
      }));
    }, SANDBOX_TOKEN, SANDBOX_TENANT, SANDBOX_USER);
    /* 重新载入：router 守卫读 localStorage 里的 token 才认「已登录」 */
    await p.goto('https://hergent.cn/?cb=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(2600);
  } else {
    await p.evaluate(() => { const el = Array.from(document.querySelectorAll('button,a')).find((x) => /演示/.test(x.textContent)); el && el.click(); });
    await sleep(3200);
  }
  await p.evaluate(() => { const el = Array.from(document.querySelectorAll('a')).find((x) => x.getAttribute('href') === '#/forecast'); el && el.click(); });
  await sleep(4200);

  /* 🔴 安全断言：先证明「我确实在沙箱里，不是在真实租户里」—— 一个会敲键盘改数据的探针，
     绝不允许在没确认租户身份的情况下继续跑。
     ⚠️ 必须在**已进入 #/forecast 之后**读下拉（`.sel-period` 只在预报页存在；放在切页之前会读到空数组，
        得到「明明在沙箱里却报不在」的假红 —— 实测踩过）。 */
  if (SANDBOX_TOKEN && SANDBOX_TENANT) {
    const seen = new Set();
    p.on('request', (r) => { const t = r.headers()['x-tenant-id']; if (t) seen.add(String(t)) });
    const opts = JSON.parse(await p.evaluate(`(() => {
      const sel = document.querySelector('.sel-period')
      return JSON.stringify(sel ? Array.from(sel.options).map((o) => o.text) : [])
    })()`))
    const markHit = PERIOD_MARK ? opts.some((t) => String(t).indexOf(PERIOD_MARK) >= 0) : false
    console.log('  期次下拉: ' + JSON.stringify(opts) + '   标记「' + PERIOD_MARK + '」命中: ' + markHit)
    ok('S-1 🔴 期次下拉里出现**沙箱专属标记期次**（证明后端认的是沙箱，不是真实租户）', markHit, JSON.stringify({ want: PERIOD_MARK, opts }))
  }

  const picked = await p.evaluate((mark) => {
    const sel = document.querySelector('.sel-period');
    if (!sel) return null;
    const opts = Array.from(sel.options).filter((o) => o.value && o.value !== '0');
    // 优先选**带沙箱标记**的那个期次：后续所有断言都跑在它上面，取景必须确定
    const opt = (mark && opts.find((o) => String(o.text).indexOf(mark) >= 0)) || opts[0];
    if (!opt) return null;
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return opt.text;
  }, PERIOD_MARK);
  await sleep(3400);
  console.log('URL: ' + p.url() + '   期次: ' + (picked || '(无)'));
  ok('S-2 🔴 拿到了一个**进行中的期次**（编辑网格的前提；演示租户当时正是卡在这一步）', !!picked, JSON.stringify(picked));

  /* ============ S0. 进入编辑态 ============ */
  console.log('\n########## S0. 进入编辑态（点「改单」）##########');
  {
    const clicked = await p.evaluate(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((x) => /^改单$/.test(String(x.textContent).trim()))
      if (!btn) return false
      btn.click(); return true
    })()`);
    await sleep(5200);
    const n = await p.evaluate(`document.querySelectorAll('.edit-tbl input[data-r]').length`);
    console.log('  已点「改单」: ' + clicked + '   编辑网格可编辑 input 数: ' + n);
    ok('S0-1 进入编辑态且网格已渲染', clicked === true && n > 20, 'inputs=' + n);
  }

  /* ============ S1. 需求① 单击即全选 ============ */
  console.log('\n########## S1. 需求①「单击选中所有内容」##########');
  const txt = JSON.parse(await p.evaluate(JS_PICK_TEXT));
  console.log('  文本格样本: ' + JSON.stringify({ r: txt.r, c: txt.c, len: txt.len, val: String(txt.val).slice(0, 14) }));
  ok('S1-0 找到可验证的文本格（selectionStart 对 number 输入不可用，故全选必须用 text 格验）', !txt.err, JSON.stringify(txt.err || ''));

  if (!txt.err) {
    /* 先点别处，确保目标格是「未聚焦」状态 —— 与用户第一次单击的处境一致 */
    const q0 = JSON.parse(await p.evaluate(JS_PICK_QTY));
    if (!q0.err) { await clickCell(p, q0.r, q0.c); await sleep(260); }

    const pt = await pointOfCell(p, txt.r, txt.c);
    console.log('  目标格屏幕坐标: ' + JSON.stringify(pt));
    ok('S1-1 目标格可见可点：坐标在视口内 **且命中测试命中的就是该输入框**',
      pt.visible === true && pt.hitIsSelf === true, JSON.stringify(pt));
    await p.mouse.click(pt.x, pt.y);
    await sleep(360);
    const f = await readFocus(p);
    console.log('  单击后: ' + JSON.stringify({ r: f.r, c: f.c, sel: f.sel, len: f.len, fullSelect: f.fullSelect }));
    ok('S1-2 🔴 单击 → 焦点落在该格', f.isCell && f.r === txt.r && f.c === txt.c, JSON.stringify({ r: f.r, c: f.c }));
    ok('S1-3 🔴 单击 → **内容被全选**（selectionStart=0 且 selectionEnd=长度）',
      f.fullSelect === true, JSON.stringify({ sel: f.sel, len: f.len }));

    /* 行为层面的证据：全选后直接打字 = 整格替换（这正是用户说的「便于快速修改已有内容」） */
    await p.keyboard.type('测试名');
    await sleep(260);
    const after = await readFocus(p);
    console.log('  全选后直接打字 → 值 = ' + JSON.stringify(after.val));
    ok('S1-4 🔴 全选后直接打字 = **整格替换**（不是拼接在旧内容后面）', after.val === '测试名', JSON.stringify(after.val));
    /* 鼠标点另一格：让这一格的 change 提交掉，便于后面验状态条 */
    if (!q0.err) { await clickCell(p, q0.r, q0.c); await sleep(320); }
  }

  /* 数量格（number 型）的整格替换 —— 用户最常改的就是这一列 */
  const q = JSON.parse(await p.evaluate(JS_PICK_QTY));
  console.log('\n  数量格样本: ' + JSON.stringify({ r: q.r, c: q.c, val: q.val }));
  ok('S1-5 找到非空数量格', !q.err, JSON.stringify(q.err || ''));
  if (!q.err) {
    /* 先点名称格把焦点挪走（确保目标格未被聚焦） */
    await clickCell(p, txt.r, txt.c).catch(() => {});
    await sleep(300);
    await clickCell(p, q.r, q.c);
    await sleep(320);
    await p.keyboard.type('7');
    await sleep(300);
    const fq = await readFocus(p);
    console.log('  单击数量格后直接打「7」→ 值 = ' + JSON.stringify(fq.val) + '（原值 ' + q.val + '）');
    ok('S1-6 🔴 数量格单击即全选：打「7」得到的就是 7（若未全选会是 ' + q.val + '7 之类）',
      String(fq.val) === '7', 'got=' + JSON.stringify(fq.val) + ' old=' + q.val);
  }

  /* ============ S2. 需求② 方向键跨格跳转（导航态） ============ */
  console.log('\n########## S2. 需求②「方向键在单元格之间跳转」##########');
  {
    /* 用键盘跳到一个确定的格，再从那里出发 —— 起点明确，断言才有意义 */
    const start = await readFocus(p);
    const base = { r: start.r, c: start.c };
    console.log('  起点: ' + JSON.stringify(base));

    await p.keyboard.press('ArrowDown'); await sleep(300);
    const d = await readFocus(p);
    ok('S2-1 🔴 ArrowDown → 焦点下移一格（老实现里方向键在输入框内被一律放行 = 这条永远不成立）',
      d.isCell && d.r === base.r + 1 && d.c === base.c, JSON.stringify({ want: [base.r + 1, base.c], got: [d.r, d.c] }));
    await p.keyboard.press('ArrowUp'); await sleep(300);
    const u = await readFocus(p);
    ok('S2-2 ArrowUp → 焦点上移一格', u.isCell && u.r === base.r && u.c === base.c, JSON.stringify({ want: [base.r, base.c], got: [u.r, u.c] }));
    await p.keyboard.press('ArrowRight'); await sleep(300);
    const rr = await readFocus(p);
    ok('S2-3 ArrowRight → 焦点右移一格', rr.isCell && rr.r === base.r && rr.c === base.c + 1, JSON.stringify({ want: [base.r, base.c + 1], got: [rr.r, rr.c] }));
    await p.keyboard.press('ArrowLeft'); await sleep(300);
    const ll = await readFocus(p);
    ok('S2-4 ArrowLeft → 焦点左移一格', ll.isCell && ll.r === base.r && ll.c === base.c, JSON.stringify({ want: [base.r, base.c], got: [ll.r, ll.c] }));

    /* 跳到的格子必须仍是导航态（内容全选）—— 否则「跳过去直接打字」会变成拼接 */
    const txt2 = JSON.parse(await p.evaluate(JS_PICK_TEXT));
    if (!txt2.err) {
      await p.evaluate(`(() => { const el = document.querySelector('.edit-tbl input[data-r="${txt2.r}"][data-c="${txt2.c}"]'); el && el.focus() })()`);
      await sleep(280);
      await p.keyboard.press('ArrowDown'); await sleep(280);
      await p.keyboard.press('ArrowUp'); await sleep(280);
      const f2 = await readFocus(p);
      ok('S2-5 🔴 跳格后新格仍是导航态（内容全选）—— 跳过去直接打字就是替换',
        f2.r === txt2.r && f2.fullSelect === true, JSON.stringify({ r: f2.r, c: f2.c, sel: f2.sel, len: f2.len }));
    }

    /* End / PageDown：老实现里同样是死代码 */
    await p.keyboard.press('End'); await sleep(340);
    const e1 = await readFocus(p);
    /* ⚠️ 期望值必须取**应用自己的 maxC**，且**必须排掉「加单(箱)」那一列**：
       导航坐标系是 `maxC = visibleCols.length + unitCount() - 1`（onGridKey:4380），
       而「加单(箱)」的 data-c 用的是**独立常量** `C_EXTRA_INPUT = visibleCols.length + unitCount()`
       —— 正好 = maxC + 1，**不参与**导航坐标系。
       它的 class 也是 `cell-qty`（模板 1053 行）⇒ 只按 `.cell-qty` 取最大 data-c 会得到 28，
       而 End 正确地停在 27 ⇒ **断言红、实现是对的**（实测期望 28 / 实际 27）。
       正确写法：`td:not(.extra)`（加单那一格的 td class 是 `num calc extra`）。
       实测三者对齐：qtyMaxC=28（含加单） / qtyMaxCNoExtra=27 / End 落点=27。 */
    const appMaxC = await p.evaluate(`(() => { let m = -1; document.querySelectorAll('.edit-tbl td:not(.extra) input.cell-qty[data-r]').forEach((el) => { const c = Number(el.getAttribute('data-c')); if (c > m) m = c }); return m })()`);
    ok('S2-6 End → 跳到本行最后一个**报单对象列**（同为老实现的死代码）', e1.isCell && e1.c === appMaxC, JSON.stringify({ got: e1.c, appMaxC }));
    await p.keyboard.press('Home'); await sleep(320);
    const h1 = await readFocus(p);
    ok('S2-7 Home → 回到本行第一列', h1.isCell && h1.c === 0, JSON.stringify({ got: h1.c }));
    const beforePd = await readFocus(p);
    await p.keyboard.press('PageDown'); await sleep(420);
    const pd = await readFocus(p);
    ok('S2-8 PageDown → 下移约 20 行', pd.isCell && pd.r > beforePd.r, JSON.stringify({ from: beforePd.r, to: pd.r }));

    /* S2-9（v210b）：**跳到的格子不得被冻结列遮住**。
       🔴 这是 v210 **新开出来的**路径（改前方向键在输入框内一律放行 ⇒ 根本不会跳格，故老版本不存在）。
          浏览器原生 focus() 的「滚进视口」是**最小滚动**语义 ⇒ 把目标格停在滚动口**左边缘**，
          而左边缘正是粘性列的地盘（`.seq-cell` 46px + `.frozen` ~200px，均 position:sticky;left:0）
          ⇒ 格子被盖住、用户「按了方向键但光标看不见」。诊断实测：滚动口 x∈[283,1565]、
          冻结列占 x∈[283,533]，而 scrollIntoView 会把格子停在 x=284 —— 命中测试拿到 `td.seq-cell`。
          下面是复现它的最短路径：End（滚到最右）→ Home（首列是粘性的，页面**不会**滚回来）→ 方向键右移。 */
    const fns = await p.evaluate(`(() => {
      const row = document.querySelector('.edit-tbl tbody tr')
      if (!row) return -1
      let best = -1
      row.querySelectorAll('input[data-c]').forEach((el) => {
        const cc = Number(el.getAttribute('data-c'))
        const td = el.closest('td')
        const sticky = td && getComputedStyle(td).position === 'sticky'
        if (!sticky && (best < 0 || cc < best)) best = cc
      })
      return best
    })()`)
    ok('S2-9a 前置：存在**非粘性列且下标 ≥ 1**（否则下面的遮挡断言是空的，等于没测）', fns >= 1, 'firstNonStickyC=' + fns)
    if (fns >= 1) {
      await p.keyboard.press('End'); await sleep(420);   /* 表格滚到最右：低序列全部滚出视口左侧 */
      await p.keyboard.press('Home'); await sleep(420);  /* 回首列；它是粘性的 ⇒ 页面不会滚回来 */
      const sl = await p.evaluate(`(() => { const w = document.querySelector('.table-wrap.edit-grid-wrap'); return w ? w.scrollLeft : -1 })()`);
      for (let i = 0; i < fns; i++) { await p.keyboard.press('ArrowRight'); await sleep(160); }
      await sleep(320);
      const cur = await readFocus(p);
      const ptn = JSON.parse(await p.evaluate(jsPointOf(cur.r, cur.c)));
      console.log('  S2-9: 滚动容器 scrollLeft=' + sl + '  跳到 c=' + cur.c
        + '  命中测试 top=' + ptn.topTag + '.' + ptn.topCls + '  hitIsSelf=' + ptn.hitIsSelf);
      ok('S2-9b 🔴 表格已滚到最右时「Home + 方向键右移」进入非粘性列 ⇒ 该格**没被冻结列遮住**'
        + '（只靠原生 focus 的最小滚动会把它停在滚动口左边缘 = 冻结列底下）',
        cur.isCell && cur.c === fns && ptn.hitIsSelf === true,
        JSON.stringify({ wantC: fns, gotC: cur.c, scrollLeft: sl, top: ptn.topTag + '.' + ptn.topCls, hit: ptn.hitIsSelf }));
    }
  }

  /* ============ S3. 输入态：第二次点击 / F2 ⇒ 光标落定、方向键不再跳格 ============ */
  console.log('\n########## S3. 输入态（双击 / F2 / 第二次点击）—— 保住「改一位数字」的手感 ##########');
  {
    const q2 = JSON.parse(await p.evaluate(JS_PICK_QTY));
    if (!q2.err) {
      /* 单击（导航态）→ 再点一次（输入态） */
      const ptA = await clickCell(p, txt.r, txt.c).catch(() => null); await sleep(300);
      const ptB = await clickCell(p, q2.r, q2.c); await sleep(380);
      console.log('  S3 点击落点: 名称格=' + JSON.stringify(ptA) + '  数量格=' + JSON.stringify(ptB));
      const nav = await readFocus(p);
      const pt2 = await pointOfCell(p, q2.r, q2.c);
      console.log('  S3 第二次点: ' + JSON.stringify(pt2));
      await p.mouse.click(pt2.x, pt2.y); await sleep(360);
      const typed = await readFocus(p);
      ok('S3-0 两次点击都确实落在目标格上（前置条件；否则下面几条断言是无意义的）'
        + ' —— 含**命中测试**：坐标最上层元素必须就是该输入框（不然点的是冻结列/浮层）',
        nav.r === q2.r && nav.c === q2.c && typed.r === q2.r && typed.c === q2.c
        && ptB.hitIsSelf === true && pt2.hitIsSelf === true,
        JSON.stringify({ want: [q2.r, q2.c], nav: [nav.r, nav.c], typed: [typed.r, typed.c], hitB: ptB.hitIsSelf, hit2: pt2.hitIsSelf }));
      console.log('  第一次点: ' + JSON.stringify({ r: nav.r, c: nav.c }) + '  第二次点: ' + JSON.stringify({ r: typed.r, c: typed.c }));
      await p.keyboard.press('ArrowRight'); await sleep(320);
      const stay = await readFocus(p);
      ok('S3-1 🔴 输入态下 ArrowRight **不再跳格**（焦点留在原格，交给浏览器移光标）',
        stay.isCell && stay.r === q2.r && stay.c === q2.c, JSON.stringify({ want: [q2.r, q2.c], got: [stay.r, stay.c] }));

      /* Esc 退回导航态 → 方向键恢复跳格 */
      await p.keyboard.press('Escape'); await sleep(320);
      await p.keyboard.press('ArrowRight'); await sleep(340);
      const after = await readFocus(p);
      ok('S3-2 Esc 退回导航态后方向键恢复跳格（两态可来回切）',
        after.isCell && after.r === q2.r && after.c === q2.c + 1, JSON.stringify({ want: [q2.r, q2.c + 1], got: [after.r, after.c] }));

      /* F2 也必须进输入态（原实现 F2 == 单击，等于白给） */
      await p.keyboard.press('F2'); await sleep(320);
      await p.keyboard.press('ArrowDown'); await sleep(320);
      const f2stay = await readFocus(p);
      ok('S3-3 🔴 F2 → 输入态（ArrowDown 不跳格）—— 原实现 F2 与单击等价，这条必红',
        f2stay.isCell && f2stay.r === q2.r && f2stay.c === q2.c + 1, JSON.stringify({ got: [f2stay.r, f2stay.c] }));
      await p.keyboard.press('Escape'); await sleep(260);
      await p.keyboard.press('ArrowDown'); await sleep(320);
      const f2back = await readFocus(p);
      ok('S3-4 Esc 后再 ArrowDown 恢复跳格', f2back.r === q2.r + 1, JSON.stringify({ got: [f2back.r, f2back.c] }));
    }
  }

  /* ============ S4. 拖框选之后方向键仍可用（判据必须带 && editing） ============ */
  console.log('\n########## S4. 拖框选后方向键仍可用（防「键盘像坏了」的静默失效）##########');
  {
    /* ⚠️ 两个拖拽端点必须**同一次测量**得到：中间一旦发生滚动，先前那个点就过期了。
       目标列取**数量列**（`edit:'ro'` 的列没有 input，用它取坐标会拿到 err ⇒ 整段被跳过）。 */
    await p.evaluate((rr, cc) => {
      const el = document.querySelector(`.edit-tbl input[data-r="${rr}"][data-c="${cc}"]`)
      if (!el) return
      /* 纵向居中到中间那一行 ⇒ 上下各一格（拖拽两端点）同时进视口。
         横向同样**显式居中**：否则会被粘性冻结列盖住（详见 pointOfCell 顶部注释）。 */
      if (el.scrollIntoView) el.scrollIntoView({ block: 'center', inline: 'nearest' })
      const wrap = el.closest('.table-wrap')
      if (wrap) {
        const wr = wrap.getBoundingClientRect()
        const er = el.getBoundingClientRect()
        const contentX = er.left - wr.left + wrap.scrollLeft
        const want = contentX + er.width / 2 - wrap.clientWidth / 2
        const maxS = Math.max(0, wrap.scrollWidth - wrap.clientWidth)
        wrap.scrollLeft = Math.max(0, Math.min(maxS, want))
      }
    }, q.r + 1, q.c)
    await sleep(300)
    const two = JSON.parse(await p.evaluate(`(() => {
      /* pad=true ⇒ 取「**单元格内、输入框之外**的左边缘」（本表实测各约 7px）。
         🔴 起拖点必须落在**非输入框**处，这不是我挑食 —— 是实测出来的硬约束（diag6 双实验对照）：
            从 <input> 自身起拖时浏览器进入**原生文本选择并捕获指针**，期间**不再向其它元素派发 mouseover**
            （实测：移动 12 步，mouseover 计数停在 1；activeElement 始终停在输入框上没被 blur）
            ⇒ onCellOver 永不触发 ⇒ 选区永远建不起来（selRange 恒为 0）。
            从单元格空白处起拖则正常：mouseover 2→7、输入框被 blur、selRange=3。
            ⚠️ 这是**既有行为**（v210 未改动 onCellDown 里 _dragEditing 的 preventDefault 分支），
               不是本次引入的回归；但它意味着「在编辑网格里从格子中间拖选」实际不可用 —— 已作为
               已知局限写进交付说明，本轮不改（改它要重新设计手势，超出本次范围）。 */
      const g = (rr, cc, pad) => {
        const el = document.querySelector('.edit-tbl input[data-r="' + rr + '"][data-c="' + cc + '"]')
        if (!el) return null
        const ir = el.getBoundingClientRect()
        const td = el.closest('td')
        const tr = td ? td.getBoundingClientRect() : ir
        const x = pad ? Math.round(tr.left + 3) : Math.round(ir.left + ir.width / 2)
        const y = Math.round(ir.top + ir.height / 2)
        const top = document.elementFromPoint(x, y)
        return { x, y, w: Math.round(ir.width), h: Math.round(ir.height), hitInput: top === el, topTag: top ? top.tagName : null, topCls: top ? String(top.className || '').slice(0, 20) : null }
      }
      return JSON.stringify({ a: g(${q.r}, ${q.c}, true), b: g(${q.r + 2}, ${q.c}, false) })
    })()`))
    const a = two.a, bpt = two.b
    ok('S4-0 拖拽起点落在**单元格空白处（非输入框）**、终点落在目标格；两端点都取到了',
      !!a && !!bpt && a.topTag === 'TD' && bpt.hitInput === true, JSON.stringify(two))
    if (a && bpt) {
      /* 分步取证：把「按下 → 首次移出 → 移到端点 → 抬起」逐步读一遍状态，
         否则只看到「最终没有选区」，无法判断是 onCellDown 没触发、还是 mouseover 没生成。 */
      await p.mouse.move(a.x, a.y);
      await p.mouse.down();
      await sleep(140);
      const sDown = await readFocus(p);
      await p.mouse.move(a.x + 30, a.y + 10, { steps: 3 });
      await sleep(140);
      const sFirst = await readFocus(p);
      await p.mouse.move(bpt.x, bpt.y, { steps: 8 });
      await sleep(140);
      const sMove = await readFocus(p);
      await p.mouse.up();
      console.log('  拖拽分步: 按下后 selected=' + JSON.stringify([sDown.r, sDown.c])
        + '  移出首步后 selRange=' + sFirst.selRange + '（焦点是输入框=' + sFirst.isCell + '）'
        + '  到端点后 selRange=' + sMove.selRange);
      await sleep(300);
      const rg = await readFocus(p);
      console.log('  拖框选后: range-sel 格数=' + rg.selRange + '  当前焦点是不是输入框=' + rg.isCell);
      ok('S4-1 从单元格空白处起拖 ⇒ 已形成多格选区（拖框选生效）',
        rg.selRange > 1, 'n=' + rg.selRange);
      console.log('  ⚠️ 已知局限（既有行为，非本次引入，本轮不改）：从输入框正中起拖**不会**形成选区 ——'
        + ' 浏览器进入原生文本选择并捕获指针，期间不派发 mouseover，onCellOver 收不到。'
        + ' 对照实测见 v210-probe-env-diag6.js（输入框起拖：mouseover 停在 1、selRange=0；空白处起拖：mouseover 7、selRange=3）。');
      /* 🔴 这里**不能**直接断言「拖框选后方向键就跳格」—— 那条断言永远不可能通过，原因不在两态模型：
         拖框选会把焦点 blur 到 body，而 `onGridKey` 是**挂在 <table> 上**的监听器，
         焦点在 body 时 keydown 根本不经过表格 ⇒ 两态判据再对也不会被调用。
         ⇒ 正确的可达路径是：拖框选 → **再单击一格**（回到导航态）→ 方向键跳格。
            这也是用户真实会走的顺序。 */
      await clickCell(p, q.r, q.c);
      await sleep(340);
      const nav = await readFocus(p);
      ok('S4-2 拖框选后单击一格 ⇒ 该格被全选（上一次拖动的状态没有污染它）',
        nav.isCell && nav.r === q.r && nav.c === q.c, JSON.stringify({ want: [q.r, q.c], got: [nav.r, nav.c] }));
      await p.keyboard.press('ArrowDown'); await sleep(400);
      const af = await readFocus(p);
      ok('S4-3 🔴 拖框选之后方向键仍能跳格（拖框选会把输入框 blur 掉 ⇒ 两态判据必须带「焦点是否还在输入框」这一半）',
        af.isCell === true && af.r === q.r + 1 && af.c === q.c, JSON.stringify({ want: [q.r + 1, q.c], got: [af.r, af.c] }));
    }
  }

  /* ============ S5. 回归：旧行为一个都没坏 ============ */
  console.log('\n########## S5. 回归 ##########');
  {
    /* Tab / Enter 的落点必须落在**有输入框**的列上：起点取数量列（`edit:'ro'` 的列没有 input，
       从 商品名称(c=0) 按 Tab 到 c=1 会找不到元素 ⇒ 焦点不动 ⇒ 看着像 Tab 坏了，是**假红**）。 */
    await p.evaluate(`(() => { const el = document.querySelector('.edit-tbl input[data-r="${q.r}"][data-c="${q.c}"]'); el && el.focus() })()`);
    await sleep(320);
    const t0 = await readFocus(p);
    await p.keyboard.press('Tab'); await sleep(360);
    const t1 = await readFocus(p);
    /* 断言「确实移动了」而不是「正好 +1」：起点若在最后一列，Tab 按 Excel 语义会换行，
       写死 +1 会在那种情形下假红。 */
    ok('S5-1 Tab 仍能移动焦点（跳到相邻可编辑格 / 到头换行）',
      t1.isCell && (t1.r !== t0.r || t1.c !== t0.c), JSON.stringify({ from: [t0.r, t0.c], to: [t1.r, t1.c] }));
    await p.keyboard.press('Enter'); await sleep(360);
    const t2 = await readFocus(p);
    ok('S5-2 Enter 仍能移动焦点（下移 / 到头换行）',
      t2.isCell && (t2.r !== t1.r || t2.c !== t1.c), JSON.stringify({ from: [t1.r, t1.c], to: [t2.r, t2.c] }));
    await p.keyboard.press('Escape'); await sleep(320);
    const esc = await readFocus(p);
    ok('S5-3 导航态 Esc 仍清空选中', esc.hasSelectedTd === false, JSON.stringify({ hasSelectedTd: esc.hasSelectedTd }));

    const bx = JSON.parse(await p.evaluate(JS_BOX));
    console.log('  v207 合计(箱): 格数=' + bx.n + ' 有值=' + bx.nWithVal + ' 样本=' + JSON.stringify(bx.sample));
    ok('S5-4 v207 回归：合计(箱) 列仍有非零值（未被本次改动波及）', bx.n > 0 && bx.nWithVal > 0, JSON.stringify(bx));

    /* E1 修复的可见证据：先点一格（不改）、再改另一格 ⇒ 状态条必须变脏、回退必须可用。
       🔴 必须先点「回退」把状态**清零** —— 否则前面 S1/S2 已经改过格子，状态条早就是
          「有未保存的改动」，此时再断言「改一格之后变脏」是**恒真**的（baseline 实测：改前改后一模一样）。
       ⚠️「回退」是纯本地操作（把 cross 恢复成 lastSavedSnap；草稿仍留在 localStorage），**不发任何请求**。 */
    const back = await p.evaluate(`(() => {
      const b = Array.from(document.querySelectorAll('button')).find((x) => /^回退$/.test(String(x.textContent).trim()))
      if (!b || b.disabled) return false
      b.click(); return true
    })()`);
    await sleep(900);
    const w0 = await readFocus(p);
    console.log('  回退后: ' + JSON.stringify({ clicked: back, saveState: w0.saveState, undoDisabled: w0.undoDisabled }));
    ok('S5-5a 前置：点「回退」后状态条回到干净态（不清零的话下面那条断言恒真、等于没测）',
      back === true && !/未保存/.test(w0.saveState), JSON.stringify({ clicked: back, saveState: w0.saveState }));

    const q3 = JSON.parse(await p.evaluate(JS_PICK_QTY));
    if (!q3.err) {
      const pt5 = await clickCell(p, q3.r, q3.c);
      await sleep(340);
      ok('S5-5a2 前置：目标数量格的点击**命中输入框**（坐标被冻结列盖住的话，下面那条会以假红形式出现）',
        pt5.hitIsSelf === true, JSON.stringify({ r: q3.r, c: q3.c, top: pt5.topTag + '.' + pt5.topCls, hit: pt5.hitIsSelf }));
      await p.keyboard.type('9');   /* 全选 ⇒ 整格替换为 9（值确实变了） */
      await sleep(280);
      /* 点下一个格，让上面那格的 change 提交 */
      await clickCell(p, q3.r + 1, q3.c);
      await sleep(520);
      const w2 = await readFocus(p);
      console.log('  E1 取证后状态条: ' + JSON.stringify({ saveState: w2.saveState, undoDisabled: w2.undoDisabled, undoFound: w2.undoFound }));
      ok('S5-5b 🔴 修复取证：先点一格（无改动）再改另一格 ⇒ 改动仍被登记（状态条变「有未保存的改动」、回退可用）',
        /未保存/.test(w2.saveState) && w2.undoDisabled === false, JSON.stringify({ saveState: w2.saveState, undoDisabled: w2.undoDisabled }));
    }

    /* v209 回归：全屏 + **编辑态**下，编辑组只有一份且落在表格工具行内（v209 的让位判据仍成立）。
       ⚠️ 编辑态里**本来就没有**「改单」按钮（它只在只读态出现）——断言「有改单按钮」会假红。 */
    await p.evaluate(`(() => { const b = document.querySelector('.grid-fs-btn'); const has = !!document.querySelector('.grid-area.is-fs'); if (!has && b) b.click() })()`);
    await sleep(1400);
    const fs = await readFocus(p);
    ok('S5-6 v209 回归：全屏 + 编辑态下编辑组仍恰一份、且在表格工具行内',
      fs.ctlRow && fs.nEditGroup === 1 && fs.groupInRow, JSON.stringify({ ctlRow: fs.ctlRow, nEditGroup: fs.nEditGroup, groupInRow: fs.groupInRow }));
    await p.evaluate(`(() => { const b = document.querySelector('.grid-fs-btn'); const has = !!document.querySelector('.grid-area.is-fs'); if (has && b) b.click() })()`);
    await sleep(1000);
  }

  /* ============ S6. 零写入取证 + 运行期异常 ============ */
  console.log('\n########## S6. 零写入取证 / 运行期异常 ##########');
  console.log('  全程非 GET 的 /api/ 请求（' + writes.length + ' 条）:');
  writes.slice(0, 12).forEach((w) => console.log('     ' + w));
  const writeLike = writes.filter((w) => /save|matrix|bulk|upsert|import|execute|close|delete|create/i.test(w));
  ok('S6-1 🔴 全程没有任何写接口调用（含矩阵保存 / 批量 upsert / 导入执行）—— 这次冒烟对生产**零写入**',
    writeLike.length === 0, JSON.stringify(writeLike.slice(0, 5)));
  ok('S6-2 无 console.error / pageerror', consoleErrs.length === 0, JSON.stringify(consoleErrs.slice(0, 5)));

  await p.screenshot({ path: SHOT_DIR + '/真机-编辑网格-方向键跳格.png' });
  await b.close();

  console.log('\n==================================================');
  if (fail) {
    console.log('❌ 失败 ' + fail + ' 项 / 共 ' + (pass + fail) + ' 项');
    fails.forEach((f) => console.log('   · ' + f));
    process.exit(1);
  }
  console.log('✅ 全部通过：' + pass + ' 项断言');
  console.log('截图目录: ' + SHOT_DIR);
})();
