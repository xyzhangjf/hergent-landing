/**
 * v654 样式指纹比对：拆行组件前后必须 0 差异。
 *
 * 比对两份 forecast-style-snapshot.mjs 的产物：
 *   1) 结构序列（`depth|路径|tag.class`）逐条相同 —— 拆组件不该改一个节点
 *   2) 每个采样元素 44 个计算样式属性逐项相同 —— 样式既没丢也没被覆盖
 *
 * 用法：node tests/perf/v654/diff-snapshot.cjs <before.json> <after.json>
 */
const fs = require('fs');

const [, , A, B] = process.argv;
if (!A || !B) { console.error('用法: node diff-snapshot.cjs <before.json> <after.json>'); process.exit(2); }
const a = JSON.parse(fs.readFileSync(A, 'utf8'));
const b = JSON.parse(fs.readFileSync(B, 'utf8'));

let fail = 0;

// ① 结构
console.log(`行数: before=${a.rows} after=${b.rows} ${a.rows === b.rows ? '✅' : '❌'}`);
if (a.rows !== b.rows) fail++;
console.log(`结构节点: before=${a.nodes.length} after=${b.nodes.length} ${a.nodes.length === b.nodes.length ? '✅' : '❌'}`);
if (a.nodes.length !== b.nodes.length) fail++;

let nodeDiff = 0;
const nodeSamples = [];
for (let i = 0; i < Math.max(a.nodes.length, b.nodes.length); i++) {
  if (a.nodes[i] !== b.nodes[i]) {
    nodeDiff++;
    if (nodeSamples.length < 12) nodeSamples.push([i, a.nodes[i], b.nodes[i]]);
  }
}
console.log(`结构差异: ${nodeDiff} 处 ${nodeDiff === 0 ? '✅' : '❌'}`);
if (nodeDiff) {
  fail++;
  for (const [i, x, y] of nodeSamples) console.log(`  [${i}] before: ${x}\n        after : ${y}`);
}

// ② 样式
console.log(`样式块: before=${a.styles.length} after=${b.styles.length} ${a.styles.length === b.styles.length ? '✅' : '❌'}`);
if (a.styles.length !== b.styles.length) fail++;

const PROPS = ['display', 'position', 'width', 'height', 'minWidth', 'maxWidth',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'borderTopStyle', 'borderLeftStyle', 'borderTopColor', 'backgroundColor', 'color',
  'fontSize', 'fontWeight', 'lineHeight', 'textAlign', 'verticalAlign', 'whiteSpace',
  'overflowX', 'overflowY', 'zIndex', 'left', 'top', 'right', 'bottom', 'opacity', 'visibility',
  'pointerEvents', 'boxShadow', 'textOverflow', 'flexDirection', 'justifyContent', 'gap', 'transform'];

let elemDiff = 0;
let propDiff = 0;
const propSamples = [];
const byScope = {};

for (let s = 0; s < Math.min(a.styles.length, b.styles.length); s++) {
  const scope = a.styles[s].split(' => ')[0];
  const rowsA = a.styles[s].split(' => ')[1].split('\n');
  const rowsB = b.styles[s].split(' => ')[1].split('\n');
  if (rowsA.length !== rowsB.length) {
    elemDiff++;
    console.log(`  ${scope}: 元素数 before=${rowsA.length} after=${rowsB.length} ❌`);
    continue;
  }
  for (let k = 0; k < rowsA.length; k++) {
    const [idxA, tagA, valsA] = rowsA[k].split('|');
    const [idxB, tagB, valsB] = rowsB[k].split('|');
    if (tagA !== tagB) { elemDiff++; console.log(`  ${scope}[${k}] 标签 ${tagA} → ${tagB} ❌`); continue; }
    if (valsA === valsB) continue;
    elemDiff++;
    const va = valsA.split(';');
    const vb = valsB.split(';');
    for (let p = 0; p < PROPS.length; p++) {
      if (va[p] !== vb[p]) {
        propDiff++;
        byScope[scope] = (byScope[scope] || 0) + 1;
        if (propSamples.length < 40) propSamples.push([scope, k, tagA, PROPS[p], va[p], vb[p]]);
      }
    }
  }
}

console.log(`样式差异元素: ${elemDiff} 个 | 属性差异: ${propDiff} 项 ${elemDiff === 0 ? '✅' : '❌'}`);
if (elemDiff) {
  fail++;
  console.log('  按区块分布:', JSON.stringify(byScope));
  for (const [scope, k, tag, prop, va, vb] of propSamples) {
    console.log(`  ${scope}[${k}] <${tag}> ${prop}: ${va}  →  ${vb}`);
  }
}

console.log(fail === 0 ? '\n✅ 0 差异：拆组件前后渲染完全一致' : `\n❌ 共 ${fail} 类差异`);
process.exitCode = fail === 0 ? 0 : 1;
