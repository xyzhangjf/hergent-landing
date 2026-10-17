/**
 * v533-reconcile-head-e2e.mjs —— 对账工作台「上传后表头行下拉」真机验收
 *
 * 背景（用户 2026-10-17 报）：资金管理 › 对账工作台上传文件报
 *   `s.head.map is not a function`。
 * 根因（已定位 + Node 复现逐字一致）：FundsReconcile.vue:371
 *   `s.head = ((await_cached_head(s)) || [])` 漏 await ⇒ Promise（truthy）被塞进 s.head
 *   ⇒ 模板 headOptions(s) 里 `s.head.map` 炸。
 *
 * 要证的事（对 dist-v533 修复版）：
 *   A 上传后：工作表下拉 + 表头行下拉**都有选项**，表头行下拉含「第 5 行：单据时间 / 收入金额 / 支出金额」
 *     （mock 刻意复刻舟谱结构：表头在第 5 行）
 *   B 原始行预览表格有行；「已读取 N 行数据」出现
 *   C 全程 Console 无 `map is not a function`
 * 阴性对照（同一探针打旧构建 dist-v532c）：
 *   D 旧版表头行下拉 option=0 且 Console 捕获 `map is not a function`
 *     ⇒ 证明探针有判别力，不是"反正都过"
 *
 * 🔴 全程 mock：fetch 在 boot 期被替换（addScriptToEvaluateOnNewDocument），
 *    只 mock 对账上传链 4 个端点；其余一律 {ok:true}。零生产调用、零真实数据。
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const DIST = process.argv[2] || 'dist-v533'          // 被打断的构建目录
const PORT = Number(process.argv[3] || 5199)
const SHOT_DIR = process.argv[4] || '/Users/zhangjunfeng/WorkBuddy/Worktrees/laozhangai-product/main-27ed0f5b/outputs/v533-reconcile-head'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
try { fs.mkdirSync(SHOT_DIR, { recursive: true }) } catch { /* ignore */ }

let pass = 0, fail = 0
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  ✅ ' + name + (extra ? '　→ ' + extra : '')) }
  else { fail++; console.log('  ❌ ' + name + (extra ? '　→ ' + extra : '')) }
  return !!cond
}

/* ---------- mock 数据：刻意复刻舟谱账户收支明细（表头在第 5 行） ---------- */
const FILE_ID = 'ab'.repeat(16)
const HEAD = [
  ['舟谱账户收支明细', '', '', '', '', '', '', ''],
  ['账户：福宝（蒙牛低温奶）', '', '', '', '', '', '', ''],
  ['日期：2026-09-01 至 2026-09-30', '', '', '', '', '', '', ''],
  ['', '', '', '', '', '', '', ''],
  ['单据时间', '收入金额', '支出金额', '往来单位', '单据编号', '备注', '', ''],
  ['2026-09-01 08:00:00', '1500.00', '', '永诺旗舰店', 'ZP20260901001', '货款', '', ''],
  ['2026-09-02 10:00:00', '', '2300.50', '蒙牛奶站', 'ZP20260902002', '返利', '', ''],
]
const COLS = ['单据时间', '收入金额', '支出金额', '往来单位', '单据编号', '备注', '列7', '列8']
const ROWS = [
  { '单据时间': '2026-09-01 08:00:00', '收入金额': '1500.00', '支出金额': '', '往来单位': '永诺旗舰店', '单据编号': 'ZP20260901001', '备注': '货款' },
  { '单据时间': '2026-09-02 10:00:00', '收入金额': '', '支出金额': '2300.50', '往来单位': '蒙牛奶站', '单据编号': 'ZP20260902002', '备注': '返利' },
  { '单据时间': '2026-09-03 09:00:00', '收入金额': '880.00', '支出金额': '', '往来单位': '吾悦广场店', '单据编号': 'ZP20260903003', '备注': '货款' },
]
const SUGGEST = {
  mode: 'two_col', confidence: 5,
  date_col: '单据时间', in_col: '收入金额', out_col: '支出金额',
  counterparty_col: '往来单位', key_col: '单据编号', note_col: '备注',
}

