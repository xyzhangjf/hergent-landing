<template>
  <!-- v126：品牌目标 = 一张 12 行月表。年度只是「铺满 12 格」，单期只是「只填 1 格」 -->
  <div class="monthly-block" style="margin:8px 0 4px;border:1px solid var(--bd);border-radius:10px;padding:10px 12px;background:rgba(var(--p-rgb),.04)">
    <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">
      <b>品牌目标</b>
      <span class="page-sub" style="flex:1;min-width:220px">
        给了全年目标就在「全年目标 / 全年返利率」填一次自动铺 12 个月；没给就哪个月有政策填哪个月 —— 底层是同一张表
      </span>
    </div>
    <div v-if="legacyNotice" class="ap-warn" style="margin-top:6px">⚠ {{ legacyNotice }}</div>

    <MonthlySplitBlock
      :form="form" :rows="monthlyRows" :sum-wan="monthlySumWan"
      :annual-target="annualTargetWan" :annual-rate="annualRatePct"
      :annual-rate-placeholder="annualRatePlaceholder" :filled-count="monthlyFilledCount"
      :scale-options="scaleOptions"
      @update:annual-target="$emit('update:annualTarget', $event)"
      @update:annual-rate="$emit('update:annualRate', $event)"
      @clear="$emit('clear-monthly')"
      @add-tier="$emit('add-month-tier', $event)"
      @remove-tier="$emit('remove-month-tier', $event)"
    />

    <!-- 默认档位：未单独配档位的月份回退到这里（12 个月政策相同时只配一次） -->
    <div v-if="form.trigger_mode === 'tiered'" class="mg-default">
      <RebateValueBlock
        :form="form" :rule-tiers="ruleTiers" :scale-options="scaleOptions"
        title="默认档位（未单独配置的月份用）"
        @add-tier="$emit('add-tier')" @remove-tier="$emit('remove-tier', $event)"
      />
    </div>
  </div>

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
  monthlySumWan: { type: [Number, String], default: 0 },
  annualTargetWan: { type: [Number, String], default: '' },
  annualRatePct: { type: [Number, String], default: '' },
  annualRatePlaceholder: { type: String, default: '如 10' },
  monthlyFilledCount: { type: Number, default: 0 },
  legacyNotice: { type: String, default: '' },
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
  'update:annualTarget', 'update:annualRate', 'clear-monthly',
  'add-tier', 'remove-tier', 'add-month-tier', 'remove-month-tier',
  'lead-input', 'arrival-change', 'toggle-wk', 'adopt', 'open-migrate',
])
</script>

<style scoped>
.monthly-block .page-sub{font-size:12px;color:var(--t3);line-height:1.5}
.ap-warn{font-size:12px;color:var(--danger,#c0392b);background:rgba(192,57,43,.08);border-radius:6px;padding:6px 8px;margin-bottom:6px;line-height:1.5}
.mg-default{margin-top:10px;border-top:1px dashed var(--bd);padding-top:6px}
</style>
