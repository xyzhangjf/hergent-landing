/**
 * 列设置菜单的开合与定位（UI-SPEC §2.6.1「三、」）。
 *
 * 为什么要抽成 composable：§2.6.1 要求「查看态与改单态**共用同一份**定位逻辑」，
 * v401 已在 `/forecast` **内部**做到（一个 showColMenu、两个齿轮各存自身 DOM）。
 * v408 采购单列表（`/inventory/purchase`）也要接入齿轮 ⇒ 定位若各写一份，两处必然漂移
 * —— 本仓已有一类缺陷叫「同一规则抄多份 ⇒ 漏抄那份整页出错」，故上提为**唯一实现**。
 *
 * 定位契约（**不许写死 top / left**）：
 *   · `position:fixed` + 内联 `top`/`left`（**视口坐标**），由 `toggleColMenu(e)` 读
 *     `e.currentTarget.getBoundingClientRect()` 现算；
 *   · 默认齿轮**正下方**、间距 `gap:6px`、左缘与齿轮左缘对齐；右侧越界 ⇒ 改右对齐 ⇒
 *     仍越界则贴视口右边（四周留 `pad:8px`）；
 *   · 🔴 **必须限高**：`maxHeight` 按可用空间现算（下方 / 上方取**更大的一侧**、优先下方、
 *     `Math.max(160, …)` 保底）—— 光「越界就移位」不够，「移位」必须与「限高」配对，
 *     否则「不遮挡触发按钮」根本不成立（v401 真机实测：列清单高 543px，上下都放不下）；
 *   · 首帧还量不到菜单 ⇒ 先按兜底宽 `320` 摆位，`nextTick` 后再用真实 `offsetWidth` 校正
 *     （避免先闪一下）；
 *   · 面板是 `fixed`（脱离文档流），任何滚动 / 改窗口都会让它与齿轮脱位 ⇒ 直接收起。
 *     `scroll` 走 **捕获阶段**：一个监听同时覆盖页面滚动与表格内部 `.table-wrap` 的滚动。
 *
 * 宿主页用法（逐字照抄，类名/命名见 §2.6.1「一、」）：
 *   const { showColMenu, colMenuEl, colMenuStyle, toggleColMenu } = useColMenu()
 *   · 齿轮：<button class="col-cfg gear" @click.stop="toggleColMenu" title="列设置"><Icon name="settings"/></button>
 *   · 菜单：<div v-if="showColMenu" class="col-menu" ref="colMenuEl" :style="colMenuStyle" @click.stop>
 *
 * ⚠️ 本 composable **只管定位与开合**，不含列数据集（清单 / 顺序 / 可见性 / 持久化）——
 *    那部分各页差异化大（预报是主档列 + 列方案，采购是固定 29 列），由各页自持。
 */
import { ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'

export function useColMenu () {
  const showColMenu = ref(false)
  const colMenuGear = ref(null)   // 触发菜单的那个齿轮元素
  const colMenuEl = ref(null)     // 菜单根节点（用来量真实尺寸）
  const colMenuStyle = ref({})    // 算出的视口坐标，绑到菜单 :style

  function placeColMenu () {
    const g = colMenuGear.value
    if (!g) return
    const r = g.getBoundingClientRect()
    const m = colMenuEl.value
    const mw = m ? m.offsetWidth : 320     // 首帧还没渲染，先按兜底尺寸摆，nextTick 再校正
    const pad = 8   // 与视口边缘的最小间距
    const gap = 6   // 菜单与齿轮的间距
    const vw = window.innerWidth
    const vh = window.innerHeight
    // 水平：优先与齿轮左缘对齐 → 右越界则改右对齐 → 仍越界则贴右边
    let left = r.left
    if (left + mw > vw - pad) left = r.right - mw
    if (left < pad) left = pad
    if (left + mw > vw - pad) left = Math.max(pad, vw - pad - mw)
    // 垂直：**先定可用空间，再用 max-height 把菜单压进去**。（详见文件头注释）
    const spaceBelow = vh - pad - (r.bottom + gap)
    const spaceAbove = r.top - gap - pad
    const useBelow = spaceBelow >= spaceAbove          // 优先下方；只有上方更大才上翻
    const maxH = Math.max(160, useBelow ? spaceBelow : spaceAbove)
    const top = useBelow ? (r.bottom + gap) : Math.max(pad, r.top - gap - maxH)
    colMenuStyle.value = { left: left + 'px', top: top + 'px', maxHeight: maxH + 'px' }
  }

  function toggleColMenu (e) {
    if (showColMenu.value) { showColMenu.value = false; return }
    colMenuGear.value = e && e.currentTarget ? e.currentTarget : null
    colMenuStyle.value = {}
    showColMenu.value = true
    placeColMenu()          // 首帧先用兜底尺寸摆位，避免闪一下
    nextTick(placeColMenu)  // 渲染完成后按真实尺寸校正
  }

  watch(showColMenu, (v) => { if (!v) colMenuGear.value = null })

  // 面板是 fixed（脱离文档流），任何滚动或改窗口都会让它与齿轮脱位 ⇒ 直接收起。
  // 挂 window 且用捕获阶段：一个监听同时覆盖页面滚动与表格内部 .table-wrap 的滚动。
  function closeColMenuOnViewportChange () { if (showColMenu.value) showColMenu.value = false }
  onMounted(() => {
    window.addEventListener('scroll', closeColMenuOnViewportChange, true)
    window.addEventListener('resize', closeColMenuOnViewportChange)
  })
  onBeforeUnmount(() => {
    window.removeEventListener('scroll', closeColMenuOnViewportChange, true)
    window.removeEventListener('resize', closeColMenuOnViewportChange)
  })

  return {
    showColMenu, colMenuGear, colMenuEl, colMenuStyle,
    placeColMenu, toggleColMenu, closeColMenuOnViewportChange,
  }
}
