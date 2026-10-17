/**
 * 撤销/重做 + 撤销面板（Q24 / Q5 / v201 / v219）。
 *
 * Q24：撤销栈由「全量深拷贝」改为「结构性操作用全量 + 单元格编辑用增量补丁」。
 *   原实现每次单元格聚焦都 clone(cross) 全表（428 行 × 30 列 ≈ 1.2 万字段），
 *   change 时再 clone 一次并 JSON.stringify 全量比较 —— 每点一格两次全表序列化。
 *   现改为：单格编辑只记录 {r, c, old, new}，撤销时反向写回该格，零深拷贝。
 *   行/列增删、粘贴、填充等结构性变更仍需全量快照（{ t:'full' }）。
 *
 * ⚠️ 抽离边界（依赖注入）：
 *   - `cross` / `dirtySinceSave` 是宿主页共享状态（被 saveEdits / loadEditGrid / 模板用），经参数注入；
 *   - `writeCellVal` / `clampSelection` / `refreshDirty` / `clone` 是宿主页函数（hoist），经参数注入；
 *   - `lastSavedSnap` **不进本 composable** —— undo/redo 只调 `refreshDirty()`，比对的基线在宿主页；
 *   - `undoStack` / `redoStack` 是本 composable 私有，但因模板直接读 `undoStack.length` 故一并返回。
 *
 * 宿主页用法：
 *   const { undoStack, redoStack, canUndo, canRedo, snapshot, pushCellSnap, pushBatchSnap,
 *           undo, redo, undoPanelOpen, undoShown, undoUpto } =
 *     useUndoRedo({ cross, dirtySinceSave, clone, writeCellVal, clampSelection, refreshDirty, visibleCols, toast })
 */
import { ref, computed } from 'vue'

const UNDO_LIMIT = 100

