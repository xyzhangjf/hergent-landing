/**
 * v654 拆组件样式分析器
 *
 * 目的：Forecast.vue 是 <style scoped>，把行模板拆成子组件 ForecastRow.vue 后，
 * 父组件的 scoped 属性不再落在子组件内部元素上，表内部样式会静默失效。
 * 本脚本负责：
 *   1) 解析 Forecast.vue 真正的 <style scoped> 块（不是脚本里打印 HTML 的字符串）
 *   2) 从 ForecastRow.vue 模板里抽出「行内部实际用到的标签 + 类名 + 属性」
 *   3) 逐条判断规则是否作用于行内部元素（按最右复合选择器判定）
 *   4) 输出清单供人工核对
 *
 * 用法：
 *   node tests/perf/v654/analyze-css.cjs            # 汇总
 *   node tests/perf/v654/analyze-css.cjs --list     # 逐条列出候选规则
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');
const PARENT = path.join(ROOT, 'src/pages/Forecast.vue');
const CHILD = path.join(ROOT, 'src/components/forecast/ForecastRow.vue');

/** 取文件最后一个 <style ...> 块（前面几处是脚本里打印/导出 HTML 的字符串） */
function lastStyleBlock(src) {
  let pos = -1;
  let tag = '';
  const re = /<style([^>]*)>/g;
  let m;
  while ((m = re.exec(src))) {
    pos = m.index;
    tag = m[1];
  }
  if (pos < 0) return null;
  const bodyStart = pos + tag.length + 7 /* '<style>'.length */
    + 2 /* m[0] 里 <style 与 > */
    ;
  // 直接用 m 的结束位置更稳
  const gt = src.indexOf('>', pos);
  const end = src.indexOf('</style>', gt);
  return { attrs: tag, css: src.slice(gt + 1, end), startLine: src.slice(0, gt).split('\n').length };
}

/** 逐字符扫描 CSS，返回顶层项（保留 @media 等嵌套结构） */
function parseCss(css) {
  const items = [];
  let j = 0;
  let segStart = 0;
  let depth = 0;
  while (j < css.length) {
    const c = css[j];
    if (c === '/' && css[j + 1] === '*') { const e = css.indexOf('*/', j + 2); j = e < 0 ? css.length : e + 2; continue; }
    if (c === '"') { const e = css.indexOf('"', j + 1); j = e < 0 ? css.length : e + 1; continue; }
    if (c === "'") { const e = css.indexOf("'", j + 1); j = e < 0 ? css.length : e + 1; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) { items.push(css.slice(segStart, j + 1).trim()); segStart = j + 1; }
    }
    j++;
  }
  return items.filter(Boolean);
}

/** 去掉 CSS 注释（分析阶段用；注释不影响选择器判定） */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** 把一个顶层项拆成 {at, cond, prelude, body} */
function splitTop(item) {
  const brace = item.indexOf('{');
  const prelude = item.slice(0, brace).trim();
  const body = item.slice(brace + 1, item.lastIndexOf('}'));
  if (prelude.startsWith('@')) {
    // 形如 `@media(max-width:1461px)`（无空格）、`@media screen and (...)`、`@keyframes name`
    const m = /^(@[a-zA-Z-]+)\s*([\s\S]*)$/.exec(prelude);
    const at = m[1];
    let cond = m[2].trim();
    // `@media(...)` 与 `@media (...)` 统一：去掉括号前的粘连不影响语义，这里保留原样
    return { at, cond, body };
  }
  return { at: null, prelude, body };
}

/** 顶层项 → 规则数组 [{selector, body, media}]，递归展开 @media */
function flattenRules(items, media) {
  const out = [];
  for (const item of items) {
    const t = splitTop(item);
    if (t.at === '@media' || t.at === '@supports' || t.at === '@layer') {
      out.push(...flattenRules(parseCss(t.body), t.at === '@media' ? t.cond : media));
    } else if (t.at) {
      // @keyframes / @font-face 等：整体交给调用方
      out.push({ at: t.at, cond: t.cond, selector: t.prelude || t.at + ' ' + t.cond, body: t.body, media });
    } else {
      out.push({ at: null, selector: t.prelude, body: t.body, media });
    }
  }
  return out;
}

/** 逗号拆分选择器（忽略括号内、属性选择器内、引号内） */
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

/** 取最右复合选择器（按组合符 > + ~ 空格 切分，跳过括号内） */
function rightmostCompound(part) {
  let paren = 0;
  let quote = null;
  let cut = 0;
  for (let i = 0; i < part.length; i++) {
    const c = part[i];
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '(') paren++;
    else if (c === ')') paren--;
    else if (paren === 0 && (c === ' ' || c === '>' || c === '+' || c === '~')) cut = i + 1;
  }
  return part.slice(cut).trim();
}

