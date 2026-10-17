<template>
  <div class="page">
    <div class="page-hd split">
      <div>
        <h2>效期预警表</h2>
        <span class="page-sub">临期库存 · 红区 30 天内到期 / 黄区 31–60 天</span>
      </div>
      <div class="wer-acts">
        <button class="btn btn-ghost btn-sm" :disabled="loading" @click="load()">
          <Icon name="refresh" :size="14" />刷新
        </button>
      </div>
    </div>

    <Skeleton v-if="loading" />

    <div v-else-if="err" class="state-error">
      <div class="se-ic"><Icon name="alert" :size="22" /></div>
      <p>{{ err }}</p>
      <button class="btn btn-ghost btn-sm" style="margin-top:10px" @click="load()">重试</button>
    </div>

    <template v-else>
      <!-- 顶部概览：红/黄两区各「品种 + 数量」 -->
      <div class="card kpi-strip cols-4">
        <div class="kpi">
          <div class="kpi-label">红区品种</div>
          <div class="kpi-val val-bad">{{ red.length }}</div>
          <div class="kpi-sub">30 天内到期</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">红区数量</div>
          <div class="kpi-val val-bad">{{ fmtQty(redTotal) }}</div>
          <div class="kpi-sub">按商品档案单位</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">黄区品种</div>
          <div class="kpi-val val-warn">{{ yellow.length }}</div>
          <div class="kpi-sub">31–60 天内到期</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">黄区数量</div>
          <div class="kpi-val val-warn">{{ fmtQty(yellowTotal) }}</div>
          <div class="kpi-sub">按商品档案单位</div>
        </div>
      </div>

      <div class="card wer-card">
        <div class="sec-hd">红区 · 30 天内到期（{{ red.length }} 批）</div>
        <div v-if="red.length" class="table-wrap freeze-list">
          <table class="tbl">
            <thead>
              <tr>
                <th class="seq-th">序号</th><th>商品</th><th>规格</th><th>批次号</th>
                <th>到期日</th><th class="num">剩余天数</th><th class="num">数量</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in red" :key="'r' + r.id">
                <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                <td>{{ r.name }}</td>
                <td>{{ r.spec || '—' }}</td>
                <td>{{ r.batch_no || '—' }}</td>
                <td>{{ r.expiry_date || '—' }}</td>
                <td class="num wer-days bad">{{ daysText(r.expiry_date) }}</td>
                <td class="num">{{ fmtQty(r.quantity) }} {{ r.unit || '' }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td class="ft-lb" colspan="5">本页合计</td>
                <td></td>
                <td class="num">{{ fmtQty(redQty) }}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div v-else class="state-empty">红区暂无临期库存。</div>
      </div>

      <div class="card wer-card">
        <div class="sec-hd">黄区 · 31–60 天到期（{{ yellow.length }} 批）</div>
        <div v-if="yellow.length" class="table-wrap freeze-list">
          <table class="tbl">
            <thead>
              <tr>
                <th class="seq-th">序号</th><th>商品</th><th>规格</th><th>批次号</th>
                <th>到期日</th><th class="num">剩余天数</th><th class="num">数量</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in yellow" :key="'y' + r.id">
                <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                <td>{{ r.name }}</td>
                <td>{{ r.spec || '—' }}</td>
                <td>{{ r.batch_no || '—' }}</td>
                <td>{{ r.expiry_date || '—' }}</td>
                <td class="num wer-days warn">{{ daysText(r.expiry_date) }}</td>
                <td class="num">{{ fmtQty(r.quantity) }} {{ r.unit || '' }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td class="ft-lb" colspan="5">本页合计</td>
                <td></td>
                <td class="num">{{ fmtQty(yellowQty) }}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div v-else class="state-empty">黄区暂无临期库存。</div>
      </div>

      <p class="wer-foot">
        口径：红区 ≤30 天、黄区 31–60 天，由后端按 `到期日` 现算（与出库 FEFO 扣减同源）。
        剩余天数在页内按日期推算，仅作展示。
      </p>
    </template>
  </div>
</template>

<script setup>
/* 效期预警表（仓配管理 · 库存查询）—— 数据源：GET /api/expiry/forecast。
   🔴 红/黄分档**由后端给**（阈值不在前端写死）：前端只做「单位 + 天数」的展示换算，
      不重新判定档位 —— 否则会出现「屏幕颜色 ≠ 后端口径」的第二份实现。
   🔴 本页**只读**、无「新建」入口：库存与效期是采购/销售/补录的**结果**，
      手改要去「库存效期补录」或盘点，不在这里凭空加。 */
import Skeleton from '../../components/Skeleton.vue'
import { ref, computed, onMounted } from 'vue'
import Icon from '../../components/Icon.vue'
import { whApi } from '../../api/wh'

const loading = ref(true)
const err = ref('')
const red = ref([])
const yellow = ref([])
const redTotal = ref(0)
const yellowTotal = ref(0)

/* 日期 → 剩余天数（仅展示）。返回 null 表示日期缺失/不可解析 ⇒ 显示「—」。 */
function daysLeft (s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''))
  if (!m) return null
  const d = new Date(+m[1], +m[2] - 1, +m[3])
  const t = new Date()
  t.setHours(0, 0, 0, 0)
  return Math.round((d - t) / 86400000)
}
function daysText (s) {
  const n = daysLeft(s)
  if (n === null) return '—'
  if (n < 0) return `已过期 ${-n} 天`
  return `剩 ${n} 天`
}
/* 数量：整数按整数显示（包/箱不带小数），非整数保留 2 位 —— 与全站口径一致。 */
function fmtQty (n) {
  const v = Number(n || 0)
  return Number.isInteger(v) ? v.toLocaleString('zh-CN') : v.toFixed(2)
}

async function load () {
  loading.value = true
  err.value = ''
  try {
    const d = await whApi.expiryForecast()
    red.value = Array.isArray(d.red) ? d.red : []
    yellow.value = Array.isArray(d.yellow) ? d.yellow : []
    redTotal.value = Number(d.red_total || 0)
    yellowTotal.value = Number(d.yellow_total || 0)
  } catch (e) {
    err.value = e.message || '效期预警读取失败'
  } finally {
    loading.value = false
  }
}

/* 本页合计：红 / 黄两区各自对可见批次行的「数量」求和；剩余天数为天数，不合计。 */
const redQty = computed(() => red.value.reduce((s, r) => s + Number(r.quantity || 0), 0))
const yellowQty = computed(() => yellow.value.reduce((s, r) => s + Number(r.quantity || 0), 0))
onMounted(load)
defineExpose({ load })
</script>

<style scoped>
/* 页面私有类一律 `wer-` 前缀（仓配·效期）；全局件（.page/.page-hd/.card/.kpi-strip/
   .table-wrap/.tbl/.num/.sec-hd/.state-empty/.state-error）一律复用，不重定义。 */
.wer-acts { display: flex; align-items: center; gap: 8px; flex-wrap: wrap }
.wer-card { margin-bottom: 14px }
/* `table.tbl` 已给序号列全局样式；这里只补「剩余天数」的语义色 */
.wer-days { font-weight: 600 }
.wer-days.bad { color: var(--dan) }
.wer-days.warn { color: var(--war) }
.wer-foot { font-size: 12px; color: var(--t2); margin-top: 4px; line-height: 1.7 }
</style>
