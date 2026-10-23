/**
 * v654 样式改写校验：证明「只改了 scope 属性位置，没改选择器语义」
 *
 * 原理：`:deep(X)` 编译后与普通写法的唯一差别是 `[data-v-x]` 落在哪个复合选择器上。
 *   把新旧两份编译产物里的 `[data-v-x]` 全部删掉、空白归一 —— 若逐条完全相同，
 *   就说明 727 条规则的选择器主体一字未动，改的只有属性位置。
 *   同时逐条比对声明体，确保没有误吞声明。
 *
 * 用法：node tests/perf/v654/verify-compile.cjs <旧.vue> [新.vue]
 */
const fs = require('fs');
const path = require('path');
const { compileStyle } = require('@vue/compiler-sfc');

const ROOT = path.resolve(__dirname, '../../..');
const OLD_FILE = process.argv[2];
const NEW_FILE = process.argv[3] || path.join(ROOT, 'src/pages/Forecast.vue');
const ID = 'data-v-verify';

function styleBody(file) {
  const s = fs.readFileSync(file, 'utf8');
  const re = /<style([^>]*)>/g;
  let m;
  let last = null;
  while ((m = re.exec(s))) last = m;
  const start = last.index + last[0].length;
  return s.slice(start, s.indexOf('</style>', start));
}

function compile(file) {
  const r = compileStyle({ source: styleBody(file), filename: 'Forecast.vue', id: ID, scoped: true });
  return { code: r.code, errors: r.errors || [] };
}

/** 编译产物 → [{sel, body}]（本文件没有嵌套 at-rule，@keyframes 单独跳过） */
function rules(code) {
  const out = [];
  let i = 0;
  const n = code.length;
  while (i < n) {
    const open = code.indexOf('{', i);
    if (open < 0) break;
    const sel = code.slice(i, open).trim();
    // 找匹配的右花括号
    let d = 1;
    let j = open + 1;
    while (j < n && d > 0) { if (code[j] === '{') d++; else if (code[j] === '}') d--; j++; }
    const body = code.slice(open + 1, j - 1);
    if (sel.startsWith('@keyframes') || sel.startsWith('@media') || sel.startsWith('@font-face')) {
      // @keyframes 内部还有规则，整块保留做原样比对
      out.push({ sel, body, at: true });
    } else {
      out.push({ sel, body, at: false });
    }
    i = j;
  }
  return out;
}

const norm = (s) => s
  .replace(new RegExp('\\[' + ID + '\\]', 'g'), '')
  .replace(/\s+/g, ' ')
  .replace(/\s*([>+~,])\s*/g, '$1')
  .trim();

function main() {
  if (!OLD_FILE) { console.error('用法: node verify-compile.cjs <旧.vue> [新.vue]'); process.exit(2); }
  const a = compile(OLD_FILE);
  const b = compile(NEW_FILE);
  console.log(`旧: errors=${a.errors.length} 字节=${a.code.length}`);
  console.log(`新: errors=${b.errors.length} 字节=${b.code.length}`);
  if (b.errors.length) { console.log(b.errors.slice(0, 5).map(String).join('\n')); process.exit(1); }

  const ra = rules(a.code);
  const rb = rules(b.code);
  console.log(`规则数 旧=${ra.length} 新=${rb.length}`);

  let selMismatch = 0;
  let bodyMismatch = 0;
  const selDiff = [];
  const bodyDiff = [];
  const len = Math.max(ra.length, rb.length);
  for (let i = 0; i < len; i++) {
    const x = ra[i];
    const y = rb[i];
    if (!x || !y) { selMismatch++; selDiff.push([i, x && x.sel, y && y.sel, '缺项']); continue; }
    if (norm(x.sel) !== norm(y.sel)) { selMismatch++; if (selDiff.length < 25) selDiff.push([i, x.sel, y.sel]); }
    if (x.body.replace(/\s+/g, '') !== y.body.replace(/\s+/g, '')) {
      bodyMismatch++;
      if (bodyDiff.length < 10) bodyDiff.push([i, x.sel, x.body, y.body]);
    }
  }

  // 属性位置真的变了吗（否则说明没生效）
  const attrOld = (a.code.match(new RegExp('\\[' + ID + '\\]', 'g')) || []).length;
  const attrNew = (b.code.match(new RegExp('\\[' + ID + '\\]', 'g')) || []).length;
  const deepLeftOld = (a.code.match(/:deep\(/g) || []).length;
  const deepLeftNew = (b.code.match(/:deep\(/g) || []).length;

  console.log(`\n空白归一 + 去掉 [${ID}] 后：`);
  console.log(`  选择器不一致: ${selMismatch} 条`);
  console.log(`  声明体不一致: ${bodyMismatch} 条`);
  console.log(`  属性选择器计数 旧=${attrOld} 新=${attrNew}`);
  console.log(`  编译残留 :deep( 旧=${deepLeftOld} 新=${deepLeftNew}`);

  if (selDiff.length) {
    console.log('\n选择器差异样例：');
    for (const d of selDiff) console.log(`  [${d[0]}] 旧: ${d[1]}\n        新: ${d[2]}${d[3] ? '  ' + d[3] : ''}`);
  }
  if (bodyDiff.length) {
    console.log('\n声明体差异样例：');
    for (const d of bodyDiff) console.log(`  [${d[0]}] ${d[1]}\n    旧: ${d[2].slice(0, 120)}\n    新: ${d[3].slice(0, 120)}`);
  }

  const ok = selMismatch === 0 && bodyMismatch === 0 && b.errors.length === 0;
  console.log(ok ? '\n✅ 通过：只改了 scope 属性位置，选择器主体与声明逐条一致' : '\n❌ 未通过');
  process.exitCode = ok ? 0 : 1;
}

main();
