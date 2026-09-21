// v212 真机验收：单元格输入体验 第二批（生产 hergent.cn）
//   ① 数量格候选：上期同格值 / 本期其它客户常用值（P2-1）
//   ② 软警告分级：疑漏订 / 疑超放量（P2-2）
//   ③ 选区批量填同值的可见入口（P2-3）
//
// 🔴 绝不点「保存」：saveEdits() 没有「无改动就短路」分支 ⇒ 点下去就是真实生产写入。
//    本探针只在编辑态内做交互取证（会在内存里改若干格子的值），最后**不保存**直接关浏览器；
//    另有 S6 段用请求日志取证「全程零写入」。
//
// 🔴 地面真值锚定（本探针与 v211 探针最大的不同）：
//    不靠"扫一遍看看有没有角标"这种弱证据，而是**先从接口取上一期真实的 (商品, 客户, 数量) 三元组**，
//    再按商品名在网格里定位到那一行、那一列，然后断言「这一格的候选里就该出现 上期 N」。
//    弱证据的问题是：**没出现时你分不清"功能坏了"和"上期本来就没数据"**（沙箱上一期缺数据时
//    本轮差点据此误判）。锚定之后，"没出现"就是真缺陷。
//
// 用法：
//   HG_TOKEN=<沙箱token> HG_TENANT=9997 HG_USER=sbx_v210 \
//   HG_PERIOD_MARK='v211沙箱期次-勿动' HG_PREV_MARK='v212沙箱上期-勿动' \
//   NODE_PATH=<ws>/node_modules node v212-input-ux-prod-probe.js
console.log('BOOT-1: 模块开始加载');
const puppeteer = require('puppeteer-core');
console.log('BOOT-2: puppeteer 已加载');
const fs = require('fs');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SHOT_DIR = process.env.HG_SHOT_DIR || '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/单元格输入体验-2026-09-20';
const SANDBOX_TOKEN = process.env.HG_TOKEN || '';
const SANDBOX_TENANT = process.env.HG_TENANT || '';
const SANDBOX_USER = process.env.HG_USER || 'sbx_v210';
const PERIOD_MARK = process.env.HG_PERIOD_MARK || '';
const PREV_MARK = process.env.HG_PREV_MARK || '';
const API_BASE = 'https://hergent.cn';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + label + (extra !== undefined ? '  ' + extra : '')); }
  else { fail++; console.log('  ❌ ' + label + (extra !== undefined ? '  ' + extra : '')); }
}

/* 取「某格当下屏幕坐标」并先横滚到容器正中（照抄 v210/v211：scrollIntoView 的 nearest 会被粘性列骗过）。 */
const jsPointOf = (r, c) => `(() => {
  const el = document.querySelector('.edit-tbl input[data-r="${r}"][data-c="${c}"]')
  if (!el) return JSON.stringify({ err: 'no cell ${r},${c}' })
  const wrap = el.closest('.table-wrap') || el.closest('.grid-scroll')
  if (wrap) {
    const wr = wrap.getBoundingClientRect(), er0 = el.getBoundingClientRect()
    const contentX = er0.left - wr.left + wrap.scrollLeft
    const want = contentX + er0.width / 2 - wrap.clientWidth / 2
    wrap.scrollLeft = Math.max(0, Math.min(wrap.scrollWidth - wrap.clientWidth, want))
  }
  const rc = el.getBoundingClientRect()
  const x = Math.round(rc.left + rc.width / 2), y = Math.round(rc.top + rc.height / 2)
  const top = document.elementFromPoint(x, y)
  return JSON.stringify({
    x, y, w: Math.round(rc.width), h: Math.round(rc.height),
    visible: rc.width > 0 && rc.height > 0,
    topTag: top ? top.tagName : null, topCls: top ? top.className : null, hitIsSelf: top === el,
  })
})()`

/* 状态的唯一入口：状态条 + 回退按钮（v210/v211 同款判据）。 */
const JS_STATE = `(() => {
  const b = Array.from(document.querySelectorAll('button')).find((x) => /^回退$/.test(String(x.textContent).trim()))
  const st = document.querySelector('.grid-ctl-row .save-state') || document.querySelector('.save-state')
  return JSON.stringify({ saveState: ((st || {}).textContent || '').trim(), undoDisabled: b ? b.disabled : null, undoFound: !!b, toast: (document.querySelector('.toast') || {}).textContent || null })
})()`

/* 从候选 label（形如「上期 240（v212沙箱上期-勿动）」）里取出那个**上期数量**。
   🔴 不能写成"去掉『上期 』前缀后取全部数字" —— 期次名里带数字（沙箱期次名恰好含 212），
      拼起来会变成 240212，于是**锚定永远不成立**、后续 S1-2 / S1-3 / S3-11 全跟着假红。
      （v212 二跑 S1-0b 就栽在这：候选明明取到了 6 个商品，却一个都锚不上。）
      判据必须只认**紧跟在「上期 」之后**的那一串数字。 */
const PREV_LABEL_NUM = (l) => {
  const m = /^上期\s*([\d.]+)/.exec(String(l || ''));
  return m ? Number(m[1]) : null;
};

/* 当前「选中格」是谁（r,c）+ 选区格数。用于证明「点角标没有把选区带走」。 */
const JS_SEL = `(() => {
  const td = document.querySelector('.edit-tbl td.selected')
  return JSON.stringify({
    sel: td ? [Number(td.getAttribute('data-r')), Number(td.getAttribute('data-c'))] : null,
    nRange: document.querySelectorAll('.edit-tbl td.range-sel').length,
    activeIsInput: !!(document.activeElement && document.activeElement.tagName === 'INPUT' && document.activeElement.hasAttribute('data-r')),
  })
})()`

/* 角标（红/黄通用）的**当下**坐标 + 命中测试。
   ⚠️ 必须"用时再取"：中间的 jsPointOf 会把表格横滚到别处，旧坐标随即失效，
      拿过期坐标去点就是点空，而表现是"点了没反应"，会被误读成功能坏了（v210 踩过）。
   ⚠️ 命中判据必须用 contains 不能用 ===：角标里包着 <Icon>（svg），点中心命中的是**那个 svg 子元素**。 */
const jsDotPoint = (r, c, cls) => `(() => {
  const td = document.querySelector('.edit-tbl td[data-r="${r}"][data-c="${c}"]')
  const el = td ? td.querySelector('${cls}') : null
  if (!el) return JSON.stringify({ err: 'no dot at ${r},${c}' })
  const rc = el.getBoundingClientRect()
  const x = Math.round(rc.left + rc.width / 2), y = Math.round(rc.top + rc.height / 2)
  const top = document.elementFromPoint(x, y)
  const hit = !!top && (top === el || el.contains(top))
  return JSON.stringify({ x, y, hit, topTag: top ? top.tagName : null,
    inVp: rc.top >= 0 && rc.left >= 0 && rc.bottom <= innerHeight && rc.right <= innerWidth })
})()`

console.log('BOOT-3: 顶层执行到 IIFE 之前');
/* 模块级持有浏览器句柄：IIFE 内抛错时，末尾的 catch 必须能把它关掉，
   否则无头 Chromium 吊住事件循环 ⇒ 进程永不退出（详见文件末尾注释）。 */
