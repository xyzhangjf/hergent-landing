/**
 * v319d 商品目标「搜索后点商品无响应」· 生产只读探针
 * ============================================================
 * 老板原话：「在预报订单管理--商品目标中创建商品目标时，通过商品搜索框搜索并点击某个
 *            商品后没有任何响应，无法将该商品选中。」
 *
 * 🔴 要分辨的是**两个截然不同的真相**（只有真机能分）：
 *    A. handler 执行了、状态也改了，但**界面反馈弱到看不出来**（下拉不关、无 toast、
 *       选中态只有一层浅底色）⇒ 用户感知 = "没反应"、错误地以为"没选中"。
 *    B. `pickProduct` 在第 2 行 `if (!p.can_target) return` **静默早退**
 *       （商品缺大单位换算 ⇒ 后端 `can_target=false`）⇒ 真的没选中、且**零提示**。
 *   A 与 B 的症状在用户嘴里是同一句话，修法完全不同：
 *     A ⇒ 补强反馈（关下拉 + 常显「已选：XXX」+ 明确选中态）
 *     B ⇒ 不能只补反馈，必须**说出为什么**（点了缺换算的行要当场告诉他原因 + 出口）
 *
 * 🔴 生产 bundle 读不到组件内部状态（`__vueParentComponent` 只在 __DEV__ 注入）⇒
 *    **判据一律取可见副作用**：
 *      · `button.pt-pick-item.on` 的**个数**（选中态唯一的视觉载体）
 *      · `.pt-qty-u` 的文本（目标单位随商品回填）
 *      · toast 节点个数
 *      · modal 区 bodyLen 变化
 *      · `.on` 行与相邻普通行的 computedStyle 差异（量化"反馈有多弱"）
 *
 * 🔴 只读纪律：装非 GET 哨兵；只**打开**弹窗、点商品行、点搜索框；
 *    **绝不点「保存」**、绝不提交任何写请求。
 */
import fs from 'node:fs'
import { launch } from './lib/cdp-lite.mjs'

const BASE = 'https://hergent.cn'
const TOKEN = process.env.PROBE_TOKEN || ''
const OUT = process.env.PROBE_OUT
  || '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/outputs/v319d-target-pick'
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

/* ═══════════ 页面内：状态快照（一次取全，避免多次 eval 期间状态漂移） ═══════════ */
const JS_SNAP = `(function(){
  function vis(el){ if(!el) return false;
    var cs=getComputedStyle(el), r=el.getBoundingClientRect();
    return cs.display!=='none' && cs.visibility!=='hidden' && r.width>0 && r.height>0 }
  var items=[].slice.call(document.querySelectorAll('.pt-pick-item'));
  var ons=items.filter(function(e){return e.classList.contains('on')});
  var dis=items.filter(function(e){return e.classList.contains('dis')});
  var list=document.querySelector('.pt-pick-list');
  var toastEls=[].slice.call(document.querySelectorAll('.toast,.hg-toast,[class*="toast"]')).filter(vis);
  var mu=document.querySelector('.pt-qty-u');
  var modal=document.querySelector('.pt-modal');
  var inEl=document.querySelector('.pt-pick-in');
  var o={};
  ons.forEach(function(e,i){
    var k=items.indexOf(e);
    var prev=items[k-1]||null, next=items[k+1]||null;
    var cs=getComputedStyle(e);
    o['on'+i]={ bg:cs.backgroundColor, fw:cs.fontWeight, color:cs.color,
      text:(e.textContent||'').slice(0,42),
      prevBg: prev? getComputedStyle(prev).backgroundColor : null,
      nextBg: next? getComputedStyle(next).backgroundColor : null };
  });
  return JSON.stringify({
    pickVisible: vis(list),
    itemTotal: items.length,
    canTarget: items.length-dis.length,
    disabled: dis.length,
    onCount: ons.length,
    on: o,
    unitText: mu? (mu.textContent||'').trim() : null,
    toastCount: toastEls.length,
    toastText: toastEls.map(function(e){return (e.textContent||'').slice(0,80)}).join(' | '),
    modalBodyLen: modal? modal.innerHTML.length : 0,
    bodyLen: document.body.innerHTML.length,
    inputVal: inEl? inEl.value : null,
    firstRowText: items[0]? (items[0].textContent||'').slice(0,60) : null,
    firstRowDisabled: items[0]? items[0].classList.contains('dis') : null,
    saveBtnDisabled: (function(){ var b=document.querySelector('.pt-modal-ft .btn-primary, .pt-modal .btn-primary');
      return b? !!b.disabled : null })()
  })
})()`

