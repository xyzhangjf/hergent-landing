#!/usr/bin/env node
/**
 * self-recursion-scan.mjs —— 扫描「函数体在兜底分支里调用自己」的自递归缺陷
 *
 * 为什么需要它：
 *   2026-09-19 连续两轮，预报页整页崩（ErrorBoundary「页面出错了」）都源于同一族问题——
 *   accessor 的**兜底分支回落到了 accessor 自己**：
 *       function unitCount() { return Array.isArray(cross.value.units) ? unitCount() : 0 }
 *   这个缺陷的特征是「语法完全合法」：
 *     · SFC 编译通过  · npm run build 通过  · 静态正则『这个函数存在吗』也通过
 *     · 只有**页面真的跑起来**才会 `RangeError: Maximum call stack size exceeded`
 *   ⇒ 必须有一条**专门盯这个形状**的静态断言，在构建前就拦下。
 *
 * 用法：
 *   node .workbuddy/tools/self-recursion-scan.mjs <文件路径...>
 *   node .workbuddy/tools/self-recursion-scan.mjs            # 默认扫 Forecast.vue
 *
 * 判定：
 *   提取每个 `function NAME(...) { ... }` 的函数体（按花括号配对，跳过字符串/注释/正则字面量的
 *   简化处理），若函数体内出现 `NAME(` ⇒ 报 FOUND（自带调用的函数，须人工确认是不是**递归算法**；
 *   像树遍历/阶乘那种是有意的，accessor 的兜底分支则是缺陷）。
 *   同时报告该自调用**出现在哪一行**，便于直接定位。
 */
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const files = args.length
  ? args
  : ['/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/src/pages/Forecast.vue']

/** 去掉注释与字符串字面量，用**同长度空格**替换以保持行号/列号不漂移 */
function stripNoise(src) {
  const out = src.split('')
  let i = 0
  const n = src.length
  const blank = (from, to) => {
    for (let k = from; k < to && k < n; k++) if (out[k] !== '\n') out[k] = ' '
  }
  while (i < n) {
    const c = src[i], c2 = src[i + 1]
    if (c === '/' && c2 === '/') {           // 行注释
      let j = i; while (j < n && src[j] !== '\n') j++
      blank(i, j); i = j; continue
    }
    if (c === '/' && c2 === '*') {           // 块注释
      let j = i + 2; while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++
      blank(i, Math.min(j + 2, n)); i = j + 2; continue
    }
    if (c === '"' || c === "'" || c === '`') { // 字符串 / 模板串
      let j = i + 1
      while (j < n && src[j] !== c) {
        if (src[j] === '\\') j++
        j++
      }
      blank(i + 1, j); i = j + 1; continue
    }
    i++
  }
  return out.join('')
}

/** 从 `{` 位置出发做花括号配对，返回结束下标（找不到返回 -1） */
function matchBrace(src, openIdx) {
  let depth = 0
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) return i }
  }
  return -1
}

function lineOf(src, idx) {
  return src.slice(0, idx).split('\n').length
}

let totalFound = 0
const report = []

for (const f of files) {
  if (!fs.existsSync(f)) { report.push(`[SKIP] ${f} 不存在`); continue }
  const raw = fs.readFileSync(f, 'utf8')
  const code = stripNoise(raw)          // 行号与 raw 严格对齐
  const re = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g
  let m
  const seen = new Set()
  while ((m = re.exec(code))) {
    const name = m[1]
    // 找函数体起始 {
    const openIdx = code.indexOf('{', m.index)
    if (openIdx < 0) continue
    const closeIdx = matchBrace(code, openIdx)
    if (closeIdx < 0) continue
    const body = code.slice(openIdx + 1, closeIdx)
    const selfCall = new RegExp(`(^|[^\\w$.])${name.replace(/\$/g, '\\$')}\\s*\\(`)
    if (selfCall.test(body)) {
      const key = name + '@' + openIdx
      if (seen.has(key)) continue
      seen.add(key)
      // 定位自调用所在行 + 该行内容
      const localIdx = body.search(selfCall)
      const absIdx = openIdx + 1 + localIdx
      const ln = lineOf(code, absIdx)
      const rawLine = raw.split('\n')[ln - 1] || ''
      // 是否出现在三元/||/?? 的兜底位（缺陷高发形态）
      const isFallback = /\?\s*$|\?\?\s*$|\|\|\s*$/.test(body.slice(Math.max(0, localIdx - 6), localIdx + 1))
      totalFound++
      report.push(`${isFallback ? '[FOUND!]' : '[FOUND ]'} ${path.basename(f)}:${ln}  function ${name}() 自调用`
        + `${isFallback ? ' —— ⚠️ 出现在三元/兜底分支，几乎可判定为**自递归缺陷**' : '（须人工确认是否递归算法）'}`
        + `\n            源码: ${rawLine.trim()}`)
    }
  }
}

console.log('=== self-recursion-scan ===')
if (!report.length) console.log('干净：未发现任何函数体内自调用。')
else report.forEach(r => console.log(r))
console.log(`\n合计命中：${totalFound}`)
process.exit(0)
