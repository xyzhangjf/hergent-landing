/**
 * 明细表**列宽拖动**（v444 起，配合进销存建单页；将来可推广到全站表格页）。
 *
 * ## 为什么单独一个 composable（不塞进 `useColSettings`）
 * `useColSettings` 是**全站 16 个表格页**共用的，它身上的 `useColPrefs` 是
 * **整份 cfg 覆盖写**（`POST /api/ui/col-prefs` 一次写 `{vis:…}`）。若把列宽并进
 * 同一份 cfg，会有两种失效方式：
 *   ① 只装了 `useColSettings` 的页面，snapshot 里没有 `w` ⇒ 一次写入把云端已有的
 *      列宽**冲成空**（静默丢配置，且下次联网回不来 —— 本地那份已成"最新"）；
 *   ② 反过来，只装了 `useColResize` 的页面会把 `vis` 冲掉。
 * 要合并就必须让两边共用**同一个 prefs 实例**，那是一次跨 16 页的改动。
 *
 * ## 列宽为什么**不上云**（存 localStorage 而不是 col-prefs）
 * 列宽与**这台设备这块屏**强绑定：同一张表在 27 寸和 13 寸上合适的宽度不一样，
 * 上云等于把 Mac 上拖好的宽度强推给笔记本（甚至推给手机端），是**负价值**。
 * 列**显隐**（哪些列要看）才是跨设备一致的偏好 ⇒ 那个上云（v411 已做）。
 * ⚠️ 这个取舍写在这里，是为了将来有人问「为什么列宽不跟着租户走」时有据可查，
 *    而不是以为漏做了。
 *
 * ## 用法（逐字照抄）
 *   const { wStyle, startResize, resetColW } = useColResize('purchase-new', COLS)
 *   // 表头：<th class="ipn-c-prod" :style="wStyle('prod')">商品
 *   //         <span class="col-rsz" @mousedown.stop="startResize('prod', $event)"
 *   //               @dblclick.stop="resetColW('prod')" title="拖动调整列宽（双击恢复默认）"></span>
 *   //       </th>
 *   // 🔴 `seq-th`（序号/齿轮）与 sticky 的操作列**不要**挂手柄：前者是列菜单入口
 *   //    （在上面拖会误触齿轮），后者宽度由内容定死、拖了也没用。
 *
 * ## 三条不能省的实现细节
 * 1. **必须给 th 同时写 `width` 和 `min-width`**：CSS 里像 `.ipn-c-prod{min-width:240px}`
 *    这类既有规则 specificity 高于内联 width 时不会赢，但 `min-width` 会**挡住拖窄**
 *    ⇒ 只内联 width，往窄拖时看着"拖不动"。两个都给才真的双向可调。
 * 2. **`startW` 从 th 的 `getBoundingClientRect()` 现量**（不是从 CSS 常量读）：
 *    列的真实宽度是浏览器按内容算出来的，写死常量会和实际差几十像素，
 *    表现为"鼠标一按下列宽就跳一下"。
 * 3. **mousemove/mouseup 挂在 `document` 上**（不是手柄自己）：手柄只有 6px 宽，
 *    鼠标拖出手柄就收不到事件 ⇒ 拖到一半断掉。挂 document 才能在全窗口跟手，
 *    mouseup 时**必须**解绑（否则每次拖动都多一份监听）。
 */
import { ref } from 'vue'

/** 拖到多窄为止。再窄列里的内容会被切掉、表头也读不全。 */
const MIN_W = 56
/**
 * 拖到多宽为止 —— 没有上限的话，误拖一次能把表格推出几千像素的横向滚动。
 *
 * 🔴 为什么是 2400 而不是「看起来够用」的 720：v444 真机实测，销售建单页在 1600px
 *    屏上「商品」列**默认就有 794px**（该表只有 7 列，列少则每列分得多）。硬夹 720
 *    的结果不是"拖不动"，而是**越拖越窄**（794 → 720），用户会以为拖动坏了。
 *    ⇒ 上限必须**高于任何列的默认宽**，只用来拦"拖到天上"这种误操作。
 */
const MAX_W = 2400

const lsKey = (page) => `hergent_colw_${page}`

export function useColResize (page, colList, opts = {}) {
  const min = Number(opts.min) > 0 ? Number(opts.min) : MIN_W
  const cols = Array.isArray(colList) ? colList : []
  /** 只对清单里登记过的列生效 —— 防止将来有人给一个未登记的 key 拖出幽灵宽度。 */
  const known = new Set(cols.map(c => c.key))

  function load () {
    try {
      const raw = localStorage.getItem(lsKey(page))
      const o = raw ? JSON.parse(raw) : null
      return (o && typeof o === 'object') ? o : {}
    } catch (e) {
      // 存储被禁用 / 存了坏值：**不静默**留痕，并按"没拖过"继续（列宽不是关键数据）
      console.warn('[列宽] 读取本地列宽失败，本次用默认宽度', e && e.message)
      return {}
    }
  }
  const colW = ref(load())
  /** 正在拖哪一列（'' = 没在拖）。给 th 加高亮用，也让外部能判断"此刻正拖拽中"。 */
  const resizingKey = ref('')

  function save () {
    try {
      localStorage.setItem(lsKey(page), JSON.stringify(colW.value))
    } catch (e) {
      console.warn('[列宽] 本地保存失败（本次生效，刷新后回到默认宽度）', e && e.message)
    }
  }

  /** th 的内联样式。没拖过 ⇒ 返回 null（保留 CSS 里写的宽度，不插内联样式）。 */
  function wStyle (key) {
    const w = Number(colW.value[key])
    if (!(w > 0)) return null
    return { width: w + 'px', minWidth: w + 'px' }
  }

  /** 恢复某一列到 CSS 默认宽（手柄双击）。 */
  function resetColW (key) {
    if (!(key in colW.value)) return
    const next = { ...colW.value }
    delete next[key]
    colW.value = next
    save()
  }

  /** 恢复全部列（供将来接入列菜单的「重置」入口）。 */
  function resetWidths () { colW.value = {}; save() }

  function startResize (key, e) {
    if (!known.has(key)) {
      console.warn('[列宽] 列 ' + key + ' 未登记在列清单里，忽略这次拖动')
      return
    }
    const th = e.currentTarget && e.currentTarget.closest
      ? e.currentTarget.closest('th')
      : null
    if (!th) return
    const startW = th.getBoundingClientRect().width
    const startX = e.clientX
    resizingKey.value = key
    /* 拖的过程中禁止选中文字：否则鼠标划过表头会把标题刷成蓝色选中块，
       看起来像"表格坏了"。同时把光标钉成 col-resize（拖出 th 后光标会跟着元素变）。 */
    document.body.classList.add('is-col-resizing')

    function onMove (ev) {
      const w = Math.round(startW + (ev.clientX - startX))
      colW.value = { ...colW.value, [key]: Math.min(MAX_W, Math.max(min, w)) }
    }
    function onUp () {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.classList.remove('is-col-resizing')
      resizingKey.value = ''
      save()
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    // ① 阻止 th 上的点击（列菜单 / 排序）；② 阻止浏览器原生"拖选文本"
    e.preventDefault()
    e.stopPropagation()
  }

  return { colW, wStyle, startResize, resetColW, resetWidths, resizingKey }
}
