<script setup>
/* ---- P1-1 周期级 AI 审核台（补货建议）---- F4 从 Forecast.vue 抽离 ----
   🔴 抽离铁律：函数体一字不改，只动「组件边界 + props/emits」。
   父组件保留 `auditOpen` 开关与 `openAudit()` 闸口（仅置开关 + 期次校验）；
   本组件自拥全部审核状态（auditState/auditData/auditPaged/auditFresh…）与逻辑，
   挂载即 onMounted 拉取后端审核，通过 props 接收页面上下文、
   通过 emits 回抛「关闭 / 定稿后刷新」。
   注册方式：父组件用 defineAsyncComponent 懒加载 ⇒ 首屏 Forecast chunk 不含它，
   仅当首次点「补货建议」时才按需加载。 */
import { ref, computed, onMounted } from 'vue'
import { auditApi } from '../../api/modules'
import { toast } from '../../store'
import { fmt, parseNumInput } from '../../utils/forecast/format.js'
import Icon from '../Icon.vue'

const props = defineProps({
  period: { type: Object, default: null },
  erpLinked: { type: Boolean, default: false },
  recordAudit: { type: Function, required: true },
  numInput: { type: Function, required: true },
  goConnect: { type: Function, required: true },
})
const emit = defineEmits(['close', 'reload'])

const auditState = ref(null)   // null | 'loading' | 'done' | 'empty'
const auditData = ref(null)
const adopting = ref(false)
const auditPage = ref(1)       // W2: AI 审核分批渲染，避免整周期数百行一次渲染卡顿
const AUDIT_PAGE_SIZE = 50
const auditPaged = computed(() => (auditData.value?.items || []).slice(0, auditPage.value * AUDIT_PAGE_SIZE))

// v265/P0-2：销量数据新鲜度常显（后端 _sales_freshness 同一份读数，前端不重算），仅配色区分
const auditFresh = computed(() => {
  const f = auditData.value && auditData.value.sales_freshness
  return (f && f.level) ? f : null
})
const auditFreshAgo = computed(() => {
  const d = auditFresh.value && auditFresh.value.days_stale
  if (d == null) return ''
  return d > 0 ? `${d} 天前` : '今日'
})

function verdictCls(v) {
  if (!v) return ''
  if (v.includes('缺货')) return 'val-bad'
  if (v.includes('积压')) return 'val-warn'
  if (v.includes('吻合')) return 'val-ok'
  return ''
}

async function loadAudit() {
  if (!props.period) return
  auditState.value = 'loading'
  auditData.value = null
  auditPage.value = 1
  try {
    const p = props.period
    const r = await auditApi.auditPeriod({ start: p.order_start, end: p.order_end, period_id: p.id || 0 })
    if (!r.success) { toast(r.error || '审核失败', 'err'); emit('close'); return }
    ;(r.items || []).forEach(a => { if (a.suggested_qty != null && a.final_qty == null) a.final_qty = a.suggested_qty })
    auditData.value = r
    auditState.value = (r.items || []).length ? 'done' : 'empty'
  } catch (e) {
    toast(e.message || '审核失败', 'err')
    emit('close')
  }
}

async function doAdopt() {
  const p = props.period
  if (!p || !auditData.value) return
  adopting.value = true
  try {
    const items = (auditData.value.items || [])
      .filter(a => a.product_id && !a.error)
      .map(a => ({
        product_id: a.product_id, product_name: a.name || '', unit: a.unit || '件',
        requested_qty: a.requested_qty || 0, suggested_qty: a.suggested_qty || 0,
        final_qty: a.final_qty ?? a.suggested_qty ?? 0, verdict: a.verdict || '',
      }))
    if (!items.length) { toast('没有可定稿的 SKU（未匹配主档的已跳过）', 'warn'); emit('close'); return }
    const r = await auditApi.adoptAudit({ start: p.order_start, end: p.order_end, items })
    // v166：定稿决定「最终下单量」，留痕
    props.recordAudit('adopt', `${r.adopted || 0} 个 SKU`)
    toast(`已定稿 ${r.adopted || 0} 个 SKU（AI 只建议，不自动下单）`, 'ok')
    emit('close')
    emit('reload')
  } catch (e) {
    toast('定稿失败: ' + (e.message || ''), 'err')
  } finally {
    adopting.value = false
  }
}

onMounted(loadAudit)
</script>

