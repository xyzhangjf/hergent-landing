/* ============================================================================
   中国大陆法定节假日 / 调休日 静态数据表
   ----------------------------------------------------------------------------
   数据来源：国务院办公厅《关于2026年部分节假日安排的通知》
             （国办发明电〔2025〕7号，2025-11-04 发布）

   维护方式：每年 11 月国务院发布次年安排后，在 TABLE 里新增一个年份键，
             照抄通知里的 7 条即可（一条 = 一个 period）。找不到年份时一律返回 null
             （不做任何标注）—— 宁可少标不可误标：错的「休/班」会误导备货与排班。
             抄完用 `listYear(年)` 对一遍总数：官方口径 2026 年是 33 天休 + 6 天调休班。

   ⚠️ 只登记「法定节假日 + 调休日」。不登记：
      · 节气（清明当日已在清明节区间内，不再单列寒露/霜降等）
      · 普通周六周日（每月都有，标了等于没标）
      · 非法定纪念日（重阳节、七夕、万圣夜等）
   ============================================================================ */

// 每个 period = 通知里的一条。字段与通知原文逐字对应，便于逐年核对：
//   name    节日名（如「中秋节」）
//   from/to 放假区间（含首尾）
//   label   区间内「法定节假日当天」—— 面板上用 name 替换该天日期的那一天
//           元旦/劳动节/国庆节取区间首日；清明/端午/中秋取节气或农历当日；
//           春节取正月初一（除夕另见 extra）
//   extra   区间内的其他命名日（目前仅春节的「除夕」）
//   work    调休上班日（均落在周六/周日）
const TABLE = {
  2026: {
    periods: [
      // 一、元旦：1月1日（周四）至3日（周六）放假调休，共3天
      { name: '元旦', from: '2026-01-01', to: '2026-01-03', label: '2026-01-01', work: ['2026-01-04'] },
      // 二、春节：2月15日（农历腊月二十八、周日）至23日（农历正月初七、周一）放假调休，共9天
      { name: '春节', from: '2026-02-15', to: '2026-02-23', label: '2026-02-17', extra: { '2026-02-16': '除夕' }, work: ['2026-02-14', '2026-02-28'] },
      // 三、清明节：4月4日（周六）至6日（周一）放假，共3天（清明当日为 4/5）
      { name: '清明节', from: '2026-04-04', to: '2026-04-06', label: '2026-04-05', work: [] },
      // 四、劳动节：5月1日（周五）至5日（周二）放假调休，共5天
      { name: '劳动节', from: '2026-05-01', to: '2026-05-05', label: '2026-05-01', work: ['2026-05-09'] },
      // 五、端午节：6月19日（周五）至21日（周日）放假，共3天
      { name: '端午节', from: '2026-06-19', to: '2026-06-21', label: '2026-06-19', work: [] },
      // 六、中秋节：9月25日（周五）至27日（周日）放假，共3天（无需调休）
      { name: '中秋节', from: '2026-09-25', to: '2026-09-27', label: '2026-09-25', work: [] },
      // 七、国庆节：10月1日（周四）至7日（周三）放假调休，共7天。9月20日（周日）、10月10日（周六）上班
      //     ⚠️ 9/20 在通知里挂在「国庆节」项下（中秋 3 天无需补班，国庆 7 天需 2 天补班），
      //        不要按"挨着中秋所以是中秋的调休"归到中秋 —— 归属以通知原文为准。
      { name: '国庆节', from: '2026-10-01', to: '2026-10-07', label: '2026-10-01', work: ['2026-09-20', '2026-10-10'] },
    ],
  },
}

const DAY = 86400000

// 把 'YYYY-MM-DD' 当 UTC 零点解析：只做日期加减，不受本地时区/夏令时影响
function toTs(s) {
  const p = String(s).split('-')
  return Date.UTC(+p[0], +p[1] - 1, +p[2])
}
function toStr(ts) {
  const d = new Date(ts)
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return d.getUTCFullYear() + '-' + mm + '-' + dd
}

/**
 * 查询某天的节假日属性。
 * @param {string} dateStr 形如 '2026-09-25'（后端 /api/weather 的 days[].date 即为该格式）
 * @returns {{name:string, showName:boolean, period:string, off:boolean, work:boolean}|null}
 *   off=true  放假日 → 标「休」；showName=true 时用 name 替换日期（法定节假日当天）
 *   work=true 调休上班日 → 标「班」
 *   两者皆 false 或返回 null → 不标注（普通周末、节气、非法定纪念日都不标）
 */
export function cnHoliday(dateStr) {
  if (!dateStr) return null
  const ts = toTs(String(dateStr).slice(0, 10))
  const year = TABLE[new Date(ts).getUTCFullYear()]
  if (!year) return null
  for (const p of year.periods) {
    for (const w of p.work || []) {
      if (toTs(w) === ts) return { name: '', showName: false, period: p.name, off: false, work: true }
    }
    const a = toTs(p.from)
    const b = toTs(p.to)
    if (ts < a || ts > b) continue
    const named = p.extra && p.extra[toStr(ts)]
    const isLabel = toTs(p.label) === ts
    return {
      name: named || p.name,
      showName: !!(named || isLabel),
      period: p.name,
      off: true,
      work: false,
    }
  }
  return null
}

/** 巡检用：列出某年全部休/班日，便于逐年与国务院通知核对 */
export function listYear(year) {
  const y = TABLE[String(year)]
  if (!y) return null
  const rest = []
  const work = []
  for (const p of y.periods) {
    for (let t = toTs(p.from); t <= toTs(p.to); t += DAY) rest.push(toStr(t))
    for (const w of p.work || []) work.push(w)
  }
  rest.sort()
  work.sort()
  return { rest, work }
}

/** 巡检用：某年登记的休/班天数（官方 2026 口径：33 休 / 6 班） */
export function cnHolidayCoverage(year) {
  const r = listYear(year)
  return r ? { rest: r.rest.length, work: r.work.length } : null
}
