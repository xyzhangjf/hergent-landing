/**
 * 通知偏好（本地）—— 按「事件类型」静音或暂停提醒。
 *
 * 为什么落 localStorage 而不是后端：这一层管的是「我这个屏幕不想看到什么」，
 * 属显示偏好、不是数据权限；落库要先有 per-user 偏好载体 + 迁移 + RBAC 登记，
 * 而当前连「通知写给谁」的收件人维度都还没真正用起来。先做显示层，零迁移、零风险。
 * 代价说清楚：**设备级** —— 换台电脑或手机要各设一次。
 *
 * 键用 event_key（后端归一化后的稳定「事件类型」），**不是 title** ——
 * title 带日期（`09月13日盈亏快报` / `盈亏快报 · 2026-09-13`），拿它当键永远静不掉。
 *
 * 只做两个动作（每个都能被用户观察到效果）：
 *   不再提示（永久静音）+ 暂停 N 天（到期自动恢复，避免「设置页的坟场」）。
 *
 * ⚠️ 为什么**不做**「每天一次 / 每周一次」频率档位（2026-09-14 决策）：
 *   写端 `finance.message_send` 的去重窗口 `MESSAGE_DEDUP_WINDOW = 86400` 秒，
 *   同一件事 24 小时内本来就只留一行 —— 「每天一次」与它完全重合，设了等于没设；
 *   而把窗口拉长到 7 天只影响站内角标、又会让角标在用户**还没看**的时候就自己缩水
 *   （等于丢提醒）。真正的频率控制要等有了推送通道（企微/微信）才有意义：
 *   那时「每天一次」= 一天最多推你一次。**不做假旋钮 —— 配置项必须能看到效果。**
 */
import { ref, computed } from 'vue'

const LS_KEY = 'hergent_noti_prefs'

export const MODE_OPTIONS = [
  { value: 'all', label: '正常提示' },
  { value: 'off', label: '不再提示' },
]

export const SNOOZE_OPTIONS = [
  { days: 7, label: '暂停 7 天' },
  { days: 30, label: '暂停 30 天' },
]

// 模块级单例 —— Shell 的徽标与通知面板必须读同一份规则，否则同屏两个数字对不上。
const rules = ref(load())

function load () {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || '{}')
    const r = raw && typeof raw === 'object' ? raw.rules : null
    return r && typeof r === 'object' ? r : {}
  } catch (e) {
    return {}
  }
}

function persist () {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ v: 1, rules: rules.value }))
  } catch (e) {
    // 隐私模式 / 配额满：降级为「本次会话有效」，不打断用户操作
  }
}

function ymd (d) {
  const x = d instanceof Date ? d : new Date()
  return x.getFullYear() + '-' +
    String(x.getMonth() + 1).padStart(2, '0') + '-' +
    String(x.getDate()).padStart(2, '0')
}

function addDays (n) {
  const x = new Date()
  x.setDate(x.getDate() + n)
  return ymd(x)
}

/** '2026-09-21' → '9月21日'（界面一律中文，不用 09-21） */
export function prettyDate (s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''))
  return m ? (Number(m[2]) + '月' + Number(m[3]) + '日') : ''
}

function setRule (key, patch) {
  if (!key) return
  const next = Object.assign({}, rules.value)
  const cur = Object.assign({}, next[key] || {}, patch)
  // 全默认（未静音、未暂停）就不留空壳，免得规则表越积越脏
  if ((!cur.mode || cur.mode === 'all') && !cur.until) delete next[key]
  else next[key] = cur
  rules.value = next
  persist()
}

/** 规则态：normal（正常提示）/ off（永久不提示）/ snoozed（暂停中） */
export function stateOf (key, now) {
  const r = rules.value[key]
  if (!r) return 'normal'
  if (r.until && r.until >= ymd(now)) return 'snoozed'
  if (r.mode === 'off') return 'off'
  return 'normal'
}

/** 静音档位：all（正常提示）/ off（不再提示）。暂停是独立维度，不混进来。 */
export function modeOf (key) {
  const r = rules.value[key]
  return (r && r.mode) || 'all'
}

export function untilOf (key) {
  const r = rules.value[key]
  return (r && r.until) || ''
}

/** 是否被抑制（不计入徽标、收进「已收起」区） */
export function isSuppressed (key, now) {
  return stateOf(key, now) !== 'normal'
}

/**
 * 徽标数 = 需要你现在去看的通知条数（**纯函数，无副作用**）。
 * 铃铛（Shell）与通知面板头部共用它 —— 两边对同屏两个数字必须同源。
 */
export function badgeFromGroups (groups, now) {
  let n = 0
  for (const g of (groups || [])) {
    if (isSuppressed(g.event_key || g.title || '', now)) continue
    n += Number(g.rows || 1)
  }
  return n
}

/** 永久静音 / 取消静音 */
export function setMuted (key, muted) {
  setRule(key, { mode: muted ? 'off' : 'all', until: '' })
}

/** 暂停 N 天（到期自动恢复） */
export function snooze (key, days) {
  setRule(key, { until: addDays(Number(days) || 7) })
}

export function restore (key) {
  const next = Object.assign({}, rules.value)
  delete next[key]
  rules.value = next
  persist()
}

/** 已设过规则的事件类型（供面板「已收起」区列出与恢复） */
export const suppressedList = computed(() => {
  const t = ymd()
  return Object.keys(rules.value).map(function (k) {
    const r = rules.value[k] || {}
    let state = 'normal'
    if (r.until && r.until >= t) state = 'snoozed'
    else if (r.mode === 'off') state = 'off'
    return { key: k, mode: r.mode || 'all', until: r.until || '', state: state }
  }).filter(function (x) {
    return x.state !== 'normal'
  }).sort(function (a, b) {
    return a.key.localeCompare(b.key)
  })
})
