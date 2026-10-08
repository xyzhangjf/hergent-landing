/**
 * v318 上线真机冒烟（只读）
 * 1) 用 boss 令牌进 https://hergent.cn/#/forecast，确认没被守卫踢回登录页、页面有实质 DOM、零 pageerror
 * 2) 从**线上真实产物**（公网 HTTP 取）核对本轮判别串是否都编译进去了
 * 3) 截图归档
 * 🔴 全程只读：不点保存、不点关闭期次、不发任何非 GET 请求（页面自身的 GET 除外）
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const TOKEN = process.env.HG_TOKEN
const OUT = process.env.HG_OUT || '/tmp/v318-smoke.png'
if (!TOKEN) { console.log('FATAL 缺 HG_TOKEN'); process.exit(1) }

const ok = (name, cond, extra = '') =>
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? '  ' + extra : ''}`)
let pass = 0, fail = 0
const chk = (n, c, e = '') => { c ? pass++ : fail++; ok(n, c, e) }

const BROWSER = await launch({ headless: true })
const page = await BROWSER.newPage()
await page.enable()

// 非 GET 请求取证（应该只有页面的只读请求；preview 也不会被触发，因为进不了编辑态）
const writes = []
await page.raw.send('Network.enable')
page.raw.onEvent((m) => {
  if (m.method === 'Network.requestWillBeSent') {
    const r = m.params.request
    if (!/^(GET|HEAD|OPTIONS)$/.test(r.method) && /\/api\//.test(r.url)) {
      writes.push(r.method + ' ' + r.url.replace(/^https?:\/\/[^/]+/, '').slice(0, 90))
    }
  }
})

await page.addInitScript(`
  try {
    localStorage.setItem('hergent_v2_token', ${JSON.stringify(TOKEN)});
    localStorage.setItem('hergent_v2_tenant', '1');
  } catch (e) {}
`)

const url = 'https://hergent.cn/?cb=' + Date.now() + '#/forecast'
const landed = await page.goto(url, 7000)
console.log('落地 URL:', landed)

const info = await page.eval(`(function(){
  const body = document.body;
  const pageEl = document.querySelector('.page');
  return {
    hash: location.hash,
    hasPage: !!pageEl,
    pageHtmlLen: pageEl ? pageEl.innerHTML.length : 0,
    bodyTextLen: (body.innerText || '').length,
    tables: document.querySelectorAll('table').length,
    cards: document.querySelectorAll('.card').length,
    localToken: !!localStorage.getItem('hergent_v2_token'),
  };
})()`)
console.log('页面事实:', JSON.stringify(info))

chk('未被守卫踢回登录页', String(info.hash).includes('/forecast'), info.hash)
chk('页面主容器存在且有实质 DOM', info.hasPage && info.pageHtmlLen > 600, 'htmlLen=' + info.pageHtmlLen)
chk('令牌注入成功', info.localToken === true)

// —— 从线上真实产物核对判别串 ——
const markers = await page.eval(`(async function(){
  const H = location.origin + '/';
  const idxHtml = await (await fetch(H + 'index.html?_v=' + Date.now(), {cache:'no-store'})).text();
  const m = idxHtml.match(/assets\\/index-[A-Za-z0-9_-]+\\.js/);
  const entry = m ? m[0] : '';
  const entryTxt = entry ? await (await fetch(H + entry, {cache:'no-store'})).text() : '';
  const fjs = (entryTxt.match(/Forecast-[A-Za-z0-9_-]+\\.js/) || [])[0] || '';
  const fcss = (entryTxt.match(/Forecast-[A-Za-z0-9_-]+\\.css/) || [])[0] || '';
  const fjsTxt = fjs ? await (await fetch(H + 'assets/' + fjs, {cache:'no-store'})).text() : '';
  // 注意：API 路径字面量落在 api 模块 chunk（modules-*.js），不在页面 chunk —— 判据必须扫它
  const mjs = (entryTxt.match(/modules-[A-Za-z0-9_-]+\.js/) || [])[0] || '';
  const mjsTxt = mjs ? await (await fetch(H + 'assets/' + mjs, {cache:'no-store'})).text() : '';
  const fcssTxt = fcss ? await (await fetch(H + 'assets/' + fcss, {cache:'no-store'})).text() : '';
  const cnt = (s, n) => (s.split(n).length - 1);
  return {
    entry, fjs, fcss, mjs,
    mjsLen: mjsTxt.length,
    fjsLen: fjsTxt.length, fcssLen: fcssTxt.length,
    js: {
      'extra-alloc/setup': cnt(mjsTxt + fjsTxt + entryTxt, 'extra-alloc/setup'),
      'extra-alloc/preview': cnt(mjsTxt + fjsTxt + entryTxt, 'extra-alloc/preview'),
      '确认定稿': cnt(fjsTxt, '确认定稿'),
      '取消，继续修改': cnt(fjsTxt, '取消，继续修改'),
      '定稿并推送中': cnt(fjsTxt, '定稿并推送中'),
      '分摊': cnt(fjsTxt, '分摊'),
      '分不满': cnt(fjsTxt, '分不满'),
      '恢复档案原比例': cnt(fjsTxt, '恢复档案原比例'),
      '定稿后将推送给相关人员': cnt(fjsTxt, '定稿后将推送给相关人员'),
    },
    css: {
      'pt-alloc-btn': cnt(fcssTxt, 'pt-alloc-btn'),
      'alloc-modal': cnt(fcssTxt, 'alloc-modal'),
      'close-nf': cnt(fcssTxt, 'close-nf'),
      'has-short': cnt(fcssTxt, 'has-short'),
    },
  };
})()`)
console.log('线上产物判别串:', JSON.stringify(markers, null, 1))

const J = markers.js, C = markers.css
chk('入口 chunk 可解析', !!markers.entry, markers.entry)
chk('Forecast chunk 可解析', !!markers.fjs, markers.fjs)
chk('JS: extra-alloc/setup 已编译', J['extra-alloc/setup'] >= 1, '×' + J['extra-alloc/setup'])
chk('JS: extra-alloc/preview 已编译', J['extra-alloc/preview'] >= 1, '×' + J['extra-alloc/preview'])
chk('JS: 关闭期次弹窗文案「确认定稿」', J['确认定稿'] >= 1, '×' + J['确认定稿'])
chk('JS: 「取消，继续修改」', J['取消，继续修改'] >= 1, '×' + J['取消，继续修改'])
chk('JS: 「定稿并推送中」', J['定稿并推送中'] >= 1, '×' + J['定稿并推送中'])
chk('JS: 「分摊」入口', J['分摊'] >= 1, '×' + J['分摊'])
chk('JS: 「分不满」点名', J['分不满'] >= 1, '×' + J['分不满'])
chk('CSS: pt-alloc-btn', C['pt-alloc-btn'] >= 1, '×' + C['pt-alloc-btn'])
chk('CSS: alloc-modal', C['alloc-modal'] >= 1, '×' + C['alloc-modal'])
chk('CSS: close-nf', C['close-nf'] >= 1, '×' + C['close-nf'])
chk('CSS: has-short', C['has-short'] >= 1, '×' + C['has-short'])

// 旧行为已撤：save-matrix 不再挂通知 → 旧函数名与旧文案不应出现在产物里
const gone = await page.eval(`(async function(){
  const H = location.origin + '/';
  const idxHtml = await (await fetch(H + 'index.html?_v=' + Date.now(), {cache:'no-store'})).text();
  const entry = (idxHtml.match(/assets\\/index-[A-Za-z0-9_-]+\\.js/) || [''])[0];
  const folders = ['Forecast', 'modules', 'Shell', 'index'];
  let all = '';
  for (const f of folders) {
    const re = new RegExp('assets\\\\/' + f + '-[A-Za-z0-9_-]+\\\\.js');
    const name = (entry.match(re) || [])[0];
    // 逐个尝试：直接按前缀在 assets 里猜不可行，改为从入口文本里抽
  }
  const t = await (await fetch(H + entry, {cache:'no-store'})).text();
  const fj = (t.match(/Forecast-[A-Za-z0-9_-]+\\\\.js/) || [''])[0];
  const ft = fj ? await (await fetch(H + 'assets/' + fj, {cache:'no-store'})).text() : '';
  const cnt = (s, n) => s.split(n).length - 1;
  return {
    '_notify_extra_allocs': cnt(t + ft, '_notify_extra_allocs'),
    'message_send': cnt(t + ft, 'message_send'),
  };
})()`)
console.log('撤除面核对（应为 0）:', JSON.stringify(gone))
chk('旧通知函数名/调用未进入产物', gone['_notify_extra_allocs'] === 0 && gone['message_send'] === 0,
  JSON.stringify(gone))

await page.screenshot(OUT)
console.log('截图:', OUT, fs.existsSync(OUT) ? fs.statSync(OUT).size + ' B' : '缺失')
console.log('非 GET 请求:', writes.length ? JSON.stringify(writes) : '（0 条）')
chk('本次冒烟零写入', writes.length === 0, writes.join(' | '))

const errs = page.errors.filter(e => !/40[13]/.test(e))
console.log('页面错误:', errs.length ? JSON.stringify(errs.slice(0, 8)) : '（0 条）')
chk('零 pageerror', errs.length === 0)

console.log(`\n结果：${pass} PASS / ${fail} FAIL`)
await BROWSER.close()
process.exit(fail ? 1 : 0)
