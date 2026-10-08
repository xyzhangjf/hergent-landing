/**
 * v400 「列设置入口 + 序号列」只读真机探针（生产 https://hergent.cn）
 *
 * 要回答的问题（老板原话）：
 *   「重点确认列设置和序号的具体实现方式：列设置是否使用 ⚙️ 图标作为触发按钮，
 *     序号是否放置在 ⚙️ 按钮下方。」
 *
 * 🔴 先把问题拆成**可量测的几何 + 可判真假的 DOM 事实**（不靠读代码后的印象）：
 *   ① 齿轮**在哪**：必须是**表头第一列（序号列）**里唯一的按钮，且只在第一列
 *      （其他列的表头不许有齿轮 —— 用「第 2 列没有齿轮」做反例）。
 *   ② 齿轮**长什么样**：`<button class="col-cfg gear" title="列设置">` +
 *      **`<Icon name="settings"/>` 渲染出的 SVG**（Lucide 线性齿轮，2 段 path）。
 *      ⚠️ 关键辨析：这是**线性图标组件**，**不是 emoji `⚙️`（U+2699 / U+FE0F）**。
 *         用 textContent 里查 U+2699/U+FE0F 来证伪「是 emoji」。
 *   ③ 序号**在哪**：表体**同一列**里的 `.seq-num`。判据是几何三连：
 *      同列（|齿轮中心 x − 序号中心 x| ≤ 2px）、在下方（序号 top > 齿轮 bottom）、
 *      **垂直区间不相交**（否则可能量到了同一行 ⇒ 判据没意义）。
 *
 * 🔴 判别力自证（缺一不可，否则"跑通了"没有意义）：
 *   ① 同轮必须量到**两组宽度悬殊**的列：序号列 ≈46px vs 紧随其后的数据列 >100px。
 *      两组一样宽 ⇒ 列没量对（选错元素），脚本主动 FAIL。
 *   ② 齿轮与序号必须**垂直分离**；若 y 区间相交 ⇒ FAIL（不是"看起来对"）。
 *   ③ 反例：第 2 列表头**不得**存在齿轮 —— 证明「齿轮只在第一列」是真的，不是"到处都有"。
 *   ④ 零写入：整轮只允许 GET/HEAD，出现任何写请求即 FAIL（本探针是只读的）。
 *
 * ⚠️ 只量**查看态**（summary / 本期预报）。改单态（edit-tbl）结构等价、类名同名，
 *    但进入改单需要「有进行中的期次」且可能弹 confirm ⇒ 不进编辑态，改单态以**源码逐字**为准
 *    （`Forecast.vue:1151-1154` 表头 + `:1192` 表体）。
 *
 * 🔴 两相位（同一脚本，期望相反 ⇒ 判据非恒真）：
 *   V400_EXPECT=spec（**默认**；v401 起应**全绿**）量 **§2.6.1 契约 = 现在时**；
 *   V400_EXPECT=impl 量 **v400 改前历史基线**（齿轮偏移 >2px / 菜单压住齿轮 / 菜单 absolute）。
 *   v400 时是「impl 全绿、spec 恰好红 2 条」；**v401 修完后反转**为「spec 全绿、impl 红那 2 条」——
 *   方向变了，但**两相位仍必须不同**；`impl` 判红正是「这两处确实被改掉了」的证据。
 *   ⚠️ **看回归认 `spec`**（它量的是本节的现在时）；impl 只是留档，别拿它当当前事实。
 *
 * 运行：
 *   V400_TOKEN=$(ssh -o BatchMode=yes root@47.113.224.140 'python3 /tmp/v392-probe-tokens.py boss' | cut -f3) \
 *   V400_EXPECT=spec \       # spec = §2.6.1 契约（默认，v401 起全绿）；impl = v400 改前基线
 *   NODE_PATH=/Users/zhangjunfeng/.workbuddy/binaries/node/workspace/node_modules \
 *   /Users/zhangjunfeng/.workbuddy/binaries/node/versions/22.22.2-6/bin/node \
 *     .workbuddy/tools/v400-col-cfg-probe.mjs
 */
