/**
 * v654 拆组件 CSS 作用域修复 —— 选择器改写器
 *
 * 背景：Forecast.vue 的 <style scoped> 编译成 `.edit-tbl td[data-v-p]`。
 *       行模板拆成子组件后，行内 td 带的是子组件的 data-v，父规则一条都打不到。
 * 方案：把「会打到行内部」的选择器改写成 `:deep()` 形式 —— 编译后是
 *       `.edit-tbl[data-v-p] td`，属性选择器从最后一个复合选择器挪到第一个，
 *       **类/属性/元素的计数完全不变 ⇒ 特异度一致；源码顺序不变 ⇒ 层叠顺序一致。**
 *       好处：CSS 只有一份（父组件），不存在父子双份漂移。
 *
 * 判定 needsDeep(branch)（宁可多转，不可漏转；多转只是多一个 :deep，视觉不变）：
 *   ① 最右复合选择器的某个类名出现在子组件模板里
 *   ② 最右复合选择器的标签 ∈ {td, th, tr, tbody}
 *   ③ 分支里任一复合选择器带「只在子组件出现」的类名
 *
 * 用法：
 *   node tests/perf/v654/deepify-css.cjs            # 空跑，只报告
 *   node tests/perf/v654/deepify-css.cjs --write    # 真正写回 Forecast.vue
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');
const PARENT = path.join(ROOT, 'src/pages/Forecast.vue');
const CHILD = path.join(ROOT, 'src/components/forecast/ForecastRow.vue');
const WRITE = process.argv.includes('--write');

/** 单元格标签：最右是它们的规则一定作用在表体行上 */
const CELL_TAGS = new Set(['td', 'th', 'tr', 'tbody']);

function findLastStyleBlock(src) {
  const re = /<style([^>]*)>/g;
  let m;
  let last = null;
  while ((m = re.exec(src))) last = m;
  if (!last) throw new Error('未找到 <style>');
  const bodyStart = last.index + last[0].length;
  const end = src.indexOf('</style>', bodyStart);
  if (end < 0) throw new Error('未找到 </style>');
  return { css: src.slice(bodyStart, end), offset: bodyStart, attrs: last[1] };
}

/** 把注释替换成等长空格（保持偏移不变） */
function maskComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, (c) => ' '.repeat(c.length));
}

/**
 * 扫出所有规则的选择器区间（相对 css 字符串）。
 * 只处理花括号规则与本文件实际存在的 @media 嵌套；@keyframes 内部按深度跳过。
 */
function scanRules(css) {
  const rules = [];
  const masked = maskComments(css);
  const n = css.length;
  let depth = 0;
  let segStart = 0;
  let keyframesDepth = 0;
  let atDepth = 0;
  const stack = [];
  for (let i = 0; i < n; i++) {
    const c = masked[i];
    if (c === '{') {
      if (depth === 0) {
        const prelude = masked.slice(segStart, i);
        const head = prelude.trim();
        if (head.startsWith('@keyframes') || head.startsWith('@font-face') || head.startsWith('@-webkit-keyframes')) {
          keyframesDepth = 1;
        } else if (head.startsWith('@media') || head.startsWith('@supports')) {
          atDepth = 1;
        } else {
          // 普通规则：选择器 = prelude（masked 后）去掉前导空白
          const lead = prelude.length - prelude.trimStart().length;
          rules.push({ selStart: segStart + lead, selEnd: i, depth: 0 });
        }
      } else if (depth === 1 && atDepth === 1) {
        // @media 内的一层规则
        const prelude = masked.slice(segStart, i);
        const lead = prelude.length - prelude.trimStart().length;
        rules.push({ selStart: segStart + lead, selEnd: i, depth: 1 });
      }
      depth++;
      stack.push(i);
    } else if (c === '}') {
      depth--;
      stack.pop();
      if (depth === 0) {
        keyframesDepth = 0;
        atDepth = 0;
        segStart = i + 1;
      }
    }
  }
  return rules;
}

