/**
 * 「我的预报提交」到货日期展示值归一（v771 / 2026-11-05）
 *
 * 服务端在 /api/forecast-submissions/my 的每条记录上补 `arrival_date`
 * （取自 `forecast_periods` 同列），但下列情况都可能拿到「没有值」：
 *   · 期次被删、period_id=0 的历史行、期次表缺列 ⇒ 后端给 ''
 *   · 后端尚未部署新版（小程序灰度期）⇒ 该键根本不存在 ⇒ undefined
 *   · SQLite 里偶尔落 'None' / 'null' 之类的脏字面量
 *
 * 🔴 判据是「能不能把它显示成一段日期」，不是「字段在不在」：
 *    只写 `wx:if="{{item.arrival_date}}"` 会把 'None' 当成日期显示出来；
 *    直接拿 undefined 去拼接则会渲染 'undefined'。
 * 🔴 只做归一、不做格式化：到货日期与报单日期都由服务端给 `YYYY-MM-DD`，
 *    前端再格式化一次就是第二份口径（两边迟早分叉）。
 */
const EMPTY_LITERALS = ['none', 'null', 'undefined', 'nan', '-', '--', '0000-00-00']

function normalizeArrivalDate(value) {
  if (typeof value !== 'string') return ''
  const s = value.trim()
  if (!s) return ''
  if (EMPTY_LITERALS.indexOf(s.toLowerCase()) >= 0) return ''
  return s
}

module.exports = { normalizeArrivalDate }