let BROWSER = null;
(async () => {
  console.log('BOOT-4: 已进入 IIFE');
  /* ⚠️ 显式失败：截图目录建不出来时**必须自己把话说清楚**。
     v211 实测踩到：目录不存在 ⇒ 这一步抛错，而现象竟然是「退出码 0 + 日志 0 字节」——
     看着完全像功能坏了，实际只是日志没落盘（stdout 未 flush 与未接住的 rejection 双重作用）。 */
  try {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
  } catch (e) {
    console.error('FATAL: 截图目录无法创建 —— ' + SHOT_DIR + ' —— ' + String(e && e.message));
    process.exitCode = 1;
    return;
  }
  console.log('BOOT-5: 截图目录已就绪');
  /* 同时挂到模块级 `BROWSER`：FATAL 分支要能关掉它（见文件末尾的 catch） */
  const b = BROWSER = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const p = await b.newPage();
  const consoleErrs = [];
  p.on('console', (m) => { if (m.type() === 'error') consoleErrs.push(m.text().slice(0, 160)); });
  p.on('pageerror', (e) => consoleErrs.push('pageerror: ' + String(e.message).slice(0, 160)));
  p.on('dialog', (d) => d.accept());

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

  /* ============ 取景：隔离沙箱租户 ============ */
  console.log('\n########## 取景：隔离沙箱租户 ' + SANDBOX_TENANT + ' ##########');
  await p.evaluate((tok, tid, uname) => {
    localStorage.setItem('hergent_v2_token', tok);
    localStorage.setItem('hergent_v2_tenant', String(tid));
    localStorage.setItem('hergent_v2_user', JSON.stringify({ id: 0, username: uname, display_name: '沙箱验证账号', role: 'boss' }));
  }, SANDBOX_TOKEN, SANDBOX_TENANT, SANDBOX_USER);
  await p.goto('https://hergent.cn/?cb=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2600);
  await p.evaluate(() => { const el = Array.from(document.querySelectorAll('a')).find((x) => x.getAttribute('href') === '#/forecast'); el && el.click(); });
  await sleep(4200);

  /* 🔴 安全断言：证明「我确实在沙箱里」。会敲键盘改数据的探针，绝不允许在身份未确认时继续跑。
     判据 = 沙箱专属标记期次名出现在期次下拉里（下拉内容完全由后端按当前租户下发），
     必须在**已进入 #/forecast 之后**读（放在切页之前读不到 ⇒ 假红）。 */
  const opts = JSON.parse(await p.evaluate(`(() => {
    const sel = document.querySelector('.sel-period')
    return JSON.stringify(sel ? Array.from(sel.options).map((o) => o.text) : [])
  })()`));
  const markHit = PERIOD_MARK ? opts.some((t) => String(t).indexOf(PERIOD_MARK) >= 0) : false;
  const prevHit = PREV_MARK ? opts.some((t) => String(t).indexOf(PREV_MARK) >= 0) : false;
  console.log('  期次下拉: ' + JSON.stringify(opts));
  ok('S-1 🔴 期次下拉里出现**沙箱专属标记期次**（证明后端认的是沙箱，不是真实租户）', markHit, JSON.stringify({ want: PERIOD_MARK }));
  ok('S-1b 🔴 沙箱**上一期**（有报单数据的那个）也在下拉里 —— 没有它，本轮两个功能都无从取证',
    prevHit, JSON.stringify({ want: PREV_MARK }));

  const picked = await p.evaluate((mark) => {
    const sel = document.querySelector('.sel-period');
    if (!sel) return null;
    const opts = Array.from(sel.options).filter((o) => o.value && o.value !== '0');
    const opt = (mark && opts.find((o) => String(o.text).indexOf(mark) >= 0)) || opts[0];
    if (!opt) return null;
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return { text: opt.text, value: opt.value };
  }, PERIOD_MARK);
  await sleep(3400);
  ok('S-2 🔴 拿到了一个**进行中的期次**（编辑网格的前提）', !!picked, JSON.stringify(picked));

  /* ============ 地面真值：直接问接口「上一期谁订了什么」============
     用页面内 fetch（带沙箱 token）拿原始 summary，构建 (商品名 → 客户 → 数量)。
     这是后面所有断言的锚点：**先知道答案，再去界面里找它**。 */
  const PERIODS = JSON.parse(await p.evaluate(`(() => {
    const sel = document.querySelector('.sel-period')
    return JSON.stringify(sel ? Array.from(sel.options).filter((o) => o.value && o.value !== '0').map((o) => ({ id: Number(o.value), text: o.text })) : [])
  })()`));
  const curId = picked ? Number(picked.value) : 0;
  /* 上一期 = 与前端同一套排序（order_start 升序）后当前期的前一个。
     ⚠️ 前端排序用的是 periods 接口里每期的 order_start，而下拉里拿不到 —— 因此这里不自己猜，
       改为**逐个候选期次去问接口**，取「有按客户明细的那一个里、order_start 最大且小于当前的」。 */
  const prevInfo = await p.evaluate(async (tok, tid, cur, periods) => {
    let best = null;
    for (const x of periods) {
      if (Number(x.id) === Number(cur)) continue;
      const r = await fetch('/api/forecast-submissions/summary?period_id=' + x.id, { headers: { Authorization: 'Bearer ' + tok, 'X-Tenant-Id': String(tid) } });
      if (!r.ok) continue;
      const d = await r.json();
      const withSrc = (d.rows || []).filter((y) => (y.sources || []).length && (y.sources || []).some((s) => (s.qty || 0) > 0));
      if (withSrc.length) {
        const tot = withSrc.reduce((a, y) => a + (y.sources || []).reduce((b, s) => b + (Number(s.qty) || 0), 0), 0);
        if (!best || tot > best.tot) best = { id: x.id, name: x.text, tot, rows: withSrc.length };
      }
    }
    return JSON.stringify(best || {});
  }, SANDBOX_TOKEN, SANDBOX_TENANT, curId, PERIODS);
  /* 🔴 `p.evaluate` 返回的是**字符串**（evaluate 里已经 JSON.stringify 过一层）。
     直接读 `prevInfo.id` 恒为 undefined ⇒ 下一段拼出 `period_id=undefined` ⇒ 后端 422
     ⇒ TRUTH.byName 全空 ⇒ S-4 / S1-0a / S1-0b / S2 四连 / S3-11·12 / S6-2 一路连锁假红。
     这类「取数失败伪装成功能坏了」是探针最贵的假象（v212 首跑 18 项失败里有 15 项是它），
     所以这里显式 parse 并单独断言 —— 取数失败必须**在这里**就露出来，不能传染到后面。 */
  const prev = (() => { try { const o = JSON.parse(prevInfo); return (o && typeof o === 'object') ? o : {} } catch (e) { return {} } })();
  console.log('  上一期（按明细量最大的那期）: ' + JSON.stringify(prev));
  ok('S-3 🔴 前置：存在一个**有按客户明细**的上一期（否则候选/软警告无从出现，只能得到"无数据"这种不可判结论）',
    !!(prev && prev.id), JSON.stringify(prev));

  /* 取该期的按客户明细 → 按商品名索引（商品名是网格行与 summary 两侧唯一的公共键） */
  const TRUTH = JSON.parse(await p.evaluate(async (tok, tid, pid) => {
    const r = await fetch('/api/forecast-submissions/summary?period_id=' + pid, { headers: { Authorization: 'Bearer ' + tok, 'X-Tenant-Id': String(tid) } });
    const d = await r.json();
    const byName = {};
    (d.rows || []).forEach((y) => {
      const nm = String(y.product_name || '').trim();
      if (!nm) return;
      const bucket = {};
      (y.sources || []).forEach((s) => {
        const st = s.store || s.store_name || '';
        if (!st) return;
        bucket[st] = (bucket[st] || 0) + (Number(s.qty) || 0);
      });
      if (Object.keys(bucket).length) byName[nm] = bucket;
    });
    return JSON.stringify({ units: d.all_units || [], byName });
  }, SANDBOX_TOKEN, SANDBOX_TENANT, prev.id));
  console.log('  上一期商品数（有明细）: ' + Object.keys(TRUTH.byName || {}).length + '   客户名册: ' + JSON.stringify((TRUTH.units || []).slice(0, 5)) + '…');
  ok('S-4 🔴 前置：上一期明细已建索引，且客户名册非空', Object.keys(TRUTH.byName || {}).length > 0 && (TRUTH.units || []).length > 0,
    JSON.stringify({ 商品数: Object.keys(TRUTH.byName || {}).length, 客户数: (TRUTH.units || []).length }));

  /* ============ S0. 进编辑态 ============ */
  console.log('\n########## S0. 进入编辑态（点「改单」）##########');
  {
    const clicked = await p.evaluate(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((x) => /^改单$/.test(String(x.textContent).trim()))
      if (!btn) return false
      btn.click(); return true
    })()`);
    await sleep(5200);
    const n = await p.evaluate(`document.querySelectorAll('.edit-tbl input[data-r]').length`);
    const nRow = await p.evaluate(`document.querySelectorAll('.edit-tbl tbody tr').length`);
    console.log('  已点「改单」: ' + clicked + '   可编辑 input 数: ' + n + '   行数: ' + nRow);
    ok('S0-1 进入编辑态且网格已渲染', clicked === true && n > 20, 'inputs=' + n);
    ok('S0-2 客户列（数量格所在列）已渲染', await p.evaluate(`document.querySelectorAll('.edit-tbl input.cell-qty[data-r]').length`) > 20);
  }

  /* ============ S1. P2-1 数量格候选：把「上一期真值」在界面里找出来 ============ */
  console.log('\n########## S1. P2-1 数量格候选（上期同格值 / 本期其它客户常用值）##########');
  let anchor = null;      // { r, c, ui, store, prevQty, name }
  let anchorCands = [];   // 「上一期有量、且能在网格里按商品名找到」的候选行（S3 造超放量时复用）
  {
    /* 行索引：网格第一列（商品名格）的 value → data-r。
       这是"按名字把接口真值映射到网格行"的那一步，映射不上就必须显式报前置失败。 */
    const nameMap = JSON.parse(await p.evaluate(`(() => {
      const m = {}
      document.querySelectorAll('.edit-tbl input.cell-name[data-r]').forEach((el) => {
        const nm = String(el.value || '').trim()
        const r = Number(el.getAttribute('data-r'))
        if (nm && !(nm in m)) m[nm] = r
      })
      return JSON.stringify({ n: Object.keys(m).length, m })
    })()`));
    console.log('  网格商品名行数: ' + nameMap.n);

    /* 客户列索引：数量格 data-c = visibleCols.length + ui ⇒ 由「同一格上 td.cell-name 的 data-c」反推不了，
       改为：直接按候选 label 里的「上期 N」来找 —— 用锚定过的 (商品名, 客户名, 数量) 去比对。
       ⚠️ 做法：对「接口说是上一期有量的商品」对应的网格行，逐个点击它的数量格读取候选，
          看哪一列的候选 label 恰好含「上期 <该商品的某客户量>」。命中即锚定。 */

    /* 只挑同时满足：① 网格里能找到该商品名 ② 上一期该商品明细量最大 的几个商品 —— 一命中就停 */
    const cand = JSON.parse(await p.evaluate((truth, nmap) => {
      const hits = []
      Object.keys(truth).forEach((nm) => {
        if (!(nm in nmap)) return
        const bucket = truth[nm]
        const total = Object.keys(bucket).reduce((a, k) => a + bucket[k], 0)
        const best = Object.keys(bucket).sort((a, b) => bucket[b] - bucket[a])[0]
        hits.push({ name: nm, r: nmap[nm], store: best, qty: bucket[best], total })
      })
      hits.sort((a, b) => b.total - a.total)
      return JSON.stringify(hits.slice(0, 6))
    }, TRUTH.byName, nameMap.m));
    anchorCands = cand;
    console.log('  可锚定的商品候选（按上期量降序取前6）: ' + JSON.stringify(cand.map((x) => ({ n: x.name.slice(0, 12), r: x.r, store: x.store, qty: x.qty }))));
    ok('S1-0a 🔴 前置：上一期有量的商品**能按名字映射到网格行**（映射不上说明两侧商品名口径不一致）',
      cand.length > 0, JSON.stringify({ 候选数: cand.length }));

    /* 逐格点击读候选，直到找到「上期 N」与真值吻合的那一格 */
    for (const x of cand) {
      if (anchor) break;
      const cols = JSON.parse(await p.evaluate(`(() => {
        const c = []
        document.querySelectorAll('.edit-tbl td[data-r="${x.r}"] td').forEach(() => {})
        const tds = document.querySelectorAll('.edit-tbl tbody tr:nth-child(${x.r + 1}) td.qty-cell')
        tds.forEach((td) => c.push(Number(td.getAttribute('data-c'))))
        return JSON.stringify(c)
      })()`));
      for (const c of cols) {
        const pt = JSON.parse(await p.evaluate(jsPointOf(x.r, c)));
        if (!pt.hitIsSelf) continue;
        await p.mouse.click(pt.x, pt.y);
        await sleep(120);
        const got = JSON.parse(await p.evaluate(`(() => {
          const dl = document.getElementById('opt-qty')
          const td = document.querySelector('.edit-tbl td[data-r="${x.r}"][data-c="${c}"]')
          const inp = td ? td.querySelector('input.cell-qty') : null
          return JSON.stringify({
            hasDl: !!dl,
            nDatalist: document.querySelectorAll('datalist#opt-qty').length,
            nWithList: document.querySelectorAll('.edit-tbl input.cell-qty[list="opt-qty"]').length,
            opts: dl ? Array.from(dl.querySelectorAll('option')).map((o) => ({ v: o.getAttribute('value'), l: o.getAttribute('label') || '' })) : [],
            cur: inp ? String(inp.value) : null,
            listAttr: inp ? inp.getAttribute('list') : null,
          })
        })()`));
        const prevOpt = (got.opts || []).find((o) => /^上期 /.test(o.l));
        if (prevOpt && PREV_LABEL_NUM(prevOpt.l) === Number(x.qty)) {
          anchor = { r: x.r, c, ui: c, store: x.store, prevQty: x.qty, name: x.name, got };
          break;
        }
      }
    }

    if (!anchor) {
      /* 没锚上：把当场的候选探一遍，把证据留下来（避免只有一句"没找到"） */
      const probe = JSON.parse(await p.evaluate(`(() => {
        const out = []
        document.querySelectorAll('.edit-tbl input.cell-qty[data-r]').forEach((el, i) => {
          if (i >= 40) return
          const td = el.closest('td')
          const dl = document.getElementById('opt-qty')
          out.push({ r: Number(el.getAttribute('data-r')), c: Number(el.getAttribute('data-c')), hasDl: !!dl })
        })
        return JSON.stringify(out.slice(0, 3))
      })()`));
      console.log('  未锚定的现场样本: ' + JSON.stringify(probe));
    }
    ok('S1-0b 🔴 前置：在界面里锚定到「上一期真值对应的那一格」（候选 label 的数值与接口真值逐字吻合）',
      !!anchor, anchor ? JSON.stringify({ 行: anchor.r, 列: anchor.c, 客户: anchor.store, 上期量: anchor.prevQty }) : '未锚定');

    if (anchor) {
      const g = anchor.got;
      console.log('  锚定格候选: ' + JSON.stringify(g.opts));
      ok('S1-1 聚焦数量格后出现了候选下拉（datalist#opt-qty）', g.hasDl === true);
      ok('S1-2 🔴 候选中出现「上期 N」且 N 与接口真值一致（数据源真的取到了"按客户"的上期值）',
        g.opts.some((o) => PREV_LABEL_NUM(o.l) === Number(anchor.prevQty)),
        JSON.stringify({ 真值: anchor.prevQty, 候选: g.opts.map((o) => o.l) }));
      /* 🔴 S1-3：候选里**不该**出现"按商品汇总"的数 —— 那正是本轮最容易做错的一处
         （现成的 prevMap 是按商品汇总的，拿它比单格就是全表误报）。
         判据：候选里的「上期 N」必须等于**该客户**的量，而不是该商品的合计。 */
      const sumOfProduct = Object.values(TRUTH.byName[anchor.name] || {}).reduce((a, z) => a + z, 0);
      ok('S1-3 🔴 用的是**按客户**的量、不是按商品汇总（汇总口径会让整表误报漏订）',
        Number(anchor.prevQty) !== sumOfProduct || Object.keys(TRUTH.byName[anchor.name] || {}).length === 1,
        JSON.stringify({ 该客户: anchor.prevQty, 该商品合计: sumOfProduct, 客户数: Object.keys(TRUTH.byName[anchor.name] || {}).length }));
      /* S1-4：「本期其它客户填」这一类要能出现（本地来源，零请求）。
         锚定格本身可能没有同桌值 —— 放宽为"全行扫一遍任一格出现过"。 */
      /* ⚠️ 只能写 `await ... .catch()`（Promise 的 catch），
         不能写 `JSON.parse(await ...).catch()` —— 那是对**已解析出来的数组**调 catch，
         必然 `TypeError: .catch is not a function`（v212 三跑就崩在这行，
         而且以前从没跑到过：上一版 S1-4 在 `if (anchor)` 里，锚定失败时整段不执行 ⇒ 缺陷被藏住了）。 */
      let otherProbe = [];
      try {
        otherProbe = JSON.parse(await p.evaluate(`(async () => {
          const seen = []
          const inputs = Array.from(document.querySelectorAll('.edit-tbl input.cell-qty[data-r]')).slice(0, 260)
          for (const el of inputs) {
            el.focus()
            await new Promise((r) => setTimeout(r, 0))
            const dl = document.getElementById('opt-qty')
            if (dl) Array.from(dl.querySelectorAll('option')).forEach((o) => { const l = o.getAttribute('label') || ''; if (l && seen.indexOf(l) < 0) seen.push(l) })
            if (seen.some((l) => l.indexOf('本期其它客户填') >= 0)) break
          }
          return JSON.stringify(seen.slice(-8))
        })()`));
      } catch (e) { otherProbe = []; }
      if (!Array.isArray(otherProbe)) otherProbe = [];
      ok('S1-4 候选里出现「本期其它客户填」（本地来源，不需要网络）',
        Array.isArray(otherProbe) && otherProbe.some((l) => l.indexOf('本期其它客户填') >= 0),
        JSON.stringify(otherProbe));
      ok('S1-5 候选数量克制（≤4 条：上期 1 条 + 常用值 3 条）', (g.opts || []).length <= 4, '条数=' + (g.opts || []).length);
      ok('S1-6 候选值是纯数字（可直接落格）', (g.opts || []).every((o) => /^\d+(\.\d+)?$/.test(String(o.v))), JSON.stringify((g.opts || []).map((o) => o.v)));
      ok('S1-7 option 带 label（下拉里显示"这条是什么"）', (g.opts || []).some((o) => String(o.l).length > 0));
    }
  }

  /* ============ S2. 单实例 + 强制重建（本批最大的性能地雷） ============ */
  console.log('\n########## S2. 候选下拉只有一份 + 换格强制重建 ##########');
  {
    /* ⚠️ 本段必须**自己**先聚焦一格，不依赖上一段是否锚定成功。
       否则一旦 S1 没点到任何格（`qtyOptKey` 仍是空串 ⇒ 下拉按 v-if 不渲染），
       这里量到的就是"全表没有下拉"，会把**上游取数失败**误报成"单实例/强制重建没做"
       （v212 首跑四连红正是这么来的）。每段自带前置，才谈得上"结论可归因"。 */
    const focusSeed = await p.evaluate(`(() => {
      const el = document.querySelector('.edit-tbl input.cell-qty[data-r]')
      if (!el) return JSON.stringify({ err: 'no qty input' })
      el.focus()
      return JSON.stringify({ r: Number(el.getAttribute('data-r')), c: Number(el.getAttribute('data-c')) })
    })()`);
    await sleep(320);
    console.log('  本段自聚焦: ' + focusSeed);
    const one = JSON.parse(await p.evaluate(`(() => {
      const tds = document.querySelectorAll('.edit-tbl tbody tr td.qty-cell').length
      const ins = document.querySelectorAll('.edit-tbl input.cell-qty[data-r]').length
      return JSON.stringify({
        nDatalist: document.querySelectorAll('datalist#opt-qty').length,
        nWithList: document.querySelectorAll('.edit-tbl input.cell-qty[list="opt-qty"]').length,
        nQtyInputs: ins, nQtyTds: tds,
      })
    })()`));
    console.log('  ' + JSON.stringify(one));
    /* 🔴 S2-1：判据是「**恰好一份**」。每格一份 ⇒ 3300 个 datalist / 上万 option 节点，
       点击展开直接卡死标签页（v211 商品名补全那条注释里实测过同类做法）。 */
    ok('S2-1 🔴 全表候选下拉**恰好一份**（数量格有 ' + one.nQtyInputs + ' 个，若每格一份就是上万节点）',
      one.nDatalist === 1, 'datalist#opt-qty = ' + one.nDatalist);
    /* 🔴 S2-2：只有**聚焦的那一格**才带 list ⇒ 否则多格共享一个内容会变的列表，互相看到对方的候选。 */
    ok('S2-2 🔴 只有聚焦的那一格带 list（不会多格共享同一个会变的列表）', one.nWithList === 1, '带 list 的格数=' + one.nWithList);

    /* S2-3：换格必须**销毁重建** datalist（:key=qtyOptKey）。
       ⚠️ 判据不能用"候选内容变了没有"（两格候选可能恰好相同 ⇒ 恒假红）。
          改用**打标记**这个与内容无关的判据：给当前节点打一个自定义属性，换格后它若消失，
          就证明 DOM 节点是**新建**的（这正是 `:key` 的效果）。 */
    const mark = JSON.parse(await p.evaluate(`(() => {
      const dl = document.getElementById('opt-qty')
      if (!dl) return JSON.stringify({ err: 'no datalist now' })
      dl.setAttribute('data-probe-mark', 'v212-' + Date.now())
      const inputs = Array.from(document.querySelectorAll('.edit-tbl input.cell-qty[data-r]'))
      const other = inputs.find((el) => el.getAttribute('list') !== 'opt-qty')
      if (!other) return JSON.stringify({ err: 'no other qty input' })
      other.focus()
      return JSON.stringify({ marked: true, nOptsBefore: dl.querySelectorAll('option').length })
    })()`));
    await sleep(260);
    const after = JSON.parse(await p.evaluate(`(() => {
      const dl = document.getElementById('opt-qty')
      return JSON.stringify({
        exists: !!dl,
        mark: dl ? dl.getAttribute('data-probe-mark') : null,
        nOpts: dl ? dl.querySelectorAll('option').length : -1,
      })
    })()`));
    console.log('  打标→换格: ' + JSON.stringify({ before: mark, after }));
    ok('S2-3a 前置：打标成功且换到了另一格', mark.marked === true, JSON.stringify(mark.err || mark));
    /* 🔴 S2-3：换格后标记**必须消失** —— 它证明节点被重建。若不重建，
       `input.list` 的惰性解析可能沿用旧候选 ⇒ 用户看到**上一格的数**（本设计唯一的真实风险点）。 */
    ok('S2-3 🔴 换格时 datalist 被**销毁重建**（标记消失 ⇒ 不会沿用上一格的候选）',
      after.exists === true && after.mark === null, JSON.stringify({ 标记还在吗: after.mark }));
    ok('S2-4 重建后仍只有一份', await p.evaluate(`document.querySelectorAll('datalist#opt-qty').length`) === 1);
    /* 把焦点还回锚定格，供后面的段使用 */
    await p.evaluate(`document.querySelector('.edit-tbl input.cell-qty[data-r]').focus()`);
    await sleep(200);
  }

  /* ============ S3. P2-2 软警告分级：疑漏订 / 疑超放量 ============ */
  console.log('\n########## S3. P2-2 软警告分级（黄=疑）##########');
  {
    /* 先说清"黄角标为什么现在该出现"：当前期（14）只有 36 件、上一期 12709 件 ⇒
       凡本期有量的行，其「上期有量、本期为 0」的客户列就该亮「疑漏订」。
       这是**可预期的**，不是碰运气。 */
    const scan = JSON.parse(await p.evaluate(`(() => {
      const rows = {}
      document.querySelectorAll('.edit-tbl input.cell-qty[data-r]').forEach((el) => {
        const r = Number(el.getAttribute('data-r'))
        rows[r] = rows[r] || { sum: 0, n: 0 }
        rows[r].sum += Number(el.value) || 0
        rows[r].n++
      })
      const dotRows = {}
      document.querySelectorAll('.edit-tbl td.qty-cell').forEach((td) => {
        if (td.querySelector('.cell-soft-dot')) {
          const r = Number(td.getAttribute('data-r'))
          dotRows[r] = (dotRows[r] || 0) + 1
        }
      })
      return JSON.stringify({
        nRowsWithData: Object.keys(rows).filter((r) => rows[r].sum > 0).length,
        rowsWithData: Object.keys(rows).filter((r) => rows[r].sum > 0).map(Number).slice(0, 8),
        nSoftDots: document.querySelectorAll('.cell-soft-dot').length,
        nSoftMiss: document.querySelectorAll('.cell-soft-dot.soft-miss').length,
        nSoftOver: document.querySelectorAll('.cell-soft-dot.soft-over').length,
        dotRows,
      })
    })()`));
    console.log('  本期有量的行: ' + JSON.stringify(scan.rowsWithData) + '   软角标: 共 ' + scan.nSoftDots + '（漏订 ' + scan.nSoftMiss + ' / 超放量 ' + scan.nSoftOver + '）');

    ok('S3-0 🔴 前置：本期网格里确实有行带量（否则"疑漏订"按设计不该亮，得不到可判结论）',
      scan.nRowsWithData > 0, '有量的行数=' + scan.nRowsWithData);
    /* 🔴 S3-1 是本批最核心的一条产品断言。 */
    ok('S3-1 🔴 出现「疑漏订」黄角标（上期该客户有量 · 本期 0 · 同行其它客户已报）', scan.nSoftMiss > 0, '漏订角标=' + scan.nSoftMiss);
    /* 🔴 S3-2：一进编辑态**不该**满屏黄。全表数量格数 vs 角标数，比例应远小于"每行每列都亮"。
       若漏订判据丢了「本行本期有量」这个前提，角标数会≈上一期有量的格子总数（上千）。 */
    const nQty = await p.evaluate(`document.querySelectorAll('.edit-tbl input.cell-qty[data-r]').length`);
    ok('S3-2 🔴 没有"一进编辑态满屏黄"（角标数远小于数量格总数，说明漏订判据带了行前提）',
      scan.nSoftDots < nQty * 0.35, JSON.stringify({ 软角标: scan.nSoftDots, 数量格: nQty, 占比: (scan.nSoftDots / nQty).toFixed(3) }));

    /* ---- 黄角标的几何 / 层级 / 交互 ---- */
    let missCell = null;
    const missDot = JSON.parse(await p.evaluate(`(() => {
      const td = Array.from(document.querySelectorAll('.edit-tbl td.qty-cell')).find((x) => x.querySelector('.cell-soft-dot.soft-miss'))
      if (!td) return JSON.stringify({ err: 'no soft-miss dot' })
      const el = td.querySelector('.cell-soft-dot.soft-miss')
      const tdR = td.getBoundingClientRect(), r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      return JSON.stringify({
        r: Number(td.getAttribute('data-r')), c: Number(td.getAttribute('data-c')),
        cls: el.className, title: el.getAttribute('title'), aria: el.getAttribute('aria-label'),
        dxRight: Math.round(tdR.right - r.right), dyTop: Math.round(r.top - tdR.top),
        zIndex: cs.zIndex, cursor: cs.cursor, color: cs.color, bg: cs.backgroundColor,
        hasIcon: !!el.querySelector('svg'),
      })
    })()`));
    if (!missDot.err) {
      missCell = { r: missDot.r, c: missDot.c };
      console.log('  漏订角标: ' + JSON.stringify({ r: missDot.r, c: missDot.c, title: missDot.title, cls: missDot.cls }));
      ok('S3-3 角标带可读原因（说明"上期多少、本期多少、可忽略"）',
        /疑漏订/.test(String(missDot.title)) && /上期|报了/.test(String(missDot.title)), JSON.stringify(missDot.title));
      ok('S3-4 角标有 aria-label（读屏可达）', String(missDot.aria || '').length > 0, JSON.stringify(missDot.aria));
      /* 🔴 S3-5：四角分配不许打架 —— 红角标左上、填充柄右下、软角标必须**右上**。 */
      ok('S3-5 🔴 软角标贴在**右上角**（左上=红角标 / 右下=填充柄，四角不打架）',
        missDot.dxRight <= 2 && missDot.dyTop <= 2, JSON.stringify({ dxRight: missDot.dxRight, dyTop: missDot.dyTop }));
      /* 🔴 S3-6：z-index 必须 < 6（粘性列是 6），否则横向滚动时它浮在冻结列上面。 */
      ok('S3-6 🔴 角标层级低于粘性列（避免滚动时浮在冻结列上方）', Number(missDot.zIndex) > 0 && Number(missDot.zIndex) < 6, 'z-index=' + missDot.zIndex);
      ok('S3-7 角标可点（手型 / 有图标）', missDot.cursor === 'pointer' && missDot.hasIcon === true, JSON.stringify({ cursor: missDot.cursor, icon: missDot.hasIcon }));
      /* 🔴 S3-8：实心档的文字色必须跟随主题（用 var(--bg)），不能写死 #fff ——
         深色主题下"浅琥珀底 + 白字"对比度 < 2:1，几乎看不见。 */
      const rgb = String(missDot.color).match(/rgba?\(([^)]+)\)/);
      const parts = rgb ? rgb[1].split(',').map((x) => parseFloat(x)) : [];
      const lum = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) };
      const L = (a) => 0.2126 * lum(a[0]) + 0.7152 * lum(a[1]) + 0.0722 * lum(a[2]);
      const bgRgb = String(missDot.bg).match(/rgba?\(([^)]+)\)/);
      const bgParts = bgRgb ? bgRgb[1].split(',').map((x) => parseFloat(x)) : [];
      let ratio = 0;
      if (parts.length >= 3 && bgParts.length >= 3) {
        const l1 = L(parts), l2 = L(bgParts);
        ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      }
      console.log('  实心档配色: 文字=' + missDot.color + '  底=' + missDot.bg + '  对比度=' + ratio.toFixed(2) + ':1');
      ok('S3-8 🔴 实心档文字与底色对比度 ≥ 3:1（跟随主题，不是写死 #fff）', ratio >= 3, ratio.toFixed(2) + ':1');

      /* 点角标 → 弹原因；且不能把选区带走（同 v211 的纪律） */
      const other = JSON.parse(await p.evaluate(`(() => {
        const td = Array.from(document.querySelectorAll('.edit-tbl td.qty-cell')).find((x) => !x.querySelector('.cell-soft-dot'))
        if (!td) return JSON.stringify({ err: 'no clean cell' })
        return JSON.stringify({ r: Number(td.getAttribute('data-r')), c: Number(td.getAttribute('data-c')) })
      })()`));
      let selBefore = null;
      if (!other.err) {
        const op = JSON.parse(await p.evaluate(jsPointOf(other.r, other.c)));
        if (op.hitIsSelf) { await p.mouse.click(op.x, op.y); await sleep(340); selBefore = JSON.parse(await p.evaluate(JS_SEL)); }
      }
      const dp = JSON.parse(await p.evaluate(jsDotPoint(missDot.r, missDot.c, '.cell-soft-dot')));
      ok('S3-9a 前置：角标此刻可见且命中测试命中它本身（否则点下去是空的，会以假红形式出现）',
        dp.hit === true && dp.inVp === true, JSON.stringify(dp));
      if (dp.hit) {
        await p.mouse.click(dp.x, dp.y);
        await sleep(320);
        const st = JSON.parse(await p.evaluate(JS_STATE));
        const selAfter = JSON.parse(await p.evaluate(JS_SEL));
        console.log('  点黄角标后: 提示=' + JSON.stringify(st.toast));
        ok('S3-9 🔴 点黄角标**弹出了疑点原因**（触屏唯一能读到原因的路 —— 悬停在触屏上不存在）',
          /疑漏订|疑超放量/.test(String(st.toast || '')), JSON.stringify(st.toast));
        ok('S3-10 🔴 点角标**没有把选区带走**（mousedown/click 拦截生效）',
          !!selBefore && JSON.stringify(selAfter.sel) === JSON.stringify(selBefore.sel),
          JSON.stringify({ 点前: selBefore && selBefore.sel, 点后: selAfter.sel }));
      }
    } else {
      ok('S3-3 角标带可读原因', false, '未找到漏订角标：' + missDot.err);
      ok('S3-5 软角标贴在右上角', false, missDot.err);
      ok('S3-6 角标层级低于粘性列', false, missDot.err);
      ok('S3-9 点黄角标弹出疑点原因', false, missDot.err);
      ok('S3-10 点角标没有把选区带走', false, missDot.err);
    }

    /* ---- 疑超放量：用锚定格手工造一个（本期 = 上期 × N 倍） ---- */
    /* 优先用 S1 锚定到的那一格：它的「上期值」是从接口拿到的**地面真值**，
       不必再从候选 label 里反推（反推失败就等于造不出超放量 ⇒ 假红）。
       锚不到时才退回"任取一个带值的格 + 读候选"。 */
    let anchorCell;
    let seedPrev = null;
    if (anchor) {
      anchorCell = { r: anchor.r, c: anchor.c };
      seedPrev = anchor.prevQty;
      /* 纵向滚到视野中间：jsPointOf 只保证横滚，远处的行不滚会点到屏幕外 */
      await p.evaluate(`(() => {
        const el = document.querySelector('.edit-tbl input.cell-qty[data-r="${anchor.r}"][data-c="${anchor.c}"]')
        if (el) el.scrollIntoView({ block: 'center', inline: 'nearest' })
      })()`);
      await sleep(300);
      console.log('  超放量取样：用 S1 锚定格（上期真值 ' + anchor.prevQty + '）');
    } else {
      /* 锚定失败时的退路：不再"随便挑一个带值的格" —— 那一格很可能压根没有上期数据，
         候选是空的，于是"造不出超放量"被误报成"超放量角标没做"。
         改为**在已知"上一期有量"的那几行里**逐格扫，找第一个候选带「上期 N」的格。 */
      const seed = JSON.parse(await p.evaluate(async (rows) => {
        for (const r of rows) {
          const ins = Array.from(document.querySelectorAll('.edit-tbl input.cell-qty[data-r="' + r + '"]'))
          for (const el of ins) {
            el.focus()
            await new Promise((k) => setTimeout(k, 12))
            const d = document.getElementById('opt-qty')
            if (!d) continue
            const o = Array.from(d.querySelectorAll('option'))
              .find((x) => /^上期 /.test(x.getAttribute('label') || ''))
            if (o) {
              return JSON.stringify({ r: Number(el.getAttribute('data-r')), c: Number(el.getAttribute('data-c')), label: o.getAttribute('label') })
            }
          }
        }
        return JSON.stringify({ err: '在"上期有量"的行里没扫到任何带「上期 N」候选的格' })
      }, anchorCands.map((x) => x.r)));
      if (seed.err) {
        anchorCell = { err: seed.err };
      } else {
        anchorCell = { r: seed.r, c: seed.c };
        seedPrev = PREV_LABEL_NUM(seed.label);
        console.log('  超放量取样（退路扫到）: r=' + seed.r + ' c=' + seed.c + ' label=' + seed.label);
      }
    }
    if (anchorCell.err) {
      /* 取不到样必须**显式**记红，不能让两条断言静默地不执行
         （静默跳过 = 报告里少两行，看起来"通过"，是最坏的一种绿）。 */
      ok('S3-11 出现「疑超放量」黄角标', false, '前置失败：' + anchorCell.err);
      ok('S3-12 改一格 → 黄角标出现 < 1500ms', false, '前置失败：' + anchorCell.err);
    }
    if (!anchorCell.err) {
      /* 先在该格聚焦读候选，拿一条「上期 N」，再填 N×10 造超放量 */
      const pt = JSON.parse(await p.evaluate(jsPointOf(anchorCell.r, anchorCell.c)));
      let prevN = seedPrev;   // 有锚定就用地面真值；只有退回分支才靠候选 label 反推
      if (pt.hitIsSelf) {
        await p.mouse.click(pt.x, pt.y);
        await sleep(200);
        const opts = JSON.parse(await p.evaluate(`(() => {
          const dl = document.getElementById('opt-qty')
          return JSON.stringify(dl ? Array.from(dl.querySelectorAll('option')).map((o) => ({ v: o.getAttribute('value'), l: o.getAttribute('label') || '' })) : [])
        })()`));
        const po = opts.find((o) => /^上期 /.test(o.l));
        if (po && prevN == null) prevN = PREV_LABEL_NUM(po.l);
        console.log('  造超放量用的上期值: ' + prevN + '   该格候选=' + JSON.stringify(opts.map((o) => o.l)));
      }
      if (prevN && prevN > 0) {
        const want = String(prevN * 10);
        const t0 = Date.now();
        await p.mouse.click(pt.x, pt.y);
        await sleep(150);
        await p.keyboard.type(want);
        /* 焦点必须移开才触发 change（原生 input 语义，v211 已踩过） */
        const away = JSON.parse(await p.evaluate(`(() => {
          const ins = Array.from(document.querySelectorAll('.edit-tbl input[data-r]'))
          const hit = ins.find((el) => Number(el.getAttribute('data-r')) !== ${anchorCell.r})
          if (!hit) return JSON.stringify({ err: 'no other input' })
          hit.scrollIntoView({ block: 'center', inline: 'nearest' })
          const rc = hit.getBoundingClientRect()
          return JSON.stringify({ x: Math.round(rc.left + rc.width / 2), y: Math.round(rc.top + rc.height / 2) })
        })()`));
        if (!away.err) { await p.mouse.click(away.x, away.y); }
        /* 轮询等黄角标出现，顺带量出"改一格 → 角标出现"的延迟（性能粗判据） */
        let appeared = false; let t1 = Date.now();
        for (let i = 0; i < 60; i++) {
          await sleep(50);
          const n = await p.evaluate(`document.querySelectorAll('.edit-tbl td[data-r="${anchorCell.r}"][data-c="${anchorCell.c}"] .cell-soft-dot.soft-over').length`);
          if (n > 0) { appeared = true; t1 = Date.now(); break; }
        }
        const latency = t1 - t0;
        console.log('  造超放量: 填入 ' + want + '（上期 ' + prevN + '）  角标出现=' + appeared + '  延迟=' + latency + 'ms');
        ok('S3-11 🔴 出现「疑超放量」黄角标（本格 ≥ 上期 × 倍数阈值）', appeared, JSON.stringify({ 填入: want, 上期: prevN }));
        /* ⚠️ 这是**粗判据**，不是精确性能基准：它包含两次点击 + 一次失焦 + change 派发 + Vue 补丁 + 轮询粒度(50ms)。
           作用只有一个 —— 若 softAt 退化成了逐格现算（9k 格 × O(客户数)），这里会从百毫秒级跳到秒级以上。 */
        ok('S3-12 改一格 → 黄角标出现 < 1500ms（软警告若退化成逐格现算，这里会明显变慢）', latency < 1500, latency + 'ms');
        const overTxt = JSON.parse(await p.evaluate(`(() => {
          const el = document.querySelector('.edit-tbl td[data-r="${anchorCell.r}"][data-c="${anchorCell.c}"] .cell-soft-dot.soft-over')
          return JSON.stringify({ title: el ? el.getAttribute('title') : null })
        })()`));
        ok('S3-13 超放量角标的文案说清"几倍"与"请确认"', /疑超放量/.test(String(overTxt.title)) && /倍/.test(String(overTxt.title)), JSON.stringify(overTxt.title));
        await p.screenshot({ path: SHOT_DIR + '/真机-软警告-疑漏订与疑超放量.png' }).catch(() => {});
        /* 收拾：改回 0，别把脏值留给后面的段 */
        await p.mouse.click(pt.x, pt.y); await sleep(150);
        await p.keyboard.type('0'); await sleep(200);
        await p.mouse.click(away.x, away.y).catch(() => {}); await sleep(400);
      } else {
        ok('S3-11 出现「疑超放量」黄角标', false, '未找到含「上期 N」的候选，无法造超放量（prevN=' + prevN + '）');
        ok('S3-12 改一格 → 黄角标出现 < 1500ms', false, '同上');
      }
    }
  }

  /* ============ S4. P2-3 选区批量填同值的可见入口 ============ */
  console.log('\n########## S4. P2-3 选区批量填同值（功能早在，缺的是"看得见"）##########');
  {
    /* 先点回退把状态清零（纯本地）—— 否则后面"改了之后状态变脏"这类断言在改前也是绿的（恒真）。 */
    const cleared = await p.evaluate(`(() => {
      const b = Array.from(document.querySelectorAll('button')).find((x) => /^回退$/.test(String(x.textContent).trim()))
      if (!b || b.disabled) return false
      b.click(); return true
    })()`);
    await sleep(700);
    console.log('  点回退: ' + cleared);

    /* 从单元格**空白边缝**起拖（记忆里的既有局限：从输入框上拖会进入原生文本选择、不派发 mouseover）。
       边缝来源：`table.tbl td{padding:10px 14px}` ⇒ td 左边缘 14px 是空的。 */
    /* 目标选择刻意收紧成「**连续 4 个格全是空白**」的那一行：
       ① 这正是「批量填入」最典型的用法（框一列空格 → 填同一个数），
          S4-19 / S4-20 要取证的正是这个场景；
       ② 也让 S4-7 / S4-8 的写入断言有干净起点 —— 原来是"哪一行有 0 就选哪一行"，
          起点里混着数字，断言的含义就不唯一了。 */
    const box = JSON.parse(await p.evaluate(`(() => {
      const byRow = {}
      document.querySelectorAll('.edit-tbl td.qty-cell[data-r]').forEach((td) => {
        const rc = td.getBoundingClientRect()
        if (!(rc.width > 10 && rc.top > 0 && rc.bottom < innerHeight)) return
        const r = Number(td.getAttribute('data-r'))
        ;(byRow[r] = byRow[r] || []).push(td)
      })
      const cands = Object.keys(byRow).map(Number).filter((r) => byRow[r].length >= 4).sort((a, b) => a - b)
      let pick = null
      for (const r of cands) {
        const us = byRow[r].slice(0, 4)
        const blank = us.every((td) => { const i = td.querySelector('input.cell-qty'); return !i || String(i.value).trim() === '' })
        if (blank) { pick = { r, us, allBlank: true }; break }
      }
      if (!pick && cands.length) { const r = cands[0]; pick = { r, us: byRow[r].slice(0, 4), allBlank: false } }
      if (!pick) return JSON.stringify({ err: 'no row with >=4 visible qty cells' })
      const f = pick.us[0], l = pick.us[3]
      const fr = f.getBoundingClientRect(), lr = l.getBoundingClientRect()
      return JSON.stringify({
        r: pick.r, allBlank: pick.allBlank,
        c0: Number(f.getAttribute('data-c')), c1: Number(l.getAttribute('data-c')),
        x0: Math.round(fr.left + 4), y0: Math.round(fr.top + fr.height / 2),
        x1: Math.round(lr.right - 4), y1: Math.round(lr.top + lr.height / 2),
      })
    })()`));
    console.log('  框选目标: ' + JSON.stringify(box));
    ok('S4-0 前置：找到可框选的连续数量格（4 格 × 1 行）', !box.err, JSON.stringify(box.err || { r: box.r, c0: box.c0, c1: box.c1 }));
    ok('S4-0b 前置：这一行 4 个格**本来都是空白**（S4-19 / S4-20 取"空选区"的前提）',
      box.err ? false : box.allBlank === true, JSON.stringify({ r: box.r, 全空: box.allBlank }));

    if (!box.err) {
      await p.mouse.move(box.x0, box.y0);
      await p.mouse.down();
      await p.mouse.move(box.x1, box.y1, { steps: 12 });
      await p.mouse.up();
      await sleep(500);
      const sel = JSON.parse(await p.evaluate(JS_SEL));
      console.log('  框选结果: ' + JSON.stringify(sel));
      /* ⚠️ 既有局限（非本轮回归）：从输入框**中间**拖不会形成选区（浏览器进入原生文本选择并捕获指针，
         期间不派发 mouseover）。因此这里必须从 td 的空白边缝（左/右 14px padding）起拖。 */
      ok('S4-1 前置：框选形成了矩形选区（从单元格空白边缝起拖）', sel.nRange >= 4, 'range-sel 格数=' + sel.nRange);

      /* ---- 可见入口①：表格底部「选区统计」条上的「批量填入」 ---- */
      const bar = JSON.parse(await p.evaluate(`(() => {
        const bar = document.querySelector('.sel-stat')
        const ipt = bar ? bar.querySelector('.sel-fill-ipt') : null
        const btn = bar ? bar.querySelector('.sel-fill-go') : null
        const rc = ipt ? ipt.getBoundingClientRect() : null
        const rb = btn ? btn.getBoundingClientRect() : null
        const rect = bar ? bar.getBoundingClientRect() : null
        const cs = bar ? getComputedStyle(bar) : null
        return JSON.stringify({
          hasBar: !!bar,
          hasIpt: !!ipt, hasBtn: !!btn,
          ph: ipt ? ipt.getAttribute('placeholder') : null,
          inputmode: ipt ? ipt.getAttribute('inputmode') : null,
          btnText: btn ? String(btn.textContent).trim() : null,
          btnDisabledWhenEmpty: btn ? btn.disabled : null,
          label: bar ? String((bar.querySelector('.sel-fill-label') || {}).textContent || '') : '',
          visible: !!(rc && rb && rc.width > 0 && rb.width > 0 && rb.top > 0 && rb.bottom < innerHeight),
          x: rc ? Math.round(rc.left + rc.width / 2) : 0, y: rc ? Math.round(rc.top + rc.height / 2) : 0,
          bx: rb ? Math.round(rb.left + rb.width / 2) : 0, by: rb ? Math.round(rb.top + rb.height / 2) : 0,
          /* 浮层几何：让开侧栏 + 贴住视口底部（这两条决定"看得见"是真看得见） */
          barLeft: rect ? Math.round(rect.left) : null, barWidth: rect ? Math.round(rect.width) : null,
          barBottomGap: rect ? Math.round(innerHeight - rect.bottom) : null,
          sidebarW: (() => { const v = getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w'); return parseFloat(v) || 0 })(),
          barPos: cs ? cs.position : null,
        })
      })()`));
      console.log('  选区统计条: ' + JSON.stringify(bar));
      /* 🔴 S4-2 是本批 P2-3 的核心：功能（Ctrl+Enter）自 Q17 就在，但**只活在快捷键里** ⇒
         不记快捷键的用户根本不知道它存在。判据 = 选区出现时界面上有**可见的**输入框 + 按钮。 */
      ok('S4-2 🔴 「批量填入」在选区统计条上**可见**（功能早就有，缺的就是这个入口）',
        bar.hasBar && bar.hasIpt && bar.hasBtn && bar.visible, JSON.stringify({ bar: bar.hasBar, ipt: bar.hasIpt, btn: bar.hasBtn, 可见: bar.visible }));
      ok('S4-3 输入框带 inputmode（触屏点它弹数字键盘，同数量格的理由）', bar.inputmode === 'numeric', JSON.stringify(bar.inputmode));
      /* 判据收紧成**数值相等**，不是"看起来有个数字"：
         占位符上的 N 必须等于实际选中的格数，否则用户按它判断影响范围就会被骗。 */
      ok('S4-4 🔴 占位符上的格数 = **实际选区格数**（用户点之前就知道会写入多少格）',
        String(bar.ph || '').trim() === sel.nRange + ' 格', JSON.stringify({ 占位符: bar.ph, 实际: sel.nRange + ' 格' }));
      ok('S4-5 空值时按钮禁用（留空点下去如果被当成"清空选区"，用户会在毫不知情下删掉一片）', bar.btnDisabledWhenEmpty === true, JSON.stringify({ disabled: bar.btnDisabledWhenEmpty }));
      ok('S4-6 有标签说明这是批量填入（不是只有一个裸输入框）', String(bar.label).indexOf('批量填入') >= 0, JSON.stringify(bar.label));
      /* 🔴 S4-21：它是 `position:fixed` 的浮层，所以必须同时满足两件事才算"看得见"：
         ① 左边缘**让开左侧栏**（否则盖在导航上）；
         ② 下边缘**贴住视口底部**（否则只是"碰巧在视口里"）。
         这两条是 v212 从 sticky 改 fixed 的**全部理由**（sticky 实测被包含块夹住、吸不动）。 */
      ok('S4-21 🔴 统计条是固定浮层：让开侧栏 + 贴住视口底部（sticky 在这里吸不动，实测过）',
        bar.barPos === 'fixed' && bar.barLeft >= bar.sidebarW - 2 && Math.abs(bar.barBottomGap) <= 2,
        JSON.stringify({ position: bar.barPos, 左边缘: bar.barLeft, 侧栏宽: bar.sidebarW, 距底: bar.barBottomGap }));

      /* 🔴 S4-19（v212 首跑真机抓到的**真缺陷**）：选区里**一个数字都没有**时，
         这条统计条也必须照常出现。
         理由：这正是「批量填入」最主要的用法 —— 一个客户这个月每种货都订 10 箱：
         **框选一列空格 → 输 10 → 填入**。原判据是 `v-if="selStats"`，
         而 `selStats` 在选区无数字时返回 null ⇒ 整条（连同刚做的入口）一起消失，
         而且**不报错、不出提示**（静默缺入口 —— 比报错更难发现，测试也最容易漏）。
         判据必须建在「选区面积 > 0」而不是「选区里有几个数字」上。 */
      const blankSel = JSON.parse(await p.evaluate(`(() => {
        const tds = Array.from(document.querySelectorAll('.edit-tbl td.range-sel'))
        const vals = tds.map((td) => { const i = td.querySelector('input.cell-qty'); return i ? String(i.value) : null })
        const bar = document.querySelector('.sel-stat')
        const txt = bar ? String(bar.textContent || '') : ''
        return JSON.stringify({ n: tds.length, vals, hasBar: !!bar,
          hasIpt: !!(bar && bar.querySelector('.sel-fill-ipt')),
          hasGo: !!(bar && bar.querySelector('.sel-fill-go')),
          fallback: bar ? String((bar.querySelector('.sel-stat-none') || {}).textContent || '').trim() : '',
          hasSumSpan: /求和/.test(txt) })
      })()`));
      console.log('  空选区统计条: ' + JSON.stringify(blankSel));
      const allBlank = (blankSel.vals || []).length > 0
        && (blankSel.vals || []).every((v) => v == null || String(v).trim() === '' || Number(v) === 0);
      ok('S4-19 🔴 选区**全是空格**时统计条与「批量填入」入口仍在（这正是批量填入最主要的用法；缺了＝功能在真正需要它的那一步消失）',
        allBlank && blankSel.hasBar === true && blankSel.hasIpt === true && blankSel.hasGo === true,
        JSON.stringify({ 全空: allBlank, 格数: blankSel.n, bar: blankSel.hasBar, ipt: blankSel.hasIpt, go: blankSel.hasGo }));
      /* 🔴 S4-20：实现里的规则是「**求和只在 sum !== 0 时显示**」——
         为什么需要这条规则：这一格的初值大量是 `0`（不是空串），于是若判据写成"选区里有没有数字"，
         就总能通过 ⇒ 恒显示「求和 0 / 平均 0」，对用户是纯噪音，还可能被读成"里面有数据"。
         ⚠️ 判据必须做成**等价关系**，不能自己猜"这选区里应不应该有数"：
            我第一版只扫了数量格（`.cell-qty`）就断定"全零或空"，但 `selStats` 还会统计
            选区内的**其它数值列**（加单 / 单价 / 计算列…）⇒ 前提本身是错的，会以假红形式出现。
            改成在 DOM 层直接比对：「界面上显示了求和」⟺「选区里真的存在非零数值」。
            两边都从同一个 DOM 取，才不会各算一套。 */
      const sumCheck = await p.evaluate(`(() => {
        const bar = document.querySelector('.sel-stat')
        const txt = bar ? String(bar.textContent || '') : ''
        /* 与 selStats 同口径地扫选区：范围内所有带 data-r/data-c 的数值输入框 */
        const ins = Array.from(document.querySelectorAll('.edit-tbl td.range-sel input[data-r][data-c]'))
        const vals = ins.map((el) => Number(el.value)).filter((n) => !isNaN(n))
        const anyNonZero = vals.some((n) => n !== 0)
        return JSON.stringify({ hasSum: /求和/.test(txt), hasAvg: /平均/.test(txt),
          hasCount: /共/.test(txt), nInputs: ins.length, anyNonZero,
          sample: vals.slice(0, 8) })
      })()`).then(JSON.parse);
      ok('S4-20 🔴 「显示求和/平均」⟺「选区里真的存在非零数值」（防恒显示"求和 0"：既噪音、又会被读成"里面有数据"）',
        sumCheck.hasSum === sumCheck.anyNonZero && sumCheck.hasAvg === sumCheck.anyNonZero && sumCheck.hasCount === true,
        JSON.stringify(sumCheck));

      /* 真填一次：输入 7 → 点「填入」→ 选区内应全部变成 7，且 toast 报的格数与选区一致 */
      if (bar.hasIpt) {
        await p.mouse.click(bar.x, bar.y);
        await sleep(200);
        await p.keyboard.type('7');
        await sleep(250);
        const ready = JSON.parse(await p.evaluate(`(() => {
          const btn = document.querySelector('.sel-stat .sel-fill-go')
          return JSON.stringify({ disabled: btn ? btn.disabled : null, val: (document.querySelector('.sel-stat .sel-fill-ipt') || {}).value })
        })()`));
        ok('S4-7 填了值之后按钮变为可用（不是死按钮）', ready.disabled === false, JSON.stringify(ready));
        /* 点「填入」**之前**先把选区内每个可编辑格的现值记下来。
           为什么必须记：提示文案该报的是「**实际写进去了几格**」，而选区里混着只读列
           （条码 / 规格 / 单位 / 厂家编码…，writeCellVal 会跳过它们）—— 只有做前后对比
           才知道真值。用选区面积当期望值是**错的**（v212 真机就抓到过这条：
           12 格的选区里只有 4 格是数量格，提示却报 12）。 */
        const beforeVals = JSON.parse(await p.evaluate(`(() => {
          const m = {}
          document.querySelectorAll('.edit-tbl td.range-sel input[data-r][data-c]').forEach((el) => {
            m[el.getAttribute('data-r') + '-' + el.getAttribute('data-c')] = String(el.value)
          })
          return JSON.stringify(m)
        })()`));
        await p.mouse.click(bar.bx, bar.by);
        await sleep(600);
        const res = JSON.parse(await p.evaluate(`(() => {
          const vals = Array.from(document.querySelectorAll('.edit-tbl td.range-sel input.cell-qty')).map((el) => String(el.value))
          const st = document.querySelector('.toast')
          const m = {}
          document.querySelectorAll('.edit-tbl td.range-sel input[data-r][data-c]').forEach((el) => {
            m[el.getAttribute('data-r') + '-' + el.getAttribute('data-c')] = String(el.value)
          })
          return JSON.stringify({ vals, toast: st ? String(st.textContent) : null,
            nRange: document.querySelectorAll('.edit-tbl td.range-sel').length, after: m })
        })()`));
        const changed = Object.keys(res.after || {}).filter((k) => beforeVals[k] !== res.after[k]).length;
        console.log('  填入后: ' + JSON.stringify({ vals: res.vals, toast: res.toast, nRange: res.nRange, 实际变化格数: changed, 可编辑格数: Object.keys(beforeVals).length }));
        ok('S4-8 🔴 选区内所有格都被写成了同一个值（走的是 Ctrl+Enter 那条已被生产验证的写入口）',
          res.vals.length >= 4 && res.vals.every((v) => Number(v) === 7), JSON.stringify(res.vals));
        /* 🔴 S4-9：提示必须报「**实际写入成功**的格数」，不能报选区面积。
           翻版就是 v184 在「清空」上修过的那个坑：报面积 ⇒ 用户以为漏填了 ⇒ 反复重试。
           判据用 DOM 前后对比求出的真值，不用任何"我推测应该写几格"。 */
        ok('S4-9 🔴 提示报的是**实际写入成功的格数**（不是选区面积；面积口径会让"12 格里只写进 4 格"看起来像漏填）',
          res.toast === '已批量写入 ' + changed + ' 个单元格' && changed <= res.nRange,
          JSON.stringify({ 提示: res.toast, 实际变化: changed, 选区面积: res.nRange, 选区内的可编辑格: Object.keys(beforeVals).length }));
        const stAfter = JSON.parse(await p.evaluate(JS_STATE));
        ok('S4-10 批量填入进了撤销栈（状态条变脏 + 回退可用）',
          stAfter.saveState.indexOf('未保存') >= 0 && stAfter.undoDisabled === false,
          JSON.stringify({ saveState: stAfter.saveState, undoDisabled: stAfter.undoDisabled }));
        await p.screenshot({ path: SHOT_DIR + '/真机-选区批量填入.png' }).catch(() => {});
        /* 收拾：撤销掉，别把脏值留给后面的段 */
        await p.evaluate(`(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => /^回退$/.test(String(x.textContent).trim())); if (b && !b.disabled) b.click() })()`);
        await sleep(600);
      }

      /* ---- 可见入口②：右键菜单 ---- */
      const cell = JSON.parse(await p.evaluate(`(() => {
        const td = document.querySelector('.edit-tbl td.range-sel')
        if (!td) return JSON.stringify({ err: 'no range-sel td' })
        const inp = td.querySelector('input.cell-qty')
        const rc = td.getBoundingClientRect()
        return JSON.stringify({ r: Number(td.getAttribute('data-r')), c: Number(td.getAttribute('data-c')),
          x: Math.round(rc.left + 4), y: Math.round(rc.top + rc.height / 2), hitQty: !!inp })
      })()`));
      if (!cell.err) {
        await p.mouse.click(cell.x, cell.y, { button: 'right' });
        await sleep(420);
        const menu = JSON.parse(await p.evaluate(`(() => {
          const m = document.querySelector('.ctx-menu')
          if (!m) return JSON.stringify({ err: 'no ctx menu' })
          const btns = Array.from(m.querySelectorAll('button')).map((b) => String(b.textContent).trim())
          return JSON.stringify({ n: btns.length, btns })
        })()`));
        console.log('  右键菜单项: ' + JSON.stringify((menu.btns || []).filter((t) => /批量填入|软警告|漏订|超放量|库存|清空|复制/.test(t))));
        ok('S4-11 🔴 右键菜单里有「批量填入相同值…」入口（Excel 用户的肌肉记忆路径）',
          (menu.btns || []).some((t) => t.indexOf('批量填入相同值') >= 0), JSON.stringify(menu.err || menu.btns));
        /* 软警告的两个分档开关 + 阈值输入（P2-2 的"配方可配、不写死"落点） */
        ok('S4-12 🔴 右键菜单里有「疑漏订角标」开关（软警告可单独关掉一类）',
          (menu.btns || []).some((t) => t.indexOf('疑漏订角标') >= 0), JSON.stringify((menu.btns || []).filter((t) => /漏订|超放量/.test(t))));
        ok('S4-13 🔴 右键菜单里有「疑超放量角标」开关', (menu.btns || []).some((t) => t.indexOf('疑超放量角标') >= 0));
        const ratio = JSON.parse(await p.evaluate(`(() => {
          const m = document.querySelector('.ctx-menu')
          const rows = m ? Array.from(m.querySelectorAll('.ctx-ipt-row')) : []
          const hit = rows.find((r) => /超放量倍数/.test(String(r.textContent)))
          const ipt = hit ? hit.querySelector('input') : null
          return JSON.stringify({ hasRow: !!hit, val: ipt ? ipt.value : null, type: ipt ? ipt.getAttribute('type') : null, min: ipt ? ipt.getAttribute('min') : null })
        })()`));
        ok('S4-14 🔴 倍数阈值可在界面里改（不写死在判据里 —— 经销商口味不同：3 倍就慌 vs 10 倍才算异常）',
          ratio.hasRow === true && ratio.type === 'number' && Number(ratio.val) >= 2, JSON.stringify(ratio));

        /* 点「批量填入相同值…」→ 应出现内联输入框（本菜单自己进入子模式，不是弹 window.prompt） */
        const idx = (menu.btns || []).findIndex((t) => t.indexOf('批量填入相同值') >= 0);
        if (idx >= 0) {
          await p.evaluate(`(() => {
            const m = document.querySelector('.ctx-menu')
            const b = Array.from(m.querySelectorAll('button')).find((x) => String(x.textContent).indexOf('批量填入相同值') >= 0)
            if (b) b.click()
          })()`);
          await sleep(400);
          /* ⚠️ 必须用**区分性**类名 `.ctx-ipt-fill`，不能用 `.ctx-ipt`：
               同一个菜单里还有一个 `ctx-ipt`（超放量倍数阈值），
               用 `.ctx-ipt` 会把阈值输入框误当成本子模式的输入框 ⇒ S4-18 恒假绿。
               顺带：`.ctx-ipt-unit` 也会被阈值行命中，所以格数也一起按本输入框的兄弟节点取。 */
          const sub = JSON.parse(await p.evaluate(`(() => {
            const m = document.querySelector('.ctx-menu')
            const ipt = m ? m.querySelector('.ctx-ipt-fill') : null
            const row = ipt ? ipt.closest('.ctx-ipt-row') : null
            const unit = row ? row.querySelector('.ctx-ipt-unit') : null
            const go = m ? Array.from(m.querySelectorAll('.ctx-ipt-actions button')).map((b) => String(b.textContent).trim()) : []
            return JSON.stringify({ hasIpt: !!ipt, ph: ipt ? ipt.getAttribute('placeholder') : null,
              focused: !!(ipt && document.activeElement === ipt), actions: go,
              unit: unit ? String(unit.textContent || '').trim() : '' })
          })()`));
          console.log('  子模式: ' + JSON.stringify(sub));
          ok('S4-15 🔴 点入口后出现**内联输入框**（不是 window.prompt —— prompt 会阻塞渲染线程、样式不可控、移动端体验差）',
            sub.hasIpt === true && sub.focused === true, JSON.stringify(sub));
          ok('S4-16 子模式显示会写入多少格（点之前就知道影响范围）', /\d+\s*格/.test(String(sub.unit || '')), JSON.stringify(sub.unit));
          ok('S4-17 子模式有「填入 / 取消」两个动作', (sub.actions || []).indexOf('填入') >= 0 && (sub.actions || []).indexOf('取消') >= 0, JSON.stringify(sub.actions));
          /* Esc 取消：菜单回到正常按钮列表（不做半截状态） */
          await p.keyboard.press('Escape');
          await sleep(400);
          const back = JSON.parse(await p.evaluate(`(() => {
            const m = document.querySelector('.ctx-menu')
            return JSON.stringify({ hasIpt: !!(m && m.querySelector('.ctx-ipt-fill')),
              hasActions: !!(m && m.querySelector('.ctx-ipt-actions')),
              hasEntry: !!(m && Array.from(m.querySelectorAll('button')).some((x) => String(x.textContent).indexOf('批量填入相同值') >= 0)) })
          })()`));
          ok('S4-18 🔴 按 Esc 退回菜单（不留在半截子模式里；且退回后入口按钮回来）',
            back.hasIpt === false && back.hasActions === false && back.hasEntry === true, JSON.stringify(back));
        } else {
          ok('S4-15 点入口后出现内联输入框', false, '菜单里没找到那个按钮');
        }
        await p.keyboard.press('Escape');
        await sleep(250);
        await p.mouse.click(5, 400);
        await sleep(300);
      } else {
        ok('S4-11 右键菜单里有「批量填入相同值…」入口', false, JSON.stringify(cell.err));
      }
    } else {
      ok('S4-1 框选形成了矩形选区', false, JSON.stringify(box.err));
      ok('S4-2 「批量填入」在选区统计条上可见', false, '框选未成立');
      ok('S4-8 选区内所有格都写成同一个值', false, '框选未成立');
    }
  }

  /* ============ S5. 回归：v211 第一批的标记物全在 ============ */
  console.log('\n########## S5. 回归 —— v211（补全 / 键盘 / 红角标）与 v210（两态模型）##########');
  {
    const reg = JSON.parse(await p.evaluate(`(() => {
      const g = (sel, attr) => { const el = document.querySelector(sel); return el ? el.getAttribute(attr) : null }
      const nDocs = document.querySelectorAll('datalist#opt-prodname').length
      const nameInp = document.querySelector('.edit-tbl input.cell-name[data-r]')
      return JSON.stringify({
        prodnameDatalist: nDocs,
        nameListAttr: nameInp ? nameInp.getAttribute('list') : null,
        qtyInputmode: g('.edit-tbl input.cell-qty[data-r]', 'inputmode'),
        priceInputmode: g('.edit-tbl input.cell-price[data-r]', 'inputmode'),
        errDots: document.querySelectorAll('.cell-err-dot').length,
        nFocusWithEvent: document.querySelectorAll('.edit-tbl input[data-r][data-c]').length,
      })
    })()`));
    console.log('  ' + JSON.stringify(reg));
    ok('S5-1 回归：商品名补全的 datalist 仍**只有一份**（v211）', reg.prodnameDatalist === 1, '份数=' + reg.prodnameDatalist);
    ok('S5-2 回归：商品名格仍指向它（v211）', reg.nameListAttr === 'opt-prodname', JSON.stringify(reg.nameListAttr));
    ok('S5-3 回归：数量格仍 inputmode=numeric（v211）', reg.qtyInputmode === 'numeric', JSON.stringify(reg.qtyInputmode));
    ok('S5-4 回归：单价格仍 inputmode=decimal（**不是** numeric，否则安卓小数点键消失）', reg.priceInputmode === 'decimal', JSON.stringify(reg.priceInputmode));

    /* v210 两态模型：单击 = 全选；第二次点击 = 进输入态（方向键放行给字内移动） */
    const two = await p.evaluate(`(async () => {
      const inp = document.querySelector('.edit-tbl input.cell-qty[data-r]')
      if (!inp) return JSON.stringify({ err: 'no qty input' })
      inp.blur()
      await new Promise((r) => setTimeout(r, 60))
      const ev = new FocusEvent('focus', { bubbles: false })
      inp.focus()
      return JSON.stringify({ isInput: inp.tagName === 'INPUT' })
    })()`);
    ok('S5-5 回归：数量格仍是可聚焦的 input（v210 两态模型的前提）', JSON.parse(two).isInput === true, String(two));
  }

  /* ============ S6. 零写入取证 / 运行期异常 ============ */
  console.log('\n########## S6. 零写入取证 / 运行期异常 ##########');
  console.log('  全程非 GET 的 /api/ 请求（' + writes.length + ' 条）: ' + JSON.stringify(writes.slice(0, 8)));
  const badWrite = writes.filter((w) => /save|matrix|bulk|upsert|import|execute|close|delete|create|remind|audit/i.test(w));
  ok('S6-1 🔴 全程没有任何写接口调用（含矩阵保存 / 批量 upsert / 导入执行）—— 这次冒烟对生产**零写入**',
    badWrite.length === 0, JSON.stringify(badWrite));
  ok('S6-2 无 console.error / pageerror', consoleErrs.length === 0, JSON.stringify(consoleErrs.slice(0, 3)));

  await b.close();
  console.log('\n==================================================');
  console.log(fail === 0 ? '✅ 全部通过：' + pass + ' 项断言' : '❌ ' + fail + ' 项失败 / 共 ' + (pass + fail) + ' 项');
  console.log('截图目录: ' + SHOT_DIR);
  process.exitCode = fail === 0 ? 0 : 1;
})().catch(async (e) => {
  /* 🔴 IIFE 未被 await ⇒ 内部抛错时"未接住的 rejection"也会在输出落盘前带走进程，
     症状是「退出码 0 + 日志 0 字节」，看起来完全像功能坏了（v211 踩过）。必须自己接住并打印栈。
     ⚠️ 还必须**自己关掉浏览器**：否则无头 Chromium 会一直吊住事件循环，
     进程**永不退出**。现象极具误导性 —— 日志停在中途、任务一直"运行中"，
     看起来像"卡在某一步"，其实是已经崩了（v212 三跑实测：日志停在 S1-3，任务跑了 4 分钟以上）。 */
  console.error('FATAL（未接住的异常）: ' + String(e && e.stack ? e.stack : e));
  try { if (BROWSER) await BROWSER.close(); } catch (e2) { /* 关不掉也不该再抛 */ }
  process.exitCode = 1;
});
