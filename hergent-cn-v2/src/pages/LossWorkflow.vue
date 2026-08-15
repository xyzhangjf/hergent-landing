<template>
  <div class="page">
    <div class="page-hd">
      <h2>货损计算工作流</h2>
      <span class="page-sub">配算法 → 一键跑算 → 按维度看损耗</span>
    </div>

    <!-- 步骤指示器 -->
    <div class="lf-steps">
      <div class="lf-step" :class="{ on: step >= 1 }">① 配算法</div>
      <span class="lf-arrow">→</span>
      <div class="lf-step" :class="{ on: step >= 2 }">② 跑算</div>
      <span class="lf-arrow">→</span>
      <div class="lf-step" :class="{ on: step >= 3 }">③ 看结果</div>
    </div>

    <!-- 步骤 1：配方表单（中文业务参数，无技术细节） -->
    <div v-if="step === 1" class="card lf-panel">
      <div class="panel-hd">
        <b>我的货损算法</b>
        <span class="badge badge-blue">配方快照 · 可复制给同行业客户</span>
      </div>
      <p class="lf-tip">这里没有技术参数，只有你熟悉的业务问题。每个客户算法不同，改这 5 项就行。</p>

      <div class="lf-form">
        <label class="lf-field">
          <span class="lf-label">计算维度 <em>按什么角度汇总损耗</em></span>
          <div class="lf-radios">
            <label v-for="d in dimensionOptions" :key="d.v" class="lf-radio" :class="{ on: form.dimension === d.v }">
              <input type="radio" :value="d.v" v-model="form.dimension">
              <span>{{ d.label }}</span>
            </label>
          </div>
        </label>

        <div class="lf-grid">
          <label class="lf-field">
            <span class="lf-label">临期判定 <em>剩几天算临期</em></span>
            <div class="lf-input-suffix">
              <input v-model.number="form.threshold_days" class="input" type="number" min="1" max="90">
              <span class="lf-suffix">天</span>
            </div>
          </label>

          <label class="lf-field">
            <span class="lf-label">计价口径 <em>损耗按什么价格算</em></span>
            <div class="lf-radios inline">
              <label class="lf-radio" :class="{ on: form.pricing === 'cost' }">
                <input type="radio" value="cost" v-model="form.pricing"><span>成本价</span>
              </label>
              <label class="lf-radio" :class="{ on: form.pricing === 'sale' }">
                <input type="radio" value="sale" v-model="form.pricing"><span>售价</span>
              </label>
            </div>
          </label>
        </div>

        <div class="lf-grid">
          <label class="lf-field">
            <span class="lf-label">临期损耗率 <em>0 = 只预警不计损</em></span>
            <div class="lf-input-suffix">
              <input v-model.number="form.near_loss_pct" class="input" type="number" min="0" max="100">
              <span class="lf-suffix">%</span>
            </div>
          </label>

          <label class="lf-field">
            <span class="lf-label">过期损失系数 <em>1 = 全额，2 = 双倍扣</em></span>
            <div class="lf-input-suffix">
              <input v-model.number="form.expired_coefficient" class="input" type="number" step="0.1" min="0.1" max="10">
              <span class="lf-suffix">倍</span>
            </div>
          </label>
        </div>
      </div>

      <div class="lf-actions">
        <button class="btn btn-ghost" @click="saveRecipe">保存配方</button>
        <button class="btn btn-primary" :disabled="running" @click="runAndShow">
          {{ running ? '计算中…' : '保存并跑算 →' }}
        </button>
      </div>
    </div>

    <!-- 步骤 2/3：结果 -->
    <div v-else class="lf-result-wrap">
      <!-- 概要 -->
      <div class="lf-summary">
        <div class="card lf-kpi lf-kpi-total">
          <div class="lf-kpi-label">预计货损金额</div>
          <div class="lf-kpi-val">¥{{ fmt(result.summary?.total_loss) }}</div>
          <div class="lf-kpi-sub">按「{{ result.recipe?.name || '当前配方' }}」计算</div>
        </div>
        <div class="card lf-kpi">
          <div class="lf-kpi-label">临期件数</div>
          <div class="lf-kpi-val val-warn">{{ fmt(result.summary?.near_qty) }}</div>
          <div class="lf-kpi-sub">¥{{ fmt(result.summary?.near_loss) }} · 剩 {{ result.recipe?.threshold_days }} 天内</div>
        </div>
        <div class="card lf-kpi">
          <div class="lf-kpi-label">过期件数</div>
          <div class="lf-kpi-val val-bad">{{ fmt(result.summary?.expired_qty) }}</div>
          <div class="lf-kpi-sub">¥{{ fmt(result.summary?.expired_loss) }} · 已过期</div>
        </div>
        <div class="card lf-kpi">
          <div class="lf-kpi-label">命中批次</div>
          <div class="lf-kpi-val">{{ fmt(result.summary?.total_items) }}</div>
          <div class="lf-kpi-sub">扫描日 {{ result.scan_date || '—' }}</div>
        </div>
      </div>

      <!-- 分组聚合 -->
      <div class="card lf-panel">
        <div class="panel-hd">
          <b>按「{{ result.dimension_label || '批次效期' }}」汇总</b>
          <span class="tag info">{{ result.groups?.length || 0 }} 组</span>
        </div>
        <div v-if="result.groups?.length" class="lf-groups">
          <div v-for="(g, i) in result.groups" :key="g.key" class="lf-group">
            <div class="lf-group-top">
              <span class="lf-group-name">{{ i + 1 }}. {{ g.key }}</span>
              <span class="lf-group-meta">{{ g.items }} 批 · {{ fmt(g.qty) }} 件 · <b class="val-bad">¥{{ fmt(g.loss) }}</b></span>
            </div>
            <div class="lf-group-bar">
              <div class="lf-group-fill" :style="{ width: barPct(g.loss) + '%' }"></div>
            </div>
          </div>
        </div>
        <div v-else class="state-empty">
          <p>按当前配方没有命中临期/过期库存。</p>
          <p style="margin-top:6px;color:var(--t3)">如果库存里有数据却没结果，多半是库存缺批次/效期信息（见下方提示）。</p>
        </div>
      </div>

      <!-- 明细 -->
      <div class="card lf-panel" v-if="result.items?.length">
        <div class="panel-hd">
          <b>命中明细</b>
          <span class="tag info">{{ result.items.length }} 条</span>
        </div>
        <div class="table-wrap">
          <table class="tbl">
            <thead><tr><th>商品</th><th>批次</th><th>效期</th><th class="num">剩余</th><th class="num">数量</th><th class="num">单价</th><th class="num">损耗</th><th>建议</th></tr></thead>
            <tbody>
              <tr v-for="(it, i) in result.items" :key="i">
                <td>{{ it.product_name }}<span v-if="it.spec" class="lf-spec">{{ it.spec }}</span></td>
                <td>{{ it.batch_no || '—' }}</td>
                <td>{{ it.expiry_date || '—' }}</td>
                <td class="num" :class="it.tier === 'expired' ? 'val-bad' : 'val-warn'">{{ it.days_left }} 天</td>
                <td class="num">{{ fmt(it.quantity) }} {{ it.unit }}</td>
                <td class="num">¥{{ fmt(it.price) }}</td>
                <td class="num val-bad">¥{{ fmt(it.loss) }}</td>
                <td><span class="tag" :class="it.tier === 'expired' ? 'bad' : 'warn'">{{ it.action }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="lf-actions" style="justify-content:space-between">
        <button class="btn btn-ghost" @click="backToConfig">← 改算法再算</button>
        <span v-if="result.scan_date" class="lf-footnote">数据截止 {{ result.scan_date }} · AI 只算不执行，报损仍需人工确认</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { toast } from '../store'
import { lossApi } from '../api/modules'

const step = ref(1)
const running = ref(false)
const result = ref(null)

const dimensionOptions = [
  { v: 'batch', label: '按批次效期' },
  { v: 'category', label: '按品类' },
  { v: 'warehouse', label: '按仓库' },
  { v: 'product', label: '按商品' },
]

const form = reactive({
  name: '我的货损算法',
  dimension: 'batch',
  threshold_days: 7,
  pricing: 'cost',
  near_loss_pct: 0,
  expired_coefficient: 1,
})

function fmt(n) {
  if (n == null) return '—'
  return Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}

function barPct(v) {
  const max = Math.max(...(result.value?.groups || []).map(g => g.loss), 1)
  return Math.max(2, (v / max) * 100)
}

async function saveRecipe() {
  try {
    const r = await lossApi.saveRecipe({ ...form })
    form.name = r.recipe?.name || form.name
    toast('配方已保存', 'ok')
    return true
  } catch (e) {
    toast(e.message || '保存失败', 'err')
    return false
  }
}

async function runAndShow() {
  running.value = true
  try {
    const saved = await lossApi.saveRecipe({ ...form })
    const res = await lossApi.run({})
    result.value = res
    step.value = 2
    if (res.summary?.total_items > 0) toast('计算完成，共命中 ' + res.summary.total_items + ' 批', 'ok')
    else toast('计算完成，当前无命中批次', 'info')
  } catch (e) {
    toast(e.message || '计算失败', 'err')
  } finally {
    running.value = false
  }
}

function backToConfig() {
  step.value = 1
}

onMounted(async () => {
  try {
    const r = await lossApi.getRecipe()
    Object.assign(form, {
      name: r.recipe?.name || '我的货损算法',
      dimension: r.recipe?.dimension || 'batch',
      threshold_days: r.recipe?.threshold_days ?? 7,
      pricing: r.recipe?.pricing || 'cost',
      near_loss_pct: r.recipe?.near_loss_pct ?? 0,
      expired_coefficient: r.recipe?.expired_coefficient ?? 1,
    })
  } catch (e) { /* 后端未就绪时用默认 */ }
})
</script>

<style scoped>
.page-hd{display:flex;align-items:baseline;gap:10px;margin-bottom:18px}
.page-hd h2{font-size:20px;font-weight:600}
.page-sub{font-size:12px;color:var(--t3)}

.lf-steps{display:flex;align-items:center;gap:10px;margin-bottom:16px}
.lf-step{font-size:13px;color:var(--t3);padding:6px 14px;border-radius:16px;background:var(--bg2);border:1px solid var(--border-subtle)}
.lf-step.on{background:var(--p-bg);color:var(--p-dark);border-color:var(--p);font-weight:500}
.lf-arrow{color:var(--t3);font-size:12px}

.lf-panel{padding:20px}
.lf-tip{font-size:12.5px;color:var(--t2);margin:4px 0 16px;line-height:1.6}
.lf-form{display:flex;flex-direction:column;gap:18px}

.lf-field{display:flex;flex-direction:column;gap:8px}
.lf-label{font-size:13px;font-weight:500;color:var(--t1)}
.lf-label em{font-style:normal;font-size:12px;color:var(--t3);font-weight:400;margin-left:8px}

.lf-radios{display:flex;flex-wrap:wrap;gap:8px}
.lf-radios.inline{gap:12px}
.lf-radio{display:flex;align-items:center;gap:6px;padding:7px 14px;border:1px solid var(--bd);border-radius:10px;font-size:13px;color:var(--t2);cursor:pointer;transition:all .15s;background:var(--bg)}
.lf-radio input{display:none}
.lf-radio.on{border-color:var(--p);background:var(--p-bg);color:var(--p-dark);font-weight:500}

.lf-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.lf-input-suffix{position:relative;display:flex;align-items:center}
.lf-input-suffix .input{padding-right:44px}
.lf-suffix{position:absolute;right:14px;font-size:13px;color:var(--t3)}

.lf-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:22px}