function splitSelectors(sel) {
  const parts = [];
  let cur = '';
  let paren = 0;
  let quote = null;
  for (const c of sel) {
    if (quote) { cur += c; if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; cur += c; continue; }
    if (c === '(') paren++;
    else if (c === ')') paren--;
    if (c === ',' && paren === 0) { parts.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

/** 按组合符切复合选择器（跳过括号/引号内），带偏移，便于原样拼接（不吞掉 > + ~） */
function splitCompounds(branch) {
  const out = [];
  let start = -1;
  let paren = 0;
  let quote = null;
  for (let i = 0; i < branch.length; i++) {
    const c = branch[i];
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '(') { paren++; continue; }
    if (c === ')') { paren--; continue; }
    if (paren === 0 && (c === ' ' || c === '>' || c === '+' || c === '~')) {
      if (start >= 0) { out.push({ text: branch.slice(start, i), start, end: i }); start = -1; }
      continue;
    }
    if (start < 0) start = i;
  }
  if (start >= 0) out.push({ text: branch.slice(start), start, end: branch.length });
  return out;
}

function decompose(comp) {
  const out = { tag: null, classes: [], ids: [] };
  const tagMatch = /^[a-zA-Z][\w-]*/.exec(comp);
  let i = 0;
  if (tagMatch) { out.tag = tagMatch[0].toLowerCase(); i = tagMatch[0].length; }
  while (i < comp.length) {
    const c = comp[i];
    if (c === '.') {
      const m = /^\.([\w-]+)/.exec(comp.slice(i));
      if (!m) break;
      out.classes.push(m[1]); i += m[0].length;
    } else if (c === '#') {
      const m = /^#([\w-]+)/.exec(comp.slice(i));
      if (!m) break;
      out.ids.push(m[1]); i += m[0].length;
    } else if (c === '[') {
      let d = 1; let k = i + 1;
      while (k < comp.length && d > 0) { if (comp[k] === '[') d++; else if (comp[k] === ']') d--; k++; }
      i = k;
    } else if (c === ':') {
      let k = i + 1;
      if (comp[k] === ':') k++;
      while (k < comp.length && /[\w-]/.test(comp[k])) k++;
      if (comp[k] === '(') {
        let d = 0;
        while (k < comp.length) {
          if (comp[k] === '(') d++;
          else if (comp[k] === ')') { d--; k++; if (d === 0) break; continue; }
          k++;
        }
      }
      i = k;
    } else i++;
  }
  return out;
}

/** 从 SFC 模板抽静态类名 + :class 里的字符串字面量 + 动态绑定的状态类名 */
function templateClasses(container) {
  const cls = new Set();
  let tpl = container;
  tpl = tpl.replace(/<!--[\s\S]*?-->/g, '');
  const tagRe = /<([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let m;
  while ((m = tagRe.exec(tpl))) {
    const attrs = m[2];
    // class="a b" / :class="..."（含对象键、数组、三元里的字符串）
    const re = /\s(?:class|:class|v-bind:class)\s*=\s*"([^"]*)"/g;
    let c;
    while ((c = re.exec(attrs))) {
      const val = c[1];
      // 引号内的字面量（'warn-low' / "row-bad"）
      const q = val.match(/'([^']+)'|"([^"]+)"/g) || [];
      for (const s of q) cls.add(s.slice(1, -1).trim());
      // 无绑定的静态 class / 表达式里裸写的类名（如 ['td', c.cls, {frozen: x}]）
      if (!/^\s*(class)\s*$/.test(c[1])) {
        for (const tok of val.match(/[a-zA-Z][\w-]*/g) || []) cls.add(tok);
      } else {
        for (const tok of val.split(/\s+/)) if (tok) cls.add(tok);
      }
    }
  }
  return cls;
}

function templateTags(container) {
  const tags = new Set();
  const re = /<([a-zA-Z][\w-]*)/g;
  let m;
  while ((m = re.exec(container.replace(/<!--[\s\S]*?-->/g, '')))) tags.add(m[1].toLowerCase());
  return tags;
}

/**
 * 是否需要改写。
 * ① 最右复合选择器的**全部**类名都属于「行内」（行内 = 真机指纹里行内出现过的类名 ∪ 行模板字面量）
 *    —— 必须要求「全部」：`.imp-own.warn` / `.imp-arch-note.warn` 这类面板样式里 `warn` 恰好也在行内用，
 *    只看「含行内类名」就会把它们转成 `[data-v] .xxx.warn` 或 `.cross-tbl :deep(.xxx.warn)`，
 *    轻则从**死规则变活规则**（面板颜色凭空变化），重则加错表格锚点直接失效。
 * ② 最右是 td/th/tr/tbody —— 一定作用在表体行上。
 * ③ 最右**没有类名**、标签是行内元素（input/span/b/...），且前面有行内类名作限定。
 *    漏了这条会丢掉 `td.invalid input` 这类「限定在格内子元素」的规则 —— 非法输入框红框就是这么丢的。
 * 不做「分支里出现行内类名就转」的模糊判定：那会连带 `.imp-arch-note.warn` 这类面板样式。
 */
function needsDeep(branch, ctx, stats) {
  if (branch.includes(':deep(') || branch.includes('::v-deep') || branch.includes('/deep/')) return false;
  const comps = splitCompounds(branch);
  if (!comps.length) return false;
  const right = decompose(comps[comps.length - 1].text);
  if (right.classes.length && right.classes.every((c) => ctx.rowCls.has(c))) { stats.byClass++; return true; }
  if (right.tag && CELL_TAGS.has(right.tag)) { stats.byTag++; return true; }
  if (!right.classes.length && right.tag && ctx.rowInnerTags.has(right.tag)) {
    const earlier = comps.slice(0, -1).some((cp) => decompose(cp.text).classes.some((c) => ctx.rowCls.has(c)));
    if (earlier) { stats.byInnerTag++; return true; }
  }
  return false;
}

/**
 * 单个分支 → :deep 形式。
 *
 * 🔴 关键：`:deep(X)` 编译时把 scope 属性加到**紧邻 :deep 前面的那个复合选择器**上。
 *   若整条选择器都塞进 :deep，属性会落到第一个复合选择器上 —— 那可能是组件外的
 *   祖先（如 `[data-density="compact"]` 挂在 <html>），它没有 scope 属性 ⇒ 规则静默失效。
 *   所以必须从右往左找**最后一个属于本组件模板的复合选择器**当锚点，把 :deep 挂在它后面。
 *
 * 返回 { text, anchored }；anchored=false 表示没有锚点（裸类名规则，作用域会扩大到整个组件子树）。
 */
function deepify(branch, parentClasses) {
  let core = branch.trim();
  let pseudo = '';
  const m = /(::[a-zA-Z-]+(?:\([^)]*\))?)\s*$/.exec(core);
  if (m) { pseudo = m[1]; core = core.slice(0, m.index).trim(); }
  if (!core) return null;

  const comps = splitCompounds(core);
  let anchor = -1;
  for (let i = comps.length - 1; i >= 0; i--) {
    const d = decompose(comps[i].text);
    if (d.classes.length && d.classes.every((c) => parentClasses.has(c))) { anchor = i; break; }
  }
  // 属性只会落在 :deep 前面那个复合选择器上。
  // anchor 就是 :deep 目标本身（或根本没锚点）时，前面没有元素可挂 ⇒ 属性落空，
  // 规则变成 `[data-v] <整条>`，作用域 = 整个组件子树。这种情况锚点算「没有」。
  if (anchor < 0 || anchor === comps.length - 1) {
    return { text: ':deep(' + core + ')' + pseudo, anchored: false };
  }
  const head = core.slice(0, comps[anchor].end);
  // 保留原组合符：从「锚点之后」切，`>tbody>tr>td` 会原样进 :deep ⇒ 编译成 `.cross-tbl[data-v] >tbody>tr>td`。
  // 若从下一个复合选择器起始位置切，`>` 会被丢成后代空格 —— 语义从「直接子元素」变成「任意后代」。
  const tail = core.slice(comps[anchor].end);
  return { text: head + ' :deep(' + tail + ')' + pseudo, anchored: true };
}

