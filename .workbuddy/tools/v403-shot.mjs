/**
 * v403 采购订单重塑 —— 可视取证截图（只读真机 https://hergent.cn）
 *
 * 产出 6 张，覆盖两个页面的主要状态：
 *   01-采购单列表-全览.png        18 列 / 状态页签带计数 / 底部合计 / 分页器
 *   02-采购单列表-已勾选与批量操作.png  勾 3 行 → 工具栏「已选择 3 条」+ 批量操作菜单 7 项
 *   03-采购单列表-更多选项展开.png     仓库 / 创建人 / 只看已标记
 *   04-新建采购单-全览.png        表单头 5 字段 / 信息条 / 明细 12 列 / 底部动作条
 *   05-新建采购单-保存下拉.png     保存 / 保存并审核 / 保存并新增下一张
 *   06-采购退货单-空态.png        已退货为 0 ⇒ 空态（页签条不渲染）
 *
 * 运行：
 *   V403_TOKEN=$(ssh -o BatchMode=yes root@47.113.224.140 'python3 /tmp/v392-probe-tokens.py boss' | cut -f3) \
 *   NODE_PATH=/Users/zhangjunfeng/.workbuddy/binaries/node/workspace/node_modules \
 *   /Users/zhangjunfeng/.workbuddy/binaries/node/versions/22.22.2-6/bin/node \
 *     .workbuddy/tools/v403-shot.mjs
 */
import { launch } from './lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = 'https://hergent.cn'
const TOKEN = process.env.V403_TOKEN || ''
const OUT = process.env.V403_OUT || 'outputs/采购订单重塑-v403-2026-10-08'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const INIT = `
;(function(){
  try{
    localStorage.setItem('hergent_v2_token', ${JSON.stringify(TOKEN)});
    localStorage.setItem('hergent_v2_tenant','1');
    localStorage.setItem('hergent_v2_csrf','probe-csrf');
    localStorage.setItem('hergent_v2_user', JSON.stringify({id:2,username:'boss',role:'boss',roles:['boss'],name:'老板'}));
    window.__WRITES = [];
    var of = window.fetch;
    window.fetch = function(u, o){
      try{
        var m = (o && o.method ? o.method : 'GET').toUpperCase();
        var s = (typeof u === 'string') ? u : (u && u.url ? u.url : '');
        if (m !== 'GET' && m !== 'HEAD' && s.indexOf('/api/') >= 0) window.__WRITES.push(m + ' ' + s);
      }catch(e){}
      return of.apply(this, arguments);
    };
  }catch(e){}
})();
`

/* ⚠️ 必须**逐次点击 + await 等一拍**：Vue 的响应式更新是异步的（nextTick），
   同步连点三次会让三次 change 处理器都基于同一份旧 DOM 状态，
   实测只登记 2 条（是探针的竞态，不是页面的 bug —— 250ms 间隔实测 3/3 正确）。 */
const CLICK_ROW_CHECKBOXES = `(async function(){
  var n = 0;
  for (var i = 0; i < 3; i++) {
    var cbs = document.querySelectorAll('table.ipl-tbl tbody td.ipl-c-chk input[type=checkbox]');
    if (!cbs[i]) break;
    cbs[i].click();
    n++;
    await new Promise(function(r){ setTimeout(r, 250); });
  }
  return JSON.stringify({ clicked: n,
    selInfo: document.querySelector('.ipl-selinfo').textContent.replace(/\\s+/g, ' ').trim() });
})();`

const OPEN_BATCH_MENU = `(async function(){
  var btns = document.querySelectorAll('.ipl-tb-r button');
  var b = null;
  for (var i = 0; i < btns.length; i++) if (/批量操作/.test(btns[i].textContent)) b = btns[i];
  if (!b) return 'no batch btn';
  b.click();
  await new Promise(function(r){ setTimeout(r, 300); });
  var mi = document.querySelectorAll('.ipl-menu .ipl-mi');
  var t = []; for (var j = 0; j < mi.length; j++) t.push(mi[j].textContent.trim());
  return JSON.stringify({ items: t });
})();`

const OPEN_MORE = `(async function(){
  var btns = document.querySelectorAll('.ipl-filter button');
  var b = null;
  for (var i = 0; i < btns.length; i++) if (/更多选项/.test(btns[i].textContent)) b = btns[i];
  if (!b) return 'no more btn';
  b.click();
  await new Promise(function(r){ setTimeout(r, 250); });
  var sub = document.querySelector('.ipl-frow-sub');
  return (sub ? sub.textContent : '').replace(/\\s+/g, ' ').trim();
})();`

const OPEN_SAVE_MENU = `(async function(){
  var b = document.querySelector('.ipn-save-caret');
  if (!b) return 'no caret';
  b.click();
  await new Promise(function(r){ setTimeout(r, 300); });
  var mi = document.querySelectorAll('.ipn-menu .ipn-mi');
  var t = []; for (var j = 0; j < mi.length; j++) t.push(mi[j].textContent.trim());
  return JSON.stringify({ items: t });
})();`

const main = async () => {
  if (!TOKEN) { console.error('缺 V403_TOKEN'); process.exit(2) }
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await launch({ headless: true })
  const p = await browser.newPage()
  p.pageErrors = []
  await p.enable()
  await p.addInitScript(INIT)
  try {
    await p.raw.send('Emulation.setDeviceMetricsOverride',
      { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })

    // 01 列表全览
    await p.goto(BASE + '/#/inventory/purchase?kind=order', 5500)
    await p.screenshot(OUT + '/01-采购单列表-全览.png')
    console.log('  01 列表全览 → OK')

    // 02 勾选 + 批量操作菜单
    console.log('  勾选：' + await p.eval(CLICK_ROW_CHECKBOXES))
    console.log('  批量菜单：' + await p.eval(OPEN_BATCH_MENU))
    await p.screenshot(OUT + '/02-采购单列表-已勾选与批量操作.png')
    console.log('  02 已勾选 + 批量操作 → OK')
    await p.eval('document.body.click()')

    // 03 更多选项
    console.log('  更多选项：' + await p.eval(OPEN_MORE))
    await p.screenshot(OUT + '/03-采购单列表-更多选项展开.png')
    console.log('  03 更多选项 → OK')

    // 04 新建采购单
    await p.goto(BASE + '/#/inventory/purchase/new', 5500)
    await p.screenshot(OUT + '/04-新建采购单-全览.png')
    console.log('  04 新建全览 → OK')

    // 05 保存下拉
    console.log('  保存下拉：' + await p.eval(OPEN_SAVE_MENU))
    await p.screenshot(OUT + '/05-新建采购单-保存下拉.png')
    console.log('  05 保存下拉 → OK')

    // 06 退货单空态
    await p.goto(BASE + '/#/inventory/purchase?kind=return', 4500)
    await p.screenshot(OUT + '/06-采购退货单-空态.png')
    console.log('  06 退货单空态 → OK')

    const writes = JSON.parse(await p.eval('JSON.stringify(window.__WRITES || [])'))
    console.log('\n  零写请求：' + (writes.length === 0 ? 'YES' : 'NO → ' + JSON.stringify(writes)))
    console.log('  未捕获异常：' + JSON.stringify(p.pageErrors || []))
    console.log('  产出目录：' + OUT)
  } finally {
    await browser.close()
  }
}

main().catch(e => { console.error('截图异常：', e); process.exit(1) })