/* ═══════════ 页面内：按选择器下标做**真实鼠标**点击（CDP 派发，非 el.click()） ═══════════ */
async function clickEl(page, sel, idx) {
  const info = await page.eval(`(function(){
    var els=document.querySelectorAll(${JSON.stringify(sel)});
    var el=els[${idx}]; if(!el) return null;
    el.scrollIntoView({block:'center'});
    var r=el.getBoundingClientRect();
    return JSON.stringify({ x:r.left+r.width/2, y:r.top+r.height/2, w:r.width, h:r.height,
      text:(el.textContent||'').slice(0,50), disabled:el.classList.contains('dis') })
  })()`)
  if (!info) return null
  const b = JSON.parse(info)
  await page.raw.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: b.x, y: b.y })
  await page.raw.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: b.x, y: b.y, button: 'left', clickCount: 1 })
  await page.raw.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', clickCount: 1 })
  return b
}

/* ═══════════ 页面内：在搜索框里打字（走 v-model 认的 input 事件） ═══════════ */
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

const browser = await launch({ headless: true })
const page = await browser.newPage()
await page.enable()

/* ---- 🔴 零写入哨兵：第一条就装 ---- */
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
  /* ════════════════ 相位 0：进「商品目标」页签 ════════════════ */
  console.log('\n【相位 0】深链进商品目标页签 #/forecast?tab=target')
  await page.goto(BASE + '/#/forecast?tab=target', 6000)
  const landed = await page.eval(`JSON.stringify({
    hash: location.hash,
    hasTbar: !!document.querySelector('.pt-tbar'),
    title: (document.querySelector('.page-hd h2')||{}).textContent || ''
  })`)
  const L = JSON.parse(landed)
  ok(L.hasTbar, '落到了「商品目标」页签（有 .pt-tbar 工具栏）', 'hash=' + L.hash + ' title=' + T(L.title))

  /* ════════════════ 相位 1：点「新建目标」开弹窗 ════════════════ */
  console.log('\n【相位 1】点「新建目标」打开弹窗，先数清列表构成')
  const nb = await page.eval(`(function(){
    var b=document.querySelector('.pt-tbar .btn-primary'); if(!b) return null;
    b.click(); return (b.textContent||'').trim()
  })()`)
  ok(nb === '新建目标', '点到了「新建目标」按钮', '文本=' + nb)
  await sleep(1500)
  let s1 = JSON.parse(await page.eval(JS_SNAP))
  ok(s1.modalBodyLen > 0, '弹窗已打开且渲染出内容', 'modalBodyLen=' + s1.modalBodyLen)
  ok(s1.itemTotal > 0, '选品列表已加载出商品行', '共 ' + s1.itemTotal + ' 行')
  // 🔴 判别力自证：正控（可点行）与反例（灰行）必须**同时**存在，否则本探针分不出 A/B
  ok(s1.canTarget > 0 && s1.disabled > 0,
    '判别力自证：可点行与灰行同时存在',
    '可点 ' + s1.canTarget + ' / 灰行 ' + s1.disabled)
  ok(s1.onCount === 0 && s1.toastCount === 0 && s1.unitText === '箱',
    '基线干净：无选中态 / 无 toast / 单位是默认「箱」',
    'on=' + s1.onCount + ' toast=' + s1.toastCount + ' unit=' + s1.unitText)
  await page.screenshot(OUT + '/01-modal-open.png')

  /* ════════════════ 相位 2（正控）：点第一个**可设目标**的行 ════════════════ */
  console.log('\n【相位 2｜正控】点一个「可设目标」的商品行')
  const c1 = await clickEl(page, '.pt-pick-item:not(.dis)', 0)
  ok(!!c1, '找到并点了第一个可点行', c1 ? T(c1.text).slice(0, 34) : '')
  await sleep(700)
  const s2 = JSON.parse(await page.eval(JS_SNAP))
  const on = s2.on[Object.keys(s2.on)[0]] || null

  const engaged = s2.onCount >= 1
  ok(engaged, '【判据 A】点击后出现选中态标记 .pt-pick-item.on',
    'on=' + s2.onCount + '（点前 0）')
  ok(s2.toastCount === 0, '点击**没有**任何 toast 提示（静默）', 'toast=' + s2.toastCount)
  ok(s2.pickVisible === true, '点击后选品下拉**仍然敞着**（不关闭、不收起）',
    'pickVisible=' + s2.pickVisible + ' inputVal=' + JSON.stringify(s2.inputVal))
  const unitChanged = s2.unitText !== s1.unitText
  console.log('      ↳ 目标单位文本：点前「' + s1.unitText + '」→ 点后「' + s2.unitText + '」'
    + (unitChanged ? '（变了，但只是单位名，不是"我选中了哪件商品"）' : '（未变）'))
  ok(Math.abs(s2.modalBodyLen - s1.modalBodyLen) < 400,
    '弹窗整体内容长度几乎没变 ⇒ 界面上没有新增任何「已选中」信息块',
    'Δ=' + (s2.modalBodyLen - s1.modalBodyLen))
  if (on) {
    console.log('      ↳ 选中态 vs 相邻行的计算样式：')
    console.log('         选中行 background=' + on.bg + ' font-weight=' + on.fw)
    console.log('         上一行 background=' + on.prevBg + ' / 下一行 background=' + on.nextBg)
    ok(!!on.bg && on.bg !== on.prevBg && on.bg !== on.nextBg,
      '选中态与相邻行**确有**颜色差（不是完全没反馈）',
      on.bg + ' vs ' + on.nextBg)
  }
  ok(s2.saveBtnDisabled !== false || true, '（仅记录）保存按钮 disabled=' + s2.saveBtnDisabled)
  await page.screenshot(OUT + '/02-picked-ok.png')

  /* ════════════════ 相位 3（反例）：搜一个**缺换算**的商品并点它 ════════════════ */
  console.log('\n【相位 3｜反例】搜「每日鲜酪」点缺换算的灰行')
  // 先复位：把搜索词清空再搜，避免与相位 2 的选中态混淆
  const typed = await typeSearch(page, '每日鲜酪')
  await sleep(1400)
  const s3 = JSON.parse(await page.eval(JS_SNAP))
  ok(typed === '每日鲜酪', '搜索词已写入搜索框', 'inputVal=' + s3.inputVal)
  ok(s3.itemTotal > 0, '搜到了商品行', '共 ' + s3.itemTotal + ' 行（可点 ' + s3.canTarget + ' / 灰 ' + s3.disabled + '）')

  if (s3.disabled > 0) {
    const beforeOn = s3.onCount
    const c2 = await clickEl(page, '.pt-pick-item.dis', 0)
    ok(!!c2, '找到并点了第一个**灰行**', c2 ? T(c2.text).slice(0, 40) : '')
    await sleep(700)
    const s4 = JSON.parse(await page.eval(JS_SNAP))
    console.log('      ↳ 点灰行后：on=' + s4.onCount + '（点前 ' + beforeOn + '）'
      + ' toast=' + s4.toastCount + ' ΔbodyLen=' + (s4.bodyLen - s3.bodyLen))
    ok(s4.onCount === beforeOn,
      '【判据 B】点灰行后选中态**没有任何变化** ⇒ 静默早退、真的没选中',
      'on=' + s4.onCount)
    ok(s4.toastCount === 0,
      '点灰行**连一句「为什么不能选」都没有** ⇒ 用户只会看到"点了没反应"',
      'toast=' + s4.toastCount + ' text=' + JSON.stringify(s4.toastText))
    await page.screenshot(OUT + '/03-disabled-click.png')
  } else {
    console.log('  ⚠️ 该关键词没搜到灰行 ⇒ 反例未能取证（换关键词重跑可补）')
    ok(false, '反例取证：搜「每日鲜酪」应命中缺换算商品', '灰行数=0')
  }

  /* ════════════════ 相位 4：控制台与写入哨兵 ════════════════ */
  console.log('\n【相位 4】控制台与写入纪律')
  ok(page.errors.length === 0, '全程控制台零报错（所以用户看不到任何线索）',
    page.errors.slice(0, 3).join(' / ') || '无')
  ok(writes.length === 0, '零写入：全程无非 GET 请求（未点保存、未提交）',
    writes.slice(0, 3).join(' / ') || '无')
  await page.screenshot(OUT + '/04-final.png')
} finally {
  await browser.close()
}

console.log('\n──────────────────────────────────────')
console.log('PASS ' + pass + ' / FAIL ' + fail)
if (fails.length) console.log('失败项：\n  - ' + fails.join('\n  - '))
console.log('截图目录：' + OUT)
process.exit(fail ? 1 : 0)
