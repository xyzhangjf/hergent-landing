/* 「下单日」节奏的**唯一实现** —— 字段 `products.order_days`
   （= 该单品**哪天该下单**；与 `arrival_lead_days`「下单后几天到货」是两个正交维度）。

   由来（用户原话）：「已经能给每个商品配到货周期，但下单的时候还是得自己算今天该下哪些单品」。
   到货周期只回答「几天到」，回答不了「哪天该下」——本文件补的就是后者。

   🔴 为什么不是「给每个品配一个具体日期（10月31号）」：绝对日期第二天就失效，
      每天都要重配一遍。所以配的是**周期规则**，判「今天命中」由本文件算。

   存储格式（紧凑串，空串 = 未设置 = 按「每天」处理，不让用户一上来被筛空）：
     'd'                     每天
     'w:1,3,5'               每周几（1=周一 … 7=周日）
     'p:odd' / 'p:even'      单号 / 双号（按日期日号奇偶，31 号 = 单号）
     'm:3,7,11,15,19,23,27'  每月几号
     多段用 '|' 连接 = **任一命中即算**（如 'w:2|p:even'）
   🔴 后端只做**结构校验**（`db/queries/products.py::normalize_order_rule`），
      语义判定与文案只在这里 —— 两处各写一份判定 = 「后端说是、前端说不是」的静默漂移。

   消费面：「本期预报」主表的「下单日」列、工具栏「今日下单」筛选、
          「批量操作 → 批量设置下单日」弹窗（含从品名识别）。 */

/** 1 = 周一 … 7 = 周日（JS 的 getDay() 里 0 = 周日，这里统一换成 ISO 口径）。 */
export function isoWeekday (d) {
  const w = (d instanceof Date ? d : new Date(d)).getDay()
  return w === 0 ? 7 : w
}

const WD_CN = { 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 7: '日' }

/** 把 'w:1,3,5' 的号码段拆成整数数组（保序去重）；非法 → null。 */
function nums (tail, lo, hi) {
  const out = []
  String(tail || '').split(',').forEach(x => {
    const s = String(x).trim()
    if (!/^\d+$/.test(s)) return
    const n = Number(s)
    if (n < lo || n > hi) return
    if (out.indexOf(n) < 0) out.push(n)
  })
  return out.length ? out.sort((a, b) => a - b) : null
}

/**
 * 解析规则串 → 子句数组。认不出返回 []（调用方按「未设置／每天」兜底）。
 * 子句：`{ k:'d' }` / `{ k:'w', v:[1,3] }` / `{ k:'p', v:'odd'|'even' }` / `{ k:'m', v:[3,7] }`
 */
export function parseOrderRule (rule) {
  const s = String(rule == null ? '' : rule).trim()
  if (!s) return []
  const out = []
  s.split('|').forEach(seg => {
    const t = seg.trim()
    if (!t) return
    if (t === 'd') { out.push({ k: 'd' }); return }
    const i = t.indexOf(':')
    if (i < 0) return
    const head = t.slice(0, i).trim().toLowerCase()
    const tail = t.slice(i + 1).trim().toLowerCase()
    if (head === 'w') {
      const v = nums(tail, 1, 7)
      if (v) out.push({ k: 'w', v })
    } else if (head === 'm') {
      const v = nums(tail, 1, 31)
      if (v) out.push({ k: 'm', v })
    } else if (head === 'p' && (tail === 'odd' || tail === 'even')) {
      out.push({ k: 'p', v: tail })
    }
  })
  return out
}

/** 是否「未设置或每天」—— 这类品在「今日下单」里**恒命中**（不让用户一上来被筛空）。 */
export function isOrderEvery (rule) {
  const p = parseOrderRule(rule)
  if (!p.length) return true
  return p.some(c => c.k === 'd')
}

/**
 * 某一天是否命中该规则。
 * 🔴 空串 / 认不出 → true（未设置 = 每天都能下）。这是**刻意的产品口径**：
 *    生产上 187 个品里有 154 个品名无线索、到货周期也多为空，若未设置就判"不下"，
 *    用户点「今日下单」会看到空白表 = 以为数据丢了（v672「177」那次的同一个雷）。
 */
export function orderRuleHit (rule, date) {
  const parts = parseOrderRule(rule)
  if (!parts.length) return true
  const d = date instanceof Date ? date : new Date(date)
  const wd = isoWeekday(d)
  const dom = d.getDate()
  return parts.some(c => {
    if (c.k === 'd') return true
    if (c.k === 'w') return c.v.indexOf(wd) >= 0
    if (c.k === 'p') return c.v === 'odd' ? dom % 2 === 1 : dom % 2 === 0
    if (c.k === 'm') return c.v.indexOf(dom) >= 0
    return false
  })
}

