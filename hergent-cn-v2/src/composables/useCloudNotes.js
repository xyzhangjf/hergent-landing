import { reactive } from 'vue'
import { store, toast } from '../store'
import { auth } from '../api/client.js'
import { forecastApi } from '../api/modules'

// P9-5 云端共享批注（多人共享，localStorage 兜底）
// 从 Forecast.vue 抽离（T6 纯逻辑 composables 抽取，模板零改动）。
// 依赖：cross（宿主页共享 ref，提供 cross.value.period）经参数注入。
export function useCloudNotes(cross) {
  const NOTE_KEY = () => 'forecast_notes_' + (auth.user?.id || 'default')
  const notesMap = reactive({})
  function loadNotes() { try { Object.assign(notesMap, JSON.parse(localStorage.getItem(NOTE_KEY()) || '{}')) } catch (e) {} }
  function saveNotes() { localStorage.setItem(NOTE_KEY(), JSON.stringify(notesMap)) }
  function rowNote(r) { return notesMap[r.product_id] || '' }
  async function loadCloudNotes() {
    try {
      const p = cross.value.period; if (!p) return
      const r = await forecastApi.notesGet(p.id)
      const m = r.notes || {}
      const plain = {}
      Object.keys(m).forEach(k => { plain[k] = typeof m[k] === 'string' ? m[k] : (m[k].text || '') })
      Object.keys(notesMap).forEach(k => delete notesMap[k])
      Object.assign(notesMap, plain)
    } catch (e) { /* 保留本地批注 */ }
  }
  async function saveCloudNotes() {
    const p = cross.value.period; if (!p) return
    try {
      const payload = {}
      Object.keys(notesMap).forEach(k => {
        if (notesMap[k]) payload[k] = { text: notesMap[k], by: (auth.user && (auth.user.name || auth.user.username)) || 'me', at: new Date().toISOString() }
      })
      await forecastApi.notesPut({ period_id: p.id, notes: payload })
    } catch (e) {}
  }
  async function setRowNote(ri) {
    const r = cross.value.rows[ri]; if (!r) return
    const t = await store.prompt('批注（商品行备注）：', rowNote(r))
    if (t === null) return
    if (t.trim()) notesMap[r.product_id] = t.trim(); else delete notesMap[r.product_id]
    saveNotes(); saveCloudNotes(); toast('已保存批注', 'ok')
  }
  return { notesMap, loadNotes, saveNotes, rowNote, setRowNote, loadCloudNotes, saveCloudNotes }
}