/* ---------- boot 期装桩：mock fetch + 种 localStorage 登录态 ---------- */
const INIT = `
window.__mockCalls = [];
localStorage.setItem('hergent_v2_token', 'probe-token-v533');
localStorage.setItem('hergent_v2_user', JSON.stringify({id:9001, role:'boss', username:'probe', display_name:'探针老板'}));
localStorage.setItem('hergent_v2_tenant', '1');
const _j = (o) => new Response(JSON.stringify(o), {status:200, headers:{'Content-Type':'application/json'}});
const _fetch = window.fetch.bind(window);
window.fetch = async function(input, init) {
  const url = typeof input === 'string' ? input : (input && input.url) || '';
  const path = url.split('?')[0];
  const method = (init && init.method) || (input && input.method) || 'GET';
  window.__mockCalls.push(method + ' ' + path);
  if (method === 'POST' && path.endsWith('/api/chat-attachment'))
    return _j({ok:true, file_id:'${FILE_ID}', file_name:'舟谱账户收支明细.xlsx'});
  if (path.endsWith('/api/reconciliation/file-peek'))
    return _j({ok:true, file_id:'${FILE_ID}', sheets:[{name:'账户收支明细', rows:1704, cols:8, head:${JSON.stringify(HEAD)}}]});
  if (path.endsWith('/api/reconciliation/file-rows'))
    return _j({ok:true, file_id:'${FILE_ID}', sheet:'账户收支明细', header_row:4, columns:${JSON.stringify(COLS)}, rows:${JSON.stringify(ROWS)}, row_count:${ROWS.length}, total_rows:1704, suggest:${JSON.stringify(SUGGEST)}, total_row_hints:[]});
  if (path.endsWith('/api/auth/permissions'))
    return _j({permissions:['accounts','inventory','sales','reports'], user:{id:9001, role:'boss', username:'probe', display_name:'探针老板'}, plan:'pro', capabilities:{}, permissions_detail:{accounts:{read:true,create:true,update:true,delete:true}}, perms_rev:'1', custom_roles:[]});
  if (path.endsWith('/api/auth/me'))
    return _j({ok:true, user:{id:9001, role:'boss', username:'probe', display_name:'探针老板'}});
  return _j({ok:true});
};
`

/* 页面内：构造 File 派发 change（headless Chrome 支持 new DataTransfer） */
const JS_UPLOAD = `(function(){
  var inp = document.querySelector('.frc-file-input');
  if (!inp) return JSON.stringify({err:'no file input'});
  var dt = new DataTransfer();
  dt.items.add(new File(['mock'], '舟谱账户收支明细.xlsx', {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
  inp.files = dt.files;
  inp.dispatchEvent(new Event('change', {bubbles:true}));
  return JSON.stringify({ok:true});
})()`

/* 页面内：读表头行下拉状态 */
const JS_STATE = `(function(){
  var sels = document.querySelectorAll('.frc-side select');
  var headSel = sels[1] || null;                       // 第 1 个 = 工作表，第 2 个 = 表头行
  var opts = headSel ? [].slice.call(headSel.options).map(function(o){return o.textContent.trim()}) : [];
  var previewRows = document.querySelectorAll('.frc-hp-tbl tbody tr').length;
  var loadedTxt = '';
  var ld = document.querySelector('.frc-loaded');
  if (ld) loadedTxt = ld.textContent.replace(/\\s+/g,' ').trim();
  var errs = [].slice.call(document.querySelectorAll('.frc-err')).map(function(e){return e.textContent.trim()});
  return JSON.stringify({sheetOpts: sels[0] ? sels[0].options.length : 0, headOpts: opts, previewRows: previewRows, loadedTxt: loadedTxt, errs: errs});
})()`

const browser = await launch({ headless: true })
const page = await browser.newPage()
await page.enable()
const initId = await page.addInitScript(INIT)

console.log('== ' + DIST + ' @ http://127.0.0.1:' + PORT + '/ ==')
await page.goto('http://127.0.0.1:' + PORT + '/#/funds/reconcile', 4500)

const h2 = await page.eval("(document.querySelector('h2')||{}).textContent || ''")
ok(h2.includes('对账工作台'), '页面渲染（h2=对账工作台）', h2.trim())

await page.eval(JS_UPLOAD)
await sleep(3000)

const st = JSON.parse(await page.eval(JS_STATE) || '{}')
ok(st.sheetOpts > 0, '工作表下拉有选项', '共 ' + st.sheetOpts + ' 个')
ok(st.headOpts && st.headOpts.length > 0, '表头行下拉有选项', '共 ' + (st.headOpts || []).length + ' 个')
ok((st.headOpts || []).some(t => t.includes('第 5 行') && t.includes('单据时间')),
   '表头行下拉第 5 项 = 舟谱表头行', (st.headOpts || [])[4] || '(无第 5 项)')
ok(st.previewRows > 0, '原始行预览有行', '共 ' + st.previewRows + ' 行')
ok(/已读取\s*3\s*行数据/.test(st.loadedTxt || ''), '「已读取 3 行数据」文案出现', st.loadedTxt || '(无)')
ok(!(st.errs || []).length, '页面无 .frc-err 报错条', JSON.stringify(st.errs))

const mapErr = (page.errors || []).filter(e => /map is not a function/.test(e))
ok(mapErr.length === 0, 'Console 无 map is not a function',
   mapErr.length ? mapErr[0].slice(0, 120) : '干净（共 ' + (page.errors || []).length + ' 条 console.error）')

await page.screenshot(SHOT_DIR + '/' + DIST + '.png')
await page.removeInitScript(initId)
await browser.close()

console.log('----')
console.log(DIST + '：' + pass + ' 过 / ' + fail + ' 挂')
process.exit(fail ? 1 : 0)
