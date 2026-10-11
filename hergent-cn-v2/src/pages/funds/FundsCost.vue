<template>
  <div class="page">
    <div class="page-hd split">
      <div><h2>{{ title }}</h2><span class="page-sub">{{ sub }}</span></div>
      <div class="fc-acts"><button class="btn btn-ghost btn-sm" :disabled="loading" @click="load()"><Icon name="refresh" :size="14" />刷新</button></div>
    </div>

    <div v-if="loading" class="state-empty">加载中…</div>
    <div v-else-if="err" class="state-error"><div class="se-ic"><Icon name="alert" :size="22" /></div><p>{{ err }}</p><button class="btn btn-ghost btn-sm" style="margin-top:10px" @click="load()">重试</button></div>

    <template v-else>
      <div v-if="mode === 'query' || mode === 'qty'" class="card fc-filter">
        <div class="fc-frow">
          <label class="fc-grow">关键词<input v-model="f.keyword" class="input" placeholder="商品名称 / 规格"></label>
          <button class="btn btn-ghost btn-sm" @click="load()"><Icon name="search" :size="14" />查询</button>
        </div>
      </div>
      <div class="card fc-card">
        <div v-if="!rows.length" class="state-empty">{{ emptyText }}</div>
        <div v-else class="table-wrap">
          <table class="tbl">
            <thead><tr>
              <th class="seq-th">序号</th><th>商品</th><th>规格</th><th>单位</th>
              <th class="num">数量</th><th class="num">单位成本</th>
              <th class="num">{{ mode === 'summary' ? '金额' : '成本金额' }}</th>
              <th v-if="mode === 'abnormal'">异常</th>
            </tr></thead>
            <tbody>
              <tr v-for="(c, i) in rows" :key="c.id || c.product_id" :class="{ 'fc-bad': mode === 'abnormal' }">
                <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                <td>{{ c.product_name || '—' }}</td><td>{{ c.spec || '—' }}</td><td>{{ c.unit || '—' }}</td>
                <td class="num">{{ fmtQty(c.qty) }}</td>
                <td class="num" :class="Number(c.avg_cost) <= 0 ? 'val-bad' : ''">¥{{ fmtMoney(c.avg_cost) }}</td>
                <td class="num">¥{{ fmtMoney(c.amount) }}</td>
                <td v-if="mode === 'abnormal'"><span class="tag bad">{{ c.avg_cost <= 0 ? '零/负成本' : '已标记' }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="mode === 'qty'" class="fc-foot">数量成本价 = 数量 × 单位成本，由成本快照现算（与入库/出库核算同源）。</p>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import Icon from '../../components/Icon.vue'
import { fundsApi } from '../../api/funds'
import { fmtMoney } from '../../constants/psiLabels'

const route = useRoute()
const mode = computed(() => route.meta.costMode || 'query')
const titleMap = { query: '库存成本查询', summary: '库存成本汇总', qty: '数量成本价', abnormal: '成本异常调整' }
const subMap = {
  query: '按商品查看当前单位成本与成本金额',
  summary: '按商品汇总的库存成本金额',
  qty: '数量 × 单位成本 的成本金额视图',
  abnormal: '单位成本为零或负、被标记为异常的成本记录'
}
const title = computed(() => titleMap[mode.value])
const sub = computed(() => subMap[mode.value])
const emptyText = computed(() => (mode.value === 'abnormal' ? '没有成本异常记录。' : '还没有成本快照。先过账「入库核算单 / 成本调价单」生成成本。'))

const loading = ref(true), err = ref(''), rows = ref([])
const f = reactive({ keyword: '' })
function fmtQty(n) { const v = Number(n || 0); return Number.isInteger(v) ? v.toLocaleString('zh-CN') : v.toFixed(2) }
async function load() {
  loading.value = true; err.value = ''
  try {
    let d
    if (mode.value === 'summary') d = await fundsApi.costSummary()
    else if (mode.value === 'abnormal') d = await fundsApi.costAbnormal()
    else d = await fundsApi.costQuery({ keyword: f.keyword })
    rows.value = Array.isArray(d.items) ? d.items : []
  } catch (e) { err.value = e.message || '加载失败' } finally { loading.value = false }
}
onMounted(load)
</script>

<style scoped>
.fc-acts { display: flex; gap: 8px }
.fc-filter { margin: 14px 0 }
.fc-frow { display: flex; gap: 12px; align-items: flex-end }
.fc-frow > label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--t2) }
.fc-grow { flex: 1 }
.fc-card { padding: 0; overflow: hidden }
.fc-foot { font-size: 12px; color: var(--t2); margin: 8px 2px 0 }
.fc-bad { background: var(--danger-bg, #fef2f2) }
</style>
