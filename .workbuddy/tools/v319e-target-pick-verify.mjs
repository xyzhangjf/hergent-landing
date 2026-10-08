/**
 * v319e 商品目标「点商品无响应」修复 · 生产只读验收探针（**判据翻转版**）
 * ============================================================
 * 上一轮（v319d）取证的**旧行为**，本轮全部反过来断言：
 *   旧：点选后列表仍敞着、无任何「已选」显示、选中态只有 6% 淡底色（不可辨）
 *   新：点选后列表收起 + 出现「✓ 商品名 / 1 箱 = N 包 / 重新选择」卡片
 *   旧：点缺换算的灰行 → 静默早退（on 不变、toast 0、bodyLen 变化 0）
 *   新：点它 → 一句 toast 说明原因 + 就地展开「补换算」
 *   旧：`.pt-pick-item:hover:not(.dis)` 权重高于 `.on` ⇒ hover 盖掉选中色
 *   新：hover 收窄为 `:not(.on)` ⇒ 鼠标停上去选中态不再被覆盖
 *   旧：列表 max-height:150px（只看 4~5 行）
 *   新：260px
 *
 * 🔴 只读纪律：装「非 GET 哨兵」；只打开弹窗、点商品行、点重新选择、打字；
 *    **绝不点「保存」**，绝不产生任何写请求。
 * 🔴 选中态可见度：列表收起后 `.on` 行不再同时可见 ⇒ 用「注入类名纯视觉测量」
 *    （只改 DOM class、不碰 Vue 状态、不写后端）量化 hover 让位与左色条。
 */
import fs from 'node:fs'
import { launch } from './lib/cdp-lite.mjs'

const BASE = 'https://hergent.cn'
const TOKEN = process.env.PROBE_TOKEN || ''
const OUT = process.env.PROBE_OUT
  || '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/outputs/v319e-target-pick'
if (!TOKEN) { console.error('缺少 PROBE_TOKEN'); process.exit(2) }
fs.mkdirSync(OUT, { recursive: true })

let pass = 0, fail = 0
const fails = []
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? '   → ' + detail : '')) }
  else { fail++; fails.push(name); console.log('  ❌ ' + name + (detail ? '   → ' + detail : '')) }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const T = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim()

/* ═══════════ 页面内：状态快照 ═══════════ */
const JS_SNAP = `(function(){
  function vis(el){ if(!el) return false;
    var cs=getComputedStyle(el), r=el.getBoundingClientRect();
    return cs.display!=='none' && cs.visibility!=='hidden' && r.width>0 && r.height>0 }
  var items=[].slice.call(document.querySelectorAll('.pt-pick-item'));
  var ons=items.filter(function(e){return e.classList.contains('on')});
  var dis=items.filter(function(e){return e.classList.contains('dis')});
  var list=document.querySelector('.pt-pick-list');
  var card=document.querySelector('.pt-picked');
  var cardBtn=document.querySelector('.pt-picked-change');
  var fixBox=document.querySelector('.pt-fix-box');
  var toastEls=[].slice.call(document.querySelectorAll('.toast,[class*="toast"]')).filter(vis)
    .filter(function(e){ return e!==card });
  var mu=document.querySelector('.pt-qty-u');
  var modal=document.querySelector('.pt-modal');
  var inEl=document.querySelector('.pt-pick-in');
  var convEl=document.querySelector('.pt-qty .pt-quiet');
  return JSON.stringify({
    listVisible: vis(list),
    listMaxH: list? getComputedStyle(list).maxHeight : null,
    itemTotal: items.length,
    canTarget: items.length-dis.length,
    disabled: dis.length,
    onCount: ons.length,
    cardVisible: vis(card),
    cardText: card? (card.textContent||'').replace(/\\s+/g,' ').trim() : null,
    cardBtnText: cardBtn? (cardBtn.textContent||'').trim() : null,
    fixVisible: vis(fixBox),
    fixText: fixBox? (fixBox.textContent||'').replace(/\\s+/g,' ').trim().slice(0,140) : null,
    unitText: mu? (mu.textContent||'').trim() : null,
    convText: convEl? (convEl.textContent||'').trim() : null,
    toastCount: toastEls.length,
    toastText: toastEls.map(function(e){return (e.textContent||'').replace(/\\s+/g,' ').slice(0,110)}).join(' | '),
    modalBodyLen: modal? modal.innerHTML.length : 0,
    inputVal: inEl? inEl.value : null
  })
})()`

