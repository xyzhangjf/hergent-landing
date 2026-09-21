// v211 真机验收：单元格输入体验 第一批（生产 hergent.cn）
//   ① 商品名称补全候选（数据源 = 全量商品主档）
//   ② 数量格 / 单价格的移动端数字键盘
//   ③ 触屏可读的错误原因（可点击角标）
//   ④ 顺带修好的缺陷：商品名改动现在要进撤销栈
//
// 🔴 绝不点「保存」：saveEdits() 没有「无改动就短路」分支 ⇒ 点下去就是真实生产写入 + 一条假日志。
//    本探针在编辑态内做交互取证（会在内存里改几个格子的值），最后**不保存**直接关浏览器；
//    另加 S5 段用请求日志取证「全程零写入」。
//
// 用法：
//   HG_TOKEN=<沙箱token> HG_TENANT=9997 HG_USER=sbx_v210 HG_PERIOD_MARK='v211沙箱期次-勿动' \
//   NODE_PATH=<ws>/node_modules node v211-input-ux-prod-probe.js
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + label + (extra !== undefined ? '  ' + extra : '')); }
  else { fail++; console.log('  ❌ ' + label + (extra !== undefined ? '  ' + extra : '')); }
}

/* 取「某格当下屏幕坐标」并先横滚到容器正中（照抄 v210：scrollIntoView 的 nearest 会被粘性列骗过）。 */
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
    inVp: rc.top >= 0 && rc.left >= 0 && rc.bottom <= innerHeight && rc.right <= innerWidth,
    topTag: top ? top.tagName : null, topCls: top ? top.className : null, hitIsSelf: top === el,
  })
})()`

/* 状态条 + 回退按钮（S4 用；v210 同款判据） */
const JS_STATE = `(() => {
  const b = Array.from(document.querySelectorAll('button')).find((x) => /^回退$/.test(String(x.textContent).trim()))
  const st = document.querySelector('.grid-ctl-row .save-state') || document.querySelector('.save-state')
  return JSON.stringify({ saveState: ((st || {}).textContent || '').trim(), undoDisabled: b ? b.disabled : null, undoFound: !!b, toast: (document.querySelector('.toast') || {}).textContent || null })
})()`

/* 当前「选中格」是谁（r,c）+ 选区格数。用于证明「点角标没有把选区带走」。 */
const JS_SEL = `(() => {
  const td = document.querySelector('.edit-tbl td.selected')
  return JSON.stringify({
    sel: td ? [Number(td.getAttribute('data-r')), Number(td.getAttribute('data-c'))] : null,
    nRange: document.querySelectorAll('.range-sel').length,
    activeIsInput: !!(document.activeElement && document.activeElement.tagName === 'INPUT' && document.activeElement.hasAttribute('data-r')),
  })
})()`

/* 角标的**当下**坐标 + 命中测试。
   ⚠️ 必须"用时再取"而不是复用早先算好的坐标：中间的 jsPointOf 会把表格横滚到别处，
   旧坐标随即失效 —— 拿过期坐标去点就是点空，而表现是"点了没反应"，会被误读成功能坏了（v210 踩过）。 */
const jsDotPoint = (r, c) => `(() => {
  const td = document.querySelector('.edit-tbl td[data-r="${r}"][data-c="${c}"]')
  const el = td ? td.querySelector('.cell-err-dot') : null
  if (!el) return JSON.stringify({ err: 'no dot at ${r},${c}' })
  const rc = el.getBoundingClientRect()
  const x = Math.round(rc.left + rc.width / 2), y = Math.round(rc.top + rc.height / 2)
  const top = document.elementFromPoint(x, y)
  /* ⚠️ 命中判据必须是 contains，不能用 ===：角标里包着 <Icon>（一个 svg），
     点它中心命中的是**那个 svg 子元素** ⇒ 用 === 比较会假红（本轮实测踩到，白红一次）。
     顺带：svg 元素的 className 不是字符串（是 SVGAnimatedString），别拿它拼标签。 */
  const hit = !!top && (top === el || el.contains(top))
  return JSON.stringify({ x, y, hit, topTag: top ? top.tagName : null,
    inVp: rc.top >= 0 && rc.left >= 0 && rc.bottom <= innerHeight && rc.right <= innerWidth })
})()`

console.log('BOOT-3: 顶层执行到 IIFE 之前');
(async () => {
  console.log('BOOT-4: 已进入 IIFE');
  /* ⚠️ 显式失败：截图目录建不出来时**必须自己把话说清楚**。
     本轮实测踩到：目录不存在 ⇒ 这一步抛错，而现象竟然是「退出码 0 + 日志 0 字节」——
     看着完全像功能坏了，实际只是日志没落盘（stdout 未 flush 与未接住的 rejection 双重作用）。
     一个前置条件失败却表现成"什么都没发生"，是最难查的一类问题。 */
  try {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
  } catch (e) {
    console.error('FATAL: 截图目录无法创建 —— ' + SHOT_DIR + ' —— ' + String(e && e.message));
    process.exitCode = 1;
    return;
  }
  console.log('BOOT-5: 截图目录已就绪');
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
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

  if (SANDBOX_TOKEN && SANDBOX_TENANT) {
    console.log('\n########## 取景：隔离沙箱租户 ' + SANDBOX_TENANT + ' ##########');
    await p.evaluate((tok, tid, uname) => {
      localStorage.setItem('hergent_v2_token', tok);
      localStorage.setItem('hergent_v2_tenant', String(tid));
      localStorage.setItem('hergent_v2_user', JSON.stringify({ id: 0, username: uname, display_name: '沙箱验证账号', role: 'boss' }));
    }, SANDBOX_TOKEN, SANDBOX_TENANT, SANDBOX_USER);
    await p.goto('https://hergent.cn/?cb=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(2600);
  } else {
    await p.evaluate(() => { const el = Array.from(document.querySelectorAll('button,a')).find((x) => /演示/.test(x.textContent)); el && el.click(); });
    await sleep(3200);
  }
  await p.evaluate(() => { const el = Array.from(document.querySelectorAll('a')).find((x) => x.getAttribute('href') === '#/forecast'); el && el.click(); });
  await sleep(4200);

  /* 🔴 安全断言：证明「我确实在沙箱里」。会敲键盘改数据的探针，绝不允许在身份未确认时继续跑。
     判据 = 沙箱专属标记期次名出现在期次下拉里（下拉内容完全由后端按当前租户下发），
     必须在**已进入 #/forecast 之后**读（放在切页之前读不到 ⇒ 假红）。 */
  if (SANDBOX_TOKEN && SANDBOX_TENANT) {
    const opts = JSON.parse(await p.evaluate(`(() => {
      const sel = document.querySelector('.sel-period')
      return JSON.stringify(sel ? Array.from(sel.options).map((o) => o.text) : [])
    })()`))
    const markHit = PERIOD_MARK ? opts.some((t) => String(t).indexOf(PERIOD_MARK) >= 0) : false
    console.log('  期次下拉: ' + JSON.stringify(opts) + '   标记「' + PERIOD_MARK + '」命中: ' + markHit)
    ok('S-1 🔴 期次下拉里出现**沙箱专属标记期次**（证明后端认的是沙箱，不是真实租户）', markHit, JSON.stringify({ want: PERIOD_MARK }))
  }

  const picked = await p.evaluate((mark) => {
    const sel = document.querySelector('.sel-period');
    if (!sel) return null;
    const opts = Array.from(sel.options).filter((o) => o.value && o.value !== '0');
    const opt = (mark && opts.find((o) => String(o.text).indexOf(mark) >= 0)) || opts[0];
    if (!opt) return null;
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return opt.text;
  }, PERIOD_MARK);
  await sleep(3400);
  ok('S-2 🔴 拿到了一个**进行中的期次**（编辑网格的前提）', !!picked, JSON.stringify(picked));

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
  }

  /* ============ S1. ① 商品名称补全 ============ */
  console.log('\n########## S1. ① 商品名称补全候选（数据源=全量商品主档）##########');
  {
    const d = JSON.parse(await p.evaluate(`(() => {
      const dl = document.getElementById('opt-prodname')
      const input = document.querySelector('.edit-tbl input.cell-name[data-r]')
      const opts = dl ? Array.from(dl.querySelectorAll('option')) : []
      return JSON.stringify({
        hasDl: !!dl,
        nDatalists: document.querySelectorAll('datalist#opt-prodname').length,
        nOpts: opts.length,
        sample: opts.slice(0, 3).map((o) => o.getAttribute('value')),
        labelOfFirst: opts[0] ? (opts[0].getAttribute('label') || '') : '',
        listAttr: input ? input.getAttribute('list') : null,
        nNameInputs: document.querySelectorAll('.edit-tbl input.cell-name[data-r]').length,
        nQtyInputs: document.querySelectorAll('.edit-tbl input.cell-qty[data-r]').length,
      })
    })()`));
    console.log('  datalist: ' + JSON.stringify({ n: d.nOpts, 首三条: d.sample, 首条label: d.labelOfFirst }));
    ok('S1-1 商品名补全的 datalist 已渲染', d.hasDl === true);
    ok('S1-2 🔴 全表只渲染**一份** datalist（防每行重复 id + 海量节点）', d.nDatalists === 1, '份数=' + d.nDatalists);
    ok('S1-3 商品名输入框确实指向它（list 属性）', d.listAttr === 'opt-prodname', JSON.stringify(d.listAttr));
    /* 🔴 S1-4 是**判据**而非"够大就行"：候选必须明显多于本期行数 ——
       如果候选其实只装了"本期那 158 行"，nOpts 会≈行数，那样"补全"就补不出档案里其他商品。 */
    ok('S1-4 🔴 候选来自**全量主档**（数量明显多于本期行数，不是只把当前表格抄一份）',
      d.nOpts > d.nNameInputs * 1.5, JSON.stringify({ 候选数: d.nOpts, 本期行数: d.nNameInputs }));
    ok('S1-5 候选值是商品名', typeof d.sample[0] === 'string' && d.sample[0].length > 3, JSON.stringify(d.sample));
    ok('S1-6 候选带规格说明（同名的不同规格可在下拉里区分）',
      d.labelOfFirst === '' || d.labelOfFirst.indexOf('·') >= 0, JSON.stringify(d.labelOfFirst));
  }

  /* ============ S2. ② 移动端数字键盘 ============ */
  console.log('\n########## S2. ② 移动端数字键盘（触屏点格子直接弹数字键盘）##########');
  {
    const m = JSON.parse(await p.evaluate(`(() => {
      const g = (sel) => { const el = document.querySelector(sel); return el ? el.getAttribute('inputmode') : null }
      const numCols = Array.from(document.querySelectorAll('.edit-tbl input.cell-num[data-r]'))
      const qty = Array.from(document.querySelectorAll('.edit-tbl input.cell-qty[data-r]'))
      return JSON.stringify({
        qty: g('.edit-tbl input.cell-qty[data-r]'),
        price: g('.edit-tbl input.cell-price[data-r]'),
        name: g('.edit-tbl input.cell-name[data-r]'),
        nQty: qty.length,
        nQtyNumeric: qty.filter((e) => e.getAttribute('inputmode') === 'numeric').length,
        nNumCol: numCols.length,
        numColModes: Array.from(new Set(numCols.map((e) => e.getAttribute('inputmode')))),
      })
    })()`));
    console.log('  ' + JSON.stringify(m));
    ok('S2-1 数量格 inputmode = numeric', m.qty === 'numeric', JSON.stringify(m.qty));
    /* 🔴 S2-2 判据是"两件事"：有 inputmode，且**不是** numeric。单价是两位小数，
       numeric 会让安卓上的小数点键消失 ⇒ 用户永远填不了小数价。 */
    ok('S2-2 🔴 单价格 inputmode = decimal（不能是 numeric，否则小数点键消失）', m.price === 'decimal', JSON.stringify(m.price));
    ok('S2-3 文本格不需要数字键盘（不该被误加）', m.name === null, JSON.stringify(m.name));
    ok('S2-4 🔴 **全部**数量格都加上了（不是只加了一列）', m.nQty > 20 && m.nQtyNumeric === m.nQty,
      JSON.stringify({ 数量格: m.nQty, 已加: m.nQtyNumeric }));
    ok('S2-5 主档数字列按「该列是否整数」给键盘（取值只能是 numeric/decimal）',
      m.nNumCol > 0 && m.numColModes.every((x) => x === 'numeric' || x === 'decimal'), JSON.stringify(m.numColModes));
  }

  /* ============ S3. ③ 触屏可读的错误原因 ============ */
  console.log('\n########## S3. ③ 触屏可读的错误原因（点角标看原因）##########');
  {
    /* 造一个真实错误：在某数量格输入超过上限的值（QTY_MAX=999999）⇒ cellErrMsg 返回「数量过大」。 */
    const q = JSON.parse(await p.evaluate(`(() => {
      const ins = Array.from(document.querySelectorAll('.edit-tbl input.cell-qty[data-r]'))
      const hit = ins.find((el) => { const v = String(el.value || '').trim(); return v !== '' && Number(v) > 0 })
      if (!hit) return JSON.stringify({ err: 'no non-empty qty cell', n: ins.length })
      const rc = hit.getBoundingClientRect()
      return JSON.stringify({ r: Number(hit.getAttribute('data-r')), c: Number(hit.getAttribute('data-c')), val: String(hit.value), n: ins.length,
        x: Math.round(rc.left + rc.width / 2), y: Math.round(rc.top + rc.height / 2) })
    })()`));
    ok('S3-0 前置：找到一个非空数量格（否则下面无格可造错）', !q.err, JSON.stringify(q.err || ({ r: q.r, c: q.c, val: q.val })));

    const pt = JSON.parse(await p.evaluate(jsPointOf(q.r, q.c)));
    console.log('  目标格坐标: ' + JSON.stringify(pt));
    ok('S3-1 前置：目标格可见、可点、且命中测试命中输入框', pt.visible === true && pt.hitIsSelf === true, JSON.stringify({ hit: pt.hitIsSelf, top: pt.topCls }));

    if (pt.hitIsSelf) {
      await p.mouse.click(pt.x, pt.y);          /* 导航态：单击 = 全选内容 */
      await sleep(300);
      await p.keyboard.type('99999999');        /* 超上限 ⇒ 制造一个确定的错误 */
      await sleep(900);

      const dot = JSON.parse(await p.evaluate(`(() => {
        const td = document.querySelector('.edit-tbl td[data-r="${q.r}"][data-c="${q.c}"]')
        if (!td) return JSON.stringify({ err: 'no td' })
        const el = td.querySelector('.cell-err-dot')
        const tdR = td.getBoundingClientRect()
        if (!el) return JSON.stringify({ has: false, tdTitle: td.getAttribute('title'), invalid: td.classList.contains('invalid') })
        const r = el.getBoundingClientRect()
        const top = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2))
        const cs = getComputedStyle(el)
        return JSON.stringify({
          has: true,
          title: el.getAttribute('title'),
          tdTitle: td.getAttribute('title'),
          invalid: td.classList.contains('invalid'),
          /* 位置：角标应贴在格的**左上角**（右中是徽标、右下是填充柄） */
          dxLeft: Math.round(r.left - tdR.left), dyTop: Math.round(r.top - tdR.top),
          zIndex: cs.zIndex, cursor: cs.cursor,
          dotHit: !!top && (top === el || el.contains(top)), dotTag: top ? top.tagName : null,
          x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
        })
      })()`));
      console.log('  角标: ' + JSON.stringify(dot));
      ok('S3-2 出错格上出现了**可见的错误角标**', dot.has === true, JSON.stringify({ has: dot.has }));
      ok('S3-3 角标带错误原因（触屏可读的那份文案）', /数量过大/.test(String(dot.title || '')), JSON.stringify(dot.title));
      ok('S3-4 角标用的是与 td 相同的判据（title 一致）', String(dot.title || '') === String(dot.tdTitle || ''), JSON.stringify({ dot: dot.title, td: dot.tdTitle }));
      ok('S3-5 🔴 角标贴在**左上角**（不与徽标/填充柄抢位）', dot.dxLeft <= 2 && dot.dyTop <= 2, JSON.stringify({ dx: dot.dxLeft, dy: dot.dyTop }));
      /* 🔴 S3-6：角标层级必须低于粘性列（6）—— 否则横向滚动时它会浮在冻结列上面。 */
      ok('S3-6 🔴 角标层级低于粘性列（避免滚动时浮在冻结列上方）', Number(dot.zIndex) > 0 && Number(dot.zIndex) < 6, 'z-index=' + dot.zIndex);
      ok('S3-7 角标可点（鼠标样式为手型 / 且有尺寸）', dot.dotHit === true || dot.cursor === 'pointer', JSON.stringify({ hit: dot.dotHit, cursor: dot.cursor }));

      if (dot.has) {
        /* 🔴 S3-9 的前置动作：先把选中**移到另一格**去。
           不移的话「点角标后选中格仍是出错格」恒真（出错格本来就被选中）——
           那样这条断言根本测不出「点角标是否顺带改了选区」，属于自欺。 */
        const other = JSON.parse(await p.evaluate(`(() => {
          const ins = Array.from(document.querySelectorAll('.edit-tbl input.cell-qty[data-r]'))
          const hit = ins.find((el) => Number(el.getAttribute('data-r')) !== ${q.r} || Number(el.getAttribute('data-c')) !== ${q.c})
          if (!hit) return JSON.stringify({ err: 'no other qty cell' })
          const rc = hit.getBoundingClientRect()
          return JSON.stringify({ r: Number(hit.getAttribute('data-r')), c: Number(hit.getAttribute('data-c')) })
        })()`));
        const op = other.err ? { hitIsSelf: false } : JSON.parse(await p.evaluate(jsPointOf(other.r, other.c)));
        let selBefore = null;
        if (op.hitIsSelf) {
          await p.mouse.click(op.x, op.y);
          await sleep(340);
          selBefore = JSON.parse(await p.evaluate(JS_SEL));
        }
        console.log('  移开焦点后选中: ' + JSON.stringify(selBefore ? selBefore.sel : null));

        /* ⚠️ 角标坐标**此刻重取** —— 上面那次移动会把表格横滚，早先的坐标已经过期。 */
        const dp = JSON.parse(await p.evaluate(jsDotPoint(q.r, q.c)));
        console.log('  角标当下坐标: ' + JSON.stringify(dp));
        ok('S3-8a 前置：角标此刻可见且命中测试命中它本身（否则点下去是空的，会以假红形式出现）',
          dp.hit === true && dp.inVp === true, JSON.stringify(dp));

        const before = JSON.parse(await p.evaluate(JS_STATE));
        await p.mouse.click(dp.x, dp.y);
        await sleep(280);
        const after = JSON.parse(await p.evaluate(JS_STATE));
        const selAfter = JSON.parse(await p.evaluate(JS_SEL));
        console.log('  点角标后: 提示条=' + JSON.stringify(after.toast) + '  选中=' + JSON.stringify(selAfter.sel));
        ok('S3-8 🔴 点角标**弹出了错误原因**（触屏唯一能读到原因的路）', /数量过大/.test(String(after.toast || '')), JSON.stringify(after.toast));
        /* 🔴 S3-9：判据是「选中格没有变成出错的那一格」。
           少了 mousedown 拦截，td 的 onCellDown 会先接走这次按下（选中该格 / 起拖框选）
           ⇒ 用户只是看一眼原因，选区却被带走了。 */
        ok('S3-9 🔴 点角标**没有把选区带走**（mousedown/click 拦截生效）',
          !!selBefore && JSON.stringify(selAfter.sel) === JSON.stringify(selBefore.sel),
          JSON.stringify({ 点前选中: selBefore && selBefore.sel, 点后选中: selAfter.sel, 出错格: [q.r, q.c] }));
        ok('S3-10 点角标也不改动数据（状态条不变）', after.saveState === before.saveState,
          JSON.stringify({ before: before.saveState, after: after.saveState }));

        await p.screenshot({ path: SHOT_DIR + '/真机-错误角标-点开看原因.png' }).catch(() => {});
      }

      /* 收拾：把这一格改回 0，避免把脏值留给后面的段 */
      await p.mouse.click(pt.x, pt.y);
      await sleep(250);
      await p.keyboard.type('0');
      await sleep(700);
    }
  }

  /* ============ S4. ④ 本批顺带修好的缺陷：商品名改动要进撤销栈 ============ */
  console.log('\n########## S4. ④ 商品名改动进撤销栈（改前会红：这一格原本没有变更钩子）##########');
  {
    /* 前置：先点「回退」把状态清零（纯本地、不发请求）——
       不先清零的话，"改一格之后状态变脏"这条断言在改前也是绿的（恒真），等于没测。v210 踩过。 */
    const cleared = await p.evaluate(`(() => {
      const b = Array.from(document.querySelectorAll('button')).find((x) => /^回退$/.test(String(x.textContent).trim()))
      if (!b || b.disabled) return false
      b.click(); return true
    })()`);
    await sleep(800);
    const st0 = JSON.parse(await p.evaluate(JS_STATE));
    console.log('  点回退: ' + cleared + '   ' + JSON.stringify(st0));
    ok('S4-0a 前置：点「回退」后状态条回到干净态（不清零的话下面那条恒真、等于没测）',
      st0.saveState.indexOf('尚未修改') >= 0 || st0.saveState.indexOf('没有') >= 0 || st0.undoDisabled === true,
      JSON.stringify(st0.saveState));

    const t = JSON.parse(await p.evaluate(`(() => {
      const ins = Array.from(document.querySelectorAll('.edit-tbl input.cell-name[data-r]'))
      const hit = ins.find((el) => String(el.value || '').trim().length >= 4)
      if (!hit) return JSON.stringify({ err: 'no name cell' })
      const rc = hit.getBoundingClientRect()
      return JSON.stringify({ r: Number(hit.getAttribute('data-r')), c: Number(hit.getAttribute('data-c')), val: String(hit.value),
        x: Math.round(rc.left + rc.width / 2), y: Math.round(rc.top + rc.height / 2) })
    })()`));
    const tp = t.err ? { hitIsSelf: false } : JSON.parse(await p.evaluate(jsPointOf(t.r, t.c)));
    ok('S4-0b 前置：目标商品名格可见、且命中输入框', !t.err && tp.hitIsSelf === true, JSON.stringify({ r: t.r, hit: tp.hitIsSelf, top: tp.topCls }));

    if (!t.err && tp.hitIsSelf) {
      await p.mouse.click(tp.x, tp.y);
      await sleep(300);
      await p.keyboard.type('X');       /* 导航态 ⇒ 全选后被整体替换成 "X" */
      await sleep(700);
      /* 🔴 必须**先把焦点移走**再读状态条：原生 <input> 的 change 事件是**失焦（或回车）时**才触发的，
         光标还留在格子里时当然不会登记 —— 这是浏览器语义，不是缺陷（数量格同理）。
         本轮首次跑就漏了这一步，读到「尚未修改」而差点误判成"修复没生效"（假红）。
         ⚠️ 移焦点必须点到**另一个**格：点回原格只会重新全选，焦点压根没走。 */
      const away = JSON.parse(await p.evaluate(`(() => {
        const ins = Array.from(document.querySelectorAll('.edit-tbl input[data-r]'))
        const hit = ins.find((el) => Number(el.getAttribute('data-r')) !== ${t.r} || Number(el.getAttribute('data-c')) !== ${t.c})
        if (!hit) return JSON.stringify({ err: 'no other input' })
        if (hit.scrollIntoView) hit.scrollIntoView({ block: 'center', inline: 'nearest' })
        const rc = hit.getBoundingClientRect()
        return JSON.stringify({ x: Math.round(rc.left + rc.width / 2), y: Math.round(rc.top + rc.height / 2) })
      })()`));
      if (!away.err) { await p.mouse.click(away.x, away.y); await sleep(800); }
      const st1 = JSON.parse(await p.evaluate(JS_STATE));
      const nowVal = await p.evaluate(`(() => {
        const el = document.querySelector('.edit-tbl input.cell-name[data-r="${t.r}"][data-c="${t.c}"]')
        return el ? String(el.value) : null
      })()`);
      console.log('  改后: ' + JSON.stringify({ val: nowVal, saveState: st1.saveState, undoDisabled: st1.undoDisabled }));
      ok('S4-1 🔴 改了**商品名**之后状态条变「有未保存的改动」+ 回退可用（改前这一格没有变更钩子 ⇒ 改动不登记）',
        st1.saveState.indexOf('未保存') >= 0 && st1.undoDisabled === false,
        JSON.stringify({ saveState: st1.saveState, undoDisabled: st1.undoDisabled }));
      await p.screenshot({ path: SHOT_DIR + '/真机-编辑网格-补全与角标.png' }).catch(() => {});
    }
  }

  /* ============ S5. 零写入取证 / 运行期异常 ============ */
  console.log('\n########## S5. 零写入取证 / 运行期异常 ##########');
  console.log('  全程非 GET 的 /api/ 请求（' + writes.length + ' 条）: ' + JSON.stringify(writes.slice(0, 6)));
  const badWrite = writes.filter((w) => /save|matrix|bulk|upsert|import|execute|close|delete|create/i.test(w));
  ok('S5-1 🔴 全程没有任何写接口调用（含矩阵保存 / 批量 upsert / 导入执行）—— 这次冒烟对生产**零写入**',
    badWrite.length === 0, JSON.stringify(badWrite));
  ok('S5-2 无 console.error / pageerror', consoleErrs.length === 0, JSON.stringify(consoleErrs.slice(0, 3)));

  await b.close();
  console.log('\n==================================================');
  console.log(fail === 0 ? '✅ 全部通过：' + pass + ' 项断言' : '❌ ' + fail + ' 项失败 / 共 ' + (pass + fail) + ' 项');
  console.log('截图目录: ' + SHOT_DIR);
  /* 🔴 这里**不能用 `process.exit()`**：stdout 重定向到文件/管道时是**异步写**的，
     `process.exit()` 会立刻杀进程、把还没 flush 的输出整段丢掉 ——
     症状是「退出码 0、日志 0 字节」，看起来完全像"功能坏了"，实际只是日志没了（本轮实测踩到）。
     改用 `process.exitCode`，让 Node 在所有 stdout 落盘后自然退出。 */
  process.exitCode = fail === 0 ? 0 : 1;
})().catch((e) => {
  /* 🔴 同样必须显式接住：IIFE 是"发射后不管"的，未接住的 rejection 一样会在
     stdout flush 之前把进程带走 ⇒ 又变成"零输出 + 看不出哪里错"。兜住它，把栈打出来。 */
  console.error('FATAL: 探针异常终止 —— ' + (e && e.stack ? e.stack : String(e)));
  process.exitCode = 1;
});