/**
 * 行内真实类名 —— 以真机渲染指纹为第一依据（比静态解析模板可靠：
 * `:class="c.cls"` 这类数据驱动的类名在模板里根本看不到）。
 * 指纹只采样了 29 行，行状态类可能缺，所以再并上子组件模板里的字面量类名。
 */
function rowClassesFromSnapshot(file) {
  const out = new Set();
  if (!fs.existsSync(file)) return out;
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const n of j.nodes || []) {
    const parts = n.split('|');
    const pathStr = parts[1] || '';
    if (!/^tr\d+$/.test(pathStr)) continue;
    const rest = parts[2] || '';
    const clsPart = rest.slice(rest.indexOf('.') + 1);
    for (const t of clsPart.split(/[\s.]+/)) if (t) out.add(t);
  }
  return out;
}

/** thead / 表尾 / 父模板（.cross-tbl 查看表、工具栏、面板）—— 这些元素留在父组件里 */
function parentClassesFromSnapshot(file) {
  const out = new Set();
  if (!fs.existsSync(file)) return out;
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const n of j.nodes || []) {
    const parts = n.split('|');
    const pathStr = parts[1] || '';
    if (/^tr\d+$/.test(pathStr) || pathStr === 'thead' || pathStr === 'foot') {
      const rest = parts[2] || '';
      const clsPart = rest.slice(rest.indexOf('.') + 1);
      for (const t of clsPart.split(/[\s.]+/)) if (t) out.add(t);
    }
  }
  return out;
}

