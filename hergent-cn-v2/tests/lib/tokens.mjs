/* ============================================================================
   契约里的尺寸解析（v727 建立）
   ----------------------------------------------------------------------------
   🔴 为什么需要它 —— 这是 v727 才想明白的一条因果：

   v727 把 1961 处 font-size、4199 处 gap/padding/margin 从裸 px 换成令牌
   （`font-size:13px` → `font-size:var(--fs-base)`，值完全不变）。结果 **5 个尺寸契约
   全部失败**：它们用 `parseFloat` 直接吃源码里的字面量，遇到 `var(...)` 得到 NaN。

   也就是说：**在这个仓库里，谁把样式令牌化，谁的测试就挂。**
   这才是字号令牌采纳率只有 5%、间距只有 18 处的真正原因 —— 不是大家不愿意用令牌，
   而是用了就要去改一堆契约。

   ⇒ 契约该管的是「最终算出来多少」，不是「源码里写没写 px」。把解析下沉到这里：
   两端都认，令牌改了值契约照样跟着变（不会因此放宽约束）。

   支持：`13px` / `1.6`（倍数，需 ctx.fontSizePx）/ `var(--x)`（可嵌套）/ `var(--x, 兜底)` / `calc(...)`。
   ============================================================================ */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(process.cwd())
let CACHE = null

/** 读 src/styles/variables.css 的全部 `--name: value`（同名取**第一次**出现 = :root 浅色）。 */
export function tokens () {
  if (CACHE) return CACHE
  CACHE = new Map()
  let s = ''
  try {
    s = fs.readFileSync(path.join(ROOT, 'src/styles/variables.css'), 'utf8')
  } catch {
    return CACHE
  }
  s = s.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const m of s.matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;}]+)/g)) {
    if (!CACHE.has(m[1])) CACHE.set(m[1], m[2].trim())
  }
  return CACHE
}

/** 某个令牌的原始值（未解析），如 `fs-base` → `13px`。 */
export function tokenRaw (name) {
  return tokens().get(name.startsWith('--') ? name : '--' + name) ?? null
}

/**
 * 把一个 CSS 值解析成 px 数字；解析不了返回 null。
 * `ctx.fontSizePx` 用于把「倍数」形式的 line-height 折算成 px。
 */
export function pxOf (raw, ctx = {}, depth = 0) {
  if (raw == null) return null
  let v = String(raw).trim().replace(/!\s*important/gi, '').trim()
  if (!v || depth > 6) return null

  if (/^-?\d+(?:\.\d+)?$/.test(v)) {
    return ctx.fontSizePx != null ? parseFloat(v) * ctx.fontSizePx : null
  }
  if (/^-?\d+(?:\.\d+)?px$/i.test(v)) return parseFloat(v)
  if (/^-?\d+(?:\.\d+)?rem$/i.test(v)) return parseFloat(v) * 16

  const vm = /^var\(\s*(--[a-zA-Z0-9-]+)\s*(?:,\s*([\s\S]+))?\)$/.exec(v)
  if (vm) {
    const t = tokens().get(vm[1])
    if (t != null) return pxOf(t, ctx, depth + 1)
    return vm[2] != null ? pxOf(vm[2], ctx, depth + 1) : null
  }

  if (/^calc\(/i.test(v)) return pxOfExpr(v.replace(/^calc\(/i, '').replace(/\)$/, ''), ctx, depth)

  return null
}

function pxOfExpr (expr, ctx, depth) {
  const expanded = expr.replace(/var\(\s*(--[a-zA-Z0-9-]+)\s*(?:,\s*([\s\S]+?))?\)/g, (m, name, fb) => {
    const t = tokens().get(name)
    const px = t != null ? pxOf(t, ctx, depth + 1) : null
    if (px != null) return String(px)
    return fb != null && /^\d/.test(fb.trim()) ? String(parseFloat(fb)) : 'NaN_PART'
  })
  if (!/^[\d\s+\-*/().]+$/.test(expanded)) return null
  try {
    // eslint-disable-next-line no-new-func
    const n = Function('"use strict";return (' + expanded + ')')()
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

/** 从一段声明体里取某属性的原始值（第一条）。 */
export function declOf (body, prop) {
  if (!body) return null
  const m = new RegExp('(?:^|[;{\\s])' + prop + '\\s*:\\s*([^;}]+)').exec(body)
  return m ? m[1].trim() : null
}

/** 从一段声明体里取某属性并解析成 px。 */
export function pxDecl (body, prop, ctx = {}) {
  return pxOf(declOf(body, prop), ctx)
}

/** padding 简写的纵向值（.map(pxOf) 后取第一个，与 CSS 规则一致：1 值全同 / 2+ 值首个即上）。 */
export function padY (raw, ctx = {}) {
  const all = numsOf(raw, ctx)
  return all.length ? all[0] : null
}

/**
 * 把 `10px 14px` / `var(--sp-h10) var(--sp-4)` / `0 auto` 这类简写拆成数值数组。
 * 按**括号深度**切分：`var(--x, 4px)` 内部的空格不是分隔符（v720 用 `split(/\s/)`
 * 曾在别处把 `:where(a, b, c)` 拆坏，同一个坑）。
 */
export function numsOf (raw, ctx = {}) {
  if (raw == null) return []
  const s = String(raw).trim()
  const parts = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (/\s/.test(ch) && depth === 0) {
      if (cur) parts.push(cur)
      cur = ''
    } else cur += ch
  }
  if (cur) parts.push(cur)
  return parts.map((p) => (/^0(?:px)?$/i.test(p) ? 0 : pxOf(p, ctx))).filter((n) => n != null && !Number.isNaN(n))
}