.lf-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:14px}
.lf-kpi{padding:16px 18px}
.lf-kpi-total{border-color:var(--p);background:linear-gradient(180deg,var(--p-bg),transparent 130%)}
.lf-kpi-label{font-size:12px;color:var(--t3);margin-bottom:6px}
.lf-kpi-val{font-size:22px;font-weight:600;margin-bottom:4px;font-variant-numeric:tabular-nums;letter-spacing:-.3px}
.lf-kpi-val.val-warn{color:var(--war)}
.lf-kpi-val.val-bad{color:var(--dan)}
.lf-kpi-sub{font-size:11.5px;color:var(--t3)}

.lf-groups{display:flex;flex-direction:column;gap:12px}
.lf-group-top{display:flex;justify-content:space-between;align-items:baseline;gap:10px;font-size:13px;margin-bottom:6px}
.lf-group-name{font-weight:500;color:var(--t1)}
.lf-group-meta{font-size:12px;color:var(--t2);white-space:nowrap}
.lf-group-bar{height:8px;border-radius:4px;background:var(--bg4);overflow:hidden}
.lf-group-fill{height:100%;border-radius:4px;background:linear-gradient(90deg,var(--war),var(--dan));transition:width .5s}

.lf-spec{display:inline-block;margin-left:6px;font-size:11px;color:var(--t3)}
.lf-footnote{font-size:12px;color:var(--t3)}

@media(max-width:768px){
  .lf-grid{grid-template-columns:1fr}
  .lf-summary{grid-template-columns:repeat(2,1fr)}
}
</style>
