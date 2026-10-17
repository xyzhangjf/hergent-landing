/**
 * 本地草稿 —— 预报编辑未提交前自动缓存，刷新可恢复；保存后清除。
 *
 * 拆出理由：草稿的「存/清/读」是纯 localStorage 操作，只依赖 cross 与两个恢复状态，
 * 与编辑网格其余逻辑无耦合，适合作为独立 composable。
 *
 * ⚠️ 抽离边界：`draftRestored` / `draftRestoreInfo` 两个状态被 loadEditGrid / saveEdits /
 *   草稿恢复横幅共享，故**留在宿主页**、经参数注入；`watch(cross)` 自动保存块因还承载
 *   「待修正角标」的节流刷新（errCount/errList/validateAll），也留在宿主页。
 *
 * 宿主页用法：
 *   const { saveDraftNow, clearDraft, loadDraft } = useDraft({ cross, draftRestored, draftRestoreInfo, toast })
 */
export function useDraft ({ cross, draftRestored, draftRestoreInfo, toast }) {
  const DRAFT_KEY = () => 'forecast_draft_' + (cross.value.period ? cross.value.period.id : 'default')
  function saveDraftNow() {
    try { localStorage.setItem(DRAFT_KEY(), JSON.stringify(cross.value)) } catch (e) {}
  }
  // Q11：保存成功路径调用 clearDraft(true) —— 静默清除，避免「已保存」后紧跟「已放弃草稿」的矛盾提示
  function clearDraft(silent) {
    try { localStorage.removeItem(DRAFT_KEY()) } catch (e) {}
    draftRestored.value = false
    draftRestoreInfo.value = null
    if (!silent) toast('已放弃草稿', 'ok')
  }
  function loadDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY())
      if (!raw) return null
      const d = JSON.parse(raw)
      return d && d.rows ? d : null
    } catch (e) { return null }
  }
  return { saveDraftNow, clearDraft, loadDraft }
}
