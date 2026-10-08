'use strict';
/* v279 · 小程序切面（需求 2/3）判据台
 *
 * 原则：**判据必须跑真实代码**。这里从 pages/fill/fill.js 源码里用「括号配平扫描」
 * 提取函数体（不手抄、不重写），塞进一个最小 Page 壳里跑 D18–D24。
 * 输入 = /tmp/v279mp/resp.json（真实后端 /fill-search 与 /avg-target 的响应）。
 *
 * 为什么要这么麻烦：如果我在本地重写一份 _avgNum/_avgText，那验的是"我以为的实现"，
 * 不是"线上那份实现"——本项目的静默失效大多就是栽在这种第二份实现上。
 */

const fs = require('fs');
const path = require('path');

const FILL_JS = '/Users/zhangjunfeng/Documents/laozhangai-product/forecast-order-miniprogram-20260812T023419087Z/miniprogram/pages/fill/fill.js';
const RESC = '/tmp/v279mp/resp.json';

const src = fs.readFileSync(FILL_JS, 'utf8');
const resp = JSON.parse(fs.readFileSync(RESC, 'utf8'));

/* ── 括号配平扫描：跳过字符串 / 模板串 / 注释 / 正则 ───────────────── */
function scanBalanced(s, start) {
  // s[start] 必须是 { 或 ( ；返回配平的右括号下标（含）
  const pairs = { '{': '}', '(': ')', '[': ']' };
  const stack = [];
  let i = start;
  let prev = ''; // 上一个有意义的字符，用来判 '/' 是除号还是正则
  while (i < s.length) {
    const ch = s[i];
    const nx = s[i + 1];
    if (ch === '/' && nx === '/') { const e = s.indexOf('\n', i); i = e < 0 ? s.length : e; continue; }
    if (ch === '/' && nx === '*') { const e = s.indexOf('*/', i + 2); i = e < 0 ? s.length : e + 2; continue; }
    if (ch === '"' || ch === "'" || ch === '`') {
      const q = ch; i++;
      while (i < s.length) {
        if (s[i] === '\\') { i += 2; continue; }
        if (s[i] === q) { i++; break; }
        if (q === '`' && s[i] === '$' && s[i + 1] === '{') { i = scanBalanced(s, i + 1) + 1; continue; }
        i++;
      }
      prev = 'x'; continue;
    }
    if (ch === '/' && /[=(,:;[!&|?+\-*%<>~^]|^$/.test(prev)) {
      // 正则字面量
      i++;
      while (i < s.length) {
        if (s[i] === '\\') { i += 2; continue; }
        if (s[i] === '[') { while (i < s.length && s[i] !== ']') { if (s[i] === '\\') i++; i++; } i++; continue; }
        if (s[i] === '/') { i++; break; }
        if (s[i] === '\n') break;
        i++;
      }
      while (i < s.length && /[gimsuy]/.test(s[i])) i++;
      prev = 'x'; continue;
    }
    if (pairs[ch]) { stack.push(pairs[ch]); i++; prev = ch; continue; }
    if (ch === '}' || ch === ')' || ch === ']') {
      if (stack.length && stack[stack.length - 1] === ch) {
        stack.pop();
        if (!stack.length) return i;   // 回到最外层
      }
      i++; prev = ch; continue;
    }
    if (!/\s/.test(ch)) prev = ch;
    i++;
  }
  throw new Error('unbalanced from ' + start);
}

/* ── 从源码提取对象字面量里的方法（支持 async / 生成器前缀） ─────────── */
function extractMethod(name) {
  const re = new RegExp('(^|\\n)([ \\t]*)((?:async[ \\t]+)?)' + name.replace(/\$/g, '\\$') + '[ \\t]*\\(', 'm');
  const m = re.exec(src);
  if (!m) throw new Error('method not found: ' + name);
  const asyncKw = /async/.test(m[3]);
  const parenStart = m.index + m[0].length - 1;
  const parenEnd = scanBalanced(src, parenStart);
  let j = parenEnd + 1;
  while (j < src.length && /\s/.test(src[j])) j++;
  if (src[j] !== '{') throw new Error('no body for ' + name);
  const braceEnd = scanBalanced(src, j);
  const params = src.slice(parenStart, parenEnd + 1);
  const body = src.slice(j, braceEnd + 1);
  return {
    name,
    // 对象属性写法：name: async function(params) { ... }
    prop: name + ': ' + (asyncKw ? 'async ' : '') + 'function' + params + ' ' + body,
    lines: src.slice(0, m.index).split('\n').length,
    bodyText: body
  };
}

const NAMES = ['loadAvgTargets', 'applyAvgToRows', '_avgNum', '_avgText', '_numText',
  '_lowList', '_doSubmit', '_subKey', '_lastKey'];
const picked = NAMES.map(extractMethod);

/* ── 最小 Page 壳 ─────────────────────────────────────────────────── */
function setPath(obj, p, v) {
  const segs = p.replace(/\[(\d+)\]/g, '.$1').split('.');
  let cur = obj;
  for (let i = 0; i < segs.length - 1; i++) cur = cur[segs[i]];
  cur[segs[segs.length - 1]] = v;
}

function mkPage(reqImpl) {
  const wxMock = {
    modalCalls: [], toastCalls: [], store: {},
    showModal(o) { wxMock.modalCalls.push({ title: o.title, content: o.content, confirmText: o.confirmText, cancelText: o.cancelText }); },
    showToast(o) { wxMock.toastCalls.push(o.title); },
    getStorageSync(k) { return wxMock.store[k] === undefined ? '' : wxMock.store[k]; },
    setStorageSync(k, v) { wxMock.store[k] = v; },
    switchTab() { },
    navigateTo() { }, redirectTo() { }, setNavigationBarTitle() { }
  };
  // showModal 默认：整场都点「取消」（返回修改），这样 _doSubmit 会在此处 return，链路干净
  wxMock.showModal = function (o) {
    wxMock.modalCalls.push({ title: o.title, content: o.content, confirmText: o.confirmText, cancelText: o.cancelText });
    wxMock._answer = wxMock._answer || {};
    const key = o.title;
    const choice = Object.prototype.hasOwnProperty.call(wxMock._answer, key) ? wxMock._answer[key] : false;
    setTimeout(() => o.success && o.success({ confirm: !!choice, cancel: !choice }), 0);
  };

  const factory = new Function('request', 'wx', 'console', 'return {' +
    picked.map(x => x.prop).join(',\n') + '};');
  const page = factory(reqImpl, wxMock, console);
  page.data = { products: [], cart: [], period: { id: 18, name: '本期' }, store: { id: 3, name: '永诺旗舰店' }, cartQty: 0 };
  page.setData = function (patch) {
    page._patchCount = (page._patchCount || 0) + 1;
    Object.keys(patch).forEach(k => setPath(page.data, k, patch[k]));
  };
  page._avgMap = {}; page._avgMapPid = ''; page._avgNums = {}; page._avgPid = undefined;
  page._prodIndex = {}; page._qtyMap = {};
  page.wxMock = wxMock;
  return page;
}

/* ── 结果收集 ─────────────────────────────────────────────────────── */
const R = [];
function chk(id, ok, msg, detail) {
  R.push({ id, ok: !!ok, msg, detail: detail === undefined ? '' : String(detail) });
  const tag = ok ? 'PASS' : 'FAIL';
  console.log('  [' + tag + '] ' + id + ' ' + msg + (detail !== undefined ? '  << ' + detail : ''));
}
function sec(t) { console.log('\n=== ' + t + ' ==='); }

const FILL_ITEMS = resp.fill_search.resp.items;
const AVG_ITEMS = resp.avg_target.resp.items;
const PROD_ID = 1556;
const ROW = FILL_ITEMS.find(x => Number(x.id) === PROD_ID);
const AV = AVG_ITEMS[String(PROD_ID)];

/* 真实 request：不打网络，直接按真实响应回放 */
function makeReq(opts) {
  opts = opts || {};
  return function (url) {
    if (/avg-target/.test(url)) {
      if (opts.avgFails) return Promise.reject(new Error('mock network down'));
      return Promise.resolve(resp.avg_target.resp);
    }
    if (/fill-search/.test(url)) return Promise.resolve(resp.fill_search.resp);
    return Promise.resolve({});
  };
}

function freshProducts() {
  return FILL_ITEMS.map(it => Object.assign({}, it, { qty: 0 }));
}

(async function main() {
  console.log('源文件: ' + path.basename(FILL_JS));
  console.log('提取函数行号: ' + picked.map(x => x.name + '@L' + x.lines).join(' · '));
  console.log('样本商品: id=' + PROD_ID + ' 行内unit=' + ROW.unit + ' 档案unit_raw=' + ROW.unit_raw +
    ' 后端unit=' + AV.unit + ' avg_box=' + AV.avg_box + ' flags=' + JSON.stringify(AV.flags));

  /* ── D18 ────────────────────────────────────────────────────────── */
  sec('D18 报单行出现均单目标（浅色）');
  {
    const page = mkPage(makeReq());
    page.data.products = freshProducts();
    page.data.period = { id: 18, name: '本期' };
    await page.loadAvgTargets(18);
    const row = page.data.products.find(p => Number(p.id) === PROD_ID);
    chk('D18a', row.avgText === '均单目标 600 提', '1556 行渲染出均单提示且单位=行内单位',
      JSON.stringify(row.avgText));
    chk('D18b', row.avgNum === 600, 'avgNum 与后端 per_unit[行内单位] 同源',
      row.avgNum + ' vs per_unit[提]=' + AV.per_unit['提']);
    const shown = ROW.spec + ' · ' + (ROW.unit || '件');
    chk('D18c', shown === '8 · 提' && /提$/.test(row.avgText), '规格行与提示里的单位是同一个字符串',
      '规格="' + shown + '" 提示="' + row.avgText + '"');
    // 浅色/不抢眼：读真实 wxss
    const wxss = fs.readFileSync(path.dirname(FILL_JS) + '/fill.wxss', 'utf8');
    const mAvg = /\.prod-avg\{[^}]*\}/.exec(wxss)[0];
    const mName = /\.prod-name\{[^}]*\}/.exec(wxss)[0];
    const fsAvg = Number((/font-size:\s*(\d+)rpx/.exec(mAvg) || [])[1]);
    const fsName = Number((/font-size:\s*(\d+)rpx/.exec(mName) || [])[1]);
    chk('D18d', fsAvg < fsName && !/font-weight:\s*(bold|[6-9]00)/.test(mAvg),
      '字号小于商品名且非加粗（不抢眼）', 'prod-avg ' + fsAvg + 'rpx < prod-name ' + fsName + 'rpx');
    chk('D18e', /background:#ecfeff/.test(mAvg) && /color:#0891b2/.test(mAvg),
      '浅青底 + 青字（与品牌色同族）', mAvg.replace(/\s+/g, ' '));
    chk('D18f', page.data.products.filter(p => p.avgText).length === 1,
      '本期 154 行里只有设了目标的 1 行出提示',
      '出提示行数=' + page.data.products.filter(p => p.avgText).length);
  }

  /* ── D19 ────────────────────────────────────────────────────────── */
  sec('D19 没目标时不显示 0');
  {
    const page = mkPage(makeReq());
    page.data.products = freshProducts();
    await page.loadAvgTargets(18);
    const noT = Object.keys(AVG_ITEMS).filter(k => (AVG_ITEMS[k].flags || {}).no_target);
    const noC = Object.keys(AVG_ITEMS).filter(k => (AVG_ITEMS[k].flags || {}).no_convert);
    console.log('  （真实数据面：no_target=' + noT.length + ' 行，no_convert=' + noC.length + ' 行）');
    let bad = page.data.products.filter(p => noT.concat(noC).indexOf(String(p.id)) >= 0)
      .filter(p => p.avgText !== '' || p.avgNum !== 0);
    chk('D19a', bad.length === 0, 'no_target 行 avgText 一律空串（不是「均单目标 0」）',
      '异常行数=' + bad.length + (bad.length ? ' ' + JSON.stringify(bad.slice(0, 2)) : ''));
    const probe = AVG_ITEMS[noT[0]];
    const p2 = mkPage(makeReq());
    chk('D19b', p2._avgText(probe, probe.unit || '瓶') === '' && p2._avgNum(probe, probe.unit || '瓶') === 0,
      '直调真实 _avgText/_avgNum：no_target ⇒ 空串/0，且不含「无法计算」',
      JSON.stringify(p2._avgText(probe, probe.unit || '瓶')));
    // no_convert 单测 —— ⚠️ 沙箱里 no_convert 行**同时**带 no_target（只有 1556 有目标），
    //   拿它归因不干净。所以这里用**只带 no_convert**的合成项隔离这个 flag 本身。
    const probeC = AVG_ITEMS[noC[0]];
    console.log('  （注意：沙箱 no_convert 行的 flags=' + JSON.stringify(probeC.flags) + ' ⇒ 与 no_target 重叠，需隔离）');
    const onlyNoConv = { unit: '瓶', flags: { no_convert: true }, per_unit: { '瓶': 99 }, avg_per_unit: { '瓶': 99 } };
    chk('D19c', p2._avgNum(onlyNoConv, '瓶') === 0 && p2._avgText(onlyNoConv, '瓶') === '',
      '只带 no_convert（即使 per_unit 有值）⇒ 一样不出提示：缺换算就不给数',
      'avgNum=' + p2._avgNum(onlyNoConv, '瓶'));
    const onlyNoWin = { unit: '瓶', flags: { no_window: true }, per_unit: { '瓶': 99 } };
    chk('D19d', p2._avgNum(onlyNoWin, '瓶') === 0, '只带 no_window（剩余期次 0）⇒ 同样不出提示',
      'avgNum=' + p2._avgNum(onlyNoWin, '瓶'));
    const doneItem = { unit: '瓶', flags: { done: true }, per_unit: { '瓶': 99 } };
    chk('D19e', p2._avgText(doneItem, '瓶') === '本期已达标',
      '唯一例外：done（本期已达标）给**准确结论**而不是留空', p2._avgText(doneItem, '瓶'));
  }

  /* ── D20 ────────────────────────────────────────────────────────── */
  sec('D20 提示单位 = 输入框单位（防两把尺子）★硬标准');
  {
    const page = mkPage(makeReq());
    chk('D20a', ROW.unit === '提' && ROW.unit_raw === '袋',
      '沙箱样本确实是「报单单位 ≠ 档案小单位」', 'order_unit=提 / 档案=袋');
    chk('D20b', Object.prototype.hasOwnProperty.call(AV.per_unit, ROW.unit),
      '后端 per_unit 里有「提」这个键（兜底分支被真实触发）',
      'keys=' + Object.keys(AV.per_unit).join('/'));
    chk('D20c', AV.per_unit['提'] === AV.per_unit['袋'] && AV.per_unit['提'] === AV.avg_box * 8,
      '兜底键的值由同一权威换算算出（75箱 × 8 = 600），不是另一条公式',
      AV.per_unit['提'] + ' = ' + AV.avg_box + ' × 8');
    chk('D20d', page._avgNum(AV, ROW.unit) === 600 && page._avgText(AV, ROW.unit).indexOf('提') > 0,
      '真实 _avgNum/_avgText 用行内单位「提」取到值',
      page._avgText(AV, ROW.unit));
    // 反例对照：若后端没补这个键（v264c 之前的行为）会怎样
    const noKey = Object.assign({}, AV, { per_unit: { '箱': 75, '袋': 600 }, avg_per_unit: { '箱': 75, '袋': 600 } });
    chk('D20e', page._avgNum(noKey, ROW.unit) === 0 && page._avgText(noKey, ROW.unit) === '',
      '反例：缺「提」键 ⇒ 提示整行消失（静默失效，正是要防的）',
      '无键时 avgNum=' + page._avgNum(noKey, ROW.unit));
    chk('D20f', page._avgNum(AV, '袋') === 600 && page._avgNum(AV, '') === 0,
      '对照：同数据用「袋」也取得到；unit 为空一律 0（不猜单位）', '袋=' + page._avgNum(AV, '袋'));
  }

  /* ── D21 ────────────────────────────────────────────────────────── */
  sec('D21 低于目标 ⇒ 提交前提醒一次 ★硬标准');
  {
    const page = mkPage(makeReq());
    page.data.products = freshProducts();
    await page.loadAvgTargets(18);
    page.data.cart = [{ key: 'k1', id: PROD_ID, name: ROW.name, spec: ROW.spec, unit: ROW.unit, qty: 5 }];
    page.data.cartQty = 5;
    const low = page._lowList();
    chk('D21a', low.length === 1 && low[0].qty === 5 && low[0].target === 600 && low[0].unit === '提',
      '_lowList() 用 cart[].id 命中、单位取 cart[].unit（与 _avgNums 同源）', JSON.stringify(low));
    page.wxMock._answer = { '有 1 个商品低于均单目标': false };
    await page._doSubmit();
    const m1 = page.wxMock.modalCalls[0];
    chk('D21b', m1 && m1.title === '有 1 个商品低于均单目标', '先弹「有 1 个商品低于均单目标」',
      m1 && m1.title);
    chk('D21c', m1 && m1.content.split('\n')[0] === ROW.name + ' 5 / 均单 600 提',
      '明细行 = 「商品名 已填 / 均单 N 单位」', m1 && JSON.stringify(m1.content.split('\n')[0]));
    chk('D21d', m1 && m1.confirmText === '继续提交' && m1.cancelText === '返回修改',
      '按钮文案 = 继续提交 / 返回修改', m1 && (m1.confirmText + ' | ' + m1.cancelText));
    chk('D21e', page.wxMock.modalCalls.length === 1 && page.data.cart.length === 1 &&
      page.data.cart[0].qty === 5 && page.data.submitting === undefined,
      '点「返回修改」⇒ 不提交、已填数量一项不动、不进 submitting 态',
      'modal 次数=' + page.wxMock.modalCalls.length + ' cart=' + JSON.stringify(page.data.cart[0].qty));
    // 点「继续提交」：必须继续走原有提交确认（不能卡在这儿）
    const page2 = mkPage(makeReq());
    page2.data.products = freshProducts();
    await page2.loadAvgTargets(18);
    page2.data.cart = [{ key: 'k1', id: PROD_ID, name: ROW.name, spec: ROW.spec, unit: ROW.unit, qty: 5 }];
    page2.data.cartQty = 5;
    page2.wxMock._answer = { '有 1 个商品低于均单目标': true, '确认提交预报？': false };
    await page2._doSubmit();
    const titles = page2.wxMock.modalCalls.map(x => x.title);
    chk('D21f', titles[0] === '有 1 个商品低于均单目标' && titles[1] === '确认提交预报？',
      '点「继续提交」⇒ 继续走原有提交确认（顺序正确）', JSON.stringify(titles));
    chk('D21g', page2.data.submitting === undefined,
      '在「确认提交预报？」处取消 ⇒ 依然不落库（不因为提醒过就放行）', 'submitting=' + page2.data.submitting);
    /* 判据链的**第三环**（源码级不变量）：写进 cart 的 unit 必须与行内渲染的 unit 同源，
       否则「比对了，但两把尺子」—— _lowList 拿 cart.unit 的 qty 去比 avgNums[行内单位]，
       单位不同源时这个比较本身无意义（而且不报错）。 */
    const cartBuild = /const key = p\.id \+ '\|' \+ \(p\.unit \|\| '件'\)[\s\S]{0,200}?unit: p\.unit \|\| '件'/;
    const cartBuild2 = /unit: p\.unit \|\| '件', qty \}/;   // _syncRow（+/-/输入）那条
    const cartRestore = /const unit = it\.unit \|\| '件'[\s\S]{0,120}?unit, qty: it\.qty/;
    chk('D21h', cartBuild.test(src) && cartBuild2.test(src),
      'cart 项的 unit 取自商品行 p.unit（与 applyAvgToRows 同一字段）⇒ 比对是同源的',
      'setQty 写 cart + _syncRow 改 cart 两处均用 p.unit');
    chk('D21i', cartRestore.test(src),
      '从「上次报单」带入时也用 it.unit（快照里存的就是行单位），三处同源', '');
  }

  /* ── D22 ────────────────────────────────────────────────────────── */
  sec('D22 不低于目标 ⇒ 不打扰');
  {
    const page = mkPage(makeReq());
    page.data.products = freshProducts();
    await page.loadAvgTargets(18);
    page.data.cart = [{ key: 'k1', id: PROD_ID, name: ROW.name, spec: ROW.spec, unit: ROW.unit, qty: 600 }];
    page.data.cartQty = 600;
    chk('D22a', page._lowList().length === 0, 'qty == target ⇒ 不在 low 列表（严格 q < t）', '');
    page.wxMock._answer = { '确认提交预报？': false };
    await page._doSubmit();
    const titles = page.wxMock.modalCalls.map(x => x.title);
    chk('D22b', titles.indexOf('有 1 个商品低于均单目标') < 0 && titles[0] === '确认提交预报？',
      '不弹均单提醒，直奔原有提交确认', JSON.stringify(titles));
    // 边界：qty = 599 仍要提醒；qty = 601 不提醒
    const p3 = mkPage(makeReq());
    p3.data.products = freshProducts(); await p3.loadAvgTargets(18);
    p3.data.cart = [{ key: 'k', id: PROD_ID, name: ROW.name, unit: ROW.unit, qty: 599 }];
    const p4 = mkPage(makeReq());
    p4.data.products = freshProducts(); await p4.loadAvgTargets(18);
    p4.data.cart = [{ key: 'k', id: PROD_ID, name: ROW.name, unit: ROW.unit, qty: 601 }];
    chk('D22c', p3._lowList().length === 1 && p4._lowList().length === 0,
      '边界：599 提醒 / 601 不提醒', p3._lowList().length + ' / ' + p4._lowList().length);
    // qty=0（没填）不该被算作"低于目标"
    const p5 = mkPage(makeReq());
    p5.data.products = freshProducts(); await p5.loadAvgTargets(18);
    p5.data.cart = [{ key: 'k', id: PROD_ID, name: ROW.name, unit: ROW.unit, qty: 0 }];
    chk('D22d', p5._lowList().length === 0, '没填数量（0）不算低于目标（否则每单都弹）',
      p5._lowList().length);
  }

  /* ── D23 ────────────────────────────────────────────────────────── */
  sec('D23 切期次后提示跟着换');
  {
    const page = mkPage(makeReq());
    page.data.products = freshProducts();
    await page.loadAvgTargets(18);
    chk('D23a', page.data.products.find(p => Number(p.id) === PROD_ID).avgText === '均单目标 600 提',
      '期次 18 已出提示', '');
    // 切到 19：商品会重拉（新对象、无 avgText），而 _avgMap 还是 18 的
    page.data.products = freshProducts();
    page.data.period = { id: 19, name: '下一期' };
    page._patchCount = 0;
    page.applyAvgToRows();
    const anyText = page.data.products.filter(p => p.avgText && p.avgText.length).length;
    chk('D23b', anyText === 0 && page._patchCount === 0,
      '期次 19：_avgMapPid(18) ≠ curPid(19) ⇒ 一行都不贴（零报错的错贴被挡住）',
      '贴出=' + anyText + ' setData次数=' + page._patchCount);
    // 反向证明：如果拆掉 _avgMapPid 校验就会贴错（模拟"没这行守卫"的后果）
    const pageX = mkPage(makeReq());
    pageX.data.products = freshProducts();
    await pageX.loadAvgTargets(18);
    pageX.data.products = freshProducts();
    pageX.data.period = { id: 19, name: '下一期' };
    pageX._avgMapPid = '19';  // 伪造成"新一期的数据到了"但内容还是旧的
    pageX.applyAvgToRows();
    const wrong = pageX.data.products.filter(p => p.avgText).length;
    chk('D23c', wrong === 1, '反例对照：键对上一次就贴 1 行 ⇒ 证明 D23b 的 0 是校验生效、不是"没数据"',
      '伪造pid后贴出=' + wrong);
    // 切回 18：恢复
    page.data.products = freshProducts();
    page.data.period = { id: 18, name: '本期' };
    page.applyAvgToRows();
    chk('D23d', page.data.products.find(p => Number(p.id) === PROD_ID).avgText === '均单目标 600 提',
      '切回 18 提示恢复', '');
    // 同一期次不重复请求
    const n0 = page._avgPid;
    await page.loadAvgTargets(18);
    chk('D23e', page._avgPid === n0, '同期次二次调用 loadAvgTargets 直接短路（不重复打接口）',
      '_avgPid=' + page._avgPid);
  }

  /* ── D24 ────────────────────────────────────────────────────────── */
  sec('D24 目标接口失败不影响报单');
  {
    const page = mkPage(makeReq({ avgFails: true }));
    page.data.products = freshProducts();
    let threw = null;
    try { await page.loadAvgTargets(18); } catch (e) { threw = e; }
    chk('D24a', threw === null, 'avg-target 失败时 loadAvgTargets **不抛**（提示失败不阻断页面）',
      threw ? String(threw) : 'no throw');
    chk('D24b', Object.keys(page._avgMap).length === 0 && page.data.products.filter(p => p.avgText).length === 0,
      '只是没有提示（不弹错、不打卡 loading）', '');
    chk('D24c', page._avgPid === '', '失败不记缓存 ⇒ 下次进页/切期次可重试', '_avgPid=' + JSON.stringify(page._avgPid));
    // 报单主链路照常：填数量 + 提交（在提交确认处取消，证明走到了那一步）
    page.data.cart = [{ key: 'k', id: PROD_ID, name: ROW.name, unit: ROW.unit, qty: 5 }];
    page.data.cartQty = 5;
    page.wxMock._answer = { '确认提交预报？': false };
    await page._doSubmit();
    const titles = page.wxMock.modalCalls.map(x => x.title);
    chk('D24d', titles[0] === '确认提交预报？',
      '报单与提交完全正常（无均单数据时直接走提交确认）', JSON.stringify(titles));
    chk('D24e', page.wxMock.toastCalls.length === 0, '全程无 toast 报错', JSON.stringify(page.wxMock.toastCalls));
  }

  /* ── 汇总 ───────────────────────────────────────────────────────── */
  const fail = R.filter(x => !x.ok);
  console.log('\n' + '='.repeat(64));
  console.log('v279 小程序切面判据：' + (R.length - fail.length) + '/' + R.length + ' 通过');
  if (fail.length) {
    console.log('未通过：');
    fail.forEach(x => console.log('  ✗ ' + x.id + ' ' + x.msg + '  << ' + x.detail));
  }
  const hard = ['D19', 'D20', 'D21'];
  const hardFail = fail.filter(x => hard.some(h => x.id.startsWith(h)));
  console.log('硬标准 D19/D20/D21：' + (hardFail.length ? 'FAIL' : 'ALL PASS'));
  console.log('='.repeat(64));
  fs.writeFileSync('/tmp/v279mp/judge_result.json', JSON.stringify(R, null, 1), 'utf8');
  process.exit(fail.length ? 1 : 0);
})();