/* ═══════════ 页面内：真实鼠标点击（CDP 派发） ═══════════ */
async function clickEl(page, sel, idx) {
  const info = await page.eval(`(function(){
    var els=document.querySelectorAll(${JSON.stringify(sel)});
    var el=els[${idx}]; if(!el) return null;
    el.scrollIntoView({block:'center'});
    var r=el.getBoundingClientRect();
    return JSON.stringify({ x:r.left+r.width/2, y:r.top+r.height/2,
      text:(el.textContent||'').slice(0,60), dis:el.classList.contains('dis') })
  })()`)
  if (!info) return null
  const b = JSON.parse(info)
  await page.raw.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: b.x, y: b.y })
  await page.raw.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: b.x, y: b.y, button: 'left', clickCount: 1 })
  await page.raw.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', clickCount: 1 })
  return b
}

/* ═══════════ 页面内：真实鼠标悬停 ═══════════ */
async function hoverRow(page, idx) {
  const info = await page.eval(`(function(){
    var items=[].slice.call(document.querySelectorAll('.pt-pick-item'));
    var el=items[${idx}]; if(!el) return null;
    el.scrollIntoView({block:'center'});
    var r=el.getBoundingClientRect();
    return JSON.stringify({ x:r.left+r.width/2, y:r.top+r.height/2 })
  })()`)
  if (!info) return null
  const b = JSON.parse(info)
  await page.raw.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: b.x, y: b.y })
  await sleep(160)
  return b
}

async function typeSearch(page, text) {
  return page.eval(`(function(){
    var el=document.querySelector('.pt-pick-in'); if(!el) return 'no-input';
    el.focus();
    var setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
    setter.call(el, ${JSON.stringify(text)});
    el.dispatchEvent(new Event('input',{bubbles:true}));
    return el.value;
  })()`)
}

/* ═══════════ 选中态可见度：注入类名做纯视觉测量（不碰业务状态） ═══════════ */
const JS_ON_PROBE = `(function(){
  var items=[].slice.call(document.querySelectorAll('.pt-pick-item'));
  var i=-1; for(var k=0;k<items.length;k++){ if(!items[k].classList.contains('dis')){ i=k; break } }
  var j=-1; for(var k=0;k<items.length;k++){ if(k!==i && !items[k].classList.contains('dis')){ j=k; break } }
  if(i<0) return JSON.stringify({err:'no-clickable-row'});
  var el=items[i], other=items[j]||null;
  var out={};
  out.restBg = getComputedStyle(el).backgroundColor;
  out.restShadow = getComputedStyle(el).boxShadow;
  el.classList.add('on');
  var cs=getComputedStyle(el);
  out.onBg=cs.backgroundColor; out.onShadow=cs.boxShadow; out.onFw=cs.fontWeight;
  /* 🔴 自纠（v319e 首跑踩到）：必须把**实际注入的下标**带回去。
     首跑把 hover 对照组写死成 items[0]/items[1]，而注入的是「第一个非灰行」；
     当 items[0] 恰好是灰行时，两组都测到了**错误的行** ⇒
     一条假失败（"hover 盖住选中色"）、一条假通过（"非选中行 hover 会变色"其实测的是选中行）。
     ⇒ hover 一律用 p0.i（注入行）/ p0.j（另一非灰行）这两个**实际下标**。 */
  out.i=i; out.j=j;
  out.otherRestBg = other? getComputedStyle(other).backgroundColor : null;
  out.text=(el.textContent||'').replace(/\\s+/g,' ').trim().slice(0,44);
  return JSON.stringify(out)
})()`

