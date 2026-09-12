/* ============================================================================
   中国大陆法定节假日 / 调休日 —— 三层数据源
   ----------------------------------------------------------------------------
   ① 内置静态表 TABLE（精修层 + 离线兜底）
      数据来源：国务院办公厅《关于2026年部分节假日安排的通知》
                （国办发明电〔2025〕7号，2025-11-04 发布）
      它提供两样远端给不了的东西：
        · 接口不可达时的兜底（面板照常标注）
        · **精修信息**：「哪一天是法定当天」（春节=正月初一、清明=节气当日 ——
          远端只给假期区间，取不到这两天）以及春节的「除夕」命名
   ② 远端接口（自动更新层）
      GET /api/weather/holidays —— 后端从 holiday-cn 数据集抓取并落盘缓存，
      每年 11 月国务院发布次年安排后自动生效，**无需改代码、无需重新部署**。
      本文件只负责取用与缓存，不承担抓取。
   ③ 都没有 → 返回 null（不标）—— 宁可少标不可误标：错的「休/班」会误导备货与排班。

   查询优先级：内置表命中即用内置（2026 等已精修的年份行为完全不变）；
   未命中则查远端（2027 起自动生效，节日名落在假期首日）。
   日后若要精修某年（如春节标正月初一），在 TABLE 补一个年份键即可覆盖远端。

   ⚠️ 只登记「法定节假日 + 调休日」。不登记：
      · 节气（清明当日已在清明节区间内，不再单列寒露/霜降等）
      · 普通周六周日（每月都有，标了等于没标）
      · 非法定纪念日（重阳节、七夕、万圣夜等）
   ============================================================================ */

import { ref } from 'vue'

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

/* ---------- 远端层：后端自动抓取，前端只取用与缓存 ------------------------ */
const REMOTE_API = '/api/weather/holidays'
const REMOTE_LS = 'hergent_cn_holidays_v1'
const REMOTE_TTL = 12 * 3600 * 1000        // 12 小时内直接用本地副本，不重复请求

/**
 * 远端年份表：{ '2027': { days: {date: {name, off}}, periods: [...], paper, rest, work } }
 * 用 ref 持有 —— cnHoliday() 在 computed 里被调用时会自动建立依赖，
 * 数据到达后日期行会自己重算（无需在组件里手工触发刷新）。
 */
const remote = ref({})
let remoteAt = 0
let inflight = null

// 启动即恢复本地副本：先渲染再联网，避免「先无标注、后闪一下」的跳变
try {
  const o = JSON.parse(localStorage.getItem(REMOTE_LS) || 'null')
  if (o && o.years) { remote.value = o.years; remoteAt = o.at || 0 }
} catch { /* 隐私模式/禁用存储：忽略，联网路径仍然可用 */ }

/**
 * 拉取远端节假日表（幂等，可重复调用）。
 * 失败时既不抛错也不覆盖已有数据 —— 静态表继续兜底，面板行为不变。
 * @param {boolean} force 忽略本地 TTL 强制刷新
 * @returns {Promise<void>}
 */
export function loadRemoteHolidays(force = false) {
  if (inflight) return inflight
  if (!force && remoteAt && Date.now() - remoteAt < REMOTE_TTL) return Promise.resolve()
  inflight = (async () => {
    try {
      const res = await fetch(REMOTE_API, { headers: { Accept: 'application/json' } })
      if (!res.ok) return
      const j = await res.json()
      const years = (j && j.years) || {}
      if (!Object.keys(years).length) return       // 空表（源站尚未发布）→ 保留旧数据
      remote.value = years
      remoteAt = Date.now()
      try { localStorage.setItem(REMOTE_LS, JSON.stringify({ at: remoteAt, years })) } catch { /* 存不下不影响使用 */ }
    } catch { /* 网络异常：静默回落到静态表 */ } finally { inflight = null }
  })()
  return inflight
}

/** 已加载的远端年份（调试/巡检用） */
export function remoteYears() { return Object.keys(remote.value).sort() }

/* ---------- 查询 ---------------------------------------------------------- */
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

/** 内置表（精修）：命中返回结果，未命中返回 null */
function fromBuiltin(year, ts) {
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

/** 远端表：label（节日名落哪一天）由后端按「假期首日」给出 */
function fromRemote(year, ts) {
  const ds = toStr(ts)
  const d = (year.days || {})[ds]
  if (!d) return null
  if (!d.off) return { name: '', showName: false, period: d.name, off: false, work: true }
  const p = (year.periods || []).find((x) => x.from <= ds && ds <= x.to)
  return {
    name: d.name,
    showName: !!(p && p.label === ds),
    period: d.name,
    off: true,
    work: false,
  }
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
  const ys = String(new Date(ts).getUTCFullYear())
  const builtin = TABLE[ys]
  if (builtin) return fromBuiltin(builtin, ts)      // ① 内置表（含精修）优先
  const rem = remote.value[ys]
  if (rem) return fromRemote(rem, ts)               // ② 远端表（每年自动更新）
  return null                                        // ③ 无数据 → 不标
}

/** 巡检用：列出某年全部休/班日，便于逐年与国务院通知核对 */
export function listYear(year) {
  const ys = String(year)
  const b = TABLE[ys]
  if (b) {
    const rest = []
    const work = []
    for (const p of b.periods) {
      for (let t = toTs(p.from); t <= toTs(p.to); t += DAY) rest.push(toStr(t))
      for (const w of p.work || []) work.push(w)
    }
    rest.sort()
    work.sort()
    return { rest, work }
  }
  const r = remote.value[ys]
  if (r) {
    const days = r.days || {}
    const keys = Object.keys(days).sort()
    return { rest: keys.filter((k) => days[k].off), work: keys.filter((k) => !days[k].off) }
  }
  return null
}

/** 巡检用：某年登记的休/班天数（官方 2026 口径：33 休 / 6 班） */
export function cnHolidayCoverage(year) {
  const r = listYear(year)
  return r ? { rest: r.rest.length, work: r.work.length } : null
}
