import { ref } from 'vue'
import { store, toast } from '../store'
import { forecastApi } from '../api/modules'

// P9-4 审批流回写（预报单状态机）
// 从 Forecast.vue 抽离（T6 纯逻辑 composables 抽取，模板零改动）。
// 依赖：cross（宿主页共享 ref，提供 cross.value.period）经参数注入。
export function useForecastApproval(cross) {
  const subStatus = ref('draft')
  const subBy = ref(''); const subAt = ref(''); const subReason = ref('')
  const subOpen = ref(false)
  const SUB_LABEL = { draft: '草稿', submitted: '待审批', approved: '已通过', rejected: '已驳回', revised: '退回修改' }
  async function loadSubmission() {
    try {
      const p = cross.value.period; if (!p) return
      const r = await forecastApi.submissionGet(p.id)
      subStatus.value = r.status || 'draft'; subBy.value = r.by || ''; subAt.value = r.at || ''; subReason.value = r.reason || ''
    } catch (e) {}
  }
  async function _subAct(action, reason = '') {
    const p = cross.value.period; if (!p) return
    try {
      const r = await forecastApi.submissionPost({ period_id: p.id, action, reason })
      subStatus.value = r.status; subBy.value = r.by; subAt.value = r.at; subReason.value = r.reason || ''
      const map = { submit: '已提交审批', approve: '已通过', reject: '已驳回', revise: '已退回修改' }
      toast(map[action] || '已更新', 'ok')
    } catch (e) { toast('操作失败: ' + (e.message || ''), 'err') }
  }
  function doSubmit() { _subAct('submit') }
  function doApprove() { _subAct('approve') }
  async function doReject() { const reason = await store.prompt('驳回原因：') || ''; _subAct('reject', reason) }
  function doRevise() { _subAct('revise') }
  return { subStatus, subBy, subAt, subReason, subOpen, SUB_LABEL, loadSubmission, _subAct, doSubmit, doApprove, doReject, doRevise }
}
