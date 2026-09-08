<template>
  <!-- v122 (R5-A)：品牌目标 = 年度（按 12 个月分解）/ 单期（月，单值）双模式 -->
  <div class="monthly-block" style="margin:8px 0 4px;border:1px solid var(--bd);border-radius:10px;padding:10px 12px;background:rgba(var(--p-rgb),.04)">
    <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">
      <b>品牌目标</b>
      <div class="seg">
        <button type="button" :class="['seg-btn', brandMode==='year'?'on':'']" @click="$emit('switch-mode','year')">年度（按 12 个月分解）</button>
        <button type="button" :class="['seg-btn', brandMode==='single'?'on':'']" @click="$emit('switch-mode','single')">单期（月，单值）</button>
      </div>
      <span class="page-sub" style="flex:1;min-width:220px">{{ brandMode === 'year' ? '两种填法：① 在下面「全年目标 / 全年返利率」填一次，自动铺满 12 个月；② 只改某一个月 —— 只填单月不影响其他月份' : '只填「本期目标金额 + 返利率」两个数，保存后口径不变（按月目标）' }}</span>
    </div>
    <div v-if="legacyNotice" class="ap-warn" style="margin-top:6px">⚠ {{ legacyNotice }}</div>

    <!-- 年度模式：12 个月分解 -->
    <MonthlySplitBlock
      v-if="brandMode === 'year'"
      :form="form" :rows="monthlyRows" :sum-wan="monthlySumWan"
      :annual-target="annualTargetWan" :annual-rate="annualRatePct"
      :annual-rate-placeholder="annualRatePlaceholder" :filled-count="monthlyFilledCount"
      @update:annual-target="$emit('update:annualTarget', $event)"
      @update:annual-rate="$emit('update:annualRate', $event)"
      @clear="$emit('clear-monthly')"
    />

    <!-- 单期模式：单值录入 -->
    <template v-else>
      <div class="form-grid2" style="margin-top:8px">
        <div class="form-row"><label>目标年度<span class="ap-sec-note">选填</span></label>
          <input v-model.number="form.target_year" class="input" type="number" min="2000" max="2100" step="1" placeholder="如 2026">
        </div>
        <div class="form-row"><label>本期目标金额</label>
          <div class="input-affix">
            <input :value="targetWan" class="input" type="number" min="0" step="0.1" placeholder="如 100"
                   @input="$emit('update:targetWan', $event.target.value)">
            <span class="affix">万元</span>
          </div>
        </div>
        <div class="form-row"><label>触发方式</label>
          <select v-model="form.trigger_mode" class="input">
            <option value="on_target">达成即返</option>
            <option value="tiered">阶梯返利</option>
          </select>
        </div>
        <div class="form-row" v-if="form.trigger_mode === 'tiered'">
          <label>计法</label>
          <select v-model="form.scale_type" class="input">
            <option v-for="s in scaleOptions" :key="s.value" :value="s.value">{{ s.label }}</option>
          </select>
        </div>
      </div>
      <p class="cf-tip" style="margin-top:6px">单期模式 = 一条规则管<b>一个月</b>的目标（和原来的「蒙牛低温8月目标」一样）。返利形式 / 返利值 / 阶梯在下面统一填写。</p>
    </template>
  </div>

  <!-- 返利形式 / 返利值 / 阶梯（年度模式由各月返利率承载 → 隐藏） -->
  <RebateValueBlock
    :form="form" :rule-tiers="ruleTiers" :scale-options="scaleOptions" :visible="!monthlyOn"
    @add-tier="$emit('add-tier')" @remove-tier="$emit('remove-tier', $event)"
  />

  <!-- 到货与报单节奏（品牌方排产节点，品牌页独有） -->
  <ArrivalRhythmBlock
    :form="form" :arrival-preview="arrivalPreview" :auto-period-preview="autoPeriodPreview"
    :ap-missed-summary="apMissedSummary" :first-arrival-date="firstArrivalDate"
    :arrival-weekday="arrivalWeekday" :lead-err="leadErr" :lead-valid="leadValid" :is-order-wk="isOrderWk"
    @lead-input="$emit('lead-input', $event)"
    @arrival-change="$emit('arrival-change', $event)"
    @toggle-wk="$emit('toggle-wk', $event)"
    @adopt="$emit('adopt')"
    @open-migrate="$emit('open-migrate')"
  />
</template>

<script setup>
import MonthlySplitBlock from './MonthlySplitBlock.vue'
import ArrivalRhythmBlock from './ArrivalRhythmBlock.vue'
import RebateValueBlock from './RebateValueBlock.vue'

defineProps({
  form: { type: Object, required: true },
  monthlyRows: { type: Array, required: true },
  brandMode: { type: String, default: 'year' },
  monthlyOn: { type: Boolean, default: false },
  monthlySumWan: { type: [Number, String], default: 0 },
  annualTargetWan: { type: [Number, String], default: '' },
  annualRatePct: { type: [Number, String], default: '' },
  annualRatePlaceholder: { type: String, default: '如 10' },
  monthlyFilledCount: { type: Number, default: 0 },
  legacyNotice: { type: String, default: '' },
  targetWan: { type: [Number, String], default: 0 },
  ruleTiers: { type: Array, required: true },
  scaleOptions: { type: Array, default: () => [] },
  arrivalPreview: { type: Object, default: null },
  autoPeriodPreview: { type: Object, default: null },
  apMissedSummary: { type: String, default: '' },
  firstArrivalDate: { type: String, default: '' },
  arrivalWeekday: { type: String, default: '' },
  leadErr: { type: String, default: '' },
  leadValid: { type: Boolean, default: false },
  isOrderWk: { type: Function, required: true },
})
defineEmits([
  'switch-mode', 'update:annualTarget', 'update:annualRate', 'clear-monthly', 'update:targetWan',
  'add-tier', 'remove-tier', 'lead-input', 'arrival-change', 'toggle-wk', 'adopt', 'open-migrate',
])
</script>

<style scoped>
.monthly-block .seg{display:inline-flex;border:1px solid var(--bd2);border-radius:8px;overflow:hidden}
.monthly-block .seg-btn{padding:6px 14px;border:0;background:transparent;cursor:pointer;font-size:13px;color:var(--t2)}
.monthly-block .seg-btn.on{background:var(--p);color:#fff}
.form-grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.form-row{display:flex;flex-direction:column;gap:6px}
.form-row label{font-size:12px;font-weight:500;color:var(--t2)}
.input-affix{display:flex;align-items:center;gap:6px}
.input-affix .input{flex:1}
.input-affix .affix{font-size:12px;color:var(--t3);white-space:nowrap}
.ap-warn{font-size:12px;color:var(--danger,#c0392b);background:rgba(192,57,43,.08);border-radius:6px;padding:6px 8px;margin-bottom:6px;line-height:1.5}
.ap-sec-note{font-weight:400;font-size:11.5px;color:var(--t3)}
.cf-tip{font-size:13px;color:var(--t2);line-height:1.6;margin:0}
@media(max-width:768px){ .form-grid2{grid-template-columns:1fr} }
</style>