import { launch } from './lib/cdp-lite.mjs'

const BASE = 'https://hergent.cn'
const TOKEN = process.env.V400_TOKEN || ''
const TENANT = '1'
/* 相位：spec（**§2.6.1 契约 = 现在时**，默认，v401 起应全绿）/ impl（**v400 改前历史基线**）。
   两相位对**同两条**几何量给出**相反**期望 ⇒ 判据不可能恒真：
     · 齿轮↔序号 横向中心差：v400 现况 4px（左偏）；契约要求 ≤2px（同轴）。
     · 菜单锚点：v400 现况**压在齿轮上**（menu.top ≤ gear.bottom）；契约要求从齿轮下方展开。
   v400 时「impl 全绿 / spec 红这 2 条」；**v401 修完后反转**成「spec 全绿 / impl 红这 2 条」。
   ⚠️ 回归认 spec。 */
const EXPECT = process.env.V400_EXPECT || 'spec'

const PASS = []
const FAIL = []
const ok = (name, cond, detail = '') => {
  ;(cond ? PASS : FAIL).push(name)
  console.log('  ' + (cond ? 'PASS' : 'FAIL') + '  ' + name + (detail ? ' | ' + detail : ''))
}
const section = (t) => console.log('\n' + '─'.repeat(86) + '\n' + t + '\n' + '─'.repeat(86))
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const INIT = `
;(function(){
  try {
    localStorage.setItem('hergent_v2_token', ${JSON.stringify(TOKEN)});
    localStorage.setItem('hergent_v2_tenant', ${JSON.stringify(TENANT)});
    localStorage.setItem('hergent_v2_csrf', 'probe-csrf');
    localStorage.setItem('hergent_v2_user', JSON.stringify({ id: 2, username: 'boss', role: 'boss', roles: ['boss'], name: '老板' }));
  } catch (e) {}
})();
;(function(){
  window.__WRITES = [];
  function log(m, u){
    try {
      if (String(u).indexOf('/api/') >= 0 && String(m).toUpperCase() !== 'GET' && String(m).toUpperCase() !== 'HEAD')
        window.__WRITES.push(String(m).toUpperCase() + ' ' + String(u));
    } catch (e) {}
  }
  var f = window.fetch;
  window.fetch = function(a, b){
    try { log((b && b.method) || (a && a.method) || 'GET', (typeof a === 'string') ? a : ((a && a.url) || '')); } catch (e) {}
    return f.apply(this, arguments);
  };
  var o = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(m, u){ try { log(m, u); } catch (e) {} return o.apply(this, arguments); };
})();
`