<template>
  <Teleport to="body">
    <Transition name="fade"><div class="imp-overlay" @click="$emit('close')"></div></Transition>
    <Transition name="pop">
      <div class="imp-modal audit-modal">
        <div class="imp-hd"><b>补货建议本周期 · {{ period?.name || '' }}</b><button class="imp-x" @click="$emit('close')"><Icon name="close"/></button></div>
        <div class="imp-body">
          <div v-if="!erpLinked" class="imp-tip warn-text audit-erp-note">
            <b><Icon name="alert-triangle"/> 当前未连接 ERP（畅捷通 / 金蝶）。</b>本功能的补货建议需以实时库存与销量为依据；未连接时建议量缺少数据支撑、仅供参考。你可手动核对报单量后直接「确认定稿」，或前往 <button class="link-btn" @click="goConnect()">AI 引擎</button> 连接 ERP，建议才会准确。
          </div>
          <!-- v265/P0-2：销量数据新鲜度常显，新鲜与否只决定配色不决定是否渲染 -->
          <div v-if="auditFresh" class="imp-tip audit-fresh" :class="auditFresh.level === 'fresh' ? 'audit-fresh-ok' : 'warn-text'">
            <template v-if="auditFresh.level === 'fresh'">
              <Icon name="clock"/> <b>本建议依据的销量数据最新到 {{ auditFresh.max_date }}（{{ auditFreshAgo }}）</b>，统计窗口 {{ auditFresh.window_start }} 至 {{ auditFresh.window_end }}。
            </template>
            <template v-else>
              <b><Icon name="alert-triangle"/> {{ auditFresh.label }}</b>
              <template v-if="auditFresh.level === 'stale'">
                —— 系统建议依据的统计窗口是 {{ auditFresh.window_start }} 至 {{ auditFresh.window_end }}（按数据最新日期回推 {{ auditFresh.window_days }} 天，<b>不是最近 {{ auditFresh.window_days }} 天</b>）。窗口内没有销量的商品，日均销量会被算成 0、建议量退化为人工判断，下方建议量请只作参考。
              </template>
              <template v-else>
                —— 距上次销量更新已有 {{ auditFresh.days_stale }} 天。建议尽快补充最新的销售/发货数据，否则建议量会逐渐失真。
              </template>
            </template>
          </div>
          <p v-if="auditState === 'loading'" class="imp-tip">正在按「日均销量 × 覆盖天数 − 当前库存」逐 SKU 计算建议量…</p>
          <template v-else-if="auditState === 'done'">
            <p v-if="auditData?.rebate_hint" class="imp-ok">{{ auditData.rebate_hint }}</p>
            <div class="audit-sum">
              <span>{{ auditData.summary?.sku_count || 0 }} 个 SKU</span>
              <span>预报 <b>{{ fmt(auditData.summary?.total_requested) }}</b> 件</span>
              <span>系统建议 <b class="audit-sug">{{ fmt(auditData.summary?.total_suggested) }}</b> 件</span>
              <span v-if="auditData.summary?.missing_count" class="val-bad">缺货 {{ auditData.summary.missing_count }}</span>
              <span v-if="auditData.summary?.excess_count" class="val-warn">积压 {{ auditData.summary.excess_count }}</span>
            </div>
            <p class="legacy-note">本周期经「确认定稿」即为唯一定稿出口；逐单审批为历史流程，仅用于追溯，不生成采购申请。</p>
            <div class="imp-matrix">
              <table class="tbl">
                <thead><tr><th>商品</th><th class="num">预报</th><th class="num">库存</th><th class="num">日均</th><th class="num">建议</th><th class="num">定稿</th><th>判定</th></tr></thead>
                <tbody>
                  <tr v-for="a in auditPaged" :key="a.product_id">
                    <td class="audit-name">{{ a.name || '商品#' + a.product_id }}<span v-if="a.spec" class="hint"> {{ a.spec }}</span></td>
                    <td class="num">{{ a.requested_qty != null ? fmt(a.requested_qty) : '—' }}</td>
                    <td class="num">{{ a.current_stock ?? '—' }}</td>
                    <td class="num">{{ a.avg_daily_sales ?? '—' }}</td>
                    <td class="num"><b class="audit-sug">{{ a.suggested_qty != null ? fmt(a.suggested_qty) : '—' }}</b></td>
                    <td class="num"><input v-if="a.final_qty != null" :value="a.final_qty" class="qty-input" type="text" inputmode="numeric" @input="numInput($event, a, 'final_qty')" @change="a.final_qty = parseNumInput($event.target.value)"><span v-else class="hint">—</span></td>
                    <td class="audit-verdict"><span :class="verdictCls(a.error || a.verdict)">{{ a.error || a.verdict }}</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-if="auditPaged.length < (auditData.items?.length || 0)" class="audit-more">
              <button class="btn btn-ghost btn-sm" @click="auditPage++">加载更多 SKU（已显示 {{ auditPaged.length }}/{{ auditData.items.length }}）</button>
            </div>
            <div class="imp-ft">
              <button class="btn btn-ghost" @click="$emit('close')">关闭</button>
              <button class="btn btn-primary" :disabled="adopting" @click="doAdopt">{{ adopting ? '定稿中…' : '确认定稿（人点生效，AI 不下单）' }}</button>
            </div>
          </template>
          <p v-else-if="auditState === 'empty'" class="imp-tip">该周期暂无已匹配主档的报单商品，无法自动审核。</p>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style>
/* AuditPanel 专属样式（F4 从 Forecast.vue 迁出）；基础 .imp-* 由父级全局样式提供 */
.audit-modal{width:min(760px,96vw)}
.audit-fresh{margin:8px 0 0;line-height:1.7}
.audit-fresh-ok{background:var(--bg3);border:1px solid var(--bd);border-left:3px solid var(--p);border-radius:var(--radius-sm);padding:8px 12px}
.audit-fresh-ok .ico{color:var(--p);opacity:.8}
.legacy-note{font-size:var(--fs-sm);color:var(--t3);margin:0 0 10px;line-height:1.6}
.audit-erp-note{background:var(--bg3);border:1px solid var(--bd);border-left:3px solid var(--dan);border-radius:var(--radius-sm);padding:10px 12px;margin-bottom:14px;line-height:1.7}
.audit-erp-note .link-btn{background:none;border:none;color:var(--p);font:inherit;font-weight:600;padding:0 2px;cursor:pointer;text-decoration:underline}
.audit-sum{display:flex;gap:16px;align-items:baseline;flex-wrap:wrap;font-size:var(--fs-sm);color:var(--t2);padding:8px 0 12px}
.audit-sum b{color:var(--t1)}
.audit-sug{color:var(--p-dark);font-weight:600}
.audit-name{font-weight:500;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.audit-verdict{font-size:12px;color:var(--t2);max-width:260px}
.audit-modal .qty-input{width:72px;height:28px;padding:0 6px;border:1px solid var(--bd);border-radius:var(--radius-sm);text-align:right;background:var(--bg3);color:var(--t1);font-size:var(--fs-sm)}
.audit-more{display:flex;justify-content:center;padding:8px 0 2px}
</style>
