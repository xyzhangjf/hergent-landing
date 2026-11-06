/**
 * 列设置的「列数据集 + 可见性 + 云端持久化」统一封装（v432 起，配合 ColMenuPanel.vue）。
 *
 * ## 为什么存在
 * 原先「序号表头换成齿轮 + 勾选可选列显隐」的逻辑只在 `/inventory/purchase` 一处手写，
 * 现在要把它推广到全站 16 个表格页。列菜单的**定位/限高**（`useColMenu`）与**云端同步**
 * （`useColPrefs`）已是唯一实现，本 composable 再补上「中间这层」—— 列清单、默认可见性、
 * isVisible / toggleCol / resetCols —— 让各页只写「自己的列清单」这一份差异化数据，其余全复用。
 *
 * ## 不负责什么
 * 齿轮的点击开合、面板的 fixed 定位由 ColMenuPanel.vue 内部的 useColMenu 负责；
 * 本 composable 只产出 `isVisible / toggleCol / resetCols`，以及云端读写（通过 useColPrefs）。
 *
 * ## 用法（逐字照抄，类名/命名见 §2.6.1）
 *   const COLS = [
 *     { key: 'prod', label: '商品',   core: true },
 *     { key: 'code', label: '条码',   core: false },
 *     ...
 *   ]
 *   const { isVisible, toggleCol, resetCols, panel } = useColSettings('customer-archive', COLS)
 *   // 表头/单元格：<th v-if="isVisible('code')">条码</th>  /  <td v-if="isVisible('code')">…</td>
 *   // 齿轮（替换原 <th class="seq-th">序号</th>）：
 *   //   <th class="seq-th col-gear-th"><button class="col-cfg gear" @click.stop="openColMenu" title="列设置"><Icon name="settings" :size="15"/></button></th>
 *   // 面板（放在表格附近，常驻挂载，由内部 v-if 控制显隐）：
 *   //   <ColMenuPanel ref="panel" :col-list="COLS" :is-visible="isVisible" :toggle-col="toggleCol" :reset-cols="resetCols" />
 *   // 齿轮点击：function openColMenu(e){ panel.value && panel.value.open(e) }
 */
import { ref, onMounted } from 'vue'
import { useColPrefs } from './useColPrefs.js'

export function useColSettings (page, colList) {
  const cols = Array.isArray(colList) ? colList : []

  // 默认可见性：core（固定列）恒显示、不参与勾选；可选列默认全开，
  // 除非该列显式写 `def: false`（v452：采购单详情把「批次号 / 到期日」收进列设置，
  // 与舟谱的 11 列口径对齐 —— 数据不删，只是默认不占屏幕）。
  // ⚠️ 没传 `def` 的页行为不变（仍默认全开）：本 composable 被全站 16 个表格页共用，
  //    不能为了某一页把全局默认值翻过来。
  function defaultVis () {
    const v = {}
    cols.forEach(c => { if (!c.core) v[c.key] = c.def !== false })
    return v
  }
  const colVis = ref(defaultVis())

  function isVisible (key) {
    const c = cols.find(x => x.key === key)
    if (!c) return true
    return c.core || colVis.value[key] !== false
  }
  function toggleCol (key) {
    const c = cols.find(x => x.key === key)
    if (!c || c.core) return
    colVis.value = { ...colVis.value, [key]: !(colVis.value[key] !== false) }
    persistCols()
  }
  function resetCols () {
    colVis.value = defaultVis()
    persistCols()
  }

  /* v789：除「列显隐」之外的**页面级布尔偏好**（首个用例：采购单「是否录生产日期」）。
     与 colVis 分开存，理由有三：① 它不是表格列，混进列清单会让列设置面板出现一个
     不存在的「列」；② resetCols() 重置列时不该顺手重置它；③ 后端 col_pref_save
     把 cfg 当整体 JSON 存（只校验 dict 与大小），加 extra 键零后端改动。
     🔴 没设过 extra 的页面，写出去的 cfg 与改动前**逐字一致**（不带 extra 键），
        全站 27 个宿主页行为不变。 */
  const extra = ref({})
  function isExtra (key, def = false) {
    const v = extra.value[key]
    return typeof v === 'boolean' ? v : def
  }
  function setExtra (key, value) {
    extra.value = { ...extra.value, [key]: !!value }
    persistCols()
  }

  // 可见性落云端：进站先同步一次；本地改动 debounce 推上去。
  const prefs = useColPrefs(page, {
    apply: (cfg) => {
      if (cfg && cfg.vis) {
        const v = defaultVis()
        Object.keys(v).forEach(k => { if (typeof cfg.vis[k] === 'boolean') v[k] = cfg.vis[k] })
        colVis.value = v
      }
      if (cfg && cfg.extra && typeof cfg.extra === 'object') {
        extra.value = { ...cfg.extra }
      }
    },
    snapshot: () => _snapshot(),
  })
  function _snapshot () {
    return Object.keys(extra.value).length
      ? { vis: colVis.value, extra: extra.value }
      : { vis: colVis.value }
  }
  function persistCols () { prefs.push(_snapshot()) }

  onMounted(() => { prefs.syncFromCloud() })

  return { colVis, isVisible, toggleCol, resetCols, persistCols, isExtra, setExtra }
}
