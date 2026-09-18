// v193 交付用对照图（按场景分模式跑，因为两种「无进行中期次」的库状态不同）
//
// 用法: node v193-import-gate-shots.js <TOKEN> <TENANT> <closed|zero> <输出目录>
//   closed —— 沙箱期次**全部 closed** 且**有数据**（= 既定方案 §四.1 记的事故场景：表格非空、
//             旧实现会把新导入的数据挂到已关闭的期次上）
//   zero   —— 沙箱**零期次 + 零数据**（= 全新租户外观），并顺带走一遍「新建期次」拍恢复图
const puppeteer = require('puppeteer-core');
const path = require('path');
const TOKEN = process.argv[2];
const TENANT = process.argv[3] || '9997';
const MODE = (process.argv[4] || 'closed').toLowerCase();
const OUT = process.argv[5] || '/tmp';
const EXEC = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'https://hergent.cn';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 红框标注（不改任何业务代码，只注入 outline）
// ⚠️ `mark` 必须**内联在本函数里**：page.evaluate 只序列化该函数自身，
//    引用 Node 侧的同名 helper 会在浏览器里报 `mark is not defined`（本轮实测踩到）。
function annotate(which) {
  const mark = (el, off) => {
    if (el) { el.style.outline = '3px solid #e11d48'; el.style.outlineOffset = (off === undefined ? 2 : off) + 'px'; }
  };
  const out = {};
  const tb = [...document.querySelectorAll('button')]
    .find(b => b.offsetParent !== null && b.textContent.trim().replace(/\s+/g, '') === '导入');
  const bar = document.querySelector('.gate-bar');
  if (which !== 'open') {
    mark(bar, 2);
    out.banner = bar ? bar.textContent.replace(/\s+/g, ' ').trim() : null;
  }
  mark(tb);
  out.toolbarDisabled = tb ? tb.disabled : null;
  if (which === 'zero') {
    const tr = document.querySelector('table.cross-tbl[role="grid"] tbody tr.empty-row');
    if (tr) { mark(tr.querySelector('td'), -1); out.emptyTitle = tr.querySelector('.er-t').textContent.trim(); }
  }
  return out;
}

function clickBtn(needle) {
  const b = [...document.querySelectorAll('button')]
    .find(x => x.offsetParent !== null && String(x.textContent).includes(needle) && !x.disabled);
  if (!b) return false;
  b.click(); return true;
}

function fillNewPeriod(name, s, e, a) {
  const form = document.querySelector('.new-period');
  if (!form) return { err: 'no-form' };
  const inputs = [...form.querySelectorAll('input')];
  const set = (el, v) => {
    if (!el) return;
    const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
    if (d && d.set) d.set.call(el, v); else el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  set(inputs.find(i => i.type !== 'date' && /名称/.test(i.placeholder || '')), name);
  const ds = inputs.filter(i => i.type === 'date');
  set(ds[0], s); set(ds[1], e); set(ds[2], a);
  const btn = [...form.querySelectorAll('button')].find(x => /创建/.test(x.textContent));
  if (!btn) return { err: 'no-create' };
  btn.click(); return { ok: true };
}

async function main() {
  const browser = await puppeteer.launch({ executablePath: EXEC, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 760, deviceScaleFactor: 2 });
  await page.evaluateOnNewDocument((t, ten) => {
    localStorage.setItem('hergent_v2_token', t);
    localStorage.setItem('hergent_v2_tenant', String(ten));
  }, TOKEN, TENANT);
  await page.goto(BASE + '/?cb=' + Date.now() + '#/forecast', { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(6500);

  if (MODE === 'closed') {
    console.log('closed annotate: ' + JSON.stringify(await page.evaluate(annotate, 'gated')));
    await page.screenshot({ path: path.join(OUT, '01-期次已关闭-导入置灰且横幅提示（沙箱）.png') });
  } else {
    console.log('zero annotate: ' + JSON.stringify(await page.evaluate(annotate, 'zero')));
    await page.screenshot({ path: path.join(OUT, '02-未建期次-导入置灰且空态指路（沙箱）.png') });
    // 清标注 → 走既定流程：新建期次
    await page.evaluate(() => document.querySelectorAll('[style*="outline"]').forEach(e => { e.style.outline = ''; }));
    await sleep(300);
    const opened = await page.evaluate(clickBtn, '新建期次');
    await sleep(700);
    const f = await page.evaluate(fillNewPeriod, 'v193截图期次', '2026-09-18', '2026-09-18', '2026-09-22');
    console.log('create period: opened=' + opened + ' ' + JSON.stringify(f));
    await sleep(5200);
    console.log('open annotate: ' + JSON.stringify(await page.evaluate(annotate, 'open')));
    await page.screenshot({ path: path.join(OUT, '03-已建期次-横幅消失且导入恢复可用（沙箱）.png') });
  }
  await browser.close();
  console.log('DONE');
}
main().catch(e => { console.error('SHOTS_ERROR ' + (e && e.stack || e)); process.exit(3); });