/** 列表文案（列里显示用，尽量短）：'每天' / '单号' / '双号' / '周一三五' / '每月3·7·11' / '未设置'。 */
export function orderRuleText (rule) {
  const parts = parseOrderRule(rule)
  if (!parts.length) return '未设置'
  const out = []
  parts.forEach(c => {
    if (c.k === 'd') out.push('每天')
    else if (c.k === 'w') out.push('周' + c.v.map(n => WD_CN[n]).join(''))
    else if (c.k === 'p') out.push(c.v === 'odd' ? '单号' : '双号')
    else if (c.k === 'm') {
      const v = c.v
      out.push('每月' + (v.length > 4 ? v.slice(0, 4).join('·') + '…' : v.join('·')))
    }
  })
  return out.join(' 或 ') || '未设置'
}

/** 完整文案（弹窗/提示用，把「号」补全，避免「每月3」被读成 3 号还是 3 个）。 */
export function orderRuleFull (rule) {
  const parts = parseOrderRule(rule)
  if (!parts.length) return '未设置（按每天算）'
  return parts.map(c => {
    if (c.k === 'd') return '每天'
    if (c.k === 'w') return '周' + c.v.map(n => WD_CN[n]).join('、')
    if (c.k === 'p') return c.v === 'odd' ? '单号（1、3、5…）' : '双号（2、4、6…）'
    if (c.k === 'm') return '每月 ' + c.v.join('、') + ' 号'
    return ''
  }).filter(Boolean).join('，或')
}

/** 今天是几号/周几（按钮 title 用，让用户知道「今日」的判定基准）。 */
export function todayLabel (date) {
  const d = date instanceof Date ? date : new Date(date)
  return (d.getMonth() + 1) + '月' + d.getDate() + '日 周' + WD_CN[isoWeekday(d)]
}

/* ============================ 从品名识别节奏 ============================
   生产实测（2026-10-31，本期 187 行）：33 个品的**名字里本来就写着节奏**——
     「每日鲜酪蓝莓+3发货(单号下单）」    17 个「单号/双号下单」
     「友芝友汉口老酸奶桂花+4到货（3.7.11.15.19.23.27）」  15 个括号日期清单
     「每日鲜语…（固定每周二，四，五，日下单）」            1 个周几
   一次性把这些翻成规则，用户只校对，比逐个手点快得多（批量弹窗里的「从品名识别」）。

   🔴 刻意**保守**：认不出就返回 null（宁可不填，不乱填）。规则一旦填错，
      「今日下单」会把该下的品筛掉 —— 比不填危险得多。 */

const CN_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7, 七: 7 }

/** 品名 → `{ rule, label, why }`；认不出 → null。 */
export function guessOrderRuleFromName (name) {
  const n = String(name || '')
  if (!n) return null

  /* ① 单号 / 双号（最直白，优先） */
  if (/双号下单|双号发货|逢双/.test(n)) {
    return { rule: 'p:even', label: '双号', why: '品名写了「双号下单」' }
  }
  if (/单号下单|单号发货|逢单/.test(n)) {
    return { rule: 'p:odd', label: '单号', why: '品名写了「单号下单」' }
  }

  /* ② 括号里的日期清单：全角/半角括号，分隔符 . ． , ，、 都认；要求 ≥3 个且都在 1~31
        （单个数字多半是规格，不认） */
  const m = n.match(/[（(]\s*(\d{1,2}(?:\s*[.．,，、]\s*\d{1,2}){2,})\s*[）)]/)
  if (m) {
    const v = []
    String(m[1]).split(/[.．,，、]/).forEach(x => {
      const k = Number(String(x).trim())
      if (k >= 1 && k <= 31 && v.indexOf(k) < 0) v.push(k)
    })
    if (v.length >= 3) {
      v.sort((a, b) => a - b)
      return { rule: 'm:' + v.join(','), label: '每月 ' + v.length + ' 个日期', why: '品名括号里是一串日期' }
    }
  }

  /* ③ 每周几：`每周二，四，五，日` / `每周一三五` / `周1,3,5`
        🔴 只在出现「每周 / 周X下单」时认，避免「周一配送」这类无关字样 */
  if (/每?周/.test(n) && /下单|报单|订货/.test(n)) {
    const seg = n.match(/每周([一二三四五六日天0-9，,、\s]+)/)
    if (seg) {
      const v = []
      const raw = String(seg[1])
      raw.replace(/[一二三四五六日天]/g, ch => {
        const k = CN_NUM[ch]
        if (k && v.indexOf(k) < 0) v.push(k)
        return ch
      })
      raw.replace(/\d/g, dd => {
        const k = Number(dd)
        if (k >= 1 && k <= 7 && v.indexOf(k) < 0) v.push(k)
        return dd
      })
      if (v.length) {
        v.sort((a, b) => a - b)
        return { rule: 'w:' + v.join(','), label: '周' + v.map(x => WD_CN[x]).join(''), why: '品名写了「每周…下单」' }
      }
    }
  }

  /* ④ 「每天 / 天天」 */
  if (/每天|天天|每日[^鲜]/.test(n)) return { rule: 'd', label: '每天', why: '品名写了「每天」' }

  return null
}
