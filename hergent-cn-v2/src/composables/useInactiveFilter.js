/**
 * 「已停用记录默认收起 + 显式开关展开」的统一实现（v713）。
 *
 * ## 为什么要有这个 composable
 * 同一个交互在 7 个页面各写一遍（报单对象 / 商品 / 员工 / 品牌 / 价格通道 /
 * 告警规则 / 买赠活动），改一次口径要改 7 处，必然有一页写歪。抽出来让口径只有一份。
 *
 * ## 🔴 判据：只认「明确的停用」，缺失字段一律当启用
 * 停用态的载体在真实数据里不统一（`0` / `false` 都有），但**绝不能写成 `!r.is_active`**：
 * 后端某次少下发这个字段时 `!undefined === true`，会把**整张表都判成停用**并全部藏起来 ——
 * 用户看到的是「数据没了」，而不是「筛选生效了」。这类静默灾难比写错文案严重得多。
 * 故只认 `=== 0` 与 `=== false`，`undefined / null / 缺失` 全部走启用侧。
 *
 * ## 🔴 不做持久化（与 `brandSel` 那类业务筛选刻意不同）
 * 用户要的是「**默认**隐藏」。记住上次状态会让打开过一次的人下次不再默认隐藏，
 * 等于把需求本身废掉。视图偏好不落盘。
 *
 * ## 数据必须是「全量常驻」
 * 本 composable 是**纯前端过滤**：切换开关时零请求、即时生效。
 * 前提是 `source` 里已经有全量（含停用）数据 —— 各页要么本来就传 `include_inactive:1`，
 * 要么像商品档案那样已有全量缓存。
 * ⚠️ **服务端分页的页面不要用它**（分页会把停用记录混进某一页、`total` 也对不上）：
 *    那种页面走后端参数 + 纯受控组件 `<InactiveToggle>`，别硬改成前端过滤。
 *
 * @param {import('vue').Ref<Array>|import('vue').ComputedRef<Array>} source 全量数据的 ref/computed
 * @param {{ field?: string }} [opts] `field` 状态字段名，默认 `is_active`
 * @returns {{ showInactive, inactiveCount, activeCount, totalCount, list, isInactive, toggleInactive, revealInactive }}
 */
import { ref, computed } from 'vue'

export function useInactiveFilter (source, opts = {}) {
  const field = opts.field || 'is_active'

  /** 展开开关。**默认 false** —— 这就是需求里的「默认隐藏」。 */
  const showInactive = ref(false)

  /** 单条是否停用。判据见文件头：0 / false 才算，缺失字段当启用。 */
  const isInactive = (r) => !!r && (r[field] === 0 || r[field] === false)

  const rows = computed(() => (Array.isArray(source.value) ? source.value : []))

  const inactiveCount = computed(() => rows.value.filter(isInactive).length)
  const activeCount = computed(() => rows.value.length - inactiveCount.value)
  const totalCount = computed(() => rows.value.length)

  /**
   * 渲染用的行。
   * 🔴 **保留原 `source` 不动**：同一份数据常被其它地方消费（价格通道的下拉选项、
   *    告警规则的 KPI 总数），把它们一起过滤掉会连带改掉那些口径。
   */
  const list = computed(() => (showInactive.value ? rows.value : rows.value.filter(r => !isInactive(r))))

  const toggleInactive = () => { showInactive.value = !showInactive.value }

  /** 空态里的「显示已停用」就地按钮用这个（而不是直接改 ref，保持唯一入口） */
  const revealInactive = () => { showInactive.value = true }

  return { showInactive, inactiveCount, activeCount, totalCount, list, isInactive, toggleInactive, revealInactive }
}