/* ── 测「齿轮在哪 + 长什么样 + 序号在哪」 ── */
const MEASURE = `(function(){
  var out = { hash: location.hash, vp: window.innerWidth };
  var R = function(el){ var r = el.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height), cx: Math.round((r.left + r.right) / 2), cy: Math.round((r.top + r.bottom) / 2) }; };

  var tbl = document.querySelector('.view-wrap .cross-tbl');
  if (!tbl) { out.err = 'no .cross-tbl（查看态交叉表未渲染）'; return JSON.stringify(out); }
  out.tblCls = String(tbl.className).trim();

  var ths = tbl.querySelectorAll('thead > tr > th');
  out.thCount = ths.length;
  var th0 = ths[0], th1 = ths[1];
  if (!th0) { out.err = 'no thead th'; return JSON.stringify(out); }
  out.th0Cls = String(th0.className).trim();
  out.th1Cls = th1 ? String(th1.className).trim() : null;
  out.th0 = R(th0);
  out.th1 = th1 ? R(th1) : null;
  out.th0Text = th0.textContent.trim().replace(/\\s+/g, ' ');

  /* ── 齿轮 ── */
  var gear = th0.querySelector('.col-cfg.gear');
  out.gearInTh0 = !!gear;
  if (gear) {
    out.gear = R(gear);
    out.gearTag = gear.tagName.toLowerCase();
    out.gearTitle = gear.getAttribute('title');
    out.gearAriaLabel = gear.getAttribute('aria-label');
    out.gearTxt = gear.textContent.trim();
    out.gearIsSvg = !!gear.querySelector('svg');
    var svg = gear.querySelector('svg');
    out.svgPaths = svg ? svg.querySelectorAll('path').length : 0;
    out.svgLineCount = svg ? svg.querySelectorAll('path,line,polyline,circle,rect').length : 0;
    out.svgStroke = svg ? getComputedStyle(svg).stroke : null;
    out.svgFill = svg ? getComputedStyle(svg).fill : null;
    /* 🔴 辨析：是不是 emoji（U+2699 齿轮 / U+FE0F 变体选择符） */
    out.gearHasEmoji = /[\\u2699\\uFE0F]/ .test(gear.textContent);
    out.gearHTMLHead = gear.innerHTML.slice(0, 90);
    var gs = getComputedStyle(gear);
    out.gearStyle = {
      display: gs.display, bg: gs.backgroundColor,
      borderTopW: gs.borderTopWidth, borderTopS: gs.borderTopStyle,
      color: gs.color, fs: gs.fontSize, radius: gs.borderTopLeftRadius
    };
    /* 齿轮是不是 th0 的直接后裔（而不是被搬到别处） */
    out.gearClosestThIsTh0 = (gear.closest('th') === th0);
  }

  /* 反例：第 2 列表头**不得**有齿轮 */
  out.th1HasGear = th1 ? !!th1.querySelector('.col-cfg') : null;
  out.gearThCount = tbl.querySelectorAll('thead .col-cfg.gear').length;

  /* ── 表头单元格内部构造（解释"齿轮为什么不居中"）──
     .th-in 是 flex + justify-content:space-between，只有一个子元素 ⇒ 子元素靠**左**。 */
  var thin = th0.querySelector('.th-in');
  if (thin) { out.thIn = R(thin); out.thInJustify = getComputedStyle(thin).justifyContent; }
  var rz = th0.querySelector('.col-resizer');
  if (rz) { out.resizer = R(rz); out.resizerPos = getComputedStyle(rz).position; }
  var t0s = getComputedStyle(th0);
  out.th0Pad = { l: parseFloat(t0s.paddingLeft) || 0, r: parseFloat(t0s.paddingRight) || 0 };
  out.th0ContentW = Math.round(th0.clientWidth - out.th0Pad.l - out.th0Pad.r);

  /* ── 列设置菜单的锚点父节点（工具条），用来解释菜单落在哪 ── */
  var bar = document.querySelector('.col-config-bar');
  if (bar) { out.bar = R(bar); out.barPos = getComputedStyle(bar).position; }

  /* ── 表体序号 ── */
  var nums = tbl.querySelectorAll('tbody td.seq-cell .seq-num');
  out.numCount = nums.length;
  out.nums = [];
  for (var i = 0; i < Math.min(3, nums.length); i++) {
    var n = nums[i];
    var o = R(n);
    o.text = n.textContent.trim();
    var td = n.closest('td');
    o.tdCls = td ? String(td.className).trim() : null;
    o.td = td ? R(td) : null;
    out.nums.push(o);
  }

  /* ── 序号列冻结 ── */
  var sc = tbl.querySelector('tbody td.seq-cell');
  if (sc) {
    var ss = getComputedStyle(sc);
    out.seqPos = ss.position;
    out.seqLeft = ss.left;
    out.seqZ = ss.zIndex;
    out.seqW = R(sc).w;
  }
  var hdSeq = tbl.querySelector('thead th.seq-th, thead th.seq-cell');
  if (hdSeq) { var hs = getComputedStyle(hdSeq); out.seqThPos = hs.position; out.seqThLeft = hs.left; out.seqThZ = hs.zIndex; }

  /* ── 列宽权威源 = colgroup ── */
  var cg = tbl.querySelectorAll('colgroup col');
  out.colCount = cg.length;
  out.col0StyleW = cg[0] ? cg[0].style.width : null;
  out.col1StyleW = cg[1] ? cg[1].style.width : null;
  out.tblLayout = getComputedStyle(tbl).tableLayout;

  return JSON.stringify(out);
})();`