/** 复合选择器 → {tag, classes, ids, attrs, pseudos, pseudoElem} */
function decomposeCompound(comp) {
  const out = { tag: null, classes: [], ids: [], attrs: [], pseudos: [], pseudoElem: null, raw: comp };
  let i = 0;
  // 类型选择器
  const tagMatch = /^[a-zA-Z][\w-]*/.exec(comp);
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
      out.attrs.push(comp.slice(i, k)); i = k;
    } else if (c === ':') {
      const isDbl = comp[i + 1] === ':';
      const start = i;
      let k = i + (isDbl ? 2 : 1);
      while (k < comp.length && /[\w-]/.test(comp[k])) k++;
      if (comp[k] === '(') {
        let d = 0;
        while (k < comp.length) {
          if (comp[k] === '(') d++;
          else if (comp[k] === ')') { d--; k++; if (d === 0) break; continue; }
          k++;
        }
      }
      const name = comp.slice(start, k);
      if (isDbl) out.pseudoElem = name; else out.pseudos.push(name);
      i = k;
    } else { i++; }
  }
  return out;
}

/** 从子组件模板里抽标签 + 类名 */
function analyzeTemplate(src) {
  const tplStart = src.indexOf('<template>');
  const tplEnd = src.lastIndexOf('</template>');
  let tpl = src.slice(tplStart + 10, tplEnd);
  // 去掉 HTML 注释
  tpl = tpl.replace(/<!--[\s\S]*?-->/g, '');
  const tags = new Set();
  const classes = new Set();
  const tagRe = /<([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let m;
  while ((m = tagRe.exec(tpl))) {
    tags.add(m[1].toLowerCase());
    const attrs = m[2];
    // class="a b" 与 :class="{ 'x': y }" / :class="[cond ? 'a' : 'b']"
    const clsAttr = /\s(?:class|:class)="([^"]*)"/g;
    let c;
    while ((c = clsAttr.exec(attrs))) {
      const literals = c[1].match(/[\w-]+/g) || [];
      for (const lit of literals) {
        // 排除明显的表达式关键字/变量名（含大写或全小写变量不好区分，这里全收，后续人工看）
        classes.add(lit);
      }
    }
  }
  return { tags, classes };
}

function main() {
  const parentSrc = fs.readFileSync(PARENT, 'utf8');
  const childSrc = fs.readFileSync(CHILD, 'utf8');
  const block = lastStyleBlock(parentSrc);
  if (!block) { console.error('未找到 style 块'); process.exit(1); }
  console.log(`父组件 style 块：attrs=${JSON.stringify(block.attrs)} 起始行=${block.startLine} 字节=${Buffer.byteLength(block.css)}`);

  const items = parseCss(stripComments(block.css));
  const rules = flattenRules(items);
  const plain = rules.filter((r) => !r.at);
  const ats = rules.filter((r) => r.at);
  const atKinds = {};
  for (const a of ats) atKinds[a.at] = (atKinds[a.at] || 0) + 1;
  console.log(`顶层项 ${items.length}｜普通规则 ${plain.length}｜at 规则 ${ats.length} ${JSON.stringify(atKinds)}`);
  const medias = new Set(ats.filter((a) => a.at === '@media').map((a) => a.cond));
  console.log(`@media 条件 ${medias.size} 个：${[...medias].join(' | ')}`);

  const tpl = analyzeTemplate(childSrc);
  console.log(`子组件模板标签 ${tpl.tags.size} 个：${[...tpl.tags].join(' ')}`);
  console.log(`子组件模板类名 ${tpl.classes.size} 个`);

  // 行内部一定是 td/th/tr 及其子元素；父模板的其他区域（工具栏、面板、查看表）也大量复用类名，
  // 所以这里以「最右复合选择器的类名全部出现在子组件模板中，且标签 ⊆ 子组件标签」为候选判定。
  const candidates = [];
  const skipped = [];
  for (const r of rules) {
    if (r.at) continue; // @keyframes 等单独处理
    const parts = splitSelectors(r.selector);
    const hit = [];
    const miss = [];
    for (const part of parts) {
      const comp = decomposeCompound(rightmostCompound(part));
      const tagOk = !comp.tag || tpl.tags.has(comp.tag);
      const classOk = comp.classes.length === 0
        ? false // 纯标签/纯属性选择器：可能命中 tr/td，也可能命中父模板；单独列出人工看
        : comp.classes.every((c) => tpl.classes.has(c));
      if (tagOk && classOk) hit.push(part); else miss.push(part);
    }
    if (hit.length) candidates.push({ ...r, hit, miss });
    else skipped.push({ ...r, miss });
  }
  console.log(`\n候选规则（至少一个选择器分支作用于行内部）：${candidates.length} 条`);
  console.log(`纯标签选择器分支（需人工确认）：${skipped.filter((r) => splitSelectors(r.selector).some((p) => decomposeCompound(rightmostCompound(p)).classes.length === 0)).length} 条`);

  const list = process.argv.includes('--list');
  let idx = 0;
  for (const r of candidates) {
    idx++;
    const media = r.media ? `  @media ${r.media}` : '';
    if (list) {
      console.log(`\n[${idx}] ${r.selector}${media}`);
      console.log(`    命中分支: ${r.hit.join(' , ')}`);
      if (r.miss.length) console.log(`    未命中分支: ${r.miss.join(' , ')}`);
      console.log(`    声明: ${r.body.replace(/\s+/g, ' ').trim().slice(0, 160)}`);
    } else {
      console.log(`  ${r.selector}${media}`);
    }
  }

  const outPath = path.join(__dirname, 'candidates.json');
  fs.writeFileSync(outPath, JSON.stringify({ media: [...medias], rules, candidates }, null, 2));
  console.log(`\n明细已写入 ${path.relative(ROOT, outPath)}`);
}

main();
