/**
 * 柱顶 tooltip 的定位几何 —— **v491 起改为再导出**。
 *
 * 实现已上提到通用图表层：`components/chart/useChartTip.js`
 * （通用消费者在主仓那一侧：`ChartLine` / `ChartBar` / `ChartDonut` / `ChartHbar`）。
 * 保留本文件是为了**不动既有调用点**（`MonthlyAchvChart.vue` 里 `tipAnchor` /
 * `clampTipAnchor` 的用法与常量 `TIP_W` / `TIP_GAP` / `TIP_EDGE` 一行未改）。
 *
 * 🔴 为什么不各留一份：这是一套几何，两份漂移的后果是"某张图的 tooltip 会盖住数据点、
 *    另一张不会"——代码不报错，只有真机上看得出来。
 */
export { TIP_W, TIP_GAP, TIP_EDGE, tipAnchor, clampTipAnchor } from '../chart/useChartTip.js'
