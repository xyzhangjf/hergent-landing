/**
 * v399 留白规范 —— 可视 A/B 对照截图（生产 https://hergent.cn）
 *
 * 为什么用「注入还原」而不是"改前真截图"：
 *   生产已经被改好了，改前状态已不存在。用 `<style>` 注入把**这一次被删掉的那条规则**
 *   原样还原（`.page{max-width:1200px}` ← 就是原 `.page-default` 的效果），
 *   在同一页面、同一视口、同一滚动位置截第二张 ⇒ 差异只可能来自那一条规则。
 *   ⚠️ 诚实的边界：这是**还原**，不是历史快照。标注清楚，不冒充真截图。
 *
 * 自证：注入后必须量到 pageW=1200 / gapL=gapR=216（与改前探针读数一致），
 *      否则说明注入没生效 ⇒ 这张"before"是假的，脚本会报错退出。
 *
 * 运行：
 *   V399_TOKEN=$(ssh -o BatchMode=yes root@47.113.224.140 'python3 /tmp/v392-probe-tokens.py boss' | cut -f3) \
 *   NODE_PATH=/Users/zhangjunfeng/.workbuddy/binaries/node/workspace/node_modules \
 *   /Users/zhangjunfeng/.workbuddy/binaries/node/versions/22.22.2-6/bin/node \
 *     .workbuddy/tools/v399-layout-shot.mjs
 */
import { launch } from './lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = 'https://hergent.cn'
const TOKEN = process.env.V399_TOKEN || ''
const TENANT = '1'
const OUT = 'outputs/留白规范-v399-2026-10-08'
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
`

const MEASURE = `(function(){
  var v = document.querySelector('.view-wrap'), p = document.querySelector('.view-wrap .page');
  if (!v || !p) return JSON.stringify({ err: 'no page' });
  var vs = getComputedStyle(v), ps = getComputedStyle(p);
  var vr = v.getBoundingClientRect(), pr = p.getBoundingClientRect();
  var padL = parseFloat(vs.paddingLeft) || 0, padR = parseFloat(vs.paddingRight) || 0;
  var inner = Math.round(v.clientWidth - padL - padR);
  return JSON.stringify({
    maxW: ps.maxWidth, pageW: Math.round(pr.width), inner: inner,
    gapL: Math.round(pr.left - (vr.left + padL)),
    gapR: Math.round((vr.left + v.clientWidth - padR) - pr.right),
    ratio: inner ? Math.round(pr.width / inner * 1000) / 10 : 0
  });
})()`

/* 原 `.page-default` 的效果（max-width:var(--page-default) = 1200px） */
const INJECT = `
;(function(){
  var s = document.createElement('style');
  s.id = 'v399-restore-before';
  s.textContent = '.view-wrap .page{max-width:1200px !important}';
  document.head.appendChild(s);
  return 'ok';
})()`

const SHOTS = [
  { hash: '#/forecast',               name: '01-本期预报-基准' },
  { hash: '#/inventory/purchase/new', name: '02-进销存-新建采购单' },
  { hash: '#/inventory/purchase',     name: '03-进销存-采购单列表' },
  { hash: '#/inventory/stock',        name: '04-进销存-库存查询' },
]

const main = async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await launch({ headless: true, extraArgs: ['--no-proxy-server'] })
  const p = await browser.newPage()
  await p.enable()
  await p.addInitScript(INIT)
  await p.raw.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })

  await p.goto(BASE + '/?__r=' + Date.now() + '#/workbench', 12000)

  for (const s of SHOTS) {
    await p.eval('location.hash = ' + JSON.stringify(s.hash))
    await sleep(2800)

    const after = JSON.parse(await p.eval(MEASURE))
    await p.screenshot(`${OUT}/${s.name}--A-改后-全宽.png`)
    console.log('  ' + s.hash.padEnd(26) + ' A(改后) ' + JSON.stringify(after))

    await p.eval(INJECT)
    await sleep(700)
    const before = JSON.parse(await p.eval(MEASURE))
    await p.screenshot(`${OUT}/${s.name}--B-改前-限宽1200.png`)
    console.log('  ' + s.hash.padEnd(26) + ' B(还原) ' + JSON.stringify(before))

    /* 🔴 自证：注入必须真的把几何改回 1200/216，否则这张 before 是假的 */
    const ok = String(before.maxW) === '1200px' && before.pageW === 1200
    console.log('  ' + s.hash.padEnd(26) + ' 注入自证=' + (ok ? 'OK' : '🔴 未生效 —— before 图无效'))
    if (!ok) { console.log('中止：注入未生效'); await browser.close(); process.exit(5) }

    /* 撤销注入，回到改后态（下一轮从干净状态开始） */
    await p.eval(`(function(){var s=document.getElementById('v399-restore-before');if(s)s.remove();return 'ok'})()`)
    await sleep(400)
  }

  await browser.close()
  console.log('\n输出目录：' + OUT)
  process.exit(0)
}

main().catch(e => { console.error('截图异常：', e); process.exit(3) })
