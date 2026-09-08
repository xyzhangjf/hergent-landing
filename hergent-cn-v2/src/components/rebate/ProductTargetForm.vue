<template>
  <!-- 商品目标：单值 + 周期口径。v122：报单节奏是品牌方排产节点，商品页整块不渲染 -->
  <div class="form-grid2">
    <div class="form-row"><label>周期口径</label>
      <select v-model="form.period_type" class="input">
        <option value="month">月</option>
        <option value="quarter">季</option>
        <option value="year">年</option>
        <option value="custom">自定义</option>
      </select>
    </div>
    <div class="form-row" v-if="form.target_type==='amount'"><label>目标金额</label>
      <div class="input-affix">
        <input :value="targetWan" class="input" type="number" min="0" step="0.1" placeholder="如 16"
               @input="$emit('update:targetWan', $event.target.value)">
        <span class="affix">万元</span>
      </div>
    </div>
    <div class="form-row" v-else><label>目标数量</label><input v-model.number="form.target_value" class="input" type="number" min="0" placeholder="数量"></div>
    <!-- v122：数量目标必须带单位，否则看板与返利都会歧义（箱/件/提） -->
    <div class="form-row" v-if="form.target_type==='quantity'"><label>数量单位</label><input v-model="form.target_unit" class="input" placeholder="如 箱 / 件 / 提"></div>
    <div class="form-row"><label>触发方式</label>
      <select v-model="form.trigger_mode" class="input">
        <option value="on_target">达成即返</option>
        <option value="tiered">阶梯返利</option>
      </select>
    </div>
    <!-- v113 §1.3：阶梯「计法」开关（累进 / 全量按档），返利争议最常见的技术根因 -->
    <div class="form-row" v-if="form.trigger_mode === 'tiered'">
      <label>计法</label>
      <select v-model="form.scale_type" class="input">
        <option v-for="s in scaleOptions" :key="s.value" :value="s.value">{{ s.label }}</option>
      </select>
    </div>
  </div>

  <RebateValueBlock
    :form="form" :rule-tiers="ruleTiers" :scale-options="scaleOptions" :visible="true"
    @add-tier="$emit('add-tier')" @remove-tier="$emit('remove-tier', $event)"
  />
</template>

<script setup>
import RebateValueBlock from './RebateValueBlock.vue'

defineProps({
  form: { type: Object, required: true },
  targetWan: { type: [Number, String], default: 0 },
  ruleTiers: { type: Array, required: true },
  scaleOptions: { type: Array, default: () => [] },
})
defineEmits(['update:targetWan', 'add-tier', 'remove-tier'])
</script>

<style scoped>
.form-grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.form-row{display:flex;flex-direction:column;gap:6px}
.form-row label{font-size:12px;font-weight:500;color:var(--t2)}
.input-affix{display:flex;align-items:center;gap:6px}
.input-affix .input{flex:1}
.input-affix .affix{font-size:12px;color:var(--t3);white-space:nowrap}
@media(max-width:768px){ .form-grid2{grid-template-columns:1fr} }
</style>