/* ── 点开齿轮，量「列设置清单里有没有序号」+ 菜单锚点 ── */
const OPEN_MENU = `(async function(){
  var out = {};
  var tbl = document.querySelector('.view-wrap .cross-tbl');
  var gear = tbl && tbl.querySelector('thead .col-cfg.gear');
  if (!gear) { out.err = 'no gear'; return JSON.stringify(out); }
  var g0 = gear.getBoundingClientRect();
  out.gearRect = { t: Math.round(g0.top), b: Math.round(g0.bottom), l: Math.round(g0.left) };
  gear.click();
  await new Promise(function(r){ setTimeout(r, 350); });
  var menu = document.querySelector('.col-menu');
  out.menuOpen = !!menu;
  if (menu) {
    var m0 = menu.getBoundingClientRect();
    out.menuRect = { t: Math.round(m0.top), l: Math.round(m0.left), w: Math.round(m0.width), h: Math.round(m0.height) };
    out.menuPos = getComputedStyle(menu).position;
    /* v401：位置由 toggleColMenu 写 inline style（视口坐标），不再来自 CSS 写死值 */
    out.menuInlineTop = menu.style.top || '';
    out.menuInlineLeft = menu.style.left || '';
    out.menuDH = { t: out.menuRect.t - out.gearRect.t, l: out.menuRect.l - out.gearRect.l };
    /* 菜单锚在哪个父节点下 */
    var host = menu.closest('.col-config-bar') || menu.parentElement;
    out.menuHostCls = host ? String(host.className).trim() : null;
    var labels = [];
    menu.querySelectorAll('.col-menu-list li label').forEach(function(l){ labels.push(l.textContent.trim()); });
    out.menuLabels = labels;
    out.menuLabelCount = labels.length;
    out.menuHasSeq = labels.some(function(x){ return x.indexOf('序号') >= 0; });
    out.menuHasColSettingWord = labels.some(function(x){ return x.indexOf('列设置') >= 0; });
    /* 菜单里第一行的 checkbox 是否就是序号列 */
    var first = menu.querySelector('.col-menu-list li');
    out.menuFirstLabel = first ? first.textContent.trim().replace(/\\s+/g, ' ') : null;
  }
  /* 再点一次关掉，保持页面回到初始态 */
  gear.click();
  await new Promise(function(r){ setTimeout(r, 250); });
  out.menuClosed = !document.querySelector('.col-menu');
  return JSON.stringify(out);
})();`

/* ── v401 试点页：进销存采购 / 销售列表的序号列 ──
   判据：表头第一列 =「序号」且带 .seq-th、列宽 46px（全局唯一源生效）、居中；
   表体 .seq-num 1 基连续、**非** sticky（只读清单不加冻结）。
   空表时只验表头、行断言自动跳过（免得"没数据"被记成失败）。 */
const MEASURE_LIST = `(function(){
  var out = { hash: location.hash };
  var tbl = document.querySelector('.table-wrap table.tbl');
  if (!tbl) { out.err = 'no table.tbl'; return JSON.stringify(out); }
  var ths = tbl.querySelectorAll('thead > tr > th');
  out.thCount = ths.length;
  var th0 = ths[0];
  out.th0Text = th0 ? th0.textContent.trim().replace(/\\s+/g, ' ') : null;
  out.th0Cls = th0 ? String(th0.className).trim() : null;
  if (th0) {
    var a = getComputedStyle(th0);
    out.th0Align = a.textAlign;
    out.th0W = Math.round(th0.getBoundingClientRect().width);
  }
  var nums = tbl.querySelectorAll('tbody td.seq-cell .seq-num');
  out.numCount = nums.length;
  out.nums = [];
  for (var i = 0; i < Math.min(3, nums.length); i++) out.nums.push(nums[i].textContent.trim());
  var sc = tbl.querySelector('tbody td.seq-cell');
  if (sc) {
    var s = getComputedStyle(sc);
    out.cellAlign = s.textAlign;
    out.cellPos = s.position;
    out.cellW = Math.round(sc.getBoundingClientRect().width);
  }
  return JSON.stringify(out);
})();`