/** 行内真实出现过的标签名（td/div/input/span/b/svg/...） */
function tagsInsideRows(file) {
  const out = new Set();
  if (!fs.existsSync(file)) return out;
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const n of j.nodes || []) {
    const parts = n.split('|');
    if (!/^tr\d+$/.test(parts[1] || '')) continue;
    const rest = parts[2] || '';
    const tag = (rest.split('.')[0] || '').toLowerCase();
    if (tag) out.add(tag);
  }
  return out;
}

function main() {
  const src = fs.readFileSync(PARENT, 'utf8');
  const childSrc = fs.readFileSync(CHILD, 'utf8');
  const block = findLastStyleBlock(src);

  // 父模板 = 去掉 <style>/<script> 后的 <template> 部分
  const tplStart = src.indexOf('<template>');
  const tplEnd = src.indexOf('</template>', src.lastIndexOf('<script'));
  const parentTpl = src.slice(tplStart, tplEnd > 0 ? tplEnd : src.length);
  const childTpl = childSrc.slice(childSrc.indexOf('<template>'), childSrc.lastIndexOf('</template>'));

  // 类名集合：真机指纹优先，模板字面量兜底
  // 真机指纹文件可用 HG_SNAP 覆盖（探针修过 SVG 类名后要用新取的那份）
  const snapFile = process.env.HG_SNAP
    ? path.resolve(ROOT, process.env.HG_SNAP)
    : path.join(ROOT, 'tests/perf/style-before.json');
  const domRow = rowClassesFromSnapshot(snapFile);
  const domParent = parentClassesFromSnapshot(snapFile);
  const childTplCls = templateClasses(childTpl);
  const parentTplCls = templateClasses(parentTpl);

  /** 行内会出现（或可能出现）的类名 */
  const rowCls = new Set([...domRow, ...childTplCls]);
  /** 父模板/表头/表尾会出现（或可能出现）的类名 */
  const ppCls = new Set([...domParent, ...parentTplCls]);
  /** 行内真实出现过的标签（input/span/b/... 用于判据③）+ 模板里的标签 */
  const rowInnerTags = new Set([...tagsInsideRows(snapFile), ...templateTags(childTpl)]);
  const childOnly = new Set([...rowCls].filter((c) => !ppCls.has(c)));
  const ctx = { rowCls, ppCls, rowInnerTags };

  console.log(`行内类名 ${rowCls.size} 个（真机 ${domRow.size}）| 父侧类名 ${ppCls.size} 个 | 行内独有 ${childOnly.size} 个`);
  console.log(`行内标签: ${[...rowInnerTags].sort().join(' ')}`);

  const rules = scanRules(block.css);
  console.log(`扫到规则 ${rules.length} 条`);

  const stats = { byClass: 0, byTag: 0, byInnerTag: 0 };
  const changes = [];
  const broaden = []; // 没有锚点 ⇒ :deep 作用域扩大到整个组件子树，需人工审
  const alreadyDeep = [];

  // 其它 Forecast 子组件（面板类）用到的类名 —— 作用域扩大时最可能被误伤的就是它们
  const panelDir = path.join(ROOT, 'src/components/forecast');
  const panelClasses = new Set();
  const panelNames = [];
  for (const f of fs.readdirSync(panelDir)) {
    if (!f.endsWith('.vue') || f === 'ForecastRow.vue') continue;
    const s = fs.readFileSync(path.join(panelDir, f), 'utf8');
    const a = s.indexOf('<template>');
    const b = s.lastIndexOf('</template>');
    if (a < 0 || b < 0) continue;
    for (const c of templateClasses(s.slice(a, b))) panelClasses.add(c);
    panelNames.push(f);
  }

  for (const r of rules) {
    const sel = block.css.slice(r.selStart, r.selEnd);
    const branches = splitSelectors(sel);
    let touched = false;
    const outBranches = branches.map((b) => {
      if (b.includes(':deep(')) { alreadyDeep.push(b); return b; }
      if (!needsDeep(b, ctx, stats)) return b;
      let res = deepify(b, ppCls);
      if (!res) return b;
      // 没有锚点（裸类名）且该类名面板也在用 ⇒ 补 `.cross-tbl ` 锚点，别扩大到整个组件子树。
      // 两张表都带 cross-tbl（查看表 `.cross-tbl`、编辑表 `.cross-tbl.edit-tbl`），面板不在表内。
      if (!res.anchored) {
        const comps = splitCompounds(b.trim());
        const right = decompose(comps[comps.length - 1].text);
        const hitPanels = right.classes.filter((c) => panelClasses.has(c));
        // 只有「单个复合选择器」才需要补表格锚点：多复合（如 `.calc.price.miss-price .cell-input`）
        // 本身已经够特定，面板里不会同时命中；再套一层 .cross-tbl 只是噪音。
        if (hitPanels.length && comps.length === 1) {
          res = { text: '.cross-tbl ' + res.text, anchored: true, tableAnchored: hitPanels };
        }
        broaden.push({ sel: b, nd: res.text, classes: right.classes, hitPanels });
      }
      touched = true;
      return res.text;
    });
    if (touched) changes.push({ old: sel, new: outBranches.join(', ') });
  }

  console.log(`\n将改写 ${changes.length} 条规则（${(changes.length / rules.length * 100).toFixed(1)}%）`);
  console.log(`  判据①最右类名全属行内/父侧且含行内: ${stats.byClass} 次`);
  console.log(`  判据②最右是 td/th/tr/tbody: ${stats.byTag} 次`);
  console.log(`  判据③最右是无类名行内标签且前有限定: ${stats.byInnerTag} 次`);
  console.log(`  本来就已是 :deep(): ${alreadyDeep.length} 条（不动）`);

  console.log(`\n无锚点（:deep 会作用于整个组件子树）：${broaden.length} 条`);
  const risky = broaden.filter((b) => b.hitPanels.length);
  console.log(`  其中类名在「其它面板子组件」里也出现（真正需要人工确认）：${risky.length} 条`);
  for (const b of risky) console.log(`    ${b.sel}  ← 面板也在用: ${b.hitPanels.join(' ')}`);

  fs.writeFileSync(path.join(__dirname, 'deepify-report.json'), JSON.stringify({ changes, broaden, alreadyDeep }, null, 2));

  if (!WRITE) {
    console.log('\n（空跑）前 40 条改写预览：');
    for (const c of changes.slice(0, 40)) console.log(`  ${c.old}\n    → ${c.new}`);
    console.log('\n加 --write 才落盘。');
    return;
  }

  // 从后往前拼接，偏移不失效
  let out = src;
  const base = block.offset;
  const sorted = [...rules]
    .filter((r) => block.css.slice(r.selStart, r.selEnd).split(',').length >= 1)
    .sort((a, b) => b.selStart - a.selStart);
  let applied = 0;
  for (const r of sorted) {
    const sel = block.css.slice(r.selStart, r.selEnd);
    const hit = changes.find((c) => c.old === sel);
    if (!hit) continue;
    out = out.slice(0, base + r.selStart) + hit.new + out.slice(base + r.selEnd);
    applied++;
  }
  fs.writeFileSync(PARENT, out);
  console.log(`\n已写回 Forecast.vue，改写 ${applied} 条。`);
}

main();