export function useUndoRedo ({ cross, dirtySinceSave, clone, writeCellVal, clampSelection, refreshDirty, visibleCols, toast }) {
  const undoStack = ref([])
  const redoStack = ref([])
  const canUndo = computed(() => undoStack.value.length > 0)
  const canRedo = computed(() => redoStack.value.length > 0)

  function snapshot() {
    dirtySinceSave.value = true          // v201：结构变更 ⇒ 有未保存改动（见 refreshDirty 注释）
    undoStack.value.push({ t: 'full', data: clone(cross.value) })
    if (undoStack.value.length > UNDO_LIMIT) undoStack.value.shift()
    redoStack.value = []
  }
  function pushCellSnap(r, c, oldVal, newVal) {
    dirtySinceSave.value = true          // v201：单元格改动 ⇒ 有未保存改动
    undoStack.value.push({ t: 'cell', r, c, old: oldVal, new: newVal })
    if (undoStack.value.length > UNDO_LIMIT) undoStack.value.shift()
    redoStack.value = []
  }
  /* v219 打磨⑤：批量修复入栈（一次 Ctrl+Z 退掉**整批**）。
     为什么不复用 pushCellSnap 逐格入栈：那样「一键修复 40 处」要按 40 次 Ctrl+Z 才退干净，
     而用户的心理模型是「我刚点了一次按钮 ⇒ 一次撤销」。 */
  function pushBatchSnap(cells) {
    if (!cells || !cells.length) return
    dirtySinceSave.value = true
    undoStack.value.push({ t: 'batch', cells: cells.map(x => ({ r: x.r, c: x.c, old: x.old, new: x.new })) })
    if (undoStack.value.length > UNDO_LIMIT) undoStack.value.shift()
    redoStack.value = []
  }
  /* v219 打磨②：`silent` = 批量回退时不逐条 toast（否则连退 8 步刷 8 条提示，
     最后一条盖住前面所有，用户只看到「已撤销」一次 ⇒ 以为只退了一步）。 */
  function undo(silent) {
    const s = undoStack.value.pop()
    if (!s) return
    if (s.t === 'cell') {
      redoStack.value.push({ t: 'cell', r: s.r, c: s.c, old: s.old, new: s.new })
      writeCellVal(s.r, s.c, s.old)
    } else if (s.t === 'batch') {
      /* v219 打磨⑤：批量修复的**整批单条**回退（见 pushBatchSnap）。
         倒序写回：一批里同一格不应出现两次（fixList 按 ri+ci 去重过），
         倒序只是让「后写的先还原」这个直觉成立，出现重复也不会出错。 */
      redoStack.value.push({ t: 'batch', cells: s.cells.map(x => ({ r: x.r, c: x.c, old: x.old, new: x.new })) })
      for (let i = s.cells.length - 1; i >= 0; i--) writeCellVal(s.cells[i].r, s.cells[i].c, s.cells[i].old)
    } else {
      redoStack.value.push({ t: 'full', data: clone(cross.value) })
      cross.value = s.data
    }
    clampSelection()
    refreshDirty()          // v201：撤销可能正好回到上次保存的版本 ⇒ 重新比对，别谎报「有未保存改动」
    if (!silent) toast('已撤销', 'ok')
  }
  function redo() {
    const s = redoStack.value.pop()
    if (!s) return
    if (s.t === 'cell') {
      undoStack.value.push({ t: 'cell', r: s.r, c: s.c, old: s.old, new: s.new })
      writeCellVal(s.r, s.c, s.new)
    } else if (s.t === 'batch') {
      undoStack.value.push({ t: 'batch', cells: s.cells.map(x => ({ r: x.r, c: x.c, old: x.old, new: x.new })) })
      for (const x of s.cells) writeCellVal(x.r, x.c, x.new)
    } else {
      undoStack.value.push({ t: 'full', data: clone(cross.value) })
      cross.value = s.data
    }
    clampSelection()
    refreshDirty()          // v201：同 undo()
    toast('已重做', 'ok')
  }

  /* v219 打磨②：撤销栈**可见**。
     Ctrl+Z 只能一步一步盲退 —— 用户误操作后真正想知道的是「我刚才到底改了哪几处、
     退到第几步能回到我想要的样子」。栈不可见时只能试，退过头还得重做回去。
     这里把最近 30 步列出来（新的在上），点哪一条就**退到那一步之前**。
     ⚠️ 描述**不改**栈结构（`{t,r,c,old,new}` 原样保留）—— 撤销/重做的正确性靠这个结构，
        为显示去动它不值得；描述是纯派生。 */
  const undoPanelOpen = ref(false)
  const undoShown = computed(() => {
    const st = undoStack.value
    const out = []
    for (let i = st.length - 1; i >= Math.max(0, st.length - 30); i--) {
      out.push({ i, label: undoLabel(st[i]) })
    }
    return out
  })
  function colLabelOf (c) {
    const vc = visibleCols.value
    if (c < vc.length) return String((vc[c] && (vc[c].label || vc[c].key)) || ('第' + (c + 1) + '列'))
    const u = (cross.value.units || [])[c - vc.length]
    return u ? String(u.name) : ('第' + (c + 1) + '列')
  }
  function briefVal (v) {
    if (v === null || v === undefined || v === '') return '（空）'
    const s = String(v)
    return s.length > 10 ? s.slice(0, 10) + '…' : s
  }
  function undoLabel (s) {
    if (!s) return ''
    if (s.t === 'cell') return `第 ${s.r + 1} 行 · ${colLabelOf(s.c)}：${briefVal(s.old)} → ${briefVal(s.new)}`
    if (s.t === 'batch') return `批量修复 ${s.cells.length} 处（一次撤销可整批还原）`
    return '结构性变更（增删行 / 粘贴 / 填充等）'
  }
  function undoUpto (i) {
    const n = undoStack.value.length - i
    if (n <= 0) return
    while (undoStack.value.length > i) undo(true)
    undoPanelOpen.value = false
    toast(`已回退 ${n} 步`, 'ok')
  }

  return {
    undoStack, redoStack, canUndo, canRedo,
    snapshot, pushCellSnap, pushBatchSnap, undo, redo,
    undoPanelOpen, undoShown, undoUpto,
  }
}