const main = async () => {
  if (!TOKEN) { console.error('缺 V400_TOKEN'); process.exit(2) }
  const browser = await launch({ headless: true })
  const p = await browser.newPage()
  p.pageErrors = []
  await p.enable()
  const id = await p.addInitScript(INIT)
  try {
    await p.raw.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })
    await p.goto(BASE + '/#/forecast', 5000)
    /* 懒加载 chunk + 交叉表数据，最多重试 4 次 */
    let m = JSON.parse(await p.eval(MEASURE))
    for (let i = 0; i < 4 && (m.err || !m.gearInTh0 || !m.numCount); i++) {
      await sleep(2500)
      m = JSON.parse(await p.eval(MEASURE))
    }
    console.log('\n原始量测 = ' + JSON.stringify(m, null, 1))

    section('P1 结构：齿轮 = 表头第一列（序号列）里的唯一按钮')
    ok('P1 查看态交叉表已渲染（.cross-tbl）', !m.err && !!m.thCount, 'th 数=' + m.thCount)
    ok('P1 th[0] 是序号列（class 含 seq-）', !!m.th0Cls && /seq-/.test(m.th0Cls), 'th0.cls=' + m.th0Cls)
    ok('P1 齿轮在 th[0] 内部（closest(th) === th[0]）', m.gearClosestThIsTh0 === true)
    ok('P1 齿轮是 <button>', m.gearTag === 'button', 'tag=' + m.gearTag)
    ok('P1 齿轮带 title="列设置"', m.gearTitle === '列设置', 'title=' + JSON.stringify(m.gearTitle))
    ok('P1 ★反例：全表**只有 1 个**齿轮（只在序号列表头）', m.gearThCount === 1, 'count=' + m.gearThCount)
    ok('P1 ★反例：第 2 列表头**没有**齿轮', m.th1HasGear === false, 'th1.hasGear=' + m.th1HasGear)

    section('P2 齿轮样式：线性图标（<Icon name="settings"/>），**不是 emoji ⚙️**')
    ok('P2 齿轮内是 SVG（图标组件渲染）', m.gearIsSvg === true)
    ok('P2 SVG 是 Lucide settings（2 段 path）', m.svgPaths === 2, 'paths=' + m.svgPaths)
    ok('P2 ★齿轮无文字内容（纯图标）', m.gearTxt === '', 'text=' + JSON.stringify(m.gearTxt))
    ok('P2 ★文本里**不含** U+2699 / U+FE0F（证明不是 emoji ⚙️）', m.gearHasEmoji === false)
    ok('P2 描边式线性图标（stroke 非 none / fill 非实心）',
      !!m.svgStroke && m.svgStroke !== 'none', 'stroke=' + m.svgStroke + ' fill=' + m.svgFill)
    ok('P2 无边框、透明底（.col-cfg / .gear 只给尺寸与色）',
      m.gearStyle && m.gearStyle.borderTopW === '0px' && /rgba\(0,\s*0,\s*0,\s*0\)|transparent/.test(m.gearStyle.bg),
      'border=' + (m.gearStyle && m.gearStyle.borderTopW) + ' bg=' + (m.gearStyle && m.gearStyle.bg))
    ok('P2 用令牌上色（color 非空、来自 var(--t3)）', !!(m.gearStyle && m.gearStyle.color),
      'color=' + (m.gearStyle && m.gearStyle.color) + ' fs=' + (m.gearStyle && m.gearStyle.fs))

    section('P3 序号位置：与齿轮**同列**、且在**下方**')
    ok('P3 表体有 .seq-num 序号', m.numCount > 0, 'count=' + m.numCount)
    /* ★「同一列」的判据分两档：现况（impl）用实测容差；契约（spec）要求像素级同轴。 */
    const dxGear = (m.gear && m.nums && m.nums[0]) ? (m.nums[0].cx - m.gear.cx) : null
    console.log('  齿轮 cx=' + (m.gear && m.gear.cx) + '  序号 cx=' + (m.nums && m.nums[0] && m.nums[0].cx) +
      '  ⇒ 序号相对齿轮右偏 Δ=' + dxGear + 'px')
    if (dxGear != null) {
      console.log('    成因链：.th-in{justify-content:' + m.thInJustify + '} + 表头只有一个子元素 ⇒ 齿轮靠左；' +
        ' th0 内距=' + m.th0Pad.l + '/' + m.th0Pad.r + '、内容宽=' + m.th0ContentW + 'px、' +
        'resizer=' + (m.resizerPos || '-'))
    }
    if (EXPECT === 'spec') {
      ok('P3 ★契约：齿轮与序号**像素级同轴**（|Δ|≤2px）', dxGear != null && Math.abs(dxGear) <= 2, 'Δ=' + dxGear + 'px')
    } else {
      ok('P3 ★现况：齿轮与序号位于**同一列**（|Δ|≤8px，容纳表头内距差）',
        dxGear != null && Math.abs(dxGear) <= 8, 'Δ=' + dxGear + 'px')
      ok('P3 ★现况：齿轮**未居中**在序号列上（已量到偏移 ⇒ 登记为待对齐）',
        dxGear != null && Math.abs(dxGear) > 2, 'Δ=' + dxGear + 'px')
    }
    ok('P3 ★序号在齿轮**下方**（num.top > gear.bottom）',
      m.gear && m.nums && m.nums[0] && m.nums[0].t > m.gear.b,
      m.gear && m.nums && m.nums[0] ? ('gear.b=' + m.gear.b + ' num.t=' + m.nums[0].t) : '')
    ok('P3 ★两者垂直区间**不相交**（判别力自证：不是量到了同一行）',
      m.gear && m.nums && m.nums[0] && m.nums[0].t >= m.gear.b,
      m.gear && m.nums && m.nums[0] ? ('齿[ ' + m.gear.t + '..' + m.gear.b + ' ] 序[ ' + m.nums[0].t + '..' + m.nums[0].b + ' ]') : '')
    ok('P3 序号列冻结（sticky left:0）', m.seqPos === 'sticky' && m.seqLeft === '0px',
      'pos=' + m.seqPos + ' left=' + m.seqLeft)
    ok('P3 序号列表头同样冻结且 z 更高（表头 9 > 表体 6）',
      m.seqThPos === 'sticky' && Number(m.seqThZ) > Number(m.seqZ),
      'thead z=' + m.seqThZ + ' tbody z=' + m.seqZ)
    ok('P3 序号是 1 基连续（前 3 行 = 1/2/3）',
      m.nums && m.nums.length >= 3 && m.nums[0].text === '1' && m.nums[1].text === '2' && m.nums[2].text === '3',
      m.nums ? m.nums.map(n => n.text).join(',') : '')

    section('P4 列宽：序号列窄、数据列宽（判别力自证：列真的量对了）')
    ok('P4 权威列宽来自 <colgroup>（table-layout:fixed）',
      m.tblLayout === 'fixed' && !!m.col0StyleW, 'layout=' + m.tblLayout + ' col0=' + m.col0StyleW)
    ok('P4 colgroup col[0] = 46px（COL_DEFAULTS.seq）', m.col0StyleW === '46px', 'col0=' + m.col0StyleW)
    ok('P4 ★序号列实测宽 ≈46px', m.th0 && Math.abs(m.th0.w - 46) <= 2, 'th0.w=' + (m.th0 && m.th0.w))
    ok('P4 ★判别力自证：序号列 ≪ 第 2 列宽（两组必须不同）',
      !!(m.th0 && m.th1) && m.th0.w < m.th1.w * 0.8,
      'col0=' + (m.th0 && m.th0.w) + ' col1=' + (m.th1 && m.th1.w))

    section('P5 列设置清单：序号列**不在**清单里（硬编码第一列，不可隐藏）')
    const om = JSON.parse(await p.eval(OPEN_MENU))
    console.log('  菜单 = ' + JSON.stringify(om))
    ok('P5 点齿轮能开列设置菜单', om.menuOpen === true)
    /* v401：菜单从「相对工具条 absolute ＋ 写死 top:38px」改为「相对视口 fixed ＋ JS 算坐标」。 */
    ok('P5 菜单是视口浮层（position:fixed，v401 起）', om.menuPos === 'fixed', 'pos=' + om.menuPos)
    ok('P5 ★菜单里**没有**「序号」这一项（序号列不可被隐藏）',
      om.menuHasSeq === false, 'labels=' + (om.menuLabelCount || 0) + ' 项, hasSeq=' + om.menuHasSeq)
    ok('P5 菜单里有多个可配置列（清单非空）', (om.menuLabelCount || 0) >= 5, 'count=' + om.menuLabelCount)
    /* ⚠️ v401 起这条只验 **DOM 挂载点**（菜单仍留在工具条节点内，是刻意的最小改动）——
       定位**不再依赖**这个宿主的坐标系，改由齿轮 rect 算视口坐标（见下一条）。 */
    ok('P5 菜单 DOM 仍挂在表格工具条内（定位不依赖该宿主）', /col-config-bar/.test(String(om.menuHostCls)),
      'host=' + om.menuHostCls)
    ok('P5 ★菜单位置由 inline style 给（top/left 非空，不再来自 CSS 写死值）',
      !!(om.menuInlineTop && om.menuInlineLeft),
      'inline top=' + JSON.stringify(om.menuInlineTop) + ' left=' + JSON.stringify(om.menuInlineLeft))
    /* 🔴 实测事实：`.col-menu{position:absolute;top:38px;left:0}` 锚在**工具条**上，
       而不是齿轮正下方 ⇒ 在查看态它落在齿轮**左上**、并把齿轮盖住。 */
    const covers = (om.menuRect && om.gearRect)
      ? (om.menuRect.t <= om.gearRect.b && (om.menuRect.t + om.menuRect.h) >= om.gearRect.t)
      : null
    console.log('  菜单 rect=' + JSON.stringify(om.menuRect) + '  齿轮 rect=' + JSON.stringify(om.gearRect) +
      '  Δ(t,l)=(' + (om.menuDH && om.menuDH.t) + ',' + (om.menuDH && om.menuDH.l) + ')  覆盖齿轮=' + covers)
    if (EXPECT === 'spec') {
      ok('P5 ★契约：菜单从齿轮**下方**展开（menu.top ≥ gear.bottom，不遮挡触发按钮）',
        !!(om.menuRect && om.gearRect) && om.menuRect.t >= om.gearRect.b,
        om.menuRect && om.gearRect ? ('menu.t=' + om.menuRect.t + ' gear.b=' + om.gearRect.b) : '')
    } else {
      ok('P5 ★现况：菜单锚在工具条左上角，**压在齿轮上**而非从其下方展开',
        covers === true, '覆盖齿轮=' + covers + ' Δt=' + (om.menuDH && om.menuDH.t) + 'px')
      ok('P5 ★现况：菜单与齿轮横向近似对齐（|Δl|≤24px）',
        !!(om.menuRect && om.gearRect) && Math.abs(om.menuDH.l) <= 24, 'Δl=' + (om.menuDH && om.menuDH.l) + 'px')
    }
    ok('P5 再点齿轮能关掉菜单（幂等）', om.menuClosed === true)

    section('P6 零写入（只读）')
    const writes = await p.eval('JSON.stringify(window.__WRITES || [])')
    const wl = JSON.parse(writes)
    ok('P6 ★整轮零写请求', wl.length === 0, 'writes=' + (wl.length ? wl.join(' ; ') : '0'))
    ok('P6 页面无 console.error / 未捕获异常', (p.errors || []).length === 0,
      (p.errors || []).slice(0, 2).join(' || '))

    /* ⚠️ goto = Page.navigate（**完整导航**）⇒ initScript 在新文档重跑、__WRITES 归零，
       所以 P7 每页各自验一次零写入，别指望 P6 的计数器还管用。 */
    section('P7 试点页：进销存采购 / 销售列表的序号列（v401 新增接入）')
    for (const pair of [['采购单', '/#/inventory/purchase'], ['销售单', '/#/inventory/sale']]) {
      const label = pair[0], path = pair[1]
      await p.goto(BASE + path, 4000)
      let lm = {}
      try { lm = JSON.parse(await p.eval(MEASURE_LIST)) } catch (e) { lm = { err: String(e.message) } }
      for (let i = 0; i < 4 && (lm.err || lm.thCount == null); i++) {
        await sleep(2000)
        try { lm = JSON.parse(await p.eval(MEASURE_LIST)) } catch (e) { lm = { err: String(e.message) } }
      }
      console.log('  ' + label + ' = ' + JSON.stringify(lm))
      ok('P7 ' + label + ' 页面已渲染出 table.tbl', !lm.err, lm.err || ('th 数=' + lm.thCount))
      ok('P7 ' + label + ' ★表头第一列 = 「序号」', lm.th0Text === '序号', 'th0=' + JSON.stringify(lm.th0Text))
      ok('P7 ' + label + ' 序号列表头带 .seq-th', /seq-th/.test(String(lm.th0Cls)), 'cls=' + lm.th0Cls)
      ok('P7 ' + label + ' ★列宽 ≈46px（全局唯一源生效）',
        lm.th0W != null && Math.abs(lm.th0W - 46) <= 4, 'w=' + lm.th0W)
      ok('P7 ' + label + ' 表头居中（.seq-th text-align:center）', lm.th0Align === 'center', 'align=' + lm.th0Align)
      if (lm.numCount > 0) {
        ok('P7 ' + label + ' ★首行序号 = 1（offset + i + 1 的 i=0）', lm.nums[0] === '1', 'nums=' + lm.nums.join(','))
        ok('P7 ' + label + ' ★表体格居中且**非** sticky（只读清单不加冻结）',
          lm.cellAlign === 'center' && lm.cellPos !== 'sticky', 'align=' + lm.cellAlign + ' pos=' + lm.cellPos)
        ok('P7 ' + label + ' 序号格宽 ≈46px', lm.cellW != null && Math.abs(lm.cellW - 46) <= 4, 'w=' + lm.cellW)
      } else {
        ok('P7 ' + label + ' 当前无数据行 ⇒ 只验表头（行断言自动跳过）', true, 'numCount=0')
      }
      const w2 = JSON.parse(await p.eval('JSON.stringify(window.__WRITES || [])'))
      ok('P7 ' + label + ' ★本页零写请求', w2.length === 0, 'writes=' + (w2.length ? w2.join(' ; ') : '0'))
    }

    section('汇总（相位 ' + EXPECT + '）')
    console.log('  PASS=' + PASS.length + '  FAIL=' + FAIL.length)
    if (FAIL.length) console.log('  FAIL 项：\n   - ' + FAIL.join('\n   - '))
    console.log('\n  JSON=' + JSON.stringify({ th0W: m.th0 && m.th0.w, col0: m.col0StyleW, numCount: m.numCount, gearThCount: m.gearThCount }))
    process.exitCode = FAIL.length ? 1 : 0
  } finally {
    await p.removeInitScript(id)
    await browser.close()
  }
}
main().catch(e => { console.error('探针异常：' + e.message); process.exit(1) })