const browser = await launch({ headless: true })
const page = await browser.newPage()
await page.enable()

/* ---- 🔴 零写入哨兵 ---- */
const writes = []
try {
  await page.raw.send('Network.enable')
  page.raw.onEvent((msg) => {
    if (msg.method === 'Network.requestWillBeSent') {
      const r = msg.params.request || {}
      const m = String(r.method || '').toUpperCase()
      if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS') writes.push(m + ' ' + String(r.url).slice(0, 130))
    }
  })
} catch (e) { console.log('  (Network.enable 失败：' + e.message + ')') }

await page.addInitScript(
  "(function(){try{"
  + "localStorage.setItem('hergent_v2_token','" + TOKEN + "');"
  + "localStorage.setItem('hergent_v2_tenant','1');"
  + "localStorage.setItem('hergent_v2_user',JSON.stringify({id:1,username:'boss',display_name:'老板',role:'boss'}));"
  + "}catch(e){}})()"
)

try {
  /* ════════════════ 相位 0 ════════════════ */
  console.log('\n【相位 0】深链进商品目标页签（加载的是刚上线的 index-BsASsW-h.js）')
  await page.goto(BASE + '/#/forecast?tab=target', 6500)
  const L = JSON.parse(await page.eval(`JSON.stringify({
    hash: location.hash, hasTbar: !!document.querySelector('.pt-tbar')
  })`))
  ok(L.hasTbar, '落到「商品目标」页签', 'hash=' + L.hash)

  /* ════════════════ 相位 1：打开新建弹窗（未选状态） ════════════════ */
  console.log('\n【相位 1】打开「新建目标」弹窗 —— 未选状态必须是「搜索框 + 列表」')
  const nb = await page.eval(`(function(){
    var b=document.querySelector('.pt-tbar .btn-primary'); if(!b) return null;
    b.click(); return (b.textContent||'').trim()
  })()`)
  ok(nb === '新建目标', '点到「新建目标」', '文本=' + nb)
  await sleep(1600)
  const s1 = JSON.parse(await page.eval(JS_SNAP))
  ok(s1.modalBodyLen > 0, '弹窗已渲染', 'modalBodyLen=' + s1.modalBodyLen)
  ok(s1.itemTotal > 0, '选品列表已加载', '共 ' + s1.itemTotal + ' 行')
  ok(s1.canTarget > 0 && s1.disabled > 0, '判别力自证：可点行与灰行同时存在',
    '可点 ' + s1.canTarget + ' / 灰行 ' + s1.disabled)
  ok(s1.listVisible === true, '未选状态：列表可见', 'listVisible=' + s1.listVisible)
  ok(s1.cardVisible === false, '未选状态：**没有**已选卡片', 'cardVisible=' + s1.cardVisible)
  ok(s1.listMaxH === '260px', '【P1-2】列表高度已是 260px（原 150px）', 'maxHeight=' + s1.listMaxH)
  ok(s1.toastCount === 0 && s1.onCount === 0, '基线干净：无 toast / 无选中标记',
    'toast=' + s1.toastCount + ' on=' + s1.onCount)
  await page.screenshot(OUT + '/01-modal-open.png')

  /* ════════════════ 相位 2：点可点行 ⇒ 已选卡片 ════════════════ */
  console.log('\n【相位 2｜P0-1】点一个「可设目标」的商品行 ⇒ 收起列表 + 出现已选卡片')
  const c1 = await clickEl(page, '.pt-pick-item:not(.dis)', 0)
  ok(!!c1, '点了第一个可点行', c1 ? T(c1.text).slice(0, 40) : '')
  await sleep(800)
  const s2 = JSON.parse(await page.eval(JS_SNAP))
  ok(s2.cardVisible === true, '★判据翻转：出现「已选卡片」.pt-picked', 'cardVisible=' + s2.cardVisible)
  ok(s2.listVisible === false, '★判据翻转：选品列表**已收起**（原：仍然敞着）',
    'listVisible=' + s2.listVisible)
  ok(s2.cardBtnText === '重新选择', '卡片带「重新选择」按钮', 'btn=' + s2.cardBtnText)
  const cardTxt = String(s2.cardText || '')
  ok(/1\s/.test(cardTxt) && cardTxt.includes('='),
    '卡片里摊开了换算（形如「1 箱 = N 包」）⇒ 用户能确认选的是哪件、一箱多少',
    cardTxt.slice(0, 60))
  ok(!!s2.convText, '目标量旁的换算提示仍在（同一份快照数据源）', 'conv=' + s2.convText)
  ok(s2.toastCount === 0, '点选**不需要** toast（卡片本身就是反馈）', 'toast=' + s2.toastCount)
  ok(s2.modalBodyLen < s1.modalBodyLen,
    '★判据翻转：面板内容**变短**了 —— 50 行列表被一张卡片替换（原实现只 +56、结构几乎没变）',
    'Δ=' + (s2.modalBodyLen - s1.modalBodyLen))
  console.log('      ↳ 卡片文本：' + cardTxt)
  await page.screenshot(OUT + '/02-picked-card.png')

  /* ════════════════ 相位 3：重新选择 ⇒ 回到列表且清空选中 ════════════════ */
  console.log('\n【相位 3｜P0-1】点「重新选择」⇒ 回到列表，且选中 id 被清干净')
  const cb = await page.eval(`(function(){
    var b=document.querySelector('.pt-picked-change'); if(!b) return null;
    b.click(); return 'clicked'
  })()`)
  ok(cb === 'clicked', '点到「重新选择」')
  await sleep(600)
  const s3 = JSON.parse(await page.eval(JS_SNAP))
  ok(s3.listVisible === true, '列表回来了', 'listVisible=' + s3.listVisible)
  ok(s3.cardVisible === false, '卡片已消失', 'cardVisible=' + s3.cardVisible)
  ok(s3.onCount === 0, '选中标记为 0 ⇒ form.product_id 已被清掉（不留"看得见 id 却看不到选中项"的中间态）',
    'on=' + s3.onCount)
  await page.screenshot(OUT + '/03-reselected.png')

  /* ════════════════ 相位 4：选中态可见度（注入类名纯视觉测量） ════════════════ */
  console.log('\n【相位 4｜P1-1】选中态可见度：左色条 + hover 让位')
  const p0 = JSON.parse(await page.eval(JS_ON_PROBE))
  ok(!p0.err, '找到可点行做视觉测量', p0.text || '')
  ok(/inset/.test(String(p0.onShadow)) && /3px/.test(String(p0.onShadow)),
    '★选中态有**第二条视觉通道**：左侧 3px 主色实心条（inset 阴影）',
    'boxShadow=' + String(p0.onShadow).slice(0, 70))
  ok(p0.onFw === '600', '选中行同时加粗（三重信号：色条 + 底色 + 加粗）', 'font-weight=' + p0.onFw)
  // 真实鼠标悬停：选中行（注入 .on）应**不被 hover 色覆盖**
  await hoverRow(page, p0.i)
  const hoverOn = JSON.parse(await page.eval(`(function(){
    var items=[].slice.call(document.querySelectorAll('.pt-pick-item'));
    var el=items[${p0.i}];
    return JSON.stringify({ bg:getComputedStyle(el).backgroundColor,
      shadow:getComputedStyle(el).boxShadow, on:el.classList.contains('on') })
  })()`))
  ok(String(hoverOn.shadow).includes('inset'),
    '选中行被 hover 时**左色条仍在**（第二视觉通道不受 hover 影响）',
    'shadow=' + String(hoverOn.shadow).slice(0, 60))
  console.log('      ↳ 选中行 hover 后 background=' + hoverOn.bg + '（静止时 ' + p0.onBg + '）')
  ok(hoverOn.bg === p0.onBg,
    '★判据翻转：鼠标停在选中行上，**背景不再被 hover 色盖掉**（原：hover 权重更高，盖掉选中色）',
    'hover=' + hoverOn.bg + ' vs on=' + p0.onBg)
  // 对照：非选中行 hover **必须**变（否则说明 hover 整体坏了、上一条断言无意义）
  await hoverRow(page, p0.j)
  const hoverOther = JSON.parse(await page.eval(`(function(){
    var items=[].slice.call(document.querySelectorAll('.pt-pick-item'));
    var el=items[${p0.j}];
    return JSON.stringify({ bg:getComputedStyle(el).backgroundColor })
  })()`))
  ok(hoverOther.bg !== p0.otherRestBg,
    '对照反例：**非选中行** hover 仍会变色 ⇒ hover 没被整体关掉（上一条断言有意义）',
    'hover=' + hoverOther.bg + ' vs rest=' + p0.otherRestBg)
  await page.screenshot(OUT + '/04-on-visible.png')
  // 清理注入的类名，避免影响后续相位
  await page.eval(`(function(){
    var items=[].slice.call(document.querySelectorAll('.pt-pick-item'));
    items.forEach(function(e){ e.classList.remove('on') });
    return 'cleared'
  })()`)

  /* ════════════════ 相位 5：点缺换算灰行 ⇒ 有解释 + 就地补换算 ════════════════ */
  console.log('\n【相位 5｜P0-2】搜「每日鲜酪」点缺换算的灰行 ⇒ 必须给出一句原因 + 展开补换算')
  const typed = await typeSearch(page, '每日鲜酪')
  await sleep(1500)
  const s4 = JSON.parse(await page.eval(JS_SNAP))
  ok(typed === '每日鲜酪', '搜索词已写入', 'inputVal=' + s4.inputVal)
  ok(s4.itemTotal > 0, '搜到商品行', '共 ' + s4.itemTotal + ' 行（可点 ' + s4.canTarget + ' / 灰 ' + s4.disabled + '）')

  if (s4.disabled > 0) {
    const c2 = await clickEl(page, '.pt-pick-item.dis', 0)
    ok(!!c2, '点了第一个**灰行**', c2 ? T(c2.text).slice(0, 44) : '')
    await sleep(800)
    const s5 = JSON.parse(await page.eval(JS_SNAP))
    ok(s5.toastCount >= 1, '★判据翻转：点灰行**有提示了**（原：toast=0，完全静默）',
      'toast=' + s5.toastCount)
    const tt = String(s5.toastText || '')
    ok(tt.includes('还没配大单位换算'), '提示说清了**原因**（缺大单位换算）', tt.slice(0, 70))
    ok(tt.includes('补换算'), '提示给出了**出口**（去补换算）', '')
    ok(s5.fixVisible === true, '★并且**自动展开**了「补换算」输入区', 'fixVisible=' + s5.fixVisible)
    ok(String(s5.fixText || '').includes('照商品包装补一处换算'),
      '补换算区给出了可操作的说明', String(s5.fixText || '').slice(0, 70))
    ok(s5.cardVisible === false, '点灰行**不会**误产生「已选卡片」（没选中就是没选中）',
      'cardVisible=' + s5.cardVisible)
    await page.screenshot(OUT + '/05-disabled-explained.png')
  } else {
    ok(false, '反例取证：搜「每日鲜酪」应命中缺换算商品', '灰行数=0')
  }

  /* ════════════════ 相位 6：纪律 ════════════════ */
  console.log('\n【相位 6】控制台与写入纪律')
  ok(page.errors.length === 0, '全程控制台零报错', page.errors.slice(0, 3).join(' / ') || '无')
  ok(writes.length === 0, '零写入：全程无非 GET 请求（未点保存、未提交）',
    writes.slice(0, 3).join(' / ') || '无')
  await page.screenshot(OUT + '/06-final.png')
} finally {
  await browser.close()
}

console.log('\n──────────────────────────────────────')
console.log('PASS ' + pass + ' / FAIL ' + fail)
if (fails.length) console.log('失败项：\n  - ' + fails.join('\n  - '))
console.log('截图目录：' + OUT)
process.exit(fail ? 1 : 0)
